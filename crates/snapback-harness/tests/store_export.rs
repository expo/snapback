use rusqlite::Connection;
use snapback_auth::auth::crypto::{CryptoError, OsRandom, RandomSource};
use snapback_auth::auth::keyring::AuthKeyringStore;
use snapback_auth::auth::lifecycle::activate_catalog;
use snapback_cli::store_state::{
    StoreExportManifest, StoreExportOutcome, StoreExportPublication, export_store,
    path_with_filename_suffix,
};
use snapback_engine::local::LocalSnapback;
use snapback_kernel::contract_types::AuthProviderProfile;
use snapback_kernel::storage::LocalDatabase;
use snapback_server::auth::runtime::{AuthProviderHealth, AuthRuntime};
use std::fs;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt as _;
use std::path::Path;

const STORE_EXPORT_MANIFEST_FILE: &str = "store-export.json";

#[derive(Debug)]
struct FixedRandom;

impl RandomSource for FixedRandom {
    fn fill(&self, destination: &mut [u8]) -> Result<(), CryptoError> {
        for (index, byte) in destination.iter_mut().enumerate() {
            *byte = (index as u8).wrapping_add(17);
        }
        Ok(())
    }
}

fn create_app_rows(database_path: &Path, keep_wal_open: bool) -> Option<Connection> {
    let connection = Connection::open(database_path).unwrap();
    connection
        .execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA wal_autocheckpoint=0;
             CREATE TABLE app_rows(id INTEGER PRIMARY KEY, value TEXT NOT NULL);
             BEGIN IMMEDIATE;
             INSERT INTO app_rows(value) VALUES ('first'), ('second');
             COMMIT;",
        )
        .unwrap();
    keep_wal_open.then_some(connection)
}

fn activated_store(
    database_path: &Path,
    keep_wal_open: bool,
) -> (LocalSnapback, AuthKeyringStore, Option<Connection>) {
    let wal_connection = create_app_rows(database_path, keep_wal_open);
    let mut database = LocalDatabase::open(database_path).unwrap();
    let keyring = AuthKeyringStore::file_for_database(database_path);
    activate_catalog(&mut database, &keyring, 1_000, &OsRandom).unwrap();
    drop(database);
    let snapback = LocalSnapback::open(database_path).unwrap();
    (snapback, keyring, wal_connection)
}

fn export_fixture(
    database_path: &Path,
    output: &Path,
    keep_wal_open: bool,
) -> (StoreExportOutcome, Option<Connection>) {
    let (mut snapback, keyring, wal_connection) = activated_store(database_path, keep_wal_open);
    let outcome = export_store(
        &mut snapback,
        &keyring,
        database_path,
        output,
        2_000,
        &FixedRandom,
    )
    .unwrap();
    (outcome, wal_connection)
}

#[test]
fn exported_store_boots_with_auth_keyring_and_app_rows() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("app.sqlite3");
    let output = directory.path().join("exported");
    let (mut snapback, keyring, _) = activated_store(&database, false);
    let blobs = directory.path().join("assets/blobs");
    fs::create_dir_all(&blobs).unwrap();
    fs::write(blobs.join("avatar.bin"), b"asset-bytes").unwrap();

    let outcome = export_store(
        &mut snapback,
        &keyring,
        &database,
        &output,
        2_000,
        &FixedRandom,
    )
    .unwrap();
    assert_eq!(outcome.publication_state, StoreExportPublication::Published);
    assert!(
        outcome
            .manifest
            .members
            .iter()
            .any(|member| member.id == "assetBlobs" && member.file == "assets/blobs")
    );
    assert_eq!(
        fs::read(output.join("assets/blobs/avatar.bin")).unwrap(),
        b"asset-bytes"
    );

    let exported_database = output.join("app.sqlite3");
    let exported_keyring = AuthKeyringStore::keyring_path(&exported_database);
    assert!(exported_keyring.is_file());
    #[cfg(unix)]
    assert_eq!(
        fs::metadata(&exported_keyring)
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o600
    );

    let mut exported = LocalSnapback::open(&exported_database).unwrap();
    let runtime = AuthRuntime::inspect(
        &mut exported,
        Some(&exported_database),
        AuthProviderProfile::Test,
    )
    .unwrap();
    assert_eq!(runtime.health(), AuthProviderHealth::Available);
    assert!(runtime.startup_diagnostics().is_empty());
    let rows: i64 = Connection::open(&exported_database)
        .unwrap()
        .query_row("SELECT COUNT(*) FROM app_rows", [], |row| row.get(0))
        .unwrap();
    assert_eq!(rows, 2);
}

