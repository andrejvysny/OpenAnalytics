#!/bin/sh
# OpenAnalytics CLI installer.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/andrejvysny/OpenAnalytics/master/scripts/install.sh | sh
#
# Env overrides:
#   OA_VERSION=v0.1.0          # specific release (defaults to "latest")
#   OA_INSTALL_DIR=$HOME/.local/bin
#   OA_OWNER=andrejvysny       # GitHub org / user
#   OA_REPO=OpenAnalytics      # repo name
set -eu

OWNER="${OA_OWNER:-andrejvysny}"
REPO="${OA_REPO:-OpenAnalytics}"
VERSION="${OA_VERSION:-latest}"
INSTALL_DIR="${OA_INSTALL_DIR:-$HOME/.local/bin}"

OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS" in
  Darwin) os=darwin ;;
  Linux)  os=linux ;;
  MINGW*|MSYS*|CYGWIN*) os=windows ;;
  *) echo "unsupported OS: $OS"; exit 1 ;;
esac
case "$ARCH" in
  arm64|aarch64) arch=arm64 ;;
  x86_64|amd64)  arch=x64 ;;
  *) echo "unsupported arch: $ARCH"; exit 1 ;;
esac

EXT=""
[ "$os" = "windows" ] && EXT=".exe"
ASSET="oa-${os}-${arch}${EXT}"

mkdir -p "$INSTALL_DIR"

if [ "$VERSION" = "latest" ]; then
  URL="https://github.com/${OWNER}/${REPO}/releases/latest/download/${ASSET}"
else
  URL="https://github.com/${OWNER}/${REPO}/releases/download/${VERSION}/${ASSET}"
fi

target="$INSTALL_DIR/oa${EXT}"

echo "Downloading ${ASSET} from ${URL}"
if command -v curl >/dev/null 2>&1; then
  curl -fL --progress-bar -o "$target" "$URL"
elif command -v wget >/dev/null 2>&1; then
  wget -q --show-progress -O "$target" "$URL"
else
  echo "error: need curl or wget" >&2
  exit 1
fi
chmod +x "$target"

echo
echo "✓ Installed: $target"
"$target" --version 2>/dev/null || true

case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    echo
    echo "Note: $INSTALL_DIR is not on PATH. Add this to your shell rc:"
    echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
    ;;
esac

cat <<MSG

Next steps:
  1. Create an API key in the dashboard → Settings → API keys
  2. oa login --api-url https://oa.example.com --api-key oa_live_...
  3. oa import       # backfill existing transcripts
  4. oa daemon       # watch + sync continuously
MSG
