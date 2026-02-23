#!/usr/bin/env node

// ── Interactive Shell: terminal commands + AI prompts in one REPL ──

import * as readline from "node:readline";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, statSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { type Socket } from "node:net";
import { type DaemonMessage } from "./protocol.js";
import {
  ensureDaemon,
  connectToDaemon,
  sendMessage,
  streamResponses,
} from "./connection.js";
import { t, loadLang, setLang } from "./i18n.js";

// ── ANSI colors ──
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`;

// ── Constants ──
const MAX_OUTPUT_ENTRIES = 5;
const MAX_OUTPUT_CHARS = 3000;
const MAX_CONTEXT_CHARS = 4000;

// ── Types ──
interface OutputEntry {
  command: string;
  output: string;
  exitCode: number;
  ts: number;
}

// ── AishShell Class ──
export class AishShell {
  private cwd: string;
  private outputBuffer: OutputEntry[] = [];
  private rl: readline.Interface | null = null;
  private activeChild: ChildProcess | null = null;
  private activeSocket: Socket | null = null;
  private isQuerying = false;
  private cmdQueue: Array<() => Promise<void>> = [];
  private isProcessing = false;
  private isClosing = false;
  private pendingInputResolve: ((s: string) => void) | null = null;
  private pathCommandsCache: string[] | null = null;
  private pathCommandsCacheTime = 0;

  constructor(initialCwd?: string) {
    this.cwd = initialCwd ?? process.cwd();
  }

  async start(): Promise<void> {
    loadLang();
    // Ensure daemon is ready before entering REPL
    try {
      await ensureDaemon();
    } catch (err) {
      console.error(
        red("✗"),
        "Failed to start daemon:",
        err instanceof Error ? err.message : String(err)
      );
      process.exit(1);
    }

    this.printWelcome();

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: this.buildPrompt(),
      terminal: true,
    });

    // Ctrl+C handling
    this.rl.on("SIGINT", () => {
      if (this.activeChild) {
        // Kill running shell command
        this.activeChild.kill("SIGINT");
        this.activeChild = null;
        process.stdout.write("\n");
        this.rl!.prompt();
      } else if (this.activeSocket) {
        // Cancel AI query
        this.activeSocket.destroy();
        this.activeSocket = null;
        this.isQuerying = false;
        process.stdout.write(dim("\n(query cancelled)\n"));
        this.rl!.prompt();
      } else {
        // Clear current line
        process.stdout.write("\n");
        this.rl!.prompt();
      }
    });

    this.rl.on("line", (line) => {
      const input = line.trim();

      // If handleCommandNotFound is waiting for confirmation, route there
      if (this.pendingInputResolve) {
        const resolve = this.pendingInputResolve;
        this.pendingInputResolve = null;
        resolve(input);
        return;
      }

      if (!input) {
        if (!this.isProcessing) this.rl!.prompt();
        return;
      }

      this.enqueue(async () => {
        try {
          await this.dispatch(input);
        } catch (err) {
          console.error(red("✗"), err instanceof Error ? err.message : String(err));
        }
      });
    });

    this.rl.on("close", () => {
      if (this.isClosing) return;       // already handled (e.g. "exit" command)
      this.isClosing = true;
      if (!this.isProcessing) {
        // Queue is empty — exit immediately (e.g. Ctrl+D with no pending commands)
        process.stdout.write(dim("\nBye.\n"));
        process.exit(0);
      }
      // Queue still running — processQueue will print Bye. and exit when done
    });

    this.rl.prompt();
  }

  // ── Command Queue (ensures sequential execution) ──
  private enqueue(fn: () => Promise<void>): void {
    this.cmdQueue.push(fn);
    if (!this.isProcessing) this.processQueue();
  }

  private async processQueue(): Promise<void> {
    this.isProcessing = true;
    while (this.cmdQueue.length > 0) {
      const fn = this.cmdQueue.shift()!;
      await fn();
      if (!this.isClosing) {
        this.rl!.setPrompt(this.buildPrompt());
        this.rl!.prompt();
      }
    }
    this.isProcessing = false;
    if (this.isClosing) {
      process.stdout.write(dim("\nBye.\n"));
      process.exit(0);
    }
  }

  // ── Command Dispatch ──
  private async dispatch(input: string): Promise<void> {
    // Meta commands: --status, --compact, etc.
    if (input.startsWith("--")) {
      await this.handleMetaCommand(input);
      return;
    }

    // Pipe to AI: cmd |> query
    if (input.includes("|>")) {
      await this.handlePipeToAI(input);
      return;
    }

    // AI query: > query
    if (input.startsWith(">")) {
      const query = input.slice(1).trim();
      if (query) {
        await this.handleAIQuery(query);
      }
      return;
    }

    // Exit
    if (input === "exit" || input === "quit") {
      this.rl?.close();
      return;
    }

    // cd command
    if (input === "cd" || input.startsWith("cd ")) {
      this.handleCd(input);
      return;
    }

    // Regular shell command — try as shell first, fallback to AI on 127
    const exitCode = await this.handleShellCommand(input);
    if (exitCode === 127) {
      await this.handleCommandNotFound(input);
    }
  }

  // ── Shell Command Execution ──
  private handleShellCommand(command: string): Promise<number> {
    return new Promise((resolveCmd) => {
      let output = "";

      const child = spawn("sh", ["-c", command], {
        cwd: this.cwd,
        env: { ...process.env, PWD: this.cwd },
        stdio: ["inherit", "pipe", "pipe"],
      });

      this.activeChild = child;

      child.stdout!.on("data", (data: Buffer) => {
        const chunk = data.toString();
        process.stdout.write(chunk);
        if (output.length < MAX_OUTPUT_CHARS) output += chunk;
      });

      child.stderr!.on("data", (data: Buffer) => {
        const chunk = data.toString();
        process.stderr.write(chunk);
        if (output.length < MAX_OUTPUT_CHARS) output += chunk;
      });

      child.on("close", (code) => {
        this.activeChild = null;
        const exitCode = code ?? 0;

        // Store in ring buffer
        this.pushOutput({
          command,
          output: output.length > MAX_OUTPUT_CHARS
            ? output.slice(0, MAX_OUTPUT_CHARS) + "\n...[truncated]"
            : output,
          exitCode,
          ts: Date.now(),
        });

        resolveCmd(exitCode);
      });

      child.on("error", (err) => {
        this.activeChild = null;
        console.error(red("✗"), err.message);
        resolveCmd(1);
      });
    });
  }

  // ── Command-not-found Fallback ──

  // Prompt user for a single line within the queue (safe alternative to rl.question)
  private async promptLine(question: string): Promise<string> {
    if (this.isClosing) return "";
    return new Promise<string>((resolve) => {
      this.pendingInputResolve = resolve;
      process.stdout.write(question);
    });
  }

  // QWERTY keyboard adjacency map (lowercase only)
  // Adjacent = same row neighbor + diagonal cross-row neighbor
  private static readonly QWERTY: Record<string, string> = {
    q:"was",   w:"qeasd",  e:"wrsdf",  r:"etdfg",  t:"ryfgh",
    y:"tughj",  u:"yihjk",  i:"uojkl",  o:"ipkl",   p:"ol",
    a:"qwsz",  s:"aedxzw", d:"srfxce", f:"dgtcvr",  g:"fhtvby",
    h:"gjybun", j:"hkuinm", k:"jlijom", l:"kop",
    z:"asx",   x:"zsdc",   c:"xvdf",   v:"cbfg",    b:"vngh",
    n:"bmhj",  m:"njk",
  };

  // Weighted Levenshtein: adjacent-key substitution costs 0.5, others cost 1.0
  private editDistance(a: string, b: string): number {
    const subCost = (x: string, y: string): number => {
      if (x === y) return 0;
      const xl = x.toLowerCase(), yl = y.toLowerCase();
      return AishShell.QWERTY[xl]?.includes(yl) ? 0.5 : 1;
    };

    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const curr = [i];
      for (let j = 1; j <= b.length; j++) {
        const cost = subCost(a[i - 1], b[j - 1]);
        curr[j] = cost === 0
          ? prev[j - 1]
          : Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      }
      prev = curr;
    }
    return prev[b.length];
  }

  // Destructive command patterns — warn before running
  private static readonly DESTRUCTIVE = [
    /^rm\s+.*-[a-z]*r/i,   // rm -r, rm -rf, rm -Rf …
    /^rm\s+-[a-z]*f/i,     // rm -f
    /^dd\b/,               // dd
    /^mkfs\b/,             // mkfs
    /^shred\b/,            // shred
    /^truncate\b/,         // truncate
    /^wipefs\b/,           // wipefs
  ];

  private isDestructiveCommand(cmd: string): boolean {
    return AishShell.DESTRUCTIVE.some(r => r.test(cmd.trim()));
  }

  // Get all executable commands from PATH (cached 60s)
  private getPathCommands(): string[] {
    const now = Date.now();
    if (this.pathCommandsCache && now - this.pathCommandsCacheTime < 60_000) {
      return this.pathCommandsCache;
    }
    const cmds = new Set<string>();
    for (const dir of (process.env.PATH ?? "").split(":")) {
      try {
        for (const f of readdirSync(dir)) cmds.add(f);
      } catch { /* skip non-existent dirs */ }
    }
    this.pathCommandsCache = [...cmds];
    this.pathCommandsCacheTime = now;
    return this.pathCommandsCache;
  }

  // Find the closest command in PATH using weighted edit distance.
  // Adjacent-key typos (QWERTY) cost 0.5, so two keyboard-neighbor errors = dist 1.0.
  // Returns the corrected full command string, or null if no close match.
  private findSimilarCommand(input: string): string | null {
    const cmdName = input.trim().split(/\s+/)[0];
    if (!cmdName || cmdName.length < 2) return null;

    // Weighted max distance: same integers as before, but now adjacent-key
    // errors count as 0.5 — effectively catching twice as many keyboard typos.
    const maxDist = cmdName.length <= 3 ? 1 : cmdName.length <= 6 ? 2 : 3;

    let bestCmd: string | null = null;
    let bestDist = Infinity;

    for (const cmd of this.getPathCommands()) {
      // Quick length filter (use integer ceiling of maxDist)
      if (Math.abs(cmd.length - cmdName.length) > maxDist) continue;
      if (cmd === cmdName) continue;

      const d = this.editDistance(cmdName, cmd);
      if (d === 0 || d > maxDist) continue;

      // Prefer: (1) smaller weighted distance, (2) shorter cmd, (3) lex order
      if (d < bestDist || (d === bestDist && cmd.length < (bestCmd?.length ?? Infinity))) {
        bestDist = d;
        bestCmd = cmd;
      }
    }

    if (!bestCmd) return null;

    const rest = input.trim().slice(cmdName.length);
    return bestCmd + rest;
  }

  // Heuristic: does input look like natural language rather than a shell command?
  private looksLikeNaturalLanguage(input: string): boolean {
    // Non-ASCII (Korean, Japanese, etc.) → definitely NL
    if (/[^\x00-\x7F]/.test(input)) return true;
    // Ends with question mark
    if (input.trimEnd().endsWith("?")) return true;
    // 5+ words → sentence-like
    if (input.trim().split(/\s+/).length >= 5) return true;
    // Starts with common English NL verbs/question words
    if (/^(what|why|how|when|where|who|explain|describe|tell|show|is|are|does|do|can|could|would|please)\b/i.test(input)) return true;
    return false;
  }

  private async handleCommandNotFound(input: string): Promise<void> {
    if (this.looksLikeNaturalLanguage(input)) {
      // Clearly natural language → forward to AI silently
      process.stdout.write(dim(t("shell_forwarding_to_ai")));
      await this.handleAIQuery(input);
      return;
    }

    // Try spell correction first
    const corrected = this.findSimilarCommand(input);
    if (corrected) {
      const destructive = this.isDestructiveCommand(corrected);
      if (destructive) {
        process.stdout.write(red(t("shell_irreversible_warning")));
      }
      const cmdDisplay = destructive ? red(bold(corrected)) : bold(corrected);
      const answer = await this.promptLine(
        dim(t("shell_did_you_mean")) + cmdDisplay + dim(t("shell_did_you_mean_suffix"))
      );
      process.stdout.write("\n");

      const choice = answer.trim().toLowerCase();
      if (choice === "a") {
        // Send original input to AI
        process.stdout.write(dim(t("shell_forwarding_to_ai")));
        await this.handleAIQuery(input);
      } else if (choice !== "n") {
        // Y or Enter → run corrected command
        const exitCode = await this.handleShellCommand(corrected);
        if (exitCode === 127) {
          process.stdout.write(dim(t("shell_forwarding_to_ai")));
          await this.handleAIQuery(input);
        }
      }
      // n → cancel silently
      return;
    }

    // No close match → ask whether to send to AI
    const answer = await this.promptLine(dim(t("shell_send_to_ai")));
    process.stdout.write("\n");

    if (answer.trim().toLowerCase() !== "n") {
      await this.handleAIQuery(input);
    }
  }

  // ── cd Handling ──
  private handleCd(input: string): void {
    let target = input.slice(2).trim();

    if (!target || target === "~") {
      target = homedir();
    } else if (target.startsWith("~/")) {
      target = join(homedir(), target.slice(2));
    } else if (target === "-") {
      console.error(red("✗"), "cd - is not supported");
      return;
    }

    const resolved = resolve(this.cwd, target);

    if (!existsSync(resolved)) {
      console.error(red("✗"), `cd: no such directory: ${target}`);
      return;
    }

    try {
      const stat = statSync(resolved);
      if (!stat.isDirectory()) {
        console.error(red("✗"), `cd: not a directory: ${target}`);
        return;
      }
    } catch {
      console.error(red("✗"), `cd: cannot access: ${target}`);
      return;
    }

    this.cwd = resolved;
  }

  // ── AI Query (> query) ──
  private async handleAIQuery(queryText: string): Promise<void> {
    const commandContext = this.buildCommandContext();
    await this.sendToAI(queryText, commandContext);
  }

  // ── Pipe to AI (cmd |> query) ──
  private async handlePipeToAI(input: string): Promise<void> {
    const pipeIdx = input.indexOf("|>");
    const cmd = input.slice(0, pipeIdx).trim();
    const queryText = input.slice(pipeIdx + 2).trim();

    if (!cmd || !queryText) {
      console.error(red("✗"), "Usage: command |> AI query");
      return;
    }

    // Execute command silently (don't print to terminal)
    const output = await this.execSilent(cmd);

    // Use this specific output as context (not the general buffer)
    const truncated = output.length > MAX_CONTEXT_CHARS
      ? output.slice(0, MAX_CONTEXT_CHARS) + "\n...[truncated]"
      : output;

    const commandContext = `$ ${cmd}\n${truncated}`;
    await this.sendToAI(queryText, commandContext);
  }

  // ── Execute command silently (for pipe) ──
  private execSilent(command: string): Promise<string> {
    return new Promise((resolveCmd) => {
      let output = "";

      const child = spawn("sh", ["-c", command], {
        cwd: this.cwd,
        env: { ...process.env, PWD: this.cwd },
        stdio: ["inherit", "pipe", "pipe"],
      });

      this.activeChild = child;

      child.stdout!.on("data", (data: Buffer) => {
        if (output.length < MAX_OUTPUT_CHARS) output += data.toString();
      });

      child.stderr!.on("data", (data: Buffer) => {
        if (output.length < MAX_OUTPUT_CHARS) output += data.toString();
      });

      child.on("close", () => {
        this.activeChild = null;
        resolveCmd(output);
      });

      child.on("error", (err) => {
        this.activeChild = null;
        resolveCmd(`Error: ${err.message}`);
      });
    });
  }

  // ── Send to AI via daemon ──
  private async sendToAI(
    queryText: string,
    commandContext?: string
  ): Promise<void> {
    this.isQuerying = true;

    try {
      await ensureDaemon();
    } catch (err) {
      this.isQuerying = false;
      console.error(
        red("✗"),
        "Daemon unavailable:",
        err instanceof Error ? err.message : String(err)
      );
      return;
    }

    return new Promise((resolveQuery) => {
      const socket = connectToDaemon();
      socket.setTimeout(10000);
      socket.on("timeout", () => socket.destroy(new Error("Daemon timed out")));
      this.activeSocket = socket;

      socket.on("connect", () => {
        sendMessage(socket, {
          type: "query",
          message: queryText,
          cwd: this.cwd,
          commandContext: commandContext || undefined,
        });
      });

      process.stdout.write(magenta("ai> "));

      streamResponses(socket, (msg: DaemonMessage) => {
        switch (msg.type) {
          case "text":
            process.stdout.write(msg.content);
            break;

          case "tool_use":
            process.stderr.write(
              dim(`  [${msg.tool}] `) + dim(msg.input.slice(0, 100)) + "\n"
            );
            break;

          case "tool_result":
            process.stderr.write(dim("  → done\n"));
            break;

          case "status":
            this.printStatus(msg.data);
            break;

          case "info":
            process.stderr.write(green("✓ ") + msg.message + "\n");
            break;

          case "error":
            process.stderr.write(red("✗ ") + msg.message + "\n");
            break;

          case "done":
            process.stdout.write("\n");
            this.activeSocket = null;
            this.isQuerying = false;
            resolveQuery();
            break;
        }
      }).catch(() => {
        this.activeSocket = null;
        this.isQuerying = false;
        resolveQuery();
      });

      socket.on("error", () => {
        this.activeSocket = null;
        this.isQuerying = false;
        console.error(red("✗"), "Connection to daemon lost");
        resolveQuery();
      });
    });
  }

  // ── Meta Commands (--status, --compact, etc.) ──
  private async handleMetaCommand(input: string): Promise<void> {
    const parts = input.split(/\s+/);
    const flag = parts[0];
    const raw = parts.slice(1).join(" ");
    const args = raw.replace(/^["'](.*)["']$/, "$1");

    const commandMap: Record<string, string> = {
      "--status": "status",
      "--compact": "compact",
      "--clear": "clear",
      "--forget": "forget",
      "--stop": "stop",
      "--help": "help",
    };

    const argCommandMap: Record<string, string> = {
      "--topic": "topic",
      "--recall": "recall",
      "--remember": "remember",
    };

    if (flag === "--help") {
      this.printHelp();
      return;
    }

    if (flag === "--lang") {
      const lang = parts[1];
      if (!lang) { console.error(red("✗"), "Usage: --lang <en|ko>"); return; }
      const r = setLang(lang);
      process.stderr.write((r.ok ? green("✓ ") : red("✗ ")) + r.message + "\n");
      return;
    }

    const command = commandMap[flag] ?? argCommandMap[flag];
    if (!command) {
      console.error(red("✗"), `Unknown command: ${flag}`);
      return;
    }

    if (command === "stop") {
      // Send stop, then exit shell
      await this.sendDaemonCommand(command);
      this.rl?.close();
      return;
    }

    const cmdArgs = argCommandMap[flag] ? (args || undefined) : undefined;

    if (argCommandMap[flag] && !args) {
      console.error(red("✗"), `${flag} requires an argument`);
      return;
    }

    await this.sendDaemonCommand(command, cmdArgs);
  }

  private async sendDaemonCommand(
    command: string,
    args?: string
  ): Promise<void> {
    try {
      await ensureDaemon();
    } catch (err) {
      console.error(
        red("✗"),
        "Daemon unavailable:",
        err instanceof Error ? err.message : String(err)
      );
      return;
    }

    return new Promise((resolveCmd) => {
      const socket = connectToDaemon();
      socket.setTimeout(10000);
      socket.on("timeout", () => socket.destroy(new Error("Daemon timed out")));

      socket.on("connect", () => {
        sendMessage(socket, {
          type: "command",
          command: command as "status" | "compact" | "clear" | "forget" | "topic" | "recall" | "remember" | "stop",
          args,
        });
      });

      streamResponses(socket, (msg: DaemonMessage) => {
        switch (msg.type) {
          case "status":
            this.printStatus(msg.data);
            break;
          case "info":
            process.stderr.write(green("✓ ") + msg.message + "\n");
            break;
          case "error":
            process.stderr.write(red("✗ ") + msg.message + "\n");
            break;
          case "done":
            resolveCmd();
            break;
        }
      }).catch(() => {
        resolveCmd();
      });

      socket.on("error", () => {
        console.error(red("✗"), "Connection to daemon lost");
        resolveCmd();
      });
    });
  }

  // ── Output Ring Buffer ──
  private pushOutput(entry: OutputEntry): void {
    this.outputBuffer.push(entry);
    if (this.outputBuffer.length > MAX_OUTPUT_ENTRIES) {
      this.outputBuffer.shift();
    }
  }

  // ── Build Command Context (for AI queries) ──
  private buildCommandContext(): string | undefined {
    if (this.outputBuffer.length === 0) return undefined;

    let context = "";
    let remaining = MAX_CONTEXT_CHARS;

    // Most recent first
    for (let i = this.outputBuffer.length - 1; i >= 0 && remaining > 0; i--) {
      const entry = this.outputBuffer[i];
      const section = `$ ${entry.command}\n${entry.output}\n`;

      if (section.length <= remaining) {
        context = section + context;
        remaining -= section.length;
      } else {
        // Partial fit: truncate this entry
        const truncated = section.slice(0, remaining) + "\n...[truncated]";
        context = truncated + context;
        break;
      }
    }

    return context || undefined;
  }

  // ── Prompt ──
  private buildPrompt(): string {
    const shortCwd = this.cwd.replace(homedir(), "~");
    return `${cyan("aish")} ${dim(shortCwd)} ${dim("$")} `;
  }

  // ── Status Display ──
  private printStatus(data: Record<string, unknown>): void {
    const s = data as Record<string, number | string | null>;
    console.log(bold(t("status_header")));
    console.log(
      `Memory: ${cyan(String(s.memoryTokens ?? 0) + "t")} | ` +
      `Topics: ${cyan(String(s.topicCount ?? 0) + " (" + String(s.topicTokens ?? 0) + "t)")} | ` +
      `Window: ${cyan(String(s.windowTurns ?? 0) + t("status_turns_unit") + " (" + String(s.windowTokens ?? 0) + "t)")}`
    );
    console.log(
      `Budget: ${yellow(String(s.totalTokens ?? 0) + " / " + String(s.budget ?? 3100))} tokens | ` +
      `Session: ${dim(String(s.sessionId ?? "none").slice(0, 8))}`
    );
  }

  // ── Welcome ──
  private printWelcome(): void {
    console.log(bold("aish") + dim(t("welcome_subtitle")));
    console.log(dim(t("welcome_hint")));
    console.log("");
  }

  // ── Help ──
  private printHelp(): void {
    console.log(bold(t("help_header")));
    console.log("");
    console.log(t("help_shell_section"));
    console.log(`  ${cyan("ls -la")}                 ${t("help_run_command")}`);
    console.log(`  ${cyan("cd ~/project")}           ${t("help_change_dir")}`);
    console.log("");
    console.log(t("help_ai_section"));
    console.log(`  ${cyan("> question")}             ${t("help_ai_query")}`);
    console.log(`  ${cyan("cmd |> question")}        ${t("help_ai_pipe")}`);
    console.log("");
    console.log(t("help_daemon_section"));
    console.log(`  ${cyan("--status")}               ${t("help_status")}`);
    console.log(`  ${cyan("--compact")}              ${t("help_compact")}`);
    console.log(`  ${cyan("--clear")}                ${t("help_clear")}`);
    console.log(`  ${cyan("--forget")}               ${t("help_forget")}`);
    console.log(`  ${cyan('--topic "name"')}         ${t("help_topic")}`);
    console.log(`  ${cyan('--recall "name"')}        ${t("help_recall")}`);
    console.log(`  ${cyan('--remember "fact"')}      ${t("help_remember")}`);
    console.log(`  ${cyan("--lang <en|ko>")}         ${t("help_lang")}`);
    console.log(`  ${cyan("--stop")}                 ${t("help_stop")}`);
    console.log("");
    console.log(`  ${cyan("exit")}                   ${t("help_exit")}`);
  }
}

// ── Direct execution (aish bin entry point) ──
if (process.argv[1] &&
    (process.argv[1].endsWith("/shell.js") || process.argv[1].endsWith("/shell.ts"))) {
  const shell = new AishShell();
  shell.start().catch((err) => {
    console.error(red("✗ Fatal:"), err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
