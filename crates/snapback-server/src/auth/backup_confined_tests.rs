use snapback_auth::auth::backup::*;
use snapback_auth::auth::crypto::{AuthKeyId, CryptoError, RandomSource};
use snapback_auth::auth::keyring::AuthKeyringStore;
use snapback_auth::auth::lifecycle::{
    EmailCodeReadiness, RESTORE_DECLARATION_FILE, RestoreDeclaration, activate_catalog,
};
use snapback_kernel::storage::LocalDatabase;
use snapback_kernel::storage::auth::{AuthCatalogState, PasswordIdentifierMode};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU8, Ordering};

#[derive(Debug, Default)]
struct CountingRandom(AtomicU8);

impl RandomSource for CountingRandom {
    fn fill(&self, destination: &mut [u8]) -> Result<(), CryptoError> {
        let start = self.0.fetch_add(1, Ordering::SeqCst);
        for (offset, byte) in destination.iter_mut().enumerate() {
            *byte = start.wrapping_add(offset as u8);
        }
        Ok(())
    }
}

struct Fixture {
    _directory: tempfile::TempDir,
    database_path: PathBuf,
    database: LocalDatabase,
    keyring: AuthKeyringStore,
    random: CountingRandom,
}

impl Fixture {
    fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let database_path = directory.path().join("source.sqlite3");
        let mut database = LocalDatabase::open(&database_path).unwrap();
        let keyring = AuthKeyringStore::file_for_database(&database_path);
        let random = CountingRandom::default();
        let activated = activate_catalog(&mut database, &keyring, 10, &random).unwrap();
        assert!(matches!(activated.email_code, EmailCodeReadiness::Ready(_)));
        let key_id = keyring
            .with_active_key(10, &random, |id, _| id.as_str().to_owned())
            .unwrap();
        database
            .auth_catalog()
            .insert_verification_code_for_test(
                "sbc_AAAAAAAAAAAAAAAAAAAAAA",
                "user@example.com",
                &[7_u8; 32],
                &key_id,
                10,
                1000,
            )
            .unwrap();
        Self {
            _directory: directory,
            database_path,
            database,
            keyring,
            random,
        }
    }

    fn parent(&self) -> &Path {
        self.database_path.parent().unwrap()
    }
}

