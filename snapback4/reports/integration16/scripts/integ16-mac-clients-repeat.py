from pathlib import Path
import subprocess, os, time, json
root=Path.home()/"sb4-ws-integ16"; sb=root/"snapback4"; out=sb/"target/integ16-mac-pinned"
end=time.time()+10800
while True:
 rows=json.loads((out/"results.json").read_text())
 if any(r["label"]=="clients" for r in rows):break
 if time.time()>end:raise RuntimeError("first pinned client deadline")
 time.sleep(5)
(out/"first-pinned-results.json").write_text(json.dumps(rows,indent=2));(out/"clients.log").rename(out/"clients-first-pinned.log")
env=os.environ.copy();env.update(CARGO_INCREMENTAL="0",CARGO_PROFILE_DEV_DEBUG="0",CARGO_PROFILE_TEST_DEBUG="0",CARGO_BUILD_JOBS="8",RUST_TEST_THREADS="8");env["PATH"]=str(sb/"target/node-v24.13.1-darwin-arm64/bin")+":/opt/homebrew/bin:"+str(Path.home()/".cargo/bin")+":"+str(Path.home()/".bun/bin")+":"+env["PATH"]
assert subprocess.check_output(["node","--version"],env=env,timeout=10).strip()==b"v24.13.1"
files=["packages/snapback4/test/"+f for f in json.loads((root/"integ16-mac-scope.json").read_text())["clients"]]
args=["node","scripts/run-client-tests.mjs","3","files"]+files
print("Repeating full pinned Mac client scope",len(files),flush=True)
with (out/"clients.log").open("w") as log:r=subprocess.run(args,cwd=sb,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=10800)
rows=[r for r in rows if r["label"]!="clients"]+[dict(label="clients",args=args,exit=r.returncode)]
(out/"results.json").write_text(json.dumps(rows,indent=2));print("Mac full client repeat",r.returncode,flush=True)
raise SystemExit(r.returncode)
