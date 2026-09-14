//! The wire: one HTTP server over the engine. Operations are `POST /q/<op>`
//! and `POST /m/<op>` with plain JSON; a device follows `GET /sync` from its
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

#[cfg(test)]
#[path = "serve_tests.rs"]
mod tests;

pub struct Shared {
    pub engine: Mutex<Engine>,
    pub bound: Mutex<Bound>,
    pub generation: Mutex<u64>,
    /// Woken on every commit so long polls return promptly.
    pub committed: Condvar,
    pub seq: Mutex<u64>,
    /// `dev` admits loopback personas; a release refuses them.
    pub personas: bool,
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
    #[cfg(test)]
    pub auth_work: WorkHook,
    #[cfg(test)]
    pub upload_work: WorkHook,
    #[cfg(test)]
    pub effect_wait: WorkHook,
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
#[derive(Debug, Default)]
pub struct Live(Mutex<BTreeMap<String, (u32, Option<Instant>)>>);

impl Live {
    fn enter(&self, principal: &str) {
        let mut map = lock(&self.0);
        map.entry(principal.to_owned()).or_insert((0, None)).0 += 1;
    }

    fn leave(&self, principal: &str) {
        let mut map = lock(&self.0);
        if let Some(entry) = map.get_mut(principal) {
            entry.0 = entry.0.saturating_sub(1);
            entry.1 = Some(Instant::now());
        }
        map.retain(|_, (open, last)| *open > 0 || last.is_some_and(|at| at.elapsed() < PRESENCE_GRACE));
    }
}

impl Presence for Live {
    fn connections(&self, principal: &str) -> u64 {
        let map = lock(&self.0);
        match map.get(principal) {
            Some((open, _)) if *open > 0 => u64::from(*open),
            Some((_, Some(last))) if last.elapsed() < PRESENCE_GRACE => 1,
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
    Dev { watch: bool, fresh: bool },
    Release { expected: u64 },
}

pub fn serve(project: Project, port: u16, mode: Mode, bind: &str) -> Result<(), String> {
    let bound = project.compile().map_err(|e| e.to_string())?;
    if !bound.diagnostics.is_empty() {
        for diagnostic in &bound.diagnostics {
            eprintln!("{diagnostic}\n");
        }
        return Err(format!("{} problem{} in snapback/", bound.diagnostics.len(), if bound.diagnostics.len() == 1 { "" } else { "s" }));
    }
    let dev = matches!(mode, Mode::Dev { .. });
    let generated = if dev { Some(project.write_generated(&bound).map_err(|e| e.to_string())?) } else { None };
    // `--fresh`: a store in memory that dies with the process, for acceptance
    // scripts that must start from nothing every time.
    let mut engine = match &mode {
        Mode::Dev { fresh: true, .. } => Engine::memory(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())),
        Mode::Dev { .. } => project.open_engine(&bound),
        Mode::Release { expected } => project.open_release_engine(&bound, *expected),
    }.map_err(|e| e.to_string())?;
    // A native job's module (LLP 3000.005): built by `check`, in `dev` also
    // here so a fresh clone serves without a separate step.
    if dev {
        crate::native::build(&project, &bound).map_err(|p| p.to_string())?;
    }
    let installed = crate::native::install(&mut engine, &project).map_err(|p| p.to_string())?;
    let presence = Arc::new(Live::default());
    engine.set_presence(Some(presence.clone()));
    let seq = engine.seq().map_err(|e| e.to_string())?;
    let generation: u64 = engine.generation();
    let shared = Arc::new(Shared {
        engine: Mutex::new(engine), bound: Mutex::new(bound), generation: Mutex::new(generation), committed: Condvar::new(), seq: Mutex::new(seq), personas: dev, entropy: Mutex::new(snapback4_core::ids::seed()), presence, asset_transfers: AssetTransfers::default(), native: Mutex::new(installed), auth: crate::auth::Admission::default(), uploads: AtomicUsize::new(0),
        #[cfg(test)] auth_work: Mutex::new(None),
        #[cfg(test)] upload_work: Mutex::new(None),
        #[cfg(test)] effect_wait: Mutex::new(None),
    });
    let server = Server::http_with_limits((bind, port), tiny_http::ConnectionLimits::default()).map_err(|e| format!("cannot listen on {bind}:{port}: {e}"))?;
    let server = Arc::new(server);
    let address = server.server_addr();
    match &generated {
        Some(generated) => println!("snapback4 dev: http://{address}  (schema: snapback/, types: {})", generated.display()),
        None => println!("snapback4 serve: http://{address}  (release {}, generation {generation}, tokens only)", project.root.display()),
    }
    if let Mode::Dev { watch: true, .. } = mode {
        let shared = shared.clone();
        let project = Project { root: project.root.clone() };
        std::thread::spawn(move || watch_sources(project, shared));
    }
    {
        let shared = shared.clone();
        std::thread::spawn(move || maintain(shared));
    }
    // @ref LLP 3000#7-decisions-during-execution — bound HTTP admission while reserving short requests
    let admission = Arc::new(RequestAdmission::default());
    loop {
        let request = server.recv().map_err(|error| format!("HTTP listener stopped: {error}"))?;
        dispatch(request, shared.clone(), admission.clone());
    }
}

const REQUEST_WORKERS: usize = 32;
const WAIT_WORKERS: usize = 32;

#[derive(Default)]
struct RequestAdmission { short: AtomicUsize, waiters: AtomicUsize }

struct RequestPermit { admission: Arc<RequestAdmission>, waiter: bool }
impl Drop for RequestPermit {
    fn drop(&mut self) { self.admission.counter(self.waiter).fetch_sub(1, Ordering::AcqRel); }
}
impl RequestAdmission {
    fn counter(&self, waiter: bool) -> &AtomicUsize { if waiter { &self.waiters } else { &self.short } }
    fn acquire(self: &Arc<Self>, waiter: bool) -> Option<RequestPermit> {
        let limit = if waiter { WAIT_WORKERS } else { REQUEST_WORKERS };
        self.counter(waiter).fetch_update(Ordering::AcqRel, Ordering::Acquire, |n| (n < limit).then_some(n + 1)).ok()?;
        Some(RequestPermit { admission: self.clone(), waiter })
    }
}

fn dispatch(request: Request, shared: Arc<Shared>, admission: Arc<RequestAdmission>) {
    let path = request.url().split('?').next().unwrap_or("");
    let waiter = is_waiter(request.method(), path);
    let Some(permit) = admission.acquire(waiter) else { request.abort(); return; };
    std::thread::spawn(move || { let _permit = permit; handle(request, &shared); });
}

fn is_waiter(method: &Method, path: &str) -> bool {
    (method == &Method::Get && path == "/changes")
        || (method == &Method::Post && path == "/effects/claim")
}

fn watch_sources(project: Project, shared: Arc<Shared>) {
    let mut stamp = project.sources_stamp();
    loop {
        std::thread::sleep(Duration::from_millis(400));
        let now = project.sources_stamp();
        if now == stamp {
            continue;
        }
        stamp = now;
        let started = Instant::now();
        match project.compile() {
            Ok(bound) if bound.diagnostics.is_empty() => {
                let rebuilt = match crate::native::build(&project, &bound) {
                    Ok(built) => built,
                    Err(problem) => {
                        eprintln!("snapback4 dev: {problem}\nsnapback4 dev: serving the previous generation");
                        continue;
                    }
                };
                let residency_notes = snapback4_lang::bind::residency::change_notes(&bound, &lock(&shared.bound).schema.operations);
                let steps = snapback4_core::successor::classify(&lock(&shared.bound).schema, &bound.schema);
                let worst = snapback4_core::successor::worst(&steps);
                let generated = match project.write_generated(&bound) {
                    Ok(generated) => generated,
                    Err(error) => {
                        eprintln!("snapback4 dev: cannot write generated types: {error}\nsnapback4 dev: serving the previous generation");
                        continue;
                    }
                };
                let mut engine = lock(&shared.engine);
                match engine.adopt(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())) {
                    Ok(next) => {
                        if let Some(built) = &rebuilt {
                            match crate::native::install(&mut engine, &project) {
                                Ok(installed) => {
                                    *lock(&shared.native) = installed;
                                    println!("snapback4 dev: native module rebuilt ({} B, {} ms): {}", built.bytes, built.ms, built.jobs.join(", "));
                                }
                                Err(problem) => eprintln!("snapback4 dev: {problem}"),
                            }
                        }
                        // Publish the advertised backend and identity together:
                        // /schema takes these guards in the same order.
                        let mut active = lock(&shared.bound);
                        let mut generation = lock(&shared.generation);
                        for note in &residency_notes { println!("note: {note}"); }
                        for note in &bound.notes { println!("note: {note}"); }
                        *active = bound;
                        *generation = next;
                        println!("snapback4 dev: schema adopted as generation {} ({:?}) in {} ms; types: {}", *generation, worst, started.elapsed().as_millis(), generated.display());
                        for step in steps {
                            println!("  {:?}: {}", step.change, step.message);
                        }
                        shared.committed.notify_all();
                    }
                    Err(error) => {
                        eprintln!("snapback4 dev: the new schema was not adopted: {error}")
                    }
                }
            }
            Ok(bound) => {
                eprintln!("snapback4 dev: {} problem{} in snapback/; serving the previous generation", bound.diagnostics.len(), if bound.diagnostics.len() == 1 { "" } else { "s" });
                for diagnostic in &bound.diagnostics {
                    eprintln!("{diagnostic}\n");
                }
            }
            Err(error) => eprintln!("snapback4 dev: cannot read snapback/: {error}"),
        }
    }
}

/// The server's own clock, once a second: rows past their `expire` column
/// are swept, so the deletion reaches every device that holds them
/// (readers never see an expired row in the meantime; this is the purge);
/// schedules whose boundary passed queue their jobs, so a digest lands
/// within a second of its boundary; queued jobs run a chunk at a time,
/// the engine free for requests between chunks; and once a minute,
/// released and abandoned uploads leave the disk. A quiet tick is a few
/// index probes under the lock.
fn maintain(shared: Arc<Shared>) {
    let mut tick: u64 = 0;
    loop {
        std::thread::sleep(Duration::from_secs(1));
        tick += 1;
        let now = snapback4_core::now_ms();
        let swept = lock(&shared.engine).sweep_expired(now, 2_000);
        match swept {
            Ok(0) => {}
            Ok(_) => bump_seq(&shared),
            Err(error) => eprintln!("snapback4: the expiry sweep failed: {error}"),
        }
        match lock(&shared.engine).fire_schedules(now) {
            Ok(fired) => {
                for name in fired {
                    println!("snapback4: schedule {name} fired");
                }
            }
            Err(error) => eprintln!("snapback4: schedules failed: {error}"),
        }
        let mut budget = 500;
        while budget > 0 {
            budget -= 1;
            let ran = lock(&shared.engine).run_job_chunk(snapback4_core::now_ms());
            match ran {
                Ok(None) => break,
                Ok(Some(run)) => {
                    bump_seq(&shared);
                    for line in lock(&shared.engine).take_native_logs() {
                        println!("snapback4: native {line}");
                    }
                    match run.state {
                        snapback4_core::JobState::Done => println!("snapback4: job {} done: {} chunk{}, {} row{} written", run.name, run.chunks, if run.chunks == 1 { "" } else { "s" }, run.rows_written, if run.rows_written == 1 { "" } else { "s" }),
                        snapback4_core::JobState::Parked => eprintln!("snapback4: job {} parked after {} chunks: {}", run.name, run.chunks, run.error.as_deref().unwrap_or("")),
                        _ => {}
                    }
                    // Give waiting request threads a scheduling point between
                    // chunks in a large background run.
                    std::thread::yield_now();
                }
                Err(error) => {
                    eprintln!("snapback4: job failed: {error}");
                    break;
                }
            }
        }
        if tick % 5 == 0 {
            let requeued = lock(&shared.engine).requeue_expired_effects(now);
            match requeued {
                Ok(0) => {}
                Ok(n) => {
                    println!("snapback4: {n} effect lease{} expired; queued again", if n == 1 { "" } else { "s" });
                    shared.committed.notify_all();
                }
                Err(error) => eprintln!("snapback4: the effect lease sweep failed: {error}"),
            }
        }
        if tick % 60 == 0 {
            let prepared = lock(&shared.engine).prepare_asset_sweep(now);
            match prepared {
                Ok(sweep) => match sweep.remove_files() {
                    Ok(()) => {
                        if let Err(error) = lock(&shared.engine).finish_asset_sweep(&sweep) {
                            eprintln!("snapback4: the asset sweep catalog update failed: {error}");
                        }
                    }
                    Err(error) => eprintln!("snapback4: the asset file sweep failed: {error}"),
                },
                Err(error) => eprintln!("snapback4: the asset sweep failed: {error}"),
            }
        }
    }
}

/// A worker's seat: a bearer session of a service principal.
fn service_of(request: &Request, shared: &Shared) -> Result<String, Refusal> {
    let principal = principal_of(request, shared)?;
    if !snapback4_core::identity::is_service(&principal) {
        return Err(Refusal::new("E_AUTH", "auth", "this is a worker's door: send a service token (`snapback4 token --service <name>`)").guide("effects"));
    }
    Ok(principal)
}

fn effect_json(run: &snapback4_core::EffectRun) -> Json {
    json!({ "id": run.id, "effect": run.effect, "payload": wire::to_json(&run.payload), "state": run.state, "attempt": run.attempts, "seq": run.seq, "at": run.at, "nextAt": run.next_at, "leaseUntil": run.lease_until, "result": run.result.as_ref().map(wire::to_json), "error": run.error })
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
        Header::from_bytes("Access-Control-Allow-Headers", "content-type, x-snapback-persona, authorization, range").unwrap(),
        Header::from_bytes("Access-Control-Allow-Methods", "GET, POST, OPTIONS").unwrap(),
    ];
    if let Ok(Some(origin)) = single_header(request, "origin") && origin_authority(origin).is_some() {
        headers.push(Header::from_bytes("Access-Control-Allow-Origin", origin).unwrap());
    }
    headers
}

