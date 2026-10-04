"""Retain lane-owned raw evidence outside git, addressed by SHA-256."""
import hashlib
import json
import pathlib
import shutil

ROOT = pathlib.Path.cwd().resolve()
WORK = ROOT / 'target/wd'
REPORT = pathlib.Path(__file__).resolve().parent
ARCHIVE = pathlib.Path.home() / 'sb4-np/evidence-archive/20261003-wd-witness-cleanup-deadline/blobs'
ARCHIVE.mkdir(parents=True, exist_ok=True)

paths = set()
for pattern in ['*.log', '*.json', '*.rs', '*-production', '*-debug', 'run-*.py']:
    paths.update(WORK.glob(pattern))
paths.discard(WORK / 'archive-status.log')  # This script's own redirected output.
paths.update((WORK / 'linux-check').glob('*.log'))
paths.update((WORK / 'linux-check').glob('Cargo.*'))
paths.update((WORK / 'linux-check/src').glob('*.rs'))
for cohort in REPORT.glob('exports-*.json'):
    for row in json.loads(cohort.read_text()):
        for item in row.get('evidence', []):
            path = pathlib.Path(item['path'])
            blob = ARCHIVE / item['sha256']
            if not blob.exists():
                assert path.exists() and hashlib.sha256(path.read_bytes()).hexdigest() == item['sha256']
                shutil.copyfile(path, blob)
            assert hashlib.sha256(blob.read_bytes()).hexdigest() == item['sha256']
            if path.exists():
                paths.add(path)
        receipt = row.get('receiptPath')
        if receipt:
            folder = pathlib.Path(receipt).parent
            if folder.is_dir():
                paths.update(p for p in folder.iterdir() if p.is_file() and
                             (p.suffix in ['.log', '.json', '.jsonl', '.png', '.mp4']))
            # Normal retention can replace a finished run by an archive.
            paths.update(folder.parent.glob(folder.name + '*.gz'))

rows = []
for path in sorted(paths):
    assert path.resolve().is_relative_to(WORK), path
    if not path.is_file():
        continue
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    blob = ARCHIVE / digest
    if blob.exists():
        assert hashlib.sha256(blob.read_bytes()).hexdigest() == digest
    else:
        shutil.copyfile(path, blob)
    rows.append(dict(path=str(path.relative_to(ROOT)), sha256=digest, bytes=path.stat().st_size))

sources = []
for pattern in ['crates/snapback4/src/verbs/witness.rs', 'crates/snapback4/src/verbs/witness/*.rs',
                'crates/snapback4-lang/src/guide/witness.md', 'scripts/test.sh']:
    for path in sorted(ROOT.glob(pattern)):
        sources.append(dict(path=str(path.relative_to(ROOT)), sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
result = dict(archive=str(ARCHIVE), files=rows, source=sources,
              exportEvidence='exports-*.json also index proof/recording blobs copied immediately after each command')
encoded = json.dumps(result, separators=(',', ':')) + '\n'
assert len(encoded.encode()) < 256 * 1024, 'Split the index before adding a larger file to git'
(REPORT / 'evidence-index.json').write_text(encoded)
print(json.dumps(dict(files=len(rows), bytes=sum(row['bytes'] for row in rows), indexBytes=(REPORT / 'evidence-index.json').stat().st_size)))
