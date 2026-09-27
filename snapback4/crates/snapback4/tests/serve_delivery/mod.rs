use super::*;
use snapback4_core::{Store, Value, value::object};
const SOURCE: &str = include_str!("../../../snapback4-lang/tests/delivery/schema.q");
fn host() -> Host {
    let h = Host::with_store(
        true,
        Store::memory().unwrap(),
        &format!("use personas alice, bob\n{SOURCE}"),
    );
    lock(&h.shared.engine)
        .seed([
            (
                "chats".into(),
                object([
                    ("id", Value::Id("c1".into())),
                    ("name", Value::String("chat".into())),
                ]),
            ),
            (
                "messages".into(),
                object([
                    ("id", Value::Id("m1".into())),
                    ("chat", Value::Id("c1".into())),
                    ("ordinal", Value::Int(1)),
                    ("text", Value::String("hello".into())),
                    ("owner", Value::Id("dev:alice".into())),
                    ("quote", Value::Null),
                ]),
            ),
        ])
        .unwrap();
    h.shared.publish_engine(&lock(&h.shared.engine));
    h
}
const ALICE: &str = "x-snapback-persona: alice\r\n";

#[test]
fn delivery_manifests_are_on_successful_answers_without_provenance_opt_in() {
    let h = host();
    let answer = body(&h.request("POST", "/q/raw", ALICE, r#"{"args":{}}"#));
    assert_eq!(
        answer["delivery"],
        json!([{"table":"messages","mutation":"delivered","args":["group","low","high"],"rows":[["c1",1]]}])
    );
    assert!(answer["meter"]["delivery"]["steps"].as_u64().unwrap() > 0);
    assert!(answer.get("rowProvenance").is_none());
    let scalar = body(&h.request("POST", "/q/scalar", ALICE, r#"{"args":{}}"#));
    assert_eq!(scalar["delivery"][0]["rows"], json!([]));
    let unrelated = body(&h.request("POST", "/q/unrelated", ALICE, r#"{"args":{}}"#));
    assert!(unrelated.get("delivery").is_none());
    assert!(unrelated["meter"].get("delivery").is_none());
    let denied = body(&h.request(
        "POST",
        "/q/quoteOnly",
        "x-snapback-persona: bob\r\n",
        r#"{"args":{}}"#,
    ));
    assert!(denied.get("denied").is_some());
    assert!(denied.get("delivery").is_none());
}

#[test]
fn receipt_only_reports_and_replays_do_not_wake_change_waiters() {
    let h = host();
    let head = lock(&h.shared.engine).seq().unwrap();
    for _ in 0..2 {
        let shared = h.shared.clone();
        let (ready, started) = mpsc::channel();
        let waiter = thread::spawn(move || {
            let seq = lock(&shared.seq);
            ready.send(()).unwrap();
            let (_guard, result) = shared
                .committed
                .wait_timeout(seq, Duration::from_millis(200))
                .unwrap();
            result.timed_out()
        });
        started.recv().unwrap();
        let answer = body(&h.request(
            "POST",
            "/m/delivered",
            ALICE,
            r#"{"id":"covered","args":{"group":"c1","low":1,"high":1}}"#,
        ));
        assert_eq!(answer["state"], "sent", "{answer}");
        assert_eq!(answer["seq"], head);
        assert_eq!(answer["head"], head);
        assert!(
            waiter.join().unwrap(),
            "a receipt or replay must not call durable_committed"
        );
    }
    let shared = h.shared.clone();
    let (ready, started) = mpsc::channel();
    let waiter = thread::spawn(move || {
        let seq = lock(&shared.seq);
        ready.send(()).unwrap();
        let (_guard, result) = shared
            .committed
            .wait_timeout(seq, Duration::from_secs(2))
            .unwrap();
        result.timed_out()
    });
    started.recv().unwrap();
    let ordinary = body(&h.request(
        "POST",
        "/m/ordinary",
        ALICE,
        r#"{"id":"ordinary","args":{}}"#,
    ));
    assert_eq!(ordinary["seq"], head + 1);
    assert!(
        !waiter.join().unwrap(),
        "ordinary mutations still wake readers"
    );
}
