#!/usr/bin/env python3
"""Build a measurement-only server; restore sources even when compilation fails.
Run sequentially with builds/edits. Stamps are Unix ms on the browser's host.
"""
from pathlib import Path
import os, shutil, subprocess, sys
root = Path(__file__).resolve().parents[3]
originals = {}
clock = 'std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs_f64() * 1000.0'
def patch(rel, old, new, expected=1):
    p = root / rel
    original = p.read_text()
    originals.setdefault(p, original)
    assert original.count(old) == expected, (rel, original.count(old))
    p.write_text(original.replace(old, new, 1))
try:
    patch('crates/snapback4-core/src/engine/mod.rs', '        tx.commit()?;\n        Ok(outcome)', '''        tx.commit()?;
        if let WriteState::Sent { seq, .. } = &outcome.state {
            eprintln!("LU {}", serde_json::json!({"stage":"commit", "name":name, "seq":seq, "at":CLOCK}));
        }
        Ok(outcome)'''.replace('CLOCK', clock))
    patch('crates/snapback4-core/src/engine/timeline/work.rs', '                Ok(()) => {', '''                Ok(()) => {
                    let remaining = tx.get(&timeline.table("Work"), &text(&work, "id")?)?;
                    let lu_done = remaining.as_ref().is_none_or(|row| text(row, "status").ok().as_deref() == Some("done"));''')
    # Both original FIFO and the candidate have success/park commits. Only
    # stamp success; the trace never invents completion for a parked refusal.
    next_line = '                    if rotate {' if 'if rotate {' in (root/'crates/snapback4-core/src/engine/timeline/work.rs').read_text() else '                    return Ok(Some(metered));'
    patch('crates/snapback4-core/src/engine/timeline/work.rs', '                    tx.commit()?;\n'+next_line,
        ('''                    tx.commit()?;
                    eprintln!("LU {}", serde_json::json!({"stage":"delivery", "seq":seq, "at":CLOCK, "kind":text(&work,"kind")?, "event":text(&work,"eventId").ok(), "done":lu_done, "rows":metered.rows_written}));
'''+next_line).replace('CLOCK', clock), expected=2)
    patch('crates/snapback4/src/serve_ephemeral.rs', '''                self.polls.notify_all();
                self.committed.notify_all();''', '''                eprintln!("LU {}", serde_json::json!({"stage":"published", "seq":seq, "at":CLOCK}));
                self.polls.notify_all();
                self.committed.notify_all();'''.replace('CLOCK', clock))
    subprocess.run(['cargo', 'build', '-p', 'snapback4', '--profile', 'production'], cwd=root,
        env={**os.environ, 'LIBSQLITE3_FLAGS':'-USQLITE_ENABLE_MEMORY_MANAGEMENT', 'CARGO_BUILD_JOBS':'12'}, check=True)
    dest = root / 'target' / ('lu-' + sys.argv[1])
    shutil.copy2(root / 'target/production/snapback4', dest)
    print(dest)
finally:
    for p, original in originals.items():
        p.write_text(original)
