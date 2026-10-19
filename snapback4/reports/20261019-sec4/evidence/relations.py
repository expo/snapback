import pathlib,tempfile,subprocess,json,gzip,hashlib,os,signal,sys
root=pathlib.Path(__file__).resolve().parent
binary=pathlib.Path(sys.argv[1]).resolve() if len(sys.argv)>1 else root.parent/'shipping-bin'
if not binary.is_file():raise SystemExit('supply an absolute verified CLI path')
lane=next(pathlib.Path.home().joinpath('sb4-loop/wave18/apps').glob('019-snapback-*'))
spec=next(pathlib.Path.home().joinpath('sb4-loop/wave18-repro/secA').glob('019-*/snapback/security.q')).read_text()
with tempfile.TemporaryDirectory(prefix='sec4-relationship-') as temp:
 p=pathlib.Path(temp);(p/'snapback').mkdir();(p/'tmp').mkdir()
 for f in lane.joinpath('snapback').glob('*.q'):(p/'snapback'/f.name).write_text('\n'.join(l for l in f.read_text().splitlines() if not l.startswith('invariant '))+'\n')
 (p/'snapback/security.q').write_text(spec);(p/'package.json').write_text('{"private":true}')
 child=subprocess.Popen([str(binary),'test'],cwd=p,env=dict(os.environ,TMPDIR=str(p/'tmp')),stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
 (root/'relations-pid.json').write_text(json.dumps({'pid':child.pid,'binary':str(binary)}))
 try:stdout,stderr=child.communicate(timeout=300)
 except subprocess.TimeoutExpired:
  os.killpg(child.pid,signal.SIGTERM)
  try:stdout,stderr=child.communicate(timeout=5)
  except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);stdout,stderr=child.communicate()
 with gzip.open(root/'019-finding-campaign.txt.gz','wt') as f:f.write(stdout+'\n'+stderr)
 witnesses=[json.loads(l.split(': ',1)[1]) for l in stdout.splitlines() if l.startswith('security violation: ')]
 def value(x):
  if isinstance(x,dict) and len(x)==1:
   k,v=next(iter(x.items()))
   if k in ['Row','Map']:return {c:value(v) for c,v in v.items()}
   if k=='Array':return [value(v) for v in v]
   if k in ['Id','String','Int','Bool']:return v
  return None if x=='Null' else x
 board=[];copied=[];transfers=[]
 for c in witnesses:
  r=value(c['row']);who=c['viewer']
  item={'origin':c['reachability'],'viewer':who,'operation':c['operation'],'row':r,'history':c.get('history',[])}
  if 'roles-sweep-' in who and r.get('rating')=='do-not-use':board.append(item)
  if r.get('landlord')==who and r.get('author')!=who and r.get('homeowner')!=who:copied.append(item)
  if any(s['operation']=='linkUnit' for s in c.get('history',[])):transfers.append(item)
 result={'exit':child.returncode,'sourceSha256':hashlib.sha256(lane.joinpath('snapback/schema.q').read_bytes()).hexdigest(),'intent':spec,'totalWitnesses':len(witnesses),'board':board,'copiedLandlord':copied,'authoredTransfers':transfers}
 (root/'019-findings.json').write_text(json.dumps(result,indent=2)+'\n');print({k:(len(v) if isinstance(v,list) else v) for k,v in result.items() if k not in ['intent','sourceSha256']})
