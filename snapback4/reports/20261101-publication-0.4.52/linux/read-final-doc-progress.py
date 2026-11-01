from pathlib import Path
import json,shutil,re
r=Path.home()/'sb4-pub-0452-records';k=Path.home()/'sb4-pub-0452-kit';w=Path.home()/'sb4-pub-0441';q={'freeGiB':shutil.disk_usage(r).free//2**30}
for label in ['publication-source-preflight-prepare','publication-source-audit-linux','publication-source-audit-mac','release-final-doc-checks']:
 p=r/(label+'.exit');q[label]=p.read_text().strip() if p.exists() else 'pending'
p=r/'release-final-scope-plan.json'
if p.exists():
 plan=json.loads(p.read_text());files=sorted((w/'target/affected').glob(plan['head'][:12]+'-*.json'))
 if files:
  x=json.loads(files[-1].read_text());q.update(passed=sum(t['status']==0 for t in x['results']),total=len(x['steps']),current=x['steps'][len(x['results'])]['id'] if len(x['results'])<len(x['steps']) else 'standalone inventory/ref',failed=[t['id']for t in x['results']if t['status']],scopeComplete=x['complete'])
log=r/'release-final-scope.log';q['rawFailedFiles']=re.findall(r'^-- client file FAIL: ([^\n]+)',log.read_text(),re.M) if log.exists() else []
print(json.dumps(q))
