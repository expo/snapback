import datetime, json, os, pathlib, subprocess, sys
root = pathlib.Path(__file__).resolve().parent
name, *command = sys.argv[1:]
env = dict(os.environ, PATH='/Users/ccheever/.volta/tools/image/node/24.18.0/bin:' + os.environ['PATH'], CARGO_INCREMENTAL='0', CARGO_PROFILE_DEV_DEBUG='0', CARGO_PROFILE_TEST_DEBUG='0')
log = root/'logs'/f'{name}.log'
with log.open('w') as output:
    result = subprocess.run(command, env=env, stdout=output, stderr=subprocess.STDOUT)
lines = log.read_text().splitlines()
summary = [line for line in lines if line.startswith(('test result:', 'ℹ tests', 'ℹ suites', 'ℹ pass', 'ℹ fail', 'ℹ cancelled', 'ℹ skipped', 'ℹ todo', 'ℹ duration_ms', '    Finished', '$ ', 'guide api', 'await seal:', 'split '))]
if not summary: summary = lines[-15:]
record = dict(name=name, command=command, exit=result.returncode, summary=summary, log=str(log.relative_to(root)), finished=datetime.datetime.now(datetime.timezone.utc).isoformat())
with (root/'commands.jsonl').open('a') as out: out.write(json.dumps(record)+'\n')
print(json.dumps(record,ensure_ascii=False),flush=True)
if result.returncode: print('\n'.join(lines[-25:]),flush=True)
sys.exit(result.returncode)
