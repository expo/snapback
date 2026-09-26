# The packed Expo tarball holds exactly the qualified package bytes.
from pathlib import Path
import json,hashlib,tarfile,base64,sys
root=Path.cwd(); r=root/'reports/20260926-publication-0.4.3'; q=json.loads((root/'reports/20260926-expo-0.4.3/qualified.json').read_text()); pack=json.loads((r/(sys.argv[1]+'-expo-pack.log')).read_text())[0]
tar=root/'target/expo-0.4.3'/pack['filename']; sri='sha512-'+base64.b64encode(hashlib.sha512(tar.read_bytes()).digest()).decode()
assert pack['name']=='snapback4-expo' and pack['version']=='0.4.3'
assert sri==pack['integrity']
files={}
with tarfile.open(tar) as t:
 for m in t.getmembers():
  if m.isfile():
   assert m.name.startswith('package/')
   name=m.name[len('package/'):]; files[name]=hashlib.sha256(t.extractfile(m).read()).hexdigest()
assert files==q['files'], {'extra':sorted(files.keys()-q['files'].keys()),'missing':sorted(q['files'].keys()-files.keys()),'changed':[n for n in files if n in q['files'] and files[n]!=q['files'][n]]}
record={'name':pack['name'],'version':pack['version'],'filename':pack['filename'],'tarball':str(tar),'bytes':tar.stat().st_size,'integrity':sri,'fileHashes':files,'matchesQualifiedNativePackage':True}
(r/'expo-staged.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps({k:v for k,v in record.items() if k!='fileHashes'},indent=2))
