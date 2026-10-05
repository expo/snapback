use super::*;

#[test]
fn saturated_mutation_admission_reserves_query_and_sync_capacity() {
    for path in ["/m/noop", "/auth/guest", "/effects/missing/done", "/effects/missing/failed", "/effects/missing/steps/provider/done"] {
        saturated_writer(path);
    }
}

fn saturated_writer(path: &'static str) {
    eprintln!("saturating {path}");
    let dir = ReaderTestDirectory::new();
    let host = Host::with_store(true, snapback4_core::Store::open(&dir.0.join("saturated.db")).unwrap(),
        "use identity\nuse personas alice\nquery who():\n  return viewer\nmutation noop():\n  return 1\n");
    let session = {
        let engine = lock(&host.shared.engine);
        snapback4_core::identity::service_session(engine.store(), "worker", host.shared.now(), 1).unwrap()
    };
    let owner = lock(&host.shared.engine);
    let mut writers = Vec::new();
    // Fill the mutation budget and overflow it; reads keep their own slots.
    const EXTRA: usize = 4;
    for _ in 0..MUTATION_WORKERS + EXTRA {
        let address = host.address;
        let headers = if path.starts_with("/effects/") {
            format!("Authorization: Bearer {}\r\nx-snapback-effect-lease: missing\r\n", session.token)
        } else { "x-snapback-persona: alice\r\n".into() };
        let payload = r#"{"result":null}"#;
        writers.push(thread::spawn(move || exchange_held(address, WAIT_TIMEOUT + 2 * CLIENT_TIMEOUT,
            &format!("POST {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n{headers}Content-Length: {}\r\n\r\n{payload}", payload.len()))));
    }
    wait_until(|| host.shared.engine.waiting() as usize == MUTATION_WORKERS
        && writers.iter().filter(|w| w.is_finished()).count() == EXTRA);
    let started = Instant::now();
    assert_eq!(body(&host.request("POST", "/q/who", "x-snapback-persona: alice\r\n", "{}"))["data"], "dev:alice");
    let page = body(&host.request("POST", "/sync", "x-snapback-persona: alice\r\n", "{}"));
    assert!(page.get("denied").is_none(), "{page}");
    assert!(started.elapsed() < Duration::from_secs(2));
    assert_eq!(host.shared.engine.waiting() as usize, MUTATION_WORKERS, "reads did not release the writer");
    drop(owner);
    let replies: Vec<_> = writers.into_iter().map(|w| w.join().unwrap()).collect();
    assert_eq!(replies.iter().filter(|r| status(r) == 503).count(), EXTRA);
    for reply in replies.iter().filter(|r| status(r) == 503) { assert_eq!(body(reply)["denied"]["code"], "E_RATE_LIMIT"); }
    for reply in replies.iter().filter(|r| status(r) != 503) {
        let answer = body(reply);
        match path {
            "/m/noop" => assert_eq!(answer["state"], "sent", "{reply}"),
            "/auth/guest" => assert!(answer["session"]["token"].is_string(), "{reply}"),
            _ => assert_eq!(answer["denied"]["code"], "E_EFFECT_UNKNOWN", "{reply}"),
        }
    }
    wait_until(|| host.admission.mutations.load(Ordering::Acquire) == 0);
}
