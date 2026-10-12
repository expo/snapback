//! App-farm wave 4 (snapback4@0.4.19): rule-language and diagnostic friction
//! (LLP 3000.036 §14). Each test pins `check` against the engine on the
//! lanes' own shapes, or applies a printed rewrite and compiles and runs it.
use snapback4_core::{Context, Engine, Value, WriteState, value::object};
use snapback4_lang::{Bound, Diagnostic, compile};
use std::collections::BTreeMap;

fn bound(source: &str) -> Bound {
    compile(&[("schema.q".into(), source.into())])
}

fn clean(source: &str) -> Bound {
    let b = bound(source);
    assert!(b.diagnostics.is_empty(), "{source}\n{:#?}", b.diagnostics);
    b
}

fn first(source: &str, code: &str) -> Diagnostic {
    let b = bound(source);
    b.diagnostics.iter().find(|d| d.code == code && d.cascade_of.is_none()).unwrap_or_else(|| panic!("{code}: {:#?}", b.diagnostics)).clone()
}

fn note<'a>(b: &'a Bound, code: &str) -> Option<&'a Diagnostic> {
    b.notes.iter().find(|n| n.code == code)
}

fn args(pairs: &[(&str, Value)]) -> BTreeMap<String, Value> {
    pairs.iter().map(|(k, v)| ((*k).to_owned(), v.clone())).collect()
}

fn engine(source: &str, rows: Vec<(&str, Vec<(&str, Value)>)>) -> Engine {
    let b = clean(source);
    let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed(rows.into_iter().map(|(table, fields)| (table.to_owned(), object(fields)))).unwrap_or_else(|e| panic!("{source}\n{e:?}"));
    engine
}

fn id(text: &str) -> Value { Value::Id(text.into()) }

/// `(complete, rows)` for a query, or None when it refuses.
fn page(engine: &mut Engine, query: &str, viewer: &str, pairs: &[(&str, Value)]) -> Option<(bool, usize)> {
    let outcome = engine.query(query, Context::new(viewer, args(pairs))).ok()?;
    Some((outcome.complete, outcome.data.as_array().map_or(0, |rows| rows.len())))
}

// ---- #3a: `or` guards, pins on the order column, prefix-decided guards ----

/// Lanes 010 and 095: two grants, one guard `if exists A or exists B:`.
const LIBRARY: &str = "table volunteers:
  principal: principal
  unique principal
  read <- .principal = viewer
  online only
table coordinators:
  principal: principal
  unique principal
  read <- .principal = viewer
  online only
table people:
  principal: principal
  role: enum('team', 'mentor', 'organizer')
  unique principal
  read <- .principal = viewer
  online only
table reports:
  reporter: principal
  at: int
  read <- .reporter = viewer or exists volunteers[viewer] or exists coordinators[viewer]
  online only
table tickets:
  owner: principal
  at: int
  read <- .owner = viewer or exists people[principal = viewer, role = 'mentor'] or exists people[principal = viewer, role = 'organizer']
  online only
";

fn library_rows() -> Vec<(&'static str, Vec<(&'static str, Value)>)> {
    vec![
        ("volunteers", vec![("id", id("v1")), ("principal", id("vera"))]),
        ("coordinators", vec![("id", id("c1")), ("principal", id("cody"))]),
        ("people", vec![("id", id("p1")), ("principal", id("mia")), ("role", Value::String("mentor".into()))]),
        ("people", vec![("id", id("p2")), ("principal", id("olly")), ("role", Value::String("organizer".into()))]),
        ("people", vec![("id", id("p3")), ("principal", id("tim")), ("role", Value::String("team".into()))]),
        ("reports", vec![("id", id("r1")), ("reporter", id("rae")), ("at", Value::Int(1))]),
        ("reports", vec![("id", id("r2")), ("reporter", id("sam")), ("at", Value::Int(2))]),
        ("tickets", vec![("id", id("t1")), ("owner", id("tim")), ("at", Value::Int(1))]),
        ("tickets", vec![("id", id("t2")), ("owner", id("tom")), ("at", Value::Int(2))]),
    ]
}

