//! App-farm wave 6 (snapback4@0.4.21): rule-language and diagnostic friction
//! (LLP 3000.036 §16). Each test pins `check` against the engine on the
//! lanes' own shapes, or applies a printed rewrite and compiles and runs it.
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

fn notes<'a>(b: &'a Bound, code: &str) -> Vec<&'a Diagnostic> {
    b.notes.iter().filter(|n| n.code == code).collect()
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

// ---- R2: N_DELETE_ORPHANS honours the zero-count guard, and the guard compiles ----

fn mutate(engine: &mut Engine, op: &str, viewer: &str, pairs: &[(&str, Value)]) -> String {
    match engine.mutate(op, None, Context::new(viewer, args(pairs))) {
        Ok(outcome) => match outcome.state { WriteState::Sent { .. } => "ok".to_owned(), WriteState::Failed { why, .. } => why.code.clone() },
        Err(e) => format!("{e:?}"),
    }
}

/// Lane 095: `require rsvpCount[night] = 0` before `delete nights[night]`.
const NIGHTS: &str = "table nights:
  host: principal
  immutable host
  read <- allow
  delete <- .host = viewer
  online only
table rsvps:
  night: nights
  guest: principal
  unique night, guest
  immutable night, guest
  read <- .guest = viewer
  insert <- .guest = viewer
  online only
view rsvpCount: count rsvps by .night
  read <- allow
mutation rsvp(night: nights):
  return insert rsvps { night, guest: viewer }
";

#[test]
fn r2_a_zero_count_guard_on_the_deleted_row_silences_n_delete_orphans() {
    let guarded = format!("{NIGHTS}mutation cancelNight(night: nights):\n  n = nights[night] ! else NOT_FOUND\n  require n.host = viewer else NOT_HOST\n  require rsvpCount[night] = 0 else HAS_RSVPS\n  delete nights[night]\n");
    let b = clean(&guarded);
    assert!(note(&b, "N_DELETE_ORPHANS").is_none(), "{:#?}", b.notes);
    // Without the guard the note stays, and names the guard that silences it.
    let bare = format!("{NIGHTS}mutation cancelNight(night: nights):\n  delete nights[night]\n");
    let b = clean(&bare);
    let n = note(&b, "N_DELETE_ORPHANS").unwrap_or_else(|| panic!("{:#?}", b.notes));
    assert!(n.rewrite.contains("`view rsvpsByNight: count rsvps by .night`") && n.rewrite.contains("`require rsvpsByNight[<the deleted id>] = 0 else HAS_RSVPS`") && n.rewrite.contains("also silences this note"), "{n}");
    // A filtered count proves nothing about the other children: the note stays.
    let filtered = NIGHTS.replace("view rsvpCount: count rsvps by .night", "view rsvpCount: count rsvps where .guest != 'x' by .night");
    let b = clean(&format!("{filtered}mutation cancelNight(night: nights):\n  require rsvpCount[night] = 0 else HAS_RSVPS\n  delete nights[night]\n"));
    assert!(note(&b, "N_DELETE_ORPHANS").is_some(), "{:#?}", b.notes);
    // The guard runs: a guest's hidden RSVP blocks the host's delete.
    let mut engine = engine(&guarded, vec![("nights", vec![("id", id("n1")), ("host", id("hana"))]), ("nights", vec![("id", id("n2")), ("host", id("hana"))])]);
    assert_eq!(mutate(&mut engine, "rsvp", "gus", &[("night", id("n1"))]), "ok");
    assert_eq!(mutate(&mut engine, "cancelNight", "hana", &[("night", id("n1"))]), "HAS_RSVPS");
    assert_eq!(mutate(&mut engine, "cancelNight", "hana", &[("night", id("n2"))]), "ok");
}

