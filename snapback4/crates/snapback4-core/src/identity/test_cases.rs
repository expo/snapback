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
        !store
            .replace_full_session(&family, &collision, &family, 2_001)
            .unwrap(),
        "zero deleted rows must not install a replacement"
    );
    assert!(
        store
            .full_rotation_record(&family, 2_000)
            .unwrap()
            .is_none()
    );
}

pub(crate) fn assert_credential_policy(store: &impl IdentityStore) {
    let missing = Credential {
        principal: "member:missing-credential".into(),
        hash: "missing".into(),
    };
    assert!(matches!(
        finish_login_in(store, missing, 999, SessionScope::Full),
        Err(RuntimeError::Auth(_))
    ));
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

pub(crate) enum RotationRefusal {
    Expired,
    CapExpired,
    StaleGeneration,
    MissingTable,
}

pub(crate) fn assert_read_rotation_refusal(store: &impl RotationFixture, refusal: RotationRefusal) {
    if matches!(refusal, RotationRefusal::MissingTable) {
        store.drop_read_sessions();
        assert!(
            read_sessions::rotate(store, "ro.missing", 2_000)
                .unwrap()
                .is_none()
        );
        assert!(
            !store.read_sessions_present(),
            "refusal must not install storage"
        );
        return;
    }
    let mut session =
        read_sessions::scoped_session("member:refused", "member", 1_000, SessionScope::Read)
            .unwrap();
    match refusal {
        RotationRefusal::Expired => session.expires_at = 2_000,
        RotationRefusal::CapExpired => session.cap_expires_at = Some(2_000),
        RotationRefusal::StaleGeneration => {
            store.revoke_identity_principal(&session.principal).unwrap();
        }
        RotationRefusal::MissingTable => unreachable!(),
    }
    store.seed_read_family(&session, 0);
    let before = store
        .identity_session_expiry(&digest(&session.token))
        .unwrap();
    let mut saw_facts = false;
    assert!(
        store
            .rotate_read_session(&digest(&session.token), 2_000, |record| {
                saw_facts = true;
                assert_eq!(record.expires_at, session.expires_at);
                assert_eq!(record.cap_expires_at, session.cap_expires_at.unwrap());
                assert_eq!(record.principal_generation, 0);
                assert_eq!(
                    record.current_generation,
                    i64::from(matches!(refusal, RotationRefusal::StaleGeneration))
                );
                Ok(None)
            })
            .unwrap()
            .is_none()
    );
    assert!(
        saw_facts,
        "the adapter must return refused rows as raw facts"
    );
    assert!(
        read_sessions::rotate(store, &session.token, 2_000)
            .unwrap()
            .is_none()
    );
    assert_eq!(
        store
            .identity_session_expiry(&digest(&session.token))
            .unwrap(),
        before,
        "refused rotation must retain the old row"
    );
}

/// Inspection/legacy setup belongs in adapters; every assertion is shared.
pub(crate) trait IdentityFixture: RotationFixture {
    type Transaction<'a>: IdentityTransaction + AuthorityTransaction;
    fn with_identity_tx<T>(
        &self,
        run: impl FnOnce(&Self::Transaction<'_>) -> Result<T, RuntimeError>,
    ) -> Result<T, RuntimeError>;
    fn principal_facts(&self, principal: &str) -> Option<(String, Option<String>, i64)>;
    fn principal_ids(&self) -> Vec<String>;
    fn null_full_family(&self, digest: &str);
    fn set_worker_meta(&self, key: &str, value: &str);
    fn worker_meta(&self, key: &str) -> Option<String>;
}

pub(crate) fn assert_nul_inputs_refused(store: &impl IdentityFixture) {
    let mut expired = new_session("member:untouched", "member", 1_000, 7).unwrap();
    expired.expires_at = 1_001;
    store.insert_identity_session_atomic(&expired, 1_000).unwrap();
    let principal_message = "a principal is 1–128 printable characters";
    let kind_message = "a session kind is 1–64 letters, digits, _ or -";
    for (error, message) in [
        (prepare_signup("a\0b@example.com", "correct horse").err().unwrap(), "an email address is needed"),
        (finish_signup_in(store, PreparedSignup { email: "a\0b@example.com".into(), hash: "unused".into() }, 2_000, &mut crate::ids::Mint::default(), SessionScope::Full).unwrap_err(), "an email address is needed"),
        (validate_custom_session("member:\0x", "member").unwrap_err(), principal_message),
        (validate_custom_session("member:x", "mem\0ber").unwrap_err(), kind_message),
        (open_session_for(store, "member:\0x", "member", 2_000, 7).unwrap_err(), principal_message),
        (open_session_for(store, "member:x", "mem\0ber", 2_000, 7).unwrap_err(), kind_message),
        (read_sessions::scoped_session("member:\0x", "member", 2_000, SessionScope::Read).unwrap_err(), principal_message),
        (validate_bound_worker("service:worker\0x").unwrap_err(), "a worker principal cannot contain U+0000"),
    ] {
        assert_eq!(error.code(), "E_AUTH", "malformed identity must never reach a driver");
        assert_eq!(error.to_string(), format!("E_AUTH: {message}"));
    }
    assert!(!valid_name("worker\0x"));
    for (invocation, intent) in [("inv\0ocation", BOUND_SESSION_INTENT), ("invocation", "identity-session/v1\0")] {
        let error = validate_mint_binding(&SessionMintBinding {
            invocation_id: invocation.into(), intent: intent.into(), replace_lost_delivery: false,
        }).unwrap_err();
        assert_eq!(error.code(), "E_INPUT");
        assert!(error.to_string().contains("binding requires a valid invocationId and intent identity-session/v1"));
    }
    assert_eq!(store.principal_ids(), ["member:untouched"]);
    assert_eq!(store.identity_session_expiry(&digest(&expired.token)).unwrap(), Some(1_001), "invalid input must not run the expiry sweep");
    assert!(store.identity_credential("ab@example.com").unwrap().is_none());
}

pub(crate) fn assert_convenience_insert_conflict(store: &impl IdentityFixture) {
    let first = open_session_for(store, "member:original", "member", 1_000, 7).unwrap();
    let mut expired = new_session("member:expired", "member", 1_000, 7).unwrap();
    expired.expires_at = 1_001;
    store.insert_identity_session_atomic(&expired, 1_000).unwrap();
    let mut collision = first.clone();
    collision.principal = "member:conflict".into();
    let error = store.insert_identity_session(&collision, 2_000).unwrap_err();
    assert_eq!(error.code(), "E_STORE");
    // Both reject the duplicate digest. Expiry/principal residue after failure
    // differs between autocommit SQLite and transactional Postgres by design.
    assert_eq!(store.identity_session_expiry(&digest(&first.token)).unwrap(), Some(first.expires_at));
}

pub(crate) fn assert_missing_read_storage_created_on_insert(store: &impl IdentityFixture) {
    store.drop_read_sessions();
    assert!(!store.read_sessions_present());
    let read = read_sessions::scoped_session("member:lazy", "member", 1_000, SessionScope::Read).unwrap();
    store.insert_identity_session_atomic(&read, 1_000).unwrap();
    assert!(store.read_sessions_present());
    assert_eq!(store.identity_session_expiry(&digest(&read.token)).unwrap(), Some(read.expires_at));
}

pub(crate) fn assert_digest_in_both_session_tables_refused(store: &impl IdentityFixture) {
    let full = new_session("member:ambiguous", "member", 1_000, 7).unwrap();
    let read = Session { scope: SessionScope::Read, cap_expires_at: Some(full.expires_at), ..full.clone() };
    store.with_identity_tx(|tx| {
        tx.insert_identity_session(&full, 1_000)?;
        tx.insert_read_session(&read, 1_000, None)?;
        let error = tx.session_by_digest(&digest(&full.token)).expect_err("a digest in both stores is ambiguous");
        assert_eq!(error.code(), "E_STORE");
        assert_eq!(error.to_string(), "E_STORE: Query returned more than one row");
        let refusal = error.refusal();
        assert_eq!(refusal.family, "store");
        assert!(refusal.retryable);
        tx.invalidate_session(&digest(&full.token))?;
        assert!(tx.session_by_digest(&digest(&full.token))?.is_none());
        Ok(())
    }).unwrap();
}

pub(crate) fn assert_latest_family_ties(store: &impl IdentityFixture) {
    let first = Session { principal: "member:ties".into(), kind: "member".into(),
        token: "tie-a".into(), expires_at: 9_000, scope: SessionScope::Full, cap_expires_at: None };
    let second = Session { token: "tie-b".into(), ..first.clone() };
    let mut tied = [first, second];
    tied.sort_by_key(|s| digest(&s.token));
    store.with_identity_tx(|tx| {
        // Reverse insertion order must not decide the winner.
        for session in tied.iter().rev() {
            tx.insert_identity_session(session, 1_000)?;
            tx.set_identity_session_family(&digest(&session.token), "ties")?;
        }
        assert_eq!(tx.latest_live_family_member("member:ties", "ties", 2_000)?.unwrap().digest, digest(&tied[0].token));
        // Even a digest collision across the two tables has a total order:
        // the final scope discriminator orders full before read.
        let read = Session { scope: SessionScope::Read, cap_expires_at: Some(10_000), ..tied[0].clone() };
        tx.insert_read_session(&read, 1_000, Some(("ties", 0)))?;
        let selected = tx.latest_live_family_member("member:ties", "ties", 2_000)?.unwrap();
        assert_eq!(selected.digest, digest(&tied[0].token));
        assert_eq!(selected.scope, SessionScope::Full);
        Ok(())
    }).unwrap();
}

pub(crate) fn assert_transaction_contract(store: &impl IdentityFixture) {
    let now = 1_i64 << 40;
    let full = new_session("member:tx", "member", now, 7).unwrap();
    let read = read_sessions::scoped_session(&full.principal, &full.kind, now, SessionScope::Read)
        .unwrap();
    let foreign =
        read_sessions::scoped_session("member:foreign", "member", now, SessionScope::Read).unwrap();
    let family = digest(&full.token);
    store
        .with_identity_tx(|tx| {
            tx.insert_identity_session(&full, now)?;
            tx.insert_read_session(&read, now, Some((&family, 0)))?;
            tx.insert_read_session(&foreign, now, Some((&family, 0)))?;
            let stored_full = tx.session_by_digest(&family)?.unwrap();
            assert_eq!(stored_full.expires_at, full.expires_at);
            assert_eq!(stored_full.scope, SessionScope::Full);
            assert_eq!(stored_full.cap_expires_at, None);
            assert_eq!(stored_full.principal_generation, None);
            let stored_read = tx.session_by_digest(&digest(&read.token))?.unwrap();
            assert_eq!(stored_read.scope, SessionScope::Read);
            assert_eq!(stored_read.family, family);
            assert_eq!(stored_read.cap_expires_at, read.cap_expires_at);
            assert_eq!(stored_read.principal_generation, Some(0));
            assert_eq!(stored_read.expires_at, read.expires_at);
            assert_eq!(tx.principal_generation(&full.principal)?, 0);
            tx.invalidate_family(&full.principal, &family)?;
            assert!(tx.session_by_digest(&family)?.is_none());
            assert!(tx.session_by_digest(&digest(&read.token))?.is_none());
            assert!(tx.session_by_digest(&digest(&foreign.token))?.is_some());
            tx.invalidate_session(&digest(&foreign.token))?;
            tx.invalidate_family(&full.principal, &family)?; // repeated delete is harmless
            assert!(tx.session_by_digest(&digest(&foreign.token))?.is_none());
            Ok(())
        })
        .unwrap();
    assert_eq!(store.identity_session_expiry(&family).unwrap(), None);
}

fn binding_record() -> SessionMintRecord {
    SessionMintRecord {
        input_digest: "input-identity".into(),
        scope: "full".into(),
        principal: "member:bound".into(),
        kind: "member".into(),
        days: 3_650,
        expires_at: (1_i64 << 40) + 86_400_000,
        family: "family-bound".into(),
        principal_generation: 1_i64 << 33,
    }
}

pub(crate) fn assert_mint_bindings(store: &impl IdentityFixture) {
    let record = binding_record();
    store
        .with_identity_tx(|tx| {
            tx.initialize_mint_binding_scope()?;
            assert!(
                tx.mint_binding_record("invocation", BOUND_SESSION_INTENT)?
                    .is_none()
            );
            tx.record_session_mint("invocation", BOUND_SESSION_INTENT, &record)?;
            let read = tx
                .mint_binding_record("invocation", BOUND_SESSION_INTENT)?
                .unwrap();
            assert_eq!(read.input_digest, record.input_digest);
            assert_eq!(read.scope, record.scope);
            assert_eq!(read.principal, record.principal);
            assert_eq!(read.kind, record.kind);
            assert_eq!(read.days, record.days);
            assert_eq!(read.expires_at, record.expires_at);
            assert_eq!(read.family, record.family);
            assert_eq!(read.principal_generation, record.principal_generation);
            assert!(
                tx.mint_binding_record("Invocation", BOUND_SESSION_INTENT)?
                    .is_none()
            );
            assert!(
                tx.mint_binding_record("invocation", "other-intent")?
                    .is_none()
            );
            Ok(())
        })
        .unwrap();
    let session = new_session("member:rollback-binding", "member", 1_000, 7).unwrap();
    assert!(
        store
            .with_identity_tx(|tx| {
                tx.insert_identity_session(&session, 1_000)?;
                tx.record_session_mint("invocation", BOUND_SESSION_INTENT, &record)
            })
            .is_err()
    );
    assert_eq!(
        store
            .identity_session_expiry(&digest(&session.token))
            .unwrap(),
        None
    );
    store
        .with_identity_tx(|tx| {
            assert!(
                tx.mint_binding_record("invocation", BOUND_SESSION_INTENT)?
                    .is_some()
            );
            assert!(tx.session_by_digest(&digest(&session.token))?.is_none());
            Ok(())
        })
        .unwrap();
}

pub(crate) fn assert_conflicts_and_collation(store: &impl IdentityFixture) {
    let prepared = PreparedSignup {
        email: "Mixed@example.com".into(),
        hash: "checked".into(),
    };
    let first = new_session("member:original", "user", 1_000, 7).unwrap();
    store
        .signup_identity(&prepared, &first, 1_000, |found| {
            assert!(found.is_none());
            Ok(())
        })
        .unwrap();
    let second = new_session(&first.principal, "different-kind", 2_000, 7).unwrap();
    store
        .insert_identity_session_atomic(&second, 2_000)
        .unwrap();
    assert_eq!(
        store.principal_facts(&first.principal),
        Some(("user".into(), Some(prepared.email.clone()), 1_000)),
        "ignore must preserve all original principal facts"
    );
    assert!(
        store
            .identity_credential("mixed@example.com")
            .unwrap()
            .is_none(),
        "storage compares exact bytes; normalization is policy"
    );
    assert!(
        store
            .identity_credential("Mixed@example.com")
            .unwrap()
            .is_some()
    );
    // A strict duplicate bearer must roll back the preceding principal insert.
    let mut collision = first.clone();
    collision.principal = "member:must-rollback".into();
    assert!(
        store
            .insert_identity_session_atomic(&collision, 2_001)
            .is_err()
    );
    assert!(store.principal_facts(&collision.principal).is_none());
    assert_eq!(
        store
            .identity_session_expiry(&digest(&first.token))
            .unwrap(),
        Some(first.expires_at)
    );
    // A failure after credential insertion must roll back account and credential.
    let signup = PreparedSignup {
        email: "rollback@example.com".into(),
        hash: "never-commit".into(),
    };
    assert!(
        store
            .signup_identity(&signup, &collision, 2_002, |_| Ok(()))
            .is_err()
    );
    assert!(store.identity_credential(&signup.email).unwrap().is_none());
    assert!(store.principal_facts(&collision.principal).is_none());
    for id in [
        "member:z",
        "member:é",
        "member:A",
        "member:Ω",
        "member:a",
        "member:Z",
    ] {
        let session = new_session(id, "member", 3_000, 7).unwrap();
        store
            .insert_identity_session_atomic(&session, 3_000)
            .unwrap();
    }
    assert_eq!(
        store.principal_ids(),
        [
            "member:A",
            "member:Z",
            "member:a",
            "member:original",
            "member:z",
            "member:é",
            "member:Ω"
        ]
    );
}

pub(crate) fn assert_nulls_counts_and_timestamps(store: &impl IdentityFixture) {
    let now = 1_i64 << 40;
    let principal = "member:counts";
    let legacy = new_session(principal, "member", now, 7).unwrap();
    store.insert_identity_session_atomic(&legacy, now).unwrap();
    store.null_full_family(&digest(&legacy.token));
    assert_eq!(
        store
            .full_rotation_record(&digest(&legacy.token), now)
            .unwrap()
            .unwrap()
            .family,
        digest(&legacy.token)
    );
    let successor = rotate_session_in(store, &legacy.token, now + 1)
        .unwrap()
        .unwrap();
    assert_eq!(
        store
            .full_rotation_record(&digest(&successor.token), now + 1)
            .unwrap()
            .unwrap()
            .family,
        digest(&legacy.token)
    );
    assert_eq!(successor.expires_at, now + 1 + 7 * DAY_MS);
    let second = open_session_for(store, principal, "member", now + 2, 7).unwrap();
    let mut read =
        read_sessions::scoped_session(principal, "member", now + 3, SessionScope::Read).unwrap();
    read.cap_expires_at = Some(now + 123_456);
    store
        .insert_identity_session_atomic(&read, now + 3)
        .unwrap();
    assert_eq!(
        store.identity_session_expiry(&digest(&read.token)).unwrap(),
        read.cap_expires_at
    );
    assert_eq!(store.identity_session_expiry("missing").unwrap(), None);
    assert_eq!(
        store.revoke_identity_principal(principal).unwrap(),
        3,
        "sum both delete row counts"
    );
    assert_eq!(store.revoke_identity_principal(principal).unwrap(), 0);
    store
        .with_identity_tx(|tx| {
            assert_eq!(tx.principal_generation(principal)?, 2);
            Ok(())
        })
        .unwrap();
    assert_eq!(
        store
            .identity_session_expiry(&digest(&second.token))
            .unwrap(),
        None
    );
    let fresh =
        read_sessions::scoped_session(principal, "member", now + 4, SessionScope::Read).unwrap();
    store
        .insert_identity_session_atomic(&fresh, now + 4)
        .unwrap();
    store
        .with_identity_tx(|tx| {
            assert_eq!(
                tx.session_by_digest(&digest(&fresh.token))?
                    .unwrap()
                    .principal_generation,
                Some(2)
            );
            Ok(())
        })
        .unwrap();
    store.close_identity_session(&digest(&fresh.token)).unwrap();
    store.close_identity_session(&digest(&fresh.token)).unwrap();
    assert_eq!(
        store
            .identity_session_expiry(&digest(&fresh.token))
            .unwrap(),
        None
    );
    let mut expired = new_session("member:expired", "member", now, 1).unwrap();
    expired.expires_at = now + 5;
    store
        .insert_identity_session_atomic(&expired, now + 4)
        .unwrap();
    store
        .delete_expired_identity_session(&digest(&expired.token), now + 4)
        .unwrap();
    assert_eq!(
        store
            .identity_session_expiry(&digest(&expired.token))
            .unwrap(),
        Some(now + 5)
    );
    assert!(
        rotate_session_in(store, &expired.token, now + 5)
            .unwrap()
            .is_none()
    );
    assert_eq!(
        store
            .identity_session_expiry(&digest(&expired.token))
            .unwrap(),
        None
    );
    let action = new_session("member:action", "action", now, 1).unwrap();
    store
        .insert_identity_session_atomic(&action, now + 6)
        .unwrap();
    assert!(matches!(
        rotate_session_in(store, &action.token, now + 7),
        Err(RuntimeError::Auth(_))
    ));
}

pub(crate) fn assert_read_family_isolation(store: &impl IdentityFixture) {
    let now = 1_000;
    let first =
        read_sessions::scoped_session("member:read", "member", now, SessionScope::Read).unwrap();
    let family = digest(&first.token);
    let sibling =
        read_sessions::scoped_session(&first.principal, &first.kind, now, SessionScope::Read)
            .unwrap();
    let foreign =
        read_sessions::scoped_session("member:foreign", "member", now, SessionScope::Read).unwrap();
    let mut expired =
        read_sessions::scoped_session("member:expired", "member", now, SessionScope::Read).unwrap();
    expired.expires_at = 2_000;
    store
        .with_identity_tx(|tx| {
            tx.insert_read_session(&first, now, Some((&family, 3)))?;
            tx.insert_read_session(&sibling, now, Some((&family, 3)))?;
            tx.insert_read_session(&foreign, now, Some((&family, 0)))?;
            tx.insert_read_session(&expired, now, None)?;
            Ok(())
        })
        .unwrap();
    // Preserve >= semantics, even for a captured generation above the current one.
    let rotated = read_sessions::rotate(store, &first.token, 2_001)
        .unwrap()
        .unwrap();
    assert_eq!(rotated.cap_expires_at, first.cap_expires_at);
    assert_eq!(
        store
            .identity_session_expiry(&digest(&first.token))
            .unwrap(),
        None
    );
    assert_eq!(
        store
            .identity_session_expiry(&digest(&sibling.token))
            .unwrap(),
        None
    );
    assert!(
        store
            .identity_session_expiry(&digest(&foreign.token))
            .unwrap()
            .is_some()
    );
    assert_eq!(
        store
            .identity_session_expiry(&digest(&expired.token))
            .unwrap(),
        Some(2_000),
        "rotation must not sweep foreign expiry"
    );
    store
        .with_identity_tx(|tx| {
            let fact = tx.session_by_digest(&digest(&rotated.token))?.unwrap();
            assert_eq!(fact.principal_generation, Some(3));
            assert_eq!(fact.family, family);
            Ok(())
        })
        .unwrap();
    let at_cap = read_sessions::rotate(store, &rotated.token, rotated.expires_at - 1)
        .unwrap()
        .unwrap();
    assert_eq!(at_cap.expires_at, rotated.expires_at);
    assert!(
        read_sessions::rotate(store, &at_cap.token, at_cap.cap_expires_at.unwrap())
            .unwrap()
            .is_none()
    );
    // Sign-in, unlike rotation, does collect expired foreign read rows.
    open_session_for(store, "member:signin", "member", 2_002, 7).unwrap();
    assert_eq!(
        store
            .identity_session_expiry(&digest(&expired.token))
            .unwrap(),
        None
    );
}

pub(crate) fn assert_worker_markers(store: &impl IdentityFixture) {
    let manual = open_session_for(store, "service:worker", "service", 1_000, 1).unwrap();
    // Missing legacy marker is NULL, never permission to delete the manual seat.
    store.revoke_worker_family(None).unwrap();
    assert!(
        store
            .full_rotation_record(&digest(&manual.token), 1_001)
            .unwrap()
            .is_some()
    );
    let legacy = store
        .mint_supervised_child(false, 1_001, 17, || {
            new_session("service:worker", "service", 1_001, 1)
        })
        .unwrap();
    assert_eq!(
        store.worker_meta("worker:session-revision"),
        Some("17".into())
    );
    let successor = rotate_session_in(store, &legacy.token, 1_002)
        .unwrap()
        .unwrap();
    assert!(
        store
            .is_supervised_family(&digest(&successor.token))
            .unwrap()
    );
    store.revoke_worker_family(None).unwrap();
    assert!(
        store
            .full_rotation_record(&digest(&successor.token), 1_003)
            .unwrap()
            .is_none()
    );
    assert_eq!(store.worker_meta("worker:session-family"), None);
    assert_eq!(store.worker_meta("worker:session-revision"), None);
    let named = store
        .mint_supervised_child(true, 1_003, 18, || {
            new_session("service:named", "service", 1_003, 1)
        })
        .unwrap();
    assert_eq!(
        store.worker_meta(&format!("worker:family:{}", digest(&named.token))),
        Some("18".into())
    );
    store.set_worker_meta("worker:status", "old");
    store.set_worker_meta("worker:status:named", "old");
    store.set_worker_meta("WORKER:STATUS:retired", "old");
    let case_worker = open_session_for(store, "service:case-variant", "service", 1_004, 1).unwrap();
    let case_key = format!("WORKER:FAMILY:{}", digest(&case_worker.token));
    store.set_worker_meta(&case_key, "18");
    store.set_worker_meta("unrelated", "keep");
    store.clear_worker_families().unwrap();
    assert_eq!(store.worker_meta("worker:status"), None);
    assert_eq!(store.worker_meta("worker:status:named"), None);
    assert_eq!(store.worker_meta("WORKER:STATUS:retired"), None);
    assert_eq!(store.worker_meta("unrelated"), Some("keep".into()));
    assert_eq!(store.worker_meta(&case_key), None);
    assert!(
        store
            .full_rotation_record(&digest(&case_worker.token), 1_005)
            .unwrap()
            .is_none()
    );
    assert!(
        store
            .full_rotation_record(&digest(&manual.token), 1_004)
            .unwrap()
            .is_some()
    );
    assert!(
        store
            .full_rotation_record(&digest(&named.token), 1_004)
            .unwrap()
            .is_none()
    );
}

pub(crate) fn assert_diagnostics(store: &impl IdentityFixture) {
    let full = open_session_for(store, "member:diagnostic", "member", 1_000, 7).unwrap();
    let mut read = read_sessions::scoped_session(
        "member:read-diagnostic",
        "member",
        1_000,
        SessionScope::Read,
    )
    .unwrap();
    read.cap_expires_at = Some(2_000);
    store.insert_identity_session_atomic(&read, 1_000).unwrap();
    for token in [&full.token, &read.token, "unknown"] {
        let hidden = diagnostics::refused_in(store, token, full.expires_at, false);
        assert_eq!(hidden.code, "E_AUTH");
        assert_eq!(hidden.message, "this session is not live; sign in again");
        assert!(
            diagnostics::refused_in(store, token, full.expires_at, true)
                .message
                .contains(if token == "unknown" {
                    "unknown to this store"
                } else {
                    "expired on the server clock"
                })
        );
    }
    assert!(
        diagnostics::refused_in(store, &read.token, 2_000, true)
            .message
            .contains("expired on the server clock")
    );
    store.close_identity_session(&digest(&full.token)).unwrap();
    assert!(
        diagnostics::refused_in(store, &full.token, 2_000, true)
            .message
            .contains("unknown to this store")
    );
    assert_eq!(
        store.identity_session_expiry(&digest(&read.token)).unwrap(),
        Some(2_000)
    );
    store.drop_read_sessions();
    assert!(
        diagnostics::refused_in(store, &read.token, 2_000, true)
            .message
            .contains("unknown to this store")
    );
    assert!(!store.read_sessions_present());
}

/// Exact final authority state after the race's observed order.
#[cfg(feature = "postgres")]
pub(crate) fn rotation_revoke_state(store: &impl IdentityFixture, principal: &str, old: &str, next: &str) -> (i64, bool, bool) {
    store.with_identity_tx(|tx| Ok((tx.principal_generation(principal)?,
        tx.session_by_digest(old)?.is_some(), tx.session_by_digest(next)?.is_some()))).unwrap()
}
