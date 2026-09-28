"""Lane FL evidence runner; invoke from snapback4/. No shared-path writes."""
import concurrent.futures, hashlib, json, os, pathlib, subprocess, sys, time
typing_only = '--typing-only' in sys.argv
out = pathlib.Path('reports/20260928-fl-client-flakes') / next((arg.split('=', 1)[1] for arg in sys.argv if arg.startswith('--out=')), 'typing-final' if typing_only else 'repeated')
out.mkdir(exist_ok=True)
files = ['client-seams', 'ephemeral-keep', 'ephemeral-mock', 'keep-observation', 'client-lifecycle']
if typing_only: files = ['ephemeral-keep']
command = ['node', '--test', '--test-concurrency=95'] + [f'packages/snapback4/test/{name}.test.mjs' for name in files]
burners = []
results = []
started = time.time()
try:
    for _ in range(0 if typing_only else 32):
        burners.append(subprocess.Popen(['nice', '-n', '10', sys.executable, '-c', 'x = 1\nwhile True: x = (x * 1664525 + 1013904223) & 0xffffffff'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
    metadata = dict(command=command, files=files, repetitions=50, parallel_invocations=8, concurrency=95, burners=[p.pid for p in burners], started=started, load=os.getloadavg(), source_sha256={name:hashlib.sha256(pathlib.Path(f'packages/snapback4/test/{name}.test.mjs').read_bytes()).hexdigest() for name in files}, concurrent_burner_evidence='../repeated/metadata.json' if typing_only else None)
    (out / 'metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')
    def run(n):
        begin = time.time()
        with (out / f'{n:02d}.log').open('w') as log:
            result = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT)
        return dict(run=n, exit=result.returncode, seconds=round(time.time()-begin, 3))
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        for future in concurrent.futures.as_completed([pool.submit(run, n) for n in range(1, 51)]):
            result = future.result()
            results.append(result)
            (out / 'results.json').write_text(json.dumps(sorted(results, key=lambda x:x['run']), indent=2) + '\n')
            print(json.dumps(result), flush=True)
finally:
    for p in burners: p.terminate()
    for p in burners: p.wait()
    print(json.dumps(dict(completed=len(results), failures=sum(r['exit'] != 0 for r in results), seconds=round(time.time()-started, 3), burners_stopped=True)), flush=True)
sys.exit(any(r['exit'] != 0 for r in results))
