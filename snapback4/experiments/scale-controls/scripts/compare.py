#!/usr/bin/env python3
"""Compare native Supabase summaries with the retained S1-H raw-PG matrix."""
import json
from pathlib import Path
import sys

sb=Path(sys.argv[1]);raw=Path(sys.argv[2])
ledgers=[json.loads((p/'ledger.json').read_text()) for p in [raw,sb]]
curves=[json.loads((p/'curves.json').read_text()) for p in [raw,sb]]
def key(c): return tuple(c[k] for k in ['workload','keys','rows','delay_us','writers'])
by_key=[{key(r['cell']):r for r in ledger} for ledger in ledgers]
assert set(by_key[0])==set(by_key[1]), 'matrix cells differ'
rows=[]
for k in sorted(by_key[0]):
    a,b=[d[k] for d in by_key]
    rows.append(dict(cell=b['cell'],raw_pg=a,supabase=b))
(sb/'comparison.json').write_text(json.dumps(rows,indent=2)+'\n')
headlines=[]
for workload,keys in [('W1','disjoint'),('W2','disjoint'),('W3','disjoint'),('W4','disjoint'),('W5','same'),('W5','hot1')]:
    for delay in [0,200,500,1000]:
        selected=[]
        for ledger in ledgers:
            candidates=[r for r in ledger if r['cell']['workload']==workload and r['cell']['keys']==keys and r['cell']['rows']==1000000 and r['cell']['delay_us']==delay]
            candidates.sort(key=lambda r:(r['summary']['highest_passing_offered_per_s'] or 0,-r['cell']['writers']),reverse=True)
            selected.append(candidates[0])
        headlines.append(dict(workload=workload,keys=keys,delay_us=delay,raw_pg=selected[0],supabase=selected[1]))
(sb/'headlines.json').write_text(json.dumps(headlines,indent=2)+'\n')
def rate(r):
    n=r['summary']['highest_passing_offered_per_s']
    if n is None:return 'no pass'
    return f"{n:,}"+(f" (C={r['cell']['writers']})" if r['cell']['workload'] in ['W4','W5'] else '')
text=['# Supabase beside raw PG','',
      'Rates are highest tested passing offered/cohort acknowledgements per second, requiring all three repetitions. PostgREST alone, default pool 10; raw PG has read pool 32 and write pool C. Writer headlines select the best configuration (smallest C breaks ties), not the best repetition. Shared hosts, serial short windows and coarse brackets preclude clean causal or full-stack capacity claims.','',
      '| Workload / keys / added RTT µs (1m messages) | Raw PG | Supabase (PostgREST only) |',
      '|---|---:|---:|']
for r in headlines:
    text.append(f"| {r['workload']} / {r['keys']} / {r['delay_us']} | {rate(r['raw_pg'])} | {rate(r['supabase'])} |")
text+=['','## Every identical cell','',
       '| Workload / keys / rows / delay µs / clients | Raw PG pass / next fail ops/s | Supabase pass / next fail ops/s | Raw p50 / p99 ms | Supabase p50 / p99 ms |',
       '|---|---:|---:|---:|---:|']
for r in rows:
    c=r['cell'];a=r['raw_pg'];b=r['supabase']
    def bracket(v):return f"{v['summary']['highest_passing_offered_per_s']} / {v['summary']['lowest_failing_offered_per_s']}"
    def latency(v):return f"{v['p50_ms']:.2f} / {v['p99_ms']:.2f}" if 'p50_ms' in v else '—'
    text.append(f"| {c['workload']} / {c['keys']} / {c['rows']} / {c['delay_us']} / {c['writers']} | {bracket(a)} | {bracket(b)} | {latency(a)} | {latency(b)} |")
text+=['','Latencies above are each system at its own passing rate and do not isolate per-request overhead.','',
       '## Matched offered rates on the natural link','',
       'Reads use 128 clients at 1m messages; writes use the predeclared C=32 budget. Choose the highest common offered rate where both controls pass; if none exists, show the lowest common tested rate with both pass flags. No unmeasured or interpolated latency is substituted.','',
       '| Workload / keys | offered ops/s | Raw PG p50 / p99 ms | Supabase p50 / p99 ms | Raw / Supabase pass |',
       '|---|---:|---:|---:|---|']
matched=[]
for workload,keys in [('W1','disjoint'),('W2','disjoint'),('W3','disjoint'),('W4','disjoint'),('W5','same'),('W5','hot1')]:
    k=(workload,keys,1000000,0,128 if workload in ['W1','W2','W3'] else 32)
    pair=[{r['offered_per_s']:r for c in curve if key(c['cell'])==k for r in c['rates']} for curve in curves]
    common=set(pair[0])&set(pair[1])
    if not common:
        text.append(f'| {workload} / {keys} | no common tested rate | — | — | — |');continue
    both=[n for n in common if all(d[n]['all_pass'] for d in pair)]
    offered=max(both) if both else min(common);a,b=[d[offered] for d in pair]
    matched.append(dict(workload=workload,keys=keys,offered_per_s=offered,raw_pg=a,supabase=b))
    text.append(f"| {workload} / {keys} | {offered:,} | {a['p50_ms']:.2f} / {a['p99_ms']:.2f} | {b['p50_ms']:.2f} / {b['p99_ms']:.2f} | {a['all_pass']} / {b['all_pass']} |")
(sb/'matched-rates.json').write_text(json.dumps(matched,indent=2)+'\n')
(sb/'comparison.md').write_text('\n'.join(text)+'\n')
print(f'{len(rows)} matching cells; {len(headlines)} headlines; {len(matched)} matched-rate comparisons')
