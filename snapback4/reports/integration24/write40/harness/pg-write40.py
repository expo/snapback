from pathlib import Path
import os,json,subprocess,time
p=Path('/home/ccheever/sb4-loop/integ24');out=p/'pg-write40';out.mkdir(exist_ok=True);sb=Path('/home/ccheever/projects/snapback-sb4loop/snapback4');pg=Path('/home/ccheever/tools/pg16/usr')
env=dict(os.environ,PATH=str(pg/'lib/postgresql/16/bin')+':'+os.environ['PATH'],LD_LIBRARY_PATH=str(pg/'lib/x86_64-linux-gnu'),CARGO_INCREMENTAL='0',CARGO_PROFILE_DEV_DEBUG='0',CARGO_PROFILE_TEST_DEBUG='0',CARGO_BUILD_JOBS='4',RUST_TEST_THREADS='1',CARGO_TARGET_DIR=str(p/'target-write40-postgres'))
commands=[]
def run(key,args,budget=1800):
 with(out/(key+'.log')).open('w')as log:r=subprocess.run(['timeout',str(budget)+'s',*map(str,args)],cwd=sb,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=budget+20)
 commands.append({'key':key,'argv':list(map(str,args)),'exit':r.returncode});(out/'commands.json').write_text(json.dumps(commands,indent=2)+'\n');return r.returncode
# Run deadline/fault campaigns after the mandatory full suite, with this lane's other expensive work complete.
while not(p/'rust-wave26-write40.exit').exists():time.sleep(3)
assert(p/'rust-wave26-write40.exit').read_text().strip()=='0'
assert run('initdb',['initdb','-D',out/'data','-L',pg/'share/postgresql/16','-U','sb4_eval','--auth-local=trust','--auth-host=reject','--encoding=UTF8','--no-locale'],120)==0
assert run('start',['pg_ctl','-D',out/'data','-l',out/'server.log','-o',f'-k {out} -c listen_addresses= -c max_connections=400 -p 55444','-w','start'],120)==0
env['SNAPBACK4_EVAL_POSTGRES']=f'host={out} port=55444 user=sb4_eval dbname=postgres'
try:
 assert run('core-postgres-lib',['cargo','test','--locked','-p','snapback4-core','--features','postgres','--lib','--no-fail-fast'],7200)==0
 assert run('literal-serving',['cargo','test','--locked','-p','snapback4-core','--features','postgres','--lib','engine::postgres::literal_tests','--','--include-ignored','--test-threads','1'],7200)==0
 assert run('composed-read-closure',['cargo','test','--locked','-p','snapback4-core','--features','postgres','--lib','engine::postgres::tests::read_closure','--','--include-ignored','--test-threads','1'],7200)==0
 assert run('round-trips',['cargo','test','--locked','-p','snapback4','--features','postgres','--bin','snapback4','round_trips','--','--include-ignored','--skip','pipeline_http_measure_128_clients','--test-threads','1'],7200)==0
 for key,filt in [('program-invocations','engine::program::tests'),('program-outcomes','engine::committer::outcome'),('program-batches','engine::program_batch')]:
  assert run(key,['cargo','test','--locked','-p','snapback4-core','--features','postgres','--lib',filt,'--','--include-ignored','--test-threads','1'],7200)==0
 assert run('difftest-stores',['cargo','test','--locked','-p','snapback4-difftest','--features','postgres','--test','stores','--','--test-threads','1'],7200)==0

finally:
 assert run('stop',['pg_ctl','-D',out/'data','-m','fast','-t','180','-w','stop'],200)==0
 assert run('status',['pg_ctl','-D',out/'data','status'],30)==3
 assert not(out/'data/postmaster.pid').exists()
 (out/'cleanup.json').write_text(json.dumps({'pgCtlStatus':3,'postmasterPidExists':False})+'\n')

import shutil
shutil.rmtree(out/'data')
