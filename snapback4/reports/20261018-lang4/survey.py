import pathlib,subprocess,tempfile,shutil,json,sys,hashlib
results=[]
for schema in sorted(pathlib.Path.home().glob("sb4-loop/wave15/apps/*/snapback/schema.q")):
 with tempfile.TemporaryDirectory(prefix="lang4-survey-") as tmp:
  dst=pathlib.Path(tmp)/"snapback";dst.mkdir()
  for source in schema.parent.glob("*.q"): shutil.copyfile(source,dst/source.name)
  p=subprocess.run(["timeout","30",sys.argv[1],"check","--json"],cwd=tmp,capture_output=True,text=True)
  try: data=json.loads(p.stdout)
  except ValueError: data={"raw":p.stdout,"stderr":p.stderr}
  results.append({"lane":schema.parent.parent.name,"exit":p.returncode,"sha256":hashlib.sha256(schema.read_bytes()).hexdigest(),"result":data})
pathlib.Path(sys.argv[2]).write_text(json.dumps(results,indent=2)+"\n")
print(len(results),"schemas",sum(r["exit"]==0 for r in results),"ok",sum(len(r["result"].get("notes",[])) for r in results),"notes")
