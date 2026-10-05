"""Retain this lane's raw evidence outside git, named by SHA-256."""
import hashlib,json,pathlib,shutil,subprocess
from measure import ROOT,WORK,REPORT,retain
rows=[]
for p in sorted(pathlib.Path('/tmp').glob('sb4-nz-*.log')):
    rows.append(retain(p))
for p in sorted(WORK.glob('*.log')):
    rows.append(retain(p))
for p in [WORK/'quiet.jsonl',WORK/'baseline-production',WORK/'candidate-production',WORK/'baseline-export-ios.mjs']:
    if p.exists(): rows.append(retain(p))
for project in ['plain','social','functional','functional-social']:
    for folder in sorted((WORK/project/'artifacts/native-smoke').glob('*')):
        if not folder.is_dir(): continue
        for p in sorted(folder.iterdir()):
            if p.is_file(): rows.append(retain(p))
        for p in sorted((folder/'export').rglob('*')):
            if p.is_file(): rows.append(retain(p))
# Keep the committed index below the user's 256 KiB per-file ceiling even
# after all native cohorts; raw data is always outside git.
parts=[]; chunk=[]; size=0
for row in rows:
    encoded=len(json.dumps(row,indent=2).encode())+4
    if chunk and size+encoded>180000:
        name=f'evidence-index-{len(parts)+1:02}.json'
        data=(json.dumps(chunk,indent=2)+'\n').encode(); (REPORT/name).write_bytes(data)
        parts.append(dict(path=name,sha256=hashlib.sha256(data).hexdigest(),bytes=len(data),files=len(chunk)))
        chunk=[]; size=0
    chunk.append(row); size+=encoded
if chunk:
    name=f'evidence-index-{len(parts)+1:02}.json'
    data=(json.dumps(chunk,indent=2)+'\n').encode(); (REPORT/name).write_bytes(data)
    parts.append(dict(path=name,sha256=hashlib.sha256(data).hexdigest(),bytes=len(data),files=len(chunk)))
(REPORT/'evidence-index.json').write_text(json.dumps(dict(files=len(rows),parts=parts),indent=2)+'\n')
for old in REPORT.glob('evidence-index-??.json'):
    if old.name not in [p['path'] for p in parts]: old.unlink()
paths=subprocess.check_output(['git','diff','--name-only'],cwd=ROOT.parent,text=True).splitlines()
paths+=subprocess.check_output(['git','ls-files','--others','--exclude-standard'],cwd=ROOT.parent,text=True).splitlines()
manifest=[]
for relative in sorted(set(paths)):
    p=ROOT.parent/relative
    if p.is_file() and 'reports/20261003-nz-native-proof-zero-cost' not in relative:
        manifest.append(dict(path=relative,sha256=hashlib.sha256(p.read_bytes()).hexdigest(),bytes=p.stat().st_size))
(REPORT/'source-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(f'Retained {len(rows)} raw files; {len(manifest)} changed source files')
