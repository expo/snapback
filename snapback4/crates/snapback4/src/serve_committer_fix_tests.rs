//! Regression witnesses for K0-Q review refusals and independent progress.
use super::*;
use crate::serve::tests::{Host, body, status};
use std::sync::mpsc;
#[cfg(feature = "postgres")]
#[path = "serve_committer_intake_tests.rs"]
mod intake_tests;

const SOURCE: &str = "use personas alice\nuse identity\ntable rows:\n  n: int\n  read <- allow\n  insert <- allow\n  online only\nmutation add():\n  return insert rows { n: 1 }\nquery read():\n  return 1\ntable viewing:\n  principal: principal\n  unique principal\n  read <- allow\n  insert <- .principal = viewer\n  update <- .principal = viewer\n  ephemeral 30s\nmutation view():\n  upsert viewing[principal = viewer] { principal: viewer }\n";

fn host() -> Host {
    Host::with_store(true, snapback4_core::Store::memory().unwrap(), SOURCE)
}
fn fill(shared: &Shared) -> (mpsc::Sender<()>, snapback4_core::engine::command::Reply<()>) {
    let (entered, started) = mpsc::channel();
    let (release, resume) = mpsc::channel();
    let held = shared
        .engine
        .queue
        .submit(Command::new(move |_| {
            entered.send(()).unwrap();
            resume.recv_timeout(Duration::from_secs(15)).unwrap();
        }))
        .unwrap();
    started.recv_timeout(Duration::from_secs(5)).unwrap();
    for _ in 0..CAPACITY {
        drop(shared.engine.queue.submit(Command::new(|_| ())).unwrap());
    }
    (release, held)
}
fn doors(host: &Host, code: &str, expected_status: u16, retryable: bool) {
    let mut previous = None;
    for (method, path, payload) in [
        ("POST", "/m/add", r#"{"id":"refused","args":{}}"#),
        (
            "POST",
            "/auth/login",
            r#"{"email":"alice@example.test","password":"secret"}"#,
        ),
        ("GET", "/assets/missing", ""),
        ("GET", "/changes?since=0&wait=0", ""),
        ("GET", "/auth/config", ""),
    ] {
        let response = host.request(method, path, "x-snapback-persona: alice\r\n", payload);
        assert_eq!(status(&response), expected_status, "{path}: {response}");
        let envelope = body(&response);
        for field in ["store_id", "head", "generation"] { assert!(envelope.get(field).is_none(), "{path}: {response}"); }
        assert!(!response.to_ascii_lowercase().contains("x-snapback-generation:"), "{path}: {response}");
        let why = &envelope["denied"];
        assert_eq!(why["code"], code, "{path}: {response}");
        assert_eq!(
            why["retryable"].as_bool().unwrap_or(false),
            retryable,
            "{path}: {response}"
        );
        assert_eq!(
            response.to_ascii_lowercase().contains("retry-after: 1\r\n"),
            retryable && code == "E_RATE_LIMIT"
        );
        if let Some(previous) = &previous {
            assert_eq!(&envelope, previous, "{path}");
        }
        previous = Some(envelope);
    }
}

#[test]
fn all_http_doors_preserve_overload_status_body_and_headers() {
    let host = host();
    let (release, held) = fill(&host.shared);
    let before = Instant::now();
    doors(&host, "E_RATE_LIMIT", 503, true);
    let step = host.request(
        "POST",
        "/effects/run/steps/provider/begin",
        "Authorization: Bearer worker\r\nx-snapback-effect-lease: lease\r\n",
        r#"{"input":null}"#,
    );
    assert_eq!(status(&step), 503, "{step}");
    assert!(before.elapsed() < Duration::from_secs(2));
    let result = host.shared.engine.call(|_, _| panic!("full command ran"));
    assert_eq!(result.unwrap_err().code, "E_RATE_LIMIT");
    release.send(()).unwrap();
    held.wait().unwrap();
}

#[test]
fn writer_call_returns_ownership_loss_and_every_client_gets_the_same_response() {
    let host = host();
    host.shared.engine.queue.refuse_ownership();
    let why = host
        .shared
        .engine
        .call(|_, _| panic!("lost command ran"))
        .unwrap_err();
    assert_eq!(why.code, "E_STORE_OWNERSHIP");
    assert!(!why.retryable);
    doors(&host, "E_STORE_OWNERSHIP", 409, false);
}

#[test]
fn worker_disconnect_before_execution_reports_not_applied_on_every_door() {
    let host = Host::with_capacity_recent_writer(
        true,
        snapback4_core::Store::memory().unwrap(),
        SOURCE,
        "127.0.0.1",
        None,
        crate::host_limits::Capacity::default(),
        None,
        true,
        |engine| {
            let mut writer = Writer::new(engine).unwrap();
            // Drop an admitted command without its acknowledgement, like a
            // disconnected worker; no panic or database fault is required.
            writer.queue = Queue::start_with(CAPACITY, |_| ()).unwrap();
            writer
        },
    );
    let why = host.shared.engine.call(|_, _| ()).unwrap_err();
    assert_eq!(why.code, "E_COMMITTER_STOPPED");
    assert!(why.message.contains("not applied"));
    assert!(why.retryable);
    doors(&host, "E_COMMITTER_STOPPED", 503, true);
    let unknown = queue_error(SubmitError::OutcomeUnknown).refusal();
    assert_eq!(unknown.code, "E_COMMIT_OUTCOME_UNKNOWN");
    assert!(!unknown.retryable);
}

#[test]
fn admitted_notification_finishes_even_when_ownership_is_lost_before_wake() {
    let host = host();
    let (entered, started) = mpsc::channel();
    let (release, resume) = mpsc::channel();
    let shared = host.shared.clone();
    let observed = host.shared.clone();
    let (woke, wake) = mpsc::channel();
    let waiter = std::thread::spawn(move || {
        let seq = lock(&observed.seq);
        woke.send(()).unwrap();
        let (_guard, timeout) = observed
            .committed
            .wait_timeout(seq, Duration::from_secs(5))
            .unwrap();
        !timeout.timed_out()
    });
    wake.recv_timeout(Duration::from_secs(5)).unwrap();
    let request = std::thread::spawn(move || {
        shared.engine.attempt_and_notify(
            move |engine, _| {
                let session =
                    snapback4_core::identity::guest(engine.store(), 1, &mut Default::default())?;
                entered.send(()).unwrap();
                resume.recv_timeout(Duration::from_secs(5)).unwrap();
                Ok::<_, snapback4_core::RuntimeError>(session)
            },
            |r| r.is_ok(),
        )
    });
    started.recv_timeout(Duration::from_secs(5)).unwrap();
    host.shared.engine.queue.refuse_ownership();
    release.send(()).unwrap();
    assert!(
        request.join().unwrap().is_ok(),
        "committed answer survives loss"
    );
    assert!(
        waiter.join().unwrap(),
        "post-COMMIT wake was not a refused second command"
    );
}

#[test]
fn view_once_record_survives_mailbox_overload_before_delivery_custody_is_released() {
    let source = "use personas alice\ntable pictures:\n  reader: principal\n  photo: image <=1000 once\n  read <- .reader = viewer\n";
    let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(), source);
    {
        use snapback4_core::{
            Rows, Value,
            assets::{Asset, AssetKind},
        };
        let mut engine = lock(&host.shared.engine);
        engine
            .store()
            .record_asset(&Asset {
                id: "once".into(),
                owner: "dev:alice".into(),
                kind: AssetKind::Image,
                content_type: "image/png".into(),
                bytes: 24,
                width: Some(1),
                height: Some(1),
                duration: None,
                created_at: 1,
                home: None,
                released_at: None,
                name: None,
            })
            .unwrap();
        std::fs::create_dir_all(engine.store().asset_location().unwrap().directory()).unwrap();
        std::fs::write(
            engine.store().asset_location().unwrap().path("once"),
            [0u8; 24],
        )
        .unwrap();
        let table = engine.schema().tables["pictures"].clone();
        let asset = engine
            .store()
            .asset("once")
            .unwrap()
            .unwrap()
            .column_value();
        let tx = engine.store_mut().transaction().unwrap();
        tx.put(
            "pictures",
            &table,
            &snapback4_core::value::object([
                ("id", Value::Id("home".into())),
                ("reader", Value::Id("dev:alice".into())),
                ("photo", asset),
            ]),
            None,
        )
        .unwrap();
        tx.claim_asset("once", "dev:alice", "pictures", "home", "photo")
            .unwrap();
        tx.commit().unwrap();
    }
    let (filled, pending) = mpsc::channel();
    let shared = Arc::downgrade(&host.shared);
    *lock(&host.shared.asset_delivery) = Some(Arc::new(move || {
        filled.send(fill(&shared.upgrade().unwrap())).unwrap();
    }));
    let response = host.request("GET", "/assets/once", "x-snapback-persona: alice\r\n", "");
    let (release, held) = pending.recv_timeout(Duration::from_secs(5)).unwrap();
    *lock(&host.shared.asset_delivery) = None;
    assert_eq!(status(&response), 200, "{response}");
    let response = host.request("GET", "/assets/once", "x-snapback-persona: alice\r\n", "");
    assert_eq!(status(&response), 503, "{response}");
    release.send(()).unwrap();
    held.wait().unwrap();
    let response = host.request("GET", "/assets/once", "x-snapback-persona: alice\r\n", "");
    assert_eq!(status(&response), 410, "{response}");
    assert_eq!(body(&response)["denied"]["code"], "E_ASSET_VIEWED");
}

