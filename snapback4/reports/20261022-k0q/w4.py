"""Local W4 comparison harness; only root paths differ from the captured run script."""
import concurrent.futures as cf, json, pathlib, subprocess as sp, time, urllib.request, shutil, sys, signal, hashlib
root=pathlib.Path(__file__).resolve().parents[2]
base=root/'target/k0q-w4';base.mkdir(exist_ok=True)
binary=pathlib.Path(sys.argv[1]); label=sys.argv[2]; run=base/label;run.mkdir(exist_ok=False)
app=run/'app';(app/'snapback').mkdir(parents=True)
source=(root/'experiments/scale-controls/snapback-app/snapback/schema.q').read_text()
(app/'snapback/schema.q').write_text(source)
processes=[]
def start(args):
 out=(run/(args[0]+'.out')).open('w');err=(run/(args[0]+'.err')).open('w');p=sp.Popen([str(binary),*map(str,args)],cwd=app,stdout=out,stderr=err);processes.append(p)
 with (run/'pids.jsonl').open('a') as f:f.write(json.dumps({'pid':p.pid,'args':list(map(str,args))})+'\n')
 for _ in range(600):
  if p.poll() is not None:raise RuntimeError((run/(args[0]+'.err')).read_text())
  lines=(run/(args[0]+'.out')).read_text().splitlines()
  if lines and lines[0].startswith('http'):return p,lines[0]
  time.sleep(.05)
 raise RuntimeError('ready timeout')
def stop(p):
 p.send_signal(signal.SIGTERM);p.wait(timeout=30)
def http(url,path,payload=None,token=None):
 headers={'Content-Type':'application/json'}
 if token:headers['Authorization']='Bearer '+token
 req=urllib.request.Request(url+path,data=None if payload is None else json.dumps(payload).encode(),headers=headers)
 with urllib.request.urlopen(req,timeout=30) as r:return json.load(r)
try:
 p,url=start(['dev','--port','0','--no-watch'])
 rows=[{'table':'rooms','row':{'id':'r0000'}}]+[{'table':'counters','row':{'id':f'c{i:04}','owner':f'bench:{i}','room':'r0000'}} for i in range(32)]
 assert http(url,'/seed',rows)['seeded']==33
 stop(p)
 release=run/'deployment';release.mkdir()
 import sqlite3
 with sqlite3.connect(app/'.snapback4/store.sqlite') as src,sqlite3.connect(release/'store.sqlite') as dst:src.backup(dst)
 sp.run([str(binary),'deploy',str(release),'--json'],cwd=app,check=True,stdout=(run/'deploy.json').open('w'))
 p,url=start(['serve',str(release),'--port','0'])
 service=sp.check_output([str(binary),'token','--service','fixture','--release',str(release),'--quiet'],cwd=app,text=True).strip()
 tokens=[http(url,'/auth/session',{'principal':f'bench:{i}','kind':'member','days':7},service)['session']['token'] for i in range(32)]
 def worker(i,count):
  lat=[]
  for n in range(count):
   at=time.perf_counter();reply=http(url,'/m/increment',{'args':{'counter':f'c{i:04}'}},tokens[i]);lat.append((time.perf_counter()-at)*1000)
   assert reply.get('state')=='sent',reply
  return lat
 trials=[]
 with cf.ThreadPoolExecutor(max_workers=32) as pool:
  list(pool.map(lambda i:worker(i,5),range(32)))
  for rep in range(3):
   at=time.perf_counter();lat=sum(pool.map(lambda i:worker(i,50),range(32)),[]);elapsed=time.perf_counter()-at;lat.sort()
   trials.append({'ops':len(lat),'elapsed_s':elapsed,'ops_s':len(lat)/elapsed,'p50_ms':lat[len(lat)//2],'p99_ms':lat[int(len(lat)*.99)],'max_ms':max(lat)})
 stop(p)
 output=sp.check_output([str(binary),'sql','SELECT sum(n) AS n FROM counters','--release',str(release),'--json-objects'],cwd=app,text=True)
 result={'label':label,'binary_sha256':hashlib.sha256(binary.read_bytes()).hexdigest(),'method':'W4 increment over serve, WAL/FULL local disk, 32 disjoint writers; 160 warmup then 3 x 1600 closed-loop operations, no receipts, reduced fixture of 32 counters/1 room','trials':trials,'counter':json.loads(output),'all_owned_processes_stopped':all(p.poll() is not None for p in processes)}
 (run/'result.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
finally:
 for p in processes:
  if p.poll() is None:stop(p)
