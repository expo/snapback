"""Measure actual final default check/deploy output on frozen schema copies."""
import argparse,concurrent.futures,hashlib,json,os,pathlib,shutil,subprocess,tempfile,time
p=argparse.ArgumentParser();p.add_argument('--binary',required=True);p.add_argument('--out',required=True);p.add_argument('--workers',type=int,default=24);p.add_argument('--waves',default='15,16,18,19,20,21,22,23,24,25,26,27,28,29,30,31');a=p.parse_args();out=pathlib.Path(a.out);out.mkdir(parents=True,exist_ok=True);home=pathlib.Path.home()/'sb4-loop';items=[(w,s)for w in map(int,a.waves.split(','))for s in sorted((home/f'wave{w}/apps').glob('*/snapback'))if list(s.glob('*.q'))]
def measure(item):
 w,s=item
 with tempfile.TemporaryDirectory(prefix='sec12-final-display-')as t:
  root=pathlib.Path(t);(root/'snapback').mkdir();(root/'scratch').mkdir();texts=[(q.name,q.read_text())for q in sorted(s.glob('*.q'))]
  for name,text in texts:(root/'snapback'/name).write_text(text)
  if (s.parent/'fixtures').is_dir():
   for f in(s.parent/'fixtures').rglob('*.jsonl'):
    dest=root/'fixtures'/f.relative_to(s.parent/'fixtures');dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(f,dest)
  if w==31:
   prior=home/'wave31/v1-clients'/s.parent.name/'snapback';(root/'.snapback4').mkdir();(root/'.snapback4/security-write-baseline.json').write_text(json.dumps([(q.name,q.read_text())for q in sorted(prior.glob('*.q'))]))
  row=dict(wave=w,lane=s.parent.name,sha256=hashlib.sha256(json.dumps(texts).encode()).hexdigest())
  for label,args in [('check',['check']),('deploy',['deploy',str(root/'release')])]:
   start=time.monotonic();r=subprocess.run(['timeout','--kill-after=5s','1200s',binary,*args],cwd=root,capture_output=True,text=True,env={**os.environ,'TMPDIR':str(root/'scratch')});text=r.stdout+r.stderr;row[label]=dict(exit=r.returncode,seconds=round(time.monotonic()-start,3),lines=len(text.splitlines()),stdout=r.stdout,stderr=r.stderr)
  (out/f'w{w}-{s.parent.name}.json').write_text(json.dumps(row,indent=2));return row
with tempfile.TemporaryDirectory(prefix='sec12-display-binary-')as t:
 snapshot=pathlib.Path(t)/'snapback4';shutil.copy2(pathlib.Path(a.binary).resolve(),snapshot);binary=str(snapshot);(out/'measurement.json').write_text(json.dumps(dict(binarySha256=hashlib.sha256(snapshot.read_bytes()).hexdigest(),workers=a.workers,projects=len(items),waves=a.waves,watchdog=1200),indent=2))
 rows=[]
 with concurrent.futures.ThreadPoolExecutor(max_workers=a.workers)as pool:
  for row in pool.map(measure,items):
   rows.append(row);print(json.dumps(dict(done=len(rows),wave=row['wave'],lane=row['lane'],check=row['check']['exit'],deploy=row['deploy']['exit'])),flush=True)
 (out/'results.json').write_text(json.dumps(rows,indent=2))
