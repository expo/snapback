"""PostgREST target for the S1-H runner. No HTTP wrapper or cluster changes."""
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import stat
import subprocess as sp
import time
import urllib.request
from run import Run, HERE, BIN, APP_CORES, PSQL, write

POSTGREST=Path.home()/'sb4scale/bin/postgrest-v14.18'
POSTGREST_SHA='e62299f98f67938f754291340b2fc07b69685546e6017b455ef3e776daef45ee'


def token(secret, principal=0, role='authenticated', **overrides):
    def enc(value):
        return base64.urlsafe_b64encode(json.dumps(value,separators=(',',':')).encode()).rstrip(b'=')
    claims=dict(role=role,sub=f'00000000-0000-0000-0000-{principal+1:012x}',
                aud='authenticated',iss='supabase',iat=int(time.time()),exp=int(time.time())+86400)
    claims.update(overrides)
    body=enc(dict(alg='HS256',typ='JWT'))+b'.'+enc(claims)
    return (body+b'.'+base64.urlsafe_b64encode(hmac.digest(secret,body,'sha256')).rstrip(b'=')).decode()


def private_file(path, data):
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as f: f.write(data)


class SupabaseRun(Run):
    db_prefix='sb4scale_supabase'
    db_schema='sb4scale'
    schema_file=HERE/'supabase-schema.sql'
    app_name='sb4scale_supabase'
    statement_roles=['authenticated','authenticator']

    def __init__(self,args):
        super().__init__(args)
        self.dispatcher=None
        self.env['PGOPTIONS']='-c search_path=sb4scale,public'
        self.jwt=Path.home()/'sb4scale/s1sb-jwt-secret'
        if not self.jwt.exists(): private_file(self.jwt,secrets.token_hex(32))
        assert stat.S_IMODE(self.jwt.stat().st_mode)==0o600
        self.tokens_path=Path.home()/'sb4scale/s1sb-jwt-tokens.json'
        tokens=json.dumps([token(self.jwt.read_bytes(),i) for i in range(256)])
        if self.tokens_path.exists():
            assert stat.S_IMODE(self.tokens_path.stat().st_mode)==0o600
            self.tokens_path.write_text(tokens)
        else: private_file(self.tokens_path,tokens)
        self.env['SCALE_JWT_TOKENS_FILE']=str(self.tokens_path)
        self.env['PGRST_JWT_SECRET']='@'+str(self.jwt)
        self.env['PGRST_DB_USE_LEGACY_GUCS']='false'
        # Full subprocess inventory (including short-lived psql/ping children).
        # Do not log env, stdin, tokens, connection strings or SQL output.
        original=sp.Popen
        ledger=self.out/'all-pids.jsonl'
        self.started=[]
        started=self.started
        class RecordedPopen(original):
            def __init__(child,*a,**kw):
                super().__init__(*a,**kw)
                started.append(child)
                with ledger.open('a') as f:
                    f.write(json.dumps(dict(pid=child.pid,ppid=os.getpid(),time=time.time(),executable=str(child.args[0])))+'\n')
        sp.Popen=RecordedPopen

    def setup_roles(self):
        # Standard role names; only create absent roles, never alter another lane.
        existing=json.loads(self.psql("SELECT coalesce(jsonb_agg(rolname),'[]') FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role','authenticator')"))
        receipt=Path.home()/'sb4scale/s1sb-owned-roles.json'
        owned=json.loads(receipt.read_text()) if receipt.exists() else []
        if any(r not in owned for r in existing):
            raise RuntimeError('standard roles already belong to another lane; refusing to alter')
        roles=dict(anon='NOLOGIN NOINHERIT',authenticated='NOLOGIN NOINHERIT',
                   service_role='NOLOGIN NOINHERIT BYPASSRLS',authenticator='LOGIN NOINHERIT')
        for role,options in roles.items():
            if role not in existing:
                self.psql(f'CREATE ROLE {role} {options}')
                owned.append(role); receipt.write_text(json.dumps(owned))
        self.psql('GRANT anon,authenticated,service_role TO authenticator')
        self.psql("ALTER ROLE anon SET statement_timeout='3s'; ALTER ROLE authenticated SET statement_timeout='8s'; ALTER ROLE authenticator SET statement_timeout='8s'")
        # Same mode-600 credential as the cluster, sent only on psql stdin.
        secret=self.pw.read_text().strip()
        result=sp.run([str(PSQL),'-X','-v','ON_ERROR_STOP=1','-d','postgres','-c','\\password authenticator'],
                      env=self.env,input=secret+'\n'+secret+'\n',capture_output=True,text=True)
        if result.returncode: raise RuntimeError('could not set owned authenticator password')

    def start_service(self,pool,delay,directory):
        self.stop_service()
        assert hashlib.sha256(POSTGREST.read_bytes()).hexdigest()==POSTGREST_SHA
        log=(directory/'dispatcher.stdout').open('x'); err=(directory/'dispatcher.stderr').open('x')
        p=sp.Popen(['taskset','-c',APP_CORES,str(BIN),'dispatch','--delay-us',str(delay)],env=self.env,stdout=log,stderr=err)
        self.dispatcher=(p,log,err)
        self.record(p,'app',component='dispatcher',delay_us=delay)
        deadline=time.monotonic()+15
        while True:
            if p.poll() is not None: raise RuntimeError('dispatcher startup failed')
            text=(directory/'dispatcher.stdout').read_text()
            if text.endswith('\n') and json.loads(text)['pid']==p.pid: break
            if time.monotonic()>deadline: raise RuntimeError('dispatcher timeout')
            time.sleep(.05)
        self.env['PGRST_DB_URI']=f"host=127.0.0.1 port=58081 user=authenticator password={self.pw.read_text().strip()} dbname={self.db} application_name={self.app_name}"
        log=(directory/'service.stdout').open('x'); err=(directory/'service.stderr').open('x')
        p=sp.Popen(['taskset','-c',APP_CORES,str(POSTGREST),str(HERE/'supabase.conf')],env=self.env,stdout=log,stderr=err)
        self.service=(p,log,err)
        self.record(p,'app',component='postgrest',pool=10)
        deadline=time.monotonic()+60
        while True:
            if p.poll() is not None: raise RuntimeError('PostgREST startup failed; see service.stderr')
            try:
                with urllib.request.urlopen('http://127.0.0.1:58082/ready',timeout=.2) as response:
                    if response.status==200:
                        self.assert_listener(p.pid,58080)
                        break
            except OSError: pass
            if time.monotonic()>deadline: raise RuntimeError('PostgREST readiness timeout')
            time.sleep(.1)
        write(directory/'target.json',dict(target='supabase-postgrest-only',postgrest='14.18',pool=10,
               raw_pool_equivalent=pool,postgrest_sha256=POSTGREST_SHA,dispatcher_pid=self.dispatcher[0].pid,
               postgrest_pid=p.pid,added_rtt_us=delay))
        # Capture all effective settings while redacting URI/secret in memory.
        config=sp.check_output([str(POSTGREST),str(HERE/'supabase.conf'),'--dump-config'],env=self.env,text=True)
        (directory/'effective.conf').write_text('\n'.join(
            line.split('=')[0]+'= "<redacted>"' if line.startswith(('db-uri =','jwt-secret =')) else line
            for line in config.splitlines())+'\n')

    @staticmethod
    def assert_listener(pid,port):
        inodes=set()
        for fd in Path(f'/proc/{pid}/fd').iterdir():
            try: inodes.add(os.readlink(fd))
            except FileNotFoundError: pass
        for file in ['tcp','tcp6']:
            for line in Path(f'/proc/{pid}/net/{file}').read_text().splitlines()[1:]:
                fields=line.split()
                if int(fields[1].split(':')[1],16)==port and fields[3]=='0A' and f'socket:[{fields[9]}]' in inodes: return
        raise RuntimeError('HTTP listener does not belong to recorded PostgREST PID')

    def record(self,p,kind,**fields):
        with (self.out/'pids.jsonl').open('a') as f:
            f.write(json.dumps(dict(pid=p.pid,kind=kind,time=time.time(),**fields))+'\n')

    def app_pids(self):
        return [self.service[0].pid,self.dispatcher[0].pid]

    def stop_service(self):
        super().stop_service()
        if self.dispatcher:
            p,log,err=self.dispatcher
            if p.poll() is None: p.terminate()
            p.wait(timeout=15);log.close();err.close();self.dispatcher=None

    def close(self):
        super().close()
        write(self.out/'all-process-cleanup.json',dict(processes=[dict(pid=p.pid,exit_status=p.poll()) for p in self.started],
              still_running=[p.pid for p in self.started if p.poll() is None]))
        if any(p.poll() is None for p in self.started): raise RuntimeError('owned process still running')
