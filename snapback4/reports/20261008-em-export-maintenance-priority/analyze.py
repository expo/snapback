#!/usr/bin/env python3
"""Inspect the supplied Mac evidence locally; never access or signal its host."""
import hashlib, json, os, statistics, tarfile
from pathlib import Path

os.umask(0o077)
out=Path(__file__).resolve().parent/'evidence'
archive=out/'em-r8-mac-run6.tar.gz'
suffix='snapshot-1791428318052862000-2de450ff-failure-drain-timeout/'
with tarfile.open(archive) as tar:
    prefix=next(m.name[:-len('snapshot.json')] for m in tar if m.name.endswith(suffix+'snapshot.json'))
    def read(name):return tar.extractfile(prefix+name).read()
    metadata=json.loads(read('snapshot.json'))
    raw=read('files/retention-trace.jsonl');events=[]
    for line in raw.splitlines():
        try:events.append(json.loads(line))
        except ValueError:pass
    work=[e for e in events if e['at']>=1791428228553]
    before=None;pairs=[]
    for e in sorted(work,key=lambda e:e['at']):
        if e['step']=='compress-before':before=e['at']
        elif e['step']=='compress-committed' and before is not None:
            pairs.append(e['at']-before);before=None
    result=dict(archiveSha256=hashlib.sha256(archive.read_bytes()).hexdigest(),snapshot=prefix,
                platform=metadata['platform'],queue={name:json.loads(read('files/'+name)) for name in
                ['maintenance-next.json','maintenance-active.json','maintenance-parked.json','maintenance-result.json']},
                processes=json.loads(read('processes.json')),drain=[json.loads(v) for v in read('test-drain.jsonl').splitlines()],
                workerToFirstCompressionMs=1791428245309-1791428229527,
                commits=sum(e['step']=='compress-committed' for e in work),
                pairedCompressionMs=dict(count=len(pairs),minimum=min(pairs),median=statistics.median(pairs),maximum=max(pairs)),
                timeline=work)
    (out/'snapshot-analysis.json').write_text(json.dumps(result,indent=2)+'\n')
    (out/'mac-retention-trace.jsonl').write_bytes(raw)
    # Keep log bytes intact without copying any arbitrary archive pathname.
    for member in tar:
        if member.isfile() and '/' not in member.name.rstrip('/') and member.name.endswith('.log'):
            (out/Path(member.name).name).write_bytes(tar.extractfile(member).read())
print(json.dumps({k:v for k,v in result.items() if k not in ['timeline','queue','processes','drain']}))
