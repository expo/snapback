use super::*;
#[cfg(unix)]
mod fd_limits;

#[test]
fn a_thousand_sequential_reads_reuse_bounded_request_threads() {
    let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(),
        "use personas alice\nquery ping():\n  return 7\n");
    let threads = Arc::new(Mutex::new(std::collections::HashSet::new()));
    let observed = threads.clone();
    *lock(&host.shared.request_work) = Some(Arc::new(move || {
        #[cfg(target_os = "macos")]
        assert_eq!(crate::thread_priority::current_qos(),
            libc::qos_class_t::QOS_CLASS_USER_INITIATED as u32);
        lock(&observed).insert(thread::current().id());
    }));
    for _ in 0..1000 {
        let response = host.request("POST", "/q/ping", "x-snapback-persona: alice\r\n", r#"{"args":{}}"#);
        assert_eq!(body(&response)["data"], 7);
    }
    let created = lock(&threads).len();
    assert!(created <= REQUEST_WORKERS, "1000 reads created {created} serving threads; capacity is {REQUEST_WORKERS}");
}

#[test]
fn a_panicking_request_releases_its_slot_and_the_worker_serves_again() {
    let host = Host::new(true);
    let first = Arc::new(std::sync::atomic::AtomicBool::new(true));
    *lock(&host.shared.request_work) = Some(Arc::new(move || {
        if first.swap(false, Ordering::AcqRel) { panic!("injected request panic"); }
    }));
    let _ = host.request("GET", "/auth/config", "", "");
    wait_until(|| host.admission.short.load(Ordering::Acquire) == 0);
    assert_eq!(status(&host.request("GET", "/auth/config", "", "")), 200);
}

#[test]
fn full_mutation_workers_refuse_upload_without_body_drain_or_eviction() {
    let host = Host::new(true);
    struct Gate(Arc<(Mutex<bool>, Condvar)>);
    impl Drop for Gate { fn drop(&mut self) { *lock(&self.0.0) = true; self.0.1.notify_all(); } }
    let gate = Gate(Arc::new((Mutex::new(false), Condvar::new())));
    let held = gate.0.clone();
    let started = Arc::new(AtomicUsize::new(0));
    let counted = started.clone();
    *lock(&host.shared.request_work) = Some(Arc::new(move || {
        counted.fetch_add(1, Ordering::Release);
        let mut released = lock(&held.0);
        while !*released { released = held.1.wait(released).unwrap(); }
    }));
    let mut requests = Vec::new();
    for _ in 0..MUTATION_WORKERS {
        let mut stream = TcpStream::connect(host.address).unwrap();
        stream.write_all(b"POST /m/held HTTP/1.1\r\nHost: localhost\r\nContent-Length: 2\r\n\r\n{}").unwrap();
        requests.push(stream);
    }
    wait_until(|| host.admission.mutations.load(Ordering::Acquire) == MUTATION_WORKERS);
    wait_until(|| started.load(Ordering::Acquire) == MUTATION_WORKERS);
    assert!(host.server.num_connections() < 128);
    for _ in 0..10 {
        let mut stream = TcpStream::connect(host.address).unwrap();
        stream.set_read_timeout(Some(Duration::from_secs(1))).unwrap();
        stream.write_all(b"POST /assets HTTP/1.1\r\nHost: localhost\r\nContent-Length: 100000\r\n\r\n").unwrap();
        let mut response = String::new(); stream.read_to_string(&mut response).unwrap();
        assert_eq!(status(&response), 503, "{response}");
        assert_eq!(body(&response)["denied"]["retryable"], true);
    }
    wait_until(|| host.admission.refused[RequestClass::Mutation as usize].load(Ordering::Relaxed) == 10);
    assert_eq!(host.admission.mutations.load(Ordering::Acquire), MUTATION_WORKERS);
    drop(gate);
    wait_until(|| host.admission.mutations.load(Ordering::Acquire) == 0);
}

#[test]
fn every_worker_pool_counts_and_returns_the_same_public_refusal() {
    let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(), "use server\nuse personas alice\nroute report: post \"/report\" wait 2s\nquery who():\n  return viewer\n");
    for (class, method, path) in [
        (RequestClass::Short, "GET", "/schema"), (RequestClass::Mutation, "POST", "/assets"),
        (RequestClass::Sync, "POST", "/sync"), (RequestClass::Wait, "GET", "/changes?wait=25"),
        (RequestClass::Claim, "POST", "/effects/claim"),
        (RequestClass::Route, "POST", "/report"), (RequestClass::Registry, "POST", "/actions/claim-set"),
        (RequestClass::Verifier, "POST", "/routes/verify/claim"),
    ] {
        let mut permits = Vec::new();
        while let Some(permit) = host.admission.acquire(class) { permits.push(permit); }
        let reply = host.request(method, path, "", "");
        assert_eq!(status(&reply), 503, "{path}: {reply}");
        let why = &body(&reply)["denied"];
        // Long-wait pools name themselves (LLP 3000.036 §6); the others keep the fixed body.
        let code = if matches!(class, RequestClass::Wait | RequestClass::Claim) { "E_STREAMS" } else { "E_RATE_LIMIT" };
        assert_eq!(why["code"], code, "{path}"); assert_ne!(why["family"], "auth"); assert_eq!(why["retryable"], true);
        wait_until(|| host.admission.refused[class as usize].load(Ordering::Relaxed) == 1);
        assert_eq!(host.admission.undelivered[class as usize].load(Ordering::Relaxed), 0);
        assert_eq!(host.admission.counter(class).load(Ordering::Acquire), permits.len());
    }
}

