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
scratch = workspace / f'target/em/round5-controls-{os.getpid()}/snapback4'
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
    # Actual round-4 retention, with only the debug clock injection in background.rs.
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

    # Corroborate the separate parallel recovery failures without changing those tests.
    seen = set()
    for attempt in range(1, 11):
        code, output = run(f'recovery-baseline-{attempt}', [cargo[0], 'test', *cargo[1:],
            '-p', 'snapback4', '--bin', 'snapback4', 'recovery'])
        assert 'test result:' in output, 'baseline test setup failed before execution'
        for signature in ['retention lock busy', 'all discoveries were covered']:
            if signature in output:
                seen.add(signature)
        if len(seen) == 2:
            break
    (out / 'recovery-baseline-summary.json').write_text(json.dumps(dict(signatures=sorted(seen), runs=attempt), indent=2) + '\n')

    # Keep the new assertion while restoring the oversized terminal-padding branch.
    source.write_text(fixed)
    bad_trace = fixed_trace.replace('((LIMIT - size) as usize).min(LINE_LIMIT)', '(LIMIT - size) as usize')
    assert bad_trace != fixed_trace
    trace.write_text(bad_trace)
    diff('trace-line-negative', fixed_trace, bad_trace)
    code, output = run('trace-line-negative', [cargo[0], 'test', *cargo[1:], '-p',
        'snapback4', '--bin', 'snapback4', 'trace_sink_refuses_links_and_bounds_a_regular_file'])
    assert code == 101 and 'terminal line exceeded 4 KiB: 4160' in output
    trace.write_text(fixed_trace)

    # Reopen precisely the original two exit windows, retaining clocks and barriers.
    before = '''            drop(queued);
            if let Some(fresh_intent) = unobserved_intent(root) { intent = fresh_intent; }
            continue;'''
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
finally:
    # Cargo may regard the default output as cached after a scratch build. Restore
    # the verified positive bytes explicitly; all live JS tests used pinned copies.
    shutil.copy2(positive['binary'], workspace / 'target/debug/snapback4')
    assert hashlib.sha256((workspace / 'target/debug/snapback4').read_bytes()).hexdigest() == positive['sha256']
