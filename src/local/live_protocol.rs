use super::*;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct LiveSubscribeInput {
    pub connection_id: String,
    #[serde(default)]
    pub input: HandlerInput,
    /// Store-owned identity for an auth-scoped live materialization (LLP 0096
    /// §2.2, `authorizationNamespace`). `clientStoreId` is stable for the
    /// durable store shared by every context that shares these bytes;
    /// `queryKey` is that store's canonical function-plus-arguments key; and
    /// `queryInstanceId` comes from a never-reused store-wide durable monotone
    /// allocator (or a never-reused process allocator for live-only state).
    /// It is ignored for explicitly authority-independent functions and
    /// required in sessions mode for every other live function.
    #[serde(
        default,
        rename = "authorizationNamespace",
        alias = "authorization_namespace"
    )]
    pub authorization_namespace: Option<QueryNamespace>,
    /// Explicit supersession (ENG-22478 review fix A): the kit names the
    /// subscription its OWN resubscribe replaces; the server disposes exactly
    /// that id. Plain duplicate subscribes (two components sharing a query)
    /// coexist — supersession is never inferred from matching identity.
    #[serde(default)]
    pub supersedes: Option<String>,
    /// RQS token resume (LLP 0091 §0B.4): not a new route — the token seeds
    /// this ordinary subscribe. Admission per LLP 0090 D1.1; every refusal
    /// answers with rung 3 (a fresh snapshot), never a subscription failure.
    #[serde(
        default,
        rename = "resumeFromToken",
        alias = "resume_from_token",
        skip_serializing_if = "Option::is_none"
    )]
    pub resume_from_token: Option<ResumeFromToken>,
}

/// Transport-only wrapper for optional call-time generation binding. Keeping
/// the assertion outside `LiveSubscribeInput` leaves internal/bundle-created
/// subscriptions on the explicitly unchecked compatibility path.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct LiveSubscribeRequest {
    #[serde(flatten)]
    pub input: LiveSubscribeInput,
    #[serde(
        default,
        rename = "expectedGeneration",
        alias = "expected_generation",
        skip_serializing_if = "Option::is_none"
    )]
    pub expected_generation: Option<ArtifactGeneration>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct LiveSubscribeOutput {
    pub subscription_id: String,
    /// Server-derived active sessions artifact identity. Absent on dev, even
    /// when a generated v0 reference carried an ignored assertion.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub facts: Option<FunctionInvocationFacts>,
    /// Absent exactly when the subscribe was answered without rows (LLP 0090
    /// D1.3): rung-1 `CurrentAsOf` (held rows are current) or rung-2 delta
    /// replay (the witness verified). The answer rides the durable lane —
    /// the `current_as_of` or replay `live_delta` envelope carries the fresh
    /// token. Only a resume-capable caller can receive the absent form.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<QueryOutput>,
    /// Optional additive carrier on the open LLP 0094 LiveSubscribeOutput
    /// family. The proof's signed preimage is the closed LLP 0157 record; this
    /// envelope member conveys it without changing those semantic bytes.
    // @ref LLP 0157#d3--the-completeness-witness — 0094 may select an envelope carrier but cannot alter the proof preimage.
    #[serde(
        default,
        rename = "completenessProof",
        skip_serializing_if = "Option::is_none"
    )]
    pub completeness_proof: Option<crate::contract_types::CompletenessProofV1>,
    /// Exact owner-produced preimage named by `completenessProof`'s witness
    /// digest. This additive member is transported beside the signed proof so
    /// a client can validate the authorization fence before installing result
    /// bytes; it is never accepted as a trust root on its own.
    // @ref LLP 0157#d3--the-completeness-witness — the digest is meaningful only with the exact owner-produced witness preimage.
    #[serde(
        default,
        rename = "authorizationWitness",
        skip_serializing_if = "Option::is_none"
    )]
    pub authorization_witness: Option<crate::auth::invalidation::AuthorizationWitnessRecordV1>,
    /// Fresh resume token for `rqsEligible` subscriptions answered with rows
    /// (the "initial `LiveReplace`" mint of LLP 0091 §0A.5 on this arm).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resume: Option<ResumeWire>,
    /// Per-cause `SNAPBACK_RESUME_*` code when a presented token was refused
    /// (LLP 0091 §0B.6) — an observability fact; the subscribe itself
    /// succeeded with rung 3.
    #[serde(
        default,
        rename = "resumeRefusal",
        skip_serializing_if = "Option::is_none"
    )]
    pub resume_refusal: Option<String>,
    /// Response witness for a successful explicit `supersedes` request. The
    /// exact predecessor id is echoed only after that subscription was
    /// disposed; clients must not infer disposal from subscribe success alone.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub superseded: Option<String>,
    /// Response witness for a presented `supersedes` id that was already
    /// absent. Together with `superseded`, this makes every presented
    /// supersession observable on the open subscribe-output family.
    #[serde(
        default,
        rename = "supersessionRefusal",
        skip_serializing_if = "Option::is_none"
    )]
    pub supersession_refusal: Option<String>,
    #[serde(default)]
    #[schemars(schema_with = "portable_permission_epoch_map_schema")]
    pub permission_epochs: BTreeMap<String, u64>,
    /// Server half of the 'established' receipt (LLP 0034 §3.2, ENG-22478).
    // @ref LLP 0094#0d--subscription-receipt-typing-implemented — the typed
    //   Receipt union rides the subscribe output; no longer an untyped seam.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub receipt: Option<Receipt>,
    #[serde(
        default,
        rename = "authorizationScope",
        skip_serializing_if = "Option::is_none"
    )]
    pub authorization_scope: Option<ScopeId>,
    #[serde(
        default,
        rename = "authorizationInvalidation",
        skip_serializing_if = "Option::is_none"
    )]
    pub authorization_invalidation: Option<AuthorizationInvalidationProjection>,
    #[serde(
        default,
        rename = "scopeRetirements",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub scope_retirements: Vec<ScopeRetirement>,
    /// Server-derived attribution for the authority that established this
    /// subscription (LLP 0055 §Audit): present exactly when a service
    /// principal resolved, absent otherwise. It is immutable subscription
    /// metadata — a renewal resubscribe answers with this same block, and a
    /// wrapper that did not receive it carries no attribution authority.
    ///
    /// @ref LLP 0094#0c6-response-shape-divergences-audited-at-137dee8c-defects-not-contract — the live establishment/renewal seam admits
    ///   `attribution` explicitly, like the mutation envelope's item-4
    ///   convergence; hosted (which refuses `servicePrincipal`) never emits
    ///   it and never synthesizes one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attribution: Option<FunctionAttribution>,
}

