#!/usr/bin/env python3
"""Final 20-round load check. Freeze executable identity as well as sources."""
import concurrent.futures, hashlib, json, pathlib, subprocess, sys, time

sb4 = pathlib.Path(__file__).resolve().parents[4]
out = sb4 / 'reports/20261007-fl-dry-run-flakes/round-8/evidence/final-load'
out.mkdir(exist_ok=True)
cpus = '80-87'
sources = list((sb4 / 'scripts').glob('test-*.mjs')) + [sb4 / 'scripts/run-client-tests.mjs']
sources += [sb4 / 'packages/snapback4/test' / f'{name}.test.mjs' for name in
            ['export-background', 'export-failure', 'export-native', 'export-publication',
             'schema-capability-refusals', 'test-processes', 'test-file-runner', 'test-signals']]
sources += list((sb4 / 'packages/snapback4/test/helpers').glob('*.mjs'))
def snapshot():
    binary = sb4 / 'target/debug/snapback4'
    stat = binary.stat()
    return dict(sourceHashes={str(p.relative_to(sb4)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sources},
                binary=dict(sha256=hashlib.sha256(binary.read_bytes()).hexdigest(),
                            device=stat.st_dev, inode=stat.st_ino, mtimeNs=stat.st_mtime_ns))
before = snapshot()
burners, results = [], []
started = time.time()
def run(job):
    number, kind = job
    groups = ['background'] if kind == 'background' else ['processes', 'parity', 'signals', 'failure', 'native', 'publication', 'schema']
    command = ['taskset', '-c', cpus, 'node', 'reports/20261007-fl-dry-run-flakes/round-8/reproduce/loaded-final-case.mjs', *groups]
    start = time.time()
    with (out / f'{kind}-{number:02}.log').open('w') as log:
        result = subprocess.run(command, cwd=sb4, stdout=log, stderr=subprocess.STDOUT)
    record = dict(round=number, group=kind, status=result.returncode, seconds=round(time.time()-start, 2))
    print(json.dumps(record), flush=True)
    return record
try:
    code = 'import os,sys,threading; threading.Thread(target=lambda: (sys.stdin.read(), os._exit(0)), daemon=True).start()\nwhile True: pass'
    for _ in range(8):
        burners.append(subprocess.Popen(['taskset', '-c', cpus, sys.executable, '-c', code], stdin=subprocess.PIPE))
    jobs = [(n, group) for n in range(1, 21) for group in ['background', 'other']]
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        for result in pool.map(run, jobs): results.append(result)
finally:
    for child in burners: child.stdin.close()
    for child in burners: child.wait()
    after = snapshot()
    summary = dict(cpus=cpus, busyLoops=8, concurrentJobs=8, loopPids=[p.pid for p in burners],
                   loopsReaped=all(p.returncode == 0 for p in burners), inputs=before,
                   inputsUnchanged=before == after, rounds=results, seconds=round(time.time()-started, 2))
    (out / 'summary.json').write_text(json.dumps(summary, indent=2)+'\n')
assert before == after, 'source or executable changed during load run'
assert len(results) == 40 and all(r['status'] == 0 for r in results), 'a loaded case failed'
