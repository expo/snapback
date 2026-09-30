import hashlib,json,pathlib,sys
root=pathlib.Path(sys.argv[1]); manifest=json.loads(pathlib.Path(sys.argv[2]).read_text())
failed=[p for p,h in manifest['files'].items() if not (root/p).is_file() or hashlib.sha256((root/p).read_bytes()).hexdigest()!=h]
print('Verified',len(manifest['files']),'source files; mismatches:',failed)
assert not failed
