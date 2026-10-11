//! App-farm wave 6 (snapback4@0.4.21): rule-language and diagnostic friction
//! (LLP 3000.036 §16). Each test pins `check` against the engine on the
//! lanes' own shapes, or applies a printed rewrite and compiles and runs it.
use snapback4_core::{Context, Engine, Value, value::object};
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

/// `(complete, row ids)` for a query.
fn page(engine: &mut Engine, query: &str, viewer: &str, pairs: &[(&str, Value)]) -> (bool, BTreeSet<String>) {
    let outcome = engine.query(query, Context::new(viewer, args(pairs))).unwrap_or_else(|e| panic!("{query} as {viewer}: {e:?}"));
    let ids = outcome.data.as_array().map(|rows| rows.iter().filter_map(|row| match row.field("id") { Ok(Value::Id(id)) => Some(id.clone()), _ => None }).collect()).unwrap_or_default();
    (outcome.complete, ids)
}

/// The compiled form leading a note's rewrite: the code between its lead line and "Otherwise".
fn printed_form(n: &Diagnostic) -> String {
    let head = n.rewrite.split("\n\nOtherwise:").next().unwrap();
    let (lead, code) = head.split_once(":\n").unwrap_or_else(|| panic!("no code: {n}"));
    assert!(!lead.contains('\n'), "{n}");
    code.to_owned()
}

/// Each query the printed form declares, by name.
fn query_names(code: &str) -> Vec<String> {
    code.lines().filter_map(|line| line.strip_prefix("query ")).map(|rest| rest.split('(').next().unwrap().to_owned()).collect()
}

// ---- R1: the owner-or-staff rewrite keeps every disjunct of the read rule ----

/// Applies the printed form in place of `query`, then, for every viewer,
/// requires the union of the printed queries' rows to equal the original
/// query's rows. Returns the completeness each viewer saw on the printed form.
fn rewrite_admits_the_same_readers(schema: &str, query: &str, rows: impl Fn() -> Rows, viewers: &[&str], pairs: &[(&str, Value)]) -> BTreeMap<String, bool> {
    let original = format!("{schema}{query}");
    let b = bound(&original);
    let n = note(&b, "N_NEVER_COMPLETE").unwrap_or_else(|| panic!("{original}\n{:#?}", b.notes)).clone();
    let code = printed_form(&n);
    let repaired = format!("{schema}{code}\n");
    let name = query.strip_prefix("query ").unwrap().split('(').next().unwrap();
    let mut before = engine(&original, rows());
    let mut after = engine(&repaired, rows());
    let mut complete = BTreeMap::new();
    for viewer in viewers {
        let (_, expected) = page(&mut before, name, viewer, pairs);
        let mut union = BTreeSet::new();
        let mut all = true;
        for query in query_names(&code) {
            let (done, ids) = page(&mut after, &query, viewer, pairs);
            union.extend(ids);
            all &= done;
        }
        assert_eq!(union, expected, "{viewer}: the printed form must admit exactly the read rule's rows\n{code}");
        complete.insert((*viewer).to_owned(), all);
    }
    complete
}

/// Lane 029: reporter, the cat's owner (a parent hop) and moderators.
const SIGHTINGS: &str = "table moderators:
  principal: principal
  unique principal
  read <- .principal = viewer
  online only
table cats:
  owner: principal
  name: text 1..40
  immutable owner
  read <- allow
  online only
table sightings:
  cat: cats
  reporter: principal
  seenAt: time
  immutable cat, reporter
  read <- .reporter = viewer or .cat.owner = viewer or exists moderators[principal = viewer]
  insert <- .reporter = viewer
  cap 500 by cat
  online only
";

