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
