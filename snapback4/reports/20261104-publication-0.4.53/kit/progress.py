from pathlib import Path
from datetime import datetime, timezone
import json
import re

kit = Path.home() / 'sb4-pub-0453'
active = json.loads((kit / 'ACTIVE.json').read_text())
print(datetime.now(timezone.utc).isoformat(), active['phase'])
if active['phase'] == 'release-preflight':
    receipt = json.loads(Path(active['receipt']).read_text())
    log = Path(active['log']).read_text()
    phases = re.findall(r'^== (.+)$', log, re.M)
    phase = phases[-1] if phases else 'starting'
    print('completed', len(receipt['results']), '/', len(receipt['steps']), 'phase', phase)
    print('red', [(r['id'], r['status']) for r in receipt['results'] if r['status'] != 0])
    tail = log.rsplit('== ' + phase, 1)[-1]
    print('successful Rust summaries in phase', len(re.findall(r'^test result: ok\.', tail, re.M)))
    if phase == 'client-tests':
        done = re.findall(r'^-- client file (ok|FAIL): (packages/snapback4/test/\S+)', tail, re.M)
        print('client files finished', len(done), 'failed', [name for status, name in done if status == 'FAIL'])
    print('\n'.join(log.splitlines()[-5:]))
    exit_file = kit / 'release-evidence/affected.exit'
    if exit_file.exists():
        print('affected exit', exit_file.read_text().strip())
else:
    report = Path.home() / 'sb4-pub-0453-wt/snapback4/reports/20261104-publication-0.4.53'
    for p in sorted(report.glob('attempt-*.json'), key=lambda p: p.stat().st_mtime)[-4:]:
        data = json.loads(p.read_text())
        print(p.name, 'exit', data.get('exit'), 'seconds', data.get('seconds'))
    for name in ['chain-a2.log', 'chain-pre-a2.log', 'gate.log']:
        path = kit / name
        if path.exists():
            print(name, '\n'.join(path.read_text().splitlines()[-2:]))