fn sightings_rows() -> Rows {
    let at = Value::Int;
    vec![
        ("moderators", vec![("id", id("m1")), ("principal", id("mo"))]),
        ("cats", vec![("id", id("tom")), ("owner", id("olive")), ("name", Value::String("Tom".into()))]),
        ("sightings", vec![("id", id("s1")), ("cat", id("tom")), ("reporter", id("rae")), ("seenAt", at(1))]),
        ("sightings", vec![("id", id("s2")), ("cat", id("tom")), ("reporter", id("sid")), ("seenAt", at(2))]),
        ("sightings", vec![("id", id("s3")), ("cat", id("tom")), ("reporter", id("olive")), ("seenAt", at(3))]),
    ]
}

#[test]
fn r1_a_parent_owner_party_keeps_its_arm_and_the_rewrite_admits_the_same_readers() {
    let query = "query sightingsFor(cat: cats, c: cursor ?):\n  return sightings where .cat = cat last 50 by .seenAt after c\n";
    let n = note(&bound(&format!("{SIGHTINGS}{query}")), "N_NEVER_COMPLETE").unwrap().clone();
    assert!(n.rewrite.contains("if exists cats[cat, owner = viewer]:"), "the owner's arm is printed: {n}");
    assert!(!n.rewrite.contains("both pages are complete") && n.rewrite.contains("stays `complete: false`"), "the owner's arm is not claimed complete: {n}");
    let complete = rewrite_admits_the_same_readers(SIGHTINGS, query, sightings_rows, &["mo", "olive", "rae", "sid", "zed"], &[("cat", id("tom")), ("c", Value::Null)]);
    assert!(complete["mo"] && complete["rae"] && complete["zed"], "grant and party pages are complete: {complete:?}");
    assert!(!complete["olive"], "the parent-probe arm stays capped, as the note says: {complete:?}");
}

/// Lane 068: sitter, the sitting's keeper (a parent hop) and coordinators
/// whose own table is readable by holders.
const OFFERS: &str = "table coordinators:
  principal: principal
  unique principal
  read <- .principal = viewer or exists coordinators[viewer]
  online only
table sittings:
  keeper: principal
  at: time
  immutable keeper
  public 'anyone may browse sitting requests'
  online only
table offers:
  sitting: sittings
  sitter: principal
  at: time
  immutable sitting, sitter
  read <- .sitter = viewer or .sitting.keeper = viewer or exists coordinators[viewer]
  insert <- .sitter = viewer
  online only
";

#[test]
fn r1_the_keeper_of_a_sitting_keeps_every_offer_under_the_printed_form() {
    let query = "query offersFor(sitting: sittings, c: cursor ?):\n  return offers where .sitting = sitting last 50 by .at after c\n";
    let rows = || -> Rows {
        vec![
            ("coordinators", vec![("id", id("c1")), ("principal", id("carol"))]),
            ("sittings", vec![("id", id("st")), ("keeper", id("alice")), ("at", Value::Int(1))]),
            ("offers", vec![("id", id("o1")), ("sitting", id("st")), ("sitter", id("bob")), ("at", Value::Int(1))]),
            ("offers", vec![("id", id("o2")), ("sitting", id("st")), ("sitter", id("dan")), ("at", Value::Int(2))]),
        ]
    };
    let complete = rewrite_admits_the_same_readers(OFFERS, query, rows, &["carol", "alice", "bob", "dan", "zed"], &[("sitting", id("st")), ("c", Value::Null)]);
    assert!(complete["carol"] && complete["bob"] && !complete["alice"], "{complete:?}");
}

/// Lane 087: two parties (holder via the credential, scanner on the row) and
/// a manager grant; and the two-column form with both parties on the row.
const CHECKINS: &str = "table roles:
  principal: principal
  unique principal
  read <- .principal = viewer
  online only
table credentials:
  holder: principal
  immutable holder
  read <- .holder = viewer or exists roles[viewer]
  online only
";

