#!/usr/bin/env python3
"""Bind the eb1000 archive and copy compact review records into this report."""
import hashlib
import json
from pathlib import Path
import shutil
import sys

archive = Path(sys.argv[1]).resolve()
output = Path(sys.argv[2]).resolve()
output.mkdir(parents=True, exist_ok=True)


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


rows = []
for path in sorted(archive.rglob('*')):
    if path.is_symlink():
        raise RuntimeError('archive-symlink:' + str(path))
    if path.is_file():
        rows.append(dict(path=str(path.relative_to(archive)), bytes=path.stat().st_size, sha256=digest(path)))
chunks = []
for offset in range(0, len(rows), 1500):
    path = output / ('archive-index-%03d.jsonl' % len(chunks))
    path.write_text(''.join(json.dumps(row) + '\n' for row in rows[offset:offset + 1500]))
    if path.stat().st_size > 1_000_000:
        raise RuntimeError('index-shard-over-1MB')
    chunks.append(dict(path=path.name, bytes=path.stat().st_size, sha256=digest(path)))
(output / 'ARCHIVE-INDEX.json').write_text(json.dumps(dict(
    archiveHost='eb1000', archiveRoot=str(archive), fileCount=len(rows),
    totalBytes=sum(row['bytes'] for row in rows), chunks=chunks,
    label='diagnostic: operator-patched seed body format; audit-refused; never admissible; no pass claimed',
    note='Round-7 result booleans are diagnostic observations only. Historical authoring/qualification records retain their original classifications.'), indent=2) + '\n')

names = ['DIAGNOSTIC.md', 'summary.json', 'start.json', 'scratch.json',
         'seed-body-format.diff', 'seed-patch.json', 'static-admission.json',
         'release-identity.json', 'custody-final.json', 'work-copy.json',
         'work-link-relocations.json', 'prepare.log.json', 'release-build.log.json',
         'prepared-source-audit/review.json', 'prepared-source-audit/disposition.json',
         'prepared-source-audit/end.json', 'operator-interruption.json',
         'xcode-setting.json', 'xcode-setting-restored.json']
for backend in ('convex', 'snapback4'):
    for attempt in sorted((archive / 'results' / backend).iterdir()):
        if not attempt.is_dir(): continue
        for name in names + [f'{segment}/{leaf}' for segment in ('m6', 'm8') for leaf in (
                'summary.json', 'independent-validation.json', 'installed-identity.json',
                'evidence/status.json', f'evidence/{segment}-ios-run.json',
                f'evidence/{segment}-ios-receipts.jsonl')]:
            source = attempt / name
            if source.is_file():
                if source.stat().st_size > 1_000_000: continue
                target = output / backend / attempt.name / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, target)
print(json.dumps(dict(files=len(rows), bytes=sum(row['bytes'] for row in rows), shards=len(chunks))))
