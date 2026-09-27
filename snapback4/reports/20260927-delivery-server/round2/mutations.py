"""Reversible regression probes. Run with no concurrent build in this worktree."""
from pathlib import Path
import json
import os
import subprocess

root = Path(__file__).resolve().parents[3]
report = Path(__file__).resolve().parent
env = dict(os.environ, CARGO_BUILD_JOBS='8')
core = 'crates/snapback4-core/src/engine/delivery.rs'
lang = ['-p', 'snapback4-lang', '--test', 'delivery']
unit = ['-p', 'snapback4-core', '--lib']
http = ['-p', 'snapback4', '--bin', 'snapback4']
cases = [
    ('source-lookup-free', core,
     'if ledger.stamping_stopped || !ledger.reserve(cost, 0, 0)',
     'if ledger.stamping_stopped || !ledger.reserve(0, 0, 0)', lang,
     'per_source_lookup_exhausts_steps_after_the_index_fits'),
    ('index-one-step', core,
     'reserve(1 + (i + 1).ilog2() as u64, bytes, 0)', 'reserve(1, bytes, 0)', lang,
     'many_bindings_exhaust_metadata_work_before_further_source_stamping'),
    ('skip-reserved-rows', core,
     'walk(data, &mut bindings, &mut seen, self.delivery_ledger());',
     'if !self.delivery_ledger().partial { walk(data, &mut bindings, &mut seen, self.delivery_ledger()); }', lang,
     'colliding_ids_do_not_turn_foreign_fields_into_own_images'),
    ('ungated-source', core,
     '\n            || !self.schema.delivery_lookup.0.tables.contains(table)', '', unit,
     'engine::delivery::tests::untracked_sources_and_answers_never_start_supplemental_work'),
    ('ungated-manifest', core,
     '!self.read_tables.iter().any(|table| self.schema.delivery_lookup.0.tables.contains(table))',
     'self.schema.delivery.is_empty()', lang,
     'unrelated_reads_pay_nothing_even_when_the_binding_index_cannot_fit'),
    ('late-signature', 'crates/snapback4/src/serve.rs',
     'test_work(&shared.mutation_wait);\n                signature\n',
     'test_work(&shared.mutation_wait);\n                lock(&shared.bound).programs.iter().find(|p| p.program.name == op).map(|p| (p.program.kind, p.program.args.clone()))\n', http,
     'serve::tests::delivery_tests::adoption_after_preflight_decodes_the_captured_signature_then_refuses_binding'),
    ('old-card-paragraph', 'crates/snapback4-lang/src/guide/receipts.rs',
     'The SDK reports debt collected from\npublications and accepted answer manifests',
     'The client reports the pages it has walked',
     ['-p', 'snapback4-lang', '--test', 'guide'],
     'definitions::receipts_teaches_sdk_delivery_and_keeps_only_the_seen_hook'),
]
results = []
for label, rel, before, after, target, test in cases:
    path = root / rel
    original = path.read_text()
    assert original.count(before) == 1, (label, original.count(before))
    try:
        path.write_text(original.replace(before, after, 1))
        with (report / f'mutant-{label}.txt').open('w') as log:
            result = subprocess.run(['cargo', 'test', *target, test, '--', '--exact', '--nocapture'],
                                    cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT)
        output = (report / f'mutant-{label}.txt').read_text()
        killed = result.returncode != 0 and f'test {test} ... FAILED' in output
        results.append(dict(mutation=label, test=test, exit=result.returncode, killed=killed))
        (report / 'mutations.json').write_text(json.dumps(results, indent=2) + '\n')
        print(json.dumps(results[-1]), flush=True)
        if not killed:
            raise RuntimeError(f'{label}: survived or failed without reaching the assertion')
    finally:
        path.write_text(original)
