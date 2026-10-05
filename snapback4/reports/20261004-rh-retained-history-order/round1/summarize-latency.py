#!/usr/bin/env python3
import json, math, statistics
from pathlib import Path
root=Path(__file__).resolve().parent
orders=[json.loads((root/name).read_text()) for name in ['latency.json','latency-reverse.json']]
rows=[]
def percentile(values,q):
    return sorted(values)[math.ceil(len(values)*q)-1]
for host in ['wasm','process']:
    for mode in ['known-local','server-only-source','current-history-fallback','current-search']:
        pairs=[]
        for order in orders:
            selected={r['label']:r for r in order if r['host']==host and r['mode']==mode}
            pairs.append(selected)
        before=sum((p['baseline']['samples'] for p in pairs),[])
        after=sum((p['fixed']['samples'] for p in pairs),[])
        diffs=[b-a for a,b in zip(before,after)]
        row={'host':host,'mode':mode,'pairs':len(before),'baseline_p50':percentile(before,.5),'fixed_p50':percentile(after,.5),'baseline_p95':percentile(before,.95),'fixed_p95':percentile(after,.95),'paired_delta_p50':statistics.median(diffs),'paired_delta_mean':statistics.mean(diffs),'orders':[{k:{metric:p[k][metric] for metric in ['n','p50','p95','max']} for k in ['baseline','fixed']} for p in pairs]}
        rows.append(row)
        print('|',host,'/',mode,'|',len(before),'|',f'{row["baseline_p50"]:.3f} → {row["fixed_p50"]:.3f}','|',f'{row["baseline_p95"]:.3f} → {row["fixed_p95"]:.3f}','|',f'{row["paired_delta_p50"]:+.3f}','|')
(root/'latency-summary.json').write_text(json.dumps(rows,indent=2)+'\n')
