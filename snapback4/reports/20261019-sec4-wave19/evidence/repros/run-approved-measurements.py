import pathlib,subprocess,os,time,shutil,hashlib,json
from concurrent.futures import ThreadPoolExecutor
root=pathlib.Path(__file__).resolve().parent
project=root.parents[1]
compiled=project/"target/x86_64-unknown-linux-musl/production/snapback4"
if not (root/"final-build-complete").exists():raise SystemExit("run after final build completion")
binary=root/"shipping-c4a-bin";assert not binary.exists(),"never overwrite a pinned campaign executable";shutil.copy2(compiled,binary)
(root/"shipping-c4a-binary.json").write_text(json.dumps({"sha256":hashlib.sha256(binary.read_bytes()).hexdigest(),"commit":"c4a21db85a9459ebd790b951de4df22de35d3c73"},indent=2)+"\n")
base=["python3",str(root/"measure.py"),str(binary)]
tasks=[base+[str(root/"shipping-c4a-corpus.json"),"--waves","15,16,18","--jobs","2"],base+[str(root/"shipping-c4a-wave18-tests.json"),"--waves","18","--verb","test","--jobs","2"],base+[str(root/"shipping-c4a-intent-controls.json"),"--waves","18","--verb","test","--jobs","2","--lanes","010,011,025,026,032,045","--intent-corrections"],["python3",str(root/"survey.py"),str(binary),"shipping-c4a-wave19","015","019","021","026","032","033","034","041","044","047"],["python3",str(root/"relations.py"),str(binary)]]
tasks.extend(["python3",str(root/"highs.py"),str(binary),"--label","shipping-c4a-"+n,"--lane",n] for n in ["004","013","015","019","021","026","032","033","041","044","047"])
def run(args):
 print("START",args,flush=True)
 r=subprocess.run(args,timeout=1800)
 print("DONE",r.returncode,args,flush=True)
 return r.returncode
with ThreadPoolExecutor(max_workers=3) as pool:results=list(pool.map(run,tasks))
print("ALL MEASUREMENTS",results,flush=True)
if any(results):raise SystemExit(1)
