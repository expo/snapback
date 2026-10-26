//! DX14 replay reductions: 005E/021R hidden rosters, 003R/041R broad roles,
//! 007R/034R denied writes, 032E/050R bracket predicates, 004R/010E inputs.
use snapback4_lang::{compile, Bound};
use snapback4_core::{Context, Engine, Value, wire};
use serde_json::json;
fn checked(source: &str) -> Bound {
    let b = compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b
}
const ROSTER: &str = "table roles:\n  principal: principal\n  role: enum('client', 'clerk', 'manager')\n  unique principal\n  read <- .principal = viewer or exists roles[principal = viewer, role = 'manager']\n  online only\n";
#[test]
fn lanes_005e_021r_unique_roster_role_arms_do_not_hide_the_hidden_row_note() {
    let body = "mutation open(client: principal):\n  require exists roles[principal = viewer, role = 'clerk'] else NOT_CLERK\n  require exists roles[principal = client, role = 'client'] else NOT_CLIENT\n  return true\n";
    let b = checked(&format!("{ROSTER}{body}"));
    let n = b.notes.iter().find(|n| n.code == "N_REQUIRE_HIDDEN").unwrap();
    assert!(n.message.contains("unique roster key") && n.message.contains("NOT_CLIENT"), "{n:?}");
    let service = checked(&format!("{}{body}", ROSTER.replace("role = 'manager']", "role = 'manager'] or viewer = 'service:operator'")));
    let conditional = service.notes.iter().find(|n| n.code == "N_REQUIRE_HIDDEN").unwrap();
    assert!(conditional.message.contains("outside the explicit service grant (service:operator)"), "{conditional:?}");
    // Independent role rows may coexist, so a clerk can also be a manager.
    let overlapping = checked(&format!("{}{body}", ROSTER.replace("unique principal", "unique principal, role")));
    assert!(!overlapping.notes.iter().any(|n| n.code == "N_REQUIRE_HIDDEN"));
    // A future require cannot establish caller context for an earlier read.
    let late = checked(&format!("{ROSTER}mutation open(client: principal):\n  require exists roles[principal = client, role = 'client'] else NOT_CLIENT\n  require exists roles[principal = viewer, role = 'clerk'] else NOT_CLERK\n  return true\n"));
    assert!(!late.notes.iter().any(|n| n.code == "N_REQUIRE_HIDDEN"));
    let readable = checked(&format!("{}{body}", ROSTER.replace("role = 'manager']", "role = 'manager'] or exists roles[principal = viewer, role = 'clerk']")));
    assert!(!readable.notes.iter().any(|n| n.code == "N_REQUIRE_HIDDEN"));
}
#[test]
fn lanes_003r_041r_bare_mixed_role_probes_name_the_entire_roster() {
    let b = checked(&format!("{ROSTER}table docs:\n  client: principal\n  read <- .client = viewer or exists roles[viewer]\n  online only\nmutation gate():\n  require exists roles[viewer] else STAFF_ONLY\n  return true\n"));
    let notes: Vec<_> = b.notes.iter().filter(|n| n.code == "N_ROLE_UNFILTERED").collect();
    assert_eq!(notes.len(), 1, "{notes:?}");
    assert!(notes[0].message.starts_with("docs.read"), "enrollment require stays quiet: {notes:?}");
    assert!(notes.iter().all(|n| n.message.contains("'client'") && n.message.contains("'manager'")));
    let exact = checked(&format!("{ROSTER}table docs:\n  read <- exists roles[viewer, role = 'manager']\n  online only\n"));
    assert!(!exact.notes.iter().any(|n| n.code == "N_ROLE_UNFILTERED"));
    let excluding_client = checked(&format!("{ROSTER}table docs:\n  client: principal\n  read <- .client = viewer or exists roles[viewer, role != 'client']\n  online only\n"));
    assert!(!excluding_client.notes.iter().any(|n| n.code == "N_ROLE_UNFILTERED"));
    let staff_only = checked(&format!("{}table docs:\n  client: principal\n  read <- .client = viewer or exists roles[viewer]\n  online only\n", ROSTER.replace("'client', 'clerk', 'manager'", "'clerk', 'officer', 'manager'")));
    assert!(!staff_only.notes.iter().any(|n| n.code == "N_ROLE_UNFILTERED"));
}
#[test]
fn lanes_007r_034r_require_never_grants_a_denied_table_effect() {
    for rule in ["", "  insert <- deny\n"] {
        let b = checked(&format!("{ROSTER}table docs:\n  body: text <=30\n  read <- allow\n{rule}  online only\nmutation write():\n  require exists roles[viewer, role = 'clerk'] else NOT_CLERK\n  return insert docs {{ body: 'hello' }}\n"));
        assert!(b.notes.iter().any(|n| n.code == "N_REQUIRE_REFUSED" && n.message.contains("E_RULE") && n.message.contains("denies every")), "{:?}", b.notes);
    }
}
const DOCS: &str = "table docs:\n  owner: principal\n  state: enum('open', 'closed')\n  unique owner\n  read <- .owner = viewer\n  online only\n";
#[test]
fn lanes_032e_050r_full_key_inequality_is_false_for_missing_or_hidden_rows() {
    let b = checked(&format!("{DOCS}query different(owner: principal):\n  return exists docs[owner = owner, state != 'closed']\n"));
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p|p.program)).unwrap();
    for (id, owner, state) in [("a", "alice", "open"), ("b", "bob", "closed")] {
        let row = wire::row_from_json(&e.schema().tables["docs"], &json!({"id":id,"owner":owner,"state":state})).unwrap();
        e.seed(vec![("docs".into(), row)]).unwrap();
    }
    for (viewer, owner, expected) in [("alice", "alice", true), ("bob", "bob", false), ("alice", "bob", false), ("alice", "missing", false)] {
        let result = e.query("different", Context::new(viewer, [("owner".into(), Value::Id(owner.into()))].into())).unwrap();
        assert_eq!(result.data, Value::Bool(expected), "{viewer}/{owner}");
    }
}
#[test]
fn lanes_032e_050r_rule_inequality_keeps_missing_and_equal_rows_denied() {
    let source = format!("{DOCS}table flags:\n  owner: principal\n  read <- exists docs[owner = .owner, state != 'closed']\n  online only\nquery visible():\n  return flags first 10 by byId\n");
    let b = checked(&source);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p|p.program)).unwrap();
    for (id, owner, state) in [("a", "alice", "open"), ("b", "bob", "closed")] {
        let row = wire::row_from_json(&e.schema().tables["docs"], &json!({"id":id,"owner":owner,"state":state})).unwrap();
        e.seed(vec![("docs".into(), row)]).unwrap();
    }
    for owner in ["alice", "bob", "missing"] {
        let row = wire::row_from_json(&e.schema().tables["flags"], &json!({"id":owner,"owner":owner})).unwrap();
        e.seed(vec![("flags".into(), row)]).unwrap();
    }
    let result = e.query("visible", Context::new("outsider", Default::default())).unwrap();
    let Value::Array(rows) = result.data else { panic!("{result:?}") };
    assert_eq!(rows.len(), 1, "{rows:?}");
    assert_eq!(rows[0].field("owner").unwrap(), &Value::Id("alice".into()));
}
#[test]
fn lanes_004r_010e_record_input_refusal_names_the_bounded_parallel_list_recipe() {
    let b = compile(&[("schema.q".into(), "mutation rooms(items: [{name: text 1..80, photo: image <=5MB}] 1..12):\n  return true\n".into())]);
    let d = b.diagnostics.iter().find(|d| d.message.contains("record-list")).unwrap();
    assert!(d.rewrite.contains("bounded parallel") && d.rewrite.contains("len(names) = len(photos)"));
    checked("mutation rooms(names: [text 1..80] 1..12, photos: [image <=5MB] 1..12):\n  require len(names) = len(photos) else LENGTH_MISMATCH\n  return true\n");
}

