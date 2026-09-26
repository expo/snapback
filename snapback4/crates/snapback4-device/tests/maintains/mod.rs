//! Computed aggregate prediction and read ordering through both device stores.
use super::common::*;
use serde_json::json;
use snapback4_core::{Context, Value, WriteState};
use snapback4_device::device::Queued;

const SOURCE: &str = r#"
table posts:
  author: principal
  selected: bool
  at: time
  by byAuthor: author, at, id
  read <- .author = viewer
  insert <- .author = viewer
  update <- .author = viewer
  delete <- .author = viewer
  sync
maintain days: count posts where .selected by author, day(.at)
  read <- .author = viewer
maintain ranked: count posts where .selected by author, hour(.at)
  read <- .author = viewer
  by byCount: author, value, id
maintain serverTotals: count posts where .selected by author
  read <- .author = viewer
  online only
mutation add(selected: bool, at: time):
  insert posts {author: viewer, selected, at}
query daily(at: time):
  return days[viewer, day(at)]
query ranks(c: cursor ?):
  return ranked[viewer] after c last 10 by byCount
query calendar(at: time):
  return {day: day(at), hour: hour(at), bucket: bucket(at, 2m)}
"#;

#[test]
fn maintains_predict_new_groups_and_omit_online_side_effects_on_both_stores() {
    fn run<H: Host>(host: &mut H) {
        for horizon in [false, true] {
            let text = if horizon { SOURCE.replace("  sync\n", "  sync last 1 by byAuthor\n") } else { SOURCE.into() };
            let (mut server, backend) = compile(&text);
            let name = if horizon { "horizon" } else { "whole" };
            let mut device = host.open(name, Some(backend)).unwrap();
            for (i, page) in snapshot_pages(&mut server, "bob", 100).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
            for at in [-9_007_199_254_740_991_i64, -86_400_001, -1, 0, 1, 86_400_000, 1_709_164_800_000, 1_710_057_600_000, 9_007_199_254_740_991] {
                let actual = device.query("calendar", "bob", &json!({"at":at}), 0).unwrap().data;
                assert_eq!(snapback4_core::wire::to_json(&actual), json!({"day":at.div_euclid(86_400_000), "hour":at.div_euclid(3_600_000), "bucket":at.div_euclid(120_000)}));
            }
            let input = json!({"selected":true, "at":-1});
            let queued = device.admit(Queued { id:"a".into(), seq:1, op:"add".into(), args:input.clone(), viewer:"bob".into(), now:1, new_ids:vec!["p".into()], predicted:vec![], predictable:true, sent_seq: None, receipt_store: None, observed_seq:None, dispatch: None }).unwrap();
            assert!(queued.predictable, "{queued:?}");
            assert_eq!(device.query("daily", "bob", &json!({"at":-1}), 1).unwrap().data, Value::Int(1));
            assert!(!queued.predicted.iter().any(|s| s.starts_with("serverTotals/")));
            let out = server.mutate("add", Some("a"), Context::new("bob", args(&[("selected", Value::Bool(true)), ("at", Value::Int(-1))])).at(1).with_ids(["p".into()])).unwrap();
            assert!(matches!(out.state, WriteState::Sent { .. }));
            host.close(name, device);
        }
    }
    run(&mut Sqlite::new("maintain-calendar")); run(&mut Memory::new());
}

#[test]
fn maintains_queue_unknown_bases_and_unheld_source_images_on_both_stores() {
    let text = SOURCE.replace("  update <- .author = viewer", "  update (old, next) <- old.author = viewer")
        + "\nmutation transfer(row: posts):\n  update posts[row] {author: 'alice'}\nmutation patch(row: posts):\n  update posts[row] {selected: false}\n";
    fn run<H: Host>(host: &mut H, text: &str) {
        let (mut server, backend) = compile(text);
        server.mutate("add", None, Context::new("bob", args(&[("selected",Value::Bool(true)),("at",Value::Int(0))])).at(1).with_ids(["held".into()])).unwrap();
        let mut device = host.open("unknown", Some(backend)).unwrap();
        for (i, page) in snapshot_pages(&mut server, "bob", 100).iter().enumerate() { device.apply(page,i==0).unwrap(); }
        for (n, op, row) in [(1,"transfer","held"),(2,"patch","missing")] {
            let entry = device.admit(Queued { id:format!("q{n}"), seq:n, op:op.into(), args:json!({"row":row}), viewer:"bob".into(), now:2, new_ids:vec![], predicted:vec![], predictable:true, sent_seq: None, receipt_store: None, observed_seq:None, dispatch: None }).unwrap();
            assert!(!entry.predictable, "{entry:?}"); assert!(entry.predicted.is_empty());
            assert_eq!(device.query("daily","bob",&json!({"at":0}),2).unwrap().data,Value::Int(1));
        }
        host.close("unknown",device);
    }
    run(&mut Sqlite::new("maintain-unknown"), &text); run(&mut Memory::new(), &text);
}

