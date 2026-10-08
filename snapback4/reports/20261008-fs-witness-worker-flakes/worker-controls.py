#!/usr/bin/env python3
"""Private source-copy fault controls; never edits the canonical tests."""
from pathlib import Path
import argparse
import subprocess

p = argparse.ArgumentParser()
p.add_argument('kind', choices=['delayed', 'old-observer', 'missing-logs', 'missing-refusal'])
p.add_argument('--rounds', default='1')
a = p.parse_args()
report = Path(__file__).resolve().parent
root = report.parents[1]
tests = root / 'packages/snapback4/test'
copies = []
try:
    if a.kind == 'missing-refusal':
        source = (tests / 'worker-regressions.test.mjs').read_text()
        assert "s.log += b;" in source
        for scope in ['snapback', 'project', 'ancestor']:
            changed = source.replace("s.log += b;", "s.log += ''; /* withhold refusal delivery */")
            changed = changed.replace("const scope of ['snapback', 'project', 'ancestor']", f"const scope of ['{scope}']")
            copy = tests / f'.fs-control-{a.kind}-{scope}.test.mjs'
            copy.write_text(changed)
            copies.append(copy)
        pattern = 'named snapshot refuses'
    else:
        source = (tests / 'supervised-workers.test.mjs').read_text()
        old = 'child.stderr.on("data", bytes => { stderr += bytes; });'
        assert old in source
        source = source.replace(old, '''let heldLogs = [], holdLogs = true;
  child.stderr.on("data", bytes => { if (holdLogs) heldLogs.push(bytes); else stderr += bytes; });''')
        marker = 'await until(() => starts("push").length === 1 && starts("digest").length === 1);'
        source = source.replace(marker, marker + '''
  assert.equal(stderr, '', 'both files precede every relayed log in this control');
  console.log('FS_CONTROL: both startup files observed with logs withheld');
''' + ('' if a.kind == 'missing-logs' else '''
  setTimeout(() => { holdLogs = false; stderr += heldLogs.join(''); heldLogs = []; }, 250);
'''))
        if a.kind == 'old-observer':
            start = source.index('  await until(() => ["push", "digest"].every')
            end = source.index('  const db =', start)
            source = source[:start] + source[end:]
        copy = tests / f'.fs-control-{a.kind}.test.mjs'
        copy.write_text(source)
        copies.append(copy)
        pattern = 'declares two workers' if a.kind == 'delayed' else '^dev declares two workers'
    result = subprocess.run(['python3', str(report / 'repeat.py'), '--label', 'control-' + a.kind,
        '--rounds', a.rounds, '--jobs', '2' if a.kind == 'delayed' else '1', '--cpus', '78,79',
        '--', 'node', '--test', '--test-concurrency=3', '--test-name-pattern='+pattern,
        *map(str, copies)], cwd=root)
    raise SystemExit(result.returncode)
finally:
    for copy in copies:
        copy.unlink(missing_ok=True)
