import argparse,pathlib,time,tempfile,subprocess,shutil,os,json,hashlib,statistics,math,re
p=argparse.ArgumentParser();p.add_argument('--binary',required=True);p.add_argument('--out',required=True);p.add_argument('--wait-for');a=p.parse_args()
if a.wait_for:
 while not pathlib.Path(a.wait_for).exists():time.sleep(10)
out=pathlib.Path(a.out);out.mkdir(parents=True,exist_ok=True)
original=pathlib.Path(a.binary).resolve();rows=[]
with tempfile.TemporaryDirectory(prefix='sec11-timing-native-')as private:
 binary=pathlib.Path(private)/'snapback4';shutil.copy2(original,binary)
 provenance=dict(binarySha256=hashlib.sha256(binary.read_bytes()).hexdigest(),method='One worker, independent fresh source/fixture copies for each cold check --review and production deploy; no advisory cache, no prior test.',affinityCpus=len(os.sched_getaffinity(0)))
 (out/'provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
 for folder in sorted((pathlib.Path.home()/'sb4-loop/wave30/apps').glob('*/snapback')):
  if not list(folder.glob('*.q')):continue
  for mode,args in [('review',['check','--review']),('deploy',['deploy','deployment'])]:
   with tempfile.TemporaryDirectory(prefix='sec11-cold-timing-')as scratch:
    root=pathlib.Path(scratch);(root/'snapback').mkdir();texts=[]
    for q in sorted(folder.glob('*.q')):shutil.copy2(q,root/'snapback'/q.name);texts.append((q.name,q.read_text()))
    fixtures=folder.parent/'fixtures'
    if fixtures.is_dir():
     for f in fixtures.rglob('*.jsonl'):
      target=root/'fixtures'/f.relative_to(fixtures);target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(f,target)
    load=os.getloadavg();started=time.monotonic();r=subprocess.run(['timeout','--kill-after=5s','180s',str(binary),*args],cwd=root,capture_output=True,text=True)
    text=r.stdout+r.stderr
    row=dict(lane=folder.parent.name,mode=mode,seconds=time.monotonic()-started,exit=r.returncode,lines=len(text.splitlines()),loadBefore=load,loadAfter=os.getloadavg(),codes=sorted(set(re.findall(r'\b[EN]_[A-Z_]+\b',text))),sourceSha256=hashlib.sha256(json.dumps(texts).encode()).hexdigest());rows.append(row)
    (out/'rows.json').write_text(json.dumps(rows,indent=2)+'\n');print(json.dumps(row),flush=True)
 def summarize(mode):
  xs=sorted(r['seconds']for r in rows if r['mode']==mode);return dict(median=statistics.median(xs),p90=xs[math.ceil(len(xs)*.9)-1],max=max(xs),count=len(xs))
 result=dict(**provenance,review=summarize('review'),deploy=summarize('deploy'),toolFailures=[r for r in rows if r['exit']not in[0,1]],peakLoadPerCpu=max(max(r['loadBefore'][0],r['loadAfter'][0])for r in rows)/provenance['affinityCpus'])
 (out/'summary.json').write_text(json.dumps(result,indent=2)+'\n')
