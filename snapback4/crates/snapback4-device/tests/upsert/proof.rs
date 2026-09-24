//! The absence proof must cover the image and every population the insert tests.
use super::{LIKES, observation};
use super::super::common::*;
use serde_json::{Value as Json, json};
use snapback4_core::{Context, Engine, Value, WriteState, wire};
use snapback4_device::device::Queued;

fn ascending_horizon_advice<H: Host>(host: &mut H) {
    const SOURCE: &str = include_str!("../../../snapback4-lang/tests/fixtures/horizon-pages.q");
    let bound = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let advice = &bound.notes.iter().find(|n| n.code == "N_NO_HORIZON" && n.message.starts_with("table archive:")).unwrap().rewrite;
    for (mode, sync, predicts) in [("unbounded", "sync public", true), ("horizon", "sync public last 500 by byTime", false),
        ("advice", if advice.starts_with("sync ") { advice.as_str() } else { "sync public" }, true)] {
        let (mut server, backend) = compile(&SOURCE.replacen("sync public", sync, 1));
        for n in 0..25 { seed(&mut server, "archive", json!({"id":format!("a{n:02}"), "at":n})); }
        let mut device = host.open(mode, Some(backend)).unwrap();
        for (i, page) in snapshot_pages(&mut server, "bob", 100).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
        let acquired = device.query("archives", "bob", &json!({}), 1000).unwrap().data.as_array().unwrap().len();
        assert_eq!(acquired, 25, "every existing row was acquired, even under last 500");
        let new_ids: Vec<_> = (0..20).map(|n| format!("copy{n:02}")).collect();
        let entry = Queued { id: "copy-write".into(), seq: 1, op: "copyArchive".into(), args: json!({}), viewer: "bob".into(), now: 1000,
            new_ids: new_ids.clone(), predicted: vec![], predictable: true, sent_seq: None, receipt_store: None, observed_seq: None };
        let admitted = device.admit(entry).unwrap();
        let pending = device.query("copied", "bob", &json!({}), 1000).unwrap().data;
        let pending = pending.as_array().unwrap();
        assert!(pending.iter().all(|row| row.field("pending") == Ok(&Value::Bool(true))));
        println!("{} {mode}: acquired={acquired} predicted_copies={} predictable={}", host.label(), pending.len(), admitted.predictable);
        assert_eq!(pending.len(), if predicts { 20 } else { 0 });
        assert_eq!(admitted.predictable, predicts);
        let from = server.seq().unwrap();
        let result = server.mutate("copyArchive", Some("copy-write"), Context::new("bob", Default::default()).at(1000).with_ids(new_ids)).unwrap();
        assert!(matches!(result.state, WriteState::Sent { .. }), "{result:?}");
        device.settle("copy-write", Some(server.seq().unwrap())).unwrap();
        device.apply(&stream_page(&mut server, "bob", from), false).unwrap();
        let confirmed = device.query("copied", "bob", &json!({}), 1000).unwrap().data;
        let confirmed = confirmed.as_array().unwrap();
        assert_eq!(confirmed.len(), 20);
        for (n, row) in confirmed.iter().enumerate() {
            assert_eq!(row.field("at"), Ok(&Value::Int(n as i64)));
            assert_ne!(row.field("pending"), Ok(&Value::Bool(true)));
        }
        println!("{} {mode}: confirmed_copies={}", host.label(), confirmed.len());
        host.close(mode, device);
    }
}

#[test]
fn w6r2_ascending_horizon_advice_sqlite() { ascending_horizon_advice(&mut Sqlite::new("ascending-horizon")); }
#[test]
fn w6r2_ascending_horizon_advice_memory() { ascending_horizon_advice(&mut Memory::new()); }

