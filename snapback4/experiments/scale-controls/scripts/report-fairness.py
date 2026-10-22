#!/usr/bin/env python3
"""Audit completed S1-FR campaigns and derive the four-column matched report.

Use the pinned plot environment from plot-requirements.txt. No benchmark runs.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
from statistics import median
import subprocess as sp
import sys
import tarfile

import report

BASE=Path(__file__).resolve().parent.parent
CX=BASE/'results-20261021-convex-advocate'
TARGETS=['raw-pg','raw-pg-no-token','supabase','convex']
LABELS=['Raw PG (HS256/token)','Raw PG (NO TOKEN)','Supabase advocate','Convex advocate*']
WORK=[('W1','disjoint','W1 visible message'),('W2','disjoint','W2 newest 20'),
      ('W3','disjoint','W3 32-room inbox'),('W4','disjoint','W4 disjoint counters'),
      ('W5','same','W5 shared counter, exact'),('W5','hot1','W5 nominal 1% shared mix')]


def sha(path): return hashlib.file_digest(path.open('rb'),'sha256').hexdigest()
def read(path): return json.loads(path.read_text())
def write(path,v): path.write_text(json.dumps(v,indent=2)+'\n')
def key(c): return tuple(c[k] for k in ('workload','keys','rows','delay_us','writers'))
def directory(c): return f"{c['workload'].lower()}-n{c['rows']}-d{c['delay_us']}-c{c['writers']}-{c['keys']}"
def rate(row): return row['summary']['highest_passing_offered_per_s']
def fmt(n): return 'no pass' if n is None else f'{n:,}'
def span(xs): return dict(min=min(xs),median=median(xs),max=max(xs))


def steady(target,row,runs):
    """Keep every repetition's tail equality, plus per-second quantile medians."""
    offered=rate(row)
    if offered is None: return dict(target=target,cell=row['cell'],offered_per_s=None)
    assert len(runs)==3 and all(r['slo_pass'] for r in runs)
    for r in runs:
        o=r['options']
        assert o['warmup_ms']==10000 and o['duration_ms']==20000 and o['rate']==offered
        assert len(r['slices'])==20
        assert [s['t_s'] for s in r['slices']]==list(range(20))
        assert sum(s['n'] for s in r['slices'])==r['scheduled']==offered*20
        assert sum(s['errors'] for s in r['slices'])==r['error_count']
    series=[]
    for t in range(20):
        ss=[r['slices'][t] for r in runs]
        series.append(dict(t_s=t,acknowledged=span([s['n']-s['errors'] for s in ss]),
            errors=sum(s['errors'] for s in ss),p50_median_ms=median(s['p50_ms'] for s in ss),
            p99_median_ms=median(s['p99_ms'] for s in ss),
            p50_across_repetitions_ms=span([s['p50_ms'] for s in ss]),
            p99_across_repetitions_ms=span([s['p99_ms'] for s in ss])))
    tail=series[10:]
    reps=[dict(repetition=i,tail_acknowledged_per_s=span([s['n']-s['errors'] for s in r['slices'][10:]]),
        tail_equals_offered=all(s['n']-s['errors']==offered for s in r['slices'][10:]),
        p50_ms=r['latency']['p50_ms'],p99_ms=r['latency']['p99_ms'],errors=r['error_count'],
        completed_in_window_per_s=r['completed_in_window_per_s'],
        counter_check=r.get('counter_check')) for i,r in enumerate(runs)]
    return dict(target=target,cell=row['cell'],offered_per_s=offered,
        grouping='intended-arrival one-second cohort; acks may finish after its second',
        tail_equals_offered_every_second_every_repetition=all(r['tail_equals_offered'] for r in reps),
        tail_acknowledged_per_s=dict(min=min(s['acknowledged']['min'] for s in tail),max=max(s['acknowledged']['max'] for s in tail)),
        tail_p50_ms=span([s['p50_median_ms'] for s in tail]),
        tail_p99_ms=span([s['p99_median_ms'] for s in tail]),series=series,repetitions=reps)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('campaign',type=Path)
    p.add_argument('out',type=Path)
    p.add_argument('--convex-archive',type=Path,default=Path.home()/'sb4scale/archive/s1cx-20261021-advocate.tar.gz')
    args=p.parse_args(); args.out.mkdir(parents=True,exist_ok=True)
    cleanup=read(args.campaign/'supervisor-cleanup.json')
    assert not cleanup['still_running'] and len(cleanup['processes'])==3
    assert all(c['status']==0 for c in cleanup['processes'])
    expected={key(dict(workload=w,keys=k,rows=1000000,delay_us=d,writers=128 if w in ['W1','W2','W3'] else 32))
              for w,k,_ in WORK for d in (0,500)}
    ledgers={};curves={};audits={};steady_rows=[];rtts={}
    for target in TARGETS[:3]:
        root=args.campaign/target
        assert (root/'cleanup.json').exists()
        if (root/'all-process-cleanup.json').exists():
            assert not read(root/'all-process-cleanup.json')['still_running']
        # Original independent audit checks all arrivals, HDR buckets and counters.
        sp.run([sys.executable,str(BASE/'scripts/audit.py'),str(root)],check=True)
        report.main([root])
        rows=read(root/'ledger.json'); assert {key(r['cell']) for r in rows}==expected
        ledgers[target]={key(r['cell']):r for r in rows}
        curves[target]=read(root/'curves.json');audits[target]=read(root/'audit.json')
        assert audits[target]['cells']==12
        for row in rows:
            c=row['cell'];d=root/directory(c);passing=rate(row)
            for trial in d.glob('rate-*-r[0-9].json'):
                r=read(trial);o=r['options']
                assert o['warmup_ms']==10000 and o['duration_ms']==20000
                assert o['target']==target
            runs=[] if passing is None else [report.read(d/f'rate-{passing}-r{i}.json') for i in range(3)]
            steady_rows.append(steady(target,row,runs))
        dest=args.out/target;dest.mkdir(exist_ok=True)
        for name in ['ledger.json','ledger.md','curves.json','audit.json','ownership.json','checks.json',
                     'postgres.txt','host-450b.txt','storage-1000000.json','connection-budget.json','raw-schema.sql']:
            if (root/name).exists(): shutil.copyfile(root/name,dest/name)
        for path in root.glob('plan-*.json'): shutil.copyfile(path,dest/path.name)
        conf=list(root.glob('*/effective.conf'))
        if conf:
            assert len({f.read_text() for f in conf})==1
            shutil.copyfile(conf[0],dest/'effective.conf')
        rtts[target]={}
        for delay in (0,500):
            samples=[read(f) for f in root.glob(f'*-d{delay}-*/rtt-*.json')]
            rtts[target][delay]=dict(captures=len(samples),p50_median_ms=median(r['p50_us']/1000 for r in samples),
                p99_median_ms=median(r['p99_us']/1000 for r in samples),p50_ms=span([r['p50_us']/1000 for r in samples]))
    archive_hash=sha(args.convex_archive)
    assert archive_hash=='b67b00373de97e8d7044bf8e7bbc8f786ef6638db9e9829a226a1cdceae30714'
    cxrows=[r for r in read(CX/'ledger.json') if key(r['cell']) in expected]
    assert len(cxrows)==12
    ledgers['convex']={key(r['cell']):r for r in cxrows}
    curves['convex']=[r for r in read(CX/'curves.json') if key(r['cell']) in expected]
    wanted={f"advocate-20261021/{directory(r['cell'])}/rate-{rate(r)}-r{i}.json":(key(r['cell']),i)
            for r in cxrows if rate(r) is not None for i in range(3)}
    cxruns={key(r['cell']):{} for r in cxrows}
    with tarfile.open(args.convex_archive,'r|gz') as archive:
        for member in archive:
            name=member.name.removeprefix('./')
            if name in wanted:
                cell,i=wanted.pop(name)
                cxruns[cell][i]=json.load(archive.extractfile(member))
    assert not wanted, 'missing Convex per-trial evidence'
    for row in cxrows:
        rs=cxruns[key(row['cell'])]
        steady_rows.append(steady('convex',row,[rs[i] for i in range(3)] if rs else []))
    comparison=[]
    table=['| Workload (1M messages) | Link | Raw PG (token) | Raw PG (**no token**) | Supabase advocate | Convex advocate* |',
           '|---|---|---:|---:|---:|---:|']
    for w,k,label in WORK:
        for delay in (0,500):
            c=dict(workload=w,keys=k,rows=1000000,delay_us=delay,writers=128 if w in ['W1','W2','W3'] else 32)
            rates={t:rate(ledgers[t][key(c)]) for t in TARGETS}
            comparison.append(dict(cell=c,label=label,rates=rates))
            table.append('| '+label+' | '+('natural' if delay==0 else '+0.5 ms')+' | '+' | '.join(fmt(rates[t]) for t in TARGETS)+' |')
    write(args.out/'comparison.json',comparison)
    (args.out/'comparison.md').write_text('\n'.join(table)+'\n')
    write(args.out/'steady.json',steady_rows);write(args.out/'curves.json',curves)
    write(args.out/'audit.json',audits);write(args.out/'rtt-summary.json',rtts)
    replay=[]
    for r in comparison:
        c=r['cell']
        for target in TARGETS[:3]:
            name=target+'-'+directory(c)
            replay.append(dict(target=target,cell=c,command=['setsid','nohup','python3','scripts/replay-fairness-cell.py',
                '--target',target,'--out','target/replay-'+name,'--workload',c['workload'],
                '--delay-us',str(c['delay_us']),'--keys',c['keys']],
                note='Redirect stdin from /dev/null and stdout/stderr to a private log; background, record PID and poll until exit.'))
    write(args.out/'replay-cells.json',replay)
    write(args.out/'provenance.json',dict(convex_archive=str(args.convex_archive),convex_archive_sha256=archive_hash,
        inputs={str(f.relative_to(BASE)):sha(f) for f in [CX/'ledger.json',CX/'curves.json',CX/'steady.json',
            BASE/'scripts/report-fairness.py',BASE/'scripts/report.py',BASE/'scripts/audit.py']},
        method=dict(warmup_s=10,measurement_s=20,repetitions=3,read_clients=128,write_clients=32,pool_cap=32),
        new_campaigns={t:read(args.campaign/t/'ownership.json') for t in TARGETS[:3]}))
    text=['| Control / cell | Offered/s | Tail cohort acks/s (all reps) | Tail p50 ms | Tail p99 ms |',
          '|---|---:|---:|---:|---:|']
    for target,label in zip(TARGETS,LABELS):
        for comparison_row in comparison:
            c=comparison_row['cell'];s=next(s for s in steady_rows if s['target']==target and key(s['cell'])==key(c))
            if s['offered_per_s'] is None: continue
            ack=s['tail_acknowledged_per_s'];p50=s['tail_p50_ms'];p99=s['tail_p99_ms']
            text.append(f"| {label} / {c['workload']} {c['keys']} / {c['delay_us']} µs | {s['offered_per_s']:,} | {ack['min']:,}–{ack['max']:,} | {p50['min']:.2f}–{p50['max']:.2f} | {p99['min']:.2f}–{p99['max']:.2f} |")
    (args.out/'steady.md').write_text('\n'.join(text)+'\n')
    plots(args.out,comparison,steady_rows,curves)
    print('Matched report complete:',args.out)


