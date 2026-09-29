use super::*;
use crate::{Context, Schema, meter::{Ceilings, Cut, Meter}, rows::{MemoryRows, Rows}};

fn schema(private: bool) -> Schema {
    let source = if private {
        include_str!("../../../../../snapback4-device/tests/unread_range/schema.q")
    } else { include_str!("../../../../../snapback4-lang/tests/fixtures/row-keyed-view.q") };
    let compiled = snapback4_lang::compile(&[("batch.q".into(), source.into())]);
    assert!(compiled.diagnostics.is_empty(), "{:?}", compiled.diagnostics);
    crate::json_codec::from_text(&crate::json_codec::to_text(&compiled.schema).unwrap()).unwrap()
}
fn member(id: &str, parent: &str, principal: &str, mark: i64) -> Value {
    object([("id", Value::Id(id.into())), ("conversationId", Value::Id(parent.into())),
        ("principal", Value::Id(principal.into())), ("readUpTo", Value::Int(mark)), ("joinedAt", Value::Int(0))])
}
fn message(id: &str, parent: &str, ordinal: i64, until: Value) -> Value {
    object([("id", Value::Id(id.into())), ("conversationId", Value::Id(parent.into())),
        ("ordinal", Value::Int(ordinal)), ("at", Value::Int(ordinal)), ("senderId", Value::Id("sender".into())),
        ("until", until), ("tombstone", Value::Bool(false))])
}
fn view(id: &str, pending: bool) -> Value {
    object([("id", Value::Id(id.into())), ("member", Value::Id(id.into())),
        ("value", Value::Int(999999)), ("recountPending", Value::Bool(pending))])
}
fn runner<'a>(rows: &'a MemoryRows, schema: &'a Schema, viewer: &str) -> Runner<'a> {
    Runner::new(rows, schema, Context::new(viewer, Default::default()).at(10),
        Meter::new(Ceilings::unbounded(), Cut::Abort), 0)
}

#[test]
fn fifty_receipts_at_the_head_do_not_walk_ten_thousand_messages() {
    let schema = schema(false);
    let rows = MemoryRows::new();
    for n in 1..=10000 {
        rows.put("messages", &schema.tables["messages"],
            &message(&format!("message-{n}"), "busy", n, Value::Null), None).unwrap();
    }
    for peer in 0..50 {
        let id = format!("member-{peer}");
        rows.put("members", &schema.tables["members"],
            &member(&id, "busy", &format!("principal-{peer}"), 10000), None).unwrap();
        let mut r = runner(&rows, &schema, "reader");
        let actual = r.live_aggregate_batch("unread", &[view(&id, true)]).unwrap();
        assert_eq!(actual[0].as_ref().unwrap().field("value"), Ok(&Value::Int(0)));
        assert_eq!(r.rebuilt_source_rows, 0, "receipt {peer} certifies an empty indexed suffix without decoding history");
        drop(r);
        rows.put("members", &schema.tables["members"],
            &member(&id, "busy", &format!("principal-{peer}"), 9999), None).unwrap();
        let mut r = runner(&rows, &schema, "reader");
        let actual = r.live_aggregate_batch("unread", &[view(&id, true)]).unwrap();
        assert_eq!(actual[0].as_ref().unwrap().field("value"), Ok(&Value::Int(1)));
        assert_eq!(r.rebuilt_source_rows, 1, "one outstanding receipt decodes one position, not the history");
    }
}

#[test]
fn predicate_probe_preserves_a_small_writer_allowance() {
    let schema = schema(false);
    let rows = MemoryRows::new();
    for n in 1..=100 {
        rows.put("messages", &schema.tables["messages"],
            &message(&format!("m{n}"), "busy", n, Value::Null), None).unwrap();
    }
    let member = member("reader", "busy", "reader", 0);
    let mut r = Runner::new(&rows, &schema, Context::system().at(10),
        Meter::new(Ceilings { examined: 48, ..Ceilings::default() }, Cut::Abort), 0);
    assert_eq!(r.small_view_range(&schema.maintains[0], &member).unwrap(), None);
    assert_eq!(r.meter.used.examined, 0, "a small writer reserves its bounded recount instead");
    let (_, complete, cursor) = r.live_basis_scan(&schema.maintains[0], &member, None, 8).unwrap();
    assert!(!complete && cursor.is_some(), "the ordinary chunk can continue in background");
    assert!(r.meter.used.examined <= 48);
}

