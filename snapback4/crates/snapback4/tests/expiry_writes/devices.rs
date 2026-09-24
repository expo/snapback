use super::*;
#[path = "../../../snapback4-device/tests/common/mod.rs"]
mod common;
use common::{Host, Memory, Sqlite};

use snapback4_device::device::Queued;

fn queued(op: &str, write_id: &str, args: serde_json::Value, now: i64) -> Queued {
    Queued { id: write_id.into(), seq: 0, op: op.into(), args, new_ids: vec!["new".into()],
        predicted: vec![], viewer: "alice".into(), now, predictable: true,
        sent_seq: None, receipt_store: None, observed_seq: None }
}

fn agree<H: Host>(host: &mut H, cold: bool) {
    for cap in ["  cap 1", "  cap 1 by conversationId"] {
        for op in ["add", "quiet", "put", "putId"] {
            let source = constraints::source(cap);
            let (mut server, backend) = common::compile(&source);
            let deadline = snapback4_core::now_ms() + if cold { -60_000 } else { 60_000 };
            let old = constraints::row(&server, "old", 1, 1, json!(deadline));
            server.load([old]).unwrap();
            let name = format!("expiry-{op}-{cold}-{}", cap.len());
            let mut device = host.open(&name, Some(backend)).unwrap();
            for (i, page) in common::snapshot_pages(&mut server, "alice", 100).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
            let now = deadline + 120_000;
            let read_args = json!({"conversationId":"chat", "ordinal":1});
            assert_eq!(device.query("message", "alice", &read_args, now).unwrap().data, Value::Null);
            for ordinal in [1, 2] {
                let args = json!({"messageId":"new", "ordinal":ordinal, "at":20, "expiresAt":null});
                let write_id = format!("refused-{ordinal}");
                let entry = device.admit(queued(op, &write_id, args, now)).unwrap();
                assert!(!entry.predictable && entry.predicted.is_empty(), "{} cold={cold}: {entry:?}", host.label());
                assert_eq!(device.query("message", "alice", &json!({"conversationId":"chat", "ordinal":ordinal}), now).unwrap().data, Value::Null);
                host.close(&name, device);
                device = host.open(&name, None).unwrap();
                assert_eq!(device.queued().unwrap(), vec![entry]);
                let outcome = server.mutate(op, Some(&write_id), Context::new("alice", constraints::args("new", ordinal, 20)).at(now).with_ids(["new".into()])).unwrap();
                assert!(matches!(outcome.state, WriteState::Failed { ref why, .. } if why.code == "E_CONSTRAINT"), "{outcome:?}");
                device.settle(&write_id, None).unwrap();
                assert!(device.queued().unwrap().is_empty());
            }
            let from = device.state().unwrap().0;
            assert_eq!(server.sweep_expired(now, 2_000).unwrap(), 1);
            device.apply(&common::stream_page(&mut server, "alice", from), false).unwrap();
            let args = json!({"messageId":"new", "ordinal":1, "at":20, "expiresAt":null});
            let entry = device.admit(queued(op, "accepted", args, now)).unwrap();
            assert!(!entry.predictable && entry.predicted.is_empty(), "even a new live snapshot cannot prove physical occupancy");
            let out = server.mutate(op, Some("accepted"), Context::new("alice", constraints::args("new", 1, 20)).at(now).with_ids(["new".into()])).unwrap();
            let WriteState::Sent { seq, .. } = out.state else { panic!("{out:?}") };
            device.settle("accepted", Some(seq)).unwrap();
            let from = device.state().unwrap().0;
            device.apply(&common::stream_page(&mut server, "alice", from), false).unwrap();
            assert_eq!(device.query("message", "alice", &read_args, now).unwrap().data.field("at"), Ok(&Value::Int(20)));
            host.close(&name, device);
        }
    }
}

#[test]
fn expiring_cap_writes_queue_and_settle_on_both_devices_with_warm_and_post_expiry_snapshots() {
    for cold in [false, true] {
        agree(&mut Sqlite::new("expiry"), cold);
        agree(&mut Memory::new(), cold);
    }
}

