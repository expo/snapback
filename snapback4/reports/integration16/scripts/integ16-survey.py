import pathlib,tempfile,shutil,subprocess,json,hashlib,collections,concurrent.futures,time
repo=pathlib.Path("/home/ccheever/projects/snapback-sb4loop");base=pathlib.Path("/home/ccheever/sb4-loop");binary=repo/"snapback4/target/debug/snapback4";old=base/"prewave16/upgrade31/node_modules/snapback4-linux-x64/snapback4"
out=repo/"snapback4/target/integ16-survey";out.mkdir(exist_ok=True)
deadline=time.time()+7200
while time.time()<deadline:
 try:
  if subprocess.check_output([binary,"--version"],timeout=10).strip()==b"snapback4 0.4.32":break
 except Exception:pass
 time.sleep(5)
else:raise RuntimeError("current binary deadline")
def check(task):
 wave,path,which=task;exe=old if which=="base" else binary
 with tempfile.TemporaryDirectory(prefix="integ16-survey-") as d:
  dest=pathlib.Path(d)/"snapback";dest.mkdir()
  hashes={}
  for p in sorted(path.glob("*.q")):
   shutil.copy2(p,dest/p.name);hashes[p.name]=hashlib.sha256(p.read_bytes()).hexdigest()
  run=subprocess.run([exe,"check","--json"],cwd=d,text=True,capture_output=True,timeout=120)
  try:data=json.loads(run.stdout)
  except Exception:data={"parseError":run.stdout,"stderr":run.stderr}
  return dict(wave=wave,lane=path.parent.name,which=which,exit=run.returncode,hashes=hashes,result=data)
apps=[(15,p) for p in sorted((base/"wave15/apps").glob("*/snapback"))]+[(16,p) for p in sorted((base/"wave16/apps").glob("*-snapback-*/snapback"))]
assert sum(w==15 for w,p in apps)==100
assert sum(w==16 for w,p in apps)==50
jobs=[(w,p,k) for w,p in apps for k in ["base","merged"]]
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:rows=list(ex.map(check,jobs))
(out/"schemas.json").write_text(json.dumps(rows,indent=2))
summary={}
for wave in [15,16]:
 for which in ["base","merged"]:
  group=[r for r in rows if r["wave"]==wave and r["which"]==which];c=collections.Counter(n["code"] for r in group for n in r["result"].get("notes",[]));errors=collections.Counter(n["code"] for r in group for n in r["result"].get("diagnostics",[]))
  summary[f"wave{wave}-{which}"]=dict(count=len(group),passed=sum(r["exit"]==0 for r in group),notes=sum(c.values()),codes=dict(sorted(c.items())),errors=dict(errors))
(out/"summary.json").write_text(json.dumps(summary,indent=2));print(json.dumps(summary,indent=2))
assert all(r["exit"]==0 for r in rows)
