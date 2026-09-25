use super::*;
use crate::rows::{Bounds, Dir};
#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn expiry_counts_and_041_upgrade_match_sqlite() {
    let source=include_str!("../../../../../snapback4-lang/tests/fixtures/expiring-counts.q");
    let bound=snapback4_lang::compile(&[("schema.q".into(),source.into())]);
    assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
    let schema: Schema=serde_json::from_str(&serde_json::to_string(&bound.schema).unwrap()).unwrap();
    let programs:Vec<Program>=bound.programs.iter().map(|p|serde_json::from_str(&serde_json::to_string(&p.program).unwrap()).unwrap()).collect();
    let connection=std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap();
    let client=Client::connect(&connection,postgres::NoTls).unwrap();
    let name=format!("sb4_eval_q_{:x}",crate::ids::seed());
    let mut engine=PostgresEngine::create(client,&name,schema,programs).unwrap();
    let rows=(0..3).map(|n|("receipts".into(),object([("id",Value::Id(format!("r{n}"))),("chat",Value::Id("chat".into())),("principal",Value::Id("alice".into())),("state",Value::Int(0)),("visible",Value::Bool(true)),("weight",Value::Int(n-1)),("at",Value::Int(0)),("expiresAt",match n {0=>Value::Int(100),1=>Value::Int(1000),_=>Value::Null})])));
    engine.seed_at(rows,0).unwrap();
    let query=|engine:&mut PostgresEngine|engine.query("unread",Context::new("alice",BTreeMap::new()).at(100)).unwrap();
    assert_eq!(query(&mut engine).data,Value::Int(2));
    assert_eq!(query(&mut engine).metered.examined,3);
    let mut legacy=engine.schema.clone();
    for table in legacy.tables.values_mut() {for index in table.indexes.values_mut() {
        if matches!(index.components.first(),Some(crate::schema::IndexComponent::Contribution(_))) {index.components.truncate(1);}
    }}
    let tx=engine.store.transaction(Some(WriteMode::Serialized)).unwrap();
    for m in &legacy.maintains {
        let index=m.contribution_index();
        tx.execute("DELETE FROM i WHERE t=$1 AND ix=$2",&[&m.source,&index]).unwrap();
        for (source,_) in tx.scan(&m.source,"byId",&[],&Bounds::default(),Dir::Asc,10).unwrap() {
            let id=source.field("id").unwrap().as_str().unwrap();
            for key in crate::rows::index_keys(&legacy.tables[&m.source].indexes[&index],&source,id) {
                tx.execute("INSERT INTO i(t,ix,k,id) VALUES($1,$2,$3,$4)",&[&m.source,&index,&key,&id]).unwrap();
            }
        }

    }
    tx.execute("UPDATE _backend SET schema=$1",&[&canonical_json(&legacy)]).unwrap();
    tx.commit().unwrap(); drop(engine);
    let mut engine=PostgresEngine::open(Client::connect(&connection,postgres::NoTls).unwrap(),&name).unwrap();
    assert_eq!(engine.generation(),2);
    assert_eq!(query(&mut engine).data,Value::Int(2));
    assert_eq!(query(&mut engine).metered.examined,3);
    let tx=engine.store.transaction(None).unwrap();
    let group=tx.scan("unreadCounts","byId",&[],&Bounds::default(),Dir::Asc,1).unwrap().remove(0).0;
    assert_eq!(group.field("value").unwrap(),&Value::Int(3));
    tx.rollback().unwrap(); drop(engine);
    let mut engine=PostgresEngine::open(Client::connect(&connection,postgres::NoTls).unwrap(),&name).unwrap();
    assert_eq!(engine.generation(),2);
    engine.store.client.batch_execute(&format!("DROP SCHEMA {name} CASCADE")).unwrap();
}
