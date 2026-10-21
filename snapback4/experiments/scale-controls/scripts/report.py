#!/usr/bin/env python3
"""Derive the ledger and resource attribution from retained per-rate evidence."""
import json
import gzip
import re
from pathlib import Path
from statistics import median
import sys


def contents(path):
    if path.suffix=='.gz': return gzip.decompress(path.read_bytes()).decode()
    if path.exists(): return path.read_text()
    return gzip.decompress(Path(str(path)+'.gz').read_bytes()).decode()


def read(path): return json.loads(contents(path))


STAT_FIELDS=['calls','rows','total_exec_time','shared_blks_hit','shared_blks_read','shared_blks_dirtied','wal_bytes','wal_records','wal_fpi']


def statements_by_id(snapshot):
    # PostgREST executes under both authenticator and authenticated. pg_stat_
    # statements has separate rows by userid/toplevel, even with one queryid.
    # The snapshots retain every row; aggregate them before taking a delta.
    grouped={}
    for statement in snapshot['statements']:
        key=statement['queryid']
        if key not in grouped:
            grouped[key]=dict(queryid=key,query=statement['query'],**{k:0 for k in STAT_FIELDS})
        for field in STAT_FIELDS: grouped[key][field]+=statement[field]
    return grouped


def cpu_seconds(resources,kind,ownership):
    pids={str(p['pid']) for p in ownership if p['kind']==kind}
    samples=resources['samples']
    if len(samples)<2: return 0
    ticks=0
    for pid in pids:
        values=[s['processes'].get(pid) for s in samples if s['processes'].get(pid)]
        if len(values)>1: ticks+=max(0,values[-1]['ticks']-values[0]['ticks'])
    return ticks/resources['clock_ticks']


def db_cpu_seconds(path):
    records=[json.loads(line) for line in contents(path).splitlines() if line.startswith('{')]
    ticks=records[0]['clock_ticks']
    pids={pid for r in records[1:] for pid in r['processes']}
    total=0
    for pid in pids:
        values=[r['processes'][pid]['ticks'] for r in records[1:] if pid in r['processes']]
        if len(values)>1: total+=max(0,values[-1]-values[0])
    return total/ticks


def details(directory,rate,ownership):
    runs=[]
    for file in sorted(directory.glob(f'rate-{rate}-r[0-9]*.json')):
        if not re.fullmatch(r'rate-[0-9]+-r[0-9]+\.json',file.name): continue
        r=read(file)
        prefix=file.stem
        before=read(directory/f'{prefix}.before.json'); after=read(directory/f'{prefix}.after.json')
        n=r['total_success_including_warmup']
        resources=read(directory/f'{prefix}.resources.json')
        r['derived']={f'{kind}_cpu_ms_per_op':cpu_seconds(resources,kind,ownership)*1000/max(1,n) for kind in ['app','load','ssh']}
        r['derived']['db_cpu_ms_per_op']=db_cpu_seconds(directory/f'{prefix}.db-cpu.jsonl')*1000/max(1,n)
        r['derived']['wal_lsn_bytes_per_op']=(after['wal_lsn']-before['wal_lsn'])/max(1,n)
        old=statements_by_id(before)
        deltas=[]
        for s in statements_by_id(after).values():
            delta={k:s[k]-old.get(s['queryid'],{}).get(k,0) for k in STAT_FIELDS}
            if delta['calls']>0: deltas.append(dict(query=s['query'],queryid=s['queryid'],**delta))
        r['derived']['statements_delta']=deltas
        r['derived']['sql_exec_ms_per_op']=sum(d['total_exec_time'] for d in deltas)/max(1,n)
        r['derived']['sql_calls_per_op']=sum(d['calls'] for d in deltas)/max(1,n)
        waits={}
        active=0
        max_connected=0; max_active=0
        for line in contents(directory/f'{prefix}.waits.txt').splitlines():
            if not line.startswith('{'): continue
            sample=json.loads(line)
            max_connected=max(max_connected,sum(s['n'] for s in sample['states']))
            max_active=max(max_active,sum(s['n'] for s in sample['states'] if s['state']=='active'))
            for s in sample['states']:
                key=':'.join(str(s.get(k) or '-') for k in ['state','wait_event_type','wait_event'])
                waits[key]=waits.get(key,0)+s['n']
                if s['state']=='active': active+=s['n']
        r['derived']['wait_samples']=waits
        r['derived']['active_samples']=active
        r['derived']['max_connected']=max_connected
        r['derived']['max_active']=max_active
        runs.append(r)
    return runs


