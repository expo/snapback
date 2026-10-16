from pathlib import Path
import subprocess,json,collections,sys
root=Path('/tmp/sb4-rules3-census'); results=[]
for p in sorted(root.iterdir()):
 if not p.is_dir():continue
 r=subprocess.run([sys.argv[1],'check','--json'],cwd=p,capture_output=True,text=True)
 try: data=json.loads(r.stdout)
 except: data={'raw':r.stdout,'stderr':r.stderr}
 results.append({'lane':p.name[:3],'exit':r.returncode,'result':data})
Path(sys.argv[2]).write_text(json.dumps(results,indent=2)+'\n')
counts=collections.Counter()
for r in results:
 def walk(x):
  if isinstance(x,dict):
   if 'code'in x:counts[x['code']]+=1
   for v in x.values():walk(v)
  elif isinstance(x,list):
   for v in x:walk(v)
 walk(r['result'])
print(len(results),'lanes',collections.Counter(r['exit'] for r in results),dict(sorted(counts.items())))
