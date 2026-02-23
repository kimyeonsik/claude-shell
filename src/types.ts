// ── Shared Types ──

export interface ShellState {
  cwd: string;
  lastCommands: string[];
  lastExitCode: number;
  lastOutputPreview: string;
}

export interface Turn {
  role: "user" | "assistant";
  content: string;
  ts: number;
  tokens?: number;
}

export interface Topic {
  name: string;
  summary: string;
  ts: number;
  tokens: number;
}

export interface MemoryStore {
  project: Record<string, string>;
  conventions: string[];
  decisions: string[];
  recentWork: string[];
}

export interface ContextBudget {
  total: number;
  memory: number;
  topics: number;
  window: number;
  shell: number;
}

export const DEFAULT_BUDGET: ContextBudget = {
  total: 3100,
  memory: 200,
  topics: 300,
  window: 2500,
  shell: 100,
};

export interface ContextResult {
  systemPrompt: string;
  needsNewSession: boolean;
}

export interface DaemonStatus {
  sessionId: string | null;
  windowTurns: number;
  topicCount: number;
  memoryTokens: number;
  topicTokens: number;
  windowTokens: number;
  shellTokens: number;
  totalTokens: number;
  budget: number;
}

import { homedir } from "node:os";

export const CONFIG_DIR =
  process.env.CLAUDE_SHELL_CONFIG_DIR ||
  `${homedir()}/.config/claude-shell`;

export const SOCKET_PATH = `${CONFIG_DIR}/daemon.sock`;
export const MEMORY_PATH = `${CONFIG_DIR}/memory.json`;
export const TOPICS_PATH = `${CONFIG_DIR}/topics.json`;
export const SHELL_STATE_PATH = `${CONFIG_DIR}/shell-state.json`;
export const LANG_PATH = `${CONFIG_DIR}/lang`;

export const MAX_TOPICS = 10;
export const MEMORY_EXTRACT_INTERVAL = 5;
