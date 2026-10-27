"""Native SQLite lifecycle for s1-onehost; shared search/load/SLO/custody unchanged."""
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess as sp
import time

import snapback
import run
from run import HERE, write


def adapt(onehost):
    class SQLiteOneHost(onehost):
        def start(self):
            # Same device/filesystem as one-host PG's /tmp/s1c-*/pg data.
            assert self.runtime.stat().st_dev == Path('/tmp').stat().st_dev
            self.env.pop('SNAPBACK4_STORE_URL',None)
            sources=[HERE/'scripts/s1-onehost.py',Path(__file__),HERE/'scripts/run.py',HERE/'scripts/snapback.py',*sorted((HERE/'src').glob('*.rs')),HERE/'snapback-app/snapback/schema.q']
            write(self.out/'ownership.json',dict(source_commit=sp.check_output(['git','rev-parse','HEAD'],text=True).strip(),
                system='snapback',store='sqlite',host=socket.gethostname(),binary_sha256=hashlib.sha256(run.BIN.read_bytes()).hexdigest(),
                target_binary_sha256=dict(snapback=hashlib.sha256(snapback.SB.read_bytes()).hexdigest()),
                source_sha256={str(p.relative_to(HERE)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sources},
                pg_cores='unused (no PG process)',app_cores=snapback.APP_CORES,load_cores=snapback.LOAD_CORES,
                method=dict(warmup_ms=self.args.warmup_ms,duration_ms=self.args.duration_ms,repeats=self.args.repeats,extra_read_rates=self.args.extra_read_rates),
                command=os.sys.argv,sqlite=dict(path=str(self.release/'store.sqlite'),durability='shipped WAL/FULL',
                device=self.runtime.stat().st_dev,link='natural; no database link',read_grant_clock_bounds=self.env.get('SNAPBACK4_READ_GRANT_CLOCK_BOUNDS'))))
            (self.out/'host.txt').write_text(sp.check_output(['bash','-c','hostname; uname -a; lscpu; free -m; df -h /home; uptime'],text=True))
            (self.out/'filesystem.txt').write_text(sp.check_output(['findmnt','-T',str(self.runtime),'-o','SOURCE,FSTYPE,OPTIONS'],text=True))
            (self.out/'check.txt').write_text(self.cli('check','--cost'))

        def fixture(self,rows):
            source=getattr(self.args,'sqlite_seed_release',None)
            if not source:
                return snapback.Snapback.fixture(self,rows)
            import sqlite3
            import shutil
            source=Path(source).resolve()
            # Restore the deployed release metadata too: deploy from a fresh
            # development project would require a development store of its own.
            shutil.copytree(source,self.release,ignore=shutil.ignore_patterns('store.sqlite','store.sqlite-wal','store.sqlite-shm','store.sqlite-owner'))
            with sqlite3.connect(f'file:{source}/store.sqlite?mode=ro',uri=True) as src:
                with sqlite3.connect(self.release/'store.sqlite') as dst:src.backup(dst)
            write(self.out/'seed-equality.json',self.verify_seed(rows))
            write(self.out/'seed-restoration.json',dict(source=str(source),method='stopped owned deployed fixture, release metadata copy, read-only SQLite backup, full image verification'))

        def command(self,command,name,cwd=None):
            p,out,err=self.spawn(command,self.out,name,cwd)
            code=p.wait();out.close();err.close()
            if code:raise RuntimeError(f'{name} failed: {code}')
            return Path(out.name).read_text()

        def ping(self,delay,path):
            assert delay==0
            snapback.Snapback.ping(self,delay,path)

        def start_service(self,pool,delay,directory):
            snapback.Snapback.start_service(self,pool,delay,directory)
            # Use native identity writes as FIFO barriers, as in the PG adapter.
            if not hasattr(self,'barrier_token'):
                self.barrier_token=self.cli('token','--service','drain','--release',self.release,'--quiet').strip()

        def cli(self,*args):
            if args[0]=='token' and 'drain' in args and hasattr(self,'barrier_token'):
                deadline=time.monotonic()+30
                while True:
                    status,value=snapback.http('/auth/session',dict(principal='barrier:drain',kind='member',days=7),self.barrier_token)
                    if status==200 and 'session' in value:return ''
                    refusal=value.get('denied',value.get('why',{}));code=refusal.get('code') if isinstance(refusal,dict) else None
                    if not (status==429 or status==503 and code in ('E_RATE_LIMIT','E_STREAMS')) or time.monotonic()>deadline:
                        raise RuntimeError(f'native drain refused: {status}, {code}')
                    time.sleep(.1)
            return snapback.Snapback.cli(self,*args)

        def before_trials(self,directory,workload,writers,keys,rows):
            # Reuse the native adapter's untimed operation/authorization probe.
            import importlib.util
            spec=importlib.util.spec_from_file_location('native_pg_probe',HERE/'scripts/postgres-2.py')
            module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
            module.Postgres.before_trials(self,directory,workload,writers,keys,rows)
            witness=[]
            for pid in self.app_pids():
                for task in Path(f'/proc/{pid}/task').iterdir():
                    try:
                        cpus=sorted(os.sched_getaffinity(int(task.name)));assert cpus==[3,4,9,10]
                        witness.append(dict(role='app',pid=pid,tid=int(task.name),cpus=cpus))
                    except ProcessLookupError:pass
            write(directory/'affinity.json',witness)
            if not (self.out/'authorization.json').exists():
                write(self.out/'authorization.json',dict(source='native fixture equality and per-cell complete/sent operation probes'))

        def snapshot(self):return snapback.Snapback.snapshot(self)

        def cell(self,*args):
            # The parent owns the unchanged common search and host start gate.
            super().cell(*args)
            w,rows,delay,clients,keys=args
            path=self.out/f'{w.lower()}-n{rows}-d{delay}-c{clients}-{keys}'/'cell.json'
            value=json.loads(path.read_text());value['store']='sqlite';value['link']='natural; no database link'
            command=value['rerun'];i=command.index('--link');command[i+1]='A';command+=['--store','sqlite']
            path.write_text(json.dumps(value,indent=2)+'\n')
    return SQLiteOneHost
