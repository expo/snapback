"""Twenty runs of the signal gate and permanent barrier regressions on two contended CPUs."""
import hashlib, json, pathlib, subprocess, time
root = pathlib.Path.cwd()
out = root / 'reports/20261007-fl-dry-run-flakes/round-4/evidence'
sources = ['packages/snapback4/test/export-publication.test.mjs', 'packages/snapback4/test/publication-interposer.c', 'packages/snapback4/test/helpers/publication-barrier.mjs', 'packages/snapback4/test/test-processes.test.mjs', 'scripts/test-signals.mjs', 'scripts/test-process-identity.c']
hashes = lambda: {name: hashlib.sha256((root/name).read_bytes()).hexdigest() for name in sources}
before = hashes()
load, rounds = [], []
try:
    for _ in range(4):
        load.append(subprocess.Popen(['taskset', '-c', '80,81', 'python3', '-c', 'import os,sys,threading; threading.Thread(target=lambda: (sys.stdin.read(), os._exit(0)), daemon=True).start()\nwhile True: pass'], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
    print(json.dumps({'cpus': '80,81', 'ownedLoadPids': [p.pid for p in load]}), flush=True)
    with (out/'loaded-barriers.log').open('w') as log:
        for i in range(1,21):
            start = time.monotonic()
            result = subprocess.run(['taskset', '-c', '80,81', 'node', '--test', '--test-reporter=tap', '--test-name-pattern=publisher (before|after) barrier|every external test signal', 'packages/snapback4/test/export-publication.test.mjs', 'packages/snapback4/test/test-processes.test.mjs'], capture_output=True, text=True)
            row = {'round': i, 'exit': result.returncode, 'seconds': round(time.monotonic()-start,3)}
            rounds.append(row); print(json.dumps(row), flush=True)
            log.write(json.dumps(row)+'\n'+result.stdout+result.stderr+'\n'); log.flush()
            assert result.returncode == 0 and '# pass 3\n' in result.stdout, result.stdout+result.stderr
finally:
    for child in load: child.stdin.close()
    for child in load: child.wait()
    summary = {'cpus': '80,81', 'busyLoops': 4, 'sourceSha256': before, 'sourceUnchanged': before==hashes(), 'rounds': rounds, 'loadReaped': all(p.poll() is not None for p in load)}
    (out/'loaded-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
assert len(rounds)==20 and summary['sourceUnchanged'] and summary['loadReaped']
