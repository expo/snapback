//! App-farm wave 5 (snapback4@0.4.20): rule-language and diagnostic friction
//! (LLP 3000.036 §15). Each test pins `check` against the engine on the
//! lanes' own shapes, or applies a printed rewrite and compiles and runs it.
use snapback4_core::{Context, Engine, Value, value::object};
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

#[allow(dead_code)]
fn first(source: &str, code: &str) -> Diagnostic {
    let b = bound(source);
    b.diagnostics.iter().find(|d| d.code == code && d.cascade_of.is_none()).unwrap_or_else(|| panic!("{code}: {:#?}", b.diagnostics)).clone()
}

#[allow(dead_code)]
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

// ---- #4: a projection shape must not change prefix coverage ----

/// Lane 100: `cap 500 by route` covers `walks where .route = route`; the same
/// read with a page shape `walkCard` refused "declare `cap N` on walks".
const WALKS: &str = "table routes:
  walker: principal
  read <- .walker = viewer
  online only
table walks:
  route: routes
  note: text <=500 ?
  status: enum('scheduled', 'done') default 'scheduled'
  cap 500 by route
  immutable route
  read <- exists routes[.route, walker = viewer]
  online only

shape walkCard = { id, note, route }
";

#[test]
fn a_page_shape_after_a_capped_prefix_keeps_the_cap() {
    for query in [
        "query q(route: routes):\n  return walks where .route = route walkCard\n",
        "query q(route: routes):\n  return walks where .status = 'done' and .route = route walkCard\n",
        "query q(route: routes):\n  return walks where .route = route and .status = 'done' walkCard\n",
    ] {
        let source = format!("{WALKS}{query}");
        let b = bound(&source);
        assert!(b.diagnostics.is_empty(), "the shape must not change coverage:\n{source}\n{:#?}", b.diagnostics);
        let mut engine = engine(&source, vec![
            ("routes", vec![("id", id("r1")), ("walker", id("wes"))]),
            ("walks", vec![("id", id("w1")), ("route", id("r1")), ("note", Value::String("ok".into())), ("status", Value::String("done".into()))]),
        ]);
        let outcome = engine.query("q", Context::new("wes", args(&[("route", id("r1"))]))).unwrap();
        let rows = outcome.data.as_array().unwrap();
        assert_eq!(rows.len(), 1, "{source}");
        let row = rows[0].as_object().unwrap();
        assert!(row.contains_key("note") && !row.contains_key("status"), "the shape applies to the page's rows: {row:?}");
    }
    // A row-dependent operand keeps its typed recognition in the binder.
    clean(&format!("{WALKS}query q(route: routes, c: cursor ?):\n  return walks where .route = route and .note = .note walkCard first 50 by .id after c\n"));
}

// ---- #3a: a grant inside `where` is a guard ----

/// Lanes 053 088 098: `tickets where exists staff[viewer] and .open = true`
/// printed N_NEVER_COMPLETE and a non-staff caller got `capped` (53 probes over
/// two rows) for a necessarily empty answer. The test reads no row, so it is
/// decided once, as `if exists staff[viewer]:` (which completeness follows).
const QUEUE: &str = "table staff:
  principal: principal
  unique principal
  read <- .principal = viewer
  online only
table tickets:
  owner: principal
  open: bool
  title: text <=80
  read <- .owner = viewer or exists staff[viewer]
  online only
";

fn queue_rows() -> Vec<(&'static str, Vec<(&'static str, Value)>)> {
    let ticket = |key: &'static str, owner: &str, open: bool| ("tickets", vec![("id", id(key)), ("owner", id(owner)), ("open", Value::Bool(open)), ("title", Value::String(key.into()))]);
    vec![("staff", vec![("id", id("s1")), ("principal", id("sue"))]), ticket("t1", "bob", true), ticket("t2", "bob", false), ticket("t3", "amy", true)]
}

