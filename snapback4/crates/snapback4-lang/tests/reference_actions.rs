//! Referential actions (LLP 3000.038): restrict by default, cascade, set null
//! and keep, compiled and run against the engine.
use snapback4_core::{Context, Engine, Value, WriteState, value::object};

const SCHEMA: &str = r#"
table projects:
  owner: principal
  name: text <=80
  read <- allow
  insert <- .owner = viewer
  delete <- .owner = viewer

table tasks:
  project: projects on delete cascade
  owner: principal
  category: categories ? on delete set null
  title: text <=200
  cap 50 by project
  cap 50 by category
  read <- .owner = viewer
  insert <- .owner = viewer
  delete <- .owner = viewer

table categories:
  owner: principal
  read <- allow
  delete <- .owner = viewer

table comments:
  task: tasks
  author: principal
  read <- .author = viewer
  insert <- .author = viewer
  delete <- .author = viewer

table history:
  task: tasks on delete keep
  read <- allow

mutation dropProject(id: projects):
  delete projects[id]

mutation dropTask(id: tasks):
  delete tasks[id]

mutation dropCategory(id: categories):
  delete categories[id]

mutation dropComment(id: comments):
  delete comments[id]
"#;

fn bound(source: &str) -> snapback4_lang::Bound {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:#?}", b.diagnostics);
    b
}
fn engine(source: &str) -> Engine {
    let b = bound(source);
    Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap()
}
fn id(s: &str) -> Value { Value::Id(s.into()) }
fn row(table: &str, fields: &[(&str, Value)]) -> (String, Value) { (table.into(), object(fields.iter().cloned())) }
fn ctx(viewer: &str, args: &[(&str, Value)]) -> Context {
    Context::new(viewer, args.iter().map(|(k, v)| (k.to_string(), v.clone())).collect()).at(1_000)
}
fn count(e: &Engine, table: &str) -> usize { e.store().rows(table).unwrap().len() }
fn refusal(outcome: &snapback4_core::MutationOutcome) -> Option<String> {
    match &outcome.state { WriteState::Failed { why, .. } => Some(why.code.clone()), _ => None }
}

fn world(tasks: usize) -> Engine {
    let mut e = engine(SCHEMA);
    let mut rows = vec![
        row("projects", &[("id", id("p")), ("owner", id("alice")), ("name", Value::String("P".into()))]),
        row("categories", &[("id", id("c")), ("owner", id("alice"))]),
    ];
    for i in 0..tasks {
        rows.push(row("tasks", &[("id", id(&format!("t{i}"))), ("project", id("p")), ("owner", id("bob")), ("category", Value::Null), ("title", Value::String("x".into()))]));
    }
    e.seed_at(rows, 500).unwrap();
    e
}

#[test]
fn cascade_deletes_hidden_children_and_the_trace_is_schema_fixed() {
    let mut empty = world(0);
    let mut full = world(9);
    let a = empty.mutate("dropProject", None, ctx("alice", &[("id", id("p"))])).unwrap();
    let b = full.mutate("dropProject", None, ctx("alice", &[("id", id("p"))])).unwrap();
    assert_eq!(refusal(&a), None, "{a:?}");
    assert_eq!(refusal(&b), None, "{b:?}");
    assert_eq!(count(&full, "tasks"), 0);
    assert_eq!(count(&full, "projects"), 0);
    assert_eq!(a.metered, b.metered, "the meter does not depend on hidden children");
    assert_eq!(a.tables, b.tables, "the touched tables do not depend on hidden children");
    assert_eq!(a.events, b.events, "the event count does not depend on hidden children");
}

