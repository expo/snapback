from pathlib import Path
import os,sys,argparse,subprocess,json,shutil,hashlib,platform,time
p=argparse.ArgumentParser();p.add_argument('--root',required=True);p.add_argument('--out',required=True);p.add_argument('--pg-bin',required=True);p.add_argument('--pg-share',required=True);p.add_argument('--target',required=True);p.add_argument('--source',required=True);p.add_argument('--port',type=int,default=55445);a=p.parse_args()
root=Path(a.root);sb=root/'snapback4';out=Path(a.out);out.mkdir(parents=True,exist_ok=True)
env=dict(os.environ,PATH=a.pg_bin+':/opt/homebrew/opt/coreutils/libexec/gnubin:/opt/homebrew/bin:/Users/ccheever/.cargo/bin:/Users/ccheever/.elan/bin:/home/ccheever/.bun-1.4.2/bin:'+os.environ['PATH'],CARGO_INCREMENTAL='0',CARGO_PROFILE_DEV_DEBUG='0',CARGO_PROFILE_TEST_DEBUG='0',CARGO_BUILD_JOBS='4',RUST_TEST_THREADS='4',CARGO_TARGET_DIR=a.target)
if platform.system()=='Linux':env['LD_LIBRARY_PATH']='/home/ccheever/tools/pg16/usr/lib/x86_64-linux-gnu'
for name in ['SNAPBACK4_BIN','SNAPBACK4_STORE_URL','SNAPBACK4_EVAL_POSTGRES']:env.pop(name,None)
source=subprocess.check_output(['timeout','15s','git','rev-parse','HEAD'],cwd=root,text=True).strip();assert source==a.source
assert subprocess.check_output(['timeout','15s','git','status','--porcelain'],cwd=root,text=True)==''
commands=[]
def run(key,args,budget=3600):
 with(out/(key+'.log')).open('w')as log:r=subprocess.run(['timeout',str(budget)+'s',*map(str,args)],cwd=sb,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=budget+20)
 commands.append({'key':key,'argv':list(map(str,args)),'cwd':str(sb),'exit':r.returncode,'evalPostgres':env.get('SNAPBACK4_EVAL_POSTGRES')});(out/'commands.json').write_text(json.dumps(commands,indent=2)+'\n');print(key,r.returncode,flush=True);return r.returncode
