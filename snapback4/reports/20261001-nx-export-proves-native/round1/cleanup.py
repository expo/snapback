"""Clean only this lane's recorded simulator and generated native test projects."""
from pathlib import Path
import hashlib
import json
import os
import shutil
import subprocess
import time

root = Path(__file__).resolve().parents[3]
report = Path(__file__).resolve().parent
archived = json.loads((report / 'retained-evidence/summary.json').read_text())
assert all(row['fullEvidenceRuns'] == 5 and row['perRunApps'] == 0 for row in archived.values())
for starter in ['plain', 'social']:
    assert json.loads((report / f'{starter}-final-resource-comparison.json').read_text())['equal']

udid = '32D542F3-2E9E-4555-813D-2032D6243478'
record = Path(os.environ['HOME']) / '.local/state/snapback4/witness/simulators' / (udid + '.json')
assert record.is_file() and not record.is_symlink()
assert record.stat().st_uid == os.getuid() and record.stat().st_mode & 0o022 == 0
record_bytes = record.read_bytes()
owner = json.loads(record_bytes)
assert owner == {'name': 'sb4-nx-r1-1790906194044-44566', 'prefix': 'sb4-nx-r1-',
                 'runtime': 'com.apple.CoreSimulator.SimRuntime.iOS-27-0',
                 'selection': 'created', 'udid': udid}

actions = []
def simctl(*args):
    result = subprocess.run(['/usr/bin/xcrun', 'simctl', *args], capture_output=True, text=True)
    actions.append({'args': list(args), 'status': result.returncode})
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout

before = json.loads(simctl('list', 'devices', '--json'))
device = next(d for rows in before['devices'].values() for d in rows if d['udid'] == udid)
assert device['name'] == owner['name']
if device['state'] == 'Booted':
    simctl('shutdown', udid)
simctl('delete', udid)
assert record.read_bytes() == record_bytes
record.unlink()
after = json.loads(simctl('list', 'devices', '--json'))
remaining = {d['udid'] for rows in after['devices'].values() for d in rows}
owned = [udid]
for source in [*report.glob('*-interrupt-selection.json'), *report.glob('pre-resource-fix/*-interrupt-selection.json')]:
    owned.append(json.loads(source.read_text())['deleted']['udid'])
assert not set(owned) & remaining

project_tree = root / 'target/nx'
assert project_tree.is_dir() and not project_tree.is_symlink()
free_before = shutil.disk_usage(root).free
shutil.rmtree(project_tree)
result = {'finishedAt': time.time(), 'ownerRecord': owner,
          'ownerRecordSha256': hashlib.sha256(record_bytes).hexdigest(),
          'actions': actions, 'ownedSimulatorsAllAbsent': owned,
          'ownershipRecordRemoved': not record.exists(),
          'removedGeneratedProjects': str(project_tree),
          'normalCompilerAndDependencyCachesRetained': True,
          'volumeFreeBytesBefore': free_before, 'volumeFreeBytesAfter': shutil.disk_usage(root).free}
(report / 'cleanup.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
