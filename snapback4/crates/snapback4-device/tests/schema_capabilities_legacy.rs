mod common;
use serde_json::json;
use snapback4_device::{device::{Backend, Device}, opening::Opening, store::{DeviceStore, DeviceTx}, memory::MemoryStore};
use snapback4_core::{schema::Schema, error::RuntimeError, rows::Rows, Value, value::object};
use std::{cell::Cell, collections::BTreeMap};

// Genuine pre-capability-carrier bytes: absence of version defaults to v1.
const LEGACY: &str = include_str!("../../snapback4-core/tests/fixtures/legacy-recorded-timeline-backend.json");

struct Borrowed<'a, S>(&'a mut S, &'a Cell<usize>);
impl<S: DeviceStore> DeviceStore for Borrowed<'_, S> {
    type Tx<'a> = S::Tx<'a> where Self: 'a;
    fn install(&mut self, schema: &Schema, metadata: &BTreeMap<String, String>, reset: bool) -> Result<(), RuntimeError> { self.0.install(schema, metadata, reset) }
    fn install_checked(&mut self, schema: &Schema, metadata: &BTreeMap<String, String>, reset: bool, expected: &BTreeMap<String, Option<String>>) -> Result<(), RuntimeError> { self.0.install_checked(schema, metadata, reset, expected) }
    fn meta(&self, key: &str) -> Result<Option<String>, RuntimeError> {
        if key == "device:backend" { self.1.set(self.1.get() + 1); }
        self.0.meta(key)
    }
    fn set_meta(&mut self, key: &str, value: &str) -> Result<(), RuntimeError> { self.0.set_meta(key, value) }
    fn transaction(&mut self) -> Result<Self::Tx<'_>, RuntimeError> { self.0.transaction() }
}