#[test]
fn predicate_probe_cutoff_counts_every_candidate_and_keeps_rejected_positions() {
    let schema = schema(false);
    for candidates in [63, 64, 65] {
        for rejected_prefix in [false, true] {
            let rows = MemoryRows::new();
            let member = member("reader", "busy", "reader", 0);
            for ordinal in 1..=candidates {
                let mut row = message(&format!("m{ordinal}"), "busy", ordinal, Value::Null);
                if rejected_prefix && ordinal < candidates {
                    let Value::Row(fields) = &mut row else { unreachable!() };
                    match ordinal % 3 {
                        0 => { fields.insert("until".into(), Value::Int(10)); }
                        1 => { fields.insert("tombstone".into(), Value::Bool(true)); }
                        _ => { fields.insert("senderId".into(), Value::Id("reader".into())); }
                    }
                }
                rows.put("messages", &schema.tables["messages"], &row, None).unwrap();
            }
            // Independent fixture oracle: either every row is live and unread,
            // or only the final row is. In particular, row 64 cannot be lost.
            let expected = if rejected_prefix { 1 } else { candidates };
            let mut probe = runner(&rows, &schema, "reader");
            let actual = probe.small_view_range(&schema.maintains[0], &member).unwrap();
            if candidates <= 64 {
                assert_eq!(actual, Some(expected), "{candidates} candidates, rejected prefix={rejected_prefix}");
                assert_eq!(probe.meter.used.examined, (2 * candidates + 1) as u64,
                    "one head probe per stored position plus exhaustion, then every candidate");
                assert!(probe.rebuilt_source_rows > 0 && probe.rebuilt_source_rows <= candidates as u64);
                if !rejected_prefix { assert_eq!(probe.rebuilt_source_rows, candidates as u64); }
            } else {
                assert_eq!(actual, None, "65 stored candidates must use the fallback even if most are rejected");
                assert_eq!(probe.meter.used.examined, 65, "the probe stays bounded and charged");
                assert_eq!(probe.rebuilt_source_rows, 0, "abandon before decoding any candidate");
                let mut fallback = runner(&rows, &schema, "reader");
                let (count, complete, _) = fallback.live_basis_scan(&schema.maintains[0], &member, None, usize::MAX).unwrap();
                assert_eq!((count, complete), (expected, true));
                assert!(fallback.meter.used.examined <= 132, "65 probes plus one live walk and two exhaustion checks");
                assert!(fallback.rebuilt_source_rows > 0 && fallback.rebuilt_source_rows <= 65);
                if !rejected_prefix { assert_eq!(fallback.rebuilt_source_rows, 65); }
            }
        }
    }
}