#[test]
fn bracket_inequality_cannot_observe_a_hidden_payload() {
    let source = DOCS.replace("state: enum('open', 'closed')", "state: enum('open', 'closed') read <- .owner = viewer").replace("read <- .owner = viewer\n  online", "read <- allow\n  online");
    let rule = compile(&[("schema.q".into(), format!("{source}table flags:\n  owner: principal\n  read <- exists docs[owner = .owner, state != 'closed']\n  online only\n"))]);
    assert!(rule.diagnostics.iter().any(|d| d.code == "E_COLUMN_READ"), "{:?}", rule.diagnostics);
    let b = checked(&format!("{source}query different(owner: principal):\n  return exists docs[owner = owner, state != 'closed']\n"));
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p|p.program)).unwrap();
    let row = wire::row_from_json(&e.schema().tables["docs"], &json!({"id":"a", "owner":"alice", "state":"open"})).unwrap();
    e.seed(vec![("docs".into(), row)]).unwrap();
    let result = e.query("different", Context::new("bob", [("owner".into(), Value::Id("alice".into()))].into())).unwrap();
    assert_eq!(result.data, Value::Bool(false));
}
#[test]
fn partial_and_nullable_bracket_inequality_stay_refused() {
    for schema in [DOCS.replace("unique owner", "unique owner, state"), DOCS.replace("state: enum('open', 'closed')", "state: enum('open', 'closed') ?")] {
        for tail in ["query other(owner: principal):\n  return exists docs[owner = owner, state != 'closed']\n", "table flags:\n  owner: principal\n  read <- exists docs[owner = .owner, state != 'closed']\n  online only\n"] {
            let b = compile(&[("schema.q".into(), format!("{schema}{tail}"))]);
            assert!(!b.diagnostics.is_empty(), "{schema}{tail}");
        }
    }
}

