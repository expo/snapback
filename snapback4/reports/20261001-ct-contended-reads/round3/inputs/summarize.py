#!/usr/bin/env python3
"""Recompute nearest-rank tables from retained samples, including compressed files."""
import json,gzip,math
from pathlib import Path
r=Path(__file__).resolve().parents[1]
def read(p):
    if p.exists():return json.loads(p.read_text())
    return json.loads(gzip.decompress(Path(str(p)+'.gz').read_bytes()))
def dist(v):
    v=sorted(v);return len(v),v[math.ceil(.5*len(v))-1],v[math.ceil(.95*len(v))-1]
lines=['# Round-3 active-maintenance read comparison','','Same corrected round-2 mixed fixture, 125 s per cell. All successful reads; nearest-rank percentiles.','','| Busy | Demoted p50 / p95 ms | Ordinary p50 / p95 ms | Split p50 / p95 ms | Split vs demoted p95 | Split vs ordinary p95 |','|---:|---:|---:|---:|---:|---:|']
for level,busy in [('0',0),('0.5',48),('1',96),('1.5',144)]:
    cells=[read(r/f'mixed-{v}-{level}/summary.json')[0] for v in ['demoted','ordinary','split']]
    cellslat=[x['readLatency'] for x in cells]
    lines.append('| '+str(busy)+' | '+' | '.join(f"{c['p50']:.3f} / {c['p95']:.3f}" for c in cellslat)+f" | {(cellslat[2]['p95']/cellslat[0]['p95']-1)*100:+.1f}% | {(cellslat[2]['p95']/cellslat[1]['p95']-1)*100:+.1f}% |")
lines+=['','## Corrected mixed outcomes','','| Design | Busy | Reads | Lease max ms | Expiry max ms | Schedule delay ms | Job elapsed ms | Effects / retries | Deadline outcomes |','|---|---:|---:|---:|---:|---|---|---|---|']
for v in ['demoted','ordinary','split']:
    for level in ['0','0.5','1','1.5']:
        c=read(r/f'mixed-{v}-{level}/summary.json')[0]
        assert c['observedAbandoned']==c['deliberatelyAbandoned'] and c['unexpectedLeaseChanges']==0
        assert c['extensionMs']==1000 and all(x['maintenanceOnly'] for x in c['leaseRecovery'])
        lines.append(f"| {v} | {c['busy']} | {c['reads']:,} | {max(x['delay'] for x in c['leaseRecovery'])} | {c['expiryMaxMs']} | {', '.join(str(x['delay']) for x in c['jobs'])} | {', '.join(str(x['runtime']) for x in c['jobs'])} | {c['effects']} / {c['retries']} | {', '.join(c['deadlineOutcomes'])} |")
lines+=['','## Split with Following in the same mixed workload','','100 followers, 1,000 actual queued event deliveries. Completion is polled; the tail stays loaded.','','| Busy | Read p50 / p95 ms | Lease max ms | Expiry max ms | Schedule delay ms | Following pending after enqueue | Drain after enqueue ms |','|---:|---:|---:|---:|---|---:|---:|']
for c in read(r/'mixed-following-split/summary.json'):
    f=c['following'];l=c['readLatency']
    assert c['observedAbandoned']==c['deliberatelyAbandoned'] and c['unexpectedLeaseChanges']==0
    assert c['extensionMs']==1000 and all(x['maintenanceOnly'] for x in c['leaseRecovery'])
    assert f['finished']>=f['enqueued'] and f['samples'][-1]['n']==0
    lines.append(f"| {c['busy']} | {l['p50']:.3f} / {l['p95']:.3f} | {max(x['delay'] for x in c['leaseRecovery'])} | {c['expiryMaxMs']} | {', '.join(str(x['delay']) for x in c['jobs'])} | {f['pendingAfterEnqueue']} | {f['drainMs']} |")
lines+=['','| Busy | Reads | Abandoned / recovered | Unexpected lease changes | Job elapsed ms | Effects / retries | Deadline outcomes |','|---:|---:|---:|---:|---|---|---|']
for c in read(r/'mixed-following-split/summary.json'):
    lines.append(f"| {c['busy']} | {c['reads']:,} | {c['deliberatelyAbandoned']} / {c['observedAbandoned']} | {c['unexpectedLeaseChanges']} | {', '.join(str(x['runtime']) for x in c['jobs'])} | {c['effects']} / {c['retries']} | {', '.join(c['deadlineOutcomes'])} |")
(r/'MIXED.md').write_text('\n'.join(lines)+'\n')
lines=['# Real calibration backlog while builder probes run','','Two trials/design/load, reversed order. Every trial restores the identical stopped 50%-scale checkpoint. All responses ending before the final positive backlog observation are retained as during-drain; the first three calls of each 23-call cohort are excluded from ranks. Raw samples and individual trial/cohort results accompany the pooled distributions.','','| Busy | Endpoint | Demoted p50 / p95 ms (n) | Ordinary p50 / p95 ms (n) | Split p50 / p95 ms (n) |','|---:|---|---:|---:|---:|']
final=None;hashes=set();total=0
for busy in [0,96]:
    variants={}
    for v in ['demoted','ordinary','split']:
        per={}
        for rep in [1,2]:
            cell=r/f'drain-{v}-{busy}-{rep}';summary=read(cell/'summary.json');meta=read(cell/'metadata.json');hashes.add(json.dumps(meta['pristineStoreFiles'],sort_keys=True))
            assert summary['initialPending']==6507
            if final is None:final=summary['finalAnswers']
            assert final==summary['finalAnswers'],str(cell)+' settled answers differ'
            samples=read(cell/'samples.json');total+=len(samples)
            for s in samples:
                if s['index']>=3 and s['endedAt']<summary['lastPendingAt']:per.setdefault(s['endpoint'],[]).append(s['ms'])
        variants[v]=per
    for endpoint in variants['demoted']:
        values=[]
        for v in ['demoted','ordinary','split']:
            n,p50,p95=dist(variants[v][endpoint]);values.append(f'{p50:.3f} / {p95:.3f} ({n})')
        lines.append('| '+str(busy)+' | '+endpoint+' | '+' | '.join(values)+' |')
assert len(hashes)==1
lines+=['','## Drain completion per trial','','Times are from server spawn, including startup; the final positive/first-empty polling interval is uncertainty, not service time. Host load is the one-minute load average, includes other tenants, and decays across cells; it is not an instantaneous count of our busy children.','','| Busy | Design | Trial | Initial tasks | Completion s | Ready-to-empty s | Poll interval ms | Host load start / end |','|---:|---|---:|---:|---:|---:|---:|---:|']
for busy in [0,96]:
    for v in ['demoted','ordinary','split']:
        for rep in [1,2]:
            s=read(r/f'drain-{v}-{busy}-{rep}/summary.json')
            m=read(r/f'drain-{v}-{busy}-{rep}/metadata.json')
            lines.append(f"| {busy} | {v} | {rep} | {s['initialPending']} | {s['drainFromSpawnMs']/1000:.3f} | {s['drainFromReadyMs']/1000:.3f} | {s['pollUncertaintyMs']} | {m['hostStart']['load'][0]:.2f} / {m['hostEnd']['load'][0]:.2f} |")
lines+=['',f'All {total:,} successful sampled answers are retained. The eight settled endpoint hashes agree across every design, load and trial. The pristine database and committed WAL sizes/SHA-256 values agree across all trials. During-drain Following answers legitimately evolve; these are not treated as answer-stability failures.']
(r/'DRAIN.md').write_text('\n'.join(lines)+'\n')
print('wrote MIXED.md and DRAIN.md; settled hashes agree')
