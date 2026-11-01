#!/usr/bin/env python3
"""Read only this publication's suite logs and cwd-owned runner descriptors."""
from pathlib import Path
from datetime import datetime, timezone
import json, re, subprocess, shutil
k=Path.home()/'sb4-pub-0452';w=Path.home()/'sb4-pub-0444-wt/snapback4'
def output(args):
 try:return subprocess.run(args,capture_output=True,text=True,timeout=8).stdout
 except subprocess.TimeoutExpired:return ''
p=w/'reports/20261101-publication-0.4.52/attempt-1-publication-dry-run.log'
suite=p.read_text(errors='replace') if p.exists() else ''
logs={'suite':suite};pid=None;owned=[];activeChildren=[]
for line in output(['lsof','-a','-c','node','-d','cwd','-Fpn']).splitlines():
 if line.startswith('p'):pid=line[1:]
 elif line.startswith('n') and line[1:]==str(w) and pid:owned.append(pid)
for pid in owned:
 args=output(['ps','-p',pid,'-o','args='])
 if not any(x in args for x in ['scripts/run-rust-tests.mjs','scripts/run-client-tests.mjs','scripts/publish.mjs']):continue
 for child in output(['pgrep','-P',pid]).split():
  activeChildren.append({'process':output(['ps','-p',child,'-o','pid=,etime=,comm=']).strip(),'testFiles':re.findall(r'packages/snapback4/test/[^\s]+\.test\.mjs',output(['ps','-p',child,'-o','args=']))})
 for line in output(['lsof','-a','-p',pid,'-Fn']).splitlines():
  if not line.startswith('n'):continue
  p=Path(line[1:])
  if p.name in {'cargo-test.log','client-tests.log','client-models.log','fixture-tests.log'} and p.parent.name.startswith('snapback4-test.'):
   try:logs[str(p)]=p.read_text(errors='replace')
   except OSError:pass
power=output(['pmset','-g','batt']);percent=re.search(r'(\d+)%;',power)
result={'at':datetime.now(timezone.utc).isoformat(),'freeGiB':shutil.disk_usage(w).free//2**30,'power':'AC' if "Now drawing from 'AC Power'" in power else 'battery-or-unavailable','percent':int(percent.group(1)) if percent else None,'phases':re.findall(r'^==.*$',suite,re.M)[-4:],'outputs':[],'activeOwnedChildren':activeChildren}
for name,s in logs.items():
 rust=re.findall(r'^-- rust target:.*$',s,re.M);clients=re.findall(r'^-- client file ok:.*$',s,re.M)
 failures=re.findall(r'^(?:-- FAIL[^\n]*|-- client file FAIL[^\n]*|not ok[^\n]*)$',s,re.M)
 result['outputs'].append({'log':name,'rustCompleted':len(rust),'recentRust':rust[-2:],'inventory':re.findall(r'^-- rust inventory:.*$',s,re.M)[-1:],'clientFilesCompleted':len(clients),'recentClients':clients[-2:],'openingAndSocial': [line for line in clients if any(name in line for name in ['asset-opening','asset-avatars','social-browser','maintained-column-adoption','upload-hooks'])],'failures':failures,'summaries':re.findall(r'^(?:-- client files:.*|== \d+ failure.*)$',s,re.M)[-3:]})
for name in ['dry-run-1.exit','dry-run-1.env-invalid']:
 p=k/name;result[name]=p.read_text().strip() if p.exists() else None
p=k/'gate.log';result['gate']=p.read_text().splitlines()[-3:] if p.exists() else []
stage=w/'target/publication/snapback4-darwin-arm64-0.4.52/resume.json'
result['stageExists']=stage.exists()
refresh=k/'refresh-npm-cache-a1d.out'
result['postSuiteRefreshCases']=refresh.read_text().count('online-resolve rc=0 prefer-offline-resolve rc=0') if refresh.exists() else 0
result['consumerMessages']=re.findall(r'^(?:consumer ok:.*|.*(?:STARTER|proof).*PASS.*)$',suite,re.M)[-4:]
print(json.dumps(result,indent=2))