#[test]
fn lane_010e_partial_key_exists_is_a_bounded_caller_filtered_population() {
    let schema = "table trips:\n  public 'trip directory'\n  online only\ntable bookings:\n  trip: trips\n  guest: principal\n  approved: bool\n  unique trip, guest\n  by byTrip: trip, id\n  cap 20 by trip\n  read <- .guest = viewer\n  online only\n";
    checked(&format!("{}mutation safe(trip: trips):\n  require not exists bookings[trip = trip] by byTrip where .approved = false else UNAPPROVED\n  return true\n", schema.replace("read <- .guest = viewer", "read <- allow")));
    let global = compile(&[("schema.q".into(), format!("{schema}mutation global(trip: trips):\n  require not exists bookings[trip = trip] by byTrip where .approved = false else UNAPPROVED\n  return true\n"))]);
    let diagnostic = global.diagnostics.iter().find(|d| d.code == "E_STRUCTURAL_FANOUT").unwrap();
    assert!(diagnostic.rewrite.contains("bookingsCount[trip] = 0"));
    checked(&format!("{schema}view bookingsCount: count bookings by .trip\n  read <- allow\nmutation none(trip: trips):\n  require bookingsCount[trip] = 0 else HAS_BOOKINGS\n  return true\n"));
    // The same partial key is not a point predicate inside probe brackets.
    let refused = compile(&[("schema.q".into(), format!("{schema}mutation unsafe(trip: trips):\n  require not exists bookings[trip = trip, approved != true] else UNAPPROVED\n  return true\n"))]);
    assert!(!refused.diagnostics.is_empty());
}

#[test]
fn lanes_007r_034r_role_disjunction_and_owner_intent_explain_missing_authority() {
    let schema = format!("{ROSTER}table docs:\n  owner: principal\n  body: text <=30\n  read <- allow\n  update <- exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'manager']\n  online only\n");
    for gate in ["exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'client']", "r.owner = viewer"] {
        let b = checked(&format!("{schema}mutation change(doc: docs):\n  r = docs[doc] ! else MISSING\n  require {gate} else NOT_ALLOWED\n  update docs[doc] {{ body: 'changed' }}\n"));
        assert!(b.notes.iter().any(|n| n.code == "N_REQUIRE_REFUSED" && n.message.contains("missing authority proof")), "{gate}: {:?}", b.notes);
    }
}

#[test]
fn hidden_row_note_keeps_the_explicit_service_exception_real() {
    let source = ROSTER.replace("role = 'manager']", "role = 'manager'] or viewer = 'service:operator'");
    let b = checked(&format!("{source}mutation guard(client: principal):\n  require exists roles[principal = viewer, role = 'clerk'] else NOT_CLERK\n  require exists roles[principal = client, role = 'client'] else NOT_CLIENT\n  return true\nquery readable(client: principal):\n  return exists roles[principal = client, role = 'client']\n"));
    assert!(b.notes.iter().any(|n| n.code == "N_REQUIRE_HIDDEN" && n.message.contains("outside the explicit service grant")));
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p|p.program)).unwrap();
    let row = wire::row_from_json(&e.schema().tables["roles"], &json!({"id":"client", "principal":"bob", "role":"client"})).unwrap();
    e.seed(vec![("roles".into(), row)]).unwrap();
    let result = e.query("readable", Context::new("service:operator", [("client".into(), Value::Id("bob".into()))].into())).unwrap();
    assert_eq!(result.data, Value::Bool(true));
}

#[test]
fn bracket_predicates_keep_signed_literals_and_reject_expression_operands() {
    let schema = "table docs:\n  score: int\n  read <- allow\n  online only\n";
    checked(&format!("{schema}query other(doc: docs):\n  return exists docs[doc, score != -1]\n"));
    checked(&format!("{schema}table flags:\n  doc: docs\n  read <- exists docs[.doc, score != -1]\n  online only\n"));
    let b = compile(&[("schema.q".into(), format!("{schema}query other(doc: docs, score: int):\n  return exists docs[doc, score != score]\n"))]);
    assert!(b.diagnostics.iter().any(|d| d.message.contains("non-null literal")));
}

#[test]
fn review_r1_ordinary_ordered_pages_refuse_bracket_inequality_without_panicking() {
    let schema = "table docs:\n  score: int\n  by byScore: score, id\n  read <- allow\n  online only\n";
    for body in ["return docs[score != 1] first 10 by byScore", "return count(docs[score != 1] by byScore)"] {
        let b = compile(&[("schema.q".into(), format!("{schema}query page():\n  {body}\n"))]);
        assert!(b.diagnostics.iter().any(|d| d.message.contains("not an ordered page seek") && d.rewrite.contains("where .score != 1")), "{body}: {:?}", b.diagnostics);
    }
    checked(&format!("{schema}query page():\n  return docs first 10 by byScore where .score != 1\n"));
}
