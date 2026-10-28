//! Wake by audience (LLP 3000.041 §4.1): a held poll that declares interest
//! answers only the publications that concern it, is woken for an effect
//! that names it, sees openings the host alarm publishes, and receives a
//! body projected to its interest. A legacy poll keeps today's behavior.
use super::*;
use snapback4_core::{Value, value::object};

const CHAT: &str = include_str!("../../../snapback4-sim/tests/grace_effects/presence_cost.q");

fn chat_host() -> Host {
    let source = CHAT.replace("use personas alice, bob, carol", "use personas alice, bob, carol, dave");
    let source = format!("{source}\nmutation nudge(targets: [principal] <=50):\n  for p in targets:\n    if not exists connected[p]:\n      emit notify {{targetUserId: p}}\n");
    let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(), &source);
    let seed = vec![
        ("conversations".into(), object([("id", Value::Id("c1".into())), ("title", Value::String("General".into()))])),
        ("memberships".into(), object([("id", Value::Id("m1".into())), ("conversationId", Value::Id("c1".into())), ("principal", Value::Id("dev:alice".into()))])),
        ("memberships".into(), object([("id", Value::Id("m2".into())), ("conversationId", Value::Id("c1".into())), ("principal", Value::Id("dev:bob".into()))])),
    ];
    lock(&host.shared.engine).seed(seed).unwrap();
    host
}

/// Hold a change poll over HTTP and hand back its parsed body with how long it was held.
fn hold(host: &Host, persona: &str, since: u64, wait: u64, interest: bool) -> JoinHandle<(Json, Duration)> {
    let address = host.address;
    let persona = persona.to_owned();
    let query = if interest { "&interest=1" } else { "" };
    thread::spawn(move || {
        let started = Instant::now();
        let response = exchange_held(address, Duration::from_secs(wait + 5), format!(
            "GET /changes?since={since}&wait={wait}{query} HTTP/1.1\r\nHost: localhost\r\nx-snapback-persona: {persona}\r\nConnection: close\r\n\r\n"));
        assert_eq!(status(&response), 200, "{response}");
        (body(&response), started.elapsed())
    })
}

fn registered(host: &Host) -> usize { lock(&host.shared.wake).waiters.len() }

