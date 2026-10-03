#!/usr/bin/env python3
"""Regenerate report tables from retained samples and verify custody/outcomes."""
import gzip,json,math
from pathlib import Path
r=Path(__file__).resolve().parents[1]
def read(p):
    return json.loads(p.read_text() if p.exists() else gzip.decompress(Path(str(p)+'.gz').read_bytes()))
custody=read(r/'custody.json')
def dist(v):
    v=sorted(v)
    return len(v),v[math.ceil(.5*len(v))-1],v[math.ceil(.95*len(v))-1]
def mixed(name,level):
    metadata=read(r/name/'metadata.json')
    variant='split' if name.startswith('mixed-split-') else 'paced'
    assert metadata['binarySha256']==custody['binaries'][variant]
    assert metadata['cores']==96
    c=next(c for c in read(r/name/'summary.json') if str(c['level'])==level)
    raw=read(r/name/f'level-{level}'/'samples.json')
    n,p50,p95=dist([s['ms'] for s in raw['raw'] if s['kind']=='read'])
    assert n==c['reads'] and p50==c['readLatency']['p50'] and p95==c['readLatency']['p95']
    assert c['observedAbandoned']==c['deliberatelyAbandoned']==6 and c['unexpectedLeaseChanges']==0
    assert c['extensionMs']==1000 and all(x['maintenanceOnly'] for x in c['leaseRecovery'])
    assert c['deadlineOutcomes']==['E_EFFECT_DEADLINE']
    return c,raw
lines=['# Round-4 mixed-load cells','','Fresh split and paced runs, unchanged corrected fixture, 125-second read windows. Nearest-rank percentiles recomputed from every successful read. Ordinary/demoted historical small-fixture controls remain in round3/MIXED.md.','','| Busy | Split p50 / p95 ms | Paced p50 / p95 ms | Paced vs split p95 |','|---:|---:|---:|---:|']
levels=['0','0.5','1','1.5'];small={};total=0
for level,busy in zip(levels,[0,48,96,144]):
    cs=[]
    for v in ['split','paced']:
        c,_=mixed(f'mixed-{v}-{level}',level);small[v,level]=c;cs.append(c['readLatency']);total+=c['reads']
    lines.append(f"| {busy} | {cs[0]['p50']:.3f} / {cs[0]['p95']:.3f} | {cs[1]['p50']:.3f} / {cs[1]['p95']:.3f} | {(cs[1]['p95']/cs[0]['p95']-1)*100:+.1f}% |")
lines+=['','| Design | Busy | Reads | Lease max ms | Expiry max ms | Schedule delay ms | Job elapsed ms | Effects / retries | Deadline outcomes |','|---|---:|---:|---:|---:|---|---|---|---|']
for v in ['split','paced']:
    for level in levels:
        c=small[v,level]
        lines.append(f"| {v} | {c['busy']} | {c['reads']:,} | {max(x['delay'] for x in c['leaseRecovery'])} | {c['expiryMaxMs']} | {', '.join(str(x['delay']) for x in c['jobs'])} | {', '.join(str(x['runtime']) for x in c['jobs'])} | {c['effects']} / {c['retries']} | {', '.join(c['deadlineOutcomes'])} |")
lines+=['','## Paced with 1,000 Following tasks','','100 followers, 1,000 actual delivery tasks, under the same mixed workload. Busy processes and observation continue through the drain tail; reads stop after 125 seconds. During-drain reads end before the final positive delivery observation.','','| Busy | Read p50 / p95 ms, full window | Read p50 / p95 ms, during drain (n) | Lease max ms | Expiry max ms | Schedule delay ms | Initial pending | Drain s |','|---:|---:|---:|---:|---:|---|---:|---:|']
following=[]
for level in levels:
    c,raw=mixed(f'mixed-following-paced-{level}',level);following.append(c);f=c['following'];l=c['readLatency']
    assert f['finished']>=f['enqueued'] and f['samples'][-1]['n']==0
    last=max(s['at'] for s in f['samples'] if s['n']>0)
    n,p50,p95=dist([s['ms'] for s in raw['raw'] if s['kind']=='read' and f['enqueued']<=s['at']<last])
    lines.append(f"| {c['busy']} | {l['p50']:.3f} / {l['p95']:.3f} | {p50:.3f} / {p95:.3f} ({n}) | {max(x['delay'] for x in c['leaseRecovery'])} | {c['expiryMaxMs']} | {', '.join(str(x['delay']) for x in c['jobs'])} | {f['pendingAfterEnqueue']} | {f['drainMs']/1000:.3f} |")
