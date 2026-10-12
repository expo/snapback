//! Every generation reacquires authoritative images, including literal-default additions.
mod common;
use common::*;
use snapback4_core::{Value, wire};
use snapback4_device::device::Backend;

const BEFORE: &str = "table messages:\n  body: text <=100\n  read <- allow\n  sync public\nquery all():\n  return messages[] first 10 by byId\n";

fn scenario<H: Host>(host: &mut H, reopen_with_backend: bool) {
    let (mut engine, backend) = compile(BEFORE);
    let table = engine.schema().tables["messages"].clone();
    engine.seed((0..3).map(|i| ("messages".into(), wire::row_from_json(&table, &serde_json::json!({"id": format!("m{i}"), "body": "old"})).unwrap()))).unwrap();
    let mut device = host.open("defaults", Some(backend)).unwrap();
    for (i, page) in snapshot_pages(&mut engine, "dev:alice", 100).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
    assert_eq!(device.query("all", "dev:alice", &serde_json::json!({}), 1000).unwrap().data.as_array().unwrap().len(), 3);
    let (_, next) = compile(&BEFORE.replace("  body:", "  tombstone: bool default false\n  label: text 1..10 default 'old'\n  by byTombstone: tombstone, id\n  body:")
        .replace("messages[] first 10 by byId", "messages[false] first 10 by byTombstone"));
    engine.adopt(next.schema.clone(), next.programs.clone()).unwrap();
    let next = Backend { generation: engine.generation(), ..next };
    if reopen_with_backend {
        host.close("defaults", device);
        device = host.open("defaults", Some(next)).unwrap();
    } else {
        device.adopt(next).unwrap();
    }
    assert_eq!(device.query("all", "dev:alice", &serde_json::json!({}), 1000).unwrap_err().code,"E_PREDICT","generation replacement requires reacquisition");
    for (i,page) in snapshot_pages(&mut engine,"dev:alice",100).iter().enumerate(){device.apply(page,i==0).unwrap();}
    let read = device.query("all", "dev:alice", &serde_json::json!({}), 1000).unwrap();
    assert!(read.complete);
    assert_eq!(read.data.as_array().unwrap().len(), 3, "{}", host.label());
    assert!(read.data.as_array().unwrap().iter().all(|r| r.field("tombstone").unwrap() == &Value::Bool(false)));
    assert!(read.data.as_array().unwrap().iter().all(|r| r.field("label").unwrap() == &Value::String("old".into())));
    host.close("defaults", device);
    let mut device = host.open("defaults", None).unwrap();
    assert_eq!(device.query("all", "dev:alice", &serde_json::json!({}), 1000).unwrap().data, read.data);
    host.close("defaults", device);
    println!("{}: 3 held rows, 3 default-index matches, reopen_with_backend={reopen_with_backend}", host.label());
}

#[test]
fn literal_default_additions_reacquire_on_both_device_stores() {
    for reopen in [false, true] {
        let mut sqlite = Sqlite::new("defaults");
        scenario(&mut sqlite, reopen);
        let store = snapback4_core::Store::open_read_only(&sqlite.path("defaults")).unwrap();
        assert!(store.rows("messages").unwrap().iter().all(|row| row.field("tombstone").unwrap()==&Value::Bool(false)));
        let mut memory = Memory::new();
        scenario(&mut memory, reopen);
        let held = memory.held("defaults");
        let rows: Vec<Value> = held.iter().filter(|((kind, _), _)| *kind == 'r').filter_map(|(_, value)| value.as_ref())
            .map(|text| serde_json::from_str(text).unwrap()).collect();
        assert_eq!(rows.len(), 3);
        assert!(rows.iter().all(|row| row.field("tombstone").unwrap()==&Value::Bool(false)));
    }
}

