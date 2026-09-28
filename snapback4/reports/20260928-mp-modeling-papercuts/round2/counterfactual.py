"""Remove one repair at a time; restore source bytes even on a failed probe."""
from pathlib import Path
import os, subprocess
base = Path(__file__).resolve().parents[3]
out = Path(__file__).resolve().parent
cases = [
 ('query', 'crates/snapback4/src/serve.rs', 'let context = dev_refusals::response::context(context, reader.refusal_sites.clone(), reader.generation());', 'let context = context;', ['-p','snapback4','--test','dev_refusals','real_query_exhaustion']),
 ('fallback', 'crates/snapback4/src/dev_refusal_response.rs', 'Some(code @ ("E_RULE" | "NOT_FOUND")) => code,', 'Some(code @ ("E_RULE" | "NOT_FOUND")) => { if cause.is_none() { return None; } code },', ['-p','snapback4','--bin','snapback4','memory_query_branch_collects']),
 ('phase', 'crates/snapback4-core/src/engine/through.rs', 'self.trace_authorization(&result, name, Effect::Insert, "read through capture");', 'self.trace_authorization(&result, name, Effect::Insert, "insert rule");', ['-p','snapback4','--test','dev_refusals','real_query_exhaustion']),
 ('dropped', 'crates/snapback4/src/dev_refusals.rs', 'writer_dropped.load(Ordering::Relaxed)', '0', ['-p','snapback4','--test','dev_refusals','blocked_stderr']),
 ('residual', 'crates/snapback4-lang/src/bind/refusals.rs', '.chain(equalities.iter().map(|(column,term)|(column,term)))', '', ['-p','snapback4-lang','--test','mp_reproduction','residual_sequence_parent']),
 ('temp', 'crates/snapback4/src/dev_refusals.rs', '    match fs::remove_file(&temp) { Ok(()) => {}, Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}, Err(e) => return Err(e) }', '', ['-p','snapback4','--test','dev_refusals','a_stale_temporary']),
 ('watermark', 'crates/snapback4/src/dev_refusals.rs', 'if latest != persisted {', 'if false && latest != persisted {', ['-p','snapback4','--test','dev_refusals','blocked_stderr']),
]
for name, relative, before, after, args in cases:
    path = base / relative
    original = path.read_bytes()
    assert original.decode().count(before) == 1, (name, 'not unique')
    try:
        path.write_text(original.decode().replace(before, after))
        with (out / f'mutation-{name}.log').open('w') as log:
            result = subprocess.run(['cargo','test',*args,'--','--nocapture'], cwd=base, env={**os.environ,'CARGO_BUILD_JOBS':'8'}, stdout=log, stderr=subprocess.STDOUT)
        output = (out / f'mutation-{name}.log').read_text()
        assert result.returncode != 0 and 'test result: FAILED.' in output, (name, result.returncode, output[-2000:])
        print(f'{name}: removed repair detected (exit {result.returncode})', flush=True)
    finally:
        path.write_bytes(original)
        assert path.read_bytes() == original
