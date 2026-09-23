use super::*;
use crate::{authority::{AuthorityTransaction, test_cases}, rows::{Rows, PrefetchRequest}, schema::Index, value::object};

#[test]
fn maintained_columns_are_outside_postgres_evaluation() {
    let bound = snapback4_lang::compile(&[("schema.q".into(), include_str!("../../../../snapback4-lang/tests/fixtures/maintained-columns.q").into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let schema: Schema = serde_json::from_str(&serde_json::to_string(&bound.schema).unwrap()).unwrap();
    let mut private_only = schema.clone();
    for table in private_only.tables.values_mut() { table.maintained.clear(); }
    for schema in [schema.clone(), schema.public_projection(), private_only] {
        let error = supported(&schema, &BTreeMap::new()).unwrap_err();
        assert_eq!(error.code(), "E_POSTGRES_MAINTAINED_COLUMN", "{error}");
        assert!(error.to_string().contains("Postgres evaluation"));
        assert!(!error.to_string().contains("$column:"));
    }
}

#[test]
fn postgres_evaluation_currently_admits_recorded_fields() {
    let recorded = include_str!("../../../../snapback4-lang/tests/fixtures/recorded-attribution.q");
    for source in [recorded] {
        let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let schema: Schema = serde_json::from_str(&serde_json::to_string(&bound.schema).unwrap()).unwrap();
        let programs = bound.programs.into_iter().map(|p| (p.program.name.clone(), serde_json::from_str(&serde_json::to_string(&p.program).unwrap()).unwrap())).collect();
        supported(&schema, &programs).unwrap();
    }
}

fn engine() -> PostgresEngine {
    let schema: Schema = serde_json::from_value(serde_json::json!({"tables": {
        "items": {"columns": {"id": "Id", "key": {"Optional": {"Text": {"max": 100}}}},
            "indexes": {"byId": {"components": [{"Column": "id"}], "unique": true},
                        "byKey": {"components": [{"Column": "key"}], "unique": false}},
            "rules": {"read": "Allow", "insert": "Allow", "update": "Allow", "delete": "Allow"}}
    }})).unwrap();
    let client = Client::connect(&std::env::var("SNAPBACK4_EVAL_POSTGRES").expect("private test-postgres.sh database"), postgres::NoTls).unwrap();
    PostgresEngine::create(client, &format!("sb4_eval_cache_{:x}", crate::ids::seed()), schema, []).unwrap()
}
fn row(id: &str, key: Value) -> Value { object([("id", Value::Id(id.into())), ("key", key)]) }
fn gets(table: &str) -> Vec<PrefetchRequest> {
    (0..8).map(|i| PrefetchRequest::Get { table: table.into(), id: format!("r{i}") }).collect()
}

fn authority_engine() -> PostgresEngine {
    let schema = Schema::default();
    let client = Client::connect(&std::env::var("SNAPBACK4_EVAL_POSTGRES").expect("private test-postgres.sh database"), postgres::NoTls).unwrap();
    PostgresEngine::create(client, &format!("sb4_eval_authority_{:x}", crate::ids::seed()), schema, []).unwrap()
}

fn seed_authority(engine: &mut PostgresEngine) {
    let tx = engine.store.transaction(Some(WriteMode::Serialized)).unwrap();
    for fact in test_cases::generations() {
        tx.execute("INSERT INTO _principal_generations(principal,generation) VALUES ($1,$2)", &[&fact.0, &fact.1]).unwrap();
    }
    for fact in test_cases::sessions() {
        tx.execute(
            "INSERT INTO _sessions(token_digest,principal,kind,created_at,expires_at,family) VALUES ($1,$2,$3,$4,$5,$6)",
            &[&fact.digest, &fact.principal, &fact.kind, &fact.created_at, &fact.expires_at, &fact.family],
        ).unwrap();
    }
    for fact in test_cases::work() {
        tx.execute(
            "INSERT INTO _requests(id,name,args,principal,at,state,claimed_by,session_digest,lease_until,deadline,family,principal_generation,admitted_expires_at,service_generation) VALUES ($1,'test','{}',$2,1,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
            &[&fact.id, &fact.principal, &fact.state, &fact.claimed_by, &fact.session_digest, &fact.lease_until, &fact.deadline, &fact.family, &fact.generation, &fact.admitted_expires_at, &fact.service_generation],
        ).unwrap();
    }
    tx.commit().unwrap();
}

#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn shared_authority_facts_map_on_postgres() {
    let mut engine = authority_engine();
    seed_authority(&mut engine);
    let tx = engine.store.transaction(None).unwrap();
    test_cases::assert_adapter_facts(&tx);
    tx.rollback().unwrap();
}

#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn shared_authority_policy_cases_run_on_postgres() {
    let mut engine = authority_engine();
    seed_authority(&mut engine);
    let tx = engine.store.transaction(None).unwrap();
    test_cases::assert_policy_cases(&tx);
    tx.rollback().unwrap();
}

#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn authority_invalidations_require_and_use_the_serialized_head_fence() {
    let mut engine = authority_engine();
    seed_authority(&mut engine);
    for mode in [None, Some(WriteMode::Serializable)] {
        let tx = engine.store.transaction(mode).unwrap();
        for error in [
            tx.invalidate_session("exact-a").unwrap_err(),
            tx.invalidate_family("alice", "revoke-family").unwrap_err(),
        ] {
            assert!(error.to_string().contains("serialized shared-head fence"));
        }
        assert!(tx.session_by_digest("exact-a").unwrap().is_some());
        assert!(tx.session_by_digest("exact-b").unwrap().is_some());
        tx.rollback().unwrap();
    }
    let tx = engine.store.transaction(Some(WriteMode::Serialized)).unwrap();
    test_cases::assert_invalidations(&tx);
    tx.commit().unwrap();
    let tx = engine.store.transaction(None).unwrap();
    assert!(tx.session_by_digest("exact-a").unwrap().is_none());
    assert!(tx.session_by_digest("exact-b").unwrap().is_none());
    tx.rollback().unwrap();
}

