//! A new generation reads images delivered before a required literal default.
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
    // No post-adoption snapshot: these are the three images held before it.
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
fn literal_default_images_on_both_device_stores() {
    for reopen in [false, true] {
        let mut sqlite = Sqlite::new("defaults");
        scenario(&mut sqlite, reopen);
        let store = snapback4_core::Store::open_read_only(&sqlite.path("defaults")).unwrap();
        assert!(store.rows("messages").unwrap().iter().all(|row| row.field("tombstone").is_err()));
        let mut memory = Memory::new();
        scenario(&mut memory, reopen);
        let held = memory.held("defaults");
        let rows: Vec<Value> = held.iter().filter(|((kind, _), _)| *kind == 'r').filter_map(|(_, value)| value.as_ref())
            .map(|text| serde_json::from_str(text).unwrap()).collect();
        assert_eq!(rows.len(), 3);
        assert!(rows.iter().all(|row| row.field("tombstone").is_err()));
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
