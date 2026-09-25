use super::runner::Runner;
#[test]
fn unknown_negation_does_not_authorize_delivery() {
    let b = snapback4_lang::compile(&[("schema.q".into(), "table blocked:\n  principal: principal\n  unique principal\n  online only\ntable notes:\n  owner: principal\n  secret: int default 0 written by .owner\n  read <- not exists blocked[principal = viewer]\n  online only\n".into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let schema: crate::schema::Schema = serde_json::from_value(serde_json::to_value(&b.schema).unwrap()).unwrap();
    let tx = crate::rows::MemoryRows::new();
    let mut runner = Runner::new(&tx, &schema, crate::Context::new("alice",Default::default()), crate::meter::Meter::new(crate::Ceilings::default(),crate::meter::Cut::Abort), 1);
    runner.device = true;
    let row = crate::wire::row_from_json(&schema.tables["notes"], &serde_json::json!({"id":"n","owner":"bob"})).unwrap();
    assert!(!runner.field_owner_can_read(&schema.tables["notes"].rules.read,"bob",&row).unwrap());
}
