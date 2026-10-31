#!/bin/bash
# 0.4.51 after chain-a1 (native-1 -> post-native -> prepare-1 -> expo-prep-check -> lean-1 -> warm-1 at b34992d40b):
# 1) the early Mac check first (pre-darwin.sh: Darwin-gated, CLI-relay and proof files, serial, dry-run environment);
# 2) only if it is green: wait for AC + open lid and load < 60, refresh the shared ~/.npm starter packuments online right
#    before the dry run (0.4.43/0.4.44 lessons), check the tree, then start the tolerant dry-run gate (attempt 1, RUSTPROCS=2).
# A red pre-darwin stops here for triage (flake rule: alone >= 6/6, then one full rerun; deterministic -> report).
K=$HOME/sb4-pub-0451; cd $K; L=$K/chain-pre-a1.log; W=$HOME/sb4-pub-0444-wt/snapback4
log() { echo "$(date -u +%FT%TZ) $*" >> $L; }
power() { ac=$(pmset -g batt | head -1 | grep -c "AC Power"); lid=$(ioreg -r -k AppleClamshellState | grep -c '"AppleClamshellState" = No'); }
until grep -q "gate: chain exit" chain-a1.log 2>/dev/null; do sleep 30; done
grep -q "gate: chain exit 0 (env-ok)" chain-a1.log || { log "STOP: chain-a1 not clean: $(tail -1 chain-a1.log)"; exit 1; }
for f in native-1 prepare-1 lean-1 warm-1; do [ "$(cat $f.exit 2>/dev/null)" = done ] || { log "STOP: $f.exit=$(cat $f.exit 2>/dev/null)"; exit 1; }; done
for i in $(seq 1 30); do load=$(sysctl -n vm.loadavg | awk '{print int($2)}'); [ "$load" -lt 60 ] && break; log "waiting load=$load"; sleep 60; done
while :; do power; [ "$ac" = 1 ] && [ "$lid" = 1 ] && break; log "waiting before pre ac=$ac lid_open=$lid (600s)"; sleep 600; done
log "pre-darwin start load=$(sysctl -n vm.loadavg)"
caffeinate -ims bash ./pre-darwin.sh > pre-darwin.out 2>&1
rc=$(sed -n 's/^rc=\([0-9]*\).*/\1/p' pre-darwin.out | head -1); log "pre-darwin rc=$rc: $(grep -E '^-- client files:' pre-darwin.out | cut -c1-200)"
[ "$rc" = 0 ] || { log "STOP: pre-darwin red; no dry run until triaged: $(grep -E '^-- client file FAIL' pre-darwin.out | cut -c1-120 | tr '\n' ' ')"; exit 1; }
# Step 4 completes on both hosts before the step-5 cache refresh and dry run.
while [ ! -s "$W/target/incoming/linux-0.4.51/receipt.json" ] || [ ! -s "$W/target/incoming/linux-0.4.51/snapback4-linux-x64-0.4.51.tgz" ]; do
 log "waiting for completed Linux qualification transfer"; sleep 30
done
(cd "$W" && node --input-type=module <<'LINUX_READY'
import {loadPrepared} from './scripts/prepare-client.mjs';
import {json,platforms,run,validateLinux} from './scripts/publication-artifacts.mjs';
const version='0.4.51',source=run('git',['rev-parse','HEAD']).trim();
const prepared=loadPrepared('target/publication/client-'+version,version,platforms);
if(prepared.source!==source)throw new Error('prepared source differs before dry run');
validateLinux(json('target/incoming/linux-'+version+'/receipt.json'),'target/incoming/linux-'+version+'/snapback4-linux-x64-'+version+'.tgz',{...prepared.client,expoIntegrity:prepared.expo.integrity},source);
console.log('LINUX READY: successful receipt, exact client/Expo/platform integrity and source verified');
LINUX_READY
) > linux-ready-a1.log 2>&1 || { log "STOP: Linux handoff invalid; see linux-ready-a1.log"; exit 1; }
log "Linux handoff validated; refresh immediately before dry run"
while :; do power; [ "$ac" = 1 ] && [ "$lid" = 1 ] && break; log "waiting ac=$ac lid_open=$lid"; if [ "$ac" != 1 ]; then sleep 600; else sleep 60; fi; done
for i in $(seq 1 30); do load=$(sysctl -n vm.loadavg | awk '{print int($2)}'); [ "$load" -lt 60 ] && break; log "waiting load=$load"; sleep 60; done
log "refresh start load=$(sysctl -n vm.loadavg)"
REFRESH_TAG=a1 bash ./refresh-npm-cache-a1.sh > refresh-npm-cache-a1.out 2>&1
log "refresh: $(grep -c 'online-resolve rc=0 prefer-offline-resolve rc=0' refresh-npm-cache-a1.out)/6 ok; $(grep -E 'FAILED' refresh-npm-cache-a1.out | head -2 | tr '\n' ' ')"
[ "$(grep -c 'online-resolve rc=0 prefer-offline-resolve rc=0' refresh-npm-cache-a1.out)" = 6 ] || { log "STOP: refresh not 6/6"; exit 1; }
find $W -maxdepth 4 -name ".rg-matrix-*" -not -path "*/node_modules/*" -exec rm -rf {} + 2>/dev/null
git -C $W checkout -- metrics/publish.jsonl metrics/witness.jsonl 2>/dev/null
[ -z "$(git -C $HOME/sb4-pub-0444-wt status --porcelain)" ] || { log "STOP: tree dirty: $(git -C $HOME/sb4-pub-0444-wt status --porcelain | head -3 | tr '\n' ' ')"; exit 1; }
power; [ "$ac" = 1 ] && [ "$lid" = 1 ] || { log "power changed during refresh; waiting again"; while :; do power; [ "$ac" = 1 ] && [ "$lid" = 1 ] && break; if [ "$ac" != 1 ]; then sleep 600; else sleep 60; fi; done; }
log "starting gate-tolerant ATT=1 RUSTPROCS=2"
ATT=1 MAXATT=1 RUSTPROCS=2 COMMIT=b34992d40be5297ec42feb9aa4a29200bccfca98 nohup caffeinate -ims bash ./gate-tolerant.sh > gate-runner-a1.log 2>&1 < /dev/null &
log "gate pid $!"
nohup bash ./refresh-after-suite-a1.sh > refresh-after-suite-a1.out 2>&1 < /dev/null &
log "post-suite refresh pid $!"
