#!/usr/bin/env python3
"""Check PUB053 evidence bindings without rewriting original receipts."""
import gzip, hashlib, json, pathlib, re, subprocess

root = pathlib.Path('/Users/ccheever/sb4-pub-0453-wt')
kit = pathlib.Path('/Users/ccheever/sb4-pub-0453')
report = root/'snapback4/reports/20261104-publication-0.4.53'
native = root/'snapback4/reports/20261104-expo-0.4.53'
source = '9da2c76fdf32b20f985c85fe6d33b507c09edd25'
read = lambda p: json.loads(p.read_text())
expected = {r['name']: r for r in read(kit/'pub2/expected-artifacts.json')['artifacts']}
summary = {'source': source, 'registryHosts': [], 'smokes': [], 'nativeArtifactHashes': 0}
for path in ['release-evidence/registry-mac/registry-verified.json', 'linux/registry/registry-verified.json']:
    receipt = read(report/path)
    assert receipt['status'] == 'passed' and receipt['source'] == source
    assert {r['name'] for r in receipt['artifacts']} == set(expected)
    for row in receipt['artifacts']:
        assert row['version'] == row['latest'] == '0.4.53'
        for key in ['sha256', 'integrity', 'bytes']:
            assert row[key] == expected[row['name']][key], (path, row['name'], key)
    summary['registryHosts'].append(receipt['host'])
for path in ['release-evidence/isolated/smoke-staged/results.txt', 'linux/smoke-staged/results.txt',
             'release-evidence/smoke-registry-mac/results.txt', 'linux/smoke-registry/results.txt']:
    text = (report/path).read_text()
    count = len(re.findall(r'^PASS ', text, re.M))
    assert count == 10 and 'RESULT PASS' in text and 'FAIL' not in text
    assert re.search(r'root sshd', text)
    summary['smokes'].append({'path': path, 'passed': count})
for prefix in ['offline', 'restart']:
    manifest = read(native/(prefix+'-ios-run.json'))
    assert manifest['exitStatus'] == 0 and manifest['error'] is None
    assert manifest['cliVersion'] == '0.4.53' and manifest['prime']
    assert manifest['relaunch'] == (prefix == 'restart')
    for row in manifest['artifacts'].values():
        path = pathlib.Path(row['path'])
        data = path.read_bytes() if path.exists() else gzip.decompress(path.with_suffix(path.suffix+'.gz').read_bytes())
        assert len(data) == row['bytes'] and hashlib.sha256(data).hexdigest() == row['sha256'], path
        summary['nativeArtifactHashes'] += 1
for path in (report/'audits').glob('*/summary.json'):
    receipt = read(path)
    assert receipt['status'] == 'passed' and receipt['source'] == source and receipt['version'] == '0.4.53'
    assert len(receipt['cases']) == 2
    for case in receipt['cases']:
        assert case['status'] == 'passed' and not case['warnings']
        assert case['vulnerabilities']['total'] == 0
for step in ['publication-resume', 'registry-cli', 'expo-pack', 'expo-pack-verification',
             'expo-proof-bytes', 'expo-publish', 'expo-registry-wait', 'registry-expo', 'publication-dry-run']:
    assert read(report/f'attempt-1-{step}.json')['exit'] == 0
for attempt, code in [(1, 1), (2, 0)]:
    assert read(report/f'linux/records/attempt-{attempt}-linux-qualify.json')['exit'] == code
lean = read(report/'release-evidence/affected-passed.json')
assert lean['ok'] and len(lean['results']) == 32
classified = next(r for r in lean['results'] if r['id'] == 'difftest:run-lean')
assert classified['executedStatus'] == 1 and classified['status'] == 0
assert not classified['leanClassification']['unclassified']
assert hashlib.sha256((report/'release-evidence/affected-lean-campaign-report.json').read_bytes()).hexdigest() == classified['leanClassification']['reportSha256']
pub = [json.loads(line) for line in (root/'snapback4/metrics/publish.jsonl').read_text().splitlines() if json.loads(line).get('version') == '0.4.53']
assert len(pub) == 2 and [r['dry'] for r in pub] == [True, False]
assert all(r['source'] == source for r in pub)
saved = [line[1:] for line in (kit/'witness.jsonl.native-0453.diff').read_text().splitlines() if line.startswith('+{')]
current = (root/'snapback4/metrics/witness.jsonl').read_text().splitlines()
assert len(saved) == 2 and all(current.count(line) == 1 and json.loads(line)['ok'] for line in saved)
summary['publicationRows'] = len(pub)
summary['nativeWitnessRows'] = len(saved)
prefinish = read(report/'release-evidence/linux-prefinish-green.json')
assert len(prefinish['artifacts']) == 4 and prefinish['artifactsCompletedAt'] > prefinish['at']
assert read(report/'release-evidence/linux-prefinish-green.original.json')['artifacts'] == []
paths = subprocess.check_output(['git', 'diff', '--cached', '--name-only', '-z'], cwd=root).decode().split('\0')
for path in filter(None, paths):
    if path.startswith('snapback4/reports/20261104-'):
        p = root/path
        assert not p.is_symlink() and p.suffix not in {'.tgz', '.mp4', '.wasm', '.sqlite'}
        assert not any(part in {'node_modules', 'dist', 'target', '.npm', '.npmrc', '.git', '.snapback4'}
            or part.startswith(('npm-cache', '.env')) for part in p.parts)
        if p.suffix in {'.py', '.sh', '.mjs', '.ts', '.tsx', '.js', '.cjs', '.mts'}:
            assert len(p.read_text().splitlines()) < 1500, path
summary['status'] = 'passed'
(kit/'pub2/records-validation.json').write_text(json.dumps(summary, indent=2)+'\n')
print('RECORDS VALIDATION PASS: registry 4/4 on both hosts; four SSH smokes 10/10; native artifact hashes '
      f"{summary['nativeArtifactHashes']}; publication rows 2; native witness rows 2; retained Linux red and Lean raw exit verified")
