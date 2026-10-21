#!/usr/bin/env python3
"""Check frozen wave sources in disposable app copies."""
from pathlib import Path
import argparse,concurrent.futures,gzip,hashlib,json,re,subprocess,tempfile,time
p=argparse.ArgumentParser();p.add_argument('binary',type=Path);p.add_argument('name');p.add_argument('--strip',action='store_true');a=p.parse_args()
root=Path(__file__).resolve().parent;binary=a.binary.resolve();inputs=root/'corpus-inputs';out=root/('census-'+a.name);out.mkdir(exist_ok=True);started=time.time()
def check(schema):
 app=schema.parents[1];identity='/'.join(app.relative_to(inputs).parts)
 with tempfile.TemporaryDirectory(prefix='sec6-corpus-',dir=out) as temp:
  cwd=Path(temp)
  for source in sorted((app/'snapback').rglob('*.q')):
   target=cwd/source.relative_to(app);target.parent.mkdir(parents=True,exist_ok=True);text=source.read_text()
   if a.strip:text=re.sub(r'(?m)^\s*invariant[^\n]*(?:\n|$)','',text)
   target.write_text(text)
  t=time.time();r=subprocess.run(['timeout','60s',str(binary),'check','--json'],cwd=cwd,capture_output=True)
  for suffix,data in [('stdout',r.stdout),('stderr',r.stderr)]: (out/(identity.replace('/','-')+'.'+suffix+'.gz')).write_bytes(gzip.compress(data,mtime=0))
  try:result=json.loads(r.stdout)
  except Exception:result={}
  security=result.get('security',{})
  return {'app':identity,'exit':r.returncode,'seconds':round(time.time()-t,3),'ok':result.get('ok'),'diagnostics':result.get('diagnostics',[]),'notes':security.get('notes',[]),'invariants':security.get('invariants',[])}
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:results=list(pool.map(check,sorted(inputs.glob('wave*/*/snapback/schema.q'))))
summary={'binarySha256':hashlib.sha256(binary.read_bytes()).hexdigest(),'manifestSha256':hashlib.sha256((inputs/'manifest.json').read_bytes()).hexdigest(),'stripped':a.strip,'apps':len(results),'nonzero':[r['app'] for r in results if r['exit']!=0],'seconds':time.time()-started,'results':results}
(out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(a.name,len(results),'apps;',len(summary['nonzero']),'nonzero;',round(summary['seconds'],1),'seconds')
