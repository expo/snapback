//! Quarry-source allocation and per-occurrence rule-hop prices on both runners.
use super::runner::Runner;
use crate::{
    Ceilings, Context, Schema, Value,
    ir::Program,
    meter::{Cut, Meter, Metered},
    rows::{MemoryRows, Rows},
    value::object,
};

fn run(source: &str, name: &str, device: bool) -> (Value, Metered) {
    run_args(source, name, device, Default::default())
}

fn run_args(
    source: &str,
    name: &str,
    device: bool,
    args: std::collections::BTreeMap<String, Value>,
) -> (Value, Metered) {
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    // The language dev-dependency links its own core instance in unit tests.
    let schema: Schema =
        crate::json_codec::from_text(&crate::json_codec::to_text(&bound.schema).unwrap()).unwrap();
    let program: Program = crate::json_codec::from_text(
        &crate::json_codec::to_text(
            &bound
                .programs
                .iter()
                .find(|p| p.program.name == name)
                .unwrap()
                .program,
        )
        .unwrap(),
    )
    .unwrap();
    let rows = MemoryRows::default();
    if let Some(parent) = schema.tables.get("parents") {
        rows.put(
            "parents",
            parent,
            &object([
                ("id", Value::Id("p".into())),
                ("owner", Value::Id("alice".into())),
                ("value", Value::Int(1)),
            ]),
            None,
        )
        .unwrap();
    }
    let mut runner = Runner::new(
        &rows,
        &schema,
        Context::new("alice", args).at(100),
        Meter::new(Ceilings::default(), Cut::Abort),
        0,
    );
    runner.device = device;
    if device {
        runner.device_allowance = Some(Meter::new(Ceilings::default(), Cut::Abort));
    }
    let result = runner.run(&program).unwrap();
    assert!(runner.charge_output(&result).unwrap());
    assert!(runner.missing_fact.is_none());
    (result, runner.meter.used)
}

#[test]
fn known_default_price_is_independent_of_declared_maximum() {
    let source = include_str!("../../../snapback4-lang/tests/fixtures/qe2/empty-owned-default.q");
    for default in ["", "café"] {
        let source = source.replace("default ''", &format!("default '{default}'"));
        let small = source.replace("5000000", "10");
        let mut results = vec![];
        for device in [false, true] {
            let large_result = run(&source, "add", device);
            assert_eq!(large_result, run(&small, "add", device));
            assert!(large_result.1.heap_bytes < 4096);
            if default.is_empty() {
                assert_eq!(large_result.1.heap_bytes, 1_621);
            }
            results.push(large_result);
        }
        assert_eq!(results[0], results[1]);
    }
}

#[test]
fn bound_result_and_sibling_hops_have_equal_server_device_prices() {
    let source = include_str!("../../../snapback4-lang/tests/fixtures/qe2/result-cost.q");
    for probes in [1, 2] {
        let source = if probes == 2 {
            source.replace(
                ".parent.value = 1",
                ".parent.value = 1 and .parent.owner = viewer",
            )
        } else {
            source.into()
        };
        for name in ["bound", "discarded"] {
            let server = run(&source, name, false);
            assert_eq!(server, run(&source, name, true));
            assert_eq!(server.1.rule_probes, probes);
            // These measured prices are quoted in guide writes.
            assert_eq!(
                (server.1.heap_bytes, server.1.steps, server.1.output_bytes),
                if name == "bound" {
                    (2316, 20, 70)
                } else {
                    (926, 12, 13)
                }
            );
            assert_eq!(
                server.0,
                if name == "bound" {
                    object([
                        ("photo", Value::Null),
                        ("edited", Value::Bool(false)),
                        ("label", Value::String("".into())),
                    ])
                } else {
                    Value::Bool(true)
                }
            );
            eprintln!("{name}, {probes} hop(s): {:?}", server.1);
        }
    }
}

#[test]
fn inlined_helper_and_branch_keep_the_consumed_insert_result() {
    let source = "table records:\n  note: text <=10 ?\n  public\n  insert <- allow\n  sync public\nfn label(note: text ?): note ?? 'empty'\nmutation add():\n  r = insert records { id: 'r' }\n  if viewer != null:\n    return label(r.note)\n  return 'other'\n";
    for device in [false, true] {
        assert_eq!(run(source, "add", device).0, Value::String("empty".into()));
    }
}

#[test]
fn consumed_if_absent_result_is_still_completed() {
    let source = "table records:\n  note: text <=10 ?\n  public\n  insert <- allow\n  sync public\nmutation add():\n  r = insert records { id: 'r' } if absent\n  require r != null else NOT_FOUND\n  return r.note\n";
    for device in [false, true] {
        assert_eq!(run(source, "add", device).0, Value::Null);
    }
}

#[test]
fn bound_large_insert_charges_each_result_byte_once() {
    let source = include_str!("../../../snapback4-lang/tests/fixtures/qe2/bound-insert.q");
    for device in [false, true] {
        let (result, metered) = run_args(
            source,
            "add",
            device,
            [("payload".into(), Value::String("x".repeat(2_400_000)))].into(),
        );
        assert_eq!(result, Value::Null, "the omitted field is completed");
        assert_eq!(metered.heap_bytes, 14_401_017);
    }
}
