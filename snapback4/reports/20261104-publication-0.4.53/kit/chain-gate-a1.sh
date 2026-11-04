#!/bin/bash
# 0.4.53: watched pre-gate for chain-a1 (native attempt 1 at 9da2c76fdf;/prepare/lean/warm). Waits for AC power + open lid (and lets the
# post-wake load settle: 1-min load < 60, at most 30 min), runs chain-a1.sh while polling every 60 s; if the Mac goes
# on battery, the lid closes or pmset logs a sleep during the chain, it records chain-a1.env-invalid (the native
# witness would then be environment-invalid and is rerun as attempt 1).
K=$HOME/sb4-pub-0453; L=$K/chain-a1.log
log() { echo "$(date -u +%FT%TZ) $*" >> $L; }
power() { ac=$(pmset -g batt | head -1 | /usr/bin/grep -c "AC Power"); lid=$(ioreg -r -k AppleClamshellState | /usr/bin/grep -c '"AppleClamshellState" = No'); load=$(sysctl -n vm.loadavg | awk '{print int($2)}'); }
# Resource waiting precedes the watched native proof, so waiting on battery cannot invalidate an unstarted witness.
while :; do
  power
  free=$(df -g "$HOME" | tail -1 | awk '{print $4}')
  [ "$free" -ge 45 ] && [ "$ac" = 1 ] && [ "$lid" = 1 ] && [ "$load" -lt 60 ] && break
  log "RESOURCE WAIT: disk=${free}GiB ac=$ac lid_open=$lid load=$load"
  if [ "$ac" != 1 ]; then sleep 600; elif [ "$free" -lt 45 ]; then sleep 900; else sleep 60; fi
done
log "gate ok: ac=$ac lid_open=$lid load=$load batt=$(pmset -g batt | sed -n 2p | awk '{print $3,$4}')"
start_pm=$(date "+%Y-%m-%d %H:%M:%S")
caffeinate -ims bash ./chain-a1.sh &
pid=$!
while kill -0 $pid 2>/dev/null; do
  sleep 60; power
  slept=$(pmset -g log | awk -v s="$start_pm" '($1" "$2)>=s' | /usr/bin/grep -E "Entering Sleep|Clamshell Sleep" | tail -1)
  r=""; [ "$ac" != 1 ] && r="on battery"; [ "$lid" != 1 ] && r="lid closed"; [ -n "$slept" ] && r="slept: $slept"
  if [ -n "$r" ] && [ ! -e $K/chain-a1.env-invalid ]; then log "ENVIRONMENT-INVALID during chain: $r"; echo "$r" > $K/chain-a1.env-invalid; fi
done
wait $pid; log "gate: chain exit $? ($(ls $K/chain-a1.env-invalid 2>/dev/null || echo env-ok))"
