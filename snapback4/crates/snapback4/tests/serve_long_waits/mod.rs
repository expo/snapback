//! Long-wait capacity (LLP 3000.036 §6 A): sized pools, the per-principal share and E_STREAMS.
use super::*;

fn sized_host(capacity: crate::host_limits::Capacity) -> Host {
    Host::with_capacity(true, snapback4_core::Store::memory().unwrap(), SCHEMA, "127.0.0.1", None, capacity)
}
fn hold(host: &Host, persona: &str) -> TcpStream {
    let head = lock(&host.shared.wake).seq;
    let mut stream = TcpStream::connect(host.address).unwrap();
    stream.write_all(format!("GET /changes?since={head}&wait=25 HTTP/1.1\r\nHost: localhost\r\nx-snapback-persona: {persona}\r\nConnection: close\r\n\r\n").as_bytes()).unwrap();
    stream
}
fn refused_at_once(host: &Host, wire: &str) -> String {
    let started = Instant::now();
    let mut stream = TcpStream::connect(host.address).unwrap();
    stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
    stream.write_all(wire.as_bytes()).unwrap();
    let mut reply = String::new(); stream.read_to_string(&mut reply).unwrap();
    assert!(started.elapsed() < Duration::from_secs(1), "a full bound refuses at once, never queues: {reply}");
    reply
}
fn wake_polls(host: &Host, id: &str) {
    let reply = body(&host.request("POST", "/seed", "x-snapback-persona: alice\r\n",
        &format!(r#"[{{"table":"items","row":{{"id":"{id}","n":1,"photo":null}}}}]"#)));
    assert_eq!(reply["seeded"], 1, "{reply}");
}

// @ref LLP 3000.036#6-idle-live-clients-must-not-cost-a-thread — the viewers' pool refuses with its own code, not the assets-guided E_RATE_LIMIT.
#[test]
fn a_full_viewer_pool_refuses_with_e_streams_while_short_requests_and_unheld_polls_progress() {
    let host = sized_host(crate::host_limits::Capacity::sized(4, 4, 2));
    let polls: Vec<_> = (0..4).map(|_| hold(&host, "alice")).collect();
    wait_until(|| host.admission.waiters.load(Ordering::Acquire) == 4);
    let started = Instant::now();
    assert_eq!(status(&host.request("GET", "/schema", "x-snapback-persona: alice\r\n", "")), 200);
    assert!(started.elapsed() < Duration::from_secs(1));
    let refusal = refused_at_once(&host, "GET /changes?wait=25 HTTP/1.1\r\nHost: localhost\r\nx-snapback-persona: bob\r\n\r\n");
    assert_eq!(status(&refusal), 503, "{refusal}");
    assert!(refusal.contains("Retry-After: 2\r\n"), "{refusal}");
    let why = &body(&refusal)["denied"];
    assert_eq!((why["code"].as_str(), why["family"].as_str(), why["retryable"].as_bool(), why["guide"].as_str()), (Some("E_STREAMS"), Some("limit"), Some(true), Some("wire")), "{why}");
    assert!(why["message"].as_str().unwrap().contains("all 4 viewer long waits"), "{why}");
    assert!(snapback4_lang::guide::explain_code("E_STREAMS").is_some(), "snapback4 why explains the code");
    // A poll that does not wait answers at once from the writer class.
    let unheld = host.request("GET", "/changes?since=0", "x-snapback-persona: bob\r\n", "");
    assert_eq!(status(&unheld), 200, "{unheld}");
    assert_eq!(host.admission.waiters.load(Ordering::Acquire), 4);
    assert_eq!(host.admission.refused[RequestClass::Wait as usize].load(Ordering::Relaxed), 1);
    wake_polls(&host, "wake");
    wait_until(|| host.admission.waiters.load(Ordering::Acquire) == 0);
    drop(polls);
}

#[test]
fn one_principal_cannot_hold_more_than_its_share_of_change_polls() {
    let host = sized_host(crate::host_limits::Capacity::sized(8, 2, 2));
    let polls: Vec<_> = (0..2).map(|_| hold(&host, "alice")).collect();
    wait_until(|| host.shared.long_waits.held("dev:alice") == 2);
    let refusal = refused_at_once(&host, "GET /changes?since=0&wait=25 HTTP/1.1\r\nHost: localhost\r\nx-snapback-persona: alice\r\nConnection: close\r\n\r\n");
    assert_eq!(status(&refusal), 429, "{refusal}");
    assert!(refusal.contains("Retry-After: 5\r\n") && refusal.contains("Retry-After"), "{refusal}");
    let why = &body(&refusal)["denied"];
    assert_eq!((why["code"].as_str(), why["retryable"].as_bool()), (Some("E_STREAMS"), Some(true)), "{why}");
    assert!(why["message"].as_str().unwrap().contains("2 of 2 held change polls"), "{why}");
    assert_eq!(host.shared.long_waits.held("dev:alice"), 2, "a refused poll never takes a share");
    // Another principal still holds a poll; alice can still poll without waiting.
    let bob = hold(&host, "bob");
    wait_until(|| host.shared.long_waits.held("dev:bob") == 1);
    assert_eq!(status(&host.request("GET", "/changes?since=0", "x-snapback-persona: alice\r\n", "")), 200);
    wake_polls(&host, "share");
    wait_until(|| host.admission.waiters.load(Ordering::Acquire) == 0);
    assert_eq!((host.shared.long_waits.held("dev:alice"), host.shared.long_waits.held("dev:bob")), (0, 0), "shares end with their polls");
    drop((polls, bob));
}

#[test]
fn worker_claim_polls_and_viewer_waits_cannot_starve_each_other() {
    let host = sized_host(crate::host_limits::Capacity::sized(3, 3, 2));
    let worker = {
        let engine = lock(&host.shared.engine);
        let seat = snapback4_core::identity::service_session(engine.store(), "worker", host.shared.now(), 1).unwrap();
        format!("Authorization: Bearer {}\r\n", seat.token)
    };
    let claim = |wait: u64| {
        let body = format!(r#"{{"action":"idle-unregistered","wait":{wait}}}"#);
        format!("POST /actions/claim HTTP/1.1\r\nHost: localhost\r\n{worker}Connection: close\r\nContent-Length: {}\r\n\r\n{body}", body.len())
    };
    // Viewers fill their pool; a worker's held claim is still admitted and answers.
    let polls: Vec<_> = (0..3).map(|_| hold(&host, "alice")).collect();
    wait_until(|| host.admission.waiters.load(Ordering::Acquire) == 3);
    let address = host.address;
    let held_claim = { let wire = claim(1); thread::spawn(move || exchange(address, &wire)) };
    let answered = held_claim.join().unwrap();
    assert_eq!(status(&answered), 200, "{answered}");
    // And the reverse: workers fill the claim pool; a viewer still holds a poll.
    wake_polls(&host, "viewers");
    wait_until(|| host.admission.waiters.load(Ordering::Acquire) == 0);
    let claims: Vec<_> = (0..2).map(|_| { let wire = claim(25); thread::spawn(move || exchange_held(address, Duration::from_secs(5), wire)) }).collect();
    wait_until(|| host.admission.claims.load(Ordering::Acquire) == 2);
    let refusal = refused_at_once(&host, &claim(25));
    assert_eq!(status(&refusal), 503, "{refusal}");
    assert!(body(&refusal)["denied"]["message"].as_str().unwrap().contains("all 2 worker claim polls"), "{refusal}");
    let viewer = hold(&host, "bob");
    wait_until(|| host.admission.waiters.load(Ordering::Acquire) == 1);
    wake_polls(&host, "claims");
    wait_until(|| host.admission.waiters.load(Ordering::Acquire) == 0);
    snapback4_core::identity::revoke_principal(lock(&host.shared.engine).store(), "service:worker").unwrap();
    host.shared.committed.notify_all();
    for claim in claims { claim.join().unwrap(); }
    wait_until(|| host.admission.claims.load(Ordering::Acquire) == 0);
    drop((polls, viewer));
}


// A commit wakes every held poll; polls at the same cursor share one read.
#[test]
fn held_polls_at_one_cursor_share_a_wake_read_and_entry_reads_the_store() {
    let fresh = query_readers::FreshDirectory::new().unwrap();
    let host = Host::with_capacity(true, fresh.store().unwrap(), SCHEMA, "127.0.0.1", None, crate::host_limits::Capacity::sized(16, 16, 2));
    let reads = Arc::new(AtomicUsize::new(0));
    let counted = reads.clone();
    *lock(&host.shared.changes_refresh) = Some(Arc::new(move || { counted.fetch_add(1, Ordering::SeqCst); }));
    let parked = Arc::new(AtomicUsize::new(0));
    let parking = parked.clone();
    *lock(&host.shared.poll_wait) = Some(Arc::new(move || { parking.fetch_add(1, Ordering::SeqCst); }));
    let address = host.address;
    let head = lock(&host.shared.wake).seq;
    let polls: Vec<_> = (0..8).map(|_| thread::spawn(move || exchange_held(address, Duration::from_secs(5),
        format!("GET /changes?since={head}&wait=5 HTTP/1.1\r\nHost: localhost\r\nx-snapback-persona: alice\r\nConnection: close\r\n\r\n")))).collect();
    // Every poll has read on entry and reached its wait.
    wait_until(|| parked.load(Ordering::SeqCst) >= 8);
    assert_eq!(reads.load(Ordering::SeqCst), 8, "entry always reads the store");
    wake_polls(&host, "shared");
    for poll in polls {
        let reply = poll.join().unwrap();
        assert_eq!(status(&reply), 200, "{reply}");
        assert_eq!(body(&reply)["tables"], json!(["items"]));
    }
    // A wake answer is at most a second old: a loaded host may read again,
    // but eight woken polls never take eight reads.
    let woken = reads.load(Ordering::SeqCst) - 8;
    assert!((1..8).contains(&woken), "one commit woke eight polls with {woken} reads");
    println!("eight held polls: {woken} read(s) after one commit");
}

// Review finding 1: a shared answer must never be older than what a new
// poll's client may already know (a commit not yet published).
#[test]
fn a_new_poll_never_takes_a_wake_answer_older_than_an_unpublished_commit() {
    let fresh = query_readers::FreshDirectory::new().unwrap();
    let host = Host::with_store(true, fresh.store().unwrap(), SCHEMA);
    let address = host.address;
    let head = lock(&host.shared.wake).seq;
    let poll = |since: u64| thread::spawn(move || exchange_held(address, Duration::from_secs(5),
        format!("GET /changes?since={since}&wait=5 HTTP/1.1\r\nHost: localhost\r\nx-snapback-persona: alice\r\nConnection: close\r\n\r\n")));
    let woken = poll(head);
    wait_until(|| host.admission.waiters.load(Ordering::Acquire) == 1);
    wake_polls(&host, "published");
    let published = body(&woken.join().unwrap())["seq"].as_u64().unwrap();
    assert!(published > head);
    // Committed but not yet published (as /seed between commit and publish).
    let unpublished = { let mut engine = lock(&host.shared.engine); engine.seed([("items".into(), snapback4_core::value::object([("id", snapback4_core::value::Value::Id("late".into())), ("n", snapback4_core::value::Value::Int(2)), ("photo", snapback4_core::value::Value::Null)]))]).unwrap(); engine.seq().unwrap() };
    assert_eq!(lock(&host.shared.wake).seq, published);
    let reply = body(&poll(head).join().unwrap());
    assert_eq!(reply["seq"].as_u64(), Some(unpublished), "{reply}");
}

// Review finding 2: a pooled reader older than a committed adoption is
// read again behind the engine, never answered as E_GENERATION.
#[test]
fn a_wake_racing_adoption_waits_for_the_new_reader_pool() {
    let fresh = query_readers::FreshDirectory::new().unwrap();
    let host = Host::with_store(true, fresh.store().unwrap(), SCHEMA);
    // Hold the poll's wake read until adoption has committed, before the pool is replaced.
    let (entered, reading) = mpsc::channel();
    let (go, proceed) = mpsc::channel::<()>();
    let proceed = Arc::new(Mutex::new(proceed));
    let calls = Arc::new(AtomicUsize::new(0));
    let hook = (calls.clone(), proceed.clone());
    *lock(&host.shared.changes_refresh) = Some(Arc::new(move || {
        if hook.0.fetch_add(1, Ordering::SeqCst) == 1 { entered.send(()).unwrap(); lock(&hook.1).recv().unwrap(); }
    }));
    let address = host.address;
    let head = lock(&host.shared.wake).seq;
    let poll = thread::spawn(move || exchange_held(address, Duration::from_secs(5),
        format!("GET /changes?since={head}&wait=5 HTTP/1.1\r\nHost: localhost\r\nx-snapback-persona: alice\r\nConnection: close\r\n\r\n")));
    wait_until(|| host.admission.waiters.load(Ordering::Acquire) == 1 && calls.load(Ordering::SeqCst) == 1);
    wake_polls(&host, "before-adoption");
    reading.recv_timeout(Duration::from_secs(5)).unwrap();
    let next = snapback4_lang::compile(&[("schema.q".into(), format!("{SCHEMA}\ntable extra:\n  n: int\n  read <- allow\n  sync public\n"))]);
    let mut engine = lock(&host.shared.engine);
    engine.adopt_at(next.schema.clone(), next.programs.iter().map(|p| p.program.clone()), host.shared.now()).unwrap();
    go.send(()).unwrap();
    thread::sleep(Duration::from_millis(150));
    assert!(!poll.is_finished(), "the stale pooled read waits behind the adopting engine");
    lock(&host.shared.readers).replace(&engine, &next.refusal_sites);
    *lock(&host.shared.bound) = next;
    drop(engine);
    let reply = poll.join().unwrap();
    assert_eq!(status(&reply), 200, "{reply}");
    let reply = body(&reply);
    assert!(reply.get("denied").is_none(), "{reply}");
    assert_eq!(reply["tables"], json!(["items"]));
}
