//! The live server owns latency; doctor never samples by running operations.
// @ref LLP 3000.019#3.7 — a short default summary, all operations on request, dev-only reset.
use super::{Options, adoption, work_records};
use crate::{project::Project, serve::latency::Snapshot};
use serde_json::Value;

pub(super) fn read(_project: &Project, host: &Value, reset: bool) -> Option<Snapshot> {
    let path = if reset { format!("/dev/latency/reset?store_id={}", host["storeId"].as_str()?) } else { "/dev/latency".into() };
    let response = adoption::request_port(u16::try_from(host["port"].as_u64()?).ok()?, if reset { "POST" } else { "GET" }, &path)?;
    if response["storeId"] != host["storeId"] { return None; }
    serde_json::from_value(response).ok()
}
pub(super) fn lines(snapshot: &Snapshot, all: bool) -> Vec<String> {
    let mut operations: Vec<_> = snapshot.operations.iter().filter(|(_, op)| all || op.n > 0).collect();
    operations.sort_by(|(an, a), (bn, b)| b.total.p95.total_cmp(&a.total.p95).then_with(|| an.cmp(bn)));
    let mut lines = vec![format!("latency   since {} (Unix ms); total / engine wait in ms", snapshot.since)];
    for (name, op) in operations.into_iter().take(if all { usize::MAX } else { 3 }) {
        lines.push(format!("latency   {name}: n={} refused={} total p50={:.3} p95={:.3} p99={:.3} max={:.3}; wait p50={:.3} p95={:.3} p99={:.3} max={:.3}", op.n, op.refused, op.total.p50, op.total.p95, op.total.p99, op.total.max, op.wait.p50, op.wait.p95, op.wait.p99, op.wait.max));
    }
    if let Some((name, op)) = snapshot.operations.iter().filter(|(_, op)| op.n > 0).max_by(|(_, a), (_, b)| a.wait.max.total_cmp(&b.wait.max)) {
        lines.push(format!("latency   worst wait: {name} {:.3} ms (p95 {:.3} ms)", op.wait.max, op.wait.p95));
    } else { lines.push("latency   no completed operations in this window".into()); }
    lines
}
pub(super) fn doctor(options: &Options) -> i32 {
    let fail = |message: &str| { eprintln!("E_INPUT at doctor --latency: {message}"); 1 };
    if !options.flags.contains_key("latency") { return fail("--reset requires --latency; run snapback4 doctor --latency --reset"); }
    if options.flags.contains_key("release") { return fail("doctor latency uses a running dev server; run snapback4 dev and snapback4 doctor --latency (serve inspection uses GET /dev/latency with a service token)"); }
    let project = match work_records::project(options) { Ok(project) => project, Err(error) => return fail(&error.to_string()) };
    let host = match if options.flags.contains_key("store") {
        snapback4_core::Store::open_read_only(&work_records::store_path(options)).ok()
            .and_then(|store| store.meta("store_id").ok().flatten()).and_then(|id| adoption::host(&project, &id))
    } else { adoption::project_host(&project) } {
        Some(host) => host,
        None => return fail("no running dev server for this store; start snapback4 dev, then retry snapback4 doctor --latency"),
    };
    let Some(snapshot) = read(&project, &host, options.flags.contains_key("reset")) else { return fail("the dev server did not return latency; restart snapback4 dev with this CLI, then retry snapback4 doctor --latency"); };
    if options.json { println!("{}", serde_json::to_string(&snapshot).unwrap()); }
    else { for line in lines(&snapshot, true) { println!("{line}"); } }
    0
}