#[test]
fn detached_reads_and_ephemeral_finish_while_the_writer_and_a_mutation_are_blocked() {
    let directory =
        std::env::temp_dir().join(format!("sb4-k0q-progress-{}", snapback4_core::ids::seed()));
    std::fs::create_dir(&directory).unwrap();
    let host = Host::with_store(
        true,
        snapback4_core::Store::open(&directory.join("store.sqlite")).unwrap(),
        SOURCE,
    );
    let (entered, started) = mpsc::channel();
    let (release, resume) = mpsc::channel();
    let held = host
        .shared
        .engine
        .queue
        .submit(Command::new(move |_| {
            entered.send(()).unwrap();
            resume.recv_timeout(Duration::from_secs(15)).unwrap();
        }))
        .unwrap();
    started.recv_timeout(Duration::from_secs(5)).unwrap();
    std::thread::scope(|scope| {
        let writer = scope.spawn(|| {
            let payload = r#"{"id":"blocked","args":{}}"#;
            crate::serve::tests::exchange_held(host.address, Duration::from_secs(10), format!("POST /m/add HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nx-snapback-persona: alice\r\nContent-Length: {}\r\n\r\n{payload}", payload.len()))
        });
        let until = Instant::now() + Duration::from_secs(5);
        while host.shared.engine.queued.load(Ordering::Acquire) == 0 && Instant::now() < until {
            std::thread::yield_now();
        }
        let (sent, replies) = mpsc::channel();
        for path in ["/q/read", "/m/view"] {
            let sent = sent.clone();
            let host = &host;
            scope.spawn(move || {
                sent.send((
                    path,
                    host.request(
                        "POST",
                        path,
                        "x-snapback-persona: alice\r\n",
                        r#"{"args":{}}"#,
                    ),
                ))
                .unwrap();
            });
        }
        let first = replies.recv_timeout(Duration::from_secs(3));
        let second = replies.recv_timeout(Duration::from_secs(3));
        // Always release the fixture before asserting, so a serialization
        // regression fails promptly instead of hanging scoped thread cleanup.
        release.send(()).unwrap();
        held.wait().unwrap();
        for result in [first, second] {
            let (path, response) = result.expect("reader/ephemeral serialized behind the writer");
            assert_eq!(status(&response), 200, "{path}: {response}");
            let reply = body(&response);
            if path == "/q/read" {
                assert_eq!(reply["data"], 1, "{reply}");
            } else {
                assert_eq!(reply["state"], "sent", "{reply}");
                assert!(reply.get("ephemeral").is_some(), "{reply}");
            }
        }
        let response = writer.join().unwrap();
        assert_eq!(status(&response), 200, "{response}");
        assert_eq!(body(&response)["state"], "sent");
    });
    drop(host);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn clock_report_overload_after_advance_is_not_retryable_and_drain_does_not_advance_again() {
    let host = host();
    let (entered, paused) = mpsc::channel();
    let (release, resume) = mpsc::channel();
    let resume = Mutex::new(resume);
    *lock(&host.shared.clock_advanced) = Some(Arc::new(move || {
        entered.send(()).unwrap();
        lock(&resume).recv_timeout(Duration::from_secs(10)).unwrap();
    }));
    let address = host.address;
    let client = std::thread::spawn(move || crate::serve::tests::exchange(address,
        "POST /dev/clock/advance HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: 17\r\n\r\n{\"duration\":\"1s\"}"));
    paused.recv_timeout(Duration::from_secs(5)).unwrap();
    assert_eq!(lock(&host.shared.clock).offset(), 1_000);
    let (unfill, held) = fill(&host.shared);
    release.send(()).unwrap();
    let response = client.join().unwrap();
    unfill.send(()).unwrap();
    held.wait().unwrap();
    *lock(&host.shared.clock_advanced) = None;
    assert_eq!(status(&response), 500, "{response}");
    let report = body(&response);
    assert_eq!(report["advancedMs"], 1_000);
    assert_eq!(report["reportIncomplete"], true);
    assert_eq!(report["denied"]["code"], "E_CLOCK_REPORT_INCOMPLETE");
    assert_ne!(report["denied"]["retryable"], true);
    assert!(!response.to_ascii_lowercase().contains("retry-after:"));
    // Follow the recovery instruction once: drain/report pending work with 0ms.
    // Repeating the original 1s request would intentionally add another second;
    // clock advances have no idempotency key and this response forbids that retry.
    let recovered = host.request("POST", "/dev/clock/advance", "", r#"{"duration":"0ms"}"#);
    assert_eq!(status(&recovered), 200, "{recovered}");
    assert_eq!(lock(&host.shared.clock).offset(), 1_000);
}

#[test]
fn unknown_mint_fences_orphaned_credentials_before_replacement() {
    let host = Host::with_store(false, snapback4_core::Store::memory().unwrap(),
        "query who():\n  return viewer\n");
    let revision = host.shared.worker_revision.load(std::sync::atomic::Ordering::Acquire);
    let orphan = host.shared.engine.attempt(move |engine, shared| snapback4_core::identity::mint_supervised_child(engine.store(), None, shared.now(), revision)).unwrap();
    for code in ["E_RATE_LIMIT", "E_COMMITTER_STOPPED", "E_STORE_OWNERSHIP", "E_COMMITTER_REENTRANT"] {
        assert!(!crate::dev_worker::mint_refusal(&host.shared, revision, &snapback4_core::Refusal::new(code, "store", "not applied")));
        assert_eq!(host.shared.worker_revision.load(std::sync::atomic::Ordering::Acquire), revision);
    }
    let unknown = snapback4_core::RuntimeError::CommitOutcomeUnknown("mint committed, worker died before reply".into()).refusal();
    assert!(crate::dev_worker::mint_refusal(&host.shared, revision, &unknown));
    assert!(crate::dev_worker::mint_refusal(&host.shared, revision, &unknown));
    assert_eq!(host.shared.worker_revision.load(std::sync::atomic::Ordering::Acquire), revision + 1);
    let headers = format!("Authorization: Bearer {}\r\n", orphan.token);
    assert_eq!(crate::serve::tests::status(&host.request("POST", "/q/who", &headers, "{}")), 401);
    let replacement = host.shared.engine.attempt(move |engine, shared| snapback4_core::identity::mint_supervised_child(engine.store(), None, shared.now(), revision + 1)).unwrap();
    let headers = format!("Authorization: Bearer {}\r\n", replacement.token);
    assert_eq!(crate::serve::tests::status(&host.request("POST", "/q/who", &headers, "{}")), 200);
}

#[test]
fn source_watcher_retries_overload_and_keeps_watching_later_edits() {
    let dir = crate::serve::tests::ReaderTestDirectory::new();
    std::fs::create_dir_all(dir.0.join("snapback")).unwrap();
    let source = "use personas alice\nquery read():\n  return 1\n";
    let file = dir.0.join("snapback/schema.q");
    std::fs::write(&file, source).unwrap();
    let project = crate::project::Project { root: dir.0.clone() };
    let stamp = project.sources_stamp();
    let host = Host::with_store(true, snapback4_core::Store::open(&dir.0.join("watch.sqlite")).unwrap(), source);
    std::fs::write(&file, source.replace("return 1", "return 2")).unwrap();
    let (release, held) = fill(&host.shared);
    let turns = Arc::new(AtomicUsize::new(0));
    let stopping = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let (observed, stop, shared) = (turns.clone(), stopping.clone(), host.shared.clone());
    let watcher = std::thread::spawn(move || crate::serve::adoption::watch_sources_until(project, shared, stamp, false, || {
        observed.fetch_add(1, Ordering::AcqRel);
        stop.load(Ordering::Acquire)
    }));
    let until = Instant::now() + Duration::from_secs(5);
    while turns.load(Ordering::Acquire) < 2 && Instant::now() < until { std::thread::sleep(Duration::from_millis(5)); }
    release.send(()).unwrap(); held.wait().unwrap();
    let continued = turns.load(Ordering::Acquire) >= 2;
    let query = |n: i64| {
        let response = host.request("POST", "/q/read", "x-snapback-persona: alice\r\n", "{}");
        status(&response) == 200 && body(&response)["data"] == n
    };
    let until = Instant::now() + Duration::from_secs(10);
    while !query(2) && Instant::now() < until { std::thread::sleep(Duration::from_millis(20)); }
    let adopted = query(2);
    std::fs::write(&file, source.replace("return 1", "return 3")).unwrap();
    let until = Instant::now() + Duration::from_secs(10);
    while !query(3) && Instant::now() < until { std::thread::sleep(Duration::from_millis(20)); }
    let later = query(3);
    stopping.store(true, Ordering::Release);
    watcher.join().unwrap();
    assert!(continued, "watcher exited on transient refusal");
    assert!(adopted && later, "watcher must adopt the pending source and a later edit");
}

// @ref LLP 3000.009.001.000.001#7 — a confirmed commit keeps its facts through loss before publication; no second admission or database read.
fn carried_publication_after_queue_loss(pg: bool) {
    let store = if pg {
        #[cfg(feature = "postgres")]
        { snapback4_core::store_port::AnyStore::create_postgres(
            &std::env::var("SNAPBACK4_EVAL_POSTGRES").expect("private Postgres cluster"),
            &format!("sb4_rt1_loss_{:x}", snapback4_core::ids::seed()),
        ).unwrap() }
        #[cfg(not(feature = "postgres"))]
        { unreachable!() }
    } else { snapback4_core::store_port::AnyStore::memory().unwrap() };
    let host = Host::with_store(false, store, SOURCE);
    let shared = host.shared.clone();
    let (entered, started) = mpsc::channel();
    let (release, resume) = mpsc::channel();
    let request = std::thread::spawn(move || shared.engine.attempt(move |engine, shared| {
        let ack = engine.mutate_acknowledged("add", Some("confirmed"), Context::new("alice", Default::default()).at(1000))?;
        let expected = super::super::head::response_head(engine).unwrap();
        let publication = ack.publication.as_ref().unwrap();
        assert_eq!((publication.store_id.clone(), publication.head), expected);
        assert_eq!(publication.generation, engine.generation());
        assert_eq!(publication.preserved, engine.store().preserved_between(engine.schema(), publication.head - 1, publication.head));
        entered.send(()).unwrap();
        resume.recv_timeout(Duration::from_secs(15)).unwrap();
        let counted = snapback4_core::round_trips::Scope::begin();
        let (outcome, metadata, preserved, generation) = super::super::head::mutation_acknowledgement(shared, engine, Ok(ack));
        assert_eq!(counted.counts(), snapback4_core::round_trips::Counts::default());
        drop(counted);
        assert_eq!(super::super::head::response_head(engine).unwrap(), expected);
        let outcome = outcome.unwrap();
        assert!(matches!(outcome.state, snapback4_core::WriteState::Sent { seq, .. } if seq == expected.1));
        assert_eq!(metadata.unwrap(), expected);
        assert_eq!(generation, engine.generation());
        Ok::<_, snapback4_core::RuntimeError>((expected, preserved, generation))
    }));
    started.recv_timeout(Duration::from_secs(15)).unwrap();
    host.shared.engine.queue.refuse_ownership();
    release.send(()).unwrap();
    let ((identity, head), _, generation) = request.join().unwrap().unwrap();
    let wake = lock(&host.shared.wake);
    assert_eq!(wake.seq, head);
    assert_eq!(wake.store_id.as_deref(), Some(identity.as_str()));
    assert_eq!(wake.generation, generation);
}

#[test]
fn carried_publication_sqlite_finishes_after_queue_loss_without_reads() {
    carried_publication_after_queue_loss(false);
}
#[cfg(feature = "postgres")]
#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn round_trips_postgres_committed_publication_after_queue_loss_without_reads() {
    carried_publication_after_queue_loss(true);
}

#[test]
fn executed_replay_keeps_its_current_head_publication() {
    let host = host();
    host.shared.engine.attempt(|engine, shared| {
        let context = || Context::new("alice", Default::default()).at(1000);
        let first = engine.mutate_acknowledged("add", Some("historical"), context())?;
        let historical = first.publication.unwrap().head;
        engine.mutate("add", None, context())?;
        let expected = super::super::head::response_head(engine).unwrap();
        assert!(expected.1 > historical);
        let replay = engine.mutate_acknowledged("add", Some("historical"), context())?;
        assert!(replay.outcome.replayed && replay.publication.is_none());
        let (outcome, metadata, preserved, _) = super::super::head::mutation_acknowledgement(shared, engine, Ok(replay));
        assert!(matches!(outcome.unwrap().state, snapback4_core::WriteState::Sent { seq, .. } if seq == historical));
        assert_eq!(metadata.unwrap(), expected);
        assert!(preserved.is_none());
        assert_eq!(lock(&shared.wake).seq, expected.1);
        Ok::<_, snapback4_core::RuntimeError>(())
    }).unwrap();
}
