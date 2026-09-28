"""Run new regression tests with round-one repairs removed, restoring in finally."""
from pathlib import Path
import subprocess
root = Path(__file__).resolve().parents[3]
out = Path(__file__).resolve().parent
paths = [
 'crates/snapback4-core/src/engine/through.rs',
 'crates/snapback4-core/src/engine/write.rs',
 'crates/snapback4-core/src/engine/write_target.rs',
 'crates/snapback4-core/src/engine/field_authority.rs',
 'crates/snapback4-lang/src/bind/refusals.rs',
 'crates/snapback4-lang/src/bind/program/prefix.rs',
 'crates/snapback4/src/dev_refusals.rs',
 'crates/snapback4/src/serve.rs',
 'crates/snapback4/src/serve_ephemeral.rs',
 'crates/snapback4/src/verbs.rs',
]
saved = {p: (root / p).read_bytes() for p in paths}
def run(name, args):
    with (out / name).open('w') as log:
        result = subprocess.run(['cargo', 'test', '--no-fail-fast', *args, '--', '--nocapture'], cwd=root, stdout=log, stderr=subprocess.STDOUT)
    print(name, result.returncode, flush=True)
    return result.returncode
try:
    for p in paths:
        original = subprocess.check_output(['git', 'show', '07179b8dd:snapback4/' + p], cwd=root)
        (root / p).write_bytes(original)
    run('counterfactual-lang.log', ['-p','snapback4-lang','--test','mp_reproduction','--test','audience_bounds'])
    run('counterfactual-dev.log', ['-p','snapback4','--test','dev_refusals'])
finally:
    for p, contents in saved.items():
        (root / p).write_bytes(contents)
try:
    path = root / 'crates/snapback4/src/dev_refusals.rs'
    path.write_text(path.read_text().replace('if records.len() == LIMIT { records.pop_front(); }', '// eviction deliberately removed'))
    run('mutation-eviction.log', ['-p','snapback4','--test','dev_refusals','writer_evicts_the_oldest'])
finally:
    path.write_bytes(saved['crates/snapback4/src/dev_refusals.rs'])
