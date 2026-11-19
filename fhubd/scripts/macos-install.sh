#!/usr/bin/env bash
# Build, sign and (re)install fhubd as the LaunchAgent dev.fstack.fhubd.
#
#   FHUBD_SIGN_IDENTITY="Developer ID Application: Name (TEAMID)" fhubd/scripts/macos-install.sh
#
# Idempotent: the bundle path, bundle id and signing identity never change, so
# TCC keeps the Full Disk Access grant across reinstalls (it matches the
# designated requirement, not the binary hash). If neither the binary nor the
# plist changed and the job is loaded, nothing is restarted. Only
# ~/Library/LaunchAgents/dev.fstack.fhubd.plist is ever touched.
set -euo pipefail

LABEL="dev.fstack.fhubd"
BUNDLE_ID="dev.fstack.fhubd"
APP="$HOME/Applications/fhubd.app"
BIN="$APP/Contents/MacOS/fhubd"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
CONFIG="$HOME/.config/fhub/fhubd.json"
TOKEN="$HOME/.config/fhub/token"
LOG_DIR="$HOME/Library/Logs/fhub"
DOMAIN="gui/$(id -u)"

die() { echo "macos-install: $*" >&2; exit 1; }

[[ "$(uname -s)" == "Darwin" ]] || die "macOS only"
[[ -n "${FHUBD_SIGN_IDENTITY:-}" ]] || die "set FHUBD_SIGN_IDENTITY to your \"Developer ID Application: ...\" identity"
[[ "$FHUBD_SIGN_IDENTITY" == "Developer ID Application:"* ]] \
  || die "FHUBD_SIGN_IDENTITY must be a \"Developer ID Application: ...\" identity; an ad-hoc or Apple Development signature changes the TCC identity"
security find-identity -v -p codesigning | grep -qF "$FHUBD_SIGN_IDENTITY" \
  || die "identity not found in the keychain: $FHUBD_SIGN_IDENTITY"
command -v go >/dev/null || die "go not found in PATH"

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(git -C "$SRC" describe --always --dirty 2>/dev/null || echo dev)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/fhubd-install.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

echo "==> go build ($VERSION)"
(cd "$SRC" && CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=$VERSION" -o "$WORK/fhubd" .)
NEW_SUM="$(shasum -a 256 "$WORK/fhubd" | cut -d' ' -f1)"

# The unsigned build hash is stored in the bundle because signing rewrites
# the binary, so comparing installed and fresh binaries directly never matches.
OLD_SUM="$(cat "$APP/Contents/Resources/build.sha256" 2>/dev/null || true)"
binary_changed=1
if [[ "$NEW_SUM" == "$OLD_SUM" ]] && codesign --verify --strict "$APP" 2>/dev/null; then
  binary_changed=0
fi

mkdir -p "$LOG_DIR" "$(dirname "$CONFIG")" "$HOME/Library/LaunchAgents" "$HOME/Applications"
chmod 700 "$(dirname "$CONFIG")"

if [[ ! -f "$TOKEN" ]]; then
  echo "==> creating API token at $TOKEN"
  (umask 077 && openssl rand -hex 32 >"$TOKEN")
fi
chmod 600 "$TOKEN"

if [[ ! -f "$CONFIG" ]]; then
  die "no config at $CONFIG; copy $SRC/examples/mac-mini.json there, fix its TODOs and run again"
fi
"$WORK/fhubd" -check -config "$CONFIG" || die "config check failed"

if [[ "$binary_changed" == 1 ]]; then
  echo "==> building bundle"
  STAGE="$WORK/fhubd.app"
  mkdir -p "$STAGE/Contents/MacOS" "$STAGE/Contents/Resources"
  cp "$WORK/fhubd" "$STAGE/Contents/MacOS/fhubd"
  echo "$NEW_SUM" >"$STAGE/Contents/Resources/build.sha256"
  cat >"$STAGE/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleName</key><string>fhubd</string>
  <key>CFBundleDisplayName</key><string>fhubd</string>
  <key>CFBundleExecutable</key><string>fhubd</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
  <key>LSBackgroundOnly</key><true/>
</dict>
</plist>
EOF
  plutil -lint "$STAGE/Contents/Info.plist" >/dev/null

  echo "==> signing with: $FHUBD_SIGN_IDENTITY (hardened runtime)"
  codesign --force --timestamp --options runtime \
    --identifier "$BUNDLE_ID" --sign "$FHUBD_SIGN_IDENTITY" "$STAGE"
  codesign --verify --strict --verbose=2 "$STAGE"
fi

LOG_FILE="$LOG_DIR/fhubd.log"
NEW_PLIST="$WORK/$LABEL.plist"
cat >"$NEW_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>AssociatedBundleIdentifiers</key><string>$BUNDLE_ID</string>
  <key>ProgramArguments</key>
  <array>
    <string>$BIN</string>
    <string>-config</string>
    <string>$CONFIG</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Standard</string>
  <!-- Above 2x the largest service stopTimeout, so fhubd can stop its children before launchd SIGKILLs it. -->
  <key>ExitTimeOut</key><integer>60</integer>
  <key>StandardOutPath</key><string>$LOG_FILE</string>
  <key>StandardErrorPath</key><string>$LOG_FILE</string>
</dict>
</plist>
EOF
plutil -lint "$NEW_PLIST" >/dev/null

plist_changed=1
if [[ -f "$PLIST" ]] && cmp -s "$NEW_PLIST" "$PLIST"; then
  plist_changed=0
fi
loaded=0
if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
  loaded=1
fi

if [[ "$binary_changed" == 0 && "$plist_changed" == 0 && "$loaded" == 1 ]]; then
  echo "==> fhubd already installed and running ($VERSION); nothing to do"
  exit 0
fi

if [[ "$loaded" == 1 ]]; then
  echo "==> stopping $LABEL"
  launchctl bootout "$DOMAIN/$LABEL" || true
  for _ in $(seq 1 90); do
    launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1 || break
    sleep 1
  done
  ! launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1 || die "$LABEL did not unload"
fi

if [[ "$binary_changed" == 1 ]]; then
  echo "==> installing $APP"
  rm -rf "$APP.old"
  [[ -d "$APP" ]] && mv "$APP" "$APP.old"
  mv "$WORK/fhubd.app" "$APP"
  rm -rf "$APP.old"
fi
if [[ "$plist_changed" == 1 ]]; then
  cp "$NEW_PLIST" "$PLIST"
  chmod 644 "$PLIST"
fi

echo "==> starting $LABEL"
launchctl enable "$DOMAIN/$LABEL"
launchctl bootstrap "$DOMAIN" "$PLIST"

codesign -d -r- "$APP" 2>&1 | sed -n 's/^designated => /designated requirement: /p'
cat <<EOF

Installed. Logs: $LOG_FILE and $LOG_DIR/<service>.log

First install only: grant Full Disk Access to $APP
  open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"
then press + and pick $APP, and restart the job:
  launchctl kickstart -k $DOMAIN/$LABEL
EOF
