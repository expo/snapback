#!/usr/bin/env python3
"""Read-only corpus inputs; every experiment uses a cleaned temporary copy."""
import argparse, pathlib, tempfile, subprocess, json, hashlib, re, time
from concurrent.futures import ThreadPoolExecutor,as_completed
from threading import Lock
p=argparse.ArgumentParser();p.add_argument('--binary',required=True);p.add_argument('--out',required=True);p.add_argument('--waves',default='22');p.add_argument('--q1',action='store_true');p.add_argument('--test',action='store_true');args=p.parse_args()
binary=str(pathlib.Path(args.binary).resolve());out=pathlib.Path(args.out);out.mkdir(parents=True,exist_ok=True)
items=[]
if args.q1:
 for path in sorted(pathlib.Path.home().glob('sb4-loop/wave22-repro/q1/*/snapback/schema.q')):items.append((path.parent.parent.name,path.parent))
else:
 for wave in args.waves.split(','):
  for path in sorted(pathlib.Path.home().glob(f'sb4-loop/wave{wave}/apps/'+ ('*/snapback' if wave=='15' else '*-snapback-*/snapback'))):items.append((f'w{wave}-'+path.parent.name,path))
old=out/'results.json'
results=json.loads(old.read_text()) if old.exists() else []
done={r['lane'] for r in results if r['variant']=='none' or args.q1 or args.test}
lock=Lock()
def measure(item):
 label,source=item
 if label in done:return

 with tempfile.TemporaryDirectory(prefix='sec7-measure-') as tmp:
  root=pathlib.Path(tmp);(root/'snapback').mkdir();texts=[]
  for q in sorted(source.glob('*.q')):
   text=q.read_text();texts.append((q.name,text));(root/'snapback'/q.name).write_text(text)
  if not args.q1:variants=['own','none'] if not args.test else ['own']
  else:variants=['own']
  for variant in variants:
   if any(r["lane"]==label and r["variant"]==variant for r in results):continue
   for name,text in texts:(root/'snapback'/name).write_text(text if variant=='own' else '\n'.join(line for line in text.splitlines() if not line.lstrip().startswith('invariant '))+'\n')
   start=time.monotonic();r=subprocess.run(['timeout','25s',binary,'check','--json'],cwd=root,capture_output=True,text=True)
   try:j=json.loads(r.stdout)
   except Exception:j={}
   human=subprocess.run(['timeout','25s',binary,'check'],cwd=root,capture_output=True,text=True)
   notes=j.get('security',{}).get('notes',[]);reviews=j.get('securityReviews',[])
   row=dict(humanExit=human.returncode,humanJsonExitAgree=(human.returncode==r.returncode),lane=label,variant=variant,sha256=hashlib.sha256(json.dumps(texts).encode()).hexdigest(),exit=r.returncode,seconds=round(time.monotonic()-start,3),codes=sorted(set(n['code'] for n in notes)),visible=sorted(set(re.findall(r'N_[A-Z_]+',human.stdout))),gates=[d['code'] for d in reviews if d.get('gated') and not d.get('acknowledged')],notes=[dict(code=n['code'],message=n['message']) for n in notes])
   if args.test:
    t=subprocess.run(['timeout','300s',binary,'test'],cwd=root,capture_output=True,text=True);row['testExit']=t.returncode
    text=t.stdout+'\n'+t.stderr
    row['testSummary']=[line for line in text.splitlines() if line.startswith(('security tests:','security histories:','security not covered:','security:','test:'))]
    # full test output can carry generated fixture values only; do not copy evidence credentials.
    (out/(label+'-'+variant+'.test.txt')).write_text(text)
   with lock:
    results.append(row);(out/'results.json').write_text(json.dumps(sorted(results,key=lambda r:(r['lane'],r['variant'])),indent=2))
 print(label,flush=True)

with ThreadPoolExecutor(max_workers=6) as pool:
 for task in as_completed([pool.submit(measure,item) for item in items]):task.result()
