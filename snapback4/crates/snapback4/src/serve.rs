//! The wire: one HTTP server over the engine. Operations are `POST /q/<op>`
//! and `POST /m/<op>` with plain JSON; a device follows `POST /sync` from its
//! watermark; the online tier long-polls `GET /changes`. Typed states, no
//! silent state (LLP 2000.000 §8). Development personas ride a header on
//! loopback; `dev` re-compiles the schema when a `.q` file changes.
#[path = "serve_identity.rs"]
pub(crate) mod session_identity;
pub(crate) use session_identity::principal_of;
use session_identity::{mutation_authority, read_permitted};

use crate::project::{Project, persona_principal};
use snapback4_core::error::Refusal;
use snapback4_core::ir::ProgramKind;
use snapback4_core::{Context, Engine, Presence, wire};
use snapback4_lang::Bound;
use serde_json::{Value as Json, json};
use std::collections::{BTreeMap, BTreeSet};
use std::io::{self, Write as _};
use std::net::IpAddr;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};
use tiny_http::{Header, Method, Request, Response, Server};
#[path = "actions.rs"]
mod actions;
#[path = "effects.rs"]
mod effects;
#[path = "serve_token.rs"]
pub(crate) mod token;
#[path = "serve_routes.rs"]
mod routes;
#[path = "serve_following.rs"]
mod following;
#[path = "serve_ephemeral.rs"]
mod ephemeral;
#[path = "serve_read_scopes.rs"]
mod read_scopes;
#[path = "serve_changes.rs"]
pub(crate) mod changes;
#[path = "serve_long_waits.rs"]
pub(crate) mod long_waits;
#[path = "serve_sync.rs"]
mod sync;
#[path = "serve_maintenance.rs"]
mod maintenance;
use maintenance::maintain;

#[path = "serve_adoption.rs"]
mod adoption;
#[path = "serve_dev_doors.rs"]
mod dev_doors;
#[path = "serve_release.rs"]
mod release;
use adoption::watch_sources;

#[cfg(test)]
#[path = "serve_tests.rs"]
mod tests;

#[path = "read_cost.rs"]
pub(crate) mod read_cost;

#[path = "serve_lock.rs"]
mod engine_lock;
use engine_lock::{FairMutex, Lockable};
#[path = "serve_committer.rs"]
mod committer;
#[path = "serve_request_facts.rs"]
mod request_facts;
pub(crate) use request_facts::{RequestFacts, RequestInfo};

#[path = "latency.rs"]
pub(crate) mod latency;

#[path = "dev_refusals.rs"]
pub(crate) mod dev_refusals;

pub struct Shared {
    worker_execution: bool,
    pub(crate) release_requests: Arc<crate::release_requests::Gate>,
    following: Mutex<snapback4_core::engine::following_history::Reader>,
    refusals: dev_refusals::Recent,
    latency: Arc<latency::Registry>,
    project: std::path::PathBuf,
    pub(crate) release_root: Mutex<Option<std::path::PathBuf>>,
    temporary: bool,
    dev_reset_store: Mutex<Option<String>>,
    dev_identity: Option<crate::dev_hosts::Identity>,
    ephemeral: Arc<snapback4_core::engine::ephemeral::Hub>,
    ephemeral_rate: ephemeral::Rate,
    wake: Mutex<ephemeral::Wake>,
    polls: Condvar,
    pub clock: Arc<Mutex<crate::dev_clock::Clock>>,
    /// Highest durable time-audience clock observed by this host. Responses
    /// never regress below the authority clock even if wall time rolls back.
    time_audience_clock: AtomicI64,
    maintenance: FairMutex<maintenance::State>,
    pub engine: committer::Writer,
    adoption: Mutex<adoption::Status>,
    readers: Mutex<QueryReaders>,
    carried: Mutex<BTreeMap<String, (String, snapback4_core::identity::Capability, u64, usize)>>,
    read_cuts: Mutex<read_cost::ReadCuts>,
    pub bound: Mutex<Bound>,
    pub generation: Mutex<u64>,
    pub worker_revision: AtomicUsize,
    /// Woken on every commit so long polls return promptly.
    pub committed: Condvar,
    pub seq: Mutex<u64>,
    /// `dev` admits loopback personas; a release refuses them.
    pub personas: bool,
    /// Immutable deployment classification captured before the listener starts.
    pub(crate) staging: bool,
    pub unsafe_dev_doors: bool,
    pub hold_effects: bool,
    pub hold_schedules: bool,
    pub entropy: Mutex<snapback4_core::ids::Mint>,
    /// Who holds a long poll open right now: what `connected[p]` reads.
    pub presence: Arc<Live>,
    /// Held change polls per principal, bounded by `--long-waits-per-principal`.
    pub(crate) long_waits: long_waits::LongWaits,
    /// Change-poll answers shared by every poll at the same cursor.
    pub(crate) change_answers: Mutex<changes::Answers>,
    /// Serializes asset responses for one `(asset, principal)` so two
    /// overlapping requests cannot both consume a one-view grant.
    pub asset_transfers: AssetTransfers,
    /// The app's native module, served at `/native.wasm` and named in
    /// `/schema` (LLP 3000.005 §9); none when the schema declares nothing native.
    pub native: Mutex<Option<crate::native::Installed>>,
    pub auth: crate::auth::Admission,
    pub uploads: AtomicUsize,
    route_verification: routes::Verification,
    // Drop after every SQLite connection; worker/request Arcs keep it alive.
    owner: Option<Arc<crate::store_owner::Owner>>,
    #[cfg(test)]
    pub(crate) release_committed: WorkHook,
    #[cfg(test)]
    pub(crate) worker_prepare: WorkHook,
    #[cfg(test)]
    pub(crate) worker_minted: WorkHook,
    #[cfg(test)]
    pub auth_work: WorkHook,
    #[cfg(test)]
    request_work: WorkHook,
    #[cfg(test)]
    round_trips: Mutex<Option<std::sync::mpsc::Sender<snapback4_core::round_trips::Counts>>>,
    #[cfg(test)]
    pub upload_work: WorkHook,
    #[cfg(test)]
    pub asset_delivery: WorkHook,
    #[cfg(test)]
    pub effect_wait: WorkHook,
    #[cfg(test)]
    pub poll_wait: WorkHook,
    #[cfg(test)]
    pub poll_resumed: WorkHook,
    #[cfg(test)]
    pub poll_notified: WorkHook,
    #[cfg(test)]
    pub query_wait: WorkHook,
    #[cfg(test)]
    pub adoption_committed: WorkHook,
    #[cfg(test)]
    pub clock_advanced: WorkHook,
    #[cfg(test)]
    pub reader_open: WorkHook,
    #[cfg(test)]
    pub changes_refresh: WorkHook,
    #[cfg(test)]
    pub mutation_wait: WorkHook,
    #[cfg(test)]
    pub mutation_committed: WorkHook,
    #[cfg(test)]
    pub operation_ingress: WorkHook,
}

impl Shared {
    // @ref LLP 3000.000.000.001#4-development-doors — current adopted auth policy closes test authority, independently of dev mode.
    pub(crate) fn dev_doors(&self) -> bool {
        if !self.personas { return false; }
        let bound = lock(&self.bound);
        self.unsafe_dev_doors || !(bound.schema.auth.password && !bound.schema.auth.guests)
    }
    // Revalidate under the writer: neither a slow body nor an adoption queue
    // may carry fixture authority into a newly password-only schema.
    pub(crate) fn dev_authority(&self, engine: &Engine) -> Result<(), Refusal> {
        if self.personas && (self.unsafe_dev_doors || !(engine.schema().auth.password && !engine.schema().auth.guests)) { Ok(()) }
        else { Err(dev_doors::closed()) }
    }
    pub fn now(&self) -> i64 { lock(&self.clock).now().max(self.time_audience_clock.load(Ordering::Acquire)) }
    pub(crate) fn refresh_time_audience_clock(&self, engine: &Engine, now: i64) {
        if engine.schema().tables.values().any(|table| table.not_before.is_some()) {
            let durable = engine.store().time_audience_clock_value().ok().flatten()
                .and_then(|value| value.parse::<i64>().ok()).unwrap_or(i64::MIN);
            self.time_audience_clock.fetch_max(now.max(durable), Ordering::AcqRel);
        } else {
            self.time_audience_clock.store(i64::MIN, Ordering::Release);
        }
    }
    fn advance_time_audiences(&self) -> Result<i64, snapback4_core::RuntimeError> {
        let requested = lock(&self.clock).now();
        // Non-timed reader traffic must retain its independent reader lane,
        // including while adoption or a mutation deliberately holds the writer.
        if self.time_audience_clock.load(Ordering::Acquire) == i64::MIN { return Ok(requested); }
        self.engine.attempt(move |engine, shared| {
            let before = engine.seq()?;
            let now = engine.advance_time_audiences_at(requested)?;
            shared.refresh_time_audience_clock(engine, now);
            if engine.seq()? != before { shared.durable_committed(engine); }
            Ok(now)
        })
    }
    fn next_time_audience(&self) -> Result<Option<i64>, snapback4_core::RuntimeError> {
        if self.time_audience_clock.load(Ordering::Acquire) == i64::MIN { return Ok(None); }
        self.engine.attempt(|engine, _| engine.next_time_audience_at())
    }

    fn time_audience_delay(&self, at: i64) -> Duration {
        let raw = lock(&self.clock).now();
        let floor = self.time_audience_clock.load(Ordering::Acquire);
        Duration::from_millis(if at <= floor { 0 } else { at.saturating_sub(raw).max(0) }.try_into().unwrap_or(u64::MAX))
    }
    pub(crate) fn worker_owner(&self) -> Option<Arc<std::fs::File>> { self.owner.as_ref().map(|owner| owner.worker_lock()) }
}

#[path = "serve_trace.rs"]
mod trace;

#[path = "serve_readers.rs"]
mod query_readers;
use query_readers::QueryReaders;

/// A panicking request must not turn one poisoned process mutex into a
/// permanent server-wide panic loop. The guarded value is retained, the
/// poison marker is cleared, and the next request can make progress.
pub(crate) fn lock<T: Lockable>(mutex: &T) -> T::Guard<'_> {
    mutex.recover_lock()
}

#[derive(Debug, Default)]
pub struct AssetTransfers {
    active: Mutex<BTreeSet<(String, String)>>,
    available: Condvar,
}

impl AssetTransfers {
    pub(crate) fn enter<'a>(&'a self, asset: &str, principal: &str) -> AssetTransfer<'a> {
        let key = (asset.to_owned(), principal.to_owned());
        let mut active = lock(&self.active);
        while active.contains(&key) {
            active = self.available.wait(active).unwrap_or_else(|poisoned| poisoned.into_inner());
        }
        active.insert(key.clone());
        AssetTransfer { transfers: self, key }
    }
}

pub(crate) struct AssetTransfer<'a> {
    transfers: &'a AssetTransfers,
    key: (String, String),
}

impl Drop for AssetTransfer<'_> {
    fn drop(&mut self) {
        lock(&self.transfers.active).remove(&self.key);
        self.transfers.available.notify_all();
    }
}

