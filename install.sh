#!/usr/bin/env bash
set -e

echo "============================================================"
echo "  HaymGraph - Adobe After Effects CEP Extension Installer"
echo "============================================================"
echo ""

# Enable PlayerDebugMode on macOS
echo "[*] Enabling CEP Debug Mode on macOS..."
for v in 9 10 11 12 13 14 15; do
    defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1 2>/dev/null || true
done
echo "[OK] PlayerDebugMode enabled."

EXT_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions"
mkdir -p "$EXT_DIR"

TARGET_DIR="$EXT_DIR/HaymGraph"
rm -rf "$TARGET_DIR"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ln -s "$SCRIPT_DIR" "$TARGET_DIR"

echo ""
echo "============================================================"
echo "  [SUCCESS] HaymGraph installed successfully!"
echo "  Location: $TARGET_DIR"
echo "  In After Effects: Window -> Extensions -> HaymGraph"
echo "============================================================"
