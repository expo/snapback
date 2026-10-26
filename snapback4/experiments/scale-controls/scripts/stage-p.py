#!/usr/bin/env python3
# @ref LLP 3000.009.001.000.000.002#3.11 — local attribution; no one-host capacity claim.
import argparse,hashlib
import concurrent.futures as cf, http.client, json, os, pathlib, shutil, signal, subprocess as sp, sys, time
R=pathlib.Path(__file__).resolve().parents[4]
p=argparse.ArgumentParser(description='Stage P local cost attribution; private PG16, unchanged S1 schema, 32 closed-loop clients. Raw output stays outside Git.')
p.add_argument('--out',required=True,type=pathlib.Path)
p.add_argument('--binary',type=pathlib.Path,default=R/'snapback4/target/release/snapback4')
p.add_argument('--seed-bin',type=pathlib.Path,default=R/'snapback4/target/release/sb4-postgres-scale-seed')
p.add_argument('--reuse-private',type=pathlib.Path,help='reuse a stopped private PG16 fixture instead of reseeding')
p.add_argument('--before-binary',type=pathlib.Path)
p.add_argument('--rows',type=int,default=1000000)
p.add_argument('--seconds',type=float,default=10)
p.add_argument('--statement-samples',type=float,default=0.02)
p.add_argument('--plan-samples',type=float,default=0.01)
a=p.parse_args()
if not 0<=a.statement_samples<=1 or not 0<=a.plan_samples<=1:p.error('sample rates must be between 0 and 1')
if R in a.out.resolve().parents:p.error('raw output must be outside the repository')
PG=pathlib.Path.home()/'tools/pg16/usr/lib/postgresql/16'; SHARE=pathlib.Path.home()/'tools/pg16/usr/share/postgresql/16'
out=a.out.resolve(); out.mkdir(parents=True,exist_ok=False); runtime=a.reuse_private.resolve() if a.reuse_private else out/'private'
if a.reuse_private:
    if (runtime/'data/postmaster.pid').exists():p.error('the private cluster must be stopped first')
    if (runtime/'data/PG_VERSION').read_text().strip()!='16':p.error('reuse requires a private PG16 fixture')
else:runtime.mkdir(mode=0o700)
env=dict(os.environ,PGHOST=str(runtime),PGPORT='55473',PGUSER='sb4_eval',PGDATABASE='postgres',LD_LIBRARY_PATH=str(pathlib.Path.home()/'tools/pg16/usr/lib/x86_64-linux-gnu'))
binary=a.binary.resolve();seed=a.seed_bin.resolve();children=[]
(out/'build.json').write_text(json.dumps(dict(binary=str(binary),binary_sha256=hashlib.sha256(binary.read_bytes()).hexdigest(),seed_sha256=hashlib.sha256(seed.read_bytes()).hexdigest(),rows=a.rows,command=sys.argv,commit=sp.check_output(['git','rev-parse','HEAD'],cwd=R,text=True).strip()))+'\n')
def disk():
    free=shutil.disk_usage('/home').free
    if free<25*1024**3:raise RuntimeError('/home <25 GiB')
def launch(args,name,cwd=None):
    disk();f=(out/(name+'.log')).open('w');p=sp.Popen(list(map(str,args)),env=env,stdout=f,stderr=sp.STDOUT,cwd=cwd);children.append((p,f,name))
    with (out/'pids.jsonl').open('a') as l:l.write(json.dumps(dict(pid=p.pid,name=name))+'\n')
    return p
def run(args,name,cwd=None):
    p=launch(args,name,cwd)
    while p.poll() is None:
        disk();time.sleep(.25)
    code=p.returncode
    if code:raise RuntimeError(f'{name}: {code}')
def sql(q):
    return sp.check_output([str(PG/'bin/psql'),'-XqAt','-v','ON_ERROR_STOP=1','-c',q],env=env,text=True).strip()
def pgcpu():
    total=0
    for p in pathlib.Path('/proc').glob('[0-9]*'):
        try:
            v=(p/'stat').read_text().rsplit(')',1)[1].split()
            if int(v[1])==master.pid:total+=int(v[11])+int(v[12])
        except (OSError,ValueError,IndexError):pass
    return total/os.sysconf('SC_CLK_TCK')
def stats():
    return json.loads(sql("SELECT coalesce(json_agg(s),'[]') FROM (SELECT queryid,query,calls,total_plan_time,total_exec_time,rows FROM pg_stat_statements WHERE dbid=(SELECT oid FROM pg_database WHERE datname=current_database())) s"))
def request(i,key):
    c=http.client.HTTPConnection('127.0.0.1',58073,timeout=30)
    body=json.dumps(dict(args=dict(counter=f'c{key:04}')))
    t=time.perf_counter();c.request('POST','/m/increment',body,{'Content-Type':'application/json','Authorization':'Bearer '+tokens[i]});r=c.getresponse();v=json.loads(r.read());c.close()
    return (time.perf_counter()-t)*1000,r.status,v.get('state'),v.get('denied',{}).get('code')
