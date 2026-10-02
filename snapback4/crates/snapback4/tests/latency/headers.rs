use super::*;

pub(super) fn timing(reply: &str) -> Option<BTreeMap<String, f64>> {
    let header = reply.split("\r\n\r\n").next().unwrap().lines()
        .find_map(|line| line.split_once(':').filter(|(name, _)| name.eq_ignore_ascii_case("server-timing")).map(|(_, value)| value))?;
    Some(header.split(',').map(|metric| {
        let (name, duration) = metric.trim().split_once(";dur=").unwrap();
        let duration: f64 = duration.parse().unwrap();
        assert!(duration.is_finite() && duration >= 0.0);
        (name.into(), duration)
    }).collect())
}

#[test]
fn dev_headers_cover_operations_and_refusals_without_data_and_respect_the_fence() {
    let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(), SOURCE);
    for (method, path, payload) in [
        ("POST", "/q/read", "{}"), ("POST", "/q/missing", "{}"),
        ("POST", "/m/put", r#"{"id":"ok","args":{"n":1}}"#),
        ("POST", "/m/put", r#"{"id":"no","args":{"n":-1}}"#),
        ("POST", "/a/echo?wait=0", r#"{"id":"echo","args":{}}"#),
        ("POST", "/sync", "{}"), ("GET", "/changes?wait=0", ""),
        ("POST", "/assets", ""), ("GET", "/assets/missing", ""),
        ("GET", "/probe", ""), ("GET", "/schema", ""),
        ("GET", "/dev/latency", ""), ("OPTIONS", "/q/read", ""),
    ] {
        let reply = host.request(method, path, PERSONA, payload);
        let metrics = timing(&reply).unwrap_or_else(|| panic!("missing timing: {reply}"));
        let keys: Vec<_> = metrics.keys().map(String::as_str).collect();
        assert_eq!(keys, ["cpu", "engine", "total", "wait"]);
        assert!(metrics["engine"] <= metrics["total"] + 0.001, "{metrics:?}");
        assert!(metrics["wait"] <= metrics["total"] + 0.001, "{metrics:?}");
        assert!(reply.to_ascii_lowercase().contains("access-control-expose-headers: server-timing"));
    }
    for origin in ["Origin: https://evil.example\r\n", "Origin: http://localhost.evil:4400\r\n"] {
        let reply = host.request("POST", "/q/read", &format!("{PERSONA}{origin}"), "{}");
        assert_eq!(status(&reply), 403);
        assert!(timing(&reply).is_none());
    }
    let release = Host::with_store(false, snapback4_core::Store::memory().unwrap(), SOURCE);
    for (method, path, payload) in [("GET", "/probe", ""), ("POST", "/q/read", "{}"), ("POST", "/auth/guest", "{}")] {
        assert!(timing(&release.request(method, path, "", payload)).is_none());
    }
    let session = { let engine = lock(&release.shared.engine);
        snapback4_core::identity::service_session(engine.store(), "worker", release.shared.now(), 1).unwrap() };
    let auth = format!("Authorization: Bearer {}\r\n", session.token);
    let reply = release.request("POST", "/q/read", &auth, "{}");
    assert_eq!(body(&reply)["data"]["state"], "failed");
    assert!(timing(&reply).is_none());
}

#[test]
fn reader_header_attributes_engine_sleep_without_waiting_for_a_held_writer() {
    let fresh = query_readers::FreshDirectory::new().unwrap();
    let host = Host::with_store(true, fresh.store().unwrap(), SOURCE);
    // Keep the writer locked for the entire HTTP exchange: a read that waits
    // behind it fails the socket timeout, independent of scheduler speed.
    let writer = lock(&host.shared.engine);
    *lock(&host.shared.query_wait) = Some(Arc::new(|| thread::sleep(Duration::from_millis(150))));
    let reply = host.request("POST", "/q/read", PERSONA, "{}");
    drop(writer);
    let sample = timing(&reply).unwrap();
    assert!(sample["engine"] >= 150.0, "{sample:?}");
    assert!(sample["total"] >= sample["engine"], "{sample:?}");
    assert!(sample["engine"] - sample["cpu"] >= 120.0, "off-CPU sleep missing: {sample:?}");
    let snapshot = counted(&host, "/q/read", 1);
    let op = &snapshot["operations"]["/q/read"];
    for metric in ["total", "engine", "cpu"] {
        assert!(op[metric]["max"].as_f64().unwrap() + 0.001 >= sample[metric], "{op}");
    }
    assert_eq!(op["cpu_n"], 1);
}

#[test]
fn thread_cpu_excludes_another_busy_thread_and_records_own_work() {
    let fresh = query_readers::FreshDirectory::new().unwrap();
    let host = Host::with_store(true, fresh.store().unwrap(), SOURCE);
    *lock(&host.shared.query_wait) = Some(Arc::new(|| {
        let start = latency::thread_cpu().unwrap();
        while latency::thread_cpu().unwrap() - start < Duration::from_millis(20) { std::hint::spin_loop(); }
        // A process clock would wrongly charge the child thread to this read.
        thread::spawn(|| {
            let start = latency::thread_cpu().unwrap();
            while latency::thread_cpu().unwrap() - start < Duration::from_millis(100) { std::hint::spin_loop(); }
        }).join().unwrap();
    }));
    let sample = timing(&host.request("POST", "/q/read", PERSONA, "{}")).unwrap();
    assert!(sample["cpu"] >= 20.0, "{sample:?}");
    assert!(sample["engine"] - sample["cpu"] >= 80.0, "CPU must be request-thread only: {sample:?}");
}

#[test]
fn wildcard_listener_omits_timing_for_loopback_and_external_peers() {
    let host = Host::with_store_on(true, snapback4_core::Store::memory().unwrap(), SOURCE, "0.0.0.0");
    assert!(host.address.ip().is_unspecified());
    let route = std::net::UdpSocket::bind("0.0.0.0:0").unwrap();
    route.connect("192.0.2.1:9").unwrap(); // Select an interface without sending a packet.
    let external = route.local_addr().unwrap().ip();
    assert!(!external.is_loopback());
    for (ip, expected) in [("127.0.0.1".parse().unwrap(), 200), (external, 403)] {
        let reply = exchange(SocketAddr::new(ip, host.address.port()),
            "POST /q/read HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nx-snapback-persona: alice\r\nContent-Length: 2\r\n\r\n{}");
        assert_eq!(status(&reply), expected, "{reply}");
        assert!(timing(&reply).is_none(), "wildcard listener disclosed timings: {reply}");
    }
}

#[test]
fn timing_survives_cors_suppression_on_route_and_token_refusals_and_pending() {
    let source = format!("{SOURCE}\nroute hook: post \"/hook\" as service:hook wait 100ms\n");
    let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(), &source);
    for (path, headers, expected, code) in [
        ("/hook", PERSONA, 401, "E_ROUTE_VERIFY"),
        ("/hook", "", 503, "E_ROUTE_PENDING"),
        ("/dev/token", PERSONA, 403, "E_AUTH"),
    ] {
        let reply = host.request("POST", path, headers, "{}");
        assert_eq!(status(&reply), expected, "{reply}");
        assert_eq!(body(&reply)["denied"]["code"], code);
        assert!(!reply.to_ascii_lowercase().contains("access-control-allow-origin:"));
        assert!(!reply.to_ascii_lowercase().contains("access-control-expose-headers:"));
        assert!(timing(&reply).is_some(), "missing timing with CORS suppressed: {reply}");
    }
    let reply = host.request("POST", "/a/echo?wait=0", PERSONA, r#"{"id":"pending","args":{}}"#);
    assert_eq!(body(&reply)["state"], "pending", "{reply}");
    assert!(timing(&reply).is_some(), "{reply}");
    let reply = host.request("POST", "/hook", "Origin: https://evil.example\r\n", "{}");
    assert!(timing(&reply).is_none(), "CORS-independent timing must retain its fence");
}

const OPEN_DELAY: Duration = Duration::from_millis(150);
fn delayed_open(host: &Host) -> Arc<AtomicUsize> {
    let opens = Arc::new(AtomicUsize::new(0));
    let seen = opens.clone();
    *lock(&host.shared.reader_open) = Some(Arc::new(move || {
        seen.fetch_add(1, Ordering::SeqCst);
        thread::sleep(OPEN_DELAY);
    }));
    opens
}
fn assert_open_wait(reply: &str, opens: usize) {
    assert!(opens > 0);
    let sample = timing(reply).unwrap();
    let delay = OPEN_DELAY.as_secs_f64() * 1000.0 * opens as f64;
    assert!(sample["wait"] >= delay, "acquisition escaped wait: {sample:?}");
    // Wait and engine are disjoint, even if a writer is held while opening.
    assert!(sample["wait"] + sample["engine"] <= sample["total"] + 0.002,
        "acquisition counted as engine too: {sample:?}");
    println!("{opens} delayed acquisitions: {sample:?}");
}

fn delayed_path(method: &str, path: &str, payload: &str) {
    let source = format!("{SOURCE}\ntable viewing:\n  principal: principal\n  unique byPrincipal: principal\n  read <- allow\n  insert <- .principal = viewer\n  update <- .principal = viewer\n  ephemeral 30s\nmutation view():\n  upsert viewing[principal = viewer] {{principal: viewer}}\n");
    let fresh = query_readers::FreshDirectory::new().unwrap();
    let host = Host::with_store(true, fresh.store().unwrap(), &source);
    let opens = delayed_open(&host);
    let reply = host.request(method, path, PERSONA, payload);
    assert_eq!(status(&reply), 200, "{reply}");
    assert!(body(&reply).get("denied").is_none(), "{reply}");
    if path == "/m/view" { assert_eq!(body(&reply)["state"], "sent"); }
    assert_open_wait(&reply, opens.load(Ordering::SeqCst));
    let name = path.split('?').next().unwrap();
    let snapshot = counted(&host, name, 1);
    let op = &snapshot["operations"][name];
    let sample = timing(&reply).unwrap();
    assert!(op["wait"]["max"].as_f64().unwrap() + 0.001 >= sample["wait"], "{op}");
    if path == "/q/read" {
        assert!(!lock(&host.shared.readers).idle.is_empty());
        opens.store(0, Ordering::SeqCst);
        assert_open_wait(&host.request(method, path, PERSONA, payload), opens.load(Ordering::SeqCst));
    }
}
#[test]
fn delayed_query_open_and_pool_checkout_are_wait() { delayed_path("POST", "/q/read", "{}"); }
#[test]
fn delayed_changes_open_is_wait() { delayed_path("GET", "/changes?wait=0", ""); }
#[test]
fn delayed_ephemeral_pool_take_is_wait() { delayed_path("POST", "/m/view", r#"{"id":"view","args":{}}"#); }

#[test]
fn changes_reopens_after_a_commit_and_times_each_open_as_wait() {
    let fresh = query_readers::FreshDirectory::new().unwrap();
    let host = Host::with_store(true, fresh.store().unwrap(), SOURCE);
    let opens = delayed_open(&host);
    let (sent, received) = mpsc::channel();
    *lock(&host.shared.poll_wait) = Some(Arc::new(move || { let _ = sent.send(()); }));
    let address = host.address;
    let poll = thread::spawn(move || exchange(address,
        "GET /changes?wait=2 HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nx-snapback-persona: alice\r\n\r\n"));
    received.recv_timeout(Duration::from_secs(2)).unwrap();
    drop(lock(&host.shared.wake)); // Poll released the wake mutex into its wait.
    let reply = host.request("POST", "/m/put", PERSONA, r#"{"id":"wake","args":{"n":1}}"#);
    assert_eq!(body(&reply)["state"], "sent");
    let reply = poll.join().unwrap();
    assert_eq!(status(&reply), 200, "{reply}");
    assert_eq!(body(&reply)["tables"], json!(["notes"]));
    assert_eq!(opens.load(Ordering::SeqCst), 2);
    assert_open_wait(&reply, 2);
}

#[test]
fn changes_refresh_is_engine_work_but_poll_sleep_is_not() {
    let fresh = query_readers::FreshDirectory::new().unwrap();
    let host = Host::with_store(true, fresh.store().unwrap(), SOURCE);
    *lock(&host.shared.changes_refresh) = Some(Arc::new(|| thread::sleep(Duration::from_millis(150))));
    let reply = host.request("GET", "/changes?wait=1", PERSONA, "");
    assert_eq!(status(&reply), 200, "{reply}");
    let sample = timing(&reply).unwrap();
    assert!(sample["engine"] >= 150.0, "refresh escaped its engine span: {sample:?}");
    assert!(sample["total"] - sample["engine"] - sample["wait"] >= 600.0,
        "poll sleeping entered engine/wait: {sample:?}");
    let snapshot = counted(&host, "/changes", 1);
    let op = &snapshot["operations"]["/changes"];
    assert!(op["engine"]["max"].as_f64().unwrap() >= 150.0, "{op}");
    assert!(op["total"]["max"].as_f64().unwrap() - op["engine"]["max"].as_f64().unwrap()
        - op["wait"]["max"].as_f64().unwrap() >= 600.0, "{op}");
    println!("refresh 150ms, held poll: {sample:?}");
}

#[test]
fn maintenance_writer_admission_under_a_request_sample_is_wait() {
    let host = Host::new(true);
    let held = lock(&host.shared.engine);
    let shared = host.shared.clone();
    let worker = thread::spawn(move || {
        let request = tiny_http::TestRequest::new().with_method(Method::Post)
            .with_path("/dev/clock/advance").into();
        let sample = latency::Sample::with_headers(&request, &shared.latency, true).unwrap();
        let mut reply = String::new();
        sample.run(|| {
            // The admission used by maintenance::engine_work, also called
            // synchronously by /dev/clock/advance inside its request sample.
            drop(shared.engine.background());
            reply = format!("{}\r\n\r\n", latency::header().unwrap());
            latency::finished(false);
        });
        reply
    });
    let started = Instant::now();
    while host.shared.engine.waiting() == 0 {
        assert!(started.elapsed() < Duration::from_secs(3), "maintenance did not enqueue");
        thread::yield_now();
    }
    // Begin the delay only after background admission actually queues.
    thread::sleep(OPEN_DELAY);
    drop(held);
    assert_open_wait(&worker.join().unwrap(), 1);
}

#[test]
fn clock_maintenance_retry_open_is_wait_not_engine() {
    let fresh = query_readers::FreshDirectory::new().unwrap();
    let host = Host::with_store(true, fresh.store().unwrap(), SOURCE);
    let opens = Arc::new(AtomicUsize::new(0));
    {
        let mut readers = lock(&host.shared.readers);
        readers.source = None; // Recover a missing file-backed connection factory.
        let seen = opens.clone();
        readers.retry_open = Some(Arc::new(move || {
            seen.fetch_add(1, Ordering::SeqCst);
            thread::sleep(OPEN_DELAY);
        }));
    }
    let reply = host.request("POST", "/dev/clock/advance", PERSONA, r#"{"duration":"+1s"}"#);
    assert_eq!(status(&reply), 200, "{reply}");
    assert_eq!(body(&reply)["advancedMs"], 1000);
    assert_eq!(opens.load(Ordering::SeqCst), 1);
    assert!(lock(&host.shared.readers).source.is_some(), "retry must restore the factory");
    assert_open_wait(&reply, 1);
}

#[test]
fn maintenance_coordination_gate_does_not_claim_engine_ownership() {
    let host = Host::new(true);
    let request = tiny_http::TestRequest::new().with_method(Method::Post)
        .with_path("/dev/clock/advance").into();
    let sample = latency::Sample::with_headers(&request, &host.shared.latency, true).unwrap();
    let mut reply = String::new();
    sample.run(|| {
        {
            let _maintenance = lock(&host.shared.maintenance);
            // Between engine slices a synchronous advance can do filesystem
            // work. That interval belongs only to total, never engine or wait.
            thread::sleep(OPEN_DELAY);
        }
        reply = format!("{}\r\n\r\n", latency::header().unwrap());
        latency::finished(false);
    });
    let sample = timing(&reply).unwrap();
    assert!(sample["total"] - sample["engine"] - sample["wait"] >= OPEN_DELAY.as_secs_f64() * 1000.0 * 0.9,
        "coordination was mislabeled engine ownership: {sample:?}");
}
