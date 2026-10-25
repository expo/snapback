#!/usr/bin/env python3
"""Sequential fresh deploys; qualify CPU idleness independently of latency."""
import argparse,pathlib,os,time,subprocess,tempfile,shutil,json,hashlib,statistics,math,re
p=argparse.ArgumentParser();p.add_argument('--binary',required=True);p.add_argument('--out',required=True);p.add_argument('--wave',type=int,default=28);a=p.parse_args()
binary=pathlib.Path(a.binary).resolve();out=pathlib.Path(a.out);aff=sorted(os.sched_getaffinity(0));attempts=[];probes=[];threshold=.90
sha=hashlib.sha256(binary.read_bytes()).hexdigest()
def cpu():
 data={r.split()[0]:list(map(int,r.split()[1:])) for r in pathlib.Path('/proc/stat').read_text().splitlines() if r.startswith('cpu')};rows=[data[f'cpu{n}'] for n in aff];return sum(sum(r) for r in rows),sum(r[3]+r[4] for r in rows)
def fraction(a,b):return (b[1]-a[1])/(b[0]-a[0])
def record():
 qualified=[r for r in attempts if r['qualified']];times=sorted(r['seconds'] for r in qualified);campaign=sorted(r['campaignMs'] for r in qualified if r['campaignMs'] is not None)
 doc=dict(binarySha256=sha,wave=a.wave,affinityCpus=len(aff),idleThreshold=threshold,sequential=True,probes=probes,attempts=attempts,qualifiedProjects=len(qualified))
 if times:doc['summary']=dict(median=statistics.median(times),p90=times[math.ceil(len(times)*.9)-1],maximum=max(times),meanCpuIdleFraction=statistics.mean(r['cpuIdleFraction'] for r in qualified),campaignMs=dict(median=statistics.median(campaign),p90=campaign[math.ceil(len(campaign)*.9)-1],maximum=max(campaign)))
 out.write_text(json.dumps(doc,indent=2)+'\n')
for source in sorted((pathlib.Path.home()/'sb4-loop'/f'wave{a.wave}/apps').glob('*-snapback-*/snapback')):
 if not list(source.glob('*.q')):continue
 while True:
  while True:
   before=cpu();time.sleep(5);after=cpu();idle=fraction(before,after);probes.append(dict(lane=source.parent.name,idle=idle,load=os.getloadavg()));record()
   if idle>=threshold:break
  with tempfile.TemporaryDirectory(prefix='sb4-sec10-idle-') as tmp:
   root=pathlib.Path(tmp);(root/'snapback').mkdir();(root/'scratch').mkdir()
   texts=[(q.name,q.read_text()) for q in sorted(source.glob('*.q'))]
   for name,text in texts:(root/'snapback'/name).write_text(text)
   fixture=source.parent/'fixtures'
   if fixture.exists():
    for q in fixture.rglob('*.jsonl'):
     target=root/'fixtures'/q.relative_to(fixture);target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(q,target)
   before=cpu();started=time.monotonic();r=subprocess.run(['timeout','--kill-after=5s','180s',str(binary),'deploy',str(root/'production'),'--json'],cwd=root,env={**os.environ,'TMPDIR':str(root/'scratch')},capture_output=True,text=True,timeout=190);elapsed=time.monotonic()-started;after=cpu();idle=fraction(before,after)
   try:doc=json.loads(r.stdout)
   except ValueError:doc={}
   security=doc.get('security',{});security=json.loads(security) if isinstance(security,str) else security
   durations=re.findall(r'security deploy campaign: ([0-9]+) ms',r.stderr)
   row=dict(lane=source.parent.name,sourceSha256=hashlib.sha256(json.dumps(texts).encode()).hexdigest(),seconds=elapsed,cpuIdleFraction=idle,qualified=idle>=threshold,exit=r.returncode,securityRefused='E_SECURITY_REVIEW' in r.stdout+r.stderr,campaignMs=int(durations[-1]) if durations else None,gateKeys=sorted((d['code'],d['site'],d['id']) for d in security.get('securityReviews',[]) if d['gated'] and not d['acknowledged']),fixKeys=sorted((v['invariant']['site']['file'],v['invariant']['site']['line'],v['invariant']['site']['col'],v['counterexample']['operation']) for v in security.get('report',{}).get('invariants',[]) if v.get('counterexample') and v['counterexample'].get('reachability') in ['authored-fixture-trace','generated-fixture-trace']))
   attempts.append(row);record();print(json.dumps(dict(lane=row['lane'],seconds=elapsed,idle=idle,qualified=row['qualified'])),flush=True)
  if row['qualified']:break
assert sum(r['qualified'] for r in attempts)==50
record();print(json.dumps(json.loads(out.read_text())['summary']),flush=True)
