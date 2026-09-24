//! Defaults on day two are row interpretation, on the same runner as writes.
use snapback4_core::{Context, Engine, Value, WriteState, wire};
use snapback4_core::successor::{self, Change};
use std::collections::BTreeMap;

const BEFORE: &str = "table messages:\n  body: text <=100\n  read <- allow\n  update <- allow\n  insert <- allow\n  delete <- allow\n  sync public\nquery all():\n  return messages[] first 10 by byId\n";
fn bound(source: &str) -> snapback4_lang::Bound {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b
}
fn seeded(rows: usize) -> Engine {
    let b = bound(BEFORE);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    let table = e.schema().tables["messages"].clone();
    e.seed((0..rows).map(|i| ("messages".into(), wire::row_from_json(&table, &serde_json::json!({"id": format!("m{i}"), "body": "old"})).unwrap()))).unwrap();
    e
}
fn context() -> Context { Context::new("dev:alice", BTreeMap::new()).at(1234) }

#[test]
fn literal_defaults_adopt_three_old_rows_without_writes_and_build_the_index() {
    let mut e = seeded(3);
    let source = BEFORE.replace("  body:", "  tombstone: bool default false\n  score: int default -7\n  label: text <=10 default 'old'\n  role: enum('member', 'admin') default 'member'\n  amount: decimal 2 default 125\n  optional: bool ? default true\n  by byTombstone: tombstone, id\n  body:")
        + "query live():\n  return messages[false] first 10 by byTombstone\nmutation edit():\n  update messages['m0'] {body: 'new'}\nmutation remove():\n  delete messages['m1']\n";
    let b = bound(&source);
    let steps = successor::classify(e.schema(), &b.schema);
    assert_eq!(successor::worst(&steps), Change::Additive, "{steps:?}");
    assert_eq!(steps.iter().find(|s| s.path.ends_with(".tombstone")).unwrap().message, "column messages.tombstone is added with default false; rows written before it read false");
    let images = e.store().rows("messages").unwrap();
    let seq = e.seq().unwrap();
    e.store().conn().execute_batch("CREATE TEMP TRIGGER forbid_rewrite BEFORE UPDATE ON r BEGIN SELECT RAISE(ABORT, 'adoption rewrote a row'); END;").unwrap();
    e.adopt(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    e.store().conn().execute_batch("DROP TRIGGER forbid_rewrite;").unwrap();
    assert_eq!(e.store().rows("messages").unwrap(), images);
    assert_eq!(e.seq().unwrap(), seq);
    assert!(e.stream("dev:alice", seq, 100).unwrap().events.is_empty());
    let q = e.query("live", context()).unwrap();
    assert_eq!(q.data.as_array().unwrap().len(), 3);
    assert!(q.complete);
    for row in q.data.as_array().unwrap() {
        assert_eq!(row.field("tombstone").unwrap(), &Value::Bool(false));
        assert_eq!(row.field("score").unwrap(), &Value::Int(-7));
        assert_eq!(row.field("amount").unwrap(), &Value::Int(125));
        assert_eq!(row.field("role").unwrap(), &Value::String("member".into()));
        assert_eq!(row.field("label").unwrap(), &Value::String("old".into()));
        assert_eq!(row.field("optional").unwrap(), &Value::Null);
    }
    assert!(e.snapshot("dev:alice").unwrap().0.iter().all(|event| event.data.as_ref().unwrap().field("tombstone").unwrap() == &Value::Bool(false)));
    assert!(matches!(e.mutate("edit", Some("edit"), context()).unwrap().state, WriteState::Sent { .. }));
    assert!(matches!(e.mutate("remove", Some("remove"), context()).unwrap().state, WriteState::Sent { .. }));
    assert_eq!(e.query("live", context()).unwrap().data.as_array().unwrap().len(), 2);
    println!("literal adoption: 3 old rows, 0 row rewrites, 0 partition events, 3 default-index matches; 6 literal/optional values checked per row");
}

#[test]
fn contextual_defaults_narrow_populated_tables_but_adopt_empty_ones_and_still_fill_inserts() {
    for (column, kind, default, noun, expected) in [("at", "time", "now", "clock", Value::Int(1234)), ("author", "principal", "viewer", "viewer", Value::Id("dev:alice".into()))] {
        let source = BEFORE.replace("  body:", &format!("  {column}: {kind} default {default}\n  body:"))
            + "mutation add():\n  insert messages {body: 'fresh'}\n";
        let b = bound(&source);
        for count in [3, 0] {
            let mut e = seeded(count);
            let steps = e.store_mut().successor(&b.schema).unwrap();
            let step = steps.iter().find(|s| s.path.ends_with(column)).unwrap();
            assert_eq!(step.change, if count == 0 { Change::Additive } else { Change::Narrowing });
            if count != 0 {
                assert_eq!(step.message, format!("column messages.{column} is added as required with default {default}; existing rows would read the adoption's {noun}"));
                let error = e.adopt(b.schema.clone(), b.programs.iter().map(|p| p.program.clone())).unwrap_err();
                assert_eq!(error.to_string(), step.refusal(&b.schema).to_string());
                assert_eq!(e.generation(), 1);
                println!("{error}");
            } else {
                e.adopt(b.schema.clone(), b.programs.iter().map(|p| p.program.clone())).unwrap();
                assert!(matches!(e.mutate("add", Some("add"), context()).unwrap().state, WriteState::Sent { .. }));
                assert_eq!(e.query("all", context()).unwrap().data.as_array().unwrap()[0].field(column).unwrap(), &expected);
            }
        }
    }
}

#[test]
fn a_unique_index_and_cap_see_the_materialized_default_and_narrowing_that_fits_adopts() {
    let mut e = seeded(3);
    for extra in ["  tombstone: bool default false\n  unique byTombstone: tombstone\n", "  tombstone: bool default false\n  by byTombstone: tombstone, id\n  cap 2 by tombstone\n"] {
        let b = bound(&BEFORE.replace("  body:", &format!("{extra}  body:")));
        let steps = e.store_mut().successor(&b.schema).unwrap();
        assert_eq!(successor::worst(&steps), Change::Narrowing);
        assert_eq!(e.adopt(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap_err().code(), "E_ADOPT");
    }
    let fits = bound(&BEFORE.replace("<=100", "<=3"));
    assert_eq!(successor::worst(&e.store_mut().successor(&fits.schema).unwrap()), Change::Additive);
    e.adopt(fits.schema, fits.programs.into_iter().map(|p| p.program)).unwrap();
}

#[test]
fn rules_and_residual_probe_equalities_read_literal_defaults_in_old_images() {
    let mut e = seeded(3);
    let source = BEFORE.replace("  body:", "  tombstone: bool default false\n  body:")
        .replace("  read <- allow", "  read <- .tombstone = false")
        .replace("  sync public\n", "")
        + "table receipts:\n  message: messages\n  read <- exists messages[id = .message, tombstone = false]\nquery receipt():\n  return receipts['r']\n";
    let b = bound(&source);
    e.adopt(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    let table = e.schema().tables["receipts"].clone();
    e.seed([("receipts".into(), wire::row_from_json(&table, &serde_json::json!({"id": "r", "message": "m0"})).unwrap())]).unwrap();
    assert_eq!(e.query("all", context()).unwrap().data.as_array().unwrap().len(), 3);
    assert_ne!(e.query("receipt", context()).unwrap().data, Value::Null);
    assert!(e.store().rows("messages").unwrap().iter().all(|row| row.field("tombstone").is_err()));
    let removed = bound(&source.replace(" default false", ""));
    assert_eq!(successor::worst(&e.store_mut().successor(&removed.schema).unwrap()), Change::Narrowing);
    assert_eq!(e.adopt(removed.schema, removed.programs.into_iter().map(|p| p.program)).unwrap_err().code(), "E_ADOPT");
}

#[test]
fn rule_probe_materializes_defaulted_maintain_source_groups() {
    let before = include_str!("fixtures/adoption-sum.q");
    for indexed in [true, false] {
        let b = bound(before);
        let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
        let now = snapback4_core::now_ms();
        let source = e.schema().tables["sources"].clone();
        e.seed([("sources".into(), wire::row_from_json(&source, &serde_json::json!({"id":"s", "amount":1, "until":now+60_000})).unwrap())]).unwrap();
        let index = if indexed { "  by byBucket: bucket, id\n" } else { "" };
        let after = before.replace("  amount:", &format!("  bucket: int default 0\n{index}  amount:"))
            + "maintain totals: sum sources of amount by bucket\n  read <- allow\ntable probes:\n  bucket: int\n  read <- exists totals[bucket = .bucket]\nquery probe():\n  return probes['p']\n";
        let b = bound(&after);
        e.adopt(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
        let table = e.schema().tables["probes"].clone();
        e.seed([("probes".into(), wire::row_from_json(&table, &serde_json::json!({"id":"p","bucket":0})).unwrap())]).unwrap();
        assert_ne!(e.query("probe", context().at(now)).unwrap().data, Value::Null, "indexed={indexed}: a live source admits the probe");
        assert_eq!(e.query("probe", context().at(now+60_001)).unwrap().data, Value::Null, "expired source grants nothing");
    }
}
