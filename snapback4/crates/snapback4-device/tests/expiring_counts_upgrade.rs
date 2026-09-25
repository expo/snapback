//! Reopen genuine legacy-shaped contribution keys through both device hosts.
mod common;
use common::*;
use snapback4_core::{Schema, Value, Store, error::RuntimeError, rows::{Rows, Bounds, Dir}};
use snapback4_device::{device::Device, memory::MemoryStore, store::{DeviceStore, DeviceTx}};
use std::collections::BTreeMap;

struct Borrowed<'a, S>(&'a mut S);
impl<S: DeviceStore> DeviceStore for Borrowed<'_, S> {
    type Tx<'a> = S::Tx<'a> where Self: 'a;
    fn install(&mut self, schema: &Schema, metadata: &BTreeMap<String,String>, reset: bool) -> Result<(),RuntimeError> { self.0.install(schema,metadata,reset) }
    fn install_checked(&mut self, schema: &Schema, metadata: &BTreeMap<String,String>, reset: bool, expected: &BTreeMap<String,Option<String>>) -> Result<(),RuntimeError> { self.0.install_checked(schema,metadata,reset,expected) }
    fn meta(&self, key: &str) -> Result<Option<String>,RuntimeError> { self.0.meta(key) }
    fn set_meta(&mut self, key: &str, value: &str) -> Result<(),RuntimeError> { self.0.set_meta(key,value) }
    fn transaction(&mut self) -> Result<Self::Tx<'_>,RuntimeError> { self.0.transaction() }
}

const SOURCE: &str = include_str!("../../snapback4-lang/tests/fixtures/expiring-counts.q");

fn upgrade<S: DeviceStore>(mut store: S) {
    let (mut server, mut legacy) = compile(SOURCE);
    for table in legacy.schema.tables.values_mut() {
        for index in table.indexes.values_mut() {
            if matches!(index.components.first(), Some(snapback4_core::schema::IndexComponent::Contribution(_))) {
                index.components.truncate(1);
            }
        }
    }
    let rows = [("a",Value::Null),("b",Value::Int(1000)),("c",Value::Int(100))].map(|(name,expiry)| {
        ("receipts".into(), snapback4_core::value::object([
            ("id",id(name)), ("chat",id("chat")), ("principal",id("alice")),
            ("state",Value::Int(0)), ("visible",Value::Bool(true)), ("weight",Value::Int(1)),
            ("at",Value::Int(0)), ("expiresAt",expiry),
        ]))
    });
    server.seed(rows.clone()).unwrap();
    store.install(&legacy.schema, &BTreeMap::from([
        ("device:backend".into(),serde_json::to_string(&legacy).unwrap()),
        ("device:generation".into(),legacy.generation.to_string()),
        ("device:acquired-generation".into(),legacy.generation.to_string()),
    ]), false).unwrap();
    let tx = store.transaction().unwrap();
    for (table,row) in rows.into_iter().chain(server.store().rows("unreadCounts").unwrap().into_iter().map(|row|("unreadCounts".into(),row))) {
        tx.put(&table,&legacy.schema.tables[&table],&row,None).unwrap();
    }
    let index = legacy.schema.maintain_for("unreadCounts").unwrap().contribution_index();
    let prefix = [id("chat"),id("alice")];
    let old = tx.scan("receipts",&index,&prefix,&Bounds::default(),Dir::Asc,10).unwrap();
    assert_eq!(old.iter().map(|(r,_)|r.field("id").unwrap().clone()).collect::<Vec<_>>(),[id("a"),id("b"),id("c")]);
    assert!(old.iter().all(|(_,key)|snapback4_core::key::decode(key).unwrap().len()==3));
    tx.commit().unwrap();
    {
        let mut device = Device::open_store(Borrowed(&mut store),None).unwrap();
        for now in [0,100,1000] {
            let local = device.query("unread","alice",&serde_json::json!({}),now).unwrap();
            let online = server.query("unread",context("alice",&[]).at(now)).unwrap();
            assert!(local.complete && online.complete);
            assert_eq!(local.data,online.data);
        }
    }
    let tx = store.transaction().unwrap();
    let rebuilt = tx.scan("receipts",&index,&prefix,&Bounds::default(),Dir::Asc,10).unwrap();
    assert_eq!(rebuilt.iter().map(|(r,_)|r.field("id").unwrap().clone()).collect::<Vec<_>>(),[id("c"),id("b"),id("a")]);
    assert!(rebuilt.iter().all(|(_,key)|snapback4_core::key::decode(key).unwrap().len()==4));
    tx.rollback().unwrap();
}

