//! Rounds 12–14: generated alternatives preserve nested reads, cursor order and loop admission.
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
fn page_ids(e: &mut Engine, name: &str, mut args: BTreeMap<String, Value>) -> Vec<Value> {
    let mut ids = Vec::new();
    args.insert("c".into(), Value::Null);
    for _ in 0..12 {
        let p = e.query(name, Context::new("alice", args.clone())).unwrap();
        assert!(p.complete, "{p:?}");
        ids.extend(p.data.as_array().unwrap().iter().map(|r| r.field("id").unwrap().clone()));
        let Some(next) = p.next else { return ids }; args.insert("c".into(), text(&next));
    }
    panic!("page did not terminate: {ids:?}")
}
#[test]
fn authored_words_order_disambiguates_browse_independently_of_declaration_order() {
    let indexes = "  unique byOwnerAt: owner, at\n  by byTime: owner, at, id\n";
    for optional in [false, true] {
        for definitions in [indexes.to_owned(), indexes.lines().rev().map(|line| format!("{line}\n")).collect()] {
            for direction in ["first", "last"] {
                let source = SEARCH.replace("  at: time\n", if optional { "  at: time ?\n" } else { "  at: time\n" })
                    .replace("  by byWords:", &format!("{definitions}  by byWords:"));
                let source = format!("{source}query page(owner: id, q: text <=40, c: cursor ?):\n  return t[owner] matching q {direction} 1 by byWords after c\n");
                let b = bound(&source);
                let ordinary = snapback4_lang::compile(&[("schema.q".into(), format!("{source}query ordinary(owner: id, c: cursor ?):\n  return t where .owner = owner {direction} 1 by .at after c\n"))]);
                if optional { assert!(ordinary.diagnostics.is_empty(), "{:?}", ordinary.diagnostics); }
                else { assert!(ordinary.diagnostics.iter().any(|d| d.code == "E_QUARRY_AMBIGUOUS"), "{:?}", ordinary.diagnostics); }
                let page = &b.programs.iter().find(|p| p.program.name == "page").unwrap().program;
                let browse = scans(page).into_iter().find(|s| !s.prefix.iter().any(|k| matches!(k, IndexKeyExpr::WordPrefix(_)))).unwrap();
                assert_eq!(browse.index, if optional { "byTime" } else { "byOwnerAt" });
                let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
                e.seed((1..=3).map(|n| ("t".into(), object([("id", id(&n.to_string())), ("owner", id("alice")), ("at", if optional && n < 3 { Value::Null } else { Value::Int(n) }), ("body", text("word"))])))).unwrap();
                for q in ["", "word"] {
                    let actual = page_ids(&mut e, "page", BTreeMap::from([("owner".into(), id("alice")), ("q".into(), text(q))]));
                    let mut expected = vec![id("1"), id("2"), id("3")]; if direction == "last" { expected.reverse(); }
                    assert_eq!(actual, expected, "optional={optional}, direction={direction}, q={q}");
                }
            }
        }
    }
}
#[test]
fn browse_matches_bucket_duration_and_offset_not_only_column_names() {
    let source = "table t:\n  owner: id\n  at: time\n  body: text <=40\n  by aWrongPeriod: owner, bucket(at, 2h), at, id\n  by bWrongOffset: owner, bucket(at, 1h, 30m), at, id\n  by zBrowse: owner, bucket(at, 1h), at, id\n  by byWords: owner, bucket(at, 1h), words(body), at, id\n  public 't'\nquery page(owner: id, q: text <=40, c: cursor ?):\n  return t[owner, 0] matching q first 1 by byWords after c\n";
    for wrong in ["aWrongPeriod", "bWrongOffset"] {
        // Each different calendar identity competes under the exact same names.
        let omit = if wrong == "aWrongPeriod" { "  by bWrongOffset: owner, bucket(at, 1h, 30m), at, id\n" } else { "  by aWrongPeriod: owner, bucket(at, 2h), at, id\n" };
        let b = bound(&source.replace(omit, ""));
        assert_eq!(b.schema.tables["t"].indexes[wrong].columns(), b.schema.tables["t"].indexes["zBrowse"].columns());
        let browse = scans(&b.programs[0].program).into_iter().find(|s| !s.prefix.iter().any(|k| matches!(k, IndexKeyExpr::WordPrefix(_)))).unwrap();
        assert_eq!(browse.index, "zBrowse");
        let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
        e.seed([0, 1_800_000, 3_599_999, 3_600_000].into_iter().enumerate().map(|(n, at)| ("t".into(), object([("id", id(&n.to_string())), ("owner", id("alice")), ("at", Value::Int(at)), ("body", text("word"))])))).unwrap();
        for q in ["", "word"] {
            assert_eq!(page_ids(&mut e, "page", BTreeMap::from([("owner".into(), id("alice")), ("q".into(), text(q))])), [id("0"), id("1"), id("2")]);
        }
    }
}
#[test]
fn every_planned_page_keeps_nullable_unique_ties_and_explicit_unsafe_cursors_refuse() {
    let table = "table t:\n  owner: id\n  at: time ?\n  unique byOwnerAt: owner, at\n  public 't'\n";
    for existing in [false, true] {
        for direction in ["first", "last"] {
            let table = if existing { table.replace("  public", "  by byTime: owner, at, id\n  public") } else { table.into() };
            let source = format!("{table}view v:\n  t {{ owner, at }}\nquery predicate(owner: id, c: cursor ?):\n  return t where .owner = owner {direction} 1 by .at after c\nquery named(owner: id, c: cursor ?):\n  return t[owner = owner] {direction} 1 by .at after c\nquery values(owner: id, c: cursor ?):\n  return t where .owner in [owner] {direction} 1 by .at after c\nquery projected(owner: id, c: cursor ?):\n  return v where .owner = owner {direction} 1 by .at after c\n");
            let b = bound(&source);
            for p in &b.programs { for scan in scans(&p.program) {
                assert_eq!(b.schema.tables["t"].indexes[&scan.index].columns(), ["owner", "at", "id"]);
                assert_ne!(scan.index, "byOwnerAt");
            } }
            let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
            e.seed(["a", "b"].into_iter().map(|n| ("t".into(), object([("id", id(n)), ("owner", id("alice")), ("at", Value::Null)])))).unwrap();
            for name in ["predicate", "named", "values", "projected"] {
                let mut expected = vec![id("a"), id("b")]; if direction == "last" { expected.reverse(); }
                assert_eq!(page_ids(&mut e, name, BTreeMap::from([("owner".into(), id("alice"))])), expected);
            }
        }
    }
    let source = format!("{table}query unsafePage(owner: id, c: cursor ?):\n  return t[owner] first 1 by byOwnerAt after c\n");
    let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
    let d = b.diagnostics.iter().find(|d| d.code == "E_CURSOR_INDEX").unwrap_or_else(|| panic!("{:?}", b.diagnostics));
    assert!(d.message.contains("nullable") && d.rewrite.contains("by .at"), "{d:?}");
    let rewritten = bound(&format!("{table}query safePage(owner: id, c: cursor ?):\n  return {}\n", d.rewrite));
    let unique = &rewritten.schema.tables["t"].indexes["byOwnerAt"];
    assert!(unique.unique); assert_eq!(unique.columns(), ["owner", "at"]);
}
#[test]
fn nullable_unique_cursor_rewrite_preserves_computed_key_definitions() {
    for component in ["hour(at)", "bucket(at, 2h, 30m)"] {
        let table = format!("table t:\n  owner: principal ?\n  at: time\n  unique byPeriod: owner, {component}\n  public 't'\n");
        let source = format!("{table}query q(c: cursor ?):\n  return t[viewer] first 1 by byPeriod after c\n");
        let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
        let d = b.diagnostics.iter().find(|d| d.code == "E_CURSOR_INDEX").unwrap_or_else(|| panic!("{:?}", b.diagnostics));
        let forms: Vec<_> = d.rewrite.split('`').collect();
        assert_eq!(forms.len(), 5, "{d:?}");
        let fixed = bound(&format!("{}query q(c: cursor ?):\n  return {}\n", table.replace("  public", &format!("  {}\n  public", forms[1])), forms[3]));
        let indexes = &fixed.schema.tables["t"].indexes;
        assert!(indexes["byPeriod"].unique);
        assert!(!indexes["byPeriodPage"].unique);
        assert_eq!(&indexes["byPeriodPage"].components[..2], indexes["byPeriod"].components.as_slice());
        assert_eq!(indexes["byPeriodPage"].columns().last().unwrap(), "id");
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
    p.args.insert("items".into(), ArgType::List { of: Some(Box::new(ArgType::Int)), max: 2 });
    let domains = [
        LoopDomain::DerivedArray { value, max: 10, bound_source: "page".into() },
        LoopDomain::DerivedArray { value: Expr::Array(vec![lit(Value::Int(1))]), max: 1, bound_source: "list".into() },
        LoopDomain::LiteralRange { start: 0, end_exclusive: 2 },
        LoopDomain::ExpressionRange { start: lit(Value::Int(0)), end_exclusive: lit(Value::Int(2)) },
        LoopDomain::ArgList { name: "items".into(), max: 2 },
    ];
    let work = [
        Stmt::Emit { effect: "notify".into(), payload: lit(Value::Int(1)), once: None },
        Stmt::Update { table: "t".into(), key: Expr::Literal(id("a")), patch: Expr::Object(BTreeMap::from([("n".into(), lit(Value::Int(99)))])) },
    ];
    let valid = bound(&format!("{WORK}job ordinary():\n  total = 0\n  for n in range(0, 2):\n    total = total + n\n  for row in t:\n    for n in range(0, 2):\n      emit notify {{ n }}\n    update t[row.id] {{ n: 9 + total }}\nquery all():\n  return t\n"));
    let sweep = valid.programs.iter().find(|p| p.program.name == "ordinary").unwrap().program.clone();
    // Validate the complete top-level sequence before even the first valid
    // sweep can write, including unsupported loops before/between/after it.
    let mut unsupported = Vec::new();
    for domain in domains { for statement in &work {
        unsupported.push(Stmt::For { binding: "row".into(), domain: domain.clone(), body: vec![statement.clone()] });
    } }
    // A pure body cannot hide work in the expression that supplies its domain.
    for statement in &work {
        for range in [false, true] {
            let value = Expr::Block { body: vec![statement.clone()], value: Box::new(if range { lit(Value::Int(0)) } else { Expr::Array(vec![lit(Value::Int(1))]) }) };
            let domain = if range { LoopDomain::ExpressionRange { start: value, end_exclusive: lit(Value::Int(1)) } }
                else { LoopDomain::DerivedArray { value, max: 1, bound_source: "list".into() } };
            unsupported.push(Stmt::For { binding: "row".into(), domain, body: Vec::new() });
        }
        unsupported.push(Stmt::For { binding: "row".into(), domain: LoopDomain::ExpressionRange {
            start: lit(Value::Int(0)),
            end_exclusive: Expr::Block { body: vec![statement.clone()], value: Box::new(lit(Value::Int(1))) },
        }, body: Vec::new() });
        // Inlined helpers may also place work inside a body's expression.
        unsupported.push(Stmt::For { binding: "row".into(), domain: LoopDomain::LiteralRange { start: 0, end_exclusive: 1 }, body: vec![Stmt::Let {
            name: "value".into(), value: Expr::Block { body: vec![statement.clone()], value: Box::new(lit(Value::Int(0))) },
        }] });
    }
    for bad in unsupported { for location in [None, Some(0), Some(sweep.body.len()), Some(sweep.body.len() * 2)] {
        let mut mixed = p.clone();
        if let Some(at) = location {
            mixed.body = sweep.body.clone();
            mixed.body.extend(sweep.body.clone());
            mixed.body.insert(at, bad.clone());
        } else {
            mixed.body.push(bad.clone());
        }
        let mut e = Engine::memory(b.schema.clone(), [mixed]).unwrap();
        e.seed([("t".into(), object([("id", id("a")), ("n", Value::Int(1))]))]).unwrap();
        let run = e.run_job("rawSweep", BTreeMap::from([("status".into(), Value::Null), ("items".into(), Value::Array(vec![Value::Int(1)]))]), 1).unwrap();
        assert_eq!(run.state, JobState::Parked, "location={location:?}, loop={bad:?}: {run:?}");
        assert!(run.error.as_ref().unwrap().contains("E_JOB_SWEEP"));
        assert_eq!(run.chunks, 0); assert_eq!(run.rows_written, 0);
        assert!(e.effects(None, 10).unwrap().is_empty());
    } }
    let mut e = Engine::memory(valid.schema, valid.programs.into_iter().map(|p| p.program)).unwrap();
    e.seed([("t".into(), object([("id", id("a")), ("n", Value::Int(1))]))]).unwrap();
    let run = e.run_job("ordinary", BTreeMap::new(), 1).unwrap();
    assert_eq!(run.state, JobState::Done); assert_eq!(run.rows_written, 1);
    assert_eq!(e.effects(None, 10).unwrap().len(), 2);
    let rows = e.query("all", Context::new("alice", BTreeMap::new())).unwrap();
    assert_eq!(rows.data.as_array().unwrap()[0].field("n"), Ok(&Value::Int(10)));
}

#[test]
fn compiled_sweep_prefix_setup_runs_before_each_chunk() {
    let b = bound("effect notify\ntable t:\n  scope: int\n  immutable scope\n  n: int\n  by byScope: scope, id\n  public 't'\n  update <- allow\n  sync public\njob computedPrefix():\n  total = 0\n  for n in range(0, 2):\n    total = total + n\n  for row in t[sum([{ n: 1 }], .n)] by byScope:\n    for n in range(0, 2):\n      emit notify { n }\n    update t[row.id] { n: 9 + total }\nquery all():\n  return t first 100 by .id\n");
    let p = &b.programs.iter().find(|p| p.program.name == "computedPrefix").unwrap().program;
    let setup = p.body.iter().position(|s| matches!(s, Stmt::For { domain: LoopDomain::DerivedArray { max: 1, bound_source, .. }, .. } if bound_source == "sum")).expect("sum must generate a bounded setup loop");
    let sweep = p.body.iter().position(|s| matches!(s, Stmt::For { domain: LoopDomain::Page(_), .. })).unwrap();
    assert!(setup < sweep);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    e.seed((0..66).map(|n| ("t".into(), object([("id", id(&format!("{n:03}"))), ("scope", Value::Int(if n == 0 { 2 } else { 1 })), ("n", Value::Int(0))])))).unwrap();
    let run = e.run_job("computedPrefix", BTreeMap::new(), 1).unwrap();
    assert_eq!(run.state, JobState::Done, "{run:?}");
    assert!(run.chunks >= 2, "{run:?}");
    assert_eq!(run.rows_written, 65);
    assert_eq!(e.effects(None, 200).unwrap().len(), 130);
    let rows = e.query("all", Context::new("alice", BTreeMap::new())).unwrap();
    assert!(rows.complete);
    let rows = rows.data.as_array().unwrap();
    assert_eq!(rows.len(), 66);
    assert_eq!(rows[0].field("n"), Ok(&Value::Int(0)));
    assert!(rows[1..].iter().all(|r| r.field("n") == Ok(&Value::Int(10))));
}

#[test]
fn pure_setup_requires_a_following_sweep() {
    let b = bound(&format!("{WORK}job ordinary():\n  for row in t:\n    update t[row.id] {{ n: 9 }}\n"));
    for has_sweep in [false, true] {
        let mut p = b.programs[0].program.clone();
        if !has_sweep { p.body.clear(); }
        p.body.push(Stmt::For { binding: "n".into(), domain: LoopDomain::LiteralRange { start: 0, end_exclusive: 2 }, body: Vec::new() });
        let mut e = Engine::memory(b.schema.clone(), [p]).unwrap();
        e.seed([("t".into(), object([("id", id("a")), ("n", Value::Int(1))]))]).unwrap();
        let run = e.run_job("ordinary", BTreeMap::new(), 1).unwrap();
        assert_eq!(run.state, JobState::Parked, "{run:?}");
        assert!(run.error.as_ref().unwrap().contains("E_JOB_SWEEP"));
        assert_eq!(run.chunks, 0); assert_eq!(run.rows_written, 0);
        assert!(e.effects(None, 10).unwrap().is_empty());
    }
}
