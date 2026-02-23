# Claude Shell (aish)

터미널 명령과 Claude AI 대화를 하나의 REPL에서 사용할 수 있는 통합 셸입니다. [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk)를 기반으로 만들어졌습니다.

## 기능 요약

- **인터랙티브 REPL** — 터미널 명령과 AI 대화를 한 곳에서
- **AI 쿼리 프리픽스** — `> 질문` 으로 셸 안에서 Claude에게 질문
- **AI 파이프** — `cmd |> 질문` 으로 명령 출력을 AI에 직접 전달
- **스마트 명령어 폴백** — QWERTY 가중 편집 거리로 오타 교정; 자연어는 자동으로 AI 전달
- **출력 링 버퍼** — 최근 명령어 출력 5개(각 최대 3000자)를 AI 컨텍스트로 자동 활용
- **4계층 컨텍스트** — 영구 기억, 주제 요약, 대화 윈도우, 현재 셸 상태
- **토큰 효율** — 명령어 출력은 ephemeral (대화 윈도우에 저장되지 않음)
- **영속 데몬** — 백그라운드 Unix 소켓 서버가 쿼리 간 컨텍스트 유지
- **대화 지속성** — 세션을 디스크에 저장; `continue: true`로 이어서 대화
- **서버사이드 캐싱** — 시스템 프롬프트(~20K 토큰) 캐시로 ~78% 비용 절감
- **원샷 모드** — 어느 zsh 프롬프트에서나 `ai "질문"` 또는 `cmd | ai "질문"` 사용 가능

## 빠른 시작

```bash
git clone https://github.com/cosmicbuffalo/claude-shell.git
cd claude-shell
./install.sh
source ~/.zshrc
```

