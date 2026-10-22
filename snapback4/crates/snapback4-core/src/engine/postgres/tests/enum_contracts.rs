//! Shared family cases executed through the actual enum, independently of HTTP admission.
// @ref LLP 3000.009.001.000#3.4 — family evidence does not expand the admitted host profile.
use super::super::*;
use crate::{Engine, store_port::AnyStore, assets::{AssetTransaction, AssetIntentReader},
    identity::{IdentityStore, IdentityTransaction}, authority::AuthorityTransaction,
    engine::effects::OutboxStore};
fn fresh() -> AnyStore {
    let connection = std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap();
    Engine::new(AnyStore::create_postgres(&connection, &format!("sb4_eval_enum_{:x}", crate::ids::seed())).unwrap(), Schema::default(), []).unwrap().store
}
#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn identity_authority_and_metadata_contracts_through_enum() {
    let mut store = fresh();
    crate::identity::test_cases::assert_refresh_rollback(&store);
    crate::identity::test_cases::assert_credential_policy(&store);
    crate::identity::test_cases::assert_worker_families(&store);
    let session = crate::identity::Session { principal: "member:enum".into(), kind: "member".into(), token: "enum-token".into(), expires_at: 9000, scope: crate::identity::SessionScope::Full, cap_expires_at: None };
    let tx = store.transaction().unwrap();
    tx.insert_identity_session(&session, 1000).unwrap();
    assert_eq!(tx.session_by_digest(&crate::identity::digest(&session.token)).unwrap().unwrap().principal, session.principal);
    assert_eq!(tx.principal_generation(&session.principal).unwrap(), 0);
    crate::metadata::test_cases::independent_families(&tx);
    crate::activation::ActivationTransaction::set_audience_epoch(&tx, "notes", 7, 1234).unwrap();
    assert_eq!(PartitionRows::audience_epoch(&tx, "notes").unwrap(), 7);
    assert_eq!(PartitionRows::audience_epoch_time(&tx, "notes").unwrap(), Some(1234));
    tx.commit().unwrap();
    assert_eq!(store.identity_session_expiry(&crate::identity::digest(&session.token)).unwrap(), Some(9000));
    crate::metadata::test_cases::independent_families(&store);
    store.close_identity_session(&crate::identity::digest(&session.token)).unwrap();
}
#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn requests_jobs_and_outbox_contracts_through_enum() {
    let mut store = fresh();
    let tx = store.transaction().unwrap();
    crate::engine::actions::requests::test_cases::selection(&tx);
    tx.commit().unwrap();
    assert!(!store.request_counts().unwrap().is_empty());
    let tx = store.transaction().unwrap();
    crate::engine::job::test_cases::queue_and_continue(&tx);
    tx.commit().unwrap();
    crate::engine::job::test_cases::assert_committed(&mut store);
    let tx = store.transaction().unwrap();
    crate::engine::effects::test_cases::candidate_ordering(&tx);
    tx.commit().unwrap();
    assert!(!store.effect_counts().unwrap().is_empty());
    assert!(!store.list_effects(None, 100).unwrap().is_empty());
}
#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn asset_ledger_and_real_placement_contract_through_enum() {
    let mut store = fresh();
    store.record_asset(&crate::assets::test_cases::asset("upload")).unwrap();
    let tx = store.transaction().unwrap();
    tx.declare_intent("alice", "declared", "original", "{}").unwrap();
    tx.commit().unwrap();
    crate::assets::test_cases::reader_is_owner_scoped(&store);
    let tx = store.transaction().unwrap();
    crate::assets::test_cases::declarations_and_tombstones(&tx);
    tx.rollback().unwrap();
    assert!(store.asset_intent_exists("alice", "declared").unwrap());
    let tx = store.transaction().unwrap();
    assert!(crate::assets::AssetPlacementReader::placement_record(&tx, "alice", "absent").unwrap().is_none());
    assert_eq!(Rows::holds_assets(&tx).unwrap_err().code(), "E_STORE_UNSUPPORTED");
    assert_eq!(Rows::time_audience_published(&tx, "notes", "id").unwrap_err().family(), "time-publication");
    let table: crate::schema::Table = serde_json::from_value(serde_json::json!({"columns": {"id": "Id"}, "indexes": {}, "rules": {"read": "Allow", "insert": "Allow", "update": "Allow", "delete": "Allow"}})).unwrap();
    assert_eq!(Rows::track_time_audience(&tx, "notes", &table, "id", None, 0, false).unwrap_err().family(), "time-publication");
    tx.rollback().unwrap();
    assert_eq!(store.asset_location().unwrap_err().family(), "assets");
}
#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn placement_binding_and_cancellation_use_the_actual_enum_reader() {
    let mut store = fresh(); let tx = store.transaction().unwrap();
    let asset = crate::assets::test_cases::asset("upload"); tx.record_asset(&asset).unwrap();
    let binding = serde_json::json!({"op":"save","args":{"note":"a\0b"},"argument":"doc"});
    tx.declare_intent("alice", "slot", "fp", &crate::json_codec::to_text(&binding).unwrap()).unwrap();
    assert_eq!(crate::assets::require_placement(&tx, "alice", "slot", "save", &serde_json::json!({})).unwrap_err().code(), "E_UPLOAD_PENDING");
    crate::assets::test_cases::upload(&tx, "alice", "slot", "upload", &crate::json_codec::to_text(&asset).unwrap());
    let args = serde_json::json!({"note":"a\0b","doc":{"id":"upload","type":"application/pdf","bytes":10,"width":null,"height":null,"duration":null}});
    crate::assets::require_placement(&tx, "alice", "slot", "save", &args).unwrap();
    assert_eq!(crate::assets::require_placement(&tx, "alice", "slot", "changed", &args).unwrap_err().code(), "E_ASSET_INTENT_REUSE");
    let mut changed = args.clone(); changed["doc"]["bytes"] = 11.into();
    assert_eq!(crate::assets::require_placement(&tx, "alice", "slot", "save", &changed).unwrap_err().code(), "E_ASSET_INTENT_REUSE");
    tx.cancel_intent("alice", "slot").unwrap();
    assert_eq!(crate::assets::require_placement(&tx, "alice", "slot", "save", &args).unwrap_err().code(), "E_UPLOAD_CANCELLED");
    tx.rollback().unwrap();
}
