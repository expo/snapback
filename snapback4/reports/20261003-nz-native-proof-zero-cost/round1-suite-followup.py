"""Retain the first complete suite, then rerun after the guide-only correction."""
import json, os, subprocess, time
from round1 import ROOT, OUT, write

while True:
    stages = json.loads((OUT/'tail-stages.json').read_text())
    if stages[-1]['label'] == 'full-suite' and stages[-1]['state'] == 'complete': break
    time.sleep(1)
command = ['bash', 'snapback4/scripts/test.sh']
log = '/tmp/sb4-nz-r1-full-suite-final.log'
record = dict(command=command, log=log, startedAt=time.time(), state='running',
              reason='Guide-only correction after the first full suite; no measurement/runtime implementation changes.')
write(OUT/'suite-followup.json', record)
environment = dict(os.environ, LIBSQLITE3_FLAGS='-USQLITE_ENABLE_MEMORY_MANAGEMENT')
environment.pop('SNAPBACK4_BIN', None)
start = time.monotonic()
with open(log, 'w') as f:
    result = subprocess.run(command, cwd=ROOT.parent, env=environment, stdout=f, stderr=f)
record.update(state='complete', status=result.returncode, seconds=time.monotonic()-start, finishedAt=time.time())
write(OUT/'suite-followup.json', record)
print(json.dumps(record), flush=True)
raise SystemExit(result.returncode)
