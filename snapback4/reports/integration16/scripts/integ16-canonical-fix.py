from pathlib import Path
import time,json,subprocess
root=Path("/home/ccheever/projects/snapback-sb4loop");receipt=root/"snapback4/target/integ16-qualification3/consumer.json";end=time.time()+10800
while not receipt.exists():
 if time.time()>end:raise RuntimeError("packed qualification deadline")
 time.sleep(5)
r=json.loads(receipt.read_text());assert r["version"]=="0.4.32" and r["source"].startswith("fe0420d7c0") and r["mode"]=="consumer-only"
p=root/"snapback4/crates/snapback4/tests/replay.rs";s=p.read_text();old='let reported = if args.contains(&"--release") { path } else { path.canonicalize().unwrap() };';assert old in s;p.write_text(s.replace(old,'let reported = path.canonicalize().unwrap();'))
subprocess.run(["git","add",str(p)],cwd=root,check=True,timeout=30)
subprocess.run(["git","-c","user.name=Charlie Cheever","-c","user.email=ccheever@firewoodagent.com","commit","-m","snapback4: expect canonical owning paths in Mac replay checks"],cwd=root,check=True,timeout=30)
Path("/tmp/integ16-canonical-fix-ready").write_text("Mac replay24 passes; Linux full repeat includes this expectation\n")
