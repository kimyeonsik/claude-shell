export const en = {
  // connection.ts
  conn_starting_daemon: "Starting daemon...",
  conn_daemon_ready:    "Daemon ready.",
  // shell.ts — handleCommandNotFound
  shell_forwarding_to_ai:     "  → Forwarding to AI.\n",
  shell_irreversible_warning: "  ⚠  Irreversible command!\n",
  shell_did_you_mean:         "  Did you mean ",
  shell_did_you_mean_suffix:  "? [Y=run / n=cancel / a=AI] ",
  shell_send_to_ai:           "  Send to AI? [Y/n] ",
  // shell.ts — printStatus
  status_header:     "── aish status ──",
  status_turns_unit: "turns",
  // shell.ts — printWelcome
  welcome_subtitle: " — Interactive Shell + AI",
  welcome_hint:     "Commands: > AI query | cmd |> AI pipe | --status | --help | exit",
  // shell.ts — printHelp
  help_header:         "── aish Interactive Shell ──",
  help_shell_section:  "Shell Commands:",
  help_run_command:    "Run any shell command",
  help_change_dir:     "Change directory",
  help_ai_section:     "AI Commands:",
  help_ai_query:       "Ask AI (recent output auto-attached as context)",
  help_ai_pipe:        "Pipe command result to AI",
  help_daemon_section: "Daemon Commands:",
  help_status:         "Context status",
  help_compact:        "Compact window to topic",
  help_clear:          "Clear window",
  help_forget:         "Clear all context",
  help_topic:          "Switch topic",
  help_recall:         "Restore previous topic",
  help_remember:       "Save to memory",
  help_lang:           "Change language (en/ko)",
  help_stop:           "Stop daemon",
  help_exit:           "Exit shell",
  // client.ts — printHelp
  client_help_title:   "aish — Claude Shell",
  client_help_usage:   "Usage:",
  client_oneshot:      "Send message to AI (one-shot)",
  client_interactive:  "Enter interactive shell",
  client_status:       "Context status",
  client_compact:      "Force window compact",
  client_clear:        "Clear window (keep memory)",
  client_forget:       "Clear all context",
  client_topic:        "Switch topic",
  client_recall:       "Restore previous topic",
  client_remember:     "Save to memory",
  client_start:        "Start daemon",
  client_stop:         "Stop daemon",
  client_lang:         "Change language (en/ko)",
  // lang messages
  lang_set_to:    "Language set to",
  lang_unknown:   "Unknown language",
  lang_available: "Available",
} as const;

export type Translations = { [K in keyof typeof en]: string };
