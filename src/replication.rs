//! Self-hosted async SQLite replication for LLP 0188 gate G2.
//!
//! This module deliberately implements one incarnation and one generation.
//! Explicit succession, hosted supervisor custody, epoch handover, retention,
//! and checkpoint proof envelopes remain gate-G3/amendment work.

use async_trait::async_trait;
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use celld_ltx::object_store::{
    ObjectStore, ObjectStoreExt, PutMode, PutOptions, PutPayload, UpdateVersion,
    aws::{AmazonS3Builder, S3ConditionalPut},
    path::Path as ObjectPath,
};
use celld_ltx::{
    CheckpointMode, Db, FileInfo, FileReplicaClient, ObjectStoreClient, ObjectStoreConfig, Pos,
    Replica, ReplicaClient, TXID,
};
use chacha20poly1305::{
    XChaCha20Poly1305, XNonce,
    aead::{Aead, KeyInit, Payload},
};
use fs2::FileExt as _;
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use std::ffi::OsString;
use std::fs::{File, OpenOptions};
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use uuid::Uuid;

use crate::auth::keyring::{AUTH_KEYRING_MAXIMUM_BYTES, AuthKeyringStore};
use crate::diagnostic::{SnapbackError, SnapbackResult};

pub const ENV_TARGET: &str = "SNAPBACK_REPLICATION_TARGET";
pub const ENV_KEY_FILE: &str = "SNAPBACK_REPLICATION_KEY_FILE";
pub const ENV_ENDPOINT: &str = "SNAPBACK_REPLICATION_ENDPOINT";
pub const ENV_REGION: &str = "SNAPBACK_REPLICATION_REGION";
pub const ENV_ACCESS_KEY_ID: &str = "SNAPBACK_REPLICATION_ACCESS_KEY_ID";
pub const ENV_SECRET_ACCESS_KEY: &str = "SNAPBACK_REPLICATION_SECRET_ACCESS_KEY";
pub const ENV_SESSION_TOKEN: &str = "SNAPBACK_REPLICATION_SESSION_TOKEN";
pub const ENV_PREFIX: &str = "SNAPBACK_REPLICATION_PREFIX";
pub const ENV_INTERVAL_MS: &str = "SNAPBACK_REPLICATION_INTERVAL_MS";

const HEAD_SCHEMA: &str = "snapback.replication-head.v1";
const SIDECAR_SCHEMA: &str = "snapback.replication-sidecar.v1";
const GENESIS_SCHEMA: &str = "snapback.replication-genesis.v1";
const COVERAGE_SCHEMA: &str = "snapback.replication-keyring-coverage.v1";
const SNAPSHOT_SCHEMA: &str = "snapback.replication-encrypted-keyring.v1";
const STATUS_SCHEMA: &str = "snapback.replication-status.v1";
const GENERATION: u64 = 1;
const DEFAULT_INTERVAL_MS: u64 = 250;
const KEY_BYTES: usize = 32;
const MAX_METADATA_BYTES: usize = 1_048_576;

fn replication_error(code: &'static str, message: impl Into<String>) -> SnapbackError {
    SnapbackError::error(code, "replication", message.into())
}

fn replication_failure_is_terminal(error: &SnapbackError) -> bool {
    !matches!(
        error.diagnostic.code.as_str(),
        "SNAPBACK_REPLICATION_CAPTURE_FAILED"
            | "SNAPBACK_REPLICATION_UPLOAD_FAILED"
            | "SNAPBACK_REPLICATION_STORE_UNAVAILABLE"
    )
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(9_007_199_254_740_991) as u64
}

fn sha256(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut value = String::with_capacity(64);
    for byte in digest {
        use std::fmt::Write as _;
        let _ = write!(value, "{byte:02x}");
    }
    value
}

fn digest_json<T: Serialize>(value: &T) -> SnapbackResult<(Vec<u8>, String)> {
    let bytes = serde_json::to_vec(value).map_err(|_| {
        replication_error(
            "SNAPBACK_REPLICATION_METADATA_INVALID",
            "replication metadata could not be encoded",
        )
    })?;
    let digest = sha256(&bytes);
    Ok((bytes, digest))
}

fn join_key(prefix: &str, suffix: &str) -> String {
    match (prefix.trim_matches('/'), suffix.trim_matches('/')) {
        ("", suffix) => suffix.to_owned(),
        (prefix, "") => prefix.to_owned(),
        (prefix, suffix) => format!("{prefix}/{suffix}"),
    }
}

pub fn configured_from_env() -> bool {
    std::env::var(ENV_TARGET)
        .ok()
        .is_some_and(|value| !value.trim().is_empty())
}

/// Prevents a Snapback-owned connection from performing SQLite's close-time
/// WAL checkpoint/removal while the LTX runtime owns the journal lifecycle.
/// Every connection that can touch the replicated database must opt in because
/// SQLITE_FCNTL_PERSIST_WAL is connection-local in SQLite's VFS.
// @ref LLP 0188#2-integration-point-the-whole-instance-database — one LTX
// owner governs the whole instance WAL, including connection close behavior.
pub(crate) fn configure_connection_wal_lifetime(conn: &Connection) -> SnapbackResult<()> {
    celld_ltx::db::set_persist_wal(conn).map_err(|error| {
        replication_error(
            "SNAPBACK_REPLICATION_DATABASE_UNAVAILABLE",
            format!("configure persistent WAL on Snapback connection: {error}"),
        )
    })
}

#[derive(Clone, Debug)]
enum TargetConfig {
    File {
        root: PathBuf,
    },
    S3 {
        config: ObjectStoreConfig,
        prefix: String,
    },
}

#[derive(Clone, Debug)]
pub struct ReplicationConfig {
    target: TargetConfig,
    key_file: PathBuf,
    target_digest: String,
    interval: Duration,
}

impl ReplicationConfig {
    pub fn from_env() -> SnapbackResult<Option<Self>> {
        let Some(raw_target) = std::env::var(ENV_TARGET)
            .ok()
            .filter(|value| !value.trim().is_empty())
        else {
            return Ok(None);
        };
        let key_file = std::env::var_os(ENV_KEY_FILE)
            .map(PathBuf::from)
            // @ref LLP 0188#5-confidentiality-and-custody — replication never
            // enables without externally provisioned keyring-snapshot custody.
            .ok_or_else(|| {
                replication_error(
                    "SNAPBACK_REPLICATION_KEY_REQUIRED",
                    format!("{ENV_KEY_FILE} must name an owner-only 32-byte key file"),
                )
            })?;
        let interval = std::env::var(ENV_INTERVAL_MS)
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .filter(|value| *value > 0)
            .map_or_else(
                || Duration::from_millis(DEFAULT_INTERVAL_MS),
                Duration::from_millis,
            );

        let target = if let Some(path) = raw_target.strip_prefix("file://") {
            if path.is_empty() {
                return Err(replication_error(
                    "SNAPBACK_REPLICATION_CONFIG_INVALID",
                    "file replication target has no path",
                ));
            }
            let root = PathBuf::from(path);
            let absolute = if root.is_absolute() {
                root
            } else {
                std::env::current_dir()
                    .map_err(|_| {
                        replication_error(
                            "SNAPBACK_REPLICATION_CONFIG_INVALID",
                            "replication target could not be resolved",
                        )
                    })?
                    .join(root)
            };
            TargetConfig::File { root: absolute }
        } else if raw_target.starts_with("s3://") {
            let parsed = celld_ltx::replica_url::parse_replica_url_with_query(&raw_target)
                .map_err(|error| {
                    replication_error(
                        "SNAPBACK_REPLICATION_CONFIG_INVALID",
                        format!("invalid S3 replication target: {error}"),
                    )
                })?;
            let mut config = ObjectStoreConfig::from_url(&parsed).map_err(|error| {
                replication_error(
                    "SNAPBACK_REPLICATION_CONFIG_INVALID",
                    format!("invalid S3 replication target: {error}"),
                )
            })?;
            if let Ok(value) = std::env::var(ENV_ENDPOINT) {
                config.endpoint = value;
                config.force_path_style = true;
            }
            if let Ok(value) = std::env::var(ENV_REGION) {
                config.region = value;
            }
            if let Ok(value) = std::env::var(ENV_ACCESS_KEY_ID) {
                config.access_key_id = value;
            }
            if let Ok(value) = std::env::var(ENV_SECRET_ACCESS_KEY) {
                config.secret_access_key = value;
            }
            if let Ok(value) = std::env::var(ENV_SESSION_TOKEN) {
                config.session_token = value;
            }
            let prefix = std::env::var(ENV_PREFIX)
                .ok()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| parsed.path.clone());
            config.path.clear();
            TargetConfig::S3 { config, prefix }
        } else {
            return Err(replication_error(
                "SNAPBACK_REPLICATION_CONFIG_INVALID",
                format!("{ENV_TARGET} must use file:// or s3://"),
            ));
        };

        let identity = match &target {
            TargetConfig::File { root } => format!("file:{}", root.display()),
            TargetConfig::S3 { config, prefix } => format!(
                "s3:{}:{}:{}:{}",
                config.endpoint, config.region, config.bucket, prefix
            ),
        };
        let config = Self {
            target,
            key_file,
            target_digest: sha256(identity.as_bytes()),
            interval,
        };
        let _ = config.read_key()?;
        Ok(Some(config))
    }

    fn read_key(&self) -> SnapbackResult<[u8; KEY_BYTES]> {
        let bytes = crate::secure_file::read_strict_owner_only(&self.key_file, KEY_BYTES).map_err(
            |_| {
                replication_error(
                    "SNAPBACK_REPLICATION_KEY_INVALID",
                    "replication key file is missing, unsafe, or unreadable",
                )
            },
        )?;
        bytes.try_into().map_err(|_| {
            replication_error(
                "SNAPBACK_REPLICATION_KEY_INVALID",
                "replication key file must contain exactly 32 raw bytes; key loss makes snapshots unrecoverable",
            )
        })
    }

    fn segment_encryption(&self) -> &'static str {
        match self.target {
            TargetConfig::File { .. } => "none",
            TargetConfig::S3 { .. } => "provider",
        }
    }

    fn build_factory(&self) -> SnapbackResult<BackendFactory> {
        match &self.target {
            TargetConfig::File { root } => {
                std::fs::create_dir_all(root).map_err(|error| {
                    replication_error(
                        "SNAPBACK_REPLICATION_STORE_UNAVAILABLE",
                        format!("create file replication target: {error}"),
                    )
                })?;
                Ok(BackendFactory::File { root: root.clone() })
            }
            TargetConfig::S3 { config, prefix } => {
                let store = build_conditional_s3_store(config).map_err(|error| {
                    replication_error(
                        "SNAPBACK_REPLICATION_STORE_UNAVAILABLE",
                        format!("build object store: {error}"),
                    )
                })?;
                Ok(BackendFactory::S3 {
                    store,
                    config: config.clone(),
                    prefix: prefix.clone(),
                })
            }
        }
    }
}

