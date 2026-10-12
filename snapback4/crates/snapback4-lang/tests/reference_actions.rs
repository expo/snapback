//! Referential actions (LLP 3000.039): restrict by default, cascade, set null
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

/// An index the reference shares with a maintained column: clearing one row
/// recounts another, which moves within the index behind a page cursor. The
/// walk gathers the group before it clears, so it misses no row.
#[test]
fn set_null_clears_rows_a_recount_moves_within_a_shared_index() {
    let source = r#"
table categories:
  read <- allow
  delete <- allow
table nodes:
  category: categories ? on delete set null
  parent: nodes ? on delete keep
  filed: count nodes where .category != null by parent
  by byCategoryCount: category, filed, id
  cap 20 by category
  read <- allow
  delete <- allow
  online only
mutation dropCategory(id: categories):
  delete categories[id]
"#;
    let mut e = engine(source);
    let node = |name: &str, parent: Value| row("nodes", &[("id", id(name)), ("category", id("k")), ("parent", parent)]);
    e.seed_at(vec![row("categories", &[("id", id("k"))]), node("a", id("b")), node("b", Value::Null), node("c", Value::Null), node("d", Value::Null), node("e", Value::Null)], 500).unwrap();
    let out = e.mutate("dropCategory", None, ctx("alice", &[("id", id("k"))])).unwrap();
    assert_eq!(refusal(&out), None, "{out:?}");
    let nodes = e.store().rows("nodes").unwrap();
    assert!(nodes.iter().all(|n| n.field("category").is_ok_and(|c| *c == Value::Null)), "{nodes:?}");
}

