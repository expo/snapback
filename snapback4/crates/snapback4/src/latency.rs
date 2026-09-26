//! Bounded, process-local operation timings. No engine or row data is retained.
// @ref LLP 3000.019#3.7 — one fixed histogram pair per declared operation and fixed route.
use super::{Shared, lock};
use serde::Serialize;
use serde_json::{Value, json};
use snapback4_core::ir::ProgramKind;
use snapback4_lang::Bound;
use std::{cell::Cell, collections::{BTreeMap, BTreeSet}, sync::{Arc, Mutex}, time::{Duration, Instant}};
use tiny_http::{Method, Request};

const BINS: usize = 480;
const EDGES: [u64; BINS] = {
    let mut edges = [0u64; BINS];
    let mut i = 1;
    while i < BINS {
        let previous = edges[i - 1];
        edges[i] = previous.saturating_add(if previous / 10 > 0 { previous / 10 } else { 1 });
        i += 1;
    }
    edges
};

#[derive(Clone)]
struct Histogram { bins: [u64; BINS], n: u64, max: u64 }
impl Default for Histogram {
    fn default() -> Self { Self { bins: [0; BINS], n: 0, max: 0 } }
}
impl Histogram {
    fn record(&mut self, duration: Duration) {
        let ns = duration.as_nanos().min(u64::MAX as u128) as u64;
        let index = EDGES.partition_point(|edge| *edge < ns).min(BINS - 1);
        self.bins[index] = self.bins[index].saturating_add(1);
        self.n = self.n.saturating_add(1);
        self.max = self.max.max(ns);
    }
    fn percentile(&self, percent: u64) -> f64 {
        if self.n == 0 { return 0.0; }
        let rank = (self.n as u128 * percent as u128).div_ceil(100) as u64;
        let mut seen = 0u64;
        for (index, count) in self.bins.iter().enumerate() {
            seen = seen.saturating_add(*count);
            if seen >= rank {
                let low = if index == 0 { 0 } else { EDGES[index - 1] + 1 };
                let middle = low as f64 + (EDGES[index] - low) as f64 / 2.0;
                return middle.min(self.max as f64) / 1_000_000.0;
            }
        }
        self.max as f64 / 1_000_000.0
    }
    fn summary(&self) -> Distribution {
        Distribution { p50: self.percentile(50), p95: self.percentile(95), p99: self.percentile(99), max: self.max as f64 / 1_000_000.0 }
    }
}
#[derive(Default, Clone)]
struct Operation { total: Histogram, wait: Histogram, refused: u64 }
#[derive(Serialize, serde::Deserialize, Debug)]
pub(crate) struct Distribution { pub p50: f64, pub p95: f64, pub p99: f64, pub max: f64 }
#[derive(Serialize, serde::Deserialize, Debug)]
pub(crate) struct Summary { pub n: u64, pub refused: u64, pub total: Distribution, pub wait: Distribution }
#[derive(Serialize, serde::Deserialize, Debug)]
pub(crate) struct Snapshot { pub since: i64, pub operations: BTreeMap<String, Summary> }
struct Window { since: i64, started: Instant, operations: BTreeMap<String, Operation> }
pub(crate) struct Registry(Mutex<Window>, #[cfg(test)] std::sync::atomic::AtomicBool);

const FIXED: &[&str] = &["/sync", "/changes", "/assets (upload)", "/assets (download)", "/q/<unknown>", "/m/<unknown>", "/a/<unknown>"];
fn names(bound: &Bound) -> BTreeSet<String> {
    FIXED.iter().map(|s| s.to_string()).chain(bound.programs.iter().filter_map(|p| {
        let prefix = match p.program.kind { ProgramKind::Query => "q", ProgramKind::Mutation => "m", ProgramKind::Action => "a", ProgramKind::Job => return None };
        Some(format!("/{prefix}/{}", p.program.name))
    })).collect()
}
impl Registry {
    pub fn new(bound: &Bound) -> Self {
        Self(Mutex::new(Window { since: snapback4_core::now_ms(), started: Instant::now(), operations: names(bound).into_iter().map(|name| (name, Operation::default())).collect() }), #[cfg(test)] std::sync::atomic::AtomicBool::new(true))
    }
    #[cfg(test)]
    pub fn measure_enabled(&self, enabled: bool) { self.1.store(enabled, std::sync::atomic::Ordering::Relaxed); }
    pub fn adopt(&self, bound: &Bound) {
        let names = names(bound);
        let mut window = lock(&self.0);
        window.operations.retain(|name, _| names.contains(name));
        for name in names { window.operations.entry(name).or_default(); }
    }
    pub fn snapshot(&self, reset: bool) -> Snapshot {
        // Copy the fixed arrays under the lock; percentile scans/JSON never hold it.
        let (since, operations) = {
            let mut window = lock(&self.0);
            if reset {
                window.since = snapback4_core::now_ms();
                window.started = Instant::now();
                for op in window.operations.values_mut() { *op = Operation::default(); }
            }
            (window.since, window.operations.clone())
        };
        Snapshot { since, operations: operations.into_iter().map(|(name, op)| (name, Summary { n: op.total.n, refused: op.refused, total: op.total.summary(), wait: op.wait.summary() })).collect() }
    }
    fn record(&self, path: &str, accepted: Instant, total: Duration, wait: Duration, refused: bool) {
        let mut window = lock(&self.0);
        // A reset starts a new arrival window, excluding old in-flight requests.
        if accepted < window.started { return; }
        let key = if window.operations.contains_key(path) { path }
            else if path.starts_with("/q/") { "/q/<unknown>" }
            else if path.starts_with("/m/") { "/m/<unknown>" }
            else if path.starts_with("/a/") { "/a/<unknown>" }
            else { return; };
        let op = window.operations.get_mut(key).unwrap();
        op.total.record(total);
        op.wait.record(wait);
        op.refused = op.refused.saturating_add(u64::from(refused));
    }
}

#[derive(Clone, Copy)]
struct Timing { accepted: Instant, wait: Option<Duration>, finished: Option<(Duration, bool)> }
thread_local! { static CURRENT: Cell<Option<Timing>> = const { Cell::new(None) }; }

/// Created before worker admission so refused admission and thread creation
/// failures count too. Accepted time originates before HTTP body prebuffering.
pub(super) struct Sample { registry: Arc<Registry>, path: String, accepted: Instant, timing: Option<Timing> }
impl Sample {
    pub fn new(request: &Request, registry: &Arc<Registry>) -> Option<Self> {
        #[cfg(test)]
        if !registry.1.load(std::sync::atomic::Ordering::Relaxed) { return None; }
        let path = request.url().split('?').next().unwrap_or("");
        let path = match (request.method(), path) {
            (Method::Post, "/sync") | (Method::Get, "/changes") => path,
            (Method::Post, "/assets") => "/assets (upload)",
            (Method::Get, path) if path.starts_with("/assets/") => "/assets (download)",
            (Method::Post, path) if ["/q/", "/m/", "/a/"].iter().any(|prefix| path.starts_with(prefix)) => path,
            _ => return None,
        };
        Some(Self { registry: registry.clone(), path: path.to_owned(), accepted: request.accepted_at(), timing: None })
    }
    pub fn run(mut self, handle: impl FnOnce()) {
        let timing = Timing { accepted: self.accepted, wait: None, finished: None };
        CURRENT.with(|current| { assert!(current.get().is_none()); current.set(Some(timing)); });
        // The guard also clears thread-local state if the handler unwinds.
        struct Clear<'a>(&'a mut Sample);
        impl Drop for Clear<'_> { fn drop(&mut self) { self.0.timing = CURRENT.with(|current| current.take()); } }
        let _clear = Clear(&mut self);
        handle();
    }
}
impl Drop for Sample {
    fn drop(&mut self) {
        let (total, refused) = self.timing.and_then(|t| t.finished).unwrap_or_else(|| (self.accepted.elapsed(), true));
        let wait = self.timing.and_then(|t| t.wait).unwrap_or_default();
        self.registry.record(&self.path, self.accepted, total, wait, refused);
    }
}
// @ref LLP 3000.019#3.7 — measure the first engine acquisition, including authentication.
pub(super) fn acquired() {
    CURRENT.with(|current| { if let Some(mut timing) = current.get() && timing.wait.is_none() { timing.wait = Some(timing.accepted.elapsed()); current.set(Some(timing)); } });
}
pub(crate) fn finished(refused: bool) {
    CURRENT.with(|current| { if let Some(mut timing) = current.get() && timing.finished.is_none() { timing.finished = Some((timing.accepted.elapsed(), refused)); current.set(Some(timing)); } });
}

/// Classify only the envelope; user data and synced row values are never walked.
pub(crate) trait Reply: Serialize { fn refused(&self) -> bool { false } }
impl Reply for Value {
    fn refused(&self) -> bool { self.get("denied").is_some_and(|v| !v.is_null()) || self.get("state").and_then(Value::as_str) == Some("failed") }
}
impl Reply for crate::sync_wire::SnapshotReply {}
impl Reply for crate::sync_wire::StreamReply {}

pub(super) fn endpoint(request: Request, shared: &Shared, reset: bool) {
    if reset && !shared.personas {
        return super::respond(request, 403, json!({"denied": snapback4_core::error::Refusal::new("E_AUTH", "auth", "latency reset at /dev/latency/reset requires dev; run snapback4 dev").site("/dev/latency/reset").rewrite("run snapback4 dev, then snapback4 doctor --latency --reset")}));
    }
    if !shared.personas && let Err(why) = super::service_of(&request, shared) {
        return super::respond(request, 401, json!({"denied": why.site("/dev/latency").rewrite("send Authorization: Bearer <token> from snapback4 token --service <name>")}));
    }
    let store_id = lock(&shared.adoption).store_id.clone();
    // Doctor binds its mutation to the store it inspected, even if the listener
    // port was reused between the status read and this POST.
    if reset && super::query_params(request.url()).get("store_id").is_some_and(|id| id != &store_id) {
        return super::respond(request, 409, json!({"denied": snapback4_core::error::Refusal::new("E_STORE_REPLACED", "store", "the dev server store changed before latency reset").site("/dev/latency/reset").rewrite("retry snapback4 doctor --latency --reset against the current dev server")}));
    }
    let mut snapshot = serde_json::to_value(shared.latency.snapshot(reset)).unwrap();
    snapshot["storeId"] = json!(store_id);
    super::respond(request, 200, snapshot);
}

#[cfg(test)]
#[path = "../tests/latency/histogram.rs"]
mod tests;
