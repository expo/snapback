from pathlib import Path
import json,gzip,hashlib,shutil,fcntl
report=Path(__file__).resolve().parent
root=report.parents[2]
out=report/'retained-evidence';out.mkdir(exist_ok=True)
known={}
for index in (report/'evidence').glob('*/inventory.json'):
    for row in json.loads(index.read_text()):
        archive=index.parent/(row['name']+'.gz')
        if archive.exists():known[row['sha256']]=(archive,True)
summary=[]
for starter in ['plain','social']:
    evidence=root/'target/nx'/starter/'artifacts/native-smoke'
    runs=[];full=0;compressed=0;receipts=0
    with (evidence/'retention.lock').open('r+b') as gate:
        fcntl.flock(gate,fcntl.LOCK_EX|fcntl.LOCK_NB)
        for d in sorted(p for p in evidence.iterdir() if p.is_dir()):
            assert (d/'finished.json').exists(),d
            assert not any((d/n).exists() for n in ['base.app','export.app','build.xcresult','preparation-tmp']),d
            with (d/'run.lock').open('r+b') as lease:
                fcntl.flock(lease,fcntl.LOCK_EX|fcntl.LOCK_NB)
                files=[]
                compact=(d/'retention.json').exists();compressed+=compact;full+=not compact
                for file in sorted(d.iterdir()):
                    assert file.is_file(),file
                    raw=file.read_bytes();was_gzip=file.suffix=='.gz';raw=gzip.decompress(raw) if was_gzip else raw
                    digest=hashlib.sha256(raw).hexdigest()
                    if file.name.removesuffix('.gz').endswith(('.json','.jsonl')):receipts+=1
                    if digest in known:archive,zipped=known[digest]
                    else:
                        dest=out/starter/d.name;dest.mkdir(parents=True,exist_ok=True)
                        zipped=file.suffix not in ['.png','.mp4'];name=file.name if was_gzip or not zipped else file.name+'.gz'
                        archive=dest/name;archive.write_bytes(gzip.compress(raw,mtime=0) if zipped else raw)
                        known[digest]=(archive,zipped)
                    check=archive.read_bytes();check=gzip.decompress(check) if zipped else check
                    assert hashlib.sha256(check).hexdigest()==digest
                    files.append({'source':file.name,'bytes':len(raw),'sha256':digest,'archive':str(archive.relative_to(report)),'gzip':zipped})
                runs.append({'run':d.name,'compressed':compact,'finished':json.loads((d/'finished.json').read_text()),'files':files})
    assert full<=5 and compressed<=20 and len(runs)<=25
    (out/(starter+'-runs.json')).write_text(json.dumps(runs,indent=2)+'\n')
    summary.append({'starter':starter,'completedRuns':len(runs),'full':full,'compressed':compressed,'receiptFiles':receipts,'temporaryApps':0,'privatePreparationDirectories':0,'verifiedEveryArchivedByte':True})
(out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary))