/// A cascaded row's write holds its asset and maintained-column reservations
/// at once, so the delete reserves their sum, not the larger of them.
#[test]
fn a_cascaded_write_reserves_its_concurrent_phases_together() {
    let source = r#"
table posts:
  body: text <=1000
  replies: count replies by post
  read <- allow
  delete <- allow
  online only
table replies:
  post: posts on delete cascade
  scans: [file <=1000000] <=50 ?
  cap 3 by post
  read <- allow
  online only
mutation drop(id: posts):
  delete posts[id]
"#;
    let b = bound(source);
    let plan = b.schema.write_reservation("replies").unwrap();
    let phases: u64 = (0..=snapback4_core::schema::reservations::VIEW_READ).map(|phase| plan.price(phase)[4]).sum();
    let largest = (0..=snapback4_core::schema::reservations::VIEW_READ).map(|phase| plan.price(phase)[4]).max().unwrap();
    assert!(phases > largest, "the schema exercises two concurrent phases: {phases} vs {largest}");
    let heap = b.schema.delete_reservation("posts").unwrap()[4];
    assert!(heap >= phases, "the delete reserves {heap} heap bytes, below the {phases} its child's write holds at once");
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

/// Only a zero requirement on the deleted key, before the delete, proves the
/// restrict default cannot refuse it: reading the count, or requiring another
/// key's count, does not silence N_DELETE_RESTRICTED.
#[test]
fn only_a_dominating_zero_count_on_the_deleted_key_silences_the_note() {
    let schema = "table slots:\n  read <- allow\n  delete <- allow\ntable bookings:\n  slot: slots\n  read <- allow\nview bookingsBySlot: count bookings by .slot\n  read <- allow\n";
    let notes = |program: &str| {
        let b = snapback4_lang::compile(&[("schema.q".into(), format!("{schema}{program}"))]);
        assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
        b.notes.iter().filter(|n| n.code == "N_DELETE_RESTRICTED").count()
    };
    assert_eq!(notes("mutation drop(slot: slots):\n  require bookingsBySlot[slot] = 0 else HAS_BOOKINGS\n  delete slots[slot]\n"), 0, "the guard");
    for unproven in [
        "mutation drop(slot: slots, other: slots):\n  n = bookingsBySlot[other]\n  delete slots[slot]\n  return n\n",
        "mutation drop(slot: slots, other: slots):\n  require bookingsBySlot[other] = 0 else HAS_BOOKINGS\n  delete slots[slot]\n",
        "mutation drop(slot: slots):\n  delete slots[slot]\n  require bookingsBySlot[slot] = 0 else HAS_BOOKINGS\n",
        "mutation drop(slot: slots):\n  n = bookingsBySlot[slot]\n  delete slots[slot]\n  return n\n",
        "mutation drop(slot: slots):\n  require bookingsBySlot[slot] = 0 else HAS_BOOKINGS\n  insert bookings { slot }\n  delete slots[slot]\n",
        "mutation drop(slot: slots, other: slots):\n  target = slot\n  require bookingsBySlot[target] = 0 else HAS_BOOKINGS\n  target = other\n  delete slots[target]\n",
        "mutation drop(slot: slots, other: slots, flag: bool):\n  target = slot\n  require bookingsBySlot[target] = 0 else HAS_BOOKINGS\n  if flag:\n    target = other\n  delete slots[target]\n",
        "fn book(slot: slots):\n  insert bookings { slot }\nmutation drop(slot: slots):\n  require bookingsBySlot[slot] = 0 else HAS_BOOKINGS\n  book(slot)\n  delete slots[slot]\n",
        "mutation drop(slot: slots, flag: bool):\n  if flag:\n    require bookingsBySlot[slot] = 0 else HAS_BOOKINGS\n  delete slots[slot]\n",
    ] {
        assert_eq!(notes(unproven), 1, "{unproven}");
    }
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
fn a_plain_unique_reference_is_a_cascade_cap_of_one() {
    let source = "table parents:\n  read <- allow\n  delete <- allow\ntable kids:\n  parent: parents on delete cascade\n  unique parent\n  read <- allow\nmutation drop(parent: parents):\n  delete parents[parent]\n";
    let b = bound(source);
    assert_eq!(b.schema.reference_cap("kids", "parent"), Some(1));
    assert!(b.schema.delete_reservation("parents").is_some());

    let both = source.replace("  unique parent\n", "  unique parent\n  cap 9 by parent\n");
    assert_eq!(bound(&both).schema.reference_cap("kids", "parent"), Some(1), "the tighter proven bound prices the cascade");

    let composite = source.replace("  unique parent\n", "  position: int\n  unique parent, position\n");
    let b = snapback4_lang::compile(&[("schema.q".into(), composite)]);
    assert!(b.diagnostics.iter().any(|diagnostic| diagnostic.code == "E_CASCADE_BOUND"), "{:#?}", b.diagnostics);
}

#[test]
fn a_denied_parent_delete_does_not_make_a_summed_child_safe_to_cascade() {
    let source = "table parents:\n  read <- allow\n  delete <- deny\ntable entries:\n  parent: parents on delete cascade\n  amount: int\n  unique parent\n  read <- allow\nview totals: sum entries of .amount by .parent\n";
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    let refusal = b.diagnostics.iter().find(|diagnostic| diagnostic.code == "E_REFERENCE_ACTION").unwrap_or_else(|| panic!("{:#?}", b.diagnostics));
    assert!(refusal.message.contains("system work") && refusal.message.contains("another parent"), "{refusal:#?}");
}

#[test]
fn delete_authority_that_structurally_implies_read_needs_no_note() {
    let source = |read: &str, delete: &str| format!("table parents:\n  owner: principal\n  assistant: principal ?\n  read <- {read}\n  delete <- {delete}\ntable kids:\n  parent: parents on delete restrict\n  read <- allow\nmutation drop(parent: parents):\n  delete parents[parent]\n");
    let has_note = |text: String| {
        let b = snapback4_lang::compile(&[("schema.q".into(), text)]);
        assert!(b.diagnostics.is_empty(), "{:#?}", b.diagnostics);
        b.notes.iter().any(|note| note.code == "N_DELETE_NEEDS_READ")
    };
    assert!(!has_note(source(".owner = viewer or .assistant = viewer", ".owner = viewer")));
    assert!(!has_note(source(".assistant = viewer", "deny")), "an impossible deleter implies every read rule");
    assert!(has_note(source(".assistant = viewer", ".owner = viewer")), "an unrelated deleter can still get NOT_FOUND");
    let admins = "table admins:\n  principal: principal\n  unique principal\n  read <- .principal = viewer\ntable parents:\n  owner: principal\n  read <- exists admins[viewer]\n  delete <- .owner = viewer\ntable kids:\n  parent: parents on delete restrict\n  read <- allow\nmutation drop(parent: parents):\n  delete parents[parent]\n";
    assert!(has_note(admins.into()), "a row-uniform admin rule does not admit every owner");
}

#[test]
fn a_reference_argument_that_is_never_looked_up_gets_a_note() {
    let schema = "table parents:\n  read <- allow\ntable kids:\n  parent: parents on delete keep\n  read <- allow\n  insert <- allow\n";
    let unchecked = format!("{schema}mutation create(id: id, parent: parents):\n  insert kids {{ id, parent }}\n");
    let b = bound(&unchecked);
    let note = b.notes.iter().find(|note| note.code == "N_REFERENCE_UNCHECKED").unwrap_or_else(|| panic!("{:#?}", b.notes));
    assert!(note.message.contains("parents[parent]") && note.rewrite.contains("NOT_FOUND"), "{note:#?}");

    let checked = format!("{schema}mutation create(id: id, parent: parents):\n  p = parents[parent] ! else NOT_FOUND\n  insert kids {{ id, parent: p.id }}\n");
    assert!(!bound(&checked).notes.iter().any(|note| note.code == "N_REFERENCE_UNCHECKED"));

    let rule_checked = "table parents:\n  read <- allow\ntable kids:\n  parent: parents on delete keep\n  read <- allow\n  insert <- exists parents[.parent]\nmutation create(id: id, parent: parents):\n  insert kids { id, parent }\n";
    assert!(!bound(rule_checked).notes.iter().any(|note| note.code == "N_REFERENCE_UNCHECKED"));

    let conditionally_checked = rule_checked.replace("insert <- exists parents[.parent]", "insert <- exists parents[.parent] or allow");
    assert!(bound(&conditionally_checked).notes.iter().any(|note| note.code == "N_REFERENCE_UNCHECKED"), "every admitted write path must prove existence");

    let hop_checked = "table parents:\n  active: bool\n  read <- allow\ntable kids:\n  parent: parents on delete keep\n  read <- allow\n  insert <- .parent.active = true\nmutation create(id: id, parent: parents):\n  insert kids { id, parent }\n";
    assert!(!bound(hop_checked).notes.iter().any(|note| note.code == "N_REFERENCE_UNCHECKED"));
    let hop_bypassed = hop_checked.replace("insert <- .parent.active = true", "insert <- .parent.active = true or allow");
    assert!(bound(&hop_bypassed).notes.iter().any(|note| note.code == "N_REFERENCE_UNCHECKED"));

    let update_checked = "table parents:\n  active: bool\n  read <- allow\ntable kids:\n  parent: parents on delete keep\n  read <- allow\n  update (old, next) <- exists parents[next.parent]\nmutation change(id: kids, parent: parents):\n  update kids[id] { parent }\n";
    assert!(!bound(update_checked).notes.iter().any(|note| note.code == "N_REFERENCE_UNCHECKED"));
    let old_exists = update_checked.replace("exists parents[next.parent]", "exists parents[old.parent]");
    assert!(bound(&old_exists).notes.iter().any(|note| note.code == "N_REFERENCE_UNCHECKED"), "the old parent is not the newly stored argument");
    let old_hop = update_checked.replace("exists parents[next.parent]", "old.parent.active = true");
    assert!(bound(&old_hop).notes.iter().any(|note| note.code == "N_REFERENCE_UNCHECKED"), "an old-image reference hop checks only the previous parent");
    let next_hop = update_checked.replace("exists parents[next.parent]", "next.parent.active = true");
    assert!(!bound(&next_hop).notes.iter().any(|note| note.code == "N_REFERENCE_UNCHECKED"));

    let through_checked = "table parents:\n  read <- allow\ntable kids:\n  parent: parents on delete cascade\n  immutable parent\n  unique parent\n  read through .parent\n  insert <- allow\nmutation create(id: id, parent: parents):\n  insert kids { id, parent }\n";
    assert!(!bound(through_checked).notes.iter().any(|note| note.code == "N_REFERENCE_UNCHECKED"));

    let after_insert = "table parents:\n  read <- allow\ntable kids:\n  parent: parents on delete keep\n  read <- allow\n  insert <- allow\n  update <- allow\n  after insert <- exists parents[.parent]\nmutation create(id: id, parent: parents):\n  insert kids { id, parent }\nmutation put(id: id, parent: parents):\n  upsert kids[id] { parent }\n";
    let notes: Vec<_> = bound(after_insert).notes.into_iter().filter(|note| note.code == "N_REFERENCE_UNCHECKED").collect();
    assert_eq!(notes.len(), 1, "after insert proves only the insert arm: {notes:#?}");
    assert!(notes[0].message.contains("mutation put"), "{notes:#?}");
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

/// A `set null` write consults no rule of the child (LLP 3000.039 §4.1): its
/// read rule's probes would draw on the request's physical authorization
/// allowance only when a child exists, so a delete whose reservation leaves
/// none would refuse only in the world with a hidden child (§4.2).
#[test]
fn set_null_draws_nothing_from_the_authorization_allowance() {
    let source = |cap: u32, pins: usize, tasks: u32| {
        let mut text = format!(r#"
table categories:
  read <- allow
  delete <- allow
table grants:
  access: id
  holder: principal
  unique access
  read <- .holder = viewer
table tasks:
  category: categories ? on delete set null
  access: id
  cap {tasks} by category
  read <- exists grants[access = .access]
table boxes:
  category: categories on delete cascade
  cap {cap} by category
  read <- allow
table stamps:
  category: categories
  expiresAt: time
  expire at .expiresAt
  read <- allow
mutation dropCategory(id: categories):
  delete categories[id]
"#);
        for p in 0..pins { text.push_str(&format!("table pins{p}:\n  box: boxes\n  read <- allow\n")); }
        text
    };
    // A reservation that draws the whole 8,192-row allowance: the cascade's
    // restrict probes are examined work that writes nothing.
    let examined = |(cap, pins, tasks): (u32, usize, u32)| snapback4_lang::compile(&[("schema.q".into(), source(cap, pins, tasks))]).schema.delete_reservation("categories").map_or(0, |price| price[2]);
    let (cap, pins, tasks) = (371, 10, 12);
    assert_eq!(examined((cap, pins, tasks)), 8_192);
    let run = |child: bool| {
        let mut e = engine(&source(cap, pins, tasks));
        // Logical meters out of the way: only the physical allowance binds.
        e.set_ceilings(snapback4_core::Ceilings { examined: 1 << 20, index_entries: 1 << 22, steps: 1 << 30, rule_probes: 1 << 20, ..Default::default() });
        let mut rows = vec![row("categories", &[("id", id("c"))]), row("grants", &[("id", id("g")), ("access", id("x")), ("holder", id("carol"))])];
        if child { rows.push(row("tasks", &[("id", id("t")), ("category", id("c")), ("access", id("x"))])); }
        e.seed_at(rows, 500).unwrap();
        let out = e.mutate("dropCategory", None, ctx("alice", &[("id", id("c"))])).unwrap();
        (refusal(&out), out.metered)
    };
    let empty = run(false);
    assert_eq!(empty.0, None, "{empty:?}");
    assert_eq!(run(true), empty, "a hidden child changes nothing the caller sees");
}

#[test]
fn reset_reseeds_reference_indexes_and_caps_without_running_actions() {
    let mut e = world(2);
    let capabilities = e.schema().required_capabilities();
    let seeded = vec![row("projects", &[("id", id("p")), ("owner", id("alice")), ("name", Value::String("P".into()))]),
        row("tasks", &[("id", id("new")), ("project", id("p")), ("owner", id("bob")), ("category", Value::Null), ("title", Value::String("x".into()))])];
    e.dev_reset_at(seeded, 500).unwrap();
    assert_eq!(count(&e, "tasks"), 1);
    assert_eq!(e.schema().required_capabilities(), capabilities);
    let out = e.mutate("dropProject", None, ctx("alice", &[("id", id("p"))])).unwrap();
    assert_eq!(refusal(&out), None, "{out:?}");
    assert_eq!(count(&e, "tasks"), 0, "only the reseeded child cascades");
    e.dev_reset_at(vec![row("projects", &[("id", id("p")), ("owner", id("alice")), ("name", Value::String("P".into()))])], 500).unwrap();
    let out = e.mutate("dropProject", None, ctx("alice", &[("id", id("p"))])).unwrap();
    assert_eq!(refusal(&out), None, "no stale cap or reference entries: {out:?}");
}

#[test]
fn a_cascade_releases_a_hidden_childs_file_asset() {
    let source = "table folders:\n  read <- allow\n  delete <- allow\ntable documents:\n  folder: folders on delete cascade\n  owner: principal\n  scan: file <=1000\n  cap 4 by folder\n  read <- .owner = viewer\n  insert <- .owner = viewer\nmutation upload(folder: folders, scan: file <=1000):\n  insert documents { folder, owner: viewer, scan }\nmutation drop(folder: folders):\n  delete folders[folder]\n";
    let mut e = engine(source);
    e.seed_at([row("folders", &[("id", id("p"))])], 500).unwrap();
    let file = e.store_file("bob", b"plain words", Some("text/plain"), "notes.txt", 500).unwrap();
    let upload = e.mutate("upload", None, ctx("bob", &[("folder", id("p")), ("scan", Value::Map([("id".to_owned(), id(&file.id))].into_iter().collect::<std::collections::BTreeMap<_, _>>().into()))])).unwrap();
    assert_eq!(refusal(&upload), None, "{upload:?}");
    assert!(e.asset_access("bob", &file.id, 1_000).is_ok());
    let deleted = e.mutate("drop", None, ctx("alice", &[("folder", id("p"))])).unwrap();
    assert_eq!(refusal(&deleted), None, "{deleted:?}");
    assert_eq!(count(&e, "documents"), 0);
    assert_eq!(e.asset_access("bob", &file.id, 1_000).unwrap_err().code(), "E_ASSET_UNKNOWN");
}

#[test]
fn cascaded_lifetime_probes_spend_the_physical_allowance_once() {
    let mut source = "table roots:\n  read <- allow\n  delete <- allow\ntable mids:\n  root: roots on delete cascade\n  cap 30 by root\n  read <- deny\ntable leaves:\n  mid: mids\n  immutable mid\n  read through .mid\ntable pins0:\n  mid: mids\n  read <- allow\ntable pins1:\n  mid: mids\n  read <- allow\nmutation drop(root: roots):\n  delete roots[root]\n".to_owned();
    for n in 2..134 { source.push_str(&format!("table pins{n}:\n  mid: mids\n  read <- allow\n")); }
    let b = bound(&source);
    assert_eq!(b.schema.delete_reservation("roots").unwrap()[2], 8_192);
    let run = |hidden: bool| {
        let mut e = engine(&source);
        let mut rows = vec![row("roots", &[("id", id("p"))])];
        if hidden { rows.push(row("mids", &[("id", id("m")), ("root", id("p"))])); }
        e.seed_at(rows, 500).unwrap();
        let out = e.mutate("drop", None, ctx("alice", &[("root", id("p"))])).unwrap();
        assert_eq!(refusal(&out), None, "{out:?}");
        (out.metered, out.events, out.tables)
    };
    assert_eq!(run(false), run(true), "an empty lifetime seek must not draw again after R(P)");
}

#[test]
fn lifetime_hook_heap_is_reserved_with_the_source_write() {
    let mut source = "table roots:\n  read <- allow\n  delete <- allow\ntable mids:\n  root: roots on delete cascade\n  cap 1 by root\n  read <- allow\n".to_owned();
    for n in 0..3 { source.push_str(&format!("table leaves{n}:\n  mid: mids\n  body: text <=900000\n  immutable mid\n  read through .mid\n")); }
    source.push_str("mutation drop(root: roots):\n  delete roots[root]\n");
    let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(b.diagnostics.iter().any(|d| d.code == "E_CASCADE_BOUND"), "{:?}", b.diagnostics);
    // Exercise the runtime too, bypassing the compiler's site refusal.
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    e.seed_at([row("roots", &[("id", id("p"))])], 500).unwrap();
    let out = e.mutate("drop", None, ctx("alice", &[("root", id("p"))])).unwrap();
    assert_eq!(refusal(&out).as_deref(), Some("E_BOUND"), "{out:?}");
    assert_eq!(count(&e, "roots"), 1);
}

#[test]
fn a_derived_private_field_delivery_cannot_be_an_action_target() {
    let source = "table folders:\n  read <- allow\n  delete <- allow\ntable owners:\n  owner: principal\n  mark: int default 0 written by .owner\n  docs: count documents by owner\n  public 'owners'\n  sync public\ntable documents:\n  folder: folders on delete cascade\n  owner: owners\n  cap 1 by folder\n  read <- allow\nmutation drop(folder: folders):\n  delete folders[folder]\n";
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.iter().any(|d| d.code == "E_REFERENCE_ACTION" && d.message.contains("derived writes deliver private fields")), "{:?}", b.diagnostics);
}

#[test]
fn pending_event_images_are_reserved_beyond_the_action_closure() {
    let source = "table roots:\n  read <- allow\n  delete <- allow\ntable children:\n  root: roots ? on delete set null\n  owner: principal\n  body: text <=50000\n  cap 20 by root\n  read <- .owner = viewer\n  sync\nmutation dropBoth(a: roots, b: roots):\n  delete roots[a]\n  delete roots[b]\n";
    let b = bound(source);
    let retained = b.schema.delete_event_heap("roots").unwrap();
    assert!(2 * retained > snapback4_core::Ceilings::default().heap_bytes, "{retained}");
    let mut e = engine(source);
    e.seed_at([row("roots", &[("id", id("a"))]), row("roots", &[("id", id("b"))])], 500).unwrap();
    let out = e.mutate("dropBoth", None, ctx("alice", &[("a", id("a")), ("b", id("b"))])).unwrap();
    assert_eq!(refusal(&out).as_deref(), Some("E_BOUND"), "{out:?}");
    assert_eq!(count(&e, "roots"), 2, "the second reservation rolls back the whole call");
    let wide = source.replace("text <=50000", "text <=900000");
    let b = snapback4_lang::compile(&[("schema.q".into(), wide)]);
    assert!(b.diagnostics.iter().any(|d| d.code == "E_CASCADE_BOUND"), "{:?}", b.diagnostics);
}

#[test]
fn a_hidden_cascade_grant_revocation_has_a_static_event_envelope() {
    let source = "table roots:\n  public 'roots'\n  delete <- allow\n  sync public\ntable members:\n  root: roots on delete cascade\n  principal: principal\n  unique root, principal\n  cap 2 by root\n  read <- .principal = viewer\n  sync\ntable content:\n  root: roots on delete keep\n  read <- exists members[.root, viewer]\n  sync\nmutation drop(root: roots):\n  delete roots[root]\n";
    let run = |schema: &str, hidden: bool| {
        let mut e = engine(schema);
        let mut rows = vec![row("roots", &[("id", id("p"))])];
        if hidden { rows.push(row("members", &[("id", id("m")), ("root", id("p")), ("principal", id("bob"))])); }
        e.seed_at(rows, 500).unwrap();
        let out = e.mutate("drop", None, ctx("alice", &[("root", id("p"))])).unwrap();
        assert_eq!(refusal(&out), None, "{out:?}");
        (out.metered, out.tables, out.events)
    };
    assert_eq!(run(source, false), run(source, true), "the hidden scope event is inside the static envelope");
    let mut many = source.to_owned();
    for n in 0..100 { many.push_str(&format!("table extra{n}:\n  root: roots on delete keep\n  read <- exists members[.root, viewer]\n  sync\n")); }
    let small = bound(source).schema.delete_reservation("roots").unwrap();
    let large = bound(&many).schema.delete_reservation("roots").unwrap();
    assert_eq!(large[0] - small[0], large[3] * 100, "every receiver's transition step is reserved");
    assert_eq!(run(&many, false), run(&many, true), "100 hidden receiver transitions preserve the schema-fixed trace");

}

#[test]
fn a_cascade_through_child_reserves_both_its_walk_and_lifetime_probe() {
    let mut source = "table roots:\n  read <- allow\n  delete <- allow\ntable mids:\n  root: roots on delete cascade\n  cap 30 by root\n  read <- deny\ntable leaves:\n  mid: mids on delete cascade\n  cap 1 by mid\n  immutable mid\n  read through .mid\nmutation drop(root: roots):\n  delete roots[root]\n".to_owned();
    for n in 0..132 { source.push_str(&format!("table pins{n}:\n  mid: mids\n  read <- allow\n")); }
    let b = bound(&source);
    assert_eq!(b.schema.delete_reservation("roots").unwrap()[2], 8_192);
    let run = |hidden: bool| {
        let mut e = engine(&source);
        let mut rows = vec![row("roots", &[("id", id("p"))])];
        if hidden { rows.extend([row("mids", &[("id", id("m")), ("root", id("p"))]), row("leaves", &[("id", id("l")), ("mid", id("m"))])]); }
        e.seed_at(rows, 500).unwrap();
        let out = e.mutate("drop", None, ctx("alice", &[("root", id("p"))])).unwrap();
        assert_eq!(refusal(&out), None, "{out:?}");
        (out.metered, out.tables, out.events)
    };
    assert_eq!(run(false), run(true));
}
