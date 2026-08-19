use super::*;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct HealthResponse {
    pub ok: bool,
    pub target: String,
    pub sqlite_version: u64,
    pub ibex_available: bool,
    /// Closed auth-provider readiness. Missing/corrupt keyring details never
    /// cross the public health boundary.
    #[serde(rename = "authProvider", default)]
    pub auth_provider: crate::auth::runtime::AuthProviderHealth,
    /// Server-binary identity (ENG-22798): build/git provenance + a per-process
    /// startup nonce, so an externally started — possibly unprovisioned or
    /// schema-only — server is provenance-verifiable before any app bundle loads.
    ///
    /// @ref LLP 0031#server-binary-identity-on-health — build identity rides the
    /// ungated public /health; the reuse-provenance verdict falls back to it when
    /// bundle identity (`/inspect` appId/bundleHash) is unavailable.
    pub binary: crate::identity::BinaryIdentity,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct DiagnosticsResponse {
    pub diagnostics: Vec<Diagnostic>,
}

pub const ERROR_RESPONSE_FORMAT_VERSION: &str = "snapback.error-response.v1";

/// Must-understand version of the error-response envelope. Version 1 is
/// forward-additive: receivers accept and ignore unknown top-level members,
/// while rejecting an unknown `formatVersion`. This compatibility rule does
/// not define a remediation carrier; LLP 0146 OQ6 remains open.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub enum ErrorResponseFormatVersion {
    #[serde(rename = "snapback.error-response.v1")]
    #[default]
    V1,
}

/// Versioned non-2xx HTTP error envelope. For the recognized v1 format,
/// receivers MUST ignore unknown top-level members so additive metadata can
/// cross mixed-version deployments. `formatVersion` itself is must-understand.
/// No remediation member is defined here; LLP 0146 OQ6 remains unresolved.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct ErrorResponse {
    #[serde(rename = "formatVersion")]
    pub format_version: ErrorResponseFormatVersion,
    pub diagnostic: Diagnostic,
    /// Present only when a mutation reached the provider receipt boundary.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub receipt: Option<Receipt>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attribution: Option<FunctionAttribution>,
    /// Present on a governed hosted-ephemeral refusal when the server can
    /// safely identify the current connection-bound authority. This lets a
    /// client fence the refusal itself without accepting any later stale
    /// frame from the retired instance.
    #[serde(
        rename = "ephemeralAuthorityInstance",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    #[schemars(pattern(r"^eai1\.[A-Za-z0-9_-]{43}$"))]
    pub ephemeral_authority_instance: Option<String>,
}

/// Successful `POST /mutation/{name}` response. The mutation output and its
/// terminal receipt are one closed, typed envelope; rejected mutations keep
/// using [`ErrorResponse`] with the same receipt attached by the error path.
///
/// @ref LLP 0051#d4-finish-dk-7-the-live-envelope-becomes-schema-governed — direct
///   mutation results are part of the generated client-visible wire.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MutationResponse {
    #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
    pub version: u64,
    pub changed_count: usize,
    pub result: Value,
    #[serde(
        default,
        rename = "authorityTransitions",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub authority_transitions: Vec<crate::storage::AuthorityTransitionReceiptV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ctx_ledger: Option<CtxAnswerLedger>,
    /// The exact server-derived authority cohort that owns this settlement.
    /// Clients persist it with the ACK proof; it grants no authority.
    #[serde(rename = "authorityDescriptor")]
    pub authority_descriptor: AuthorityDescriptor,
    pub receipt: Receipt,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub facts: Option<FunctionInvocationFacts>,
    /// Server-derived attribution (LLP 0055). Admitted explicitly so the
    /// served bytes and the closed generated schema agree: the route used to
    /// flatten this member through `FunctionResponse<T>` while the committed
    /// `mutation.output.schema.json` did not admit it.
    ///
    /// @ref LLP 0094#0c6-response-shape-divergences-audited-at-137dee8c-defects-not-contract — item 4: the schema-side convergence; the schema
    ///   is generated from the envelope actually served.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attribution: Option<FunctionAttribution>,
}

