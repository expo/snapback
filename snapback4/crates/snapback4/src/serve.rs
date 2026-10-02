//! The wire: one HTTP server over the engine. Operations are `POST /q/<op>`
//! and `POST /m/<op>` with plain JSON; a device follows `POST /sync` from its
//! watermark; the online tier long-polls `GET /changes`. Typed states, no
//! silent state (LLP 2000.000 §8). Development personas ride a header on
//! loopback; `dev` re-compiles the schema when a `.q` file changes.
use crate::project::{Project, persona_principal};
use snapback4_core::error::Refusal;
use snapback4_core::ir::ProgramKind;
use snapback4_core::{Context, Engine, Presence, WriteState, wire};
use snapback4_lang::Bound;
use serde_json::{Value as Json, json};
use std::collections::{BTreeMap, BTreeSet};
use std::io::{self, Write as _};
use std::net::IpAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
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
#[path = "serve_ephemeral.rs"]
mod ephemeral;
#[path = "serve_read_scopes.rs"]
mod read_scopes;
#[path = "serve_changes.rs"]
mod changes;
#[path = "serve_sync.rs"]
mod sync;
#[path = "serve_maintenance.rs"]
mod maintenance;
use maintenance::maintain;

#[path = "serve_adoption.rs"]
mod adoption;
use adoption::watch_sources;

#[cfg(test)]
#[path = "serve_tests.rs"]
mod tests;

#[path = "read_cost.rs"]
pub(crate) mod read_cost;

#[path = "serve_lock.rs"]
mod engine_lock;
use engine_lock::{FairMutex, Lockable};

#[path = "latency.rs"]
pub(crate) mod latency;

#[path = "dev_refusals.rs"]
pub(crate) mod dev_refusals;

pub struct Shared {
    refusals: dev_refusals::Recent,
    latency: Arc<latency::Registry>,
    project: std::path::PathBuf,
    temporary: bool,
    ephemeral: Arc<snapback4_core::engine::ephemeral::Hub>,
    ephemeral_rate: ephemeral::Rate,
    wake: Mutex<ephemeral::Wake>,
    polls: Condvar,
    pub clock: Arc<Mutex<crate::dev_clock::Clock>>,
    maintenance: FairMutex<maintenance::State>,
    pub engine: FairMutex<Engine>,
    adoption: Mutex<adoption::Status>,
    readers: Mutex<QueryReaders>,
    read_cuts: Mutex<read_cost::ReadCuts>,
    pub bound: Mutex<Bound>,
    pub generation: Mutex<u64>,
    pub worker_revision: AtomicUsize,
    /// Woken on every commit so long polls return promptly.
    pub committed: Condvar,
    pub seq: Mutex<u64>,
    /// `dev` admits loopback personas; a release refuses them.
    pub personas: bool,
    pub hold_effects: bool,
    pub hold_schedules: bool,
    pub entropy: Mutex<u64>,
    /// Who holds a long poll open right now: what `connected[p]` reads.
    pub presence: Arc<Live>,
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
    pub auth_work: WorkHook,
    #[cfg(test)]
    request_work: WorkHook,
    #[cfg(test)]
    pub upload_work: WorkHook,
    #[cfg(test)]
    pub effect_wait: WorkHook,
    #[cfg(test)]
    pub poll_wait: WorkHook,
    #[cfg(test)]
    pub query_wait: WorkHook,
    #[cfg(test)]
    pub reader_open: WorkHook,
    #[cfg(test)]
    pub changes_refresh: WorkHook,
    #[cfg(test)]
    pub mutation_wait: WorkHook,
}

impl Shared {
    pub fn now(&self) -> i64 { lock(&self.clock).now() }
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
    Dev { trace_empty: bool, verbose: bool, watch: bool, fresh: bool, replay: bool, hold_effects: bool, hold_schedules: bool, clock_offset: i64 },
    Release { expected: u64, worker: Option<std::path::PathBuf>, owner: Arc<crate::store_owner::Owner> },
}

