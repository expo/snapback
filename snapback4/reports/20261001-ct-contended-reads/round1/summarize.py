#!/usr/bin/env python3
"""Rebuild the round-1 comparison from every retained client sample."""
import gzip,json,math,pathlib,statistics,re
root=pathlib.Path(__file__).resolve().parent

def read(p):
    if not p.exists(): p=pathlib.Path(str(p)+'.gz')
    return json.loads(gzip.decompress(p.read_bytes()) if p.suffix=='.gz' else p.read_bytes())
def dist(v):
    v=sorted(v)
    return [v[math.ceil(len(v)*p)-1] for p in [.5,.95]]
def ms(v): return '/'.join(f'{n:.3f}' for n in dist(v))
def runs(prefix,design): return [root/f'{prefix}-{i}-{design}' for i in ([0,3] if design=='pool' else [1,2])]
allanswers={}
lines=['# Round 1: pool versus connection-parser inline','', 'p50 / p95 in milliseconds; 200 retained samples per endpoint/cell/design. Three warmup samples per 23-call cohort remain in the raw files. Ratios use pooled ranks, not averaged percentiles.','']
for prefix,label in [('traced','96 CPU, traced'),('untraced','96 CPU, untraced'),('cpu','10 CPU, CPU-instrumented'),('cpu-untraced','10 CPU, untraced')]:
    data={d:[s for p in runs(prefix,d) for s in read(p/'client-samples.json')] for d in ['pool','inline']}
    for d,samples in data.items():
        for s in samples:
            key=(prefix+':insights') if s['endpoint']=='insights' else s['endpoint']
            if key in allanswers: assert allanswers[key]==s['answer']
            allanswers[key]=s['answer']
    lines += [f'## {label}','', '| Load | Endpoint | Pool p50/p95 | Inline p50/p95 | Inline median delta | Inline p95 delta |','|---|---|---:|---:|---:|---:|']
    for level in [0,.5,1,1.5]:
        for ep in dict.fromkeys(s['endpoint'] for s in data['pool']):
            values={d:[(s['end']-s['start'])/1e6 for s in data[d] if s['level']==level and s['endpoint']==ep and s['index']>=3] for d in data}
            assert all(len(v)==200 for v in values.values()),(prefix,level,ep)
            a,b=dist(values['pool']),dist(values['inline'])
            lines += [f'| {level:g} | {ep} | {ms(values["pool"])} | {ms(values["inline"])} | {(b[0]/a[0]-1)*100:+.1f}% | {(b[1]/a[1]-1)*100:+.1f}% |']
    lines.append('')
(root/'READS.md').write_text('\n'.join(lines).rstrip()+'\n')
lines=['# CPU identity, running time and migrations','', 'Same ten-CPU ABBA matrices as READS.md. CPU time is CLOCK_THREAD_CPUTIME_ID across the handler; query wall time is narrower. CPU changes within a query are a lower bound on migrations. Kernel migration counters cover whole load cells for serving threads, including warmups. Hardware cycles were denied by the host (cycles-availability.json).','']
for design in ['pool','inline']:
    rows=[]; migrations={}
    for p in runs('cpu',design):
        traces={t['id']:t for t in [json.loads(line) for line in (gzip.decompress((p/'server-trace.jsonl.gz').read_bytes()).decode() if (p/'server-trace.jsonl.gz').exists() else (p/'server-trace.jsonl').read_text()).splitlines()]}
        samples=read(p/'client-samples.json')
        rows.extend([{**s,'t':traces[s['id']]} for s in samples if s['index']>=3])
        meta=read(p/'metadata.json')
        for level in [0,.5,1,1.5]:
            tids={traces[s['id']]['thread_id'] for s in samples if s['level']==level}
            snapshots={x['phase']:{t['tid']:int(re.search(r'se.nr_migrations\s*:\s*(\d+)',t['sched'])[1]) for t in x['threads'] if t['tid'] in tids} for x in meta['loadSamples'] if x['level']==level}
            migrations[level]=migrations.get(level,0)+sum(n-snapshots['start'].get(t,0) for t,n in snapshots['end'].items())
    lines += [f'## {design}','',f'Kernel migrations by load: `{migrations}`.','', '| Load | Endpoint | Query wall p50/p95 ms | Handler CPU p50/p95 ms | Query changed CPU | Handler changed CPU | CPUs visited |', '|---|---|---:|---:|---:|---:|---|']
    for level in [0,.5,1,1.5]:
        for ep in dict.fromkeys(s['endpoint'] for s in rows):
            ts=[s['t'] for s in rows if s['level']==level and s['endpoint']==ep]
            cpus=sorted({t[k] for t in ts for k in ['cpu_start','cpu_end','query_cpu_start','query_cpu_end']})
            lines += [f'| {level:g} | {ep} | {ms([(t["query_end"]-t["query_start"])/1e6 for t in ts])} | {ms([(t["cpu_ns_end"]-t["cpu_ns_start"])/1e6 for t in ts])} | {sum(t["query_cpu_start"]!=t["query_cpu_end"] for t in ts)}/200 | {sum(t["cpu_start"]!=t["cpu_end"] for t in ts)}/200 | {cpus} |']
    lines.append('')
(root/'CPU.md').write_text('\n'.join(lines).rstrip()+'\n')
print(json.dumps({'answers':allanswers,'sampleCount':16*4*8*5*23},indent=2))
