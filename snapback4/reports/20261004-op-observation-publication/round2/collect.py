"""Collect completed round-2 evidence; raw logs stay in this lane's target/op."""
import hashlib, json, re, shutil, time
from pathlib import Path

root = Path(__file__).resolve().parents[3]
out = Path(__file__).resolve().parent
raw = root/'target/op/round2'
def digest(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()
def counts(path):
    return {k: int(v) for k, v in re.findall(r'^[ℹ#] (tests|pass|fail|cancelled|skipped|todo) (\d+)$', path.read_text(), re.M)}

record = dict(collected=time.time(), parent='a759ded99a', product={}, stress=[], logs={})
for name in ['local-reads.ts', 'local-query.ts', 'local.ts']:
    path = root/'packages/snapback4/src'/name
    record['product'][str(path.relative_to(root))] = digest(path)
for group in ['stress-a', 'stress-b', 'stress-c']:
    data = json.loads((raw/group/'results.json').read_text())
    for run in data['runs']:
        path = raw/group/f"{run['run']:02}.log"
        run.update(counts(path)); run['log_sha256'] = digest(path)
        assert run['exit'] == run['fail'] == run['cancelled'] == run['skipped'] == 0 and run['hog_alive']
    data['hog_reaped'] = not Path(f"/proc/{data['hog_pid']}").exists()
    assert data['hog_reaped']
    record['stress'].append(data)
assert sorted(r['run'] for g in record['stress'] for r in g['runs']) == list(range(1, 11))
record['passes'] = sum(r['pass'] for g in record['stress'] for r in g['runs'])
record['runs'] = json.loads((raw/'runs.json').read_text())
assert len(record['runs']) == 4 and all(r['exit'] == 0 for r in record['runs'])
record['affinity'] = {p.name: json.loads(p.read_text()) for p in raw.glob('*.affinity.json')}
record['disk_peak_bytes'] = max(r['bytes'] for r in json.loads((raw/'disk.json').read_text()))
for name in ['negative-astra.log', 'negative-unit.log', 'negative-live.log', 'positive-astra.log',
             'positive-focused.log', 'pre-op-parity.log', 'sdk-build.log', 'typecheck.log', 'ref-check.log']:
    path = raw/name
    record['logs'][name] = dict(bytes=path.stat().st_size, sha256=digest(path), counts=counts(path))
    # Keep raw hashes above; trim reporter-only trailing whitespace in git copies.
    (out/name).write_text('\n'.join(line.rstrip() for line in path.read_text().splitlines())+'\n')
    record['logs'][name]['stored_sha256'] = digest(out/name)
record['sdk_match'] = all(digest(p) == digest(root/'packages/snapback4/dist'/p.relative_to(raw/'sdk-final-plain/dist'))
                          for p in (raw/'sdk-final-plain/dist').rglob('*') if p.is_file())
assert record['sdk_match']
record['sdk_files'] = len([p for p in (raw/'sdk-final-plain/dist').rglob('*') if p.is_file()])
record['sdks'] = {}
for sdk in ['sdk-before', 'round1/sdk-final-plain', 'round2/sdk-final-plain', 'sdk-r2-final']:
    folder = root/'target/op'/sdk
    manifest = {str(p.relative_to(folder)): digest(p) for p in sorted(folder.rglob('*')) if p.is_file()}
    record['sdks'][sdk] = dict(files=len(manifest), manifest_sha256=hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest(),
        modules={name: manifest[name] for name in ['dist/local-reads.js', 'dist/local-query.js', 'dist/local.js', 'dist/wasm/snapback4_device_bg.wasm']})
record['inputs'] = {str(p.relative_to(root)): digest(p) for p in [
    root/'target/lu-op', root/'target/debug/snapback4',
    root/'packages/snapback4/test/observation-publication.test.mjs',
    root/'packages/snapback4/test/observation-publication-live.test.mjs',
    root/'reports/20261004-op-observation-publication/round2-stress.py',
    out/'qualify.py', out/'astra-overtaken-queue.test.mjs']}
record['browser_raw'] = {name: digest(raw/name) for name in ['idle.json', 'idle.json.jsonl']}
record['full_suite'] = 'Not repeated: only the prediction fence changed in product code; round 1 full-suite evidence is retained.'
for name in ['idle-qualification.json', 'idle.summary.json', 'idle.stamps.csv', 'wasm.json']:
    shutil.copy2(raw/name, out/name)
(out/'qualification.json').write_text(json.dumps(record, indent=2)+'\n')
assert all(p.stat().st_size <= 256*1024 for p in out.iterdir() if p.is_file())
print(json.dumps(dict(passes=record['passes'], disk_peak_bytes=record['disk_peak_bytes'], sdk_match=record['sdk_match'])))
