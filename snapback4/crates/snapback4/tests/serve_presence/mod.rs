use super::*;
use snapback4_core::{Store, Value, value::object};

const PUSH: &str = "use personas alice, bob\neffect notify\nmutation push():\n  if not exists connected['dev:bob']:\n    emit notify {recipient: 'dev:bob'}\n";

fn advance_six_seconds(host: &Host) {
    // Invoke the CLI's own implementation against this host, including its
    // duration parser and POST /dev/clock/advance, without a second server.
    let options = crate::verbs::Options {
        positionals: vec!["advance".into(), "6s".into()],
        flags: [("port".into(), host.address.port().to_string())].into(),
        json: false,
    };
    assert_eq!(crate::dev_clock::command(&options), 0);
}

#[test]
fn w15a_vanished_held_poll_is_claimed_once_after_clock_advance_6s() {
    let host = Host::with_store(true, Store::memory().unwrap(), PUSH);
    host.shared.presence.enter("dev:bob");
    lock(&host.shared.engine).presence_reconnected("dev:bob", host.shared.now()).unwrap();
    let answer = host.request("POST", "/m/push", "x-snapback-persona: alice\r\n", r#"{"id":"push","args":{}}"#);
    assert_eq!(body(&answer)["state"], "sent", "{answer}");
    let queued = lock(&host.shared.engine).effects(None, 10).unwrap();
    assert_eq!(queued.len(), 1, "a vanished client's held poll must not lose the effect");
    assert_eq!(queued[0].next_at.unwrap() - queued[0].at, 5_000);
    assert!(lock(&host.shared.engine).claim_effects("worker", None, 10, 60_000, queued[0].at + 4_999).unwrap().is_empty());
    advance_six_seconds(&host);
    assert_eq!(host.shared.presence.connections("dev:bob"), 1);
    let claims = lock(&host.shared.engine).claim_effects("worker", None, 10, 60_000, host.shared.now()).unwrap();
    assert_eq!(claims.len(), 1);
    assert_eq!(claims[0].attempts, 1);
    assert!(lock(&host.shared.engine).claim_effects("other", None, 10, 60_000, host.shared.now()).unwrap().is_empty());
    let replay = host.request("POST", "/m/push", "x-snapback-persona: alice\r\n", r#"{"id":"push","args":{}}"#);
    assert_eq!(body(&replay)["replayed"], true);
    assert_eq!(lock(&host.shared.engine).effects(None, 10).unwrap().len(), 1);
    println!("w15a vanished: delay_ms=5000 advanced_ms=6000 effects=1 dependencies=1 attempts=1 duplicate_claims=0");
}

fn poll(shared: &Shared, since: u64, persona: &str, wait: u64) {
    let url = format!("/changes?since={since}&wait={wait}");
    let request = tiny_http::TestRequest::new().with_path(&url)
        .with_header(tiny_http::Header::from_bytes("Host", "localhost").unwrap())
        .with_header(tiny_http::Header::from_bytes("x-snapback-persona", persona).unwrap());
    changes::serve(request.into(), shared, &url);
}

#[test]
fn w15a_commit_wakes_all_49_recipients_and_their_next_polls_satisfy_without_attempts() {
    commit_wake_case(false);
    commit_wake_case(true);
}

fn commit_wake_case(rowless: bool) {
    let personas: Vec<_> = (1..50).map(|n| format!("recipient{n}")).collect();
    let source = include_str!("../../../snapback4-sim/tests/grace_effects/presence_cost.q")
        .replace("use personas alice, bob, carol", &format!("use personas alice, {}", personas.join(", ")));
    let source = format!("{source}\nmutation nudge(targets: [principal] <=50):\n  for p in targets:\n    if not exists connected[p]:\n      emit notify {{targetUserId: p}}\n");
    let host = Host::with_store(true, Store::memory().unwrap(), &source);
    let mut seed = vec![("conversations".into(), object([("id", Value::Id("c1".into())), ("title", Value::String("General".into()))]))];
    for (n, persona) in std::iter::once("alice").chain(personas.iter().map(String::as_str)).enumerate() {
        seed.push(("memberships".into(), object([
            ("id", Value::Id(format!("m{n}"))), ("conversationId", Value::Id("c1".into())), ("principal", Value::Id(format!("dev:{persona}"))),
        ])));
    }
    lock(&host.shared.engine).seed(seed).unwrap();
    let since = lock(&host.shared.engine).seq().unwrap();
    let (waiting, waits) = mpsc::channel();
    *lock(&host.shared.poll_wait) = Some(Arc::new(move || { waiting.send(()).unwrap(); }));
    let (returned, returns) = mpsc::channel();
    let clients: Vec<_> = personas.iter().map(|persona| {
        let (persona, returned, shared) = (persona.clone(), returned.clone(), host.shared.clone());
        thread::spawn(move || {
            poll(&shared, since, &persona, 25);
            let after = lock(&shared.engine).seq().unwrap();
            assert!(after > since, "poll must answer the commit");
            // No test-side reconnect call: only an answer to the held poll
            // permits this client to issue its next authenticated poll.
            poll(&shared, after, &persona, 0);
            returned.send(()).unwrap();
        })
    }).collect();
    for _ in 0..49 { waits.recv_timeout(Duration::from_secs(10)).expect("all clients reached the real Condvar wait"); }
    *lock(&host.shared.poll_wait) = None;
    let sent = if rowless {
        let payload = json!({"id":"nudge", "args":{"targets":personas.iter().map(|p| format!("dev:{p}")).collect::<Vec<_>>()}}).to_string();
        host.request("POST", "/m/nudge", "x-snapback-persona: alice\r\n", &payload)
    } else {
        host.request("POST", "/m/send", "x-snapback-persona: alice\r\n", r#"{"id":"message","args":{"conversationId":"c1","body":"hello"},"newIds":["msg"]}"#)
    };
    assert_eq!(body(&sent)["state"], "sent", "{sent}");
    for _ in 0..49 { returns.recv_timeout(Duration::from_secs(10)).expect("commit's notify_all must wake every recipient"); }
    for client in clients { client.join().unwrap(); }
    let mut engine = lock(&host.shared.engine);
    let effects = engine.effects(None, 100).unwrap();
    assert_eq!(effects.len(), 49);
    assert!(effects.iter().all(|e| e.next_at == Some(e.at + 5_000)));
    let tx = engine.store_mut().read_transaction().unwrap();
    let counts: (i64, i64) = tx.conn().query_row("SELECT count(*), sum(reconnected) FROM _effect_presence", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    tx.rollback().unwrap();
    assert_eq!(counts, (49, 49));
    drop(engine);
    advance_six_seconds(&host);
    let mut engine = lock(&host.shared.engine);
    assert!(engine.claim_effects("worker", None, 100, 60_000, host.shared.now()).unwrap().is_empty());
    let satisfied = engine.effects(Some("satisfied"), 100).unwrap();
    assert_eq!(satisfied.len(), 49);
    assert!(satisfied.iter().all(|e| e.attempts == 0 && e.result.as_ref().unwrap().field("outcome").unwrap().as_str().unwrap() == "presence_reconnected"));
    println!("w15a commit wake: rowless={rowless} members=50 held=49 effects=49 dependencies=49 repolls=49 satisfied=49 attempts=0");
}
