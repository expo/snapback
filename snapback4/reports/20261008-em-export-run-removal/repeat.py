#!/usr/bin/env python3
"""Thirty forced deletion orderings under CPU contention, using only owned load."""
import gzip,json,os,subprocess,time
from pathlib import Path
out=Path(__file__).resolve().parent;workspace=out.parents[1]
cpus=','.join(map(str,sorted(os.sched_getaffinity(0))[-2:]))
prefix=['taskset','-c',cpus]
workers=[];rows=[]
os.umask(0o077)
env={**os.environ,'SNAPBACK4_EXPORT_TEST_BINARY':str(workspace/'target/em-r11-final/debug/snapback4'),'SNAPBACK4_MAINTENANCE_EVIDENCE':str(out/'repeat-snapshots')}
cmd=prefix+['node','--test','--test-name-pattern=failed export removal|shell repair cannot','packages/snapback4/test/export-background.test.mjs']
try:
 workers=[subprocess.Popen(prefix+['python3','-c','while True: pass'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL) for _ in range(4)]
 for n in range(1,31):
  start=time.monotonic();p=subprocess.run(cmd,cwd=workspace,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
  (out/f'repeat-{n:02}.log.gz').write_bytes(gzip.compress(p.stdout,mtime=0))
  rows.append(dict(run=n,exitCode=p.returncode,seconds=time.monotonic()-start))
  print(json.dumps(rows[-1]),flush=True)
  if p.returncode:break
finally:
 for p in workers:p.terminate()
 for p in workers:p.wait()
 (out/'repeat.json').write_text(json.dumps(dict(command=cmd,cpus=cpus,loadPids=[p.pid for p in workers],reaped=True,runs=rows),indent=2)+'\n')
assert len(rows)==30 and all(r['exitCode']==0 for r in rows)
