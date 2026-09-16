//! Actual sockets around ingress and verifier/worker fences. The companion
//! Node witness supplies real application signatures and supervised handlers.
use super::*;
use snapback4_core::{identity, value::encode_bytes_hex};

fn host(wait: &str) -> Host {
    Host::with_store(true, snapback4_core::Store::memory().unwrap(), &format!(
        "use personas alice\nroute billing: post \"/hooks/billing\" as service:billing wait {wait}\nroute report: post \"/report\" wait 1ms\nquery who():\n  return viewer\n"))
}
fn worker(host: &Host) -> String {
    let engine = lock(&host.shared.engine);
    let seat = identity::service_session(engine.store(), "worker", host.shared.now(), 1).unwrap();
    format!("Authorization: Bearer {}\r\n", seat.token)
}
fn records(host: &Host) -> i64 {
    lock(&host.shared.engine).store().conn().query_row("SELECT COUNT(*) FROM _requests", [], |row| row.get(0)).unwrap()
}
fn raw_exchange(address: SocketAddr, wire: &[u8]) -> Vec<u8> {
    let mut stream = TcpStream::connect(address).unwrap();
    stream.set_read_timeout(Some(Duration::from_secs(4))).unwrap();
    stream.write_all(wire).unwrap();
    let mut response = Vec::new(); stream.read_to_end(&mut response).unwrap(); response
}
fn delivery(host: &Host, bytes: &[u8], headers: &str) -> JoinHandle<Vec<u8>> {
    let address = host.address;
    let mut wire = format!("POST /hooks/billing HTTP/1.1\r\nHost: provider.example\r\nOrigin: https://provider.example\r\nConnection: close\r\nContent-Length: {}\r\n{headers}\r\n", bytes.len()).into_bytes();
    wire.extend_from_slice(bytes);
    thread::spawn(move || raw_exchange(address, &wire))
}
fn claimed(host: &Host, credential: &str) -> Json {
    let reply = host.request("POST", "/routes/verify/claim", credential, r#"{"routes":["billing"],"limit":1,"lease":1,"wait":1}"#);
    assert_eq!(status(&reply), 200, "{reply}");
    let reply = body(&reply);
    assert_eq!(reply["requests"].as_array().unwrap().len(), 1, "{reply}");
    reply["requests"][0].clone()
}
fn verify(host: &Host, credential: &str, ticket: &Json, disposition: &str) -> String {
    host.request("POST", &format!("/routes/verify/{}/settle", ticket["id"].as_str().unwrap()),
        &format!("{credential}x-snapback-route-lease: {}\r\n", ticket["leaseToken"].as_str().unwrap()),
        &json!({"disposition": disposition}).to_string())
}
fn finish(host: &Host, credential: &str, bytes: &[u8]) -> String {
    let claims = body(&host.request("POST", "/actions/claim", credential, r#"{"action":"@route/billing","wait":1}"#));
    assert_eq!(claims["requests"].as_array().unwrap().len(), 1, "{claims}");
    let claim = &claims["requests"][0];
    assert_eq!(claim["principal"], "service:billing");
    let id = claim["id"].as_str().unwrap();
    let settled = host.request("POST", &format!("/actions/{id}/done"),
        &format!("{credential}x-snapback-action-lease: {}\r\n", claim["session"]["token"].as_str().unwrap()),
        &json!({"result":{"status":201,"headers":[["set-cookie","a=1"],["set-cookie","b=2"]],"bodyHex":encode_bytes_hex(bytes)}}).to_string());
    assert_eq!(body(&settled)["ok"], true, "{settled}");
    id.to_owned()
}
fn response_text(bytes: &[u8]) -> String { String::from_utf8_lossy(bytes).into_owned() }

#[test]
fn route_invalid_delivery_never_admits_and_cannot_collect_a_settled_body() {
    let host = host("2s"); let worker = worker(&host);
    for header in ["", "x-signature: wrong\r\n"] {
        let delivery = delivery(&host, b"same-body", header);
        let ticket = claimed(&host, &worker);
        assert!(ticket.get("session").is_none(), "verification has no delegated seat");
        assert_eq!(records(&host), 0, "pre-verification is not durable work");
        assert_eq!(body(&verify(&host, &worker, &ticket, "deny"))["ok"], true);
        let reply = response_text(&delivery.join().unwrap());
        assert_eq!(status(&reply), 403, "{reply}");
        assert_eq!(records(&host), 0, "invalid same-body must not consume its id");
    }
    let valid = delivery(&host, b"same-body", "x-signature: valid\r\n");
    let ticket = claimed(&host, &worker);
    assert_eq!(body(&verify(&host, &worker, &ticket, "allow"))["ok"], true);
    let id = finish(&host, &worker, b"receipt");
    assert_eq!(status(&response_text(&valid.join().unwrap())), 201);
    for header in ["", "x-signature: wrong-again\r\n"] {
        let invalid = delivery(&host, b"same-body", header);
        let ticket = claimed(&host, &worker);
        verify(&host, &worker, &ticket, "deny");
        let reply = response_text(&invalid.join().unwrap());
        assert_eq!(status(&reply), 403, "{reply}");
        assert!(!reply.contains("receipt")); assert_eq!(records(&host), 1);
    }
    let retry = delivery(&host, b"same-body", "x-signature: fresh-valid\r\n");
    let fresh = claimed(&host, &worker);
    assert_ne!(fresh["id"], ticket["id"]);
    verify(&host, &worker, &fresh, "allow");
    assert_eq!(status(&response_text(&retry.join().unwrap())), 201);
    assert_eq!(records(&host), 1);
    assert_eq!(lock(&host.shared.engine).action_request_at(&id, "service:billing", host.shared.now()).unwrap().attempt, 1);
}

#[test]
fn route_wire_retains_raw_bytes_and_independent_set_cookie_headers() {
    let host = host("2s"); let worker = worker(&host);
    let bytes = b"\xff\0{ \"b\" : 2, \"a\":1 }\r\n";
    let delivery = delivery(&host, bytes, "x-signature: raw\r\n");
    let ticket = claimed(&host, &worker);
    assert_eq!(ticket["request"]["bodyHex"], encode_bytes_hex(bytes));
    assert_eq!(ticket["request"]["method"], "POST");
    verify(&host, &worker, &ticket, "allow");
    finish(&host, &worker, b"\xff\0receipt");
    let reply = delivery.join().unwrap();
    let boundary = reply.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
    assert_eq!(&reply[boundary + 4..], b"\xff\0receipt");
    let headers = response_text(&reply[..boundary]).to_ascii_lowercase();
    assert!(headers.contains("set-cookie: a=1\r\n"));
    assert!(headers.contains("set-cookie: b=2"));
    assert!(!headers.contains("access-control-allow-origin"));
}

#[test]
fn route_verifier_fences_wrong_tokens_and_expired_tickets_without_admission() {
    let host = host("150ms"); let worker = worker(&host);
    let delivery = delivery(&host, b"late", "");
    let ticket = claimed(&host, &worker);
    let mut forged = ticket.clone(); forged["leaseToken"] = "wrong".into();
    let reply = verify(&host, &worker, &forged, "allow");
    assert_eq!(status(&reply), 409); assert_eq!(body(&reply)["denied"]["code"], "E_ROUTE_LEASE");
    assert_eq!(records(&host), 0);
    assert_eq!(status(&response_text(&delivery.join().unwrap())), 503);
    assert_eq!(status(&verify(&host, &worker, &ticket, "allow")), 409);
    assert_eq!(records(&host), 0);
}

#[test]
fn route_verifier_reclaims_expired_lease_but_old_callback_cannot_promote() {
    let host = host("2500ms"); let worker = worker(&host);
    let delivery = delivery(&host, b"lease", "");
    let first = claimed(&host, &worker);
    thread::sleep(Duration::from_millis(1050));
    let second = claimed(&host, &worker);
    assert_eq!(first["id"], second["id"]); assert_ne!(first["leaseToken"], second["leaseToken"]);
    assert_eq!(status(&verify(&host, &worker, &first, "allow")), 409);
    assert_eq!(records(&host), 0);
    verify(&host, &worker, &second, "deny");
    assert_eq!(status(&response_text(&delivery.join().unwrap())), 403);
}

#[test]
fn route_seat_revocation_during_verification_cannot_be_undone_by_allow() {
    let host = host("2s"); let worker = worker(&host);
    let delivery = delivery(&host, b"revoked", ""); let ticket = claimed(&host, &worker);
    identity::revoke_principal(lock(&host.shared.engine).store(), "service:billing").unwrap();
    assert_eq!(body(&verify(&host, &worker, &ticket, "allow"))["ok"], true);
    assert_eq!(status(&response_text(&delivery.join().unwrap())), 503);
    assert_eq!(records(&host), 0);
}

#[test]
fn route_adoption_fences_old_supervised_verifier_before_child_shutdown() {
    let host = host("2s");
    let old = crate::dev_worker::child_session(lock(&host.shared.engine).store(), host.shared.now(), 0).unwrap();
    let old_headers = format!("Authorization: Bearer {}\r\n", old.token);
    let delivery = delivery(&host, b"generation", ""); let ticket = claimed(&host, &old_headers);
    host.shared.worker_revision.fetch_add(1, Ordering::Release);
    let reply = verify(&host, &old_headers, &ticket, "allow");
    assert_eq!(status(&reply), 401, "{reply}"); assert_eq!(records(&host), 0);
    let reply = host.request("POST", "/routes/verify/claim", &old_headers, r#"{"routes":["billing"]}"#);
    assert_eq!(status(&reply), 401, "{reply}");
    // Finish the delivery through a fresh trusted manual seat, after lease expiry.
    thread::sleep(Duration::from_millis(1050));
    let current = worker(&host); let ticket = claimed(&host, &current);
    verify(&host, &current, &ticket, "deny");
    assert_eq!(status(&response_text(&delivery.join().unwrap())), 403);
}

#[test]
fn route_development_exception_does_not_expose_core_doors_or_personas() {
    let host = host("50ms");
    let session = identity::open_session(lock(&host.shared.engine).store(), "member:alice", "account", host.shared.now()).unwrap();
    let foreign = |method: &str, path: &str, headers: &str, bytes: &str| exchange(host.address,
        &format!("{method} {path} HTTP/1.1\r\nHost: provider.example\r\nOrigin: https://provider.example\r\nConnection: close\r\nContent-Length: {}\r\n{headers}\r\n{bytes}", bytes.len()));
    for (method, path) in [("GET", "/hooks/billing"), ("OPTIONS", "/hooks/billing"), ("POST", "/hooks/billing?x=1"), ("POST", "/seed"), ("GET", "/schema"), ("POST", "/q/who"), ("POST", "/actions/claim"), ("POST", "/routes/verify/claim"), ("POST", "/unknown")] {
        assert_eq!(status(&foreign(method, path, "", "{}")), 403, "{method} {path}");
    }
    assert_eq!(status(&foreign("POST", "/hooks/billing", "x-snapback-persona: alice\r\n", "{}")), 401);
    assert_eq!(status(&foreign("POST", "/report", "x-snapback-persona: alice\r\n", "{}")), 401);
    assert_eq!(status(&foreign("POST", "/report", "", "{}")), 401);
    assert_eq!(records(&host), 0);
    assert_eq!(status(&foreign("POST", "/report", &format!("Authorization: Bearer {}\r\n", session.token), "{}")), 503);
    assert_eq!(records(&host), 1, "a real bearer, unlike a persona, may admit a declared public route in dev");
}

#[test]
fn route_wait_capacity_leaves_verification_and_short_core_requests_available() {
    let host = host("2500ms"); let worker = worker(&host);
    let deliveries: Vec<_> = (0..ROUTE_WORKERS).map(|i| delivery(&host, i.to_string().as_bytes(), "")).collect();
    wait_until(|| host.admission.routes.load(Ordering::Acquire) == ROUTE_WORKERS);
    assert_eq!(host.admission.waiters.load(Ordering::Acquire), 0);
    assert_eq!(body(&host.request("POST", "/q/who", "x-snapback-persona: alice\r\n", "{}"))["data"], "dev:alice");
    for _ in 0..ROUTE_WORKERS {
        let ticket = claimed(&host, &worker); verify(&host, &worker, &ticket, "deny");
    }
    for delivery in deliveries { assert_eq!(status(&response_text(&delivery.join().unwrap())), 403); }
    wait_until(|| host.admission.routes.load(Ordering::Acquire) == 0);
    assert_eq!(records(&host), 0);
}

#[test]
fn route_503_is_collectible_only_after_fresh_verification_of_the_same_body() {
    let host = host("200ms"); let worker = worker(&host);
    let initial = delivery(&host, b"retry", ""); let ticket = claimed(&host, &worker);
    verify(&host, &worker, &ticket, "allow");
    assert_eq!(status(&response_text(&initial.join().unwrap())), 503);
    assert_eq!(records(&host), 1);
    finish(&host, &worker, b"settled-later");
    let retry = delivery(&host, b"retry", ""); let ticket = claimed(&host, &worker);
    verify(&host, &worker, &ticket, "allow");
    let reply = response_text(&retry.join().unwrap());
    assert_eq!(status(&reply), 201); assert!(reply.ends_with("settled-later")); assert_eq!(records(&host), 1);
}
