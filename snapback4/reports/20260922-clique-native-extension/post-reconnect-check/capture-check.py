"""Retain standalone output without opening the preserved snapshot itself."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib, json, subprocess, sys, time
root = Path(__file__).resolve().parent
original = Path('/Users/ccheever/clique-sb4-20260922-astra-cal16/attempts/native-extension/artifacts/acquisition-expo024-candidate-1/stopped-documents')
fixture = Path('/Users/ccheever/clique-sb4-20260922-astra-cal16/attempts/native-extension/custody/retained-fixture.json')
clone = root/'stopped-documents-inspection-copy'
assert original.is_dir() and not clone.exists()
def stamp(): return datetime.now(timezone.utc).isoformat()
def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for part in iter(lambda: f.read(4*1024*1024), b''): h.update(part)
    return h.hexdigest()
def manifest(folder):
    return [{'path':str(p.relative_to(folder)), 'bytes':p.stat().st_size, 'sha256':sha(p)} for p in sorted(folder.rglob('*')) if p.is_file()]
started = stamp()
before = manifest(original)
(root/'snapshot-before.json').write_text(json.dumps(before,indent=2)+'\n')
copy_argv = ['/bin/cp','-cR',str(original),str(clone)]
subprocess.run(copy_argv,check=True)
assert manifest(clone) == before
argv = [sys.executable,str(root/'check-stopped-native.py'),str(clone),str(fixture)]
checker_start = stamp(); clock = time.monotonic()
result = subprocess.run(argv,capture_output=True,text=True)
checker_end = stamp(); elapsed = time.monotonic()-clock
(root/'stdout.json').write_text(result.stdout)
(root/'stderr.log').write_text(result.stderr)
after = manifest(original)
(root/'snapshot-after.json').write_text(json.dumps(after,indent=2)+'\n')
assert after == before, 'Preserved source snapshot changed'
receipt = {'startedAt':started,'completedAt':stamp(),'sourceSnapshot':str(original),'sourceSnapshotUnchanged':True,'snapshotManifestSha256':sha(root/'snapshot-before.json'),'files':len(before),'bytes':sum(r['bytes'] for r in before),'copyArgv':copy_argv,'argv':argv,'checkerStartedAt':checker_start,'checkerEndedAt':checker_end,'checkerElapsedSeconds':elapsed,'exitCode':result.returncode,'checkerSha256':sha(root/'check-stopped-native.py'),'fixture':str(fixture),'fixtureSha256':sha(fixture),'stdoutSha256':sha(root/'stdout.json'),'stderrSha256':sha(root/'stderr.log'),'phase':'stopped after reconnect; distinct from offline-ID enumeration','mode':'Existing mode=ro SQLite checker on APFS clone; preserved original only hashed before/after, never opened as SQLite'}
(root/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
assert result.returncode == 0, result.stderr
print(json.dumps({'receipt':str(root/'receipt.json'),'result':json.loads(result.stdout),'sourceSnapshotUnchanged':True}))