#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn authority_rollback_reopen_and_repeatable_read_snapshot_are_real() {
    let mut engine = authority_engine();
    seed_authority(&mut engine);
    let name: String = engine.store.client.query_one("SELECT current_schema()", &[]).unwrap().get(0);

    let tx = engine.store.transaction(Some(WriteMode::Serialized)).unwrap();
    tx.execute(
        "INSERT INTO _sessions(token_digest,principal,kind,created_at,expires_at,family) VALUES ('rolled-back','alice','member',1,700,'family-root')",
        &[],
    ).unwrap();
    tx.rollback().unwrap();

    let reader = engine.store.transaction(None).unwrap();
    assert_eq!(reader.latest_live_family_member("alice", "family-root", 100).unwrap().unwrap().digest, "base-new");
    let mut writer = PostgresEngine::open(
        Client::connect(&std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(), postgres::NoTls).unwrap(),
        &name,
    ).unwrap();
    let tx = writer.store.transaction(Some(WriteMode::Serialized)).unwrap();
    tx.execute(
        "INSERT INTO _sessions(token_digest,principal,kind,created_at,expires_at,family) VALUES ('snapshot-new','alice','member',1,700,'family-root')",
        &[],
    ).unwrap();
    tx.commit().unwrap();
    assert_eq!(reader.latest_live_family_member("alice", "family-root", 100).unwrap().unwrap().digest, "base-new");
    assert!(reader.session_by_digest("rolled-back").unwrap().is_none());
    reader.rollback().unwrap();
    drop(engine);

    let mut reopened = PostgresEngine::open(
        Client::connect(&std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(), postgres::NoTls).unwrap(),
        &name,
    ).unwrap();
    let tx = reopened.store.transaction(None).unwrap();
    assert_eq!(tx.latest_live_family_member("alice", "family-root", 100).unwrap().unwrap().digest, "snapshot-new");
    assert!(tx.session_by_digest("rolled-back").unwrap().is_none());
    tx.rollback().unwrap();
}

