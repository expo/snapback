//! Identity family cases shared by storage adapters. No database APIs here.
use super::*;

fn injected() -> RuntimeError {
    RuntimeError::Store("injected identity failure".into())
}

pub(crate) fn assert_refresh_rollback(store: &impl IdentityStore) {
    let first = open_session_for(store, "member:refresh", "member", 1_000, 7).unwrap();
    let family = digest(&first.token);
    // Reusing a bearer collides only after replacement has deleted the old row.
    let collision = open_session_for(store, "member:other", "member", 1_001, 7).unwrap();
    assert!(
        store
            .replace_full_session(&family, &collision, &family, 2_000)
            .is_err()
    );
    assert!(
        store
            .full_rotation_record(&family, 2_000)
            .unwrap()
            .is_some()
    );
    assert!(
        store
            .full_rotation_record(&digest(&collision.token), 2_000)
            .unwrap()
            .is_some()
    );
    let successor = rotate_session_in(store, &first.token, 2_000)
        .unwrap()
        .unwrap();
    let record = store
        .full_rotation_record(&digest(&successor.token), 2_000)
        .unwrap()
        .unwrap();
    assert_eq!(record.family, family);
    assert!(
        store
            .full_rotation_record(&family, 2_000)
            .unwrap()
            .is_none()
    );
}

pub(crate) fn assert_credential_policy(store: &impl IdentityStore) {
    let mut entropy = crate::ids::Mint::default();
    let prepared = PreparedSignup {
        email: "case@example.com".into(),
        hash: "checked-hash".into(),
    };
    let first = finish_signup_in(store, prepared, 1_000, &mut entropy, SessionScope::Full).unwrap();
    let duplicate = PreparedSignup {
        email: "case@example.com".into(),
        hash: "other-hash".into(),
    };
    let error =
        finish_signup_in(store, duplicate, 1_001, &mut entropy, SessionScope::Full).unwrap_err();
    assert!(
        matches!(error, RuntimeError::Auth(message) if message == "that email already has an account; sign in instead")
    );
    let checked = store
        .identity_credential("case@example.com")
        .unwrap()
        .unwrap();
    assert_eq!(checked.hash, "checked-hash");
    assert_eq!(checked.principal, first.principal);
    let changed = Credential {
        principal: checked.principal.clone(),
        hash: "stale-hash".into(),
    };
    assert!(
        matches!(finish_login_in(store, changed, 1_002, SessionScope::Read), Err(RuntimeError::Auth(message)) if message == "no account matches that email and password")
    );
    let read = finish_login_in(store, checked, 1_003, SessionScope::Read).unwrap();
    let foreign =
        read_sessions::scoped_session("member:foreign", "member", 1_003, SessionScope::Read)
            .unwrap();
    store
        .insert_identity_session_atomic(&foreign, 1_003)
        .unwrap();
    // A duplicate token fails after deleting the old family. Both the old
    // family and the unrelated read credential must survive the rollback.
    assert!(
        store
            .rotate_read_session(&digest(&read.token), 1_004, |_| Ok(Some(foreign.clone())))
            .is_err()
    );
    assert_eq!(
        store.identity_session_expiry(&digest(&read.token)).unwrap(),
        Some(read.expires_at)
    );
    assert_eq!(
        store
            .identity_session_expiry(&digest(&foreign.token))
            .unwrap(),
        Some(foreign.expires_at)
    );
    // A policy/token-generation refusal happens inside the immediate read
    // rotation transaction, and must leave the existing bearer unchanged.
    assert!(
        store
            .rotate_read_session(&digest(&read.token), 1_004, |_| Err(injected()))
            .is_err()
    );
    let successor = read_sessions::rotate(store, &read.token, 1_005)
        .unwrap()
        .unwrap();
    assert_eq!(successor.cap_expires_at, read.cap_expires_at);
    assert!(
        read_sessions::rotate(store, &read.token, 1_006)
            .unwrap()
            .is_none()
    );
    assert_eq!(
        store.revoke_identity_principal(&first.principal).unwrap(),
        2
    );
    assert!(
        read_sessions::rotate(store, &successor.token, 1_007)
            .unwrap()
            .is_none()
    );
}

