#!/usr/bin/env python3
"""Apply/restore an UNCOMMITTED timing-only product patch for S1-DX.

This experiment keeps all product changes out of Git. Backups and the exact
patch remain in an ignored owned target. Refuses concurrent/unrelated edits.
"""
import argparse
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[3]
SAVE = ROOT/'target/s1dx-local-patch'
CORE = 'crates/snapback4-core/src/'
CLI = 'crates/snapback4/src/'

MODULE = '''//! Local S1-DX timing only; never committed or published.
use std::{cell::RefCell, time::Instant};
thread_local! { static METRICS: RefCell<Option<[u64; 8]>> = const { RefCell::new(None) }; }
pub fn reset() { METRICS.with(|x| *x.borrow_mut() = Some([0; 8])); }
pub fn take() -> [u64; 8] { METRICS.with(|x| x.borrow_mut().take().unwrap_or([0; 8])) }
pub struct Span(usize, Option<Instant>);
pub fn span(stage: usize) -> Span {
    Span(stage, METRICS.with(|x| x.borrow().as_ref().map(|_| Instant::now())))
}
impl Drop for Span {
    fn drop(&mut self) { if let Some(start) = self.1 {
        let ns = start.elapsed().as_nanos() as u64;
        METRICS.with(|x| { if let Some(m) = x.borrow_mut().as_mut() {
            m[self.0] += ns;
            if self.0 == 3 { m[6] += 1; }
            if self.0 == 0 { m[7] += 1; }
        } });
    } }
}
'''


def apply():
    SAVE.mkdir(parents=True, exist_ok=False)
    originals = {}
    modified = {}

    def edit(path, old, new):
        full = ROOT/path
        if path not in originals:
            originals[path] = full.read_text()
        text = modified.get(path, originals[path])
        assert text.count(old) == 1, (path, old, text.count(old))
        modified[path] = text.replace(old, new)

    edit(CORE+'lib.rs', 'pub mod assets;', 'pub mod dx_timing;\npub mod assets;')
    edit(CORE+'engine/mod.rs',
         'pub fn mutate(&mut self, name: &str, op: Option<&str>, mut context: Context) -> Result<MutationOutcome, RuntimeError> {',
         'pub fn mutate(&mut self, name: &str, op: Option<&str>, mut context: Context) -> Result<MutationOutcome, RuntimeError> {\n        let _dx = crate::dx_timing::span(2);')
    edit(CORE+'engine/mod.rs', 'let ran = runner.run(&program).and_then(|value| {',
         'let dx_program = crate::dx_timing::span(1);\n            let ran = runner.run(&program).and_then(|value| {')
    edit(CORE+'engine/mod.rs', 'let metered = runner.meter.used;\n            let tables:',
         'drop(dx_program);\n            let metered = runner.meter.used;\n            let tables:')
    edit(CORE+'store.rs', 'pub fn commit(self) -> Result<(), RuntimeError> {\n        self.tx.commit()?;',
         'pub fn commit(self) -> Result<(), RuntimeError> {\n        let _dx = crate::dx_timing::span(3);\n        self.tx.commit()?;')
    edit(CORE+'store.rs', 'pub fn transaction(&mut self) -> Result<Tx<\'_>, RuntimeError> {',
         'pub fn transaction(&mut self) -> Result<Tx<\'_>, RuntimeError> {\n        let _dx = crate::dx_timing::span(4);')
    settings = '''
        if let Some(path) = std::env::var_os("SB4_DX_SETTINGS") {
            use std::io::Write;
            let mut values = serde_json::Map::new();
            for name in ["synchronous", "wal_autocheckpoint", "page_size", "cache_size"] {
                let value: i64 = conn.query_row(&format!("PRAGMA {name}"), [], |r| r.get(0))?;
                values.insert(name.into(), serde_json::json!(value));
            }
            let mode: String = conn.query_row("PRAGMA journal_mode", [], |r| r.get(0))?;
            values.insert("journal_mode".into(), serde_json::json!(mode));
            writeln!(std::fs::OpenOptions::new().create(true).append(true).open(path).unwrap(), "{}", serde_json::Value::Object(values)).unwrap();
        }
'''
    edit(CORE+'store.rs', 'conn.execute_batch("PRAGMA synchronous = FULL; PRAGMA foreign_keys = OFF;")?;',
         'conn.execute_batch("PRAGMA synchronous = FULL; PRAGMA foreign_keys = OFF;")?;'+settings)
    edit(CLI+'serve_identity.rs', 'let resolve = |engine: &Engine, identity: Option<&str>, detached: bool| {',
         'let resolve = |engine: &Engine, identity: Option<&str>, detached: bool| {\n            let _dx = snapback4_core::dx_timing::span(0);')
    edit(CLI+'serve_trace.rs', 'if !dev || output().is_none() { return None; }',
         'if output().is_none() || (!dev && std::env::var_os("SB4_DX_TIMING").is_none()) { return None; }')
    edit(CLI+'serve_trace.rs', 'let id = request.headers().iter().find(|h| h.field.equiv("x-snapback-ct"))?.value.as_str().parse().ok()?;',
         'let id = request.headers().iter().find(|h| h.field.equiv("x-snapback-ct")).and_then(|h| h.value.as_str().parse().ok()).unwrap_or_else(now);')
    edit(CLI+'serve_trace.rs', 'id: u64, accepted: u64, dispatched: u64, started: u64,',
         'dx: [u64; 8], id: u64, accepted: u64, dispatched: u64, started: u64,')
    edit(CLI+'serve_trace.rs', 'Some(Self { id, accepted:', 'Some(Self { dx: [0; 8], id, accepted:')
    edit(CLI+'serve_trace.rs', 'self.started = now();',
         'snapback4_core::dx_timing::reset();\n        self.started = now();')
    edit(CLI+'serve_trace.rs', 'trace.cpu_end = cpu();',
         'trace.dx = snapback4_core::dx_timing::take();\n                    trace.cpu_end = cpu();')
    # Capture is also guarded at its call site; permit only explicit DX env.
    edit(CLI+'serve.rs', 'trace::Trace::capture(&request, shared.personas && loopback_listener)',
         'trace::Trace::capture(&request, (shared.personas && loopback_listener) || std::env::var_os("SB4_DX_TIMING").is_some())')
    (SAVE/'originals.json').write_text(json.dumps(originals))
    (SAVE/'modified.json').write_text(json.dumps(modified))
    for path, text in modified.items(): (ROOT/path).write_text(text)
    (ROOT/CORE/'dx_timing.rs').write_text(MODULE)
    patch = subprocess.check_output(['git','diff','--',*[str(ROOT/p) for p in modified]],cwd=ROOT)
    (SAVE/'measurement.patch').write_bytes(patch)
    (SAVE/'dx_timing.rs').write_text(MODULE)
    print('Applied LOCAL UNCOMMITTED timing patch:', SAVE)


def restore():
    originals = json.loads((SAVE/'originals.json').read_text())
    modified = json.loads((SAVE/'modified.json').read_text())
    for path, text in modified.items(): assert (ROOT/path).read_text() == text, path
    for path, text in originals.items(): (ROOT/path).write_text(text)
    assert (ROOT/CORE/'dx_timing.rs').read_text() == MODULE
    (ROOT/CORE/'dx_timing.rs').unlink()
    print('Restored original product source; measurement patch retained:', SAVE)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('mode', choices=['apply', 'restore'])
    p.add_argument('--backup-dir', type=Path, help='new owned directory for a replay patch/backup')
    args = p.parse_args()
    if args.backup_dir: SAVE=args.backup_dir.resolve()
    (apply if args.mode == 'apply' else restore)()