#[test]
fn horizon_guard_rewrite_restores_the_pending_message_on_both_stores() {
    const SOURCE: &str = include_str!("../../../snapback4-lang/tests/fixtures/prediction-horizons.q");
    fn run<H: Host>(host: &mut H) {
        for guarded in [true, false] {
            let source = if guarded { SOURCE.to_owned() } else { SOURCE.replace("  require not exists messages[messageId] else DUPLICATE\n", "") };
            let source = format!("{source}\nquery one(messageId: messages):\n  return messages[messageId]\n");
            let (mut server, backend) = compile(&source);
            seed(&mut server, "members", json!({"id":"member", "conversationId":"room", "principal":"bob"}));
            let name = if guarded { "guarded" } else { "rewritten" };
            let mut device = host.open(name, Some(backend)).unwrap();
            for (i, page) in snapshot_pages(&mut server, "bob", 100).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
            let input = json!({"messageId":"message", "conversationId":"room", "body":"hello"});
            let entry = Queued { id: "write".into(), seq: 1, op: "send".into(), args: input.clone(), viewer: "bob".into(), now: 1000,
                new_ids: vec![], predicted: vec![], predictable: true, sent_seq: None, receipt_store: None, observed_seq: None };
            let queued = device.admit(entry).unwrap();
            assert_eq!(queued.predictable, !guarded, "{} {name}: {queued:?}", host.label());
            let pending = device.query("one", "bob", &json!({"messageId":"message"}), 1000).unwrap().data;
            assert_eq!(pending != Value::Null, !guarded);
            if !guarded { assert_eq!(pending.field("pending"), Ok(&Value::Bool(true))); }
            let context = Context::new("bob", args(&[("messageId", id("message")), ("conversationId", id("room")), ("body", Value::String("hello".into()))])).at(1000);
            for _ in 0..2 { assert!(matches!(server.mutate("send", Some("write"), context.clone()).unwrap().state, WriteState::Sent { .. })); }
            assert_eq!(server.store().rows("messages").unwrap().len(), 1, "the write id dedupes the retry");
            println!("{} {name}: predicted_messages={} authoritative_messages=1 attempts=2", host.label(), usize::from(pending != Value::Null));
            host.close(name, device);
        }
    }
    run(&mut Sqlite::new("horizon-guard"));
    run(&mut Memory::new());
}

fn queued(op: &str, seq: u64) -> Queued {
    Queued { id: op.into(), seq, op: op.into(), args: json!({"postId":"first"}), viewer: "bob".into(), now: 1000,
        new_ids: vec![format!("new-{seq}")], predicted: vec![], predictable: true, sent_seq: None, receipt_store: None, observed_seq: None }
}
fn seed(server: &mut Engine, table: &str, image: Json) {
    let row = wire::row_from_json(&server.schema().tables[table], &image).unwrap();
    server.seed([(table.into(), row)]).unwrap();
}
fn sent(server: &mut Engine, op: &str, seq: u64) -> snapback4_core::MutationOutcome {
    server.mutate(op, Some(op), Context::new("bob", args(&[("postId", Value::String("first".into()))])).at(1000).with_ids([format!("new-{seq}")])).unwrap()
}
fn no_prediction(observed: &observation::Observation) {
    for device in &observed.devices {
        assert_eq!(device["admission"]["queued"]["predictable"], false, "{}", device["admission"]);
        assert_eq!(device["admission"]["queued"]["predicted"], json!([]));
        assert_eq!(device["pending"]["rows"], device["initial"]["rows"], "no speculative image, including a changed audience");
        for stage in ["initial", "pending", "reopened"] {
            assert_eq!(device[stage]["query"]["data"], Json::Null);
            assert!(device[stage]["query"]["metered"].is_object(), "complete query envelope");
        }
    }
}

