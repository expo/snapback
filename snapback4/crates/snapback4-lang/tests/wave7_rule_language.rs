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

// ---- 17.4: N_DELETE_ORPHANS accepts guards that prove no children, and says why a sum does not ----

/// Lane 021: a sale is only inserted by the mutation that flips the work to `sold`.
const GALLERY: &str = "table artworks:
  artist: principal
  status: enum('available', 'sold') default 'available'
  immutable artist
  read <- allow
  update <- allow
  delete <- .artist = viewer
  online only
table sales:
  artwork: artworks
  buyer: text 1..80
  immutable artwork
  unique artwork
  read <- allow
  insert <- allow
  online only
mutation consign():
  return insert artworks { artist: viewer }
mutation withdraw(artwork: artworks):
  a = artworks[artwork] ! else NOT_FOUND
  require a.status = 'available' else ALREADY_SOLD
  delete artworks[artwork]
";

const RECORD_SALE: &str = "mutation recordSale(artwork: artworks, buyer: text 1..80):
  a = artworks[artwork] ! else NOT_FOUND
  require a.status = 'available' else ALREADY_SOLD
  update artworks[artwork] { status: 'sold' }
  return insert sales { artwork, buyer }
";

#[test]
fn a_status_guard_every_child_insert_flips_away_from_silences_n_delete_orphans_and_holds_at_run_time() {
    let source = format!("{GALLERY}{RECORD_SALE}");
    assert!(note(&clean(&source), "N_DELETE_ORPHANS").is_none(), "{:#?}", bound(&source).notes);
    // At run time: a sold work cannot be withdrawn, so no sale is orphaned.
    let mut e = engine(&source, vec![("artworks", vec![("id", id("w1")), ("artist", id("ari"))])]);
    assert_eq!(mutate(&mut e, "recordSale", "sam", &[("artwork", id("w1")), ("buyer", text("Bo"))]), "ok");
    assert_eq!(mutate(&mut e, "withdraw", "ari", &[("artwork", id("w1"))]), "ALREADY_SOLD");
    // Any program that breaks the invariant keeps the note.
    let unsound = [
        // the status can return to `available`
        format!("{GALLERY}{RECORD_SALE}mutation relist(artwork: artworks):\n  update artworks[artwork] {{ status: 'available' }}\n"),
        // to a status chosen by the caller
        format!("{GALLERY}{RECORD_SALE}mutation restatus(artwork: artworks, s: enum('available', 'sold')):\n  update artworks[artwork] {{ status: s }}\n"),
        // a sale inserted without the flip
        format!("{GALLERY}mutation recordSale(artwork: artworks, buyer: text 1..80):\n  return insert sales {{ artwork, buyer }}\n"),
        // the flip after the insert
        format!("{GALLERY}mutation recordSale(artwork: artworks, buyer: text 1..80):\n  s = insert sales {{ artwork, buyer }}\n  update artworks[artwork] {{ status: 'sold' }}\n  return s\n"),
        // the flip in a branch, the insert outside it
        format!("{GALLERY}mutation recordSale(artwork: artworks, buyer: text 1..80, flip: bool):\n  if flip:\n    update artworks[artwork] {{ status: 'sold' }}\n  return insert sales {{ artwork, buyer }}\n"),
        // the flip on another work
        format!("{GALLERY}mutation recordSale(artwork: artworks, other: artworks, buyer: text 1..80):\n  update artworks[other] {{ status: 'sold' }}\n  return insert sales {{ artwork, buyer }}\n"),
    ];
    for source in &unsound {
        assert!(note(&bound(source), "N_DELETE_ORPHANS").is_some(), "{source}\n{:#?}", bound(source).diagnostics);
    }
    // The second shape at run time: without the flip, a withdrawn work orphans its sale.
    let mut e = engine(&unsound[2], vec![("artworks", vec![("id", id("w1")), ("artist", id("ari"))])]);
    assert_eq!(mutate(&mut e, "recordSale", "sam", &[("artwork", id("w1")), ("buyer", text("Bo"))]), "ok");
    assert_eq!(mutate(&mut e, "withdraw", "ari", &[("artwork", id("w1"))]), "ok", "the guard proved nothing here, as the note says");
}

