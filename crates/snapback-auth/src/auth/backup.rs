//! Consistent physical auth backup and offline restore artifacts.
//!
//! The caller owns the instance lock and exclusive auth-maintenance guard for
//! backup. Restore is offline under the target instance lock. This module owns
//! artifact validation/publication, never process routing or CLI policy.

// @ref LLP 0057#consistent-backup — one quiescence boundary binds an online SQLite image to the exact validated keyring bytes.
// @ref LLP 0057#restore — a restored instance directory is staged owner-only and published by one same-filesystem rename.

use crate::auth::crypto::{AuthKeyId, RandomSource, encode_base64url};
use crate::auth::keyring::AuthKeyringStore;
use crate::auth::lifecycle::{RESTORE_DECLARATION_FILE, RestoreDeclaration};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::instance_lock::{FileIdentity, TargetInstanceReservation};
use crate::storage::LocalDatabase;
use crate::storage::auth::{
    AUTH_CATALOG_VERSION, AUTH_CATALOG_VERSION_V1, AUTH_CATALOG_VERSION_V2,
    AUTH_CATALOG_VERSION_V3, AuthCatalogState, PasswordIdentifierMode,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use sha2::{Digest as _, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::ffi::{OsStr, OsString};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use zeroize::Zeroize as _;

pub const BACKUP_DATABASE_FILE: &str = "database.sqlite3";
pub const BACKUP_KEYRING_FILE: &str = "auth-keyring.json";
pub const BACKUP_MANIFEST_FILE: &str = "backup.json";
const BACKUP_FORMAT_VERSION_V1: u32 = 1;
const BACKUP_FORMAT_VERSION: u32 = 2;
const BACKUP_MANIFEST_MAXIMUM_BYTES: usize = 64 * 1024;
const TEMP_CANDIDATE_ATTEMPTS: usize = 3;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

/// Stable operator-visible classification of the backup publication cut.
///
/// `Published` is returned only after rename, post-publication identity checks,
/// and parent-directory fsync all succeed. Once rename is attempted, any
/// failure is `CommitAmbiguous` because a complete artifact may be visible.
/// @ref LLP 0057#consistent-backup — every backup exit publishes one of the
/// three closed publication states.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum BackupPublicationState {
    Unpublished,
    Published,
    CommitAmbiguous,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuthBackupOutcome {
    pub manifest: AuthBackupManifest,
    pub publication_state: BackupPublicationState,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum AuthBackupCatalogState {
    ReadyV3,
    ReadyV4,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AuthBackupManifestV1 {
    format_version: u32,
    created_at_ms: u64,
    catalog_version: u32,
    database_sha256: String,
    keyring_sha256: String,
    source_database_basename: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AuthBackupManifestV2 {
    format_version: u32,
    created_at_ms: u64,
    catalog_state: AuthBackupCatalogState,
    catalog_version: u32,
    catalog_tables: Vec<String>,
    /// Format 2 is deliberately widened for catalog v4. Existing v3 format-2
    /// manifests omit this field; v4 requires the immutable declaration.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    password_identifier_mode: Option<String>,
    database_sha256: String,
    keyring_sha256: String,
    source_database_basename: String,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum AuthBackupManifestWire {
    Format1(AuthBackupManifestV1),
    Format2(AuthBackupManifestV2),
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum AuthBackupManifestData {
    Format1(AuthBackupManifestV1),
    Format2(AuthBackupManifestV2),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuthBackupManifest(AuthBackupManifestData);

impl AuthBackupManifest {
    fn new(
        catalog: AuthCatalogState,
        password_identifier_mode: Option<PasswordIdentifierMode>,
        created_at_ms: u64,
        database_sha256: String,
        keyring_sha256: String,
        source_database_basename: String,
    ) -> Self {
        Self(match catalog {
            AuthCatalogState::ReadyV1 | AuthCatalogState::ReadyV2 => {
                AuthBackupManifestData::Format1(AuthBackupManifestV1 {
                    format_version: BACKUP_FORMAT_VERSION_V1,
                    created_at_ms,
                    catalog_version: match catalog {
                        AuthCatalogState::ReadyV1 => AUTH_CATALOG_VERSION_V1,
                        AuthCatalogState::ReadyV2 => AUTH_CATALOG_VERSION_V2,
                        _ => unreachable!("predecessor catalog matched above"),
                    }
                    .parse()
                    .expect("catalog versions are numeric constants"),
                    database_sha256,
                    keyring_sha256,
                    source_database_basename,
                })
            }
            AuthCatalogState::ReadyV3 | AuthCatalogState::ReadyV4 => {
                AuthBackupManifestData::Format2(AuthBackupManifestV2 {
                    format_version: BACKUP_FORMAT_VERSION,
                    created_at_ms,
                    catalog_state: match catalog {
                        AuthCatalogState::ReadyV3 => AuthBackupCatalogState::ReadyV3,
                        AuthCatalogState::ReadyV4 => AuthBackupCatalogState::ReadyV4,
                        _ => unreachable!("identity-core catalog matched above"),
                    },
                    catalog_version: match catalog {
                        AuthCatalogState::ReadyV3 => AUTH_CATALOG_VERSION_V3,
                        AuthCatalogState::ReadyV4 => AUTH_CATALOG_VERSION,
                        _ => unreachable!("identity-core catalog matched above"),
                    }
                    .parse()
                    .expect("catalog versions are numeric constants"),
                    catalog_tables: crate::storage::auth::auth_catalog_table_names(catalog)
                        .expect("ready catalog has a table inventory")
                        .into_iter()
                        .map(str::to_owned)
                        .collect(),
                    password_identifier_mode: password_identifier_mode
                        .map(|mode| mode.as_str().to_owned()),
                    database_sha256,
                    keyring_sha256,
                    source_database_basename,
                })
            }
            AuthCatalogState::Uninitialized => unreachable!("backup requires a ready catalog"),
        })
    }

    fn validate(&self) -> SnapbackResult<()> {
        let common_valid = self.created_at_ms() <= MAX_SAFE_INTEGER
            && canonical_sha256(self.database_sha256())
            && canonical_sha256(self.keyring_sha256())
            && portable_basename(self.source_database_basename());
        let format_valid = match &self.0 {
            AuthBackupManifestData::Format1(manifest) => {
                manifest.format_version == BACKUP_FORMAT_VERSION_V1
                    && matches!(manifest.catalog_version, 1 | 2)
            }
            AuthBackupManifestData::Format2(manifest) => {
                let catalog = match manifest.catalog_state {
                    AuthBackupCatalogState::ReadyV3 => AuthCatalogState::ReadyV3,
                    AuthBackupCatalogState::ReadyV4 => AuthCatalogState::ReadyV4,
                };
                let expected = crate::storage::auth::auth_catalog_table_names(catalog)
                    .expect("ready catalog has a table inventory");
                let version_and_mode_valid = match manifest.catalog_state {
                    AuthBackupCatalogState::ReadyV3 => {
                        manifest.catalog_version == 3 && manifest.password_identifier_mode.is_none()
                    }
                    AuthBackupCatalogState::ReadyV4 => {
                        manifest.catalog_version == 4
                            && matches!(
                                manifest.password_identifier_mode.as_deref(),
                                Some("username-v1" | "email-v1")
                            )
                    }
                };
                manifest.format_version == BACKUP_FORMAT_VERSION
                    && version_and_mode_valid
                    && manifest.catalog_tables.len() == expected.len()
                    && manifest
                        .catalog_tables
                        .iter()
                        .zip(expected)
                        .all(|(actual, expected)| actual == expected)
            }
        };
        if !common_valid || !format_valid {
            return Err(backup_invalid(
                "backup manifest is not a valid closed supported object",
            ));
        }
        Ok(())
    }

    pub fn to_bytes(&self) -> SnapbackResult<Vec<u8>> {
        self.validate()?;
        match &self.0 {
            AuthBackupManifestData::Format1(manifest) => serde_json::to_vec(manifest),
            AuthBackupManifestData::Format2(manifest) => serde_json::to_vec(manifest),
        }
        .map_err(|_| backup_invalid("backup manifest could not be encoded"))
    }

    fn parse(bytes: &[u8]) -> SnapbackResult<Self> {
        let data = match serde_json::from_slice(bytes)
            .map_err(|_| backup_invalid("backup manifest is not a closed supported object"))?
        {
            AuthBackupManifestWire::Format1(manifest) => AuthBackupManifestData::Format1(manifest),
            AuthBackupManifestWire::Format2(manifest) => AuthBackupManifestData::Format2(manifest),
        };
        let manifest = Self(data);
        manifest.validate()?;
        Ok(manifest)
    }

    pub fn format_version(&self) -> u32 {
        match &self.0 {
            AuthBackupManifestData::Format1(manifest) => manifest.format_version,
            AuthBackupManifestData::Format2(manifest) => manifest.format_version,
        }
    }

    pub fn created_at_ms(&self) -> u64 {
        match &self.0 {
            AuthBackupManifestData::Format1(manifest) => manifest.created_at_ms,
            AuthBackupManifestData::Format2(manifest) => manifest.created_at_ms,
        }
    }

    pub fn catalog_state(&self) -> Option<AuthBackupCatalogState> {
        match &self.0 {
            AuthBackupManifestData::Format1(_) => None,
            AuthBackupManifestData::Format2(manifest) => Some(manifest.catalog_state),
        }
    }

    pub fn catalog_version(&self) -> u32 {
        match &self.0 {
            AuthBackupManifestData::Format1(manifest) => manifest.catalog_version,
            AuthBackupManifestData::Format2(manifest) => manifest.catalog_version,
        }
    }

    pub fn catalog_tables(&self) -> Option<&[String]> {
        match &self.0 {
            AuthBackupManifestData::Format1(_) => None,
            AuthBackupManifestData::Format2(manifest) => Some(&manifest.catalog_tables),
        }
    }

    pub fn password_identifier_mode(&self) -> Option<&str> {
        match &self.0 {
            AuthBackupManifestData::Format1(_) => None,
            AuthBackupManifestData::Format2(manifest) => {
                manifest.password_identifier_mode.as_deref()
            }
        }
    }

    fn database_sha256(&self) -> &str {
        match &self.0 {
            AuthBackupManifestData::Format1(manifest) => &manifest.database_sha256,
            AuthBackupManifestData::Format2(manifest) => &manifest.database_sha256,
        }
    }

    fn keyring_sha256(&self) -> &str {
        match &self.0 {
            AuthBackupManifestData::Format1(manifest) => &manifest.keyring_sha256,
            AuthBackupManifestData::Format2(manifest) => &manifest.keyring_sha256,
        }
    }

    fn source_database_basename(&self) -> &str {
        match &self.0 {
            AuthBackupManifestData::Format1(manifest) => &manifest.source_database_basename,
            AuthBackupManifestData::Format2(manifest) => &manifest.source_database_basename,
        }
    }
}

/// Create a complete backup directory. The caller must hold the instance write
/// lock and exclusive auth-maintenance guard until this function returns.
pub fn create_backup(
    database: &LocalDatabase,
    keyring: &AuthKeyringStore,
    output_directory: &Path,
    created_at_ms: u64,
    random: &dyn RandomSource,
) -> SnapbackResult<AuthBackupOutcome> {
    create_backup_inner(database, keyring, output_directory, created_at_ms, random).map_err(
        |error| backup_error_with_publication_state(error, BackupPublicationState::Unpublished),
    )
}

pub fn create_backup_plan<'a>(
    keyring: &'a AuthKeyringStore,
    output_directory: &'a Path,
    created_at_ms: u64,
    random: &'a dyn RandomSource,
) -> impl crate::auth::database_plan::AuthDatabasePlan<Output = SnapbackResult<AuthBackupOutcome>> + 'a
{
    crate::auth::database_plan::plan(move |database| {
        create_backup(database, keyring, output_directory, created_at_ms, random)
    })
}

fn create_backup_inner(
    database: &LocalDatabase,
    keyring: &AuthKeyringStore,
    output_directory: &Path,
    created_at_ms: u64,
    random: &dyn RandomSource,
) -> SnapbackResult<AuthBackupOutcome> {
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
    let catalog = database
        .inspect_auth_catalog()
        .map_err(|_| backup_invalid("source auth catalog is not an exact recognized catalog"))?;
    if !catalog.is_ready() {
        return Err(backup_invalid(
            "source auth catalog is not an exact recognized catalog",
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
    let mut database_image = temporary
        .create_child(OsStr::new(BACKUP_DATABASE_FILE))
        .map_err(|_| backup_invalid("backup database image could not be created"))?;
    backup_database_image_created();
    // Refuse before any source page is copied if the staging path no longer
    // names the descriptor-created database inode. SQLite itself then writes
    // only through that pinned descriptor, so a swap that wins this race
    // still cannot receive catalog pages.
    // @ref LLP 0057#consistent-backup — a replaced or symlinked staging path
    // fails before SQLite copies a page.
    temporary.verify_child_path(OsStr::new(BACKUP_DATABASE_FILE))?;
    database
        .backup_auth_catalog_into(&database_image)
        .map_err(|_| backup_invalid("SQLite online backup did not complete"))?;
    temporary.verify_child_path(OsStr::new(BACKUP_DATABASE_FILE))?;
    backup_step_completed(1)?;

    temporary
        .write_child(
            OsStr::new(BACKUP_KEYRING_FILE),
            keyring_bytes.expose_secret(),
        )
        .map_err(|_| backup_invalid("backup keyring could not be written"))?;
    backup_step_completed(2)?;

    // Hash the exact staged inode through its retained descriptor; the
    // manifest can never attest bytes reached through a replaceable path.
    let database_sha256 = sha256_file(&mut database_image)?;
    let keyring_sha256 = sha256_bytes(keyring_bytes.expose_secret());
    let manifest = AuthBackupManifest::new(
        catalog,
        (catalog == AuthCatalogState::ReadyV4)
            .then(|| database.auth_password_identifier_mode())
            .transpose()?,
        created_at_ms,
        database_sha256,
        keyring_sha256,
        source_database_basename,
    );
    temporary
        .write_child(OsStr::new(BACKUP_MANIFEST_FILE), &manifest.to_bytes()?)
        .map_err(|_| backup_invalid("backup manifest could not be written"))?;
    backup_step_completed(3)?;

    temporary.require_exact_members(&[
        OsString::from(BACKUP_DATABASE_FILE),
        OsString::from(BACKUP_KEYRING_FILE),
        OsString::from(BACKUP_MANIFEST_FILE),
    ])?;
    temporary.sync()?;
    backup_step_completed(4)?;
    let publication_state = temporary.publish(output_directory)?;
    Ok(AuthBackupOutcome {
        manifest,
        publication_state,
    })
}

/// Validate a backup and publish a new instance directory containing the
/// database, its mechanically named keyring sidecar, and a fresh declaration.
pub fn restore_backup(
    backup_directory: &Path,
    target_database: &Path,
    random: &dyn RandomSource,
) -> SnapbackResult<RestoreDeclaration> {
    ensure_restore_target_outside_backup(backup_directory, target_database)?;
    // Acquire the persistent outer reservation before any target inspection or
    // staging. It pins the existing parent used by every later target effect.
    let reservation = TargetInstanceReservation::acquire(target_database).map_err(|error| {
        backup_invalid(&format!(
            "restore target could not be reserved safely: {error}"
        ))
    })?;
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
    if sha256_file(&mut source_database)? != manifest.database_sha256() {
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
    if sha256_bytes(keyring_bytes.expose_secret()) != manifest.keyring_sha256() {
        return Err(backup_invalid(
            "backup keyring hash does not match manifest",
        ));
    }

    reservation
        .ensure_target_absent()
        .map_err(|_| backup_invalid("restore target instance directory already exists"))?;
    let database_basename = target_database
        .file_name()
        .ok_or_else(|| backup_invalid("restore target database has no basename"))?;
    let mut temporary = RestoreTemporaryDirectory::create(&reservation, random)?;
    restore_staging_created();
    restore_step_completed(0)?;
    let staged_database_path = temporary.path.join(database_basename);
    let mut staged_database = temporary
        .copy_child(&mut source_database, database_basename)
        .map_err(|_| backup_invalid("restored database could not be staged"))?;
    temporary.verify_child_path(database_basename)?;
    if sha256_file(&mut staged_database)? != manifest.database_sha256() {
        return Err(backup_invalid(
            "staged database hash does not match the validated backup",
        ));
    }
    restore_step_completed(1)?;

    let restored_catalog = LocalDatabase::inspect_auth_catalog_descriptor_read_only(
        &staged_database,
    )
    .map_err(|_| backup_invalid("restored auth catalog is not an exact recognized catalog"))?;
    if !restored_catalog.is_ready() {
        return Err(backup_invalid(
            "restored auth catalog is not an exact recognized catalog",
        ));
    }
    let restored_catalog_version = match restored_catalog {
        AuthCatalogState::ReadyV1 => 1,
        AuthCatalogState::ReadyV2 => 2,
        AuthCatalogState::ReadyV3 => 3,
        AuthCatalogState::ReadyV4 => 4,
        AuthCatalogState::Uninitialized => unreachable!("readiness checked above"),
    };
    if restored_catalog_version != manifest.catalog_version() {
        return Err(backup_invalid(
            "restored auth catalog version does not match the backup manifest",
        ));
    }
    if restored_catalog == AuthCatalogState::ReadyV4 {
        let restored_mode =
            LocalDatabase::auth_password_identifier_mode_descriptor_read_only(&staged_database)
                .map_err(|_| backup_invalid("restored password identifier mode is invalid"))?;
        if manifest.password_identifier_mode() != Some(restored_mode.as_str()) {
            return Err(backup_invalid(
                "restored password identifier mode does not match the backup manifest",
            ));
        }
    }
    validate_retained_key_references(
        LocalDatabase::auth_retained_key_ids_descriptor_read_only(&staged_database),
        &keyring_bytes,
    )?;

    let staged_keyring = AuthKeyringStore::keyring_path(&staged_database_path);
    let staged_keyring_name = staged_keyring
        .file_name()
        .expect("staged keyring has a basename");
    temporary
        .write_child(staged_keyring_name, keyring_bytes.expose_secret())
        .map_err(|_| backup_invalid("restored keyring could not be staged"))?;
    temporary.verify_child_path(staged_keyring_name)?;
    restore_step_completed(2)?;

    let declaration = RestoreDeclaration::fresh();
    temporary
        .write_child(
            OsStr::new(RESTORE_DECLARATION_FILE),
            &declaration.to_bytes()?,
        )
        .map_err(|_| backup_invalid("restore declaration could not be staged"))?;
    temporary.verify_child_path(OsStr::new(RESTORE_DECLARATION_FILE))?;
    restore_step_completed(3)?;

    let expected = [
        database_basename.to_owned(),
        staged_keyring
            .file_name()
            .expect("staged keyring has a basename")
            .to_owned(),
        OsString::from(RESTORE_DECLARATION_FILE),
    ];
    temporary.require_exact_members(&expected)?;
    require_exact_members(
        backup_directory,
        &[
            BACKUP_DATABASE_FILE,
            BACKUP_KEYRING_FILE,
            BACKUP_MANIFEST_FILE,
        ],
    )?;
    temporary.sync()?;
    restore_step_completed(4)?;
    temporary.publish()?;
    Ok(declaration)
}

fn ensure_restore_target_outside_backup(
    backup_directory: &Path,
    target_database: &Path,
) -> SnapbackResult<()> {
    let backup = std::fs::canonicalize(backup_directory)
        .map_err(|_| backup_invalid("backup directory could not be resolved"))?;
    let instance = target_database
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .ok_or_else(|| backup_invalid("restore target has no instance directory"))?;
    let instance_name = instance
        .file_name()
        .ok_or_else(|| backup_invalid("restore target instance has no name"))?;
    let outer = instance
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let outer = std::fs::canonicalize(outer)
        .map_err(|_| backup_invalid("restore target parent directory is unavailable"))?;
    let instance = outer.join(instance_name);
    let mut lock_name = instance_name.to_os_string();
    lock_name.push(".snapback.restore.lock");
    let lock = outer.join(lock_name);
    if instance.starts_with(&backup) || lock.starts_with(&backup) || backup.starts_with(&instance) {
        return Err(backup_invalid(
            "restore target and reservation must be disjoint from the backup directory",
        ));
    }
    Ok(())
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

fn require_absent(path: &Path, message: &str) -> SnapbackResult<()> {
    match std::fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Ok(_) => Err(backup_invalid(message)),
        Err(_) => Err(backup_invalid(
            "artifact destination could not be inspected",
        )),
    }
}

pub fn require_exact_members(directory: &Path, expected: &[&str]) -> SnapbackResult<()> {
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

/// Restore staging is deliberately separate from backup-output staging: its
/// parent is the same live capability that owns the target reservation, and
/// cleanup remains descriptor-relative even if that parent's pathname moves.
struct RestoreTemporaryDirectory<'a> {
    path: PathBuf,
    name: OsString,
    directory: File,
    identity: FileIdentity,
    reservation: &'a TargetInstanceReservation,
    children: BTreeMap<OsString, FileIdentity>,
    publication_attempted: bool,
    published: bool,
}

impl<'a> RestoreTemporaryDirectory<'a> {
    fn create(
        reservation: &'a TargetInstanceReservation,
        random: &dyn RandomSource,
    ) -> SnapbackResult<Self> {
        for _ in 0..TEMP_CANDIDATE_ATTEMPTS {
            let mut entropy = [0_u8; 16];
            if random.fill(&mut entropy).is_err() {
                entropy.zeroize();
                return Err(backup_invalid(
                    "temporary artifact name could not be generated",
                ));
            }
            let suffix = encode_base64url(&entropy);
            entropy.zeroize();
            let name = OsString::from(format!(".snapback-auth-restore-{suffix}.tmp"));
            match reservation.create_staging_directory(&name) {
                Ok((directory, path, identity)) => {
                    return Ok(Self {
                        path,
                        name,
                        directory,
                        identity,
                        reservation,
                        children: BTreeMap::new(),
                        publication_attempted: false,
                        published: false,
                    });
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(_) => {
                    return Err(backup_invalid(
                        "temporary artifact directory could not be created safely",
                    ));
                }
            }
        }
        Err(backup_invalid(
            "temporary artifact directory name collided repeatedly",
        ))
    }

    fn register(&mut self, name: &OsStr, identity: FileIdentity) {
        self.children.insert(name.to_os_string(), identity);
    }

    fn create_child(&mut self, name: &OsStr) -> std::io::Result<File> {
        #[cfg(any(target_vendor = "apple", target_os = "linux"))]
        {
            use std::os::unix::fs::{MetadataExt as _, PermissionsExt as _};

            let file = create_new_owner_only_at(&self.directory, name)?;
            let identity = FileIdentity::from_file(&file)?;
            // Track the descriptor-created inode before any pathname check or
            // write can fail. Drop may clean only this exact inode.
            self.register(name, identity);
            file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
            crate::secure_file::validate_strict_owner_only_descriptor(&file)?;
            let file_metadata = file.metadata()?;
            let path_file = crate::secure_file::open_strict_owner_only(&self.path.join(name))?;
            let path_metadata = path_file.metadata()?;
            if (path_metadata.dev(), path_metadata.ino())
                != (file_metadata.dev(), file_metadata.ino())
            {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "new staged path does not name the descriptor-created inode",
                ));
            }
            Ok(file)
        }
        #[cfg(not(any(target_vendor = "apple", target_os = "linux")))]
        {
            let _ = name;
            Err(std::io::Error::new(
                std::io::ErrorKind::Unsupported,
                "descriptor-relative restore staging is unsupported on this host",
            ))
        }
    }

    fn write_child(&mut self, name: &OsStr, bytes: &[u8]) -> std::io::Result<()> {
        use std::io::Write as _;

        let mut file = self.create_child(name)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        self.verify_child_path(name)
            .map_err(|error| std::io::Error::other(error.diagnostic.message))
    }

    fn copy_child(&mut self, source: &mut File, name: &OsStr) -> std::io::Result<File> {
        source.seek(SeekFrom::Start(0))?;
        let mut destination = self.create_child(name)?;
        std::io::copy(source, &mut destination)?;
        destination.sync_all()?;
        self.verify_child_path(name)
            .map_err(|error| std::io::Error::other(error.diagnostic.message))?;
        Ok(destination)
    }

    fn verify_child_path(&self, name: &OsStr) -> SnapbackResult<()> {
        {
            #[cfg(any(target_vendor = "apple", target_os = "linux"))]
            {
                use std::os::unix::fs::MetadataExt as _;

                self.reservation
                    .ensure_valid()
                    .map_err(|_| backup_invalid("restore parent changed during staging"))?;
                let descriptor =
                    open_strict_owner_only_at(&self.directory, name).map_err(|_| {
                        backup_invalid("staged restore file is not strictly owner-only")
                    })?;
                let descriptor_metadata = descriptor
                    .metadata()
                    .map_err(|_| backup_invalid("staged restore file could not be inspected"))?;
                let expected = self
                    .children
                    .get(name)
                    .ok_or_else(|| backup_invalid("staged restore file has no cleanup identity"))?;
                if FileIdentity::from_file(&descriptor).map_err(|_| {
                    backup_invalid("staged restore file identity could not be inspected")
                })? != *expected
                {
                    return Err(backup_invalid(
                        "staged restore file identity changed after creation",
                    ));
                }
                let path = crate::secure_file::open_strict_owner_only(&self.path.join(name))
                    .map_err(|_| {
                        backup_invalid("staged restore path is not strictly owner-only")
                    })?;
                let path_metadata = path
                    .metadata()
                    .map_err(|_| backup_invalid("staged restore path could not be inspected"))?;
                if (descriptor_metadata.dev(), descriptor_metadata.ino())
                    != (path_metadata.dev(), path_metadata.ino())
                {
                    return Err(backup_invalid(
                        "staged restore path does not name the pinned staging inode",
                    ));
                }
                self.reservation
                    .ensure_valid()
                    .map_err(|_| backup_invalid("restore parent changed during staging"))
            }
            #[cfg(not(any(target_vendor = "apple", target_os = "linux")))]
            {
                let _ = name;
                Err(backup_invalid(
                    "descriptor-relative restore staging is unsupported on this host",
                ))
            }
        }
    }

    fn require_exact_members(&self, expected: &[OsString]) -> SnapbackResult<()> {
        let actual = directory_members(&self.directory)?;
        let expected = expected.iter().cloned().collect::<BTreeSet<_>>();
        if actual != expected {
            return Err(backup_invalid(
                "artifact directory does not contain the exact required files",
            ));
        }
        Ok(())
    }

    fn sync(&self) -> SnapbackResult<()> {
        self.directory
            .sync_all()
            .map_err(|_| backup_invalid("artifact directory could not be synced"))
    }

    fn publish(&mut self) -> SnapbackResult<()> {
        self.reservation
            .ensure_target_absent()
            .map_err(|_| backup_invalid("restore target appeared before publication"))?;
        before_restore_staging_rename();
        validate_pinned_staged_children(&self.directory, &self.children)
            .map_err(|_| backup_invalid("staged restore members changed before publication"))?;
        self.reservation
            .ensure_staging_directory_identity(&self.name, self.identity)
            .map_err(|_| backup_invalid("staging directory identity changed before publication"))?;
        // A rename failure is not, in general, proof that the directory entry
        // was unchanged. Suppress cleanup before crossing that ambiguity
        // boundary so Drop can never unlink a completely published unit.
        self.publication_attempted = true;
        self.reservation
            .rename_staging_directory(&self.name, self.identity)
            .map_err(|_| backup_invalid("artifact directory could not be published"))?;
        // From this point onward the target may be the complete renamed unit.
        // Any post-rename refusal is commit-ambiguous and must never strip its
        // children through the still-open directory descriptor.
        after_restore_staging_rename();
        post_restore_rename_validation_checkpoint()
            .map_err(|_| backup_invalid("published restore validation was interrupted"))?;
        validate_pinned_staged_children(&self.directory, &self.children)
            .map_err(|_| backup_invalid("published restore members changed"))?;
        self.reservation
            .ensure_published_directory_identity(self.identity)
            .map_err(|_| backup_invalid("published restore directory identity changed"))?;
        // Both post-rename checks succeeded, so the operation may now report a
        // validated publication. Cleanup has already been suppressed since the
        // rename itself; a later durability failure remains commit-ambiguous.
        self.published = true;
        self.reservation
            .sync_parent()
            .map_err(|_| backup_invalid("artifact directory publication could not be synced"))
    }
}

impl Drop for RestoreTemporaryDirectory<'_> {
    fn drop(&mut self) {
        if self.published || self.publication_attempted {
            return;
        }
        #[cfg(any(target_vendor = "apple", target_os = "linux"))]
        {
            use std::os::fd::AsRawFd as _;
            use std::os::unix::ffi::OsStrExt as _;

            for (child, identity) in &self.children {
                if let Ok(child) = std::ffi::CString::new(child.as_bytes())
                    && child_entry_matches(&self.directory, &child, *identity)
                {
                    unsafe {
                        libc::unlinkat(self.directory.as_raw_fd(), child.as_ptr(), 0);
                    }
                }
            }
            let _ = self.directory.sync_all();
            let _ = self
                .reservation
                .remove_staging_directory(&self.name, self.identity);
        }
    }
}

#[cfg(any(target_vendor = "apple", target_os = "linux"))]
fn child_entry_matches(directory: &File, name: &std::ffi::CStr, expected: FileIdentity) -> bool {
    use std::mem::MaybeUninit;
    use std::os::fd::AsRawFd as _;

    let mut stat = MaybeUninit::<libc::stat>::uninit();
    if unsafe {
        libc::fstatat(
            directory.as_raw_fd(),
            name.as_ptr(),
            stat.as_mut_ptr(),
            libc::AT_SYMLINK_NOFOLLOW,
        )
    } != 0
    {
        return false;
    }
    let stat = unsafe { stat.assume_init() };
    stat.st_mode & libc::S_IFMT == libc::S_IFREG && FileIdentity::from_stat(&stat) == expected
}

#[cfg(any(target_vendor = "apple", target_os = "linux"))]
fn validate_pinned_staged_children(
    directory: &File,
    children: &BTreeMap<OsString, FileIdentity>,
) -> std::io::Result<()> {
    let actual = directory_members(directory)
        .map_err(|error| std::io::Error::other(error.diagnostic.message))?;
    let expected = children.keys().cloned().collect::<BTreeSet<_>>();
    if actual != expected {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "staged membership changed",
        ));
    }
    for (name, expected_identity) in children {
        let child = open_strict_owner_only_at(directory, name)?;
        if FileIdentity::from_file(&child)? != *expected_identity {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "staged child identity changed",
            ));
        }
    }
    Ok(())
}

#[cfg(not(any(target_vendor = "apple", target_os = "linux")))]
fn validate_pinned_staged_children(
    _directory: &File,
    _children: &BTreeMap<OsString, FileIdentity>,
) -> std::io::Result<()> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "descriptor-relative restore validation is unsupported on this host",
    ))
}

#[cfg(any(target_vendor = "apple", target_os = "linux"))]
fn create_new_owner_only_at(directory: &File, name: &OsStr) -> std::io::Result<File> {
    use std::os::fd::{AsRawFd as _, FromRawFd as _};
    use std::os::unix::ffi::OsStrExt as _;

    let name = std::ffi::CString::new(name.as_bytes())
        .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidInput, "name contains NUL"))?;
    let fd = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDWR | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0o600,
        )
    };
    if fd < 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(unsafe { File::from_raw_fd(fd) })
}

