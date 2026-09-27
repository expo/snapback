import concurrent.futures, json, os, pathlib, subprocess, sys, time
label, file, pattern, count = sys.argv[1:]
root = pathlib.Path('target/lane-fx-evidence')
cpus = sorted(os.sched_getaffinity(0))[:8]
workers = [subprocess.Popen([sys.executable, '-c', 'while True: pass']) for _ in cpus]
for worker in workers: os.sched_setaffinity(worker.pid, cpus)
def run(i):
    path = root / f'{label}-{i:02}.log'
    start = time.monotonic()
    with path.open('w') as log:
        child = subprocess.Popen(['node', '--test', '--test-name-pattern='+pattern, file], stdout=log, stderr=subprocess.STDOUT)
        os.sched_setaffinity(child.pid, cpus)
        try: status = child.wait(timeout=150)
        except subprocess.TimeoutExpired: child.terminate(); status = child.wait(timeout=10)
    return dict(run=i, exit=status, seconds=round(time.monotonic()-start, 3), log=str(path))
try:
    rows = []
    for offset in range(0, int(count), 5):
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
            batch = list(pool.map(run, range(offset, min(offset+5,int(count)))))
            rows += batch
            print(json.dumps(batch), flush=True)
    (root / f'{label}.json').write_text(json.dumps(dict(cpus=cpus, load=os.getloadavg(), workers=len(workers), runs=rows), indent=2)+'\n')
finally:
    for worker in workers: worker.terminate()
    for worker in workers: worker.wait()
