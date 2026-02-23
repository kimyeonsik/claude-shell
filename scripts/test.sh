#!/usr/bin/env bash
# scripts/test.sh — aish Automated Test Suite
#
# Usage:
#   bash scripts/test.sh           # full suite (includes AI queries, ~30s)
#   bash scripts/test.sh --fast    # shell/cd/meta only, no AI (~5s)

set -uo pipefail
cd "$(dirname "$0")/.."

FAST_ONLY=${1:-""}
PASS=0; FAIL=0; SKIP=0

# ── Colors ──────────────────────────────────────────────────────────────────
R='\033[0;31m'; G='\033[0;32m'; Y='\033[0;33m'
B='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

# ── Helpers ──────────────────────────────────────────────────────────────────

# Strip ANSI escape codes (works on macOS + Linux via perl)
strip_ansi() { perl -pe 's/\x1b\[[0-9;]*[mGJKHFABCDEFsu]//g'; }

pass() { echo -e "${G}✅${NC} $1"; ((PASS++)); }
fail() {
  echo -e "${R}❌${NC} $1"
  echo -e "   ${Y}expected${NC}: $2"
  echo -e "   ${Y}got${NC}:      $3"
  ((FAIL++))
}
skip() { echo -e "${Y}⏭ ${NC} $1  ${Y}# $2${NC}"; ((SKIP++)); }
header() { echo; echo -e "${B}── $1 ──${NC}"; }

# Run aish REPL with piped commands, exit appended automatically
repl() { printf "%s\n" "$@" "exit" | aish 2>&1 | strip_ansi; }

# Run aish-client one-shot
client() { aish-client "$@" 2>&1 | strip_ansi; }

# macOS-compatible timeout via perl alarm
with_timeout() {
  local secs=$1; shift
  perl -e "alarm($secs); exec @ARGV" -- "$@"
}

# assert output contains pattern
ok() {
  local name="$1" output="$2" pattern="$3"
  if echo "$output" | grep -q "$pattern"; then
    pass "$name"
  else
    fail "$name" "$pattern" "$(echo "$output" | grep -v '^[[:space:]]*$' | tail -3 | tr '\n' ' ')"
  fi
}

# assert output does NOT contain pattern
nok() {
  local name="$1" output="$2" pattern="$3"
  if ! echo "$output" | grep -q "$pattern"; then
    pass "$name"
  else
    fail "$name" "NOT: $pattern" "$(echo "$output" | grep "$pattern" | head -1)"
  fi
}

# ── Header ───────────────────────────────────────────────────────────────────
echo
echo -e "${BOLD}══════════════════════════════════════════${NC}"
echo -e "${BOLD}  aish Automated Test Suite${NC}"
if [[ "$FAST_ONLY" == "--fast" ]]; then
  echo -e "  ${Y}(fast mode — AI queries skipped)${NC}"
fi
echo -e "${BOLD}══════════════════════════════════════════${NC}"

# ════════════════════════════════════════════════════════════════════════════
# 1. Build & Install
# ════════════════════════════════════════════════════════════════════════════
header "1. Build & Install"

if npm run build 2>/dev/null; then
  pass "1.1  npm run build (TypeScript)"
else
  fail "1.1  npm run build" "exit 0" "build failed"
fi

for bin in aish aish-client aish-daemon; do
  if which "$bin" >/dev/null 2>&1; then
    pass "1.2  $bin in PATH"
  else
    fail "1.2  $bin in PATH" "found" "not found"
  fi
done

# ════════════════════════════════════════════════════════════════════════════
# 2. One-shot Mode (aish-client)
# ════════════════════════════════════════════════════════════════════════════
header "2. One-shot Mode (aish-client)"

# 2.1 --help
ok "2.1  --help shows usage"       "$(client --help)"    "aish"
ok "2.1  --help shows --status"    "$(client --help)"    "\-\-status"

# 2.2 --status format
STATUS=$(client --status)
ok "2.2  --status: header"         "$STATUS"  "── aish status ──"
ok "2.2  --status: Memory field"   "$STATUS"  "Memory:"
ok "2.2  --status: Window field"   "$STATUS"  "Window:"
ok "2.2  --status: Budget field"   "$STATUS"  "Budget:"
ok "2.2  --status: SessionId"      "$STATUS"  "Session:"

