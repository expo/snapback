#!/usr/bin/env python3
"""Audit/aggregate S1-PG2; no load, credentials or product instrumentation."""
import argparse
from collections import Counter
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
from statistics import mean, median
import subprocess as sp
import sys

import report
from run import HERE, write as exclusive_write

spec=importlib.util.spec_from_file_location('fair',HERE/'scripts/report-fairness.py')
fair=importlib.util.module_from_spec(spec);spec.loader.exec_module(fair)
read=report.read
def write(p,v):p.write_text(json.dumps(v,indent=2)+'\n')
def fmt(n):return 'no pass' if n is None else f'{n:,}'
def label(c):return c['workload']+(' '+c['keys'] if c['workload']=='W5' else '')+(' natural' if c['delay_us']==0 else ' +0.5 ms')
def span(xs):return dict(min=min(xs),median=median(xs),max=max(xs))


def delta(before,after):
    old=report.statements_by_id(before)
    rows=[]
    for s in report.statements_by_id(after).values():
        d={k:s[k]-old.get(s['queryid'],{}).get(k,0) for k in report.STAT_FIELDS}
        assert d['calls']>=0,'pg_stat_statements reset or eviction'
        if d['calls']:rows.append(dict(query=s['query'],queryid=s['queryid'],**d))
    return rows