#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn exact_batches_misses_order_nulls_writes_and_savepoint_rollback() {
    let mut engine = engine();
    let table = engine.schema.tables["items"].clone();
    let tx = engine.store.transaction(Some(WriteMode::Serialized)).unwrap();
    tx.put("items", &table, &row("r2", Value::String("same".into())), None).unwrap();
    tx.put("items", &table, &row("r1", Value::String("same".into())), None).unwrap();
    tx.put("items", &table, &row("r0", Value::Null), None).unwrap();
    tx.prefetch(&gets("items"));
    let before = tx.calls.get();
    assert_eq!(tx.get("items", "r0").unwrap(), Some(row("r0", Value::Null)));
    assert_eq!(tx.get("items", "r7").unwrap(), None);
    assert_eq!(tx.calls.get(), before, "both hits and misses are cached");
    let index = Index::of(&["key"], false);
    let keys = [Value::Null, Value::String("same".into()), Value::String("absent".into()), Value::String("x".into())];
    tx.prefetch(&keys.iter().map(|key| PrefetchRequest::Lookup { table: "items".into(), index: "byKey".into(), key: vec![key.clone()] }).collect::<Vec<_>>());
    let before = tx.calls.get();
    assert_eq!(tx.lookup("items", "byKey", &index, &keys[0..1]).unwrap(), Some(row("r0", Value::Null)));
    assert_eq!(tx.lookup("items", "byKey", &index, &keys[1..2]).unwrap(), Some(row("r1", keys[1].clone())), "first by full stored key");
    assert_eq!(tx.lookup("items", "byKey", &index, &keys[2..3]).unwrap(), None);
    assert_eq!(tx.calls.get(), before);
    tx.batch("SAVEPOINT program").unwrap();
    let old = row("r1", keys[1].clone());
    tx.put("items", &table, &row("r1", Value::String("new".into())), Some(&old)).unwrap();
    assert_eq!(tx.lookup("items", "byKey", &index, &keys[1..2]).unwrap(), Some(row("r2", keys[1].clone())));
    tx.prefetch(&gets("items"));
    assert!(tx.batch("rollback to program").is_err(), "batch must refuse alternate rollback spellings");
    tx.rollback_program().unwrap();
    assert_eq!(tx.get("items", "r1").unwrap(), Some(old.clone()), "rollback discarded the updated cached image");
    tx.prefetch(&gets("items"));
    tx.delete("items", &table, &old).unwrap();
    assert_eq!(tx.get("items", "r1").unwrap(), None, "delete invalidates hits");
    tx.rollback().unwrap();
    let tx = engine.store.transaction(None).unwrap();
    assert_eq!(tx.get("items", "r0").unwrap(), None, "cache cannot outlive rollback/transaction");
    tx.rollback().unwrap();
}

#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn failed_fill_preserves_earlier_cache_and_transaction_usability() {
    let mut engine = engine();
    let tx = engine.store.transaction(Some(WriteMode::Serialized)).unwrap();
    tx.prefetch(&gets("items")); // cache eight absent rows
    // PostgreSQL text parameters reject NUL. The adapter must roll back
    // this speculative server-side error without clearing earlier answers.
    let before_fill = tx.calls.get();
    tx.prefetch(&gets("bad\0"));
    assert!(tx.calls.get() > before_fill);
    let before = tx.calls.get();
    assert_eq!(tx.get("items", "r7").unwrap(), None);
    assert_eq!(tx.calls.get(), before, "failed fill kept the old cache");
    assert_eq!(tx.get("bad", "r0").unwrap(), None, "failed speculative SQL did not poison the transaction");
    tx.rollback().unwrap();
}

