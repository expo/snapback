import os,subprocess,time,json
from pathlib import Path
root=Path('/home/ccheever/projects/snapback-sb4loop/snapback4');out=Path('/home/ccheever/sb4-loop/reports/integration27')
cpus=sorted(os.sched_getaffinity(0))[-8:];aff=','.join(map(str,cpus));stress=[];rows=[]
env={**os.environ,'SNAPBACK4_TEST_SERIAL_CLIENT_FILES':'1','SNAPBACK4_BIN':str(out/'snapback4-candidate')}
try:
 for i in range(2*len(cpus)):stress.append(subprocess.Popen(['timeout','3600s','taskset','-c',aff,'python3','-c','while True: pass'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL))
 for i in range(10):
  start=time.monotonic()
  with (out/f'proof-load-{i+1}.log').open('w') as log:
   r=subprocess.run(['timeout','600s','taskset','-c',aff,'node','--test','packages/snapback4/test/proof.test.mjs'],cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT)
  row=dict(run=i+1,status=r.returncode,seconds=round(time.monotonic()-start,3));rows.append(row);print(json.dumps(row),flush=True)
finally:
 for child in stress:child.terminate()
 for child in stress:
  try:child.wait(timeout=5)
  except subprocess.TimeoutExpired:child.kill();child.wait()
 (out/'proof-load.json').write_text(json.dumps(dict(cpus=cpus,busyLoops=2*len(cpus),serialClientFiles=True,results=rows),indent=2))
