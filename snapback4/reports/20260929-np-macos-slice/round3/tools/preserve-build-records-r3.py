from pathlib import Path
import json,hashlib,sys
r=Path('/Users/ccheever/sb4-np');e=r/'evidence/round3';name=sys.argv[1];receipt=json.loads((e/name/'build.json').read_text());cache=r/'subject/.snapback4-witness'
for row in receipt['nativeClosure']['compiler']['records']:
 p=cache/row['path'];b=p.read_bytes();assert hashlib.sha256(b).hexdigest()==row['sha256'];out=e/name/'native-dependencies'/row['path'];out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(b)
print(name,len(receipt['nativeClosure']['compiler']['records']))
