"""Run the Round 9 full Mac suite once, retaining its exact inputs and outcome."""
import argparse, hashlib, json, os, pathlib, subprocess, time
from measure import ROOT, REPORT, retain, snapshot

OUT = REPORT/'round9'
OUT.mkdir(exist_ok=True)
parser=argparse.ArgumentParser()
parser.add_argument('--record',default='full-suite.json')
parser.add_argument('--log',default='/tmp/sb4-nz-r9-full-suite.log')
parser.add_argument('--after')
args=parser.parse_args()
record_path = OUT/args.record
if args.after:
    while json.loads((OUT/args.after).read_text()).get('state')!='finished': time.sleep(2)
    prerequisite=json.loads((OUT/args.after).read_text())
    assert prerequisite['status']==0 and prerequisite['inputsUnchanged'], 'affected qualification must pass first'
assert not record_path.exists(), 'retain earlier attempts; never overwrite one'
def write(path, value):
    path.write_text(json.dumps(value, indent=2)+'\n')
env = dict(os.environ, LIBSQLITE3_FLAGS='-USQLITE_ENABLE_MEMORY_MANAGEMENT', SNAPBACK4_SMOKE_DEVICE_PREFIX='sb4-nz-')
node = str(pathlib.Path.home()/'.volta/tools/image/node/24.18.0/bin')
env['PATH'] = node+':'+':'.join(p for p in env['PATH'].split(':') if p != node)
paths = subprocess.check_output(['git','diff','--name-only','HEAD'], cwd=ROOT.parent,text=True).splitlines()
paths += subprocess.check_output(['git','ls-files','--others','--exclude-standard'],cwd=ROOT.parent,text=True).splitlines()
inputs = [dict(path=p,sha256=hashlib.sha256((ROOT.parent/p).read_bytes()).hexdigest()) for p in paths if '/crates/' in p or '/packages/' in p]
write(OUT/(record_path.stem+'-inputs.json'),inputs)
log = pathlib.Path(args.log)
record = dict(command='LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash snapback4/scripts/test.sh',
    base=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT.parent,text=True).strip(),
    state='running', startedAt=time.time(), node=node, log=str(log), before=snapshot())
write(record_path, record)
start=time.monotonic()
with log.open('w') as stream:
    result=subprocess.run(['bash','snapback4/scripts/test.sh'],cwd=ROOT.parent,env=env,stdout=stream,stderr=stream)
record.update(state='finished',status=result.returncode,finishedAt=time.time(),durationSeconds=time.monotonic()-start,after=snapshot(),evidence=retain(log))
record['inputsUnchanged']=all(hashlib.sha256((ROOT.parent/p['path']).read_bytes()).hexdigest()==p['sha256'] for p in inputs)
write(record_path,record)
print(json.dumps({k:record[k] for k in ['state','status','durationSeconds','inputsUnchanged']}),flush=True)
raise SystemExit(result.returncode)
