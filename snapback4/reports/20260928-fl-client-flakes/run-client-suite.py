"""Mirror test.sh's client phase and serial models, without running test.sh."""
import json, os, pathlib, subprocess, time
out = pathlib.Path('reports/20260928-fl-client-flakes')
# Let the independently requested loaded repetitions finish first.
for log in ['repeat-driver.log', 'typing-qualified-driver.log']:
    while not (out / log).exists() or '"burners_stopped": true' not in (out / log).read_text():
        time.sleep(1)
files = sorted(pathlib.Path('packages/snapback4/test').glob('*.test.mjs'))
models = ['app-session-model', 'online-client-model']
heavy = ['acquisition', 'server-e2e']
serial = os.getloadavg()[0] >= os.cpu_count()
commands = []
regular = [str(p) for p in files if p.stem[:-5] not in models + ([] if serial else heavy)]
commands.append(('client-tests', ['node', '--test', f'--test-concurrency={1 if serial else 95}', *regular], {}))
if not serial:
    for name, count in [('acquisition', 4), ('server-e2e', 3)]:
        for shard in range(count):
            commands.append((f'{name}-{shard}', ['node', '--test', f'packages/snapback4/test/{name}.test.mjs'], {'SNAPBACK4_TEST_SHARD': f'{shard}/{count}'}))
(out / 'client-commands.json').write_text(json.dumps(dict(serial=serial, load=os.getloadavg(), commands=commands), indent=2) + '\n')
children, results = [], []
for name, command, extra in commands:
    log = (out / f'{name}.log').open('w')
    child = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT, env={**os.environ, **extra})
    children.append((name, child, log))
print(json.dumps(dict(started=[dict(name=name, pid=child.pid) for name, child, _ in children])), flush=True)
for name, child, log in children:
    status = child.wait(); log.close()
    results.append(dict(name=name, exit=status)); print(json.dumps(results[-1]), flush=True)
command = ['node', '--test', '--test-concurrency=1'] + [f'packages/snapback4/test/{name}.test.mjs' for name in models]
with (out / 'client-models.log').open('w') as log:
    status = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT).returncode
results.append(dict(name='client-models', exit=status)); print(json.dumps(results[-1]), flush=True)
(out / 'client-results.json').write_text(json.dumps(results, indent=2) + '\n')
raise SystemExit(any(r['exit'] for r in results))
