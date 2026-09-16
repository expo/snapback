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
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};
use tiny_http::{Header, Method, Request, Response, Server};

#[path = "actions.rs"]
mod actions;

#[path = "serve_routes.rs"]
mod routes;

#[path = "serve_changes.rs"]
mod changes;

#[path = "serve_maintenance.rs"]
mod maintenance;
use maintenance::maintain;

#[path = "serve_adoption.rs"]
mod adoption;
use adoption::watch_sources;

#[cfg(test)]
#[path = "serve_tests.rs"]
mod tests;

pub struct Shared {
    pub clock: Arc<Mutex<crate::dev_clock::Clock>>,
    maintenance: Mutex<()>,
    pub engine: Mutex<Engine>,
    adoption: Mutex<adoption::Status>,
    readers: Mutex<QueryReaders>,
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
    #[cfg(test)]
    pub auth_work: WorkHook,
    #[cfg(test)]
    pub upload_work: WorkHook,
    #[cfg(test)]
    pub effect_wait: WorkHook,
}

impl Shared {
    pub fn now(&self) -> i64 { lock(&self.clock).now() }
}

// @ref LLP 3000#7-decisions-during-execution — reader reuse retains fresh transactions and retires old native modules.
/// Reuse only detached read owners. Each query still opens and rolls back
/// its own identity-checked SQLite transaction; no result or viewer is cached.
#[derive(Default)]
struct QueryReaders {
    epoch: Arc<()>,
    idle: Vec<Engine>,
}

impl QueryReaders {
    fn take(&mut self, engine: &Engine) -> Result<(Arc<()>, Engine), snapback4_core::RuntimeError> {
        let reader = match self.idle.pop() {
            Some(reader) => reader,
            None => engine.reader()?,
        };
        Ok((self.epoch.clone(), reader))
    }

    fn put(&mut self, epoch: &Arc<()>, reader: Engine) {
        if Arc::ptr_eq(epoch, &self.epoch) && self.idle.len() < REQUEST_WORKERS {
            self.idle.push(reader);
        }
    }

    fn invalidate(&mut self) {
        // Native code can change without a schema-generation change. Loans
        // retain their old epoch so an in-flight return cannot repopulate it.
        self.epoch = Arc::new(());
        self.idle.clear();
    }
}

/// A panicking request must not turn one poisoned process mutex into a
/// permanent server-wide panic loop. The guarded value is retained, the
/// poison marker is cleared, and the next request can make progress.
pub(crate) fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            eprintln!("snapback4: recovered a mutex after a request panicked");
            mutex.clear_poison();
            poisoned.into_inner()
        }
    }
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
const PRESENCE_GRACE: Duration = Duration::from_secs(35);

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
        let map = lock(&self.polls);
        let clock = lock(&self.clock);
        match map.get(principal) {
            Some((open, _)) if *open > 0 => (u64::from(*open), None),
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
    Dev { watch: bool, fresh: bool, replay: bool, hold_effects: bool, hold_schedules: bool, clock_offset: i64 },
    Release { expected: u64, worker: Option<std::path::PathBuf> },
}

pub fn serve(project: Project, port: u16, mode: Mode, bind: &str) -> Result<(), String> {
    let mut source_stamp = project.sources_stamp();
    let bound = project.compile().map_err(|e| e.to_string())?;
    if !bound.diagnostics.is_empty() {
        for diagnostic in &bound.diagnostics {
            eprintln!("{diagnostic}\n");
        }
        return Err(format!("{} problem{} in snapback/", bound.diagnostics.len(), if bound.diagnostics.len() == 1 { "" } else { "s" }));
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
        let path = project.store_path();
        let path = if path.exists() { path.canonicalize().map_err(|e| e.to_string())? } else { path };
        Some(crate::verbs::deployment_lock(path.parent().ok_or("store path has no parent")?)?)
    } else { None };
    // A busy port is a failed start, not permission to change the stopped host's policy.
    let server = Server::http_with_limits((bind, port), tiny_http::ConnectionLimits::default()).map_err(|e| format!("cannot listen on {bind}:{port}: {e}"))?;
    // `--fresh`: a store in memory that dies with the process, for acceptance
    // scripts that must start from nothing every time.
    let mut engine = match &mode {
        Mode::Dev { fresh: true, .. } => Engine::memory(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())),
        Mode::Dev { .. } => adoption::open(&project, &bound),
        Mode::Release { expected, .. } => project.open_release_engine(&bound, *expected),
    }.map_err(|e| e.to_string())?;
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
    let shared = Arc::new(Shared {
        adoption, clock, maintenance: Mutex::new(()), engine: Mutex::new(engine), readers: Mutex::new(QueryReaders::default()), bound: Mutex::new(bound), generation: Mutex::new(generation), worker_revision: AtomicUsize::new(0), committed: Condvar::new(), seq: Mutex::new(seq), personas: dev, hold_effects, hold_schedules, entropy: Mutex::new(snapback4_core::ids::seed()), presence, asset_transfers: AssetTransfers::default(), native: Mutex::new(installed), auth: crate::auth::Admission::default(), uploads: AtomicUsize::new(0),
        route_verification: routes::Verification::default(),
        #[cfg(test)] auth_work: Mutex::new(None),
        #[cfg(test)] upload_work: Mutex::new(None),
        #[cfg(test)] effect_wait: Mutex::new(None),
    });
    let server = Arc::new(server);
    let address = server.server_addr();
    // Discover the live dev inspector through the existing lifetime lock file.
    if let Some(file) = &mut host_lock {
        file.set_len(0).map_err(|e| e.to_string())?;
        write!(file, "{}", address.clone().to_ip().ok_or("HTTP listener has no IP address")?.port()).map_err(|e| e.to_string())?;
    }
    let worker_url = format!("http://{address}").replace("0.0.0.0", "127.0.0.1").replace("[::]", "[::1]");
    let mut worker = match &mode {
        Mode::Dev { .. } => crate::dev_worker::DevWorker::start(&project, shared.clone(), worker_url)?,
        Mode::Release { worker: Some(source), .. } => Some(crate::dev_worker::DevWorker::start_source(&project, shared.clone(), worker_url, source.clone(), true)?),
        _ => None,
    };
    crate::lifecycle::generation(generation);
    // The URL is stdout's first line; the dev token follows, while lifecycle and worker logs use stderr.
    println!("http://{address}");
    match &generated {
        Some(generated) => eprintln!("snapback4 dev: http://{address}  (schema: snapback/, types: {})", generated.display()),
        None => eprintln!("snapback4 serve: http://{address}  (release {}, generation {generation}, tokens only)", project.root.display()),
    }
    if dev {
        match mode {
            Mode::Dev { fresh: true, .. } => eprintln!("store: in memory — dies with this process"),
            _ => eprintln!("store: {}", project.store_path().display()),
        }
    }
    if dev { eprintln!("snapback4 dev: development only — admits loopback personas and an unauthenticated /seed; deploy with snapback4 deploy + snapback4 serve, which refuse both."); }
    if replay { eprintln!("snapback4 dev: replay on — new effects suppressed; schedules held"); }
    let mut background = Vec::new();
    if let Mode::Dev { watch: true, .. } = mode {
        let shared = shared.clone();
        let project = Project { root: project.root.clone() };
        background.push(("watcher", crate::lifecycle::background("watcher", move || watch_sources(project, shared, source_stamp))?));
    }
    {
        let shared = shared.clone();
        background.push(("maintenance", crate::lifecycle::background("maintenance", move || maintain(shared))?));
    }
    if dev { eprintln!("snapback4 dev: loopback identity attempts have no per-peer or per-email minute limits; Argon2 slots: {} on this host; connection/worker caps still apply", shared.auth.kdf_slots(true)); }
    // @ref LLP 3000#7-decisions-during-execution — bound HTTP admission while reserving short requests
    let admission = Arc::new(RequestAdmission::default());
    let mut worker_start_revision = shared.worker_revision.load(Ordering::Acquire);
    loop {
        if crate::lifecycle::stopping() { return Ok(()); }
        for (name, thread) in &background {
            if thread.is_finished() { return Err(format!("{name} thread stopped")); }
        }
        let revision = shared.worker_revision.load(Ordering::Acquire);
        if worker.is_none() && dev && revision != worker_start_revision {
            worker_start_revision = revision;
            match crate::dev_worker::DevWorker::start(&project, shared.clone(), format!("http://{address}").replace("0.0.0.0", "127.0.0.1").replace("[::]", "[::1]")) {
                Ok(next) => worker = next,
                Err(error) => eprintln!("snapback4 worker: {error}"),
            }
        }
        if let Some(worker) = &mut worker {
            worker.tick();
        }
        if let Some(request) = server.recv_timeout(Duration::from_millis(100)).map_err(|error| format!("HTTP listener stopped: {error}"))? {
            dispatch(request, shared.clone(), admission.clone());
        }
    }
}