#[cfg(not(any(target_vendor = "apple", target_os = "linux")))]
fn create_new_owner_only_at(_directory: &File, _name: &OsStr) -> std::io::Result<File> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "descriptor-relative restore staging is unsupported on this host",
    ))
}

#[cfg(any(target_vendor = "apple", target_os = "linux"))]
fn open_strict_owner_only_at(directory: &File, name: &OsStr) -> std::io::Result<File> {
    use std::os::fd::{AsRawFd as _, FromRawFd as _};
    use std::os::unix::ffi::OsStrExt as _;

    let name = std::ffi::CString::new(name.as_bytes())
        .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidInput, "name contains NUL"))?;
    let fd = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0,
        )
    };
    if fd < 0 {
        return Err(std::io::Error::last_os_error());
    }
    let file = unsafe { File::from_raw_fd(fd) };
    crate::secure_file::validate_strict_owner_only_descriptor(&file)?;
    Ok(file)
}

#[cfg(not(any(target_vendor = "apple", target_os = "linux")))]
fn open_strict_owner_only_at(_directory: &File, _name: &OsStr) -> std::io::Result<File> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "descriptor-relative restore staging is unsupported on this host",
    ))
}

#[cfg(any(target_vendor = "apple", target_os = "linux"))]
fn directory_members(directory: &File) -> SnapbackResult<BTreeSet<OsString>> {
    use std::os::fd::AsRawFd as _;
    use std::os::unix::ffi::OsStringExt as _;

    // `dup` would share the directory-stream offset with earlier validation
    // passes. Open `.` through the pinned directory capability so every exact
    // membership check gets an independent stream over the same inode.
    let duplicate = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            c".".as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0,
        )
    };
    if duplicate < 0 {
        return Err(backup_invalid("artifact directory could not be enumerated"));
    }
    let stream = unsafe { libc::fdopendir(duplicate) };
    if stream.is_null() {
        unsafe {
            libc::close(duplicate);
        }
        return Err(backup_invalid("artifact directory could not be enumerated"));
    }
    let mut members = BTreeSet::new();
    loop {
        let entry = unsafe { libc::readdir(stream) };
        if entry.is_null() {
            break;
        }
        let name = unsafe { std::ffi::CStr::from_ptr((*entry).d_name.as_ptr()) };
        if name.to_bytes() != b"." && name.to_bytes() != b".." {
            members.insert(OsString::from_vec(name.to_bytes().to_vec()));
        }
    }
    unsafe {
        libc::closedir(stream);
    }
    Ok(members)
}

