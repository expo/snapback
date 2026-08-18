//! Reset-bounded, least-privilege leases for administrative reads that can
//! return application data.
//!
//! The registry minting root remains an in-process capability, never an HTTP
//! bearer. Ready-file operator tooling reaches it through a separate owner-only
//! proof root: a startup-bound, fresh, one-shot HMAC authorizes exactly one
//! canonical bounded request. Only that proof and the derived lease cross HTTP;
//! the root never does, and the lease registry retains only token digests.
//!
//! @ref LLP 0039#protocol-obligations-deferred-to-implementation — the lease
//!   root stays operator-plane-only; derived authority is opaque, scoped,
//!   short-lived, reset-bounded, and atomically row/byte-budgeted.

use crate::diagnostic::{SnapbackError, SnapbackResult};
use anyhow::Context as _;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeSet, HashMap};
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use uuid::Uuid;

/// The only HTTP carrier accepted for a derived secret-read lease.
pub const SECRET_READ_LEASE_HEADER: &str = "x-snapback-secret-read-lease";

const MAX_LEASE_TTL: Duration = Duration::from_secs(15 * 60);
const MAX_LEASE_SCOPES: usize = 64;
const MAX_SCOPE_NAME_BYTES: usize = 256;
const MAX_LEASE_ROWS: u64 = 100_000;
const MAX_LEASE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_ACTIVE_LEASES: usize = 4_096;
const MAX_MINT_PROOF_AGE_MS: u64 = 30_000;
const MAX_MINT_PROOF_FUTURE_SKEW_MS: u64 = 5_000;
const MAX_MINT_PROOF_NONCE_BYTES: usize = 96;
const MAX_MINT_PROOF_REPLAYS: usize = 4_096;
const MINT_PROOF_DOMAIN: &[u8] = b"snapback/admin-secret-read/mint-proof/v1\0";

/// A response namespace a lease may reveal. There is intentionally no
/// wildcard variant: every table, function, or fixed surface is named.
#[derive(Clone, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SecretReadScope {
    AdminInspect,
    Receipts,
    TelemetryEvents,
    TelemetryExport,
    ErrorsIssue,
    Table(String),
    FunctionRun(String),
    FunctionExplain(String),
}

impl SecretReadScope {
    fn validate(&self) -> SnapbackResult<()> {
        match self {
            Self::AdminInspect
            | Self::Receipts
            | Self::TelemetryEvents
            | Self::TelemetryExport
            | Self::ErrorsIssue => Ok(()),
            Self::Table(name) | Self::FunctionRun(name) | Self::FunctionExplain(name) => {
                if name.trim().is_empty() || name.contains('*') || name.len() > MAX_SCOPE_NAME_BYTES
                {
                    Err(invalid_lease(
                        "secret-read scopes must name one bounded table or function and cannot contain wildcards",
                    ))
                } else {
                    Ok(())
                }
            }
        }
    }
}

/// Bounded authority requested by trusted operator-plane code.
#[derive(Clone, Debug)]
pub struct SecretReadLeaseRequest {
    pub scopes: BTreeSet<SecretReadScope>,
    pub ttl: Duration,
    pub row_budget: u64,
    pub byte_budget: u64,
}

impl SecretReadLeaseRequest {
    fn validate(&self) -> SnapbackResult<()> {
        if self.scopes.is_empty() || self.scopes.len() > MAX_LEASE_SCOPES {
            return Err(invalid_lease(format!(
                "secret-read leases require 1..={MAX_LEASE_SCOPES} explicit scopes"
            )));
        }
        for scope in &self.scopes {
            scope.validate()?;
        }
        if self.ttl.is_zero() || self.ttl > MAX_LEASE_TTL {
            return Err(invalid_lease(
                "secret-read lease TTL must be positive and no more than 15 minutes",
            ));
        }
        if self.row_budget == 0 || self.row_budget > MAX_LEASE_ROWS {
            return Err(invalid_lease(format!(
                "secret-read row budget must be in 1..={MAX_LEASE_ROWS}"
            )));
        }
        if self.byte_budget == 0 || self.byte_budget > MAX_LEASE_BYTES {
            return Err(invalid_lease(format!(
                "secret-read byte budget must be in 1..={MAX_LEASE_BYTES}"
            )));
        }
        Ok(())
    }
}

/// The derived bearer returned to trusted operator tooling. Debug output is
/// deliberately redacted, and the type is not serializable.
pub struct SecretReadLease {
    bearer: String,
}

impl SecretReadLease {
    pub fn bearer(&self) -> &str {
        &self.bearer
    }

    pub(crate) fn into_bearer(self) -> String {
        self.bearer
    }
}

/// Canonical bounded lease request carried inside a mint proof. Unlike the
/// process-local request type, this shape has an unambiguous JSON encoding for
/// signing across the CLI/server process boundary.
#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SecretReadMintSpec {
    pub scopes: BTreeSet<SecretReadScope>,
    pub ttl_ms: u64,
    pub row_budget: u64,
    pub byte_budget: u64,
}

