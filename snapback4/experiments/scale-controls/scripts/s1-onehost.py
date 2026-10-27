#!/usr/bin/env python3
"""One-host S1 protocol shared by rawpg, Supabase, Convex and Snapback.

Raw evidence and private state must be outside Git. See --help and the report.
No remote services, tuning, publication, Git mutation or unowned signals.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import resource
import secrets
import shutil
import signal
import socket
import subprocess as sp
import sys
import tempfile
import threading
import time
from urllib.parse import quote

import run
from run import Run, HERE, write
import supabase

PG_CORES='0-2,6-8'
APP_CORES='3-4,9-10'
LOAD_CORES='5,11'
PGBIN=Path.home()/'.local/sb4-postgresql-16.15/bin'
DEFAULT_BIN=HERE.parents[1]/'target/release/sb4-scale-controls'
PGPORT=55440


def identity(pid):
    try:
        f=Path(f'/proc/{pid}/stat').read_text().rsplit(')',1)[1].split()
        return dict(pid=pid,start_ticks=int(f[19]),state=f[0],ppid=int(f[1]),ticks=int(f[11])+int(f[12]))
    except (OSError,ValueError,IndexError):return None


def live(record):
    now=identity(record['pid'])
    return bool(now and now['start_ticks']==record.get('start_ticks') and now['state']!='Z')


def processes():
    return {int(p.name):s for p in Path('/proc').glob('[0-9]*') if (s:=identity(int(p.name)))}


def append(path,value):
    with path.open('a') as f:f.write(json.dumps(value,separators=(',',':'))+'\n')


def disk(out):
    free=shutil.disk_usage('/home').free
    append(out/'disk.jsonl',dict(time=time.time(),free_bytes=free))
    if free<30*1024**3:raise RuntimeError('/home below 30 GiB; stop')


def configure(args):
    run.BIN=Path(args.harness).resolve();run.PSQL=PGBIN/'psql'
    run.APP_CORES=APP_CORES;run.LOAD_CORES=LOAD_CORES
    supabase.BIN=run.BIN;supabase.PSQL=run.PSQL;supabase.APP_CORES=APP_CORES
    if args.system=='rawpg':
        import fairness
        fairness.PSQL=run.PSQL
        return fairness.Raw
    if args.system=='supabase':return supabase.SupabaseRun
    if args.system=='convex':
        import convex
        convex.BIN=run.BIN;convex.APP_CORES=APP_CORES
        return convex.ConvexRun
    import snapback
    if getattr(args,'store','postgres')=='sqlite':
        snapback.SB=Path(args.snapback_bin).resolve()
        snapback.APP_CORES=APP_CORES;snapback.LOAD_CORES=LOAD_CORES;snapback.BIN=run.BIN
        return snapback.Snapback
    spec=importlib.util.spec_from_file_location('native_pg',HERE/'scripts/postgres-2.py')
    native=importlib.util.module_from_spec(spec);spec.loader.exec_module(native)
    snapback.SB=Path(args.snapback_bin).resolve()
    snapback.APP_CORES=native.APP_CORES=APP_CORES
    snapback.LOAD_CORES=native.LOAD_CORES=LOAD_CORES
    native.PSQL=run.PSQL;native.BIN=run.BIN
    return native.Postgres


def make_runner(base):
    class OneHost(base):
        # @ref LLP 3000.009.001.002#6-method-and-metrics — all systems share arrival/SLO/counter qualification; only native lifecycle differs
        def __init__(self,args):
            self.args=args;self.out=Path(args.out).resolve()
            self.out.mkdir(parents=True,exist_ok=False)
            if HERE.parents[2] in self.out.parents:raise RuntimeError('raw output must be outside the repository')
            self.runtime=Path(tempfile.mkdtemp(prefix='s1c-',dir='/tmp'))
            self.runtime.chmod(0o700)
            self.service=self.dispatcher=None;self.proxy=None;self.pool=self.admin=None
            self.tunnels=[];self.children=[];self.started=[];self.master=None
            self.db=None;self.db_prefix='s1c_'+args.system;self.pw=Path.home()/'sb4scale/pw'
            self.env=dict(os.environ,PGHOST=str(self.runtime/'u'),PGPORT=str(PGPORT),
                PGUSER='sb4scale',PGDATABASE='postgres',PGAPPNAME='sb4scale_observer',
                SCALE_PASSWORD_FILE=str(self.pw),SCALE_DB_USER='scale_app')
            for name in ('PGPASSWORD','PGOPTIONS','SNAPBACK4_STORE_URL','SCALE_PG_SOCKET'):
                self.env.pop(name,None)
            soft,hard=resource.getrlimit(resource.RLIMIT_NOFILE)
            resource.setrlimit(resource.RLIMIT_NOFILE,(max(8192,soft),hard))
            self.private=self.runtime/'tokens.json'
            self.env['SCALE_JWT_TOKENS_FILE']=str(self.private)
            self.env['PATH']=str(Path.home()/'.local/bin')+':'+self.env['PATH']
            self.project=self.runtime/'app';self.release=self.runtime/'deployment'
            self.socket=self.runtime/'s';self.upstream=self.runtime/'u'
            self.socket.mkdir();self.upstream.mkdir()
            original=sp.Popen;ledger=self.out/'all-pids.jsonl';started=self.started
            class RecordedPopen(original):
                def __init__(child,*a,**kw):
                    super().__init__(*a,**kw);started.append(child)
                    record=identity(child.pid) or dict(pid=child.pid,start_ticks=None)
                    append(ledger,dict(**record,kind='subprocess',executable=str(child.args[0]),time=time.time()))
            self.original_popen=original;sp.Popen=RecordedPopen
            append(ledger,dict(**identity(os.getpid()),kind='controller',time=time.time()))
            self.observe_stop=threading.Event()
            def observe():
                seen=set()
                while not self.observe_stop.wait(.25):
                    table=processes();owned={os.getpid()}
                    while True:
                        extra={pid for pid,r in table.items() if r['ppid'] in owned}-owned
                        if not extra:break
                        owned|=extra
                    for pid in owned:
                        r=table.get(pid)
                        if not r or (pid,r['start_ticks']) in seen:continue
                        seen.add((pid,r['start_ticks']))
                        append(ledger,dict(**r,kind='observed-descendant',time=time.time()))
                        try:
                            exe=Path(f'/proc/{pid}/exe').resolve().name
                            if exe=='sb4-scale-controls' and (b'load' in Path(f'/proc/{pid}/cmdline').read_bytes().split(b'\0')):
                                tasks=[]
                                for task in Path(f'/proc/{pid}/task').iterdir():
                                    actual=os.sched_getaffinity(int(task.name))
                                    tasks.append(dict(tid=int(task.name),cpus=sorted(actual)))
                                append(self.out/'generator-affinity.jsonl',dict(pid=pid,tasks=tasks,time=time.time()))
                        except (OSError,ProcessLookupError):pass
            self.observer=threading.Thread(target=observe,daemon=True);self.observer.start()
            if args.system=='rawpg':
                secret=self.runtime/'jwt-secret'
                supabase.private_file(secret,secrets.token_hex(32))
                self.env['SCALE_JWT_SECRET_FILE']=str(secret)
                supabase.private_file(self.private,json.dumps([supabase.token(secret.read_bytes(),i) for i in range(256)]))
                self.statement_roles=['scale_app']
            elif args.system=='supabase':
                self.jwt=self.runtime/'jwt-secret';self.tokens_path=self.private
                supabase.private_file(self.jwt,secrets.token_hex(32))
                supabase.private_file(self.private,json.dumps([supabase.token(self.jwt.read_bytes(),i) for i in range(256)]))
                self.env.update(PGOPTIONS='-c search_path=sb4scale,public',PGRST_JWT_SECRET='@'+str(self.jwt),PGRST_DB_USE_LEGACY_GUCS='false')
            elif args.system=='convex':
                import convex
                convex.ROOT=self.runtime/'convex';convex.ROOT.mkdir()
                self.env.update(CONVEX_SELF_HOSTED_URL='http://127.0.0.1:58080',CONVEX_DISABLE_TELEMETRY='1',DO_NOT_TRACK='1')
                self.credentials()
            else:
                import snapback
                shutil.copytree(snapback.APP,self.project,ignore=shutil.ignore_patterns('generated','.snapback4'))
            write(self.out/'custody.json',dict(private_root=str(self.runtime),system=args.system,pid=os.getpid()))

        def record(self,p,kind,**fields):
            append(self.out/'pids.jsonl',dict(pid=p.pid,kind=kind,time=time.time(),**fields))

        def spawn(self,command,directory,kind,cwd=None):
            out=(directory/(kind+'.stdout')).open('x');err=(directory/(kind+'.stderr')).open('x')
            p=sp.Popen(list(map(str,command)),cwd=cwd,env=self.env,stdin=sp.DEVNULL,stdout=out,stderr=err)
            self.children.append((p,out,err));self.record(p,kind)
            return p,out,err

        def sqlpg(self,sql,db=None):return Run.psql(self,sql=sql,database=db or self.db or 'postgres')

        def psql(self,sql=None,path=None,database=None):
            if self.args.system=='convex':return base.psql(self,sql,path,database)
            return Run.psql(self,sql,path,database)

        def select_link(self,delay):
            self.env['SCALE_PG_SOCKET']=str(self.socket)

        def start(self):
            disk(self.out)
            for port in (58080,58081,58082,58083):
                with socket.socket() as s:
                    # Match the real HTTP listeners: TIME_WAIT from a stopped
                    # smoke is reusable, while a live listener still refuses.
                    s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
                    s.bind(('127.0.0.1',port))
            data=self.runtime/'pg'
            result=sp.run([str(PGBIN/'initdb'),'-D',str(data),'-U','sb4scale','--auth-local=trust','--auth-host=reject','--no-locale','--encoding=UTF8'],capture_output=True,text=True)
            (self.out/'initdb.txt').write_text(result.stdout+result.stderr)
            if result.returncode:raise RuntimeError('initdb failed')
            delta=(HERE/'postgresql.conf.delta').read_text()
            delta+='\n# One-host private endpoints; all durability/resource settings inherited.\n'
            delta+=f"listen_addresses = ''\nport = {PGPORT}\nunix_socket_directories = '{self.upstream}'\n"
            with (data/'postgresql.conf').open('a') as f:f.write('\n'+delta)
            self.master=self.spawn(['taskset','-c',PG_CORES,PGBIN/'postgres','-D',data],self.out,'postgres')
            self.record(self.master[0],'postgres-master')
            deadline=time.monotonic()+60
            while True:
                if self.master[0].poll() is not None:raise RuntimeError('private postgres exited')
                if (self.upstream/f'.s.PGSQL.{PGPORT}').exists():
                    r=sp.run([str(run.PSQL),'-XqAt','-d','postgres','-c','SELECT 1'],env=self.env,capture_output=True,text=True)
                    if r.returncode==0:break
                if time.monotonic()>deadline:raise RuntimeError('private postgres readiness timeout')
                time.sleep(.1)
            for role,opts in dict(scale_app='LOGIN',anon='NOLOGIN NOINHERIT',authenticated='NOLOGIN NOINHERIT',service_role='NOLOGIN NOINHERIT BYPASSRLS',authenticator='LOGIN NOINHERIT',s1pg2_app='LOGIN').items():
                self.sqlpg(f'CREATE ROLE {role} {opts}')
            self.sqlpg("GRANT anon,authenticated,service_role TO authenticator; ALTER ROLE anon SET statement_timeout='3s'; ALTER ROLE authenticated SET statement_timeout='8s'; ALTER ROLE authenticator SET statement_timeout='8s'")
            (self.out/'postgres-settings.txt').write_text(self.sqlpg("SELECT version(); SELECT name,setting,unit FROM pg_settings WHERE name IN ('listen_addresses','port','fsync','synchronous_commit','full_page_writes','shared_buffers','max_connections','min_wal_size','max_wal_size','shared_preload_libraries','wal_sync_method','jit','track_io_timing','track_wal_io_timing','pg_stat_statements.track') ORDER BY name"))
            binaries={}
            if self.args.system=='snapback':binaries=dict(snapback=Path(self.args.snapback_bin),seed=Path(self.args.seed_bin))
            elif self.args.system=='supabase':binaries=dict(postgrest=supabase.POSTGREST)
            elif self.args.system=='convex':
                import convex
                binaries=dict(convex=convex.BACKEND)
            write(self.out/'ownership.json',dict(source_commit=sp.check_output(['git','rev-parse','HEAD'],text=True).strip(),system=self.args.system,
                binary_sha256=hashlib.sha256(run.BIN.read_bytes()).hexdigest(),
                target_binary_sha256={name:hashlib.sha256(path.read_bytes()).hexdigest() for name,path in binaries.items()},
                source_sha256={str(p.relative_to(HERE)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [*sorted((HERE/'scripts').glob('*.py')),*sorted((HERE/'src').glob('*.rs')),*sorted(HERE.glob('*.sql')),HERE/'supabase.conf',HERE/'postgresql.conf.delta',HERE/'Cargo.toml',HERE/'Cargo.lock',HERE/'postgres-seed/Cargo.toml',HERE/'postgres-seed/Cargo.lock',HERE/'postgres-seed/src/main.rs',HERE/'snapback-app/snapback/schema.q']},
                pg_cores=PG_CORES,app_cores=APP_CORES,load_cores=LOAD_CORES,method=dict(warmup_ms=self.args.warmup_ms,duration_ms=self.args.duration_ms,repeats=self.args.repeats,extra_read_rates=self.args.extra_read_rates),
                command=sys.argv,postgres_pid=self.master[0].pid,host=socket.gethostname()))
            (self.out/'host.txt').write_text(sp.check_output(['bash','-c','hostname; uname -a; lscpu; free -m; df -h /home; uptime'],text=True))

        def fixture(self,rows):
            self.db=f'{self.db_prefix}_{rows}';self.env['SCALE_DATABASE']=self.db
            d=self.out/'fixture-link';d.mkdir();self.link(0,d)
            if self.args.system in ('rawpg','supabase'):
                Run.fixture(self,rows)
                if self.args.system=='supabase':
                    self.psql(path=HERE/'supabase-align.sql');self.capture_plans(rows)
                q="SELECT jsonb_build_object('messages',(SELECT count(*) FROM messages),'rooms',(SELECT count(*) FROM rooms),'users',(SELECT count(*) FROM users),'memberships',(SELECT count(*) FROM memberships),'counters',(SELECT count(*) FROM counters),'bad_messages',(SELECT count(*) FROM messages WHERE room<>(id-1)%1024 OR sender<>((id-1)%1024)/4 OR at<>1700000000000+id OR body<>'message-'||id::text||' '||repeat('chat ',30)),'bad_room_totals',(SELECT count(*) FROM rooms r WHERE total<>(SELECT count(*) FROM messages m WHERE m.room=r.id)),'bad_sender_totals',(SELECT count(*) FROM users u WHERE sent<>(SELECT count(*) FROM messages m WHERE m.sender=u.id)))"
                v=json.loads(self.psql(q));assert v==dict(messages=rows,rooms=1025,users=256,memberships=8448,counters=257,bad_messages=0,bad_room_totals=0,bad_sender_totals=0)
                write(self.out/'seed-equality.json',v)
            elif self.args.system=='convex':
                base.fixture(self,rows)
                write(self.out/'seed-equality.json',checks_module().convex_image(self,rows))
            else:
                self.sqlpg('CREATE DATABASE '+self.db+' OWNER s1pg2_app','postgres')
                self.sqlpg('CREATE EXTENSION pg_stat_statements')
                self.env['SCALE_DB_USER']='s1pg2_app'
                self.env['SNAPBACK4_STORE_URL']='postgres://s1pg2_app@/'+self.db+'?host='+quote(str(self.socket),safe='')+'&port=55440&schema=bench&ha=none'
                self.command([self.args.snapback_bin,'deploy',self.release,'--json'],'deploy',self.project)
                binding=json.loads((self.release/'store-binding.json').read_text())
                config=self.runtime/'seed.json'
                supabase.private_file(config,json.dumps(dict(connection=f'host={self.upstream} port=55440 user=s1pg2_app dbname={self.db}',store_id=binding['store_id'],rows=rows,tokens_path=str(self.private))))
                self.command(['taskset','-c',APP_CORES,self.args.seed_bin,config],'seed')
                self.private.chmod(0o600);self.tokens=json.loads(self.private.read_text())
                barrier=self.runtime/'barrier-token'
                config.write_text(json.dumps(dict(connection=f'host={self.upstream} port=55440 user=s1pg2_app dbname={self.db}',store_id=binding['store_id'],drain_only=True,session_path=str(barrier))))
                self.command([self.args.seed_bin,config],'barrier')
                self.barrier_token=barrier.read_text().strip()
                write(self.out/'seed-equality.json',self.verify_seed(rows));self.sqlpg('VACUUM ANALYZE')

        def link(self,delay,directory):
            if self.proxy:
                p,out,err=self.proxy
                if p.poll() is None:p.terminate()
                p.wait(timeout=15);out.close();err.close();self.proxy=None
            linkdir=self.runtime/('d'+str(time.time_ns()))
            self.proxy=self.spawn(['taskset','-c',APP_CORES,run.BIN,'unix-proxy','--socket-dir',linkdir,'--upstream-dir',self.upstream,'--delay-us',str(delay)],directory,'link')
            self.record(self.proxy[0],'app',component='shared-delay-proxy')
            deadline=time.monotonic()+10
            while not (linkdir/f'.s.PGSQL.{PGPORT}').exists():
                if self.proxy[0].poll() is not None or time.monotonic()>deadline:raise RuntimeError('link readiness failed')
                time.sleep(.02)
            path=self.socket/f'.s.PGSQL.{PGPORT}';path.unlink(missing_ok=True);path.symlink_to(linkdir/f'.s.PGSQL.{PGPORT}')
            self.select_link(delay)

        def ping(self,delay,path):
            if path.name=='rtt-before.json':self.link(delay,path.parent)
            value=sp.check_output(['taskset','-c',APP_CORES,str(run.BIN),'ping-unix','--socket-dir',str(self.socket),'--count','1000'],env=self.env,text=True)
            value=json.loads(value);value['delay_us']=delay
            write(path,value)

        def start_service(self,pool,delay,directory):
            if self.args.system=='snapback':base.start_service(self,pool,delay,directory)
            else:base.start_service(self,pool,0,directory)

        def app_pids(self):
            return [x[0].pid for x in (self.service,self.dispatcher,self.proxy) if x and x[0].poll() is None]

        def before_trials(self,directory,*args):
            if self.args.system=='rawpg':base.before_trials(self,directory,*args)
            elif self.args.system=='snapback':base.before_trials(self,directory,*args)
            if not (self.out/'authorization.json').exists():write(self.out/'authorization.json',checks_module().authorization(self))
            roles=[('postgres',self.master[0].pid,PG_CORES)]+[('postgres-child',pid,PG_CORES) for pid,r in processes().items() if r['ppid']==self.master[0].pid]+[('app/proxy',p,APP_CORES) for p in self.app_pids()]
            witness=[]
            for role,pid,expected in roles:
                mask=set(int(c) for r in expected.split(',') for c in (range(int(r.split('-')[0]),int(r.split('-')[-1])+1)))
                for task in Path(f'/proc/{pid}/task').iterdir():
                    try:
                        actual=os.sched_getaffinity(int(task.name));assert actual==mask,(role,pid,actual,mask)
                        witness.append(dict(role=role,pid=pid,tid=int(task.name),cpus=sorted(actual)))
                    except ProcessLookupError:pass
            write(directory/'affinity.json',witness)

        def start_db_monitor(self,output):
            return sp.Popen([sys.executable,'-u',str(HERE/'scripts/db-monitor.py'),str(self.master[0].pid),str(self.out/'all-pids.jsonl')],stdin=sp.PIPE,stdout=output,stderr=sp.STDOUT)

        def trial(self,directory,workload,writers,keys,rows,rate,repeat):
            disk(self.out)
            return base.trial(self,directory,workload,writers,keys,rows,rate,repeat)

        def snapshot(self):
            if self.args.system!='snapback':return base.snapshot(self)
            counter=json.loads(self.sqlpg("SELECT jsonb_build_object('sum',coalesce(sum((data::jsonb->'Row'->'n'->>'Int')::bigint),0)) FROM bench.r WHERE t='counters'"))
            stats=json.loads(self.sqlpg("SELECT jsonb_build_object('database',(SELECT to_jsonb(d) FROM pg_stat_database d WHERE datname=current_database()),'statements',(SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]') FROM pg_stat_statements s WHERE dbid=(SELECT oid FROM pg_database WHERE datname=current_database()) AND userid=(SELECT oid FROM pg_roles WHERE rolname='s1pg2_app')))"))
            pid=self.service[0].pid
            io={k:int(v) for k,v in (line.split(':') for line in Path(f'/proc/{pid}/io').read_text().splitlines())}
            return dict(counters=counter,process_io=io,files_bytes={},time=time.time(),**stats)

        def host_check(self,label):
            while True:
                disk(self.out);a=processes();at=time.monotonic();time.sleep(1);b=processes();dt=time.monotonic()-at
                owned={os.getpid(),*(p.pid for p in self.started if p.poll() is None)}
                changed=True
                while changed:
                    extra={pid for pid,r in b.items() if r['ppid'] in owned}-owned
                    changed=bool(extra);owned|=extra
                busy=[];top=[]
                for pid,r in b.items():
                    if pid not in a or r['start_ticks']!=a[pid]['start_ticks']:continue
                    cores=(r['ticks']-a[pid]['ticks'])/os.sysconf('SC_CLK_TCK')/dt
                    if cores>.05:
                        row=dict(pid=pid,cores=cores,owned=pid in owned,comm=Path(f'/proc/{pid}/comm').read_text().strip() if Path(f'/proc/{pid}/comm').exists() else 'exited')
                        top.append(row)
                        if cores>1 and pid not in owned:busy.append(row)
                append(self.out/'host-checks.jsonl',dict(time=time.time(),label=label,loadavg=Path('/proc/loadavg').read_text().strip(),unrelated_over_one_core=busy,top=sorted(top,key=lambda x:-x['cores'])))
                if not busy:return
                print('Waiting: unrelated process exceeds one core before '+label,flush=True);time.sleep(10)

        def cell(self,*args):
            self.host_check(str(args))
            try:Run.cell(self,*args)
            finally:
                w,rows,delay,clients,keys=args
                path=self.out/f'{w.lower()}-n{rows}-d{delay}-c{clients}-{keys}'/'cell.json'
                if path.exists():
                    value=json.loads(path.read_text())
                    value['rerun']=['python3',str(HERE/'scripts/s1-onehost.py'),'--system',self.args.system,
                        '--mode','cell','--out',str(self.out.parent/('replay-'+path.parent.name+'-NEW')),
                        '--workload',w,'--keys',keys,'--link','A' if delay==500 else 'B',
                        '--warmup-ms',str(self.args.warmup_ms),'--duration-ms',str(self.args.duration_ms),
                        '--repeats',str(self.args.repeats),'--max-rate',str(self.args.max_rate),
                        '--harness',str(run.BIN),
                        '--extra-read-rates',*map(str,self.args.extra_read_rates)]
                    if self.args.system=='snapback':value['rerun']+=['--snapback-bin',self.args.snapback_bin,'--seed-bin',self.args.seed_bin]
                    if self.args.rates:value['rerun']+=['--rates',*map(str,self.args.rates)]
                    value['rate_policy']='double/halve, one geometric midpoint, plus registered extra read rungs; all repetitions must pass'
                    path.write_text(json.dumps(value,indent=2)+'\n')

        def close(self):
            errors=[]
            try:self.stop_service()
            except Exception as e:errors.append(type(e).__name__)
            # Every signalled Popen was recorded immediately at creation.
            for p,out,err in reversed(self.children):
                if self.master and p is self.master[0]:continue
                if p.poll() is None:p.terminate()
                try:p.wait(timeout=30)
                except sp.TimeoutExpired:p.kill();p.wait(timeout=10)
                out.close();err.close()
            if self.master:
                p,out,err=self.master
                if p.poll() is None:p.send_signal(signal.SIGINT)
                p.wait(timeout=60);out.close();err.close()
            for p in self.started:
                if p.poll() is None:
                    p.terminate()
                    try:p.wait(timeout=15)
                    except sp.TimeoutExpired:p.kill();p.wait(timeout=10)
            self.observe_stop.set();self.observer.join(timeout=5)
            if (self.out/'generator-affinity.jsonl').exists():
                for line in (self.out/'generator-affinity.jsonl').read_text().splitlines():
                    if any(t['cpus']!=[5,11] for t in json.loads(line)['tasks']):errors.append('generator-affinity')
            records=[json.loads(s) for s in (self.out/'all-pids.jsonl').read_text().splitlines()]
            alive=[r for r in records if r['pid']!=os.getpid() and live(r)]
            socket_absent=not (self.upstream/f'.s.PGSQL.{PGPORT}').exists()
            pidfile_absent=not (self.runtime/'pg/postmaster.pid').exists()
            if not socket_absent or not pidfile_absent:errors.append('postgres-shutdown-files')
            write(self.out/'cleanup.json',dict(still_running=alive,errors=errors,cluster_stopped=not self.master or self.master[0].poll() is not None,socket_absent=socket_absent,pidfile_absent=pidfile_absent,private_root=str(self.runtime),processes=[dict(pid=p.pid,status=p.poll()) for p in self.started]))
            sp.Popen=self.original_popen
            if alive or errors:raise RuntimeError('owned cleanup incomplete; retain state')
            data=self.runtime/'pg'
            if data.exists():
                shutil.copyfile(data/'postgresql.conf',self.out/'postgresql.conf')
                shutil.rmtree(data)
            # A disk guard must never prevent owned shutdown/data cleanup.
            disk(self.out)
            # Keep private material only until the separate known-secret audit.

    return OneHost


def checks_module():
    spec=importlib.util.spec_from_file_location('onehost_checks',HERE/'scripts/s1-onehost-checks.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--system',required=True,choices=['snapback','rawpg','supabase','convex'])
    p.add_argument('--store',choices=['postgres','sqlite'],default='postgres',help='SQLite is native Snapback only, with one natural/no-database-link column')
    p.add_argument('--sqlite-seed-release',help='restore a stopped, owned SQLite fixture with a read-only backup; verify all fixture images before load')
    p.add_argument('--out',required=True)
    p.add_argument('--mode',choices=['matrix','smoke','cell'],default='matrix')
    p.add_argument('--workload',choices=['W1','W2','W3','W4','W5'],default='W2')
    p.add_argument('--keys',choices=['disjoint','same','hot1'],default='disjoint')
    p.add_argument('--link',choices=['A','B'],default='A')
    p.add_argument('--harness',default=str(DEFAULT_BIN))
    p.add_argument('--snapback-bin',default=str(DEFAULT_BIN.parent/'snapback4'))
    p.add_argument('--seed-bin',default=str(DEFAULT_BIN.parent/'sb4-postgres-scale-seed'))
    p.add_argument('--max-rate',type=int,default=128000)
    p.add_argument('--rates',type=int,nargs='+')
    p.add_argument('--extra-read-rates',type=int,nargs='*',default=[19027,22627])
    p.add_argument('--warmup-ms',type=int,default=10000)
    p.add_argument('--duration-ms',type=int,default=20000)
    p.add_argument('--repeats',type=int,default=3)
    args=p.parse_args();args.rows=1000000;args.load_cores=LOAD_CORES
    if args.store=='sqlite' and args.link!='A':p.error('SQLite has only the natural column (--link A); there is no database link B')
    if args.sqlite_seed_release and args.store!='sqlite':p.error('--sqlite-seed-release requires --store sqlite')
    args.target='raw-pg' if args.system=='rawpg' else args.system
    if args.mode=='smoke':args.rates=[100];args.extra_read_rates=[]
    if args.store=='sqlite' and args.system!='snapback':p.error('SQLite requires --system snapback')
    base=configure(args);runner=make_runner(base)
    if args.store=='sqlite':
        import sqlite_onehost
        runner=sqlite_onehost.adapt(runner)
    r=runner(args)
    def interrupt(signum,frame):raise KeyboardInterrupt
    signal.signal(signal.SIGTERM,interrupt)
    try:
        r.start();r.fixture(args.rows)
        # Convex reads first; the same order is fixed for every control.
        matrix=[(w,500 if link=='A' else 1000,keys) for w,keys in [('W1','disjoint'),('W2','disjoint'),('W3','disjoint'),('W4','disjoint'),('W5','same'),('W5','hot1')] for link in ('A','B')]
        if args.mode in ('smoke','cell'):matrix=[(args.workload,500 if args.link=='A' else 1000,args.keys)]
        if args.store=='sqlite':matrix=[(w,0,k) for w,d,k in matrix if d==500]
        for w,d,k in matrix:r.cell(w,args.rows,d,128 if w in ('W1','W2','W3') else 32,k)
    finally:r.close()


if __name__=='__main__':main()
