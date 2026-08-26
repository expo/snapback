//! Versioned auth-code keyring storage and rotation.

// @ref LLP 0057#keyring-protocol — format-1 keyrings are closed, owner-only, atomically replaced deployment sidecars.
// @ref LLP 0057#concurrency-locks-and-linearization — the keyring lock spans revalidation, rotation, and digest-key use.

use std::collections::BTreeSet;
use std::ffi::OsString;
use std::fmt;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use serde::{Deserialize, Serialize};
use zeroize::{Zeroize as _, Zeroizing};

use super::crypto::{
    AuthKeyId, AuthKeyMaterial, CryptoError, RandomSource, StepUpProof, decode_canonical_base64url,
    encode_base64url,
};
use crate::process_bound_identity::ProcessBoundIdentity;

pub const AUTH_KEYRING_FORMAT_VERSION: u32 = 1;
pub const AUTH_KEYRING_MAXIMUM_BYTES: usize = 64 * 1024;
pub const AUTH_KEYRING_MAXIMUM_KEYS: usize = 64;
pub const AUTH_KEY_ROTATION_AGE_MS: u64 = 30 * 24 * 60 * 60 * 1_000;
pub const AUTH_RETIRED_KEY_MINIMUM_AGE_MS: u64 = 24 * 60 * 60 * 1_000;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const KEY_ALGORITHM: &str = "hmac-sha256";
const TEMP_CANDIDATE_ATTEMPTS: usize = 3;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyringError {
    Missing,
    MissingKey,
    Corrupt,
    Unavailable,
}

impl fmt::Display for KeyringError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Missing => "auth keyring is missing",
            Self::MissingKey => "auth keyring does not contain the required key",
            Self::Corrupt => "auth keyring is corrupt",
            Self::Unavailable => "auth keyring is unavailable",
        })
    }
}

impl std::error::Error for KeyringError {}

impl From<CryptoError> for KeyringError {
    fn from(_: CryptoError) -> Self {
        Self::Unavailable
    }
}

/// Non-secret health/maintenance facts. The active key id is deliberately
/// absent because key ids are excluded from diagnostics by the Spec.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KeyringSummary {
    pub format_version: u32,
    pub key_count: usize,
    pub active_created_at_ms: u64,
}

/// Exact validated file bytes retained for the quiesced backup seam.
pub struct ValidatedKeyringBytes(Zeroizing<Vec<u8>>);

impl ValidatedKeyringBytes {
    pub fn expose_secret(&self) -> &[u8] {
        &self.0
    }

    /// Prove that every retained challenge reference is present in these exact
    /// captured bytes. Physical backup must not reopen the keyring path for
    /// this check: an external replacement could otherwise validate ring B
    /// while publishing previously retained ring A.
    pub fn contains_all(&self, key_ids: &[AuthKeyId]) -> Result<bool, KeyringError> {
        let ring = parse_ring(self.expose_secret())?;
        Ok(key_ids.iter().all(|key_id| ring.find(key_id).is_some()))
    }
}

impl fmt::Debug for ValidatedKeyringBytes {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("ValidatedKeyringBytes([REDACTED])")
    }
}

/// A serialized file backend or a process-local in-memory backend. Every
/// operation holds this mutex through key selection/use, and file-backed
/// operations reopen and validate the complete current file on every call.
pub struct AuthKeyringStore {
    backend: Mutex<Backend>,
    /// Exact process/keyring instance used to mint provider-bound step-up
    /// carriers. A second wrapper around the same file is deliberately a
    /// different origin: only the provider installed into the serving graph
    /// may authorize consumption.
    identity: ProcessBoundIdentity,
}

/// Powerless identity installed into one database before it can consume a
/// step-up proof. It can be copied for comparison but cannot mint a carrier.
///
/// @ref LLP 0303#corollary--the-artifact-must-carry-provenance-not-just-type
/// — consumption verifies the exact provider/keyring instance that produced
/// the proof, not merely a caller-writable key id.
#[derive(Clone)]
pub struct AuthProviderStepUpBinding(ProcessBoundIdentity);

impl fmt::Debug for AuthProviderStepUpBinding {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("AuthProviderStepUpBinding(..)")
    }
}

impl AuthProviderStepUpBinding {
    pub(crate) fn matches(&self, other: &Self) -> bool {
        self.0 == other.0
    }
}

impl PartialEq for AuthProviderStepUpBinding {
    fn eq(&self, other: &Self) -> bool {
        self.matches(other)
    }
}

impl Eq for AuthProviderStepUpBinding {}

/// Provider-held minting owner. The binding may leave the provider; this owner
/// does not. A fresh provider, even over the same keyring file, receives a
/// distinct origin and cannot mint a carrier accepted by the installed graph.
pub struct AuthProviderStepUpOwner {
    keyring_identity: ProcessBoundIdentity,
    binding: AuthProviderStepUpBinding,
}

impl fmt::Debug for AuthProviderStepUpOwner {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("AuthProviderStepUpOwner(..)")
    }
}

/// A proof admitted by one exact provider after its referenced key was found
/// in that provider's keyring. The durable challenge row remains the one-shot
/// predecessor; the origin binding prevents a caller-created keyring from
/// making a matching row and proof authoritative.
#[derive(Clone, Eq, PartialEq)]
pub struct ProviderBoundStepUpProof {
    binding: AuthProviderStepUpBinding,
    proof: StepUpProof,
}