#[test]
fn failed_thread_spawn_refuses_unfinished_upload_and_releases_permit() {
    let host = Host::new(true);
    crate::host_limits::prepare_tests();
    let server = Server::http_with_limits("127.0.0.1:0", tiny_http::ConnectionLimits::default()).unwrap();
    let address = server.server_addr().to_ip().unwrap();
    let peer = thread::spawn(move || {
        let mut stream = TcpStream::connect(address).unwrap();
        // The driver first receives this request (up to one second), then
        // injects the spawn failure. Start with room for that held interval.
        stream.set_read_timeout(Some(Duration::from_secs(1) + CLIENT_TIMEOUT)).unwrap();
        stream.write_all(b"POST /assets HTTP/1.1\r\nHost: localhost\r\nContent-Length: 100000\r\n\r\n").unwrap();
        let mut response = String::new();
        let read = stream.read_to_string(&mut response);
        (response, read)
    });
    let request = server.recv_timeout(Duration::from_secs(1)).unwrap().unwrap();
    // This cannot fit in a process address space. Exercise the actual spawn Err
    // path without lowering shared-host limits or exhausting any real resource.
    let builder = thread::Builder::new().name("request".into()).stack_size(usize::MAX / 2);
    dispatch_with_builder(request, host.shared.clone(), host.admission.clone(), true, builder);
    let (response, read) = peer.join().unwrap();
    assert!(read.is_ok(), "unfinished body must not delay refusal: {read:?}; {response}");
    assert_eq!(status(&response), 503, "{response}");
    assert_eq!(body(&response)["denied"]["code"], "E_RATE_LIMIT");
    assert_eq!(host.admission.mutations.load(Ordering::Acquire), 0);
    assert_eq!(host.admission.refused[RequestClass::Mutation as usize].load(Ordering::Relaxed), 1);
    assert_eq!(status(&host.request("GET", "/auth/config", "", "")), 200);
}

#[test]
fn short_burst_queues_without_extra_workers_and_refuses_only_at_the_bound() {
    let host = Host::new(true);
    let gate = Arc::new(WorkGate::default()); let _release = ReleaseGate(gate.clone());
    let hook = gate.clone();
    *lock(&host.shared.request_work) = Some(Arc::new(move || hook.park()));
    let mut peers = Vec::new();
    for _ in 0..REQUEST_WORKERS + SHORT_REQUEST_QUEUE {
        let mut stream = TcpStream::connect(host.address).unwrap();
        stream.set_read_timeout(Some(Duration::from_secs(15))).unwrap();
        stream.write_all(b"GET /auth/config HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n").unwrap();
        peers.push(stream);
    }
    wait_until(|| host.admission.short.load(Ordering::Acquire) == REQUEST_WORKERS + SHORT_REQUEST_QUEUE);
    wait_until(|| gate.entered.load(Ordering::Acquire) == REQUEST_WORKERS);
    let overflow = host.request("GET", "/auth/config", "", "");
    assert_eq!(status(&overflow), 503, "{overflow}");
    assert_eq!(body(&overflow)["denied"]["code"], "E_RATE_LIMIT");
    assert_eq!(gate.entered.load(Ordering::Acquire), REQUEST_WORKERS);
    gate.release();
    for mut peer in peers {
        let mut reply = String::new(); peer.read_to_string(&mut reply).unwrap();
        assert_eq!(status(&reply), 200, "{reply}");
    }
    wait_until(|| host.admission.short.load(Ordering::Acquire) == 0);
    assert_eq!(host.admission.refused[RequestClass::Short as usize].load(Ordering::Relaxed), 1);
}

#[test]
fn queued_short_request_keeps_its_original_body_deadline() {
    let host = Host::new(true);
    let server = Server::http_with_limits("127.0.0.1:0", tiny_http::ConnectionLimits {
        body_timeout: Duration::from_millis(20), ..Default::default()
    }).unwrap();
    let mut peer = TcpStream::connect(server.server_addr().to_ip().unwrap()).unwrap();
    peer.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
    peer.write_all(b"POST /q/held HTTP/1.1\r\nHost: localhost\r\nContent-Length: 100000\r\n\r\n").unwrap();
    let request = server.recv_timeout(Duration::from_secs(1)).unwrap().unwrap();
    let until = request.body_deadline().unwrap();
    while Instant::now() < until { thread::sleep(Duration::from_millis(1)); }
    dispatch(request, host.shared.clone(), host.admission.clone(), true);
    let mut reply = String::new(); peer.read_to_string(&mut reply).unwrap();
    assert_eq!(status(&reply), 503, "{reply}");
    assert_eq!(body(&reply)["denied"]["code"], "E_RATE_LIMIT");
    wait_until(|| host.admission.short.load(Ordering::Acquire) == 0);
}
