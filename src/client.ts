#!/usr/bin/env node

import { type Socket } from "node:net";
import {
  type ClientMessage,
  type DaemonMessage,
} from "./protocol.js";
import {
  ensureDaemon,
  isDaemonRunning,
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

// ── Read stdin (for pipe support) ──
function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    const timeout = setTimeout(() => {
      process.stdin.removeAllListeners();
      resolve(data);
    }, 500);

    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      clearTimeout(timeout);
      resolve(data.trim());
    });
    process.stdin.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    process.stdin.resume();
  });
}

// ── Parse CLI ──
function parseArgs(argv: string[]): {
  command: string | null;
  commandArg: string | null;
  message: string | null;
} {
  const args = argv.slice(2);

  if (args.length === 0) {
    return { command: null, commandArg: null, message: null };
  }

  const first = args[0];

  const commandMap: Record<string, string> = {
    "--status": "status",
    "--compact": "compact",
    "--clear": "clear",
    "--forget": "forget",
    "--stop": "stop",
    "--start": "start",
    "--help": "help",
  };

  if (first in commandMap) {
    return {
      command: commandMap[first],
      commandArg: null,
      message: null,
    };
  }

  const argCommandMap: Record<string, string> = {
    "--topic": "topic",
    "--recall": "recall",
    "--remember": "remember",
  };

  if (first in argCommandMap) {
    return {
      command: argCommandMap[first],
      commandArg: args.slice(1).join(" ") || null,
      message: null,
    };
  }

  return { command: null, commandArg: null, message: args.join(" ") };
}

// ── Send Message and Stream Response ──
function sendAndReceive(msg: ClientMessage): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const socket: Socket = connectToDaemon();

    socket.on("connect", () => {
      sendMessage(socket, msg);
    });

    streamResponses(socket, (dmsg) => {
      handleDaemonMessage(dmsg, socket, resolvePromise);
    }).catch(reject);
  });
}

function handleDaemonMessage(
  msg: DaemonMessage,
  _socket: Socket,
  done: () => void
): void {
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
      printStatus(msg.data);
      break;

    case "info":
      process.stderr.write(green("✓ ") + msg.message + "\n");
      break;

    case "error":
      process.stderr.write(red("✗ ") + msg.message + "\n");
      break;

    case "done":
      process.stdout.write("\n");
      done();
      break;
  }
}

function printStatus(data: Record<string, unknown>): void {
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

function printHelp(): void {
  console.log(bold("aish — Claude Shell"));
  console.log("");
  console.log("Usage:");
  console.log(`  ${cyan("aish [message]")}             AI에게 메시지 (one-shot)`);
  console.log(`  ${cyan("aish")}                       Interactive Shell 진입`);
  console.log(`  ${cyan("aish --status")}              컨텍스트 상태`);
  console.log(`  ${cyan("aish --compact")}             윈도우 강제 요약`);
  console.log(`  ${cyan("aish --clear")}               윈도우 초기화 (Memory 유지)`);
  console.log(`  ${cyan("aish --forget")}              전체 초기화`);
  console.log(`  ${cyan('aish --topic "name"')}        주제 전환`);
  console.log(`  ${cyan('aish --recall "name"')}       이전 주제 복원`);
  console.log(`  ${cyan('aish --remember "fact"')}     메모리에 저장`);
  console.log(`  ${cyan("aish --start")}               daemon 시작`);
  console.log(`  ${cyan("aish --stop")}                daemon 종료`);
}

// ── Main ──
async function main(): Promise<void> {
  const { command, commandArg, message } = parseArgs(process.argv);

  // Help
  if (command === "help") {
    printHelp();
    return;
  }

  // Start daemon explicitly
  if (command === "start") {
    if (isDaemonRunning()) {
      console.log(dim("Daemon already running."));
    } else {
      await ensureDaemon();
    }
    return;
  }

  // No input — launch interactive shell
  if (!command && !message) {
    const { AishShell } = await import("./shell.js");
    const shell = new AishShell();
    await shell.start();
    return;
  }

  // Ensure daemon is running
  try {
    await ensureDaemon();
  } catch (err) {
    console.error(
      red("✗"),
      "Failed to connect to daemon:",
      err instanceof Error ? err.message : String(err)
    );
    process.exit(1);
  }

  // Send command or query
  try {
    if (command && command !== "start") {
      await sendAndReceive({
        type: "command",
        command: command as "status" | "compact" | "clear" | "forget" | "topic" | "recall" | "remember" | "stop",
        args: commandArg ?? undefined,
      });
    } else if (message) {
      let fullMessage = message;
      if (!process.stdin.isTTY) {
        try {
          const stdinData = await readStdin();
          if (stdinData) {
            fullMessage = stdinData + "\n\n" + message;
          }
        } catch {
          // no stdin pipe, continue with just args
        }
      }

      await sendAndReceive({
        type: "query",
        message: fullMessage,
        cwd: process.cwd(),
      });
    }
  } catch (err) {
    console.error(
      red("✗"),
      err instanceof Error ? err.message : String(err)
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(red("✗ Fatal:"), err.message);
  process.exit(1);
});
