#!/usr/bin/env python3
"""Audit S1-SK raw evidence, publish aggregates and SVG plots; never runs load."""
import argparse
from collections import Counter
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
from statistics import median
import subprocess as sp
import sys

import report

BASE=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('fairness_report',BASE/'scripts/report-fairness.py')
fair=importlib.util.module_from_spec(spec);spec.loader.exec_module(fair)


def write(p,v):p.write_text(json.dumps(v,indent=2)+'\n')
def read(p):return json.loads(p.read_text())
def label(c):return c['workload']+(' '+c['keys'] if c['workload']=='W5' else '')
def fmt(n):return 'no pass' if n is None else f'{n:,}'


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('campaign',type=Path)
    p.add_argument('out',type=Path)
    args=p.parse_args();root=args.campaign;out=args.out
    assert not read(root/'cleanup.json')['still_running']
    sp.run([sys.executable,str(BASE/'scripts/audit.py'),str(root)],check=True)
    out.mkdir(parents=True,exist_ok=True)
    events=[json.loads(s) for s in (root/'pids.jsonl').read_text().splitlines()]
    app_pids={str(e['pid']) for e in events if e['kind']=='serve'}
    load_pids={str(e['pid']) for e in events if e['kind'].startswith('rate-')}
    curves=[];ledger=[];steady=[]
    order={(w,k):i for i,(w,k,_) in enumerate(fair.WORK)}
    paths=sorted(root.glob('*/summary.json'),key=lambda p:order[(read(p.parent/'cell.json')['workload'],read(p.parent/'cell.json')['keys'])])
    for path in paths:
        directory=path.parent;cell=read(directory/'cell.json');summary=read(path)
        rates=[]
        for rate in summary['rates']:
            runs=[read(directory/f'rate-{rate}-r{i}.json') for i in range(summary['repeats'])]
            assert all(r['options']['target']=='snapback' for r in runs)
            resources=[]
            for i,r in enumerate(runs):
                prefix=f'rate-{rate}-r{i}'
                capture=read(directory/f'{prefix}.resources.json');samples=capture['samples']
                def cpu(pids):
                    ticks=0
                    for pid in pids:
                        vals=[s['processes'].get(pid) for s in samples if s['processes'].get(pid)]
                        if len(vals)>1:ticks+=vals[-1]['ticks']-vals[0]['ticks']
                    return ticks/capture['clock_ticks']
                before=read(directory/f'{prefix}.before.json');after=read(directory/f'{prefix}.after.json')
                n=r['total_success_including_warmup']
                waits=Counter(c for s in samples for c in s.get('server_wchan',{}).values())
                rss=[v['rss_pages']*os.sysconf('SC_PAGE_SIZE')/1048576
                     for s in samples for pid,v in s['processes'].items() if pid in app_pids and v]
                resources.append(dict(serve_cpu_ms_per_op=cpu(app_pids)*1000/max(1,n),
                    load_cpu_ms_per_op=cpu(load_pids)*1000/max(1,n),
                    serve_os_write_bytes_per_op=(after['process_io']['write_bytes']-before['process_io']['write_bytes'])/max(1,n),
                    serve_cpu_s=cpu(app_pids),sample_span_s=samples[-1]['time']-samples[0]['time'],
                    counter_check=r.get('counter_check'),files_bytes_after=after['files_bytes'],
                    thread_wait_channel_samples=dict(waits),serve_rss_mib_range=[min(rss),max(rss)]))
            rates.append(dict(rate=rate,pass_all=all(r['slo_pass'] for r in runs),
                p50_ms=[r['latency']['p50_ms'] for r in runs],p99_ms=[r['latency']['p99_ms'] for r in runs],
                p999_ms=[r['latency']['p999_ms'] for r in runs],errors=[r['error_count'] for r in runs],
                completed_in_window_per_s=[r['completed_in_window_per_s'] for r in runs],resources=resources))
        curves.append(dict(cell=cell,summary=summary,rates=rates))
        passing=summary['highest_passing_offered_per_s']
        best=next((r for r in rates if r['rate']==passing),None)
        row=dict(cell=cell,summary=summary,passing=best);ledger.append(row)
        runs=[] if passing is None else [read(directory/f'rate-{passing}-r{i}.json') for i in range(3)]
        steady.append(fair.steady('snapback-sqlite',row,runs))
    assert len(ledger)==6
    write(out/'ledger.json',ledger);write(out/'curves.json',curves);write(out/'steady.json',steady)
    for name in ['audit.json','ownership.json','cleanup.json','hostname.txt','uname.txt','lscpu.txt','disks.txt','filesystem.txt','check.txt']:
        shutil.copyfile(root/name,out/name)
    controls=read(BASE/'results-20261022-fairness/comparison.json')
    table=['| Workload | Snapback SQLite | Raw PG token | Raw PG no token | Supabase advocate | Convex/PG advocate |',
           '|---|---:|---:|---:|---:|---:|']
    for w,k,title in fair.WORK:
        current=next(r for r in ledger if r['cell']['workload']==w and r['cell']['keys']==k)
        values=[current['summary']['highest_passing_offered_per_s']]
        for target in fair.TARGETS:
            c=next(r for r in controls if r['cell']['workload']==w and r['cell']['keys']==k and r['cell']['delay_us']==0)
            values.append(c['rates'][target])
        table.append('| '+title+' | '+' | '.join(fmt(n) for n in values)+' |')
    (out/'comparison.md').write_text('\n'.join(table)+'\n')
    lines=['| Cell | Offered/s | p50 ms (median) | p99 ms (median; range) | Serve CPU ms/op | OS write B/op |',
           '|---|---:|---:|---:|---:|---:|']
    for row in ledger:
        best=row['passing']
        if best:
            lines.append(f"| {label(row['cell'])} | {fmt(best['rate'])} | {median(best['p50_ms']):.3f} | {median(best['p99_ms']):.3f}; {min(best['p99_ms']):.3f}–{max(best['p99_ms']):.3f} | {median(r['serve_cpu_ms_per_op'] for r in best['resources']):.3f} | {median(r['serve_os_write_bytes_per_op'] for r in best['resources']):.0f} |")
    (out/'ledger.md').write_text('\n'.join(lines)+'\n')
    lines=['| Cell | Offered/s | Tail ack/s (all 30 cohorts) | Tail p50 median range ms | Tail p99 median range ms |',
           '|---|---:|---:|---:|---:|']
    for row in steady:
        if row['offered_per_s'] is None:continue
        a=row['tail_acknowledged_per_s'];x=row['tail_p50_ms'];y=row['tail_p99_ms']
        lines.append(f"| {label(row['cell'])} | {fmt(row['offered_per_s'])} | {a['min']}–{a['max']} | {x['min']:.3f}–{x['max']:.3f} | {y['min']:.3f}–{y['max']:.3f} |")
    (out/'steady.md').write_text('\n'.join(lines)+'\n')
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    fig,axes=plt.subplots(2,3,figsize=(13,7))
    for ax,row in zip(axes.flat,curves):
        rates=row['rates'];xs=[r['rate'] for r in rates]
        ax.plot(xs,[median(r['p50_ms']) for r in rates],'.-',label='p50 median')
        ax.plot(xs,[median(r['p99_ms']) for r in rates],'.-',label='p99 median')
        ax.fill_between(xs,[min(r['p99_ms']) for r in rates],[max(r['p99_ms']) for r in rates],alpha=.2)
        failed=[r for r in rates if not r['pass_all']]
        ax.scatter([r['rate'] for r in failed],[median(r['p99_ms']) for r in failed],
                   color='red',marker='x',zorder=4,label='failed rate (errors or SLO)')
        ax.axhline(100 if row['cell']['workload'] in ('W4','W5') else 50,color='gray',ls='--',label='SLO')
        ax.set(xscale='log',yscale='log',title=label(row['cell']),xlabel='Offered operations/s',ylabel='Intended-arrival latency ms')
        ax.grid(alpha=.2)
    axes.flat[0].legend(fontsize=8);fig.tight_layout();fig.savefig(out/'curves.svg');plt.close(fig)
    fig,axes=plt.subplots(2,3,figsize=(13,7))
    for ax,row in zip(axes.flat,steady):
        if row['offered_per_s'] is None:continue
        ss=row['series'];xs=[s['t_s'] for s in ss]
        ax.plot(xs,[s['p99_median_ms'] for s in ss],label='p99 median')
        ax.fill_between(xs,[s['p99_across_repetitions_ms']['min'] for s in ss],[s['p99_across_repetitions_ms']['max'] for s in ss],alpha=.2)
        ax.axvspan(10,19,color='gray',alpha=.1)
        ax.set(title=f"{label(row['cell'])}: {row['offered_per_s']:,}/s",xlabel='Intended-arrival second',ylabel='Latency ms')
        ax.grid(alpha=.2)
    fig.tight_layout();fig.savefig(out/'steady-tail.svg');plt.close(fig)
    for path in [*out.glob('*.svg'),*out.glob('*.txt')]:
        path.write_text('\n'.join(line.rstrip() for line in path.read_text().splitlines())+'\n')


if __name__=='__main__':main()