fn changed_audience(guard: bool) {
    let source = LIKES.replace("insert <- .principal = viewer", "insert <- allow")
        .replace("  upsert likes[postId = postId, principal = viewer] { on: true }", if guard {
            "  r = upsert likes[postId = postId, principal = viewer] { principal: 'alice', on: true }\n  require r = null else WRONG\n  return r"
        } else { "  upsert likes[postId = postId, principal = viewer] { principal: 'alice', on: true }" }) + "\ntable ballast:\n  marker: bool\n  online only\n";
    let mut worlds = Vec::new();
    for hidden in [false, true] {
        let (mut server, _) = compile(&source);
        let mut rows = vec![("ballast".into(), wire::row_from_json(&server.schema().tables["ballast"], &json!({"id":"ballast","marker":true})).unwrap())];
        if hidden { rows.push(("likes".into(), wire::row_from_json(&server.schema().tables["likes"], &json!({"id":"hidden","postId":"other","principal":"carol","on":false})).unwrap())); }
        server.seed(rows).unwrap();
        let (result, observed) = observation::observe(&mut server, "vote", "bob", json!({"postId":"first"}), "vote", ("one", json!({"postId":"first"})));
        assert!(matches!(result.state, WriteState::Sent { result: Value::Null, .. }), "{result:?}");
        worlds.push(observed);
    }
    worlds[0].assert_same(&worlds[1]);
    for world in &worlds { no_prediction(world); }
}
#[test]
fn changed_audience_image_queues_on_both_stores() { changed_audience(false); }
#[test]
fn changed_audience_program_result_queues_on_both_stores() { changed_audience(true); }

fn hidden_constraint(extra: &str, defaulted: bool, failure: &str) {
    let mut source = LIKES.replace("  on: bool", &format!("  alias: text <=30 default 'taken'\n  on: bool default true\n{extra}"));
    source = source.replace("{ on: true }", if defaulted { "{}" } else { "{ alias: 'taken', on: true }" });
    let mut worlds = Vec::new();
    // Absent, hidden noncolliding, hidden colliding: identical viewer holdings and input.
    for population in ["absent", "noncolliding", "colliding"] {
        let (mut server, _) = compile(&source);
        if population != "absent" {
            seed(&mut server, "likes", json!({"id":"hidden","postId":if population == "colliding" {"first"} else {"other"},
                "principal":"alice","alias":if population == "colliding" {"taken"} else {"free"},"on":false}));
        } else { server.seed([]).unwrap(); }
        let (result, observed) = observation::observe(&mut server, "vote", "bob", json!({"postId":"first"}), "vote", ("one", json!({"postId":"first"})));
        let refuses = population == "colliding" || (extra.contains("cap 1\n") && population == "noncolliding");
        if refuses { assert!(matches!(&result.state, WriteState::Failed { why, .. } if why.code == failure), "{population}: {result:?}"); }
        else { assert!(matches!(result.state, WriteState::Sent { .. }), "{population}: {result:?}"); }
        worlds.push(observed);
    }
    // Server constraint outcomes intentionally differ. Every complete pre-settlement
    // device observable must agree; retain and validate the full server observations.
    for world in &worlds[1..] {
        for (left, right) in worlds[0].devices.iter().zip(&world.devices) {
            for stage in ["initial", "admission", "pending", "reopened"] { assert_eq!(left[stage], right[stage], "{stage}"); }
        }
    }
    for world in &worlds { no_prediction(world); }
}
#[test]
fn hidden_secondary_unique_collision_queues_on_both_stores() {
    hidden_constraint("  unique byAlias: alias", false, "E_RULE");
}
#[test]
fn hidden_group_cap_occupancy_queues_on_both_stores() {
    hidden_constraint("  cap 1 by postId", false, "E_CONSTRAINT");
}
#[test]
fn hidden_whole_table_cap_occupancy_queues_on_both_stores() {
    hidden_constraint("  cap 1\n", false, "E_CONSTRAINT");
}
#[test]
fn defaulted_hidden_unique_collision_queues_on_both_stores() {
    hidden_constraint("  unique byAlias: alias", true, "E_RULE");
}

