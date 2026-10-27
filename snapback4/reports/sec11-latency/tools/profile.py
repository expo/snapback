#!/usr/bin/env python3
"""Independent cold copies; production binary; phases never enter verdict output."""
import argparse,gzip,json,pathlib,shutil,tempfile,subprocess,time,os,hashlib,math,statistics,collections
p=argparse.ArgumentParser();p.add_argument('--binary',required=True);p.add_argument('--out',required=True);p.add_argument('--top',type=int,default=20);p.add_argument('--lanes');p.add_argument('--modes',default='review,deploy');p.add_argument('--timeout',type=int,default=1200);a=p.parse_args()
out=pathlib.Path(a.out);out.mkdir(parents=True,exist_ok=True)
baseline=json.load(gzip.open('snapback4/reports/sec11-item1/cold-timing-rows.json.gz','rt'))
lanes=[r['lane']for r in sorted((r for r in baseline if r['mode']=='review'),key=lambda r:-r['seconds'])][:a.top]
if a.lanes:lanes=[x for x in lanes if any(x.startswith(n+'-')for n in a.lanes.split(','))]
rows=[]
with tempfile.TemporaryDirectory(prefix='sec11l-binary-')as tmp:
 binary=pathlib.Path(tmp)/'snapback4';shutil.copy2(a.binary,binary)
 for lane in lanes:
  src=pathlib.Path.home()/'sb4-loop/wave30/apps'/lane
  for mode,args in [('review',['check','--review']),('deploy',['deploy','deployment'])]:
   if mode not in a.modes.split(','):continue
   with tempfile.TemporaryDirectory(prefix='sec11l-profile-')as tmp:
    root=pathlib.Path(tmp);(root/'snapback').mkdir()
    for q in (src/'snapback').glob('*.q'):shutil.copy2(q,root/'snapback'/q.name)
    for q in (src/'fixtures').rglob('*.jsonl'):
     target=root/'fixtures'/q.relative_to(src/'fixtures');target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(q,target)
    trace=root/'phases.jsonl';start=time.monotonic();load=os.getloadavg()
    r=subprocess.run(['timeout','--kill-after=5s',str(a.timeout),str(binary),*args],cwd=root,capture_output=True,text=True,env={**os.environ,'SNAPBACK4_LATENCY_TRACE':str(trace)})
    row=dict(lane=lane,mode=mode,seconds=time.monotonic()-start,exit=r.returncode,loadBefore=load,loadAfter=os.getloadavg(),phases=[json.loads(line)for line in trace.read_text().splitlines()]if trace.exists()else[],output=r.stdout+r.stderr)
    rows.append(row);(out/'rows.json').write_text(json.dumps(rows,indent=2)+'\n');totals=collections.Counter();totals.update({});[totals.update({v['phase']:v['seconds']})for v in row['phases']];print(lane,mode,round(row['seconds'],3),{k:round(v,3)for k,v in totals.items()},flush=True)
 (out/'provenance.json').write_text(json.dumps(dict(binarySha256=hashlib.sha256(binary.read_bytes()).hexdigest(),count=len(lanes),affinityCpus=len(os.sched_getaffinity(0)),method='One worker, fresh source/fixture copy per command; slowest prior wave30 review lanes; opt-in phase timings include nested spans.'),indent=2)+'\n')