#[test]
fn restrict_is_the_default_and_names_the_reference() {
    let mut e = world(1);
    e.seed_at(vec![row("comments", &[("id", id("k")), ("task", id("t0")), ("author", id("carol"))])], 600).unwrap();
    // bob may delete his task, but carol's comment (hidden from bob) still names it.
    let out = e.mutate("dropTask", None, ctx("bob", &[("id", id("t0"))])).unwrap();
    assert_eq!(refusal(&out).as_deref(), Some("E_REFERENCED"), "{out:?}");
    let WriteState::Failed { why, .. } = &out.state else { unreachable!() };
    assert!(why.message.contains("comments.task"), "{why:?}");
    assert_eq!(count(&e, "tasks"), 1);
    // The cascade carries the restrict: alice's project delete reaches t0, which carol's comment holds.
    let out = e.mutate("dropProject", None, ctx("alice", &[("id", id("p"))])).unwrap();
    assert_eq!(refusal(&out).as_deref(), Some("E_REFERENCED"), "{out:?}");
    assert_eq!(count(&e, "projects"), 1);
    assert_eq!(count(&e, "tasks"), 1, "a refused delete commits nothing");
    // With the comment gone, both go.
    assert_eq!(refusal(&e.mutate("dropComment", None, ctx("carol", &[("id", id("k"))])).unwrap()), None);
    assert_eq!(refusal(&e.mutate("dropProject", None, ctx("alice", &[("id", id("p"))])).unwrap()), None);
    assert_eq!((count(&e, "projects"), count(&e, "tasks")), (0, 0));
}

#[test]
fn set_null_clears_and_keep_keeps() {
    let mut e = world(2);
    let mut rows = Vec::new();
    for i in 0..2 {
        rows.push(row("tasks", &[("id", id(&format!("c{i}"))), ("project", id("p")), ("owner", id("bob")), ("category", id("c")), ("title", Value::String("y".into()))]));
    }
    rows.push(row("history", &[("id", id("h")), ("task", id("t0"))]));
    e.seed_at(rows, 600).unwrap();
    let out = e.mutate("dropCategory", None, ctx("alice", &[("id", id("c"))])).unwrap();
    assert_eq!(refusal(&out), None, "{out:?}");
    assert!(e.store().rows("tasks").unwrap().iter().all(|t| t.field("category").map_or(true, |c| *c == Value::Null)));
    assert_eq!(count(&e, "tasks"), 4);
    let out = e.mutate("dropTask", None, ctx("bob", &[("id", id("t0"))])).unwrap();
    assert_eq!(refusal(&out), None, "keep does not refuse: {out:?}");
    assert_eq!(count(&e, "history"), 1, "keep keeps the history row");
}

#[test]
fn a_referenced_table_needs_read_authority_to_delete() {
    let source = r#"
table boxes:
  owner: principal
  read <- deny
  delete <- allow
table items:
  box: boxes
  read <- allow
mutation dropBox(id: boxes):
  delete boxes[id]
"#;
    let mut e = engine(source);
    e.seed_at(vec![row("boxes", &[("id", id("b")), ("owner", id("alice"))])], 500).unwrap();
    let out = e.mutate("dropBox", None, ctx("alice", &[("id", id("b"))])).unwrap();
    assert_eq!(refusal(&out).as_deref(), Some("NOT_FOUND"), "a non-reader gets the hidden-target refusal: {out:?}");
}

