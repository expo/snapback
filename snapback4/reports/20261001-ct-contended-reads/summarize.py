#!/usr/bin/env python3
"""Regenerate qualification tables from retained stamps (stdlib only)."""
import gzip
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STAGES = ['clientSend', 'sendToAccept', 'acceptToDispatch', 'dispatchToRun',
          'engineLock', 'readerLock', 'otherLocks', 'query', 'encoding', 'write',
          'responseToWake', 'clientDecode', 'server']


def read(path):
    return path.read_text() if path.exists() else gzip.decompress(Path(str(path)+'.gz').read_bytes()).decode()


def pct(values, fraction):
    values = sorted(values)
    return values[math.ceil(len(values)*fraction)-1]


def summarize(names):
    groups = {}
    for name in names:
        path = ROOT/name/'server-trace.jsonl'
        traces = {t['id']: t for t in map(json.loads, read(path).splitlines())} if path.exists() or Path(str(path)+'.gz').exists() else {}
        for s in json.loads(read(ROOT/name/'client-samples.json')):
            if s['index'] < 3:
                continue
            if not traces:
                group = groups.setdefault((s['level'],s['endpoint']), {})
                for key,value in dict(client=s['end']-s['start'], clientSend=s['send']-s['start'], clientDecode=s['end']-s['wakeup']).items():
                    group.setdefault(key, []).append(value/1e6)
                continue
            t = traces[s['id']]
            values = dict(client=s['end']-s['start'], clientSend=s['send']-s['start'],
                sendToAccept=t['accepted']-s['send'], acceptToDispatch=t['dispatched']-t['accepted'],
                dispatchToRun=t['started']-t['dispatched'], engineLock=t['engine_wait'],
                readerLock=t['readers_wait'], otherLocks=max(0,t['mutex_wait']-t['readers_wait']),
                query=t['query_end']-t['query_start'], encoding=t['encode_end']-t['encode_start'],
                write=t['write_end']-t['write_start'], responseToWake=s['wakeup']-t['write_start'],
                clientDecode=s['end']-s['wakeup'], server=t['write_end']-t['accepted'])
            group = groups.setdefault((s['level'],s['endpoint']), {})
            for key, value in values.items():
                group.setdefault(key, []).append(value/1e6)
    return {key: {stage: {'p50':pct(v,.5), 'p95':pct(v,.95)} for stage,v in group.items()}
            for key,group in groups.items()}


def pair(before, after, stem, title):
    b, a = summarize(before), summarize(after)
    rows = [f'# {title}', '', 'Milliseconds. Each side pools two runs of five cohorts unless stated otherwise. Each cohort retains 23 calls, drops three, and uses rank 19/20 for p95. Raw summaries retain every cohort; pooling uses nearest rank. This is an alternating before/after/after/before experiment, not a confidence interval.', '',
            '| Busy / available CPUs | Endpoint | Before p50 / p95 | After p50 / p95 | After/before p50 / p95 |',
            '|---|---|---:|---:|---:|']
    stages = [f'# {title}: stage distributions', '', 'Milliseconds, pooled as in the results table. Spans overlap; do not add percentiles. `readerLock` covers checkout; other readers-mutex acquisitions are in `otherLocks`. Response-to-wakeup includes delivery and writing, not only event-loop delay.', '',
              '| Busy / available CPUs | Endpoint | Stage | Before p50 / p95 | After p50 / p95 |', '|---|---|---|---:|---:|']
    for (level, endpoint), values in b.items():
        left,right=values['client'],a[level,endpoint]['client']
        f=lambda v:f"{v['p50']:.3f} / {v['p95']:.3f}"
        rows.append(f"| {level:g} | {endpoint} | {f(left)} | {f(right)} | {right['p50']/left['p50']:.2f} / {right['p95']/left['p95']:.2f} |")
        for stage in STAGES:
            if stage not in values: continue
            stages.append(f'| {level:g} | {endpoint} | {stage} | {f(values[stage])} | {f(a[level,endpoint][stage])} |')
    if any(level==1 for level,_ in a): rows += ['', 'After full contention relative to its own idle:', '',
             '| Endpoint | Median ratio (target ≤1.25) | p95 ratio (target ≤1.50) |', '|---|---:|---:|']
    for (level,endpoint),values in a.items():
        if level==1:
            idle=a[0,endpoint]['client']; busy=values['client']
            rows.append(f"| {endpoint} | {busy['p50']/idle['p50']:.3f} | {busy['p95']/idle['p95']:.3f} |")
    (ROOT/(stem+'_RESULTS.md')).write_text('\n'.join(rows)+'\n')
    (ROOT/(stem+'_STAGES.md')).write_text('\n'.join(stages)+'\n')


pair(['allcpu-0-before','allcpu-3-before'], ['allcpu-1-after','allcpu-2-after'], 'ALL_CPU',
     'All 96 logical CPUs: 0 / 48 / 96 / 144 busy children')
pair(['idle-0-before','idle-3-before'], ['idle-1-after','idle-2-after'], 'IDLE',
     'Ten-CPU idle controls')
pair(['onecpu-0-before','onecpu-3-before'], ['onecpu-1-after','onecpu-2-after'], 'ONE_CPU',
     'One-CPU idle placement controls')

if (ROOT/'untraced-3-before/summary.json').exists() or (ROOT/'untraced-3-before/summary.json.gz').exists():
    pair(['untraced-0-before','untraced-3-before'], ['untraced-1-after','untraced-2-after'], 'UNTRACED',
         'Tracing disabled, all 96 logical CPUs: 0 / 48 / 96 / 144 busy children')
