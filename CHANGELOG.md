# Changelog

## [0.1.0] - 2026-02-22

### Added

- **Interactive Shell** (`aish`) — Unified REPL combining terminal commands and AI conversations
  - `>` prefix for AI queries with automatic command output context
  - `|>` operator to pipe command results directly to AI
  - `cd` with local directory tracking
  - Ctrl+C signal handling (cancel commands, queries, or clear line)
  - Output ring buffer (5 entries, 3000 chars each) for context building
- **One-Shot CLI** (`ai "query"`) — Single query mode via zsh integration
- **Persistent Daemon** — Background Node.js process with session management
  - Claude Agent SDK integration
  - Automatic daemon start on first query
  - PID-based stale socket detection
- **4-Layer Context System**
  - L0 Memory: Persistent facts extracted by Haiku agent every 5 turns
  - L1 Topics: Named conversation summaries with save/recall
  - L2 Window: Sliding conversation window with auto-eviction (~2500 token budget)
  - L3 Shell: Real-time shell state (cwd, recent commands, exit codes)
- **Token Efficiency** — Command outputs are ephemeral (injected at query time, not stored in window)
- **Multilingual Token Estimation** — Accurate counting for English, Korean, CJK, Japanese
- **Context Commands** — `--status`, `--compact`, `--clear`, `--forget`, `--topic`, `--recall`, `--remember`
- **Pipe Support** — `git diff | ai "review"` via stdin pipe in one-shot mode
- **Zsh Integration** — `ai` function, tab completions, shell state tracking hooks
- **Install/Uninstall Scripts** — Automated setup with `install.sh` and `uninstall.sh`
