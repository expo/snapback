//! Persistent authorization-invalidation protocol core.
//!
//! The live registry is intentionally level-triggered: delivery merely wakes a
//! consumer, while these records remain authoritative until an exact
//! acknowledgement follows the client-side disposition/snapshot commit.
//!
//! @ref LLP 0053#invalidation-is-an-obligation-not-a-message — authenticated
//! scope identity, monotone obligation merge, and exact ACK are the security
//! boundary rather than the lossy realtime outbox.
//! @ref LLP 0053#negative-deltas-are-obligations-positive-deltas-are-best-effort —
//! potentially shrinking auth-scoped results remain pending until resolution.

use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::storage::{AuthorizationVersion, MAX_AUTHORIZATION_EPOCH};
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use hmac::{Hmac, Mac};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;

pub const AUTH_INVALIDATION_PROTOCOL_VERSION: u32 = 1;
pub const AUTH_INVALIDATION_REFIRE_MAX_MS: u64 = 5_000;
pub const AUTH_ERROR_RETRY_WINDOW_MS: u64 = 15_000;
pub const AUTH_ERROR_ATTEMPTS_TOTAL: u8 = 3;
pub const AUTH_RETRY_EPISODE_MAX_GLOBAL: usize = 10_000;
pub const AUTH_RETRY_EPISODE_MAX_PER_AUTH_STORE: usize = 1_024;
pub const MAX_PROTOCOL_COUNTER: u64 = MAX_AUTHORIZATION_EPOCH;

type HmacSha256 = Hmac<Sha256>;

fn invalidation_error(code: &'static str, message: impl Into<String>) -> SnapbackError {
    SnapbackError::error(code, "auth", message.into())
}

fn corrupt(message: impl Into<String>) -> SnapbackError {
    invalidation_error("SNAPBACK_AUTH_INVALIDATION_CORRUPT", message)
}

fn validate_counter(value: u64, field: &str, positive: bool) -> SnapbackResult<()> {
    if value > MAX_PROTOCOL_COUNTER || (positive && value == 0) {
        return Err(corrupt(format!(
            "{field} is outside the canonical JavaScript-safe {}integer range",
            if positive {
                "positive "
            } else {
                "nonnegative "
            }
        )));
    }
    Ok(())
}

fn validate_uuid_v7(value: &str, field: &str) -> SnapbackResult<()> {
    let parsed = Uuid::parse_str(value)
        .map_err(|_| corrupt(format!("{field} is not a canonical UUIDv7")))?;
    if parsed.get_version_num() != 7 || parsed.hyphenated().to_string() != value {
        return Err(corrupt(format!("{field} is not a canonical UUIDv7")));
    }
    Ok(())
}

fn validate_opaque(value: &str, field: &str) -> SnapbackResult<()> {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return Err(corrupt(format!("{field} is empty")));
    };
    if value.len() > 256
        || !first.is_ascii_alphanumeric()
        || !chars.all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | ':' | '-'))
    {
        return Err(corrupt(format!("{field} is not a canonical opaque id")));
    }
    Ok(())
}

fn put_string(mac: &mut HmacSha256, value: &str) {
    mac.update(&(value.len() as u64).to_be_bytes());
    mac.update(value.as_bytes());
}

/// A boot identity is never reused, even when process-local counters restart.
#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IssuerId {
    pub authorization_incarnation: String,
    pub boot_sequence: u64,
    pub boot_nonce: String,
}

impl IssuerId {
    pub fn fresh(
        authorization_incarnation: impl Into<String>,
        boot_sequence: u64,
    ) -> SnapbackResult<Self> {
        let authorization_incarnation = authorization_incarnation.into();
        validate_uuid_v7(
            &authorization_incarnation,
            "issuerId.authorizationIncarnation",
        )?;
        validate_counter(boot_sequence, "issuerId.bootSequence", true)?;
        let mut bytes = [0_u8; 16];
        getrandom::fill(&mut bytes).map_err(|_| {
            invalidation_error(
                "SNAPBACK_AUTH_INVALIDATION_ISSUER_UNAVAILABLE",
                "could not obtain cryptographic randomness for an invalidation boot issuer",
            )
        })?;
        Ok(Self {
            authorization_incarnation,
            boot_sequence,
            boot_nonce: URL_SAFE_NO_PAD.encode(bytes),
        })
    }

