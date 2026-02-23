#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "── Dev Reinstall ──"
echo ""

# Uninstall (keep config — pass --yes to skip interactive prompt)
bash "$SCRIPT_DIR/uninstall.sh" --yes

echo ""

# Install fresh
bash "$SCRIPT_DIR/install.sh"
