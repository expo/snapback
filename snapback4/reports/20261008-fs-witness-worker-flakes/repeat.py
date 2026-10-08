#!/usr/bin/env python3
"""Lane-local stress evidence; signals only children created by this invocation."""
import argparse
import concurrent.futures
import gzip
import json
import os
from pathlib import Path
import subprocess
import time

p = argparse.ArgumentParser()
p.add_argument('--label', required=True)
p.add_argument('--rounds', type=int, default=30)
p.add_argument('--jobs', type=int, default=2)
p.add_argument('--cpus', default='72,73')
p.add_argument('--load', type=int, default=6)
p.add_argument('--timeout', type=int, default=900)
p.add_argument('command', nargs=argparse.REMAINDER)
a = p.parse_args()
command = a.command[1:] if a.command[0] == '--' else a.command
out = Path(__file__).resolve().parent / a.label
out.mkdir(exist_ok=True)
busy = []
results = []

def run(n):
    start = time.monotonic()
    with (out / f'{n:03}.log').open('wb') as log:
        child = subprocess.Popen(['taskset', '-c', a.cpus, *command], stdout=log, stderr=subprocess.STDOUT)
        try:
            code = child.wait(timeout=a.timeout)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait()
            code = 'timeout'
    path = out / f'{n:03}.log'
    with gzip.open(str(path) + '.gz', 'wb') as archive:
        archive.write(path.read_bytes())
    path.unlink()
    result = dict(round=n, status=code, seconds=round(time.monotonic()-start, 3))
    print(json.dumps(result), flush=True)
    return result

try:
    for _ in range(a.load):
        busy.append(subprocess.Popen(['taskset', '-c', a.cpus, 'python3', '-c', 'while True: pass']))
    with concurrent.futures.ThreadPoolExecutor(max_workers=a.jobs) as pool:
        results = list(pool.map(run, range(1, a.rounds+1)))
finally:
    for child in busy:
        child.terminate()
    for child in busy:
        child.wait()
    (out / 'summary.json').write_text(json.dumps(dict(command=command, cpus=a.cpus,
        busy_pids=[c.pid for c in busy], busy_reaped=all(c.returncode is not None for c in busy),
        jobs=a.jobs, results=results), indent=2)+'\n')