pub fn serve(project: Project, port: u16, mut mode: Mode, bind: &str, inherited: Option<std::net::TcpListener>) -> Result<(), String> {
    crate::host_limits::initialize();
    let mut source_stamp = project.sources_stamp();
    let bound = project.compile().map_err(|e| e.to_string())?;
    if !bound.diagnostics.is_empty() {
        let verbose = !matches!(mode, Mode::Dev { verbose: false, .. });
        let (reports, hidden) = crate::verbs::problem_reports(&bound, true, verbose);
        let shown = reports.len();
        for report in reports { snapback4_core::diagnostic!("{report}"); }
        if hidden > 0 { snapback4_core::diagnostic!("snapback4 dev: {hidden} redundant cascade diagnostic(s) hidden; use --verbose to show them"); }
        return Err(format!("{shown} problem{} in snapback/", if shown == 1 { "" } else { "s" }));
    }
    let dev = matches!(mode, Mode::Dev { .. });
    // @ref LLP 3000.007#20.2 — replay suppresses new effects and holds schedule admission; ordinary holds keep their separate meanings.
    let replay = matches!(mode, Mode::Dev { replay: true, .. });
    let hold_effects = matches!(mode, Mode::Dev { hold_effects: true, .. });
    let hold_schedules = replay || matches!(mode, Mode::Dev { hold_schedules: true, .. });
    let clock = crate::dev_clock::Clock::new(dev, match mode { Mode::Dev { clock_offset, .. } => clock_offset, _ => 0 }).map_err(|e| e.to_string())?;
    let generated = if dev { Some(project.write_generated(&bound).map_err(|e| e.to_string())?) } else { None };
    if dev { project.check_server_at(&mut source_stamp)?; }
    // @ref LLP 3000.007#20.2 — only the owning host may replace replay/schedule policy; deployment shares the same lock.
    // Release startup already owns this lock before selecting its source.
    let mut host_lock = if matches!(mode, Mode::Dev { fresh: false, .. }) {
        Some(crate::store_owner::host(&project.store_path())?)
    } else { None };
    // A busy port is a failed start, not permission to change the stopped host's policy.
    let server = crate::witness_socket::server(bind, port, inherited)?;
    let address = server.server_addr().to_ip().ok_or("HTTP listener has no IP address")?;
    if let Some(file) = &mut host_lock { crate::store_owner::announce(file, address)?; }
    if let Mode::Release { owner, .. } = &mut mode {
        // @ref LLP 3000.019#3.4 — publish through the acquired handle, including a release database symlink.
        crate::store_owner::announce(Arc::get_mut(owner).ok_or("release owner already shared")?, address)?;
    }
    let host_owner = match &mode {
        Mode::Release { owner, .. } => Some(owner.clone()),
        _ => host_lock.take().map(Arc::new),
    };
    // `--fresh` has private, disposable storage and the same WAL readers as dev.
    let fresh = if matches!(mode, Mode::Dev { fresh: true, .. }) { Some(query_readers::FreshDirectory::new()?) } else { None };
    let mut engine = match &mode {
        Mode::Dev { fresh: true, .. } => Engine::new_at(fresh.as_ref().unwrap().store().map_err(|e| e.to_string())?, bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone()), clock.now()),
        Mode::Dev { .. } => adoption::open(host_owner.as_deref().unwrap(), &bound, &clock),
        Mode::Release { expected, .. } => host_owner.as_ref().unwrap().open_store(Duration::from_secs(5)).and_then(|store| project.open_release_engine(store, &bound, *expected, clock.now())),
    }.map_err(|e| e.to_string())?;
    adoption::report(&engine);
    crate::dev_worker::clear_child_session(engine.store()).map_err(|e| e.to_string())?;
    // A native job's module (LLP 3000.005): built by `check`, in `dev` also
    // here so a fresh clone serves without a separate step.
    if dev {
        crate::native::build(&project, &bound).map_err(|p| p.to_string())?;
    }
    if dev {
        crate::dev_replay::effects(&engine, replay).map_err(|e| e.to_string())?;
        crate::dev_replay::schedules(&mut engine, hold_schedules, clock.now()).map_err(|e| e.to_string())?;
    }
    if !hold_schedules { engine.fire_schedules(clock.now()).map_err(|e| e.to_string())?; }
    let installed = crate::native::install(&mut engine, &project).map_err(|p| p.to_string())?;
    let clock = Arc::new(Mutex::new(clock));
    let presence = Arc::new(Live::new(clock.clone()));
    engine.set_presence(Some(presence.clone()));
    let seq = engine.seq().map_err(|e| e.to_string())?;
    let generation: u64 = engine.generation();
    let adoption = Mutex::new(adoption::Status::new(engine.store().meta("store_id").map_err(|e| e.to_string())?.unwrap_or_default()));
    let readers = Mutex::new(QueryReaders::new(&engine, &bound.refusal_sites));
    let shared = Arc::new(Shared {
        project: project.root.canonicalize().map_err(|e| e.to_string())?,
        temporary: matches!(mode, Mode::Dev { fresh: true, .. }),
        refusals: if dev { dev_refusals::Recent::start(&project.root, &engine.store().meta("store_id").map_err(|e| e.to_string())?.unwrap_or_default(), address, matches!(mode, Mode::Dev { trace_empty: true, .. }))? } else { Default::default() },
        latency: Arc::new(latency::Registry::new(&bound)),
            ephemeral: ephemeral::hub(&engine), ephemeral_rate: ephemeral::Rate::default(),
            wake: Mutex::new(ephemeral::Wake::new(&engine)), polls: Condvar::new(),
        adoption, clock, maintenance: FairMutex::gate(maintenance::State::default()), engine: FairMutex::new(engine), readers, read_cuts: Mutex::new(read_cost::ReadCuts::default()), bound: Mutex::new(bound), generation: Mutex::new(generation), worker_revision: AtomicUsize::new(0), committed: Condvar::new(), seq: Mutex::new(seq), personas: dev, hold_effects, hold_schedules, entropy: Mutex::new(snapback4_core::ids::seed()), presence, asset_transfers: AssetTransfers::default(), native: Mutex::new(installed), auth: crate::auth::Admission::default(), uploads: AtomicUsize::new(0),
        route_verification: routes::Verification::default(), owner: host_owner.clone(),
        #[cfg(test)] auth_work: Mutex::new(None),
        #[cfg(test)] request_work: Mutex::new(None),
        #[cfg(test)] upload_work: Mutex::new(None),
        #[cfg(test)] effect_wait: Mutex::new(None),
        #[cfg(test)] poll_wait: Mutex::new(None),
        #[cfg(test)] query_wait: Mutex::new(None),
        #[cfg(test)] reader_open: Mutex::new(None),
        #[cfg(test)] changes_refresh: Mutex::new(None),
        #[cfg(test)] mutation_wait: Mutex::new(None),
    });
    shared.install_ephemeral_wake();
    if dev { crate::lifecycle::managed_cleanup(); }
    let server = Arc::new(server);
    let address = server.server_addr();
    let worker_url = format!("http://{address}").replace("0.0.0.0", "127.0.0.1").replace("[::]", "[::1]");
    let worker = match &mode {
        Mode::Dev { .. } => crate::dev_worker::DevWorker::start(&project, shared.clone(), worker_url.clone())?,
        Mode::Release { worker: Some(source), .. } => Some(crate::dev_worker::DevWorker::start_source(&project, shared.clone(), worker_url.clone(), source.clone(), true)?),
        _ => None,
    };
    crate::lifecycle::generation(generation);
    // The URL is stdout's first line; lifecycle and redacted worker logs use stderr.
    snapback4_core::diagnostic_stdout!("http://{address}");
    match &generated {
        Some(generated) => snapback4_core::diagnostic!("snapback4 dev: http://{address}  (schema: snapback/, types: {})", generated.display()),
        None => snapback4_core::diagnostic!("snapback4 serve: http://{address}  (release {}, generation {generation}, tokens only)", project.root.display()),
    }
    if dev {
        match mode {
            Mode::Dev { fresh: true, .. } => snapback4_core::diagnostic!("store: temporary — discarded on exit"),
            _ => snapback4_core::diagnostic!("store: {}", project.store_path().display()),
        }
    }
    if dev { snapback4_core::diagnostic!("snapback4 dev: development only — admits loopback personas and an unauthenticated /seed; deploy with snapback4 deploy + snapback4 serve, which refuse both."); }
    if replay { snapback4_core::diagnostic!("snapback4 dev: replay on — new effects suppressed; schedules held"); }
    let mut background = Vec::new();
    if let Mode::Dev { watch: true, verbose, .. } = mode {
        let shared = shared.clone();
        let project = Project { root: project.root.clone() };
        background.push(("watcher", crate::lifecycle::background("watcher", move || watch_sources(project, shared, source_stamp, verbose))?));
    }
    {
        let shared = shared.clone();
        background.push(("maintenance", crate::lifecycle::background("maintenance", move || maintain(shared))?));
    }
    {
        let shared = shared.clone();
        background.push(("bulk-maintenance", crate::lifecycle::background("bulk-maintenance", move || maintenance::bulk(shared))?));
    }
    if dev { snapback4_core::diagnostic!("snapback4 dev: loopback identity attempts have no per-peer or per-email minute limits; Argon2 slots: {} on this host; connection/worker caps still apply", shared.auth.kdf_slots(true)); }
    let worker = crate::dev_worker::Supervisor::start(project, shared.clone(), worker_url, dev, worker)?;
    serve_requests(server, shared, worker, background, crate::lifecycle::stopping)
}

