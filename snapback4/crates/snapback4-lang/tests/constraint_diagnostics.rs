//! Constraint checks cannot silently ignore another writer's hidden rows.
use snapback4_core::{Ceilings, Context, Engine, Value, WriteState, value::object};
use snapback4_lang::{Bound, compile, guide};
use std::collections::BTreeMap;

const BOOKINGS: &str = r#"table listings:
  host: principal
  public
table bookings:
  listing: listings
  guest: principal
  host: principal
  start: time
  end: time
  status: enum('held', 'paid', 'cancelled')
  read <- .guest = viewer or .host = viewer
  insert <- .guest = viewer
mutation book(listing: listings, start: time, end: time):
  require not exists(bookings where .listing = listing and .status != 'cancelled' and .start < end and .end > start) else TAKEN
  return insert bookings { listing, guest: viewer, host: (listings[listing] ! else NOT_FOUND).host, start, end, status: 'held' }
"#;
// The supplied example's bare `!` needs its existing required refusal code;
// keep that normalization separate from the constraint diagnostic under test.

fn compile_source(source: &str) -> Bound { compile(&[("schema.q".into(), source.into())]) }
fn checked(source: &str) -> Bound {
    let bound = compile_source(source);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert!(bound.notes.is_empty(), "{:?}", bound.notes);
    bound
}

#[test]
fn hidden_booking_exists_and_count_name_the_constraint_and_both_rewrites() {
    for (head, tail) in [("not exists(", ") else"), ("count(", ") = 0 else")] {
        // A cap on listings cannot decide the private guest/host rule.
        for cap in ["", "  cap 40 by listing\n"] {
            let source = BOOKINGS.replace("not exists(", head).replace(") else", tail)
                .replace("  read <- .guest", &format!("{cap}  read <- .guest"));
            let bound = compile_source(&source);
            assert_eq!(bound.diagnostics.len(), 1, "{:?}", bound.diagnostics);
            assert!(bound.programs.is_empty());
            let d = &bound.diagnostics[0];
            assert_eq!(d.code, "E_STRUCTURAL_FANOUT", "{d}");
            assert_eq!(d.site.file, "schema.q");
            assert_eq!(d.site.line, if cap.is_empty() { 14 } else { 15 });
            assert!(d.site.col > 1);
            for text in ["`book` can read only the bookings its viewer may read", ".guest = viewer or .host = viewer", "miss hidden bookings rows"] {
                assert!(d.message.contains(text), "{d}");
            }
            for text in ["constraint every write obeys", "unique resource, unit else TAKEN", "insert those rows inside `book`", "rolls back the whole mutation", "hidden clash stays E_RULE", "readable audience", "public availability table"] {
                assert!(d.rewrite.contains(text), "{d}");
            }
            assert!(!d.to_string().contains("$intent:"), "{d}");
            assert!(!d.rewrite.contains("pin .guest"), "{d}");
            assert_eq!(d.guide, "writes");
            assert!(d.explanation_section().is_some());
        }
    }
}

#[test]
fn constraint_wording_does_not_infer_booking_intent_from_column_names() {
    for (guest, listing) in [("guest", "listing"), ("owner", "resource")] {
        let source = format!("table reviews:\n  {guest}: principal\n  {listing}: id\n  read <- .{guest} = viewer\nmutation check():\n  return count(reviews)\n");
        let bound = compile_source(&source);
        let d = &bound.diagnostics[0];
        assert_eq!(d.code, "E_STRUCTURAL_FANOUT", "{d}");
        assert!(d.message.contains("miss hidden reviews rows"), "{d}");
        assert!(d.rewrite.contains("unique resource, unit else TAKEN"), "{d}");
        assert!(!d.rewrite.contains("table nights") && !d.message.contains("other guests"), "{d}");
    }
}