#[test]
fn a_private_commit_answers_only_the_polls_it_concerns_and_projects_the_body() {
    let host = chat_host();
    let since = lock(&host.shared.engine).seq().unwrap();
    let bob = hold(&host, "bob", since, 20, true);
    let carol = hold(&host, "carol", since, 3, true);
    wait_until(|| registered(&host) == 2);
    let sent = host.request("POST", "/m/send", "x-snapback-persona: alice\r\n", r#"{"id":"message","args":{"conversationId":"c1","body":"hello"},"newIds":["msg"]}"#);
    assert_eq!(body(&sent)["state"], "sent", "{sent}");
    let (bob_body, bob_held) = bob.join().unwrap();
    assert!(bob_held < Duration::from_secs(3), "a member answers at once, held {bob_held:?}");
    assert!(bob_body["seq"].as_u64().unwrap() > since, "{bob_body}");
    assert_eq!(bob_body["tables"], json!(["messages"]), "{bob_body}");
    assert_eq!(bob_body["partitions"]["messages"]["groups"], json!([["c1"]]), "{bob_body}");
    assert_eq!(bob_body["partitions"]["messages"]["own"], false, "{bob_body}");
    assert_eq!(bob_body["changes"]["others"], false, "no table outside bob's interest changed: {bob_body}");
    assert!(bob_body["interest"].as_array().unwrap().iter().any(|t| t == "messages"), "{bob_body}");
    let (carol_body, carol_held) = carol.join().unwrap();
    assert!(carol_held >= Duration::from_millis(2_500), "a bystander sleeps to its deadline, held {carol_held:?}");
    assert_eq!(carol_body["seq"].as_u64().unwrap(), since, "a bystander learns of no head it cannot read: {carol_body}");
    assert_eq!(carol_body["tables"], json!([]), "{carol_body}");
    assert_eq!(carol_body["partitions"], json!({}), "{carol_body}");
    assert_eq!(carol_body["preservedOthers"], true, "{carol_body}");
    assert_eq!(carol_body["changes"]["others"], false, "{carol_body}");
    assert_eq!(registered(&host), 0, "both polls unregistered on exit");
}

#[test]
fn a_legacy_poll_keeps_the_store_wide_wake_and_the_unprojected_body() {
    let host = chat_host();
    let since = lock(&host.shared.engine).seq().unwrap();
    let carol = hold(&host, "carol", since, 20, false);
    wait_until(|| host.admission.waiters.load(Ordering::Acquire) == 1);
    let sent = host.request("POST", "/m/send", "x-snapback-persona: alice\r\n", r#"{"id":"message","args":{"conversationId":"c1","body":"hello"},"newIds":["msg"]}"#);
    assert_eq!(body(&sent)["state"], "sent", "{sent}");
    let (carol_body, carol_held) = carol.join().unwrap();
    assert!(carol_held < Duration::from_secs(3), "a legacy poll is woken by every commit, held {carol_held:?}");
    assert!(carol_body["seq"].as_u64().unwrap() > since);
    assert_eq!(carol_body["tables"], json!(["messages"]), "the unprojected union: {carol_body}");
    assert!(carol_body.get("interest").is_none() && carol_body.get("partitions").is_none(), "{carol_body}");
}

#[test]
fn a_row_less_effect_wakes_the_principal_it_names() {
    let host = chat_host();
    let since = lock(&host.shared.engine).seq().unwrap();
    let dave = hold(&host, "dave", since, 20, true);
    wait_until(|| registered(&host) == 1);
    let nudged = host.request("POST", "/m/nudge", "x-snapback-persona: alice\r\n", r#"{"id":"nudge","args":{"targets":["dev:dave"]}}"#);
    assert_eq!(body(&nudged)["state"], "sent", "{nudged}");
    let (_, held) = dave.join().unwrap();
    assert!(held < Duration::from_secs(3), "an unconfirmed presence dependency wakes its principal, held {held:?}");
    let mut engine = lock(&host.shared.engine);
    let tx = engine.store_mut().read_transaction().unwrap();
    let pending: i64 = tx.test_support_conn().query_row("SELECT count(*) FROM _effect_presence WHERE principal = 'dev:dave' AND reconnected = 0", [], |r| r.get(0)).unwrap();
    tx.rollback().unwrap();
    assert_eq!(pending, 1, "the dependency awaits dave's next poll entry");
}

#[test]
fn an_opening_is_published_by_the_host_alarm_while_a_poll_is_held() {
    let source = "use personas alice, bob\ntable members:\n  group: text <=8\n  principal: principal\n  opensAt: time\n  unique group, principal\n  cap 1 by group\n  by byOpening: opensAt\n  read <- .principal = viewer\n  not before .opensAt\n  sync\ntable documents:\n  group: text <=8\n  body: text <=4000\n  read <- exists members[.group, viewer]\n  sync\n";
    let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(), source);
    let opening = host.shared.now() + 10_000;
    {
        let mut engine = lock(&host.shared.engine);
        let rows = vec![
            ("documents".into(), snapback4_core::wire::row_from_json(&engine.schema().tables["documents"], &json!({"id":"d1","group":"g","body":"x"})).unwrap()),
            ("members".into(), snapback4_core::wire::row_from_json(&engine.schema().tables["members"], &json!({"id":"m","group":"g","principal":"dev:bob","opensAt":opening})).unwrap()),
        ];
        engine.load(rows).unwrap();
    }
    let since = lock(&host.shared.engine).seq().unwrap();
    let bob = hold(&host, "bob", since, 20, true);
    wait_until(|| registered(&host) == 1);
    // No request touches the opening: the clock jump re-arms the host alarm,
    // which publishes the due row and wakes the poll it belongs to.
    let advanced = host.request("POST", "/dev/clock/advance", "", r#"{"duration":"11s"}"#);
    assert_eq!(status(&advanced), 200, "{advanced}");
    let (bob_body, held) = bob.join().unwrap();
    assert!(held < Duration::from_secs(5), "the alarm publishes the opening, held {held:?}");
    assert!(bob_body["seq"].as_u64().unwrap() > since, "{bob_body}");
    assert!(bob_body["tables"].as_array().unwrap().iter().any(|t| t == "members"), "{bob_body}");
    assert_eq!(bob_body["partitions"]["members"]["own"], true, "the opened membership is on bob's own partition: {bob_body}");
}