/// A connection lasts as long as its poll and a grace after it: a client
/// re-polls within milliseconds of an answer, a dropped one never does.
use snapback4_core::engine::{PRESENCE_GRACE, PRESENCE_CONFIRMATION, PRESENCE_REFRESH};

/// The registry of open long polls, per principal: how many are open now,
/// and when the last one ended. A device that holds `/changes?wait` open
/// (every tier does) is connected; nothing else is.
#[derive(Debug)]
pub struct Live {
    polls: Mutex<BTreeMap<String, (u32, Option<i64>)>>,
    clock: Arc<Mutex<crate::dev_clock::Clock>>,
}

impl Live {
    // @ref LLP 3000.007#19.1 — presence remains server knowledge; development grace uses the same clock as the commit deciding effects.
    fn new(clock: Arc<Mutex<crate::dev_clock::Clock>>) -> Self { Self { polls: Mutex::new(BTreeMap::new()), clock } }

    fn enter(&self, principal: &str) {
        let mut map = lock(&self.polls);
        map.entry(principal.to_owned()).or_insert((0, None)).0 += 1;
    }

    fn leave(&self, principal: &str) {
        let mut map = lock(&self.polls);
        let now = lock(&self.clock).presence_now();
        if let Some(entry) = map.get_mut(principal) {
            entry.0 = entry.0.saturating_sub(1);
            entry.1 = Some(now);
        }
        map.retain(|_, (open, last)| *open > 0 || last.is_some_and(|at| now.saturating_sub(at) < PRESENCE_GRACE.as_millis() as i64));
    }
}

impl Presence for Live {
    fn effect_presence(&self, principal: &str) -> (u64, Option<i64>) {
        let now = lock(&self.clock).now();
        self.effect_presence_at(principal, now)
    }

    fn effect_presence_at(&self, principal: &str, now: i64) -> (u64, Option<i64>) {
        let map = lock(&self.polls);
        let clock = lock(&self.clock);
        match map.get(principal) {
            Some((open, _)) if *open > 0 => (u64::from(*open), Some(now.saturating_add(PRESENCE_CONFIRMATION.as_millis() as i64))),
            Some((_, Some(last))) => {
                let remaining = (PRESENCE_GRACE.as_millis() as i64).saturating_sub(clock.presence_now().saturating_sub(*last));
                (0, (remaining > 0).then(|| clock.now().saturating_add(remaining)))
            }
            _ => (0, None),
        }
    }

    fn connections(&self, principal: &str) -> u64 {
        let map = lock(&self.polls);
        let now = lock(&self.clock).presence_now();
        match map.get(principal) {
            Some((open, _)) if *open > 0 => u64::from(*open),
            Some((_, Some(last))) if now.saturating_sub(*last) < PRESENCE_GRACE.as_millis() as i64 => 1,
            _ => 0,
        }
    }
}

#[cfg(test)]
pub(crate) type WorkHook = Mutex<Option<Arc<dyn Fn() + Send + Sync>>>;
#[cfg(test)]
pub(crate) fn test_work(hook: &WorkHook) {
    let work = lock(hook).clone();
    if let Some(work) = work { work(); }
}

/// How the server is run: `dev` on a project (personas, watch), or a
/// release (`serve`): a compiled generation over a store, tokens only.
pub enum Mode {
    Dev { unsafe_dev_doors: bool, trace_empty: bool, verbose: bool, watch: bool, fresh: bool, replay: bool, hold_effects: bool, hold_schedules: bool, clock_offset: i64 },
    ConfiguredRelease { expected: u64, owner: Arc<crate::store_config::OwnedStore> },
    Release { clock_offset: i64, expected: u64, worker: Option<std::path::PathBuf>, owner: Arc<crate::store_owner::Owner> },
}

#[path = "serve_start.rs"]
mod start;
pub use start::serve;
use start::serve_requests;

// Thirty executing reads leave the matched 32-connection budget's writer and
// lease reservations intact. Waiting requests own sockets, never DB readers.
const REQUEST_WORKERS: usize = 30;
const SHORT_REQUEST_QUEUE: usize = crate::host_limits::SHORT_REQUEST_QUEUE;
const SHORT_REQUEST_DEADLINE: Duration = Duration::from_secs(30);
// Writer-dependent requests have their own budget: queued behind adoption, they cannot take
// the slots reads and discovery need, and neither class loses capacity.
const MUTATION_WORKERS: usize = 32;
// @ref LLP 3000.026#4-atomic-launch-adoption — sync may wait for atomic launch;
// reserve its capacity separately even if launch begins after dispatch.
const SYNC_WORKERS: usize = 32;
const ROUTE_WORKERS: usize = 16;
const REGISTRY_WORKERS: usize = 4;
const VERIFIER_WORKERS: usize = 4;
const CLASSES: usize = 8;

struct RequestAdmission { limits: [usize; CLASSES], pool_refusals: long_waits::PoolRefusals, workers: [request_workers::Workers; CLASSES], short: AtomicUsize, mutations: AtomicUsize, syncs: AtomicUsize, waiters: AtomicUsize, routes: AtomicUsize, registries: AtomicUsize, verifiers: AtomicUsize, claims: AtomicUsize, refused: [AtomicUsize; CLASSES], undelivered: [AtomicUsize; CLASSES] }

// @ref LLP 3000.036#6-idle-live-clients-must-not-cost-a-thread — viewers' waits and workers' claims are separate classes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RequestClass { Short, Mutation, Sync, Wait, Route, Registry, Verifier, Claim }
struct RequestPermit { admission: Arc<RequestAdmission>, class: RequestClass }
// @ref LLP 3000#http-overload-diagnostics — spawn failure drops the closure on the dispatcher; refuse before Request can drain an unfinished body.
struct PendingRequest { request: Option<Request>, admission: Arc<RequestAdmission>, class: RequestClass }
impl PendingRequest {
    fn take(mut self) -> Request { self.request.take().unwrap() }
}
impl Drop for PendingRequest {
    fn drop(&mut self) {
        if let Some(request) = self.request.take() { self.admission.refuse(request, self.class); }
    }
}
impl Drop for RequestPermit {
    fn drop(&mut self) { self.admission.counter(self.class).fetch_sub(1, Ordering::AcqRel); }
}
impl RequestAdmission {
    fn new(capacity: &crate::host_limits::Capacity) -> Self {
        Self {
            limits: [REQUEST_WORKERS, MUTATION_WORKERS, SYNC_WORKERS, capacity.long_waits, ROUTE_WORKERS, REGISTRY_WORKERS, VERIFIER_WORKERS, capacity.claim_waits],
            pool_refusals: long_waits::PoolRefusals::new(capacity),
            workers: Default::default(), short: AtomicUsize::new(0), mutations: AtomicUsize::new(0), syncs: AtomicUsize::new(0), waiters: AtomicUsize::new(0),
            routes: AtomicUsize::new(0), registries: AtomicUsize::new(0), verifiers: AtomicUsize::new(0), claims: AtomicUsize::new(0),
            refused: Default::default(), undelivered: Default::default(),
        }
    }
    fn refuse(&self, request: Request, class: RequestClass) {
        // A full long-wait pool names itself (E_STREAMS); every other class
        // keeps the fixed E_RATE_LIMIT body. Both are one nonblocking write.
        let result = match class {
            RequestClass::Wait => request.refuse_overload_with(long_waits::POOL_RETRY_SECONDS, &self.pool_refusals.viewer),
            RequestClass::Claim => request.refuse_overload_with(long_waits::POOL_RETRY_SECONDS, &self.pool_refusals.claim),
            _ => request.refuse_overload(),
        };
        let increment = |counter: &AtomicUsize| { let _ = counter.fetch_update(Ordering::Relaxed, Ordering::Relaxed, |n| Some(n.saturating_add(1))); };
        increment(&self.refused[class as usize]);
        if result.http_written == 0 { increment(&self.undelivered[class as usize]); }
    }
    fn counter(&self, class: RequestClass) -> &AtomicUsize {
        match class { RequestClass::Short => &self.short, RequestClass::Mutation => &self.mutations, RequestClass::Sync => &self.syncs, RequestClass::Wait => &self.waiters, RequestClass::Route => &self.routes, RequestClass::Registry => &self.registries, RequestClass::Verifier => &self.verifiers, RequestClass::Claim => &self.claims }
    }
    fn limit(&self, class: RequestClass) -> usize { self.limits[class as usize] }
    fn acquire(self: &Arc<Self>, class: RequestClass) -> Option<RequestPermit> {
        let limit = self.limit(class) + if class == RequestClass::Short { SHORT_REQUEST_QUEUE } else { 0 };
        self.counter(class).fetch_update(Ordering::AcqRel, Ordering::Acquire, |n| (n < limit).then(|| n + 1)).ok()?;
        Some(RequestPermit { admission: self.clone(), class })
    }
}

#[path = "request_workers.rs"]
mod request_workers;

fn request_class(request: &Request, shared: &Shared) -> RequestClass {
    let path = request.url().split('?').next().unwrap_or("");
    // Route waits cannot occupy the polls needed to verify or execute them.
    if request.method() == &Method::Post && routes::declared(shared, request.url()).is_some() { RequestClass::Route }
        else if request.method() == &Method::Post && path == "/routes/verify/claim" { RequestClass::Verifier }
        else if request.method() == &Method::Post && path == "/actions/claim-set" { RequestClass::Registry }
        else if is_claim(request.method(), path) { RequestClass::Claim }
        // A change poll without a wait answers at once, so it stays available
        // when the long-wait pool is full. It takes the engine to enter
        // presence and open its reader, so it is writer-dependent (Mutation).
        else if is_waiter(request.method(), path) && !(path == "/changes" && wait_seconds(request.url()) == 0) { RequestClass::Wait }
        else if request.method() == &Method::Post && path == "/sync" { RequestClass::Sync }
        // @ref LLP 3000.019#3.6 — only writer-independent handlers share the read reservation.
        // Default to the writer budget, so adding a writer door cannot silently
        // consume read slots. Authentication uses the same detached-read policy.
        else if detached_request(request.method(), path)
            || shared.personas && matches!((request.method(), path), (Method::Get, "/dev/latency") | (Method::Post, "/dev/latency/reset")) { RequestClass::Short }
        else { RequestClass::Mutation }

}

fn dispatch(request: Request, shared: Arc<Shared>, admission: Arc<RequestAdmission>, loopback_listener: bool) {
    dispatch_with_builder(request, shared, admission, loopback_listener, std::thread::Builder::new().name("request".into()));
}

fn dispatch_with_builder(request: Request, shared: Arc<Shared>, admission: Arc<RequestAdmission>, loopback_listener: bool, builder: std::thread::Builder) {
    // @ref LLP 3000.019#3.7 — admission failures count; worker timing includes the listener wait.
    let trace = trace::Trace::capture(&request, shared.personas && loopback_listener);
    let sample = latency::Sample::with_headers(&request, &shared.latency, shared.personas && loopback_listener && dev_request(&request, &shared).is_ok());
    let class = request_class(&request, &shared);
    let Some(permit) = admission.acquire(class) else {
        admission.refuse(request, class);
        return;
    };
    let deadline = (class == RequestClass::Short).then(|| request_workers::deadline(&request, SHORT_REQUEST_DEADLINE));
    let pending = PendingRequest { request: Some(request), admission: admission.clone(), class };
    let job: Box<dyn FnOnce() + Send> = Box::new(move || { let _permit = permit;
        // Intake time survives the queue; neither execution nor body reading
        // receives a renewed lease. Refuse without draining an expired body.
        if class == RequestClass::Short && pending.request.as_ref().is_some_and(|r| r.accepted_at().elapsed() >= SHORT_REQUEST_DEADLINE || r.body_deadline().is_some_and(|at| Instant::now() >= at)) { return; }
        let request = pending.take();
        let run = || { if let Some(sample) = sample { sample.run(|| handle(request, &shared)); } else { handle(request, &shared); } };
        if let Some(trace) = trace { trace.run(run); } else { run(); } });
    if let Err(error) = admission.workers[class as usize].submit_until(admission.limit(class), builder, deadline, job) {
        snapback4_core::diagnostic!("snapback4: cannot start request thread: {error}");
    }
}

