#!/usr/bin/env python3
import concurrent.futures, hashlib, json, pathlib, subprocess, sys
sb4 = pathlib.Path(__file__).resolve().parents[4]
out = sb4 / 'reports/20261007-fl-dry-run-flakes/round-8/evidence'
burners=[]
def run(n):
    with (out/f'loaded-final-parity-{n:02}.log').open('w') as log:
        result=subprocess.run(['taskset','-c','80-87','node','reports/20261007-fl-dry-run-flakes/round-8/reproduce/parity-final.mjs'],cwd=sb4,stdout=log,stderr=subprocess.STDOUT)
    print(n,result.returncode,flush=True)
    return dict(round=n,status=result.returncode)
try:
    code='import os,sys,threading; threading.Thread(target=lambda: (sys.stdin.read(), os._exit(0)), daemon=True).start()\nwhile True: pass'
    for _ in range(4): burners.append(subprocess.Popen(['taskset','-c','80-87',sys.executable,'-c',code],stdin=subprocess.PIPE))
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(run,range(1,21)))
finally:
    for p in burners:p.stdin.close()
    for p in burners:p.wait()
summary=dict(cpus='80-87',busyLoops=4,loopsReaped=all(p.returncode==0 for p in burners),rounds=results)
(out/'loaded-final-parity-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
assert all(r['status']==0 for r in results)
