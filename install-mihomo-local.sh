#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="$BASE_DIR/bin"
OS_NAME="$(uname -s)"
ARCH_NAME="$(uname -m)"
MIHOMO_VERSION="${MIHOMO_VERSION:-v1.19.21}"

if [[ "$OS_NAME" != "Darwin" ]]; then
  echo "[ERROR] This installer currently supports macOS only." >&2
  exit 1
fi

case "$ARCH_NAME" in
  arm64)
    ASSET_ARCH="arm64"
    ;;
  x86_64)
    ASSET_ARCH="amd64-compatible"
    ;;
  *)
    echo "[ERROR] Unsupported macOS architecture: $ARCH_NAME" >&2
    exit 1
    ;;
esac

ASSET_NAME="mihomo-darwin-${ASSET_ARCH}-${MIHOMO_VERSION}.gz"
DOWNLOAD_URL="https://github.com/MetaCubeX/mihomo/releases/download/${MIHOMO_VERSION}/${ASSET_NAME}"
TMP_DIR="$(mktemp -d)"
TMP_GZ="$TMP_DIR/${ASSET_NAME}"
TMP_BIN="$TMP_DIR/mihomo"
DEST_BIN="$BIN_DIR/mihomo-${ARCH_NAME}"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

mkdir -p "$BIN_DIR"

echo "[INFO] Downloading $ASSET_NAME"
curl -L --fail --output "$TMP_GZ" "$DOWNLOAD_URL"

echo "[INFO] Extracting mihomo"
gunzip -c "$TMP_GZ" >"$TMP_BIN"
chmod +x "$TMP_BIN"
mv "$TMP_BIN" "$DEST_BIN"
chmod +x "$DEST_BIN"

echo "[OK] Installed local binary: $DEST_BIN"
"$DEST_BIN" -v || true
echo "[INFO] You can now run: ./start-mihomo-nodes.sh"
