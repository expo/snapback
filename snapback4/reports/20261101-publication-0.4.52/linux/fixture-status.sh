#!/bin/bash
R=$HOME/sb4-pub-0452-records
date -u +%FT%TZ
python3 - <<'PY'
import pathlib,re,json,subprocess
r=pathlib.Path('/home/ccheever/sb4-pub-0452-records');p=r/'client-remainder.log';plan=r/'client-remainder-plan.json'
if p.exists():
 s=p.read_text();print('discovery completed:',len(re.findall(r'^-- client file ok:',s,re.M)),'failed:',re.findall(r'^-- client file FAIL: (.*)$',s,re.M));print('phase:', 'models' if '== client-remainder-models' in s else 'client files')
if plan.exists():
 d=json.loads(plan.read_text());print('source:',d['source'][:12],'remaining files:',len(d['files']))
PY
for f in client-remainder client-remainder-models; do [ ! -e "$R/$f.exit" ] || echo "$f exit=$(cat "$R/$f.exit")"; done
df -h "$HOME" | tail -1
echo 'Mac publication jobs stopped; final source reset pending'