#[test]
fn an_or_guard_of_grants_is_followed_and_the_runtime_agrees() {
    let cases = [
        // 095: the disjunctive guard, then the owner's own page.
        ("query q(c: cursor ?):\n  if exists volunteers[viewer] or exists coordinators[viewer]:\n    return reports last 50 by .at after c\n  return reports where .reporter = viewer last 50 by .at after c\n", "reports", 2),
        // The same guard as an early exit (De Morgan).
        ("query q(c: cursor ?):\n  if not exists volunteers[viewer] and not exists coordinators[viewer]:\n    return []\n  return reports last 50 by .at after c\n", "reports", 2),
        ("query q(c: cursor ?):\n  if not (exists volunteers[viewer] or exists coordinators[viewer]):\n    return []\n  return reports last 50 by .at after c\n", "reports", 2),
        ("query q(c: cursor ?):\n  require exists volunteers[viewer] or exists coordinators[viewer] else STAFF_ONLY\n  return reports last 50 by .at after c\n", "reports", 2),
        // 010: grants named by equalities (each probe binds the row, then compares).
        ("query q(c: cursor ?):\n  if exists people[principal = viewer, role = 'mentor'] or exists people[principal = viewer, role = 'organizer']:\n    return tickets last 30 by .at after c\n  return tickets where .owner = viewer last 30 by .at after c\n", "tickets", 2),
    ];
    for (query, table, all) in cases {
        let source = format!("{LIBRARY}{query}");
        let b = clean(&source);
        assert!(note(&b, "N_NEVER_COMPLETE").is_none(), "every caller who reaches the page holds a grant:\n{source}\n{:#?}", b.notes);
        let mut engine = engine(&source, library_rows());
        for viewer in ["vera", "cody", "mia", "olly", "tim", "rae", "zed"] {
            // A refusal (`require`) means the caller never reaches a page.
            let Some((complete, _)) = page(&mut engine, "q", viewer, &[("c", Value::Null)]) else { continue };
            assert!(complete, "{viewer}: check printed no note, so the runtime answers complete:\n{source}");
        }
        let staff = if table == "reports" { ["vera", "cody"] } else { ["mia", "olly"] };
        for viewer in staff { assert_eq!(page(&mut engine, "q", viewer, &[("c", Value::Null)]), Some((true, all)), "{viewer}:\n{source}"); }
    }
    // A disjunct that is not a grant still proves nothing, and the runtime still
    // answers capped, once the page keeps one index (arithmetic in its predicate;
    // as written it merges, LLP 3000.036.001).
    let source = format!("{LIBRARY}query q(open: bool, c: cursor ?):\n  if exists volunteers[viewer] or open:\n    return reports where .at + 1 > 0 last 50 by .at after c\n  return []\n");
    let b = bound(&source);
    assert!(note(&b, "N_NEVER_COMPLETE").is_some(), "{:#?}", b.notes);
    let mut engine = engine(&source, library_rows());
    assert_eq!(page(&mut engine, "q", "rae", &[("open", Value::Bool(true)), ("c", Value::Null)]).map(|p| p.0), Some(false));
}

#[test]
fn a_page_ordered_by_its_pinned_column_reads_that_prefix_and_is_complete() {
    // 037: `where .tester = viewer first 50 by .tester` with `unique tester`.
    let source = "table leads:\n  principal: principal\n  unique principal\n  read <- .principal = viewer\n  online only
table invitations:\n  tester: principal\n  at: int\n  unique tester\n  read <- .tester = viewer or exists leads[viewer]\n  online only
table notes:\n  owner: principal\n  at: int\n  read <- .owner = viewer\n  online only
query mine():\n  return invitations where .tester = viewer first 50 by .tester
query notesOf(c: cursor ?):\n  return notes where .owner = viewer first 1 by .owner after c
";
    let b = clean(source);
    assert!(note(&b, "N_NEVER_COMPLETE").is_none(), "{:#?}", b.notes);
    let mut engine = engine(source, vec![
        ("invitations", vec![("id", id("i1")), ("tester", id("tess")), ("at", Value::Int(1))]),
        ("invitations", vec![("id", id("i2")), ("tester", id("tina")), ("at", Value::Int(2))]),
        ("notes", vec![("id", id("n1")), ("owner", id("tess")), ("at", Value::Int(1))]),
        ("notes", vec![("id", id("n2")), ("owner", id("tess")), ("at", Value::Int(2))]),
        ("notes", vec![("id", id("n3")), ("owner", id("tina")), ("at", Value::Int(3))]),
    ]);
    assert_eq!(page(&mut engine, "mine", "tess", &[]), Some((true, 1)));
    // A non-unique pinned order column pages by id within the pin, and the cursor continues.
    let outcome = engine.query("notesOf", Context::new("tess", args(&[("c", Value::Null)]))).unwrap();
    assert_eq!(outcome.data.as_array().unwrap().len(), 1);
    let cursor = outcome.next.clone().expect("a full page continues");
    let next = engine.query("notesOf", Context::new("tess", args(&[("c", Value::String(cursor))]))).unwrap();
    assert_eq!(next.data.as_array().unwrap().len(), 1);
    assert_ne!(outcome.data, next.data);
}

