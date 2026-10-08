#!/usr/bin/env python3
"""Retain round-6 commands, exit statuses, timing and output without environment dumps."""
import datetime
import json
from pathlib import Path
import subprocess
import sys
import time

here = Path(__file__).resolve().parent
workspace = here.parents[1]
name, *command = sys.argv[1:]
assert name and '/' not in name and command
out = here / 'evidence'
out.mkdir(exist_ok=True)
started = datetime.datetime.now(datetime.timezone.utc).isoformat()
tick = time.monotonic()
with (out / f'{name}.log').open('w') as log:
    result = subprocess.run(command, cwd=workspace, stdout=log, stderr=subprocess.STDOUT)
receipt = dict(command=command, cwd=str(workspace), started=started,
               elapsedSeconds=time.monotonic() - tick, exitCode=result.returncode)
(out / f'{name}.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(dict(name=name, **receipt)), flush=True)
sys.exit(result.returncode)