impl SecretReadMintSpec {
    fn lease_request(&self) -> SnapbackResult<SecretReadLeaseRequest> {
        let request = SecretReadLeaseRequest {
            scopes: self.scopes.clone(),
            ttl: Duration::from_millis(self.ttl_ms),
            row_budget: self.row_budget,
            byte_budget: self.byte_budget,
        };
        request.validate()?;
        Ok(request)
    }
}

/// One-shot proof that the caller read the ready-file sibling root. The root
/// itself is never an HTTP field; only this operation-specific HMAC crosses
/// the network boundary.
#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SecretReadMintProof {
    pub startup_nonce: String,
    pub nonce: String,
    pub issued_at_ms: u64,
    pub mac: String,
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SecretReadMintEnvelope {
    pub lease: SecretReadMintSpec,
    pub proof: SecretReadMintProof,
}

/// Owner-only, ready-file-relative signing root. It is deliberately neither
/// cloneable, debug-printable, nor serializable.
pub(crate) struct SecretReadProofRoot {
    secret: [u8; 32],
}

impl Drop for SecretReadProofRoot {
    fn drop(&mut self) {
        self.secret.fill(0);
    }
}

/// The only value a handler may use to mint. Middleware creates it after the
/// ordinary AdminWrite floor and the distinct proof/replay gate both pass.
#[derive(Clone)]
pub(crate) struct VerifiedSecretReadMint {
    request: SecretReadLeaseRequest,
}

/// HTTP bridge retained only by a serve process that successfully resolved an
/// owner-only root next to its ready descriptor.
pub(crate) struct SecretReadMintBridge {
    operator: SecretReadOperator,
    proof_root: SecretReadProofRoot,
    startup_nonce: String,
    replayed: Mutex<HashMap<[u8; 32], u64>>,
    wall_clock_ms: Arc<dyn Fn() -> u64 + Send + Sync>,
}

impl SecretReadMintBridge {
    pub(crate) fn new(
        operator: SecretReadOperator,
        proof_root: SecretReadProofRoot,
        startup_nonce: String,
    ) -> Self {
        Self::new_with_clock(operator, proof_root, startup_nonce, Arc::new(unix_time_ms))
    }

    fn new_with_clock(
        operator: SecretReadOperator,
        proof_root: SecretReadProofRoot,
        startup_nonce: String,
        wall_clock_ms: Arc<dyn Fn() -> u64 + Send + Sync>,
    ) -> Self {
        Self {
            operator,
            proof_root,
            startup_nonce,
            replayed: Mutex::new(HashMap::new()),
            wall_clock_ms,
        }
    }

    pub(crate) fn verify_and_claim(
        &self,
        envelope: &SecretReadMintEnvelope,
    ) -> SnapbackResult<VerifiedSecretReadMint> {
        let request = envelope.lease.lease_request()?;
        let proof = &envelope.proof;
        if proof.startup_nonce != self.startup_nonce {
            return Err(mint_proof_error(
                "SNAPBACK_ADMIN_SECRET_READ_PROOF_STARTUP_MISMATCH",
                "the mint proof is not bound to this server startup",
            ));
        }
        if !proof.nonce.starts_with("sbrp_")
            || proof.nonce.len() > MAX_MINT_PROOF_NONCE_BYTES
            || !proof.nonce.is_ascii()
        {
            return Err(mint_proof_invalid());
        }
        let now = (self.wall_clock_ms)();
        if proof.issued_at_ms > now.saturating_add(MAX_MINT_PROOF_FUTURE_SKEW_MS)
            || now.saturating_sub(proof.issued_at_ms) > MAX_MINT_PROOF_AGE_MS
        {
            return Err(mint_proof_error(
                "SNAPBACK_ADMIN_SECRET_READ_PROOF_STALE",
                "the mint proof is outside the accepted freshness window",
            ));
        }
        let supplied = decode_mac(&proof.mac).ok_or_else(mint_proof_invalid)?;
        let message = canonical_mint_message(&envelope.lease, proof)?;
        let mut mac = Hmac::<Sha256>::new_from_slice(&self.proof_root.secret)
            .expect("HMAC accepts a 32-byte key");
        mac.update(&message);
        mac.verify_slice(&supplied)
            .map_err(|_| mint_proof_invalid())?;

        let nonce_digest = digest(proof.nonce.as_bytes());
        let mut replayed = self
            .replayed
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        replayed.retain(|_, expires_at| *expires_at > now);
        if replayed.contains_key(&nonce_digest) {
            return Err(mint_proof_error(
                "SNAPBACK_ADMIN_SECRET_READ_PROOF_REPLAYED",
                "the one-shot mint proof has already been used",
            ));
        }
        if replayed.len() >= MAX_MINT_PROOF_REPLAYS {
            return Err(mint_proof_error(
                "SNAPBACK_ADMIN_SECRET_READ_PROOF_CAPACITY_EXCEEDED",
                "the mint proof replay fence is at capacity",
            ));
        }
        replayed.insert(
            nonce_digest,
            proof
                .issued_at_ms
                .saturating_add(MAX_MINT_PROOF_AGE_MS)
                .saturating_add(MAX_MINT_PROOF_FUTURE_SKEW_MS),
        );
        Ok(VerifiedSecretReadMint { request })
    }