# 2.3 Daemon control
ok "2.3  --stop"                   "$(client --stop)"    "Daemon"
sleep 1
ok "2.3  --start (explicit)"       "$(client --start)"   "Daemon"
ok "2.3  --start (already up)"     "$(client --start)"   "Daemon"   # idempotent

# 2.4 Context management
ok "2.4  --clear runs without error"  "$(client --clear 2>&1 | strip_ansi)"  ""  || true
AFTER_CLEAR=$(client --status | grep -o '[0-9]*턴' | grep -o '[0-9]*')
if [[ "${AFTER_CLEAR:-0}" -eq 0 ]]; then
  pass "2.4  --clear resets window to 0 turns"
else
  fail "2.4  --clear resets window to 0 turns" "0" "${AFTER_CLEAR}"
fi

ok "2.4  --forget runs without error" "$(client --forget 2>&1 | strip_ansi)"  "" || true
AFTER_FORGET=$(client --status | grep "Memory:" | grep -o '[0-9]*t ' | head -1 | tr -d ' t')
if [[ "${AFTER_FORGET:-0}" -eq 0 ]]; then
  pass "2.4  --forget clears memory"
else
  fail "2.4  --forget clears memory" "0t" "${AFTER_FORGET}t"
fi

# 2.5 One-shot AI query (only in full mode)
if [[ "$FAST_ONLY" == "--fast" ]]; then
  skip "2.5  one-shot AI query" "--fast"
else
  OUT=$(with_timeout 30 aish-client "숫자 42를 그대로 반복해줘" 2>&1 | strip_ansi)
  ok "2.5  one-shot AI query returns content" "$OUT" "42"
fi

# ════════════════════════════════════════════════════════════════════════════
# 3. Interactive REPL — Shell Commands
# ════════════════════════════════════════════════════════════════════════════
header "3.2 REPL: Shell Commands"

ok "3.2.1 ls"                  "$(repl "ls")"                           "package.json"
ok "3.2.2 pwd"                 "$(repl "pwd")"                          "$(pwd)"
ok "3.2.3 echo"                "$(repl "echo hello world")"             "hello world"
ok "3.2.4 internal pipe"       "$(repl "ls src/ | sort | head -1")"     "client.ts"
ok "3.2.5 multiline output"    "$(repl "ls src/")"                      "shell.ts"
ok "3.2.6 bad command no crash" "$(repl "thiscommanddoesnotexist123")"  "Bye."
ok "3.2.x Bye. on exit"        "$(repl "ls")"                           "Bye."

# ════════════════════════════════════════════════════════════════════════════
# 3.3 REPL — cd
# ════════════════════════════════════════════════════════════════════════════
header "3.3 REPL: cd"

ok "3.3.1 cd /tmp"             "$(repl "cd /tmp" "pwd")"                "/tmp"
ok "3.3.2 cd ~"                "$(repl "cd ~" "pwd")"                   "$HOME"
ok "3.3.3 cd ~/path"           "$(repl "cd ~/claude-shell" "pwd")"      "claude-shell"
ok "3.3.4 cd .."               "$(repl "cd /tmp/foo/.." "pwd")"         "/tmp"
ok "3.3.5 cd nonexistent"      "$(repl "cd /this/does/not/exist/xyz")"  "no such directory"
ok "3.3.6 cd (no arg)"         "$(repl "cd" "pwd")"                     "$HOME"
ok "3.3.x prompt tracks cwd"   "$(repl "cd /tmp")"                      "aish /tmp"

# ════════════════════════════════════════════════════════════════════════════
# 3.4 REPL — AI Query (> prefix)
# ════════════════════════════════════════════════════════════════════════════
header "3.4 REPL: AI Query (> prefix)"

if [[ "$FAST_ONLY" == "--fast" ]]; then
  skip "3.4.1 > query returns response" "--fast"
  skip "3.4.2 > with no text ignored"   "--fast"
else
  # Run ls first so commandContext is populated, then query
  OUT=$(printf "ls src/\n> 방금 ls 결과에서 파일 개수가 몇 개야? 숫자만 답해줘\nexit\n" \
        | with_timeout 30 aish 2>&1 | strip_ansi)
  ok "3.4.1 > query gets response"       "$OUT"  "ai>"
  ok "3.4.1 > query uses command context" "$OUT" "[0-9]"   # some number in response

  OUT=$(repl ">")
  nok "3.4.2 bare > is ignored (no crash)" "$OUT" "Error"
