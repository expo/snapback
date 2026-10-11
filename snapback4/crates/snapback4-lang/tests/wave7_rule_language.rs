//! App-farm wave 7 (snapback4@0.4.22): rule-language and diagnostic friction
//! (LLP 3000.036 §17). Each test pins `check` against the engine on the
//! lanes' own shapes, or applies a printed rewrite and compiles and runs it.
//!
//! The farm sweeps read every `wave*/apps/*/snapback/*.q` under
//! `SNAPBACK4_FARM` (default `~/sb4-loop` when it exists) and pass trivially
//! without the farm; `--nocapture` prints each wave-7 note they find.
use snapback4_core::{Context, Engine, Value, WriteState, value::object};
use snapback4_lang::{Bound, Diagnostic, compile};
use std::collections::{BTreeMap, BTreeSet};

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
