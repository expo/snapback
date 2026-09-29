from pathlib import Path
import json, os, subprocess, sys, hashlib
r = Path('/Users/ccheever/sb4-np')
e = r / 'evidence/round6'
t = Path(__file__).parent
source = r / 'subject/ios/.xcode.env.local'
backup = e / 'original-xcode-env.local'
sentinel = e / 'outside-env-sentinel'
sentinel.write_text('NP round 6 outside environment: preserve these bytes\n')
before = hashlib.sha256(sentinel.read_bytes()).hexdigest()
had_source = os.path.lexists(source)
assert not os.path.lexists(backup)
if had_source:
    source.rename(backup)
try:
    source.symlink_to(sentinel)
    argv = [sys.executable, str(t / 'run-witness-r6.py'), 'warm-build-smoke',
            '--build', str(r / 'subject'), '--smoke', '--udid',
            (e / 'owned.udid').read_text().strip(), '--port', '49371']
    code = subprocess.run(argv).returncode
    snapshot = r / 'subject/.snapback4-witness/snapshot/ios/.xcode.env.local'
    record = dict(argv=argv, exitStatus=code, sentinelSha256Before=before,
                  sentinelSha256After=hashlib.sha256(sentinel.read_bytes()).hexdigest(),
                  sourceStillSymlink=source.is_symlink() and source.readlink() == sentinel,
                  snapshotRegularFile=snapshot.is_file() and not snapshot.is_symlink())
    (e / 'native-env-control.json').write_text(json.dumps(record, indent=2) + '\n')
    assert record['sentinelSha256After'] == before and record['sourceStillSymlink'] and record['snapshotRegularFile']
    assert code == 0, code
finally:
    source.unlink(missing_ok=True)
    if had_source:
        backup.rename(source)
