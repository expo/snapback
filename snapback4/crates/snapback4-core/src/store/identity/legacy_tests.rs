//! Pre-upgrade SQLite NUL identities fail closed without creating replacements.
use crate::identity::*;
use crate::{Store, authority::{self, AdmissionStanding}, identity::test_cases::IdentityFixture};
use rusqlite::params;

#[test]
fn legacy_nul_identity_never_authenticates_or_rotates_in_either_scope() {
    for (principal, kind, family) in [
        ("member:old\0id", "member", "family"),
        ("member:old", "old\0kind", "family"),
        ("member:old", "member", "old\0family"),
        ("service:worker\0id", "service", "family"),
        ("service:worker", "service", "old\0family"),
    ] {
        for scope in [SessionScope::Full, SessionScope::Read] {
            let mut store = Store::memory().unwrap();
            // Bypass current policy exactly as a pre-upgrade SQLite file does.
            store.conn().execute("INSERT INTO _principals(id,kind,created_at) VALUES (?1,?2,1000)", params![principal, kind]).unwrap();
            let token = if scope == SessionScope::Full { "legacy-bearer" } else { "ro.legacy-bearer" };
            let token_digest = digest(token);
            if scope == SessionScope::Full {
                store.conn().execute("INSERT INTO _sessions(token_digest,principal,kind,created_at,expires_at,family) VALUES (?1,?2,?3,1000,900000,?4)", params![token_digest, principal, kind, family]).unwrap();
            } else {
                super::initialize_read(store.conn()).unwrap();
                store.conn().execute("INSERT INTO _read_sessions(token_digest,principal,kind,created_at,expires_at,family,cap_expires_at,principal_generation) VALUES (?1,?2,?3,1000,900000,?4,900000,0)", params![token_digest, principal, kind, family]).unwrap();
            }
            let before = store.identity_row_counts();
            let changes = store.conn().total_changes();
            let sample = ServiceSample { now: 2_000, supervisor_revision: 0 };
            assert!(resolve(&store, token, sample.now).unwrap().is_none());
            assert!(resolve_supervised(&store, token, sample).unwrap().is_none());
            let store_id = store.store_id().unwrap();
            assert!(resolve_read_only(&store, token, sample.now, Some(&store_id)).unwrap().is_none());
            assert!(resolve_read_only_supervised(&store, token, sample, Some(&store_id)).unwrap().is_none());
            assert!(current_service(&store, token, sample).unwrap().is_none());
            let tx = store.authority_transaction().unwrap();
            assert!(matches!(authority::admission_authority(&tx, &token_digest, principal, sample.now).unwrap(), AdmissionStanding::SessionNotLive));
            assert!(!authority::live_service_session(&tx, &token_digest, principal, sample.now).unwrap());
            assert!(authority::family_authority_expiry(&tx, principal, family, 0, sample.now).unwrap().is_none());
            tx.rollback().unwrap();
            assert!(rotate_session(&store, token, sample.now).unwrap().is_none());
            for error in [
                narrow_session(&mut store, token, || sample).unwrap_err(),
                logout_session(&mut store, token, || sample.now).unwrap_err(),
            ] {
                assert_eq!(error.to_string(), "E_AUTH: this session is not live; sign in again");
            }
            let refusal = diagnostics::refused(&store, token, sample.now, false);
            assert_eq!(refusal.message, "this session is not live; sign in again");
            assert_eq!(store.identity_row_counts(), before);
            assert_eq!(store.conn().total_changes(), changes, "NUL authority must not write");
        }
    }
}

#[test]
fn legacy_nul_credentials_cannot_sign_in_or_create_sessions() {
    let store = Store::memory().unwrap();
    store.conn().execute("INSERT INTO _principals(id,kind,created_at) VALUES (?1,'user',1000)", ["member:old\0id"]).unwrap();
    for email in ["old\0mail@example.com", "plain@example.com"] {
        // Separate stores are unnecessary: replace the one principal's credential.
        store.conn().execute("INSERT OR REPLACE INTO _credentials(principal,email,hash) VALUES (?1,?2,'unused')", params!["member:old\0id", email]).unwrap();
        let before = store.identity_row_counts();
        let changes = store.conn().total_changes();
        assert_eq!(credential(&store, email).err().unwrap().code(), "E_AUTH");
        assert_eq!(login(&store, email, "correct horse", 2_000).unwrap_err().code(), "E_AUTH");
        for scope in [SessionScope::Full, SessionScope::Read] {
            assert_eq!(finish_login_scoped(&store, Credential { principal: "member:old\0id".into(), hash: "unused".into() }, 2_000, scope).unwrap_err().code(), "E_AUTH");
        }
        assert_eq!(store.identity_row_counts(), before);
        assert_eq!(store.conn().total_changes(), changes);
    }
}

#[test]
fn nul_identity_entry_points_refuse_before_sampling_or_writing() {
    let mut store = Store::memory().unwrap();
    // The target already exists: bound mint must still refuse before lookup.
    store.conn().execute("INSERT INTO _principals(id,kind,created_at) VALUES (?1,'member',1000)", ["member:old\0id"]).unwrap();
    let before = store.identity_row_counts();
    let changes = store.conn().total_changes();
    for (principal, kind, worker, invocation, code, message) in [
        ("member:old\0id", "member", "service:worker", "invocation", "E_AUTH", "a principal is 1–128 printable characters"),
        ("member:x", "mem\0ber", "service:worker", "invocation", "E_AUTH", "a session kind is 1–64 letters, digits, _ or -"),
        ("member:x", "member", "service:bad\0worker", "invocation", "E_AUTH", "a worker principal cannot contain U+0000"),
        ("member:x", "member", "service:worker", "inv\0ocation", "E_INPUT", "binding requires a valid invocationId and intent identity-session/v1"),
    ] {
        let binding = SessionMintBinding { invocation_id: invocation.into(), intent: BOUND_SESSION_INTENT.into(), replace_lost_delivery: true };
        let error = bound_custom_session(&mut store, "unused", worker, "lease", principal, kind,
            || panic!("NUL identity must refuse before the writer"), 7, &binding).unwrap_err();
        assert_eq!(error.to_string(), format!("{code}: {message}"));
    }
    for error in [
        open_session(&store, "member:\0new", "member", 2_000).unwrap_err(),
        custom_session(&store, "member:\0new", "member", 2_000, 7).unwrap_err(),
        custom_session(&store, "member:new", "mem\0ber", 2_000, 7).unwrap_err(),
        service_session(&store, "bad\0worker", 2_000, 7).unwrap_err(),
        mint_supervised_child(&store, Some("bad\0worker"), 2_000, 0).unwrap_err(),
        revoke_principal(&store, "member:\0ghost").unwrap_err(),
        revoke_principal(&store, "member:old\0id").unwrap_err(),
        revoke_worker_family(&store, Some("old\0family")).unwrap_err(),
    ] { assert_eq!(error.code(), "E_AUTH"); }
    assert_eq!(store.identity_row_counts(), before);
    assert_eq!(store.conn().total_changes(), changes);
}
