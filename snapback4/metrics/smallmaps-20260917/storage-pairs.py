import os,json,subprocess,time,statistics
from pathlib import Path
root=Path.cwd();records=[]
for trial in range(7):
 for stage in (['before','after'] if trial%2==0 else ['after','before']):
  binary='target/d2/before/snapback4' if stage=='before' else 'target/debug/snapback4'
  command=['node','target/d2/measure-storage.mjs','4','100','4','--workloads']
  env=dict(os.environ,SNAPBACK4_BIN=str(root/binary),TMPDIR='/private/tmp/snapback4-d2-70a663c22')
  start=time.monotonic();r=subprocess.run(command,env=env,capture_output=True,text=True,timeout=180)
  (root/f'target/d2/storage-{trial}-{stage}.log').write_text(r.stdout+r.stderr)
  if r.returncode:raise RuntimeError(r.stdout+r.stderr)
  value=json.loads(r.stdout.strip().splitlines()[-1]);value.update(trial=trial,stage=stage,wall_s=time.monotonic()-start)
  records.append(value)
  Path('target/d2/paired-storage.json').write_text(json.dumps({'records':records},indent=2)+'\n')
  print(trial,stage,'seed',value['seedMs'],'p50',{k:v['p50Ms'] for k,v in value['measurements'].items()},flush=True)
medians={stage:{name:{metric:statistics.median(r['measurements'][name][metric] for r in records if r['stage']==stage) for metric in ['p50Ms','p95Ms']} for name in records[0]['measurements']} for stage in ['before','after']}
ratios={name:{metric:medians['after'][name][metric]/medians['before'][name][metric] for metric in ['p50Ms','p95Ms']} for name in medians['before']}
Path('target/d2/paired-storage.json').write_text(json.dumps({'records':records,'medians':medians,'ratios':ratios},indent=2)+'\n')
print(json.dumps({'medians':medians,'ratios':ratios},indent=2),flush=True)
