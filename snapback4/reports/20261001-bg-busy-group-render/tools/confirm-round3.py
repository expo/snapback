#!/usr/bin/env python3
"""Qualify the final maintenance fix after the single full-suite invocation.

Run without concurrent builds or source edits. This never invokes test.sh.
"""
from pathlib import Path
import os, subprocess, shutil, json, hashlib, time, sys

root = Path(__file__).resolve().parents[3]
report = root / 'reports/20261001-bg-busy-group-render/round3/final'
report.mkdir(exist_ok=True)
tools = root / 'reports/20261001-bg-busy-group-render/tools'
env = {**os.environ, 'LIBSQLITE3_FLAGS': '-USQLITE_ENABLE_MEMORY_MANAGEMENT'}

def run(name, args, extra=None):
    print('START', name, flush=True)
    (report / 'progress.json').write_text(json.dumps({'phase': name, 'started': time.time()}) + '\n')
    with (report / (name + '.log')).open('w') as log:
        result = subprocess.run(args, cwd=root, env={**env, **(extra or {})}, stdout=log, stderr=subprocess.STDOUT)
    (report / (name + '.exit')).write_text(str(result.returncode) + '\n')
    print('END', name, result.returncode, flush=True)
    assert result.returncode == 0, name

if '--measure-only' not in sys.argv and '--ll-only' not in sys.argv:
    run('wasm', ['bash', 'scripts/build-wasm.sh'])
    wasm = root / 'packages/snapback4/src/wasm/snapback4_device_bg.wasm'
    wasm_info = {'raw_bytes': wasm.stat().st_size,
        'gzip_bytes': len(subprocess.check_output(['gzip', '-9', '-c', str(wasm)])),
        'sha256': hashlib.sha256(wasm.read_bytes()).hexdigest(),
        'branch_ratchet': 605225, 'current_main_ratchet': 610782,
        'gzip_method': 'gzip -9 -c FILE'}
    (report / 'wasm.json').write_text(json.dumps(wasm_info, indent=2) + '\n')
    assert wasm_info['gzip_bytes'] <= wasm_info['branch_ratchet']
    run('client-build', ['bun', 'run', '--cwd', 'packages/snapback4', 'build'])
    run('instrument-client', ['python3', str(tools / 'instrument-client.py')])
    for profile in ['dev', 'production']:
        run('instrument-' + profile, ['python3', str(tools / 'instrument-server.py')], {'BG_PROFILE': profile})
        shutil.copy2(root / 'target/debug/snapback4-ll-measure', '/tmp/bg-round3-final-' + profile)
    (report / 'binaries.json').write_text(json.dumps({name: hashlib.sha256(Path('/tmp/bg-round3-final-' + name).read_bytes()).hexdigest()
        for name in ['dev', 'production']}, indent=2) + '\n')
# Refuse to label a saturated shared host idle. Retain every load sample;
# never kill another lane's work or weaken the measured p95 assertion.
def wait_for_idle(label):
    (report / 'progress.json').write_text(json.dumps({'phase': 'waiting-' + label, 'started': time.time()}) + '\n')
    def cpu():
        v = [int(x) for x in Path('/proc/stat').read_text().splitlines()[0].split()[1:9]]
        return sum(v), v[3] + v[4]
    previous = cpu()
    quiet = 0
    samples = 0
    with (report / (label + '-idle-admission.jsonl')).open('a') as log:
        while quiet < 5:
            time.sleep(2)
            current = cpu()
            busy = 100 * (1 - (current[1] - previous[1]) / (current[0] - previous[0]))
            previous = current
            quiet = quiet + 1 if busy < 15 else 0
            samples += 1
            log.write(json.dumps({'at': time.time(), 'busy_percent': busy, 'consecutive_quiet_samples': quiet}) + '\n')
            log.flush()
            if samples % 15 == 0: print('WAIT', label, 'CPU', round(busy, 1), '%', flush=True)

wasm = root / 'packages/snapback4/src/wasm/snapback4_device_bg.wasm'
assert hashlib.sha256(wasm.read_bytes()).hexdigest() == json.loads((report / 'wasm.json').read_text())['sha256']
for profile, digest in json.loads((report / 'binaries.json').read_text()).items():
    assert hashlib.sha256(Path('/tmp/bg-round3-final-' + profile).read_bytes()).hexdigest() == digest
for condition in ([] if '--ll-only' in sys.argv else ['idle', 'loaded']):
    name = 'qualification-' + condition
    wait_for_idle(condition)
    args = ['python3', str(tools / 'host-load.py')]
    if condition == 'loaded': args += ['python3', str(tools / 'contended.py')]
    args += ['node', str(tools / 'measure.mjs')]
    settings = {'BG_PROFILE': 'production', 'BG_RUNS': '50', 'BG_SEED_CACHE': '/tmp/bg-round3-seed',
        'BG_OUT': str(report / (name + '.json')), 'SNAPBACK4_BIN': '/tmp/bg-round3-final-production'}
    if condition == 'idle': settings['BG_MAX_P95'] = '250'
    run(name, args, settings)
    run(name + '-summary', ['node', str(tools / 'summarize.mjs'), str(report / (name + '.json'))])
    run(name + '-client', ['node', str(tools / 'attribute-client.mjs'), str(report / (name + '.json'))])
if '--ll-current-load' not in sys.argv: wait_for_idle('ll')
run('ll-final', ['python3', str(tools / 'host-load.py'), 'node', 'reports/20260929-ll-live-latency/tools/measure.mjs'],
    {'LL_KEEP': 'viewed', 'LL_TIER': 'wasm', 'LL_RUNS': '20', 'LL_OUT': str(report / 'll-final.json'),
     'SNAPBACK4_BIN': '/tmp/bg-round3-final-dev'})
run('ll-final-summary', ['node', 'reports/20260929-ll-live-latency/tools/summarize.mjs', str(report / 'll-final.json')])
run('qualification-validator', ['python3', str(tools / 'qualify-round1.py')], {'BG_ROUND': 'round3/final'})
run('client-restore', ['bun', 'run', '--cwd', 'packages/snapback4', 'build'])
run('server-restore', ['cargo', 'build', '-p', 'snapback4'])
(report / 'progress.json').write_text(json.dumps({'phase': 'done'}) + '\n')
