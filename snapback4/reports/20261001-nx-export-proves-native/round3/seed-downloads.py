from pathlib import Path
import hashlib,json,shutil,sys
root=Path(__file__).resolve().parents[3]
source=Path('/Users/ccheever/Library/Caches/ReactNative')
record=root/'reports/20261001-nx-export-proves-native/round3/download-seeds.json'
starters=sys.argv[1:] or ['plain','social']
rows=[r for r in json.loads(record.read_text()) if r['starter'] not in starters] if record.exists() else []
for starter in starters:
    dest=root/'target/nx'/starter/'.snapback4-witness/home/Library/Caches/ReactNative'
    dest.mkdir(parents=True,exist_ok=True)
    for f in source.iterdir():
        if '0.86.3-' not in f.name and '250829098.0.17-' not in f.name: continue
        shutil.copy2(f,dest/f.name)
        rows.append({'starter':starter,'source':str(f),'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()})
record.write_text(json.dumps(rows,indent=2)+'\n')
