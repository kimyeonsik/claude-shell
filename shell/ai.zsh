# ── Claude Shell (aish) zsh integration ──
# Source this file in your .zshrc:
#   source ~/.local/share/claude-shell/ai.zsh

autoload -Uz add-zsh-hook

# ── Config ──
AISH_CONFIG_DIR="${CLAUDE_SHELL_CONFIG_DIR:-$HOME/.config/claude-shell}"
AISH_STATE_FILE="$AISH_CONFIG_DIR/shell-state.json"
AISH_CLIENT="${AISH_CLIENT_PATH:-$HOME/.local/bin/aish-client}"

# ── Shell state tracking ──
# Records cwd, last commands, exit code after every command
typeset -a _aish_cmd_history
_aish_last_output=""

_aish_preexec() {
  _aish_last_cmd="$1"
}

_aish_precmd() {
  local last_exit=$?

  # Don't track if config dir doesn't exist
  [[ -d "$AISH_CONFIG_DIR" ]] || mkdir -p "$AISH_CONFIG_DIR"

  # Update command history (keep last 5)
  if [[ -n "$_aish_last_cmd" ]]; then
    _aish_cmd_history+=("$_aish_last_cmd")
    # Keep only last 5
    while (( ${#_aish_cmd_history[@]} > 5 )); do
      shift _aish_cmd_history
    done
  fi

  # Build JSON array of recent commands
  local cmds_json="["
  local first=1
  for cmd in "${_aish_cmd_history[@]}"; do
    # Escape for JSON: backslash, quotes, and control characters
    local escaped="${cmd//\\/\\\\}"
    escaped="${escaped//\"/\\\"}"
    escaped="${escaped//$'\n'/\\n}"
    escaped="${escaped//$'\t'/\\t}"
    escaped="${escaped//$'\r'/\\r}"
    if (( first )); then
      cmds_json+="\"$escaped\""
      first=0
    else
      cmds_json+=",\"$escaped\""
    fi
  done
  cmds_json+="]"

  # Escape PWD for JSON (handles quotes, backslashes, control chars)
  local escaped_pwd="${PWD//\\/\\\\}"
  escaped_pwd="${escaped_pwd//\"/\\\"}"
  escaped_pwd="${escaped_pwd//$'\n'/\\n}"
  escaped_pwd="${escaped_pwd//$'\t'/\\t}"
  escaped_pwd="${escaped_pwd//$'\r'/\\r}"

  # Write shell state
  cat > "$AISH_STATE_FILE" <<EOF
{
  "cwd": "$escaped_pwd",
  "last_commands": $cmds_json,
  "last_exit_code": $last_exit,
  "last_output_preview": ""
}
EOF

  unset _aish_last_cmd
}

add-zsh-hook preexec _aish_preexec
add-zsh-hook precmd _aish_precmd

# Capture script directory at source-time (not inside function)
_AISH_SCRIPT_DIR="${${(%):-%x}:A:h}"

# ── ai command ──
ai() {
  if [[ ! -x "$AISH_CLIENT" ]]; then
    # Fallback: try node directly using source-time path
    local dist_client="$(dirname "$_AISH_SCRIPT_DIR")/dist/client.js"
    if [[ -f "$dist_client" ]]; then
      node "$dist_client" "$@"
      return $?
    fi
    echo "Error: aish-client not found at $AISH_CLIENT" >&2
    echo "Run: cd ~/claude-shell && ./install.sh" >&2
    return 1
  fi

  "$AISH_CLIENT" "$@"
}

# ── Pipe support: capture last command output ──
# Usage: some_command | ai "explain this"
# The stdin pipe is handled by the client itself

# ── Completions ──
_ai_completions() {
  local -a commands
  commands=(
    '--status:Show context status'
    '--compact:Compress current window'
    '--clear:Clear window (keep memory)'
    '--forget:Clear all context'
    '--topic:Switch to new topic'
    '--recall:Recall previous topic'
    '--remember:Save fact to memory'
    '--start:Start daemon'
    '--stop:Stop daemon'
    '--help:Show help'
  )
  _describe 'command' commands
}

compdef _ai_completions ai
