from pathlib import Path
from datetime import datetime, timezone
import json
import os
import re
import subprocess
import sys

attempt = int(sys.argv[1]) if len(sys.argv) > 1 else 2
base = Path.home() / 'sb4-intent/0453'
out = base / 'linux-qualification-0.4.53'
state = {'time': datetime.now(timezone.utc).strftime('%H:%M:%SZ'), 'attempt': attempt}
for name in [f'run-{attempt}.exit', f'linux-{attempt}.exit']:
    path = base / 'records' / name
    if path.exists():
        state[name] = path.read_text().strip()
suite = out / 'suite.log'
if suite.exists():
    lines = suite.read_text().splitlines()
    state['sourceSummary'] = next((line for line in reversed(lines) if re.match(r'^== \d+ failure', line)), None)
    state['sourcePhase'] = next((line for line in reversed(lines) if line.startswith(('== ', '-- client file start:'))), None)
    state['clientSummaries'] = [line for line in lines if line.startswith('-- client files:')]
unit = f'sb4-pub53-linux-{attempt}.service'
raw = subprocess.run(['systemctl', '--user', 'show', unit, '-p', 'MainPID'], capture_output=True, text=True).stdout
main = int(raw.strip().partition('=')[2] or '0')
if main:
    rows = {}
    for line in subprocess.check_output(['ps', '-axo', 'pid,ppid'], text=True).splitlines()[1:]:
        pid, parent = map(int, line.split())
        rows[pid] = parent
    owned = {main}
    while True:
        enlarged = owned | {pid for pid, parent in rows.items() if parent in owned}
        if enlarged == owned:
            break
        owned = enlarged
    paths = set()
    for pid in owned:
        try:
            path = os.readlink(f'/proc/{pid}/fd/1')
            if path.startswith('/tmp/snapback4-test.') and path.endswith(('/client-tests.log', '/cargo-test.log')):
                paths.add(path)
        except OSError:
            pass
    for name in paths:
        try:
            text = Path(name).read_text()
            if name.endswith('/client-tests.log'):
                state['clientFilesDone'] = len(re.findall(r'^-- client file (?:ok|FAIL):', text, re.M))
                state['clientFailures'] = re.findall(r'^-- client file FAIL: (\S+)', text, re.M)
            else:
                state['rustExecutionsDone'] = len(re.findall(r'^-- rust target:', text, re.M))
                state['rustFailures'] = [line for line in text.splitlines() if line.startswith('-- FAIL:')]
        except OSError:
            pass
proofs = sorted(path.name for path in out.glob('*proof*.json'))
state['proofRecords'] = proofs
state['receipt'] = (out / 'receipt.json').exists()
print(json.dumps(state))
