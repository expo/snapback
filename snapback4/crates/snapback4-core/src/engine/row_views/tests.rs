use super::*;
use crate::{Context, Engine, Ceilings, Schema, Program, meter::{Meter, Cut}};
#[test]
fn live_basis_walk_charges_only_live_inputs_on_its_internal_ledger() {
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
    for n in 0..2 {
        rows.push(("messages".into(), object([("id",Value::Id(format!("live{n}"))),("conversationId",Value::Id("c".into())),("senderId",Value::Id("alice".into())),("ordinal",Value::Int(1)),("tombstone",Value::Bool(false)),("until",Value::Null)])));
    }
    e.seed_at(rows, 1).unwrap();
    let schema = e.schema().clone();
    let m = &schema.maintains[0];
    let tx = e.store_mut().transaction().unwrap();
    let mut r = Runner::new(&tx, &schema, Context::system().at(10), Meter::new(Ceilings::default(),Cut::Abort), 0);
    let (n, complete, _) = r.live_basis_scan(m, &member, None, 8).unwrap();
    assert_eq!((n,complete), (2,true));
    assert_eq!(r.meter.used.examined, 4);
    assert!(r.meter.used.steps > 0);
    for (kind, ceilings) in [
        (MeterKind::Examined, Ceilings { examined: 2, ..Default::default() }),
        (MeterKind::Steps, Ceilings { steps: 1, ..Default::default() }),
    ] {
        let mut bounded = Runner::new(&tx, &schema, Context::system().at(10), Meter::new(ceilings,Cut::Abort), 0);
        let result = bounded.live_basis_scan(m, &member, None, 8);
        assert!(matches!(result, Err(RuntimeError::Bound { kind: actual, .. }) if actual == kind), "unmetered live walk: {result:?}");
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
    for allowance in [1 << 20, 64 << 20] {
        let mut r = Runner::new(&tx, &schema, Context::new("bob", Default::default()).at(1), Meter::new(Ceilings { heap_bytes: allowance, ..Default::default() }, Cut::Cap), 0);
        let result = r.live_row_view(m, row.clone());
        if allowance == 1 << 20 {
            assert!(matches!(result, Err(RuntimeError::Bound { kind: MeterKind::HeapBytes, .. })), "{result:?}");
            assert!(r.meter.capped_at.is_some());
        } else {
            assert!(result.unwrap().is_some());
            let mut materialized=Runner::new(&tx,&schema,Context::new("bob",Default::default()).at(1),Meter::new(Ceilings {heap_bytes:allowance,..Default::default()},Cut::Cap),0);
            assert!(materialized.row_view_member_image(m,&row).unwrap().is_some());
            assert!(materialized.meter.used.heap_bytes>2<<20,"authorized materialization must be priced after the fixed scratch is released");
        }
        assert!(r.meter.heap_peak > 2 << 20);
        assert_eq!(r.meter.used.heap_bytes, 0);
    }
}

#[test]
fn live_basis_reservation_is_identical_for_pending_and_zero_expired_reads() {
    let b = snapback4_lang::compile(&[("schema.q".into(), include_str!("../../../../snapback4-lang/tests/fixtures/row-keyed-view.q").into())]);
    assert!(b.diagnostics.is_empty());
    let schema: Schema = crate::json_codec::from_text(&crate::json_codec::to_text(&b.schema).unwrap()).unwrap();
    let mut e = Engine::memory(schema, vec![]).unwrap();
    e.seed_at([("members".into(), object([("id",Value::Id("a".into())),("conversationId",Value::Id("c".into())),("principal",Value::Id("alice".into())),("readUpTo",Value::Int(0)),("joinedAt",Value::Int(0))]))], 1).unwrap();
    e.seed_at((0..1200).map(|n|("messages".into(),object([("id",Value::Id(format!("live{n}"))),("conversationId",Value::Id("c".into())),("senderId",Value::Id("bob".into())),("ordinal",Value::Int(1)),("tombstone",Value::Bool(false)),("until",Value::Null)]))),1).unwrap();
    let row = e.store().rows("unread").unwrap().pop().unwrap();
    let schema = e.schema().clone();
    let m = &schema.maintains[0];
    let tx = e.store_mut().transaction().unwrap();
    let mut meters=Vec::new();
    for pending in [false,true] {
        let mut image=row.as_object().unwrap().clone();
        image.insert("recountPending".into(),Value::Bool(pending));
        let mut r=Runner::new(&tx,&schema,Context::new("alice",Default::default()).at(10),Meter::new(Ceilings::default(),Cut::Cap),0);
        assert!(r.live_row_view(m,Value::Row(image.into())).unwrap().is_some());
        assert_eq!(r.timeline_pending,pending);
        // One authorized member reservation, one live-basis reservation.
        assert_eq!(r.meter.used.examined,2);
        assert_eq!(r.meter.used.steps,1);
        meters.push((r.meter.used,r.meter.heap_peak,r.meter.capped_at));
    }
    assert_eq!(meters[0],meters[1]);
}
