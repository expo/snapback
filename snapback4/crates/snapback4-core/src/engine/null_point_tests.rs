//! NL/QE2 integration: expiry traversal may evaluate a logically guarded key.
use super::{runner::Runner, read::RuleProbe, rules};
use crate::{Context, Schema, Value, meter::{Ceilings, Cut, Meter}, rows::{MemoryRows, Rows}, value::object};

const SOURCE: &str = include_str!("../../../snapback4-device/tests/nl_qe2_integration/null-rule.q");

#[test]
fn runtime_null_points_cover_each_composite_position_and_created_facts() {
    for arity in 1..=3 {
        let names = & ["low", "middle", "high"][..arity];
        let source = format!("table keys:\n{}  unique byKey: {}\n  public\n  online only\n",
            names.iter().map(|name| format!("  {name}: principal ?\n")).collect::<String>(), names.join(", "));
        let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let schema: Schema = crate::json_codec::from_text(&crate::json_codec::to_text(&bound.schema).unwrap()).unwrap();
        for device in [false, true] {
            for position in 0..arity {
                let rows = MemoryRows::default();
                let mut key = vec![Value::Id("alice".into()); arity];
                key[position] = Value::Null;
                for id in ["a", "b"] {
                    rows.put("keys", &schema.tables["keys"], &object(std::iter::once(("id", Value::Id(id.into())))
                        .chain(names.iter().copied().zip(key.iter().cloned()))), None).unwrap();
                }
                let mut runner = Runner::new(&rows, &schema, Context::new("alice", Default::default()), Meter::new(Ceilings::default(), Cut::Cap), 0);
                runner.device = device;
                runner.created.insert(("keys".into(), "byKey".into(), crate::value::canonical_json(&key)), 1);
                assert!(!runner.created("keys", "byKey", &key));
                let read = crate::ir::Read { site: "null-point".into(), table: "keys".into(), index: "byKey".into(), key: key.iter().cloned().map(crate::ir::Expr::Literal).collect(), provenance: crate::ir::KeyProvenance::Const };
                assert_eq!(runner.expr(&crate::ir::Expr::Get(read.clone())).unwrap(), Value::Null);
                assert_eq!(runner.expr(&crate::ir::Expr::Exists(read)).unwrap(), Value::Bool(false));
                assert_eq!((runner.meter.used.examined, runner.meter.used.index_entries), (0, 0));
                assert!(runner.missing_fact.is_none());
                assert_eq!(runner.next_expiry.get(), None);
            }
        }
    }
}

#[test]
fn reference_guard_preserves_nonnull_rule_prices_and_lifetimes() {
    for (guard, conjunction) in [
        (".parent.key = null or", false),
        (".parent.key != null and", true),
        ("not (.parent.key = null) and", true),
    ] {
        let source = SOURCE.replace(".parent.key = null or", guard);
        let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let schema: Schema = crate::json_codec::from_text(&crate::json_codec::to_text(&bound.schema).unwrap()).unwrap();
        for device in [false, true] {
            for key in [Value::Null, Value::Id("alice".into()), Value::Id("missing".into())] {
                for until in [Value::Null, Value::Int(2000), Value::Int(500)] {
                    let rows = MemoryRows::default();
                    rows.put("parents", &schema.tables["parents"], &object([
                        ("id", Value::Id("p".into())), ("key", key.clone()), ("until", Value::Int(3000)),
                    ]), None).unwrap();
                    rows.put("keys", &schema.tables["keys"], &object([
                        ("id", Value::Id("w".into())), ("key", Value::Id("alice".into())), ("until", until.clone()),
                    ]), None).unwrap();
                    let mut runner = Runner::new(&rows, &schema, Context::new("alice", Default::default()).at(1000), Meter::new(Ceilings::default(), Cut::Abort), 0);
                    runner.device = device;
                    if device { runner.device_allowance = Some(Meter::new(Ceilings::default(), Cut::Abort)); }
                    let rule = &schema.tables["children"].rules.insert;
                    let child = object([("id", Value::Id("c".into())), ("parent", Value::Id("p".into()))]);
                    let scope = runner.next_expiry.scope();
                    let answer = runner.authorized_scratch(0, &[(crate::error::MeterKind::RuleProbes, rules::rule_probes(rule))], |runner, allowance|
                        rules::evaluate(rule, "alice", None, &child, true, &mut RuleProbe { runner, allowance })).unwrap();
                    scope.emit();
                    let present = key == Value::Id("alice".into()) && until != Value::Int(500);
                    assert_eq!(answer, present || (!conjunction && key == Value::Null));
                    let expiry = if present { Some(if until == Value::Int(2000) { 2000 } else { 3000 }) }
                        else if answer { Some(3000) } else { None };
                    assert_eq!(runner.next_expiry.get(), expiry, "{guard}/{device}/{key:?}/{until:?}");
                    // Pinned on the unmodified merged runtime: both reference
                    // occurrences and the exists leaf pay the full static rule.
                    assert_eq!(runner.meter.used, crate::meter::Metered { rule_probes: 3, ..Default::default() });
                }
            }
        }
    }
}
