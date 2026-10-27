#!/usr/bin/env python3
import os
"""Frozen source copies, fresh and post-test production attempts; no live servers."""
import argparse, concurrent.futures, hashlib, json, pathlib, shutil, subprocess, tempfile, time, re
p=argparse.ArgumentParser();p.add_argument('--binary',required=True);p.add_argument('--out',required=True);p.add_argument('--waves',default='15,16,18,19,20,21,22,23,24,25,26');p.add_argument('--filter',default='');p.add_argument('--workers',type=int,default=8);p.add_argument('--check-only',action='store_true');p.add_argument('--resume',action='store_true');p.add_argument('--default-output',action='store_true');p.add_argument('--strip-intent',action='store_true');p.add_argument('--check-timeout',type=int,default=120);p.add_argument('--test-timeout',type=int,default=900);p.add_argument('--deploy-timeout',type=int,default=180);p.add_argument('--cases');p.add_argument('--fresh-only',action='store_true');a=p.parse_args();assert a.check_timeout>0 and a.test_timeout>0
out=pathlib.Path(a.out);out.mkdir(parents=True,exist_ok=True);home=pathlib.Path.home()/'sb4-loop'
items=[(wave,folder) for wave in map(int,a.waves.split(',')) for folder in sorted((home/f'wave{wave}/apps').glob('*/snapback')) if list(folder.glob('*.q')) and (not a.filter or any(folder.parent.name.startswith(n+'-') for n in a.filter.split(',')))]
if a.cases:
 selected={(r['wave'],r['lane'])for r in json.loads(pathlib.Path(a.cases).read_text())}
 items=[item for item in items if (item[0],item[1].parent.name)in selected]
def measure(item):
 wave,folder=item
 cached=out/(f'w{wave}-'+folder.parent.name+'.json')
 if a.resume and cached.exists():return json.loads(cached.read_text())
 with tempfile.TemporaryDirectory(prefix='sb4-sec10-shipping-measure-') as temporary:
  root=pathlib.Path(temporary);(root/'snapback').mkdir();(root/'native-scratch').mkdir()
  texts=[(q.name,q.read_text()) for q in sorted(folder.glob('*.q'))]
  if a.strip_intent:texts=[(name,'\n'.join(line for line in text.splitlines() if not line.lstrip().startswith('invariant '))+'\n') for name,text in texts]
  for name,text in texts:(root/'snapback'/name).write_text(text)
  # Retain authored JSONL fixture data, but no generated evidence/dispositions.
  fixture=folder.parent/'fixtures'
  if fixture.is_dir():
   for q in fixture.rglob('*.jsonl'):
    target=root/'fixtures'/q.relative_to(fixture);target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(q,target)
  def run(args,limit):
   started=time.monotonic();r=subprocess.run(['timeout','--kill-after=5s',str(limit),binary,*args],cwd=root,env={**os.environ,'TMPDIR':str(root/'native-scratch')},capture_output=True,text=True)
   return r,round(time.monotonic()-started,3)
  def failure(r):
   if r.returncode==0:return None
   panic=re.search(r'panicked at ([^\n]+)',r.stderr)
   if panic:return dict(kind='runtime panic',site=panic.group(1))
   http=next((line for line in r.stderr.splitlines() if line.startswith('security HTTP failure: ')),None)
   if http:return dict(kind='private HTTP preparation/admission',summary=http[:1000])
   return dict(kind='exit',code=r.returncode)
  def review_gates(reviews,notes):
   groups={}
   def site(value):return f"{value['file']}:{value['line']}:{value.get('col',1)}" if isinstance(value,dict) else value
   for note in notes:groups.setdefault((note['code'],site(note['site'])),[]).append(note['message'])
   result=[]
   for review in reviews:
    if not review['gated'] or review['acknowledged']:continue
    messages=groups.get((review['code'],site(review['site'])),[])
    result.append(dict(code=review['code'],site=review['site'],id=review['id'],message=messages.pop(0) if messages else '',witness=review.get('witness')))
   return result
  default=None
  if a.default_output:
   rendered,elapsed=run(['check'],a.check_timeout);text=rendered.stdout+rendered.stderr
   default=dict(exit=rendered.returncode,seconds=elapsed,lines=len(text.splitlines()),characters=len(text),stdout=rendered.stdout,stderr=rendered.stderr)
  check,seconds=run(['check','--json'],a.check_timeout)
  try:report=json.loads(check.stdout)
  except ValueError:report={}
  reviews=report.get('securityReviews',[]);security=report.get('security',{})
  notes=security.get('notes',[])+report.get('notes',[])
  row=dict(wave=wave,lane=folder.parent.name,sha256=hashlib.sha256(json.dumps(texts).encode()).hexdigest(),checkExit=check.returncode,checkSeconds=seconds,checkFailure=failure(check),gates=review_gates(reviews,notes),notes=[dict(code=n['code'],site=n['site'],message=n['message']) for n in notes],checkFixes=[dict(site=v['invariant']['site'],predicate=v['invariant']['predicate']) for v in security.get('invariants',[]) if v.get('counterexample') and v['counterexample'].get('reachability') in ['authored-fixture-trace','generated-fixture-trace']])
  row['reviews']=reviews
  if default is not None:row['defaultCheck']=default
  def deploy(label):
   r,seconds=run(['deploy',str(root/label),'--json'],a.deploy_timeout)
   text=r.stdout+'\n'+r.stderr
   try:parsed=json.loads(r.stdout)
   except ValueError:parsed={}
   sec=parsed.get('security') or {};sec=json.loads(sec) if isinstance(sec,str) else sec
   return dict(exit=r.returncode,seconds=seconds,failure=failure(r),securityRefused='E_SECURITY_REVIEW' in text,enforcedFixes=sec.get('fixes',0),reviews=sec.get('securityReviews',[]),gates=review_gates(sec.get('securityReviews',[]),sec.get('report',{}).get('notes',[])),summary=[line for line in text.splitlines() if any(s in line for s in ['  FIX ','E_SECURITY_REVIEW','security deploy campaign:','deploy:']) and len(line)<3000],fixes=[dict(site=v['invariant']['site'],predicate=v['invariant']['predicate'],operation=v['counterexample']['operation']) for v in sec.get('report',{}).get('invariants',[]) if v.get('counterexample') and v['counterexample'].get('reachability') in ['authored-fixture-trace','generated-fixture-trace']])
  if not a.check_only:
   rendered,elapsed=run(['deploy',str(root/'default-deployment')],a.deploy_timeout)
   text=rendered.stdout+rendered.stderr
   row['defaultDeploy']=dict(exit=rendered.returncode,seconds=elapsed,lines=len(text.splitlines()),stdout=rendered.stdout,stderr=rendered.stderr)
   row['fresh']=deploy('fresh')
   if not a.fresh_only:
    tested,elapsed=run(['test'],a.test_timeout)
    row['test']=dict(exit=tested.returncode,seconds=elapsed,failure=failure(tested))
    row['afterTest']=deploy('after-test')
  (out/(f'w{wave}-'+folder.parent.name+'.json')).write_text(json.dumps(row,indent=2)+'\n')
  return row
