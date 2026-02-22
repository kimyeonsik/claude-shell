#!/usr/bin/env node

import { createServer, type Server, type Socket } from "node:net";
import { existsSync, mkdirSync, unlinkSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { ContextManager } from "./context/manager.js";
import {
  type ClientMessage,
  type DaemonMessage,
  serialize,
  parseBuffer,
} from "./protocol.js";
import { CONFIG_DIR, SOCKET_PATH } from "./types.js";

// ── State ──
let currentSessionId: string | null = null;
const contextManager = new ContextManager();
let server: Server | null = null;
let queryInProgress = false;
let activeAbort: AbortController | null = null;

// ── PID file for stale socket detection ──
const PID_PATH = `${CONFIG_DIR}/daemon.pid`;

// ── Ensure config directory ──
function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

// ── Handle AI Query ──
async function handleQuery(
  socket: Socket,
  userMessage: string,
  cwd: string,
  commandContext?: string
): Promise<void> {
  // C3 fix: serialize queries — reject concurrent requests
  if (queryInProgress) {
    send(socket, {
      type: "error",
      message: "Another query is in progress. Please wait.",
    });
    send(socket, { type: "done" });
    return;
  }

  queryInProgress = true;
  const abort = new AbortController();
  activeAbort = abort;

  // Cancel query if client disconnects
  const onClose = () => abort.abort();
  socket.once("close", onClose);

  const ctx = contextManager.build(cwd);

  // Ephemeral injection: command output goes into system prompt but NOT into window
  let appendPrompt = ctx.systemPrompt;
  if (commandContext) {
    appendPrompt += `\n\n[Recent Command Output]\n${commandContext}`;
  }

  try {
    const q = query({
      prompt: userMessage,
      options: {
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: appendPrompt,
        },
        // Agent SDK sessions are per-query; resume is not supported across calls
        resume: undefined,
        // C1 fix: use allowedTools to auto-allow specific tools
        // C2 fix: use bypassPermissions so detached daemon doesn't hang on prompts
        allowedTools: ["Read", "Edit", "Bash", "Glob", "Grep", "Write"],
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        abortController: abort,
        maxTurns: 3,
        includePartialMessages: false,
        cwd,
      },
    });

    let assistantText = "";

    for await (const msg of q) {
      if (msg.type === "system" && msg.subtype === "init") {
        currentSessionId = msg.session_id;
        continue;
      }

      if (msg.type === "assistant" && msg.message?.content) {
        for (const block of msg.message.content) {
          // Skip thinking blocks
          if ("type" in block && block.type === "thinking") continue;

          if ("text" in block && typeof block.text === "string") {
            assistantText += block.text;
            send(socket, { type: "text", content: block.text });
          } else if ("name" in block && typeof block.name === "string") {
            send(socket, {
              type: "tool_use",
              tool: block.name,
              input: JSON.stringify(
                "input" in block ? block.input : {},
                null,
                2
              ),
            });
          }
        }
      }

      if (msg.type === "result") {
        if (msg.subtype === "success" && typeof msg.result === "string") {
          if (msg.result && msg.result !== assistantText) {
            assistantText += msg.result;
            send(socket, { type: "text", content: msg.result });
          }
        } else if (msg.subtype !== "success") {
          const errors = "errors" in msg ? msg.errors : [];
          send(socket, {
            type: "error",
            message: `Query ended: ${msg.subtype}${
              Array.isArray(errors) && errors.length > 0
                ? " — " + errors.join(", ")
                : ""
            }`,
          });
        }
      }
    }

    // Update context after successful turn
    contextManager.addTurn(userMessage, assistantText);

    // Memory extraction at configured interval
    if (contextManager.shouldExtractMemory()) {
      extractMemory(assistantText).catch(() => {
        // non-critical — silently ignore extraction failures
      });
    }
  } catch (err) {
    if (abort.signal.aborted) {
      send(socket, { type: "info", message: "Query cancelled." });
    } else {
      const message = err instanceof Error ? err.message : String(err);
      send(socket, { type: "error", message });
    }
  } finally {
    queryInProgress = false;
    activeAbort = null;
    socket.removeListener("close", onClose);
  }

  send(socket, { type: "done" });
}

// ── Memory Extraction (LLM Agent) ──

