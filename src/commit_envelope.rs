//! Rust-owned operation-identity and commit-envelope artifact contracts.
//!
//! This is the first LLP 0163 implementation slice: it fixes the physical
//! identity key, binds the already-shipped [`ClientMutationIdentity`] facts,
//! gives host-derived operations a distinct authenticated issuance shape, and
//! makes field applicability/retention explicit in `CommitEnvelopeV1`.
//!
//! It deliberately does not advertise coverage. Storage-table wiring, epoch
//! lifecycle, explanation authorization, and the acceptance corpus still gate
//! every LLP 0162 capability.
//!
//! @ref LLP 0163#contract-summary-normative-details-per-llp-0162-0-2 — one
//!   stream-qualified, originator-partitioned identity and envelope vocabulary.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::manifest::{REPLAY_OPAQUE_ID_MAX_BYTES, REPLAY_OPAQUE_ID_PATTERN};
use crate::storage::ClientMutationIdentity;

const SHA256_PATTERN: &str = "^sha256:[0-9a-f]{64}$";

#[derive(
    Clone, Copy, Debug, Deserialize, Eq, Hash, JsonSchema, Ord, PartialEq, PartialOrd, Serialize,
)]
#[serde(rename_all = "camelCase")]
pub enum OperationOriginatorClassV1 {
    Client,
    Host,
}

/// The physical key for suppression and envelope storage. Audience and all
/// other semantic facts are compared facts, never key components.
#[derive(
    Clone, Debug, Deserialize, Eq, Hash, JsonSchema, Ord, PartialEq, PartialOrd, Serialize,
)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OperationKeyV1 {
    pub stream_id: String,
    pub originator_class: OperationOriginatorClassV1,
    #[schemars(
        length(min = 1, max = REPLAY_OPAQUE_ID_MAX_BYTES),
        pattern(REPLAY_OPAQUE_ID_PATTERN)
    )]
    pub operation_id: String,
}

