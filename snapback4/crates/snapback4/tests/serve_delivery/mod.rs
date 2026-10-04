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
        json!([{"table":"messages","mutation":"delivered","args":["group","low","high"],"fingerprint":"2f5d2629caf0cd61eacb5eb5bd772dd8684be9e7872af1112bd679c5719f3443","rows":[["c1",1]]}])
    );
    assert!(answer["meter"]["delivery"]["steps"].as_u64().unwrap() > 0);
    assert!(answer.get("rowProvenance").is_none());
    let query_extra = body(&h.request("POST", "/q/raw", ALICE, r#"{"args":{},"delivery":null}"#));
    assert_eq!(query_extra["data"], answer["data"], "the new field belongs to mutation requests");
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

fn adopt(h: &Host, source: &str) {
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = lock(&h.shared.engine);
    let generation = engine.adopt(bound.schema.clone(), bound.programs.iter().map(|p|p.program.clone())).unwrap();
    *lock(&h.shared.bound) = bound;
    *lock(&h.shared.generation) = generation;
    h.shared.publish_engine(&engine);
}

#[test]
fn http_receipt_precedes_ephemeral_dispatch_and_stale_fingerprint_refuses() {
    let source = format!("use personas alice, bob\ntable signals:\n  principal: principal\n  n: int\n  insert <- .principal = viewer\n  read <- allow\n  ephemeral 4s\n{SOURCE}\nquery signalsNow():\n  return signals first 20\n");
    let h = Host::with_store(true, Store::memory().unwrap(), &source);
    let fp = lock(&h.shared.engine).schema().delivery[0].fingerprint.clone();
    let request = json!({"id":"old","args":{"group":"c1","low":1,"high":1},"delivery":{"fingerprint":fp}});
    let first = body(&h.request("POST", "/m/delivered", ALICE, &request.to_string()));
    assert_eq!(first["state"], "sent", "{first}");
    let changed = source.replace("\n  reports delivery of messages by .chat, .ordinal:", ":")
        .replacen("  return null\nmutation ordinary", "  insert signals {principal: viewer, n: low}\n  return null\nmutation ordinary",1);
    adopt(&h, &changed);
    for _ in 0..2 {
        let replay = body(&h.request("POST", "/m/delivered", ALICE, &request.to_string()));
        assert_eq!(replay["state"], "sent", "{replay}");
        assert_eq!(replay["seq"], first["seq"]);
        assert!(replay.get("ephemeral").is_none(), "{replay}");
    }
    let mut fresh = request.clone(); fresh["id"] = json!("fresh");
    let rejected = body(&h.request("POST", "/m/delivered", ALICE, &fresh.to_string()));
    assert_eq!(rejected["why"]["code"], "E_DELIVERY_BINDING", "{rejected}");
    assert!(!rejected["why"]["retryable"].as_bool().unwrap_or(false));
    let signals = body(&h.request("POST", "/q/signalsNow", ALICE, "{}"));
    assert_eq!(signals["data"], json!([]), "{signals}");
    fresh.as_object_mut().unwrap().remove("delivery");
    for _ in 0..2 {
        let signal = body(&h.request("POST", "/m/delivered", ALICE, &fresh.to_string()));
        assert_eq!(signal["state"], "sent", "{signal}");
        assert!(signal.get("ephemeral").is_some());
    }
    let signals = body(&h.request("POST", "/q/signalsNow", ALICE, "{}"));
    assert_eq!(signals["data"].as_array().unwrap().len(), 2);
}

#[test]
fn http_rebound_removed_and_malformed_bindings_never_run_the_body() {
    for change in ["removed", "rebound", "renamed", "arguments"] {
        let h = host();
        let fp = lock(&h.shared.engine).schema().delivery[0].fingerprint.clone();
        let changed = match change {
            "removed" => SOURCE.replace("\n  reports delivery of messages by .chat, .ordinal:", ":"),
            "rebound" => SOURCE.replace("messages", "notes"),
            "renamed" => SOURCE.replace("mutation delivered", "mutation newDelivery"),
            _ => SOURCE.replace("low", "first"),
        }.replace("  return null\nmutation ordinary", "  require false else BODY_RAN\n  return null\nmutation ordinary");
        adopt(&h, &format!("use personas alice, bob\n{changed}"));
        for delivery in [json!({"fingerprint":fp}), json!({}), json!(null)] {
            let req = json!({"id":"fresh","args":{"group":"c1","low":1,"high":1},"delivery":delivery});
            let out = body(&h.request("POST", "/m/delivered", ALICE, &req.to_string()));
            let why = out.get("why").or_else(|| out.get("denied")).unwrap();
            assert_eq!(why["code"], "E_DELIVERY_BINDING", "{change}: {out}");
            assert!(!why["retryable"].as_bool().unwrap_or(false));
        }
    }
}

#[test]
fn binding_is_rechecked_after_waiting_for_the_executing_writer() {
    let h = host();
    let fp = lock(&h.shared.engine).schema().delivery[0].fingerprint.clone();
    let gate = Arc::new(WorkGate::default());
    let _release_on_panic = ReleaseGate(gate.clone());
    let hook = gate.clone();
    let visits = AtomicUsize::new(0);
    *lock(&h.shared.mutation_wait) = Some(Arc::new(move || {
        if visits.fetch_add(1, Ordering::AcqRel) == 2 {
            hook.park();
        }
    }));
    let address = h.address;
    let request = thread::spawn(move || {
        let payload = json!({"id":"waiting","args":{"group":"c1","low":1,"high":1},"delivery":{"fingerprint":fp}}).to_string();
        exchange_held(address, WAIT_TIMEOUT, &format!("POST /m/delivered HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n{ALICE}Content-Length: {}\r\n\r\n{payload}", payload.len()))
    });
    wait_until(|| gate.entered.load(Ordering::Acquire) == 1); // receipt/fingerprint preflight passed; body has not run
    let changed = SOURCE.replace("\n  reports delivery of messages by .chat, .ordinal:", ":")
        .replace("  return null\nmutation ordinary", "  require false else BODY_RAN\n  return null\nmutation ordinary");
    adopt(&h, &format!("use personas alice, bob\n{changed}"));
    let head = lock(&h.shared.engine).seq().unwrap();
    gate.release();
    let response = request.join().unwrap();
    assert_eq!(status(&response), 200, "a terminal binding refusal is not a transport failure");
    let result = body(&response);
    assert_eq!(result["why"]["code"], "E_DELIVERY_BINDING", "{result}");
    assert_eq!(lock(&h.shared.engine).seq().unwrap(), head);
}

#[test]
fn adoption_after_preflight_decodes_the_captured_signature_then_refuses_binding() {
    for change in ["arguments", "removed", "query"] {
        let h = host();
        let fp = lock(&h.shared.engine).schema().delivery[0].fingerprint.clone();
        let gate = Arc::new(WorkGate::default());
        let _release_on_panic = ReleaseGate(gate.clone());
        let hook = gate.clone();
        let visits = AtomicUsize::new(0);
        *lock(&h.shared.mutation_wait) = Some(Arc::new(move || {
            if visits.fetch_add(1, Ordering::AcqRel) == 1 {
                hook.park();
            }
        }));
        let address = h.address;
        let request = thread::spawn(move || {
            let payload = json!({"id":"preflight","args":{"group":"c1","low":1,"high":1},"delivery":{"fingerprint":fp}}).to_string();
            exchange_held(address, WAIT_TIMEOUT, &format!("POST /m/delivered HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n{ALICE}Content-Length: {}\r\n\r\n{payload}", payload.len()))
        });
        wait_until(|| gate.entered.load(Ordering::Acquire) == 1); // preflight released ownership; decoding has not begun
        let changed = match change {
            "arguments" => SOURCE.replace("low", "first"),
            "removed" => SOURCE.replace("mutation delivered", "mutation newDelivery"),
            _ => SOURCE.replace("mutation delivered", "query delivered")
                .replace("\n  reports delivery of messages by .chat, .ordinal:", ":"),
        }.replace("  return null\nmutation ordinary", "  require false else BODY_RAN\n  return null\nmutation ordinary");
        adopt(&h, &format!("use personas alice, bob\n{changed}"));
        let head = lock(&h.shared.engine).seq().unwrap();
        gate.release();
        let response = request.join().unwrap();
        assert_eq!(status(&response), 200, "{change}: {response}");
        let result = body(&response);
        assert_eq!(result["why"]["code"], "E_DELIVERY_BINDING", "{change}: {result}");
        assert!(!result["why"]["retryable"].as_bool().unwrap_or(false));
        assert_eq!(lock(&h.shared.engine).seq().unwrap(), head);
    }
}
