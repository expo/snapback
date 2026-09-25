#!/usr/bin/env python3
"""Mutate built client routing, run scoped regressions, always restore it.
Run from snapback4/ after `bun run --cwd packages/snapback4 build`.
"""
from pathlib import Path
import subprocess

leaf = Path(__file__).resolve().parent
module = Path('packages/snapback4/dist/local-query.js')
original = module.read_text()
condition = 'outcome.unknown === false && outcome.complete === true'
mutants = [
    ('narrow-incomplete', condition, 'outcome.unknown === false',
     'withheld scalar/heap cut', 'prediction-routing'),
    ('narrow-loading', condition, f'({condition}) || outcome.loading === true',
     'withheld scalar/heap cut', 'prediction-routing'),
    ('local-fresh-true', 'const fresh = env.link === "online" && env.caughtUp && env.identityChecked;', 'const fresh = true;',
     'local freshness is decided', 'prediction-routing'),
    ('discard-composed-refusal', 'if (remote.origin === "server" && !("data" in remote.result.read))\n            return remote;',
     'if (remote.origin === "server" && !("data" in remote.result.read))\n            return localCandidate();',
     'rule 5: composed', 'prediction-routing'),
]
try:
    for name, before, after, pattern, test in mutants:
        assert original.count(before) == 1, (name, 'mutation must target exactly one site')
        module.write_text(original.replace(before, after))
        run = subprocess.run(['node', '--test', '--test-name-pattern=' + pattern,
                              'packages/snapback4/test/' + test + '.test.mjs'],
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        (leaf / (name + '.log')).write_bytes(run.stdout)
        assert run.returncode != 0, name + ' SURVIVED'
        print(name + ': rejected', flush=True)
        module.write_text(original)
finally:
    module.write_text(original)
