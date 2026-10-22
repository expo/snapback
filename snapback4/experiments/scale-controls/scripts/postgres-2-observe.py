#!/usr/bin/env python3
"""Read-only detached companion: cluster CPU and role-filtered PG waits.

Stops on campaign exit, closes remote monitor stdin, signals only owned PIDs.
"""
import json
import os
from pathlib import Path
import subprocess as sp
import sys
import time

from run import PSQL, SSH, write

root=Path(sys.argv[1]).resolve()
raw=Path(sys.argv[2]).resolve()
exit_path=root/sys.argv[3]
cleanup_path=root/(sys.argv[3]+'.observer-cleanup.json')
children=[]
try:
    while not (raw/'seed-equality.json').exists():
        if exit_path.exists():sys.exit('campaign exited before seed verification')
        time.sleep(1)
    ownership=json.loads((raw/'ownership.json').read_text())
    env=dict(os.environ,PGPASSWORD=(Path.home()/'sb4scale/pw').read_text().strip(),
        PGUSER='sb4scale',PGHOST=ownership['upstream_path'],PGPORT='55440',
        PGAPPNAME='s1pg2_observer',
        LD_LIBRARY_PATH=str(Path.home()/'tools/pg16/usr/lib/x86_64-linux-gnu'))
    sql=raw/'observer.sql'
    sql.write_text("""SELECT jsonb_build_object('time',extract(epoch from clock_timestamp()),'states',
    coalesce(jsonb_agg(jsonb_build_object('pid',pid,'application',application_name,
    'state',state,'wait_type',wait_event_type,'wait',wait_event,'query',query)),'[]'))
    FROM pg_stat_activity WHERE datname='sb4_snapback_s1pg2' AND usename='s1pg2_app';
    \\watch 0.1
    """)
    for name,command,stdin in [
        ('wait-observer',[PSQL,'-X','-qAt','-d','postgres','-f',sql],sp.DEVNULL),
        ('db-cpu-observer',SSH+['expo-build-450a','python3 -u ~/sb4scale/db-monitor.py'],sp.PIPE)]:
        out=(raw/f'{name}.jsonl').open('x')
        p=sp.Popen(['setsid','nohup',*map(str,command)],env=env,stdin=stdin,stdout=out,stderr=sp.STDOUT)
        children.append((p,out))
        with (raw/'pids.jsonl').open('a') as f:f.write(json.dumps(dict(pid=p.pid,kind=name,time=time.time()))+'\n')
    while not exit_path.exists():
        if any(p.poll() is not None for p,_ in children):raise RuntimeError('observer exited early')
        time.sleep(1)
finally:
    for p,out in children:
        if p.stdin:p.stdin.close()
        elif p.poll() is None:p.terminate()
        p.wait(timeout=30);out.close()
    write(cleanup_path,dict(pid=os.getpid(),processes=[dict(pid=p.pid,status=p.returncode) for p,_ in children],still_running=[p.pid for p,_ in children if p.poll() is None]))
