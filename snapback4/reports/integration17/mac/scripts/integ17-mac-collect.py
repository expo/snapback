import pathlib,hashlib,json,tarfile,os
r=pathlib.Path.home()/"sb4-ws-integ17";out=r/"evidence";spec=json.loads((r/"integ17-mac-expected-final.json").read_text());rows=[]
for name,record in spec["files"].items():
 p=r/name
 if not p.exists() and not p.is_symlink():rows.append({"file":name,"error":"missing"});continue
 data=os.readlink(p).encode() if p.is_symlink() else p.read_bytes()
 actual=hashlib.sha1(b"blob "+str(len(data)).encode()+b"\0"+data).hexdigest()
 if actual!=record["gitBlob"]:rows.append({"file":name,"expected":record["gitBlob"],"actual":actual})
(out/"final-source-binding.json").write_text(json.dumps({"source":spec["source"],"checked":len(spec["files"]),"differences":rows},indent=2))
with tarfile.open(r/"integ17-mac-evidence.tar.gz","w:gz") as t:
 for p in sorted(out.rglob("*")):
  if p.is_file() and not any(x in p.parts for x in ["node_modules","tmp",".git"]):t.add(p,arcname=str(p.relative_to(r)),recursive=False)
 for p in sorted(r.glob("integ17-mac-*.py")):t.add(p,arcname="scripts/"+p.name)
 for p in sorted(r.glob("integ17-mac-*.mjs")):t.add(p,arcname="scripts/"+p.name)
 for name in ["integ17-mac-scope.json","integ17-mac-scope2.json","integ17-mac-expected-final.json"]:t.add(r/name,arcname="scripts/"+name)
print(json.dumps({"source":spec["source"],"checked":len(spec["files"]),"differences":rows,"archiveBytes":(r/"integ17-mac-evidence.tar.gz").stat().st_size},indent=2))
