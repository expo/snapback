//! Consistent physical auth backup and offline restore artifacts.
//!
//! The caller owns the instance lock and exclusive auth-maintenance guard for
//! backup. Restore is offline under the target instance lock. This module owns
//! artifact validation/publication, never process routing or CLI policy.

// @ref LLP 0054#consistent-backup — one quiescence boundary binds an online SQLite image to the exact validated keyring bytes.
// @ref LLP 0054#restore — a restored instance directory is staged owner-only and published by one same-filesystem rename.

use crate::auth::crypto::{AuthKeyId, RandomSource, encode_base64url};
use crate::auth::keyring::AuthKeyringStore;
use crate::auth::lifecycle::{RESTORE_DECLARATION_FILE, RestoreDeclaration};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::storage::LocalDatabase;
use crate::storage::auth::{AUTH_CATALOG_VERSION, AuthCatalogState};
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use std::collections::BTreeSet;
use std::ffi::{OsStr, OsString};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

pub(crate) const BACKUP_DATABASE_FILE: &str = "database.sqlite3";
pub(crate) const BACKUP_KEYRING_FILE: &str = "auth-keyring.json";
pub(crate) const BACKUP_MANIFEST_FILE: &str = "backup.json";
const BACKUP_FORMAT_VERSION: u32 = 1;
const BACKUP_MANIFEST_MAXIMUM_BYTES: usize = 64 * 1024;
const TEMP_CANDIDATE_ATTEMPTS: usize = 3;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AuthBackupManifest {
    format_version: u32,
    created_at_ms: u64,
    catalog_version: u32,
    database_sha256: String,
    keyring_sha256: String,
    source_database_basename: String,
}

impl AuthBackupManifest {
    fn validate(&self) -> SnapbackResult<()> {
        if self.format_version != BACKUP_FORMAT_VERSION
            || self.catalog_version.to_string() != AUTH_CATALOG_VERSION
            || self.created_at_ms > MAX_SAFE_INTEGER
            || !canonical_sha256(&self.database_sha256)
            || !canonical_sha256(&self.keyring_sha256)
            || !portable_basename(&self.source_database_basename)
        {
            return Err(backup_invalid(
                "backup manifest is not a valid closed format-1 object",
            ));
        }
        Ok(())
    }

    fn to_bytes(&self) -> SnapbackResult<Vec<u8>> {
        self.validate()?;
        serde_json::to_vec(self).map_err(|_| backup_invalid("backup manifest could not be encoded"))
    }

    fn parse(bytes: &[u8]) -> SnapbackResult<Self> {
        let manifest: Self = serde_json::from_slice(bytes)
            .map_err(|_| backup_invalid("backup manifest is not a closed format-1 object"))?;
        manifest.validate()?;
        Ok(manifest)
    }
}