**필요 조건**: Node.js 18+, [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 설치

## 사용법

### 인터랙티브 셸 (aish)

```bash
aish                              # 인터랙티브 REPL 진입
```

셸 안에서:

```
aish ~/project $ ls -la                    # 일반 셸 명령 실행
aish ~/project $ > 이 출력 설명해줘       # AI에게 질문 (최근 출력 자동 포함)
aish ~/project $ git diff |> 리뷰해줘     # 명령 출력을 AI에 파이프
aish ~/project $ cd src                    # 디렉토리 이동 (~/확장, 오류 처리 포함)
aish ~/project $ --status                  # 컨텍스트 상태 확인
aish ~/project $ --help                    # 도움말 표시
aish ~/project $ exit                      # 셸 종료
```

### 원샷 모드 (one-shot mode)

```bash
ai "이 프로젝트 설명해줘"          # 단발 쿼리
git diff | ai "리뷰해줘"           # stdin 파이프 지원
ai 이게 왜 안 되나요?              # 한국어/비ASCII 자동 처리 (noglob 적용)
```

### 컨텍스트 관리

아래 플래그는 `aish` 안(`--` 프리픽스)과 `ai` 명령어 양쪽에서 동일하게 작동합니다:

```bash
ai --status                       # 컨텍스트 예산 및 토큰 사용량 표시
ai --compact                      # 대화 윈도우를 주제 요약으로 압축
ai --clear                        # 대화 윈도우 초기화 (Memory는 유지)
ai --forget                       # 전체 컨텍스트 초기화 (Memory + Topics + Window)
ai --topic "auth 작업"            # 명명된 주제로 전환 (현재 대화 저장)
ai --recall "auth 작업"           # 이전에 저장한 주제 복원
ai --remember "PostgreSQL 사용"   # 영구 기억에 사실 저장
```

### 데몬 (daemon) 제어

```bash
ai --start                        # 데몬 수동 시작
ai --stop                         # 데몬 중지
```

## 스마트 명령어 폴백 (command-not-found)

명령이 exit code 127로 종료(명령어 없음)되면 aish는 다단계 폴백을 실행합니다:

**자연어 감지** — 조용히 AI에 전달:
- 비ASCII 입력 (한국어, 일본어 등)
- `?`로 끝나는 입력
- 단어 5개 이상
- 영어 자연어 동사/의문사로 시작 (`explain`, `how`, `what`, `show` 등)

**오타 교정** — QWERTY 가중 Levenshtein 거리로 PATH에서 가장 가까운 명령어 탐색:
- QWERTY 인접 키 치환은 비용 0.5 (다른 치환은 1.0)
- 세 가지 선택지 제공: `[Y=실행 / n=취소 / a=AI]`
- 위험 명령어(`rm -rf`, `dd`, `mkfs` 등)는 빨간색 경고 표시

**알 수 없는 명령** — 가까운 일치 항목이 없으면 `[Y/n]`으로 AI 전달 여부 질문.

```
aish ~/project $ gti status
  혹시 git status인가요? [Y=실행 / n=취소 / a=AI]
```

```
aish ~/project $ rm -rdf /tmp/test
  ⚠  되돌릴 수 없는 명령입니다!
  혹시 rm -rdf /tmp/test인가요? [Y=실행 / n=취소 / a=AI]
```

## Ctrl+C 동작

| 상황 | 동작 |
|------|------|
| 셸 명령 실행 중 | 자식 프로세스에 SIGINT 전송 |
| AI 쿼리 진행 중 | 쿼리 취소 (데몬 연결 중단) |
| 유휴 / 빈 줄 | 현재 줄 초기화, 프롬프트 재표시 |

## 아키텍처

```
┌──────────────────────────────────────────┐
│  인터랙티브 셸 (shell.ts)                 │  REPL + 명령 캡처
│  - readline 인터페이스                    │
│  - 출력 링 버퍼 (5개×3000자)             │
│  - > 프리픽스 → AI 쿼리                  │
│  - cmd |> query → AI 파이프              │
│  - QWERTY 가중 오타 교정                 │
│  - 자연어 자동 감지                      │
└───────────┬──────────────────────────────┘
            │ Unix 소켓 (JSON 프로토콜)
┌───────────┴──────────────────────────────┐
│  데몬 (daemon.ts)                         │  영속 백그라운드 프로세스
│  - Claude Agent SDK 통합                  │
│  - 4계층 컨텍스트 관리                    │
│  - 메모리 추출 (claude-haiku)             │
│  - continue: true 세션 재개               │
│  - PID 파일 + 스테일 소켓 정리            │
└──────────────────────────────────────────┘
            ↑
┌───────────┴──────────────────────────────┐
│  zsh 통합 (shell/ai.zsh)                  │  원샷 모드
│  - ai alias (noglob 래퍼)                 │
│  - 셸 상태 추적 (preexec/precmd)          │
│  - zsh 탭 자동완성                        │
└──────────────────────────────────────────┘
```

### 4계층 컨텍스트 시스템

| 레이어 | 역할 | 예산 |
|--------|------|------|
| L0: Memory | 영구 기억 (프로젝트 정보, 컨벤션, 결정 사항) | ~200 토큰 |
| L1: Topics | 과거 대화 요약 (명명된 주제) | ~300 토큰 |
| L2: Window | 최근 대화 턴 | ~2500 토큰 |
| L3: Shell | 현재 디렉토리 + 최근 명령어 히스토리 | ~100 토큰 |

총 예산: ~3100 토큰 — 빠르고 저렴하게 유지하면서 의미 있는 대화를 나누기에 충분합니다.

### 토큰 효율: Ephemeral 명령어 출력

명령어 출력은 AI에 전달될 때만 주입되며, 대화 윈도우에 저장되지 않습니다:

```
셸 명령 실행 → 출력 링 버퍼 (최대 5개, 각 3000자)
                      ↓
AI 쿼리 → buildCommandContext() → 최대 4000자 합산
                      ↓
데몬 → 시스템 프롬프트에 [Recent Command Output]으로 추가 (ephemeral)
                      ↓
응답 후 → 윈도우에는 질문 + 답변 텍스트만 저장
                      ↓
                      명령어 출력 = 0 윈도우 토큰
```

### 세션 지속성 (Session Continuity)

aish는 Agent SDK의 `continue: true` 옵션을 사용해 현재 디렉토리의 가장 최근 Claude Code 세션을 재개합니다. 세션은 디스크(`~/.claude/projects/`)에 저장되며 데몬 재시작 후에도 유지됩니다.

```
쿼리 1 → 새 세션 생성, claude_code 프리셋 (~20K 토큰) 캐시됨
쿼리 2 → continue: true → 디스크에서 동일 세션 로드
          input_tokens:       3   (새 사용자 메시지만)
          cache_read_tokens:  ~20,000  (0.1× 가격)
```

큰 시스템 프롬프트는 처음 한 번만 청구(1.25× 생성 가격)되고, 이후 매 쿼리마다 캐시에서 0.1×로 제공됩니다 — 10턴 대화 기준 약 **78% 더 저렴**합니다.

컨텍스트 초기화(`--clear`, `--compact`, `--forget`, `--topic`)를 실행하면 자동으로 새 세션이 시작됩니다.

**인증**: Claude Code 구독을 통한 OAuth — API 키가 필요하지 않습니다.

### 메모리 추출 (Memory Extraction)

몇 턴마다 aish는 백그라운드에서 Claude Haiku 에이전트를 실행해 가장 최근 AI 응답에서 기억할 만한 사실(프로젝트 기술 스택, 코딩 컨벤션, 아키텍처 결정 사항)을 추출합니다. 추출된 사실은 L0 Memory에 병합되어 세션 간에 유지됩니다.

### zsh 통합 상세

`shell/ai.zsh`는 zsh의 `preexec` / `precmd` 훅을 사용해 현재 디렉토리와 최근 명령어 히스토리를 상태 파일에 기록합니다. 이를 통해 원샷 모드에서도 AI가 현재 작업 맥락을 파악할 수 있습니다.

`ai` alias는 `_ai_impl`을 `noglob`으로 감싸서 zsh가 메시지를 클라이언트에 전달하기 전에 글로브 문자(`?`, `*`, `[]`)를 확장하는 것을 방지합니다 — 덕분에 `ai 안되나?`처럼 따옴표 없이 사용해도 잘 작동합니다.

모든 `--` 플래그에 대해 탭 자동완성이 제공됩니다.

## 메타 커맨드 전체 목록

| 커맨드 | 설명 |
|--------|------|
| `--status` | 컨텍스트 예산 및 세션 정보 표시 |
| `--compact` | 대화 윈도우를 주제 요약으로 압축 |
| `--clear` | 대화 윈도우 초기화 (Memory 유지) |
| `--forget` | 전체 컨텍스트 초기화 |
| `--topic "이름"` | 현재 대화를 저장하고 새 주제로 전환 |
| `--recall "이름"` | 이전에 저장한 주제 복원 |
| `--remember "사실"` | L0 Memory에 사실 저장 |
| `--start` | 데몬 수동 시작 |
| `--stop` | 데몬 중지 (aish 셸에서는 종료도 함께) |
| `--help` | 도움말 표시 |

## 프로젝트 구조

```
src/
├── shell.ts          # 인터랙티브 REPL (AishShell 클래스)
├── client.ts         # CLI 진입점 (원샷 + 셸 런처)
├── daemon.ts         # Agent SDK를 사용하는 백그라운드 데몬
├── connection.ts     # 데몬 연결 유틸리티 (공유)
├── protocol.ts       # IPC 메시지 타입 (Unix 소켓 위 JSON)
├── types.ts          # 공유 타입 및 상수
└── context/
    ├── manager.ts    # 컨텍스트 오케스트레이션
    ├── memory.ts     # 영구 기억 (L0)
    ├── topic.ts      # 주제 관리 (L1)
    ├── window.ts     # 대화 윈도우 (L2)
    ├── shell.ts      # 셸 상태 추적 (L3)
    └── tokens.ts     # 다국어 토큰 추정

shell/
└── ai.zsh            # zsh 통합: ai alias, 셸 상태, 탭 자동완성
```

## 제거

```bash
./uninstall.sh
```

## 라이선스

MIT
