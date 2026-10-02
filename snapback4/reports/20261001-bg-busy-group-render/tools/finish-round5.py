"""Run the full suite exactly once, then measure saved variants without build overlap."""
from pathlib import Path
import datetime, hashlib, json, os, platform, subprocess

root = Path(__file__).resolve().parents[3]
repo = root.parent
tools = Path(__file__).resolve().parent
report = tools.parent / 'round5'
env = {**os.environ, 'LIBSQLITE3_FLAGS': '-USQLITE_ENABLE_MEMORY_MANAGEMENT'}

def run(name, args, check=True):
    print('START', name, flush=True)
    with (report / (name + '.log')).open('w') as out:
        result = subprocess.run(args, cwd=root, env=env, stdout=out, stderr=subprocess.STDOUT)
    (report / (name + '.exit')).write_text(str(result.returncode) + '\n')
    print('END', name, result.returncode, flush=True)
    if check and result.returncode: raise SystemExit(result.returncode)
    return result.returncode

assert 'READY:' in (report / 'prepare.log').read_text()
snapshot = json.loads((report / 'final-source.json').read_text())
for path, digest in snapshot['files'].items():
    assert hashlib.sha256((repo / path).read_bytes()).hexdigest() == digest, path
for path in subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard', 'snapback4/crates', 'snapback4/packages'], cwd=repo, text=True).splitlines():
    snapshot['files'][path] = hashlib.sha256((repo / path).read_bytes()).hexdigest()
snapshot['captured'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
(report / 'final-source.json').write_text(json.dumps(snapshot, indent=2) + '\n')
def wasm(path):
    return {'raw_bytes': path.stat().st_size, 'gzip_bytes': len(subprocess.check_output(['gzip', '-9', '-c', str(path)])), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
wasm_path = root / 'packages/snapback4/src/wasm/snapback4_device_bg.wasm'
measurement = wasm(wasm_path)
(report / 'wasm.json').write_text(json.dumps({'round2': wasm(root / 'target/bg-round5-artifacts/base-dist/wasm/snapback4_device_bg.wasm'), 'round4': wasm(root / 'target/bg-round4-artifacts/candidate-dist/wasm/snapback4_device_bg.wasm'), 'candidate': measurement, 'branch_ratchet': 605225, 'main_budget_informational': 610782, 'gzip_method': 'gzip -9 -c FILE'}, indent=2) + '\n')
versions = {name: subprocess.check_output(args, text=True).strip() for name, args in [('rustc', ['rustc', '-vV']), ('wasm_bindgen', ['wasm-bindgen', '--version']), ('bun', ['bun', '--version']), ('node', ['node', '--version'])]}
versions.update({'platform': platform.platform(), 'affinity_cpus': len(os.sched_getaffinity(0)), 'server_build_env': {'LIBSQLITE3_FLAGS': env['LIBSQLITE3_FLAGS']}, 'round2_commit': 'fcc4b644f970b3246f051ebfbc3fbdf0858283cd', 'lane_parent': snapshot['head']})
(report / 'toolchain.json').write_text(json.dumps(versions, indent=2) + '\n')
run('sdk-restored', ['bun', 'run', '--cwd', 'packages/snapback4', 'build'])
for path, digest in snapshot['files'].items():
    assert hashlib.sha256((repo / path).read_bytes()).hexdigest() == digest, path
suite_exit = run('full-suite', ['bash', 'scripts/test.sh'], check=False)
changes = [p for p, digest in snapshot['files'].items() if hashlib.sha256((repo / p).read_bytes()).hexdigest() != digest]
log = (report / 'full-suite.log').read_text()
summary = [line for line in log.splitlines() if line.startswith('== ') and 'failure(s) in' in line]
verification = {'checked_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'suite_exit': suite_exit,
    'suite_summary': summary, 'suite_log_sha256': hashlib.sha256((report / 'full-suite.log').read_bytes()).hexdigest(),
    'captured_source_files': len(snapshot['files']), 'source_changes': changes,
    'wasm_identical_to_measurement': wasm(wasm_path) == measurement, 'wasm': wasm(wasm_path),
    'failed_steps': [line for line in log.splitlines() if line.startswith('-- FAIL:')]}
(report / 'final-verification.json').write_text(json.dumps(verification, indent=2) + '\n')
print(json.dumps(verification, indent=2), flush=True)
assert not changes and verification['wasm_identical_to_measurement']
if suite_exit: raise SystemExit(suite_exit)
run('paired', ['python3', str(tools / 'paired-round5.py')])
run('paired-validation', ['python3', str(tools / 'validate-paired-round5.py')])
run('sdk-post-measurement', ['bun', 'run', '--cwd', 'packages/snapback4', 'build'])