def plots(out,comparison,steady_rows,curves):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import numpy as np
    plt.rcParams.update({'svg.hashsalt':'s1fr-20261022','font.size':9})
    colors=['#155e75','#94a3b8','#15803d','#b45309']
    fig,ax=plt.subplots(figsize=(14,7))
    y=np.arange(len(comparison));height=.19
    for i,(target,label,color) in enumerate(zip(TARGETS,LABELS,colors)):
        values=[r['rates'][target] or 0 for r in comparison]
        bars=ax.barh(y+(i-1.5)*height,values,height,label=label,color=color)
        for bar,r in zip(bars,comparison):
            n=r['rates'][target]
            ax.text((n or .65)*1.04,bar.get_y()+height/2,fmt(n),va='center',fontsize=7)
    ax.set_yticks(y,[r['label']+' / '+('natural' if r['cell']['delay_us']==0 else '+0.5 ms') for r in comparison])
    ax.invert_yaxis();ax.set_xscale('log');ax.set_xlim(.5,60000)
    ax.set_xlabel('Highest tested offered operations/s passing all 3 repetitions (log scale)')
    ax.set_title('S1 matched method: 1M messages · 10 s warm-up + 20 s window · pool cap 32')
    ax.grid(axis='x',alpha=.2);ax.set_axisbelow(True)
    ax.legend(loc='upper left',bbox_to_anchor=(1.01,1),fontsize=8)
    fig.tight_layout();fig.savefig(out/'matched-budget.svg',metadata={'Date':None});plt.close(fig)
    fig,axes=plt.subplots(6,2,figsize=(12,14),sharex=True)
    for axis,r in zip(axes.flat,comparison):
        for target,label,color in zip(TARGETS,LABELS,colors):
            s=next(s for s in steady_rows if s['target']==target and key(s['cell'])==key(r['cell']))
            if s['offered_per_s'] is None: continue
            axis.plot([v['t_s'] for v in s['series']],[v['p99_median_ms'] for v in s['series']],label=label,color=color)
        axis.axvspan(10,19,color='grey',alpha=.08)
        axis.axhline(50 if r['cell']['workload'] in ['W1','W2','W3'] else 100,color='black',ls=':',lw=1)
        axis.set_title(r['label']+' / '+str(r['cell']['delay_us'])+' µs added');axis.set_ylabel('p99 ms')
    axes[-1,0].set_xlabel('Intended-arrival second');axes[-1,1].set_xlabel('Intended-arrival second')
    axes[0,0].legend(fontsize=7)
    fig.suptitle('Per-second p99: median of 3 repetitions at each control’s own passing rate')
    fig.tight_layout();fig.savefig(out/'steady-tail.svg',metadata={'Date':None});plt.close(fig)
    for name,work in [('read-curves',WORK[:3]),('write-curves',WORK[3:])]:
        fig,axes=plt.subplots(3,2,figsize=(12,10))
        for row,(w,k,label) in enumerate(work):
            for col,delay in enumerate((0,500)):
                ax=axes[row,col]
                for target,legend,color in zip(TARGETS,LABELS,colors):
                    curve=next(r for r in curves[target] if r['cell']['workload']==w and r['cell']['keys']==k and r['cell']['delay_us']==delay)
                    rs=curve['rates']
                    ax.plot([r['offered_per_s'] for r in rs],[r['p99_ms'] for r in rs],'.-',label=legend,color=color)
                ax.axhline(50 if name=='read-curves' else 100,color='black',ls=':')
                ax.set_xscale('log');ax.set_yscale('log');ax.set_title(label+f' / {delay} µs added')
                ax.set_xlabel('Offered/s');ax.set_ylabel('Median trial p99 ms')
        axes[0,0].legend(fontsize=7);fig.tight_layout()
        fig.savefig(out/f'{name}.svg',metadata={'Date':None});plt.close(fig)
    (out/'plot-version.txt').write_text('matplotlib '+matplotlib.__version__+'\n')
    # Matplotlib emits trailing spaces inside multiline SVG path attributes.
    for path in out.glob('*.svg'):
        path.write_text('\n'.join(line.rstrip() for line in path.read_text().splitlines())+'\n')


if __name__=='__main__': main()