#[test]
fn r2_a_not_exists_guard_over_private_children_prints_the_zero_count_and_it_runs() {
    let tables = "table cats:\n  owner: principal\n  immutable owner\n  read <- allow\n  delete <- .owner = viewer\n  online only\ntable sightings:\n  cat: cats\n  reporter: principal\n  immutable cat, reporter\n  read <- .reporter = viewer\n  insert <- .reporter = viewer\n  cap 500 by cat\n  online only\nmutation report(cat: cats):\n  return insert sightings { cat, reporter: viewer }\n";
    let natural = format!("{tables}mutation removeCat(cat: cats):\n  c = cats[cat] ! else NOT_FOUND\n  require c.owner = viewer else NOT_OWNER\n  require not exists sightings[cat = cat] else HAS_SIGHTINGS\n  delete cats[cat]\n");
    let b = bound(&natural);
    let d = b.diagnostics.iter().find(|d| d.code == "E_STRUCTURAL_FANOUT").unwrap_or_else(|| panic!("{:#?}", b.diagnostics)).clone();
    let quoted: Vec<&str> = d.rewrite.split('`').skip(1).step_by(2).collect();
    assert!(d.rewrite.starts_with("an absence check"), "the zero count leads: {d}");
    let view = quoted.iter().find(|q| q.starts_with("view ")).unwrap_or_else(|| panic!("{d}"));
    let check = quoted.iter().find(|q| q.starts_with("require ")).unwrap_or_else(|| panic!("{d}"));
    assert_eq!((*view, *check), ("view sightingsCount: count sightings by .cat", "require sightingsCount[cat] = 0 else HAS_SIGHTINGS"), "{d}");
    let repaired = format!("{tables}{view}\n  read <- allow\nmutation removeCat(cat: cats):\n  c = cats[cat] ! else NOT_FOUND\n  require c.owner = viewer else NOT_OWNER\n  {check}\n  delete cats[cat]\n");
    let b = clean(&repaired);
    assert!(note(&b, "N_DELETE_ORPHANS").is_none(), "the applied rewrite also silences the orphans note: {:#?}", b.notes);
    let mut engine = engine(&repaired, vec![("cats", vec![("id", id("tom")), ("owner", id("olive"))]), ("cats", vec![("id", id("kit")), ("owner", id("olive"))])]);
    assert_eq!(mutate(&mut engine, "report", "rae", &[("cat", id("tom"))]), "ok");
    assert_eq!(mutate(&mut engine, "removeCat", "olive", &[("cat", id("tom"))]), "HAS_SIGHTINGS", "rae's sighting is hidden from olive and still counts");
    assert_eq!(mutate(&mut engine, "removeCat", "olive", &[("cat", id("kit"))]), "ok");
}

// ---- #1c: a branch on a pin-decided parent probe is not a page guard; check says so ----

#[test]
fn a_parent_probe_guard_beside_a_grant_is_named_unfollowed_and_the_runtime_agrees() {
    // Lane 088: staff, the garden's owner (a parent hop) and the visitor, with
    // the owner's arm written as an `if` on the identical keyed probe.
    let schema = "table staff:\n  principal: principal\n  unique principal\n  read <- .principal = viewer\n  online only\ntable gardens:\n  owner: principal\n  immutable owner\n  read <- allow\n  online only\ntable checkins:\n  garden: gardens\n  visitor: principal\n  at: time\n  immutable garden, visitor\n  read <- .visitor = viewer or .garden.owner = viewer or exists staff[viewer]\n  online only\n";
    let query = "query gardenVisits(garden: gardens, c: cursor ?):\n  if exists staff[viewer]:\n    return checkins where .garden = garden first 50 by .at after c\n  if exists gardens[garden, owner = viewer]:\n    return checkins where .garden = garden first 50 by .at after c\n  return checkins where .garden = garden and .visitor = viewer first 50 by .at after c\n";
    let source = format!("{schema}{query}");
    let b = clean(&source);
    let found = notes(&b, "N_NEVER_COMPLETE");
    assert_eq!(found.len(), 1, "only the owner's arm: {found:#?}");
    let n = found[0];
    assert!(n.message.contains("`exists gardens[.garden, owner = viewer]` is decided by the scan's pins") && n.message.contains("whatever `require` or `if` guards it"), "beside a grant too: {n}");
    assert!(n.rewrite.contains("copy the deciding principal onto checkins"), "the complete repair is printed: {n}");
    let rows = || -> Rows {
        vec![
            ("staff", vec![("id", id("st1")), ("principal", id("sam"))]),
            ("gardens", vec![("id", id("g1")), ("owner", id("gwen"))]),
            ("checkins", vec![("id", id("k1")), ("garden", id("g1")), ("visitor", id("vic")), ("at", Value::Int(1))]),
            ("checkins", vec![("id", id("k2")), ("garden", id("g1")), ("visitor", id("val")), ("at", Value::Int(2))]),
        ]
    };
    let mut engine = engine(&source, rows());
    let pairs = [("garden", id("g1")), ("c", Value::Null)];
    assert_eq!(page(&mut engine, "gardenVisits", "sam", &pairs).0, true, "the grant decides the staff page");
    let (complete, ids) = page(&mut engine, "gardenVisits", "gwen", &pairs);
    assert_eq!((complete, ids.len()), (false, 2), "the owner reads every row, capped, as the note says");
    assert_eq!(page(&mut engine, "gardenVisits", "vic", &pairs), (true, BTreeSet::from(["k1".to_owned()])));
}