    pub(crate) fn mint(&self, verified: VerifiedSecretReadMint) -> SnapbackResult<SecretReadLease> {
        self.operator.mint(verified.request)
    }
}

/// Mechanical sibling used by both serve and CLI validation. A URL-only CLI
/// path has no descriptor and therefore no way to derive or read this file.
pub fn secret_read_root_sibling(path: &Path) -> PathBuf {
    let mut name = path
        .file_name()
        .map(|name| name.to_os_string())
        .unwrap_or_default();
    name.push(".secret-read-root");
    path.with_file_name(name)
}

pub(crate) fn resolve_secret_read_proof_root_with_io<ReadFile, WriteFile>(
    path: &Path,
    read_file: ReadFile,
    write_file: WriteFile,
) -> anyhow::Result<SecretReadProofRoot>
where
    ReadFile: Fn(&Path) -> std::io::Result<Vec<u8>>,
    WriteFile: Fn(&Path, &[u8]) -> std::io::Result<()>,
{
    match read_file(path) {
        Ok(bytes) => parse_secret_read_proof_root(&bytes)
            .with_context(|| format!("invalid secret-read root file {}", path.display())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let root = SecretReadProofRoot {
                secret: random_secret(),
            };
            write_file(path, format_secret_read_proof_root(&root).as_bytes())
                .with_context(|| format!("failed to write secret-read root {}", path.display()))?;
            Ok(root)
        }
        Err(error) => Err(error)
            .with_context(|| format!("failed to read secret-read root {}", path.display())),
    }
}

pub(crate) fn read_secret_read_proof_root(path: &Path) -> anyhow::Result<SecretReadProofRoot> {
    let bytes = crate::secure_file::read_owner_only(path)
        .with_context(|| format!("failed to read secret-read root {}", path.display()))?;
    parse_secret_read_proof_root(&bytes)
        .with_context(|| format!("invalid secret-read root file {}", path.display()))
}

pub(crate) fn sign_secret_read_mint(
    root: &SecretReadProofRoot,
    lease: SecretReadMintSpec,
    startup_nonce: String,
    issued_at_ms: u64,
    nonce: String,
) -> SnapbackResult<SecretReadMintEnvelope> {
    lease.lease_request()?;
    let mut proof = SecretReadMintProof {
        startup_nonce,
        nonce,
        issued_at_ms,
        mac: String::new(),
    };
    let message = canonical_mint_message(&lease, &proof)?;
    let mut mac = Hmac::<Sha256>::new_from_slice(&root.secret).expect("HMAC accepts a 32-byte key");
    mac.update(&message);
    proof.mac = format!("sbrm_{}", encode_hex(&mac.finalize().into_bytes()));
    Ok(SecretReadMintEnvelope { lease, proof })
}

impl fmt::Debug for SecretReadLease {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SecretReadLease([REDACTED])")
    }
}

/// A successful lookup, bound to the token digest and reset generation. The
/// registry revalidates both while reserving budgets; authorization and charge
/// can therefore never race each other into an overdraw.
pub struct SecretReadPermit {
    digest: [u8; 32],
    reset_generation: u64,
}

struct LeaseRecord {
    scopes: BTreeSet<SecretReadScope>,
    expires_at: Instant,
    reset_generation: u64,
    remaining_rows: u64,
    remaining_bytes: u64,
}

struct RegistryState {
    root_digest: [u8; 32],
    leases: HashMap<[u8; 32], LeaseRecord>,
}

/// Cloneable request-side registry. It contains no minting authority and no
/// raw derived bearer.
#[derive(Clone)]
pub struct SecretReadLeaseRegistry {
    state: Arc<Mutex<RegistryState>>,
    reset_generation: Arc<AtomicU64>,
    clock: Arc<dyn Fn() -> Instant + Send + Sync>,
}

/// Non-cloneable operator-plane capability. This is the only type that can
/// mint leases; neither the durable admin token nor a derived lease can be
/// supplied in its place.
pub struct SecretReadOperator {
    registry: SecretReadLeaseRegistry,
    root: SecretReadRoot,
}

struct SecretReadRoot {
    secret: [u8; 32],
}

impl Drop for SecretReadRoot {
    fn drop(&mut self) {
        self.secret.fill(0);
    }
}

impl SecretReadLeaseRegistry {
    /// Build a request-side registry and its distinct, in-process minting
    /// capability. The caller decides whether to retain the operator half.
    pub fn new(reset_generation: Arc<AtomicU64>) -> (Self, SecretReadOperator) {
        Self::new_with_clock(reset_generation, Arc::new(Instant::now))
    }

    /// Drop all process-local lease records after a committed app reset. The
    /// reset generation is the authority fence; eager clearing also releases
    /// capacity and makes the post-commit boundary explicit.
    pub(crate) fn clear_after_committed_reset(&self) {
        self.lock_state().leases.clear();
    }

