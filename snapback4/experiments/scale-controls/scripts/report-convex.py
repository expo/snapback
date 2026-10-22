#!/usr/bin/env python3
"""Compare the Convex ledger with historical raw PG and Supabase-advocate rows."""
import gzip, hashlib, json, re, sys
from pathlib import Path
from statistics import median
import report
root=Path(sys.argv[1])
# The inherited base receipt labels its launcher run.py; preserve that captured
# field while recording this subclass's actual CLI for reproduction.
op=root/'ownership.json';ownership=json.loads(op.read_text())
if ownership.get('command',[None,None])[1]=='scripts/run.py':
    ownership['base_logger_command']=ownership['command']
    ownership['command']=[*ownership['command']]
    ownership['command'][1]='scripts/convex.py'
    ownership['command_note']='Native CLI name corrected from the inherited base logger; original argv preserved above.'
    op.write_text(json.dumps(ownership,indent=2)+'\n')
report.main([root])
base=Path(__file__).resolve().parent.parent
raw=json.loads((base/'results-20261021-raw-pg/ledger.json').read_text())
sb=json.loads((base/'results-20261021-supabase-advocate/ledger.json').read_text())
cx=json.loads((root/'ledger.json').read_text())
def key(c):return tuple(c[k] for k in ['workload','keys','rows','delay_us','writers'])
indices=[{key(r['cell']):r for r in rs} for rs in [raw,sb,cx]]
rows=[dict(cell=r['cell'],raw_pg=indices[0].get(key(r['cell'])),supabase_advocate=indices[1].get(key(r['cell'])),convex_pg=r) for r in cx]
(root/'comparison.json').write_text(json.dumps(rows,indent=2)+'\n')
def rate(r):
    if r is None:return '—'
    n=r['summary']['highest_passing_offered_per_s']
    return f'{n:,}' if n is not None else 'no pass'
headlines=[]
for w,k in [('W1','disjoint'),('W2','disjoint'),('W3','disjoint'),('W4','disjoint'),('W5','same'),('W5','hot1'),('W5','sharded')]:
    for delay in [0,500]:
        c=dict(workload=w,keys=k,rows=1000000,delay_us=delay,writers=128 if w in ['W1','W2','W3'] else 32)
        if k=='sharded' and key(c) not in indices[2]: continue
        headlines.append(dict(cell=c,**{n:i.get(key(c)) for n,i in zip(['raw_pg','supabase_advocate','convex_pg'],indices)}))
(root/'headlines.json').write_text(json.dumps(headlines,indent=2)+'\n')
def table(records):
    t=['| Workload / keys / rows / added RTT µs / clients | Raw PG | Supabase advocate | Convex/PG |','|---|---:|---:|---:|']
    for r in records:
        c=r['cell'];label=f"{c['workload']} / {c['keys']} / {c['rows']} / {c['delay_us']} / {c['writers']}"
        t.append('| '+label+' | '+' | '.join(rate(r.get(k)) for k in ['raw_pg','supabase_advocate','convex_pg'])+' |')
    return t
text=['# Convex/PG beside raw PG and Supabase advocate','',
      'Highest tested passing offered operations/s; all three repetitions meet the same SLO/error/counter criteria. Historical controls were measured earlier, not rerun. Convex uses its default caches and own OCC. Pool caps match; Convex background work shares its cap. The labelled W5 `sharded` row is not a headline: its mutation returns one shard’s count, and `chat:count` still returns the exact total in one query. These are shared-host observations, not product ceilings.','',
      '## Predeclared fixed-budget comparison','',
      'Reads: 128 clients, pool/concurrent-query cap 32. Writes: 32 clients, pool/concurrent-mutation cap 32. Supabase adds its listener.','',*table(headlines),'',
      '## Every Convex cell','',
      'Supabase-advocate did not run the 100k read cells; those entries are absent. Latencies/resources at each system’s own passing rate are in the linked source ledgers and do not isolate per-request overhead.','',*table(rows)]
(root/'comparison.md').write_text('\n'.join(text)+'\n')
# Raw metrics remain archived; retain only scalar count/sum deltas at each passing rate.
def metrics(path):
    s=path.read_text() if path.exists() else gzip.decompress(Path(str(path)+'.gz').read_bytes()).decode()
    result={}
    for line in s.splitlines():
        if line.startswith('#'):continue
        try:name,value=line.rsplit(' ',1);value=float(value)
        except ValueError:continue
        if (any(x in name for x in ['cache_get_seconds_count','cache_hit_total','cache_miss_total','occ','retry','commit_total','execute_udf']) and '_bucket' not in name):result[name]=value
    return result
