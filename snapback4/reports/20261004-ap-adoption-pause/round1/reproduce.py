#!/usr/bin/env python3
"""Usage: reproduce.py EVIDENCE_STORE BASELINE ROUND0 CANDIDATE CPU SCRATCH OUTPUT
Only copies of EVIDENCE_STORE and its WAL are opened with SQLite. SCRATCH must
exist; OUTPUT must not. All private databases are deleted on exit, even on error.
"""
import hashlib
import json
import os
import pathlib
import resource
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time

assert len(sys.argv) == 8, __doc__
source, baseline, round0, candidate = [pathlib.Path(p).resolve() for p in sys.argv[1:5]]
cpu = int(sys.argv[5])
scratch, output = [pathlib.Path(p).resolve() for p in sys.argv[6:8]]
output.mkdir()
now = 1791050894344
compare = pathlib.Path(__file__).resolve().parents[1] / 'compare.py'


def quiet_slice():
    siblings = pathlib.Path(f'/sys/devices/system/cpu/cpu{cpu}/topology/thread_siblings_list').read_text().strip()
    assert all('-' not in part for part in siblings.split(',')), siblings
    names = {'cpu' + part for part in siblings.split(',')}

    def counters():
        result = {}
        for line in pathlib.Path('/proc/stat').read_text().splitlines():
            fields = line.split()
            if fields[0] in names:
                values = list(map(int, fields[1:9]))
                result[fields[0]] = (sum(values), values[3] + values[4])
        return result

    for _ in range(300):
        before = counters()
        time.sleep(1)
        after = counters()
        idle = {name: (after[name][1] - before[name][1]) / max(1, after[name][0] - before[name][0]) for name in names}
        if all(value >= .95 for value in idle.values()):
            return idle
    raise RuntimeError(f'CPU {cpu} and sibling did not become quiet: {idle}')


def fingerprint(path):
    db = sqlite3.connect(f'file:{path}?mode=ro', uri=True)
    result = {}
    for table in ['r', 'i', '_catalog', '_log', '_commits', '_meta', '_generations']:
        width = len(db.execute('pragma table_info(' + table + ')').fetchall())
        digest, count = hashlib.sha256(), 0
        for row in db.execute('select * from ' + table + ' order by ' + ','.join(str(i + 1) for i in range(width))):
            digest.update(repr(row).encode() + b'\n')
            count += 1
        result[table] = {'rows': count, 'sha256': digest.hexdigest()}
    db.close()
    return result


with tempfile.TemporaryDirectory(prefix='ap-r1-', dir=scratch) as directory:
    private = pathlib.Path(directory)
    restored = private / 'g1.sqlite'
    shutil.copyfile(source, restored)
    wal = pathlib.Path(str(source) + '-wal')
    if wal.exists():
        shutil.copyfile(wal, str(restored) + '-wal')
    db = sqlite3.connect(restored)
    db.execute('pragma wal_checkpoint(TRUNCATE)').fetchall()
    for generation in [1, 2]:
        schema, programs = db.execute('select schema,programs from _generations where generation=?', [generation]).fetchone()
        (private / f'g{generation}-schema.json').write_text(schema)
        (private / f'g{generation}-programs.json').write_text(programs)
    db.close()

    def run(binary, store, generation=2, memory=None, cache=64):
        env = dict(os.environ, SNAPBACK4_ADOPTION_CACHE_MIB=str(cache))
        env.pop('AP_CACHE_KIB', None)

        def limit():
            resource.setrlimit(resource.RLIMIT_AS, (memory * 1024 * 1024,) * 2)

        usage = resource.getrusage(resource.RUSAGE_CHILDREN)
        start = time.monotonic()
        result = subprocess.run([
            '/usr/bin/time', '-f', '%M', '-o', str(private / 'rss.txt'),
            'taskset', '-c', str(cpu), str(binary), str(store),
            str(private / f'g{generation}-schema.json'), str(private / f'g{generation}-programs.json'), str(now)
        ], env=env, preexec_fn=limit if memory else None, capture_output=True, text=True)
        used = resource.getrusage(resource.RUSAGE_CHILDREN)
        sample = dict(returncode=result.returncode, process_wall_s=time.monotonic() - start,
                      user_s=used.ru_utime - usage.ru_utime, system_s=used.ru_stime - usage.ru_stime,
                      rss_kib=int((private / 'rss.txt').read_text().splitlines()[-1]), cpu=cpu)
        if result.returncode == 0:
            sample.update(json.loads(result.stdout))
        else:
            sample['stdout'] = result.stdout
        return sample, result.stderr

    rollback, stderr = run(baseline, restored, 1)
    assert rollback['returncode'] == 0, stderr
    (output / 'rollback.json').write_text(json.dumps(rollback, indent=2) + '\n')
    stores = {name: private / f'{name}.sqlite' for name in ['before', 'after']}
    with (output / 'timings.jsonl').open('w') as results:
        for repeat in range(3):
            for kind, binary in [('before', baseline), ('after', candidate)]:
                shutil.copyfile(restored, stores[kind])
                idle = quiet_slice()
                sample, stderr = run(binary, stores[kind])
                assert sample['returncode'] == 0, stderr
                sample.update(kind=kind, repeat=repeat, preceding_idle_fraction=idle)
                results.write(json.dumps(sample) + '\n')
                results.flush()
                (output / f'{kind}-{repeat}.txt').write_text(stderr)
                print(kind, repeat, round(sample['total_ms'], 3), 'ms', sample['rss_kib'], 'KiB', flush=True)
    subprocess.run([sys.executable, str(compare), str(stores['before']), str(stores['after']), str(output / 'equivalence.json')], check=True)
    memory_results = {}
    for kind, binary, cache in [('baseline', baseline, 64), ('round0', round0, 64), ('candidate', candidate, 64), ('candidate-opt-out', candidate, 0)]:
        store = private / 'memory.sqlite'
        for suffix in ['', '-wal', '-shm']:
            pathlib.Path(str(store) + suffix).unlink(missing_ok=True)
        shutil.copyfile(restored, store)
        before = fingerprint(store) if kind == 'round0' else None
        sample, stderr = run(binary, store, memory=96, cache=cache)
        sample.update(rlimit_as_mib=96, cache_mib=cache, stderr=stderr)
        if sample['returncode'] == 0:
            subprocess.run([sys.executable, str(compare), str(stores['before']), str(store), str(output / f'memory-{kind}-equivalence.json')], check=True)
            sample['equivalent'] = True
        elif before is not None:
            sample['rollback_equal'] = before == fingerprint(store)
        memory_results[kind] = sample
        (output / 'memory.json').write_text(json.dumps(memory_results, indent=2) + '\n')
        print('memory', kind, sample['returncode'], sample.get('total_ms'), sample['rss_kib'], flush=True)
    assert memory_results['round0']['returncode'] != 0 and memory_results['round0']['rollback_equal']
    assert all(memory_results[k]['returncode'] == 0 for k in ['baseline', 'candidate', 'candidate-opt-out'])
