//! Regressions from the independent round-0 review (included by job_viewer).
use super::*;

const BASE: &str = "effect push\ntable profiles:\n  principal: principal\n  public 'profiles'\n";
const DOCS: &str = "table docs:\n  owner: principal\n  value: int\n  by byOwner: owner, id\n  read <- .owner = viewer\n";
fn documents() -> Vec<(String, Value)> {
    ["user:alice", "user:bob"].into_iter().enumerate().map(|(n, owner)| ("docs".into(), object([
        ("id", id(format!("d{n}"))), ("owner", id(owner)), ("value", Value::Int(n as i64 + 1)),
    ]))).collect()
}
fn no_effects_or_keys(e: &Engine) {
    assert!(e.effects(None, 100).unwrap().is_empty());
    let exists: bool = e.store().conn().query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name = '_effect_keys')", [], |r| r.get(0)).unwrap();
    if exists { assert_eq!(e.store().conn().query_row("SELECT count(*) FROM _effect_keys", [], |r| r.get::<_, i64>(0)).unwrap(), 0); }
}

#[test]
fn authorization_budget_retries_smaller_chunks_and_preserves_single_item_diagnostic() {
    let mut source = format!("{BASE}{}\nquery many():\n  n = 0\n", include_str!("../read_through/chain.q"));
    for n in 0..300 { source += &format!("  if comments['c{n}'] != null:\n    n = n + 1\n"); }
    source += "  return n\njob inspect():\n  for p in profiles:\n    emit push { before: true } once [p.principal, 'before']\n    n = 0\n    as p.principal:\n      n = many().data\n    emit push { principal: p.principal, n } once [p.principal, 'after']\n";
    let mut data = Vec::new();
    for n in 0..300 {
        data.extend([
            ("orgs".into(), object([("id", id(format!("o{n}"))), ("owner", id("user:owner"))])),
            ("projects".into(), object([("id", id(format!("p{n}"))), ("org", id(format!("o{n}")))])),
            ("tasks".into(), object([("id", id(format!("t{n}"))), ("project", id(format!("p{n}")))])),
            ("comments".into(), object([("id", id(format!("c{n}"))), ("task", id(format!("t{n}"))), ("author", id("user:owner")), ("body", Value::String("hello".into())), ("at", Value::Int(1))])),
        ]);
        for p in 0..16 { data.push(("members".into(), object([("id", id(format!("m{n}:{p}"))), ("org", id(format!("o{n}"))), ("principal", id(format!("user:p{p}")))]))); }
    }
    let mut e = engine(&source);
    e.seed_at(data.clone().into_iter().chain((0..16).map(|p| profile(&format!("user:p{p}")))), 0).unwrap();
    let run = e.run_job("inspect", BTreeMap::new(), 1).unwrap();
    assert_eq!(run.state, JobState::Done, "{run:?}");
    assert!(run.retries > 0 && run.chunk_size < 64, "{run:?}");
    let effects = e.effects(None, 100).unwrap();
    assert_eq!(effects.len(), 32, "rolled-back attempts do not duplicate emits");
    for effect in effects.iter().filter(|e| e.payload.as_object().unwrap().contains_key("n")) {
        assert_eq!(effect.payload.field("n").unwrap(), &Value::Int(300));
    }
    done(&mut e, "inspect", BTreeMap::new(), 1);
    assert_eq!(e.effects(None, 100).unwrap().len(), 32, "once keys commit with successful chunks");
    eprintln!("authorization fitting run: {run:?}");

    let oversized = source.replace("      n = many().data", &"      n = many().data\n".repeat(16));
    let mut e = engine(&oversized);
    e.seed_at(data.into_iter().chain([profile("user:p0")]), 0).unwrap();
    let run = e.run_job("inspect", BTreeMap::new(), 1).unwrap();
    assert_eq!(run.state, JobState::Parked, "{run:?}");
    assert_eq!(run.chunk_size, 1);
    assert_eq!(run.retries, 6);
    assert!(run.error.as_deref().unwrap().starts_with("E_RULE"), "{run:?}");
    no_effects_or_keys(&e);
    eprintln!("authorization oversized run: {run:?}");
}

