"""Reduce the retained round-trip and ambient-load evidence, keeping failed attempts."""
import json, statistics
from measure import REPORT, ARCHIVE
from round1 import write
out=REPORT/'round2'
rows=sorted([json.loads(p.read_text()) for p in out.glob('r2-*.json') if not p.name.endswith('-cleanup.json')],key=lambda r:r['startedAt'])
summaries=[]
for r in rows:
    observation=next(e for e in r['evidence'] if e['path'].endswith('-host.jsonl'))
    hosts=[json.loads(s) for s in (ARCHIVE/observation['sha256']).read_text().splitlines()]
    loads=[s['load'][0] for s in hosts]
    perf=[]; compilers=[]
    for sample in hosts:
        ps=[line.split(None,3) for line in sample['processes'].splitlines()[1:]]
        perf.append(sum(float(p[2]) for p in ps if len(p)==4 and 'PerfPowerServices' in p[3]))
        compilers.extend(p for p in ps if len(p)==4 and p[3].rsplit('/',1)[-1] in ['cargo','rustc'])
    summary={k:r[k] for k in ['label','starter','phase','criticalSeconds','completionSeconds','afterReturnSeconds','drainedSeconds','status','waitStatus','error','segments','exportHash','loadedHash']}
    summary.update(cacheHit=r['cache']['hit'],hostSamples=len(hosts),load1=dict(min=min(loads),median=statistics.median(loads),max=max(loads)),
        perfPowerCpu=dict(min=min(perf),median=statistics.median(perf),max=max(perf)),cargoOrRustcObservations=compilers)
    summaries.append(summary)
write(out/'summary.json',summaries)
print(json.dumps([{k:r[k] for k in ['label','criticalSeconds','completionSeconds','cacheHit','waitStatus','load1']} for r in summaries],indent=2))
