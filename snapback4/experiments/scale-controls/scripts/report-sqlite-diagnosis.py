#!/usr/bin/env python3
"""Regenerate S1-DX aggregate tables and audits from the archived evidence."""
import argparse
import bisect
import collections
import json
import math
from pathlib import Path
import re
import statistics

RATES = [100, 141, 200, 282, 400, 566, 800, 1131, 1600, 2262, 3200]


def read(path): return json.loads(path.read_text())
def lines(path): return [json.loads(s) for s in path.read_text().splitlines() if s]
def write(path, value): path.write_text(json.dumps(value, indent=2)+'\n')
def span(values):
    values=list(values)
    return [min(values), max(values)]
def fmt(values, places=1):
    a, b = values
    return f'{a:.{places}f}' if a == b else f'{a:.{places}f}–{b:.{places}f}'


def distribution(values):
    values = sorted(values)
    if not values: return dict(count=0)
    def q(p): return values[max(0, math.ceil(p*len(values))-1)]
    return dict(count=len(values), mean=statistics.mean(values), p50=q(.5),
                p99=q(.99), p999=q(.999), maximum=values[-1])


def bracket(raw, out):
    records = []
    for rate in RATES:
        reps = []
        for rep in range(3):
            p = raw/f'rate-{rate}-rep-{rep}'/'result.json'
            d = read(p)
            assert d['options']['rate'] == rate
            assert d['options']['warmup_ms'] == 10000 and d['options']['duration_ms'] == 20000
            assert d['options']['workers'] == 32 and d['options']['rows'] == 1000000
            assert d['scheduled'] == rate*20 == d['success']+d['error_count']
            assert sum(d['errors'].values()) == d['error_count']
            assert d['sent']==d['success']
            assert not (set(d['errors'])-{'expired_before_send'})
            for key in ['latency', 'http_service', 'dispatch_lag']:
                h = d[key]
                assert h['count'] == rate*20 == sum(b[1] for b in h['buckets_ns'])
                assert h['p50_ms'] <= h['p99_ms'] <= h['p999_ms'] <= h['max_ms']
            assert d['total_scheduled_including_warmup'] == rate*30
            assert d['total_errors_including_warmup'] == rate*30-d['total_success_including_warmup']
            assert d['warmup_error_count'] == d['total_errors_including_warmup']-d['error_count'] >= 0
            cc = d['counter_check']
            assert cc['ok'] == (cc['delta'] == d['total_success_including_warmup'])
            failures = []
            if d['latency']['p99_ms'] > 100: failures.append('p99')
            if d['error_count']/d['scheduled'] > .001: failures.append('errors')
            if not cc['ok']: failures.append('counter mismatch / unknown write outcome')
            assert d['slo_pass'] == (not failures)
            reps.append(dict(repetition=rep, success=d['success'], scheduled=d['scheduled'],
                ack_per_s=d['achieved_per_s'], completion_per_s=d['completed_in_window_per_s'],
                unacknowledged=d['scheduled']-d['success'], counter_check=cc,
                latency={k:v for k,v in d['latency'].items() if k!='buckets_ns'},
                errors=d['errors'], error_count=d['error_count'], failures=failures,
                first_measured_second_p99_failure=next((s['t_s'] for s in d['slices'] if s['p99_ms']>100),None),
                first_measured_second_error_failure=next((s['t_s'] for s in d['slices'] if s['errors']/s['n']>.001),None),
                slices=d['slices']))
        records.append(dict(rate=rate, passes=sum(not d['failures'] for d in reps), repetitions=reps))
    write(out/'bracket.json', records)
    table = ['| Offered/s | Passes | Completed/s | p50 ms | p99 ms | p99.9 ms | Errors / unacked (of arrivals/rep) | Counter | Failed criteria |',
             '|---:|---:|---:|---:|---:|---:|---:|---|---|']
    for r in records:
        reps=r['repetitions']
        table.append('| '+ ' | '.join([str(r['rate']),f'{r["passes"]}/3',fmt(span(d['completion_per_s'] for d in reps)),
            *[fmt(span(d['latency'][k] for d in reps)) for k in ['p50_ms','p99_ms','p999_ms']],
            fmt(span(d['error_count'] for d in reps),0)+f' / {r["rate"]*20:,}',
            'exact' if all(d['counter_check']['ok'] for d in reps) else 'FAIL',
            ', '.join(sorted(set(x for d in reps for x in d['failures']))) or 'none'])+' |')
    (out/'bracket.md').write_text('\n'.join(table)+'\n')
    return records


