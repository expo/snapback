mod common;
use snapback4_device::{device::{Backend, Device}, memory::MemoryStore, opening::Opening, call};
use snapback4_core::schema::{Schema, ColumnType, Index, public_table};
use serde_json::json;
use std::collections::BTreeMap;
use snapback4_device::store::{DeviceStore, DeviceTx};
use snapback4_core::{error::RuntimeError, rows::Rows, value::{Value, object}};

fn plain() -> Backend {
    Backend { generation: 1, programs: vec![], schema: Schema {
        tables: BTreeMap::from([("t".into(), public_table(
            BTreeMap::from([("id".into(), ColumnType::Id)]),
            BTreeMap::from([("byId".into(), Index::of(&["id"], true))]),
        ))]),
        ..Schema::default()
    } }
}

#[test]
fn future_capability_refuses_initial_install_and_adoption_without_changes() {
    let backend = plain();
    for wire in [serde_json::to_value(&backend).unwrap(), json!({"initial_backend":backend})] {
        Opening::parse(Some(&wire.to_string())).unwrap().open(MemoryStore::new()).unwrap();
    }
    let mut future = serde_json::to_value(&backend).unwrap();
    future["generation"] = json!(2);
    future["schema"]["tables"]["t"]["constraints"] = json!([{"Capabilities":["future-derivation"]}]);
    for wire in [future.clone(), json!({"initial_backend":future.clone()})] {
        let error = match Opening::parse(Some(&wire.to_string())) {
            Err(error) => error,
            Ok(_) => panic!("unsupported initial backend accepted"),
        };
        assert_eq!(error.code(), "E_SCHEMA_CAPABILITY");
        assert_eq!(error.family(), "schema");
    }
    let mut device = Device::open_store(MemoryStore::new(), Some(backend)).unwrap();
    device.store().drain();
    let before = call::call(&mut device, json!({"op":"backend"}));
    let answer = call::call(&mut device, json!({"op":"adopt","backend":future}));
    assert_eq!(answer["denied"]["code"], "E_SCHEMA_CAPABILITY");
    assert!(device.store().drain().is_empty());
    assert_eq!(call::call(&mut device, json!({"op":"backend"})), before);
}

// Borrow the real store so a refused opening leaves it available for inspection.
struct Borrowed<'a, S>(&'a mut S);
impl<S: DeviceStore> DeviceStore for Borrowed<'_, S> {
    type Tx<'a> = S::Tx<'a> where Self: 'a;
    fn install(&mut self, schema: &Schema, metadata: &BTreeMap<String, String>, reset: bool) -> Result<(), RuntimeError> {
        self.0.install(schema, metadata, reset)
    }
    fn install_checked(&mut self, schema: &Schema, metadata: &BTreeMap<String, String>, reset: bool, expected: &BTreeMap<String, Option<String>>) -> Result<(), RuntimeError> {
        self.0.install_checked(schema, metadata, reset, expected)
    }
    fn meta(&self, key: &str) -> Result<Option<String>, RuntimeError> { self.0.meta(key) }
    fn set_meta(&mut self, key: &str, value: &str) -> Result<(), RuntimeError> { self.0.set_meta(key, value) }
    fn transaction(&mut self) -> Result<Self::Tx<'_>, RuntimeError> { self.0.transaction() }
}

fn refused_reopen_preserves<S: DeviceStore>(store: &mut S) {
    let backend = plain();
    drop(Device::open_store(Borrowed(store), Some(backend.clone())).unwrap());
    let row = object([("id", Value::Id("kept".into()))]);
    let tx = store.transaction().unwrap();
    tx.put("t", &backend.schema.tables["t"], &row, None).unwrap();
    tx.commit().unwrap();
    let mut future = serde_json::to_value(&backend).unwrap();
    future["schema"]["tables"]["t"]["constraints"] = json!([{"Capabilities":["future-derivation"]}]);
    store.set_meta("device:backend", &future.to_string()).unwrap();
    let mut replacement = backend;
    replacement.generation = 2; // Without the fence this resets the held row.
    let before = store.transaction().unwrap().meta_prefix("").unwrap();
    for opening in [Opening::Install(replacement.clone()), Opening::Kept, Opening::Initial(replacement)] {
        let error = match opening.open(Borrowed(store)) {
            Err(error) => error,
            Ok(_) => panic!("unsupported kept backend accepted during reopening"),
        };
        assert_eq!(error.code(), "E_SCHEMA_CAPABILITY");
        let tx = store.transaction().unwrap();
        assert_eq!(tx.meta_prefix("").unwrap(), before, "refusal must preserve all metadata");
        assert_eq!(tx.get("t", "kept").unwrap(), Some(row.clone()), "refusal must preserve rows");
    }
}

#[test]
fn explicit_backend_reopening_checks_kept_capabilities_memory() {
    let mut store = MemoryStore::new();
    refused_reopen_preserves(&mut store);
    // Setup is the only source of writes; refused openings cannot delete anything.
    assert!(store.drain().iter().all(|change| change.v.is_some()));
}

#[test]
fn explicit_backend_reopening_checks_kept_capabilities_sqlite() {
    let host = common::Sqlite::new("capability-fence");
    let path = host.path("device");
    drop(snapback4_device::native::Device::open(&path, Some(plain())).unwrap());
    let mut store = snapback4_core::store::Store::open(&path).unwrap();
    refused_reopen_preserves(&mut store);
}
