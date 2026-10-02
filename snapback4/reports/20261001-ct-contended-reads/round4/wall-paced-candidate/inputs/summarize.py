#!/usr/bin/env python3
"""Regenerate report tables from retained samples and verify custody/outcomes."""
import gzip,json,math
from pathlib import Path
r=Path(__file__).resolve().parents[1]
def read(p):
    return json.loads(p.read_text() if p.exists() else gzip.decompress(Path(str(p)+'.gz').read_bytes()))
def dist(v):
    v=sorted(v)
    return len(v),v[math.ceil(.5*len(v))-1],v[math.ceil(.95*len(v))-1]
def mixed(name,level):
    c=next(c for c in read(r/name/'summary.json') if str(c['level'])==level)
    raw=read(r/name/f'level-{level}'/'samples.json')
    n,p50,p95=dist([s['ms'] for s in raw['raw'] if s['kind']=='read'])
    assert n==c['reads'] and p50==c['readLatency']['p50'] and p95==c['readLatency']['p95']
    assert c['observedAbandoned']==c['deliberatelyAbandoned']==6 and c['unexpectedLeaseChanges']==0
    assert c['extensionMs']==1000 and all(x['maintenanceOnly'] for x in c['leaseRecovery'])
    assert c['deadlineOutcomes']==['E_EFFECT_DEADLINE']
    return c,raw
lines=['# Round-4 mixed-load cells','','Fresh split and paced binaries, unchanged corrected fixture, 125-second read windows. Nearest-rank percentiles recomputed from every successful read. Ordinary/demoted historical small-fixture controls remain in round3/MIXED.md.','','| Busy | Split p50 / p95 ms | Paced p50 / p95 ms | Paced vs split p95 |','|---:|---:|---:|---:|']
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
    c,raw=mixed('mixed-following-paced',level);following.append(c);f=c['following'];l=c['readLatency']
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
final=read(r.parent/'round3/drain-split-0-1/summary.json')['finalAnswers'];manifests=set();total=0
for busy in [0,96]:
    distributions={}
    for v in variants:
        per={}
        for rep in [1,2]:
            cell=r/f'drain-{v}-{busy}-{rep}';summary=read(cell/'summary.json');meta=read(cell/'metadata.json');manifests.add(json.dumps(meta['pristineStoreFiles'],sort_keys=True))
            assert summary['initialPending']==6507
            assert final==summary['finalAnswers'],str(cell)+' final answer differs from round 3'
            samples=read(cell/'samples.json');total+=len(samples)
            for s in samples:
                if s['index']>=3 and s['endedAt']<summary['lastPendingAt']:per.setdefault(s['endpoint'],[]).append(s['ms'])
        distributions[v]={endpoint:dist(values) for endpoint,values in per.items()}
    for endpoint in distributions['split']:
        values=[]
        for v in variants:
            n,p50,p95=distributions[v][endpoint];values.append(f'{p50:.3f} / {p95:.3f} ({n})')
        delta=(distributions['paced'][endpoint][2]/distributions['split'][endpoint][2]-1)*100
        lines.append('| '+str(busy)+' | '+endpoint+' | '+' | '.join(values)+f' | {delta:+.1f}% |')
assert len(manifests)==1
assert next(iter(manifests))==json.dumps(read(r.parent/'round3/drain-split-0-1/metadata.json')['pristineStoreFiles'],sort_keys=True)
lines+=['','## Drain completion','','Completion includes server startup. Poll uncertainty brackets the final positive/first-empty observation. Host load is the one-minute OS average, including other tenants.','','| Busy | Design | Trial | Tasks | Completion s | Ready-to-empty s | Poll uncertainty ms | Host load start / end |','|---:|---|---:|---:|---:|---:|---:|---:|']
for busy in [0,96]:
    for v in variants:
        for rep in [1,2]:
            cell=r/f'drain-{v}-{busy}-{rep}';s=read(cell/'summary.json');m=read(cell/'metadata.json')
            lines.append(f"| {busy} | {v} | {rep} | {s['initialPending']} | {s['drainFromSpawnMs']/1000:.3f} | {s['drainFromReadyMs']/1000:.3f} | {s['pollUncertaintyMs']} | {m['hostStart']['load'][0]:.2f} / {m['hostEnd']['load'][0]:.2f} |")
lines+=['',f'All {total:,} sampled answers are retained. All eight settled endpoint hashes agree across every design, load and trial and with round 3. Every pristine DB/WAL manifest agrees, including round 3. During-drain answers may evolve. Pooled ranks weight samples, not trials; longer drains contribute more cohorts. Shared-host measurements do not establish causal isolation or Mac timing.']
(r/'DRAIN.md').write_text('\n'.join(lines)+'\n')
print('wrote MIXED.md and DRAIN.md; ranks, settlement and DB/WAL custody checked')
