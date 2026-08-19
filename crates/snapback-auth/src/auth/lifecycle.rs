//! Auth catalog activation, maintenance, and declared-restore coordination.
//!
//! Callers hold the auth-maintenance gate exclusively for every operation in
//! this module. Keeping that boundary above these pure services lets server,
//! offline CLI, and recovery startup share one exact lifecycle implementation.

// @ref LLP 0057#activation-ordering — a usable keyring precedes the catalog marker, while an already-marked catalog never mints a lost ring.
// @ref LLP 0057#garbage-collection — durable rows, capture plaintext, and retired keys share one bounded startup/30-second maintenance pass.
// @ref LLP 0057#restore — a durable UUIDv7 declaration makes destructive restore startup idempotent.

use crate::auth::crypto::RandomSource;
use crate::auth::keyring::{AuthKeyringStore, KeyringError, KeyringSummary};
use crate::auth::mailbox::CaptureMailbox;
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::storage::LocalDatabase;
use crate::storage::auth::{AuthCatalogState, AuthRestoreResult};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const AUTH_GC_INTERVAL: Duration = Duration::from_secs(30);
pub const RESTORE_DECLARATION_FILE: &str = "restore-declaration.json";
const RESTORE_DECLARATION_FORMAT_VERSION: u32 = 1;
const RESTORE_DECLARATION_MAXIMUM_BYTES: usize = 4 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EmailCodeReadiness {
    Ready(KeyringSummary),
    Unavailable,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AuthActivation {
    pub catalog_created: bool,
    pub email_code: EmailCodeReadiness,
}

/// Activate from an uninitialized catalog or inspect an already-ready one.
/// A missing/corrupt keyring on `ReadyV1` disables only the email-code provider;
/// it is deliberately not recreated because retained challenges may name lost
/// key material and session resolution does not require that keyring.
pub fn activate_catalog(
    database: &mut LocalDatabase,
    keyring: &AuthKeyringStore,
    now_ms: u64,
    random: &dyn RandomSource,
) -> SnapbackResult<AuthActivation> {
    match database.inspect_auth_catalog()? {
        AuthCatalogState::ReadyV1
        | AuthCatalogState::ReadyV2
        | AuthCatalogState::ReadyV3
        | AuthCatalogState::ReadyV4 => Ok(AuthActivation {
            catalog_created: false,
            email_code: existing_keyring_readiness(keyring),
        }),
        AuthCatalogState::Uninitialized => {
            keyring
                .load_or_mint_initial(now_ms, random)
                .map_err(provider_unavailable)?;
            activation_keyring_ready()?;
            database.activate_current_auth_catalog()?;
            if !database.inspect_auth_catalog()?.is_ready() {
                return Err(SnapbackError::error(
                    "SNAPBACK_AUTH_CATALOG_CORRUPT",
                    "auth",
                    "auth catalog activation did not produce an exact ready catalog",
                ));
            }
            Ok(AuthActivation {
                catalog_created: true,
                email_code: existing_keyring_readiness(keyring),
            })
        }
    }
}

fn existing_keyring_readiness(keyring: &AuthKeyringStore) -> EmailCodeReadiness {
    match keyring.load_existing() {
        Ok(summary) => EmailCodeReadiness::Ready(summary),
        Err(_) => EmailCodeReadiness::Unavailable,
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum KeyringGcResult {
    Available { retired_keys_deleted: usize },
    Unavailable,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct AuthGcPass {
    pub challenges_deleted: usize,
    pub sessions_deleted: usize,
    pub mailbox_entries_deleted: usize,
    pub keyring: KeyringGcResult,
    pub immediate_retry: bool,
}

impl AuthGcPass {
    pub fn next_delay(self) -> Duration {
        if self.immediate_retry {
            Duration::ZERO
        } else {
            AUTH_GC_INTERVAL
        }
    }
}

/// Run one startup/periodic maintenance pass. Durable expiry happens first;
/// key pruning then queries only the retained challenge set while holding the
/// keyring lock, matching the protocol's keyring-before-SQLite lock order.
pub(crate) fn run_gc_pass(
    database: &mut LocalDatabase,
    keyring: &AuthKeyringStore,
    mailbox: &CaptureMailbox,
    now_ms: u64,
    random: &dyn RandomSource,
) -> SnapbackResult<AuthGcPass> {
    let durable = database.auth_gc(now_ms)?;
    let mailbox_entries_deleted = mailbox.prune_expired();

    let mut storage_error = None;
    let keyring = match keyring.prune_retired(now_ms, random, |key_id| {
        match database.auth_key_is_referenced(key_id.as_str()) {
            Ok(referenced) => Ok(referenced),
            Err(error) => {
                storage_error = Some(error);
                Err(KeyringError::Unavailable)
            }
        }
    }) {
        Ok(retired_keys_deleted) => KeyringGcResult::Available {
            retired_keys_deleted,
        },
        Err(_) => KeyringGcResult::Unavailable,
    };
    if let Some(error) = storage_error {
        return Err(error);
    }

    Ok(AuthGcPass {
        challenges_deleted: durable.challenges_deleted,
        sessions_deleted: durable.sessions_deleted,
        mailbox_entries_deleted,
        keyring,
        immediate_retry: durable.immediate_retry,
    })
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RestoreDeclaration {
    format_version: u32,
    declaration_id: String,
}

impl RestoreDeclaration {
    pub fn fresh() -> Self {
        Self {
            format_version: RESTORE_DECLARATION_FORMAT_VERSION,
            declaration_id: crate::ids::mint_time_ordered(crate::ids::Kind::Declaration),
        }
    }

    pub fn parse(bytes: &[u8]) -> SnapbackResult<Self> {
        let declaration: Self = serde_json::from_slice(bytes)
            .map_err(|_| restore_invalid("restore declaration is not a closed format-1 object"))?;
        declaration.validate()?;
        Ok(declaration)
    }

    pub fn to_bytes(&self) -> SnapbackResult<Vec<u8>> {
        self.validate()?;
        serde_json::to_vec(self)
            .map_err(|_| restore_invalid("restore declaration could not be encoded"))
    }

    pub fn declaration_id(&self) -> &str {
        &self.declaration_id
    }

    fn validate(&self) -> SnapbackResult<()> {
        if self.format_version != RESTORE_DECLARATION_FORMAT_VERSION {
            return Err(restore_invalid(
                "restore declaration is not a closed format-1 object",
            ));
        }
        validate_uuid_v7(&self.declaration_id)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DeclaredRestoreOutcome {
    Applied {
        sessions_revoked: usize,
        challenges_deleted: usize,
    },
    AlreadyApplied,
}

#[allow(dead_code)] // Consumed by startup/CLI composition after this pure lifecycle lane lands.
pub fn restore_declaration_path(database_path: &Path) -> SnapbackResult<PathBuf> {
    let instance_directory = database_path
        .parent()
        .ok_or_else(|| restore_invalid("restored database path has no instance directory"))?;
    Ok(instance_directory.join(RESTORE_DECLARATION_FILE))
}

/// Consume a declared restore before bind. The caller supplies the command-line
/// declaration separately; mismatches fail before any database or mailbox
/// effect. Post-commit cleanup is retry-safe because the database marker wins.
pub fn apply_declared_restore(
    database: &mut LocalDatabase,
    mailbox: &CaptureMailbox,
    declaration_path: &Path,
    supplied_declaration_id: &str,
    now_ms: u64,
) -> SnapbackResult<DeclaredRestoreOutcome> {
    validate_uuid_v7(supplied_declaration_id)?;
    let bytes = crate::secure_file::read_strict_owner_only(
        declaration_path,
        RESTORE_DECLARATION_MAXIMUM_BYTES,
    )
    .map_err(|_| restore_invalid("restore declaration is missing or unreadable"))?;
    let declaration = RestoreDeclaration::parse(&bytes)?;
    if declaration.declaration_id() != supplied_declaration_id {
        return Err(restore_invalid(
            "supplied restore declaration does not match the staged artifact",
        ));
    }

    let outcome = database.apply_auth_restore_declaration(supplied_declaration_id, now_ms)?;
    declared_restore_committed()?;

    // Clearing before unlink is the safer post-commit order: a failed unlink
    // leaves a durable retry token, while process loss inherently clears the
    // process-local mailbox.
    mailbox.clear_after_declared_restore();
    std::fs::remove_file(declaration_path)
        .map_err(|_| restore_invalid("committed restore declaration could not be removed"))?;
    crate::secure_file::sync_parent(declaration_path)
        .map_err(|_| restore_invalid("restore declaration removal could not be synced"))?;

    Ok(match outcome {
        AuthRestoreResult::Applied {
            sessions_revoked,
            challenges_deleted,
        } => DeclaredRestoreOutcome::Applied {
            sessions_revoked,
            challenges_deleted,
        },
        AuthRestoreResult::AlreadyApplied => DeclaredRestoreOutcome::AlreadyApplied,
    })
}

pub fn apply_declared_restore_plan<'a>(
    mailbox: &'a CaptureMailbox,
    declaration_path: &'a Path,
    supplied_declaration_id: &'a str,
    now_ms: u64,
) -> impl crate::auth::database_plan::AuthDatabasePlan<Output = SnapbackResult<DeclaredRestoreOutcome>> + 'a
{
    crate::auth::database_plan::plan(move |database| {
        apply_declared_restore(
            database,
            mailbox,
            declaration_path,
            supplied_declaration_id,
            now_ms,
        )
    })
}

fn validate_uuid_v7(value: &str) -> SnapbackResult<()> {
    if crate::ids::is_minted_identifier(value) {
        return Ok(());
    }
    Err(restore_invalid(
        "restore declaration id is not a Snapback identifier",
    ))
}

fn provider_unavailable(_: KeyringError) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_PROVIDER_UNAVAILABLE",
        "auth",
        "email-code auth provider is unavailable",
    )
}

fn restore_invalid(message: &str) -> SnapbackError {
    SnapbackError::error("SNAPBACK_AUTH_BACKUP_INVALID", "auth-restore", message)
}

#[cfg(test)]
thread_local! {
    static FAIL_AFTER_KEYRING: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    static FAIL_AFTER_RESTORE_COMMIT: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

fn activation_keyring_ready() -> SnapbackResult<()> {
    #[cfg(test)]
    FAIL_AFTER_KEYRING.with(|slot| {
        if slot.replace(false) {
            return Err(SnapbackError::error(
                "TEST_AUTH_LIFECYCLE_FAILURE",
                "auth",
                "injected failure after keyring publication",
            ));
        }
        Ok(())
    })?;
    Ok(())
}

fn declared_restore_committed() -> SnapbackResult<()> {
    #[cfg(test)]
    FAIL_AFTER_RESTORE_COMMIT.with(|slot| {
        if slot.replace(false) {
            return Err(SnapbackError::error(
                "TEST_AUTH_LIFECYCLE_FAILURE",
                "auth-restore",
                "injected failure after restore commit",
            ));
        }
        Ok(())
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::crypto::{
        AuthKeyId, CanonicalAddress, ChallengeId, CryptoError, VerificationCode,
    };
    use crate::auth::keyring::{AUTH_KEY_ROTATION_AGE_MS, AUTH_RETIRED_KEY_MINIMUM_AGE_MS};
    use crate::auth::mailbox::CaptureMailboxEntry;
    use std::sync::atomic::{AtomicU8, Ordering};
    use std::time::Instant;

    const FIRST_RESTORE_SESSION: &str = "01890f47-0000-7000-8000-000000000011";
    const SECOND_RESTORE_SESSION: &str = "01890f47-0000-7000-8000-000000000012";

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

    #[test]
    fn activation_publishes_keyring_first_and_adopts_it_after_interruption() {
        let directory = tempfile::tempdir().unwrap();
        let database_path = directory.path().join("app.sqlite3");
        let mut database = LocalDatabase::open(&database_path).unwrap();
        let keyring = AuthKeyringStore::file_for_database(&database_path);
        let random = CountingRandom::default();

        FAIL_AFTER_KEYRING.with(|slot| slot.set(true));
        let error = activate_catalog(&mut database, &keyring, 10, &random).unwrap_err();
        assert_eq!(error.diagnostic.code, "TEST_AUTH_LIFECYCLE_FAILURE");
        assert_eq!(
            database.inspect_auth_catalog().unwrap(),
            AuthCatalogState::Uninitialized
        );
        assert_eq!(keyring.load_existing().unwrap().key_count, 1);

        let activated = activate_catalog(&mut database, &keyring, 11, &random).unwrap();
        assert!(activated.catalog_created);
        assert!(matches!(activated.email_code, EmailCodeReadiness::Ready(_)));
        assert_eq!(
            database.inspect_auth_catalog().unwrap(),
            AuthCatalogState::ReadyV4
        );
    }

    #[test]
    fn ready_catalog_never_remints_a_missing_keyring() {
        let mut database = LocalDatabase::memory().unwrap();
        database.activate_current_auth_catalog().unwrap();
        let keyring = AuthKeyringStore::in_memory();
        let result =
            activate_catalog(&mut database, &keyring, 10, &CountingRandom::default()).unwrap();
        assert!(!result.catalog_created);
        assert_eq!(result.email_code, EmailCodeReadiness::Unavailable);
        assert_eq!(keyring.load_existing().unwrap_err(), KeyringError::Missing);
    }

    #[test]
    fn corrupt_existing_keyring_blocks_catalog_creation_without_overwrite() {
        use std::os::unix::fs::PermissionsExt as _;

        let directory = tempfile::tempdir().unwrap();
        let database_path = directory.path().join("app.sqlite3");
        let mut database = LocalDatabase::open(&database_path).unwrap();
        let keyring_path = AuthKeyringStore::keyring_path(&database_path);
        std::fs::write(&keyring_path, b"not-json").unwrap();
        std::fs::set_permissions(&keyring_path, std::fs::Permissions::from_mode(0o600)).unwrap();
        let keyring = AuthKeyringStore::file_for_database(&database_path);

        let error =
            activate_catalog(&mut database, &keyring, 10, &CountingRandom::default()).unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_PROVIDER_UNAVAILABLE");
        assert_eq!(std::fs::read(&keyring_path).unwrap(), b"not-json");
        assert_eq!(
            database.inspect_auth_catalog().unwrap(),
            AuthCatalogState::Uninitialized
        );
    }

    #[test]
    fn gc_retains_referenced_retired_key_until_challenge_expiry() {
        let mut database = LocalDatabase::memory().unwrap();
        let keyring = AuthKeyringStore::in_memory();
        let random = CountingRandom::default();
        activate_catalog(&mut database, &keyring, 0, &random).unwrap();
        let retired_id: AuthKeyId = keyring
            .with_active_key(0, &random, |id, _| id.clone())
            .unwrap();
        let retired_at = AUTH_KEY_ROTATION_AGE_MS;
        assert!(keyring.rotate_if_due(retired_at, &random).unwrap());
        let first_prune = retired_at + AUTH_RETIRED_KEY_MINIMUM_AGE_MS;
        let expires_at = first_prune + 1;
        database
            .auth_catalog()
            .insert_verification_code_for_test(
                "sbc_AAAAAAAAAAAAAAAAAAAAAA",
                "user@example.com",
                &[0_u8; 32],
                retired_id.as_str(),
                0,
                expires_at,
            )
            .unwrap();

        let mailbox = CaptureMailbox::new();
        let pass = run_gc_pass(&mut database, &keyring, &mailbox, first_prune, &random).unwrap();
        assert_eq!(pass.challenges_deleted, 0);
        assert_eq!(
            pass.keyring,
            KeyringGcResult::Available {
                retired_keys_deleted: 0
            }
        );
        assert_eq!(keyring.load_existing().unwrap().key_count, 2);
        assert_eq!(pass.next_delay(), AUTH_GC_INTERVAL);

        let pass = run_gc_pass(&mut database, &keyring, &mailbox, expires_at, &random).unwrap();
        assert_eq!(pass.challenges_deleted, 1);
        assert_eq!(
            pass.keyring,
            KeyringGcResult::Available {
                retired_keys_deleted: 1
            }
        );
        assert_eq!(keyring.load_existing().unwrap().key_count, 1);
    }

    #[test]
    fn declared_restore_is_atomic_and_same_id_retry_is_nondestructive() {
        let directory = tempfile::tempdir().unwrap();
        let database_path = directory.path().join("app.sqlite3");
        let declaration_path = directory.path().join(RESTORE_DECLARATION_FILE);
        let mut database = LocalDatabase::open(&database_path).unwrap();
        let keyring = AuthKeyringStore::file_for_database(&database_path);
        let random = CountingRandom::default();
        activate_catalog(&mut database, &keyring, 0, &random).unwrap();
        let predecessor_incarnation = database.ensure_authorization_stream_incarnation().unwrap();
        insert_restore_fixture(&mut database, FIRST_RESTORE_SESSION, 1);

        let mailbox = CaptureMailbox::new();
        let challenge = ChallengeId::parse("sbc_AAAAAAAAAAAAAAAAAAAAAA").unwrap();
        mailbox
            .reserve(
                CaptureMailboxEntry::new(
                    challenge.clone(),
                    CanonicalAddress::parse("user@example.com").unwrap(),
                    VerificationCode::parse("123456").unwrap(),
                    Instant::now() + Duration::from_secs(60),
                    60_000,
                )
                .unwrap(),
            )
            .unwrap()
            .publish()
            .unwrap();

        let declaration = RestoreDeclaration::fresh();
        crate::secure_file::write_new_owner_only(
            &declaration_path,
            &declaration.to_bytes().unwrap(),
        )
        .unwrap();
        FAIL_AFTER_RESTORE_COMMIT.with(|slot| slot.set(true));
        let error = apply_declared_restore(
            &mut database,
            &mailbox,
            &declaration_path,
            declaration.declaration_id(),
            100,
        )
        .unwrap_err();
        assert_eq!(error.diagnostic.code, "TEST_AUTH_LIFECYCLE_FAILURE");
        assert!(declaration_path.exists());
        let committed_incarnation = database.authorization_stream_incarnation().unwrap();
        assert_ne!(committed_incarnation, predecessor_incarnation);

        let retry = apply_declared_restore(
            &mut database,
            &mailbox,
            &declaration_path,
            declaration.declaration_id(),
            101,
        )
        .unwrap();
        assert_eq!(retry, DeclaredRestoreOutcome::AlreadyApplied);
        assert_eq!(
            database.authorization_stream_incarnation().unwrap(),
            committed_incarnation
        );
        assert!(!declaration_path.exists());
        assert!(mailbox.peek_address(&challenge).is_none());
        assert_session(&database, FIRST_RESTORE_SESSION, 2, Some(2000));
        assert_eq!(challenge_count(&database), 0);

        insert_restore_fixture(&mut database, SECOND_RESTORE_SESSION, 2);
        crate::secure_file::write_new_owner_only(
            &declaration_path,
            &declaration.to_bytes().unwrap(),
        )
        .unwrap();
        let replay = apply_declared_restore(
            &mut database,
            &mailbox,
            &declaration_path,
            declaration.declaration_id(),
            200,
        )
        .unwrap();
        assert_eq!(replay, DeclaredRestoreOutcome::AlreadyApplied);
        assert_eq!(
            database.authorization_stream_incarnation().unwrap(),
            committed_incarnation
        );
        assert_session(&database, SECOND_RESTORE_SESSION, 1, None);
        assert_eq!(challenge_count(&database), 1);
    }

    #[test]
    fn declaration_mismatch_and_unknown_fields_have_no_effect() {
        let directory = tempfile::tempdir().unwrap();
        let declaration_path = directory.path().join(RESTORE_DECLARATION_FILE);
        let mut database = LocalDatabase::memory().unwrap();
        database.activate_current_auth_catalog().unwrap();
        insert_restore_fixture(&mut database, FIRST_RESTORE_SESSION, 1);
        let declaration = RestoreDeclaration::fresh();
        let other = RestoreDeclaration::fresh();
        crate::secure_file::write_new_owner_only(
            &declaration_path,
            &declaration.to_bytes().unwrap(),
        )
        .unwrap();
        let error = apply_declared_restore(
            &mut database,
            &CaptureMailbox::new(),
            &declaration_path,
            other.declaration_id(),
            100,
        )
        .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_BACKUP_INVALID");
        assert_session(&database, FIRST_RESTORE_SESSION, 1, None);

        std::fs::remove_file(&declaration_path).unwrap();
        let invalid = format!(
            r#"{{"formatVersion":1,"declarationId":"{}","extra":true}}"#,
            declaration.declaration_id()
        );
        crate::secure_file::write_new_owner_only(&declaration_path, invalid.as_bytes()).unwrap();
        let error = apply_declared_restore(
            &mut database,
            &CaptureMailbox::new(),
            &declaration_path,
            declaration.declaration_id(),
            100,
        )
        .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_BACKUP_INVALID");
        assert_session(&database, FIRST_RESTORE_SESSION, 1, None);
    }

    fn insert_restore_fixture(database: &mut LocalDatabase, session_id: &str, suffix: u8) {
        database
            .auth_catalog()
            .insert_restore_fixture_for_test(
                session_id,
                &format!("authority-{suffix}"),
                &[suffix; 32],
                &format!("sbc_{suffix:022}"),
                &format!("user{suffix}@example.com"),
                &[suffix; 32],
                &format!("sbak_{suffix:022}"),
            )
            .unwrap();
    }

    fn assert_session(
        database: &LocalDatabase,
        session_id: &str,
        generation: i64,
        revoked_at_ms: Option<i64>,
    ) {
        let actual = database
            .auth_catalog_read()
            .session_generation_revoked_for_test(session_id)
            .unwrap();
        assert_eq!(actual, (generation, revoked_at_ms));
    }

    fn challenge_count(database: &LocalDatabase) -> i64 {
        database
            .auth_catalog_read()
            .verification_challenge_count_for_test()
            .unwrap()
    }
}