fn detached_request(method: &Method, path: &str) -> bool {
    method == &Method::Post && (path.starts_with("/q/") || path.starts_with("/following/") || path == "/sync")
        || method == &Method::Get && matches!(path, "/" | "/probe" | "/schema" | "/api.ts" | "/native.wasm" | "/dev/status" | "/dev/catalog" | "/auth/config")
        || method == &Method::Options
}

fn is_waiter(method: &Method, path: &str) -> bool {
    (method == &Method::Get && path == "/changes") || (method == &Method::Post && path.starts_with("/a/"))
}

/// Service workers' claim polls: their own pool, so held viewer waits cannot
/// starve effect and action delivery, nor the reverse.
fn is_claim(method: &Method, path: &str) -> bool {
    method == &Method::Post && (path == "/effects/claim" || path == "/actions/claim")
}

/// `/changes`' own reading of `wait` (absent or unparsable is 0; capped at 25).
pub(crate) fn wait_seconds(url: &str) -> u64 {
    query_params(url).get("wait").and_then(|s| s.parse().ok()).unwrap_or(0).min(25)
}

#[path = "serve_service.rs"]
mod service;
use service::{service_admission, service_token_of, service_of, service_of_locked};

pub(crate) fn single_header<'a>(request: &'a impl RequestInfo, name: &str) -> Result<Option<&'a str>, ()> {
    let mut headers = request.headers().iter().filter(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name));
    let value = headers.next().map(|h| h.value.as_str());
    if headers.next().is_some() { Err(()) } else { Ok(value) }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BoundSessionWire {
    principal: String,
    #[serde(default = "default_session_kind")]
    kind: String,
    #[serde(default = "default_session_days")]
    days: i64,
    binding: BoundSessionBindingWire,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BoundSessionBindingWire {
    invocation_id: String,
    intent: String,
    #[serde(default)]
    replace_lost_delivery: bool,
}

enum SessionMintWire {
    Legacy { principal: String, kind: String, days: i64 },
    Bound { principal: String, kind: String, days: i64, binding: snapback4_core::identity::SessionMintBinding, lease: String, service_token: String },
}

fn default_session_kind() -> String { "account".into() }
fn default_session_days() -> i64 { snapback4_core::identity::SESSION_DAYS }

fn session_mint_wire(request: &Request, payload: &Json) -> Result<SessionMintWire, (u16, Refusal)> {
    // @ref LLP 3000.033#1.3 — service minting cannot silently widen a requested scope.
    if payload.get("scope").is_some_and(|scope| scope != "full") {
        return Err((400, Refusal::new("E_INPUT", "input", "service minting accepts only full scope; narrow an eligible account session").guide("read-only")));
    }
    let has_lease = request.headers().iter().any(|header| header.field.as_str().as_str().eq_ignore_ascii_case("x-snapback-action-lease"));
    let has_binding = payload.as_object().is_some_and(|object| object.contains_key("binding"));
    if !has_lease && !has_binding {
        let principal = payload.get("principal").and_then(Json::as_str).map(str::to_owned)
            .ok_or_else(|| (400, Refusal::new("E_INPUT", "input", "name the account: { \"principal\": \"member:42\" }")))?;
        return Ok(SessionMintWire::Legacy {
            principal,
            kind: payload.get("kind").and_then(Json::as_str).unwrap_or("account").to_owned(),
            days: payload.get("days").and_then(Json::as_i64).unwrap_or(snapback4_core::identity::SESSION_DAYS),
        });
    }
    let mut bound_payload = payload.clone();
    if let Some(fields) = bound_payload.as_object_mut() { fields.remove("scope"); }
    let parsed = serde_json::from_value::<BoundSessionWire>(bound_payload).map_err(|_| (400,
        Refusal::new("E_INPUT", "input", "a bound session requires exactly { principal, kind?: string, days?: integer, binding: { invocationId, intent: \"identity-session/v1\", replaceLostDelivery?: boolean } }")))?;
    if parsed.binding.intent != snapback4_core::identity::BOUND_SESSION_INTENT
        || parsed.binding.invocation_id.is_empty() || parsed.binding.invocation_id.len() > 128
        || !snapback4_core::value::identity_fits(&parsed.binding.invocation_id)
    {
        return Err((400, Refusal::new("E_INPUT", "input", "binding requires { invocationId, intent: \"identity-session/v1\", replaceLostDelivery?: boolean }")));
    }
    snapback4_core::identity::validate_custom_session(&parsed.principal, &parsed.kind)
        .map_err(|error| (crate::auth::error_status(&error), error.refusal()))?;
    let lease = match single_header(request, "x-snapback-action-lease") {
        Ok(Some(token)) if !token.trim().is_empty() => token.trim().to_owned(),
        _ => return Err((200, Refusal::new("E_ACTION_LEASE", "action", "send the current claim's session.token in x-snapback-action-lease").guide("actions"))),
    };
    let service_token = crate::auth::bearer_token(request).map(str::to_owned)
        .map_err(|error| (401, error.refusal()))?;
    Ok(SessionMintWire::Bound {
        principal: parsed.principal,
        kind: parsed.kind,
        days: parsed.days,
        binding: snapback4_core::identity::SessionMintBinding {
            invocation_id: parsed.binding.invocation_id,
            intent: parsed.binding.intent,
            replace_lost_delivery: parsed.binding.replace_lost_delivery,
        },
        lease,
        service_token,
    })
}

fn authority_host(authority: &str) -> Option<&str> {
    if authority.is_empty() || authority.chars().any(|c| c.is_ascii_whitespace() || "/\\?#@,".contains(c)) { return None; }
    if let Some(rest) = authority.strip_prefix('[') {
        let (host, tail) = rest.split_once(']')?;
        if !matches!(host.parse::<IpAddr>().ok(), Some(IpAddr::V6(_))) { return None; }
        if !tail.is_empty() { tail.strip_prefix(':')?.parse::<u16>().ok().filter(|p| *p > 0)?; }
        Some(host)
    } else if let Some((host, port)) = authority.split_once(':') {
        port.parse::<u16>().ok().filter(|p| *p > 0)?;
        if host.is_empty() { None } else { Some(host) }
    } else { Some(authority) }
}

fn local_authority(authority: &str) -> bool {
    authority_host(authority).is_some_and(|host| host.eq_ignore_ascii_case("localhost") || host.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback()))
}

fn origin_authority(origin: &str) -> Option<&str> {
    let authority = origin.strip_prefix("http://").or_else(|| origin.strip_prefix("https://"))?;
    authority_host(authority)?;
    Some(authority)
}

/// Browser developers use different local app ports. Trust literal loopback
/// names, never DNS resolution: a foreign hostname may resolve to loopback.
fn dev_request(request: &impl RequestInfo, shared: &Shared) -> Result<(), Refusal> {
    if !shared.personas { return Ok(()); }
    let host = single_header(request, "host");
    let origin = single_header(request, "origin");
    if !request.remote_addr().is_some_and(|addr| addr.ip().is_loopback())
        || !request.url().starts_with('/') || request.url().starts_with("//")
        || !matches!(host, Ok(Some(host)) if local_authority(host))
        || !matches!(origin, Ok(None) | Ok(Some(_)))
        || origin.ok().flatten().is_some_and(|origin| !origin_authority(origin).is_some_and(local_authority)) {
        return Err(Refusal::new("E_AUTH", "auth", "development HTTP requires a loopback Host and a loopback browser Origin; use localhost or a literal loopback address").guide("personas"));
    }
    Ok(())
}

// @ref LLP 3000.007#20.2 — public routes bypass dev admission, never the privacy boundary.
pub(crate) fn trusted_dev_request(request: &impl RequestInfo, shared: &Shared) -> bool {
    shared.personas && dev_request(request, shared).is_ok()
}

pub(crate) fn cors(request: &Request) -> Vec<Header> {
    let mut headers = vec![
        Header::from_bytes("Vary", "Origin").unwrap(),
        Header::from_bytes("Access-Control-Expose-Headers", "X-Snapback-Time, X-Snapback-Clock, X-Snapback-Generation, X-Snapback-Dev-Reset, X-Snapback-Session-Expires, X-Snapback-Session-Cap, X-Snapback-Session-Timing").unwrap(),
        Header::from_bytes("Access-Control-Allow-Headers", "content-type, x-snapback-persona, x-snapback-meter, authorization, range, x-snapback-device").unwrap(),
        Header::from_bytes("Access-Control-Allow-Methods", "GET, POST, OPTIONS").unwrap(),
    ];
    if let Ok(Some(origin)) = single_header(request, "origin") && origin_authority(origin).is_some() {
        headers.push(Header::from_bytes("Access-Control-Allow-Origin", origin).unwrap());
    }
    if latency::headers_enabled() {
        headers.push(Header::from_bytes("Access-Control-Expose-Headers", "Server-Timing").unwrap());
    }
    headers
}

const JSON_REQUEST_CEILING: usize = 1 << 20;
// Even six-byte JSON escapes for all 256 × 128 id bytes leave room
// for a snapshot cursor, without changing the general JSON body ceiling.
const SYNC_REQUEST_CEILING: usize = 256 << 10;
const SEED_REQUEST_CEILING: usize = 16 << 20;
pub(super) const JSON_RESPONSE_CEILING: usize = 16 << 20;

/// Stop encoding before an additional unbounded String exists. Partition
/// acquisition has its own page/commit bounds; this owns the wire buffer.
struct JsonBuffer(Vec<u8>);
impl io::Write for JsonBuffer {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if bytes.len() > JSON_RESPONSE_CEILING.saturating_sub(self.0.len()) {
            return Err(io::Error::other("HTTP JSON response exceeds 16 MiB"));
        }
        self.0.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> { Ok(()) }
}

use crate::sync_wire::{SnapshotReply, SyncEvents, StreamReply};

/// Sample at response construction, after execution and any admission wait.
pub(crate) fn respond_timed(request: Request, shared: &Shared, status: u16, body: impl latency::Reply) {
    respond_with_sync(request, status, body, true, None, Some(shared))
}

pub(crate) fn respond(request: Request, status: u16, body: impl latency::Reply) {
    respond_with_cors(request, status, body, true)
}

fn respond_with_cors(request: Request, status: u16, body: impl latency::Reply, allow_origin: bool) {
    respond_with_sync(request, status, body, allow_origin, None, None)
}

