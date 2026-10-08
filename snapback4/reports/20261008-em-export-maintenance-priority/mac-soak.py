#!/usr/bin/env python3
"""Operator-run Darwin qualification. Pin this checkout's debug CLI; keep every run's evidence."""
import argparse,hashlib,json,os,shutil,subprocess,sys,time
from pathlib import Path

parser=argparse.ArgumentParser()
parser.add_argument('--out',required=True)
parser.add_argument('--runs',type=int,default=6)
args=parser.parse_args()
if sys.platform!='darwin':parser.error('run this on the operator-selected Mac, from a normal-priority shell')
if not 1<=args.runs<=30:parser.error('--runs must be between 1 and 30')
os.umask(0o077)
workspace=Path(__file__).resolve().parents[2]
out=Path(args.out).resolve();out.mkdir(parents=True,exist_ok=False)
binary=workspace/'target/debug/snapback4'
digest=hashlib.sha256(binary.read_bytes()).hexdigest()
pin=out/'binary'/digest/'snapback4';pin.parent.mkdir(parents=True);shutil.copy2(binary,pin);pin.chmod(0o700)
assert hashlib.sha256(pin.read_bytes()).hexdigest()==digest
records=[]
def run(name,command):
    started=time.monotonic()
    env={**os.environ,'SNAPBACK4_EXPORT_TEST_BINARY':str(pin),'SNAPBACK4_MAINTENANCE_EVIDENCE':str(out/(name+'-snapshots'))}
    # Fixtures opt in themselves; the production-policy case must remove it.
    env.pop('SNAPBACK4_TEST_EXPORT_NORMAL_PRIORITY',None)
    with (out/(name+'.log')).open('w') as log:
        result=subprocess.run(command,cwd=workspace,env=env,stdout=log,stderr=subprocess.STDOUT)
    record=dict(name=name,command=command,seconds=time.monotonic()-started,exitCode=result.returncode)
    records.append(record)
    (out/'results.json').write_text(json.dumps(dict(binarySha256=digest,source=subprocess.check_output(['git','rev-parse','HEAD'],cwd=workspace,text=True).strip(),runs=records),indent=2)+'\n')
    print(json.dumps(record),flush=True)
    return result.returncode

background='packages/snapback4/test/export-background.test.mjs'
if run('policy',['node','--test','--test-name-pattern=Darwin export launch policy',background]):
    raise SystemExit('policy preflight failed: inspect its log before soaking (debug build and normal-priority runner required)')
runner=['node','scripts/run-client-tests.mjs','1','files']
run('wakeup',runner+['packages/snapback4/test/export-maintenance-wakeup.test.mjs'])
run('diagnostics',runner+['packages/snapback4/test/maintenance-evidence.test.mjs'])
for n in range(1,args.runs+1):run(f'background-{n}',runner+[background])
raise SystemExit(int(any(r['exitCode'] for r in records)))