/// Create a complete backup directory. The caller must hold the instance write
/// lock and exclusive auth-maintenance guard until this function returns.
pub(crate) fn create_backup(
    database: &LocalDatabase,
    keyring: &AuthKeyringStore,
    output_directory: &Path,
    created_at_ms: u64,
    random: &dyn RandomSource,
) -> SnapbackResult<AuthBackupManifest> {
    if created_at_ms > MAX_SAFE_INTEGER {
        return Err(backup_invalid(
            "backup creation time is outside the portable timestamp range",
        ));
    }
    require_absent(output_directory, "backup output directory already exists")?;
    let source_path = database
        .database_path()
        .ok_or_else(|| backup_invalid("in-memory databases cannot be physically backed up"))?;
    let source_database_basename = source_path
        .file_name()
        .and_then(OsStr::to_str)
        .filter(|name| portable_basename(name))
        .ok_or_else(|| backup_invalid("source database basename is not portable"))?
        .to_owned();
    if database
        .inspect_auth_catalog()
        .map_err(|_| backup_invalid("source auth catalog is not an exact ReadyV1 catalog"))?
        != AuthCatalogState::ReadyV1
    {
        return Err(backup_invalid(
            "source auth catalog is not an exact ReadyV1 catalog",
        ));
    }

    // Retain the exact keyring file bytes before entering the SQLite writer
    // lane. The caller's maintenance guard prevents rotation between these
    // sequential operations.
    let keyring_bytes = keyring
        .validated_file_bytes()
        .map_err(|_| backup_invalid("source auth keyring is unavailable or invalid"))?;
    backup_keyring_captured();
    validate_retained_key_references(database.auth_retained_key_ids(), &keyring_bytes)?;

    let mut temporary = TemporaryDirectory::create(output_directory, "backup", random)?;
    backup_step_completed(0)?;
    let database_file = temporary.path.join(BACKUP_DATABASE_FILE);
    database
        .backup_auth_catalog_to(&database_file)
        .map_err(|_| backup_invalid("SQLite online backup did not complete"))?;
    backup_step_completed(1)?;

    let keyring_file = temporary.path.join(BACKUP_KEYRING_FILE);
    crate::secure_file::write_new_owner_only(&keyring_file, keyring_bytes.expose_secret())
        .map_err(|_| backup_invalid("backup keyring could not be written"))?;
    backup_step_completed(2)?;

    let database_sha256 = sha256_path(&database_file)?;
    let keyring_sha256 = sha256_bytes(keyring_bytes.expose_secret());
    let manifest = AuthBackupManifest {
        format_version: BACKUP_FORMAT_VERSION,
        created_at_ms,
        catalog_version: AUTH_CATALOG_VERSION
            .parse()
            .expect("catalog version is a numeric v1 constant"),
        database_sha256,
        keyring_sha256,
        source_database_basename,
    };
    crate::secure_file::write_new_owner_only(
        &temporary.path.join(BACKUP_MANIFEST_FILE),
        &manifest.to_bytes()?,
    )
    .map_err(|_| backup_invalid("backup manifest could not be written"))?;
    backup_step_completed(3)?;

    require_exact_members(
        &temporary.path,
        &[
            BACKUP_DATABASE_FILE,
            BACKUP_KEYRING_FILE,
            BACKUP_MANIFEST_FILE,
        ],
    )?;
    sync_directory(&temporary.path)?;
    backup_step_completed(4)?;
    temporary.publish(output_directory)?;
    Ok(manifest)
}

