"""Reversible probes; run with no concurrent build in this worktree."""
from pathlib import Path
import json
import os
import subprocess

root = Path(__file__).resolve().parents[3]
report = Path(__file__).resolve().parent
env = dict(os.environ, CARGO_BUILD_JOBS='8')
cases = [
    ('reopen-without-lookup', 'crates/snapback4-core/src/engine/mod.rs',
     'let stored_schema_hash = schema.hash();\n        schema.prepare_contribution_indexes();\n        schema.prepare_delivery_lookup();',
     'let stored_schema_hash = schema.hash();\n        schema.prepare_contribution_indexes();',
     ['-p', 'snapback4-lang', '--test', 'delivery'],
     'reopening_an_installed_reporter_preserves_its_manifest'),
    ('index-without-heap', 'crates/snapback4-core/src/engine/delivery.rs',
     'reserve(1 + (i + 1).ilog2() as u64, bytes, 0)',
     'reserve(1 + (i + 1).ilog2() as u64, 0, 0)',
     ['-p', 'snapback4-core', '--lib'],
     'engine::delivery::tests::cold_index_exhausts_heap_before_steps_and_charges_its_allocations'),
]
results = []
for label, rel, before, after, target, test in cases:
    path = root / rel
    original = path.read_bytes()
    assert original.count(before.encode()) == 1, label
    try:
        path.write_bytes(original.replace(before.encode(), after.encode(), 1))
        with (report / f'mutant-{label}.txt').open('w') as log:
            result = subprocess.run(['cargo', 'test', *target, test, '--', '--exact', '--nocapture'],
                                    cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT)
        output = (report / f'mutant-{label}.txt').read_text()
        killed = result.returncode != 0 and f'test {test} ... FAILED' in output
        results.append(dict(mutation=label, test=test, exit=result.returncode, killed=killed))
        (report / 'mutations.json').write_text(json.dumps(results, indent=2) + '\n')
        print(json.dumps(results[-1]), flush=True)
        if not killed:
            raise RuntimeError(f'{label}: survived or did not reach the assertion')
    finally:
        path.write_bytes(original)
        assert path.read_bytes() == original
