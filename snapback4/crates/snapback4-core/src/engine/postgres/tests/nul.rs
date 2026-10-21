//! Physical bind refusals and the shared identity admission chokepoints.
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
fn nul_bind_guard_refuses_text_options_arrays_and_keeps_transaction_usable() {
    let mut e = authority_engine();
    let tx = e.store.transaction(Some(WriteMode::Serialized)).unwrap();
    // Warm the statements so call counts prove no Bind/Execute was sent.
    tx.query("SELECT $1::text", &[&"safe"]).unwrap();
    tx.query("SELECT $1::text[]", &[&vec![Some("safe"), None]]).unwrap();
    tx.execute("INSERT INTO _meta(key,value) VALUES ('guard',$1)", &[&"safe"]).unwrap();
    tx.record_commit(1, 0, "guard", "dev:alice", "test", &[], 0).unwrap();
    for query in [true, false] {
        let calls = tx.calls.get();
        if query { assert_input(tx.query("SELECT $1::text", &[&"bad\0text"])); }
        else { assert_input(tx.execute("INSERT INTO _meta(key,value) VALUES ('guard',$1)", &[&Some("bad\0text")])); }
        assert_eq!(tx.calls.get(), calls);
        alive(&tx);
    }
    let calls = tx.calls.get();
    assert_input(tx.query("SELECT $1::text[]", &[&Some(vec![None, Some("bad\0array")])]));
    assert_eq!(tx.calls.get(), calls);
    alive(&tx);
    // Optional NULL and binary keys containing zero remain valid. JSON's
    // escaped NUL is plain safe text, including inside text arrays.
    tx.query("SELECT $1::text", &[&None::<&str>]).unwrap();
    tx.query("SELECT $1::text[]", &[&vec![None, Some("safe")]]).unwrap();
    tx.query("SELECT $1::bytea", &[&vec![0u8, 1, 0]]).unwrap();
    let json = serde_json::to_string(&"bad\0json").unwrap();
    tx.query("SELECT $1::text", &[&json]).unwrap();
    tx.query("SELECT $1::text[]", &[&vec![json]]).unwrap();
    assert_eq!(tx.query("SELECT seq FROM _head WHERE singleton", &[]).unwrap()[0].get::<_, i64>(0), 0,
        "refused execute must not flush pending bookkeeping");
    tx.commit().unwrap();
    assert_eq!(e.store.client.query_one("SELECT count(*) FROM _commits", &[]).unwrap().get::<_, i64>(0), 1,
        "the pending bookkeeping survives the input refusal");
    assert_eq!(e.store.client.query_one("SELECT value FROM _meta WHERE key='guard'", &[]).unwrap().get::<_, String>(0), "safe");
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
    assert!(tx.applied("member:a", "x\0y").unwrap().is_none());
    assert!(tx.applied_bound("member:a", "x\0y", "work", "digest").unwrap().is_none());
    assert_eq!(tx.principal_generation("x\0y").unwrap(), 0);
    assert_eq!(tx.calls.get(), calls);
    alive(&tx);
    tx.commit().unwrap();

    let calls = e.store.calls.get();
    assert!(e.replay("member:a", "x\0y").unwrap().is_none());
    assert!(e.replay("x\0y", "op").unwrap().is_none());
    assert!(e.replay_mutation("member:a", "x\0y", "work", "digest").unwrap().is_none());
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