metric_rows=[]
for row in cx:
    c=row['cell'];passing=row['summary']['highest_passing_offered_per_s']
    if passing is None:continue
    directory=root/f"{c['workload'].lower()}-n{c['rows']}-d{c['delay_us']}-c{c['writers']}-{c['keys']}"
    runs=[]
    for repeat in range(row['summary']['repeats']):
        prefix=f'rate-{passing}-r{repeat}'
        a=metrics(directory/(prefix+'.metrics-before.txt'));b=metrics(directory/(prefix+'.metrics-after.txt'))
        runs.append({k:b[k]-a.get(k,0) for k in b if b[k]-a.get(k,0)!=0})
    keys=set().union(*[r.keys() for r in runs])
    metric_rows.append(dict(cell=c,offered_per_s=passing,median_deltas={k:median(r.get(k,0) for r in runs) for k in sorted(keys)}))
(root/'convex-metrics.json').write_text(json.dumps(metric_rows,indent=2)+'\n')
# The inherited deterministic "1%" policy has a finite-window realized share.
hot_rows=[]
for row in cx:
    c=row['cell'];rate=row['summary']['highest_passing_offered_per_s']
    if c['keys']!='hot1' or rate is None:continue
    directory=root/f"{c['workload'].lower()}-n{c['rows']}-d{c['delay_us']}-c{c['writers']}-{c['keys']}"
    values=[]
    for repeat in range(row['summary']['repeats']):
        prefix=f'rate-{rate}-r{repeat}'
        result=report.read(directory/(prefix+'.json'));a=report.read(directory/(prefix+'.before.json'));b=report.read(directory/(prefix+'.after.json'))
        o=result['options'];total=(rate*(o['warmup_ms']+o['duration_ms'])+999)//1000;warm=(rate*o['warmup_ms']+999)//1000
        hot=lambda seq:(seq//c['writers']+(seq%c['writers'])*37)%100==0
        total_hot=sum(hot(seq) for seq in range(total));measured_hot=sum(hot(seq) for seq in range(warm,total))
        delta=b['counters']['sum']-a['counters']['sum'];hot_delta=b['counters']['hot']-a['counters']['hot']
        values.append(dict(scheduled_all=total,scheduled_hot_all=total_hot,scheduled_measured=result['scheduled'],scheduled_hot_measured=measured_hot,
             scheduled_measured_hot_fraction=measured_hot/max(1,result['scheduled']),counter_delta_all=delta,hot_counter_delta_all=hot_delta,realized_all_hot_fraction=hot_delta/max(1,delta)))
    hot_rows.append(dict(cell=c,offered_per_s=rate,repetitions=values))
(root/'hot-mix.json').write_text(json.dumps(hot_rows,indent=2)+'\n')
rtts={}
for delay in sorted({r['cell']['delay_us'] for r in cx}):
    values=[json.loads(p.read_text()) for p in root.glob(f'*-d{delay}-*/rtt-*.json')]
    rtts[delay]=dict(captures=len(values),p50_median_ms=median(v['p50_us']/1000 for v in values),p99_median_ms=median(v['p99_us']/1000 for v in values),p50_range_ms=[min(v['p50_us']/1000 for v in values),max(v['p50_us']/1000 for v in values)])

(root/'rtt-summary.json').write_text(json.dumps(rtts,indent=2)+'\n')
# One-second measured-window slices at the passing rate. Evidence for steady state, not a new SLO.
steady=[]
for row in cx:
    c=row['cell']; passing=row['summary']['highest_passing_offered_per_s']
    if passing is None: continue
    directory=root/f"{c['workload'].lower()}-n{c['rows']}-d{c['delay_us']}-c{c['writers']}-{c['keys']}"
    by_t={}
    for repeat in range(row['summary']['repeats']):
        result=report.read(directory/f'rate-{passing}-r{repeat}.json')
        for s in result.get('slices') or []:
            by_t.setdefault(s['t_s'], []).append(s)
    if not by_t: continue
    series=[]
    for t in sorted(by_t):
        ss=by_t[t]
        series.append(dict(t_s=t,reps=len(ss),achieved_median=median(s['n']-s['errors'] for s in ss),
            p50_median_ms=median(s['p50_ms'] for s in ss),p99_median_ms=median(s['p99_ms'] for s in ss),
            errors=sum(s['errors'] for s in ss)))
    tail=series[len(series)//2:]
    def span(key,rows):
        xs=[r[key] for r in rows]
        return dict(min=min(xs),median=median(xs),max=max(xs))
    steady.append(dict(cell=c,offered_per_s=passing,seconds=len(series),
        tail_achieved_per_s=span('achieved_median',tail),tail_p50_ms=span('p50_median_ms',tail),
        tail_p99_ms=span('p99_median_ms',tail),series=series))
(root/'steady.json').write_text(json.dumps(steady,indent=2)+'\n')
(root/'derivation.json').write_text(json.dumps({str(p.relative_to(base)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [Path(__file__),base/'scripts/report.py',base/'scripts/plot.py',base/'scripts/plot-convex-comparison.py',base/'results-20261021-raw-pg/ledger.json',base/'results-20261021-supabase-advocate/ledger.json']},indent=2)+'\n')
print(len(rows),'comparison rows;',len(metric_rows),'metric rows')