#[test]
fn a_row_independent_test_in_where_is_a_guard_in_check_and_at_run_time() {
    let cases = [
        // (query, sue's rows, bob's rows): sue is staff, bob owns t1 and t2.
        ("query q(c: cursor ?):\n  return tickets where exists staff[viewer] and .open = true first 50 by .id after c\n", 2, 0),
        ("query q(c: cursor ?):\n  return tickets where .open = true and exists staff[viewer] first 50 by .id after c\n", 2, 0),
        ("query q(c: cursor ?):\n  return tickets where .owner = viewer or exists staff[viewer] first 50 by .id after c\n", 3, 2),
        ("query q(c: cursor ?):\n  return tickets where exists staff[viewer] first 50 by .id after c\n", 3, 0),
        // A bool argument is a guard too.
        ("query q(all: bool, c: cursor ?):\n  return tickets where all and exists staff[viewer] and .open = true first 50 by .id after c\n", 2, 0),
    ];
    for (query, staff, owner) in cases {
        let source = format!("{QUEUE}{query}");
        let b = clean(&source);
        assert!(note(&b, "N_NEVER_COMPLETE").is_none(), "the grant is decided once, as an if:\n{source}\n{:#?}", b.notes);
        let mut engine = engine(&source, queue_rows());
        for (viewer, rows) in [("sue", staff), ("bob", owner), ("amy", if owner == 0 { 0 } else { 1 })] {
            let mut pairs = vec![("c", Value::Null)];
            if query.contains("all: bool") { pairs.push(("all", Value::Bool(true))); }
            let outcome = engine.query("q", Context::new(viewer, args(&pairs))).unwrap();
            assert!(outcome.complete, "{viewer}: check printed no note, so the run is complete:\n{source}");
            assert_eq!(outcome.data.as_array().unwrap().len(), rows, "{viewer}:\n{source}");
            if rows == 0 { assert!(outcome.metered.examined <= 1 && outcome.metered.rule_probes <= 1, "{viewer}: one probe, no walk: {:?}", outcome.metered); }
        }
    }
    // A test that could refuse, evaluated per row before the grant, keeps the
    // scan's evaluation order: nothing moves, and the note stays accurate.
    let source = format!("{QUEUE}query q(c: cursor ?):\n  return tickets where length(.title) > 1 and exists staff[viewer] first 50 by .id after c\n");
    let b = bound(&source);
    assert!(b.diagnostics.is_empty(), "{:#?}", b.diagnostics);
    assert!(note(&b, "N_NEVER_COMPLETE").is_some(), "{:#?}", b.notes);
}

// ---- I5: no `$` internal in any problem or note ----

/// A `$` that starts a compiler name: not after a word or quote character (a
/// user's `'$5'` or `"$saved"`), and not a canonical identity (`$intent:…`,
/// which `check` labels and `--verbose` prints canonical on purpose).
fn internal(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    (0..bytes.len()).find_map(|at| {
        if bytes[at] != b'$' || (at > 0 && (bytes[at - 1].is_ascii_alphanumeric() || matches!(bytes[at - 1], b'_' | b'\'' | b'"'))) { return None; }
        let name: String = text[at + 1..].chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '_').collect();
        (name.starts_with(|c: char| c.is_ascii_alphabetic()) && !text[at + 1 + name.len()..].starts_with(':')).then(|| text[at.saturating_sub(40)..(at + 1 + name.len() + 20).min(text.len())].to_owned())
    })
}

fn sources(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if path.is_dir() && !matches!(name.as_str(), "target" | "node_modules" | ".git" | "generated") { sources(&path, out); }
        else if name.ends_with(".q") { out.push(path); }
    }
}

