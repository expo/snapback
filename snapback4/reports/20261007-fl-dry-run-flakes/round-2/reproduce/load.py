"""Twenty real recovery/observation replays under two-CPU contention. Run in snapback4/."""
import hashlib
import json
import pathlib
import subprocess
import time

out = pathlib.Path('reports/20261007-fl-dry-run-flakes/round-2/evidence')
script = 'reports/20261007-fl-dry-run-flakes/round-2/reproduce/simulator-cleanup.mjs'
source = pathlib.Path('packages/snapback4/test/export-background.test.mjs')
digest = hashlib.sha256(source.read_bytes()).hexdigest()
cpus = '80,81'
load, rounds = [], []
try:
    for _ in range(4):
        load.append(subprocess.Popen(['taskset', '-c', cpus, 'python3', '-c', 'while True: pass'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
    print(json.dumps({'cpus': cpus, 'ownedLoadPids': [p.pid for p in load]}), flush=True)
    for i in range(1, 21):
        started = time.monotonic()
        run = subprocess.run(['taskset', '-c', cpus, 'node', script], capture_output=True, text=True)
        (out / f'loaded-{i:02}.json').write_text(run.stdout)
        (out / f'loaded-{i:02}.stderr').write_text(run.stderr)
        row = {'round': i, 'exit': run.returncode, 'seconds': round(time.monotonic() - started, 3)}
        rounds.append(row)
        print(json.dumps(row), flush=True)
        if run.returncode:
            raise RuntimeError(run.stderr)
finally:
    for child in load:
        child.terminate()
    for child in load:
        child.wait()
    summary = {'cpus': cpus, 'busyLoops': 4, 'sourceSha256': digest,
               'sourceUnchanged': hashlib.sha256(source.read_bytes()).hexdigest() == digest,
               'rounds': rounds, 'loadReaped': all(p.poll() is not None for p in load)}
    (out / 'loaded-summary.json').write_text(json.dumps(summary, indent=2) + '\n')
assert len(rounds) == 20 and summary['sourceUnchanged'] and summary['loadReaped']
