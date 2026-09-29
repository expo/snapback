from pathlib import Path
import difflib, gzip, hashlib, json, re, shutil

root = Path('/Users/ccheever/sb4-np')
evidence = root / 'evidence/round7'
report = root / 'lane/snapback4/reports/20260929-np-macos-slice/round7'
rows = []
def digest(data): return hashlib.sha256(data).hexdigest()
def archive(source):
    data = source.read_bytes()
    if re.search(rb'eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}', data):
        raise RuntimeError('possible credential in ' + str(source))
    target = report / 'raw' / source.relative_to(evidence)
    target = target.with_name(target.name + '.gz')
    target.parent.mkdir(parents=True, exist_ok=True)
    compressed = gzip.compress(data, mtime=0)
    target.write_bytes(compressed)
    rows.append(dict(local=str(source), path=str(target.relative_to(report)), bytes=len(data),
                     sha256=digest(data), gzipBytes=len(compressed), gzipSha256=digest(compressed)))

for source in sorted(evidence.iterdir()):
    if source.is_file() and source.suffix in ['.log', '.json', '.patch', '.ts', '.udid']:
        archive(source)
for directory in ['reviews', 'linux', 'mutations']:
    for source in sorted((evidence / directory).rglob('*')):
        if source.is_file(): archive(source)
native = evidence / 'warm-build-smoke'
assert json.loads((evidence / 'warm-build-smoke-command.json').read_text())['exitStatus'] == 0
for source in sorted(native.iterdir()):
    if source.is_file() and source.suffix in ['.log', '.json', '.jsonl', '.mjs']: archive(source)
for source in sorted((native / 'native-dependencies').rglob('*')):
    if source.is_file(): archive(source)
for source in native.glob('*.png'):
    target = report / 'screens' / source.name
    target.parent.mkdir(exist_ok=True)
    shutil.copy2(source, target)
for source in (evidence / 'tools').iterdir():
    target = report / 'tools' / source.name
    target.parent.mkdir(exist_ok=True)
    shutil.copy2(source, target)
patch = []
for relative in ['src/smoke.ts', 'src/witness-core.ts', 'src/witness-runtime.ts', 'src/witness.ts',
                 'src/index.ts', 'ios/WitnessContainer.swift', 'ios/Snapback4Module.swift']:
    old = Path('/Users/ccheever/np-stage0/clique/node_modules/snapback4-expo') / relative
    new = root / 'subject/node_modules/snapback4-expo' / relative
    patch.extend(difflib.unified_diff(old.read_text().splitlines(True) if old.exists() else [],
                 new.read_text().splitlines(True), fromfile='a/node_modules/snapback4-expo/' + relative,
                 tofile='b/node_modules/snapback4-expo/' + relative))
(report / 'subject-helper.patch').write_text(''.join(patch))
(report / 'EVIDENCE.json').write_text(json.dumps(rows, indent=2) + '\n')
for row in rows:
    compressed = (report / row['path']).read_bytes()
    assert digest(compressed) == row['gzipSha256']
    data = gzip.decompress(compressed)
    assert digest(data) == row['sha256'] and len(data) == row['bytes']
print('Archived and verified', len(rows), 'files;', sum(row['gzipBytes'] for row in rows), 'compressed bytes')
