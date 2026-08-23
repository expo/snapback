use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

use crate::manifest::{
    ArtifactGeneration, HandlerInput, MediaCommandInvocationV1, MutationSettlement,
    auth_fingerprint,
};

fn deserialize_optional_non_null<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

fn graph_captured_read_schema(generator: &mut schemars::SchemaGenerator) -> schemars::Schema {
    generator.subschema_for::<crate::manifest::GraphCapturedReadV1>()
}

pub const CAPTURED_READ_GRAPH_PAIRING_ERROR: &str =
    "captured read graph must be present exactly when kind is graphNode";

pub const SEQUENCE_MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

/// The one durable authorization-stream witness. The incarnation closes reset
/// and restore ABA; the JS-safe epoch advances for ordinary authorization
/// events within that stream.
///
/// @ref LLP 0053#the-authorization-version — v1 has one global durable pair.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AuthorizationVersion {
    pub incarnation: String,
    #[schemars(range(max = MAX_AUTHORIZATION_EPOCH))]
    pub epoch: u64,
}

/// JavaScript's largest exactly representable integer. The durable epoch
/// refuses at this boundary rather than wrapping or losing wire precision.
pub const MAX_AUTHORIZATION_EPOCH: u64 = 9_007_199_254_740_991;

/// Exact authorization state produced inside a caller-owned commit. `event`
/// is false for an ordinary/disjoint app commit, while `incarnation_rotated`
/// distinguishes destructive boundaries from epoch advances.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AuthorizationCommitWitness {
    pub version: AuthorizationVersion,
    pub event: bool,
    pub incarnation_rotated: bool,
    /// Stable LLP 0056 declaration ids whose writes contributed to this event.
    /// Empty for non-membership events and ordinary commits. The durable
    /// authorization version remains the one global pair LLP 0053 pins; this
    /// attribution exists for per-declaration blast-radius measurement.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub membership_declarations: Vec<String>,
}

/// The authority-relevant state of one membership row. Application-specific
/// roster columns and host-private provenance deliberately stay out of the
/// transition receipt; the subject and scope are carried separately.
///
/// @ref LLP 0240#d3-generate-the-ordinary-roster-and-role-surface — mutation
///   receipts expose predecessor/successor authority state without making
///   private membership metadata application-visible.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorityMembershipStateV1 {
    pub role: String,
    pub status: AuthorityMembershipStatusV1,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum AuthorityMembershipStatusV1 {
    Active,
    Invited,
}

/// Whether the exact commit advanced the durable authorization generation.
/// Preview is explicit because dry-run executes the same storage plan but
/// intentionally rolls it back.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum AuthorityInvalidationDispositionV1 {
    GlobalAuthorizationEpochAdvanced,
    NoAuthorizationEvent,
    PreviewRolledBack,
}

/// One affected subject in a writer-seam membership commit. Atomic operations
/// such as `transferOwner` return one receipt per changed subject, all carrying
/// the disposition of their shared commit.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorityTransitionReceiptV1 {
    pub declaration: String,
    pub predecessor: Option<AuthorityMembershipStateV1>,
    pub successor: Option<AuthorityMembershipStateV1>,
    pub subject: String,
    pub scope: Option<String>,
    pub invalidation_disposition: AuthorityInvalidationDispositionV1,
}

/// Durable identity for one queued client mutation. The server stores this in
/// the same SQLite transaction as the mutation result, closing the
/// response-loss/reconnect duplicate window (LLP 0043 M2).
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClientMutationIdentity {
    pub id: String,
    pub function: String,
    pub auth_fingerprint: String,
    pub authority_instance_id: String,
    pub input_fingerprint: String,
    /// Digest of the exact schema/function generation selected for an
    /// issuance-bearing operation. It is retained separately from the input
    /// collision digest so the envelope can compare today's policy artifact
    /// before interpreting its plan.
    pub artifact_generation_digest: Option<String>,
    /// Authenticated LLP 0163 issuance facts. Existing protocol clients leave
    /// this absent and therefore remain outside envelope coverage until the
    /// range carrier/negotiation amendment lands.
    pub operation_issuance: Option<crate::commit_envelope::OperationIssuanceV1>,
}

const TEST_CLIENT_MUTATION_AUTHORITY_INSTANCE_ID: &str = "018f0d90-7b24-7a22-8c33-445566778899";

impl ClientMutationIdentity {
    pub fn new(id: impl Into<String>, function: impl Into<String>, input: &HandlerInput) -> Self {
        Self::for_authority(
            id,
            function,
            input,
            TEST_CLIENT_MUTATION_AUTHORITY_INSTANCE_ID,
        )
    }

    pub fn for_authority(
        id: impl Into<String>,
        function: impl Into<String>,
        input: &HandlerInput,
        authority_instance_id: impl Into<String>,
    ) -> Self {
        Self::for_authority_with_settlement(
            id,
            function,
            input,
            authority_instance_id,
            &MutationSettlement::default(),
        )
    }