pub(crate) fn assert_worker_families(store: &impl IdentityStore) {
    let manual = open_session_for(store, "service:worker", "service", 1_000, 1).unwrap();
    let legacy = store
        .mint_supervised_child(false, 1_001, 7, || {
            new_session("service:worker", "service", 1_001, 1)
        })
        .unwrap();
    let named = store
        .mint_supervised_child(true, 1_002, 7, || {
            new_session("service:named", "service", 1_002, 1)
        })
        .unwrap();
    let legacy_digest = digest(&legacy.token);
    let named_digest = digest(&named.token);
    assert!(!store.is_supervised_family(&digest(&manual.token)).unwrap());
    assert!(store.is_supervised_family(&legacy_digest).unwrap());
    assert!(store.is_supervised_family(&named_digest).unwrap());
    assert!(
        store
            .mint_supervised_child(false, 1_003, 8, || Err(injected()))
            .is_err()
    );
    assert!(store.is_supervised_family(&legacy_digest).unwrap());
    store.revoke_worker_family(Some(&named_digest)).unwrap();
    assert!(!store.is_supervised_family(&named_digest).unwrap());
    assert!(
        store
            .full_rotation_record(&named_digest, 1_004)
            .unwrap()
            .is_none()
    );
    assert!(store.is_supervised_family(&legacy_digest).unwrap());
    store.clear_worker_families().unwrap();
    assert!(
        store
            .full_rotation_record(&legacy_digest, 1_004)
            .unwrap()
            .is_none()
    );
    assert!(
        store
            .full_rotation_record(&digest(&manual.token), 1_004)
            .unwrap()
            .is_some()
    );
}

/// Adapter-only fixture operations; policy cases below use no SQL.
pub(crate) trait RotationFixture: IdentityStore {
    fn seed_read_family(&self, session: &Session, generation: i64);
    fn drop_read_sessions(&self);
    fn read_sessions_present(&self) -> bool;
}

pub(crate) enum RotationRefusal { Expired, CapExpired, StaleGeneration, MissingTable }

pub(crate) fn assert_read_rotation_refusal(store: &impl RotationFixture, refusal: RotationRefusal) {
    if matches!(refusal, RotationRefusal::MissingTable) {
        store.drop_read_sessions();
        assert!(read_sessions::rotate(store, "ro.missing", 2_000).unwrap().is_none());
        assert!(!store.read_sessions_present(), "refusal must not install storage");
        return;
    }
    let mut session = read_sessions::scoped_session("member:refused", "member", 1_000, SessionScope::Read).unwrap();
    match refusal {
        RotationRefusal::Expired => session.expires_at = 2_000,
        RotationRefusal::CapExpired => session.cap_expires_at = Some(2_000),
        RotationRefusal::StaleGeneration => { store.revoke_identity_principal(&session.principal).unwrap(); }
        RotationRefusal::MissingTable => unreachable!(),
    }
    store.seed_read_family(&session, 0);
    let before = store.identity_session_expiry(&digest(&session.token)).unwrap();
    let mut saw_facts = false;
    assert!(store.rotate_read_session(&digest(&session.token), 2_000, |record| {
        saw_facts = true;
        assert_eq!(record.expires_at, session.expires_at);
        assert_eq!(record.cap_expires_at, session.cap_expires_at.unwrap());
        assert_eq!(record.principal_generation, 0);
        assert_eq!(record.current_generation, i64::from(matches!(refusal, RotationRefusal::StaleGeneration)));
        Ok(None)
    }).unwrap().is_none());
    assert!(saw_facts, "the adapter must return refused rows as raw facts");
    assert!(read_sessions::rotate(store, &session.token, 2_000).unwrap().is_none());
    assert_eq!(store.identity_session_expiry(&digest(&session.token)).unwrap(), before, "refused rotation must retain the old row");
}