// ---- #22: authorization lints, each on its lane's shape and its near misses ----

#[test]
fn n_probe_only_read_names_a_probe_that_names_no_caller_and_the_rewrite_closes_it() {
    // Lane 073: Bob read Alice's review because the probe only asked whether the application exists.
    let apps = "table applications:\n  applicant: principal\n  immutable applicant\n  read <- .applicant = viewer\n  online only\n";
    let reviews = |rule: &str| format!("{apps}table reviews:\n  application: applications\n  body: text <=200\n  immutable application\n  {rule}\n  online only\nquery reviewsOf(application: applications):\n  return reviews where .application = application first 20 by .id\n");
    let open = reviews("read <- exists applications[.application]");
    let b = clean(&open);
    let n = note(&b, "N_PROBE_ONLY_READ").unwrap_or_else(|| panic!("{:#?}", b.notes)).clone();
    assert!(n.rewrite.contains("`read through .application`") && n.rewrite.contains("`exists applications[.application, applicant = viewer]`"), "{n}");
    let rows = || -> Rows { vec![("applications", vec![("id", id("a1")), ("applicant", id("alice"))]), ("reviews", vec![("id", id("r1")), ("application", id("a1")), ("body", Value::String("ok".into()))])] };
    let mut engine_open = engine(&open, rows());
    assert_eq!(page(&mut engine_open, "reviewsOf", "bob", &[("application", id("a1"))]).1.len(), 1, "the note's claim: bob reads alice's review");
    let closed = reviews("read through .application");
    let b = clean(&closed);
    assert!(note(&b, "N_PROBE_ONLY_READ").is_none(), "{:#?}", b.notes);
    let mut engine_closed = engine(&closed, rows());
    assert_eq!(page(&mut engine_closed, "reviewsOf", "bob", &[("application", id("a1"))]).1.len(), 0);
    assert_eq!(page(&mut engine_closed, "reviewsOf", "alice", &[("application", id("a1"))]).1.len(), 1);
    // Near misses: a probe naming the caller, and one whose own test makes the parent public.
    assert!(note(&clean(&reviews("read <- exists applications[.application, applicant = viewer]")), "N_PROBE_ONLY_READ").is_none());
    let decks = "table decks:\n  owner: principal\n  isPublic: bool\n  read <- .owner = viewer or .isPublic = true\n  online only\ntable cards:\n  deck: decks\n  read <- exists decks[.deck, owner = viewer] or exists decks[.deck, isPublic = true]\n  online only\n";
    assert!(note(&clean(decks), "N_PROBE_ONLY_READ").is_none());
}

#[test]
fn n_vacuous_rule_names_a_self_asserted_counterpart_and_not_an_owners_own_row() {
    // Lane 061: any persona could schedule a session as "therapist" and then write the client's notes.
    let tables = |insert: &str| format!("table therapists:\n  principal: principal\n  unique principal\n  read <- .principal = viewer\n  online only\ntable sessions:\n  therapist: principal\n  client: principal\n  immutable therapist, client\n  read <- .therapist = viewer or .client = viewer\n  {insert}\n  online only\ntable notes:\n  session: sessions\n  body: text <=200\n  immutable session\n  read <- .session.therapist = viewer or .session.client = viewer\n  insert <- .session.therapist = viewer\n  online only\nmutation scheduleSession(client: principal):\n  return insert sessions {{ therapist: viewer, client }}\n");
    let open = tables("insert <- .therapist = viewer");
    let b = clean(&open);
    let n = note(&b, "N_VACUOUS_RULE").unwrap_or_else(|| panic!("{:#?}", b.notes)).clone();
    assert!(n.message.contains("notes trusts `.session.therapist = viewer`") && n.rewrite.contains("`insert <- .therapist = viewer and exists <roles>[viewer]`"), "{n}");
    let mut engine_open = engine(&open, vec![]);
    assert_eq!(mutate(&mut engine_open, "scheduleSession", "carol", &[("client", id("bob"))]), "ok", "the note's claim: an outsider schedules");
    let closed = tables("insert <- .therapist = viewer and exists therapists[viewer]");
    assert!(note(&clean(&closed), "N_VACUOUS_RULE").is_none());
    // A row naming only its writer (the todo shape) and a consent row (a patient naming a doctor) are never noted.
    let todo = "table todos:\n  owner: principal\n  title: text <=80\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  online only\nmutation add(title: text <=80):\n  return insert todos { owner: viewer, title }\n";
    assert!(note(&clean(todo), "N_VACUOUS_RULE").is_none());
    let consent = "table careLinks:\n  patient: principal\n  doctor: principal\n  read <- .patient = viewer or .doctor = viewer\n  insert <- .patient = viewer\n  online only\ntable results:\n  patient: principal\n  read <- .patient = viewer or exists careLinks[patient = .patient, doctor = viewer]\n  online only\nmutation grantAccess(doctor: principal):\n  return insert careLinks { patient: viewer, doctor }\n";
    let b = bound(consent);
    assert!(note(&b, "N_VACUOUS_RULE").is_none(), "{:#?}", b.notes);
}

