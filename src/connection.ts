// ── Daemon Connection Utilities (shared by client.ts & shell.ts) ──

import { connect, type Socket } from "node:net";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import {
  type ClientMessage,
  type DaemonMessage,
  serialize,
  parseBuffer,
} from "./protocol.js";
import { SOCKET_PATH, CONFIG_DIR } from "./types.js";

const PID_PATH = `${CONFIG_DIR}/daemon.pid`;

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function isDaemonRunning(): boolean {
  if (!existsSync(SOCKET_PATH)) return false;

  if (existsSync(PID_PATH)) {
    try {
      const pid = parseInt(readFileSync(PID_PATH, "utf-8").trim(), 10);
      if (!isNaN(pid) && isProcessAlive(pid)) {
        return true;
      }
      try { unlinkSync(SOCKET_PATH); } catch {}
      try { unlinkSync(PID_PATH); } catch {}
      return false;
    } catch {
      // Can't read PID file — try socket anyway
    }
  }

  return true;
}

export function startDaemon(): Promise<void> {
  return new Promise((resolve, reject) => {
    const daemonPath = new URL("./daemon.js", import.meta.url).pathname;

    // Strip CLAUDECODE env so daemon's Agent SDK doesn't reject as nested session
    const env = { ...process.env };
    delete env.CLAUDECODE;

    const child = spawn(process.execPath, [daemonPath], {
      detached: true,
      stdio: "ignore",
      env,
    });

    child.unref();

    let attempts = 0;
    const check = setInterval(() => {
      attempts++;
      if (existsSync(SOCKET_PATH)) {
        clearInterval(check);
        resolve();
      } else if (attempts > 30) {
        clearInterval(check);
        reject(new Error("Daemon failed to start within 3s"));
      }
    }, 100);
  });
}

export async function ensureDaemon(): Promise<void> {
  if (!isDaemonRunning()) {
    process.stderr.write(dim("Starting daemon...\n"));
    await startDaemon();
    process.stderr.write(dim("Daemon ready.\n"));
  }
}

export function connectToDaemon(): Socket {
  return connect(SOCKET_PATH);
}

export function sendMessage(socket: Socket, msg: ClientMessage): void {
  socket.write(serialize(msg));
}

export type MessageHandler = (msg: DaemonMessage) => void;

export function streamResponses(
  socket: Socket,
  handler: MessageHandler
): Promise<void> {
  return new Promise((resolve, reject) => {
    let buffer = "";

    socket.on("data", (data) => {
      buffer += data.toString();
      const { messages, remainder } = parseBuffer(buffer);
      buffer = remainder;

      for (const raw of messages) {
        const dmsg = raw as DaemonMessage;
        handler(dmsg);
        if (dmsg.type === "done") {
          socket.end();
          resolve();
        }
      }
    });

    socket.on("error", (err) => {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ECONNREFUSED" || code === "ENOENT") {
        reject(new Error("Daemon not running"));
      } else {
        reject(err);
      }
    });

    socket.on("close", () => {
      resolve();
    });
  });
}
