#!/usr/bin/env python3
"""Private complete authored counterexamples; classifier selects the supplemental set."""
import argparse,gzip,json,pathlib,tempfile,subprocess,shutil,hashlib,concurrent.futures,os
p=argparse.ArgumentParser();p.add_argument('--binary',required=True);p.add_argument('--survey',required=True,action='append');p.add_argument('--out',required=True);p.add_argument('--workers',type=int,default=4);p.add_argument('--resume',action='store_true');p.add_argument('--check-timeout',type=int,default=300);p.add_argument('--test-timeout',type=int,default=900);a=p.parse_args()
def load(path):return json.load(gzip.open(path,'rt'))if str(path).endswith('.gz')else json.load(open(path))
by_key={}
for survey in a.survey:
 for row in load(survey):
  key=(row['wave'],row['lane'])
  if key in by_key:assert by_key[key]['sha256']==row['sha256'],'source mismatch in survey union'
  if row['checkFixes']or any(row[m]['fixes']for m in ['fresh','afterTest']):by_key[key]=row
rows=[by_key[k]for k in sorted(by_key)]
def authored(f):return not f['site']['file'].startswith(('$derived/','$enforced/'))
selected=rows
out=pathlib.Path(a.out);out.mkdir(parents=True,exist_ok=True)
def run_one(row):
 src=pathlib.Path.home()/f"sb4-loop/wave{row['wave']}/apps"/row['lane'];result={k:row[k]for k in ['wave','lane','sha256']}
 cached=out/f"w{row['wave']}-{row['lane']}.json"
 if a.resume and cached.exists():
  value=json.loads(cached.read_text());assert value['sha256']==row['sha256']
  if value['testExit']in [0,1]and all(value[m]['exit']in [0,1]for m in ['check','fresh','afterTest']):return value
 with tempfile.TemporaryDirectory(prefix='sec11l-authored-')as tmp:
  root=pathlib.Path(tmp);(root/'snapback').mkdir()
  for q in (src/'snapback').glob('*.q'):shutil.copy2(q,root/'snapback'/q.name)
  for q in (src/'fixtures').rglob('*.jsonl'):
   dst=root/'fixtures'/q.relative_to(src/'fixtures');dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(q,dst)
  def run(args,limit=None):
   limit=limit or a.check_timeout
   r=subprocess.run(['timeout','--kill-after=5s',str(limit),binary,*args],cwd=root,capture_output=True,text=True)
   if r.returncode not in [0,1]:raise RuntimeError(f"{row['wave']}/{row['lane']} {args[0]}: tool exit {r.returncode}")
   return r
  def extract(r,check=False):
   report=json.loads(r.stdout)
   if check:report=report.get('security',{})
   else:
    report=report.get('security')or {};report=json.loads(report)if isinstance(report,str)else report;report=report.get('report',{})
   cases=[v for v in report.get('invariants',[])if v.get('counterexample')is not None]
   return dict(exit=r.returncode,counterexamples=cases)
  result['check']=extract(run(['check','--json']),True)
  result['fresh']=extract(run(['deploy','fresh','--json']))
  result['testExit']=run(['test'],a.test_timeout).returncode
  result['afterTest']=extract(run(['deploy','after-test','--json']))
  (out/f"w{row['wave']}-{row['lane']}.json").write_text(json.dumps(result,sort_keys=True,indent=2)+'\n')
  return result
with tempfile.TemporaryDirectory(prefix='sec11l-authored-binary-')as tmp:
 snap=pathlib.Path(tmp)/'snapback4';shutil.copy2(a.binary,snap);binary=str(snap)
 provenance=dict(binarySha256=hashlib.sha256(snap.read_bytes()).hexdigest(),captureFormat='complete-counterexamples-v1',selectedKeys=[[r['wave'],r['lane']]for r in selected],complete=False)
 if a.resume:
  prior=json.loads((out/'provenance.json').read_text());assert all(prior[k]==provenance[k]for k in ['binarySha256','captureFormat']),'resume requires the same binary and capture format'
 (out/'provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
 with concurrent.futures.ThreadPoolExecutor(max_workers=a.workers)as pool:
  results=[]
  for r in pool.map(run_one,selected):results.append(r);print(r['wave'],r['lane'],'captured',flush=True)
 (out/'results.json').write_text(json.dumps(results,sort_keys=True,indent=2)+'\n')
 provenance['complete']=True
 (out/'provenance.json').write_text(json.dumps(dict(**provenance,count=len(results),selection='Union of every schema with any check/fresh/post-test FIX in the supplied surveys; complete authored, derived and enforced counterexamples remain private.'),indent=2)+'\n')
