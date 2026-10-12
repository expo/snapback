//! App-farm wave 7 (snapback4@0.4.22): rule-language and diagnostic friction
//! (LLP 3000.036 §17). Each test pins `check` against the engine on the
//! lanes' own shapes, or applies a printed rewrite and compiles and runs it.
//!
//! The farm sweeps read every `wave*/apps/*/snapback/*.q` under
//! `SNAPBACK4_FARM` (default `~/sb4-loop` when it exists) and pass trivially
//! without the farm; `--nocapture` prints each wave-7 note they find.
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

fn note<'a>(b: &'a Bound, code: &str) -> Option<&'a Diagnostic> {
    b.notes.iter().find(|n| n.code == code)
}

fn problem<'a>(b: &'a Bound, code: &str) -> Option<&'a Diagnostic> {
    b.diagnostics.iter().find(|n| n.code == code)
}

fn args(pairs: &[(&str, Value)]) -> BTreeMap<String, Value> {
    pairs.iter().map(|(k, v)| ((*k).to_owned(), v.clone())).collect()
}

type Rows = Vec<(&'static str, Vec<(&'static str, Value)>)>;

fn engine(source: &str, rows: Rows) -> Engine {
    let b = clean(source);
    let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed(rows.into_iter().map(|(table, fields)| (table.to_owned(), object(fields)))).unwrap_or_else(|e| panic!("{source}\n{e:?}"));
    engine
}

fn id(text: &str) -> Value { Value::Id(text.into()) }
fn text(value: &str) -> Value { Value::String(value.into()) }

/// `ok` for a committed mutation, else the refusal code.
fn mutate(engine: &mut Engine, op: &str, viewer: &str, pairs: &[(&str, Value)]) -> String {
    match engine.mutate(op, None, Context::new(viewer, args(pairs))) {
        Ok(outcome) => match outcome.state { WriteState::Sent { .. } => "ok".to_owned(), WriteState::Failed { why, .. } => why.code.clone() },
        Err(e) => format!("{e:?}"),
    }
}

/// `(complete, data)` for a query, or the refusal code.
fn query(engine: &mut Engine, op: &str, viewer: &str, pairs: &[(&str, Value)]) -> Result<(bool, Value), String> {
    engine.query(op, Context::new(viewer, args(pairs))).map(|outcome| (outcome.complete, outcome.data)).map_err(|error| error.code.clone())
}

/// Every farm schema directory, as `(label, sources)`.
fn farm() -> Vec<(String, Vec<(String, String)>)> {
    let root = std::env::var("SNAPBACK4_FARM").ok()
        .or_else(|| std::env::var("HOME").ok().map(|home| format!("{home}/sb4-loop")))
        .filter(|root| std::path::Path::new(root).is_dir());
    let Some(root) = root else { return Vec::new() };
    let mut apps = Vec::new();
    for wave in std::fs::read_dir(&root).unwrap().flatten() {
        if !wave.file_name().to_string_lossy().starts_with("wave") { continue; }
        let Ok(entries) = std::fs::read_dir(wave.path().join("apps")) else { continue };
        for app in entries.flatten() { apps.push(app.path().join("snapback")); }
    }
    apps.sort();
    apps.into_iter().filter_map(|dir| {
        let mut sources: Vec<(String, String)> = std::fs::read_dir(&dir).ok()?.flatten().filter(|e| e.path().extension().is_some_and(|x| x == "q"))
            .filter_map(|e| Some((e.file_name().to_string_lossy().into_owned(), std::fs::read_to_string(e.path()).ok()?))).collect();
        if sources.is_empty() { return None; }
        sources.sort();
        Some((dir.display().to_string(), sources))
    }).collect()
}

// ---- 17.1 (R1): a note never says its own lead-in twice ----

/// A phrase of three or more words said twice in a row ("the complete form
/// is the complete form is …"), lowercased, punctuation kept on the words.
fn repeated_phrase(text: &str) -> Option<String> {
    let words: Vec<String> = text.split_whitespace().map(str::to_lowercase).collect();
    for n in 3..=10 {
        for start in 0..words.len().saturating_sub(2 * n - 1) {
            if words[start..start + n] == words[start + n..start + 2 * n] {
                return Some(words[start..start + n].join(" "));
            }
        }
    }
    None
}