/// Lane 039: a parent grant the scan's pin decides is not a grant the server
/// uses, guarded or not. The note says so, and its copy recipe makes the
/// leader's roster complete.
#[test]
fn a_prefix_decided_parent_grant_is_named_and_its_copy_recipe_completes_the_page() {
    let rides = "table rides:\n  leader: principal\n  immutable leader\n  read <- allow\n  online only\n";
    let source = format!("{rides}table rsvps:\n  ride: rides\n  member: principal\n  unique ride, member\n  immutable ride, member\n  read <- .member = viewer or exists rides[.ride, leader = viewer]\n  insert <- .member = viewer\n  online only
query roster(ride: rides, c: cursor ?):\n  require exists rides[ride, leader = viewer] else NOT_LEADER\n  return rsvps where .ride = ride first 50 by .id after c\n");
    let b = bound(&source);
    let n = note(&b, "N_NEVER_COMPLETE").unwrap_or_else(|| panic!("{:#?}", b.notes));
    assert!(n.message.contains("`exists rides[.ride, leader = viewer]` is decided by the scan's pins") && n.message.contains("whatever `require` or `if` guards it"), "{n}");
    assert!(n.rewrite.contains("`read <- .member = viewer or .leader = viewer`") && n.rewrite.contains("`and exists rides[.ride, leader = .leader]`"), "{n}");
    let rows = || vec![
        ("rides", vec![("id", id("ride1")), ("leader", id("lee"))]),
        ("rsvps", vec![("id", id("a")), ("ride", id("ride1")), ("member", id("ann")), ("leader", id("lee"))]),
        ("rsvps", vec![("id", id("b")), ("ride", id("ride1")), ("member", id("bo")), ("leader", id("lee"))]),
    ];
    let original = rows().into_iter().map(|(t, mut f)| { f.retain(|(k, _)| *k != "leader" || t == "rides"); (t, f) }).collect();
    let mut engine_before = engine(&source, original);
    assert_eq!(page(&mut engine_before, "roster", "lee", &[("ride", id("ride1")), ("c", Value::Null)]), Some((false, 2)), "the runtime agrees with the note");
    // The recipe, applied as printed: the copy, its insert check, the column rule and the pinned page.
    let page_text = n.rewrite.split("is complete: `").nth(1).and_then(|rest| rest.split('`').next()).unwrap_or_else(|| panic!("{n}"));
    let repaired = format!("{rides}table rsvps:\n  ride: rides\n  member: principal\n  leader: principal\n  unique ride, member\n  immutable ride, member\n  immutable ride, leader\n  read <- .member = viewer or .leader = viewer\n  insert <- .member = viewer and exists rides[.ride, leader = .leader]\n  online only
query roster(ride: rides, c: cursor ?):\n  require exists rides[ride, leader = viewer] else NOT_LEADER\n  return {page_text}\n");
    let b = clean(&repaired);
    assert!(note(&b, "N_NEVER_COMPLETE").is_none(), "{repaired}\n{:#?}", b.notes);
    let mut engine = engine(&repaired, rows());
    assert_eq!(page(&mut engine, "roster", "lee", &[("ride", id("ride1")), ("c", Value::Null)]), Some((true, 2)));
}

// ---- #3b: the role branch and the per-party split lead the note, and compile ----

#[test]
fn an_owner_or_grant_list_prints_the_role_branch_first_and_it_compiles_complete() {
    // As written each page merges the grant with the owner's range (LLP
    // 3000.036.001); with arithmetic in the predicate the note prints the
    // role branch first, and that code compiles complete.
    for query in ["query q(c: cursor ?):\n  return reports last 50 by .at after c\n", "query q(c: cursor ?):\n  return tickets where .at > 0 last 30 by .at after c\n"] {
        assert!(note(&clean(&format!("{LIBRARY}{query}")), "N_NEVER_COMPLETE").is_none(), "{query}");
    }
    let cases = [
        ("query q(c: cursor ?):\n  return reports where .at + 1 > 0 last 50 by .at after c\n", "reports", ["vera", "cody"], "rae"),
        ("query q(c: cursor ?):\n  return tickets where .at + 1 > 1 last 30 by .at after c\n", "tickets", ["mia", "olly"], "tim"),
    ];
    for (query, table, staff, owner) in cases {
        let source = format!("{LIBRARY}{query}");
        let n = note(&bound(&source), "N_NEVER_COMPLETE").unwrap_or_else(|| panic!("{source}")).clone();
        assert!(n.rewrite.starts_with("Branch on the grant"), "the role branch leads: {n}");
        let code = n.rewrite.split_once(":\n").unwrap().1.split("\n\n").next().unwrap();
        assert!(code.starts_with("query q(") && code.contains("\n  if exists ") && code.contains(" or exists "), "{code}");
        let repaired = format!("{LIBRARY}{code}\n");
        let b = clean(&repaired);
        assert!(note(&b, "N_NEVER_COMPLETE").is_none(), "{repaired}\n{:#?}", b.notes);
        let mut engine = engine(&repaired, library_rows());
        for viewer in staff { assert_eq!(page(&mut engine, "q", viewer, &[("c", Value::Null)]), Some((true, 2)), "{viewer} ({table})"); }
        assert_eq!(page(&mut engine, "q", owner, &[("c", Value::Null)]), Some((true, 1)), "{owner} ({table})");
        assert_eq!(page(&mut engine, "q", "zed", &[("c", Value::Null)]), Some((true, 0)));
    }
}

#[test]
fn a_two_party_list_prints_its_per_party_queries_first() {
    // LLP 3000.036.001: as written the page merges its parties; arithmetic in
    // the predicate keeps one index, and the note leads with the per-party queries.
    let table = "table tasks:\n  owner: principal\n  assignee: principal\n  at: time\n  n: int\n  read <- .owner = viewer or .assignee = viewer\n  online only\n";
    assert!(note(&clean(&format!("{table}query mine(c: cursor ?):\n  return tasks last 20 by .at after c\n")), "N_NEVER_COMPLETE").is_none());
    let source = format!("{table}query mine(c: cursor ?):\n  return tasks where .n + 1 > 0 last 20 by .at after c\n");
    let n = note(&bound(&source), "N_NEVER_COMPLETE").unwrap().clone();
    assert!(n.rewrite.starts_with("Replace this query with one per party"), "{n}");
    let code = n.rewrite.split_once(":\n").unwrap().1.split("\n\n").next().unwrap();
    let b = clean(&format!("{table}{code}\n"));
    assert!(note(&b, "N_NEVER_COMPLETE").is_none() && b.programs.len() == 2, "{code}");
}

#[test]
fn a_never_complete_note_names_only_its_own_tables_index() {
    // 016 095: one generated index name shared by three tables printed all three.
    let source = format!("{LIBRARY}table stock:\n  at: int\n  public 'p'\n  online only\nquery q(c: cursor ?):\n  return reports where .at + 1 > 0 last 50 by .at after c\nquery s(c: cursor ?):\n  return stock last 50 by .at after c\n");
    let n = note(&bound(&source), "N_NEVER_COMPLETE").unwrap().clone();
    assert!(n.message.contains("on reports (at, id)") && !n.message.contains("on stock") && !n.message.contains(" or read or declaration"), "{n}");
}

// ---- #8: read-rule hops ----

const GOALS: &str = "table goals:\n  owner: principal\n  done: bool\n  read <- .owner = viewer\n  online only\n";

#[test]
fn a_hop_inside_or_compiles_as_the_probe_and_admits_the_same_readers() {
    let steps = |rule: &str| format!("{GOALS}table steps:\n  goal: goals\n  author: principal\n  immutable goal\n  read <- {rule}\n  online only\nquery all(c: cursor ?):\n  return steps first 50 by .id after c\n");
    let pairs = [
        (".author = viewer or .goal.owner = viewer", ".author = viewer or exists goals[.goal, owner = viewer]"),
        ("not (.goal.owner = viewer) and .author = viewer", "not (exists goals[.goal, owner = viewer]) and .author = viewer"),
        (".author = viewer or .goal.done", ".author = viewer or exists goals[.goal, done = true]"),
    ];
    for (hop, probe) in pairs {
        let (a, b) = (clean(&steps(hop)), clean(&steps(probe)));
        assert_eq!(a.schema.tables["steps"].rules.read, b.schema.tables["steps"].rules.read, "{hop}");
    }
    let mut engine = engine(&steps(pairs[0].0), vec![
        ("goals", vec![("id", id("g1")), ("owner", id("gwen")), ("done", Value::Bool(false))]),
        ("steps", vec![("id", id("s1")), ("goal", id("g1")), ("author", id("abe"))]),
    ]);
    for (viewer, rows) in [("abe", 1), ("gwen", 1), ("zed", 0)] {
        assert_eq!(page(&mut engine, "all", viewer, &[("c", Value::Null)]).map(|p| p.1), Some(rows), "{viewer}");
    }
    // A synced table still needs its reader on the row: the copy rewrite, as before.
    let synced = format!("{GOALS}table steps:\n  goal: goals\n  author: principal\n  immutable goal\n  read <- .author = viewer or .goal.owner = viewer\n  sync to .author\n");
    let d = first(&synced, "E_QUARRY_RULE_HOP");
    assert!(d.rewrite.contains("declare `owner: principal`"), "{d}");
}

#[test]
fn a_read_through_child_of_a_hopping_parent_inherits_the_probe_and_never_prints_internal_names() {
    let classes = "table classes:\n  teacher: principal\n  public 'classes are public'\n  online only\n";
    let online = format!("{classes}table enrollments:\n  classId: classes\n  dancer: principal\n  immutable classId, dancer\n  read <- .dancer = viewer or .classId.teacher = viewer\n  online only
table attendance:\n  enrollment: enrollments\n  immutable enrollment\n  read through .enrollment\n  online only\nquery all(c: cursor ?):\n  return attendance first 50 by .id after c\n");
    let mut engine = engine(&online, vec![
        ("classes", vec![("id", id("k1")), ("teacher", id("tia"))]),
        ("enrollments", vec![("id", id("e1")), ("classId", id("k1")), ("dancer", id("dan"))]),
        ("attendance", vec![("id", id("a1")), ("enrollment", id("e1"))]),
    ]);
    for (viewer, rows) in [("dan", 1), ("tia", 1), ("zed", 0)] {
        assert_eq!(page(&mut engine, "all", viewer, &[("c", Value::Null)]).map(|p| p.1), Some(rows), "{viewer}");
    }
    // 064 080: a refused (synced) parent: one refusal at the parent, no `.$enrollment` spelling anywhere.
    let synced = online.replace("  read <- .dancer = viewer or .classId.teacher = viewer\n  online only", "  read <- .dancer = viewer or .classId.teacher = viewer\n  sync to .dancer").replace("  read through .enrollment\n  online only", "  read through .enrollment\n  sync");
    let b = bound(&synced);
    assert!(!b.diagnostics.is_empty());
    for d in &b.diagnostics { assert!(!d.message.contains(".$") && !d.rewrite.contains(".$"), "{d}"); }
    assert_eq!(b.diagnostics.iter().filter(|d| d.code == "E_QUARRY_RULE_HOP").count(), 1, "{:#?}", b.diagnostics);
}

#[test]
fn a_write_rule_hop_rewrite_keeps_a_named_unique_key() {
    // 092: `staff[principal = viewer].role` was rewritten as `staff[id = viewer]`.
    let source = "table staff:\n  principal: principal\n  role: text\n  unique principal\n  read <- .principal = viewer\n  online only\ntable notes:\n  body: text\n  read <- allow\n  insert <- staff[principal = viewer].role = 'coordinator'\n  online only\n";
    let d = first(source, "E_QUARRY_RULE_HOP");
    assert!(d.rewrite.contains("staff[principal = viewer] ! else FORBIDDEN") && !d.rewrite.contains("id = viewer"), "{d}");
}

// ---- #9: N_SYNC_ORDER on a unique key, and direction as a product choice ----

#[test]
fn a_unique_order_key_reads_the_windows_index_and_a_direction_difference_is_by_design() {
    let table = "table weeks:\n  week: int\n  unique week\n  public 'weeks are public'\n  sync public last 100 by .week\n";
    let b = clean(&format!("{table}query recent(c: cursor ?):\n  return weeks last 100 by .week after c\n"));
    assert!(note(&b, "N_SYNC_ORDER").is_none(), "[week] and [week, id] are one order: {:#?}", b.notes);
    let b = clean(&format!("{table}query oldest(c: cursor ?):\n  return weeks first 100 by .week after c\n"));
    let n = note(&b, "N_SYNC_ORDER").unwrap();
    assert!(n.message.contains("only the direction differs, which is a product choice") && n.message.contains("no action"), "{n}");
}

// ---- #20: text patterns in `require` ----

#[test]
fn a_text_pattern_operator_is_named_instead_of_a_missing_refusal_code() {
    for condition in ["url like 'https://%'", "url starts 'https://'", "url contains 'x'", "url LIKE 'a%'"] {
        let source = format!("table links:\n  url: text <=200\n  public 'p'\n  online only\nmutation add(url: text <=200):\n  require {condition} else BAD_URL\n  return insert links {{ url }}\n");
        let d = first(&source, "E_QUARRY_SYNTAX");
        let word = condition.split(' ').nth(1).unwrap();
        assert!(d.message.contains(&format!("no `{word}` operator")) && !d.message.contains("refusal code"), "{d}");
        assert!(d.rewrite.contains("format url") && !d.rewrite.contains("NOT_ALLOWED"), "{d}");
    }
    // The form it points at compiles.
    clean("table links:\n  url: text <=200 format url\n  public 'p'\n  online only\nmutation add(url: text <=200 format url):\n  return insert links { url }\n");
}

// ---- #15: capacity over private rows: the count view and the author's own check ----

#[test]
fn a_private_capacity_check_prints_a_count_view_and_its_require_and_they_run() {
    let tables = "table slots:\n  seats: int\n  public 'slots are public'\n  online only\ntable bookings:\n  slot: slots\n  guest: principal\n  unique slot, guest\n  immutable slot, guest\n  read <- .guest = viewer\n  insert <- .guest = viewer\n  online only\n";
    let source = format!("{tables}mutation book(slot: slots):\n  s = slots[slot] ! else NOT_FOUND\n  require count(bookings where .slot = slot) < s.seats else SLOT_FULL\n  return insert bookings {{ slot, guest: viewer }}\n");
    let d = first(&source, "E_STRUCTURAL_FANOUT");
    let quoted: Vec<&str> = d.rewrite.split('`').skip(1).step_by(2).collect();
    let view = quoted.iter().find(|q| q.starts_with("view ")).unwrap_or_else(|| panic!("{d}"));
    let check = quoted.iter().find(|q| q.starts_with("require ")).unwrap_or_else(|| panic!("{d}"));
    assert_eq!(*view, "view bookingsCount: count bookings by .slot", "{d}");
    assert_eq!(*check, "require bookingsCount[slot] < s.seats else SLOT_FULL", "{d}");
    let repaired = format!("{tables}{view}\n  read <- allow\nmutation book(slot: slots):\n  s = slots[slot] ! else NOT_FOUND\n  {check}\n  return insert bookings {{ slot, guest: viewer }}\n");
    let mut engine = engine(&repaired, vec![("slots", vec![("id", id("sl1")), ("seats", Value::Int(2))])]);
    let book = |engine: &mut Engine, viewer: &str| match engine.mutate("book", None, Context::new(viewer, args(&[("slot", id("sl1"))]))).unwrap().state {
        WriteState::Sent { .. } => "ok".to_owned(), WriteState::Failed { why, .. } => why.code.clone() };
    assert_eq!(book(&mut engine, "ann"), "ok");
    assert_eq!(book(&mut engine, "bo"), "ok");
    // Neither earlier booking is readable by cy; the count still covers them.
    assert_eq!(book(&mut engine, "cy"), "SLOT_FULL");
}

// ---- #7: a full cap counts rows the caller cannot read and refuses E_CONSTRAINT ----

#[test]
fn a_full_cap_over_hidden_rows_refuses_e_constraint_as_the_testing_guide_says() {
    let source = "table bookings:\n  slot: text <=20\n  guest: principal\n  cap 2 by slot\n  read <- .guest = viewer\n  insert <- .guest = viewer\n  online only\nmutation book(slot: text <=20):\n  return insert bookings { slot, guest: viewer }\n";
    let mut engine = engine(source, vec![]);
    let book = |engine: &mut Engine, viewer: &str| match engine.mutate("book", None, Context::new(viewer, args(&[("slot", Value::String("a".into()))]))) {
        Ok(outcome) => match outcome.state { WriteState::Sent { .. } => "ok".to_owned(), WriteState::Failed { why, .. } => why.code.clone() },
        Err(error) => format!("{error:?}"),
    };
    assert_eq!(book(&mut engine, "ann"), "ok");
    assert_eq!(book(&mut engine, "bo"), "ok");
    assert!(book(&mut engine, "cy").contains("E_CONSTRAINT"), "{}", book(&mut engine, "cy"));
    let testing = snapback4_lang::guide::card("testing").unwrap();
    assert!(testing.contains("full `cap` counts every row, readable or not, and refuses `E_CONSTRAINT`"), "the guide says what the runtime does");
}
