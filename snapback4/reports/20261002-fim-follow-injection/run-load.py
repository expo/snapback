"""Run complete matrices concurrently; retain every TAP log and exit status."""
import concurrent.futures
import gzip
import json
import os
from pathlib import Path
import subprocess
import sys
import time

root, output = map(Path, sys.argv[1:3])
root = root.resolve()
output.mkdir(parents=True, exist_ok=True)
workers = len(os.sched_getaffinity(0))
started = time.time()
command = ['node', '--test', '--test-reporter=tap',
           'packages/snapback4/test/delivery-fault-matrix.test.mjs']

def run(index):
    begin = time.time()
    try:
        result = subprocess.run(command, cwd=root, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, timeout=1800)
        code, log = result.returncode, result.stdout
    except subprocess.TimeoutExpired as error:
        code, log = 124, (error.stdout or b'') + b'\nLOAD_RUNNER_TIMEOUT\n'
    with gzip.open(output / f'{index:03}.tap.gz', 'wb') as stream:
        stream.write(log)
    lines = log.decode(errors='replace').splitlines()
    return dict(index=index, exit=code, seconds=round(time.time() - begin, 3),
                failures=[line for line in lines if line.startswith('not ok')],
                summary=[line for line in lines if line.startswith(('# tests ', '# pass ', '# fail ', '# cancelled '))])

results = []
with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
    for result in pool.map(run, range(1, 201)):
        results.append(result)
        print(json.dumps(result), flush=True)
summary = dict(root=str(root), command=' '.join(command),
               concurrency=workers, runs=200, failed=sum(r['exit'] != 0 for r in results),
               started=started, seconds=round(time.time() - started, 3), results=results)
(output / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps({k: v for k, v in summary.items() if k != 'results'}), flush=True)
