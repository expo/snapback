import pathlib,subprocess,json,time,concurrent.futures
root=pathlib.Path(__file__).parent;cli=root/"node_modules/.bin/snapback4";manifest=json.loads((root/"inputs.json").read_text())
def run(job):
 cwd=pathlib.Path(job["cwd"]);results=[]
 for verb in ["check","test"]:
  command=[str(cli),verb]+(["--json"] if verb=="check" else []);start=time.monotonic()
  with (cwd/(verb+".stdout")).open("w")as out,(cwd/(verb+".stderr")).open("w")as err:
   r=subprocess.run(["timeout","--kill-after=3s","180s",*command],cwd=cwd,stdout=out,stderr=err)
  results.append({"command":command,"code":r.returncode,"seconds":round(time.monotonic()-start,3)})
  (cwd/"commands.json").write_text(json.dumps(results,indent=2)+"\n")
 return dict(job,commands=results)
with concurrent.futures.ThreadPoolExecutor(max_workers=4)as pool: results=list(pool.map(run,manifest))
(root/"results.json").write_text(json.dumps(results,indent=2)+"\n");print("snapshots",len(results))
