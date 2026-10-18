from pathlib import Path
import os,subprocess,json,time
root=Path.home()/"sb4-ws-integ16"; sb=root/"snapback4";out=sb/"target/integ16-mac-pinned";end=time.time()+10800
while True:
 rows=json.loads((out/"results.json").read_text())
 if any(r["label"]=="clients" and r["exit"]==0 for r in rows):break
 if time.time()>end:raise RuntimeError("clean Mac pool deadline")
 time.sleep(5)
env=os.environ.copy();env.update(CARGO_INCREMENTAL="0",CARGO_PROFILE_DEV_DEBUG="0",CARGO_PROFILE_TEST_DEBUG="0",CARGO_BUILD_JOBS="8",RUST_TEST_THREADS="8");env["PATH"]=str(sb/"target/node-v24.13.1-darwin-arm64/bin")+":/opt/homebrew/bin:"+str(Path.home()/".cargo/bin")+":"+str(Path.home()/".bun/bin")+":"+env["PATH"]
for label,args in [("final-build",["cargo","build","-p","snapback4"]),("final-guide",["cargo","test","-p","snapback4-lang","--test","guide","--no-fail-fast"]),("final-client-index-reset",["node","scripts/run-client-tests.mjs","1","files","packages/snapback4/test/api-index.test.mjs","packages/snapback4/test/dev-reset.test.mjs"])]:
 print(label,flush=True)
 with (out/(label+".log")).open("w") as f:r=subprocess.run(args,cwd=sb,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=3600)
 rows.append(dict(label=label,args=args,exit=r.returncode));(out/"results.json").write_text(json.dumps(rows,indent=2));print(label,r.returncode,flush=True)
raise SystemExit(any(r["exit"] for r in rows))
