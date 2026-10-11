//! App-farm wave 2 (snapback4@0.4.17): rule-language friction. Every
//! rewrite these tests reach is applied mechanically and compiled again, so a
//! repair can never print a form that is itself refused (LLP 3000.036 §12).
use snapback4_core::{Context, Engine, Value, WriteState};
use snapback4_lang::{Bound, Diagnostic, compile};
use std::collections::BTreeMap;

fn bound(source: &str) -> Bound {
    compile(&[("schema.q".into(), source.into())])
}

fn clean(source: &str) -> Bound {
    let b = bound(source);
    assert!(b.diagnostics.is_empty(), "{source}\n{:#?}", b.diagnostics);
    b
}

fn first(source: &str, code: &str) -> Diagnostic {
    let b = bound(source);
    b.diagnostics.iter().find(|d| d.code == code && d.cascade_of.is_none()).unwrap_or_else(|| panic!("{code}: {:#?}", b.diagnostics)).clone()
}

fn args(pairs: &[(&str, Value)]) -> BTreeMap<String, Value> {
    pairs.iter().map(|(k, v)| ((*k).to_owned(), v.clone())).collect()
}

/// The source line a diagnostic points at, trimmed.
fn line_at(source: &str, d: &Diagnostic) -> String {
    source.lines().nth(d.site.line.saturating_sub(1) as usize).unwrap_or("").trim().to_owned()
}

/// A rewrite must never hand the author back what they wrote.
fn assert_not_identical(source: &str, d: &Diagnostic) {
    let line = line_at(source, d);
    let rewrite = d.rewrite.trim().trim_matches('`');
    assert_ne!(rewrite, line, "the rewrite repeats the source line: {d}");
    for quoted in d.rewrite.split('`').skip(1).step_by(2) {
        assert_ne!(quoted.trim(), line, "a quoted rewrite repeats the source line: {d}");
    }
}

// ---- R8: money and decimal order in insert rules ----

const TIPS: &str = "table tips:
  owner: principal
  amount: money USD
  fee: money USD
  share: decimal 3
  read <- .owner = viewer
  insert <- .owner = viewer and .amount >= 100 and .amount <= 50000 and .fee <= .amount and .share < 1000
  online only
mutation tip(amount: money USD, fee: money USD, share: decimal 3):
  return insert tips { owner: viewer, amount, fee, share }
";

#[test]
fn insert_rules_order_money_and_decimal_in_minor_units_and_the_engine_enforces_it() {
    let b = clean(TIPS);
    let capabilities = b.schema.required_capabilities();
    assert!(capabilities.contains("insert-rule-order") && capabilities.contains("insert-rule-order-units"), "{capabilities:?}");
    assert!(snapback4_core::schema::validate(&b.schema).is_empty());
    let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    let run = |engine: &mut Engine, amount: i64, fee: i64, share: i64| {
        let outcome = engine.mutate("tip", None, Context::new("alice", args(&[("amount", Value::Int(amount)), ("fee", Value::Int(fee)), ("share", Value::Int(share))]))).unwrap();
        match outcome.state { WriteState::Sent { .. } => "sent".to_owned(), WriteState::Failed { why, .. } => why.code }
    };
    assert_eq!(run(&mut engine, 100, 30, 5), "sent");
    assert_eq!(run(&mut engine, 99, 30, 5), "E_RULE");
    assert_eq!(run(&mut engine, 50001, 30, 5), "E_RULE");
    assert_eq!(run(&mut engine, 500, 501, 5), "E_RULE");
    assert_eq!(run(&mut engine, 500, 5, 1000), "E_RULE");
    // An int/time-only schema does not ask for the new capability.
    let plain = clean("table r:\n  owner: principal\n  n: int\n  read <- .owner = viewer\n  insert <- .n >= 1\n  online only\n");
    assert!(!plain.schema.required_capabilities().contains("insert-rule-order-units"));
}

#[test]
fn mismatched_ordered_insert_terms_get_a_rewrite_that_differs_from_the_source() {
    for (columns, rule, says) in [
        ("a: money USD\n  b: money EUR", ".a <= .b", "its own type"),
        ("a: money USD\n  b: int", ".a <= .b", "one type"),
        ("a: decimal 2\n  b: decimal 3", ".a < .b", "its own type"),
        ("a: time\n  b: int", ".a <= .b", "one type"),
        ("a: text\n  b: int", ".a <= 3", "its own type"),
        ("a: bool\n  b: int", ".b <= .a", "its own type"),
    ] {
        let source = format!("table t:\n  owner: principal\n  {columns}\n  read <- .owner = viewer\n  insert <- {rule}\n  online only\n");
        let d = first(&source, "E_QUARRY_TYPE");
        assert!(d.rewrite.contains(says), "{rule}: {d}");
        assert!(!d.rewrite.contains("or a column with an integer literal"), "{rule}: {d}");
        assert_not_identical(&source, &d);
    }
}

#[test]
fn the_core_refuses_ordered_insert_columns_of_two_types() {
    use snapback4_core::schema::{RuleExpr, RuleTerm, validate};
    let b = clean("table t:\n  owner: principal\n  a: money USD\n  b: money EUR\n  read <- .owner = viewer\n  insert <- .a >= 1\n  online only\n");
    let mut schema = b.schema.clone();
    schema.tables.get_mut("t").unwrap().rules.insert = RuleExpr::Compare(snapback4_core::ir::BinaryOp::Gte, RuleTerm::Field("a".into()), RuleTerm::Field("b".into()));
    assert!(validate(&schema).iter().any(|issue| issue.message.contains("ordered comparisons")), "{:?}", validate(&schema));
}

