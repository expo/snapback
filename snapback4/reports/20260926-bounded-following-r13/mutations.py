#!/usr/bin/env python3
"""Run from snapback4 after package build, without concurrent JS tests."""
from pathlib import Path
import gzip
import subprocess

leaf = Path(__file__).resolve().parent
paths = {name: Path('packages/snapback4/dist/' + name + '.js') for name in ['local', 'local-query']}
originals = {name: path.read_text() for name, path in paths.items()}
mutants = [
    ('reset-remembered-wakeup', 'local', 'if (denied || !localWakeup || serverDue)', 'if (true)',
     'remembered branch timer watch|remembered wakeup retains', ['expiry-retry-watch', 'server-clock-regressions']),
    ('infer-wakeup-from-null-server-deadline', 'local', '!localWakeup || serverDue', 'serverExpiry != null || serverDue',
     'composed data with no server deadline', ['server-clock-regressions']),
    ('drop-server-cutoff-during-rerun', 'local', 'scheduleExpiry(watch, null, serverExpiry, localWakeup);', '/* mutant: server deadline disarmed */',
     'remembered wakeup retains.*600', ['server-clock-regressions']),
    ('drop-wakeup-provenance-on-rearm', 'local', 'scheduleExpiry(watch, nextExpiry, serverExpiry, localWakeup);', 'scheduleExpiry(watch, nextExpiry, serverExpiry);',
     'remembered wakeup retains.*early=true', ['server-clock-regressions']),
    ('allow-expired-memory-after-retry', 'local-query', '(result.serverExpiry != null && result.serverExpiry <= env.serverNow())',
     '((attempt === 0 || origin !== "remembered") && result.serverExpiry != null && result.serverExpiry <= env.serverNow())',
     "memory's own server deadline still expires at publication", ['prediction-routing']),
]
try:
    for name, module, before, after, pattern, suites in mutants:
        original = originals[module]
        # Rearm and initial scheduling share the call; mutate only the first,
        # inside the early timer branch, so the control reaches that branch.
        expected = 2 if name == 'drop-wakeup-provenance-on-rearm' else 1
        assert original.count(before) == expected, (name, 'unexpected mutation sites')
        paths[module].write_text(original.replace(before, after, 1))
        run = subprocess.run(['node', '--test', '--test-concurrency=1', '--test-name-pattern=' + pattern,
                              *['packages/snapback4/test/' + suite + '.test.mjs' for suite in suites]],
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        (leaf / (name + '.log.gz')).write_bytes(gzip.compress(run.stdout, mtime=0))
        assert run.returncode != 0, name + ' SURVIVED'
        assert b'AssertionError' in run.stdout, name + ' must fail an assertion'
        print(name + ': rejected', flush=True)
        paths[module].write_text(original)
finally:
    for name, path in paths.items(): path.write_text(originals[name])
