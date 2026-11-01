from pathlib import Path
import json,subprocess,shutil
k=Path.home()/'sb4-pub-0452';w=Path.home()/'sb4-pub-0444-wt/snapback4';r=w/'reports/20261101-publication-0.4.52'
q={'freeGiB':shutil.disk_usage(w).free//2**30,'power':subprocess.check_output(['pmset','-g','batt'],text=True).splitlines()[0]}
for name in ['native-1','prepare-1','audit-mac-early','chain-a1.env-invalid']:
 p=k/(name if name.endswith('env-invalid') else name+'.exit');q[name]=p.read_text().strip() if p.exists() else 'pending'
steps=[]
for p in r.glob('attempt-1-*.json'):
 try:
  v=json.loads(p.read_text())
  if 'step' in v and 'end' in v:steps.append(v)
 except:pass
q['completed']=len(steps);q['last']=max(steps,key=lambda x:x['end'])['step'] if steps else 'waiting';q['failed']=[x['step'] for x in steps if x['exit']]
print(json.dumps(q))
