from pathlib import Path
import json,gzip,subprocess,tempfile,shutil,re,concurrent.futures,hashlib
b=Path.home()/"sb4-loop/integ24";survey=b/"survey-wave26-after-write40";out=b/"survey-wave26-audit-write40";out.mkdir(exist_ok=True);binary=Path("/home/ccheever/projects/snapback-sb4loop/snapback4/target/integ24-wave26-write40-bin/snapback4")
import time
while not (b/'client-wave26-write40-binding-before.json').exists():time.sleep(3)
while not(survey/'summary.json').exists():time.sleep(3)
rows=[json.loads(gzip.decompress(p.read_bytes()))for p in survey.glob("w*.json.gz")];bad=[r for r in rows if r["gates"] or any(r["calls"][k]["exit"]for k in ["freshDeploy","afterTestDeploy"])]
def audit(row):
 key=row["project"];dest=out/(key+".json.gz")
 if dest.exists():return
 src=(b/'corpus-wave26')/('wave'+str(row['wave'])+'/apps')/key.split("-",1)[1]/"snapback";old=b/"survey-audit-final"/(key+".json");prior=json.loads(old.read_text())if old.exists()else None
 with tempfile.TemporaryDirectory(prefix="integ24-wave26-audit-")as tmp:
  root=Path(tmp);shutil.copytree(src,root/"snapback",ignore=lambda path,names:[n for n in names if not n.endswith(".q")]);fixture=src.parent/"fixtures"
  if fixture.is_dir():shutil.copytree(fixture,root/"fixtures",ignore=shutil.ignore_patterns("node_modules","store.sqlite*","*-owner","*-token"))
  calls=[];edits=[];decisions=[]
  def run(args,budget=150):
   r=subprocess.run(["timeout",str(budget)+"s",str(binary),*args],cwd=root,capture_output=True,text=True,timeout=budget+20);calls.append(dict(argv=args,exit=r.returncode,stdout=r.stdout,stderr=r.stderr))
   try:j=json.loads(r.stdout)
   except:j={}
   return r,j
  q=root/"snapback/schema.q";text=q.read_text();classification=prior["classification"]if prior else "cleared by one-line intent"
  if prior:
   for line in prior["oneLineIntents"]:
    if line not in text:text+="\n"+line+"\n";edits.append(dict(operation="append",after=line))
   for repair in prior["realIntentRepairs"]:
    assert repair["before"]in text,(key,repair)
    if repair["before"].startswith("  "):
     start=text.index("table "+repair["table"]+":");end=text.find("\ntable ",start+1);end=len(text)if end<0 else end
     segment=text[start:end];assert repair["before"]in segment;segment=segment.replace(repair["before"],repair["after"],1);text=text[:start]+segment+text[end:]
    else:text=text.replace(repair["before"],repair["after"],1)
    edits.append(repair)
  elif "cobbler-repair"in key or "hop-kiln"in key:
   fields=["tickets.price"]if "cobbler"in key else["bales.grade","bales.buyer"]
   for field in fields:
    before=next(line for line in text.splitlines()if line.startswith("invariant "+field+" write only "));after=before.replace(" write only "," update only ");text=text.replace(before,after,1);edits.append(dict(before=before,after=after,reason="Specification limits later repricing/reassignment; intake may set the initial value."))
  elif "gem-lab"in key:
   before=next(line for line in text.splitlines()if line.startswith("invariant grades.read only "));after="\n".join(before.replace("grades.read","grades."+f+" read")for f in["grader","color","clarity","cut","comment"]);text=text.replace(before,after,1);edits.append(dict(before=before,after=after,reason="Specification protects graders and grade values; intake sees progress/counts."))
  elif "extinguisher"in key:
   before=next(line for line in text.splitlines()if line.startswith("invariant units.read only "));after=before+" or exists buildings[.building, manager = viewer]";text=text.replace(before,after,1);edits.append(dict(before=before,after=after,reason="Specification explicitly permits own-building managers; authored assertion omitted this reader."))
  elif "dog-sled"in key:pass
  else:raise AssertionError(key)
  q.write_text(text)
  r,check=run(["check","--json"])
  for d in check.get("securityReviews",[]):
   if d.get("gated")and not d.get("acknowledged")and d["code"]=="N_RETAINED_ROLE_GRANT":
    args=["check","--ack-security",d["id"],"--reason","Disposable specification experiment: this individually named retained grant deliberately survives role changes; this decision grants no runtime authority."];r,j=run(args);decisions.append(dict(code=d["code"],site=d["site"],argv=args,exit=r.returncode))
  if "dog-sled"in key:
   r,checked=run(["test"],900);r,d=run(["deploy","refused-probe","--json"])
   for v in d.get("security",{}).get("report",{}).get("invariants",[]):
    inv=v["invariant"]
    if v.get("status")=="refuted"and inv["site"]["file"].startswith("$derived/"):
     site=inv['site'];identifier=next(x['id']for x in d['security']['securityReviews']if x['code']=='N_DERIVED_WRITE_AUTHORITY'and x['site']==str(site['file'])+':'+str(site['line'])+':'+str(site['col']));args=["check","--ack-security",identifier,"--reason","The specification approves an over-limit guest, not an immutable weight. Only the owner approves; status guards remain. Weight correction after approval is deliberate."];r,j=run(args);decisions.append(dict(code="N_DERIVED_WRITE_AUTHORITY",site=inv["site"],argv=args,exit=r.returncode))
  r,check=run(["check","--json"]);checkExit=r.returncode
  r,fresh=run(["deploy","deployment-fresh","--json"]);freshExit=r.returncode
  r,test=run(["test"],900);testExit=r.returncode
  r,after=run(["deploy","deployment-after-test","--json"]);afterExit=r.returncode
  remaining=[d for d in check.get("securityReviews",[])if d.get("gated")and not d.get("acknowledged")]
  result=dict(project=key,wave=row["wave"],classification=classification,edits=edits,decisions=decisions,checkExit=checkExit,freshExit=freshExit,testExit=testExit,afterTestExit=afterExit,remaining=remaining,calls=calls,binarySha256=hashlib.sha256(binary.read_bytes()).hexdigest(),note="Conditional repair/intent experiments on disposable copies; no acceptance or modification of original applications.")
  if checkExit or freshExit or afterExit or remaining:result["classification"]="UNRESOLVED"
  dest.write_bytes(gzip.compress(json.dumps(result).encode()));print(key,result["classification"],checkExit,freshExit,testExit,afterExit,flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=10)as pool:list(pool.map(audit,bad))
