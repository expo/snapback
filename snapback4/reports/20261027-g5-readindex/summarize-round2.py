#!/usr/bin/env python3
"""Summarize the fixed G5R2 matrix and separate clocked diagnostics.

Usage: summarize-round2.py round2-measurements.json /tmp/sb4-g5r2-campaign DEST
No missing CPU sample is imputed. Every primary repetition is retained.
"""
import argparse,csv,json,math,statistics
from pathlib import Path
from collections import defaultdict
ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('measurements',type=Path);ap.add_argument('raw',type=Path);ap.add_argument('dest',type=Path);ap.add_argument('--allow-partial',action='store_true');a=ap.parse_args()
r=json.loads(a.measurements.read_text());groups=defaultdict(list)
if not a.allow_partial:
 assert r['fixture_rows']==1000000 and not r['pilot']
 assert not r.get('stopped_reason'),r.get('stopped_reason')
 assert len(r['runs'])==204 and sum(not v.get('diagnostic') for v in r['runs'])==198
 assert r['cleanup']['pidfile_absent'] and not r['cleanup']['still_running']
 expected={(w,l,rate,rep,arm) for rep in range(3) for w in ['W1','W2','W3'] for l in ['A','B'] for rate in ([8000,9514,11313,16000] if w=='W3' else [8000,9514,11313]) for arm in ['g5','ri','g6']}
 expected|={('W4','A',rate,rep,arm) for rate in [800,2262] for rep in range(3) for arm in ['g5','ri','g6']}
 actual=[(v['workload'],v['link'],v['rate'],v['repeat'],v['arm']) for v in r['runs'] if not v.get('diagnostic')]
 assert len(actual)==len(set(actual)) and set(actual)==expected
def median(xs):
 xs=[x for x in xs if x is not None];return statistics.median(xs) if xs else None
def quantile(xs,q):
 return sorted(xs)[max(0,math.ceil(len(xs)*q)-1)] if xs else None
def fmt(x,n=3):return '-' if x is None else f'{x:.{n}f}'
def cpu(result,index):
 c=result['cpu_window'];before=c['before']['processes'];after={p['pid']:p for p in c['after']['processes']}
 if len(before)<=index:return None,None
 b=before[index];e=after.get(b['pid'])
 if not e or b['start_ticks']!=e['start_ticks'] or b['cpu_s'] is None or e['cpu_s'] is None:return None,None
 seconds=c['after']['elapsed_unix_s']-c['before']['elapsed_unix_s']
 delta=e['cpu_s']-b['cpu_s']
 return (delta/seconds if seconds>0 else None, delta*1e6/result['success'] if result['success'] else None)
for row in r['runs']:
 d=a.raw/f"{row['workload']}-{row['link']}-{row['rate']}-r{row['repeat']}-{row['arm']}"
 result=json.loads((d/f"rate-{row['rate']}-r{row['repeat']}.json").read_text())
 # The harness appends its own PID after the supplied [server, proxy] PIDs.
 # Check that order against the actual recorded options before attributing CPU.
 pids=result['options']['cpu_pids']
 assert len(pids)==2 and [p['pid'] for p in result['cpu_window']['before']['processes'][:2]]==pids
 row['generator_cpu_cores'],row['generator_cpu_us_per_measured_ack']=cpu(result,2)
 row['server_cpu_cores'],row['server_cpu_us_per_measured_ack']=cpu(result,0)
 row['proxy_cpu_cores'],_=cpu(result,1)
 if not row.get('diagnostic'):groups[row['workload'],row['link'],row['rate'],row['arm']].append(row)
agg=[]
for (w,l,rate,arm),rows in sorted(groups.items()):
 v=dict(workload=w,link=l,rate=rate,arm=arm,passes=sum(x['slo_pass'] for x in rows),windows=len(rows),errors=sum(x['errors'] for x in rows),scheduled=sum(x['scheduled'] for x in rows),p50_median=median([x['p50_ms'] for x in rows]),p99_median=median([x['p99_ms'] for x in rows]),p99_max=max(x['p99_ms'] for x in rows),p99_min=min(x['p99_ms'] for x in rows),pg_cpu_us_per_cohort_ack=median([x['pg_cpu_us_per_cohort_ack'] for x in rows]),pg_cpu_valid=sum(x['pg_cpu_us_per_cohort_ack'] is not None for x in rows),sql_per_cohort_ack=median([x['sql_per_cohort_ack'] for x in rows]),generator_cpu_cores=median([x['generator_cpu_cores'] for x in rows]),server_cpu_cores=median([x['server_cpu_cores'] for x in rows]),dispatch_p99_ms=median([x['dispatch_p99_ms'] for x in rows]),service_p99_ms=median([x['service_p99_ms'] for x in rows]))
 v['proxy_cpu_cores']=median([x['proxy_cpu_cores'] for x in rows])
 v['generator_cpu_us_per_measured_ack']=median([x['generator_cpu_us_per_measured_ack'] for x in rows])
 v['server_cpu_us_per_measured_ack']=median([x['server_cpu_us_per_measured_ack'] for x in rows])
 agg.append(v)
a.dest.mkdir(exist_ok=True)
(a.dest/'round2-aggregate.json').write_text(json.dumps(agg,indent=2)+'\n')
with (a.dest/'round2-table.csv').open('w',newline='') as f:
 writer=csv.DictWriter(f,fieldnames=list(agg[0]) if agg else [],lineterminator='\n');writer.writeheader();writer.writerows(agg)
