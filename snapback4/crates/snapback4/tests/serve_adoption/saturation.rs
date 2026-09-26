use super::*;

#[test]
fn saturated_mutation_admission_reserves_query_and_sync_capacity() {
    let dir = ReaderTestDirectory::new();
    let host = Host::with_store(true, snapback4_core::Store::open(&dir.0.join("saturated.db")).unwrap(),
        "use personas alice\nquery who():\n  return viewer\nmutation noop():\n  return 1\n");
    let owner = lock(&host.shared.engine);
    let mut writers = Vec::new();
    // Saturate the full old 32-request population, not merely one writer.
    for _ in 0..REQUEST_WORKERS {
        let address = host.address;
        writers.push(thread::spawn(move || exchange(address,
            "POST /m/noop HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nx-snapback-persona: alice\r\nContent-Length: 2\r\n\r\n{}")));
    }
    wait_until(|| host.shared.engine.waiting() as usize == MUTATION_WORKERS
        && writers.iter().filter(|w| w.is_finished()).count() == REQUEST_WORKERS - MUTATION_WORKERS);
    let started = Instant::now();
    assert_eq!(body(&host.request("POST", "/q/who", "x-snapback-persona: alice\r\n", "{}"))["data"], "dev:alice");
    let page = body(&host.request("POST", "/sync", "x-snapback-persona: alice\r\n", "{}"));
    assert!(page.get("denied").is_none(), "{page}");
    assert!(started.elapsed() < Duration::from_secs(2));
    assert_eq!(host.shared.engine.waiting() as usize, MUTATION_WORKERS, "reads did not release the writer");
    drop(owner);
    let replies: Vec<_> = writers.into_iter().map(|w| w.join().unwrap()).collect();
    assert_eq!(replies.iter().filter(|r| r.is_empty()).count(), REQUEST_WORKERS - MUTATION_WORKERS);
    for reply in replies.iter().filter(|r| !r.is_empty()) { assert_eq!(body(reply)["state"], "sent", "{reply}"); }
    wait_until(|| host.admission.mutations.load(Ordering::Acquire) == 0);
}
