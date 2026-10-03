from pathlib import Path
import json,gzip,hashlib,fcntl,re
report=Path(__file__).resolve().parent;root=report.parents[2];base=report.parent
archive=Path.home()/'sb4-np/evidence-archive/20261001-nx-export-proves-native/blobs'
rows=[]
for starter in ['plain','social']:
    evidence=root/'target/nx'/starter/'artifacts/native-smoke';completed=[];unstarted=[];refs=[];full=0;compressed=0
    with (evidence/'retention.lock').open('r+b') as gate:
        fcntl.flock(gate,fcntl.LOCK_EX|fcntl.LOCK_NB)
        for run in sorted(p for p in evidence.iterdir() if p.is_dir() and re.fullmatch(r'\d+-\d+',p.name)):
            if not (run/'finished.json').exists():
                assert starter=='plain' and run.name=='1790949268365-54513'
                assert [p.name for p in run.iterdir()]==['run.lock']
                unstarted.append(run.name);continue
            with (run/'run.lock').open('a+b') as held, (run/'export.lock').open('a+b') as exp:
                fcntl.flock(held,fcntl.LOCK_EX|fcntl.LOCK_NB);fcntl.flock(exp,fcntl.LOCK_EX|fcntl.LOCK_NB)
                assert not (run/'publication-pending.json').exists()
                assert not any(p.is_dir() for p in run.iterdir()),str(run)
                compact=(run/'retention.json').exists();compressed+=compact;full+=not compact;completed.append(run.name)
                for file in sorted(run.iterdir()):
                    if file.suffix=='.lock':continue
                    data=file.read_bytes();name=file.name
                    if file.suffix not in ['.mp4','.png','.gz']:data=gzip.compress(data,mtime=0);name+='.gz'
                    digest=hashlib.sha256(data).hexdigest();dest=archive/digest
                    if not dest.exists():dest.write_bytes(data)
                    assert dest.read_bytes()==data
                    logical=f'round5/retained/{starter}/{run.name}/{name}'
                    with (base/'EVIDENCE-ARCHIVE.tsv').open('a') as f:f.write(f'{digest}\t{len(data)}\t{logical}\n')
                    refs.append(dict(sha256=digest,bytes=len(data),path=logical))
    assert full<=5 and compressed<=20
    (report/f'{starter}-retained.json').write_text(json.dumps(refs,indent=2)+'\n')
    rows.append(dict(starter=starter,completedRuns=len(completed),full=full,compressed=compressed,unstartedLegacyPreserved=unstarted,bulkDirectories=0,archiveReferences=len(refs)))
(report/'retention-summary.json').write_text(json.dumps(rows,indent=2)+'\n');print(json.dumps(rows))