// The production accept loop is also exercised with a real supervised child
// and a held SQLite adoption transaction in the server regression.
fn serve_requests(
    server: Arc<Server>, shared: Arc<Shared>, worker: crate::dev_worker::Supervisor,
    background: Vec<(&str, std::thread::JoinHandle<()>)>, stopping: impl Fn() -> bool,
) -> Result<(), String> {
    // @ref LLP 3000#7-decisions-during-execution — bound HTTP admission while reserving short requests
    crate::thread_priority::dispatcher();
    let admission = Arc::new(RequestAdmission::default());
    let mut reported = tiny_http::AdmissionRefusals::default();
    let mut reported_workers = ([0; 7], [0; 7]);
    let mut report_at = Instant::now();
    loop {
        if report_at.elapsed() >= Duration::from_secs(1) {
            let refusals = server.admission_refusals();
            if refusals != reported && snapback4_core::diagnostics::emit(format_args!(
                "E_RATE_LIMIT at http: all {} HTTP connections occupied at admission; cumulative refused={} http_written={} http_failed={} tls_closed={}; since_summary={}; wait for pending writes to settle or reduce concurrent clients; wire delivery is best-effort",
                tiny_http::ConnectionLimits::default().max_connections, refusals.total(), refusals.http_written, refusals.http_failed, refusals.tls_closed, refusals.total().saturating_sub(reported.total())), false) {
                reported = refusals;
            }
            let workers = (admission.refused.each_ref().map(|n| n.load(Ordering::Relaxed)), admission.undelivered.each_ref().map(|n| n.load(Ordering::Relaxed)));
            if workers != reported_workers && snapback4_core::diagnostics::emit(format_args!(
                "E_RATE_LIMIT at workers: cumulative refused={:?} undelivered={:?}; pools=[short,mutation,sync,wait,route,registry,verifier]; reduce concurrent clients; wire delivery is best-effort", workers.0, workers.1), false) {
                reported_workers = workers;
            }
            report_at = Instant::now();
        }
        if stopping() { shared.refusals.shutdown(); return Ok(()); }
        for (name, thread) in &background {
            if thread.is_finished() { return Err(format!("{name} thread stopped")); }
        }
        if worker.is_finished() { return Err("worker thread stopped".into()); }
        if let Some(request) = server.recv_timeout(Duration::from_millis(100)).map_err(crate::host_limits::listener_error)? {
            dispatch(request, shared.clone(), admission.clone(), server.server_addr().to_ip().is_some_and(|a| a.ip().is_loopback()));
        }
    }
}

const REQUEST_WORKERS: usize = 32;
// Writer-dependent requests have their own budget: queued behind adoption, they cannot take
// the slots reads and discovery need, and neither class loses capacity.
const MUTATION_WORKERS: usize = 32;
// @ref LLP 3000.026#4-atomic-launch-adoption — sync may wait for atomic launch;
// reserve its capacity separately even if launch begins after dispatch.
const SYNC_WORKERS: usize = 32;
const WAIT_WORKERS: usize = 32;
const ROUTE_WORKERS: usize = 16;
const REGISTRY_WORKERS: usize = 4;
const VERIFIER_WORKERS: usize = 4;

#[derive(Default)]
struct RequestAdmission { workers: [request_workers::Workers; 7], short: AtomicUsize, mutations: AtomicUsize, syncs: AtomicUsize, waiters: AtomicUsize, routes: AtomicUsize, registries: AtomicUsize, verifiers: AtomicUsize, refused: [AtomicUsize; 7], undelivered: [AtomicUsize; 7] }

#[derive(Clone, Copy)]
enum RequestClass { Short, Mutation, Sync, Wait, Route, Registry, Verifier }
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
    fn refuse(&self, request: Request, class: RequestClass) {
        let result = request.refuse_overload();
        let increment = |counter: &AtomicUsize| { let _ = counter.fetch_update(Ordering::Relaxed, Ordering::Relaxed, |n| Some(n.saturating_add(1))); };
        increment(&self.refused[class as usize]);
        if result.http_written == 0 { increment(&self.undelivered[class as usize]); }
    }
    fn counter(&self, class: RequestClass) -> &AtomicUsize {
        match class { RequestClass::Short => &self.short, RequestClass::Mutation => &self.mutations, RequestClass::Sync => &self.syncs, RequestClass::Wait => &self.waiters, RequestClass::Route => &self.routes, RequestClass::Registry => &self.registries, RequestClass::Verifier => &self.verifiers }
    }
    fn limit(class: RequestClass) -> usize {
        match class { RequestClass::Short => REQUEST_WORKERS, RequestClass::Mutation => MUTATION_WORKERS, RequestClass::Sync => SYNC_WORKERS, RequestClass::Wait => WAIT_WORKERS, RequestClass::Route => ROUTE_WORKERS, RequestClass::Registry => REGISTRY_WORKERS, RequestClass::Verifier => VERIFIER_WORKERS }
    }
    fn acquire(self: &Arc<Self>, class: RequestClass) -> Option<RequestPermit> {
        let limit = Self::limit(class);
        self.counter(class).fetch_update(Ordering::AcqRel, Ordering::Acquire, |n| (n < limit).then_some(n + 1)).ok()?;
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
        else if is_waiter(request.method(), path) { RequestClass::Wait }
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
    let pending = PendingRequest { request: Some(request), admission: admission.clone(), class };
    if let Err(error) = admission.workers[class as usize].submit(RequestAdmission::limit(class), builder, Box::new(move || { let _permit = permit;
        let request = pending.take();
        let run = || { if let Some(sample) = sample { sample.run(|| handle(request, &shared)); } else { handle(request, &shared); } };
        if let Some(trace) = trace { trace.run(run); } else { run(); } })) {
        snapback4_core::diagnostic!("snapback4: cannot start request thread: {error}");
    }
}

fn detached_request(method: &Method, path: &str) -> bool {
    method == &Method::Post && (path.starts_with("/q/") || path == "/sync")
        || method == &Method::Get && matches!(path, "/" | "/probe" | "/schema" | "/api.ts" | "/native.wasm" | "/dev/status" | "/auth/config")
        || method == &Method::Options
}

fn is_waiter(method: &Method, path: &str) -> bool {
    (method == &Method::Get && path == "/changes")
        || (method == &Method::Post && (path == "/effects/claim" || path == "/actions/claim" || path.starts_with("/a/")))
}

/// A worker's seat: a bearer session of a service principal.
fn service_of(request: &Request, shared: &Shared) -> Result<String, Refusal> {
    service_of_locked(request, shared, &lock(&shared.engine))
}

fn service_of_locked(request: &Request, shared: &Shared, engine: &Engine) -> Result<String, Refusal> {
    dev_request(request, shared)?;
    let refused = || Refusal::new("E_AUTH", "auth", "this is a worker's door: send a live service token (`snapback4 token --service <name>`)").guide("effects");
    if !matches!(single_header(request, "x-snapback-persona"), Ok(None)) { return Err(refused()); }
    let token = crate::auth::bearer_token(request).map_err(|e| e.refusal())?;
    snapback4_core::identity::current_service(engine.store(), &token, snapback4_core::identity::ServiceSample {
        now: shared.now(), supervisor_revision: shared.worker_revision.load(Ordering::Acquire),
    }).map_err(|e| e.refusal())?.ok_or_else(refused)
}

