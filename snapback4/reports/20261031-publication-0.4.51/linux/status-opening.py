#!/usr/bin/env python3
from pathlib import Path
import json,shutil,subprocess
r=Path('/home/ccheever/sb4-pub-0451-records');w=Path('/home/ccheever/sb4-pub-0441')
p=sorted((w/'target/affected').glob(json.loads((r/'opening-affected-plan.json').read_text())['head'][:12]+'-*.json'))[-1];d=json.loads(p.read_text());results=d['results']
print('complete',d.get('complete'),'ok',d.get('ok'),'steps',len(results),len(d['steps']),'freeGiB',shutil.disk_usage(w).free//2**30)
print('last results',[(x['id'],x.get('status')) for x in results[-3:]])
if len(results)<len(d['steps']):print('current',d['steps'][len(results)]['id'])
ls=(r/'opening-affected.log').read_text().splitlines();print('client passfiles',sum(x.startswith('-- client file ok:') for x in ls));print('\n'.join(ls[-6:]));reds=[x for x in ls if x.startswith('not ok') or x.startswith('-- client file fail')];print('RED markers:', '\n'.join(reds) if reds else 'none')
if (r/'opening-affected.exit').exists():print('exit',(r/'opening-affected.exit').read_text().strip())

# The file runner buffers TAP until completion; inspect only FDs in our own unit.
cg=subprocess.run(['systemctl','--user','show','sb4-pub51-opening-broad','-p','ControlGroup','--value'],text=True,capture_output=True).stdout.strip()
if cg:
 try:
  for pid in (Path('/sys/fs/cgroup')/cg.lstrip('/')/'cgroup.procs').read_text().split():
   try:
    args=Path('/proc',pid,'cmdline').read_bytes().split(b'\0')
    if not any(x.endswith(b'/scripts/run-client-tests.mjs') or x==b'scripts/run-client-tests.mjs' for x in args):continue
    for fd in Path('/proc',pid,'fd').iterdir():
     try:p=fd.resolve()
     except OSError:continue
     if p.name=='output.log' and p.parent.name.startswith('sb4-test-file-'):
      tap=p.read_text().splitlines();oks=[x for x in tap if x.startswith('ok ') or x.startswith('not ok ')]
      print('Own buffered file:',oks[-1] if oks else 'no completed TAP case yet')
   except OSError:pass
 except OSError:pass