#[test]
fn sum_domain_in_book_gets_the_hidden_constraint_explanation() {
    let source = BOOKINGS.lines().map(|line| if line.starts_with("  require ") {
        "  require sum(bookings, .start) = 0 else TAKEN"
    } else { line }).collect::<Vec<_>>().join("\n");
    let bound = compile_source(&source);
    assert_eq!(bound.diagnostics.len(), 1, "{:?}", bound.diagnostics);
    let d = &bound.diagnostics[0];
    assert_eq!(d.code, "E_STRUCTURAL_FANOUT", "{d}");
    assert_eq!(d.site.line, 14);
    assert!(d.message.contains("`book` can read only the bookings"), "{d}");
    assert!(d.message.contains("miss hidden bookings rows"), "{d}");
    assert!(d.rewrite.contains("unique resource, unit else TAKEN"), "{d}");
}

#[test]
fn capped_scope_that_decides_the_rule_keeps_the_existing_rewrite() {
    let schema = "table items:\n  owner: principal\n  cap 8 by owner\n  read <- .owner = viewer\n";
    for expression in ["count(items)", "exists(items)"] {
        let bound = compile_source(&format!("{schema}mutation check():\n  return {expression}\n"));
        assert_eq!(bound.diagnostics.len(), 1, "{:?}", bound.diagnostics);
        let d = &bound.diagnostics[0];
        assert_eq!(d.code, "E_STRUCTURAL_FANOUT");
        assert!(d.rewrite.contains("pin .owner"), "{d}");
        assert!(d.rewrite.contains("capped group"), "{d}");
        assert!(!d.rewrite.contains("unique resource"), "{d}");
        // Pinning the capped owner actually admits this domain.
        let fixed = expression.replace("items)", "items where .owner = viewer)");
        checked(&format!("{schema}mutation check():\n  return {fixed}\n"));
    }
}

#[test]
fn inlined_helper_keeps_the_domain_site_and_names_the_calling_mutation() {
    let source = "table reservations:\n  owner: principal\n  read <- .owner = viewer\nfn occupied(): exists(reservations)\nmutation reserve():\n  require not occupied() else TAKEN\n";
    let bound = compile_source(source);
    assert_eq!(bound.diagnostics.len(), 1, "{:?}", bound.diagnostics);
    let d = &bound.diagnostics[0];
    assert_eq!(d.code, "E_STRUCTURAL_FANOUT");
    assert_eq!(d.site.line, 4);
    assert!(d.message.contains("`reserve` can read only the reservations"), "{d}");
    assert!(d.message.contains("hidden reservations rows"), "{d}");
    assert!(d.rewrite.contains("unique resource, unit else TAKEN"), "{d}");
}

fn card_source() -> String {
    guide::quarry(guide::card("writes").unwrap()).into_iter()
        .find(|source| source.contains("unique listing, day else TAKEN")).unwrap()
}
fn engine(source: &str) -> Engine {
    let bound = checked(source);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed([("listings".into(), object([("id", Value::Id("listing".into())), ("host", Value::Id("host".into()))]))]).unwrap();
    engine
}
fn booking(viewer: &str, first: i64, last: i64) -> Context {
    Context::new(viewer, BTreeMap::from([
        ("listing".into(), Value::Id("listing".into())),
        ("firstDay".into(), Value::Int(first)), ("lastDay".into(), Value::Int(last)),
    ])).with_ids((0..8).map(|n| format!("{viewer}-{first}-{n}")))
}

