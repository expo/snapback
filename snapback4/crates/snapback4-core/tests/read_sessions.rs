// @ref LLP 3000.033#3 — stored authority, fixed caps and writer races.
use snapback4_core::{identity::{self, SessionScope, ServiceSample}, Store};
use sha2::{Digest, Sha256};
use rusqlite::params;
const DAY: i64 = 86_400_000;
fn sample(now: i64) -> ServiceSample { ServiceSample { now, supervisor_revision: 0 } }
fn digest(token: &str) -> String { format!("{:x}", Sha256::digest(token.as_bytes())) }
fn read_rows(store: &Store) -> Vec<String> {
    if !store.conn().query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name = '_read_sessions')", [], |r| r.get::<_, bool>(0)).unwrap() { return vec![]; }
    store.conn().prepare("SELECT token_digest FROM _read_sessions ORDER BY token_digest").unwrap()
        .query_map([], |r| r.get(0)).unwrap().map(Result::unwrap).collect()
}

#[test]
fn cap_scope_family_and_foreign_expiry_survive_rotation() {
    let mut store = Store::memory().unwrap();
    let parent = identity::custom_session(&store, "member:bob", "member", 100, 30).unwrap();
    let mut read = identity::narrow_session(&mut store, &parent.token, || sample(200)).unwrap();
    assert!(read.token.starts_with("ro."));
    assert_eq!(read.cap_expires_at, Some(parent.expires_at));
    assert_eq!(read.expires_at, 200 + 7 * DAY);
    store.conn().execute("INSERT INTO _sessions VALUES ('foreign','other','user',0,1,'foreign')", []).unwrap();
    let cap = read.cap_expires_at.unwrap();
    for now in [300, 6 * DAY, 12 * DAY, 18 * DAY, 24 * DAY, cap - 1] {
        // Each iteration is within the previous session's current expiry.
        let old = read.token.clone();
        read = identity::rotate_session(&store, &old, now).unwrap().unwrap();
        assert_eq!(read.cap_expires_at, Some(cap));
        assert_eq!(read.expires_at, (now + 7 * DAY).min(cap));
        assert!(identity::resolve(&store, &old, now).unwrap().is_none());
        assert_eq!(identity::resolve(&store, &read.token, now).unwrap().unwrap().2, SessionScope::Read);
        let (stored_cap, generation): (i64, i64) = store.conn().query_row("SELECT cap_expires_at, principal_generation FROM _read_sessions WHERE token_digest=?1", [digest(&read.token)], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!((stored_cap, generation), (cap, 0));
        let count: i64 = store.conn().query_row("SELECT count(*) FROM _sessions WHERE token_digest=?1", [digest(&read.token)], |r| r.get(0)).unwrap();
        assert_eq!(count, 0);
        let foreign: i64 = store.conn().query_row("SELECT count(*) FROM _sessions WHERE token_digest='foreign'", [], |r| r.get(0)).unwrap();
        assert_eq!(foreign, 1);
    }
    assert!(identity::rotate_session(&store, &read.token, cap).unwrap().is_none());
    assert!(identity::resolve(&store, &read.token, cap).unwrap().is_none());
}

#[test]
fn independent_logout_and_generation_revocation() {
    for parent_first in [false, true] {
        let mut store = Store::memory().unwrap();
        let parent = identity::open_session(&store, "bob", "member", 0).unwrap();
        let read = identity::narrow_session(&mut store, &parent.token, || sample(1)).unwrap();
        let (ended, live) = if parent_first { (&parent.token, &read.token) } else { (&read.token, &parent.token) };
        identity::logout_session(&mut store, ended, || 2).unwrap();
        assert!(identity::resolve(&store, ended, 3).unwrap().is_none());
        assert!(identity::resolve(&store, live, 3).unwrap().is_some());
    }
    let mut store = Store::memory().unwrap();
    let parent = identity::open_session(&store, "bob", "member", 0).unwrap();
    let read = identity::narrow_session(&mut store, &parent.token, || sample(1)).unwrap();
    let id = store.meta("store_id").unwrap();
    assert_eq!(identity::resolve(&store, &read.token, 2).unwrap().unwrap().2, SessionScope::Read);
    assert_eq!(identity::resolve_supervised(&store, &read.token, sample(2)).unwrap().unwrap().2, SessionScope::Read);
    assert_eq!(identity::resolve_read_only_supervised(&store, &read.token, sample(2), id.as_deref()).unwrap().unwrap().2, SessionScope::Read);
    assert_eq!(identity::resolve_read_only(&store, &read.token, 2, id.as_deref()).unwrap().unwrap().2, SessionScope::Read);
    // Exactly the old executable's revoke-principal transaction: it knows no read table.
    store.conn().execute_batch("BEGIN IMMEDIATE; INSERT INTO _principal_generations VALUES ('bob',1); DELETE FROM _sessions WHERE principal='bob'; COMMIT;").unwrap();
    assert!(identity::resolve(&store, &read.token, 2).unwrap().is_none());
    assert!(identity::resolve_supervised(&store, &read.token, sample(2)).unwrap().is_none());
    assert!(identity::resolve_read_only_supervised(&store, &read.token, sample(2), id.as_deref()).unwrap().is_none());
    assert!(identity::resolve_read_only(&store, &read.token, 2, id.as_deref()).unwrap().is_none());
    assert!(identity::rotate_session(&store, &read.token, 2).unwrap().is_none());
}

#[test]
fn eligibility_and_direct_signin_scope() {
    let mut store = Store::memory().unwrap();
    for kind in ["service", "action", "member", "account"] {
        let parent = identity::open_session(&store, "bob", kind, 0).unwrap();
        let before = read_rows(&store);
        let narrowed = identity::narrow_session(&mut store, &parent.token, || sample(1));
        assert_eq!(narrowed.is_ok(), matches!(kind, "member" | "account"));
        if narrowed.is_err() { assert_eq!(read_rows(&store), before, "refused narrowing committed no sibling"); }
    }
    let parent = identity::open_session(&store, "bob", "member", 0).unwrap();
    store.conn().execute("INSERT INTO _meta(key,value) VALUES (?1,'0')", [format!("worker:family:{}", digest(&parent.token))]).unwrap();
    let before = read_rows(&store);
    assert!(identity::narrow_session(&mut store, &parent.token, || sample(1)).is_err());
    assert_eq!(read_rows(&store), before);
    let read = identity::guest_scoped(&store, 1, &mut 0, SessionScope::Read).unwrap();
    assert_eq!(read.cap_expires_at, Some(read.expires_at));
    assert_eq!(identity::resolve(&store, &read.token, 2).unwrap().unwrap().2, SessionScope::Read);
    let before = read_rows(&store);
    assert!(identity::narrow_session(&mut store, &read.token, || sample(2)).is_err());
    assert_eq!(read_rows(&store), before);
    let rotated = identity::rotate_session(&store, &read.token, 3).unwrap().unwrap();
    assert_eq!(rotated.expires_at, read.expires_at);
    assert_eq!(rotated.cap_expires_at, read.cap_expires_at);
    assert_eq!(identity::revoke_principal(&store, &read.principal).unwrap(), 1);
    assert!(identity::resolve(&store, &rotated.token, 4).unwrap().is_none());
}

#[test]
fn queued_narrow_samples_authority_after_writer_lock() {
    for revoke in [false, true] {
        let dir = std::env::temp_dir().join(format!("sb4-ro-race-{}-{revoke}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("store.sqlite");
        let mut store = Store::open(&path).unwrap();
        let parent = identity::open_session(&store, "bob", "member", 0).unwrap();
        let locker = rusqlite::Connection::open(&path).unwrap();
        locker.execute_batch("BEGIN IMMEDIATE").unwrap();
        static WAITING: std::sync::Mutex<Option<std::sync::mpsc::Sender<()>>> = std::sync::Mutex::new(None);
        fn busy(_: i32) -> bool {
            if let Some(sender)=WAITING.lock().unwrap().take() { sender.send(()).unwrap(); }
            std::thread::yield_now(); true
        }
        let (entered, waiting) = std::sync::mpsc::channel();
        *WAITING.lock().unwrap()=Some(entered);
        store.conn().busy_handler(Some(busy)).unwrap();
        let clock=std::sync::Arc::new(std::sync::atomic::AtomicI64::new(1));
        let worker_clock=clock.clone();
        let token = parent.token.clone();
        let worker = std::thread::spawn(move || {
            identity::narrow_session(&mut store, &token, || sample(worker_clock.load(std::sync::atomic::Ordering::SeqCst)))
        });
        waiting.recv_timeout(std::time::Duration::from_secs(5)).expect("narrow is queued on the held SQLite writer");
        clock.store(if revoke {2}else{parent.expires_at},std::sync::atomic::Ordering::SeqCst);
        if revoke {
            locker.execute("INSERT INTO _principal_generations VALUES ('bob',1)", []).unwrap();
            locker.execute("DELETE FROM _sessions WHERE principal=?1", params!["bob"]).unwrap();
        }
        locker.execute_batch("COMMIT").unwrap();
        assert!(worker.join().unwrap().is_err());
        let installed: bool = locker.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name = '_read_sessions')", [], |r| r.get(0)).unwrap();
        assert!(!installed, "expired/revoked parent must not even install read-session storage");
        drop(locker);
        let _ = std::fs::remove_dir_all(dir);
    }
}

#[test]
fn signin_collects_foreign_read_expiry_but_read_refresh_does_not() {
    for scope in [SessionScope::Full, SessionScope::Read] {
        let store = Store::memory().unwrap();
        let read = identity::guest_scoped(&store, 0, &mut 0, SessionScope::Read).unwrap();
        // Both inclusive boundaries independently qualify; a still-live foreign row survives.
        for (id, expiry, cap) in [("expires", 10, 100), ("cap", 100, 10), ("live", 100, 100)] {
            store.conn().execute("INSERT INTO _read_sessions VALUES (?1,'foreign','user',?1,0,?2,?3,0)", params![id, expiry, cap]).unwrap();
        }
        let rotated = identity::rotate_session(&store, &read.token, 10).unwrap().unwrap();
        let rows = read_rows(&store);
        for id in ["expires", "cap", "live"] { assert!(rows.contains(&id.to_string())); }
        identity::guest_scoped(&store, 10, &mut 1, scope).unwrap();
        let rows = read_rows(&store);
        assert!(!rows.contains(&"expires".to_string())); assert!(!rows.contains(&"cap".to_string()));
        assert!(rows.contains(&"live".to_string())); assert!(rows.contains(&digest(&rotated.token)));
    }
}

#[test]
fn absent_read_storage_is_empty_without_writes_and_full_logout_still_works() {
    let mut store = Store::memory().unwrap();
    let full = identity::open_session(&store, "bob", "member", 0).unwrap();
    let changes = store.conn().total_changes();
    let store_id = store.meta("store_id").unwrap();
    assert!(identity::resolve(&store, "ro.absent", 1).unwrap().is_none());
    assert!(identity::resolve_read_only(&store, "ro.absent", 1, store_id.as_deref()).unwrap().is_none());
    assert!(identity::resolve_supervised(&store, "ro.absent", sample(1)).unwrap().is_none());
    assert!(identity::resolve_read_only_supervised(&store, "ro.absent", sample(1), store_id.as_deref()).unwrap().is_none());
    assert!(identity::rotate_session(&store, "ro.absent", 1).unwrap().is_none());
    identity::close_session(&store, "ro.absent").unwrap();
    assert!(identity::logout_session(&mut store, "ro.absent", || 1).is_err());
    assert_eq!(store.conn().total_changes(), changes);
    assert_eq!(identity::resolve(&store, &full.token, 1).unwrap().unwrap().2, SessionScope::Full);
    identity::logout_session(&mut store, &full.token, || 1).unwrap();
    assert_eq!(identity::revoke_principal(&store, "bob").unwrap(), 0);
    let installed: bool = store.conn().query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name = '_read_sessions')", [], |r| r.get(0)).unwrap();
    assert!(!installed, "reads and full-session logout must never create read storage");
    let read = identity::guest_scoped(&store, 2, &mut 0, SessionScope::Read).unwrap();
    assert_eq!(identity::resolve(&store, &read.token, 3).unwrap().unwrap().2, SessionScope::Read);
    identity::logout_session(&mut store, &read.token, || 3).unwrap();
    assert!(identity::resolve(&store, &read.token, 3).unwrap().is_none());
}

#[test]
fn malformed_read_storage_is_an_error_not_empty_authority() {
    let store = Store::memory().unwrap();
    store.conn().execute_batch("CREATE TABLE _read_sessions (wrong_column TEXT)").unwrap();
    let store_id = store.meta("store_id").unwrap();
    assert!(identity::resolve_read_only(&store, "ro.absent", 1, store_id.as_deref()).is_err());
    assert!(identity::rotate_session(&store, "ro.absent", 1).is_err());
}
