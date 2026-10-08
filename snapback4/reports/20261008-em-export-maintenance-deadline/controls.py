#!/usr/bin/env python3
"""Lane-local controls; never edit product source or rebuild a running pinned CLI."""
import difflib
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import time

report = Path(__file__).resolve().parent
workspace = report.parents[1]
out = report / 'evidence' / 'controls'
out.mkdir(parents=True, exist_ok=True)
positive = json.loads((report / 'evidence/binary.json').read_text())
scratch = workspace / f'target/em/round6-controls-{os.getpid()}/snapback4'
scratch.mkdir(parents=True)
(scratch.parent / 'benchmarks').symlink_to(workspace.parent / 'benchmarks', target_is_directory=True)
for name in ['Cargo.toml', 'Cargo.lock']:
    shutil.copy2(workspace / name, scratch / name)
shutil.copytree(workspace / 'crates', scratch / 'crates', symlinks=True)
for name in ['apps', 'packages', 'vendor', 'experiments']:
    (scratch / name).symlink_to(workspace / name, target_is_directory=True)
if (workspace / '.cargo').exists():
    shutil.copytree(workspace / '.cargo', scratch / '.cargo')
relative = Path('crates/snapback4/src/verbs/witness/retention.rs')
source = scratch / relative
fixed = source.read_text()
trace = scratch / relative.with_name('retention_trace.rs')
fixed_trace = trace.read_text()
env = {**os.environ, 'CARGO_TARGET_DIR': str(workspace / 'target'),
       'LIBSQLITE3_FLAGS': '-USQLITE_ENABLE_MEMORY_MANAGEMENT', 'CARGO_BUILD_JOBS': '6'}
cargo = ['cargo', '--manifest-path', str(scratch / 'Cargo.toml')]


def run(name, command, extra=None):
    start = time.monotonic()
    with (out / f'{name}.log').open('w') as log:
        result = subprocess.run(command, cwd=workspace, env={**env, **(extra or {})},
                                stdout=log, stderr=subprocess.STDOUT)
    receipt = dict(command=command, environment={k: env[k] for k in
        ['CARGO_TARGET_DIR', 'LIBSQLITE3_FLAGS', 'CARGO_BUILD_JOBS']}, overrides=extra,
        exitCode=result.returncode, seconds=time.monotonic() - start,
        retentionSha256=hashlib.sha256(source.read_bytes()).hexdigest(),
        traceSha256=hashlib.sha256(trace.read_bytes()).hexdigest())
    (out / f'{name}.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(name, result.returncode, f"{receipt['seconds']:.2f}s", flush=True)
    return result.returncode, (out / f'{name}.log').read_text()


def build(name):
    code, _ = run(name + '-build', [cargo[0], 'build', *cargo[1:], '-p', 'snapback4'])
    assert code == 0
    binary = workspace / 'target/debug/snapback4'
    digest = hashlib.sha256(binary.read_bytes()).hexdigest()
    pinned = workspace / 'target/em/binaries' / digest / 'snapback4'
    pinned.parent.mkdir(parents=True, exist_ok=True)
    if not pinned.exists():
        shutil.copy2(binary, pinned)
    assert hashlib.sha256(pinned.read_bytes()).hexdigest() == digest
    (out / f'{name}-binary.json').write_text(json.dumps(dict(binary=str(pinned), sha256=digest), indent=2) + '\n')
    return {'SNAPBACK4_EXPORT_TEST_BINARY': str(pinned),
            'SNAPBACK4_MAINTENANCE_EVIDENCE': str(out / f'{name}-snapshots')}


def diff(name, before, after):
    (out / (name + '.diff')).write_text(''.join(difflib.unified_diff(
        before.splitlines(True), after.splitlines(True), fromfile='fixed', tofile=name, n=0)))


try:
    # Remove adoption only: preserve the round-5 clock checks and all barriers.
    start = fixed.index('fn adopt_later(')
    end = fixed.index('fn refresh_guard(', start)
    broken = fixed[:start] + "fn adopt_later(_root: &Path, _intent: &mut Observation) -> bool { false }\n" + fixed[end:]
    source.write_text(broken)
    diff('deadline-negative', fixed, broken)
    selected = build('deadline-negative')
    code, output = run('deadline-negative', ['node', '--test', '--test-reporter=tap',
        '--test-name-pattern=maintenance deadline: (idle success|live guard)',
        'packages/snapback4/test/export-maintenance-wakeup.test.mjs'], selected)
    assert code == 1 and output.count("error: 'coalesced maintenance queue drained'") == 2
    assert '# fail 2' in output

    # Reopen precisely the original two exit windows; keep the later intent fix.
    before = "            drop(queued);\n            adopt_later(root, &mut intent);\n            continue;"
    assert fixed.count(before) == 1
    broken = fixed.replace(before, '            return Ok(Value::Null); // CONTROL: exit under the empty lease')
    before = '        if let Err(e) = resume_unobserved(&root) { eprintln!("witness: evidence cleanup deferred: {e}"); }'
    assert broken.count(before) == 1
    broken = broken.replace(before, '        // CONTROL: omit fresh-wakeup handoff on failed guard')
    source.write_text(broken)
    diff('wakeup-negative', fixed, broken)
    selected = build('wakeup-negative')
    code, output = run('wakeup-negative', ['node', '--test', '--test-reporter=tap',
        '--test-name-pattern=empty second check|expiry guard cannot strand',
        'packages/snapback4/test/export-maintenance-wakeup.test.mjs'], selected)
    assert code == 1 and output.count("error: 'coalesced maintenance queue drained'") == 2
    assert '# fail 2' in output

    # Actual round-4 retention with the round-5 debug clock injection retained.
    baseline = subprocess.check_output(['git', 'show', '9337691bee:snapback4/' + str(relative)], cwd=workspace, text=True)
    source.write_text(baseline)
    diff('round4-retention', fixed, baseline)
    selected = build('sleep-negative')
    code, output = run('sleep-negative', ['node', '--test', '--test-reporter=tap',
        '--test-name-pattern=maintenance sleep: notification|maintenance sleep: successor',
        'packages/snapback4/test/export-maintenance-wakeup.test.mjs'], selected)
    assert code == 1 and '# fail 2' in output and '# pass 1' in output
    assert 'an intent spanning sleep must not launch a successor via producer retry' in output
    assert 'a successor must reject the inherited intent after sleep' in output
finally:
    # All live JS tests used immutable copies; restore the positive default CLI.
    shutil.copy2(positive['binary'], workspace / 'target/debug/snapback4')
    assert hashlib.sha256((workspace / 'target/debug/snapback4').read_bytes()).hexdigest() == positive['sha256']
