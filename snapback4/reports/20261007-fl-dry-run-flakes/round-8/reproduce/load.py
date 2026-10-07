#!/usr/bin/env python3
"""Twenty repetitions of every changed runnable case; only owned pipes/children."""
import concurrent.futures, hashlib, json, os, pathlib, subprocess, sys, time

sb4 = pathlib.Path(__file__).resolve().parents[4]
out = sb4 / 'reports/20261007-fl-dry-run-flakes/round-8/evidence'
cpus = '80-87'
sources = list((sb4 / 'scripts').glob('test-*.mjs')) + [sb4 / 'scripts/run-client-tests.mjs']
sources += [sb4 / 'packages/snapback4/test' / f'{name}.test.mjs' for name in
            ['export-background', 'export-failure', 'test-processes', 'test-file-runner', 'test-signals']]
sources += list((sb4 / 'packages/snapback4/test/helpers').glob('fixture-*.mjs'))
def digests():
    return {str(p.relative_to(sb4)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sources}
before = digests()
burners, results = [], []
started = time.time()
def run(job):
    number, kind = job
    groups = ['background'] if kind == 'background' else ['processes', 'parity', 'signals', 'failure']
    command = ['taskset', '-c', cpus, 'node', 'reports/20261007-fl-dry-run-flakes/round-8/reproduce/loaded-case.mjs', *groups]
    start = time.time()
    with (out / f'loaded-{kind}-{number:02}.log').open('w') as log:
        result = subprocess.run(command, cwd=sb4, stdout=log, stderr=subprocess.STDOUT)
    record = dict(round=number, group=kind, status=result.returncode, seconds=round(time.time()-start, 2))
    print(json.dumps(record), flush=True)
    return record
try:
    code = 'import os,sys,threading; threading.Thread(target=lambda: (sys.stdin.read(), os._exit(0)), daemon=True).start()\nwhile True: pass'
    for _ in range(8):
        burners.append(subprocess.Popen(['taskset', '-c', cpus, sys.executable, '-c', code], stdin=subprocess.PIPE))
    jobs = [(n, group) for n in range(1, 21) for group in ['background', 'other']]
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for result in pool.map(run, jobs):
            results.append(result)
finally:
    for child in burners: child.stdin.close()
    for child in burners: child.wait()
    after = digests()
    summary = dict(cpus=cpus, busyLoops=8, concurrentJobs=4, loopPids=[p.pid for p in burners],
                   loopsReaped=all(p.returncode == 0 for p in burners), sourceHashes=before,
                   sourcesUnchanged=before == after, rounds=results, seconds=round(time.time()-started, 2))
    (out / 'loaded-summary.json').write_text(json.dumps(summary, indent=2)+'\n')
assert before == after, 'sources changed during load run'
assert len(results) == 40 and all(r['status'] == 0 for r in results), 'a loaded case failed'
