#!/usr/bin/env bash
# Usage: record.sh <output.mp4> [seconds]
# Records macOS screen via avfoundation. Requires screen recording permission.
set -euo pipefail

OUT="${1:-}"
DUR="${2:-45}"

if [[ -z "$OUT" ]]; then
  echo "Usage: $0 <output.mp4> [seconds]" >&2
  exit 1
fi

if ! command -v ffmpeg &>/dev/null; then
  echo "Error: ffmpeg not found" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUT")"
ffmpeg -y -f avfoundation -framerate 30 -i "1:none" -t "$DUR" \
    -vcodec libx264 -preset veryfast -pix_fmt yuv420p "$OUT"
echo "Recording saved to: $OUT"