use super::*;
use snapback4_core::{rows::{Rows, MemoryRows}, store::Store};
use snapback4_device::{memory::MemoryStore, store::{DeviceStore, DeviceTx}};

fn schema() -> snapback4_core::schema::Schema {
    compile(&SOURCE.replace("  cap 200000", "  cap 200000\n  cap 50 by conversationId")).schema
}

fn row(schema: &snapback4_core::schema::Schema, id: &str, group: &str, ordinal: i64) -> Value {
    wire::row_from_json(&schema.tables["messages"], &json!({"id":id,"conversationId":group,"ordinal":ordinal,"at":0,"expiresAt":1})).unwrap()
}

fn check(tx: &impl Rows, all: u64, a: u64, b: u64) {
    assert_eq!(tx.cap_count("messages", &[], &[]).unwrap(), all);
    for (group, n) in [("a", a), ("b", b)] {
        assert_eq!(tx.cap_count("messages", &["conversationId".into()], &[Value::Id(group.into())]).unwrap(), n);
    }
}

fn transactions<S: DeviceStore>(store: &mut S) {
    let s = schema();
    store.install(&s, &BTreeMap::new(), false).unwrap();
    let table = &s.tables["messages"];
    let (a, b, moved) = (row(&s, "1", "a", 1), row(&s, "2", "a", 2), row(&s, "1", "b", 1));
    let tx = store.transaction().unwrap();
    tx.put("messages", table, &a, None).unwrap();
    tx.put("messages", table, &b, None).unwrap();
    check(&tx, 2, 2, 0);
    tx.savepoint("move").unwrap();
    tx.put("messages", table, &moved, Some(&a)).unwrap();
    tx.delete("messages", table, &b).unwrap();
    check(&tx, 1, 0, 1);
    tx.rollback_to("move").unwrap();
    check(&tx, 2, 2, 0);
    tx.commit().unwrap();
    let tx = store.transaction().unwrap();
    tx.clear_rows().unwrap();
    check(&tx, 0, 0, 0);
    tx.rollback().unwrap();
    let tx = store.transaction().unwrap();
    check(&tx, 2, 2, 0);
    tx.rollback().unwrap();
}

#[test]
fn counters_follow_moves_deletes_savepoints_and_rollback_on_both_stores() {
    transactions(&mut Store::memory().unwrap());
    transactions(&mut MemoryStore::new());
    let s = schema();
    let memory = MemoryRows::new();
    let a = row(&s, "1", "a", 1);
    memory.put("messages", &s.tables["messages"], &a, None).unwrap();
    check(&memory, 1, 1, 0);
    memory.delete("messages", &s.tables["messages"], &a).unwrap();
    check(&memory, 0, 0, 0);
}

#[test]
fn memory_reopen_rebuilds_counts_and_schema_reset_discards_them() {
    let mut store = MemoryStore::new();
    transactions(&mut store);
    let mut reopened = MemoryStore::new();
    reopened.load(store.drain()).unwrap();
    reopened.install(&schema(), &BTreeMap::new(), false).unwrap();
    let tx = reopened.transaction().unwrap();
    check(&tx, 2, 2, 0);
    tx.rollback().unwrap();
    reopened.install(&schema(), &BTreeMap::new(), true).unwrap();
    let tx = reopened.transaction().unwrap();
    check(&tx, 0, 0, 0);
}

#[test]
fn sqlite_reopen_upgrades_legacy_counts_without_changing_generation() {
    let dir = std::env::temp_dir().join(format!("sb4-expiry-upgrade-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("store.sqlite");
    let b = compile(SOURCE);
    let mut e = Engine::new(Store::open(&path).unwrap(), b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    let old = constraints::row(&e, "old", 1, 1, json!(10));
    e.load([old]).unwrap();
    let generation = e.generation();
    let tx = e.store_mut().transaction().unwrap();
    tx.conn().execute_batch("DROP TABLE _cap_counts; DELETE FROM _meta WHERE key = 'cap_counts_schema';").unwrap();
    tx.commit().unwrap();
    drop(e);
    let mut e = Engine::open_at(Store::open(&path).unwrap(), 100).unwrap();
    assert_eq!(e.generation(), generation);
    let tx = e.store_mut().transaction().unwrap();
    assert_eq!(tx.cap_count("messages", &[], &[]).unwrap(), 1);
    tx.rollback().unwrap();
    assert_eq!(e.sweep_expired(100, 2_000).unwrap(), 1);
    drop(e);
    let mut e = Engine::open_at(Store::open(&path).unwrap(), 100).unwrap();
    let tx = e.store_mut().transaction().unwrap();
    assert_eq!(tx.cap_count("messages", &[], &[]).unwrap(), 0);
    tx.rollback().unwrap();
    drop(e);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn counter_identity_separates_column_names_from_values_without_delimiter_aliases() {
    use snapback4_core::rows::caps::key;
    let group = [Value::Int(1), Value::Int(2)];
    assert_ne!(key(&["x,y".into(), "z".into()], &group), key(&["x".into(), "y,z".into()], &group));
    assert_ne!(key(&[], &[]), key(&["".into()], &[Value::Null]));
    assert_ne!(key(&["x".into()], &[Value::String("y".into())]), key(&["y".into()], &[Value::String("x".into())]));
    // An authored raw table/index label must not alias the private map slot.
    let schema = schema();
    let table = &schema.tables["messages"];
    let memory = MemoryRows::new();
    memory.put("t.x", table, &row(&schema, "row", "a", 1), None).unwrap();
    let mut collider = table.clone();
    collider.expire = None;
    collider.constraints.clear();
    collider.indexes.insert("x".into(), table.indexes["byConversationOrdinal"].clone());
    let image = snapback4_core::value::object([("id", Value::Id("a".into())),
        ("conversationId", Value::String("conversationId".into())), ("ordinal", Value::Null)]);
    memory.put("\0caps:t", &collider, &image, None).unwrap();
    assert_eq!(memory.cap_count("t.x", &["conversationId".into()], &[Value::Id("a".into())]).unwrap(), 1);

}

#[test]
fn cap_counts_interpret_legacy_images_through_literal_defaults() {
    let schema = compile("table items:\n  group: text <=10 default 'a'\n  until: time ?\n  expire at .until\n  cap 1 by group\n  read <- allow\n").schema;
    let table = &schema.tables["items"];
    let legacy = snapback4_core::value::object([("id", Value::Id("old".into())), ("until", Value::Null)]);
    let materialized = snapback4_core::schema::row_image(&legacy, table).into_owned();
    let memory = MemoryRows::new();
    memory.put("items", table, &legacy, None).unwrap();
    assert_eq!(memory.cap_count("items", &["group".into()], &[Value::String("a".into())]).unwrap(), 1);
    // A raw old image and the reader's interpreted image have the same group.
    memory.put("items", table, &materialized, Some(&legacy)).unwrap();
    assert_eq!(memory.cap_count("items", &["group".into()], &[Value::String("a".into())]).unwrap(), 1);
    memory.delete("items", table, &materialized).unwrap();
    assert_eq!(memory.cap_count("items", &["group".into()], &[Value::String("a".into())]).unwrap(), 0);
}
