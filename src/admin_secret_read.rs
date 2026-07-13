//! Reset-bounded, least-privilege leases for administrative reads that can
//! return application data.
//!
//! The minting root is an in-process capability, not a bearer string. It can
//! therefore be handed to trusted operator tooling without creating an HTTP
//! credential that app-origin code could replay. Only the derived lease token
//! is carried on requests, and the registry retains only its SHA-256 digest.
//!
//! @ref LLP 0039#protocol-obligations-deferred-to-implementation — the lease
//!   root stays operator-plane-only; derived authority is opaque, scoped,
//!   short-lived, reset-bounded, and atomically row/byte-budgeted.

use crate::diagnostic::{SnapbackError, SnapbackResult};
use sha2::{Digest, Sha256};
use std::collections::{BTreeSet, HashMap};
use std::fmt;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use uuid::Uuid;

/// The only HTTP carrier accepted for a derived secret-read lease.
pub const SECRET_READ_LEASE_HEADER: &str = "x-snapback-secret-read-lease";

const MAX_LEASE_TTL: Duration = Duration::from_secs(15 * 60);
const MAX_LEASE_SCOPES: usize = 64;
const MAX_SCOPE_NAME_BYTES: usize = 256;
const MAX_LEASE_ROWS: u64 = 100_000;
const MAX_LEASE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_ACTIVE_LEASES: usize = 4_096;

/// A response namespace a lease may reveal. There is intentionally no
/// wildcard variant: every table, function, or fixed surface is named.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum SecretReadScope {
    AdminInspect,
    Receipts,
    Table(String),
    FunctionRun(String),
    FunctionExplain(String),
}

impl SecretReadScope {
    fn validate(&self) -> SnapbackResult<()> {
        match self {
            Self::AdminInspect | Self::Receipts => Ok(()),
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