/// Lane 082's `read through .report` over a reassigned `assignedTo` printed
/// `$readThrough(report)` in a cascaded E_QUARRY_RULE_OPERATOR; a sweep of the
/// five farms' final schemas found captures (`.$plan.athlete`, `[$issueproject,
/// …]`) in notes too. Every `.q` in the repository (fixtures that fail on
/// purpose included), each alone and each `snapback/` directory together,
/// prints no `$` internal in a problem, a note or the prediction summary.
#[test]
fn no_problem_or_note_prints_a_dollar_internal() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let mut files = Vec::new();
    sources(&root, &mut files);
    files.sort();
    assert!(files.len() > 100, "the corpus is the repository's .q files: {}", files.len());
    let mut projects: Vec<Vec<std::path::PathBuf>> = files.iter().map(|file| vec![file.clone()]).collect();
    let mut dirs: BTreeMap<std::path::PathBuf, Vec<std::path::PathBuf>> = BTreeMap::new();
    for file in &files {
        if file.parent().is_some_and(|dir| dir.ends_with("snapback")) { dirs.entry(file.parent().unwrap().to_owned()).or_default().push(file.clone()); }
    }
    projects.extend(dirs.into_values().filter(|group| group.len() > 1));
    let mut leaks = Vec::new();
    for project in &projects {
        let inputs: Vec<(String, String)> = project.iter().map(|file| (file.file_name().unwrap().to_string_lossy().into_owned(), std::fs::read_to_string(file).unwrap())).collect();
        let b = compile(&inputs);
        let summary = snapback4_lang::bind::residency::prediction_summary(&b).map(|text| snapback4_lang::bind::spell_internals(&text));
        for (kind, text) in b.diagnostics.iter().map(|d| ("problem", format!("{} {}", d.message, d.rewrite)))
            .chain(b.notes.iter().map(|n| ("note", format!("{} {}", n.message, n.rewrite))))
            .chain(summary.map(|text| ("prediction", text))) {
            if let Some(context) = internal(&text) { leaks.push(format!("{} ({kind}): …{context}…", project[0].display())); }
        }
    }
    assert!(leaks.is_empty(), "{} leaks:\n{}", leaks.len(), leaks.join("\n"));
    // The lane's shape: the cascade is hidden beside its cause, and E_READ_THROUGH
    // offers the live-parent probe an online-only table accepts on a mutable column.
    let rescue = std::fs::read_to_string(root.join("crates/snapback4-lang/tests/fixtures/wave5-internals/rescue-calls.q")).unwrap();
    let b = bound(&rescue);
    let through = b.diagnostics.iter().find(|d| d.code == "E_READ_THROUGH").unwrap_or_else(|| panic!("{:#?}", b.diagnostics));
    assert!(through.rewrite.contains("read <- exists reports[.report, caller = viewer] or exists reports[.report, assignedTo = viewer] or exists roles[viewer, role = 'dispatcher']"), "{}", through.rewrite);
    assert!(b.diagnostics.iter().filter(|d| d.code != "E_READ_THROUGH").all(|d| d.cascade_of.is_some() && d.rewrite == "fix this Quarry line and rerun snapback4 check"), "{:#?}", b.diagnostics);
    let repaired = rescue.replace("  read through .report\n", "  read <- exists reports[.report, caller = viewer] or exists reports[.report, assignedTo = viewer] or exists roles[viewer, role = 'dispatcher']\n");
    clean(&repaired);
}

// ---- #13, #17, #5: keyed lookups, clause order, int ranges ----

const APPLICATIONS: &str = "table applications:
  owner: principal
  status: enum('draft', 'submitted')
  totalPoints: int
  read <- .owner = viewer
  online only
";

