use super::*;
use snapback4_core::{Store, Value, value::object};
const SOURCE: &str = include_str!("../../../snapback4-core/tests/ephemeral/schema.q");
const ALICE: &str = "x-snapback-persona: alice\r\n";
const BOB: &str = "x-snapback-persona: bob\r\n";
fn source() -> String {
    format!(
        "use identity\nuse personas alice, bob\n{SOURCE}\ntable viewing:\n  principal: principal\n  unique byPrincipal: principal\n  read <- allow\n  insert <- .principal = viewer\n  update <- .principal = viewer\n  ephemeral 30s\nmutation view():\n  upsert viewing[principal = viewer] {{ principal: viewer }}\nquery viewers():\n  return viewing first 10 by byId\n"
    )
}
fn host(disk: bool) -> (Host, Option<std::path::PathBuf>) {
    let dir = disk.then(|| {
        let d = std::env::temp_dir().join(format!(
            "sb4-eph-http-{}-{}",
            std::process::id(),
            snapback4_core::ids::seed()
        ));
        std::fs::create_dir_all(&d).unwrap();
        d
    });
    let store = match &dir {
        Some(d) => Store::open(&d.join("store.sqlite")).unwrap(),
        None => Store::memory().unwrap(),
    };
    let h = Host::with_store(true, store, &source());
    seed(&h, "dev:alice", "dev:bob");
    (h, dir)
}
fn seed(h: &Host, a: &str, b: &str) {
    lock(&h.shared.engine)
        .seed([
            (
                "rooms".into(),
                object([
                    ("id", Value::Id("r".into())),
                    ("title", Value::String("Room".into())),
                ]),
            ),
            (
                "members".into(),
                object([
                    ("id", Value::Id("a".into())),
                    ("roomId", Value::Id("r".into())),
                    ("principal", Value::Id(a.into())),
                ]),
            ),
            (
                "members".into(),
                object([
                    ("id", Value::Id("b".into())),
                    ("roomId", Value::Id("r".into())),
                    ("principal", Value::Id(b.into())),
                ]),
            ),
        ])
        .unwrap();
}
fn set(h: &Host) -> Json {
    let r = h.request(
        "POST",
        "/m/setTyping",
        ALICE,
        r#"{"id":"typing-id","args":{"roomId":"r","payload":""},"newIds":["untrusted-id"]}"#,
    );
    assert_eq!(status(&r), 200, "{r}");
    body(&r)
}
fn poll_url(h: &Host, interest: &str) -> String {
    let engine = lock(&h.shared.engine);
    let snap = h.shared.ephemeral.snapshot().unwrap();
    format!(
        "/changes?since={}&wait=1&eph={}&ephi={}&ephTables={interest}",
        engine.seq().unwrap(),
        snap.version.epoch,
        snap.version.incarnation
    )
}
fn blocked(h: &Host, url: String) -> (JoinHandle<String>, mpsc::Receiver<()>) {
    blocked_as(h, url, BOB.to_owned())
}
fn blocked_as(h: &Host, url: String, headers: String) -> (JoinHandle<String>, mpsc::Receiver<()>) {
    let (notify, wait) = mpsc::channel();
    *lock(&h.shared.poll_wait) = Some(Arc::new(move || {
        let _ = notify.send(());
    }));
    let address = h.address;
    let poll = thread::spawn(move || {
        exchange(
            address,
            &format!("GET {url} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n{headers}\r\n"),
        )
    });
    wait.recv_timeout(Duration::from_secs(2))
        .expect("poll reaches wait_timeout");
    // Taking this mutex after the hook proves wait_timeout has atomically
    // released it. The mutation then tests a genuinely held peer poll.
    drop(lock(&h.shared.wake));
    (poll, wait)
}
#[test]
fn mutation_wire_query_version_and_no_sqlite_writer_lock() {
    for disk in [false, true] {
        let (h, dir) = host(disk);
        let seq = lock(&h.shared.engine).seq().unwrap();
        let writer = dir
            .as_ref()
            .map(|d| rusqlite::Connection::open(d.join("store.sqlite")).unwrap());
        if let Some(w) = &writer {
            w.execute_batch("BEGIN IMMEDIATE").unwrap();
        }
        let start = Instant::now();
        let sent = set(&h);
        assert_eq!(sent["state"], "sent", "{sent}");
        assert!(start.elapsed() < Duration::from_millis(250));
        assert!(sent.get("seq").is_none());
        assert_eq!(sent["head"], seq);
        assert_eq!(sent["ephemeral"]["tables"], json!(["typing"]));
        assert_eq!(sent["ephemeral"]["epoch"], 1);
        assert!(sent["result"].get("$deadline").is_none());
        assert_ne!(sent["result"]["id"], "untrusted-id");
        if let Some(w) = &writer {
            w.execute_batch("ROLLBACK").unwrap();
        }
        drop(writer);
        let q = body(&h.request("POST", "/q/typingIn", BOB, r#"{"args":{"roomId":"r"}}"#));
        assert_eq!(q["data"].as_array().unwrap().len(), 1);
        assert!(q["nextExpiry"].is_number());
        assert_eq!(q["ephemeral"]["epoch"], 1);
        assert!(q["ephemeral"].get("tables").is_none());
        assert_eq!(
            set(&h)["ephemeral"]["epoch"],
            2,
            "correlation id is not idempotence"
        );
        assert_eq!(lock(&h.shared.engine).seq().unwrap(), seq);
        drop(h);
        if let Some(d) = dir {
            std::fs::remove_dir_all(d).unwrap();
        }
    }
}
#[test]
fn blocked_poll_wakes_without_lost_notification_and_is_paced() {
    let (h, dir) = host(true);
    let url = poll_url(&h, "typing");
    let began = Instant::now();
    let (poll, _) = blocked(&h, url);
    let sent_at = Instant::now();
    assert_eq!(set(&h)["state"], "sent");
    let reply = body(&poll.join().unwrap());
    assert!(
        sent_at.elapsed() < Duration::from_millis(250),
        "wake took {:?}",
        sent_at.elapsed()
    );
    assert!(began.elapsed() >= Duration::from_millis(95));
    assert_eq!(reply["ephemeral"]["tables"], json!(["typing"]));
    assert_eq!(reply["ephemeral"]["epoch"], 1);
    drop(h);
    std::fs::remove_dir_all(dir.unwrap()).unwrap();
}
#[test]
fn unrelated_interest_keeps_waiting_and_absent_interest_means_all() {
    let (h, dir) = host(true);
    let began = Instant::now();
    let (poll, wait) = blocked(&h, poll_url(&h, "viewing"));
    set(&h);
    wait.recv_timeout(Duration::from_millis(250))
        .expect("unrelated wake returns to wait");
    assert!(!poll.is_finished());
    let reply = body(&poll.join().unwrap());
    assert!(began.elapsed() >= Duration::from_millis(950));
    assert_eq!(reply["ephemeral"]["tables"], json!([]));
    let (poll, _) = blocked(&h, poll_url(&h, "typing").replace("&ephTables=typing", ""));
    set(&h);
    assert_eq!(
        body(&poll.join().unwrap())["ephemeral"]["tables"],
        json!(["typing"])
    );
    drop(h);
    std::fs::remove_dir_all(dir.unwrap()).unwrap();
}
#[test]
fn legacy_poll_reply_has_exact_base_shape() {
    let h = Host::new(true);
    let reply = body(&h.request("GET", "/changes?since=0&wait=0", ALICE, ""));
    // Frozen base route body, with the store id and host clock bound at runtime.
    let expected = json!({"seq":0,"tables":[],"generation":1,"store_id":lock(&h.shared.engine).store().meta("store_id").unwrap().unwrap()});
    assert_eq!(
        serde_json::to_string(&reply).unwrap(),
        serde_json::to_string(&expected).unwrap()
    );
}
#[test]
fn rate_and_input_refusals_are_http_200_failed_under_dev_and_serve() {
    for dev in [true, false] {
        let h = Host::with_store(dev, Store::memory().unwrap(), &source());
        let session = body(&h.request("POST", "/auth/guest", "", "{}"));
        let token = session["session"]["token"].as_str().unwrap();
        let principal = session["session"]["principal"].as_str().unwrap();
        seed(&h, principal, "peer");
        let headers = format!("Authorization: Bearer {token}\r\n");
        // Drain a deterministic bucket at one instant; the HTTP request checks
        // that same session and preserves the failed wire status under both hosts.
        let key = snapback4_core::value::digest(&token);
        let now = Instant::now();
        for _ in 0..40 {
            assert!(h.shared.ephemeral_rate.admit(key.clone(), now));
        }
        let reply = h.request(
            "POST",
            "/m/setTyping",
            &headers,
            r#"{"id":"limited","args":{"roomId":"r","payload":""}}"#,
        );
        assert_eq!(status(&reply), 200);
        let reply = body(&reply);
        assert_eq!(reply["state"], "failed");
        assert_eq!(reply["why"]["code"], "E_RATE_LIMIT");
        assert_eq!(reply["why"]["family"], "auth");
        assert_eq!(reply["why"]["retryable"], true);
        assert!(reply.get("seq").is_none());
        for spaces in 2..=7 {
            let headers = format!("Authorization: Bearer{}{token}  \r\n", " ".repeat(spaces));
            let reply = body(&h.request("POST", "/m/setTyping", &headers,
                r#"{"args":{"roomId":"r","payload":""}}"#));
            assert_eq!(reply["why"]["code"], "E_RATE_LIMIT", "spacing {spaces}: {reply}");
        }
    }
}
#[test]
fn adoption_and_restart_change_incarnation_and_removed_members_read_empty() {
    let (h, dir) = host(true);
    let before = set(&h)["ephemeral"]["incarnation"].clone();
    let removal = h.request(
        "POST",
        "/m/removeMember",
        BOB,
        r#"{"args":{"roomId":"r","who":"dev:alice"}}"#,
    );
    assert_eq!(body(&removal)["state"], "sent");
    let read = body(&h.request("POST", "/q/typingIn", ALICE, r#"{"args":{"roomId":"r"}}"#));
    assert_eq!(read["data"], json!([]));
    let b = snapback4_lang::compile(&[(
        "schema.q".into(),
        source().replace("ephemeral 4s", "ephemeral 5s"),
    )]);
    {
        let mut engine = lock(&h.shared.engine);
        engine
            .adopt_at(
                b.schema.clone(),
                b.programs.iter().map(|p| p.program.clone()),
                h.shared.now(),
            )
            .unwrap();
        lock(&h.shared.readers).invalidate();
        *lock(&h.shared.bound) = b;
        h.shared.publish_engine(&engine);
    }
    let after = h.shared.ephemeral.snapshot().unwrap().version.incarnation;
    assert_ne!(before, json!(after));
    let dir = dir.unwrap();
    drop(h);
    let restarted = Host::with_store(
        true,
        Store::open(&dir.join("store.sqlite")).unwrap(),
        &source(),
    );
    assert_ne!(
        restarted
            .shared
            .ephemeral
            .snapshot()
            .unwrap()
            .version
            .incarnation,
        after
    );
    drop(restarted);
    std::fs::remove_dir_all(dir).unwrap();
}
#[test]
fn token_bucket_refills_at_twenty_per_second() {
    let r = ephemeral::Rate::default();
    let now = Instant::now();
    for _ in 0..40 {
        assert!(r.admit("session".into(), now));
    }
    assert!(!r.admit("session".into(), now));
    assert!(!r.admit("session".into(), now + Duration::from_millis(49)));
    assert!(r.admit("session".into(), now + Duration::from_millis(50)));
    assert!(r.admit("another-session".into(), now));
}

#[test]
fn ephemeral_wake_finishes_with_the_serving_engine_locked() {
    let (h, dir) = host(true);
    let mut reader = lock(&h.shared.engine).reader().unwrap();
    let (poll, _) = blocked(&h, poll_url(&h, "typing"));
    let engine = lock(&h.shared.engine);
    reader
        .mutate_ephemeral(
            "setTyping",
            Context::new(
                "dev:alice",
                [
                    ("roomId".into(), Value::Id("r".into())),
                    ("payload".into(), Value::String(String::new())),
                ]
                .into(),
            )
            .at(h.shared.now()),
        )
        .unwrap();
    let (done, result) = mpsc::channel();
    thread::spawn(move || done.send(poll.join().unwrap()).unwrap());
    let reply = result.recv_timeout(Duration::from_millis(250));
    drop(engine);
    assert_eq!(
        body(&reply.expect("ephemeral-only wake must not take the engine"))["ephemeral"]["tables"],
        json!(["typing"])
    );
    drop(h);
    std::fs::remove_dir_all(dir.unwrap()).unwrap();
}

#[test]
fn revoked_bearer_poll_finishes_on_a_read_only_connection_without_engine_lock() {
    let (h, dir) = host(true);
    let session = body(&h.request("POST", "/auth/guest", "", "{}"));
    let token = session["session"]["token"].as_str().unwrap();
    let mut reader = lock(&h.shared.engine).reader().unwrap();
    let (poll, _) = blocked_as(&h, poll_url(&h, "typing"), format!("Authorization: Bearer {token}\r\n"));
    let mut engine = lock(&h.shared.engine);
    snapback4_core::identity::logout_session(engine.store_mut(), token, || h.shared.now()).unwrap();
    reader.mutate_ephemeral("setTyping", Context::new("dev:alice", [
        ("roomId".into(), Value::Id("r".into())),
        ("payload".into(), Value::String(String::new())),
    ].into()).at(h.shared.now())).unwrap();
    let (done, result) = mpsc::channel();
    thread::spawn(move || done.send(poll.join().unwrap()).unwrap());
    let reply = result.recv_timeout(Duration::from_millis(250));
    drop(engine);
    let reply = reply.expect("bearer recheck must not take the engine on an ephemeral-only wake");
    assert_eq!(status(&reply), 401, "{reply}");
    assert_eq!(body(&reply)["denied"]["code"], "E_AUTH", "{reply}");
    drop(h);
    std::fs::remove_dir_all(dir.unwrap()).unwrap();
}

#[test]
fn bearer_poll_crosses_schema_adoption_without_using_a_stale_catalog_or_engine_lock() {
    for ephemeral in [false, true] {
        let (mut h, dir) = host(true);
        let dir = dir.unwrap();
        let source = if ephemeral { source() } else { SCHEMA.to_owned() };
        if !ephemeral {
            drop(h);
            h = Host::with_store(true, Store::open(&dir.join("store.sqlite")).unwrap(), &source);
        }
        let session = body(&h.request("POST", "/auth/guest", "", "{}"));
        let token = session["session"]["token"].as_str().unwrap();
        let reader = lock(&h.shared.engine).reader().unwrap();
        assert!(snapback4_core::identity::resolve_read_only(reader.store(), token, h.shared.now(), Some("replaced-store")).unwrap().is_none());
        let before = lock(&h.shared.engine).seq().unwrap();
        // This fixture seeds through the core directly, outside HTTP commit publication.
        h.shared.publish_engine(&lock(&h.shared.engine));
        let url = if ephemeral { poll_url(&h, "typing") } else { format!("/changes?since={before}&wait=1") };
        let (poll, _) = blocked_as(&h, url, format!("Authorization: Bearer {token}\r\n"));
        let b = snapback4_lang::compile(&[("schema.q".into(), format!("{source}\nquery added():\n  return 1\n"))]);
        let mut engine = lock(&h.shared.engine);
        engine.adopt_at(b.schema.clone(), b.programs.iter().map(|p| p.program.clone()), h.shared.now()).unwrap();
        let generation = engine.generation();
        assert_eq!(engine.seq().unwrap(), before);
        *lock(&h.shared.bound) = b;
        // Pause before serve_adoption publishes its other metadata: the hub
        // rebind must already have published the new generation atomically.
        let (done, result) = mpsc::channel();
        thread::spawn(move || done.send(poll.join().unwrap()).unwrap());
        let reply = result.recv_timeout(Duration::from_millis(250));
        drop(engine);
        let reply = reply.expect("schema-only adoption must finish without the engine");
        assert_eq!(status(&reply), 200, "{reply}");
        let reply = body(&reply);
        assert_eq!(reply["generation"], generation);
        assert_eq!(reply["seq"], before);
        assert_eq!(reply.get("ephemeral").is_some(), ephemeral);
        drop(reader);
        drop(h);
        std::fs::remove_dir_all(dir).unwrap();
    }
}

#[test]
fn every_ephemeral_refusal_uses_failed_http_200() {
    let (h, dir) = host(true);
    for (headers, input, code) in [
        (ALICE, "{", "E_INPUT"),
        (ALICE, r#"{"args":{"roomId":"r","payload":5}}"#, "E_INPUT"),
        (
            ALICE,
            r#"{"args":{"roomId":"missing","payload":""}}"#,
            "NOT_FOUND",
        ),
        (
            ALICE,
            r#"{"store_id":"wrong","args":{"roomId":"r","payload":""}}"#,
            "E_STORE_REPLACED",
        ),
        ("Authorization: Bearer bogus\r\n", "{}", "E_AUTH"),
    ] {
        let reply = h.request("POST", "/m/setTyping", headers, input);
        assert_eq!(status(&reply), 200, "{reply}");
        let reply = body(&reply);
        assert_eq!(reply["state"], "failed");
        assert_eq!(reply["why"]["code"], code, "{reply}");
        assert!(reply.get("seq").is_none());
    }
    drop(h);
    std::fs::remove_dir_all(dir.unwrap()).unwrap();
}

#[test]
fn admission_rechecks_classification_when_adoption_passes_the_early_route_check() {
    let (h, dir) = host(true);
    // Simulate an early classifier that saw the previous durable operation.
    // Both the replay and idless execution boundary must use the engine's fact.
    lock(&h.shared.bound).schema.operations.get_mut("setTyping").unwrap().ephemeral = false;
    for input in [
        r#"{"id":"formerly-durable","args":{"roomId":"r","payload":""}}"#,
        r#"{"args":{"roomId":"r","payload":""}}"#,
    ] {
        let reply = body(&h.request("POST", "/m/setTyping", ALICE, input));
        assert_eq!(reply["state"], "sent", "{reply}");
        assert!(reply.get("seq").is_none());
        assert!(reply["ephemeral"]["epoch"].is_number());
    }
    drop(h);
    std::fs::remove_dir_all(dir.unwrap()).unwrap();
}

#[test]
fn durable_publication_does_not_acquire_the_ephemeral_hub() {
    let (h, dir) = host(true);
    let hub = h.shared.ephemeral.lock().unwrap();
    let shared = h.shared.clone();
    let (done, result) = mpsc::channel();
    let worker = thread::spawn(move || {
        shared.publish_engine(&lock(&shared.engine));
        done.send(()).unwrap();
    });
    let outcome = result.recv_timeout(Duration::from_millis(250));
    drop(hub);
    worker.join().unwrap();
    outcome.expect("publishing durable state cannot wait for an ephemeral program");
    drop(h);
    std::fs::remove_dir_all(dir.unwrap()).unwrap();
}

#[test]
fn action_admission_notifies_held_polls_without_maintenance() {
    let h = Host::with_store(true, Store::memory().unwrap(),
        "use personas alice\nuse server\naction work() <- allow\n");
    let before = lock(&h.shared.engine).seq().unwrap();
    let (poll, wakes) = blocked_as(&h, format!("/changes?since={before}&wait=1"), ALICE.into());
    let answer = body(&h.request("POST", "/a/work?wait=0", ALICE, r#"{"id":"work","args":{}}"#));
    assert_eq!(answer["state"], "pending", "{answer}");
    // Action custody commits do not advance the row log. They must still
    // notify the held poll directly, which checks its predicate and waits again.
    wakes.recv_timeout(Duration::from_millis(250)).expect("action commit wakes the poll directly");
    assert_eq!(lock(&h.shared.wake).seq, lock(&h.shared.engine).seq().unwrap());
    assert_eq!(body(&poll.join().unwrap())["seq"], before);
}