const REQUEST_WORKERS: usize = 32;
const WAIT_WORKERS: usize = 32;
const ROUTE_WORKERS: usize = 16;
const REGISTRY_WORKERS: usize = 4;
const VERIFIER_WORKERS: usize = 4;

#[derive(Default)]
struct RequestAdmission { short: AtomicUsize, waiters: AtomicUsize, routes: AtomicUsize, registries: AtomicUsize, verifiers: AtomicUsize }

#[derive(Clone, Copy)]
enum RequestClass { Short, Wait, Route, Registry, Verifier }
struct RequestPermit { admission: Arc<RequestAdmission>, class: RequestClass }
impl Drop for RequestPermit {
    fn drop(&mut self) { self.admission.counter(self.class).fetch_sub(1, Ordering::AcqRel); }
}
impl RequestAdmission {
    fn counter(&self, class: RequestClass) -> &AtomicUsize {
        match class { RequestClass::Short => &self.short, RequestClass::Wait => &self.waiters, RequestClass::Route => &self.routes, RequestClass::Registry => &self.registries, RequestClass::Verifier => &self.verifiers }
    }
    fn acquire(self: &Arc<Self>, class: RequestClass) -> Option<RequestPermit> {
        let limit = match class { RequestClass::Short => REQUEST_WORKERS, RequestClass::Wait => WAIT_WORKERS, RequestClass::Route => ROUTE_WORKERS, RequestClass::Registry => REGISTRY_WORKERS, RequestClass::Verifier => VERIFIER_WORKERS };
        self.counter(class).fetch_update(Ordering::AcqRel, Ordering::Acquire, |n| (n < limit).then_some(n + 1)).ok()?;
        Some(RequestPermit { admission: self.clone(), class })
    }
}

fn dispatch(request: Request, shared: Arc<Shared>, admission: Arc<RequestAdmission>) {
    let path = request.url().split('?').next().unwrap_or("");
    // Route waits cannot occupy the polls needed to verify or execute them.
    let class = if request.method() == &Method::Post && routes::declared(shared.as_ref(), request.url()).is_some() { RequestClass::Route }
        else if request.method() == &Method::Post && path == "/routes/verify/claim" { RequestClass::Verifier }
        else if request.method() == &Method::Post && path == "/actions/claim-set" { RequestClass::Registry }
        else if is_waiter(request.method(), path) { RequestClass::Wait } else { RequestClass::Short };
    let Some(permit) = admission.acquire(class) else { request.abort(); return; };
    if let Err(error) = std::thread::Builder::new().name("request".into()).spawn(move || { let _permit = permit; handle(request, &shared); }) {
        eprintln!("snapback4: cannot start request thread: {error}");
    }
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
    let Some((principal, kind)) = snapback4_core::identity::resolve(engine.store(), &token, shared.now()).map_err(|e| e.refusal())? else { return Err(refused()); };
    if !snapback4_core::identity::is_service(&principal) || kind != "service"
        || !crate::dev_worker::current_session(engine.store(), &token, shared.worker_revision.load(Ordering::Acquire)).map_err(|e| e.refusal())? {
        return Err(refused());
    }
    Ok(principal)
}

fn effect_json(run: &snapback4_core::EffectRun) -> Json {
    json!({ "id": run.id, "effect": run.effect, "payload": wire::to_json(&run.payload), "state": run.state, "attempt": run.attempts, "seq": run.seq, "at": run.at, "nextAt": run.next_at, "leaseUntil": run.lease_until, "leaseToken": run.lease_token, "deadline": run.deadline, "cancelled": run.cancelled, "result": run.result.as_ref().map(wire::to_json), "error": run.error, "errorCode": run.error_code })
}

