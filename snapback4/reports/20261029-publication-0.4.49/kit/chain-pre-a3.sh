#!/bin/bash
# 0.4.49 after chain-a3 (native-1 -> post-native -> prepare-1 -> expo-prep-check -> lean-1 -> warm-1 at 148cb4d372):
# 1) the early Mac check first (pre-darwin.sh: Darwin-gated, CLI-relay and proof files, serial, dry-run environment);
# 2) only if it is green: wait for AC + open lid and load < 60, refresh the shared ~/.npm starter packuments online right
#    before the dry run (0.4.43/0.4.44 lessons), check the tree, then start the tolerant dry-run gate (attempt 1, RUSTPROCS=2).
# A red pre-darwin stops here for triage (flake rule: alone >= 6/6, then one full rerun; deterministic -> report).
K=$HOME/sb4-pub-0449; cd $K; L=$K/chain-pre-a3.log; W=$HOME/sb4-pub-0444-wt/snapback4
log() { echo "$(date -u +%FT%TZ) $*" >> $L; }
power() { ac=$(pmset -g batt | head -1 | grep -c "AC Power"); lid=$(ioreg -r -k AppleClamshellState | grep -c '"AppleClamshellState" = No'); }
until grep -q "gate: chain exit" chain-a3.log 2>/dev/null; do sleep 30; done
grep -q "gate: chain exit 0 (env-ok)" chain-a3.log || { log "STOP: chain-a3 not clean: $(tail -1 chain-a3.log)"; exit 1; }
for f in native-3 prepare-3 lean-3 warm-3; do [ "$(cat $f.exit 2>/dev/null)" = done ] || { log "STOP: $f.exit=$(cat $f.exit 2>/dev/null)"; exit 1; }; done
for i in $(seq 1 30); do load=$(sysctl -n vm.loadavg | awk '{print int($2)}'); [ "$load" -lt 60 ] && break; log "waiting load=$load"; sleep 60; done
log "pre-darwin start load=$(sysctl -n vm.loadavg)"
caffeinate -ims bash ./pre-darwin.sh > pre-darwin.out 2>&1
rc=$(sed -n 's/^rc=\([0-9]*\).*/\1/p' pre-darwin.out | head -1); log "pre-darwin rc=$rc: $(grep -E '^-- client files:' pre-darwin.out | cut -c1-200)"
[ "$rc" = 0 ] || { log "STOP: pre-darwin red; no dry run until triaged: $(grep -E '^-- client file FAIL' pre-darwin.out | cut -c1-120 | tr '\n' ' ')"; exit 1; }
while :; do power; [ "$ac" = 1 ] && [ "$lid" = 1 ] && break; log "waiting ac=$ac lid_open=$lid"; sleep 60; done
for i in $(seq 1 30); do load=$(sysctl -n vm.loadavg | awk '{print int($2)}'); [ "$load" -lt 60 ] && break; log "waiting load=$load"; sleep 60; done
log "refresh start load=$(sysctl -n vm.loadavg)"
REFRESH_TAG=a3 bash ./refresh-npm-cache-a1.sh > refresh-npm-cache-a3.out 2>&1
log "refresh: $(grep -c 'online-resolve rc=0 prefer-offline-resolve rc=0' refresh-npm-cache-a3.out)/6 ok; $(grep -E 'FAILED' refresh-npm-cache-a3.out | head -2 | tr '\n' ' ')"
find $W -maxdepth 4 -name ".rg-matrix-*" -not -path "*/node_modules/*" -exec rm -rf {} + 2>/dev/null
git -C $W checkout -- metrics/publish.jsonl metrics/witness.jsonl 2>/dev/null
[ -z "$(git -C $HOME/sb4-pub-0444-wt status --porcelain)" ] || { log "STOP: tree dirty: $(git -C $HOME/sb4-pub-0444-wt status --porcelain | head -3 | tr '\n' ' ')"; exit 1; }
power; [ "$ac" = 1 ] && [ "$lid" = 1 ] || { log "power changed during refresh; waiting again"; while :; do power; [ "$ac" = 1 ] && [ "$lid" = 1 ] && break; sleep 60; done; }
log "starting gate-tolerant ATT=2 RUSTPROCS=2"
ATT=2 RUSTPROCS=2 COMMIT=148cb4d372ee75604654b4f4fc3bb9f21612e139 nohup bash ./gate-tolerant.sh > gate-runner-a3.log 2>&1 < /dev/null &
log "gate pid $!"
