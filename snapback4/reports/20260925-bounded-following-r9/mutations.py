#!/usr/bin/env python3
"""Run from snapback4 after package build; always restore the built module."""
from pathlib import Path
import gzip
import subprocess

leaf = Path(__file__).resolve().parent
module = Path('packages/snapback4/dist/local-query.js')
original = module.read_text()
mutants = [
    ('skip-watch-expiry', 'snapshot.nextExpiry <= Date.now()',
     'snapshot.nextExpiry <= Date.now() && watch === undefined',
     'MQ local permit watch|MQ expiry local watch', 'retained-history'),
    ('remove-expiry-retry', 'if (attempt === 0)', 'if (false)',
     'MQ local permit|MQ expiry local', 'retained-history'),
    ('remove-dirty-watch', 'if (watch)\n                        watch.dirty = true;',
     'if (false)\n                        watch.dirty = true;',
     'second expired local reply', 'prediction-routing'),
    ('unbounded-expiry-retry', 'if (attempt === 0)', 'if (true)',
     'second expired local reply', 'prediction-routing'),
    ('drop-retry-deadline', 'candidate.result = { ...candidate.result, nextExpiry: snapshot.nextExpiry };', '',
     'withheld local retry keeps its future deadline', 'prediction-routing'),
]
try:
    for name, before, after, pattern, suite in mutants:
        assert original.count(before) == 1, (name, 'mutation must hit exactly one site')
        module.write_text(original.replace(before, after))
        run = subprocess.run(['node', '--test', '--test-name-pattern=' + pattern,
                              'packages/snapback4/test/' + suite + '.test.mjs'],
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        (leaf / (name + '.log.gz')).write_bytes(gzip.compress(run.stdout, mtime=0))
        assert run.returncode != 0, name + ' SURVIVED'
        print(name + ': rejected', flush=True)
        module.write_text(original)
finally:
    module.write_text(original)