/// A commit outside a request: let every long poll see it.
fn bump_seq(shared: &Shared) {
    if let Ok(seq) = lock(&shared.engine).seq() {
        let mut current = lock(&shared.seq);
        if seq > *current {
            *current = seq;
            shared.committed.notify_all();
        }
    }
}

fn single_header<'a>(request: &'a Request, name: &str) -> Result<Option<&'a str>, ()> {
    let mut headers = request.headers().iter().filter(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name));
    let value = headers.next().map(|h| h.value.as_str());
    if headers.next().is_some() { Err(()) } else { Ok(value) }
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
        Header::from_bytes("Access-Control-Allow-Headers", "content-type, x-snapback-persona, x-snapback-meter, authorization, range").unwrap(),
        Header::from_bytes("Access-Control-Allow-Methods", "GET, POST, OPTIONS").unwrap(),
    ];
    if let Ok(Some(origin)) = single_header(request, "origin") && origin_authority(origin).is_some() {
        headers.push(Header::from_bytes("Access-Control-Allow-Origin", origin).unwrap());
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

// @ref LLP 3000#7-decisions-during-execution — encode borrowed plain values without a second JSON tree
#[derive(serde::Serialize)]
struct SyncEvent<'a> {
    data: Option<wire::Plain<'a>>,
    id: &'a str,
    kind: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    seq: Option<u64>,
    table: &'a str,
}

// Own the reply so `respond` drops its rows after encoding, before socket I/O.
enum SyncEvents {
    Snapshot(Vec<snapback4_core::partition::Event>),
    Stream(Vec<snapback4_core::store::LogEvent>),
}

impl serde::Serialize for SyncEvents {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Snapshot(events) => serializer.collect_seq(events.iter().map(|event| SyncEvent {
                data: event.data.as_ref().map(wire::Plain), id: &event.id,
                kind: event.kind.word(), seq: None, table: &event.table,
            })),
            Self::Stream(events) => serializer.collect_seq(events.iter().map(|event| SyncEvent {
                data: event.data.as_ref().map(wire::Plain), id: &event.id,
                kind: &event.kind, seq: Some(event.seq), table: &event.table,
            })),
        }
    }
}

#[derive(serde::Serialize)]
struct SnapshotReply {
    acknowledged: BTreeMap<String, u64>,
    events: SyncEvents,
    generation: u64,
    held: Option<wire::HeldGroups>,
    more: bool,
    next: Option<String>,
    snapshot: bool,
    store_id: String,
    watermark: u64,
}

#[derive(serde::Serialize)]
struct StreamReply {
    acknowledged: BTreeMap<String, u64>,
    events: SyncEvents,
    generation: u64,
    joined: wire::HeldGroups,
    more: bool,
    snapshot: bool,
    store_id: String,
    watermark: u64,
}

pub(crate) fn respond(request: Request, status: u16, body: impl serde::Serialize) {
    respond_with_cors(request, status, body, true)
}

fn respond_with_cors(request: Request, status: u16, body: impl serde::Serialize, allow_origin: bool) {
    let mut bytes = JsonBuffer(Vec::new());
    let encoded = serde_json::to_writer(&mut bytes, &body);
    drop(body);
    let status = if encoded.is_err() {
        bytes.0.clear();
        let refusal = Refusal::new("E_BOUND", "bound", "the HTTP JSON response exceeds 16 MiB; request a smaller page or return fewer values").guide("reads");
        serde_json::to_writer(&mut bytes, &json!({ "denied": refusal_json(&refusal) })).expect("the fixed HTTP refusal fits the response ceiling");
        200
    } else { status };
    let capacity = bytes.0.len() + 512;
    let mut response = Response::from_data(bytes.0).with_status_code(status);
    response.add_header(Header::from_bytes("Content-Type", "application/json").unwrap());
    response.add_header(Header::from_bytes("Cache-Control", "no-store").unwrap());
    if allow_origin {
        for header in cors(&request) { response.add_header(header); }
    }
    if status >= 400 && request.method() == &Method::Post {
        let _ = request.respond_and_close(response);
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
        let _ = request.respond(response);
        return;
    }
    // @ref LLP 3000#7-decisions-during-execution — coalesce buffered JSON HTTP responses
    // The body is already materialized. Frame it before writing so the HTTP
    // library's small socket buffer cannot split headers from a short body
    // and leave the latter waiting for a delayed TCP acknowledgement.
    let mut encoded = Vec::with_capacity(capacity);
    if response.raw_print(&mut encoded, request.http_version().clone(), request.headers(), request.method() == &Method::Head, None).is_ok() {
        let mut writer = request.into_writer();
        let _ = writer.write_all(&encoded).and_then(|_| writer.flush());
    }
}

/// A 204 has no representation metadata or advertised bytes. Keeping it out
/// of the JSON response helper also prevents an unread `null` from framing the
/// next response on a persistent connection.
pub(crate) fn respond_empty(request: Request, status: u16) {
    let mut response = Response::empty(status);
    for header in cors(&request).into_iter().filter(|header| !header.field.equiv("Content-Type")) {
        response.add_header(header);
    }
    let _ = request.respond(response);
}

pub(crate) fn refusal_json(refusal: &Refusal) -> Json {
    serde_json::to_value(refusal).unwrap_or(Json::Null)
}

/// Who is asking: a bearer session, or (in `dev`, from loopback) a persona.
pub(crate) fn principal_of(request: &Request, shared: &Shared) -> Result<String, Refusal> {
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
        let engine = lock(&shared.engine);
        return match snapback4_core::identity::resolve(engine.store(), &token, shared.now()) {
            Ok(Some((principal, _))) => Ok(principal),
            Ok(None) => Err(Refusal::new("E_AUTH", "auth", "this session is not live; sign in again").guide("personas")),
            Err(error) => Err(error.refusal()),
        };
    }
    Err(Refusal::new("E_AUTH", "auth", "sign in: send a bearer token (snapback4/auth), or x-snapback-persona in development").guide("personas"))
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

// @ref LLP 3000.009#5.1 — a racing id conflict is a terminal input refusal, not a transport failure.
fn mutation_error_status(refusal: &Refusal) -> u16 {
    if refusal.retryable { 503 } else if refusal.code == "E_ID_REUSED" { 200 } else { 500 }
}

