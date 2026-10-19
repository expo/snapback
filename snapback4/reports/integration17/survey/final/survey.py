import pathlib,tempfile,shutil,subprocess,json,hashlib,collections,concurrent.futures,time,gzip
repo=pathlib.Path('/home/ccheever/projects/snapback-sb4loop');base=pathlib.Path('/home/ccheever/sb4-loop');binary=repo/'snapback4/target/debug/snapback4';out=pathlib.Path('/tmp/integ17/survey-closeout');out.mkdir(parents=True,exist_ok=True)
assert subprocess.check_output(['timeout','30s',str(binary),'--version'],timeout=40).strip()==b'snapback4 0.4.33'
controls=[r for r in json.loads(gzip.decompress((repo/'snapback4/reports/integration16/schemas.json.gz').read_bytes())) if r['which']=='merged']; prior={(r['wave'],r['lane']):r for r in controls}; assert len(prior)==150
binding={'binary':str(binary),'binarySha256':hashlib.sha256(binary.read_bytes()).hexdigest(),'source':subprocess.check_output(['timeout','30s','git','rev-parse','HEAD'],cwd=repo,text=True).strip(),'baseline':'reports/integration16/schemas.json.gz 0.4.32 merged entries','method':'copy only flat snapback/*.q modules into private temporary projects, preserve module names, check --json; original apps untouched'}
def check(task):
 wave,path=task
 with tempfile.TemporaryDirectory(prefix='integ17-survey-') as d:
  dest=pathlib.Path(d)/'snapback';dest.mkdir(); hashes={}
  for p in sorted(path.glob('*.q')):
   shutil.copy2(p,dest/p.name);hashes[p.name]=hashlib.sha256(p.read_bytes()).hexdigest()
  assert hashes==prior[(wave,path.parent.name)]['hashes'], (wave,path.parent.name,'source changed versus Integration16')
  run=subprocess.run(['timeout','120s',str(binary),'check','--json'],cwd=d,text=True,capture_output=True,timeout=130)
  try:data=json.loads(run.stdout)
  except Exception:data={'parseError':run.stdout,'stderr':run.stderr}
  return dict(wave=wave,lane=path.parent.name,which='merged',exit=run.returncode,hashes=hashes,result=data)
apps=[(15,p) for p in sorted((base/'wave15/apps').glob('*/snapback'))]+[(16,p) for p in sorted((base/'wave16/apps').glob('*-snapback-*/snapback'))]
assert sum(w==15 for w,p in apps)==100;assert sum(w==16 for w,p in apps)==50
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:current=list(ex.map(check,apps))
rows=[dict(r,which='base') for r in controls]+current
(out/'schemas.json.gz').write_bytes(gzip.compress((json.dumps(rows,indent=2)+'\n').encode(),mtime=0))
summary={}
for wave in [15,16]:
 for which in ['base','merged']:
  group=[r for r in rows if r['wave']==wave and r['which']==which];c=collections.Counter(n['code'] for r in group for n in r['result'].get('notes',[]));errors=collections.Counter(n['code'] for r in group for n in r['result'].get('diagnostics',[]));summary[f'wave{wave}-{which}']=dict(count=len(group),passed=sum(r['exit']==0 for r in group),notes=sum(c.values()),codes=dict(sorted(c.items())),errors=dict(errors))
for wave in [15,16]:
 group=[r for r in current if r['wave']==wave];c=collections.Counter(n['code'] for r in group for n in r['result'].get('security',{}).get('notes',[]));summary[f'wave{wave}-merged']['securityNotes']=sum(c.values());summary[f'wave{wave}-merged']['securityCodes']=dict(sorted(c.items()));summary[f'wave{wave}-merged']['declaredInvariants']=sum(len(r['result'].get('security',{}).get('invariants',[])) for r in group)
(out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
for w,p in apps:
 assert {q.name:hashlib.sha256(q.read_bytes()).hexdigest() for q in sorted(p.glob('*.q'))}==prior[(w,p.parent.name)]['hashes']
binding['originalsVerifiedAgainAtCloseout']=True;binding['originalSchemaDirectories']=len(apps);binding['originalModules']=sum(len(r['hashes']) for r in current);(out/'binding.json').write_text(json.dumps(binding,indent=2)+'\n');print(json.dumps(summary,indent=2));assert all(r['exit']==0 for r in current)