fn legacy() -> Backend { serde_json::from_str(LEGACY).unwrap() }
fn current() -> Backend {
    let b = snapback4_lang::compile(&[("schema.q".into(), include_str!("../../snapback4-core/tests/fixtures/legacy-recorded-timeline.q").into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    Backend { generation: 2, schema: b.schema, programs: b.programs.into_iter().map(|p|p.program).collect() }
}
fn assert_refusal(error: RuntimeError) {
    let expected = snapback4_core::schema::timeline::check_version(&legacy().schema).unwrap_err();
    assert_eq!(error.code(), "E_TIMELINE_REDEFINE");
    assert_eq!(error.to_string(), expected.to_string(), "same fence as server open");
    assert!(error.to_string().contains("fresh store in dev"));
}

fn prepare<S: DeviceStore>(store: &mut S, backend: &Backend, wire: &str) {
    // Restore old durable state at the store boundary, without opening it with
    // the new device interpreter (which must now refuse these exact bytes).
    store.install(&backend.schema, &BTreeMap::from([
        ("device:backend".into(), wire.into()), ("device:generation".into(), backend.generation.to_string()),
        ("device:watermark".into(), "7".into()),
    ]), false).unwrap();
    let tx = store.transaction().unwrap();
    let post = object([("id", Value::Id("post".into())), ("authorId", Value::Id("dev:alice".into())), ("at", Value::Int(1000)), ("removed", Value::Bool(false))]);
    tx.put("posts", &backend.schema.tables["posts"], &post, None).unwrap();
    tx.outbox_insert(1, "pending", &json!({"id":"pending", "seq":1, "op":"like", "args":{"postId":"post"}, "new_ids":["like"]}).to_string()).unwrap();
    tx.commit().unwrap();
}
fn state<S: DeviceStore>(store: &mut S) -> (Vec<(String, String)>, Option<Value>, Vec<String>) {
    let tx = store.transaction().unwrap();
    let state = (tx.meta_prefix("").unwrap(), tx.get("posts", "post").unwrap(), tx.outbox_entries().unwrap());
    tx.commit().unwrap();
    state
}
fn reopen<S: DeviceStore>(mut store: S, reload: impl Fn(S) -> S) {
    prepare(&mut store, &legacy(), LEGACY);
    store = reload(store);
    let before = state(&mut store);
    let reads = Cell::new(0);
    for opening in [Opening::Kept, Opening::Install(current()), Opening::Initial(current())] {
        reads.set(0);
        let error = match opening.open(Borrowed(&mut store, &reads)) {
            Err(error) => error, Ok(_) => panic!("v1 timeline store opened"),
        };
        assert_refusal(error);
        assert_eq!(reads.get(), 1, "reuse the captured backend read");
        assert_eq!(state(&mut store), before, "refusal preserves metadata, rows and queued writes");
    }
}
fn adoption<S: DeviceStore>(mut store: S) {
    let backend = current();
    prepare(&mut store, &backend, &serde_json::to_string(&backend).unwrap());
    let reads = Cell::new(0);
    drop(Device::open_store(Borrowed(&mut store, &reads), None).unwrap());
    let before = state(&mut store);
    {
        let mut device = Device::open_store(Borrowed(&mut store, &reads), None).unwrap();
        let before_backend = serde_json::to_value(device.backend()).unwrap();
        let mut obsolete = legacy(); obsolete.generation = 3;
        let error = device.adopt_captured(obsolete.clone(), BTreeMap::new()).unwrap_err();
        assert_refusal(error);
        assert_eq!(serde_json::to_value(device.backend()).unwrap(), before_backend);
        assert_refusal(device.adopt(obsolete).unwrap_err());
    }
    assert_eq!(state(&mut store), before, "adoption refusal preserves all durable state");
}

#[test]
fn genuine_legacy_codec_remains_recognized_but_timeline_execution_is_fenced() {
    let backend = legacy();
    assert_eq!(backend.schema.timelines[0].version, 1);
    assert_eq!(backend.schema.required_capabilities(), ["maintained-id-sha256-v1".into(), "recorded-attribution".into(), "timeline".into()].into());
    let encoded = serde_json::to_string(&backend).unwrap();
    assert!(!encoded.contains("Recorded"));
    assert_eq!(encoded.matches("Capabilities").count(), 1);
    assert_eq!(serde_json::from_str::<Backend>(&encoded).unwrap().schema, backend.schema);
    assert_refusal(snapback4_core::schema::timeline::check_version(&backend.schema).unwrap_err());
}
#[test]
fn legacy_timeline_first_install_refuses_without_writes() {
    let mut store = MemoryStore::new();
    let reads = Cell::new(0);
    for opening in [Opening::Install(legacy()), Opening::Initial(legacy())] {
        let error = match opening.open(Borrowed(&mut store, &reads)) {
            Err(error) => error, Ok(_) => panic!("v1 timeline installed"),
        };
        assert_refusal(error);
        assert!(store.drain().is_empty());
    }
}
#[test]
fn legacy_timeline_reopen_refuses_memory() {
    reopen(MemoryStore::new(), |store| {
        let mut reopened = MemoryStore::new(); reopened.load(store.export()).unwrap(); reopened
    });
}
#[test]
fn legacy_timeline_reopen_refuses_sqlite() {
    let host = common::Sqlite::new("legacy-timeline-open"); let path = host.path("device");
    drop(snapback4_device::native::Device::open(&path, Some(current())).unwrap());
    reopen(snapback4_core::Store::open(&path).unwrap(), |store| { drop(store); snapback4_core::Store::open(&path).unwrap() });
}
#[test]
fn legacy_timeline_adoption_refuses_memory() { adoption(MemoryStore::new()); }
#[test]
fn legacy_timeline_adoption_refuses_sqlite() {
    let host = common::Sqlite::new("legacy-timeline-adopt"); let path = host.path("device");
    drop(snapback4_device::native::Device::open(&path, Some(current())).unwrap());
    adoption(snapback4_core::Store::open(&path).unwrap());
}