#[cfg(not(any(target_vendor = "apple", target_os = "linux")))]
fn directory_members(_directory: &File) -> SnapbackResult<BTreeSet<OsString>> {
    Err(backup_invalid(
        "descriptor-relative restore staging is unsupported on this host",
    ))
}

/// Backup staging pins the output parent, the staging directory, and every
/// staged child inode. Publication renames only the exact pinned staging
/// inode and cleanup unlinks only identities created by this backup; a
/// substituted directory or child is left untouched and the operation fails
/// closed.
///
/// @ref LLP 0057#consistent-backup — the staged artifact remains the exact
/// secure unit created by the command from creation through publication.
struct TemporaryDirectory {
    path: PathBuf,
    name: OsString,
    parent: PinnedDirectory,
    directory: File,
    identity: FileIdentity,
    children: BTreeMap<OsString, FileIdentity>,
    publication_attempted: bool,
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
            if random.fill(&mut entropy).is_err() {
                entropy.zeroize();
                return Err(backup_invalid(
                    "temporary artifact name could not be generated",
                ));
            }
            let suffix = encode_base64url(&entropy);
            entropy.zeroize();
            let name = OsString::from(format!(".snapback-auth-{operation}-{suffix}.tmp"));
            match parent.create_staging_directory(&name) {
                Ok((directory, identity)) => {
                    let path = parent_path.join(&name);
                    return Ok(Self {
                        path,
                        name,
                        parent,
                        directory,
                        identity,
                        children: BTreeMap::new(),
                        publication_attempted: false,
                        published: false,
                    });
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(_) => {
                    return Err(backup_invalid(
                        "temporary artifact directory could not be created safely",
                    ));
                }
            }
        }
        Err(backup_invalid(
            "temporary artifact directory name collided repeatedly",
        ))
    }

    fn register(&mut self, name: &OsStr, identity: FileIdentity) {
        self.children.insert(name.to_os_string(), identity);
    }

    fn create_child(&mut self, name: &OsStr) -> std::io::Result<File> {
        #[cfg(any(target_vendor = "apple", target_os = "linux"))]
        {
            use std::os::unix::fs::{MetadataExt as _, PermissionsExt as _};

            let file = create_new_owner_only_at(&self.directory, name)?;
            let identity = FileIdentity::from_file(&file)?;
            // Track the descriptor-created inode before any pathname check or
            // write can fail. Drop may clean only this exact inode.
            self.register(name, identity);
            file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
            crate::secure_file::validate_strict_owner_only_descriptor(&file)?;
            let file_metadata = file.metadata()?;
            let path_file = crate::secure_file::open_strict_owner_only(&self.path.join(name))?;
            let path_metadata = path_file.metadata()?;
            if (path_metadata.dev(), path_metadata.ino())
                != (file_metadata.dev(), file_metadata.ino())
            {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "new staged path does not name the descriptor-created inode",
                ));
            }
            Ok(file)
        }
        #[cfg(not(any(target_vendor = "apple", target_os = "linux")))]
        {
            let _ = name;
            Err(std::io::Error::new(
                std::io::ErrorKind::Unsupported,
                "descriptor-relative backup staging is unsupported on this host",
            ))
        }
    }

    fn write_child(&mut self, name: &OsStr, bytes: &[u8]) -> std::io::Result<()> {
        use std::io::Write as _;

        let mut file = self.create_child(name)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        self.verify_child_path(name)
            .map_err(|error| std::io::Error::other(error.diagnostic.message))
    }

    fn verify_child_path(&self, name: &OsStr) -> SnapbackResult<()> {
        #[cfg(any(target_vendor = "apple", target_os = "linux"))]
        {
            use std::os::unix::fs::MetadataExt as _;

            self.parent.revalidate()?;
            self.parent
                .ensure_entry_identity(&self.name, self.identity)
                .map_err(|_| backup_invalid("staging directory identity changed during staging"))?;
            let descriptor = open_strict_owner_only_at(&self.directory, name)
                .map_err(|_| backup_invalid("staged backup file is not strictly owner-only"))?;
            let descriptor_metadata = descriptor
                .metadata()
                .map_err(|_| backup_invalid("staged backup file could not be inspected"))?;
            let expected = self
                .children
                .get(name)
                .ok_or_else(|| backup_invalid("staged backup file has no pinned identity"))?;
            if FileIdentity::from_file(&descriptor)
                .map_err(|_| backup_invalid("staged backup file identity could not be inspected"))?
                != *expected
            {
                return Err(backup_invalid(
                    "staged backup file identity changed after creation",
                ));
            }
            let path = crate::secure_file::open_strict_owner_only(&self.path.join(name))
                .map_err(|_| backup_invalid("staged backup path is not strictly owner-only"))?;
            let path_metadata = path
                .metadata()
                .map_err(|_| backup_invalid("staged backup path could not be inspected"))?;
            if (descriptor_metadata.dev(), descriptor_metadata.ino())
                != (path_metadata.dev(), path_metadata.ino())
            {
                return Err(backup_invalid(
                    "staged backup path does not name the pinned staging inode",
                ));
            }
            Ok(())
        }
        #[cfg(not(any(target_vendor = "apple", target_os = "linux")))]
        {
            let _ = name;
            Err(backup_invalid(
                "descriptor-relative backup staging is unsupported on this host",
            ))
        }
    }

    fn require_exact_members(&self, expected: &[OsString]) -> SnapbackResult<()> {
        let actual = directory_members(&self.directory)?;
        let expected = expected.iter().cloned().collect::<BTreeSet<_>>();
        if actual != expected {
            return Err(backup_invalid(
                "artifact directory does not contain the exact required files",
            ));
        }
        Ok(())
    }

    fn sync(&self) -> SnapbackResult<()> {
        self.directory
            .sync_all()
            .map_err(|_| backup_invalid("artifact directory could not be synced"))
    }

    fn publish(&mut self, destination: &Path) -> SnapbackResult<BackupPublicationState> {
        self.parent.revalidate()?;
        let destination_name = destination
            .file_name()
            .ok_or_else(|| backup_invalid("artifact destination has no basename"))?
            .to_os_string();
        before_backup_staging_rename();
        // Immediately before publication: the parent entry must still be the
        // pinned staging inode and every child must be a pinned identity.
        self.parent
            .ensure_entry_identity(&self.name, self.identity)
            .map_err(|_| backup_invalid("staging directory identity changed before publication"))?;
        validate_pinned_staged_children(&self.directory, &self.children)
            .map_err(|_| backup_invalid("staged backup members changed before publication"))?;
        // Rename errors are publication-ambiguous. From this point cleanup is
        // forbidden unless a separate descriptor reconciliation proves the
        // staging inode is still unpublished.
        self.publication_attempted = true;
        crate::secure_file::rename_no_replace_in_directory(
            &self.parent.file,
            &self.name,
            &destination_name,
        )
        .map_err(|_| {
            backup_commit_ambiguous("artifact directory publication result is ambiguous")
        })?;
        backup_rename_result_checkpoint().map_err(|_| {
            backup_commit_ambiguous("artifact directory publication result is ambiguous")
        })?;
        // From this point onward the destination may be the complete renamed
        // unit. Any post-rename refusal is commit-ambiguous and must never
        // strip its children through the still-open directory descriptor.
        after_backup_staging_rename();
        backup_post_rename_validation_checkpoint()
            .map_err(|_| backup_commit_ambiguous("published backup validation did not complete"))?;
        // Immediately after publication: the published name must still be the
        // pinned staging inode with the exact pinned children.
        self.parent
            .ensure_entry_identity(&destination_name, self.identity)
            .map_err(|_| backup_commit_ambiguous("published backup directory identity changed"))?;
        validate_pinned_staged_children(&self.directory, &self.children)
            .map_err(|_| backup_commit_ambiguous("published backup members changed"))?;
        self.published = true;
        backup_parent_sync_checkpoint().map_err(|_| {
            backup_commit_ambiguous("artifact directory publication could not be synced")
        })?;
        self.parent.file.sync_all().map_err(|_| {
            backup_commit_ambiguous("artifact directory publication could not be synced")
        })?;
        Ok(BackupPublicationState::Published)
    }
}