#[test]
fn n_lookup_hidden_names_a_write_role_the_read_rule_never_uses_and_the_runtime_agrees() {
    // Lane 001: vetted drivers pass the update rule but cannot find a requested ride.
    let rides = |read: &str| format!("table drivers:\n  principal: principal\n  vetted: bool\n  unique principal\n  read <- .principal = viewer\n  online only\ntable rides:\n  patient: principal\n  driver: principal ?\n  status: enum('requested', 'accepted') default 'requested'\n  immutable patient\n  read <- {read}\n  insert <- .patient = viewer\n  update <- .patient = viewer or .driver = viewer or exists drivers[viewer, vetted = true]\n  online only\nmutation acceptRide(ride: rides):\n  r = rides[ride] ! else NOT_FOUND\n  require r.status = 'requested' else ALREADY_TAKEN\n  update rides[ride] {{ driver: viewer, status: 'accepted' }}\n");
    let hidden = rides(".patient = viewer or .driver = viewer");
    let b = clean(&hidden);
    let n = note(&b, "N_LOOKUP_HIDDEN").unwrap_or_else(|| panic!("{:#?}", b.notes)).clone();
    assert!(n.message.contains("`exists drivers[viewer, vetted = true]`") && n.rewrite.contains("read <- .patient = viewer or .driver = viewer or exists drivers[viewer, vetted = true]"), "{n}");
    let rows = || -> Rows { vec![("drivers", vec![("id", id("d1")), ("principal", id("dee")), ("vetted", Value::Bool(true))]), ("rides", vec![("id", id("x1")), ("patient", id("pat")), ("driver", Value::Null), ("status", Value::String("requested".into()))])] };
    let mut before = engine(&hidden, rows());
    assert_eq!(mutate(&mut before, "acceptRide", "dee", &[("ride", id("x1"))]), "NOT_FOUND", "the runtime agrees with the note");
    let fixed = rides(".patient = viewer or .driver = viewer or .status = 'requested' and exists drivers[viewer, vetted = true]");
    let b = clean(&fixed);
    assert!(note(&b, "N_LOOKUP_HIDDEN").is_none(), "{:#?}", b.notes);
    let mut after = engine(&fixed, rows());
    assert_eq!(mutate(&mut after, "acceptRide", "dee", &[("ride", id("x1"))]), "ok");
    // A party the app keeps a reader by invariant (a facilitator who is a member) is not named.
    let member = "table members:\n  group: text <=20\n  principal: principal\n  unique group, principal\n  read <- .principal = viewer\n  online only\ntable posts:\n  group: text <=20\n  facilitator: principal\n  read <- exists members[.group, viewer]\n  update <- .facilitator = viewer\n  online only\nmutation pin(post: posts):\n  update posts[post] { group: 'g' }\n";
    assert!(note(&clean(member), "N_LOOKUP_HIDDEN").is_none());
}