fn handle(mut request: Request, shared: &Shared) {
    let method = request.method().clone();
    let url = request.url().to_owned();
    let path = url.split('?').next().unwrap_or("").to_owned();
    // This exact declared POST path is the only non-loopback development
    // exception. Core doors, mismatched methods and query variants stay fenced.
    if method == Method::Post && let Some((name, route)) = routes::declared(shared, &url) {
        return routes::ingress(request, shared, &name, route);
    }
    if let Err(refusal) = dev_request(&request, shared) {
        respond_with_cors(request, 403, json!({ "denied": refusal_json(&refusal) }), false);
        return;
    }
    if path.starts_with("/dev/clock") && !shared.personas {
        return respond(request, 403, json!({ "denied": refusal_json(&crate::dev_clock::release()) }));
    }
    if method == Method::Get && path == "/dev/status" {
        if !shared.personas { return respond(request, 403, json!({"denied":refusal_json(&Refusal::new("E_AUTH", "auth", "status inspection requires dev"))})); }
        // No engine lock: doctor must remain usable while an adoption waits on SQLite.
        let generation = *lock(&shared.generation);
        let status = lock(&shared.adoption);
        return respond(request, 200, json!({"storeId":status.store_id, "generation":generation, "adoption":status.failure, "now":shared.now()}));
    }
    if method == Method::Options {
        respond_empty(request, 204);
        return;
    }
    if method == Method::Post && path == "/seed" && !shared.personas {
        return respond(request, 403, json!({ "denied": refusal_json(&Refusal::new("E_AUTH", "auth", "seeding is a development door")) }));
    }
    // Check identity before upload admission or allocating any large body.
    // The route rechecks after reading, so expiry/revocation during a slow
    // upload cannot retain the authority held at its start.
    if method == Method::Post && (path == "/assets" || path == "/sync" || path.starts_with("/q/") || path.starts_with("/m/") || path.starts_with("/a/")
        || (path.starts_with("/actions/") && path.ends_with("/cancel"))
        || matches!(path.as_str(), "/auth/refresh" | "/auth/logout" | "/auth/logout-all")) {
        if let Err(refusal) = principal_of(&request, shared) {
            return respond(request, 401, json!({ "denied": refusal_json(&refusal) }));
        }
    }
    if method == Method::Post && (matches!(path.as_str(), "/auth/session" | "/auth/revoke") || path.starts_with("/effects/") || path.starts_with("/routes/verify/") || (path.starts_with("/actions/") && !path.ends_with("/cancel"))) {
        if let Err(refusal) = service_of(&request, shared) {
            return respond(request, 401, json!({ "denied": refusal_json(&refusal) }));
        }
    }
    if method == Method::Get && matches!(path.as_str(), "/" | "/schema" | "/api.ts" | "/native.wasm" | "/changes") {
        if let Err(refusal) = principal_of(&request, shared) {
            return respond(request, 401, json!({ "denied": refusal_json(&refusal) }));
        }
    }
    let _upload_permit = if method == Method::Post && path == "/assets" {
        match crate::assets::admit(shared) {
            Some(permit) => Some(permit),
            None => return respond(request, 429, json!({ "denied": refusal_json(&Refusal::new("E_RATE_LIMIT", "auth", "too many concurrent uploads; retry shortly")) })),
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
            return respond(request, 413, json!({ "denied": refusal_json(&too_large()) }));
        }
        let mut buffer = [0; 8 * 1024];
        loop {
            let length = buffer.len().min(ceiling - bytes.len() + 1);
            match request.as_reader().read(&mut buffer[..length]) {
                Ok(0) => break,
                Ok(read) if read > ceiling - bytes.len() => return respond(request, 413, json!({ "denied": refusal_json(&too_large()) })),
                Ok(read) => bytes.extend_from_slice(&buffer[..read]),
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                Err(error) => return respond(request, 400, json!({ "denied": refusal_json(&Refusal::new("E_INPUT", "input", format!("cannot read the request body: {error}"))) })),
            }
        }
        if length.is_some_and(|length| length != bytes.len()) {
            return respond(request, 400, json!({ "denied": refusal_json(&Refusal::new("E_INPUT", "input", "the request body ended before its declared Content-Length")) }));
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
        Err(_) => return respond(request, 400, json!({ "denied": refusal_json(&Refusal::new("E_INPUT", "input", "a JSON request body must be valid UTF-8")) })),
    };
    match (method, path.as_str()) {
        (Method::Post, "/dev/clock/advance") => maintenance::advance(request, shared, &body),
        (Method::Post, path) if path.starts_with("/a/") => actions::call(request, shared, path.trim_start_matches("/a/"), &body),
        (Method::Post, "/actions/claim") => actions::claim(request, shared, &body),
        (Method::Post, "/actions/claim-set") => actions::claim_set(request, shared, &body),
        (Method::Post, "/routes/verify/claim") => routes::claim(request, shared, &body),
        (Method::Post, path) if path.starts_with("/routes/verify/") => routes::settle(request, shared, path, &body),
        (Method::Post, path) if path.starts_with("/actions/") => actions::settle(request, shared, path, &body),
        (Method::Get, "/probe") => match principal_of(&request, shared) {
            Ok(_) => {
                let identity = { let engine = lock(&shared.engine); engine.store().meta("store_id").and_then(|id| engine.store().seq().map(|seq| (id, seq))) };
                match identity {
                    Ok((store_id, seq)) => respond(request, 200, json!({ "ok": true, "store_id": store_id, "seq": seq })),
                    Err(error) => respond(request, 500, json!({ "denied": refusal_json(&error.refusal()) })),
                }
            },
            Err(refusal) => respond(request, 401, json!({ "denied": refusal_json(&refusal) })),
        },
        (Method::Get, "/auth/config") => {
            let auth = lock(&shared.bound).schema.auth.clone();
            respond(request, 200, json!({ "guests": auth.guests, "password": auth.password }));
        }
        (Method::Get, "/") => {
            let seq = match lock(&shared.engine).seq() {
                Ok(seq) => seq,
                Err(error) => return respond(request, 500, json!({ "denied": refusal_json(&error.refusal()) })),
            };
            let body = {
                let bound = lock(&shared.bound);
                let ops: Vec<Json> = bound.programs.iter().map(|p| json!({ "name": p.program.name, "kind": p.program.kind.word() })).collect();
                let tables: Vec<Json> = bound.schema.tables.iter().map(|(name, table)| json!({ "name": name, "sync": table.sync.as_ref().map(|s| s.line()) })).collect();
                json!({ "snapback4": env!("CARGO_PKG_VERSION"), "generation": *lock(&shared.generation), "seq": seq, "ops": ops, "tables": tables })
            };
            respond(request, 200, body);
        }
        (Method::Get, "/schema") => {
            // The compiled backend a device runs locally: the schema and the
            // programs' IR, bound to a generation.
            let (schema, programs, generation, native) = {
                let bound = lock(&shared.bound);
                (bound.schema.clone(), snapback4_lang::emit::backend_programs(&bound), *lock(&shared.generation), lock(&shared.native).as_ref().map(|n| (n.digest.clone(), n.jobs.clone(), n.reads.clone())))
            };
            let native = native.map(|(digest, jobs, reads)| json!({ "digest": digest, "jobs": jobs, "reads": reads }));
            respond(request, 200, json!({ "generation": generation, "schema": schema, "programs": programs, "native": native }));
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
                    for header in cors(&request) { response.add_header(header); }
                    let _ = request.respond(response);
                }
                None => respond(request, 404, json!({ "denied": refusal_json(&Refusal::new("E_NATIVE", "schema", "this backend has no native module")) })),
            }
        }
        (Method::Get, "/api.ts") => {
            let text = snapback4_lang::emit::typescript(&lock(&shared.bound));
            let mut response = Response::from_string(text);
            response.add_header(Header::from_bytes("Content-Type", "text/plain; charset=utf-8").unwrap());
            response.add_header(Header::from_bytes("Cache-Control", "no-store").unwrap());
            for header in cors(&request) { response.add_header(header); }
            let _ = request.respond(response);
        }
        (Method::Post, path) if path.starts_with("/q/") || path.starts_with("/m/") => {
            let op = path[3..].to_owned();
            let principal = match principal_of(&request, shared) {
                Ok(principal) => principal,
                Err(refusal) => {
                    respond(request, 401, json!({ "denied": refusal_json(&refusal) }));
                    return;
                }
            };
            let payload: Json = match serde_json::from_str(if body.is_empty() { "{}" } else { &body }) {
                Ok(json) => json,
                Err(error) => {
                    respond(request, 400, json!({ "denied": refusal_json(&Refusal::new("E_INPUT", "input", format!("the request body is not JSON: {error}"))) }));
                    return;
                }
            };
            let args_json = payload.get("args").cloned().unwrap_or(json!({}));
            if path.starts_with("/m/") && let Some(id) = payload.get("id").and_then(Json::as_str) {
                let replay = lock(&shared.engine).replay_mutation(&principal, id, &op, &args_json);
                match replay {
                    Ok(Some(outcome)) => { respond(request, 200, outcome.reply(Some(id))); return; }
                    Err(error) => { let why = error.refusal(); respond(request, if why.retryable { 503 } else { 200 }, json!({ "state": "failed", "id": id, "why": why })); return; }
                    Ok(None) => {}
                }
            }
            let signature = lock(&shared.bound).programs.iter().find(|p| p.program.name == op)
                .map(|p| (p.program.kind, p.program.args.clone()));
            let Some((kind, arg_types)) = signature else {
                respond(request, 404, json!({ "denied": refusal_json(&Refusal::new("E_OP", "op", format!("unknown operation {op}")).guide("programs")) }));
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
                                respond(request, 400, json!({ "denied": refusal_json(&Refusal::new("E_INPUT", "input", format!("argument {name}: {why}")).guide("types")) }));
                                return;
                            }
                        },
                        None => {
                            respond(request, 400, json!({ "denied": refusal_json(&Refusal::new("E_INPUT", "input", format!("{op} takes no argument {name}")).guide("programs")) }));
                            return;
                        }
                    }
                }
            }
            let viewer = principal.clone();
            let mut context = Context::new(principal, args).at(shared.now());
            if path.starts_with("/q/") {
                if kind != ProgramKind::Query {
                    respond(request, 400, json!({ "denied": refusal_json(&Refusal::new("E_OP", "op", format!("{op} is a mutation; POST /m/{op}"))) }));
                    return;
                }
                let reader = {
                    let engine = lock(&shared.engine);
                    lock(&shared.readers).take(&engine)
                };
                let outcome = match reader {
                    Ok((epoch, mut reader)) => {
                        let outcome = reader.query(&op, context);
                        if outcome.is_ok() { lock(&shared.readers).put(&epoch, reader); }
                        outcome
                    },
                    // `--fresh` deliberately uses an in-memory store, which
                    // has no second SQLite connection to detach.
                    Err(_) => lock(&shared.engine).query(&op, context),
                };
                match outcome {
                    Ok(outcome) => {
                        #[derive(serde::Serialize)]
                        struct QueryReply<'a> {
                            complete: bool,
                            cut: Option<snapback4_core::engine::ReadCut>,
                            data: wire::Plain<'a>,
                            next: &'a Option<String>,
                            #[serde(rename = "nextExpiry")]
                            next_expiry: Option<i64>,
                            seq: u64,
                            tables: &'a [String],
                            viewer: &'a str,
                            #[serde(skip_serializing_if = "Option::is_none")]
                            meter: Option<Json>,
                        }
                        // @ref LLP 3000#7-decisions-during-execution — loopback dev returns read counters by default; releases never disclose them.
                        let meter = shared.personas.then(|| {
                            let m = outcome.metered;
                            let cut = if outcome.capped_at.is_some() { Some("meter") } else if outcome.word_cut_at.is_some() { Some("words") } else { None };
                            json!({ "examined": m.examined, "indexEntries": m.index_entries, "probes": m.rule_probes, "steps": m.steps, "heapBytes": m.heap_bytes, "outputBytes": m.output_bytes, "rowsWritten": m.rows_written, "cut": cut })
                        });
                        respond(request, 200, QueryReply { complete: outcome.complete, cut: outcome.cut, data: wire::Plain(&outcome.data), next: &outcome.next, next_expiry: outcome.next_expiry, seq: outcome.seq, tables: &outcome.tables, viewer: &viewer, meter });
                    }
                    Err(refusal) => respond(request, if refusal.retryable { 503 } else { 200 }, json!({ "denied": refusal_json(&refusal) })),
                }
            } else {
                if kind == ProgramKind::Query {
                    respond(request, 400, json!({ "denied": refusal_json(&Refusal::new("E_OP", "op", format!("{op} is a query; POST /q/{op}"))) }));
                    return;
                }
                if kind == ProgramKind::Job {
                    respond(request, 400, json!({ "denied": refusal_json(&Refusal::new("E_OP", "op", format!("{op} is a job: a schedule fires it, or `snapback4 run {op}` does; no caller can")).guide("jobs")) }));
                    return;
                }
                let id = payload.get("id").and_then(Json::as_str).map(str::to_owned);
                if let Some(ids) = payload.get("newIds").and_then(Json::as_array) {
                    context = context.with_ids(ids.iter().filter_map(Json::as_str).map(str::to_owned));
                }
                let outcome = lock(&shared.engine).mutate(&op, id.as_deref(), context.with_wire_args(args_json));
                match outcome {
                    Ok(outcome) => {
                        if let WriteState::Sent { seq, .. } = &outcome.state {
                            let mut current = lock(&shared.seq);
                            *current = (*current).max(*seq);
                            shared.committed.notify_all();
                        }
                        let body = outcome.reply(id.as_deref());
                        respond(request, 200, body);
                    }
                    Err(error) => { let refusal = error.refusal(); respond(request, mutation_error_status(&refusal), json!({ "state": "failed", "id": id, "why": refusal_json(&refusal) })) }
                }
            }
        }
        (Method::Get, "/changes") => changes::serve(request, shared, &url),
        (Method::Post, "/sync") => {
            let principal = match principal_of(&request, shared) {
                Ok(principal) => principal,
                Err(refusal) => {
                    respond(request, 401, json!({ "denied": refusal_json(&refusal) }));
                    return;
                }
            };
            let input = match serde_json::from_str::<SyncRequest>(&body) {
                Ok(input) if input.pending.len() <= 256 && input.pending.iter().all(|id| !id.is_empty() && id.len() <= 128) => input,
                _ => return respond(request, 400, json!({ "denied": refusal_json(&Refusal::new("E_INPUT", "input", "sync needs { from, limit, after, stream, pending }: nonnegative integers, a cursor or null, a boolean, and at most 256 ids of 1..128 UTF-8 bytes")) })),
            };
            let SyncRequest { from, limit, mut after, stream, pending, store_id: requested_store } = input;
            let store_id = match lock(&shared.engine).store().meta("store_id") {
                Ok(Some(id)) => id,
                _ => return respond(request, 503, json!({ "denied": refusal_json(&snapback4_core::error::RuntimeError::Store("the server store has no identity".into()).refusal()) })),
            };
            // An old snapshot cursor belongs to its database, not merely its schema.
            if requested_store.as_ref().is_some_and(|id| id != &store_id) { after = None; }
            let limit = limit.clamp(1, 10_000);
            if from == 0 && !stream {
                // `after` is the previous snapshot page's opaque `next` token.
                let (outcome, generation) = {
                    let reader = { lock(&shared.engine).reader() };
                    match reader {
                        Ok(mut reader) => {
                            let generation = reader.generation();
                            (reader.snapshot_page_with_groups_at(&principal, after.as_deref(), limit, shared.now()).and_then(|(events, watermark, next, held)| reader.acknowledged(&principal, &pending, watermark).map(|acks| (events, watermark, next, held, acks))), generation)
                        }
                        Err(_) => {
                            let mut engine = lock(&shared.engine);
                            (engine.snapshot_page_with_groups_at(&principal, after.as_deref(), limit, shared.now()).and_then(|(events, watermark, next, held)| engine.acknowledged(&principal, &pending, watermark).map(|acks| (events, watermark, next, held, acks))), *lock(&shared.generation))
                        }
                    }
                };
                match outcome {
                    Ok((events, watermark, next, held, acknowledged)) => {
                        respond(request, 200, SnapshotReply {
                            acknowledged, events: SyncEvents::Snapshot(events), generation, store_id,
                            held, more: next.is_some(), next, snapshot: true, watermark,
                        });
                    }
                    Err(error) => { let refusal = error.refusal(); respond(request, if refusal.retryable { 503 } else if refusal.code == "E_INPUT" { 400 } else { 500 }, json!({ "denied": refusal_json(&refusal) })) }
                }
            } else {
                let (outcome, generation) = {
                    let reader = { lock(&shared.engine).reader() };
                    match reader {
                        Ok(mut reader) => {
                            let generation = reader.generation();
                            (reader.stream_at(&principal, from, limit, shared.now()).and_then(|page| reader.acknowledged(&principal, &pending, page.watermark).map(|acks| (page, acks))), generation)
                        }
                        Err(_) => {
                            let mut engine = lock(&shared.engine);
                            (engine.stream_at(&principal, from, limit, shared.now()).and_then(|page| engine.acknowledged(&principal, &pending, page.watermark).map(|acks| (page, acks))), *lock(&shared.generation))
                        }
                    }
                };
                match outcome {
                    Ok((page, acknowledged)) => {
                        respond(request, 200, StreamReply {
                            acknowledged, events: SyncEvents::Stream(page.events), generation, store_id,
                            joined: page.joined, more: page.more, snapshot: false, watermark: page.watermark,
                        });
                    }
                    Err(error) => { let refusal = error.refusal(); respond(request, if refusal.retryable { 503 } else { 500 }, json!({ "denied": refusal_json(&refusal) })) }
                }
            }
        }
        (Method::Post, "/auth/session") | (Method::Post, "/auth/revoke") => {
            // An application that authenticates its own accounts (a phone
            // it verified, a directory it owns) mints their sessions through
            // its service and hands each token to that account's device.
            let service = match service_of(&request, shared) {
                Ok(service) => service,
                Err(refusal) => return respond(request, 401, json!({ "denied": refusal_json(&refusal) })),
            };
            let payload: Json = serde_json::from_str(if body.is_empty() { "{}" } else { &body }).unwrap_or(Json::Null);
            let Some(principal) = payload.get("principal").and_then(Json::as_str).map(str::to_owned) else {
                return respond(request, 400, json!({ "denied": refusal_json(&Refusal::new("E_INPUT", "input", "name the account: { \"principal\": \"member:42\" }")) }));
            };
            let now = shared.now();
            let outcome = {
                let engine = lock(&shared.engine);
                if path == "/auth/session" {
                    let kind = payload.get("kind").and_then(Json::as_str).unwrap_or("account");
                    let days = payload.get("days").and_then(Json::as_i64).unwrap_or(snapback4_core::identity::SESSION_DAYS);
                    snapback4_core::identity::custom_session(engine.store(), &principal, kind, now, days).map(|session| json!({ "session": { "principal": session.principal, "kind": session.kind, "token": session.token, "expiresAt": session.expires_at }, "by": service }))
                } else {
                    snapback4_core::identity::revoke_principal(engine.store(), &principal).map(|revoked| json!({ "revoked": revoked, "principal": principal }))
                }
            };
            match outcome {
                Ok(body) => respond(request, 200, body),
                Err(error) => respond(request, if error.is_refusal() { 200 } else { 503 }, json!({ "denied": refusal_json(&error.refusal()) })),
            }
        }
        (Method::Post, "/effects/claim") => {
            let payload: Json = serde_json::from_str(if body.is_empty() { "{}" } else { &body }).unwrap_or(Json::Null);
            let effect = payload.get("effect").and_then(Json::as_str).map(str::to_owned);
            let limit = payload.get("limit").and_then(Json::as_u64).unwrap_or(1).clamp(1, 100) as usize;
            let lease_ms = payload.get("lease").and_then(Json::as_i64).unwrap_or(60).clamp(1, 900) * 1_000;
            let wait = payload.get("wait").and_then(Json::as_u64).unwrap_or(0).min(25);
            let deadline = Instant::now() + Duration::from_secs(wait);
            loop {
                // @ref LLP 3000#7-decisions-during-execution — long effect claims reauthenticate after every wait.
                // A wait is a new authorization boundary: a token revoked or
                // expired while no work was available cannot claim work that
                // appeared afterward.
                let claimed = {
                    let mut engine = lock(&shared.engine);
                    let worker = match service_of_locked(&request, shared, &engine) {
                        Ok(worker) => worker,
                        Err(refusal) => return respond(request, 401, json!({ "denied": refusal_json(&refusal) })),
                    };
                    if shared.hold_effects { Ok(Vec::new()) }
                    else if payload.get("fenced").and_then(Json::as_bool).unwrap_or(false) { engine.claim_effects_fenced(&worker, effect.as_deref(), limit, lease_ms, shared.now()) }
                    else { engine.claim_effects(&worker, effect.as_deref(), limit, lease_ms, shared.now()) }
                };
                match claimed {
                    Ok(runs) if runs.is_empty() && Instant::now() < deadline => {
                        // Nothing due: wait for a commit (an emit), or for a
                        // backoff to pass, then look again.
                        let seq = lock(&shared.seq);
                        let remaining = deadline.saturating_duration_since(Instant::now()).min(Duration::from_secs(2));
                let _ = shared.committed.wait_timeout(seq, remaining).unwrap_or_else(|poisoned| poisoned.into_inner());
                        #[cfg(test)]
                        test_work(&shared.effect_wait);
                    }
                    Ok(runs) => return respond(request, 200, json!({ "effects": runs.iter().map(effect_json).collect::<Vec<_>>() })),
                    Err(error) => { let refusal = error.refusal(); return respond(request, if refusal.retryable { 503 } else { 500 }, json!({ "denied": refusal_json(&refusal) })) }
                }
            }
        }
        (Method::Post, path) if path.starts_with("/effects/") && path.ends_with("/cancel") => {
            if let Err(why) = service_of(&request, shared) { return respond(request, 401, json!({ "denied": why })); }
            let id = path.trim_start_matches("/effects/").trim_end_matches("/cancel");
            match lock(&shared.engine).cancel_effect(id, shared.now()) {
                Ok(run) => respond(request, 200, json!({ "ok": true, "effect": effect_json(&run) })),
                Err(error) => respond(request, if error.refusal().retryable { 503 } else { 200 }, json!({ "denied": error.refusal() })),
            }
        }
        (Method::Post, path) if path.starts_with("/effects/") && (path.ends_with("/done") || path.ends_with("/failed")) => {
            let worker = match service_of(&request, shared) {
                Ok(worker) => worker,
                Err(refusal) => return respond(request, 401, json!({ "denied": refusal_json(&refusal) })),
            };
            let id = path.trim_start_matches("/effects/").trim_end_matches("/done").trim_end_matches("/failed").to_owned();
            let payload: Json = serde_json::from_str(if body.is_empty() { "{}" } else { &body }).unwrap_or(Json::Null);
            let settled = if path.ends_with("/done") {
                let result = match payload.get("result") {
                    None | Some(Json::Null) => None,
                    Some(json) => match wire::untyped(json) {
                        Ok(value) => Some(value),
                        Err(why) => return respond(request, 400, json!({ "denied": refusal_json(&Refusal::new("E_INPUT", "input", format!("result: {why}"))) })),
                    },
                };
                snapback4_core::Settled::Done { result }
            } else {
                snapback4_core::Settled::Failed { error: payload.get("error").and_then(Json::as_str).unwrap_or("the worker failed").to_owned(), retry: payload.get("retry").and_then(Json::as_bool).unwrap_or(true) }
            };
            let token = match single_header(&request, "x-snapback-effect-lease") { Ok(token) => token, Err(()) => return respond(request, 200, json!({ "denied": Refusal::new("E_EFFECT_LEASE", "schema", "send one effect claim token") })) };
            let outcome = lock(&shared.engine).settle_effect_claim(&id, &worker, token, settled, shared.now());
            match outcome {
                Ok(run) => respond(request, 200, json!({ "ok": true, "effect": effect_json(&run) })),
                Err(error) => { let refusal = error.refusal(); respond(request, if refusal.retryable { 503 } else if refusal.code == "E_EFFECT_UNKNOWN" { 404 } else { 200 }, json!({ "denied": refusal_json(&refusal) })) }
            }
        }
        (Method::Get, "/effects") => {
            if let Err(refusal) = service_of(&request, shared) {
                return respond(request, 401, json!({ "denied": refusal_json(&refusal) }));
            }
            let params = query_params(&url);
            let state = params.get("state").cloned();
            let limit: usize = params.get("limit").and_then(|s| s.parse().ok()).unwrap_or(100);
            let outcome = lock(&shared.engine).effects(state.as_deref(), limit);
            match outcome {
                Ok(runs) => respond(request, 200, json!({ "effects": runs.iter().map(effect_json).collect::<Vec<_>>() })),
                Err(error) => { let refusal = error.refusal(); respond(request, if refusal.retryable { 503 } else { 500 }, json!({ "denied": refusal_json(&refusal) })) }
            }
        }
        (Method::Post, "/auth/guest") | (Method::Post, "/auth/signup") | (Method::Post, "/auth/login")
        | (Method::Post, "/auth/logout") | (Method::Post, "/auth/refresh") | (Method::Post, "/auth/logout-all") => {
            crate::auth::handle(request, shared, &path, &body);
        }
        (Method::Post, "/seed") => {
            if !shared.personas || !request.remote_addr().is_some_and(|a| a.ip().is_loopback()) {
                respond(request, 403, json!({ "denied": refusal_json(&Refusal::new("E_AUTH", "auth", "seeding is a development door")) }));
                return;
            }
            let rows: Vec<Json> = match serde_json::from_str(&body) {
                Ok(Json::Array(rows)) => rows,
                _ => {
                    respond(request, 400, json!({ "denied": refusal_json(&Refusal::new("E_INPUT", "input", "seed takes a JSON array of {table, row}")) }));
                    return;
                }
            };
            let schema = lock(&shared.bound).schema.clone();
            let mut typed = Vec::new();
            for entry in &rows {
                let (Some(table), Some(row)) = (entry.get("table").and_then(Json::as_str), entry.get("row")) else {
                    respond(request, 400, json!({ "denied": refusal_json(&Refusal::new("E_INPUT", "input", "each seed entry is {table, row}")) }));
                    return;
                };
                let Some(definition) = schema.table(table) else {
                    respond(request, 400, json!({ "denied": refusal_json(&Refusal::new("E_INPUT", "input", format!("unknown table {table}"))) }));
                    return;
                };
                match wire::row_from_json(definition, row) {
                    Ok(value) => typed.push((table.to_owned(), value)),
                    Err(why) => {
                        respond(request, 400, json!({ "denied": refusal_json(&Refusal::new("E_INPUT", "input", format!("{table}: {why}"))) }));
                        return;
                    }
                }
            }
            let outcome = lock(&shared.engine).seed_at(typed, shared.now());
            match outcome {
                Ok(count) => {
                    if let Ok(seq) = lock(&shared.engine).seq() {
                        let mut current = lock(&shared.seq);
                        *current = (*current).max(seq);
                        shared.committed.notify_all();
                    }
                    respond(request, 200, json!({ "seeded": count }));
                }
                Err(error) => respond(request, 200, json!({ "denied": refusal_json(&error.refusal()) })),
            }
        }
        _ => respond(request, 404, json!({ "denied": refusal_json(&Refusal::new("E_OP", "op", format!("no route {path}; operations are POST /q/<op> and POST /m/<op>"))) })),
    }
}