fn build_conditional_s3_store(
    config: &ObjectStoreConfig,
) -> celld_ltx::Result<Arc<dyn ObjectStore>> {
    if config.bucket.is_empty() {
        return Err(celld_ltx::Error::Other(
            "s3: bucket name is required".into(),
        ));
    }
    let region = if config.region.is_empty() {
        "us-east-1"
    } else {
        &config.region
    };
    // celld's path-clean client remains untouched. Snapback builds the one
    // shared object_store backend with ETag conditional puts enabled because
    // its fixed head and immutable metadata require Create/Update modes;
    // object_store intentionally returns NotImplemented without this choice.
    // MinIO RELEASE.2025-09-07T16-13-09Z is the G2-qualified provider.
    // @ref LLP 0188#4-single-writer-safety-replication-incarnation-fencing-with-explicit-succession — head advance is an If-Match CAS,
    // and losing it is a terminal stale-writer fence.
    let mut builder = AmazonS3Builder::new()
        .with_bucket_name(&config.bucket)
        .with_region(region)
        .with_virtual_hosted_style_request(!config.force_path_style)
        .with_conditional_put(S3ConditionalPut::ETagMatch);
    if !config.endpoint.is_empty() {
        let allow_http = config.endpoint.starts_with("http://")
            || config.skip_verify
            || celld_ltx::replica_url::is_local_endpoint(&config.endpoint);
        builder = builder
            .with_endpoint(&config.endpoint)
            .with_allow_http(allow_http);
    }
    if !config.access_key_id.is_empty() {
        builder = builder.with_access_key_id(&config.access_key_id);
    }
    if !config.secret_access_key.is_empty() {
        builder = builder.with_secret_access_key(&config.secret_access_key);
    }
    if !config.session_token.is_empty() {
        builder = builder.with_token(&config.session_token);
    }
    builder
        .build()
        .map(|store| Arc::new(store) as Arc<dyn ObjectStore>)
        .map_err(|error| celld_ltx::Error::Other(format!("s3: build store: {error}").into()))
}

#[derive(Clone)]
#[allow(clippy::large_enum_variant)] // Preserve the established backend representation and ownership.
enum BackendFactory {
    File {
        root: PathBuf,
    },
    S3 {
        store: Arc<dyn ObjectStore>,
        config: ObjectStoreConfig,
        prefix: String,
    },
}

impl BackendFactory {
    fn metadata_store(&self) -> MetadataStore {
        match self {
            Self::File { root } => MetadataStore::File { root: root.clone() },
            Self::S3 { store, prefix, .. } => MetadataStore::Object {
                store: store.clone(),
                prefix: prefix.clone(),
            },
        }
    }

    fn replica_client(&self, generation_root: &str) -> ReplicaBackend {
        match self {
            Self::File { root } => ReplicaBackend::File(FileReplicaClient::new(
                root.join(generation_root).to_string_lossy().into_owned(),
            )),
            Self::S3 {
                store,
                config,
                prefix,
            } => {
                let mut config = config.clone();
                config.path = join_key(prefix, &join_key(generation_root, "ltx"));
                ReplicaBackend::Object(ObjectStoreClient::with_store(config, store.clone()))
            }
        }
    }
}

#[allow(clippy::large_enum_variant)] // Preserve the established backend representation and ownership.
enum ReplicaBackend {
    File(FileReplicaClient),
    Object(ObjectStoreClient),
}

#[async_trait]
impl ReplicaClient for ReplicaBackend {
    fn type_name(&self) -> &str {
        match self {
            Self::File(client) => client.type_name(),
            Self::Object(client) => client.type_name(),
        }
    }

    async fn init(&self) -> celld_ltx::Result<()> {
        match self {
            Self::File(client) => client.init().await,
            Self::Object(client) => client.init().await,
        }
    }

    async fn ltx_files(
        &self,
        level: i32,
        seek: TXID,
        use_metadata: bool,
    ) -> celld_ltx::Result<Vec<FileInfo>> {
        match self {
            Self::File(client) => client.ltx_files(level, seek, use_metadata).await,
            Self::Object(client) => client.ltx_files(level, seek, use_metadata).await,
        }
    }

    async fn open_ltx_file(
        &self,
        level: i32,
        min_txid: TXID,
        max_txid: TXID,
        offset: i64,
        size: i64,
    ) -> celld_ltx::Result<Vec<u8>> {
        match self {
            Self::File(client) => {
                client
                    .open_ltx_file(level, min_txid, max_txid, offset, size)
                    .await
            }
            Self::Object(client) => {
                client
                    .open_ltx_file(level, min_txid, max_txid, offset, size)
                    .await
            }
        }
    }

    async fn write_ltx_file(
        &self,
        level: i32,
        min_txid: TXID,
        max_txid: TXID,
        data: &[u8],
    ) -> celld_ltx::Result<FileInfo> {
        match self {
            Self::File(client) => client.write_ltx_file(level, min_txid, max_txid, data).await,
            Self::Object(client) => client.write_ltx_file(level, min_txid, max_txid, data).await,
        }
    }

    async fn delete_ltx_files(&self, files: &[FileInfo]) -> celld_ltx::Result<()> {
        match self {
            Self::File(client) => client.delete_ltx_files(files).await,
            Self::Object(client) => client.delete_ltx_files(files).await,
        }
    }

    async fn delete_all(&self) -> celld_ltx::Result<()> {
        match self {
            Self::File(client) => client.delete_all().await,
            Self::Object(client) => client.delete_all().await,
        }
    }
}

#[derive(Clone, Debug)]
enum ObjectVersion {
    File(String),
    Store(UpdateVersion),
}

struct ObjectRead {
    bytes: Vec<u8>,
    version: ObjectVersion,
}

#[derive(Clone)]
enum MetadataStore {
    File {
        root: PathBuf,
    },
    Object {
        store: Arc<dyn ObjectStore>,
        prefix: String,
    },
}

impl MetadataStore {
    fn file_path(root: &Path, key: &str) -> PathBuf {
        key.split('/')
            .filter(|part| !part.is_empty())
            .fold(root.to_path_buf(), |path, part| path.join(part))
    }

    async fn get(&self, key: &str) -> SnapbackResult<Option<ObjectRead>> {
        match self {
            Self::File { root } => {
                let path = Self::file_path(root, key);
                let bytes = match std::fs::read(&path) {
                    Ok(bytes) => bytes,
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
                    Err(error) => {
                        return Err(replication_error(
                            "SNAPBACK_REPLICATION_STORE_UNAVAILABLE",
                            format!("read {}: {error}", path.display()),
                        ));
                    }
                };
                if bytes.len() > MAX_METADATA_BYTES {
                    return Err(replication_error(
                        "SNAPBACK_REPLICATION_METADATA_INVALID",
                        "replication metadata object exceeds its size bound",
                    ));
                }
                let version = ObjectVersion::File(sha256(&bytes));
                Ok(Some(ObjectRead { bytes, version }))
            }
            Self::Object { store, prefix } => {
                let path = ObjectPath::from(join_key(prefix, key));
                let result = match store.get(&path).await {
                    Ok(result) => result,
                    Err(celld_ltx::object_store::Error::NotFound { .. }) => return Ok(None),
                    Err(error) => {
                        return Err(replication_error(
                            "SNAPBACK_REPLICATION_STORE_UNAVAILABLE",
                            format!("get object {path}: {error}"),
                        ));
                    }
                };
                let version = ObjectVersion::Store(UpdateVersion {
                    e_tag: result.meta.e_tag.clone(),
                    version: result.meta.version.clone(),
                });
                let bytes = result.bytes().await.map_err(|error| {
                    replication_error(
                        "SNAPBACK_REPLICATION_STORE_UNAVAILABLE",
                        format!("read object {path}: {error}"),
                    )
                })?;
                if bytes.len() > MAX_METADATA_BYTES {
                    return Err(replication_error(
                        "SNAPBACK_REPLICATION_METADATA_INVALID",
                        "replication metadata object exceeds its size bound",
                    ));
                }
                Ok(Some(ObjectRead {
                    bytes: bytes.to_vec(),
                    version,
                }))
            }
        }
    }

    async fn create(&self, key: &str, bytes: &[u8]) -> SnapbackResult<ObjectVersion> {
        match self {
            Self::File { root } => {
                let path = Self::file_path(root, key);
                if let Some(parent) = path.parent() {
                    std::fs::create_dir_all(parent).map_err(|error| {
                        replication_error(
                            "SNAPBACK_REPLICATION_STORE_UNAVAILABLE",
                            format!("create {}: {error}", parent.display()),
                        )
                    })?;
                }
                match OpenOptions::new().write(true).create_new(true).open(&path) {
                    Ok(mut file) => {
                        file.write_all(bytes)
                            .and_then(|()| file.sync_all())
                            .map_err(|error| {
                                replication_error(
                                    "SNAPBACK_REPLICATION_STORE_UNAVAILABLE",
                                    format!("write {}: {error}", path.display()),
                                )
                            })?;
                        sync_parent(&path)?;
                        Ok(ObjectVersion::File(sha256(bytes)))
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                        Err(replication_error(
                            "SNAPBACK_REPLICATION_OBJECT_EXISTS",
                            format!("immutable replication object already exists: {key}"),
                        ))
                    }
                    Err(error) => Err(replication_error(
                        "SNAPBACK_REPLICATION_STORE_UNAVAILABLE",
                        format!("create {}: {error}", path.display()),
                    )),
                }
            }
            Self::Object { store, prefix } => {
                let path = ObjectPath::from(join_key(prefix, key));
                let result = store
                    .put_opts(
                        &path,
                        PutPayload::from(bytes.to_vec()),
                        PutOptions::from(PutMode::Create),
                    )
                    .await
                    .map_err(|error| match error {
                        celld_ltx::object_store::Error::AlreadyExists { .. } => replication_error(
                            "SNAPBACK_REPLICATION_OBJECT_EXISTS",
                            format!("immutable replication object already exists: {key}"),
                        ),
                        other => replication_error(
                            "SNAPBACK_REPLICATION_STORE_UNAVAILABLE",
                            format!("create object {path}: {other}"),
                        ),
                    })?;
                Ok(ObjectVersion::Store(result.into()))
            }
        }
    }