#[test]
fn small_predicate_ranges_match_an_independent_unread_oracle() {
    let schema = schema(false);
    let rows = MemoryRows::new();
    // Named fixture facts, not a second evaluation of RowKey::matches.
    // Alice: read through 1, joined at 3. Bob: read through 1, joined at 0.
    let fixtures = [
        ("already-read", "busy", 1, "sender", false, Value::Null, [false, false]),
        ("before-join", "busy", 2, "sender", false, Value::Null, [false, true]),
        ("at-join", "busy", 3, "sender", false, Value::Null, [false, true]),
        ("alice-self", "busy", 4, "alice", false, Value::Null, [false, true]),
        ("tombstone", "busy", 5, "sender", true, Value::Null, [false, false]),
        ("expired", "busy", 6, "sender", false, Value::Int(10), [false, false]),
        ("bob-self", "busy", 7, "bob", false, Value::Null, [true, false]),
        ("live", "busy", 8, "sender", false, Value::Int(20), [true, true]),
        ("other-group", "elsewhere", 9, "sender", false, Value::Null, [false, false]),
    ];
    for (id, parent, ordinal, sender, tombstone, until, _) in &fixtures {
        let mut row = message(id, parent, *ordinal, until.clone());
        let Value::Row(fields) = &mut row else { unreachable!() };
        fields.insert("senderId".into(), Value::Id((*sender).into()));
        fields.insert("tombstone".into(), Value::Bool(*tombstone));
        rows.put("messages", &schema.tables["messages"], &row, None).unwrap();
    }
    for (i, (principal, joined)) in [("alice", 3), ("bob", 0)].into_iter().enumerate() {
        let expected = fixtures.iter().filter(|row| row.6[i]).count() as i64;
        assert_eq!(expected, [2, 4][i], "the fixture oracle is independent of the engine predicate");
        let mut member = member(principal, "busy", principal, 1);
        let Value::Row(fields) = &mut member else { unreachable!() };
        fields.insert("joinedAt".into(), Value::Int(joined));
        rows.put("members", &schema.tables["members"], &member, None).unwrap();
        let mut probe = runner(&rows, &schema, principal);
        assert_eq!(probe.small_view_range(&schema.maintains[0], &member).unwrap(), Some(expected), "{principal}: exclude tombstones, self-sends, join floor, read floor, expiry and other groups");
        assert!(probe.meter.used.examined <= 15);
        assert!(probe.rebuilt_source_rows > 0 && probe.rebuilt_source_rows <= 7);
        let actual = runner(&rows, &schema, principal).live_aggregate_batch("unread", &[view(principal, true)]).unwrap();
        assert_eq!(actual[0].as_ref().unwrap().field("value"), Ok(&Value::Int(expected)));
    }
}

fn receipt_writer(examined: u64, members: usize) -> crate::Engine {
    let mut source = include_str!("../../../../../snapback4-lang/tests/fixtures/row-keyed-view.q").to_owned();
    source.push_str("\nmutation markAll():\n");
    for n in 0..members { source.push_str(&format!("  update members['reader-{n}'] {{ readUpTo: 1 }}\n")); }
    let compiled = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(compiled.diagnostics.is_empty(), "{:?}", compiled.diagnostics);
    let schema: Schema = crate::json_codec::from_text(&crate::json_codec::to_text(&compiled.schema).unwrap()).unwrap();
    let programs: Vec<crate::Program> = crate::json_codec::from_text(&crate::json_codec::to_text(
        &compiled.programs.into_iter().map(|p| p.program).collect::<Vec<_>>()).unwrap()).unwrap();
    let mut engine = crate::Engine::memory(schema, programs).unwrap();
    engine.set_ceilings(Ceilings::unbounded());
    let mut seed = vec![("conversations".into(), object([("id", Value::Id("busy".into())), ("title", Value::String("Busy".into()))]))];
    seed.extend((1..=1000).map(|n| {
        let mut row = message(&format!("m{n}"), "busy", n, Value::Null);
        let Value::Row(fields) = &mut row else { unreachable!() };
        fields.remove("at"); // The public fixture has no authored timestamp column.
        ("messages".into(), row)
    }));
    seed.extend((0..members).map(|n| ("members".into(), member(&format!("reader-{n}"), "busy", &format!("reader-{n}"), 0))));
    engine.seed_at(seed, 1).unwrap();
    engine.set_ceilings(Ceilings { examined, ..Ceilings::default() });
    engine
}

