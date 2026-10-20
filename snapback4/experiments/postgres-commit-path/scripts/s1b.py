#!/usr/bin/env python3
"""S1b: one owned database, one SSH process per DB connection, serial cells.

Usage: python3 scripts/s1b.py NEW_RESULTS_DIR [smoke|all]
No server configuration changes; no retries of failed product cells.
All connection strings/passwords stay out of output. Finally drops only the
owned database and stops only the recorded tunnel PIDs. See README.
"""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import shlex
import signal
import socket
import stat
import subprocess as sp
import sys
import time

HERE = Path(__file__).resolve().parent.parent
BIN = HERE / 'target/release/snapback4-postgres-commit-path'
PG_BIN = Path.home() / 'tools/pg16/usr/lib/postgresql/16/bin'
REMOTE = 'expo-build-450a'
SSH = ['ssh', '-o', 'BatchMode=yes', '-o', 'ControlMaster=no', '-o', 'ControlPath=none']


def write(path, value):
    with path.open('x') as f:
        json.dump(value, f, indent=2)
        f.write('\n')


def snapshot(path, remote=False):
    command = 'date -u +%FT%TZ; hostname; uptime; vmstat 1 5; cat /proc/stat'
    with path.open('x') as f:
        sp.run(SSH + [REMOTE, command] if remote else ['bash', '-c', command], stdout=f, stderr=sp.STDOUT, check=True)


def snapshots(out, name):
    with ThreadPoolExecutor(2) as pool:
        futures = [pool.submit(snapshot, out / f'{name}.{host}.txt', host == '450a') for host in ['450a','450b']]
        for future in futures:
            future.result()


def cells(mode):
    if mode == 'smoke':
        yield 'baseline', ['pg-execution','--connections','2','--runs','1']
        for v in ['k1','k2','k3p','k3']:
            yield v, ['pg-execution-network','--variant',v,'--connections','2','--runs','1']
        yield 'raw', ['raw','--writers','2','--counters','hot1','--runs','1']
        yield 'commit', ['model','--protocol','A','--batch','4','--counters','disjoint','--full-writes','--non-head-pct','30','--runs','1']
        return
    for c in [8,16,32,64,128]:
        yield f'exec-c{c}', ['pg-execution','--connections',str(c)]
    for v in ['k1','k2','k3p','k3']:
        for c in [32,64,128]:
            yield f'{v}-c{c}', ['pg-execution-network','--variant',v,'--connections',str(c)]
    for c in [32,64,128]:
        for keys in ['disjoint','hot1']:
            yield f'raw-c{c}-{keys}', ['raw','--writers',str(c),'--counters',keys]
    for pct in [0,10,30]:
        for n in [1,4,16,64]:
            yield f'commit-p{pct}-n{n}', ['model','--protocol','A','--batch',str(n),'--counters','disjoint','--full-writes','--non-head-pct',str(pct)]


