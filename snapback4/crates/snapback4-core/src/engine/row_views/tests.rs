use super::*;
use crate::{Context, Engine, Ceilings, Schema, Program, meter::{Meter, Cut}};
#[test]
fn expiry_walk_charges_internal_examined_and_steps_before_public_normalization() {
    let b = snapback4_lang::compile(&[("schema.q".into(), include_str!("../../../../snapback4-lang/tests/fixtures/row-keyed-view.q").into())]);
    assert!(b.diagnostics.is_empty());
    // Also builds with --features postgres, where the compiler's core is a separate crate instance.
    let schema: Schema = crate::json_codec::from_text(&crate::json_codec::to_text(&b.schema).unwrap()).unwrap();
    let programs: Vec<Program> = crate::json_codec::from_text(&crate::json_codec::to_text(&b.programs.into_iter().map(|p|p.program).collect::<Vec<_>>()).unwrap()).unwrap();
    let mut e = Engine::memory(schema, programs).unwrap();
    let member = object([("id",Value::Id("b".into())),("conversationId",Value::Id("c".into())),("principal",Value::Id("bob".into())),("readUpTo",Value::Int(0)),("joinedAt",Value::Int(0))]);
    let mut rows = vec![("members".into(), member.clone())];
    for n in 0..3 {
        rows.push(("messages".into(), object([("id",Value::Id(format!("m{n}"))),("conversationId",Value::Id("c".into())),("senderId",Value::Id("alice".into())),("ordinal",Value::Int(1)),("tombstone",Value::Bool(false)),("until",Value::Int(10))])));
    }
    e.seed_at(rows, 1).unwrap();
    let schema = e.schema().clone();
    let m = &schema.maintains[0];
    let k = m.row_key.as_ref().unwrap();
    let tx = e.store_mut().transaction().unwrap();
    let mut r = Runner::new(&tx, &schema, Context::system().at(10), Meter::new(Ceilings::default(),Cut::Abort), 0);
    let (n, complete, _) = r.view_scan(m, &member, None, &k.range_index("until"), Bounds { gt: Some(Value::Null), lte: Some(Value::Int(10)), ..Default::default() }, 8, false).unwrap();
    assert_eq!((n,complete), (3,true));
    assert_eq!(r.meter.used.examined, 4);
    assert!(r.meter.used.steps > 0);
    for (kind, ceilings) in [
        (MeterKind::Examined, Ceilings { examined: 2, ..Default::default() }),
        (MeterKind::Steps, Ceilings { steps: 1, ..Default::default() }),
    ] {
        let mut bounded = Runner::new(&tx, &schema, Context::system().at(10), Meter::new(ceilings,Cut::Abort), 0);
        let result = bounded.view_scan(m, &member, None, &k.range_index("until"), Bounds { gt: Some(Value::Null), lte: Some(Value::Int(10)), ..Default::default() }, 8, false);
        assert!(matches!(result, Err(RuntimeError::Bound { kind: actual, .. }) if actual == kind), "unmetered expiry walk: {result:?}");
    }
}

#[test]
fn member_materialization_is_precharged_and_its_transient_peak_survives_release() {
    let b = snapback4_lang::compile(&[("schema.q".into(), include_str!("../../../../snapback4-lang/tests/fixtures/row-keyed-view.q").replace("  expire at .until\n", ""))]);
    assert!(b.diagnostics.is_empty());
    let schema: Schema = crate::json_codec::from_text(&crate::json_codec::to_text(&b.schema).unwrap()).unwrap();
    let mut e = Engine::memory(schema, vec![]).unwrap();
    e.seed_at([("members".into(), object([("id",Value::Id("b".into())),("conversationId",Value::Id("c".into())),("principal",Value::Id("bob".into())),("readUpTo",Value::Int(0)),("joinedAt",Value::Int(0))]))], 1).unwrap();
    // Simulate a newly adopted default absent from the stored row. Decode is
    // small; materializing the default alone must exceed the smaller allowance.
    let row = e.store().rows("unread").unwrap().pop().unwrap();
    let mut schema = e.schema().clone();
    let table = schema.tables.get_mut("members").unwrap();
    table.columns.insert("note".into(), crate::schema::ColumnType::Text { max: 2 << 20 });
    table.defaults.insert("note".into(), crate::schema::ColumnDefault::Literal(Value::String("x".repeat(2 << 20))));
    let m = &schema.maintains[0];
    let tx = e.store_mut().transaction().unwrap();
    for allowance in [1 << 20, 16 << 20] {
        let mut r = Runner::new(&tx, &schema, Context::new("bob", Default::default()).at(1), Meter::new(Ceilings { heap_bytes: allowance, ..Default::default() }, Cut::Cap), 0);
        let result = r.live_row_view(m, row.clone());
        if allowance == 1 << 20 {
            assert!(matches!(result, Err(RuntimeError::Bound { kind: MeterKind::HeapBytes, .. })), "{result:?}");
            assert!(r.meter.capped_at.is_some());
        } else {
            assert!(result.unwrap().is_some());
        }
        assert!(r.meter.heap_peak > 2 << 20);
        assert_eq!(r.meter.used.heap_bytes, 0);
    }
}

#[test]
fn expiry_correction_charges_one_public_examined_and_step_even_when_empty() {
    let b = snapback4_lang::compile(&[("schema.q".into(), include_str!("../../../../snapback4-lang/tests/fixtures/row-keyed-view.q").into())]);
    assert!(b.diagnostics.is_empty());
    let schema: Schema = crate::json_codec::from_text(&crate::json_codec::to_text(&b.schema).unwrap()).unwrap();
    let mut e = Engine::memory(schema, vec![]).unwrap();
    e.seed_at([("members".into(), object([("id",Value::Id("a".into())),("conversationId",Value::Id("c".into())),("principal",Value::Id("alice".into())),("readUpTo",Value::Int(0)),("joinedAt",Value::Int(0))]))], 1).unwrap();
    let row = e.store().rows("unread").unwrap().pop().unwrap();
    let schema = e.schema().clone();
    let m = &schema.maintains[0];
    let tx = e.store_mut().transaction().unwrap();
    let mut r = Runner::new(&tx, &schema, Context::new("alice", Default::default()).at(10), Meter::new(Ceilings::default(), Cut::Cap), 0);
    assert!(r.live_row_view(m, row).unwrap().is_some());
    // One member fetch, one normalized correction, one future-expiry head.
    // Even an empty correction pays its public step; deleting either charge fails.
    assert_eq!(r.meter.used.examined, 3);
    assert_eq!(r.meter.used.steps, 1);
}
