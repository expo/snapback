//! File-backed store durable-state inventory and WAL-consistent export.

use crate::auth::crypto::{RandomSource, encode_base64url};
use crate::auth::keyring::AuthKeyringStore;
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::instance_lock::FileIdentity;
use crate::local::LocalSnapback;
#[cfg(all(test, not(feature = "cli-owner")))]
use crate::remainder_adapter::RemainderLocalSnapbackExt as _;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use sha2::{Digest as _, Sha256};
use snapback_services::assets::AssetFsStoreLocalExt as _;
use std::ffi::OsStr;
use std::fs::{self, File, OpenOptions};
use std::io::{Read as _, Seek as _, SeekFrom, Write as _};
use std::path::{Path, PathBuf};

const STORE_EXPORT_FORMAT_VERSION: u32 = 1;
const STORE_EXPORT_MANIFEST_FILE: &str = "store-export.json";
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const TEMP_CANDIDATE_ATTEMPTS: usize = 3;

/// Database-bound registry members intentionally outside startup's path set.
/// The divergence test requires every such difference to carry its reason here.
#[cfg(all(test, not(feature = "cli-owner")))]
const STARTUP_MANAGED_PATH_ALLOWLIST: &[(&str, &str)] = &[
    (
        "operationDetailKeyring",
        "operation-detail installation owns this keyring rather than startup cleanup",
    ),
    (
        "consoleCredentials",
        "console credentials are minted and retired by the on-demand console flow",
    ),
    (
        "managedBranchWorkspaces",
        "the branch lifecycle owns this refusal-only workspace root",
    ),
];

/// These members are shared by the database directory rather than named from
/// the database path. New members default to database-bound in the divergence
/// test until they are deliberately classified here.
#[cfg(all(test, not(feature = "cli-owner")))]
const DIRECTORY_SHARED_MEMBER_IDS: &[&str] = &[
    "completenessProofKeyring",
    "assetBlobs",
    "resumeKeyring",
    "assetStaging",
    "forkMintReceipt",
];

