#!/usr/bin/env python3
"""Retain completed candidate data and the explicitly incomplete 144 cell."""
import gzip,shutil
from pathlib import Path
r=Path(__file__).resolve().parents[1]
sb4=r.parents[3]
retained=sb4/'target/ct-round4/rejected-wall-projects'
retained.mkdir(parents=True,exist_ok=True)
for p in sorted(r.glob('mixed-*/level-*/project')):
 dest=retained/(p.parent.parent.name+'-'+p.parent.name)
 assert not dest.exists(),dest
 p.rename(dest)
for p in sorted(r.rglob('*')):
 if p.is_file() and p.name in ['samples.json','backlog.json','server.log']:
  dest=p.with_name(p.name+'.gz')
  with p.open('rb') as src,dest.open('wb') as dst:
   with gzip.GzipFile(filename='',mode='wb',fileobj=dst,mtime=0) as z: shutil.copyfileobj(src,z)
  p.unlink()
print('Retained candidate projects outside the report and compressed raw observations.')