lines+=['','| Busy | Reads | Abandoned / recovered | Unexpected lease changes | Job elapsed ms | Effects / retries | Deadline outcomes |','|---:|---:|---:|---:|---|---|---|']
for c in following:
    lines.append(f"| {c['busy']} | {c['reads']:,} | {c['deliberatelyAbandoned']} / {c['observedAbandoned']} | {c['unexpectedLeaseChanges']} | {', '.join(str(x['runtime']) for x in c['jobs'])} | {c['effects']} / {c['retries']} | {', '.join(c['deadlineOutcomes'])} |")
lines+=['',f"Small-fixture reads: {total:,}. Following-fixture reads: {sum(c['reads'] for c in following):,}. Every cell satisfies all original lease, expiry, schedule, retry, deadline and drain assertions."]
(r/'MIXED.md').write_text('\n'.join(lines)+'\n')
variants=['demoted','ordinary','split','paced']
lines=['# Real calibration backlog while builder probes run','','Two fresh reversed-order trials per design/load. Identical stopped 6,507-task checkpoint including WAL. 23 calls/cohort, first three excluded from ranks. Responses must end before the last positive backlog observation.','','| Busy | Endpoint | Demoted p50 / p95 ms (n) | Ordinary p50 / p95 ms (n) | Split p50 / p95 ms (n) | Paced p50 / p95 ms (n) | Paced vs split p95 |','|---:|---|---:|---:|---:|---:|---:|']
final=read(r.parent/'round3/drain-split-0-1/summary.json')['finalAnswers'];manifests=set();total=0;pooled={}
for busy in [0,96]:
    distributions={}
    for v in variants:
        per={}
        for rep in [1,2]:
            cell=r/f'drain-{v}-{busy}-{rep}';summary=read(cell/'summary.json');meta=read(cell/'metadata.json');manifests.add(json.dumps(meta['pristineStoreFiles'],sort_keys=True))
            assert meta['binarySha256']==custody['binaries'][v]
            assert meta['client']=='0.4.10' and meta['actions']==88143 and meta['busy']==busy
            assert summary['initialPending']==6507 and len(summary['finalAnswers'])==8
            assert final==summary['finalAnswers'],str(cell)+' final answer differs from round 3'
            samples=read(cell/'samples.json');total+=len(samples)
            assert len(samples)==summary['allSampleCount']
            trial={}
            for s in samples:
                if s['index']>=3 and s['endedAt']<summary['lastPendingAt']:
                    per.setdefault(s['endpoint'],[]).append(s['ms'])
                    trial.setdefault(s['endpoint'],[]).append(s['ms'])
            for result in summary['reads']:
                assert dist(trial[result['endpoint']])==(result['n'],result['p50'],result['p95'])
        distributions[v]={endpoint:dist(values) for endpoint,values in per.items()}
    pooled[busy]=distributions
    for endpoint in distributions['split']:
        values=[]
        for v in variants:
            n,p50,p95=distributions[v][endpoint];values.append(f'{p50:.3f} / {p95:.3f} ({n})')
        delta=(distributions['paced'][endpoint][2]/distributions['split'][endpoint][2]-1)*100
        lines.append('| '+str(busy)+' | '+endpoint+' | '+' | '.join(values)+f' | {delta:+.1f}% |')
assert len(manifests)==1
assert next(iter(manifests))==json.dumps(read(r.parent/'round3/drain-split-0-1/metadata.json')['pristineStoreFiles'],sort_keys=True)
lines+=['','## Drain completion','','Completion includes server startup. Poll uncertainty brackets the final positive/first-empty observation. Host load is the one-minute OS average, including other tenants. Per-trial Following-500 p95 uses the same during-drain selection as the pooled table.','','| Busy | Design | Trial | Tasks | Following-500 p95 ms | Completion s | Ready-to-empty s | Poll uncertainty ms | Host load start / end |','|---:|---|---:|---:|---:|---:|---:|---:|---:|']
for busy in [0,96]:
    for v in variants:
        for rep in [1,2]:
            cell=r/f'drain-{v}-{busy}-{rep}';s=read(cell/'summary.json');m=read(cell/'metadata.json')
            following95=next(x['p95'] for x in s['reads'] if x['endpoint']=='following500')
            lines.append(f"| {busy} | {v} | {rep} | {s['initialPending']} | {following95:.3f} | {s['drainFromSpawnMs']/1000:.3f} | {s['drainFromReadyMs']/1000:.3f} | {s['pollUncertaintyMs']} | {m['hostStart']['load'][0]:.2f} / {m['hostEnd']['load'][0]:.2f} |")