fn assert_receipt_committed(engine: &mut crate::Engine, members: usize, require_pending: bool) {
    let rows = engine.store().rows("members").unwrap();
    assert_eq!(rows.len(), members);
    assert!(rows.iter().all(|row| row.field("readUpTo") == Ok(&Value::Int(1))));
    let views = engine.store().rows("unread").unwrap();
    assert_eq!(views.len(), members);
    if require_pending {
        assert!(views.iter().any(|row| row.field("recountPending") == Ok(&Value::Bool(true))), "certification yields when probe plus walk cannot fit");
    }
    let committed = engine.seq().unwrap();
    while let Some(chunk) = engine.run_view_chunk(10).unwrap() { assert!(matches!(chunk, crate::engine::ViewChunk::Private)); }
    assert_eq!(engine.seq().unwrap(), committed, "private recount must not republish the receipt");
    for view in engine.store().rows("unread").unwrap() {
        assert_eq!(view.field("value"), Ok(&Value::Int(999)));
        assert_eq!(view.field("recountPending"), Ok(&Value::Bool(false)));
    }
}

#[test]
fn receipt_probe_fallback_commits_with_moderate_writer_budgets() {
    let mut failures = Vec::new();
    for examined in [210, 240, 256, 300, 500] {
        let mut engine = receipt_writer(examined, 1);
        let context = Context::new("reader-0", [("member".into(), Value::Id("reader-0".into())), ("readUpTo".into(), Value::Int(1))].into()).at(10);
        let result = engine.mutate("mark", None, context).unwrap();
        if !matches!(result.state, crate::WriteState::Sent { .. }) {
            failures.push(format!("examined={examined}: {:?}", result.state));
        } else {
            assert_receipt_committed(&mut engine, 1, true);
        }
    }
    assert!(failures.is_empty(), "receipt updates must commit with a pending recount: {failures:#?}");
}

#[test]
fn receipt_probe_fallback_commits_eight_members_with_the_default_budget() {
    for members in [7, 8] {
        let mut engine = receipt_writer(Ceilings::default().examined, members);
        let result = engine.mutate("markAll", None, Context::new("reader-0", Default::default()).at(10)).unwrap();
        assert!(matches!(result.state, crate::WriteState::Sent { .. }), "{members} members: {result:?}");
        assert_receipt_committed(&mut engine, members, members == 8);
    }
}

#[test]
fn fifty_members_share_one_live_walk_and_match_fifty_scalar_certifications() {
    let schema = schema(false);
    let rows = MemoryRows::new();
    let mut views = Vec::new();
    for n in 0..50 {
        let id = format!("member-{n}");
        rows.put("members", &schema.tables["members"], &member(&id, "busy", &format!("principal-{n}"), n * 7), None).unwrap();
        views.push(view(&id, n % 2 == 0));
    }
    for n in 1..=1200 {
        let row = message(&format!("message-{n}"), "busy", n, if n <= 200 { Value::Int(10) } else { Value::Null });
        rows.put("messages", &schema.tables["messages"], &row, None).unwrap();
    }
    for (id, sender, tombstone) in [("tombstoned", "sender", true), ("self-sent", "principal-0", false)] {
        let mut row = message(id, "busy", 1201, Value::Null);
        let Value::Row(fields) = &mut row else { unreachable!() };
        fields.insert("senderId".into(), Value::Id(sender.into()));
        fields.insert("tombstone".into(), Value::Bool(tombstone));
        rows.put("messages", &schema.tables["messages"], &row, None).unwrap();
    }
    let start = std::time::Instant::now();
    let mut batched = runner(&rows, &schema, "reader");
    let actual = batched.live_aggregate_batch("unread", &views).unwrap();
    let elapsed = start.elapsed();
    let mut scalar = runner(&rows, &schema, "reader");
    let expected: Vec<_> = views.iter().map(|row| scalar.live_aggregate("unread", row.clone()).unwrap()).collect();
    assert_eq!(actual, expected);
    assert_eq!(actual[0].as_ref().unwrap().field("value"), Ok(&Value::Int(1000)), "self and tombstone excluded");
    assert_eq!(actual[1].as_ref().unwrap().field("value"), Ok(&Value::Int(1001)), "self-send is unread for another member");
    assert_eq!(batched.rebuilt_source_rows, 1002, "one walk, with no expired candidates");
    assert_eq!(scalar.rebuilt_source_rows, 50100, "control actually executes the old repeated walk");
    assert!(actual.iter().all(|row| row.as_ref().unwrap().field("recountPending") == Ok(&Value::Bool(false))));
    eprintln!("50 members / 1002 live rows: batch {:?}; decoded {} instead of {}", elapsed, batched.rebuilt_source_rows, scalar.rebuilt_source_rows);
}