/// Issuance facts are structurally disjoint across client and host namespaces.
/// The authenticator is represented by its non-secret digest; admission later
/// verifies the underlying server-issued artifact before constructing this
/// value.
#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum OperationIssuanceV1 {
    ClientRange {
        epoch_id: String,
        counter: u64,
        range_start: u64,
        range_end_exclusive: u64,
        #[schemars(pattern(SHA256_PATTERN))]
        authority_authenticator_digest: String,
    },
    HostIncarnation {
        epoch_id: String,
        upstream_identity: String,
        commit_ordinal: u64,
        #[schemars(pattern(SHA256_PATTERN))]
        authority_authenticator_digest: String,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OperationBoundFactsV1 {
    pub audience: String,
    pub principal_fingerprint: String,
    pub authority_instance_id: String,
    pub operation_kind: String,
    pub function_or_command: String,
    #[schemars(pattern(SHA256_PATTERN))]
    pub input_fingerprint: String,
}

/// `operationId` widens the shipped client-mutation id; this struct preserves
/// every bound fact the existing collision check already owns.
#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OperationIdentityV1 {
    #[schemars(range(min = 1, max = 1))]
    pub schema_version: u32,
    pub key: OperationKeyV1,
    pub issuance: OperationIssuanceV1,
    pub bound_facts: OperationBoundFactsV1,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OperationIdentityComparison {
    Novel,
    ExactReplay,
    BoundFactsDiverged,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OperationIdentityValidationError {
    UnsupportedSchemaVersion,
    OriginatorIssuanceMismatch,
    EmptyStreamId,
    InvalidOperationId,
    InvalidClientRange,
    InvalidAuthenticatorDigest,
    InvalidInputFingerprint,
}

impl OperationIdentityV1 {
    pub const SCHEMA_VERSION: u32 = 1;

    pub fn from_client_mutation(
        stream_id: impl Into<String>,
        audience: impl Into<String>,
        issuance: OperationIssuanceV1,
        identity: &ClientMutationIdentity,
        operation_kind: impl Into<String>,
    ) -> Self {
        Self {
            schema_version: Self::SCHEMA_VERSION,
            key: OperationKeyV1 {
                stream_id: stream_id.into(),
                originator_class: OperationOriginatorClassV1::Client,
                operation_id: identity.id.clone(),
            },
            issuance,
            bound_facts: OperationBoundFactsV1 {
                audience: audience.into(),
                principal_fingerprint: identity.auth_fingerprint.clone(),
                authority_instance_id: identity.authority_instance_id.clone(),
                operation_kind: operation_kind.into(),
                function_or_command: identity.function.clone(),
                input_fingerprint: identity.input_fingerprint.clone(),
            },
        }
    }

    pub fn compare(&self, proposed: &Self) -> OperationIdentityComparison {
        if self.key != proposed.key {
            OperationIdentityComparison::Novel
        } else if self == proposed {
            OperationIdentityComparison::ExactReplay
        } else {
            OperationIdentityComparison::BoundFactsDiverged
        }
    }

    pub fn validate(&self) -> Result<(), OperationIdentityValidationError> {
        if self.schema_version != Self::SCHEMA_VERSION {
            return Err(OperationIdentityValidationError::UnsupportedSchemaVersion);
        }
        if self.key.stream_id.is_empty() {
            return Err(OperationIdentityValidationError::EmptyStreamId);
        }
        if !crate::manifest::replay_opaque_id_is_valid(&self.key.operation_id) {
            return Err(OperationIdentityValidationError::InvalidOperationId);
        }
        let issuance_matches = matches!(
            (self.key.originator_class, &self.issuance),
            (
                OperationOriginatorClassV1::Client,
                OperationIssuanceV1::ClientRange { .. }
            ) | (
                OperationOriginatorClassV1::Host,
                OperationIssuanceV1::HostIncarnation { .. }
            )
        );
        if !issuance_matches {
            return Err(OperationIdentityValidationError::OriginatorIssuanceMismatch);
        }
        if let OperationIssuanceV1::ClientRange {
            counter,
            range_start,
            range_end_exclusive,
            ..
        } = self.issuance
            && (range_start >= range_end_exclusive
                || counter < range_start
                || counter >= range_end_exclusive)
        {
            return Err(OperationIdentityValidationError::InvalidClientRange);
        }
        let authenticator = match &self.issuance {
            OperationIssuanceV1::ClientRange {
                authority_authenticator_digest,
                ..
            }
            | OperationIssuanceV1::HostIncarnation {
                authority_authenticator_digest,
                ..
            } => authority_authenticator_digest,
        };
        if !is_sha256(authenticator) {
            return Err(OperationIdentityValidationError::InvalidAuthenticatorDigest);
        }
        if !is_sha256(&self.bound_facts.input_fingerprint) {
            return Err(OperationIdentityValidationError::InvalidInputFingerprint);
        }
        Ok(())
    }
}

/// Deterministic, attempt-invariant host identity derivation. The admission
/// layer supplies the authenticated host-incarnation issuance facts separately.
pub fn derive_host_operation_id(upstream_identity: &str, commit_ordinal: u64) -> String {
    let mut digest = Sha256::new();
    digest.update(b"snapback:host-operation-identity:v1\n");
    digest.update(upstream_identity.as_bytes());
    digest.update(b"\n");
    digest.update(commit_ordinal.to_be_bytes());
    format!("host:{:x}", digest.finalize())
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SnapshotAssociationKindV1 {
    ProducedCommit,
    ObservedSnapshot,
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StreamQualifiedVersionV1 {
    pub stream_id: String,
    pub version: u64,
    pub association: SnapshotAssociationKindV1,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FactProvenanceV1 {
    ServerCaptured,
    ClientSuppliedValidated,
    ServerEvaluatedConditional,
}

/// Fields that exist only on a lane make non-applicability explicit instead of
/// overloading `null` or omission.
#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(tag = "applicability", content = "value", rename_all = "camelCase")]
pub enum LaneFactV1<T> {
    NotDefinedForLane,
    Defined(T),
}

/// Bounded detail never becomes an ambiguous empty fact set: truncation and
/// expiry are first-class states, and secret-bearing material is an opaque
/// protected-lane reference rather than inline cleartext.
#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(tag = "retention", rename_all = "camelCase", deny_unknown_fields)]
pub enum RetainedEnvelopeDetailV1 {
    InlineRedacted {
        detail: Value,
    },
    ProtectedLane {
        custody_reference: String,
        #[schemars(pattern(SHA256_PATTERN))]
        payload_digest: String,
        payload_bytes: u64,
    },
    Truncated,
    Expired,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnvelopeFactSetV1 {
    #[schemars(pattern(SHA256_PATTERN))]
    pub digest: String,
    pub count: u64,
    pub provenance: FactProvenanceV1,
    pub detail: RetainedEnvelopeDetailV1,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EffectEgressFamilyV1 {
    Fetch,
    Notification,
    Payment,
    Cron,
    Outbox,
    Uses,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum EffectSettlementCapabilityV1 {
    Transactional,
    ProviderIdempotent,
    ProviderQueryable,
    Compensatable,
    InherentlyAmbiguous,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnvelopeEffectFactsV1 {
    pub facts: EnvelopeFactSetV1,
    pub egress_families: Vec<EffectEgressFamilyV1>,
    pub settlement_capabilities: Vec<EffectSettlementCapabilityV1>,
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnvelopeAuthorityFactsV1 {
    pub audience: String,
    pub grant_or_policy_identity: LaneFactV1<String>,
    pub fencing_token_or_epoch: LaneFactV1<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum OperationReceiptStateV1 {
    Pending,
    Committed,
    Refused,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OperationReceiptV1 {
    pub state: OperationReceiptStateV1,
    #[schemars(pattern(SHA256_PATTERN))]
    pub receipt_digest: String,
    pub payload: RetainedEnvelopeDetailV1,
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnvelopeCoverageV1 {
    pub covered_lanes: Vec<String>,
    pub uncovered_lanes: Vec<String>,
    #[schemars(pattern(SHA256_PATTERN))]
    pub coverage_digest: String,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommitEnvelopeV1 {
    #[schemars(range(min = 1, max = 1))]
    pub schema_version: u32,
    pub identity: OperationIdentityV1,
    pub snapshot: StreamQualifiedVersionV1,
    pub principal_session_or_invocation_id: String,
    pub authority: EnvelopeAuthorityFactsV1,
    pub executable_artifact_digest: LaneFactV1<String>,
    #[schemars(pattern(SHA256_PATTERN))]
    pub argument_digest: String,
    pub plan_digest: LaneFactV1<String>,
    pub base_version: LaneFactV1<StreamQualifiedVersionV1>,
    pub read_set: EnvelopeFactSetV1,
    pub write_set: EnvelopeFactSetV1,
    pub ctx_answers: EnvelopeFactSetV1,
    pub effects: EnvelopeEffectFactsV1,
    pub receipt: OperationReceiptV1,
    pub coverage: EnvelopeCoverageV1,
    pub recorded_at_ms: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CommitEnvelopeValidationError {
    UnsupportedSchemaVersion,
    Identity(OperationIdentityValidationError),
    SnapshotStreamMismatch,
    AuthorityAudienceMismatch,
    InvalidDigest,
}

impl CommitEnvelopeV1 {
    pub const SCHEMA_VERSION: u32 = 1;

    pub fn validate(&self) -> Result<(), CommitEnvelopeValidationError> {
        if self.schema_version != Self::SCHEMA_VERSION {
            return Err(CommitEnvelopeValidationError::UnsupportedSchemaVersion);
        }
        self.identity
            .validate()
            .map_err(CommitEnvelopeValidationError::Identity)?;
        if self.snapshot.stream_id != self.identity.key.stream_id {
            return Err(CommitEnvelopeValidationError::SnapshotStreamMismatch);
        }
        if self.authority.audience != self.identity.bound_facts.audience {
            return Err(CommitEnvelopeValidationError::AuthorityAudienceMismatch);
        }
        let mut digests = vec![
            &self.argument_digest,
            &self.read_set.digest,
            &self.write_set.digest,
            &self.ctx_answers.digest,
            &self.effects.facts.digest,
            &self.receipt.receipt_digest,
            &self.coverage.coverage_digest,
        ];
        if let LaneFactV1::Defined(value) = &self.executable_artifact_digest {
            digests.push(value);
        }
        if let LaneFactV1::Defined(value) = &self.plan_digest {
            digests.push(value);
        }
        if digests.into_iter().any(|digest| !is_sha256(digest)) {
            return Err(CommitEnvelopeValidationError::InvalidDigest);
        }
        Ok(())
    }
}

fn is_sha256(value: &str) -> bool {
    value.len() == 71
        && value.starts_with("sha256:")
        && value[7..]
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::HandlerInput;

    fn sha(character: char) -> String {
        format!("sha256:{}", character.to_string().repeat(64))
    }

    fn client_identity() -> OperationIdentityV1 {
        let shipped = ClientMutationIdentity::new(
            "client-operation-1",
            "todos.create",
            &HandlerInput::default(),
        );
        OperationIdentityV1::from_client_mutation(
            "stream-1",
            "app-1",
            OperationIssuanceV1::ClientRange {
                epoch_id: "epoch-1".to_owned(),
                counter: 7,
                range_start: 0,
                range_end_exclusive: 16,
                authority_authenticator_digest: sha('a'),
            },
            &shipped,
            "ordinaryMutation",
        )
    }

    fn empty_facts() -> EnvelopeFactSetV1 {
        EnvelopeFactSetV1 {
            digest: sha('0'),
            count: 0,
            provenance: FactProvenanceV1::ServerCaptured,
            detail: RetainedEnvelopeDetailV1::InlineRedacted {
                detail: serde_json::json!([]),
            },
        }
    }

    fn envelope() -> CommitEnvelopeV1 {
        CommitEnvelopeV1 {
            schema_version: CommitEnvelopeV1::SCHEMA_VERSION,
            identity: client_identity(),
            snapshot: StreamQualifiedVersionV1 {
                stream_id: "stream-1".to_owned(),
                version: 1,
                association: SnapshotAssociationKindV1::ProducedCommit,
            },
            principal_session_or_invocation_id: "session-1".to_owned(),
            authority: EnvelopeAuthorityFactsV1 {
                audience: "app-1".to_owned(),
                grant_or_policy_identity: LaneFactV1::NotDefinedForLane,
                fencing_token_or_epoch: LaneFactV1::NotDefinedForLane,
            },
            executable_artifact_digest: LaneFactV1::Defined(sha('c')),
            argument_digest: sha('d'),
            plan_digest: LaneFactV1::NotDefinedForLane,
            base_version: LaneFactV1::NotDefinedForLane,
            read_set: empty_facts(),
            write_set: empty_facts(),
            ctx_answers: empty_facts(),
            effects: EnvelopeEffectFactsV1 {
                facts: empty_facts(),
                egress_families: Vec::new(),
                settlement_capabilities: Vec::new(),
            },
            receipt: OperationReceiptV1 {
                state: OperationReceiptStateV1::Committed,
                receipt_digest: sha('e'),
                payload: RetainedEnvelopeDetailV1::InlineRedacted {
                    detail: serde_json::json!({ "version": 1 }),
                },
            },
            coverage: EnvelopeCoverageV1 {
                covered_lanes: vec!["ordinaryMutation".to_owned()],
                uncovered_lanes: Vec::new(),
                coverage_digest: sha('f'),
            },
            recorded_at_ms: 1,
        }
    }

    #[test]
    fn physical_key_partitions_stream_and_originator_but_not_audience() {
        let client = client_identity();
        let mut divergent_audience = client.clone();
        divergent_audience.bound_facts.audience = "app-2".to_owned();
        assert_eq!(
            client.compare(&divergent_audience),
            OperationIdentityComparison::BoundFactsDiverged
        );

        let mut host = client.clone();
        host.key.originator_class = OperationOriginatorClassV1::Host;
        host.issuance = OperationIssuanceV1::HostIncarnation {
            epoch_id: "host-epoch-1".to_owned(),
            upstream_identity: "cron:occurrence-1".to_owned(),
            commit_ordinal: 0,
            authority_authenticator_digest: sha('b'),
        };
        assert_eq!(client.compare(&host), OperationIdentityComparison::Novel);

        let mut other_stream = client.clone();
        other_stream.key.stream_id = "stream-2".to_owned();
        assert_eq!(
            client.compare(&other_stream),
            OperationIdentityComparison::Novel
        );
    }

    #[test]
    fn host_namespace_requires_host_authenticated_issuance_shape() {
        let mut identity = client_identity();
        identity.key.originator_class = OperationOriginatorClassV1::Host;
        assert_eq!(
            identity.validate(),
            Err(OperationIdentityValidationError::OriginatorIssuanceMismatch)
        );
    }

    #[test]
    fn host_derivation_is_attempt_invariant_and_ordinal_separated() {
        let first = derive_host_operation_id("job:job-1:stable-key", 0);
        assert_eq!(first, derive_host_operation_id("job:job-1:stable-key", 0));
        assert_ne!(first, derive_host_operation_id("job:job-1:stable-key", 1));
        assert!(crate::manifest::replay_opaque_id_is_valid(&first));
    }

    #[test]
    fn envelope_requires_stream_and_audience_to_match_identity() {
        let envelope = envelope();
        assert_eq!(envelope.validate(), Ok(()));

        let mut wrong_stream = envelope.clone();
        wrong_stream.snapshot.stream_id = "stream-2".to_owned();
        assert_eq!(
            wrong_stream.validate(),
            Err(CommitEnvelopeValidationError::SnapshotStreamMismatch)
        );

        let mut wrong_audience = envelope;
        wrong_audience.authority.audience = "app-2".to_owned();
        assert_eq!(
            wrong_audience.validate(),
            Err(CommitEnvelopeValidationError::AuthorityAudienceMismatch)
        );
    }

    #[test]
    fn representative_envelope_round_trips_through_generated_schema() {
        let value = serde_json::to_value(envelope()).expect("envelope serializes");
        let schema = serde_json::to_value(schemars::schema_for!(CommitEnvelopeV1))
            .expect("schema serializes");
        let validator = jsonschema::validator_for(&schema).expect("schema compiles");
        assert!(validator.is_valid(&value));

        let mut wrong_version = value;
        wrong_version["schemaVersion"] = serde_json::json!(2);
        assert!(!validator.is_valid(&wrong_version));
    }
}
