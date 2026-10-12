//! The same server-generated mixed-rule pages feed core, both device stores and wasm.
#[path = "meter.rs"]
mod meter;
use snapback4_core::{partition::{SnapshotPage, StreamPage}, schema::Schema, value::{Value, object}};

pub struct Fixture {
    pub schema: Schema,
    pub stream: StreamPage,
    pub snapshots: Vec<SnapshotPage>,
}

// Quarry refuses this mixed public audience. Construct it only for the
// defensive serving test, after installing the ordinarily admitted schema.
pub fn mixed_acquisition(hidden: usize, readable: usize, deleted_selected: bool) -> Fixture {
    use snapback4_core::{partition, schema::{Horizon, RuleExpr, RuleTerm}};
    let mut schema = meter::schema();
    schema.tables.remove("messages");
    schema.tables.get_mut("writes").unwrap().columns.insert("owner".into(), snapback4_core::schema::ColumnType::Principal);
    schema.tables.get_mut("writes").unwrap().sync.as_mut().unwrap().horizon = Some(Horizon { last: 2, by: "byBucket".into() });
    let mut engine = snapback4_core::Engine::memory(schema.clone(), []).unwrap();
    let row = |name: &str, bucket, body: &str| object([("id", Value::Id(name.into())), ("bucket", Value::Int(bucket)), ("body", Value::String(body.into())), ("owner", Value::Id(body.into()))]);
    let mut rows: Vec<_> = (0..readable).map(|n| ("writes".into(), row(&format!("r{n}"), n as i64, "bob"))).collect();
    rows.extend((0..hidden).map(|n| ("writes".into(), row(&format!("h{n}"), 100 + n as i64, "alice"))));
    if deleted_selected { rows.push(("writes".into(), row("deleted", 999, "bob"))); }
    engine.seed_at(rows.clone(), 1).unwrap();
    let table = schema.tables.get_mut("writes").unwrap();
    table.rules.read = RuleExpr::Eq(RuleTerm::Field("owner".into()), RuleTerm::Viewer);
    assert!(!snapback4_core::schema::validate(&schema).is_empty(), "this mixed audience is not admitted");
    let tx = engine.store_mut().transaction().unwrap();
    for (ord, (_, row)) in rows.iter().enumerate() {
        tx.append_log("g:writes:[]", 1, ord as u32, "writes", "put", row.field("id").unwrap().as_str().unwrap(), Some(&snapback4_core::value::canonical_json(row))).unwrap();
    }
    tx.record_commit(2, 2, "join", "bob", "mutation", &[], 0).unwrap();
    tx.append_log("p:bob", 2, 0, "writes", "join", "[]", Some(&snapback4_core::value::canonical_json(&object([("expiresAt", Value::Null)])))).unwrap();
    if deleted_selected { tx.delete("writes", &schema.tables["writes"], &row("deleted", 999, "bob")).unwrap(); }
    let stream = partition::stream(&tx, &schema, "bob", 1, 100, 3).unwrap();
    let mut after = None; let mut snapshots = Vec::new();
    loop {
        let page = partition::snapshot_page(&tx, &schema, "bob", after, 1, 3).unwrap();
        after = page.next.clone(); snapshots.push(page);
        if after.is_none() { break; }
    }
    Fixture { schema, stream, snapshots }
}


/// A real group audience for the raw ledger renewal fixtures. Public and
/// column-only audiences deliberately ignore historical membership joins.
pub fn roster_schema() -> Schema {
    use snapback4_core::schema::*;
    let mut schema = meter::schema();
    schema.tables.remove("messages");
    let probe = RuleExpr::Exists { table: "staff".into(), index: "byPerson".into(), key: vec![RuleTerm::Viewer],
        provenance: snapback4_core::ir::KeyProvenance::Shape, equalities: Vec::new() };
    let mut staff = schema.tables["writes"].clone();
    staff.columns = std::collections::BTreeMap::from([("id".into(), ColumnType::Id), ("person".into(), ColumnType::Principal),
        ("until".into(), ColumnType::Optional(Box::new(ColumnType::Time)))]);
    staff.indexes = std::collections::BTreeMap::from([("byId".into(), Index::of(&["id"], true)),
        ("byPerson".into(), Index::of(&["person"], true)), ("byExpiry".into(), Index::of(&["until", "id"], false))]);
    staff.rules.read = RuleExpr::Eq(RuleTerm::Field("person".into()), RuleTerm::Viewer);
    staff.rules.insert = probe.clone();
    staff.constraints = vec![Constraint::Immutable { fields: vec!["person".into()] }];
    staff.expire = Some("until".into());
    staff.sync = Some(Sync::single(Audience::Column("person".into()), None));
    schema.tables.insert("staff".into(), staff);
    let writes = schema.tables.get_mut("writes").unwrap();
    writes.rules.read = probe;
    writes.sync = Some(Sync::single(Audience::Target { table: "staff".into(), principal: "person".into(), prefix: Vec::new() },
        Some(Horizon { last: 2, by: "byBucket".into() })));
    schema
}
