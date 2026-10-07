//! A declared route authenticates each delivery before joining durable work.
//! Unverified bytes have a bounded, ephemeral ticket, never a database seat.
use super::*;
use snapback4_core::{engine::{actions::ActionRequest, routes::verification_token}, schema::{RouteSpec, routes::{RouteRequest, RouteResponse, BODY_BYTES}}, value::encode_bytes_hex};

#[path = "serve_route_verify.rs"]
mod verification;
pub(super) use verification::{claim, settle};

#[derive(Default)]
pub(super) struct Verification { tickets: Mutex<BTreeMap<String, Ticket>> }
struct Ticket {
    name: String,
    contract: String,
    generation: i64,
    envelope: RouteRequest,
    deadline: Instant,
    deadline_ms: i64,
    lease: Option<Lease>,
    outcome: Option<Verified>,
}
struct Lease { worker: String, token: String, until: Instant }
#[derive(Clone)]
enum Verified { Allowed { id: String, principal: String }, Denied, Unavailable }
struct TicketGuard<'a> { registry: &'a Verification, id: String }
impl Drop for TicketGuard<'_> {
    fn drop(&mut self) { lock(&self.registry.tickets).remove(&self.id); }
}

pub(super) fn declared(shared: &Shared, url: &str) -> Option<(String, RouteSpec)> {
    lock(&shared.bound).schema.routes.iter().find(|(_, route)| route.path == url).map(|(name, route)| (name.clone(), route.clone()))
}

fn refuse(request: Request, status: u16, code: &'static str, message: &str) {
    let mut why = Refusal::new(code, "route", message).guide("routes");
    why.retryable = status >= 500;
    respond_with_cors(request, status, json!({ "denied": why }), false);
}
fn unavailable(request: Request) {
    refuse(request, 503, "E_ROUTE_PENDING", "the route has no settled response; retry the same body");
}
fn pause(shared: &Shared, deadline: Instant) {
    let seq = lock(&shared.seq);
    let _ = shared.committed.wait_timeout(seq, deadline.saturating_duration_since(Instant::now()).min(Duration::from_millis(100))).unwrap_or_else(|p| p.into_inner());
}

/// Bearer sessions are valid on declared public routes even in dev. Personas
/// still pass through the full loopback Host/Origin/peer checks.
fn principal(request: &Request, shared: &Shared) -> Result<String, Refusal> {
    if !matches!(single_header(request, "x-snapback-persona"), Ok(None)) { return principal_of(request, shared).map(|c| c.0); }
    let token = crate::auth::bearer_token(request).map_err(|e| e.refusal())?;
    let engine = lock(&shared.engine);
    snapback4_core::identity::resolve_supervised(engine.store(), &token, snapback4_core::identity::ServiceSample { now: shared.now(), supervisor_revision: shared.worker_revision.load(Ordering::Acquire) }).map_err(|e| e.refusal())?
        .map(|(principal, _, _)| principal).ok_or_else(|| Refusal::new("E_AUTH", "auth", "a session route requires a live bearer session").guide("routes"))
}

