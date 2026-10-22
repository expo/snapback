#!/usr/bin/env python3
"""S1-DX: serial, detached W4 diagnosis; only owned subprocesses are stopped.

The baseline mode uses unchanged product and load binaries. Every trial starts
a new serve process. Sessions are minted once before the first warm-up.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess as sp
import time

import snapback
import run as common

HERE = common.HERE
ROOT = HERE.parents[1]
RATES = [100, 141, 200, 282, 400, 566, 800, 1131, 1600, 2262, 3200]


class Diagnosis(snapback.Snapback):
    def __init__(self, args):
        args.runtime_name='s1dx-'+hashlib.sha256(str(Path(args.out).resolve()).encode()).hexdigest()[:16]
        super().__init__(args)

    def snapshot(self):
        value = super().snapshot()
        with sqlite3.connect(f'file:{self.release}/store.sqlite?mode=ro', uri=True) as c:
            value['bookkeeping'] = {table: c.execute(f'SELECT count(*) FROM {table}').fetchone()[0]
                                    for table in ['_commits', '_ops', '_sessions', '_change_evidence']}
            value['last_commit'] = c.execute('SELECT seq,program,writes FROM _commits ORDER BY seq DESC LIMIT 1').fetchone()
        return value

    def cli(self, *args):
        command = [str(snapback.SB), *map(str, args)]
        p = sp.Popen(command, cwd=self.project, env=self.env,
                     stdin=sp.DEVNULL, stdout=sp.PIPE, stderr=sp.PIPE)
        with (self.out / 'pids.jsonl').open('a') as f:
            f.write(json.dumps(dict(pid=p.pid, kind='cli', command=command, time=time.time())) + '\n')
        out, err = p.communicate(timeout=180)
        if p.returncode:
            raise RuntimeError(f'CLI {args[0]} exited {p.returncode}: {err.decode()}')
        return out.decode()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--out', required=True)
    p.add_argument('--fixture', required=True)
    p.add_argument('--binary', default=str(ROOT/'target/s1dx/release/snapback4'))
    p.add_argument('--rates', type=int, nargs='+', default=RATES)
    p.add_argument('--repeats', type=int, default=3)
    p.add_argument('--warmup-ms', type=int, default=10000)
    p.add_argument('--duration-ms', type=int, default=20000)
    p.add_argument('--trace', action='store_true', help='local uncommitted timing build only')
    p.add_argument('--fsync-lib', help='optional diagnostic LD_PRELOAD interposer')
    args = p.parse_args()
    args.rows = 1000000
    snapback.SB = Path(args.binary).resolve()
    args.target = 'snapback'
    d = Diagnosis(args)
    try:
        d.start()
        shutil.copytree(args.fixture, d.release, symlinks=True)
        prep = d.out/'sessions-preminted'; prep.mkdir()
        d.start_service(32, 0, prep)
        d.stop_service()
        for rate in args.rates:
            for repeat in range(args.repeats):
                directory = d.out/f'rate-{rate}-rep-{repeat}'
                directory.mkdir()
                if args.trace:
                    d.env['SNAPBACK4_READ_TRACE'] = str(directory/'serve-trace.jsonl')
                    d.env['SB4_DX_TIMING'] = '1'
                    d.env['SB4_DX_SETTINGS'] = str(directory/'settings.jsonl')
                if args.fsync_lib:
                    d.env['LD_PRELOAD'] = str(Path(args.fsync_lib).resolve())
                    d.env['SB4_DX_FSYNC'] = str(directory/'fsync.jsonl')
                d.start_service(32, 0, directory)
                try:
                    result = d.trial(directory, 'W4', 32, 'disjoint', args.rows, rate, repeat)
                    common.write(directory/'result.json', result)
                finally:
                    d.stop_service()
        (d.out/'done').write_text('0\n')
    finally:
        d.close()


if __name__ == '__main__':
    main()
