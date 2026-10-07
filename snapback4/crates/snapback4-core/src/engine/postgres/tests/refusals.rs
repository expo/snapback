//! Every physical upgrade shares the successful open's transaction.
use super::*;

fn connect() -> Client {
    Client::connect(&std::env::var("SNAPBACK4_EVAL_POSTGRES").expect("private test-postgres.sh database"), postgres::NoTls).unwrap()
}

// Full rows plus the physical schema, including indexes, constraints and defaults.
fn dump(client: &mut Client) -> Vec<(String, Vec<String>)> {
    let mut result = Vec::new();
    for (label, sql) in [
        ("columns", "SELECT row_to_json(c)::text FROM (SELECT table_name,column_name,ordinal_position,column_default,is_nullable,data_type,collation_name FROM information_schema.columns WHERE table_schema = current_schema() ORDER BY table_name,ordinal_position) c"),
        ("indexes", "SELECT indexdef FROM pg_indexes WHERE schemaname = current_schema() ORDER BY tablename,indexname"),
        ("constraints", "SELECT conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid) FROM pg_constraint WHERE connamespace = current_schema()::regnamespace ORDER BY conrelid::regclass::text,conname"),
    ] {
        result.push((label.into(), client.query(sql, &[]).unwrap().into_iter().map(|r| r.get(0)).collect()));
    }
    let tables = client.query("SELECT tablename FROM pg_tables WHERE schemaname = current_schema() ORDER BY tablename", &[]).unwrap();
    for table in tables {
        let name: String = table.get(0);
        let sql = format!("SELECT row_to_json(_rs_row.*)::text FROM \"{}\" _rs_row ORDER BY row_to_json(_rs_row.*)::text", name.replace('"', "\"\""));
        result.push((name, client.query(&sql, &[]).unwrap().into_iter().map(|r| r.get(0)).collect()));
    }
    result
}

fn legacy(client: &mut Client) {
    client.batch_execute("DROP TABLE _read_sessions; DROP TABLE _sequences; DROP TABLE _cap_counts;
        ALTER TABLE _backend DROP COLUMN through_shortened;
        CREATE INDEX _log_row_seq ON _log(seq);").unwrap();
}

#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn refused_opens_preserve_all_postgres_schema_and_rows() {
    for refusal in ["version", "schema", "generation", "changed_backend"] {
        let mut engine = authority_engine();
        let name: String = engine.store.client.query_one("SELECT current_schema()", &[]).unwrap().get(0);
        legacy(&mut engine.store.client);
        match refusal {
            "version" => engine.store.client.batch_execute("UPDATE _backend SET version = 'future'").unwrap(),
            "schema" => engine.store.client.batch_execute("UPDATE _backend SET schema = 'invalid json'").unwrap(),
            // This refusal happens after cap and contribution installation.
            "generation" => engine.store.client.batch_execute("UPDATE _backend SET generation = -1").unwrap(),
            "changed_backend" => {},
            _ => unreachable!(),
        }
        let before = dump(&mut engine.store.client);
        let result = if refusal == "changed_backend" {
            // Deterministically exercise the recheck after an intervening adoption.
            let mut client = connect();
            client.batch_execute(&format!("SET search_path = {name}, pg_catalog")).unwrap();
            let changed: Schema = serde_json::from_value(serde_json::json!({"tables": {
                "other": {"columns": {"id": "Id"}, "indexes": {"byId": {"components": [{"Column": "id"}], "unique": true}}, "rules": {"read": "Allow", "insert": "Allow", "update": "Allow", "delete": "Allow"}}
            }})).unwrap();
            PostgresEngine::attach(client, changed, BTreeMap::new(), None)
        } else { PostgresEngine::open(connect(), &name) };
        assert!(result.is_err(), "{refusal} must refuse");
        assert_eq!(dump(&mut engine.store.client), before, "{refusal} must leave all tables, indexes, columns and rows unchanged");
        engine.store.client.batch_execute(&format!("DROP SCHEMA {name} CASCADE")).unwrap();
    }
}

#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn refused_cap_rebuild_rolls_back_every_open_upgrade() {
    let bound = snapback4_lang::compile(&[("schema.q".into(), "table items:\n  until: time ?\n  expire at .until\n  cap 2\n  public\n".into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let schema: Schema = serde_json::from_str(&serde_json::to_string(&bound.schema).unwrap()).unwrap();
    let name = format!("sb4_eval_refused_caps_{:x}", crate::ids::seed());
    let mut engine = PostgresEngine::create(connect(), &name, schema, []).unwrap();
    legacy(&mut engine.store.client);
    engine.store.client.batch_execute("ALTER TABLE _backend DROP COLUMN generation;
        INSERT INTO r VALUES ('items','bad','invalid row JSON');").unwrap();
    let before = dump(&mut engine.store.client);
    let error = PostgresEngine::open(connect(), &name).err().expect("invalid legacy row must refuse cap adoption");
    assert_eq!(error.code(), "E_STORE");
    assert_eq!(dump(&mut engine.store.client), before);
    engine.store.client.batch_execute(&format!("DROP SCHEMA {name} CASCADE")).unwrap();
}