/// Validate a backup and publish a new instance directory containing the
/// database, its mechanically named keyring sidecar, and a fresh declaration.
pub(crate) fn restore_backup(
    backup_directory: &Path,
    target_database: &Path,
    random: &dyn RandomSource,
) -> SnapbackResult<RestoreDeclaration> {
    validate_owner_only_directory(backup_directory)?;
    require_exact_members(
        backup_directory,
        &[
            BACKUP_DATABASE_FILE,
            BACKUP_KEYRING_FILE,
            BACKUP_MANIFEST_FILE,
        ],
    )?;

    let manifest_bytes = crate::secure_file::read_strict_owner_only(
        &backup_directory.join(BACKUP_MANIFEST_FILE),
        BACKUP_MANIFEST_MAXIMUM_BYTES,
    )
    .map_err(|_| backup_invalid("backup manifest is missing or unreadable"))?;
    let manifest = AuthBackupManifest::parse(&manifest_bytes)?;

    let mut source_database =
        crate::secure_file::open_strict_owner_only(&backup_directory.join(BACKUP_DATABASE_FILE))
            .map_err(|_| backup_invalid("backup database is missing or unreadable"))?;
    if sha256_file(&mut source_database)? != manifest.database_sha256 {
        return Err(backup_invalid(
            "backup database hash does not match manifest",
        ));
    }
    restore_source_database_hashed();

    let source_keyring_path = backup_directory.join(BACKUP_KEYRING_FILE);
    let source_keyring = AuthKeyringStore::file_at_path(source_keyring_path);
    let keyring_bytes = source_keyring
        .validated_file_bytes()
        .map_err(|_| backup_invalid("backup keyring is missing or invalid"))?;
    if sha256_bytes(keyring_bytes.expose_secret()) != manifest.keyring_sha256 {
        return Err(backup_invalid(
            "backup keyring hash does not match manifest",
        ));
    }

    let target_instance = target_instance_directory(target_database)?;
    require_absent(
        &target_instance,
        "restore target instance directory already exists",
    )?;
    let database_basename = target_database
        .file_name()
        .ok_or_else(|| backup_invalid("restore target database has no basename"))?;
    let mut temporary = TemporaryDirectory::create(&target_instance, "restore", random)?;
    restore_step_completed(0)?;
    let staged_database = temporary.path.join(database_basename);
    crate::secure_file::copy_new_owner_only(&mut source_database, &staged_database)
        .map_err(|_| backup_invalid("restored database could not be staged"))?;
    if sha256_path(&staged_database)? != manifest.database_sha256 {
        return Err(backup_invalid(
            "staged database hash does not match the validated backup",
        ));
    }
    restore_step_completed(1)?;

    if LocalDatabase::inspect_auth_catalog_file_read_only(&staged_database)
        .map_err(|_| backup_invalid("restored auth catalog is not an exact ReadyV1 catalog"))?
        != AuthCatalogState::ReadyV1
    {
        return Err(backup_invalid(
            "restored auth catalog is not an exact ReadyV1 catalog",
        ));
    }
    validate_retained_key_references(
        LocalDatabase::auth_retained_key_ids_file_read_only(&staged_database),
        &keyring_bytes,
    )?;

    let staged_keyring = AuthKeyringStore::keyring_path(&staged_database);
    crate::secure_file::write_new_owner_only(&staged_keyring, keyring_bytes.expose_secret())
        .map_err(|_| backup_invalid("restored keyring could not be staged"))?;
    restore_step_completed(2)?;

    let declaration = RestoreDeclaration::fresh();
    crate::secure_file::write_new_owner_only(
        &temporary.path.join(RESTORE_DECLARATION_FILE),
        &declaration.to_bytes()?,
    )
    .map_err(|_| backup_invalid("restore declaration could not be staged"))?;
    restore_step_completed(3)?;

    let expected = [
        database_basename.to_owned(),
        staged_keyring
            .file_name()
            .expect("staged keyring has a basename")
            .to_owned(),
        OsString::from(RESTORE_DECLARATION_FILE),
    ];
    require_exact_os_members(&temporary.path, &expected)?;
    require_exact_members(
        backup_directory,
        &[
            BACKUP_DATABASE_FILE,
            BACKUP_KEYRING_FILE,
            BACKUP_MANIFEST_FILE,
        ],
    )?;
    sync_directory(&temporary.path)?;
    restore_step_completed(4)?;
    temporary.publish(&target_instance)?;
    Ok(declaration)
}

fn validate_retained_key_references(
    key_ids: SnapbackResult<Vec<String>>,
    keyring: &crate::auth::keyring::ValidatedKeyringBytes,
) -> SnapbackResult<()> {
    let key_ids = key_ids
        .map_err(|_| backup_invalid("retained auth key references are invalid"))?
        .into_iter()
        .map(|raw| {
            AuthKeyId::parse(&raw)
                .map_err(|_| backup_invalid("retained auth key references are invalid"))
        })
        .collect::<SnapbackResult<Vec<_>>>()?;
    if !keyring
        .contains_all(&key_ids)
        .map_err(|_| backup_invalid("captured auth keyring is invalid"))?
    {
        return Err(backup_invalid(
            "retained auth key references are not in the captured keyring",
        ));
    }
    Ok(())
}

fn target_instance_directory(target_database: &Path) -> SnapbackResult<PathBuf> {
    if target_database.file_name().is_none() {
        return Err(backup_invalid("restore target database has no basename"));
    }
    let instance = target_database
        .parent()
        .filter(|path| path.file_name().is_some())
        .ok_or_else(|| {
            backup_invalid("restore target must be a database inside a new instance directory")
        })?;
    let parent = instance
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let metadata = std::fs::metadata(parent)
        .map_err(|_| backup_invalid("restore target parent directory is unavailable"))?;
    if !metadata.is_dir() {
        return Err(backup_invalid(
            "restore target parent path is not a directory",
        ));
    }
    Ok(instance.to_path_buf())
}

