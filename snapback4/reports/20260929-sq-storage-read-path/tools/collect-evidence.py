"""Archive an explicit allowlist; never include private state or raw server logs."""
import gzip,hashlib,json,pathlib
base=pathlib.Path('target/sq');dest=pathlib.Path(__file__).resolve().parent.parent/'evidence'
def save(source,relative=None,compressed=True):
 relative=pathlib.Path(relative or source.name)
 output=dest/(str(relative)+('.gz' if compressed else ''));output.parent.mkdir(parents=True,exist_ok=True)
 data=source.read_bytes();output.write_bytes(gzip.compress(data,mtime=0) if compressed else data)
for pattern in ['*-curve.json','*-live-offset.json','*-queues.json','*-drain.json','pf-*.jsonl','*.strace']:
 for source in sorted(base.glob(pattern)):save(source)
for name in ['physical.json','live-summary.json','live-host.jsonl','live-writes.jsonl','batches.csv']:
 save(base/name)
for name in ['summary.json','semantic-check.json','control-check.json','probe-delays.json','write-overlap.json']:
 save(base/name,compressed=False)
for source in sorted(base.glob('*.log')):
 # Server logs may include issued credentials. Only numeric diagnostic records belong here.
 rows=[line for line in source.read_bytes().splitlines(keepends=True) if line.startswith((b'SQ_BEGIN ',b'SQ_END ',b'SQ_QUEUE '))]
 if rows:(dest/(source.stem+'-diagnostic.jsonl.gz')).write_bytes(gzip.compress(b''.join(rows),mtime=0))
for name in ['build-before.log','build-diagnostic.log','build-after.log','affected-store.log','affected-scale.log','guide.log','ref-check.log','full-suite.log','pragmas-test.log','client-build.log','client-build-ready.log','bun-install.log','macos-harness.log']:
 if (base/name).exists():save(base/name,'validation/'+name)
for name in ['result.json','verification-10pct.json','verification-50pct.json','verification-final.json','receipts.jsonl']:
 save(base/'live/evidence/replay'/name,'replay/'+name)
save(base/'macos-harness-check/binaries.json','validation/control-binaries.json',compressed=False)
partial=base/'subprocess-attempt'
for pattern in ['*-curve.json','*-offset.json','*-queues.json','live-host.jsonl']:
 for source in sorted(partial.glob(pattern)):save(source,'subprocess-attempt/'+source.name)
inputs=json.loads((dest/'inputs.json').read_text())
inputs['binaries']={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in [base/'snapback4-before',base/'snapback4-after',base/'snapback4-diagnostic']}
wasm=pathlib.Path('snapback4/packages/snapback4/src/wasm/snapback4_device_bg.wasm')
inputs['wasm']={'sha256':hashlib.sha256(wasm.read_bytes()).hexdigest(),'rawBytes':wasm.stat().st_size,'canonicalGzipBytes':593573,'capBytes':593719}
(dest/'inputs.json').write_text(json.dumps(inputs,indent=2)+'\n')
manifest={str(p.relative_to(dest)):{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(dest.rglob('*')) if p.is_file() and p.name!='manifest.json'}
(dest/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(len(manifest),'artifacts;',sum(p['bytes'] for p in manifest.values()),'bytes')
