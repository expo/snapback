import pathlib,json,time,subprocess,os
base=pathlib.Path('/home/ccheever/sb4-intent/lane-pw/snapback4')
evidence=base/'reports/20261005-pw-per-row-navigation/evidence'
while True:
 rows=[]
 for name in ['fixed-linux-a','fixed-linux-b']:
  rows += [json.loads(s) for s in (evidence/name/'receipts.jsonl').read_text().splitlines()]
 if len(rows)==60:
  if any(r['exit'] for r in rows):raise SystemExit('Full-file stress has a failure; inspect before full suite')
  break
 time.sleep(5)
# Darwin's final batch is independent and uses only the authorized file.
while True:
 r=subprocess.run(['ssh','-o','BatchMode=yes','ccheever@100.64.36.16','cat /tmp/sb4-pw.5NqQOL/final-full/receipts.jsonl'],capture_output=True,text=True)
 if r.returncode:raise SystemExit(r.stderr)
 rows=[json.loads(s) for s in r.stdout.splitlines()]
 if len(rows)==30:
  if any(x['exit'] for x in rows):raise SystemExit('Darwin final-file failure; inspect before full suite')
  break
 time.sleep(10)
def sample():
 return {int(x.split()[0][3:]):list(map(int,x.split()[1:])) for x in open('/proc/stat') if x.startswith('cpu') and x[3:4].isdigit()}
a=sample();time.sleep(3);b=sample();busy={}
for c in sorted(os.sched_getaffinity(0)):
 d=[y-x for x,y in zip(a[c],b[c])];busy[c]=round(100*(1-(d[3]+d[4])/sum(d)),2)
cpus=[c for c,v in busy.items() if v<5][:24]
if len(cpus)<12:raise SystemExit('Not enough sampled idle CPUs; reschedule')
(evidence/'full-suite-idle.json').write_text(json.dumps({'busyPercent':busy,'selected':cpus,'time':time.time()},indent=2)+'\n')
env=dict(os.environ,CARGO_INCREMENTAL='0',CARGO_PROFILE_DEV_DEBUG='0',CARGO_PROFILE_TEST_DEBUG='0',LIBSQLITE3_FLAGS='-USQLITE_ENABLE_MEMORY_MANAGEMENT',CARGO_BUILD_JOBS='16')
command=['taskset','-c',','.join(map(str,cpus)),'bash','scripts/test.sh']
record={'command':command,'start':time.time(),'flags':{k:env[k] for k in ['CARGO_INCREMENTAL','CARGO_PROFILE_DEV_DEBUG','CARGO_PROFILE_TEST_DEBUG','LIBSQLITE3_FLAGS','CARGO_BUILD_JOBS']}}
(evidence/'full-suite.json').write_text(json.dumps(record,indent=2)+'\n')
print('Starting canonical suite',command,flush=True)
with (evidence/'full-suite.log').open('w') as log:
 r=subprocess.run(command,cwd=base,env=env,stdout=log,stderr=subprocess.STDOUT)
record.update(exit=r.returncode,seconds=round(time.time()-record['start'],3))
(evidence/'full-suite.json').write_text(json.dumps(record,indent=2)+'\n');print(record,flush=True)