fn require_absent(path: &Path, message: &str) -> SnapbackResult<()> {
    match std::fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Ok(_) => Err(backup_invalid(message)),
        Err(_) => Err(backup_invalid(
            "artifact destination could not be inspected",
        )),
    }
}

fn require_exact_members(directory: &Path, expected: &[&str]) -> SnapbackResult<()> {
    let expected = expected.iter().map(OsString::from).collect::<Vec<_>>();
    require_exact_os_members(directory, &expected)
}

fn require_exact_os_members(directory: &Path, expected: &[OsString]) -> SnapbackResult<()> {
    let actual = std::fs::read_dir(directory)
        .map_err(|_| backup_invalid("artifact directory could not be enumerated"))?
        .map(|entry| {
            entry
                .map(|entry| entry.file_name())
                .map_err(|_| backup_invalid("artifact directory could not be enumerated"))
        })
        .collect::<SnapbackResult<BTreeSet<_>>>()?;
    let expected = expected.iter().cloned().collect::<BTreeSet<_>>();
    if actual != expected {
        return Err(backup_invalid(
            "artifact directory does not contain the exact required files",
        ));
    }
    Ok(())
}

fn sha256_path(path: &Path) -> SnapbackResult<String> {
    let mut file = crate::secure_file::open_strict_owner_only(path)
        .map_err(|_| backup_invalid("backup file could not be hashed"))?;
    sha256_file(&mut file)
}

fn sha256_file(file: &mut File) -> SnapbackResult<String> {
    file.seek(SeekFrom::Start(0))
        .map_err(|_| backup_invalid("backup file could not be hashed"))?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|_| backup_invalid("backup file could not be hashed"))?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    file.seek(SeekFrom::Start(0))
        .map_err(|_| backup_invalid("backup file could not be hashed"))?;
    Ok(hex_sha256(digest.finalize().as_slice()))
}

fn sha256_bytes(bytes: &[u8]) -> String {
    hex_sha256(Sha256::digest(bytes).as_slice())
}

fn hex_sha256(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

fn canonical_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn portable_basename(value: &str) -> bool {
    !value.is_empty()
        && value != "."
        && value != ".."
        && Path::new(value).file_name() == Some(OsStr::new(value))
}

struct TemporaryDirectory {
    path: PathBuf,
    name: OsString,
    parent: PinnedDirectory,
    published: bool,
}

impl TemporaryDirectory {
    fn create(
        destination: &Path,
        operation: &str,
        random: &dyn RandomSource,
    ) -> SnapbackResult<Self> {
        let parent_path = destination
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));
        let parent = PinnedDirectory::open(parent_path)?;
        for _ in 0..TEMP_CANDIDATE_ATTEMPTS {
            let mut entropy = [0_u8; 16];
            random
                .fill(&mut entropy)
                .map_err(|_| backup_invalid("temporary artifact name could not be generated"))?;
            let suffix = encode_base64url(&entropy);
            let name = OsString::from(format!(".snapback-auth-{operation}-{suffix}.tmp"));
            let candidate = parent_path.join(&name);
            match create_owner_only_directory(&candidate) {
                Ok(()) => {
                    parent.revalidate()?;
                    return Ok(Self {
                        path: candidate,
                        name,
                        parent,
                        published: false,
                    });
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(_) => {
                    return Err(backup_invalid(
                        "temporary artifact directory could not be created",
                    ));
                }
            }
        }
        Err(backup_invalid(
            "temporary artifact directory name collided repeatedly",
        ))
    }

    fn publish(&mut self, destination: &Path) -> SnapbackResult<()> {
        self.parent.revalidate()?;
        let destination_name = destination
            .file_name()
            .ok_or_else(|| backup_invalid("artifact destination has no basename"))?;
        crate::secure_file::rename_no_replace_in_directory(
            &self.parent.file,
            &self.name,
            destination_name,
        )
        .map_err(|_| backup_invalid("artifact directory could not be published"))?;
        self.published = true;
        self.parent
            .file
            .sync_all()
            .map_err(|_| backup_invalid("artifact directory publication could not be synced"))
    }
}

