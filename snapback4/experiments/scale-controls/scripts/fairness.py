#!/usr/bin/env python3
"""Detached S1-FR campaign; private fixtures/roles, inherited S1 search and SLOs.

setsid nohup python3 scripts/fairness.py --out target/fairness-20261022 >target/fairness.log 2>&1 < /dev/null &
"""
import argparse
import json
import os
from pathlib import Path
import subprocess as sp
import sys
import time
import urllib.error
import urllib.request

from run import Run, HERE, PSQL, write
from supabase import SupabaseRun, token


def own_login(run, role):
    """Create/change only a role backed by this lane's local ownership receipt."""
    receipt=Path.home()/'sb4scale'/f'{role}-owner.json'
    exists=run.psql(f"SELECT count(*) FROM pg_roles WHERE rolname='{role}'").strip()=='1'
    if exists and not receipt.exists(): raise RuntimeError('role exists without S1-FR ownership receipt')
    if not exists:
        run.psql(f'CREATE ROLE {role} LOGIN NOINHERIT')
        write(receipt,dict(lane='S1-FR',role=role,worktree=str(HERE),pid=os.getpid()))
    secret=run.pw.read_text().strip()
    r=sp.run([str(PSQL),'-X','-v','ON_ERROR_STOP=1','-d','postgres','-c',f'\\password {role}'],
        env=run.env,input=secret+'\n'+secret+'\n',capture_output=True,text=True)
    if r.returncode: raise RuntimeError('could not set owned login credential')


class Raw(Run):
    db_prefix='s1fr_raw'
    statement_roles=['s1fr_app']

    def setup_roles(self):
        own_login(self,'s1fr_app')
        self.env['SCALE_DB_USER']='s1fr_app'
        schema=self.out/'raw-schema.sql'
        schema.write_text((HERE/'schema.sql').read_text().replace('scale_app','s1fr_app'))
        self.schema_file=schema

    def before_trials(self,directory,workload,writers,keys,rows):
        if (self.out/'checks.json').exists(): return
        def call(principal, bearer=None, **fields):
            headers={'Content-Type':'application/json'}
            if bearer is not None: headers['Authorization']='Bearer '+bearer
            body=dict(workload='W1',message=1,principal=principal,**fields)
            request=urllib.request.Request('http://127.0.0.1:58080/op',json.dumps(body).encode(),headers)
            try:
                with urllib.request.urlopen(request,timeout=5) as r: return r.status,json.load(r)
            except urllib.error.HTTPError as e: return e.code,None
        if self.args.target=='raw-pg-no-token':
            assert call(0)[0]==200 and call(128)[0]==404
            write(self.out/'checks.json',dict(trusted_principal_path_explicit=True))
            return
        secret=Path(self.env['SCALE_JWT_SECRET_FILE']).read_bytes()
        tokens=json.loads(Path(self.env['SCALE_JWT_TOKENS_FILE']).read_text())
        assert call(128,tokens[0])[0]==200  # JSON principal is ignored.
        assert call(0,tokens[128])[0]==404   # Cannot spoof principal 0.
        assert call(0)[0]==401
        assert call(0,'malformed')[0]==401
        for bearer in [token(secret,0,exp=1),token(b'wrong-test-key'*4,0),
                       token(secret,0,role='service_role'),token(secret,0,aud='other'),
                       token(secret,0,iss='other')]:
            assert call(0,bearer)[0]==401
        # Repeated identical token is still verified; alternation checks pooled isolation.
        for _ in range(4):
            assert call(128,tokens[0])[0]==200
            assert call(0,tokens[128])[0]==404
        write(self.out/'checks.json',dict(signed_sub_overrides_body=True,member_nonmember=True,
            missing_malformed_bad_signature_expired_wrong_role_audience_issuer=True,
            pooled_principal_isolation=True,verification_cache=False))


