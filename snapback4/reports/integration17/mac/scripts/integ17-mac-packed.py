import pathlib,os,subprocess,json,shutil,hashlib,time
root=pathlib.Path.home()/"sb4-ws-integ17";sb=root/"snapback4";out=root/"evidence/packed";out.mkdir(parents=True,exist_ok=True);packs=root/"target/mac-verification-packs";packs.mkdir(parents=True,exist_ok=True)
env=os.environ.copy();env.update(CARGO_INCREMENTAL="0",CARGO_PROFILE_DEV_DEBUG="0",CARGO_PROFILE_TEST_DEBUG="0",CI="1",EXPO_NO_TELEMETRY="1");env["PATH"]=str(sb/"target/node-v24.13.1-darwin-arm64/bin")+":/opt/homebrew/bin:"+str(pathlib.Path.home()/".cargo/bin")+":"+str(pathlib.Path.home()/".bun/bin")+":"+env["PATH"];rows=[]
def run(label,args,cwd=sb,limit=3600):
 print(label,flush=True);start=time.time()
 with (out/(label+".log")).open("w") as f:p=subprocess.run(args,cwd=cwd,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=limit)
 rows.append({"label":label,"args":args,"cwd":str(cwd),"exit":p.returncode,"seconds":round(time.time()-start,3)});(out/"commands.json").write_text(json.dumps(rows,indent=2));print(label,p.returncode,flush=True)
 if p.returncode:raise SystemExit(p.returncode)
run("pack-client",["npm","pack","--ignore-scripts","--json","--pack-destination",str(packs)],sb/"packages/snapback4",120)
client=packs/json.loads((out/"pack-client.log").read_text())[0]["filename"]
stage=packs/"darwin-stage";stage.mkdir(exist_ok=True)
for name in ["package.json","THIRD-PARTY-NOTICES"]:shutil.copy2(sb/"packages/snapback4-darwin-arm64"/name,stage/name)
shutil.copy2(sb/"target/debug/snapback4",stage/"snapback4")
run("pack-platform",["npm","pack","--ignore-scripts","--json","--pack-destination",str(packs)],stage,120)
platform=packs/json.loads((out/"pack-platform.log").read_text())[0]["filename"]
digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
(out/"artifacts.json").write_text(json.dumps({"client":{"path":str(client),"sha256":digest(client)},"platform":{"path":str(platform),"sha256":digest(platform)},"binarySha256":digest(stage/"snapback4"),"qualification":"scratch verification only; unsigned debug binary; no publication receipt"},indent=2))
run("proofs",["node",str(root/"integ17-mac-packed.mjs"),str(sb),str(client),str(platform),str(out/"proofs")],limit=7200)
