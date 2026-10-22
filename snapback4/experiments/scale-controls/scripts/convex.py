"""Native Convex/PG lifecycle using the unchanged S1-H cell and arrival policies."""
import argparse, base64, hashlib, json, os, secrets, shutil, socket, stat
import subprocess as sp
import time, urllib.request
from pathlib import Path
import run
from run import Run, HERE, BIN, APP_CORES, write

ROOT=Path.home()/'sb4scale/s1cx'
BACKEND=Path.home()/'sb4scale/bin/convex-72ce13c/convex-local-backend'
APP=HERE/'convex-app'
# Observe only this owned database. Convex's pool does not set application_name.
run.STATS=run.STATS.replace(" AND userid=(SELECT oid FROM pg_roles WHERE rolname='scale_app')", "")
run.STATS=run.STATS.replace("(SELECT jsonb_build_object('sum',sum(n),'hot',max(n) FILTER (WHERE id=256)) FROM counters)", "NULL")
run.WAITS=run.WAITS.replace(" AND application_name='sb4scale_raw'", " AND application_name<>'sb4scale_observer'")


def private(path, text):
    if not path.exists():
        fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
        with os.fdopen(fd,'w') as f:f.write(text)
    assert stat.S_IMODE(path.stat().st_mode)==0o600


def native_inflight(text):
    names=['convex_local_backend_backend_http_service_concurrent_requests',
           'convex_local_backend_committer_concurrent_commits']
    values={line.split(' ',1)[0]:float(line.rsplit(' ',1)[1]) for line in text.splitlines() if line.split(' ',1)[0] in names}
    if any(name not in values for name in names):raise RuntimeError('native drain metric missing')
    return {name:values[name] for name in names}