#[test]
fn backup_and_restore_publish_exact_owner_only_consistent_units() {
    use crate::auth::identity_core::PasswordSecret;
    use std::os::unix::fs::PermissionsExt as _;

    let mut fixture = Fixture::new();
    let database = &mut fixture.database;
    fixture
        .keyring
        .with_active_key(20, &fixture.random, |key_id, key| {
            database.identity_password_register(
                "backup-person",
                &PasswordSecret::new("strong-backup-password-1".to_owned()),
                20,
                &fixture.random,
                key_id.as_str(),
                key.expose_secret(),
            )
        })
        .unwrap()
        .unwrap();
    database
        .insert_password_attempt_for_test("backup-ledger@example.com", 20, 4, Some(120))
        .unwrap();
    database.insert_large_backup_fixture_for_test().unwrap();
    let backup_directory = fixture.parent().join("backup");
    let outcome = create_backup(
        &fixture.database,
        &fixture.keyring,
        &backup_directory,
        123,
        &fixture.random,
    )
    .unwrap();
    assert_eq!(outcome.publication_state, BackupPublicationState::Published);
    assert_eq!(outcome.manifest.format_version(), 2);
    assert_eq!(outcome.manifest.created_at_ms(), 123);
    assert_eq!(outcome.manifest.catalog_version(), 4);
    assert_eq!(
        outcome.manifest.catalog_state(),
        Some(AuthBackupCatalogState::ReadyV4)
    );
    assert_eq!(
        outcome.manifest.password_identifier_mode(),
        Some("username-v1")
    );
    assert!(
        !outcome
            .manifest
            .to_bytes()
            .unwrap()
            .windows(b"backup-ledger@example.com".len())
            .any(|window| window == b"backup-ledger@example.com"),
        "backup manifests must not disclose canonical attempt addresses"
    );
    assert_eq!(
        outcome.manifest.catalog_tables().unwrap(),
        [
            "_auth_users",
            "_auth_identities",
            "_auth_credentials",
            "_auth_password_credentials",
            "_auth_passkey_credentials",
            "_auth_recovery_code_sets",
            "_auth_recovery_codes",
            "_auth_sessions",
            "_auth_session_tokens",
            "_auth_verification_codes",
            "_auth_assurances",
            "_auth_provisioning_receipts",
            "_auth_security_events",
            "_auth_agent_credentials",
            "_auth_grants",
            "_auth_grant_tokens",
            "_auth_agent_invitations",
            "_auth_pairing_requests",
            "_auth_scope_bases",
            "_auth_password_attempts",
        ]
    );
    require_exact_members(
        &backup_directory,
        &[
            BACKUP_DATABASE_FILE,
            BACKUP_KEYRING_FILE,
            BACKUP_MANIFEST_FILE,
        ],
    )
    .unwrap();
    assert_eq!(
        std::fs::metadata(&backup_directory)
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o700
    );
    for name in [
        BACKUP_DATABASE_FILE,
        BACKUP_KEYRING_FILE,
        BACKUP_MANIFEST_FILE,
    ] {
        assert_eq!(
            std::fs::metadata(backup_directory.join(name))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
    assert!(!backup_directory.join("database.sqlite3-wal").exists());
    assert_eq!(
        std::fs::read(backup_directory.join(BACKUP_KEYRING_FILE)).unwrap(),
        std::fs::read(AuthKeyringStore::keyring_path(&fixture.database_path)).unwrap()
    );

    let target_database = fixture.parent().join("restored").join("renamed.sqlite3");
    let declaration = restore_backup(&backup_directory, &target_database, &fixture.random).unwrap();
    assert!(target_database.exists());
    assert!(AuthKeyringStore::keyring_path(&target_database).exists());
    assert!(
        target_database
            .parent()
            .unwrap()
            .join(RESTORE_DECLARATION_FILE)
            .exists()
    );
    assert!(!target_database.with_extension("sqlite3-wal").exists());
    assert_eq!(
        RestoreDeclaration::parse(
            &crate::secure_file::read_strict_owner_only(
                &target_database
                    .parent()
                    .unwrap()
                    .join(RESTORE_DECLARATION_FILE),
                4096,
            )
            .unwrap()
        )
        .unwrap()
        .declaration_id(),
        declaration.declaration_id()
    );
    let restored = LocalDatabase::open(&target_database).unwrap();
    assert_eq!(
        restored.inspect_auth_catalog().unwrap(),
        AuthCatalogState::ReadyV4
    );
    assert_eq!(
        restored.auth_password_identifier_mode().unwrap(),
        PasswordIdentifierMode::UsernameV1
    );
    assert_eq!(restored.auth_retained_key_ids().unwrap().len(), 1);
    let restored_keyring = AuthKeyringStore::file_for_database(&target_database);
    let key_id = AuthKeyId::parse(&restored.auth_retained_key_ids().unwrap()[0]).unwrap();
    restored_keyring.with_key(&key_id, |_| ()).unwrap();
    let (restored_counts, restored_attempt, restored_payload_bytes) = restored
        .auth_backup_fixture_state_for_test("backup-ledger@example.com")
        .unwrap();
    for table in [
        "_auth_credentials",
        "_auth_recovery_code_sets",
        "_auth_recovery_codes",
        "_auth_assurances",
        "_auth_security_events",
        "_auth_password_attempts",
    ] {
        let count = restored_counts[table];
        assert!(count > 0, "v4 backup omitted state from {table}");
    }
    assert_eq!(restored_attempt, Some((20, 4, Some(120))));
    assert_eq!(
        restored_payload_bytes, 1_048_576,
        "the descriptor-safe backup must retain real multi-page app data",
    );
}