    fn new_with_clock(
        reset_generation: Arc<AtomicU64>,
        clock: Arc<dyn Fn() -> Instant + Send + Sync>,
    ) -> (Self, SecretReadOperator) {
        let secret = random_secret();
        let registry = Self {
            state: Arc::new(Mutex::new(RegistryState {
                root_digest: digest(&secret),
                leases: HashMap::new(),
            })),
            reset_generation,
            clock,
        };
        let operator = SecretReadOperator {
            registry: registry.clone(),
            root: SecretReadRoot { secret },
        };
        (registry, operator)
    }

    /// Authenticate a derived bearer without consuming budget. Missing,
    /// unknown, expired, and reset-invalidated tokens intentionally share one
    /// diagnostic so the registry is not a credential oracle.
    pub fn authorize(&self, bearer: Option<&str>) -> SnapbackResult<SecretReadPermit> {
        let bearer = bearer
            .map(str::trim)
            .filter(|bearer| !bearer.is_empty())
            .ok_or_else(secret_read_required)?;
        let token_digest = digest(bearer.as_bytes());
        let reset_generation = self.reset_generation.load(Ordering::Acquire);
        let now = (self.clock)();
        let mut state = self.lock_state();
        let valid = state.leases.get(&token_digest).is_some_and(|record| {
            record.reset_generation == reset_generation && now < record.expires_at
        });
        if !valid {
            state.leases.remove(&token_digest);
            return Err(secret_read_required());
        }
        Ok(SecretReadPermit {
            digest: token_digest,
            reset_generation,
        })
    }

    /// Pre-effect admission for every scope known before handler execution.
    /// This deliberately consumes no budget; the complete captured scope set
    /// and serialized response are still revalidated and charged atomically
    /// after successful work.
    pub fn authorize_scopes(
        &self,
        bearer: Option<&str>,
        required_scopes: &BTreeSet<SecretReadScope>,
    ) -> SnapbackResult<SecretReadPermit> {
        if required_scopes.is_empty() {
            return Err(scope_denied());
        }
        let permit = self.authorize(bearer)?;
        let current_generation = self.reset_generation.load(Ordering::Acquire);
        let now = (self.clock)();
        let mut state = self.lock_state();
        let Some(record) = state.leases.get(&permit.digest) else {
            return Err(secret_read_required());
        };
        if permit.reset_generation != current_generation
            || record.reset_generation != current_generation
            || now >= record.expires_at
        {
            state.leases.remove(&permit.digest);
            return Err(secret_read_required());
        }
        if !required_scopes.is_subset(&record.scopes) {
            return Err(scope_denied());
        }
        Ok(permit)
    }

    /// Atomically validate scope and reserve both budgets for a complete
    /// response. A failure deducts neither budget, so concurrent requests
    /// cannot each pass a stale pre-check and collectively overdraw the lease.
    pub fn reserve(
        &self,
        permit: &SecretReadPermit,
        required_scopes: &BTreeSet<SecretReadScope>,
        rows: u64,
        bytes: u64,
    ) -> SnapbackResult<()> {
        if required_scopes.is_empty() {
            return Err(scope_denied());
        }
        let current_generation = self.reset_generation.load(Ordering::Acquire);
        let now = (self.clock)();
        let mut state = self.lock_state();
        let Some(record) = state.leases.get_mut(&permit.digest) else {
            return Err(secret_read_required());
        };
        if permit.reset_generation != current_generation
            || record.reset_generation != current_generation
            || now >= record.expires_at
        {
            state.leases.remove(&permit.digest);
            return Err(secret_read_required());
        }
        if !required_scopes.is_subset(&record.scopes) {
            return Err(scope_denied());
        }
        if rows > record.remaining_rows || bytes > record.remaining_bytes {
            return Err(budget_exhausted());
        }
        record.remaining_rows -= rows;
        record.remaining_bytes -= bytes;
        Ok(())
    }

    fn mint(
        &self,
        root: &SecretReadRoot,
        request: SecretReadLeaseRequest,
    ) -> SnapbackResult<SecretReadLease> {
        request.validate()?;
        let mut state = self.lock_state();
        if !constant_time_eq(&state.root_digest, &digest(&root.secret)) {
            return Err(SnapbackError::error(
                "SNAPBACK_ADMIN_SECRET_READ_MINT_DENIED",
                "admin-secret-read",
                "secret-read leases may only be minted by the operator plane",
            ));
        }
        let now = (self.clock)();
        let generation = self.reset_generation.load(Ordering::Acquire);
        state
            .leases
            .retain(|_, record| record.reset_generation == generation && now < record.expires_at);
        if state.leases.len() >= MAX_ACTIVE_LEASES {
            return Err(SnapbackError::error(
                "SNAPBACK_ADMIN_SECRET_READ_LEASE_CAPACITY_EXCEEDED",
                "admin-secret-read",
                "the active secret-read lease limit has been reached",
            ));
        }
        let bearer = format!("sbrl_{}", Uuid::new_v4().simple());
        let token_digest = digest(bearer.as_bytes());
        state.leases.insert(
            token_digest,
            LeaseRecord {
                scopes: request.scopes,
                expires_at: now + request.ttl,
                reset_generation: generation,
                remaining_rows: request.row_budget,
                remaining_bytes: request.byte_budget,
            },
        );
        Ok(SecretReadLease { bearer })
    }

