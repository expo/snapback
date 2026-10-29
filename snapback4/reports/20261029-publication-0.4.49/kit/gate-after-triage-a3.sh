#!/bin/bash
# 0.4.49 attempt 3 Mac (148cb4d372): after dry run 2's Rust red (snapback4::clock) was triaged as a flake (alone 6/6), wait for AC + open lid and
# load < 60, refresh the shared ~/.npm starter packuments online, check the tree, then start the tolerant dry-run gate
# (attempt 1, RUSTPROCS=2). The tail of chain-pre-a2.sh, run by hand after triage.
K=$HOME/sb4-pub-0449; cd $K; L=$K/chain-pre-a3.log; W=$HOME/sb4-pub-0444-wt/snapback4
log() { echo "$(date -u +%FT%TZ) $*" >> $L; }
power() { ac=$(pmset -g batt | head -1 | grep -c "AC Power"); lid=$(ioreg -r -k AppleClamshellState | grep -c "\"AppleClamshellState\" = No"); }
while :; do power; [ "$ac" = 1 ] && [ "$lid" = 1 ] && break; log "waiting ac=$ac lid_open=$lid"; sleep 60; done
for i in $(seq 1 30); do load=$(sysctl -n vm.loadavg | awk "{print int(\$2)}"); [ "$load" -lt 60 ] && break; log "waiting load=$load"; sleep 60; done
log "refresh start (after triage) load=$(sysctl -n vm.loadavg)"
REFRESH_TAG=a3b bash ./refresh-npm-cache-a1.sh > refresh-npm-cache-a3b.out 2>&1
log "refresh: $(grep -c "online-resolve rc=0 prefer-offline-resolve rc=0" refresh-npm-cache-a3b.out)/6 ok; $(grep -E "FAILED" refresh-npm-cache-a3b.out | head -2 | tr "\n" " ")"
find $W -maxdepth 4 -name ".rg-matrix-*" -not -path "*/node_modules/*" -exec rm -rf {} + 2>/dev/null
git -C $W checkout -- metrics/publish.jsonl metrics/witness.jsonl 2>/dev/null
[ -z "$(git -C $HOME/sb4-pub-0444-wt status --porcelain)" ] || { log "STOP: tree dirty: $(git -C $HOME/sb4-pub-0444-wt status --porcelain | head -3 | tr "\n" " ")"; exit 1; }
power; [ "$ac" = 1 ] && [ "$lid" = 1 ] || { log "power changed during refresh; waiting again"; while :; do power; [ "$ac" = 1 ] && [ "$lid" = 1 ] && break; sleep 60; done; }
log "starting gate-tolerant ATT=3 RUSTPROCS=2 (after triage)"
ATT=3 RUSTPROCS=2 COMMIT=148cb4d372ee75604654b4f4fc3bb9f21612e139 nohup bash ./gate-tolerant.sh > gate-runner-a3b.log 2>&1 < /dev/null &
log "gate pid $!"
