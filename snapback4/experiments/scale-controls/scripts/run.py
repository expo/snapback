#!/usr/bin/env python3
"""Reproduce a raw-PG cell; manages only local recorded PIDs and its databases.
The cluster is separately provisioned by cluster.sh and is never stopped here.
"""
import argparse
import hashlib
import json
import os
import resource
from pathlib import Path
import socket
import stat
import subprocess as sp
import time
import urllib.request

HERE = Path(__file__).resolve().parent.parent
BIN = HERE / 'target/release/sb4-scale-controls'
PSQL = Path.home() / 'tools/pg16/usr/lib/postgresql/16/bin/psql'
SSH = ['ssh','-o','BatchMode=yes','-o','ControlMaster=no','-o','ControlPath=none','-o','Compression=no']
APP_CORES = '0-2,6-8'  # three physical cores, including both SMT siblings
LOAD_CORES = '3-5,9-11' # three physical cores outside the app; shares two with SSH
SSH_CORES = '4-5,10-11'


def write(path, value):
    with path.open('x') as f:
        json.dump(value,f,indent=2)
        f.write('\n')


def proc(pid):
    try:
        text=Path(f'/proc/{pid}/stat').read_text().rsplit(')',1)[1].split()
        return {'ticks':int(text[11])+int(text[12]),'rss_pages':int(text[21]),'threads':int(text[17])}
    except (OSError,IndexError):
        return None


def cpu_sample(pids):
    return {'time':time.time(),'processes':{str(p):proc(p) for p in pids},
            'host_cpu':Path('/proc/stat').read_text().splitlines()[0],
            'loadavg':Path('/proc/loadavg').read_text().strip()}


STATS = """SELECT jsonb_build_object(
'wall_time',extract(epoch from clock_timestamp()),
'wal_lsn',pg_wal_lsn_diff(pg_current_wal_lsn(),'0/0'),
'wal',(SELECT to_jsonb(w) FROM pg_stat_wal w),
'io',(SELECT jsonb_agg(to_jsonb(i)) FROM pg_stat_io i),
'database',(SELECT to_jsonb(d) FROM pg_stat_database d WHERE datname=current_database()),
'statements',(SELECT coalesce(jsonb_agg(jsonb_build_object('queryid',s.queryid::text,'query',s.query,'calls',s.calls,'rows',s.rows,'total_exec_time',s.total_exec_time,'shared_blks_hit',s.shared_blks_hit,'shared_blks_read',s.shared_blks_read,'shared_blks_dirtied',s.shared_blks_dirtied,'wal_bytes',s.wal_bytes,'wal_records',s.wal_records,'wal_fpi',s.wal_fpi)),'[]') FROM pg_stat_statements s WHERE dbid=(SELECT oid FROM pg_database WHERE datname=current_database()) AND userid=(SELECT oid FROM pg_roles WHERE rolname='scale_app')),
'counters',(SELECT jsonb_build_object('sum',sum(n),'hot',max(n) FILTER (WHERE id=256)) FROM counters))"""
WAITS = """SELECT jsonb_build_object('time',extract(epoch from clock_timestamp()),'states',coalesce(jsonb_agg(to_jsonb(s)),'[]')) FROM
(SELECT state,wait_event_type,wait_event,count(*) n FROM pg_stat_activity
WHERE datname=current_database() AND application_name='sb4scale_raw'
GROUP BY state,wait_event_type,wait_event) s;"""


