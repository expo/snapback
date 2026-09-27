use super::*;
#[path = "duration.rs"]
mod duration;

const SOURCE: &str = "use server\nuse personas alice\ntable notes:\n  n: int\n  public\n  insert <- allow\n  sync public\nquery read():\n  return {denied: 'user data', state: 'failed'}\nmutation put(n: int):\n  require n >= 0 else NONNEGATIVE\n  return insert notes {n: n}\naction echo()\n";
const PERSONA: &str = "x-snapback-persona: alice\r\n";

fn snapshot(host: &Host) -> Json { body(&host.request("GET", "/dev/latency", "", "")) }
fn counted(host: &Host, name: &str, n: u64) -> Json {
    let started = Instant::now();
    loop {
        let reply = snapshot(host);
        if reply["operations"][name]["n"] == n { return reply; }
        assert!(started.elapsed() < Duration::from_secs(3), "{reply}");
        thread::yield_now();
    }
}
fn ordered(operation: &Json) {
    for kind in ["total", "wait"] {
        let h = &operation[kind];
        let values: Vec<_> = ["p50", "p95", "p99", "max"].iter().map(|key| h[key].as_f64().unwrap()).collect();
        assert!(values.windows(2).all(|w| w[0] <= w[1]), "{operation}");
    }
}