def breakdown(layers, out):
    rows=[]
    for directory in sorted((layers/'traced').glob('rate-*-rep-*')):
        traces=[t for t in lines(directory/'serve-trace.jsonl') if t['dx'][2] and t['mutation_commit']]
        before=next(directory.glob('*.before.json'))
        server_pid=int(re.search(r'^SNAPBACK4_READY .*pid=(\d+)',
                                  (directory/'serve.stderr').read_text(), re.M)[1])
        syncs=collections.defaultdict(list)
        for event in lines(directory/'fsync.jsonl'):
            assert event['rc']==0
            if event['pid']!=server_pid: continue
            syncs[event['tid']].append(event)
        for events in syncs.values(): events.sort(key=lambda e:e['start'])
        columns=collections.defaultdict(list)
        checkpoint_commits=[]
        ordinary_commits=[]
        mutation_flushes=[]
        for t in traces:
            auth,program,mutate,commit,begin,_,commits,resolves=t['dx']
            response=t['write_end']-t['mutation_commit']
            total=t['write_end']-t['started']
            other=total-t['engine_wait']-auth-mutate-response
            assert other >= -100000, (directory,other)
            fields=dict(auth=auth, engine_queue=t['engine_wait'], program=program,
                commit=commit, engine_bookkeeping=mutate-program-commit,
                response=response, preflight_other=max(0,other),
                worker_total=total, dispatch=t['started']-t['accepted'],
                server_total=t['write_end']-t['accepted'],
                thread_cpu=t['cpu_ns_end']-t['cpu_ns_start'])
            for key,value in fields.items(): columns[key].append(value/1e6)
            events=syncs[t['thread_id']]
            at=bisect.bisect_left([e['start'] for e in events],t['started'])
            own=[]
            for e in events[at:]:
                if e['start'] > t['write_end']: break
                assert e['end'] <= t['write_end']
                own.append(e)
            mutation_flushes.extend(own)
            columns['fsync'].append(sum(e['end']-e['start'] for e in own)/1e6)
            columns['fsync_calls'].append(len(own))
            columns['physical_commits'].append(commits)
            columns['auth_resolves'].append(resolves)
            (checkpoint_commits if any(e['file']=='database' for e in own) else ordinary_commits).append(commit/1e6)
        settings=lines(directory/'settings.jsonl')
        assert all(s['synchronous']==2 and s['journal_mode']=='wal' and s['wal_autocheckpoint']==1000 for s in settings)
        result=read(directory/'result.json')
        row=dict(rate=result['options']['rate'],requests=len(traces),
                 diagnostic_slo_pass=result['slo_pass'],diagnostic_errors=result['errors'],
                 diagnostic_latency={k:v for k,v in result['latency'].items() if k!='buckets_ns'},
                 metrics={k:distribution(v) for k,v in columns.items()},
                 fsync_call_counts=dict(collections.Counter(columns['fsync_calls'])),
                 physical_commit_counts=dict(collections.Counter(columns['physical_commits'])),
                 auth_resolution_counts=dict(collections.Counter(columns['auth_resolves'])),
                 ordinary_commit_ms=distribution(ordinary_commits),
                 checkpoint_like_commit_ms=distribution(checkpoint_commits),
                 flush_by_file_ms={kind:distribution([(e['end']-e['start'])/1e6 for e in mutation_flushes if e['file']==kind])
                                   for kind in ['wal','database','other']},
                 settings=settings[0],counter_check=result['counter_check'],
                 bookkeeping_before=read(before).get('bookkeeping'),
                 bookkeeping_after=read(next(directory.glob('*.after.json'))).get('bookkeeping'))
        assert result['counter_check']['ok']
        rows.append(row)
    rows.sort(key=lambda r:r['rate'])
    assert [r['rate'] for r in rows]==[100,141,200]
    write(out/'breakdown.json',rows)
    table=['| Stage, ms/request | '+ ' | '.join(f'{r["rate"]}/s mean / p50 / p99' for r in rows)+' |',
           '|---|'+'---:|'*len(rows)]
    for key,label in [('auth','Session resolution, exclusive of queue'),('engine_queue','Engine mutex queue (all acquisitions)'),
                      ('program','Program and final obligations'),('engine_bookkeeping','Engine prelude / tail / transaction setup'),
                      ('commit','Physical COMMIT (includes flush/checkpoint)'),('response','After commit through response write'),
                      ('preflight_other','Request parsing / preflight / other'),('server_total','Accepted through response'),
                      ('fsync','Flush syscalls (subset of COMMIT)'),('thread_cpu','Request thread CPU')]:
        table.append('| '+label+' | '+' | '.join(' / '.join(f'{r["metrics"][key][q]:.3f}' for q in ['mean','p50','p99']) for r in rows)+' |')
    (out/'breakdown.md').write_text('\n'.join(table)+'\n')
    return rows