class ConvexRun(Run):
    db_prefix='sb4scale_convex'
    app_name='sb4scale_convex'
    statement_roles=['sb4scale']
    def __init__(self,args):
        super().__init__(args)
        ROOT.mkdir(parents=True,exist_ok=True)
        self.dispatcher=None
        self.pool=None
        self.admin=None
        self.env['PATH']=str(Path.home()/'.local/bin')+':'+self.env['PATH']
        self.env['CONVEX_SELF_HOSTED_URL']='http://127.0.0.1:58080'
        self.env['CONVEX_DISABLE_TELEMETRY']='1'
        self.env['DO_NOT_TRACK']='1'
        original=sp.Popen; self.started=[]
        started=self.started; ledger=self.out/'all-pids.jsonl'
        class RecordedPopen(original):
            def __init__(child,*a,**kw):
                super().__init__(*a,**kw);started.append(child)
                with ledger.open('a') as f:f.write(json.dumps(dict(pid=child.pid,ppid=os.getpid(),time=time.time(),executable=str(child.args[0])))+'\n')
        sp.Popen=RecordedPopen
        self.credentials()

    def credentials(self):
        key=ROOT/'issuer-private.pem'
        if not key.exists():
            s="const c=require('node:crypto'); const k=c.generateKeyPairSync('rsa',{modulusLength:2048}); process.stdout.write(k.privateKey.export({type:'pkcs8',format:'pem'}));"
            private(key,sp.check_output(['node','-e',s],env=self.env,text=True))
        s="""const c=require('node:crypto'),f=require('node:fs');
const k=c.createPrivateKey(f.readFileSync(process.argv[1]));
const jwk=c.createPublicKey(k).export({format:'jwk'});jwk.kid='s1cx';jwk.alg='RS256';jwk.use='sig';
const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const ts=Array.from({length:256},(_,p)=>{const t=enc({alg:'RS256',kid:'s1cx',typ:'JWT'})+'.'+enc({iss:'https://s1cx.invalid',aud:'s1cx',sub:String(p),iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+86400});return t+'.'+c.sign('RSA-SHA256',Buffer.from(t),k).toString('base64url')});
process.stdout.write(JSON.stringify({jwks:'data:text/plain;charset=utf-8;base64,'+Buffer.from(JSON.stringify({keys:[jwk]})).toString('base64'),tokens:ts}));"""
        values=json.loads(sp.check_output(['node','-e',s,str(key)],env=self.env,text=True))
        self.jwks=values['jwks']; tokens=ROOT/'tokens.json'
        private(tokens,json.dumps(values['tokens']));tokens.write_text(json.dumps(values['tokens']))
        self.env['SCALE_JWT_TOKENS_FILE']=str(tokens)
        self.env['S1CX_JWKS']=self.jwks

    def setup_roles(self): pass # Existing cluster owner; no shared role mutations.

    def start(self,count):
        super().start(count)
        used=int(self.psql('SELECT count(*) FROM pg_stat_activity',database='postgres').strip())
        limit=int(self.psql('SHOW max_connections',database='postgres').strip())
        if used+count-1>limit-8: raise RuntimeError('insufficient cluster connection headroom')
        write(self.out/'connection-budget.json',dict(pool_max=count-1,used=used,max_connections=limit,headroom=limit-used-count+1))
        write(self.out/'binary.json',json.loads((ROOT/'binary.json').read_text()))
        path=self.out/'ownership.json';o=json.loads(path.read_text())
        o['convex_app_sha256']={str(p.relative_to(APP)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [APP/'package.json',APP/'bun.lock',*sorted((APP/'convex').glob('*.ts'))]}
        path.write_text(json.dumps(o,indent=2)+'\n')

    def cli(self,*args,log=None):
        result=sp.run(['npx','--no-install','convex',*args],cwd=APP,env=self.env,capture_output=True,text=True)
        # No CLI arguments contain a private value; env and admin key are never logged.
        text=result.stdout+result.stderr
        for secret in [self.pw.read_text().strip(),self.admin or 'UNUSED_SECRET']:
            text=text.replace(secret,'[REDACTED]')
        if log: log.write_text(text)
        if result.returncode: raise RuntimeError('Convex CLI failed: '+text[-2000:])
        return text

    def call(self,path,args=None,kind='query',token=None,admin=False):
        headers={'Content-Type':'application/json'}
        if admin:headers['Authorization']='Convex '+self.admin
        elif token:headers['Authorization']='Bearer '+token
        req=urllib.request.Request('http://127.0.0.1:58080/api/'+kind,json.dumps(dict(path=path,args=args or {},format='json')).encode(),headers)
        with urllib.request.urlopen(req,timeout=120) as r:value=json.load(r)
        if value['status']!='success': raise RuntimeError('Function failed: '+str(value.get('errorMessage')))
        return value['value']

    def psql(self,sql=None,path=None,database=None):
        if sql and sql.startswith('SELECT count(*) FROM pg_stat_activity WHERE datname='):
            sql="SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid() AND application_name<>'sb4scale_observer' AND state='active'"
        # Durable counters live in Convex's generic document representation.
        if sql and sql.startswith('SELECT jsonb_build_object(\n'):
            result=json.loads(super().psql(sql,path,database))
            result['counters']=self.call('chat:witness',admin=True)
            return json.dumps(result)
        return super().psql(sql,path,database)

    def start_service(self,pool,delay,directory):
        self.stop_service(); self.pool=pool
        instance=self.db.replace('_','-')
        secret=ROOT/(instance+'.secret');private(secret,secrets.token_hex(32))
        admin=ROOT/(instance+'.admin')
        if not admin.exists():
            private(admin,sp.check_output([str(BACKEND),'keygen','admin-key','--instance-name',instance,'--instance-secret',secret.read_text()],text=True).strip())
        self.admin=admin.read_text();self.env['CONVEX_SELF_HOSTED_ADMIN_KEY']=self.admin
        # Exact same independent-SSH dispatcher and S0 delay proxy as Supabase.
        log=(directory/'dispatcher.stdout').open('x');err=(directory/'dispatcher.stderr').open('x')
        p=sp.Popen(['taskset','-c',APP_CORES,str(BIN),'dispatch','--delay-us',str(delay)],env=self.env,stdout=log,stderr=err)
        self.dispatcher=(p,log,err)
        self.record(p,'app')
        self.ready_tcp(p,58081)
        env=dict(self.env,POSTGRES_MAX_CONNECTIONS=str(pool),APPLICATION_MAX_CONCURRENT_QUERIES=str(pool),APPLICATION_MAX_CONCURRENT_MUTATIONS=str(pool),
                 DOCUMENT_RETENTION_DELAY='172800',RUST_LOG='info',DISABLE_BEACON='true',DISABLE_METRICS_ENDPOINT='false')
        # The native driver requires credentials in its URL; never record argv or env.
        safe_url='postgresql://sb4scale:[REDACTED]@127.0.0.1:58081'
        url='postgresql://sb4scale:'+self.pw.read_text().strip()+'@127.0.0.1:58081'
        command=['taskset','-c',APP_CORES,str(BACKEND),'--db','postgres-v5',url,'--instance-name',instance,'--instance-secret',secret.read_text(),
                 '--interface','127.0.0.1','--port','58080','--site-proxy-port','58083','--do-not-require-ssl','--disable-beacon',
                 '--local-storage',str(ROOT/(instance+'-storage'))]
        log=(directory/'service.stdout').open('x');err=(directory/'service.stderr').open('x')
        p=sp.Popen(command,cwd=ROOT,env=env,stdout=log,stderr=err)
        self.service=(p,log,err);self.record(p,'app')
        deadline=time.monotonic()+180
        while True:
            if p.poll() is not None:raise RuntimeError('Convex startup failed; private log '+str(directory/'service.stderr'))
            try:
                with urllib.request.urlopen('http://127.0.0.1:58080/version',timeout=.5) as r:
                    if r.status==200:break
            except OSError:pass
            if time.monotonic()>deadline:raise RuntimeError('Convex readiness timeout')
            time.sleep(.2)
        write(directory/'effective.json',dict(instance=instance,persistence='postgres-v5',database=self.db,postgres_url=safe_url,pool=pool,
             APPLICATION_MAX_CONCURRENT_QUERIES=pool,APPLICATION_MAX_CONCURRENT_MUTATIONS=pool,DOCUMENT_RETENTION_DELAY=172800,
             DISABLE_BEACON=True,DISABLE_METRICS_ENDPOINT=False,RUST_LOG='info',interface='127.0.0.1',port=58080,site_proxy_port=58083,
             require_ssl=False,drain='HTTP outstanding and committer unpublished gauges; two zeros 100ms apart; 30s bound; background SQL may continue',local_storage=str(ROOT/(instance+'-storage')),auth='offline RS256 fixture JWT; customJwt data URI JWKS',delay_us=delay))

    def ready_tcp(self,p,port):
        deadline=time.monotonic()+30
        while True:
            if p.poll() is not None:raise RuntimeError('dispatcher failed')
            try:
                with socket.create_connection(('127.0.0.1',port),timeout=.1):return
            except OSError:pass
            if time.monotonic()>deadline:raise RuntimeError('dispatcher timeout')
            time.sleep(.05)

    def record(self,p,kind):
        with (self.out/'pids.jsonl').open('a') as f:f.write(json.dumps(dict(pid=p.pid,kind=kind,time=time.time()))+'\n')

    def stop_service(self):
        if self.service:
            p,log,err=self.service
            if p.poll() is None:p.send_signal(2)
            try:p.wait(timeout=30)
            except sp.TimeoutExpired:p.terminate();p.wait(timeout=10)
            log.close();err.close();self.service=None
        if self.dispatcher:
            p,log,err=self.dispatcher
            if p.poll() is None:p.terminate()
            p.wait(timeout=10);log.close();err.close();self.dispatcher=None

    # @ref LLP 3000.009.001.002#6-method-and-metrics — settle request/commit outcomes without demanding that persistence maintenance stop
    def drain(self,directory,prefix):
        start=time.monotonic();observations=[];quiet=0
        while True:
            with urllib.request.urlopen('http://127.0.0.1:58080/metrics',timeout=10) as response:values=native_inflight(response.read().decode())
            observations.append(dict(elapsed_s=time.monotonic()-start,**values))
            quiet=quiet+1 if all(value==0 for value in values.values()) else 0
            if quiet>=2:
                background=int(super().psql("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND application_name<>'sb4scale_observer' AND state='active'").strip())
                write(directory/(prefix+'.drain.json'),dict(ok=True,criterion='two consecutive zero outstanding HTTP requests and unpublished commits',background_sql_active=background,observations=observations))
                return
            if time.monotonic()-start>30:
                write(directory/(prefix+'.drain.json'),dict(ok=False,observations=observations))
                raise RuntimeError('Convex request/commit work did not drain')
            time.sleep(.1)

    def app_pids(self):return [x[0].pid for x in [self.service,self.dispatcher] if x]

    def fixture(self,rows):
        self.db=f'{self.db_prefix}_{rows}';self.env['SCALE_DATABASE']=self.db
        exists=self.psql(f"SELECT count(*) FROM pg_database WHERE datname='{self.db}'",database='postgres').strip()=='1'
        if not exists:self.psql('CREATE DATABASE '+self.db,database='postgres')
        self.psql('CREATE EXTENSION IF NOT EXISTS pg_stat_statements')
        directory=self.out/f'fixture-{rows}';directory.mkdir()
        self.start_service(32,0,directory)
        self.cli('env','set','S1CX_JWKS',self.jwks,log=directory/'env-set.txt')
        self.cli('dev','--once','--typecheck','disable',log=directory/'deploy.txt')
        receipt=ROOT/f'seed-{rows}.json'
        if not exists or not receipt.exists():
            for table,records in seed(rows):
                file=ROOT/f'{table}-{rows}.jsonl'
                h=hashlib.sha256();n=0
                with file.open('w') as f:
                    for row in records:
                        s=json.dumps(row,separators=(',',':'))+'\n';f.write(s);h.update(s.encode());n+=1
                self.cli('import','--table',table,'--format','jsonLines','--replace','--yes',str(file),log=directory/(table+'-import.txt'))
                with (directory/'seed-fingerprints.jsonl').open('a') as f:f.write(json.dumps(dict(table=table,count=n,sha256=h.hexdigest()))+'\n')
            receipt.write_text(json.dumps(dict(rows=rows,fixture='seed.sql numeric field parity')))
        self.stop_service()
        self.psql('VACUUM ANALYZE')
        storage=self.psql("SELECT jsonb_agg(jsonb_build_object('table',relname,'estimated_rows',n_live_tup,'heap_bytes',pg_table_size(relid),'index_bytes',pg_indexes_size(relid))) FROM pg_stat_user_tables")
        write(self.out/f'storage-{rows}.json',json.loads(storage))

    def metrics(self,path):
        with urllib.request.urlopen('http://127.0.0.1:58080/metrics',timeout=10) as response:path.write_bytes(response.read())

    def trial(self,directory,workload,writers,keys,rows,rate,repeat):
        prefix=f'rate-{rate}-r{repeat}'
        self.metrics(directory/(prefix+'.metrics-before.txt'))
        result=super().trial(directory,workload,writers,keys,rows,rate,repeat)
        self.metrics(directory/(prefix+'.metrics-after.txt'))
        return result

    def before_trials(self,directory,workload,writers,keys,rows):
        if keys!='sharded': return
        # Convex's sharded counter creates its documents before the hot loop, so each
        # measured write patches one shard instead of racing an insert.
        created=self.call('chat:ensureShards',{'counter':256,'shards':32},'mutation',admin=True)
        write(directory/'ensure-shards.json',created)

    def cell(self,workload,rows,delay,writers,keys):
        super().cell(workload,rows,delay,writers,keys)
        path=self.out/f'{workload.lower()}-n{rows}-d{delay}-c{writers}-{keys}'/'cell.json'
        c=json.loads(path.read_text());c['rerun']=['python3','scripts/convex.py','cell','--out',f'/home/ccheever/sb4scale/s1cx/replay-{path.parent.name}',
            '--workload',workload,'--rows',str(rows),'--delay-us',str(delay),'--writers',str(writers),'--keys',keys,
            '--warmup-ms',str(self.args.warmup_ms),'--duration-ms',str(self.args.duration_ms),'--repeats',str(self.args.repeats)]
        path.write_text(json.dumps(c,indent=2)+'\n')

    def close(self):
        super().close()
        write(self.out/'process-summary.json',dict(children=len(self.started),alive=[p.pid for p in self.started if p.poll() is None]))


def seed(rows):
    totals=[(rows+1023-r)//1024 for r in range(1024)]+[0]
    yield 'users',(dict(id=u,sent=sum(totals[u*4:u*4+4])) for u in range(256))
    yield 'rooms',(dict(id=r,total=totals[r]) for r in range(1025))
    yield 'memberships',(dict(room=r,principal=u,last_read=max(0,totals[r]-10)) for u in range(256) for r in [*((u*4+j)%1024 for j in range(32)),1024])
    yield 'counters',(dict(id=c,owner_id=c if c<256 else None,room=1024,n=0) for c in range(257))
    yield 'messages',(dict(id=g,room=(g-1)%1024,sender=((g-1)%1024)//4,at=1700000000000+g,body=f'message-{g} '+'chat '*30) for g in range(1,rows+1))


def main():
    p=argparse.ArgumentParser()
    p.add_argument('mode',choices=['fixture','cell','matrix','all','serve','advocate'])
    p.add_argument('--out',required=True);p.add_argument('--rows',type=int,default=1000000)
    p.add_argument('--workload',default='W1');p.add_argument('--writers',type=int,default=128)
    p.add_argument('--keys',default='disjoint');p.add_argument('--delay-us',type=int,default=0)
    p.add_argument('--tunnel-base',type=int,default=61000);p.add_argument('--load-cores',default=run.LOAD_CORES)
    p.add_argument('--warmup-ms',type=int);p.add_argument('--duration-ms',type=int)
    p.add_argument('--repeats',type=int,default=3);p.add_argument('--max-rate',type=int,default=128000)
    p.add_argument('--rates',type=int,nargs='+');args=p.parse_args();args.target='convex'
    # Advocate soaks long enough for isolate compile and the query cache to leave the measured window.
    if args.warmup_ms is None: args.warmup_ms=10000 if args.mode=='advocate' else 500
    if args.duration_ms is None: args.duration_ms=20000 if args.mode=='advocate' else 2000
    if args.mode in ('matrix','all'):
        delays=[0,500] if args.mode=='matrix' else [0,200,500,1000]
        matrix=[(w,n,d,128,'disjoint') for n in [100000,1000000] for d in delays for w in ['W1','W2','W3']]
        matrix += [(w,1000000,d,c,k) for d in delays for c in [1,2,4,8,16,32,64,128,256] for w,k in [('W4','disjoint'),('W5','same'),('W5','hot1')]]
    elif args.mode=='advocate':
        # Headline cells at the matched budget, plus the labelled sharded counter.
        matrix=[(w,1000000,d,128,'disjoint') for d in (0,500) for w in ('W1','W2','W3')]
        matrix += [(w,1000000,d,32,k) for d in (0,500) for w,k in (('W4','disjoint'),('W5','same'),('W5','hot1'),('W5','sharded'))]
    elif args.mode=='cell':matrix=[(args.workload,args.rows,args.delay_us,args.writers,args.keys)]
    else:matrix=[]
    count=max(([args.writers] if args.mode=='serve' else [])+[32 if w in ['W1','W2','W3'] else c for w,n,d,c,k in matrix]+[32])+1
    r=ConvexRun(args)
    try:
        r.start(count)
        for n in dict.fromkeys([x[1] for x in matrix] or [args.rows]):r.fixture(n)
        if args.mode=='serve':
            d=r.out/'serve';d.mkdir();r.start_service(args.writers,args.delay_us,d)
            print('Ready; stop the recorded supervisor with SIGINT for owned-process cleanup',flush=True)
            while r.service[0].poll() is None:time.sleep(.5)
        for w,n,d,c,k in matrix:
            r.db=f'{r.db_prefix}_{n}';r.env['SCALE_DATABASE']=r.db
            r.cell(w,n,d,c,k)
    finally:r.close()

if __name__=='__main__':main()
