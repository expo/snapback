from pathlib import Path
import subprocess,os,json,time
root=Path("/home/ccheever/projects/snapback-sb4loop/snapback4");os.chdir(root)
env=os.environ.copy();env.update(CARGO_INCREMENTAL="0",CARGO_PROFILE_DEV_DEBUG="0",CARGO_PROFILE_TEST_DEBUG="0",CARGO_BUILD_JOBS="8",SNAPBACK4_BIN=str(root/"target/debug/snapback4"));env["PATH"]="/home/ccheever/.bun-1.4.2/bin:"+env["PATH"]
end=time.time()+21600
# The device trace producer already passed in full Rust1; regenerate with its compiled target.
results=[]
def run(label,args,limit=14400):
 with open("/tmp/integ16-"+label+".log","w") as log:
  r=subprocess.run(args,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=limit)
 results.append(dict(label=label,exit=r.returncode));Path("/tmp/integ16-clients-results.json").write_text(json.dumps(results,indent=2));return r.returncode
run("trace-producer",["target/debug/deps/event_slots_trace-c2bb15c603cdee79"])
files=sorted(str(p) for p in Path("packages/snapback4/test").glob("*.test.mjs"));models=[p for p in files if p.endswith(("app-session-model.test.mjs","online-client-model.test.mjs"))];ordinary=[p for p in files if p not in models]
slots=max(1,min(24,len(os.sched_getaffinity(0))//3));print(len(ordinary),slots,flush=True)
run("clients-pool",["node","scripts/run-client-tests.mjs",str(slots),"files"]+ordinary)
run("clients-models",["node","scripts/run-client-tests.mjs","1","models"]+models)
run("clients-fixtures",["node","scripts/run-client-tests.mjs","1","files","fixtures/"])
raise SystemExit(0 if all(r["exit"]==0 for r in results) else 1)