    pub fn for_authority_with_settlement(
        id: impl Into<String>,
        function: impl Into<String>,
        input: &HandlerInput,
        authority_instance_id: impl Into<String>,
        settlement: &MutationSettlement,
    ) -> Self {
        Self {
            id: id.into(),
            function: function.into(),
            auth_fingerprint: auth_fingerprint(&input.auth),
            authority_instance_id: authority_instance_id.into(),
            // @ref LLP 0133#exactly-once-identity-under-the-new-semantics —
            //   every settle-time policy fact shares the durable collision
            //   boundary with args/readSet/ctxLedger.
            input_fingerprint: mutation_input_fingerprint(input, settlement),
            artifact_generation_digest: None,
            operation_issuance: None,
        }
    }

    pub fn with_operation_issuance(
        mut self,
        issuance: crate::commit_envelope::OperationIssuanceV1,
    ) -> Self {
        self.operation_issuance = Some(issuance);
        self
    }

    /// Bind the closed generated media-command carrier into the same durable
    /// collision boundary as args and settlement facts. A response-loss retry
    /// can therefore recover only the exact attempt/item/principal plan.
    pub fn with_media_command(mut self, invocation: &MediaCommandInvocationV1) -> Self {
        let canonical = canonical_json(json!({
            "inputFingerprint": self.input_fingerprint,
            "mediaCommand": invocation,
        }));
        let mut digest = Sha256::new();
        digest.update(b"snapback:client-mutation-media-command:v1\n");
        digest.update(
            serde_json::to_vec(&canonical).expect("media-command mutation identity serializes"),
        );
        self.input_fingerprint = format!("sha256:{:x}", digest.finalize());
        self
    }

    pub fn with_artifact_generation(mut self, generation: &ArtifactGeneration) -> Self {
        self.artifact_generation_digest = Some(operation_artifact_generation_digest(generation));
        let canonical = canonical_json(json!({
            "artifactGeneration": generation,
            "inputFingerprint": self.input_fingerprint,
        }));
        let mut digest = Sha256::new();
        digest.update(b"snapback:client-mutation-artifact-binding:v1\n");
        digest.update(
            serde_json::to_vec(&canonical).expect("artifact-bound mutation identity serializes"),
        );
        self.input_fingerprint = format!("sha256:{:x}", digest.finalize());
        self
    }

    /// Provenance-only digest of the exact server-constructed durable
    /// settlement identity. The activity row never receives the opaque
    /// client mutation id or its authority/input fingerprints in cleartext.
    pub fn activity_digest(&self) -> String {
        let canonical = canonical_json(match &self.operation_issuance {
            Some(issuance) => json!({
                "authFingerprint": self.auth_fingerprint,
                "authorityInstanceId": self.authority_instance_id,
                "clientMutationId": self.id,
                "function": self.function,
                "inputFingerprint": self.input_fingerprint,
                "artifactGenerationDigest": self.artifact_generation_digest,
                "operationIssuance": issuance,
            }),
            None => json!({
                "authFingerprint": self.auth_fingerprint,
                "authorityInstanceId": self.authority_instance_id,
                "clientMutationId": self.id,
                "function": self.function,
                "inputFingerprint": self.input_fingerprint,
            }),
        });
        let encoded =
            serde_json::to_vec(&canonical).expect("client mutation identity JSON serializes");
        let mut digest = Sha256::new();
        digest.update(b"snapback:client-mutation-identity:v1\n");
        digest.update(encoded);
        format!("sha256:{:x}", digest.finalize())
    }
}

pub fn operation_artifact_generation_digest(generation: &ArtifactGeneration) -> String {
    let canonical =
        canonical_json(serde_json::to_value(generation).expect("artifact generation serializes"));
    let mut digest = Sha256::new();
    digest.update(b"snapback:operation-artifact-generation:v1\n");
    digest.update(serde_json::to_vec(&canonical).expect("JSON value serializes"));
    format!("sha256:{:x}", digest.finalize())
}

fn mutation_input_fingerprint(input: &HandlerInput, settlement: &MutationSettlement) -> String {
    let value = if settlement == &MutationSettlement::default() {
        json!({
            "args": input.args,
            "readSet": input.read_set,
            "ctxLedger": input.ctx_ledger,
        })
    } else {
        json!({
            "args": input.args,
            "readSet": input.read_set,
            "ctxLedger": input.ctx_ledger,
            "settlement": settlement,
        })
    };
    let value = canonical_json(value);
    let encoded = serde_json::to_vec(&value).expect("mutation identity JSON serializes");
    let mut digest = Sha256::new();
    digest.update(encoded);
    format!("sha256:{:x}", digest.finalize())
}