fn covered<H: Host>(host: &mut H) {
    for (case, extra) in [("unique", "  alias: text <=30 default 'taken'\n  unique byOwnerAlias: principal, alias"),
        ("cap", "  cap 1 by principal"), ("public-cap", "  cap 1")] {
        let mut source = LIKES.replace("  on: bool", &format!("  on: bool default true\n  at: time default now\n{extra}"))
            .replace("{ on: true }", "{}");
        if case == "public-cap" { source = source.replace("read <- .principal = viewer", "read <- public"); }
        let (mut server, backend) = compile(&source);
        let mut device = host.open(case, Some(backend)).unwrap();
        for (i, page) in snapshot_pages(&mut server, "bob", 100).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
        let entry = device.admit(queued("vote", 1)).unwrap();
        assert!(entry.predictable, "{case}: {entry:?}");
        assert_eq!(entry.predicted.len(), 1);
        let pending = device.query("one", "bob", &entry.args, 1000).unwrap().data;
        assert_eq!(pending.field("on"), Ok(&Value::Bool(true)));
        assert_eq!(pending.field("at"), Ok(&Value::Int(1000)));
        let result = sent(&mut server, "vote", 1);
        let WriteState::Sent { seq, result } = result.state else { panic!("{result:?}") };
        let mut image = pending.as_object().unwrap().clone(); image.remove("pending");
        assert_eq!(Value::Row(image.into()), result);
        device.settle("vote", Some(seq)).unwrap();
        device.apply(&stream_page(&mut server, "bob", device.state().unwrap().0), false).unwrap();
        assert_eq!(device.query("one", "bob", &entry.args, 1000).unwrap().data, result);
        host.close(case, device);
    }
}
#[test]
fn covered_constraints_and_insert_defaults_predict_on_both_stores() {
    covered(&mut Sqlite::new("covered-insert")); covered(&mut Memory::new());
}

#[test]
fn defaulted_insert_rule_refusal_matches_server_on_both_stores() {
    fn run<H: Host>(host: &mut H) {
        let source = LIKES.replace("on: bool", "on: bool default false").replace("insert <- .principal = viewer", "insert <- .principal = viewer and .on = true").replace("{ on: true }", "{}");
        let (mut server, backend) = compile(&source);
        let mut device = host.open("refused", Some(backend)).unwrap();
        for (i, page) in snapshot_pages(&mut server, "bob", 100).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
        let error = device.admit(queued("vote", 1)).unwrap_err().refusal();
        let result = sent(&mut server, "vote", 1);
        assert_eq!(error.code, "NOT_FOUND");
        assert!(matches!(result.state, WriteState::Failed { why, .. } if why.code == error.code));
        assert!(device.queued().unwrap().is_empty());
        assert_eq!(device.query("one", "bob", &json!({"postId":"first"}), 1000).unwrap().data, Value::Null);
        host.close("refused", device);
    }
    run(&mut Sqlite::new("default-refusal")); run(&mut Memory::new());
}

#[test]
fn pending_delete_then_upsert_replays_in_order_on_both_stores() {
    fn run<H: Host>(host: &mut H) {
        let source = format!("{}\nmutation clear(postId: text <=30):\n  delete likes[postId = postId, principal = viewer]\n", LIKES.replace("  update <-", "  delete <- .principal = viewer\n  update <-"));
        let (mut server, backend) = compile(&source);
        seed(&mut server, "likes", json!({"id":"old","postId":"first","principal":"bob","on":false}));
        let mut device = host.open("ordered", Some(backend)).unwrap();
        for (i, page) in snapshot_pages(&mut server, "bob", 100).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
        assert!(device.admit(queued("clear", 1)).unwrap().predictable);
        assert_eq!(device.query("one", "bob", &json!({"postId":"first"}), 1000).unwrap().data, Value::Null);
        let entry = device.admit(queued("vote", 2)).unwrap();
        assert!(entry.predictable);
        let pending = device.query("one", "bob", &entry.args, 1000).unwrap();
        assert_eq!(pending.data.field("id"), Ok(&id("new-2")));
        host.close("ordered", device);
        let mut device = host.open("ordered", None).unwrap();
        assert_eq!(device.query("one", "bob", &entry.args, 1000).unwrap(), pending);
        for (op, n) in [("clear", 1), ("vote", 2)] {
            let result = sent(&mut server, op, n);
            let WriteState::Sent { seq, .. } = result.state else { panic!("{result:?}") };
            device.settle(op, Some(seq)).unwrap();
            device.apply(&stream_page(&mut server, "bob", device.state().unwrap().0), false).unwrap();
        }
        assert!(device.queued().unwrap().is_empty());
        assert_eq!(device.query("one", "bob", &entry.args, 1000).unwrap().data, server.store().rows("likes").unwrap()[0]);
        host.close("ordered", device);
    }
    run(&mut Sqlite::new("delete-upsert")); run(&mut Memory::new());
}

