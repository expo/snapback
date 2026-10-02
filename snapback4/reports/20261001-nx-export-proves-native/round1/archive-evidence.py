"""Preserve receipts and the last five complete runs before deleting test projects.

Run only after every native command has drained. Content-addressed references
reuse receipts already captured by run.mjs; no app/build workspace is archived.
"""
from pathlib import Path
import gzip
import hashlib
import json
import shutil
import stat

root = Path(__file__).resolve().parents[3]
report = Path(__file__).resolve().parent
archive = report / 'retained-evidence'
archive.mkdir(exist_ok=False)
known = {}
for inventory in report.rglob('inventory.json'):
    rows = json.loads(inventory.read_text())
    if not isinstance(rows, list):
        continue
    for row in rows:
        if not isinstance(row, dict) or 'sha256' not in row or 'name' not in row:
            continue
        saved = inventory.parent / (row['name'] + '.gz')
        if saved.is_file():
            known.setdefault(row['sha256'], saved)

receipts = {'smoke-ios-run.json', 'smoke-ios-receipts.jsonl', 'proof.json',
            'build.json', 'installed.json', 'preparation-failure.json', 'native-base.json'}
summary = {}
for starter in ['plain', 'social']:
    evidence = root / 'target/nx' / starter / 'artifacts/native-smoke'
    runs = sorted(evidence.iterdir(), key=lambda p: int(p.name.split('-')[0]))
    assert all((run / 'finished.json').is_file() for run in runs), 'unfinished run'
    full = [run for run in runs if not (run / 'retention.json').exists()]
    assert len(full) == 5
    assert full == runs[-5:]
    index = []
    for run in runs:
        for temporary in ['preparation-tmp', 'base.app', 'export.app', 'build.xcresult']:
            assert not (run / temporary).exists(), (run, temporary)
        files = []
        for source in sorted(run.iterdir()):
            name = source.name
            plain_name = name[:-3] if name.endswith('.gz') else name
            if run not in full and plain_name not in receipts | {'finished.json', 'retention.json'}:
                raise AssertionError(('old nonreceipt retained', source))
            assert source.is_file() and not source.is_symlink(), source
            raw = source.read_bytes()
            decoded = gzip.decompress(raw) if name.endswith('.gz') else raw
            digest = hashlib.sha256(decoded).hexdigest()
            saved = known.get(digest)
            compressed = True
            if saved is None:
                destination = archive / starter / run.name
                destination.mkdir(parents=True, exist_ok=True)
                if name.endswith('.gz'):
                    saved = destination / name
                    saved.write_bytes(raw)
                elif source.suffix in {'.json', '.jsonl', '.log', '.mjs', '.js', '.txt'}:
                    saved = destination / (name + '.gz')
                    saved.write_bytes(gzip.compress(raw, mtime=0))
                else:
                    saved = destination / name
                    shutil.copy2(source, saved)
                    compressed = False
                known[digest] = saved
            else:
                compressed = saved.name.endswith('.gz')
            # Verify every retained byte, including existing deduplicated captures.
            retained = saved.read_bytes()
            if compressed:
                retained = gzip.decompress(retained)
            assert hashlib.sha256(retained).hexdigest() == digest
            files.append({'originalName': name, 'archive': str(saved.relative_to(report)),
                          'sha256': digest, 'bytes': len(decoded), 'compressed': compressed,
                          'originalMode': stat.S_IMODE(source.stat().st_mode)})
        index.append({'run': run.name, 'fullEvidence': run in full, 'files': files})
    (archive / f'{starter}-runs.json').write_text(json.dumps(index, indent=2) + '\n')
    summary[starter] = {'runs': len(runs), 'fullEvidenceRuns': len(full),
                        'temporaryDirectories': 0, 'perRunApps': 0,
                        'originalEvidenceBytes': sum(p.stat().st_size for p in evidence.rglob('*') if p.is_file()),
                        'retainedReceiptFiles': sum(1 for r in index for f in r['files'] if f['originalName'].removesuffix('.gz') in receipts)}
(archive / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps(summary))
