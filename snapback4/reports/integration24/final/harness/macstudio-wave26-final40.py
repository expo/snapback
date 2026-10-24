from pathlib import Path
import os,subprocess,json,hashlib,shutil
root=Path('/Users/ccheever/projects/snapback-integ24');sb=root/'snapback4';out=root/'integration24-wave26-final40';out.mkdir(exist_ok=True)
tools=root/'integration24-tools';node=tools/'node-v24.13.1-darwin-arm64/bin';bun=tools/'bun-darwin-aarch64'
env=dict(os.environ,PATH=str(node)+':'+str(bun)+':/opt/homebrew/opt/coreutils/libexec/gnubin:/opt/homebrew/bin:/Users/ccheever/.cargo/bin:/Users/ccheever/.elan/bin:'+os.environ['PATH'],SNAPBACK_NODE=str(node/'node'),CARGO_INCREMENTAL='0',CARGO_PROFILE_DEV_DEBUG='0',CARGO_PROFILE_TEST_DEBUG='0',CARGO_TARGET_DIR=str(sb/'target'),CARGO_BUILD_JOBS='4',RUST_TEST_THREADS='8',CI='1',EXPO_NO_TELEMETRY='1')
for key in ['SNAPBACK4_BIN','SNAPBACK4_EVAL_POSTGRES','SNAPBACK4_STORE_URL']:env.pop(key,None)
commands=[]
def run(key,args,budget=10800):
 with(out/(key+'.log')).open('w')as log:r=subprocess.run(['timeout',str(budget)+'s',*args],cwd=sb,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=budget+20)
 commands.append({'key':key,'argv':args,'exit':r.returncode});(out/'commands.json').write_text(json.dumps(commands,indent=2)+'\n');print(key,r.returncode,flush=True);return r.returncode
assert run('core',['cargo','test','-p','snapback4-core','--no-fail-fast'])==0
assert run('core-postgres',['cargo','test','-p','snapback4-core','--features','postgres','--lib','--no-fail-fast'])==0
lang=['read_through','read_through_review','column_reads','column_writes','denied_writes','dx7_rules','guide','operation_evolution','release_bridge_security','security','security_histories','security_observers','security_sec5_output','security_sec6','security_sec7','security_sec7_day2','security_sec8','security_sec9','wave12_rule_recipes','wave1_rule_language','wave26_security']
run('lang',['cargo','test','-p','snapback4-lang','--lib',*[a for name in lang for a in ['--test',name]],'--no-fail-fast'])
run('device',['cargo','test','-p','snapback4-device','--test','column_reads','--test','readauth','--no-fail-fast'])
cli=['committer_ratchet','overload','day4','check','clock','day5_evidence','dx7_gates','replay','roll_views','security_reviews','security_wave19','token_live','wave26_security']
run('cli',['cargo','test','-p','snapback4','--bin','snapback4',*[a for name in cli for a in ['--test',name]],'--no-fail-fast'])
assert all(c['exit']==0 for c in commands),'affected Rust red; inspect before running a qualifying client pool'
assert run('wasm',['bash','scripts/build-wasm.sh'],3600)==0
assert run('client-build',['bun','run','--cwd','packages/snapback4','build'],1800)==0
directory=sb/'target/integ24-wave26-final40-bin';directory.mkdir(exist_ok=True);binary=directory/'snapback4';shutil.copy2(sb/'target/debug/snapback4',binary);env['SNAPBACK4_BIN']=str(binary)
sha=lambda f:hashlib.sha256(f.read_bytes()).hexdigest()
inputs={str(f.relative_to(root)):sha(f)for f in [binary,sb/'target/debug/snapback4',sb/'packages/snapback4/src/wasm/snapback4_device_bg.wasm',sb/'packages/snapback4/dist/proof-process.js']}
source=subprocess.check_output(['timeout','10s','git','rev-parse','HEAD'],cwd=root,text=True).strip();(out/'binding-before.json').write_text(json.dumps({'source':source,'artifacts':inputs},indent=2)+'\n')
files=sorted(set(json.loads((root/'mac-client-files.json').read_text()))|{'overload-browser','upload-retry'})
run('clients',['node','scripts/run-client-tests.mjs','6','files',*['packages/snapback4/test/'+name+'.test.mjs'for name in files]])
run('models',['node','scripts/run-client-tests.mjs','1','models','packages/snapback4/test/app-session-model.test.mjs','packages/snapback4/test/online-client-model.test.mjs'])
after={name:sha(root/name)for name in inputs};(out/'binding-after.json').write_text(json.dumps({'source':source,'unchanged':after==inputs,'artifacts':after},indent=2)+'\n');assert after==inputs
(out/'status.json').write_text(json.dumps({'source':source,'commands':commands,'clientFiles':len(files),'node':subprocess.check_output(['timeout','10s','node','--version'],env=env,text=True).strip(),'bun':subprocess.check_output(['timeout','10s','bun','--version'],env=env,text=True).strip()},indent=2)+'\n');assert all(c['exit']==0 for c in commands)
