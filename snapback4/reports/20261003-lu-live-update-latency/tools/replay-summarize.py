#!/usr/bin/env python3
"""Summarize native cells through the 900th-copy commit, retaining raw hashes.
Usage: replay-summarize.py /summary/output prelu-main main-combined
Reads target/lu-r2/<tag>.json and its logs from this Snapback 4 checkout.
"""
from pathlib import Path
import json,collections,math,hashlib,sys
root=Path(__file__).resolve().parents[3];out=Path(sys.argv[1]).resolve();out.mkdir(parents=True,exist_ok=True)
for tag in sys.argv[2:]:
 path=root/f'target/lu-r2/{tag}.json'
 if not path.exists():continue
 rows=json.loads(path.read_text())
 for r in rows:
  events=[];log=root/r['log']
  for line in log.read_text().splitlines():
   start=line.find('LU {')
   if start>=0:
    try:events.append(json.loads(line[start+3:]))
    except json.JSONDecodeError:pass
  if r['shape']=='replay':
   copies=0;last=None
   for e in events:
    if e['stage']=='delivery' and e['at']>=r['commit'] and e['kind']=='delivery':
     copies+=max(0,e['rows']-1)
     if copies>=900 and last is None:last=e['at']
   r['copied']=copies;r['last_copy']=last;r['last_copy_ms']=None if last is None else last-r['commit']
   cutoff=last or float('inf')
   pauses=[e for e in events if e['stage']=='pause' and r['commit']<=e['at']<=cutoff]
   slices=[e for e in events if e['stage']=='delivery' and r['commit']<=e['at']<=cutoff]
   r['turns']=len(slices);r['turns_by_kind']=dict(collections.Counter(e['kind'] for e in slices))
   r['pause_decisions']=len(pauses);r['nonzero_pause_decisions']=sum(e['pause_ms']>0 for e in pauses)
   r['requested_pause_ms']=sum(e['pause_ms'] for e in pauses);r['cpu_ms']=sum(e['cpu_ms'] for e in pauses)
   r.pop('pauses',None)
  r['raw_bytes']=log.stat().st_size;r['raw_sha256']=hashlib.file_digest(log.open('rb'),'sha256').hexdigest()
 groups=collections.defaultdict(list)
 for r in rows:groups[f"{r['label']}:{r['shape']}:{r['burners']}"].append(r)
 def stats(a):
  a=sorted(v for v in a if v is not None);return {'n':len(a),'p50':a[math.ceil(len(a)*.5)-1] if a else None,'p95':a[math.ceil(len(a)*.95)-1] if a else None,'min':min(a) if a else None,'max':max(a) if a else None}
 summary={k:{'n':len(v),'failures':sum(x['exit']!=0 for x in v),**{f:stats([x.get(f) for x in v]) for f in ['wall_ms','test_ms','last_copy_ms','first_live_ms','turns','nonzero_pause_decisions','requested_pause_ms','cpu_ms']}} for k,v in groups.items()}
 (out/f'{tag}.json').write_text(json.dumps({'rows':rows,'groups':summary},indent=2)+'\n')
 print(tag,len(rows))
 for k,v in summary.items():print(k,'last-copy/test/total ms',*[v[f]['p95'] for f in ['last_copy_ms','test_ms','wall_ms']])
