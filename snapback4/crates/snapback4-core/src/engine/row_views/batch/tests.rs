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