    fn lock_state(&self) -> std::sync::MutexGuard<'_, RegistryState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

impl SecretReadOperator {
    /// Mint a short-lived derived lease entirely in process. The root
    /// capability is never returned or accepted by an HTTP handler.
    pub fn mint(&self, request: SecretReadLeaseRequest) -> SnapbackResult<SecretReadLease> {
        self.registry.mint(&self.root, request)
    }
}

fn random_secret() -> [u8; 32] {
    let first = Uuid::new_v4();
    let second = Uuid::new_v4();
    let mut secret = [0_u8; 32];
    secret[..16].copy_from_slice(first.as_bytes());
    secret[16..].copy_from_slice(second.as_bytes());
    secret
}

fn digest(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

fn constant_time_eq(left: &[u8; 32], right: &[u8; 32]) -> bool {
    left.iter()
        .zip(right)
        .fold(0_u8, |diff, (left, right)| diff | (left ^ right))
        == 0
}

fn unix_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| u64::try_from(duration.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

fn canonical_mint_message(
    lease: &SecretReadMintSpec,
    proof: &SecretReadMintProof,
) -> SnapbackResult<Vec<u8>> {
    let lease = serde_json::to_vec(lease).map_err(|_| mint_proof_invalid())?;
    let mut message = Vec::with_capacity(
        MINT_PROOF_DOMAIN.len() + proof.startup_nonce.len() + proof.nonce.len() + lease.len() + 32,
    );
    message.extend_from_slice(MINT_PROOF_DOMAIN);
    append_proof_field(&mut message, proof.startup_nonce.as_bytes());
    append_proof_field(&mut message, proof.nonce.as_bytes());
    message.extend_from_slice(&proof.issued_at_ms.to_be_bytes());
    append_proof_field(&mut message, &lease);
    Ok(message)
}

fn append_proof_field(message: &mut Vec<u8>, value: &[u8]) {
    message.extend_from_slice(&u64::try_from(value.len()).unwrap_or(u64::MAX).to_be_bytes());
    message.extend_from_slice(value);
}

fn format_secret_read_proof_root(root: &SecretReadProofRoot) -> String {
    format!("sbrk_{}\n", encode_hex(&root.secret))
}

fn parse_secret_read_proof_root(bytes: &[u8]) -> anyhow::Result<SecretReadProofRoot> {
    let value = std::str::from_utf8(bytes)?.trim();
    let encoded = value
        .strip_prefix("sbrk_")
        .context("secret-read root has the wrong prefix")?;
    let decoded = decode_hex_32(encoded).context("secret-read root must contain 32 bytes")?;
    Ok(SecretReadProofRoot { secret: decoded })
}

fn encode_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(char::from(HEX[usize::from(byte >> 4)]));
        encoded.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    encoded
}

fn decode_mac(value: &str) -> Option<[u8; 32]> {
    decode_hex_32(value.strip_prefix("sbrm_")?)
}

fn decode_hex_32(value: &str) -> Option<[u8; 32]> {
    if value.len() != 64 {
        return None;
    }
    let mut decoded = [0_u8; 32];
    for (index, pair) in value.as_bytes().chunks_exact(2).enumerate() {
        decoded[index] = (hex_nibble(pair[0])? << 4) | hex_nibble(pair[1])?;
    }
    Some(decoded)
}

fn hex_nibble(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        _ => None,
    }
}

fn invalid_lease(message: impl Into<String>) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_ADMIN_SECRET_READ_LEASE_INVALID",
        "admin-secret-read",
        message,
    )
}

fn secret_read_required() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_ADMIN_SECRET_READ_REQUIRED",
        "admin-secret-read",
        "a valid secret-read lease is required",
    )
}

fn scope_denied() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_ADMIN_SECRET_READ_SCOPE_DENIED",
        "admin-secret-read",
        "the secret-read lease does not grant every response scope",
    )
}

fn budget_exhausted() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_ADMIN_SECRET_READ_BUDGET_EXHAUSTED",
        "admin-secret-read",
        "the complete response exceeds the lease's remaining row or byte budget",
    )
}

pub(crate) fn mint_proof_invalid() -> SnapbackError {
    mint_proof_error(
        "SNAPBACK_ADMIN_SECRET_READ_PROOF_INVALID",
        "the secret-read mint proof is invalid",
    )
}

fn mint_proof_error(code: &'static str, message: &'static str) -> SnapbackError {
    SnapbackError::error(code, "admin-secret-read", message)
}

