#!/usr/bin/env python3
"""AQ's browser probe, narrowed to u0500; five alternating AB/BA pairs per mode."""
import json, os, subprocess
from pathlib import Path
report=Path(__file__).resolve().parent
browser=report.parent/'20260929-aq-fast-acquisition/tools/browser.mjs'
out=report/'paired';out.mkdir(exist_ok=True)
for diagnostic in [False,True]:
 tag='phases' if diagnostic else 'timing'
 for run in range(5):
  for variant in (['baseline','final'] if run%2==0 else ['final','baseline']):
   name=f'{tag}-{run}-{variant}'
   env={**os.environ,'AQ_ACCOUNT':'u0500','AQ_MODES':'default,worker' if run%2==0 else 'worker,default','AQ_DIAGNOSTIC':str(int(diagnostic))}
   with (out/f'{name}.log').open('w') as log:
    r=subprocess.run(['node',str(browser),'http://127.0.0.1:49771',str(out/f'{name}.json'),str(Path(f'target/wd/{variant}-sdk').resolve()),'1'],env=env,stdout=log,stderr=subprocess.STDOUT)
   if r.returncode:raise SystemExit(f'{name}: exit {r.returncode}; see log')
   rows=json.loads((out/f'{name}.json').read_text());print(name,[(r['mode'],round(r['acquiredMs'],1)) for r in rows],flush=True)
# Feed AQ's unchanged summarizer its aggregate filenames.
for tag in ['timing','phases']:
 for variant in ['baseline','final']:
  rows=[]
  for run in range(5):
   samples=json.loads((out/f'{tag}-{run}-{variant}.json').read_text())
   for sample in samples:sample['run']=run
   rows+=samples
  (out/f'u0500-{tag}-{variant}.json').write_text(json.dumps(rows,indent=2)+'\n')
with (report/'paired-summary.log').open('w') as log:
 subprocess.run(['python3',str(browser.with_name('summarize.py')),str(out)],stdout=log,check=True)
import gzip
for p in out.glob('*.json'):
 if p.name=='summary.json':continue
 with gzip.open(str(p)+'.gz','wb') as f:f.write(p.read_bytes())
 p.unlink()
