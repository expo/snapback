"""Run a complete suite after a retained prior attempt has drained."""
import argparse, json, os, subprocess, time
from measure import ROOT, REPORT
from round1 import write
parser=argparse.ArgumentParser()
parser.add_argument('--after',default='full-suite.json')
parser.add_argument('--record',default='full-suite-final.json')
parser.add_argument('--log',default='/tmp/sb4-nz-r2-full-final.log')
args=parser.parse_args()
out=REPORT/'round2'
record=dict(command='LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash snapback4/scripts/test.sh',
    node='/Users/ccheever/.volta/tools/image/node/24.18.0/bin',log=args.log,state='waiting-for-prior-suite',priorRecord=args.after)
assert not (out/args.record).exists(), 'retain attempts rather than overwrite'
write(out/args.record,record)
while True:
    try: first=json.loads((out/args.after).read_text())
    except json.JSONDecodeError: first={}
    if first.get('state')=='finished': break
    time.sleep(2)
record.update(state='running',startedAt=time.time(),priorSuiteStatus=first['status'])
write(out/args.record,record)
env=dict(os.environ,LIBSQLITE3_FLAGS='-USQLITE_ENABLE_MEMORY_MANAGEMENT',SNAPBACK4_SMOKE_DEVICE_PREFIX='sb4-nz-')
env['PATH']=record['node']+os.pathsep+env.get('PATH','')
start=time.monotonic()
with open(record['log'],'w') as log:
    result=subprocess.run(['bash','snapback4/scripts/test.sh'],cwd=ROOT.parent,env=env,stdout=log,stderr=log)
record.update(state='finished',status=result.returncode,finishedAt=time.time(),durationSeconds=time.monotonic()-start)
write(out/args.record,record)
print(json.dumps(record),flush=True)
raise SystemExit(result.returncode)