fn checkin_rows(holder_column: bool) -> Rows {
    let row = |id_: &str, scanner: &str| {
        let mut fields = vec![("id", id(id_)), ("credential", id("cr")), ("scanner", id(scanner)), ("at", Value::Int(1))];
        if holder_column { fields.push(("holder", id("hal"))); }
        ("checkins", fields)
    };
    vec![
        ("roles", vec![("id", id("r1")), ("principal", id("mgr"))]),
        ("credentials", vec![("id", id("cr")), ("holder", id("hal"))]),
        row("k1", "sam"),
        row("k2", "sue"),
    ]
}

#[test]
fn r1_two_parties_and_a_grant_print_one_query_per_party_each_with_the_grant() {
    // The holder through the credential (a parent hop), the scanner on the row, and the grant.
    let hop = format!("{CHECKINS}table checkins:\n  credential: credentials\n  scanner: principal\n  at: time\n  immutable credential, scanner\n  read <- .scanner = viewer or .credential.holder = viewer or exists roles[viewer]\n  online only\n");
    let query = "query checkinsFor(credential: credentials, c: cursor ?):\n  return checkins where .credential = credential last 50 by .at after c\n";
    let complete = rewrite_admits_the_same_readers(&hop, query, || checkin_rows(false), &["mgr", "hal", "sam", "zed"], &[("credential", id("cr")), ("c", Value::Null)]);
    assert!(complete["mgr"] && complete["sam"] && !complete["hal"], "{complete:?}");
    // Both parties on the row and the grant: 0.4.21 split per party and dropped the grant.
    let row = format!("{CHECKINS}table checkins:\n  credential: credentials\n  holder: principal\n  scanner: principal\n  at: time\n  immutable credential, holder, scanner\n  read <- .holder = viewer or .scanner = viewer or exists roles[viewer]\n  online only\n");
    let all = "query allCheckins(c: cursor ?):\n  return checkins last 50 by .at after c\n";
    let n = note(&bound(&format!("{row}{all}")), "N_NEVER_COMPLETE").unwrap().clone();
    assert_eq!(query_names(&printed_form(&n)), ["allCheckinsAsHolder", "allCheckinsAsScanner"], "{n}");
    let complete = rewrite_admits_the_same_readers(&row, all, || checkin_rows(true), &["mgr", "hal", "sam", "zed"], &[("c", Value::Null)]);
    assert!(complete.values().all(|done| *done), "every printed page is complete: {complete:?}");
}

#[test]
fn r1_a_rule_with_a_party_no_pin_can_select_prints_no_form_and_says_so() {
    // `.cat.owner` pinned by nothing (the page reads every cat): no branch can
    // test it, so the honest fallback replaces the code.
    let query = "query everything(c: cursor ?):\n  return sightings last 50 by .seenAt after c\n";
    let n = note(&bound(&format!("{SIGHTINGS}{query}")), "N_NEVER_COMPLETE").unwrap().clone();
    assert!(!n.rewrite.contains("query everything"), "no code is printed: {n}");
    assert!(n.rewrite.contains("there is no single complete form") && n.message.contains("there is no single complete form: keep the query and expect `capped`"), "{n}");
    // The two-disjunct shapes 0.4.21 printed correctly still print the same code.
    let owner = "table staff:\n  principal: principal\n  unique principal\n  read <- .principal = viewer\n  online only\ntable reqs:\n  author: principal\n  at: time\n  read <- .author = viewer or exists staff[viewer]\n  online only\nquery q(c: cursor ?):\n  return reqs last 50 by .at after c\n";
    let n = note(&bound(owner), "N_NEVER_COMPLETE").unwrap().clone();
    assert_eq!(printed_form(&n), "query q(c: cursor ?):\n  if exists staff[viewer]:\n    return reqs last 50 by .at after c\n  return reqs where .author = viewer last 50 by .at after c", "{n}");
    assert!(n.rewrite.starts_with("Branch on the grant and pin `.author` for everyone else; together they return exactly the rows the read rule admits, and every page is complete:"), "{n}");
}