#[test]
fn a_diamond_deletes_together_and_the_reported_reference_is_in_schema_order() {
    let source = r#"
table roots:
  read <- allow
  delete <- allow
table aa:
  root: roots on delete cascade
  read <- deny
  cap 10 by root
table bb:
  root: roots on delete cascade
  a: aa ?
  read <- deny
  cap 10 by root
table xx:
  a: aa
  read <- deny
table yy:
  a: aa
  read <- deny
mutation dropRoot(id: roots):
  delete roots[id]
"#;
    // bb restricts aa, but every bb row goes with the root too: the diamond deletes.
    let mut e = engine(source);
    e.seed_at(vec![row("roots", &[("id", id("r"))]), row("aa", &[("id", id("a1")), ("root", id("r"))]), row("bb", &[("id", id("b1")), ("root", id("r")), ("a", id("a1"))])], 500).unwrap();
    assert_eq!(refusal(&e.mutate("dropRoot", None, ctx("alice", &[("id", id("r"))])).unwrap()), None);
    assert_eq!((count(&e, "aa"), count(&e, "bb")), (0, 0));
    // Two hidden aa rows, each held by a different table: whichever aa row the
    // walk meets first, the refusal names the first occupied reference in schema order.
    for (x, y) in [("a1", "a2"), ("a2", "a1")] {
        let mut e = engine(source);
        e.seed_at(vec![row("roots", &[("id", id("r"))]), row("aa", &[("id", id("a1")), ("root", id("r"))]), row("aa", &[("id", id("a2")), ("root", id("r"))]),
            row("xx", &[("id", id("x")), ("a", id(x))]), row("yy", &[("id", id("y")), ("a", id(y))])], 500).unwrap();
        let out = e.mutate("dropRoot", None, ctx("alice", &[("id", id("r"))])).unwrap();
        let WriteState::Failed { why, .. } = &out.state else { panic!("{out:?}") };
        assert_eq!(why.code, "E_REFERENCED");
        assert!(why.message.contains("xx.a"), "{why:?}");
    }
}

#[test]
fn a_self_reference_on_the_root_does_not_hide_an_outside_holder() {
    let source = r#"
table nodes:
  parent: nodes ?
  read <- allow
  delete <- allow
mutation drop(id: nodes):
  delete nodes[id]
"#;
    // a names itself and sorts first under its own id; b names a from outside.
    let mut e = engine(source);
    e.seed_at(vec![row("nodes", &[("id", id("a")), ("parent", id("a"))]), row("nodes", &[("id", id("b")), ("parent", id("a"))])], 500).unwrap();
    let out = e.mutate("drop", None, ctx("alice", &[("id", id("a"))])).unwrap();
    assert_eq!(refusal(&out).as_deref(), Some("E_REFERENCED"), "{out:?}");
    // A row that names only itself is no holder.
    assert_eq!(refusal(&e.mutate("drop", None, ctx("alice", &[("id", id("b"))])).unwrap()), None);
    assert_eq!(refusal(&e.mutate("drop", None, ctx("alice", &[("id", id("a"))])).unwrap()), None);
    assert_eq!(count(&e, "nodes"), 0);
}

#[test]
fn set_null_writes_each_row_from_its_current_image() {
    let source = r#"
table categories:
  read <- allow
  delete <- allow
table nodes:
  category: categories ? on delete set null
  parent: nodes ? on delete keep
  filed: count nodes where .category != null by parent
  cap 20 by category
  read <- allow
  delete <- allow
  online only
mutation dropCategory(id: categories):
  delete categories[id]
"#;
    // Clearing a's category recounts b's `filed`; b's own clear must not write back its stale count.
    let mut e = engine(source);
    let mut rows = vec![row("categories", &[("id", id("c"))]), row("nodes", &[("id", id("a")), ("category", id("c")), ("parent", id("b"))]), row("nodes", &[("id", id("b")), ("category", id("c")), ("parent", Value::Null)])];
    // More rows than a page, so the walk resumes past what it already cleared.
    for i in 0..7 { rows.push(row("nodes", &[("id", id(&format!("n{i}"))), ("category", id("c")), ("parent", Value::Null)])); }
    e.seed_at(rows, 500).unwrap();
    let out = e.mutate("dropCategory", None, ctx("alice", &[("id", id("c"))])).unwrap();
    assert_eq!(refusal(&out), None, "{out:?}");
    let nodes = e.store().rows("nodes").unwrap();
    assert_eq!(nodes.len(), 9);
    assert!(nodes.iter().all(|n| n.field("category").is_ok_and(|c| *c == Value::Null)), "{nodes:?}");
    let b = nodes.iter().find(|n| n.field("id").is_ok_and(|i| *i == id("b"))).unwrap();
    assert_eq!(b.field("filed").unwrap(), &Value::Int(0), "{b:?}");
}

