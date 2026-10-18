import os,subprocess,pathlib,json,tarfile,urllib.request,time
root=pathlib.Path.home()/"sb4-ws-integ17";out=root/"evidence";out.mkdir(exist_ok=True);rows=[]
with tarfile.open(root/"integ17-mac-source.tar") as t:t.extractall(root)
sb=root/"snapback4";env=os.environ.copy();env.update(CARGO_INCREMENTAL="0",CARGO_PROFILE_DEV_DEBUG="0",CARGO_PROFILE_TEST_DEBUG="0",CARGO_BUILD_JOBS="8",RUST_TEST_THREADS="8",CI="1",EXPO_NO_TELEMETRY="1");env["PATH"]=str(sb/"target/node-v24.13.1-darwin-arm64/bin")+":/opt/homebrew/bin:"+str(pathlib.Path.home()/".cargo/bin")+":"+str(pathlib.Path.home()/".bun/bin")+":"+env["PATH"]
def run(label,args,cwd=sb,limit=3600):
 print(label,flush=True)
 with (out/(label+".log")).open("w") as f:r=subprocess.run(args,cwd=cwd,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=limit)
 rows.append(dict(label=label,args=args,cwd=str(cwd),exit=r.returncode));(out/"setup-results.json").write_text(json.dumps(rows,indent=2));print(label,r.returncode,flush=True)
 if r.returncode:raise SystemExit(r.returncode)
node=sb/"target/node-v24.13.1-darwin-arm64";node.parent.mkdir(parents=True,exist_ok=True)
if not node.exists():
 archive=root/"node-v24.13.1-darwin-arm64.tar.gz";urllib.request.urlretrieve("https://nodejs.org/dist/v24.13.1/node-v24.13.1-darwin-arm64.tar.gz",archive)
 with tarfile.open(archive) as t:t.extractall(node.parent)
run("toolchain",["node","--version"],limit=10)
run("git-init",["git","init"],cwd=root,limit=30)
run("git-add",["git","add","snapback4","llp","benchmarks"],cwd=root,limit=60)
run("git-commit",["git","-c","user.name=Charlie Cheever","-c","user.email=ccheever@firewoodagent.com","commit","-m","Integration17 source snapshot "+(root/"integ17-mac-source-head").read_text().strip()],cwd=root,limit=60)
run("install",["bun","install","--frozen-lockfile"])
run("targets",["rustup","target","add","wasm32-unknown-unknown","aarch64-apple-ios","aarch64-apple-ios-sim"],limit=1800)
run("build",["cargo","build","-p","snapback4"])
run("wasm",["bash","scripts/build-wasm.sh"])
run("client-build",["bun","run","--cwd","packages/snapback4","build"])
run("playwright",["bun","x","playwright","install","chromium"],limit=1800)