// @ref LLP 3000.009#5.1 — every provider delivery verifies before durable admission or result collection.
pub(super) fn ingress(mut request: Request, shared: &Shared, name: &str, route: RouteSpec) {
    let deadline = Instant::now() + Duration::from_millis(route.wait_ms);
    let deadline_ms = shared.now().saturating_add(route.wait_ms as i64);
    let contract = route.contract(name);
    if route.service.is_none() && let Err(why) = principal(&request, shared) {
        return respond_with_cors(request, 401, json!({ "denied": why }), false);
    }
    // A persona is never a provider credential, even on loopback.
    if route.service.is_some() && !matches!(single_header(&request, "x-snapback-persona"), Ok(None)) {
        return refuse(request, 401, "E_ROUTE_VERIFY", "a provider route requires its signature, not a development persona");
    }
    let mut envelope = RouteRequest { method: "POST".into(), path: route.path.clone(),
        headers: request.headers().iter().map(|h| (h.field.as_str().to_string(), h.value.as_str().to_owned())).collect(), body_hex: String::new() };
    if envelope.validate(&route).is_err() { return refuse(request, 431, "E_ROUTE_INPUT", "route headers exceed their bound or are invalid"); }
    let expected = request.body_length();
    if expected.is_some_and(|n| n > BODY_BYTES) { return refuse(request, 413, "E_ROUTE_INPUT", "a route body exceeds 64 KiB"); }
    let mut bytes = Vec::new();
    let mut buffer = [0; 8192];
    loop {
        let width = buffer.len().min(BODY_BYTES - bytes.len() + 1);
        match request.as_reader().read(&mut buffer[..width]) {
            Ok(0) => break,
            Ok(n) if n > BODY_BYTES - bytes.len() => return refuse(request, 413, "E_ROUTE_INPUT", "a route body exceeds 64 KiB"),
            Ok(n) => bytes.extend_from_slice(&buffer[..n]),
            Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
            Err(_) => return refuse(request, 400, "E_ROUTE_INPUT", "the route body could not be read"),
        }
    }
    if expected.is_some_and(|n| n != bytes.len()) { return refuse(request, 400, "E_ROUTE_INPUT", "the route body ended before Content-Length"); }
    envelope.body_hex = encode_bytes_hex(&bytes);
    drop(bytes);
    if Instant::now() >= deadline || shared.now() >= deadline_ms { return unavailable(request); }
    let (mut run, principal) = if route.service.is_some() {
        let authority = lock(&shared.engine).route_service_generation(name, &contract);
        let generation = match authority {
            Ok((_, generation)) => generation, Err(_) => return unavailable(request),
        };
        let id = match verification_token() { Ok(id) => id, Err(_) => return unavailable(request) };
        {
            let mut tickets = lock(&shared.route_verification.tickets);
            if tickets.len() >= ROUTE_WORKERS { drop(tickets); return unavailable(request); }
            tickets.insert(id.clone(), Ticket { name: name.into(), contract: contract.clone(), generation, envelope,
                deadline, deadline_ms, lease: None, outcome: None });
        }
        let guard = TicketGuard { registry: &shared.route_verification, id };
        shared.durable_committed(&lock(&shared.engine));
        let (id, principal) = loop {
            let outcome = lock(&shared.route_verification.tickets).get(&guard.id).and_then(|ticket| ticket.outcome.clone());
            match outcome {
                Some(Verified::Allowed { id, principal }) => break (id, principal),
                Some(Verified::Denied) => return refuse(request, 403, "E_ROUTE_VERIFY", "the provider signature was refused"),
                Some(Verified::Unavailable) => return unavailable(request),
                None if Instant::now() >= deadline || shared.now() >= deadline_ms || crate::lifecycle::stopping() => return unavailable(request),
                None => pause(shared, deadline),
            }
        };
        drop(guard);
        let collected = lock(&shared.engine).route_request_at(name, &contract, &id, &principal, shared.now());
        match collected { Ok(run) => (run, principal), Err(_) => return unavailable(request) }
    } else {
        let principal = match principal(&request, shared) { Ok(p) => p, Err(why) => return respond_with_cors(request, 401, json!({ "denied": why }), false) };
        let mut context = Context::new(&principal, BTreeMap::new()).at(shared.now());
        if let Ok(token) = crate::auth::bearer_token(&request) { context = context.with_session(token); }
        let admitted = lock(&shared.engine).request_session_route(name, &contract, &envelope, context);
        match admitted { Ok((run, _)) => (run, principal), Err(error) => return respond_with_cors(request, if error.refusal().family == "auth" { 401 } else { 503 }, json!({ "denied": error.refusal() }), false) }
    };
    shared.durable_committed(&lock(&shared.engine));
    loop {
        if route.service.is_none() && let Err(why) = self::principal(&request, shared) {
            return respond_with_cors(request, 401, json!({ "denied": why }), false);
        }
        // Recheck even an immediately settled replay: revocation and adoption
        // must not turn a retained response into a new authority grant.
        let collected = lock(&shared.engine).route_request_at(name, &contract, &run.id, &principal, shared.now());
        run = match collected {
            Ok(run) => run, Err(_) => return unavailable(request),
        };
        if run.state == "done" { return completed(request, &run); }
        if matches!(run.state.as_str(), "failed" | "parked") || Instant::now() >= deadline || shared.now() >= deadline_ms || crate::lifecycle::stopping() { return unavailable(request); }
        pause(shared, deadline);
    }
}

fn completed(request: Request, run: &ActionRequest) {
    let response = run.result.clone().and_then(|value| serde_json::from_value::<RouteResponse>(value).ok());
    let Some(response) = response else { return unavailable(request); };
    let Ok(bytes) = response.validate() else { return unavailable(request); };
    if response.status >= 500 { return unavailable(request); }
    let mut output = Response::from_data(bytes).with_status_code(response.status);
    for (name, value) in response.headers {
        let Ok(header) = Header::from_bytes(name, value) else { return unavailable(request); };
        output.add_header(header);
    }
    // No JSON re-encoding, credential reflection or implicit CORS: headers
    // and bytes belong to the declared handler, framing to the HTTP server.
    if let Some(header) = super::latency::header() { output.add_header(header); }
    let _ = request.respond_checked_with_completion(output, |result| super::latency::finished(result.is_err()));
}
