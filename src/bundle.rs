//! Snapshot bundle endpoint contract — request/response shapes, the
//! `SNAPBACK_BUNDLE_*` refusal-code registry, the pinned hard limits, the
//! `params-v1` args-mapping substitution, and the pending-registration-owner
//! bookkeeping for register mode.
//!
//! @ref LLP 0092#0d--bundle-endpoint--connection-ownership — the 0D contract
//!   this module implements: `POST /app/bundle`, modes, closed per-entry
//!   union, atomicity, limits/codes, idempotency replay-validity, and the
//!   attach-grace/reaping defaults.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::live_wire::ResumeWire;

/// Stable `SNAPBACK_BUNDLE_*` refusal-code registry (LLP 0092 §0D.2).
/// Append-only, paralleling `SNAPBACK_RESUME_*`.
pub mod code {
    pub const ROUTE_UNKNOWN: &str = "SNAPBACK_BUNDLE_ROUTE_UNKNOWN";
    pub const ENTRY_INVALID: &str = "SNAPBACK_BUNDLE_ENTRY_INVALID";
    pub const PARAMS_INVALID: &str = "SNAPBACK_BUNDLE_PARAMS_INVALID";
    pub const MODE_INVALID: &str = "SNAPBACK_BUNDLE_MODE_INVALID";
    pub const NOT_PUBLIC: &str = "SNAPBACK_BUNDLE_NOT_PUBLIC";
    pub const REGISTER_REQUIRES_CREDENTIAL: &str = "SNAPBACK_BUNDLE_REGISTER_REQUIRES_CREDENTIAL";
    pub const QUERY_FAILED: &str = "SNAPBACK_BUNDLE_QUERY_FAILED";
    pub const LIMIT_QUERIES: &str = "SNAPBACK_BUNDLE_LIMIT_QUERIES";
    pub const LIMIT_ROWS: &str = "SNAPBACK_BUNDLE_LIMIT_ROWS";
    pub const LIMIT_BYTES: &str = "SNAPBACK_BUNDLE_LIMIT_BYTES";
    pub const LIMIT_TIME: &str = "SNAPBACK_BUNDLE_LIMIT_TIME";
    pub const RATE_LIMITED: &str = "SNAPBACK_BUNDLE_RATE_LIMITED";
    pub const IDEMPOTENCY_SENDER_MISMATCH: &str = "SNAPBACK_BUNDLE_IDEMPOTENCY_SENDER_MISMATCH";
    pub const IDEMPOTENCY_SCOPE_MISMATCH: &str = "SNAPBACK_BUNDLE_IDEMPOTENCY_SCOPE_MISMATCH";
    pub const IDEMPOTENCY_EXPIRED: &str = "SNAPBACK_BUNDLE_IDEMPOTENCY_EXPIRED";
    pub const PENDING_CAPACITY: &str = "SNAPBACK_BUNDLE_PENDING_CAPACITY";
}

/// Hard limits — pinned defaults (LLP 0092 §0D.2). Server policy knobs.
pub const BUNDLE_MAX_QUERIES: usize = 32;
pub const BUNDLE_MAX_ROWS: usize = 5_000;
pub const BUNDLE_MAX_BYTES: usize = 4 * 1024 * 1024;
pub const BUNDLE_MAX_EVAL_MS: u64 = 2_000;
pub const BUNDLE_RATE_PER_MINUTE: usize = 60;

/// Attach grace, reaper cadence, and pending-owner bounds (LLP 0092 §0D.4).
pub const BUNDLE_ATTACH_GRACE_MS: u64 = 30_000;
pub const BUNDLE_PENDING_SWEEP_MS: u64 = 10_000;
pub const BUNDLE_MAX_PENDING_OWNERS: usize = 256;
pub const BUNDLE_MAX_PENDING_PER_AUTHORITY: usize = 8;