fn respond_with_sync(request: Request, status: u16, body: impl latency::Reply, allow_origin: bool, sync_overflow: Option<Json>, shared: Option<&Shared>) {
    respond_full(request, status, body, allow_origin, sync_overflow, shared, Vec::new())
}

/// `respond_timed` with extra headers (for example Retry-After).
pub(crate) fn respond_with_headers(request: Request, shared: &Shared, status: u16, body: impl latency::Reply, headers: Vec<Header>) {
    respond_full(request, status, body, true, None, Some(shared), headers)
}

fn respond_full(request: Request, status: u16, body: impl latency::Reply, allow_origin: bool, sync_overflow: Option<Json>, shared: Option<&Shared>, extra: Vec<Header>) {
    // @ref LLP 3000.009.001.000.001#31-authority-boundaries — generation loss never revokes credentials or authenticates response metadata.
    if body.refusal_code() == Some("E_GENERATION") {
        let body = serde_json::to_value(&body).unwrap_or(Json::Null);
        let body = operation_request::generation_reply(body);
        return respond_full_normalized(request, 503, latency::Unobserved(body), allow_origin, None, shared,
            extra.into_iter().filter(|h| !h.field.equiv("X-Snapback-Generation") && !h.field.equiv("Retry-After")).chain([Header::from_bytes("Retry-After", "1").unwrap(), Header::from_bytes("Access-Control-Expose-Headers", "Retry-After").unwrap()]).collect());
    }
    respond_full_normalized(request, status, body, allow_origin, sync_overflow, shared, extra)
}

fn respond_full_normalized(request: Request, status: u16, body: impl latency::Reply, allow_origin: bool, sync_overflow: Option<Json>, shared: Option<&Shared>, extra: Vec<Header>) {
    // Resolve queue status before generation stamping, so every door emits
    // the same refusal envelope as well as the same status and retry policy.
    let generation_refusal = body.refusal_code() == Some("E_GENERATION");
    let queue_status = body.refusal_code()
        .filter(|code| *code != "E_RATE_LIMIT" || body.refusal_family() == Some("limit"))
        .and_then(committer::refusal_status);
    let status = queue_status.unwrap_or(status);
    let status = if body.refusal_code() == Some("E_STORE_OWNERSHIP") && body.refusal_retryable() { 503 } else { status };
    let overload = status == 503 && body.refusal_code() == Some("E_RATE_LIMIT");
    let refused = status >= 400 || body.refused();
    trace::mark("encode_start");
    let mut bytes = JsonBuffer(Vec::new());
    // Online-only refusals retain HTTP 200; failed authentication still cannot
    // disclose a store generation through the ordinary response stamp.
    let unauthenticated = body.refusal_code() == Some("E_AUTH") && body.refusal_family() == Some("auth");
    let unobserved = status == 401 || unauthenticated || queue_status.is_some() || !body.stamp_generation();
    let generation = if unobserved { None } else { body.generation().or_else(crate::release_requests::reply_generation).or_else(|| shared.map(|s| *lock(&s.generation))) };
    crate::release_requests::executed();
    let encoded = serde_json::to_writer(&mut bytes, &body);
    // Append only to envelopes without a generation, without cloning row payloads.
    let stamped = if encoded.is_ok() && body.generation().is_none() && let Some(generation)=generation && bytes.0.last()==Some(&b'}') {
        bytes.0.pop();
        let separator=if bytes.0.len()>1 {","} else {""};
        write!(&mut bytes,"{separator}\"generation\":{generation}}}")
    } else { Ok(()) };
    drop(body);
    let status = if encoded.is_err() || stamped.is_err() {
        bytes.0.clear();
        let refusal = Refusal::new("E_BOUND", "bound", "the HTTP JSON response exceeds 16 MiB; request a smaller page or return fewer values").guide("reads");
        // @ref LLP 3000.007.001#3.11 — generation discovery survives an undeliverable row page.
        let mut reply = sync_overflow.unwrap_or_else(|| json!({}));
        reply["denied"] = refusal_json(&refusal);
        if let Some(generation)=generation {reply["generation"]=json!(generation);}
        serde_json::to_writer(&mut bytes, &reply).expect("the fixed HTTP refusal and sync identity fit the response ceiling");
        200
    } else { status };
    let refused = refused || encoded.is_err();
    trace::mark("encode_end");
    let _evidence = dev_refusals::response::response(&bytes.0);
    let overload = overload && status == 503;
    let capacity = bytes.0.len() + 512;
    let mut response = Response::from_data(bytes.0).with_status_code(status);
    let mut headers = Vec::new();
    if !unobserved && !generation_refusal && let Some(shared) = shared && let Some(identity) = lock(&shared.dev_reset_store).as_ref() {
        headers.push(Header::from_bytes("X-Snapback-Dev-Reset", identity.as_str()).unwrap());
    }
    if let Some(shared) = shared {
        for header in session_clock_headers(&request, shared).into_iter().chain(ephemeral_headers(shared)) { headers.push(header); }
        // @ref LLP 3000.023#11 — discover compiler dependency summaries without probing older servers.
        headers.push(Header::from_bytes("X-Snapback-Settlement", "1").unwrap());
        headers.push(Header::from_bytes("Access-Control-Expose-Headers", "X-Snapback-Settlement, X-Snapback-Generation").unwrap());
    }
    if let Some(generation)=generation {headers.push(Header::from_bytes("X-Snapback-Generation",generation.to_string()).unwrap());}
    headers.push(Header::from_bytes("Content-Type", "application/json").unwrap());
    headers.push(Header::from_bytes("Cache-Control", "no-store").unwrap());
    if overload {
        headers.push(Header::from_bytes("Retry-After", "1").unwrap());
        headers.push(Header::from_bytes("Access-Control-Expose-Headers", "Retry-After").unwrap());
    }
    for header in extra { headers.push(header); }
    if allow_origin {
        for header in cors(&request) { headers.push(header); }
    }
    if let Some(header) = latency::header() { headers.push(header); }
    for header in merge_exposed_headers(headers) { response.add_header(header); }
    trace::mark("write_start");
    if status >= 400 && request.method() == &Method::Post {
        let _ = request.respond_and_close_with_completion(response, |result| latency::finished(result.is_err() || refused));
        return;
    }
    // `into_writer` drops the request reader before it returns. tiny_http
    // prebuffers ordinary bodies up to 1 KiB; other readers may drain on
    // drop, so keep its response-before-drain order for those requests.
    let may_drain = request.body_length().is_some_and(|n| n > 1024) || request.headers().iter().any(|h| {
        h.field.equiv("Expect") || h.field.equiv("Transfer-Encoding")
            || (h.field.equiv("Connection") && h.value.as_str().split(',').any(|v| v.trim().eq_ignore_ascii_case("upgrade")))
    });
    if may_drain {
        let _ = request.respond_checked_with_completion(response, |result| latency::finished(result.is_err() || refused));
        return;
    }
    // @ref LLP 3000#7-decisions-during-execution — coalesce buffered JSON HTTP responses
    // The body is already materialized. Frame it before writing so the HTTP
    // library's small socket buffer cannot split headers from a short body
    // and leave the latter waiting for a delayed TCP acknowledgement.
    let mut encoded = Vec::with_capacity(capacity);
    let response = request.prepare_response(response);
    if response.raw_print(&mut encoded, request.http_version().clone(), request.headers(), request.method() == &Method::Head, None).is_ok() {
        let mut writer = request.into_writer();
        trace::mark("write_start");
        latency::finished(writer.write_all(&encoded).and_then(|_| writer.flush()).is_err() || refused);
    }
}

/// A 204 has no representation metadata or advertised bytes. Keeping it out
/// of the JSON response helper also prevents an unread `null` from framing the
/// next response on a persistent connection.
pub(crate) fn respond_empty(request: Request, status: u16) {
    let mut response = Response::empty(status);
    if let Some(header)=generation_header(){response.add_header(header);}
    for header in cors(&request).into_iter().chain(latency::header()).filter(|header| !header.field.equiv("Content-Type")) {
        response.add_header(header);
    }
    let _ = request.respond(response);
}

pub(crate) fn refusal_json(refusal: &Refusal) -> Json {
    serde_json::to_value(refusal).unwrap_or(Json::Null)
}


pub(crate) fn query_params(url: &str) -> BTreeMap<String, String> {
    fn decode(text: &str) -> String {
        let mut out = Vec::with_capacity(text.len());
        let bytes = text.as_bytes();
        let mut at = 0;
        while at < bytes.len() {
            if bytes[at] == b'%' && at + 2 < bytes.len() {
                let hex = |b: u8| (b as char).to_digit(16).map(|n| n as u8);
                if let (Some(a), Some(b)) = (hex(bytes[at+1]), hex(bytes[at+2])) { out.push(a * 16 + b); at += 3; continue; }
            }
            out.push(if bytes[at] == b'+' { b' ' } else { bytes[at] }); at += 1;
        }
        String::from_utf8(out).unwrap_or_else(|_| text.to_owned())
    }
    url.split_once('?')
        .map(|(_, query)| query.split('&').filter_map(|pair| pair.split_once('=').map(|(k, v)| (decode(k), decode(v)))).collect())
        .unwrap_or_default()
}

// Identity and head are a single snapshot from the owner of the evaluated
// operation. Mutation replay's seq is historical; head is never that receipt.
#[path = "serve_head.rs"]
mod head;
use head::{response_head, intent_store, session_clock_headers, merge_exposed_headers};
pub(crate) use head::{ephemeral_headers, mutation_reply};

#[path = "serve_operation.rs"]
mod operation_request;

fn operation_refusal(request: Request, shared: &Shared, status: u16, why: Refusal) {
    let metadata = session_identity::Admission::capture(&request, shared).and_then(|admission|
        shared.request_snapshot(admission, |_, engine, _, snapshot| Ok((snapshot.store_id.clone(), snapshot.head, engine.generation()))));
    match metadata {
        Ok((store_id, head, generation)) => respond_timed(request, shared, status, json!({ "denied": refusal_json(&why), "store_id": store_id, "head": head, "generation": generation })),
        Err(why) => respond_timed(request, shared, if why.code == "E_AUTH" && !why.retryable {401} else {503}, latency::Unobserved(json!({ "denied": refusal_json(&why) }))),
    }
}

// @ref LLP 3000.009#5.1 — a racing id conflict is a terminal input refusal, not a transport failure.
fn mutation_error_status(refusal: &Refusal) -> u16 {
    if refusal.retryable { 503 } else if matches!(refusal.code.as_str(), "E_ID_REUSED" | "E_DELIVERY_BINDING") { 200 } else { 500 }
}