#[test]
fn every_direct_read_and_helper_refuses_incomplete_results() {
    let expressions = [
        ("page", "n = docs first 100"),
        ("loop", "n = 0\nfor d in docs first 100:\n  n = n + 1"),
        ("count", "n = count(docs first 100)"),
        ("sum", "n = sum(docs first 100, .value)"),
        ("exists", "n = exists docs"),
    ];
    for (tag, body) in expressions {
        for helper in [false, true] {
            let helper_source = if helper { format!("fn readDocs():\n  {}\n  return n\n", body.replace('\n', "\n  ")) } else { String::new() };
            let body = if helper { "n = readDocs()" } else { body };
            let source = format!("{BASE}{DOCS}{helper_source}query ordinary():\n  {}\n  return n\njob inspect():\n  for p in profiles:\n    emit push {{ before: true }} once [p.principal, 'before']\n    as p.principal:\n      {}\n    emit push {{ after: true }} once [p.principal]\n", body.replace('\n', "\n  "), body.replace('\n', "\n      "));
            let mut e = engine(&source);
            e.seed_at(documents().into_iter().chain([profile("user:alice")]), 0).unwrap();
            let ordinary = e.query("ordinary", Context::new("user:alice", BTreeMap::new())).unwrap();
            assert!(!ordinary.complete || ordinary.unavailable, "{tag}/{helper}: {ordinary:?}");
            let run = e.run_job("inspect", BTreeMap::new(), 0).unwrap();
            assert_eq!(run.state, JobState::Parked, "{tag}/{helper}: {run:?}");
            assert!(run.error.as_deref().unwrap().starts_with("E_JOB_VIEWER_READ"), "{tag}/{helper}: {run:?}");
            no_effects_or_keys(&e);
        }
    }
}

#[test]
fn point_reads_and_uniform_domains_keep_ordinary_complete_answers() {
    let expressions = ["docs['d0']", "docs['d1']", "docs['absent']", "exists docs['d1']", "docs where .owner = viewer first 100", "count(docs where .owner = viewer)", "sum(docs where .owner = viewer, .value)", "exists docs where .owner = viewer"];
    for expr in expressions {
        let source = format!("{BASE}{DOCS}query ordinary():\n  return {expr}\njob inspect():\n  for p in profiles:\n    n = null\n    as p.principal:\n      n = {expr}\n    emit push {{ n }} once [p.principal]\n");
        let mut e = engine(&source);
        e.seed_at(documents().into_iter().chain([profile("user:alice")]), 0).unwrap();
        let ordinary = e.query("ordinary", Context::new("user:alice", BTreeMap::new())).unwrap();
        assert!(ordinary.complete && !ordinary.unavailable, "{expr}: {ordinary:?}");
        done(&mut e, "inspect", BTreeMap::new(), 0);
        assert_eq!(e.effects(None, 100).unwrap()[0].payload.field("n").unwrap(), &ordinary.data, "{expr}");
    }
}

#[test]
fn inner_loops_keep_sweep_placement_and_jumps_stay_lexical() {
    let docs = DOCS.replace("  read <- .owner = viewer", "  public 'docs'");
    for helper in [false, true] {
        let helper_source = if helper { "fn totalDocs():\n  total = 0\n  for d in docs:\n    total = total + d.value\n  return total\n" } else { "" };
        let body = if helper { "total = totalDocs()" } else { "for d in docs:\n        total = total + d.value" };
        let source = format!("{BASE}{docs}{helper_source}job inspect():\n  for p in profiles:\n    total = 0\n    as p.principal:\n      {body}\n    emit push {{ total }}\n");
        let mut e = engine(&source);
        e.seed_at(documents().into_iter().chain([profile("user:alice")]), 0).unwrap();
        done(&mut e, "inspect", BTreeMap::new(), 0);
        assert_eq!(e.effects(None, 100).unwrap()[0].payload.field("total").unwrap(), &Value::Int(3));
    }
    for jump in ["break", "continue"] {
        let source = format!("{BASE}job inspect():\n  for p in profiles:\n    as p.principal:\n      {jump}\n");
        assert!(compile(&[("schema.q".into(), source)]).diagnostics.iter().any(|d| d.code == "E_JOB_VIEWER_FLOW"));
        let source = format!("{BASE}{docs}job inspect():\n  for p in profiles:\n    as p.principal:\n      for d in docs:\n        {jump}\n    emit push {{ ok: true }}\n");
        checked(&source);
    }
}

