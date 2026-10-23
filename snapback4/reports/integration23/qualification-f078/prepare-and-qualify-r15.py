from pathlib import Path
import os,subprocess,json,hashlib
root=Path('/home/ccheever/projects/snapback-sb4loop');sb=root/'snapback4';out=Path('/tmp/integ23');assert not subprocess.check_output(['timeout','15s','git','status','--porcelain'],cwd=root,text=True).strip()
env=dict(os.environ,PATH='/home/ccheever/.bun-1.4.2/bin:'+os.environ['PATH'],CARGO_INCREMENTAL='0',CARGO_PROFILE_DEV_DEBUG='0',CARGO_PROFILE_TEST_DEBUG='0',CARGO_BUILD_JOBS='12',npm_config_cache=str(out/'npm-cache-qualify'))
def run(args,key,budget):
 with(out/(key+'.log')).open('w')as log:r=subprocess.run(['timeout',str(budget)+'s',*args],cwd=sb,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=budget+30)
 (out/(key+'.status')).write_text(str(r.returncode)+'\n');assert r.returncode==0,(key,r.returncode)
run(['node','scripts/publish.mjs','--prepare-client','--prepare-directory',str(out/'pack-final39-r15')],'prepare-final39-r15',1800)
source=subprocess.check_output(['timeout','15s','git','rev-parse','HEAD'],cwd=root,text=True).strip();dist=sb/'packages/snapback4/dist';actual={str(p.relative_to(dist)):hashlib.sha256(p.read_bytes()).hexdigest()for p in sorted(dist.rglob('*'))if p.is_file()};prior=json.loads((out/'client-r12/tested-repacked-content-r14.json').read_text())['packedDist'];assert actual==prior and len(actual)==312
ready={'source':source,'dist':actual,'identical312ShippingLeaves':True,'clientSha256':hashlib.sha256((out/'pack-final39-r15/snapback4-0.4.39.tgz').read_bytes()).hexdigest()};assert ready['clientSha256']=='0db7dfee7482d0d62be8ed1f6f84af3b8126c3304411b10eb65c9034c0fda96f';(out/'prepared-r15-ready.json').write_text(json.dumps(ready,indent=2)+'\n')
run(['node','scripts/qualify-linux.mjs','--consumer-only','--client',str(out/'pack-final39-r15/snapback4-0.4.39.tgz'),'--expo',str(out/'pack-final39-r15/snapback4-expo-0.4.39.tgz'),'--out',str(out/'qualified39-r15')],'qualify-final39-r15',10800)
