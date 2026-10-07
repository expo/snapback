"""Twenty complete dev_refusals runs sharing two CPUs with four busy loops."""
import subprocess, pathlib, time, json, os, re, hashlib
root=pathlib.Path.cwd();out=root/'reports/20261007-fl-dry-run-flakes/round-1/evidence'
env={**os.environ,'LIBSQLITE3_FLAGS':'-USQLITE_ENABLE_MEMORY_MANAGEMENT','CARGO_BUILD_JOBS':'6'}
built=subprocess.run(['cargo','test','-p','snapback4','--test','dev_refusals','--no-run','--message-format=json'],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
(out/'loaded-build.log').write_text(built.stderr);assert built.returncode==0,built.stderr
artifacts=[json.loads(s) for s in built.stdout.splitlines() if s.startswith('{')]
binary=next(x['executable'] for x in artifacts if x.get('reason')=='compiler-artifact' and x.get('target',{}).get('name')=='dev_refusals' and x.get('executable'))
cpus='80,81';load=[];records=[]
source=root/'crates/snapback4/tests/dev_refusals.rs';digest=hashlib.sha256(source.read_bytes()).hexdigest()
try:
 for _ in range(4):load.append(subprocess.Popen(['taskset','-c',cpus,'python3','-c','while True: pass'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL))
 print(json.dumps({'cpus':cpus,'busyLoops':len(load),'ownedLoadPids':[p.pid for p in load]}),flush=True)
 with (out/'loaded-runs.log').open('w') as log:
  for i in range(1,21):
   start=time.monotonic()
   r=subprocess.run(['taskset','-c',cpus,binary,'--test-threads=2'],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=180)
   counts=re.search(r'test result: (\w+)\. (\d+) passed; (\d+) failed;',r.stdout)
   row={'round':i,'exit':r.returncode,'seconds':round(time.monotonic()-start,3),'passed':int(counts[2]) if counts else None,'failed':int(counts[3]) if counts else None}
   records.append(row);print(json.dumps(row),flush=True);log.write(json.dumps(row)+'\n'+r.stdout+'\n');log.flush()
finally:
 for p in load:p.terminate()
 for p in load:p.wait()
 summary={'cpus':cpus,'busyLoops':4,'sourceSha256':digest,'sourceUnchanged':hashlib.sha256(source.read_bytes()).hexdigest()==digest,'runs':records,'loadReaped':all(p.poll() is not None for p in load)}
 (out/'loaded-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
assert len(records)==20 and summary['sourceUnchanged']
raise SystemExit(any(r['exit'] for r in records))