const EXTRACT_SYSTEM_PROMPT = `You are a memory extraction agent. From the given AI assistant response, extract facts worth remembering for future conversations.

Return ONLY valid JSON (no markdown, no explanation):
{
  "project": { "key": "value" },
  "conventions": ["convention string"],
  "decisions": ["decision string"]
}

Rules:
- project: tech stack, frameworks, languages, project description (max 3)
- conventions: coding rules, naming conventions, style guidelines (max 2)
- decisions: architectural or design choices made (max 2)
- Skip negated statements ("don't use X", "not recommended")
- Skip content inside code blocks
- If nothing worth remembering, return {}
- Keep values concise (under 100 chars each)`;

const EXTRACT_MAX_INPUT = 4000;

async function extractMemory(recentResponse: string): Promise<void> {
  if (recentResponse.length < 50) return;

  const input = recentResponse.length > EXTRACT_MAX_INPUT
    ? recentResponse.slice(0, EXTRACT_MAX_INPUT)
    : recentResponse;

  const result = query({
    prompt: input,
    options: {
      model: "claude-haiku-4-5-20251001",
      systemPrompt: EXTRACT_SYSTEM_PROMPT,
      maxTurns: 1,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
    },
  });

  let responseText = "";
  for await (const msg of result) {
    if (msg.type === "assistant" && msg.message?.content) {
      for (const block of msg.message.content) {
        if ("text" in block && typeof block.text === "string") {
          responseText += block.text;
        }
      }
    }
  }

  if (!responseText.trim()) return;

  // Extract JSON from markdown fences if present, otherwise use raw text
  const fenceMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = (fenceMatch ? fenceMatch[1] : responseText).trim();
  const parsed: unknown = JSON.parse(jsonStr);

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;

  const raw = parsed as Record<string, unknown>;
  const extracted: Partial<import("./types.js").MemoryStore> = {};

  // Validate & constrain: project
  if (raw.project && typeof raw.project === "object" && !Array.isArray(raw.project)) {
    const proj: Record<string, string> = {};
    let count = 0;
    for (const [k, v] of Object.entries(raw.project as Record<string, unknown>)) {
      if (count >= 3) break;
      if (typeof v === "string" && v.length <= 100) {
        proj[k] = v;
        count++;
      }
    }
    if (count > 0) extracted.project = proj;
  }

  // Validate & constrain: conventions
  if (Array.isArray(raw.conventions)) {
    const convs = raw.conventions
      .filter((c): c is string => typeof c === "string" && c.length <= 100)
      .slice(0, 2);
    if (convs.length > 0) extracted.conventions = convs;
  }

  // Validate & constrain: decisions
  if (Array.isArray(raw.decisions)) {
    const decs = raw.decisions
      .filter((d): d is string => typeof d === "string" && d.length <= 100)
      .slice(0, 2);
    if (decs.length > 0) extracted.decisions = decs;
  }

  if (extracted.project || extracted.conventions || extracted.decisions) {
    contextManager.memory.mergeExtracted(extracted);
  }
}

// ── Handle Commands ──
function handleCommand(
  socket: Socket,
  command: string,
  args?: string
): void {
  switch (command) {
    case "status": {
      const status = contextManager.getStatus();
      status.sessionId = currentSessionId;
      send(socket, {
        type: "status",
        data: status as unknown as Record<string, unknown>,
      });
      break;
    }

    case "compact":
      contextManager.compact();
      currentSessionId = null;
      send(socket, {
        type: "info",
        message: "Window compacted to topic. Next query starts new session.",
      });
      break;

    case "clear":
      contextManager.clearWindow();
      currentSessionId = null;
      send(socket, {
        type: "info",
        message: "Window cleared. Memory preserved.",
      });
      break;

    case "forget":
      contextManager.clearAll();
      currentSessionId = null;
      send(socket, {
        type: "info",
        message: "All context cleared.",
      });
      break;

    case "topic":
      if (!args) {
        send(socket, { type: "error", message: "Topic name required" });
        break;
      }
      {
        const result = contextManager.switchTopic(args);
        currentSessionId = null;
        send(socket, {
          type: "info",
          message: result.savedTopic
            ? `Saved "${result.savedTopic}" | New topic: ${args}`
            : `New topic: ${args}`,
        });
      }
      break;

    case "recall":
      if (!args) {
        send(socket, { type: "error", message: "Topic name required" });
        break;
      }
      {
        const result = contextManager.recallTopic(args);
        if (result.found) {
          currentSessionId = null;
          send(socket, {
            type: "info",
            message: `Restored "${args}": ${result.summary}`,
          });
        } else {
          send(socket, {
            type: "error",
            message: `Topic "${args}" not found`,
          });
        }
      }
      break;

    case "remember":
      if (!args) {
        send(socket, { type: "error", message: "Fact required" });
        break;
      }
      contextManager.memory.remember(args);
      send(socket, { type: "info", message: `Remembered: ${args}` });
      break;

    case "stop":
      send(socket, { type: "info", message: "Daemon stopping..." });
      send(socket, { type: "done" });
      // Cancel any running query
      if (activeAbort) activeAbort.abort();
      shutdown();
      return;

    default:
      send(socket, {
        type: "error",
        message: `Unknown command: ${command}`,
      });
  }

  send(socket, { type: "done" });
}

