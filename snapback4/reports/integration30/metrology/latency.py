from pathlib import Path
import subprocess,os,json,hashlib,concurrent.futures,tempfile,shutil,time,statistics,math
out=Path(__file__).parent; home=Path.home()/'sb4-loop'
bins={'0.4.44':out/'snapback4-packed-0.4.44','0.4.45':home/'reports/integration29/candidate-release-0.4.45','0.4.46':out/'snapback4-0.4.46'}
keys=[dict(wave=w,lane=l,cohort='sample54',variant='') for w,l in json.loads((home/'reports/integration28/latency-keys.json').read_text())]
rel=home/'wave33-repro/rel'; cases=sorted({(r['lane'],r['variant']) for r in map(json.loads,(rel/'results.jsonl').read_text().splitlines())})
keys += [dict(wave=33,lane=l,cohort='day2-nine',variant=v) for l,v in cases]
assert len(keys)==63,(len(keys),cases)
raw=out/'latency-raw';raw.mkdir(exist_ok=True)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
(out/'latency-provenance.json').write_text(json.dumps(dict(toolSha256=sha(Path(__file__)),startedEpoch=time.time(),binaries={k:dict(path=str(p),sha256=sha(p))for k,p in bins.items()},workers=4,keys=keys,method='Paired adjacent binaries with rotating order per schema/mode; same four workers and window; cold then warm on the same independent source/JSONL copy. No phase tracing. Preview starts from a fresh matching-binary deployment of the predecessor; setup time is retained separately. Sample54 retains authored JSONL as Integration28; day2-nine uses only Quarry source as wave33-repro/rel/replay.sh. No original stores opened.'),indent=2)+'\n')
def run(binary,args,root):
 start=time.monotonic(); r=subprocess.run(['timeout','--kill-after=5s','600s',str(binary),*args],cwd=root,capture_output=True,text=True,env={k:v for k,v in os.environ.items()if k!='SNAPBACK4_LATENCY_TRACE'})
 return dict(seconds=time.monotonic()-start,exit=r.returncode,stdout=r.stdout,stderr=r.stderr,load=os.getloadavg())
def copy(source,root,variant='',include_fixtures=True):
 (root/'snapback').mkdir(parents=True); texts=[]
 for p in sorted((source/'snapback').glob('*.q')):
  s=p.read_text()
  if variant and p.name=='schema.q':s+='\ninvariant jobs always .priceCents = null or .priceCents != null\n'
  (root/'snapback'/p.name).write_text(s);texts.append((p.name,s))
 assert texts,source
 fixtures=[]
 for p in (sorted((source/'fixtures').rglob('*.jsonl')) if include_fixtures else []):
  dest=root/'fixtures'/p.relative_to(source/'fixtures');dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,dest);fixtures.append((str(p.relative_to(source/'fixtures')),sha(dest)))
 return hashlib.sha256(json.dumps((texts,fixtures)).encode()).hexdigest()
def one(item):
 i,k=item; rows=[]; source=home/f"wave{k['wave']}/apps"/k['lane']
 path=raw/f"w{k['wave']}-{k['lane']}{'-inv' if k['variant'] else ''}.json"
 if path.exists():
  rows=json.loads(path.read_text())
  assert len(rows)==30 and {(r['label'],r['mode'],r['temperature']) for r in rows}=={(label,mode,temp) for label in bins for mode in ['check','staging','production','preview','review'] for temp in ['cold','warm']}
  with tempfile.TemporaryDirectory(prefix='i30-lat-validate-')as tmp:expected=copy(source,Path(tmp),k['variant'],k['cohort']=='sample54')
  assert all(all(r[key]==k[key] for key in ['wave','lane','cohort','variant']) and r['sourceSha256']==expected for r in rows)
  print('retained',k,flush=True);return rows
 modes=[('check',['check']),('staging',['deploy','release','--staging']),('production',['deploy','release']),('preview',['deploy','release','--check']),('review',['check','--review'])]
 for mi,(mode,args) in enumerate(modes):
  with tempfile.TemporaryDirectory(prefix='i30-lat-')as tmp:
   roots={};hashes={};setup={}
   for label,b in bins.items():
    root=Path(tmp)/label;roots[label]=root; hashes[label]=copy(source,root,k['variant'],k['cohort']=='sample54')
    if mode=='preview':
     prior=home/f"wave{k['wave']-1}/apps"/k['lane'] if k['cohort']=='day2-nine' else source
     copy(prior,Path(tmp)/(label+'-prior'),include_fixtures=k['cohort']=='sample54')
     setup[label]=run(b,['deploy','release','--schema',str(Path(tmp)/(label+'-prior')/'snapback')],root)
   assert len(set(hashes.values()))==1
   labels=list(bins); shift=(i+mi)%3; labels=labels[shift:]+labels[:shift]
   for temp in ['cold','warm']:
    for label in labels:
     r=run(bins[label],args,roots[label]);rows.append({**k,'label':label,'mode':mode,'temperature':temp,'sourceSha256':hashes[label],**r,**({'setup':setup[label]}if mode=='preview'else{})})
  (out/'latency-progress.json').write_text(json.dumps(dict(last=k,mode=mode)))
 path.write_text(json.dumps(rows)+'\n'); print(k,len(rows),flush=True);return rows
rows=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=4)as pool:
 for result in pool.map(one,enumerate(keys)):rows.extend(result)
(out/'latency-rows.json').write_text(json.dumps(rows)+'\n')
assert len(rows)==1890
summary=[]
for cohort in ['sample54','day2-nine']:
 for mode in ['check','staging','production','preview','review']:
  for temp in ['cold','warm']:
   for label in bins:
    rs=[r for r in rows if (r['cohort'],r['mode'],r['temperature'],r['label'])==(cohort,mode,temp,label)];xs=sorted(r['seconds']for r in rs)
    summary.append(dict(cohort=cohort,mode=mode,temperature=temp,label=label,n=len(xs),median=statistics.median(xs),p90=xs[math.ceil(.9*len(xs))-1],max=max(xs),exits={str(e):sum(r['exit']==e for r in rs)for e in set(r['exit']for r in rs)},toolFailures=[r['lane']for r in rs if r['exit']not in[0,1]],setupFailures=[r['lane']for r in rs if r.get('setup',{}).get('exit',0)!=0]))
(out/'latency-summary.json').write_text(json.dumps(summary,indent=2)+'\n')

assert len(list(raw.glob('w*.json')))==63
(out/'latency-capture-manifest.json').write_text(json.dumps({p.name:sha(p) for p in sorted(raw.glob('w*.json'))},indent=2)+'\n')
