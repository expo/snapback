#!/usr/bin/env python3
"""Run from snapback4 after building the package; restore the built module."""
from pathlib import Path
import gzip
import subprocess
import sys

leaf = Path(__file__).resolve().parent
module = Path('packages/snapback4/dist/local-query.js')
original = module.read_text()
mutants = [
    ('skip-local-expiry', 'if ("data" in result.read && result.nextExpiry !== null',
     'if (origin !== "local" && "data" in result.read && result.nextExpiry !== null',
     'MQ expiry local|MQ local permit', 'retained-history'),
    ('restore-retained-exception', 'placeholder() ? loading :',
     'placeholder() && !Object.values(latest?.outcome.components ?? {}).some(c => c.retained) ? loading :',
     'retained composition beside speculative null', 'prediction-routing'),
    ('broaden-retained-exception', 'placeholder() ? loading :',
     'placeholder() && !Object.values(latest?.outcome.components ?? {}).some(c => c.retained || c.speculative === false) ? loading :',
     'retained composition beside speculative null', 'prediction-routing'),
    ('publish-nonempty-speculative-page', 'placeholder() ? loading :',
     'placeholder() && !(Array.isArray(latest?.outcome.data) && latest.outcome.data.length > 0) ? loading :',
     'unrelated held', 'bounded-following'),
]
try:
    for name, before, after, pattern, suite in mutants:
        if len(sys.argv) > 1 and name not in sys.argv[1:]:
            continue
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
