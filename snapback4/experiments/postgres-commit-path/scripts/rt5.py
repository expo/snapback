#!/usr/bin/env python3
"""RT5 cells in the existing commit-path harness; no server configuration changes.

Creates only per-process rt5_bench_<pid> schemas, removed by completed cells.
Passwords never enter argv or artifacts. See README for exact fleet commands.
"""
import argparse
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import socket
import statistics
import subprocess as sp
import time

HERE = Path(__file__).resolve().parent.parent

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('out',type=Path)
    p.add_argument('--target',required=True,help='host:port as seen by client, or SSH host')
    p.add_argument('--password-file',type=Path)
    p.add_argument('--user',default='postgres')
    p.add_argument('--database',default='postgres')
    p.add_argument('--binary',type=Path,default=Path(os.environ.get('CARGO_TARGET_DIR',HERE/'target'))/'release/snapback4-postgres-commit-path')
    p.add_argument('--loopback-smoke',action='store_true')
    p.add_argument('--ssh',help='one SSH stream per physical connection, as in S1b')
    p.add_argument('--tunnel-base',type=int,default=62200)
    a=p.parse_args()
    host,port=a.target.rsplit(':',1);port=int(port)
    if a.loopback_smoke:
        assert not a.ssh and ipaddress.ip_address(host).is_loopback,'smoke must stay on loopback'
    else:
        assert a.password_file,'qualifying path requires an explicit mode-600 password file'
    if a.ssh:
        assert a.user=='postgres','the shared S1b tunnel allocator uses postgres'
    password=''
    if a.password_file:
        assert a.password_file.stat().st_mode & 0o777 == 0o600
        password=a.password_file.read_text().strip()
    assert os.statvfs('/home').f_bavail*os.statvfs('/home').f_frsize>=20_000_000_000,'less than 20 GB free'
    a.out.mkdir(parents=True,exist_ok=False)
    binary=a.binary.resolve(strict=True)
    env=dict(os.environ,CP_WARMUP_MS='1000',CP_MEASURE_MS='4000',PGPASSWORD=password,PGDATABASE=a.database)
    children=[];tunnels=[]
    def record(value):
        with (a.out/'pids.jsonl').open('a') as f:f.write(json.dumps(value)+'\n')
    record({'runner_pid':os.getpid(),'started':time.time()})
    def launch(cmd,**kwargs):
        proc=sp.Popen(cmd,**kwargs);children.append(proc)
        record({'pid':proc.pid,'argv':list(map(str,cmd)),'started':time.time()})
        return proc
    def quote(s):return "'"+s.replace('\\','\\\\').replace("'","\\'")+"'"
    def save(name,value):(a.out/name).write_text(json.dumps(value,indent=2)+'\n')
    save('ownership.json',{'label':'NON-QUALIFYING LOOPBACK SMOKE' if a.loopback_smoke else 'Hetzner-path flight mechanism statement model',
        'target':a.target,'ssh':a.ssh,'C':32,'reps':3,'warmup_ms':1000,'measure_ms':4000,'transport':'SSH per connection' if a.ssh else 'direct TCP',
        'source_commit':sp.check_output(['git','rev-parse','HEAD'],text=True).strip(),'source_dirty':bool(sp.check_output(['git','status','--porcelain'],text=True)),
        'binary_sha256':hashlib.sha256(binary.read_bytes()).hexdigest(),
        'source_sha256':{str(f.relative_to(HERE)):hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted((HERE/'src').glob('*.rs'))},
        'encoder_sha256':hashlib.sha256((HERE/'../../crates/snapback4-core/src/engine/postgres/literal.rs').read_bytes()).hexdigest()})
    def invoke(name,args):
        assert os.statvfs('/home').f_bavail*os.statvfs('/home').f_frsize>=20_000_000_000,'less than 20 GB free'
        with (a.out/(name+'.stdout')).open('w') as out,(a.out/(name+'.stderr')).open('w') as err:
            proc=launch([str(binary),*args,'--net','tunnels' if a.ssh else 'rt5-external'],env=env,stdout=out,stderr=err)
            status=proc.wait()
        record({'pid':proc.pid,'exit_status':status,'stopped':True})
        result=json.loads((a.out/(name+'.stdout')).read_text())
        save(name+'.json',{'exit_status':status,'result':result})
        assert status==0,(name,status)
        return result
    complete=False
    try:
        if a.ssh:
            for i in range(64):
                local=a.tunnel_base+i
                log=(a.out/f'tunnel-{local}.stderr').open('w')
                cmd=['ssh','-o','BatchMode=yes','-o','ControlMaster=no','-o','ControlPath=none','-o','ExitOnForwardFailure=yes','-o','Compression=no','-N','-L',f'127.0.0.1:{local}:{host}:{port}',a.ssh]
                proc=launch(cmd,stdin=sp.DEVNULL,stdout=sp.DEVNULL,stderr=log);tunnels.append((proc,log))
                deadline=time.monotonic()+20
                while True:
                    assert proc.poll() is None,'tunnel exited'
                    try:
                        with socket.create_connection(('127.0.0.1',local),timeout=.1):break
                    except OSError:
                        if time.monotonic()>deadline:raise RuntimeError('tunnel readiness timeout')
                        time.sleep(.02)
            env['CP_TUNNEL_PORTS']=','.join(str(a.tunnel_base+i) for i in range(64))
        else:
            dsn=f'host={quote(host)} port={port} user={quote(a.user)} dbname={quote(a.database)} password={quote(password)} connect_timeout=10'
            env['RT5_CONNECTION']=dsn;env['PG_UNIX_URL']=dsn
        for rep in range(3):invoke(f'ping-{rep}',['ping','--n','3000'])
        tables=[]
        for shape in ['w1','mutation']:
            for variant in ['serial','simple','envelope']:
                stem=f'{shape}-{variant}'
                invoke(stem+'-rtt-before',['ping','--n','1000'])
                runs=[]
                for rep in range(3):
                    r=invoke(f'{stem}-{rep}',['rt5-flight','--shape',shape,'--variant',variant,'--connections','32','--runs','1'])
                    assert r['counter_check']['ok'] and r['schema_dropped']
                    runs.append(r)
                invoke(stem+'-rtt-after',['ping','--n','1000'])
                table={'shape':shape,'variant':variant,'executions_per_s_median':statistics.median(r['runs'][0]['commits_per_s'] for r in runs),
                    'p50_ms_median':statistics.median(r['runs'][0]['p50_ms'] for r in runs),
                    'p99_ms_median':statistics.median(r['runs'][0]['p99_ms'] for r in runs),
                    'p99_ms_worst':max(r['runs'][0]['p99_ms'] for r in runs),
                    'flights':runs[0]['runs'][0]['calls_per_op'],'all_correct':True}
                tables.append(table);print(json.dumps(table),flush=True)
        save('summary.json',tables);complete=True
    finally:
        for proc,log in tunnels:
            if proc.poll() is None:proc.terminate()
            proc.wait(timeout=15);log.close();record({'pid':proc.pid,'stopped':True,'exit_status':proc.returncode})
        # All cell processes were waited; signal only owned PIDs if interrupted.
        for proc in children:
            if proc.poll() is None:proc.terminate();proc.wait(timeout=15)
        save('cleanup.json',{'complete':complete,'all_recorded_children_stopped':all(c.poll() is not None for c in children),'children':len(children),'tunnels':len(tunnels),
            'schemas_removed_by_completed_cells':complete,'pids_left':[] if all(c.poll() is not None for c in children) else [c.pid for c in children if c.poll() is None]})

if __name__=='__main__':main()
