import pathlib,json,tempfile,subprocess,shutil,time,concurrent.futures,hashlib,os,statistics,math
out=pathlib.Path('/home/ccheever/sb4-loop/reports/integration28');base=pathlib.Path.home()/'sb4-loop'
keys=json.loads((out/'survey-keys.json').read_text());chosen=[]
for w in range(15,33):
 xs=[k for k in keys if k[0]==w];chosen+=xs[::max(1,len(xs)//3)][:3]
(out/'latency-keys.json').write_text(json.dumps(chosen));rows=[]
def measure(item):
 label,binary,w,lane=item;result=[];source=base/f'wave{w}/apps'/lane
 for mode,args in [('check',['check']),('staging',['deploy','release','--staging'])]:
  with tempfile.TemporaryDirectory(prefix='i28-latency-')as tmp:
   root=pathlib.Path(tmp);(root/'snapback').mkdir();texts=[]
   for q in sorted((source/'snapback').glob('*.q')):shutil.copy2(q,root/'snapback'/q.name);texts.append((q.name,q.read_text()))
   for q in(source/'fixtures').rglob('*.jsonl'):
    dest=root/'fixtures'/q.relative_to(source/'fixtures');dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(q,dest)
   for temp in ['cold','warm']:
    trace=root/f'{temp}-phases.jsonl';start=time.monotonic();r=subprocess.run(['timeout','--kill-after=5s','600s',str(binary),*args],cwd=root,capture_output=True,text=True,env={**os.environ,'SNAPBACK4_LATENCY_TRACE':str(trace)})
    row=dict(label=label,wave=w,lane=lane,mode=mode,temperature=temp,seconds=round(time.monotonic()-start,3),exit=r.returncode,load=os.getloadavg(),sourceSha256=hashlib.sha256(json.dumps(texts).encode()).hexdigest(),phases=[json.loads(l)for l in trace.read_text().splitlines()]if trace.exists()else[],stdout=r.stdout,stderr=r.stderr);result.append(row)
 return result
while not(out/'candidate').exists():time.sleep(1)
for label in ['after-production-0.4.44']:
 binary=out/label
 with concurrent.futures.ThreadPoolExecutor(max_workers=4)as pool:
  for result in pool.map(measure,[(label,binary,w,l)for w,l in chosen]):
   rows+=result;(out/'latency-production-after-rows.json').write_text(json.dumps(rows,indent=2));print(label,len(rows),flush=True)
summary=[]
for label in ['after-production-0.4.44']:
 for mode in ['check','staging']:
  for temp in ['cold','warm']:
   selected=[r for r in rows if(r['label'],r['mode'],r['temperature'])==(label,mode,temp)];xs=sorted(r['seconds']for r in selected);summary.append(dict(label=label,mode=mode,temperature=temp,count=len(xs),median=statistics.median(xs),p90=xs[math.ceil(.9*len(xs))-1],max=max(xs),toolFailures=[{k:r[k]for k in ['wave','lane','exit']}for r in selected if r['exit']not in[0,1]]))
(out/'latency-production-after-summary.json').write_text(json.dumps(dict(method='54 deterministically stratified schemas, three per wave, from 940-schema survey; four latency workers plus four survey workers; independent source/fixture copies per command; warm repeats on same copy; host shared; final static production snapshot',binaries={k:hashlib.sha256((out/k).read_bytes()).hexdigest()for k in ['after-production-0.4.44']},rows=summary),indent=2))
