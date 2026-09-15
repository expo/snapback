//! The absence proof must cover the image and every population the insert tests.
use super::{LIKES, observation};
use super::super::common::*;
use serde_json::{Value as Json, json};
use snapback4_core::{Context, Engine, Value, WriteState, wire};
use snapback4_device::device::Queued;

fn queued(op: &str, seq: u64) -> Queued {
    Queued { id: op.into(), seq, op: op.into(), args: json!({"postId":"first"}), viewer: "bob".into(), now: 1000,
        new_ids: vec![format!("new-{seq}")], predicted: vec![], predictable: true, sent_seq: None, observed_seq: None }
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
        .replace("  upsert likes[postId, viewer] { on: true }", if guard {
            "  r = upsert likes[postId, viewer] { principal: 'alice', on: true }\n  require r = null else WRONG\n  return r"
        } else { "  upsert likes[postId, viewer] { principal: 'alice', on: true }" }) + "\ntable ballast:\n  marker: bool\n  online only\n";
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
        let source = format!("{}\nmutation clear(postId: text <=30):\n  delete likes[postId, viewer]\n", LIKES.replace("  update <-", "  delete <- .principal = viewer\n  update <-"));
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