impl fmt::Debug for ProviderBoundStepUpProof {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("ProviderBoundStepUpProof([REDACTED])")
    }
}

impl ProviderBoundStepUpProof {
    pub fn proof(&self) -> &StepUpProof {
        &self.proof
    }

    pub(crate) fn matches_provider(&self, expected: &AuthProviderStepUpBinding) -> bool {
        self.binding.matches(expected)
    }
}

enum Backend {
    Memory { ring: Option<Keyring> },
    File { path: PathBuf },
}

impl fmt::Debug for AuthKeyringStore {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("AuthKeyringStore([REDACTED])")
    }
}

impl AuthKeyringStore {
    pub fn in_memory() -> Self {
        Self {
            backend: Mutex::new(Backend::Memory { ring: None }),
            identity: ProcessBoundIdentity::new(),
        }
    }

    pub fn file_for_database(database_path: &Path) -> Self {
        Self::file_at_path(Self::keyring_path(database_path))
    }

    pub fn file_at_path(path: PathBuf) -> Self {
        Self {
            backend: Mutex::new(Backend::File { path }),
            identity: ProcessBoundIdentity::new(),
        }
    }

    /// Claim a fresh provider origin for this exact keyring instance. The
    /// resulting owner stays private inside `AuthProvider`; only its powerless
    /// binding is installed into the serving database.
    pub fn claim_step_up_provider_origin(&self) -> AuthProviderStepUpOwner {
        AuthProviderStepUpOwner {
            keyring_identity: self.identity.clone(),
            binding: AuthProviderStepUpBinding(ProcessBoundIdentity::new()),
        }
    }

    pub fn step_up_provider_binding(
        &self,
        owner: &AuthProviderStepUpOwner,
    ) -> Result<AuthProviderStepUpBinding, KeyringError> {
        if owner.keyring_identity != self.identity {
            return Err(KeyringError::Unavailable);
        }
        Ok(owner.binding.clone())
    }

    /// Admit a proof only through the exact provider owner and only while the
    /// proof's key id is a member of this keyring. The transaction later
    /// compares the carrier origin with the database-installed binding and
    /// verifies/consumes the provider-minted durable challenge.
    pub fn bind_step_up_proof(
        &self,
        owner: &AuthProviderStepUpOwner,
        proof: StepUpProof,
    ) -> Result<ProviderBoundStepUpProof, KeyringError> {
        if owner.keyring_identity != self.identity {
            return Err(KeyringError::Unavailable);
        }
        let key_id = proof.key_id().ok_or(KeyringError::MissingKey)?;
        self.with_key(key_id, |_| ())?;
        Ok(ProviderBoundStepUpProof {
            binding: owner.binding.clone(),
            proof,
        })
    }

    pub fn keyring_path(database_path: &Path) -> PathBuf {
        let mut value = OsString::from(database_path.as_os_str());
        value.push(".auth-keyring.json");
        PathBuf::from(value)
    }

    pub fn load_existing(&self) -> Result<KeyringSummary, KeyringError> {
        let backend = self.lock()?;
        match &*backend {
            Backend::Memory { ring } => ring
                .as_ref()
                .ok_or(KeyringError::Missing)
                .and_then(Keyring::summary),
            Backend::File { path } => load_file(path).and_then(|loaded| loaded.ring.summary()),
        }
    }

    /// Load a valid existing ring or mint format 1 only when the destination
    /// is absent. An existing invalid file is never overwritten.
    pub fn load_or_mint_initial(
        &self,
        now_ms: u64,
        random: &dyn RandomSource,
    ) -> Result<KeyringSummary, KeyringError> {
        validate_now(now_ms)?;
        let mut backend = self.lock()?;
        match &mut *backend {
            Backend::Memory { ring } => {
                if ring.is_none() {
                    *ring = Some(Keyring::initial(now_ms, random)?);
                }
                ring.as_ref().expect("ring was initialized").summary()
            }
            Backend::File { path } => match load_file(path) {
                Ok(loaded) => loaded.ring.summary(),
                Err(KeyringError::Missing) => {
                    let ring = Keyring::initial(now_ms, random)?;
                    publish_file(path, &ring, None, true, random)?;
                    ring.summary()
                }
                Err(error) => Err(error),
            },
        }
    }

    /// Revalidate/rotate and use the active key without copying key bytes out
    /// of the keyring lock.
    pub fn with_active_key<T>(
        &self,
        now_ms: u64,
        random: &dyn RandomSource,
        operation: impl FnOnce(&AuthKeyId, &AuthKeyMaterial) -> T,
    ) -> Result<T, KeyringError> {
        validate_now(now_ms)?;
        let mut backend = self.lock()?;
        match &mut *backend {
            Backend::Memory { ring } => {
                let ring = ring.as_mut().ok_or(KeyringError::Missing)?;
                ring.rotate_if_due(now_ms, random)?;
                let active = ring.active()?;
                Ok(operation(&active.id, &active.material))
            }
            Backend::File { path } => {
                let mut loaded = load_file(path)?;
                if loaded.ring.rotate_if_due(now_ms, random)? {
                    publish_file(
                        path,
                        &loaded.ring,
                        Some(loaded.bytes.expose_secret()),
                        false,
                        random,
                    )?;
                }
                let active = loaded.ring.active()?;
                Ok(operation(&active.id, &active.material))
            }
        }
    }

