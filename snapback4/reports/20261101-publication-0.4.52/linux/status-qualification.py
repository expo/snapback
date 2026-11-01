#!/usr/bin/env python3
"""Read only this lane's qualifier logs and cgroup-owned runner outputs."""
from pathlib import Path
import re, shutil, subprocess
r=Path.home()/'sb4-pub-0452-records'
p=r/'linux-qualification-0.4.52/suite.log'
suite=p.read_text(errors='replace') if p.exists() else ''
logs={'suite':suite}
cg=subprocess.check_output(['systemctl','--user','show','sb4-pub52-linux-1','-p','ControlGroup','--value'],text=True).strip()
if cg:
 try:
  for pid in (Path('/sys/fs/cgroup')/cg.lstrip('/')/'cgroup.procs').read_text().split():
   try:
    args=Path('/proc',pid,'cmdline').read_bytes().split(b'\0')
    if not any(a.endswith(b'/run-rust-tests.mjs') or a.endswith(b'/run-client-tests.mjs') for a in args):continue
    out=Path('/proc',pid,'fd/1').resolve()
    if out.name in {'cargo-test.log','client-tests.log','client-models.log','fixture-tests.log'} and out.parent.name.startswith('snapback4-test.'):
     logs[str(out)]=out.read_text(errors='replace')
   except OSError:pass
 except OSError:pass
print('freeGiB',shutil.disk_usage(r).free//2**30)
print('suite phase:',re.findall(r'^==.*$',suite,re.M)[-4:])
for name,s in logs.items():
 rust=re.findall(r'^-- rust target:.*$',s,re.M)
 inv=re.findall(r'^-- rust inventory:.*$',s,re.M)
 clients=re.findall(r'^-- client file ok: packages/snapback4/test/.*$',s,re.M)
 failed=re.findall(r'^(?:-- FAIL[^\n]*|-- client file FAIL[^\n]*|not ok[^\n]*)$',s,re.M)
 summaries=re.findall(r'^(?:-- client files:.*|== \d+ failure.*)$',s,re.M)
 if inv or rust or clients or failed or summaries:
  print(name,'rust completed',len(rust),'client files completed',len(clients))
  print('inventory',inv[-1:],'recent rust',rust[-3:],'recent client',clients[-2:])
  print('FAIL markers',failed,'summaries',summaries[-3:])
for name in ['linux-1','audit-linux-early','qualify-after-native-a2']:
 p=r/(name+'.exit');print(name,p.read_text().strip() if p.exists() else 'pending')