/// Lanes 024 034: `require occupied[shelter] = 0` over `sum reservations of .beds`.
fn shelter(insert_rule: &str, immutable: &str, extra: &str) -> String {
    format!("table shelters:
  operator: principal
  immutable operator
  read <- allow
  delete <- .operator = viewer
  online only
table reservations:
  shelter: shelters
  caseworker: principal
  beds: int
  immutable shelter, caseworker{immutable}
  read <- .caseworker = viewer
  insert <- {insert_rule}
  online only
view occupied: sum reservations of .beds by .shelter
  read <- allow
mutation reserve(shelter: shelters, beds: int):
  return insert reservations {{ shelter, caseworker: viewer, beds }}
mutation removeShelter(shelter: shelters):
  require occupied[shelter] = 0 else HAS_RESERVATIONS
  delete shelters[shelter]
{extra}")
}

#[test]
fn a_sum_guard_proves_no_children_only_over_a_count_like_column() {
    // The lanes' shape: the note stays and says why, with the count view.
    let lanes = shelter(".caseworker = viewer", "", "");
    let b = bound(&lanes);
    let n = note(&b, "N_DELETE_ORPHANS").unwrap_or_else(|| panic!("{:#?}", b.notes));
    assert!(n.message.contains("the `occupied` guard does not prove there are none") && n.message.contains("view reservationsByShelter: count reservations by .shelter"), "{n}");
    // Why: a zero-bed reservation sums to 0, and the delete orphans it.
    let mut e = engine(&lanes, vec![("shelters", vec![("id", id("s1")), ("operator", id("op"))])]);
    assert_eq!(mutate(&mut e, "reserve", "cw", &[("shelter", id("s1")), ("beds", Value::Int(0))]), "ok");
    assert_eq!(mutate(&mut e, "removeShelter", "op", &[("shelter", id("s1"))]), "ok", "sum 0 with a row");
    // Count-like: every insert branch requires beds ≥ 1 and beds is immutable; silent, and it holds.
    let counted = shelter(".caseworker = viewer and .beds >= 1", ", beds", "");
    assert!(note(&clean(&counted), "N_DELETE_ORPHANS").is_none(), "{:#?}", bound(&counted).notes);
    let mut e = engine(&counted, vec![("shelters", vec![("id", id("s1")), ("operator", id("op"))])]);
    assert!(mutate(&mut e, "reserve", "cw", &[("shelter", id("s1")), ("beds", Value::Int(0))]) != "ok");
    assert_eq!(mutate(&mut e, "reserve", "cw", &[("shelter", id("s1")), ("beds", Value::Int(1))]), "ok");
    assert_eq!(mutate(&mut e, "removeShelter", "op", &[("shelter", id("s1"))]), "HAS_RESERVATIONS");
    // Near misses keep the note: a mutable column, an `or` branch without the bound, a job (the
    // system, which no rule binds) writing the table.
    for source in [
        shelter(".caseworker = viewer and .beds >= 1", "", ""),
        shelter("(.caseworker = viewer and .beds >= 1) or .caseworker = viewer", ", beds", ""),
        shelter(".caseworker = viewer and .beds >= 0", ", beds", ""),
        shelter(".caseworker = viewer and .beds >= 1", ", beds", "job zero():\n  for s in shelters:\n    insert reservations { shelter: s.id, caseworker: s.operator, beds: 0 }\n"),
    ] {
        assert!(note(&bound(&source), "N_DELETE_ORPHANS").is_some(), "{source}");
    }
}

// ---- 17.5: a `require` the table's own rules decide against (lanes 001 072) ----

/// Lane 001: a pcp names a specialist; the roster's read rule shows each clinician only their own row.
fn clinic(read: &str) -> String {
    format!("table clinicians:
  principal: principal
  role: enum('pcp', 'specialist')
  unique principal
  read <- {read}
  online only
table referrals:
  pcp: principal
  specialist: principal
  immutable pcp, specialist
  read <- .pcp = viewer or .specialist = viewer
  insert <- .pcp = viewer
  online only
mutation refer(specialist: principal):
  require exists clinicians[principal = viewer, role = 'pcp'] else NOT_PCP
  require exists clinicians[principal = specialist, role = 'specialist'] else UNKNOWN_SPECIALIST
  return insert referrals {{ pcp: viewer, specialist }}
")
}

fn clinic_rows() -> Rows {
    vec![
        ("clinicians", vec![("id", id("c1")), ("principal", id("pam")), ("role", text("pcp"))]),
        ("clinicians", vec![("id", id("c2")), ("principal", id("sol")), ("role", text("specialist"))]),
    ]
}

#[test]
fn n_require_hidden_names_a_require_exists_over_a_row_its_read_rule_hides_and_the_runtime_agrees() {
    let lane = clinic(".principal = viewer");
    let b = clean(&lane);
    let hidden: Vec<&Diagnostic> = b.notes.iter().filter(|n| n.code == "N_REQUIRE_HIDDEN").collect();
    assert_eq!(hidden.len(), 1, "only the specialist probe; the caller's own `principal = viewer` probe is readable: {hidden:#?}");
    let n = hidden[0];
    assert!(n.message.contains("passes only when `specialist` is the caller") && n.message.contains("UNKNOWN_SPECIALIST"), "{n}");
    // The runtime: sol's row exists, but pam cannot read it.
    let mut e = engine(&lane, clinic_rows());
    assert_eq!(mutate(&mut e, "refer", "pam", &[("specialist", id("sol"))]), "UNKNOWN_SPECIALIST");
    // The rewrite: roster members read the roster. Silent, and the referral goes through.
    let read = n.rewrite.split('`').nth(1).unwrap().strip_prefix("read <- ").unwrap();
    let repaired = clinic(read);
    assert!(note(&clean(&repaired), "N_REQUIRE_HIDDEN").is_none(), "{read}");
    let mut e = engine(&repaired, clinic_rows());
    assert_eq!(mutate(&mut e, "refer", "pam", &[("specialist", id("sol"))]), "ok");
    // Near misses: a roster readable by a grant, or a probe of the caller's own row, say nothing.
    for read in [".principal = viewer or exists clinicians[viewer]", "allow"] {
        assert!(note(&bound(&clinic(read)), "N_REQUIRE_HIDDEN").is_none(), "{read}");
    }
}

/// Lane 072: the captain, an admin or the member leaving may remove a member.
fn teams(delete: &str) -> String {
    format!("table admins:
  principal: principal
  unique principal
  read <- .principal = viewer
  online only
table teams:
  captain: principal
  immutable captain
  read <- allow
  insert <- .captain = viewer
  online only
table memberships:
  team: teams
  member: principal
  unique team, member
  immutable team, member
  read <- allow
  insert <- exists teams[.team, captain = viewer] or .member = viewer
  delete <- {delete}
  online only
mutation removeMember(team: teams, person: principal):
  t = teams[team] ! else NOT_FOUND
  require t.captain = viewer or exists admins[viewer] or person = viewer else NOT_CAPTAIN
  if exists memberships[team, person]:
    delete memberships[team, person]
  return null
")
}

fn team_rows() -> Rows {
    vec![
        ("teams", vec![("id", id("t1")), ("captain", id("cap"))]),
        ("memberships", vec![("id", id("m1")), ("team", id("t1")), ("member", id("mel"))]),
        ("memberships", vec![("id", id("m2")), ("team", id("t1")), ("member", id("max"))]),
    ]
}

#[test]
fn n_require_refused_names_a_require_branch_the_delete_rule_refuses_and_the_runtime_agrees() {
    let lane = teams("exists teams[.team, captain = viewer] or exists admins[viewer]");
    let b = clean(&lane);
    let refused: Vec<&Diagnostic> = b.notes.iter().filter(|n| n.code == "N_REQUIRE_REFUSED").collect();
    assert_eq!(refused.len(), 1, "{refused:#?}");
    let n = refused[0];
    assert!(n.message.contains("`.member = viewer`") && n.message.contains("NOT_CAPTAIN") && !n.message.contains("captain = viewer`"), "only the member's branch: {n}");
    // The runtime: the member leaving passes the require and is refused E_RULE; the captain is not.
    let mut e = engine(&lane, team_rows());
    assert_eq!(mutate(&mut e, "removeMember", "mel", &[("team", id("t1")), ("person", id("mel"))]), "E_RULE");
    assert_eq!(mutate(&mut e, "removeMember", "cap", &[("team", id("t1")), ("person", id("max"))]), "ok");
    // The rewrite: add the party to the delete rule. Silent, and the member leaves.
    let delete = n.rewrite.split('`').nth(1).unwrap().strip_prefix("delete <- ").unwrap();
    let repaired = teams(delete);
    assert!(note(&clean(&repaired), "N_REQUIRE_REFUSED").is_none(), "{delete}");
    let mut e = engine(&repaired, team_rows());
    assert_eq!(mutate(&mut e, "removeMember", "mel", &[("team", id("t1")), ("person", id("mel"))]), "ok");
    // The hop spelling of the captain is the same test as the probe.
    assert!(note(&clean(&teams("teams[.team].captain = viewer or exists admins[viewer] or .member = viewer")), "N_REQUIRE_REFUSED").is_none());
}

/// Every farm schema: the two lints' hits (the final schemas: none expected).
#[test]
fn farm_require_lints() {
    let mut hits = BTreeMap::<String, usize>::new();
    for (label, sources) in farm() {
        for n in compile(&sources).notes.iter().filter(|n| n.code == "N_REQUIRE_HIDDEN" || n.code == "N_REQUIRE_REFUSED") {
            *hits.entry(n.code.clone()).or_default() += 1;
            println!("{label}\n  {n}\n");
        }
    }
    println!("{hits:?}");
}

// ---- 17.6: every E_QUARRY_RULE_HOP site in one run (lane 062) ----

#[test]
fn every_rule_hop_site_is_reported_in_one_check() {
    let schema = "table events:
  organizer: principal
  host: principal
  immutable organizer, host
  read <- allow
  online only
table tiers:
  event: events
  immutable event
  read <- allow
  online only
table sponsorships:
  tier: tiers
  sponsor: principal
  immutable tier, sponsor
  read <- .sponsor = viewer or exists events[.tier.event, organizer = viewer] or .tier.event.host = viewer
  insert <- .sponsor = viewer
  online only
table fulfillments:
  sponsorship: sponsorships
  note: text 1..80
  immutable sponsorship
  read <- exists events[id = .sponsorship.tier.event, organizer = viewer]
  online only
table perks:
  sponsorship: sponsorships
  immutable sponsorship
  read through .sponsorship
  online only
";
    let b = bound(schema);
    let hops: Vec<&Diagnostic> = b.diagnostics.iter().filter(|d| d.code == "E_QUARRY_RULE_HOP" && d.cascade_of.is_none()).collect();
    // One problem per rule: sponsorships' names its second hop, and the table reading through it.
    assert_eq!(hops.len(), 2, "{:#?}", b.diagnostics);
    let sponsorships = hops.iter().find(|d| d.site.line == 16).unwrap();
    assert!(sponsorships.message.contains("hops at 1 more site too: schema.q:16:") && sponsorships.message.contains("(`.tier.event.host = viewer`)"), "{sponsorships}");
    assert!(sponsorships.message.contains("perks reads through sponsorships"), "{sponsorships}");
    assert!(hops.iter().any(|d| d.site.line == 23), "the other table's hop in the same run: {hops:#?}");
    // Each site listed is a site the rule refuses alone: removing the first hop leaves the second as the problem.
    let fixed = schema.replace("exists events[.tier.event, organizer = viewer] or ", "");
    let again = bound(&fixed);
    let hop = again.diagnostics.iter().find(|d| d.code == "E_QUARRY_RULE_HOP" && d.site.line == 16).unwrap_or_else(|| panic!("{:#?}", again.diagnostics));
    assert!(!hop.message.contains("more site"), "{hop}");
}

// ---- 17.8: a total behind its grant's guard (lanes 003 008 020 074) ----

const HOUSEHOLDS: &str = "table roles:
  principal: principal
  role: enum('worker', 'coordinator', 'supervisor')
  unique principal
  read <- .principal = viewer
  online only
table households:
  worker: principal
  visited: bool default false
  read <- .worker = viewer or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'supervisor']
  insert <- .worker = viewer
  online only
";

fn household_rows() -> Rows {
    vec![
        ("roles", vec![("id", id("r1")), ("principal", id("cora")), ("role", text("coordinator"))]),
        ("roles", vec![("id", id("r2")), ("principal", id("sue")), ("role", text("supervisor"))]),
        ("roles", vec![("id", id("r3")), ("principal", id("wes")), ("role", text("worker"))]),
        ("households", vec![("id", id("h1")), ("worker", id("wes")), ("visited", Value::Bool(true))]),
        ("households", vec![("id", id("h2")), ("worker", id("wes"))]),
        ("households", vec![("id", id("h3")), ("worker", id("wyn")), ("visited", Value::Bool(true))]),
    ]
}

#[test]
fn a_total_behind_its_grants_guard_compiles_and_the_server_counts_every_row_for_the_holder() {
    let guarded = [
        // lane 020's own guard: the read rule's two grants
        "query coverage():\n  require exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'supervisor'] else MANAGER_ONLY\n  return { total: count(households), visited: count(households where .visited = true) }\n",
        // one of them
        "query coverage():\n  require exists roles[viewer, role = 'coordinator'] else MANAGER_ONLY\n  return { total: count(households), visited: count(households where .visited = true) }\n",
        // an `if` on the grant
        "query coverage():\n  if exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'supervisor']:\n    return { total: count(households), visited: count(households where .visited = true) }\n  return { total: 0, visited: 0 }\n",
    ];
    for query_text in guarded {
        let source = format!("{HOUSEHOLDS}{query_text}");
        let mut e = engine(&source, household_rows());
        let (complete, data) = query(&mut e, "coverage", "cora", &[]).unwrap();
        assert!(complete, "{query_text}");
        assert_eq!((data.field("total").ok(), data.field("visited").ok()), (Some(&Value::Int(3)), Some(&Value::Int(2))), "the coordinator's total is every row: {query_text}");
        // The worker never reaches the total; they read their own rows elsewhere.
        match query(&mut e, "coverage", "wes", &[]) {
            Ok((_, data)) => assert_eq!(data.field("total").ok(), Some(&Value::Int(0)), "the else branch: {query_text}"),
            Err(code) => assert_eq!(code, "MANAGER_ONLY"),
        }
    }
    // The supervisor holds the other grant: whole total under the `or` guard.
    let mut e = engine(&format!("{HOUSEHOLDS}{}", guarded[0]), household_rows());
    assert_eq!(query(&mut e, "coverage", "sue", &[]).unwrap().1.field("total").ok(), Some(&Value::Int(3)));
    // Unguarded, guarded by a role the read rule does not grant, or guarded only on one branch: still refused.
    for query_text in [
        "query coverage():\n  return count(households)\n",
        "query coverage():\n  require exists roles[viewer, role = 'worker'] else WORKER_ONLY\n  return count(households)\n",
        "query coverage(all: bool):\n  if all:\n    require exists roles[viewer, role = 'coordinator'] else MANAGER_ONLY\n  return count(households)\n",
    ] {
        let b = bound(&format!("{HOUSEHOLDS}{query_text}"));
        let d = problem(&b, "E_QUARRY_BOUND").unwrap_or_else(|| panic!("{query_text}\n{:#?}", b.diagnostics));
        assert!(d.rewrite.contains("or guard it with the grant"), "{d}");
    }
}

// ---- 17.9: an omitted optional argument clears a patched column (lanes 047 090) ----

const REQUESTS: &str = "table requests:
  owner: principal
  title: text 1..80
  details: text <=500 ?
  immutable owner
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  online only
query one(r: requests):
  return requests[r]
";

#[test]
fn n_patch_clears_names_an_edit_that_an_omitted_argument_clears_and_the_rewrite_keeps_it() {
    let edit = "mutation editRequest(request: requests, title: text 1..80, details: text <=500 ?):\n  r = requests[request] ! else NOT_FOUND\n  update requests[request] { title, details }\n";
    let source = format!("{REQUESTS}{edit}");
    let b = clean(&source);
    let n = note(&b, "N_PATCH_CLEARS").unwrap_or_else(|| panic!("{:#?}", b.notes));
    assert!(n.message.contains("`details`") && n.rewrite.contains("details: details ?? r.details"), "{n}");
    let rows = || -> Rows { vec![("requests", vec![("id", id("q1")), ("owner", id("ann")), ("title", text("Ride")), ("details", text("Tue 9am"))])] };
    // The runtime: omitted and explicit null are the same argument, and both clear the column.
    for pairs in [vec![("request", id("q1")), ("title", text("Ride!"))], vec![("request", id("q1")), ("title", text("Ride!")), ("details", Value::Null)]] {
        let mut e = engine(&source, rows());
        assert_eq!(mutate(&mut e, "editRequest", "ann", &pairs), "ok");
        assert_eq!(query(&mut e, "one", "ann", &[("r", id("q1"))]).unwrap().1.field("details").ok(), Some(&Value::Null), "{pairs:?}");
    }
    // The rewrite keeps it; the clear flag still clears.
    let kept = format!("{REQUESTS}mutation editRequest(request: requests, title: text 1..80, details: text <=500 ?, clear: bool ?):\n  r = requests[request] ! else NOT_FOUND\n  update requests[request] {{ title, details: null if clear = true else details ?? r.details }}\n");
    assert!(note(&clean(&kept), "N_PATCH_CLEARS").is_none());
    let mut e = engine(&kept, rows());
    assert_eq!(mutate(&mut e, "editRequest", "ann", &[("request", id("q1")), ("title", text("Ride!"))]), "ok");
    assert_eq!(query(&mut e, "one", "ann", &[("r", id("q1"))]).unwrap().1.field("details").ok(), Some(&text("Tue 9am")));
    assert_eq!(mutate(&mut e, "editRequest", "ann", &[("request", id("q1")), ("title", text("Ride!")), ("clear", Value::Bool(true))]), "ok");
    assert_eq!(query(&mut e, "one", "ann", &[("r", id("q1"))]).unwrap().1.field("details").ok(), Some(&Value::Null));
    // Near misses: a one-field setter, an argument the mutation tests.
    for near in [
        "mutation setDetails(request: requests, details: text <=500 ?):\n  update requests[request] { details }\n",
        "mutation editRequest(request: requests, title: text 1..80, details: text <=500 ?):\n  if details != null:\n    update requests[request] { title, details }\n",
    ] {
        assert!(note(&clean(&format!("{REQUESTS}{near}")), "N_PATCH_CLEARS").is_none(), "{near}");
    }
}

/// Every farm schema's N_PATCH_CLEARS (counted in §17.9).
#[test]
fn farm_patch_clears() {
    let mut hits = 0;
    for (label, sources) in farm() {
        for n in compile(&sources).notes.iter().filter(|n| n.code == "N_PATCH_CLEARS") { hits += 1; println!("{label}: {}", n.message); }
    }
    println!("N_PATCH_CLEARS: {hits}");
}
