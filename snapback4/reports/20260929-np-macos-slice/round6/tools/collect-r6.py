from pathlib import Path
import json,gzip,hashlib,difflib,re
r=Path('/Users/ccheever/sb4-np');report=r/'lane/snapback4/reports/20260929-np-macos-slice/round6';evidence=r/'evidence/round6';rows=[]
def h(b):return hashlib.sha256(b).hexdigest()
def copy_raw(source,relative):
 b=source.read_bytes()
 if re.search(rb'eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}',b):raise RuntimeError('possible credential in '+str(source))
 target=report/'raw'/relative;target=target.with_name(target.name+'.gz');target.parent.mkdir(parents=True,exist_ok=True);z=gzip.compress(b,mtime=0);target.write_bytes(z)
 rows.append({'local':str(source),'path':str(target.relative_to(report)),'bytes':len(b),'sha256':h(b),'gzipBytes':len(z),'gzipSha256':h(z)})
for p in sorted(evidence.iterdir()):
 if p.name=='collection.log':continue
 if p.is_file() and p.suffix in ['.log','.json','.jsonl','.patch','.ts','.tsx','.js','.swift','.md','.udid','.sentinel']:
  copy_raw(p,Path(p.name))
 elif p.is_dir() and (evidence/(p.name+'-command.json')).exists():
  if 'exitStatus' not in json.loads((evidence/(p.name+'-command.json')).read_text()):raise RuntimeError('still running '+p.name)
  for f in sorted(p.iterdir()):
   if f.is_file() and f.suffix in ['.log','.json','.jsonl','.mjs']:copy_raw(f,Path(p.name)/f.name)
  for f in sorted((p/'native-dependencies').rglob('*')):
   if f.is_file():copy_raw(f,f.relative_to(evidence))
  if p.name in ['warm-build-smoke-2','warm-build-smoke-4']:
   for f in p.glob('*.png'):
    target=report/'screens'/p.name/f.name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(f.read_bytes())
 elif p.is_dir() and p.name in ['mutations','mutations-final','mutations-qualified','mutations-complete','tamper-bin']:
  for f in sorted(p.rglob('*')):
   if f.is_file():copy_raw(f,f.relative_to(evidence))
helper=[]
for rel in ['src/smoke.ts','src/witness-core.ts','src/witness-runtime.ts','src/witness.ts','src/index.ts','ios/WitnessContainer.swift','ios/Snapback4Module.swift']:
 old=Path('/Users/ccheever/np-stage0/clique/node_modules/snapback4-expo')/rel;new=r/'subject/node_modules/snapback4-expo'/rel
 helper+=difflib.unified_diff(old.read_text().splitlines(True) if old.exists() else [],new.read_text().splitlines(True),fromfile='a/node_modules/snapback4-expo/'+rel,tofile='b/node_modules/snapback4-expo/'+rel)
(report/'subject-helper.patch').write_text(''.join(helper));assert (report/'subject-helper.patch').read_bytes()==(report.parent/'round2/subject-helper.patch').read_bytes()
for rel in ['src/NPProbe.tsx','ios/Clique/AppDelegate.swift','np-entry.js','package.json']:
 source=r/'subject'/rel;target=report/'subject'/rel;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(source.read_bytes())
(report/'EVIDENCE.json').write_text(json.dumps(rows,indent=2)+'\n')
for x in rows:
 b=(report/x['path']).read_bytes();assert h(b)==x['gzipSha256'];raw=gzip.decompress(b);assert h(raw)==x['sha256'] and len(raw)==x['bytes']
print('Archived and reverified',len(rows),'files;',sum(x['bytes'] for x in rows),'raw bytes;',sum(x['gzipBytes'] for x in rows),'gzip bytes')
