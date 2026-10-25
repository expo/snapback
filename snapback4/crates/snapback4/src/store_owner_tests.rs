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
        (&store).test_support_conn().execute_batch(&format!("PRAGMA journal_mode = {mode}; BEGIN IMMEDIATE")).unwrap();
        // Even rejected ownership attempts must be stat-only on the database:
        // closing a second raw descriptor would discard its POSIX locks.
        owner.path().unwrap();
        assert!(command(&path).is_err());
        assert!(device(&path).is_err());
        assert!(snapback4_core::Store::open_shared(&path).is_err());
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
        (&store).test_support_conn().execute_batch("ROLLBACK").unwrap();
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
    for error in [command(&path).err().unwrap(), device(&path).err().unwrap(), snapback4_core::Store::open_shared(&path).err().unwrap().to_string()] {
        assert!(error.contains("E_STORE_BUSY"), "{error}");
        assert!(error.contains("ends exclusion") && error.contains("does not stop that process"), "{error}");
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
            for error in [command(candidate).err().unwrap(), device(candidate).err().unwrap(), snapback4_core::Store::open_shared(candidate).err().unwrap().to_string()] {
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
        (&store).test_support_conn().execute_batch("PRAGMA journal_mode=DELETE; BEGIN IMMEDIATE").unwrap();
        let target = dir.join(name);
        fs::rename(&path, &target).unwrap();
        assert!(address(&path).is_none());
        assert!(regular(&target, true, &path).is_err());
        assert!(command(&path).is_err());
        assert!(device(&path).is_err());
        assert!(snapback4_core::Store::open_shared(&path).is_err());
        assert!(!path.exists());
        let output = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "store_owner::tests::external_sqlite_writer", "--nocapture"])
            .env("SNAPBACK4_TEST_SQLITE_OWNER_PATH", &target)
            .env("SNAPBACK4_TEST_SQLITE_EXPECT_BUSY", "1").output().unwrap();
        assert!(output.status.success(), "{name}: {output:?}");
        (&store).test_support_conn().execute_batch("ROLLBACK").unwrap();
        drop(store); drop(owner);
        fs::remove_dir_all(dir).unwrap();
    }
}

#[test]
fn removed_or_replaced_sidecar_ends_exclusion_documented_boundary() {
    for replace in [false, true] {
        let dir = std::env::temp_dir().join(format!("snapback4-owner-unlink-{}-{replace}", std::process::id()));
        let path = dir.join("store.sqlite");
        let first = command(&path).unwrap();
        let mut store = first.open_store(Duration::ZERO).unwrap();
        let sidecar = snapback4_core::private_fs::owner_path(&path);
        if replace { fs::rename(&sidecar, dir.join("old-owner")).unwrap(); }
        else { fs::remove_file(&sidecar).unwrap(); }
        // @ref LLP 3000.019#3.4 — removing the name ends exclusion, not the old connection's work.
        first.path().unwrap();
        store.transaction().unwrap().commit().unwrap();
        store.read_transaction().unwrap().commit().unwrap();
        store.reader().unwrap();
        let second = command(&path).unwrap();
        let other = second.open_store(Duration::ZERO).unwrap();
        other.set_dev_value(snapback4_core::metadata::DevMetadata::Replay, "second").unwrap();
        assert_eq!(store.dev_value(snapback4_core::metadata::DevMetadata::Replay).unwrap().as_deref(), Some("second"));
        store.set_dev_value(snapback4_core::metadata::DevMetadata::Replay, "first").unwrap();
        assert_eq!(other.dev_value(snapback4_core::metadata::DevMetadata::Replay).unwrap().as_deref(), Some("first"));
        first.open_store(Duration::ZERO).unwrap();
        assert!(command(&path).err().unwrap().contains("E_STORE_BUSY"));
        drop(other);
        drop(second); drop(store); drop(first);
        fs::remove_dir_all(dir).unwrap();
    }
}

