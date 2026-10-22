#!/usr/bin/env python3
"""S1-PG2: unchanged Quarry on the unified PG store. Launch setsid nohup.

Own database/role only; all writes use the native engine, SQL is observational.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess as sp
import time
from urllib.parse import quote

import snapback
from run import HERE, BIN, PSQL, SSH, SSH_CORES, APP_CORES, LOAD_CORES, Run, write

ROOT = HERE/'target/p2'
DB = 'sb4_snapback_s1pg2'
ROLE = 's1pg2_app'
REMOTE = 'sb4scale/s1pg2-20261022'


class Postgres(snapback.Snapback):
    def __init__(self, args):
        global ROOT,REMOTE
        ROOT=HERE/'target'/args.run_name
        REMOTE='sb4scale/s1pg2-20261022-'+args.run_name
        args.runtime_name = 's1pg2-'+Path(args.out).name
        super().__init__(args)
        ROOT.mkdir(mode=0o700,exist_ok=bool(args.resume))
        self.socket = ROOT/'s'
        self.upstream = ROOT/'u'
        self.delayed = ROOT/'d'
        self.socket.mkdir(mode=0o700,exist_ok=bool(args.resume))
        self.upstream.mkdir(mode=0o700,exist_ok=bool(args.resume))
        if args.resume:
            prior=json.loads((Path(args.resume)/'ownership.json').read_text())
            self.release=Path(prior['release_path'])
            for p in (self.upstream/'.s.PGSQL.55440',self.delayed/'.s.PGSQL.55440'):
                p.unlink(missing_ok=True)
            self.delayed.rmdir()
        self.env.update(PGPASSWORD=(Path.home()/'sb4scale/pw').read_text().strip(),
            PGHOST=str(self.upstream), PGPORT='55440', PGUSER='sb4scale',
            PGAPPNAME='s1pg2_observer',
            LD_LIBRARY_PATH=str(Path.home()/'tools/pg16/usr/lib/x86_64-linux-gnu'),
            SCALE_DB_USER=ROLE, SCALE_DATABASE=DB, SCALE_PASSWORD_FILE=str(Path.home()/'sb4scale/pw'))
        self.created_db = self.created_role = False
        self.completed=False

    def sqlpg(self, sql, db=DB):
        return sp.check_output([str(PSQL),'-X','-qAt','-v','ON_ERROR_STOP=1','-d',db],
            input=sql, env=self.env, text=True)

    def cli(self,*args):
        if args[0]=='token' and 'drain' in args:
            # The PG profile deliberately excludes the SQLite token CLI. Two
            # native identity writes cross the same FIFO writer, outside load.
            status,value=snapback.http('/auth/session',dict(principal='barrier:drain',kind='member',days=7),self.barrier_token)
            if status!=200 or 'session' not in value:raise RuntimeError('native service-authorized drain barrier refused')
            return ''
        return super().cli(*args)

    def select_link(self, delay):
        path=self.socket/'.s.PGSQL.55440'
        path.unlink(missing_ok=True)
        path.symlink_to((self.upstream if delay==0 else self.delayed)/'.s.PGSQL.55440')

    def idle(self, label):
        while True:
            active=json.loads(self.sqlpg("""SELECT coalesce(jsonb_agg(jsonb_build_object(
                'pid',pid,'database',datname,'application',application_name,'state',state,
                'wait_type',wait_event_type,'wait',wait_event)),'[]') FROM pg_stat_activity
                WHERE backend_type='client backend' AND pid<>pg_backend_pid()
                AND datname<>'sb4_snapback_s1pg2'
                AND (state<>'idle' OR application_name NOT IN ('','s1pg2_observer'))""",'postgres'))
            with (self.out/'cluster-idle.jsonl').open('a') as f:
                f.write(json.dumps(dict(time=time.time(),before=label,other_activity=active))+'\n')
            if not active: return
            print('Waiting for other database activity before',label,len(active),flush=True)
            time.sleep(10)

    def command(self, command, name, cwd=None):
        p,out,err=self.spawn(command,self.out,name,cwd)
        code=p.wait();out.close();err.close()
        if code: raise RuntimeError(f'{name} exited {code}; see retained stderr')
        return Path(out.name).read_text()

    def start(self):
        self.command(['hostname'],'hostname')
        for cmd,name in [(['uname','-a'],'uname'),(['lscpu'],'lscpu'),
                         (['lsblk','-o','NAME,MODEL,ROTA,SIZE,MOUNTPOINTS'],'disks'),
                         (['df','-h',str(self.runtime)],'filesystem')]:
            (self.out/f'{name}.txt').write_text(sp.check_output(cmd,text=True))
        self.spawn(['taskset','-c',SSH_CORES,*SSH,'-o','ExitOnForwardFailure=yes','-N','-L',
            f'{self.upstream}/.s.PGSQL.55440:127.0.0.1:55440','expo-build-450a'],self.out,'tunnel')
        for _ in range(200):
            if (self.upstream/'.s.PGSQL.55440').exists(): break
            time.sleep(.1)
        assert self.sqlpg('SELECT 1','postgres').strip()=='1'
        self.idle('provision')
        password=self.env['PGPASSWORD']
        if not self.args.resume:
            assert self.sqlpg(f"SELECT count(*) FROM pg_database WHERE datname='{DB}'",'postgres').strip()=='0'
            assert self.sqlpg(f"SELECT count(*) FROM pg_roles WHERE rolname='{ROLE}'",'postgres').strip()=='0'
            self.sqlpg(f'CREATE ROLE {ROLE} LOGIN','postgres');self.created_role=True
            result=sp.run([str(PSQL),'-X','-v','ON_ERROR_STOP=1','-d','postgres','-c',f'\\password {ROLE}'],
                env=self.env,input=password+'\n'+password+'\n',capture_output=True,text=True)
            if result.returncode: raise RuntimeError('private role password setup failed')
            self.sqlpg(f'CREATE DATABASE {DB} OWNER {ROLE}','postgres');self.created_db=True
            self.sqlpg('CREATE EXTENSION pg_stat_statements')
        else:
            prior=json.loads((Path(self.args.resume)/'ownership.json').read_text())
            assert prior['database']==DB and prior['role']==ROLE
            self.created_db=self.created_role=True
        (self.out/'postgres.txt').write_text(self.sqlpg("SELECT version(); SELECT name,setting,unit FROM pg_settings WHERE name IN ('port','fsync','synchronous_commit','full_page_writes','shared_buffers','max_connections','shared_preload_libraries','wal_sync_method','jit','track_io_timing','track_wal_io_timing') ORDER BY name"))
        self.spawn(['taskset','-c',APP_CORES,BIN,'unix-proxy','--socket-dir',self.delayed,
            '--upstream-dir',self.upstream,'--delay-us','500'],self.out,'proxy')
        for _ in range(200):
            if (self.delayed/'.s.PGSQL.55440').exists():break
            time.sleep(.1)
        self.select_link(0)
        self.env['SNAPBACK4_STORE_URL']='postgres://'+ROLE+':'+quote(password,safe='')+'@/'+DB+'?host='+quote(str(self.socket),safe='')+'&port=55440&schema=bench&ha=none'
        write(self.out/'ownership.json',dict(pid=os.getpid(),pgid=os.getpgid(0),source_commit=sp.check_output(['git','rev-parse','HEAD'],text=True).strip(),
            source_sha256={str(p.relative_to(HERE)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [HERE/'scripts/postgres-2.py',HERE/'postgres-seed/src/main.rs',HERE/'snapback-app/snapback/schema.q']},
            snapback_binary_sha256=hashlib.sha256(snapback.SB.read_bytes()).hexdigest(),binary_sha256=hashlib.sha256(BIN.read_bytes()).hexdigest(),
            app_cores=APP_CORES,load_cores=LOAD_CORES,ssh_cores=SSH_CORES,product_source_unmodified=True,
            release_path=str(self.release),socket_path=str(self.socket),upstream_path=str(self.upstream),
            timing=dict(warmup_ms=10000,duration_ms=20000,repeats=3),database=DB,role=ROLE,
            cluster_postmaster_pid=2735539,transport='450b stable symlink -> SSH Unix socket, or +500us proxy -> SSH -> 450a:55440'))
        (self.out/'check.txt').write_text(self.cli('check','--cost'))
        if not self.args.resume:self.command([snapback.SB,'deploy',self.release,'--json'],'deploy',self.project)

    def fixture(self, rows):
        self.idle('seed')
        binding=json.loads((self.release/'store-binding.json').read_text())
        # The remote config is built remotely from its existing private password.
        seed=snapback.SB.parent/'sb4-postgres-scale-seed'
        if not self.args.resume:
            self.command([*SSH,'expo-build-450a',f'mkdir -m 700 ~/{REMOTE}'],'remote-directory')
            self.command(['scp','-q',str(seed),f'expo-build-450a:{REMOTE}/seed'],'copy-seed')
        code="""import json,os
