//! LLP 3000.036.001: an owner-or-X list is one query. A page whose `where`, or
//! whose table's read rule, is a disjunction of branches each pinning an index
//! prefix that decides the rule reads as the merge of the branch ranges, and
//! is `complete`. Each test runs the engine and compares the merged page,
//! walked to its end by cursor, with the per-party queries' union.
use snapback4_core::{Context, Engine, Value, value::object};
use snapback4_lang::{Bound, compile};
use std::collections::BTreeMap;

fn bound(source: &str) -> Bound { compile(&[("schema.q".into(), source.into())]) }

fn clean(source: &str) -> Bound {
    let b = bound(source);
    assert!(b.diagnostics.is_empty(), "{source}\n{:#?}", b.diagnostics);
    b
}

fn has_note(b: &Bound, code: &str) -> bool { b.notes.iter().any(|n| n.code == code) }

type Rows = Vec<(&'static str, Vec<(&'static str, Value)>)>;

fn engine(source: &str, rows: Rows) -> Engine {
    let b = clean(source);
    let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed(rows.into_iter().map(|(table, fields)| (table.to_owned(), object(fields)))).unwrap();
    engine
}

fn id(text: &str) -> Value { Value::Id(text.into()) }

fn ids(data: &Value) -> Vec<String> {
    data.as_array().unwrap().iter().map(|row| match row.field("id") { Ok(Value::Id(id)) => id.clone(), other => panic!("{other:?}") }).collect()
}

/// Every page of `query` by cursor: the ids in order, and whether each page was complete.
fn walk(engine: &mut Engine, query: &str, viewer: &str, extra: &[(&str, Value)]) -> (Vec<String>, Vec<bool>) {
    let mut cursor = Value::Null;
    let mut out = Vec::new();
    let mut complete = Vec::new();
    for _ in 0..50 {
        let mut args: BTreeMap<String, Value> = extra.iter().map(|(k, v)| ((*k).to_owned(), v.clone())).collect();
        args.insert("c".into(), cursor.clone());
        let outcome = engine.query(query, Context::new(viewer, args)).unwrap_or_else(|e| panic!("{query} as {viewer}: {e:?}"));
        out.extend(ids(&outcome.data));
        complete.push(outcome.complete);
        match outcome.next { Some(next) => cursor = Value::String(next), None => return (out, complete) }
    }
    panic!("{query}: cursor did not end");
}

const TASKS: &str = "table tasks:
  owner: principal
  assignee: principal ?
  at: int
  title: text <=40
  read <- .owner = viewer or .assignee = viewer
  insert <- .owner = viewer
  online only
";

