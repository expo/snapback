#!/bin/bash
# Autonomous progression through reversible qualification only; never uploads.
set -euo pipefail
K=$HOME/sb4-pub-0452-kit; R=$HOME/sb4-pub-0452-records; W=$HOME/sb4-pub-0441
M=ccheever@charlies-macbook-pro-m5max-black
export PATH=$HOME/.bun-1.4.2/bin:$HOME/.elan/bin:$HOME/.cargo/bin:$HOME/.local/bin:$PATH
log() { python3 "$K/log-status.py" "$*"; echo "$(date -u +%FT%TZ) $*"; }
remote() { timeout 45 ssh -o BatchMode=yes -o ConnectTimeout=15 "$M" "$@"; }
trap 'rc=$?; echo "$rc" > "$R/qualify-after-native-a2.exit"' EXIT
C=$(cat "$K/source.sha")
[ "$(cat "$R/finalize-source.exit")" = 0 ]
for f in publication-source-audit-linux publication-source-audit-mac; do [ "$(cat "$R/$f.exit")" = 0 ]; done
[ "$(git -C "$W" rev-parse HEAD)" = "$C" ]
[ "$(git -C "$W" rev-parse --abbrev-ref HEAD)" = HEAD ]
[ "$(remote 'git -C ~/sb4-pub-0444-wt rev-parse HEAD')" = "$C" ]
log "Waiting for native/prepare/canonical Mac audit at final source $C; this controller never publishes."
while :; do
 state=$(remote 'cd ~/sb4-pub-0452; for f in native-2 prepare-2 audit-mac-early; do test ! -e "$f.exit" || echo "$f=$(cat "$f.exit")"; done; test ! -e chain-a2.env-invalid || echo ENV_INVALID; tail -1 chain-a2.log' || true)
 case "$state" in *ENV_INVALID*|*stopped*|*FAILED*) log "HOLD: native chain needs classification: $state"; exit 1;; esac
 if echo "$state" | grep -q 'audit-mac-early=0' && echo "$state" | grep -q 'gate: chain exit 0 (env-ok)'; then break; fi
 if echo "$state" | grep -qE 'audit-mac-early=[1-9]'; then log "HOLD: canonical Mac audit red: $state"; exit 1; fi
 sleep 30
done
[ "$(remote 'git -C ~/sb4-pub-0444-wt rev-parse HEAD')" = "$C" ]
bash "$K/pull-client.sh" > "$R/pull-client.log" 2>&1
log 'Mac native/prepare/canonical audit passed; prepared client/Expo SHA256 equal on both hosts. Running Linux canonical audit before qualification.'
if node "$K/audit-fast.mjs" "$W/snapback4" "$W/snapback4/target/publication/client-0.4.52" "$R/audit-linux-early" > "$R/audit-linux-early.log" 2>&1; then
 echo 0 > "$R/audit-linux-early.exit"
else
 echo 1 > "$R/audit-linux-early.exit"
 log 'HOLD: canonical Linux audit red; no qualification suite or upload started.'; exit 1
fi
log 'Both canonical early audits PASSED; starting Linux qualification on Mac-prepared bytes and Mac warm/pre-darwin/dry-run continuation in parallel.'
free=$(df -BG --output=avail "$HOME" | tail -1 | tr -dc 0-9)
[ "$free" -ge 40 ] || { log "HOLD: Linux disk $free GiB; own target/debug cleanup required before qualification."; exit 75; }
bash "$K/start-linux.sh" 1 "$C" > "$R/start-linux-1.log" 2>&1
remote 'cd ~/sb4-pub-0452; C=$(git -C ~/sb4-pub-0444-wt rev-parse HEAD); nohup caffeinate -ims bash ./warm-pre-after-audit-a2.sh "$C" > warm-pre-a2.out 2>&1 < /dev/null & disown'
log 'Qualification jobs started; controller completed reversible setup. No upload invoked.'