def probe(directory,cell):
    meta=read(directory/'probe.json');n=meta['operations']
    before=read(directory/'probe.before.json');after=read(directory/'probe.after.json')
    ss=delta(before,after)
    count=lambda p:sum(s['calls'] for s in ss if s['query'].startswith(p))
    renew=count('UPDATE _owner SET lease_until')
    starts=count('START TRANSACTION')
    commits=count('COMMIT');rollbacks=count('ROLLBACK')
    calls=sum(s['calls'] for s in ss)
    # Ownership renew: START, UPDATE, SET LOCAL statement_timeout, SET LOCAL
    # lock_timeout, COMMIT. The two SETs share one driver batch exchange.
    workload_calls=calls-5*renew
    durable=commits-renew
    ro=count('START TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    exchanges=workload_calls-durable
    execution=sum(s['total_exec_time'] for s in ss)/n
    commit_exec=sum(s['total_exec_time'] for s in ss if s['query'].startswith('COMMIT'))/max(1,commits)
    return dict(cell=cell,operations=n,latencies_ms=dict(**span(meta['latencies_ms']),mean=mean(meta['latencies_ms'])),
        statements_per_op=workload_calls/n,inferred_driver_exchanges_per_op=exchanges/n,
        exchange_caveat='warm source inference, one exchange saved by paired commit SETs; not a packet trace',
        transaction_starts_per_op=(starts-renew)/n,readonly_starts_per_op=ro/n,
        commits_per_op=durable/n,rollbacks_per_op=rollbacks/n,
        session_resolutions_per_op=count('SELECT principal, COALESCE(family')/n,
        background_renewals=renew,raw_statement_calls=calls,
        sql_exec_ms_per_op=execution,utility_commit_exec_ms=commit_exec,
        db_xact_commit_delta=after['database']['xact_commit']-before['database']['xact_commit'],
        db_xact_rollback_delta=after['database']['xact_rollback']-before['database']['xact_rollback'],
        database_stats_caveat='all backends in own database; counter observer adds transactions; idle-backend report lag can shift boundaries',
        statements=ss)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('campaign',type=Path);p.add_argument('out',type=Path)
    args=p.parse_args();root=args.campaign;out=args.out;out.mkdir(parents=True,exist_ok=True)
    assert not read(root/'cleanup.json')['still_running']
    sp.run([sys.executable,str(HERE/'scripts/audit.py'),str(root)],check=True)
    events=[json.loads(line) for line in (root/'pids.jsonl').read_text().splitlines()]
    apps={str(e['pid']) for e in events if e['kind']=='serve'}
    loads={str(e['pid']) for e in events if e['kind'].startswith('rate-')}
    curves=[];ledger=[];steady=[];statements=[];rtts=[]
    order={(w,k):i for i,(w,k,_) in enumerate(fair.WORK)}
    paths=sorted(root.glob('*/summary.json'),key=lambda p:(read(p.parent/'cell.json')['delay_us'],order[(read(p.parent/'cell.json')['workload'],read(p.parent/'cell.json')['keys'])]))
    for path in paths:
        directory=path.parent;cell=read(directory/'cell.json');summary=read(path)
        rates=[]
        for rate in summary['rates']:
            runs=[read(directory/f'rate-{rate}-r{i}.json') for i in range(3)]
            resources=[]
            for i,r in enumerate(runs):
                assert r['options']['target']=='snapback'
                assert r['options']['warmup_ms']==10000 and r['options']['duration_ms']==20000
                prefix=f'rate-{rate}-r{i}'
                capture=read(directory/f'{prefix}.resources.json');samples=capture['samples']
                before=read(directory/f'{prefix}.before.json');after=read(directory/f'{prefix}.after.json')
                n=r['total_success_including_warmup'];ss=delta(before,after)
                def cpu(pids):
                    ticks=0
                    for pid in pids:
                        vs=[s['processes'].get(pid) for s in samples if s['processes'].get(pid)]
                        if len(vs)>1:ticks+=vs[-1]['ticks']-vs[0]['ticks']
                    return ticks/capture['clock_ticks']
                resources.append(dict(serve_cpu_ms_per_op=cpu(apps)*1000/max(1,n),
                    load_cpu_ms_per_op=cpu(loads)*1000/max(1,n),
                    statements_per_op_including_background=sum(s['calls'] for s in ss)/max(1,n),
                    sql_exec_ms_per_op=sum(s['total_exec_time'] for s in ss)/max(1,n),
                    wal_bytes_per_op_role_filtered=sum(s['wal_bytes'] for s in ss)/max(1,n),
                    xact_commit_delta=after['database']['xact_commit']-before['database']['xact_commit'],
                    xact_rollback_delta=after['database']['xact_rollback']-before['database']['xact_rollback'],
                    counter_check=r.get('counter_check'),
                    thread_wait_channels=dict(Counter(v for s in samples for v in s.get('server_wchan',{}).values()))))
            rates.append(dict(rate=rate,pass_all=all(r['slo_pass'] for r in runs),
                p50_ms=[r['latency']['p50_ms'] for r in runs],p99_ms=[r['latency']['p99_ms'] for r in runs],
                p999_ms=[r['latency']['p999_ms'] for r in runs],errors=[r['error_count'] for r in runs],
                completed_in_window_per_s=[r['completed_in_window_per_s'] for r in runs],resources=resources))
        best=next((r for r in rates if r['rate']==summary['highest_passing_offered_per_s']),None)
        row=dict(cell=cell,summary=summary,passing=best);ledger.append(row)
        curves.append(dict(cell=cell,summary=summary,rates=rates))
        runs=[] if best is None else [read(directory/f"rate-{best['rate']}-r{i}.json") for i in range(3)]
        steady.append(fair.steady('snapback-postgres',row,runs))
        statements.append(probe(directory,cell))
        rtts.extend(dict(cell=cell,phase=phase,**read(directory/f'rtt-{phase}.json')) for phase in ('before','after'))
    assert len(ledger)==12
    for name,value in [('ledger.json',ledger),('curves.json',curves),('steady.json',steady),('statements-per-op.json',statements),('rtt.json',rtts)]:write(out/name,value)
    controls=read(HERE/'results-20261022-fairness/comparison.json')
    sqlite=read(HERE/'results-20261022-snapback-sqlite/ledger.json')
    table=['| Workload | Link | Snapback PG | Raw PG token | Raw PG no token | Supabase advocate | Convex/PG advocate | Snapback SQLite (natural only) |','|---|---|---:|---:|---:|---:|---:|---:|']
    combined=[]
    for row in ledger:
        c=row['cell'];control=next(x for x in controls if all(c[k]==x['cell'][k] for k in ('workload','keys','delay_us')))
        sk=next(x for x in sqlite if all(c[k]==x['cell'][k] for k in ('workload','keys')))
        rates=dict(snapback_postgres=row['summary']['highest_passing_offered_per_s'],**control['rates'],snapback_sqlite_natural=sk['summary']['highest_passing_offered_per_s'])
        combined.append(dict(cell=c,label=control['label'],rates=rates))
        table.append('| '+control['label']+' | '+('natural' if c['delay_us']==0 else '+0.5 ms')+' | '+' | '.join(fmt(x) for x in rates.values())+' |')
    (out/'comparison.md').write_text('\n'.join(table)+'\n');write(out/'comparison.json',combined)
    table=['| Cell | Offered/s | p50 ms median | p99 ms median (range) | App CPU ms/op | Role WAL B/op |','|---|---:|---:|---:|---:|---:|']
    for row in ledger:
        b=row['passing']
        if b:table.append(f"| {label(row['cell'])} | {fmt(b['rate'])} | {median(b['p50_ms']):.3f} | {median(b['p99_ms']):.3f} ({min(b['p99_ms']):.3f}–{max(b['p99_ms']):.3f}) | {median(x['serve_cpu_ms_per_op'] for x in b['resources']):.3f} | {median(x['wal_bytes_per_op_role_filtered'] for x in b['resources']):.0f} |")
    (out/'ledger.md').write_text('\n'.join(table)+'\n')
    table=['| Cell | Statements/op | Starts/op | RO starts/op | COMMIT/op | ROLLBACK/op | Sessions/op | Inferred exchanges/op | RFC envelope |','|---|---:|---:|---:|---:|---:|---:|---:|---:|']
    for s in statements:
        vals=[s[k] for k in ('statements_per_op','transaction_starts_per_op','readonly_starts_per_op','commits_per_op','rollbacks_per_op','session_resolutions_per_op','inferred_driver_exchanges_per_op')]
        table.append('| '+label(s['cell'])+' | '+' | '.join(f'{v:.3f}' for v in vals)+' | '+('~57' if s['cell']['workload'] in ('W4','W5') else '~23')+' |')
    (out/'statements-per-op.md').write_text('\n'.join(table)+'\n')
    table=['| Cell | Offered/s | Second-half ack/s (all reps) | Tail p50 median ms range | Tail p99 median ms range | Exact every second/rep |','|---|---:|---:|---:|---:|---|']
    for s in steady:
        if s['offered_per_s'] is None:continue
        a=s['tail_acknowledged_per_s'];x=s['tail_p50_ms'];y=s['tail_p99_ms']
        table.append(f"| {label(s['cell'])} | {s['offered_per_s']} | {a['min']}–{a['max']} | {x['min']:.3f}–{x['max']:.3f} | {y['min']:.3f}–{y['max']:.3f} | {s['tail_equals_offered_every_second_every_repetition']} |")
    (out/'steady.md').write_text('\n'.join(table)+'\n')
    diagnosis=[]
    for s in statements:
        c=s['cell']
        if c['workload'] not in ('W4','W5'):continue
        rtt=median(x['p50_ms'] for x in rtts if all(x['cell'][k]==c[k] for k in ('workload','keys','delay_us')))
        curve=next(x for x in curves if x['cell']==c)
        failed=[r for r in curve['rates'] if not r['pass_all']]
        model_ms=s['inferred_driver_exchanges_per_op']*rtt+s['sql_exec_ms_per_op']
        diagnosis.append(dict(cell=c,prepared_rtt_p50_ms=rtt,exchanges=s['inferred_driver_exchanges_per_op'],
            serial_probe_ms=s['latencies_ms'],network_only_ms=s['inferred_driver_exchanges_per_op']*rtt,
            server_sql_exec_ms_per_op=s['sql_exec_ms_per_op'],utility_commit_exec_ms=s['utility_commit_exec_ms'],
            no_separate_flush_model_ms=model_ms,reciprocal_serial_model_per_s=1000/model_ms,
            serial_probe_reciprocal_per_s=1000/s['latencies_ms']['mean'],
            overload_completed_per_s=span([v for r in failed for v in r['completed_in_window_per_s']]) if failed else None,
            engine_or_committer_queue_ms=None,
            caveat='statement exec plus k*prepared RTT is a serial request model; COMMIT utility timing does not isolate flush; pipeline overlap, variable RTT and queues prevent treating it as a measured writer ceiling'))
    write(out/'write-diagnosis.json',diagnosis)
    typed=read(HERE/'results-20261022-fairness/raw-pg/storage-1000000.json')
    native=read(root/'storage.json')
    typed_bytes=sum(t['heap_bytes']+t['indexes_bytes'] for t in typed['tables'])
    native_bytes=sum(t['heap_bytes']+t['indexes_bytes'] for t in native['tables'])
    write(out/'storage-comparison.json',dict(snapback_postgres_bytes=native_bytes,typed_postgres_bytes=typed_bytes,
        ratio=native_bytes/typed_bytes,exceeds_3x=native_bytes>3*typed_bytes,
        method='sum pg_table_size + pg_indexes_size after ordinary VACUUM ANALYZE; all Snapback namespace tables versus five typed app tables',
        caveat='includes metadata, generic indexes and allocated free space; native incremental seed and typed bulk seed have different write histories; not a live-byte or layout-only causal attribution'))
    for name in ('ownership.json','audit.json','seed.json','seed-equality.json','final-equality.json','storage.json','postgres.txt','cleanup.json','database-cleanup.json','check.txt','lscpu.txt','disks.txt','filesystem.txt'):
        if (root/name).exists():shutil.copyfile(root/name,out/name)
    # Role-filtered activity samples retain ClientRead/ClientWrite, WAL and lock
    # waits; labels use wall time shared with the per-trial resource records.
    observations=[]
    if (root/'wait-observer.jsonl').exists():
        for line in (root/'wait-observer.jsonl').read_text().splitlines():
            if line.startswith('{'):observations.append(json.loads(line))
    wait_rows=[]
    for path in paths:
        directory=path.parent;cell=read(directory/'cell.json');summary=read(path)
        best=summary['highest_passing_offered_per_s']
        if best is None:continue
        counts=Counter();active=Counter();max_connected=0
        for i in range(3):
            capture=read(directory/f'rate-{best}-r{i}.resources.json')
            for sample in observations:
                if capture['start']<=sample['time']<=capture['end']:
                    max_connected=max(max_connected,len(sample['states']))
                    for s in sample['states']:
                        key=f"{s['state']}:{s['wait_type']}:{s['wait']}"
                        counts[key]+=1
                        if s['state']=='active':active[key]+=1
        wait_rows.append(dict(cell=cell,max_connections=max_connected,state_wait_samples=dict(counts),active_wait_samples=dict(active)))
    write(out/'waits.json',wait_rows)
    import matplotlib
    matplotlib.use('Agg');matplotlib.rcParams['svg.fonttype']='none';matplotlib.rcParams['svg.hashsalt']='s1pg2'
    import matplotlib.pyplot as plt
    fig,axes=plt.subplots(2,6,figsize=(21,7))
    for ax,row in zip(axes.flat,curves):
        rs=row['rates'];xs=[r['rate'] for r in rs]
        ax.plot(xs,[median(r['p50_ms']) for r in rs],'.-',label='p50')
        ax.plot(xs,[median(r['p99_ms']) for r in rs],'.-',label='p99')
        ax.fill_between(xs,[min(r['p99_ms']) for r in rs],[max(r['p99_ms']) for r in rs],alpha=.2)
        failed=[r for r in rs if not r['pass_all']]
        ax.scatter([r['rate'] for r in failed],[median(r['p99_ms']) for r in failed],marker='x',color='red')
        ax.axhline(100 if row['cell']['workload'] in ('W4','W5') else 50,ls='--',color='gray')
        ax.set(xscale='log',yscale='log',title=label(row['cell']),xlabel='Offered/s',ylabel='Intended-arrival ms');ax.grid(alpha=.2)
    axes.flat[0].legend();fig.tight_layout();fig.savefig(out/'curves.svg',metadata={'Date':None});plt.close(fig)
    fig,axes=plt.subplots(2,6,figsize=(21,7))
    for ax,row in zip(axes.flat,steady):
        if row['offered_per_s'] is None:continue
        ss=row['series'];xs=[s['t_s'] for s in ss]
        ax.plot(xs,[s['p99_median_ms'] for s in ss]);ax.fill_between(xs,[s['p99_across_repetitions_ms']['min'] for s in ss],[s['p99_across_repetitions_ms']['max'] for s in ss],alpha=.2)
        ax.axvspan(10,19,alpha=.1,color='gray');ax.set(title=f"{label(row['cell'])}: {row['offered_per_s']}/s",xlabel='Intended-arrival second',ylabel='p99 ms');ax.grid(alpha=.2)
    fig.tight_layout();fig.savefig(out/'steady-tail.svg',metadata={'Date':None});plt.close(fig)
    for path in out.glob('*.svg'):path.write_text('\n'.join(x.rstrip() for x in path.read_text().splitlines())+'\n')
    print(json.dumps(dict(cells=len(ledger),trials=read(root/'audit.json')['trials'],rates=[r['summary']['highest_passing_offered_per_s'] for r in ledger])))


if __name__=='__main__':main()