#[test]
fn a_pending_old_image_keeps_its_mark_and_gains_default_index_entries_on_both_stores() {
    use snapback4_core::rows::{Bounds, Dir, Rows};
    use snapback4_device::store::{DeviceStore, DeviceTx};
    fn scenario<S: DeviceStore>(mut store: S) {
        let (_, before) = compile(BEFORE);
        let (_, after) = compile(&BEFORE.replace("  body:", "  tombstone: bool default false\n  by byTombstone: tombstone, id\n  body:"));
        DeviceStore::install(&mut store, &before.schema, &Default::default(), false).unwrap();
        let pending = snapback4_core::value::object([("id", id("m0")), ("body", Value::String("pending edit".into())), ("pending", Value::Bool(true))]);
        let tx = store.transaction().unwrap();
        tx.put("messages", &before.schema.tables["messages"], &pending, None).unwrap();
        tx.commit().unwrap();
        DeviceStore::install(&mut store, &after.schema, &Default::default(), false).unwrap();
        let tx = store.read_transaction().unwrap();
        assert_eq!(tx.get("messages", "m0").unwrap(), Some(pending));
        let indexed = tx.scan("messages", "byTombstone", &[Value::Bool(false)], &Bounds::default(), Dir::Asc, 10).unwrap();
        assert_eq!(indexed.len(), 1);
        let read = snapback4_core::engine::local::query(&tx, &after.schema, &after.programs[0], context("dev:alice", &[]), snapback4_core::Ceilings::default()).unwrap();
        assert_eq!(read.data.as_array().unwrap()[0].field("tombstone").unwrap(), &Value::Bool(false));
        tx.rollback().unwrap();
    }
    scenario(snapback4_core::Store::memory().unwrap());
    scenario(snapback4_device::memory::MemoryStore::new());
}

const MEMBERS: &str = include_str!("../../snapback4-sim/tests/fixtures/adoption-members.q");
const SUM: &str = include_str!("../../snapback4-sim/tests/fixtures/adoption-sum.q");

fn audience_defaults<H: Host>(host: &mut H) {
    let (mut engine, _) = compile(MEMBERS);
    engine.seed([("members".into(), snapback4_core::value::object([("id", id("member")), ("principal", id("alice"))]))]).unwrap();
    let after = MEMBERS.replace("  principal: principal", "  roomId: id default 'r'\n  principal: principal\n  unique byRoomPrincipal: roomId, principal\n  by byPrincipalRoom: principal, roomId")
        .replace("  read <- allow", "  read <- exists members[.roomId, viewer] by byRoomPrincipal\n  sync last 10 by byRoom\n  retain delivered-history");
    let (_, backend) = compile(&after);
    engine.adopt(backend.schema.clone(), backend.programs.clone()).unwrap();
    let backend = Backend { generation: engine.generation(), ..backend };
    for room in ["r", "hidden"] {
        let table = engine.schema().tables["messages"].clone();
        engine.seed([("messages".into(), wire::row_from_json(&table, &serde_json::json!({"id": room, "roomId": room, "body": room})).unwrap())]).unwrap();
    }
    assert!(engine.store().rows("members").unwrap()[0].field("roomId").is_err());
    for (viewer, expected) in [("alice", 1), ("bob", 0)] {
        let server = engine.query("all", context(viewer, &[("room", id("r"))])).unwrap();
        assert_eq!(server.data.as_array().unwrap().len(), expected);
        assert!(engine.query("all", context(viewer, &[("room", id("hidden"))])).unwrap().data.as_array().unwrap().is_empty());
        let pages = snapshot_pages(&mut engine, viewer, 100);
        let held = serde_json::to_value(&pages[0].held).unwrap();
        assert_eq!(held["messages"], if expected == 1 { serde_json::json!([["r"]]) } else { serde_json::json!([]) }, "{} {viewer}: held agrees with rule admission", host.label());
        let mut device = host.open(viewer, Some(backend.clone())).unwrap();
        for (i, page) in pages.iter().enumerate() { device.apply(page, i == 0).unwrap(); }
        assert_eq!(device.query("all", viewer, &serde_json::json!({"room":"r"}), 1000).unwrap().data.as_array().unwrap().len(), expected);
        let watermark = pages.last().unwrap().watermark;
        if viewer == "alice" {
            let table = engine.schema().tables["messages"].clone();
            engine.seed([("messages".into(), wire::row_from_json(&table, &serde_json::json!({"id":"later", "roomId":"r", "body":"stream"})).unwrap())]).unwrap();
            device.apply(&stream_page(&mut engine, viewer, watermark), false).unwrap();
            assert_eq!(device.query("all", viewer, &serde_json::json!({"room":"r"}), 1000).unwrap().data.as_array().unwrap().len(), 2);
        }
        host.close(viewer, device);
    }
    let mut device = host.open("alice", None).unwrap();
    let watermark = engine.seq().unwrap();
    assert!(matches!(engine.mutate("leave", Some("leave"), context("alice", &[])).unwrap().state, snapback4_core::WriteState::Sent { .. }));
    let left = stream_page(&mut engine, "alice", watermark);
    assert!(left.events.iter().any(|event| event.table == "messages" && event.kind == "scope"));
    device.apply(&left, false).unwrap();
    assert_eq!(device.query("all", "alice", &serde_json::json!({"room":"r"}), 1000).unwrap().data.as_array().unwrap().len(), 2);
    let replacement = snapshot_pages(&mut engine, "alice", 100);
    assert_eq!(serde_json::to_value(&replacement[0].held).unwrap()["messages"], serde_json::json!([]));
    assert!(engine.query("all", context("alice", &[("room", id("r"))])).unwrap().data.as_array().unwrap().is_empty());
    host.close("alice", device);
    println!("{}: default audience admits alice=1, bob=0; held=1/0; snapshot=1/0; stream=2; leave retains=2, server=0", host.label());
}

