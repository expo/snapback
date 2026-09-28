#!/usr/bin/env python3
"""Run after the client build from snapback4; mutate only isolated dist copies."""
from pathlib import Path
import json
import shutil
import subprocess

root = Path.cwd()
package = root / 'packages/snapback4'
output = root / 'reports/20260928-rg-receipts-at-scale/round5'
control = root / 'target/rg-round5-controls'
control.mkdir(exist_ok=True)

# Execute round 4's exact runner and archive this rerun without rewriting its history.
previous = root / 'reports/20260928-rg-receipts-at-scale/round4'
archive = output / 'round4-controls'
archive.mkdir(exist_ok=True)
files = ['controls.json', 'pre-dispatch-raw-call.log', 'replacement-unprotected.log',
         'overlap-single-owner.log', 'no-batch-protection.log', 'no-read-protection.log']
kept = {name: (previous / name).read_bytes() for name in files}
try:
    result = subprocess.run(['python3', str(previous / 'controls.py')])
    for name in files:
        shutil.copy2(previous / name, archive / name)
finally:
    for name, value in kept.items():
        (previous / name).write_bytes(value)
assert result.returncode == 0, 'round-4 controls did not all fail as expected'

cases = [
    ('media-gate-throws',
     'catch {\n                    reconcileNeeded = true;\n                    retryFlush();',
     'catch (error) {\n                    reconcileNeeded = true;\n                    throw error;',
     'repeating media failure', 'persistent media failure must not stop the queued tail'),
    ('observation-catch-empty',
     'await syncUnobserved(outcome.state === "sent");\n                        }\n                        catch {\n                            retryFlush();',
     'await syncUnobserved(outcome.state === "sent");\n                        }\n                        catch {',
     'observation catch schedules', 'the observation catch must arm its retry'),
    ('admission-raw-call',
     'const admitted = await receiptCall(request);',
     'const admitted = await call(request);',
     'committed admission still', 'a committed admission must not become a local E_STORE refusal'),
    ('receipt-save-raw-call',
     'const reply = await terminalDeviceCall(committed => call({ op: "keep_write", value }, undefined, committed), () => { });',
     'const reply = await call({ op: "keep_write", value });',
     'repeating post-commit receipt-save', 'durable receipt-save housekeeping must not strand the queued tail'),
    ('media-flag-not-cleared',
     'if (reconcileNeeded) {\n                reconcileNeeded = false;',
     'if (reconcileNeeded) {',
     'repeating media failure', 'only admission reconciles; the flush flag was cleared'),
    ('media-backoff-reset',
     'catch {\n                    reconcileNeeded = true;\n                    retryFlush();',
     'catch {\n                    reconcileNeeded = true;\n                    retryMs = 250; retryFlush();',
     'repeating media failure', 'failed housekeeping retains exponential backoff'),
]
results = []
for name, before, after, pattern, assertion in cases:
    target = control / name
    if target.exists():
        shutil.rmtree(target)
    (target / 'test').mkdir(parents=True)
    shutil.copytree(package / 'dist', target / 'dist')
    shutil.copy2(package / 'package.json', target / 'package.json')
    for filename in ['store-reset-review.test.mjs', 'chat-schema.json']:
        shutil.copy2(package / 'test' / filename, target / 'test' / filename)
    (target / 'node_modules').symlink_to(package / 'node_modules', target_is_directory=True)
    path = target / 'dist/local.js'
    source = path.read_text()
    assert source.count(before) == 1, (name, source.count(before))
    path.write_text(source.replace(before, after))
    log_path = output / f'{name}.log'
    with log_path.open('w') as log:
        run = subprocess.run(['node', '--test', '--test-timeout=15000', '--test-reporter=tap',
                              f'--test-name-pattern={pattern}', str(target / 'test/store-reset-review.test.mjs')],
                             stdout=log, stderr=subprocess.STDOUT)
    killed = run.returncode == 1 and assertion in log_path.read_text()
    results.append({'name': name, 'exit': run.returncode, 'expected': 1, 'assertion': assertion, 'killed': killed})
    print(name, run.returncode, killed, flush=True)
(output / 'controls.json').write_text(json.dumps(results, indent=2) + '\n')
assert all(result['killed'] for result in results), results
