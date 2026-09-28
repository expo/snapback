#!/usr/bin/env python3
"""Isolated built-client controls. After the package build, run from snapback4/."""
from pathlib import Path
import json
import shutil
import subprocess

root = Path.cwd()
package = root / 'packages/snapback4'
output = root / 'reports/20260928-rg-receipts-at-scale/round4'
control = root / 'target/rg-round4-controls'
control.mkdir(exist_ok=True)
cases = [
    ('pre-dispatch-raw-call', 'local.js',
     'recoverReceipt(history, receiptCall, entry.id, current.sent_seq',
     'recoverReceipt(history, call, entry.id, current.sent_seq',
     'review: pre-dispatch'),
    ('replacement-unprotected', 'local-receipts.js',
     'const release = history.protectEmission(id);',
     'const release = () => {};',
     'review: reset delivery'),
    ('overlap-single-owner', 'writes.js',
     'this.delivering.set(id, (this.delivering.get(id) ?? 0) + 1);',
     'this.delivering.set(id, 1);',
     'overlapping receipt'),
    ('no-batch-protection', 'local-receipts.js',
     'releases.push(history.protectEmission(entry.id));',
     'releases.push(() => {});',
     'older flush snapshot'),
    ('no-read-protection', 'local-receipts.js',
     'const releaseRead = history.protectEmission();',
     'const releaseRead = () => {};',
     'delayed queue snapshot'),
]
results = []
for name, filename, before, after, pattern in cases:
    target = control / name
    if target.exists():
        shutil.rmtree(target)
    (target / 'test').mkdir(parents=True)
    shutil.copytree(package / 'dist', target / 'dist')
    shutil.copy2(package / 'package.json', target / 'package.json')
    for filename_test in ['store-reset-review.test.mjs', 'chat-schema.json']:
        shutil.copy2(package / 'test' / filename_test, target / 'test' / filename_test)
    (target / 'node_modules').symlink_to(package / 'node_modules', target_is_directory=True)
    path = target / 'dist' / filename
    source = path.read_text()
    assert source.count(before) == 1, (name, source.count(before))
    path.write_text(source.replace(before, after))
    with (output / f'{name}.log').open('w') as log:
        result = subprocess.run(['node', '--test', '--test-reporter=tap', f'--test-name-pattern={pattern}', str(target / 'test/store-reset-review.test.mjs')], stdout=log, stderr=subprocess.STDOUT)
    results.append({'name': name, 'exit': result.returncode, 'expected': 1})
    print(name, result.returncode, flush=True)
(output / 'controls.json').write_text(json.dumps(results, indent=2) + '\n')
assert all(result['exit'] == 1 for result in results), results