#[test]
fn retains_source_history_but_revokes_aggregate_and_replacement_snapshot_on_both_stores() {
    let text = r#"
table members:
  room: text <=30
  principal: principal
  unique byMember: room, principal
  by byPrincipal: principal, room
  read <- exists members[.room, viewer]
  delete <- exists members[.room, viewer]
  sync
table posts:
  room: text <=30
  at: time
  selected: bool
  by byRoom: room, at, id
  read <- exists members[.room, viewer]
  retain delivered-history
  sync last 1 by byRoom
maintain counts: count posts where .selected by room, day(.at)
  read <- exists members[.room, viewer]
query history(room: text <=30, c: cursor ?):
  return posts[room] after c first 10 by byRoom
query countsFor(room: text <=30, c: cursor ?):
  return counts[room] after c first 10 by byGroup
mutation leave(room: text <=30):
  delete members[room, viewer]
"#;
    fn run<H: Host>(host: &mut H, text: &str) {
        let (mut server, backend) = compile(text);
        server.seed([("members".into(),snapback4_core::value::object([("id",id("m")),("room",Value::String("room".into())),("principal",id("bob"))])),
            ("posts".into(),snapback4_core::value::object([("id",id("p")),("room",Value::String("room".into())),("at",Value::Int(-1)),("selected",Value::Bool(true))]))]).unwrap();
        assert_eq!(server.schema().tables["counts"].leave,snapback4_core::schema::LeavePolicy::UntilRevoked);
        let mut device = host.open("leave",Some(backend)).unwrap();
        for (i,page) in snapshot_pages(&mut server,"bob",100).iter().enumerate() { device.apply(page,i==0).unwrap(); }
        let input=json!({"room":"room","c":null});
        assert_eq!(device.query("countsFor","bob",&input,1).unwrap().data.as_array().unwrap().len(),1);
        let from=server.seq().unwrap();
        server.mutate("leave",None,Context::new("bob",args(&[("room",Value::String("room".into()))]))).unwrap();
        let page = stream_page(&mut server, "bob", from);
        device.apply(&page,false).unwrap();
        for replacement in [false,true] {
            if replacement { for (i,page) in snapshot_pages(&mut server,"bob",100).iter().enumerate() { device.apply(page,i==0).unwrap(); } }
            assert!(device.query("countsFor","bob",&input,1).unwrap().data.as_array().unwrap().is_empty());
            assert_eq!(device.query("history","bob",&input,1).unwrap().data.as_array().unwrap().len(),1);
        }
        host.close("leave",device);
    }
    run(&mut Sqlite::new("maintain-leave"),text); run(&mut Memory::new(),text);
}

mod review;

#[test]
fn w6r1_rule_live_aggregate_prediction_on_both_stores() {
    fn run<H: Host>(host: &mut H) {
        let source = include_str!("../../../snapback4-lang/tests/fixtures/rule-live-horizon.q");
        for horizon in [false, true] {
            let source = if horizon { source.replacen("sync public", "sync public last 1 by byExpiry", 1) } else { source.into() };
            let bound = snapback4_lang::compile(&[("schema.q".into(), source.clone())]);
            assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
            assert!(bound.schema.operations["act"].sites.iter().any(|s| s.table == "sessions" && s.kind == "aggregate source"));
            let (mut server, backend) = compile(&source);
            server.seed([("sessions".into(), snapback4_core::value::object([("id", Value::Id("s".into())), ("owner", Value::Id("bob".into())), ("expiresAt", Value::Int(1000))]))]).unwrap();
            let name = if horizon { "rule-live-horizon" } else { "rule-live-whole" };
            let mut device = host.open(name, Some(backend)).unwrap();
            for (i, page) in crate::snapshot_pages_at(&mut server, "bob", 100, 100).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
            let before = server.seq().unwrap();
            let queued = device.admit(Queued { id:"act-write".into(), seq:1, op:"act".into(), args:json!({}), viewer:"bob".into(), now:100, new_ids:vec!["action".into()], predicted:vec![], predictable:true, sent_seq: None, receipt_store: None, observed_seq:None, dispatch: None }).unwrap();
            assert_eq!(queued.predictable, !horizon, "{queued:?}");
            assert_eq!(queued.predicted.is_empty(), horizon);
            let out = server.mutate("act", Some("act-write"), Context::new("bob", Default::default()).at(100).with_ids(["action".into()])).unwrap();
            assert!(matches!(out.state, WriteState::Sent { .. }));
            device.apply(&stream_page(&mut server, "bob", before), false).unwrap();
            // An unswept aggregate row cannot authorize a write after its only source expires.
            let expired = server.mutate("act", Some("expired"), Context::new("bob", Default::default()).at(1000).with_ids(["late".into()])).unwrap();
            assert!(matches!(expired.state, WriteState::Failed { .. }));
            println!("W6R1 host={} live rule horizon={horizon} source_rows=1 predicted={} confirmed=1 expired_refused=1", host.label(), !horizon);
            host.close(name, device);
        }
    }
    run(&mut Sqlite::new("w6r1-live")); run(&mut Memory::new());
}

mod columns;
