use super::*;
#[path = "../../../snapback4-device/tests/common/mod.rs"]
mod common;
use common::{BoundaryMetadata, Host, Memory, Sqlite};

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

// A count at the last delivered watermark would be identical in these two
// worlds too. Until post-sweep sync arrives, it cannot decide current space.
fn sweep_in_transit<H: Host>(host: &mut H, cold: bool) {
    for cap in ["  cap 1", "  cap 1 by conversationId"] {
        for op in ["add", "quiet", "put", "putId"] {
            let source = constraints::source(cap);
            let deadline = snapback4_core::now_ms() + if cold { -60_000 } else { 60_000 };
            let now = deadline + 120_000;
            let mut prior_snapshot = None;
            let mut prior_entry = None;
            for swept in [false, true] {
                let (mut server, backend) = common::compile(&source);
                let old = constraints::row(&server, "old", 1, 1, json!(deadline));
                server.load([old]).unwrap();
                let pages = common::snapshot_pages(&mut server, "alice", 100);
                let snapshot = serde_json::to_value(&pages).unwrap();
                if let Some(prior) = prior_snapshot.replace(snapshot.clone()) {
                    assert_eq!(snapshot, prior, "identical delivered evidence before the sweep");
                }
                let name = format!("transit-{op}-{cold}-{swept}-{}", cap.len());
                let mut device = host.open(&name, Some(backend)).unwrap();
                for (i, page) in pages.iter().enumerate() { device.apply(page, i == 0).unwrap(); }
                let from = device.state().unwrap().0;
                let delayed = if swept {
                    assert_eq!(server.sweep_expired(now, 2_000).unwrap(), 1);
                    let page = common::stream_page(&mut server, "alice", from);
                    assert!(page.events.iter().any(|e| e.table == "messages" && e.id == "old" && e.kind == "del"));
                    Some(page) // The deletion has not reached the device.
                } else { None };
                assert_eq!(server.store().count("messages").unwrap(), u64::from(!swept));
                assert_eq!(device.store().raw_rows("messages").len(), usize::from(!cold));
                assert_eq!(device.state().unwrap().0, from);
                let args = json!({"messageId":"new", "ordinal":2, "at":20, "expiresAt":null});
                let entry = device.admit(queued(op, "send", args, now)).unwrap();
                assert!(!entry.predictable && entry.predicted.is_empty(), "{} cold={cold} swept={swept}: {entry:?}", host.label());
                if let Some(prior) = prior_entry.replace(entry.clone()) {
                    assert_eq!(entry, prior, "the entire queued result is independent of an undelivered sweep");
                }
                let read_args = json!({"conversationId":"chat", "ordinal":2});
                assert_eq!(device.query("message", "alice", &read_args, now).unwrap().data, Value::Null);
                host.close(&name, device);
                device = host.open(&name, None).unwrap();
                assert_eq!(device.queued().unwrap(), vec![entry]);
                let out = server.mutate(op, Some("send"), Context::new("alice", constraints::args("new", 2, 20)).at(now).with_ids(["new".into()])).unwrap();
                if swept {
                    let WriteState::Sent { seq, .. } = out.state else { panic!("{out:?}") };
                    device.settle("send", Some(seq)).unwrap();
                    // The older sweep page publishes before the insertion page.
                    device.apply(delayed.as_ref().unwrap(), false).unwrap();
                    assert!(device.store().raw_rows("messages").is_empty());
                    assert_eq!(device.query("message", "alice", &read_args, now).unwrap().data, Value::Null);
                    let from = device.state().unwrap().0;
                    device.apply(&common::stream_page(&mut server, "alice", from), false).unwrap();
                    assert_eq!(device.query("message", "alice", &read_args, now).unwrap().data.field("at"), Ok(&Value::Int(20)));
                } else {
                    assert!(matches!(out.state, WriteState::Failed { ref why, .. } if why.code == "E_CONSTRAINT"), "{out:?}");
                    device.settle("send", None).unwrap();
                }
                assert!(device.queued().unwrap().is_empty());
                host.close(&name, device);
            }
        }
    }
}

#[test]
fn an_undelivered_sweep_cannot_make_either_device_accept_or_refuse_an_expiring_cap_write() {
    for cold in [false, true] {
        sweep_in_transit(&mut Sqlite::new("expiry-transit"), cold);
        sweep_in_transit(&mut Memory::new(), cold);
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