#[test]
fn viewer_dependent_refinements_do_not_cross_either_authority_edge() {
    let helpers = "fn who():\n  if viewer = 'system':\n    return 1\n  return null\nfn indirect():\n  return who()\nfn explicit(p: principal):\n  if p = 'system':\n    return 1\n  return null\n";
    for call in ["who()", "indirect()", "explicit(viewer)"] {
        let source = format!("{BASE}{helpers}job inspect():\n  for p in profiles:\n    if {call} != null:\n      as p.principal:\n        n = {call} + 1\n");
        let b = compile(&[("schema.q".into(), source)]);
        assert!(b.diagnostics.iter().any(|d| d.code == "E_QUARRY_TYPE"), "{call}: {:?}", b.diagnostics);
        // Entry and exit both invalidate calls, even after assigning a carried
        // argument inside the scope. A fresh guard in the scope remains valid.
        let source = format!("{BASE}{helpers}job inspect():\n  for p in profiles:\n    n = 0\n    as p.principal:\n      if {call} != null:\n        n = {call} + 1\n    n = {call} + 1\n");
        let b = compile(&[("schema.q".into(), source)]);
        assert!(b.diagnostics.iter().any(|d| d.code == "E_QUARRY_TYPE"), "exit {call}: {:?}", b.diagnostics);
    }
    let source = format!("{BASE}fn byViewer(x: int):\n  if viewer != 'system':\n    return x\n  return null\njob inspect():\n  for p in profiles:\n    x = 0\n    as p.principal:\n      x = 1\n      require byViewer(x) != null else PRESENT\n    n = byViewer(x) + 1\n");
    let b = compile(&[("schema.q".into(), source)]);
    assert!(b.diagnostics.iter().any(|d| d.code == "E_QUARRY_TYPE"), "exit argument-root fact: {:?}", b.diagnostics);
    let source = format!("{BASE}{helpers}job inspect():\n  for p in profiles:\n    snapshot = who()\n    n = 0\n    if snapshot != null:\n      as p.principal:\n        n = snapshot + 1\n        if who() != null:\n          n = who() + 1\n    emit push {{ n }}\n");
    let mut e = engine(&source);
    e.seed_at([profile("user:alice")], 0).unwrap();
    done(&mut e, "inspect", BTreeMap::new(), 0);
    assert_eq!(e.effects(None, 100).unwrap()[0].payload.field("n").unwrap(), &Value::Int(2));
}

#[test]
fn forged_non_principal_values_refuse_before_entering_scope() {
    use snapback4_core::ir::{Builtin, Expr, Stmt};
    for value in [Value::Null, Value::Int(42), Value::Bool(false), Value::Array(vec![]), object([] as [(&str, Value); 0]), id(""), Value::String("".into()), id("system")] {
        let mut b = checked(&format!("{BASE}job inspect():\n  for p in profiles:\n    x = null\n    as p.principal:\n      x = viewer\n    emit push {{ x }} once [p.principal]\n"));
        let job = b.programs.iter_mut().find(|p| p.program.name == "inspect").unwrap();
        let Stmt::For { body, .. } = job.program.body.last_mut().unwrap() else { panic!() };
        let args = body.iter_mut().find_map(|stmt| match stmt { Stmt::Let { value: Expr::Builtin { builtin: Builtin::JobAs, args }, .. } => Some(args), _ => None }).unwrap();
        args[0] = Expr::Literal(value.clone());
        let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
        e.seed_at([profile("user:alice")], 0).unwrap();
        let run = e.run_job("inspect", BTreeMap::new(), 0).unwrap();
        assert_eq!(run.state, JobState::Parked, "{value:?}: {run:?}");
        assert!(run.error.unwrap().starts_with("E_JOB_VIEWER_PRINCIPAL"), "{value:?}");
        no_effects_or_keys(&e);
    }
}

