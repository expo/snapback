#!/usr/bin/env python3
"""Build a measurement binary, restoring source even on failure. No product hook.

The stamp is immediately after the real SQLite mutation transaction commits,
before returning the outcome or notifying HTTP waiters. Wall-clock milliseconds
share CLOCK_REALTIME with performance.timeOrigin + performance.now in Chromium.
"""
from pathlib import Path
import os, shutil, subprocess

root = Path(__file__).resolve().parents[3]
path = root / 'crates/snapback4-core/src/engine/mod.rs'
original = path.read_text()
needle = '        tx.commit()?;\n        Ok(outcome)'
assert original.count(needle) == 1
stamp = '''        tx.commit()?;
        if std::env::var_os("LL_COMMIT_TRACE").is_some() {
            if let WriteState::Sent { seq, .. } = &outcome.state {
                let at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs_f64() * 1000.0;
                eprintln!("LL_COMMIT {} {} {:.3}", name, seq, at);
            }
        }
        Ok(outcome)'''
try:
    path.write_text(original.replace(needle, stamp))
    subprocess.run(['cargo', 'build', '-p', 'snapback4'], cwd=root,
                   env={**os.environ, 'LIBSQLITE3_FLAGS': '-USQLITE_ENABLE_MEMORY_MANAGEMENT'}, check=True)
    shutil.copy2(root / 'target/debug/snapback4', root / 'target/debug/snapback4-ll-measure')
finally:
    path.write_text(original)
