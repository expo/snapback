#!/usr/bin/env python3
"""Remove only NI-owned resources after the caller verifies the exported archive."""
import argparse
import fcntl
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import time

p = argparse.ArgumentParser()
p.add_argument('--verified-archive-sha256', required=True)
a = p.parse_args()
assert sys.platform == 'darwin'
root = Path('/tmp/ni-native-20261005').resolve()
assert str(root) == '/private/tmp/ni-native-20261005'
archive_sha = hashlib.sha256((root / 'export.tar.gz').read_bytes()).hexdigest()
assert archive_sha == a.verified_archive_sha256
udid = '3D325BD4-FD16-4A94-AA74-9F5CF1F8E48B'
lock_path = Path('/tmp/clique-native-' + udid + '.lock')
lease = lock_path.open('a')
fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
result = {'at': time.time(), 'simulator': udid, 'verifiedArchiveSha256': archive_sha}

def sim(*argv):
    return subprocess.run(['xcrun', 'simctl', *argv], capture_output=True, text=True)

def device_state():
    devices = json.loads(sim('list', 'devices', 'available', '--json').stdout)['devices']
    return next(d['state'] for ds in devices.values() for d in ds if d['udid'] == udid)

result['stateBefore'] = device_state()
assert result['stateBefore'] == 'Booted'
result['listeners'] = {}
for port in [49491, 49492]:
    probe = subprocess.run(['lsof', '-nP', '-iTCP:' + str(port), '-sTCP:LISTEN'], capture_output=True, text=True)
    assert probe.returncode == 1 and not probe.stdout, 'listener remains; do not kill an unknown process'
    result['listeners'][str(port)] = 'absent'

groups = set()
legacy_groups = []
for path in (root / 'runs').glob('*/evidence/host.jsonl'):
    for line in path.read_text().splitlines():
        event = json.loads(line)
        if event['kind'] == 'process-start':
            groups.add(event.get('pgid', event['pid']))
            if 'pgid' not in event:
                legacy_groups.append({'pid': event['pid'], 'role': event['role'], 'source': str(path.relative_to(root))})
processes = subprocess.check_output(['ps', '-axo', 'pgid=,command='], text=True)
active = []
for line in processes.splitlines():
    parts = line.strip().split(None, 1)
    if parts and int(parts[0]) in groups and len(parts) > 1 and 'ni-native-20261005' in parts[1]:
        active.append(line.strip())
assert not active, 'NI-owned process remains'
result['recordedGroupsChecked'] = len(groups)
result['legacySessionLeaders'] = legacy_groups
result['activeTaskGroups'] = active

result['apps'] = {}
for bundle in ['dev.clique.ni.reference', 'dev.clique.ni.driver.xctrunner']:
    present = sim('get_app_container', udid, bundle, 'app').returncode == 0
    if present:
        removed = sim('uninstall', udid, bundle)
        assert removed.returncode == 0, bundle
    absent = sim('get_app_container', udid, bundle, 'app').returncode != 0
    assert absent
    result['apps'][bundle] = {'wasInstalled': present, 'absentAfter': absent}

derived = Path.home() / 'Library/Developer/Xcode/DerivedData/NIReference-anepqaeqxpguqdacnwsuuhjpqsaz'
proof = root / 'runs/none-m6-225820/evidence/xctest.log'
owned_result = derived / 'Logs/Test/Test-CliqueDriver-2026.10.04_22-58-21--0700.xcresult'
assert str(owned_result) in proof.read_text()
if derived.exists():
    assert {x.name for x in derived.iterdir()} <= {'Logs', 'TestResults'}
    assert set(derived.rglob('*.xcresult')) == {owned_result}
    shutil.rmtree(derived)
result['accidentalGlobalDerivedData'] = {'path': str(derived), 'custody': str(proof), 'absentAfter': not derived.exists()}
shutil.rmtree(root)
result['scratch'] = {'path': str(root), 'absentAfter': not root.exists()}
lock_path.unlink()
fcntl.flock(lease, fcntl.LOCK_UN)
lease.close()
result['leaseFileAbsent'] = not lock_path.exists()
result['stateAfter'] = device_state()
assert result['stateAfter'] == result['stateBefore']
print(json.dumps(result, indent=2))
