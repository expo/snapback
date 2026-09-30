from pathlib import Path
import gzip, hashlib, json, sys
root=Path(__file__).resolve().parents[1]
final='--final' in sys.argv
for p in sorted(root.iterdir()):
    if not p.is_file(): continue
    if not final and p.name.startswith(('full-suite','ref-check-final','AFTER-SUITE')): continue
    if p.suffix=='.log' or p.suffix=='.json' and p.stat().st_size>100000:
        content=p.read_bytes()
        out=p.with_name(p.name+'.gz')
        out.write_bytes(gzip.compress(content,compresslevel=9,mtime=0))
        p.unlink()
manifest={str(p.relative_to(root)):{'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size} for p in sorted(root.rglob('*')) if p.is_file() and p.name!='ARTIFACTS.json'}
(root/'ARTIFACTS.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(len(manifest),'artifacts;',sum(x['bytes'] for x in manifest.values()),'bytes')