    async fn create_or_verify(&self, key: &str, bytes: &[u8]) -> SnapbackResult<()> {
        match self.create(key, bytes).await {
            Ok(_) => {}
            Err(error) if error.diagnostic.code == "SNAPBACK_REPLICATION_OBJECT_EXISTS" => {
                let existing = self.get(key).await?.ok_or_else(|| {
                    replication_error(
                        "SNAPBACK_REPLICATION_STORE_UNAVAILABLE",
                        "immutable object disappeared during verification",
                    )
                })?;
                if existing.bytes != bytes {
                    return Err(replication_error(
                        "SNAPBACK_REPLICATION_LINEAGE_DIVERGED",
                        "an immutable replication object has conflicting bytes",
                    ));
                }
            }
            Err(error) => return Err(error),
        }
        let read_back = self.get(key).await?.ok_or_else(|| {
            replication_error(
                "SNAPBACK_REPLICATION_STORE_UNAVAILABLE",
                "new immutable object was not readable",
            )
        })?;
        if read_back.bytes != bytes {
            return Err(replication_error(
                "SNAPBACK_REPLICATION_STORE_UNAVAILABLE",
                "immutable object read-back did not match its upload",
            ));
        }
        Ok(())
    }

    async fn update(
        &self,
        key: &str,
        expected: &ObjectVersion,
        bytes: &[u8],
    ) -> SnapbackResult<ObjectVersion> {
        match (self, expected) {
            (Self::File { root }, ObjectVersion::File(expected_digest)) => {
                let path = Self::file_path(root, key);
                let lock_path = path.with_extension("cas.lock");
                if let Some(parent) = lock_path.parent() {
                    std::fs::create_dir_all(parent).map_err(|error| {
                        replication_error(
                            "SNAPBACK_REPLICATION_STORE_UNAVAILABLE",
                            format!("create CAS directory: {error}"),
                        )
                    })?;
                }
                let lock = OpenOptions::new()
                    .read(true)
                    .write(true)
                    .create(true)
                    .truncate(false)
                    .open(&lock_path)
                    .map_err(|error| {
                        replication_error(
                            "SNAPBACK_REPLICATION_STORE_UNAVAILABLE",
                            format!("open file CAS lock: {error}"),
                        )
                    })?;
                lock.lock_exclusive().map_err(|error| {
                    replication_error(
                        "SNAPBACK_REPLICATION_STORE_UNAVAILABLE",
                        format!("lock file CAS: {error}"),
                    )
                })?;
                let current = std::fs::read(&path).map_err(|error| {
                    replication_error(
                        "SNAPBACK_REPLICATION_STORE_UNAVAILABLE",
                        format!("read file CAS head: {error}"),
                    )
                })?;
                if sha256(&current) != *expected_digest {
                    return Err(replication_error(
                        "SNAPBACK_REPLICATION_HEAD_CONFLICT",
                        "replication head conditional update lost; writer halted",
                    ));
                }
                atomic_write(&path, bytes)?;
                Ok(ObjectVersion::File(sha256(bytes)))
            }
            (Self::Object { store, prefix }, ObjectVersion::Store(expected)) => {
                let path = ObjectPath::from(join_key(prefix, key));
                // MinIO is the G2-qualified store: object_store maps this
                // UpdateVersion to an If-Match ETag/version precondition. Other
                // stores and per-credential immutability remain deliberately
                // unqualified until the deferred G2f/G3 matrix.
                let result = store
                    .put_opts(
                        &path,
                        PutPayload::from(bytes.to_vec()),
                        PutOptions::from(PutMode::Update(expected.clone())),
                    )
                    .await
                    .map_err(|error| match error {
                        celld_ltx::object_store::Error::Precondition { .. } => replication_error(
                            "SNAPBACK_REPLICATION_HEAD_CONFLICT",
                            "replication head conditional update lost; writer halted",
                        ),
                        other => replication_error(
                            "SNAPBACK_REPLICATION_STORE_UNAVAILABLE",
                            format!("update head object {path}: {other}"),
                        ),
                    })?;
                Ok(ObjectVersion::Store(result.into()))
            }
            _ => Err(replication_error(
                "SNAPBACK_REPLICATION_HEAD_CONFLICT",
                "replication head version belongs to another target",
            )),
        }
    }
}

fn sync_parent(path: &Path) -> SnapbackResult<()> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    File::open(parent)
        .and_then(|file| file.sync_all())
        .map_err(|error| {
            replication_error(
                "SNAPBACK_REPLICATION_STORE_UNAVAILABLE",
                format!("sync {}: {error}", parent.display()),
            )
        })
}

