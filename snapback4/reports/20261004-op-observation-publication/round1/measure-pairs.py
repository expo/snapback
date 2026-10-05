import os,subprocess,json,time
from pathlib import Path
root=Path.cwd(); out=root/'target/op/round1'; runs=[]
for pair,order in enumerate([['r0','r1'],['r1','r0'],['r0','r1']],1):
 for revision in order:
  name=f'pair{pair}-{revision}'; env=dict(os.environ,SNAPBACK4_BIN='target/lu-op',LU_SDK='target/op/'+('sdk-final4' if revision=='r0' else 'sdk-r1-final')+'/dist',LU_LABEL='op-round1-'+name,LU_RUNS='30',LU_HISTORY='1000',LU_REFOLLOW='1',LU_LEVELS='0',LU_OUT=str(out/(name+'.json')))
  start=time.time()
  with (out/(name+'.log')).open('w') as log:
   run=subprocess.Popen(['taskset','-c','17-19,23-24,65-67,71-72','python3','reports/20261003-lu-live-update-latency/tools/confine.py','node','reports/20261003-lu-live-update-latency/tools/measure.mjs'],env=env,stdout=log,stderr=subprocess.STDOUT)
   (out/'measurement-active.json').write_text(json.dumps({'pid':run.pid,'name':name}))
   time.sleep(5)
   audit=subprocess.run(['python3','reports/20261003-lu-live-update-latency/tools/audit-affinity.py',str(run.pid),'17-19,23-24,65-67,71-72'],capture_output=True,text=True)
   (out/(name+'.affinity.json')).write_text(audit.stdout or audit.stderr)
   status=run.wait()
  runs.append({'name':name,'exit':status,'affinity_exit':audit.returncode,'seconds':time.time()-start})
  (out/'pairs.json').write_text(json.dumps(runs,indent=2)); print(runs[-1],flush=True)
  if status:raise SystemExit(status)
  subprocess.run(['node','reports/20261003-lu-live-update-latency/tools/finalize.mjs',str(out/(name+'.json'))],check=True)