def layer_summary(layers,out):
    rows=[]
    for directory in sorted(layers.glob('engine-r*')):
        d=read(directory/'stdout')
        vals=d.pop('latencies_ms')
        d['latency_ms']=distribution(vals)
        before=read(directory/'before.json');after=read(directory/'after.json')
        assert after['counter_sum']-before['counter_sum']==d['total']
        assert after['commits']-before['commits']==d['total']
        assert after['receipts']==before['receipts'] and after['sessions']==before['sessions']
        assert after['maintained']==before['maintained']==1000000
        d['bookkeeping_delta']={k:after[k]-before[k] for k in before}
        rows.append(d)
    for n in [1,16]:
        d=read(layers/f'raw-batch-{n}'/'stdout')
        vals=d.pop('transaction_latencies_ms')
        d['transaction_latency_ms']=distribution(vals)
        events=lines(layers/f'raw-batch-{n}-fsync.jsonl')
        d['all_process_flush_ms_including_setup']=distribution([(e['end']-e['start'])/1e6 for e in events])
        d['wal_flush_ms']=distribution([(e['end']-e['start'])/1e6 for e in events if e['file']=='wal'])
        assert d['synchronous']==2 and d['journal_mode']=='wal'
        rows.append(d)
    write(out/'layers.json',rows)
    return rows


def plot(records, out):
    import matplotlib
    matplotlib.use('Agg')
    matplotlib.rcParams['svg.hashsalt']='s1dx-20261022'
    import matplotlib.pyplot as plt
    fig,axes=plt.subplots(1,2,figsize=(11,4),layout='constrained')
    for rep in range(3):
        x=[r['rate'] for r in records]
        axes[0].plot(x,[r['repetitions'][rep]['completion_per_s'] for r in records],'o-',label=f'repetition {rep+1}')
        axes[1].plot(x,[r['repetitions'][rep]['latency']['p99_ms'] for r in records],'o-')
    axes[0].plot(x,x,'--',color='gray',label='offered rate')
    axes[0].set_ylabel('Completed writes/s (wall-clock window)')
    axes[1].axhline(100,color='red',linestyle='--',label='100 ms SLO')
    axes[1].set_ylabel('Intended-arrival p99 latency (ms)')
    for ax in axes:
        ax.set_xscale('log');ax.set_yscale('log');ax.set_xlabel('Offered writes/s');ax.grid(alpha=.2);ax.legend()
    fig.suptitle('S1-DX: fresh serve process per trial, WAL/FULL, 10 s + 20 s')
    fig.savefig(out/'bracket.svg',metadata={'Date':None})
    plt.close(fig)
    path=out/'bracket.svg'
    path.write_text('\n'.join(line.rstrip() for line in path.read_text().splitlines())+'\n')


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('raw',type=Path,help='extracted s1dx root')
    p.add_argument('out',type=Path)
    p.add_argument('--skip-plot',action='store_true')
    args=p.parse_args();args.out.mkdir(parents=True,exist_ok=True)
    records=bracket(args.raw/'bracket',args.out)
    stages=breakdown(args.raw/'layers',args.out)
    layers=layer_summary(args.raw/'layers',args.out)
    ref=stages[0]['metrics']
    flush=ref['fsync']['mean']
    serial=ref['worker_total']['mean']-ref['engine_queue']['mean']-flush
    optimistic=ref['program']['mean']+ref['engine_bookkeeping']['mean']+ref['auth']['mean']
    write(args.out/'predictions.json',dict(scope='Estimates only; no Snapback batch has been implemented or SLO-qualified',
        model='1000*N/(N*E_ms+F_ms)',F_ms=flush,
        E_request_excluding_engine_queue_and_flush_ms=serial,E_engine_plus_auth_ms=optimistic,
        N16_conservative_ops_per_s=16000/(16*serial+flush),
        N16_engine_plus_auth_ops_per_s=16000/(16*optimistic+flush),
        zero_nonflush_one_member_limit=1000/flush,
        fast_disk_079ms_conservative_ops_per_s=1000/(serial+.079),
        caveat='Full receipt/keyed-member costs, batch fill, per-member hooks, authority rechecks, tail stalls and SLO qualification remain unmeasured'))
    write(args.out/'audit.json',dict(trials=33,rates=11,
        measured_arrivals=sum(r['rate']*20*3 for r in records),
        all_counter_checks_exact=all(d['counter_check']['ok'] for r in records for d in r['repetitions']),
        passing_rates=[r['rate'] for r in records if r['passes']==3],
        first_failing_rate=next(r['rate'] for r in records if r['passes']!=3),
        traced_requests=sum(r['requests'] for r in stages),engine_trials=len([r for r in layers if r['mode']=='engine']),
        checks='arrivals; whole-cohort counters; all HDR bucket counts; qualification; stage/flush joins; on-connection WAL/FULL settings; engine commit/session/receipt/maintained-total deltas'))
    if not args.skip_plot: plot(records,args.out)


if __name__=='__main__': main()
