#!/usr/bin/env node

// ── Interactive Shell: terminal commands + AI prompts in one REPL ──

import * as readline from "node:readline";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, statSync } from "node:fs";
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

  constructor(initialCwd?: string) {
    this.cwd = initialCwd ?? process.cwd();
  }

  async start(): Promise<void> {
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
      if (!input) {
        this.rl!.prompt();
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

    // Regular shell command
    await this.handleShellCommand(input);
  }

  // ── Shell Command Execution ──
  private handleShellCommand(command: string): Promise<void> {
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
        output += chunk;
      });

      child.stderr!.on("data", (data: Buffer) => {
        const chunk = data.toString();
        process.stderr.write(chunk);
        output += chunk;
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

        resolveCmd();
      });

      child.on("error", (err) => {
        this.activeChild = null;
        console.error(red("✗"), err.message);
        resolveCmd();
      });
    });
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
        output += data.toString();
      });

      child.stderr!.on("data", (data: Buffer) => {
        output += data.toString();
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
    const args = parts.slice(1).join(" ");

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
    console.log(bold("── aish status ──"));
    console.log(
      `Memory: ${cyan(String(s.memoryTokens ?? 0) + "t")} | ` +
      `Topics: ${cyan(String(s.topicCount ?? 0) + " (" + String(s.topicTokens ?? 0) + "t)")} | ` +
      `Window: ${cyan(String(s.windowTurns ?? 0) + "턴 (" + String(s.windowTokens ?? 0) + "t)")}`
    );
    console.log(
      `Budget: ${yellow(String(s.totalTokens ?? 0) + " / " + String(s.budget ?? 3100))} tokens | ` +
      `Session: ${dim(String(s.sessionId ?? "none").slice(0, 8))}`
    );
  }

  // ── Welcome ──
  private printWelcome(): void {
    console.log(bold("aish") + dim(" — Interactive Shell + AI"));
    console.log(dim("Commands: > AI query | cmd |> AI pipe | --status | --help | exit"));
    console.log("");
  }

  // ── Help ──
  private printHelp(): void {
    console.log(bold("── aish Interactive Shell ──"));
    console.log("");
    console.log("Shell Commands:");
    console.log(`  ${cyan("ls -la")}                 Run any shell command`);
    console.log(`  ${cyan("cd ~/project")}           Change directory`);
    console.log("");
    console.log("AI Commands:");
    console.log(`  ${cyan("> question")}             AI에게 질문 (최근 출력이 자동 컨텍스트)`);
    console.log(`  ${cyan("cmd |> question")}        명령 결과를 AI에 파이프`);
    console.log("");
    console.log("Daemon Commands:");
    console.log(`  ${cyan("--status")}               컨텍스트 상태`);
    console.log(`  ${cyan("--compact")}              윈도우 요약`);
    console.log(`  ${cyan("--clear")}                윈도우 초기화`);
    console.log(`  ${cyan("--forget")}               전체 초기화`);
    console.log(`  ${cyan('--topic "name"')}         주제 전환`);
    console.log(`  ${cyan('--recall "name"')}        주제 복원`);
    console.log(`  ${cyan('--remember "fact"')}      메모리 저장`);
    console.log(`  ${cyan("--stop")}                 데몬 종료`);
    console.log("");
    console.log(`  ${cyan("exit")}                   Shell 종료`);
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
