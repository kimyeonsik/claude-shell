// ── IPC Protocol: client ↔ daemon ──

export type ClientMessage =
  | { type: "query"; message: string; cwd: string; commandContext?: string }
  | { type: "command"; command: CommandType; args?: string }
  | { type: "ping" };

export type CommandType =
  | "status"
  | "compact"
  | "clear"
  | "forget"
  | "topic"
  | "recall"
  | "remember"
  | "stop";

export type DaemonMessage =
  | { type: "text"; content: string }
  | { type: "tool_use"; tool: string; input: string }
  | { type: "tool_result"; output: string }
  | { type: "status"; data: Record<string, unknown> }
  | { type: "info"; message: string }
  | { type: "error"; message: string }
  | { type: "done" };

// Newline-delimited JSON over Unix socket
export function serialize(msg: ClientMessage | DaemonMessage): string {
  return JSON.stringify(msg) + "\n";
}

export function deserialize(line: string): ClientMessage | DaemonMessage {
  return JSON.parse(line.trim());
}

// Parse a stream buffer into complete messages, returning remainder
export function parseBuffer(buffer: string): {
  messages: (ClientMessage | DaemonMessage)[];
  remainder: string;
} {
  const messages: (ClientMessage | DaemonMessage)[] = [];
  const lines = buffer.split("\n");
  const remainder = lines.pop() ?? "";

  for (const line of lines) {
    if (line.trim()) {
      try {
        messages.push(JSON.parse(line.trim()));
      } catch {
        // skip malformed lines
      }
    }
  }

  return { messages, remainder };
}
