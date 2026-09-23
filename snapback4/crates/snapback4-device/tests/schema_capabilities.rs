use snapback4_device::{device::{Backend, Device}, memory::MemoryStore, opening::Opening, call};
use snapback4_core::schema::{Schema, ColumnType, Index, public_table};
use serde_json::json;
use std::collections::BTreeMap;

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