/// `POST /app/bundle` request (LLP 0092 §0D.1). `mode` stays a plain string
/// so an unknown mode refuses with the coded `SNAPBACK_BUNDLE_MODE_INVALID`
/// rather than an untyped serde rejection.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct BundleRequest {
    /// Exact manifest route pattern (LLP 0092 §0C.1) — matched by string
    /// equality against the served route manifest; the endpoint never does
    /// URL matching.
    pub route: String,
    /// Route params, all strings (percent-decoded segment values).
    #[serde(default)]
    pub params: BTreeMap<String, String>,
    /// `"read"` (default) or `"register"`.
    #[serde(default)]
    pub mode: Option<String>,
    /// Register mode only, required there: client-minted per boot attempt,
    /// 22-char base64url (16 random bytes).
    #[serde(
        default,
        rename = "idempotencyKey",
        alias = "idempotency_key",
        skip_serializing_if = "Option::is_none"
    )]
    pub idempotency_key: Option<String>,
    /// Dev/test-only inline manifest entry. The cluster-0C authoring surface
    /// (`snapback/routes.mjs` → `routes.manifest.json`, LLP 0092 §0C.1) has
    /// not landed; until it does, the local arm accepts the route entry
    /// inline in this clearly-marked form. It is refused whenever a served
    /// route manifest exists for the app.
    /// TODO(ENG-25448): retire once the routes-manifest authoring path lands.
    #[serde(
        default,
        rename = "devManifestEntry",
        alias = "dev_manifest_entry",
        skip_serializing_if = "Option::is_none"
    )]
    pub dev_manifest_entry: Option<BundleRouteEntry>,
    /// Dev-mode legacy body auth (the `app_function_route` carrier); ignored
    /// in sessions mode like every legacy body-auth field.
    #[serde(default)]
    pub auth: crate::manifest::AuthInput,
}

/// One route entry: every query the route needs — the unit the bundle
/// evaluates at one commit (LLP 0092 §0C.1).
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct BundleRouteEntry {
    /// Route pattern: `/`-separated static segments plus `:name` params.
    pub route: String,
    /// 1..=32 query specs (the 0D.2 query-count limit).
    pub queries: Vec<BundleQuerySpec>,
    /// LLP 0091 §0A.5 per-entry persist opt-out (default true); carried for
    /// schema completeness — the client store consumes it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub persist: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct BundleQuerySpec {
    /// Exported function name in the served functions manifest.
    pub function: String,
    /// `params-v1` args mapping (LLP 0092 §0E.6): JSON literals plus
    /// `{"$param": "name"}` references.
    #[serde(default)]
    pub args: Value,
}

/// `POST /app/bundle` response (LLP 0092 §0D.1).
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct BundleResponse {
    /// Single shared commit version — every entry was evaluated at this cut.
    #[serde(rename = "commitVersion")]
    #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
    pub commit_version: u64,
    pub generation: String,
    #[serde(rename = "versionStream")]
    pub version_stream: String,
    /// One per `querySpec`, manifest order.
    pub entries: Vec<BundleEntry>,
    /// Register mode only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection: Option<BundleConnection>,
}

/// Per-entry closed union (LLP 0092 §0D.1): `resume` is present iff the
/// query is `rqsEligible` and explicitly `null` otherwise, in BOTH modes;
/// `subscriptionId` appears in register mode only; `authorization` appears
/// for register-mode auth-scoped entries only.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct BundleEntry {
    pub function: String,
    /// Fully substituted, validated args.
    pub args: Value,
    pub rows: Vec<Value>,
    /// Always serialized (`null` for non-eligible entries) — the closed
    /// union's discriminating field.
    pub resume: Option<ResumeWire>,
    #[serde(
        default,
        rename = "subscriptionId",
        skip_serializing_if = "Option::is_none"
    )]
    pub subscription_id: Option<String>,
    /// LLP 0053 scope/invalidation projections for register-mode auth-scoped
    /// entries.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub authorization: Option<Value>,
}

/// Register-mode connection mint (LLP 0092 §0D.1/§0D.4).
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct BundleConnection {
    #[serde(rename = "connectionId")]
    pub connection_id: String,
    /// The connection-grant secret (`[secret]` response sensitivity).
    pub grant: String,
    /// Absolute server-clock ms deadline for socket attach.
    #[serde(rename = "attachDeadline")]
    pub attach_deadline: u64,
}

/// Requested bundle mode after coded validation.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BundleMode {
    Read,
    Register,
}