/// Lanes 017 039: an ordered test in brackets read as a key-type error, and a
/// job's failure cascaded into "schedule names no job". The refusal now says
/// what brackets take, and the printed search compiles.
#[test]
fn an_ordered_test_in_brackets_names_the_search_form_and_hides_the_schedule_cascade() {
    let probe = "exists applications[status = 'submitted', totalPoints > app.totalPoints]";
    let source = format!("{APPLICATIONS}query better(a: applications):\n  app = applications[a] ! else NOT_FOUND\n  return {probe}\n");
    let d = first(&source, "E_QUARRY_TYPE");
    assert!(d.message.starts_with("brackets take key equalities; `totalPoints > app.totalPoints` is an ordered test"), "{d:#?}");
    let search = "exists applications where .status = 'submitted' and .totalPoints > app.totalPoints";
    assert_eq!(d.rewrite, format!("for a search, write `{search}`"));
    // (A public table: over a per-row rule a query's search `exists` answers
    // unknown (null) unless decided, and a mutation's is E_STRUCTURAL_FANOUT.)
    let public = source.replace("  read <- .owner = viewer\n", "  public 'applications'\n");
    let mut engine = engine(&public.replace(probe, search), vec![
        ("applications", vec![("id", id("a1")), ("owner", id("amy")), ("status", Value::String("submitted".into())), ("totalPoints", Value::Int(5))]),
        ("applications", vec![("id", id("a2")), ("owner", id("amy")), ("status", Value::String("draft".into())), ("totalPoints", Value::Int(2))]),
    ]);
    assert_eq!(engine.query("better", Context::new("amy", args(&[("a", id("a2"))]))).unwrap().data, Value::Bool(true));
    assert_eq!(engine.query("better", Context::new("amy", args(&[("a", id("a1"))]))).unwrap().data, Value::Bool(false));
    // In a rule the probe names one row: the rewrite moves the order into the mutation.
    let rule = bound(&format!("{APPLICATIONS}table flags:\n  owner: principal\n  read <- exists applications[status = 'submitted', totalPoints > 3]\n  online only\n"));
    let d = rule.diagnostics.iter().find(|d| d.code == "E_QUARRY_TYPE").unwrap_or_else(|| panic!("{:#?}", rule.diagnostics));
    assert!(d.rewrite.contains("require exists applications where .status = 'submitted' and .totalPoints > 3 else CODE"), "{d:#?}");
    // A job that failed to bind: the schedule's complaint is that problem's hidden cascade.
    let job = bound(&format!("{APPLICATIONS}job sweep():\n  for row in applications:\n    if exists applications[status = 'submitted', totalPoints > row.totalPoints]:\n      update applications[row.id] {{ totalPoints: 0 }}\nschedule nightly every 1d: sweep\n"));
    let schedule = job.diagnostics.iter().find(|d| d.message.starts_with("schedule nightly")).unwrap_or_else(|| panic!("{:#?}", job.diagnostics));
    assert!(schedule.message.contains("which did not compile") && schedule.rewrite == "fix this Quarry line and rerun snapback4 check" && schedule.cascade_of.is_some(), "{schedule:#?}");
}

/// Lane 057: named equalities covering two unique keys were ambiguous although
/// either key names the same row; lane 020: `budgets['general']` matched the id
/// and the unique name, and the printed choice led with the id.
#[test]
fn named_keys_over_two_unique_keys_read_one_row_and_a_text_literal_leads_with_the_named_key() {
    let source = "table telescopes:\n  name: text 1..40\n  public 'scopes'\n  online only\ntable loans:\n  borrower: principal\n  telescope: telescopes\n  unique borrower\n  unique telescope\n  read <- .borrower = viewer\n  online only\n\
query has(telescope: telescopes):\n  return exists loans[borrower = viewer, telescope = telescope]\n\
query loan(telescope: telescopes):\n  return loans[telescope = telescope, borrower = viewer]\n";
    let mut engine = engine(source, vec![
        ("telescopes", vec![("id", id("t1")), ("name", Value::String("Dob".into()))]),
        ("telescopes", vec![("id", id("t2")), ("name", Value::String("Refractor".into()))]),
        ("loans", vec![("id", id("l1")), ("borrower", id("amy")), ("telescope", id("t1"))]),
        ("loans", vec![("id", id("l2")), ("borrower", id("bo")), ("telescope", id("t2"))]),
    ]);
    for (viewer, telescope, held) in [("amy", "t1", true), ("amy", "t2", false), ("bo", "t2", true), ("bo", "t1", false)] {
        assert_eq!(engine.query("has", Context::new(viewer, args(&[("telescope", id(telescope))]))).unwrap().data, Value::Bool(held), "{viewer} {telescope}");
        assert_eq!(engine.query("loan", Context::new(viewer, args(&[("telescope", id(telescope))]))).unwrap().data != Value::Null, held, "{viewer} {telescope}");
    }
    let d = first("table budgets:\n  name: text 1..40\n  amount: int\n  unique name\n  public 'budgets'\n  online only\nquery general():\n  return budgets['general']\n", "E_QUARRY_POSITIONAL_SCAN");
    assert!(d.message.ends_with("choose a named form: budgets[name = 'general'] or budgets[id = 'general']"), "{d:#?}");
    assert_eq!(d.rewrite, "budgets[name = 'general']");
}

