#!/usr/bin/env python3
"""Run after the package build, from snapback4/. Always restore built JS."""
from pathlib import Path
import subprocess

path = Path('packages/snapback4/dist/local-query.js')
original = path.read_text()
mutations = [
    ('known-branch-server', 'return localCandidate(); // Rule 2.', 'return await server(); // mutant: external answer after narrowing known reads', 'rule 2: known complete branch wins'),
    ('session-check', 'const denied = env.unavailable() ?? env.partitionDenied;', 'const denied = env.partitionDenied; // mutant: ignore sign-out/close', 'rule 1: router itself'),
    ('unknown-narrowing', 'outcome.unknown === false\n                ? new Set(outcome.tables ?? []) : new Set([...staticTables, ...outcome.tables ?? []])', 'new Set(outcome.tables ?? [])', 'rule 4: unknown conditions'),
    ('unknown-withholding', 'latest = { outcome, result: { read, tables, nextExpiry } };', 'latest = { outcome, result: outcome.unknown ? loading : { read, tables, nextExpiry } };', 'rule 4: available unknown Following'),
]
try:
    for name, before, after, pattern in mutations:
        assert original.count(before) == 1, (name, original.count(before))
        path.write_text(original.replace(before, after))
        result = subprocess.run(['node', '--test', f'--test-name-pattern={pattern}', 'packages/snapback4/test/prediction-routing.test.mjs'], capture_output=True, text=True, timeout=30)
        Path(f'reports/20260925-bounded-following-r4/mutation-{name}.log').write_text(result.stdout + result.stderr)
        print(f'{name}: exit {result.returncode}', flush=True)
        assert result.returncode == 1, f'{name} survived or crashed'
finally:
    path.write_text(original)