#[cfg(test)]
mod poison_tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::{Shutdown, TcpStream};

    #[test]
    fn a_request_after_engine_poison_still_serves() {
        let engine = Engine::memory(Default::default(), Vec::<snapback4_core::ir::Program>::new()).unwrap();
        let clock = Arc::new(Mutex::new(crate::dev_clock::Clock::new(true, 0).unwrap()));
        let shared = Arc::new(Shared {
            adoption: Mutex::new(adoption::Status::new(String::new())),
            engine: Mutex::new(engine),
            readers: Mutex::new(QueryReaders::default()),
            bound: Mutex::new(Bound { schema: Default::default(), programs: Vec::new(), personas: Vec::new(), diagnostics: Vec::new(), notes: Vec::new() }),
            generation: Mutex::new(1),
            worker_revision: AtomicUsize::new(0),
            committed: Condvar::new(),
            seq: Mutex::new(0),
            personas: true,
            hold_effects: false,
            hold_schedules: false,
            clock: clock.clone(), maintenance: Mutex::new(()),
            entropy: Mutex::new(1),
            presence: Arc::new(Live::new(clock)),
            asset_transfers: AssetTransfers::default(),
            native: Mutex::new(None),
            auth: crate::auth::Admission::default(),
            uploads: AtomicUsize::new(0),
            route_verification: routes::Verification::default(),
            auth_work: Mutex::new(None),
            upload_work: Mutex::new(None),
            effect_wait: Mutex::new(None),
        });
        let poisoned = shared.clone();
        assert!(std::thread::spawn(move || {
            let _engine = poisoned.engine.lock().unwrap();
            panic!("request panic while the engine is locked");
        }).join().is_err());
        assert!(shared.engine.is_poisoned());

        let server = tiny_http::Server::http(("127.0.0.1", 0)).unwrap();
        let address = server.server_addr().to_ip().unwrap();
        let serving = shared.clone();
        let worker = std::thread::spawn(move || {
            let request = server.recv_timeout(Duration::from_secs(5)).unwrap().expect("request");
            handle(request, &serving);
        });
        let mut stream = TcpStream::connect(address).unwrap();
        stream.write_all(b"POST /seed HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: 2\r\n\r\n[]").unwrap();
        stream.shutdown(Shutdown::Write).unwrap();
        let mut answer = String::new();
        stream.read_to_string(&mut answer).unwrap();
        worker.join().unwrap();

        assert!(answer.starts_with("HTTP/1.1 200 "), "{answer}");
        assert!(answer.contains("\"seeded\":0"), "{answer}");
        assert!(!shared.engine.is_poisoned());
    }
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct SyncRequest {
    #[serde(default)]
    from: u64,
    #[serde(default = "sync_limit")]
    limit: usize,
    #[serde(default)]
    after: Option<String>,
    #[serde(default)]
    stream: bool,
    #[serde(default)]
    pending: Vec<String>,
    #[serde(default)]
    store_id: Option<String>,
}
fn sync_limit() -> usize { 2_000 }