const JSON_REQUEST_CEILING: usize = 1 << 20;
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
        return match snapback4_core::identity::resolve(engine.store(), &token, snapback4_core::now_ms()) {
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

fn handle(mut request: Request, shared: &Shared) {
    let method = request.method().clone();
    let url = request.url().to_owned();
    let path = url.split('?').next().unwrap_or("").to_owned();
    if let Err(refusal) = dev_request(&request, shared) {
        respond_with_cors(request, 403, json!({ "denied": refusal_json(&refusal) }), false);
        return;
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
    if method == Method::Post && (path == "/assets" || path.starts_with("/q/") || path.starts_with("/m/")
        || matches!(path.as_str(), "/auth/refresh" | "/auth/logout" | "/auth/logout-all")) {
        if let Err(refusal) = principal_of(&request, shared) {
            return respond(request, 401, json!({ "denied": refusal_json(&refusal) }));
        }
    }
    if method == Method::Post && (matches!(path.as_str(), "/auth/session" | "/auth/revoke") || path.starts_with("/effects/")) {
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
        (Method::Get, "/probe") => match principal_of(&request, shared) {
            Ok(_) => respond(request, 200, json!({ "ok": true })),
            Err(refusal) => respond(request, 401, json!({ "denied": refusal_json(&refusal) })),
        },
        (Method::Get, "/auth/config") => {
            let auth = lock(&shared.bound).schema.auth.clone();
            respond(request, 200, json!({ "guests": auth.guests, "password": auth.password }));
        }
        (Method::Get, "/") => {
            let body = {
                let bound = lock(&shared.bound);
                let ops: Vec<Json> = bound.programs.iter().map(|p| json!({ "name": p.program.name, "kind": p.program.kind.word() })).collect();
                let tables: Vec<Json> = bound.schema.tables.iter().map(|(name, table)| json!({ "name": name, "sync": table.sync.as_ref().map(|s| s.line()) })).collect();
                json!({ "snapback4": env!("CARGO_PKG_VERSION"), "generation": *lock(&shared.generation), "seq": *lock(&shared.seq), "ops": ops, "tables": tables })
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
            let replay = if path.starts_with("/m/") {
                payload.get("id").and_then(Json::as_str).and_then(|id| lock(&shared.engine).replay(&principal, id).ok().flatten().map(|outcome| (id, outcome)))
            } else { None };
            if let Some((id, outcome)) = replay {
                // A resend of an applied write: its recorded outcome, before the
                // current generation gets to judge its shape.
                let body = match outcome.state {
                    WriteState::Sent { seq, result } => {
                        json!({ "state": "sent", "id": id, "seq": seq, "result": wire::to_json(&result), "replayed": true })
                    }
                    WriteState::Failed { why, current } => {
                        json!({ "state": "failed", "id": id, "why": refusal_json(&why), "current": current.map(|c| wire::to_json(&c)), "replayed": true })
                    }
                };
                respond(request, 200, body);
                return;
            }
            let program = lock(&shared.bound).programs.iter().find(|p| p.program.name == op).map(|p| p.program.clone());
            let Some(program) = program else {
                respond(request, 404, json!({ "denied": refusal_json(&Refusal::new("E_OP", "op", format!("unknown operation {op}")).guide("programs")) }));
                return;
            };
            let mut args = BTreeMap::new();
            if let Json::Object(fields) = &args_json {
                for (name, value) in fields {
                    match program.args.get(name) {
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
            let mut context = Context::new(principal, args);
            if path.starts_with("/q/") {
                if program.kind != ProgramKind::Query {
                    respond(request, 400, json!({ "denied": refusal_json(&Refusal::new("E_OP", "op", format!("{op} is a mutation; POST /m/{op}"))) }));
                    return;
                }
                let reader = { lock(&shared.engine).reader() };
                let outcome = match reader {
                    Ok(mut reader) => reader.query(&op, context),
                    // `--fresh` deliberately uses an in-memory store, which
                    // has no second SQLite connection to detach.
                    Err(_) => lock(&shared.engine).query(&op, context),
                };
                match outcome {
                    // The meter's numbers and its cut site stay off the wire: they
                    // measure hidden rows. `complete` is the one word.
                    Ok(outcome) => {
                        #[derive(serde::Serialize)]
                        struct QueryReply<'a> {
                            complete: bool,
                            data: wire::Plain<'a>,
                            next: &'a Option<String>,
                            #[serde(rename = "nextExpiry")]
                            next_expiry: Option<i64>,
                            seq: u64,
                            tables: &'a [String],
                            viewer: &'a str,
                        }
                        respond(request, 200, QueryReply { complete: outcome.complete, data: wire::Plain(&outcome.data), next: &outcome.next, next_expiry: outcome.next_expiry, seq: outcome.seq, tables: &outcome.tables, viewer: &viewer });
                    }
                    Err(refusal) => respond(request, if refusal.retryable { 503 } else { 200 }, json!({ "denied": refusal_json(&refusal) })),
                }
            } else {
                if program.kind == ProgramKind::Query {
                    respond(request, 400, json!({ "denied": refusal_json(&Refusal::new("E_OP", "op", format!("{op} is a query; POST /q/{op}"))) }));
                    return;
                }
                if program.kind == ProgramKind::Job {
                    respond(request, 400, json!({ "denied": refusal_json(&Refusal::new("E_OP", "op", format!("{op} is a job: a schedule fires it, or `snapback4 run {op}` does; no caller can")).guide("jobs")) }));
                    return;
                }
                let id = payload.get("id").and_then(Json::as_str).map(str::to_owned);
                if let Some(ids) = payload.get("newIds").and_then(Json::as_array) {
                    context = context.with_ids(ids.iter().filter_map(Json::as_str).map(str::to_owned));
                }
                let outcome = lock(&shared.engine).mutate(&op, id.as_deref(), context);
                match outcome {
                    Ok(outcome) => {
                        if let WriteState::Sent { seq, .. } = &outcome.state {
                            *lock(&shared.seq) = *seq;
                            shared.committed.notify_all();
                        }
                        let body = match outcome.state {
                            WriteState::Sent { seq, result } => {
                                json!({ "state": "sent", "id": id, "seq": seq, "result": wire::to_json(&result) })
                            }
                            WriteState::Failed { why, current } => {
                                json!({ "state": "failed", "id": id, "why": refusal_json(&why), "current": current.map(|c| wire::to_json(&c)) })
                            }
                        };
                        respond(request, 200, body);
                    }
                    Err(error) => { let refusal = error.refusal(); respond(request, if refusal.retryable { 503 } else { 500 }, json!({ "state": "failed", "id": id, "why": refusal_json(&refusal) })) }
                }
            }
        }
        (Method::Get, "/changes") => {
            let params = query_params(&url);
            let since: u64 = params.get("since").and_then(|s| s.parse().ok()).unwrap_or(0);
            let wait: u64 = params.get("wait").and_then(|s| s.parse().ok()).unwrap_or(0).min(25);
            let deadline = Instant::now() + Duration::from_secs(wait);
            // A poll held open is a connection: `connected[p]` counts it
            // while it waits, and for a grace after it answers.
            let connected = match principal_of(&request, shared) {
                Ok(principal) => principal,
                Err(refusal) => return respond(request, 401, json!({ "denied": refusal_json(&refusal) })),
            };
            shared.presence.enter(&connected);
            {
                let mut seq = lock(&shared.seq);
                while *seq <= since && Instant::now() < deadline {
                    let remaining = deadline.saturating_duration_since(Instant::now());
                    let (guard, _) = shared.committed.wait_timeout(seq, remaining).unwrap_or_else(|poisoned| poisoned.into_inner());
                    seq = guard;
                }
            }
            shared.presence.leave(&connected);
            if let Err(refusal) = principal_of(&request, shared) {
                return respond(request, 401, json!({ "denied": refusal_json(&refusal) }));
            }
            let reader = { lock(&shared.engine).reader() };
            let changes = match reader {
                Ok(mut reader) => reader.changes(since, 500),
                Err(_) => lock(&shared.engine).changes(since, 500),
            };
            match changes {
                Ok(changes) => {
                    let seq = changes.last().map(|(seq, _)| *seq).unwrap_or(since);
                    let mut tables: Vec<String> = changes.into_iter().flat_map(|(_, tables)| tables).collect();
                    tables.sort();
                    tables.dedup();
                    let generation = *lock(&shared.generation);
                    respond(request, 200, json!({ "seq": seq, "tables": tables, "generation": generation }));
                }
                Err(error) => { let refusal = error.refusal(); respond(request, if refusal.retryable { 503 } else { 500 }, json!({ "denied": refusal_json(&refusal) })) }
            }
        }
        (Method::Get, "/sync") => {
            let principal = match principal_of(&request, shared) {
                Ok(principal) => principal,
                Err(refusal) => {
                    respond(request, 401, json!({ "denied": refusal_json(&refusal) }));
                    return;
                }
            };
            let params = query_params(&url);
            let from: u64 = params.get("from").and_then(|s| s.parse().ok()).unwrap_or(0);
            let limit: usize = params.get("limit").and_then(|s| s.parse().ok()).unwrap_or(2_000).min(10_000);
            let pending: Vec<String> = match params.get("pending").map(|s| serde_json::from_str::<Vec<String>>(s)).transpose() {
                Ok(ids) if ids.as_ref().is_none_or(|ids| ids.len() <= 256 && ids.iter().all(|id| id.len() <= 128)) => ids.unwrap_or_default(),
                _ => { respond(request, 400, json!({ "denied": refusal_json(&Refusal::new("E_INPUT", "input", "sync pending must contain at most 256 short ids")) })); return; }
            };
            if from == 0 && params.get("stream").is_none_or(|value| value != "1") {
                // A snapshot comes in pages: `after` is the token the previous
                // page returned; `next` is the one for the following page.
                let after = params.get("after").cloned();
                let (outcome, generation) = {
                    let reader = { lock(&shared.engine).reader() };
                    match reader {
                        Ok(mut reader) => {
                            let generation = reader.generation();
                            (reader.snapshot_page(&principal, after.as_deref(), limit).and_then(|(events, watermark, next)| reader.acknowledged(&principal, &pending, watermark).map(|acks| (events, watermark, next, acks))), generation)
                        }
                        Err(_) => {
                            let mut engine = lock(&shared.engine);
                            (engine.snapshot_page(&principal, after.as_deref(), limit).and_then(|(events, watermark, next)| engine.acknowledged(&principal, &pending, watermark).map(|acks| (events, watermark, next, acks))), *lock(&shared.generation))
                        }
                    }
                };
                match outcome {
                    Ok((events, watermark, next, acknowledged)) => {
                        let events: Vec<Json> = events.into_iter().map(|e| json!({ "table": e.table, "kind": e.kind.word(), "id": e.id, "data": e.data.as_ref().map(wire::to_json) })).collect();
                        respond(request, 200, json!({ "snapshot": true, "events": events, "watermark": watermark, "more": next.is_some(), "next": next, "generation": generation, "acknowledged": acknowledged }));
                    }
                    Err(error) => { let refusal = error.refusal(); respond(request, if refusal.retryable { 503 } else if refusal.code == "E_INPUT" { 400 } else { 500 }, json!({ "denied": refusal_json(&refusal) })) }
                }
            } else {
                let (outcome, generation) = {
                    let reader = { lock(&shared.engine).reader() };
                    match reader {
                        Ok(mut reader) => {
                            let generation = reader.generation();
                            (reader.stream(&principal, from, limit).and_then(|page| reader.acknowledged(&principal, &pending, page.watermark).map(|acks| (page, acks))), generation)
                        }
                        Err(_) => {
                            let mut engine = lock(&shared.engine);
                            (engine.stream(&principal, from, limit).and_then(|page| engine.acknowledged(&principal, &pending, page.watermark).map(|acks| (page, acks))), *lock(&shared.generation))
                        }
                    }
                };
                match outcome {
                    Ok((page, acknowledged)) => {
                        let events: Vec<Json> = page.events.into_iter().map(|e| json!({ "seq": e.seq, "table": e.table, "kind": e.kind, "id": e.id, "data": e.data.as_ref().map(wire::to_json) })).collect();
                        respond(request, 200, json!({ "snapshot": false, "events": events, "watermark": page.watermark, "more": page.more, "generation": generation, "acknowledged": acknowledged }));
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
            let now = snapback4_core::now_ms();
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
                let worker = match service_of(&request, shared) {
                    Ok(worker) => worker,
                    Err(refusal) => return respond(request, 401, json!({ "denied": refusal_json(&refusal) })),
                };
                let claimed = lock(&shared.engine).claim_effects(&worker, effect.as_deref(), limit, lease_ms, snapback4_core::now_ms());
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
            let outcome = lock(&shared.engine).settle_effect(&id, &worker, settled, snapback4_core::now_ms());
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
            let outcome = lock(&shared.engine).seed(typed);
            match outcome {
                Ok(count) => {
                    if let Ok(seq) = lock(&shared.engine).seq() {
                        *lock(&shared.seq) = seq;
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
        let shared = Arc::new(Shared {
            engine: Mutex::new(engine),
            bound: Mutex::new(Bound { schema: Default::default(), programs: Vec::new(), personas: Vec::new(), diagnostics: Vec::new(), notes: Vec::new() }),
            generation: Mutex::new(1),
            committed: Condvar::new(),
            seq: Mutex::new(0),
            personas: true,
            entropy: Mutex::new(1),
            presence: Arc::new(Live::default()),
            asset_transfers: AssetTransfers::default(),
            native: Mutex::new(None),
            auth: crate::auth::Admission::default(),
            uploads: AtomicUsize::new(0),
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
