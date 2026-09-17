use super::*;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::sync::mpsc;
use std::thread::{self, JoinHandle};

#[path = "../tests/serve_adoption/mod.rs"]
mod adoption_tests;

#[path = "../tests/serve_routes/mod.rs"]
mod route_tests;

const SCHEMA: &str = "use identity\ntable items:\n  n: int\n  photo: image <=1024 ?\n  read <- allow\n  insert <- deny\n  sync public\nquery who():\n  return viewer\n";

struct Host {
    server: Arc<Server>,
    shared: Arc<Shared>,
    admission: Arc<RequestAdmission>,
    worker: Option<JoinHandle<()>>,
    address: SocketAddr,
}

impl Host {
    fn new(dev: bool) -> Self {
        Self::with_store(dev, snapback4_core::Store::memory().unwrap(), SCHEMA)
    }

    fn with_store(dev: bool, store: snapback4_core::Store, source: &str) -> Self {
        let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let mut engine = Engine::new(
            store,
            bound.schema.clone(),
            bound.programs.iter().map(|p| p.program.clone()),
        )
        .unwrap();
        let clock = Arc::new(Mutex::new(crate::dev_clock::Clock::new(dev, 0).unwrap()));
        let presence = Arc::new(Live::new(clock.clone()));
        engine.set_presence(Some(presence.clone()));
        let generation = engine.generation();
        let shared = Arc::new(Shared {
            adoption: Mutex::new(adoption::Status::new(String::new())),
            engine: Mutex::new(engine),
            readers: Mutex::new(QueryReaders::default()), read_cuts: Mutex::new(read_cost::ReadCuts::default()),
            bound: Mutex::new(bound),
            generation: Mutex::new(generation),
            worker_revision: AtomicUsize::new(0),
            committed: Condvar::new(),
            seq: Mutex::new(0),
            personas: dev,
            hold_effects: false,
            hold_schedules: false,
            clock, maintenance: Mutex::new(()),
            entropy: Mutex::new(1),
            presence,
            asset_transfers: AssetTransfers::default(),
            native: Mutex::new(None),
            auth: crate::auth::Admission::default(),
            uploads: AtomicUsize::new(0),
            route_verification: routes::Verification::default(),
            auth_work: Mutex::new(None),
            upload_work: Mutex::new(None),
            effect_wait: Mutex::new(None),
        });
        let server = Arc::new(
            Server::http_with_limits(("127.0.0.1", 0), tiny_http::ConnectionLimits::default())
                .unwrap(),
        );
        let address = server.server_addr().to_ip().unwrap();
        let admission = Arc::new(RequestAdmission::default());
        let (s, e, a) = (server.clone(), shared.clone(), admission.clone());
        let worker = thread::spawn(move || {
            for request in s.incoming_requests() {
                dispatch(request, e.clone(), a.clone());
            }
        });
        Self {
            server,
            shared,
            admission,
            worker: Some(worker),
            address,
        }
    }

    fn request(&self, method: &str, path: &str, headers: &str, body: &str) -> String {
        exchange(
            self.address,
            &format!(
                "{method} {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: {}\r\n{headers}\r\n{body}",
                body.len()
            ),
        )
    }
}
impl Drop for Host {
    fn drop(&mut self) {
        *self.shared.seq.lock().unwrap() = u64::MAX;
        self.shared.committed.notify_all();
        self.server.unblock();
        self.worker.take().unwrap().join().unwrap();
    }
}

fn exchange(address: SocketAddr, wire: &str) -> String {
    exchange_bytes(address, wire.as_bytes())
}
fn exchange_bytes(address: SocketAddr, wire: &[u8]) -> String {
    let mut stream = TcpStream::connect(address).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(3)))
        .unwrap();
    stream.write_all(wire).unwrap();
    let mut response = Vec::new();
    stream.read_to_end(&mut response).unwrap();
    String::from_utf8_lossy(&response).into_owned()
}
fn status(response: &str) -> u16 {
    response.split(' ').nth(1).unwrap().parse().unwrap()
}
fn body(response: &str) -> Json {
    serde_json::from_str(response.split_once("\r\n\r\n").unwrap().1).unwrap()
}
fn effect_snapshot(host: &Host, id: &str) -> (Vec<rusqlite::types::Value>, i64) {
    let engine = lock(&host.shared.engine);
    let mut statement = engine.store().conn().prepare("SELECT * FROM _outbox WHERE id = ?1").unwrap();
    let columns = statement.column_count();
    let row = statement.query_row([id], |row| (0..columns).map(|column| row.get(column)).collect()).unwrap();
    let steps = engine.store().conn().query_row("SELECT COUNT(*) FROM _effect_steps WHERE effect_id = ?1", [id], |row| row.get(0)).unwrap();
    (row, steps)
}
fn wait_until(mut predicate: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(2);
    while !predicate() {
        assert!(Instant::now() < deadline, "condition did not become true");
        thread::sleep(Duration::from_millis(5));
    }
}

#[test]
fn raced_mutation_id_refusal_keeps_its_terminal_http_status() {
    // Exercise the post-preflight error classifier directly: a socket race
    // may otherwise happen to be caught by the earlier replay check.
    assert_eq!(mutation_error_status(&snapback4_core::store::id_reused().refusal()), 200);
    let mut transient = Refusal::new("E_STORE", "store", "retry later");
    transient.retryable = true;
    assert_eq!(mutation_error_status(&transient), 503);
    assert_eq!(mutation_error_status(&Refusal::new("E_STORE", "store", "failed")), 500);

    let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(),
        "use personas alice\nmutation answer(n: int):\n  return n\n");
    let gate = Arc::new(std::sync::Barrier::new(13));
    let threads: Vec<_> = (0..12).map(|n| {
        let gate = gate.clone();
        let address = host.address;
        thread::spawn(move || {
            let payload = json!({ "id": "raced-input", "args": { "n": n } }).to_string();
            gate.wait();
            exchange(address, &format!("POST /m/answer HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nx-snapback-persona: alice\r\nContent-Length: {}\r\n\r\n{payload}", payload.len()))
        })
    }).collect();
    gate.wait();
    let replies: Vec<_> = threads.into_iter().map(|thread| {
        let response = thread.join().unwrap();
        assert_eq!(status(&response), 200, "{response}");
        body(&response)
    }).collect();
    assert_eq!(replies.iter().filter(|reply| reply["state"] == "sent").count(), 1);
    for reply in replies.iter().filter(|reply| reply["state"] != "sent") {
        assert_eq!(reply["state"], "failed");
        assert_eq!(reply["why"]["code"], "E_ID_REUSED");
        assert!(!reply["why"]["retryable"].as_bool().unwrap_or(false));
    }
}

