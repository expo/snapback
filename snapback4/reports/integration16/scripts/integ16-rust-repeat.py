from pathlib import Path
import subprocess,os,time,re,json
end=time.time()+18000
while Path("/proc/1478804").exists():
 if time.time()>end:raise RuntimeError("first Rust run deadline")
 time.sleep(10)
while not Path("/tmp/integ16-canonical-fix-ready").exists():
 if time.time()>end:raise RuntimeError("final test correction deadline")
 time.sleep(5)
while not Path("/tmp/integ16-client-fixes-ready").exists():
 if time.time()>end:raise RuntimeError("client integration fixes deadline")
 time.sleep(5)
s=Path("/tmp/integ16-rust-full1.log").read_text();reds=re.findall(r"^test .* \.\.\. FAILED$|^error: test failed",s,re.M)
if reds:print("First full run has unresolved failures",reds,flush=True);raise SystemExit(1)
env=os.environ.copy();env.update(CARGO_INCREMENTAL="0",CARGO_PROFILE_DEV_DEBUG="0",CARGO_PROFILE_TEST_DEBUG="0",CARGO_BUILD_JOBS="12",RUST_TEST_THREADS="8")
args=["cargo","test","-p","snapback4-core","-p","snapback4-lang","-p","snapback4-device","-p","snapback4-sim","-p","snapback4","--no-fail-fast"]
print("Starting full Rust repeat",flush=True)
with open("/tmp/integ16-rust-full2.log","w") as log:r=subprocess.run(args,cwd="/home/ccheever/projects/snapback-sb4loop/snapback4",env=env,stdout=log,stderr=subprocess.STDOUT,timeout=14400)
Path("/tmp/integ16-rust-repeat-result.json").write_text(json.dumps({"args":args,"exit":r.returncode},indent=2));print("Full Rust repeat",r.returncode,flush=True)
if r.returncode==0:Path("/tmp/integ16-rust-final-ready").write_text("full repeat passed\n")
raise SystemExit(r.returncode)
