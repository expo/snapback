"""Archive only public measurements; never private state, stores or server text."""
import gzip, hashlib, json, pathlib, shutil, sys

root = pathlib.Path(__file__).resolve().parents[4]
report = pathlib.Path(__file__).resolve().parent.parent
base = root/'target/bp/before'
out = report/'evidence'
out.mkdir(exist_ok=True)
def archive(source, name=None):
    if not source.exists(): return
    target = out/((name or source.name)+'.gz')
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(gzip.compress(source.read_bytes(), mtime=0))
for kind in ['immediate','warm']:
    archive(base/f'live-{kind}-curve.json')
    for stage in ['10%','50%','full']:
        archive(base/f'{stage}-live-{kind}-curve.json')
for stage in ['10%','50%','full']:
    for suffix in ['queues','live-offset','immediate-end']:
        archive(base/f'{stage}-{suffix}.json')
for name in ['host.jsonl','process-host.jsonl','drain.json','attribution.json','batches.csv']:
    archive(base/name)
for name in ['summary.json','inputs.json']:
    if (base/name).exists(): shutil.copyfile(base/name,out/name)
diagnostic = b''.join(line for line in (base/'server.log').read_bytes().splitlines(keepends=True)
    if line.startswith((b'BP_REQUEST ',b'BP_BACKGROUND ',b'SQ_QUEUE ',b'SQ_BEGIN ',b'SQ_END ')))
(out/'server-diagnostic.jsonl.gz').write_bytes(gzip.compress(diagnostic,mtime=0))
replay = base/'live/evidence/replay'
for name in ['result.json','receipts.jsonl','verification-10pct.json','verification-50pct.json','verification-final.json']:
    archive(replay/name,'replay/'+name)
for name in ['build-diagnostic.log','bun-install.log','client-build.log','build-before.log',
             'affected-lock.log','affected-chunks.log','guide.log','full-suite.log','ref-check.log',
             'sustained-requests.log','acquisition-isolated.log','hung-acquisition-processes.json',
             'validation-results.json','acquisition-isolated-result.json']:
    archive(root/'target/bp'/name,'validation/'+name)
shutil.copyfile(base/'CURVES.md',report/'CURVES.md')
manifest={str(p.relative_to(out)):{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
          for p in sorted(out.rglob('*')) if p.is_file() and p.name!='manifest.json'}
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(len(manifest),'evidence files; total bytes',sum(v['bytes'] for v in manifest.values()))
