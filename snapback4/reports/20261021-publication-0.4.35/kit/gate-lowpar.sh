#!/bin/bash
# 0.4.35 Mac dry-run gate with in-run power watch.
# Starts `publish.sh dry-run` (attempt $ATT) only on AC power with the lid open, on the expected commit with a clean tree.
# While it runs, polls every 60 s: if the Mac is on battery, the lid is closed, or the Mac slept (pmset "Entering Sleep"
# after the start, or a wall-clock gap > 300 s between polls), the attempt is marked environment-invalid at once
# (dry-run-$ATT.env-invalid), its process tree is killed, leftovers are cleaned, and the gate waits for AC + open lid
# and restarts as attempt $ATT+1. Ends when an attempt finishes (done or a real red: stopped), or after MAXATT.
# env: ATT (first attempt number), COMMIT (expected HEAD), MAXATT (default ATT+5)
K=/Users/ccheever/sb4-pub-0435; W=/Users/ccheever/projects/snapback-pub-0428/snapback4
ATT=${ATT:?}; COMMIT=${COMMIT:?}; MAXATT=${MAXATT:-$((ATT+5))}
L=$K/gate.log
log() { echo "$(date -u +%FT%TZ) $*" >> $L; }
power() { ac=$(pmset -g batt | head -1 | grep -c "AC Power"); lid=$(ioreg -r -k AppleClamshellState | grep -c '"AppleClamshellState" = No'); }
descendants() { local c; for c in $(pgrep -P "$1"); do descendants "$c"; echo "$c"; done; }
killrun() {
  local pids; pids=$(descendants "$1"; echo "$1")
  kill $pids 2>/dev/null; sleep 5; kill -9 $pids 2>/dev/null
  for pat in "pubstep.sh publication-dry-run" "publish.mjs --dry-run" "$W/scripts/test.sh" "$W/scripts/run-client-tests.mjs" "$W/scripts/test-file-owner" "$W/packages/snapback4/test/" "$W/target/"; do pkill -f "$pat" 2>/dev/null; done
  sleep 3
  for pat in "$W/scripts/" "$W/packages/snapback4/test/" "$W/target/"; do pkill -9 -f "$pat" 2>/dev/null; done
}
cleanup() {
  cd $W && find . -maxdepth 4 -name ".rg-matrix-*" -not -path "*/node_modules/*" -exec rm -rf {} + 2>/dev/null
  if [ -n "$(git -C $W status --porcelain)" ]; then log "tree dirty after kill: $(git -C $W status --porcelain | tr '\n' ' ')"; git -C $W checkout -- metrics/publish.jsonl metrics/witness.jsonl 2>/dev/null; fi
}
while [ "$ATT" -le "$MAXATT" ]; do
  # wait for AC + open lid
  while :; do power; [ "$ac" = 1 ] && [ "$lid" = 1 ] && break; log "waiting att=$ATT ac=$ac lid_open=$lid"; sleep 120; done
  cleanup
  head=$(git -C $W rev-parse HEAD); dirty=$(git -C $W status --porcelain)
  if [ "$head" != "$COMMIT" ] || [ -n "$dirty" ]; then log "REFUSE att=$ATT head=$head dirty=[$dirty]"; echo "refused head/dirty" > $K/dry-run-$ATT.exit; exit 1; fi
  [ -e $K/dry-run-$ATT.exit ] && { log "dry-run-$ATT.exit already exists; stop"; exit 1; }
  log "starting dry run attempt $ATT ($(pmset -g batt | sed -n 2p | awk '{print $3}'))"
  start_epoch=$(date +%s); start_pm=$(date "+%Y-%m-%d %H:%M:%S")
  (cd $K && ATTEMPT=$ATT exec caffeinate -ims bash ./publish-lowpar.sh dry-run > dryrun-a$ATT.log 2>&1 < /dev/null) &
  pid=$!; echo $pid > $K/dry-run-$ATT.pid
  last=$(date +%s); reason=""
  while kill -0 $pid 2>/dev/null; do
    sleep 60; now=$(date +%s); power
    slept=$(pmset -g log | awk -v s="$start_pm" '($1" "$2)>=s' | grep -E "Entering Sleep|Clamshell Sleep" | tail -1)
    if [ "$ac" != 1 ]; then reason="on battery"
    elif [ "$lid" != 1 ]; then reason="lid closed"
    elif [ -n "$slept" ]; then reason="slept: $slept"
    elif [ $((now-last)) -gt 300 ]; then reason="wall-clock gap $((now-last)) s (sleep)"
    fi
    last=$now
    if [ -n "$reason" ] && kill -0 $pid 2>/dev/null; then
      log "ENVIRONMENT-INVALID att=$ATT after $((now-start_epoch)) s: $reason"
      echo "environment-invalid: $reason (after $((now-start_epoch)) s)" > $K/dry-run-$ATT.env-invalid
      killrun $pid; wait $pid 2>/dev/null; cleanup
      break
    fi
  done
  wait $pid 2>/dev/null
  if [ -e $K/dry-run-$ATT.env-invalid ]; then ATT=$((ATT+1)); continue; fi
  log "attempt $ATT finished: $(cat $K/dry-run-$ATT.exit 2>/dev/null || echo no-exit-file) after $(( $(date +%s)-start_epoch )) s"
  exit 0
done
log "MAXATT reached"; exit 1