fn large<H: Host>(host: &mut H, backlog: usize) {
    let source = format!("{SOURCE}\nquery conversation():\n  return conversations['chat']\n");
    let (mut server, backend) = common::compile(&source);
    let deadline = snapback4_core::now_ms() + 60_000;
    let mut rows = vec![("conversations".into(), wire::row_from_json(&server.schema().tables["conversations"],
        &json!({"id":"chat","lastOrdinal":9000})).unwrap())];
    rows.extend((0..9_000).map(|n| constraints::row(&server, &format!("live{n:05}"), n + 1, 0, json!(null))));
    rows.extend((0..backlog).map(|n| constraints::row(&server, &format!("expired{n:05}"), -(n as i64) - 1, 0, json!(deadline))));
    server.load(rows).unwrap();
    let name = format!("large-{backlog}");
    let mut device = host.open(&name, Some(backend)).unwrap();
    for (i, page) in common::snapshot_pages(&mut server, "alice", 1_000).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
    let now = deadline + 1;
    let args = json!({"messageId":"next","conversationId":"chat"});
    let entry = device.admit(queued("sendMessage", "send", args, now)).unwrap();
    assert!(!entry.predictable && entry.predicted.is_empty());
    assert_eq!(device.query("message", "alice", &json!({"conversationId":"chat","ordinal":9001}), now).unwrap().data, Value::Null);
    assert_eq!(device.query("conversation", "alice", &json!({}), now).unwrap().data.field("lastOrdinal"), Ok(&Value::Int(9_000)), "deferral rolls back the entire mutation");
    let out = server.mutate("sendMessage", None, Context::new("alice", BTreeMap::from([
        ("messageId".into(), Value::Id("next".into())), ("conversationId".into(), Value::Id("chat".into()))])).at(now)).unwrap();
    assert!(matches!(out.state, WriteState::Sent { .. }), "{out:?}");
    assert_eq!(out.metered.examined, 1);
    host.close(&name, device);
}

#[test]
fn devices_queue_keyed_writes_at_nine_thousand_live_rows_with_both_backlogs() {
    for backlog in [0, 3_000] {
        large(&mut Sqlite::new("expiry-large"), backlog);
        large(&mut Memory::new(), backlog);
    }
}

fn neutral<H: Host>(host: &mut H) {
    let source = format!("{}\n{}", constraints::source("  cap 1 by conversationId"), r#"
mutation patch():
  update messages['old'] { at: 20 }
mutation erase():
  delete messages['old']
mutation eraseKey():
  delete messages[conversationId = 'chat', ordinal = 1]
mutation move():
  update messages['old'] { conversationId: 'other' }
"#);
    for op in ["patch", "erase", "eraseKey", "putId", "add", "move"] {
        let (mut server, backend) = common::compile(&source);
        let deadline = snapback4_core::now_ms() + 60_000;
        let old = constraints::row(&server, "old", 1, 1, json!(deadline));
        server.load([old]).unwrap();
        let name = format!("neutral-{op}");
        let mut device = host.open(&name, Some(backend)).unwrap();
        for (i, page) in common::snapshot_pages(&mut server, "alice", 100).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
        let now = deadline + if op == "add" { 1 } else { -1 };
        let args = if matches!(op, "add" | "putId") {
            json!({"messageId":"old", "ordinal":1, "at":20, "expiresAt":null})
        } else { json!({}) };
        let entry = device.admit(queued(op, "write", args, now)).unwrap();
        assert_eq!(entry.predictable, op != "move", "{} {op}: {entry:?}", host.label());
        assert_eq!(entry.predicted.is_empty(), op == "move");
        host.close(&name, device);
    }
}

#[test]
fn occupancy_neutral_writes_predict_but_cap_group_moves_queue_on_both_devices() {
    neutral(&mut Sqlite::new("expiry-neutral"));
    neutral(&mut Memory::new());
}