def main(roots):
    records=[]
    curves=[]
    for root in roots:
        ownership=[json.loads(line) for line in (root/'pids.jsonl').read_text().splitlines()]
        for summary in sorted(root.glob('*/summary.json')):
            directory=summary.parent
            cell=read(directory/'cell.json'); info=read(summary)
            passed=info['highest_passing_offered_per_s']
            curve=[]
            for rate in info['rates']:
                runs=details(directory,rate,ownership)
                curve.append({'offered_per_s':rate,'all_pass':all(r['slo_pass'] for r in runs),
                    'achieved_median':median(r['achieved_per_s'] for r in runs),
                'completed_in_window_median':median(r['completed_in_window_per_s'] for r in runs),
                    'p50_ms':median(r['latency']['p50_ms'] for r in runs),
                    'p99_ms':median(r['latency']['p99_ms'] for r in runs),
                    'p999_ms':median(r['latency']['p999_ms'] for r in runs),
                    'errors':sum(r['error_count'] for r in runs)})
            curves.append({'cell':cell,'rates':curve})
            if passed is None: records.append(dict(cell=cell,summary=info)); continue
            runs=details(directory,passed,ownership)
            waits={}
            for r in runs:
                for key,n in r['derived']['wait_samples'].items():
                    if key.startswith('active:'): waits[key]=waits.get(key,0)+n
            lead=max(waits,key=waits.get) if waits else 'no active sample'
            records.append({'cell':cell,'summary':info,
                'achieved_median':median(r['achieved_per_s'] for r in runs),
                'completed_in_window_median':median(r['completed_in_window_per_s'] for r in runs),
                'achieved_min':min(r['achieved_per_s'] for r in runs),
                'achieved_max':max(r['achieved_per_s'] for r in runs),
                'completed_in_window_min':min(r['completed_in_window_per_s'] for r in runs),
                'completed_in_window_max':max(r['completed_in_window_per_s'] for r in runs),
                'p50_ms':median(r['latency']['p50_ms'] for r in runs),
                'p99_ms':median(r['latency']['p99_ms'] for r in runs),
                'p99_worst_ms':max(r['latency']['p99_ms'] for r in runs),
                'p999_ms':median(r['latency']['p999_ms'] for r in runs),
                'errors':sum(r['error_count'] for r in runs),
                'leading_active_wait':lead,
                **{k:median(r['derived'][k] for r in runs) for k in ['app_cpu_ms_per_op','load_cpu_ms_per_op','ssh_cpu_ms_per_op','db_cpu_ms_per_op','wal_lsn_bytes_per_op','sql_exec_ms_per_op','sql_calls_per_op','max_connected','max_active']}})
    records.sort(key=lambda r:(r['cell']['workload'],r['cell']['keys'],r['cell']['rows'],r['cell']['delay_us'],r['cell']['writers']))
    destination=roots[0]
    target=('Convex/PG (self-hosted)' if any(r['cell'].get('target')=='convex' for r in records) else 'Supabase (PostgREST only)' if any(r['cell'].get('target')=='supabase' for r in records) else 'Raw PG')
    (destination/'ledger.json').write_text(json.dumps(records,indent=2)+'\n')
    (destination/'curves.json').write_text(json.dumps(curves,indent=2)+'\n')
    text=[f'# {target} limits ledger','',
          f'{target} rates are highest tested passing offered/cohort-acknowledgement brackets; completion-window throughput is separately retained in ledger.json. Values are medians of three repetitions. Read the result README caveats.','',
          f'| Workload / rows / added RTT µs / clients / keys | {target} cohort acks/s (run range) | p50 / p99 / p99.9 ms | worst p99 | next failed offered/s | leading active wait |',
          '|---|---:|---:|---:|---:|---|']
    for r in records:
        c=r['cell']; label=f"{c['workload']} / {c['rows']} / {c['delay_us']} / {c['writers']} / {c['keys']}"
        if 'achieved_median' not in r:
            text.append(f'| {label} | no passing rate | — | — | — | — |'); continue
        text.append(f"| {label} | {r['achieved_median']:.0f} ({r['achieved_min']:.0f}–{r['achieved_max']:.0f}) | {r['p50_ms']:.2f} / {r['p99_ms']:.2f} / {r['p999_ms']:.2f} | {r['p99_worst_ms']:.2f} | {r['summary']['lowest_failing_offered_per_s']} | {r['leading_active_wait']} |")
    text+=['','## Resource evidence at each passing rate','',
           'CPU ms/op are sampled process ticks (sample edges undercount); app includes proxy. SQL counters aggregate all captured role/toplevel rows by queryid before differencing. SQL execution sums include waits and can overlap for nested RPC calls; they are not CPU, request wall time or protocol roundtrip counts. WAL is cluster LSN growth per successful operation including warm-up.','',
           '| Workload / rows / added RTT µs / clients / keys | app CPU ms/op | load CPU | SSH CPU | DB CPU | SQL exec ms/op | WAL B/op | SQL calls/op |',
           '|---|---:|---:|---:|---:|---:|---:|---:|']
    for r in records:
        if 'achieved_median' not in r: continue
        c=r['cell']; label=f"{c['workload']} / {c['rows']} / {c['delay_us']} / {c['writers']} / {c['keys']}"
        values=[r[k] for k in ['app_cpu_ms_per_op','load_cpu_ms_per_op','ssh_cpu_ms_per_op','db_cpu_ms_per_op','sql_exec_ms_per_op','wal_lsn_bytes_per_op','sql_calls_per_op']]
        text.append('| '+label+' | '+' | '.join(f'{v:.3f}' for v in values)+' |')
    (destination/'ledger.md').write_text('\n'.join(text)+'\n')
    print(f'{len(records)} ledger rows written to {destination}')


if __name__=='__main__': main([Path(p) for p in sys.argv[1:]])
