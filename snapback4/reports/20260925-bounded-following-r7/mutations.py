#!/usr/bin/env python3
"""Run from snapback4 after building the package; always restore the built module."""
from pathlib import Path
import gzip
import subprocess
leaf = Path(__file__).resolve().parent
module = Path('packages/snapback4/dist/local-query.js')
original = module.read_text()
mutants = [
    ('expiry-only-remembered', 'origin !== "local" && "data" in result.read && result.nextExpiry !== null', 'origin === "remembered" && "data" in result.read && result.nextExpiry !== null', 'delayed .* data expires'),
    ('restore-held-exception', 'placeholder() && !retainedComposition()', 'placeholder() && !retainedComposition() && !latest?.outcome.held', 'speculative values with engine|speculative refusal is a placeholder'),
    ('discard-retained-composition', 'placeholder() && !retainedComposition()', 'placeholder()', 'retained composition beside speculative null'),
]
try:
    for name, before, after, pattern in mutants:
        assert original.count(before) == 1, (name, 'mutation must hit exactly one site')
        module.write_text(original.replace(before, after))
        run = subprocess.run(['node', '--test', '--test-name-pattern=' + pattern, 'packages/snapback4/test/prediction-routing.test.mjs'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        (leaf / (name + '.log.gz')).write_bytes(gzip.compress(run.stdout, mtime=0))
        assert run.returncode != 0, name + ' SURVIVED'
        print(name + ': rejected', flush=True)
        module.write_text(original)
finally:
    module.write_text(original)