#[test]
fn n_write_denied_names_a_counter_only_a_role_may_update_in_a_mutation_for_everyone() {
    // Lane 062: growers donate seeds; the stock counter's table admits only staff.
    let library = |guard: &str| format!("table roles:\n  principal: principal\n  unique principal\n  read <- .principal = viewer\n  online only\ntable varieties:\n  stock: int\n  read <- allow\n  update <- exists roles[viewer]\n  online only\ntable donations:\n  variety: varieties\n  grower: principal\n  packets: int\n  read <- .grower = viewer\n  insert <- .grower = viewer\n  online only\nmutation donate(variety: varieties, packets: int):\n{guard}  v = varieties[variety] ! else NOT_FOUND\n  insert donations {{ variety, grower: viewer, packets }}\n  update varieties[variety] {{ stock: v.stock + packets }}\n");
    let open = library("");
    let b = clean(&open);
    let n = b.notes.iter().find(|n| n.code == "N_WRITE_DENIED").unwrap_or_else(|| panic!("{:#?}", b.notes)).clone();
    assert!(n.message.contains("`stock` is a counter") && n.rewrite.starts_with("keep the count from the rows the callers write instead"), "{n}");
    let mut engine_open = engine(&open, vec![("varieties", vec![("id", id("v1")), ("stock", Value::Int(0))])]);
    assert_eq!(mutate(&mut engine_open, "donate", "gil", &[("variety", id("v1")), ("packets", Value::Int(3))]), "E_RULE", "the runtime agrees");
    // The maintained form: no counter column, a sum view over the donations.
    let maintained = "table roles:\n  principal: principal\n  unique principal\n  read <- .principal = viewer\n  online only\ntable varieties:\n  name: text <=40\n  read <- allow\n  online only\ntable donations:\n  variety: varieties\n  grower: principal\n  packets: int\n  read <- .grower = viewer\n  insert <- .grower = viewer\n  online only\nview donated: sum donations of .packets by .variety\n  read <- allow\nmutation donate(variety: varieties, packets: int):\n  v = varieties[variety] ! else NOT_FOUND\n  insert donations { variety, grower: viewer, packets }\n";
    let b = clean(maintained);
    assert!(!b.notes.iter().any(|n| n.code == "N_WRITE_DENIED"), "{:#?}", b.notes);
    let mut engine_view = engine(maintained, vec![("varieties", vec![("id", id("v1")), ("name", Value::String("bean".into()))])]);
    assert_eq!(mutate(&mut engine_view, "donate", "gil", &[("variety", id("v1")), ("packets", Value::Int(3))]), "ok");
    // A staff-guarded counter is not noted.
    let guarded = library("  require exists roles[viewer] else NOT_STAFF\n");
    assert!(!clean(&guarded).notes.iter().any(|n| n.code == "N_WRITE_DENIED"));
}

// ---- The farm sweep (opt-in): every farm schema through the wave-6 lints ----

/// `SNAPBACK4_FARM=~/sb4-loop cargo test -p snapback4-lang --test wave6_rule_language farm -- --ignored --nocapture`
/// compiles every `wave*/apps/*/snapback/*.q` and prints each wave-6 note.
#[test]
#[ignore]
fn farm_sweep_prints_every_wave6_note() {
    let Ok(root) = std::env::var("SNAPBACK4_FARM") else { return };
    let mut apps = Vec::new();
    for wave in std::fs::read_dir(&root).unwrap().flatten() {
        let apps_dir = wave.path().join("apps");
        let Ok(entries) = std::fs::read_dir(&apps_dir) else { continue };
        for app in entries.flatten() { apps.push(app.path().join("snapback")); }
    }
    apps.sort();
    let codes = ["N_PROBE_ONLY_READ", "N_VACUOUS_RULE", "N_LOOKUP_HIDDEN", "N_WRITE_DENIED"];
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    for dir in apps {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        let mut sources: Vec<(String, String)> = entries.flatten().filter(|e| e.path().extension().is_some_and(|x| x == "q"))
            .map(|e| (e.file_name().to_string_lossy().into_owned(), std::fs::read_to_string(e.path()).unwrap())).collect();
        if sources.is_empty() { continue; }
        sources.sort();
        let b = compile(&sources);
        *counts.entry("apps".into()).or_default() += 1;
        for n in &b.notes {
            if n.code == "N_NEVER_COMPLETE" {
                let kind = if n.rewrite.contains("there is no single complete form") { "never-complete: no form" } else if n.rewrite.contains("return exactly the rows") || n.rewrite.starts_with("Replace this query") { "never-complete: form" } else { "never-complete: pin only" };
                *counts.entry(kind.into()).or_default() += 1;
                if let Some(why) = n.rewrite.split("there is no single complete form: ").nth(1) { println!("NOFORM {}", why.split("; keep the query").next().unwrap()); }
            }
            if !codes.contains(&n.code.as_str()) { continue; }
            *counts.entry(n.code.clone()).or_default() += 1;
            println!("{} {}\n  {}\n  -> {}\n", dir.display(), n.code, n.message, n.rewrite);
        }
    }
    println!("{counts:#?}");
}