/// Validate `mode` × `idempotencyKey` per LLP 0092 §0D.1: mode must be
/// `read`/`register`; the key is required in register mode, refused in read
/// mode, and must be the pinned 22-char base64url id shape.
pub fn validate_mode(
    mode: Option<&str>,
    idempotency_key: Option<&str>,
) -> Result<BundleMode, &'static str> {
    let mode = match mode {
        None | Some("read") => BundleMode::Read,
        Some("register") => BundleMode::Register,
        Some(_) => return Err(code::MODE_INVALID),
    };
    match (mode, idempotency_key) {
        (BundleMode::Read, None) => Ok(BundleMode::Read),
        (BundleMode::Read, Some(_)) => Err(code::MODE_INVALID),
        (BundleMode::Register, None) => Err(code::MODE_INVALID),
        (BundleMode::Register, Some(key)) => {
            if key.len() == 22
                && key
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
            {
                Ok(BundleMode::Register)
            } else {
                Err(code::MODE_INVALID)
            }
        }
    }
}

/// Parse a v1 route pattern (LLP 0092 §0C.1): `/`-separated static segments
/// plus `:name` params, each matching exactly one non-empty segment. No
/// wildcards, regexes, optional segments, or trailing-slash variants.
/// Returns the ordered param names.
pub fn route_pattern_params(pattern: &str) -> Result<Vec<String>, &'static str> {
    if pattern.is_empty() || !pattern.starts_with('/') {
        return Err(code::ENTRY_INVALID);
    }
    if pattern != "/" && pattern.ends_with('/') {
        return Err(code::ENTRY_INVALID);
    }
    let mut params = Vec::new();
    if pattern == "/" {
        return Ok(params);
    }
    for segment in pattern[1..].split('/') {
        if segment.is_empty() {
            return Err(code::ENTRY_INVALID);
        }
        if let Some(name) = segment.strip_prefix(':') {
            if name.is_empty()
                || !name
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
            {
                return Err(code::ENTRY_INVALID);
            }
            if params.iter().any(|existing| existing == name) {
                return Err(code::ENTRY_INVALID);
            }
            params.push(name.to_owned());
        } else if segment.contains(':') {
            return Err(code::ENTRY_INVALID);
        }
    }
    Ok(params)
}

/// `params-v1` substitution (LLP 0092 §0E.6): the mapping is a JSON value
/// mirroring the args shape where every node is either a literal or a
/// `{"$param": "name"}` reference. References decode as strings in this
/// interim step — the schema-driven number/boolean decode requires the
/// per-arg schema the cluster-0C manifest work carries.
/// TODO(ENG-25448): type-directed decode once manifest arg schemas land.
///
/// Request params must exactly cover the pattern's names: a request naming
/// a missing or extra param refuses `SNAPBACK_BUNDLE_PARAMS_INVALID`.
pub fn substitute_params_v1(
    mapping: &Value,
    params: &BTreeMap<String, String>,
) -> Result<Value, &'static str> {
    match mapping {
        Value::Object(map) => {
            if let Some(reference) = map.get("$param") {
                // A `$param` key alongside other keys, or with a non-string
                // value, is refused (LLP 0092 §0E.6's unambiguity rule).
                if map.len() != 1 {
                    return Err(code::PARAMS_INVALID);
                }
                let Value::String(name) = reference else {
                    return Err(code::PARAMS_INVALID);
                };
                let value = params.get(name).ok_or(code::PARAMS_INVALID)?;
                return Ok(Value::String(value.clone()));
            }
            let mut substituted = serde_json::Map::new();
            for (key, inner) in map {
                substituted.insert(key.clone(), substitute_params_v1(inner, params)?);
            }
            Ok(Value::Object(substituted))
        }
        Value::Array(items) => Ok(Value::Array(
            items
                .iter()
                .map(|item| substitute_params_v1(item, params))
                .collect::<Result<Vec<_>, _>>()?,
        )),
        literal => Ok(literal.clone()),
    }
}

