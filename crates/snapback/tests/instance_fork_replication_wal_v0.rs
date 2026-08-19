use snapback::instance_fork::{
    BASE_SNAPSHOT_FILE, ensure_expected_app, inspect_boot_at, publish_managed_with_base,
};
use snapback_kernel::storage::LocalDatabase;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

struct ReplicationTargetGuard {
    previous: Option<OsString>,
}

impl ReplicationTargetGuard {
    fn install(target: &Path) -> Self {
        let previous = std::env::var_os("SNAPBACK_REPLICATION_TARGET");
        // SAFETY: this integration-test binary contains only this test, so no
        // peer can observe its temporary process-global replication target.
        unsafe {
            std::env::set_var(
                "SNAPBACK_REPLICATION_TARGET",
                format!("file://{}", target.display()),
            );
        }
        Self { previous }
    }
}

impl Drop for ReplicationTargetGuard {
    fn drop(&mut self) {
        unsafe {
            match self.previous.take() {
                Some(value) => std::env::set_var("SNAPBACK_REPLICATION_TARGET", value),
                None => std::env::remove_var("SNAPBACK_REPLICATION_TARGET"),
            }
        }
    }
}

fn sqlite_sidecar(database: &Path, suffix: &str) -> PathBuf {
    let mut path = database.as_os_str().to_os_string();
    path.push(suffix);
    PathBuf::from(path)
}

#[test]
fn replication_configured_fork_preserves_parent_and_scrub_wals() {
    let directory = tempfile::tempdir().expect("temporary fork fixture");
    let _replication =
        ReplicationTargetGuard::install(&directory.path().join("replication-target"));
    let source = directory.path().join("parent.sqlite3");

    // A stopped replicated parent is the dangerous case: the fork path is
    // commonly its final opener, so every short-lived handle must opt into
    // SQLite's connection-local persistent-WAL behavior.
    drop(LocalDatabase::open(&source).expect("initialize replicated parent"));
    let source_wal = sqlite_sidecar(&source, "-wal");
    let source_main_before = std::fs::read(&source).expect("read parent main before fork");
    let source_wal_before = std::fs::read(&source_wal).expect("read parent WAL before fork");
    assert!(
        source_wal_before.len() > 32,
        "the regression fixture needs committed parent frames in WAL"
    );

    let app_root = directory.path().join("app-root");
    std::fs::create_dir(&app_root).expect("create invoking app root");
    let expected =
        ensure_expected_app(&app_root, "replicated-app").expect("bind invoking app identity");
    let destination = directory.path().join("fork");
    let receipt = publish_managed_with_base(
        &source,
        &destination,
        &expected,
        "stopped-replicated-parent",
        1_000,
        61_000,
        false,
        true,
    )
    .expect("fork replicated parent through online backup");

    assert_eq!(
        std::fs::read(&source).expect("read parent main after fork"),
        source_main_before,
        "fork must not checkpoint parent frames into the main database"
    );
    assert_eq!(
        std::fs::read(&source_wal).expect("read parent WAL after fork"),
        source_wal_before,
        "fork openers must not checkpoint, replace, or unlink the parent WAL"
    );

    let fork_database = destination.join(&receipt.database_file);
    let fork_wal = sqlite_sidecar(&fork_database, "-wal");
    let fork_wal_before_inspection =
        std::fs::read(&fork_wal).expect("scrub-and-mint WAL remains published");
    assert!(
        fork_wal_before_inspection.len() > 32,
        "scrub commits must remain in the persistent fork WAL"
    );
    assert!(
        destination.join(BASE_SNAPSHOT_FILE).is_file(),
        "the retained-base opener participates in the exercised fork path"
    );
    assert!(
        inspect_boot_at(&fork_database, 2_000)
            .expect("inspect replicated fork")
            .is_some(),
        "published fork remains boot-admissible"
    );
    assert_eq!(
        std::fs::read(&fork_wal).expect("fork WAL after inspection"),
        fork_wal_before_inspection,
        "short-lived fork inspection must preserve the scrub WAL too"
    );
}