fn atomic_write(path: &Path, bytes: &[u8]) -> SnapbackResult<()> {
    let mut temporary = path.as_os_str().to_os_string();
    temporary.push(format!(".{}.tmp", Uuid::new_v4()));
    let temporary = PathBuf::from(temporary);
    let result = (|| {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt as _;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        std::fs::rename(&temporary, path)?;
        File::open(path.parent().unwrap_or_else(|| Path::new(".")))?.sync_all()
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result.map_err(|error| {
        replication_error(
            "SNAPBACK_REPLICATION_STATE_UNAVAILABLE",
            format!("publish {}: {error}", path.display()),
        )
    })
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReplicationPosition {
    pub txid: u64,
    pub post_apply_checksum: u64,
}

impl ReplicationPosition {
    fn from_pos(pos: Pos) -> Self {
        Self {
            txid: pos.txid.0,
            post_apply_checksum: pos.post_apply_checksum,
        }
    }

    fn as_pos(self) -> Pos {
        Pos::new(TXID(self.txid), self.post_apply_checksum)
    }
}

// @ref LLP 0188#2-integration-point-the-whole-instance-database — only the
// minimum of the two head-committed positions is advertised as restorable.
pub fn restorable_frontier(
    database: ReplicationPosition,
    keyring_coverage: ReplicationPosition,
) -> ReplicationPosition {
    if database.txid <= keyring_coverage.txid {
        database
    } else {
        keyring_coverage
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GenesisRecord {
    schema_version: String,
    target_digest: String,
    incarnation: String,
    generation: u64,
    predecessor: Option<String>,
    divergence_position: ReplicationPosition,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CoverageRecord {
    schema_version: String,
    incarnation: String,
    generation: u64,
    snapshot_digest: String,
    covered_from: ReplicationPosition,
    predecessor_digest: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EncryptedKeyringSnapshot {
    schema_version: String,
    plaintext_sha256: String,
    nonce: String,
    ciphertext: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReplicationHead {
    schema_version: String,
    target_digest: String,
    incarnation: String,
    generation: u64,
    genesis_digest: String,
    position: ReplicationPosition,
    ltx_chain_tip: String,
    coverage_tip: String,
    keyring_snapshot_digest: String,
    key_encryption_key_digest: String,
    keyring_coverage: ReplicationPosition,
    source_version: u64,
    updated_at_ms: u64,
    segment_encryption: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReplicationSidecar {
    schema_version: String,
    target_digest: String,
    incarnation: String,
    generation: u64,
    genesis_digest: String,
    local_position: ReplicationPosition,
    observed_head_position: ReplicationPosition,
    degraded: bool,
    halted_error: Option<String>,
    #[serde(default)]
    halted_error_detail: Option<String>,
    updated_at_ms: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObservedLag {
    pub positions: u64,
    pub source_versions: u64,
    pub observed_at_ms: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplicationStatus {
    pub schema_version: String,
    pub enabled: bool,
    pub incarnation: Option<String>,
    pub generation: Option<u64>,
    pub replicated_position: Option<ReplicationPosition>,
    pub keyring_coverage: Option<ReplicationPosition>,
    pub frontier: Option<ReplicationPosition>,
    pub observed_lag: Option<ObservedLag>,
    pub degraded: bool,
    pub segment_encryption: String,
    pub weaker_posture: Option<String>,
    pub error: Option<String>,
    pub error_detail: Option<String>,
}

impl ReplicationStatus {
    pub fn disabled() -> Self {
        Self {
            schema_version: STATUS_SCHEMA.to_owned(),
            enabled: false,
            incarnation: None,
            generation: None,
            replicated_position: None,
            keyring_coverage: None,
            frontier: None,
            observed_lag: None,
            degraded: false,
            segment_encryption: "none".to_owned(),
            weaker_posture: None,
            error: None,
            error_detail: None,
        }
    }
}

struct HeadState {
    head: ReplicationHead,
    version: ObjectVersion,
}

struct ReplicationSession {
    database_path: PathBuf,
    key: [u8; KEY_BYTES],
    metadata: MetadataStore,
    generation_root: String,
    head: HeadState,
    sidecar: ReplicationSidecar,
    replica: Replica<ReplicaBackend>,
}

impl ReplicationSession {
    async fn attach(database_path: PathBuf, config: ReplicationConfig) -> SnapbackResult<Self> {
        let key = config.read_key()?;
        let factory = config.build_factory()?;
        let metadata = factory.metadata_store();
        let head_read = metadata.get("head.json").await?;
        let sidecar_path = sidecar_path(&database_path);
        let sidecar = read_sidecar(&sidecar_path)?;

        match (head_read, sidecar) {
            (None, None) => {
                let incarnation = Uuid::new_v4().to_string();
                let generation_root = generation_root(&incarnation, GENERATION);
                let genesis = GenesisRecord {
                    schema_version: GENESIS_SCHEMA.to_owned(),
                    target_digest: config.target_digest.clone(),
                    incarnation: incarnation.clone(),
                    generation: GENERATION,
                    predecessor: None,
                    divergence_position: ReplicationPosition::default(),
                };
                let (genesis_bytes, genesis_digest) = digest_json(&genesis)?;
                metadata
                    .create_or_verify(
                        &join_key(&generation_root, &format!("genesis/{genesis_digest}.json")),
                        &genesis_bytes,
                    )
                    .await?;
                let keyring = read_keyring(&database_path)?;
                let snapshot_digest = sha256(&keyring);
                publish_snapshot(
                    &metadata,
                    &generation_root,
                    &incarnation,
                    GENERATION,
                    &snapshot_digest,
                    &keyring,
                    &key,
                )
                .await?;
                let coverage = CoverageRecord {
                    schema_version: COVERAGE_SCHEMA.to_owned(),
                    incarnation: incarnation.clone(),
                    generation: GENERATION,
                    snapshot_digest: snapshot_digest.clone(),
                    covered_from: ReplicationPosition {
                        txid: 1,
                        post_apply_checksum: 0,
                    },
                    predecessor_digest: None,
                };
                let (coverage_bytes, coverage_digest) = digest_json(&coverage)?;
                metadata
                    .create_or_verify(
                        &join_key(
                            &generation_root,
                            &format!("coverage/{coverage_digest}.json"),
                        ),
                        &coverage_bytes,
                    )
                    .await?;
                let head = ReplicationHead {
                    schema_version: HEAD_SCHEMA.to_owned(),
                    target_digest: config.target_digest.clone(),
                    incarnation: incarnation.clone(),
                    generation: GENERATION,
                    genesis_digest: genesis_digest.clone(),
                    position: ReplicationPosition::default(),
                    ltx_chain_tip: chain_genesis(&genesis_digest),
                    coverage_tip: coverage_digest,
                    keyring_snapshot_digest: snapshot_digest,
                    key_encryption_key_digest: sha256(&key),
                    keyring_coverage: ReplicationPosition::default(),
                    source_version: 0,
                    updated_at_ms: now_ms(),
                    segment_encryption: config.segment_encryption().to_owned(),
                };
                let head_bytes = serde_json::to_vec(&head).map_err(|_| {
                    replication_error(
                        "SNAPBACK_REPLICATION_METADATA_INVALID",
                        "replication head could not be encoded",
                    )
                })?;
                let version = metadata
                    .create("head.json", &head_bytes)
                    .await
                    .map_err(|error| {
                        if error.diagnostic.code == "SNAPBACK_REPLICATION_OBJECT_EXISTS" {
                            replication_error(
                                "SNAPBACK_REPLICATION_ATTACH_REFUSED",
                                "another writer initialized the replication head",
                            )
                        } else {
                            error
                        }
                    })?;
                let sidecar = ReplicationSidecar {
                    schema_version: SIDECAR_SCHEMA.to_owned(),
                    target_digest: config.target_digest.clone(),
                    incarnation,
                    generation: GENERATION,
                    genesis_digest,
                    local_position: ReplicationPosition::default(),
                    observed_head_position: ReplicationPosition::default(),
                    degraded: false,
                    halted_error: None,
                    halted_error_detail: None,
                    updated_at_ms: now_ms(),
                };
                write_sidecar(&sidecar_path, &sidecar, true)?;
                Self::finish_attach(
                    database_path,
                    key,
                    factory,
                    metadata,
                    generation_root,
                    HeadState { head, version },
                    sidecar,
                )
                .await
            }
            (Some(head_read), Some(sidecar)) => {
                let head: ReplicationHead =
                    serde_json::from_slice(&head_read.bytes).map_err(|_| {
                        replication_error(
                            "SNAPBACK_REPLICATION_METADATA_INVALID",
                            "replication head is malformed",
                        )
                    })?;
                validate_head(&head, &config)?;
                validate_sidecar(&sidecar, &head, &config)?;
                let generation_root = generation_root(&head.incarnation, head.generation);
                Self::finish_attach(
                    database_path,
                    key,
                    factory,
                    metadata,
                    generation_root,
                    HeadState {
                        head,
                        version: head_read.version,
                    },
                    sidecar,
                )
                .await
            }
            // @ref LLP 0188#4-single-writer-safety-replication-incarnation-fencing-with-explicit-succession
            // — G2 has no succession command: missing/foreign identity is a
            // coded refusal and never silently mints a replacement.
            (Some(_), None) => Err(replication_error(
                "SNAPBACK_REPLICATION_ATTACH_REFUSED",
                "replication head exists but the database sidecar is missing; explicit succession is not implemented",
            )),
            (None, Some(_)) => Err(replication_error(
                "SNAPBACK_REPLICATION_ATTACH_REFUSED",
                "replication sidecar exists but its authoritative head is missing",
            )),
        }
    }

    #[allow(clippy::too_many_arguments)]
    async fn finish_attach(
        database_path: PathBuf,
        key: [u8; KEY_BYTES],
        factory: BackendFactory,
        metadata: MetadataStore,
        generation_root: String,
        head: HeadState,
        sidecar: ReplicationSidecar,
    ) -> SnapbackResult<Self> {
        let mut db = Db::open(&database_path).map_err(|error| {
            replication_error(
                "SNAPBACK_REPLICATION_DATABASE_UNAVAILABLE",
                format!("attach celld-ltx Db: {error}"),
            )
        })?;
        // Automatic celld checkpoints are disabled. Snapback first uploads and
        // head-commits a captured tail, then invokes an explicit celld-ltx
        // checkpoint. The Db's long read transaction prevents every external
        // connection (including last-close behavior) from truncating the WAL.
        db.truncate_page_n = 0;
        db.min_checkpoint_page_n = u32::MAX;
        db.checkpoint_interval = Duration::ZERO;
        let client = factory.replica_client(&generation_root);
        client.init().await.map_err(|error| {
            replication_error(
                "SNAPBACK_REPLICATION_STORE_UNAVAILABLE",
                format!("initialize replica client: {error}"),
            )
        })?;
        let mut replica = Replica::new(db, client);
        verify_resume(&mut replica, &head.head).await?;
        validate_coverage_chain(&metadata, &generation_root, &head.head).await?;
        replica.seed_pos(head.head.position.as_pos());
        Ok(Self {
            database_path,
            key,
            metadata,
            generation_root,
            head,
            sidecar,
            replica,
        })
    }

    async fn ship_once(&mut self) -> SnapbackResult<ReplicationStatus> {
        let keyring_before = read_keyring(&self.database_path)?;
        self.replica
            .db_mut()
            .expect("attached replication database")
            .sync()
            .map_err(|error| {
                replication_error(
                    "SNAPBACK_REPLICATION_CAPTURE_FAILED",
                    format!("capture WAL as LTX: {error}"),
                )
            })?;
        let local_position = ReplicationPosition::from_pos(
            self.replica
                .db_mut()
                .expect("attached replication database")
                .pos()
                .map_err(|error| {
                    replication_error(
                        "SNAPBACK_REPLICATION_CAPTURE_FAILED",
                        format!("read local replication position: {error}"),
                    )
                })?,
        );
        let keyring_after = read_keyring(&self.database_path)?;
        let keyring = if keyring_before == keyring_after {
            keyring_before
        } else {
            // The post-capture exact ring includes the newly active key and,
            // under LLP 0057's 24-hour floor, every retired key any captured
            // frame can reference. It is uploaded before the frame is counted.
            keyring_after
        };
        let snapshot_digest = sha256(&keyring);
        let mut coverage_tip = self.head.head.coverage_tip.clone();
        if snapshot_digest != self.head.head.keyring_snapshot_digest {
            publish_snapshot(
                &self.metadata,
                &self.generation_root,
                &self.head.head.incarnation,
                self.head.head.generation,
                &snapshot_digest,
                &keyring,
                &self.key,
            )
            .await?;
            let record = CoverageRecord {
                schema_version: COVERAGE_SCHEMA.to_owned(),
                incarnation: self.head.head.incarnation.clone(),
                generation: self.head.head.generation,
                snapshot_digest: snapshot_digest.clone(),
                covered_from: ReplicationPosition {
                    txid: self.head.head.position.txid.saturating_add(1),
                    post_apply_checksum: 0,
                },
                predecessor_digest: Some(self.head.head.coverage_tip.clone()),
            };
            let (bytes, digest) = digest_json(&record)?;
            self.metadata
                .create_or_verify(
                    &join_key(&self.generation_root, &format!("coverage/{digest}.json")),
                    &bytes,
                )
                .await?;
            coverage_tip = digest;
        }

        self.replica.sync().await.map_err(|error| {
            replication_error(
                "SNAPBACK_REPLICATION_UPLOAD_FAILED",
                format!("upload LTX tail: {error}"),
            )
        })?;
        let remote_position = ReplicationPosition::from_pos(self.replica.pos());
        if remote_position.txid < self.head.head.position.txid {
            return Err(replication_error(
                "SNAPBACK_REPLICATION_LINEAGE_DIVERGED",
                "replica position moved behind the committed head",
            ));
        }
        let ltx_chain_tip = extend_ltx_chain(
            &self.replica.client,
            self.replica.db().expect("attached replication database"),
            self.head.head.position.txid,
            remote_position.txid,
            &self.head.head.ltx_chain_tip,
        )
        .await?;

        let source_version = if remote_position.txid == 0 {
            0
        } else {
            verify_restored_position(&self.replica.client, remote_position.txid).await?
        };
        let candidate = ReplicationHead {
            schema_version: HEAD_SCHEMA.to_owned(),
            target_digest: self.head.head.target_digest.clone(),
            incarnation: self.head.head.incarnation.clone(),
            generation: self.head.head.generation,
            genesis_digest: self.head.head.genesis_digest.clone(),
            position: remote_position,
            ltx_chain_tip,
            coverage_tip,
            keyring_snapshot_digest: snapshot_digest,
            key_encryption_key_digest: self.head.head.key_encryption_key_digest.clone(),
            keyring_coverage: remote_position,
            source_version,
            updated_at_ms: now_ms(),
            segment_encryption: self.head.head.segment_encryption.clone(),
        };
        if candidate.position.txid > self.head.head.position.txid
            || candidate.coverage_tip != self.head.head.coverage_tip
        {
            let bytes = serde_json::to_vec(&candidate).map_err(|_| {
                replication_error(
                    "SNAPBACK_REPLICATION_METADATA_INVALID",
                    "replication head could not be encoded",
                )
            })?;
            let version = self
                .metadata
                .update("head.json", &self.head.version, &bytes)
                .await?;
            let read_back = self.metadata.get("head.json").await?.ok_or_else(|| {
                replication_error(
                    "SNAPBACK_REPLICATION_STORE_UNAVAILABLE",
                    "replication head disappeared after update",
                )
            })?;
            if read_back.bytes != bytes {
                return Err(replication_error(
                    "SNAPBACK_REPLICATION_HEAD_CONFLICT",
                    "replication head read-back differs after conditional update; writer halted",
                ));
            }
            self.head = HeadState {
                head: candidate,
                version: read_back.version,
            };
            let _ = version;
        }
        self.sidecar.local_position = local_position;
        self.sidecar.observed_head_position = self.head.head.position;
        self.sidecar.degraded = false;
        self.sidecar.halted_error = None;
        self.sidecar.halted_error_detail = None;
        self.sidecar.updated_at_ms = now_ms();
        write_sidecar(&sidecar_path(&self.database_path), &self.sidecar, false)?;
        self.status()
    }

    async fn checkpoint(&mut self) -> SnapbackResult<ReplicationStatus> {
        let _ = self.ship_once().await?;
        self.replica
            .db_mut()
            .expect("attached replication database")
            .checkpoint(CheckpointMode::Truncate)
            .map_err(|error| {
                replication_error(
                    "SNAPBACK_REPLICATION_CHECKPOINT_FAILED",
                    format!("celld-ltx checkpoint failed: {error}"),
                )
            })?;
        self.ship_once().await
    }

    fn status(&self) -> SnapbackResult<ReplicationStatus> {
        status_from_head(
            &self.database_path,
            &self.head.head,
            Some(self.sidecar.local_position),
            self.sidecar.degraded,
            self.sidecar.halted_error.clone(),
            self.sidecar.halted_error_detail.clone(),
        )
    }

    fn record_halt(&mut self, error: &SnapbackError) {
        self.sidecar.degraded = true;
        self.sidecar.halted_error = Some(error.diagnostic.code.clone());
        self.sidecar.halted_error_detail = Some(error.diagnostic.message.clone());
        self.sidecar.updated_at_ms = now_ms();
        let _ = write_sidecar(&sidecar_path(&self.database_path), &self.sidecar, false);
    }
}

fn generation_root(incarnation: &str, generation: u64) -> String {
    format!("incarnations/{incarnation}/generations/{generation:016x}")
}

fn sidecar_path(database_path: &Path) -> PathBuf {
    let mut value = OsString::from(database_path.as_os_str());
    value.push(".replication.json");
    PathBuf::from(value)
}

fn read_sidecar(path: &Path) -> SnapbackResult<Option<ReplicationSidecar>> {
    let bytes = match crate::secure_file::read_strict_owner_only(path, MAX_METADATA_BYTES) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => {
            return Err(replication_error(
                "SNAPBACK_REPLICATION_STATE_UNAVAILABLE",
                "replication sidecar is unsafe or unreadable",
            ));
        }
    };
    serde_json::from_slice(&bytes).map(Some).map_err(|_| {
        replication_error(
            "SNAPBACK_REPLICATION_STATE_UNAVAILABLE",
            "replication sidecar is malformed",
        )
    })
}

fn write_sidecar(path: &Path, sidecar: &ReplicationSidecar, initial: bool) -> SnapbackResult<()> {
    let bytes = serde_json::to_vec_pretty(sidecar).map_err(|_| {
        replication_error(
            "SNAPBACK_REPLICATION_STATE_UNAVAILABLE",
            "replication sidecar could not be encoded",
        )
    })?;
    if initial {
        crate::secure_file::write_new_owner_only(path, &bytes).map_err(|error| {
            replication_error(
                "SNAPBACK_REPLICATION_STATE_UNAVAILABLE",
                format!("create replication sidecar: {error}"),
            )
        })?;
        sync_parent(path)
    } else {
        atomic_write(path, &bytes)
    }
}

fn validate_head(head: &ReplicationHead, config: &ReplicationConfig) -> SnapbackResult<()> {
    if head.schema_version != HEAD_SCHEMA
        || head.target_digest != config.target_digest
        || head.generation != GENERATION
        || head.incarnation.is_empty()
        || head.genesis_digest.len() != 64
        || head.coverage_tip.len() != 64
        || head.key_encryption_key_digest.len() != 64
        || head.position.txid < head.keyring_coverage.txid
        || head.segment_encryption != config.segment_encryption()
    {
        return Err(replication_error(
            "SNAPBACK_REPLICATION_METADATA_INVALID",
            "replication head is not the supported self-hosted generation-1 shape",
        ));
    }
    if head.key_encryption_key_digest != sha256(&config.read_key()?) {
        return Err(replication_error(
            "SNAPBACK_REPLICATION_KEY_INVALID",
            "the configured snapshot-encryption key does not match this replication incarnation; key rotation requires explicit future succession",
        ));
    }
    Ok(())
}

fn validate_sidecar(
    sidecar: &ReplicationSidecar,
    head: &ReplicationHead,
    config: &ReplicationConfig,
) -> SnapbackResult<()> {
    if sidecar.schema_version != SIDECAR_SCHEMA
        || sidecar.target_digest != config.target_digest
        || sidecar.incarnation != head.incarnation
        || sidecar.generation != head.generation
        || sidecar.genesis_digest != head.genesis_digest
    {
        return Err(replication_error(
            "SNAPBACK_REPLICATION_ATTACH_REFUSED",
            "foreign replication sidecar does not match the authoritative head; explicit succession is required",
        ));
    }
    Ok(())
}

fn read_keyring(database_path: &Path) -> SnapbackResult<Vec<u8>> {
    let store = AuthKeyringStore::file_for_database(database_path);
    store
        .validated_file_bytes()
        .map(|bytes| bytes.expose_secret().to_vec())
        .map_err(|_| {
            replication_error(
                "SNAPBACK_REPLICATION_KEYRING_MISSING",
                "replication requires the exact valid auth keyring sidecar before any database position can advance",
            )
        })
}

fn snapshot_aad(incarnation: &str, generation: u64, digest: &str) -> Vec<u8> {
    format!("snapback:keyring-snapshot:v1:{incarnation}:{generation}:{digest}").into_bytes()
}

async fn publish_snapshot(
    metadata: &MetadataStore,
    generation_root: &str,
    incarnation: &str,
    generation: u64,
    digest: &str,
    plaintext: &[u8],
    key: &[u8; KEY_BYTES],
) -> SnapbackResult<()> {
    let mut nonce = [0_u8; 24];
    getrandom::fill(&mut nonce).map_err(|_| {
        replication_error(
            "SNAPBACK_REPLICATION_ENCRYPTION_FAILED",
            "system entropy was unavailable for keyring snapshot encryption",
        )
    })?;
    let ciphertext = XChaCha20Poly1305::new(key.into())
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad: &snapshot_aad(incarnation, generation, digest),
            },
        )
        .map_err(|_| {
            replication_error(
                "SNAPBACK_REPLICATION_ENCRYPTION_FAILED",
                "keyring snapshot encryption failed",
            )
        })?;
    let envelope = EncryptedKeyringSnapshot {
        schema_version: SNAPSHOT_SCHEMA.to_owned(),
        plaintext_sha256: digest.to_owned(),
        nonce: URL_SAFE_NO_PAD.encode(nonce),
        ciphertext: URL_SAFE_NO_PAD.encode(ciphertext),
    };
    let bytes = serde_json::to_vec(&envelope).map_err(|_| {
        replication_error(
            "SNAPBACK_REPLICATION_ENCRYPTION_FAILED",
            "encrypted keyring snapshot could not be encoded",
        )
    })?;
    metadata
        .create_or_verify(
            &join_key(
                generation_root,
                &format!("keyrings/{digest}.xchacha20poly1305.json"),
            ),
            &bytes,
        )
        .await
}

async fn decrypt_snapshot(
    metadata: &MetadataStore,
    generation_root: &str,
    incarnation: &str,
    generation: u64,
    digest: &str,
    key: &[u8; KEY_BYTES],
) -> SnapbackResult<Vec<u8>> {
    let object = metadata
        .get(&join_key(
            generation_root,
            &format!("keyrings/{digest}.xchacha20poly1305.json"),
        ))
        .await?
        .ok_or_else(|| {
            replication_error(
                "SNAPBACK_REPLICATION_RESTORE_KEYRING_MISSING",
                "the governing encrypted keyring snapshot is missing",
            )
        })?;
    let envelope: EncryptedKeyringSnapshot =
        serde_json::from_slice(&object.bytes).map_err(|_| {
            replication_error(
                "SNAPBACK_REPLICATION_RESTORE_KEYRING_INVALID",
                "encrypted keyring snapshot is malformed",
            )
        })?;
    if envelope.schema_version != SNAPSHOT_SCHEMA || envelope.plaintext_sha256 != digest {
        return Err(replication_error(
            "SNAPBACK_REPLICATION_RESTORE_KEYRING_INVALID",
            "encrypted keyring snapshot identity does not match its coverage record",
        ));
    }
    let nonce = URL_SAFE_NO_PAD.decode(envelope.nonce).map_err(|_| {
        replication_error(
            "SNAPBACK_REPLICATION_RESTORE_KEYRING_INVALID",
            "encrypted keyring nonce is malformed",
        )
    })?;
    if nonce.len() != 24 {
        return Err(replication_error(
            "SNAPBACK_REPLICATION_RESTORE_KEYRING_INVALID",
            "encrypted keyring nonce has the wrong length",
        ));
    }
    let ciphertext = URL_SAFE_NO_PAD.decode(envelope.ciphertext).map_err(|_| {
        replication_error(
            "SNAPBACK_REPLICATION_RESTORE_KEYRING_INVALID",
            "encrypted keyring ciphertext is malformed",
        )
    })?;
    let plaintext = XChaCha20Poly1305::new(key.into())
        .decrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: &ciphertext,
                aad: &snapshot_aad(incarnation, generation, digest),
            },
        )
        .map_err(|_| {
            replication_error(
                "SNAPBACK_REPLICATION_RESTORE_KEYRING_INVALID",
                "keyring snapshot could not be decrypted; the configured key is wrong or the object is corrupt",
            )
        })?;
    if plaintext.len() > AUTH_KEYRING_MAXIMUM_BYTES || sha256(&plaintext) != digest {
        return Err(replication_error(
            "SNAPBACK_REPLICATION_RESTORE_KEYRING_INVALID",
            "decrypted keyring snapshot digest is invalid",
        ));
    }
    Ok(plaintext)
}

fn chain_genesis(genesis_digest: &str) -> String {
    sha256(format!("snapback:ltx-chain:v1:{genesis_digest}").as_bytes())
}

fn extend_tip(tip: &str, txid: u64, bytes: &[u8]) -> String {
    sha256(format!("snapback:ltx-chain:v1:{tip}:{txid}:{}", sha256(bytes)).as_bytes())
}

async fn extend_ltx_chain(
    client: &ReplicaBackend,
    db: &Db,
    from: u64,
    through: u64,
    initial_tip: &str,
) -> SnapbackResult<String> {
    let mut tip = initial_tip.to_owned();
    for txid in from.saturating_add(1)..=through {
        let remote = client
            .open_ltx_file(0, TXID(txid), TXID(txid), 0, 0)
            .await
            .map_err(|error| {
                replication_error(
                    "SNAPBACK_REPLICATION_LINEAGE_DIVERGED",
                    format!("read remote LTX {txid}: {error}"),
                )
            })?;
        let local = std::fs::read(db.ltx_path(0, TXID(txid), TXID(txid))).map_err(|error| {
            replication_error(
                "SNAPBACK_REPLICATION_LINEAGE_DIVERGED",
                format!("read local LTX {txid}: {error}"),
            )
        })?;
        if remote != local {
            return Err(replication_error(
                "SNAPBACK_REPLICATION_LINEAGE_DIVERGED",
                "remote LTX bytes are not a checksum-continuous prefix of local state",
            ));
        }
        celld_ltx::ltx::decode_file(&remote).map_err(|_| {
            replication_error(
                "SNAPBACK_REPLICATION_LINEAGE_DIVERGED",
                "remote LTX segment failed its format checksum",
            )
        })?;
        tip = extend_tip(&tip, txid, &remote);
    }
    Ok(tip)
}

async fn verify_remote_head_chain(
    client: &ReplicaBackend,
    head: &ReplicationHead,
) -> SnapbackResult<()> {
    let mut tip = chain_genesis(&head.genesis_digest);
    for txid in 1..=head.position.txid {
        let bytes = client
            .open_ltx_file(0, TXID(txid), TXID(txid), 0, 0)
            .await
            .map_err(|error| {
                replication_error(
                    "SNAPBACK_REPLICATION_LINEAGE_DIVERGED",
                    format!("read head-committed remote LTX {txid}: {error}"),
                )
            })?;
        celld_ltx::ltx::decode_file(&bytes).map_err(|_| {
            replication_error(
                "SNAPBACK_REPLICATION_LINEAGE_DIVERGED",
                "a head-committed remote LTX segment failed its format checksum",
            )
        })?;
        tip = extend_tip(&tip, txid, &bytes);
    }
    if tip != head.ltx_chain_tip {
        return Err(replication_error(
            "SNAPBACK_REPLICATION_LINEAGE_DIVERGED",
            "the remote LTX lineage no longer matches the fixed authoritative head",
        ));
    }
    Ok(())
}

async fn verify_resume(
    replica: &mut Replica<ReplicaBackend>,
    head: &ReplicationHead,
) -> SnapbackResult<()> {
    let local = ReplicationPosition::from_pos(
        replica
            .db_mut()
            .expect("attached replication database")
            .pos()
            .map_err(|error| {
                replication_error(
                    "SNAPBACK_REPLICATION_ATTACH_REFUSED",
                    format!("read local LTX position: {error}"),
                )
            })?,
    );
    if local.txid < head.position.txid {
        return Err(replication_error(
            "SNAPBACK_REPLICATION_ATTACH_REFUSED",
            "local database is rewound behind the authoritative replication head",
        ));
    }
    let tip = extend_ltx_chain(
        &replica.client,
        replica.db().expect("attached replication database"),
        0,
        head.position.txid,
        &chain_genesis(&head.genesis_digest),
    )
    .await?;
    if tip != head.ltx_chain_tip {
        return Err(replication_error(
            "SNAPBACK_REPLICATION_ATTACH_REFUSED",
            "head lineage is not a checksum-continuous prefix of local state",
        ));
    }
    Ok(())
}

async fn coverage_record(
    metadata: &MetadataStore,
    generation_root: &str,
    digest: &str,
) -> SnapbackResult<CoverageRecord> {
    let object = metadata
        .get(&join_key(
            generation_root,
            &format!("coverage/{digest}.json"),
        ))
        .await?
        .ok_or_else(|| {
            replication_error(
                "SNAPBACK_REPLICATION_KEYRING_COVERAGE_INVALID",
                "head-committed keyring coverage record is missing",
            )
        })?;
    if sha256(&object.bytes) != digest {
        return Err(replication_error(
            "SNAPBACK_REPLICATION_KEYRING_COVERAGE_INVALID",
            "keyring coverage record digest does not match its key",
        ));
    }
    serde_json::from_slice(&object.bytes).map_err(|_| {
        replication_error(
            "SNAPBACK_REPLICATION_KEYRING_COVERAGE_INVALID",
            "keyring coverage record is malformed",
        )
    })
}

async fn validate_coverage_chain(
    metadata: &MetadataStore,
    generation_root: &str,
    head: &ReplicationHead,
) -> SnapbackResult<()> {
    let mut digest = Some(head.coverage_tip.clone());
    let mut last_from = u64::MAX;
    let mut seen = std::collections::BTreeSet::new();
    while let Some(current) = digest {
        if !seen.insert(current.clone()) {
            return Err(replication_error(
                "SNAPBACK_REPLICATION_KEYRING_COVERAGE_INVALID",
                "keyring coverage chain contains a cycle",
            ));
        }
        let record = coverage_record(metadata, generation_root, &current).await?;
        if record.schema_version != COVERAGE_SCHEMA
            || record.incarnation != head.incarnation
            || record.generation != head.generation
            || record.covered_from.txid >= last_from
        {
            return Err(replication_error(
                "SNAPBACK_REPLICATION_KEYRING_COVERAGE_INVALID",
                "keyring coverage chain is not a monotone generation-scoped chain",
            ));
        }
        last_from = record.covered_from.txid;
        digest = record.predecessor_digest;
    }
    Ok(())
}

async fn governing_coverage(
    metadata: &MetadataStore,
    generation_root: &str,
    head: &ReplicationHead,
    position: u64,
) -> SnapbackResult<CoverageRecord> {
    let mut digest = Some(head.coverage_tip.clone());
    while let Some(current) = digest {
        let record = coverage_record(metadata, generation_root, &current).await?;
        if record.covered_from.txid <= position {
            return Ok(record);
        }
        digest = record.predecessor_digest.clone();
    }
    Err(replication_error(
        "SNAPBACK_REPLICATION_RESTORE_KEYRING_MISSING",
        "no authenticated keyring snapshot governs the requested position",
    ))
}

async fn verify_restored_position(client: &ReplicaBackend, position: u64) -> SnapbackResult<u64> {
    let directory = tempfile::tempdir().map_err(|error| {
        replication_error(
            "SNAPBACK_REPLICATION_VERIFY_FAILED",
            format!("create restore verifier directory: {error}"),
        )
    })?;
    let database = directory.path().join("verify.sqlite3");
    celld_ltx::restore(client, &database, TXID(position))
        .await
        .map_err(|error| {
            replication_error(
                "SNAPBACK_REPLICATION_VERIFY_FAILED",
                format!("restore head position for verification: {error}"),
            )
        })?;
    integrity_and_source_version(&database)
}

fn integrity_and_source_version(database: &Path) -> SnapbackResult<u64> {
    let conn = Connection::open_with_flags(
        database,
        OpenFlags::SQLITE_OPEN_READ_ONLY
            | OpenFlags::SQLITE_OPEN_URI
            | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| {
        replication_error(
            "SNAPBACK_REPLICATION_VERIFY_FAILED",
            format!("open restored database: {error}"),
        )
    })?;
    let integrity: String = conn
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(|error| {
            replication_error(
                "SNAPBACK_REPLICATION_VERIFY_FAILED",
                format!("run restored integrity check: {error}"),
            )
        })?;
    if integrity != "ok" {
        return Err(replication_error(
            "SNAPBACK_REPLICATION_VERIFY_FAILED",
            format!("restored database integrity_check returned {integrity:?}"),
        ));
    }
    conn.query_row(
        "SELECT version FROM _snapback_version WHERE id=1",
        [],
        |row| row.get::<_, u64>(0),
    )
    .map_err(|error| {
        replication_error(
            "SNAPBACK_REPLICATION_VERIFY_FAILED",
            format!("read restored Snapback source version: {error}"),
        )
    })
}

fn local_source_version(database: &Path) -> SnapbackResult<u64> {
    let conn = Connection::open_with_flags(
        database,
        OpenFlags::SQLITE_OPEN_READ_ONLY
            | OpenFlags::SQLITE_OPEN_URI
            | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| {
        replication_error(
            "SNAPBACK_REPLICATION_DATABASE_UNAVAILABLE",
            format!("open local database for status: {error}"),
        )
    })?;
    // This short-lived status connection participates in the live WAL too.
    // Without the connection-local persistent bit, its close can checkpoint
    // the journal behind celld's shadow state even though it never writes.
    configure_connection_wal_lifetime(&conn)?;
    conn.pragma_update(None, "wal_autocheckpoint", 0)
        .map_err(|error| {
            replication_error(
                "SNAPBACK_REPLICATION_DATABASE_UNAVAILABLE",
                format!("disable status-connection WAL autocheckpoint: {error}"),
            )
        })?;
    conn.query_row(
        "SELECT version FROM _snapback_version WHERE id=1",
        [],
        |row| row.get::<_, u64>(0),
    )
    .map_err(|error| {
        replication_error(
            "SNAPBACK_REPLICATION_DATABASE_UNAVAILABLE",
            format!("read local source version: {error}"),
        )
    })
}

fn status_from_head(
    database_path: &Path,
    head: &ReplicationHead,
    local_position: Option<ReplicationPosition>,
    degraded: bool,
    error: Option<String>,
    error_detail: Option<String>,
) -> SnapbackResult<ReplicationStatus> {
    let frontier = restorable_frontier(head.position, head.keyring_coverage);
    let local_version = local_source_version(database_path).unwrap_or(head.source_version);
    Ok(ReplicationStatus {
        schema_version: STATUS_SCHEMA.to_owned(),
        enabled: true,
        incarnation: Some(head.incarnation.clone()),
        generation: Some(head.generation),
        replicated_position: Some(head.position),
        keyring_coverage: Some(head.keyring_coverage),
        frontier: Some(frontier),
        observed_lag: Some(ObservedLag {
            positions: local_position
                .unwrap_or(head.position)
                .txid
                .saturating_sub(head.position.txid),
            source_versions: local_version.saturating_sub(head.source_version),
            observed_at_ms: now_ms(),
        }),
        degraded,
        segment_encryption: head.segment_encryption.clone(),
        weaker_posture: Some(if head.segment_encryption == "provider" {
            "self-hosted single-custody G2: segments rely on provider transport/storage encryption; append/head credential separation and store-enforced immutability are absent, so a compromised host or same-generation clone can re-PUT history and seize or rewrite the head; stale-writer harmlessness is not claimed".to_owned()
        } else {
            "self-hosted single-custody G2 file target: segment objects are unencrypted and append/head credential separation plus store-enforced immutability are absent, so a compromised host or same-generation clone can re-PUT history and seize or rewrite the head; stale-writer harmlessness is not claimed".to_owned()
        }),
        error,
        error_detail,
    })
}

pub async fn inspect_status(
    database_path: &Path,
    config: Option<ReplicationConfig>,
) -> SnapbackResult<ReplicationStatus> {
    let Some(config) = config else {
        return Ok(ReplicationStatus::disabled());
    };
    let factory = config.build_factory()?;
    let metadata = factory.metadata_store();
    let Some(head_read) = metadata.get("head.json").await? else {
        let segment_encryption = config.segment_encryption().to_owned();
        return Ok(ReplicationStatus {
            enabled: true,
            degraded: true,
            error: Some("SNAPBACK_REPLICATION_HEAD_MISSING".to_owned()),
            error_detail: Some("replication head is missing".to_owned()),
            segment_encryption,
            weaker_posture: Some(
                "self-hosted single-custody G2; no authoritative head exists yet".to_owned(),
            ),
            ..ReplicationStatus::disabled()
        });
    };
    let head: ReplicationHead = serde_json::from_slice(&head_read.bytes).map_err(|_| {
        replication_error(
            "SNAPBACK_REPLICATION_METADATA_INVALID",
            "replication head is malformed",
        )
    })?;
    validate_head(&head, &config)?;
    let sidecar = read_sidecar(&sidecar_path(database_path))?;
    let local_position = sidecar.as_ref().map(|sidecar| sidecar.local_position);
    let degraded = sidecar.as_ref().is_some_and(|sidecar| sidecar.degraded);
    let error = sidecar
        .as_ref()
        .and_then(|sidecar| sidecar.halted_error.clone());
    let error_detail = sidecar.and_then(|sidecar| sidecar.halted_error_detail);
    status_from_head(
        database_path,
        &head,
        local_position,
        degraded,
        error,
        error_detail,
    )
}

pub async fn checkpoint_once(
    database_path: PathBuf,
    config: ReplicationConfig,
) -> SnapbackResult<ReplicationStatus> {
    let mut session = ReplicationSession::attach(database_path, config).await?;
    session.checkpoint().await
}

pub async fn restore_to_directory(
    output: &Path,
    requested_position: Option<u64>,
    config: ReplicationConfig,
) -> SnapbackResult<(ReplicationPosition, u64, String)> {
    match std::fs::symlink_metadata(output) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Ok(_) => {
            return Err(replication_error(
                "SNAPBACK_REPLICATION_RESTORE_INVALID",
                "replication restore output directory already exists",
            ));
        }
        Err(_) => {
            return Err(replication_error(
                "SNAPBACK_REPLICATION_RESTORE_INVALID",
                "replication restore output directory could not be inspected",
            ));
        }
    }
    let key = config.read_key()?;
    let factory = config.build_factory()?;
    let metadata = factory.metadata_store();
    let head_read = metadata.get("head.json").await?.ok_or_else(|| {
        replication_error(
            "SNAPBACK_REPLICATION_HEAD_MISSING",
            "replication restore has no authoritative head",
        )
    })?;
    let head: ReplicationHead = serde_json::from_slice(&head_read.bytes).map_err(|_| {
        replication_error(
            "SNAPBACK_REPLICATION_METADATA_INVALID",
            "replication head is malformed",
        )
    })?;
    validate_head(&head, &config)?;
    let frontier = restorable_frontier(head.position, head.keyring_coverage);
    let position = requested_position.unwrap_or(frontier.txid);
    if position == 0 || position > frontier.txid {
        return Err(replication_error(
            "SNAPBACK_REPLICATION_RESTORE_OUTSIDE_FRONTIER",
            format!(
                "requested position {position} is outside the restorable frontier {}",
                frontier.txid
            ),
        ));
    }
    let generation_root = generation_root(&head.incarnation, head.generation);
    let client = factory.replica_client(&generation_root);
    verify_remote_head_chain(&client, &head).await?;
    validate_coverage_chain(&metadata, &generation_root, &head).await?;
    let coverage = governing_coverage(&metadata, &generation_root, &head, position).await?;
    let keyring = decrypt_snapshot(
        &metadata,
        &generation_root,
        &head.incarnation,
        head.generation,
        &coverage.snapshot_digest,
        &key,
    )
    .await?;
    std::fs::create_dir(output).map_err(|error| {
        replication_error(
            "SNAPBACK_REPLICATION_RESTORE_INVALID",
            format!("create restore output: {error}"),
        )
    })?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        std::fs::set_permissions(output, std::fs::Permissions::from_mode(0o700)).map_err(
            |error| {
                replication_error(
                    "SNAPBACK_REPLICATION_RESTORE_INVALID",
                    format!("protect restore output: {error}"),
                )
            },
        )?;
    }
    // @ref LLP 0188#6-restore-composes-with-llp-0057s-declared-restore — publish
    // the quarantine declaration before the database image. Every partial
    // failure after this point therefore remains non-servable, while a complete
    // image reuses the existing LLP 0057 bulk-revocation startup transaction.
    let declaration = crate::auth::lifecycle::RestoreDeclaration::fresh();
    let declaration_path =
        crate::auth::lifecycle::restore_declaration_path(&output.join("database.sqlite3"))?;
    crate::secure_file::write_new_owner_only(&declaration_path, &declaration.to_bytes()?).map_err(
        |error| {
            replication_error(
                "SNAPBACK_REPLICATION_RESTORE_INVALID",
                format!("write restore quarantine declaration: {error}"),
            )
        },
    )?;
    sync_parent(&declaration_path)?;
    let database = output.join("database.sqlite3");
    celld_ltx::restore(&client, &database, TXID(position))
        .await
        .map_err(|error| {
            replication_error(
                "SNAPBACK_REPLICATION_RESTORE_INVALID",
                format!("restore LTX database: {error}"),
            )
        })?;
    let source_version = integrity_and_source_version(&database)?;
    let keyring_path = AuthKeyringStore::keyring_path(&database);
    crate::secure_file::write_new_owner_only(&keyring_path, &keyring).map_err(|error| {
        replication_error(
            "SNAPBACK_REPLICATION_RESTORE_KEYRING_INVALID",
            format!("write restored keyring: {error}"),
        )
    })?;
    validate_restored_keyring_pair(&database)?;
    sync_parent(&keyring_path)?;
    Ok((
        ReplicationPosition {
            txid: position,
            post_apply_checksum: 0,
        },
        source_version,
        declaration.declaration_id().to_owned(),
    ))
}

fn validate_restored_keyring_pair(database: &Path) -> SnapbackResult<()> {
    use crate::auth::crypto::AuthKeyId;
    use crate::storage::LocalDatabase;

    let store = AuthKeyringStore::file_for_database(database);
    let bytes = store.validated_file_bytes().map_err(|_| {
        replication_error(
            "SNAPBACK_REPLICATION_RESTORE_KEYRING_INVALID",
            "restored keyring did not validate",
        )
    })?;
    let catalog = LocalDatabase::inspect_auth_catalog_file_read_only(database).map_err(|_| {
        replication_error(
            "SNAPBACK_REPLICATION_RESTORE_KEYRING_INVALID",
            "restored database auth catalog is not an exact recognized catalog",
        )
    })?;
    if catalog == crate::storage::auth::AuthCatalogState::Uninitialized {
        return Ok(());
    }
    let key_ids = LocalDatabase::auth_retained_key_ids_file_read_only(database)
        .map_err(|_| {
            replication_error(
                "SNAPBACK_REPLICATION_RESTORE_KEYRING_INVALID",
                "restored database retained invalid auth key references",
            )
        })?
        .into_iter()
        .map(|value| {
            AuthKeyId::parse(&value).map_err(|_| {
                replication_error(
                    "SNAPBACK_REPLICATION_RESTORE_KEYRING_INVALID",
                    "restored database retained invalid auth key references",
                )
            })
        })
        .collect::<SnapbackResult<Vec<_>>>()?;
    if !bytes.contains_all(&key_ids).map_err(|_| {
        replication_error(
            "SNAPBACK_REPLICATION_RESTORE_KEYRING_INVALID",
            "restored keyring could not be checked against retained auth references",
        )
    })? {
        return Err(replication_error(
            "SNAPBACK_REPLICATION_RESTORE_KEYRING_MISSING",
            "restored keyring is missing a key id retained by encrypted auth state",
        ));
    }
    Ok(())
}

enum RuntimeCommand {
    Shutdown(std::sync::mpsc::Sender<SnapbackResult<ReplicationStatus>>),
}

pub struct ReplicationRuntime {
    commands: std::sync::mpsc::Sender<RuntimeCommand>,
    join: Option<std::thread::JoinHandle<()>>,
    status: Arc<Mutex<ReplicationStatus>>,
}

impl ReplicationRuntime {
    pub async fn start(database_path: PathBuf, config: ReplicationConfig) -> SnapbackResult<Self> {
        let (commands, receiver) = std::sync::mpsc::channel();
        let (ready_send, ready_receive) = std::sync::mpsc::channel();
        let status = Arc::new(Mutex::new(ReplicationStatus::disabled()));
        let shared_status = status.clone();
        let interval = config.interval;
        let join = std::thread::Builder::new()
            .name("snapback-replication".to_owned())
            .spawn(move || {
                let runtime = match tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                {
                    Ok(runtime) => runtime,
                    Err(error) => {
                        let _ = ready_send.send(Err(replication_error(
                            "SNAPBACK_REPLICATION_RUNTIME_FAILED",
                            format!("create replication runtime: {error}"),
                        )));
                        return;
                    }
                };
                let mut session =
                    match runtime.block_on(ReplicationSession::attach(database_path, config)) {
                        Ok(session) => session,
                        Err(error) => {
                            let _ = ready_send.send(Err(error));
                            return;
                        }
                    };
                let initial = session.status();
                if let Ok(value) = &initial {
                    *shared_status
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner()) = value.clone();
                }
                let _ = ready_send.send(initial);
                loop {
                    match receiver.recv_timeout(interval) {
                        Ok(RuntimeCommand::Shutdown(reply)) => {
                            let result = runtime.block_on(session.checkpoint());
                            if let Err(error) = &result {
                                session.record_halt(error);
                            }
                            if let Ok(value) = &result {
                                *shared_status
                                    .lock()
                                    .unwrap_or_else(|poisoned| poisoned.into_inner()) =
                                    value.clone();
                            }
                            let _ = reply.send(result);
                            break;
                        }
                        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                            match runtime.block_on(session.ship_once()) {
                                Ok(value) => {
                                    *shared_status
                                        .lock()
                                        .unwrap_or_else(|poisoned| poisoned.into_inner()) = value;
                                }
                                Err(error) => {
                                    session.record_halt(&error);
                                    let mut value = session
                                        .status()
                                        .unwrap_or_else(|_| ReplicationStatus::disabled());
                                    value.degraded = true;
                                    value.error = Some(error.diagnostic.code.clone());
                                    value.error_detail = Some(error.diagnostic.message.clone());
                                    *shared_status
                                        .lock()
                                        .unwrap_or_else(|poisoned| poisoned.into_inner()) = value;
                                    if replication_failure_is_terminal(&error) {
                                        break;
                                    }
                                }
                            }
                        }
                        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                    }
                }
            })
            .map_err(|error| {
                replication_error(
                    "SNAPBACK_REPLICATION_RUNTIME_FAILED",
                    format!("start replication thread: {error}"),
                )
            })?;
        let ready = tokio::task::spawn_blocking(move || ready_receive.recv())
            .await
            .map_err(|error| {
                replication_error(
                    "SNAPBACK_REPLICATION_RUNTIME_FAILED",
                    format!("join replication startup: {error}"),
                )
            })?
            .map_err(|_| {
                replication_error(
                    "SNAPBACK_REPLICATION_RUNTIME_FAILED",
                    "replication thread exited before startup completed",
                )
            })??;
        *status
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = ready;
        Ok(Self {
            commands,
            join: Some(join),
            status,
        })
    }

    pub fn status(&self) -> ReplicationStatus {
        self.status
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    pub async fn shutdown(mut self) -> SnapbackResult<ReplicationStatus> {
        let (send, receive) = std::sync::mpsc::channel();
        self.commands
            .send(RuntimeCommand::Shutdown(send))
            .map_err(|_| {
                replication_error(
                    "SNAPBACK_REPLICATION_RUNTIME_FAILED",
                    "replication runtime already stopped",
                )
            })?;
        let result = tokio::task::spawn_blocking(move || receive.recv())
            .await
            .map_err(|error| {
                replication_error(
                    "SNAPBACK_REPLICATION_RUNTIME_FAILED",
                    format!("join replication shutdown: {error}"),
                )
            })?
            .map_err(|_| {
                replication_error(
                    "SNAPBACK_REPLICATION_RUNTIME_FAILED",
                    "replication runtime exited during shutdown",
                )
            })?;
        if let Some(join) = self.join.take() {
            let _ = tokio::task::spawn_blocking(move || join.join()).await;
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::crypto::OsRandom;
    use crate::manifest::{
        HandlerInput, MutationPlan, MutationStep, ReturnValue, SchemaManifest, TableManifest,
        ValueExpr,
    };
    use crate::storage::LocalDatabase;
    use serde_json::Value;
    use std::collections::BTreeMap;

    fn file_config(root: &Path, key_file: &Path) -> ReplicationConfig {
        let root = root.to_path_buf();
        ReplicationConfig {
            target_digest: sha256(format!("file:{}", root.display()).as_bytes()),
            target: TargetConfig::File { root },
            key_file: key_file.to_path_buf(),
            interval: Duration::from_millis(10),
        }
    }

    fn write_replication_key(path: &Path) {
        crate::secure_file::write_new_owner_only(path, &[0x5a; KEY_BYTES]).unwrap();
    }

    fn initialize_database(path: &Path, with_keyring: bool) {
        drop(LocalDatabase::open(path).unwrap());
        if with_keyring {
            AuthKeyringStore::file_for_database(path)
                .load_or_mint_initial(1_000, &OsRandom)
                .unwrap();
        }
    }

    #[test]
    fn frontier_is_minimum_of_database_and_keyring_coverage() {
        let database = ReplicationPosition {
            txid: 11,
            post_apply_checksum: 101,
        };
        let keyring = ReplicationPosition {
            txid: 7,
            post_apply_checksum: 99,
        };
        assert_eq!(restorable_frontier(database, keyring), keyring);
        assert_eq!(restorable_frontier(keyring, database), keyring);
    }

    #[test]
    fn missing_operator_key_file_refuses_enablement() {
        let directory = tempfile::tempdir().unwrap();
        let config = file_config(
            &directory.path().join("remote"),
            &directory.path().join("missing.key"),
        );
        let error = config.read_key().unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_REPLICATION_KEY_INVALID");
    }

    #[tokio::test]
    async fn missing_local_keyring_refuses_first_attach() {
        let directory = tempfile::tempdir().unwrap();
        let database = directory.path().join("database.sqlite3");
        let key_file = directory.path().join("replication.key");
        initialize_database(&database, false);
        write_replication_key(&key_file);
        let error = ReplicationSession::attach(
            database,
            file_config(&directory.path().join("remote"), &key_file),
        )
        .await
        .err()
        .expect("missing keyring must refuse attach");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_REPLICATION_KEYRING_MISSING"
        );
    }

    #[tokio::test]
    async fn wrong_operator_key_refuses_resume() {
        let directory = tempfile::tempdir().unwrap();
        let remote = directory.path().join("remote");
        let key_file = directory.path().join("replication.key");
        let wrong_key_file = directory.path().join("wrong-replication.key");
        let database = directory.path().join("database.sqlite3");
        initialize_database(&database, true);
        write_replication_key(&key_file);
        let config = file_config(&remote, &key_file);
        let mut session = ReplicationSession::attach(database.clone(), config)
            .await
            .unwrap();
        session.ship_once().await.unwrap();
        drop(session);

        crate::secure_file::write_new_owner_only(&wrong_key_file, &[0xa5; KEY_BYTES]).unwrap();
        let error = ReplicationSession::attach(database, file_config(&remote, &wrong_key_file))
            .await
            .err()
            .expect("wrong snapshot key must refuse resume");
        assert_eq!(error.diagnostic.code, "SNAPBACK_REPLICATION_KEY_INVALID");
    }

    #[tokio::test]
    async fn foreign_sidecar_and_rewound_copy_refuse_resume() {
        let directory = tempfile::tempdir().unwrap();
        let remote = directory.path().join("remote");
        let key_file = directory.path().join("replication.key");
        let primary = directory.path().join("primary.sqlite3");
        write_replication_key(&key_file);
        initialize_database(&primary, true);
        let config = file_config(&remote, &key_file);
        let mut session = ReplicationSession::attach(primary.clone(), config.clone())
            .await
            .unwrap();
        let status = session.ship_once().await.unwrap();
        assert!(status.frontier.unwrap().txid > 0);

        let foreign = directory.path().join("foreign.sqlite3");
        initialize_database(&foreign, true);
        let mut foreign_sidecar = read_sidecar(&sidecar_path(&primary)).unwrap().unwrap();
        foreign_sidecar.incarnation = Uuid::new_v4().to_string();
        write_sidecar(&sidecar_path(&foreign), &foreign_sidecar, true).unwrap();
        let error = ReplicationSession::attach(foreign, config.clone())
            .await
            .err()
            .expect("foreign sidecar must refuse attach");
        assert_eq!(error.diagnostic.code, "SNAPBACK_REPLICATION_ATTACH_REFUSED");

        let rewound = directory.path().join("rewound.sqlite3");
        std::fs::copy(&primary, &rewound).unwrap();
        std::fs::copy(
            AuthKeyringStore::keyring_path(&primary),
            AuthKeyringStore::keyring_path(&rewound),
        )
        .unwrap();
        let matching_sidecar = read_sidecar(&sidecar_path(&primary)).unwrap().unwrap();
        write_sidecar(&sidecar_path(&rewound), &matching_sidecar, true).unwrap();
        let error = ReplicationSession::attach(rewound, config)
            .await
            .err()
            .expect("rewound database must refuse attach");
        assert_eq!(error.diagnostic.code, "SNAPBACK_REPLICATION_ATTACH_REFUSED");
    }

    #[tokio::test]
    async fn file_client_restores_database_with_exact_governing_keyring() {
        let directory = tempfile::tempdir().unwrap();
        let remote = directory.path().join("remote");
        let key_file = directory.path().join("replication.key");
        let database = directory.path().join("source.sqlite3");
        let restore = directory.path().join("restore");
        write_replication_key(&key_file);
        initialize_database(&database, true);
        let config = file_config(&remote, &key_file);
        let original_keyring = read_keyring(&database).unwrap();
        let mut session = ReplicationSession::attach(database, config.clone())
            .await
            .unwrap();
        let status = session.ship_once().await.unwrap();
        let frontier = status.frontier.unwrap();
        drop(session);

        let (restored, _, _) = restore_to_directory(&restore, None, config).await.unwrap();
        assert_eq!(restored.txid, frontier.txid);
        assert_eq!(
            read_keyring(&restore.join("database.sqlite3")).unwrap(),
            original_keyring
        );
        assert_eq!(
            integrity_and_source_version(&restore.join("database.sqlite3")).unwrap(),
            local_source_version(&restore.join("database.sqlite3")).unwrap()
        );
        assert!(restore.join("restore-declaration.json").is_file());
    }

    #[tokio::test]
    async fn degraded_sidecar_and_status_preserve_underlying_error_detail() {
        let directory = tempfile::tempdir().unwrap();
        let remote = directory.path().join("remote");
        let key_file = directory.path().join("replication.key");
        let database = directory.path().join("source.sqlite3");
        write_replication_key(&key_file);
        initialize_database(&database, true);
        let config = file_config(&remote, &key_file);

        let mut session = ReplicationSession::attach(database.clone(), config.clone())
            .await
            .unwrap();
        let error = replication_error(
            "SNAPBACK_REPLICATION_CAPTURE_FAILED",
            "capture WAL as LTX: EOF",
        );
        session.record_halt(&error);
        drop(session);

        let sidecar = read_sidecar(&sidecar_path(&database)).unwrap().unwrap();
        assert_eq!(
            sidecar.halted_error.as_deref(),
            Some("SNAPBACK_REPLICATION_CAPTURE_FAILED")
        );
        assert_eq!(
            sidecar.halted_error_detail.as_deref(),
            Some("capture WAL as LTX: EOF")
        );

        let status = inspect_status(&database, Some(config)).await.unwrap();
        assert!(status.degraded);
        assert_eq!(
            status.error.as_deref(),
            Some("SNAPBACK_REPLICATION_CAPTURE_FAILED")
        );
        assert_eq!(
            status.error_detail.as_deref(),
            Some("capture WAL as LTX: EOF")
        );
    }

    #[tokio::test]
    async fn server_attached_file_replica_sustains_writes_and_restores_final_frontier() {
        let directory = tempfile::tempdir().unwrap();
        let remote = directory.path().join("remote");
        let key_file = directory.path().join("replication.key");
        let database = directory.path().join("source.sqlite3");
        let restore = directory.path().join("restore");
        write_replication_key(&key_file);

        let mut db = LocalDatabase::open(&database).unwrap();
        db.schema_seed()
            .apply_schema(SchemaManifest {
                schema_hash: Some("replication-sustained-writes-v1".to_owned()),
                tables: vec![
                serde_json::from_value::<TableManifest>(serde_json::json!({
                    "name": "replication_rows",
                    "fields": [{ "name": "payload", "field_type": "String", "optional": false }],
                    "indexes": [],
                    "syncable": false
                }))
                .unwrap(),
            ],
                ..SchemaManifest::default()
            })
            .unwrap();
        AuthKeyringStore::file_for_database(&database)
            .load_or_mint_initial(1_000, &OsRandom)
            .unwrap();

        let config = file_config(&remote, &key_file);
        let runtime = ReplicationRuntime::start(database.clone(), config.clone())
            .await
            .unwrap();
        let plan = MutationPlan {
            owner_write_checks: Vec::new(),
            steps: vec![MutationStep::Insert {
                table: "replication_rows".to_owned(),
                values: BTreeMap::from([(
                    "payload".to_owned(),
                    ValueExpr::Literal(Value::String("x".repeat(4096))),
                )]),
                bind_id_as: None,
            }],
            return_value: Some(ReturnValue::ChangedCount),
        };
        let mut source_version = 0;
        for _ in 0..100 {
            source_version = db
                .mutation_writes()
                .execute_mutation(&plan, &HandlerInput::default())
                .unwrap()
                .output
                .version;
            tokio::time::sleep(Duration::from_millis(2)).await;
        }

        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        let converged = loop {
            let status = runtime.status();
            if status.frontier.is_some_and(|frontier| frontier.txid > 1)
                && status
                    .observed_lag
                    .as_ref()
                    .is_some_and(|lag| lag.source_versions == 0)
                && !status.degraded
            {
                break status;
            }
            assert!(
                tokio::time::Instant::now() < deadline,
                "replication did not converge after sustained writes: {status:?}"
            );
            tokio::time::sleep(Duration::from_millis(20)).await;
        };
        assert!(converged.frontier.unwrap().txid > 1);

        let final_status = runtime.shutdown().await.unwrap();
        drop(db);
        let (restored_position, restored_version, _) =
            restore_to_directory(&restore, None, config).await.unwrap();
        assert_eq!(restored_position, final_status.frontier.unwrap());
        assert_eq!(restored_version, source_version);
        assert_eq!(
            integrity_and_source_version(&restore.join("database.sqlite3")).unwrap(),
            source_version
        );
    }
}
