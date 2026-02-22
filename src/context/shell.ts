import { readFileSync, existsSync } from "node:fs";
import { ShellState, SHELL_STATE_PATH } from "../types.js";
import { estimateTokens } from "./tokens.js";

const DEFAULT_STATE: ShellState = {
  cwd: process.cwd(),
  lastCommands: [],
  lastExitCode: 0,
  lastOutputPreview: "",
};

export class ShellContext {
  private path: string;

  constructor(path: string = SHELL_STATE_PATH) {
    this.path = path;
  }

  read(): ShellState {
    try {
      if (existsSync(this.path)) {
        const raw = JSON.parse(readFileSync(this.path, "utf-8"));
        return {
          cwd: raw.cwd ?? DEFAULT_STATE.cwd,
          lastCommands: raw.last_commands ?? raw.lastCommands ?? [],
          lastExitCode: raw.last_exit_code ?? raw.lastExitCode ?? 0,
          lastOutputPreview:
            raw.last_output_preview ?? raw.lastOutputPreview ?? "",
        };
      }
    } catch {
      // file missing or corrupt
    }
    return { ...DEFAULT_STATE };
  }

  buildPrompt(overrideCwd?: string): string {
    const state = this.read();
    const cwd = overrideCwd ?? state.cwd;
    const parts: string[] = [`cwd: ${cwd}`];

    if (state.lastCommands.length > 0) {
      const cmds = state.lastCommands.slice(-5);
      parts.push("recent: " + cmds.join(" | "));
    }

    if (state.lastExitCode !== 0) {
      parts.push(`last exit: ${state.lastExitCode}`);
    }

    if (state.lastOutputPreview) {
      parts.push(`output: ${state.lastOutputPreview.slice(0, 200)}`);
    }

    return parts.join("\n");
  }

  estimateTokens(overrideCwd?: string): number {
    return estimateTokens(this.buildPrompt(overrideCwd));
  }
}
