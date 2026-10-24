from pathlib import Path
import os,json,time,subprocess,hashlib,shutil
root=Path('/home/ccheever/projects/snapback-sb4loop');sb=root/'snapback4';base=Path('/home/ccheever/sb4-loop/integ24')
while not(base/'prepare-wave26-r8.exit').exists()or'Finished `test` profile'not in(base/'rust-wave26-r8.log').read_text():time.sleep(5)
assert (base/'prepare-wave26-r8.exit').read_text().strip()=='0'
assert subprocess.check_output(['timeout','10s','git','status','--porcelain'],cwd=root,text=True)==''
directory=sb/'target/integ24-wave26-r8-bin';directory.mkdir(exist_ok=True);binary=directory/'snapback4';shutil.copy2(sb/'target/debug/snapback4',binary)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
artifacts={str(p.relative_to(root)):sha(p)for p in [binary,sb/'target/debug/snapback4',sb/'packages/snapback4/src/wasm/snapback4_device_bg.wasm',sb/'packages/snapback4/dist/proof.js',sb/'packages/snapback4/dist/proof-process.js']}
files=sorted(str(p.relative_to(sb))for p in(sb/'packages/snapback4/test').glob('*.test.mjs')if p.name not in ['app-session-model.test.mjs','online-client-model.test.mjs'])
binding={'source':subprocess.check_output(['timeout','10s','git','rev-parse','HEAD'],cwd=root,text=True).strip(),'artifacts':artifacts,'clientSha256':sha(base/'pack-wave26-r8/snapback4-0.4.40.tgz'),'expoSha256':sha(base/'pack-wave26-r8/snapback4-expo-0.4.40.tgz'),'fileGroups':len(files)+1,'models':2}
(base/'client-wave26-r8-binding-before.json').write_text(json.dumps(binding,indent=2)+'\n')
env=dict(os.environ,PATH='/home/ccheever/.bun-1.4.2/bin:'+os.environ['PATH'],SNAPBACK4_BIN=str(binary),CARGO_INCREMENTAL='0',CARGO_PROFILE_DEV_DEBUG='0',CARGO_PROFILE_TEST_DEBUG='0',CI='1',EXPO_NO_TELEMETRY='1')
commands=[]
for key,args in [('pool',['node','scripts/run-client-tests.mjs','8','files','fixtures/',*files]),('models',['node','scripts/run-client-tests.mjs','1','models','packages/snapback4/test/app-session-model.test.mjs','packages/snapback4/test/online-client-model.test.mjs'])]:
 with(base/f'clients-wave26-r8-{key}.log').open('w')as log:r=subprocess.run(['timeout','10800s',*args],cwd=sb,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=10820)
 commands.append({'key':key,'argv':args,'exit':r.returncode});(base/'client-wave26-r8-commands.json').write_text(json.dumps(commands,indent=2)+'\n');print(key,r.returncode,flush=True)
status=subprocess.check_output(['timeout','10s','git','status','--porcelain'],cwd=root,text=True);(base/'client-wave26-r8-status.txt').write_text(status)
after={path:sha(root/path)for path in artifacts};(base/'client-wave26-r8-binding-after.json').write_text(json.dumps({'source':binding['source'],'unchanged':after==artifacts,'artifacts':after},indent=2)+'\n');assert after==artifacts,'an SDK/native artifact changed during the pool';assert status=='',status;assert all(c['exit']==0 for c in commands)
