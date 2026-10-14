"""Read-only evidence survey: all CLI output goes to disposable schema copies."""
from pathlib import Path
import subprocess, json, tempfile, hashlib, sys
binary=Path(sys.argv[1]).resolve()
rows=[]
for wave,root,odd in [('wave11',Path('/home/ccheever/sb4-loop/wave11/apps'),False),('wave10',Path('/home/ccheever/sb4-loop/wave10/apps'),True)]:
 for p in sorted(root.glob('*/snapback/schema.q')):
  if odd and int(p.parts[-3][:3])%2==0: continue
  with tempfile.TemporaryDirectory(prefix='page4-survey-') as d:
   target=Path(d)/'snapback';target.mkdir();(target/'schema.q').write_bytes(p.read_bytes())
   result=subprocess.run([str(binary),'check','--json'],cwd=d,text=True,capture_output=True)
   rows.append({'wave':wave,'lane':p.parts[-3],'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'exit':result.returncode,'result':json.loads(result.stdout)})
Path(sys.argv[2]).write_text(json.dumps(rows,indent=2)+'\n')
print('binary',hashlib.sha256(binary.read_bytes()).hexdigest())
for wave in ['wave11','wave10']:
 group=[r for r in rows if r['wave']==wave]
 print(wave, 'schemas',len(group),'failed',sum(r['exit']!=0 for r in group))
 for code in ['N_NEVER_COMPLETE','N_CONDITIONAL_COMPLETE']:
  notes=[(r['lane'],n) for r in group for n in r['result'].get('notes',[]) if n['code']==code]
  print(code,len(notes),'notes in',len(set(lane for lane,_ in notes)),'schemas')
  for lane,note in notes: print(lane,note['message'][:180])
