"""Check read-only wave-12 sources in disposable projects; retain hashes and notes."""
from pathlib import Path
from collections import Counter
import subprocess,json,tempfile,hashlib,sys
binary=Path(sys.argv[1]).resolve()
rows=[]
root=Path('/home/ccheever/sb4-loop/wave12/apps')
for lane in sorted(root.glob('[0-9][0-9][0-9]-*')):
 sources=sorted((lane/'snapback').glob('*.q'))
 if not sources: raise RuntimeError(f'no schema: {lane.name}')
 hashes={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sources}
 with tempfile.TemporaryDirectory(prefix='lang-wave12-') as d:
  target=Path(d)/'snapback';target.mkdir()
  for p in sources: (target/p.name).write_bytes(p.read_bytes())
  result=subprocess.run([str(binary),'check','--json'],cwd=d,text=True,capture_output=True)
  try: checked=json.loads(result.stdout)
  except json.JSONDecodeError: checked={'stdout':result.stdout,'stderr':result.stderr}
  rows.append({'lane':lane.name,'source_sha256':hashes,'exit':result.returncode,'result':checked})
 assert hashes=={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sources}
counts=Counter(n['code'] for r in rows for n in r['result'].get('notes',[]))
out={'binary_sha256':hashlib.sha256(binary.read_bytes()).hexdigest(),'schemas':len(rows),'failed':sum(r['exit']!=0 for r in rows),'note_counts':dict(sorted(counts.items())),'notes_total':sum(counts.values()),'rows':rows}
Path(sys.argv[2]).write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps({k:v for k,v in out.items() if k!='rows'},indent=2))
for r in rows:
 if r['exit']: print(r['lane'],json.dumps(r['result']))
