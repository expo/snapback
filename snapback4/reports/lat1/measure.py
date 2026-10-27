#!/usr/bin/env python3
"""Source/fixture copies only; paired binaries, exact security JSON, retained failures."""
import argparse, concurrent.futures, hashlib, json, math, os, pathlib, shutil, statistics, subprocess, tempfile, time
p=argparse.ArgumentParser();p.add_argument('--baseline',required=True);p.add_argument('--candidate',required=True);p.add_argument('--keys',required=True);p.add_argument('--out',required=True);p.add_argument('--workers',type=int,default=4);p.add_argument('--identity',action='store_true');p.add_argument('--resume',action='store_true');a=p.parse_args()
out=pathlib.Path(a.out);out.mkdir(parents=True,exist_ok=True);keys=json.loads(pathlib.Path(a.keys).read_text());home=pathlib.Path.home()/'sb4-loop'
binaries={k:pathlib.Path(v).resolve() for k,v in [('baseline',a.baseline),('candidate',a.candidate)]}
def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
provenance=dict(binaries={k:dict(path=str(v),sha256=digest(v))for k,v in binaries.items()},keysSha256=digest(pathlib.Path(a.keys)),workers=a.workers,identity=a.identity,method='Independent fresh source/JSONL fixture copies per binary and command. Four paired latency tasks (or declared identity workers), alternating binary order by schema. Cold then warm in one project; no live stores copied or opened. No payload normalization. Shared host; per-command load recorded.')
manifest=out/'provenance.json'
if a.resume:assert json.loads(manifest.read_text())==provenance
else:manifest.write_text(json.dumps(provenance,indent=2)+'\n')
def project(source,root,wave,lane):
 (root/'snapback').mkdir()
 texts=[]
 for q in sorted((source/'snapback').glob('*.q')):shutil.copy2(q,root/'snapback'/q.name);texts.append((q.name,q.read_text()))
 for q in (source/'fixtures').rglob('*.jsonl'):
  target=root/'fixtures'/q.relative_to(source/'fixtures');target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(q,target)
 if a.identity and wave==31:
  prior=home/'wave31/v1-clients'/lane/'snapback';assert list(prior.glob('*.q'))
  (root/'.snapback4').mkdir();(root/'.snapback4/security-write-baseline.json').write_text(json.dumps([(q.name,q.read_text())for q in sorted(prior.glob('*.q'))]))
 return hashlib.sha256(json.dumps(texts).encode()).hexdigest()
def envelope(parsed,mode,exit):
 if mode=='check':return dict(exit=exit,ok=parsed.get('ok'),reviews=parsed.get('securityReviews'),report=parsed.get('security'),notes=parsed.get('notes'),newNotes=parsed.get('newNotes'))
 security=parsed.get('security') or {};security=json.loads(security)if isinstance(security,str)else security
 return dict(exit=exit,fixes=security.get('fixes'),pending=security.get('pending'),reviews=security.get('securityReviews'),report=security.get('report'),denied=parsed.get('denied'))
def measure(item):
 index,(wave,lane)=item;path=out/f'w{wave}-{lane}.json'
 if a.resume and path.exists():return json.loads(path.read_text())
 source=home/f'wave{wave}/apps'/lane;rows=[]
 modes=[('check',['check']),('staging',['deploy','release','--staging'])]
 if not a.identity:modes += [('review',['check','--review']),('production',['deploy','release'])]
 else:modes += [('production',['deploy','release'])]
 for mode,args in modes:
  for label in (['baseline','candidate']if index%2==0 else ['candidate','baseline']):
   with tempfile.TemporaryDirectory(prefix='sb4-lat1-')as tmp:
    root=pathlib.Path(tmp);source_hash=project(source,root,wave,lane)
    for temperature in (['cold','warm']if mode in ['check','staging']else ['cold']):
     trace=root/f'{temperature}-phases.jsonl';env={**os.environ}
     if not a.identity:env['SNAPBACK4_LATENCY_TRACE']=str(trace)
     command=[str(binaries[label]),*args,*(['--json']if a.identity else [])]
     start=time.monotonic();r=subprocess.run(['timeout','--kill-after=5s','900s',*command],cwd=root,capture_output=True,text=True,env=env)
     row=dict(label=label,wave=wave,lane=lane,mode=mode,temperature=temperature,seconds=time.monotonic()-start,exit=r.returncode,load=os.getloadavg(),sourceSha256=source_hash,stdout=r.stdout,stderr=r.stderr)
     if a.identity:
      try:row['security']=envelope(json.loads(r.stdout),mode,r.returncode)
      except (ValueError,AttributeError)as error:row['parseError']=str(error)
     else:row['phases']=[json.loads(l)for l in trace.read_text().splitlines()]if trace.exists()else []
     rows.append(row)
 result=dict(wave=wave,lane=lane,rows=rows);path.write_text(json.dumps(result,indent=2)+'\n');return result
rows=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=a.workers)as pool:
 for result in pool.map(measure,enumerate(keys)):
  rows+=result['rows'];print(len(rows),result['wave'],result['lane'],flush=True)
summary=dict(schemas=len(keys),toolFailures=[{k:r.get(k)for k in ['label','wave','lane','mode','temperature','exit','parseError']}for r in rows if r['exit']not in [0,1]or'parseError'in r])
if a.identity:
 mismatches=[]
 for wave,lane in keys:
  for mode,temp in [('check','cold'),('check','warm'),('staging','cold'),('staging','warm'),('production','cold')]:
   pair=[r for r in rows if(r['wave'],r['lane'],r['mode'],r['temperature'])==(wave,lane,mode,temp)]
   if len(pair)!=2 or pair[0].get('security')!=pair[1].get('security'):
    mismatches.append(dict(wave=wave,lane=lane,mode=mode,temperature=temp,fields=[k for k in set(pair[0].get('security',{}))|set(pair[1].get('security',{}))if pair[0].get('security',{}).get(k)!=pair[1].get('security',{}).get(k)]))
 summary['mismatches']=mismatches
else:
 summary['timings']=[]
 for label in binaries:
  for mode,temp in [('check','cold'),('check','warm'),('staging','cold'),('staging','warm'),('review','cold'),('production','cold')]:
   selected=[r for r in rows if(r['label'],r['mode'],r['temperature'])==(label,mode,temp)];xs=sorted(r['seconds']for r in selected)
   summary['timings'].append(dict(label=label,mode=mode,temperature=temp,count=len(xs),median=statistics.median(xs),p90=xs[math.ceil(.9*len(xs))-1],max=max(xs)))
(out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary,indent=2),flush=True)
if summary['toolFailures']:raise SystemExit(1)
