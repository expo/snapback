from pathlib import Path
import json,hashlib
r=Path('/Users/ccheever/sb4-np');s=r/'subject/.snapback4-witness/snapshot';e=r/'evidence/round3'
def norm(x):return x.replace(str(s),'${PROJECT}').replace('Clique','${APP_NAME}')
def h(x):return hashlib.sha256(norm(x).encode()).hexdigest()
pins={}
for kind in ['Clique','Pods']:
 for p in json.loads((e/f'{kind}-scripts.json').read_text()):pins.setdefault(h(p['shellScript']),p['name'])
support={h(f.read_text()):str(f.relative_to(s)) for f in (s/'ios/Pods/Target Support Files').rglob('*.sh')}
p=r/'lane/snapback4/crates/snapback4/src/verbs/witness/native-scripts.mjs'
p.write_text('// @ref LLP 3000.030#4 — exact generated Expo 57 / RN 0.86 / CocoaPods 1.17 script forms.\n// Unknown scripts need an own build; a name alone never grants repack eligibility.\n'+''.join('export const '+name+' = new Set([\n'+''.join('  '+json.dumps(k)+', // '+v+'\n' for k,v in sorted(rows.items()))+']);\n' for name,rows in [('phaseHashes',pins),('supportHashes',support)]))
print('phase pins',len(pins),'support pins',len(support))
