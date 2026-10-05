#!/usr/bin/env python3
"""Alternate traced replay and upload tests across confined load cells.
Launch with taskset/confine.py. LU_LABELS selects output folders from replay-build;
LU_LEVELS, LU_RUNS, LU_UPLOAD_RUNS and LU_TAG set the cell/run/output names.
Each original replay deadline (60 s) and upload socket timeout (3 s) is unchanged.
"""
from pathlib import Path
import json,os,subprocess,time,sys,re,collections,signal
root=Path(__file__).resolve().parents[3];tools=Path(__file__).resolve().parent;out=root/'target/lu-r2'
assert len(os.sched_getaffinity(0))==10
labels=os.environ.get('LU_LABELS','prelu,main').split(',');levels=list(map(int,os.environ.get('LU_LEVELS','0,20,120').split(',')));runs=int(os.environ.get('LU_RUNS','5'));uploads=int(os.environ.get('LU_UPLOAD_RUNS','10'));tag=os.environ.get('LU_TAG','comparison')
results=[]
def run(label,shape,load,trial):
 directory=out/label;path=out/f'{tag}-{label}-{shape}-{load}-{trial}.log'
 test='replay_delivers_900_followers_promptly_after_commit_without_schedules' if shape=='replay' else 'serve::tests::upload_disk_work_is_bounded_and_does_not_hold_the_query_engine'
 exe=directory/('replay-test' if shape=='replay' else 'unit-test')
 start=time.monotonic();started=time.time()*1000
 with path.open('w') as f:
  p=subprocess.Popen([str(exe),test,'--exact','--nocapture','--test-threads=1'],cwd=root,env={**os.environ,'LU_SERVER':str(directory/'server')},stdout=f,stderr=subprocess.STDOUT,start_new_session=True)
  try:code=p.wait(timeout=240)
  except subprocess.TimeoutExpired:
   # Test child Drop owns its server; timeout is a runner error, not a latency sample.
   os.killpg(p.pid,signal.SIGTERM);code=p.wait(timeout=30);raise RuntimeError(f'runner timeout; inspect owned fixture children for PID {p.pid}')
 end=time.monotonic();s=path.read_text();events=[]
 for line in s.splitlines():
  pos=line.find('LU {')
  if pos>=0:
   try:events.append(json.loads(line[pos+3:]))
   except json.JSONDecodeError:pass
 commits=[e for e in events if e['stage']=='commit'];commit=commits[-1]['at'] if commits else None
 slices=[e for e in events if e['stage']=='delivery' and (commit is None or e['at']>=commit)]
 live=[e for e in slices if e['kind']=='delivery'];done=next((e['at'] for e in live if e['done']),None)
 pauses=[e for e in events if e['stage']=='pause' and commit is not None and e['at']>=commit and (done is None or e['at']<=done)]
 copied=0;last_copy=None
 for e in live:
  copied+=max(0,e['rows']-1)
  if copied>=900 and last_copy is None:last_copy=e['at']
 row={'copied':copied,'last_copy':last_copy,'last_copy_ms':None if last_copy is None else last_copy-commit,'label':label,'shape':shape,'burners':load,'trial':trial,'exit':code,'wall_ms':(end-start)*1000,'started':started,'host_load':os.getloadavg(),'commit':commit,'delivery_done':done,'delivery_ms':None if done is None else done-commit,'test_ms':None,'first_live_ms':None if not live else live[0]['at']-commit,'turns':len(slices),'turns_by_kind':dict(collections.Counter(e['kind'] for e in slices)),'live_rows':dict(collections.Counter(e['rows'] for e in live)),'pause_decisions':len(pauses),'nonzero_pause_decisions':sum(e['pause_ms']>0 for e in pauses),'requested_pause_ms':sum(e['pause_ms'] for e in pauses),'cpu_ms':sum(e['cpu_ms'] for e in pauses),'log':str(path.relative_to(root))}
 m=re.search(r'followers=900 wall_ms=(\d+)',s)
 if m:row['test_ms']=int(m[1])
 results.append(row);(out/f'{tag}.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(row),flush=True)
for load in levels:
 keeper=None
 try:
  if load:
   keeper=subprocess.Popen([sys.executable,str(tools/'load.py'),str(load)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True,start_new_session=True)
   assert keeper.stdout.readline().strip()=='ready';time.sleep(2)
  for trial in range(runs):
   for label in labels[::1 if trial%2==0 else -1]:run(label,'replay',load,trial)
  for trial in range(uploads):
   for label in labels[::1 if trial%2==0 else -1]:run(label,'upload',load,trial)
 finally:
  if keeper:
   keeper.stdin.close();keeper.wait(timeout=30)
