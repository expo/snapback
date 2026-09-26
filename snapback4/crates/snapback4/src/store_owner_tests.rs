use super::*;
use std::process::Command;

#[test]
fn external_sqlite_writer() {
    let Ok(path) = std::env::var("SNAPBACK4_TEST_SQLITE_OWNER_PATH") else { return };
    let connection = rusqlite::Connection::open(path).unwrap();
    connection.busy_timeout(Duration::ZERO).unwrap();
    let result = connection.execute_batch("BEGIN IMMEDIATE; ROLLBACK");
    if std::env::var_os("SNAPBACK4_TEST_SQLITE_EXPECT_BUSY").is_some() {
        assert_eq!(result.unwrap_err().sqlite_error_code(), Some(rusqlite::ErrorCode::DatabaseBusy));
    } else { result.unwrap(); }
}

#[test]
fn database_ownership_preserves_sqlites_posix_locks() {
    let dir = std::env::temp_dir().join(format!("snapback4-owner-posix-{}", std::process::id()));
    for mode in ["DELETE", "WAL"] {
        let path = dir.join(format!("{mode}.sqlite"));
        let mut owner = command(&path).unwrap();
        let store = owner.open_store(Duration::ZERO).unwrap();
        store.conn().execute_batch(&format!("PRAGMA journal_mode = {mode}; BEGIN IMMEDIATE")).unwrap();
        // All guard operations after SQLite takes its lock must be stat-only
        // on the database, and the descriptor must remain alive throughout.
        owner.path().unwrap();
        announce(&mut owner, "127.0.0.1:4567".parse().unwrap()).unwrap();
        let run = |busy: bool| {
            let mut child = Command::new(std::env::current_exe().unwrap());
            child.args(["--exact", "store_owner::tests::external_sqlite_writer", "--nocapture"])
                .env("SNAPBACK4_TEST_SQLITE_OWNER_PATH", &path);
            if busy { child.env("SNAPBACK4_TEST_SQLITE_EXPECT_BUSY", "1"); }
            let output = child.output().unwrap();
            assert!(output.status.success(), "{mode}: {output:?}");
        };
        run(true);
        store.conn().execute_batch("ROLLBACK").unwrap();
        run(false); // The ownership flock does not replace SQLite's own locks.
        drop(store);
        drop(owner); // Never close the raw descriptor while SQLite holds it.
    }
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn replaced_canonical_path_cannot_be_opened_with_the_old_guard() {
    let dir = std::env::temp_dir().join(format!("snapback4-owner-replace-{}", std::process::id()));
    let path = dir.join("store.sqlite");
    let owner = command(&path).unwrap();
    fs::rename(&path, dir.join("moved.sqlite")).unwrap();
    assert!(owner.open_store(Duration::ZERO).is_err());
    fs::write(&path, []).unwrap();
    assert!(owner.open_store(Duration::ZERO).is_err());
    drop(owner);
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn doctor_dials_the_published_loopback_address() {
    use std::net::SocketAddr;
    let at = |s: &str| s.parse::<SocketAddr>().unwrap();
    assert_eq!(dialable("http://127.0.0.1:4400"), Some(at("127.0.0.1:4400")));
    assert_eq!(dialable("http://[::1]:4400"), Some(at("[::1]:4400")));
    assert_eq!(dialable("http://0.0.0.0:4400"), Some(at("127.0.0.1:4400")));
    assert_eq!(dialable("http://[::]:4400"), Some(at("[::1]:4400")));
    for published in ["http://192.168.1.2:4400", "http://[2001:db8::1]:4400", "http://127.0.0.1:0", "https://127.0.0.1:4400", "4400", ""] {
        assert_eq!(dialable(published), None, "{published}");
    }
}
