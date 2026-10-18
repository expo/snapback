import os,subprocess,json,time,pathlib
root=pathlib.Path.home()/"sb4-ws-integ16";sb=root/"snapback4";out=sb/"target/integ16-mac-pinned";out.mkdir(parents=True,exist_ok=True)
env=os.environ.copy();env.update(CARGO_INCREMENTAL="0",CARGO_PROFILE_DEV_DEBUG="0",CARGO_PROFILE_TEST_DEBUG="0",CARGO_BUILD_JOBS="8",RUST_TEST_THREADS="8");env["PATH"]=str(sb/"target/node-v24.13.1-darwin-arm64/bin")+":/opt/homebrew/bin:"+str(pathlib.Path.home()/".cargo/bin")+":"+str(pathlib.Path.home()/".bun/bin")+":"+env["PATH"]
assert subprocess.check_output(["node","--version"],env=env,timeout=10).strip()==b"v24.13.1"
rows=[]
def run(label,args,limit=7200):
 print(label,flush=True)
 with (out/(label+".log")).open("w") as f:r=subprocess.run(args,cwd=sb,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=limit)
 rows.append(dict(label=label,args=args,exit=r.returncode));(out/"results.json").write_text(json.dumps(rows,indent=2));print(label,r.returncode,flush=True);return r.returncode
scope=json.loads((root/"integ16-mac-scope.json").read_text())
for crate in ["snapback4","snapback4-lang"]:
 args=["cargo","test","-p",crate,"--no-fail-fast"]+(["--bin","snapback4"] if crate=="snapback4" else ["--lib"])
 for target in scope["targets"][crate]:args += ["--test",target]
 run("rust-"+crate,args)
run("native",["python3",str(root/"integ16-native-pinned.py")],10800)
files=["packages/snapback4/test/"+f for f in scope["clients"]]
run("clients",["node","scripts/run-client-tests.mjs","3","files"]+files,10800)
raise SystemExit(any(row["exit"] for row in rows))
