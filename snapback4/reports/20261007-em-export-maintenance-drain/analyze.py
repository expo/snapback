#!/usr/bin/env python3
"""Recompute measurements from retained cohort directories or their tar.gz archives."""
import collections, json, math, pathlib, re, statistics, tarfile
root=pathlib.Path(__file__).resolve().parent/'evidence'
def files(name):
    directory=root/name
    if directory.is_dir():
        for p in directory.rglob('*'):
            if p.is_file(): yield p.relative_to(directory).as_posix(),p.read_bytes()
    else:
        with tarfile.open(root/(name+'.tar.gz')) as archive:
            for item in archive:
                if item.isfile():yield item.name,archive.extractfile(item).read()
def stats(values):
    values=sorted(values)
    return dict(n=len(values),medianMs=round(statistics.median(values),3),p95Ms=round(values[math.ceil(.95*len(values))-1],3),maxMs=round(values[-1],3))
summary={}
names=sorted({p.name for p in root.iterdir() if p.is_dir() and (p/'results.jsonl').exists()}|{p.name[:-7] for p in root.glob('*.tar.gz')})
for name in names:
    data=dict(files(name))
    if 'results.jsonl' not in data:continue
    rows=[json.loads(line) for line in data['results.jsonl'].splitlines()]
    passed={f"run-{r['run']:03d}" for r in rows if r['code']==0}
    recorded={f"run-{r['run']:03d}" for r in rows}
    timing=collections.defaultdict(list);errors=collections.Counter(); cases=collections.defaultdict(list);corrupt=0
    for file,content in data.items():
        run=file.split('/')[0]
        if file.endswith('/files/retention-trace.jsonl') and '-cleanup/' in file and run in passed:
            for line in content.splitlines():
                try:r=json.loads(line)
                except ValueError:corrupt+=1;continue
                d=r.get('detail') or {}; step=r.get('step')
                if isinstance(d,dict) and 'elapsedMs' in d:
                    if step=='work-ended':step+=':error' if d.get('error') else ':ok'
                    if step=='test-drain-end':step+=':cleanup' if d.get('allowParked') else ':assertion'
                    if step=='test-drain-start':continue
                    timing[step].append(d['elapsedMs'])
                    if d.get('error'):errors[d['error']]+=1
        if file.endswith('.log') and file[:-4] in passed:
            for match in re.finditer(r'^ok \d+ - ([^\n]+)\n\s+---\n\s+duration_ms: ([\d.]+)',content.decode(),re.M):
                case,ms=match.groups()
                if '# SKIP' not in case:cases[case].append(float(ms))
    summary[name]=dict(host=json.loads(data.get('host.json',b'{}')),recordedInvocations=len(rows),passedInvocations=len(passed),exitCodes=dict(collections.Counter(r['code'] for r in rows)),uncompletedLogs=sorted(f for f in data if re.fullmatch(r'run-\d+\.log',f) and f[:-4] not in recorded),elapsedSeconds=[r['elapsed'] for r in rows],casePasses=sum(map(len,cases.values())),cases={k:stats(v) for k,v in cases.items()},traceTimings={k:stats(v) for k,v in timing.items()},expectedWorkErrors=dict(errors),malformedTraceLines=corrupt)
(root/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
for name,r in summary.items():print(name,r['passedInvocations'],'/',r['recordedInvocations'],'invocations;',r['casePasses'],'case passes;',r['traceTimings'].get('test-drain-end:assertion',{}))
