from pathlib import Path
import gzip, hashlib, json
root=Path(__file__).resolve().parent
for p in sorted(root.glob('*.log')):
    p.with_name(p.name+'.gz').write_bytes(gzip.compress(p.read_bytes(),compresslevel=9,mtime=0))
    p.unlink()
manifest={str(p.relative_to(root)):{'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size} for p in sorted(root.rglob('*')) if p.is_file() and p.name!='ARTIFACTS.json'}
(root/'ARTIFACTS.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(len(manifest),'artifacts;',sum(x['bytes'] for x in manifest.values()),'bytes')
