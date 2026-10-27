#!/usr/bin/env python3
"""Private complete authored counterexamples; classifier selects the supplemental set."""
import argparse,gzip,json,pathlib,tempfile,subprocess,shutil,hashlib,concurrent.futures,os
p=argparse.ArgumentParser();p.add_argument('--binary',required=True);p.add_argument('--survey',required=True);p.add_argument('--out',required=True);p.add_argument('--workers',type=int,default=4);a=p.parse_args()
def load(path):return json.load(gzip.open(path,'rt'))if str(path).endswith('.gz')else json.load(open(path))
rows=load(a.survey)
def authored(f):return not f['site']['file'].startswith(('$derived/','$enforced/'))
selected=[r for r in rows if r['checkFixes']or any(authored(f)for mode in ['fresh','afterTest']for f in r[mode]['fixes'])]
out=pathlib.Path(a.out);out.mkdir(parents=True,exist_ok=True)
def run_one(row):
 src=pathlib.Path.home()/f"sb4-loop/wave{row['wave']}/apps"/row['lane'];result={k:row[k]for k in ['wave','lane','sha256']}
 with tempfile.TemporaryDirectory(prefix='sec11l-authored-')as tmp:
  root=pathlib.Path(tmp);(root/'snapback').mkdir()
  for q in (src/'snapback').glob('*.q'):shutil.copy2(q,root/'snapback'/q.name)
  for q in (src/'fixtures').rglob('*.jsonl'):
   dst=root/'fixtures'/q.relative_to(src/'fixtures');dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(q,dst)
  def run(args,limit=300):
   r=subprocess.run(['timeout','--kill-after=5s',str(limit),binary,*args],cwd=root,capture_output=True,text=True)
   return r
  def extract(r,check=False):
   report=json.loads(r.stdout)
   if check:report=report.get('security',{})
   else:
    report=report.get('security')or {};report=json.loads(report)if isinstance(report,str)else report;report=report.get('report',{})
   cases=[v for v in report.get('invariants',[])if v.get('counterexample')is not None and not v['invariant']['site']['file'].startswith(('$derived/','$enforced/'))]
   return dict(exit=r.returncode,counterexamples=cases)
  result['check']=extract(run(['check','--json']),True)
  result['fresh']=extract(run(['deploy','fresh','--json']))
  result['testExit']=run(['test'],900).returncode
  result['afterTest']=extract(run(['deploy','after-test','--json']))
  (out/f"w{row['wave']}-{row['lane']}.json").write_text(json.dumps(result,sort_keys=True,indent=2)+'\n')
  return result
with tempfile.TemporaryDirectory(prefix='sec11l-authored-binary-')as tmp:
 snap=pathlib.Path(tmp)/'snapback4';shutil.copy2(a.binary,snap);binary=str(snap)
 with concurrent.futures.ThreadPoolExecutor(max_workers=a.workers)as pool:
  results=[]
  for r in pool.map(run_one,selected):results.append(r);print(r['wave'],r['lane'],'captured',flush=True)
 (out/'results.json').write_text(json.dumps(results,sort_keys=True,indent=2)+'\n')
 (out/'provenance.json').write_text(json.dumps(dict(binarySha256=hashlib.sha256(snap.read_bytes()).hexdigest(),count=len(results),selection='Every schema with an authored check/fresh/post-test FIX in the 800-schema classifier; raw counterexamples remain private.'),indent=2)+'\n')
