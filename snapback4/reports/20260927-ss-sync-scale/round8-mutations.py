"""Run the round-8 Chromium negative controls on isolated SDK copies."""
from pathlib import Path
import json
import os
import shutil
import subprocess

root = Path.cwd()
out = root / 'target/lane-ss-round8'
results = []


def run(name, file, before, after, case, witness_change=None):
    dest = out / 'mutants' / name
    pkg = dest / 'sdk'
    pkg.mkdir(parents=True, exist_ok=True)
    shutil.copytree(root / 'packages/snapback4/dist', pkg / 'dist', dirs_exist_ok=True)
    shutil.copyfile(root / 'packages/snapback4/package.json', pkg / 'package.json')
    path = pkg / 'dist' / file
    source = path.read_text()
    assert source.count(before) == 1, (name, source.count(before))
    path.write_text(source.replace(before, after))
    source = (root / 'witness/worker-protocol.mjs').read_text()
    for relative, target in [
        ('./lib.mjs', root / 'witness/lib.mjs'),
        ('./worker-restore-replacement.mjs', root / 'witness/worker-restore-replacement.mjs'),
        ('../packages/snapback4/bin/web-shell.js', root / 'packages/snapback4/bin/web-shell.js'),
    ]:
        source = source.replace(repr(relative), repr(str(target)))
    source = source.replace("join(root, 'packages/snapback4/dist')", repr(str(pkg / 'dist')))
    source = source.replace("join(root, 'target/lane-ss-round4/worker-protocol')", repr(str(dest / 'bundle')))
    if witness_change:
        source = witness_change(source)
    script = dest / 'witness.mjs'
    script.write_text(source)
    command = ['node', str(script), str(dest / 'result.json')]
    with (dest / 'run.log').open('w') as log:
        done = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT,
                              env={**os.environ, 'SS_WORKER_CASE': case}, timeout=100)
    raw = json.loads((dest / 'result.json').read_text())
    failures = [r for r in raw['results'] if not r['ok']]
    result = {'name': name, 'exit': done.returncode, 'failures': failures,
              'pageErrors': raw['pageErrors'], 'command': command}
    results.append(result)
    (out / 'mutations.json').write_text(json.dumps(results, indent=2) + '\n')
    print(json.dumps(result), flush=True)
    assert done.returncode != 0 and failures and not raw['pageErrors'], 'mutant survived or harness failed'


run('obsolete-proof-stays-sticky', 'device-restore.js', '            retire();', '', 'obsolete A')
run('failed-claim-leaks-lock', 'web-ownership.js', '        await release();\n        throw error;',
    '        throw error;', 'failed quiescence')
run('omitted-derived-footprint', 'web-worker-runtime.js', 'predictions: unknown ? null : [...predictions]',
    'predictions: unknown ? null : [...predictions].filter(t => t !== "messageCounts")', 'Worker emits')
# Prove the derived-only query assertion independently of the exact-footprint assertion.
run('omitted-derived-query', 'web-worker-runtime.js', 'predictions: unknown ? null : [...predictions]',
    'predictions: unknown ? null : [...predictions].filter(t => t !== "messageCounts")', 'Worker emits',
    lambda s: '\n'.join(line for line in s.split('\n') if 'complete real runtime footprint after acknowledgement' not in line))
run('failed-validation-forgets-callback', 'web-worker-host.js', '        const proof = pending.evidence;',
    '        const proof = pending.evidence; this.restores.delete(storeId);', 'and validation retry')