/// Registry classification that decides whether and how store export handles
/// a runtime-owned path.
// @ref LLP 0192#d-1-the-durable-state-registry — disposition is copy policy,
// not descriptive folklore attached after the copy has already happened.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum MemberDisposition {
    Database,
    Folded,
    Required,
    Optional,
    InstanceLocal,
    Refuse,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum MemberKind {
    File,
    Directory,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DurableMember {
    pub id: &'static str,
    pub path: PathBuf,
    pub disposition: MemberDisposition,
    pub kind: MemberKind,
    pub description: &'static str,
}

pub fn path_with_filename_suffix(path: &Path, suffix: &str) -> SnapbackResult<PathBuf> {
    let mut name = path
        .file_name()
        .ok_or_else(|| store_invalid("database-bound path must include a file name"))?
        .to_os_string();
    name.push(suffix);
    Ok(path.with_file_name(name))
}

pub fn durable_state_members(database_path: &Path) -> SnapbackResult<Vec<DurableMember>> {
    let directory = database_path
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let telemetry = crate::telemetry::Telemetry::path_for_database(database_path);
    let mut members = vec![
        member(
            "database",
            database_path.to_path_buf(),
            MemberDisposition::Database,
            MemberKind::File,
            "SQLite main database captured through the online backup API",
        ),
        member(
            "sqliteWal",
            path_with_filename_suffix(database_path, "-wal")?,
            MemberDisposition::Folded,
            MemberKind::File,
            "SQLite write-ahead log folded into the exported database image",
        ),
        member(
            "sqliteShm",
            path_with_filename_suffix(database_path, "-shm")?,
            MemberDisposition::Folded,
            MemberKind::File,
            "SQLite shared-memory sidecar excluded from store copies",
        ),
        member(
            "sqliteJournal",
            path_with_filename_suffix(database_path, "-journal")?,
            MemberDisposition::Folded,
            MemberKind::File,
            "SQLite rollback journal folded into the exported database image",
        ),
        member(
            "authKeyring",
            AuthKeyringStore::keyring_path(database_path),
            MemberDisposition::Required,
            MemberKind::File,
            "Authentication signing keyring required by an activated auth catalog",
        ),
        member(
            "configStore",
            crate::config::ConfigStore::path_for_database(database_path),
            MemberDisposition::Required,
            MemberKind::File,
            "Application configuration and secret store",
        ),
        member(
            "operationDetailKeyring",
            crate::operation_detail::keyring_path(database_path),
            MemberDisposition::Required,
            MemberKind::File,
            "Keyring for protected operation-detail rows",
        ),
        member(
            "completenessProofKeyring",
            directory.join(crate::completeness::PROOF_KEYRING_FILE_NAME),
            MemberDisposition::Required,
            MemberKind::File,
            "Keyring for completeness-proof issuance and validation",
        ),
        member(
            "assetBlobs",
            crate::assets::AssetFsStore::blobs_directory(directory),
            MemberDisposition::Required,
            MemberKind::Directory,
            "Finalized asset blob tree referenced by durable database rows",
        ),
        member(
            "adminToken",
            crate::admin::admin_token_sibling(database_path),
            MemberDisposition::Optional,
            MemberKind::File,
            "Local administrative bearer authority",
        ),
        member(
            "consoleCredentials",
            crate::admin::console_credential_sibling(database_path),
            MemberDisposition::Optional,
            MemberKind::File,
            "Local admin-console credential continuity",
        ),
        member(
            "resumeKeyring",
            directory.join(crate::rqs_contract::RESUME_KEYRING_FILE_NAME),
            MemberDisposition::Optional,
            MemberKind::File,
            "Live-query resume-token keyring",
        ),
        member(
            "instanceLock",
            crate::instance_lock::lock_path_for_database(database_path)
                .map_err(|_| store_invalid("database lock path could not be derived"))?,
            MemberDisposition::InstanceLocal,
            MemberKind::File,
            "Running-instance ownership lock",
        ),
    ];
    #[cfg(any(target_vendor = "apple", target_os = "linux"))]
    members.push(member(
        "targetInstanceReservation",
        crate::instance_lock::target_reservation_path_for_database(database_path)
            .map_err(|_| store_invalid("target-instance reservation path could not be derived"))?,
        MemberDisposition::InstanceLocal,
        MemberKind::File,
        "Offline target-instance reservation",
    ));
    members.extend([
        member(
            "telemetry",
            telemetry.clone(),
            MemberDisposition::InstanceLocal,
            MemberKind::File,
            "Instance-local telemetry history",
        ),
        member(
            "telemetryWal",
            path_with_filename_suffix(&telemetry, "-wal")?,
            MemberDisposition::InstanceLocal,
            MemberKind::File,
            "Instance-local telemetry SQLite write-ahead log",
        ),
        member(
            "telemetryShm",
            path_with_filename_suffix(&telemetry, "-shm")?,
            MemberDisposition::InstanceLocal,
            MemberKind::File,
            "Instance-local telemetry SQLite shared memory",
        ),
        member(
            "telemetryJournal",
            path_with_filename_suffix(&telemetry, "-journal")?,
            MemberDisposition::InstanceLocal,
            MemberKind::File,
            "Instance-local telemetry SQLite rollback journal",
        ),
        member(
            "assetStaging",
            crate::assets::AssetFsStore::staging_directory(directory),
            MemberDisposition::InstanceLocal,
            MemberKind::Directory,
            "Incomplete instance-local asset staging tree",
        ),
        member(
            "managedBranchWorkspaces",
            crate::fork_promotion::managed_branch_root(database_path)?,
            MemberDisposition::Refuse,
            MemberKind::Directory,
            "Managed in-app branch workspaces with immutable base custody",
        ),
        member(
            "forkMintReceipt",
            directory.join(crate::instance_fork::MINT_RECEIPT_FILE),
            MemberDisposition::Refuse,
            MemberKind::File,
            "Derived-fork lineage receipt",
        ),
    ]);
    Ok(members)
}

fn member(
    id: &'static str,
    path: PathBuf,
    disposition: MemberDisposition,
    kind: MemberKind,
    description: &'static str,
) -> DurableMember {
    DurableMember {
        id,
        path,
        disposition,
        kind,
        description,
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum StoreExportPublication {
    Unpublished,
    Published,
    CommitAmbiguous,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StoreExportOutcome {
    pub manifest: StoreExportManifest,
    pub publication_state: StoreExportPublication,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StoreExportManifest {
    pub format_version: u32,
    pub created_at_ms: u64,
    pub source_database_basename: String,
    pub members: Vec<StoreExportMember>,
    pub excluded: Vec<StoreExportExcludedMember>,
    pub declared_properties: StoreExportDeclaredProperties,
    pub boot: StoreExportBoot,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StoreExportMember {
    pub id: String,
    pub file: String,
    pub disposition: MemberDisposition,
    pub sha256: String,
    pub bytes: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StoreExportExcludedMember {
    pub id: String,
    pub disposition: MemberDisposition,
    pub reason: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StoreExportDeclaredProperties {
    pub wal_folded: bool,
    pub push_token_registry_scrubbed: bool,
    pub carries_admin_authority: bool,
    pub carries_live_sessions: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StoreExportBoot {
    pub command: String,
}

pub(crate) fn export_store(
    snapback: &mut LocalSnapback,
    keyring: &AuthKeyringStore,
    database_path: &Path,
    output_directory: &Path,
    created_at_ms: u64,
    random: &dyn RandomSource,
) -> SnapbackResult<StoreExportOutcome> {
    export_store_inner(
        snapback,
        keyring,
        database_path,
        output_directory,
        created_at_ms,
        random,
    )
    .map_err(|error| store_error_with_publication_state(error, StoreExportPublication::Unpublished))
}

fn export_store_inner(
    snapback: &mut LocalSnapback,
    keyring: &AuthKeyringStore,
    database_path: &Path,
    output_directory: &Path,
    created_at_ms: u64,
    random: &dyn RandomSource,
) -> SnapbackResult<StoreExportOutcome> {
    validate_export_inputs(snapback, database_path, output_directory, created_at_ms)?;
    let source_database_basename = database_path
        .file_name()
        .and_then(OsStr::to_str)
        .filter(|name| !name.is_empty() && *name != "." && *name != "..")
        .ok_or_else(|| store_invalid("source database basename is not portable"))?
        .to_owned();
    let registry = durable_state_members(database_path)?;
    refuse_lineage_members(&registry)?;

    let mut staging = ExportStaging::create(output_directory, random)?;
    let mut carried = Vec::new();
    let mut excluded = Vec::new();
    let mut carries_admin_authority = false;
    let mut carries_live_sessions = false;

    for member in &registry {
        match member.disposition {
            MemberDisposition::Database => {
                let mut image = staging.create_file(Path::new(&source_database_basename))?;
                // @ref LLP 0192#d-2-the-store-export-verb — the online backup
                // folds committed WAL pages into a descriptor-bound standalone
                // image; no checkpoint and no WAL copy participate.
                // The underlying capture reports a specific reason; swallowing
                // it here would reproduce the exact "diagnostic names nothing"
                // defect this decision exists to fix.
                snapback
                    .backup_database_image_into(&image)
                    .map_err(|error| {
                        store_invalid(&format!(
                            "SQLite online store export did not complete: {} ({})",
                            error.diagnostic.message, error.diagnostic.code
                        ))
                    })?;
                let (sha256, bytes) = sha256_file(&mut image)?;
                carried.push(StoreExportMember {
                    id: member.id.to_owned(),
                    file: source_database_basename.clone(),
                    disposition: member.disposition,
                    sha256,
                    bytes,
                });
            }
            MemberDisposition::Required | MemberDisposition::Optional
                if member.kind == MemberKind::File =>
            {
                if !path_present(&member.path) {
                    excluded.push(excluded_member(member, "source member is absent"));
                    continue;
                }
                let relative = exported_file_name(member)?;
                let (sha256, bytes) = if member.id == "authKeyring" {
                    let bytes = keyring.validated_file_bytes().map_err(|_| {
                        store_invalid("source auth keyring is unavailable or invalid")
                    })?;
                    let mut destination = staging.create_file(&relative)?;
                    destination
                        .write_all(bytes.expose_secret())
                        .map_err(|_| store_invalid("store member could not be written"))?;
                    destination
                        .sync_all()
                        .map_err(|_| store_invalid("store member could not be synced"))?;
                    sha256_file(&mut destination)?
                } else {
                    staging.copy_regular_file(&member.path, &relative, member.id)?
                };
                if member.id == "adminToken" {
                    carries_admin_authority = true;
                }
                if member.id == "authKeyring" {
                    carries_live_sessions = true;
                }
                // @ref LLP 0192#d-2-the-store-export-verb — carried siblings
                // keep their database-derived names so the published directory
                // boots directly without a restore/rename phase.
                carried.push(StoreExportMember {
                    id: member.id.to_owned(),
                    file: manifest_path(&relative)?,
                    disposition: member.disposition,
                    sha256,
                    bytes,
                });
            }
            MemberDisposition::Required
                if member.id == "assetBlobs" && member.kind == MemberKind::Directory =>
            {
                if !path_present(&member.path) {
                    excluded.push(excluded_member(member, "source member is absent"));
                    continue;
                }
                if directory_is_empty(&member.path, member.id)? {
                    excluded.push(excluded_member(member, "source directory is empty"));
                    continue;
                }
                let relative = crate::assets::AssetFsStore::blobs_directory(Path::new(""));
                let (sha256, bytes) =
                    staging.copy_asset_tree(&member.path, &relative, member.id)?;
                carried.push(StoreExportMember {
                    id: member.id.to_owned(),
                    file: manifest_path(&relative)?,
                    disposition: member.disposition,
                    sha256,
                    bytes,
                });
            }
            MemberDisposition::Folded => excluded.push(excluded_member(
                member,
                "the online backup folded this SQLite sidecar into the database image",
            )),
            MemberDisposition::InstanceLocal => excluded.push(excluded_member(
                member,
                "instance-local state does not belong to the exported store",
            )),
            MemberDisposition::Refuse => excluded.push(excluded_member(
                member,
                "refusing lineage state is absent (or the managed directory is empty)",
            )),
            MemberDisposition::Optional | MemberDisposition::Required => {
                excluded.push(excluded_member(member, "source member is absent"));
            }
        }
    }

    let manifest = StoreExportManifest {
        format_version: STORE_EXPORT_FORMAT_VERSION,
        created_at_ms,
        source_database_basename: source_database_basename.clone(),
        members: carried,
        excluded,
        declared_properties: StoreExportDeclaredProperties {
            wal_folded: true,
            // @ref LLP 0192#d-3-push-token-custody — the shared database-image
            // path physically scrubs protected push-token custody rows.
            push_token_registry_scrubbed: true,
            carries_admin_authority,
            carries_live_sessions,
        },
        boot: StoreExportBoot {
            command: format!(
                "snapback start --db {}",
                output_directory.join(&source_database_basename).display()
            ),
        },
    };
    let manifest_bytes = serde_json::to_vec(&manifest)
        .map_err(|_| store_invalid("store export manifest could not be encoded"))?;
    let mut manifest_file = staging.create_file(Path::new(STORE_EXPORT_MANIFEST_FILE))?;
    manifest_file
        .write_all(&manifest_bytes)
        .map_err(|_| store_invalid("store export manifest could not be written"))?;
    manifest_file
        .sync_all()
        .map_err(|_| store_invalid("store export manifest could not be synced"))?;
    staging.sync_all_directories()?;
    let publication_state = staging.publish(output_directory)?;
    Ok(StoreExportOutcome {
        manifest,
        publication_state,
    })
}

fn validate_export_inputs(
    snapback: &LocalSnapback,
    database_path: &Path,
    output_directory: &Path,
    created_at_ms: u64,
) -> SnapbackResult<()> {
    if created_at_ms > MAX_SAFE_INTEGER {
        return Err(store_invalid(
            "store export creation time is outside the portable timestamp range",
        ));
    }
    if path_present(output_directory) {
        return Err(store_invalid(
            "store export output directory already exists",
        ));
    }
    let parent = output_parent(output_directory);
    let parent_metadata = fs::symlink_metadata(parent)
        .map_err(|_| store_invalid("store export output parent does not exist"))?;
    if parent_metadata.file_type().is_symlink() || !parent_metadata.is_dir() {
        return Err(store_invalid(
            "store export output parent is not a real directory",
        ));
    }
    let source_metadata = fs::symlink_metadata(database_path)
        .map_err(|_| store_invalid("source database does not exist"))?;
    if source_metadata.file_type().is_symlink() || !source_metadata.is_file() {
        return Err(store_invalid(
            "source is not a file-backed regular database",
        ));
    }
    let opened_path = snapback
        .database_path()
        .ok_or_else(|| store_invalid("in-memory databases cannot be exported"))?;
    let supplied = fs::canonicalize(database_path)
        .map_err(|_| store_invalid("source database path could not be resolved"))?;
    let opened = fs::canonicalize(opened_path)
        .map_err(|_| store_invalid("opened database path could not be resolved"))?;
    if supplied != opened {
        return Err(store_invalid(
            "source path does not name the opened database",
        ));
    }
    Ok(())
}

// @ref LLP 0192#d-1-the-durable-state-registry — lineage-bearing state is a
// hard refusal, because a copy that silently loses fork custody can boot while
// claiming the wrong identity.
fn refuse_lineage_members(registry: &[DurableMember]) -> SnapbackResult<()> {
    for member in registry
        .iter()
        .filter(|member| member.disposition == MemberDisposition::Refuse)
    {
        let refused = match member.kind {
            MemberKind::File => path_present(&member.path),
            MemberKind::Directory => {
                path_present(&member.path) && !directory_is_empty(&member.path, member.id)?
            }
        };
        if refused {
            return Err(store_refused(
                member,
                &format!(
                    "{} is present; use `snapback fork` for derived deployments",
                    member.id
                ),
            ));
        }
    }
    Ok(())
}

fn directory_is_empty(path: &Path, member_id: &str) -> SnapbackResult<bool> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|_| store_invalid(&format!("store member {member_id} could not be inspected")))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(store_refused_path(
            member_id,
            path,
            "store directory member is a symlink or non-directory",
        ));
    }
    let mut entries = fs::read_dir(path)
        .map_err(|_| store_invalid(&format!("store member {member_id} could not be enumerated")))?;
    Ok(entries.next().is_none())
}

fn exported_file_name(member: &DurableMember) -> SnapbackResult<PathBuf> {
    member
        .path
        .file_name()
        .map(PathBuf::from)
        .ok_or_else(|| store_invalid("store member has no exportable file name"))
}

fn excluded_member(member: &DurableMember, reason: &str) -> StoreExportExcludedMember {
    StoreExportExcludedMember {
        id: member.id.to_owned(),
        disposition: member.disposition,
        reason: reason.to_owned(),
    }
}

fn path_present(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok()
}

fn output_parent(output: &Path) -> &Path {
    output
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."))
}

fn manifest_path(path: &Path) -> SnapbackResult<String> {
    let text = path
        .to_str()
        .ok_or_else(|| store_invalid("store export member path is not UTF-8"))?;
    Ok(text.replace(std::path::MAIN_SEPARATOR, "/"))
}

fn sha256_file(file: &mut File) -> SnapbackResult<(String, u64)> {
    file.seek(SeekFrom::Start(0))
        .map_err(|_| store_invalid("staged store member could not be hashed"))?;
    let mut hasher = Sha256::new();
    let mut bytes = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|_| store_invalid("staged store member could not be hashed"))?;
        if read == 0 {
            break;
        }
        bytes = bytes
            .checked_add(read as u64)
            .ok_or_else(|| store_invalid("store member byte count overflowed"))?;
        hasher.update(&buffer[..read]);
    }
    Ok((format!("{:x}", hasher.finalize()), bytes))
}

struct ExportStaging {
    path: PathBuf,
    name: std::ffi::OsString,
    parent: File,
    parent_path: PathBuf,
    parent_identity: FileIdentity,
    directory: File,
    identity: FileIdentity,
    publication_attempted: bool,
    published: bool,
}

impl ExportStaging {
    fn create(destination: &Path, random: &dyn RandomSource) -> SnapbackResult<Self> {
        #[cfg(unix)]
        use std::os::unix::fs::{OpenOptionsExt as _, PermissionsExt as _};

        let parent_path = output_parent(destination).to_path_buf();
        let mut parent_options = OpenOptions::new();
        parent_options.read(true);
        #[cfg(unix)]
        parent_options.custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC);
        let parent = parent_options
            .open(&parent_path)
            .map_err(|_| store_invalid("store export parent could not be pinned"))?;
        let parent_identity = FileIdentity::from_file(&parent)
            .map_err(|_| store_invalid("store export parent could not be identified"))?;
        for _ in 0..TEMP_CANDIDATE_ATTEMPTS {
            let mut entropy = [0_u8; 16];
            random
                .fill(&mut entropy)
                .map_err(|_| store_invalid("store export staging name could not be generated"))?;
            let name = std::ffi::OsString::from(format!(
                ".snapback-store-export-{}",
                encode_base64url(&entropy)
            ));
            let path = parent_path.join(&name);
            match fs::create_dir(&path) {
                Ok(()) => {
                    let prepared = (|| -> SnapbackResult<(File, FileIdentity)> {
                        #[cfg(unix)]
                        fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).map_err(
                            |_| store_invalid("store export staging permissions could not be set"),
                        )?;
                        let mut options = OpenOptions::new();
                        options.read(true);
                        #[cfg(unix)]
                        options
                            .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC);
                        let directory = options.open(&path).map_err(|_| {
                            store_invalid("store export staging directory could not be pinned")
                        })?;
                        let identity = FileIdentity::from_file(&directory).map_err(|_| {
                            store_invalid("store export staging directory could not be identified")
                        })?;
                        Ok((directory, identity))
                    })();
                    match prepared {
                        Ok((directory, identity)) => {
                            return Ok(Self {
                                path,
                                name,
                                parent,
                                parent_path,
                                parent_identity,
                                directory,
                                identity,
                                publication_attempted: false,
                                published: false,
                            });
                        }
                        Err(error) => {
                            let _ = fs::remove_dir(&path);
                            let _ = parent.sync_all();
                            return Err(error);
                        }
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(_) => {
                    return Err(store_invalid(
                        "store export staging directory could not be created",
                    ));
                }
            }
        }
        Err(store_invalid(
            "store export staging name collided repeatedly",
        ))
    }

    fn create_file(&self, relative: &Path) -> SnapbackResult<File> {
        #[cfg(unix)]
        use std::os::unix::fs::{OpenOptionsExt as _, PermissionsExt as _};

        validate_relative_path(relative)?;
        let path = self.path.join(relative);
        let parent = path
            .parent()
            .ok_or_else(|| store_invalid("staged member has no parent"))?;
        if parent != self.path {
            self.create_directories(
                parent
                    .strip_prefix(&self.path)
                    .map_err(|_| store_invalid("staged member escaped the export directory"))?,
            )?;
        }
        let mut options = OpenOptions::new();
        options.write(true).read(true).create_new(true);
        #[cfg(unix)]
        {
            options
                .mode(0o600)
                .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
        }
        let file = options
            .open(&path)
            .map_err(|_| store_invalid("staged store member could not be created safely"))?;
        #[cfg(unix)]
        file.set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(|_| store_invalid("staged store member mode could not be set"))?;
        Ok(file)
    }

    fn create_directories(&self, relative: &Path) -> SnapbackResult<()> {
        #[cfg(unix)]
        use std::os::unix::fs::PermissionsExt as _;

        validate_relative_path(relative)?;
        let mut current = self.path.clone();
        for component in relative.components() {
            current.push(component.as_os_str());
            match fs::symlink_metadata(&current) {
                Ok(metadata) => {
                    if metadata.file_type().is_symlink() || !metadata.is_dir() {
                        return Err(store_invalid(
                            "staged store directory is a symlink or non-directory",
                        ));
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    fs::create_dir(&current).map_err(|_| {
                        store_invalid("staged store directory could not be created")
                    })?;
                    #[cfg(unix)]
                    fs::set_permissions(&current, fs::Permissions::from_mode(0o700)).map_err(
                        |_| store_invalid("staged store directory mode could not be set"),
                    )?;
                }
                Err(_) => {
                    return Err(store_invalid(
                        "staged store directory could not be inspected",
                    ));
                }
            }
        }
        Ok(())
    }

    fn copy_regular_file(
        &self,
        source: &Path,
        relative: &Path,
        member_id: &str,
    ) -> SnapbackResult<(String, u64)> {
        #[cfg(unix)]
        use std::os::unix::fs::OpenOptionsExt as _;

        let metadata = fs::symlink_metadata(source).map_err(|_| {
            store_invalid(&format!("store member {member_id} could not be inspected"))
        })?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(store_refused_path(
                member_id,
                source,
                "store file member is a symlink or non-regular entry",
            ));
        }
        let mut options = OpenOptions::new();
        options.read(true);
        #[cfg(unix)]
        options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
        let mut input = options
            .open(source)
            .map_err(|_| store_invalid(&format!("store member {member_id} could not be opened")))?;
        if !input
            .metadata()
            .map_err(|_| store_invalid("opened store member could not be inspected"))?
            .is_file()
        {
            return Err(store_refused_path(
                member_id,
                source,
                "store file member is not regular",
            ));
        }
        let mut output = self.create_file(relative)?;
        std::io::copy(&mut input, &mut output)
            .map_err(|_| store_invalid("store member bytes could not be copied"))?;
        output
            .sync_all()
            .map_err(|_| store_invalid("store member could not be synced"))?;
        sha256_file(&mut output)
    }

    fn copy_asset_tree(
        &self,
        source: &Path,
        relative: &Path,
        member_id: &str,
    ) -> SnapbackResult<(String, u64)> {
        self.create_directories(relative)?;
        let mut triples = Vec::new();
        self.copy_asset_directory(source, relative, Path::new(""), member_id, &mut triples)?;
        triples.sort_by(|left, right| left.0.cmp(&right.0));
        let mut digest = Sha256::new();
        let mut total = 0_u64;
        for (path, sha256, bytes) in triples {
            update_length_prefixed(&mut digest, path.as_bytes());
            update_length_prefixed(&mut digest, sha256.as_bytes());
            digest.update(bytes.to_be_bytes());
            total = total
                .checked_add(bytes)
                .ok_or_else(|| store_invalid("asset blob byte count overflowed"))?;
        }
        Ok((format!("{:x}", digest.finalize()), total))
    }

    fn copy_asset_directory(
        &self,
        source_root: &Path,
        destination_root: &Path,
        relative: &Path,
        member_id: &str,
        triples: &mut Vec<(String, String, u64)>,
    ) -> SnapbackResult<()> {
        let source = source_root.join(relative);
        let metadata = fs::symlink_metadata(&source).map_err(|_| {
            store_invalid(&format!("store member {member_id} could not be inspected"))
        })?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(store_refused_path(
                member_id,
                &source,
                "asset blob tree contains a symlink or non-directory root",
            ));
        }
        let mut entries = fs::read_dir(&source)
            .map_err(|_| store_invalid("asset blob directory could not be enumerated"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| store_invalid("asset blob directory could not be enumerated"))?;
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            let child_relative = relative.join(entry.file_name());
            let child_source = source_root.join(&child_relative);
            let child_metadata = fs::symlink_metadata(&child_source)
                .map_err(|_| store_invalid("asset blob entry could not be inspected"))?;
            if child_metadata.file_type().is_symlink() {
                return Err(store_refused_path(
                    member_id,
                    &child_source,
                    "asset blob tree contains a symlink",
                ));
            }
            if child_metadata.is_dir() {
                self.create_directories(&destination_root.join(&child_relative))?;
                self.copy_asset_directory(
                    source_root,
                    destination_root,
                    &child_relative,
                    member_id,
                    triples,
                )?;
            } else if child_metadata.is_file() {
                let destination = destination_root.join(&child_relative);
                let (sha256, bytes) =
                    self.copy_regular_file(&child_source, &destination, member_id)?;
                triples.push((manifest_path(&child_relative)?, sha256, bytes));
            } else {
                return Err(store_refused_path(
                    member_id,
                    &child_source,
                    "asset blob tree contains a non-regular entry",
                ));
            }
        }
        Ok(())
    }

    fn sync_all_directories(&self) -> SnapbackResult<()> {
        sync_directory_tree(&self.path)?;
        self.directory
            .sync_all()
            .map_err(|_| store_invalid("store export staging directory could not be synced"))
    }

    fn revalidate(&self) -> SnapbackResult<()> {
        #[cfg(unix)]
        use std::os::unix::fs::OpenOptionsExt as _;

        let mut parent_options = OpenOptions::new();
        parent_options.read(true);
        #[cfg(unix)]
        parent_options.custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC);
        let parent = parent_options
            .open(&self.parent_path)
            .map_err(|_| store_invalid("store export parent identity changed"))?;
        let parent_identity = FileIdentity::from_file(&parent)
            .map_err(|_| store_invalid("store export parent could not be identified"))?;
        if parent_identity != self.parent_identity {
            return Err(store_invalid("store export parent identity changed"));
        }
        let mut staging_options = OpenOptions::new();
        staging_options.read(true);
        #[cfg(unix)]
        staging_options.custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC);
        let staging = staging_options
            .open(&self.path)
            .map_err(|_| store_invalid("store export staging identity changed"))?;
        let identity = FileIdentity::from_file(&staging)
            .map_err(|_| store_invalid("store export staging could not be identified"))?;
        if identity != self.identity {
            return Err(store_invalid("store export staging identity changed"));
        }
        Ok(())
    }

    fn publish(&mut self, destination: &Path) -> SnapbackResult<StoreExportPublication> {
        self.revalidate()?;
        let destination_name = destination
            .file_name()
            .ok_or_else(|| store_invalid("store export destination has no basename"))?;
        self.publication_attempted = true;
        crate::secure_file::rename_no_replace_in_directory(
            &self.parent,
            &self.name,
            destination_name,
        )
        .map_err(|_| store_commit_ambiguous("store export publication result is ambiguous"))?;
        self.published = true;
        self.parent.sync_all().map_err(|_| {
            store_commit_ambiguous("store export parent directory could not be synced")
        })?;
        Ok(StoreExportPublication::Published)
    }
}