fn single_header<'a>(request: &'a Request, name: &str) -> Result<Option<&'a str>, ()> {
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
    let parsed = serde_json::from_value::<BoundSessionWire>(payload.clone()).map_err(|_| (400,
        Refusal::new("E_INPUT", "input", "a bound session requires exactly { principal, kind?: string, days?: integer, binding: { invocationId, intent: \"identity-session/v1\", replaceLostDelivery?: boolean } }")))?;
    if parsed.binding.intent != snapback4_core::identity::BOUND_SESSION_INTENT
        || parsed.binding.invocation_id.is_empty() || parsed.binding.invocation_id.len() > 128
        || !snapback4_core::value::identity_fits(&parsed.binding.invocation_id)
    {
        return Err((400, Refusal::new("E_INPUT", "input", "binding requires { invocationId, intent: \"identity-session/v1\", replaceLostDelivery?: boolean }")));
    }
    snapback4_core::identity::validate_custom_session(&parsed.principal, &parsed.kind)
        .map_err(|error| (200, error.refusal()))?;
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
fn dev_request(request: &Request, shared: &Shared) -> Result<(), Refusal> {
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

pub(crate) fn cors(request: &Request) -> Vec<Header> {
    let mut headers = vec![
        Header::from_bytes("Vary", "Origin").unwrap(),
        Header::from_bytes("Access-Control-Expose-Headers", "X-Snapback-Time, X-Snapback-Clock").unwrap(),
        Header::from_bytes("Access-Control-Allow-Headers", "content-type, x-snapback-persona, x-snapback-meter, authorization, range").unwrap(),
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
const JSON_RESPONSE_CEILING: usize = 16 << 20;

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
pub(crate) fn clock_headers(shared: &Shared) -> [Header; 2] {
    let clock = lock(&shared.clock);
    [Header::from_bytes("X-Snapback-Time", clock.now().to_string()).unwrap(),
     Header::from_bytes("X-Snapback-Clock", clock.revision()).unwrap()]
}

// @ref LLP 3000.017#3.3 — advertise only on ephemeral backends; durable-only HTTP bytes stay unchanged.
// The online tier can discover /schema facts through its ordinary traffic.
pub(crate) fn ephemeral_headers(shared: &Shared) -> Vec<Header> {
    if lock(&shared.wake).eph.tables.is_empty() { return Vec::new(); }
    vec![Header::from_bytes("X-Snapback-Ephemeral", "1").unwrap(),
         Header::from_bytes("Access-Control-Expose-Headers", "X-Snapback-Ephemeral").unwrap()]
}

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
    let refused = status >= 400 || body.refused();
    trace::mark("encode_start");
    let mut bytes = JsonBuffer(Vec::new());
    let encoded = serde_json::to_writer(&mut bytes, &body);
    drop(body);
    let status = if encoded.is_err() {
        bytes.0.clear();
        let refusal = Refusal::new("E_BOUND", "bound", "the HTTP JSON response exceeds 16 MiB; request a smaller page or return fewer values").guide("reads");
        // @ref LLP 3000.007.001#3.11 — generation discovery survives an undeliverable row page.
        let mut reply = sync_overflow.unwrap_or_else(|| json!({}));
        reply["denied"] = refusal_json(&refusal);
        serde_json::to_writer(&mut bytes, &reply).expect("the fixed HTTP refusal and sync identity fit the response ceiling");
        200
    } else { status };
    let refused = refused || encoded.is_err();
    trace::mark("encode_end");
    let _evidence = dev_refusals::response::response(&bytes.0);
    let capacity = bytes.0.len() + 512;
    let mut response = Response::from_data(bytes.0).with_status_code(status);
    if let Some(shared) = shared {
        for header in clock_headers(shared).into_iter().chain(ephemeral_headers(shared)) { response.add_header(header); }
    }
    response.add_header(Header::from_bytes("Content-Type", "application/json").unwrap());
    response.add_header(Header::from_bytes("Cache-Control", "no-store").unwrap());
    if allow_origin {
        for header in cors(&request) { response.add_header(header); }
    }
    if let Some(header) = latency::header() { response.add_header(header); }
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
    for header in cors(&request).into_iter().chain(latency::header()).filter(|header| !header.field.equiv("Content-Type")) {
        response.add_header(header);
    }
    let _ = request.respond(response);
}

pub(crate) fn refusal_json(refusal: &Refusal) -> Json {
    serde_json::to_value(refusal).unwrap_or(Json::Null)
}

/// Who is asking: a bearer session, or (in `dev`, from loopback) a persona.
pub(crate) fn principal_of(request: &Request, shared: &Shared) -> Result<String, Refusal> {
    principal_with_owner(request, shared, None)
}

fn principal_with_owner(request: &Request, shared: &Shared, owner: Option<&Engine>) -> Result<String, Refusal> {
    dev_request(request, shared)?;
    let mut persona = None;
    let mut bearer = None;
    for header in request.headers() {
        let name = header.field.as_str().as_str().to_ascii_lowercase();
        let value = header.value.as_str().trim();
        if name == "x-snapback-persona" {
            if persona.is_some()
                || value.is_empty()
                || !value.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
            {
                return Err(Refusal::new("E_AUTH", "auth", "send exactly one valid x-snapback-persona header").guide("personas"));
            }
            persona = Some(value.to_owned());
        }
        if name == "authorization" {
            let Some(token) = value.strip_prefix("Bearer ").map(str::trim).filter(|token| !token.is_empty()) else {
                return Err(Refusal::new("E_AUTH", "auth", "send Authorization: Bearer <token>").guide("personas"));
            };
            if bearer.replace(token.to_owned()).is_some() {
                return Err(Refusal::new("E_AUTH", "auth", "send exactly one Authorization header").guide("personas"));
            }
        }
    }
    if persona.is_some() && bearer.is_some() {
        return Err(Refusal::new("E_AUTH", "auth", "send one credential: a development persona or a bearer token").guide("personas"));
    }
    if let Some(persona) = persona {
        if shared.personas {
            return Ok(persona_principal(&persona));
        }
        return Err(Refusal::new("E_AUTH", "auth", "personas are a development door; a deployed server takes bearer tokens (snapback4/auth)").guide("personas"));
    }
    if let Some(token) = bearer {
        // Reads may authenticate against the committed generation during adoption.
        // Keep write authentication behind the writer: time queued for adoption
        // must not preserve a session that expired or was revoked in that wait.
        let path = request.url().split('?').next().unwrap_or("");
        let read = detached_request(request.method(), path);
        let resolved = if let Some(engine) = owner {
            snapback4_core::identity::resolve_supervised(engine.store(), &token, snapback4_core::identity::ServiceSample { now: shared.now(), supervisor_revision: shared.worker_revision.load(Ordering::Acquire) })
        } else if read { match shared.reader() {
            Ok((epoch, reader)) => {
                let identity = lock(&shared.wake).store_id.clone();
                let result = snapback4_core::identity::resolve_read_only_supervised(reader.store(), &token, snapback4_core::identity::ServiceSample { now: shared.now(), supervisor_revision: shared.worker_revision.load(Ordering::Acquire) }, identity.as_deref());
                lock(&shared.readers).put(&epoch, reader.into_inner());
                result
            }
            Err(_) if shared.memory_store() => snapback4_core::identity::resolve_supervised(lock(&shared.engine).store(), &token, snapback4_core::identity::ServiceSample { now: shared.now(), supervisor_revision: shared.worker_revision.load(Ordering::Acquire) }),
            Err(error) => return Err(error.refusal()),
        } } else { snapback4_core::identity::resolve_supervised(lock(&shared.engine).store(), &token, snapback4_core::identity::ServiceSample { now: shared.now(), supervisor_revision: shared.worker_revision.load(Ordering::Acquire) }) };
        return match resolved {
            Ok(Some((principal, _))) => Ok(principal),
            Ok(None) => Err(Refusal::new("E_AUTH", "auth", "this session is not live; sign in again").guide("personas")),
            Err(error) => Err(error.refusal()),
        };
    }
    Err(Refusal::new("E_AUTH", "auth", "sign in: send a bearer token (snapback4/auth), or x-snapback-persona in development").guide("personas"))
}

// @ref LLP 3000.019#3.6 — adoption's writer queue cannot retain expired bearer authority.
fn mutation_authority(request: &Request, shared: &Shared, engine: &Engine, principal: &str) -> Result<(), Refusal> {
    if principal_with_owner(request, shared, Some(engine))? == principal { Ok(()) }
    else { Err(Refusal::new("E_AUTH", "auth", "the request's session changed; sign in again").guide("personas")) }
}

fn query_params(url: &str) -> BTreeMap<String, String> {
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
fn response_head(engine: &mut Engine) -> Result<(String, u64), Refusal> {
    let tx = engine.store_mut().read_transaction()?;
    let id: String = tx.conn().query_row("SELECT value FROM _meta WHERE key = 'store_id'", [], |row| row.get(0)).map_err(snapback4_core::RuntimeError::from)?;
    Ok((id, tx.next_seq()? - 1))
}

// @ref LLP 3000.013#6 — a replay belongs to its acknowledged store, even if
// the endpoint changes between the client's probe and this transaction.
fn intent_store(engine: &Engine, payload: &Json) -> Result<(), Refusal> {
    let Some(expected) = payload.get("store_id").filter(|id| !id.is_null()) else { return Ok(()); };
    let current = engine.store().meta("store_id")?;
    if expected.as_str().is_some_and(|id| Some(id) == current.as_deref()) { return Ok(()); }
    Err(Refusal::new("E_STORE_REPLACED", "store", "the intent belongs to another store; its original outcome is unknown")
        .site("request.store_id").rewrite("reconcile this write with its original store before submitting new intent").guide("sync"))
}

fn operation_refusal(request: Request, shared: &Shared, status: u16, why: Refusal) {
    let metadata = shared.read_identity();
    match metadata {
        Ok((store_id, head, generation)) => respond_timed(request, shared, status, json!({ "denied": refusal_json(&why), "store_id": store_id, "head": head, "generation": generation })),
        Err(why) => respond_timed(request, shared, 503, json!({ "denied": refusal_json(&why) })),
    }
}

// @ref LLP 3000.009#5.1 — a racing id conflict is a terminal input refusal, not a transport failure.
fn mutation_error_status(refusal: &Refusal) -> u16 {
    if refusal.retryable { 503 } else if matches!(refusal.code.as_str(), "E_ID_REUSED" | "E_DELIVERY_BINDING") { 200 } else { 500 }
}

fn handle(mut request: Request, shared: &Shared) {
    request.set_cleanup_guard(latency::FinishOnDrop);
    #[cfg(test)] test_work(&shared.request_work);
    let method = request.method().clone();
    let url = request.url().to_owned();
    let path = url.split('?').next().unwrap_or("").to_owned();
    let _evidence = dev_refusals::response::begin(shared, &path);
    if path == token::ENDPOINT { return token::handle(request, shared); }
    // This exact declared POST path is the only non-loopback development
    // exception. Core doors, mismatched methods and query variants stay fenced.
    if method == Method::Post && let Some((name, route)) = routes::declared(shared, &url) {
        return routes::ingress(request, shared, &name, route);
    }
    let ephemeral_request = method == Method::Post && path.strip_prefix("/m/").is_some_and(|op| lock(&shared.bound).schema.operations.get(op).is_some_and(|f| f.ephemeral));
    let reject = |request, status, refusal: Refusal| {
        if ephemeral_request { ephemeral::failed(request,shared,None,refusal); }
        else if path.starts_with("/q/") { operation_refusal(request, shared, status, refusal); }
        else { respond_timed(request,shared,status,json!({"denied":refusal_json(&refusal)})); }
    };
    if let Err(refusal) = dev_request(&request, shared) {
        if ephemeral_request { return ephemeral::failed(request, shared, None, refusal); }
        respond_with_sync(request, 403, json!({ "denied": refusal_json(&refusal) }), false, None, Some(shared));
        return;
    }
    if path.starts_with("/dev/clock") && !shared.personas {
        return respond_timed(request, shared, 403, json!({ "denied": refusal_json(&crate::dev_clock::release()) }));
    }
    if (method == Method::Get && path == "/dev/latency") || (method == Method::Post && path == "/dev/latency/reset") {
        return latency::endpoint(request, shared, method == Method::Post);
    }
    if method == Method::Get && path == "/dev/status" {
        if !shared.personas { return respond_timed(request, shared, 403, json!({"denied":refusal_json(&Refusal::new("E_AUTH", "auth", "status inspection requires dev"))})); }
        // No engine lock: doctor must remain usable while an adoption waits on SQLite.
        let generation = *lock(&shared.generation);
        let personas = lock(&shared.bound).personas.clone();
        let status = lock(&shared.adoption);
        return respond_timed(request, shared, 200, json!({"storeId":status.store_id, "project":shared.project, "temporary":shared.temporary, "generation":generation, "adoption":status.failure, "now":shared.now(), "personas":personas, "scheduling":crate::thread_priority::diagnostics(), "fileDescriptors":crate::host_limits::diagnostics()}));
    }
    if method == Method::Options {
        respond_empty(request, 204);
        return;
    }
    if method == Method::Post && path == "/seed" && !shared.personas {
        return respond_timed(request, shared, 403, json!({ "denied": refusal_json(&Refusal::new("E_AUTH", "auth", "seeding is a development door")) }));
    }
    // Check identity before upload admission or allocating any large body.
    // The route rechecks after reading, so expiry/revocation during a slow
    // upload cannot retain the authority held at its start.
    // Logout's body is only 4 KiB and its sole authentication happens inside
    // the SQLite writer transaction that closes the live session family.
    if method == Method::Post && (path == "/assets" || path == "/sync" || path.starts_with("/q/") || path.starts_with("/m/") || path.starts_with("/a/")
        || (path.starts_with("/actions/") && path.ends_with("/cancel"))
        || matches!(path.as_str(), "/auth/refresh" | "/auth/logout-all")) {
        if let Err(refusal) = principal_of(&request, shared) {
            // No authenticated viewer: metadata cannot disclose a store head.
            if path.starts_with("/q/") { return respond_timed(request, shared, if refusal.retryable { 503 } else { 401 }, json!({"denied":refusal_json(&refusal)})); }
            return reject(request, if refusal.retryable { 503 } else { 401 }, refusal);
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
    if method == Method::Post {
        let ceiling = match path.as_str() {
            "/assets" => crate::assets::UPLOAD_CEILING,
            "/seed" => SEED_REQUEST_CEILING,
            "/sync" => SYNC_REQUEST_CEILING,
            path if path.starts_with("/auth/") => crate::auth::BODY_CEILING,
            _ => JSON_REQUEST_CEILING,
        };
        let length = request.body_length();
        let too_large = || Refusal::new("E_INPUT", "input", format!("the request body exceeds its {ceiling}-byte limit; split it into smaller requests"));
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
    if method == Method::Get && let Some(id) = path.strip_prefix("/assets/") {
        return crate::assets::serve(request, id, shared);
    }
    let body = match String::from_utf8(bytes) {
        Ok(body) => body,
        Err(_) => return reject(request, 400, Refusal::new("E_INPUT", "input", "a JSON request body must be valid UTF-8")),
    };
    match (method, path.as_str()) {
        (Method::Post, "/dev/clock/advance") => maintenance::advance(request, shared, &body),
        (Method::Post, path) if path.starts_with("/a/") => actions::call(request, shared, path.trim_start_matches("/a/"), &body),
        (Method::Post, "/actions/claim") => actions::claim(request, shared, &body),
        (Method::Post, "/actions/claim-set") => actions::claim_set(request, shared, &body),
        (Method::Post, "/routes/verify/claim") => routes::claim(request, shared, &body),
        (Method::Post, path) if path.starts_with("/routes/verify/") => routes::settle(request, shared, path, &body),
        (Method::Post, path) if path.starts_with("/actions/") => actions::settle(request, shared, path, &body),
        (Method::Post, "/effects/claim") => effects::claim(request, shared, &body),
        (Method::Post, path) if path.starts_with("/effects/") => effects::post(request, shared, path, &body),
        (Method::Get, "/effects") => effects::list(request, shared, &url),
        (Method::Get, "/probe") => match principal_of(&request, shared) {
            Ok(viewer) => {
                let identity = shared.read_head();
                match identity {
                    Ok((store_id, seq)) => respond_timed(request, shared, 200, json!({ "ok": true, "store_id": store_id, "seq": seq, "viewer": viewer })),
                    Err(error) => respond_timed(request, shared, 500, json!({ "denied": refusal_json(&error) })),
                }
            },
            Err(refusal) => respond_timed(request, shared, if refusal.retryable { 503 } else { 401 }, json!({ "denied": refusal_json(&refusal) })),
        },
        (Method::Get, "/auth/config") => {
            let auth = lock(&shared.bound).schema.auth.clone();
            respond_timed(request, shared, 200, json!({ "guests": auth.guests, "password": auth.password }));
        }
        (Method::Get, "/") => {
            let seq = match shared.read_head() {
                Ok((_, seq)) => seq,
                Err(error) => return respond_timed(request, shared, 500, json!({ "denied": refusal_json(&error) })),
            };
            let body = {
                let bound = lock(&shared.bound);
                let ops: Vec<Json> = bound.programs.iter().map(|p| json!({ "name": p.program.name, "kind": p.program.kind.word() })).collect();
                let tables: Vec<Json> = bound.schema.visible_tables().map(|(name, table)| json!({ "name": name, "sync": table.sync.as_ref().map(|s| s.line()) })).collect();
                json!({ "snapback4": env!("CARGO_PKG_VERSION"), "generation": *lock(&shared.generation), "seq": seq, "ops": ops, "tables": tables })
            };
            respond_timed(request, shared, 200, body);
        }
        (Method::Get, "/schema") => {
            // The compiled backend a device runs locally: the schema and the
            // programs' IR, bound to a generation.
            let (schema, programs, generation, native) = {
                let bound = lock(&shared.bound);
                (bound.schema.public_projection(), snapback4_lang::emit::backend_programs(&bound), *lock(&shared.generation), lock(&shared.native).as_ref().map(|n| (n.digest.clone(), n.jobs.clone(), n.reads.clone())))
            };
            let native = native.map(|(digest, jobs, reads)| json!({ "digest": digest, "jobs": jobs, "reads": reads }));
            // @ref LLP 3000.007#20.4 — a cold click binds to the backend
            // that supplied its program, even before replica identification.
            let store_id = lock(&shared.wake).store_id.clone();
            respond_timed(request, shared, 200, json!({ "generation": generation, "schema": schema, "programs": programs, "native": native, "store_id": store_id }));
        }
        (Method::Get, "/native.wasm") => {
            // The app's module, for a device to run its native reads over
            // the rows it holds (LLP 3000.005 §9).
            let installed = lock(&shared.native).clone();
            match installed {
                Some(module) => {
                    let mut response = Response::from_data(module.bytes);
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
            let text = snapback4_lang::emit::typescript(&lock(&shared.bound));
            let mut response = Response::from_string(text);
            response.add_header(Header::from_bytes("Content-Type", "text/plain; charset=utf-8").unwrap());
            response.add_header(Header::from_bytes("Cache-Control", "no-store").unwrap());
            for header in cors(&request).into_iter().chain(latency::header()) { response.add_header(header); }
            let _ = request.respond(response);
        }
        (Method::Post, path) if path.starts_with("/q/") || path.starts_with("/m/") => {
            let op = path[3..].to_owned();
            if path.starts_with("/m/") && lock(&shared.bound).schema.operations.get(&op).is_some_and(|f| f.ephemeral) {
                return ephemeral::serve(request, shared, &op, &body);
            }
            let principal = match principal_of(&request, shared) {
                Ok(principal) => principal,
                Err(refusal) => {
                    respond_timed(request, shared, if refusal.retryable { 503 } else { 401 }, json!({ "denied": refusal_json(&refusal) }));
                    return;
                }
            };
            let payload: Json = match serde_json::from_str(if body.is_empty() { "{}" } else { &body }) {
                Ok(json) => json,
                Err(error) => {
                    operation_refusal(request, shared, 400, Refusal::new("E_INPUT", "input", format!("the request body is not JSON: {error}")));
                    return;
                }
            };
            let delivery_fingerprint = if path.starts_with("/m/") {
                match ephemeral::delivery_fingerprint(&payload) {
                    Ok(value) => value,
                    Err(why) => return operation_refusal(request, shared, 200, why),
                }
            } else { None };
            let args_json = payload.get("args").cloned().unwrap_or(json!({}));
            let signature = if path.starts_with("/m/") {
                let id = payload.get("id").and_then(Json::as_str);
                #[cfg(test)] test_work(&shared.mutation_wait);
                let (replay, metadata, signature) = {
                    let mut engine = lock(&shared.engine);
                    if let Err(refusal) = mutation_authority(&request, shared, &engine, &principal) {
                        drop(engine);
                        return respond_timed(request, shared, 401, json!({"denied":refusal_json(&refusal)}));
                    }
                    let replay = intent_store(&engine, &payload).and_then(|()| {
                        let replay = id.map(|id| engine.replay_mutation(&principal, id, &op, &args_json)).transpose().map_err(|e| e.refusal())?.flatten();
                        if replay.is_none() { engine.schema().check_delivery(&op, delivery_fingerprint.as_deref()).map_err(|e| e.refusal())?; }
                        Ok(replay)
                    });
                    if matches!(replay, Ok(None)) && engine.schema().operations.get(&op).is_some_and(|f| f.ephemeral) {
                        drop(engine);
                        return ephemeral::serve(request, shared, &op, &body);
                    }
                    // @ref LLP 3000.022#5 — decoding uses the signature whose binding
                    // passed preflight; adoption is rechecked by the executing writer.
                    let signature = engine.program(&op).map(|p| (p.kind, p.args.clone()));
                    (replay, response_head(&mut engine), signature)
                };
                let (store_id, head) = match metadata { Ok(head) => head, Err(why) => { respond_timed(request, shared, 503, json!({ "denied": why })); return; } };
                match replay {
                    Ok(Some(outcome)) => { let mut reply = outcome.reply(id); reply["store_id"] = json!(store_id); reply["head"] = json!(head); respond_timed(request, shared, 200, reply); return; }
                    Err(why) => { respond_timed(request, shared, if why.retryable { 503 } else { 200 }, json!({ "state": "failed", "id": id, "why": why, "store_id": store_id, "head": head })); return; }
                    Ok(None) => {}
                }
                #[cfg(test)] test_work(&shared.mutation_wait);
                signature
            } else {
                lock(&shared.bound).programs.iter().find(|p| p.program.name == op)
                    .map(|p| (p.program.kind, p.program.args.clone()))
            };
            // @ref LLP 3000.018#3.1 — refresh follows what a query may read on any path, never what one run read,
            // and comes from the schema of the engine that evaluates it.
            let presence_of = |engine: &Engine| engine.schema().operations.get(&op).is_some_and(|fact| fact.sites.iter().any(|site| site.kind == "presence"));
            let Some((kind, arg_types)) = signature else {
                if path.starts_with("/q/") && lock(&shared.readers).pending(&op) {
                    match shared.read_head() {
                        Ok((store_id, head)) => respond_timed(request, shared, 200, json!({"loading":true,"complete":false,"data":null,"store_id":store_id,"seq":head,"tables":[],"viewer":principal})),
                        Err(why) => respond_timed(request, shared, 503, json!({"denied":why})),
                    }
                    return;
                }
                operation_refusal(request, shared, 404, Refusal::new("E_OP", "op", format!("unknown operation {op}")).guide("programs"));
                return;
            };
            let mut args = BTreeMap::new();
            if let Json::Object(fields) = &args_json {
                for (name, value) in fields {
                    match arg_types.get(name) {
                        Some(kind) => match wire::from_json(kind, value) {
                            Ok(typed) => {
                                args.insert(name.clone(), typed);
                            }
                            Err(why) => {
                                operation_refusal(request, shared, 400, Refusal::new("E_INPUT", "input", format!("argument {name}: {why}")).guide("types"));
                                return;
                            }
                        },
                        None => {
                            operation_refusal(request, shared, 400, Refusal::new("E_INPUT", "input", format!("{op} takes no argument {name}")).guide("programs"));
                            return;
                        }
                    }
                }
            }
            let viewer = principal.clone();
            let mut context = Context::new(&principal, args).at(shared.now());
            if path.starts_with("/q/") {
                let provenance = payload.get("provenance").and_then(Json::as_bool) == Some(true);
                if provenance { context = context.with_row_provenance(); }
                if kind != ProgramKind::Query {
                    operation_refusal(request, shared, 400, Refusal::new("E_OP", "op", format!("{op} is a mutation; POST /m/{op}")));
                    return;
                }
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
                let reader = shared.reader();
                let (outcome, cut, metadata, reads_presence, query_generation, search_current, scopes, decoration_paths) = match reader {
                    Ok((epoch, mut reader)) => {
                        // Take identity from the same reader that evaluates the query,
                        // never from an engine that may have replaced it meanwhile.
                        let metadata = response_head(&mut reader);
                        #[cfg(test)]
                        test_work(&shared.query_wait);
                        let reads_presence = presence_of(&reader);
                        let context = dev_refusals::response::context(context, reader.refusal_sites.clone(), reader.generation());
                        let query_generation = reader.generation();
                        let decoration_paths = reader.program(&op).filter(|_| reader.schema().operations.get(&op).is_some_and(|f| f.search_decoration)).map(snapback4_core::search_decoration::paths);
                        let scopes = read_scopes::dependencies(&reader, &op, &context);
                        trace::mark("query_start");
                        let (outcome, cut, current) = reader.query_search_at(&op, context, retained.as_deref());
                        trace::mark("query_end");
                        let scopes = read_scopes::complete(scopes, reader.schema(), outcome.as_ref().map_or(&[], |o| &o.tables));
                        if outcome.is_ok() { lock(&shared.readers).put(&epoch, reader.into_inner()); }
                        (outcome, cut, metadata, reads_presence, query_generation, current, scopes, decoration_paths)
                    },
                    // Only memory stores lack detached readers by construction.
                    Err(error) if !shared.memory_store() => {
                        return respond_timed(request, shared, 503, json!({"denied": error.refusal()}));
                    }
                    Err(_) => {
                        let mut engine = lock(&shared.engine);
                        let metadata = response_head(&mut engine);
                        let reads_presence = presence_of(&engine);
                        if shared.personas { context = dev_refusals::response::context(context, Arc::new(lock(&shared.bound).refusal_sites.clone()), engine.generation()); }
                        let query_generation = engine.generation();
                        let decoration_paths = engine.program(&op).filter(|_| engine.schema().operations.get(&op).is_some_and(|f| f.search_decoration)).map(snapback4_core::search_decoration::paths);
                        let scopes = read_scopes::dependencies(&engine, &op, &context);
                        let (outcome, cut, current) = engine.query_search_at(&op, context, retained.as_deref());
                        let scopes = read_scopes::complete(scopes, engine.schema(), outcome.as_ref().map_or(&[], |o| &o.tables));
                        (outcome, cut, metadata, reads_presence, query_generation, current, scopes, decoration_paths)
                    },
                };
                let (store_id, head) = match metadata { Ok(head) => head, Err(why) => { respond_timed(request, shared, 503, json!({ "denied": why })); return; } };
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
                            data: wire::Plain<'a>,
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
                        impl latency::Reply for QueryReply<'_> {}
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
                            respond_timed(request, shared, 200, QueryReply { scopes: &scopes, search_current: &search_current, generation: query_generation, search_scopes: &outcome.search_scopes, search_rows: outcome.search_rows.as_ref().map(wire::Plain), delivery: &outcome.delivery, ephemeral: &outcome.ephemeral, row_provenance: row_provenance.as_ref().map(wire::Plain), complete: outcome.complete, cut: outcome.cut, data: wire::Plain(&outcome.data), next: &outcome.next, next_expiry: outcome.next_expiry, decoration_expiry: decoration_paths.is_some().then_some(outcome.decoration_expiry), decoration_paths, seq: outcome.seq, store_id, tables: &outcome.tables, viewer: &viewer, meter, refresh });
                        }
                    }
                    Err(refusal) => {
                        let mut reply = json!({ "denied": refusal_json(&refusal), "generation": query_generation, "complete": false, "store_id": store_id, "head": head });
                        // @ref LLP 3000.018#3.2 — a refusal names the cut its evaluation read, which the head
                        // taken before it may predate, so a client can order it against a remembered answer.
                        if let Some(cut) = cut { reply["seq"] = json!(cut); }
                        // A refusal can depend on presence too: its watch keeps refreshing (LLP 3000.018 §3.2).
                        if reads_presence && !refusal.retryable { reply["refresh"] = json!(PRESENCE_REFRESH.as_millis() as u64); }
                        respond_timed(request, shared, if refusal.retryable { 503 } else { 200 }, reply);
                    }
                }
            } else {
                if kind == ProgramKind::Query {
                    operation_refusal(request, shared, 400, Refusal::new("E_OP", "op", format!("{op} is a query; POST /q/{op}")));
                    return;
                }
                if kind == ProgramKind::Job {
                    operation_refusal(request, shared, 400, Refusal::new("E_OP", "op", format!("{op} is a job: a schedule fires it, or `snapback4 run {op}` does; no caller can")).guide("jobs"));
                    return;
                }
                let id = payload.get("id").and_then(Json::as_str).map(str::to_owned);
                if let Some(ids) = payload.get("newIds").and_then(Json::as_array) {
                    context = context.with_ids(ids.iter().filter_map(Json::as_str).map(str::to_owned));
                }
                #[cfg(test)] test_work(&shared.mutation_wait);
                let (outcome, metadata, preserved, generation) = {
                    let mut engine = lock(&shared.engine);
                    if let Err(refusal) = mutation_authority(&request, shared, &engine, &principal) {
                        drop(engine);
                        return respond_timed(request, shared, 401, json!({"denied":refusal_json(&refusal)}));
                    }
                    if engine.schema().operations.get(&op).is_some_and(|f| f.ephemeral) {
                        drop(engine);
                        return ephemeral::serve(request, shared, &op, &body);
                    }
                    if shared.personas { context = dev_refusals::response::context(context, Arc::new(lock(&shared.bound).refusal_sites.clone()), engine.generation()); }
                    context.delivery_fingerprint = delivery_fingerprint;
                    let outcome = intent_store(&engine, &payload).and_then(|()| engine.mutate(&op, id.as_deref(), context.with_wire_args(args_json)).map_err(|error| error.refusal()));
                    if matches!(&outcome, Ok(outcome) if !outcome.receipt_only && matches!(outcome.state, WriteState::Sent { .. })) { shared.durable_committed(&engine); }
                    let preserved = changes::ack_preserved(&engine, outcome.as_ref().ok());
                    (outcome, response_head(&mut engine), preserved, engine.generation())
                };
                let (store_id, head) = match metadata { Ok(head) => head, Err(why) => { respond_timed(request, shared, 503, json!({ "denied": why })); return; } };
                match outcome {
                    Ok(outcome) => {
                        let mut body = outcome.reply(id.as_deref());
                        body["preserved"] = json!(preserved);
                        body["generation"] = json!(generation);
                        body["store_id"] = json!(store_id);
                        body["head"] = json!(head);
                        respond_timed(request, shared, 200, body);
                    }
                    Err(refusal) => { respond_timed(request, shared, if refusal.code == "E_STORE_REPLACED" { 200 } else { mutation_error_status(&refusal) }, json!({ "state": "failed", "id": id, "why": refusal_json(&refusal), "store_id": store_id, "head": head })) }
                }
            }
        }
        (Method::Get, "/changes") => changes::serve(request, shared, &url),
        (Method::Post, "/sync") => sync::serve(request, shared, &body),
        (Method::Post, "/auth/session") => {
            // An application that authenticates its own accounts (a phone
            // it verified, a directory it owns) mints their sessions through
            // its service and hands each token to that account's device.
            let payload: Json = serde_json::from_str(if body.is_empty() { "{}" } else { &body }).unwrap_or(Json::Null);
            let wire = session_mint_wire(&request, &payload);
            let legacy_now = shared.now();
            let outcome = {
                let mut engine = lock(&shared.engine);
                match service_of_locked(&request, shared, &engine) {
                    Err(refusal) => Err((401, refusal)),
                    Ok(service) => match wire {
                        Err(error) => Err(error),
                        Ok(SessionMintWire::Legacy { principal, kind, days }) => {
                            snapback4_core::identity::custom_session(engine.store(), &principal, &kind, legacy_now, days)
                                .map(|session| json!({ "session": { "principal": session.principal, "kind": session.kind, "token": session.token, "expiresAt": session.expires_at }, "by": service }))
                                .map_err(|error| (if error.is_refusal() { 200 } else { 503 }, error.refusal()))
                        }
                        Ok(SessionMintWire::Bound { principal, kind, days, binding, lease, service_token }) => {
                            snapback4_core::identity::bound_custom_session(engine.store_mut(), &service_token, &service, &lease, &principal, &kind, || shared.now(), days, &binding)
                                .map(|session| json!({ "session": { "principal": session.principal, "kind": session.kind, "token": session.token, "expiresAt": session.expires_at }, "by": service }))
                                .map_err(|error| (if error.is_refusal() { 200 } else { 503 }, error.refusal()))
                        }
                    },
                }
            };
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
            let outcome = {
                let engine = lock(&shared.engine);
                snapback4_core::identity::revoke_principal(engine.store(), &principal)
            };
            match outcome {
                Ok(revoked) => respond_timed(request, shared, 200, json!({ "revoked": revoked, "principal": principal })),
                Err(error) => respond_timed(request, shared, if error.is_refusal() { 200 } else { 503 }, json!({ "denied": refusal_json(&error.refusal()) })),
            }
        }
        (Method::Post, "/auth/guest") | (Method::Post, "/auth/signup") | (Method::Post, "/auth/login")
        | (Method::Post, "/auth/logout") | (Method::Post, "/auth/refresh") | (Method::Post, "/auth/logout-all") => {
            crate::auth::handle(request, shared, &path, &body);
        }
        (Method::Post, "/seed") => {
            if !shared.personas || !request.remote_addr().is_some_and(|a| a.ip().is_loopback()) {
                respond_timed(request, shared, 403, json!({ "denied": refusal_json(&Refusal::new("E_AUTH", "auth", "seeding is a development door")) }));
                return;
            }
            let rows: Vec<Json> = match serde_json::from_str(&body) {
                Ok(Json::Array(rows)) => rows,
                _ => {
                    respond_timed(request, shared, 400, json!({ "denied": refusal_json(&Refusal::new("E_INPUT", "input", "seed takes a JSON array of {table, row}")) }));
                    return;
                }
            };
            let schema = lock(&shared.bound).schema.clone();
            let mut typed = Vec::new();
            for entry in &rows {
                let (Some(table), Some(row)) = (entry.get("table").and_then(Json::as_str), entry.get("row")) else {
                    respond_timed(request, shared, 400, json!({ "denied": refusal_json(&Refusal::new("E_INPUT", "input", "each seed entry is {table, row}")) }));
                    return;
                };
                let Some(definition) = schema.table(table) else {
                    respond_timed(request, shared, 400, json!({ "denied": refusal_json(&Refusal::new("E_INPUT", "input", format!("unknown table {table}"))) }));
                    return;
                };
                match wire::row_from_json(definition, row) {
                    Ok(value) => typed.push((table.to_owned(), value)),
                    Err(why) => {
                        respond_timed(request, shared, 400, json!({ "denied": refusal_json(&Refusal::new("E_INPUT", "input", format!("{table}: {why}"))) }));
                        return;
                    }
                }
            }
            let outcome = lock(&shared.engine).seed_at(typed, shared.now());
            match outcome {
                Ok(count) => {
                    shared.durable_committed(&lock(&shared.engine));
                    respond_timed(request, shared, 200, json!({ "seeded": count }));
                }
                Err(error) => respond_timed(request, shared, 200, json!({ "denied": refusal_json(&error.refusal()) })),
            }
        }
        _ => respond_timed(request, shared, 404, json!({ "denied": refusal_json(&Refusal::new("E_OP", "op", format!("no route {path}; operations are POST /q/<op> and POST /m/<op>"))) })),
    }
}

#[cfg(test)]
#[path = "../tests/serve_poison/mod.rs"]
mod poison_tests;
