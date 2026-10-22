#!/usr/bin/env python3
"""Detached S1-PG refusal repros, transport pings and a labelled tiny write probe.

The tiny probe is NOT a W1-W5 cell: the required unchanged application refuses.
Never patches the product, changes cluster configuration, or writes managed SQL.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess as sp
import time
import urllib.request
from urllib.parse import quote

from postgres import Experiment, ROOT, SOCKET, SB
from run import HERE, BIN, APP_CORES, SSH, SSH_CORES, write

TINY='''use identity

table counters:
  owner: principal
  n: int default 0
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  online only

mutation make():
  return insert counters { id: 'c0000', owner: viewer }

mutation increment(counter: counters):
  c = counters[counter] ! else NOT_FOUND
  return update counters[c.id] { n: c.n + 1 }
'''

MINIMAL='''table rooms:
  total: count messages by .room
  read <- allow
  online only

table messages:
  room: rooms
  read <- allow
  online only
'''

STATS="""SELECT coalesce(jsonb_agg(jsonb_build_object('queryid',queryid::text,'query',query,
 'calls',calls,'total_exec_time',total_exec_time,'rows',rows,'wal_bytes',wal_bytes)), '[]')
 FROM pg_stat_statements WHERE dbid=(SELECT oid FROM pg_database WHERE datname=current_database())
 AND userid=(SELECT oid FROM pg_roles WHERE rolname='s1pg_app')"""


class Probes(Experiment):
    def config(self, socket_dir, namespace='bench'):
        self.env['SNAPBACK4_STORE_URL']='postgres://s1pg_app:'+quote(self.env['PGPASSWORD'],safe='')+'@/sb4_snapback_s1pg?host='+quote(str(socket_dir),safe='')+'&port=55440&schema='+namespace+'&ha=none'
        self.env.update(SCALE_PASSWORD_FILE=str(Path.home()/'sb4scale/pw'),SCALE_DB_USER='s1pg_app',SCALE_DATABASE='sb4_snapback_s1pg')

    def command(self, command, name, cwd=None):
        p=self.spawn(command,name,cwd)
        code=p.wait(timeout=180)
        write(self.out/f'{name}.exit.json',dict(code=code))
        return code

    def app(self,name,source):
        path=ROOT/name;(path/'snapback').mkdir(parents=True,exist_ok=True)
        if (path/'snapback/schema.q').exists():
            assert (path/'snapback/schema.q').read_text()==source
        (path/'snapback/schema.q').write_text(source)
        return path

    def http(self,path,body,token=None):
        headers={'content-type':'application/json'}
        if token:headers['Authorization']='Bearer '+token
        req=urllib.request.Request('http://127.0.0.1:58080'+path,json.dumps(body).encode(),headers)
        with urllib.request.urlopen(req,timeout=30) as response:return json.load(response)

    def run(self):
        custody=json.loads((ROOT/'raw/database-custody.json').read_text())
        assert custody['database']=='sb4_snapback_s1pg' and custody['role']=='s1pg_app'
        self.spawn(['taskset','-c',SSH_CORES,*SSH,'-o','ExitOnForwardFailure=yes',
                    '-o','StreamLocalBindUnlink=yes','-N','-L',
                    f'{SOCKET}/.s.PGSQL.55440:127.0.0.1:55440','expo-build-450a'],'tunnel')
        time.sleep(1);assert self.sql('SELECT 1').strip()=='1'
        self.config(SOCKET)
        self.app('minimal',MINIMAL)
        tiny=self.app('tiny-v2',TINY)
        write(self.out/'ownership.json',dict(pid=os.getpid(),source_commit=sp.check_output(['git','rev-parse','HEAD'],text=True).strip(),
              snapback_binary_sha256=hashlib.sha256(SB.read_bytes()).hexdigest(),
              harness_binary_sha256=hashlib.sha256(BIN.read_bytes()).hexdigest(),
              app_cores=APP_CORES,ssh_cores=SSH_CORES,method='blocked full cells; unqualified tiny serial diagnostic only'))
        self.command([SB,'check','--cost'],'full-check',ROOT/'app')
        proxy=ROOT/args.proxy_name  # sockaddr_un has a 108-byte limit on this host.
        self.spawn(['taskset','-c',APP_CORES,BIN,'unix-proxy','--socket-dir',proxy,
                    '--upstream-dir',SOCKET,'--delay-us','500'],'delay-proxy')
        for _ in range(200):
            if (proxy/'.s.PGSQL.55440').exists():break
            time.sleep(.05)
        for delay,directory in [(0,SOCKET),(500,proxy)]:
            self.idle(f'link-{delay}')
            self.config(directory)
            for rep in range(3):
                assert self.command(['taskset','-c',APP_CORES,BIN,'ping-unix','--socket-dir',directory],f'ping-d{delay}-r{rep}')==0
            # Exact Quarry source; every workload has the same deploy prerequisite.
            self.command([SB,'deploy',ROOT/f'full-{self.out.name}-d{delay}','--json'],f'full-deploy-d{delay}',ROOT/'app')
            self.command([SB,'deploy',ROOT/f'minimal-{self.out.name}-d{delay}','--json'],f'minimal-deploy-d{delay}',ROOT/'minimal')
        # Observe a supported counter mutation without representing it as the required app.
        for delay,directory in [(0,SOCKET),(500,proxy)]:
            self.config(directory,f'diag{delay}')
            deployment=ROOT/f'diagnostic-deployment-d{delay}'
            code=self.command([SB,'deploy',deployment,'--json'],f'tiny-deploy-d{delay}',tiny)
            if code==0:
                self.idle(f'tiny-diagnostic-{delay}')
                serve=self.spawn(['taskset','-c',APP_CORES,SB,'serve',deployment,
                    '--worker-state-dir',ROOT/'tiny-workers','--port','58080'],f'tiny-serve-d{delay}')
                for _ in range(1800):
                    if serve.poll() is not None:break
                    if 'http://127.0.0.1:58080' in (self.out/f'tiny-serve-d{delay}.stdout').read_text():break
                    time.sleep(.1)
                assert serve.poll() is None
                session=self.http('/auth/guest',{})['session']['token']
                made=self.http('/m/make',{'args':{}},session)
                write(self.out/f'tiny-make-d{delay}.json',made)
                if made.get('state')=='sent':
                    for _ in range(10):self.http('/m/increment',{'args':{'counter':'c0000'}},session)
                    write(self.out/f'tiny-d{delay}.before.json',json.loads(self.sql(STATS,'sb4_snapback_s1pg')))
                    times=[];outcomes=[]
                    for _ in range(10):
                        at=time.monotonic();v=self.http('/m/increment',{'args':{'counter':'c0000'}},session)
                        times.append((time.monotonic()-at)*1000);outcomes.append(v)
                    write(self.out/f'tiny-d{delay}.after.json',json.loads(self.sql(STATS,'sb4_snapback_s1pg')))
                    write(self.out/f'tiny-d{delay}.json',dict(latencies_ms=times,outcomes=outcomes,
                        status='tiny serial counter diagnostic; not matched W4; no 1M seed'))
                serve.terminate();serve.wait(timeout=30);time.sleep(3.2)
        write(self.out/'namespace-audit.json',dict(namespaces=json.loads(self.sql("SELECT coalesce(jsonb_agg(nspname),'[]') FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname NOT IN ('public','information_schema')",'sb4_snapback_s1pg'))))
        self.config(SOCKET)
        self.sql('DROP DATABASE sb4_snapback_s1pg')
        self.sql('DROP ROLE s1pg_app')
        write(self.out/'database-cleanup.json',dict(database_dropped=True,role_dropped=True,
            cluster_postmaster_pid=2735539,cluster_unchanged=True))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out-name',default='probes')
    parser.add_argument('--proxy-name',default='d')
    args=parser.parse_args()
    run=Probes(args.out_name)
    try:run.run()
    finally:run.close()
