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
