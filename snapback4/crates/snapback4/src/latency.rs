//! Bounded, process-local operation timings. No engine or row data is retained.
// @ref LLP 3000.019#3.7 — fixed histograms per declared operation and fixed route.
use super::{Shared, lock};
use serde::Serialize;
use serde_json::{Value, json};
use snapback4_core::ir::ProgramKind;
use snapback4_lang::Bound;
use std::{cell::Cell, collections::{BTreeMap, BTreeSet}, sync::{Arc, Mutex}, time::{Duration, Instant}};
use tiny_http::{Header, Method, Request};

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
struct Operation { total: Histogram, wait: Histogram, engine: Histogram, cpu: Histogram, refused: u64 }
#[derive(Serialize, serde::Deserialize, Debug)]
pub(crate) struct Distribution { pub p50: f64, pub p95: f64, pub p99: f64, pub max: f64 }
#[derive(Serialize, serde::Deserialize, Debug)]
pub(crate) struct Summary { pub n: u64, pub refused: u64, pub total: Distribution, pub wait: Distribution, pub engine: Distribution, pub cpu: Option<Distribution>, pub cpu_n: u64 }
#[derive(Serialize, serde::Deserialize, Debug)]
pub(crate) struct Snapshot { pub since: i64, pub operations: BTreeMap<String, Summary> }
struct Window { since: i64, started: Instant, operations: BTreeMap<String, Arc<Mutex<Operation>>> }
pub(crate) struct Registry(Mutex<Arc<Window>>, Mutex<()>, #[cfg(test)] std::sync::atomic::AtomicBool);

const FIXED: &[&str] = &["/sync", "/changes", "/assets (upload)", "/assets (download)", "/q/<unknown>", "/m/<unknown>", "/a/<unknown>"];
fn names(bound: &Bound) -> BTreeSet<String> {
    FIXED.iter().map(|s| s.to_string()).chain(bound.programs.iter().filter_map(|p| {
        let prefix = match p.program.kind { ProgramKind::Query => "q", ProgramKind::Mutation => "m", ProgramKind::Action => "a", ProgramKind::Job => return None };
        Some(format!("/{prefix}/{}", p.program.name))
    })).collect()
}
impl Registry {
    pub fn new(bound: &Bound) -> Self {
        Self(Mutex::new(Arc::new(Window { since: snapback4_core::now_ms(), started: Instant::now(), operations: names(bound).into_iter().map(|name| (name, Arc::default())).collect() })), Mutex::new(()), #[cfg(test)] std::sync::atomic::AtomicBool::new(true))
    }
    #[cfg(test)]
    pub fn measure_enabled(&self, enabled: bool) { self.2.store(enabled, std::sync::atomic::Ordering::Relaxed); }
    pub fn adopt(&self, bound: &Bound) {
        let _update = lock(&self.1);
        let old = lock(&self.0).clone();
        let operations = names(bound).into_iter().map(|name| {
            let op = old.operations.get(&name).cloned().unwrap_or_default();
            (name, op)
        }).collect();
        *lock(&self.0) = Arc::new(Window { since: old.since, started: old.started, operations });
    }
    pub fn snapshot(&self, reset: bool) -> Snapshot {
        let window = if reset {
            let _update = lock(&self.1);
            let old = lock(&self.0).clone();
            let operations = old.operations.keys().map(|name| (name.clone(), Arc::default())).collect();
            let mut current = lock(&self.0);
            let next = Arc::new(Window { since: snapback4_core::now_ms(), started: Instant::now(), operations });
            *current = next.clone();
            next
        } else { lock(&self.0).clone() };
        // @ref LLP 3000.019#3.7 — topology is an O(1) Arc capture; copy just one
        // fixed histograms under its own lock. No registry-sized recording stall.
        Snapshot { since: window.since, operations: window.operations.iter().map(|(name, op)| {
            let op = lock(op).clone();
            (name.clone(), Summary { n: op.total.n, refused: op.refused, total: op.total.summary(), wait: op.wait.summary(), engine: op.engine.summary(), cpu: (op.total.n == 0 || op.cpu.n > 0).then(|| op.cpu.summary()), cpu_n: op.cpu.n })
        }).collect() }
    }
    fn record(&self, path: &str, accepted: Instant, total: Duration, wait: Duration, engine: Duration, cpu: Option<Duration>, refused: bool) {
        let window = lock(&self.0).clone();
        // A reset starts a new arrival window, excluding old in-flight requests.
        if accepted < window.started { return; }
        let key = if window.operations.contains_key(path) { path }
            else if path.starts_with("/q/") { "/q/<unknown>" }
            else if path.starts_with("/m/") { "/m/<unknown>" }
            else if path.starts_with("/a/") { "/a/<unknown>" }
            else { return; };
        let mut op = lock(&window.operations[key]);
        op.total.record(total);
        op.wait.record(wait);
        op.engine.record(engine);
        if let Some(cpu) = cpu { op.cpu.record(cpu); }
        op.refused = op.refused.saturating_add(u64::from(refused));
    }
}

// @ref LLP 3000.019#3.7 — wall spans and thread CPU describe this request only.
#[derive(Clone, Copy)]
struct Timing {
    accepted: Instant, wait: Duration, engine: Duration,
    engine_started: Option<Instant>, depth: usize, acquiring: bool, cpu_start: Option<Duration>,
    headers: bool, finished: Option<(Duration, bool, Option<Duration>, Duration)>,
}
impl Timing {
    fn engine_elapsed(&self) -> Duration {
        self.engine + self.engine_started.map_or(Duration::ZERO, |at| at.elapsed())
    }
    fn cpu_elapsed(&self) -> Option<Duration> { thread_cpu()?.checked_sub(self.cpu_start?) }
}
thread_local! { static CURRENT: Cell<Option<Timing>> = const { Cell::new(None) }; }

// Linux and Darwin expose a monotonic CPU clock for the calling thread.
// An unavailable clock is absent, never a made-up zero or process-wide CPU.
pub(super) fn thread_cpu() -> Option<Duration> {
    #[cfg(test)]
    if tests::MISSING_CLOCK.get() { return None; }
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        let mut time = libc::timespec { tv_sec: 0, tv_nsec: 0 };
        if unsafe { libc::clock_gettime(libc::CLOCK_THREAD_CPUTIME_ID, &mut time) } == 0
            && time.tv_sec >= 0 && (0..1_000_000_000).contains(&time.tv_nsec) {
            return Some(Duration::new(time.tv_sec as u64, time.tv_nsec as u32));
        }
    }
    None
}

/// Created before worker admission; aborted admission counts without a header.
/// Accepted time originates before HTTP body prebuffering.
pub(super) struct Sample { registry: Arc<Registry>, path: String, accepted: Instant, timing: Option<Timing>, headers: bool }
impl Sample {
    #[cfg(test)]
    pub fn new(request: &Request, registry: &Arc<Registry>) -> Option<Self> {
        Self::with_headers(request, registry, false)
    }
    pub fn with_headers(request: &Request, registry: &Arc<Registry>, headers: bool) -> Option<Self> {
        #[cfg(test)]
        if !registry.2.load(std::sync::atomic::Ordering::Relaxed) { return None; }
        let path = request.url().split('?').next().unwrap_or("");
        let path = match (request.method(), path) {
            (Method::Post, "/sync") | (Method::Get, "/changes") => path,
            (Method::Post, "/assets") => "/assets (upload)",
            (Method::Get, path) if path.starts_with("/assets/") => "/assets (download)",
            (Method::Post, path) if ["/q/", "/m/", "/a/"].iter().any(|prefix| path.starts_with(prefix)) => path,
            _ if headers => "", // Timing on other dev responses, no new registry names.
            _ => return None,
        };
        Some(Self { registry: registry.clone(), path: path.to_owned(), accepted: request.accepted_at(), timing: None, headers })
    }
    pub fn run(mut self, handle: impl FnOnce()) {
        let timing = Timing { accepted: self.accepted, wait: Duration::ZERO, engine: Duration::ZERO,
            engine_started: None, depth: 0, acquiring: false, cpu_start: thread_cpu(), headers: self.headers, finished: None };
        CURRENT.with(|current| { assert!(current.get().is_none()); current.set(Some(timing)); });
        struct Clear<'a>(&'a mut Sample);
        impl Drop for Clear<'_> { fn drop(&mut self) {
            finished(true);
            self.0.timing = CURRENT.with(|current| current.take());
        } }
        let _clear = Clear(&mut self);
        handle();
    }
}
impl Drop for Sample {
    fn drop(&mut self) {
        let (total, refused, cpu, engine) = self.timing.and_then(|t| t.finished)
            .unwrap_or_else(|| (self.accepted.elapsed(), true, None, Duration::ZERO));
        let wait = self.timing.map_or(Duration::ZERO, |t| t.wait);
        self.registry.record(&self.path, self.accepted, total, wait, engine, cpu, refused);
    }
}
// Finish before automatic response/body cleanup on an unanswered handler.
pub(super) struct FinishOnDrop;
impl Drop for FinishOnDrop { fn drop(&mut self) { finished(true); } }

