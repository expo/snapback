from pathlib import Path
import hashlib,json
r=Path('/Users/ccheever/sb4-np');e=r/'evidence/round3';source=r/'lane/snapback4/crates/snapback4/src/verbs/witness';rows=[]
def h(p):return hashlib.sha256(p.read_bytes()).hexdigest()
for name in ['sealed-a-ownbuild-1']+[f'sealed-b-repack-{n}' for n in range(1,6)]+['sealed-b-warm-ownbuild-1']:
 files={}
 for f in ['prepare.mjs','native-inputs.mjs','native-closure.mjs','native-scripts.mjs','payload.mjs']:
  assert (e/name/f).read_bytes()==(source/f).read_bytes(),(name,f)
  files[f]=h(source/f)
 rows.append({'name':name,'helperHashes':files})
(e/'code-binding.json').write_text(json.dumps(rows,indent=2));print('all final preparation helpers match working tree')
