from pathlib import Path
import os,sys,tempfile,shutil,subprocess,json,gzip,hashlib,time,concurrent.futures
base=Path('/home/ccheever/sb4-loop/integ24');mode=sys.argv[1];binary=Path(sys.argv[2]).resolve();out=base/('survey-wave26-'+mode);out.mkdir(exist_ok=True)
corpus=Path(os.environ['SURVEY_CORPUS'])if os.environ.get('SURVEY_CORPUS')else None
if corpus:
 items=[(r['wave'],corpus/r['source'])for r in json.loads((corpus/'manifest.json').read_text())['projects']]
else:
 items=[]
 for wave in [15,16,18,19,20,21,22,23,24,25,26]:
  for source in sorted((Path.home()/f'sb4-loop/wave{wave}/apps').glob('*/snapback'if wave==15 else'*-snapback-*/snapback')):items.append((wave,source))
assert len(items)==600,len(items)
if os.environ.get('SURVEY_ONLY'):
 prefixes=os.environ['SURVEY_ONLY'].split(',');items=[(w,s)for w,s in items if any(f'w{w}-{s.parent.name}'.startswith(prefix)for prefix in prefixes)]
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert len(items)==600,len(items)
if os.environ.get("SURVEY_ONLY"):
 prefixes=os.environ["SURVEY_ONLY"].split(",");items=[(w,s)for w,s in items if any(f"w{w}-{s.parent.name}".startswith(prefix)for prefix in prefixes)]
binding={'binary':str(binary),'binarySha256':sha(binary),'mode':mode,'projects':len(items),'sourceScope':'Quarry modules and contemporary fixture copies; no original store opened','source':subprocess.check_output(['timeout','10s','git','rev-parse','HEAD'],cwd='/home/ccheever/projects/snapback-sb4loop',text=True).strip()}
binding['checkoutSource']=binding['source'];binding['source']=os.environ.get('SURVEY_RUNTIME_SOURCE',binding['source']);binding['corpusManifestSha256']=sha(corpus/'manifest.json')if corpus else None
(out/'binding.json').write_text(json.dumps(binding,indent=2)+'\n')
def one(item):
 wave,source=item;key=f'w{wave}-{source.parent.name}';dest=out/(key+'.json.gz')
 if dest.exists():return json.loads(gzip.decompress(dest.read_bytes()))
 with tempfile.TemporaryDirectory(prefix='sb4-integ24-wave26-')as tmp:
  root=Path(tmp);(root/'snapback').mkdir();hashes={}
  for f in sorted(source.glob('*.q')):shutil.copy2(f,root/'snapback'/f.name);hashes[f.name]=sha(f)
  fixture=source.parent/'fixtures';fixtureHashes={}
  if fixture.is_dir():
   shutil.copytree(fixture,root/'fixtures',ignore=shutil.ignore_patterns('node_modules','store.sqlite*','*-token','*-owner'))
   fixtureHashes={str(f.relative_to(root/'fixtures')):sha(f)for f in(root/'fixtures').rglob('*')if f.is_file()}
  calls={}
  def run(key,args,budget):
   start=time.monotonic();r=subprocess.run(['timeout',str(budget)+'s',str(binary),*args],cwd=root,capture_output=True,text=True,timeout=budget+20)
   calls[key]={'argv':args,'exit':r.returncode,'seconds':round(time.monotonic()-start,3),'stdout':r.stdout,'stderr':r.stderr}
   try:return json.loads(r.stdout)
   except json.JSONDecodeError:return {}
  checked=run('check',['check','--json'],120)
  run('freshDeploy',['deploy','deployment-fresh','--json'],120)
  run('test',['test'],900)
  run('afterTestDeploy',['deploy','deployment-after-test','--json'],120)
  gates=[n for n in checked.get('securityReviews',[])if n.get('gated')and not n.get('acknowledged')]
  result={'project':key,'wave':wave,'sourceHashes':hashes,'fixtureHashes':fixtureHashes,'gates':gates,'calls':calls,'classification':'pending audit'if gates or any(calls[k]['exit']for k in ['freshDeploy','afterTestDeploy'])else'clear'}
  dest.write_bytes(gzip.compress((json.dumps(result)+'\n').encode(),compresslevel=6))
  print(key,*[key+':'+str(value['exit'])for key,value in calls.items()],flush=True);return result
with concurrent.futures.ThreadPoolExecutor(max_workers=int(os.environ.get('SURVEY_WORKERS','16')))as pool:rows=list(pool.map(one,items))
summary={'projects':len(rows),'gated':sum(bool(r['gates'])for r in rows),'freshRefused':sum(r['calls']['freshDeploy']['exit']!=0 for r in rows),'afterTestRefused':sum(r['calls']['afterTestDeploy']['exit']!=0 for r in rows),'testsFailed':sum(r['calls']['test']['exit']!=0 for r in rows),'timedOut':{k:[r['project']for r in rows if r['calls'][k]['exit']==124]for k in ['check','freshDeploy','test','afterTestDeploy']},'waves':{}}
for wave in sorted(set(r['wave']for r in rows)):
 selected=[r for r in rows if r['wave']==wave];summary['waves'][str(wave)]={'projects':len(selected),'gated':sum(bool(r['gates'])for r in selected),'freshRefused':sum(r['calls']['freshDeploy']['exit']!=0 for r in selected),'afterTestRefused':sum(r['calls']['afterTestDeploy']['exit']!=0 for r in selected),'testsFailed':sum(r['calls']['test']['exit']!=0 for r in selected)}
(out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n');assert binding['binarySha256']==sha(binary);print(json.dumps(summary),flush=True)
