#!/usr/bin/env python3
"""Seal stopped C0′ raw evidence, audit known secrets and write archive receipt.
Run report/verify first. Vaults stay outside Git and are removed after staging.
"""
import argparse,base64,hashlib,importlib.util,json,os,re,shutil,tarfile,time
from pathlib import Path

def read(p):return json.loads(p.read_text())
def write(p,v):p.write_text(json.dumps(v,indent=2)+'\n')
def main():
    p=argparse.ArgumentParser();p.add_argument('--roots',nargs='+',type=Path,required=True);p.add_argument('--vaults',nargs='+',type=Path,required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--archive',type=Path,required=True);p.add_argument('--binary',type=Path,required=True);a=p.parse_args()
    assert not a.archive.exists();assert not read(a.out/'verification.json')['process_custody']['left']
    values=sorted({x for path in a.vaults for x in read(path)})
    merged=a.archive.parent/'c0-merged-vault.json';fd=os.open(merged,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as f:json.dump(values,f)
    assert any((r/'c0-binary').exists() and hashlib.sha256((r/'c0-binary').read_bytes()).hexdigest()==hashlib.sha256(a.binary.read_bytes()).hexdigest() for r in a.roots)
    spec=importlib.util.spec_from_file_location('finish',Path(__file__).with_name('g70-finish.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
    scan=m.scan([*a.roots,a.out],merged);assert not scan['matches'],scan['matches'];write(a.out/'secret-audit.json',scan)
    a.archive.parent.mkdir(parents=True,exist_ok=True)
    with a.archive.open('xb') as output:
      with tarfile.open(fileobj=output,mode='w:gz',compresslevel=6) as tar:
        for root in a.roots:tar.add(root,arcname=root.name)
    digest=hashlib.sha256()
    with a.archive.open('rb') as f:
      for chunk in iter(lambda:f.read(1024*1024),b''):digest.update(chunk)
    write(a.out/'archive.json',dict(path=str(a.archive),sha256=digest.hexdigest(),bytes=a.archive.stat().st_size,roots=[r.name for r in a.roots],raw_data_in_git=False))
    print(json.dumps(dict(archive_sha256=digest.hexdigest(),bytes=a.archive.stat().st_size,secret_matches=0,merged_vault=str(merged))))
if __name__=='__main__':main()