#[test]
fn capped_batch_admission_refuses_instead_of_certifying_zero() {
    let schema = schema(false);
    let rows = MemoryRows::new();
    rows.put("members", &schema.tables["members"], &member("a", "one", "alice", 0), None).unwrap();
    rows.put("messages", &schema.tables["messages"], &message("m", "one", 1, Value::Null), None).unwrap();
    let input = [view("a", false)];
    let mut control = runner(&rows, &schema, "alice");
    assert_eq!(control.live_aggregate_batch("unread", &input).unwrap()[0].as_ref().unwrap().field("value"), Ok(&Value::Int(1)));
    let mut capped = Runner::new(&rows, &schema, Context::new("alice", Default::default()).at(10),
        Meter::new(Ceilings { examined: 1, ..Ceilings::default() }, Cut::Cap), 0);
    assert!(matches!(capped.live_aggregate_batch("unread", &input),
        Err(RuntimeError::Bound { kind: MeterKind::Examined, actual: 2, ceiling: 1, .. })),
        "member lookup exhausts admission; a skipped walk cannot certify zero");
    assert_eq!(capped.rebuilt_source_rows, 0);
}

#[test]
fn batch_authorizes_each_member_and_parent_before_counting_and_rechecks_next_call() {
    let schema = schema(true);
    let rows = MemoryRows::new();
    let a = member("a", "one", "alice", 0);
    let b = member("b", "two", "bob", 0);
    rows.put("members", &schema.tables["members"], &a, None).unwrap();
    rows.put("members", &schema.tables["members"], &b, None).unwrap();
    for (id, parent) in [("m1", "one"), ("m2", "two")] {
        rows.put("messages", &schema.tables["messages"], &message(id, parent, 1, Value::Null), None).unwrap();
    }
    let views = [view("b", false), view("a", true), view("missing", false)];
    let mut r = runner(&rows, &schema, "alice");
    let result = r.live_aggregate_batch("unread", &views).unwrap();
    assert!(result[0].is_none() && result[2].is_none());
    assert_eq!(result[1].as_ref().unwrap().field("value"), Ok(&Value::Int(1)));
    assert_eq!(r.rebuilt_source_rows, 1, "the unauthorized parent was never scanned");
    drop(r);
    rows.delete("members", &schema.tables["members"], &a).unwrap();
    let mut r = runner(&rows, &schema, "alice");
    assert!(r.live_aggregate_batch("unread", &views).unwrap().iter().all(Option::is_none));
    assert_eq!(r.rebuilt_source_rows, 0);
}

#[test]
fn mixed_parents_and_expiry_recertify_without_using_stored_pending_or_counts() {
    let schema = schema(false);
    let rows = MemoryRows::new();
    let views = [view("a", true), view("b", false), view("c", false)];
    for (id, parent, mark) in [("a", "one", 0), ("b", "two", 1), ("c", "one", 1)] {
        rows.put("members", &schema.tables["members"], &member(id, parent, id, mark), None).unwrap();
    }
    for (id, parent, ordinal, until) in [("m1", "one", 1, Value::Null), ("m2", "one", 2, Value::Int(20)), ("m3", "two", 2, Value::Null)] {
        rows.put("messages", &schema.tables["messages"], &message(id, parent, ordinal, until), None).unwrap();
    }
    for (clock, counts) in [(10, [2, 1, 1]), (20, [1, 1, 0])] {
        let mut r = runner(&rows, &schema, "reader"); r.context.now = Some(clock);
        let result = r.live_aggregate_batch("unread", &views).unwrap();
        for (row, count) in result.iter().zip(counts) {
            assert_eq!(row.as_ref().unwrap().field("value"), Ok(&Value::Int(count)));
            assert_eq!(row.as_ref().unwrap().field("recountPending"), Ok(&Value::Bool(false)));
        }
    }
}