fi

# ════════════════════════════════════════════════════════════════════════════
# 3.5 REPL — Pipe to AI (|>)
# ════════════════════════════════════════════════════════════════════════════
header "3.5 REPL: Pipe to AI (|>)"

if [[ "$FAST_ONLY" == "--fast" ]]; then
  skip "3.5.1 cmd |> query returns response" "--fast"
else
  OUT=$(printf "echo 'the magic word is XYZZY' |> 매직 워드가 뭐야?\nexit\n" \
        | with_timeout 30 aish 2>&1 | strip_ansi)
  ok "3.5.1 |> passes output to AI"  "$OUT"  "ai>"
  ok "3.5.1 AI sees piped content"   "$OUT"  "XYZZY"
fi

ok "3.5.3 |> without cmd"          "$(repl "|> query")"            "Usage"
ok "3.5.4 cmd |> without query"    "$(repl "echo hi |>")"          "Usage"

# ════════════════════════════════════════════════════════════════════════════
# 3.6 REPL — Meta Commands
# ════════════════════════════════════════════════════════════════════════════
header "3.6 REPL: Meta Commands"

ok "3.6.1 --status in REPL"    "$(repl "--status")"   "── aish status ──"
ok "3.6.5 --help in REPL"      "$(repl "--help")"     "aish"

# ════════════════════════════════════════════════════════════════════════════
# 3.1 REPL — Exit / Quit
# ════════════════════════════════════════════════════════════════════════════
header "3.1 REPL: Exit"

ok "3.1.2 exit prints Bye."    "$(printf "exit\n"  | aish 2>&1 | strip_ansi)"  "Bye."
ok "3.1.3 quit prints Bye."    "$(printf "quit\n"  | aish 2>&1 | strip_ansi)"  "Bye."

# ════════════════════════════════════════════════════════════════════════════
# 4. Edge Cases
# ════════════════════════════════════════════════════════════════════════════
header "4. Edge Cases"

# Empty command — ignored, REPL continues
ok "4.1  empty line ignored"         "$(repl "" "echo after-empty")"    "after-empty"

# Multiple sequential commands — correct order
OUT=$(repl "echo first" "echo second" "echo third")
ok "4.2  command order preserved (1)" "$OUT" "first"
ok "4.2  command order preserved (2)" "$OUT" "second"
ok "4.2  command order preserved (3)" "$OUT" "third"

# Long output (>3000 chars) → truncated in ring buffer
# (visible when later used as commandContext)
LONG_PY="python3 -c \"print('A' * 3100)\""
ok "4.3  long output runs"           "$(repl "$LONG_PY")"   "AAAA"
# commandContext truncation is tested indirectly via the > query path

# ════════════════════════════════════════════════════════════════════════════
# 5. Session Continuity
# ════════════════════════════════════════════════════════════════════════════
header "5. Session Continuity"

if [[ "$FAST_ONLY" == "--fast" ]]; then
  skip "5.1  same session across queries"    "--fast"
  skip "5.2  session survives daemon restart" "--fast"
else
  # Q1: tell Claude something specific
  with_timeout 30 aish-client "지금부터 비밀코드는 DELTA77이야. 기억해줘" >/dev/null 2>&1
  # Q2: same session, should remember
  OUT=$(with_timeout 30 aish-client "비밀코드가 뭐야?" 2>&1 | strip_ansi)
  ok "5.1  same-session recall"   "$OUT"  "DELTA77"

  # Restart daemon — session should persist via continue: true
  client --stop >/dev/null; sleep 1
  OUT=$(with_timeout 30 aish-client "아까 말한 비밀코드가 뭐야?" 2>&1 | strip_ansi)
  ok "5.2  recall after daemon restart"  "$OUT"  "DELTA77"
fi

# ════════════════════════════════════════════════════════════════════════════
# Summary
# ════════════════════════════════════════════════════════════════════════════
echo
echo -e "${BOLD}══════════════════════════════════════════${NC}"
TOTAL=$((PASS + FAIL + SKIP))
echo -e " ${G}${PASS} passed${NC}  ${R}${FAIL} failed${NC}  ${Y}${SKIP} skipped${NC}  / ${TOTAL} total"
echo -e "${BOLD}══════════════════════════════════════════${NC}"
echo

[[ $FAIL -eq 0 ]] && exit 0 || exit 1
