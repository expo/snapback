import pathlib,sqlite3,shutil,subprocess,concurrent.futures,json,os,sys,hashlib
BASE=pathlib.Path("/tmp/integ23/w25replay");BASE.mkdir(exist_ok=True,parents=True)
APPS=pathlib.Path.home()/"sb4-loop/wave25/apps"
BIN=os.environ["SNAPBACK4_BIN"];TAG=os.environ.get("REPLAY_TAG","fixed-r1")
REFUSED="002 004 005 006 010 018 020 024 026 030 036 038 042 044 050".split()
FALSE=set("002 005 006 018 020 026 036 038 042 050".split())
ROLL="003 007 015 019 027 043".split()
OUT=BASE/TAG;OUT.mkdir(exist_ok=True)
def lane(n):
 app=next(APPS.glob(n+"-snapback-*"));root=OUT/(n+"-store");root.mkdir()
 calls=[]
 try:
  shutil.copytree(app/"deploy",root/"deploy",ignore=shutil.ignore_patterns("store.sqlite","store.sqlite-wal","store.sqlite-shm","store.sqlite-owner","store.sqlite-token",".release-command",".snapback4"))
  with sqlite3.connect("file:"+str(app / "deploy/store.sqlite")+"?mode=ro",uri=True) as src,sqlite3.connect(root/"deploy/store.sqlite") as dest:src.backup(dest)
  active=(root/"deploy/current").read_text().strip()
  shutil.copytree(root/f"deploy/releases/{active}/snapback",root/"snapback",ignore=shutil.ignore_patterns("generated"))
  def run(args):
   r=subprocess.run(["timeout","240s",BIN,*args],cwd=root,text=True,capture_output=True,timeout=250)
   try:v=json.loads(r.stdout)
   except:v={}
   calls.append(dict(args=args,code=r.returncode,stdout=r.stdout,stderr=r.stderr));return r,v
  legacy,l=run(["rollback","deploy","--to","1","--check","--json"])
  exact,e=run(["rollback","deploy","--to","1","--exact","--check","--json"])
  check,c=run(["deploy","deploy","--schema","snapback","--check","--json"])
  deploy,d=run(["deploy","deploy","--schema","snapback","--json"])
  if deploy.returncode==0:
   rb,r=run(["rollback","deploy","--to","1","--check","--json"])
   live,v=run(["rollback","deploy","--to","1","--json"])
   fw,f=run(["rollback","deploy","--to","latest","--json"])
  else:rb=live=fw=None;r={}
  item=dict(lane=n,knownFalseRefusal=n in FALSE,rollWidening=n in ROLL,legacy=legacy.returncode,legacyActionable=(legacy.returncode==0 or ("--to 1 --exact" in legacy.stderr and "redeploy with 0.4.39 to register a view" in legacy.stderr)),exact=exact.returncode,exactHidden=e.get("visibility",{}).get("hiddenRows"),check=check.returncode,deploy=deploy.returncode,rollbackCheck=rb.returncode if rb else None,rollback=live.returncode if live else None,forward=fw.returncode if fw else None,hidden=r.get("visibility",{}).get("hiddenRows"),views=c.get("rollbackViews"),refusal=deploy.stderr[-1800:] if deploy.returncode else live.stderr[-1800:] if live and live.returncode else None)
  (OUT/(n+".json")).write_text(json.dumps(dict(result=item,calls=calls),indent=2));print(json.dumps(item),flush=True);return item
 finally:shutil.rmtree(root)
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:results=list(pool.map(lane,REFUSED+ROLL))
summary=dict(binary=BIN,sha256=hashlib.sha256(pathlib.Path(BIN).read_bytes()).hexdigest(),lanes=results,refusedDeploys=sum(x["deploy"]!=0 for x in results if not x["rollWidening"]),falseRefusals=sum(x["deploy"]!=0 or x["rollback"]!=0 for x in results if x["knownFalseRefusal"]),rollHidden=sum(x["hidden"] or 0 for x in results if x["rollWidening"]),rollAllPass=all(x["deploy"]==x["rollback"]==x["forward"]==0 and x["hidden"]==0 for x in results if x["rollWidening"]),storesDeleted=not any(OUT.glob("*-store")))
(OUT/"summary.json").write_text(json.dumps(summary,indent=2));print(json.dumps({k:v for k,v in summary.items() if k!="lanes"}))
