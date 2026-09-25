#!/usr/bin/env python3
"""Run from snapback4 after package build, without concurrent JS tests."""
from pathlib import Path
import gzip
import subprocess

leaf = Path(__file__).resolve().parent
module = Path('packages/snapback4/dist/local-query.js')
original = module.read_text()
patterns = 'memory survives a local deadline|expiry retry remembered branch'
mutants = [
    ('expire-memory-by-local-wakeup', '(origin !== "remembered" && localDue)', '(localDue)', patterns,
     ['prediction-routing', 'expiry-retry-watch']),
    ('forget-consumed-wakeup-rerun', 'if (watch)\n                    watch.dirty = true;', 'if (false)\n                    watch.dirty = true;', patterns,
     ['prediction-routing', 'expiry-retry-watch']),
    ('keep-consumed-wakeup-timer', 'result.nextExpiry = null;', '/* mutant: leave the due wakeup attached */', patterns,
     ['prediction-routing', 'expiry-retry-watch']),
    ('drop-watched-server-cursor', 'const { result, origin } = candidate;',
     'const { result, origin } = candidate; if (attempt > 0 && origin === "server" && watch && "data" in result.read) result.read.next = null;',
     'expiry retry server pagination watch', ['expiry-retry-watch']),
]
try:
    for name, before, after, pattern, suites in mutants:
        assert original.count(before) == 1, (name, 'mutation must hit exactly one site')
        module.write_text(original.replace(before, after))
        run = subprocess.run(['node', '--test', '--test-concurrency=1', '--test-name-pattern=' + pattern,
                              *['packages/snapback4/test/' + suite + '.test.mjs' for suite in suites]],
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        (leaf / (name + '.log.gz')).write_bytes(gzip.compress(run.stdout, mtime=0))
        assert run.returncode != 0, name + ' SURVIVED'
        assert b'AssertionError' in run.stdout, name + ' must fail an assertion'
        print(name + ': rejected', flush=True)
        module.write_text(original)
finally:
    module.write_text(original)
