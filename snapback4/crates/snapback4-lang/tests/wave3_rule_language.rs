//! App-farm wave 3 (snapback4@0.4.18): rule-language friction (LLP 3000.036
//! §13). Each test pins `check` against the engine on the lanes' own shapes,
//! and every rewrite a test reaches is applied and compiled again.
use snapback4_core::{Context, Engine, Value};
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

#[allow(dead_code)]
fn first(source: &str, code: &str) -> Diagnostic {
    let b = bound(source);
    b.diagnostics.iter().find(|d| d.code == code && d.cascade_of.is_none()).unwrap_or_else(|| panic!("{code}: {:#?}", b.diagnostics)).clone()
}

fn note<'a>(b: &'a Bound, code: &str) -> Option<&'a Diagnostic> {
    b.notes.iter().find(|n| n.code == code)
}

fn args(pairs: &[(&str, Value)]) -> BTreeMap<String, Value> {
    pairs.iter().map(|(k, v)| ((*k).to_owned(), v.clone())).collect()
}

// ---- #3a: a guarded staff branch is complete, and `check` says so ----

/// Lanes 027 035 054 061 062 068 077 093 095: a read rule `owner or grant`,
/// and one query whose unpinned scan only grant holders reach.
fn desk(grant: &str, query: &str) -> String {
    format!("table staff:
  principal: principal
  role: text
  unique principal
  read <- .principal = viewer
  online only
table items:
  owner: principal
  at: int
  read <- .owner = viewer or {grant}
  online only
{query}")
}

fn engine(source: &str) -> Engine {
    use snapback4_core::value::object;
    let b = clean(source);
    let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    let item = |id: &str, owner: &str, at: i64| ("items".to_owned(), object([("id", Value::Id(id.into())), ("owner", Value::Id(owner.into())), ("at", Value::Int(at))]));
    engine.seed([
        ("staff".to_owned(), object([("id", Value::Id("s1".into())), ("principal", Value::Id("tess".into())), ("role", Value::String("manager".into()))])),
        ("staff".to_owned(), object([("id", Value::Id("s2".into())), ("principal", Value::Id("ian".into())), ("role", Value::String("intern".into()))])),
        item("i1", "alice", 1), item("i2", "bob", 2), item("i3", "alice", 3),
    ]).unwrap();
    engine
}

fn complete(engine: &mut Engine, viewer: &str) -> (bool, usize) {
    let outcome = engine.query("q", Context::new(viewer, args(&[("c", Value::Null)]))).unwrap();
    (outcome.complete, outcome.data.as_array().map_or(0, |rows| rows.len()))
}

#[test]
fn a_guarded_staff_branch_is_complete_and_check_agrees() {
    let staff = "exists staff[principal = viewer]";
    let manager = "exists staff[principal = viewer, role = 'manager']";
    let seat = "viewer = 'tess'";
    let cases = [
        // 027 061 068 095: `if G:` around the staff page.
        (staff, "query q(c: cursor ?):\n  if exists staff[principal = viewer]:\n    return items last 50 by .at, .id after c\n  return items where .owner = viewer last 50 by .at, .id after c\n"),
        // 061 095: an early exit for everyone else.
        (staff, "query q(c: cursor ?):\n  if not exists staff[principal = viewer]:\n    return []\n  return items last 50 by .at, .id after c\n"),
        // The early exit returns the caller's own rows instead.
        (staff, "query q(c: cursor ?):\n  if not exists staff[viewer]:\n    return items where .owner = viewer last 50 by .at, .id after c\n  return items last 50 by .at, .id after c\n"),
        // `else` of a negated guard.
        (staff, "query q(c: cursor ?):\n  if not exists staff[viewer]:\n    return []\n  else:\n    return items last 50 by .at, .id after c\n"),
        // 035 054 062: a role named by an equality (the probe binds the row, then compares).
        (manager, "query q(c: cursor ?):\n  if exists staff[principal = viewer, role = 'manager']:\n    return items last 50 by .at, .id after c\n  return items where .owner = viewer last 50 by .at, .id after c\n"),
        (manager, "query q(c: cursor ?):\n  if not exists staff[principal = viewer, role = 'manager']:\n    return []\n  return items last 50 by .at, .id after c\n"),
        (manager, "query q(c: cursor ?):\n  require exists staff[principal = viewer, role = 'manager'] else NOT_MANAGER\n  return items last 50 by .at, .id after c\n"),
        // 093: a viewer comparison; 077: its early-exit form.
        (seat, "query q(c: cursor ?):\n  if viewer = 'tess':\n    return items last 50 by .at, .id after c\n  return items where .owner = viewer last 50 by .at, .id after c\n"),
        (seat, "query q(c: cursor ?):\n  if viewer != 'tess':\n    return items where .owner = viewer last 50 by .at, .id after c\n  return items last 50 by .at, .id after c\n"),
        // The guard as one conjunct of a larger condition the compiler keeps whole.
        (manager, "query q(c: cursor ?):\n  if viewer != 'zed' and exists staff[principal = viewer, role = 'manager']:\n    return items last 50 by .at, .id after c\n  return []\n"),
    ];
    for (grant, query) in cases {
        let source = desk(grant, query);
        let b = clean(&source);
        assert!(note(&b, "N_NEVER_COMPLETE").is_none(), "every caller who reaches the page holds the grant:\n{source}\n{:#?}", b.notes);
        let mut engine = engine(&source);
        for viewer in ["tess", "alice", "ian", "zed"] {
            let pairs = [("c", Value::Null)];
            // A `require` refuses the others: they never reach a page.
            let Ok(outcome) = engine.query("q", Context::new(viewer, args(&pairs))) else { continue };
            assert!(outcome.complete, "{viewer}: check printed no note, so the runtime must answer complete:\n{source}");
        }
        assert_eq!(complete(&mut engine, "tess").1, 3, "{source}");
    }
}

#[test]
fn a_guard_that_does_not_imply_the_grant_keeps_the_note_and_the_runtime_agrees() {
    let manager = "exists staff[principal = viewer, role = 'manager']";
    let cases = [
        // Staff is weaker than the manager grant: an intern reaches the page.
        (manager, "query q(c: cursor ?):\n  if exists staff[principal = viewer]:\n    return items last 50 by .at, .id after c\n  return []\n", "ian"),
        // A different seat.
        ("viewer = 'tess'", "query q(c: cursor ?):\n  if viewer = 'ian':\n    return items last 50 by .at, .id after c\n  return []\n", "ian"),
        // An `or` proves neither disjunct.
        ("exists staff[viewer]", "query q(open: bool, c: cursor ?):\n  if exists staff[viewer] or open:\n    return items last 50 by .at, .id after c\n  return []\n", "alice"),
        // The early exit does not leave the block on every path.
        ("exists staff[viewer]", "query q(open: bool, c: cursor ?):\n  if not exists staff[viewer]:\n    if open:\n      return []\n  return items last 50 by .at, .id after c\n", "alice"),
        // A copy of the scan before the guard.
        ("exists staff[viewer]", "query q(c: cursor ?):\n  first = items last 50 by .at, .id after c\n  if not exists staff[viewer]:\n    return []\n  return first\n", "alice"),
    ];
    for (grant, query, outsider) in cases {
        let open = !query.contains("if open:");
        let source = desk(grant, query);
        let b = bound(&source);
        assert!(b.diagnostics.is_empty(), "{source}\n{:#?}", b.diagnostics);
        let n = note(&b, "N_NEVER_COMPLETE").unwrap_or_else(|| panic!("a caller without the grant reaches the page:\n{source}\n{:#?}", b.notes));
        assert!(n.message.contains("except for callers"), "{n}");
        let mut engine = engine(&source);
        let outcome = engine.query("q", Context::new(outsider, args(&[("c", Value::Null), ("open", Value::Bool(open))].into_iter().filter(|(k, _)| query.contains("open") || *k != "open").collect::<Vec<_>>()))).unwrap();
        assert!(!outcome.complete, "{outsider} reaches the page without the grant, so the runtime answers capped:\n{source}");
    }
}

#[test]
fn an_if_guarded_staff_pass_is_admitted_and_runs_for_staff() {
    use snapback4_core::WriteState;
    let source = desk("exists staff[principal = viewer]", "query q(c: cursor ?):\n  return items where .owner = viewer last 50 by .at, .id after c\nmutation sweep(): server\n  if not exists staff[viewer]:\n    return 0\n  n = 0\n  for row in items first 50 by .id:\n    update items[row] { at: 0 }\n    n = n + 1\n  return n\n")
        .replace("  read <- .owner = viewer or exists staff[principal = viewer]\n", "  read <- .owner = viewer or exists staff[principal = viewer]\n  update <- exists staff[principal = viewer]\n");
    let mut engine = engine(&source);
    let run = |engine: &mut Engine, viewer: &str| match engine.mutate("sweep", None, Context::new(viewer, args(&[]))).unwrap().state {
        WriteState::Sent { result, .. } => result, WriteState::Failed { why, .. } => panic!("{viewer}: {}", why.code) };
    assert_eq!(run(&mut engine, "alice"), Value::Int(0));
    assert_eq!(run(&mut engine, "tess"), Value::Int(3), "staff walk every row");
}
