#!/usr/bin/env python3
"""Retain NI diagnostics without private stores, dependencies or xcresult secrets."""
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import shutil
import tarfile

root = Path('/tmp/ni-native-20261005').resolve()
assert str(root) == '/private/tmp/ni-native-20261005'
out = root / 'export'
out.mkdir(exist_ok=False)
digest = lambda data: hashlib.sha256(data).hexdigest()
final_names = set()
for log in ['qualification-final.stdout', 'qualification-closeout.stdout']:
    if (root / log).exists():
        for line in (root / log).read_text().splitlines():
            if line.startswith('/private/tmp/') and '/runs/' in line:
                final_names.add(Path(line).name)
index, redactions = [], []

def retained(path):
    data = path.read_bytes()
    if path.suffix == '.log':
        text = data.decode(errors='replace')
        # XCTest may log secure input one character per action. Keep no typing lines.
        cleaned = re.sub(r'(?im)^.*\btype(?:text)?\s+.*$', '<redacted UI typing action>', text).encode()
        if cleaned != data:
            redactions.append({'path': str(path.relative_to(root)), 'originalSha256': digest(data),
                               'retainedSha256': digest(cleaned), 'reason': 'UI typing action redaction'})
        data = cleaned
    return data

for run in sorted((root / 'runs').iterdir()):
    if not (run / 'operator.json').exists():
        raise RuntimeError('unfinished run: ' + run.name)
    evidence = run / 'evidence'
    operator = json.loads((run / 'operator.json').read_text())
    status = json.loads((evidence / 'status.json').read_text())
    index.append({'directory': run.name, 'finalBatch': run.name in final_names,
                  'status': status, 'operator': operator})
    files = [run / 'operator.json', run / 'config.json', *sorted(evidence.iterdir())]
    archive = None
    if run.name not in final_names:
        (out / 'development').mkdir(exist_ok=True)
        archive = tarfile.open(out / 'development' / (run.name + '.tar.gz'), 'w:gz')
    for path in files:
        if not path.is_file():
            raise RuntimeError('unexpected evidence directory: ' + str(path))
        relative = path.relative_to(root / 'runs')
        data = retained(path)
        if run.name in final_names:
            destination = out / 'runs' / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
        else:
            entry = tarfile.TarInfo(str(relative)); entry.size = len(data)
            entry.mode = 0o644; entry.mtime = int(path.stat().st_mtime)
            archive.addfile(entry, io.BytesIO(data))
    if archive:
        archive.close()

for pattern in ['*.log', '*.stdout', 'build-*.json', 'non-protocol-launch.*', 'source-audit.json',
                'validation-final.json', 'identity.json', 'instrument.manifest.json', 'INSTRUMENT*']:
    for path in root.glob(pattern):
        if not path.is_file():
            continue
        data = retained(path)
        destination = out / path.name
        if path.suffix == '.log' and len(data) > 1024 * 1024:
            destination = destination.with_suffix('.log.gz')
            with gzip.open(destination, 'wb') as f:
                f.write(data)
        else:
            destination.write_bytes(data)
for name in ['artifact-controls', 'artifact-controls-final', 'artifact-controls-closeout', 'video-review']:
    if (root / name).exists():
        shutil.copytree(root / name, out / name)
(out / 'attempts.json').write_text(json.dumps(index, indent=2) + '\n')
(out / 'retention.json').write_text(json.dumps({
    'excluded': ['private backend stores', 'xcresult bundles', 'dependencies', 'compiled app/DerivedData'],
    'redactions': redactions,
    'developmentArchive': 'development/<run>.tar.gz contains each earlier attempt, with original manifests and explicit redaction digest mappings; not new qualification claims.',
    'finalEvidence': 'Copied byte-for-byte unless an explicit redaction is listed. Validate before claiming a result.'
}, indent=2) + '\n')
print(json.dumps({'runs': len(index), 'finalRuns': len(final_names), 'redactions': len(redactions),
                  'bytes': sum(p.stat().st_size for p in out.rglob('*') if p.is_file())}))
