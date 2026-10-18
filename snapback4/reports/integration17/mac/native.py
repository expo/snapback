import os,subprocess,json,pathlib,time,hashlib
root=pathlib.Path.home()/"sb4-ws-integ17";sb=root/"snapback4";out=root/"evidence/native";out.mkdir(parents=True,exist_ok=True);env=os.environ.copy();env.update(CARGO_INCREMENTAL="0",CARGO_PROFILE_DEV_DEBUG="0",CARGO_PROFILE_TEST_DEBUG="0",CARGO_BUILD_JOBS="6",CI="1",EXPO_NO_TELEMETRY="1",EXPO_PUBLIC_SNAPBACK_URL="http://127.0.0.1:26933",EXPO_NO_CACHE="1");env["PATH"]=str(sb/"target/node-v24.13.1-darwin-arm64/bin")+":/opt/homebrew/bin:"+str(pathlib.Path.home()/".cargo/bin")+":"+str(pathlib.Path.home()/".bun/bin")+":"+env["PATH"];env["TMPDIR"]=str(out/"tmp")+"/";(out/"tmp").mkdir(exist_ok=True);rows=[]
def run(label,args,cwd=sb,limit=3600):
 print(label,flush=True);start=time.time()
 with (out/(label+".log")).open("w") as f:r=subprocess.run(args,cwd=cwd,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=limit)
 rows.append(dict(label=label,args=args,cwd=str(cwd),exit=r.returncode,seconds=round(time.time()-start,3)));(out/"results.json").write_text(json.dumps(rows,indent=2));print(label,r.returncode,flush=True)
 if r.returncode:raise SystemExit(r.returncode)
run("xcframework",["bash","scripts/build-xcframework.sh"],limit=7200)
run("chat-api",[str(sb/"target/debug/snapback4"),"check"],cwd=sb/"apps/chat",limit=120)
run("expo-api",[str(sb/"target/debug/snapback4"),"check"],cwd=sb/"apps/chat-expo",limit=120) if (sb/"apps/chat-expo/snapback").exists() else None
runtimes=json.loads(subprocess.check_output(["xcrun","simctl","list","runtimes","-j"],env=env,timeout=30))["runtimes"];runtime=next(r["identifier"] for r in runtimes if r.get("isAvailable") and "iOS" in r["name"])
udid=subprocess.check_output(["xcrun","simctl","create","Integration17 native witness","com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro",runtime],env=env,timeout=120,text=True).strip();(out/"udid").write_text(udid)
try:
 run("boot",["xcrun","simctl","boot",udid],limit=120)
 run("boot-ready",["xcrun","simctl","bootstatus",udid,"-b"],limit=600)
 run("expo-build",["bun","x","expo","run:ios","--configuration","Release","--device",udid,"--no-bundler","--no-build-cache"],cwd=sb/"apps/chat-expo",limit=10800)
 result=subprocess.run(["xcrun","simctl","terminate",udid,"dev.snapback4.chat"],env=env,capture_output=True,text=True,timeout=120);(out/"terminate.log").write_text(result.stdout+result.stderr)
 app=pathlib.Path(subprocess.check_output(["xcrun","simctl","get_app_container",udid,"dev.snapback4.chat","app"],env=env,timeout=30,text=True).strip());bundle=(app/"main.jsbundle").read_bytes();assert b"http://127.0.0.1:26933" in bundle,"Release bundle does not carry requested backend URL"
 (out/"bundle.json").write_text(json.dumps({"app":str(app),"sha256":hashlib.sha256(bundle).hexdigest(),"backend":"http://127.0.0.1:26933"},indent=2));env.update(WITNESS_UDID=udid,WITNESS_PORT="26933",WITNESS_ARTIFACTS=str(out/"witness"))
 run("expo-witness",["node","witness/expo.mjs"],limit=1800)
finally:subprocess.run(["xcrun","simctl","shutdown",udid],env=env,timeout=120)
