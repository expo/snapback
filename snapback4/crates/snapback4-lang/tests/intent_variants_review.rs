//! Round 12: generated alternatives preserve nested reads and loop admission.
use snapback4_core::{Context, Engine, JobState, Value, ir::*, value::object};
use std::collections::BTreeMap;
fn bound(source: &str) -> snapback4_lang::Bound {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics); b
}
fn id(s: &str) -> Value { Value::Id(s.into()) }
fn text(s: &str) -> Value { Value::String(s.into()) }
const SEARCH: &str = "table t:\n  owner: id\n  body: text <=40\n  at: time\n  by byWords: owner, words(body), at, id\n  public 't'\ntable input:\n  owner: id\n  value: text <=40\n  public 'input'\nquery filtered(owner: id, i: id, q: text <=40, c: cursor ?):\n  return t[owner] matching q first 1 by byWords after c where exists input[i]\nquery inline(owner: id, i: id, c: cursor ?):\n  return t[owner] matching (input[i] ! else MISSING).value first 1 by byWords after c\n";
#[test]
fn generated_browse_never_retargets_nested_points_or_inline_needles() {
    let b = bound(SEARCH);
    for p in &b.programs {
        let nested: Vec<_> = read_sites(&p.program).into_iter().filter(|r| r.table == "input").collect();
        assert!(!nested.is_empty());
        assert!(nested.iter().all(|r| r.kind == "point" && r.index == "byId"), "{nested:?}");
    }
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    e.seed([("t".into(), object([("id", id("a")), ("owner", id("alice")), ("at", Value::Int(1)), ("body", text("word"))])),
        ("input".into(), object([("id", id("other")), ("owner", id("wanted")), ("value", text("word"))]))]).unwrap();
    for q in ["", "word"] {
        let args = BTreeMap::from([("owner".into(), id("alice")), ("i".into(), id("wanted")), ("q".into(), text(q)), ("c".into(), Value::Null)]);
        let p = e.query("filtered", Context::new("alice", args)).unwrap();
        assert!(p.complete && p.next.is_none()); assert_eq!(p.data.as_array().unwrap().len(), 0);
    }
    let args = |i| BTreeMap::from([("owner".into(), id("alice")), ("i".into(), id(i)), ("c".into(), Value::Null)]);
    assert_eq!(e.query("inline", Context::new("alice", args("wanted"))).unwrap_err().code, "MISSING");
    let p = e.query("inline", Context::new("alice", args("other"))).unwrap();
    assert!(p.complete); assert_eq!(p.data.as_array().unwrap()[0].field("id"), Ok(&id("a")));
}
#[test]
fn authored_words_order_disambiguates_browse_independently_of_declaration_order() {
    let indexes = "  unique byOwnerAt: owner, at\n  by byTime: owner, at, id\n";
    for definitions in [indexes.to_owned(), indexes.lines().rev().map(|line| format!("{line}\n")).collect()] {
        let source = SEARCH.replace("  by byWords:", &format!("{definitions}  by byWords:"));
        let source = format!("{source}query page(owner: id, q: text <=40, c: cursor ?):\n  return t[owner] matching q last 1 by byWords after c\n");
        let b = bound(&source);
        let ambiguous = snapback4_lang::compile(&[("schema.q".into(), format!("{source}query ordinary(owner: id, c: cursor ?):\n  return t where .owner = owner last 1 by .at after c\n"))]);
        assert!(ambiguous.diagnostics.iter().any(|d| d.code == "E_QUARRY_AMBIGUOUS"), "{:?}", ambiguous.diagnostics);
        let page = &b.programs.iter().find(|p| p.program.name == "page").unwrap().program;
        let browse = scans(page).into_iter().find(|s| !s.prefix.iter().any(|k| matches!(k, IndexKeyExpr::WordPrefix(_)))).unwrap();
        assert_eq!(browse.index, "byOwnerAt");
        let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
        e.seed((1..=3).map(|n| ("t".into(), object([("id", id(&n.to_string())), ("owner", id("alice")), ("at", Value::Int(n)), ("body", text("word"))])))).unwrap();
        for q in ["", "word"] {
            let mut cursor = Value::Null; let mut ids = Vec::new();
            for _ in 0..5 {
                let p = e.query("page", Context::new("alice", BTreeMap::from([("owner".into(), id("alice")), ("q".into(), text(q)), ("c".into(), cursor)]))).unwrap();
                assert!(p.complete); ids.extend(p.data.as_array().unwrap().iter().map(|r| r.field("id").unwrap().clone()));
                let Some(next) = p.next else { break }; cursor = text(&next);
            }
            assert_eq!(ids, [id("3"), id("2"), id("1")]);
        }
    }
}
const WORK: &str = "effect notify\ntable t:\n  n: int\n  cap 10\n  public 't'\n  update <- allow\n  sync public\n";
#[test]
fn presence_domains_refuse_population_loops_with_an_ordinary_loop_rewrite() {
    let optional = "t where (status = null or .n = status) first 1 by .id after c";
    for domain in [optional, "t first 1 by .id after c"] {
        let source = format!("{WORK}mutation send(status: int ?, c: cursor ?):\n  for row in {domain}:\n    emit notify {{ id: row.id }}\n");
        let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
        assert!(b.diagnostics.iter().any(|d| d.code == "E_STRUCTURAL_FANOUT"), "{:?}", b.diagnostics);
    }
    let alias = format!("{WORK}mutation send(status: int ?, c: cursor ?):\n  page = {optional}\n  for row in page:\n    emit notify {{ id: row.id }}\n");
    let b = snapback4_lang::compile(&[("schema.q".into(), alias)]);
    assert!(b.diagnostics.iter().any(|d| d.code == "E_STRUCTURAL_FANOUT"), "{:?}", b.diagnostics);
    let b = snapback4_lang::compile(&[("schema.q".into(), format!("{WORK}job sweep(status: int ?):\n  for row in t where (status = null or .n = status):\n    update t[row.id] {{ n: 9 }}\n"))]);
    assert!(b.diagnostics.iter().any(|d| d.code == "E_QUARRY_PLACEMENT" && d.message.contains("argument-presence") && d.rewrite.contains("inside")), "{:?}", b.diagnostics);
    let fixed = bound(&format!("{WORK}job sweep(status: int ?):\n  for row in t:\n    if status = null or row.n = status:\n      update t[row.id] {{ n: 9 }}\nquery all():\n  return t\n"));
    let mut e = Engine::memory(fixed.schema, fixed.programs.into_iter().map(|p| p.program)).unwrap();
    e.seed((1..=3).map(|n| ("t".into(), object([("id", id(&n.to_string())), ("n", Value::Int(n))])))).unwrap();
    let run = e.run_job("sweep", BTreeMap::from([("status".into(), Value::Null)]), 1).unwrap();
    assert_eq!(run.state, JobState::Done); assert_eq!(run.rows_written, 3);
    let p = e.query("all", Context::new("alice", BTreeMap::new())).unwrap();
    assert!(p.data.as_array().unwrap().iter().all(|r| r.field("n") == Ok(&Value::Int(9))));
}
#[test]
fn engine_parks_an_unrecorded_conditional_sweep_instead_of_skipping_it() {
    let b = bound(&format!("{WORK}query domain(status: int ?):\n  return t where (status = null or .n = status)\n"));
    let mut p = b.programs[0].program.clone();
    let Stmt::Return(value) = p.body.pop().unwrap() else { panic!("domain") };
    p.name = "rawSweep".into(); p.kind = ProgramKind::Job;
    p.body.push(Stmt::For { binding: "row".into(), domain: LoopDomain::DerivedArray { value, max: 10, bound_source: "page".into() }, body: vec![Stmt::Emit {
        effect: "notify".into(), payload: field(var("row"), "id"), once: None,
    }] });
    let mut e = Engine::memory(b.schema, [p]).unwrap();
    e.seed([("t".into(), object([("id", id("a")), ("n", Value::Int(1))]))]).unwrap();
    let run = e.run_job("rawSweep", BTreeMap::from([("status".into(), Value::Null)]), 1).unwrap();
    assert_eq!(run.state, JobState::Parked, "{run:?}");
    assert!(run.error.as_ref().unwrap().contains("E_JOB_SWEEP"));
    assert_eq!(run.chunks, 0); assert_eq!(run.rows_written, 0);
    assert!(e.effects(None, 10).unwrap().is_empty());
}
