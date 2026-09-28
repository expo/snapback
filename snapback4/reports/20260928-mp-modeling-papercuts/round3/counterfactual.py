"""One removed repair per process test; always restore exact source bytes."""
from pathlib import Path
import os, subprocess
root = Path(__file__).resolve().parents[3]
report = Path(__file__).resolve().parent
response = root / 'crates/snapback4/src/dev_refusal_response.rs'
maintenance = root / 'crates/snapback4/src/serve_maintenance.rs'
probes = [
    ('asset', response, '            Some(code) => code,', '            Some(code @ ("E_RULE" | "NOT_FOUND")) => code,\n            Some(_) => return None,', 'owner_only_asset_refusal_replaces_an_earlier_mutation_cause'),
    ('job', maintenance, '                if shared.personas { shared.refusals.job(&run); }', '', 'scheduled_parked_job_replaces_an_earlier_request_in_the_same_stream'),
    ('filter', response, '                if cause.as_ref().is_some_and(|cause| !cause.terminal) { return None; }', '', 'filtered_sync_and_reads_keep_the_named_timed_refusal_and_explain_scope'),
    ('object', response, 'Value::Object(fields) => fields.values().any(empty),', 'Value::Object(_) => false,', 'composed_missing_row_replaces_a_known_refusal_with_explicit_unknown_cause'),
]
for name, path, old, new, test in probes:
    original = path.read_bytes()
    try:
        source = original.decode()
        assert source.count(old) == 1, name
        path.write_text(source.replace(old, new))
        with (report / f'mutation-{name}.log').open('w') as log:
            result = subprocess.run(['cargo', 'test', '-p', 'snapback4', '--test', 'dev_refusals', f'round3::{test}', '--', '--exact', '--nocapture'], cwd=root, env={**os.environ, 'CARGO_BUILD_JOBS':'8'}, stdout=log, stderr=subprocess.STDOUT)
        output = (report / f'mutation-{name}.log').read_text()
        assert result.returncode == 101 and 'test result: FAILED' in output, (name, result.returncode)
        print(f'{name}: removed repair detected (test failure, not compile failure)', flush=True)
    finally:
        path.write_bytes(original)
    assert path.read_bytes() == original
print('All four probes detected; exact source bytes restored.', flush=True)
