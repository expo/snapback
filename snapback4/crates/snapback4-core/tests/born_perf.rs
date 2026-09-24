//! Single-commit regression bounds, measured on the Office M1 Max.
//! 20k rows: 7.778s before / 0.970s after; 5k grants: 2.301s / 0.613s.
//! Timers include append/commit; construction and result checks are outside.
use snapback4_core::{Engine, value::{Value, object}};
use std::time::{Duration, Instant};

const SOURCE: &str = r#"
table rows:
  n: int
  public 'rows'
  sync public
table members:
  group: int
  person: principal
  unique byGroupPerson: group, person
  by byPerson: person, group
  read <- .person = viewer
  sync
table messages:
  group: int
  by byGroup: group, id
  read <- exists members[.group, viewer]
  sync to members[.group]
"#;

fn engine() -> Engine {
    let bound = snapback4_lang::compile(&[("born-perf.q".into(), SOURCE.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap()
}

#[test]
fn twenty_thousand_synced_rows_in_one_commit() {
    let mut engine = engine();
    let rows: Vec<_> = (0..20_000).map(|n| ("rows".into(), object([
        ("id", Value::Id(format!("r{n}"))), ("n", Value::Int(n)),
    ]))).collect();
    let before = engine.seq().unwrap();
    let start = Instant::now();
    assert_eq!(engine.seed_at(rows, 1_000).unwrap(), 20_000);
    let elapsed = start.elapsed();
    assert_eq!(engine.seq().unwrap(), before + 1);
    println!("20,000 synced rows, one commit: {elapsed:?}");
    assert!(elapsed < Duration::from_secs(2), "20,000 rows took {elapsed:?}");
}

#[test]
fn five_thousand_grants_in_one_commit() {
    let mut engine = engine();
    let rows: Vec<_> = (0..5_000).map(|n| ("members".into(), object([
        ("id", Value::Id(format!("m{n}"))), ("group", Value::Int(n)),
        ("person", Value::Id("dev:alice".into())),
    ]))).collect();
    let before = engine.seq().unwrap();
    let start = Instant::now();
    assert_eq!(engine.seed_at(rows, 1_000).unwrap(), 5_000);
    let elapsed = start.elapsed();
    assert_eq!(engine.seq().unwrap(), before + 1);
    let tx = engine.store_mut().transaction().unwrap();
    assert_eq!(tx.membership_transitions("p:dev:alice", before).unwrap().len(), 5_000);
    println!("5,000 grants, one commit: {elapsed:?}");
    assert!(elapsed < Duration::from_millis(1_200), "5,000 grants took {elapsed:?}");
}