#[test]
fn writes_card_two_guests_get_taken_and_the_whole_conflicting_booking_rolls_back() {
    let source = format!("{}\nquery booking(key: bookings):\n  return bookings[key]\n", card_source());
    let mut engine = engine(&source);
    let first = engine.mutate("book", None, booking("alice", 10, 12)).unwrap();
    assert!(matches!(first.state, WriteState::Sent { .. }), "{:?}", first.state);
    // Bob first inserts a free night (9), then collides with Alice's night 10.
    let second = engine.mutate("book", None, booking("bob", 9, 11)).unwrap();
    assert!(matches!(&second.state, WriteState::Failed { why, .. } if why.code == "TAKEN"), "{:?}", second.state);
    assert_eq!(engine.store().count("bookings").unwrap(), 1);
    assert_eq!(engine.store().count("nights").unwrap(), 2);
    let alice_key = BTreeMap::from([("key".into(), Value::Id("alice-10-0".into()))]);
    assert_ne!(engine.query("booking", Context::new("alice", alice_key.clone())).unwrap().data, Value::Null);
    assert_eq!(engine.query("booking", Context::new("bob", alice_key)).unwrap().data, Value::Null);
    // The earlier free night and the failed booking were rolled back too.
    let retry = engine.mutate("book", None, booking("bob", 9, 10)).unwrap();
    assert!(matches!(retry.state, WriteState::Sent { .. }), "{:?}", retry.state);
    assert_eq!(engine.store().count("bookings").unwrap(), 2);
    assert_eq!(engine.store().count("nights").unwrap(), 3);
}

#[test]
fn a_hidden_night_collision_stays_e_rule_even_with_a_named_unique_code() {
    let source = card_source().replace("public 'occupied dates and booking references are public; guest details stay private'",
        "read <- exists bookings[id = .booking, guest = viewer]");
    let mut engine = engine(&source);
    let first = engine.mutate("book", None, booking("alice", 10, 11)).unwrap();
    assert!(matches!(first.state, WriteState::Sent { .. }), "{:?}", first.state);
    let second = engine.mutate("book", None, booking("bob", 10, 11)).unwrap();
    assert!(matches!(&second.state, WriteState::Failed { why, .. } if why.code == "E_RULE"), "{:?}", second.state);
    assert_eq!(engine.store().count("bookings").unwrap(), 1);
    assert_eq!(engine.store().count("nights").unwrap(), 1);
}

#[test]
fn writes_card_refuses_a_stranger_inserting_a_night_without_creating_the_booking() {
    let source = format!("{}\nmutation squat(listing: listings, booking: bookings, day: int):\n  insert nights {{ listing, day, booking }}\n", card_source());
    let bound = compile_source(&source);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert_eq!(bound.notes.len(), 1, "{:?}", bound.notes);
    let note = &bound.notes[0];
    assert_eq!(note.code, "N_REFERENCE_UNCHECKED", "{note}");
    assert!(note.message.contains("mutation squat") && note.message.contains("listings[listing]"), "{note}");
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed([("listings".into(), object([("id", Value::Id("listing".into())), ("host", Value::Id("host".into()))]))]).unwrap();
    let first = engine.mutate("book", None, booking("alice", 10, 11)).unwrap();
    assert!(matches!(first.state, WriteState::Sent { .. }), "{:?}", first.state);
    let stranger = Context::new("bob", BTreeMap::from([
        ("listing".into(), Value::Id("listing".into())),
        ("booking".into(), Value::Id("alice-10-0".into())),
        ("day".into(), Value::Int(9)),
    ])).with_ids(["stranger-night".into()]);
    let result = engine.mutate("squat", None, stranger).unwrap();
    assert!(matches!(&result.state, WriteState::Failed { why, .. } if why.code == "E_RULE"), "{:?}", result.state);
    assert_eq!(engine.store().count("bookings").unwrap(), 1);
    assert_eq!(engine.store().count("nights").unwrap(), 1);
}

#[test]
fn per_night_pattern_retains_write_meter_and_atomic_rollback() {
    let mut engine = engine(&card_source());
    engine.set_ceilings(Ceilings { rows_written: 2, ..Ceilings::default() });
    let result = engine.mutate("book", None, booking("alice", 10, 12)).unwrap();
    assert!(matches!(&result.state, WriteState::Failed { why, .. } if why.code == "E_BOUND"), "{:?}", result.state);
    assert_eq!(engine.store().count("bookings").unwrap(), 0);
    assert_eq!(engine.store().count("nights").unwrap(), 0);
}
