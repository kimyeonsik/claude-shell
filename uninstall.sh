#!/bin/bash
set -e

BIN_DIR="$HOME/.local/bin"
SHARE_DIR="$HOME/.local/share/claude-shell"
CONFIG_DIR="$HOME/.config/claude-shell"

echo "── Uninstalling Claude Shell (aish) ──"

# 1. Stop daemon if running
SOCK="$CONFIG_DIR/daemon.sock"
if [ -S "$SOCK" ]; then
  echo "→ Stopping daemon..."
  "$BIN_DIR/aish-client" --stop 2>/dev/null || true
  sleep 1
  rm -f "$SOCK"
fi

# 2. Remove binaries
echo "→ Removing binaries..."
rm -f "$BIN_DIR/aish-daemon" "$BIN_DIR/aish-client" "$BIN_DIR/aish"

# 3. Remove shared files
echo "→ Removing share dir..."
rm -rf "$SHARE_DIR"

# 4. Remove from .zshrc
ZSHRC="$HOME/.zshrc"
if [ -f "$ZSHRC" ]; then
  # Remove the marker and source line (cross-platform)
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' '/# claude-shell (aish)/d' "$ZSHRC"
    sed -i '' '/claude-shell\/shell\/ai.zsh/d' "$ZSHRC"
  else
    sed -i '/# claude-shell (aish)/d' "$ZSHRC"
    sed -i '/claude-shell\/shell\/ai.zsh/d' "$ZSHRC"
  fi
  echo "→ Removed from .zshrc"
fi

# 5. Ask about config
echo ""
read -rp "Remove config and memory? ($CONFIG_DIR) [y/N] " answer
if [[ "$answer" =~ ^[Yy]$ ]]; then
  rm -rf "$CONFIG_DIR"
  echo "→ Config removed"
else
  echo "→ Config preserved at $CONFIG_DIR"
fi

echo ""
echo "✓ Uninstalled. Restart your shell."
