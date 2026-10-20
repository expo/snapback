use super::super::WriteMode;
use super::authority_engine;
use crate::{
    authority::AuthorityTransaction,
    identity::{IdentityStore, IdentityTransaction, Session, SessionScope, digest},
};
use std::cell::RefCell;

#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn identity_insert_and_logout_round_trip() {
    let mut engine = authority_engine();
    let session = Session {
        principal: "member:pg".into(),
        kind: "member".into(),
        token: "pg-token".into(),
        expires_at: 9_000_000_000,
        scope: SessionScope::Full,
        cap_expires_at: None,
    };
    let store = RefCell::new(&mut engine.store);
    store
        .insert_identity_session_atomic(&session, 1_000)
        .unwrap();
    assert_eq!(
        store
            .identity_session_expiry(&digest(&session.token))
            .unwrap(),
        Some(session.expires_at)
    );
    store
        .close_identity_session(&digest(&session.token))
        .unwrap();
    assert_eq!(
        store
            .identity_session_expiry(&digest(&session.token))
            .unwrap(),
        None
    );
}

#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn identity_transaction_writes_require_the_existing_head_fence() {
    let mut engine = authority_engine();
    let session = Session {
        principal: "member:pg".into(),
        kind: "member".into(),
        token: "pg-token".into(),
        expires_at: 9_000,
        scope: SessionScope::Full,
        cap_expires_at: None,
    };
    for mode in [None, Some(WriteMode::Serializable)] {
        let tx = engine.store.transaction(mode).unwrap();
        assert!(
            tx.insert_identity_session(&session, 1_000)
                .unwrap_err()
                .to_string()
                .contains("serialized shared-head fence")
        );
        assert!(
            tx.session_by_digest(&digest(&session.token))
                .unwrap()
                .is_none()
        );
        tx.rollback().unwrap();
    }
}
