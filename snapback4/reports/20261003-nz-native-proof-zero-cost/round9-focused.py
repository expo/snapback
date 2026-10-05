"""Run the final affected checks on this mini, binding their source inputs."""
import argparse, hashlib, json, os, pathlib, subprocess, time
from measure import ROOT, REPORT, retain, snapshot

out = REPORT/'round9'
out.mkdir(exist_ok=True)
parser=argparse.ArgumentParser()
parser.add_argument('--record',default='focused.json')
parser.add_argument('--scope',choices=['all','maintenance'],default='all')
args=parser.parse_args()
record = out/args.record
assert not record.exists(), 'retain earlier attempts; never overwrite'
env = dict(os.environ, LIBSQLITE3_FLAGS='-USQLITE_ENABLE_MEMORY_MANAGEMENT', SNAPBACK4_SMOKE_DEVICE_PREFIX='sb4-nz-')
node = str(pathlib.Path.home()/'.volta/tools/image/node/24.18.0/bin')
env['PATH'] = node+':'+env['PATH']
paths = subprocess.check_output(['git','diff','--name-only','HEAD'],cwd=ROOT.parent,text=True).splitlines()
inputs = [dict(path=p,sha256=hashlib.sha256((ROOT.parent/p).read_bytes()).hexdigest()) for p in paths if '/crates/' in p or '/packages/' in p]
checks = [
 ('build',['cargo','build','-p','snapback4','--bin','snapback4']),
 ('witness-unit',['cargo','test','-p','snapback4','--bin','snapback4','witness','--','--test-threads=1']),
 ('witness-integration',['cargo','test','-p','snapback4','--test','witness','--','--test-threads=1']),
 ('export',['node','--test',*[f'packages/snapback4/test/{n}.test.mjs' for n in ['export-background','export-native','export-native-round2','export-publication','export-failure','witness-preparation']]])
]
if args.scope=='maintenance': checks=[c for c in checks if c[0]!='witness-integration']
state = dict(scope=args.scope,base=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT.parent,text=True).strip(),state='running',startedAt=time.time(),before=snapshot(),inputs=inputs,checks=[])
def save(): record.write_text(json.dumps(state,indent=2)+'\n')
save()
for label, command in checks:
    log=pathlib.Path(f'/tmp/sb4-nz-r9-{record.stem}-{label}.log')
    start=time.monotonic()
    with log.open('w') as stream:
        result=subprocess.run(command,cwd=ROOT,env=env,stdout=stream,stderr=stream)
    row=dict(label=label,command=command,status=result.returncode,durationSeconds=time.monotonic()-start,evidence=retain(log))
    state['checks'].append(row);save();print(json.dumps(row),flush=True)
state.update(state='finished',finishedAt=time.time(),after=snapshot(),inputsUnchanged=all(hashlib.sha256((ROOT.parent/p['path']).read_bytes()).hexdigest()==p['sha256'] for p in inputs))
state['status']=int(any(x['status'] for x in state['checks']) or not state['inputsUnchanged'])
save();raise SystemExit(state['status'])
