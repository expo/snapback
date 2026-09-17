//! Browser MemoryStore and native/server SQLite use the same prepared keys.
use snapback4_core::{rows::{Rows, MemoryRows, MAX_INDEX_KEY_BYTES, index_key}, schema::{Schema, ColumnType}, store::Store, value::{object, canonical_json}, Value};
use snapback4_device::{memory::{MemoryStore, Change}, store::{DeviceStore, DeviceTx}};
use std::collections::BTreeMap;

fn schema() -> Schema {
    let mut bound = snapback4_lang::compile(&[("schema.q".into(), "table items:\n  text: text <=100\n  by byText: text\n  public 'test'\n  online only\n".into())]);
    assert!(bound.diagnostics.is_empty());
    // Raw-schema ingress models a backend predating the declaration gate.
    bound.schema.tables.get_mut("items").unwrap().columns.insert("text".into(), ColumnType::Text { max: 8192 });
    bound.schema
}
fn row(n: usize) -> Value { object([("id", Value::Id("r".into())), ("text", Value::String("x".repeat(n)))]) }

#[test]
fn browser_device_refuses_the_same_key_as_server_without_partial_writes() {
    let schema = schema();
    let table = &schema.tables["items"];
    let mut browser = MemoryStore::new();
    browser.install(&schema, &BTreeMap::new(), false).unwrap();
    let mut server = Store::memory().unwrap();
    server.install(&schema).unwrap();
    let browser = browser.transaction().unwrap();
    let server = server.transaction().unwrap();
    let memory = MemoryRows::new();
    let fits = row(MAX_INDEX_KEY_BYTES - 7);
    let long = row(MAX_INDEX_KEY_BYTES - 6);
    assert_eq!(index_key(&table.indexes["byText"], &fits, "r").len(), MAX_INDEX_KEY_BYTES);
    for rows in [&browser as &dyn Rows, &server, &memory] {
        assert_eq!(rows.put("items", table, &long, None).unwrap_err().code(), "E_INDEX_KEY_BYTES");
        assert_eq!(rows.get("items", "r").unwrap(), None);
        assert_eq!(rows.count_prefix("items", "byId", &[], 10).unwrap(), 0);
        rows.put("items", table, &fits, None).unwrap();
        assert_eq!(rows.put("items", table, &long, Some(&fits)).unwrap_err().code(), "E_INDEX_KEY_BYTES");
        assert_eq!(rows.get("items", "r").unwrap(), Some(fits.clone()));
    }
    browser.rollback().unwrap();
    server.rollback().unwrap();
}

#[test]
fn browser_can_rewrite_a_kept_legacy_violation_then_delete_it() {
    let schema = schema();
    let table = &schema.tables["items"];
    let mut browser = MemoryStore::new();
    browser.load([Change { s: 'r', k: "[\"items\",\"r\"]".into(), v: Some(canonical_json(&row(6000))) }]).unwrap();
    browser.install(&schema, &BTreeMap::new(), false).unwrap();
    let tx = browser.transaction().unwrap();
    let mut old = row(6000);
    for n in [6000, 5000, 2000] {
        let next = row(n);
        tx.put("items", table, &next, Some(&old)).unwrap();
        assert_eq!(tx.get("items", "r").unwrap(), Some(next.clone()));
        old = next;
    }
    assert_eq!(tx.put("items", table, &row(6000), Some(&old)).unwrap_err().code(), "E_INDEX_KEY_BYTES");
    tx.delete("items", table, &old).unwrap();
    assert_eq!(tx.get("items", "r").unwrap(), None);
    tx.commit().unwrap();
}

#[test]
fn time_key_bytes_and_order_match_on_every_store() {
    use snapback4_core::rows::{Bounds, Dir};
    let bound=snapback4_lang::compile(&[("schema.q".into(),include_str!("../../snapback4-sim/tests/fixtures/time-indexes.q").into())]);
    assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
    let schema=bound.schema;
    let table=&schema.tables["events"];
    let mut browser=MemoryStore::new();
    browser.install(&schema,&BTreeMap::new(),false).unwrap();
    let mut native=Store::memory().unwrap();
    DeviceStore::install(&mut native,&schema,&BTreeMap::new(),false).unwrap();
    let browser=browser.transaction().unwrap();
    let native=native.transaction().unwrap();
    let memory=MemoryRows::new();
    let times=[-7_200_001,-1,0,1_799_999,1_800_000,7_200_000,8_999_999,9_000_000];
    for (n,at) in times.into_iter().enumerate() {
        let id=format!("e{n}");
        let row=object([("id",Value::Id(id.clone())),("principal",Value::Id("dev:alice".into())),("at",Value::Int(at))]);
        let expected=snapback4_core::key::encode(&[Value::Int((at-1_800_000).div_euclid(7_200_000)),Value::Int(at),Value::Id(id.clone()),Value::Id(id.clone())]);
        assert_eq!(index_key(&table.indexes["byBucket"],&row,&id),expected);
        for rows in [&browser as &dyn Rows,&native,&memory] { rows.put("events",table,&row,None).unwrap(); }
    }
    for index in ["byBucket","byOwnerHour"] {
        for dir in [Dir::Asc,Dir::Desc] {
            let expected=native.scan("events",index,&[],&Bounds::default(),dir,100).unwrap();
            assert_eq!(browser.scan("events",index,&[],&Bounds::default(),dir,100).unwrap(),expected);
            assert_eq!(memory.scan("events",index,&[],&Bounds::default(),dir,100).unwrap(),expected);
        }
    }
    browser.rollback().unwrap();native.rollback().unwrap();
}