/// The verdict clause names the complete form once: the text after the last
/// "complete form" lead never holds another lead.
fn doubled_lead(text: &str) -> Option<String> {
    let leads = ["the complete form for everyone is", "the complete form is", "the closest form is", "there is no single complete form"];
    for clause in text.split(';') {
        let lower = clause.to_lowercase();
        let count: usize = leads.iter().map(|lead| lower.matches(lead).count()).sum();
        // "the complete form for everyone is" also contains no other lead; count each once.
        if count > 1 { return Some(clause.trim().to_owned()); }
    }
    None
}

fn assert_no_repeats(label: &str, diagnostics: &[Diagnostic]) {
    for d in diagnostics {
        for text in [&d.message, &d.rewrite] {
            assert_eq!(repeated_phrase(text), None, "{label}: {} repeats a phrase: {text}", d.code);
            assert_eq!(doubled_lead(text), None, "{label}: {} says its complete-form lead twice: {text}", d.code);
        }
    }
}

#[test]
fn r1_the_repeat_check_finds_the_0_4_22_phrase() {
    assert_eq!(repeated_phrase("the complete form for everyone is the complete form for everyone is one query per party").as_deref(), Some("the complete form for everyone is"));
    assert!(repeated_phrase("the complete form is the complete form is the pin").is_some());
    assert!(doubled_lead("expect capped; the complete form for everyone is there is no single complete form: keep the query").is_some());
    assert_eq!(repeated_phrase("the complete form for everyone is one query per party"), None);
}

/// The four verdict shapes 0.4.22 doubled: a printed form, no single form, a
/// closest form (parent-probe arm) and the plain pin.
#[test]
fn r1_every_complete_form_verdict_is_said_once() {
    let staff = "table staff:\n  principal: principal\n  unique principal\n  read <- .principal = viewer\n  online only\n";
    let shapes = [
        // a grant: the printed `if` form
        format!("{staff}table tickets:\n  owner: principal\n  at: time\n  immutable owner\n  read <- .owner = viewer or exists staff[viewer]\n  online only\nquery all():\n  return tickets first 50 by .at\n"),
        // two parties and a grant: one query per party
        format!("{staff}table notes:\n  author: principal\n  helper: principal\n  at: time\n  immutable author, helper\n  read <- .author = viewer or .helper = viewer or exists staff[viewer]\n  online only\nquery all():\n  return notes first 50 by .at\n"),
        // a pin only, no grant
        "table items:\n  owner: principal\n  at: time\n  immutable owner\n  read <- .owner = viewer\n  online only\nquery all():\n  return items first 50 by .at\n".to_owned(),
        // an `exists` over rows the caller partly reads
        format!("{staff}table tickets:\n  owner: principal\n  at: time\n  immutable owner\n  read <- .owner = viewer or exists staff[viewer]\n  online only\nquery any(t: time):\n  return exists tickets[at = t]\n"),
    ];
    for source in &shapes {
        let b = bound(source);
        let n = note(&b, "N_NEVER_COMPLETE").unwrap_or_else(|| panic!("{source}\n{:#?}", b.notes));
        assert_no_repeats(source, std::slice::from_ref(n));
        assert!(n.message.contains("the complete form") || n.message.contains("closest form") || n.message.contains("no single complete form"), "{n}");
    }
}

/// Every note and problem the farm's schemas produce (waves 1–7).
#[test]
fn r1_no_farm_diagnostic_repeats_a_phrase() {
    let mut checked = 0;
    for (label, sources) in farm() {
        let b = compile(&sources);
        assert_no_repeats(&label, &b.notes);
        assert_no_repeats(&label, &b.diagnostics);
        checked += b.notes.len() + b.diagnostics.len();
    }
    println!("checked {checked} farm diagnostics");
}

// ---- 17.2: the whole-table total's view rewrite compiles (lane 020) ----

/// The backticked pieces of a rewrite.
fn pieces(rewrite: &str) -> Vec<&str> {
    rewrite.split('`').skip(1).step_by(2).collect()
}

