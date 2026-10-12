//! Wave 8 app-farm defects: precise repairs and runtime/check completeness.
use snapback4_lang::{Bound, compile};
use snapback4_core::{Context, Engine, Value, store::Store, value::object};

fn bound(source: &str) -> Bound { compile(&[("schema.q".into(), source.into())]) }
fn clean(source: &str) -> Bound {
    let b = bound(source); assert!(b.diagnostics.is_empty(), "{:#?}", b.diagnostics); b
}
const PARENT: &str = "table parents:\n  owner: principal\n  immutable owner\n  read <- .owner = viewer\n  online only\ntable children:\n  parent: parents\n  author: principal\n  immutable parent, author\n  read <- .author = viewer or exists parents[.parent, owner = viewer]\n  online only\n";

#[test]
fn pinned_parent_pages_have_a_conditional_verdict_and_agree_with_runtime() {
    let b = clean(&format!("{PARENT}query history(parent: parents, c: cursor ?):\n  return children where .parent = parent first 50 by .id after c\n"));
    assert!(!b.notes.iter().any(|n| n.code == "N_NEVER_COMPLETE"), "{:?}", b.notes);
    let note = b.notes.iter().find(|n| n.code == "N_CONDITIONAL_COMPLETE").unwrap();
    assert!(note.message.contains("complete") && note.message.contains("pinned"), "{note}");
    let mut engine = Engine::new(Store::memory().unwrap(), b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed_at([
        ("parents".into(), object([("id", Value::Id("p".into())), ("owner", Value::Id("owner".into()))])),
        ("children".into(), object([("id", Value::Id("c1".into())), ("parent", Value::Id("p".into())), ("author", Value::Id("author".into()))])),
        ("children".into(), object([("id", Value::Id("c2".into())), ("parent", Value::Id("p".into())), ("author", Value::Id("other".into()))])),
    ], 1).unwrap();
    for (viewer, complete, length) in [("owner", true, 2), ("author", false, 1), ("stranger", false, 0)] {
        let read = engine.query("history", Context::new(viewer, [("parent".into(), Value::Id("p".into())), ("c".into(), Value::Null)].into()).at(2)).unwrap();
        assert_eq!(read.complete, complete, "{viewer}");
        let Value::Array(rows) = read.data else { panic!("not a page") }; assert_eq!(rows.len(), length);
    }
}

#[test]
fn keyed_parent_guard_is_followed_but_a_copied_owner_alone_is_not() {
    let b = clean(&format!("{PARENT}query history(parent: parents, c: cursor ?):\n  p = parents[parent] ! else NOT_FOUND\n  require exists parents[parent, owner = viewer] else FORBIDDEN\n  return children where .parent = parent first 50 by .id after c\n"));
    assert!(!b.notes.iter().any(|n| matches!(n.code.as_str(), "N_NEVER_COMPLETE" | "N_CONDITIONAL_COMPLETE")), "{:?}", b.notes);
    let copied = PARENT.replace(".author = viewer or exists parents[.parent, owner = viewer]", ".author = viewer");
    let b = clean(&format!("{copied}query history(parent: parents, c: cursor ?):\n  p = parents[parent] ! else NOT_FOUND\n  return children where .parent = parent first 50 by .id after c\n"));
    assert!(b.notes.iter().any(|n| n.code == "N_NEVER_COMPLETE" && n.rewrite.contains("require exists parents[parent, owner = viewer]")), "{:?}", b.notes);
}

#[test]
fn cap_calendar_and_else_errors_name_the_actual_limits() {
    for (cap, words) in [("cap 4 by owner, day(at)", "stored columns"), ("cap 1 else FULL", "E_CONSTRAINT"), ("cap 1 by owner else FULL", "E_CONSTRAINT")] {
        let b = bound(&format!("table rows:\n  owner: principal\n  at: time\n  {cap}\n"));
        let d = b.diagnostics.iter().find(|d| d.code == "E_QUARRY_SYNTAX").unwrap();
        assert!(d.message.contains(words), "{d}"); assert_eq!(d.guide, "recipes");
    }
}

#[test]
fn positional_principal_rule_hop_repairs_keep_the_unique_principal_key() {
    let b = bound("table alumni:\n  principal: principal\n  classYear: int\n  unique principal\n  read <- .principal = viewer\ntable gifts:\n  amount: int\n  insert <- alumni[viewer].classYear > 2000\n");
    let d = b.diagnostics.iter().find(|d| d.code == "E_QUARRY_RULE_HOP").unwrap();
    assert!(d.rewrite.contains("alumni[principal = viewer]"), "{d}");
    clean(&format!("table alumni:\n  principal: principal\n  classYear: int\n  unique principal\n  read <- .principal = viewer\nmutation give():\n  {}\n  return true\n", d.rewrite.replace('\n', "\n  ")));
}

#[test]
fn redundant_reference_group_rule_has_its_own_diagnostic() {
    let b = bound("table parents:\n  owner: principal\n  immutable owner\n  read <- .owner = viewer\ntable children:\n  parent: parents\n  immutable parent\n  read through .parent\nview total: count children by .parent\n  read <- .parent.owner = viewer\n");
    assert!(b.diagnostics.iter().any(|d| d.code == "E_REDUNDANT_RULE" && d.message.contains("omit the entire read line")), "{:?}", b.diagnostics);
}

#[test]
fn calendar_numbers_are_not_time_fields_and_sum_spelling_is_precise() {
    for value in ["day(now)", "d"] {
        let source = format!("table rows:\n  at: time\n  public 'time units'\n  insert <- allow\nmutation add():\n  d = day(now)\n  return insert rows {{ at: {value} }}\n");
        let b = bound(&source);
        assert!(b.diagnostics.iter().any(|d| d.code == "E_QUARRY_TYPE" && d.message.contains("period number") && d.rewrite.contains("day(now) * 1d")), "{:?}", b.diagnostics);
        clean(&source.replace(&format!("at: {value}"), "at: day(now) * 1d"));
    }
    clean("table rows:\n  at: time\n  public 'time units'\n  insert <- allow\nmutation add():\n  d = day(now)\n  d = d * 1d\n  return insert rows { at: d }\n");
    let b = bound("table rows:\n  amount: int\n  owner: principal\nview total: sum rows.amount by .owner\n");
    assert!(b.diagnostics.iter().any(|d| d.code == "E_QUARRY_SYNTAX" && d.rewrite == "view total: sum rows of .amount by .group" && d.guide == "totals"), "{:?}", b.diagnostics);
}