/// Validate that the request's params exactly match the route pattern's
/// param names (missing or extra params refuse) and that every referenced
/// `$param` in the entry's mappings names a pattern param.
pub fn validate_entry_against_params(
    entry: &BundleRouteEntry,
    request_route: &str,
    params: &BTreeMap<String, String>,
) -> Result<(), &'static str> {
    if entry.route != request_route {
        return Err(code::ROUTE_UNKNOWN);
    }
    let pattern_params = route_pattern_params(&entry.route)?;
    if entry.queries.is_empty() {
        return Err(code::ENTRY_INVALID);
    }
    if entry.queries.len() > BUNDLE_MAX_QUERIES {
        return Err(code::LIMIT_QUERIES);
    }
    for name in params.keys() {
        if !pattern_params.iter().any(|param| param == name) {
            return Err(code::PARAMS_INVALID);
        }
    }
    for name in &pattern_params {
        if !params.contains_key(name) {
            return Err(code::PARAMS_INVALID);
        }
    }
    for spec in &entry.queries {
        validate_mapping_references(&spec.args, &pattern_params)?;
    }
    Ok(())
}

fn validate_mapping_references(
    mapping: &Value,
    pattern_params: &[String],
) -> Result<(), &'static str> {
    match mapping {
        Value::Object(map) => {
            if let Some(reference) = map.get("$param") {
                if map.len() != 1 {
                    return Err(code::PARAMS_INVALID);
                }
                let Value::String(name) = reference else {
                    return Err(code::PARAMS_INVALID);
                };
                if !pattern_params.iter().any(|param| param == name) {
                    return Err(code::PARAMS_INVALID);
                }
                return Ok(());
            }
            for inner in map.values() {
                validate_mapping_references(inner, pattern_params)?;
            }
            Ok(())
        }
        Value::Array(items) => {
            for item in items {
                validate_mapping_references(item, pattern_params)?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

/// The replay-validity tuple of the LLP 0031 dated amendment: (authority,
/// sender-key identity, credential incarnation, `generation`, manifest
/// entry, canonical args). Sender identity and incarnation are interim
/// projections of the resolved authority — the RFC 7638 JWK thumbprint /
/// `sender_replay_epoch` binding requires sender-constrained custody wiring
/// on this HTTP route that does not exist yet.
/// TODO(ENG-25453 follow-up, sender-thumbprint binding): bind LLP 0077's
/// exact wire identities once the bundle route carries sender-constrained
/// proofs.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BundleReplayScope {
    pub authority_key: String,
    pub sender_identity: String,
    pub credential_incarnation: u64,
    pub generation: String,
    pub entry_identity: String,
    pub args_identity: String,
}

/// One pending-registration owner (LLP 0031 amendment): the bounded server
/// owner of a register-mode registration set awaiting socket attach.
#[derive(Clone, Debug)]
pub struct PendingRegistrationOwner {
    pub idempotency_key: String,
    pub scope: BundleReplayScope,
    pub connection_id: String,
    pub grant_id: String,
    pub subscription_ids: Vec<String>,
    pub attach_deadline_ms: u64,
}

/// Terminal states a consumed idempotency key can be found in
/// (`SNAPBACK_BUNDLE_IDEMPOTENCY_EXPIRED` on replay after either).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PendingResolution {
    Attached,
    Reaped,
}

/// Outcome of `begin_register` for a presented idempotency key.
#[derive(Clone, Debug)]
pub enum RegisterAdmission {
    /// No pending owner holds this key; a reservation was installed. The
    /// caller must `commit_register` or `abandon_register` it.
    New,
    /// A live pending owner holds this key with a matching replay tuple:
    /// the retry atomically supersedes it (fresh evaluation, same connection
    /// identity, rotated grant secret — the LLP 0031 amendment).
    Replay {
        connection_id: String,
        grant_id: String,
    },
}

/// Socket-attach outcome for a connection id.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AttachOutcome {
    /// The connection has no pending owner — an ordinary socket attach.
    NotPending,
    /// Attach inside the grace window: the pending registrations hand off to
    /// the socket session and the idempotency key's replay validity ends.
    Attached,
    /// Attach after `attachDeadline` — enforcement is exact at attach
    /// (LLP 0092 §0D.4): the caller must reap and refuse the socket.
    Expired { grant_id: String },
}

const RESOLVED_TOMBSTONE_CAP: usize = 4_096;

#[derive(Default)]
struct PendingBundleState {
    by_key: std::collections::HashMap<String, PendingRegistrationOwner>,
    by_connection: std::collections::HashMap<String, String>,
    resolved: std::collections::HashMap<String, PendingResolution>,
    resolved_order: std::collections::VecDeque<String>,
    rate: std::collections::HashMap<String, std::collections::VecDeque<u64>>,
}