#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn oversized_get_and_lookup_fills_transfer_no_payloads() {
    let mut engine = engine();
    let table = engine.schema.tables["items"].clone();
    let tx = engine.store.transaction(Some(WriteMode::Serialized)).unwrap();
    for n in 0..8 {
        let value = object([("id", Value::Id(format!("r{n}"))), ("key", Value::String(format!("k{n}"))), ("payload", Value::String("x".repeat(800_000)))]);
        tx.put("items", &table, &value, None).unwrap();
    }
    let lookups = (0..8).map(|n| PrefetchRequest::Lookup { table: "items".into(), index: "byKey".into(), key: vec![Value::String(format!("k{n}"))] }).collect::<Vec<_>>();
    for requests in [gets("items"), lookups] {
        let before = tx.calls.get();
        tx.prefetch(&requests);
        assert!(tx.calls.get() > before, "fill reached SQL");
        assert_eq!(tx.prefetch_rows.get(), 0, "SQL skipped the oversized page before transfer");
        assert_eq!(tx.prefetch_bytes.get(), 0);
        assert!(tx.rows_cache.borrow().get("items", "r0").is_none());
    }
    assert!(tx.get("items", "r0").unwrap().is_some(), "logical reads still work");
    tx.rollback().unwrap();
}

#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn small_pages_only_fill_when_distinct_uncached_requests_pay_control_calls() {
    let mut engine = engine();
    let tx = engine.store.transaction(None).unwrap();
    let requests = gets("items");
    let before = tx.calls.get();
    tx.prefetch(&requests[..3]);
    assert_eq!(tx.calls.get(), before, "three reads cannot amortize query plus two control calls");
    tx.prefetch(&vec![requests[0].clone(); 8]);
    assert_eq!(tx.calls.get(), before, "duplicates do not count as fillable requests");
    tx.prefetch(&requests[..4]);
    assert!(tx.calls.get() > before, "four distinct requests fill");
    let before = tx.calls.get();
    tx.prefetch(&requests[..7]);
    assert_eq!(tx.calls.get(), before, "four already cached requests cannot subsidize three new ones");
    tx.rollback().unwrap();
}

#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn legacy_keys_can_shrink_and_open_reports_the_index_and_count() {
    let mut engine = engine();
    let table = engine.schema.tables["items"].clone();
    let name: String = engine.store.client.query_one("SELECT current_schema()", &[]).unwrap().get(0);
    let mut previous = row("r1", Value::String("x".repeat(2200)));
    // Compressible legacy data fits Postgres's physical bound but exceeds
    // the portable one. Seed the predecessor layout without the new gate.
    engine.store.client.execute("INSERT INTO r VALUES ('items','r1',$1)", &[&canonical_json(&previous)]).unwrap();
    for (name, index) in &table.indexes {
        let key = crate::rows::index_key(index, &previous, "r1");
        engine.store.client.execute("INSERT INTO i VALUES ('items',$1,$2,'r1')", &[name, &key]).unwrap();
    }
    let client = Client::connect(&std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(), postgres::NoTls).unwrap();
    let error = PostgresEngine::open(client, &name).err().expect("legacy adoption must refuse");
    assert_eq!(error.code(), "E_INDEX_KEY_BYTES");
    assert!(error.to_string().contains("items.byKey: 1 index entries"), "{error}");
    let tx = engine.store.transaction(Some(WriteMode::Serialized)).unwrap();
    for n in [2200, 2100] {
        let next = row("r1", Value::String("x".repeat(n)));
        tx.put("items", &table, &next, Some(&previous)).unwrap();
        previous = next;
    }
    let longer = row("r1", Value::String("x".repeat(2201)));
    assert_eq!(tx.put("items", &table, &longer, Some(&previous)).unwrap_err().code(), "E_INDEX_KEY_BYTES");
    tx.delete("items", &table, &previous).unwrap();
    tx.commit().unwrap();
    let client = Client::connect(&std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(), postgres::NoTls).unwrap();
    PostgresEngine::open(client, &name).unwrap();
}
