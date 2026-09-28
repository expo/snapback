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
fn setup(groups: usize) -> Engine {
    let b = bound(SOURCE);
    let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    let id = |s: &str| Value::Id(s.into());
    let mut rows = Vec::new();
    for group in 0..=groups {
        let room = format!("room{group:05}");
        rows.push(("members".into(), object([("id", id(&room)), ("room", id(&room)), ("principal", id(if group == groups {"bob"} else {"alice"}))])));
        for at in 0..5 {
            rows.push(("messages".into(), object([("id", id(&format!("{room}-{at}"))), ("room", id(&room)), ("body", Value::String(if at == 1 {"coffee rare"} else {"coffee zebra"}.into())), ("at", Value::Int(at)), ("tombstone", Value::Bool(at == 4))])));
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
#[test]
fn a_standalone_bare_program_provisions_its_scoped_index() {
    let source = SOURCE.replace("query explicit(q: text <=100, c: cursor ?):\n  return messages matching q where exists members[.room, viewer] and not .tombstone last 2 by .at after c\n", "");
    let b = bound(&source);
    let program = &b.programs.iter().find(|p| p.program.name == "ordinary").unwrap().program;
    assert!(snapback4_core::search_plan::ordinary::plan(&b.schema, program).is_some());
    assert!(snapback4_core::search_plan::merges(&program.body).is_empty(), "device keeps the bare scan");
}
#[test]
fn guards_explicit_predicates_held_and_nonmembers_keep_their_meaning() {
    let b = bound(SOURCE);
    for name in ["explicit", "guarded", "held"] {
        let program = &b.programs.iter().find(|p| p.program.name == name).unwrap().program;
        assert!(snapback4_core::search_plan::ordinary::plan(&b.schema, program).is_none(), "{name}");
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
