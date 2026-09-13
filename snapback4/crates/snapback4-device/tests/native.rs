//! What only a native host has: two devices over one SQLite store (two
//! processes on one phone, a sender and a syncer), and a store that fails
//! mid-snapshot. Everything a device does on every host is in `device.rs`.

mod common;

use common::*;
use snapback4_core::engine::{Context, Engine, WriteState};
use snapback4_core::value::Value;
use snapback4_device::device::{Backend, Queued, StreamEvent, StreamPage};
use snapback4_device::native::Device;

#[test]
fn a_competing_sender_invalidates_a_stale_sync_and_a_failing_store_keeps_the_partition() {
    let source = "table items:\n  group: text <=10\n  value: int\n  read <- allow\n  insert <- allow\n  update <- allow\n  delete <- allow\n  sync public\nmaintain sums: sum items of value by group\n  read <- allow\nquery row(id: id):\n  return items[id] by byId\nquery total():\n  return sums['g'] by byGroup\nmutation first():\n  update items['a'] {value: 99}\n  delete items['b']\n";
    let (mut engine, backend) = compile(source);
    engine.seed([("items".into(), snapback4_core::value::object([("id", id("a")), ("group", Value::String("g".into())), ("value", Value::Int(1))])), ("items".into(), snapback4_core::value::object([("id", id("b")), ("group", Value::String("g".into())), ("value", Value::Int(20))]))]).unwrap();
    let backend = snapback4_device::device::Backend { generation: engine.generation(), ..backend };
    let host = Sqlite::new("competing");
    let path = host.path("store");
    let mut device = Device::open(&path, Some(backend)).unwrap();
    for (n, page) in snapshot_pages(&mut engine, "dev:alice", 100).iter().enumerate() {
        device.apply(page, n == 0).unwrap();
    }
    let watermark = device.state().unwrap().0;
    // A different process may send a write after our HTTP request captured
    // its pending IDs. Its durable revision invalidates that response under
    // the same transaction that would replace confirmed rows.
    let captured = device.sync_state().unwrap();
    let mut sender = Device::open(&path, None).unwrap();
    sender.begin_send().unwrap();
    let mut stale = stream_page(&mut engine, "dev:alice", watermark);
    stale.send_revision = Some(captured.send_revision);
    assert!(device.apply(&stale, false).is_err());
    assert_eq!(device.state().unwrap().0, watermark);
    let staged = snapshot_pages(&mut engine, "dev:alice", 1);
    device.apply(&staged[0], true).unwrap();
    sender.begin_send().unwrap();
    let mut continuation = staged[1].clone();
    continuation.send_revision = Some(sender.sync_state().unwrap().send_revision);
    assert!(device.apply(&continuation, false).is_err(), "a newer per-page capture cannot bless an older staged snapshot");
    for (n, page) in staged.iter().enumerate() {
        device.apply(page, n == 0).unwrap();
    }
    drop(sender);
    // The store fails while the last page drains: the partition and the
    // watermark are what they were.
    let pages = snapshot_pages(&mut engine, "dev:alice", 1);
    assert!(pages.len() > 1);
    device.apply(&pages[0], true).unwrap();
    let sql = rusqlite::Connection::open(&path).unwrap();
    sql.execute_batch("CREATE TRIGGER fail_snapshot BEFORE INSERT ON r BEGIN SELECT RAISE(ABORT, 'snapshot failed'); END;").unwrap();
    for page in &pages[1..pages.len() - 1] {
        device.apply(page, false).unwrap();
    }
    assert!(device.apply(pages.last().unwrap(), false).is_err());
    assert_eq!(device.state().unwrap().0, watermark);
    assert_eq!(device.query("row", "dev:alice", &serde_json::json!({ "id": "b" }), 2000).unwrap().data.field("value").unwrap(), &Value::Int(20));
    sql.execute_batch("DROP TRIGGER fail_snapshot").unwrap();
    device.apply(pages.last().unwrap(), false).unwrap();
    // A second device over the same store starts its own snapshot: the
    // superseded owner must restart.
    let mut competing = Device::open(&path, None).unwrap();
    device.apply(&pages[0], true).unwrap();
    competing.apply(&pages[0], true).unwrap();
    assert!(device.apply(&pages[1], false).is_err(), "the superseded snapshot owner must restart");
    for page in &pages[1..] {
        competing.apply(page, false).unwrap();
    }
    assert_eq!(competing.query("row", "dev:alice", &serde_json::json!({ "id": "b" }), 2000).unwrap().data.field("value").unwrap(), &Value::Int(20));
    drop(competing);
    drop(device);
    drop(sql);
}

