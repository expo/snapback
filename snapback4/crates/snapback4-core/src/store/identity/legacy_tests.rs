//! Pre-upgrade SQLite rows remain usable and revocable byte for byte.
use crate::identity::*;
use crate::{Store, authority::AuthorityTransaction};
use rusqlite::params;

fn seed(store: &Store) -> Session {
    let session = Session {
        principal: "member:old\0id".into(),
        kind: "old\0kind".into(),
        token: "legacy-bearer".into(),
        expires_at: 1_000 + 7 * DAY_MS,
        scope: SessionScope::Full,
        cap_expires_at: None,
    };
    store
        .conn()
        .execute(
            "INSERT INTO _principals(id,kind,created_at) VALUES (?1,?2,1000)",
            params![session.principal, session.kind],
        )
        .unwrap();
    store.conn().execute("INSERT INTO _sessions(token_digest,principal,kind,created_at,expires_at,family) VALUES (?1,?2,?3,1000,?4,?5)",
        params![digest(&session.token), session.principal, session.kind, session.expires_at, "old\0family"]).unwrap();
    session
}

#[test]
fn legacy_nul_principal_logout_all_advances_generation_and_revokes_bearers() {
    let mut store = Store::memory().unwrap();
    let full = seed(&store);
    assert!(resolve(&store, &full.token, 2_000).unwrap().is_some());
    let read = narrow_session(&mut store, &full.token, || ServiceSample {
        now: 2_000,
        supervisor_revision: 0,
    })
    .unwrap();
    // /auth/logout-all resolves this same principal then calls revoke_principal.
    assert_eq!(revoke_principal(&store, &full.principal).unwrap(), 2);
    let tx = store.authority_transaction().unwrap();
    assert_eq!(tx.principal_generation(&full.principal).unwrap(), 1);
    tx.rollback().unwrap();
    for token in [&full.token, &read.token] {
        assert!(resolve(&store, token, 2_001).unwrap().is_none());
    }
    assert_eq!(revoke_principal(&store, &full.principal).unwrap(), 0);
    let tx = store.authority_transaction().unwrap();
    assert_eq!(tx.principal_generation(&full.principal).unwrap(), 2);
    tx.rollback().unwrap();
}

#[test]
fn legacy_nul_rotation_lookup_and_family_retirement_keep_exact_identity() {
    let mut store = Store::memory().unwrap();
    let full = seed(&store);
    let next = rotate_session(&store, &full.token, 2_000).unwrap().unwrap();
    assert_eq!((&next.principal, &next.kind), (&full.principal, &full.kind));
    assert_eq!(
        store
            .full_rotation_record(&digest(&next.token), 2_000)
            .unwrap()
            .unwrap()
            .family,
        "old\0family"
    );
    let read = narrow_session(&mut store, &next.token, || ServiceSample {
        now: 2_001,
        supervisor_revision: 0,
    })
    .unwrap();
    store
        .conn()
        .execute("UPDATE _read_sessions SET family = ?1", ["read\0family"])
        .unwrap();
    let rotated = rotate_session(&store, &read.token, 2_002).unwrap().unwrap();
    assert_eq!(
        (&rotated.principal, &rotated.kind),
        (&full.principal, &full.kind)
    );
    assert_eq!(
        store
            .conn()
            .query_row("SELECT family FROM _read_sessions", [], |r| r
                .get::<_, String>(0))
            .unwrap(),
        "read\0family"
    );
    // Existing credential lookup/sign-in is not a new identity admission.
    let prepared = prepare_signup("unused@example.com", "correct horse").unwrap();
    store
        .conn()
        .execute(
            "INSERT INTO _credentials(principal,email,hash) VALUES (?1,?2,?3)",
            params![full.principal, "old\0mail@example.com", prepared.hash],
        )
        .unwrap();
    let signed_in = login(&store, "OLD\0MAIL@example.com", "correct horse", 2_003).unwrap();
    assert_eq!(signed_in.principal, full.principal);
    let checked = credential(&store, "old\0mail@example.com")
        .unwrap()
        .unwrap();
    assert_eq!(
        finish_login_scoped(&store, checked, 2_003, SessionScope::Read)
            .unwrap()
            .principal,
        full.principal
    );
    // Family logout accepts the stored principal/family, then worker retirement
    // accepts an existing NUL family instead of turning it into an immortal seat.
    logout_session(&mut store, &next.token, || 2_004).unwrap();
    assert!(resolve(&store, &next.token, 2_004).unwrap().is_none());
    store
        .conn()
        .execute("UPDATE _sessions SET family = ?1", ["worker\0family"])
        .unwrap();
    store.set_meta("worker:family:worker\0family", "0").unwrap();
    revoke_worker_family(&store, Some("worker\0family")).unwrap();
    assert!(resolve(&store, &signed_in.token, 2_004).unwrap().is_none());
    assert!(
        store
            .meta("worker:family:worker\0family")
            .unwrap()
            .is_none()
    );
}

#[test]
fn nul_bound_worker_reports_the_malformed_value_before_sampling() {
    let mut store = Store::memory().unwrap();
    let binding = SessionMintBinding {
        invocation_id: "invocation".into(),
        intent: BOUND_SESSION_INTENT.into(),
        replace_lost_delivery: false,
    };
    let error = bound_custom_session(
        &mut store,
        "unused",
        "service:bad\0worker",
        "lease",
        "member:x",
        "member",
        || panic!("malformed worker must refuse before the writer"),
        7,
        &binding,
    )
    .unwrap_err();
    assert_eq!(
        error.to_string(),
        "E_AUTH: a worker principal cannot contain U+0000"
    );
}
