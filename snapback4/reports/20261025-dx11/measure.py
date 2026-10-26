import pathlib,shutil,subprocess,json,statistics,concurrent.futures,sys
root=pathlib.Path('/tmp/dx11-replay'); apps=pathlib.Path.home()/'sb4-loop/wave28/apps'
mode=sys.argv[1];binary=str(pathlib.Path(sys.argv[2]).resolve());out=root/mode;out.mkdir(exist_ok=True)
def run(app):
 lane=app.name[:3]; dst=out/lane;(dst/'snapback').mkdir(parents=True,exist_ok=True)
 for p in (app/'snapback').glob('*.q'):shutil.copyfile(p,dst/'snapback'/p.name)
 for name in ['package.json','.lane-idea.json']:
  if (app/name).is_file():shutil.copyfile(app/name,dst/name)
 # Exclude dispositions so every candidate is pending consistently.
 p=subprocess.run([binary,'check'],cwd=dst,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=90)
 text=p.stdout.decode(errors='replace');(dst/'check.txt').write_text(text)
 return dict(lane=lane,exit=p.returncode,lines=len(text.splitlines()),chars=len(text))
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:rows=sorted(pool.map(run,sorted(apps.glob('*-snapback-*'))),key=lambda r:r['lane'])
summary=dict(mode=mode,binary=binary,count=len(rows),medianLines=statistics.median(r['lines'] for r in rows),medianChars=statistics.median(r['chars'] for r in rows),passing=sum(r['exit']==0 for r in rows),rows=rows)
(out/'summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps({k:v for k,v in summary.items() if k!='rows'}))
