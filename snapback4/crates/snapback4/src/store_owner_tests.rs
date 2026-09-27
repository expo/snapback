use super::*;
use std::{process::Command, os::unix::fs::PermissionsExt};

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
        // Even rejected ownership attempts must be stat-only on the database:
        // closing a second raw descriptor would discard its POSIX locks.
        owner.path().unwrap();
        assert!(command(&path).is_err());
        assert!(device(&path).is_err());
        assert!(Store::open_shared(&path).is_err());
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
        drop(owner);
    }
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn sidecar_is_private_and_shared_devices_exclude_backend_owners() {
    let dir = std::env::temp_dir().join(format!("snapback4-owner-sidecar-{}", std::process::id()));
    let path = dir.join("store.sqlite");
    let first = device(&path).unwrap();
    let sidecar = snapback4_core::private_fs::owner_path(&path);
    assert_eq!(fs::metadata(&sidecar).unwrap().permissions().mode() & 0o777, 0o600);
    let second = device(&path).unwrap();
    assert!(command(&path).is_err());
    drop(first);
    assert!(command(&path).is_err());
    drop(second);
    drop(command(&path).unwrap());
    assert!(sidecar.is_file(), "do not unlink a lock file other openers may still hold");
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

#[test]
fn busy_missing_database_creates_nothing() {
    let dir = std::env::temp_dir().join(format!("snapback4-owner-missing-{}", std::process::id()));
    let path = dir.join("store.sqlite");
    let owner = command(&path).unwrap();
    let moved = dir.join("moved.sqlite");
    fs::rename(&path, &moved).unwrap();
    let record = dir.join("serve.lock");
    let before = fs::read(&record).unwrap();
    for error in [command(&path).err().unwrap(), device(&path).err().unwrap(), Store::open_shared(&path).err().unwrap().to_string()] {
        assert!(error.contains("E_STORE_BUSY"), "{error}");
        assert!(!path.exists(), "busy probe manufactured a database");
        assert_eq!(fs::read(&record).unwrap(), before);
    }
    assert!(owner.path().is_err());
    drop(owner);
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn hard_linked_databases_refuse_both_paths_and_existing_owners() {
    for separate_directory in [false, true] {
        let dir = std::env::temp_dir().join(format!("snapback4-owner-links-{}-{separate_directory}", std::process::id()));
        let path = dir.join("store.sqlite");
        let owner = command(&path).unwrap();
        let store = owner.open_store(Duration::ZERO).unwrap();
        let other = if separate_directory { dir.join("other/store.sqlite") } else { dir.join("alias.sqlite") };
        fs::create_dir_all(other.parent().unwrap()).unwrap();
        fs::hard_link(&path, &other).unwrap();
        for candidate in [&path, &other] {
            for error in [command(candidate).err().unwrap(), device(candidate).err().unwrap(), Store::open_shared(candidate).err().unwrap().to_string()] {
                assert!(error.contains("E_STORE") && error.contains("copy the store, do not hard-link it"), "{error}");
            }
        }
        assert!(!snapback4_core::private_fs::owner_path(&other).exists());
        assert!(owner.path().unwrap_err().to_string().contains("do not hard-link"));
        assert!(store.check_ownership().is_err());
        fs::remove_file(other).unwrap();
        owner.path().unwrap();
        store.check_ownership().unwrap();
        drop(store); drop(owner);
        fs::remove_dir_all(dir).unwrap();
    }
}

#[test]
fn database_renamed_to_auxiliary_name_is_never_opened_or_truncated() {
    for name in ["store.sqlite-owner", "serve.lock"] {
        let dir = std::env::temp_dir().join(format!("snapback4-owner-rename-{}-{name}", std::process::id()));
        let path = dir.join("store.sqlite");
        let owner = command(&path).unwrap();
        let store = owner.open_store(Duration::ZERO).unwrap();
        store.conn().execute_batch("PRAGMA journal_mode=DELETE; BEGIN IMMEDIATE").unwrap();
        let target = dir.join(name);
        fs::rename(&path, &target).unwrap();
        assert!(address(&path).is_none());
        assert!(regular(&target, true, &path).is_err());
        assert!(command(&path).is_err());
        assert!(device(&path).is_err());
        assert!(Store::open_shared(&path).is_err());
        assert!(!path.exists());
        let output = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "store_owner::tests::external_sqlite_writer", "--nocapture"])
            .env("SNAPBACK4_TEST_SQLITE_OWNER_PATH", &target)
            .env("SNAPBACK4_TEST_SQLITE_EXPECT_BUSY", "1").output().unwrap();
        assert!(output.status.success(), "{name}: {output:?}");
        store.conn().execute_batch("ROLLBACK").unwrap();
        drop(store); drop(owner);
        fs::remove_dir_all(dir).unwrap();
    }
}

#[test]
fn removed_or_replaced_sidecar_revokes_existing_connections() {
    for replace in [false, true] {
        let dir = std::env::temp_dir().join(format!("snapback4-owner-unlink-{}-{replace}", std::process::id()));
        let path = dir.join("store.sqlite");
        let first = command(&path).unwrap();
        let mut store = first.open_store(Duration::ZERO).unwrap();
        let sidecar = snapback4_core::private_fs::owner_path(&path);
        if replace { fs::rename(&sidecar, dir.join("old-owner")).unwrap(); }
        else { fs::remove_file(&sidecar).unwrap(); }
        let error = first.path().unwrap_err().to_string();
        assert!(error.contains("E_STORE") && error.contains("sidecar"), "{error}");
        assert!(store.transaction().is_err());
        assert!(store.read_transaction().is_err());
        assert!(store.reader().is_err());
        let second = command(&path).unwrap();
        second.open_store(Duration::ZERO).unwrap().set_meta("sole_owner", "second").unwrap();
        assert!(first.open_store(Duration::ZERO).is_err());
        assert!(store.set_meta("sole_owner", "first").is_err());
        drop(second); drop(store); drop(first);
        fs::remove_dir_all(dir).unwrap();
    }
}
