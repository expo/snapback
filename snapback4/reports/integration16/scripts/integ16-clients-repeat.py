from pathlib import Path
import time,json,subprocess,os,shutil
end=time.time()+21600; results=Path("/tmp/integ16-clients-results.json")
while True:
 rows=json.loads(results.read_text()) if results.exists() else []
 if any(r["label"]=="clients-fixtures" for r in rows) and Path("/tmp/integ16-rust-final-ready").exists():break
 if time.time()>end:raise RuntimeError("initial client discovery and final Rust deadline")
 time.sleep(10)
shutil.copy(results,"/tmp/integ16-clients-first-results.json")
for name in ["trace-producer","clients-pool","clients-models","clients-fixtures"]:
 p=Path("/tmp/integ16-"+name+".log")
 if p.exists():p.rename(Path("/tmp/integ16-first-"+name+".log"))
print("Starting complete final client pool, full models, fixtures after Rust drains",flush=True)
env=os.environ.copy();env.update(CARGO_INCREMENTAL="0",CARGO_PROFILE_DEV_DEBUG="0",CARGO_PROFILE_TEST_DEBUG="0")
with open("/tmp/integ16-clients-final-run.log","w") as f:r=subprocess.run(["python3","/tmp/integ16-clients.py"],env=env,stdout=f,stderr=subprocess.STDOUT,timeout=18000)
Path("/tmp/integ16-clients-final-result.json").write_text(json.dumps({"exit":r.returncode,"results":json.loads(results.read_text())},indent=2));print("Complete final client pass",r.returncode,flush=True)
raise SystemExit(r.returncode)
