from pathlib import Path
import json,gzip,hashlib,difflib,re
r=Path('/Users/ccheever/sb4-np');report=r/'lane/snapback4/reports/20260929-np-macos-slice/round2';evidence=r/'evidence/round2';rows=[]
def h(b):return hashlib.sha256(b).hexdigest()
def copy_raw(source,relative):
 b=source.read_bytes()
 if re.search(rb'eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}',b):raise RuntimeError('possible credential in '+str(source))
 target=report/'raw'/relative;target=target.with_name(target.name+'.gz');target.parent.mkdir(parents=True,exist_ok=True);z=gzip.compress(b,mtime=0);target.write_bytes(z)
 rows.append({'local':str(source),'path':str(target.relative_to(report)),'bytes':len(b),'sha256':h(b),'gzipBytes':len(z),'gzipSha256':h(z)})
for p in sorted(evidence.iterdir()):
 if p.name == 'collection.log': continue
 if p.is_file() and p.suffix in ['.log','.json','.jsonl','.patch','.ts','.tsx','.js','.swift','.md']:
  copy_raw(p,Path(p.name))
 elif p.is_dir() and (evidence/(p.name+'-command.json')).exists():
  if 'exitStatus' not in json.loads((evidence/(p.name+'-command.json')).read_text()):raise RuntimeError('still running '+p.name)
  for f in sorted(p.iterdir()):
   if f.is_file() and f.suffix in ['.log','.json','.jsonl','.mjs']:copy_raw(f,Path(p.name)/f.name)
  if p.name in ['sealed-a-ownbuild-2','timed-b-repack-1','timed-b-warm-ownbuild-1','control-cold-error','control-death-restart-2']:
   for f in p.glob('*.png'):
    target=report/'screens'/p.name/f.name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(f.read_bytes())
for name in ['run-witness-r2.py','native-controls-r2.py','cold-error-control-r2.py','death-control-r2.py','owner-controls-r2.py','verify-evidence-r2.py','pins-and-sizes-r2.py','collect-report-r2.py','runtime-controls-r2.py','input-controls-r2.py','interruption-control-r2.py','mutations-r2.py','qualified-mutations-r2.py','sample-r2.py','qualified-sample-r2.py','qualification-r2.py','write-report-r2.py','sealed-qualification-r2.py','sealed-sample-r2.py','sealed-mutations-r2.py','pod-link-control-r2.py','sealed2-mutations-r2.py','update-records-r2.py','sealed3-mutations-r2.py','generated-pod-control-r2.py','timed-sample-r2.py','timed-qualification-r2.py','timed-mutations-r2.py','cleanup-r2.py']:
 p=r/name;target=report/'tools'/name;target.parent.mkdir(exist_ok=True);target.write_bytes(p.read_bytes())
helper=[]
for rel in ['src/smoke.ts','src/witness-core.ts','src/witness-runtime.ts','src/witness.ts','src/index.ts','ios/WitnessContainer.swift','ios/Snapback4Module.swift']:
 old=Path('/Users/ccheever/np-stage0/clique/node_modules/snapback4-expo')/rel;new=r/'subject/node_modules/snapback4-expo'/rel
 helper+=difflib.unified_diff(old.read_text().splitlines(True) if old.exists() else [],new.read_text().splitlines(True),fromfile='a/node_modules/snapback4-expo/'+rel,tofile='b/node_modules/snapback4-expo/'+rel)
(report/'subject-helper.patch').write_text(''.join(helper))
for rel in ['src/NPProbe.tsx','ios/Clique/AppDelegate.swift','np-entry.js','package.json']:
 source=r/'subject'/rel;target=report/'subject'/rel;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(source.read_bytes())
(report/'EVIDENCE.json').write_text(json.dumps(rows,indent=2)+'\n')
for x in rows:
 b=(report/x['path']).read_bytes();assert h(b)==x['gzipSha256'];raw=gzip.decompress(b);assert h(raw)==x['sha256'] and len(raw)==x['bytes']
print('archived and reverified',len(rows),'raw bytes',sum(x['bytes'] for x in rows),'gzip bytes',sum(x['gzipBytes'] for x in rows))