pub(crate) fn mint_proof_required() -> SnapbackError {
    mint_proof_error(
        "SNAPBACK_ADMIN_SECRET_READ_PROOF_REQUIRED",
        "a ready-file operator mint proof is required",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local::LocalSnapback;
    use crate::manifest::{FieldManifest, FieldType, SchemaManifest, SeedData, TableManifest};
    use serde_json::json;
    use std::sync::Barrier;
    use std::thread;

    fn request(scopes: impl IntoIterator<Item = SecretReadScope>) -> SecretReadLeaseRequest {
        SecretReadLeaseRequest {
            scopes: scopes.into_iter().collect(),
            ttl: Duration::from_secs(60),
            row_budget: 5,
            byte_budget: 10,
        }
    }

    fn mint_spec() -> SecretReadMintSpec {
        SecretReadMintSpec {
            scopes: BTreeSet::from([SecretReadScope::AdminInspect]),
            ttl_ms: 60_000,
            row_budget: 5,
            byte_budget: 1_000,
        }
    }

    fn proof_root(secret: [u8; 32]) -> SecretReadProofRoot {
        SecretReadProofRoot { secret }
    }

    #[test]
    fn mint_proof_is_startup_bound_fresh_one_shot_and_root_authenticated() {
        let generation = Arc::new(AtomicU64::new(1));
        let (_registry, operator) = SecretReadLeaseRegistry::new(generation);
        let now = Arc::new(AtomicU64::new(1_000_000));
        let clock = now.clone();
        let bridge = SecretReadMintBridge::new_with_clock(
            operator,
            proof_root([7; 32]),
            "startup-a".to_owned(),
            Arc::new(move || clock.load(Ordering::Acquire)),
        );
        let signed = sign_secret_read_mint(
            &proof_root([7; 32]),
            mint_spec(),
            "startup-a".to_owned(),
            1_000_000,
            "sbrp_nonce-a".to_owned(),
        )
        .unwrap();
        let verified = bridge.verify_and_claim(&signed).unwrap();
        assert!(bridge.mint(verified).unwrap().bearer().starts_with("sbrl_"));
        assert_eq!(
            bridge
                .verify_and_claim(&signed)
                .err()
                .unwrap()
                .diagnostic
                .code,
            "SNAPBACK_ADMIN_SECRET_READ_PROOF_REPLAYED"
        );

        let wrong_root = sign_secret_read_mint(
            &proof_root([8; 32]),
            mint_spec(),
            "startup-a".to_owned(),
            1_000_000,
            "sbrp_nonce-b".to_owned(),
        )
        .unwrap();
        assert_eq!(
            bridge
                .verify_and_claim(&wrong_root)
                .err()
                .unwrap()
                .diagnostic
                .code,
            "SNAPBACK_ADMIN_SECRET_READ_PROOF_INVALID"
        );

        let startup_mismatch = sign_secret_read_mint(
            &proof_root([7; 32]),
            mint_spec(),
            "startup-b".to_owned(),
            1_000_000,
            "sbrp_nonce-c".to_owned(),
        )
        .unwrap();
        assert_eq!(
            bridge
                .verify_and_claim(&startup_mismatch)
                .err()
                .unwrap()
                .diagnostic
                .code,
            "SNAPBACK_ADMIN_SECRET_READ_PROOF_STARTUP_MISMATCH"
        );

        now.store(1_100_000, Ordering::Release);
        let stale = sign_secret_read_mint(
            &proof_root([7; 32]),
            mint_spec(),
            "startup-a".to_owned(),
            1_000_000,
            "sbrp_nonce-d".to_owned(),
        )
        .unwrap();
        assert_eq!(
            bridge
                .verify_and_claim(&stale)
                .err()
                .unwrap()
                .diagnostic
                .code,
            "SNAPBACK_ADMIN_SECRET_READ_PROOF_STALE"
        );
    }

    #[tokio::test]
    async fn mint_route_composes_admin_floor_with_distinct_one_shot_proof() {
        use axum::body::{Body, to_bytes};
        use axum::http::{Request, StatusCode, header};
        use tower::ServiceExt as _;

        let mut context = crate::admin::ServerContext::detached();
        context.admin_token = Some("ordinary-admin".to_owned());
        let (state, operator) =
            crate::admin::AppState::try_from_snapback_with_secret_read_operator(
                LocalSnapback::memory().unwrap(),
                context,
            )
            .expect("secret read app state");
        let bridge = SecretReadMintBridge::new_with_clock(
            operator,
            proof_root([19; 32]),
            "startup-a".to_owned(),
            Arc::new(|| 1_000_000),
        );
        let app = crate::server::app(state.with_secret_read_mint_bridge(bridge));
        let mint_request = |body: serde_json::Value, admin: Option<&str>, console: Option<&str>| {
            let mut request = Request::builder()
                .method("POST")
                .uri("/_snapback/api/admin-secret-read/mint")
                .header(header::CONTENT_TYPE, "application/json");
            if let Some(admin) = admin {
                request = request.header("x-snapback-admin-token", admin);
            }
            if let Some(console) = console {
                request = request.header("x-snapback-console-credential", console);
            }
            request.body(Body::from(body.to_string())).unwrap()
        };
        let diagnostic =
            |value: &serde_json::Value| value["diagnostic"]["code"].as_str().unwrap().to_owned();
        async fn json(response: axum::response::Response) -> serde_json::Value {
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap()
        }

        let admin_only = app
            .clone()
            .oneshot(mint_request(
                serde_json::json!({}),
                Some("ordinary-admin"),
                None,
            ))
            .await
            .unwrap();
        assert_eq!(admin_only.status(), StatusCode::FORBIDDEN);
        assert_eq!(
            diagnostic(&json(admin_only).await),
            "SNAPBACK_ADMIN_SECRET_READ_PROOF_INVALID"
        );

        let console_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/_snapback/api/console/credential")
                    .header("x-snapback-admin-token", "ordinary-admin")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let console = json(console_response).await["credential"]
            .as_str()
            .unwrap()
            .to_owned();
        let console_only = app
            .clone()
            .oneshot(mint_request(serde_json::json!({}), None, Some(&console)))
            .await
            .unwrap();
        assert_eq!(console_only.status(), StatusCode::FORBIDDEN);

        let signed = |root: [u8; 32], startup: &str, issued: u64, nonce: &str| {
            serde_json::to_value(
                sign_secret_read_mint(
                    &proof_root(root),
                    mint_spec(),
                    startup.to_owned(),
                    issued,
                    nonce.to_owned(),
                )
                .unwrap(),
            )
            .unwrap()
        };
        for (body, code) in [
            (
                signed([20; 32], "startup-a", 1_000_000, "sbrp_wrong"),
                "SNAPBACK_ADMIN_SECRET_READ_PROOF_INVALID",
            ),
            (
                signed([19; 32], "startup-b", 1_000_000, "sbrp_startup"),
                "SNAPBACK_ADMIN_SECRET_READ_PROOF_STARTUP_MISMATCH",
            ),
            (
                signed([19; 32], "startup-a", 900_000, "sbrp_stale"),
                "SNAPBACK_ADMIN_SECRET_READ_PROOF_STALE",
            ),
        ] {
            let response = app
                .clone()
                .oneshot(mint_request(body, Some("ordinary-admin"), None))
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::FORBIDDEN);
            assert_eq!(diagnostic(&json(response).await), code);
        }

        let valid = signed([19; 32], "startup-a", 1_000_000, "sbrp_valid");
        let no_admin = app
            .clone()
            .oneshot(mint_request(valid.clone(), None, None))
            .await
            .unwrap();
        assert_eq!(no_admin.status(), StatusCode::UNAUTHORIZED);

        let success = app
            .clone()
            .oneshot(mint_request(valid.clone(), Some("ordinary-admin"), None))
            .await
            .unwrap();
        assert_eq!(success.status(), StatusCode::OK);
        assert_eq!(
            success.headers()[header::CACHE_CONTROL],
            "no-store, private"
        );
        let success_body = json(success).await;
        assert_eq!(success_body.as_object().unwrap().len(), 1);
        assert!(success_body["lease"].as_str().unwrap().starts_with("sbrl_"));

        let replay = app
            .oneshot(mint_request(valid, Some("ordinary-admin"), None))
            .await
            .unwrap();
        assert_eq!(replay.status(), StatusCode::FORBIDDEN);
        assert_eq!(
            diagnostic(&json(replay).await),
            "SNAPBACK_ADMIN_SECRET_READ_PROOF_REPLAYED"
        );
    }

    #[test]
    fn bearer_is_opaque_redacted_and_admin_token_is_not_a_lease() {
        let generation = Arc::new(AtomicU64::new(1));
        let (registry, operator) = SecretReadLeaseRegistry::new(generation);
        let lease = operator
            .mint(request([SecretReadScope::AdminInspect]))
            .unwrap();
        assert!(lease.bearer().starts_with("sbrl_"));
        assert_eq!(format!("{lease:?}"), "SecretReadLease([REDACTED])");
        assert!(registry.authorize(Some("ordinary-admin-token")).is_err());
        assert!(registry.authorize(Some(lease.bearer())).is_ok());
    }

    #[test]
    fn mint_refuses_empty_and_wildcard_scopes() {
        let generation = Arc::new(AtomicU64::new(1));
        let (_registry, operator) = SecretReadLeaseRegistry::new(generation);
        assert!(operator.mint(request([])).is_err());
        assert!(
            operator
                .mint(request([SecretReadScope::Table("*".to_owned())]))
                .is_err()
        );
        assert!(
            operator
                .mint(request([SecretReadScope::FunctionRun(
                    "x".repeat(MAX_SCOPE_NAME_BYTES + 1),
                )]))
                .is_err()
        );
    }

    #[test]
    fn scope_rows_and_bytes_are_reserved_together() {
        let generation = Arc::new(AtomicU64::new(1));
        let (registry, operator) = SecretReadLeaseRegistry::new(generation);
        let scope = SecretReadScope::Table("messages".to_owned());
        let lease = operator.mint(request([scope.clone()])).unwrap();
        let permit = registry.authorize(Some(lease.bearer())).unwrap();
        assert!(
            registry
                .reserve(&permit, &[scope.clone()].into_iter().collect(), 3, 7)
                .is_ok()
        );
        let error = registry
            .reserve(&permit, &[scope].into_iter().collect(), 1, 4)
            .unwrap_err();
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_ADMIN_SECRET_READ_BUDGET_EXHAUSTED"
        );
    }

    #[test]
    fn concurrent_reservations_cannot_overdraw() {
        let generation = Arc::new(AtomicU64::new(1));
        let (registry, operator) = SecretReadLeaseRegistry::new(generation);
        let scope = SecretReadScope::Table("messages".to_owned());
        let lease = operator.mint(request([scope.clone()])).unwrap();
        let barrier = Arc::new(Barrier::new(3));
        let mut workers = Vec::new();
        for _ in 0..2 {
            let registry = registry.clone();
            let bearer = lease.bearer().to_owned();
            let scope = scope.clone();
            let barrier = barrier.clone();
            workers.push(thread::spawn(move || {
                let permit = registry.authorize(Some(&bearer)).unwrap();
                barrier.wait();
                registry.reserve(&permit, &[scope].into_iter().collect(), 3, 3)
            }));
        }
        barrier.wait();
        let successes = workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .filter(Result::is_ok)
            .count();
        assert_eq!(successes, 1);
    }

    #[test]
    fn reset_generation_invalidates_existing_lease() {
        let generation = Arc::new(AtomicU64::new(7));
        let (registry, operator) = SecretReadLeaseRegistry::new(generation.clone());
        let lease = operator
            .mint(request([SecretReadScope::AdminInspect]))
            .unwrap();
        generation.fetch_add(1, Ordering::AcqRel);
        assert!(registry.authorize(Some(lease.bearer())).is_err());
    }

    #[test]
    fn monotonic_expiry_is_enforced() {
        let generation = Arc::new(AtomicU64::new(1));
        let base = Instant::now();
        let offset_ms = Arc::new(AtomicU64::new(0));
        let clock_offset = offset_ms.clone();
        let (registry, operator) = SecretReadLeaseRegistry::new_with_clock(
            generation,
            Arc::new(move || base + Duration::from_millis(clock_offset.load(Ordering::Acquire))),
        );
        let mut request = request([SecretReadScope::AdminInspect]);
        request.ttl = Duration::from_millis(1);
        let lease = operator.mint(request).unwrap();
        offset_ms.store(2, Ordering::Release);
        assert!(registry.authorize(Some(lease.bearer())).is_err());
    }

    #[test]
    fn active_lease_capacity_is_bounded_and_stale_entries_are_pruned() {
        let generation = Arc::new(AtomicU64::new(1));
        let (registry, operator) = SecretReadLeaseRegistry::new(generation.clone());
        let now = (registry.clock)();
        {
            let mut state = registry.lock_state();
            for index in 0..MAX_ACTIVE_LEASES {
                let token_digest = digest(format!("lease-{index}").as_bytes());
                state.leases.insert(
                    token_digest,
                    LeaseRecord {
                        scopes: BTreeSet::from([SecretReadScope::AdminInspect]),
                        expires_at: now + Duration::from_secs(60),
                        reset_generation: 1,
                        remaining_rows: 1,
                        remaining_bytes: 1,
                    },
                );
            }
        }
        let error = operator
            .mint(request([SecretReadScope::AdminInspect]))
            .unwrap_err();
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_ADMIN_SECRET_READ_LEASE_CAPACITY_EXCEEDED"
        );

        generation.fetch_add(1, Ordering::AcqRel);
        assert!(
            operator
                .mint(request([SecretReadScope::AdminInspect]))
                .is_ok(),
            "a reset generation must prune stale authority before capacity admission"
        );
    }

    #[test]
    fn committed_reset_invalidates_but_rejected_reset_preserves_a_lease() {
        let mut snapback = LocalSnapback::memory().unwrap();
        snapback
            .apply_schema(SchemaManifest {
                tables: vec![TableManifest {
                    name: "items".to_owned(),
                    fields: vec![FieldManifest {
                        name: "value".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    }],
                    indexes: Vec::new(),
                    syncable: false,
                    permission_backing: false,
                    permission_fields: None,
                    search_indexes: Vec::new(),
                    vector_indexes: Vec::new(),
                    search_live_limits: None,
                    membership: None,
                    authority_profile: None,
                    asset_sharing: None,
                    visibility: None,
                    history: None,
                }],
                ..SchemaManifest::default()
            })
            .unwrap();
        let reset_generation = snapback.read_lane().secret_read_reset_generation();
        let (registry, operator) = SecretReadLeaseRegistry::new(reset_generation);
        let lease = operator
            .mint(request([SecretReadScope::Table("items".to_owned())]))
            .unwrap();

        let invalid_seed: SeedData = serde_json::from_value(json!({
            "tables": { "items": [{ "_id": "bad", "value": null }] }
        }))
        .unwrap();
        assert!(snapback.reset_with_seed(Some(invalid_seed)).is_err());
        assert!(
            registry.authorize(Some(lease.bearer())).is_ok(),
            "a rejected transactional reset must preserve existing leases"
        );

        snapback.reset_with_seed(None).unwrap();
        assert!(
            registry.authorize(Some(lease.bearer())).is_err(),
            "the committed reset boundary must invalidate the lease"
        );
    }
}