class Run:
    def __init__(self, out, mode):
        self.out, self.mode = out, mode
        self.tunnels = []
        self.db = 'sb4_s1b_' + time.strftime('%Y%m%d_%H%M%S',time.gmtime()) + '_' + str(os.getpid())
        self.created = False
        self.base_port = int(os.environ.get('S1B_TUNNEL_BASE','62000'))
        pw = Path.home() / 'sb4bench/pw'
        assert stat.S_IMODE(pw.stat().st_mode) == 0o600
        self.env = dict(os.environ, PGPASSWORD=pw.read_text().strip(), PGUSER='postgres', PGHOST='127.0.0.1', PGPORT=str(self.base_port))
        self.env['LD_LIBRARY_PATH'] = str(Path.home() / 'tools/pg16/usr/lib/x86_64-linux-gnu')
        self.env['PGDATABASE'] = self.db
        self.env.setdefault('CP_WARMUP_MS','1000')
        self.env.setdefault('CP_MEASURE_MS','4000')
        if mode == 'smoke':
            self.env['CP_WARMUP_MS'], self.env['CP_MEASURE_MS'] = '100','400'

    def psql(self, sql, database='postgres'):
        return sp.run([str(PG_BIN/'psql'),'-X','-v','ON_ERROR_STOP=1','-d',database,'-Atc',sql], env=self.env, capture_output=True, text=True, check=True).stdout

    def start(self):
        write(self.out/'ownership.json', {'database':self.db,'client_host':'expo-build-450b','database_host':REMOTE,'mode':self.mode,
              'timing_ms':{'warmup':int(self.env['CP_WARMUP_MS']),'measure':int(self.env['CP_MEASURE_MS'])},
              'source_commit':sp.check_output(['git','rev-parse','HEAD'],text=True).strip(),
              'binary_sha256':hashlib.sha256(BIN.read_bytes()).hexdigest(),
              'harness_sha256':{str(p.relative_to(HERE)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(list((HERE/'src').glob('*.rs'))+[HERE/'Cargo.toml',HERE/'Cargo.lock',Path(__file__).resolve()])}})
        count = 16 if self.mode == 'smoke' else 144
        for i in range(count):
            port = self.base_port+i
            log = (self.out/f'tunnel-{port}.stderr').open('x')
            process = sp.Popen(SSH + ['-o','ExitOnForwardFailure=yes','-o','Compression=no','-N','-L',f'127.0.0.1:{port}:100.84.186.119:55433',REMOTE], stdin=sp.DEVNULL, stdout=sp.DEVNULL, stderr=log)
            self.tunnels.append((process,port,log))
            # Record ownership immediately, even if readiness fails.
            with (self.out/'tunnel-pids.jsonl').open('a') as f:
                f.write(json.dumps({'pid':process.pid,'port':port,'started':time.time()})+'\n')
            deadline = time.monotonic()+20
            while True:
                if process.poll() is not None:
                    raise RuntimeError(f'tunnel {port} exited {process.returncode}')
                try:
                    with socket.create_connection(('127.0.0.1',port),timeout=.1):
                        break
                except OSError:
                    if time.monotonic()>deadline:
                        raise RuntimeError(f'tunnel {port} readiness failed')
                    time.sleep(.02)
        self.env['CP_TUNNEL_PORTS'] = ','.join(str(port) for _,port,_ in self.tunnels)
        self.psql(f'CREATE DATABASE {self.db}')
        self.created = True
        (self.out/'postgres.txt').write_text(self.psql("SELECT version(); SELECT name,setting,unit FROM pg_settings WHERE name IN ('fsync','synchronous_commit','full_page_writes','shared_buffers','max_connections','wal_sync_method','commit_delay','statement_timeout','lock_timeout') ORDER BY name;",self.db))
        for host in ['450a','450b']:
            command = 'hostname; uname -a; lscpu; df -h; uptime'
            result = sp.run(SSH+[REMOTE,command] if host=='450a' else ['bash','-c',command],capture_output=True,text=True,check=True)
            (self.out/f'host-{host}.txt').write_text(result.stdout)
        (self.out/'toolchain.txt').write_text(sp.check_output(['rustc','--version'],cwd=HERE,text=True))

    def invoke(self, name, args):
        with (self.out/f'{name}.stdout').open('x') as stdout, (self.out/f'{name}.stderr').open('x') as stderr:
            process = sp.Popen([str(BIN)]+args+['--net','tunnels'],env=self.env,stdout=stdout,stderr=stderr)
            code = process.wait()
        try:
            result = json.loads((self.out/f'{name}.stdout').read_text())
        except ValueError:
            result = {'cell':'crashed'}
        record = {'args':args,'exit_status':code,'result':result}
        write(self.out/f'{name}.json',record)
        print(f'{name}: exit={code} cps={result.get("summary",{}).get("commits_per_s_median")}',flush=True)
        return record

    def block(self, name, args):
        snapshots(self.out,name+'.before')
        self.invoke(name+'.rtt-before',['ping','--n','1000'])
        # Record vmstat THROUGHOUT each block on both machines. Remote helper
        # owns its vmstat PID and stops it after our stdin newline/EOF.
        remote_code = "import subprocess,sys; p=subprocess.Popen(['vmstat','1']); print('vmstat_pid',p.pid,flush=True); sys.stdin.readline(); p.terminate(); p.wait()"
        monitors=[]
        for host in ['450a','450b']:
            f=(self.out/f'{name}.during.{host}.txt').open('x')
            cmd=SSH+[REMOTE,'python3 -u -c '+shlex.quote(remote_code)] if host=='450a' else ['python3','-u','-c',remote_code]
            p=sp.Popen(cmd,stdin=sp.PIPE,stdout=f,stderr=sp.STDOUT)
            monitors.append((p,f))
        records=[]
        try:
            if args[0] in ('model','ping') or self.mode=='smoke':
                records.append(self.invoke(name,args))
            else:
                for repeat in range(3):
                    records.append(self.invoke(f'{name}.r{repeat}',args+['--runs','1']))
        finally:
            for p,f in monitors:
                p.communicate(input=b'\n',timeout=15)
                f.close()
        self.invoke(name+'.rtt-after',['ping','--n','1000'])
        snapshots(self.out,name+'.after')
        write(self.out/f'{name}.block.json',{'records':[r['args'] for r in records], 'complete':all(r['exit_status']==0 for r in records)})

    def cleanup(self):
        cleanup={'database':self.db,'database_dropped':False,'tunnels':[]}
        try:
            if self.created:
                (self.out/'postgres-after.txt').write_text(self.psql("SELECT name,setting FROM pg_settings WHERE name IN ('fsync','synchronous_commit','full_page_writes','max_connections','shared_buffers','wal_sync_method','commit_delay') ORDER BY name;",self.db))
                self.psql(f'DROP DATABASE {self.db}')
                cleanup['database_dropped']=True
                cleanup['database_absent']=self.psql(f"SELECT count(*) FROM pg_database WHERE datname='{self.db}'").strip()=='0'
        finally:
            # Only PIDs captured from our Popen calls and persisted above.
            for process,port,log in self.tunnels:
                if process.poll() is None:
                    os.kill(process.pid,signal.SIGTERM)
                process.wait(timeout=15)
                cleanup['tunnels'].append({'pid':process.pid,'port':port,'exit_status':process.returncode})
                log.close()
            write(self.out/'cleanup.json',cleanup)
        print(f'cleanup: database_dropped={cleanup["database_dropped"]}, {len(self.tunnels)} recorded tunnel PIDs stopped',flush=True)


if __name__=='__main__':
    out=Path(sys.argv[1]).resolve()
    out.mkdir(exist_ok=False,parents=True)
    run=Run(out,sys.argv[2] if len(sys.argv)>2 else 'all')
    try:
        run.start()
        if run.mode != 'smoke':
            for i in range(3):
                run.block(f'rtt-{i}',['ping','--n','3000'])
        for name,args in cells(run.mode):
            run.block(name,args)
    finally:
        run.cleanup()
