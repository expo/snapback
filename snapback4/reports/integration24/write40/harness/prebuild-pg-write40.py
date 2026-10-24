from pathlib import Path
import subprocess,os,json
b=Path('/home/ccheever/sb4-loop/integ24');sb=Path('/home/ccheever/projects/snapback-sb4loop/snapback4');out=b/'pg-write40-prebuild';out.mkdir(exist_ok=True)
env=dict(os.environ,CARGO_INCREMENTAL='0',CARGO_PROFILE_DEV_DEBUG='0',CARGO_PROFILE_TEST_DEBUG='0',CARGO_BUILD_JOBS='6',CARGO_TARGET_DIR=str(b/'target-write40-postgres'))
commands=[]
for key,args in [('core',['cargo','test','--locked','-p','snapback4-core','--features','postgres','--lib','--no-run']),('cli',['cargo','test','--locked','-p','snapback4','--features','postgres','--bin','snapback4','--no-run']),('stores',['cargo','test','--locked','-p','snapback4-difftest','--features','postgres','--test','stores','--no-run'])]:
 with(out/(key+'.log')).open('w')as log:r=subprocess.run(['timeout','7200s',*args],cwd=sb,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=7220)
 commands.append({'key':key,'argv':args,'exit':r.returncode});(out/'commands.json').write_text(json.dumps(commands,indent=2)+'\n');print(key,r.returncode,flush=True);assert r.returncode==0
(b/'pg-write40-prebuild.exit').write_text('0\n')