/// Lane 034: a view with `where` after `by` reported two E_QUARRY_MAINTAIN
/// causes; the fault is the clause order, and the reordered view compiles.
#[test]
fn a_view_with_where_after_by_names_the_clause_order() {
    let table = "table items:\n  owner: principal\n  minutes: int\n  verified: bool\n  read <- .owner = viewer\n  online only\n";
    for (view, fixed) in [
        ("view v: sum items of .minutes by .owner where .verified = true\n", "view v: sum items of .minutes where .verified = true by .owner"),
        ("view w: count items by .owner, .verified where .minutes > 3\n", "view w: count items where .minutes > 3 by .owner, .verified"),
    ] {
        let source = format!("{table}{view}");
        let b = bound(&source);
        assert_eq!(b.diagnostics.len(), 1, "{:#?}", b.diagnostics);
        assert!(b.diagnostics[0].message.starts_with("a view's where comes before its group keys"), "{:#?}", b.diagnostics);
        assert_eq!(b.diagnostics[0].rewrite, fixed);
        clean(&format!("{table}{fixed}\n"));
    }
}

/// Wave 5 #5 (11 lanes): `int 1..N` failed "expected the end of the line, got 1".
/// The targeted refusal prints the require (and rule) forms, which compile.
#[test]
fn an_int_range_names_the_require_and_rule_forms() {
    let d = first("mutation add(k: int 1..7200):\n  return k\n", "E_QUARRY_SYNTAX");
    assert!(d.message.starts_with("int takes no range in its type"), "{d:#?}");
    assert_eq!(d.rewrite, "declare `k: int` and refuse other values first in the body: `require k >= 1 and k <= 7200 else OUT_OF_RANGE`");
    clean("mutation add(k: int):\n  require k >= 1 and k <= 7200 else OUT_OF_RANGE\n  return k\n");
    let d = first("table items:\n  owner: principal\n  n: int 1..10\n  read <- .owner = viewer\n  online only\n", "E_QUARRY_SYNTAX");
    assert!(d.rewrite.contains("insert <- … and .n >= 1 and .n <= 10") && d.rewrite.contains("update (old, next) <- … and next.n >= 1 and next.n <= 10"), "{d:#?}");
    let source = "table items:\n  owner: principal\n  n: int\n  read <- .owner = viewer\n  insert <- .owner = viewer and .n >= 1 and .n <= 10\n  update (old, next) <- next.owner = viewer and next.n >= 1 and next.n <= 10\n  online only\n\
mutation add(n: int):\n  require n >= 1 and n <= 10 else OUT_OF_RANGE\n  return insert items { owner: viewer, n }\n";
    let mut engine = engine(source, vec![]);
    let sent = |engine: &mut Engine, n: i64| matches!(engine.mutate("add", None, Context::new("amy", args(&[("n", Value::Int(n))]))).map(|o| o.state), Ok(snapback4_core::WriteState::Sent { .. }));
    assert!(sent(&mut engine, 4) && !sent(&mut engine, 11) && !sent(&mut engine, 0));
    let d = first("table items:\n  m: int <=5 ?\n  public 'x'\n  online only\n", "E_QUARRY_SYNTAX");
    assert!(d.rewrite.starts_with("declare `m: int ?`") && d.rewrite.contains("(.m = null or .m <= 5)"), "{d:#?}");
}
