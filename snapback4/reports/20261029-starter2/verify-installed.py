import sys,tarfile,pathlib,json,hashlib
root=pathlib.Path(sys.argv[1])/'node_modules/snapback4';tar=pathlib.Path(sys.argv[2]);bad=[];count=0
with tarfile.open(tar) as t:
 for entry in t:
  if not entry.isfile():continue
  rel=pathlib.PurePosixPath(entry.name).relative_to('package');p=root.joinpath(*rel.parts);count+=1
  if not p.is_file() or hashlib.sha256(p.read_bytes()).digest()!=hashlib.sha256(t.extractfile(entry).read()).digest():bad.append(str(rel))
print(json.dumps(dict(files=count,mismatches=bad)))
if bad:sys.exit(1)
