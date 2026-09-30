"""Recompute medians/nearest-rank p95 from every retained sample; no exclusions."""
import json,math,statistics
from pathlib import Path
root=Path(__file__).resolve().parent
summary={}
for phase,path in [('pre-QX',root.parent),('round0',root.parent),('round1',root)]:
 for tier in ['wasm','process']:
  name=('baseline' if phase=='pre-QX' else 'final')+'-'+tier
  samples=json.loads((path/(name+'.json')).read_text())['samples']
  for arm in ['insert','update']:
   rows=[r for r in samples if r['flow']==arm]
   result={}
   for event in ['published','render','returned']:
    values=sorted(r[event]-r['call'] for r in rows)
    result[event]={'n':len(values),'p50_ms':round(statistics.median(values),3),'p95_ms':round(values[math.ceil(len(values)*.95)-1],3),'min_ms':round(min(values),3),'max_ms':round(max(values),3)}
   result['pending_at_first_render']=sum(next(image.get('pending') is True for e in r['events'] if e['stage']=='render' for image in e['read']['data'] if image.get('emoji')==f"{arm}-{r['run']}") for r in rows)
   result['rendered_before_return']=sum(r['render']<r['returned'] for r in rows)
   summary[f'{phase}-{tier}-{arm}']=result
(root/'latency-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
for name,result in summary.items():print(name,result['render'],'pending',result['pending_at_first_render'],'before return',result['rendered_before_return'])