#[test]
fn address_cleanup_preserves_replacements_and_the_ownership_sidecar() {
    let dir = std::env::temp_dir().join(format!("snapback4-owner-cleanup-{}", std::process::id()));
    let path = dir.join("store.sqlite");
    let mut owner = command(&path).unwrap();
    announce(&mut owner, "127.0.0.1:4567".parse().unwrap()).unwrap();
    let record = dir.join("serve.lock");
    owner.clear_address();
    assert!(!record.exists());
    assert!(snapback4_core::private_fs::owner_path(&path).exists());
    drop(owner);
    let mut owner = command(&path).unwrap();
    announce(&mut owner, "127.0.0.1:4567".parse().unwrap()).unwrap();
    fs::rename(&record, dir.join("old-address")).unwrap();
    fs::write(&record, "replacement").unwrap();
    drop(owner);
    assert_eq!(fs::read_to_string(record).unwrap(), "replacement");
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn release_barrier_waits_for_the_real_lock_without_changing_files() {
    let dir=std::env::temp_dir().join(format!("snapback4-owner-barrier-{}",std::process::id()));
    let path=dir.join("store.sqlite");
    let owner=command(&path).unwrap();
    let record=dir.join("serve.lock");let before=fs::read(&record).unwrap();
    let error=wait_released(&path,Duration::from_millis(50)).unwrap_err();assert!(error.contains("E_STORE_BUSY"),"{error}");
    assert_eq!(fs::read(&record).unwrap(),before);
    let release=std::thread::spawn(move||{std::thread::sleep(Duration::from_millis(120));drop(owner);});
    let start=std::time::Instant::now();wait_released(&path,Duration::from_secs(2)).unwrap();
    assert!(start.elapsed()>=Duration::from_millis(100));release.join().unwrap();
    // A barrier neither clears the retained address nor opens SQLite.
    let names=||{let mut names=fs::read_dir(&dir).unwrap().map(|f|f.unwrap().file_name()).collect::<Vec<_>>();names.sort();names};
    // Parallel tests may fork while a barrier briefly owns this descriptor;
    // its close-on-exec duplicate can outlive the first barrier's return.
    // Check read-only behavior with the same bounded wait, not an idle-host assumption.
    let before=names();wait_released(&path,Duration::from_secs(2)).unwrap();assert_eq!(names(),before);
    let missing=dir.join("missing/store.sqlite");assert!(wait_released(&missing,Duration::ZERO).is_err());assert!(!missing.parent().unwrap().exists());
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn release_command_waits_for_an_unannounced_owner_then_acquires_exclusively() {
    let dir=std::env::temp_dir().join(format!("snapback4-owner-release-wait-{}",std::process::id()));
    let path=dir.join("store.sqlite");let owner=command(&path).unwrap();
    let release=std::thread::spawn(move||{std::thread::sleep(Duration::from_millis(120));drop(owner);});
    let start=std::time::Instant::now();let next=release_command(&path).unwrap();
    assert!(start.elapsed()>=Duration::from_millis(100));assert!(command(&path).is_err());
    release.join().unwrap();drop(next);fs::remove_dir_all(dir).unwrap();
}


// A package-only build links ordinary core; workspace feature unification can
// enable evaluation-support. Assert the policy actually compiled into core.
#[test]
fn store_admits_exact_evaluation_tracker_only_with_evaluation_support() {
    fn execute(store: &snapback4_core::Store, sql: &str) {
        store.test_support_conn().execute_batch(sql).unwrap();
    }
    let mut store=snapback4_core::Store::memory().unwrap();
    let schema=snapback4_core::Schema::default();
    store.install(&schema).unwrap();
    execute(&store,
        "CREATE TEMP TABLE dt_dirty(t INTEGER PRIMARY KEY);
         CREATE TEMP TRIGGER dt_track_0_INSERT AFTER INSERT ON \"r\" BEGIN INSERT OR IGNORE INTO dt_dirty VALUES (0); END;"
    );
    let installed=store.install(&schema);
    if snapback4_core::Store::TEST_SUPPORT_EVALUATION_ENABLED {
        installed.unwrap();
    } else {
        let error=installed.unwrap_err();
        assert_eq!(error.code(),"E_STORE");
        assert!(error.to_string().contains("SNAPBACK_MANAGED_RELATION_INTERCEPTION"),"{error}");
    }
    // The evaluator exception never permits a different trigger body.
    execute(&store,
        "DROP TRIGGER dt_track_0_INSERT;
         CREATE TEMP TRIGGER dt_track_0_INSERT AFTER INSERT ON r BEGIN DELETE FROM r; END;"
    );
    let error=store.install(&schema).unwrap_err();
    assert_eq!(error.code(),"E_STORE");
    assert!(error.to_string().contains("SNAPBACK_MANAGED_RELATION_INTERCEPTION"),"{error}");
}