/// Reader/writer ownership, including authentication and response-head reads.
/// Nested ownership counts once; no span includes a wait for a change poll.
pub(super) struct EngineSpan(bool);
impl EngineSpan {
    pub fn new() -> Self {
        Self(CURRENT.with(|current| {
            let Some(mut timing) = current.get().filter(|t| t.finished.is_none()) else { return false; };
            if timing.depth == 0 && !timing.acquiring { timing.engine_started = Some(Instant::now()); }
            timing.depth += 1;
            current.set(Some(timing)); true
        }))
    }
}
impl Drop for EngineSpan {
    fn drop(&mut self) {
        if !self.0 { return; }
        CURRENT.with(|current| {
            if let Some(mut timing) = current.get() {
                timing.depth -= 1;
                if timing.depth == 0 && let Some(started) = timing.engine_started.take() { timing.engine += started.elapsed(); }
                current.set(Some(timing));
            }
        });
    }
}
// @ref LLP 3000.019#3.7 — reader acquisition is wait even inside writer ownership.
// Nested acquisition helpers count once; resume the enclosing engine span only
// after opening/checking out the reader, including failed opens and unwinding.
pub(super) fn acquire<T>(open: impl FnOnce() -> T) -> T {
    struct Acquisition(Option<Instant>);
    impl Drop for Acquisition {
        fn drop(&mut self) {
            let Some(started) = self.0 else { return; };
            CURRENT.with(|current| {
                if let Some(mut timing) = current.get() {
                    timing.wait += started.elapsed();
                    timing.acquiring = false;
                    if timing.depth > 0 { timing.engine_started = Some(Instant::now()); }
                    current.set(Some(timing));
                }
            });
        }
    }
    let _acquisition = Acquisition(CURRENT.with(|current| {
        let Some(mut timing) = current.get().filter(|t| !t.acquiring && t.finished.is_none()) else { return None; };
        if let Some(started) = timing.engine_started.take() { timing.engine += started.elapsed(); }
        timing.acquiring = true;
        current.set(Some(timing));
        Some(Instant::now())
    }));
    open()
}
pub(super) fn waited(started: Instant) {
    CURRENT.with(|current| {
        if let Some(mut timing) = current.get().filter(|t| t.finished.is_none()) {
            timing.wait += started.elapsed(); current.set(Some(timing));
        }
    });
}
pub(crate) fn finished(refused: bool) {
    super::trace::mark("write_end");
    CURRENT.with(|current| { if let Some(mut timing) = current.get() && timing.finished.is_none() {
        timing.finished = Some((timing.accepted.elapsed(), refused, timing.cpu_elapsed(), timing.engine_elapsed()));
        current.set(Some(timing));
    } });
}