from pathlib import Path
p=Path.home()/REMOTE_PATH
pw=(Path.home()/'sb4scale/pw').read_text().strip()
v=json.loads(input())
v['connection']='host=127.0.0.1 port=55440 user=s1pg2_app dbname=sb4_snapback_s1pg2 password='+pw
v['tokens_path']=str(p/'tokens.json')
os.umask(0o077)
(p/'config.json').write_text(json.dumps(v))
""".replace('REMOTE_PATH',repr(REMOTE))
        if not self.args.resume:
            p=sp.run([*SSH,'expo-build-450a','python3 -c '+__import__('shlex').quote(code)],
                input=json.dumps(dict(store_id=binding['store_id'],rows=rows))+'\n',text=True,capture_output=True)
            if p.returncode:raise RuntimeError('remote private config setup failed')
            launcher=f'cd ~/{REMOTE}; setsid nohup sh -c \'./seed config.json > seed.stdout 2> seed.stderr; echo $? > seed.exit\' > launcher.stdout 2>&1 < /dev/null & echo $! > seed.pid; cat seed.pid'
            remote_pid=int(self.command([*SSH,'expo-build-450a',launcher],'seed-launch').strip())
        else:remote_pid=json.loads((Path(self.args.resume)/'remote-seed.json').read_text())['pid']
        seed_hash=(json.loads((Path(self.args.resume)/'remote-seed.json').read_text())['binary_sha256'] if self.args.resume else hashlib.sha256(seed.read_bytes()).hexdigest())
        # Resume may use a newer operator helper for a separate service seat;
        # the original running seed's provenance stays bound to its own binary.
        actual=sp.check_output([*SSH,'expo-build-450a',f'sha256sum ~/{REMOTE}/seed'],text=True).split()[0]
        assert len(actual)==64
        write(self.out/'remote-seed.json',dict(host='expo-build-450a',pid=remote_pid,directory=REMOTE,
            command='setsid nohup seed config.json (password only in mode-600 remote config)',binary_sha256=actual))
        write(self.out/'seed-binary-provenance.json',dict(original_seed_binary_sha256=actual,
            inherited_receipt_sha256=seed_hash,current_operator_helper_sha256=hashlib.sha256(seed.read_bytes()).hexdigest()))
        while True:
            p=sp.run([*SSH,'expo-build-450a',f'cd ~/{REMOTE}; if test -f seed.exit; then cat seed.exit; else tail -1 seed.stdout; fi'],capture_output=True,text=True)
            if p.returncode:raise RuntimeError('remote seed polling failed')
            line=p.stdout.strip()
            if line.isdigit():
                self.command(['scp','-q',f'expo-build-450a:{REMOTE}/seed.stdout',str(self.out/'seed.stdout')],'copy-seed-log')
                self.command(['scp','-q',f'expo-build-450a:{REMOTE}/seed.stderr',str(self.out/'seed.stderr')],'copy-seed-error')
                if int(line):raise RuntimeError('native seed failed; retained remote seed.stderr')
                break
            print('Native PG seed:',line or 'starting',flush=True)
            time.sleep(15)
        self.command(['scp','-q',f'expo-build-450a:{REMOTE}/tokens.json',str(self.private)],'copy-sessions')
        self.private.chmod(0o600)
        self.tokens=json.loads(self.private.read_text())
        # Guest login is disabled in the unchanged fixture. Mint only the
        # operator's service seat through the same native owned setup engine;
        # native /auth/session then provides FIFO barriers without rotating any
        # measured member session or changing Quarry identity declarations.
        self.command(['scp','-q',str(seed),f'expo-build-450a:{REMOTE}/barrier-seed'],'copy-barrier-helper')
        setup="""import json,os
