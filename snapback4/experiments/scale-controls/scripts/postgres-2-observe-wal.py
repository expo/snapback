#!/usr/bin/env python3
"""Detached global WAL timing supplement; never called database-only timing."""
import json
import os
from pathlib import Path
import subprocess as sp
import sys
import time

from run import PSQL, write

raw=Path(sys.argv[1]).resolve();done=Path(sys.argv[2]).resolve()
ownership=json.loads((raw/'ownership.json').read_text())
env=dict(os.environ,PGPASSWORD=(Path.home()/'sb4scale/pw').read_text().strip(),
    PGUSER='sb4scale',PGHOST=ownership['upstream_path'],PGPORT='55440',PGAPPNAME='s1pg2_observer',
    LD_LIBRARY_PATH=str(Path.home()/'tools/pg16/usr/lib/x86_64-linux-gnu'))
sql=raw/'wal-observer.sql'
sql.write_text("SELECT jsonb_build_object('time',extract(epoch from clock_timestamp()),'wal',to_jsonb(w)) FROM pg_stat_wal w;\n\\watch 1\n")
out=(raw/'wal-timing.jsonl').open('x')
p=sp.Popen(['setsid','nohup',str(PSQL),'-X','-qAt','-d','postgres','-f',str(sql)],env=env,
    stdin=sp.DEVNULL,stdout=out,stderr=sp.STDOUT)
with (raw/'pids.jsonl').open('a') as f:
    for pid,kind in [(os.getpid(),'wal-observer'),(p.pid,'wal-observer-psql')]:
        f.write(json.dumps(dict(pid=pid,kind=kind,time=time.time()))+'\n')
try:
    while not done.exists():
        if p.poll() is not None and (raw/'cleanup.json').exists():break
        if p.poll() is not None:raise RuntimeError('WAL observer exited before cleanup')
        time.sleep(.25)
finally:
    if p.poll() is None:p.terminate()
    p.wait(timeout=30);out.close()
    write(raw/'wal-observer-cleanup.json',dict(pid=os.getpid(),child_pid=p.pid,status=p.returncode,still_running=[]))
