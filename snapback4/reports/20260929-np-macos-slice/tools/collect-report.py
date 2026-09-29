from pathlib import Path
import json,gzip,hashlib,difflib,shutil,re,os
r=Path('/Users/ccheever/sb4-np'); report=r/'lane/snapback4/reports/20260929-np-macos-slice';evidence=r/'evidence';rows=[]
def h(b):return hashlib.sha256(b).hexdigest()
def copy_raw(source,relative):
 b=source.read_bytes()
 # Native app packages never contain sessions; device/backend stores are not collected.
 if re.search(rb'eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}',b):raise RuntimeError('possible credential in '+str(source))
 target=report/'raw'/relative; target=target.with_name(target.name+'.gz');target.parent.mkdir(parents=True,exist_ok=True);z=gzip.compress(b,mtime=0);target.write_bytes(z)
 rows.append({'local':str(source),'path':str(target.relative_to(report)),'bytes':len(b),'sha256':h(b),'gzipBytes':len(z),'gzipSha256':h(z)})
for p in sorted(evidence.iterdir()):
 if p.is_file():
  if p.suffix in ['.log','.json','.jsonl','.diagnostics','.patch','.ts','.tsx'] and p.name!='subject.patch':copy_raw(p,Path('evidence')/p.name)
 elif p.is_dir():
  # Only completed run-level evidence, never .app, repack-work, xcresult or data stores.
  cmd=evidence/(p.name+'-command.json')
  if cmd.exists() and 'exitStatus' not in json.loads(cmd.read_text()):continue
  for f in sorted(p.iterdir()):
   if f.is_file() and f.suffix in ['.log','.json','.jsonl','.mjs']:copy_raw(f,Path('evidence')/p.name/f.name)
for name in ['stage0.sh','stage0.log','build-cold.log','build-warm.log','repack.log','npm-ci.log']:
 p=Path('/Users/ccheever/np-stage0')/name
 if p.exists():copy_raw(p,Path('stage0')/name)
for p in (r/'reviews').glob('*.md'):copy_raw(p,Path('reviews')/p.name)
for name in ['run-witness.py','native-controls.py','cold-error-control.py','death-control.py','verify-evidence.py']:
 p=r/name; target=report/'tools'/name;target.parent.mkdir(exist_ok=True);target.write_bytes(p.read_bytes())
# Retain exact local-probe sources and the native lifecycle change (no stores or credentials).
files=['app/_layout.tsx','src/client.ts','src/NPProbe.tsx','src/np-gate.ts','ios/Clique/AppDelegate.swift','ios/Clique/Info.plist','package.json','package-lock.json']
patch=[]
for rel in files:
 src=r/'subject'/rel;old=Path('/Users/ccheever/np-stage0/clique')/rel
 target=report/'subject'/rel;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(src.read_bytes())
 before=old.read_text().splitlines(True) if old.exists() else []
 patch+=difflib.unified_diff(before,src.read_text().splitlines(True),fromfile='a/'+rel,tofile='b/'+rel)
(report/'subject.patch').write_text(''.join(patch))
for p in (r/'subject/assets/np').iterdir():
 target=report/'subject/assets/np'/p.name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(p.read_bytes())
for name in ['a-ownbuild-1','b-repack-1','b-warm-ownbuild-1','b-final-ownbuild-2']:
 for p in (evidence/name).glob('*.png'):
  target=report/'screens'/name/p.name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(p.read_bytes())
helper=[]
for rel in ['src/witness-core.ts','ios/WitnessContainer.swift','ios/Snapback4Module.swift']:
 old=Path('/Users/ccheever/np-stage0/clique/node_modules/snapback4-expo')/rel;new=r/'subject/node_modules/snapback4-expo'/rel
 helper+=difflib.unified_diff(old.read_text().splitlines(True),new.read_text().splitlines(True),fromfile='a/node_modules/snapback4-expo/'+rel,tofile='b/node_modules/snapback4-expo/'+rel)
(report/'subject-helper.patch').write_text(''.join(helper))
candidate=[]
for old in (r/'repack-candidate-source').rglob('*'):
 if not old.is_file():continue
 rel=old.relative_to(r/'repack-candidate-source');final=r/'lane/snapback4'/rel
 candidate+=difflib.unified_diff(final.read_text().splitlines(True),old.read_text().splitlines(True),fromfile='a/snapback4/'+str(rel),tofile='b/snapback4/'+str(rel))
(report/'unqualified-repack-candidate.patch').write_text(''.join(candidate))
(report/'EVIDENCE.json').write_text(json.dumps(rows,indent=2)+'\n')
print('archived',len(rows),'raw bytes',sum(x['bytes'] for x in rows),'gzip bytes',sum(x['gzipBytes'] for x in rows))
