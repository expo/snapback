mod common;
use common::*;
use serde_json::json;
use snapback4_core::{Value, WriteState};
const DEFAULT: &str = include_str!("../../snapback4-lang/tests/fixtures/qe2/empty-owned-default.q");
const BOUND: &str = include_str!("../../snapback4-lang/tests/fixtures/qe2/bound-insert.q");
const DISCARD: &str = include_str!("../../snapback4-lang/tests/fixtures/qe2/discarded-insert.q");
const IF_ABSENT: &str =
    include_str!("../../snapback4-lang/tests/fixtures/qe2/discarded-if-absent.q");

fn scenario<H: Host>(host: &mut H, source: &str, payload_len: usize, heap: u64) {
    let defaults = payload_len == 0;
    let bound = source == BOUND;
    let op = if defaults || bound { "add" } else { "seed" };
    let input = if defaults {
        json!({})
    } else {
        json!({"payload":"x".repeat(payload_len)})
    };
    let expected = if defaults {
        json!("r")
    } else if bound {
        json!(null)
    } else {
        json!(true)
    };
    // An unused text argument costs exactly its byte length at runner entry.
    // Padding to the production ceiling, then one byte beyond, pins the device
    // meter without exposing private successful meter totals on the wire.
    let mutation = source.split_once("mutation ").unwrap().1;
    let padded = format!(
        "{source}\nmutation {}",
        mutation
            .replacen(&format!("{op}("), "metered(probe: text <=16777216, ", 1)
            .replace(", ):", "):")
    );
    let (mut e, backend) = compile(&padded);
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
    assert_eq!(out.metered.heap_bytes, heap);
    d.withdraw(&predicted.predicted).unwrap();
    let mut padded_input = input.clone();
    for extra in [0, 1] {
        padded_input["probe"] = json!("x".repeat((16 * 1024 * 1024 - heap + extra) as usize));
        let prediction = d.predict("metered", "alice", &padded_input, 100, vec![], 0);
        if extra == 0 {
            let prediction = prediction.unwrap();
            assert_eq!(prediction.result, expected);
            d.withdraw(&prediction.predicted).unwrap();
        } else {
            assert!(
                matches!(
                    prediction,
                    Err(snapback4_core::error::RuntimeError::Bound {
                        kind: snapback4_core::error::MeterKind::HeapBytes,
                        actual: 16_777_217,
                        ceiling: 16_777_216,
                        ..
                    })
                ),
                "{prediction:?}"
            );
        }
    }
    host.close("allocation", d);
}
#[test]
fn memory_empty_default() {
    scenario(&mut Memory::new(), DEFAULT, 0, 1_621);
}
#[test]
fn sqlite_empty_default() {
    scenario(&mut Sqlite::new("qe2-empty"), DEFAULT, 0, 1_621);
}
#[test]
fn memory_discarded_quarry_insert() {
    scenario(&mut Memory::new(), DISCARD, 3_000_000, 12_000_421);
}
#[test]
fn sqlite_discarded_quarry_insert() {
    scenario(
        &mut Sqlite::new("qe2-discard"),
        DISCARD,
        3_000_000,
        12_000_421,
    );
}
#[test]
fn memory_discarded_if_absent() {
    scenario(&mut Memory::new(), IF_ABSENT, 4_000_000, 16_000_421);
}
#[test]
fn sqlite_discarded_if_absent() {
    scenario(
        &mut Sqlite::new("qe2-if-absent"),
        IF_ABSENT,
        4_000_000,
        16_000_421,
    );
}

#[test]
fn memory_bound_quarry_insert() {
    scenario(&mut Memory::new(), BOUND, 2_400_000, 14_401_017);
}
#[test]
fn sqlite_bound_quarry_insert() {
    scenario(&mut Sqlite::new("qe2-bound"), BOUND, 2_400_000, 14_401_017);
}
