from pathlib import Path
import json,datetime,shutil,re,subprocess
r=Path('/home/ccheever/sb4-pub-0452-records');w=Path('/home/ccheever/sb4-records-0452')
c=(r/'records-commit.sha').read_text().strip()
paths=list((w/'target/affected').glob(c[:12]+'-*.json'))
q={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'commit':c,'freeGiB':shutil.disk_usage(w).free//2**30}
if paths:
 p=max(paths,key=lambda p:p.stat().st_mtime)
 try:
  receipt=json.loads(p.read_text());results=receipt['results'];q.update({'receipt':str(p),'completedSteps':len(results),'totalSteps':len(receipt['steps']),'passedSteps':sum(step.get('status')==0 for step in results),'failedSteps':[{'id':step['id'],'status':step.get('status')} for step in results if step.get('status') not in [0]],'complete':receipt['complete'],'ok':receipt.get('ok'),'unchanged':receipt.get('unchanged')})
 except json.JSONDecodeError:q['receiptWriting']=True
p=r/'records-affected.log';s=p.read_text(errors='replace') if p.exists() else ''
q['reportedFailures']=re.findall(r'^(?:test .* [.][.][.] FAILED|test result: FAILED.*|-- client file FAIL.*)$',s,re.M)[-5:]
q['phase']=re.findall(r'^== [^\n]+$',s,re.M)[-1:]
if '\n== client-tests\n' in s:
 section=s.split('\n== client-tests\n',1)[1].split('\n== client-models\n',1)[0]
 q['ordinaryClientFilesPassed']=len(re.findall(r'^-- client file ok:',section,re.M))
 if paths and 'receipt' in locals():
  step=next(step for step in receipt['steps'] if step['id']=='client-tests')
  q['ordinaryClientFileGoal']=len(step['argv'])-step['fileArgOffset']
q['recentResults']=re.findall(r'^(?:test result:.*|-- client file ok:.*|-- client files:.*|Receipt:.*)$',s,re.M)[-3:]
p=r/'records-affected.exit';q['exit']=p.read_text().strip() if p.exists() else None
state=subprocess.run(['systemctl','--user','show','sb4-pub52-records-final-checks.service','-p','ActiveState','-p','MemoryCurrent'],capture_output=True,text=True).stdout
q['unit']=state.splitlines()
(r/'records-check-latest.json').write_text(json.dumps(q,indent=2)+'\n')
with (r/'records-check-progress.jsonl').open('a') as f:f.write(json.dumps(q)+'\n')
print(json.dumps(q,indent=2))
