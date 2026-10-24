from pathlib import Path
import subprocess,json,tomllib,os,shutil
root=Path('/home/ccheever/projects/snapback-sb4loop');sb=root/'snapback4';out=Path('/home/ccheever/sb4-loop/integ24/post-main-locks');out.mkdir(exist_ok=True)
env=dict(os.environ,CARGO_INCREMENTAL='0',CARGO_PROFILE_DEV_DEBUG='0',CARGO_PROFILE_TEST_DEBUG='0');commands=[];results=[]
for name,rel in [('evaluation','experiments/postgres'),('commit-path','experiments/postgres-commit-path'),('seed','experiments/scale-controls/postgres-seed')]:
 path=sb/rel/'Cargo.lock';before=tomllib.loads(path.read_text());shutil.copy2(path,out/(name+'-before.lock'))
 for phase,extra in [('regenerate',[]),('verify-locked',['--locked'])]:
  args=['cargo','metadata','--offline',*extra,'--format-version','1','--filter-platform','x86_64-unknown-linux-gnu','--manifest-path',str(sb/rel/'Cargo.toml')]
  with(out/(name+'-'+phase+'.json')).open('w')as log, (out/(name+'-'+phase+'.stderr')).open('w')as err:r=subprocess.run(['timeout','180s',*args],cwd=sb,env=env,stdout=log,stderr=err,timeout=200)
  commands.append({'name':name,'phase':phase,'argv':args,'exit':r.returncode});(out/'commands.json').write_text(json.dumps(commands,indent=2)+'\n');assert r.returncode==0,(name,phase)
 after=tomllib.loads(path.read_text());registry=lambda d:{(p['name'],p['version'],p['source'])for p in d['package']if'source'in p}
 assert registry(before)==registry(after),name+' unexpectedly changed registry package versions'
 versions=[(p['name'],p['version'])for p in after['package']if p['name']in['snapback4-core','snapback4-device','snapback4-lang']];assert versions and all(v=='0.4.40'for _,v in versions),versions
 results.append({'manifest':rel+'/Cargo.toml','pathVersions':versions,'registryPackageVersionsUnchanged':True});shutil.copy2(path,out/(name+'-after.lock'))
(out/'summary.json').write_text(json.dumps({'environment':{k:env[k]for k in ['CARGO_INCREMENTAL','CARGO_PROFILE_DEV_DEBUG','CARGO_PROFILE_TEST_DEBUG']},'results':results,'commands':commands},indent=2)+'\n');print(json.dumps(results),flush=True)
