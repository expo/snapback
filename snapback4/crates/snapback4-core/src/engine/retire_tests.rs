//! A commit's retirement of the rows it inserted already expired
//! (`Runner::retire_expired_births`).
use super::runner::Runner;
use crate::{Context, Store, Value, meter::{Ceilings, Cut, Meter}, schema::Schema, value::object};

const SCHEMA: &str = "table members:
  group: text <=10
  person: principal
  until: time ?
  unique byGroupPerson: group, person
  by byExpiry: until
  expire at .until
  read <- .person = viewer
  insert <- exists members[.group, viewer]
  sync to .person
table notes:
  group: text <=10
  by byGroup: group, id
  read <- exists members[.group, viewer]
  insert <- allow
  sync to members[.group]
";

/// Each retirement asks whether its audience key keeps a live row. Removing
/// expired rows cannot change the answer, so the key is scanned once, not
/// once per sibling: the work stays linear in the rows retired.
#[test]
fn retiring_expired_siblings_scans_their_key_once() {
    let bound = snapback4_lang::compile(&[("schema.q".into(), SCHEMA.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    // The compiler links its own build of this crate: cross by the wire.
    let schema: Schema = serde_json::from_value(serde_json::to_value(&bound.schema).unwrap()).unwrap();
    let mut store = Store::memory().unwrap();
    store.install(&schema).unwrap();
    let tx = store.transaction().unwrap();
    let mut runner = Runner::new(&tx, &schema, Context::system().at(150), Meter::new(Ceilings::unbounded(), Cut::Abort), 0);
    let n = 200_u64;
    let ids: Vec<String> = (0..n).map(|i| format!("m{i:03}")).collect();
    for id in &ids {
        let row = object([("id", Value::Id(id.clone())), ("group", Value::String("g".into())), ("person", Value::Id("dev:alice".into())), ("until", Value::Int(100))]);
        runner.insert("members", row).unwrap();
    }
    let work = runner.retire_expired_births().unwrap();
    assert!(work.examined <= 2 * n, "{work:?}");
    assert!(ids.iter().all(|id| tx.get("members", id).unwrap().is_none()));
    assert!(runner.events.take().is_empty());
}

#[test]
fn retired_birth_releases_table_and_group_occupancy_in_memory_rows() {
    use crate::rows::{MemoryRows, Rows};
    let bound = snapback4_lang::compile(&[("caps.q".into(), include_str!("../../tests/fixtures/expired-birth-cap.q").into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let schema: Schema = serde_json::from_value(serde_json::to_value(&bound.schema).unwrap()).unwrap();
    let rows = MemoryRows::new();
    let row = |id: &str, until| object([("id", Value::Id(id.into())), ("group", Value::String("a".into())), ("until", until)]);
    let check = |expected| {
        assert_eq!(rows.cap_count("items", &[], &[]).unwrap(), expected);
        assert_eq!(rows.cap_count("items", &["group".into()], &[Value::String("a".into())]).unwrap(), expected);
    };
    {
        let mut runner = Runner::new(&rows, &schema, Context::system().at(100), Meter::new(Ceilings::default(), Cut::Abort), 0);
        runner.insert("items", row("born", Value::Int(0))).unwrap();
        check(1); // Capacity is physical, even before this birth is retired.
        runner.retire_expired_births().unwrap();
        assert!(runner.events.take().is_empty());
    }
    check(0);
    assert!(rows.get("items", "born").unwrap().is_none());
    let mut next = Runner::new(&rows, &schema, Context::system().at(100), Meter::new(Ceilings::default(), Cut::Abort), 0);
    next.insert("items", row("live", Value::Null)).unwrap();
    next.retire_expired_births().unwrap();
    check(1);
    assert!(rows.get("items", "live").unwrap().is_some());
}
