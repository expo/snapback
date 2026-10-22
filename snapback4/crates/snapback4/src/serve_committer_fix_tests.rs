//! Regression witnesses for K0-Q review refusals and independent progress.
use super::*;
use crate::serve::tests::{Host, body, status};
use std::sync::mpsc;

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
        let why = &envelope["denied"];
        assert_eq!(why["code"], code, "{path}: {response}");
        assert_eq!(
            why["retryable"].as_bool().unwrap_or(false),
            retryable,
            "{path}: {response}"
        );
        assert_eq!(
            response.to_ascii_lowercase().contains("retry-after: 1\r\n"),
            retryable
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
fn disconnected_acknowledgements_are_unknown_and_never_retryable_on_any_door() {
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
    assert_eq!(why.code, "E_COMMIT_OUTCOME_UNKNOWN");
    assert!(!why.retryable);
    doors(&host, "E_COMMIT_OUTCOME_UNKNOWN", 500, false);
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
