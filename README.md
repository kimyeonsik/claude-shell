# Claude Shell (aish)

A unified terminal shell that blends regular commands and Claude AI conversations in a single REPL. Built on the [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk).

## Features

- **Interactive REPL** — Run terminal commands and talk to Claude in one place
- **AI Query Prefix** — `> question` sends a question to Claude from within the shell
- **Pipe to AI** — `cmd |> question` runs a command and sends its output to Claude
- **Smart Command-Not-Found** — Typo correction with QWERTY-weighted edit distance; natural language auto-forwarded to AI
- **Output Ring Buffer** — Last 5 command outputs (up to 3000 chars each) are automatically available as AI context
- **4-Layer Context** — Persistent memory, topic summaries, conversation window, and live shell state
- **Token Efficient** — Command outputs are ephemeral; they don't consume your conversation window
- **Persistent Daemon** — Background Unix socket server keeps context alive across queries
- **Conversation Continuity** — Sessions persist on disk; `continue: true` resumes where you left off
- **Server-Side Caching** — System prompt (~20K tokens) cached at 0.1x price; ~78% cheaper over a conversation
- **One-Shot Mode** — `ai "question"` or `cmd | ai "question"` from any zsh prompt

## Quick Start

```bash
git clone https://github.com/cosmicbuffalo/claude-shell.git
cd claude-shell
./install.sh
source ~/.zshrc
```