impl Drop for ExportStaging {
    fn drop(&mut self) {
        if self.publication_attempted || self.published {
            return;
        }
        if self.revalidate().is_ok() {
            let _ = fs::remove_dir_all(&self.path);
            let _ = self.parent.sync_all();
        }
    }
}

fn validate_relative_path(path: &Path) -> SnapbackResult<()> {
    if path.as_os_str().is_empty()
        || path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                std::path::Component::ParentDir
                    | std::path::Component::RootDir
                    | std::path::Component::Prefix(_)
            )
        })
    {
        return Err(store_invalid("store export member path is not relative"));
    }
    Ok(())
}

fn sync_directory_tree(path: &Path) -> SnapbackResult<()> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|_| store_invalid("staged directory could not be inspected"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(store_invalid("staged directory is not a real directory"));
    }
    for entry in
        fs::read_dir(path).map_err(|_| store_invalid("staged directory could not be enumerated"))?
    {
        let entry = entry.map_err(|_| store_invalid("staged entry could not be inspected"))?;
        let metadata = entry
            .file_type()
            .map_err(|_| store_invalid("staged entry could not be inspected"))?;
        if metadata.is_symlink() {
            return Err(store_invalid("staged store export contains a symlink"));
        }
        if metadata.is_dir() {
            sync_directory_tree(&entry.path())?;
        } else if !metadata.is_file() {
            return Err(store_invalid(
                "staged store export contains a non-regular entry",
            ));
        }
    }
    File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|_| store_invalid("staged directory could not be synced"))
}