from pathlib import Path
p=Path.home()/REMOTE_PATH
v=json.loads((p/'config.json').read_text());v.update(drain_only=True,session_path=str(p/'barrier-token'))
os.umask(0o077);(p/'barrier-config.json').write_text(json.dumps(v))
""".replace('REMOTE_PATH',repr(REMOTE))
        result=sp.run([*SSH,'expo-build-450a','python3 -c '+__import__('shlex').quote(setup)],capture_output=True,text=True)
        if result.returncode:raise RuntimeError('private barrier config failed')
        launch=f'cd ~/{REMOTE}; rm -f barrier.exit; setsid nohup sh -c \'umask 077; ./barrier-seed barrier-config.json > barrier.stdout 2> barrier.stderr; echo $? > barrier.exit\' > barrier-launcher.stdout 2>&1 < /dev/null & echo $! > barrier.pid; cat barrier.pid'
        barrier_pid=int(self.command([*SSH,'expo-build-450a',launch],'barrier-launch').strip())
        write(self.out/'remote-barrier.json',dict(host='expo-build-450a',pid=barrier_pid,directory=REMOTE))
        while True:
            result=sp.run([*SSH,'expo-build-450a',f'cd ~/{REMOTE}; test ! -f barrier.exit || cat barrier.exit'],capture_output=True,text=True)
            if result.stdout.strip():
                if result.stdout.strip()!='0':raise RuntimeError('native barrier seat setup failed')
                break
            time.sleep(.2)
        private=self.runtime/'barrier-token'
        self.command(['scp','-q',f'expo-build-450a:{REMOTE}/barrier-token',str(private)],'copy-barrier-token')
        private.chmod(0o600);self.barrier_token=private.read_text().strip()
        write(self.out/'seed.json',json.loads((self.out/'seed.stdout').read_text().splitlines()[-1]))
        write(self.out/'seed-equality.json',self.verify_seed(rows))
        self.sqlpg('VACUUM (ANALYZE)')
        storage=json.loads(self.sqlpg("SELECT jsonb_build_object('database_bytes',pg_database_size(current_database()),'tables',(SELECT jsonb_agg(jsonb_build_object('name',relname,'rows',n_live_tup,'heap_bytes',pg_table_size(relid),'indexes_bytes',pg_indexes_size(relid))) FROM pg_stat_user_tables WHERE schemaname='bench'),'indexes',(SELECT jsonb_agg(jsonb_build_object('table',relname,'index',indexrelname,'bytes',pg_relation_size(indexrelid))) FROM pg_stat_user_indexes WHERE schemaname='bench'))"))
        write(self.out/'storage.json',storage)

    def verify_seed(self, rows):
        query="""WITH images AS (SELECT t,id,data::jsonb->'Row' AS r FROM bench.r),
        messages AS (SELECT * FROM images WHERE r ? 'body'),
        rooms AS (SELECT * FROM images WHERE t='rooms'),
        users AS (SELECT * FROM images WHERE t='users'),
        room_counts AS (SELECT r->'room'->>'Id' id,count(*) n FROM messages GROUP BY 1),
        user_counts AS (SELECT r->'sender'->>'Id' id,count(*) n FROM messages GROUP BY 1)
        SELECT jsonb_build_object('messages',(SELECT count(*) FROM messages),
        'rooms',(SELECT count(*) FROM rooms),'users',(SELECT count(*) FROM users),
        'memberships',(SELECT count(*) FROM images WHERE r ? 'last_read'),
        'counters',(SELECT count(*) FROM images WHERE r ? 'n'),
        'room_mismatches',(SELECT count(*) FROM rooms x LEFT JOIN room_counts c USING(id) WHERE coalesce((r->'total'->>'Int')::bigint,0)<>coalesce(c.n,0)),
        'sender_mismatches',(SELECT count(*) FROM users x LEFT JOIN user_counts c USING(id) WHERE coalesce((r->'sent'->>'Int')::bigint,0)<>coalesce(c.n,0)),
        'message_image_mismatches',(SELECT count(*) FROM messages WHERE id<>'m'||lpad(((r->'at'->>'Int')::bigint-1700000000000)::text,10,'0') OR r->'room'->>'Id'<>'r'||lpad((((r->'at'->>'Int')::bigint-1700000000001)%1024)::text,4,'0') OR r->'sender'->>'Id'<>'u'||lpad(((((r->'at'->>'Int')::bigint-1700000000001)%1024)/4)::text,4,'0') OR r->'body'->>'String'<>'message-'||((r->'at'->>'Int')::bigint-1700000000000)::text||' '||repeat('chat ',30)))"""
        value=json.loads(self.sqlpg(query))
        assert value['messages']==rows and value['rooms']==1025 and value['users']==256
        assert value['memberships']==8448 and value['counters']==257
        assert all(value[k]==0 for k in ('room_mismatches','sender_mismatches','message_image_mismatches')),value
        return value

    def start_service(self,pool,delay,directory):
        self.stop_service();self.select_link(delay)
        self.service=self.spawn(['taskset','-c',APP_CORES,snapback.SB,'serve',self.release,
            '--worker-state-dir',self.runtime/'workers','--port','58080'],directory,'serve')
        self.wait_ready()

    def ping(self,delay,path):
        self.select_link(delay)
        p,out,err=self.spawn(['taskset','-c',APP_CORES,BIN,'ping-unix','--socket-dir',self.socket],path.parent,path.stem)
        if p.wait():raise RuntimeError('RTT ping failed')
        out.close();err.close();write(path,json.loads(Path(out.name).read_text()))

    def snapshot(self):
        counter=json.loads(self.sqlpg("SELECT jsonb_build_object('sum',coalesce(sum((data::jsonb->'Row'->'n'->>'Int')::bigint),0)) FROM bench.r WHERE t='counters'"))
        # The extension is installed only in our database. Its observer SELECT
        # adds one known transaction; role-filtered statement counts exclude it.
        stats=json.loads(self.sqlpg("""SELECT jsonb_build_object('database',
            (SELECT to_jsonb(d) FROM pg_stat_database d WHERE datname='sb4_snapback_s1pg2'),
            'statements',(SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]') FROM pg_stat_statements s
                WHERE dbid=(SELECT oid FROM pg_database WHERE datname='sb4_snapback_s1pg2')
                AND userid=(SELECT oid FROM pg_roles WHERE rolname='s1pg2_app')))"""))
        pid=self.service[0].pid
        io={k:int(v) for k,v in (line.split(':') for line in Path(f'/proc/{pid}/io').read_text().splitlines())}
        return dict(counters=counter,process_io=io,files_bytes={},time=time.time(),**stats)

    def before_trials(self,directory,workload,writers,keys,rows):
        # Capture clean, known-operation deltas after warming this exact shape.
        token=self.tokens[0]
        path='/m/increment' if workload in ('W4','W5') else '/q/'+workload
        args={'counter':'c0256' if keys=='same' else 'c0000'} if workload in ('W4','W5') else {'message':'m0000000001'} if workload=='W1' else {'room':'r0000'} if workload=='W2' else {}
        for _ in range(10):
            status,value=snapback.http(path,{'args':args},token)
            assert status==200 and ('sent'==value.get('state') if path.startswith('/m') else value.get('complete'))
        before=self.snapshot();write(directory/'probe.before.json',before)
        latencies=[]
        operations=100 if keys=='hot1' else 60
        for i in range(operations):
            probe_args=dict(args,counter='c0256' if i%100==0 else 'c0000') if keys=='hot1' else args
            at=time.monotonic();status,value=snapback.http(path,{'args':probe_args},token)
            latencies.append((time.monotonic()-at)*1000)
            assert status==200 and ('sent'==value.get('state') if path.startswith('/m') else value.get('complete'))
        # Force PG's cumulative statistics report, without touching app traffic.
        # Active app backends normally flush at idle; wait beyond the 1s interval.
        time.sleep(1.2)
        after=self.snapshot();write(directory/'probe.after.json',after)
        write(directory/'probe.json',dict(operations=operations,warmup_operations=10,latencies_ms=latencies,
            background='standard ownership renewal retained in deltas',queue_wait_ms=None,
            queue_caveat='no product instrumentation; serial probes exclude request backlog'))

    def cell(self,*args):
        self.idle('cell-'+str(args))
        # Use the unchanged common search, scheduler, SLO and counter audit.
        Run.cell(self,*args)

    def close(self):
        self.stop_service()
        cleanup={}
        if self.created_db and self.completed:
            self.sqlpg(f'DROP DATABASE {DB}','postgres');cleanup['database_dropped']=True
        if self.created_role and self.completed:
            self.sqlpg(f'DROP ROLE {ROLE}','postgres');cleanup['role_dropped']=True
        if cleanup:write(self.out/'database-cleanup.json',cleanup)
        if not self.completed:write(self.out/'database-retained.json',dict(database=DB,role=ROLE,reason='retain owned fixture after harness/cell failure for diagnosis and resume'))
        super().close()


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--out',required=True)
    p.add_argument('--resume',help='owned setup evidence; preserve the running native seed')
    p.add_argument('--run-name',default='p2',help='new short owned socket/remote seed directory')
    p.add_argument('--start-workload',choices=['W1','W2','W3','W4','W5'],default='W1')
    p.add_argument('--start-delay-us',type=int,choices=[0,500],default=0)
    p.add_argument('--start-keys',choices=['disjoint','same','hot1'],default='disjoint')
    p.add_argument('--max-rate',type=int,default=128000)
    p.add_argument('--rates',type=int,nargs='+')
    p.add_argument('--warmup-ms',type=int,default=10000)
    p.add_argument('--duration-ms',type=int,default=20000)
    p.add_argument('--repeats',type=int,default=3)
    args=p.parse_args();args.load_cores=LOAD_CORES
    r=Postgres(args)
    try:
        r.start();r.fixture(1000000)
        matrix=[]
        for delay in (0,500):
            matrix += [(w,1000000,delay,128,'disjoint') for w in ('W1','W2','W3')]
            matrix += [(w,1000000,delay,32,k) for w,k in [('W4','disjoint'),('W5','same'),('W5','hot1')]]
        start=next(i for i,c in enumerate(matrix) if (c[0],c[2],c[4])==(args.start_workload,args.start_delay_us,args.start_keys))
        for cell in matrix[start:]:r.cell(*cell)
        write(r.out/'final-equality.json',r.verify_seed(1000000))
        r.completed=True
    finally:r.close()


if __name__=='__main__':main()
