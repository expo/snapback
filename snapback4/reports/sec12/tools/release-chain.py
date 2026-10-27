import pathlib,subprocess,json,shutil,time,concurrent.futures,sys
base=pathlib.Path('/home/ccheever/sb4-loop');out=pathlib.Path(sys.argv[2])if len(sys.argv)>2 else base/'reports/sec12/release-chain';out.mkdir(exist_ok=True);binary=sys.argv[1]
def measure(n):
 app=next((base/'wave31/apps').glob(n+'-snapback-*'));old=base/'wave31/v1-clients'/app.name/'snapback';root=out/app.name;(root/'snapback').mkdir(parents=True,exist_ok=True);steps=[]
 def sources(folder):
  for q in (root/'snapback').glob('*.q'):q.unlink()
  for q in folder.glob('*.q'):shutil.copy2(q,root/'snapback'/q.name)
 def run(name,args):
  start=time.monotonic();r=subprocess.run(['timeout','--kill-after=5s','1200s',binary,*args],cwd=root,capture_output=True,text=True);(root/(name+'.stdout')).write_text(r.stdout);(root/(name+'.stderr')).write_text(r.stderr)
  try:j=json.loads(r.stdout)
  except:j={}
  steps.append(dict(step=name,exit=r.returncode,seconds=round(time.monotonic()-start,2)));return r,j
 sources(old);r,j=run('deploy-v1',['deploy',str(root/'release'),'--json']);assert r.returncode==0,(n,'v1',r.stderr[-1000:])
 sources(app/'snapback');shutil.rmtree(root/'snapback/generated',ignore_errors=True)
 r,j=run('deploy-v2',['deploy',str(root/'release'),'--json']);security=j.get('security')or{};security=json.loads(security)if isinstance(security,str)else security
 gate=next(d for d in security.get('securityReviews',[])if d['code']=='N_RELEASE_CREATE_AUTHORITY'and d['gated']);assert r.returncode!=0;w=gate['witness']
 _,render=run('first-gate-message',['check']);first=(root/'first-gate-message.stdout').read_text()+(root/'first-gate-message.stderr').read_text();assert '--ack-security'in first and '--reason'in first and 'allow 'in first
 table,column,roles={'002':('fittings','referralScan',['frontdesk','manager']),'014':('projects','entrancePhoto',['owner','lead']),'019':('moves','price',['owner','coordinator'])}[n]
 predicate=' or '.join(f"exists roles[viewer, role = '{role}']"for role in roles);intent=f'allow {table}.{column} insert when {predicate}';reason=f"witness {w['id']}; {intent}"
 r,j=run('evaluated-ack',['check','--json','--ack-security',gate['id'],'--reason',reason]);assert any(d['id']==gate['id']and d['acknowledged']for d in j.get('securityReviews',[])),(n,r.stderr)
 r,j=run('deploy-allowed-v2',['deploy',str(root/'release'),'--json']);assert r.returncode==0,(n,'allowed',r.stderr[-1000:])
 fixed=base/'reports/sec12/fix-forward'/app.name/'snapback';sources(fixed);r,j=run('deploy-fixed',['deploy',str(root/'release'),'--json']);assert r.returncode==0,(n,'fixed',r.stderr[-1000:])
 result=dict(lane=app.name,gate=gate['id'],witness=w['id'],operation=w['operation'],viewer=w['viewer'],intent=intent,steps=steps);(root/'summary.json').write_text(json.dumps(result,indent=2));print(json.dumps(result),flush=True);return result
with concurrent.futures.ThreadPoolExecutor(max_workers=3)as p:rows=list(p.map(measure,['002','014','019']))
(out/'summary.json').write_text(json.dumps(rows,indent=2))