    /// Look up a referenced retired/active key while retaining the keyring
    /// lock. Absence is a provider failure, never an invalid-code result.
    pub fn with_key<T>(
        &self,
        key_id: &AuthKeyId,
        operation: impl FnOnce(&AuthKeyMaterial) -> T,
    ) -> Result<T, KeyringError> {
        let backend = self.lock()?;
        match &*backend {
            Backend::Memory { ring } => {
                let ring = ring.as_ref().ok_or(KeyringError::Missing)?;
                let entry = ring.find(key_id).ok_or(KeyringError::MissingKey)?;
                Ok(operation(&entry.material))
            }
            Backend::File { path } => {
                let loaded = load_file(path)?;
                let entry = loaded.ring.find(key_id).ok_or(KeyringError::MissingKey)?;
                Ok(operation(&entry.material))
            }
        }
    }

    pub fn rotate_if_due(
        &self,
        now_ms: u64,
        random: &dyn RandomSource,
    ) -> Result<bool, KeyringError> {
        validate_now(now_ms)?;
        let mut backend = self.lock()?;
        match &mut *backend {
            Backend::Memory { ring } => ring
                .as_mut()
                .ok_or(KeyringError::Missing)?
                .rotate_if_due(now_ms, random),
            Backend::File { path } => {
                let mut loaded = load_file(path)?;
                let rotated = loaded.ring.rotate_if_due(now_ms, random)?;
                if rotated {
                    publish_file(
                        path,
                        &loaded.ring,
                        Some(loaded.bytes.expose_secret()),
                        false,
                        random,
                    )?;
                }
                Ok(rotated)
            }
        }
    }

    /// Prune keys only after their 24-hour floor and after the storage layer
    /// proves no retained keyed auth record references the id.
    pub fn prune_retired(
        &self,
        now_ms: u64,
        random: &dyn RandomSource,
        mut is_referenced: impl FnMut(&AuthKeyId) -> Result<bool, KeyringError>,
    ) -> Result<usize, KeyringError> {
        validate_now(now_ms)?;
        let mut backend = self.lock()?;
        match &mut *backend {
            Backend::Memory { ring } => ring
                .as_mut()
                .ok_or(KeyringError::Missing)?
                .prune_retired(now_ms, &mut is_referenced),
            Backend::File { path } => {
                let mut loaded = load_file(path)?;
                let removed = loaded.ring.prune_retired(now_ms, &mut is_referenced)?;
                if removed > 0 {
                    publish_file(
                        path,
                        &loaded.ring,
                        Some(loaded.bytes.expose_secret()),
                        false,
                        random,
                    )?;
                }
                Ok(removed)
            }
        }
    }

    pub fn validated_file_bytes(&self) -> Result<ValidatedKeyringBytes, KeyringError> {
        let backend = self.lock()?;
        match &*backend {
            Backend::Memory { .. } => Err(KeyringError::Unavailable),
            Backend::File { path } => load_file(path).map(|loaded| loaded.bytes),
        }
    }

    fn lock(&self) -> Result<MutexGuard<'_, Backend>, KeyringError> {
        self.backend.lock().map_err(|_| KeyringError::Unavailable)
    }
}

struct LoadedKeyring {
    ring: Keyring,
    bytes: ValidatedKeyringBytes,
}

struct Keyring {
    active_key_id: AuthKeyId,
    keys: Vec<KeyEntry>,
}

impl fmt::Debug for Keyring {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("Keyring([REDACTED])")
    }
}

struct KeyEntry {
    id: AuthKeyId,
    created_at_ms: u64,
    retired_at_ms: Option<u64>,
    material: AuthKeyMaterial,
}

impl fmt::Debug for KeyEntry {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("KeyEntry([REDACTED])")
    }
}

impl Keyring {
    fn initial(now_ms: u64, random: &dyn RandomSource) -> Result<Self, KeyringError> {
        let entry = KeyEntry {
            id: AuthKeyId::generate(random)?,
            created_at_ms: now_ms,
            retired_at_ms: None,
            material: AuthKeyMaterial::generate(random)?,
        };
        let ring = Self {
            active_key_id: entry.id.clone(),
            keys: vec![entry],
        };
        ring.validate()?;
        Ok(ring)
    }

    fn active(&self) -> Result<&KeyEntry, KeyringError> {
        self.find(&self.active_key_id)
            .filter(|entry| entry.retired_at_ms.is_none())
            .ok_or(KeyringError::Corrupt)
    }

    fn find(&self, key_id: &AuthKeyId) -> Option<&KeyEntry> {
        self.keys.iter().find(|entry| &entry.id == key_id)
    }

    fn summary(&self) -> Result<KeyringSummary, KeyringError> {
        self.validate()?;
        Ok(KeyringSummary {
            format_version: AUTH_KEYRING_FORMAT_VERSION,
            key_count: self.keys.len(),
            active_created_at_ms: self.active()?.created_at_ms,
        })
    }

