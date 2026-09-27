#!/bin/bash
# ---------------------------------------------------------------------
# Chạm HQ - make this Mac run the background jobs, every day, by itself.
#
# Before running: put the key files in ~/.cham-hq (unzip the
# cham-mac-keys.zip Peter made on Windows into your home folder):
#     unzip ~/Downloads/cham-mac-keys.zip -d ~
# Then, in Terminal:
#     curl -fsSL https://raw.githubusercontent.com/Peterachss/cham-hq/main/scripts/setup_mac.sh | bash
#
# It installs (as your user - no admin password, nothing system-wide):
#   notifications      every 15 minutes
#   announcements      always running, sends within seconds
#   finance sheet sync every hour
#   nightly backup     2:10am, to ~/.cham-hq/backups
#   code update        3:07am (git pull, so the Mac always runs the latest)
#   stay awake         keeps the Mac from sleeping while it's plugged in
# Each restarts on its own if it stops. Run this script again any time
# to repair or update; run it with --remove to take everything off.
# ---------------------------------------------------------------------
set -euo pipefail
REPO="$HOME/cham-hq"
HQ="$HOME/.cham-hq"
LA="$HOME/Library/LaunchAgents"
UIDN="$(id -u)"
JOBS="push announce finance backup update awake"
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

if [ "${1:-}" = "--remove" ]; then
  for j in $JOBS; do
    launchctl bootout "gui/$UIDN/com.cham.$j" 2>/dev/null || true
    rm -f "$LA/com.cham.$j.plist"
  done
  echo "Removed the Chạm HQ jobs from this Mac."
  exit 0
fi

say "1/5  Key files"
for f in firebase-key.json vapid.json config.json; do
  if [ ! -f "$HQ/$f" ]; then
    echo "Missing $HQ/$f"
    echo "Unzip the key file Peter made into your home folder first:"
    echo "    unzip ~/Downloads/cham-mac-keys.zip -d ~"
    exit 1
  fi
done
chmod 700 "$HQ"; chmod 600 "$HQ"/*.json
echo "found"

say "2/5  Python"
PY="$(command -v python3 || true)"
if [ -z "$PY" ] || ! "$PY" -c "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)" 2>/dev/null; then
  echo "Python 3 isn't ready on this Mac. Run:  xcode-select --install"
  echo "then run this script again."
  exit 1
fi
"$PY" -m pip install --user --upgrade --quiet --disable-pip-version-check google-cloud-firestore pywebpush pynacl
echo "$("$PY" --version) with the libraries the jobs need"

say "3/5  The code"
if [ -d "$REPO/.git" ]; then git -C "$REPO" pull --quiet; else git clone --quiet https://github.com/Peterachss/cham-hq.git "$REPO"; fi
# the members-only base data never goes in the public repo
if [ -f "$HQ/data.json" ]; then cp "$HQ/data.json" "$REPO/data.json"; fi
echo "$REPO is up to date"

say "4/5  Background jobs"
mkdir -p "$LA" "$HQ/logs"
S() { for a in "$@"; do printf '<string>%s</string>' "$a"; done; }
job() {   # name  program-args  schedule
  cat > "$LA/com.cham.$1.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.cham.$1</string>
  <key>ProgramArguments</key><array>$2</array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>EnvironmentVariables</key><dict><key>PYTHONIOENCODING</key><string>utf-8</string></dict>
  $3
  <key>StandardOutPath</key><string>$HQ/logs/mac-$1.log</string>
  <key>StandardErrorPath</key><string>$HQ/logs/mac-$1.log</string>
</dict></plist>
EOF
  launchctl bootout "gui/$UIDN/com.cham.$1" 2>/dev/null || true
  launchctl bootstrap "gui/$UIDN" "$LA/com.cham.$1.plist"
  echo "  com.cham.$1"
}
job push     "$(S "$PY" "$REPO/scripts/push.py")"                  '<key>StartInterval</key><integer>900</integer><key>RunAtLoad</key><true/>'
job announce "$(S "$PY" "$REPO/scripts/announce.py" --watch)"      '<key>KeepAlive</key><true/><key>RunAtLoad</key><true/><key>ThrottleInterval</key><integer>60</integer>'
job finance  "$(S "$PY" "$REPO/scripts/sync_finance.py")"          '<key>StartInterval</key><integer>3600</integer><key>RunAtLoad</key><true/>'
job backup   "$(S "$PY" "$REPO/scripts/backup.py")"                '<key>StartCalendarInterval</key><dict><key>Hour</key><integer>2</integer><key>Minute</key><integer>10</integer></dict>'
job update   "$(S /bin/sh -c "cd '$REPO' && git pull --quiet")"    '<key>StartCalendarInterval</key><dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>7</integer></dict>'
job awake    "$(S /usr/bin/caffeinate -s)"                         '<key>KeepAlive</key><true/><key>RunAtLoad</key><true/>'

say "5/5  First check"
"$PY" "$REPO/scripts/push.py" --dry-run 2>&1 | tail -2
cat <<'EOF'

Done. This Mac now runs Chạm HQ's background jobs. On the site (Updates tab
-> Background jobs) the rows will say "on the Mac" within 15 minutes.

Keep it plugged in. "Stay awake" stops it sleeping on power, but closing the
lid still sleeps it - leave the lid open (or use an external screen).
Logs: ~/.cham-hq/logs/mac-*.log     Remove: bash ~/cham-hq/scripts/setup_mac.sh --remove
EOF
