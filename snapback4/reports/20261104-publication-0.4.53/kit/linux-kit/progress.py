from pathlib import Path
from datetime import datetime, timezone
import json
import os
import subprocess

base = Path.home() / 'sb4-intent/0453'
print(datetime.now(timezone.utc).isoformat())
for path in sorted((base / 'records').glob('attempt-*.json'), key=lambda p: p.stat().st_mtime)[-4:]:
    try:
        row = json.loads(path.read_text())
        print(path.name, 'exit', row.get('exit'), 'seconds', row.get('seconds'))
    except (OSError, json.JSONDecodeError):
        pass
for name in ['run-1.exit', 'linux-1.exit']:
    path = base / 'records' / name
    if path.exists():
        print(name, path.read_text().strip())
unit = 'sb4-pub53-linux-1.service'
state = subprocess.run(['systemctl', '--user', 'show', unit, '-p', 'MainPID', '-p', 'MemoryCurrent', '-p', 'MemoryPeak', '-p', 'ActiveState'], capture_output=True, text=True)
print(state.stdout.strip())
values = dict(line.split('=', 1) for line in state.stdout.splitlines() if '=' in line)
main = int(values.get('MainPID', '0'))
if main:
    rows = {}
    for line in subprocess.check_output(['ps', '-axo', 'pid,ppid,args'], text=True).splitlines()[1:]:
        parts = line.strip().split(None, 2)
        if len(parts) == 3:
            rows[int(parts[0])] = (int(parts[1]), parts[2])
    owned = {main}
    while True:
        enlarged = owned | {pid for pid, (parent, _) in rows.items() if parent in owned}
        if enlarged == owned:
            break
        owned = enlarged
    paths = set()
    for pid in owned:
        if 'run-rust-tests.mjs' not in rows.get(pid, (0, ''))[1]:
            continue
        try:
            target = os.readlink(f'/proc/{pid}/fd/1')
            if target.startswith('/tmp/snapback4-test.'):
                paths.add(target)
        except OSError:
            pass
    for target in sorted(paths):
        path = Path(target)
        print('owned Rust worker log', path)
        print('\n'.join(path.read_text().splitlines()[-6:]))
suite = base / 'linux-qualification-0.4.53/suite.log'
if suite.exists():
    print('suite log tail')
    print('\n'.join(suite.read_text().splitlines()[-6:]))