(out/'binding.json').write_text(json.dumps({'source':source,'platform':platform.platform(),'environment':{k:env[k]for k in ['CARGO_INCREMENTAL','CARGO_PROFILE_DEV_DEBUG','CARGO_PROFILE_TEST_DEBUG','CARGO_TARGET_DIR','CARGO_BUILD_JOBS','RUST_TEST_THREADS']},'scope':'Upstream optional PostgreSQL reader transport, default CLI feature linkage, RT0, real private-cluster authority/fault/lifecycle/codec/store oracles. Full unchanged five-crate, client, survey and replay receipts remain bound to 4f8e498d2e.'},indent=2)+'\n')
assert run('initdb',['initdb','-D',out/'data','-L',a.pg_share,'-U','sb4_eval','--auth-local=trust','--auth-host=trust','--encoding=UTF8','--no-locale'],120)==0
assert run('start',['pg_ctl','-D',out/'data','-l',out/'server.log','-o',f'-k {out} -c listen_addresses=127.0.0.1 -c max_connections=400 -p {a.port}','-w','start'],120)==0
pid=int((out/'data/postmaster.pid').read_text().splitlines()[0]);unix=f'host={out} port={a.port} user=sb4_eval dbname=postgres';env['SNAPBACK4_EVAL_POSTGRES']=unix
try:
 assert run('core-postgres-full',['cargo','test','--locked','-p','snapback4-core','--features','postgres','--no-fail-fast'],7200)==0
 assert run('cli-full-bin',['cargo','test','--locked','-p','snapback4','--bin','snapback4','--test','committer_ratchet','--test','overload','--test','wave26_security','--no-fail-fast'],7200)==0
 assert run('pipeline-unix',['cargo','test','--locked','-p','snapback4-core','--features','postgres','--lib','engine::postgres::pipeline::tests','--','--include-ignored','--skip','pipeline_tcp_nodelay_on_reader_and_synchronous_writer','--test-threads','1'],1200)==0
 if platform.system()=='Linux':
  env['SNAPBACK4_EVAL_POSTGRES']=f'host=127.0.0.1 port={a.port} user=sb4_eval dbname=postgres'
  assert run('pipeline-tcp-nodelay',['cargo','test','--locked','-p','snapback4-core','--features','postgres','--lib','engine::postgres::pipeline::tests::pipeline_tcp_nodelay_on_reader_and_synchronous_writer','--','--include-ignored','--exact','--nocapture'],1200)==0
  env['SNAPBACK4_EVAL_POSTGRES']=unix
 env['SNAPBACK4_PIPELINE_MEASURE']='1'
 assert run('adapter-private',['cargo','test','--locked','-p','snapback4-core','--features','postgres','--lib','engine::postgres::tests','--','--include-ignored','--skip','log_plan_hygiene_cold_backend_tail_scan_witness','--test-threads','1','--nocapture'],3600)==0
 env.pop('SNAPBACK4_PIPELINE_MEASURE')
 assert run('cold-plan-private',['cargo','test','--locked','-p','snapback4-core','--features','postgres','--lib','log_plan_hygiene_cold_backend_tail_scan_witness','--','--include-ignored','--test-threads','1','--nocapture'],1800)==0
 for key,filt in [('literal-serving','engine::postgres::literal_tests'),('committer-private','engine::committer::postgres_tests'),('maintained-members','engine::committer::maintained_members'),('command-private','engine::command::tests')]:
  assert run(key,['cargo','test','--locked','-p','snapback4-core','--features','postgres','--lib',filt,'--','--include-ignored','--test-threads','1'],3600)==0
 assert run('postgres-evolution',['cargo','test','--locked','-p','snapback4-core','--features','postgres','--test','postgres_evolution','--','--include-ignored','--test-threads','1'],3600)==0
 assert run('round-trips',['cargo','test','--locked','-p','snapback4','--bin','snapback4','round_trips','--','--include-ignored','--skip','pipeline_http_measure_128_clients','--test-threads','1','--nocapture'],3600)==0
 env['SNAPBACK4_PIPELINE_HTTP_MEASURE']='1'
 assert run('pipeline-http-private',['cargo','test','--locked','-p','snapback4','--bin','snapback4','pipeline_http_measure_128_clients','--','--include-ignored','--test-threads','1','--nocapture'],1200)==0
 env.pop('SNAPBACK4_PIPELINE_HTTP_MEASURE')
 assert run('difftest-stores',['cargo','test','--locked','-p','snapback4-difftest','--features','postgres','--test','stores','--','--test-threads','1'],3600)==0
finally:
 stop=run('stop',['pg_ctl','-D',out/'data','-m','fast','-t','180','-w','stop'],210);status=run('status',['pg_ctl','-D',out/'data','status'],30)
 cleanup={'pid':pid,'stopExit':stop,'statusExit':status,'postmasterPidExists':(out/'data/postmaster.pid').exists()}
 try:os.kill(pid,0);cleanup['originalPidStillExists']=True
 except ProcessLookupError:cleanup['originalPidStillExists']=False
 (out/'cleanup.json').write_text(json.dumps(cleanup,indent=2)+'\n');assert stop==0 and status==3 and not cleanup['postmasterPidExists'] and not cleanup['originalPidStillExists']
shutil.rmtree(out/'data')
status=subprocess.check_output(['timeout','15s','git','status','--porcelain'],cwd=root,text=True);(out/'source-status.txt').write_text(status);assert status==''
(out/'complete.json').write_text(json.dumps({'source':source,'allCommandsPassed':True,'dataRemoved':not(out/'data').exists()},indent=2)+'\n')
