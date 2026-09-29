"""Temporary measurement hooks; remove before testing/committing product sources.

Combines SQ's cache/request queue diagnostics with exact per-request CPU and
per-kind maintenance CPU. No scheduler, meter, transaction or budget changes.
"""
import pathlib, subprocess, sys

root = pathlib.Path(__file__).resolve().parents[4]
src = root / 'snapback4/crates/snapback4/src'
sq = root / 'snapback4/reports/20260929-sq-storage-read-path/tools/diagnostic.py'
remove = '--remove' in sys.argv
if not remove and ((src/'bp_diagnostic.rs').exists() or (src/'sq_diagnostic.rs').exists()):
    raise RuntimeError('diagnostics already installed; remove them before applying again')
edits = {
    'main.rs': [('mod assets;', 'mod bp_diagnostic;\nmod assets;')],
    'latency.rs': [
        ('    pub fn run(mut self, handle: impl FnOnce()) {',
         '    pub fn run(mut self, handle: impl FnOnce()) {\n        let _bp = crate::bp_diagnostic::request(&self.path);'),
    ],
    'serve_maintenance.rs': [
        ('fn engine_work<T>(shared: &Shared, run:', 'fn engine_work<T>(shared: &Shared, kind: &\'static str, run:'),
        ('    let mut engine = shared.engine.background();',
         '    let _bp = crate::bp_diagnostic::background(kind);\n    let mut engine = shared.engine.background();'),
    ],
}
for method, kind in [('run_view_chunk_for', 'recount'), ('sweep_expired_for', 'expiry'),
                     ('fire_schedules', 'schedules'), ('run_timeline_chunk_for', 'following'),
                     ('requeue_expired_actions_for', 'action-lease'),
                     ('requeue_expired_effects_for', 'effect-lease'),
                     ('prepare_asset_sweep_for', 'asset-prepare'), ('finish_asset_sweep_for', 'asset-finish')]:
    for budget in ['budget', '_']:
        a = f'engine_work(shared, |engine, {budget}| engine.{method}'
        edits['serve_maintenance.rs'].append((a, a.replace('shared, |', f'shared, "{kind}", |')))
edits['serve_maintenance.rs'].append(('engine_work(shared, |engine, budget| {', 'engine_work(shared, "job", |engine, budget| {'))
if not remove:
    subprocess.run([sys.executable, str(sq)], check=True)
for name, pairs in edits.items():
    p = src / name
    s = p.read_text()
    for a, b in pairs:
        if remove: a, b = b, a
        s = s.replace(a, b)
    p.write_text(s)
p = src / 'bp_diagnostic.rs'
if remove:
    p.unlink()
    subprocess.run([sys.executable, str(sq), '--remove'], check=True)
else:
    p.write_text(r'''//! Measurement only; see the lane BP report tools.
use std::{cell::RefCell, collections::BTreeMap, time::{Duration, Instant}};
fn cpu() -> u64 {
    let mut t = libc::timespec { tv_sec: 0, tv_nsec: 0 };
    assert_eq!(unsafe { libc::clock_gettime(libc::CLOCK_THREAD_CPUTIME_ID, &mut t) }, 0);
    t.tv_sec as u64 * 1_000_000_000 + t.tv_nsec as u64
}
fn tid() -> u64 { unsafe { libc::syscall(libc::SYS_gettid) as u64 } }
fn at() -> f64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs_f64() }
fn sched() -> Vec<u64> {
    std::fs::read_to_string("/proc/thread-self/schedstat").unwrap_or_default()
        .split_whitespace().filter_map(|v| v.parse().ok()).collect()
}
pub struct Span { kind: String, start: Instant, cpu: u64, request: bool, sched: Vec<u64> }
pub fn request(kind: &str) -> Span {
    Span { kind: kind.into(), start: Instant::now(), cpu: cpu(), request: true,
        sched: if kind.starts_with("/q/") { sched() } else { Vec::new() } }
}
pub fn background(kind: &str) -> Span {
    Span { kind: kind.into(), start: Instant::now(), cpu: cpu(), request: false, sched: Vec::new() }
}
thread_local! { static BACKGROUND: RefCell<(Instant, BTreeMap<String, [u64; 3]>)> = RefCell::new((Instant::now(), BTreeMap::new())); }
impl Drop for Span {
    fn drop(&mut self) {
        let used = cpu() - self.cpu;
        let wall = self.start.elapsed().as_nanos() as u64;
        if self.request {
            let end = if self.sched.is_empty() { Vec::new() } else { sched() };
            let delta: Vec<_> = end.iter().zip(&self.sched).map(|(a,b)| a.saturating_sub(*b)).collect();
            eprintln!("BP_REQUEST {}", serde_json::json!({"at":at(),"tid":tid(),"op":self.kind,"cpuNs":used,"wallNs":wall,"schedDelta":delta}));
        } else {
            BACKGROUND.with(|state| {
                let mut state = state.borrow_mut();
                let entry = state.1.entry(self.kind.clone()).or_default();
                entry[0] += 1; entry[1] += used; entry[2] += wall;
                if state.0.elapsed() >= Duration::from_secs(1) {
                    eprintln!("BP_BACKGROUND {}",serde_json::json!({"at":at(),"tid":tid(),"kinds":state.1}));
                    state.0 = Instant::now();
                }
            });
        }
    }
}
''')
