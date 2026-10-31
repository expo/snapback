//! HTTP identity admission. Password work owns a bounded KDF slot, never
//! the engine guard. Rate keys use the socket peer; behind a declared
//! `--trusted-proxy` they use the forwarded client instead (trusted_proxies.rs).
use crate::serve::{Shared, refusal_json, respond_timed};
use serde_json::{Value as Json, json};
use sha2::{Digest, Sha256};
use snapback4_core::error::Refusal;
use snapback4_core::{RuntimeError, identity};
use std::collections::HashMap;
use std::sync::{
    Mutex,
    atomic::{AtomicUsize, Ordering},
};
use std::time::{Duration, Instant};
use tiny_http::Request;

pub const BODY_CEILING: usize = 4096;
const WINDOW: Duration = Duration::from_secs(60);
const KEYS: usize = 4096;

pub struct Admission {
    attempts: Mutex<HashMap<String, (Instant, u32)>>,
    kdfs: AtomicUsize,
    dev_kdf_slots: usize,
}
impl Default for Admission {
    fn default() -> Self {
        // @ref LLP 3000.007#14 — ruling 9: dev loopback KDF work fits the host, bounded at 2–16 slots
        let dev_kdf_slots = std::thread::available_parallelism().map(|n| n.get().clamp(2, 16)).unwrap_or(2);
        Self { attempts: Mutex::new(HashMap::new()), kdfs: AtomicUsize::new(0), dev_kdf_slots }
    }
}
impl Admission {
    pub fn kdf_slots(&self, dev_loopback: bool) -> usize {
        if dev_loopback { self.dev_kdf_slots } else { 2 }
    }

    fn attempt(&self, peer: &str, email: Option<&str>, now: Instant) -> bool {
        let mut attempts = self.attempts.lock().unwrap();
        attempts.retain(|_, (start, _)| now.duration_since(*start) < WINDOW);
        let mut keys = vec![(format!("ip:{peer}"), 30)];
        if let Some(email) = email {
            keys.push((format!("email:{}", identity::normalized_email(email)), 10));
        }
        // Charge every attempt, including denials. A full table refuses new
        // keys until expiry rather than evicting a key under attack.
        let mut admitted = true;
        for (key, limit) in keys {
            // A peer that is already over budget may charge existing email
            // keys, but cannot fill the shared map by rotating fresh emails.
            if !admitted && !attempts.contains_key(&key) {
                continue;
            }
            if !attempts.contains_key(&key) && attempts.len() >= KEYS {
                admitted = false;
                continue;
            }
            let (_, count) = attempts.entry(key).or_insert((now, 0));
            *count = count.saturating_add(1);
            admitted &= *count <= limit;
        }
        admitted
    }
    fn kdf(&self, dev_loopback: bool) -> Option<Kdf<'_>> {
        let slots = self.kdf_slots(dev_loopback);
        self.kdfs
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |n| {
                (n < slots).then_some(n + 1)
            })
            .ok()?;
        Some(Kdf(&self.kdfs))
    }
}
struct Kdf<'a>(&'a AtomicUsize);
impl Drop for Kdf<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::Release);
    }
}
fn limited(request: Request, shared: &Shared) {
    let mut refusal = Refusal::new(
        "E_RATE_LIMIT",
        "auth",
        "too many identity requests; honor Retry-After/retryAfterMs. Scripted staging setup should use seedAccounts, which waits. Local dev loopback has no per-minute identity cap; serialize password requests to stay within its bounded KDF slots. Production/staging keep their real limits (30 attempts/peer/minute, 10/email/minute)",
    )
    .guide("personas");
    refusal.retryable = true;
    let mut denied=refusal_json(&refusal);
    denied["retryAfterMs"]=json!(WINDOW.as_millis() as u64);
    crate::serve::respond_with_headers(request, shared, 429, json!({ "denied": denied }),vec![
        tiny_http::Header::from_bytes("Retry-After",WINDOW.as_secs().to_string()).unwrap(),
        tiny_http::Header::from_bytes("Access-Control-Expose-Headers","Retry-After").unwrap(),
    ]);
}

