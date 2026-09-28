"""Run the round-9 Chromium negative controls on isolated SDK copies."""
from pathlib import Path
import json
import os
import shutil
import subprocess

root = Path.cwd()
out = root / 'target/lane-ss-round9'
results = []


def run(name, file, before, after, case):
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
        ('./worker-restore-adoption.mjs', root / 'witness/worker-restore-adoption.mjs'),
        ('../packages/snapback4/bin/web-shell.js', root / 'packages/snapback4/bin/web-shell.js'),
    ]:
        source = source.replace(repr(relative), repr(str(target)))
    source = source.replace("join(root, 'packages/snapback4/dist')", repr(str(pkg / 'dist')))
    source = source.replace("join(root, 'target/lane-ss-round4/worker-protocol')", repr(str(dest / 'bundle')))
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
    assert done.returncode == 1 and len(failures) == 1 and not raw['pageErrors'], 'mutant survived or harness failed'
    assert len(raw['results']) == 2 and raw['results'][0]['ok'], 'earlier observation guard must still pass'
    assert failures[0]['name'] == 'generation-changing adoption completion preserves restore refusal'
    assert 'asynchronous completion cannot reauthorize action dispatch' in failures[0]['error']


run('adoption-clears-restore-refusal', 'local.js',
    'if (adopted.denied || partitionDenied?.code === "E_STORE_RESTORE")',
    'if (adopted.denied)', 'generation-changing')