// Invoked for every world of the existing randomized equivalence property.
// Include incomplete ordinary answers as well as complete ones, and exercise
// both direct expressions/loops/helpers and the declared-query door.
pub(super) fn compare_hidden_rows(seed: usize) {
    let mut random = seed as u64 + 17;
    let mut rows = Vec::new();
    for n in 0..35 {
        random ^= random << 13; random ^= random >> 7; random ^= random << 17;
        rows.push(("docs".into(), object([("id", id(format!("d{n}"))), ("owner", id(format!("user:p{}", random % 4))), ("value", Value::Int((random % 91) as i64))])));
    }
    let forms = [
        "n = docs first 100", "n = count(docs first 100)", "n = sum(docs first 100, .value)",
        "n = 0\nfor d in docs first 100:\n  n = n + d.value", "n = docs['d0']",
        "n = docs where .owner = viewer first 100", "n = count(docs where .owner = viewer)",
    ];
    for body in forms {
        let initial = if body.starts_with("n = 0") { "0" } else { "null" };
        let source = format!("{BASE}{DOCS}query ordinary():\n  {}\n  return n\njob inspect(who: principal):\n  for p in profiles:\n    n = {initial}\n    as who:\n      {}\n    emit push {{ n }}\njob callQuery(who: principal):\n  for p in profiles:\n    n = null\n    as who:\n      n = ordinary().data\n    emit push {{ n }}\n", body.replace('\n', "\n  "), body.replace('\n', "\n      "));
        let mut e = engine(&source);
        e.seed_at(rows.clone().into_iter().chain([profile("user:placeholder")]), 0).unwrap();
        for p in 0..5 {
            let who = format!("user:p{p}");
            let expected = e.query("ordinary", Context::new(&who, BTreeMap::new())).unwrap();
            for job in ["inspect", "callQuery"] {
                let before_ids: Vec<_> = e.effects(None, 100).unwrap().into_iter().map(|e| e.id).collect();
                let before = before_ids.len();
                let run = e.run_job(job, BTreeMap::from([("who".into(), id(&who))]), 0).unwrap();
                let effects = e.effects(None, 100).unwrap();
                if expected.complete && !expected.unavailable {
                    assert_eq!(run.state, JobState::Done, "{seed}/{body}/{who}/{job}: {run:?}");
                    assert_eq!(effects.len(), before + 1);
                    assert_eq!(effects.iter().find(|e| !before_ids.contains(&e.id)).unwrap().payload.field("n").unwrap(), &expected.data, "{seed}/{body}/{who}/{job}");
                } else {
                    assert_eq!(run.state, JobState::Parked, "{seed}/{body}/{who}/{job}: {run:?}");
                    assert!(run.error.unwrap().starts_with("E_JOB_VIEWER_READ"));
                    assert_eq!(effects.len(), before, "no incomplete emission");
                }
            }
        }
    }
}

#[test]
fn ephemeral_direct_and_helper_reads_refuse_with_query_diagnostic() {
    let ephemeral = "table typing:\n  owner: principal\n  unique owner\n  read <- allow\n  insert <- .owner = viewer\n  update <- .owner = viewer\n  ephemeral 4s\n";
    for expr in ["typing[owner = viewer]", "typing first 10", "count(typing first 10)", "exists typing[owner = viewer]", "hint()"] {
        let source = format!("{BASE}{ephemeral}fn hint():\n  return typing[owner = viewer]\njob inspect():\n  for p in profiles:\n    as p.principal:\n      x = {expr}\n");
        let b = compile(&[("schema.q".into(), source)]);
        assert!(b.diagnostics.iter().any(|d| d.code == "E_JOB_VIEWER_QUERY"), "{expr}: {:?}", b.diagnostics);
    }
}

