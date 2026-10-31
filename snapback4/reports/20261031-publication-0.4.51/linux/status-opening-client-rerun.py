#!/usr/bin/env python3
from pathlib import Path
import json,shutil,subprocess
r=Path('/home/ccheever/sb4-pub-0451-records');p=r/'opening-client-full-rerun-receipt.json'
if p.exists() and p.stat().st_size:
 d=json.loads(p.read_text());print('head',d['head'][:12],'complete',d['complete'],'ok',d.get('ok'),'results',[(x['id'],x['status']) for x in d['results']]);print('runtime',d.get('runtimeBefore'))
for name in ['client-tests','client-models']:
 p=r/('opening-client-full-rerun-'+name+'.log')
 if p.exists():
  ls=p.read_text().splitlines();print(name,'pass file markers',sum(x.startswith('-- client file ok:') for x in ls));print('\n'.join(ls[-5:]));print('fail files:',[x for x in ls if x.startswith('-- client file FAIL:')])
p=r/'opening-client-full-rerun.exit'
if p.exists():print('controller exit',p.read_text().strip())
print('freeGiB',shutil.disk_usage(r).free//2**30)

# The file runner buffers TAP until completion; inspect only FDs in our own unit.
cg=subprocess.run(['systemctl','--user','show','sb4-pub51-opening-client-rerun','-p','ControlGroup','--value'],text=True,capture_output=True).stdout.strip()
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
