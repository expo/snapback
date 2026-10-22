use super::authority_engine;
use super::super::WriteMode;
use crate::engine::session_clock::test_cases;

#[test]
#[ignore = "requires SNAPBACK4_EVAL_POSTGRES (private PostgreSQL; scripts/test-postgres.sh)"]
fn staging_clock_preserves_only_live_credentials() {
    let mut engine = authority_engine();
    let tx = engine.store.transaction(Some(WriteMode::Serialized)).unwrap();
    tx.batch(test_cases::SEED).unwrap();
    test_cases::preserves_only_live(&tx);
    tx.rollback().unwrap();
}

#[test]
#[ignore = "requires SNAPBACK4_EVAL_POSTGRES (private PostgreSQL; scripts/test-postgres.sh)"]
fn staging_clock_overflow_refuses_before_any_write() {
    let mut engine = authority_engine();
    let tx = engine.store.transaction(Some(WriteMode::Serialized)).unwrap();
    tx.batch(test_cases::SEED).unwrap();
    test_cases::overflow_is_validated_before_writes(&tx);
    tx.rollback().unwrap();
}
