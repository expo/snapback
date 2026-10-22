//! Regression witnesses for the shared engine's direct identity members.
use crate::{
    identity::{self, IdentityStore, SessionScope},
    store_port::AnyStore,
};
use rusqlite::hooks::{AuthAction, AuthContext, Authorization, TransactionOperation};
use std::sync::{Arc, Mutex};

fn session(principal: &str, token: &str, expires_at: i64) -> identity::Session {
    identity::Session {
        principal: principal.into(),
        kind: "user".into(),
        token: token.into(),
        expires_at,
        scope: SessionScope::Full,
        cap_expires_at: None,
    }
}
fn count(store: &AnyStore, table: &str) -> i64 {
    store
        .test_support_conn()
        .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
        .unwrap()
}
fn endings(store: &AnyStore) -> Arc<Mutex<Vec<&'static str>>> {
    let events = Arc::new(Mutex::new(Vec::new()));
    let observed = events.clone();
    store
        .test_support_conn()
        .authorizer(Some(move |ctx: AuthContext<'_>| {
            if let AuthAction::Transaction { operation } = ctx.action {
                match operation {
                    TransactionOperation::Begin => observed.lock().unwrap().push("begin"),
                    TransactionOperation::Rollback => observed.lock().unwrap().push("rollback"),
                    _ => {}
                }
            }
            Authorization::Allow
        }))
        .unwrap();
    let committed = events.clone();
    store
        .test_support_conn()
        .commit_hook(Some(move || {
            committed.lock().unwrap().push("commit");
            false
        }))
        .unwrap();
    events
}

#[test]
fn convenience_mint_and_close_keep_their_original_partial_durability() {
    let store = AnyStore::memory().unwrap();
    store
        .insert_identity_session_atomic(&session("member:expired", "expired", 2), 1)
        .unwrap();
    store.test_support_conn().execute_batch("CREATE TRIGGER reject_mint BEFORE INSERT ON _sessions BEGIN SELECT RAISE(ABORT, 'no mint'); END;").unwrap();
    let error = store
        .insert_identity_session(&session("member:new", "new", 100), 3)
        .unwrap_err();
    assert_eq!(error.code(), "E_STORE");
    assert_eq!(
        count(&store, "_sessions"),
        0,
        "the convenience sweep already committed"
    );
    assert_eq!(
        count(&store, "_principals"),
        2,
        "principal insert already committed"
    );
    store
        .test_support_conn()
        .execute_batch("DROP TRIGGER reject_mint")
        .unwrap();
    let full = session("member:new", "both", 100);
    store.insert_identity_session_atomic(&full, 3).unwrap();
    let mut read = full.clone();
    read.scope = SessionScope::Read;
    read.cap_expires_at = Some(100);
    store.insert_identity_session_atomic(&read, 3).unwrap();
    store.test_support_conn().execute_batch("CREATE TRIGGER reject_close BEFORE DELETE ON _read_sessions BEGIN SELECT RAISE(ABORT, 'no close'); END;").unwrap();
    assert!(identity::close_session(&store, &full.token).is_err());
    assert_eq!(count(&store, "_sessions"), 0);
    assert_eq!(count(&store, "_read_sessions"), 1);
}

#[test]
fn atomic_mint_and_refresh_undo_sweeps_and_replacement_on_failure() {
    let store = AnyStore::memory().unwrap();
    store
        .insert_identity_session_atomic(&session("member:expired", "expired", 2), 1)
        .unwrap();
    let original = identity::open_session(&store, "member:live", "user", 1).unwrap();
    store.test_support_conn().execute_batch("CREATE TRIGGER reject_mint BEFORE INSERT ON _sessions BEGIN SELECT RAISE(ABORT, 'no mint'); END;").unwrap();
    assert!(
        store
            .insert_identity_session_atomic(&session("member:new", "new", 100), 3)
            .is_err()
    );
    assert_eq!(count(&store, "_sessions"), 2);
    assert_eq!(count(&store, "_principals"), 2);
    assert!(identity::rotate_session(&store, &original.token, 3).is_err());
    assert_eq!(
        count(&store, "_sessions"),
        2,
        "refresh's removal and expiry sweep rolled back"
    );
    assert!(
        identity::resolve(&store, &original.token, 3)
            .unwrap()
            .is_some()
    );
}