#[test]
fn latency_counts_queries_mutations_actions_fixed_routes_and_typed_refusals() {
    let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(), SOURCE);
    for _ in 0..7 { assert_eq!(body(&host.request("POST", "/q/read", PERSONA, r#"{"args":{}}"#))["data"]["state"], "failed"); }
    for n in 0..4 {
        assert_eq!(body(&host.request("POST", "/m/put", PERSONA, &json!({"id":format!("put-{n}"),"args":{"n":n}}).to_string()))["state"], "sent");
    }
    let refused = host.request("POST", "/m/put", PERSONA, r#"{"id":"refused","args":{"n":-1}}"#);
    assert_eq!(status(&refused), 200, "a logical refusal is not an HTTP error");
    assert_eq!(body(&refused)["state"], "failed");
    // Both a fresh and replayed refusal count as requests.
    host.request("POST", "/m/put", PERSONA, r#"{"id":"refused","args":{"n":-1}}"#);
    host.request("POST", "/a/echo?wait=0", PERSONA, r#"{"id":"action","args":{}}"#);
    host.request("POST", "/a/echo?wait=0", PERSONA, r#"{}"#);
    host.request("POST", "/sync", PERSONA, r#"{}"#);
    host.request("GET", "/changes?wait=0", PERSONA, "");
    host.request("POST", "/assets", PERSONA, "");
    host.request("GET", "/assets/missing", PERSONA, "");
    let result = counted(&host, "/assets (download)", 1);
    let operations = &result["operations"];
    for (name, n, refused) in [("/q/read",7,0), ("/m/put",6,2), ("/a/echo",2,1), ("/sync",1,0), ("/changes",1,0), ("/assets (upload)",1,1), ("/assets (download)",1,1)] {
        assert_eq!(operations[name]["n"], n, "{name}: {operations}");
        assert_eq!(operations[name]["refused"], refused, "{name}: {operations}");
        ordered(&operations[name]);
    }
    assert!(result["since"].as_i64().unwrap() > 0);
    assert!(result.get("rows").is_none());
    assert_eq!(status(&host.request("POST", "/dev/latency/reset?store_id=stale", "", "")), 409);
    assert_eq!(snapshot(&host)["operations"]["/q/read"]["n"], 7);
    let reset = body(&host.request("POST", "/dev/latency/reset", "", ""));
    assert!(reset["since"].as_i64() >= result["since"].as_i64());
    assert!(reset["operations"].as_object().unwrap().values().all(|op| op["n"] == 0 && op["refused"] == 0 && op["total"]["max"] == 0.0));
    host.request("POST", "/q/read", PERSONA, "{}");
    assert_eq!(counted(&host, "/q/read", 1)["operations"]["/m/put"]["n"], 0);
}

#[test]
fn latency_engine_wait_is_attributed_to_its_request_and_dev_inspection_never_waits() {
    let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(), SOURCE);
    let engine = lock(&host.shared.engine);
    let address = host.address;
    let read = thread::spawn(move || exchange(address, "POST /q/read HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nx-snapback-persona: alice\r\nContent-Length: 2\r\n\r\n{}"));
    let started = Instant::now();
    while host.shared.engine.queued() < 2 {
        assert!(started.elapsed() < Duration::from_secs(3)); thread::yield_now();
    }
    // These complete while the test still owns the engine: a lock regression
    // fails the HTTP timeout rather than depending on a tight speed threshold.
    assert_eq!(status(&host.request("GET", "/dev/status", "", "")), 200);
    assert_eq!(status(&host.request("GET", "/dev/latency", "", "")), 200);
    assert_eq!(status(&host.request("POST", "/assets", "Origin: https://evil.example\r\n", "")), 403);
    thread::sleep(Duration::from_millis(120));
    drop(engine);
    assert_eq!(status(&read.join().unwrap()), 200);
    let result = counted(&host, "/q/read", 1);
    assert!(result["operations"]["/q/read"]["wait"]["max"].as_f64().unwrap() >= 120.0, "{result}");
    assert_eq!(result["operations"]["/assets (upload)"]["wait"]["max"], 0.0);
}

#[test]
fn latency_reset_excludes_requests_that_arrived_in_the_previous_window() {
    let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(), SOURCE);
    let engine = lock(&host.shared.engine);
    let address = host.address;
    let read = thread::spawn(move || exchange(address, "POST /q/read HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nx-snapback-persona: alice\r\nContent-Length: 2\r\n\r\n{}"));
    let started = Instant::now();
    while host.shared.engine.queued() < 2 { assert!(started.elapsed() < Duration::from_secs(3)); thread::yield_now(); }
    host.request("POST", "/dev/latency/reset", "", "");
    drop(engine);
    assert_eq!(status(&read.join().unwrap()), 200);
    host.request("POST", "/q/read", PERSONA, "{}");
    let result = counted(&host, "/q/read", 1);
    assert_eq!(result["operations"]["/q/read"]["refused"], 0);
}

#[test]
fn latency_release_requires_a_live_service_and_never_allows_reset() {
    let host = Host::new(false);
    assert_eq!(status(&host.request("GET", "/dev/latency", "", "")), 401);
    assert_eq!(status(&host.request("GET", "/dev/latency", "x-snapback-persona: alice\r\n", "")), 401);
    let user = body(&host.request("POST", "/auth/guest", "", "{}"));
    let user_header = format!("Authorization: Bearer {}\r\n", user["session"]["token"].as_str().unwrap());
    assert_eq!(status(&host.request("GET", "/dev/latency", &user_header, "")), 401);
    let service = { let engine = lock(&host.shared.engine); snapback4_core::identity::service_session(engine.store(), "worker", host.shared.now(), 1).unwrap() };
    let header = format!("Authorization: Bearer {}\r\n", service.token);
    assert_eq!(status(&host.request("GET", "/dev/latency", &header, "")), 200);
    assert_eq!(status(&host.request("POST", "/dev/latency/reset", &header, "")), 403);
    { let engine = lock(&host.shared.engine); engine.store().conn().execute("UPDATE _sessions SET expires_at = 0", []).unwrap(); }
    assert_eq!(status(&host.request("GET", "/dev/latency", &header, "")), 401);
    assert_eq!(status(&host.request("GET", "/dev/latency", "Authorization: Bearer invalid\r\n", "")), 401);
}

#[test]
fn latency_admission_refusals_do_not_disappear() {
    let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(), SOURCE);
    host.admission.short.store(REQUEST_WORKERS, Ordering::Release);
    let mut stream = TcpStream::connect(host.address).unwrap();
    stream.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
    stream.write_all(b"POST /q/read HTTP/1.1\r\nHost: localhost\r\nContent-Length: 2\r\n\r\n{}").unwrap();
    let mut bytes = Vec::new();
    let _ = stream.read_to_end(&mut bytes);
    host.admission.short.store(0, Ordering::Release);
    assert_eq!(counted(&host, "/q/read", 1)["operations"]["/q/read"]["refused"], 1);
}

#[test]
#[ignore = "measurement: repeated real HTTP reads, no timing gate on a shared host"]
fn latency_recording_overhead_on_real_queries() {
    let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(), SOURCE);
    for _ in 0..100 { host.request("POST", "/q/read", PERSONA, "{}"); }
    let mut on = Vec::new(); let mut off = Vec::new();
    for round in 0..10 {
        for enabled in if round % 2 == 0 { [false, true] } else { [true, false] } {
            host.shared.latency.measure_enabled(enabled);
            let samples = if enabled { &mut on } else { &mut off };
            for _ in 0..200 {
                let start = Instant::now();
                assert_eq!(status(&host.request("POST", "/q/read", PERSONA, "{}")), 200);
                samples.push(start.elapsed().as_secs_f64() * 1_000_000.0);
            }
        }
    }
    on.sort_by(f64::total_cmp); off.sort_by(f64::total_cmp);
    println!("latency overhead HTTP (2000 each, alternating): off p50={:.3}us p95={:.3}us; on p50={:.3}us p95={:.3}us; p50 delta={:.3}us", off[999], off[1899], on[999], on[1899], on[999] - off[999]);
}

#[test]
fn latency_successful_asset_stream_and_range_refusal_are_both_measured() {
    let host = Host::new(true);
    let mut wire = b"POST /assets HTTP/1.1\r\nHost: localhost\r\nx-snapback-persona: alice\r\nConnection: close\r\nContent-Length: 24\r\n\r\n".to_vec();
    wire.extend_from_slice(b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR\x00\x00\x00\x01\x00\x00\x00\x01");
    let uploaded = body(&exchange_bytes(host.address, &wire));
    let id = uploaded["asset"]["id"].as_str().unwrap();
    assert_eq!(status(&host.request("GET", &format!("/assets/{id}"), PERSONA, "")), 200);
    assert_eq!(status(&host.request("GET", &format!("/assets/{id}"), &format!("{PERSONA}Range: bytes=999-1000\r\n"), "")), 416);
    let snapshot = counted(&host, "/assets (download)", 2);
    assert_eq!(snapshot["operations"]["/assets (upload)"]["n"], 1);
    assert_eq!(snapshot["operations"]["/assets (upload)"]["refused"], 0);
    assert_eq!(snapshot["operations"]["/assets (download)"]["refused"], 1);
    ordered(&snapshot["operations"]["/assets (download)"]);
}

// @ref LLP 3000.019#3.6 — writer saturation must leave detached reads and dev inspection available.
#[test]
fn latency_writer_admission_refuses_once_and_keeps_dev_inspection_available() {
    let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(), SOURCE);
    host.admission.mutations.store(MUTATION_WORKERS, Ordering::Release);
    let mut stream = TcpStream::connect(host.address).unwrap();
    stream.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
    stream.write_all(b"POST /m/put HTTP/1.1\r\nHost: localhost\r\nContent-Length: 2\r\n\r\n{}").unwrap();
    let mut bytes = Vec::new();
    let _ = stream.read_to_end(&mut bytes);
    let result = counted(&host, "/m/put", 1);
    assert_eq!(result["operations"]["/m/put"]["refused"], 1);
    assert_eq!(result["operations"]["/m/put"]["wait"]["max"], 0.0);
    assert_eq!(status(&host.request("POST", "/q/read", PERSONA, "{}")), 200);
    assert_eq!(status(&host.request("POST", "/dev/latency/reset", "", "")), 200);
    host.admission.mutations.store(0, Ordering::Release);
}

#[test]
fn latency_detached_checkout_stamps_wait_before_query_work() {
    for bearer in [false, true] {
        let fresh = query_readers::FreshDirectory::new().unwrap();
        let host = Host::with_store(true, fresh.store().unwrap(), SOURCE);
        let headers = if bearer {
            let session = { let engine = lock(&host.shared.engine);
                snapback4_core::identity::service_session(engine.store(), "worker", host.shared.now(), 1).unwrap() };
            format!("Authorization: Bearer {}\r\n", session.token)
        } else { PERSONA.to_owned() };
        // The first checkout follows 100 ms of accepted request work. Query
        // execution then waits another 250 ms; that belongs only to total.
        *lock(&host.shared.request_work) = Some(Arc::new(|| thread::sleep(Duration::from_millis(100))));
        *lock(&host.shared.query_wait) = Some(Arc::new(|| thread::sleep(Duration::from_millis(250))));
        assert_eq!(status(&host.request("POST", "/q/read", &headers, "{}")), 200);
        *lock(&host.shared.request_work) = None;
        let result = counted(&host, "/q/read", 1);
        let sample = &result["operations"]["/q/read"];
        let wait = sample["wait"]["max"].as_f64().unwrap();
        let total = sample["total"]["max"].as_f64().unwrap();
        assert!(wait >= 100.0, "detached checkout missing from wait: {sample}");
        assert!(total - wait >= 250.0, "query work must follow first acquisition: {sample}");
        assert_eq!(sample["refused"], 0);
    }
}