#[test] fn memory_041_upgrade() { upgrade(MemoryStore::new()); }
#[test] fn sqlite_device_041_upgrade() { upgrade(Store::memory().unwrap()); }

fn oversized_upgrade<S: DeviceStore>(mut store: S) {
    use snapback4_core::{schema::ColumnType, rows::{MAX_INDEX_KEY_BYTES, index_key}};
    let (_,mut backend) = compile(SOURCE);
    backend.schema.maintains.retain(|m|m.target=="unreadCounts");
    backend.schema.tables.retain(|name,_|name=="receipts" || name=="unreadCounts");
    for table in backend.schema.tables.values_mut() {
        table.columns.insert("chat".into(),ColumnType::Text {max:MAX_INDEX_KEY_BYTES as u32});
    }
    backend.schema.prepare_contribution_indexes();
    let modern = backend.schema.clone();
    let index = "$contribution:unreadCounts";
    backend.schema.tables.get_mut("receipts").unwrap().indexes.get_mut(index).unwrap().components.truncate(1);
    let table = &backend.schema.tables["receipts"];
    let mut row = snapback4_core::value::object([
        ("id",id("r")), ("chat",Value::String("x".repeat(MAX_INDEX_KEY_BYTES))), ("principal",id("alice")),
        ("state",Value::Int(0)), ("visible",Value::Bool(true)), ("weight",Value::Int(1)),
        ("at",Value::Int(0)), ("expiresAt",Value::Int(1000)),
    ]);
    let overhead = index_key(&table.indexes[index],&row,"r").len()-MAX_INDEX_KEY_BYTES;
    if let Value::Row(fields) = &mut row { fields.insert("chat".into(),Value::String("x".repeat(MAX_INDEX_KEY_BYTES-overhead))); }
    assert_eq!(index_key(&table.indexes[index],&row,"r").len(),MAX_INDEX_KEY_BYTES);
    store.install(&backend.schema,&BTreeMap::from([("q:marker".into(),"before".into())]),false).unwrap();
    let tx = store.transaction().unwrap();
    tx.put("receipts",table,&row,None).unwrap();
    tx.commit().unwrap();
    let error = store.install(&modern,&BTreeMap::from([("q:marker".into(),"after".into())]),false).unwrap_err();
    assert_eq!(error.code(),"E_INDEX_KEY_BYTES");
    assert_eq!(store.meta("q:marker").unwrap().as_deref(),Some("before"));
    let tx = store.transaction().unwrap();
    let old = tx.scan("receipts",index,&[],&Bounds::default(),Dir::Asc,2).unwrap();
    assert_eq!(old.len(),1); assert_eq!(old[0].0,row); assert_eq!(old[0].1.len(),MAX_INDEX_KEY_BYTES);
    tx.rollback().unwrap();
}

#[test] fn memory_upgrade_preserves_the_portable_key_ceiling() { oversized_upgrade(MemoryStore::new()); }
#[test] fn sqlite_upgrade_preserves_the_portable_key_ceiling() { oversized_upgrade(Store::memory().unwrap()); }

#[test]
fn refused_memory_rebuild_does_not_publish_metadata_or_clear_entries() {
    let (_, backend) = compile(SOURCE);
    let mut store = MemoryStore::new();
    store.install(&backend.schema,&BTreeMap::new(),false).unwrap();
    let tx = store.transaction().unwrap();
    // Exercise the adoption ledger with an oversized persisted row. No
    // backend or index state may be partially published on a metered refusal.
    let row = snapback4_core::value::object([
        ("id",id("large")), ("chat",id("chat")), ("principal",id("alice")),
        ("state",Value::Int(0)), ("visible",Value::Bool(true)), ("weight",Value::Int(1)),
        ("at",Value::Int(0)), ("expiresAt",Value::Null),
        ("oldPayload",Value::String("x".repeat(5<<20))),
    ]);
    tx.put("receipts",&backend.schema.tables["receipts"],&row,None).unwrap();
    tx.commit().unwrap();
    let before = store.export();
    let error = store.install(&backend.schema,&BTreeMap::from([("probe".into(),"changed".into())]),false).unwrap_err();
    assert_eq!(error.code(),"E_BOUND");
    assert_eq!(store.export(),before);
    let tx = store.transaction().unwrap();
    assert_eq!(tx.scan("receipts","$contribution:unreadCounts",&[id("chat"),id("alice")],&Bounds::default(),Dir::Asc,2).unwrap().len(),1);
    tx.rollback().unwrap();
}
