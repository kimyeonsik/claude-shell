# TESTING.md — aish Test Scenarios

## Automated Test Script

```bash
# 빠른 실행 (AI 질의 제외, ~5초)
bash scripts/test.sh --fast

# 전체 실행 (AI 질의 포함, ~30초)
bash scripts/test.sh
```

`scripts/test.sh`는 아래 시나리오 표의 모든 항목을 자동으로 검증합니다.

---

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Automated (scripts/test.sh) |
| 🖥️ | Requires interactive terminal (Ctrl+C 등) |
| ⚠️ | Known limitation |

---

## 1. Build & Install

| # | Command | Expected | Status |
|---|---------|----------|--------|
| 1.1 | `npm run build` | Exit 0, no TypeScript errors | ✅ |
| 1.2 | `which aish` | Points to dist/client.js via npm link | ✅ |
| 1.3 | `./install.sh && which aish && which aish-client && which aish-daemon` | All three binaries exist | 🖥️ |
| 1.4 | `./uninstall.sh && which aish` | Command not found | 🖥️ |

---

## 2. One-Shot Mode (`aish-client` / `aish "query"`)

### 2.1 Basic AI Query

| # | Command | Expected | Status |
|---|---------|----------|--------|
| 2.1.1 | `aish-client "지금 어떤 프로젝트를 작업 중인지 알아?"` | 프로젝트 정보 응답 | ✅ |
| 2.1.2 | `aish-client "이 프로젝트의 가장 최근 커밋 메시지가 뭐야?"` | 이전 대화 컨텍스트 기반 응답 | ✅ |

### 2.2 Session Continuity (continue: true)

| # | Command | Expected | Status |
|---|---------|----------|--------|
| 2.2.1 | Q1 후 Q2에서 Q1 내용 기억 | 동일 세션 ID 유지, 이전 대화 기억 | ✅ |
| 2.2.2 | `aish-client --stop` → 재시작 → Q: "방금 말한 게 뭐야?" | 데몬 재시작 후에도 기억 유지 (디스크 세션) | ✅ |

### 2.3 stdin Pipe

| # | Command | Expected | Status |
|---|---------|----------|--------|
| 2.3.1 | `ls -la src/ \| aish-client "가장 큰 파일이 뭐야?"` | 파일 목록 기반 응답 | ✅ |
| 2.3.2 | `git diff \| aish-client "변경 사항 요약해줘"` | diff 내용 요약 | 🖥️ |
| 2.3.3 | 파이프 쿼리 후 `aish-client "방금 파일 이름이 뭐야?"` | 파이프 컨텍스트가 윈도우에 저장됨 확인 | ✅ |

### 2.4 Context Management Commands

| # | Command | Expected | Status |
|---|---------|----------|--------|
| 2.4.1 | `aish-client --status` | Memory/Topics/Window/Budget/SessionID 표시 | ✅ |
| 2.4.2 | `aish-client --remember "이 프로젝트는 TypeScript로 작성됨"` | Memory에 저장 → `--status`에서 토큰 증가 확인 | 🖥️ |
| 2.4.3 | `--remember` 후 새 세션에서 해당 사실 기억하는지 확인 | Memory는 세션 초기화 후에도 유지 | 🖥️ |
| 2.4.4 | `aish-client --compact` | Window 턴 수 감소, Topics 토큰 증가 | 🖥️ |
| 2.4.5 | `aish-client --clear` | Window 0턴, Memory/Topics 유지 | 🖥️ |
| 2.4.6 | `--clear` 후 이전 대화 기억하는지 확인 | 기억 못함 (Window 초기화됨) | 🖥️ |
| 2.4.7 | `aish-client --forget` | Memory/Topics/Window 모두 0 | 🖥️ |
| 2.4.8 | `aish-client --topic "auth-work"` | 새 토픽으로 전환, 이전 윈도우 저장됨 | 🖥️ |
| 2.4.9 | `aish-client --recall "auth-work"` | 이전 토픽 복원, Window 내용 돌아옴 | 🖥️ |

### 2.5 Daemon Control

