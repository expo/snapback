#!/usr/bin/env python3
"""Read-only frozen sources; isolated, automatically removed schema copies."""
import argparse,concurrent.futures,gzip,hashlib,json,pathlib,subprocess,tempfile,shutil
p=argparse.ArgumentParser();p.add_argument('--binary',required=True);p.add_argument('--out',required=True);p.add_argument('--corpus',action='store_true');a=p.parse_args()
binary=str(pathlib.Path(a.binary).resolve());out=pathlib.Path(a.out);out.mkdir(parents=True,exist_ok=True);home=pathlib.Path.home()/'sb4-loop'
specs={k:v for k,v in (line.split('\t',1) for line in (home/'wave24-repro/q1/specs.tsv').read_text().splitlines())}
specs['029-specF1']="invariant bookings.weight update only .tour.status = 'booked'" # bakeoff §2.2's verified edit boundary
findings=['007-specF2','008-specF1','011-specF1','013-specF1','015-specF1','015-specF2','016-specF1','029-specF1','031-specF1','033-specF1','036-specF1','036-specF2','048-specF1']
def source(path):return [(q.name,q.read_text()) for q in sorted(path.glob('*.q'))]
def sha(texts):return hashlib.sha256(json.dumps(texts,separators=(',',':')).encode()).hexdigest()
items=[]
if a.corpus:
 for wave in [15,16,18,19,20,21,22,23]:
  for folder in sorted((home/f'wave{wave}/apps').glob('*/snapback')):
   texts=source(folder)
   if texts:items.append((f'w{wave}-{folder.parent.name}','own',texts))
else:
 for finding in findings:
  folder=next((home/'wave24/apps').glob(finding[:3]+'-snapback-*/snapback'));texts=source(folder)
  for mode in ['none','own','spec']:
   variant=[(name,'\n'.join(l for l in text.splitlines() if not l.lstrip().startswith('invariant '))+'\n') for name,text in texts] if mode=='none' else list(texts)
   if mode=='spec':variant=[(name,text+('\n'+specs[finding]+'\n' if name=='schema.q' else '')) for name,text in variant]
   items.append((finding,mode,variant))
def measure(item):
 label,mode,texts=item
 with tempfile.TemporaryDirectory(prefix='sb4-sec8-measure-') as tmp:
  root=pathlib.Path(tmp);(root/'snapback').mkdir()
  for name,text in texts:(root/'snapback'/name).write_text(text)
  def run(args,seconds):return subprocess.run(['timeout',str(seconds),binary,*args],cwd=root,capture_output=True,text=True)
  check=run(['check','--json'],45)
  try:report=json.loads(check.stdout)
  except ValueError:report={}
  reviews=report.get('securityReviews',[]);notes=report.get('security',{}).get('notes',[])
  row=dict(lane=label,mode=mode,sha256=sha(texts),files=[dict(name=n,sha256=hashlib.sha256(t.encode()).hexdigest()) for n,t in texts],checkExit=check.returncode,codes=sorted(set(n['code'] for n in notes)),gates=[dict(code=d['code'],site=d['site']) for d in reviews if d['gated'] and not d['acknowledged']],notes=[dict(code=n['code'],site=n['site'],message=n['message']) for n in notes],refuted=report.get('security',{}).get('invariants',[]))
  if not a.corpus:
   human=run(['check'],45);row['visible']=sorted(set(__import__('re').findall('N_[A-Z_]+',human.stdout)))
   test=run(['test'],300);row['testExit']=test.returncode
   witnesses=[]
   for line in test.stdout.splitlines():
    if line.startswith('security violation: '):
     witness=json.loads(line.removeprefix('security violation: '))
     if witness.get('reachability') in ['authored-fixture-trace','generated-fixture-trace']:witnesses.append(witness)
   row['reachableInvariantSites']=sorted(set(w['invariant_site'] for w in witnesses))
   if mode=='spec':
    row['specInvariantSite']='schema.q:'+str(len(dict(texts)['schema.q'].splitlines()))+':1'
    row['specWitnesses']=sum(w['invariant_site']==row['specInvariantSite'] for w in witnesses)
   row['testSummary']=[line for line in (test.stdout+'\n'+test.stderr).splitlines() if line.startswith(('security invariant','security tests:','security histories:','security directed histories:','security not covered:','security:','test:'))]
   with gzip.open(out/(label+'-'+mode+'.test.txt.gz'),'wt') as f:f.write(test.stdout+'\n'+test.stderr)
  return row
with tempfile.TemporaryDirectory(prefix='sb4-sec8-measure-binary-') as private:
 original=pathlib.Path(binary);snapshot=pathlib.Path(private)/'snapback4';shutil.copy2(original,snapshot);binary=str(snapshot)
 (out/'measurement.json').write_text(json.dumps(dict(binarySha256=hashlib.sha256(snapshot.read_bytes()).hexdigest(),originalBinary=str(original),projects=len(items),mode='corpus' if a.corpus else 'finding-matrix'),indent=2)+'\n')
 results=[]
 with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
  for f in concurrent.futures.as_completed([pool.submit(measure,item) for item in items]):
   row=f.result();results.append(row)
   (out/'results.json').write_text(json.dumps(sorted(results,key=lambda r:(r['lane'],r['mode'])),indent=2)+'\n')
 print(json.dumps(dict(projects=len(results),gatedProjects=sum(bool(r['gates']) for r in results),gates=sum(len(r['gates']) for r in results),nonzero=sum(r['checkExit']!=0 for r in results))))
