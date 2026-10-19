import collections,concurrent.futures,hashlib,json,os,pathlib,shutil,subprocess,tempfile,time
BIN=os.environ['SEC3_BIN'];OUT=pathlib.Path(os.environ['SEC3_OUT']);OUT.mkdir(parents=True,exist_ok=True)
BASE=pathlib.Path('/home/ccheever/sb4-loop/wave17/apps')
def lane(source):
 with tempfile.TemporaryDirectory(prefix='sec3-notes-',dir='/home/ccheever') as scratch:
  app=pathlib.Path(scratch);(app/'snapback').mkdir();hashes={}
  for q in source.joinpath('snapback').glob('*.q'):shutil.copy2(q,app/'snapback'/q.name);hashes[str(q)]=hashlib.sha256(q.read_bytes()).hexdigest()
  (app/'package.json').write_text('{"private":true,"type":"module"}\n')
  r=subprocess.run([BIN,'check','--json'],cwd=app,capture_output=True,text=True,timeout=120);v=json.loads(r.stdout)
  return {'lane':source.name,'exit':r.returncode,'sources':hashes,'notes':v['security']['notes'],'compiler_notes':v['notes']}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:results=list(pool.map(lane,sorted(BASE.glob('*-snapback-*'))))
summary={'binary_sha256':hashlib.sha256(pathlib.Path(BIN).read_bytes()).hexdigest(),'apps':results,'counts':dict(collections.Counter(n['code'] for r in results for n in r['notes']))}
(OUT/'wave17-notes.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary['counts']))
