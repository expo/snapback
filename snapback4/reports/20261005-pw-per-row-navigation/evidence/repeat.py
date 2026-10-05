import subprocess,sys,os,time,json,pathlib
out=pathlib.Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
count=int(sys.argv[2]);hogs=int(sys.argv[3]);command=sys.argv[4:]
children=[]
try:
 for _ in range(hogs):children.append(subprocess.Popen([sys.executable,'-c','while True: pass']))
 with (out/'receipts.jsonl').open('w') as receipts:
  for i in range(1,count+1):
   start=time.time()
   with (out/f'{i:03}.log').open('w') as log:
    result=subprocess.run(command,stdout=log,stderr=subprocess.STDOUT)
   row={'run':i,'exit':result.returncode,'seconds':round(time.time()-start,3),'affinity':sorted(os.sched_getaffinity(0)) if hasattr(os,'sched_getaffinity') else None,'hogPids':[p.pid for p in children]}
   receipts.write(json.dumps(row)+'\n');receipts.flush();print(json.dumps(row),flush=True)
finally:
 for child in children:child.terminate()
 for child in children:child.wait()