#[test]
fn defaulted_membership_group_agrees_with_rules_snapshot_and_stream_sqlite() { audience_defaults(&mut Sqlite::new("audience-default")); }
#[test]
fn defaulted_membership_group_agrees_with_rules_snapshot_and_stream_memory() { audience_defaults(&mut Memory::new()); }

fn sum_defaults<H: Host>(host: &mut H) {
    let (mut engine, _) = compile(SUM);
    let now = snapback4_core::now_ms();
    let table = engine.schema().tables["sources"].clone();
    engine.seed([("positive", 1, Some(now + 60_000)), ("negative", -1, None), ("third", 1, None)].map(|(name, amount, until)|
        ("sources".into(), wire::row_from_json(&table, &serde_json::json!({"id":name,"amount":amount,"until":until})).unwrap()))).unwrap();
    let after = SUM.replace("  amount:", "  bucket: int default 0\n  by byBucket: bucket, id\n  amount:")
        + "maintain totals: sum sources of amount by bucket\n  read <- allow\nquery total():\n  return totals[0]\nquery candidates():\n  return totals[] first 10 by byGroup\n";
    let (_, backend) = compile(&after);
    engine.adopt(backend.schema.clone(), backend.programs.clone()).unwrap();
    let backend = Backend { generation: engine.generation(), ..backend };
    assert_eq!(engine.query("total", context("alice", &[]).at(now)).unwrap().data, Value::Int(1));
    let mut device = host.open("sum", Some(backend)).unwrap();
    let pages = snapshot_pages(&mut engine, "alice", 100);
    for (i, page) in pages.iter().enumerate() { device.apply(page, i == 0).unwrap(); }
    let watermark = pages.last().unwrap().watermark;
    assert_eq!(device.query("total", "alice", &serde_json::json!({}), now).unwrap().data, Value::Int(1));
    assert!(matches!(engine.mutate("remove", Some("third"), context("alice", &[]).at(now)).unwrap().state, snapback4_core::WriteState::Sent { .. }));
    device.apply(&stream_page(&mut engine, "alice", watermark), false).unwrap();
    assert_eq!(engine.query("total", context("alice", &[]).at(now)).unwrap().data, Value::Int(0));
    let later = now + 60_001;
    let live = engine.query("total", context("alice", &[]).at(later)).unwrap();
    assert_eq!(live.data, Value::Int(-1), "{}: zero candidate must survive", host.label());
    assert_eq!(engine.query("candidates", context("alice", &[]).at(later)).unwrap().data.as_array().unwrap().len(), 1);
    assert_eq!(device.query("total", "alice", &serde_json::json!({}), later).unwrap().data, Value::Int(-1));
    let (events, watermark, next, held) = engine.snapshot_page_with_groups_at("alice", None, 100, later).unwrap();
    let page = serde_json::from_value(serde_json::json!({"snapshot":true,"held":held,"events":events.iter().map(|e| serde_json::json!({"table":e.table,"kind":e.kind.word(),"id":e.id,"data":e.data.as_ref().map(wire::to_json)})).collect::<Vec<_>>(),"watermark":watermark,"more":false,"next":next,"generation":engine.generation()})).unwrap();
    device.apply(&page, true).unwrap();
    assert_eq!(device.query("total", "alice", &serde_json::json!({}), later).unwrap().data, Value::Int(-1));
    host.close("sum", device);
    println!("{}: adopted signed sum 1 -> 0 -> -1; 1 surviving candidate; snapshot after expiry=-1", host.label());
}
#[test]
fn defaulted_sum_keeps_zero_candidate_through_expiry_sqlite() { sum_defaults(&mut Sqlite::new("sum-default")); }
#[test]
fn defaulted_sum_keeps_zero_candidate_through_expiry_memory() { sum_defaults(&mut Memory::new()); }
