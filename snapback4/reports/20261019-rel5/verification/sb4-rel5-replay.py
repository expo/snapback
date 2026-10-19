from pathlib import Path
import subprocess,json,shutil,os,hashlib,difflib
repo=Path("/home/ccheever/projects/sb4-b17-rel5")
evidence=Path("/home/ccheever/sb4-loop/wave17/apps")
work=Path("/home/ccheever/sb4-loop/wave17-repro/rel5")
report=repo/"snapback4/reports/20261019-rel5";report.mkdir(parents=True,exist_ok=True)
work.mkdir(parents=True,exist_ok=True)
results=[]
for lane in ["013-snapback-hackathon-rubric-judging","030-snapback-harvest-bin-tickets","042-snapback-sterile-tray-tracking"]:
 original=evidence/lane;copy=work/lane
 if copy.exists(): raise Exception("refuse existing replay copy "+str(copy))
 copy.mkdir()
 before={}
 try:
  for folder in ["snapback","v1","versions","scripts"]:
   path=original/folder
   if not path.exists():continue
   for f in path.rglob("*"):
    if f.is_symlink() or not f.is_file() or f.suffix not in [".q",".ts",".mjs"] or "generated" in f.parts:continue
    rel=f.relative_to(original);dest=copy/rel;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(f.read_bytes());before[str(rel)]=hashlib.sha256(f.read_bytes()).hexdigest()
  (copy/"package.json").write_text('{"private":true,"type":"module"}')
  (copy/"node_modules").mkdir();(copy/"node_modules/snapback4").symlink_to(repo/"snapback4/packages/snapback4",target_is_directory=True)
  script=copy/"scripts/day2-proof.mjs";old=script.read_text();new=old
  if lane.startswith("013"):
   for variable in ["v2num","v2numLive"]:
    new=new.replace('["rollback", DEPLOY_DIR, "--to", String('+variable+'), "--json"]','["deploy", DEPLOY_DIR, "--json"]')
  elif lane.startswith("030"):
   a=new.index('  if (dep.code !== 0 || await currentRelease() !== rel.v2) {');b=new.index('  C = clients();',a)
   new=new[:a]+'  assert.equal(dep.code,0,dep.stdout+dep.stderr);\n  assert.equal(await currentRelease(),rel.v2);\n'+new[b:]
   new=new.replace('await putLive(rel.v2, "rollforward to v2");','{ const d=await cli(["deploy",DEPLOY]); assert.equal(d.code,0,d.stderr); }')
   new=new.replace('await putLive(rel.v2, "normalize to v2");','{ const d=await cli(["deploy",DEPLOY]); assert.equal(d.code,0,d.stderr); }')
  else:
   a=new.index('async function deployRelease(');b=new.index('function releaseNum',a)
   new=new[:a]+"async function deployRelease(schema,label) { const d=await deploy(DIR,schema,{...options,timeoutMs:180_000}); log(label+' '+d.stdout.trim()); return d; }\n"+new[b:]
   new=new.replace('await rollback(DIR, v2num, { ...options, timeoutMs: 180_000 })','await deploy(DIR, "versions/v2/schema.q", { ...options, timeoutMs: 180_000 })')
  script.write_text(new)
  (report/(lane[:3]+"-proof.patch")).write_text(''.join(difflib.unified_diff(old.splitlines(True),new.splitlines(True),fromfile='original/scripts/day2-proof.mjs',tofile='copy/scripts/day2-proof.mjs')))
  env=os.environ.copy();env.update(SNAPBACK4_BIN=str(repo/"snapback4/target/debug/snapback4"),PORT_LO="26800",PORT_HI="26899",SNAPBACK4_PROOF_LOGS=str(copy/"proof-logs"))
  check=subprocess.run([str(repo/"snapback4/target/debug/snapback4"),"check"],cwd=copy,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=180)
  (report/(lane[:3]+"-check.log")).write_text(check.stdout)
  assert check.returncode==0,check.stdout[-2000:]
  runs=[]
  for attempt in [1,2]:
   with (report/(lane[:3]+f"-day2-{attempt}.log")).open('w') as log:
    result=subprocess.run(["node","scripts/day2-proof.mjs"],cwd=copy,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=300)
   proof=json.loads((copy/"day2-proof.json").read_text()) if (copy/"day2-proof.json").exists() else {}
   release_dirs=sorted(p.name for p in (copy/"deploy/releases").iterdir()) if (copy/"deploy/releases").exists() else []
   runs.append({"attempt":attempt,"exit":result.returncode,"proof":proof,"releaseDirectories":release_dirs})
   if result.returncode:break
  unchanged=all(hashlib.sha256((original/rel).read_bytes()).hexdigest()==digest for rel,digest in before.items())
  results.append({"lane":lane,"originalUnchanged":unchanged,"changes":"release-selection workaround removed; original schemas and business assertions unchanged","runs":runs})
 finally:
  shutil.rmtree(copy)
 (report/"lane-replay.json").write_text(json.dumps(results,indent=2)+'\n')
 print(json.dumps(results[-1]),flush=True)
try:work.rmdir()
except OSError:pass
assert all(r['originalUnchanged'] and len(r['runs'])==2 and all(x['exit']==0 and x['proof'].get('ok') for x in r['runs']) for r in results)