/// Headers necessarily describe work up to header construction, not future
/// socket writes. Doctor's total continues through the completed response.
pub(super) fn headers_enabled() -> bool {
    CURRENT.with(|current| current.get().is_some_and(|timing| timing.headers))
}
pub(crate) fn header() -> Option<Header> {
    CURRENT.with(|current| {
        let timing = current.get().filter(|t| t.headers)?;
        let ms = |time: Duration| time.as_secs_f64() * 1000.0;
        let mut value = format!("total;dur={:.3}, wait;dur={:.3}, engine;dur={:.3}",
            ms(timing.accepted.elapsed()), ms(timing.wait), ms(timing.engine_elapsed()));
        if let Some(cpu) = timing.cpu_elapsed() { value.push_str(&format!(", cpu;dur={:.3}", ms(cpu))); }
        Some(Header::from_bytes("Server-Timing", value).unwrap())
    })
}

/// Classify only the envelope; user data and synced row values are never walked.
pub(crate) trait Reply: Serialize { fn refused(&self) -> bool { false } fn generation(&self)->Option<u64>{None} }
impl Reply for Value {
    fn generation(&self)->Option<u64>{self.get("generation").and_then(Value::as_u64)}
    fn refused(&self) -> bool { self.get("denied").is_some_and(|v| !v.is_null()) || self.get("state").and_then(Value::as_str) == Some("failed") }
}
impl Reply for crate::sync_wire::SnapshotReply {fn generation(&self)->Option<u64>{Some(self.generation)}}
impl Reply for crate::sync_wire::StreamReply {fn generation(&self)->Option<u64>{Some(self.generation)}}

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
