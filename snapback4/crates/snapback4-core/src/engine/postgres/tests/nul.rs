//! Physical bind refusals and the shared identity admission chokepoints.
use crate::receipts::ReceiptReader;
use super::authority_engine;
use super::super::{WriteMode, store::Tx};
use crate::{RuntimeError, authority::AuthorityTransaction, identity::{self, IdentityStore, IdentityTransaction},
    engine::actions::requests::RequestsTransaction, rows::Rows};
use std::cell::RefCell;

fn assert_input<T: std::fmt::Debug>(result: Result<T, RuntimeError>) {
    let error = result.unwrap_err();
    assert!(matches!(error, RuntimeError::Input(_)), "{error:?}");
    assert_eq!(error.code(), "E_INPUT");
}
fn alive(tx: &Tx<'_>) { assert_eq!(tx.query("SELECT 42::bigint", &[]).unwrap()[0].get::<_, i64>(0), 42); }

#[test]
#[ignore = "requires private SNAPBACK4_EVAL_POSTGRES"]
fn nul_bind_guard_refuses_text_options_arrays_and_aborts_transaction() {
    let mut e = authority_engine();
    for case in 0..3 {
        let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
        // Warm the statements so call counts prove no Bind/Execute was sent.
        tx.query("SELECT $1::text", &[&"safe"]).unwrap();
        tx.query("SELECT $1::text[]", &[&vec![Some("safe"), None]]).unwrap();
        tx.execute("INSERT INTO _meta(key,value) VALUES ('guard',$1)", &[&"safe"]).unwrap();
        tx.record_commit(1, 0, "guard", "dev:alice", "test", &[], 0).unwrap();
        let calls = tx.calls.get();
        match case {
            0 => assert_input(tx.query("SELECT $1::text", &[&"bad\0text"])),
            1 => assert_input(tx.execute("INSERT INTO _meta(key,value) VALUES ('guard',$1)", &[&Some("bad\0text")])),
            _ => assert_input(tx.query("SELECT $1::text[]", &[&Some(vec![None, Some("bad\0array")])])),
        }
        assert_eq!(tx.calls.get(), calls);
        assert_input(tx.query("SELECT 42::bigint", &[]));
        assert_input(tx.execute("DELETE FROM _meta WHERE key='guard'", &[]));
        assert_input(tx.batch("SELECT 42"));
        assert_input(tx.rollback_program());
        assert_input(tx.rollback_prefetch());
        assert_eq!(tx.calls.get(), calls, "poisoned transactions must send no further statements");
        assert_input(tx.commit());
        for table in ["_commits", "_change_evidence", "_log", "r"] {
            assert_eq!(e.store.client.query_one(&format!("SELECT count(*) FROM {table}"), &[]).unwrap().get::<_, i64>(0), 0);
        }
        assert_eq!(e.store.client.query_one("SELECT count(*) FROM _meta WHERE key='guard'", &[]).unwrap().get::<_, i64>(0), 0);
    }
}

#[test]
#[ignore = "requires private SNAPBACK4_EVAL_POSTGRES"]
fn nul_tail_refusal_cannot_commit_earlier_row_writes() {
    let mut e = super::engine();
    let table = e.schema.tables["items"].clone();
    let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
    let row = super::row("valid", crate::Value::Null);
    tx.put("items", &table, &row, None).unwrap();
    tx.record_commit(1, 0, "bad\0program", "dev:alice", "test", &["items".into()], 1).unwrap();
    crate::partition::PartitionRows::append_log(&tx, "public", 1, 0, "items", "put", "valid", Some(&crate::value::canonical_json(&row))).unwrap();
    // Ordinary execution never flushes. Explicit completion refuses the tail,
    // and catching that refusal cannot commit the earlier row/index writes.
    tx.execute("SELECT 42", &[]).unwrap();
    assert_input(tx.flush_tail());
    assert_input(tx.commit());
    assert_eq!(e.store.client.query_one("SELECT seq FROM _head WHERE singleton", &[]).unwrap().get::<_, i64>(0), 0);
    for table in ["r", "i", "_commits", "_change_evidence", "_log", "_outbox"] {
        assert_eq!(e.store.client.query_one(&format!("SELECT count(*) FROM {table}"), &[]).unwrap().get::<_, i64>(0), 0, "{table} persisted after a refused tail");
    }
}

#[test]
#[ignore = "requires private SNAPBACK4_EVAL_POSTGRES"]
fn bind_guard_accepts_null_binary_and_json_escaped_nul() {
    let mut e = authority_engine();
    let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
    tx.query("SELECT $1::text", &[&None::<&str>]).unwrap();
    tx.query("SELECT $1::text[]", &[&vec![None, Some("safe")]]).unwrap();
    tx.query("SELECT $1::bytea", &[&vec![0u8, 1, 0]]).unwrap();
    let json = serde_json::to_string(&"bad\0json").unwrap();
    tx.query("SELECT $1::text", &[&json]).unwrap();
    tx.query("SELECT $1::text[]", &[&vec![json]]).unwrap();
    tx.commit().unwrap();
}

#[test]
#[ignore = "requires private SNAPBACK4_EVAL_POSTGRES"]
fn nul_mutation_id_and_viewer_are_refused_before_adapter_calls() {
    let bound = snapback4_lang::compile(&[("schema.q".into(), "mutation ping():\n  return 1\n".into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let client = postgres::Client::connect(&std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(), postgres::NoTls).unwrap();
    let schema = serde_json::from_value(serde_json::to_value(&bound.schema).unwrap()).unwrap();
    let programs: Vec<crate::ir::Program> = bound.programs.into_iter().map(|p| serde_json::from_value(serde_json::to_value(p.program).unwrap()).unwrap()).collect();
    let mut e = super::super::PostgresEngine::create(client, &format!("sb4_eval_nul_mutation_{:x}", crate::ids::seed()), schema, programs).unwrap();
    let calls = e.store.calls.get();
    for (viewer, id, code) in [("dev:alice", Some("op\0id"), "E_INPUT"), ("dev:bad\0viewer", Some("op"), "E_AUTH"), ("dev:bad\0viewer", None, "E_AUTH")] {
        let ctx = crate::Context::new(viewer, Default::default()).at(1_000);
        assert_eq!(e.mutate("ping", id, ctx).unwrap_err().code(), code);
        assert_eq!(e.store.calls.get(), calls);
    }
    for table in ["_ops", "_commits"] {
        assert_eq!(e.store.client.query_one(&format!("SELECT count(*) FROM {table}"), &[]).unwrap().get::<_, i64>(0), 0);
    }
}

#[test]
#[ignore = "requires private SNAPBACK4_EVAL_POSTGRES"]
fn nul_optional_lookups_are_absent_without_database_calls() {
    let mut e = authority_engine();
    let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
    let calls = tx.calls.get();
    assert!(tx.request("x\0y").unwrap().is_none());
    assert!(tx.work_by_id("x\0y").unwrap().is_none());
    assert!(tx.work_by_claimed_session_digest("x\0y").unwrap().is_none());
    assert!(tx.session_by_digest("x\0y").unwrap().is_none());
    assert!(tx.latest_live_family_member("member:a", "x\0y", 0).unwrap().is_none());
    assert!(tx.latest_live_family_member("x\0y", "family", 0).unwrap().is_none());
    assert!(tx.mint_binding_record("x\0y", "intent").unwrap().is_none());
    assert!(tx.mint_binding_record("invocation", "x\0y").unwrap().is_none());
    assert!(tx.get("table", "x\0y").unwrap().is_none());
    assert!(tx.index_head("table", "x\0y", &[], &crate::rows::Bounds::default(), crate::rows::Dir::Asc).unwrap().is_none());
    assert!(tx.receipt("member:a", "x\0y").unwrap().is_none());
    assert!(crate::receipts::replay_bound(&tx, "member:a", "x\0y", "work", &serde_json::Value::Null).unwrap().is_none());
    assert_eq!(tx.principal_generation("x\0y").unwrap(), 0);
    assert_eq!(tx.calls.get(), calls);
    alive(&tx);
    tx.commit().unwrap();

    let calls = e.store.calls.get();
    assert!(e.replay("member:a", "x\0y").unwrap().is_none());
    assert!(e.replay("x\0y", "op").unwrap().is_none());
    assert!(e.replay_mutation("member:a", "x\0y", "work", &serde_json::Value::Null).unwrap().is_none());
    assert_eq!(e.store.calls.get(), calls);
    let store = RefCell::new(&mut e.store);
    assert!(store.identity_credential("x\0y").unwrap().is_none());
    assert!(store.full_rotation_record("x\0y", 0).unwrap().is_none());
    assert!(store.identity_session_expiry("x\0y").unwrap().is_none());
    assert!(store.rotate_read_session("x\0y", 0, |_| panic!("absent lookup must not mint")).unwrap().is_none());
    assert!(!store.is_supervised_family("x\0y").unwrap());
    assert_eq!(store.borrow().calls.get(), calls);
}

#[test]
#[ignore = "requires private SNAPBACK4_EVAL_POSTGRES"]
fn nul_identity_chokepoints_precede_adapter_writes() {
    let mut e = authority_engine();
    {
        let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
        crate::engine::actions::requests::test_cases::insert(&tx, "expired", "work", 0);
        crate::engine::actions::requests::test_cases::insert(&tx, "queued", "work", 1);
        let session = identity::Session { principal: "dev:alice".into(), kind: "action".into(),
            token: "expired-delegation".into(), expires_at: 1_000, scope: identity::SessionScope::Full,
            cap_expires_at: None };
        tx.insert_identity_session(&session, 0).unwrap();
        tx.claim_request("expired", "service:worker", &identity::digest(&session.token), 1_000).unwrap();
        tx.commit().unwrap();
    }
    let calls = e.store.calls.get();
    // These are the shared predicates used by request_action, admit_route,
    // claim_actions, claim_effects and scheduled-action activation. Their
    // public Engine integration cases run in tests/nul_chokepoints.rs; these
    // engine families are not yet exposed by PostgresEngine.
    for identity in ["inv\0ocation", "dev:bad\0principal", "service:bad\0worker", "service:bad\0seat"] {
        assert!(!crate::value::identity_fits(identity), "{identity:?}");
    }
    for seat in ["service:bad\0worker", "service:bad\0seat"] { assert!(!identity::is_service(seat)); }
    // The asset ledger remains SQLite-only. Exercise its exact admission
    // policy on this adapter too, before any writer or database call.
    assert_eq!(crate::engine::validate::write_identity("dev:alice", Some("intent\0id")).unwrap_err().code(), "E_INPUT");
    assert_eq!(crate::engine::validate::write_identity("dev:bad\0owner", Some("intent")).unwrap_err().code(), "E_AUTH");
    assert_eq!(e.store.calls.get(), calls);
    let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
    let row = &tx.query("SELECT (SELECT count(*) FROM _requests), (SELECT count(*) FROM _sessions), (SELECT count(*) FROM _principals)", &[]).unwrap()[0];
    assert_eq!([row.get::<_, i64>(0), row.get(1), row.get(2)], [2, 1, 1]);
    let work = tx.work_by_id("expired").unwrap().unwrap();
    assert_eq!(work.state, "running");
    assert_eq!(work.lease_until, Some(1_000));
    assert!(tx.session_by_digest(&identity::digest("expired-delegation")).unwrap().is_some(),
        "invalid claim identity cannot run the ordinary expiry cleanup");
    assert_eq!(tx.request("queued").unwrap().unwrap().state, "queued");
    tx.commit().unwrap();
}

#[test]
#[ignore = "requires private SNAPBACK4_EVAL_POSTGRES"]
fn nul_request_name_selection_is_absent_and_preserves_valid_names() {
    let mut e = authority_engine();
    let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
    crate::engine::actions::requests::test_cases::insert(&tx, "good", "work", 0);
    let calls = tx.calls.get();
    assert!(tx.due_requests(1, Some("bad\0name"), None, 10).unwrap().is_empty());
    assert_eq!(tx.calls.get(), calls);
    assert!(tx.due_requests(1, None, Some(&["bad\0name".into()]), 10).unwrap().is_empty());
    assert_eq!(tx.due_requests(1, None, Some(&["bad\0name".into(), "work".into()]), 10).unwrap(), ["good"]);
    alive(&tx);
    tx.commit().unwrap();
}
