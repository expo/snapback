import hashlib, json, shutil, subprocess, tarfile
from pathlib import Path

root = Path(__file__).resolve().parents[2]
binary = root / 'target/debug/snapback4'
original = json.loads((root / 'reports/20261013-page3/farm-survey.json').read_text())
output = root / 'target/integ10-proof/farm'
output.mkdir(exist_ok=True)
sha = lambda data: hashlib.sha256(data).hexdigest()
results = {}
sources = output / 'sources'
sources.mkdir(exist_ok=True)
archive_path = root / 'reports/20261014-integration10/farm-sources.tar.gz'
with tarfile.open(archive_path) as archive:
    archive.extractall(sources, filter='data')
for variant in ['original', 'repaired']:
    dest = output / variant
    dest.mkdir(exist_ok=True)
    for row in original['source_manifest']:
        source = sources / row['path']
        assert sha(source.read_bytes()) == row['sha256'], str(source)
        target = dest / row['path']
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        if variant == 'repaired' and row['path'].startswith('033-'):
            shutil.copyfile(root / 'reports/20261013-page3/hidden-parent-rewrite.q', target)
    cases = []
    for app in sorted(dest.iterdir()):
        checked = subprocess.run([str(binary), 'check', '--json'], cwd=app, capture_output=True)
        (output / f'{variant}-{app.name}.json').write_bytes(checked.stdout)
        assert checked.returncode == 0, (app.name, checked.stderr.decode())
        data = json.loads(checked.stdout)
        assert data['ok'], app.name
        notes = [n for n in data['notes'] if n['code'] == 'N_NEVER_COMPLETE']
        cases.append({'app': app.name, 'notes': notes, 'source_sha256': sha((app/'snapback/schema.q').read_bytes()), 'output_sha256': sha(checked.stdout)})
    results[variant] = {'schemas': len(cases), 'notes': sum(len(c['notes']) for c in cases), 'schemas_with_notes': sum(bool(c['notes']) for c in cases), 'cases': cases}
    assert len(cases) == 50
assert (results['original']['notes'], results['original']['schemas_with_notes']) == (2, 1)
assert (results['repaired']['notes'], results['repaired']['schemas_with_notes']) == (0, 0)
report = {'binary_sha256': sha(binary.read_bytes()), 'source_digest': original['source_digest'], 'results': results}
(output.parent / 'farm-survey.json').write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps({key: {k:v for k,v in value.items() if k != 'cases'} for key,value in results.items()}))