const MEMBERS: &str = r#"
table members:
  room: text <=30
  principal: principal
  on: bool default true
  unique byRoomPrincipal: room, principal
  by byPrincipalRoom: principal, room, id
  immutable room, principal
  read <- exists members[.room, viewer]
  update <- allow
  delete <- .principal = viewer
  sync
  retain delivered-history
mutation vote(postId: text <=30):
  upsert members[postId, viewer] {on: true}
mutation leave(postId: text <=30):
  delete members[postId, viewer]
query one(postId: text <=30):
  return members[postId, viewer]
query roster(postId: text <=30):
  return members[postId] first 10 by byRoomPrincipal
"#;
fn left_group<H: Host>(host: &mut H, replay: bool) {
    let (mut server, backend) = compile(MEMBERS);
    seed(&mut server, "members", json!({"id":"member","room":"first","principal":"bob","on":false}));
    let mut device = host.open("left", Some(backend)).unwrap();
    for (i, page) in snapshot_pages(&mut server, "bob", 100).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
    if replay { assert!(device.admit(queued("vote", 1)).unwrap().predictable); }
    assert!(matches!(sent(&mut server, "leave", 2).state, WriteState::Sent { .. }));
    device.sync_state().unwrap();
    let mut page = stream_page(&mut server, "bob", device.state().unwrap().0);
    assert!(page.events.iter().any(|event| event.kind == "scope"));
    // Exercise the absent left-group boundary explicitly: the server confirmed
    // this deletion. A scope alone may retain the membership's delivered image.
    page.events.insert(0, snapback4_device::device::StreamEvent { table: "members".into(), kind: "del".into(), id: "member".into(), data: None });
    device.apply(&page, false).unwrap();
    let (_, _, retained) = device.query_with_coverage("roster", "bob", &json!({"postId":"first"}), 1000);
    assert!(retained, "the read adapter proves this is a left group");
    assert_eq!(device.query("one", "bob", &json!({"postId":"first"}), 1000).unwrap().data, Value::Null);
    let entry = if replay { device.queued().unwrap().remove(0) } else { device.admit(queued("vote", 1)).expect("a left target queues instead of predicting NOT_FOUND") };
    assert!(!entry.predictable, "{entry:?}");
    assert!(entry.predicted.is_empty());
    host.close("left", device);
    let mut device = host.open("left", None).unwrap();
    assert_eq!(device.queued().unwrap(), vec![entry]);
    assert_eq!(device.query("one", "bob", &json!({"postId":"first"}), 1000).unwrap().data, Value::Null);
    assert!(matches!(sent(&mut server, "vote", 1).state, WriteState::Failed { why, .. } if why.code == "NOT_FOUND"));
    device.settle("vote", None).unwrap();
    assert!(device.queued().unwrap().is_empty());
    host.close("left", device);
}
#[test]
fn left_self_witness_admission_sqlite() { left_group(&mut Sqlite::new("left-admit"), false); }
#[test]
fn left_self_witness_admission_memory() { left_group(&mut Memory::new(), false); }
#[test]
fn left_self_witness_replay_sqlite() { left_group(&mut Sqlite::new("left-replay"), true); }
#[test]
fn left_self_witness_replay_memory() { left_group(&mut Memory::new(), true); }
