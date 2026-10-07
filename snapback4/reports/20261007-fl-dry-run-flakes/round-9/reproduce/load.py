#!/usr/bin/env python3
"""Confine 20 primary/capture rounds and only our busy loops to CPUs 80–87."""
import concurrent.futures, hashlib, json, pathlib, subprocess, sys, time

sb4 = pathlib.Path(__file__).resolve().parents[4]
out = sb4 / 'reports/20261007-fl-dry-run-flakes/round-9/evidence'
sources = list((sb4/'scripts').glob('test-*.mjs')) + [sb4/'scripts/run-client-tests.mjs']
sources += [sb4/'packages/snapback4/test'/name for name in ['test-processes.test.mjs', 'test-signals.test.mjs']]
sources += list((sb4/'packages/snapback4/test/helpers').glob('*.mjs'))
def snapshot(): return {str(p.relative_to(sb4)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sources}
before = snapshot()
burners, results = [], []
script = """import assert from 'node:assert/strict';import{runFile}from'./scripts/run-client-tests.mjs';
for(const [name,pattern,count]of[['test-processes','real runner CLI',1],['test-signals','newborn command capture|persistent empty cmdline|native identity leaf',7]]){
 const result=await runFile('packages/snapback4/test/'+name+'.test.mjs',{nodeArgs:['--test-name-pattern='+pattern]});
 console.log('LOADED_RESULT '+JSON.stringify(result));assert.equal(result.passed,true);assert.equal(result.counts.pass,count);assert.equal(result.counts.fail,0);
 assert.equal(result.keeperExit.cleanupAcknowledged,true);
}"""
def run(n):
    with (out/f'loaded-{n:02}.log').open('w') as log:
        result=subprocess.run(['taskset','-c','80-87','node','--input-type=module','-e',script],cwd=sb4,stdout=log,stderr=subprocess.STDOUT)
    row=dict(round=n,status=result.returncode);print(json.dumps(row),flush=True);return row
start=time.time()
try:
    code='import os,sys,threading; threading.Thread(target=lambda:(sys.stdin.read(),os._exit(0)),daemon=True).start()\nwhile True: pass'
    for _ in range(8):burners.append(subprocess.Popen(['taskset','-c','80-87',sys.executable,'-c',code],stdin=subprocess.PIPE))
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(run,range(1,21)))
finally:
    for child in burners:child.stdin.close()
    for child in burners:child.wait()
    unchanged=before==snapshot()
    summary=dict(cpus='80-87',busyLoops=8,concurrentJobs=2,rounds=results,sourceHashes=before,
                 sourcesUnchanged=unchanged,loopsReaped=all(p.returncode==0 for p in burners),seconds=round(time.time()-start,2))
    (out/'loaded-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
assert unchanged
assert len(results)==20 and all(r['status']==0 for r in results)