#[test]
fn oidc_terminal_codes_survive_http_settlement_and_public_recollection() {
    let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(),
        "use personas alice\naction signIn()\n");
    let service = { let engine = lock(&host.shared.engine);
        snapback4_core::identity::service_session(engine.store(), "worker", host.shared.now(), 1).unwrap() };
    let service_header = format!("Authorization: Bearer {}\r\n", service.token);
    let cases = [
        ("E_OIDC_BINDING", "E_OIDC_BINDING"), ("E_OIDC_CALLBACK", "E_OIDC_CALLBACK"),
        ("E_OIDC_CONFIG", "E_OIDC_CONFIG"), ("E_OIDC_EXCHANGE", "E_OIDC_EXCHANGE"),
        ("E_OIDC_HANDOFF", "E_OIDC_HANDOFF"), ("E_OIDC_MINT", "E_OIDC_MINT"),
        ("E_OIDC_PROVIDER", "E_OIDC_PROVIDER"), ("E_OIDC_RECIPE", "E_OIDC_RECIPE"),
        ("E_OIDC_REPLAY", "E_OIDC_REPLAY"), ("E_OIDC_TRANSACTION", "E_OIDC_TRANSACTION"),
        ("E_ACTION_RESULT", "E_ACTION_RESULT"), ("E_ROUTE_RESULT", "E_ROUTE_RESULT"),
        ("E_OIDC_UNKNOWN", "E_ACTION_FAILED"), ("E_ARBITRARY_PROVIDER", "E_ACTION_FAILED"),
    ];
    for (index, (submitted_code, recollected_code)) in cases.into_iter().enumerate() {
        let id = format!("oidc-code-{index}");
        let call = body(&host.request("POST", "/a/signIn?wait=0", "x-snapback-persona: alice\r\n",
            &json!({"id": id, "args": {}}).to_string()));
        assert_eq!(call["state"], "pending", "{submitted_code}: {call}");
        let claimed = body(&host.request("POST", "/actions/claim", &service_header, r#"{"action":"signIn"}"#));
        assert_eq!(claimed["requests"].as_array().map(Vec::len), Some(1), "{submitted_code}: {claimed}");
        let lease = claimed["requests"][0]["session"]["token"].as_str().unwrap();
        let headers = format!("{service_header}x-snapback-action-lease: {lease}\r\n");
        let error = format!("terminal {submitted_code}");
        let settled = body(&host.request("POST", &format!("/actions/{id}/failed"), &headers,
            &json!({"error": error, "retry": false, "code": submitted_code}).to_string()));
        assert_eq!(settled["ok"], true, "{submitted_code}: {settled}");

        let recollected = body(&host.request("POST", "/a/signIn?wait=0", "x-snapback-persona: alice\r\n",
            &json!({"id": id, "args": {}}).to_string()));
        assert_eq!(recollected["state"], "failed", "{submitted_code}: {recollected}");
        assert_eq!(recollected["replayed"], true, "{submitted_code}: {recollected}");
        assert_eq!(recollected["why"]["code"], recollected_code, "{submitted_code}: {recollected}");
        assert_eq!(recollected["why"]["message"], error, "{submitted_code}: {recollected}");
        let mapped = snapback4_lang::diag::guide_for(recollected_code);
        let expected_guide = if mapped == "services" && recollected_code != "E_AUTH" { "services" } else { "actions" };
        assert_eq!(recollected["why"]["guide"], expected_guide, "{submitted_code}: {recollected}");
    }
}

#[test]
fn bound_session_http_requires_exact_shape_and_current_action_lease() {
    let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(), "use personas alice\naction signIn()\n");
    let (service, other) = { let engine = lock(&host.shared.engine); let now = host.shared.now(); (
        snapback4_core::identity::service_session(engine.store(), "worker", now, 1).unwrap(),
        snapback4_core::identity::service_session(engine.store(), "other", now, 1).unwrap()) };
    let service_header = format!("Authorization: Bearer {}\r\n", service.token);
    let admitted = body(&host.request("POST", "/a/signIn?wait=0", "x-snapback-persona: alice\r\n", r#"{"id":"bound-http","args":{}}"#));
    assert_eq!(admitted["state"], "pending", "{admitted}");
    let claimed = body(&host.request("POST", "/actions/claim", &service_header, "{}"));
    assert_eq!(claimed["requests"].as_array().map(Vec::len), Some(1), "{claimed}");
    let lease = claimed["requests"][0]["session"]["token"].as_str().unwrap().to_owned();
    let headers = format!("{service_header}x-snapback-action-lease: {lease}\r\n");

    let inverse = host.request("POST", "/auth/session", &headers, r#"{"principal":"member:inverse"}"#);
    assert_eq!(status(&inverse), 400, "{inverse}");
    assert_eq!(body(&inverse)["denied"]["code"], "E_INPUT");
    { let engine = lock(&host.shared.engine);
      assert_eq!(engine.store().conn().query_row("SELECT COUNT(*) FROM _sessions WHERE principal = 'member:inverse'", [], |row| row.get::<_, i64>(0)).unwrap(), 0,
          "a lease header without binding must never reach legacy minting"); }

    let legacy = body(&host.request("POST", "/auth/session", &service_header, r#"{"principal":"member:legacy"}"#));
    assert_eq!(legacy["session"]["principal"], "member:legacy", "unbound behavior is unchanged");
    let tolerant_legacy = body(&host.request("POST", "/auth/session", &service_header, r#"{"principal":"member:tolerant","kind":false,"days":"thirty"}"#));
    assert_eq!(tolerant_legacy["session"]["kind"], "account", "unbound malformed optionals retain their legacy defaults");
    for malformed in [json!(null), json!({}), json!({"invocationId":"","intent":"identity-session/v1"}), json!({"invocationId":"bound-http","intent":"other"}),
        json!({"invocationId":"bound-http","intent":"identity-session/v1","replaceLostDelivery":"yes"}),
        json!({"invocationId":"bound-http","intent":"identity-session/v1","extra":true})] {
        let payload = json!({"principal":"member:http","kind":"member","days":30,"binding":malformed}).to_string();
        let response = host.request("POST", "/auth/session", &headers, &payload);
        assert_eq!(status(&response), 400, "{response}");
        assert_eq!(body(&response)["denied"]["code"], "E_INPUT");
        assert!(!response.contains(&service.token) && !response.contains(&lease));
    }

    let binding = json!({"invocationId":"bound-http","intent":"identity-session/v1"});
    for malformed in [
        json!({"principal":"member:http","kind":null,"days":30,"binding":binding.clone()}),
        json!({"principal":"member:http","kind":7,"days":30,"binding":binding.clone()}),
        json!({"principal":"member:http","kind":"member","days":null,"binding":binding.clone()}),
        json!({"principal":"member:http","kind":"member","days":"30","binding":binding.clone()}),
        json!({"principal":"member:http","kind":"member","days":30.5,"binding":binding.clone()}),
    ] {
        let response = host.request("POST", "/auth/session", &headers, &malformed.to_string());
        assert_eq!(status(&response), 400, "{response}");
        assert_eq!(body(&response)["denied"]["code"], "E_INPUT");
        assert!(!response.contains(&service.token) && !response.contains(&lease));
    }
    let payload = json!({"principal":"member:http","kind":"member","days":30,"binding":binding.clone()}).to_string();
    for missing_empty_or_duplicate in [service_header.clone(), format!("{service_header}x-snapback-action-lease: \r\n"), format!("{headers}x-snapback-action-lease: duplicate\r\n")] {
        let response = host.request("POST", "/auth/session", &missing_empty_or_duplicate, &payload);
        assert_eq!(status(&response), 200, "{response}");
        assert_eq!(body(&response)["denied"]["code"], "E_ACTION_LEASE");
    }
    let wrong_worker = format!("Authorization: Bearer {}\r\nx-snapback-action-lease: {lease}\r\n", other.token);
    assert_eq!(body(&host.request("POST", "/auth/session", &wrong_worker, &payload))["denied"]["code"], "E_ACTION_LEASE");

    let first = body(&host.request("POST", "/auth/session", &headers, &payload));
    let first_token = first["session"]["token"].as_str().unwrap().to_owned();
    let first_expiry = first["session"]["expiresAt"].as_i64().unwrap();
    let replay = host.request("POST", "/auth/session", &headers, &payload);
    assert_eq!(body(&replay)["denied"]["code"], "E_INPUT");
    assert!(!replay.contains(&service.token) && !replay.contains(&lease) && !replay.contains(&first_token));
    let changed = json!({"principal":"member:http","kind":"member","days":29,"binding":binding}).to_string();
    assert_eq!(body(&host.request("POST", "/auth/session", &headers, &changed))["denied"]["code"], "E_INPUT");

    let recovery = json!({"principal":"member:http","kind":"member","days":30,"binding":{
        "invocationId":"bound-http","intent":"identity-session/v1","replaceLostDelivery":true}}).to_string();
    let recovered = body(&host.request("POST", "/auth/session", &headers, &recovery));
    let recovered_token = recovered["session"]["token"].as_str().unwrap().to_owned();
    assert_ne!(recovered_token, first_token);
    assert_eq!(recovered["session"]["expiresAt"], first_expiry);
    { let engine = lock(&host.shared.engine);
      assert!(snapback4_core::identity::resolve(engine.store(), &first_token, host.shared.now()).unwrap().is_none());
      assert!(snapback4_core::identity::resolve(engine.store(), &recovered_token, host.shared.now()).unwrap().is_some()); }

    let stale_logout = host.request("POST", "/auth/logout", &format!("Authorization: Bearer {first_token}\r\n"), "{}");
    assert_eq!(status(&stale_logout), 401, "{stale_logout}");
    assert_eq!(body(&stale_logout)["denied"]["code"], "E_AUTH");
    { let engine = lock(&host.shared.engine);
      assert!(snapback4_core::identity::resolve(engine.store(), &recovered_token, host.shared.now()).unwrap().is_some(),
          "HTTP logout of the stale delivery must not pretend the replacement was closed"); }

    let delivered = json!({"result": {"session": recovered["session"].clone()}}).to_string();
    let settled = body(&host.request("POST", "/actions/bound-http/done", &headers, &delivered));
    assert_eq!(settled["ok"], true, "{settled}");
    let after = host.request("POST", "/auth/session", &headers, &recovery);
    assert_eq!(body(&after)["denied"]["code"], "E_ACTION_LEASE");
    assert!(!after.contains(&service.token) && !after.contains(&lease) && !after.contains(&recovered_token));
}

#[test]
fn public_live_logout_keeps_the_bound_family_tombstone_authoritative() {
    let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(), "use personas alice\naction signIn()\n");
    let service = { let engine = lock(&host.shared.engine);
        snapback4_core::identity::service_session(engine.store(), "worker", host.shared.now(), 1).unwrap() };
    let service_header = format!("Authorization: Bearer {}\r\n", service.token);
    let admitted = body(&host.request("POST", "/a/signIn?wait=0", "x-snapback-persona: alice\r\n", r#"{"id":"logout-live-http","args":{}}"#));
    assert_eq!(admitted["state"], "pending", "{admitted}");
    let claimed = body(&host.request("POST", "/actions/claim", &service_header, r#"{"action":"signIn"}"#));
    let lease = claimed["requests"][0]["session"]["token"].as_str().unwrap().to_owned();
    let action_headers = format!("{service_header}x-snapback-action-lease: {lease}\r\n");
    let mint = json!({"principal":"member:logout-live","kind":"member","days":30,"binding":{
        "invocationId":"logout-live-http","intent":"identity-session/v1"}}).to_string();
    let minted = body(&host.request("POST", "/auth/session", &action_headers, &mint));
    let token = minted["session"]["token"].as_str().unwrap().to_owned();
    let logout = host.request("POST", "/auth/logout", &format!("Authorization: Bearer {token}\r\n"), "{}");
    assert_eq!(status(&logout), 200, "{logout}");
    assert_eq!(body(&logout)["ok"], true, "{logout}");

    let recovery = json!({"principal":"member:logout-live","kind":"member","days":30,"binding":{
        "invocationId":"logout-live-http","intent":"identity-session/v1","replaceLostDelivery":true}}).to_string();
    let refused = body(&host.request("POST", "/auth/session", &action_headers, &recovery));
    assert_eq!(refused["denied"]["code"], "E_ACTION_AUTHORITY", "{refused}");
    let engine = lock(&host.shared.engine);
    let family: String = engine.store().conn().query_row("SELECT family FROM _session_mint_bindings WHERE invocation = 'logout-live-http'", [], |row| row.get(0)).unwrap();
    assert_eq!(engine.store().conn().query_row("SELECT COUNT(*) FROM _sessions WHERE family = ?1", [&family], |row| row.get::<_, i64>(0)).unwrap(), 0);
    assert_eq!(engine.store().conn().query_row("SELECT COUNT(*) FROM _session_mint_bindings WHERE invocation = 'logout-live-http'", [], |row| row.get::<_, i64>(0)).unwrap(), 1);
}

#[test]
fn bound_session_http_refuses_stale_and_cancelled_claims_without_minting() {
    let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(), "use personas alice\naction signIn()\n");
    let service = { let engine = lock(&host.shared.engine);
        snapback4_core::identity::service_session(engine.store(), "worker", host.shared.now(), 1).unwrap() };
    let service_header = format!("Authorization: Bearer {}\r\n", service.token);

    let admitted = body(&host.request("POST", "/a/signIn?wait=0", "x-snapback-persona: alice\r\n", r#"{"id":"stale-bound-http","args":{}}"#));
    assert_eq!(admitted["state"], "pending", "{admitted}");
    let claimed = body(&host.request("POST", "/actions/claim", &service_header, r#"{"action":"signIn"}"#));
    let stale_lease = claimed["requests"][0]["session"]["token"].as_str().unwrap().to_owned();
    let stale_headers = format!("{service_header}x-snapback-action-lease: {stale_lease}\r\n");
    let retried = body(&host.request("POST", "/actions/stale-bound-http/failed", &stale_headers, r#"{"error":"retry","retry":true}"#));
    assert_eq!(retried["ok"], true, "{retried}");
    let stale_payload = json!({"principal":"member:stale-http","kind":"member","days":30,"binding":{
        "invocationId":"stale-bound-http","intent":"identity-session/v1"}}).to_string();
    assert_eq!(body(&host.request("POST", "/auth/session", &stale_headers, &stale_payload))["denied"]["code"], "E_ACTION_LEASE");

    let admitted = body(&host.request("POST", "/a/signIn?wait=0", "x-snapback-persona: alice\r\n", r#"{"id":"cancelled-bound-http","args":{}}"#));
    assert_eq!(admitted["state"], "pending", "{admitted}");
    let claimed = body(&host.request("POST", "/actions/claim", &service_header, r#"{"action":"signIn"}"#));
    let cancelled_lease = claimed["requests"][0]["session"]["token"].as_str().unwrap().to_owned();
    let cancelled_headers = format!("{service_header}x-snapback-action-lease: {cancelled_lease}\r\n");
    let cancelled = body(&host.request("POST", "/actions/cancelled-bound-http/cancel", "x-snapback-persona: alice\r\n", "{}"));
    assert_eq!(cancelled["request"]["state"], "failed", "{cancelled}");
    let cancelled_payload = json!({"principal":"member:cancelled-http","kind":"member","days":30,"binding":{
        "invocationId":"cancelled-bound-http","intent":"identity-session/v1"}}).to_string();
    assert_eq!(body(&host.request("POST", "/auth/session", &cancelled_headers, &cancelled_payload))["denied"]["code"], "E_ACTION_LEASE");

    let engine = lock(&host.shared.engine);
    for principal in ["member:stale-http", "member:cancelled-http"] {
        assert_eq!(engine.store().conn().query_row("SELECT COUNT(*) FROM _sessions WHERE principal = ?1", [principal], |row| row.get::<_, i64>(0)).unwrap(), 0);
    }
    assert_eq!(engine.store().conn().query_row("SELECT COUNT(*) FROM _session_mint_bindings WHERE invocation IN ('stale-bound-http', 'cancelled-bound-http')", [], |row| row.get::<_, i64>(0)).unwrap(), 0);
}

#[test]
fn foreign_origins_and_rebound_hosts_cannot_seed_or_impersonate() {
    let host = Host::new(true);
    for origin in [
        "https://attacker.example",
        "null",
        "http://localhost.attacker.example",
        "http://localhost@attacker.example",
        "http://localhost/",
    ] {
        let headers = format!("Origin: {origin}\r\nx-snapback-persona: alice\r\n");
        for (method, path, payload) in [
            ("POST", "/q/who", "{}"),
            ("POST", "/seed", "[]"),
            ("OPTIONS", "/seed", ""),
        ] {
            let response = host.request(method, path, &headers, payload);
            assert_eq!(status(&response), 403, "{origin}: {response}");
            assert!(
                !response
                    .to_ascii_lowercase()
                    .contains("access-control-allow-origin:")
            );
        }
    }
    for headers in [
        "Host: attacker.example\r\nOrigin: http://attacker.example\r\n",
        "Host: localhost\r\nHost: attacker.example\r\n",
        "Host: localhost\r\nOrigin: http://localhost:5173\r\nOrigin: https://attacker.example\r\n",
    ] {
        let response = exchange(
            host.address,
            &format!(
                "POST /seed HTTP/1.1\r\n{headers}Connection: close\r\nContent-Length: 2\r\n\r\n[]"
            ),
        );
        assert_eq!(status(&response), 403, "{response}");
    }
    for origin in [
        "http://localhost:5173",
        "http://127.0.0.1:8081",
        "https://[::1]:9000",
    ] {
        let response = host.request(
            "POST",
            "/q/who",
            &format!("Origin: {origin}\r\nx-snapback-persona: alice\r\n"),
            "{}",
        );
        assert_eq!(status(&response), 200, "{response}");
        assert_eq!(body(&response)["data"], "dev:alice");
        assert!(response.contains(&format!("Access-Control-Allow-Origin: {origin}")));
    }
    let seeded = host.request(
        "POST",
        "/seed",
        "",
        r#"[{"table":"items","row":{"id":"one","n":1}}]"#,
    );
    assert_eq!(body(&seeded)["seeded"], 1);
}

#[test]
fn unsupported_http_versions_release_connection_slots() {
    let host = Host::new(true);
    for (version, refusal) in [("2.0", 505), ("3.0", 505), ("9.9", 400)] {
        for _ in 0..4 {
            let response = exchange(
                host.address,
                &format!("GET / HTTP/{version}\r\nHost: localhost\r\n\r\n"),
            );
            assert_eq!(status(&response), refusal, "HTTP/{version}: {response}");
        }
    }
    assert_eq!(
        status(&host.request("GET", "/schema", "x-snapback-persona: alice\r\n", "")),
        200
    );
}

#[test]
fn catalog_and_changes_require_live_identity_and_release_refuses_dev_doors() {
    for dev in [true, false] {
        let host = Host::new(dev);
        let response = host.request("GET", "/auth/config", "", "");
        assert_eq!(body(&response), json!({ "guests": true, "password": true }));
        let session = body(&host.request("POST", "/auth/guest", "", "{}"));
        let token = session["session"]["token"].as_str().unwrap();
        let bearer = format!("Authorization: Bearer {token}\r\n");
        for route in ["/", "/schema", "/api.ts", "/changes?since=0&wait=0"] {
            assert_eq!(status(&host.request("GET", route, "", "")), 401);
            assert_eq!(
                status(&host.request("GET", route, "Authorization: Bearer invalid\r\n", "")),
                401
            );
            assert_eq!(status(&host.request("GET", route, &bearer, "")), 200);
            assert_eq!(
                status(&host.request("GET", route, "x-snapback-persona: alice\r\n", "")),
                if dev { 200 } else { 401 }
            );
        }
        assert_eq!(status(&host.request("GET", "/native.wasm", "", "")), 401);
        assert_eq!(
            status(&host.request("GET", "/native.wasm", &bearer, "")),
            404
        );
        assert_eq!(
            status(&host.request(
                "GET",
                "/schema",
                &format!("{bearer}x-snapback-persona: alice\r\n"),
                "",
            )),
            401,
            "a request cannot mix production and development credentials",
        );
        assert_eq!(
            status(&host.request("GET", "/schema", &format!("{bearer}{bearer}"), "")),
            401,
            "duplicate bearer headers are ambiguous",
        );
        let started = Instant::now();
        assert_eq!(
            status(&host.request("GET", "/changes?since=999&wait=25", "", "")),
            401
        );
        assert!(started.elapsed() < Duration::from_secs(1));
        assert_eq!(
            status(&host.request("POST", "/auth/logout", &bearer, "{}")),
            200
        );
        for route in ["/", "/schema", "/api.ts", "/changes"] {
            assert_eq!(status(&host.request("GET", route, &bearer, "")), 401);
        }
        if !dev {
            assert_eq!(status(&host.request("POST", "/seed", "", "[]")), 403);
        }
    }
}

#[test]
fn full_poll_admission_preserves_short_request_progress() {
    let host = Host::new(true);
    let mut polls = Vec::new();
    for _ in 0..WAIT_WORKERS {
        let mut stream = TcpStream::connect(host.address).unwrap();
        stream.write_all(b"GET /changes?since=0&wait=25 HTTP/1.1\r\nHost: localhost\r\nx-snapback-persona: alice\r\nConnection: close\r\n\r\n").unwrap();
        polls.push(stream);
    }
    wait_until(|| host.admission.waiters.load(Ordering::Acquire) == WAIT_WORKERS);
    let started = Instant::now();
    let response = host.request("GET", "/schema", "x-snapback-persona: alice\r\n", "");
    assert_eq!(status(&response), 200);
    assert!(started.elapsed() < Duration::from_secs(1));
    let mut extra = TcpStream::connect(host.address).unwrap();
    extra
        .set_read_timeout(Some(Duration::from_secs(1)))
        .unwrap();
    extra.write_all(b"GET /changes?wait=25 HTTP/1.1\r\nHost: localhost\r\nx-snapback-persona: alice\r\n\r\n").unwrap();
    assert_closed(&mut extra);
    assert_eq!(host.admission.waiters.load(Ordering::Acquire), WAIT_WORKERS);
    *host.shared.seq.lock().unwrap() = 1;
    host.shared.committed.notify_all();
    wait_until(|| host.admission.waiters.load(Ordering::Acquire) == 0);
}

#[test]
fn change_polls_and_effect_claims_share_the_bounded_wait_lane() {
    assert!(is_waiter(&Method::Get, "/changes"));
    assert!(is_waiter(&Method::Post, "/effects/claim"));
    assert!(!is_waiter(&Method::Get, "/effects/claim"));
    assert!(!is_waiter(&Method::Post, "/q/short"));
}

#[test]
fn refresh_rotates_and_logout_all_revokes_every_session() {
    let host = Host::new(false);
    let first = body(&host.request("POST", "/auth/guest", "", "{}"));
    let old_token = first["session"]["token"].as_str().unwrap().to_owned();
    let principal = first["session"]["principal"].as_str().unwrap().to_owned();
    let old_bearer = format!("Authorization: Bearer {old_token}\r\n");

    let refreshed = body(&host.request("POST", "/auth/refresh", &old_bearer, "{}"));
    let new_token = refreshed["session"]["token"].as_str().unwrap().to_owned();
    assert_ne!(new_token, old_token);
    assert_eq!(refreshed["session"]["principal"], principal);
    assert_eq!(
        status(&host.request("GET", "/schema", &old_bearer, "")),
        401
    );

    let second = {
        let engine = host.shared.engine.lock().unwrap();
        snapback4_core::identity::open_session(
            engine.store(),
            &principal,
            "guest",
            snapback4_core::now_ms(),
        )
        .unwrap()
    };
    let new_bearer = format!("Authorization: Bearer {new_token}\r\n");
    let ended = body(&host.request("POST", "/auth/logout-all", &new_bearer, "{}"));
    assert_eq!(ended["ok"], true);
    assert_eq!(ended["revoked"], 2);
    assert_eq!(
        status(&host.request("GET", "/schema", &new_bearer, "")),
        401
    );
    let second_bearer = format!("Authorization: Bearer {}\r\n", second.token);
    assert_eq!(
        status(&host.request("GET", "/schema", &second_bearer, "")),
        401
    );
}

#[test]
fn a_poll_rechecks_session_liveness_after_waiting() {
    let host = Host::new(false);
    let session = body(&host.request("POST", "/auth/guest", "", "{}"));
    let bearer = format!(
        "Authorization: Bearer {}\r\n",
        session["session"]["token"].as_str().unwrap()
    );
    let headers = bearer.clone();
    let address = host.address;
    let poll = thread::spawn(move || {
        exchange(
            address,
            &format!(
                "GET /changes?since=0&wait=25 HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n{headers}\r\n"
            ),
        )
    });
    wait_until(|| host.admission.waiters.load(Ordering::Acquire) == 1);
    assert_eq!(
        status(&host.request("POST", "/auth/logout", &bearer, "{}")),
        200
    );
    *host.shared.seq.lock().unwrap() = 1;
    host.shared.committed.notify_all();
    assert_eq!(status(&poll.join().unwrap()), 401);
}

#[test]
fn effect_http_strictly_validates_present_fields_without_mutating_work() {
    let source = "use personas alice\neffect mail retry 2\nmutation send():\n  emit mail {n: 1}\n";
    let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(), source);
    let malformed_claim = host.request("POST", "/effects/claim", "", "[]");
    assert_eq!(status(&malformed_claim), 400); assert_eq!(body(&malformed_claim)["denied"]["code"], "E_INPUT");
    let malformed_settle = host.request("POST", "/effects/not-yet/done", "", "[]");
    assert_eq!(status(&malformed_settle), 400); assert_eq!(body(&malformed_settle)["denied"]["code"], "E_INPUT");
    let malformed_step = host.request("POST", "/effects/not-yet/steps/provider/begin", "", r#"{"input":null,"reconcile":"false"}"#);
    assert_eq!(status(&malformed_step), 400); assert_eq!(body(&malformed_step)["denied"]["code"], "E_INPUT");

    let emitted = body(&host.request("POST", "/m/send", "x-snapback-persona: alice\r\n", r#"{"id":"01ARZ3NDEKTSV4RRFFQ69G5FAV","args":{}}"#));
    assert_eq!(emitted["state"], "sent", "{emitted}");
    let service = { let engine = lock(&host.shared.engine);
        snapback4_core::identity::service_session(engine.store(), "worker", host.shared.now(), 1).unwrap() };
    let bearer = format!("Authorization: Bearer {}\r\n", service.token);
    let id = { lock(&host.shared.engine).effects(Some("queued"), 1).unwrap().remove(0).id };
    let queued = effect_snapshot(&host, &id);
    let engine_guard = lock(&host.shared.engine);
    let address = host.address;
    let malformed_bearer = bearer.clone();
    let (response_tx, response_rx) = mpsc::channel();
    let malformed_worker = thread::spawn(move || {
        let malformed = r#"{"effect":17}"#;
        let response = exchange(address, &format!(
            "POST /effects/claim HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: {}\r\n{malformed_bearer}\r\n{malformed}", malformed.len()
        ));
        let _ = response_tx.send(response);
    });
    let prompt_response = response_rx.recv_timeout(Duration::from_secs(2));
    drop(engine_guard);
    let joined = malformed_worker.join();
    assert!(joined.is_ok(), "malformed claim request thread panicked");
    let prompt_response = prompt_response.expect("malformed claim waited for the engine mutex");
    assert_eq!(status(&prompt_response), 400); assert_eq!(body(&prompt_response)["denied"]["code"], "E_INPUT");
    assert_eq!(effect_snapshot(&host, &id), queued, "pre-mutex malformed claim mutated work");
    for malformed in [
        r#"{"effect":17,"fenced":"true"}"#,
        r#"{"fenced":"true"}"#,
        r#"{"limit":"1"}"#,
        r#"{"lease":"60"}"#,
        r#"{"wait":"0"}"#,
        r#"{"effect":"mail","fenced":true,"declarationContract":17}"#,
        r#"{"declarationContract":"stale"}"#,
        r#"{"effect":"mail","declarationContract":"stale"}"#,
        r#"{"effect":"","fenced":true,"declarationContract":"stale"}"#,
        r#"{"effect":"mail","fenced":false,"declarationContract":"stale"}"#,
    ] {
        let response = host.request("POST", "/effects/claim", &bearer, malformed);
        assert_eq!(status(&response), 400, "{response}");
        assert_eq!(body(&response)["denied"]["code"], "E_INPUT");
        assert_eq!(effect_snapshot(&host, &id), queued, "malformed claim mutated the row: {malformed}");
    }
    let declaration = { let engine = lock(&host.shared.engine);
        engine.schema().effect_specs["mail"].effect_declaration_contract("mail") };
    let claim_body = json!({"effect":"mail", "fenced":true, "declarationContract":declaration.clone()}).to_string();
    let claimed = body(&host.request("POST", "/effects/claim", &bearer, &claim_body));
    let effect = &claimed["effects"][0];
    assert_eq!(effect["id"], id);
    assert_eq!(effect["declarationContract"], declaration);
    let lease = effect["leaseToken"].as_str().unwrap();
    let begin_path = format!("/effects/{id}/steps/provider/begin");
    let missing = body(&host.request("POST", &begin_path, &bearer, r#"{"input":{"n":1}}"#));
    assert_eq!(missing["denied"]["code"], "E_EFFECT_LEASE");
    let duplicate = format!("{bearer}x-snapback-effect-lease: {lease}\r\nx-snapback-effect-lease: {lease}\r\n");
    assert_eq!(body(&host.request("POST", &begin_path, &duplicate, r#"{"input":{"n":1}}"#))["denied"]["code"], "E_EFFECT_LEASE");
    let held = format!("{bearer}x-snapback-effect-lease: {lease}\r\n");
    let running = effect_snapshot(&host, &id);
    let status_path = format!("/effects/{id}/status");
    for headers in [bearer.clone(), format!("{bearer}x-snapback-effect-lease: \r\n"), format!("{held}x-snapback-effect-lease: {lease}\r\n")] {
        let answer = body(&host.request("POST", &status_path, &headers, "{}"));
        assert_eq!(answer["denied"]["code"], "E_EFFECT_LEASE");
        assert_eq!(effect_snapshot(&host, &id), running);
    }
    let wrong = format!("{bearer}x-snapback-effect-lease: wrong\r\n");
    assert_eq!(body(&host.request("POST", &status_path, &wrong, "{}"))["denied"]["code"], "E_EFFECT_LEASE");
    assert_eq!(effect_snapshot(&host, &id), running);
    let status_body = body(&host.request("POST", &status_path, &held, "ignored"));
    assert_eq!(status_body, json!({ "id": id, "attempt": 1, "state": "running", "deadline": null, "cancelled": false, "errorCode": null }));
    let malformed_status = host.request("POST", "/effects/bad%FF/status", &held, "{}");
    assert_eq!(status(&malformed_status), 400); assert_eq!(body(&malformed_status)["denied"]["code"], "E_INPUT");
    assert_eq!(effect_snapshot(&host, &id), running);
    let park_path = format!("/effects/{id}/steps/provider/park");
    let failed_path = format!("/effects/{id}/failed");
    for (path, malformed) in [
        (&begin_path, r#"{"input":{"n":1},"reconcile":"false"}"#),
        (&park_path, r#"{"error":17}"#),
        (&failed_path, r#"{"retry":"false"}"#),
    ] {
        let response = host.request("POST", path, &held, malformed);
        assert_eq!(status(&response), 400, "{response}");
        assert_eq!(body(&response)["denied"]["code"], "E_INPUT");
        assert_eq!(effect_snapshot(&host, &id), running, "malformed settlement or step mutated work: {malformed}");
    }
    assert_eq!(body(&host.request("POST", &begin_path, &held, r#"{"input":{"n":1}}"#))["step"]["state"], "run");
    let done_path = format!("/effects/{id}/steps/provider/done");
    assert_eq!(body(&host.request("POST", &done_path, &held, r#"{"result":{"ok":true}}"#))["step"]["state"], "done");
    assert_eq!(body(&host.request("POST", &format!("/effects/{id}/done"), &held, "{}"))["ok"], true);
}

#[test]
fn an_effect_claim_rechecks_service_session_after_waiting() {
    let host = Host::new(false);
    let token = {
        let engine = host.shared.engine.lock().unwrap();
        snapback4_core::identity::service_session(
            engine.store(),
            "worker",
            snapback4_core::now_ms(),
            1,
        )
        .unwrap()
        .token
    };
    let (woke_tx, woke_rx) = mpsc::channel();
    let release = Arc::new((Mutex::new(false), Condvar::new()));
    let release_at_wait = release.clone();
    *host.shared.effect_wait.lock().unwrap() = Some(Arc::new(move || {
        woke_tx.send(()).unwrap();
        let (lock, ready) = &*release_at_wait;
        let mut released = lock.lock().unwrap();
        while !*released {
            released = ready.wait(released).unwrap();
        }
    }));

    let address = host.address;
    let bearer = format!("Authorization: Bearer {token}\r\n");
    let worker = thread::spawn(move || {
        exchange(
            address,
            &format!(
                "POST /effects/claim HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: 10\r\n{bearer}\r\n{{\"wait\":1}}"
            ),
        )
    });
    woke_rx.recv_timeout(Duration::from_secs(3)).unwrap();
    {
        let engine = host.shared.engine.lock().unwrap();
        snapback4_core::identity::close_session(engine.store(), &token).unwrap();
    }
    let (lock, ready) = &*release;
    *lock.lock().unwrap() = true;
    ready.notify_all();

    let response = worker.join().unwrap();
    assert_eq!(status(&response), 401, "{response}");
    assert_eq!(body(&response)["denied"]["code"], "E_AUTH");
}

fn quick_limits() -> tiny_http::ConnectionLimits {
    tiny_http::ConnectionLimits {
        max_connections: 2,
        idle_timeout: Duration::from_millis(150),
        header_timeout: Duration::from_millis(300),
        body_timeout: Duration::from_millis(300),
        write_timeout: Duration::from_millis(300),
        max_header_bytes: 1024,
    }
}
fn assert_closed(stream: &mut TcpStream) {
    let mut bytes = [0; 1];
    match stream.read(&mut bytes) {
        Ok(0) => {}
        Err(error)
            if matches!(
                error.kind(),
                io::ErrorKind::ConnectionReset
                    | io::ErrorKind::ConnectionAborted
                    | io::ErrorKind::BrokenPipe
            ) => {}
        result => panic!("expected the overloaded or expired socket to close: {result:?}"),
    }
}

#[test]
fn connections_are_capped_before_slow_headers_and_idle_sockets_expire() {
    let server = Server::http_with_limits(("127.0.0.1", 0), quick_limits()).unwrap();
    let address = server.server_addr().to_ip().unwrap();
    let first = TcpStream::connect(address).unwrap();
    let second = TcpStream::connect(address).unwrap();
    wait_until(|| server.num_connections() == 2);
    let mut third = TcpStream::connect(address).unwrap();
    third
        .set_read_timeout(Some(Duration::from_secs(1)))
        .unwrap();
    assert_closed(&mut third);
    assert_eq!(server.num_connections(), 2);
    wait_until(|| server.num_connections() == 0);
    drop((first, second));
}

#[test]
fn header_and_body_deadlines_are_absolute_despite_dribbling() {
    for headers in [true, false] {
        let server = Server::http_with_limits(("127.0.0.1", 0), quick_limits()).unwrap();
        let address = server.server_addr().to_ip().unwrap();
        let mut stream = TcpStream::connect(address).unwrap();
        stream
            .set_write_timeout(Some(Duration::from_secs(1)))
            .unwrap();
        stream
            .write_all(if headers {
                b"GET / HTTP/1.1\r\nX-Dribble: "
            } else {
                b"POST / HTTP/1.1\r\nHost: localhost\r\nContent-Length: 2048\r\n\r\n"
            })
            .unwrap();
        let (done, finished) = mpsc::channel();
        let worker = if headers {
            None
        } else {
            let mut request = server
                .recv_timeout(Duration::from_secs(1))
                .unwrap()
                .unwrap();
            Some(thread::spawn(move || {
                let result = request.as_reader().read_to_end(&mut Vec::new());
                request.abort();
                done.send(result.is_err()).unwrap();
            }))
        };
        let started = Instant::now();
        let dribble = thread::spawn(move || {
            for _ in 0..30 {
                if stream.write_all(b"x").is_err() {
                    break;
                }
                thread::sleep(Duration::from_millis(35));
            }
        });
        if headers {
            wait_until(|| server.num_connections() == 0);
        } else {
            assert!(finished.recv_timeout(Duration::from_secs(1)).unwrap());
        }
        assert!(started.elapsed() < Duration::from_secs(1));
        dribble.join().unwrap();
        if let Some(worker) = worker {
            worker.join().unwrap();
        }
    }
}

#[test]
fn continue_and_final_response_have_separate_write_deadlines() {
    use std::io::{BufRead, BufReader};
    let limits = tiny_http::ConnectionLimits {
        idle_timeout: Duration::from_secs(2),
        body_timeout: Duration::from_secs(2),
        write_timeout: Duration::from_millis(100),
        ..quick_limits()
    };
    let server = Server::http_with_limits(("127.0.0.1", 0), limits).unwrap();
    let mut stream = TcpStream::connect(server.server_addr().to_ip().unwrap()).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    stream.write_all(b"POST / HTTP/1.1\r\nHost: localhost\r\nExpect: 100-continue\r\nConnection: close\r\nContent-Length: 4\r\n\r\n").unwrap();
    let mut request = server
        .recv_timeout(Duration::from_secs(1))
        .unwrap()
        .unwrap();
    let worker = thread::spawn(move || {
        let mut bytes = Vec::new();
        request.as_reader().read_to_end(&mut bytes).unwrap();
        assert_eq!(bytes, b"body");
        request.respond(Response::from_string("accepted")).unwrap();
    });
    let mut reader = BufReader::new(stream.try_clone().unwrap());
    let mut interim = String::new();
    loop {
        let mut line = String::new();
        assert!(reader.read_line(&mut line).unwrap() > 0);
        interim.push_str(&line);
        if line == "\r\n" {
            break;
        }
    }
    assert_eq!(status(&interim), 100);
    thread::sleep(Duration::from_millis(250));
    stream.write_all(b"body").unwrap();
    let mut response = String::new();
    reader.read_to_string(&mut response).unwrap();
    assert_eq!(status(&response), 200);
    assert!(response.ends_with("accepted"));
    worker.join().unwrap();
}

#[test]
fn unauthorized_large_posts_close_before_body_admission() {
    let host = Host::new(false);
    for (path, length, expected) in [
        ("/assets", 64 << 20, 401),
        ("/seed", 16 << 20, 403),
        ("/q/who", 1 << 20, 401),
    ] {
        // Leave the sending half open: a rejected request must not wait for
        // the body, send 100 Continue, or occupy a connection until timeout.
        let started = Instant::now();
        let response = exchange(
            host.address,
            &format!(
                "POST {path} HTTP/1.1\r\nHost: localhost\r\nContent-Length: {length}\r\nExpect: 100-continue\r\n\r\n"
            ),
        );
        assert_eq!(status(&response), expected, "{response}");
        assert!(!response.contains("100 Continue"));
        assert!(started.elapsed() < Duration::from_secs(1));
        wait_until(|| host.server.num_connections() == 0);
        assert_eq!(host.shared.uploads.load(Ordering::SeqCst), 0);
    }
}

#[test]
fn slow_readers_cannot_pin_response_writers() {
    let server = Server::http_with_limits(("127.0.0.1", 0), quick_limits()).unwrap();
    let mut stream = TcpStream::connect(server.server_addr().to_ip().unwrap()).unwrap();
    stream
        .write_all(b"GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
        .unwrap();
    let request = server
        .recv_timeout(Duration::from_secs(1))
        .unwrap()
        .unwrap();
    let (done, finished) = mpsc::channel();
    let worker = thread::spawn(move || {
        let response = Response::new(
            tiny_http::StatusCode(200),
            vec![],
            io::repeat(b'x').take(64 << 20),
            Some(64 << 20),
            None,
        );
        let _ = request.respond(response);
        done.send(()).unwrap();
    });
    finished
        .recv_timeout(Duration::from_secs(2))
        .expect("response write deadline");
    worker.join().unwrap();
}

#[test]
fn bounded_connections_do_not_queue_pipelined_requests() {
    let server = Server::http_with_limits(("127.0.0.1", 0), quick_limits()).unwrap();
    let mut stream = TcpStream::connect(server.server_addr().to_ip().unwrap()).unwrap();
    stream.write_all(b"GET /one HTTP/1.1\r\nHost: localhost\r\n\r\nGET /two HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n").unwrap();
    let first = server
        .recv_timeout(Duration::from_secs(1))
        .unwrap()
        .unwrap();
    assert_eq!(first.url(), "/one");
    assert!(
        server
            .recv_timeout(Duration::from_millis(50))
            .unwrap()
            .is_none()
    );
    first.respond(Response::empty(200)).unwrap();
    let second = server
        .recv_timeout(Duration::from_secs(1))
        .unwrap()
        .unwrap();
    assert_eq!(second.url(), "/two");
    second.respond(Response::empty(200)).unwrap();
}

#[derive(Default)]
struct WorkGate {
    entered: AtomicUsize,
    open: Mutex<bool>,
    changed: Condvar,
}
impl WorkGate {
    fn park(&self) {
        self.entered.fetch_add(1, Ordering::AcqRel);
        let mut open = self.open.lock().unwrap();
        while !*open {
            open = self.changed.wait(open).unwrap();
        }
    }
    fn release(&self) {
        *self.open.lock().unwrap() = true;
        self.changed.notify_all();
    }
}
struct ReleaseGate(Arc<WorkGate>);
impl Drop for ReleaseGate {
    fn drop(&mut self) {
        self.0.release();
    }
}

#[test]
fn password_work_is_bounded_and_does_not_hold_the_query_engine() {
    for route in ["/auth/signup", "/auth/login"] {
        let host = Host::new(false);
        let guest = body(&host.request("POST", "/auth/guest", "", "{}"));
        let headers = format!("Authorization: Bearer {}\r\n", guest["session"]["token"].as_str().unwrap());
        if route == "/auth/login" {
            for n in 0..2 {
                let payload = format!(
                    r#"{{"email":"user{n}@example.com","password":"correct horse battery staple"}}"#
                );
                let signup = host.request("POST", "/auth/signup", "", &payload);
                assert!(body(&signup)["session"].is_object(), "{signup}");
            }
        }
        let gate = Arc::new(WorkGate::default());
        let _release_on_panic = ReleaseGate(gate.clone());
        let hook = gate.clone();
        *host.shared.auth_work.lock().unwrap() = Some(Arc::new(move || hook.park()));
        let mut jobs = Vec::new();
        for n in 0..2 {
            let address = host.address;
            jobs.push(thread::spawn(move || {
                let body = format!(r#"{{"email":"user{n}@example.com","password":"correct horse battery staple"}}"#);
                exchange(address, &format!("POST {route} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}", body.len()))
            }));
        }
        wait_until(|| gate.entered.load(Ordering::Acquire) == 2);
        let third = host.request(
            "POST",
            route,
            "",
            r#"{"email":"third@example.com","password":"correct horse battery staple"}"#,
        );
        assert_eq!(status(&third), 429);
        assert_eq!(body(&third)["denied"]["code"], "E_RATE_LIMIT");
        assert_eq!(body(&third)["denied"]["retryable"], true);
        let query = host.request("POST", "/q/who", &headers, "{}");
        assert_eq!(body(&query)["data"], guest["session"]["principal"]);
        assert_eq!(
            gate.entered.load(Ordering::Acquire),
            2,
            "queries finished while both password workers remained parked"
        );
        gate.release();
        for job in jobs {
            let response = job.join().unwrap();
            assert!(
                body(&response)["session"]["token"].is_string(),
                "{response}"
            );
        }
    }
}

#[test]
fn dev_loopback_admits_eight_simultaneous_sign_ins_within_host_capacity() {
    let host = Host::new(true);
    let payload = r#"{"email":"parallel@example.com","password":"correct horse battery staple"}"#;
    let signup = body(&host.request("POST", "/auth/signup", "", payload));
    assert!(signup["session"]["token"].is_string(), "{signup}");
    let gate = Arc::new(WorkGate::default());
    let _release_on_panic = ReleaseGate(gate.clone());
    let hook = gate.clone();
    *host.shared.auth_work.lock().unwrap() = Some(Arc::new(move || hook.park()));
    // Smaller hosts must still respect their physical limit; this host runs
    // eight at once whenever available_parallelism supplies at least eight.
    let concurrent = thread::available_parallelism().map(|n| n.get().clamp(2, 8)).unwrap_or(2);
    let jobs: Vec<_> = (0..concurrent).map(|_| {
        let address = host.address;
        thread::spawn(move || exchange(address, &format!("POST /auth/login HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{payload}", payload.len())))
    }).collect();
    wait_until(|| gate.entered.load(Ordering::Acquire) == concurrent);
    let query = host.request("POST", "/q/who", "x-snapback-persona: alice\r\n", "{}");
    assert_eq!(body(&query)["data"], "dev:alice");
    gate.release();
    for job in jobs {
        let response = job.join().unwrap();
        let result = body(&response);
        assert_eq!(status(&response), 200, "{response}");
        assert!(result["session"]["token"].is_string(), "{response}");
        assert_eq!(result["session"]["principal"], signup["session"]["principal"]);
        assert!(result.get("denied").is_none(), "{response}");
    }
}

#[test]
fn upload_disk_work_is_bounded_and_does_not_hold_the_query_engine() {
    let host = Host::new(true);
    let gate = Arc::new(WorkGate::default());
    let _release_on_panic = ReleaseGate(gate.clone());
    let hook = gate.clone();
    *host.shared.upload_work.lock().unwrap() = Some(Arc::new(move || hook.park()));
    let mut wire = b"POST /assets HTTP/1.1\r\nHost: localhost\r\nx-snapback-persona: alice\r\nConnection: close\r\nContent-Length: 24\r\n\r\n".to_vec();
    wire.extend_from_slice(
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR\x00\x00\x00\x01\x00\x00\x00\x01",
    );
    let jobs: Vec<_> = (0..2)
        .map(|_| {
            let address = host.address;
            let wire = wire.clone();
            thread::spawn(move || exchange_bytes(address, &wire))
        })
        .collect();
    wait_until(|| gate.entered.load(Ordering::Acquire) == 2);
    let third = exchange_bytes(host.address, &wire);
    assert_eq!(status(&third), 429);
    let query = host.request("POST", "/q/who", "x-snapback-persona: alice\r\n", "{}");
    assert_eq!(body(&query)["data"], "dev:alice");
    assert_eq!(host.shared.uploads.load(Ordering::Acquire), 2);
    gate.release();
    for job in jobs {
        let response = job.join().unwrap();
        let result = body(&response);
        let id = result["asset"]["id"]
            .as_str()
            .unwrap_or_else(|| panic!("{response}"));
        let path = host
            .shared
            .engine
            .lock()
            .unwrap()
            .store()
            .assets_dir()
            .join(id);
        assert_eq!(std::fs::read(&path).unwrap().len(), 24);
        let missed = host.request(
            "GET",
            &format!("/assets/{id}"),
            "x-snapback-persona: alice\r\nRange: bytes=999-1000\r\n",
            "",
        );
        assert_eq!(status(&missed), 416, "{missed}");
        assert!(missed.contains("Content-Range: bytes */24"), "{missed}");
        assert!(
            missed.contains("Cache-Control: private, no-store"),
            "{missed}"
        );
        let full = host.request(
            "GET",
            &format!("/assets/{id}"),
            "x-snapback-persona: alice\r\n",
            "",
        );
        assert_eq!(status(&full), 200, "{full}");
        assert!(full.contains("Cache-Control: private, no-store"), "{full}");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
            assert_eq!(
                std::fs::metadata(path.parent().unwrap())
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o700
            );
        }
    }
}

#[cfg(unix)]
#[test]
fn opening_a_development_project_protects_its_data_directory_and_store() {
    use std::os::unix::fs::PermissionsExt;
    let id = snapback4_core::ids::mint(snapback4_core::now_ms(), &mut 0).unwrap();
    let project = Project {
        root: std::env::temp_dir().join(format!("snapback4-http-permissions-{id}")),
    };
    std::fs::create_dir_all(project.data_dir()).unwrap();
    std::fs::set_permissions(project.data_dir(), std::fs::Permissions::from_mode(0o755)).unwrap();
    let bound = snapback4_lang::compile(&[("schema.q".into(), SCHEMA.into())]);
    let engine = project.open_engine(&bound).unwrap();
    assert_eq!(
        std::fs::metadata(project.data_dir())
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o700
    );
    assert_eq!(
        std::fs::metadata(project.store_path())
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
    assert_eq!(
        std::fs::metadata(engine.store().assets_dir())
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o700
    );
    for suffix in ["-wal", "-shm", "-journal"] {
        if let Ok(metadata) =
            std::fs::metadata(format!("{}{suffix}", project.store_path().display()))
        {
            assert_eq!(metadata.permissions().mode() & 0o777, 0o600);
        }
    }
    drop(engine);
    std::fs::remove_dir_all(project.root).unwrap();
}


struct ReaderTestDirectory(std::path::PathBuf);
impl ReaderTestDirectory {
    fn new() -> Self {
        let unique = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let path = std::env::temp_dir().join(format!("sb4-reader-reuse-{}-{unique}", std::process::id()));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }
    fn host(&self) -> Host {
        Host::with_store(true, snapback4_core::Store::open(&self.0.join("store.sqlite")).unwrap(), READER_SCHEMA)
    }
}
impl Drop for ReaderTestDirectory {
    fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
}

const READER_SCHEMA: &str = r#"use identity guests

table privateProducts:
  ownerId: principal
  sku: text 1..40
  category: text 1..20
  price: int
  title: text <=200
  revision: int
  unique byOwnerSku: ownerId, sku
  unique byOwnerCategoryPrice: ownerId, category, price, sku
  immutable ownerId, sku, category, price, title
  read <- .ownerId = viewer
  insert <- deny
  update <- .ownerId = viewer
  delete <- deny

query point(sku: text 1..40):
  return privateProducts[viewer, sku] by byOwnerSku { sku, category, price, title, revision }

query category(category: text 1..20, c: cursor ?):
  return privateProducts[viewer, category] after c first 50 by byOwnerCategoryPrice
    { sku, category, price, title, revision }

query all(c: cursor ?):
  return privateProducts[viewer] after c first 1000 by byOwnerSku
    { sku, category, price, title, revision }

mutation bump(sku: text 1..40):
  row = privateProducts[viewer, sku] by byOwnerSku ! else NOT_FOUND
  update privateProducts[row] { revision: row.revision + 1 }
  return { sku: row.sku, revision: row.revision + 1 }

query version():
  return 1
"#;

#[test]
fn pooled_readers_observe_new_commits_and_each_viewer() {
    let directory = ReaderTestDirectory::new();
    let host = directory.host();
    let seed = json!([
        {"table":"privateProducts","row":{"id":"alice-row","ownerId":"dev:alice","sku":"one","category":"c007","price":1,"title":"Alice","revision":1}},
        {"table":"privateProducts","row":{"id":"bob-row","ownerId":"dev:bob","sku":"one","category":"c007","price":2,"title":"Bob","revision":700}}
    ]);
    assert_eq!(body(&host.request("POST", "/seed", "", &seed.to_string()))["seeded"], 2);
    let point = |viewer: &str| {
        let response = host.request("POST", "/q/point", &format!("x-snapback-persona: {viewer}\r\n"), r#"{"args":{"sku":"one"}}"#);
        assert_eq!(status(&response), 200, "{response}");
        let reply = body(&response);
        assert!(reply.get("denied").is_none(), "{reply}");
        assert_eq!(reply["complete"], true);
        assert_eq!(reply["viewer"], format!("dev:{viewer}"));
        assert!(reply.get("data").is_some(), "{reply}");
        reply
    };
    assert_eq!(point("alice")["data"]["revision"], 1);
    assert_eq!(lock(&host.shared.readers).idle.len(), 1);
    assert_eq!(point("bob")["data"]["revision"], 700);
    let written = body(&host.request("POST", "/m/bump", "x-snapback-persona: alice\r\n", r#"{"id":"reader-reuse-bump","args":{"sku":"one"}}"#));
    assert_eq!(written["state"], "sent", "{written}");
    assert_eq!(point("alice")["data"]["revision"], 2);
    assert_eq!(point("bob")["data"]["revision"], 700);
    assert_eq!(point("outsider")["data"], Json::Null);
    assert_eq!(lock(&host.shared.readers).idle.len(), 1);
}

#[test]
fn pooled_readers_discard_old_loans_after_backend_or_native_epoch_changes() {
    let directory = ReaderTestDirectory::new();
    let host = directory.host();
    let version = || body(&host.request("POST", "/q/version", "x-snapback-persona: alice\r\n", "{}"));
    assert_eq!(version()["data"], 1);
    let (epoch, mut old) = {
        let engine = lock(&host.shared.engine);
        lock(&host.shared.readers).take(&engine).unwrap()
    };
    let bound = snapback4_lang::compile(&[("schema.q".into(), READER_SCHEMA.replace("return 1", "return 2"))]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    {
        let mut engine = lock(&host.shared.engine);
        let next = engine.adopt(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
        lock(&host.shared.readers).invalidate();
        *lock(&host.shared.bound) = bound;
        *lock(&host.shared.generation) = next;
    }
    let refused = old.query("version", Context::new("dev:alice", BTreeMap::new())).unwrap_err();
    assert_eq!(refused.code, "E_GENERATION");
    lock(&host.shared.readers).put(&epoch, old);
    assert!(lock(&host.shared.readers).idle.is_empty());
    assert_eq!(version()["data"], 2);
    let (epoch, reader, generation) = {
        let engine = lock(&host.shared.engine);
        let (epoch, reader) = lock(&host.shared.readers).take(&engine).unwrap();
        (epoch, reader, engine.generation())
    };
    // A native-only replacement also invalidates loans even if the stored
    // schema generation stays equal. This checks the epoch boundary only;
    // it does not claim to execute a native-module rebuild.
    lock(&host.shared.readers).invalidate();
    assert_eq!(lock(&host.shared.engine).generation(), generation);
    lock(&host.shared.readers).put(&epoch, reader);
    assert!(lock(&host.shared.readers).idle.is_empty());
    assert_eq!(version()["data"], 2);
}

#[test]
fn sync_snapshot_encoding_preserves_plain_values_and_explicit_nulls() {
    use snapback4_core::{Value, partition::{Event, EventKind}};
    let value = Value::Row(BTreeMap::from([
        ("id".into(), Value::Id("row\"雪".into())),
        ("nested".into(), Value::Map(BTreeMap::from([("items".into(), Value::Array(vec![
            Value::Null, Value::Bool(true), Value::Int(i64::MIN), Value::Int(i64::MAX),
            Value::String("line\n\0".into()), Value::Bytes(vec![0, 15, 255]),
        ]))]).into())),
    ]).into());
    let events = vec![
        Event { partition: "private-partition".into(), table: "items".into(), kind: EventKind::Put, id: "second".into(), data: Some(value) },
        Event { partition: "private-partition".into(), table: "items".into(), kind: EventKind::Del, id: "first".into(), data: None },
    ];
    let held = Some(BTreeMap::from([("items".into(), vec![vec![json!("group"), json!(7)]])]));
    let acknowledged = BTreeMap::from([("write-id".into(), 8)]);
    let reply = SnapshotReply { store_id: "store-a".into(), acknowledged, events: SyncEvents::Snapshot(events), generation: 3, held, more: true, next: Some("opaque-cursor".into()), snapshot: true, watermark: 9 };
    let expected = json!({
        "acknowledged": {"write-id":8}, "events": [
            {"data":{"id":"row\"雪","nested":{"items":[null,true,i64::MIN,i64::MAX,"line\n\0","000fff"]}},"id":"second","kind":"put","table":"items"},
            {"data":null,"id":"first","kind":"del","table":"items"}
        ], "generation":3,"held":{"items":[["group",7]]},"more":true,"next":"opaque-cursor","snapshot":true,"store_id":"store-a","watermark":9
    });
    assert_eq!(serde_json::to_vec(&reply).unwrap(), serde_json::to_vec(&expected).unwrap());
    for held in [None, Some(BTreeMap::new())] {
        let expected = json!({"acknowledged":{},"events":[],"generation":3,"held":held,"more":false,"next":null,"snapshot":true,"store_id":"store-a","watermark":9});
        let reply = SnapshotReply { store_id: "store-a".into(), acknowledged: BTreeMap::new(), events: SyncEvents::Snapshot(vec![]), generation: 3, held, more: false, next: None, snapshot: true, watermark: 9 };
        assert_eq!(serde_json::to_vec(&reply).unwrap(), serde_json::to_vec(&expected).unwrap());
    }
}

#[test]
fn sync_stream_encoding_preserves_sequences_scopes_and_empty_groups() {
    use snapback4_core::{Value, store::LogEvent};
    let events = vec![
        LogEvent { seq: 0, ord: 90, table: "items".into(), kind: "scope".into(), id: "".into(), data: Some(Value::Array(vec![Value::Id("group".into()), Value::Int(7)])) },
        LogEvent { seq: u64::MAX, ord: 91, table: "items".into(), kind: "del".into(), id: "gone".into(), data: None },
        LogEvent { seq: u64::MAX, ord: 92, table: "items".into(), kind: "put".into(), id: "last".into(), data: Some(Value::Row(BTreeMap::from([("n".into(), Value::Int(2))]).into())) },
    ];
    let reply = StreamReply { store_id: "store-a".into(), acknowledged: BTreeMap::from([("write-id".into(), u64::MAX)]), events: SyncEvents::Stream(events), generation: 4, joined: BTreeMap::from([("items".into(), vec![vec![json!("joined")]])]), more: true, snapshot: false, watermark: u64::MAX };
    let expected = json!({
        "acknowledged":{"write-id":u64::MAX},"events":[
            {"data":["group",7],"id":"","kind":"scope","seq":0,"table":"items"},
            {"data":null,"id":"gone","kind":"del","seq":u64::MAX,"table":"items"},
            {"data":{"n":2},"id":"last","kind":"put","seq":u64::MAX,"table":"items"}
        ],"generation":4,"joined":{"items":[["joined"]]},"more":true,"snapshot":false,"store_id":"store-a","watermark":u64::MAX
    });
    assert_eq!(serde_json::to_vec(&reply).unwrap(), serde_json::to_vec(&expected).unwrap());
    let reply = StreamReply { store_id: "store-a".into(), acknowledged: BTreeMap::new(), events: SyncEvents::Stream(vec![]), generation: 4, joined: BTreeMap::new(), more: false, snapshot: false, watermark: 9 };
    let expected = json!({"acknowledged":{},"events":[],"generation":4,"joined":{},"more":false,"snapshot":false,"store_id":"store-a","watermark":9});
    assert_eq!(serde_json::to_vec(&reply).unwrap(), serde_json::to_vec(&expected).unwrap());
}

#[path = "../tests/serve_changes/mod.rs"]
mod review_changes;
