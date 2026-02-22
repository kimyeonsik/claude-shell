# Claude Shell (aish)

A unified terminal shell that blends regular commands and Claude AI conversations in a single REPL. Built on the [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk).

## Features

- **Interactive Shell** — Run terminal commands and ask Claude in one place
- **Command Context** — Recent command outputs are automatically available as AI context
- **Pipe to AI** — `git diff |> review this` sends command output directly to Claude
- **4-Layer Context** — Memory, topics, conversation window, and shell state
- **Token Efficient** — Command outputs are ephemeral; they don't consume your conversation window
- **Persistent Daemon** — Background process keeps context alive across queries

## Quick Start

```bash
git clone https://github.com/cosmicbuffalo/claude-shell.git
cd claude-shell
./install.sh
source ~/.zshrc
```

**Prerequisites**: Node.js 18+, [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed

## Usage

### Interactive Shell (recommended)

```bash
aish                              # Enter interactive REPL
```

Inside the shell:

```
aish ~/project $ ls -la           # Run any shell command
aish ~/project $ > explain this   # Ask AI (recent output is auto-context)
aish ~/project $ git diff |> review this   # Pipe command output to AI
aish ~/project $ cd src           # Change directory
aish ~/project $ --status         # Check context status
aish ~/project $ exit             # Exit
```

### One-Shot Mode

```bash
ai "explain this project"         # Single query via zsh integration
git diff | ai "review this"       # Pipe support
```

### Context Management

```bash
ai --status                       # Show context budget and usage
ai --compact                      # Compress conversation to topic summary
ai --clear                        # Clear conversation window (memory preserved)
ai --forget                       # Clear all context
ai --topic "auth work"            # Switch to a new topic
ai --recall "auth work"           # Restore a previous topic
ai --remember "uses PostgreSQL"   # Save a fact to persistent memory
```

### Daemon Control

```bash
ai --start                        # Start daemon manually
ai --stop                         # Stop daemon
```

## Architecture

```
┌──────────────────────────────────┐
│  Interactive Shell (shell.ts)     │  REPL with command capture
│  - readline interface             │
│  - output ring buffer (5 entries) │
│  - > prefix → AI query            │
│  - |> operator → pipe to AI       │
└───────────┬──────────────────────┘
            │ Unix Socket (JSON protocol)
┌───────────┴──────────────────────┐
│  Daemon (daemon.ts)               │  Persistent background process
│  - Claude Agent SDK integration   │
│  - 4-layer context management     │
│  - Memory extraction (Haiku)      │
│  - Session resume                 │
└──────────────────────────────────┘
```

### 4-Layer Context System

| Layer | Purpose | Budget |
|-------|---------|--------|
| L0: Memory | Persistent facts (project info, conventions) | ~200 tokens |
| L1: Topics | Summarized past conversations | ~300 tokens |
| L2: Window | Recent conversation turns | ~2500 tokens |
| L3: Shell | Current shell state (cwd, recent commands) | ~100 tokens |

Total budget: ~3100 tokens — enough for meaningful conversations while staying fast and cheap.

### Token Efficiency

Command outputs are **ephemeral** — they're injected into the system prompt at query time but never stored in the conversation window:

```
Command output → outputBuffer (in-memory, max 5 entries, 3000 chars each)
                    ↓
AI query → buildCommandContext() → max 4000 chars combined
                    ↓
Daemon → system prompt [Recent Command Output] section (ephemeral)
                    ↓
After response → window stores only question + answer text
                    ↓
                    Command output = 0 window tokens
```

## Project Structure

```
src/
├── shell.ts          # Interactive REPL
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
```

## Uninstall

```bash
./uninstall.sh
```

## License

MIT