#[test]
fn snapshot_catchup_publishes_one_consistent_base_before_replaying_writes() {
    let source = "table items:\n  value: int\n  read <- allow\n  update <- allow\n  sync public\nquery row(id: id):\n  return items[id] by byId\nmutation inc(id: id):\n  row = items[id] by byId\n  require row != null else MISSING\n  update items[id] {value: row.value + 1}\n  return null\n";
    let (mut engine, backend) = compile(source);
    engine.seed(["a", "z"].map(|key| ("items".into(), snapback4_core::value::object([("id", id(key)), ("value", Value::Int(0))])))).unwrap();
    let backend = snapback4_device::device::Backend { generation: engine.generation(), ..backend };
    let host = Sqlite::new("catchup");
    let path = host.path("store");
    let mut device = Device::open(&path, Some(backend)).unwrap();
    for (n, page) in snapshot_pages(&mut engine, "dev:alice", 100).iter().enumerate() {
        device.apply(page, n == 0).unwrap();
    }
    let mut sender = Device::open(&path, None).unwrap();
    sender.admit(Queued { id: "pending-inc".into(), seq: 1, op: "inc".into(), args: serde_json::json!({ "id": "z" }), new_ids: vec![], predicted: vec![], viewer: "dev:alice".into(), now: 2, predictable: true, sent_seq: None, observed_seq: None }).unwrap();
    sender.begin_send().unwrap();
    let capture = device.sync_state().unwrap();
    let (events, pinned, mut after) = engine.snapshot_page("dev:alice", None, 1).unwrap();
    let mut page: StreamPage = serde_json::from_value(serde_json::json!({ "snapshot": true, "events": events.into_iter().map(|e| serde_json::json!({ "table": e.table, "kind": e.kind.word(), "id": e.id, "data": e.data.as_ref().map(snapback4_core::wire::to_json) })).collect::<Vec<_>>(), "watermark": pinned, "more": true, "stage_snapshot": true, "send_revision": capture.send_revision })).unwrap();
    device.apply(&page, true).unwrap();
    // The send began before capture; it commits between snapshot pages. A
    // second commit changes an already-staged row, so both directions need
    // the log before a coherent base can be published.
    let sent = engine.mutate("inc", Some("pending-inc"), context("dev:alice", &[("id", id("z"))]).at(2)).unwrap();
    let WriteState::Sent { seq, .. } = sent.state else { panic!("expected sent") };
    engine.mutate("inc", None, context("dev:alice", &[("id", id("a"))]).at(3)).unwrap();
    while let Some(token) = after {
        let (events, wm, next) = engine.snapshot_page("dev:alice", Some(&token), 1).unwrap();
        page = serde_json::from_value(serde_json::json!({ "snapshot": true, "events": events.into_iter().map(|e| serde_json::json!({ "table": e.table, "kind": e.kind.word(), "id": e.id, "data": e.data.as_ref().map(snapback4_core::wire::to_json) })).collect::<Vec<_>>(), "watermark": wm, "more": next.is_some(), "stage_snapshot": true, "send_revision": capture.send_revision })).unwrap();
        device.apply(&page, false).unwrap();
        after = next;
    }
    assert_eq!(device.query("row", "dev:alice", &serde_json::json!({ "id": "a" }), 3).unwrap().data.field("value").unwrap(), &Value::Int(0), "the old base stays visible until catch-up drains");
    let mut from = pinned;
    loop {
        let streamed = engine.stream("dev:alice", from, 1).unwrap();
        let mut page = stream_page(&mut engine, "dev:alice", from);
        // Exercise the bounded multi-page path, not stream_page's large limit.
        page.events = streamed.events.into_iter().map(|e| StreamEvent { table: e.table, kind: e.kind, id: e.id, data: e.data.as_ref().map(snapback4_core::wire::to_json) }).collect();
        page.watermark = streamed.watermark;
        page.more = streamed.more;
        page.snapshot_catchup = true;
        page.send_revision = Some(capture.send_revision);
        page.acknowledged = engine.acknowledged("dev:alice", &capture.pending_ids, page.watermark).unwrap();
        device.apply(&page, false).unwrap();
        from = page.watermark;
        if !page.more {
            break;
        }
    }
    for key in ["a", "z"] {
        assert_eq!(device.query("row", "dev:alice", &serde_json::json!({ "id": key }), 3).unwrap().data.field("value").unwrap(), &Value::Int(1));
    }
    assert_eq!(device.queued().unwrap().len(), 1, "keep retrying for the lost full mutation reply");
    device.settle("pending-inc", Some(seq)).unwrap();
    assert!(device.queued().unwrap().is_empty());
    drop(sender);
    drop(device);
}

