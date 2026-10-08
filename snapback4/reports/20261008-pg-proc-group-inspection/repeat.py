#!/usr/bin/env python3
"""Bounded lane-local evidence. Only retained child handles receive signals."""
import argparse
import gzip
import json
import os
from pathlib import Path
import subprocess
import time

p = argparse.ArgumentParser()
p.add_argument('--label', required=True)
p.add_argument('--rounds', type=int, default=30)
p.add_argument('--cpus', default='88-91')
p.add_argument('--stop-on-refusal', action='store_true')
p.add_argument('command', nargs=argparse.REMAINDER)
a = p.parse_args()
command = a.command[1:] if a.command[0] == '--' else a.command
root = Path(__file__).resolve().parent
out = root / a.label
out.mkdir(exist_ok=False)
children, logs, results = [], [], []
try:
    for i in range(6):
        children.append(subprocess.Popen(['taskset', '-c', a.cpus, 'python3', '-c', 'while True: pass']))
    for i in range(2):
        log = (out / f'churn-{i}.log').open('wb')
        logs.append(log)
        children.append(subprocess.Popen(['taskset', '-c', a.cpus, str(root / 'churn')], stdout=log))
    for n in range(1, a.rounds + 1):
        start = time.monotonic()
        path = out / f'{n:03}.log'
        with path.open('wb') as log:
            child = subprocess.Popen(['taskset', '-c', a.cpus, *command], stdout=log, stderr=subprocess.STDOUT)
            code = child.wait()
        raw = path.read_bytes()
        with gzip.open(str(path) + '.gz', 'wb') as archive:
            archive.write(raw)
        path.unlink()
        result = dict(round=n, status=code, seconds=round(time.monotonic()-start, 3),
                      refusal=b'procEvidence=' in raw)
        results.append(result)
        print(json.dumps(result), flush=True)
        if a.stop_on_refusal and result['refusal']:
            break
finally:
    for child in children:
        child.terminate()
    for child in children:
        child.wait()
    for log in logs:
        log.close()
    (out / 'summary.json').write_text(json.dumps(dict(command=command, cpus=a.cpus,
        load_pids=[c.pid for c in children], load_reaped=all(c.returncode is not None for c in children),
        results=results), indent=2) + '\n')