impl Drop for TemporaryDirectory {
    fn drop(&mut self) {
        if !self.published && self.parent.path_still_matches() {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }
}

struct PinnedDirectory {
    file: File,
    path: PathBuf,
    device: u64,
    inode: u64,
}

impl PinnedDirectory {
    #[cfg(unix)]
    fn open(path: &Path) -> SnapbackResult<Self> {
        use std::os::unix::fs::{MetadataExt as _, OpenOptionsExt as _};

        let file = std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(path)
            .map_err(|_| backup_invalid("artifact parent directory could not be pinned"))?;
        let metadata = file
            .metadata()
            .map_err(|_| backup_invalid("artifact parent directory could not be pinned"))?;
        if !metadata.is_dir() {
            return Err(backup_invalid("artifact parent path is not a directory"));
        }
        let pinned = Self {
            file,
            path: path.to_path_buf(),
            device: metadata.dev(),
            inode: metadata.ino(),
        };
        pinned.revalidate()?;
        Ok(pinned)
    }

    #[cfg(not(unix))]
    fn open(_path: &Path) -> SnapbackResult<Self> {
        Err(backup_invalid(
            "descriptor-pinned artifact publication is unsupported on this host",
        ))
    }

    fn revalidate(&self) -> SnapbackResult<()> {
        if self.path_still_matches() {
            Ok(())
        } else {
            Err(backup_invalid(
                "artifact parent directory changed during publication",
            ))
        }
    }

    #[cfg(unix)]
    fn path_still_matches(&self) -> bool {
        use std::os::unix::fs::MetadataExt as _;

        std::fs::symlink_metadata(&self.path).is_ok_and(|metadata| {
            metadata.file_type().is_dir()
                && metadata.dev() == self.device
                && metadata.ino() == self.inode
        })
    }

    #[cfg(not(unix))]
    fn path_still_matches(&self) -> bool {
        false
    }
}

#[cfg(unix)]
fn create_owner_only_directory(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::DirBuilderExt as _;

    let mut builder = std::fs::DirBuilder::new();
    builder.mode(0o700).create(path)?;
    validate_owner_only_directory_io(path)
}

#[cfg(not(unix))]
fn create_owner_only_directory(_path: &Path) -> std::io::Result<()> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "owner-only artifact directories are unsupported on this host",
    ))
}

fn validate_owner_only_directory(path: &Path) -> SnapbackResult<()> {
    validate_owner_only_directory_io(path)
        .map_err(|_| backup_invalid("artifact directory is not strictly owner-only"))
}

#[cfg(unix)]
fn validate_owner_only_directory_io(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::{MetadataExt as _, PermissionsExt as _};

    let metadata = std::fs::symlink_metadata(path)?;
    // SAFETY: geteuid has no preconditions and only reads process identity.
    let effective_uid = unsafe { libc::geteuid() };
    if !metadata.file_type().is_dir()
        || metadata.uid() != effective_uid
        || metadata.permissions().mode() & 0o777 != 0o700
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "directory is not strictly owner-only",
        ));
    }
    Ok(())
}

#[cfg(not(unix))]
fn validate_owner_only_directory_io(_path: &Path) -> std::io::Result<()> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "owner-only artifact directories are unsupported on this host",
    ))
}

fn sync_directory(path: &Path) -> SnapbackResult<()> {
    File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|_| backup_invalid("artifact directory could not be synced"))
}

fn backup_invalid(message: &str) -> SnapbackError {
    SnapbackError::error("SNAPBACK_AUTH_BACKUP_INVALID", "auth-backup", message)
}

#[cfg(test)]
thread_local! {
    static FAIL_BACKUP_AFTER_STEP: std::cell::Cell<Option<usize>> = const { std::cell::Cell::new(None) };
    static FAIL_RESTORE_AFTER_STEP: std::cell::Cell<Option<usize>> = const { std::cell::Cell::new(None) };
    static AFTER_RESTORE_SOURCE_HASH: std::cell::RefCell<Option<Box<dyn FnOnce()>>> = const { std::cell::RefCell::new(None) };
    static AFTER_BACKUP_KEYRING_CAPTURE: std::cell::RefCell<Option<Box<dyn FnOnce()>>> = const { std::cell::RefCell::new(None) };
}