| # | Command | Expected | Status |
|---|---------|----------|--------|
| 2.5.1 | `aish-client --start` (데몬 없을 때) | "Daemon ready." 출력 | 🖥️ |
| 2.5.2 | `aish-client --start` (데몬 이미 실행 중) | "Daemon already running." | 🖥️ |
| 2.5.3 | `aish-client --stop` | "Daemon stopping..." → 프로세스 종료 | ✅ |
| 2.5.4 | 데몬 없는 상태에서 쿼리 → 자동 시작 | "Starting daemon..." → 응답 | 🖥️ |

---

## 3. Interactive REPL (`aish`)

> **실행 방법**: 새 터미널에서 `aish` 입력

### 3.1 REPL 진입/종료

| # | 입력 | Expected | Status |
|---|------|----------|--------|
| 3.1.1 | `aish` | 배너 표시, `aish ~/path $` 프롬프트 | 🖥️ |
| 3.1.2 | `exit` | "Bye." 출력 후 종료 | 🖥️ |
| 3.1.3 | `quit` | "Bye." 출력 후 종료 | 🖥️ |
| 3.1.4 | `Ctrl+D` (EOF) | 정상 종료 | 🖥️ |

### 3.2 Shell Command 실행

| # | 입력 | Expected | Status |
|---|------|----------|--------|
| 3.2.1 | `ls` | 파일 목록 출력 | 🖥️ |
| 3.2.2 | `pwd` | 현재 디렉토리 출력 | 🖥️ |
| 3.2.3 | `git status` | git 상태 출력 | 🖥️ |
| 3.2.4 | `echo "hello world"` | hello world 출력 | 🖥️ |
| 3.2.5 | `ls -la \| head -5` | 파이프 내장 명령 동작 | 🖥️ |
| 3.2.6 | `존재하지않는명령어` | 에러 메시지 출력, REPL 복귀 | 🖥️ |

### 3.3 cd 명령

| # | 입력 | Expected | Status |
|---|------|----------|--------|
| 3.3.1 | `cd /tmp` | 프롬프트가 `aish /tmp $`로 변경 | 🖥️ |
| 3.3.2 | `cd ~` | 홈 디렉토리로 이동 | 🖥️ |
| 3.3.3 | `cd ~/claude-shell` | `~/` 확장 동작 | 🖥️ |
| 3.3.4 | `cd ..` | 상위 디렉토리 이동 | 🖥️ |
| 3.3.5 | `cd /존재하지않는경로` | `✗ cd: no such directory` 에러, REPL 유지 | 🖥️ |
| 3.3.6 | `cd` (인자 없음) | 홈 디렉토리로 이동 | 🖥️ |

### 3.4 AI Query (`> query`)

| # | 입력 | Expected | Status |
|---|------|----------|--------|
| 3.4.1 | `ls` 실행 후 `> 이 파일들 설명해줘` | ls 출력이 commandContext로 전달됨 | 🖥️ |
| 3.4.2 | `> 안녕` | AI 응답 스트리밍, `ai> ` 프리픽스 | 🖥️ |
| 3.4.3 | `>` (쿼리 없음) | 무시, 다음 프롬프트 | 🖥️ |
| 3.4.4 | AI 응답 후 `> 방금 한 말이 뭐야?` | 대화 연속성 유지 | 🖥️ |

### 3.5 Pipe to AI (`cmd |> query`)

| # | 입력 | Expected | Status |
|---|------|----------|--------|
| 3.5.1 | `git log --oneline \|> 최근 변경 사항 요약` | git log가 컨텍스트로 전달, 요약 응답 | 🖥️ |
| 3.5.2 | `cat README.md \|> 한 줄 요약` | 파일 내용 요약 | 🖥️ |
| 3.5.3 | `\|> query` (명령 없음) | `✗ Usage: command \|> AI query` | 🖥️ |
| 3.5.4 | `cmd \|>` (쿼리 없음) | `✗ Usage: command \|> AI query` | 🖥️ |
| 3.5.5 | `|>` 파이프 출력은 터미널에 표시되지 않음 | 명령 출력이 silent로 실행됨 | 🖥️ |

