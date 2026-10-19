import pathlib,time,json,subprocess,os,tarfile
r=pathlib.Path.home()/"sb4-ws-integ17";deadline=time.time()+21600
while True:
 p=r/"evidence/test-results.json";rows=json.loads(p.read_text()) if p.exists() else []
 if any(v["label"]=="clients" for v in rows):break
 if time.time()>deadline:raise RuntimeError("first Mac scope deadline")
 time.sleep(5)
with tarfile.open(r/"integ17-mac-overlay2.tar") as t:t.extractall(r)
p=r/"evidence/source-overlays.json";rows=json.loads(p.read_text());rows.append({"base":"c588ed5f0c","overlay":"0d47731300","tar":"integ17-mac-overlay2.tar"});p.write_text(json.dumps(rows,indent=2))
result=subprocess.run(["python3",str(r/"integ17-mac-final-tests.py")],cwd=r,timeout=28800);print("final Mac scope",result.returncode,flush=True)
result=subprocess.run(["python3",str(r/"integ17-mac-native.py")],cwd=r,timeout=18000);print("native",result.returncode,flush=True)
