from pathlib import Path
import subprocess,os,json,time,concurrent.futures,threading
b=Path('/home/ccheever/sb4-loop/integ24');root=Path('/home/ccheever/projects/snapback-sb4loop');sb=root/'snapback4'
source=json.loads((b/'write40-source.json').read_text())['source'];assert subprocess.check_output(['timeout','10s','git','rev-parse','HEAD'],cwd=root,text=True).strip()==source
assert subprocess.check_output(['timeout','10s','git','status','--porcelain'],cwd=root,text=True)==''
env=dict(os.environ,PATH='/home/ccheever/.bun-1.4.2/bin:/home/ccheever/sb4-loop/integ24/tools/brotli-root/usr/bin:'+os.environ['PATH'],CARGO_INCREMENTAL='0',CARGO_PROFILE_DEV_DEBUG='0',CARGO_PROFILE_TEST_DEBUG='0',CARGO_BUILD_JOBS='8',RUST_TEST_THREADS='8');env.pop('SNAPBACK4_BIN',None)
commands={};ledger_lock=threading.Lock()
def execute(key,args,cwd=sb,budget=18000):
 with(b/(key+'.log')).open('w')as log:r=subprocess.run(['timeout',str(budget)+'s',*args],cwd=cwd,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=budget+20)
 (b/(key+'.exit')).write_text(str(r.returncode)+'\n');
 with ledger_lock:
  commands[key]={'argv':args,'cwd':str(cwd),'exit':r.returncode};(b/'write40-qualification-commands.json').write_text(json.dumps(commands,indent=2)+'\n')
 print(key,r.returncode,flush=True);return r.returncode
def prepare():
 while not(b/'rust-wave26-write40.log').exists()or 'Finished `test` profile'not in(b/'rust-wave26-write40.log').read_text():
  if(b/'rust-wave26-write40.exit').exists():assert(b/'rust-wave26-write40.exit').read_text().strip()=='0'
  time.sleep(3)
 return execute('prepare-wave26-write40',['node','scripts/publish.mjs','--prepare-client','--prepare-directory',str(b/'pack-wave26-write40')],budget=3600)
def rootchecks():
 return [execute(k,args,cwd=root,budget=1800)for k,args in [('ref-wave26-write40',['./ref-check']),('guide-wave26-write40',['node','scripts/check-guide.mjs']),('inventories-wave26-write40',['node','scripts/check-inventories.mjs'])]]
jobs=[lambda:execute('rust-wave26-write40',['cargo','test','-p','snapback4-core','-p','snapback4-lang','-p','snapback4-device','-p','snapback4-sim','-p','snapback4','--no-fail-fast'],budget=15000),prepare,lambda:execute('clients-wave26-write40-wrapper',['python3',str(b/'harness/clients-wave26-write40.py')]),lambda:execute('packed-wave26-write40-wrapper',['python3',str(b/'harness/pack-wave26-write40.py')]),lambda:execute('replays-wave26-write40-wrapper',['python3',str(b/'harness/wave26-write40-replays.py')]),lambda:execute('diff-wave26-write40-build',['cargo','build','--locked','--release','-p','snapback4-difftest'],budget=3600),lambda:execute('diff-wave26-write40-wrapper',['python3',str(b/'harness/diff-wave26-write40-coordinator.py')]),lambda:execute('macstudio-wave26-write40-wrapper',['python3',str(b/'harness/macstudio-wave26-write40-dispatch.py')],cwd=root,budget=21600),lambda:execute('pg-wave26-write40-wrapper',['python3',str(b/'harness/pg-write40.py')],budget=15000),lambda:execute('device-wave26-write40',['cargo','test','-p','snapback4-device','--test','column_reads','--test','readauth','--no-fail-fast'],budget=3600),rootchecks,lambda:execute('budget-wave26-write40-wrapper',['python3',str(b/'harness/docs-budget-wave26-write40.py')]),lambda:execute('audit-wave26-write40-wrapper',['python3',str(b/'harness/audit-wave26-write40.py')])]
with concurrent.futures.ThreadPoolExecutor(max_workers=len(jobs))as pool:list(pool.map(lambda f:f(),jobs))
assert all(c['exit']==0 for c in commands.values()),commands