lines+=['',f'All {total:,} sampled answers are retained. All eight settled endpoint hashes agree across every design, load and trial and with round 3. Every pristine DB/WAL manifest agrees, including round 3. During-drain answers may evolve. Pooled ranks weight samples, not trials; longer drains contribute more cohorts. Shared-host measurements do not establish causal isolation or Mac timing.']
(r/'DRAIN.md').write_text('\n'.join(lines)+'\n')
lines=['All 28 final measurement runs exited 0. The unchanged round-3 methods retain',
       'the 96-CPU host, 125-second mixed read windows, published 0.4.10 client,',
       '23-call cohorts with the first three excluded, and independent SQLite queue',
       'observation. No lane build or test overlapped timing. Other tenants remained',
       'active; zero owned busy processes does not mean a quiet host. Exact binaries',
       'and source hashes are in `round4/custody.json`.','',
       'The full mixed outcomes in `round4/MIXED.md` reproduce lease recovery, expiry,',
       'schedule admission/execution, retries and deadlines. Eight small split/paced',
       'cells retain 1,460,558 reads; four paced Following cells retain 657,361.',
       'All 72 abandoned claims were observed, no lease changed unexpectedly, and',
       'every explicit clock extension was exactly 1,000 ms. No consistent small-',
       'fixture latency win is established: at 144 busy, paced p95 was 3.633 ms',
       'versus split 0.917 ms. Small-fixture controls remain in round 3.','',
       '| Busy | Small split / paced read p95 ms | Paced with 1,000 Following tasks: read p95 during drain ms | Following drain s |',
       '|---:|---:|---:|---:|']
for level,c in zip(levels,following):
    _,raw=mixed(f'mixed-following-paced-{level}',level);f=c['following']
    last=max(s['at'] for s in f['samples'] if s['n']>0)
    _,_,p95=dist([s['ms'] for s in raw['raw'] if s['kind']=='read' and f['enqueued']<=s['at']<last])
    lines.append(f"| {c['busy']} | {small['split',level]['readLatency']['p95']:.3f} / {small['paced',level]['readLatency']['p95']:.3f} | {p95:.3f} | {f['drainMs']/1000:.3f} |")
lines+=['','Synthetic busy processes remained alive throughout the combined drain tail;',
        'reads ended after 125 seconds. All expected schedule boundaries completed,',
        'including twenty in the 144-process cell. This table is not a claim about',
        'read latency after its read window.','',
        'The real 6,507-task checkpoint has sixteen fresh restorations: two trials of',
        'each design at 0/96 busy, reversing design order. All DB/WAL manifests and',
        'all eight settled answer hashes agree with round 3. The 952,200 raw probe',
        'samples and full ranks, counts and poll brackets in `round4/DRAIN.md` remain.',
        'Pooled **during-drain read p95**, in milliseconds:','',
        '| Busy | Endpoint | Demoted | Ordinary | Split | Paced | Paced vs split |',
        '|---:|---|---:|---:|---:|---:|---:|']
for busy in [0,96]:
    d=pooled[busy]
    for endpoint in d['split']:
        vals=[d[v][endpoint][2] for v in variants]
        lines.append('| '+str(busy)+' | '+endpoint+' | '+' | '.join(f'{v:.3f}' for v in vals)+f' | {(vals[3]/vals[2]-1)*100:+.1f}% |')
lines+=['','Drain completion includes startup; two trials are shown separately:','',
        '| Busy | Design | Trial 1 s | Trial 2 s |','|---:|---|---:|---:|']
for busy in [0,96]:
    for v in variants:
        times=[read(r/f'drain-{v}-{busy}-{rep}/summary.json')['drainFromSpawnMs']/1000 for rep in [1,2]]
        lines.append(f'| {busy} | {v} | {times[0]:.3f} | {times[1]:.3f} |')
lines+=['','At 96 busy, paced beats ordinary-all p95 on all eight endpoints and split on',
        'three, with five split regressions of 0.8–3.8%. Following-500 improves 7.7%',
        'against split, but drain costs 3.7–5.9 times as long. This is a substantial',
        'throughput tradeoff, not a universal read improvement. At zero owned busy,',
        'paced pooled p95 is lower on all eight endpoints, but its first trial takes',
        '712.475 seconds and its second 32.443. Their host load averages start/end at',
        '144.45/156.61 and 94.35/56.65 respectively. The load-triggered pacing policy',
        'and shared-host variation preclude a quiet-host or causal-isolation claim.',
        'Longer drains also contribute more cohorts and observe intermediate feed',
        'states longer, so pooled ranks weight samples, not trials.','',
        'Two disclosed supplemental read-only SQLite snapshots checked long-running',
        'cells (144-process mixed: 307 pending, 5.976 ms; first paced zero-busy real',
        'drain: 425 pending, 76.403 ms). They are retained separately and never used',
        'as latency samples or drain endpoints; their possible interference with',
        'nearby probes is not erased. Darwin timing remains the operator’s work.']
(r/'MEASUREMENTS.md').write_text('\n'.join(lines)+'\n')
print('wrote MIXED.md, DRAIN.md and MEASUREMENTS.md; ranks, settlement and DB/WAL custody checked')
