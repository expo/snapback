use super::*;
use crate::{Context, meter::{Ceilings, Cut, Meter}, rows::{MemoryRows, Rows}};

fn fixture() -> (crate::Schema, MemoryRows, Value) {
    let source = include_str!("../../../../snapback4-device/tests/unread_range/schema.q");
    let b = snapback4_lang::compile(&[("range.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let schema: crate::Schema = crate::json_codec::from_text(&crate::json_codec::to_text(&b.schema).unwrap()).unwrap();
    let rows = MemoryRows::new();
    let member = object([("id",Value::Id("b".into())),("principal",Value::Id("bob".into())),("conversationId",Value::Id("c".into())),("readUpTo",Value::Int(0)),("joinedAt",Value::Int(0))]);
    rows.put("members",&schema.tables["members"],&member,None).unwrap();
    let view = object([("id",Value::Id("b".into())),("member",Value::Id("b".into())),("principal",Value::Id("bob".into())),("value",Value::Int(0)),("recountPending",Value::Bool(false))]);
    rows.put("unread",&schema.tables["unread"],&view,None).unwrap();
    (schema,rows,member)
}
#[test]
fn pending_value_never_decides_a_probe_and_abort_keeps_its_host_policy() {
    let (schema, rows, _) = fixture();
    for device in [false,true] {
        let mut r = Runner::new(&rows,&schema,Context::new("bob",Default::default()).at(1),Meter::new(Ceilings::default(),Cut::Abort),0);
        r.device=device;
        let error=r.pending_view_read().unwrap_err();
        assert!(if device {matches!(error,RuntimeError::Prediction(_))}else{matches!(error,RuntimeError::Structural{code:"E_VIEW_KEY",..})});
    }
    let mut r=Runner::new(&rows,&schema,Context::new("bob",Default::default()).at(1),Meter::new(Ceilings::default(),Cut::Cap),0);
    r.device=true;
    r.provisional_rows.insert(("members".into(),"b".into()));
    let result=r.authorized_scratch(1<<20,&[],|r,scope| r.probe_witness(scope,"unread","byId",&[Value::Id("b".into())],&[("value".into(),Value::Int(0))],false));
    // Witness evaluation uses an aborting authorization scope on a device.
    assert!(matches!(result,Err(RuntimeError::Prediction(_))),"{result:?}");
}
#[test]
fn a_nonuniform_source_stays_pending_even_if_a_synthetic_image_would_pass() {
    let (mut schema,rows,member)=fixture();
    // Admission rejects this rule; retain the runtime guard for raw IR callers.
    let b=snapback4_lang::compile(&[("rule.q".into(),"table t:\n  senderId: principal ?\n  read <- .senderId != viewer\n".into())]);
    assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    schema.tables.get_mut("messages").unwrap().rules.read=crate::json_codec::from_text(&crate::json_codec::to_text(&b.schema.tables["t"].rules.read).unwrap()).unwrap();
    let mut r=Runner::new(&rows,&schema,Context::new("bob",Default::default()).at(1),Meter::new(Ceilings::default(),Cut::Cap),0);
    r.device=true;
    r.provisional_rows.insert(("members".into(),"b".into()));
    assert!(!r.row_view_source_readable(&schema.maintains[0],&member).unwrap());
}
