#!/usr/bin/env python3
"""Ten fixed client repetitions with an owned CPU hog; launch with taskset/confine.py."""
import json, os, signal, subprocess, time
from pathlib import Path

root = Path(__file__).resolve().parents[2]
out = root / os.environ.get('OP_STRESS_OUT', 'target/op/round2/stress')
out.mkdir(exist_ok=True)
first = int(os.environ.get('OP_STRESS_FIRST', '1'))
last = int(os.environ.get('OP_STRESS_LAST', '10'))
assert 1 <= first <= last <= 30
cpus = sorted(os.sched_getaffinity(0))
assert len(cpus) == 4
files = [
    'local-reads', 'read-observation', 'prediction-routing', 'following-routing',
    'ephemeral-routing', 'observation-publication', 'observation-publication-live',
    'retained-history', 'retained-history-cut', 'retained-history-order',
    'retained-search-order', 'live-propagation', 'live-propagation-fallback',
    'subscription-pressure-scopes', 'answers-stay-round2', 'answers-stay-round3',
    'per-row-inflight', 'per-row-boundaries',
    'composed-authority', 'answer-row-authority', 'subscription-pressure-authority',
    'keep-authority', 'page-authority',
    'query-publication-session', 'per-row-publication', 'keep-observation',
    'page-observation', 'row-view-prediction', 'server-clock-live',
]
command = ['node', '--test', '--test-concurrency=3',
           *[f'packages/snapback4/test/{name}.test.mjs' for name in files]]
started, results = time.time(), []
stopping = False
def stop(_signal, _frame):
    global stopping
    stopping = True
signal.signal(signal.SIGUSR1, stop) # Finish this repetition, then reap our hog.
hog = subprocess.Popen(['node', '-e', 'while (true) {}'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for number in range(first, last + 1):
        assert hog.poll() is None and sorted(os.sched_getaffinity(hog.pid)) == cpus
        before = time.time()
        with (out / f'{number:02}.log').open('w') as log:
            run = subprocess.run(command, cwd=root, stdout=log, stderr=subprocess.STDOUT)
        results.append(dict(run=number, exit=run.returncode, seconds=round(time.time()-before, 3), hog_alive=hog.poll() is None))
        (out / 'results.json').write_text(json.dumps(dict(cpus=cpus, command=command, hog_pid=hog.pid,
            seconds=round(time.time()-started, 3), runs=results), indent=2)+'\n')
        print(json.dumps(results[-1]), flush=True)
        if stopping:
            break
finally:
    hog.terminate(); hog.wait()
raise SystemExit(any(r['exit'] for r in results))