fn backup_keyring_captured() {
    #[cfg(test)]
    AFTER_BACKUP_KEYRING_CAPTURE.with(|slot| {
        if let Some(operation) = slot.borrow_mut().take() {
            operation();
        }
    });
}

fn restore_source_database_hashed() {
    #[cfg(test)]
    AFTER_RESTORE_SOURCE_HASH.with(|slot| {
        if let Some(operation) = slot.borrow_mut().take() {
            operation();
        }
    });
}

fn backup_step_completed(step: usize) -> SnapbackResult<()> {
    #[cfg(not(test))]
    let _ = step;
    #[cfg(test)]
    FAIL_BACKUP_AFTER_STEP.with(|slot| {
        if slot.get() == Some(step) {
            slot.set(None);
            return Err(SnapbackError::error(
                "TEST_AUTH_BACKUP_FAILURE",
                "auth-backup",
                "injected backup publication failure",
            ));
        }
        Ok(())
    })?;
    Ok(())
}

fn restore_step_completed(step: usize) -> SnapbackResult<()> {
    #[cfg(not(test))]
    let _ = step;
    #[cfg(test)]
    FAIL_RESTORE_AFTER_STEP.with(|slot| {
        if slot.get() == Some(step) {
            slot.set(None);
            return Err(SnapbackError::error(
                "TEST_AUTH_RESTORE_FAILURE",
                "auth-restore",
                "injected restore publication failure",
            ));
        }
        Ok(())
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::crypto::{CryptoError, RandomSource};
    use crate::auth::lifecycle::{EmailCodeReadiness, activate_catalog};
    use rusqlite::params;
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
                .with_auth_transaction(|tx| {
                    tx.execute(
                        "INSERT INTO _auth_verification_codes(
                           challenge_id, canonical_address, code_digest, key_id,
                           attempts, max_attempts, requested_at_ms, expires_at_ms,
                           consumed_at_ms, superseded_by
                         ) VALUES('sbc_AAAAAAAAAAAAAAAAAAAAAA', 'user@example.com', ?1, ?2,
                                  0, 5, 10, 1000, NULL, NULL)",
                        params![vec![7_u8; 32], key_id],
                    )?;
                    Ok(())
                })
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
        use std::os::unix::fs::PermissionsExt as _;

        let fixture = Fixture::new();
        let backup_directory = fixture.parent().join("backup");
        let manifest = create_backup(
            &fixture.database,
            &fixture.keyring,
            &backup_directory,
            123,
            &fixture.random,
        )
        .unwrap();
        assert_eq!(manifest.created_at_ms, 123);
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
        let declaration =
            restore_backup(&backup_directory, &target_database, &fixture.random).unwrap();
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
            AuthCatalogState::ReadyV1
        );
        assert_eq!(restored.auth_retained_key_ids().unwrap().len(), 1);
        let restored_keyring = AuthKeyringStore::file_for_database(&target_database);
        let key_id = AuthKeyId::parse(&restored.auth_retained_key_ids().unwrap()[0]).unwrap();
        restored_keyring.with_key(&key_id, |_| ()).unwrap();
    }

    #[test]
    fn backup_failure_injection_never_publishes_partial_directory() {
        let fixture = Fixture::new();
        for step in 0..=4 {
            let output = fixture.parent().join(format!("backup-{step}"));
            FAIL_BACKUP_AFTER_STEP.with(|slot| slot.set(Some(step)));
            let error = create_backup(
                &fixture.database,
                &fixture.keyring,
                &output,
                123,
                &fixture.random,
            )
            .unwrap_err();
            assert_eq!(error.diagnostic.code, "TEST_AUTH_BACKUP_FAILURE");
            assert!(!output.exists());
            assert_no_temporary(fixture.parent(), ".snapback-auth-backup-");
        }
    }

    #[test]
    fn restore_failure_injection_never_publishes_partial_instance() {
        let fixture = Fixture::new();
        let backup_directory = fixture.parent().join("backup");
        create_backup(
            &fixture.database,
            &fixture.keyring,
            &backup_directory,
            123,
            &fixture.random,
        )
        .unwrap();
        for step in 0..=4 {
            let instance = fixture.parent().join(format!("restored-{step}"));
            let target = instance.join("app.sqlite3");
            FAIL_RESTORE_AFTER_STEP.with(|slot| slot.set(Some(step)));
            let error = restore_backup(&backup_directory, &target, &fixture.random).unwrap_err();
            assert_eq!(error.diagnostic.code, "TEST_AUTH_RESTORE_FAILURE");
            assert!(!instance.exists());
            assert_no_temporary(fixture.parent(), ".snapback-auth-restore-");
        }
    }

    #[test]
    fn restore_rehashes_the_staged_copy_and_rechecks_source_membership() {
        use std::io::Write as _;

        let fixture = Fixture::new();
        let backup_directory = fixture.parent().join("backup");
        create_backup(
            &fixture.database,
            &fixture.keyring,
            &backup_directory,
            123,
            &fixture.random,
        )
        .unwrap();
        let database_file = backup_directory.join(BACKUP_DATABASE_FILE);
        AFTER_RESTORE_SOURCE_HASH.with(|slot| {
            *slot.borrow_mut() = Some(Box::new(move || {
                std::fs::OpenOptions::new()
                    .append(true)
                    .open(database_file)
                    .unwrap()
                    .write_all(b"changed-after-validation")
                    .unwrap();
            }));
        });
        let target = fixture
            .parent()
            .join("restored-mutated")
            .join("app.sqlite3");
        let error = restore_backup(&backup_directory, &target, &fixture.random).unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_BACKUP_INVALID");
        assert!(!target.parent().unwrap().exists());
        assert_no_temporary(fixture.parent(), ".snapback-auth-restore-");

        let fixture = Fixture::new();
        let backup_directory = fixture.parent().join("backup");
        create_backup(
            &fixture.database,
            &fixture.keyring,
            &backup_directory,
            123,
            &fixture.random,
        )
        .unwrap();
        let extra = backup_directory.join("appeared-during-restore");
        AFTER_RESTORE_SOURCE_HASH.with(|slot| {
            *slot.borrow_mut() = Some(Box::new(move || {
                std::fs::write(extra, b"unexpected").unwrap();
            }));
        });
        let target = fixture.parent().join("restored-extra").join("app.sqlite3");
        let error = restore_backup(&backup_directory, &target, &fixture.random).unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_BACKUP_INVALID");
        assert!(!target.parent().unwrap().exists());
        assert_no_temporary(fixture.parent(), ".snapback-auth-restore-");
    }

    #[test]
    fn pinned_parent_detects_path_replacement() {
        let root = tempfile::tempdir().unwrap();
        let parent = root.path().join("parent");
        create_owner_only_directory(&parent).unwrap();
        let pinned = PinnedDirectory::open(&parent).unwrap();
        std::fs::rename(&parent, root.path().join("moved-parent")).unwrap();
        create_owner_only_directory(&parent).unwrap();
        let error = pinned.revalidate().unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_BACKUP_INVALID");
    }

    #[test]
    fn restore_rejects_hash_drift_unknown_fields_extra_files_and_existing_target() {
        let fixture = Fixture::new();
        let backup_directory = fixture.parent().join("backup");
        let manifest = create_backup(
            &fixture.database,
            &fixture.keyring,
            &backup_directory,
            123,
            &fixture.random,
        )
        .unwrap();
        let target = fixture.parent().join("restored").join("app.sqlite3");

        std::fs::write(backup_directory.join("extra"), b"x").unwrap();
        let error = restore_backup(&backup_directory, &target, &fixture.random).unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_BACKUP_INVALID");
        assert!(!target.parent().unwrap().exists());
        std::fs::remove_file(backup_directory.join("extra")).unwrap();

        let manifest_path = backup_directory.join(BACKUP_MANIFEST_FILE);
        let mut value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&manifest_path).unwrap()).unwrap();
        value["extra"] = serde_json::json!(true);
        std::fs::write(&manifest_path, serde_json::to_vec(&value).unwrap()).unwrap();
        let error = restore_backup(&backup_directory, &target, &fixture.random).unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_BACKUP_INVALID");
        assert!(!target.parent().unwrap().exists());

        std::fs::write(&manifest_path, manifest.to_bytes().unwrap()).unwrap();
        use std::io::Write as _;
        std::fs::OpenOptions::new()
            .append(true)
            .open(backup_directory.join(BACKUP_DATABASE_FILE))
            .unwrap()
            .write_all(b"tamper")
            .unwrap();
        let error = restore_backup(&backup_directory, &target, &fixture.random).unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_BACKUP_INVALID");
        assert!(!target.parent().unwrap().exists());

        std::fs::create_dir(target.parent().unwrap()).unwrap();
        let error = restore_backup(&backup_directory, &target, &fixture.random).unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_BACKUP_INVALID");
    }

    #[test]
    fn backup_refuses_memory_uninitialized_and_missing_referenced_key() {
        let directory = tempfile::tempdir().unwrap();
        let memory = LocalDatabase::memory().unwrap();
        let error = create_backup(
            &memory,
            &AuthKeyringStore::in_memory(),
            &directory.path().join("memory"),
            0,
            &CountingRandom::default(),
        )
        .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_BACKUP_INVALID");

        let path = directory.path().join("uninitialized.sqlite3");
        let database = LocalDatabase::open(&path).unwrap();
        let keyring = AuthKeyringStore::file_for_database(&path);
        keyring
            .load_or_mint_initial(0, &CountingRandom::default())
            .unwrap();
        let error = create_backup(
            &database,
            &keyring,
            &directory.path().join("uninitialized"),
            0,
            &CountingRandom::default(),
        )
        .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_BACKUP_INVALID");

        let mut fixture = Fixture::new();
        fixture
            .database
            .with_auth_transaction(|tx| {
                tx.execute(
                    "UPDATE _auth_verification_codes
                     SET key_id = 'sbak_AAAAAAAAAAAAAAAAAAAAAA'",
                    [],
                )?;
                Ok(())
            })
            .unwrap();
        let error = create_backup(
            &fixture.database,
            &fixture.keyring,
            &fixture.parent().join("missing-key"),
            0,
            &fixture.random,
        )
        .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_BACKUP_INVALID");
    }

    #[test]
    fn backup_validates_references_against_exact_captured_keyring_bytes() {
        let mut fixture = Fixture::new();
        let replacement_database = fixture.parent().join("replacement.sqlite3");
        let replacement_keyring = AuthKeyringStore::file_for_database(&replacement_database);
        let replacement_random = CountingRandom(AtomicU8::new(97));
        replacement_keyring
            .load_or_mint_initial(0, &replacement_random)
            .unwrap();
        let replacement_key_id = replacement_keyring
            .with_active_key(0, &replacement_random, |id, _| id.as_str().to_owned())
            .unwrap();
        let replacement_bytes =
            std::fs::read(AuthKeyringStore::keyring_path(&replacement_database)).unwrap();

        fixture
            .database
            .with_auth_transaction(|tx| {
                tx.execute(
                    "UPDATE _auth_verification_codes SET key_id = ?1",
                    params![replacement_key_id],
                )?;
                Ok(())
            })
            .unwrap();
        let live_keyring_path = AuthKeyringStore::keyring_path(&fixture.database_path);
        AFTER_BACKUP_KEYRING_CAPTURE.with(|slot| {
            *slot.borrow_mut() = Some(Box::new(move || {
                std::fs::write(live_keyring_path, replacement_bytes).unwrap();
            }));
        });

        let output = fixture.parent().join("spliced-keyrings");
        let error = create_backup(
            &fixture.database,
            &fixture.keyring,
            &output,
            0,
            &fixture.random,
        )
        .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_BACKUP_INVALID");
        assert!(!output.exists());
    }

    fn assert_no_temporary(parent: &Path, prefix: &str) {
        assert!(std::fs::read_dir(parent).unwrap().all(|entry| {
            !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(prefix)
        }));
    }
}