fn handle(mut request: Request, shared: &Shared) {
    #[cfg(test)]
    let _round_trips = tests::round_trip_tests::request_scope(shared);
    // @ref LLP 3000.000.000#93-http-admission-and-reporting — lookup, decode and execution share the admitted release.
    let operation = request.url().split('?').next().is_some_and(|p| p.starts_with("/q/") || p.starts_with("/m/"));
    let _scope=crate::release_requests::Scope::begin(*lock(&shared.generation));

    request.set_cleanup_guard(latency::FinishOnDrop);
    #[cfg(test)] test_work(&shared.request_work);
    let method = request.method().clone();
    let url = request.url().to_owned();
    let path = url.split('?').next().unwrap_or("").to_owned();
    let _evidence = dev_refusals::response::begin(shared, &path);
    // @ref LLP 3000.033#1.2 — closed read allow-list precedes every handler,
    // declared route, dev door and idempotency replay. Refusals carry no head.
    // Read tokens and malformed credentials always enter this guard. Otherwise
    // authenticated full-token handlers retain their input/refusal ordering.
    // Public and dev doors must resolve any supplied credential before dispatch.
    let public_door = path.starts_with("/dev/") || matches!(path.as_str(), "/seed" | "/auth/signup" | "/auth/login" | "/auth/guest")
        || path == token::ENDPOINT || routes::declared(shared, &url).is_some();
    if request.headers().iter().any(|h| h.field.equiv("authorization")
        && (public_door || crate::auth::parse_bearer(h.value.as_str()).is_none_or(|token| token.starts_with("ro.")))) {
        match principal_of(&request, shared) {
            Ok((_, _, snapback4_core::identity::SessionScope::Read)) if !read_permitted(&method, &path) =>
                return respond_timed(request, shared, 403, json!({"denied": Refusal::new("E_READ_ONLY", "auth", "this read session permits reads only; use a full session for writes").guide("read-only")})),
            // @ref LLP 3000.019#3.4 — the private-proof door keeps one indistinguishable refusal.
            Err(_) if path == token::ENDPOINT => return token::denied(request),
            Err(why) => return respond_timed(request, shared, if why.retryable {503} else {401}, json!({"denied": refusal_json(&why)})),
            _ => {}
        }
    }
    // @ref LLP 3000.009.001.000#3.4 — selecting the initial store profile never enables worker claims by accident.
    if !shared.worker_execution && ["/effects", "/actions", "/requests", "/jobs/", "/routes/verify"].iter().any(|prefix| path.starts_with(prefix)) {
        return respond_timed(request, shared, 503, json!({"denied": snapback4_core::RuntimeError::StoreUnsupported {family:"worker-execution"}.refusal()}));
    }
    if path == token::ENDPOINT { return token::handle(request, shared); }
    // This exact declared POST path is the only non-loopback development
    // exception. Core doors, mismatched methods and query variants stay fenced.
    if method == Method::Post && let Some((name, route)) = routes::declared(shared, &url) {
        return routes::ingress(request, shared, &name, route);
    }
    let ephemeral_request = method == Method::Post && path.strip_prefix("/m/").is_some_and(|op| lock(&shared.bound).schema.operations.get(op).is_some_and(|f| f.ephemeral));
    let reject = |request, status, refusal: Refusal| {
        if ephemeral_request { ephemeral::failed_unobserved(request,shared,None,refusal); }
        else if path.starts_with("/q/") { operation_refusal(request, shared, status, refusal); }
        else { respond_timed(request,shared,status,latency::Unobserved(json!({"denied":refusal_json(&refusal)}))); }
    };
    if let Err(refusal) = dev_request(&request, shared) {
        if ephemeral_request { return ephemeral::failed_unobserved(request, shared, None, refusal); }
        respond_with_sync(request, 403, json!({ "denied": refusal_json(&refusal) }), false, None, Some(shared));
        return;
    }
    // /dev/token has already been routed through its mutual local-owner proof.
    if shared.personas && ((path.starts_with("/dev/") && !path.starts_with("/dev/clock")) || path == "/seed") && !shared.dev_doors() {
        return respond_timed(request, shared, 403, json!({"denied":refusal_json(&dev_doors::closed())}));
    }
    if path.starts_with("/dev/clock") && !shared.personas {
        match maintenance::staging(shared) {
            Ok(true) => {},
            Ok(false) => return respond_timed(request, shared, 403, json!({"denied":crate::dev_clock::release()})),
            Err(why) => return respond_timed(request, shared, 503, json!({"denied":why})),
        }
    }
    // Discovered control requests bind to the inspected serving instance.
    // A listener replaced between GET status and POST cannot receive the action.
    if method==Method::Post && (matches!(path.as_str(), "/dev/clock/advance"|"/dev/reset"|"/dev/latency/reset") || (shared.personas && path=="/seed")) {
        match single_header(&request,"x-snapback-dev-instance") {
            Ok(None)=>{},
            Ok(Some(instance)) if shared.dev_identity.as_ref().is_some_and(|i| i.instance==instance)=>{},
            _=>return respond_timed(request,shared,409,json!({"denied":refusal_json(&Refusal::new("E_INPUT","input","dev instance changed since discovery; rerun the command to select the live host"))})),
        }
    }
    if (method == Method::Get && path == "/dev/latency") || (method == Method::Post && path == "/dev/latency/reset") {
        return latency::endpoint(request, shared, method == Method::Post);
    }
    // @ref LLP 3000.000.000.000.000#3-proof-fixture-loading — development field types need no principal.
    if method == Method::Get && path == "/dev/catalog" {
        if !shared.personas { return respond_timed(request, shared, 403, json!({"denied":refusal_json(&Refusal::new("E_AUTH", "auth", "fixture catalog requires dev"))})); }
        let bound = lock(&shared.bound);
        let tables: Vec<Json> = bound.schema.visible_tables().map(|(name, table)| json!({ "name": name, "fields": table.columns.iter().filter(|(column, _)| !table.private_field(column) && !table.engine_field(column)).collect::<BTreeMap<_,_>>() })).collect();
        drop(bound);
        return respond_timed(request, shared, 200, json!({ "tables": tables }));
    }
    if method == Method::Get && path == "/dev/status" {
        if !shared.personas { return respond_timed(request, shared, 403, json!({"denied":refusal_json(&Refusal::new("E_AUTH", "auth", "status inspection requires dev"))})); }
        // No engine lock: doctor must remain usable while an adoption waits on SQLite.
        let generation = *lock(&shared.generation);
        let personas = lock(&shared.bound).personas.clone();
        let status = lock(&shared.adoption);
        let now = shared.now();
        return respond_timed(request, shared, 200, json!({"instance":shared.dev_identity.as_ref().map(|i| &i.instance), "initialStoreId":shared.dev_identity.as_ref().map(|i| &i.initial_store_id), "pid":std::process::id(), "wrapperPid":crate::supervisor::pid(), "storeId":status.store_id, "project":shared.project, "temporary":shared.temporary, "generation":generation, "adoption":status.failure, "now":now, "clockOffsetMs":lock(&shared.clock).offset(), "skewMs":now - snapback4_core::now_ms(), "personas":personas, "scheduling":crate::thread_priority::diagnostics(), "fileDescriptors":crate::host_limits::diagnostics()}));
    }
    if method == Method::Get && path == "/dev/clock/status" { return maintenance::clock_status(request, shared); }
    if method == Method::Options {
        respond_empty(request, 204);
        return;
    }
    if method == Method::Post && path == "/seed" && !shared.personas {
        return respond_timed(request, shared, 403, json!({ "denied": refusal_json(&Refusal::new("E_AUTH", "auth", "seeding is a development door")) }));
    }
    if path == "/dev/reset" && !shared.personas {
        return respond_timed(request, shared, 403, json!({ "denied": refusal_json(&dev_doors::reset_release()) }));
    }
    let mut operation_capability = None;
    // Check credentials before upload admission; /q and /m carry bounded hints.
    // Fresh preflight/execution authority follows body and queue waits, so
    // expiry/revocation cannot retain an earlier observation's authority.
    // Logout's body is only 4 KiB and its sole authentication happens inside
    // the SQLite writer transaction that closes the live session family.
    if method == Method::Post && (path == "/assets" || path.starts_with("/assets/intent/") || path == "/sync" || path.starts_with("/q/") || path.starts_with("/following/") || path.starts_with("/m/") || path.starts_with("/a/")
        || (path.starts_with("/actions/") && path.ends_with("/cancel"))
        || matches!(path.as_str(), "/auth/refresh" | "/auth/logout-all")) {
        match if path.starts_with("/q/") || path.starts_with("/m/") { session_identity::operation_ingress(&request, shared) } else { session_identity::ingress_of(&request, shared).map(Some) } {
            Ok(capability) => operation_capability = capability,
            Err(refusal) => {
            // No authenticated viewer: metadata cannot disclose a store head.
            let status = if refusal.code == "E_STORE_REPLACED" { 409 } else if refusal.retryable { 503 } else { 401 };
            if path.starts_with("/q/") { return respond_timed(request, shared, status, latency::Unobserved(json!({"denied":refusal_json(&refusal)}))); }
            return reject(request, status, refusal);
            }
        }
    }
    if method == Method::Post && (path == "/auth/revoke" || path.starts_with("/routes/verify/") || (path.starts_with("/actions/") && !path.ends_with("/cancel"))) {
        if let Err(refusal) = service_of(&request, shared) {
            return reject(request, if refusal.retryable { 503 } else { 401 }, refusal);
        }
    }
    if method == Method::Get && matches!(path.as_str(), "/" | "/schema" | "/api.ts" | "/native.wasm" | "/changes") {
        if let Err(refusal) = principal_of(&request, shared) {
            return reject(request, if refusal.retryable { 503 } else { 401 }, refusal);
        }
    }
    #[cfg(test)] if operation { test_work(&shared.operation_ingress); }
    let _upload_permit = if method == Method::Post && path == "/assets" {
        match crate::assets::admit(shared) {
            Some(permit) => Some(permit),
            None => {
                let mut refusal = Refusal::new("E_RATE_LIMIT", "auth", "too many concurrent uploads; retry shortly");
                refusal.retryable = true;
                return respond_timed(request, shared, 429, json!({ "denied": refusal_json(&refusal) }));
            }
        }
    } else { None };
    let mut bytes = Vec::new();
    // @ref LLP 3000.038#3 — a file upload streams at most the schema's largest file bound, refused before reading when declared larger.
    let file_upload = method == Method::Post && path == "/assets" && crate::assets::is_file_upload(&url);
    if method == Method::Post {
        let ceiling = match path.as_str() {
            "/assets" if file_upload => match crate::assets::file_ceiling(shared) {
                Ok(ceiling) => ceiling,
                Err(refusal) => return reject(request, 415, refusal),
            },
            "/assets" => crate::assets::UPLOAD_CEILING,
            "/seed" | "/dev/reset" => SEED_REQUEST_CEILING,
            "/sync" => SYNC_REQUEST_CEILING,
            path if path.starts_with("/auth/") => crate::auth::BODY_CEILING,
            path if path.starts_with("/following/") => 64 * 1024,
            _ => JSON_REQUEST_CEILING,
        };
        let length = request.body_length();
        let too_large = || if file_upload {
            Refusal::new("E_ASSET_TOO_LARGE", "asset", format!("the file exceeds {ceiling} bytes, the largest file column's bound")).guide("assets")
        } else {
            Refusal::new("E_INPUT", "input", format!("the request body exceeds its {ceiling}-byte limit; split it into smaller requests"))
        };
        if length.is_some_and(|length| length > ceiling) {
            return reject(request, 413, too_large());
        }
        let mut buffer = [0; 8 * 1024];
        loop {
            let length = buffer.len().min(ceiling - bytes.len() + 1);
            match request.as_reader().read(&mut buffer[..length]) {
                Ok(0) => break,
                Ok(read) if read > ceiling - bytes.len() => return reject(request, 413, too_large()),
                Ok(read) => bytes.extend_from_slice(&buffer[..read]),
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                Err(error) => return reject(request, 400, Refusal::new("E_INPUT", "input", format!("cannot read the request body: {error}"))),
            }
        }
        if length.is_some_and(|length| length != bytes.len()) {
            return reject(request, 400, Refusal::new("E_INPUT", "input", "the request body ended before its declared Content-Length"));
        }
    }
    if method == Method::Post && path == "/assets" {
        return crate::assets::upload(request, bytes, shared);
    }
    if method == Method::Post && let Some(id)=path.strip_prefix("/assets/intent/").and_then(|s|s.strip_suffix("/declare")){return crate::assets::declare(request,id,bytes,shared);}
    if method == Method::Post && let Some(id) = path.strip_prefix("/assets/intent/").and_then(|s| s.strip_suffix("/finish")) {
        return crate::assets::finish(request, id, bytes, shared);
    }
    if method == Method::Post && let Some(id) = path.strip_prefix("/assets/intent/").and_then(|s| s.strip_suffix("/cancel")) {
        return crate::assets::cancel(request, id, shared);
    }
    if method == Method::Get && path == "/assets/intents" { return crate::assets::intents(request, shared); }
    if method == Method::Get && let Some(id) = path.strip_prefix("/assets/") {
        return crate::assets::serve(request, id, shared);
    }
    let body = match String::from_utf8(bytes) {
        Ok(body) => body,
        Err(_) => return reject(request, 400, Refusal::new("E_INPUT", "input", "a JSON request body must be valid UTF-8")),
    };
    let request_now = if (method == Method::Get && path == "/changes")
        || (method == Method::Post && (path == "/sync" || path.starts_with("/q/") || path.starts_with("/m/")))
    {
        match shared.advance_time_audiences().map_err(|error| error.refusal()) {
            Ok(now) => Some(now),
            Err(refusal) => return reject(request, 503, refusal),
        }
    } else { None };
    if operation && !shared.personas {crate::release_requests::Scope::admit(&shared.release_requests,||*lock(&shared.generation));}
    match (method, path.as_str()) {
        (Method::Post, "/dev/clock/advance") => maintenance::advance(request, shared, &body),
        (Method::Post, path) if path.starts_with("/jobs/") => maintenance::run_job(request, shared, &path["/jobs/".len()..], &body),
        (Method::Post, path) if path.starts_with("/dev/jobs/") => maintenance::run_job(request, shared, &path["/dev/jobs/".len()..], &body),
        (Method::Post, path) if path.starts_with("/a/") => actions::call(request, shared, path.trim_start_matches("/a/"), &body),
        (Method::Post, "/actions/claim") => actions::claim(request, shared, &body),
        (Method::Post, "/actions/claim-set") => actions::claim_set(request, shared, &body),
        (Method::Post, "/routes/verify/claim") => routes::claim(request, shared, &body),
        (Method::Post, path) if path.starts_with("/routes/verify/") => routes::settle(request, shared, path, &body),
        (Method::Post, path) if path.starts_with("/actions/") => actions::settle(request, shared, path, &body),
        (Method::Post, "/effects/claim") => effects::claim(request, shared, &body),
        (Method::Post, path) if path.starts_with("/effects/") => effects::post(request, shared, path, &body),
        (Method::Get, "/effects") => effects::list(request, shared, &url),
        (Method::Get | Method::Post, "/probe") => match principal_of(&request, shared) {
            Ok(viewer) => {
                let identity = shared.read_identity();
                match identity {
                    Ok((store_id, seq,generation)) => {
                        let mut reply = json!({ "ok": true, "store_id": store_id, "seq": seq, "generation":generation,"viewer": viewer.0 });
                        if query_params(&url).get("scope").is_some_and(|scope| scope == "1") {
                            reply["kind"] = json!(viewer.1); reply["scope"] = json!(viewer.2);
                        }
                        respond_timed(request, shared, 200, reply)
                    },
                    Err(error) => respond_timed(request, shared, 500, json!({ "denied": refusal_json(&error) })),
                }
            },
            Err(refusal) => respond_timed(request, shared, if refusal.retryable { 503 } else { 401 }, json!({ "denied": refusal_json(&refusal) })),
        },
        (Method::Get, "/auth/config") => crate::auth::config(request, shared),
        (Method::Get, "/") => {
            let seq = match shared.read_head() {
                Ok((_, seq)) => seq,
                Err(error) => return respond_timed(request, shared, 500, json!({ "denied": refusal_json(&error) })),
            };
            let body = {
                let bound = lock(&shared.bound);
                let ops: Vec<Json> = bound.programs.iter().filter(|p| p.program.kind != snapback4_core::ir::ProgramKind::Job).map(|p| json!({ "name": p.program.name, "kind": p.program.kind.word(), "args": p.program.args, "aliases": p.program.arg_aliases })).collect();
                let tables: Vec<Json> = bound.schema.visible_tables().map(|(name, table)| json!({ "name": name, "sync": table.sync.as_ref().map(|s| s.line_in(table)), "fields": table.columns.iter().filter(|(column, _)| !table.private_field(column) && !table.engine_field(column)).collect::<BTreeMap<_,_>>() })).collect();
                json!({ "snapback4": env!("CARGO_PKG_VERSION"), "device_compatibility": snapback4_core::device_protocol::compatibility(&bound.schema.public_projection()), "generation": *lock(&shared.generation), "seq": seq, "ops": ops, "tables": tables })
            };
            respond_timed(request, shared, 200, body);
        }
        (Method::Get, "/schema") => {
            if let Err(denied) = principal_of(&request, shared) {
                return respond_timed(request, shared, 401, json!({ "denied": refusal_json(&denied) }));
            }
            // The compiled backend a device runs locally: the schema and the
            // programs' IR, bound to a generation.
            let (schema, programs, service_identities, generation, native) = {
                let bound = lock(&shared.bound);
                (bound.schema.public_projection(), snapback4_lang::emit::backend_programs(&bound), crate::service_identities::collect(&bound), *lock(&shared.generation), lock(&shared.native).as_ref().map(|n| (n.digest.clone(), n.jobs.clone(), n.reads.clone())))
            };
            if let Err(denied) = crate::device_handshake::check_schema(&schema, crate::device_handshake::header(&request), false) {
                return respond_timed(request, shared, 409, json!({ "denied": refusal_json(&denied) }));
            }
            let native = native.map(|(digest, jobs, reads)| json!({ "digest": digest, "jobs": jobs, "reads": reads }));
            // @ref LLP 3000.007#20.4 — a cold click binds to the backend
            // that supplied its program, even before replica identification.
            let store_id = lock(&shared.wake).store_id.clone();
            respond_timed(request, shared, 200, json!({ "generation": generation, "device_compatibility": snapback4_core::device_protocol::compatibility(&schema), "schema": schema, "programs": programs, "service_identities": service_identities, "native": native, "store_id": store_id }));
        }
        (Method::Get, "/native.wasm") => {
            // The app's module, for a device to run its native reads over
            // the rows it holds (LLP 3000.005 §9).
            let installed = {
                let _bound=lock(&shared.bound);
                let installed=lock(&shared.native).clone();
                crate::release_requests::stamp(*lock(&shared.generation));
                installed
            };
            match installed {
                Some(module) => {
                    let mut response = Response::from_data(module.bytes);
                    if let Some(header)=generation_header(){response.add_header(header);}
                    response.add_header(Header::from_bytes("Content-Type", "application/wasm").unwrap());
                    response.add_header(Header::from_bytes("ETag", format!("\"{}\"", module.digest)).unwrap());
                    response.add_header(Header::from_bytes("Cache-Control", "private, no-store").unwrap());
                    for header in cors(&request).into_iter().chain(latency::header()) { response.add_header(header); }
                    let _ = request.respond(response);
                }
                None => respond_timed(request, shared, 404, json!({ "denied": refusal_json(&Refusal::new("E_NATIVE", "schema", "this backend has no native module")) })),
            }
        }
        (Method::Get, "/api.ts") => {
            let text={let bound=lock(&shared.bound);crate::release_requests::stamp(*lock(&shared.generation));snapback4_lang::emit::typescript(&bound)};
            let mut response = Response::from_string(text);
            if let Some(header)=generation_header(){response.add_header(header);}
            response.add_header(Header::from_bytes("Content-Type", "text/plain; charset=utf-8").unwrap());
            response.add_header(Header::from_bytes("Cache-Control", "no-store").unwrap());
            for header in cors(&request).into_iter().chain(latency::header()) { response.add_header(header); }
            let _ = request.respond(response);
        }
        (Method::Post, path) if path.starts_with("/following/") => following::serve(request,shared,&path[11..],&body),
        (Method::Post, path) if path.starts_with("/q/") || path.starts_with("/m/") => {
            let op = path[3..].to_owned();
            let operation_request::Prepared { capability: (principal, credential_kind, scope), payload, args_json, args, delivery_fingerprint, ephemeral } = match operation_request::prepare(&request, shared, &op, &body, operation_capability) {
                Ok(prepared) => prepared,
                Err(reply) => {
                    let id = serde_json::from_str::<Json>(&body).ok().and_then(|p| p.get("id").and_then(Json::as_str).map(str::to_owned));
                    if let Some(why) = reply.body.get("denied").and_then(|why| serde_json::from_value::<Refusal>(why.clone()).ok()) {
                        // Keyed authentication refuses before any ephemeral
                        // judgment, including a historical durable replay.
                        if !(id.is_some() && why.code == "E_AUTH") && path.starts_with("/m/")
                            && lock(&shared.bound).schema.operations.get(&op).is_some_and(|fact| fact.ephemeral) {
                            let mut body = mutation_reply(json!({"state":"failed","id":id,"why":why}));
                            for field in ["store_id", "head", "generation"] {
                                if let Some(value) = reply.body.get(field) { body[field] = value.clone(); }
                            }
                            if reply.body.get("store_id").is_none() { return respond_timed(request, shared, 200, latency::Unobserved(body)); }
                            return respond_timed(request, shared, 200, body);
                        }
                    }
                    if reply.body.get("store_id").is_none() { return respond_timed(request, shared, reply.status, latency::Unobserved(reply.body)); }
                    return respond_timed(request, shared, reply.status, reply.body);
                },
            };
            if ephemeral { return ephemeral::serve(request, shared, &op, &body, (principal, credential_kind, scope)); }
            let manifest = if scope == snapback4_core::identity::SessionScope::Read { snapback4_core::engine::DeliveryManifest::Skip } else { snapback4_core::engine::DeliveryManifest::Build };
            let presence_of = |engine: &Engine, name: &str| engine.schema().operations.get(name).is_some_and(|fact| fact.sites.iter().any(|site| site.kind == "presence"));
            let viewer = principal.clone();
            let mut context = Context::new(&principal, args).at(request_now.unwrap_or_else(|| shared.now())).with_request_credential(&credential_kind).with_revision_cache(!shared.personas && !shared.staging);
            if path.starts_with("/q/") {
                let provenance = payload.get("provenance").and_then(Json::as_bool) == Some(true);
                if provenance { context = context.with_row_provenance(); }
                let retained: Option<Vec<String>> = match payload.get("searchRetained") {
                    Some(value) => match serde_json::from_value(value.clone()) {
                        Ok(ids) => Some(ids),
                        Err(_) => return operation_refusal(request, shared, 400, Refusal::new("E_INPUT", "input", "searchRetained must be a page of IDs")),
                    },
                    None => None,
                };
                if let Some(value) = payload.get("searchRetainedOrder") {
                    let order: Vec<i64> = match value.as_array().and_then(|values| values.iter().map(snapback4_core::search_decoration::order_key).collect()) {
                        Some(order) => order,
                        None => return operation_refusal(request, shared, 400, Refusal::new("E_INPUT", "input", "searchRetainedOrder must contain integer ordering keys")),
                    };
                    if retained.as_ref().is_none_or(|ids| ids.len() != order.len()) {
                        return operation_refusal(request, shared, 400, Refusal::new("E_INPUT", "input", "retained search ordering keys require matching candidate IDs"));
                    }
                    context.search_retained_order = Some((order, payload.get("searchRetainedMore").and_then(Json::as_bool).unwrap_or(false)));
                }
                let (settlement_started, mut handoffs) = (Instant::now(), 0);
                let (outcome, cut, metadata, reads_presence, query_generation, search_current, scopes, decoration_paths) = loop {
                let reader = if handoffs == 0 { shared.reader() } else { shared.reader_after_handoff() };
                let evaluated = match reader {
                    Ok((epoch, mut reader)) => {
                        #[cfg(test)] test_work(&shared.query_wait);
                        let admission = match session_identity::Admission::capture(&request, shared) { Ok(value) => value, Err(why) => return respond_timed(request, shared, 401, json!({"denied":why})) };
                        let persona = admission.persona(shared, &reader);
                        let expected = (principal.clone(), credential_kind.clone(), scope);
                        // Take identity from the same reader that evaluates the query,
                        // never from an engine that may have replaced it meanwhile.
                        let context = match query_readers::query_context(&reader, shared, &op, &args_json, context.clone()) { Ok(context) => context, Err(_) => return operation_request::query_argument_refusal(request, shared, op.clone(), args_json.clone(), context.clone()) };
                        let reads_presence = presence_of(&reader, &op);
                        let context = dev_refusals::response::context(context.clone(), reader.refusal_sites.clone(), &reader);
                        let query_generation = reader.generation();
                        let decoration_paths = reader.program(&op).filter(|_| reader.schema().operations.get(&op).is_some_and(|f| f.search_decoration)).map(snapback4_core::search_decoration::paths);
                        let scopes = read_scopes::dependencies(&reader, &op, &context);
                        trace::mark("query_start");
                        let mut metadata = None;
                        let (outcome, cut, current) = reader.query_materialized_search_with_request(&op, context, retained.as_deref(), manifest, &admission.digest(), |snapshot, head| {
                            let authority = snapshot.request_authority(&admission.digest(), admission.sample(shared)).map_err(|e| e.refusal()).and_then(|facts| {
                                persona.clone().and_then(|persona| admission.check_bound_facts(shared, &expected, &facts, persona, None))?;
                                Ok((facts.store_id, head))
                            });
                            let result = authority.as_ref().map(|_| ()).map_err(Clone::clone);
                            metadata = Some(authority); result
                        });
                        let metadata = head::query_response_head(&mut reader, metadata, &outcome);
                        if let Err(why) = &metadata && why.code == "E_GENERATION" {
                            if handoffs < 2 { handoffs += 1; continue; }
                            // @ref LLP 3000.018#3.2 — a refused query has no complete answer or certified cut.
                            // RT3b generation refusals remain metadata-free after handoff exhaustion.
                            return respond_timed(request, shared, 503, latency::Unobserved(json!({"denied":why,"complete":false})));
                        }
                        trace::mark("query_end");
                        let scopes = read_scopes::complete(scopes, reader.schema(), outcome.as_ref().map_or(&[], |o| &o.tables));
                        if outcome.is_ok() && metadata.is_ok() { lock(&shared.readers).put(&epoch, reader.into_inner()); }
                        (outcome, cut, metadata, reads_presence, query_generation, current, scopes, decoration_paths)
                    },
                    // Only memory stores lack detached readers by construction.
                    Err(error) if !shared.memory_store() => {
                        if matches!(error.underlying(), snapback4_core::RuntimeError::Generation(_)) && handoffs < 2 {
                            handoffs += 1;
                            continue;
                        }
                        let why = error.refusal();
                        let reply = if why.code == "E_GENERATION" { json!({"denied":why,"complete":false}) } else { json!({"denied":why}) };
                        return respond_timed(request, shared, 503, latency::Unobserved(reply));
                    }
                    Err(_) => {
                        let admission = session_identity::Admission::capture(&request, shared);
                        let (op, context, retained, args_json) = (op.clone(), context.clone(), retained.clone(), args_json.clone());
                        let refused = (op.clone(), args_json.clone(), context.clone());
                        let credential_kind = credential_kind.clone();
                        let result = shared.engine.attempt(move |engine, shared| {
                            let admission = admission?;
                            let persona = admission.persona(shared, engine);
                            let expected = (context.viewer.clone(), credential_kind, scope);
                        let reads_presence = presence_of(engine, &op);
                        let mut context = context.clone();
                        context = query_readers::query_context(engine, shared, &op, &args_json, context)?;
                        if shared.personas { context = dev_refusals::response::context(context, Arc::new(lock(&shared.bound).refusal_sites.clone()), engine); }
                        let query_generation = engine.generation();
                        let decoration_paths = engine.program(&op).filter(|_| engine.schema().operations.get(&op).is_some_and(|f| f.search_decoration)).map(snapback4_core::search_decoration::paths);
                        let scopes = read_scopes::dependencies(engine, &op, &context);
                        let mut metadata = None;
                        let (outcome, cut, current) = engine.query_materialized_search_with_request(&op, context, retained.as_deref(), manifest, &admission.digest(), |snapshot, head| {
                            let authority = snapshot.request_authority(&admission.digest(), admission.sample(shared)).map_err(|e| e.refusal()).and_then(|facts| {
                                persona.clone().and_then(|persona| admission.check_bound_facts(shared, &expected, &facts, persona, None))?;
                                Ok((facts.store_id, head))
                            });
                            let result = authority.as_ref().map(|_| ()).map_err(Clone::clone);
                            metadata = Some(authority); result
                        });
                        let metadata = head::query_response_head(engine, metadata, &outcome);
                        let scopes = read_scopes::complete(scopes, engine.schema(), outcome.as_ref().map_or(&[], |o| &o.tables));
                        Ok::<_, Refusal>((outcome, cut, metadata, reads_presence, query_generation, current, scopes, decoration_paths))
                        });
                        match result { Ok(value) => value, Err(why) if matches!(why.code.as_str(), "E_INPUT" | "E_OP") => return operation_request::query_argument_refusal(request, shared, refused.0, refused.1, refused.2), Err(why) => return respond_timed(request, shared, 401, json!({"denied":why})) }

                    },
                };
                if evaluated.0.as_ref().is_err_and(|error| error.code == "E_GENERATION") && handoffs < 2 {
                    handoffs += 1;
                    continue;
                }
                if let Some((table, id)) = evaluated.0.as_ref().ok().and_then(|outcome| outcome.pending_opening.as_ref()) {
                    if settlement_started.elapsed() >= Duration::from_secs(30) || crate::lifecycle::stopping() {
                        let mut why = Refusal::new("E_QUERY_RETRY", "client", "timed disclosure did not settle within the query wait; retry the query").guide("client");
                        why.retryable = true;
                        return respond_timed(request, shared, 503, json!({"denied":why}));
                    }
                    let (table, id, requested) = (table.clone(), id.clone(), context.now);
                    let result = shared.engine.attempt(move |engine, shared| {
                        let now = engine.materialize_time_audience_at(&table, &id, requested.unwrap_or_else(|| shared.now()))?;
                        shared.refresh_time_audience_clock(engine, now);
                        shared.durable_committed(engine);
                        Ok::<_, snapback4_core::RuntimeError>(())
                    });
                    if let Err(error) = result { return respond_timed(request, shared, 503, json!({"denied":error.refusal()})); }
                    if let Err(why) = session_identity::principal_of(&request, shared) {
                        return respond_timed(request, shared, 401, json!({"denied":why}));
                    }
                    std::thread::yield_now();
                    continue;
                }
                break evaluated;
                };
                if let Err(why) = &metadata && why.code == "E_AUTH" {
                    return respond_timed(request, shared, if why.retryable {503} else {401}, json!({"denied":why}));
                }
                let (store_id, head) = match metadata { Ok(head) => head, Err(why) => {
                    let reply = if why.code == "E_GENERATION" { json!({"denied":why,"complete":false}) } else { json!({"denied":why}) };
                    respond_timed(request, shared, 503, latency::Unobserved(reply)); return;
                } };
                match outcome {
                    Ok(outcome) => {
                        #[derive(serde::Serialize)]
                        struct QueryReply<'a> {
                            #[serde(skip_serializing_if = "Option::is_none")]
                            scopes: &'a Option<Json>,
                            #[serde(rename = "searchScopes", skip_serializing_if = "Option::is_none")]
                            search_scopes: &'a Option<Vec<String>>,
                            #[serde(rename = "searchRows", skip_serializing_if = "Option::is_none")]
                            search_rows: Option<wire::Plain<'a>>,
                            #[serde(rename = "searchCurrent", skip_serializing_if = "Option::is_none")]
                            search_current: &'a Option<Vec<String>>,
                            #[serde(skip_serializing_if = "Option::is_none")]
                            delivery: &'a Option<snapback4_core::engine::delivery::Manifest>,
                            #[serde(skip_serializing_if = "Option::is_none")]
                            ephemeral: &'a Option<snapback4_core::schema::ephemeral::Version>,
                            generation: u64,
                            complete: bool,
                            cut: Option<snapback4_core::engine::ReadCut>,
                            data: wire::QueryData<'a>,
                            next: &'a Option<String>,
                            #[serde(rename = "nextExpiry")]
                            next_expiry: Option<i64>,
                            #[serde(rename = "decorationPaths", skip_serializing_if = "Option::is_none")]
                            decoration_paths: Option<Vec<Vec<String>>>,
                            #[serde(rename = "decorationExpiry", skip_serializing_if = "Option::is_none")]
                            decoration_expiry: Option<Option<i64>>,
                            seq: u64,
                            store_id: String,
                            tables: &'a [String],
                            viewer: &'a str,
                            #[serde(skip_serializing_if = "Option::is_none")]
                            meter: Option<Json>,
                            #[serde(rename = "rowProvenance", skip_serializing_if = "Option::is_none")]
                            row_provenance: Option<wire::Plain<'a>>,
                            #[serde(skip_serializing_if = "Option::is_none")]
                            refresh: Option<u64>,
                        }
                        impl latency::Reply for QueryReply<'_> { fn generation(&self)->Option<u64>{Some(self.generation)} }
                        // @ref LLP 3000.018#3 — an answer of a query that may read presence asks its client to re-run it: no change feed names presence.
                        let refresh = reads_presence.then(|| PRESENCE_REFRESH.as_millis() as u64);
                        // @ref LLP 3000#7-decisions-during-execution — loopback dev returns read counters by default; releases never disclose them.
                        let meter = shared.personas.then(|| {
                            if let Some(line) = lock(&shared.read_cuts).line(&op, &viewer, &outcome, Instant::now()) { snapback4_core::diagnostic!("{line}"); }
                            let m = outcome.metered;
                            let cut = if outcome.capped_at.is_some() { Some("meter") } else if outcome.word_cut_at.is_some() { Some("words") } else { None };
                            let mut meter = json!({ "examined": m.examined, "indexEntries": m.index_entries, "probes": m.rule_probes, "steps": m.steps, "heapBytes": m.heap_bytes, "outputBytes": m.output_bytes, "rowsWritten": m.rows_written, "cut": cut });
                            if let Some(delivery) = &outcome.delivery_meter { meter["delivery"] = json!(delivery); }
                            meter
                        });
                        if outcome.unavailable {
                            let mut reply = json!({ "loading": true, "generation": query_generation, "data": null, "complete": false, "nextExpiry": outcome.next_expiry, "seq": outcome.seq, "store_id": store_id, "tables": outcome.tables, "viewer": viewer });
                            if let Some(version) = &outcome.ephemeral { reply["ephemeral"] = json!(version); }
                            if let Some(meter) = meter { reply["meter"] = meter; }
                            if let Some(refresh) = refresh { reply["refresh"] = json!(refresh); }
                            respond_timed(request, shared, 200, reply);
                        } else {
                            let row_provenance = provenance.then(|| outcome.data.retained_rows_mask());
                            respond_timed(request, shared, 200, QueryReply { scopes: &scopes, search_current: &search_current, generation: query_generation, search_scopes: &outcome.search_scopes, search_rows: outcome.search_rows.as_ref().map(wire::Plain), delivery: &outcome.delivery, ephemeral: &outcome.ephemeral, row_provenance: row_provenance.as_ref().map(wire::Plain), complete: outcome.complete, cut: outcome.cut, data: wire::QueryData(&outcome), next: &outcome.next, next_expiry: outcome.next_expiry, decoration_expiry: decoration_paths.is_some().then_some(outcome.decoration_expiry), decoration_paths, seq: outcome.seq, store_id, tables: &outcome.tables, viewer: &viewer, meter, refresh });
                        }
                    }
                    Err(refusal) => {
                        let mut reply = json!({ "denied": refusal_json(&refusal), "generation": query_generation, "complete": false, "store_id": store_id, "head": head });
                        // @ref LLP 3000.018#3.2 — a refusal names its evaluation cut so a client
                        // can order it against a remembered answer; its head now shares that snapshot.
                        if let Some(cut) = cut { reply["seq"] = json!(cut); }
                        // A refusal can depend on presence too: its watch keeps refreshing (LLP 3000.018 §3.2).
                        if reads_presence && !refusal.retryable { reply["refresh"] = json!(PRESENCE_REFRESH.as_millis() as u64); }
                        respond_timed(request, shared, if refusal.retryable || refusal.code == "E_GENERATION" { 503 } else if refusal.code=="E_INPUT" && refusal.family=="input" {400} else {200}, reply);
                    }
                }
            } else {
                let id = payload.get("id").and_then(Json::as_str).map(str::to_owned);
                if let Some(ids) = payload.get("newIds").and_then(Json::as_array) {
                    context = context.with_ids(ids.iter().filter_map(Json::as_str).map(str::to_owned));
                }
                #[cfg(test)] test_work(&shared.mutation_wait);
                let admission = match session_identity::Admission::capture(&request, shared) {
                    Ok(admission) => admission,
                    Err(why) => return respond_timed(request, shared, 401, json!({"denied": why})),
                };
                let (owned_op, owned_id, owned_principal) = (op.clone(), id.clone(), principal.clone());
                let diverted_capability = (principal.clone(), credential_kind.clone(), scope);
                let boundary=Arc::new(Mutex::new(None));
                let boundary_check=boundary.clone();
                let diverted=Arc::new(AtomicBool::new(false));
                let diverted_prepare=diverted.clone();
                let result = shared.engine.program(request.accepted_at(), move |engine, shared| {
                    if engine.schema().operations.get(&owned_op).is_some_and(|f| f.ephemeral) {
                        diverted_prepare.store(true,Ordering::Release);
                        return Err(Refusal::new("E_GENERATION","op","operation became ephemeral"));
                    }
                    if shared.personas { context = dev_refusals::response::context(context, Arc::new(lock(&shared.bound).refusal_sites.clone()), engine); }
                    context.delivery_fingerprint = delivery_fingerprint;
                    let persona = admission.persona(&shared, engine)?;
                    let expected = (owned_principal, credential_kind, scope);
                    let sample_host=shared.clone();let sample_admission=admission.clone();
                    let generation=engine.generation();
                    Ok(snapback4_core::engine::program::Invocation::new(owned_op,owned_id,context.with_wire_args(args_json))
                        .authorized(admission.digest(),move ||sample_admission.sample(&sample_host),move |facts| {
                            // Bind fresh store facts before refreshing the hint or accepting authority.
                            admission.check_bound_facts(&shared,&expected,&facts,persona.clone(),Some(generation))?;
                            *lock(&boundary_check)=Some((facts.store_id.clone(),facts.head));
                            head::intent_store_id(&payload,Some(&facts.store_id))
                        }))
                },move |engine,shared,outcome| {
                    if diverted.load(Ordering::Acquire) {return Ok(None);}
                    let boundary=lock(&boundary).clone();
                    if let Err(why)=&outcome && (boundary.is_none() || matches!(why.code.as_str(),"E_AUTH"|"E_COMMIT_OUTCOME_UNKNOWN")) {return Err(why.clone());}
                    Ok(Some(head::mutation_acknowledgement_at(shared,engine,outcome,boundary)))
                });
                let (outcome, metadata, preserved, generation) = match result.and_then(|v| v) {
                    Ok(Some(value)) => value,
                    Ok(None) => return ephemeral::serve(request, shared, &op, &body, diverted_capability),
                    Err(mut why) => { if id.is_some() && why.code == "E_STORE_OWNERSHIP" { why.retryable = true; } return respond_timed(request, shared, if why.code=="E_COMMIT_OUTCOME_UNKNOWN" {500} else if why.retryable {503} else {401}, latency::Unobserved(json!({"denied": why}))); },
                };
                let (store_id, head) = match metadata { Ok(head) => head, Err(why) => { respond_timed(request, shared, 503, json!({ "denied": why })); return; } };
                match outcome {
                    Ok(outcome) => {
                        let mut body = mutation_reply(outcome.reply(id.as_deref()));
                        body["preserved"] = json!(preserved);
                        body["generation"] = json!(generation);
                        body["store_id"] = json!(store_id);
                        body["head"] = json!(head);
                        respond_timed(request, shared, 200, body);
                    }
                    Err(refusal) => { respond_timed(request, shared, if refusal.code == "E_STORE_REPLACED" { 200 } else { mutation_error_status(&refusal) }, mutation_reply(json!({ "state": "failed", "id": id, "why": refusal_json(&refusal), "store_id": store_id, "head": head, "generation": generation }))) }
                }
            }
        }
        (Method::Get, "/changes") => changes::serve(request, shared, &url),
        (Method::Post, "/sync") => sync::serve(request, shared, &body, request_now.expect("sync pins request time")),
        (Method::Post, "/auth/session") => {
            // An application that authenticates its own accounts (a phone
            // it verified, a directory it owns) mints their sessions through
            // its service and hands each token to that account's device.
            let payload: Json = serde_json::from_str(if body.is_empty() { "{}" } else { &body }).unwrap_or(Json::Null);
            let wire = session_mint_wire(&request, &payload);
            let legacy_now = shared.now();
            let authority = service_admission(&request, shared);
            let outcome = shared.engine.attempt(move |engine, shared| {
                match authority.and_then(|token| service_token_of(&token, shared, engine)) {
                    Err(refusal) => Err((401, refusal)),
                    Ok(service) => match wire {
                        Err(error) => Err(error),
                        Ok(SessionMintWire::Legacy { principal, kind, days }) => {
                            snapback4_core::identity::custom_session(engine.store(), &principal, &kind, legacy_now, days)
                                .map(|session| json!({ "session": { "principal": session.principal, "kind": session.kind, "token": session.token, "expiresAt": session.expires_at }, "by": service }))
                                .map_err(|error| (crate::auth::error_status(&error), error.refusal()))
                        }
                        Ok(SessionMintWire::Bound { principal, kind, days, binding, lease, service_token }) => {
                            snapback4_core::identity::bound_custom_session(engine.store_mut(), &service_token, &service, &lease, &principal, &kind, || shared.now(), days, &binding)
                                .map(|session| json!({ "session": { "principal": session.principal, "kind": session.kind, "token": session.token, "expiresAt": session.expires_at }, "by": service }))
                                .map_err(|error| (crate::auth::error_status(&error), error.refusal()))
                        }
                    },
                }
            });
            match outcome {
                Ok(body) => respond_timed(request, shared, 200, body),
                Err((status, refusal)) => respond_timed(request, shared, status, json!({ "denied": refusal_json(&refusal) })),
            }
        }
        (Method::Post, "/auth/revoke") => {
            let _service = match service_of(&request, shared) {
                Ok(service) => service,
                Err(refusal) => return respond_timed(request, shared, 401, json!({ "denied": refusal_json(&refusal) })),
            };
            let payload: Json = serde_json::from_str(if body.is_empty() { "{}" } else { &body }).unwrap_or(Json::Null);
            let Some(principal) = payload.get("principal").and_then(Json::as_str).map(str::to_owned) else {
                return respond_timed(request, shared, 400, json!({ "denied": refusal_json(&Refusal::new("E_INPUT", "input", "name the account: { \"principal\": \"member:42\" }")) }));
            };
            let target = principal.clone();
            let outcome = shared.engine.attempt(move |engine, _| snapback4_core::identity::revoke_principal(engine.store(), &target));
            match outcome {
                Ok(revoked) => respond_timed(request, shared, 200, json!({ "revoked": revoked, "principal": principal })),
                Err(error) => respond_timed(request, shared, crate::auth::error_status(&error), json!({ "denied": refusal_json(&error.refusal()) })),
            }
        }
        (Method::Post, "/auth/guest") | (Method::Post, "/auth/signup") | (Method::Post, "/auth/login")
        | (Method::Post, "/auth/narrow") | (Method::Post, "/auth/logout") | (Method::Post, "/auth/refresh") | (Method::Post, "/auth/logout-all") => {
            crate::auth::handle(request, shared, &path, &body);
        }
        (Method::Post, "/seed") => dev_doors::seed(request, shared, &body),
        (Method::Post, "/dev/reset") => dev_doors::reset(request, shared, &body),
        _ => respond_timed(request, shared, 404, json!({ "denied": refusal_json(&Refusal::new("E_OP", "op", format!("no route {path}; operations are POST /q/<op> and POST /m/<op>"))) })),
    }
}

#[cfg(test)]
#[path = "../tests/serve_poison/mod.rs"]
mod poison_tests;

// All raw (asset/native/route/empty) replies advertise the admitted generation too.
pub(crate) fn generation_header()->Option<Header>{
    crate::release_requests::reply_generation().map(|g|Header::from_bytes("X-Snapback-Generation",g.to_string()).unwrap())
}