lookup={(v['workload'],v['link'],v['rate'],v['arm']):v for v in agg}
lines=['# Round 2 — passes/windows; worst repetition p99 (ms)','','Read SLO: p99 ≤50 ms and errors ≤0.1%; W4 write SLO: ≤100 ms, ≤0.1%, exact counters. No failed repetition is replaced.','','| Cell | Offered/s | G5 | G5-RI | G6 |','| --- | ---: | ---: | ---: | ---: |']
for w,l,rate in sorted({(v['workload'],v['link'],v['rate']) for v in agg}):
 cells=[]
 for arm in ['g5','ri','g6']:
  v=lookup.get((w,l,rate,arm));cells.append(f"{v['passes']}/{v['windows']}; {v['p99_max']:.3f}" if v else '-')
 lines.append(f"| {w}/{l} | {rate:,} | "+' | '.join(cells)+' |')
(a.dest/'ROUND2-TABLE.md').write_text('\n'.join(lines)+'\n')
lines=['# Round 2 — full aggregate','','Quantiles and costs are medians of window values; p99 max retains the worst repetition. CPU and SQL use whole-cohort ACKs, including warm-up, drain and native observer/barrier framing. Failed-window costs are descriptive, not steady-state costs.','','| Cell/rate | Arm | Pass | p50/p99 ms | Worst p99 | PG µs/ACK (n) | SQL/ACK |','| --- | --- | ---: | ---: | ---: | ---: | ---: |']
for v in agg:lines.append(f"| {v['workload']}/{v['link']} {v['rate']:,} | {v['arm']} | {v['passes']}/{v['windows']} | {fmt(v['p50_median'])}/{fmt(v['p99_median'])} | {fmt(v['p99_max'])} | {fmt(v['pg_cpu_us_per_cohort_ack'],1)} ({v['pg_cpu_valid']}) | {fmt(v['sql_per_cohort_ack'],5)} |")
(a.dest/'ROUND2-FULL.md').write_text('\n'.join(lines)+'\n')
traces=[]
for row in r['runs']:
 if not row.get('diagnostic'):continue
 d=a.raw/f"{row['workload']}-{row['link']}-{row['rate']}-r{row['repeat']}-{row['arm']}"
 path=d/'trace.jsonl'
 if not path.exists():continue
 records=[json.loads(line) for line in path.read_text().splitlines()]
 queries=[v for v in records if v['query_start'] and v['query_end']>=v['query_start']]
 pairs=dict(intake=('dispatched','accepted'),worker_queue=('started','dispatched'),prepare=('parsed','started'),lookup_wall=('lookup_end','lookup_start'),lookup_cpu=('lookup_cpu_end','lookup_cpu_start'),park_and_resume_queue=('parked_end','parked_start'),resume_admission=('resumed','parked_end'),query_wall=('query_end','query_start'),query_cpu=('query_cpu_ns_end','query_cpu_ns_start'),encode_wall=('encode_end','encode_start'),encode_cpu=('encode_cpu_end','encode_cpu_start'),write=('write_end','write_start'),server_response=('write_end','accepted'))
 phases={}
 for name,(end,start) in pairs.items():
  values=[(v[end]-v[start])/1e6 for v in queries if v.get(start,0)>0 and v.get(end,0)>=v[start]]
  phases[name]=dict(n=len(values),p50_ms=quantile(values,.5),p99_ms=quantile(values,.99),mean_ms=statistics.mean(values) if values else None)
 for name,field in [('parser_cpu','parser_cpu_ns'),('active_cpu','active_cpu_ns')]:
  values=[v[field]/1e6 for v in queries if v.get(field) is not None]
  phases[name]=dict(n=len(values),p50_ms=quantile(values,.5),p99_ms=quantile(values,.99),mean_ms=statistics.mean(values) if values else None)
 parked=[v for v in queries if v.get('parked_start',0)>0]
 parked_cpu={}
 for name,(end,start) in pairs.items():
  values=[(v[end]-v[start])/1e6 for v in parked if v.get(start,0)>0 and v.get(end,0)>=v[start]]
  parked_cpu[name]=dict(n=len(values),p50_ms=quantile(values,.5),p99_ms=quantile(values,.99),mean_ms=statistics.mean(values) if values else None)
 for name,field in [('parser_cpu','parser_cpu_ns'),('active_cpu','active_cpu_ns')]:
  values=[v[field]/1e6 for v in parked if v.get(field) is not None]
  parked_cpu[name]=dict(n=len(values),p50_ms=quantile(values,.5),p99_ms=quantile(values,.99),mean_ms=statistics.mean(values) if values else None)
 traces.append(dict(workload=row['workload'],link=row['link'],rate=row['rate'],arm=row['arm'],slo_pass=row['slo_pass'],p99_ms=row['p99_ms'],dispatch_p99_ms=row['dispatch_p99_ms'],service_p99_ms=row['service_p99_ms'],generator_cpu_cores=row['generator_cpu_cores'],server_cpu_cores=row['server_cpu_cores'],traced_queries=len(queries),phases=phases,parked_subset=parked_cpu))
(a.dest/'round2-attribution.json').write_text(json.dumps(dict(note='Separate traced diagnostic cohorts include warm-up and drain; stage quantiles are not additive or a matched per-request decomposition of primary p99. Native CPU window values are retained independently of whole-cohort PG CPU.',cohorts=traces,primary=agg),indent=2)+'\n')
print('primary windows',sum(len(v) for v in groups.values()),'aggregates',len(agg),'trace cohorts',len(traces))
