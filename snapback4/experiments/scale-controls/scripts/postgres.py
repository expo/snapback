#!/usr/bin/env python3
"""S1-PG experiment custody and public-profile probes. No product patches.

Launch detached; passwords are read privately and never enter argv or evidence.
"""
import json
import os
from pathlib import Path
import signal
import socket
import subprocess as sp
import time
from urllib.parse import quote

from run import HERE, PSQL, SSH, SSH_CORES, write

ROOT = HERE / 'target/s1pg'
SOCKET = ROOT / 'socket'
SB = HERE.parents[1] / 'target/s1sk/release/snapback4'


class Experiment:
    def __init__(self, output='raw'):
        ROOT.mkdir(parents=True, exist_ok=True)
        self.out = ROOT / output
        self.out.mkdir(exist_ok=False)
        self.children = []
        self.env = dict(os.environ, PGPASSWORD=(Path.home()/'sb4scale/pw').read_text().strip(),
                        PGUSER='sb4scale', PGDATABASE='postgres', PGHOST=str(SOCKET), PGPORT='55440',
                        PGAPPNAME='s1pg_observer',
                        LD_LIBRARY_PATH=str(Path.home()/'tools/pg16/usr/lib/x86_64-linux-gnu'))

    def spawn(self, command, name, cwd=None, env=None):
        out=(self.out/f'{name}.stdout').open('x'); err=(self.out/f'{name}.stderr').open('x')
        p=sp.Popen(['setsid','nohup',*map(str,command)],cwd=cwd,env=env or self.env,
                   stdin=sp.DEVNULL,stdout=out,stderr=err)
        self.children.append((p,out,err))
        with (self.out/'pids.jsonl').open('a') as f:
            f.write(json.dumps(dict(pid=p.pid,name=name,command=list(map(str,command)),time=time.time()))+'\n')
        return p

    def sql(self, sql, database='postgres'):
        return sp.check_output([str(PSQL),'-X','-qAt','-v','ON_ERROR_STOP=1','-d',database],
                               input=sql,env=self.env,text=True)

    def idle(self, name):
        # Retain every observation; never signal or interfere with another lane.
        query="""SELECT coalesce(jsonb_agg(jsonb_build_object('pid',pid,'database',datname,
        'application',application_name,'state',state,'wait_type',wait_event_type,
        'wait',wait_event)),'[]') FROM pg_stat_activity WHERE backend_type='client backend'
        AND pid<>pg_backend_pid() AND datname NOT IN ('sb4_snapback_s1pg')
        AND (state<>'idle' OR application_name NOT IN ('','s1pg_observer'))"""
        while True:
            active=json.loads(self.sql(query))
            with (self.out/'cluster-idle.jsonl').open('a') as f:
                f.write(json.dumps(dict(time=time.time(),before=name,other_activity=active))+'\n')
            if not active:return
            print(f'Waiting for other database activity before {name}: {len(active)} connections',flush=True)
            time.sleep(10)

    def start(self):
        SOCKET.mkdir(mode=0o700)
        self.spawn(['taskset','-c',SSH_CORES,*SSH,'-o','ExitOnForwardFailure=yes','-N','-L',
                    f'{SOCKET}/.s.PGSQL.55440:127.0.0.1:55440','expo-build-450a'],'tunnel')
        for _ in range(200):
            if (SOCKET/'.s.PGSQL.55440').exists():break
            time.sleep(.1)
        self.sql('SELECT 1')
        self.idle('provision')
        assert self.sql("SELECT count(*) FROM pg_database WHERE datname='sb4_snapback_s1pg'").strip()=='0'
        assert self.sql("SELECT count(*) FROM pg_roles WHERE rolname='s1pg_app'").strip()=='0'
        self.sql('CREATE ROLE s1pg_app LOGIN')
        # Same private password as controls, sent only through psql stdin.
        self.sql("ALTER ROLE s1pg_app PASSWORD '"+self.env['PGPASSWORD']+"'")
        self.sql('CREATE DATABASE sb4_snapback_s1pg OWNER s1pg_app')
        write(self.out/'database-custody.json',dict(database='sb4_snapback_s1pg',role='s1pg_app',created_by=os.getpid()))
        self.sql('CREATE EXTENSION pg_stat_statements','sb4_snapback_s1pg')
        (self.out/'postgres.txt').write_text(self.sql("SELECT version(); SELECT name,setting,unit FROM pg_settings WHERE name IN ('port','fsync','synchronous_commit','full_page_writes','shared_buffers','max_connections','shared_preload_libraries','wal_sync_method','jit') ORDER BY name"))
        self.url='postgres://s1pg_app:'+quote(self.env['PGPASSWORD'],safe='')+'@/sb4_snapback_s1pg?host='+quote(str(SOCKET),safe='')+'&port=55440&schema=bench&ha=none'
        self.env['SNAPBACK4_STORE_URL']=self.url
        self.app=ROOT/'app';self.app.mkdir();(self.app/'snapback').mkdir()
        (self.app/'snapback/schema.q').write_bytes((HERE/'snapback-app/snapback/schema.q').read_bytes())
        self.deployment=ROOT/'deployment'
        write(self.out/'transport.json',dict(local_socket=str(SOCKET/'.s.PGSQL.55440'),
              path='450b Unix socket -> OpenSSH direct-streamlocal forwarding -> 450a 127.0.0.1:55440',
              ssh_cores=SSH_CORES,cluster_postmaster_pid=2735539))
        while not (ROOT/'build.exit').exists():time.sleep(1)
        assert (ROOT/'build.exit').read_text().strip()=='0'
        self.idle('deploy')
        p=self.spawn([SB,'deploy',self.deployment,'--json'],'deploy',self.app)
        code=p.wait()
        write(self.out/'deploy-exit.json',dict(exit_code=code))
        print('deploy exit',code,flush=True)

    def close(self):
        statuses=[]
        for p,out,err in reversed(self.children):
            if p.poll() is None:p.terminate()
            p.wait(timeout=30);out.close();err.close()
            statuses.append(dict(pid=p.pid,status=p.returncode))
        write(self.out/'cleanup.json',dict(processes=statuses,still_running=[]))


def main():
    run=Experiment()
    try:run.start()
    finally:run.close()


if __name__=='__main__':main()
