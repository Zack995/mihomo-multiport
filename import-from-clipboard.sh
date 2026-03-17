#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v pbpaste >/dev/null 2>&1; then
  echo "[ERROR] pbpaste not found. This helper is for macOS." >&2
  exit 1
fi

pbpaste | node "$BASE_DIR/import-inline-nodes.js" "$@"
