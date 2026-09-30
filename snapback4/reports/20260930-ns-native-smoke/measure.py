"""Capture one unchanged npm script invocation and shared-host load; no native assertions here."""
import json
import os
import pathlib
import subprocess
import sys
import time

report = pathlib.Path(__file__).resolve().parent
label, project = sys.argv[1:]
start = time.time()
samples = []
with (report / (label + '.log')).open('w') as log:
    child = subprocess.Popen(['npm', 'run', 'native:smoke'], cwd=project, stdout=log, stderr=subprocess.STDOUT)
    while True:
        samples.append({'at': time.time(), 'load': os.getloadavg()})
        try:
            status = child.wait(timeout=5)
            break
        except subprocess.TimeoutExpired:
            pass
elapsed = time.time() - start
result = {'command': ['npm', 'run', 'native:smoke'], 'cwd': project, 'pid': child.pid,
          'startedAt': start, 'durationSeconds': elapsed, 'status': status, 'samples': samples}
(report / (label + '.json')).write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({k: v for k, v in result.items() if k != 'samples'}))
sys.exit(status)
