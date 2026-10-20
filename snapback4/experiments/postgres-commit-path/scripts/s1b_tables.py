#!/usr/bin/env python3
"""Summarize S1b evidence; derive §8 margins from measured same-C controls."""
import json
from pathlib import Path
from statistics import median
import sys

ROOT=Path(sys.argv[1])


def results(name):
    paths = sorted(ROOT.glob(name+'.r[0-2].json'))
    if not paths:
        paths=[ROOT/(name+'.json')]
    return [json.loads(p.read_text()) for p in paths if p.exists()]


def runs(name):
    records=results(name)
    assert records and all(r['exit_status']==0 for r in records), name
    items=[run for r in records for run in r['result']['runs']]
    assert len(items)==3 and all(run['status']=='complete' for run in items), name
    return items


def stat(name):
    items=runs(name)
    rates=[r['commits_per_s'] for r in items]
    return {'rate':median(rates),'lo':min(rates),'hi':max(rates),'p50':median(r['p50_ms'] for r in items),
            'p99':median(r['p99_ms'] for r in items),'worst_p99':max(r['p99_ms'] for r in items)}


def cpu(name, host):
    path=ROOT/f'{name}.during.{host}.txt'
    if not path.exists(): return None
    header=None
    samples=[]
    for line in path.read_text().splitlines():
        parts=line.split()
        if parts[:2]==['r','b']:
            header=parts
        elif header and len(parts)==len(header) and all(x.lstrip('-').isdigit() for x in parts):
            row=dict(zip(header,map(int,parts)))
            samples.append(row)
    # First vmstat line is since boot; subsequent lines are interval samples.
    samples=samples[1:]
    if not samples: return None
    return {'busy':sum(r['us']+r['sy'] for r in samples)/len(samples),
            'wait':sum(r['wa'] for r in samples)/len(samples), 'samples':len(samples),
            'peak_busy':max(r['us']+r['sy'] for r in samples)}


def waits(name):
    counts={}
    for r in runs(name):
        for event,n in r['wait_events']['session_states'].items():
            counts[event]=counts.get(event,0)+n
    total=sum(counts.values())
    return {k:round(100*v/total,2) for k,v in sorted(counts.items(),key=lambda x:-x[1])}


def rtt(name):
    records=[json.loads((ROOT/f'{name}.rtt-{side}.json').read_text())['result'] for side in ['before','after']]
    return '/'.join(f"{r['p50_us']:.0f}" for r in records), '/'.join(f"{r['p99_us']:.0f}" for r in records)


def row(name):
    s=stat(name)
    a,b=cpu(name,'450a'),cpu(name,'450b')
    p50,p99=rtt(name)
    print(f"| {name} | {s['rate']:,.0f} ({s['lo']:,.0f}–{s['hi']:,.0f}) | {s['p99']:.2f} / {s['worst_p99']:.2f} | {a['busy']:.1f} / {b['busy']:.1f} | {p50} / {p99} |")


if __name__=='__main__':
    print('Rates = median of three; spreads retain all runs. Latencies = median / worst run p99. RTT = before/after p50 / before/after p99, µs.\n')
    print('| Execution cell | executions/s (min–max) | p99 ms | CPU 450a/450b % | RTT µs |')
    print('|---|---:|---:|---:|---:|')
    for c in [8,16,32,64,128]: row(f'exec-c{c}')
    for v in ['k1','k2','k3p','k3']:
        for c in [32,64,128]: row(f'{v}-c{c}')
    print('\n| Raw control | commits/s (min–max) | p99 ms | CPU 450a/450b % | RTT µs |')
    print('|---|---:|---:|---:|---:|')
    for c in [32,64,128]:
        for key in ['disjoint','hot1']: row(f'raw-c{c}-{key}')
    print('\n| Commit stage | stream ops/s (min–max) | p99 ms | CPU 450a/450b % | RTT µs |')
    print('|---|---:|---:|---:|---:|')
    best={}
    for pct in [0,10,30]:
        candidates=[]
        for n in [1,4,16,64]:
            name=f'commit-p{pct}-n{n}'
            row(name)
            s=stat(name)
            if s['worst_p99']<=100:
                candidates.append((s['rate'],n))
        best[pct]=max(candidates) if candidates else (0,None)
    print('\nBest qualified commit stages:',json.dumps(best))
    print('\n| Execution lever | C | execution/s | predicted (a)/s | required/s | margin/s | predicted/required | §8 sizing |')
    print('|---|---:|---:|---:|---:|---:|---:|---|')
    verdicts=[]
    for c in [32,64,128]:
        raw=stat(f'raw-c{c}-disjoint')['rate']
        bar=max(2000,.5*raw)
        for v in ['exec','k1','k2','k3p','k3']:
            execution=stat(f'{v}-c{c}')['rate']
            predicted=min(execution,best[0][0])
            passed=predicted>=bar
            record={'variant':v,'C':c,'execution':execution,'commit':best[0][0],'commit_batch':best[0][1],
                    'raw_disjoint':raw,'required':bar,'predicted':predicted,'margin':predicted-bar,
                    'ratio':predicted/bar,'sizing_pass':passed}
            verdicts.append(record)
            print(f"| {v} | {c} | {execution:,.0f} | {predicted:,.0f} | {bar:,.0f} | {predicted-bar:+,.0f} | {predicted/bar:.3f}× | {'CLEARS' if passed else 'DO NOT BUILD'} |")
    (ROOT/'sizing.json').write_text(json.dumps({'best_commit':best,'verdicts':verdicts},indent=2)+'\n')
    print('\n```text\nCPU and wait-event details:')
    for name in ['exec-c32','exec-c64','exec-c128']+[f'{v}-c{c}' for v in ['k1','k2','k3p','k3'] for c in [32,64,128]]+[f'raw-c{c}-{key}' for c in [32,64,128] for key in ['disjoint','hot1']]:
        print(name,json.dumps({'450a':cpu(name,'450a'),'450b':cpu(name,'450b'),'waits_pct':waits(name)}))

    print("```")
