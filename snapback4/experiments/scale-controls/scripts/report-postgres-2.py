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


def steady_row(row,directory):
    best=row['summary']['highest_passing_offered_per_s']
    shown=best if best is not None else min(row['summary']['rates'])
    runs=[read(directory/f'rate-{shown}-r{i}.json') for i in range(3)]
    for r in runs:
        assert len(r['slices'])==20
        assert sum(s['n'] for s in r['slices'])==r['scheduled']==shown*20
        assert sum(s['errors'] for s in r['slices'])==r['error_count']
    if best is not None:
        result=fair.steady('snapback-postgres',row,runs)
        result.update(qualified=True,shown_offered_per_s=shown)
        return result
    series=[]
    for t in range(20):
        ss=[r['slices'][t] for r in runs]
        assert all(s['t_s']==t for s in ss)
        series.append(dict(t_s=t,acknowledged=span([s['n']-s['errors'] for s in ss]),
            errors=sum(s['errors'] for s in ss),p50_median_ms=median(s['p50_ms'] for s in ss),
            p99_median_ms=median(s['p99_ms'] for s in ss),
            p50_across_repetitions_ms=span([s['p50_ms'] for s in ss]),
            p99_across_repetitions_ms=span([s['p99_ms'] for s in ss])))
    tail=series[10:]
    return dict(target='snapback-postgres',cell=row['cell'],offered_per_s=None,
        shown_offered_per_s=shown,qualified=False,
        qualification='no passing tested rate; lowest-rate diagnostic, not a ceiling',
        grouping='intended-arrival one-second cohort; acknowledgements may complete after its second',
        repetition_slo_pass=[r['slo_pass'] for r in runs],
        tail_equals_offered_every_second_every_repetition=all(s['n']-s['errors']==shown for r in runs for s in r['slices'][10:]),
        tail_acknowledged_per_s=dict(min=min(s['acknowledged']['min'] for s in tail),max=max(s['acknowledged']['max'] for s in tail)),
        tail_p50_ms=span([s['p50_median_ms'] for s in tail]),tail_p99_ms=span([s['p99_median_ms'] for s in tail]),
        series=series,repetitions=[dict(repetition=i,p50_ms=r['latency']['p50_ms'],p99_ms=r['latency']['p99_ms'],
            errors=r['error_count'],counter_check=r.get('counter_check')) for i,r in enumerate(runs)])


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
    local=[json.loads(s) for s in (root/'local-cpu.jsonl').read_text().splitlines() if s.startswith('{')] if (root/'local-cpu.jsonl').exists() else []
    wal=[json.loads(s) for s in (root/'wal-timing.jsonl').read_text().splitlines() if s.startswith('{')] if (root/'wal-timing.jsonl').exists() else []
    def supplement(capture,n):
        rows=[s for s in local if capture['start']<=s['time']<=capture['end']]
        result=dict(local_cpu_sample_count=len(rows))
        for role in ('proxy','tunnel'):
            pids={pid for s in rows for pid,kind in s['roles'].items() if kind==role}
            ticks=0
            for pid in pids:
                vs=[s['processes'][pid]['ticks'] for s in rows if s['roles'].get(pid)==role and pid in s['processes']]
                if len(vs)>1:ticks+=max(0,vs[-1]-vs[0])
            result[role+'_cpu_ms_per_acknowledged_op']=ticks/rows[0]['clock_ticks']*1000/max(1,n) if rows else None
        ws=[s for s in wal if capture['start']<=s['time']<=capture['end']]
        if len(ws)>1:
            a,b=ws[0]['wal'],ws[-1]['wal'];syncs=b['wal_sync']-a['wal_sync'];ms=b['wal_sync_time']-a['wal_sync_time']
            result['global_wal_timing']=dict(samples=len(ws),span_s=ws[-1]['time']-ws[0]['time'],syncs=syncs,sync_ms=ms,
                mean_sync_ms=ms/syncs if syncs else None,write_ms=b['wal_write_time']-a['wal_write_time'],
                caveat='cluster-wide, includes lease/background work; approximate wall-clock window, not per-mutation COMMIT or database-only timing')
        return result
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
                app=str(max((e for e in events if e['kind']=='serve' and e['time']<=capture['start']),key=lambda e:e['time'])['pid'])
                load=str(max((e for e in events if e['kind']==prefix and e['time']<=capture['start']),key=lambda e:e['time'])['pid'])
                before=read(directory/f'{prefix}.before.json');after=read(directory/f'{prefix}.after.json')
                n=r['total_success_including_warmup'];ss=delta(before,after)
                increments=r.get('counter_check',{}).get('delta')
                renew=sum(s['calls'] for s in ss if s['query'].startswith('UPDATE _owner SET lease_until'))
                def cpu(pids):
                    ticks=0
                    for pid in pids:
                        vs=[s['processes'].get(pid) for s in samples if s['processes'].get(pid)]
                        if len(vs)>1:ticks+=vs[-1]['ticks']-vs[0]['ticks']
                    return ticks/capture['clock_ticks']
                resources.append(dict(serve_cpu_ms_per_op=cpu([app])*1000/max(1,n),
                    load_cpu_ms_per_op=cpu([load])*1000/max(1,n),
                    statements_per_op_including_background=sum(s['calls'] for s in ss)/max(1,n),
                    sql_exec_ms_per_op=sum(s['total_exec_time'] for s in ss)/max(1,n),
                    wal_bytes_per_op_role_filtered=sum(s['wal_bytes'] for s in ss)/max(1,n),
                    xact_commit_delta=after['database']['xact_commit']-before['database']['xact_commit'],
                    xact_rollback_delta=after['database']['xact_rollback']-before['database']['xact_rollback'],
                    actual_counter_increments=increments,
                    whole_cohort_committed_per_s_including_drain=increments/(after['time']-before['time']) if increments is not None else None,
                    nonrenewal_statements_per_actual_counter_increment=(sum(s['calls'] for s in ss)-5*renew)/increments if increments else None,
                    counter_check=r.get('counter_check'),
                    thread_wait_channels=dict(Counter(v for s in samples for v in s.get('server_wchan',{}).values())),
                    **supplement(capture,n)))
            rates.append(dict(rate=rate,pass_all=all(r['slo_pass'] for r in runs),
                p50_ms=[r['latency']['p50_ms'] for r in runs],p99_ms=[r['latency']['p99_ms'] for r in runs],
                p999_ms=[r['latency']['p999_ms'] for r in runs],errors=[r['error_count'] for r in runs],
                completed_in_window_per_s=[r['completed_in_window_per_s'] for r in runs],resources=resources))
        best=next((r for r in rates if r['rate']==summary['highest_passing_offered_per_s']),None)
        row=dict(cell=cell,summary=summary,passing=best);ledger.append(row)
        curves.append(dict(cell=cell,summary=summary,rates=rates))
        steady.append(steady_row(row,directory))
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
        w=s['cell']['workload']
        expected='57–58 tiny/member examples' if w in ('W4','W5') else 'program-dependent; no constant budget' if w=='W3' else '23'
        table.append('| '+label(s['cell'])+' | '+' | '.join(f'{v:.3f}' for v in vals)+' | '+expected+' |')
    (out/'statements-per-op.md').write_text('\n'.join(table)+'\n')
    table=['| Cell | Offered/s | Second-half ack/s (all reps) | Tail p50 median ms range | Tail p99 median ms range | Exact every second/rep |','|---|---:|---:|---:|---:|---|']
    for s in steady:
        a=s['tail_acknowledged_per_s'];x=s['tail_p50_ms'];y=s['tail_p99_ms']
        shown=str(s['shown_offered_per_s'])+(' qualified' if s['qualified'] else ' failed diagnostic')
        table.append(f"| {label(s['cell'])} | {shown} | {a['min']}–{a['max']} | {x['min']:.3f}–{x['max']:.3f} | {y['min']:.3f}–{y['max']:.3f} | {s['tail_equals_offered_every_second_every_repetition']} |")
    (out/'steady.md').write_text('\n'.join(table)+'\n')
    qualification=[]
    for row,shown in zip(ledger,steady):
        directory=root/f"{row['cell']['workload'].lower()}-n1000000-d{row['cell']['delay_us']}-c{row['cell']['writers']}-{row['cell']['keys']}"
        runs=[read(directory/f"rate-{shown['shown_offered_per_s']}-r{i}.json") for i in range(3)]
        qualification.append(dict(cell=row['cell'],highest_passing_offered_per_s=row['summary']['highest_passing_offered_per_s'],
            lowest_tested_offered_per_s=min(row['summary']['rates']),shown_rate=shown['shown_offered_per_s'],
            shown_rate_qualifies=shown['qualified'],p50_ms=[r['latency']['p50_ms'] for r in runs],
            p99_ms=[r['latency']['p99_ms'] for r in runs],errors=[r['error_count'] for r in runs],
            repetition_slo_pass=[r['slo_pass'] for r in runs],counter_checks=[r.get('counter_check') for r in runs]))
    write(out/'qualification.json',dict(status='complete, exploratory',cells=qualification,
        planned_cells=12,completed_cells=len(ledger),cells_with_passing_rate=sum(s['qualified'] for s in steady),
        method=dict(warmup_ms=10000,duration_ms=20000,repetitions=3,read_workers=128,write_workers=32,
                    read_p99_ms=50,write_p99_ms=100,max_error_fraction=.001)))
    table=['| Cell | Shown offered/s | Qualified | p50 ms median | p99 ms range | Errors per repetition | Counter exact per repetition |',
           '|---|---:|---|---:|---:|---|---|']
    for q in qualification:
        checks=['n/a' if x is None else str(x['ok']) for x in q['counter_checks']]
        table.append(f"| {label(q['cell'])} | {q['shown_rate']} | {q['shown_rate_qualifies']} | {median(q['p50_ms']):.3f} | {min(q['p99_ms']):.3f}–{max(q['p99_ms']):.3f} | "+' / '.join(map(str,q['errors']))+' | '+' / '.join(checks)+' |')
    (out/'shown-rate-latency.md').write_text('\n'.join(table)+'\n')
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
            overload_acknowledged_in_window_per_s=span([v for r in failed for v in r['completed_in_window_per_s']]) if failed else None,
            overload_whole_cohort_committed_per_s_including_drain=span([x['whole_cohort_committed_per_s_including_drain'] for r in failed for x in r['resources'] if x['whole_cohort_committed_per_s_including_drain'] is not None]) if failed else None,
            engine_or_committer_queue_ms=None,
            caveat='statement exec plus k*prepared RTT is a serial request model; COMMIT utility timing does not isolate flush; pipeline overlap, variable RTT and queues prevent treating it as a measured writer ceiling'))
    write(out/'write-diagnosis.json',diagnosis)
    # Request-budget RFC §4, source bd0da3c11188ce61d55bb7b8348e196f61ecc863.
    # These are network-only counterfactuals for its stated schedules.
    budgets=[]
    for delay in (0,500):
        rtt=median(r['p50_ms'] for r in rtts if r['cell']['delay_us']==delay)
        for name,today,b1,b2a,b2b in [('W1',23,6,3,[5]),('W2',23,6,2,[2,4]),
                                     ('unkeyed mutation, three program flights',57,16,8,[11])]:
            budgets.append(dict(delay_us=delay,prepared_rtt_p50_ms=rtt,request_class=name,
                current_flights=today,B1_flights=b1,B2a_flights=b2a,B2b_flights=b2b,
                current_network_ms=today*rtt,B1_network_ms=b1*rtt,B2a_network_ms=b2a*rtt,
                B2b_network_ms=[k*rtt for k in b2b],
                B1_network_only_serial_per_s=1000/(b1*rtt),B2a_network_only_serial_per_s=1000/(b2a*rtt),
                B2b_network_only_serial_per_s=[1000/(k*rtt) for k in b2b],
                caveat='predicted network floor, excludes execution/flush/queue; W2 B2b=2 conditional on its autocommit open question, otherwise4; W3 program fanout is not this schedule'))
    write(out/'budget-predictions.json',budgets)
    table=['| Link | RTT ms | Class | Current network ms | B1 network ms | B2(a) network ms | B2(b) network ms |',
           '|---|---:|---|---:|---:|---:|---:|']
    for b in budgets:
        table.append('| '+('natural' if b['delay_us']==0 else '+0.5 ms')+f" | {b['prepared_rtt_p50_ms']:.3f} | {b['request_class']} | {b['current_network_ms']:.3f} | {b['B1_network_ms']:.3f} | {b['B2a_network_ms']:.3f} | "+' / '.join(f'{v:.3f}' for v in b['B2b_network_ms'])+' |')
    (out/'budget-predictions.md').write_text('\n'.join(table)+'\n')
    typed=read(HERE/'results-20261022-fairness/raw-pg/storage-1000000.json')
    native=read(root/'storage.json')
    typed_bytes=sum(t['heap_bytes']+t['indexes_bytes'] for t in typed['tables'])
    native_bytes=sum(t['heap_bytes']+t['indexes_bytes'] for t in native['tables'])
    write(out/'storage-comparison.json',dict(snapback_postgres_bytes=native_bytes,typed_postgres_bytes=typed_bytes,
        ratio=native_bytes/typed_bytes,exceeds_3x=native_bytes>3*typed_bytes,
        method='sum pg_table_size + pg_indexes_size after ordinary VACUUM ANALYZE; all Snapback namespace tables versus five typed app tables',
        caveat='includes metadata, generic indexes and allocated free space; native incremental seed and typed bulk seed have different write histories; not a live-byte or layout-only causal attribution'))
    for name in ('ownership.json','audit.json','whole-write-audit.json','selection.json','seed.json','seed-equality.json','final-equality.json','storage.json','postgres.txt','cleanup.json','database-cleanup.json','check.txt','lscpu.txt','disks.txt','filesystem.txt'):
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
        ss=row['series'];xs=[s['t_s'] for s in ss]
        ax.plot(xs,[s['p99_median_ms'] for s in ss]);ax.fill_between(xs,[s['p99_across_repetitions_ms']['min'] for s in ss],[s['p99_across_repetitions_ms']['max'] for s in ss],alpha=.2)
        ax.axhline(100 if row['cell']['workload'] in ('W4','W5') else 50,color='gray',ls='--')
        suffix='qualified' if row['qualified'] else 'FAILED diagnostic'
        ax.axvspan(10,19,alpha=.1,color='gray');ax.set(title=f"{label(row['cell'])}: {row['shown_offered_per_s']}/s\n{suffix}",xlabel='Intended-arrival second',ylabel='p99 ms');ax.grid(alpha=.2)
    fig.tight_layout();fig.savefig(out/'steady-tail.svg',metadata={'Date':None});plt.close(fig)
    for path in out.glob('*.svg'):path.write_text('\n'.join(x.rstrip() for x in path.read_text().splitlines())+'\n')
    print(json.dumps(dict(cells=len(ledger),trials=read(root/'audit.json')['trials'],rates=[r['summary']['highest_passing_offered_per_s'] for r in ledger])))


if __name__=='__main__':main()
