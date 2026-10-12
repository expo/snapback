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
