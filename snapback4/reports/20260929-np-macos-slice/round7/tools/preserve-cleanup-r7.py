from pathlib import Path
import hashlib, json, os, subprocess
r = Path('/Users/ccheever/sb4-np')
e = r / 'evidence/round7'
d = e / 'warm-build-smoke'
receipt = json.loads((d / 'build.json').read_text())
for row in receipt['nativeClosure']['compiler']['records']:
    source = r / 'subject/.snapback4-witness' / row['path']
    raw = source.read_bytes()
    assert hashlib.sha256(raw).hexdigest() == row['sha256']
    dest = d / 'native-dependencies' / row['path']
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(raw)
u = (e / 'owned.udid').read_text().strip()
records = []
env = dict(os.environ, DEVELOPER_DIR='/Applications/Xcode.app/Contents/Developer',
           TMPDIR=str(r / 'tmp'))
for argv in [['xcrun', 'simctl', 'shutdown', u], ['xcrun', 'simctl', 'delete', u]]:
    result = subprocess.run(argv, env=env, text=True, capture_output=True)
    records.append(dict(argv=argv, exitStatus=result.returncode,
                        stdout=result.stdout, stderr=result.stderr))
    (e / 'cleanup.json').write_text(json.dumps(records, indent=2) + '\n')
    assert result.returncode == 0
print('Preserved native dependency records and removed only owned simulator', u)
