mod common;
use common::*;
use serde_json::json;
use snapback4_core::{Value, WriteState};
const DEFAULT: &str = include_str!("../../snapback4-lang/tests/fixtures/qe2/empty-owned-default.q");
const DISCARD: &str = include_str!("../../snapback4-lang/tests/fixtures/qe2/discarded-insert.q");
const IF_ABSENT: &str = include_str!("../../snapback4-lang/tests/fixtures/qe2/discarded-if-absent.q");

fn scenario<H: Host>(host: &mut H, source: &str, payload_len: usize) {
    let defaults = payload_len == 0;
    let op = if defaults { "add" } else { "seed" };
    let input = if defaults {
        json!({})
    } else {
        json!({"payload":"x".repeat(payload_len)})
    };
    let expected = if defaults { json!("r") } else { json!(true) };
    let (mut e, backend) = compile(source);
    let pages = snapshot_pages(&mut e, "alice", 100);
    let mut d = host.open("allocation", Some(backend)).unwrap();
    for (i, p) in pages.iter().enumerate() {
        d.apply(p, i == 0).unwrap();
    }
    let predicted = d.predict(op, "alice", &input, 100, vec![], 0).unwrap();
    assert_eq!(predicted.result, expected);
    let args = if defaults {
        vec![]
    } else {
        vec![("payload", Value::String("x".repeat(payload_len)))]
    };
    let out = e.mutate(op, None, context("alice", &args).at(100)).unwrap();
    assert!(matches!(&out.state, WriteState::Sent { .. }), "{out:?}");
    eprintln!("{} {op}: {:?}", host.label(), out.metered);
    // The known empty value, not its declared maximum, controls allocation.
    assert!(out.metered.heap_bytes <= if defaults { 4096 } else { 4 * payload_len as u64 + 1000 });
    host.close("allocation", d);
}
#[test]
fn memory_empty_default() {
    scenario(&mut Memory::new(), DEFAULT, 0);
}
#[test]
fn sqlite_empty_default() {
    scenario(&mut Sqlite::new("qe2-empty"), DEFAULT, 0);
}
#[test]
fn memory_discarded_quarry_insert() {
    scenario(&mut Memory::new(), DISCARD, 3_000_000);
}
#[test]
fn sqlite_discarded_quarry_insert() {
    scenario(&mut Sqlite::new("qe2-discard"), DISCARD, 3_000_000);
}
#[test]
fn memory_discarded_if_absent() {
    scenario(&mut Memory::new(), IF_ABSENT, 4_000_000);
}
#[test]
fn sqlite_discarded_if_absent() {
    scenario(&mut Sqlite::new("qe2-if-absent"), IF_ABSENT, 4_000_000);
}
