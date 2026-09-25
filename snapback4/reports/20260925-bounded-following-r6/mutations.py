#!/usr/bin/env python3
"""Run after the package build from snapback4; restore the built module always."""
from pathlib import Path
import subprocess
leaf = Path(__file__).resolve().parent
module = Path('packages/snapback4/dist/local-query.js')
original = module.read_text()
mutants = [
    ('remembered-since-now', 'since: last.at', 'since: Date.now()', 'remembered since is the original'),
    ('local-fresh-link-only', 'const fresh = env.link === "online" && env.caughtUp && env.identityChecked;', 'const fresh = env.link === "online";', 'online partial freshness requires'),
    ('ignore-expiry-at-publication', 'origin !== "local" && "data" in result.read && result.nextExpiry !== null', 'false && result.nextExpiry !== null', 'memory expires at publication'),
    ('ignore-engine-provenance', 'latest.outcome.speculative !== false', 'false', 'unknown placeholder|speculative values with engine'),
    ('discard-retained-scalars', 'const fallback = () => placeholder() && !(fenced && latest?.outcome.held)', 'const fallback = () => latest?.outcome.unknown && !(fenced && latest?.outcome.held)', 'retained .* composition survives'),
]
try:
    for name, before, after, pattern in mutants:
        assert original.count(before) == 1, (name, 'mutation must hit exactly one site')
        module.write_text(original.replace(before, after))
        run = subprocess.run(['node', '--test', '--test-name-pattern=' + pattern, 'packages/snapback4/test/prediction-routing.test.mjs'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        (leaf / (name + '.log')).write_bytes(run.stdout)
        assert run.returncode != 0, name + ' SURVIVED'
        print(name + ': rejected', flush=True)
        module.write_text(original)
finally:
    module.write_text(original)
