#!/usr/bin/env python3
"""Pinned official native release. No build, clone, container or system changes."""
import hashlib, json, os, urllib.request, zipfile
from pathlib import Path
TAG='precompiled-2026-10-10-72ce13c'
SHA='fcc51faa1168011819eec9aba85bf6959a6a7ce3929381cdc21c7da29f4bf3d5'
URL=f'https://github.com/convex/convex-backend/releases/download/{TAG}/convex-local-backend-x86_64-unknown-linux-gnu.zip'
root=Path.home()/'sb4scale/bin'; root.mkdir(parents=True,exist_ok=True)
archive=root/'convex-convex-local-backend-x86_64-unknown-linux-gnu.zip'
if not archive.exists(): urllib.request.urlretrieve(URL,archive)
assert hashlib.sha256(archive.read_bytes()).hexdigest()==SHA
out=root/'convex-72ce13c'
out.mkdir(exist_ok=True);binary=out/'convex-local-backend'
with zipfile.ZipFile(archive) as z:
    assert z.namelist()==['convex-local-backend']
    data=z.read('convex-local-backend')
    if binary.exists():assert hashlib.sha256(binary.read_bytes()).digest()==hashlib.sha256(data).digest()
    else:
        with binary.open('xb') as f:f.write(data)
        binary.chmod(0o755)
print(json.dumps(dict(pid=os.getpid(),release=TAG,source_commit='72ce13c379fe6dbdfc305bc8ad699c5663c68c2a',url=URL,archive_sha256=SHA,binary_sha256=hashlib.sha256(binary.read_bytes()).hexdigest()),indent=2))
