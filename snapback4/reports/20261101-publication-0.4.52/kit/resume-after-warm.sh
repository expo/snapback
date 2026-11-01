#!/bin/bash
# Resume only warming and later phases: the native witness/preparation passed before a battery event during compilation.
set -u
K=$HOME/sb4-pub-0452; W=$HOME/sb4-pub-0444-wt/snapback4; cd "$K"; L=$K/resume-after-warm.log
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
log() { echo "$(date -u +%FT%TZ) $*" >> "$L"; }
power() { ac=$(pmset -g batt | head -1 | grep -c "AC Power"); lid=$(ioreg -r -k AppleClamshellState | grep -c '"AppleClamshellState" = No'); }
until grep -q "gate: chain exit" chain-a1.log 2>/dev/null; do sleep 30; done
[ "$(cat warm-1.exit 2>/dev/null)" = done ] || { log 'STOP: warm-1 did not pass'; exit 1; }
python3 - "$W" "$K" <<'VERIFY'
import json,pathlib,sys,datetime,re
w,k=map(pathlib.Path,sys.argv[1:]); text=(k/'chain-a1.log').read_text();m=re.search(r'^(\S+) ENVIRONMENT-INVALID during chain: on battery$',text,re.M);assert m,'unexpected environment invalidation'
t=datetime.datetime.fromisoformat(m[1].replace('Z','+00:00')).timestamp();r=w/'reports/20261101-publication-0.4.52'; proof=json.loads((r/'attempt-1-native-witness.json').read_text());prep=json.loads((r/'attempt-1-publication-prepare-client.json').read_text());q=json.loads((w/'reports/20261101-expo-0.4.52/qualified.json').read_text());p=json.loads((w/'target/publication/client-0.4.52/prepare.json').read_text());assert q['source']==p['source'];assert proof['exit']==prep['exit']==0;assert proof['end']<t and prep['end']<t
record={'environmentInvalidAt':m[1],'nativeWitnessEndedAt':datetime.datetime.fromtimestamp(proof['end'],datetime.timezone.utc).isoformat(),'preparationEndedAt':datetime.datetime.fromtimestamp(prep['end'],datetime.timezone.utc).isoformat(),'source':q['source'],'disposition':'Native witness and preparation completed before battery event; preserve exact prepared bytes. Rewarm on AC before pre-darwin and guarded dry run.','warmedAgainOnAC':False}
(r/'warm-environment-resume.json').write_text(json.dumps(record,indent=2)+'\n');print(record['disposition'])
VERIFY
[ "$?" = 0 ] || { log 'STOP: phase chronology validation failed'; exit 1; }
while :; do
 power; free=$(df -g "$HOME" | tail -1 | awk '{print $4}'); load=$(sysctl -n vm.loadavg | awk '{print int($2)}')
 [ "$ac" = 1 ] && [ "$lid" = 1 ] && [ "$free" -ge 45 ] && [ "$load" -lt 60 ] && break
 log "waiting for rewarm: ac=$ac lid=$lid disk=${free}GiB load=$load"
 if [ "$free" -lt 45 ]; then sleep 900; else sleep 60; fi
done
(cd "$W/target/publication/client-0.4.52" && shasum -a 256 *.tgz) > "$K/pre-rewarm-sha256.txt"
log 'rewarm on AC start (attempt-2-test-warm; no native/prepare rerun)'
ATTEMPT=2 caffeinate -ims bash ./publish.sh warm > warm-a2.log 2>&1
[ "$(cat warm-2.exit 2>/dev/null)" = done ] || { log 'STOP: rewarm failed'; exit 1; }
(cd "$W/target/publication/client-0.4.52" && shasum -a 256 *.tgz) > "$K/post-rewarm-sha256.txt"
cmp "$K/pre-rewarm-sha256.txt" "$K/post-rewarm-sha256.txt" || { log 'STOP: prepared bytes changed'; exit 1; }
python3 - "$W" <<'RECORD'
import pathlib,json,sys,datetime
p=pathlib.Path(sys.argv[1])/'reports/20261101-publication-0.4.52/warm-environment-resume.json';q=json.loads(p.read_text());q['warmedAgainOnAC']=True;q['rewarmedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();q['preparedTarballsUnchanged']=True;p.write_text(json.dumps(q,indent=2)+'\n')
RECORD
log 'rewarm passed; prepared bytes unchanged; continue pre-darwin'
for i in $(seq 1 30); do load=$(sysctl -n vm.loadavg | awk '{print int($2)}'); [ "$load" -lt 60 ] && break; log "waiting load=$load"; sleep 60; done
log "pre-darwin start load=$(sysctl -n vm.loadavg)"
caffeinate -ims bash ./pre-darwin.sh > pre-darwin.out 2>&1
rc=$(sed -n 's/^rc=\([0-9]*\).*/\1/p' pre-darwin.out | head -1); log "pre-darwin rc=$rc: $(grep -E '^-- client files:' pre-darwin.out | cut -c1-200)"
[ "$rc" = 0 ] || { log "STOP: pre-darwin red; no dry run until triaged: $(grep -E '^-- client file FAIL' pre-darwin.out | cut -c1-120 | tr '\n' ' ')"; exit 1; }
while :; do power; [ "$ac" = 1 ] && [ "$lid" = 1 ] && break; log "waiting ac=$ac lid_open=$lid"; sleep 60; done
for i in $(seq 1 30); do load=$(sysctl -n vm.loadavg | awk '{print int($2)}'); [ "$load" -lt 60 ] && break; log "waiting load=$load"; sleep 60; done
log "refresh start load=$(sysctl -n vm.loadavg)"
REFRESH_TAG=a1 bash ./refresh-npm-cache-a1.sh > refresh-npm-cache-a1.out 2>&1
log "refresh: $(grep -c 'online-resolve rc=0 prefer-offline-resolve rc=0' refresh-npm-cache-a1.out)/6 ok; $(grep -E 'FAILED' refresh-npm-cache-a1.out | head -2 | tr '\n' ' ')"
find $W -maxdepth 4 -name ".rg-matrix-*" -not -path "*/node_modules/*" -exec rm -rf {} + 2>/dev/null
git -C $W checkout -- metrics/publish.jsonl metrics/witness.jsonl 2>/dev/null
[ -z "$(git -C $HOME/sb4-pub-0444-wt status --porcelain)" ] || { log "STOP: tree dirty: $(git -C $HOME/sb4-pub-0444-wt status --porcelain | head -3 | tr '\n' ' ')"; exit 1; }
power; [ "$ac" = 1 ] && [ "$lid" = 1 ] || { log "power changed during refresh; waiting again"; while :; do power; [ "$ac" = 1 ] && [ "$lid" = 1 ] && break; sleep 60; done; }
log "starting gate-tolerant ATT=1 RUSTPROCS=2"
ATT=1 RUSTPROCS=2 COMMIT=107a413c296cd73e9701bc43ebdd4c6b86ca95bd nohup bash ./gate-tolerant.sh > gate-runner-a1.log 2>&1 < /dev/null &
log "gate pid $!"
