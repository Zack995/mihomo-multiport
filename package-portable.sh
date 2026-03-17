#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_DIR="$BASE_DIR/dist"
PACKAGE_ROOT="$DIST_DIR/mihomo-multiport-portable"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE_NAME="mihomo-multiport-portable-${TIMESTAMP}.tar.gz"
ARCHIVE_PATH="$DIST_DIR/$ARCHIVE_NAME"

mkdir -p "$DIST_DIR"
rm -rf "$PACKAGE_ROOT"

rsync -a \
  --exclude '.DS_Store' \
  --exclude 'dist/' \
  --exclude 'logs/' \
  --exclude 'runtime/' \
  --exclude 'nodes-inline.txt' \
  --exclude 'configs/hkg01.yaml' \
  --exclude 'configs/sgp01.yaml' \
  "$BASE_DIR/" "$PACKAGE_ROOT/"

tar -czf "$ARCHIVE_PATH" -C "$DIST_DIR" "$(basename "$PACKAGE_ROOT")"

echo "[OK] Portable package created:"
echo "     $ARCHIVE_PATH"
echo "[INFO] Copy this archive to another Mac, extract it, then run:"
echo "       ./install-mihomo-local.sh"
echo "       ./start-mihomo-nodes.sh"
echo "       npm run web"
