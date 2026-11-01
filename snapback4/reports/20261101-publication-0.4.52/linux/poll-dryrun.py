from pathlib import Path
import subprocess,json,re
r=Path('/home/ccheever/sb4-pub-0452-records')
cmd=['ssh','-o','BatchMode=yes','-o','ConnectTimeout=10','-o','ServerAliveInterval=5','-o','ServerAliveCountMax=2','ccheever@charlies-macbook-pro-m5max-black','export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin; python3 ~/sb4-pub-0452/status-dryrun.py']
p=subprocess.run(cmd,text=True,capture_output=True,timeout=45)
if p.returncode: raise RuntimeError(f'own dry-run status SSH exit {p.returncode}')
q=json.loads(p.stdout)
(r/'mac-dry-latest.json').write_text(json.dumps(q,indent=2)+'\n')
with (r/'mac-dry-progress.jsonl').open('a') as f: f.write(json.dumps(q)+'\n')
history={}
for label,path in [('priorMac',Path('/home/ccheever/sb4-pub-0450-records/mac-pull/20261030-publication-0.4.50/attempt-2-publication-dry-run.log')),('qualifiedLinux',r/'linux-qualification-0.4.52/suite.log')]:
 if path.exists():
  times=dict(re.findall(r'^-- client file ok: ([^ ]+) \((\d+) ms\)$',path.read_text(),re.M))
  history[label]={f:round(int(times[f])/1000,1) for child in q.get('activeOwnedChildren',[]) if isinstance(child,dict) for f in child.get('testFiles',[]) if f in times}
print(json.dumps({'priorDurationSeconds':history} | {key:q.get(key) for key in ['at','power','percent','freeGiB','phases','stageExists','postSuiteRefreshCases','consumerMessages','activeOwnedChildren','dry-run-2.exit','dry-run-2.env-invalid']} | {'logs':[{key:s.get(key) for key in ['log','rustCompleted','clientFilesCompleted','recentClients','failures','summaries']} for s in q['outputs']]},indent=2))
