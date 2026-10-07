#!/usr/bin/env python3
"""Archive explicitly named, completed lane evidence; verify all bytes before pruning."""
import hashlib,json,pathlib,shutil,sys,tarfile
root=pathlib.Path(__file__).resolve().parent/'evidence'
index=root/'archives.json'
records=json.loads(index.read_text()) if index.exists() else {}
for name in sys.argv[1:]:
    if pathlib.Path(name).name!=name:raise ValueError('cohort basename required')
    source=root/name;target=root/(name+'.tar.gz')
    if target.exists():raise ValueError(f'archive already exists: {target}')
    expected={p.relative_to(source).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in source.rglob('*') if p.is_file()}
    size=sum(p.stat().st_size for p in source.rglob('*') if p.is_file())
    with tarfile.open(target,'w:gz',compresslevel=9) as archive:
        for rel in sorted(expected):archive.add(source/rel,arcname=rel,recursive=False)
    with tarfile.open(target) as archive:
        actual={item.name:hashlib.sha256(archive.extractfile(item).read()).hexdigest() for item in archive if item.isfile()}
    assert actual==expected, f'archive verification failed: {name}'
    records[name]=dict(files=len(expected),uncompressedBytes=size,archiveBytes=target.stat().st_size,sha256=hashlib.sha256(target.read_bytes()).hexdigest())
    index.write_text(json.dumps(records,indent=2)+'\n')
    shutil.rmtree(source)
    print(name,records[name],flush=True)
