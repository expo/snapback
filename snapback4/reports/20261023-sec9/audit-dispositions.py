#!/usr/bin/env python3
"""Exercise deliberate update-only dispositions on isolated corpus copies."""
import argparse,concurrent.futures,json,pathlib,re,subprocess,tempfile,shutil,hashlib
p=argparse.ArgumentParser();p.add_argument('--binary',required=True);p.add_argument('--results',required=True);p.add_argument('--out',required=True);a=p.parse_args()
rows=json.loads(pathlib.Path(a.results).read_text());items=[]
for r in rows:
 lines=set()
 for n in r['notes']:
  if n['code'] not in ['N_CREATE_EDIT_ASYMMETRY','N_PRIVATE_CREATE_EDIT_ASYMMETRY']:continue
  m=re.search(r': (\w+\.\w+) is supplied.* guard (.+)$',n['message']) or re.search(r'argument-supplied (\w+\.\w+) is open.* requires (.+?) when this column changes',n['message'])
  if not m:raise ValueError(n['message'])
  lines.add('invariant '+m[1]+' update only '+m[2])
 if lines:items.append((r,sorted(lines)))
def run(item):
 row,lines=item;wave,folder=row['lane'].split('-',1);source=pathlib.Path.home()/'sb4-loop'/('wave'+wave[1:])/'apps'/folder/'snapback'
 with tempfile.TemporaryDirectory(prefix='sb4-sec9-disposition-') as tmp:
  root=pathlib.Path(tmp);(root/'snapback').mkdir()
  for path in source.glob('*.q'):shutil.copy2(path,root/'snapback'/path.name)
  schema=root/'snapback/schema.q';schema.write_text(schema.read_text()+'\n'+'\n'.join(lines)+'\n')
  result=subprocess.run(['timeout','--kill-after=5s','45',str(pathlib.Path(a.binary).resolve()),'check','--json'],cwd=root,capture_output=True,text=True)
  try:checked=json.loads(result.stdout)
  except ValueError:checked={}
  remaining=[d['code'] for d in checked.get('securityReviews',[]) if d['gated'] and not d['acknowledged'] and d['code'] in ['N_CREATE_EDIT_ASYMMETRY','N_PRIVATE_CREATE_EDIT_ASYMMETRY']]
  return dict(lane=row['lane'],lines=lines,exit=result.returncode,newGatesRemaining=remaining,parsed=isinstance(checked.get('security'),dict),diagnostics=checked.get('diagnostics',[]),classification='explicit creation/edit difference requires one matching update-only line per column; no source app was modified')
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:results=list(pool.map(run,items))
pathlib.Path(a.out).write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(dict(projects=len(results),lines=sum(len(r['lines']) for r in results),remaining=sum(len(r['newGatesRemaining']) for r in results),parseFailures=sum(not r['parsed'] for r in results))))