### 3.6 Meta Commands (REPL 내)

| # | 입력 | Expected | Status |
|---|------|----------|--------|
| 3.6.1 | `--status` | 컨텍스트 상태 표시 | 🖥️ |
| 3.6.2 | `--compact` | Window 요약, 완료 메시지 | 🖥️ |
| 3.6.3 | `--clear` | Window 초기화 확인 | 🖥️ |
| 3.6.4 | `--forget` | 전체 초기화 확인 | 🖥️ |
| 3.6.5 | `--help` | 사용법 출력 | 🖥️ |

### 3.7 Ctrl+C 처리

| # | 상황 | Expected | Status |
|---|------|----------|--------|
| 3.7.1 | 명령 실행 중 Ctrl+C | 자식 프로세스 SIGINT, REPL 복귀 | 🖥️ |
| 3.7.2 | AI 쿼리 중 Ctrl+C | 쿼리 취소 `(query cancelled)`, REPL 복귀 | 🖥️ |
| 3.7.3 | 대기 중 Ctrl+C | 현재 줄 클리어, 새 프롬프트 | 🖥️ |

---

## 4. Edge Cases

### 4.1 Output Truncation

| # | 설명 | Expected | Status |
|---|------|----------|--------|
| 4.1.1 | 3000자 초과 명령 출력 | `...[truncated]` 마커, ring buffer에 저장 | 🖥️ |
| 4.1.2 | commandContext가 4000자 초과 | 최신 항목 우선 4000자로 조합 | 🖥️ |
| 4.1.3 | ring buffer 5개 초과 | 가장 오래된 항목 제거 (FIFO) | 🖥️ |

### 4.2 Known Limitations (문서화, 수정 불필요)

| # | 상황 | 현상 | 비고 |
|---|------|------|------|
| 4.2.1 | `vim`, `less`, `top` 등 인터랙티브 프로그램 | stdio pipe 모드에서 정상 동작 안 함 | MVP 제한사항 |
| 4.2.2 | `export VAR=val` | 서브셸이라 상위 프로세스에 미적용 | 일반 쉘과 동일한 제한 |
| 4.2.3 | `cd -` | `✗ cd - is not supported` | 미구현 |
| 4.2.4 | piped stdin으로 aish 실행 | readline async 이슈로 명령 누락 가능 | 실제 사용 패턴 아님 |

---

## 5. Token Efficiency Verification

| # | 방법 | Expected | Status |
|---|------|----------|--------|
| 5.1 | 10턴 대화 후 `--status` | Window 토큰이 ~2500t 이내 유지 | 🖥️ |
| 5.2 | 데몬 재시작 후 쿼리 (캐시 히트) | 응답이 빠르게 도착 (캐시 적중) | ✅ |
| 5.3 | `--compact` 후 `--status` | Window 토큰 감소, Topics 증가 | 🖥️ |
| 5.4 | 명령 출력이 윈도우에 쌓이지 않음 | `--status`에서 Window 토큰이 명령 출력 포함 안 함 | 🖥️ |

---

## 6. Interactive REPL 테스트 방법

### 6.1 자동화 (scripts/test.sh) — 권장

커맨드 큐 + isClosing 플래그 구현으로 piped 입력이 실제 인터랙티브와 동일하게 동작합니다.
3.1~3.6, 4.x 섹션 전체를 `printf "cmd\n" | aish` 패턴으로 자동 검증합니다.

```bash
bash scripts/test.sh --fast   # ~5초
bash scripts/test.sh          # ~30초 (AI 포함)
```

### 6.2 수동 테스트 (Ctrl+C 시나리오)

3.7 Ctrl+C 시나리오는 시그널이라 파이프로 전송 불가 — 직접 실행 필요:

```bash
aish
# 터미널에서 직접:
# 1. sleep 10 입력 후 Ctrl+C → 명령 취소, REPL 복귀 확인
# 2. > 질문 입력 후 AI 응답 중 Ctrl+C → 쿼리 취소, REPL 복귀 확인
# 3. 대기 중 Ctrl+C → 현재 줄 클리어, 새 프롬프트 확인
```