class Run:
    db_prefix='sb4scale_raw'
    db_schema='public'
    schema_file=HERE/'schema.sql'
    app_name='sb4scale_raw'
    statement_roles=['scale_app']
    def __init__(self,args):
        self.args=args
        soft,hard=resource.getrlimit(resource.RLIMIT_NOFILE)
        if soft<8192:
            if hard<8192: raise RuntimeError('256 proxy connections require a nofile hard limit of at least 8192')
            resource.setrlimit(resource.RLIMIT_NOFILE,(8192,hard))
        self.out=Path(args.out).resolve()
        self.out.mkdir(parents=True,exist_ok=False)
        self.tunnels=[]
        self.service=None
        self.pw=Path.home()/'sb4scale/pw'
        assert stat.S_IMODE(self.pw.stat().st_mode)==0o600
        self.base=args.tunnel_base
        self.env=dict(os.environ,PGPASSWORD=self.pw.read_text().strip(),PGUSER='sb4scale',PGHOST='127.0.0.1',PGPORT=str(self.base),PGDATABASE='postgres',PGAPPNAME='sb4scale_observer',LD_LIBRARY_PATH=str(Path.home()/'tools/pg16/usr/lib/x86_64-linux-gnu'))
        self.env['SCALE_PASSWORD_FILE']=str(self.pw)
        self.db=None

    def psql(self,sql=None,path=None,database=None):
        cmd=[str(PSQL),'-X','-qAt','-v','ON_ERROR_STOP=1','-d',database or self.db or 'postgres']
        if sql is not None: cmd+=['-c',sql]
        if path is not None: cmd+=['-f',str(path)]
        return sp.check_output(cmd,env=self.env,text=True)

    def start(self,count):
        source=[HERE/'Cargo.toml',HERE/'Cargo.lock',*sorted(HERE.glob('*.sql')),*sorted(HERE.glob('*.conf')),HERE/'postgresql.conf.delta',*sorted((HERE/'src').glob('*.rs')),*sorted((HERE/'scripts').glob('*.py')),*sorted((HERE/'scripts').glob('*.sh')),HERE.parent/'postgres-commit-path/src/proxy.rs']
        write(self.out/'ownership.json',{'source_commit':sp.check_output(['git','rev-parse','HEAD'],text=True).strip(),
              'binary_sha256':hashlib.sha256(BIN.read_bytes()).hexdigest(),
              'source_sha256':{str(p.relative_to(HERE.parent)):hashlib.sha256(p.read_bytes()).hexdigest() for p in source},
              'command':['python3','scripts/run.py',*os.sys.argv[1:]],'pid':os.getpid(),
              'nofile_limit':resource.getrlimit(resource.RLIMIT_NOFILE),'app_cores':APP_CORES,'load_cores':getattr(self.args,'load_cores',LOAD_CORES),'ssh_cores':SSH_CORES,'start_utc':time.strftime('%FT%TZ',time.gmtime())})
        for i in range(count):
            port=self.base+i
            log=(self.out/f'tunnel-{port}.stderr').open('x')
            process=sp.Popen(['taskset','-c',SSH_CORES,*SSH,'-o','ExitOnForwardFailure=yes','-N','-L',f'127.0.0.1:{port}:127.0.0.1:55440','expo-build-450a'],stdin=sp.DEVNULL,stdout=sp.DEVNULL,stderr=log)
            self.tunnels.append((process,log))
            with (self.out/'pids.jsonl').open('a') as f: f.write(json.dumps({'pid':process.pid,'kind':'ssh','port':port,'time':time.time()})+'\n')
            deadline=time.monotonic()+20
            while True:
                if process.poll() is not None: raise RuntimeError(f'tunnel {port} failed')
                try:
                    with socket.create_connection(('127.0.0.1',port),timeout=.1): break
                except OSError:
                    if time.monotonic()>deadline: raise RuntimeError(f'tunnel {port} readiness timeout')
                    time.sleep(.02)
        self.env['SCALE_TUNNEL_PORTS']=','.join(str(self.base+i) for i in range(count))
        self.psql("SELECT 1")
        self.setup_roles()
        # Store only non-secret configuration. No role catalogs/password verifiers.
        (self.out/'postgres.txt').write_text(self.psql("SELECT version(); SELECT name,setting,unit FROM pg_settings WHERE name IN ('port','fsync','synchronous_commit','full_page_writes','shared_buffers','max_connections','shared_preload_libraries','wal_sync_method','max_wal_size','jit','track_io_timing','track_wal_io_timing') ORDER BY name"))
        (self.out/'host-450b.txt').write_text(sp.check_output(['bash','-c','hostname; uname -a; lscpu; free -m; df -h .; uptime'],text=True))

    def setup_roles(self):
        if self.psql("SELECT count(*) FROM pg_roles WHERE rolname='scale_app'").strip()=='0':
            self.psql('CREATE ROLE scale_app LOGIN')
            # psql encrypts the password; stdin and the captured prompts are never logged.
            secret=self.pw.read_text().strip()
            result=sp.run([str(PSQL),'-X','-v','ON_ERROR_STOP=1','-d','postgres','-c','\\password scale_app'],env=self.env,input=secret+'\n'+secret+'\n',capture_output=True,text=True)
            if result.returncode: raise RuntimeError('could not set scale_app password')

    def fixture(self,rows):
        self.db=f'{self.db_prefix}_{rows}'
        self.env['SCALE_DATABASE']=self.db
        exists=self.psql(f"SELECT count(*) FROM pg_database WHERE datname='{self.db}'",database='postgres').strip()=='1'
        if not exists:
            self.psql(f'CREATE DATABASE {self.db}',database='postgres')
            try:
                self.psql('REVOKE CREATE ON SCHEMA public FROM PUBLIC; CREATE EXTENSION pg_stat_statements WITH SCHEMA public')
                self.psql(path=self.schema_file)
                result=sp.check_output([str(PSQL),'-X','-v','ON_ERROR_STOP=1','-d',self.db,'-v',f'rows={rows}','-f',str(HERE/'seed.sql')],env=self.env,text=True)
                (self.out/f'seed-{rows}.txt').write_text(result)
            except Exception:
                self.psql(f'DROP DATABASE {self.db}',database='postgres')
                raise
        count=int(self.psql('SELECT count(*) FROM messages').strip())
        if count!=rows: raise RuntimeError(f'fixture has {count} messages, expected {rows}')
        storage=self.psql("SELECT jsonb_build_object('tables',(SELECT jsonb_agg(jsonb_build_object('name',relname,'rows',n_live_tup,'heap_bytes',pg_table_size(relid),'indexes_bytes',pg_indexes_size(relid))) FROM pg_stat_user_tables),'indexes',(SELECT jsonb_agg(jsonb_build_object('table',s.relname,'index',s.indexrelname,'entries',c.reltuples,'bytes',pg_relation_size(s.indexrelid))) FROM pg_stat_user_indexes s JOIN pg_class c ON c.oid=s.indexrelid))")
        write(self.out/f'storage-{rows}.json',json.loads(storage))

    def start_service(self,pool,delay,directory):
        self.stop_service()
        log=(directory/'service.stdout').open('x'); err=(directory/'service.stderr').open('x')
        p=sp.Popen(['taskset','-c',APP_CORES,str(BIN),'serve','--pool',str(pool),'--delay-us',str(delay)],env=self.env,stdout=log,stderr=err)
        self.service=(p,log,err)
        with (self.out/'pids.jsonl').open('a') as f: f.write(json.dumps({'pid':p.pid,'kind':'app','pool':pool,'delay_us':delay,'time':time.time()})+'\n')
        deadline=time.monotonic()+120
        while True:
            if time.monotonic()>deadline: raise RuntimeError('service readiness timeout')
            if p.poll() is not None: raise RuntimeError('service startup failed; see service.stderr')
            try:
                # An existing listener must not masquerade as this process.
                ready=directory/'service.stdout'
                text=ready.read_text()
                if not text.endswith('\n'):
                    time.sleep(.1); continue
                announcement=json.loads(text.splitlines()[0])
                if announcement.get('pid')!=p.pid or not announcement.get('ready'):
                    raise RuntimeError('service readiness identity mismatch')
                with urllib.request.urlopen('http://127.0.0.1:58080/health',timeout=.2) as response:
                    if response.status==200: break
            except OSError:
                if time.monotonic()>deadline: raise RuntimeError('service readiness timeout')
                time.sleep(.1)

    def stop_service(self):
        if self.service:
            p,log,err=self.service
            if p.poll() is None: p.terminate()
            p.wait(timeout=15)
            log.close(); err.close()
            self.service=None

    def ping(self,delay,path):
        value=sp.check_output(['taskset','-c',APP_CORES,str(BIN),'ping','--delay-us',str(delay),'--count','1000'],env=self.env,text=True)
        write(path,json.loads(value))

    def trial(self,directory,workload,writers,keys,rows,rate,repeat):
        prefix=f'rate-{rate}-r{repeat}'
        stats=STATS.replace("userid=(SELECT oid FROM pg_roles WHERE rolname='scale_app')", "userid IN (SELECT oid FROM pg_roles WHERE rolname IN ("+','.join("'"+r+"'" for r in self.statement_roles)+"))")
        waits=WAITS.replace("sb4scale_raw",self.app_name)
        before=json.loads(self.psql(stats))
        write(directory/f'{prefix}.before.json',before)
        wait_sql=directory/f'{prefix}.wait.sql'
        wait_sql.write_text(waits+'\n\\watch 0.1\n')
        wf=(directory/f'{prefix}.waits.txt').open('x')
        monitor=sp.Popen([str(PSQL),'-X','-qAt','-v','ON_ERROR_STOP=1','-d',self.db,'-f',str(wait_sql)],env=self.env,stdin=sp.DEVNULL,stdout=wf,stderr=sp.STDOUT)
        db_cpu=(directory/f'{prefix}.db-cpu.jsonl').open('x')
        db_monitor=sp.Popen(SSH+['expo-build-450a','python3 -u ~/sb4scale/db-monitor.py'],stdin=sp.PIPE,stdout=db_cpu,stderr=sp.STDOUT)
        stdout=(directory/f'{prefix}.stdout').open('x'); stderr=(directory/f'{prefix}.stderr').open('x')
        command=['taskset','-c',getattr(self.args,'load_cores',LOAD_CORES),str(BIN),'load','--workload',workload,'--workers',str(writers),'--keys',keys,'--rows',str(rows),'--rate',str(rate),'--warmup-ms',str(self.args.warmup_ms),'--duration-ms',str(self.args.duration_ms)]
        if getattr(self.args,'target','raw-pg')!='raw-pg': command+=['--target',self.args.target]
        start=time.time()
        p=sp.Popen(command,env=self.env,stdout=stdout,stderr=stderr)
        with (self.out/'pids.jsonl').open('a') as f:
            for owned,kind in [(p,'load'),(monitor,'wait-observer'),(db_monitor,'db-cpu-ssh-observer')]: f.write(json.dumps({'pid':owned.pid,'kind':kind,'time':start})+'\n')
        samples=[]
        try:
            while p.poll() is None:
                samples.append(cpu_sample([*self.app_pids(),p.pid,*[t.pid for t,_ in self.tunnels]]))
                time.sleep(.25)
            if p.returncode: raise RuntimeError(f'load exited {p.returncode}: {directory/prefix}')
        finally:
            if p.poll() is None: p.terminate(); p.wait(timeout=10)
            db_monitor.communicate(input=b'\n',timeout=15); db_cpu.close()
            monitor.terminate(); monitor.wait(timeout=10); wf.close(); stdout.close(); stderr.close()
        if monitor.returncode not in (-15,0): raise RuntimeError('wait monitor failed')
        if db_monitor.returncode: raise RuntimeError('DB CPU monitor failed')
        # HTTP timeouts can leave an already admitted SQL write running. Drain
        # observed app statements before taking the counter/statistics snapshot.
        deadline=time.monotonic()+10
        while self.psql(f"SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name='{self.app_name}' AND state<>'idle'").strip()!='0':
            if time.monotonic()>deadline: raise RuntimeError('database work did not drain')
            time.sleep(.1)
        after=json.loads(self.psql(stats))
        write(directory/f'{prefix}.after.json',after)
        write(directory/f'{prefix}.resources.json',{'start':start,'end':time.time(),'clock_ticks':os.sysconf('SC_CLK_TCK'),'samples':samples})
        result=json.loads((directory/f'{prefix}.stdout').read_text())
        if workload in ('W4','W5'):
            # No other writer is allowed in this serial campaign.
            delta=after['counters']['sum']-before['counters']['sum']
            result['counter_check']={'delta':delta,'acknowledged_including_warmup':result['total_success_including_warmup'],'ok':delta==result['total_success_including_warmup']}
            if not result['counter_check']['ok']:
                result['slo_pass']=False
                # Unknown outcomes at overload are retained, never counted as
                # acknowledged throughput. Error-free mismatches are defects.
                if result['error_count']==0 or delta<result['total_success_including_warmup']:
                    raise RuntimeError('counter mismatch without timed-out writes')
        result['command']=command
        write(directory/f'{prefix}.json',result)
        print(f'{directory.name} rate={rate} r={repeat} ok={result["slo_pass"]} achieved={result["achieved_per_s"]:.0f} p99={result["latency"]["p99_ms"]:.2f} errors={result["error_count"]}',flush=True)
        return result

    def app_pids(self):
        return [self.service[0].pid]

    def cell(self,workload,rows,delay,writers,keys):
        name=f'{workload.lower()}-n{rows}-d{delay}-c{writers}-{keys}'
        directory=self.out/name
        directory.mkdir()
        args=['--workload',workload,'--rows',str(rows),'--delay-us',str(delay),'--writers',str(writers),'--keys',keys]
        write(directory/'cell.json',{'workload':workload,'rows':rows,'delay_us':delay,'writers':writers,'keys':keys,
              'target':getattr(self.args,'target','raw-pg'),
              'rerun':['python3','scripts/run.py','cell','--out',f'results-NEW-{name}',*args,'--target',getattr(self.args,'target','raw-pg'),'--load-cores',getattr(self.args,'load_cores',LOAD_CORES),'--warmup-ms',str(self.args.warmup_ms),'--duration-ms',str(self.args.duration_ms),'--repeats',str(self.args.repeats)],
              'rate_policy':'double/halve to bracket, one geometric midpoint; all repetitions must meet SLO'})
        (directory/'vmstat-before.txt').write_text(sp.check_output(['vmstat','1','2'],text=True))
        self.ping(delay,directory/'rtt-before.json')
        pool=32 if workload in ('W1','W2','W3') else writers
        self.start_service(pool,delay,directory)
        trials={}
        def at(rate):
            rate=max(1,int(rate))
            if rate not in trials:
                trials[rate]=[self.trial(directory,workload,writers,keys,rows,rate,r) for r in range(self.args.repeats)]
            return all(r['slo_pass'] for r in trials[rate])
        if self.args.rates:
            for rate in self.args.rates: at(rate)
        else:
            rate=1000 if workload in ('W1','W2','W3') else (100 if keys=='same' else writers*100)
            if at(rate):
                low=rate; high=rate*2
                while high<=self.args.max_rate and at(high): low,high=high,high*2
                if high<=self.args.max_rate: at(int((low*high)**.5))
            else:
                high=rate; low=max(1,rate//2)
                while low>1 and not at(low): high,low=low,max(1,low//2)
                if at(low): at(int((low*high)**.5))
        self.stop_service()
        self.ping(delay,directory/'rtt-after.json')
        (directory/'vmstat-after.txt').write_text(sp.check_output(['vmstat','1','2'],text=True))
        passed=[r for r,runs in trials.items() if all(t['slo_pass'] for t in runs)]
        failed=[r for r,runs in trials.items() if not all(t['slo_pass'] for t in runs)]
        write(directory/'summary.json',{'highest_passing_offered_per_s':max(passed,default=None),'lowest_failing_offered_per_s':min(failed,default=None),
              'bracketed':bool(passed and failed),'rates':sorted(trials),'repeats':self.args.repeats})

    def close(self):
        self.stop_service()
        stopped=[]
        for p,f in self.tunnels:
            if p.poll() is None: p.terminate()
            p.wait(timeout=15); f.close()
            stopped.append({'pid':p.pid,'exit_status':p.returncode})
        write(self.out/'cleanup.json',{'tunnels':stopped,'cluster_left_running':True,'fixture_databases_retained':True})


def cells(args):
    if args.mode=='cell':
        yield args.workload,args.rows,args.delay_us,args.writers,args.keys
        return
    if args.mode=='smoke':
        for w in ['W1','W2','W3','W4','W5']:
            yield w,100000,0,4,'same' if w=='W5' else 'disjoint'
        return
    if args.mode in ('reads','all'):
        for rows in [100000,1000000]:
            for delay in [0,200,500,1000]:
                for w in ['W1','W2','W3']: yield w,rows,delay,128,'disjoint'
    if args.mode in ('writes','all'):
        for delay in [0,200,500,1000]:
            for writers in [1,2,4,8,16,32,64,128,256]:
                for w,keys in [('W4','disjoint'),('W5','same'),('W5','hot1')]: yield w,1000000,delay,writers,keys


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('mode',choices=['smoke','reads','writes','all','cell'])
    p.add_argument('--out',required=True)
    p.add_argument('--target',choices=['raw-pg','supabase'],default='raw-pg')
    p.add_argument('--tunnel-base',type=int,default=63000)
    p.add_argument('--load-cores',default=LOAD_CORES)
    p.add_argument('--warmup-ms',type=int,default=1000)
    p.add_argument('--duration-ms',type=int,default=3000)
    p.add_argument('--repeats',type=int,default=3)
    p.add_argument('--max-rate',type=int,default=128000)
    p.add_argument('--rates',type=int,nargs='+')
    p.add_argument('--workload',choices=['W1','W2','W3','W4','W5'])
    p.add_argument('--rows',type=int,default=100000)
    p.add_argument('--delay-us',type=int,choices=[0,200,500,1000],default=0)
    p.add_argument('--writers',type=int,default=128)
    p.add_argument('--keys',choices=['disjoint','same','hot1'],default='disjoint')
    args=p.parse_args()
    assert args.repeats>0 and args.duration_ms>0 and args.warmup_ms>=0
    matrix=list(cells(args))
    if args.target=='supabase':
        from supabase import SupabaseRun
        run=SupabaseRun(args)
    else: run=Run(args)
    try:
        run.start(33 if args.target=='supabase' else (max(33,max(c[3] for c in matrix if c[0] in ('W4','W5'))+1) if any(c[0] in ('W4','W5') for c in matrix) else 33))
        for rows in dict.fromkeys(c[1] for c in matrix): run.fixture(rows)
        for w,rows,delay,writers,keys in matrix:
            run.db=f'{run.db_prefix}_{rows}'; run.env['SCALE_DATABASE']=run.db
            run.cell(w,rows,delay,writers,keys)
    finally:
        run.close()


if __name__=='__main__': main()
