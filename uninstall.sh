#!/bin/bash
set -e

BIN_DIR="$HOME/.local/bin"
SHARE_DIR="$HOME/.local/share/claude-shell"
CONFIG_DIR="$HOME/.config/claude-shell"

# --yes flag: skip interactive config prompt, keep config (for reinstall)
AUTO_KEEP_CONFIG=false
for arg in "$@"; do
  [[ "$arg" == "--yes" || "$arg" == "-y" ]] && AUTO_KEEP_CONFIG=true
done

echo "── Uninstalling Claude Shell (aish) ──"

# 1. Stop daemon if running
SOCK="$CONFIG_DIR/daemon.sock"
if [ -S "$SOCK" ]; then
  echo "→ Stopping daemon..."
  "$BIN_DIR/aish-client" --stop 2>/dev/null || true
  sleep 1
  rm -f "$SOCK"
fi

# 2. Remove PID file
rm -f "$CONFIG_DIR/daemon.pid"

# 3. Remove binaries
echo "→ Removing binaries..."
rm -f "$BIN_DIR/aish-daemon" "$BIN_DIR/aish-client" "$BIN_DIR/aish"

# 4. Remove npm global install (if present)
if npm ls -g claude-shell --depth=0 &>/dev/null 2>&1; then
  echo "→ Removing npm global install..."
  npm uninstall -g claude-shell 2>/dev/null || true
fi

# 5. Remove shared files
echo "→ Removing share dir..."
rm -rf "$SHARE_DIR"

# 6. Remove from .zshrc
ZSHRC="$HOME/.zshrc"
if [ -f "$ZSHRC" ]; then
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' '/# claude-shell (aish)/d' "$ZSHRC"
    sed -i '' '/claude-shell\/shell\/ai.zsh/d' "$ZSHRC"
  else
    sed -i '/# claude-shell (aish)/d' "$ZSHRC"
    sed -i '/claude-shell\/shell\/ai.zsh/d' "$ZSHRC"
  fi
  echo "→ Removed from .zshrc"
fi

# 7. Config removal
echo ""
if $AUTO_KEEP_CONFIG; then
  echo "→ Config preserved at $CONFIG_DIR (--yes mode)"
else
  read -rp "Remove config and memory? ($CONFIG_DIR) [y/N] " answer
  if [[ "$answer" =~ ^[Yy]$ ]]; then
    rm -rf "$CONFIG_DIR"
    echo "→ Config removed"
  else
    echo "→ Config preserved at $CONFIG_DIR"
  fi
fi

echo ""
echo "✓ Uninstalled."
