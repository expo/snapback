//! HTTP identity admission. Password work owns a bounded KDF slot, never
//! the engine guard. Rate keys use the socket peer, never forwarded headers.
use crate::serve::{Shared, principal_of, refusal_json, respond};
use serde_json::{Value as Json, json};
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
fn limited(request: Request) {
    let mut refusal = Refusal::new(
        "E_RATE_LIMIT",
        "auth",
        "too many identity requests; retry later",
    )
    .guide("personas");
    refusal.retryable = true;
    respond(request, 429, json!({ "denied": refusal_json(&refusal) }));
}

pub fn handle(request: Request, shared: &Shared, path: &str, body: &str) {
    let payload: Json = match serde_json::from_str(if body.is_empty() { "{}" } else { body }) {
        Ok(value) => value,
        Err(_) => {
            return respond(
                request,
                400,
                json!({ "denied": Refusal::new("E_INPUT", "input", "identity takes a JSON object") }),
            );
        }
    };
    let email = payload.get("email").and_then(Json::as_str).unwrap_or("");
    let password = payload.get("password").and_then(Json::as_str).unwrap_or("");
    let password_route = matches!(path, "/auth/login" | "/auth/signup");
    let peer = request
        .remote_addr()
        .map(|a| a.ip().to_string())
        .unwrap_or_else(|| "unknown".into());
    let rate_route = matches!(path, "/auth/login" | "/auth/signup" | "/auth/guest");
    // @ref LLP 3000.007#8 — dev loopback has no minute counters; KDF slots remain
    let dev_loopback = shared.personas && request.remote_addr().is_some_and(|peer| peer.ip().is_loopback());
    if rate_route && !dev_loopback
        && !shared
            .auth
            .attempt(&peer, password_route.then_some(email), Instant::now())
    {
        return limited(request);
    }
    let kdf = if password_route {
        match shared.auth.kdf(dev_loopback) {
            Some(permit) => Some(permit),
            None => return limited(request),
        }
    } else {
        None
    };
    let outcome = perform(&request, shared, path, email, password);
    drop(kdf);
    match outcome {
        Ok(Outcome::Logout) => respond(request, 200, json!({ "ok": true })),
        Ok(Outcome::LogoutAll(revoked)) => {
            respond(request, 200, json!({ "ok": true, "revoked": revoked }))
        }
        Ok(Outcome::Session(session)) => respond(
            request,
            200,
            json!({ "session": { "principal": session.principal, "kind": session.kind, "token": session.token, "expiresAt": session.expires_at } }),
        ),
        Err(error) => {
            let status = if path == "/auth/logout" && matches!(&error, RuntimeError::Auth(_)) {
                401
            } else if error.is_refusal() {
                200
            } else {
                503
            };
            respond(request, status, json!({ "denied": refusal_json(&error.refusal()) }));
        }
    }
}

enum Outcome {
    Session(identity::Session),
    Logout,
    LogoutAll(u64),
}

pub(crate) fn bearer_token(request: &Request) -> Result<&str, RuntimeError> {
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
    value
        .value
        .as_str()
        .strip_prefix("Bearer ")
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .ok_or_else(|| RuntimeError::Auth("send Authorization: Bearer <token>".into()))
}

fn perform(
    request: &Request,
    shared: &Shared,
    path: &str,
    email: &str,
    password: &str,
) -> Result<Outcome, RuntimeError> {
    let enabled = || {
        let auth = shared.bound.lock().unwrap().schema.auth.clone();
        if (path == "/auth/guest" && !auth.guests)
            || (matches!(path, "/auth/signup" | "/auth/login") && !auth.password)
        {
            Err(RuntimeError::Auth(
                "this identity method is not enabled in schema.q".into(),
            ))
        } else {
            Ok(())
        }
    };
    enabled()?;
    match path {
        "/auth/signup" => {
            #[cfg(test)]
            crate::serve::test_work(&shared.auth_work);
            let prepared = identity::prepare_signup(email, password)?;
            enabled()?;
            let engine = shared.engine.lock().unwrap();
            identity::finish_signup(
                engine.store(),
                prepared,
                shared.now(),
                &mut shared.entropy.lock().unwrap(),
            )
            .map(Outcome::Session)
        }
        "/auth/login" => {
            identity::password_bound(password)?;
            let found = {
                let engine = shared.engine.lock().unwrap();
                identity::credential(engine.store(), email)?
            };
            #[cfg(test)]
            crate::serve::test_work(&shared.auth_work);
            identity::verify_password(found.as_ref(), password)?;
            enabled()?;
            let engine = shared.engine.lock().unwrap();
            identity::finish_login(
                engine.store(),
                found.expect("verified account"),
                shared.now(),
            )
            .map(Outcome::Session)
        }
        "/auth/guest" => {
            let engine = shared.engine.lock().unwrap();
            identity::guest(
                engine.store(),
                shared.now(),
                &mut shared.entropy.lock().unwrap(),
            )
            .map(Outcome::Session)
        }
        "/auth/refresh" => {
            let token = bearer_token(request)?;
            let engine = shared.engine.lock().unwrap();
            identity::rotate_session(engine.store(), token, shared.now())?
                .map(Outcome::Session)
                .ok_or_else(|| RuntimeError::Auth("this session is not live; sign in again".into()))
        }
        "/auth/logout-all" => {
            let principal = principal_of(request, shared)
                .map_err(|refusal| RuntimeError::Auth(refusal.message))?;
            let engine = shared.engine.lock().unwrap();
            identity::revoke_principal(engine.store(), &principal).map(Outcome::LogoutAll)
        }
        _ => {
            let token = bearer_token(request)?;
            let mut engine = shared.engine.lock().unwrap();
            identity::logout_session(engine.store_mut(), token, || shared.now())?;
            Ok(Outcome::Logout)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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