#[test]
fn the_reply_counts_events_by_schema_not_by_what_actions_reached() {
    let source = r#"
table projects:
  tasks: count tasks by project
  read <- allow
  delete <- allow
  online only
table tasks:
  project: projects on delete keep
  bucket: projects on delete cascade
  cap 10 by bucket
  read <- deny
  online only
mutation drop(id: projects):
  delete projects[id]
"#;
    // The same readable root, one task naming it either way; only the hidden bucket differs.
    let run = |bucket: &str| {
        let mut e = engine(source);
        e.seed_at(vec![row("projects", &[("id", id("p"))]), row("projects", &[("id", id("q"))]), row("tasks", &[("id", id("t")), ("project", id("p")), ("bucket", id(bucket))])], 500).unwrap();
        let out = e.mutate("drop", None, ctx("alice", &[("id", id("p"))])).unwrap();
        assert_eq!(refusal(&out), None, "{out:?}");
        (out.events, out.tables, out.metered)
    };
    assert_eq!(run("q"), run("p"));
}

fn diagnostics(source: &str) -> Vec<String> {
    snapback4_lang::compile(&[("schema.q".into(), source.into())]).diagnostics.iter().map(|d| format!("{}: {}", d.code, d.message)).collect()
}

#[test]
fn check_refuses_what_a_column_cannot_carry() {
    let base = "table parents:\n  read <- allow\n  delete <- allow\n";
    let cases = [
        ("table kids:\n  parent: parents on delete cascade\n  read <- allow\n", "E_CASCADE_BOUND"),
        ("table kids:\n  parent: parents on delete set null\n  cap 5 by parent\n  read <- allow\n", "E_REFERENCE_ACTION"),
        ("table kids:\n  parent: parents ? on delete set null\n  cap 5 by parent\n  read <- exists parents[.parent]\n", "E_REFERENCE_ACTION"),
        ("table kids:\n  parent: parents ? on delete set null\n  cap 5 by parent\n  immutable parent\n  read <- allow\n", "E_REFERENCE_ACTION"),
        ("table kids:\n  parent: parents on delete cascade\n  author: principal\n  score: int default 0 written by .author\n  cap 5 by parent\n  read <- allow\n", "E_REFERENCE_ACTION"),
        ("table kids:\n  title: text on delete cascade\n  read <- allow\n", "E_REFERENCE_ACTION"),
        ("table kids:\n  parent: kids ? on delete cascade\n  cap 5 by parent\n  read <- allow\n", "E_REFERENCE_ACTION"),
    ];
    for (kids, code) in cases {
        let found = diagnostics(&format!("{base}{kids}"));
        assert!(found.iter().any(|d| d.starts_with(code)), "{kids}\n{found:#?}");
    }
    // Another table's probe keyed on the column carries authority too.
    let grants = format!("{base}table docs:\n  home: parents\n  read <- exists kids[folder = .home, doc = .id]\ntable kids:\n  folder: parents ? on delete set null\n  doc: docs\n  unique folder, doc\n  cap 5 by folder\n  read <- allow\n");
    assert!(diagnostics(&grants).iter().any(|d| d.starts_with("E_REFERENCE_ACTION")), "{:#?}", diagnostics(&grants));
}

#[test]
fn check_names_the_delete_sites_the_default_changed() {
    let notes = |source: &str| snapback4_lang::compile(&[("schema.q".into(), source.into())]).notes.iter().filter(|n| n.code == "N_DELETE_RESTRICTED").map(|n| n.message.clone()).collect::<Vec<_>>();
    let source = "table parents:\n  read <- allow\n  delete <- allow\ntable kids:\n  parent: parents\n  read <- allow\nmutation drop(id: parents):\n  delete parents[id]\n";
    assert_eq!(notes(source).len(), 1, "{:?}", notes(source));
    for action in ["restrict", "keep"] {
        let declared = source.replace("parent: parents\n", &format!("parent: parents on delete {action}\n"));
        assert!(notes(&declared).is_empty(), "{action}");
    }
    assert!(notes(&source.replace("mutation drop(id: parents):\n  delete parents[id]\n", "")).is_empty(), "no delete site, no note");
}
