"""Read-only packet/evidence integrity audit; does not execute product or probe code."""
from pathlib import Path
import collections
import datetime
import hashlib
import json
import re

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent / 'packet'
EXPECTED = 'bee6b4e20068c523161bd6aac27a04999f168cca7adb3d0b8e6a43e4a242e7f9'
sha = lambda b: hashlib.sha256(b).hexdigest()
read_json = lambda p: json.loads((ROOT / p).read_bytes())

def payload(p):
    return str(p.readlink()).encode() if p.is_symlink() else p.read_bytes()

manifest = read_json('manifest.json')
assert sha((ROOT / 'manifest.json').read_bytes()) == EXPECTED
listed = set()
for entry in manifest['files']:
    rel = Path(entry['path'])
    assert not rel.is_absolute() and '..' not in rel.parts
    p = ROOT / rel
    assert p.is_symlink() == (entry['kind'] == 'symlink'), rel
    data = payload(p)
    assert len(data) == entry['bytes'] and sha(data) == entry['sha256'], rel
    listed.add(rel.as_posix())
actual = {p.relative_to(ROOT).as_posix() for p in ROOT.rglob('*') if p.is_file() or p.is_symlink()}
assert actual == listed | {'manifest.json'}
exports = {}
for prefix in ('before/', 'source/'):
    exports[prefix] = {e['path'][len(prefix):]: {k: v for k, v in e.items() if k != 'path'}
                       for e in manifest['files'] if e['path'].startswith(prefix)}
assert exports['before/'].keys() == exports['source/'].keys()
changed = sorted(p for p in exports['before/'] if exports['before/'][p] != exports['source/'][p])
assert changed == (ROOT / 'direct-delta-paths.txt').read_text().splitlines()

# Apply each frozen unified-diff hunk in memory, also checking Git blob IDs.
patch = (ROOT / 'direct-delta.patch').read_text()
blobs = {}
for section in patch.split('diff --git ')[1:]:
    lines = section.splitlines(keepends=True)
    rel = lines[0].strip().split(' b/')[1]
    old = (ROOT / 'before' / rel).read_bytes()
    new = (ROOT / 'source' / rel).read_bytes()
    blob = lambda b: hashlib.sha1(b'blob ' + str(len(b)).encode() + b'\0' + b).hexdigest()
    left, right = re.search(r'index ([0-9a-f]+)\.\.([0-9a-f]+)', section).groups()
    assert blob(old).startswith(left) and blob(new).startswith(right)
    old_lines = old.decode().splitlines(keepends=True)
    out, cursor = [], 0
    i = 0
    while i < len(lines):
        match = re.match(r'@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@', lines[i])
        if not match:
            i += 1
            continue
        start = int(match[1]) - 1
        out.extend(old_lines[cursor:start]); cursor = start; i += 1
        old_count = new_count = 0
        while i < len(lines) and not lines[i].startswith('@@'):
            line = lines[i]
            if line.startswith((' ', '-')):
                assert old_lines[cursor] == line[1:]
                cursor += 1; old_count += 1
            if line.startswith((' ', '+')):
                out.append(line[1:]); new_count += 1
            i += 1
        assert old_count == int(match[2] or 1) and new_count == int(match[4] or 1)
    out.extend(old_lines[cursor:])
    assert ''.join(out).encode() == new
    blobs[rel] = {'beforeGitBlob': blob(old), 'sourceGitBlob': blob(new), 'sourceSha256': sha(new)}

executed = read_json('evidence/source-manifest.json')['sources']
overlap = 0
corpus = 0
for e in executed:
    p = ROOT / 'evidence/executed-source' / e['path']
    data = payload(p)
    assert sha(data) == e['sha256']
    if 'bytes' in e: assert len(data) == e['bytes']
    current = ROOT / 'source' / e['path']
    if current.exists() or current.is_symlink():
        assert payload(current) == data, e['path']
        overlap += 1
    if e['path'].startswith('native-corpus/'):
        assert payload(ROOT / 'native/corpus' / e['path'][len('native-corpus/'):]) == data
        corpus += 1
before_inputs = (ROOT / 'evidence/inputs-before.json').read_bytes()
after_inputs = (ROOT / 'evidence/inputs-after.json').read_bytes()
assert before_inputs == after_inputs

