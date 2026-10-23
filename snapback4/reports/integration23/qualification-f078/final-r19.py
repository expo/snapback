from pathlib import Path
import os,subprocess,json,time,hashlib
root=Path('/home/ccheever/projects/snapback-sb4loop');sb=root/'snapback4';out=Path('/tmp/integ23')
for _ in range(1440):
 if(out/'prepared-r15-ready.json').exists():break
 time.sleep(5)
else:raise SystemExit('stable final SDK preparation missing')
ready=json.loads((out/'prepared-r15-ready.json').read_text());env=dict(os.environ,PATH='/home/ccheever/.bun-1.4.2/bin:'+os.environ['PATH'],CARGO_INCREMENTAL='0',CARGO_PROFILE_DEV_DEBUG='0',CARGO_PROFILE_TEST_DEBUG='0',CARGO_PROFILE_DEV_OPT_LEVEL='1',CARGO_BUILD_JOBS='12',RUST_TEST_THREADS='8',CI='1');env.pop('SNAPBACK4_EVAL_POSTGRES',None)
commands=[]
def run(key,args,budget=7200,accepted=(0,)):
 started=time.time()
 with(out/('final-'+key+'-r19.log')).open('w')as log:r=subprocess.run(['timeout',str(budget)+'s',*args],cwd=sb,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=budget+30)
 commands.append({'key':key,'argv':args,'exit':r.returncode,'seconds':time.time()-started});(out/('final-'+key+'-r19.status')).write_text(str(r.returncode)+'\n');(out/'final-r19-commands.json').write_text(json.dumps(commands,indent=2)+'\n');assert r.returncode in accepted,(key,r.returncode)
run('five-crate',['cargo','test','-p','snapback4-core','-p','snapback4-lang','-p','snapback4-device','-p','snapback4-sim','-p','snapback4','--no-fail-fast'],14400)
run('no-default',['cargo','check','-p','snapback4-core','--no-default-features'])
run('diff-build',['cargo','build','--release','-p','snapback4-difftest'])
for key,verb,cases in [('engine','run',20000),('devices','run-devices',1000),('lean','run-lean',20000)]:
 run('diff-'+key,['target/release/snapback4-difftest',verb,'--seed','0','--cases',str(cases),'--out',str(out/('diff-'+key+'-r19')),'--workers','12'],accepted=(0,1)if key=='lean'else(0,))
base=out/'base/lean-r15';candidate=out/'diff-lean-r19'
def thin(p):
 x=json.loads(p.read_text())
 for k in ['seconds','slowest_case_seconds','slowest_case_seed']:x.pop(k,None)
 return x
assert thin(base/'report.json')==thin(candidate/'report.json'),'Lean oracle/coverage delta requires investigation'
files=sorted(p.relative_to(base)for p in base.glob('worker-*/**/case.*')if p.is_file()and p.suffix in {'.json','.q'});actual=sorted(p.relative_to(candidate)for p in candidate.glob('worker-*/**/case.*')if p.is_file()and p.suffix in {'.json','.q'});assert files==actual and len(files)==76,(len(files),len(actual))
checks=[]
for p in files:
 a=(base/p).read_bytes();c=(candidate/p).read_bytes();assert a==c,str(p);checks.append({'path':str(p),'sha256':hashlib.sha256(c).hexdigest(),'sameBytes':True})
(out/'difftest-baseline-comparison-r19.json').write_text(json.dumps({'base':'7b051e5f3f','candidate':ready['source'],'ignoredTimingFields':['seconds','slowest_case_seconds','slowest_case_seed'],'sameAllOracleVerdicts':True,'sameCoverage':True,'newSignatures':[],'workerRepresentativeFiles':checks,'rawCommandExits':{r['key']:r['exit']for r in commands if r['key'].startswith('diff-')}},indent=2)+'\n');(out/'final-r19-qualified.status').write_text('0\n')
