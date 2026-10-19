import concurrent.futures,contextlib,hashlib,json,os,pathlib,re,shutil,subprocess,tempfile,time
ROOT=pathlib.Path('/home/ccheever/projects/sb4-b17-sec3'); OUT=pathlib.Path(os.environ.get('SEC3_OUT',str(ROOT/'snapback4/reports/20261019-sec3'))); BIN=os.environ.get('SEC3_BIN','/home/ccheever/sb4-sec3-bin')
SRC=pathlib.Path('/home/ccheever/sb4-loop/wave17/apps'); SPEC=pathlib.Path('/home/ccheever/sb4-loop/wave17-repro/sec')
OUT.mkdir(parents=True,exist_ok=True)
def run(cmd,cwd,limit=600):
 start=time.time();p=None
 try:
  p=subprocess.Popen([BIN,*cmd],cwd=cwd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  stdout,stderr=p.communicate(timeout=limit)
  p.stdout=stdout;p.stderr=stderr
  return {'command':cmd,'exit':p.returncode,'seconds':round(time.time()-start,3),'stdout':p.stdout,'stderr':p.stderr}
 except subprocess.TimeoutExpired as e:
  p.kill();p.communicate()
  for directory in pathlib.Path('/tmp').glob(f'snapback4-{p.pid}-*'):shutil.rmtree(directory)
  return {'command':cmd,'exit':'timeout','seconds':limit,'stdout':str(e.stdout or ''),'stderr':str(e.stderr or '')}
def lane(n):
 original=next(SRC.glob(f'{n:03}-snapback-*')); spec=SPEC/original.name
 with tempfile.TemporaryDirectory(prefix=f'sec3-{n:03}-',dir='/home/ccheever') as scratch:
  app=pathlib.Path(scratch);(app/'snapback').mkdir();hashes={}
  for q in original.joinpath('snapback').glob('*.q'):
   shutil.copy2(q,app/'snapback'/q.name);hashes[str(q)]=hashlib.sha256(q.read_bytes()).hexdigest()
  if n==21:
   q=app/'snapback/schema.q';text=q.read_text()
   header='mutation createTournament(code: text 1..40, name: text 1..120, briefDeadline: time):'
   bootstrap='  insert directors { tournament: t.id, principal: viewer }\n'
   assert text.count(header)==1 and text.count(bootstrap)==1
   text=text.replace(header,header+'\n  require exists directors[viewer] else NOT_DIRECTOR').replace(bootstrap,'')
   q.write_text(text);hashes['SEC3-F2-repaired-schema']=hashlib.sha256(text.encode()).hexdigest()
  security=spec/'snapback/security.q';shutil.copy2(security,app/'snapback/security.q');hashes[str(security)]=hashlib.sha256(security.read_bytes()).hexdigest()
  additions={15:"invariant handoffs.fromParty read only exists profiles[viewer, role = 'coordinator'] or (exists profiles[viewer, role = 'foster'] and exists pets[.pet, currentFoster = viewer])\n",27:"invariant releases.document read only (exists roles[viewer, role = 'guest'] and .guest = viewer) or exists roles[viewer, role = 'producer'] or exists roles[viewer, role = 'legal']\ninvariant releases.note read only (exists roles[viewer, role = 'guest'] and .guest = viewer) or exists roles[viewer, role = 'producer'] or exists roles[viewer, role = 'legal']\n"}
  if n in additions:
   added=additions[n];(app/'snapback/sec3-column-intent.q').write_text('-- SEC3: field restrictions translated from the original spec/change text.\n'+added);hashes['SEC3-added-column-intent']=hashlib.sha256(added.encode()).hexdigest()
  focused=spec/'fixtures-focused'
  fixtures=focused if focused.is_dir() else spec/'fixtures'
  shutil.copytree(fixtures,app/'fixtures')
  # Minimal project metadata; no frontend installation or deployed credentials.
  (app/'package.json').write_text('{"name":"sec3-probe","private":true,"type":"module"}\n')
  result={'lane':original.name,'binary_sha256':hashlib.sha256(pathlib.Path(BIN).read_bytes()).hexdigest(),'source_sha256':hashes,'fixture_source':str(fixtures),'fixture_sha256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in fixtures.glob('*') if p.is_file()}}
  result['check']=run(['check','--json','--fixture',str(app/'fixtures')],app)
  result['test']=run(['test','--fixture',str(app/'fixtures'),'--fixture-only','--all'],app)
  try:
   report=json.loads(result['check']['stdout'])
   result['invariants']=[{'site':v['invariant']['site'],'target':f"{v['invariant']['table']}.{v['invariant'].get('column') or ''} {v['invariant']['target']}",'predicate':v['invariant']['predicate'],'status':v['status'],'reachability':(v.get('counterexample') or {}).get('reachability'),'operation':(v.get('counterexample') or {}).get('operation')} for v in report.get('security',{}).get('invariants',[])]
   result['notes']=[{'code':x['code'],'site':x['site'],'message':x['message']} for x in report.get('security',{}).get('notes',[])]
  except Exception as e:result['parse_error']=str(e)
  (OUT/f'{n:03}.json').write_text(json.dumps(result,indent=2)+'\n')
  print(json.dumps({'lane':original.name,'check':result['check']['exit'],'test':result['test']['exit'],'seconds':result['check']['seconds']+result['test']['seconds'],'sequences':re.findall(r'security histories: (\d+)',result['test']['stdout'])}),flush=True)
  return result
if __name__=='__main__':
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(lane,[int(s) for s in os.environ.get('SEC3_LANES','6,11,13,15,19,21,27,40,45,48').split(',')]))
 (OUT/'high-lanes-summary.json').write_text(json.dumps([{k:v for k,v in r.items() if k not in ('check','test')} for r in results],indent=2)+'\n')
