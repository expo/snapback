from pathlib import Path
from datetime import datetime, timezone
import json
import re
import subprocess

kit = Path.home() / 'sb4-pub-0453'
root = Path.home() / 'sb4-pub-0453-wt/snapback4'
state = {'time': datetime.now(timezone.utc).strftime('%H:%M:%SZ'), 'attempt': 1}
for name in ['dry-run-1.exit', 'dry-run-1.env-invalid']:
    path = kit / name
    if path.exists():
        state[name] = path.read_text().strip()
battery = subprocess.check_output(['/usr/bin/pmset', '-g', 'batt'], text=True)
state['ac'] = 'AC Power' in battery.splitlines()[0]
lid = subprocess.check_output(['/usr/sbin/ioreg', '-r', '-k', 'AppleClamshellState'], text=True)
state['lidOpen'] = '"AppleClamshellState" = No' in lid
log = root / 'reports/20261104-publication-0.4.53/attempt-1-publication-dry-run.log'
if log.exists():
    lines = log.read_text().splitlines()
    state['sourceSummary'] = next((line for line in reversed(lines) if re.match(r'^== \d+ failure', line)), None)
    state['phase'] = next((line for line in reversed(lines) if line.startswith(('== ', '-- client file start:'))), None)
    state['clientSummaries'] = [line for line in lines if line.startswith('-- client files:')]
    state['logTail'] = [line if len(line) <= 800 else line[:800] + ' [monitor display truncated; full line retained in original log]' for line in lines[-2:]]
cache = kit / 'mac-dry-worker-directory.txt'
directory = Path(cache.read_text().strip()) if cache.exists() else None
if directory is None:
    pid_file = kit / 'dry-run-1.pid'
    main = int(pid_file.read_text().strip()) if pid_file.exists() else 0
    rows = {}
    for line in subprocess.check_output(['ps', '-axo', 'pid,ppid,command'], text=True).splitlines()[1:]:
        fields = line.strip().split(None, 2)
        if len(fields) == 3:
            rows[int(fields[0])] = (int(fields[1]), fields[2])
    owned = {main}
    while True:
        enlarged = owned | {pid for pid, (parent, _) in rows.items() if parent in owned}
        if enlarged == owned:
            break
        owned = enlarged
    workers = [str(pid) for pid in owned if any(name in rows.get(pid, (0, ''))[1] for name in ['run-rust-tests.mjs', 'run-client-tests.mjs'])]
    if workers:
        result = subprocess.run(['/usr/sbin/lsof', '-a', '-p', ','.join(workers), '-d', '1', '-Fn'], capture_output=True, text=True)
        for line in result.stdout.splitlines():
            if line.startswith('n') and line.endswith(('/cargo-test.log', '/client-tests.log')):
                candidate = Path(line[1:]).parent
                if candidate.name.startswith('snapback4-test.') and candidate.is_dir():
                    directory = candidate
                    cache.write_text(str(directory) + '\n')
                    break
if directory is not None:
    for name in ['cargo-test.log', 'client-tests.log']:
        path = directory / name
        if not path.exists():
            continue
        text = path.read_text()
        if name == 'cargo-test.log':
            state['rustExecutionsDone'] = len(re.findall(r'^-- rust target:', text, re.M))
            state['rustFailures'] = [line for line in text.splitlines() if line.startswith('-- FAIL')]
        else:
            state['clientFilesDone'] = len(re.findall(r'^-- client file (?:ok|FAIL):', text, re.M))
            state['clientFailures'] = re.findall(r'^-- client file FAIL: (\S+)', text, re.M)
            state['clientCurrent'] = next((line for line in reversed(text.splitlines()) if line.startswith('-- client file start:')), None)
state['stagePresent'] = (root / 'target/publication/snapback4-darwin-arm64-0.4.53/resume.json').exists()
post = kit / 'refresh-npm-cache-a2d.out'
if post.exists():
    state['postSuiteRefreshPasses'] = post.read_text().count('online-resolve rc=0 prefer-offline-resolve rc=0')
print(json.dumps(state))