// ── Socket Communication ──
function send(socket: Socket, msg: DaemonMessage): void {
  if (!socket.destroyed) {
    socket.write(serialize(msg));
  }
}

// ── Message Validation (M8 fix) ──
function isValidClientMessage(raw: unknown): raw is ClientMessage {
  if (typeof raw !== "object" || raw === null) return false;
  const msg = raw as Record<string, unknown>;
  if (msg.type === "ping") return true;
  if (msg.type === "query") {
    return typeof msg.message === "string" && typeof msg.cwd === "string"
      && (msg.commandContext === undefined || typeof msg.commandContext === "string");
  }
  if (msg.type === "command") {
    return (
      typeof msg.command === "string" &&
      (msg.args === undefined || typeof msg.args === "string")
    );
  }
  return false;
}

// ── Connection Handler ──
function handleConnection(socket: Socket): void {
  let buffer = "";

  socket.on("data", async (data) => {
    try {
      buffer += data.toString();
      const { messages, remainder } = parseBuffer(buffer);
      buffer = remainder;

      for (const raw of messages) {
        if (!isValidClientMessage(raw)) {
          send(socket, { type: "error", message: "Invalid message format" });
          send(socket, { type: "done" });
          continue;
        }

        const msg = raw;

        if (msg.type === "ping") {
          send(socket, { type: "info", message: "pong" });
          send(socket, { type: "done" });
        } else if (msg.type === "query") {
          try {
            await handleQuery(socket, msg.message, msg.cwd, msg.commandContext);
          } catch (err) {
            send(socket, {
              type: "error",
              message: err instanceof Error ? err.message : String(err),
            });
            send(socket, { type: "done" });
          }
        } else if (msg.type === "command") {
          handleCommand(socket, msg.command, msg.args);
        }
      }
    } catch {
      // Prevent unhandled rejection from async event handler
    }
  });

  socket.on("error", () => {
    // client disconnected, ignore
  });
}

// ── Server Lifecycle ──
function shutdown(): void {
  if (server) {
    server.close();
    server = null;
  }
  try {
    if (existsSync(SOCKET_PATH)) unlinkSync(SOCKET_PATH);
  } catch {
    // ignore cleanup errors
  }
  try {
    if (existsSync(PID_PATH)) unlinkSync(PID_PATH);
  } catch {
    // ignore
  }
  process.exit(0);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function start(): void {
  // Allow Agent SDK to run even when launched from within a Claude Code session
  delete process.env.CLAUDECODE;

  ensureConfigDir();

  // H4/H5 fix: Check for stale socket using PID file
  if (existsSync(SOCKET_PATH)) {
    if (existsSync(PID_PATH)) {
      try {
        const pid = parseInt(
          readFileSync(PID_PATH, "utf-8").trim(),
          10
        );
        if (!isNaN(pid) && isProcessAlive(pid)) {
          console.error("Daemon already running (PID: " + pid + ")");
          process.exit(1);
        }
      } catch {
        // can't read PID, treat as stale
      }
    }
    try {
      unlinkSync(SOCKET_PATH);
    } catch {
      console.error(`Cannot remove stale socket: ${SOCKET_PATH}`);
      process.exit(1);
    }
  }

  // Write PID file
  writeFileSync(PID_PATH, String(process.pid));

  // Ensure socket directory exists
  const sockDir = dirname(SOCKET_PATH);
  if (!existsSync(sockDir)) {
    mkdirSync(sockDir, { recursive: true });
  }

  server = createServer(handleConnection);

  server.listen(SOCKET_PATH, () => {
    // Restrict socket access to owner only (prevent local privilege escalation)
    try { chmodSync(SOCKET_PATH, 0o600); } catch { /* best-effort */ }
    console.log(`aish daemon listening on ${SOCKET_PATH}`);
    console.log(`PID: ${process.pid}`);
  });

  server.on("error", (err) => {
    console.error("Daemon error:", err.message);
    shutdown();
  });

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start();