with tempfile.TemporaryDirectory(prefix='sb4-sec10-shipping-binary-') as private:
 original=pathlib.Path(a.binary).resolve();snapshot=pathlib.Path(private)/'snapback4';shutil.copy2(original,snapshot);binary=str(snapshot)
 if a.resume and (out/'measurement.json').exists():assert json.loads((out/'measurement.json').read_text())['binarySha256']==hashlib.sha256(snapshot.read_bytes()).hexdigest(), 'resume requires identical binary'
 (out/'measurement.json').write_text(json.dumps(dict(binarySha256=hashlib.sha256(snapshot.read_bytes()).hexdigest(),projects=len(items),workers=a.workers,waves=a.waves,checkOnly=a.check_only,stripIntent=a.strip_intent,defaultOutput=a.default_output,freshOnly=a.fresh_only,binarySnapshot=str(snapshot),watchdogSeconds=dict(check=a.check_timeout,test=a.test_timeout,deploy=a.deploy_timeout)),indent=2)+'\n')
 results=[]
 with concurrent.futures.ThreadPoolExecutor(max_workers=a.workers) as pool:
  for f in concurrent.futures.as_completed([pool.submit(measure,item) for item in items]):
   row=f.result();results.append(row)
   print(json.dumps(dict(done=len(results),total=len(items),wave=row['wave'],lane=row['lane'],gates=len(row['gates']),fresh=row.get('fresh',{}).get('exit'),test=row.get('test',{}).get('exit'),after=row.get('afterTest',{}).get('exit'))),flush=True)
 (out/'results.json').write_text(json.dumps(sorted(results,key=lambda r:(r['wave'],r['lane'])),indent=2)+'\n')