impl Drop for TemporaryDirectory {
    fn drop(&mut self) {
        if self.published || self.publication_attempted {
            return;
        }
        #[cfg(any(target_vendor = "apple", target_os = "linux"))]
        {
            use std::os::fd::AsRawFd as _;
            use std::os::unix::ffi::OsStrExt as _;

            for (child, identity) in &self.children {
                if let Ok(child) = std::ffi::CString::new(child.as_bytes())
                    && child_entry_matches(&self.directory, &child, *identity)
                {
                    unsafe {
                        libc::unlinkat(self.directory.as_raw_fd(), child.as_ptr(), 0);
                    }
                }
            }
            let _ = self.directory.sync_all();
            let _ = self
                .parent
                .remove_staging_directory(&self.name, self.identity);
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

    /// Create a strictly owner-only staging directory as a direct child of
    /// the pinned parent and return its retained descriptor and identity.
    #[cfg(any(target_vendor = "apple", target_os = "linux"))]
    fn create_staging_directory(&self, name: &OsStr) -> std::io::Result<(File, FileIdentity)> {
        use std::os::fd::{AsRawFd as _, FromRawFd as _};
        use std::os::unix::ffi::OsStrExt as _;
        use std::os::unix::fs::{MetadataExt as _, PermissionsExt as _};

        self.revalidate()
            .map_err(|error| std::io::Error::other(error.diagnostic.message))?;
        let name_c = std::ffi::CString::new(name.as_bytes()).map_err(|_| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "staging name contains NUL",
            )
        })?;
        if unsafe { libc::mkdirat(self.file.as_raw_fd(), name_c.as_ptr(), 0o700) } != 0 {
            return Err(std::io::Error::last_os_error());
        }
        let fd = unsafe {
            libc::openat(
                self.file.as_raw_fd(),
                name_c.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                0,
            )
        };
        if fd < 0 {
            let error = std::io::Error::last_os_error();
            unsafe {
                libc::unlinkat(self.file.as_raw_fd(), name_c.as_ptr(), libc::AT_REMOVEDIR);
            }
            return Err(error);
        }
        let directory = unsafe { File::from_raw_fd(fd) };
        let identity = FileIdentity::from_file(&directory)?;
        let result = (|| -> std::io::Result<()> {
            directory.set_permissions(std::fs::Permissions::from_mode(0o700))?;
            let metadata = directory.metadata()?;
            // SAFETY: geteuid has no preconditions and only reads identity.
            if !metadata.file_type().is_dir()
                || metadata.uid() != unsafe { libc::geteuid() }
                || metadata.permissions().mode() & 0o777 != 0o700
            {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "staging directory is not strictly owner-only",
                ));
            }
            self.revalidate()
                .map_err(|error| std::io::Error::other(error.diagnostic.message))
        })();
        if let Err(error) = result {
            let _ = self.remove_staging_directory(name, identity);
            return Err(error);
        }
        Ok((directory, identity))
    }

    #[cfg(not(any(target_vendor = "apple", target_os = "linux")))]
    fn create_staging_directory(&self, _name: &OsStr) -> std::io::Result<(File, FileIdentity)> {
        Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "descriptor-relative backup staging is unsupported on this host",
        ))
    }

    #[cfg(any(target_vendor = "apple", target_os = "linux"))]
    fn stat_at(&self, name: &OsStr) -> std::io::Result<Option<libc::stat>> {
        use std::mem::MaybeUninit;
        use std::os::fd::AsRawFd as _;
        use std::os::unix::ffi::OsStrExt as _;

        let name = std::ffi::CString::new(name.as_bytes()).map_err(|_| {
            std::io::Error::new(std::io::ErrorKind::InvalidInput, "path name contains NUL")
        })?;
        let mut stat = MaybeUninit::<libc::stat>::uninit();
        let result = unsafe {
            libc::fstatat(
                self.file.as_raw_fd(),
                name.as_ptr(),
                stat.as_mut_ptr(),
                libc::AT_SYMLINK_NOFOLLOW,
            )
        };
        if result == 0 {
            return Ok(Some(unsafe { stat.assume_init() }));
        }
        let error = std::io::Error::last_os_error();
        if error.kind() == std::io::ErrorKind::NotFound {
            Ok(None)
        } else {
            Err(error)
        }
    }

    /// Require the parent's directory entry `name` to be exactly the pinned
    /// staging directory inode.
    #[cfg(any(target_vendor = "apple", target_os = "linux"))]
    fn ensure_entry_identity(&self, name: &OsStr, expected: FileIdentity) -> std::io::Result<()> {
        let stat = self.stat_at(name)?.ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "staged directory entry disappeared",
            )
        })?;
        if stat.st_mode & libc::S_IFMT != libc::S_IFDIR || !expected.matches_stat(&stat) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "staged directory entry identity changed",
            ));
        }
        Ok(())
    }

    /// Remove the staging entry only while it is still the exact pinned
    /// inode; a substituted object is refused and left in place.
    #[cfg(any(target_vendor = "apple", target_os = "linux"))]
    fn remove_staging_directory(
        &self,
        name: &OsStr,
        expected: FileIdentity,
    ) -> std::io::Result<()> {
        use std::os::fd::AsRawFd as _;
        use std::os::unix::ffi::OsStrExt as _;

        let name_c = std::ffi::CString::new(name.as_bytes()).map_err(|_| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "staging name contains NUL",
            )
        })?;
        match self.stat_at(name)? {
            None => return Ok(()),
            Some(stat)
                if stat.st_mode & libc::S_IFMT == libc::S_IFDIR && expected.matches_stat(&stat) => {
            }
            Some(_) => {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "staging directory entry identity changed; refusing cleanup",
                ));
            }
        }
        let result =
            unsafe { libc::unlinkat(self.file.as_raw_fd(), name_c.as_ptr(), libc::AT_REMOVEDIR) };
        if result == 0 {
            let _ = self.file.sync_all();
            Ok(())
        } else {
            let error = std::io::Error::last_os_error();
            if error.kind() == std::io::ErrorKind::NotFound {
                Ok(())
            } else {
                Err(error)
            }
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

fn backup_invalid(message: &str) -> SnapbackError {
    SnapbackError::error("SNAPBACK_AUTH_BACKUP_INVALID", "auth-backup", message)
}

fn backup_commit_ambiguous(message: &str) -> SnapbackError {
    backup_error_with_publication_state(
        backup_invalid(message),
        BackupPublicationState::CommitAmbiguous,
    )
}

fn backup_error_with_publication_state(
    mut error: SnapbackError,
    state: BackupPublicationState,
) -> SnapbackError {
    let mut details = match std::mem::take(&mut error.diagnostic.details) {
        Value::Object(details) => details,
        _ => Map::new(),
    };
    details
        .entry("publicationState".to_owned())
        .or_insert_with(|| json!(state));
    error.diagnostic.details = Value::Object(details);
    error
}

#[cfg(test)]
thread_local! {
    static FAIL_BACKUP_AFTER_STEP: std::cell::Cell<Option<usize>> = const { std::cell::Cell::new(None) };
    static FAIL_RESTORE_AFTER_STEP: std::cell::Cell<Option<usize>> = const { std::cell::Cell::new(None) };
    static AFTER_RESTORE_SOURCE_HASH: std::cell::RefCell<Option<Box<dyn FnOnce()>>> = const { std::cell::RefCell::new(None) };
    static AFTER_RESTORE_STAGING_CREATED: std::cell::RefCell<Option<Box<dyn FnOnce()>>> = const { std::cell::RefCell::new(None) };
    static BEFORE_RESTORE_STAGING_RENAME: std::cell::RefCell<Option<Box<dyn FnOnce()>>> = const { std::cell::RefCell::new(None) };
    static AFTER_RESTORE_STAGING_RENAME: std::cell::RefCell<Option<Box<dyn FnOnce()>>> = const { std::cell::RefCell::new(None) };
    static FAIL_RESTORE_POST_RENAME_VALIDATION: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    static AFTER_BACKUP_KEYRING_CAPTURE: std::cell::RefCell<Option<Box<dyn FnOnce()>>> = const { std::cell::RefCell::new(None) };
    static AFTER_BACKUP_DATABASE_IMAGE_CREATED: std::cell::RefCell<Option<Box<dyn FnOnce()>>> = const { std::cell::RefCell::new(None) };
    static BEFORE_BACKUP_STAGING_RENAME: std::cell::RefCell<Option<Box<dyn FnOnce()>>> = const { std::cell::RefCell::new(None) };
    static AFTER_BACKUP_STAGING_RENAME: std::cell::RefCell<Option<Box<dyn FnOnce()>>> = const { std::cell::RefCell::new(None) };
    static FAIL_BACKUP_RENAME_RESULT: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    static FAIL_BACKUP_POST_RENAME_VALIDATION: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    static FAIL_BACKUP_PARENT_SYNC: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

fn backup_keyring_captured() {
    #[cfg(test)]
    AFTER_BACKUP_KEYRING_CAPTURE.with(|slot| {
        if let Some(operation) = slot.borrow_mut().take() {
            operation();
        }
    });
}

fn backup_database_image_created() {
    #[cfg(test)]
    AFTER_BACKUP_DATABASE_IMAGE_CREATED.with(|slot| {
        if let Some(operation) = slot.borrow_mut().take() {
            operation();
        }
    });
}

fn before_backup_staging_rename() {
    #[cfg(test)]
    BEFORE_BACKUP_STAGING_RENAME.with(|slot| {
        if let Some(operation) = slot.borrow_mut().take() {
            operation();
        }
    });
}

fn after_backup_staging_rename() {
    #[cfg(test)]
    AFTER_BACKUP_STAGING_RENAME.with(|slot| {
        if let Some(operation) = slot.borrow_mut().take() {
            operation();
        }
    });
}

fn backup_rename_result_checkpoint() -> std::io::Result<()> {
    #[cfg(test)]
    if FAIL_BACKUP_RENAME_RESULT.replace(false) {
        return Err(std::io::Error::other(
            "injected ambiguous backup rename result",
        ));
    }
    Ok(())
}

fn backup_post_rename_validation_checkpoint() -> std::io::Result<()> {
    #[cfg(test)]
    if FAIL_BACKUP_POST_RENAME_VALIDATION.replace(false) {
        return Err(std::io::Error::other(
            "injected backup post-rename validation failure",
        ));
    }
    Ok(())
}

fn backup_parent_sync_checkpoint() -> std::io::Result<()> {
    #[cfg(test)]
    if FAIL_BACKUP_PARENT_SYNC.replace(false) {
        return Err(std::io::Error::other(
            "injected backup parent fsync failure",
        ));
    }
    Ok(())
}

fn restore_source_database_hashed() {
    #[cfg(test)]
    AFTER_RESTORE_SOURCE_HASH.with(|slot| {
        if let Some(operation) = slot.borrow_mut().take() {
            operation();
        }
    });
}

fn restore_staging_created() {
    #[cfg(test)]
    AFTER_RESTORE_STAGING_CREATED.with(|slot| {
        if let Some(operation) = slot.borrow_mut().take() {
            operation();
        }
    });
}

fn before_restore_staging_rename() {
    #[cfg(test)]
    BEFORE_RESTORE_STAGING_RENAME.with(|slot| {
        if let Some(operation) = slot.borrow_mut().take() {
            operation();
        }
    });
}

fn after_restore_staging_rename() {
    #[cfg(test)]
    AFTER_RESTORE_STAGING_RENAME.with(|slot| {
        if let Some(operation) = slot.borrow_mut().take() {
            operation();
        }
    });
}

fn post_restore_rename_validation_checkpoint() -> std::io::Result<()> {
    #[cfg(test)]
    if FAIL_RESTORE_POST_RENAME_VALIDATION.replace(false) {
        return Err(std::io::Error::other(
            "injected post-rename validation failure",
        ));
    }
    Ok(())
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
    fn backup_publication_state_wire_spellings_are_stable() {
        assert_eq!(
            serde_json::to_value(BackupPublicationState::Unpublished).unwrap(),
            json!("Unpublished")
        );
        assert_eq!(
            serde_json::to_value(BackupPublicationState::Published).unwrap(),
            json!("Published")
        );
        assert_eq!(
            serde_json::to_value(BackupPublicationState::CommitAmbiguous).unwrap(),
            json!("CommitAmbiguous")
        );
    }

    #[test]
    fn frozen_v1_backup_and_restore_retain_marker_one() {
        let directory = tempfile::tempdir().unwrap();
        let source_path = directory.path().join("frozen-v1.sqlite3");
        let mut source = LocalDatabase::open(&source_path).unwrap();
        crate::storage::auth::install_frozen_v1_catalog_fixture(&mut source).unwrap();
        let keyring = AuthKeyringStore::file_for_database(&source_path);
        let random = CountingRandom::default();
        keyring.load_or_mint_initial(0, &random).unwrap();

        let backup_directory = directory.path().join("frozen-v1-backup");
        let outcome = create_backup(&source, &keyring, &backup_directory, 7, &random).unwrap();
        assert_eq!(outcome.manifest.format_version(), 1);
        assert_eq!(outcome.manifest.catalog_version(), 1);
        assert_eq!(outcome.manifest.catalog_state(), None);
        assert_eq!(outcome.manifest.catalog_tables(), None);
        assert_eq!(outcome.publication_state, BackupPublicationState::Published);

        let restored_path = directory
            .path()
            .join("frozen-v1-restored")
            .join("restored.sqlite3");
        restore_backup(&backup_directory, &restored_path, &random).unwrap();
        let restored = LocalDatabase::open(&restored_path).unwrap();
        assert_eq!(
            restored.inspect_auth_catalog().unwrap(),
            AuthCatalogState::ReadyV1
        );
        assert_eq!(
            restored
                .auth_catalog_read()
                .catalog_version_for_test()
                .unwrap(),
            AUTH_CATALOG_VERSION_V1
        );
    }

    #[test]
    fn frozen_v3_backup_remains_valid_format_two_without_v4_metadata() {
        let directory = tempfile::tempdir().unwrap();
        let source_path = directory.path().join("frozen-v3.sqlite3");
        let mut source = LocalDatabase::open(&source_path).unwrap();
        crate::storage::auth::install_frozen_v3_catalog_fixture(&mut source).unwrap();
        let keyring = AuthKeyringStore::file_for_database(&source_path);
        let random = CountingRandom::default();
        keyring.load_or_mint_initial(0, &random).unwrap();

        let backup_directory = directory.path().join("frozen-v3-backup");
        let outcome = create_backup(&source, &keyring, &backup_directory, 7, &random).unwrap();
        assert_eq!(outcome.manifest.format_version(), 2);
        assert_eq!(outcome.manifest.catalog_version(), 3);
        assert_eq!(
            outcome.manifest.catalog_state(),
            Some(AuthBackupCatalogState::ReadyV3)
        );
        assert_eq!(outcome.manifest.password_identifier_mode(), None);

        let restored_path = directory
            .path()
            .join("frozen-v3-restored")
            .join("restored.sqlite3");
        restore_backup(&backup_directory, &restored_path, &random).unwrap();
        let restored = LocalDatabase::open(&restored_path).unwrap();
        assert_eq!(
            restored.inspect_auth_catalog().unwrap(),
            AuthCatalogState::ReadyV3
        );
    }

    #[test]
    fn v4_email_identifier_mode_round_trips_in_format_two() {
        let directory = tempfile::tempdir().unwrap();
        let source_path = directory.path().join("email-v4.sqlite3");
        let mut source = LocalDatabase::open(&source_path).unwrap();
        let random = CountingRandom::default();
        let keyring = AuthKeyringStore::file_for_database(&source_path);
        keyring.load_or_mint_initial(0, &random).unwrap();
        source
            .activate_current_auth_catalog_with_password_identifier_mode(
                PasswordIdentifierMode::EmailV1,
            )
            .unwrap();
        source
            .insert_password_attempt_for_test("email-mode@example.com", 1, 2, None)
            .unwrap();

        let backup_directory = directory.path().join("email-v4-backup");
        let outcome = create_backup(&source, &keyring, &backup_directory, 7, &random).unwrap();
        assert_eq!(outcome.manifest.format_version(), 2);
        assert_eq!(outcome.manifest.catalog_version(), 4);
        assert_eq!(
            outcome.manifest.password_identifier_mode(),
            Some("email-v1")
        );

        let restored_path = directory
            .path()
            .join("email-v4-restored")
            .join("restored.sqlite3");
        restore_backup(&backup_directory, &restored_path, &random).unwrap();
        let restored = LocalDatabase::open(&restored_path).unwrap();
        assert_eq!(
            restored.auth_password_identifier_mode().unwrap(),
            PasswordIdentifierMode::EmailV1
        );
        assert_eq!(
            restored
                .password_attempt_for_test("email-mode@example.com")
                .unwrap(),
            Some((1, 2, None))
        );
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
            assert_eq!(
                error.diagnostic.details["publicationState"],
                json!(BackupPublicationState::Unpublished)
            );
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
    fn restore_parent_replacement_cleans_staging_through_the_pinned_descriptor() {
        let fixture = Fixture::new();
        let backup = fixture.parent().join("backup-for-parent-swap");
        create_backup(
            &fixture.database,
            &fixture.keyring,
            &backup,
            123,
            &fixture.random,
        )
        .unwrap();
        let parent = fixture.parent().join("restore-parent");
        let moved = fixture.parent().join("restore-parent-moved");
        create_owner_only_directory(&parent).unwrap();
        let target = parent.join("instance").join("app.sqlite3");
        let parent_for_hook = parent.clone();
        let moved_for_hook = moved.clone();
        AFTER_RESTORE_STAGING_CREATED.with(|slot| {
            *slot.borrow_mut() = Some(Box::new(move || {
                std::fs::rename(&parent_for_hook, &moved_for_hook).unwrap();
                create_owner_only_directory(&parent_for_hook).unwrap();
            }));
        });

        let error = restore_backup(&backup, &target, &fixture.random).unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_BACKUP_INVALID");
        assert!(!target.parent().unwrap().exists());
        assert!(!moved.join("instance").exists());
        assert_no_temporary(&parent, ".snapback-auth-restore-");
        assert_no_temporary(&moved, ".snapback-auth-restore-");
    }

    #[cfg(any(target_vendor = "apple", target_os = "linux"))]
    #[test]
    fn restore_refuses_a_pre_rename_staging_swap_without_unlinking_replacements() {
        let fixture = Fixture::new();
        let backup = fixture.parent().join("backup-for-staging-swap");
        create_backup(
            &fixture.database,
            &fixture.keyring,
            &backup,
            123,
            &fixture.random,
        )
        .unwrap();
        let target = fixture
            .parent()
            .join("restore-pre-swap")
            .join("app.sqlite3");
        let parent = fixture.parent().to_path_buf();
        let held = parent.join("held-original-staging");
        let held_for_hook = held.clone();
        BEFORE_RESTORE_STAGING_RENAME.with(|slot| {
            *slot.borrow_mut() = Some(Box::new(move || {
                let staging = only_temporary(&parent, ".snapback-auth-restore-");
                std::fs::rename(&staging, &held_for_hook).unwrap();
                create_owner_only_directory(&staging).unwrap();
                std::fs::write(staging.join("foreign-directory-sentinel"), b"survive").unwrap();
            }));
        });

        let error = restore_backup(&backup, &target, &fixture.random).unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_BACKUP_INVALID");
        assert!(!target.parent().unwrap().exists());
        assert!(held.is_dir());
        assert_eq!(std::fs::read_dir(&held).unwrap().count(), 0);
        let replacement = only_temporary(fixture.parent(), ".snapback-auth-restore-");
        assert_eq!(
            std::fs::read(replacement.join("foreign-directory-sentinel")).unwrap(),
            b"survive"
        );
    }

    #[cfg(any(target_vendor = "apple", target_os = "linux"))]
    #[test]
    fn restore_refuses_a_post_rename_target_swap_without_unlinking_replacement() {
        let fixture = Fixture::new();
        let backup = fixture.parent().join("backup-for-target-swap");
        create_backup(
            &fixture.database,
            &fixture.keyring,
            &backup,
            123,
            &fixture.random,
        )
        .unwrap();
        let target = fixture
            .parent()
            .join("restore-post-swap")
            .join("app.sqlite3");
        let target_instance = target.parent().unwrap().to_path_buf();
        let moved_original = fixture.parent().join("moved-published-original");
        AFTER_RESTORE_STAGING_RENAME.with(|slot| {
            *slot.borrow_mut() = Some(Box::new(move || {
                std::fs::rename(&target_instance, &moved_original).unwrap();
                create_owner_only_directory(&target_instance).unwrap();
                std::fs::write(target_instance.join("foreign-target-sentinel"), b"survive")
                    .unwrap();
            }));
        });

        let error = restore_backup(&backup, &target, &fixture.random).unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_BACKUP_INVALID");
        assert_eq!(
            std::fs::read(target.parent().unwrap().join("foreign-target-sentinel")).unwrap(),
            b"survive"
        );
        let moved = fixture.parent().join("moved-published-original");
        require_exact_members(
            &moved,
            &[
                "app.sqlite3",
                "app.sqlite3.auth-keyring.json",
                RESTORE_DECLARATION_FILE,
            ],
        )
        .unwrap();
    }

    #[cfg(any(target_vendor = "apple", target_os = "linux"))]
    #[test]
    fn post_rename_validation_failure_preserves_the_complete_published_unit() {
        let fixture = Fixture::new();
        let backup = fixture.parent().join("backup-for-post-rename-failure");
        let outcome = create_backup(
            &fixture.database,
            &fixture.keyring,
            &backup,
            123,
            &fixture.random,
        )
        .unwrap();
        let manifest = outcome.manifest;
        let target = fixture
            .parent()
            .join("restore-post-rename-failure")
            .join("app.sqlite3");
        FAIL_RESTORE_POST_RENAME_VALIDATION.with(|slot| slot.set(true));

        let error = restore_backup(&backup, &target, &fixture.random).unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_BACKUP_INVALID");
        let target_instance = target.parent().unwrap();
        require_exact_members(
            target_instance,
            &[
                "app.sqlite3",
                "app.sqlite3.auth-keyring.json",
                RESTORE_DECLARATION_FILE,
            ],
        )
        .unwrap();
        assert_eq!(sha256_path(&target).unwrap(), manifest.database_sha256());
        assert_eq!(
            sha256_path(&AuthKeyringStore::keyring_path(&target)).unwrap(),
            manifest.keyring_sha256()
        );
        let declaration = crate::secure_file::read_strict_owner_only(
            &target_instance.join(RESTORE_DECLARATION_FILE),
            4096,
        )
        .unwrap();
        RestoreDeclaration::parse(&declaration).unwrap();
    }

    #[cfg(any(target_vendor = "apple", target_os = "linux"))]
    #[test]
    fn restore_refuses_a_pre_rename_child_swap_without_unlinking_foreign_inode() {
        let fixture = Fixture::new();
        let backup = fixture.parent().join("backup-for-pre-child-swap");
        create_backup(
            &fixture.database,
            &fixture.keyring,
            &backup,
            123,
            &fixture.random,
        )
        .unwrap();
        let target = fixture
            .parent()
            .join("restore-pre-child-swap")
            .join("app.sqlite3");
        let parent = fixture.parent().to_path_buf();
        let held_original = parent.join("held-pre-child-keyring");
        let held_for_hook = held_original.clone();
        BEFORE_RESTORE_STAGING_RENAME.with(|slot| {
            *slot.borrow_mut() = Some(Box::new(move || {
                let staging = only_temporary(&parent, ".snapback-auth-restore-");
                let child = AuthKeyringStore::keyring_path(&staging.join("app.sqlite3"));
                std::fs::rename(&child, &held_for_hook).unwrap();
                crate::secure_file::write_new_owner_only(&child, b"foreign-child-must-survive")
                    .unwrap();
            }));
        });

        let error = restore_backup(&backup, &target, &fixture.random).unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_BACKUP_INVALID");
        assert!(!target.parent().unwrap().exists());
        let staging = only_temporary(fixture.parent(), ".snapback-auth-restore-");
        let foreign = AuthKeyringStore::keyring_path(&staging.join("app.sqlite3"));
        assert_eq!(
            std::fs::read(foreign).unwrap(),
            b"foreign-child-must-survive"
        );
        assert!(held_original.is_file());
    }

    #[cfg(any(target_vendor = "apple", target_os = "linux"))]
    #[test]
    fn restore_refuses_a_post_rename_child_swap_without_unlinking_foreign_inode() {
        let fixture = Fixture::new();
        let backup = fixture.parent().join("backup-for-post-child-swap");
        create_backup(
            &fixture.database,
            &fixture.keyring,
            &backup,
            123,
            &fixture.random,
        )
        .unwrap();
        let target = fixture
            .parent()
            .join("restore-post-child-swap")
            .join("app.sqlite3");
        let keyring = AuthKeyringStore::keyring_path(&target);
        let held_original = fixture.parent().join("held-post-child-keyring");
        let keyring_for_hook = keyring.clone();
        let held_for_hook = held_original.clone();
        AFTER_RESTORE_STAGING_RENAME.with(|slot| {
            *slot.borrow_mut() = Some(Box::new(move || {
                std::fs::rename(&keyring_for_hook, &held_for_hook).unwrap();
                crate::secure_file::write_new_owner_only(
                    &keyring_for_hook,
                    b"foreign-child-must-survive",
                )
                .unwrap();
            }));
        });

        let error = restore_backup(&backup, &target, &fixture.random).unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_BACKUP_INVALID");
        assert_eq!(
            std::fs::read(&keyring).unwrap(),
            b"foreign-child-must-survive"
        );
        assert!(held_original.is_file());
        require_exact_members(
            target.parent().unwrap(),
            &[
                "app.sqlite3",
                "app.sqlite3.auth-keyring.json",
                RESTORE_DECLARATION_FILE,
            ],
        )
        .unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn restore_refuses_a_late_extended_acl_on_a_staged_child() {
        let fixture = Fixture::new();
        let backup = fixture.parent().join("backup-for-child-acl");
        create_backup(
            &fixture.database,
            &fixture.keyring,
            &backup,
            123,
            &fixture.random,
        )
        .unwrap();
        let target = fixture
            .parent()
            .join("restore-child-acl")
            .join("app.sqlite3");
        let parent = fixture.parent().to_path_buf();
        BEFORE_RESTORE_STAGING_RENAME.with(|slot| {
            *slot.borrow_mut() = Some(Box::new(move || {
                let staging = only_temporary(&parent, ".snapback-auth-restore-");
                let keyring = AuthKeyringStore::keyring_path(&staging.join("app.sqlite3"));
                let status = std::process::Command::new("chmod")
                    .arg("+a")
                    .arg("everyone allow read")
                    .arg(keyring)
                    .status()
                    .unwrap();
                assert!(status.success());
            }));
        });

        let error = restore_backup(&backup, &target, &fixture.random).unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_BACKUP_INVALID");
        assert!(!target.parent().unwrap().exists());
    }

    /// ENG-24981: swap the staging directory between secure database-image
    /// creation and the SQLite open. The replacement names an attacker
    /// symlink at the database path; the backup must fail before any source
    /// page is copied and no catalog byte may reach the symlink target.
    #[cfg(any(target_vendor = "apple", target_os = "linux"))]
    #[test]
    fn backup_refuses_a_staging_swap_between_secure_creation_and_sqlite_open() {
        let fixture = Fixture::new();
        let output = fixture.parent().join("backup-creation-swap");
        let parent = fixture.parent().to_path_buf();
        let held = parent.join("held-original-backup-staging");
        // An empty writable file is the exact repro shape: a pathname-opened
        // SQLite destination would treat it as a fresh database and copy the
        // complete auth catalog into it.
        let attacker_target = parent.join("attacker-readable-target");
        std::fs::write(&attacker_target, b"").unwrap();
        let held_for_hook = held.clone();
        let target_for_hook = attacker_target.clone();
        AFTER_BACKUP_DATABASE_IMAGE_CREATED.with(|slot| {
            *slot.borrow_mut() = Some(Box::new(move || {
                let staging = only_temporary(&parent, ".snapback-auth-backup-");
                std::fs::rename(&staging, &held_for_hook).unwrap();
                std::fs::create_dir(&staging).unwrap();
                std::os::unix::fs::symlink(&target_for_hook, staging.join(BACKUP_DATABASE_FILE))
                    .unwrap();
                std::fs::write(staging.join("foreign-backup-sentinel"), b"survive").unwrap();
            }));
        });

        let error = create_backup(
            &fixture.database,
            &fixture.keyring,
            &output,
            123,
            &fixture.random,
        )
        .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_BACKUP_INVALID");
        assert!(!output.exists(), "no replacement directory is published");
        assert_eq!(
            std::fs::metadata(&attacker_target).unwrap().len(),
            0,
            "no database bytes may reach the symlinked replacement target"
        );
        let replacement = only_temporary(fixture.parent(), ".snapback-auth-backup-");
        assert_eq!(
            std::fs::read(replacement.join("foreign-backup-sentinel")).unwrap(),
            b"survive",
            "cleanup must not unlink the foreign replacement"
        );
        let planted = std::fs::symlink_metadata(replacement.join(BACKUP_DATABASE_FILE)).unwrap();
        assert!(planted.file_type().is_symlink());
        assert!(held.is_dir());
        assert_eq!(
            std::fs::read_dir(&held).unwrap().count(),
            0,
            "the pinned original staging is emptied through its descriptor"
        );
    }

    /// ENG-24981: swap the staging directory between final validation and the
    /// publication rename. The pre-rename identity check must refuse, publish
    /// nothing, and leave the replacement untouched.
    #[cfg(any(target_vendor = "apple", target_os = "linux"))]
    #[test]
    fn backup_refuses_a_pre_rename_staging_swap_without_unlinking_replacement() {
        let fixture = Fixture::new();
        let output = fixture.parent().join("backup-pre-rename-swap");
        let parent = fixture.parent().to_path_buf();
        let held = parent.join("held-pre-rename-backup-staging");
        let held_for_hook = held.clone();
        BEFORE_BACKUP_STAGING_RENAME.with(|slot| {
            *slot.borrow_mut() = Some(Box::new(move || {
                let staging = only_temporary(&parent, ".snapback-auth-backup-");
                std::fs::rename(&staging, &held_for_hook).unwrap();
                create_owner_only_directory(&staging).unwrap();
                std::fs::write(staging.join("foreign-directory-sentinel"), b"survive").unwrap();
            }));
        });

        let error = create_backup(
            &fixture.database,
            &fixture.keyring,
            &output,
            123,
            &fixture.random,
        )
        .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_BACKUP_INVALID");
        assert_eq!(
            error.diagnostic.details["publicationState"],
            json!(BackupPublicationState::Unpublished)
        );
        assert!(!output.exists(), "no replacement directory is published");
        let replacement = only_temporary(fixture.parent(), ".snapback-auth-backup-");
        assert_eq!(
            std::fs::read(replacement.join("foreign-directory-sentinel")).unwrap(),
            b"survive",
            "cleanup must not unlink the foreign replacement"
        );
        assert!(held.is_dir());
        assert_eq!(
            std::fs::read_dir(&held).unwrap().count(),
            0,
            "secret-bearing staged files are removed only through the pinned descriptor"
        );
    }

    #[cfg(any(target_vendor = "apple", target_os = "linux"))]
    #[test]
    fn backup_reports_commit_ambiguous_when_rename_takes_effect_but_reports_failure() {
        let fixture = Fixture::new();
        let output = fixture.parent().join("backup-ambiguous-rename");
        FAIL_BACKUP_RENAME_RESULT.with(|slot| slot.set(true));

        let error = create_backup(
            &fixture.database,
            &fixture.keyring,
            &output,
            123,
            &fixture.random,
        )
        .unwrap_err();

        assert_eq!(
            error.diagnostic.details["publicationState"],
            json!(BackupPublicationState::CommitAmbiguous)
        );
        require_exact_members(
            &output,
            &[
                BACKUP_DATABASE_FILE,
                BACKUP_KEYRING_FILE,
                BACKUP_MANIFEST_FILE,
            ],
        )
        .unwrap();
    }

    #[cfg(any(target_vendor = "apple", target_os = "linux"))]
    #[test]
    fn backup_reports_commit_ambiguous_on_post_rename_validation_failure() {
        let fixture = Fixture::new();
        let output = fixture.parent().join("backup-post-check-failure");
        FAIL_BACKUP_POST_RENAME_VALIDATION.with(|slot| slot.set(true));

        let error = create_backup(
            &fixture.database,
            &fixture.keyring,
            &output,
            123,
            &fixture.random,
        )
        .unwrap_err();

        assert_eq!(
            error.diagnostic.details["publicationState"],
            json!(BackupPublicationState::CommitAmbiguous)
        );
        assert!(output.join(BACKUP_MANIFEST_FILE).is_file());
    }

    #[cfg(any(target_vendor = "apple", target_os = "linux"))]
    #[test]
    fn backup_reports_commit_ambiguous_on_parent_fsync_failure() {
        let fixture = Fixture::new();
        let output = fixture.parent().join("backup-parent-fsync-failure");
        FAIL_BACKUP_PARENT_SYNC.with(|slot| slot.set(true));

        let error = create_backup(
            &fixture.database,
            &fixture.keyring,
            &output,
            123,
            &fixture.random,
        )
        .unwrap_err();

        assert_eq!(
            error.diagnostic.details["publicationState"],
            json!(BackupPublicationState::CommitAmbiguous)
        );
        assert!(output.join(BACKUP_MANIFEST_FILE).is_file());
    }

    /// ENG-24981: swap the published output immediately after the rename. The
    /// post-rename identity check must fail the operation without unlinking
    /// the replacement, while the complete real unit survives where it moved.
    #[cfg(any(target_vendor = "apple", target_os = "linux"))]
    #[test]
    fn backup_refuses_a_post_rename_output_swap_without_unlinking_replacement() {
        let fixture = Fixture::new();
        let output = fixture.parent().join("backup-post-rename-swap");
        let moved_original = fixture.parent().join("moved-published-backup");
        let output_for_hook = output.clone();
        let moved_for_hook = moved_original.clone();
        AFTER_BACKUP_STAGING_RENAME.with(|slot| {
            *slot.borrow_mut() = Some(Box::new(move || {
                std::fs::rename(&output_for_hook, &moved_for_hook).unwrap();
                create_owner_only_directory(&output_for_hook).unwrap();
                std::fs::write(output_for_hook.join("foreign-output-sentinel"), b"survive")
                    .unwrap();
            }));
        });

        let error = create_backup(
            &fixture.database,
            &fixture.keyring,
            &output,
            123,
            &fixture.random,
        )
        .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_BACKUP_INVALID");
        assert_eq!(
            error.diagnostic.details["publicationState"],
            json!(BackupPublicationState::CommitAmbiguous)
        );
        assert_eq!(
            std::fs::read(output.join("foreign-output-sentinel")).unwrap(),
            b"survive",
            "the replacement output must not be unlinked"
        );
        require_exact_members(
            &moved_original,
            &[
                BACKUP_DATABASE_FILE,
                BACKUP_KEYRING_FILE,
                BACKUP_MANIFEST_FILE,
            ],
        )
        .unwrap();
    }

    #[test]
    fn raw_live_directory_copy_is_not_a_restore_unit() {
        let fixture = Fixture::new();
        let raw = fixture.parent().join("raw-live-copy");
        create_owner_only_directory(&raw).unwrap();
        crate::secure_file::write_new_owner_only(
            &raw.join(BACKUP_DATABASE_FILE),
            &std::fs::read(&fixture.database_path).unwrap(),
        )
        .unwrap();
        crate::secure_file::write_new_owner_only(
            &raw.join(format!("{BACKUP_DATABASE_FILE}-wal")),
            b"raw-wal-like-bytes",
        )
        .unwrap();
        crate::secure_file::write_new_owner_only(
            &raw.join(BACKUP_KEYRING_FILE),
            b"raw-keyring-like-bytes",
        )
        .unwrap();

        let target = fixture.parent().join("raw-restored").join("app.sqlite3");
        let error = restore_backup(&raw, &target, &fixture.random).unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_BACKUP_INVALID");
        assert!(!target.parent().unwrap().exists());
        assert_no_temporary(fixture.parent(), ".snapback-auth-restore-");
    }

    #[test]
    fn restore_target_cannot_place_its_reservation_inside_the_backup_unit() {
        let fixture = Fixture::new();
        let backup = fixture.parent().join("backup-overlap");
        create_backup(
            &fixture.database,
            &fixture.keyring,
            &backup,
            123,
            &fixture.random,
        )
        .unwrap();
        let target = backup.join("restored").join("app.sqlite3");
        let before = std::fs::read_dir(&backup)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect::<BTreeSet<_>>();

        let error = restore_backup(&backup, &target, &fixture.random).unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_BACKUP_INVALID");
        let after = std::fs::read_dir(&backup)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect::<BTreeSet<_>>();
        assert_eq!(after, before, "refusal must not add a lock to the source");
        assert!(!target.parent().unwrap().exists());
    }

    #[test]
    fn restore_rejects_hash_drift_unknown_fields_extra_files_and_existing_target() {
        let fixture = Fixture::new();
        let backup_directory = fixture.parent().join("backup");
        let outcome = create_backup(
            &fixture.database,
            &fixture.keyring,
            &backup_directory,
            123,
            &fixture.random,
        )
        .unwrap();
        let manifest = outcome.manifest;
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
        let mut value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&manifest_path).unwrap()).unwrap();
        value["catalogTables"].as_array_mut().unwrap().pop();
        std::fs::write(&manifest_path, serde_json::to_vec(&value).unwrap()).unwrap();
        let error = restore_backup(&backup_directory, &target, &fixture.random).unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_BACKUP_INVALID");
        assert!(!target.parent().unwrap().exists());

        std::fs::write(&manifest_path, manifest.to_bytes().unwrap()).unwrap();
        let mut value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&manifest_path).unwrap()).unwrap();
        value["passwordIdentifierMode"] = serde_json::json!("email-v1");
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
    fn v3_recovery_key_references_are_part_of_the_backup_unit() {
        use crate::auth::identity_core::PasswordSecret;

        let mut fixture = Fixture::new();
        let missing_key_id = "sbak_AAAAAAAAAAAAAAAAAAAAAA";
        fixture
            .database
            .identity_password_register(
                "missing-recovery-key",
                &PasswordSecret::new("strong-missing-recovery-key-1".to_owned()),
                20,
                &fixture.random,
                missing_key_id,
                &[7_u8; 32],
            )
            .unwrap();

        assert!(
            fixture
                .database
                .auth_key_is_referenced(missing_key_id)
                .unwrap()
        );
        let output = fixture.parent().join("missing-recovery-key");
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
            .auth_catalog()
            .set_verification_key_id_for_test("sbak_AAAAAAAAAAAAAAAAAAAAAA")
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
            .auth_catalog()
            .set_verification_key_id_for_test(&replacement_key_id)
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

    fn only_temporary(parent: &Path, prefix: &str) -> PathBuf {
        let matches = std::fs::read_dir(parent)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().starts_with(prefix))
            .map(|entry| entry.path())
            .collect::<Vec<_>>();
        assert_eq!(
            matches.len(),
            1,
            "expected exactly one restore staging entry"
        );
        matches.into_iter().next().unwrap()
    }
}
