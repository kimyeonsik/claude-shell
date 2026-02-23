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
import { t, loadLang, setLang } from "./i18n.js";

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
    "--lang": "lang",
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

function printHelp(): void {
  console.log(bold(t("client_help_title")));
  console.log("");
  console.log(t("client_help_usage"));
  console.log(`  ${cyan("aish [message]")}             ${t("client_oneshot")}`);
  console.log(`  ${cyan("aish")}                       ${t("client_interactive")}`);
  console.log(`  ${cyan("aish --status")}              ${t("client_status")}`);
  console.log(`  ${cyan("aish --compact")}             ${t("client_compact")}`);
  console.log(`  ${cyan("aish --clear")}               ${t("client_clear")}`);
  console.log(`  ${cyan("aish --forget")}              ${t("client_forget")}`);
  console.log(`  ${cyan('aish --topic "name"')}        ${t("client_topic")}`);
  console.log(`  ${cyan('aish --recall "name"')}       ${t("client_recall")}`);
  console.log(`  ${cyan('aish --remember "fact"')}     ${t("client_remember")}`);
  console.log(`  ${cyan("aish --start")}               ${t("client_start")}`);
  console.log(`  ${cyan("aish --stop")}                ${t("client_stop")}`);
  console.log(`  ${cyan("aish --lang <en|ko>")}        ${t("client_lang")}`);
}

// ── Main ──
async function main(): Promise<void> {
  loadLang();
  const { command, commandArg, message } = parseArgs(process.argv);

  // Help
  if (command === "help") {
    printHelp();
    return;
  }

  // Language change
  if (command === "lang") {
    const r = setLang(commandArg ?? "");
    process.stdout.write((r.ok ? green("✓ ") : red("✗ ")) + r.message + "\n");
    if (!r.ok) process.exit(1);
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
