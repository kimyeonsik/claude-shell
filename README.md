# Claude Shell (aish)

A unified terminal shell that blends regular commands and Claude AI conversations in a single REPL. Built on the [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk).

[English](#english) · [한국어](#한국어)

---

<a name="english"></a>

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
- **i18n** — English and Korean UI, switchable at any time with `--lang`

## Quick Start

```bash
git clone https://github.com/cosmicbuffalo/claude-shell.git
cd claude-shell
./install.sh
source ~/.zshrc
```

The installer prompts you to choose a language (English or Korean) during setup.

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

### Language

```bash
aish --lang ko                    # Switch to Korean
aish --lang en                    # Switch to English
```

Or from within the interactive shell:

```
aish ~/project $ --lang ko
```

The chosen language is saved to `~/.config/claude-shell/lang` and persists across sessions.

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
# English (default)
aish ~/project $ gti status
  Did you mean git status? [Y=run / n=cancel / a=AI]

# Korean (--lang ko)
aish ~/project $ gti status
  혹시 git status인가요? [Y=실행 / n=취소 / a=AI]
```

```
# English
aish ~/project $ rm -rdf /tmp/test
  ⚠  Irreversible command!
  Did you mean rm -rdf /tmp/test? [Y=run / n=cancel / a=AI]

# Korean
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
├── i18n.ts           # i18n singleton (loadLang / setLang / t)
├── locales/
│   ├── en.ts         # English strings (source of truth + Translations type)
│   ├── ko.ts         # Korean strings
│   └── index.ts      # Re-exports + SUPPORTED_LANGS / Lang type
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

---

<a name="한국어"></a>

# Claude Shell (aish) — 한국어

일반 터미널 명령어와 Claude AI 대화를 하나의 REPL에서 사용할 수 있는 통합 셸입니다. [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk) 기반으로 동작합니다.

## 주요 기능

- **대화형 REPL** — 터미널 명령어와 Claude 대화를 한 곳에서
- **AI 질문 접두어** — `> 질문` 으로 셸 내에서 Claude에게 질문
- **AI 파이프** — `명령어 |> 질문` 으로 명령 출력을 AI에 전달
- **스마트 명령어 미인식 처리** — QWERTY 가중 편집 거리 오타 교정, 자연어는 AI에 자동 전달
- **출력 링 버퍼** — 최근 명령어 출력 5개(최대 3000자)가 AI 컨텍스트로 자동 제공
- **4계층 컨텍스트** — 영구 메모리, 주제 요약, 대화 윈도우, 실시간 셸 상태
- **토큰 효율** — 명령 출력은 임시 처리(대화 윈도우 토큰 미소비)
- **영구 데몬** — 백그라운드 Unix 소켓 서버가 쿼리 간 컨텍스트 유지
- **대화 연속성** — 세션을 디스크에 저장, `continue: true`로 이어서 진행
- **서버 측 캐싱** — 시스템 프롬프트(~20K 토큰)를 0.1x 가격으로 캐시, 대화당 ~78% 절약
- **원샷 모드** — zsh 프롬프트 어디서든 `ai "질문"` 또는 `명령어 | ai "질문"`
- **다국어(i18n)** — 영어/한국어 UI, `--lang`으로 언제든 전환

## 빠른 시작

```bash
git clone https://github.com/cosmicbuffalo/claude-shell.git
cd claude-shell
./install.sh
source ~/.zshrc
```

설치 시 언어를 선택할 수 있습니다(영어/한국어). 설치 후에도 `--lang`으로 변경 가능합니다.

**필수 조건**: Node.js 18+, [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 설치

## 사용법

### 대화형 셸 (aish)

```bash
aish                              # 대화형 REPL 진입
```

셸 내부 사용:

```
aish ~/project $ ls -la                    # 셸 명령어 실행
aish ~/project $ > 이 출력 설명해줘        # AI에게 질문 (최근 출력 자동 포함)
aish ~/project $ git diff |> 리뷰해줘      # 명령 출력을 AI에 파이프
aish ~/project $ cd src                    # 디렉토리 이동
aish ~/project $ --status                  # 컨텍스트 상태 확인
aish ~/project $ --help                    # 도움말
aish ~/project $ exit                      # 종료
```

### 언어 전환

```bash
aish --lang ko          # 한국어로 전환
aish --lang en          # 영어로 전환
```

셸 내부에서도 전환 가능:

```
aish ~/project $ --lang en
```

선택한 언어는 `~/.config/claude-shell/lang`에 저장되어 세션 간 유지됩니다.

### 원샷 모드

```bash
ai "이 프로젝트 설명해줘"          # 단일 쿼리
git diff | ai "이거 리뷰해줘"      # stdin을 AI에 파이프
ai 이게 왜 안 되나요?              # 한국어/비ASCII는 자동 AI 전달 (noglob 적용)
```

### 컨텍스트 관리

같은 플래그를 `aish`(앞에 `--` 추가)와 `ai` 명령어 양쪽에서 사용할 수 있습니다:

```bash
ai --status                         # 컨텍스트 예산 및 토큰 사용량 확인
ai --compact                        # 대화 윈도우를 주제 요약으로 압축
ai --clear                          # 대화 윈도우 초기화 (메모리 유지)
ai --forget                         # 전체 초기화 (메모리 + 주제 + 윈도우)
ai --topic "auth 작업"              # 주제 전환 (현재 주제 저장)
ai --recall "auth 작업"             # 저장된 주제 복원
ai --remember "PostgreSQL 사용중"   # 영구 메모리에 사실 저장
```

### 데몬 제어

```bash
ai --start                          # 데몬 수동 시작
ai --stop                           # 데몬 종료
```

## 스마트 명령어 미인식 처리

명령어가 127 코드로 종료(명령어 없음)되면 aish는 단계별 폴백을 적용합니다:

**자연어 감지** — AI에 자동 전달:
- 비ASCII 입력(한국어, 일본어 등)
- `?`로 끝나는 입력
- 5개 이상의 단어
- 일반 영어 자연어 동사로 시작 (`explain`, `how`, `what` 등)

**오타 교정** — QWERTY 가중 레벤슈타인 거리로 PATH에서 유사 명령어 탐색:
- QWERTY 인접 키 비용 0.5 (그 외 치환은 1.0)
- 세 가지 선택지 제공: `[Y=실행 / n=취소 / a=AI]`
- 파괴적 명령어(`rm -rf`, `dd`, `mkfs` 등)는 빨간 경고 표시

**알 수 없는 명령어** — 유사 명령어 없으면 `[Y/n]`으로 AI 전달 여부 확인

```
aish ~/project $ gti status
  혹시 git status인가요? [Y=실행 / n=취소 / a=AI]
```

```
aish ~/project $ rm -rdf /tmp/test
  ⚠  되돌릴 수 없는 명령입니다!
  혹시 rm -rdf /tmp/test인가요? [Y=실행 / n=취소 / a=AI]
```

## 아키텍처

### 4계층 컨텍스트 시스템

| 계층 | 역할 | 예산 |
|------|------|------|
| L0: Memory | 영구 사실 (프로젝트 정보, 컨벤션, 결정) | ~200 토큰 |
| L1: Topics | 과거 대화 요약 (이름 붙인 주제) | ~300 토큰 |
| L2: Window | 최근 대화 턴 | ~2500 토큰 |
| L3: Shell | 현재 cwd + 최근 명령어 이력 | ~100 토큰 |

총 예산: ~3100 토큰 — 빠르고 저렴하게 유지하면서 의미 있는 대화 가능.

### 세션 연속성

aish는 Agent SDK의 `continue: true` 옵션으로 현재 디렉토리의 가장 최근 Claude Code 세션을 재개합니다. 세션은 디스크(`~/.claude/projects/`)에 저장되며 데몬 재시작 후에도 유지됩니다.

대규모 시스템 프롬프트는 최초 1회 과금(1.25x 생성 가격) 후 이후 쿼리에서 캐시로 제공(0.1x) — 10턴 대화 기준 약 **78% 절약**.

**인증**: Claude Code 구독의 OAuth 사용 — API 키 불필요.

## 제거

```bash
./uninstall.sh
```

## 라이선스

MIT
