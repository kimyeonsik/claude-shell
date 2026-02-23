#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="$HOME/.local/bin"
SHARE_DIR="$HOME/.local/share/claude-shell"
CONFIG_DIR="$HOME/.config/claude-shell"

echo "── Installing Claude Shell (aish) ──"

# 0. Check prerequisites
if ! command -v node &>/dev/null; then
  echo "Error: node not found. Install Node.js 18+ first." >&2
  exit 1
fi
if ! command -v npm &>/dev/null; then
  echo "Error: npm not found." >&2
  exit 1
fi

# 1. Build TypeScript
echo "→ Building..."
cd "$SCRIPT_DIR"
npm install --silent
npm run build --silent

# 2. Create directories
mkdir -p "$BIN_DIR" "$SHARE_DIR" "$CONFIG_DIR"

if [ -t 0 ]; then
  echo ""
  echo "Select language / 언어를 선택하세요:"
  echo "  [1] English (default)"
  echo "  [2] 한국어 (Korean)"
  printf "Choice [1/2]: "
  read -r LANG_CHOICE || LANG_CHOICE="1"
else
  LANG_CHOICE="1"
fi
case "$LANG_CHOICE" in
  2|ko) SELECTED_LANG="ko" ;;
  *)    SELECTED_LANG="en" ;;
esac
echo "$SELECTED_LANG" > "$CONFIG_DIR/lang"
echo "→ Language: $SELECTED_LANG"

# 3. Copy dist and node_modules
echo "→ Copying files..."
cp -r "$SCRIPT_DIR/dist" "$SHARE_DIR/"
cp -r "$SCRIPT_DIR/node_modules" "$SHARE_DIR/"
cp -r "$SCRIPT_DIR/shell" "$SHARE_DIR/"
cp "$SCRIPT_DIR/package.json" "$SHARE_DIR/"

# 4. Create wrapper scripts
cat > "$BIN_DIR/aish-daemon" << WRAPPER
#!/bin/bash
cd "$SHARE_DIR"
exec node "$SHARE_DIR/dist/daemon.js" "\$@"
WRAPPER
chmod +x "$BIN_DIR/aish-daemon"

cat > "$BIN_DIR/aish-client" << WRAPPER
#!/bin/bash
exec node "$SHARE_DIR/dist/client.js" "\$@"
WRAPPER
chmod +x "$BIN_DIR/aish-client"

cat > "$BIN_DIR/aish" << WRAPPER
#!/bin/bash
exec node "$SHARE_DIR/dist/client.js" "\$@"
WRAPPER
chmod +x "$BIN_DIR/aish"

# 5. Add to zsh if not already present
ZSHRC="$HOME/.zshrc"
MARKER="# claude-shell (aish)"
SOURCE_LINE="source $SHARE_DIR/shell/ai.zsh"

if ! grep -q "$MARKER" "$ZSHRC" 2>/dev/null; then
  echo "" >> "$ZSHRC"
  echo "$MARKER" >> "$ZSHRC"
  echo "$SOURCE_LINE" >> "$ZSHRC"
  echo "→ Added to .zshrc"
else
  echo "→ Already in .zshrc"
fi

# 6. Ensure ~/.local/bin is in PATH
if ! echo "$PATH" | grep -q "$BIN_DIR"; then
  echo ""
  echo "⚠  Add to your PATH if not already:"
  echo "   export PATH=\"\$HOME/.local/bin:\$PATH\""
fi

echo ""
echo "✓ Installed!"
echo ""
echo "Usage:"
echo "  ai hello                    # One-shot: Talk to Claude"
echo "  ai --status                 # One-shot: Check context"
echo "  ai --help                   # One-shot: All commands"
echo ""
echo "  aish                        # Interactive shell (shell + AI integrated)"
echo "  aish $ > why does this fail # Ask AI inside interactive shell"
echo "  aish $ npm test |> explain  # Pipe command output to AI"
echo ""

# 7. Activate in current shell
AI_ZSH="$SHARE_DIR/shell/ai.zsh"
if [[ -n "$ZSH_VERSION" ]]; then
  # Script is being sourced from zsh — activate immediately
  # shellcheck disable=SC1090
  source "$AI_ZSH"
  echo "✓ Activated in current shell. Try: ai --help"
else
  # Running as a bash subprocess — cannot affect parent shell
  echo "→ Activate in your current shell:"
  echo "   source ~/.zshrc"
  echo "   (or open a new terminal)"
fi
