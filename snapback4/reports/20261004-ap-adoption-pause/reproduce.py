#!/usr/bin/env python3
"""Replay persisted definitions, never opening the evidence itself with SQLite.
Usage: reproduce.py EVIDENCE_STORE BASELINE_HELPER CANDIDATE_HELPER CPU OUTPUT_DIR
Build both helpers with --profile production and publication's SQLite flags.
OUTPUT_DIR must not exist. Temporary copies are removed even after failure.
"""
import json
import pathlib
import resource
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time

assert len(sys.argv) == 6, __doc__
source, before, after = (pathlib.Path(p).resolve() for p in sys.argv[1:4])
cpu, output = sys.argv[4], pathlib.Path(sys.argv[5]).resolve()
output.mkdir()
now = 1791050894344  # Calibration #30's activation commit, not wall clock.
with tempfile.TemporaryDirectory(prefix='ap-adoption-', dir=output) as tmp:
    scratch = pathlib.Path(tmp)
    restored = scratch / 'restored.sqlite'
    shutil.copyfile(source, restored)
    wal = pathlib.Path(str(source) + '-wal')
    if wal.exists():
        shutil.copyfile(wal, str(restored) + '-wal')
    with sqlite3.connect(restored) as db:
        db.execute('PRAGMA wal_checkpoint(TRUNCATE)').fetchall()
        for generation in (1, 2):
            schema, programs = db.execute(
                'SELECT schema,programs FROM _generations WHERE generation=?',
                [generation]).fetchone()
            (scratch / f'g{generation}-schema.json').write_text(schema)
            (scratch / f'g{generation}-programs.json').write_text(programs)
    db.close()
    # Engine::open_at upgrades retained definitions if required; adopt_at then
    # rolls back to the persisted g1 definitions. This does not rewind the log.
    def run(binary, store, generation):
        return subprocess.run([
            'taskset', '-c', cpu, str(binary), str(store),
            str(scratch / f'g{generation}-schema.json'),
            str(scratch / f'g{generation}-programs.json'), str(now)],
            check=True, capture_output=True, text=True)
    rollback = run(before, restored, 1)
    (output / 'rollback.json').write_text(rollback.stdout)
    # No token, owner, lock, or SHM file is copied from the evidence.
    with (output / 'timings.jsonl').open('w') as timings:
        for repeat in range(3):
            for kind, binary in [('before', before), ('after', after)]:
                store = scratch / f'{kind}.sqlite'
                shutil.copyfile(restored, store)
                usage = resource.getrusage(resource.RUSAGE_CHILDREN)
                start = time.monotonic()
                result = run(binary, store, 2)
                elapsed = time.monotonic() - start
                used = resource.getrusage(resource.RUSAGE_CHILDREN)
                sample = json.loads(result.stdout)
                sample.update(kind=kind, repeat=repeat, cpu=int(cpu),
                              process_wall_s=elapsed,
                              user_s=used.ru_utime - usage.ru_utime,
                              system_s=used.ru_stime - usage.ru_stime)
                timings.write(json.dumps(sample) + '\n')
                timings.flush()
                (output / f'{kind}-{repeat}.txt').write_text(result.stderr)
    subprocess.run([sys.executable, str(pathlib.Path(__file__).with_name('compare.py')),
                    str(scratch / 'before.sqlite'), str(scratch / 'after.sqlite'),
                    str(output / 'equivalence.json')], check=True)
