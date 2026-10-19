import pathlib,time,json,subprocess
root=pathlib.Path.home()/"sb4-ws-integ17";deadline=time.time()+18000
while True:
 p=root/"evidence/native/results.json";rows=json.loads(p.read_text()) if p.exists() else []
 if any(row["label"]=="late-docs-budget" and row["exit"]==0 for row in rows):break
 if any(row["exit"] for row in rows):raise RuntimeError("native preparation failed before stable packed source")
 if time.time()>deadline:raise RuntimeError("packed source preparation deadline")
 time.sleep(3)
r=subprocess.run(["python3",str(root/"integ17-mac-packed.py")],cwd=root,timeout=9000);raise SystemExit(r.returncode)