#[derive(Clone, Debug)]
pub(crate) struct LiveTransportPublication<T> {
    pub(crate) output: T,
    pub(crate) authorization: Option<crate::storage::AuthorizationVersion>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct LiveResumeInput {
    pub subscription_id: String,
    pub connection_id: String,
    #[serde(default)]
    pub auth: AuthInput,
    #[serde(
        default,
        rename = "recorded_permission_epochs",
        alias = "recordedPermissionEpochs"
    )]
    #[schemars(schema_with = "portable_permission_epoch_map_schema")]
    pub recorded_permission_epochs: BTreeMap<String, u64>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct LiveResumeOutput {
    pub subscription_id: String,
    pub mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<QueryOutput>,
    #[serde(default)]
    #[schemars(schema_with = "portable_permission_epoch_map_schema")]
    pub permission_epochs: BTreeMap<String, u64>,
    #[serde(
        default,
        rename = "authorizationScope",
        skip_serializing_if = "Option::is_none"
    )]
    pub authorization_scope: Option<ScopeId>,
    #[serde(
        default,
        rename = "authorizationInvalidation",
        skip_serializing_if = "Option::is_none"
    )]
    pub authorization_invalidation: Option<AuthorizationInvalidationProjection>,
    #[serde(
        default,
        rename = "scopeRetirements",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub scope_retirements: Vec<ScopeRetirement>,
    /// The establishment attribution block, carried unchanged across
    /// renew/resubscribe (see [`LiveSubscribeOutput::attribution`]). Derived
    /// from the subscription's retained establishment authority, never from
    /// the caller presenting the resume.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attribution: Option<FunctionAttribution>,
}

fn portable_permission_epoch_map_schema(
    _generator: &mut schemars::SchemaGenerator,
) -> schemars::Schema {
    schemars::json_schema!({
        "type": "object",
        "additionalProperties": {
            "type": "integer",
            "format": "uint64",
            "minimum": 0,
            "maximum": crate::manifest::PORTABLE_STORAGE_VERSION_MAX
        }
    })
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct LiveUnsubscribeInput {
    pub subscription_id: String,
    pub connection_id: String,
    #[serde(default)]
    pub auth: AuthInput,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct LiveUnsubscribeOutput {
    pub subscription_id: String,
    pub disposed: bool,
    // @ref LLP 0094#0d--subscription-receipt-typing-implemented — typed
    //   Receipt on the unsubscribe output, matching the subscribe half.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub receipt: Option<Receipt>,
    #[serde(
        default,
        rename = "scopeRetirement",
        skip_serializing_if = "Option::is_none"
    )]
    pub scope_retirement: Option<ScopeRetirement>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorizationInvalidationAckInput {
    pub connection_id: String,
    pub ack_token: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorizationInvalidationAckOutput {
    pub outcome: String,
}

/// An explicit operator/user retry names one exact live query and one fresh
/// idempotency key. The server derives the durable retry key from the retained
/// subscription authority; no caller-provided authority subject or canonical
/// query key is trusted.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorizationInvalidationManualRetryInput {
    pub connection_id: String,
    pub subscription_id: String,
    pub manual_retry_id: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorizationInvalidationManualRetryOutput {
    pub outcome: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_episode_id: Option<String>,
}