#[test]
fn a_whole_table_total_prints_a_grouped_view_that_compiles_and_counts_every_row() {
    // Lane 020: households read by their worker or a coordinator; the coverage total is ungrouped.
    let schema = |extra: &str| format!("table roles:\n  principal: principal\n  role: enum('worker', 'coordinator')\n  unique principal\n  read <- .principal = viewer\n  online only\ntable households:\n  worker: principal\n  members: int\n{extra}  read <- .worker = viewer or exists roles[viewer, role = 'coordinator']\n  insert <- .worker = viewer\n  online only\n");
    for (total, value) in [("count(households)", 3), ("sum(households, .members)", 9)] {
        let source = format!("{}query coverage():\n  return {total}\n", schema(""));
        let b = bound(&source);
        let d = problem(&b, "E_QUARRY_BOUND").unwrap_or_else(|| panic!("{source}\n{:#?}", b.diagnostics));
        let p = pieces(&d.rewrite);
        assert!(!p.iter().any(|piece| piece.ends_with("[]")), "no ungrouped lookup: {d}");
        let column = p.iter().find(|piece| piece.contains("enum('all')")).unwrap_or_else(|| panic!("{d}"));
        let immutable = p.iter().find(|piece| piece.starts_with("immutable ")).unwrap();
        let view = p.iter().find(|piece| piece.starts_with("view ")).unwrap();
        let read = p.iter().find(|piece| piece.starts_with("read <- ")).unwrap();
        let lookup = p.iter().find(|piece| piece.ends_with("['all']")).unwrap();
        assert_eq!(*read, "read <- exists roles[viewer, role = 'coordinator']", "{d}");
        let repaired = format!("{}{view}\n  {read}\nquery coverage():\n  return {lookup}\n", schema(&format!("  {column}\n  {immutable}\n")));
        let b = clean(&repaired);
        let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
        engine.seed([
            ("roles".to_owned(), object([("id", id("r1")), ("principal", id("cora")), ("role", text("coordinator"))])),
            ("households".to_owned(), object([("id", id("h1")), ("worker", id("wes")), ("members", Value::Int(2))])),
            ("households".to_owned(), object([("id", id("h2")), ("worker", id("wes")), ("members", Value::Int(3))])),
            ("households".to_owned(), object([("id", id("h3")), ("worker", id("wyn")), ("members", Value::Int(4))])),
        ]).unwrap_or_else(|e| panic!("{repaired}\n{e:?}"));
        let (_, data) = query(&mut engine, "coverage", "cora", &[]).unwrap();
        assert_eq!(data, Value::Int(value), "the coordinator reads the whole table's total:\n{repaired}");
        let worker = query(&mut engine, "coverage", "wes", &[]);
        assert!(worker.as_ref().map_or(true, |(_, data)| *data != Value::Int(value)), "a worker does not read the whole total: {worker:?}");
    }
}

// ---- 17.3: a page the server refuses for a private field is refused by `check` (lane 098) ----

const VISITS: &str = "table caseworkers:
  principal: principal
  unique principal
  read <- .principal = viewer or exists caseworkers[viewer]
  online only
table visits:
  child: text 1..80
  at: time
  fosterParent: principal
  caseworker: principal
  notes: text <=200 default '' written by .caseworker
  immutable fosterParent, caseworker
  read <- exists caseworkers[viewer] or .fosterParent = viewer
  insert <- exists caseworkers[viewer]
  cap 500 by fosterParent
  online only
";

fn visit_rows() -> Rows {
    vec![
        ("caseworkers", vec![("id", id("k1")), ("principal", id("cas"))]),
        ("visits", vec![("id", id("v1")), ("child", text("Ann")), ("at", Value::Int(1)), ("fosterParent", id("fay")), ("caseworker", id("cas")), ("notes", text("ok"))]),
        ("visits", vec![("id", id("v2")), ("child", text("Ben")), ("at", Value::Int(2)), ("fosterParent", id("gus")), ("caseworker", id("cas")), ("notes", text("ok"))]),
    ]
}

