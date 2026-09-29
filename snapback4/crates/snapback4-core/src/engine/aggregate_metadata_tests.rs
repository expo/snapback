//! Exercise server reply metadata directly over the native in-memory row adapter.
use super::runner::Runner;
use crate::{
    Context, Program, Schema, Value,
    meter::{Ceilings, Cut, Meter},
    rows::MemoryRows,
    value::object,
};

const MODEL: &str = include_str!("../../../snapback4-lang/tests/read_through/lifetime.q");
fn compile(source: &str) -> (Schema, Program) {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    // The compiler's dependency is a separate build of this crate.
    let schema = serde_json::from_value(serde_json::to_value(b.schema).unwrap()).unwrap();
    let program = b
        .programs
        .into_iter()
        .find(|p| p.program.name == "total")
        .unwrap()
        .program;
    (
        schema,
        serde_json::from_value(serde_json::to_value(program).unwrap()).unwrap(),
    )
}
fn id(s: &str) -> Value {
    Value::Id(s.into())
}
fn seed(rows: &MemoryRows, schema: &Schema, child: Option<i64>, gate: Option<i64>) {
    let mut r = Runner::new(
        rows,
        schema,
        Context::system().at(100),
        Meter::new(Ceilings::default(), Cut::Abort),
        0,
    );
    r.insert(
        "parents",
        object([
            ("id", id("p")),
            ("owner", id("alice")),
            ("until", Value::Null),
        ]).import_input(&crate::engine::ImportInput(())))
    .unwrap();
    if let Some(until) = child {
        r.insert(
            "children",
            object([
                ("id", id("c")),
                ("parent", id("p")),
                ("body", Value::String("hello".into())),
                ("until", Value::Int(until)),
            ]).import_input(&crate::engine::ImportInput(())))
        .unwrap();
    }
    if let Some(until) = gate {
        r.insert(
            "gates",
            object([
                ("id", id("g")),
                ("parent", id("p")),
                ("until", Value::Int(until)),
            ]).import_input(&crate::engine::ImportInput(())))
        .unwrap();
    }
}
fn reader<'a>(rows: &'a MemoryRows, schema: &'a Schema) -> Runner<'a> {
    Runner::new(
        rows,
        schema,
        Context::new("bob", [("p".into(), id("p"))].into()).at(200),
        Meter::new(Ceilings::default(), Cut::Cap),
        0,
    )
}

#[test]
fn memory_aggregate_point_and_raw_probe_dependencies_are_constant() {
    for denied in [false, true] {
        let rule = if denied {
            ".parent != .parent"
        } else {
            ".parent = .parent"
        };
        let (schema, program) = compile(&format!(
            "{MODEL}\nview totals: count children by .parent\n  read <- {rule}\nquery total(p: parents):\n  return totals[p]\n"
        ));
        let index = schema.tables["totals"]
            .indexes
            .iter()
            .find(|(_, i)| i.columns() == vec!["parent"])
            .unwrap()
            .0;
        for child in [None, Some(150), Some(300)] {
            let rows = MemoryRows::new();
            seed(&rows, &schema, child, None);
            let mut r = reader(&rows, &schema);
            let data = r.run(&program).unwrap();
            assert!(!r.query_unavailable && r.meter.capped_at.is_none());
            assert_eq!(
                data,
                if denied {
                    Value::Null
                } else {
                    Value::Int(i64::from(child == Some(300)))
                }
            );
            assert_eq!(
                r.read_tables.iter().map(String::as_str).collect::<Vec<_>>(),
                vec!["children", "parents", "totals"]
            );
            // No rule_dependencies call: probe_witness itself owns the source dependency.
            let mut r = reader(&rows, &schema);
            assert_eq!(
                r.authorized_scan(&[], |r, scope| r.probe_witness(scope, "totals", index, &[id("p")], &[], false))
                    .unwrap(),
                (child == Some(300), true)
            );
            assert_eq!(
                r.read_tables.iter().map(String::as_str).collect::<Vec<_>>(),
                vec!["children", "totals"]
            );
        }
    }
}

#[test]
fn memory_denied_aggregate_restores_probe_expiry() {
    for synthetic in [false, true] {
        let model = if synthetic {
            MODEL.to_owned()
        } else {
            MODEL.replace("  expire at .until\n", "")
        };
        let value_rule = if synthetic { "" } else { " and .value != 2" };
        let (schema, program) = compile(&format!(
            "{model}\ntable gates:\n  parent: parents\n  until: time\n  unique parent\n  expire at .until\n  read <- deny\n  insert <- allow\nview totals: count children by .parent\n  read <- exists gates[parent = .parent] and viewer = 'service:allowed'{value_rule}\nquery total(p: parents):\n  return totals[p]\n"
        ));
        for prior in [None, Some(700)] {
            let mut results = Vec::new();
            for gate in [None, Some(300), Some(500)] {
                let rows = MemoryRows::new();
                seed(&rows, &schema, Some(900), gate);
                let mut r = reader(&rows, &schema);
                r.next_expiry = prior.into();
                let data = r.run(&program).unwrap();
                assert_eq!(data, Value::Null);
                assert_eq!(r.next_expiry.get(), prior);
                assert!(!r.query_unavailable && r.meter.capped_at.is_none());
                results.push((r.metered(), r.read_tables));
            }
            for pair in results.windows(2) {
                assert_eq!(pair[0], pair[1]);
            }
        }
    }
}

#[test]
fn memory_inherited_only_aggregate_dependencies() {
    let (schema, program) = compile(include_str!(
        "../../../snapback4-lang/tests/read_through/inherited_deadline.q"
    ));
    for name in ["middles", "children"] {
        assert!(schema.tables[name].expire.is_none());
        assert!(schema.tables[name].is_expiring());
    }
    let index = schema.tables["totals"]
        .indexes
        .iter()
        .find(|(_, i)| i.columns() == vec!["middle"])
        .unwrap()
        .0;
    for deadline in [150, 300] {
        for occupied in [false, true] {
            let rows = MemoryRows::new();
            let mut seed = Runner::new(
                &rows,
                &schema,
                Context::system().at(100),
                Meter::new(Ceilings::default(), Cut::Abort),
                0,
            );
            seed.insert(
                "roots",
                object([
                    ("id", id("r")),
                    ("owner", id("alice")),
                    ("until", Value::Int(deadline)),
                ]).import_input(&crate::engine::ImportInput(())))
            .unwrap();
            seed.insert("middles", object([("id", id("m")), ("root", id("r"))]).import_input(&crate::engine::ImportInput(())))
                .unwrap();
            if occupied {
                seed.insert("children", object([("id", id("c")), ("middle", id("m"))]).import_input(&crate::engine::ImportInput(())))
                    .unwrap();
            }
            drop(seed);
            let mut r = reader(&rows, &schema);
            assert_eq!(
                r.run(&program).unwrap(),
                Value::Int(i64::from(occupied && deadline > 200))
            );
            assert!(!r.query_unavailable && r.meter.capped_at.is_none());
            assert_eq!(
                r.read_tables.iter().map(String::as_str).collect::<Vec<_>>(),
                vec!["children", "middles", "roots", "totals"]
            );
            let mut r = reader(&rows, &schema);
            assert_eq!(
                r.authorized_scan(&[], |r, scope| r.probe_witness(scope, "totals", index, &[id("m")], &[], false))
                    .unwrap(),
                (occupied && deadline > 200, true)
            );
            assert_eq!(
                r.read_tables.iter().map(String::as_str).collect::<Vec<_>>(),
                vec!["children", "totals"]
            );
        }
    }
}
