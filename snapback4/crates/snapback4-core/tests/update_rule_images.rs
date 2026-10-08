//! An unnamed `update <- R` judges the row before and after the write.
//! Regression for the takeover the Lean oracle found (LLP 3000.035 §5.2,
//! signatures `lean--kind--committed~NOT_FOUND` and `~E_RULE`): under
//! `update <- .owner = viewer` without `immutable owner`, the engine judged
//! only the next image, so any caller could `update` or `upsert` another
//! principal's row with `owner: viewer` and take it over.
// @ref LLP 3000.007#8 — item 7(a): the update rule judges old and next; refusals follow the update/upsert table.
use snapback4_core::{Context, Engine, MutationOutcome, Value, WriteState, engine::local, meter::Ceilings, store::Store, value::object};

const NOW: i64 = 1_000;

fn source(read: &str, update: &str, extra: &str) -> String {
    format!(r#"table notes:
  owner: principal
  body: text <=100
  {extra}
  {read}
  insert <- .owner = viewer
  {update}
  delete <- .owner = viewer
  online only

mutation seed(key: id, owner: principal):
  upsert notes[key] {{ owner, body: 'mine' }}
  return true

mutation take(key: id, body: text <=100):
  update notes[key] {{ owner: viewer, body }}
  return true

mutation grab(key: id, body: text <=100):
  upsert notes[key] {{ owner: viewer, body }}
  return true

mutation edit(key: id, body: text <=100):
  update notes[key] {{ body }}
  return true

mutation give(key: id, to: principal):
  update notes[key] {{ owner: to }}
  return true

query peek(key: id):
  return notes[key]
"#).replace("  \n", "")
}

fn seeded(source: &str) -> Engine {
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.iter().all(|d| d.code.starts_with("N_")), "{:?}", bound.diagnostics);
    let mut engine = Engine::new(Store::memory().unwrap(), bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    let seeded = engine.mutate("seed", None, Context::system().with_args([("key", id("n1")), ("owner", id("bob"))]).at(NOW)).unwrap();
    assert!(matches!(seeded.state, WriteState::Sent { .. }), "{seeded:?}");
    engine
}

trait WithArgs { fn with_args<const N: usize>(self, args: [(&str, Value); N]) -> Self; }
impl WithArgs for Context {
    fn with_args<const N: usize>(mut self, args: [(&str, Value); N]) -> Self {
        self.args = args.into_iter().map(|(k, v)| (k.to_owned(), v)).collect();
        self
    }
}

fn id(text: &str) -> Value { Value::Id(text.into()) }
fn text(text: &str) -> Value { Value::String(text.into()) }

fn run(engine: &mut Engine, who: &str, op: &str, args: [(&str, Value); 2]) -> MutationOutcome {
    engine.mutate(op, None, Context::new(who, Default::default()).with_args(args).at(NOW)).unwrap()
}

fn refused(outcome: &MutationOutcome) -> String {
    match &outcome.state {
        WriteState::Failed { why, .. } => why.code.clone(),
        other => panic!("expected a refusal, got {other:?}"),
    }
}

fn committed(outcome: &MutationOutcome) {
    assert!(matches!(outcome.state, WriteState::Sent { .. }), "expected a commit, got {outcome:?}");
}

/// The stored row, read as the system.
fn row(engine: &mut Engine) -> (Value, Value) {
    let page = engine.query("peek", Context::system().with_args([("key", id("n1"))]).at(NOW)).unwrap();
    let data = page.data;
    (data.field("owner").unwrap().clone(), data.field("body").unwrap().clone())
}

const OWNER: &str = "update <- .owner = viewer";

#[test]
fn another_principal_cannot_take_over_a_row_by_writing_owner_viewer() {
    // Readable target: E_RULE. Unreadable target: NOT_FOUND, no detail.
    for (read, code) in [("read <- allow", "E_RULE"), ("read <- .owner = viewer", "NOT_FOUND")] {
        for op in ["take", "grab"] {
            let mut engine = seeded(&source(read, OWNER, ""));
            let outcome = run(&mut engine, "alice", op, [("key", id("n1")), ("body", text("mine now"))]);
            assert_eq!(refused(&outcome), code, "{read}: {op}");
            assert_eq!(row(&mut engine), (id("bob"), text("mine")), "{read}: {op} must leave bob's row unchanged");
            if code == "NOT_FOUND" {
                let reply = outcome.reply(None).to_string();
                assert!(!reply.contains("owner") && !reply.contains("notes"), "NOT_FOUND names no row, column or table: {reply}");
            }
        }
        // A patch that leaves owner alone is still judged on the old row.
        let mut engine = seeded(&source(read, OWNER, ""));
        assert_eq!(refused(&run(&mut engine, "alice", "edit", [("key", id("n1")), ("body", text("defaced"))])), code, "{read}: edit");
        assert_eq!(row(&mut engine), (id("bob"), text("mine")));
    }
}

#[test]
fn the_owner_still_updates_and_upserts_their_own_row() {
    for read in ["read <- allow", "read <- .owner = viewer"] {
        let mut engine = seeded(&source(read, OWNER, ""));
        committed(&run(&mut engine, "bob", "edit", [("key", id("n1")), ("body", text("edited"))]));
        assert_eq!(row(&mut engine), (id("bob"), text("edited")));
        committed(&run(&mut engine, "bob", "take", [("key", id("n1")), ("body", text("taken back"))]));
        committed(&run(&mut engine, "bob", "grab", [("key", id("n1")), ("body", text("upserted"))]));
        assert_eq!(row(&mut engine), (id("bob"), text("upserted")));
        // Giving the row away fails the next image, as before.
        assert_eq!(refused(&run(&mut engine, "bob", "give", [("key", id("n1")), ("to", id("carol"))])), "E_RULE", "{read}");
        assert_eq!(row(&mut engine), (id("bob"), text("upserted")));
    }
}

#[test]
fn a_named_transition_is_judged_as_written() {
    // An application that means "only the new owner matters" says so.
    let claim = "update (old, next) <- next.owner = viewer";
    let mut engine = seeded(&source("read <- allow", claim, ""));
    committed(&run(&mut engine, "alice", "take", [("key", id("n1")), ("body", text("claimed"))]));
    assert_eq!(row(&mut engine), (id("alice"), text("claimed")));
    // Both images, spelled out, agree with the unnamed rule.
    let both = "update (old, next) <- old.owner = viewer and next.owner = viewer";
    let mut engine = seeded(&source("read <- allow", both, ""));
    assert_eq!(refused(&run(&mut engine, "alice", "take", [("key", id("n1")), ("body", text("x"))])), "E_RULE");
    committed(&run(&mut engine, "bob", "edit", [("key", id("n1")), ("body", text("ok"))]));
}

#[test]
fn immutable_owner_still_refuses_and_judges_one_image() {
    for read in ["read <- allow", "read <- .owner = viewer"] {
        let mut engine = seeded(&source(read, OWNER, "immutable owner"));
        for op in ["take", "grab", "edit"] {
            let outcome = run(&mut engine, "alice", op, [("key", id("n1")), ("body", text("x"))]);
            let code = refused(&outcome);
            if read == "read <- allow" { assert!(["E_RULE", "E_CONSTRAINT"].contains(&code.as_str()), "{op}: {code}"); }
            else { assert_eq!(code, "NOT_FOUND", "{op}"); }
            assert_eq!(row(&mut engine), (id("bob"), text("mine")));
        }
        committed(&run(&mut engine, "bob", "edit", [("key", id("n1")), ("body", text("edited"))]));
    }
}

#[test]
fn a_probe_rule_is_judged_against_the_old_group_too() {
    // Moving a doc out of a group the caller does not belong to is a write to that group's row.
    let source = r#"table groups:
  public 'groups'
  insert <- allow
  online only

table members:
  team: groups
  principal: principal
  unique team, principal
  immutable team, principal
  read <- .principal = viewer
  insert <- .principal = viewer
  online only

table docs:
  team: groups
  body: text <=100
  read <- allow
  insert <- exists members[.team, viewer]
  update <- exists members[.team, viewer]
  online only

mutation setup():
  insert groups { id: 'a' }
  insert groups { id: 'b' }
  insert members { team: 'a', principal: 'alice' }
  insert members { team: 'b', principal: 'bob' }
  upsert docs['d1'] { team: 'b', body: 'bob team' }
  return true

mutation move(doc: id, team: groups):
  update docs[doc] { team }
  return true

mutation retitle(doc: id, body: text <=100):
  update docs[doc] { body }
  return true
"#;
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.iter().all(|d| d.code.starts_with("N_")), "{:?}", bound.diagnostics);
    let mut engine = Engine::new(Store::memory().unwrap(), bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    committed(&engine.mutate("setup", None, Context::system().at(NOW)).unwrap());
    let alice = |args: [(&str, Value); 2]| Context::new("alice", Default::default()).with_args(args).at(NOW);
    let bob = |args: [(&str, Value); 2]| Context::new("bob", Default::default()).with_args(args).at(NOW);
    let outcome = engine.mutate("move", None, alice([("doc", id("d1")), ("team", id("a"))])).unwrap();
    assert_eq!(refused(&outcome), "E_RULE", "alice may not pull team b's doc into team a");
    assert_eq!(refused(&engine.mutate("retitle", None, alice([("doc", id("d1")), ("body", text("x"))])).unwrap()), "E_RULE");
    committed(&engine.mutate("retitle", None, bob([("doc", id("d1")), ("body", text("still b"))])).unwrap());
}

#[test]
fn a_device_does_not_predict_the_takeover() {
    let source = source("public 'shared notes'", OWNER, "").replace("  online only\n", "  sync public\n");
    let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(bound.diagnostics.iter().all(|d| d.code.starts_with("N_")), "{:?}", bound.diagnostics);
    let mut store = Store::memory().unwrap();
    store.install(&bound.schema).unwrap();
    let rows = store.transaction().unwrap();
    rows.put("notes", &bound.schema.tables["notes"], &object([("id", id("n1")), ("owner", id("bob")), ("body", text("mine"))]), None).unwrap();
    let program = |name: &str| &bound.programs.iter().find(|p| p.program.name == name).unwrap().program;
    for (who, op, admitted) in [("alice", "take", false), ("alice", "grab", false), ("alice", "edit", false), ("bob", "edit", true), ("bob", "take", true)] {
        let context = Context::new(who, Default::default()).with_args([("key", id("n1")), ("body", text("x"))]).at(NOW);
        let prediction = local::predict(&rows, &bound.schema, program(op), context, Ceilings::default());
        match (admitted, prediction) {
            (true, Ok(_)) => {}
            (false, Err(error)) => assert_eq!(error.code(), "E_RULE", "{who} {op}: {error}"),
            (_, other) => panic!("{who} {op}: {other:?}"),
        }
        assert_eq!(rows.get("notes", "n1").unwrap().unwrap().field("owner"), Ok(&id("bob")));
    }
}
