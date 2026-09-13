use super::*;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::sync::mpsc;
use std::thread::{self, JoinHandle};

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
        let bound = snapback4_lang::compile(&[("schema.q".into(), SCHEMA.into())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let mut engine = Engine::memory(
            bound.schema.clone(),
            bound.programs.iter().map(|p| p.program.clone()),
        )
        .unwrap();
        let presence = Arc::new(Live::default());
        engine.set_presence(Some(presence.clone()));
        let generation = engine.generation();
        let shared = Arc::new(Shared {
            engine: Mutex::new(engine),
            bound: Mutex::new(bound),
            generation: Mutex::new(generation),
            committed: Condvar::new(),
            seq: Mutex::new(0),
            personas: dev,
            entropy: Mutex::new(1),
            presence,
            native: Mutex::new(None),
            auth: crate::auth::Admission::default(),
            uploads: AtomicUsize::new(0),
            auth_work: Mutex::new(None),
            upload_work: Mutex::new(None),
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
fn wait_until(mut predicate: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(2);
    while !predicate() {
        assert!(Instant::now() < deadline, "condition did not become true");
        thread::sleep(Duration::from_millis(5));
    }
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
        let host = Host::new(true);
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
        let query = host.request("POST", "/q/who", "x-snapback-persona: alice\r\n", "{}");
        assert_eq!(body(&query)["data"], "dev:alice");
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
