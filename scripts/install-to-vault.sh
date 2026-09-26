#!/usr/bin/env bash
set -euo pipefail

VAULT_DIR="$(cd "$(dirname "$0")/.." && pwd)/test-vault"
PLUGIN_DIR="$VAULT_DIR/.obsidian/plugins/scholia-reader"

mkdir -p "$PLUGIN_DIR"

# Keep the repository's test-vault fixture portable across checkouts.
ln -sf "../../../../main.js" "$PLUGIN_DIR/main.js"
ln -sf "../../../../manifest.json" "$PLUGIN_DIR/manifest.json"
ln -sf "../../../../styles.css" "$PLUGIN_DIR/styles.css"

echo "Scholia Reader installed to test-vault: $PLUGIN_DIR"
