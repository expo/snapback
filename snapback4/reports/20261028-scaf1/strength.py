import os,json,re,shutil,subprocess,time
from pathlib import Path
root=Path('/tmp/scaf1-replay');out=Path('/tmp/scaf1-evidence/strength');out.mkdir(exist_ok=True)
phase=os.environ.get('SCAF1_STRENGTH_PHASE','optimized-before')
results=[]
for n in [v for v in [1,39,19,18] if not os.environ.get('SCAF1_STRENGTH_ONLY') or str(v) in os.environ['SCAF1_STRENGTH_ONLY'].split(',')]:
 app=next((root/phase).glob(f'{n:03}-*'));variant=os.environ.get('SCAF1_STRENGTH_VARIANT','standard');clone=root/'strength'/variant/phase/app.name
 if clone.exists():raise Exception('refusing reuse '+str(clone))
 shutil.copytree(app,clone,ignore=shutil.ignore_patterns('node_modules','data','dist','logs','.git','.expo','artifacts'))
 (clone/'node_modules').symlink_to(app/'node_modules',target_is_directory=True)
 schema=clone/'snapback/schema.q';original=schema.read_text();env=dict(os.environ);env.pop('PORT_LO',None);env.pop('PORT_HI',None)
 tmp=root/'t'/f's{phase[:1]}{n}';tmp.mkdir(parents=True,exist_ok=True);env['TMPDIR']=str(tmp)
 tests=[('reference',original),('approval-actor',original.replace('approvedBy: viewer',"approvedBy: 'service:operator'"))]
 # Exact refusal-code controls are safe semantic mutations: the same forbidden
 # request must still be caught, with its authored code preserved.
 code={1:'STUDY_EXPIRED',39:'VENT_DEADLINE',19:('EXPIRED' if phase=='final-after' else 'PERMIT_EXPIRED'),18:'NOT_APPROVED'}[n]
 tests.append(('deadline-or-approval-code',original.replace('else '+code,'else SCAF1_WRONG_REFUSAL')))
 if variant=='missing-guard':tests=[('missing-deadline-or-approval-guard',re.sub(r'(?m)^(\s*)require .+ else '+code+r'$',r'\1require true else '+code,original))]
 for name,source in tests:
  if name!='reference' and source==original:raise Exception('mutation did not apply '+str(n)+name)
  schema.write_text(source);start=time.time()
  p=subprocess.run(['npm','run','acceptance'],cwd=clone,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=300)
  log=out/f'{phase}-{n}-{variant}-{name}.log';log.write_text(p.stdout)
  r=dict(phase=phase,idea=n,control=name,exit=p.returncode,wallSeconds=round(time.time()-start,3),expectedExit='zero' if name=='reference' else 'nonzero',log=str(log),introducedMutation=name!='reference')
  r['matchesExpectation']=(p.returncode==0)==(name=='reference');results.append(r)
  (out/(phase+'-'+variant+'-'+os.environ.get('SCAF1_STRENGTH_ONLY','all')+'.json')).write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(r),flush=True)
 schema.write_text(original)