**Prerequisites**: Node.js 18+, [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed

## Usage

### Interactive Shell (aish)

```bash
aish                              # Enter interactive REPL
```

Inside the shell:

```
aish ~/project $ ls -la                    # Run any shell command
aish ~/project $ > explain this output     # Ask AI (recent output auto-included)
aish ~/project $ git diff |> review this   # Pipe command output to AI
aish ~/project $ cd src                    # Change directory (~/expanded, errors handled)
aish ~/project $ --status                  # Check context status
aish ~/project $ --help                    # Show help
aish ~/project $ exit                      # Exit
```

### One-Shot Mode

```bash
ai "explain this project"         # Single query
git diff | ai "review this"       # Pipe stdin to AI
ai 이게 왜 안 되나요?              # Korean/non-ASCII auto-forwarded (noglob applied)
```

### Context Management

The same flags work in both `aish` (with `--` prefix) and as `ai` commands:

```bash
ai --status                       # Show context budget and token usage
ai --compact                      # Compress conversation window to topic summary
ai --clear                        # Clear conversation window (memory preserved)
ai --forget                       # Clear all context (memory + topics + window)
ai --topic "auth work"            # Switch to a named topic (saves current)
ai --recall "auth work"           # Restore a previously saved topic
ai --remember "uses PostgreSQL"   # Save a fact to persistent memory
```

### Daemon Control

```bash
ai --start                        # Start daemon manually
ai --stop                         # Stop daemon
```

## Smart Command-Not-Found

When a command exits with code 127 (not found), aish applies a multi-step fallback:

**Natural language detection** — forwarded to AI silently:
- Non-ASCII input (Korean, Japanese, etc.)
- Input ending with `?`
- 5 or more words
- Starts with common English natural-language verbs (`explain`, `how`, `what`, `show`, etc.)

**Typo correction** — QWERTY-weighted Levenshtein distance finds close matches in PATH:
- Adjacent keys on a QWERTY keyboard cost 0.5 (vs. 1.0 for other substitutions)
- Offers a three-way choice: `[Y=run / n=cancel / a=AI]`
- Destructive commands (`rm -rf`, `dd`, `mkfs`, etc.) shown with a red warning

**Unknown command** — if no close match found, asks `[Y/n]` to forward to AI.

```
aish ~/project $ gti status
  혹시 git status인가요? [Y=실행 / n=취소 / a=AI]
```

```
aish ~/project $ rm -rdf /tmp/test
  ⚠  되돌릴 수 없는 명령입니다!
  혹시 rm -rdf /tmp/test인가요? [Y=실행 / n=취소 / a=AI]
```

## Ctrl+C Behavior

| Situation | Effect |
|-----------|--------|
| Shell command running | Sends SIGINT to the child process |
| AI query in progress | Cancels the query (aborts the daemon connection) |
| Idle / empty line | Clears the current line, re-shows prompt |

## Architecture

```
┌──────────────────────────────────────────┐
│  Interactive Shell (shell.ts)             │  REPL with command capture
│  - readline interface                     │
│  - output ring buffer (5 entries×3000ch) │
│  - > prefix → AI query                   │
│  - cmd |> query → pipe to AI             │
│  - QWERTY-weighted typo correction       │
│  - natural language auto-detection       │
└───────────┬──────────────────────────────┘
            │ Unix Socket  (JSON protocol)
┌───────────┴──────────────────────────────┐
│  Daemon (daemon.ts)                       │  Persistent background process
│  - Claude Agent SDK integration           │
│  - 4-layer context management             │
│  - Memory extraction (claude-haiku)       │
│  - continue: true session resume          │
│  - PID file + stale socket cleanup        │
└──────────────────────────────────────────┘
            ↑
┌───────────┴──────────────────────────────┐
│  zsh integration (shell/ai.zsh)           │  One-shot mode
│  - ai alias (noglob wrapper)              │
│  - shell state tracking (preexec/precmd)  │
│  - zsh tab completions                    │
└──────────────────────────────────────────┘
```

### 4-Layer Context System

| Layer | Purpose | Budget |
|-------|---------|--------|
| L0: Memory | Persistent facts (project info, conventions, decisions) | ~200 tokens |
| L1: Topics | Summarized past conversations (named topics) | ~300 tokens |
| L2: Window | Recent conversation turns | ~2500 tokens |
| L3: Shell | Current cwd + recent command history | ~100 tokens |

Total budget: ~3100 tokens — enough for meaningful conversations while staying fast and cheap.

### Token Efficiency: Ephemeral Command Output

Command outputs are injected at query time but never stored in the conversation window:

```
Shell command runs → output ring buffer (max 5 entries, 3000 chars each)
                          ↓
AI query → buildCommandContext() → up to 4000 chars combined
                          ↓
Daemon → appended to system prompt as [Recent Command Output] (ephemeral)
                          ↓
After response → window stores question + answer text only
                          ↓
                          Command output = 0 window tokens
```

### Session Continuity

aish uses the Agent SDK's `continue: true` option to resume the most recent Claude Code session for the current directory. Sessions are saved to disk (`~/.claude/projects/`) and survive daemon restarts.

```
Query 1 → fresh session created, claude_code preset (~20K tokens) cached
Query 2 → continue: true → same session loaded from disk
          input_tokens:       3   (only the new user message)
          cache_read_tokens:  ~20,000  (at 0.1× price)
```

The large system prompt is charged once (at 1.25x creation price), then served from cache at 0.1x on every subsequent query — roughly **78% cheaper** over a 10-turn conversation.

Context resets (`--clear`, `--compact`, `--forget`, `--topic`) start a fresh session automatically.

**Authentication**: OAuth via your Claude Code subscription — no API key required.

### Memory Extraction

After every few turns, aish runs a background Claude Haiku agent on the most recent AI response to extract facts worth keeping: project tech stack, coding conventions, and architectural decisions. Extracted facts are merged into L0 Memory and persist across sessions.

### zsh Integration Details

`shell/ai.zsh` hooks into zsh via `preexec` / `precmd` to write a state file with the current directory and recent command history. This gives the AI context about what you've been doing even in one-shot mode.

The `ai` alias wraps `_ai_impl` with `noglob`, which prevents zsh from expanding glob characters (`?`, `*`, `[]`) before the message reaches the client — so `ai 안 되나?` works as expected without quoting.

Tab completion is provided for all `--` flags.

## Project Structure

```
src/
├── shell.ts          # Interactive REPL (AishShell class)
├── client.ts         # CLI entry point (one-shot + shell launcher)
├── daemon.ts         # Background daemon with Agent SDK
├── connection.ts     # Shared daemon connection utilities
├── protocol.ts       # IPC message types (JSON over Unix socket)
├── types.ts          # Shared types and constants
└── context/
    ├── manager.ts    # Context orchestration
    ├── memory.ts     # Persistent memory (L0)
    ├── topic.ts      # Topic management (L1)
    ├── window.ts     # Conversation window (L2)
    ├── shell.ts      # Shell state tracking (L3)
    └── tokens.ts     # Multilingual token estimation

shell/
└── ai.zsh            # zsh integration: ai alias, shell state, completions
```

## Uninstall

```bash
./uninstall.sh
```

## License

MIT
