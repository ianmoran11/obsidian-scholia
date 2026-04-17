#!/usr/bin/env bash
# Usage: record.sh <output.mp4> <seconds>
set -euo pipefail
OUT="$1"; DUR="${2:-45}"
mkdir -p "$(dirname "$OUT")"
ffmpeg -y -f avfoundation -framerate 30 -i "1:none" -t "$DUR" \
    -vcodec libx264 -preset veryfast -pix_fmt yuv420p "$OUT"