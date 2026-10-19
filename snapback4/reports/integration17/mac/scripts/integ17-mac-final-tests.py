import os,subprocess,pathlib,json,time,hashlib
root=pathlib.Path.home()/"sb4-ws-integ17";sb=root/"snapback4";out=root/"evidence/final";out.mkdir(parents=True,exist_ok=True);scope=json.loads((root/"integ17-mac-scope2.json").read_text());rows=[]
# Retain already-passing unchanged timing corpora; each has the same source and runtime path.
timers={"export-background.test.mjs","maintenance-evidence.test.mjs","test-file-runner.test.mjs","test-signals.test.mjs"}
first=(root/"evidence/clients.log").read_text()
retained=[name for name in scope["clients"] if name in timers and "-- client file ok: packages/snapback4/test/"+name+" (" in first]
scope["clients"]=[name for name in scope["clients"] if name not in retained]
(out/"reused-timers.json").write_text(json.dumps({"source":"c588ed5f0c","targetSource":scope["source"],"files":retained,"reason":"No delta in the four timing files, exporter/native custody implementations or process-test runner; fixes affect check/advice/guide/proof-account paths. Retain unchanged successful scoped evidence."},indent=2))
env=os.environ.copy();env.update(CARGO_INCREMENTAL="0",CARGO_PROFILE_DEV_DEBUG="0",CARGO_PROFILE_TEST_DEBUG="0",CARGO_BUILD_JOBS="8",RUST_TEST_THREADS="8",CI="1",EXPO_NO_TELEMETRY="1");env["PATH"]=str(sb/"target/node-v24.13.1-darwin-arm64/bin")+":/opt/homebrew/bin:"+str(pathlib.Path.home()/".cargo/bin")+":"+str(pathlib.Path.home()/".bun/bin")+":"+env["PATH"]
assert subprocess.check_output(["node","--version"],env=env,timeout=10).strip()==b"v24.13.1"
def run(label,args,cwd=sb,limit=7200):
 print(label,flush=True);start=time.time()
 try:
  with (out/(label+".log")).open("w") as f:r=subprocess.run(args,cwd=cwd,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=limit)
  code=r.returncode
 except subprocess.TimeoutExpired:code=124
 rows.append(dict(label=label,args=args,cwd=str(cwd),exit=code,seconds=round(time.time()-start,3)));(out/"test-results.json").write_text(json.dumps(rows,indent=2));print(label,code,flush=True)
 return code
env["SNAPBACK4_FENCE_PUBLISHED"]=str(root/"target/published-0.2.33-cache")
prepare="import {published} from './packages/snapback4/test/helpers/published-capabilities.mjs';await published(process.env.SNAPBACK4_FENCE_PUBLISHED,'"+str(root/"target/published-0.2.33")+"',console.log);"
run("published-legacy-setup",["node","--input-type=module","-e",prepare],limit=600)
env["SNAPBACK4_F2_LEGACY_BIN"]=str(root/"target/published-0.2.33/snapback4-darwin-arm64/package/snapback4")
run("build",["cargo","build","-p","snapback4"])
run("client-build",["bun","run","--cwd","packages/snapback4","build"])
for crate in ["snapback4-lang","snapback4-sim","snapback4"]:
 args=["cargo","test","-p",crate,"--no-fail-fast"]+(["--bin","snapback4"] if crate=="snapback4" else ["--lib"])
 for target in scope["targets"][crate]:args += ["--test",target]
 run("rust-"+crate,args)
run("clients",["node","scripts/run-client-tests.mjs","3","files"]+["packages/snapback4/test/"+f for f in scope["clients"]],limit=14400)
raise SystemExit(any(row["exit"] for row in rows))
