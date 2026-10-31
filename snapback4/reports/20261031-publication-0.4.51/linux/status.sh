#!/bin/bash
R=$HOME/sb4-pub-0451-records
date -u +%FT%TZ
python3 - <<'PY'
import json,pathlib,re
r=pathlib.Path('/home/ccheever/sb4-pub-0441/target/affected');plan=json.loads(pathlib.Path('/home/ccheever/sb4-pub-0451-records/release-affected-plan.json').read_text());ps=sorted(r.glob(plan['head'][:12]+'-*.json'),key=lambda p:p.stat().st_mtime)
if ps:
 d=json.loads(ps[-1].read_text());res=d['results'];done={x['id'] for x in res};active=next((x['id'] for x in d['steps'] if x['id'] not in done),'done');print('affected:',len(res),'/',len(d['steps']),'active:',active,'reds:',[(x['id'],x['status']) for x in res if x['status']!=0])
log=pathlib.Path('/home/ccheever/sb4-pub-0451-records/release-affected.log')
if log.exists():
 text=log.read_text();targets=re.findall(r'^     Running (.+)$',text,re.M);print('Rust target launches:',len(targets),'latest:',targets[-1] if targets else 'none');failures=re.findall(r'^(?:test .+ \.\.\. FAILED|error: test failed|-- client file FAIL).*$',text,re.M);print('live failure markers:',failures[-5:])
 if '== client-tests' in text:
  client=text.split('== client-tests',1)[1];print('client completed:',len(re.findall(r'^-- client file ok:',client,re.M)),'failed:',len(re.findall(r'^-- client file FAIL',client,re.M)))
PY
for f in release-affected release-inventories release-ref-check linux-1; do [ ! -e "$R/$f.exit" ] || echo "$f: $(cat "$R/$f.exit")"; done
df -h "$HOME" | tail -1
timeout 30 ssh -o BatchMode=yes -o ConnectTimeout=10 ccheever@charlies-macbook-pro-m5max-black 'A=1; test ! -e ~/sb4-pub-0451/native-a2-started.sha || A=2; tail -2 ~/sb4-pub-0451/chain-a$A.log; tail -2 ~/sb4-pub-0451/native-continue-a$A.log 2>/dev/null; for f in native-$A prepare-$A lean-$A warm-$A audit-mac-early dry-run-$A; do test ! -e ~/sb4-pub-0451/$f.exit || echo "$f: $(cat ~/sb4-pub-0451/$f.exit)"; done; tail -1 ~/sb4-pub-0451/gate.log 2>/dev/null; true' 2>/dev/null
