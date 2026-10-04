#!/usr/bin/env python3
"""Independently check paired-render percentiles from retained CSV timestamps.
Usage: check-stamps.py /evidence/directory main after
Retain negative cross-clock intervals as explicit findings; never clamp them.
"""
from pathlib import Path
import csv,json,math,collections,sys
base=Path(sys.argv[1]);results=[]
for label in sys.argv[2:]:
 summary=json.loads((base/f'web-{label}.summary.json').read_text());assert not summary['errors']
 runs=summary['metadata']['runs'];expected_writes=len(summary['groups'])*runs
 rows=list(csv.DictReader((base/f'web-{label}.stamps.csv').open()));assert len(rows)==expected_writes*2
 writes=collections.defaultdict(list);largest=0;counts=collections.Counter();negative=[]
 for row in rows:
  commit=float(row['commit']);render=float(row['render'])
  if render<commit:negative.append({k:row[k] for k in ['burners','run','shape','viewer','commit','evaluation','render']}|{'render_minus_commit_ms':render-commit})
  key=(row['burners'],row['shape'],row['run']);writes[key].append(render-commit)
  for stage in ['delivery','published','received','evaluation','render']:
   if row[stage]:counts[stage]+=1
 assert len(writes)==expected_writes and all(len(values)==2 for values in writes.values())
 for key,g in summary['groups'].items():
  load,shape=key.split(':');values=sorted(max(v) for (l,s,_),v in writes.items() if l==load and s==shape)
  assert len(values)==runs
  expected={'n':runs,'p50':values[math.ceil(runs*.5)-1],'p95':values[math.ceil(runs*.95)-1],'max':values[-1]}
  for stat,val in expected.items():
   diff=abs(g['slowestRemoteRender'][stat]-val);largest=max(largest,diff);assert diff<.002,(label,key,stat,diff)
 results.append({'label':label,'writes':len(writes),'remote_renders':len(rows),'all_renders_after_commit':not negative,'negative_raw_stamp_samples':negative,'primary_percentiles_reproduced_from_csv':True,'max_csv_rounding_difference_ms':largest,'stage_stamp_counts':dict(counts)})
(base/'web-validation.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(results,indent=2))
