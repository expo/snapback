import json,hashlib,tarfile,pathlib
root=pathlib.Path.home()/'projects/snapback-pub-0428/snapback4'
q=json.loads((root/'reports/20261026-expo-0.4.43/qualified.json').read_text())
tar=root/'target/publication/client-0.4.43/snapback4-expo-0.4.43.tgz'
files={}
with tarfile.open(tar) as t:
  for m in t.getmembers():
    if m.isfile(): files[m.name[len('package/'):]]=hashlib.sha256(t.extractfile(m).read()).hexdigest()
ok=files==q['files']
print('prepared expo files',len(files),'qualified',len(q['files']),'equal',ok)
if not ok: print({'extra':sorted(files.keys()-q['files'].keys()),'missing':sorted(q['files'].keys()-files.keys()),'changed':[n for n in files if n in q['files'] and files[n]!=q['files'][n]]})
for f in ['snapback4-0.4.43.tgz','snapback4-expo-0.4.43.tgz']: print(f, hashlib.sha256((root/'target/publication/client-0.4.43'/f).read_bytes()).hexdigest())
