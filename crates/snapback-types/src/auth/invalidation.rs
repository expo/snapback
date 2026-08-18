use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::storage::{AuthorizationVersion, MAX_AUTHORIZATION_EPOCH};
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

pub const AUTH_INVALIDATION_PROTOCOL_VERSION: u32 = 1;

pub const MAX_PROTOCOL_COUNTER: u64 = MAX_AUTHORIZATION_EPOCH;

pub fn invalidation_error(code: &'static str, message: impl Into<String>) -> SnapbackError {
    SnapbackError::error(code, "auth", message.into())
}

pub fn corrupt(message: impl Into<String>) -> SnapbackError {
    invalidation_error("SNAPBACK_AUTH_INVALIDATION_CORRUPT", message)
}

pub fn validate_counter(value: u64, field: &str, positive: bool) -> SnapbackResult<()> {
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

pub fn validate_uuid_v7(value: &str, field: &str) -> SnapbackResult<()> {
    if crate::ids::is_minted_identifier(value) {
        return Ok(());
    }
    Err(corrupt(format!("{field} is not a Snapback identifier")))
}

pub fn validate_opaque(value: &str, field: &str) -> SnapbackResult<()> {
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


/// A boot identity is never reused, even when process-local counters restart.
#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IssuerId {
    pub authorization_incarnation: String,
    #[schemars(range(min = 1, max = MAX_PROTOCOL_COUNTER))]
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

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QueryNamespace {
    pub client_store_id: String,
    pub query_key: String,
    #[schemars(range(min = 1, max = MAX_PROTOCOL_COUNTER))]
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
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ScopeId {
    Subscription {
        issuer_id: IssuerId,
        namespace: QueryNamespace,
        #[schemars(range(min = 1, max = MAX_PROTOCOL_COUNTER))]
        scope_sequence: u64,
        #[schemars(range(min = 1, max = MAX_PROTOCOL_COUNTER))]
        connection_generation: u64,
        subscription_id: String,
    },
    Connection {
        issuer_id: IssuerId,
        #[schemars(range(min = 1, max = MAX_PROTOCOL_COUNTER))]
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

    pub fn issuer(&self) -> Option<&IssuerId> {
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
    #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
    pub min_commit_version: u64,
}

impl DataWitness {
    pub fn validate(&self) -> SnapbackResult<()> {
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

/// The authorization-witness record named by a completeness proof. The shape
/// lives here with [`CompositeWitness`] so sync-engine consumers never import
/// upward; construction/digest logic stays in `crate::completeness` with the
/// proof issuance coordinator (LLP 0199 worklist item 7).
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorizationWitnessRecordV1 {
    pub format: String,
    pub query_instance_id: u64,
    pub composite_witness: CompositeWitness,
}

impl CompositeWitness {
    pub fn validate(&self) -> SnapbackResult<()> {
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

    pub fn covers(&self, floor: &Self) -> bool {
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
    #[schemars(range(min = 1, max = MAX_PROTOCOL_COUNTER))]
    pub revision: u64,
    pub max_disposition: InvalidationDisposition,
    pub witness: CompositeWitness,
    pub retry_episode_id: Option<String>,
    /// Cleanup ownership for the client-side pending token. This is not part
    /// of scope/revision identity; retirement may finish only after this exact
    /// continuity ends (except an already-applied terminal delete).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner_continuity_id: Option<String>,
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
    #[schemars(range(min = 1, max = MAX_PROTOCOL_COUNTER))]
    pub revision: u64,
    pub witness: CompositeWitness,
    pub max_disposition: InvalidationDisposition,
    pub ack_token: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner_continuity_id: Option<String>,
}



/// One level-triggered live projection. Delivery is only a hint; the exact
/// obligation remains authoritative until the optional resolution ticket is
/// acknowledged after the client commits its local transition.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorizationInvalidationProjection {
    pub obligation: ResyncObligation,
    pub resolution: Option<ResolutionTicket>,
}
