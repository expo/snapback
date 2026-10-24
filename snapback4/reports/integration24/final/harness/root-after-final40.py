from pathlib import Path
import subprocess,os,json,time,gzip,shutil
b=Path('/home/ccheever/sb4-loop/integ24');root=Path('/home/ccheever/projects/snapback-sb4loop');out=b/'root-after-final40';out.mkdir(exist_ok=True)
while not(b/'finalize-final40.exit').exists():time.sleep(3)
assert(b/'finalize-final40.exit').read_text().strip()=='0'
env=dict(os.environ,PATH='/home/ccheever/.bun-1.4.2/bin:'+os.environ['PATH'],CARGO_INCREMENTAL='0',CARGO_PROFILE_DEV_DEBUG='0',CARGO_PROFILE_TEST_DEBUG='0');commands=[]
for key,args in [('ref',['./ref-check']),('diagnostics',['node','scripts/generate-diagnostics-registry.mjs']),('manifest',['node','scripts/generate-guide-manifest.mjs']),('inventories',['node','scripts/check-inventories.mjs']),('guide',['node','scripts/check-guide.mjs'])]:
 with(out/(key+'.log')).open('w')as log:r=subprocess.run(['timeout','1800s',*args],cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=1820)
 commands.append({'key':key,'argv':args,'exit':r.returncode});(out/'commands.json').write_text(json.dumps(commands,indent=2)+'\n');print(key,r.returncode,flush=True);assert r.returncode==0
(out/'complete.json').write_text(json.dumps({'allPassed':True,'commands':commands},indent=2)+'\n')
(b/'root-after-final40.exit').write_text('0\n')