modules = ('certificate-identity.ts', 'hash.ts', 'errors.ts', 'types.ts')
for name in ('original-probe', 'after-probe'):
    base = ROOT / 'evidence' / name
    record = json.loads((base / 'execution.json').read_bytes())
    assert sha((base / 'probe.ts').read_bytes()) == record['probeSha256']
    assert sha((base / 'stdout.json').read_bytes()) == record['stdoutSha256']
    assert sha((base / 'stderr.log').read_bytes()) == record['stderrSha256']
    sources = json.loads((base / 'sources.json').read_bytes())
    for e in sources['files']:
        mapped = Path(e.get('copy', e.get('local')))
        p = base / mapped.parent.name / mapped.name
        assert sha(p.read_bytes()) == e['sha256']
    for module in modules:
        assert (base / 'before' / module).read_bytes() == (ROOT / 'evidence/original-probe/before' / module).read_bytes()
        arm = 'before' if name == 'original-probe' else 'source'
        assert (base / 'source' / module).read_bytes() == (ROOT / arm / 'snapback2/packages/evaluator/src' / module).read_bytes()
assert (ROOT / 'evidence/original-probe/probe.ts').read_bytes() == (ROOT / 'evidence/after-probe/probe.ts').read_bytes()
old_results = read_json('evidence/original-probe/stdout.json')['results']
new_results = read_json('evidence/after-probe/stdout.json')['results']
compact = lambda v: json.dumps(v, ensure_ascii=False, separators=(',', ':'))
controls = []
test = (ROOT / 'source/snapback2/packages/evaluator/src/test.ts').read_text()
fixed = re.findall(r"json: '([^'\n]+)',\n\s+hash: \"([a-f0-9]+)\"", test)
assert len(fixed) == 4
assert len(old_results) == len(new_results)
for i, (a, b) in enumerate(zip(old_results, new_results)):
    assert a['name'] == b['name'] and compact(a['input']) == compact(b['input'])
    assert compact(a['parent']) == compact(b['parent']) == compact(b['candidate'])
    assert a['equal'] == (i >= 2) and b['equal'] is True
    if 'value' in a['parent']:
        assert sha(a['parent']['value'].encode()) == a['parent']['sha256']
        assert fixed[i] == (a['parent']['value'], a['parent']['sha256'])
    controls.append({'name': a['name'], 'originalEqual': a['equal'], 'repairedFullResultEqual': b['equal']})
assert len(controls) == 5
checker = read_json('evidence/checker-use.json')
assert checker['sourceManifestSha'] == sha((ROOT / 'evidence/source-manifest.json').read_bytes())
assert checker['corpusManifestSha'] == sha((ROOT / 'evidence/executed-source/native-corpus/manifest.json').read_bytes())
for key, name in [('testEntrySha', 'test.ts'), ('testMergeSha', 'test-merge.ts')]:
    assert checker[key] == sha((ROOT / 'source/snapback2/packages/evaluator/src' / name).read_bytes())
assert read_json('evidence/verification.json')['evaluatorLogSha'] == sha((ROOT / 'evidence/evaluator-with-checker.log').read_bytes())

result = {
    'timeUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'status': 'PASS', 'kind': 'static packet and supplied-evidence verification; no product execution',
    'manifestSha256': EXPECTED, 'entries': len(listed),
    'kinds': dict(collections.Counter(e['kind'] for e in manifest['files'])),
    'missingOrUnlisted': [], 'changedPaths': changed, 'gitBlobs': blobs,
    'executedSourceEntriesVerified': len(executed), 'currentSourceOverlapEqual': overlap,
    'nativeCorpusEntriesEqual': corpus,
    'recordedRemoteBeforeAfterInventoriesEqual': len(json.loads(before_inputs)),
    'probeControls': controls,
    'limitation': 'Remote dependency files and executable binaries were not accessed; their identities/execution are supplied receipts. Historical paths were not followed.',
    'verifierCorrections': ['The first inline audit incorrectly expected a symlink target field; this verifier checks target bytes and SHA256 as the manifest specifies.', 'The first script execution stopped on Python zip(strict=True) compatibility; replaced with an explicit length assertion. Neither issue was a packet defect.']
}
(HERE / 'packet-verification.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
