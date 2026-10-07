import argparse, json, pathlib, subprocess, sys
sb4 = pathlib.Path(__file__).resolve().parents[4]
out = sb4 / 'reports/20261007-fl-dry-run-flakes/round-8/evidence'
parser=argparse.ArgumentParser();parser.add_argument('--rounds',type=int,default=40)
parser.add_argument('--log',default='queue-edge-highload.log')
args=parser.parse_args();rounds=args.rounds
assert 1 <= rounds <= 40
fixture=sb4/f'packages/snapback4/test/.fl-r8-queue-edge-{__import__("os").getpid()}.test.mjs'
fixture.write_text((sb4/'packages/snapback4/test/export-background.test.mjs').read_text())
burners=[]
code='import os,sys,threading; threading.Thread(target=lambda:(sys.stdin.read(),os._exit(0)),daemon=True).start()\nwhile True: pass'
script="""import{runFile,fileStallTimeout}from'./scripts/run-client-tests.mjs';
let next=1,failed=false;
async function worker(){while(!failed&&next<=ROUNDS){const n=next++;const r=await runFile(FIXTURE,{timeout:fileStallTimeout('export-background.test.mjs'),nodeArgs:['--test-name-pattern=skipped maintenance never blocks publication and drains under SIGTERM|retention cannot remove a run between directory creation']});console.log('DIAGNOSTIC_RESULT '+JSON.stringify({n,...r}));if(!r.passed)failed=true}}
await Promise.all([worker(),worker()]);process.exitCode=failed?1:0;"""
script=script.replace('ROUNDS',str(rounds)).replace('FIXTURE',json.dumps(str(fixture.relative_to(sb4))))
try:
    for _ in range(8):burners.append(subprocess.Popen(['taskset','-c','80-87',sys.executable,'-c',code],stdin=subprocess.PIPE))
    with (out/args.log).open('w') as log:
        result=subprocess.run(['taskset','-c','80-87','node','--input-type=module','-e',script],cwd=sb4,stdout=log,stderr=subprocess.STDOUT)
    print('diagnostic status',result.returncode)
finally:
    for p in burners:p.stdin.close()
    for p in burners:p.wait()
    print('owned diagnostic loops reaped',all(p.returncode==0 for p in burners))
    fixture.unlink()
sys.exit(result.returncode)
