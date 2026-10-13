use snapback4_core::{Engine, RuntimeError, Store, Value, error::MeterKind, value::object};
use std::collections::BTreeSet;

const SOURCE: &str = "table members:
  group: text <=8
  principal: principal
  opensAt: time
  unique group, principal
  cap 1 by group
  by byOpening: opensAt
  read <- .principal = viewer
  not before .opensAt
  sync
table documents:
  group: text <=8
  body: text <=8
  read <- exists members[.group, viewer]
  sync
";

fn loaded(count: usize) -> (Engine, i64, u64) {
    let bound = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
    assert!(bound.diagnostics.is_empty(), "{:#?}", bound.diagnostics);
    let start = snapback4_core::now_ms();
    let opening = start + 1_000_000;
    let mut engine = Engine::new_at(Store::memory().unwrap(), bound.schema,
        bound.programs.into_iter().map(|program| program.program), start).unwrap();
    let mut rows = Vec::with_capacity(count + 1);
    for n in 0..count {
        rows.push(("documents".into(), object([
            ("id", Value::Id(format!("d{n:05}"))),
            ("group", Value::String("g".into())),
            ("body", Value::String("x".into())),
        ])));
    }
    rows.push(("members".into(), object([
        ("id", Value::Id("m".into())),
        ("group", Value::String("g".into())),
        ("principal", Value::Id("alice".into())),
        ("opensAt", Value::Int(opening)),
    ])));
    engine.load(rows).unwrap();
    let (before, watermark) = engine.snapshot_at("alice", opening - 1).unwrap();
    assert!(before.is_empty());
    (engine, opening, watermark)
}

#[test]
fn bounded_batches_deliver_each_row_once() {
    let count = 130;
    let (mut engine, opening, watermark) = loaded(count);
    let page = engine.stream_at("alice", watermark, 1, opening).unwrap();
    let ids: BTreeSet<_> = page.events.into_iter()
        .filter(|event| event.table == "documents")
        .map(|event| event.id)
        .collect();
    assert_eq!(ids.len(), count);
}

// @ref LLP 3000.036.002#5 — an indivisible join acquisition refuses before retaining an unbounded group; snapshots page the same rows.
#[test]
fn an_oversized_join_refuses_at_the_row_bound_then_recovers_by_snapshot() {
    let count = 8_193;
    let (mut engine, opening, watermark) = loaded(count);
    let error = engine.stream_at("alice", watermark, 1, opening).unwrap_err();
    assert!(matches!(error, RuntimeError::Bound {
        kind: MeterKind::Examined, actual: 8193, ceiling: 8192, ..
    }), "{error}");

    let mut after = None;
    let mut ids = BTreeSet::new();
    loop {
        let page = engine.snapshot_acquisition_page_at("alice", after.as_deref(), 1_000, opening).unwrap();
        for event in page.events.into_iter().filter(|event| event.table == "documents") {
            assert!(ids.insert(event.id), "snapshot duplicated a document");
        }
        match page.next {
            Some(next) => after = Some(next.encode()),
            None => break,
        }
    }
    assert_eq!(ids.len(), count);
}
