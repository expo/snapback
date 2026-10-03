from pathlib import Path
import json,gzip,hashlib
r=Path(__file__).resolve().parents[1]
def read(path):
 p=r/path
 return json.loads(p.read_text() if p.exists() else gzip.decompress(Path(str(p)+'.gz').read_bytes()))
variants=['before','restored','demoted']
rows={v:read(f'mixed-{v}/summary.json') for v in variants}
for v,cells in rows.items():
 assert [c['busy'] for c in cells]==[0,48,96,144],(v,len(cells))
 for c in cells:
  assert c['unexpectedLeaseChanges']==0
  assert c['observedAbandoned']==c['deliberatelyAbandoned']>0
  assert all(x['maintenanceOnly'] and x['delay']>=0 for x in c['leaseRecovery'])
lines=['# Round-2 corrected combined results','',
'All cells use 125 real-clock seconds of reads plus ongoing writes, supervised effects, expiry, fixed-lease abandonment and minute jobs. Slow effects are emitted after the advance. Timings are nearest-rank percentiles over every successful continuous read, with no sample dropping.','',
'| Variant | Busy | Reads | p50 / p95 ms | Abandoned observed / expected | Job boundaries | Lease recovery max ms | Physical expiry max ms |',
'|---|---:|---:|---:|---:|---:|---:|---:|']
for v in variants:
 for c in rows[v]:
  q=c['readLatency']
  lines.append(f"| {v} | {c['busy']} | {c['reads']} | {q['p50']:.3f} / {q['p95']:.3f} | {c['observedAbandoned']} / {c['deliberatelyAbandoned']} | {len(c['expectedBoundaries'])} | {max(x['delay'] for x in c['leaseRecovery'])} | {c['expiryMaxMs']} |")
lines+=['','## Maintenance-priority comparison','',
'Only maintenance priority differs between these candidates; this is the small expiry/maintenance fixture, not the eight calibration endpoints.','',
'| Busy | Restored p50 / p95 ms | Demoted p50 / p95 ms | Restored vs demoted p50 / p95 |', '|---:|---:|---:|---:|']
for a,b in zip(rows['restored'],rows['demoted']):
 x,y=a['readLatency'],b['readLatency']
 lines.append(f"| {a['busy']} | {x['p50']:.3f} / {x['p95']:.3f} | {y['p50']:.3f} / {y['p95']:.3f} | {x['p50']/y['p50']:.3f}× / {x['p95']/y['p95']:.3f}× |")
lines+=['','## Observed maintenance commits','', '| Variant | Busy | Work | Commits |', '|---|---:|---|---:|']
for v in variants:
 for c in rows[v]:
  for w in c['maintenanceCommits']: lines.append(f"| {v} | {c['busy']} | {w['kind']} / {w['program']} | {w['n']} |")
(r/'MIXED.md').write_text('\n'.join(lines)+'\n')
print('\n'.join(lines[:25]))