fn canonical_json(value: Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(key, value)| (key, canonical_json(value)))
                .collect::<BTreeMap<_, _>>()
                .into_iter()
                .collect(),
        ),
        Value::Array(items) => Value::Array(items.into_iter().map(canonical_json).collect()),
        other => other,
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, schemars::JsonSchema)]
#[schemars(extend(
    "allOf" = [{
        "if": {
            "properties": { "kind": { "const": "graphNode" } },
            "required": ["kind"]
        },
        "then": { "required": ["graph"] },
        "else": { "not": { "required": ["graph"] } }
    }]
))]
pub struct CapturedReadDependency {
    pub kind: CapturedReadKind,
    /// Additive graph-specific dependency detail. Required exactly for
    /// `GraphNode` and absent for every shipped read kind.
    ///
    /// @ref LLP 0209#51-captured-vocabulary-by-normalized-node — graph reads
    /// carry one closed node-specific payload beside the shared top-level kind.
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    #[schemars(schema_with = "graph_captured_read_schema")]
    pub graph: Option<crate::manifest::GraphCapturedReadV1>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub table: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub predicate: Option<Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rows: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub boundary: Option<Value>,
}

impl CapturedReadDependency {
    pub fn graph_pairing_is_valid(&self) -> bool {
        matches!(
            (&self.kind, &self.graph),
            (CapturedReadKind::GraphNode, Some(_))
        ) || (!matches!(&self.kind, CapturedReadKind::GraphNode) && self.graph.is_none())
    }
}

impl<'de> Deserialize<'de> for CapturedReadDependency {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        #[derive(Deserialize)]
        struct Wire {
            kind: CapturedReadKind,
            #[serde(default, deserialize_with = "deserialize_optional_non_null")]
            graph: Option<crate::manifest::GraphCapturedReadV1>,
            table: Option<String>,
            id: Option<String>,
            version: Option<u64>,
            predicate: Option<Value>,
            #[serde(default)]
            rows: Vec<String>,
            field: Option<String>,
            value: Option<Value>,
            order: Option<Value>,
            limit: Option<usize>,
            result_count: Option<usize>,
            boundary: Option<Value>,
        }

        let wire = Wire::deserialize(deserializer)?;
        let dependency = Self {
            kind: wire.kind,
            graph: wire.graph,
            table: wire.table,
            id: wire.id,
            version: wire.version,
            predicate: wire.predicate,
            rows: wire.rows,
            field: wire.field,
            value: wire.value,
            order: wire.order,
            limit: wire.limit,
            result_count: wire.result_count,
            boundary: wire.boundary,
        };
        if dependency.graph_pairing_is_valid() {
            Ok(dependency)
        } else {
            Err(serde::de::Error::custom(CAPTURED_READ_GRAPH_PAIRING_ERROR))
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum CapturedReadKind {
    Row,
    MissingRow,
    Query,
    Auth,
    Permission,
    GraphNode,
}

/// One tentative sequence value. It is returned during handler execution but
/// becomes a fact only if this exact identity/value transition commits.
///
/// @ref LLP 0135#13-allocation-versus-commit-ordering-and-gap-semantics — the
///   counter advance is buffered and commits or rolls back with app writes.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SequenceAllocationFact {
    pub counter: String,
    pub scope_table: String,
    pub scope_row_id: String,
    pub scope_incarnation: String,
    #[schemars(range(min = 1, max = SEQUENCE_MAX_SAFE_INTEGER))]
    pub value: u64,
}

pub mod watches;

#[cfg(test)]
mod tests {
    use super::*;

    fn graph_payload() -> Value {
        json!({
            "format":"snapback.graph-captured-read.v1",
            "graphPlanHash":"sha256:0000000000000000000000000000000000000000000000000000000000000000",
            "instanceHash":"sha256:0000000000000000000000000000000000000000000000000000000000000000",
            "nodeId":"n1",
            "nodeKind":"closed-projection",
            "authorityClass":1,
            "dependency":{"kind":"projection","sourceNodeIds":["n0"]}
        })
    }

    #[test]
    fn captured_read_graph_pairing_is_enforced_during_deserialization() {
        let missing = serde_json::from_value::<CapturedReadDependency>(json!({
            "kind":"graphNode"
        }))
        .unwrap_err();
        assert_eq!(missing.to_string(), CAPTURED_READ_GRAPH_PAIRING_ERROR);

        let legacy_with_graph = serde_json::from_value::<CapturedReadDependency>(json!({
            "kind":"auth",
            "graph":graph_payload()
        }))
        .unwrap_err();
        assert_eq!(
            legacy_with_graph.to_string(),
            CAPTURED_READ_GRAPH_PAIRING_ERROR
        );

        let valid = serde_json::from_value::<CapturedReadDependency>(json!({
            "kind":"graphNode",
            "graph":graph_payload()
        }))
        .expect("graph dependency with its payload decodes");
        assert!(valid.graph_pairing_is_valid());
    }

    #[test]
    fn captured_read_schema_states_graph_pairing() {
        let schema = serde_json::to_value(schemars::schema_for!(CapturedReadDependency)).unwrap();
        assert_eq!(
            schema["allOf"][0],
            json!({
                "if": {
                    "properties": { "kind": { "const": "graphNode" } },
                    "required": ["kind"]
                },
                "then": { "required": ["graph"] },
                "else": { "not": { "required": ["graph"] } }
            })
        );
    }
}