class Supabase(SupabaseRun):
    db_prefix='s1fr_supabase'
    login_role='s1fr_authenticator'
    statement_roles=['authenticated','s1fr_authenticator']

    def setup_roles(self):
        own_login(self,self.login_role)
        # Existing standard NOLOGIN roles are read/reused, never altered.
        count=int(self.psql("SELECT count(*) FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')").strip())
        if count!=3: raise RuntimeError('missing standard Supabase roles from the control handoff')
        self.psql(f'GRANT anon,authenticated,service_role TO {self.login_role}')
        self.psql(f"ALTER ROLE {self.login_role} SET statement_timeout='8s'")
        # Ping uses the typed fixture's read-only SELECT 1 path with this private login.
        self.env['SCALE_DB_USER']=self.login_role


def matrix():
    for delay in (0,500):
        for w in ('W1','W2','W3'): yield w,1000000,delay,128,'disjoint'
        for w,keys in [('W4','disjoint'),('W5','same'),('W5','hot1')]:
            yield w,1000000,delay,32,keys


def worker(args):
    args.warmup_ms=10000;args.duration_ms=20000;args.repeats=3
    args.max_rate=128000;args.rates=None;args.load_cores='3-5,9-11'
    run=Supabase(args) if args.target=='supabase' else Raw(args)
    run.query_pool_budget=32
    try:
        run.start(34 if args.target=='supabase' else 33)
        ownership=json.loads((run.out/'ownership.json').read_text())
        ownership['command']=['python3','scripts/fairness.py','--worker','--target',args.target,'--out',str(run.out)]
        ownership['database']=f'{run.db_prefix}_1000000'
        ownership['method']=dict(warmup_ms=10000,duration_ms=20000,repeats=3,read_clients=128,write_clients=32,pool=32)
        (run.out/'ownership.json').write_text(json.dumps(ownership,indent=2)+'\n')
        run.fixture(1000000)
        for cell in matrix(): run.cell(*cell)
    finally:
        run.close()


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--out',required=True)
    p.add_argument('--worker',action='store_true')
    p.add_argument('--target',choices=['raw-pg','raw-pg-no-token','supabase'])
    p.add_argument('--tunnel-base',type=int,default=63100)
    args=p.parse_args()
    if args.worker:
        if not args.target: p.error('--worker requires --target')
        return worker(args)
    out=Path(args.out).resolve();out.mkdir(parents=True,exist_ok=False)
    write(out/'supervisor.json',dict(pid=os.getpid(),pgid=os.getpgid(0),start=time.time(),command=sys.argv))
    processes=[]
    try:
        for target in ('raw-pg','raw-pg-no-token','supabase'):
            with (out/f'{target}.log').open('x') as log:
                child=sp.Popen([sys.executable,str(Path(__file__).resolve()),'--worker','--target',target,
                    '--out',str(out/target),'--tunnel-base',str(args.tunnel_base)],stdout=log,stderr=sp.STDOUT)
                with (out/'pids.jsonl').open('a') as f:
                    f.write(json.dumps(dict(pid=child.pid,kind='campaign',target=target,time=time.time()))+'\n')
                processes.append(child)
                print(f'started {target} pid={child.pid}',flush=True)
                while child.poll() is None:
                    time.sleep(15)
                    cells=len(list((out/target).glob('*/summary.json')))
                    trials=len(list((out/target).glob('*/rate-*-r[0-9].json')))
                    with (out/'polls.jsonl').open('a') as f:
                        f.write(json.dumps(dict(time=time.time(),target=target,pid=child.pid,exit_status=child.poll(),completed_cells=cells,trials=trials))+'\n')
                if child.returncode: raise RuntimeError(f'{target} exited {child.returncode}; inspect its log')
                print(f'completed {target}',flush=True)
    finally:
        for child in processes:
            if child.poll() is None:
                child.terminate();child.wait(timeout=30)
        write(out/'supervisor-cleanup.json',dict(processes=[dict(pid=c.pid,status=c.returncode) for c in processes],still_running=[c.pid for c in processes if c.poll() is None],end=time.time()))


if __name__=='__main__': main()
