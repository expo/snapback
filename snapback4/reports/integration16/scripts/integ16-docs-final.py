from pathlib import Path
import os,time,subprocess
end=time.time()+21600
while not Path("/tmp/integ16-rust-final-ready").exists():
 if time.time()>end:raise RuntimeError("final Rust deadline")
 time.sleep(10)
env=os.environ.copy();env.update(CARGO_INCREMENTAL="0",CARGO_PROFILE_DEV_DEBUG="0",CARGO_PROFILE_TEST_DEBUG="0")
with open("/tmp/integ16-docs-budget-final.log","w") as log:r=subprocess.run(["node","scripts/docs-budget.mjs"],cwd="/home/ccheever/projects/snapback-sb4loop/snapback4",env=env,stdout=log,stderr=subprocess.STDOUT,timeout=1200)
print("final docs budget",r.returncode,flush=True);raise SystemExit(r.returncode)