#[test]
fn database_only_copy_diagnoses_the_destination_keyring_path() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("app.sqlite3");
    let output = directory.path().join("exported");
    export_fixture(&database, &output, false);

    let clone_directory = directory.path().join("database-only");
    fs::create_dir(&clone_directory).unwrap();
    let clone_database = clone_directory.join("app.sqlite3");
    fs::copy(output.join("app.sqlite3"), &clone_database).unwrap();
    let mut clone = LocalSnapback::open(&clone_database).unwrap();
    let runtime =
        AuthRuntime::inspect(&mut clone, Some(&clone_database), AuthProviderProfile::Test).unwrap();
    let diagnostic = runtime
        .startup_diagnostics()
        .into_iter()
        .next()
        .expect("ready catalog without its keyring must diagnose the exact missing member");
    assert_eq!(diagnostic.code, "SNAPBACK_AUTH_PROVIDER_UNAVAILABLE");
    assert_eq!(
        diagnostic.details["path"],
        serde_json::json!(AuthKeyringStore::keyring_path(&clone_database))
    );
    assert_eq!(diagnostic.details["cause"], serde_json::json!("missing"));
}

#[test]
fn export_folds_live_wal_without_copying_sqlite_sidecars() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("app.sqlite3");
    let output = directory.path().join("exported");
    let (outcome, wal_connection) = export_fixture(&database, &output, true);
    let wal = path_with_filename_suffix(&database, "-wal").unwrap();
    assert!(
        fs::metadata(&wal).unwrap().len() > 0,
        "the source must have committed, deliberately uncheckpointed WAL bytes"
    );
    assert!(
        wal_connection.is_some(),
        "the WAL holder stays open through export"
    );

    let exported_database = output.join("app.sqlite3");
    for suffix in ["-wal", "-shm", "-journal"] {
        assert!(
            !path_with_filename_suffix(&exported_database, suffix)
                .unwrap()
                .exists()
        );
    }
    let rows: i64 = Connection::open(&exported_database)
        .unwrap()
        .query_row("SELECT COUNT(*) FROM app_rows", [], |row| row.get(0))
        .unwrap();
    assert_eq!(rows, 2);
    let manifest: StoreExportManifest =
        serde_json::from_slice(&fs::read(output.join(STORE_EXPORT_MANIFEST_FILE)).unwrap())
            .unwrap();
    let wal_exclusion = manifest
        .excluded
        .iter()
        .find(|member| member.id == "sqliteWal")
        .unwrap();
    assert!(wal_exclusion.reason.contains("folded"));
    assert_eq!(manifest, outcome.manifest);
}

#[test]
fn lineage_state_refuses_export_and_publishes_nothing() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("app.sqlite3");
    let output = directory.path().join("exported");
    let (mut snapback, keyring, _) = activated_store(&database, false);
    fs::write(
        directory
            .path()
            .join(snapback_kernel::instance_fork::MINT_RECEIPT_FILE),
        b"{}",
    )
    .unwrap();

    let error = export_store(
        &mut snapback,
        &keyring,
        &database,
        &output,
        2_000,
        &FixedRandom,
    )
    .unwrap_err();
    assert_eq!(error.diagnostic.code, "SNAPBACK_STORE_EXPORT_REFUSED");
    assert_eq!(
        error.diagnostic.details["member"],
        serde_json::json!("forkMintReceipt")
    );
    assert_eq!(
        error.diagnostic.details["publicationState"],
        serde_json::json!("Unpublished")
    );
    assert!(!output.exists());
}

#[test]
fn existing_output_is_unpublished_and_leaves_no_staging_directory() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("app.sqlite3");
    let output = directory.path().join("already-there");
    let (mut snapback, keyring, _) = activated_store(&database, false);
    fs::create_dir(&output).unwrap();

    let error = export_store(
        &mut snapback,
        &keyring,
        &database,
        &output,
        2_000,
        &FixedRandom,
    )
    .unwrap_err();
    assert_eq!(error.diagnostic.code, "SNAPBACK_STORE_EXPORT_INVALID");
    assert_eq!(
        error.diagnostic.details["publicationState"],
        serde_json::json!("Unpublished")
    );
    let staging = fs::read_dir(directory.path())
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .filter_map(|name| name.into_string().ok())
        .filter(|name| name.starts_with(".snapback-store-export-"))
        .collect::<Vec<_>>();
    assert!(staging.is_empty(), "unexpected staging paths: {staging:?}");
}