pub fn handle(request: Request, shared: &Shared, path: &str, body: &str) {
    let payload: Json = match serde_json::from_str(if body.is_empty() { "{}" } else { body }) {
        Ok(value) => value,
        Err(_) => {
            return respond_timed(request, shared,
                400,
                json!({ "denied": Refusal::new("E_INPUT", "input", "identity takes a JSON object") }),
            );
        }
    };
    let email = payload.get("email").and_then(Json::as_str).unwrap_or("");
    let password = payload.get("password").and_then(Json::as_str).unwrap_or("");
    let password_route = matches!(path, "/auth/login" | "/auth/signup");
    // @ref LLP 3000.007#8 — the rate key names the client: the socket peer, or behind a declared proxy the forwarded hop
    let peer = shared.trusted_proxies.rate_key(&request);
    let rate_route = matches!(path, "/auth/login" | "/auth/signup" | "/auth/guest");
    // @ref LLP 3000.007#8 — dev loopback has no minute counters; KDF slots remain
    let dev_loopback = shared.personas && request.remote_addr().is_some_and(|peer| peer.ip().is_loopback());
    if rate_route && !dev_loopback
        && !shared
            .auth
            .attempt(&peer, password_route.then_some(email), Instant::now())
    {
        return limited(request, shared);
    }
    let kdf = if password_route {
        match shared.auth.kdf(dev_loopback) {
            Some(permit) => Some(permit),
            None => return limited(request, shared),
        }
    } else {
        None
    };
    let scope = match payload.get("scope") {
        None => Ok(identity::SessionScope::Full),
        Some(Json::String(value)) if value == "full" => Ok(identity::SessionScope::Full),
        Some(Json::String(value)) if value == "read" => Ok(identity::SessionScope::Read),
        _ => Err(RuntimeError::Input("scope must be full or read".into())),
    };
    let outcome = scope.and_then(|scope| perform(&request, shared, path, email, password, scope));
    drop(kdf);
    match outcome {
        Ok(Outcome::Refused(why)) => respond_refused(request, shared, why),
        Ok(Outcome::SupervisedRefresh) => respond_timed(request, shared, 403, json!({ "denied": refusal_json(&Refusal::new(
            "E_WORKER_REFRESH", "auth", "supervised worker tokens are rotated by the supervisor; keep using the injected token",
        ).guide("effects")) })),
        Ok(Outcome::Logout) => respond_timed(request, shared, 200, json!({ "ok": true })),
        Ok(Outcome::LogoutAll(revoked)) => {
            respond_timed(request, shared, 200, json!({ "ok": true, "revoked": revoked }))
        }
        Ok(Outcome::Deleted(principal, revoked)) => {
            respond_timed(request, shared, 200, json!({ "ok": true, "deleted": principal, "revoked": revoked }))
        }
        Ok(Outcome::Session(session)) => {
            let mut wire = json!({ "principal": session.principal, "kind": session.kind, "token": session.token, "expiresAt": session.expires_at, "scope": session.scope });
            if let Some(cap) = session.cap_expires_at { wire["capExpiresAt"] = json!(cap); }
            respond_timed(request, shared, 200, json!({ "session": wire }));
        },
        Err(error) => {
            if matches!(path, "/auth/logout" | "/auth/narrow" | "/auth/refresh" | "/auth/logout-all" | "/auth/delete")
                && let RuntimeError::Auth(message) = &error {
                return respond_refused(request, shared, Refusal::new("E_AUTH", "auth", message).guide("personas"));
            }
            let status = error_status(&error);
            respond_timed(request, shared, status, json!({ "denied": refusal_json(&error.refusal()) }));
        }
    }
}

enum Outcome {
    Refused(Refusal),
    Session(identity::Session),
    SupervisedRefresh,
    Logout,
    LogoutAll(u64),
    /// The account is gone: its principal, and how many sessions ended with it.
    Deleted(String, u64),
}

pub(crate) fn error_status(error: &RuntimeError) -> u16 {
    if error.code() == "E_RATE_LIMIT" { 503 }
    else if matches!(error, RuntimeError::Auth(_)) { 401 }
    else if error.is_refusal() { 200 } else { 503 }
}

// @ref LLP 3000.007#20.2 — identity operations preserve the same refusal envelope as data doors.
fn respond_refused(request: Request, shared: &Shared, why: Refusal) {
    respond_timed(request, shared, if why.retryable { 503 } else { 401 }, json!({ "denied": refusal_json(&why) }));
}

fn refused_bearer(trusted: bool, shared: &Shared, engine: &snapback4_core::Engine, token: &str) -> Outcome {
    Outcome::Refused(identity::diagnostics::refused(engine.store(), token, shared.now(), trusted))
}

/// Translate only after the identity operation's own transactional check failed.
/// A still-live but wrong-kind credential keeps its endpoint-specific explanation.
fn credential_result(trusted: bool, shared: &Shared, engine: &snapback4_core::Engine, token: &str,
    result: Result<Outcome, RuntimeError>) -> Result<Outcome, RuntimeError> {
    match result {
        Err(RuntimeError::Auth(message)) => {
            let sample = identity::ServiceSample { now: shared.now(), supervisor_revision: shared.worker_revision.load(Ordering::Acquire) };
            if identity::resolve_supervised(engine.store(), token, sample)?.is_none() {
                Ok(refused_bearer(trusted, shared, engine, token))
            } else { Ok(Outcome::Refused(Refusal::new("E_AUTH", "auth", message).guide("personas"))) }
        }
        result => result,
    }
}