#[test]
fn batch_reserves_memory_and_charges_predicate_work_before_certifying() {
    let schema = schema(false);
    let rows = MemoryRows::new();
    let member = member("a", "one", "alice", 0);
    rows.put("members", &schema.tables["members"], &member, None).unwrap();
    rows.put("messages", &schema.tables["messages"], &message("m", "one", 1, Value::Null), None).unwrap();
    let mut bounded = runner(&rows, &schema, "alice"); bounded.meter.ceilings.heap_bytes = 1;
    assert!(matches!(bounded.live_aggregate_batch("unread", &[view("a", false)]), Err(RuntimeError::Bound { kind: MeterKind::HeapBytes, .. })));
    assert_eq!(bounded.rebuilt_source_rows, 0);
    for (kind, ceilings) in [
        (MeterKind::Examined, Ceilings { examined: 0, ..Ceilings::unbounded() }),
        (MeterKind::Steps, Ceilings { steps: 0, ..Ceilings::unbounded() }),
        (MeterKind::HeapBytes, Ceilings { heap_bytes: 0, ..Ceilings::unbounded() }),
    ] {
        let mut r = runner(&rows, &schema, "alice"); r.meter.ceilings = ceilings;
        assert!(matches!(r.certify_group(&schema.maintains[0], &Value::Id("one".into()), &mut [(0, member.clone(), 0)]),
            Err(RuntimeError::Bound { kind: actual, .. }) if actual == kind));
    }
}

#[test]
fn cold_basis_pages_preserve_live_counts_and_private_members() {
    for private in [false, true] {
        let schema = schema(private);
        let rows = MemoryRows::new();
        for (id, parent, principal, mark) in [("mine", "one", "reader", 75), ("peer", "two", "peer", 0)] {
            rows.put("members", &schema.tables["members"], &member(id, parent, principal, mark), None).unwrap();
        }
        for parent in ["one", "two"] {
            for n in 1..=96 {
                let until = match n % 3 { 0 => Value::Int(5), 1 => Value::Null, _ => Value::Int(20) };
                rows.put("messages", &schema.tables["messages"], &message(&format!("{parent}-{n}"), parent, n, until), None).unwrap();
            }
        }
        for pending in [false, true] {
            let input = [view("mine", pending), view("peer", pending)];
            let ordinary = runner(&rows, &schema, "reader").live_aggregate_batch("unread", &input).unwrap();
            let cold = runner(&rows, &schema, "reader").live_acquisition_batch("unread", &input).unwrap();
            assert_eq!(cold, ordinary);
            assert_eq!(cold[0].as_ref().unwrap().field("value"), Ok(&Value::Int(14)));
            if private { assert!(cold[1].is_none()); }
        }
    }
}

#[test]
fn cold_basis_falls_back_when_a_decoder_page_exceeds_available_heap() {
    let schema = schema(false);
    let rows = MemoryRows::new();
    rows.put("members", &schema.tables["members"], &member("mine", "one", "reader", 0), None).unwrap();
    for n in 1..=96 {
        rows.put("messages", &schema.tables["messages"], &message(&format!("m{n}"), "one", n, Value::Null), None).unwrap();
    }
    let ceiling = crate::rows::disclosed::decode_reservation(&schema.tables["messages"]) * 8;
    let mut ordinary = runner(&rows, &schema, "reader"); ordinary.meter.ceilings.heap_bytes = ceiling;
    let expected = ordinary.live_aggregate_batch("unread", &[view("mine", true)]).unwrap();
    let mut cold = runner(&rows, &schema, "reader"); cold.meter.ceilings.heap_bytes = ceiling;
    assert_eq!(cold.live_acquisition_batch("unread", &[view("mine", true)]).unwrap(), expected);
    assert_eq!(expected[0].as_ref().unwrap().field("value"), Ok(&Value::Int(96)));
}
