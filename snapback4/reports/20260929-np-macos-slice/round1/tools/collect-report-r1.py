from pathlib import Path
import json,gzip,hashlib,difflib,shutil,re
r=Path('/Users/ccheever/sb4-np');report=r/'lane/snapback4/reports/20260929-np-macos-slice/round1';evidence=r/'evidence/round1';rows=[]
def h(b): return hashlib.sha256(b).hexdigest()
def copy_raw(source,relative):
 b=source.read_bytes()
 if re.search(rb'eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}',b):raise RuntimeError('possible credential in '+str(source))
 target=report/'raw'/relative;target=target.with_name(target.name+'.gz');target.parent.mkdir(parents=True,exist_ok=True);z=gzip.compress(b,mtime=0);target.write_bytes(z)
 rows.append({'local':str(source),'path':str(target.relative_to(report)),'bytes':len(b),'sha256':h(b),'gzipBytes':len(z),'gzipSha256':h(z)})
for p in sorted(evidence.iterdir()):
 if p.is_file() and p.suffix in ['.log','.json','.jsonl','.patch','.ts','.tsx']:
  copy_raw(p,Path(p.name))
 elif p.is_dir() and (evidence/(p.name+'-command.json')).exists():
  if 'exitStatus' not in json.loads((evidence/(p.name+'-command.json')).read_text()):raise RuntimeError('still running '+p.name)
  for f in sorted(p.iterdir()):
   if f.is_file() and f.suffix in ['.log','.json','.jsonl','.mjs']:copy_raw(f,Path(p.name)/f.name)
  if p.name in ['a-ownbuild-1','b-repack-1','b-warm-ownbuild-1','control-cold-error','control-death-restart']:
   for f in p.glob('*.png'):
    target=report/'screens'/p.name/f.name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(f.read_bytes())
for name in ['run-witness-r1.py','native-controls-r1.py','cold-error-control-r1.py','death-control-r1.py','owner-controls-r1.py','verify-evidence-r1.py','pins-and-sizes-r1.py','collect-report-r1.py']:
 p=r/name;target=report/'tools'/name;target.parent.mkdir(exist_ok=True);target.write_bytes(p.read_bytes())
helper=[]
for rel in ['src/smoke.ts','src/witness-core.ts','ios/WitnessContainer.swift','ios/Snapback4Module.swift']:
 old=Path('/Users/ccheever/np-stage0/clique/node_modules/snapback4-expo')/rel;new=r/'subject/node_modules/snapback4-expo'/rel
 helper+=difflib.unified_diff(old.read_text().splitlines(True),new.read_text().splitlines(True),fromfile='a/node_modules/snapback4-expo/'+rel,tofile='b/node_modules/snapback4-expo/'+rel)
(report/'subject-helper.patch').write_text(''.join(helper))
(report/'EVIDENCE.json').write_text(json.dumps(rows,indent=2)+'\n')
print('archived',len(rows),'raw bytes',sum(x['bytes'] for x in rows),'gzip bytes',sum(x['gzipBytes'] for x in rows))
