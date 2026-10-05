#!/usr/bin/env python3
"""Run the complete retention file 30 times beside one owned CPU hog."""
import json, os, subprocess, time
from pathlib import Path
root = Path(__file__).resolve().parents[3]
out = Path(__file__).resolve().parent
started = time.time()
# Inherit the intended mask even before taskset has execed in the child.
os.sched_setaffinity(0, {64, 65, 66, 67})
hog = subprocess.Popen(['taskset', '-c', '64-67', 'node', '-e', 'while (true) {}'], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
results = []
try:
    for number in range(1, 31):
        before = time.time()
        assert hog.poll() is None
        assert os.sched_getaffinity(hog.pid) == {64, 65, 66, 67}
        with (out / f'stress-{number:02}.log').open('w') as log:
            run = subprocess.run(['taskset', '-c', '64-67', 'node', '--test', '--test-concurrency=3', 'packages/snapback4/test/retained-history.test.mjs', 'packages/snapback4/test/retained-history-cut.test.mjs', 'packages/snapback4/test/retained-search-order.test.mjs', 'packages/snapback4/test/retained-history-order.test.mjs'], cwd=root, stdout=log, stderr=subprocess.STDOUT)
        results.append({'run': number, 'exit': run.returncode, 'seconds': round(time.time()-before, 3), 'hog_alive': hog.poll() is None})
        (out / 'stress.json').write_text(json.dumps({'cpus':[64,65,66,67], 'hog_pid':hog.pid, 'elapsed_seconds':round(time.time()-started,3), 'runs':results}, indent=2)+'\n')
        print(json.dumps(results[-1]), flush=True)
finally:
    hog.terminate()
    hog.wait()
