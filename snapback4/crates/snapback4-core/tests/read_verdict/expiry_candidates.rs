//! Preparation boundaries cannot publish a deadline, even without an outer page.
use super::*;
use crate::rows::{MemoryRows, Rows};

fn fixture(deadline: i64) -> (Schema, MemoryRows) {
    let model = include_str!("../../../snapback4-lang/tests/read_through/lifetime.q");
    let source = format!(
        "{model}\ntable gates:\n  owner: principal\n  until: time\n  unique owner\n  expire at .until\n  read <- deny\n  insert <- allow\ntable guards:\n  owner: principal\n  unique owner\n  read <- deny\n  insert <- allow\nview totals: count children by .parent.owner\n  read <- exists gates[owner = .owner] and exists guards[owner = .owner] and viewer = 'service:allowed'\ntable docs:\n  body: text <=100\n  read <- exists gates[owner = viewer] and exists guards[owner = viewer]\n"
    );
    let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let schema: Schema =
        serde_json::from_value(serde_json::to_value(bound.schema).unwrap()).unwrap();
    let rows = MemoryRows::new();
    let id = |value: &str| Value::Id(value.into());
    let mut seed = Runner::new(
        &rows,
        &schema,
        Context::system().at(100),
        Meter::new(Ceilings::default(), Cut::Abort),
        0,
    );
    for (table, row) in [
        (
            "parents",
            object([
                ("id", id("p")),
                ("owner", id("alice")),
                ("until", Value::Null),
            ]),
        ),
        (
            "children",
            object([
                ("id", id("c")),
                ("parent", id("p")),
                ("body", Value::String("hello".into())),
                ("until", Value::Int(900)),
            ]),
        ),
        (
            "gates",
            object([
                ("id", id("g")),
                ("owner", id("alice")),
                ("until", Value::Int(deadline)),
            ]),
        ),
        ("guards", object([("id", id("g")), ("owner", id("alice"))])),
    ] {
        seed.insert(table, row.import_input(&crate::engine::ImportInput(()))).unwrap();
    }
    drop(seed);
    (schema, rows)
}

#[test]
fn uniform_prefix_deadline_is_provisional_even_when_true() {
    for deadline in [300, 500] {
        let (schema, rows) = fixture(deadline);
        for prior in [None, Some(700)] {
            for probes in [1, 2] {
                let mut runner = Runner::new(
                    &rows,
                    &schema,
                    Context::new("alice", BTreeMap::new()).at(200),
                    Meter::new(
                        Ceilings {
                            rule_probes: probes,
                            ..Ceilings::default()
                        },
                        Cut::Cap,
                    ),
                    0,
                );
                runner.next_expiry = prior.into();
                let docs = &schema.tables["docs"];
                let (allowed, pending) = runner
                    .prefix_verdict("docs", docs, &docs.indexes["byId"], &[], &docs.rules.read, true)
                    .unwrap();
                assert_eq!(allowed, probes == 2);
                assert_eq!(
                    runner.next_expiry.get(),
                    prior,
                    "a prefix verdict emits no row"
                );
                assert_eq!(runner.metered().rule_probes, 2);
                assert_eq!(runner.metered().examined, 0);
                if allowed {
                    let emission = runner.next_expiry.scope();
                    runner.next_expiry.inherit(pending);
                    emission.emit();
                    assert_eq!(runner.next_expiry.get(), Some(deadline));
                } else {
                    assert_eq!(
                        runner.meter.capped_at.as_ref().map(|cut| cut.0),
                        Some(MeterKind::RuleProbes)
                    );
                }
            }
        }
    }
}

#[test]
fn admitted_candidate_deadline_waits_for_emission() {
    for deadline in [300, 500] {
        let (schema, rows) = fixture(deadline);
        let (name, index) = schema.tables["totals"]
            .indexes
            .iter()
            .find(|(_, i)| i.columns() == vec!["owner"])
            .unwrap();
        let row = rows
            .lookup("totals", name, index, &[Value::Id("alice".into())])
            .unwrap()
            .unwrap();
        for prior in [None, Some(700)] {
            for examined in [0, 1] {
                let mut runner = Runner::new(
                    &rows,
                    &schema,
                    Context::new("service:allowed", BTreeMap::new()).at(200),
                    Meter::new(
                        Ceilings {
                            examined,
                            ..Ceilings::default()
                        },
                        Cut::Cap,
                    ),
                    0,
                );
                runner.next_expiry = prior.into();
                let candidate =
                    runner.read_candidate("totals", row.clone(), None, Default::default());
                assert_eq!(
                    runner.next_expiry.get(),
                    prior,
                    "admission and recount do not emit an answer"
                );
                assert_eq!(runner.metered().rule_probes, 2);
                assert_eq!(runner.metered().examined, 1);
                if examined == 0 {
                    assert!(matches!(
                        candidate,
                        Err(RuntimeError::Bound {
                            kind: MeterKind::Examined,
                            ..
                        })
                    ));
                    assert_eq!(
                        runner.meter.capped_at.as_ref().map(|cut| cut.0),
                        Some(MeterKind::Examined)
                    );
                } else {
                    let (row, pending) = candidate.unwrap().unwrap();
                    assert_eq!(row.field("value"), Ok(&Value::Int(1)));
                    let emission = runner.next_expiry.scope();
                    runner.next_expiry.inherit(pending);
                    emission.emit();
                    assert_eq!(runner.next_expiry.get(), Some(deadline));
                }
            }
        }
    }
}

#[test]
fn system_expiry_scan_prices_only_the_authored_range_and_live_entries() {
    fn run(expired: bool, dir: crate::rows::Dir, limit: usize, heap: u64) -> (String, crate::meter::Metered) {
        let source = "table items:\n  body: text <=400\n  until: time\n  by byBody: body, id\n  expire at .until\n  read <- allow\n  insert <- allow\n";
        let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let schema: Schema = serde_json::from_value(serde_json::to_value(bound.schema).unwrap()).unwrap();
        let rows = MemoryRows::new();
        let mut seed = Runner::new(&rows, &schema, Context::system().at(0), Meter::new(Ceilings::unbounded(), Cut::Abort), 0);
        for (id, body, until) in [("live-a", "a".into(), 500), ("live-c", "c".into(), 500), ("live-e", "e".into(), 500), ("expired-b", "b".repeat(350), 100), ("expired-d", "d".repeat(350), 100)] {
            if expired || until == 500 {
                seed.insert("items", object([("id", Value::Id(id.into())), ("body", Value::String(body)), ("until", Value::Int(until))]).import_input(&crate::engine::ImportInput(()))).unwrap();
            }
        }
        drop(seed);
        let mut runner = Runner::new(&rows, &schema, Context::system().at(200), Meter::new(Ceilings { heap_bytes: heap, ..Ceilings::unbounded() }, Cut::Abort), 0);
        let result = runner.scan_disclosed("items", "byBody", &[], &Default::default(), dir, limit)
            .map(|rows| rows.into_iter().map(|(row, key)| (row.map(|row| row.into_value()), key)).collect::<Vec<_>>());
        (format!("{result:?}"), runner.metered())
    }
    for dir in [crate::rows::Dir::Asc, crate::rows::Dir::Desc] {
        for limit in 1..=5 {
            let baseline = run(false, dir, limit, u64::MAX);
            for heap in [0, baseline.1.heap_bytes - 1, baseline.1.heap_bytes, baseline.1.heap_bytes + 1, u64::MAX] {
                assert_eq!(run(true, dir, limit, heap), run(false, dir, limit, heap), "{dir:?} limit={limit} heap={heap}");
            }
        }
    }
}