    pub fn validate(&self) -> SnapbackResult<()> {
        validate_uuid_v7(
            &self.authorization_incarnation,
            "issuerId.authorizationIncarnation",
        )?;
        validate_counter(self.boot_sequence, "issuerId.bootSequence", true)?;
        let nonce = URL_SAFE_NO_PAD
            .decode(&self.boot_nonce)
            .map_err(|_| corrupt("issuerId.bootNonce is not canonical base64url"))?;
        if nonce.len() != 16 || URL_SAFE_NO_PAD.encode(nonce) != self.boot_nonce {
            return Err(corrupt(
                "issuerId.bootNonce is not a canonical 128-bit base64url value",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthenticatedBootIssuer {
    pub issuer_id: IssuerId,
    pub key_id: String,
    pub mac: String,
}

/// Stable protocol-key signer for bootstrap issuer expectations.
pub struct IssuerAuthenticator {
    key_id: String,
    key: [u8; 32],
}

impl Drop for IssuerAuthenticator {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        self.key.zeroize();
    }
}

impl IssuerAuthenticator {
    pub fn new(key_id: impl Into<String>, key: [u8; 32]) -> SnapbackResult<Self> {
        let key_id = key_id.into();
        validate_opaque(&key_id, "keyId")?;
        Ok(Self { key_id, key })
    }

    pub fn authenticate(
        &self,
        issuer_id: IssuerId,
        target_profile_id: &str,
        app_id: &str,
    ) -> SnapbackResult<AuthenticatedBootIssuer> {
        issuer_id.validate()?;
        let mac = self.mac(&issuer_id, target_profile_id, app_id)?;
        Ok(AuthenticatedBootIssuer {
            issuer_id,
            key_id: self.key_id.clone(),
            mac,
        })
    }

    pub fn verify(
        &self,
        authenticated: &AuthenticatedBootIssuer,
        target_profile_id: &str,
        app_id: &str,
    ) -> SnapbackResult<()> {
        if authenticated.key_id != self.key_id {
            return Err(invalidation_error(
                "SNAPBACK_AUTH_INVALIDATION_ISSUER_INVALID",
                "invalidation issuer key id does not match the active protocol key",
            ));
        }
        authenticated.issuer_id.validate()?;
        let provided = URL_SAFE_NO_PAD.decode(&authenticated.mac).map_err(|_| {
            invalidation_error(
                "SNAPBACK_AUTH_INVALIDATION_ISSUER_INVALID",
                "invalidation issuer MAC is not canonical base64url",
            )
        })?;
        let mac = self.base_mac(&authenticated.issuer_id, target_profile_id, app_id)?;
        mac.verify_slice(&provided).map_err(|_| {
            invalidation_error(
                "SNAPBACK_AUTH_INVALIDATION_ISSUER_INVALID",
                "invalidation issuer authentication failed",
            )
        })
    }

    fn mac(
        &self,
        issuer_id: &IssuerId,
        target_profile_id: &str,
        app_id: &str,
    ) -> SnapbackResult<String> {
        let mac = self.base_mac(issuer_id, target_profile_id, app_id)?;
        Ok(URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes()))
    }

    fn base_mac(
        &self,
        issuer_id: &IssuerId,
        target_profile_id: &str,
        app_id: &str,
    ) -> SnapbackResult<HmacSha256> {
        let mut mac = HmacSha256::new_from_slice(&self.key)
            .map_err(|_| corrupt("protocol key has an invalid HMAC length"))?;
        put_string(&mut mac, "snapback.auth-invalidation.issuer.v1");
        put_string(&mut mac, target_profile_id);
        put_string(&mut mac, app_id);
        put_string(&mut mac, &issuer_id.authorization_incarnation);
        mac.update(&issuer_id.boot_sequence.to_be_bytes());
        put_string(&mut mac, &issuer_id.boot_nonce);
        Ok(mac)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QueryNamespace {
    pub client_store_id: String,
    pub query_key: String,
    pub query_instance_id: u64,
}

impl QueryNamespace {
    pub fn validate(&self) -> SnapbackResult<()> {
        validate_opaque(&self.client_store_id, "namespace.clientStoreId")?;
        if self.query_key.is_empty() || self.query_key.len() > 8_192 {
            return Err(corrupt(
                "namespace.queryKey must be a nonempty bounded canonical key",
            ));
        }
        validate_counter(self.query_instance_id, "namespace.queryInstanceId", true)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum ScopeId {
    Subscription {
        issuer_id: IssuerId,
        namespace: QueryNamespace,
        scope_sequence: u64,
        connection_generation: u64,
        subscription_id: String,
    },
    Connection {
        issuer_id: IssuerId,
        connection_generation: u64,
    },
    ClientQuery {
        namespace: QueryNamespace,
    },
}

impl ScopeId {
    pub fn validate(&self) -> SnapbackResult<()> {
        match self {
            Self::Subscription {
                issuer_id,
                namespace,
                scope_sequence,
                connection_generation,
                subscription_id,
            } => {
                issuer_id.validate()?;
                namespace.validate()?;
                validate_counter(*scope_sequence, "scopeId.scopeSequence", true)?;
                validate_counter(*connection_generation, "scopeId.connectionGeneration", true)?;
                validate_opaque(subscription_id, "scopeId.subscriptionId")
            }
            Self::Connection {
                issuer_id,
                connection_generation,
            } => {
                issuer_id.validate()?;
                validate_counter(*connection_generation, "scopeId.connectionGeneration", true)
            }
            Self::ClientQuery { namespace } => namespace.validate(),
        }
    }

    fn issuer(&self) -> Option<&IssuerId> {
        match self {
            Self::Subscription { issuer_id, .. } | Self::Connection { issuer_id, .. } => {
                Some(issuer_id)
            }
            Self::ClientQuery { .. } => None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DataWitness {
    pub version_stream: String,
    pub min_commit_version: u64,
}

impl DataWitness {
    fn validate(&self) -> SnapbackResult<()> {
        validate_opaque(&self.version_stream, "witness.data.versionStream")?;
        validate_counter(
            self.min_commit_version,
            "witness.data.minCommitVersion",
            false,
        )
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompositeWitness {
    pub authorization: AuthorizationVersion,
    pub data: Option<DataWitness>,
}

impl CompositeWitness {
    fn validate(&self) -> SnapbackResult<()> {
        validate_uuid_v7(
            &self.authorization.incarnation,
            "witness.authorization.incarnation",
        )?;
        validate_counter(
            self.authorization.epoch,
            "witness.authorization.epoch",
            false,
        )?;
        if let Some(data) = &self.data {
            data.validate()?;
        }
        Ok(())
    }

    fn covers(&self, floor: &Self) -> bool {
        if self.authorization != floor.authorization {
            return false;
        }
        match (&self.data, &floor.data) {
            (_, None) => true,
            (Some(actual), Some(required)) => {
                actual.version_stream == required.version_stream
                    && actual.min_commit_version >= required.min_commit_version
            }
            (None, Some(_)) => false,
        }
    }
}

#[derive(
    Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize, JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub enum InvalidationDisposition {
    Retain,
    Quarantine,
    Delete,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResyncObligation {
    pub protocol_version: u32,
    pub scope_id: ScopeId,
    pub revision: u64,
    pub max_disposition: InvalidationDisposition,
    pub witness: CompositeWitness,
    pub retry_episode_id: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ObligationExpectation {
    pub authorization: AuthorizationVersion,
    pub version_stream: Option<String>,
    pub issuer_id: Option<IssuerId>,
}

impl ObligationExpectation {
    fn validate(&self) -> SnapbackResult<()> {
        CompositeWitness {
            authorization: self.authorization.clone(),
            data: self
                .version_stream
                .as_ref()
                .map(|version_stream| DataWitness {
                    version_stream: version_stream.clone(),
                    min_commit_version: 0,
                }),
        }
        .validate()?;
        if let Some(issuer) = &self.issuer_id {
            issuer.validate()?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug)]
struct ObligationEntry {
    obligation: ResyncObligation,
    cause_sequence: u64,
    cause_id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum ResolutionKind {
    Snapshot,
    TerminalDelete,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResolutionTicket {
    pub protocol_version: u32,
    pub kind: ResolutionKind,
    pub scope_id: ScopeId,
    pub revision: u64,
    pub witness: CompositeWitness,
    pub max_disposition: InvalidationDisposition,
    pub ack_token: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AcknowledgeOutcome {
    Discharged,
    Duplicate,
    Stale,
}

/// Process-local persistent-until-discharge obligations. Process death ends
/// every live scope; reconnect must allocate a new issuer and fresh snapshot.
pub struct ObligationRegistry {
    expectation: ObligationExpectation,
    obligations: BTreeMap<ScopeId, ObligationEntry>,
    revision_high_water: BTreeMap<ScopeId, u64>,
    resolution_by_scope: BTreeMap<ScopeId, ResolutionTicket>,
    last_discharged: BTreeMap<ScopeId, (u64, String)>,
    connection_children: BTreeMap<ScopeId, BTreeSet<ScopeId>>,
}

impl ObligationRegistry {
    pub fn new(expectation: ObligationExpectation) -> SnapbackResult<Self> {
        expectation.validate()?;
        Ok(Self {
            expectation,
            obligations: BTreeMap::new(),
            revision_high_water: BTreeMap::new(),
            resolution_by_scope: BTreeMap::new(),
            last_discharged: BTreeMap::new(),
            connection_children: BTreeMap::new(),
        })
    }

    pub fn expectation(&self) -> &ObligationExpectation {
        &self.expectation
    }

    /// Moving to a new authenticated expectation terminates old live scopes;
    /// no arrival-ordered frame can perform this operation.
    pub fn replace_authenticated_expectation(
        &mut self,
        expectation: ObligationExpectation,
    ) -> SnapbackResult<Vec<ResyncObligation>> {
        expectation.validate()?;
        let prior = self
            .obligations
            .values()
            .map(|entry| entry.obligation.clone())
            .collect();
        self.expectation = expectation;
        self.obligations.clear();
        self.resolution_by_scope.clear();
        self.connection_children.clear();
        Ok(prior)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn raise(
        &mut self,
        scope_id: ScopeId,
        cause_sequence: u64,
        cause_id: impl Into<String>,
        max_disposition: InvalidationDisposition,
        witness: CompositeWitness,
        retry_episode_id: Option<String>,
    ) -> SnapbackResult<ResyncObligation> {
        scope_id.validate()?;
        validate_counter(cause_sequence, "causeSequence", true)?;
        let cause_id = cause_id.into();
        validate_opaque(&cause_id, "causeId")?;
        witness.validate()?;
        if let Some(id) = &retry_episode_id {
            validate_opaque(id, "retryEpisodeId")?;
        }
        self.require_expected(&scope_id, &witness)?;

        if let Some(current) = self.obligations.get(&scope_id) {
            if cause_sequence < current.cause_sequence {
                return Ok(current.obligation.clone());
            }
            if cause_sequence == current.cause_sequence {
                if cause_id != current.cause_id
                    || max_disposition != current.obligation.max_disposition
                    || witness != current.obligation.witness
                    || retry_episode_id != current.obligation.retry_episode_id
                {
                    return Err(corrupt(
                        "one semantic cause sequence was reused for different obligation bytes",
                    ));
                }
                return Ok(current.obligation.clone());
            }
        }

        let revision = self
            .revision_high_water
            .get(&scope_id)
            .copied()
            .unwrap_or(0)
            .checked_add(1)
            .filter(|value| *value <= MAX_PROTOCOL_COUNTER)
            .ok_or_else(|| {
                invalidation_error(
                    "SNAPBACK_AUTH_INVALIDATION_REVISION_EXHAUSTED",
                    "obligation revision exhausted the JavaScript-safe range",
                )
            })?;
        let (max_disposition, witness) = self
            .obligations
            .get(&scope_id)
            .map(|entry| {
                Ok::<_, SnapbackError>((
                    entry.obligation.max_disposition.max(max_disposition),
                    merge_witness(&entry.obligation.witness, &witness)?,
                ))
            })
            .transpose()?
            .unwrap_or((max_disposition, witness));
        let obligation = ResyncObligation {
            protocol_version: AUTH_INVALIDATION_PROTOCOL_VERSION,
            scope_id: scope_id.clone(),
            revision,
            max_disposition,
            witness,
            retry_episode_id,
        };
        self.revision_high_water.insert(scope_id.clone(), revision);
        self.obligations.insert(
            scope_id.clone(),
            ObligationEntry {
                obligation: obligation.clone(),
                cause_sequence,
                cause_id,
            },
        );
        self.resolution_by_scope.remove(&scope_id);
        Ok(obligation)
    }

    pub fn pending(&self, scope_id: &ScopeId) -> Option<&ResyncObligation> {
        self.obligations
            .get(scope_id)
            .map(|entry| &entry.obligation)
    }

    pub fn pending_all(&self) -> Vec<ResyncObligation> {
        self.obligations
            .values()
            .map(|entry| entry.obligation.clone())
            .collect()
    }

    pub fn register_connection_child(
        &mut self,
        connection_scope: &ScopeId,
        subscription_scope: ScopeId,
    ) -> SnapbackResult<Option<ResyncObligation>> {
        let Some(root) = self.obligations.get(connection_scope).cloned() else {
            return Ok(None);
        };
        if !matches!(connection_scope, ScopeId::Connection { .. })
            || !matches!(subscription_scope, ScopeId::Subscription { .. })
        {
            return Err(corrupt(
                "connection obligation children require connection and subscription scopes",
            ));
        }
        self.connection_children
            .entry(connection_scope.clone())
            .or_default()
            .insert(subscription_scope.clone());
        let child = self.raise(
            subscription_scope,
            root.cause_sequence,
            format!("root:{}.{}", root.cause_id, root.obligation.revision),
            root.obligation.max_disposition,
            root.obligation.witness,
            root.obligation.retry_episode_id,
        )?;
        Ok(Some(child))
    }

    pub fn issue_resolution(
        &mut self,
        scope_id: &ScopeId,
        kind: ResolutionKind,
        witness: CompositeWitness,
    ) -> SnapbackResult<ResolutionTicket> {
        witness.validate()?;
        let current = self.obligations.get(scope_id).ok_or_else(|| {
            invalidation_error(
                "SNAPBACK_AUTH_INVALIDATION_RESOLUTION_STALE",
                "no current obligation exists for the proposed resolution",
            )
        })?;
        if !witness.covers(&current.obligation.witness) {
            return Err(invalidation_error(
                "SNAPBACK_AUTH_INVALIDATION_RESOLUTION_STALE",
                "resolution witness does not cover the current obligation",
            ));
        }
        if let Some(existing) = self.resolution_by_scope.get(scope_id)
            && existing.revision == current.obligation.revision
            && existing.kind == kind
            && existing.witness == witness
        {
            return Ok(existing.clone());
        }
        let ticket = ResolutionTicket {
            protocol_version: AUTH_INVALIDATION_PROTOCOL_VERSION,
            kind,
            scope_id: scope_id.clone(),
            revision: current.obligation.revision,
            witness,
            max_disposition: current.obligation.max_disposition,
            ack_token: format!("ack_{}", Uuid::now_v7().simple()),
        };
        self.resolution_by_scope
            .insert(scope_id.clone(), ticket.clone());
        Ok(ticket)
    }

    /// Compare-and-discharge after the caller proves its local/render commit
    /// applied. Merely sending or draining the resolution cannot call this.
    pub fn acknowledge(
        &mut self,
        ack_token: &str,
        client_commit_applied: bool,
    ) -> SnapbackResult<AcknowledgeOutcome> {
        validate_opaque(ack_token, "ackToken")?;
        if !client_commit_applied {
            return Err(invalidation_error(
                "SNAPBACK_AUTH_INVALIDATION_ACK_BEFORE_COMMIT",
                "authorization invalidation acknowledgement requires a committed client transition",
            ));
        }
        if self
            .last_discharged
            .values()
            .any(|(_, previous)| previous == ack_token)
        {
            return Ok(AcknowledgeOutcome::Duplicate);
        }
        let Some((scope_id, ticket)) = self
            .resolution_by_scope
            .iter()
            .find(|(_, ticket)| ticket.ack_token == ack_token)
            .map(|(scope, ticket)| (scope.clone(), ticket.clone()))
        else {
            return Ok(AcknowledgeOutcome::Stale);
        };
        let Some(current) = self.obligations.get(&scope_id) else {
            return Ok(AcknowledgeOutcome::Stale);
        };
        if current.obligation.revision != ticket.revision
            || current.obligation.witness != ticket.witness
            || current.obligation.max_disposition != ticket.max_disposition
        {
            return Ok(AcknowledgeOutcome::Stale);
        }
        self.obligations.remove(&scope_id);
        self.resolution_by_scope.remove(&scope_id);
        self.last_discharged
            .insert(scope_id.clone(), (ticket.revision, ticket.ack_token));
        self.discharge_connection_child(&scope_id);
        Ok(AcknowledgeOutcome::Discharged)
    }

    pub fn retire_scope(&mut self, scope_id: &ScopeId) {
        self.obligations.remove(scope_id);
        self.resolution_by_scope.remove(scope_id);
        self.discharge_connection_child(scope_id);
    }

    fn discharge_connection_child(&mut self, child: &ScopeId) {
        let mut completed_roots = Vec::new();
        for (root, children) in &mut self.connection_children {
            children.remove(child);
            if children.is_empty() {
                completed_roots.push(root.clone());
            }
        }
        for root in completed_roots {
            self.connection_children.remove(&root);
            self.obligations.remove(&root);
            self.resolution_by_scope.remove(&root);
        }
    }

    fn require_expected(
        &self,
        scope_id: &ScopeId,
        witness: &CompositeWitness,
    ) -> SnapbackResult<()> {
        if witness.authorization != self.expectation.authorization {
            return Err(invalidation_error(
                "SNAPBACK_AUTH_INVALIDATION_EXPECTATION_STALE",
                "obligation authorization pair is not the authenticated current expectation",
            ));
        }
        if let Some(data) = &witness.data
            && let Some(expected_stream) = &self.expectation.version_stream
            && &data.version_stream != expected_stream
        {
            return Err(invalidation_error(
                "SNAPBACK_AUTH_INVALIDATION_EXPECTATION_STALE",
                "obligation version stream is not the authenticated current expectation",
            ));
        }
        if let Some(issuer) = scope_id.issuer()
            && Some(issuer) != self.expectation.issuer_id.as_ref()
        {
            return Err(invalidation_error(
                "SNAPBACK_AUTH_INVALIDATION_ISSUER_INVALID",
                "obligation issuer is not the authenticated current boot issuer",
            ));
        }
        Ok(())
    }
}

fn merge_witness(
    current: &CompositeWitness,
    incoming: &CompositeWitness,
) -> SnapbackResult<CompositeWitness> {
    if current.authorization != incoming.authorization {
        return Err(corrupt(
            "one live scope cannot merge obligations from different authorization pairs",
        ));
    }
    let data = match (&current.data, &incoming.data) {
        (Some(current), Some(incoming)) => {
            if current.version_stream != incoming.version_stream {
                return Err(corrupt(
                    "one live scope cannot merge obligations from different version streams",
                ));
            }
            Some(DataWitness {
                version_stream: current.version_stream.clone(),
                min_commit_version: current.min_commit_version.max(incoming.min_commit_version),
            })
        }
        (Some(current), None) => Some(current.clone()),
        (None, Some(incoming)) => Some(incoming.clone()),
        (None, None) => None,
    };
    Ok(CompositeWitness {
        authorization: incoming.authorization.clone(),
        data,
    })
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RetryEpisodeKey {
    pub authority_subject: String,
    pub client_store_id: String,
    pub query_key: String,
}

impl RetryEpisodeKey {
    fn validate(&self) -> SnapbackResult<()> {
        validate_opaque(&self.authority_subject, "authoritySubject")?;
        validate_opaque(&self.client_store_id, "clientStoreId")?;
        if self.query_key.is_empty() || self.query_key.len() > 8_192 {
            return Err(corrupt("retry query key is empty or too large"));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RetryEpisode {
    pub episode_id: String,
    pub key: RetryEpisodeKey,
    pub witness_floor: CompositeWitness,
    pub first_attempt_reserved_at_ms: u64,
    pub first_failure_at_ms: Option<u64>,
    pub attempts_reserved: u8,
    pub deadline_ms: Option<u64>,
    pub manual_retry_id: Option<String>,
    pub last_reservation_at_ms: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RetryReservationKind {
    Initial,
    Automatic,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RetryReservation {
    Reserved(RetryEpisode),
    Attached(RetryEpisode),
    Exhausted(RetryEpisode),
}

/// Serializable durable retry-episode state. Storage persists this snapshot in
/// the auth-control transaction; counters are derived and cross-checked rather
/// than trusted independently.
///
/// @ref LLP 0053#invalidation-is-an-obligation-not-a-message — retry budgets
/// survive re-fire, reconnect, scope replacement, and process restart.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RetryEpisodeRegistry {
    episodes: BTreeMap<RetryEpisodeKey, RetryEpisode>,
    clock_high_water_ms: u64,
}

impl RetryEpisodeRegistry {
    pub fn episodes(&self) -> &BTreeMap<RetryEpisodeKey, RetryEpisode> {
        &self.episodes
    }

    pub fn reserve(
        &mut self,
        key: RetryEpisodeKey,
        witness_floor: CompositeWitness,
        now_ms: u64,
        kind: RetryReservationKind,
    ) -> SnapbackResult<RetryReservation> {
        key.validate()?;
        witness_floor.validate()?;
        validate_counter(now_ms, "retry.nowMs", false)?;
        if now_ms < self.clock_high_water_ms {
            if let Some(existing) = self.episodes.get(&key) {
                return Ok(RetryReservation::Exhausted(existing.clone()));
            }
            return Err(invalidation_error(
                "SNAPBACK_AUTH_CLOCK_ROLLBACK",
                "authorization retry clock moved behind its durable high-water",
            ));
        }
        self.clock_high_water_ms = now_ms;

        if let Some(existing) = self.episodes.get_mut(&key) {
            existing.witness_floor = merge_witness(&existing.witness_floor, &witness_floor)?;
            if kind == RetryReservationKind::Initial {
                return Ok(RetryReservation::Attached(existing.clone()));
            }
            if existing.attempts_reserved >= AUTH_ERROR_ATTEMPTS_TOTAL
                || existing
                    .deadline_ms
                    .is_some_and(|deadline| now_ms > deadline)
            {
                return Ok(RetryReservation::Exhausted(existing.clone()));
            }
            existing.attempts_reserved += 1;
            existing.last_reservation_at_ms = now_ms;
            return Ok(RetryReservation::Reserved(existing.clone()));
        }

        if kind != RetryReservationKind::Initial {
            return Err(corrupt(
                "automatic retry cannot create an episode without an initial attempt",
            ));
        }
        self.ensure_capacity(&key)?;
        let episode = RetryEpisode {
            episode_id: format!("retry_{}", Uuid::now_v7().simple()),
            key: key.clone(),
            witness_floor,
            first_attempt_reserved_at_ms: now_ms,
            first_failure_at_ms: None,
            attempts_reserved: 1,
            deadline_ms: None,
            manual_retry_id: None,
            last_reservation_at_ms: now_ms,
        };
        self.episodes.insert(key, episode.clone());
        Ok(RetryReservation::Reserved(episode))
    }

    pub fn record_failure(&mut self, key: &RetryEpisodeKey, now_ms: u64) -> SnapbackResult<()> {
        validate_counter(now_ms, "retry.failureAtMs", false)?;
        let episode = self
            .episodes
            .get_mut(key)
            .ok_or_else(|| corrupt("retry failure has no reserved episode"))?;
        let failure_origin = now_ms.max(episode.last_reservation_at_ms);
        if episode.first_failure_at_ms.is_none() {
            episode.first_failure_at_ms = Some(failure_origin);
            episode.deadline_ms = failure_origin
                .checked_add(AUTH_ERROR_RETRY_WINDOW_MS)
                .filter(|value| *value <= MAX_PROTOCOL_COUNTER);
            if episode.deadline_ms.is_none() {
                // An unrepresentable deadline cannot be treated as an
                // unbounded retry window.
                episode.deadline_ms = Some(failure_origin);
            }
        }
        self.clock_high_water_ms = self.clock_high_water_ms.max(now_ms);
        Ok(())
    }

    pub fn resolve(&mut self, key: &RetryEpisodeKey, proof: &CompositeWitness) -> bool {
        let Some(episode) = self.episodes.get(key) else {
            return false;
        };
        if !proof.covers(&episode.witness_floor) {
            return false;
        }
        self.episodes.remove(key);
        true
    }

    pub fn manual_retry(
        &mut self,
        key: &RetryEpisodeKey,
        manual_retry_id: impl Into<String>,
        now_ms: u64,
    ) -> SnapbackResult<RetryReservation> {
        let manual_retry_id = manual_retry_id.into();
        validate_opaque(&manual_retry_id, "manualRetryId")?;
        validate_counter(now_ms, "manualRetry.nowMs", false)?;
        let episode = self
            .episodes
            .get_mut(key)
            .ok_or_else(|| corrupt("manual retry has no unresolved episode"))?;
        if episode.manual_retry_id.as_deref() == Some(&manual_retry_id) {
            return Ok(RetryReservation::Attached(episode.clone()));
        }
        episode.episode_id = format!("retry_{}", Uuid::now_v7().simple());
        episode.first_attempt_reserved_at_ms = now_ms;
        episode.first_failure_at_ms = None;
        episode.attempts_reserved = 1;
        episode.deadline_ms = None;
        episode.manual_retry_id = Some(manual_retry_id);
        episode.last_reservation_at_ms = now_ms;
        self.clock_high_water_ms = self.clock_high_water_ms.max(now_ms);
        Ok(RetryReservation::Reserved(episode.clone()))
    }

    fn ensure_capacity(&self, key: &RetryEpisodeKey) -> SnapbackResult<()> {
        let per_store = self
            .episodes
            .keys()
            .filter(|candidate| {
                candidate.authority_subject == key.authority_subject
                    && candidate.client_store_id == key.client_store_id
            })
            .count();
        if self.episodes.len() >= AUTH_RETRY_EPISODE_MAX_GLOBAL
            || per_store >= AUTH_RETRY_EPISODE_MAX_PER_AUTH_STORE
        {
            return Err(invalidation_error(
                "SNAPBACK_AUTH_RETRY_EPISODE_CAPACITY",
                "authorization retry episode storage is at its fail-closed capacity",
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const INCARNATION: &str = "018f0d90-7b11-7a22-8c33-445566778899";

    fn issuer() -> IssuerId {
        IssuerId {
            authorization_incarnation: INCARNATION.to_owned(),
            boot_sequence: 7,
            boot_nonce: URL_SAFE_NO_PAD.encode([3_u8; 16]),
        }
    }

    fn namespace(instance: u64) -> QueryNamespace {
        QueryNamespace {
            client_store_id: "store-A".to_owned(),
            query_key: "todos:{}".to_owned(),
            query_instance_id: instance,
        }
    }

    fn scope(instance: u64) -> ScopeId {
        ScopeId::Subscription {
            issuer_id: issuer(),
            namespace: namespace(instance),
            scope_sequence: 3,
            connection_generation: 5,
            subscription_id: format!("sub-{instance}"),
        }
    }

    fn witness(version: u64) -> CompositeWitness {
        CompositeWitness {
            authorization: AuthorizationVersion {
                incarnation: INCARNATION.to_owned(),
                epoch: 4,
            },
            data: Some(DataWitness {
                version_stream: "stream-A".to_owned(),
                min_commit_version: version,
            }),
        }
    }

    fn registry() -> ObligationRegistry {
        ObligationRegistry::new(ObligationExpectation {
            authorization: witness(0).authorization,
            version_stream: Some("stream-A".to_owned()),
            issuer_id: Some(issuer()),
        })
        .unwrap()
    }

    #[test]
    fn issuer_mac_binds_target_app_and_every_issuer_field() {
        let signer = IssuerAuthenticator::new("protocol-key", [7_u8; 32]).unwrap();
        let authenticated = signer.authenticate(issuer(), "local-dev", "app-A").unwrap();
        signer.verify(&authenticated, "local-dev", "app-A").unwrap();
        assert!(signer.verify(&authenticated, "hosted", "app-A").is_err());
        let mut forged = authenticated.clone();
        forged.issuer_id.boot_sequence += 1;
        assert!(signer.verify(&forged, "local-dev", "app-A").is_err());
    }

    #[test]
    fn semantic_causes_are_idempotent_and_revisions_merge_monotonically() {
        let mut registry = registry();
        let first = registry
            .raise(
                scope(1),
                100,
                "commit-100",
                InvalidationDisposition::Quarantine,
                witness(100),
                None,
            )
            .unwrap();
        assert_eq!(first.revision, 1);
        let duplicate = registry
            .raise(
                scope(1),
                100,
                "commit-100",
                InvalidationDisposition::Quarantine,
                witness(100),
                None,
            )
            .unwrap();
        assert_eq!(duplicate.revision, 1);
        let second = registry
            .raise(
                scope(1),
                105,
                "commit-105",
                InvalidationDisposition::Delete,
                witness(105),
                None,
            )
            .unwrap();
        assert_eq!(second.revision, 2);
        assert_eq!(second.max_disposition, InvalidationDisposition::Delete);
        assert_eq!(second.witness.data.unwrap().min_commit_version, 105);
    }

    #[test]
    fn acknowledgement_is_exact_revision_and_after_commit_only() {
        let mut registry = registry();
        let pending = registry
            .raise(
                scope(1),
                100,
                "commit-100",
                InvalidationDisposition::Quarantine,
                witness(100),
                None,
            )
            .unwrap();
        assert!(
            registry
                .issue_resolution(&pending.scope_id, ResolutionKind::Snapshot, witness(99))
                .is_err()
        );
        let ticket = registry
            .issue_resolution(&pending.scope_id, ResolutionKind::Snapshot, witness(100))
            .unwrap();
        assert!(registry.acknowledge(&ticket.ack_token, false).is_err());

        registry
            .raise(
                scope(1),
                105,
                "commit-105",
                InvalidationDisposition::Quarantine,
                witness(105),
                None,
            )
            .unwrap();
        assert_eq!(
            registry.acknowledge(&ticket.ack_token, true).unwrap(),
            AcknowledgeOutcome::Stale
        );
        let ticket = registry
            .issue_resolution(&scope(1), ResolutionKind::Snapshot, witness(105))
            .unwrap();
        assert_eq!(
            registry.acknowledge(&ticket.ack_token, true).unwrap(),
            AcknowledgeOutcome::Discharged
        );
        assert_eq!(
            registry.acknowledge(&ticket.ack_token, true).unwrap(),
            AcknowledgeOutcome::Duplicate
        );
    }

    #[test]
    fn distinct_scope_revision_domains_coexist() {
        let mut registry = registry();
        for sequence in 1..=5 {
            registry
                .raise(
                    scope(1),
                    sequence,
                    format!("cause-{sequence}"),
                    InvalidationDisposition::Quarantine,
                    witness(sequence),
                    None,
                )
                .unwrap();
        }
        let other = registry
            .raise(
                scope(2),
                1,
                "other-1",
                InvalidationDisposition::Quarantine,
                witness(1),
                None,
            )
            .unwrap();
        assert_eq!(registry.pending(&scope(1)).unwrap().revision, 5);
        assert_eq!(other.revision, 1);
    }

    fn retry_key(name: &str) -> RetryEpisodeKey {
        RetryEpisodeKey {
            authority_subject: "user-A".to_owned(),
            client_store_id: "store-A".to_owned(),
            query_key: name.to_owned(),
        }
    }

    #[test]
    fn retry_episode_budget_does_not_reset_on_refire_or_new_revision() {
        let mut retries = RetryEpisodeRegistry::default();
        let key = retry_key("todos:{}");
        let first = retries
            .reserve(
                key.clone(),
                witness(100),
                1_000,
                RetryReservationKind::Initial,
            )
            .unwrap();
        assert!(matches!(first, RetryReservation::Reserved(_)));
        retries.record_failure(&key, 1_100).unwrap();
        let attached = retries
            .reserve(
                key.clone(),
                witness(105),
                1_200,
                RetryReservationKind::Initial,
            )
            .unwrap();
        assert!(matches!(attached, RetryReservation::Attached(_)));
        for now in [1_300, 1_400] {
            assert!(matches!(
                retries
                    .reserve(
                        key.clone(),
                        witness(105),
                        now,
                        RetryReservationKind::Automatic,
                    )
                    .unwrap(),
                RetryReservation::Reserved(_)
            ));
            retries.record_failure(&key, now).unwrap();
        }
        assert!(matches!(
            retries
                .reserve(
                    key.clone(),
                    witness(105),
                    1_500,
                    RetryReservationKind::Automatic,
                )
                .unwrap(),
            RetryReservation::Exhausted(_)
        ));
        assert!(!retries.resolve(&key, &witness(104)));
        assert!(retries.resolve(&key, &witness(105)));
    }

    #[test]
    fn manual_retry_is_idempotent_and_replaces_without_double_counting() {
        let mut retries = RetryEpisodeRegistry::default();
        let key = retry_key("todos:{}");
        retries
            .reserve(key.clone(), witness(1), 1, RetryReservationKind::Initial)
            .unwrap();
        let first = retries.manual_retry(&key, "manual-1", 2).unwrap();
        let duplicate = retries.manual_retry(&key, "manual-1", 3).unwrap();
        let RetryReservation::Reserved(first) = first else {
            panic!("manual retry must reserve")
        };
        let RetryReservation::Attached(duplicate) = duplicate else {
            panic!("duplicate manual retry must attach")
        };
        assert_eq!(first.episode_id, duplicate.episode_id);
        assert_eq!(retries.episodes.len(), 1);
    }
}