    fn rotate_if_due(
        &mut self,
        now_ms: u64,
        random: &dyn RandomSource,
    ) -> Result<bool, KeyringError> {
        self.validate()?;
        let active_index = self
            .keys
            .iter()
            .position(|entry| entry.id == self.active_key_id)
            .ok_or(KeyringError::Corrupt)?;
        let active_created_at_ms = self.keys[active_index].created_at_ms;
        if now_ms < active_created_at_ms {
            return Err(KeyringError::Corrupt);
        }
        if now_ms < active_created_at_ms.saturating_add(AUTH_KEY_ROTATION_AGE_MS) {
            return Ok(false);
        }
        if self.keys.len() >= AUTH_KEYRING_MAXIMUM_KEYS {
            return Err(KeyringError::Unavailable);
        }

        let successor = self.mint_unique_entry(now_ms, random)?;
        self.keys[active_index].retired_at_ms = Some(now_ms);
        self.active_key_id = successor.id.clone();
        self.keys.push(successor);
        self.keys.sort_by(|left, right| {
            (left.created_at_ms, &left.id).cmp(&(right.created_at_ms, &right.id))
        });
        self.validate()?;
        Ok(true)
    }

    fn mint_unique_entry(
        &self,
        now_ms: u64,
        random: &dyn RandomSource,
    ) -> Result<KeyEntry, KeyringError> {
        for _ in 0..3 {
            let candidate = KeyEntry {
                id: AuthKeyId::generate(random)?,
                created_at_ms: now_ms,
                retired_at_ms: None,
                material: AuthKeyMaterial::generate(random)?,
            };
            if self.find(&candidate.id).is_none() {
                return Ok(candidate);
            }
            // `candidate` and its key material are zeroized on this continue.
        }
        Err(KeyringError::Unavailable)
    }

    fn prune_retired(
        &mut self,
        now_ms: u64,
        is_referenced: &mut impl FnMut(&AuthKeyId) -> Result<bool, KeyringError>,
    ) -> Result<usize, KeyringError> {
        self.validate()?;
        // Complete every fallible catalog lookup before mutating the ring. A
        // lookup error midway through pruning must leave memory mode intact.
        let mut remove = Vec::with_capacity(self.keys.len());
        for entry in &self.keys {
            let old_enough = entry.retired_at_ms.is_some_and(|retired_at_ms| {
                now_ms >= retired_at_ms.saturating_add(AUTH_RETIRED_KEY_MINIMUM_AGE_MS)
            });
            remove.push(old_enough && !is_referenced(&entry.id)?);
        }
        let removed = remove.iter().filter(|candidate| **candidate).count();
        if removed > 0 {
            let mut index = 0;
            self.keys.retain(|_| {
                let keep = !remove[index];
                index += 1;
                keep
            });
        }
        self.validate()?;
        Ok(removed)
    }

