import gzip, json, os, pathlib, re, signal, subprocess, sys, time
out = pathlib.Path('target/lane-dc-round15')
cpus = sorted(os.sched_getaffinity(0))[-4:]
os.sched_setaffinity(0, cpus)
workers = []
summary = {'cpus': cpus, 'load_workers': 8, 'node': subprocess.check_output(['node', '--version'], text=True).strip(), 'groups': []}
started = time.time()
try:
    for _ in range(summary['load_workers']):
        workers.append(subprocess.Popen([sys.executable, '-c', 'while True: pass'], cwd=os.getcwd()))
    summary['worker_pids'] = [p.pid for p in workers]
    print(json.dumps({'load_started': summary}), flush=True)
    with (out / 'repetitions.jsonl').open('w') as results, gzip.open(out / 'repetitions.log.gz', 'wt') as logs:
        for name, count, pattern in [
            ('delivery', 200, None),
            ('generation-viewer', 100, '^generation and viewer fences reject callbacks$'),
            ('serial-gate', 100, '^a pre-transport serial gate race spends no retry and keeps its persisted id$'),
        ]:
            group = {'name': name, 'requested': count, 'pass': 0, 'fail': 0, 'tests_passed': 0, 'tests_failed': 0}
            summary['groups'].append(group)
            for run in range(1, count + 1):
                cmd = ['node', '--test', '--test-reporter=tap']
                if pattern: cmd.append('--test-name-pattern=' + pattern)
                cmd.append('packages/snapback4/test/delivery.test.mjs')
                begin = time.time()
                try:
                    done = subprocess.run(cmd, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=60)
                    code, output = done.returncode, done.stdout
                except subprocess.TimeoutExpired as e:
                    code, output = 124, str(e.stdout)
                totals = {key: int(value) for key, value in re.findall(r'^# (tests|pass|fail|cancelled|skipped) (\d+)$', output, re.M)}
                record = {'group': name, 'run': run, 'exit': code, 'seconds': round(time.time()-begin, 3), **totals}
                results.write(json.dumps(record)+'\n'); results.flush()
                logs.write(f'\n=== {name} {run} ===\n'+output); logs.flush()
                group['pass' if code == 0 else 'fail'] += 1
                group['tests_passed'] += totals.get('pass', 0)
                group['tests_failed'] += totals.get('fail', 0)
                if code: print(json.dumps({'failure': record, 'output': output}), flush=True)
                if run % 25 == 0: print(json.dumps(group), flush=True)
    summary['load_cpu_seconds'] = []
    for p in workers:
        stat = pathlib.Path(f'/proc/{p.pid}/stat').read_text().split()
        summary['load_cpu_seconds'].append((int(stat[13])+int(stat[14]))/os.sysconf('SC_CLK_TCK'))
finally:
    for p in workers:
        p.terminate()
    for p in workers:
        try: p.wait(timeout=5)
        except subprocess.TimeoutExpired:
            p.kill(); p.wait()
    summary['workers_reaped'] = all(p.returncode is not None for p in workers)
    summary['seconds'] = round(time.time()-started, 3)
    (out / 'repetitions.json').write_text(json.dumps(summary, indent=2)+'\n')
    print(json.dumps(summary), flush=True)
sys.exit(any(g['fail'] for g in summary['groups']))
