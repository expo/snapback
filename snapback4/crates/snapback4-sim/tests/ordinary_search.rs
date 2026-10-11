//! The ordinary search has a server audience plan and keeps its device body.
use snapback4_core::{Context, Engine, Value, value::object};

const SOURCE: &str = r#"
table members:
  room: id
  principal: principal
  unique room, principal
  read <- exists members[.room, viewer]
  delete <- .principal = viewer
  sync to members[.room]
table messages:
  immutable room
  room: id
  body: text <=2000
  at: time
  tombstone: bool
  search body
  read <- exists members[.room, viewer]
  retain delivered-history
  sync to members[.room] last 2 by .at
query ordinary(q: text <=100, c: cursor ?):
  return messages matching q where not .tombstone last 2 by .at after c
query explicit(q: text <=100, c: cursor ?):
  return messages matching q where exists members[.room, viewer] and not .tombstone last 2 by .at after c
query held(q: text <=100, c: cursor ?) held:
  return messages matching q where not .tombstone last 2 by .at after c
query guarded(room: id, q: text <=100, c: cursor ?):
  require exists members[room, viewer] else NOT_MEMBER
  return messages[room = room] matching q where not .tombstone last 2 by .at after c
mutation leave(id: id):
  delete members[id]
"#;


fn bound(source: &str) -> snapback4_lang::bind::Bound {
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    bound
}
fn setup(groups: usize) -> Engine { setup_source(SOURCE, groups) }
fn setup_source(source: &str, groups: usize) -> Engine {
    setup_bound(bound(source), groups)
}
fn setup_bound(b: snapback4_lang::bind::Bound, groups: usize) -> Engine {
    let scope = if b.schema.tables["messages"].columns.contains_key("zone") { "zone" } else { "room" };
    let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    let id = |s: &str| Value::Id(s.into());
    let mut rows = Vec::new();
    for group in 0..=groups {
        let room = format!("room{group:05}");
        rows.push(("members".into(), object([("id", id(&room)), (scope, id(&room)), ("principal", id(if group == groups {"bob"} else {"alice"}))])));
        for at in 0..5 {
            rows.push(("messages".into(), object([("id", id(&format!("{room}-{at}"))), (scope, id(&room)), ("body", Value::String(if at == 1 {"coffee rare"} else {"coffee zebra"}.into())), ("at", Value::Int(at)), ("tombstone", Value::Bool(at == 4))])));
        }
    }
    engine.seed_at(rows, 100).unwrap();
    engine
}
fn cx(q: &str, cursor: Option<String>) -> Context {
    Context::new("alice", [("q".into(), Value::String(q.into())), ("c".into(), cursor.map(Value::String).unwrap_or(Value::Null))].into()).at(100)
}
fn walk(engine: &mut Engine, name: &str, q: &str) -> Vec<Value> {
    let mut cursor = None;
    let mut rows = Vec::new();
    for _ in 0..100 {
        let page = engine.query(name, cx(q, cursor)).unwrap();
        assert!(page.complete, "{page:?}");
        rows.extend(page.data.as_array().unwrap().iter().cloned());
        cursor = page.next;
        if cursor.is_none() { return rows; }
    }
    panic!("no progress");
}
#[test]
fn ordinary_server_matches_explicit_pages() {
    let mut engine = setup(4);
    for q in ["coffee", "cof", "cof zeb", "rare", "absent"] {
        let expected = walk(&mut engine, "explicit", q);
        let actual = walk(&mut engine, "ordinary", q);
        assert_eq!(actual, expected, "{q}");
        assert!(actual.windows(2).all(|p| p[0].field("id").unwrap() != p[1].field("id").unwrap()));
    }
}
fn standalone() -> String {
    SOURCE.split("query explicit").next().unwrap().to_owned()
}
#[test]
fn a_standalone_bare_program_provisions_its_scoped_index() {
    let source = standalone();
    let b = bound(&source);
    assert_eq!(b.programs.len(), 1, "no guarded/explicit query can supply the index");
    let program = &b.programs[0].program;
    let plan = snapback4_core::search_plan::ordinary::plan(&b.schema, program).unwrap();
    let table = &b.schema.tables["messages"];
    let original = &table.indexes[&plan.cursor_indexes.1];
    let scoped = &table.indexes[&plan.cursor_indexes.0];
    assert_eq!(scoped.components[0].column().map(String::as_str), Some("room"));
    assert_eq!(scoped.components[1..], original.components);
    let composed = b.schema.operations["ordinary"].search.as_ref().unwrap();
    assert_eq!((&*composed.needle, &*composed.cursor, &*composed.column, composed.limit), ("q", "c", "at", 2));
    assert!(snapback4_core::search_plan::merges(&program.body).is_empty(), "device keeps the bare scan");
    let mut engine = setup_bound(b, 2);
    let mut oracle = setup(2);
    let expected = walk(&mut oracle, "explicit", "coffee");
    assert_eq!(expected.len(), 8);
    assert_eq!(walk(&mut engine, "ordinary", "coffee"), expected);
}
#[test]
fn system_search_keeps_the_original_evaluator() {
    let mut engine = setup(2);
    let mut original = bound(SOURCE);
    original.programs.iter_mut().find(|p| p.program.name == "ordinary").unwrap().program.body.insert(0,
        snapback4_core::ir::Stmt::Require { condition: snapback4_core::ir::Expr::Literal(Value::Bool(true)), code: "CONTROL".into(), site: None, message: None });
    let mut original = setup_bound(original, 2);
    let mut cursor = None;
    let mut count = 0;
    loop {
        let mut context = Context::system().at(100);
        context.args = cx("coffee", cursor).args;
        let expected = original.query("ordinary", context.clone()).unwrap();
        let actual = engine.query("ordinary", context).unwrap();
        assert_eq!(actual.data, expected.data);
        assert_eq!(actual.complete, expected.complete);
        assert_eq!(actual.next, expected.next);
        assert_eq!(actual.cut, expected.cut);
        assert!(actual.search_scopes.is_none());
        count += actual.data.as_array().unwrap().len();
        cursor = actual.next;
        if cursor.is_none() { break; }
    }
    assert_eq!(count, 12, "system sees all three rooms, including Bob's");
}
#[test]
fn denied_discovery_cannot_add_or_reject_an_optional_index() {
    speculative_index_fallback("deny", 380);
    speculative_index_fallback("deny", 20);
}
#[test]
fn readable_discovery_with_an_oversized_key_keeps_the_baseline() {
    speculative_index_fallback(".principal = viewer", 380);
}
fn speculative_index_fallback(read: &str, max: usize) {
    let source = format!(r#"
table members:
  room: text <={max}
  principal: principal
  unique room, principal
  read <- {read}
  online only
table messages:
  room: text <={max}
  body: text <=2000
  at: time
  search body
  read <- exists members[.room, viewer]
  sync to members[.room] last 2 by .at
query ordinary(q: text <=100, c: cursor ?):
  return messages matching q last 2 by .at after c
"#);
    // held suppresses optional provisioning without changing the authored IR.
    let mut baseline = bound(&source.replace("c: cursor ?):", "c: cursor ?) held:"));
    baseline.schema.operations.get_mut("ordinary").unwrap().held = false;
    let candidate = bound(&source);
    assert_eq!(candidate.schema.tables, baseline.schema.tables);
    assert_eq!(candidate.programs[0].program, baseline.programs[0].program);
    assert!(candidate.schema.operations["ordinary"].search.is_none());
    let seed = vec![
        ("members".into(), object([("id", Value::Id("member".into())), ("room", Value::String("room".into())), ("principal", Value::Id("alice".into()))])),
        ("messages".into(), object([("id", Value::Id("message".into())), ("room", Value::String("room".into())), ("body", Value::String("coffee".into())), ("at", Value::Int(1))])),
    ];
    let mut old = Engine::memory(baseline.schema, baseline.programs.into_iter().map(|p| p.program)).unwrap();
    let mut new = Engine::memory(candidate.schema, candidate.programs.into_iter().map(|p| p.program)).unwrap();
    old.seed_at(seed.clone(), 100).unwrap(); new.seed_at(seed, 100).unwrap();
    let expected = old.query("ordinary", cx("coffee", None)).unwrap();
    let actual = new.query("ordinary", cx("coffee", None)).unwrap();
    assert_eq!(actual.data, expected.data);
    assert_eq!(actual.complete, expected.complete);
    assert_eq!(actual.next, expected.next);
    assert_eq!(actual.metered, expected.metered);
}
#[test]
fn an_optional_index_label_over_budget_keeps_the_baseline() {
    let bare = standalone();
    let held = bare.replace("c: cursor ?):", "c: cursor ?) held:");
    let baseline = bound(&held);
    let longest = baseline.schema.tables["messages"].indexes.keys().map(String::len).max().unwrap();
    let table = "m".repeat(snapback4_core::rows::MAX_INDEX_LABEL_BYTES - longest);
    let baseline = bound(&held.replace("messages", &table));
    let actual = bound(&bare.replace("messages", &table));
    assert_eq!(actual.schema.tables, baseline.schema.tables);
    assert!(snapback4_core::search_plan::ordinary::plan(&actual.schema, &actual.programs[0].program).is_none());
}
#[test]
fn audience_proof_requires_the_exact_sync_target_and_prefix() {
    use snapback4_core::schema::Audience;
    let b = bound(&standalone());
    assert!(snapback4_core::search_plan::ordinary::plan(&b.schema, &b.programs[0].program).is_some());
    for audience in [
        Audience::Public,
        Audience::Target { table: "otherMembers".into(), prefix: vec!["room".into()], principal: "principal".into() },
        Audience::Target { table: "members".into(), prefix: vec!["otherRoom".into()], principal: "principal".into() },
    ] {
        // Isolate this proof guard on bound IR, without an earlier source
        // compiler refusal masking a missing runtime admission condition.
        let mut schema = b.schema.clone();
        schema.tables.get_mut("messages").unwrap().sync.as_mut().unwrap().audience = audience;
        assert!(snapback4_core::search_plan::ordinary::plan(&schema, &b.programs[0].program).is_none());
    }
}
#[test]
fn scope_after_an_equality_pin_still_gets_a_complete_paginated_plan() {
    let source = standalone().replace("room", "zone");
    let b = bound(&source);
    let plan = snapback4_core::search_plan::ordinary::plan(&b.schema, &b.programs[0].program).unwrap();
    let index = &b.schema.tables["messages"].indexes[&plan.cursor_indexes.0];
    assert_eq!(index.components[0].column().map(String::as_str), Some("zone"));
    assert_eq!(index.components[1].column().map(String::as_str), Some("tombstone"));
    let mut engine = setup_bound(b, 2);
    engine.seed_at((0..20000).map(|n| ("messages".into(), object([
        ("id", Value::Id(format!("hidden-{n}"))), ("zone", Value::Id("room00002".into())),
        ("body", Value::String("coffee secret".into())), ("at", Value::Int(1000 + n)), ("tombstone", Value::Bool(false)),
    ]))).collect::<Vec<_>>(), 100).unwrap();
    let actual = walk(&mut engine, "ordinary", "coffee");
    let mut oracle = setup_source(&SOURCE.replace("room", "zone"), 2);
    assert_eq!(actual, walk(&mut oracle, "explicit", "coffee"));
    assert_eq!(actual.len(), 8);
}
#[test]
fn guards_explicit_predicates_held_and_nonmembers_keep_their_meaning() {
    let b = bound(SOURCE);
    for name in ["explicit", "guarded", "held"] {
        let program = &b.programs.iter().find(|p| p.program.name == name).unwrap().program;
        assert!(snapback4_core::search_plan::ordinary::plan(&b.schema, program).is_none(), "{name}");
        assert!(b.schema.operations[name].search.is_none());
    }
    let mut engine = setup(2);
    engine.mutate("leave", None, Context::new("alice", [("id".into(), Value::Id("room00001".into()))].into())).unwrap();
    assert_eq!(walk(&mut engine, "ordinary", "coffee"), walk(&mut engine, "explicit", "coffee"));
    let mut context = cx("coffee", None);
    context.args.insert("room".into(), Value::Id("room00001".into()));
    assert_eq!(engine.query("guarded", context).unwrap_err().code, "NOT_MEMBER");
    assert_eq!(engine.query("held", cx("coffee", None)).unwrap_err().code, "E_QUERY_HELD");
}
#[test]
fn unsupported_audiences_and_authored_guards_do_not_infer() {
    let sources = [
        SOURCE.replace("  sync to members[.room] last 2 by .at", "  online only"),
        SOURCE.replacen("  principal: principal", "  principal: principal\n  until: time ?\n  expire at .until", 1),
        SOURCE.replace("query ordinary(q: text <=100, c: cursor ?):", "query ordinary(q: text <=100, c: cursor ?):\n  require q != 'blocked' else BLOCKED"),
        SOURCE.replace("return messages matching q where not .tombstone last 2", "return messages matching q where not .tombstone and exists members[.room, viewer] last 2"),
        SOURCE.replacen("  read <- exists members[.room, viewer]", "  read <- deny", 1)
            .replacen("  sync to members[.room]\n", "", 1),
    ];
    for source in sources {
        let b = bound(&source);
        let program = &b.programs.iter().find(|p| p.program.name == "ordinary").unwrap().program;
        assert!(snapback4_core::search_plan::ordinary::plan(&b.schema, program).is_none());
    }
}
#[test]
fn empty_needle_keeps_existing_browse_and_variant_fence() {
    let mut engine = setup(2);
    let empty = engine.query("ordinary", cx(" !!! ", None)).unwrap();
    assert!(!empty.complete, "empty browse is still the existing evaluator");
    let page = engine.query("ordinary", cx("coffee", None)).unwrap();
    assert_eq!(engine.query("ordinary", cx("", page.next)).unwrap_err().code, "E_CURSOR_INDEX");
}
#[test]
fn ordinary_opening_refusal_and_drain_cuts_keep_consumed_positions() {
    use snapback4_core::Ceilings;
    let mut engine = setup(4);
    let oracle = walk(&mut engine, "explicit", "coffee");
    let full = engine.query("ordinary", cx("coffee", None)).unwrap();
    let mut drains = 0;
    for limit in 1..full.metered.examined {
        engine.set_ceilings(Ceilings { examined: limit, ..Ceilings::default() });
        match engine.query("ordinary", cx("coffee", None)) {
            Err(error) => assert_eq!(error.code, "E_SEARCH_OPEN"),
            Ok(page) => {
                assert!(!page.complete && page.next.is_some(), "{page:?}");
                let mut rows = page.data.as_array().unwrap().to_vec();
                engine.set_ceilings(Ceilings::default());
                let next = engine.query("ordinary", cx("coffee", page.next)).unwrap();
                rows.extend(next.data.as_array().unwrap().iter().cloned());
                assert_eq!(rows, oracle[..rows.len()]);
                drains += 1;
            }
        }
    }
    assert!(drains > 0);
}
#[test]
fn membership_scales_fit_or_refuse_without_claiming_an_opening() {
    for groups in [100, 1000, 10000] {
        let mut engine = setup(groups);
        let page = engine.query("ordinary", cx("coffee", None));
        if groups < 10000 {
            let page = page.unwrap();
            assert!(page.complete);
            assert_eq!(page.data, engine.query("explicit", cx("coffee", None)).unwrap().data);
        } else {
            assert_eq!(page.unwrap_err().code, "E_SEARCH_OPEN");
        }
    }
}

#[test]
fn unchanged_builder_programs_keep_identical_device_ir() {
    let source = include_str!("../../../experiments/p19-one-query/builder.q");
    let original = bound(source);
    let extended = bound(&format!("{source}\nquery osSearch(q: text <=100, c: cursor ?):\n  return messages matching q where not .tombstone last 20 by .at after c\n"));
    for old in &original.programs {
        let new = extended.programs.iter().find(|p| p.program.name == old.program.name).unwrap();
        assert_eq!(old.program, new.program, "{}", old.program.name);
    }
    let search = &extended.programs.iter().find(|p| p.program.name == "osSearch").unwrap().program;
    let plan = snapback4_core::search_plan::ordinary::plan(&extended.schema, search).unwrap();
    assert_eq!(plan.audience, "members[principal = viewer] by .conversation");
    for (name, table) in &original.schema.tables {
        assert_eq!(table.indexes, extended.schema.tables[name].indexes, "builder already has both search indexes: {name}");
    }
}

#[test]
fn a_hidden_population_does_not_change_the_inferred_page_or_receipt() {
    let mut engine = setup(2);
    let before = engine.query("ordinary", cx("coffee", None)).unwrap();
    engine.seed_at((0..1000).map(|n| ("messages".into(), object([
        ("id", Value::Id(format!("hidden-{n}"))), ("room", Value::Id("room00002".into())),
        ("body", Value::String("coffee secret".into())), ("at", Value::Int(1000 + n)), ("tombstone", Value::Bool(false)),
    ]))).collect::<Vec<_>>(), 100).unwrap();
    let after = engine.query("ordinary", cx("coffee", None)).unwrap();
    assert_eq!(before.data, after.data);
    assert_eq!(before.next, after.next);
    assert_eq!(before.complete, after.complete);
    assert_eq!(before.metered, after.metered);
}

#[test]
fn audience_proof_is_complete_authorized_and_bounded() {
    let mut engine = setup(2);
    engine.mutate("leave", None, Context::new("alice", [("id".into(), Value::Id("room00001".into()))].into())).unwrap();
    // Even with no matching message, the completed opening excludes both the
    // departed scope and another principal's scope from the proof.
    let page = engine.query("ordinary", cx("absent", None)).unwrap();
    assert!(page.data.as_array().unwrap().is_empty());
    assert_eq!(page.search_scopes, Some(vec![r#"["room00000"]"#.into()]));
    assert!(engine.query("explicit", cx("absent", None)).unwrap().search_scopes.is_none());
    engine.set_ceilings(snapback4_core::Ceilings { output_bytes: 40, ..Default::default() });
    assert_eq!(engine.query("ordinary", cx("absent", None)).unwrap_err().code, "E_SEARCH_OPEN");
}

#[test]
fn mutable_scope_composes_with_the_same_point_overlap_boundary() {
    for source in [SOURCE.to_owned(), SOURCE.replace("  immutable room\n", "")] {
        let b = bound(&source);
        let program = &b.programs.iter().find(|p| p.program.name == "ordinary").unwrap().program;
        assert!(b.schema.operations["ordinary"].search.is_some());
        assert!(snapback4_core::search_plan::ordinary::composition(&b.schema, program).is_some());
    }
}

#[test]
fn search_overlap_is_a_bounded_authorized_point_under_the_page_meter() {
    let mut engine = setup(2);
    let ids = vec!["room00000-4".into(), "room00002-1".into(), "missing".into()];
    // A readable tombstone does not match this query, but is still current.
    // Hidden and absent IDs are indistinguishable, and never echoed.
    let normal = engine.query("ordinary", cx("absent", None)).unwrap();
    let (page, cut, current) = engine.query_search_at("ordinary", cx("absent", None), Some(&ids));
    let page = page.unwrap();
    assert_eq!(current, Some(vec!["room00000-4".into()]));
    assert_eq!(cut, Some(page.seq));
    assert!(page.metered.examined >= normal.metered.examined + 2);
    assert!(page.metered.rule_probes > normal.metered.rule_probes);
    assert!(page.metered.output_bytes > normal.metered.output_bytes);
    assert!(engine.query_search_at("ordinary", cx("absent", None), Some(&["x".repeat(135)])).0.is_ok(), "overlap accepts the ordinary ID byte limit");
    let oversized = vec!["missing".into(); 4];
    assert_eq!(engine.query_search_at("ordinary", cx("coffee", None), Some(&oversized)).0.unwrap_err().code, "E_INPUT");
    assert_eq!(engine.query_search_at("explicit", cx("coffee", None), Some(&ids)).0.unwrap_err().code, "E_INPUT");
    engine.set_ceilings(snapback4_core::Ceilings { examined: 1, ..Default::default() });
    assert_eq!(engine.query_search_at("ordinary", cx("coffee", None), Some(&ids)).0.unwrap_err().code, "E_BOUND");
}

#[test]
fn emitted_row_identity_excludes_projected_ids() {
    let source = format!("{SOURCE}\nquery summaries(c: cursor ?):\n  return messages first 2 by .at after c {{ id: .room, body }}\n");
    let b = bound(&source);
    let ts = snapback4_lang::emit::typescript(&b);
    let ordinary = ts.lines().find(|line| line.contains("name: \"ordinary\"")).unwrap();
    let projected = ts.lines().find(|line| line.contains("name: \"summaries\"")).unwrap();
    assert!(ordinary.contains("rowKey: \"id\""), "{ordinary}");
    assert!(!projected.contains("rowKey"), "{projected}");
}