    fn validate(&self) -> Result<(), KeyringError> {
        if self.keys.is_empty() || self.keys.len() > AUTH_KEYRING_MAXIMUM_KEYS {
            return Err(KeyringError::Corrupt);
        }

        let mut ids = BTreeSet::new();
        let mut unretired = 0;
        let mut active_index = None;
        let mut previous_sort_key: Option<(u64, &AuthKeyId)> = None;
        let mut previous_retired_at = None;

        for (index, entry) in self.keys.iter().enumerate() {
            if entry.created_at_ms > MAX_SAFE_INTEGER || !ids.insert(entry.id.as_str()) {
                return Err(KeyringError::Corrupt);
            }
            if let Some(retired_at_ms) = entry.retired_at_ms {
                if retired_at_ms < entry.created_at_ms || retired_at_ms > MAX_SAFE_INTEGER {
                    return Err(KeyringError::Corrupt);
                }
                if previous_retired_at.is_some_and(|previous| retired_at_ms < previous) {
                    return Err(KeyringError::Corrupt);
                }
                previous_retired_at = Some(retired_at_ms);
            } else {
                unretired += 1;
            }
            if entry.id == self.active_key_id {
                active_index = Some(index);
                if entry.retired_at_ms.is_some() {
                    return Err(KeyringError::Corrupt);
                }
            }
            let sort_key = (entry.created_at_ms, &entry.id);
            if previous_sort_key.is_some_and(|previous| previous >= sort_key) {
                return Err(KeyringError::Corrupt);
            }
            previous_sort_key = Some(sort_key);
        }

        if unretired != 1 || active_index != Some(self.keys.len() - 1) {
            return Err(KeyringError::Corrupt);
        }
        for pair in self.keys.windows(2) {
            let retired_at_ms = pair[0].retired_at_ms.ok_or(KeyringError::Corrupt)?;
            if retired_at_ms > pair[1].created_at_ms {
                return Err(KeyringError::Corrupt);
            }
        }
        Ok(())
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawKeyring {
    format_version: u32,
    active_key_id: String,
    keys: Vec<RawKeyEntry>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawKeyEntry {
    id: String,
    algorithm: String,
    created_at_ms: u64,
    retired_at_ms: Option<u64>,
    material: String,
}

impl Drop for RawKeyEntry {
    fn drop(&mut self) {
        self.material.zeroize();
    }
}

#[derive(Serialize)]
struct EncodedKeyring {
    format_version: u32,
    active_key_id: String,
    keys: Vec<EncodedKeyEntry>,
}

#[derive(Serialize)]
struct EncodedKeyEntry {
    id: String,
    algorithm: &'static str,
    created_at_ms: u64,
    retired_at_ms: Option<u64>,
    material: String,
}

impl Drop for EncodedKeyEntry {
    fn drop(&mut self) {
        self.material.zeroize();
    }
}

fn parse_ring(bytes: &[u8]) -> Result<Keyring, KeyringError> {
    let raw: RawKeyring = serde_json::from_slice(bytes).map_err(|_| KeyringError::Corrupt)?;
    if raw.format_version != AUTH_KEYRING_FORMAT_VERSION
        || raw.keys.is_empty()
        || raw.keys.len() > AUTH_KEYRING_MAXIMUM_KEYS
    {
        return Err(KeyringError::Corrupt);
    }

    let active_key_id = AuthKeyId::parse(&raw.active_key_id).map_err(|_| KeyringError::Corrupt)?;
    let mut keys = Vec::with_capacity(raw.keys.len());
    for record in &raw.keys {
        if record.algorithm != KEY_ALGORITHM {
            return Err(KeyringError::Corrupt);
        }
        let id = AuthKeyId::parse(&record.id).map_err(|_| KeyringError::Corrupt)?;
        let material = decode_canonical_base64url::<32>(&record.material)
            .map_err(|_| KeyringError::Corrupt)?;
        keys.push(KeyEntry {
            id,
            created_at_ms: record.created_at_ms,
            retired_at_ms: record.retired_at_ms,
            material: AuthKeyMaterial::from_bytes(material),
        });
    }
    let ring = Keyring {
        active_key_id,
        keys,
    };
    ring.validate()?;
    Ok(ring)
}

fn serialize_ring(ring: &Keyring) -> Result<Zeroizing<Vec<u8>>, KeyringError> {
    ring.validate()?;
    let encoded = EncodedKeyring {
        format_version: AUTH_KEYRING_FORMAT_VERSION,
        active_key_id: ring.active_key_id.as_str().to_owned(),
        keys: ring
            .keys
            .iter()
            .map(|entry| EncodedKeyEntry {
                id: entry.id.as_str().to_owned(),
                algorithm: KEY_ALGORITHM,
                created_at_ms: entry.created_at_ms,
                retired_at_ms: entry.retired_at_ms,
                material: entry.material.encode_base64().to_string(),
            })
            .collect(),
    };
    let bytes = serde_json::to_vec(&encoded).map_err(|_| KeyringError::Unavailable)?;
    if bytes.len() > AUTH_KEYRING_MAXIMUM_BYTES {
        return Err(KeyringError::Corrupt);
    }
    Ok(Zeroizing::new(bytes))
}

fn load_file(path: &Path) -> Result<LoadedKeyring, KeyringError> {
    // Re-establish parent-directory durability before any visible keyring is
    // admitted for signing. If a prior rename succeeded but its parent fsync
    // was ambiguous, later operations remain unavailable until this sync
    // succeeds; pathname visibility alone never reopens issuance.
    crate::secure_file::sync_parent(path).map_err(|_| KeyringError::Unavailable)?;
    let bytes = crate::secure_file::read_strict_owner_only(path, AUTH_KEYRING_MAXIMUM_BYTES)
        .map_err(map_read_error)?;
    let bytes = ValidatedKeyringBytes(Zeroizing::new(bytes));
    let ring = parse_ring(bytes.expose_secret())?;
    Ok(LoadedKeyring { ring, bytes })
}

fn map_read_error(error: io::Error) -> KeyringError {
    if error.raw_os_error() == Some(libc::ELOOP) {
        return KeyringError::Corrupt;
    }
    match error.kind() {
        io::ErrorKind::NotFound => KeyringError::Missing,
        io::ErrorKind::PermissionDenied
        | io::ErrorKind::InvalidData
        | io::ErrorKind::Unsupported => KeyringError::Corrupt,
        _ => KeyringError::Unavailable,
    }
}

fn publish_file(
    path: &Path,
    ring: &Keyring,
    prior_bytes: Option<&[u8]>,
    initial: bool,
    random: &dyn RandomSource,
) -> Result<(), KeyringError> {
    let candidate = serialize_ring(ring)?;
    let temporary = create_temporary(path, candidate.as_ref(), random)?;

    let rename_result = if initial {
        crate::secure_file::rename_no_replace(&temporary, path)
    } else {
        std::fs::rename(&temporary, path)
    };
    if rename_result.is_err() {
        let _ = std::fs::remove_file(&temporary);
        return reconcile_ambiguous(path, prior_bytes, candidate.as_ref())
            .and(Err(KeyringError::Unavailable));
    }
    if crate::secure_file::sync_parent(path).is_err() {
        return reconcile_ambiguous(path, prior_bytes, candidate.as_ref())
            .and(Err(KeyringError::Unavailable));
    }
    // Only a complete, strict, candidate-equal destination becomes the
    // in-memory view used by the triggering operation.
    reconcile_ambiguous(path, None, candidate.as_ref())?;
    Ok(())
}

fn create_temporary(
    destination: &Path,
    bytes: &[u8],
    random: &dyn RandomSource,
) -> Result<PathBuf, KeyringError> {
    let parent = destination.parent().unwrap_or_else(|| Path::new("."));
    for _ in 0..TEMP_CANDIDATE_ATTEMPTS {
        let mut entropy = [0_u8; 16];
        if let Err(error) = random.fill(&mut entropy) {
            entropy.zeroize();
            return Err(error.into());
        }
        let suffix = encode_base64url(&entropy);
        entropy.zeroize();
        let path = parent.join(format!(".snapback-auth-keyring-{suffix}.tmp"));
        match crate::secure_file::write_new_owner_only(&path, bytes) {
            Ok(()) => return Ok(path),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(_) => {
                // Post-create write/fsync failures can leave candidate key
                // bytes. The create-new helper cleans its owned inode; repeat
                // defensively. Never remove an AlreadyExists path.
                let _ = std::fs::remove_file(&path);
                return Err(KeyringError::Unavailable);
            }
        }
    }
    Err(KeyringError::Unavailable)
}

fn reconcile_ambiguous(
    path: &Path,
    prior_bytes: Option<&[u8]>,
    candidate_bytes: &[u8],
) -> Result<(), KeyringError> {
    let bytes = crate::secure_file::read_strict_owner_only(path, AUTH_KEYRING_MAXIMUM_BYTES)
        .map_err(|_| KeyringError::Corrupt)?;
    let bytes = Zeroizing::new(bytes);
    let recognized = bytes.as_slice() == candidate_bytes
        || prior_bytes.is_some_and(|prior| bytes.as_slice() == prior);
    if !recognized {
        return Err(KeyringError::Corrupt);
    }
    parse_ring(&bytes)?;
    Ok(())
}

fn validate_now(now_ms: u64) -> Result<(), KeyringError> {
    if now_ms > MAX_SAFE_INTEGER {
        Err(KeyringError::Unavailable)
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU8, Ordering};

    use super::*;

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

    #[derive(Debug)]
    struct FailingRandom;

    impl RandomSource for FailingRandom {
        fn fill(&self, _destination: &mut [u8]) -> Result<(), CryptoError> {
            Err(CryptoError::RandomUnavailable)
        }
    }

    #[derive(Debug)]
    struct ZeroRandom;

    impl RandomSource for ZeroRandom {
        fn fill(&self, destination: &mut [u8]) -> Result<(), CryptoError> {
            destination.fill(0);
            Ok(())
        }
    }

    #[test]
    fn derives_exact_database_sibling() {
        assert_eq!(
            AuthKeyringStore::keyring_path(Path::new("/tmp/app.sqlite3")),
            Path::new("/tmp/app.sqlite3.auth-keyring.json")
        );
    }

    #[test]
    fn memory_ring_mints_rotates_and_prunes_without_persistence() {
        let random = CountingRandom::default();
        let store = AuthKeyringStore::in_memory();
        let initial = store.load_or_mint_initial(0, &random).unwrap();
        assert_eq!(initial.key_count, 1);
        let first_id = store
            .with_active_key(0, &random, |id, _| id.clone())
            .unwrap();
        assert!(
            !store
                .rotate_if_due(AUTH_KEY_ROTATION_AGE_MS - 1, &random)
                .unwrap()
        );
        assert!(
            store
                .rotate_if_due(AUTH_KEY_ROTATION_AGE_MS, &random)
                .unwrap()
        );
        let second_id = store
            .with_active_key(AUTH_KEY_ROTATION_AGE_MS, &random, |id, _| id.clone())
            .unwrap();
        assert_ne!(first_id, second_id);
        assert!(store.with_key(&first_id, |_| ()).is_ok());

        let prune_at = AUTH_KEY_ROTATION_AGE_MS + AUTH_RETIRED_KEY_MINIMUM_AGE_MS;
        assert_eq!(
            store
                .prune_retired(prune_at, &random, |id| Ok(id == &first_id))
                .unwrap(),
            0
        );
        assert_eq!(
            store
                .prune_retired(prune_at, &random, |_| Ok(false))
                .unwrap(),
            1
        );
        assert_eq!(
            store.with_key(&first_id, |_| ()).unwrap_err(),
            KeyringError::MissingKey
        );
        assert_eq!(
            store.validated_file_bytes().unwrap_err(),
            KeyringError::Unavailable
        );
    }

    #[test]
    fn failed_prune_preflight_leaves_memory_ring_intact() {
        let random = CountingRandom::default();
        let store = AuthKeyringStore::in_memory();
        store.load_or_mint_initial(0, &random).unwrap();
        let first_id = store
            .with_active_key(0, &random, |id, _| id.clone())
            .unwrap();
        store
            .rotate_if_due(AUTH_KEY_ROTATION_AGE_MS, &random)
            .unwrap();
        let second_id = store
            .with_active_key(AUTH_KEY_ROTATION_AGE_MS, &random, |id, _| id.clone())
            .unwrap();
        store
            .rotate_if_due(AUTH_KEY_ROTATION_AGE_MS * 2, &random)
            .unwrap();

        let mut calls = 0;
        let error = store
            .prune_retired(
                AUTH_KEY_ROTATION_AGE_MS * 2 + AUTH_RETIRED_KEY_MINIMUM_AGE_MS,
                &random,
                |_| {
                    calls += 1;
                    if calls == 2 {
                        Err(KeyringError::Unavailable)
                    } else {
                        Ok(false)
                    }
                },
            )
            .unwrap_err();
        assert_eq!(error, KeyringError::Unavailable);
        assert_eq!(calls, 2);
        assert_eq!(store.load_existing().unwrap().key_count, 3);
        assert!(store.with_key(&first_id, |_| ()).is_ok());
        assert!(store.with_key(&second_id, |_| ()).is_ok());
    }

    #[test]
    fn key_id_collision_retries_are_bounded_and_do_not_retire_active_key() {
        let store = AuthKeyringStore::in_memory();
        store.load_or_mint_initial(0, &ZeroRandom).unwrap();
        let active_before = store
            .with_active_key(0, &ZeroRandom, |id, _| id.clone())
            .unwrap();
        assert_eq!(
            store
                .rotate_if_due(AUTH_KEY_ROTATION_AGE_MS, &ZeroRandom)
                .unwrap_err(),
            KeyringError::Unavailable
        );
        assert_eq!(store.load_existing().unwrap().key_count, 1);
        let active_after = store
            .with_active_key(0, &ZeroRandom, |id, _| id.clone())
            .unwrap();
        assert_eq!(active_before, active_after);
    }

    #[cfg(unix)]
    #[test]
    fn file_ring_is_exact_0600_and_revalidates_each_operation() {
        use std::os::unix::fs::PermissionsExt as _;

        let directory = tempfile::tempdir().unwrap();
        let database = directory.path().join("app.sqlite3");
        let path = AuthKeyringStore::keyring_path(&database);
        let random = CountingRandom::default();
        let store = AuthKeyringStore::file_for_database(&database);
        store.load_or_mint_initial(10, &random).unwrap();

        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        let first_bytes = std::fs::read(&path).unwrap();
        assert!(first_bytes.len() <= AUTH_KEYRING_MAXIMUM_BYTES);
        assert_eq!(store.load_existing().unwrap().key_count, 1);

        // Mode mismatches fail closed and are not repaired in place.
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert_eq!(store.load_existing().unwrap_err(), KeyringError::Corrupt);
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o644
        );
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();

        // A replacement after a successful call cannot be hidden by a cache.
        let held = directory.path().join("held-keyring");
        std::fs::rename(&path, &held).unwrap();
        std::os::unix::fs::symlink(&held, &path).unwrap();
        assert_eq!(store.load_existing().unwrap_err(), KeyringError::Corrupt);
        assert_eq!(std::fs::read(held).unwrap(), first_bytes);
    }

    #[cfg(unix)]
    #[test]
    fn hardlinks_oversize_and_corrupt_existing_files_fail_without_overwrite() {
        use std::os::unix::fs::PermissionsExt as _;

        let directory = tempfile::tempdir().unwrap();
        let database = directory.path().join("app.sqlite3");
        let path = AuthKeyringStore::keyring_path(&database);
        let random = CountingRandom::default();
        let store = AuthKeyringStore::file_for_database(&database);

        std::fs::write(&path, b"{not-json").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        let corrupt = std::fs::read(&path).unwrap();
        assert_eq!(
            store.load_or_mint_initial(0, &random).unwrap_err(),
            KeyringError::Corrupt
        );
        assert_eq!(std::fs::read(&path).unwrap(), corrupt);

        std::fs::remove_file(&path).unwrap();
        std::fs::write(&path, vec![b'x'; AUTH_KEYRING_MAXIMUM_BYTES + 1]).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert_eq!(store.load_existing().unwrap_err(), KeyringError::Corrupt);

        std::fs::remove_file(&path).unwrap();
        store.load_or_mint_initial(0, &random).unwrap();
        let alias = directory.path().join("alias");
        std::fs::hard_link(&path, &alias).unwrap();
        assert_eq!(store.load_existing().unwrap_err(), KeyringError::Corrupt);
    }

    #[cfg(unix)]
    #[test]
    fn closed_json_and_canonical_encodings_are_enforced() {
        use std::os::unix::fs::PermissionsExt as _;

        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("ring.json");
        let store = AuthKeyringStore::file_at_path(path.clone());
        let cases = [
            r#"{"format_version":1,"active_key_id":"sbak_AAAAAAAAAAAAAAAAAAAAAA","keys":[{"id":"sbak_AAAAAAAAAAAAAAAAAAAAAA","algorithm":"hmac-sha256","created_at_ms":0,"retired_at_ms":null,"material":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}],"extra":true}"#,
            r#"{"format_version":2,"active_key_id":"sbak_AAAAAAAAAAAAAAAAAAAAAA","keys":[]}"#,
            r#"{"format_version":1,"format_version":1,"active_key_id":"sbak_AAAAAAAAAAAAAAAAAAAAAA","keys":[]}"#,
            r#"{"format_version":1,"active_key_id":"sbak_AAAAAAAAAAAAAAAAAAAAAA","keys":[{"id":"sbak_AAAAAAAAAAAAAAAAAAAAAA","algorithm":"hmac-sha256","created_at_ms":0,"retired_at_ms":null,"material":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="}]}"#,
        ];
        for contents in cases {
            std::fs::write(&path, contents).unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
            assert_eq!(store.load_existing().unwrap_err(), KeyringError::Corrupt);
        }
    }

    #[cfg(unix)]
    #[test]
    fn rotation_publishes_complete_ring_and_orphan_temp_is_ignored() {
        let directory = tempfile::tempdir().unwrap();
        let database = directory.path().join("app.sqlite3");
        let path = AuthKeyringStore::keyring_path(&database);
        let random = CountingRandom::default();
        let store = AuthKeyringStore::file_for_database(&database);
        store.load_or_mint_initial(0, &random).unwrap();
        let first_id = store
            .with_active_key(0, &random, |id, _| id.clone())
            .unwrap();

        // Simulates termination after a complete temp fsync but before rename.
        let interrupted = directory
            .path()
            .join(".snapback-auth-keyring-interrupted.tmp");
        crate::secure_file::write_new_owner_only(&interrupted, b"partial-candidate").unwrap();
        assert_eq!(store.load_existing().unwrap().key_count, 1);

        assert!(
            store
                .rotate_if_due(AUTH_KEY_ROTATION_AGE_MS, &random)
                .unwrap()
        );
        assert_eq!(store.load_existing().unwrap().key_count, 2);
        assert!(store.with_key(&first_id, |_| ()).is_ok());
        assert!(parse_ring(&std::fs::read(path).unwrap()).is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn ambiguous_publication_accepts_only_complete_prior_or_candidate_bytes() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("ring.json");
        let first_random = CountingRandom::default();
        let first = Keyring::initial(0, &first_random).unwrap();
        let prior = serialize_ring(&first).unwrap();

        let second_random = CountingRandom(AtomicU8::new(80));
        let second = Keyring::initial(1, &second_random).unwrap();
        let candidate = serialize_ring(&second).unwrap();

        crate::secure_file::write_new_owner_only(&path, prior.as_ref()).unwrap();
        assert!(reconcile_ambiguous(&path, Some(prior.as_ref()), candidate.as_ref()).is_ok());
        crate::secure_file::write_owner_only(&path, candidate.as_ref()).unwrap();
        assert!(reconcile_ambiguous(&path, Some(prior.as_ref()), candidate.as_ref()).is_ok());

        let third_random = CountingRandom(AtomicU8::new(160));
        let third = serialize_ring(&Keyring::initial(2, &third_random).unwrap()).unwrap();
        crate::secure_file::write_owner_only(&path, third.as_ref()).unwrap();
        assert_eq!(
            reconcile_ambiguous(&path, Some(prior.as_ref()), candidate.as_ref()).unwrap_err(),
            KeyringError::Corrupt
        );
    }

    #[cfg(unix)]
    #[test]
    fn rng_failure_leaves_no_initial_file() {
        let directory = tempfile::tempdir().unwrap();
        let database = directory.path().join("app.sqlite3");
        let path = AuthKeyringStore::keyring_path(&database);
        let store = AuthKeyringStore::file_for_database(&database);
        assert_eq!(
            store.load_or_mint_initial(0, &FailingRandom).unwrap_err(),
            KeyringError::Unavailable
        );
        assert!(!path.exists());
    }

    #[test]
    fn raw_format_rejects_duplicate_ids_and_nonmonotone_timestamps() {
        let duplicate = br#"{"format_version":1,"active_key_id":"sbak_AAAAAAAAAAAAAAAAAAAAAA","keys":[{"id":"sbak_AAAAAAAAAAAAAAAAAAAAAA","algorithm":"hmac-sha256","created_at_ms":0,"retired_at_ms":1,"material":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"},{"id":"sbak_AAAAAAAAAAAAAAAAAAAAAA","algorithm":"hmac-sha256","created_at_ms":1,"retired_at_ms":null,"material":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}]}"#;
        assert_eq!(parse_ring(duplicate).unwrap_err(), KeyringError::Corrupt);

        let nonmonotone = br#"{"format_version":1,"active_key_id":"sbak_AQEBAQEBAQEBAQEBAQEBAQ","keys":[{"id":"sbak_AAAAAAAAAAAAAAAAAAAAAA","algorithm":"hmac-sha256","created_at_ms":2,"retired_at_ms":3,"material":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"},{"id":"sbak_AQEBAQEBAQEBAQEBAQEBAQ","algorithm":"hmac-sha256","created_at_ms":1,"retired_at_ms":null,"material":"AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE"}]}"#;
        assert_eq!(parse_ring(nonmonotone).unwrap_err(), KeyringError::Corrupt);

        let overlapping = br#"{"format_version":1,"active_key_id":"sbak_AQEBAQEBAQEBAQEBAQEBAQ","keys":[{"id":"sbak_AAAAAAAAAAAAAAAAAAAAAA","algorithm":"hmac-sha256","created_at_ms":0,"retired_at_ms":2,"material":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"},{"id":"sbak_AQEBAQEBAQEBAQEBAQEBAQ","algorithm":"hmac-sha256","created_at_ms":1,"retired_at_ms":null,"material":"AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE"}]}"#;
        assert_eq!(parse_ring(overlapping).unwrap_err(), KeyringError::Corrupt);
    }

    #[test]
    fn debug_never_exposes_key_material_or_ids() {
        let random = CountingRandom::default();
        let store = AuthKeyringStore::in_memory();
        store.load_or_mint_initial(0, &random).unwrap();
        assert_eq!(format!("{store:?}"), "AuthKeyringStore([REDACTED])");
        let bytes = ValidatedKeyringBytes(Zeroizing::new(b"sentinel".to_vec()));
        assert_eq!(format!("{bytes:?}"), "ValidatedKeyringBytes([REDACTED])");
    }
}
