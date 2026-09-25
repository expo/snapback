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

#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn ordinary_payloads_adopt_across_multiple_pages() {
    for (count,bytes) in [(1,1_000_000),(5,512 << 10),(96,4096),(600,65_536)] {
        let source=format!("table receipts:\n  principal: principal\n  payload: text <={}\n  expiresAt: time ?\n  expire at .expiresAt\n  read <- .principal = viewer\nview counts: count receipts by .principal\nquery count():\n  return counts[viewer]\n", if count == 5 { 2 << 20 } else { bytes.max(65_536) });
        let bound=snapback4_lang::compile(&[("schema.q".into(),source.into())]);
        assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
        let connection=std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap();
        let schema: Schema=serde_json::from_str(&serde_json::to_string(&bound.schema).unwrap()).unwrap();
        let programs:Vec<Program>=bound.programs.iter().map(|p|serde_json::from_str(&serde_json::to_string(&p.program).unwrap()).unwrap()).collect();
        let name=format!("sb4_eval_q_payload_{:x}",crate::ids::seed());
        let mut engine=PostgresEngine::create(Client::connect(&connection,postgres::NoTls).unwrap(),&name,schema,programs).unwrap();
        engine.seed_at((0..count).map(|n|("receipts".into(),object([
            ("id",Value::Id(format!("r{n:04}"))),("principal",Value::Id("alice".into())),
            ("payload",Value::String("x".repeat(bytes))),
            ("expiresAt",match n%3 {0=>Value::Int(1000),1=>Value::Int(100),_=>Value::Null}),
        ]))),0).unwrap();
        let mut legacy=engine.schema.clone();
        let index="$contribution:counts";
        legacy.tables.get_mut("receipts").unwrap().indexes.get_mut(index).unwrap().components.truncate(1);
        let tx=engine.store.transaction(Some(WriteMode::Serialized)).unwrap();
        tx.execute("DELETE FROM i WHERE t=$1 AND ix=$2",&[&"receipts",&index]).unwrap();
        let mut bounds=Bounds::default();
        loop {
            let rows=tx.scan("receipts","byId",&[],&bounds,Dir::Asc,32).unwrap();
            if rows.is_empty() {break;}
            for (row,key) in rows {
                let id=row.field("id").unwrap().as_str().unwrap();
                for old in crate::rows::index_keys(&legacy.tables["receipts"].indexes[index],&row,id) {
                    tx.execute("INSERT INTO i(t,ix,k,id) VALUES($1,$2,$3,$4)",&[&"receipts",&index,&old,&id]).unwrap();
                }
                bounds.after=crate::key::decode(&key);
            }
        }
        tx.execute("UPDATE _backend SET schema=$1",&[&canonical_json(&legacy)]).unwrap();
        tx.commit().unwrap(); drop(engine);
        let upgraded=PostgresEngine::open(Client::connect(&connection,postgres::NoTls).unwrap(),&name);
        if let Err(error)=&upgraded {
            Client::connect(&connection,postgres::NoTls).unwrap().batch_execute(&format!("DROP SCHEMA {name} CASCADE")).unwrap();
            panic!("rows={count} payload={bytes}: {error:?}");
        }
        let mut engine=upgraded.unwrap();
        assert_eq!(engine.generation(),2);
        if bytes <= 65_536 {
            // Large source images can still hit this adapter's separate,
            // unchanged query-scan bound. This regression qualifies adoption.
            let result=engine.query("count",Context::new("alice",BTreeMap::new()).at(100)).unwrap();
            assert!(result.complete,"{result:?}");
            let expired=(count+1)/3;
            assert_eq!(result.data,Value::Int(count-expired));
            assert_eq!(result.metered.examined,expired as u64+2);
        }
        drop(engine);
        let mut engine=PostgresEngine::open(Client::connect(&connection,postgres::NoTls).unwrap(),&name).unwrap();
        assert_eq!(engine.generation(),2,"a successful upgrade is not retried");
        let tx=engine.store.transaction(None).unwrap();
        assert_eq!(tx.count_prefix("receipts",index,&[],1000).unwrap(),count as u64);
        let mut bounds=Bounds::default();
        for _ in 0..count {
            let (row,key)=tx.scan("receipts",index,&[],&bounds,Dir::Asc,1).unwrap().remove(0);
            assert_eq!(row.field("payload").unwrap().as_str().unwrap().len(),bytes);
            let id=row.field("id").unwrap().as_str().unwrap();
            assert_eq!(crate::rows::stored_index_keys(&engine.schema.tables["receipts"],
                &engine.schema.tables["receipts"].indexes[index],&row,id),vec![key.clone()]);
            bounds.after=crate::key::decode(&key);
        }
        let physical=tx.scan("counts","byId",&[],&Bounds::default(),Dir::Asc,1).unwrap();
        assert_eq!(physical[0].0.field("value").unwrap(),&Value::Int(count));
        tx.rollback().unwrap();
        engine.store.client.batch_execute(&format!("DROP SCHEMA {name} CASCADE")).unwrap();
        println!("POSTGRES_ADOPTION rows={count} payload={bytes} generation=2 rows_and_keys_verified=true");
    }
}