#[test]
fn empty_full_refresh_commits_cleanup_but_read_refresh_aborts_without_sweeping() {
    let store = AnyStore::memory().unwrap();
    let read =
        identity::guest_scoped(&store, 1, &mut Default::default(), SessionScope::Read).unwrap();
    store
        .insert_identity_session_atomic(&session("member:expired", "expired", 2), 1)
        .unwrap();
    let events = endings(&store);
    assert!(
        !store
            .replace_full_session(
                "missing-full-digest",
                &session("member:unused", "unused", 100),
                "family",
                3
            )
            .unwrap()
    );
    assert_eq!(events.lock().unwrap().last(), Some(&"commit"));
    assert_eq!(count(&store, "_sessions"), 0);
    events.lock().unwrap().clear();
    assert!(
        identity::rotate_session(&store, &read.token, read.expires_at)
            .unwrap()
            .is_none()
    );
    assert_eq!(events.lock().unwrap().last(), Some(&"rollback"));
    assert_eq!(count(&store, "_read_sessions"), 1);
    assert_eq!(count(&store, "_commits"), 0);
    assert_eq!(count(&store, "_ops"), 0);
}

#[test]
fn physical_commit_failure_does_not_acknowledge_a_session() {
    let store = AnyStore::memory().unwrap();
    store
        .test_support_conn()
        .commit_hook(Some(|| true))
        .unwrap();
    assert!(identity::guest(&store, 1, &mut Default::default()).is_err());
    store
        .test_support_conn()
        .commit_hook(None::<fn() -> bool>)
        .unwrap();
    assert_eq!(count(&store, "_sessions"), 0);
    assert_eq!(count(&store, "_principals"), 0);
}

#[test]
fn logout_samples_time_inside_the_immediate_member_and_keeps_family_semantics() {
    let mut store = AnyStore::memory().unwrap();
    let original = identity::guest(&store, 1, &mut Default::default()).unwrap();
    let rotated = identity::rotate_session(&store, &original.token, 2)
        .unwrap()
        .unwrap();
    let events = endings(&store);
    identity::logout_session(&mut store, &rotated.token, || {
        assert_eq!(events.lock().unwrap().last(), Some(&"begin"));
        3
    })
    .unwrap();
    assert_eq!(events.lock().unwrap().last(), Some(&"commit"));
    assert!(
        identity::resolve(&store, &rotated.token, 3)
            .unwrap()
            .is_none()
    );
    assert_eq!(count(&store, "_commits"), 0);
    assert_eq!(count(&store, "_ops"), 0);
}

#[test]
fn convenience_read_mint_keeps_lazy_storage_after_a_failed_insert() {
    let store = AnyStore::memory().unwrap();
    store
        .test_support_conn()
        .authorizer(Some(|ctx: AuthContext<'_>| match ctx.action {
            AuthAction::Insert {
                table_name: "_read_sessions",
            } => Authorization::Deny,
            _ => Authorization::Allow,
        }))
        .unwrap();
    let mut read = session("member:read", "read", 100);
    read.scope = SessionScope::Read;
    read.cap_expires_at = Some(100);
    assert!(store.insert_identity_session(&read, 1).is_err());
    store
        .test_support_conn()
        .authorizer(None::<fn(AuthContext<'_>) -> Authorization>)
        .unwrap();
    assert_eq!(count(&store, "_principals"), 1);
    assert_eq!(
        count(&store, "_read_sessions"),
        0,
        "the lazy table survived the failed insert"
    );
    let indexes: i64 = store
        .test_support_conn()
        .query_row(
            "SELECT count(*) FROM sqlite_schema WHERE name = '_read_sessions_family'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        indexes, 1,
        "the lazy index committed before the failed insert"
    );
}
