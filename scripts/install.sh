#!/bin/sh
# OpenAnalytics CLI installer.
#
# Usage:
#   curl -fsSL https://github.com/andrejvysny/OpenAnalytics/releases/latest/download/install.sh | sh
#
# Flags (set via env vars before piping to sh):
#   OA_VERSION=v0.1.0       # specific release tag (defaults to "latest")
#   OA_INSTALL_DIR=$HOME/.local/bin
#   OA_OWNER=andrejvysny    # GitHub org / user
#   OA_REPO=OpenAnalytics
#   OA_NO_SERVICE=1         # skip the launchd/systemd auto-install prompt
#   OA_FORCE_SERVICE=1      # install service non-interactively (when piping)

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
TARGET="$INSTALL_DIR/oa${EXT}"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

if [ "$VERSION" = "latest" ]; then
  URL="https://github.com/${OWNER}/${REPO}/releases/latest/download/${ASSET}"
  SUMS_URL="https://github.com/${OWNER}/${REPO}/releases/latest/download/SHA256SUMS"
else
  URL="https://github.com/${OWNER}/${REPO}/releases/download/${VERSION}/${ASSET}"
  SUMS_URL="https://github.com/${OWNER}/${REPO}/releases/download/${VERSION}/SHA256SUMS"
fi

download() {
  src="$1"
  dst="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fL --progress-bar -o "$dst" "$src"
  elif command -v wget >/dev/null 2>&1; then
    wget -q --show-progress -O "$dst" "$src"
  else
    echo "error: need curl or wget" >&2
    exit 1
  fi
}

echo "Downloading ${ASSET}"
echo "  from ${URL}"
download "$URL" "$TMPDIR/$ASSET"

echo "Downloading SHA256SUMS"
echo "  from ${SUMS_URL}"
download "$SUMS_URL" "$TMPDIR/SHA256SUMS"

expected="$(awk -v asset="$ASSET" '$2 == asset { print $1; exit }' "$TMPDIR/SHA256SUMS")"
if [ -z "$expected" ]; then
  echo "error: SHA256SUMS does not contain ${ASSET}" >&2
  exit 1
fi
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$TMPDIR/$ASSET" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  actual="$(shasum -a 256 "$TMPDIR/$ASSET" | awk '{print $1}')"
else
  echo "error: need sha256sum or shasum for verification" >&2
  exit 1
fi
if [ "$actual" != "$expected" ]; then
  echo "error: checksum verification failed for ${ASSET}" >&2
  echo "  expected: $expected" >&2
  echo "  actual:   $actual" >&2
  exit 1
fi
echo "✓ SHA256 verified"

chmod +x "$TMPDIR/$ASSET"
mv "$TMPDIR/$ASSET" "$TARGET.tmp"
mv "$TARGET.tmp" "$TARGET"

echo
echo "✓ Installed: $TARGET"
"$TARGET" --version 2>/dev/null || true

case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    echo
    echo "Note: $INSTALL_DIR is not on PATH. Add this to your shell rc:"
    echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
    ;;
esac

# -----------------------------------------------------------------------------
# Optional: register as a background service (launchd / systemd / nssm)
# -----------------------------------------------------------------------------
maybe_install_service() {
  [ "${OA_NO_SERVICE:-}" = "1" ] && return 0

  case "$os" in
    darwin)
      PLIST="$HOME/Library/LaunchAgents/dev.openanalytics.daemon.plist"
      if [ "${OA_FORCE_SERVICE:-}" != "1" ] && [ -t 0 ]; then
        printf "\nInstall the daemon as a launchd service so it runs at login? [Y/n] "
        read -r answer
        case "$answer" in [nN]|[nN][oO]) return 0 ;; esac
      elif [ "${OA_FORCE_SERVICE:-}" != "1" ]; then
        echo
        echo "Skipping launchd service install (run interactively or set OA_FORCE_SERVICE=1)."
        echo "Manual install:"
        echo "  curl -fsSL https://github.com/${OWNER}/${REPO}/releases/latest/download/install.sh | OA_FORCE_SERVICE=1 sh"
        return 0
      fi
      mkdir -p "$(dirname "$PLIST")"
      cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>dev.openanalytics.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>${TARGET}</string>
    <string>daemon</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${HOME}/.local/state/oa-daemon.log</string>
  <key>StandardErrorPath</key><string>${HOME}/.local/state/oa-daemon.log</string>
</dict>
</plist>
PLIST
      mkdir -p "$HOME/.local/state"
      launchctl unload "$PLIST" 2>/dev/null || true
      launchctl load -w "$PLIST"
      echo "✓ launchd service loaded: dev.openanalytics.daemon"
      echo "  logs: tail -f $HOME/.local/state/oa-daemon.log"
      echo "  stop: launchctl unload $PLIST"
      ;;

    linux)
      UNIT="$HOME/.config/systemd/user/oa-daemon.service"
      if [ "${OA_FORCE_SERVICE:-}" != "1" ] && [ -t 0 ]; then
        printf "\nInstall the daemon as a systemd user service so it runs at login? [Y/n] "
        read -r answer
        case "$answer" in [nN]|[nN][oO]) return 0 ;; esac
      elif [ "${OA_FORCE_SERVICE:-}" != "1" ]; then
        echo
        echo "Skipping systemd service install (run interactively or set OA_FORCE_SERVICE=1)."
        return 0
      fi
      command -v systemctl >/dev/null 2>&1 || { echo "systemctl not found — skipping service install"; return 0; }
      mkdir -p "$(dirname "$UNIT")"
      cat > "$UNIT" <<UNIT
[Unit]
Description=OpenAnalytics daemon — sync Claude Code session metrics
After=network-online.target

[Service]
Type=simple
ExecStart=${TARGET} daemon
Restart=on-failure
RestartSec=10
Environment=PATH=${INSTALL_DIR}:/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
UNIT
      systemctl --user daemon-reload
      systemctl --user enable --now oa-daemon
      echo "✓ systemd user service enabled: oa-daemon"
      echo "  logs:  journalctl --user -u oa-daemon -f"
      echo "  stop:  systemctl --user disable --now oa-daemon"
      echo
      echo "Tip: 'loginctl enable-linger \$USER' keeps the daemon running"
      echo "     even when you're logged out of all sessions."
      ;;

    windows)
      echo
      echo "Windows service install isn't automated yet. Manual options:"
      echo "  - Run 'oa daemon' inside a terminal multiplexer (tmux / WSL)."
      echo "  - Use NSSM:  nssm install OADaemon ${TARGET} daemon"
      ;;
  esac
}

# Only attempt service install if the user is logged in to an OA server already
# OR they explicitly forced it. Otherwise the daemon will exit on launch with
# 'not logged in' — useless.
if [ -f "$HOME/.config/openanalytics/config.json" ] || [ "${OA_FORCE_SERVICE:-}" = "1" ]; then
  maybe_install_service || true
else
  cat <<MSG

Next steps:
  1. Create an API key in the dashboard → Settings → API keys
  2. oa login --api-url https://your-instance.example.com --api-key oa_live_...
  3. oa import       # backfill existing transcripts
  4. Re-run this installer with OA_FORCE_SERVICE=1 to register the daemon
     OR run \`oa daemon\` manually in a terminal multiplexer.
MSG
fi
