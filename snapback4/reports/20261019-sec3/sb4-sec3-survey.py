import concurrent.futures,gzip,hashlib,json,os,pathlib,shutil,subprocess,tempfile,time,collections
ROOT=pathlib.Path('/home/ccheever/projects/sb4-b17-sec3');OUT=pathlib.Path(os.environ.get('SEC3_OUT',str(ROOT/'snapback4/reports/20261019-sec3/final-r6')));OUT.mkdir(parents=True,exist_ok=True)
BIN=os.environ.get('SEC3_BIN','/home/ccheever/sb4-sec3-bin-final')
inputs=json.load(open(ROOT/'snapback4/reports/20261018-sec/inputs.json'))
def one(item):
 with tempfile.TemporaryDirectory(prefix='sec3-survey-',dir='/home/ccheever') as scratch:
  p=pathlib.Path(scratch);(p/'snapback').mkdir();hashes=[]
  for src in item['sources']:
   source=pathlib.Path(src['path']);actual=hashlib.sha256(source.read_bytes()).hexdigest();hashes.append({'path':str(source),'sha256':actual,'matches_previous_survey':actual==src['sha256']});shutil.copy2(source,p/'snapback'/source.name)
  (p/'package.json').write_text('{"name":"sec3-survey","private":true,"type":"module"}\n');start=time.time()
  try:
   r=subprocess.run([BIN,'check','--json'],cwd=p,capture_output=True,text=True,timeout=120)
   raw={'stdout':r.stdout,'stderr':r.stderr,'exit':r.returncode};result=json.loads(r.stdout)
   notes=result.get('security',{}).get('notes',[])
   entry={'wave':item['wave'],'lane':item['lane'],'exit':r.returncode,'seconds':round(time.time()-start,3),'sources':hashes,'diagnostics':result.get('problems',[]),'security_notes':notes,'compiler_notes':result.get('notes',[])}
  except Exception as e:entry={'wave':item['wave'],'lane':item['lane'],'error':str(e),'sources':hashes};raw=entry
  name=f"{item['wave']}-{item['lane']}"
  with gzip.open(OUT/(name+'.check.json.gz'),'wt') as f:json.dump(raw,f)
  return entry
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:results=list(pool.map(one,inputs))
(OUT/'survey.json').write_text(json.dumps({'binary_sha256':hashlib.sha256(pathlib.Path(BIN).read_bytes()).hexdigest(),'apps':results},indent=2)+'\n')
summary={'apps':len(results),'zero_refusals':all(x.get('exit')==0 for x in results),'failures':[{'lane':x['lane'],'exit':x.get('exit'),'error':x.get('error'),'diagnostics':x.get('diagnostics')} for x in results if x.get('exit')!=0],'security_notes':dict(collections.Counter(n['code'] for x in results for n in x.get('security_notes',[]))),'all_sites_located':all(n['site']['line']>0 for x in results for n in x.get('security_notes',[])),'all_sources_unchanged':all(s['matches_previous_survey'] for x in results for s in x['sources'])}
(OUT/'survey-summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary),flush=True)