fn update_length_prefixed(hasher: &mut Sha256, bytes: &[u8]) {
    hasher.update((bytes.len() as u64).to_be_bytes());
    hasher.update(bytes);
}

fn store_invalid(message: &str) -> SnapbackError {
    SnapbackError::error("SNAPBACK_STORE_EXPORT_INVALID", "store-export", message)
}

fn store_refused(member: &DurableMember, message: &str) -> SnapbackError {
    store_refused_path(member.id, &member.path, message)
}

fn store_refused_path(member_id: &str, path: &Path, message: &str) -> SnapbackError {
    SnapbackError::error("SNAPBACK_STORE_EXPORT_REFUSED", "store-export", message).with_details(
        json!({
            "member": member_id,
            "path": path,
            "remedy": "use `snapback fork` for derived deployments or remove the unsupported entry",
        }),
    )
}

fn store_commit_ambiguous(message: &str) -> SnapbackError {
    store_error_with_publication_state(
        store_invalid(message),
        StoreExportPublication::CommitAmbiguous,
    )
}

fn store_error_with_publication_state(
    mut error: SnapbackError,
    state: StoreExportPublication,
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
mod tests {
    use super::*;

    #[cfg(not(feature = "cli-owner"))]
    mod remainder_tests {
        use super::*;
        use crate::auth::crypto::{CryptoError, OsRandom};
        use crate::auth::keyring::AuthKeyringStore;
        use crate::auth::lifecycle::activate_catalog;
        use crate::auth::runtime::{AuthProviderHealth, AuthRuntime};
        use crate::contract_types::AuthProviderProfile;
        use crate::local::LocalSnapback;
        use snapback_services::test_support::rusqlite::Connection;
        use std::collections::BTreeSet;
        #[cfg(unix)]
        use std::os::unix::fs::PermissionsExt as _;

        #[test]
        fn registry_and_startup_managed_database_paths_cannot_silently_diverge() {
            let directory = tempfile::tempdir().unwrap();
            let database = directory.path().join("app.sqlite3");
            let registry = durable_state_members(&database).unwrap();
            let startup = crate::cli::managed_startup_paths(Some(&database), None).unwrap();
            let startup_paths = startup
                .iter()
                .map(|managed| managed.path.clone())
                .collect::<BTreeSet<_>>();

            for member in &registry {
                if DIRECTORY_SHARED_MEMBER_IDS.contains(&member.id) {
                    continue;
                }
                let allow_reason = STARTUP_MANAGED_PATH_ALLOWLIST
                    .iter()
                    .find(|(id, _)| *id == member.id)
                    .map(|(_, reason)| *reason);
                assert!(
                    startup_paths.contains(&member.path) || allow_reason.is_some(),
                    "database-bound durable member {} ({}) is neither startup-managed nor documented in STARTUP_MANAGED_PATH_ALLOWLIST",
                    member.id,
                    member.path.display(),
                );
                if let Some(reason) = allow_reason {
                    assert!(!reason.trim().is_empty(), "allow-list reasons must be real");
                }
            }

            let registry_paths = registry
                .iter()
                .map(|member| member.path.clone())
                .collect::<BTreeSet<_>>();
            for managed in startup {
                assert!(
                    registry_paths.contains(&managed.path),
                    "startup-managed path {} ({}) is absent from the durable-state registry",
                    managed.label,
                    managed.path.display(),
                );
            }
        }

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
            if keep_wal_open {
                Some(connection)
            } else {
                drop(connection);
                None
            }
        }

        fn activated_store(
            database_path: &Path,
            keep_wal_open: bool,
        ) -> (LocalSnapback, AuthKeyringStore, Option<Connection>) {
            let wal_connection = create_app_rows(database_path, keep_wal_open);
            let mut snapback = LocalSnapback::open(database_path).unwrap();
            let keyring = AuthKeyringStore::file_for_database(database_path);
            activate_catalog(
                snapback.remainder_auth_database_mut(),
                &keyring,
                1_000,
                &OsRandom,
            )
            .unwrap();
            (snapback, keyring, wal_connection)
        }

        fn export_fixture(
            database_path: &Path,
            output: &Path,
            keep_wal_open: bool,
        ) -> (StoreExportOutcome, Option<Connection>) {
            let (mut snapback, keyring, wal_connection) =
                activated_store(database_path, keep_wal_open);
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
                    .any(|member| { member.id == "assetBlobs" && member.file == "assets/blobs" })
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
            assert!(runtime.startup_diagnostic().is_none());
            let connection = Connection::open(&exported_database).unwrap();
            let rows: i64 = connection
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
                AuthRuntime::inspect(&mut clone, Some(&clone_database), AuthProviderProfile::Test)
                    .unwrap();
            let diagnostic = runtime
                .startup_diagnostic()
                .expect("ready catalog without its keyring must diagnose the exact missing member");
            assert_eq!(diagnostic.code, "SNAPBACK_AUTH_PROVIDER_UNAVAILABLE");
            assert_eq!(
                diagnostic.details["path"],
                json!(AuthKeyringStore::keyring_path(&clone_database))
            );
            assert_eq!(diagnostic.details["cause"], json!("missing"));
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
            let connection = Connection::open(&exported_database).unwrap();
            let rows: i64 = connection
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
                    .join(crate::instance_fork::MINT_RECEIPT_FILE),
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
            assert_eq!(error.diagnostic.details["member"], json!("forkMintReceipt"));
            assert_eq!(
                error.diagnostic.details["publicationState"],
                json!("Unpublished")
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
                json!("Unpublished")
            );
            let staging = fs::read_dir(directory.path())
                .unwrap()
                .map(|entry| entry.unwrap().file_name())
                .filter_map(|name| name.into_string().ok())
                .filter(|name| name.starts_with(".snapback-store-export-"))
                .collect::<Vec<_>>();
            assert!(staging.is_empty(), "unexpected staging paths: {staging:?}");
        }
    }
}
