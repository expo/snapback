"""Preserve complete receipts/logs and verify original artifacts; binaries stay at recorded local paths."""
import gzip
import hashlib
import json
import pathlib
import shutil
import stat

def verify_inventory(root, inventory):
    root = pathlib.Path(root)
    assert {str(p.relative_to(root)) for p in root.rglob("*")} == {r["path"] for r in inventory["files"]}
    for row in inventory["files"]:
        p = root / row["path"]
        mode = p.lstat().st_mode
        assert stat.S_IMODE(mode) == row["mode"], p
        if row["type"] == "file":
            data = p.read_bytes()
            assert stat.S_ISREG(mode) and len(data) == row["bytes"] and hashlib.sha256(data).hexdigest() == row["sha256"], p
        elif row["type"] == "directory":
            assert stat.S_ISDIR(mode), p
        else:
            assert stat.S_ISLNK(mode) and str(p.readlink()) == row["target"], p
    encoded = json.dumps(inventory["files"], ensure_ascii=False, separators=(",", ":")).encode()
    assert hashlib.sha256(encoded).hexdigest() == inventory["sha256"]
    assert sum(row.get("bytes", 0) for row in inventory["files"]) == inventory["bytes"]
    return len(inventory["files"])

report = pathlib.Path(__file__).resolve().parent
results = []
for measurement in sorted(report.glob('*.json')):
    run = json.loads(measurement.read_text())
    if not isinstance(run, dict) or run.get('command') != ['npm', 'run', 'native:smoke']:
        continue
    start = run['startedAt'] * 1000
    candidates = [p for p in (pathlib.Path(run['cwd']) / 'artifacts/native-smoke').iterdir()
                  if start <= int(p.name.split('-')[0]) <= start + run['durationSeconds'] * 1000]
    assert len(candidates) == 1, (measurement, candidates)
    original = candidates[0]
    dest = report / 'receipts' / measurement.stem
    dest.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((original / 'smoke-ios-run.json').read_text())
    row = {'label': measurement.stem, 'original': str(original), 'seconds': run['durationSeconds'],
           'status': run['status'], 'simulator': manifest.get('simulator'),
           'origin': manifest.get('backend', {}).get('origin'), 'verifiedArtifacts': [], 'copies': {}}
    assert manifest['exitStatus'] == run['status']
    if run['status'] == 0:
        assert all(manifest['segments'][s]['status'] == 'passed' for s in ['prime', 'offline', 'restart'])
        assert manifest['simulator']['name'].startswith('sb4-ns-')
        for name, artifact in manifest['artifacts'].items():
            data = pathlib.Path(artifact['path']).read_bytes()
            assert len(data) == artifact['bytes'] and hashlib.sha256(data).hexdigest() == artifact['sha256'], name
            row['verifiedArtifacts'].append(name)
        proof_file = original / 'proof.json'
        assert hashlib.sha256(proof_file.read_bytes()).hexdigest() == manifest['proof']['sha256']
        proof = json.loads(proof_file.read_text())
        assert hashlib.sha256((original / 'build.json').read_bytes()).hexdigest() == proof['preparation']['sha256']
        build = json.loads((original / 'build.json').read_text())
        row['verifiedAppEntries'] = verify_inventory(build['executedApp']['path'], build['executedApp']['inventory'])
        row['verifiedBuildResultEntries'] = verify_inventory(original / 'build.xcresult', build['buildResult'])
        row['javascriptSha256'] = build['executedApp']['javascript']['sha256']
        row['phases'] = {p['label']: p['durationMs'] for p in build['phases']}
        assert row['phases']['xcode-build'] > 0
        row['segments'] = {s: manifest['segments'][s]['durationMs'] for s in ['prime', 'offline', 'restart']}
        row['xcodeCompileLines'] = sum(line.startswith(('CompileC ', 'SwiftCompile ')) for line in (original / 'xcode-build.log').read_text().splitlines())
    for source in original.iterdir():
        if source.is_file() and source.suffix in ['.json', '.jsonl', '.log', '.mjs', '.png', '.mp4']:
            data = source.read_bytes()
            if source.suffix in ['.png', '.mp4']:
                shutil.copyfile(source, dest / source.name)
            else:
                (dest / (source.name + '.gz')).write_bytes(gzip.compress(data, mtime=0))
            row['copies'][source.name] = {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
    results.append(row)
(report / 'receipt-index.json').write_text(json.dumps(results, indent=2) + '\n')
print('Preserved', len(results), 'attempts;', sum(r['status'] == 0 for r in results), 'verified successes')