#[test]
fn a_scan_over_private_fields_the_read_rule_does_not_decide_is_refused_at_check_as_at_run_time() {
    let pages = [
        "query all(c: cursor ?):\n  if exists caseworkers[viewer]:\n    return visits last 50 by .at after c\n  return visits where .fosterParent = viewer last 50 by .at after c\n",
        "query mine():\n  require exists caseworkers[viewer] else NOT_STAFF\n  return visits where .caseworker = viewer first 50 by .at\n",
    ];
    for page in pages {
        let source = format!("{VISITS}{page}");
        let b = bound(&source);
        let d = problem(&b, "E_FIELD_AUTHORITY").unwrap_or_else(|| panic!("{source}\n{:#?}", b.diagnostics));
        assert!(d.message.contains("visits.notes (written by .caseworker) is private") && d.message.contains("scope this read to a uniformly readable audience"), "{d}");
        assert!(d.message.contains("role guard"), "the guard is named as not scoping it: {d}");
        assert!(d.rewrite.contains("visits where .fosterParent = viewer") && d.rewrite.contains("readable by audience"), "{d}");
        // The runtime agrees: the same program with the field readable by audience compiles and
        // reads; made private again in the bound schema (past the check), every caller is refused,
        // the guard's holder included.
        let open = source.replace("written by .caseworker", "written by .caseworker readable by audience");
        let name = page.strip_prefix("query ").unwrap().split('(').next().unwrap();
        let pairs: &[(&str, Value)] = if page.contains("cursor") { &[("c", Value::Null)] } else { &[] };
        assert!(query(&mut engine(&open, visit_rows()), name, "cas", pairs).is_ok(), "readable by audience scopes it");
        let mut b = clean(&open);
        b.schema.tables.get_mut("visits").unwrap().written_by.get_mut("notes").unwrap().audience = false;
        let mut private = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
        private.seed(visit_rows().into_iter().map(|(table, fields)| (table.to_owned(), object(fields)))).unwrap();
        assert_eq!(query(&mut private, name, "cas", pairs).err().as_deref(), Some("E_FIELD_AUTHORITY"), "the guard's holder reaches the scan and the server refuses it, as check did");
    }
}

#[test]
fn a_pinned_or_split_private_field_page_compiles_and_reads() {
    // The rewrite's pin: the foster parent's own page.
    let pinned = format!("{VISITS}query mine(c: cursor ?):\n  return visits where .fosterParent = viewer last 50 by .at after c\n");
    let mut e = engine(&pinned, visit_rows());
    let (complete, data) = query(&mut e, "mine", "fay", &[("c", Value::Null)]).unwrap();
    assert!(complete && data.as_array().unwrap().len() == 1, "{data:?}");
    // The rewrite's split: the notes in their own table, read by key; the staff page scans no private field.
    let split = VISITS.replace("  notes: text <=200 default '' written by .caseworker\n", "")
        + "table visitNotes:\n  visit: visits\n  caseworker: principal\n  notes: text <=200\n  unique visit\n  immutable visit, caseworker\n  read <- .caseworker = viewer\n  insert <- .caseworker = viewer\n  update <- .caseworker = viewer\n  online only\n"
        + "query all(c: cursor ?):\n  if exists caseworkers[viewer]:\n    return visits last 50 by .at after c\n  return visits where .fosterParent = viewer last 50 by .at after c\nquery note(v: visits):\n  return visitNotes[visit = v]\n";
    let rows = || -> Rows { visit_rows().into_iter().map(|(t, mut fields)| { fields.retain(|(k, _)| *k != "notes"); (t, fields) }).chain([("visitNotes", vec![("id", id("n1")), ("visit", id("v1")), ("caseworker", id("cas")), ("notes", text("ok"))])]).collect() };
    let mut e = engine(&split, rows());
    let (complete, data) = query(&mut e, "all", "cas", &[("c", Value::Null)]).unwrap();
    assert!(complete && data.as_array().unwrap().len() == 2, "staff read every visit: {data:?}");
    let (_, note) = query(&mut e, "note", "cas", &[("v", id("v1"))]).unwrap();
    assert_eq!(note.field("notes").ok(), Some(&text("ok")));
}

/// Every farm schema: the scans `check` now refuses (each would refuse at run time).
#[test]
fn farm_private_scans() {
    let mut hits = 0;
    for (label, sources) in farm() {
        let b = compile(&sources);
        for d in b.diagnostics.iter().filter(|d| d.code == "E_FIELD_AUTHORITY" && d.message.contains("scope this read")) {
            hits += 1;
            println!("{label}\n  {d}\n");
        }
    }
    println!("E_FIELD_AUTHORITY private scans: {hits}");
}