/// Closed request carrier for the sole full-query lease issuance path. The
/// ordinary query fields stay at their usual top-level wire names so route
/// middleware sees body-carried dev authority in the same place; spelling the
/// complete v1 map here lets serde and the generated schema reject additions.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct AuthorizedLeaseQueryRequest {
    #[serde(default)]
    pub args: Value,
    #[serde(default)]
    pub auth: AuthInput,
    #[serde(default)]
    pub read_set: Vec<ReadDependency>,
    /// Opaque adapter-stitched correlation (LLP 0034 §3.2, ENG-22478): the
    /// Exact adapter's join keys (`actionInvocationId`, `optimisticWaveId`,
    /// `rootId`, `bindingIds`) live inside. The provider echoes it verbatim
    /// on receipts and never interprets it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub correlation: Option<Value>,
    /// Replay ledger (LLP 0051 D1): when present, the invocation runs in
    /// REPLAY mode — `ctx.runtime.now()` answers `ledger.now` and every
    /// host-generated id (`ctx.runtime.id()` and `ctx.db.insert` row ids)
    /// consumes `ledger.ids` in order. Consuming past the end is a typed
    /// divergence error. Additive: absent means record mode, today's
    /// behavior. Queries and mutations only; actions never carry one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ctx_ledger: Option<CtxAnswerLedger>,
    #[serde(
        default,
        rename = "expectedGeneration",
        alias = "expected_generation",
        skip_serializing_if = "Option::is_none"
    )]
    pub expected_generation: Option<ArtifactGeneration>,
    #[serde(rename = "leaseRequestId")]
    pub lease_request_id: String,
    #[serde(rename = "clientStoreId")]
    pub client_store_id: String,
    #[serde(rename = "queryKey")]
    pub query_key: String,
    #[serde(rename = "queryInstanceId")]
    #[schemars(range(
        min = 1,
        max = crate::auth::invalidation::MAX_PROTOCOL_COUNTER
    ))]
    pub query_instance_id: u64,
}

impl AuthorizedLeaseQueryRequest {
    pub(super) fn into_parts(
        self,
    ) -> (
        HandlerInput,
        Option<ArtifactGeneration>,
        AuthorizedLeaseRequestIdentity,
    ) {
        (
            HandlerInput {
                args: self.args,
                auth: self.auth,
                read_set: self.read_set,
                correlation: self.correlation,
                ctx_ledger: self.ctx_ledger,
            },
            self.expected_generation,
            AuthorizedLeaseRequestIdentity {
                lease_request_id: self.lease_request_id,
                client_store_id: self.client_store_id,
                query_key: self.query_key,
                query_instance_id: self.query_instance_id,
            },
        )
    }
}

/// Query rows and their authorization proof are one response boundary. The
/// client must commit both together or delete the attempted retained result.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorizedLeaseQueryResponse {
    #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
    pub version: u64,
    pub rows: Vec<Value>,
    pub authorized_lease: AuthorizedLease,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub facts: Option<FunctionInvocationFacts>,
    #[serde(
        default,
        rename = "completenessProof",
        skip_serializing_if = "Option::is_none"
    )]
    pub completeness_proof: Option<crate::completeness::CompletenessProofV1>,
    #[serde(
        default,
        rename = "authorizationWitness",
        skip_serializing_if = "Option::is_none"
    )]
    pub authorization_witness: Option<crate::completeness::AuthorizationWitnessRecordV1>,
}

impl AuthorizedLeaseQueryResponse {
    pub(super) fn from_parts(
        output: QueryOutput,
        authorized_lease: AuthorizedLease,
        facts: Option<FunctionInvocationFacts>,
        completeness: Option<crate::local::FiniteCompletenessCarrier>,
    ) -> Self {
        // A retained authorized snapshot is decode-only (LLP 0080 §4): a
        // relational continuation cursor never rides the lease envelope, so
        // it is deliberately dropped here rather than silently flattened in.
        let QueryOutput {
            version,
            rows,
            cursor: _,
        } = output;
        let (completeness_proof, authorization_witness) = completeness
            .map_or((None, None), |carrier| {
                let (proof, witness) = carrier.into_parts();
                (Some(proof), Some(witness))
            });
        Self {
            version,
            rows,
            authorized_lease,
            facts,
            completeness_proof,
            authorization_witness,
        }
    }
}

impl MutationResponse {
    pub(super) fn from_output(
        output: MutationOutput,
        receipt: Receipt,
        attribution: Option<FunctionAttribution>,
        authority_descriptor: AuthorityDescriptor,
        facts: Option<FunctionInvocationFacts>,
    ) -> Self {
        // Exhaustive destructuring makes an added MutationOutput field a
        // compile error here instead of silent drift in the public envelope.
        let MutationOutput {
            version,
            changed_count,
            result,
            authority_transitions,
            ctx_ledger,
            settlement_mint_observations: _,
            settlement_time_observation: _,
            settlement_sequence_allocations: _,
        } = output;
        Self {
            version,
            changed_count,
            result,
            authority_transitions,
            ctx_ledger,
            authority_descriptor,
            receipt,
            facts,
            attribution,
        }
    }
}
