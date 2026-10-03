from pathlib import Path
import hashlib, json, os, subprocess, time

root = Path(__file__).resolve().parents[3]
report = Path(__file__).resolve().parent
env = dict(os.environ)
# Keep the real Volta launcher on PATH, as in a builder's environment.
env['PATH'] = str(Path.home() / '.volta/bin') + ':' + env['PATH']
env['LIBSQLITE3_FLAGS'] = '-USQLITE_ENABLE_MEMORY_MANAGEMENT'
assert subprocess.check_output(['node', '-v'], cwd=root, env=env, text=True).strip() == 'v24.18.0'
wasm = root / 'packages/snapback4/src/wasm/snapback4_device_bg.wasm'
(report / 'wasm-before.json').write_text(json.dumps({
    'sha256': hashlib.sha256(wasm.read_bytes()).hexdigest(), 'rawBytes': wasm.stat().st_size,
}, indent=2) + '\n')
assert not (report / 'full-suite-status.json').exists()
started = time.time()
with (report / 'full-suite.log').open('x') as log:
    child = subprocess.Popen(['caffeinate', '-i', 'bash', 'scripts/test.sh'], cwd=root,
                             env=env, stdout=log, stderr=subprocess.STDOUT)
    (report / 'full-suite-process.json').write_text(json.dumps({
        'supervisorPid': os.getpid(), 'suiteSupervisorPid': child.pid, 'startedAt': started,
        'nodeLauncher': str(Path.home() / '.volta/bin/node'), 'nodeVersion': '24.18.0',
    }, indent=2) + '\n')
    status = child.wait()
(report / 'full-suite-status.json').write_text(json.dumps({
    'exitStatus': status, 'durationSeconds': time.time() - started, 'invocations': 1,
}, indent=2) + '\n')
