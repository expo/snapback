use super::*;

#[test]
fn full_mutation_workers_refuse_upload_without_body_drain_or_eviction() {
    let host = Host::new(true);
    struct Gate(Arc<(Mutex<bool>, Condvar)>);
    impl Drop for Gate { fn drop(&mut self) { *lock(&self.0.0) = true; self.0.1.notify_all(); } }
    let gate = Gate(Arc::new((Mutex::new(false), Condvar::new())));
    let held = gate.0.clone();
    *lock(&host.shared.request_work) = Some(Arc::new(move || {
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
        (RequestClass::Sync, "POST", "/sync"), (RequestClass::Wait, "POST", "/effects/claim"),
        (RequestClass::Route, "POST", "/report"), (RequestClass::Registry, "POST", "/actions/claim-set"),
        (RequestClass::Verifier, "POST", "/routes/verify/claim"),
    ] {
        let mut permits = Vec::new();
        while let Some(permit) = host.admission.acquire(class) { permits.push(permit); }
        let reply = host.request(method, path, "", "");
        assert_eq!(status(&reply), 503, "{path}: {reply}");
        let why = &body(&reply)["denied"];
        assert_eq!(why["code"], "E_RATE_LIMIT"); assert_ne!(why["family"], "auth"); assert_eq!(why["retryable"], true);
        wait_until(|| host.admission.refused[class as usize].load(Ordering::Relaxed) == 1);
        assert_eq!(host.admission.undelivered[class as usize].load(Ordering::Relaxed), 0);
        assert_eq!(host.admission.counter(class).load(Ordering::Acquire), permits.len());
    }
}
