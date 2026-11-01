from pathlib import Path
import json,shutil,re
r=Path.home()/'sb4-pub-0452-records';w=Path.home()/'sb4-pub-0441'
p=json.loads((r/'release-affected-plan.json').read_text());files=sorted((w/'target/affected').glob(p['head'][:12]+'-*.json'));q=json.loads(files[-1].read_text())
results=q['results'];failed=[x['id'] for x in results if x['status']!=0];step=q['steps'][len(results)]['id'] if len(results)<len(q['steps']) else 'complete'
print(json.dumps({'passed':sum(x['status']==0 for x in results),'total':len(q['steps']),'current':step,'failed':failed,'complete':q['complete'],'freeGiB':shutil.disk_usage(w).free//2**30,'rawFailedFiles':re.findall(r'^-- client file FAIL: ([^\n]+)',(r/'release-affected.log').read_text(),re.M),'tail':(r/'release-affected.log').read_text()[-250:]}))
