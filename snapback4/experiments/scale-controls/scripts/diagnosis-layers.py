#!/usr/bin/env python3
"""Run AFTER baseline finishes: engine, disk primitive, then local timing build.

All measurement subprocesses are detached and recorded. No cluster is touched.
The timing patch must already be locally applied using instrument-sqlite.py.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess as sp
import time

from run import HERE, APP_CORES, cpu_sample, write


def snapshot(path):
    import sqlite3
    with sqlite3.connect(f'file:{path}?mode=ro', uri=True) as c:
        def one(s): return c.execute(s).fetchone()[0]
        return dict(counter_sum=one("SELECT sum(json_extract(data,'$.Row.n.Int')) FROM r WHERE t=(SELECT t FROM r WHERE id='c0000' LIMIT 1)"),
                    commits=one('SELECT count(*) FROM _commits'), receipts=one('SELECT count(*) FROM _ops'),
                    sessions=one('SELECT count(*) FROM _sessions'),
                    maintained=one("SELECT sum(json_extract(data,'$.Row.total.Int')) FROM r WHERE t=(SELECT t FROM r WHERE id='r0000' LIMIT 1)"))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--out', required=True)
    p.add_argument('--fixture', required=True)
    p.add_argument('--baseline', required=True, help='baseline output with cleanup.json and done')
    args = p.parse_args()
    out = Path(args.out).resolve(); out.mkdir(parents=True, exist_ok=False)
    root = HERE.parents[1]
    tag=hashlib.sha256(str(out).encode()).hexdigest()[:16]
    runtime = HERE/'target'/f's1dx-layers-{tag}'; runtime.mkdir(mode=0o700, exist_ok=False)
    env = dict(os.environ, PATH=str(Path.home()/'.cargo/bin')+':'+os.environ['PATH'],
               CARGO_TARGET_DIR=str(root/'target/s1dx'), LIBSQLITE3_FLAGS='-USQLITE_ENABLE_MEMORY_MANAGEMENT')
    write(out/'ownership.json', dict(pid=os.getpid(),command=os.sys.argv,app_cores=APP_CORES,
        source_commit=sp.check_output(['git','rev-parse','HEAD'],text=True).strip()))
    children = []

    def run(label, cmd, cwd=HERE, extra=None):
        directory = out/label; directory.mkdir()
        stdout=(directory/'stdout').open('x'); stderr=(directory/'stderr').open('x')
        effective=dict(env, **(extra or {}))
        start=time.monotonic_ns()
        proc=sp.Popen(['setsid','nohup',*map(str,cmd)],cwd=cwd,env=effective,
                      stdin=sp.DEVNULL,stdout=stdout,stderr=stderr)
        children.append(proc)
        with (out/'pids.jsonl').open('a') as f:
            f.write(json.dumps(dict(pid=proc.pid,kind=label,command=list(map(str,cmd)),time=time.time()))+'\n')
        samples=[]
        try:
            while proc.poll() is None:
                samples.append(cpu_sample([proc.pid])); time.sleep(.25)
        finally:
            if proc.poll() is None: proc.terminate(); proc.wait(timeout=30)
            stdout.close(); stderr.close()
        write(directory/'process.json',dict(pid=proc.pid,status=proc.returncode,start_ns=start,end_ns=time.monotonic_ns(),samples=samples))
        if proc.returncode: raise RuntimeError(f'{label} exited {proc.returncode}: {stderr.name}')
        print(label,'done',flush=True)
        return directory

    try:
        while not ((Path(args.baseline)/'done').exists() and (Path(args.baseline)/'cleanup.json').exists()):
            exit_file=Path(args.baseline).parent/'bracket.exit'
            if exit_file.exists() and exit_file.read_text()!='0': raise RuntimeError('baseline failed')
            time.sleep(1)
        cleanup=json.loads((Path(args.baseline)/'cleanup.json').read_text())
        assert cleanup['still_running']==[]
        for binary in ['snapback4','sb4-sqlite-diagnosis-engine']:
            source=root/'target/s1dx/release'/binary
            write(out/(binary+'-baseline.json'),dict(sha256=hashlib.sha256(source.read_bytes()).hexdigest()))
        for rep in range(3):
            deployment=runtime/f'engine-{rep}'
            shutil.copytree(args.fixture, deployment)
            db=deployment/'store.sqlite'
            before=snapshot(db)
            directory=run(f'engine-r{rep}',['taskset','-c',APP_CORES,root/'target/s1dx/release/sb4-sqlite-diagnosis-engine',db,'10','20'])
            write(directory/'before.json',before); write(directory/'after.json',snapshot(db))
        library=runtime/'fsync-timing.so'
        run('build-interposer',['cc','-shared','-fPIC','-O2','-Wall','-Wextra','-Werror','-o',library,HERE/'scripts/fsync-timing.c','-ldl','-pthread'])
        for n in [1,16]:
            fsync=out/f'raw-batch-{n}-fsync.jsonl'
            run(f'raw-batch-{n}',['taskset','-c',APP_CORES,root/'target/s1dx/release/sb4-sqlite-diagnosis-engine',runtime/f'raw-{n}.sqlite','10','20','raw-batch',n],
                extra=dict(LD_PRELOAD=str(library),SB4_DX_FSYNC=str(fsync)))
        run('build-timing',['cargo','build','--release','--locked','-j','3'],cwd=root)
        trace=out/'traced'
        run('trace-run',['python3','scripts/diagnose-sqlite.py','--out',trace,'--fixture',args.fixture,
                        '--trace','--fsync-lib',library,'--rates','100','141','200','--repeats','1'])
        (out/'done').write_text('0\n')
    finally:
        for proc in children:
            if proc.poll() is None: proc.terminate(); proc.wait(timeout=30)
        write(out/'cleanup.json',dict(processes=[dict(pid=p.pid,status=p.returncode) for p in children],
                                     still_running=[p.pid for p in children if p.poll() is None]))


if __name__ == '__main__': main()