// RFC 7235: the authentication scheme is case-insensitive. Accept HTTP
// whitespace consistently at every entry, including detached poll rechecks.
pub(crate) fn parse_bearer(value: &str) -> Option<&str> {
    let mut words = value.split_ascii_whitespace();
    let scheme = words.next()?;
    let token = words.next()?;
    (scheme.eq_ignore_ascii_case("Bearer") && words.next().is_none()).then_some(token)
}

pub(crate) fn bearer_token(request: &impl crate::serve::RequestInfo) -> Result<&str, RuntimeError> {
    let mut headers = request
        .headers()
        .iter()
        .filter(|header| header.field.equiv("authorization"));
    let value = headers.next().ok_or_else(|| {
        RuntimeError::Auth("this identity operation needs the bearer token".into())
    })?;
    if headers.next().is_some() {
        return Err(RuntimeError::Auth(
            "send exactly one Authorization header".into(),
        ));
    }
    parse_bearer(value.value.as_str())
        .ok_or_else(|| RuntimeError::Auth("send Authorization: Bearer <token>".into()))
}

fn enabled(engine: &snapback4_core::Engine, path: &str) -> Result<(), RuntimeError> {
    let auth = &engine.schema().auth;
    if (path == "/auth/guest" && !auth.guests) || (matches!(path, "/auth/signup" | "/auth/login") && !auth.password) {
        Err(RuntimeError::Auth("this identity method is not enabled in schema.q".into()))
    } else { Ok(()) }
}