/// Process-local pending-registration-owner registry and per-authority bundle
/// rate limiter (LLP 0092 §0D.2/§0D.4; LLP 0031 dated amendment). Bounded:
/// at most [`BUNDLE_MAX_PENDING_OWNERS`] owners per instance and
/// [`BUNDLE_MAX_PENDING_PER_AUTHORITY`] per authority; consumed idempotency
/// keys leave bounded tombstones so a late replay refuses
/// `SNAPBACK_BUNDLE_IDEMPOTENCY_EXPIRED` rather than minting a duplicate.
#[derive(Clone, Default)]
pub struct PendingBundleRegistry(std::sync::Arc<std::sync::Mutex<PendingBundleState>>);

impl PendingBundleRegistry {
    fn lock(&self) -> std::sync::MutexGuard<'_, PendingBundleState> {
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Per-authority bundle request rate (60/min). Anonymous callers share
    /// one interim bucket — per-client-address keying is LLP 0092 OQ-A, an
    /// implementation-time per-arm decision this step leaves open.
    pub fn admit_rate(&self, authority_key: &str, now_ms: u64) -> Result<(), &'static str> {
        let mut state = self.lock();
        let window = state.rate.entry(authority_key.to_owned()).or_default();
        while window
            .front()
            .is_some_and(|at| now_ms.saturating_sub(*at) >= 60_000)
        {
            window.pop_front();
        }
        if window.len() >= BUNDLE_RATE_PER_MINUTE {
            return Err(code::RATE_LIMITED);
        }
        window.push_back(now_ms);
        Ok(())
    }

    /// Admit a register-mode idempotency key: replay-tuple validation plus
    /// the pending-owner capacity bounds. `New` installs a reservation the
    /// caller must commit or abandon.
    pub fn begin_register(
        &self,
        key: &str,
        scope: &BundleReplayScope,
    ) -> Result<RegisterAdmission, &'static str> {
        let mut state = self.lock();
        if state.resolved.contains_key(key) {
            return Err(code::IDEMPOTENCY_EXPIRED);
        }
        if let Some(owner) = state.by_key.get(key) {
            if owner.scope.sender_identity != scope.sender_identity
                || owner.scope.credential_incarnation != scope.credential_incarnation
            {
                return Err(code::IDEMPOTENCY_SENDER_MISMATCH);
            }
            if owner.scope != *scope {
                return Err(code::IDEMPOTENCY_SCOPE_MISMATCH);
            }
            if owner.subscription_ids.is_empty() && owner.attach_deadline_ms == u64::MAX {
                // A reservation for the same key is still evaluating; refuse
                // transiently rather than superseding an in-flight mint.
                return Err(code::PENDING_CAPACITY);
            }
            return Ok(RegisterAdmission::Replay {
                connection_id: owner.connection_id.clone(),
                grant_id: owner.grant_id.clone(),
            });
        }
        if state.by_key.len() >= BUNDLE_MAX_PENDING_OWNERS {
            return Err(code::PENDING_CAPACITY);
        }
        let per_authority = state
            .by_key
            .values()
            .filter(|owner| owner.scope.authority_key == scope.authority_key)
            .count();
        if per_authority >= BUNDLE_MAX_PENDING_PER_AUTHORITY {
            return Err(code::PENDING_CAPACITY);
        }
        state.by_key.insert(
            key.to_owned(),
            PendingRegistrationOwner {
                idempotency_key: key.to_owned(),
                scope: scope.clone(),
                connection_id: String::new(),
                grant_id: String::new(),
                subscription_ids: Vec::new(),
                attach_deadline_ms: u64::MAX,
            },
        );
        Ok(RegisterAdmission::New)
    }

    /// Publish a successful mint (or a successful superseding retry) under
    /// its key: the owner becomes reapable at `attach_deadline_ms`.
    pub fn commit_register(&self, owner: PendingRegistrationOwner) {
        let mut state = self.lock();
        state
            .by_connection
            .insert(owner.connection_id.clone(), owner.idempotency_key.clone());
        state.by_key.insert(owner.idempotency_key.clone(), owner);
    }

    /// Drop a reservation whose mint failed — a failed bundle strands no
    /// pending state.
    pub fn abandon_register(&self, key: &str) {
        let mut state = self.lock();
        if let Some(owner) = state.by_key.get(key)
            && owner.subscription_ids.is_empty()
            && owner.attach_deadline_ms == u64::MAX
        {
            state.by_key.remove(key);
        }
    }

    fn resolve_locked(state: &mut PendingBundleState, key: String, resolution: PendingResolution) {
        if let Some(owner) = state.by_key.remove(&key) {
            state.by_connection.remove(&owner.connection_id);
        }
        if state.resolved.insert(key.clone(), resolution).is_none() {
            state.resolved_order.push_back(key);
            while state.resolved_order.len() > RESOLVED_TOMBSTONE_CAP {
                if let Some(oldest) = state.resolved_order.pop_front() {
                    state.resolved.remove(&oldest);
                }
            }
        }
    }

    /// Socket attach for `connection_id`. Inside the grace window the owner
    /// resolves Attached (replay validity ends — atomic handoff); past the
    /// deadline the caller must reap and refuse the socket.
    pub fn mark_attached(&self, connection_id: &str, now_ms: u64) -> AttachOutcome {
        let mut state = self.lock();
        let Some(key) = state.by_connection.get(connection_id).cloned() else {
            return AttachOutcome::NotPending;
        };
        let Some(owner) = state.by_key.get(&key) else {
            return AttachOutcome::NotPending;
        };
        if now_ms > owner.attach_deadline_ms {
            let grant_id = owner.grant_id.clone();
            Self::resolve_locked(&mut state, key, PendingResolution::Reaped);
            return AttachOutcome::Expired { grant_id };
        }
        Self::resolve_locked(&mut state, key, PendingResolution::Attached);
        AttachOutcome::Attached
    }

    /// Reap every owner past its deadline (the ≤10 s sweep of LLP 0092
    /// §0D.4). Returns the (connection, grant) identities the caller must
    /// tear down — demand disarmed, capacity released, grant invalidated.
    pub fn sweep(&self, now_ms: u64) -> Vec<(String, String)> {
        let mut state = self.lock();
        let expired: Vec<String> = state
            .by_key
            .values()
            .filter(|owner| {
                owner.attach_deadline_ms != u64::MAX && now_ms > owner.attach_deadline_ms
            })
            .map(|owner| owner.idempotency_key.clone())
            .collect();
        let mut reaped = Vec::with_capacity(expired.len());
        for key in expired {
            if let Some(owner) = state.by_key.get(&key) {
                reaped.push((owner.connection_id.clone(), owner.grant_id.clone()));
            }
            Self::resolve_locked(&mut state, key, PendingResolution::Reaped);
        }
        reaped
    }

    /// Terminally resolve a key (used when a superseding retry fails after
    /// the prior pending set was already purged — the client starts a fresh
    /// boot attempt with a new key).
    pub fn resolve_key(&self, key: &str, resolution: PendingResolution) {
        let mut state = self.lock();
        Self::resolve_locked(&mut state, key.to_owned(), resolution);
    }

    /// The number of live pending owners (observability/tests).
    pub fn pending_len(&self) -> usize {
        self.lock()
            .by_key
            .values()
            .filter(|owner| owner.attach_deadline_ms != u64::MAX)
            .count()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn mode_validation_is_coded() {
        assert_eq!(validate_mode(None, None), Ok(BundleMode::Read));
        assert_eq!(validate_mode(Some("read"), None), Ok(BundleMode::Read));
        assert_eq!(
            validate_mode(Some("register"), Some("AAAAAAAAAAAAAAAAAAAAAA")),
            Ok(BundleMode::Register)
        );
        // Unknown mode, key in read mode, missing/malformed key in register.
        assert_eq!(validate_mode(Some("write"), None), Err(code::MODE_INVALID));
        assert_eq!(
            validate_mode(None, Some("AAAAAAAAAAAAAAAAAAAAAA")),
            Err(code::MODE_INVALID)
        );
        assert_eq!(
            validate_mode(Some("register"), None),
            Err(code::MODE_INVALID)
        );
        assert_eq!(
            validate_mode(Some("register"), Some("short")),
            Err(code::MODE_INVALID)
        );
        assert_eq!(
            validate_mode(Some("register"), Some("has spaces? not base64url!")),
            Err(code::MODE_INVALID)
        );
    }

    #[test]
    fn route_patterns_are_exact_v1_shapes() {
        assert_eq!(route_pattern_params("/").unwrap(), Vec::<String>::new());
        assert_eq!(
            route_pattern_params("/board/:boardId").unwrap(),
            vec!["boardId".to_owned()]
        );
        assert_eq!(
            route_pattern_params("/a/:x/b/:y").unwrap(),
            vec!["x".to_owned(), "y".to_owned()]
        );
        for bad in [
            "",
            "board",
            "/board/",
            "/board//x",
            "/board/:",
            "/board/:a:b",
            "/board/:x/:x",
            "/board/:bad-name",
        ] {
            assert!(route_pattern_params(bad).is_err(), "{bad:?} must refuse");
        }
    }

    #[test]
    fn params_v1_substitution_and_refusals() {
        let params: BTreeMap<String, String> = [("boardId".to_owned(), "b-7".to_owned())]
            .into_iter()
            .collect();
        let mapping = json!({ "board": { "$param": "boardId" }, "limit": 5, "tags": ["a", { "$param": "boardId" }] });
        assert_eq!(
            substitute_params_v1(&mapping, &params).unwrap(),
            json!({ "board": "b-7", "limit": 5, "tags": ["a", "b-7"] })
        );
        // $param alongside other keys / non-string reference / unknown param.
        assert_eq!(
            substitute_params_v1(&json!({ "$param": "boardId", "x": 1 }), &params),
            Err(code::PARAMS_INVALID)
        );
        assert_eq!(
            substitute_params_v1(&json!({ "$param": 3 }), &params),
            Err(code::PARAMS_INVALID)
        );
        assert_eq!(
            substitute_params_v1(&json!({ "$param": "missing" }), &params),
            Err(code::PARAMS_INVALID)
        );
    }

    #[test]
    fn entry_validation_covers_params_exactly() {
        let entry = BundleRouteEntry {
            route: "/board/:boardId".to_owned(),
            queries: vec![BundleQuerySpec {
                function: "listCells".to_owned(),
                args: json!({ "board": { "$param": "boardId" } }),
            }],
            persist: None,
        };
        let exact: BTreeMap<String, String> = [("boardId".to_owned(), "b".to_owned())]
            .into_iter()
            .collect();
        assert!(validate_entry_against_params(&entry, "/board/:boardId", &exact).is_ok());
        // Missing param.
        assert_eq!(
            validate_entry_against_params(&entry, "/board/:boardId", &BTreeMap::new()),
            Err(code::PARAMS_INVALID)
        );
        // Extra param.
        let extra: BTreeMap<String, String> = [
            ("boardId".to_owned(), "b".to_owned()),
            ("other".to_owned(), "x".to_owned()),
        ]
        .into_iter()
        .collect();
        assert_eq!(
            validate_entry_against_params(&entry, "/board/:boardId", &extra),
            Err(code::PARAMS_INVALID)
        );
        // Route mismatch.
        assert_eq!(
            validate_entry_against_params(&entry, "/other", &exact),
            Err(code::ROUTE_UNKNOWN)
        );
        // Mapping referencing a param the pattern lacks.
        let dangling = BundleRouteEntry {
            route: "/board".to_owned(),
            queries: vec![BundleQuerySpec {
                function: "listCells".to_owned(),
                args: json!({ "board": { "$param": "boardId" } }),
            }],
            persist: None,
        };
        assert_eq!(
            validate_entry_against_params(&dangling, "/board", &BTreeMap::new()),
            Err(code::PARAMS_INVALID)
        );
        // Query-count limit.
        let oversized = BundleRouteEntry {
            route: "/board".to_owned(),
            queries: vec![
                BundleQuerySpec {
                    function: "q".to_owned(),
                    args: Value::Null,
                };
                BUNDLE_MAX_QUERIES + 1
            ],
            persist: None,
        };
        assert_eq!(
            validate_entry_against_params(&oversized, "/board", &BTreeMap::new()),
            Err(code::LIMIT_QUERIES)
        );
    }
}
