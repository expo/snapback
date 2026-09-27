//! Delivery at the GS, CQ and ER read boundaries after their integration.
use serde_json::{Value as Json, json};
use snapback4_core::{Ceilings, Context, Engine, Value, WriteState, engine::QueryOutcome, value::object};

const SOURCE: &str = include_str!("delivery/integration.q");
const CLAUSE: &str = "\n  reports delivery of messages by .room, .ordinal";
fn id(s: &str) -> Value { Value::Id(s.into()) }
fn stamped(row: &Value) -> bool {
    matches!(row, Value::Row(fields) | Value::Map(fields) if fields.source_identity().is_some())
}
fn context(viewer: &str, args: impl IntoIterator<Item = (&'static str, Value)>) -> Context {
    Context::new(viewer, args.into_iter().map(|(k, v)| (k.into(), v)).collect()).at(100)
}
fn room(viewer: &str) -> Context { context(viewer, [("room", id("r1"))]) }
fn report(viewer: &str) -> Context {
    context(viewer, [("group", id("r1")), ("low", Value::Int(1)), ("high", Value::Int(4))])
}
fn search(c: Option<String>) -> Context {
    context("alice", [("q", Value::String("co".into())), ("c", c.map(Value::String).unwrap_or(Value::Null))])
}
fn setup(tracked: bool, expiring: bool) -> Engine {
    let mut source = SOURCE.to_owned();
    if !tracked { source = source.replace(CLAUSE, ""); }
    if !expiring { source = source.replace("  expire at .until\n", ""); }
    let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert_eq!(bound.schema.operations["delivered"].predicts.as_deref(), Some("never"));
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    let mut rows = Vec::new();
    for (group, viewer) in [("r1", "alice"), ("r2", "alice"), ("r3", "bob")] {
        rows.push(("rooms".into(), object([("id", id(group))])));
        rows.push(("members".into(), object([("id", id(group)), ("room", id(group)), ("principal", id(viewer))])));
        for n in 1..=4 {
            // Hidden, expired and tombstoned candidates sort before live hits.
            let at = if group == "r3" { 2000 + n } else if n >= 3 { 1000 + n }
                else if group == "r2" { n * 20 } else { n * 20 - 5 };
            rows.push(("messages".into(), object([
                ("id", id(&format!("{group}-{n}"))), ("room", id(group)), ("ordinal", Value::Int(n)),
                ("body", Value::String("coffee corn zebra".into())), ("at", Value::Int(at)),
                ("tombstone", Value::Bool(n == 4 || (!expiring && n == 3))),
                ("until", if n == 3 { Value::Int(50) } else { Value::Null }),
            ])));
        }
    }
    // Keep expired rows physically present: the scan must reject them itself.
    engine.load_trusted(rows).unwrap();
    engine
}
fn manifest(out: &QueryOutcome) -> Json {
    let manifest = serde_json::to_value(&out.delivery).unwrap();
    assert!(manifest.is_array(), "{out:?}");
    assert_eq!(manifest.as_array().unwrap().len(), 1);
    assert_eq!(manifest[0]["table"], "messages");
    assert_eq!(manifest[0]["mutation"], "delivered");
    assert_eq!(manifest[0]["args"], json!(["group", "low", "high"]));
    assert!(manifest[0]["partial"].is_null(), "{out:?}");
    manifest[0]["rows"].clone()
}
fn same_answer(tracked: &QueryOutcome, ordinary: &QueryOutcome) {
    assert_eq!(tracked.data, ordinary.data);
    assert_eq!(tracked.metered, ordinary.metered);
    assert_eq!(tracked.complete, ordinary.complete);
    assert_eq!(tracked.cut, ordinary.cut);
    assert_eq!(tracked.capped_at, ordinary.capped_at);
    assert_eq!(tracked.next.is_some(), ordinary.next.is_some());
    assert_eq!(tracked.next_expiry, ordinary.next_expiry);
    assert_eq!(tracked.unavailable, ordinary.unavailable);
    assert!(ordinary.delivery.is_none() && ordinary.delivery_meter.is_none());
}

#[test]
fn compact_membership_search_reports_only_authorized_emitted_images() {
    // @ref LLP 3000.024#3 — both actual-size and selected expiring head paths.
    // @ref LLP 3000.022#5 — heads, duplicate words and dropped images are not deliveries.
    for expiring in [false, true] {
        let mut tracked = setup(true, expiring);
        let mut ordinary = setup(false, expiring);
        let first = tracked.query("newest", search(None)).unwrap();
        let control = ordinary.query("newest", search(None)).unwrap();
        same_answer(&first, &control);
        assert!(first.complete && first.next.is_some());
        assert_eq!(first.data.as_array().unwrap().len(), 2);
        assert_eq!(manifest(&first), json!([["r2", 2], ["r1", 2]]));
        // Every returned field is an alias: coordinates cannot be recovered from JSON.
        assert!(first.data.as_array().unwrap().iter().all(|row| row.field("ordinal").is_err()));

        // A head from r2 must not survive a membership revocation on the next page.
        for e in [&mut tracked, &mut ordinary] {
            let left = e.mutate("leave", None, context("alice", [("id", id("r2"))])).unwrap();
            assert!(matches!(left.state, WriteState::Sent { .. }));
        }
        let next = tracked.query("newest", search(first.next)).unwrap();
        let control_next = ordinary.query("newest", search(control.next)).unwrap();
        same_answer(&next, &control_next);
        assert!(next.complete && next.next.is_none());
        assert_eq!(next.data.as_array().unwrap().len(), 1);
        assert_eq!(manifest(&next), json!([["r1", 1]]));
    }
}

#[test]
fn cursorless_page_stamps_its_exact_bound_without_lookahead() {
    // @ref LLP 3000.027#2 — the declared bound must fit at the exact examined ceiling.
    let mut tracked = setup(true, true);
    let mut ordinary = setup(false, true);
    for examined in [2, 1] {
        for e in [&mut tracked, &mut ordinary] {
            e.set_ceilings(Ceilings { examined, ..Ceilings::default() });
        }
        let out = tracked.query("plain", room("alice")).unwrap();
        let control = ordinary.query("plain", room("alice")).unwrap();
        same_answer(&out, &control);
        // A cap records its failed attempt too; the full page never attempts row 3.
        assert_eq!(out.metered.examined, 2);
        assert_eq!(out.data.as_array().unwrap().len(), examined as usize);
        assert_eq!(out.complete, examined == 2, "{out:?}");
        assert!(out.next.is_none());
        assert_eq!(manifest(&out), if examined == 2 { json!([["r1", 1], ["r1", 2]]) } else { json!([["r1", 1]]) });
    }
    let denied = tracked.query("plain", room("bob")).unwrap();
    assert!(denied.data.as_array().unwrap().is_empty());
    assert_eq!(manifest(&denied), json!([]));
}

#[test]
fn admitted_expiring_scans_keep_query_delivery_out_of_mutations_and_replay() {
    // @ref LLP 3000.025#3 — the admitted mutation prefix uses aborting, server-only reads.
    // @ref LLP 3000.022#5 — only query output images produce delivery metadata.
    let mut tracked = setup(true, true);
    let mut ordinary = setup(false, true);
    let read = tracked.query("expiring", room("alice")).unwrap();
    let control = ordinary.query("expiring", room("alice")).unwrap();
    same_answer(&read, &control);
    assert!(read.complete);
    assert_eq!(manifest(&read), json!([["r1", 1], ["r1", 2], ["r1", 4]]));
    assert!(read.data.as_array().unwrap().iter().all(stamped));
    let before = tracked.seq().unwrap();
    let out = tracked.mutate("delivered", Some("read"), report("alice")).unwrap();
    let plain = ordinary.mutate("delivered", Some("read"), report("alice")).unwrap();
    assert!(out.receipt_only && !plain.receipt_only);
    assert_eq!(tracked.seq().unwrap(), before);
    assert_eq!(out.metered, plain.metered);
    let WriteState::Sent { result, .. } = &out.state else { panic!("{out:?}") };
    assert_eq!(result, &read.data);
    assert!(result.as_array().unwrap().iter().all(|row| !stamped(row)), "mutation reads must not stamp delivery");
    assert!(out.reply(Some("read")).get("delivery").is_none());
    let replay = tracked.mutate("delivered", Some("read"), report("alice").at(200)).unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.metered.examined, 0);
    assert_eq!(out.receipt(Some("read")), replay.receipt(Some("read")));
    assert!(matches!(replay.state, WriteState::Sent { result: Value::Null, .. }));

    tracked.set_ceilings(Ceilings { examined: 2, ..Ceilings::default() });
    let before = tracked.seq().unwrap();
    let cut = tracked.mutate("delivered", Some("cut"), report("alice")).unwrap();
    assert!(matches!(&cut.state, WriteState::Failed { why, .. } if why.code == "E_BOUND"), "{cut:?}");
    assert_eq!(cut.metered.rows_written, 0);
    assert_eq!(tracked.seq().unwrap(), before);
    tracked.set_ceilings(Ceilings::default());
    let again = tracked.mutate("delivered", Some("cut"), report("alice")).unwrap();
    assert!(again.replayed);
    assert_eq!(again.receipt(Some("cut")), cut.receipt(Some("cut")));
    let denied = tracked.mutate("delivered", Some("denied"), report("bob")).unwrap();
    assert!(matches!(&denied.state, WriteState::Sent { result: Value::Array(rows), .. } if rows.is_empty()));
}