fn perform(
    request: &Request,
    shared: &Shared,
    path: &str,
    email: &str,
    password: &str,
    scope: identity::SessionScope,
) -> Result<Outcome, RuntimeError> {
    let path = path.to_owned();
    let check_path = path.clone();
    shared.engine.attempt(move |engine, _| enabled(engine, &check_path))?;
    let trusted = crate::serve::trusted_dev_request(request, shared);
    match path.as_str() {
        "/auth/signup" => {
            #[cfg(test)] crate::serve::test_work(&shared.auth_work);
            let prepared = identity::prepare_signup(email, password)?;
            shared.engine.attempt(move |engine, shared| {
                enabled(engine, &path)?;
                identity::finish_signup_scoped(engine.store(), prepared, shared.now(), &mut shared.entropy.lock().unwrap(), scope).map(Outcome::Session)
            })
        }
        "/auth/login" => {
            identity::password_bound(password)?;
            let email = email.to_owned();
            let found = shared.engine.attempt(move |engine, _| {
                enabled(engine, "/auth/login")?;
                identity::credential(engine.store(), &email)
            })?;
            #[cfg(test)] crate::serve::test_work(&shared.auth_work);
            identity::verify_password(found.as_ref(), password)?;
            shared.engine.attempt(move |engine, shared| {
                enabled(engine, "/auth/login")?;
                identity::finish_login_scoped(engine.store(), found.expect("verified account"), shared.now(), scope).map(Outcome::Session)
            })
        }
        "/auth/guest" => shared.engine.attempt(move |engine, shared| {
            enabled(engine, "/auth/guest")?;
            identity::guest_scoped(engine.store(), shared.now(), &mut shared.entropy.lock().unwrap(), scope).map(Outcome::Session)
        }),
        "/auth/logout-all" => {
            let admission = crate::serve::session_identity::Admission::capture(request, shared);
            shared.engine.attempt(move |engine, shared| {
                let principal = match admission.and_then(|admission| admission.resolve(shared, engine)) {
                    Ok(principal) => principal,
                    Err(why) => return Ok(Outcome::Refused(why)),
                };
                identity::revoke_principal(engine.store(), &principal.0).map(Outcome::LogoutAll)
            })
        }
        _ => {
            let token = bearer_token(request)?.to_owned();
            shared.engine.attempt(move |engine, shared| {
                let result = match path.as_str() {
                    "/auth/narrow" => identity::narrow_session(engine.store_mut(), &token, || identity::ServiceSample {
                        now: shared.now(), supervisor_revision: shared.worker_revision.load(Ordering::Acquire),
                    }).map(Outcome::Session),
                    "/auth/refresh" => {
                        let sample = identity::ServiceSample { now: shared.now(), supervisor_revision: shared.worker_revision.load(Ordering::Acquire) };
                        if identity::resolve_supervised(engine.store(), &token, sample)?.is_none() {
                            return Ok(refused_bearer(trusted, shared, engine, &token));
                        }
                        // @ref LLP 3000.009#5.3 — supervised families cannot escape the supervisor's redactors through refresh.
                        if identity::is_supervised_family(engine.store(), &format!("{:x}", Sha256::digest(token.as_bytes())))? {
                            return Ok(Outcome::SupervisedRefresh);
                        }
                        #[cfg(test)] crate::serve::test_work(&shared.auth_work);
                        identity::rotate_session(engine.store(), &token, shared.now()).map(|session| session.map(Outcome::Session).unwrap_or_else(|| refused_bearer(trusted, shared, engine, &token)))
                    }
                    // @ref LLP 3000.009#5.1 — deletion is logout-all plus the credential and principal rows, in one store transaction.
                    "/auth/delete" => identity::delete_account(engine.store(), &token, shared.now()).map(|(principal, revoked)| Outcome::Deleted(principal, revoked)),
                    _ => identity::logout_session(engine.store_mut(), &token, || shared.now()).map(|()| Outcome::Logout),
                };
                credential_result(trusted, shared, engine, &token, result)
            })
        }
    }

}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bearer_padding_matches_sdk_read_token_predicate() {
        // Keep these boundary vectors paired with read-only-round7.test.mjs.
        for padding in [" ", "\t", "\n", "\x0c", "\r", " \t\n\x0c\r "] {
            let header = format!("Bearer {padding}ro.reader{padding}");
            assert_eq!(parse_bearer(&header), Some("ro.reader"));
        }
        for padding in ["\x0b", "\u{0085}", "\u{00a0}", "\u{2003}", "\u{feff}"] {
            let token = format!("{padding}ro.reader{padding}");
            let header = format!("Bearer {token}");
            assert_eq!(parse_bearer(&header), Some(token.as_str()));
            assert!(!parse_bearer(&header).unwrap().starts_with("ro."));
        }
        assert_eq!(parse_bearer("Bearer ro.reader extra"), None);
    }

    #[test]
    fn rate_keys_expire_and_rotation_does_not_bypass_limits() {
        let a = Admission::default();
        let now = Instant::now();
        for _ in 0..10 {
            assert!(a.attempt("1", Some(" A@EXAMPLE.COM "), now));
        }
        assert!(!a.attempt("2", Some("a@example.com"), now));
        for _ in 0..20 {
            assert!(a.attempt("1", None, now));
        }
        assert!(!a.attempt("1", Some("another@example.com"), now));
        assert!(a.attempt("1", Some("a@example.com"), now + WINDOW));
    }

    #[test]
    fn password_slots_are_bounded_and_reusable_for_each_admission_class() {
        let a = Admission::default();
        assert!((2..=16).contains(&a.kdf_slots(true)));
        assert_eq!(a.kdf_slots(false), 2);
        for dev_loopback in [false, true] {
            let mut permits: Vec<_> = (0..a.kdf_slots(dev_loopback)).map(|_| a.kdf(dev_loopback).unwrap()).collect();
            assert!(a.kdf(dev_loopback).is_none());
            assert!(a.kdf(false).is_none(), "loopback slots share the physical bound with other peers");
            permits.pop();
            let replacement = a.kdf(dev_loopback).unwrap();
            assert!(a.kdf(dev_loopback).is_none());
            drop(replacement);
            drop(permits);
            assert_eq!(a.kdfs.load(Ordering::Acquire), 0);
        }
    }

    #[test]
    fn an_exhausted_peer_cannot_fill_the_email_admission_table() {
        let a = Admission::default();
        let now = Instant::now();
        for _ in 0..30 {
            assert!(a.attempt("1", None, now));
        }
        for n in 0..KEYS {
            assert!(!a.attempt("1", Some(&format!("user{n}@example.com")), now));
        }
        assert_eq!(a.attempts.lock().unwrap().len(), 1);
        assert!(a.attempt("2", Some("new@example.com"), now));
        assert!(!a.attempt("1", Some("new@example.com"), now));
        assert_eq!(a.attempts.lock().unwrap()["email:new@example.com"].1, 2);
        assert!(a.attempt("3", None, now));
    }
}

/// Public identity options use the same bounded writer and typed refusals.
pub(crate) fn config(request: Request, shared: &Shared) {
    let config = shared.engine.call(|engine, shared| {
        let environment = if shared.personas { "development" }
            else if engine.store().deployment_environment().ok().flatten().as_deref() == Some("staging") { "staging" } else { "production" };
        (engine.schema().auth.clone(), environment)
    });
    let (auth, environment) = match config {
        Ok(config) => config,
        Err(why) => return respond_timed(request, shared, 503, json!({"denied":why})),
    };
    // @ref LLP 3000.011.003.000.000#1 — an opt-in proof marker asserts the directly bound server, without granting authority.
    let mut config = json!({ "guests": auth.guests, "password": auth.password, "development": shared.personas, "devDoors": shared.dev_doors(), "environment": environment });
    if let Ok(id) = std::env::var("SNAPBACK4_PROOF_ID") && !id.is_empty() {
        config["proof_id"] = json!(id);
    }
    respond_timed(request, shared, 200, config);
}