def phase(workload,seconds,prefix=""):
    wall_start=time.time()
    seq0=int(sql('SELECT seq FROM bench._head'));sql('SELECT pg_stat_statements_reset()');before=pgcpu();load=pathlib.Path('/proc/loadavg').read_text();start=time.perf_counter();end=start+seconds
    def worker(i):
        rows=[];n=0
        while time.perf_counter()<end:
            rows.append(request(i,256 if workload=='W5-same' or (workload=='W5-mix' and (n+i*37)%100==0) else i));n+=1
        return rows
    with cf.ThreadPoolExecutor(max_workers=32) as pool: rows=sum(list(pool.map(worker,range(32))),[])
    elapsed=time.perf_counter()-start;cpu=pgcpu()-before;v=stats();seq1=int(sql('SELECT seq FROM bench._head'));lat=sorted(r[0] for r in rows)
    result=dict(wall_start=wall_start,wall_end=time.time(),seq0=seq0,seq1=seq1,workload=workload,clients=32,seconds=elapsed,requests=len(rows),ok=sum(r[1]==200 and r[2]=='sent' for r in rows),failures=[r[1:] for r in rows if r[1]!=200 or r[2]!='sent'][:10],mean_ms=sum(lat)/len(lat),p50_ms=lat[len(lat)//2],p99_ms=lat[int(len(lat)*.99)],pg_cpu_us_per_write=cpu*1e6/(seq1-seq0),pg_cpu_us_per_attempt=cpu*1e6/len(rows),load_before=load,load_after=pathlib.Path('/proc/loadavg').read_text(),statements=v)
    (out/(prefix+workload+'.json')).write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items() if k!='statements'}),flush=True)
try:
    if not a.reuse_private:
        run([PG/'bin/initdb','-D',runtime/'data','-L',SHARE,'-U','sb4_eval','--auth-local=trust','--auth-host=reject','--no-locale','--encoding=UTF8'],'initdb')
    with (runtime/'data/postgresql.conf').open('a') as f:f.write(f"\nlisten_addresses=''\nport=55473\nunix_socket_directories='{runtime}'\nmax_connections=400\nshared_buffers='256MB'\nshared_preload_libraries='{PG}/lib/pg_stat_statements,{PG}/lib/auto_explain'\nauto_explain.log_min_duration=0\nauto_explain.sample_rate={a.plan_samples}\nauto_explain.log_analyze=on\nauto_explain.log_timing=on\nauto_explain.log_format=json\nlog_min_duration_sample=0\nlog_statement_sample_rate={a.statement_samples}\npg_stat_statements.track_planning=on\npg_stat_statements.track=top\njit=off\n")
    master=launch([PG/'bin/postgres','-D',runtime/'data'],'postgres')
    for _ in range(200):
        if (runtime/'.s.PGSQL.55473').exists() and sp.run([str(PG/'bin/pg_isready')],env=env,stdout=sp.DEVNULL,stderr=sp.DEVNULL).returncode==0:break
        time.sleep(.1)
    env['SNAPBACK4_STORE_URL']='postgres://sb4_eval@/postgres?host='+str(runtime)+'&port=55473&schema=bench&ha=none'
    if not a.reuse_private:
        sql('CREATE EXTENSION pg_stat_statements')
        project=runtime/'app';shutil.copytree(R/'snapback4/experiments/scale-controls/snapback-app',project,ignore=shutil.ignore_patterns('generated','.snapback4'))
        run([a.before_binary.resolve() if a.before_binary else binary,'deploy',runtime/'deployment','--json'],'deploy',project)
        binding=json.loads((runtime/'deployment/store-binding.json').read_text());config=runtime/'seed.json';config.write_text(json.dumps(dict(connection=f'host={runtime} port=55473 user=sb4_eval dbname=postgres',store_id=binding['store_id'],rows=a.rows,tokens_path=str(runtime/'tokens.json'))))
        run([seed,config],'seed')
    tokens=json.loads((runtime/'tokens.json').read_text())
    actual_rows=int(sql("SELECT count(*) FROM bench.r WHERE t='messages'"))
    if actual_rows!=a.rows:raise RuntimeError(f'fixture rows {actual_rows}, expected {a.rows}')
    sql('VACUUM ANALYZE')
    for arm,server in ([('before',a.before_binary.resolve()),('after',binary)] if a.before_binary else [('after',binary)]):
        (out/(arm+'-binary.json')).write_text(json.dumps(dict(binary=str(server),sha256=hashlib.sha256(server.read_bytes()).hexdigest()))+'\n')
        service=launch([server,'serve',runtime/'deployment','--worker-state-dir',runtime/'workers','--port','58073'],arm+'-serve')
        for _ in range(1200):
            if service.poll() is not None:raise RuntimeError('serve failed')
            if 'http://127.0.0.1:58073' in (out/(arm+'-serve.log')).read_text():break
            time.sleep(.1)
        phase('warmup',3,arm+'-')
        for w in ['W4','W5-mix','W5-same']: phase(w,a.seconds,arm+'-')
        service.terminate();service.wait(timeout=60)
        for _ in range(100):
            if sql('SELECT lease_until<clock_timestamp() FROM bench._owner')=='t':break
            time.sleep(.1)
        else:raise RuntimeError('owner lease did not expire')
        sql('VACUUM ANALYZE')
finally:
    for p,f,name in reversed(children):
        if p.poll() is None:
            p.send_signal(signal.SIGINT if name=='postgres' else signal.SIGTERM)
            try:p.wait(timeout=60)
            except sp.TimeoutExpired:p.kill();p.wait(timeout=20)
        f.close()
    living=[]
    for p,_,name in children:
        if p.poll() is None:living.append(dict(pid=p.pid,name=name))
    (out/'cleanup.json').write_text(json.dumps(dict(living=living,postmaster_pid_exists=(runtime/'data/postmaster.pid').exists()))+'\n')
    if living or (runtime/'data/postmaster.pid').exists():raise RuntimeError('cleanup not confirmed')
