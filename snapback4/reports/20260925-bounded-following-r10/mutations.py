#!/usr/bin/env python3
"""Run from snapback4 after package build; restore the built module on every exit."""
from pathlib import Path
import gzip
import subprocess
import sys

leaf = Path(__file__).resolve().parent
module = Path('packages/snapback4/dist/local-query.js')
original = module.read_text()
reroute = 'candidate = await routeLocal(refreshed);'
mutants = [
    ('skip-retry-routing', reroute, 'candidate = localCandidate();',
     'online unknown expiry retry|offline speculative expiry retry|expiry retry composes', 'prediction-routing'),
    ('republish-expired-initial', reroute, reroute + '\nif (env.link === "online" && refreshed.outcome.unknown) candidate = { ...candidate, result: { ...initial.result, nextExpiry: candidate.result.nextExpiry } };',
     'online unknown expiry retry', 'prediction-routing'),
    ('delete-memory-before-retry', 'const refreshed = await local();',
     'env.serverAnswers.delete(key); const refreshed = await local();',
     'offline speculative expiry retry', 'prediction-routing'),
    ('drop-retry-cursor', reroute, reroute + '\nif ("data" in candidate.result.read) candidate.result.read = { ...candidate.result.read, next: null };',
     'MQ local page', 'retained-history'),
    ('skip-retry-delivery-fence', 'if (candidate.origin !== "local")',
     'if (attempt === 0 && candidate.origin !== "local")',
     'expiry fallback rechecks predictions', 'prediction-routing'),
    ('drop-withheld-deadline', 'nextExpiry: latest?.result.nextExpiry ?? null',
     'nextExpiry: ("loading" in fallback().read) ? null : (latest?.result.nextExpiry ?? null)',
     'withheld local retry keeps its future deadline', 'prediction-routing'),
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
        assert b'AssertionError' in run.stdout, name + ' must fail an assertion'
        print(name + ': rejected', flush=True)
        module.write_text(original)
finally:
    module.write_text(original)
