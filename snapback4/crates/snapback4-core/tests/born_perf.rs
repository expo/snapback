//! Single-commit scaling regression for born-row and born-grant tracking.
//! Quiet Office M1 Max: 20k rows 7.778s before / 0.970s after; 5k grants
//! 2.301s / 0.613s. Absolute times vary with host load, so the guard is the
//! growth ratio between a commit and one four times larger: linear work grows
//! about 4x, the old quadratic scan about 16x. The functional asserts check
//! that each commit still logs its events.
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

/// Linear growth is ~4x for 4x the work; quadratic is ~16x.
const MAX_GROWTH: f64 = 9.0;

fn engine() -> Engine {
    let bound = snapback4_lang::compile(&[("born-perf.q".into(), SOURCE.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap()
}

fn logged(engine: &Engine) -> i64 {
    engine.store().conn().query_row("SELECT count(*) FROM _log", [], |r| r.get(0)).unwrap()
}

fn seed_rows(count: i64) -> Duration {
    let mut engine = engine();
    let rows: Vec<_> = (0..count).map(|n| ("rows".into(), object([
        ("id", Value::Id(format!("r{n}"))), ("n", Value::Int(n)),
    ]))).collect();
    let (before, events) = (engine.seq().unwrap(), logged(&engine));
    let start = Instant::now();
    assert_eq!(engine.seed_at(rows, 1_000).unwrap(), count as u64);
    let elapsed = start.elapsed();
    assert_eq!(engine.seq().unwrap(), before + 1);
    // Each born public row logs exactly its final image.
    assert_eq!(logged(&engine) - events, count, "{count} born rows must log {count} events");
    elapsed
}

fn seed_grants(count: i64) -> Duration {
    let mut engine = engine();
    let rows: Vec<_> = (0..count).map(|n| ("members".into(), object([
        ("id", Value::Id(format!("m{n}"))), ("group", Value::Int(n)),
        ("person", Value::Id("dev:alice".into())),
    ]))).collect();
    let before = engine.seq().unwrap();
    let start = Instant::now();
    assert_eq!(engine.seed_at(rows, 1_000).unwrap(), count as u64);
    let elapsed = start.elapsed();
    assert_eq!(engine.seq().unwrap(), before + 1);
    let tx = engine.store_mut().transaction().unwrap();
    assert_eq!(tx.membership_transitions("p:dev:alice", before).unwrap().len(), count as usize);
    elapsed
}

fn growth(small: Duration, large: Duration) -> f64 {
    large.as_secs_f64() / small.as_secs_f64().max(1e-3)
}

#[test]
fn born_rows_in_one_commit_grow_linearly() {
    let small = seed_rows(5_000);
    let large = seed_rows(20_000);
    let ratio = growth(small, large);
    println!("born rows: 5,000 in {small:?}, 20,000 in {large:?}, growth {ratio:.1}x");
    assert!(ratio < MAX_GROWTH, "4x the rows took {ratio:.1}x the time ({small:?} -> {large:?}); tracking is superlinear");
}

#[test]
fn born_grants_in_one_commit_grow_linearly() {
    let small = seed_grants(1_250);
    let large = seed_grants(5_000);
    let ratio = growth(small, large);
    println!("born grants: 1,250 in {small:?}, 5,000 in {large:?}, growth {ratio:.1}x");
    assert!(ratio < MAX_GROWTH, "4x the grants took {ratio:.1}x the time ({small:?} -> {large:?}); tracking is superlinear");
}
