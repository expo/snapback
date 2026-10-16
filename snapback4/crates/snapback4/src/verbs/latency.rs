//! The live server owns latency; doctor never samples by running operations.
// @ref LLP 3000.019#3.7 — a short default summary, all operations on request, dev-only reset.
use super::{Options, adoption, work_records};
use crate::serve::latency::Snapshot;
use serde_json::Value;

pub(super) fn read(host: &Value, reset: bool) -> Option<Snapshot> {
    let path = if reset { format!("/dev/latency/reset?store_id={}", host["storeId"].as_str()?) } else { "/dev/latency".into() };
    let instance=if reset && host["_explicitSelection"]!=true {host["instance"].as_str()} else {None};
    let response = adoption::request_instance(host["address"].as_str()?.parse().ok()?, if reset { "POST" } else { "GET" }, &path, instance)?;
    if response["storeId"] != host["storeId"] { return None; }
    serde_json::from_value(response).ok()
}
pub(super) fn lines(snapshot: &Snapshot, all: bool) -> Vec<String> {
    let mut operations: Vec<_> = snapshot.operations.iter().filter(|(_, op)| all || op.n > 0).collect();
    operations.sort_by(|(an, a), (bn, b)| b.total.p95.total_cmp(&a.total.p95).then_with(|| an.cmp(bn)));
    let mut lines = vec![format!("latency   since {} (Unix ms); total / acquisition wait / engine / thread CPU in ms", snapshot.since)];
    for (name, op) in operations.into_iter().take(if all { usize::MAX } else { 3 }) {
        lines.push(format!("latency   {name}: n={} refused={} total p50={:.3} p95={:.3} p99={:.3} max={:.3}; wait p50={:.3} p95={:.3} p99={:.3} max={:.3}", op.n, op.refused, op.total.p50, op.total.p95, op.total.p99, op.total.max, op.wait.p50, op.wait.p95, op.wait.p99, op.wait.max));
        let last = lines.last_mut().unwrap();
        last.push_str(&format!("; engine p50={:.3} p95={:.3} p99={:.3} max={:.3}", op.engine.p50, op.engine.p95, op.engine.p99, op.engine.max));
        match &op.cpu {
            _ if op.n == 0 => last.push_str("; cpu n=0"),
            Some(cpu) => last.push_str(&format!("; cpu n={} p50={:.3} p95={:.3} p99={:.3} max={:.3}", op.cpu_n, cpu.p50, cpu.p95, cpu.p99, cpu.max)),
            None => last.push_str("; cpu unavailable"),
        }
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
    let host = match adoption::host(&project, options) {
        Ok(Some(host)) => host,
        Ok(None) => return fail(adoption::NO_HOST),
        Err(error) => return fail(&error),
    };
    let Some(snapshot) = read(&host, options.flags.contains_key("reset")) else { return fail("the dev server did not return latency; restart snapback4 dev with this CLI, then retry snapback4 doctor --latency"); };
    if options.json { println!("{}", serde_json::to_string(&snapshot).unwrap()); }
    else { for line in lines(&snapshot, true) { println!("{line}"); } }
    0
}