fn task(id_: &'static str, owner: &str, assignee: Option<&str>, at: i64) -> (&'static str, Vec<(&'static str, Value)>) {
    ("tasks", vec![("id", id(id_)), ("owner", id(owner)), ("assignee", assignee.map_or(Value::Null, id)), ("at", Value::Int(at)), ("title", Value::String(id_.into()))])
}

fn tasks() -> Rows {
    vec![
        task("t1", "alice", None, 10), task("t2", "bob", Some("alice"), 20), task("t3", "alice", Some("alice"), 30),
        task("t4", "carol", Some("bob"), 40), task("t5", "alice", Some("bob"), 50), task("t6", "bob", None, 60),
        task("t7", "carol", Some("alice"), 70), task("t8", "dave", Some("carol"), 80), task("t9", "alice", None, 90),
        task("t10", "bob", Some("alice"), 100),
    ]
}

/// The rows `viewer` may read, newest first (the ground truth for these tests).
fn readable(viewer: &str, rows: &Rows) -> Vec<String> {
    let mut out: Vec<(i64, String)> = rows.iter().filter(|(_, fields)| {
        let get = |name: &str| fields.iter().find(|(f, _)| *f == name).map(|(_, v)| v.clone()).unwrap();
        get("owner") == id(viewer) || get("assignee") == id(viewer)
    }).map(|(_, fields)| {
        let at = fields.iter().find(|(f, _)| *f == "at").and_then(|(_, v)| v.as_int().ok()).unwrap();
        let name = fields.iter().find(|(f, _)| *f == "id").map(|(_, v)| match v { Value::Id(s) => s.clone(), _ => unreachable!() }).unwrap();
        (at, name)
    }).collect();
    out.sort_by(|a, b| b.cmp(a));
    out.into_iter().map(|(_, name)| name).collect()
}

#[test]
fn the_two_party_query_is_complete_and_walks_the_union_once() {
    let source = format!("{TASKS}
query mine(c: cursor ?):
  return tasks where .owner = viewer or .assignee = viewer last 3 by .at after c
");
    let b = clean(&source);
    assert!(!has_note(&b, "N_NEVER_COMPLETE"), "{:#?}", b.notes);
    let mut engine = engine(&source, tasks());
    for viewer in ["alice", "bob", "carol", "dave", "erin"] {
        let (rows, complete) = walk(&mut engine, "mine", viewer, &[]);
        assert_eq!(rows, readable(viewer, &tasks()), "{viewer}");
        assert!(complete.iter().all(|c| *c), "{viewer}: {complete:?}");
    }
}

#[test]
fn the_read_rule_supplies_the_branches() {
    let source = format!("{TASKS}
query all(c: cursor ?):
  return tasks last 4 by .at after c
");
    let b = clean(&source);
    assert!(!has_note(&b, "N_NEVER_COMPLETE"), "{:#?}", b.notes);
    let mut engine = engine(&source, tasks());
    for viewer in ["alice", "bob", "carol", "erin"] {
        let (rows, complete) = walk(&mut engine, "all", viewer, &[]);
        assert_eq!(rows, readable(viewer, &tasks()), "{viewer}");
        assert!(complete.iter().all(|c| *c), "{viewer}: {complete:?}");
    }
}

#[test]
fn oldest_first_and_a_cursorless_top_n() {
    let source = format!("{TASKS}
query oldest(c: cursor ?):
  return tasks where .owner = viewer or .assignee = viewer first 2 by .at after c
query top():
  return tasks where .owner = viewer or .assignee = viewer last 2 by .at
");
    let mut engine = engine(&source, tasks());
    let (rows, complete) = walk(&mut engine, "oldest", "alice", &[]);
    let mut expected = readable("alice", &tasks());
    expected.reverse();
    assert_eq!(rows, expected);
    assert!(complete.iter().all(|c| *c));
    let outcome = engine.query("top", Context::new("alice", BTreeMap::new())).unwrap();
    assert_eq!(ids(&outcome.data), readable("alice", &tasks())[..2]);
    assert!(outcome.complete && outcome.next.is_none());
}

#[test]
fn a_residual_conjunct_applies_to_every_branch() {
    let source = format!("{TASKS}
query recent(since: int, c: cursor ?):
  return tasks where (.owner = viewer or .assignee = viewer) and .at >= since last 2 by .at after c
");
    let b = clean(&source);
    assert!(!has_note(&b, "N_NEVER_COMPLETE"), "{:#?}", b.notes);
    let mut engine = engine(&source, tasks());
    let (rows, complete) = walk(&mut engine, "recent", "alice", &[("since", Value::Int(30))]);
    assert_eq!(rows, vec!["t10", "t9", "t7", "t5", "t3"]);
    assert!(complete.iter().all(|c| *c));
}

const STAFF: &str = "table staff:
  principal: principal
  unique principal
  read <- .principal = viewer
  insert <- deny
  online only

table tickets:
  owner: principal
  at: int
  read <- .owner = viewer or exists staff[viewer]
  insert <- .owner = viewer
  online only

query tickets(c: cursor ?):
  return tickets last 2 by .at after c
";

fn ticket(name: &'static str, owner: &str, at: i64) -> (&'static str, Vec<(&'static str, Value)>) {
    ("tickets", vec![("id", id(name)), ("owner", id(owner)), ("at", Value::Int(at))])
}

#[test]
fn owner_or_staff_is_one_query_complete_for_everyone() {
    let b = clean(STAFF);
    assert!(!has_note(&b, "N_NEVER_COMPLETE"), "{:#?}", b.notes);
    let rows = || vec![("staff", vec![("id", id("s1")), ("principal", id("sam"))]),
        ticket("k1", "alice", 1), ticket("k2", "bob", 2), ticket("k3", "alice", 3), ticket("k4", "carol", 4), ticket("k5", "alice", 5)];
    let mut engine = engine(STAFF, rows());
    let (all, complete) = walk(&mut engine, "tickets", "sam", &[]);
    assert_eq!(all, vec!["k5", "k4", "k3", "k2", "k1"]);
    assert!(complete.iter().all(|c| *c));
    let (own, complete) = walk(&mut engine, "tickets", "alice", &[]);
    assert_eq!(own, vec!["k5", "k3", "k1"]);
    assert!(complete.iter().all(|c| *c));
    let (none, complete) = walk(&mut engine, "tickets", "erin", &[]);
    assert!(none.is_empty() && complete == vec![true]);
}

#[test]
fn covering_grants_share_boolean_prefix_normalization() {
    for (name, column, guard, predicate, selected, other) in [
        ("allow", "bool", "allow and exists staff[viewer]", ".enabled = true", Value::Bool(true), Value::Bool(false)),
        ("not-deny", "bool", "not deny and exists staff[viewer]", ".enabled = true", Value::Bool(true), Value::Bool(false)),
        ("bare", "bool", ".enabled and exists staff[viewer]", ".enabled = true", Value::Bool(true), Value::Bool(false)),
        ("not", "bool", "not .enabled and exists staff[viewer]", ".enabled = false", Value::Bool(false), Value::Bool(true)),
        ("ne", "bool", ".enabled != true and exists staff[viewer]", ".enabled = false", Value::Bool(false), Value::Bool(true)),
        ("double-not", "bool", "not not .enabled and exists staff[viewer]", ".enabled = true", Value::Bool(true), Value::Bool(false)),
        ("optional-null", "bool ?", ".enabled != true and exists staff[viewer]", ".enabled = null", Value::Null, Value::Bool(false)),
    ] {
        let source = format!("table staff:\n  principal: principal\n  unique principal\n  read <- .principal = viewer\n  online only\ntable tickets:\n  owner: principal\n  enabled: {column}\n  at: int\n  read <- .owner = viewer or ({guard})\n  online only\nquery tickets(c: cursor ?):\n  return tickets where {predicate} last 1 by .at after c\n");
        let b = clean(&source);
        assert_eq!(branch_merges(&b, "tickets"), vec![(2, true)], "{name}");
        assert!(!has_note(&b, "N_NEVER_COMPLETE"), "{name}: {:#?}", b.notes);
        let rows = vec![
            ("staff", vec![("id", id("s1")), ("principal", id("sam"))]),
            ("tickets", vec![("id", id("k1")), ("owner", id("alice")), ("enabled", selected.clone()), ("at", Value::Int(1))]),
            ("tickets", vec![("id", id("k2")), ("owner", id("bob")), ("enabled", selected), ("at", Value::Int(2))]),
            ("tickets", vec![("id", id("k3")), ("owner", id("alice")), ("enabled", other), ("at", Value::Int(3))]),
        ];
        let mut e = engine(&source, rows);
        let (staff, complete) = walk(&mut e, "tickets", "sam", &[]);
        assert_eq!(staff, ["k2", "k1"], "{name}");
        assert!(complete.iter().all(|value| *value), "{name}: {complete:?}");
        let (owner, complete) = walk(&mut e, "tickets", "alice", &[]);
        assert_eq!(owner, ["k1"], "{name}");
        assert!(complete.iter().all(|value| *value), "{name}: {complete:?}");
    }
}

#[test]
fn a_capped_fixed_probe_remains_an_ordinary_static_grant() {
    let source = "table access:
  bucket: int
  principal: principal
  unique bucket, principal
  cap 16 by principal
  read <- allow
  online only

table items:
  owner: principal
  bucket: int
  score: int
  read <- .owner = viewer or exists access[0, viewer]
  online only

query items(bucket: int, c: cursor ?):
  return items where .bucket = bucket last 1 by .score after c
";
    let b = clean(source);
    assert_eq!(branch_merges(&b, "items").first().map(|merge| merge.0), Some(2));
    assert!(!b.schema.required_capabilities().contains("branch-membership-v1"));
    assert!(!has_note(&b, "N_NEVER_COMPLETE"), "{:#?}", b.notes);

    let rows = vec![
        ("access", vec![("id", id("a1")), ("bucket", Value::Int(0)), ("principal", id("alice"))]),
        ("items", vec![("id", id("i1")), ("owner", id("bob")), ("bucket", Value::Int(1)), ("score", Value::Int(1))]),
        ("items", vec![("id", id("i2")), ("owner", id("alice")), ("bucket", Value::Int(1)), ("score", Value::Int(2))]),
        ("items", vec![("id", id("i3")), ("owner", id("bob")), ("bucket", Value::Int(2)), ("score", Value::Int(3))]),
    ];
    let mut e = engine(source, rows);
    let bucket = [("bucket", Value::Int(1))];
    let (granted, complete) = walk(&mut e, "items", "alice", &bucket);
    assert_eq!(granted, ["i2", "i1"]);
    assert!(complete.into_iter().all(|value| value));
    let (owned, complete) = walk(&mut e, "items", "bob", &bucket);
    assert_eq!(owned, ["i1"]);
    assert!(complete.into_iter().all(|value| value));
}

#[test]
fn a_grant_the_caller_cannot_read_keeps_the_single_read() {
    // A hidden roster (`read <- deny`) is not a usable grant (LLP 3000.036 §12.1):
    // the page reads as written and stays never complete.
    let source = STAFF.replace("  read <- .principal = viewer\n", "  read <- deny\n");
    let b = clean(&source);
    assert!(has_note(&b, "N_NEVER_COMPLETE"), "{:#?}", b.notes);
    let mut engine = engine(&source, vec![ticket("k1", "alice", 1), ticket("k2", "bob", 2)]);
    let outcome = engine.query("tickets", Context::new("alice", BTreeMap::from([("c".to_owned(), Value::Null)]))).unwrap();
    assert_eq!(ids(&outcome.data), vec!["k1"]);
    assert!(!outcome.complete);
}

#[test]
fn a_cursor_of_another_plan_restarts_the_read() {
    // A direct page's cursor over the same table names one index; the merged
    // page's names the branch set, as version 4.
    let source = format!("{TASKS}
query mine(c: cursor ?):
  return tasks where .owner = viewer or .assignee = viewer last 2 by .at after c
query owned(c: cursor ?):
  return tasks where .owner = viewer last 2 by .at after c
");
    let mut engine = engine(&source, tasks());
    let ctx = |c: Value| Context::new("alice", BTreeMap::from([("c".to_owned(), c)]));
    let owned = engine.query("owned", ctx(Value::Null)).unwrap();
    let foreign = owned.next.expect("owned continues");
    let error = engine.query("mine", ctx(Value::String(foreign))).unwrap_err();
    assert_eq!(error.code, "E_CURSOR_INDEX", "{error:?}");
    let merged = engine.query("mine", ctx(Value::Null)).unwrap().next.expect("mine continues");
    let error = engine.query("owned", ctx(Value::String(merged))).unwrap_err();
    assert_eq!(error.code, "E_INPUT", "{error:?}");
}

#[test]
fn exists_over_the_branches_answers_false() {
    let source = format!("{TASKS}
query any():
  return exists tasks where .owner = viewer or .assignee = viewer
");
    let b = clean(&source);
    assert!(!has_note(&b, "N_NEVER_COMPLETE"), "{:#?}", b.notes);
    let mut engine = engine(&source, tasks());
    for (viewer, expected) in [("alice", true), ("dave", true), ("erin", false)] {
        let outcome = engine.query("any", Context::new(viewer, BTreeMap::new())).unwrap();
        assert_eq!(outcome.data, Value::Bool(expected), "{viewer}");
        assert!(outcome.complete, "{viewer}");
    }
}

#[test]
fn shapes_the_merge_does_not_cover_keep_the_note() {
    // A single party is the pin the author writes; a membership branch is not a pin.
    for (rule, query) in [
        (".owner = viewer", "tasks last 3 by .at after c"),
        (".owner = viewer or exists shares[.id, viewer]", "tasks last 3 by .at after c"),
    ] {
        let source = format!("table shares:
  task: id
  principal: principal
  unique task, principal
  read <- .principal = viewer
  insert <- deny
  online only

table tasks:
  owner: principal
  at: int
  read <- {rule}
  insert <- .owner = viewer
  online only

query q(c: cursor ?):
  return {query}
");
        let b = clean(&source);
        assert!(has_note(&b, "N_NEVER_COMPLETE"), "{rule}: {:#?}", b.notes);
    }
}

/// The program's branch merges (bound IR), with whether the lazy path takes each.
fn branch_merges(b: &Bound, program: &str) -> Vec<(usize, bool)> {
    let p = &b.programs.iter().find(|p| p.program.name == program).unwrap().program;
    snapback4_core::search_plan::merges(&p.body).into_iter().filter(|m| m.branches())
        .map(|m| (m.lanes.len(), snapback4_core::engine::rules::branch_merge_lazy(&b.schema, m))).collect()
}

#[test]
fn the_plan_is_a_lazy_merge_of_one_lane_per_branch() {
    let source = format!("{TASKS}
query mine(c: cursor ?):
  return tasks where .owner = viewer or .assignee = viewer last 3 by .at after c
query all(c: cursor ?):
  return tasks last 3 by .at after c
query owned(c: cursor ?):
  return tasks where .owner = viewer last 3 by .at after c
");
    let b = clean(&source);
    assert_eq!(branch_merges(&b, "mine"), vec![(2, true)]);
    // The rule's parties, and the grant lane the system reads whole.
    assert_eq!(branch_merges(&b, "all"), vec![(3, true)]);
    // A page its own pins decide keeps its single-index plan.
    assert_eq!(branch_merges(&b, "owned"), vec![]);
}

#[test]
fn three_parties_and_a_where_alternative_each() {
    let source = "table jobs:
  owner: principal
  helper: principal ?
  reviewer: principal ?
  done: bool
  at: int
  read <- .owner = viewer or .helper = viewer or .reviewer = viewer
  insert <- .owner = viewer
  online only

query open(c: cursor ?):
  return jobs where .done = false or .at < 3 last 2 by .at after c
";
    let b = clean(source);
    assert!(!has_note(&b, "N_NEVER_COMPLETE"), "{:#?}", b.notes);
    // `.at < 3` pins nothing, so `where` has no branches: one lane per party,
    // and the grant lane (the system's).
    assert_eq!(branch_merges(&b, "open"), vec![(4, true)]);
    let job = |name: &'static str, owner: &str, helper: Option<&str>, reviewer: Option<&str>, done: bool, at: i64| ("jobs", vec![("id", id(name)), ("owner", id(owner)),
        ("helper", helper.map_or(Value::Null, id)), ("reviewer", reviewer.map_or(Value::Null, id)), ("done", Value::Bool(done)), ("at", Value::Int(at))]);
    let rows = vec![job("j1", "ann", None, None, false, 1), job("j2", "bob", Some("ann"), None, true, 2), job("j3", "bob", None, Some("ann"), true, 5),
        job("j4", "cat", Some("ann"), Some("ann"), false, 6), job("j5", "cat", None, None, false, 7), job("j6", "ann", Some("ann"), None, true, 8)];
    let mut engine = engine(source, rows);
    let (rows, complete) = walk(&mut engine, "open", "ann", &[]);
    assert_eq!(rows, vec!["j4", "j2", "j1"]);
    assert!(complete.iter().all(|c| *c));
}

#[test]
fn branches_over_group_probes_are_decided_by_each_pin() {
    let source = "table members:
  board: int
  principal: principal
  unique board, principal
  read <- .principal = viewer
  insert <- deny
  online only

table cards:
  board: int
  at: int
  read <- exists members[.board, viewer]
  insert <- exists members[.board, viewer]
  online only

query two(a: int, b: int, c: cursor ?):
  return cards where .board = a or .board = b last 2 by .at after c
";
    let b = clean(source);
    assert!(!has_note(&b, "N_NEVER_COMPLETE"), "{:#?}", b.notes);
    assert_eq!(branch_merges(&b, "two"), vec![(2, true)]);
    let card = |name: &'static str, board: i64, at: i64| ("cards", vec![("id", id(name)), ("board", Value::Int(board)), ("at", Value::Int(at))]);
    let rows = vec![("members", vec![("id", id("m1")), ("board", Value::Int(1)), ("principal", id("ann"))]),
        ("members", vec![("id", id("m2")), ("board", Value::Int(2)), ("principal", id("ann"))]),
        card("c1", 1, 1), card("c2", 2, 2), card("c3", 3, 3), card("c4", 1, 4), card("c5", 2, 5), card("c6", 3, 6)];
    let mut engine = engine(source, rows);
    let (rows, complete) = walk(&mut engine, "two", "ann", &[("a", Value::Int(1)), ("b", Value::Int(2))]);
    assert_eq!(rows, vec!["c5", "c4", "c2", "c1"]);
    assert!(complete.iter().all(|c| *c));
    // A board the caller is not a member of is a decided-false branch: empty, still complete.
    let (rows, complete) = walk(&mut engine, "two", "ann", &[("a", Value::Int(1)), ("b", Value::Int(3))]);
    assert_eq!(rows, vec!["c4", "c1"]);
    assert!(complete.iter().all(|c| *c));
}

#[test]
fn a_cut_while_draining_continues_and_a_cut_while_opening_ends() {
    let source = format!("{TASKS}
query mine(c: cursor ?):
  return tasks where .owner = viewer or .assignee = viewer last 4 by .at after c
");
    let mut engine = engine(&source, tasks());
    let full = walk(&mut engine, "mine", "alice", &[]).0;
    let mut continued = 0;
    for examined in 1..=40u64 {
        engine.set_ceilings(snapback4_core::Ceilings { examined, ..Default::default() });
        let mut cursor = Value::Null;
        let mut at = 0;
        for _ in 0..40 {
            let outcome = engine.query("mine", Context::new("alice", BTreeMap::from([("c".to_owned(), cursor.clone())]))).unwrap();
            let page = ids(&outcome.data);
            match outcome.next {
                // A page that continues, cut while draining or not, is exactly
                // the next rows of the uncut order (LLP 3000.007.000 §3).
                Some(next) => {
                    assert_eq!(page, full[at..at + page.len()], "examined {examined}");
                    if !outcome.complete { continued += 1; }
                    at += page.len();
                    cursor = Value::String(next);
                }
                None => {
                    if outcome.complete { assert_eq!(page, full[at..], "examined {examined}"); }
                    else {
                        // A cut before some branch examined anything past the
                        // cursor ends the read: empty, incomplete, no position.
                        assert!(outcome.capped_at.is_some(), "examined {examined}: {outcome:?}");
                        assert!(page.is_empty(), "examined {examined}: a cut page with rows carries next: {page:?}");
                    }
                    break;
                }
            }
        }
    }
    assert!(continued > 0, "some ceiling cuts a page while draining");
}

#[test]
fn staff_and_a_where_disjunction() {
    let source = format!("{STAFF}
query watched(c: cursor ?):
  return tickets where .owner = viewer or .at > 3 last 2 by .at after c
").replace("query tickets(c: cursor ?):\n  return tickets last 2 by .at after c\n", "");
    let b = clean(&source);
    assert!(!has_note(&b, "N_NEVER_COMPLETE"), "{:#?}", b.notes);
    let rows = || vec![("staff", vec![("id", id("s1")), ("principal", id("sam"))]),
        ticket("k1", "alice", 1), ticket("k2", "bob", 2), ticket("k3", "alice", 3), ticket("k4", "carol", 4), ticket("k5", "alice", 5)];
    let mut engine = engine(&source, rows());
    let (all, complete) = walk(&mut engine, "watched", "sam", &[]);
    assert_eq!(all, vec!["k5", "k4"]);
    assert!(complete.iter().all(|c| *c));
    let (own, complete) = walk(&mut engine, "watched", "alice", &[]);
    assert_eq!(own, vec!["k5", "k3", "k1"]);
    assert!(complete.iter().all(|c| *c));
}

#[test]
fn more_than_eight_branches_keep_the_single_read() {
    let source = "table jobs:
  a: principal
  b: principal
  c: principal
  kind: int
  at: int
  read <- .a = viewer or .b = viewer or .c = viewer
  insert <- .a = viewer
  online only

query q(c: cursor ?):
  return jobs where .kind = 1 or .kind = 2 or .kind = 3 last 2 by .at after c
";
    let b = clean(source);
    assert!(has_note(&b, "N_NEVER_COMPLETE"), "{:#?}", b.notes);
    assert_eq!(branch_merges(&b, "q"), vec![]);
}

#[test]
fn a_mutation_page_is_unchanged() {
    let source = format!("{TASKS}
mutation touch():
  for t in tasks where .owner = viewer or .assignee = viewer first 5 by .at:
    update tasks[t] {{ title: 'x' }}
  return true
");
    let b = bound(&source);
    // An undecided page in a mutation is refused as before; no branch merge is planned there.
    assert!(b.programs.iter().all(|p| snapback4_core::search_plan::merges(&p.program.body).iter().all(|m| !m.branches())));
}

#[test]
fn a_fallible_predicate_or_an_order_on_the_party_keeps_the_single_read() {
    // A lane would evaluate `1 / n` for a row the original's `or` short-circuits past.
    for query in [
        "tasks where .owner = viewer or (.assignee = viewer and .at * n = 1) last 3 by .at after c",
        // Lane planning keeps an equality on an order column as a seek, so the party cannot be pinned.
        "tasks last 3 by .owner, .at after c",
    ] {
        let source = format!("{TASKS}
query q(n: int, c: cursor ?):
  return {query}
");
        let b = clean(&source);
        assert_eq!(branch_merges(&b, "q"), vec![], "{query}");
        assert!(has_note(&b, "N_NEVER_COMPLETE"), "{query}: {:#?}", b.notes);
    }
}

#[test]
fn an_unfinished_first_shape_retries_its_row_inclusively() {
    let source = format!("{TASKS}
table extra:
  lane: int
  by byLane: lane, id
  read <- allow
  insert <- deny
  online only

query feed(c: cursor ?):
  return tasks where .owner = viewer or .assignee = viewer last 1 by .at after c {{ id, n: count(extra[0] first 9000 by byLane) }}
query bounded(c: cursor ?):
  return tasks where .owner = viewer or .assignee = viewer last 1 by .at after c {{ id, n: count(extra[0] first 3 by byLane) }}
");
    let mut rows = tasks();
    rows.extend((0..9000).map(|n| ("extra", vec![("id", Value::Id(format!("x{n:05}"))), ("lane", Value::Int(0))])));
    let mut engine = engine(&source, rows);
    let ctx = |c: Value| Context::new("alice", BTreeMap::from([("c".to_owned(), c)]));
    let first = engine.query("feed", ctx(Value::Null)).unwrap();
    assert!(ids(&first.data).is_empty() && !first.complete, "{first:?}");
    let next = first.next.expect("retry the unfinished row");
    let position = snapback4_core::cursor::decode_cursor(&snapback4_core::schema::Schema::default(), &next).unwrap();
    assert!(position.inclusive && position.index.starts_with("$or:"), "{position:?}");
    let refusal = engine.query("feed", ctx(Value::String(next.clone()))).unwrap_err();
    assert_eq!(refusal.code, "E_SHAPE_EXCEEDS_METER", "{refusal:?}");
    // The same position, inclusive, resumes a shape that can finish at its row
    // (a cursor names its plan, not its query: both read the same branches).
    let bounded = engine.query("bounded", ctx(Value::String(next))).unwrap();
    assert_eq!(ids(&bounded.data), vec!["t10"]);
    assert_eq!(bounded.data.as_array().unwrap()[0].field("n").unwrap(), &Value::Int(3));
    assert!(bounded.complete && bounded.next.is_some());
}

#[test]
fn an_older_engine_reads_the_plan_as_an_eager_merge() {
    // An engine that does not know the branch markers (0.4.22) ignores them and
    // takes the eager merge: the same rows, its own cursor form.
    let source = format!("{TASKS}
query mine(c: cursor ?):
  return tasks where .owner = viewer or .assignee = viewer last 3 by .at after c
");
    let mut b = clean(&source);
    fn strip(stmts: &mut [snapback4_core::ir::Stmt]) {
        use snapback4_core::ir::{Expr, Stmt};
        fn expr(e: &mut Expr) { if let Expr::Merge(m) = e { for lane in &mut m.lanes { lane.branch = None; } } }
        for s in stmts { if let Stmt::Return(e) | Stmt::Let { value: e, .. } = s { expr(e); } }
    }
    for p in &mut b.programs { strip(&mut p.program.body); }
    let mut old = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    old.seed(tasks().into_iter().map(|(t, f)| (t.to_owned(), object(f)))).unwrap();
    let mut new = engine(&source, tasks());
    for viewer in ["alice", "bob", "carol"] {
        assert_eq!(walk(&mut old, "mine", viewer, &[]).0, walk(&mut new, "mine", viewer, &[]).0, "{viewer}");
    }
}

/// LLP 3000.036 §16.3 meets the merge: a party and a parent probe the page's
/// pin decides. The guard is a grant lane over the pinned range: the parent's
/// owner reads it whole, everyone else their party branch; both complete. A
/// parent its holders cannot read is no guard, and the page keeps one index.
#[test]
fn a_pinned_parent_guard_is_a_branch_beside_its_party() {
    let schema = |parent_read: &str| format!("table boards:
  owner: principal
  immutable owner
  read <- {parent_read}
  online only
table cards:
  board: boards
  author: principal
  at: int
  immutable board, author
  read <- .author = viewer or exists boards[.board, owner = viewer]
  insert <- .author = viewer
  online only
query cards(board: boards, c: cursor ?):
  return cards where .board = board last 2 by .at after c
");
    let rows = || vec![("boards", vec![("id", id("b1")), ("owner", id("olga"))]), ("boards", vec![("id", id("b2")), ("owner", id("pat"))]),
        ("cards", vec![("id", id("k1")), ("board", id("b1")), ("author", id("ann")), ("at", Value::Int(1))]),
        ("cards", vec![("id", id("k2")), ("board", id("b1")), ("author", id("bo")), ("at", Value::Int(2))]),
        ("cards", vec![("id", id("k3")), ("board", id("b1")), ("author", id("ann")), ("at", Value::Int(3))]),
        ("cards", vec![("id", id("k4")), ("board", id("b2")), ("author", id("ann")), ("at", Value::Int(4))])];
    let open = schema("allow");
    let b = clean(&open);
    assert!(!has_note(&b, "N_NEVER_COMPLETE"), "{:#?}", b.notes);
    assert_eq!(branch_merges(&b, "cards"), vec![(2, true)]);
    let mut merged = engine(&open, rows());
    let board = [("board", id("b1"))];
    assert_eq!(walk(&mut merged, "cards", "olga", &board), (vec!["k3".into(), "k2".into(), "k1".into()], vec![true, true]));
    assert_eq!(walk(&mut merged, "cards", "ann", &board).0, vec!["k3", "k1"]);
    assert!(walk(&mut merged, "cards", "ann", &board).1.iter().all(|c| *c));
    assert_eq!(walk(&mut merged, "cards", "pat", &board), (vec![], vec![true]), "another board's owner: empty, complete");
    // A hidden parent: the probe is no guard, so the page reads as written.
    let hidden = schema("deny");
    let b = clean(&hidden);
    assert!(has_note(&b, "N_NEVER_COMPLETE"), "{:#?}", b.notes);
    assert_eq!(branch_merges(&b, "cards"), vec![]);
    let mut capped = engine(&hidden, rows());
    assert!(!walk(&mut capped, "cards", "ann", &board).1.iter().all(|c| *c));
}

// ---- round 2 (llp/reviews/3000.036.001-merged-pages.r2.*) ----

/// GPT r2 #1: a guard the page's order-column pin feeds keeps the single-index
/// plan with its guard, as in 0.4.23; the fallback is that plan, not a lane.
#[test]
fn an_order_column_pin_a_guard_needs_keeps_the_guarded_single_read() {
    let source = "table boards:
  owner: principal
  immutable owner
  read <- allow
  online only
table cards:
  board: boards
  author: principal
  at: int
  immutable board, author
  read <- .author = viewer or exists boards[.board, owner = viewer]
  insert <- .author = viewer
  online only
query cards(board: boards, c: cursor ?):
  return cards where .board = board last 2 by .board after c
";
    let b = clean(source);
    assert_eq!(branch_merges(&b, "cards"), vec![]);
    let mut e = engine(source, vec![("boards", vec![("id", id("b1")), ("owner", id("olga"))]),
        ("cards", vec![("id", id("k1")), ("board", id("b1")), ("author", id("ann")), ("at", Value::Int(1))]),
        ("cards", vec![("id", id("k2")), ("board", id("b1")), ("author", id("bo")), ("at", Value::Int(2))])]);
    let (rows, complete) = walk(&mut e, "cards", "olga", &[("board", id("b1"))]);
    assert_eq!(rows.len(), 2);
    assert!(complete.iter().all(|c| *c), "the owner's guarded page is complete: {complete:?}");
}

/// GPT r2 #3: clock arithmetic can overflow at the clock's bound, so a lane
/// would evaluate it where the original's `or` skipped it: not total.
#[test]
fn clock_arithmetic_is_not_total() {
    let source = format!("{TASKS}
query soon(c: cursor ?):
  return tasks where .owner = viewer or (.assignee = viewer and .at > now + 1) last 3 by .at after c
");
    let b = clean(&source);
    assert_eq!(branch_merges(&b, "soon"), vec![]);
}

/// Muse r2 #1: a lane cut inside a run of filter rejects reports how far it
/// examined, so the page continues past them instead of ending.
#[test]
fn a_cut_inside_filter_rejects_continues_from_the_frontier() {
    let source = format!("{TASKS}
query rare(c: cursor ?):
  return tasks where (.owner = viewer or .assignee = viewer) and .title != 't' last 2 by .at after c
");
    // The owner lane opens first and is exhausted; the assignee lane, opened
    // last, is cut inside its run of rejects.
    let mut rows: Rows = (3..20).map(|n| ("tasks", vec![("id", Value::Id(format!("r{n:02}"))), ("owner", id("zed")), ("assignee", id("alice")), ("at", Value::Int(n)), ("title", Value::String(if n < 5 { "x" } else { "t" }.into()))])).collect();
    rows.push(("tasks", vec![("id", id("r02")), ("owner", id("alice")), ("assignee", Value::Null), ("at", Value::Int(2)), ("title", Value::String("x".into()))]));
    let mut e = engine(&source, rows);
    e.set_ceilings(snapback4_core::Ceilings { examined: 6, ..Default::default() });
    let first = e.query("rare", Context::new("alice", BTreeMap::from([("c".to_owned(), Value::Null)]))).unwrap();
    assert!(!first.complete && ids(&first.data).is_empty(), "{first:?}");
    let next = first.next.expect("the lane examined rows past the cursor: the page continues");
    e.set_ceilings(Default::default());
    let rest = e.query("rare", Context::new("alice", BTreeMap::from([("c".to_owned(), Value::String(next))]))).unwrap();
    assert_eq!(ids(&rest.data), vec!["r04", "r03"]);
}

// ---- round 3 (llp/reviews/3000.036.001-merged-pages.r3.*) ----

/// GPT r3 #1: the system reads every row, which a rule of parties' branches
/// miss; the grant lane, read whole for the system, keeps them.
#[test]
fn the_system_reads_every_row_of_a_merged_page() {
    let source = format!("{TASKS}
query all(c: cursor ?):
  return tasks last 20 by .at after c
query mine(c: cursor ?):
  return tasks where .owner = viewer or .assignee = viewer last 20 by .at after c
");
    let mut e = engine(&source, tasks());
    let all = e.query("all", { let mut cx = snapback4_core::Context::system(); cx.args.insert("c".into(), Value::Null); cx }).unwrap();
    assert_eq!(ids(&all.data).len(), tasks().len(), "{all:?}");
    // A `where` of parties is the system's own filter: no task is owned by it.
    let mine = e.query("mine", { let mut cx = snapback4_core::Context::system(); cx.args.insert("c".into(), Value::Null); cx }).unwrap();
    assert!(ids(&mine.data).is_empty());
}

/// Muse r3 #1: a branch token is scoped to every lane's pins, so a page whose
/// arguments (or viewer) changed refuses the cursor instead of skipping rows.
#[test]
fn a_branch_cursor_is_scoped_to_its_lanes_pins() {
    let source = format!("{TASKS}
query mine(c: cursor ?):
  return tasks where .owner = viewer or .assignee = viewer last 1 by .at after c
");
    let mut e = engine(&source, tasks());
    let ctx = |viewer: &str, c: Value| Context::new(viewer, BTreeMap::from([("c".to_owned(), c)]));
    let next = e.query("mine", ctx("alice", Value::Null)).unwrap().next.expect("continues");
    assert!(e.query("mine", ctx("alice", Value::String(next.clone()))).is_ok());
    // Bob's lanes pin bob: alice's position is not his.
    let error = e.query("mine", ctx("bob", Value::String(next))).unwrap_err();
    assert_eq!(error.code, "E_INPUT", "{error:?}");
}

/// GPT r3 #2: an older device must not run a merged plan nor decode its
/// cursors; the backend names the capability it needs, and an older decoder
/// refuses it by name.
#[test]
fn a_merged_plan_requires_the_branch_merge_capability() {
    let merged = clean(&format!("{TASKS}query mine(c: cursor ?):\n  return tasks where .owner = viewer or .assignee = viewer last 2 by .at after c\n"));
    assert!(merged.schema.required_capabilities().contains("branch-merge-v1"));
    let single = clean(&format!("{TASKS}query owned(c: cursor ?):\n  return tasks where .owner = viewer last 2 by .at after c\n"));
    assert!(!single.schema.required_capabilities().contains("branch-merge-v1"));
}

// ---- round 4 (llp/reviews/3000.036.001-merged-pages.r4.*) ----

/// GPT r4 #1: `.meta.ok` binds to a read of the referenced row, which a meter
/// can cut after the lane examined the task, and the merge's frontier would
/// then pass it. A member through a reference is not total: the page keeps
/// the single read (whose own cut inside a predicate read is a pre-existing
/// defect of the direct path, `issues/20261012-snapback4-cut-inside-predicate-read-skips-row.md`).
#[test]
fn a_reference_member_is_not_total() {
    let schema = "table metas:
  ok: bool
  public
table tasks:
  owner: principal
  assignee: principal ?
  meta: metas
  ok: bool
  at: int
  read <- .owner = viewer or .assignee = viewer
  online only
";
    let page = |predicate: &str| clean(&format!("{schema}query flagged(c: cursor ?):\n  return tasks where (.owner = viewer or .assignee = viewer) and {predicate} last 2 by .at after c\n"));
    assert_eq!(branch_merges(&page(".ok = true"), "flagged"), vec![(2, true)], "the row's own column is total");
    assert!(branch_merges(&page(".meta.ok = true"), "flagged").is_empty(), "a member through a reference is a read: no merge");
}

const HEADERS: &str = "table headers:
  owner: principal
  read <- .owner = viewer
";

/// GPT r4 #2: a merge inside a returned row shape needs the capability too.
#[test]
fn a_merge_inside_a_returned_shape_requires_the_branch_merge_capability() {
    let b = clean(&format!("{HEADERS}{TASKS}query nested(h: headers, c: cursor ?):\n  return headers[h] {{ id, tasks: (tasks last 1 by .at after c) }}\n"));
    let program = &b.programs.iter().find(|p| p.program.name == "nested").unwrap().program;
    assert!(snapback4_core::ir::body_merges(&program.body).iter().any(|m| m.branches()), "the inline page is a branch merge");
    assert!(b.schema.required_capabilities().contains("branch-merge-v1"));
    assert!(!has_note(&b, "N_NEVER_COMPLETE"), "{:#?}", b.notes);
}

/// GPT r4 #3: each lane's prefix fits a token; together they would not. The
/// scope is a digest of them all, so the page continues.
#[test]
fn a_cursor_over_wide_lane_prefixes_fits_its_token() {
    let source = "table tasks:
  owner: principal
  assignee: principal ?
  folder: text <=400
  at: int
  read <- .owner = viewer or .assignee = viewer
  online only
query mine(folder: text <=400, c: cursor ?):
  return tasks where .folder = folder last 1 by .at after c
";
    let wide: String = std::iter::repeat_n('\u{1F600}', 400).collect();
    let task = |name: &'static str, at: i64, folder: &str| ("tasks", vec![("id", id(name)), ("owner", id("alice")), ("assignee", Value::Null), ("folder", Value::String(folder.into())), ("at", Value::Int(at))]);
    let mut e = engine(source, vec![task("t1", 1, &wide), task("t2", 2, &wide)]);
    assert_eq!(branch_merges(&clean(source), "mine").first().map(|m| m.0), Some(3), "grant, owner and assignee lanes");
    let (got, _) = walk(&mut e, "mine", "alice", &[("folder", Value::String(wide.clone()))]);
    assert_eq!(got, vec!["t2", "t1"]);
}

/// GPT r5 #1: eight legal 507-byte index labels cannot be copied into next.
#[test]
fn repeated_long_index_names_have_a_bounded_cursor_descriptor() {
    let index = "x".repeat(507);
    let alternatives = (1..=8).map(|n| format!(".board = {n}")).collect::<Vec<_>>().join(" or ");
    let source = format!("table members:\n  board: int\n  principal: principal\n  unique board, principal\n  read <- .principal = viewer\n  online only\ntable cards:\n  board: int\n  at: int\n  by {index}: board, at, id\n  read <- exists members[.board, viewer]\n  online only\nquery mine(c: cursor ?):\n  return cards where {alternatives} last 1 by .at after c\n");
    let b = clean(&source);
    assert_eq!(branch_merges(&b, "mine").first().map(|m| m.0), Some(8));
    let mut rows = Vec::new();
    for (name, board) in [("c1", 1), ("c2", 8)] {
        rows.push(("cards", vec![("id", id(name)), ("board", Value::Int(board)), ("at", Value::Int(board))]));
    }
    for (name, board) in [("m1", 1), ("m8", 8)] {
        rows.push(("members", vec![("id", id(name)), ("board", Value::Int(board)), ("principal", id("alice"))]));
    }
    let mut e = engine(&source, rows);
    let first = e.query("mine", Context::new("alice", BTreeMap::from([("c".into(), Value::Null)]))).unwrap();
    let token = first.next.as_ref().expect("two matches need a cursor");
    let position = snapback4_core::cursor::decode_cursor(e.schema(), token).unwrap();
    assert_eq!(position.index.len(), 68);
    // Frozen from the pre-PAGE branch-merge-v1 encoder. PAGE appends identity
    // only for its new descriptors; it cannot reorder these published bytes.
    assert_eq!(position.index, "$or:d2047ec0a012672024a8556c48743283d672a9a5254a10d51d4a4488d88e9b88");
    let resumed = e.query("mine", Context::new("alice", BTreeMap::from([("c".into(), Value::String(token.clone()))]))).unwrap();
    assert_eq!(ids(&resumed.data), vec!["c1"]);
    assert!(resumed.complete && resumed.next.is_none());
    let (got, complete) = walk(&mut e, "mine", "alice", &[]);
    assert_eq!(got, vec!["c2", "c1"]);
    assert!(complete.into_iter().all(|c| c));
}

/// GPT r5 #2: the original 2028-byte key fits; adding a party would not.
#[test]
fn branch_key_bytes_that_exceed_the_portable_bound_keep_the_original_scan() {
    let source = TASKS.replace("  at: int", "  folder: text <=435\n  at: int")
        + "query mine(folder: text <=435, c: cursor ?):\n  return tasks where .folder = folder last 1 by .at after c\n";
    let b = clean(&source);
    assert!(branch_merges(&b, "mine").is_empty());
    assert!(has_note(&b, "N_NEVER_COMPLETE"));
    assert!(!b.schema.required_capabilities().contains("branch-merge-v1"));
    let wide: String = std::iter::repeat_n('\u{1F600}', 435).collect();
    let mut row = task("t1", "alice", None, 1);
    row.1.push(("folder", Value::String(wide.clone())));
    let mut e = engine(&source, vec![row]);
    let (got, complete) = walk(&mut e, "mine", "alice", &[("folder", Value::String(wide))]);
    assert_eq!(got, vec!["t1"]);
    assert!(complete.into_iter().all(|c| !c));
}

/// The pending request label fits, but the emitted label includes the column.
#[test]
fn an_oversized_emitted_branch_index_label_keeps_the_original_scan() {
    let owner = "o".repeat(480);
    let source = TASKS.replace("owner", &owner)
        + "query mine(c: cursor ?):\n  return tasks last 1 by .at after c\n";
    let b = clean(&source);
    assert!(branch_merges(&b, "mine").is_empty());
    assert!(has_note(&b, "N_NEVER_COMPLETE"));
    assert!(b.schema.tables["tasks"].indexes.keys().all(|name| name.len() + 5 <= 512));
}

#[test]
fn oversized_existence_branch_indexes_keep_the_original_scan() {
    let b = clean("table tasks:\n  bucket: text <=500\n  read <- .bucket = 'a' or .bucket = 'b'\n  online only\nquery any():\n  return exists tasks where .bucket = 'a' or .bucket = 'b'\n");
    let program = &b.programs.iter().find(|p| p.program.name == "any").unwrap().program;
    assert_eq!(snapback4_core::ir::scans(program).len(), 1);
    assert!(has_note(&b, "N_NEVER_COMPLETE"));
}

const OWNER_MEMBERSHIP: &str = "table memberships:
  parent: text <=40
  principal: principal
  unique parent, principal
  cap 16 by principal
  read <- .principal = viewer
  insert <- .principal = viewer
  online only

table documents:
  owner: principal
  parent: text <=40
  at: int
  read <- .owner = viewer or exists memberships[.parent, viewer]
  insert <- .owner = viewer
  online only

query documents(c: cursor ?):
  return documents last 2 by .at after c
";

fn membership(name: &'static str, parent: &str, principal: &str) -> (&'static str, Vec<(&'static str, Value)>) {
    ("memberships", vec![("id", id(name)), ("parent", Value::String(parent.into())), ("principal", id(principal))])
}

fn document(name: &'static str, owner: &str, parent: &str, at: i64) -> (&'static str, Vec<(&'static str, Value)>) {
    ("documents", vec![("id", id(name)), ("owner", id(owner)), ("parent", Value::String(parent.into())), ("at", Value::Int(at))])
}

fn fixed_membership_source() -> String {
    OWNER_MEMBERSHIP.replace("exists memberships[.parent, viewer]",
        "exists memberships[id = 'm1', parent = .parent, principal = viewer]")
}

#[test]
fn owner_or_capped_membership_walks_one_complete_cursor() {
    let b = clean(OWNER_MEMBERSHIP);
    let program = &b.programs.iter().find(|p| p.program.name == "documents").unwrap().program;
    let merge = snapback4_core::ir::body_merges(&program.body).into_iter().find(|merge| merge.branches()).expect("branch merge");
    assert_eq!(merge.lanes.iter().filter(|lane| lane.membership()).count(), 1);
    assert!(b.schema.required_capabilities().contains("branch-membership-v1"));
    assert!(!has_note(&b, "N_NEVER_COMPLETE"), "{:#?}", b.notes);

    let rows = vec![
        membership("m1", "p1", "alice"), membership("m2", "p2", "alice"),
        document("d1", "alice", "p0", 1), document("d2", "carol", "p9", 2),
        document("d3", "alice", "p1", 3), document("d4", "bob", "p1", 4),
        document("d5", "alice", "p3", 5), document("d6", "bob", "p2", 6),
    ];
    let mut e = engine(OWNER_MEMBERSHIP, rows);
    let (got, complete) = walk(&mut e, "documents", "alice", &[]);
    assert_eq!(got, ["d6", "d5", "d4", "d3", "d1"]);
    assert!(complete.into_iter().all(|value| value));

    let all = e.query("documents", { let mut context = Context::system(); context.args.insert("c".into(), Value::Null); context }).unwrap();
    assert_eq!(ids(&all.data), ["d6", "d5"]);
    assert!(all.complete && all.next.is_some());
}

#[test]
fn reordered_named_membership_key_walks_the_same_complete_cursor() {
    let source = OWNER_MEMBERSHIP.replace("exists memberships[.parent, viewer]",
        "exists memberships[principal = viewer, parent = .parent]");
    let b = clean(&source);
    assert!(snapback4_core::ir::body_merges(&b.programs[0].program.body).into_iter().any(|merge| merge.branches()));
    assert!(b.schema.required_capabilities().contains("branch-membership-v1"));
    assert!(!has_note(&b, "N_NEVER_COMPLETE"), "{:#?}", b.notes);
    let mut e = engine(&source, vec![
        membership("m1", "p1", "alice"), membership("m2", "p2", "alice"),
        document("d1", "alice", "p0", 1), document("d2", "bob", "p1", 2),
        document("d3", "bob", "p2", 3), document("d4", "bob", "p9", 4),
    ]);
    let (got, complete) = walk(&mut e, "documents", "alice", &[]);
    assert_eq!(got, ["d3", "d2", "d1"]);
    assert!(complete.into_iter().all(|value| value));
}

#[test]
fn fixed_source_id_residual_scopes_a_complete_owner_membership_page() {
    let source = fixed_membership_source();
    let b = clean(&source);
    assert_eq!(branch_merges(&b, "documents"), vec![(3, true)]);
    assert!(b.schema.required_capabilities().contains("branch-membership-v1"));
    assert!(!has_note(&b, "N_NEVER_COMPLETE"), "{:#?}", b.notes);

    let rows = || vec![
        membership("m1", "p1", "alice"), membership("m2", "p2", "alice"), membership("m3", "p3", "bob"),
        document("owned", "alice", "p0", 1), document("fixed", "bob", "p1", 2),
        document("other-id", "bob", "p2", 3), document("other-viewer", "bob", "p3", 4),
    ];
    let mut e = engine(&source, rows());
    let (got, complete) = walk(&mut e, "documents", "alice", &[]);
    assert_eq!(got, ["fixed", "owned"]);
    assert!(complete.into_iter().all(|value| value));

    let mut missing = engine(&source, rows().into_iter().filter(|(_, fields)|
        !fields.iter().any(|(column, value)| *column == "id" && value == &id("m1"))).collect());
    let (got, complete) = walk(&mut missing, "documents", "alice", &[]);
    assert_eq!(got, ["owned"]);
    assert!(complete.into_iter().all(|value| value));
}

#[test]
fn fixed_source_id_expiry_removes_only_its_membership_lane() {
    let source = fixed_membership_source()
        .replace("  principal: principal\n  unique", "  principal: principal\n  until: time ?\n  by byExpiry: until\n  expire at .until\n  unique");
    let rows = vec![
        ("memberships", vec![("id", id("m1")), ("parent", Value::String("p1".into())),
            ("principal", id("alice")), ("until", Value::Int(5))]),
        ("memberships", vec![("id", id("m2")), ("parent", Value::String("p2".into())),
            ("principal", id("alice")), ("until", Value::Null)]),
        document("owned", "alice", "p0", 1), document("fixed", "bob", "p1", 2),
        document("other-id", "bob", "p2", 3),
    ];
    let mut e = engine(&source, rows);
    let args = BTreeMap::from([("c".into(), Value::Null)]);
    let before = e.query("documents", Context::new("alice", args.clone()).at(4)).unwrap();
    assert!(before.complete && ids(&before.data) == ["fixed", "owned"] && before.next.is_none(), "{before:?}");
    let after = e.query("documents", Context::new("alice", args).at(6)).unwrap();
    assert!(after.complete && ids(&after.data) == ["owned"] && after.next.is_none(), "{after:?}");
    assert_eq!(e.store().count("memberships").unwrap(), 2, "the expired witness remains physically unswept");
}

#[test]
fn positional_membership_key_is_selected_by_its_argument_types() {
    let source = OWNER_MEMBERSHIP.replace("  unique parent, principal\n",
        "  n: int\n  unique parent, principal\n  unique n, principal\n");
    let b = clean(&source);
    assert!(snapback4_core::ir::body_merges(&b.programs[0].program.body).into_iter().any(|merge| merge.branches()));
    assert!(b.schema.required_capabilities().contains("branch-membership-v1"));
    assert!(!has_note(&b, "N_NEVER_COMPLETE"), "{:#?}", b.notes);

    let mut e = engine(&source, vec![
        ("memberships", vec![("id", id("m1")), ("parent", Value::String("p1".into())),
            ("principal", id("alice")), ("n", Value::Int(7))]),
        document("d1", "bob", "p1", 1), document("d2", "bob", "p9", 2),
    ]);
    let page = e.query("documents", Context::new("alice", BTreeMap::from([("c".into(), Value::Null)]))).unwrap();
    assert!(page.complete && ids(&page.data) == ["d1"] && page.next.is_none(), "{page:?}");
}

#[test]
fn same_typed_positional_membership_keys_remain_ambiguous() {
    let source = OWNER_MEMBERSHIP.replace("  unique parent, principal\n",
        "  alias: text <=40\n  unique parent, principal\n  unique alias, principal\n");
    let b = bound(&source);
    assert!(b.diagnostics.iter().any(|diagnostic| diagnostic.code == "E_QUARRY_POSITIONAL_SCAN"), "{:#?}", b.diagnostics);
    assert!(!b.schema.required_capabilities().contains("branch-membership-v1"));
}

#[test]
fn membership_page_with_its_parent_already_pinned_keeps_the_original_scan() {
    let source = "table access:
  bucket: int
  principal: principal
  unique bucket, principal
  cap 16 by principal
  read <- allow
  online only

table items:
  owner: principal
  bucket: int
  tag: id
  read <- .owner = viewer or exists access[.bucket, viewer]
  online only

query items(bucket: int, c: cursor ?):
  return items where .bucket = bucket first 1 by .tag after c
";
    let b = clean(source);
    assert!(snapback4_core::ir::body_merges(&b.programs[0].program.body).into_iter().all(|merge| !merge.branches()));
    assert!(!b.schema.tables["items"].indexes.values().any(|index| index.columns() == ["bucket", "owner", "tag", "id"]));
    assert!(!b.schema.tables["access"].indexes.values().any(|index| index.columns() == ["principal", "bucket", "id"]));
    let mut e = engine(source, vec![]);
    let page = e.query("items", Context::new("alice", BTreeMap::from([("bucket".into(), Value::Int(0)), ("c".into(), Value::Null)]))).unwrap();
    assert!(!page.complete && page.data.as_array().is_ok_and(|rows| rows.is_empty()) && page.next.is_none(), "{page:?}");
}

#[test]
fn membership_page_with_parent_pinned_in_each_alternative_keeps_the_original_scan() {
    let source = "table access:
  bucket: int
  principal: principal
  unique bucket, principal
  cap 16 by principal
  read <- allow
  online only

table items:
  owner: principal
  bucket: int
  tag: id
  read <- .owner = viewer or exists access[.bucket, viewer]
  online only

query items(bucket: int, c: cursor ?):
  return items where (.owner = viewer and .bucket = bucket) or (.owner = viewer and .bucket = 1) first 1 by .tag after c
";
    let b = clean(source);
    assert!(snapback4_core::ir::body_merges(&b.programs[0].program.body).into_iter().all(|merge| !merge.branches()));
    assert!(!b.schema.tables["items"].indexes.values().any(|index| index.columns() == ["bucket", "owner", "tag", "id"]));
    assert!(!b.schema.tables["access"].indexes.values().any(|index| index.columns() == ["principal", "bucket", "id"]));
    let mut e = engine(source, vec![]);
    let page = e.query("items", Context::new("alice", BTreeMap::from([("bucket".into(), Value::Int(0)), ("c".into(), Value::Null)]))).unwrap();
    assert!(!page.complete && page.data.as_array().is_ok_and(|rows| rows.is_empty()) && page.next.is_none(), "{page:?}");
}

#[test]
fn membership_cap_may_exceed_the_static_branch_limit() {
    let mut rows = Vec::new();
    for n in 0..10 {
        let member = Box::leak(format!("m{n}").into_boxed_str());
        let doc = Box::leak(format!("d{n}").into_boxed_str());
        let parent = format!("p{n}");
        rows.push(membership(member, &parent, "alice"));
        rows.push(document(doc, "bob", &parent, n));
    }
    let mut e = engine(OWNER_MEMBERSHIP, rows);
    let (got, complete) = walk(&mut e, "documents", "alice", &[]);
    assert_eq!(got.len(), 10);
    assert!(complete.into_iter().all(|value| value));
}

#[test]
fn owner_or_uncapped_membership_keeps_the_incomplete_single_scan() {
    let source = OWNER_MEMBERSHIP.replace("  cap 16 by principal\n", "");
    let b = clean(&source);
    assert!(snapback4_core::ir::body_merges(&b.programs[0].program.body).into_iter().all(|merge| !merge.branches()));
    assert!(has_note(&b, "N_NEVER_COMPLETE"));
    assert!(!b.schema.required_capabilities().contains("branch-membership-v1"));
}

#[test]
fn oversized_membership_discovery_index_keeps_the_incomplete_single_scan() {
    let source = OWNER_MEMBERSHIP.replace("text <=40", "text <=435");
    let b = clean(&source);
    assert!(snapback4_core::ir::body_merges(&b.programs[0].program.body).into_iter().all(|merge| !merge.branches()));
    assert!(has_note(&b, "N_NEVER_COMPLETE"));
    assert!(!b.schema.required_capabilities().contains("branch-membership-v1"));
}

#[test]
fn overwide_membership_discovery_index_keeps_the_ordinary_scan() {
    let base = "table memberships:
  parent: text <=40
  principal: principal
  a: int
  b: int
  c: int
  d: int
  e: int
  f: int
  unique parent, principal
  cap 16 by principal
  read <- .principal = viewer
  online only

table documents:
  owner: principal
  parent: text <=40
  at: int
  read <- .owner = viewer or exists memberships[parent = .parent, principal = viewer, a = 0, b = 0, c = 0, d = 0, e = 0, f = 0]
  online only

query documents(c: cursor ?):
  return documents last 2 by .at after c
";
    for source in [base.to_owned(), base.replace("  cap 16 by principal\n", "")] {
        let b = clean(&source);
        assert!(branch_merges(&b, "documents").is_empty());
        assert!(!b.schema.tables["documents"].indexes.values().any(|index| index.columns() == ["owner", "at", "id"]));
        assert!(!b.schema.tables["memberships"].indexes.values().any(|index| index.columns().len() > 8));
        assert!(has_note(&b, "N_NEVER_COMPLETE"), "{:#?}", b.notes);
        assert!(!b.schema.required_capabilities().contains("branch-membership-v1"));

        let mut e = engine(&source, vec![
            ("memberships", vec![("id", id("m1")), ("parent", Value::String("p1".into())), ("principal", id("alice")),
                ("a", Value::Int(0)), ("b", Value::Int(0)), ("c", Value::Int(0)),
                ("d", Value::Int(0)), ("e", Value::Int(0)), ("f", Value::Int(0))]),
            document("owned", "alice", "p0", 1), document("shared", "bob", "p1", 2),
        ]);
        let page = e.query("documents", Context::new("alice", BTreeMap::from([("c".into(), Value::Null)]))).unwrap();
        assert_eq!(ids(&page.data), ["shared", "owned"]);
        assert!(!page.complete && page.next.is_some(), "{page:?}");
    }
}

#[test]
fn row_id_membership_keeps_the_incomplete_single_scan() {
    let source = "table documents:
  owner: principal
  at: int
  read <- .owner = viewer or exists shares[.id, viewer]
  insert <- .owner = viewer
  online only

table shares:
  document: documents
  principal: principal
  unique document, principal
  cap 16 by principal
  read <- .principal = viewer
  insert <- .principal = viewer
  online only

query documents(c: cursor ?):
  return documents last 2 by .at after c
";
    let b = clean(source);
    assert!(snapback4_core::ir::body_merges(&b.programs[0].program.body).into_iter().all(|merge| !merge.branches()));
    assert!(!b.schema.tables["documents"].indexes.values().any(|index| index.columns() == ["owner", "at", "id"]));
    assert!(!b.schema.tables["shares"].indexes.values().any(|index| index.columns() == ["principal", "document", "id"]));
    assert!(has_note(&b, "N_NEVER_COMPLETE"));
    assert!(!b.schema.required_capabilities().contains("branch-membership-v1"));
}

#[test]
fn membership_source_with_a_true_pinned_disjunct_still_merges() {
    let source = OWNER_MEMBERSHIP
        .replace("  principal: principal\n", "  principal: principal\n  isPublic: bool\n")
        .replace("  read <- .principal = viewer\n", "  read <- .principal = viewer or .isPublic\n");
    let b = clean(&source);
    assert!(snapback4_core::ir::body_merges(&b.programs[0].program.body).into_iter().any(|merge| merge.branches()));
    assert!(!has_note(&b, "N_NEVER_COMPLETE"));
    assert!(b.schema.required_capabilities().contains("branch-membership-v1"));
}

#[test]
fn a_decided_false_membership_source_commits_no_speculative_indexes() {
    let source = OWNER_MEMBERSHIP.replace("  read <- .principal = viewer\n", "  read <- deny\n");
    let b = clean(&source);
    assert!(snapback4_core::ir::body_merges(&b.programs[0].program.body).into_iter().all(|merge| !merge.branches()));
    assert!(!b.schema.tables["documents"].indexes.values().any(|index| index.columns() == ["owner", "at", "id"]));
    assert!(!b.schema.tables["memberships"].indexes.values().any(|index| index.columns() == ["principal", "parent", "id"]));
    assert!(has_note(&b, "N_NEVER_COMPLETE"));
    assert!(!b.schema.required_capabilities().contains("branch-membership-v1"));
}

#[test]
fn a_denied_fixed_source_id_commits_no_speculative_indexes() {
    let source = fixed_membership_source().replace("  read <- .principal = viewer\n", "  read <- deny\n");
    let b = clean(&source);
    assert!(branch_merges(&b, "documents").is_empty());
    assert!(!b.schema.tables["documents"].indexes.values().any(|index| index.columns() == ["owner", "at", "id"]));
    assert!(!b.schema.tables["memberships"].indexes.values().any(|index| index.columns() == ["principal", "parent", "id"]));
    assert!(has_note(&b, "N_NEVER_COMPLETE"));
    assert!(!b.schema.required_capabilities().contains("branch-membership-v1"));

    let mut e = engine(&source, vec![membership("m1", "p1", "alice"), document("shared", "bob", "p1", 1)]);
    let page = e.query("documents", Context::new("alice", BTreeMap::from([("c".into(), Value::Null)]))).unwrap();
    assert_eq!(ids(&page.data), ["shared"]);
    assert!(!page.complete, "the ordinary rule probe still grants the row: {page:?}");
}

#[test]
fn a_read_through_membership_source_keeps_parent_authorization() {
    let source = "table parents:
  read <- deny
  online only

table memberships:
  parent: parents
  principal: principal
  immutable parent
  unique parent, principal
  cap 16 by principal
  read through .parent
  online only

table documents:
  owner: principal
  parent: parents
  at: int
  read <- .owner = viewer or exists memberships[.parent, viewer]
  online only

query documents(c: cursor ?):
  return documents last 2 by .at after c
";
    let b = clean(source);
    assert!(snapback4_core::ir::body_merges(&b.programs[0].program.body).into_iter().all(|merge| !merge.branches()));
    assert!(!b.schema.tables["documents"].indexes.values().any(|index| index.columns() == ["owner", "at", "id"]));
    assert!(!b.schema.tables["memberships"].indexes.values().any(|index| index.columns() == ["principal", "parent", "id"]));
    assert!(has_note(&b, "N_NEVER_COMPLETE"));
    assert!(!b.schema.required_capabilities().contains("branch-membership-v1"));

    let mut e = engine(source, vec![
        ("parents", vec![("id", id("p1"))]),
        ("memberships", vec![("id", id("m1")), ("parent", id("p1")), ("principal", id("alice"))]),
        ("documents", vec![("id", id("d1")), ("owner", id("bob")), ("parent", id("p1")), ("at", Value::Int(1))]),
    ]);
    let page = e.query("documents", Context::new("alice", BTreeMap::from([("c".into(), Value::Null)]))).unwrap();
    // The outer rule's raw witness admits d1, while an authorized source scan
    // through the denied parent would discover no lane. Keeping the original
    // scan preserves that distinction and makes no completeness claim.
    assert_eq!(ids(&page.data), ["d1"]);
    assert!(!page.complete, "{page:?}");
}

#[test]
fn a_discovery_cut_emits_no_owner_rows_and_no_cursor() {
    let mut e = engine(OWNER_MEMBERSHIP, vec![
        membership("m1", "p1", "alice"), membership("m2", "p2", "alice"),
        document("d1", "alice", "p0", 1), document("d2", "bob", "p1", 2),
    ]);
    e.set_ceilings(snapback4_core::Ceilings { examined: 1, ..Default::default() });
    let page = e.query("documents", Context::new("alice", BTreeMap::from([("c".into(), Value::Null)]))).unwrap();
    assert!(ids(&page.data).is_empty(), "a partial source cannot release even an owner row: {page:?}");
    assert!(!page.complete && page.next.is_none());
}

#[test]
fn an_empty_membership_frontier_prices_its_actual_continuation_key() {
    let source = OWNER_MEMBERSHIP
        .replace("  at: int\n", "  at: int\n  rank: text <=300\n  tag: text <=1\n")
        .replace("return documents last 2 by .at after c", "return documents where .tag != 'x' last 2 by .rank after c");
    let rows = |wide: bool| {
        let mut rows = vec![membership("m1", "p1", "alice")];
        for n in 0..4 {
            let name = Box::leak(format!("d{n}").into_boxed_str());
            let rank = if wide { format!("{}{}", "r".repeat(298), n) } else { format!("r{n}") };
            rows.push(("documents", vec![("id", id(name)), ("owner", id("bob")), ("parent", Value::String("p1".into())),
                ("at", Value::Int(n)), ("rank", Value::String(rank)), ("tag", Value::String("x".into()))]));
        }
        rows
    };
    let run = |wide: bool, examined| {
        let mut engine = engine(&source, rows(wide));
        engine.set_ceilings(snapback4_core::Ceilings { examined, ..snapback4_core::Ceilings::unbounded() });
        engine.query("documents", Context::new("alice", BTreeMap::from([("c".into(), Value::Null)]))).unwrap()
    };
    let (examined, wide) = (1..40).find_map(|examined| {
        let page = run(true, examined);
        (!page.complete && ids(&page.data).is_empty() && page.next.is_some()).then_some((examined, page))
    }).expect("a target filter cut has an empty safe frontier");
    let position = snapback4_core::cursor::decode_cursor(&engine(&source, rows(true)).schema().clone(), wide.next.as_ref().unwrap()).unwrap();
    assert!(position.values.iter().any(|value| value.as_str().is_ok_and(|text| text.len() > 250)), "{position:?}");
    let short = run(false, examined);
    assert!(short.next.is_some() && ids(&short.data).is_empty(), "{short:?}");
    assert!(wide.metered.heap_bytes > short.metered.heap_bytes + 20_000,
        "the actual frontier key must size cursor scratch: wide={:?}, short={:?}", wide.metered, short.metered);
}

#[test]
fn membership_lanes_borrow_the_compiled_scan_and_obey_the_heap_boundary() {
    let literal = "x".repeat(1000);
    let source = OWNER_MEMBERSHIP
        .replace("  at: int\n", "  at: int\n  tag: text <=1000\n")
        .replace("return documents last 2 by .at after c", &format!("return documents where .tag != '{literal}' last 2 by .at after c"));
    let rows = (0..16).map(|n| {
        let member = Box::leak(format!("m{n}").into_boxed_str());
        membership(member, &format!("p{n}"), "alice")
    }).collect();
    let mut full = engine(&source, rows);
    full.set_ceilings(snapback4_core::Ceilings::unbounded());
    let args = BTreeMap::from([("c".into(), Value::Null)]);
    let page = full.query("documents", Context::new("alice", args.clone())).unwrap();
    assert!(page.complete && page.data.as_array().is_ok_and(|rows| rows.is_empty()) && page.next.is_none(), "{page:?}");
    // The 1 KiB residual expression is one compiled shared image, rather
    // than sixteen unpriced copies retained by the generated lanes.
    assert!(page.metered.heap_bytes < 96 * 1024, "unexpected per-lane Scan copies: {:?}", page.metered);

    let mut cut = engine(&source, (0..16).map(|n| {
        let member = Box::leak(format!("n{n}").into_boxed_str());
        membership(member, &format!("q{n}"), "alice")
    }).collect());
    cut.set_ceilings(snapback4_core::Ceilings { heap_bytes: page.metered.heap_bytes - 1, ..snapback4_core::Ceilings::unbounded() });
    let page = cut.query("documents", Context::new("alice", args)).unwrap();
    assert!(!page.complete && (page.data == Value::Null || page.data.as_array().is_ok_and(|rows| rows.is_empty())) && page.next.is_none(), "{page:?}");
    assert!(page.metered.heap_bytes >= cut.ceilings().heap_bytes);
}

#[test]
fn membership_merge_prices_all_sixteen_target_buffers_before_payload_allocation() {
    let payload = "p".repeat(128 * 1024);
    let source = OWNER_MEMBERSHIP.replace("  at: int\n", "  at: int\n  payload: text <=131072\n");
    let rows = || {
        let mut rows = Vec::new();
        for n in 0..16 {
            let parent = format!("p{n}");
            let member = Box::leak(format!("m{n}").into_boxed_str());
            rows.push(membership(member, &parent, "alice"));
            for at in 0..3 {
                let document = Box::leak(format!("d{n}_{at}").into_boxed_str());
                rows.push(("documents", vec![("id", id(document)), ("owner", id("bob")), ("parent", Value::String(parent.clone())),
                    ("at", Value::Int(i64::from(n * 3 + at))), ("payload", Value::String(payload.clone()))]));
            }
        }
        rows
    };
    let args = BTreeMap::from([("c".into(), Value::Null)]);
    let mut full = engine(&source, rows());
    full.set_ceilings(snapback4_core::Ceilings::unbounded());
    let page = full.query("documents", Context::new("alice", args.clone())).unwrap();
    assert!(page.complete && page.next.is_some() && ids(&page.data).len() == 2, "{page:?}");
    assert!(page.metered.heap_bytes > 5 * 1024 * 1024, "target read-ahead was not priced: {:?}", page.metered);

    let mut cut = engine(&source, rows());
    cut.set_ceilings(snapback4_core::Ceilings { heap_bytes: 1024 * 1024, ..snapback4_core::Ceilings::unbounded() });
    let page = cut.query("documents", Context::new("alice", args)).unwrap();
    assert!(!page.complete && page.next.is_none() && (page.data == Value::Null || ids(&page.data).is_empty()), "{page:?}");
    assert!(page.metered.heap_bytes >= 1024 * 1024, "target payload did not reach the heap boundary: {:?}", page.metered);
}

#[test]
fn escaped_membership_parent_uses_a_prepaid_canonical_key_buffer() {
    let source = OWNER_MEMBERSHIP.replace("text <=40", "text <=400");
    let query = |parent: &str, heap_bytes: Option<u64>| {
        let mut engine = engine(&source, vec![
            membership("m1", parent, "alice"),
            document("d1", "bob", parent, 1),
        ]);
        if let Some(heap_bytes) = heap_bytes {
            engine.set_ceilings(snapback4_core::Ceilings { heap_bytes, ..snapback4_core::Ceilings::unbounded() });
        }
        engine.query("documents", Context::new("alice", BTreeMap::from([("c".into(), Value::Null)]))).unwrap()
    };

    let plain = query(&"x".repeat(400), None);
    let escaped = query(&"\"".repeat(400), None);
    assert!(plain.complete && escaped.complete && ids(&escaped.data) == ["d1"] && escaped.next.is_none(),
        "default PAGE execution must admit the largest escaped parent: {escaped:?}");
    assert!(escaped.metered.heap_bytes > plain.metered.heap_bytes + 350,
        "canonical escaping must contribute to the context price: plain={:?}, escaped={:?}", plain.metered, escaped.metered);

    let ceiling = plain.metered.heap_bytes + 200;
    let cut = query(&"\"".repeat(400), Some(ceiling));
    assert!(!cut.complete && cut.next.is_none()
        && (cut.data == Value::Null || cut.data.as_array().is_ok_and(|rows| rows.is_empty())),
        "a discovery-key cut must not expose a partial PAGE result: {cut:?}");
    assert!(cut.metered.heap_bytes >= ceiling, "escaped discovery did not reach its heap boundary: {:?}", cut.metered);
}