#[test]
fn pending_metadata_reprediction_survives_updates_upserts_scans_and_offline_reopen() {
    let source = include_str!("fixtures/pending-metadata.q");
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
    engine.seed([("people".into(), snapback4_core::value::object([
        ("id", id("alice")), ("name", Value::String("Alice".into())), ("bio", Value::String("Confirmed bio".into())),
    ]))]).unwrap();
    let backend = Backend { generation: engine.generation(), schema: bound.schema, programs: bound.programs.into_iter().map(|p| p.program).collect() };
    let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
    let dir = std::env::temp_dir().join(format!("sb4-pending-metadata-{}-{nonce}", std::process::id()));
    std::fs::create_dir(&dir).unwrap();
    let path = dir.join("device.sqlite");
    let mut device = Device::open(&path, Some(backend)).unwrap();
    for (n, page) in snapshot_pages(&mut engine, "dev:alice", 10).iter().enumerate() { device.apply(page, n == 0).unwrap(); }
    let commands = [
        ("profile", serde_json::json!({"person":"alice","name":"Offline Alice","bio":"Saved bio"})),
        ("profile", serde_json::json!({"person":"alice","name":"Final Alice","bio":"Final bio"})),
        ("vote", serde_json::json!({"person":"alice","answer":"answer","direction":1})),
        ("vote", serde_json::json!({"person":"alice","answer":"answer","direction":-1})),
        ("updateVote", serde_json::json!({"person":"alice","answer":"answer","direction":1})),
        ("scanVote", serde_json::json!({"direction":-1})),
    ];
    let person_args = serde_json::json!({"person":"alice"});
    for (n, (op, input)) in commands.iter().enumerate() {
        let seq = n as u64 + 1;
        device.admit(Queued { id:format!("write-{seq}"),seq,op:(*op).into(),args:input.clone(),new_ids:vec![],predicted:vec![],viewer:"dev:alice".into(),now:seq as i64,predictable:true,sent_seq:None,observed_seq:None }).unwrap();
        let person = device.query("person", "dev:alice", &person_args, 10).unwrap().data;
        assert_eq!(person.field("pending").unwrap(), &Value::Bool(true), "mutation reads must not erase the card");
        if n >= 2 {
            let total = device.query("voteTotal", "dev:alice", &serde_json::json!({"answer":"answer"}), 10).unwrap().data;
            assert_eq!(total, Value::Int(if n % 2 == 0 { 1 } else { -1 }));
        }
    }
    let queued = device.queued().unwrap();
    assert_eq!(queued.len(), commands.len());
    drop(device);
    device = Device::open(&path, None).unwrap();
    assert_eq!(device.queued().unwrap(), queued, "submission order, arguments and minted IDs survive offline reopen");
    // Match native hosts that explicitly predict their durable queue on open.
    for entry in &queued {
        device.predict(&entry.op, &entry.viewer, &entry.args, entry.now, entry.new_ids.clone(), entry.seq).unwrap();
    }
    assert_eq!(device.queued().unwrap(), queued, "re-prediction must not mutate the outbox");
    let person = device.query("person", "dev:alice", &person_args, 10).unwrap().data;
    assert_eq!(person.field("name").unwrap(), &Value::String("Final Alice".into()));
    assert_eq!(person.field("bio").unwrap(), &Value::String("Final bio".into()));
    let votes = device.query("voteRows", "dev:alice", &serde_json::json!({}), 10).unwrap().data;
    assert_eq!(votes.as_array().unwrap().len(), 1);
    assert_eq!(votes.as_array().unwrap()[0].field("direction").unwrap(), &Value::Int(-1));
    assert_eq!(votes.as_array().unwrap()[0].field("pending").unwrap(), &Value::Bool(true));
    let total = device.query("voteTotal", "dev:alice", &serde_json::json!({"answer":"answer"}), 10).unwrap().data;
    assert_eq!(total, Value::Int(-1), "replay must not double-count the maintained total");
    // Stripping trusted read metadata is not permission to author unknown fields.
    for extra in ["pending", "unexpected"] {
        let row = snapback4_core::value::object([("id", id("alice")),("name",Value::String("Alice".into())),("bio",Value::String("bio".into())),(extra,Value::Bool(true))]);
        let error = snapback4_core::engine::validate::validate_row(device.schema(), "people", &row).unwrap_err();
        assert_eq!(error.code(), "E_INPUT");
        assert!(error.to_string().contains(&format!("undeclared field {extra}")));
    }
    let watermark = device.state().unwrap().0;
    for entry in &queued {
        let typed = entry.args.as_object().unwrap().iter().map(|(name, value)| {
            let value = match value {
                serde_json::Value::String(value) if name == "person" => id(value),
                serde_json::Value::String(value) => Value::String(value.clone()),
                serde_json::Value::Number(value) => Value::Int(value.as_i64().unwrap()),
                _ => panic!("unexpected fixture argument"),
            };
            (name.clone(), value)
        }).collect();
        let sent = engine.mutate(&entry.op, Some(&entry.id), Context::new(&entry.viewer, typed).at(entry.now).with_ids(entry.new_ids.clone())).unwrap();
        let WriteState::Sent { seq, .. } = sent.state else { panic!("server refused the admitted fixture") };
        device.settle(&entry.id, Some(seq)).unwrap();
    }
    device.apply(&stream_page(&mut engine, "dev:alice", watermark), false).unwrap();
    assert!(device.queued().unwrap().is_empty());
    for (op, input) in [("person",person_args)] {
        let row = device.query(op, "dev:alice", &input, 10).unwrap().data;
        assert!(row.field("pending").is_err(), "the authoritative image replaces pending metadata");
    }
    let votes = device.query("voteRows", "dev:alice", &serde_json::json!({}), 10).unwrap().data;
    assert!(votes.as_array().unwrap()[0].field("pending").is_err());
    drop(device);
    std::fs::remove_dir_all(dir).unwrap();
}
