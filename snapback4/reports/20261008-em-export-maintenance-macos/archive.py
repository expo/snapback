#!/usr/bin/env python3
"""Archive only this report's bounded snapshots, verifying bytes before removal."""
import hashlib
import json
from pathlib import Path
import shutil
import tarfile

out = Path(__file__).resolve().parent / 'evidence'
roots = [p for p in out.rglob('*') if p.is_dir() and
         (p.name.endswith('-snapshots') or p.name == 'snapshots')]
assert roots
files = {}
for root in roots:
    for p in root.rglob('*'):
        if not p.is_file():
            continue
        assert not p.is_symlink()
        assert p.stat().st_mode & 0o077 == 0, p
        files[str(p.relative_to(out))] = dict(bytes=p.stat().st_size,
            sha256=hashlib.sha256(p.read_bytes()).hexdigest(), mode=oct(p.stat().st_mode & 0o777))
archive = out / 'snapshots.tar.gz'
assert not archive.exists()
# Private extraction directories, including the caller-created top directories.
def private(info):
    info.mode = 0o700 if info.isdir() else 0o600
    return info
with tarfile.open(archive, 'w:gz') as tar:
    for root in sorted(roots):
        tar.add(root, arcname=str(root.relative_to(out)), filter=private)
archive.chmod(0o600)
with tarfile.open(archive, 'r:gz') as tar:
    seen = set()
    for member in tar:
        assert member.mode & 0o077 == 0
        if not member.isfile():
            continue
        data = tar.extractfile(member).read()
        assert member.name in files
        assert len(data) == files[member.name]['bytes']
        assert hashlib.sha256(data).hexdigest() == files[member.name]['sha256']
        seen.add(member.name)
    assert seen == set(files)
manifest = dict(archiveSha256=hashlib.sha256(archive.read_bytes()).hexdigest(),
    snapshots=sum(name.endswith('/snapshot.json') for name in files), files=files)
(out / 'snapshot-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
for root in roots:
    shutil.rmtree(root)
print(f"Verified {manifest['snapshots']} snapshots, {len(files)} private files.")