#[test]
fn device_job_stubs_decode_and_retain_content_identity_without_server_bodies() {
    use snapback4_core::{ir::{Expr, Stmt}, value::digest};
    use snapback4_device::{device::{Backend, Device}, memory::MemoryStore};
    let source = format!("{BASE}query ordinary():\n  return 1\njob inspect():\n  for p in profiles:\n    n = 0\n    as p.principal:\n      n = ordinary().data\n    emit push {{ n }}\n");
    let b = checked(&source);
    let wire = snapback4_lang::emit::backend_programs(&b);
    let backend: Backend = serde_json::from_value(serde_json::json!({"generation": 1, "schema": b.schema.public_projection(), "programs": wire})).unwrap();
    let job = backend.programs.iter().find(|p| p.name == "inspect").unwrap();
    let server = &b.programs.iter().find(|p| p.program.name == "inspect").unwrap().program;
    assert_eq!(job.body, [Stmt::Return(Expr::Literal(Value::String(digest(server))))]);
    assert!(!serde_json::to_string(job).unwrap().contains("JobQuery"));
    let ordinary = backend.programs.iter().find(|p| p.name == "ordinary").unwrap();
    assert_eq!(ordinary, &b.programs.iter().find(|p| p.program.name == "ordinary").unwrap().program);
    let changed = checked(&source.replace("return 1", "return 2"));
    let changed_wire = snapback4_lang::emit::backend_programs(&changed);
    let changed_job = changed_wire.iter().find(|p| p["name"] == "inspect").unwrap();
    assert_ne!(serde_json::to_value(job).unwrap()["body"], changed_job["body"], "embedded query changes still invalidate identity");
    let mut device = Device::open_store(MemoryStore::new(), Some(backend)).unwrap();
    assert_eq!(device.query("ordinary", "user:alice", &serde_json::json!({}), 0).unwrap().data, Value::Int(1));
    assert!(device.query("inspect", "user:alice", &serde_json::json!({}), 0).is_err());
}

#[test]
fn device_refuses_job_builtins_before_evaluating_their_arguments() {
    use snapback4_core::ir::{Builtin, Expr, Stmt};
    use snapback4_device::{device::{Backend, Device}, memory::MemoryStore};
    for (all, loop_domain) in [(None, false), (Some(false), false), (Some(true), false), (Some(true), true)] {
        let mut b = checked(&format!("{BASE}query ordinary():\n  return 1\n"));
        let query = b.programs.iter_mut().find(|p| p.program.name == "ordinary").unwrap();
        let builtin = match all { None => Builtin::JobAs, Some(all) => Builtin::JobQuery { program: Box::new(query.program.clone()), cursor: None, all } };
        query.program.body = vec![Stmt::Return(Expr::Builtin { builtin, args: vec![Expr::Block {
            body: vec![Stmt::Require { condition: Expr::Literal(Value::Bool(false)), code: "ARGUMENT_EXECUTED".into(), site: None }],
            value: Box::new(Expr::Literal(Value::Null)),
        }; if all.is_none() { 2 } else { 1 }] })];
        if loop_domain {
            let Stmt::Return(value) = query.program.body.pop().unwrap() else { panic!() };
            query.program.body = vec![Stmt::For { binding: "row".into(), domain: snapback4_core::ir::LoopDomain::DerivedArray { value, max: 100, bound_source: "query".into() }, body: vec![] }];
        }
        let backend = Backend { generation: 1, schema: b.schema, programs: b.programs.into_iter().map(|p| p.program).collect() };
        let mut device = Device::open_store(MemoryStore::new(), Some(backend)).unwrap();
        let error = device.query("ordinary", "user:alice", &serde_json::json!({}), 0).unwrap_err();
        assert!(error.message.contains("job viewer reads require a server job scope"), "{all:?}: {error:?}");
    }
}
