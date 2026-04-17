#!/usr/bin/env bash
set -euo pipefail

VAULT_DIR="$(cd "$(dirname "$0")/.." && pwd)/test-vault"
PLUGIN_DIR="$VAULT_DIR/.obsidian/plugins/scholia"
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"

mkdir -p "$PLUGIN_DIR"

ln -sf "$SRC_DIR/main.js" "$PLUGIN_DIR/main.js"
ln -sf "$SRC_DIR/manifest.json" "$PLUGIN_DIR/manifest.json"
ln -sf "$SRC_DIR/styles.css" "$PLUGIN_DIR/styles.css"

echo "Scholia installed to test-vault: $PLUGIN_DIR"