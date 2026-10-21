#!/usr/bin/env python3
"""Install the official Supabase-pinned release, checking GitHub's asset digest."""
import hashlib
from pathlib import Path
import tarfile
import urllib.request

name='postgrest-v14.18-linux-static-x86-64.tar.xz'
digest='98de1c0be7787aea5f5e11a25f303ea0077634d6fc1000b687bfa825fd27d299'
binary_digest='e62299f98f67938f754291340b2fc07b69685546e6017b455ef3e776daef45ee'
root=Path.home()/'sb4scale/bin'
root.mkdir(parents=True,exist_ok=True)
data=urllib.request.urlopen('https://github.com/PostgREST/postgrest/releases/download/v14.18/'+name).read()
assert hashlib.sha256(data).hexdigest()==digest, 'official release checksum mismatch'
archive=root/name
archive.write_bytes(data)
with tarfile.open(archive) as package:
    binary=package.extractfile('postgrest').read()
assert hashlib.sha256(binary).hexdigest()==binary_digest
path=root/'postgrest-v14.18'
path.write_bytes(binary);path.chmod(0o755)
print('PostgREST 14.18: release archive and executable SHA-256 verified')
