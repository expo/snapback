import os,subprocess,json,pathlib,time
root=pathlib.Path.home()/"sb4-ws-integ16";sb=root/"snapback4";out=sb/"target/integ16-native-pinned";out.mkdir(parents=True,exist_ok=True)
env=os.environ.copy();env.update(CARGO_INCREMENTAL="0",CARGO_PROFILE_DEV_DEBUG="0",CARGO_PROFILE_TEST_DEBUG="0",CARGO_BUILD_JOBS="6",CI="1",EXPO_NO_TELEMETRY="1",EXPO_PUBLIC_SNAPBACK_URL="http://127.0.0.1:26930");env["PATH"]=str(sb/"target/node-v24.13.1-darwin-arm64/bin")+":/opt/homebrew/bin:"+str(pathlib.Path.home()/".cargo/bin")+":"+str(pathlib.Path.home()/".bun/bin")+":"+env["PATH"]
env["TMPDIR"]=str(out/"tmp")+"/"; (out/"tmp").mkdir(exist_ok=True); env["EXPO_NO_CACHE"]="1"
rows=[]
def run(label,args,cwd=sb,limit=3600):
 print(label,flush=True)
 with (out/(label+".log")).open("w") as f:
  r=subprocess.run(args,cwd=cwd,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=limit)
 rows.append(dict(label=label,args=args,cwd=str(cwd),code=r.returncode));(out/"results.json").write_text(json.dumps(rows,indent=2));print(label,r.returncode,flush=True)
 if r.returncode:raise SystemExit(r.returncode)
udid=(sb/"target/integ16-native-retry/udid").read_text().strip()
try:
 run("boot",["xcrun","simctl","boot",udid],limit=120)
 run("boot-ready",["xcrun","simctl","bootstatus",udid,"-b"],limit=600)
 run("expo-build",["bun","x","expo","run:ios","--configuration","Release","--device",udid,"--no-bundler","--no-build-cache"],cwd=sb/"apps/chat-expo",limit=7200)
 result=subprocess.run(["xcrun","simctl","terminate",udid,"dev.snapback4.chat"],env=env,capture_output=True,text=True,timeout=120)
 (out/"terminate.log").write_text(result.stdout+result.stderr)
 app=pathlib.Path(subprocess.check_output(["xcrun","simctl","get_app_container",udid,"dev.snapback4.chat","app"],env=env,timeout=30,text=True).strip())
 bundle=(app/"main.jsbundle").read_bytes();assert b"http://127.0.0.1:26930" in bundle,"Release bundle does not carry the requested backend URL"
 env.update(WITNESS_UDID=udid,WITNESS_PORT="26930",WITNESS_ARTIFACTS=str(out/"witness"))
 run("expo-witness",["node","witness/expo.mjs"],limit=1800)
finally:
 subprocess.run(["xcrun","simctl","shutdown",udid],env=env,timeout=120)
