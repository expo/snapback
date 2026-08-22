use super::*;

#[derive(Debug)]
pub struct ApiError(
    pub(super) SnapbackError,
    pub(super) Option<Receipt>,
    pub(super) Option<u64>,
    pub(super) Option<FunctionAttribution>,
    pub(super) Option<String>,
    pub(super) Option<MutationServerTiming>,
);

impl ApiError {
    pub(super) fn from_ephemeral(error: crate::ephemeral::EphemeralError) -> Self {
        Self(
            SnapbackError::new(diagnostic_from_ephemeral(error)),
            None,
            None,
            None,
            None,
            None,
        )
    }

    pub(super) fn from_json_rejection(error: JsonRejection) -> Self {
        Self::request_json_invalid(error.to_string())
    }

    pub(super) fn request_json_invalid(error: impl Into<String>) -> Self {
        Self(
            SnapbackError::error(
                "SNAPBACK_REQUEST_JSON_INVALID",
                "server",
                "request body was not valid JSON for this operation",
            )
            .with_details(json!({ "error": error.into() })),
            None,
            None,
            None,
            None,
            None,
        )
    }

    /// Attach a receipt to an error response (a REJECTED mutation still
    /// produces its receipt — LLP 0034 §3.2, ENG-22478).
    pub(super) fn with_receipt(error: SnapbackError, receipt: Receipt) -> Self {
        Self(error, Some(receipt), None, None, None, None)
    }

    pub(super) fn with_attribution(mut self, attribution: Option<FunctionAttribution>) -> Self {
        self.3 = attribution;
        self
    }

    pub(super) fn with_ephemeral_authority_instance(mut self, instance: Option<&str>) -> Self {
        self.4 = instance.map(str::to_owned);
        self
    }

    pub(super) fn with_mutation_timing(mut self, timing: MutationServerTiming) -> Self {
        self.5 = Some(timing);
        self
    }

    pub(super) fn auth_throttled(retry_after_seconds: u64) -> Self {
        Self(
            SnapbackError::error(
                "SNAPBACK_AUTH_THROTTLED",
                "auth",
                "authentication request rate limit exceeded",
            ),
            None,
            Some(retry_after_seconds.max(1)),
            None,
            None,
            None,
        )
    }

    pub(super) fn api_throttled(error: SnapbackError, retry_after_seconds: u64) -> Self {
        Self(
            error,
            None,
            Some(retry_after_seconds.max(1)),
            None,
            None,
            None,
        )
    }
}

pub(super) fn diagnostic_from_ephemeral(error: crate::ephemeral::EphemeralError) -> Diagnostic {
    let mut diagnostic =
        Diagnostic::error(error.code.diagnostic_code(), "ephemeral", error.message);
    diagnostic.details = json!({ "code": error.code });
    diagnostic
}

impl From<SnapbackError> for ApiError {
    fn from(value: SnapbackError) -> Self {
        Self(value, None, None, None, None, None)
    }
}

impl From<snapback_types::diagnostic::SnapbackError> for ApiError {
    fn from(value: snapback_types::diagnostic::SnapbackError) -> Self {
        Self(value.into(), None, None, None, None, None)
    }
}

// Authoritative registry consumed by the JS client's exhaustive classifier
// test. These request-shape/protocol refusals cannot become successful under
// an unchanged live-subscribe retry.
// TERMINAL_LIVE_PROTOCOL_REFUSAL_CODES_BEGIN
pub(super) const TERMINAL_LIVE_PROTOCOL_REFUSAL_CODES: &[&str] = &[
    "SNAPBACK_AUTHORIZED_LEASE_CLIENT_UNSUPPORTED",
    "SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED",
    "SNAPBACK_AUTH_INVALIDATION_NAMESPACE_REQUIRED",
    "SNAPBACK_AUTH_INVALIDATION_PROTOCOL_UNSUPPORTED",
    "SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED",
    "SNAPBACK_CLIENT_SEED_PROTOCOL_UNSUPPORTED",
    "SNAPBACK_EPHEMERAL_AUTHORITY_PROTOCOL_MISMATCH",
    "SNAPBACK_EPHEMERAL_AUTHORITY_UNSUPPORTED",
    "SNAPBACK_EPHEMERAL_EXPIRY_PROTOCOL_MISMATCH",
    "SNAPBACK_EPHEMERAL_EXPIRY_UNSUPPORTED",
    "SNAPBACK_WIRE_VERSION_MISMATCH",
    "SNAPBACK_WIRE_VERSION_REQUIRED",
    "SNAPBACK_WIRE_VERSION_UNSUPPORTED",
];
// TERMINAL_LIVE_PROTOCOL_REFUSAL_CODES_END

/// Map a diagnostic code to an HTTP status.
///
/// @ref LLP 0032#phase-1--safety-floor-and-confirmed-defects — S5.D10: an
/// internal-error class (5xx) so a client or agent can tell "you erred" (4xx)
/// from "the server erred" (5xx). Client faults are allow-listed; every new or
/// unrecognized code fails conservatively as 500 so a runtime/storage failure
/// can never silently masquerade as bad input (ENG-24357).
pub(super) fn status_for_diagnostic_code(code: &str) -> StatusCode {
    if TERMINAL_LIVE_PROTOCOL_REFUSAL_CODES.contains(&code) {
        return StatusCode::BAD_REQUEST;
    }
    // @ref LLP 0092#0d1-route-and-schemas-finalizing-0090-d12s-provisional-shape —
    //   the SNAPBACK_BUNDLE_* HTTP status mapping (codes authoritative,
    //   statuses advisory).
    match code {
        "SNAPBACK_FUNCTION_GENERATION_AWAITING_RELOAD"
        | "SNAPBACK_WRITER_ACQUIRE_TIMEOUT"
        | "SNAPBACK_COMMIT_DEADLINE_EXCEEDED"
        | "SNAPBACK_COMMIT_OUTCOME_UNCERTAIN"
        | "SNAPBACK_COMMIT_UNCERTAIN_RETENTION_EXHAUSTED" => StatusCode::SERVICE_UNAVAILABLE,
        "SNAPBACK_FUNCTION_GENERATION_REHYDRATION_MISMATCH" => StatusCode::CONFLICT,
        // @ref LLP 0204#d95--approval-gated-effects — pending is an accepted
        // durable intent; management, expiry, stale binding, and protected
        // catalog failures retain distinct retry families.
        "SNAPBACK_EFFECT_APPROVAL_PENDING" => StatusCode::ACCEPTED,
        "SNAPBACK_EFFECT_INPUT_INVALID"
        | "SNAPBACK_API_APPROVAL_QUERY_INVALID"
        | "SNAPBACK_API_APPROVAL_REQUIRES_EXPOSURE"
        | "SNAPBACK_FUNCTION_PLAN_REFUSAL_UNDECLARED" => StatusCode::BAD_REQUEST,
        "SNAPBACK_EFFECT_APPROVAL_DENIED" => StatusCode::FORBIDDEN,
        "SNAPBACK_EFFECT_NOT_FOUND" => StatusCode::NOT_FOUND,
        "SNAPBACK_EFFECT_BINDING_STALE" | "SNAPBACK_EFFECT_STATE_INVALID" => StatusCode::CONFLICT,
        "SNAPBACK_EFFECT_EXPIRED" => StatusCode::GONE,
        "SNAPBACK_EFFECT_CATALOG_CORRUPT" => StatusCode::INTERNAL_SERVER_ERROR,
        // @ref LLP 0204#d93--durable-watches-end-user-automations — management input/ownership,
        // lifecycle, quota, deferred integration, and catalog failures keep
        // distinct retry postures. Internal job/catalog corruption stays 5xx.
        "SNAPBACK_WATCH_INPUT_INVALID"
        | "SNAPBACK_WATCH_RENEWAL_INVALID"
        | "SNAPBACK_WEBHOOK_TARGET_INVALID"
        | "SNAPBACK_WEBHOOK_SSRF_REFUSED" => StatusCode::BAD_REQUEST,
        "SNAPBACK_WATCH_OWNER_DENIED"
        | "SNAPBACK_WATCH_AUTHORITY_DEAD"
        | "SNAPBACK_WATCH_ANCHOR_SCOPE_MISMATCH"
        | "SNAPBACK_WATCH_RENEWAL_DENIED" => StatusCode::FORBIDDEN,
        "SNAPBACK_WATCH_NOT_FOUND" => StatusCode::NOT_FOUND,
        "SNAPBACK_WATCH_STATUS_INVALID" => StatusCode::CONFLICT,
        "SNAPBACK_WATCH_BUDGET_EXHAUSTED" | "SNAPBACK_WATCH_OWNER_EVALUATION_LIMIT" => {
            StatusCode::TOO_MANY_REQUESTS
        }
        "SNAPBACK_WEBHOOK_TARGET_UNAVAILABLE" | "SNAPBACK_WEBHOOK_DELIVERY_RETRYABLE" => {
            StatusCode::SERVICE_UNAVAILABLE
        }
        "SNAPBACK_WEBHOOK_DELIVERY_REJECTED" | "SNAPBACK_WEBHOOK_DEAD_LETTERED" => {
            StatusCode::BAD_GATEWAY
        }
        "SNAPBACK_WATCH_CATALOG_CORRUPT"
        | "SNAPBACK_WATCH_JOB_INVALID"
        | "SNAPBACK_WEBHOOK_CATALOG_CORRUPT"
        | "SNAPBACK_WEBHOOK_DELIVERY_INVALID"
        | "SNAPBACK_WEBHOOK_SECRET_UNAVAILABLE" => StatusCode::INTERNAL_SERVER_ERROR,
        // @ref LLP 0031#capability-link-mint-and-serve-family — closed link
        // request secrets use one non-oracular not-found shape; caller input,
        // authority, throttle, and catalog failures retain distinct D10
        // families without ever echoing bearer material.
        "SNAPBACK_CAPABILITY_LINK_UNAVAILABLE" | "SNAPBACK_CAPABILITY_LINK_FUNCTION_INVALID" => {
            StatusCode::NOT_FOUND
        }
        "SNAPBACK_CAPABILITY_LINK_FUNCTION_NOT_ANONYMOUS"
        | "SNAPBACK_CAPABILITY_LINK_MINTER_INVALID"
        | "SNAPBACK_CAPABILITY_LINK_MUTATION_APPROVAL_REQUIRED"
        | "SNAPBACK_CAPABILITY_LINK_CALLER_ARG_DENIED"
        | "SNAPBACK_CAPABILITY_LINK_REVOKE_DENIED" => StatusCode::FORBIDDEN,
        "SNAPBACK_CAPABILITY_LINK_INPUT_INVALID"
        | "SNAPBACK_CAPABILITY_LINK_EXPIRY_INVALID"
        | "SNAPBACK_CAPABILITY_LINK_ARGS_CONTRACT_REQUIRED" => StatusCode::BAD_REQUEST,
        "SNAPBACK_CAPABILITY_LINK_LIMIT_EXCEEDED" => StatusCode::TOO_MANY_REQUESTS,
        "SNAPBACK_CAPABILITY_LINK_CATALOG_CORRUPT" => StatusCode::INTERNAL_SERVER_ERROR,
        crate::network_profile::NETWORK_PROFILE_FORBIDDEN_CODE => StatusCode::FORBIDDEN,
        crate::network_profile::NETWORK_PROFILE_DELAY_CEILING_CODE
        | crate::network_profile::NETWORK_PROFILE_INVALID_CODE => StatusCode::BAD_REQUEST,
        "SNAPBACK_BUNDLE_ROUTE_UNKNOWN" | "SNAPBACK_ROUTE_UNKNOWN" => StatusCode::NOT_FOUND,
        "SNAPBACK_BUNDLE_NOT_PUBLIC"
        | "SNAPBACK_BUNDLE_REGISTER_REQUIRES_CREDENTIAL"
        | "SNAPBACK_BUNDLE_IDEMPOTENCY_SENDER_MISMATCH" => StatusCode::FORBIDDEN,
        "SNAPBACK_BUNDLE_IDEMPOTENCY_SCOPE_MISMATCH" | "SNAPBACK_BUNDLE_IDEMPOTENCY_EXPIRED" => {
            StatusCode::CONFLICT
        }
        "SNAPBACK_BUNDLE_LIMIT_QUERIES"
        | "SNAPBACK_BUNDLE_LIMIT_ROWS"
        | "SNAPBACK_BUNDLE_LIMIT_BYTES"
        | "SNAPBACK_BUNDLE_LIMIT_TIME" => StatusCode::PAYLOAD_TOO_LARGE,
        "SNAPBACK_BUNDLE_RATE_LIMITED" | "SNAPBACK_BUNDLE_PENDING_CAPACITY" => {
            StatusCode::TOO_MANY_REQUESTS
        }
        "SNAPBACK_BUNDLE_PARAMS_INVALID"
        | "SNAPBACK_BUNDLE_MODE_INVALID"
        | "SNAPBACK_BUNDLE_ENTRY_INVALID" => StatusCode::BAD_REQUEST,
        // @ref LLP 0204#d91--streaming-conversations — output
        // stream caller faults stay 4xx; unclassified settlement/storage
        // faults continue to fail closed as 500.
        "SNAPBACK_STREAM_ATTEMPT_NOT_FOUND" | "SNAPBACK_STREAM_TRANSCRIPT_NOT_FOUND" => {
            StatusCode::NOT_FOUND
        }
        "SNAPBACK_STREAM_FORBIDDEN"
        | "SNAPBACK_STREAM_INITIATOR_REQUIRED"
        | "SNAPBACK_STREAM_TRANSCRIPT_FORBIDDEN" => StatusCode::FORBIDDEN,
        "SNAPBACK_STREAM_CHUNK_INVALID"
        | "SNAPBACK_STREAM_NOT_DECLARED"
        | "SNAPBACK_FUNCTION_STREAM_KIND_INVALID" => StatusCode::BAD_REQUEST,
        "SNAPBACK_STREAM_CHUNK_TOO_LARGE"
        | "SNAPBACK_STREAM_ATTEMPT_LIMIT_EXCEEDED"
        | "SNAPBACK_STREAM_FINAL_TOO_LARGE" => StatusCode::PAYLOAD_TOO_LARGE,
        "SNAPBACK_STREAM_RATE_LIMITED" => StatusCode::TOO_MANY_REQUESTS,
        "SNAPBACK_STREAM_CANCELLED"
        | "SNAPBACK_STREAM_RUNNER_FENCED"
        | "SNAPBACK_STREAM_TERMINAL" => StatusCode::CONFLICT,
        "SNAPBACK_BUNDLE_QUERY_FAILED" => StatusCode::INTERNAL_SERVER_ERROR,
        _ => status_for_established_diagnostic_code(code),
    }
}

fn status_for_established_diagnostic_code(code: &str) -> StatusCode {
    match code {
        // @ref LLP 0204#d7--integration-records-admission-and-metering — S0
        // agent registration/invitation client faults.
        // Policy refusals (surface off, caller not permitted, fenced) are 403;
        // malformed/ill-formed request inputs are 400; the live-invitation
        // cap is a quota (429). Commit-uncertainty, secret-generation, and the
        // non-served onboarding advisory keep the fail-safe 500 default.
        "SNAPBACK_AUTH_AGENT_REGISTRATION_DISABLED"
        | "SNAPBACK_AUTH_AGENT_INVITATIONS_DISABLED"
        | "SNAPBACK_AUTH_AGENT_INVITATION_PROFILE_MISMATCH"
        | "SNAPBACK_AUTH_AGENT_INVITATION_USER_INVALID"
        | "SNAPBACK_AUTH_AGENT_DESTROY_CAPABILITY_REQUIRED"
        | "SNAPBACK_AUTH_INTEGRATION_INSTALLATION_REQUIRED"
        | "SNAPBACK_AUTH_INTEGRATION_REVOKED"
        | "SNAPBACK_AUTH_INTEGRATION_SUSPENDED"
        | "SNAPBACK_AUTH_INTEGRATION_TEMPLATE_FORBIDDEN"
        | "SNAPBACK_AUTH_INTEGRATION_UNAVAILABLE" => StatusCode::FORBIDDEN,
        "SNAPBACK_AUTH_OAUTH_ACCESS_DENIED" => StatusCode::FORBIDDEN,
        "SNAPBACK_AUTH_OAUTH_INVALID_CLIENT" => StatusCode::UNAUTHORIZED,
        "SNAPBACK_AUTH_AGENT_INVITATION_INVALID"
        | "SNAPBACK_AUTH_AGENT_INVITATION_REQUIRED"
        | "SNAPBACK_AUTH_AGENT_INVITATION_UNEXPECTED"
        | "SNAPBACK_AUTH_AGENT_POLICY_MODE_INVALID"
        | "SNAPBACK_API_AUTH_MODE_INVALID"
        | "SNAPBACK_API_AUTH_REQUIREMENT_LOOSENED"
        | "SNAPBACK_API_BUDGETS_UNAVAILABLE"
        | "SNAPBACK_API_COMPATIBILITY_BASELINE_UNAVAILABLE"
        | "SNAPBACK_API_EXPOSURE_COMPILATION_INVALID"
        | "SNAPBACK_API_INCOMPATIBLE_CHANGE"
        | "SNAPBACK_API_FUNCTION_EXPOSURE_INVALID"
        | "SNAPBACK_API_FUNCTION_UNKNOWN"
        | "SNAPBACK_API_GENERATION_PIN_UNSUPPORTED"
        | "SNAPBACK_API_MANIFEST_INVALID"
        | "SNAPBACK_API_ORIGIN_INVALID"
        | "SNAPBACK_API_PAGINATION_RECOMMENDED"
        | "SNAPBACK_API_REGISTRATION_POSTURE_REQUIRED"
        | "SNAPBACK_API_OAUTH_BEARER_OPT_IN_REQUIRED"
        | "SNAPBACK_API_OAUTH_BUNDLES_INVALID"
        | "SNAPBACK_API_OAUTH_FUNCTION_NOT_EXPOSED"
        | "SNAPBACK_API_OAUTH_FUNCTION_UNKNOWN"
        | "SNAPBACK_API_OAUTH_REQUIRES_API"
        | "SNAPBACK_API_DECLARED_CLIENT_INVALID"
        | "SNAPBACK_AUTH_INTEGRATION_REQUEST_INVALID"
        | "SNAPBACK_AUTH_OAUTH_GRANT_INVALID"
        | "SNAPBACK_AUTH_OAUTH_REDIRECT_URI_INVALID"
        | "SNAPBACK_AUTH_OAUTH_REQUEST_INVALID"
        | "SNAPBACK_AUTH_OAUTH_SCOPE_INVALID" => StatusCode::BAD_REQUEST,
        "SNAPBACK_TABLE_WRITE_POLICY_INELIGIBLE"
        | "SNAPBACK_TABLE_WRITE_AUTHORITY_TABLE_INELIGIBLE"
        | "SNAPBACK_API_EXPOSURE_DENIED"
        | "SNAPBACK_API_NOT_ENABLED"
        | "SNAPBACK_API_DECLARED_CLIENTS_UNAVAILABLE" => {
            StatusCode::FORBIDDEN
        }
        "SNAPBACK_API_RUN_ENVELOPE_STALE" | "SNAPBACK_REMEDIATION_ARTIFACT_STALE" => {
            StatusCode::CONFLICT
        }
        "SNAPBACK_REMEDIATION_INPUT_INVALID" => StatusCode::BAD_REQUEST,
        "SNAPBACK_REMEDIATION_APPROVAL_REQUIRED" => StatusCode::FORBIDDEN,
        "SNAPBACK_API_RUN_PROGRAM_TOO_LARGE" => StatusCode::PAYLOAD_TOO_LARGE,
        "SNAPBACK_API_RUN_UNTRUSTED_CODE_UNSUPPORTED" => StatusCode::NOT_IMPLEMENTED,
        // @ref LLP 0204#d5--surface-4-the-near-data-ai-interface — ask
        // separates caller shape/policy, quota, provider, timeout, and host
        // integrity families so an agent can choose a safe escalation.
        "SNAPBACK_API_ASK_AUTHORITY_REQUIRED"
        | "SNAPBACK_API_ASK_DISABLED"
        | "SNAPBACK_API_ASK_TOOL_DENIED" => StatusCode::FORBIDDEN,
        "SNAPBACK_API_BUDGETS_INVALID"
        | "SNAPBACK_API_ASK_BUDGETS_INVALID"
        | "SNAPBACK_API_ASK_BUDGETS_REQUIRED"
        | "SNAPBACK_API_ASK_CALLER_KEY_INVALID"
        | "SNAPBACK_API_ASK_CALLER_KEY_REQUIRED"
        | "SNAPBACK_API_ASK_CALLER_KEY_UNEXPECTED"
        | "SNAPBACK_API_ASK_MODEL_INVALID"
        | "SNAPBACK_API_ASK_MANIFEST_INVALID"
        | "SNAPBACK_API_ASK_PROVIDER_INVALID"
        | "SNAPBACK_API_ASK_PROVIDER_UNSUPPORTED"
        | "SNAPBACK_API_ASK_REQUIRES_API"
        | "SNAPBACK_API_ASK_RESULT_SCHEMA_INVALID"
        | "SNAPBACK_API_ASK_SECRET_INVALID"
        | "SNAPBACK_API_ASK_TASK_INVALID" => StatusCode::BAD_REQUEST,
        "SNAPBACK_API_ASK_BUDGET_EXHAUSTED"
        | "SNAPBACK_API_ASK_REQUEST_BUDGET_EXHAUSTED"
        | "SNAPBACK_API_ASK_RESULT_VOLUME_EXHAUSTED"
        | "SNAPBACK_API_ASK_STEP_LIMIT_EXHAUSTED" => StatusCode::TOO_MANY_REQUESTS,
        "SNAPBACK_API_ASK_RESULT_SCHEMA_MISMATCH" => StatusCode::UNPROCESSABLE_ENTITY,
        "SNAPBACK_API_ASK_WALL_TIME_EXHAUSTED" => StatusCode::GATEWAY_TIMEOUT,
        "SNAPBACK_API_ASK_UPSTREAM_FAILED" | "SNAPBACK_API_ASK_UPSTREAM_INVALID" => {
            StatusCode::BAD_GATEWAY
        }
        "SNAPBACK_API_ASK_EGRESS_DISABLED" | "SNAPBACK_API_ASK_MODEL_NOT_CONFIGURED" => {
            StatusCode::SERVICE_UNAVAILABLE
        }
        "SNAPBACK_API_ASK_RECEIPT_INVALID"
        | "SNAPBACK_API_ASK_RECEIPT_KEY_UNAVAILABLE"
        | "SNAPBACK_API_ASK_SPEND_CATALOG_CORRUPT" => StatusCode::INTERNAL_SERVER_ERROR,
        "SNAPBACK_AUTH_AGENT_INVITATION_CAP" => StatusCode::TOO_MANY_REQUESTS,
        "SNAPBACK_AUTH_INTEGRATION_UNKNOWN" | "SNAPBACK_API_DECLARED_CLIENT_UNKNOWN" => {
            StatusCode::NOT_FOUND
        }
        "SNAPBACK_AUTH_INTEGRATION_CATALOG_CORRUPT"
        | "SNAPBACK_AUTH_INTEGRATION_CLASS_INVALID"
        | "SNAPBACK_API_DECLARED_CLIENT_CATALOG_CORRUPT" => StatusCode::CONFLICT,
        "SNAPBACK_AUTH_OAUTH_UNAVAILABLE" => StatusCode::SERVICE_UNAVAILABLE,
        "SNAPBACK_AUTH_OAUTH_SERVER_ERROR" | "SNAPBACK_AUTH_OAUTH_STATE_CORRUPT" => {
            StatusCode::INTERNAL_SERVER_ERROR
        }
        // @ref LLP 0057#catalog-write-and-lifecycle-rules — these are offline
        // operator flows, but retain a truthful fail-safe projection if they
        // ever cross ApiError: malformed artifacts are caller input, catalog
        // occupancy/identity reuse are conflicts, and export failure is a
        // source-store invariant.
        "SNAPBACK_AUTH_LOGICAL_IMPORT_INVALID"
        | "SNAPBACK_AUTH_LOGICAL_IMPORT_FORMAT_UNSUPPORTED"
        | "SNAPBACK_AUTH_IDENTITY_INVALID"
        | "SNAPBACK_AUTH_PASSWORD_IDENTIFIER_INVALID"
        | "SNAPBACK_AUTH_PASSWORD_POLICY"
        | "SNAPBACK_AUTH_PROVISIONING_INVALID"
        | "SNAPBACK_AUTH_USERNAME_INVALID" => StatusCode::BAD_REQUEST,
        "SNAPBACK_AUTH_ASSURANCE_INADMISSIBLE"
        | "SNAPBACK_AUTH_BINDING_WRITE_FORBIDDEN"
        | "SNAPBACK_AUTH_DEV_ORIGIN_REFUSED"
        | "SNAPBACK_AUTH_PASSWORD_SET_AUTHORITY_INVALID"
        | "SNAPBACK_AUTH_PROVISIONING_WRITE_FORBIDDEN" => StatusCode::FORBIDDEN,
        "SNAPBACK_AUTH_GUEST_SESSION_INVALID"
        | "SNAPBACK_AUTH_RECOVERY_CODE_INVALID"
        | "SNAPBACK_AUTH_SESSION_INVALID"
        | "SNAPBACK_AUTH_VERIFIED_PROOF_INVALID" => StatusCode::UNAUTHORIZED,
        "SNAPBACK_AUTH_PASSWORD_SENDER_CONSTRAINED_UNSUPPORTED" => {
            StatusCode::NOT_IMPLEMENTED
        }
        "SNAPBACK_TABLE_VISIBILITY_ANY_OF_ARMS_INVALID"
        | "SNAPBACK_TABLE_VISIBILITY_ANY_OF_ARM_INVALID"
        | "SNAPBACK_TABLE_VISIBILITY_ANY_OF_DUPLICATE_ARM"
        | "SNAPBACK_TABLE_VISIBILITY_AUTHORIZATION_DEPENDENCE_MISMATCH"
        | "SNAPBACK_TABLE_VISIBILITY_MEMBERSHIP_DECLARATION_UNKNOWN"
        | "SNAPBACK_TABLE_VISIBILITY_MEMBERSHIP_ROLES_INVALID"
        | "SNAPBACK_TABLE_VISIBILITY_MEMBERSHIP_ROLE_UNKNOWN"
        | "SNAPBACK_TABLE_VISIBILITY_OWNER_FIELD_UNKNOWN"
        | "SNAPBACK_TABLE_VISIBILITY_PLAN_MISMATCH"
        | "SNAPBACK_TABLE_VISIBILITY_RESOURCE_FIELD_UNKNOWN"
        | "SNAPBACK_TABLE_VISIBILITY_RESOURCE_FIELD_TYPE_MISMATCH"
        | "SNAPBACK_FIELD_BOUNDARY_CONDITION_INVALID"
        | "SNAPBACK_FIELD_BOUNDARY_FIELDS_INVALID"
        | "SNAPBACK_FIELD_BOUNDARY_FIELD_UNKNOWN"
        | "SNAPBACK_FIELD_BOUNDARY_SPEC_INVALID" => StatusCode::BAD_REQUEST,
        "SNAPBACK_AUTH_GUEST_CLAIM_COLLISION"
        | "SNAPBACK_AUTH_IDENTITY_COLLISION"
        | "SNAPBACK_AUTH_LAST_AUTHENTICATOR"
        | "SNAPBACK_AUTH_MODE_CHANGED"
        | "SNAPBACK_AUTH_PASSWORD_ALREADY_SET"
        | "SNAPBACK_AUTH_PASSWORD_EXISTS"
        | "SNAPBACK_AUTH_PROVISIONING_REPLAY_MISMATCH"
        | "SNAPBACK_AUTH_LOGICAL_IMPORT_TARGET_NOT_EMPTY"
        | "SNAPBACK_AUTH_LOGICAL_IMPORT_IDENTITY_COLLISION"
        | "SNAPBACK_AUTH_PASSWORD_IDENTIFIER_MODE_IMMUTABLE" => StatusCode::CONFLICT,
        "SNAPBACK_AUTH_IDENTITY_CORE_REQUIRES_V3"
        | "SNAPBACK_AUTH_PASSWORD_HASH_UNAVAILABLE"
        | "SNAPBACK_AUTH_PASSWORD_RESET_UNAVAILABLE"
        | "SNAPBACK_AUTH_PASSWORD_SIGNUP_UNAVAILABLE"
        | "SNAPBACK_AUTH_RANDOM_UNAVAILABLE" => StatusCode::SERVICE_UNAVAILABLE,
        "SNAPBACK_AUTH_LOGICAL_EXPORT_INVALID" => StatusCode::INTERNAL_SERVER_ERROR,
        // These are operator-only shutdown controls/failures rather than
        // served request outcomes. Inventory still classifies them explicitly
        // so an accidental HTTP projection remains fail-safe.
        "SNAPBACK_SHUTDOWN_CHECKPOINT_TIMEOUT_MS"
        | "SNAPBACK_SHUTDOWN_WAL_CHECKPOINT_INCOMPLETE" => {
            StatusCode::INTERNAL_SERVER_ERROR
        }
        "SNAPBACK_JOB_PUSH_GRANT_INVALID"
        | "SNAPBACK_PUSH_CONFIG_GRANT_MISSING"
        | "SNAPBACK_PUSH_FIXTURE_CLOCK_REFUSED"
        | "SNAPBACK_PUSH_LEDGER_ARGS_INVALID"
        | "SNAPBACK_PUSH_LEDGER_NOT_DECLARED"
        | "SNAPBACK_PUSH_REDRIVE_REFUSED"
        | "SNAPBACK_PUSH_SEND_INVALID"
        | "SNAPBACK_PUSH_TOKEN_INVALID"
        | "SNAPBACK_PUSH_SEAM_AUTH_REQUIRED"
        | "SNAPBACK_PUSH_SEAM_NOT_DECLARED" => StatusCode::BAD_REQUEST,
        // @ref LLP 0158#the-runtime-plane--where-the-real-design-is — a
        // derived deployment may reach a routed request, but the egress family
        // remains a closed authorization refusal rather than an upstream failure.
        "SNAPBACK_FORK_EGRESS_DENIED" => StatusCode::FORBIDDEN,
        // F0a mint/publication diagnostics are local operator and durable
        // evidence failures, not request-shape classes. If one crosses an
        // HTTP boundary it therefore retains the fail-safe 500 projection.
        "SNAPBACK_FORK_CUSTODY_REFUSED"
        | "SNAPBACK_FORK_CUSTODY_UNCLASSIFIED"
        | "SNAPBACK_FORK_DESTINATION_EXISTS"
        | "SNAPBACK_FORK_EGRESS_MARKER_FAILED"
        | "SNAPBACK_FORK_ASSET_CUT_INCOMPLETE"
        | "SNAPBACK_FORK_DIFF_ORACLE_MISMATCH"
        | "SNAPBACK_FORK_EVIDENCE_INCOMPLETE"
        | "SNAPBACK_FORK_EVIDENCE_MISMATCH"
        | "SNAPBACK_FORK_WRITER_COVERAGE_INVALID"
        | "SNAPBACK_FORK_IO_FAILED"
        | "SNAPBACK_FORK_KEYRING_MINT_FAILED"
        | "SNAPBACK_FORK_LINEAGE_INVALID"
        | "SNAPBACK_FORK_NESTED_REFUSED"
        | "SNAPBACK_FORK_PATH_INVALID"
        | "SNAPBACK_FORK_QUARANTINED"
        | "SNAPBACK_FORK_RECEIPT_INVALID"
        | "SNAPBACK_FORK_SIDECAR_COLLISION"
        | "SNAPBACK_FORK_TEST_CRASH_CUT" => StatusCode::INTERNAL_SERVER_ERROR,
        "SNAPBACK_PUSH_SESSION_STALE" | "SNAPBACK_PUSH_SESSION_REQUIRED" => {
            StatusCode::UNAUTHORIZED
        }
        "SNAPBACK_PUSH_TOKEN_SCOPE_COLLISION"
        | "SNAPBACK_PUSH_APP_SCOPE_CHANGE_BLOCKED"
        | "SNAPBACK_PUSH_DEDUPE_CONFLICT"
        | "SNAPBACK_PUSH_REDRIVE_NOT_AMBIGUOUS"
        | "SNAPBACK_PUSH_REDRIVE_RACED" => StatusCode::CONFLICT,
        "SNAPBACK_PUSH_PROVIDER_SHAPE_INVALID" => StatusCode::BAD_GATEWAY,
        "SNAPBACK_PUSH_ATTEMPT_EXHAUSTED"
        | "SNAPBACK_PUSH_SEND_UNAVAILABLE"
        | "SNAPBACK_PUSH_SEND_UNSUPPORTED" => StatusCode::SERVICE_UNAVAILABLE,
        "SNAPBACK_PUSH_BATCH_CLAIM_RACED"
        | "SNAPBACK_PUSH_BATCH_CLAIM_STALE"
        | "SNAPBACK_PUSH_BATCH_NOT_CLAIMABLE"
        | "SNAPBACK_PUSH_CONFIG_GRANT_INVALID"
        | "SNAPBACK_PUSH_LEDGER_CORRUPT"
        | "SNAPBACK_PUSH_MAINTENANCE_WORKER_FAILED"
        | "SNAPBACK_PUSH_PROVIDER_OVERRIDE_REFUSED"
        | "SNAPBACK_PUSH_RECEIPT_CLAIM_STALE"
        | "SNAPBACK_PUSH_SEND_FAILED"
        | "SNAPBACK_PUSH_REGISTRY_CORRUPT"
        // @ref LLP 0184#b-forced-live-resync--add-now — an infallible-in-
        //   practice serde encode failure of a closed DTO; a server
        //   invariant, not a caller-fixable input.
        | "SNAPBACK_LIVE_FORCE_RESYNC_ENCODE_FAILED" => StatusCode::INTERNAL_SERVER_ERROR,
        // @ref LLP 0132#query-surface — malformed query/value carriers and a
        // mutation that exceeds the fixed maintenance admission ceiling are
        // caller-fixable. Retrying the unchanged request cannot succeed.
        "SNAPBACK_VECTOR_INDEX_INVALID"
        | "SNAPBACK_VECTOR_QUERY_INVALID"
        | "SNAPBACK_VECTOR_QUERY_PLAN_INVALID"
        | "SNAPBACK_VECTOR_VALUE_INVALID"
        | "SNAPBACK_VECTOR_MAINTENANCE_LIMIT" => StatusCode::BAD_REQUEST,
        // @ref LLP 0132#index-maintenance-and-storage — a full visibility
        // partition conflicts with current durable state. Retry only after
        // that state changes, never as an automatic unchanged-request retry.
        "SNAPBACK_VECTOR_CORPUS_BOUND" => StatusCode::CONFLICT,
        // @ref LLP 0132#query-surface — index readiness is the one transient
        // vector serving class; retry is appropriate only after readiness
        // changes, not as an immediate blind loop.
        "SNAPBACK_VECTOR_INDEX_UNAVAILABLE" => StatusCode::SERVICE_UNAVAILABLE,
        // @ref LLP 0132#index-maintenance-and-storage — corruption, failed
        // synchronous maintenance, and a query-time work-bound breach (which
        // the declared corpus proof should prevent) are server invariants.
        // They remain fail-safe 500s and are not blind-client-retry classes.
        "SNAPBACK_VECTOR_INDEX_CORRUPT"
        | "SNAPBACK_VECTOR_MAINTENANCE_FAILED"
        | "SNAPBACK_VECTOR_WORK_LIMIT" => StatusCode::INTERNAL_SERVER_ERROR,
        "SNAPBACK_BATCH_READ_ITEMS_EXCEEDED"
        | "SNAPBACK_BATCH_READ_INPUT_BYTES_EXCEEDED"
        | "SNAPBACK_BATCH_READ_RESPONSE_BYTES_EXCEEDED" => StatusCode::PAYLOAD_TOO_LARGE,
        "SNAPBACK_BATCH_READ_UNIQUE_INVARIANT_CORRUPT" => {
            StatusCode::INTERNAL_SERVER_ERROR
        }
        "SNAPBACK_UNKNOWN_FUNCTION" | "SNAPBACK_UNKNOWN_TABLE" | "SNAPBACK_UNKNOWN_FIELD" => {
            StatusCode::NOT_FOUND
        }
        "SNAPBACK_UNKNOWN_CRON_JOB"
        | "SNAPBACK_JOB_UNKNOWN"
        | "SNAPBACK_UNKNOWN_SUBSCRIPTION"
        // @ref LLP 0184#b-forced-live-resync--add-now — the target
        //   subscription id is not currently open.
        | "SNAPBACK_LIVE_FORCE_RESYNC_SUBSCRIPTION_NOT_FOUND"
        | "SNAPBACK_ERROR_ISSUE_NOT_FOUND"
        | "SNAPBACK_AUTH_MODE_DEV"
        // @ref LLP 0055#principal-kinds — an operation naming a principal that is
        //   not a known agent.
        | "SNAPBACK_AUTH_AGENT_UNKNOWN"
        | "SNAPBACK_AUTH_MAILBOX_ENTRY_NOT_FOUND"
        | "SNAPBACK_ROW_NOT_FOUND"
        | "SNAPBACK_EPHEMERAL_ROOM_NOT_FOUND"
        | "SNAPBACK_EPHEMERAL_ENTRY_NOT_FOUND"
        // @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default —
        //   the private self resolver may disclose only that the caller's own
        //   membership row is absent, so this is a scoped not-found result.
        | "SNAPBACK_MEMBERSHIP_SELF_NOT_FOUND" => StatusCode::NOT_FOUND,
        "SNAPBACK_ARTIFACT_IDENTITY_MISMATCH"
        // @ref LLP 0184#b-forced-live-resync--add-now — the given
        //   subscription id is open on a different connection than fenced;
        //   the fence itself is intact (not a not-found), so this is a
        //   conflict, not a 404.
        | "SNAPBACK_LIVE_FORCE_RESYNC_CONNECTION_MISMATCH"
        // @ref LLP 0154#d5--the-query-contract-typed-operations-projected-everywhere —
        //   a continuation or frozen export snapshot bound to retired sibling
        //   state conflicts with the current store and must be restarted.
        | "SNAPBACK_TELEMETRY_EXPORT_CONTINUATION_STALE"
        | "SNAPBACK_TELEMETRY_EXPORT_SNAPSHOT_STALE"
        | "SNAPBACK_MUTATION_CONFLICT"
        | "SNAPBACK_ACTION_GENERATION_CONFLICT"
        // @ref LLP 0076#diagnostics — reserved internal cancellation reason;
        // no v1 read path surfaces it, but its reviewed status is a conflict
        // with the durable terminal row.
        | "SNAPBACK_ACTION_STREAM_CANCELLED"
        | "SNAPBACK_OPERATION_CANCELLED"
        | "SNAPBACK_OPERATION_IDENTITY_HORIZON_PASSED"
        | "SNAPBACK_OPERATION_STORED_REFUSAL"
        | "SNAPBACK_CONFIG_VERIFY_STALE"
        | "SNAPBACK_CLIENT_MUTATION_ID_REUSED"
        | "SNAPBACK_CLIENT_MUTATION_LEGACY_AUTH_QUARANTINED"
        | "SNAPBACK_CONNECTION_TEARDOWN_PENDING"
        | "SNAPBACK_EPHEMERAL_CLEANUP_STARTUP_MISMATCH"
        | "SNAPBACK_EPHEMERAL_INCOMPATIBLE_COLLECTION_DEFINITION"
        | "SNAPBACK_EPHEMERAL_AUTHORITY_INSTANCE_CHANGED"
        | "SNAPBACK_EPHEMERAL_STALE_SCOPE_EPOCH"
        | "SNAPBACK_EPHEMERAL_STALE_ENTRY_GENERATION"
        | "SNAPBACK_EPHEMERAL_OPERATOR_DELETE_STALE_STARTUP_NONCE"
        | "SNAPBACK_LIVE_STAGE_CONFLICT"
        | "SNAPBACK_AUTH_TABLE_COLLISION"
        | "SNAPBACK_AUTH_CATALOG_OBJECT_COLLISION"
        | "SNAPBACK_AUTH_INVALIDATION_EXPECTATION_STALE"
        | "SNAPBACK_AUTH_INVALIDATION_PENDING"
        | "SNAPBACK_AUTH_INVALIDATION_RESOLUTION_STALE"
        | "SNAPBACK_AUTH_RESNAPSHOT_REQUIRED"
        | "SNAPBACK_AUTH_GRANT_PENDING"
        | "SNAPBACK_AUTH_GRANT_SCOPE_STALE"
        | "SNAPBACK_AUTH_RETRY_NOT_EXHAUSTED"
        | "SNAPBACK_AUTH_RETRY_NOT_PENDING"
        | "SNAPBACK_AUTH_RESERVATION_STALE"
        | "SNAPBACK_AUTHORIZED_LEASE_BOUNDARY_MISMATCH"
        | "SNAPBACK_AUTHORIZED_LEASE_EXPIRED"
        | "SNAPBACK_AUTHORIZED_LEASE_REQUEST_REUSED"
        | "SNAPBACK_AUTHORIZED_LEASE_STALE"
        | "SNAPBACK_AUTH_MODE_DOWNGRADE"
        // @ref LLP 0056#declaring-a-membership-table — a duplicate write against
        //   the generated unique index is a conflict, not a bad request.
        | "SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION"
        // LLP 0080 slice 1: two joined rows sharing a unique key conflict
        // with the index invariant; the executor refuses rather than picks.
        | "SNAPBACK_RELATIONAL_DUPLICATE_UNIQUE_KEY"
        // @ref LLP 0110#final-author-reconciliation-after-round-3 — bounded
        // child cursors restart (rather than reposition) when their parent
        // incarnation changes; unavailable parents and effectless activity
        // writes likewise conflict with the current durable state.
        | "SNAPBACK_BOUNDED_CHILDREN_PARENT_RESTART_REQUIRED"
        | "SNAPBACK_SNAPSHOT_BATCH_RESTART_REQUIRED"
        | "SNAPBACK_RELATION_PARENT_UNAVAILABLE"
        | "SNAPBACK_RELATION_ACTIVATION_BACKFILL_REQUIRED"
        | "SNAPBACK_SEQUENCE_ACTIVATION_STATE_INVALID"
        | "SNAPBACK_ACTIVITY_SOURCE_EFFECT_REQUIRED"
        // @ref LLP 0055#principal-kinds — deactivation is refused when it would
        //   leave a protected LLP 0056 resource with no eligible holder; the
        //   operation conflicts with the last-eligible-holder invariant.
        | "SNAPBACK_AUTH_AGENT_DEACTIVATION_WOULD_STRAND"
        | "SNAPBACK_AUTH_AGENT_CREDENTIAL_EXISTS"
        // @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default —
        //   the M2 write invariants conflict with durable state: removing/demoting
        //   the final eligible holder, deleting a resource whose roster remains,
        //   and creating a protected resource without seating its bootstrap holder.
        | "SNAPBACK_MEMBERSHIP_LAST_HOLDER_STRAND"
        | "SNAPBACK_AUTHORITY_OWNER_COUNT_INVALID"
        | "SNAPBACK_MEMBERSHIP_RESOURCE_DELETE_BLOCKED"
        | "SNAPBACK_MEMBERSHIP_BOOTSTRAP_REQUIRED"
        | "SNAPBACK_MEMBERSHIP_BATCH_UNSUPPORTED"
        | "SNAPBACK_MIGRATION_PRECONDITION_FAILED"
        | "SNAPBACK_MIGRATION_REHEARSAL_REQUIRED"
        | "SNAPBACK_MIGRATION_PLAN_STALE"
        | "SNAPBACK_MIGRATION_EXECUTOR_UNAVAILABLE"
        | "SNAPBACK_MIGRATION_EXECUTOR_STALE"
        | "SNAPBACK_MIGRATION_CANCELLED"
        | "SNAPBACK_MIGRATION_STEP_FAILED"
        | "SNAPBACK_MIGRATION_VERIFICATION_FAILED"
        | "SNAPBACK_MIGRATION_ROLLBACK_UNAVAILABLE"
        | "SNAPBACK_MIGRATION_RETAINED_WORK_INCOMPATIBLE"
        | "SNAPBACK_MIGRATION_RESYNC_REQUIRED"
        | "SNAPBACK_MIGRATION_UPGRADE_REQUIRED"
        | "SNAPBACK_PROJECTION_FANOUT_EXCEEDED"
        | "SNAPBACK_SEED_CROSS_MODE_UNSUPPORTED"
        | "SNAPBACK_SEED_EFFECT_LIMIT_EXCEEDED"
        | "SNAPBACK_SEED_IDENTITY_CONFLICT"
        | "SNAPBACK_SEED_IDENTITY_CORRUPT"
        | "SNAPBACK_SEED_MEMBERSHIP_BOOTSTRAP_UNSUPPORTED"
        | "SNAPBACK_SEED_MIGRATION_REQUIRED"
        | "SNAPBACK_SEED_NONEMPTY_UNTRACKED"
        | "SNAPBACK_SEED_OPERATION_HISTORICAL"
        | "SNAPBACK_SEED_OPERATION_ID_REUSED"
        | "SNAPBACK_SEED_PARTIAL_UNTRACKED"
        | "SNAPBACK_SEED_REPLAY_REQUIRES_PREFLIGHT"
        | "SNAPBACK_SEED_VERSION_REUSED"
        | "SNAPBACK_SCHEMA_REQUIRED_FIELD_BACKFILL_REQUIRED" => StatusCode::CONFLICT,
        "SNAPBACK_AUTH_REFRESH_SUPERSEDED"
        | "SNAPBACK_AUTH_REHEARSAL_IDEMPOTENCY_CONFLICT"
        | "SNAPBACK_AUTH_REHEARSAL_NAMESPACE_CONSUMED"
        | "SNAPBACK_AUTH_REHEARSAL_DISPOSABLE_REQUIRED"
        | "SNAPBACK_AUTH_REHEARSAL_STATE_PRESENT"
        | "SNAPBACK_AUTH_REHEARSAL_ENVELOPE_INVALID" => StatusCode::CONFLICT,
        // Scoped idempotency-key reuse and races are binding conflicts on
        // the (queue, action, key) identity (LLP 0070 first slice).
        "SNAPBACK_JOB_IDEMPOTENCY_KEY_RACED"
        | "SNAPBACK_JOB_IDEMPOTENCY_KEY_REUSED" => StatusCode::CONFLICT,
        // @ref LLP 0017#security-defaults — admin gating distinguishes "disabled"
        // (forbidden) from "needs the configured token" (unauthorized).
        "SNAPBACK_ADMIN_DISABLED"
        | "SNAPBACK_ADMIN_SECRET_READ_SCOPE_DENIED"
        | "SNAPBACK_ADMIN_SECRET_READ_MINT_DENIED"
        | "SNAPBACK_ADMIN_SECRET_READ_PROOF_INVALID"
        | "SNAPBACK_ADMIN_SECRET_READ_PROOF_REQUIRED"
        | "SNAPBACK_ADMIN_SECRET_READ_PROOF_REPLAYED"
        | "SNAPBACK_ADMIN_SECRET_READ_PROOF_STALE"
        | "SNAPBACK_ADMIN_SECRET_READ_PROOF_STARTUP_MISMATCH"
        | "SNAPBACK_EPHEMERAL_OPERATOR_DELETE_TARGET_REFUSED_HOSTED"
        | "SNAPBACK_EPHEMERAL_OPERATOR_DELETE_TARGET_REFUSED_DERIVED"
        | "SNAPBACK_LIVE_RESUME_OWNERSHIP"
        | "SNAPBACK_CONNECTION_TOKEN_INVALID"
        | "SNAPBACK_AUTH_CODE_LOCKED"
        | "SNAPBACK_AUTHORIZED_LEASE_AUTHORITY_INVALID"
        | "SNAPBACK_AUTH_IMPERSONATION_REQUIRED"
        | "SNAPBACK_DEV_IDENTITY_REFUSED"
        | "SNAPBACK_AUTH_REHEARSAL_CARRIER_REQUIRED"
        | "SNAPBACK_AUTH_REHEARSAL_PROFILE_FORBIDDEN"
        | "SNAPBACK_AUTH_REHEARSAL_CONFIG_FORBIDDEN"
        | "SNAPBACK_AUTH_REHEARSAL_SCOPE_DENIED"
        | "SNAPBACK_AUTH_REHEARSAL_SELECTOR_DENIED"
        | "SNAPBACK_AUTH_REHEARSAL_BINDING_MISMATCH"
        | "SNAPBACK_AUTH_REHEARSAL_EXPIRED"
        | "SNAPBACK_AUTH_REHEARSAL_AUTHORITY_ENDED"
        | "SNAPBACK_AUTH_REHEARSAL_REACHABILITY_PUBLIC"
        | "SNAPBACK_AUTH_REHEARSAL_EGRESS_REFUSED"
        | "SNAPBACK_AUTH_PERMISSION_DENIED"
        | "SNAPBACK_AUTH_GRANT_SCOPE_DENIED"
        | "SNAPBACK_AUTH_AUTHORITY_CREATING_UNCONSENTED"
        // LLP 0110: the closed activity profile accepts only authority classes
        // that project trustworthy, total provenance.
        | "SNAPBACK_ACTIVITY_AUTHORITY_UNPROVENANCED"
        // @ref LLP 0055#ending-authority-revocation-expiry-deactivation — a permanently deactivated agent is
        //   refused fail-closed at every authority-creating/exercising path.
        | "SNAPBACK_AUTH_AGENT_DEACTIVATED"
        // @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default —
        //   the M2 writer-class seam and transition matrix are authorization
        //   refusals: raw/HostPlan membership writes, a write matching no declared
        //   transition, a userless authority, a field outside the matched
        //   transition, seating a corpse, and the system-only sweep.
        | "SNAPBACK_MEMBERSHIP_RAW_WRITE_DENIED"
        | "SNAPBACK_MEMBERSHIP_HOSTPLAN_WRITE_DENIED"
        | "SNAPBACK_MEMBERSHIP_TRANSITION_DENIED"
        | "SNAPBACK_MEMBERSHIP_NO_EFFECTIVE_PRINCIPAL"
        | "SNAPBACK_MEMBERSHIP_INELIGIBLE_HOLDER"
        | "SNAPBACK_MEMBERSHIP_INSERT_FIELD_DENIED"
        | "SNAPBACK_MEMBERSHIP_READ_PRIVATE"
        | "SNAPBACK_MEMBERSHIP_SWEEP_AUTHORITY"
        // @ref LLP 0240#d1-declare-an-application-authority-profile-at-the-scoped-relation
        //   — attempting an owner mutation outside transferOwner, or calling
        //   transferOwner without current-owner authority, is forbidden.
        | "SNAPBACK_AUTHORITY_OWNER_MUTATION_REQUIRES_TRANSFER"
        | "SNAPBACK_AUTHORITY_TRANSFER_OWNER_DENIED"
        // LLP 0065: profile-class admission — an authenticated principal
        // that projects no user subject is refused after the auth gate.
        | "SNAPBACK_STANDARD_PATTERN_PRINCIPAL_UNSUPPORTED"
        // LLP 0081 §2: apply without a binding authenticated approval.
        | "SNAPBACK_MIGRATION_APPROVAL_REQUIRED"
        | "SNAPBACK_PROFILE_FORBIDS"
        // @ref LLP 0184#b-forced-live-resync--add-now — target-rule refusal
        //   (local-non-production-only) and a startup-nonce that does not
        //   match the running process are both authorization refusals, not
        //   caller-fixable-by-retry input errors.
        | "SNAPBACK_DEBUG_PERTURBATION_TARGET_REFUSED"
        | "SNAPBACK_LIVE_FORCE_RESYNC_STARTUP_NONCE_MISMATCH" => StatusCode::FORBIDDEN,
        "SNAPBACK_ADMIN_TOKEN_REQUIRED"
        | "SNAPBACK_ADMIN_SECRET_READ_REQUIRED"
        | "SNAPBACK_CONNECTION_TOKEN_REQUIRED"
        | "SNAPBACK_CONNECTION_AUTHORITY_MISMATCH"
        | "SNAPBACK_AUTH_REQUIRED"
        | "SNAPBACK_AUTH_SESSION_EXPIRED"
        | "SNAPBACK_AUTH_STREAM_RESET"
        | "SNAPBACK_AUTH_CREDENTIAL_SUPERSEDED"
        | "SNAPBACK_AUTH_CREDENTIAL_INVALID"
        // @ref LLP 0055#credentials-and-tokens — a credential of one class
        //   presented on another class's surface is a typed mismatch, never an
        //   anonymous fall-through.
        | "SNAPBACK_AUTH_CREDENTIAL_CLASS_MISMATCH"
        | "SNAPBACK_AUTH_CODE_INVALID"
        | "SNAPBACK_AUTH_AGENT_CREDENTIAL_INVALID"
        | "SNAPBACK_AUTH_GRANT_INVALID"
        | "SNAPBACK_AUTH_STEP_UP_REQUIRED"
        | "SNAPBACK_AUTH_SCOPED_TOKEN_INVALID" => StatusCode::UNAUTHORIZED,
        "SNAPBACK_ADMIN_APPROVAL_INVALID" | "SNAPBACK_ADMIN_CLAIM_INVALID" => {
            StatusCode::UNAUTHORIZED
        }
        "SNAPBACK_CONNECTION_GRANT_LIMIT_EXCEEDED"
        | "SNAPBACK_ADMIN_SECRET_READ_BUDGET_EXHAUSTED"
        | "SNAPBACK_TELEMETRY_STATS_WORK_LIMIT_EXCEEDED"
        | "SNAPBACK_TELEMETRY_QUERY_WORK_LIMIT_EXCEEDED"
        | "SNAPBACK_TELEMETRY_SQL_BUDGET_EXCEEDED"
        | "SNAPBACK_ADMIN_SECRET_READ_LEASE_CAPACITY_EXCEEDED"
        | "SNAPBACK_ADMIN_SECRET_READ_PROOF_CAPACITY_EXCEEDED"
        | "SNAPBACK_AUTH_THROTTLED"
        | "SNAPBACK_AUTH_AGENT_CREDENTIAL_ROTATION_THROTTLED"
        | "SNAPBACK_AUTH_GRANT_CAP"
        | "SNAPBACK_AUTH_PAIRING_CODE_CAP"
        | "SNAPBACK_AUTH_PAIRING_REQUEST_CAP"
        | "SNAPBACK_AUTH_RETRY_EPISODE_CAPACITY"
        | "SNAPBACK_API_NETWORK_FLOOR_EXCEEDED"
        | "SNAPBACK_API_DECLARED_LIMIT_EXCEEDED"
        | "SNAPBACK_API_INTEGRATION_LIMIT_EXCEEDED"
        | "SNAPBACK_API_DECLARED_CLIENT_SUSPENDED"
        | "SNAPBACK_API_INTEGRATION_SUSPENDED"
        | "SNAPBACK_ADMIN_APPROVAL_RATE_LIMITED"
        | "SNAPBACK_ADMIN_CLAIM_RATE_LIMITED"
        | "SNAPBACK_ADMIN_CONSOLE_CREDENTIAL_RATE_LIMITED"
        | "SNAPBACK_ADMIN_REACHABILITY_CAPACITY"
        | "SNAPBACK_EPHEMERAL_RATE_LIMITED"
        | "SNAPBACK_ACTION_PROGRESS_RATE_EXCEEDED"
        | "SNAPBACK_SUBSCRIPTION_CONNECTION_LIMIT"
        | "SNAPBACK_SUBSCRIPTION_GLOBAL_LIMIT" => StatusCode::TOO_MANY_REQUESTS,
        "SNAPBACK_AUTH_REHEARSAL_BUDGET_EXHAUSTED" => StatusCode::TOO_MANY_REQUESTS,
        "SNAPBACK_VALUE_TOO_LARGE"
        | "SNAPBACK_JOB_ARGS_TOO_LARGE"
        | "SNAPBACK_EPHEMERAL_METADATA_TOO_LARGE"
        | "SNAPBACK_EPHEMERAL_VALUE_TOO_LARGE"
        // @ref LLP 0211#representation-and-write-path — structured admission
        //   ceilings are payload-size refusals, not schema defects.
        | "SNAPBACK_STRUCTURED_ROW_BYTES_EXCEEDED"
        | "SNAPBACK_STRUCTURED_VALUE_BYTES_EXCEEDED"
        | "SNAPBACK_ACTION_STREAM_LIMIT_EXCEEDED"
        | "SNAPBACK_HOST_FETCH_RESPONSE_TOO_LARGE"
        | "SNAPBACK_HANDLER_EVAL_OUTPUT_TOO_LARGE"
        | "SNAPBACK_HANDLER_HOST_CALL_BODY_TOO_LARGE"
        | "SNAPBACK_CLIENT_MUTATION_RESULT_TOO_LARGE"
        | "SNAPBACK_WEBSOCKET_MESSAGE_TOO_LARGE" => StatusCode::PAYLOAD_TOO_LARGE,
        "SNAPBACK_ADMIN_SECRET_READ_LEASE_INVALID"
        | "SNAPBACK_TELEMETRY_EXPORT_CONTINUATION_INVALID"
        | "SNAPBACK_TELEMETRY_EXPORT_PAGE_TOO_SMALL"
        | "SNAPBACK_TELEMETRY_QUERY_INVALID"
        | "SNAPBACK_TELEMETRY_SQL_DENIED"
        | "SNAPBACK_TELEMETRY_SQL_FAILED"
        // @ref LLP 0156#e14--surface-typed-operations-projected-everywhere-d5-discipline —
        //   malformed selectors/ids/transitions and unknown or pruned release
        //   names are non-retryable as written; clients must correct the
        //   request, using the returned known-release list where applicable.
        | "SNAPBACK_ERRORS_QUERY_INVALID"
        | "SNAPBACK_ERROR_ISSUE_ID_INVALID"
        | "SNAPBACK_ERROR_RELEASE_UNKNOWN_OR_PRUNED"
        | "SNAPBACK_ERROR_TRANSITION_INVALID"
        | "SNAPBACK_AUTH_IMPERSONATION_FILE_INVALID"
        | "SNAPBACK_AUTH_REHEARSAL_REQUEST_INVALID"
        // @ref LLP 0094#0e--refusal-code-registry-negotiation — the wire-version
        // negotiation refusals are HTTP 400 in the standard error envelope.
        | "SNAPBACK_EPHEMERAL_AUTHORITY_INSTANCE_REQUIRED"
        | "SNAPBACK_LIVE_RESUME_FUNCTION_MISMATCH" => StatusCode::BAD_REQUEST,
        "SNAPBACK_ACTION_TIMEOUT"
        | "SNAPBACK_ACTION_STREAM_TIMEOUT"
        | "SNAPBACK_ACTION_STREAM_IDLE_TIMEOUT"
        | "SNAPBACK_HANDLER_WALL_CLOCK_EXCEEDED" => {
            StatusCode::GATEWAY_TIMEOUT
        }
        // @ref LLP 0076#settlement-and-retry — transport failure and
        // ambiguity are upstream outcomes, distinct from malformed author
        // input and from Snapback's own internal failures.
        "SNAPBACK_ACTION_STREAM_UPSTREAM_FAILED"
        | "SNAPBACK_ACTION_STREAM_UPSTREAM_AMBIGUOUS"
        // Buffered ctx.fetch upstream outcomes (0137 a4-f1/a5-f1): transport
        // failure and a non-UTF-8 upstream body are upstream facts.
        | "SNAPBACK_HOST_FETCH_FAILED"
        | "SNAPBACK_HOST_FETCH_RESPONSE_INVALID_UTF8" => StatusCode::BAD_GATEWAY,
        // @ref LLP 0058#admitted-body-ingestion — the admitted ingest deadline
        // is a client fault: the request body never finished arriving.
        "SNAPBACK_REQUEST_BODY_TIMEOUT" => StatusCode::REQUEST_TIMEOUT,
        // @ref LLP 0154#d7--aggregates-a-watermarked-state-machine-mergeable-by-construction — the D7
        // benchmark runs as an internal evidence executable, so its
        // configuration, harness, identity, and measured-ceiling failures are
        // proof failures rather than request-input classes. Preserve the
        // fail-safe 500 projection if one ever crosses ApiError.
        "SNAPBACK_TELEMETRY_BENCH_AMPLIFICATION_FAILED"
        | "SNAPBACK_TELEMETRY_BENCH_APP_ACCOUNTING_FAILED"
        | "SNAPBACK_TELEMETRY_BENCH_APP_WORKER_BYPASSED"
        | "SNAPBACK_TELEMETRY_BENCH_BASELINE_INVALID"
        | "SNAPBACK_TELEMETRY_BENCH_BUILD_IDENTITY_INVALID"
        | "SNAPBACK_TELEMETRY_BENCH_BUILD_PROFILE_INVALID"
        | "SNAPBACK_TELEMETRY_BENCH_CONFIG_INVALID"
        | "SNAPBACK_TELEMETRY_BENCH_EVENT_WORKER_FAILED"
        | "SNAPBACK_TELEMETRY_BENCH_FILE_CAP_FAILED"
        | "SNAPBACK_TELEMETRY_BENCH_HTTP_FAILED"
        | "SNAPBACK_TELEMETRY_BENCH_LATENCY_CEILING_FAILED"
        | "SNAPBACK_TELEMETRY_BENCH_QUERY_CARDINALITY_FAILED"
        | "SNAPBACK_TELEMETRY_BENCH_RUNTIME_FAILED"
        | "SNAPBACK_TELEMETRY_BENCH_SHED_FAILED"
        | "SNAPBACK_TELEMETRY_BENCH_SWEEP_FAILED"
        | "SNAPBACK_TELEMETRY_BENCH_TEMPDIR_FAILED"
        | "SNAPBACK_TELEMETRY_BENCH_WORKER_TIMEOUT"
        | "SNAPBACK_TELEMETRY_EXPORT_ENVELOPE_BOUND_EXCEEDED"
        | "SNAPBACK_TELEMETRY_EXPORT_RESPONSE_FAILED"
        | "SNAPBACK_TELEMETRY_EXPORT_SERIALIZATION_FAILED"
        // @ref LLP 0156#e13--the-issue-state-machine — these are durable
        // telemetry-state or server-serialization failures, never authored
        // request classes. A retry is meaningful only after the server/store
        // fault is repaired; preserve the fail-safe 500 projection.
        | "SNAPBACK_ERROR_GROUP_STATE_INVALID"
        | "SNAPBACK_ERROR_RESOLVE_BARRIER_MISSING"
        | "SNAPBACK_ERROR_ROLLOUT_INVALID"
        | "SNAPBACK_ERROR_STATE_SEQUENCE_EXHAUSTED"
        | "SNAPBACK_ERROR_STATE_SEQUENCE_INVALID"
        | "SNAPBACK_ERROR_TRANSITION_SERIALIZATION_FAILED"
        | "SNAPBACK_ERRORS_QUERY_SERIALIZATION_FAILED"
        | "SNAPBACK_TELEMETRY_SEQUENCE_EXHAUSTED"
        | "SNAPBACK_TELEMETRY_SEQUENCE_INVALID"
        | "SNAPBACK_TELEMETRY_FLUSH_FAILED"
        | "SNAPBACK_TELEMETRY_QUERY_SERIALIZATION_FAILED"
        | "SNAPBACK_TELEMETRY_SQL_OPEN_FAILED" => StatusCode::INTERNAL_SERVER_ERROR,
        "SNAPBACK_ACTION_CAPACITY_EXCEEDED"
        | "SNAPBACK_ACTION_STREAM_UNSUPPORTED"
        | "SNAPBACK_HOST_FETCH_UNSUPPORTED"
        | "SNAPBACK_CRON_DISPATCH_CAPACITY_EXCEEDED"
        | "SNAPBACK_CRON_DEFINITION_GENERATION_EXHAUSTED"
        | "SNAPBACK_CRON_RUN_CAPACITY_EXCEEDED"
        | "SNAPBACK_CRON_RUN_SEQUENCE_EXHAUSTED"
        | "SNAPBACK_HANDLER_INVOCATION_EPOCH_EXHAUSTED"
        | "SNAPBACK_OVERLOADED"
        | "SNAPBACK_CLIENT_MUTATION_RETENTION_FULL"
        | "SNAPBACK_CONNECTED_CLIENT_CAPACITY"
        | "SNAPBACK_LIVE_STAGE_CAPACITY"
        | "SNAPBACK_LIVE_STAGE_UNAVAILABLE"
        | "SNAPBACK_READ_LANE_UNAVAILABLE"
        | "SNAPBACK_CAPABILITY_EXACT_ADMIN_DIST_MISSING"
        | "SNAPBACK_CAPABILITY_EXACT_NATIVE_ARTIFACTS_UNAVAILABLE"
        | "SNAPBACK_CAPABILITY_EXACT_NATIVE_ARTIFACT_MISSING"
        | "SNAPBACK_CAPABILITY_MINIFLARE_MISSING"
        | "SNAPBACK_CAPABILITY_WORKERD_MISSING"
        | "SNAPBACK_AUTH_CATALOG_CORRUPT"
        | "SNAPBACK_AUTH_CATALOG_VERSION_UNSUPPORTED"
        | "SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE"
        | "SNAPBACK_AUTH_MODE_QUIESCENCE_TIMEOUT"
        | "SNAPBACK_AUTH_MODE_DOWNGRADE_COMMITTED"
        | "SNAPBACK_AUTH_MODE_STATE_CORRUPT"
        | "SNAPBACK_AUTH_MODE_PENDING"
        | "SNAPBACK_AUTH_DEPLOYMENT_UNSUPPORTED"
        | "SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH"
        | "SNAPBACK_AUTH_STARTUP_ARTIFACT_REQUIRED"
        | "SNAPBACK_AUTH_CLOCK_ROLLBACK"
        | "SNAPBACK_AUTHORIZED_LEASE_KEY_UNAVAILABLE"
        | "SNAPBACK_AUTHORIZED_LEASE_STATE_CORRUPT"
        | "SNAPBACK_AUTHORIZED_LEASE_UNAVAILABLE"
        | "SNAPBACK_AUTH_INVALIDATION_CAUSE_EXHAUSTED"
        | "SNAPBACK_AUTH_INVALIDATION_CONNECTION_GENERATION_EXHAUSTED"
        | "SNAPBACK_AUTH_INVALIDATION_ISSUER_EXHAUSTED"
        | "SNAPBACK_AUTH_INVALIDATION_ISSUER_UNAVAILABLE"
        | "SNAPBACK_AUTH_INVALIDATION_REVISION_EXHAUSTED"
        | "SNAPBACK_AUTH_INVALIDATION_SCOPE_SEQUENCE_EXHAUSTED"
        | "SNAPBACK_AUTH_POLICY_UNAVAILABLE"
        | "SNAPBACK_AUTH_PROJECTION_CORRUPT"
        | "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE"
        | "SNAPBACK_AUTH_RESERVATION_CANCELLED"
        | "SNAPBACK_AUTH_PROVIDER_UNAVAILABLE"
        | "SNAPBACK_AUTH_PASSWORD_REQUIRES_V4"
        | "SNAPBACK_AUTH_EFFECTIVE_SOURCE_UNAVAILABLE"
        | "SNAPBACK_AUTH_SOURCE_UNTRUSTED"
        | "SNAPBACK_AUTH_THROTTLE_UNAVAILABLE"
        | "SNAPBACK_AUTH_REHEARSAL_NAMESPACE_UNAVAILABLE"
        | "SNAPBACK_AUTH_REHEARSAL_REACHABILITY_INVALID"
        | "SNAPBACK_AUTH_REHEARSAL_PRODUCER_PARITY"
        | "SNAPBACK_AUTH_REHEARSAL_EXPORT_KEY_UNAVAILABLE"
        | "SNAPBACK_AUTH_REHEARSAL_PROVENANCE_INVALID"
        | "SNAPBACK_AUTH_STEP_UP_DELIVERY_UNAVAILABLE"
        | "SNAPBACK_AUTH_AGENT_COMMIT_UNCERTAIN"
        | "SNAPBACK_AUTH_GRANT_COMMIT_UNCERTAIN"
        | "SNAPBACK_AUTH_GRANT_STATE_CORRUPT"
        | "SNAPBACK_AUTH_SCOPE_BASIS_CORRUPT"
        | "SNAPBACK_EPHEMERAL_AUTHORITY_PENDING"
        | "SNAPBACK_SEARCH_INDEX_UNAVAILABLE"
        | "SNAPBACK_EPHEMERAL_GENERATION_EXHAUSTED"
        | "SNAPBACK_AUTH_REVOCATION_UNCERTAIN"
        | "SNAPBACK_AUTH_RETRY_EXHAUSTED"
        | "SNAPBACK_AUTH_STREAM_INCARNATION_CORRUPT"
        | "SNAPBACK_ADMIN_SECRET_READ_GENERATION_EXHAUSTED"
        | "SNAPBACK_APP_GENERATION_EXHAUSTED"
        | "SNAPBACK_PERMISSION_EPOCH_EXHAUSTED"
        | "SNAPBACK_AUTHORIZATION_EPOCH_EXHAUSTED"
        | "SNAPBACK_AUTHORIZATION_VERSION_CORRUPT"
        | "SNAPBACK_STORAGE_VERSION_CORRUPT"
        | "SNAPBACK_STORAGE_VERSION_EXHAUSTED"
        | "SNAPBACK_SEQUENCE_EXHAUSTED"
        | "SNAPBACK_CAPABILITY_UNSUPPORTED"
        // LLP 0080 §2: a full page must carry its continuation, so an
        // unmintable cursor is a transient serving failure, not a terminal
        // page silently lied about.
        // LLP 0148 §D3: a random-body id (only `usr_`) cannot be minted
        // without the OS CSPRNG, and there is no weak fallback.
        | "SNAPBACK_RANDOM_UNAVAILABLE"
        | "SNAPBACK_RELATIONAL_CURSOR_MINT_UNAVAILABLE"
        | "SNAPBACK_BOUNDED_CHILDREN_CURSOR_MINT_UNAVAILABLE"
        | "SNAPBACK_SNAPSHOT_BATCH_CURSOR_MINT_UNAVAILABLE"
        | "SNAPBACK_STANDARD_PATTERN_CURSOR_MINT_UNAVAILABLE"
        // LLP 0081 §4: the persisted fence and barrier failures are
        // transient serving refusals — the barrier clears at a terminal
        // journal state.
        | "SNAPBACK_MIGRATION_FENCE_CLOSED"
        | "SNAPBACK_MIGRATION_BARRIER_FAILED"
        | "SNAPBACK_V8_RUNNER_HOST_UNSUPPORTED" => StatusCode::SERVICE_UNAVAILABLE,
        // Exhaustive allow-list of request, declaration, authorization, and
        // application-handler diagnostics. Adding a new code does not add it
        // here automatically: the default below remains a truthful 500 until
        // its producer deliberately chooses a client class.
        // LLP 0044 asset classes (LLP 0012 dated registration 2026-07-31):
        // each producer chose these deliberately with this landing.
        "SNAPBACK_ASSET_MEDIA_TYPE_UNSUPPORTED"
        | "SNAPBACK_ASSET_DEFERRED_LENGTH_UNSUPPORTED"
        | "SNAPBACK_ASSET_GRANT_INPUT_INVALID" => StatusCode::BAD_REQUEST,
        "SNAPBACK_ASSET_FORBIDDEN"
        | "SNAPBACK_ASSET_GRANT_FORBIDDEN"
        | "SNAPBACK_ASSET_OWNER_CUSTODY_UNSATISFIABLE" => {
            StatusCode::FORBIDDEN
        }
        "SNAPBACK_ASSET_INTENT_UNKNOWN"
        | "SNAPBACK_ASSET_ATTEMPT_UNKNOWN"
        | "SNAPBACK_ASSET_GRANT_UNKNOWN"
        | "SNAPBACK_ASSET_UNKNOWN" => StatusCode::NOT_FOUND,
        "SNAPBACK_ASSET_LENGTH_MISMATCH"
        | "SNAPBACK_ASSET_DIGEST_MISMATCH"
        | "SNAPBACK_ASSET_REF_UNVERIFIED"
        | "SNAPBACK_ASSET_ATTACH_INTENT_MISMATCH"
        | "SNAPBACK_ASSET_ATTACH_UNAVAILABLE"
        | "SNAPBACK_ASSET_ATTACH_DENIED" => StatusCode::BAD_REQUEST,
        // Generated media-collection operations (LLP 0239 D2/D4): argument,
        // bound, ordering, and sharing-selection refusals are client
        // contract faults like the attach family above; parent authority
        // denial is 403; unknown parent/item are 404 (existence secrecy
        // rides the same class as the asset-unknown family); duplicate
        // asset/item admission races are 409. MANIFEST_INVALID and
        // STORAGE_INVALID stay deliberately unlisted (truthful 500):
        // both are descriptor/storage integrity defects, not client-fixable.
        "SNAPBACK_MEDIA_COLLECTION_ARGUMENT_INVALID"
        | "SNAPBACK_MEDIA_COLLECTION_MUTATION_ATTEMPT_REQUIRED"
        | "SNAPBACK_MEDIA_COLLECTION_LIMIT_EXCEEDED"
        | "SNAPBACK_MEDIA_COLLECTION_REORDER_INVALID"
        | "SNAPBACK_MEDIA_COLLECTION_CREATED_ORDER_REORDER_REFUSED"
        | "SNAPBACK_MEDIA_COLLECTION_SHARING_SELECTION_INVALID"
        | "SNAPBACK_MEDIA_COLLECTION_SHARING_OUTSIDE_CEILING"
        | "SNAPBACK_MEDIA_COLLECTION_SHARING_DERIVATION_INVALID"
        | "SNAPBACK_MEDIA_COLLECTION_RAW_WRITE_REFUSED"
        | "SNAPBACK_MEDIA_COLLECTION_COMMAND_BINDING_REQUIRED"
        | "SNAPBACK_MEDIA_COMMAND_BINDING_REQUIRED"
        | "SNAPBACK_MEDIA_COMMAND_BINDING_INVALID"
        | "SNAPBACK_MEDIA_COMMAND_MUTATION_ATTEMPT_REQUIRED"
        | "SNAPBACK_MEDIA_COMMAND_ARGUMENT_INVALID" => StatusCode::BAD_REQUEST,
        "SNAPBACK_MEDIA_COLLECTION_PARENT_FORBIDDEN" => StatusCode::FORBIDDEN,
        "SNAPBACK_MEDIA_COLLECTION_PARENT_UNAVAILABLE"
        | "SNAPBACK_MEDIA_COLLECTION_ITEM_UNKNOWN" => StatusCode::NOT_FOUND,
        "SNAPBACK_MEDIA_COLLECTION_DUPLICATE_ASSET"
        | "SNAPBACK_MEDIA_COLLECTION_DUPLICATE_ITEM" => StatusCode::CONFLICT,
        "SNAPBACK_ASSET_ADMISSION_REVOKED" => StatusCode::FORBIDDEN,
        // Signed-URL refusals: an expired bearer is 401 (re-issuance is the
        // recovery); a token that does not validate — bad shape, rotated or
        // unknown key, signature/generation mismatch — is one 403 class so
        // a probe learns nothing about which part failed.
        "SNAPBACK_ASSET_SIGNATURE_EXPIRED" => StatusCode::UNAUTHORIZED,
        "SNAPBACK_ASSET_SIGNATURE_INVALID" => StatusCode::FORBIDDEN,
        "SNAPBACK_ASSET_REQUEST_INVALID" | "SNAPBACK_ASSET_TTL_INVALID" => {
            StatusCode::BAD_REQUEST
        }
        "SNAPBACK_ASSET_DELIVERY_PROFILE_UNSUPPORTED" => StatusCode::UNPROCESSABLE_ENTITY,
        "SNAPBACK_ASSET_LOCATION_POLICY_UNSUPPORTED" => StatusCode::UNPROCESSABLE_ENTITY,
        // Image-processing refusals about the client's bytes are 422: the
        // request was well-formed, the content is unprocessable under the
        // declared Enforced ceilings or undecodable as its detected type.
        // SNAPBACK_ASSET_IMAGE_TIME_BUDGET_EXCEEDED and
        // SNAPBACK_ASSET_WORK_PARAMS_INVALID stay deliberately unlisted
        // (truthful 500): the first is a server resource condition, the
        // second an internal ledger-row defect — neither is client-fixable.
        "SNAPBACK_ASSET_IMAGE_BOUNDS_EXCEEDED"
        | "SNAPBACK_ASSET_IMAGE_DECODE_FAILED"
        // Video container refusals are the same class: well-formed request,
        // content unprocessable under the Enforced ceilings, structurally
        // hostile, or carrying metadata the strip cannot classify — all
        // client-fixable by different content or a retain declaration.
        | "SNAPBACK_ASSET_VIDEO_BOUNDS_EXCEEDED"
        | "SNAPBACK_ASSET_VIDEO_PARSE_FAILED"
        | "SNAPBACK_ASSET_VIDEO_STRIP_UNSUPPORTED"
        // Bounded on-demand widths (LLP 0044 §Ceremony floor): a width the
        // ladder cannot admit, or a target without the rewriting fact —
        // both client-fixable by a different request.
        | "SNAPBACK_ASSET_WIDTH_ABOVE_CEILING"
        | "SNAPBACK_ASSET_WIDTH_UNSUPPORTED"
        // LLP 0109 §17: fixture bytes did not publish under the declared
        // intent — content-unprocessable, same class as the media refusals.
        | "SNAPBACK_ASSET_SEED_FIXTURE_REJECTED" => StatusCode::UNPROCESSABLE_ENTITY,
        "SNAPBACK_ASSET_INTENT_STALE"
        | "SNAPBACK_ASSET_INTENT_REVOKED"
        | "SNAPBACK_ASSET_OFFSET_CONFLICT"
        | "SNAPBACK_ASSET_ATTEMPT_TERMINAL"
        | "SNAPBACK_ASSET_TRANSFER_INCOMPLETE"
        | "SNAPBACK_ASSET_ADMISSION_STALE"
        | "SNAPBACK_ASSET_ADMISSION_CONFLICT"
        | "SNAPBACK_ASSET_GENERATION_STALE"
        | "SNAPBACK_ASSET_NOT_READY"
        | "SNAPBACK_ASSET_REFERENCED"
        | "SNAPBACK_ASSET_GRANTS_UNDECLARED"
        | "SNAPBACK_ASSET_GRANT_STATE_INVALID"
        | "SNAPBACK_ASSET_GRANT_CONFLICT"
        // LLP 0109 §17: ordering precondition — run asset.ensureSeedFixture
        // first, then re-send the ensure.
        | "SNAPBACK_SEED_ASSET_FIXTURE_NOT_INGESTED" => StatusCode::CONFLICT,
        "SNAPBACK_ASSET_VARIANT_UNKNOWN" => StatusCode::NOT_FOUND,
        // LLP 0062 §5 app-api serving classes, chosen deliberately:
        // a malformed hash is a request defect; an evicted or unknown hash
        // and a dev target's absent discovery document are both "nothing
        // here" — and both carry `no-store` so a cached negative can never
        // hide a valid envelope after a rollback.
        "SNAPBACK_APP_API_ENVELOPE_HASH_INVALID" => StatusCode::BAD_REQUEST,
        "SNAPBACK_APP_API_ENVELOPE_UNKNOWN" | "SNAPBACK_APP_API_UNAVAILABLE" => {
            StatusCode::NOT_FOUND
        }
        "SNAPBACK_ASSET_ATTEMPT_EXPIRED" | "SNAPBACK_OPERATION_RESULT_EXPIRED" => {
            StatusCode::GONE
        }
        "SNAPBACK_ASSET_MEDIA_BOUNDS_EXCEEDED" => StatusCode::PAYLOAD_TOO_LARGE,
        "SNAPBACK_ASSET_QUOTA_EXCEEDED"
        | "SNAPBACK_ASSET_GRANT_QUOTA_EXCEEDED"
        | "SNAPBACK_ASSET_CEILING_EXCEEDED" => StatusCode::TOO_MANY_REQUESTS,
        "SNAPBACK_ASSET_TUS_VERSION_UNSUPPORTED" => StatusCode::PRECONDITION_FAILED,
        "SNAPBACK_ASSET_TUS_CONTENT_TYPE_UNSUPPORTED" => {
            StatusCode::UNSUPPORTED_MEDIA_TYPE
        }
        // TUS 1.0.0's checksum-mismatch class (460 has no StatusCode const).
        "SNAPBACK_ASSET_CHUNK_CHECKSUM_INVALID" => {
            StatusCode::from_u16(460).unwrap_or(StatusCode::BAD_REQUEST)
        }
        "SNAPBACK_ARG_MISSING"
        | "SNAPBACK_ACTION_MUTATION_REFERENCE_INVALID"
        | "SNAPBACK_ACTION_STREAM_INVALID"
        | "SNAPBACK_ACTION_STREAM_SSRF_REFUSED"
        | "SNAPBACK_HOST_FETCH_INVALID"
        | "SNAPBACK_HOST_FETCH_SSRF_REFUSED"
        | "SNAPBACK_HOST_FETCH_SLOT_INVALID"
        | "SNAPBACK_AUTHORITY_INDEPENDENT_INVALID"
        | "SNAPBACK_PUBLIC_INLINE_INVALID"
        | "SNAPBACK_ROUTES_MANIFEST_INVALID"
        | "SNAPBACK_AUTHORIZED_LEASE_CONFIG_INVALID"
        | "SNAPBACK_AUTHORIZED_LEASE_INVALID"
        | "SNAPBACK_AUTHORIZED_LEASE_QUERY_NOT_RETAINABLE"
        | "SNAPBACK_BUFFERED_WRITE_LIMIT_EXCEEDED"
        | "SNAPBACK_CLIENT_MUTATION_ACK_LIMIT_EXCEEDED"
        | "SNAPBACK_CLIENT_MUTATION_ACK_OVERLAP"
        | "SNAPBACK_CLIENT_MUTATION_PURGE_SELECTOR_INVALID"
        | "SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED"
        | "SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY"
        | "SNAPBACK_AUTH_MUTABLE_INPUT_DENIED"
        | "SNAPBACK_AUTH_INVALIDATION_ACK_BEFORE_COMMIT"
        | "SNAPBACK_AUTH_REQUEST_INVALID"
        | "SNAPBACK_AUTH_GRANT_EXPIRY_INVALID"
        | "SNAPBACK_AUTH_GRANT_SCOPE_INVALID"
        | "SNAPBACK_AUTH_RESCUE_INVALID"
        | "SNAPBACK_AUTH_RESCUE_MANAGED_STATE_UNSUPPORTED"
        | "SNAPBACK_AUTH_RESCUE_SCHEMA_UNSUPPORTED"
        | "SNAPBACK_AUTH_STALE_RESULT"
        | "SNAPBACK_AUTH_UNDECLARABLE_RETENTION"
        | "SNAPBACK_AUTH_USER_MISSING"
        | "SNAPBACK_TABLE_WRITE_UNDECLARED_REFUSED"
        | "SNAPBACK_TABLE_WRITE_UNCOMPOSED_SURFACE"
        | "SNAPBACK_TABLE_WRITE_UNIQUE_DISCLOSURE_REQUIRED"
        | "SNAPBACK_TABLE_WRITE_OWNER_INPUT_REFUSED"
        | "SNAPBACK_TABLE_WRITE_OWNER_IMMUTABLE"
        | "SNAPBACK_AUTH_SCOPED_TOKEN_TTL_INVALID"
        | "SNAPBACK_BINDING_MISSING"
        | "SNAPBACK_CAPTURED_READ_INVALID"
        | "SNAPBACK_CLIENT_MUTATION_ID_INVALID"
        // @ref LLP 0162#acceptance — client mutation transport cannot omit
        //   its retry key or claim the server-derived Host identity namespace.
        | "SNAPBACK_OPERATION_IDENTITY_REQUIRES_CLIENT_MUTATION_ID"
        | "SNAPBACK_OPERATION_HOST_IDENTITY_FORBIDDEN"
        | "SNAPBACK_CONFIG_DEFAULT_UNIMPLEMENTED"
        | "SNAPBACK_CONFIG_ENTRY_INVALID"
        | "SNAPBACK_CONFIG_MISSING"
        | "SNAPBACK_CONFIG_NON_SECRET_UNIMPLEMENTED"
        | "SNAPBACK_CONFIG_PROBE_INVALID"
        | "SNAPBACK_CONFIG_PROBE_MISSING"
        | "SNAPBACK_CONFIG_REQUIRED_MISSING"
        | "SNAPBACK_CONFIG_TRANSIT_RULE"
        | "SNAPBACK_CONFIG_UNDECLARED"
        | "SNAPBACK_CONFIG_USES_UNKNOWN"
        | "SNAPBACK_CONFIG_VALUE_INVALID"
        | "SNAPBACK_CONFIG_VERIFY_COOLDOWN"
        | "SNAPBACK_CRON_ACTION_KIND_MISMATCH"
        | "SNAPBACK_CRON_ACTION_MISSING"
        | "SNAPBACK_CRON_AUTH_REQUIREMENT_INVALID"
        | "SNAPBACK_CRON_DUPLICATE_JOB"
        | "SNAPBACK_CRON_INVALID_EXPRESSION"
        | "SNAPBACK_CRON_INVALID_INTERVAL"
        | "SNAPBACK_CRON_INVALID_SCHEDULE"
        | "SNAPBACK_CRON_JITTER_INVALID"
        | "SNAPBACK_CRON_JOB_DISABLED"
        | "SNAPBACK_CRON_JOB_IN_FLIGHT"
        | "SNAPBACK_CRON_JOB_INVALID"
        | "SNAPBACK_CRON_RETRY_MODE_UNIMPLEMENTED"
        | "SNAPBACK_CRON_TARGET_CADENCE_UNSUPPORTED"
        | "SNAPBACK_CRON_UNSATISFIABLE_EXPRESSION"
        | "SNAPBACK_CRON_WHILE_LIVE_EMPTY"
        | "SNAPBACK_CRON_WHILE_LIVE_KIND_MISMATCH"
        | "SNAPBACK_CRON_WHILE_LIVE_MISSING"
        | "SNAPBACK_CTX_LEDGER_EXHAUSTED"
        | "SNAPBACK_CTX_LEDGER_ID_INVALID"
        | "SNAPBACK_CTX_LEDGER_LIMIT_EXCEEDED"
        | "SNAPBACK_CTX_LEDGER_UNUSED_IDS"
        | "SNAPBACK_CTX_LEDGER_VERSION_UNSUPPORTED"
        | "SNAPBACK_DATA_TIER_VERSION_REQUIRED"
        | "SNAPBACK_DATA_TIER_VERSION_UNSUPPORTED"
        | "SNAPBACK_EPHEMERAL_INVALID_SCOPE"
        | "SNAPBACK_EPHEMERAL_INVALID_TTL"
        | "SNAPBACK_EPHEMERAL_OPERATOR_DELETE_REASON_REQUIRED"
        | "SNAPBACK_EPHEMERAL_MISSING_KEY"
        | "SNAPBACK_EPHEMERAL_MISSING_OWNER"
        | "SNAPBACK_EPHEMERAL_ROOM_LIMIT_EXCEEDED"
        | "SNAPBACK_EPHEMERAL_UNAUTHORIZED"
        | "SNAPBACK_EPHEMERAL_UNKNOWN_COLLECTION"
        | "SNAPBACK_EXPECTED_STRING"
        | "SNAPBACK_EXPLAIN_KIND_UNIMPLEMENTED"
        | "SNAPBACK_EXPLAIN_KIND_UNKNOWN"
        | "SNAPBACK_EXPR_TYPE"
        | "SNAPBACK_EXPR_UNANALYZABLE"
        | "SNAPBACK_EXPR_UNSUPPORTED_FUNCTION"
        | "SNAPBACK_FIELD_ENUM_VALUE_INVALID"
        | "SNAPBACK_FIELD_MISSING"
        | "SNAPBACK_FIELD_TYPE_MISMATCH"
        | "SNAPBACK_FUNCTION_IDENTITY_COLLISION"
        | "SNAPBACK_FUNCTION_IDENTITY_INVALID"
        | "SNAPBACK_FUNCTION_KIND_MISMATCH"
        | "SNAPBACK_FUNCTION_KIND_RUNTIME_MISMATCH"
        | "SNAPBACK_FUNCTION_NOT_LIVE"
        | "SNAPBACK_FUNCTION_SCHEMA_REFERENCE_INVALID"
        | "SNAPBACK_ORDER_FIELD_MAX_ENCODED_BYTES_EXCEEDED"
        | "SNAPBACK_APP_REFUSAL"
        | "SNAPBACK_FUNCTION_REFUSAL_DECLARATION_INVALID"
        | "SNAPBACK_FUNCTION_TRACKED_REFUSAL_INVALID"
        | "SNAPBACK_BOUNDED_SKEW_DECLARATION_INVALID"
        | "SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED"
        | "SNAPBACK_HANDLER_CAPABILITY_DENIED"
        | "SNAPBACK_HANDLER_DID_NOT_SETTLE"
        | "SNAPBACK_HANDLER_EXPORT_MISSING"
        | "SNAPBACK_HANDLER_FAILED"
        | "SNAPBACK_HANDLER_HOST_CALL_INVALID"
        | "SNAPBACK_HANDLER_HOST_CALL_INVALID_JSON"
        | "SNAPBACK_HANDLER_HOST_CALL_MALFORMED"
        | "SNAPBACK_HANDLER_HOST_CALL_UNKNOWN"
        | "SNAPBACK_HANDLER_RESULT_INVALID"
        | "SNAPBACK_HANDLER_STALE_CONTINUATION"
        | "SNAPBACK_HANDLER_UNHANDLED_REJECTION"
        | "SNAPBACK_UNHANDLED_REJECTION"
        // @ref LLP 0146#d1-declarationobservation-conformance — a strict-mode
        //   undeclared read/write is an authoring fault in the app, never a
        //   server error.
        | "SNAPBACK_HANDLER_UNDECLARED_READ"
        | "SNAPBACK_HANDLER_UNDECLARED_WRITE"
        | "SNAPBACK_HANDLER_WRITE_IN_QUERY"
        | "SNAPBACK_MUTATION_SETTLEMENT_UNAVAILABLE"
        | "SNAPBACK_SEQUENCE_DECLARATION_INVALID"
        | "SNAPBACK_SEQUENCE_UNDECLARED"
        | "SNAPBACK_SNAPSHOT_BATCH_PLAN_INVALID"
        | "SNAPBACK_SNAPSHOT_BATCH_NODE_INELIGIBLE"
        | "SNAPBACK_SNAPSHOT_BATCH_CEILING_EXCEEDED"
        | "SNAPBACK_SNAPSHOT_BATCH_RESULT_CONTRACT_INVALID"
        | "SNAPBACK_SNAPSHOT_BATCH_CURSOR_BUDGET_EXCEEDED"
        // @ref LLP 0166#d7--the-gated-evaluation-profile-and-the-carried-amendments — TransformPlanV1 validation
        //   refusals are authoring faults (the profile is closed); the feature is
        //   dormant, so these classify before any evaluation ships.
        | "SNAPBACK_RESULT_TRANSFORM_BASE_INVALID"
        | "SNAPBACK_RESULT_TRANSFORM_COMPARATOR_UNKNOWN"
        | "SNAPBACK_RESULT_TRANSFORM_CROSS_ADDRESS"
        | "SNAPBACK_RESULT_TRANSFORM_FIELD_UNPROJECTED"
        | "SNAPBACK_RESULT_TRANSFORM_LIMIT_INVALID"
        | "SNAPBACK_RESULT_TRANSFORM_MIXED_VERSION"
        | "SNAPBACK_RESULT_TRANSFORM_NON_SCALAR"
        | "SNAPBACK_RESULT_TRANSFORM_NORMALIZATION_UNADMITTED"
        | "SNAPBACK_RESULT_TRANSFORM_ORDER_FIELD_DUPLICATE"
        | "SNAPBACK_RESULT_TRANSFORM_OVERLAY_INPUT_REQUIRED"
        | "SNAPBACK_RESULT_TRANSFORM_PLAN_INVALID"
        | "SNAPBACK_RESULT_TRANSFORM_STAGE_UNKNOWN"
        | "SNAPBACK_HOST_OP_CLI_ONLY"
        | "SNAPBACK_HOST_OP_FUNCTION_KIND_UNSUPPORTED"
        | "SNAPBACK_HOST_OP_FUNCTION_UNKNOWN"
        | "SNAPBACK_HOST_OP_INPUT_MISSING"
        | "SNAPBACK_HOST_OP_UNIMPLEMENTED"
        | "SNAPBACK_HOST_OP_UNKNOWN"
        | "SNAPBACK_INVALID_FLOAT"
        | "SNAPBACK_INVALID_IDENTIFIER"
        | "SNAPBACK_JOB_ACTION_UNKNOWN"
        | "SNAPBACK_JOB_ARGS_INVALID"
        | "SNAPBACK_JOB_ATTEMPT_POLICY_INVALID"
        | "SNAPBACK_JOB_CALLEE_NOT_ADMITTED"
        | "SNAPBACK_JOB_DELAY_INVALID"
        | "SNAPBACK_JOB_ENQUEUE_LIMIT_EXCEEDED"
        | "SNAPBACK_JOB_ENQUEUE_UNAVAILABLE"
        | "SNAPBACK_JOB_IDEMPOTENCY_KEY_INVALID"
        | "SNAPBACK_JOB_STATUS_ARGS_INVALID"
        // @ref LLP 0056#declaring-a-membership-table — every membership
        //   declaration-shape and activation refusal is a client fault (a bad
        //   schema or nonconforming data), never a server error.
        | "SNAPBACK_MEMBERSHIP_ACTIVATION_DANGLING_RESOURCE"
        | "SNAPBACK_MEMBERSHIP_ACTIVATION_DUPLICATE"
        | "SNAPBACK_MEMBERSHIP_ACTIVATION_AXIS_MISSING"
        | "SNAPBACK_MEMBERSHIP_ACTIVATION_NULL_AXIS"
        | "SNAPBACK_MEMBERSHIP_ACTIVATION_TABLE_MISSING"
        | "SNAPBACK_MEMBERSHIP_ACTIVATION_UNKNOWN_ROLE"
        | "SNAPBACK_MEMBERSHIP_ACTIVATION_UNPROTECTED_RESOURCE"
        | "SNAPBACK_MEMBERSHIP_APP_SCOPE_RESOURCE"
        | "SNAPBACK_MEMBERSHIP_APP_SCOPE_RESOURCE_TABLE"
        | "SNAPBACK_MEMBERSHIP_AXIS_COLLISION"
        | "SNAPBACK_MEMBERSHIP_AXIS_FIELD_UNKNOWN"
        | "SNAPBACK_MEMBERSHIP_OPERATION_INVALID"
        // @ref LLP 0240#d3-generate-the-ordinary-roster-and-role-surface — a
        // forged generated-operation marker is a malformed function artifact.
        | "SNAPBACK_GENERATED_AUTHORITY_OPERATION_INVALID"
        | "SNAPBACK_MEMBERSHIP_BOOTSTRAP_ROLE_UNKNOWN"
        | "SNAPBACK_MEMBERSHIP_CONFUSABLE_ROLES"
        | "SNAPBACK_MEMBERSHIP_DUPLICATE_ROLE"
        | "SNAPBACK_MEMBERSHIP_EMPTY_ROLE_LIST"
        | "SNAPBACK_MEMBERSHIP_EMPTY_VOCABULARY"
        | "SNAPBACK_MEMBERSHIP_EXPIRY_EFFECT_UNSUPPORTED"
        | "SNAPBACK_MEMBERSHIP_EXPIRY_FIELD_AXIS"
        | "SNAPBACK_MEMBERSHIP_EXPIRY_FIELD_TYPE"
        | "SNAPBACK_MEMBERSHIP_EXPIRY_FIELD_UNKNOWN"
        | "SNAPBACK_MEMBERSHIP_ID_COLLISION"
        | "SNAPBACK_MEMBERSHIP_ID_INVALID"
        | "SNAPBACK_IMPERSONATED_GLOBAL_ROLE_AMBIGUOUS"
        | "SNAPBACK_IMPERSONATED_GLOBAL_ROLE_INVALID"
        | "SNAPBACK_MEMBERSHIP_INCIDENTAL_FLOOR"
        | "SNAPBACK_MEMBERSHIP_INCIDENTAL_UNKNOWN"
        | "SNAPBACK_MEMBERSHIP_INDEX_NAME_COLLISION"
        | "SNAPBACK_MEMBERSHIP_LAST_HOLDER_APP_SCOPE"
        | "SNAPBACK_MEMBERSHIP_LAST_HOLDER_BOOTSTRAP_MISMATCH"
        | "SNAPBACK_MEMBERSHIP_LAST_HOLDER_ROLE_UNKNOWN"
        | "SNAPBACK_MEMBERSHIP_OPTIONAL_KEY_AXIS"
        | "SNAPBACK_MEMBERSHIP_PERMISSION_BACKING_CONFLICT"
        | "SNAPBACK_MEMBERSHIP_PRINCIPAL_TYPE"
        | "SNAPBACK_MEMBERSHIP_PROVENANCE_FIELD_RESERVED"
        | "SNAPBACK_MEMBERSHIP_RESERVED_ROLE"
        | "SNAPBACK_MEMBERSHIP_RESOURCE_AXIS_REQUIRED"
        | "SNAPBACK_MEMBERSHIP_RESOURCE_REF_INVALID"
        | "SNAPBACK_MEMBERSHIP_RESOURCE_TABLE_MISMATCH"
        | "SNAPBACK_MEMBERSHIP_RESOURCE_TABLE_REQUIRED"
        | "SNAPBACK_MEMBERSHIP_RESOURCE_TABLE_UNKNOWN"
        | "SNAPBACK_MEMBERSHIP_RESOURCE_TYPE"
        | "SNAPBACK_MEMBERSHIP_ROLE_CONTROL_CHARACTER"
        | "SNAPBACK_MEMBERSHIP_ROLE_EMPTY"
        | "SNAPBACK_MEMBERSHIP_ROLE_PENDING_OVERLAP"
        | "SNAPBACK_MEMBERSHIP_ROLE_RESERVED_SEPARATOR"
        | "SNAPBACK_MEMBERSHIP_ROLE_TYPE"
        | "SNAPBACK_MEMBERSHIP_TRANSITION_AXIS_FIELD"
        | "SNAPBACK_MEMBERSHIP_TRANSITION_EMPTY_SET"
        | "SNAPBACK_MEMBERSHIP_TRANSITION_GRAMMAR"
        | "SNAPBACK_MEMBERSHIP_TRANSITION_SELF_ON_OTHER"
        | "SNAPBACK_MEMBERSHIP_TRANSITION_UNKNOWN_CALLER"
        | "SNAPBACK_MEMBERSHIP_TRANSITION_UNKNOWN_FIELD"
        | "SNAPBACK_MEMBERSHIP_TRANSITION_UNKNOWN_ROLE"
        | "SNAPBACK_MEMBERSHIP_UNKNOWN_DECLARATION"
        | "SNAPBACK_MEMBERSHIP_UNKNOWN_ROLE"
        | "SNAPBACK_PERMISSIONS_UNAVAILABLE_IN_ACTION"
        // @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default —
        //   the M2 write-path malformed/structural refusals: a null axis, a
        //   missing resource/target/expiry, an immutable-axis patch, and the
        //   bootstrap/teardown shape mismatches. (The privileged-writer guard
        //   is an internal misuse surfaced as a bad request.)
        | "SNAPBACK_MEMBERSHIP_NULL_AXIS"
        | "SNAPBACK_MEMBERSHIP_BOOTSTRAP_INITIAL_MEMBERS_INVALID"
        | "SNAPBACK_MEMBERSHIP_BOOTSTRAP_DUPLICATE_PRINCIPAL"
        | "SNAPBACK_MEMBERSHIP_BOOTSTRAP_RESOURCE_UNEXPECTED"
        | "SNAPBACK_MEMBERSHIP_RESOURCE_MISSING"
        | "SNAPBACK_MEMBERSHIP_RESOURCE_UNEXPECTED"
        | "SNAPBACK_MEMBERSHIP_TARGET_MISSING"
        | "SNAPBACK_MEMBERSHIP_PATCH_AXIS"
        | "SNAPBACK_MEMBERSHIP_NOT_DECLARED"
        // @ref LLP 0100#3-host-resolution-and-linearization — the
        //   principal-addressed removal's typed misuses are author input:
        //   the closed-by-default surface used without its opt-in, an
        //   activation-invalid declaration, a shape-invalid principal, and
        //   the self target (self-removal remains removeSelf). The
        //   authorization refusal stays the invariant TRANSITION_DENIED.
        | "SNAPBACK_MEMBERSHIP_PRINCIPAL_ADDRESSED_UNDECLARED"
        | "SNAPBACK_MEMBERSHIP_PRINCIPAL_ADDRESSED_INVALID"
        | "SNAPBACK_MEMBERSHIP_PRINCIPAL_INVALID"
        | "SNAPBACK_MEMBERSHIP_TARGET_SELF"
        // @ref LLP 0240#d3-generate-the-ordinary-roster-and-role-surface —
        //   malformed paging/target arguments and calls against a declaration
        //   that cannot generate the requested authority-profile operation are
        //   author-input errors, distinct from the authorization refusals above.
        | "SNAPBACK_AUTHORITY_PROFILE_INVALID"
        | "SNAPBACK_AUTHORITY_PROFILE_REQUIRED"
        | "SNAPBACK_AUTHORITY_PROFILE_ROSTER_INVALID"
        | "SNAPBACK_CUSTOM_AUTHORIZATION_MANIFEST_INVALID"
        | "SNAPBACK_AUTHORITY_ROSTER_CURSOR_INVALID"
        | "SNAPBACK_AUTHORITY_ROSTER_PAGE_INVALID"
        | "SNAPBACK_AUTHORITY_TRANSFER_OWNER_TARGET_INACTIVE"
        | "SNAPBACK_AUTHORITY_TRANSFER_OWNER_TARGET_INVALID"
        | "SNAPBACK_AUTHORITY_TRANSFER_OWNER_TARGET_SELF"
        | "SNAPBACK_AUTHORITY_TRANSFER_OWNER_UNSUPPORTED"
        | "SNAPBACK_MEMBERSHIP_NO_BOOTSTRAP_ROLE"
        | "SNAPBACK_MEMBERSHIP_BOOTSTRAP_RESOURCE_MISMATCH"
        | "SNAPBACK_MEMBERSHIP_BOOTSTRAP_APP_SCOPE"
        | "SNAPBACK_MEMBERSHIP_TEARDOWN_RESOURCE_MISSING"
        | "SNAPBACK_MEMBERSHIP_NO_EXPIRY"
        | "SNAPBACK_MEMBERSHIP_PRIVILEGED_WRITER_MATRIX"
        | "SNAPBACK_MEMBERSHIP_PRIVILEGED_WRITER_REQUIRED"
        | "SNAPBACK_PERMISSION_SCOPE_MISSING"
        | "SNAPBACK_PLAN_BOUNDS"
        | "SNAPBACK_PLAN_INVALID"
        | "SNAPBACK_PLAN_SOURCE_INVALID"
        // LLP 0080 slice 1: a malformed relational plan is author input.
        | "SNAPBACK_RELATIONAL_PLAN_INVALID"
        // LLP 0110: malformed bounded-child declarations/cursors and direct
        // writes to the protected incarnation marker are author/client input.
        | "SNAPBACK_BOUNDED_CHILDREN_PLAN_INVALID"
        | "SNAPBACK_BOUNDED_CHILDREN_INDEX_INVALID"
        | "SNAPBACK_BOUNDED_CHILDREN_PROJECTION_INVALID"
        | "SNAPBACK_BOUNDED_CHILDREN_RESULT_CONTRACT_INVALID"
        | "SNAPBACK_BOUNDED_CHILDREN_CURSOR_INVALID"
        | "SNAPBACK_BOUNDED_CHILDREN_LIVE_CURSOR_UNSUPPORTED"
        | "SNAPBACK_SNAPSHOT_BATCH_CURSOR_INVALID"
        | "SNAPBACK_SNAPSHOT_BATCH_LIVE_CURSOR_UNSUPPORTED"
        | "SNAPBACK_ACTIVITY_CLIENT_MUTATION_REQUIRED"
        | "SNAPBACK_RELATION_SCHEMA_INVALID"
        | "SNAPBACK_RELATION_FOREIGN_KEY_INVALID"
        | "SNAPBACK_RELATION_INCARNATION_WRITE_PROTECTED"
        // LLP 0065 §1: a HostPlan whose observed operations exceed its
        // admitted EffectCeilingV1 is a doctored/under-declared artifact.
        | "SNAPBACK_FUNCTION_EFFECT_CEILING_EXCEEDED"
        | "SNAPBACK_FUNCTION_CONTRACT_HASH_INVALID"
        | "SNAPBACK_FUNCTION_HANDLER_FORM_INVALID"
        | "SNAPBACK_RESULT_CONTRACT_KIND_MISMATCH"
        | "SNAPBACK_HANDLER_RESULT_CONTRACT_INVALID"
        // @ref LLP 0224#layered-readiness-not-one-overloaded-boolean — these four validate the caller's own
        // app.readiness.v1 request body, so they are caller input, not a
        // server fault. They ride the HTTP-200 host-operation envelope today;
        // this is the classification if one ever reaches ApiError.
        // FACTS_UNAVAILABLE stays 500: it is a server-held-state failure.
        | "SNAPBACK_APP_READINESS_DECLARATION_INVALID"
        | "SNAPBACK_APP_READINESS_MIGRATION_UNRESOLVED"
        | "SNAPBACK_APP_READINESS_OBLIGATIONS_DIGEST_MISMATCH"
        | "SNAPBACK_APP_READINESS_SEED_NOT_IDEMPOTENT"
        | "SNAPBACK_HANDLER_RESULT_CONTRACT_VIOLATION"
        // @ref LLP 0131#runtime-ingress-validation — a malformed argument
        // descriptor is author input, and an args-contract violation is a
        // client payload outside the declared contract; both are 4xx.
        | "SNAPBACK_FUNCTION_ARGS_CONTRACT_INVALID"
        | "SNAPBACK_FUNCTION_ARGS_CONTRACT_VIOLATION"
        // @ref LLP 0211#representation-and-write-path — malformed structured
        //   carriers/declarations are author input, while a value-shape
        //   refusal is caller input outside the declared stored contract.
        | "SNAPBACK_SCHEMA_STRUCTURED_INDEX_UNSUPPORTED"
        | "SNAPBACK_STRUCTURED_CONTRACT_HASH_INVALID"
        | "SNAPBACK_STRUCTURED_CONTRACT_INVALID"
        | "SNAPBACK_STRUCTURED_VALUE_INVALID"
        | "SNAPBACK_SEARCH_CURSOR_RESTART"
        | "SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID"
        | "SNAPBACK_SEARCH_MAINTENANCE_LIMIT"
        | "SNAPBACK_SEARCH_QUERY_INVALID"
        | "SNAPBACK_SEARCH_QUERY_PLAN_INVALID"
        | "SNAPBACK_SEARCH_SOURCE_LIMIT"
        | "SNAPBACK_SEARCH_WORK_LIMIT"
        | "SNAPBACK_WRITE_WITH_ACTIVITY_PLAN_INVALID"
        // LLP 0081 §2/§3: malformed/tampered plan artifacts and the
        // deferred retained-work posture are author input.
        | "SNAPBACK_MIGRATION_PLAN_INVALID"
        | "SNAPBACK_MIGRATION_PROFILE_UNSUPPORTED"
        | "SNAPBACK_MIGRATION_TARGET_MISMATCH"
        // LLP 0080 §5: maintained-projection artifact and mutation
        // refusals — malformed plans, unprovable write budgets, output
        // fences, and maintenance invariants (null/moved output keys).
        // (The privileged scan's plan refusals share the LLP 0081 §2/§3
        // SNAPBACK_MIGRATION_PLAN_INVALID arm above.)
        | "SNAPBACK_MIGRATION_REHEARSAL_INVALID"
        | "SNAPBACK_PROJECTION_PLAN_INVALID"
        | "SNAPBACK_RELATIONAL_DISCLOSURE_REQUIRED"
        | "SNAPBACK_PROJECTION_WRITE_BUDGET_EXCEEDED"
        | "SNAPBACK_PROJECTION_OUTPUT_WRITE_DENIED"
        | "SNAPBACK_PROJECTION_OUTPUT_READ_UNENFORCED"
        | "SNAPBACK_PROJECTION_MAINTENANCE_INVALID"
        | "SNAPBACK_QUERY_FILTER_UNSUPPORTED_FIELD_TYPE"
        | "SNAPBACK_QUERY_FILTER_BINDINGS_EXCEEDED"
        | "SNAPBACK_QUERY_FILTER_VALUE_INVALID"
        | "SNAPBACK_QUERY_IN_ITEMS_EXCEEDED"
        | "SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED"
        | "SNAPBACK_QUERY_LIMIT_INVALID"
        | "SNAPBACK_BATCH_READ_INPUT_INVALID"
        | "SNAPBACK_BATCH_READ_INDEX_INVALID"
        | "SNAPBACK_BATCH_READ_KEY_INVALID"
        | "SNAPBACK_QUERY_ORDER_UNSUPPORTED_FIELD_TYPE"
        | "SNAPBACK_QUERY_UNKNOWN_INDEX"
        | "SNAPBACK_SINGLE_TABLE_PLAN_INVALID"
        | "SNAPBACK_SINGLE_TABLE_EXAMINED_ENTRY_CEILING_EXCEEDED"
        | "SNAPBACK_RELATIONAL_CARDINALITY_UNPROVEN"
        // LLP 0080 §2: one uniform cursor refusal for all six classes —
        // malformed, cross-plan, cross-argument-set, cross-authority,
        // stale-authority, order-schema-invalid — never repositioned.
        | "SNAPBACK_RELATIONAL_CURSOR_INVALID"
        // LLP 0065: the standard-pattern keyset cursor's collapsed refusal —
        // malformed, cross-plan, and cross-owner are byte-indistinguishable.
        | "SNAPBACK_STANDARD_PATTERN_CURSOR_INVALID"
        // LLP 0100 §4/§5: an incoherent membership-keyset standard-pattern
        // declaration is a load-time authoring defect — client-fixable.
        | "SNAPBACK_STANDARD_PATTERN_MEMBERSHIP_INVALID"
        | "SNAPBACK_REQUEST_JSON_INVALID"
        | "SNAPBACK_SEED_DECLARATION_INVALID"
        | "SNAPBACK_SEED_INVALID"
        // LLP 0109 §17: authored-artifact defects — misplaced or undeclared
        // placeholders, a placeholder with no attached fixtures artifact,
        // and a fixture-bytes digest lie are all client-fixable 400s.
        | "SNAPBACK_SEED_ASSET_FIXTURE_PLACEMENT_INVALID"
        | "SNAPBACK_SEED_ASSET_FIXTURE_UNKNOWN"
        | "SNAPBACK_SEED_ASSET_FIXTURE_UNRESOLVED"
        | "SNAPBACK_ASSET_SEED_FIXTURE_DIGEST_MISMATCH"
        | "SNAPBACK_SCHEMA_DUPLICATE_FIELD"
        | "SNAPBACK_SCHEMA_DUPLICATE_INDEX"
        | "SNAPBACK_SCHEMA_DUPLICATE_TABLE"
        | "SNAPBACK_SCHEMA_EMPTY_INDEX"
        | "SNAPBACK_SCHEMA_ENUM_DOMAIN_BACKFILL_REQUIRED"
        | "SNAPBACK_SCHEMA_ENUM_DOMAIN_INVALID"
        | "SNAPBACK_SCHEMA_FIELD_RETYPED"
        | "SNAPBACK_SCHEMA_INDEX_NAME_COLLISION"
        | "SNAPBACK_SCHEMA_INDEX_WHERE_APPLICABLE_MISMATCH"
        | "SNAPBACK_SCHEMA_PERMISSION_FIELDS_WITHOUT_BACKING"
        | "SNAPBACK_SCHEMA_PERMISSION_FIELD_DUPLICATE"
        | "SNAPBACK_SCHEMA_PERMISSION_FIELD_UNKNOWN"
        | "SNAPBACK_SCHEMA_PARSE_FAILED"
        | "SNAPBACK_SCHEMA_SYSTEM_FIELD"
        | "SNAPBACK_SCHEMA_UNIQUE_INDEX_OPTIONAL_FIELD"
        | "SNAPBACK_STALE_FUNCTION_ARTIFACT_KIND"
        | "SNAPBACK_STALE_FUNCTION_ARTIFACT_VERSION"
        | "SNAPBACK_STALE_SCHEMA_ARTIFACT_KIND"
        | "SNAPBACK_STALE_SCHEMA_ARTIFACT_VERSION"
        | "SNAPBACK_SYSTEM_FIELD_WRITE"
        | "SNAPBACK_TIMESTAMP_OUT_OF_RANGE"
        | "SNAPBACK_UNSUPPORTED_BLOB"
        | "SNAPBACK_VALUE_EXPR_AUTHORITATIVE_ONLY"
        | "SNAPBACK_V8_COMPAT_CONFIG_INVALID"
        | "SNAPBACK_V8_COMPAT_FLAG_REFUSED"
        | "SNAPBACK_WEBSOCKET_MESSAGE_INVALID"
        | "SNAPBACK_WEBSOCKET_SENDER_MISMATCH" => StatusCode::BAD_REQUEST,
        "SNAPBACK_ADMIN_RELAY_BODY_REFUSED"
        | "SNAPBACK_ADMIN_RELAY_CONNECT_REFUSED"
        | "SNAPBACK_ADMIN_RELAY_FORWARDING_HEADER_REFUSED"
        | "SNAPBACK_ADMIN_RELAY_FRAMING_REFUSED"
        | "SNAPBACK_ADMIN_RELAY_PATH_REFUSED"
        | "SNAPBACK_ADMIN_RELAY_TARGET_FORM_REFUSED"
        | "SNAPBACK_ADMIN_REACHABILITY_ORIGIN_INVALID" => StatusCode::BAD_REQUEST,
        "SNAPBACK_ADMIN_CONSOLE_MINT_UNAVAILABLE"
        | "SNAPBACK_ADMIN_CONSOLE_RENEWAL_UNAVAILABLE"
        | "SNAPBACK_ADMIN_APPROVAL_UNAVAILABLE"
        | "SNAPBACK_ADMIN_CLAIM_UNAVAILABLE"
        | "SNAPBACK_ADMIN_RELAY_MASTER_CREDENTIAL_REFUSED"
        | "SNAPBACK_ADMIN_RELAY_MASTER_ROUTE_REFUSED"
        | "SNAPBACK_ADMIN_RELAY_ORIGIN_REFUSED"
        | "SNAPBACK_ADMIN_RELAY_ROUTE_REFUSED" => StatusCode::FORBIDDEN,
        "SNAPBACK_ADMIN_CLAIM_STATUS_INVALID"
        | "SNAPBACK_ADMIN_RELAY_LEASE_INVALID"
        | "SNAPBACK_ADMIN_REACHABILITY_SESSION_INVALID" => StatusCode::NOT_FOUND,
        "SNAPBACK_ADMIN_RELAY_HOST_REFUSED" => StatusCode::MISDIRECTED_REQUEST,
        "SNAPBACK_ADMIN_RELAY_WEBSOCKET_UNAVAILABLE" => StatusCode::NOT_IMPLEMENTED,
        // @ref LLP 0222#semantics-pinned — realtime.hasFreshClient requires
        // a session-auth application; absence is permanent for that app, so
        // this is 501 rather than a retryable 503.
        "SNAPBACK_CONNECTED_CLIENT_PREDICATE_UNAVAILABLE" => StatusCode::NOT_IMPLEMENTED,
        "SNAPBACK_ADMIN_RELAY_UPSTREAM_FAILED" | "SNAPBACK_ADMIN_RELAY_UPSTREAM_INVALID" => {
            StatusCode::BAD_GATEWAY
        }
        "SNAPBACK_ADMIN_RELAY_LEASE_CLAIM_MISMATCH"
        | "SNAPBACK_ADMIN_RELAY_LEASE_CREDENTIAL_MISMATCH" => StatusCode::CONFLICT,
        "SNAPBACK_AUTH_SENDER_PROOF_REQUIRED"
        | "SNAPBACK_AUTH_SENDER_PROOF_INVALID"
        | "SNAPBACK_AUTH_SENDER_PROOF_REPLAYED" => StatusCode::UNAUTHORIZED,
        // @ref LLP 0162#acceptance — the Track B public carriers keep
        // malformed caller facts, authorization failures, durable conflicts,
        // bounded admission, transient custody, and server invariants in
        // distinct HTTP classes. This block covers the acceptance-tail codes
        // added after the original extracted-Spec registry was written.
        "SNAPBACK_BRANCH_NESTING_UNSUPPORTED"
        | "SNAPBACK_BRANCH_OPERATION_KIND_UNSUPPORTED"
        | "SNAPBACK_BRANCH_REQUEST_ID_REQUIRED"
        | "SNAPBACK_BRANCH_REQUEST_INVALID"
        | "SNAPBACK_CHECKPOINT_ERASURE_REQUEST_INVALID"
        | "SNAPBACK_EPHEMERAL_CLEANUP_BOUND_INVALID"
        | "SNAPBACK_EPHEMERAL_CLEANUP_CUTOFF_INVALID"
        | "SNAPBACK_EPHEMERAL_CLEANUP_REQUEST_INVALID"
        | "SNAPBACK_OPERATION_COVERAGE_ACTIVATION_VERSION_UNSUPPORTED"
        | "SNAPBACK_OPERATION_EXPLANATION_AUDIENCE_REQUIRED"
        | "SNAPBACK_OPERATION_EXPLANATION_VERSION_UNSUPPORTED"
        | "SNAPBACK_OPERATION_IDENTITY_RANGE_VERSION_UNSUPPORTED"
        | "SNAPBACK_OPERATION_IDENTITY_REQUIRED"
        | "SNAPBACK_OPERATION_RANGE_AUDIENCE_INVALID"
        | "SNAPBACK_PROMOTION_PROVISIONAL_REPRESENTATION_REQUIRED"
        | "SNAPBACK_PROTECTED_ERASURE_REQUEST_INVALID" => StatusCode::BAD_REQUEST,
        "SNAPBACK_OPERATION_COVERAGE_ACTIVATION_AUTHORITY_INVALID"
        | "SNAPBACK_PROTECTED_ERASURE_AUTHORITY_INVALID" => StatusCode::FORBIDDEN,
        "SNAPBACK_PROTECTED_ERASURE_TARGET_NOT_FOUND" => StatusCode::NOT_FOUND,
        "SNAPBACK_BRANCH_ARTIFACT_DRIFT"
        | "SNAPBACK_BRANCH_CUSTODY_COLLISION"
        | "SNAPBACK_BRANCH_FORECLOSED"
        | "SNAPBACK_BRANCH_OPERATION_ID_REUSED"
        | "SNAPBACK_BRANCH_OPERATION_OUTCOME_UNKNOWN"
        | "SNAPBACK_CHECKPOINT_ERASURE_IDENTITY_REUSED"
        | "SNAPBACK_CHECKPOINT_PROTECTED_ERASURE_FENCED"
        | "SNAPBACK_HISTORY_POLICY_VERSION_CONFLICT"
        | "SNAPBACK_OPERATION_RANGE_CONTINUITY_INVALID"
        | "SNAPBACK_OPERATION_RANGE_COUNTER_REUSED"
        | "SNAPBACK_OPERATION_TERMINAL_DIVERGED"
        | "SNAPBACK_PROMOTION_CAPTURE_ONLY_UNSUPPORTED"
        | "SNAPBACK_PROMOTION_RESERVATION_EXPIRED"
        | "SNAPBACK_PROTECTED_ERASURE_BUSY"
        | "SNAPBACK_PROTECTED_ERASURE_IDENTITY_REUSED" => StatusCode::CONFLICT,
        "SNAPBACK_BRANCH_DIGEST_WORK_LIMIT_EXCEEDED" => StatusCode::PAYLOAD_TOO_LARGE,
        "SNAPBACK_OPERATION_PENDING_CAPACITY_FULL" | "SNAPBACK_PROMOTION_HEAD_RESERVED" => {
            StatusCode::TOO_MANY_REQUESTS
        }
        "SNAPBACK_BRANCH_CUSTODY_RECOVERY_REQUIRED"
        | "SNAPBACK_BRANCH_EXPIRY_REAP_REQUIRED"
        | "SNAPBACK_HOST_OPERATION_ORDINAL_EXHAUSTED"
        | "SNAPBACK_OPERATION_PROTECTED_CUSTODY_UNAVAILABLE" => {
            StatusCode::SERVICE_UNAVAILABLE
        }
        "SNAPBACK_BENCH_RANGE_EXHAUSTED"
        | "SNAPBACK_BENCH_STREAM_DIVERGED"
        | "SNAPBACK_BRANCH_ACTION_SETTLEMENT_MISSING"
        | "SNAPBACK_BRANCH_ARTIFACT_IDENTITY_MISSING"
        | "SNAPBACK_BRANCH_CAUSAL_ORDER_INVALID"
        | "SNAPBACK_BRANCH_CUSTODY_FAILED"
        | "SNAPBACK_BRANCH_CUSTODY_INVALID"
        | "SNAPBACK_BRANCH_CUSTODY_PATH_MISMATCH"
        | "SNAPBACK_BRANCH_DIFF_JOURNAL_INCOMPLETE"
        | "SNAPBACK_BRANCH_DIGEST_WORK_UNACCOUNTED"
        | "SNAPBACK_BRANCH_EFFECT_CAPTURED"
        | "SNAPBACK_BRANCH_EFFECT_CAPTURE_FAILED"
        | "SNAPBACK_BRANCH_EFFECT_CONTEXT_MISSING"
        | "SNAPBACK_BRANCH_EFFECT_LEDGER_INVALID"
        | "SNAPBACK_BRANCH_EFFECT_ORDINAL_REUSED"
        | "SNAPBACK_BRANCH_EFFECT_POLICY_INVALID"
        | "SNAPBACK_BRANCH_EGRESS_MARKER_FAILED"
        | "SNAPBACK_BRANCH_FILE_CUSTODY_REQUIRED"
        | "SNAPBACK_BRANCH_HANDLER_FAILED"
        | "SNAPBACK_BRANCH_OPERATION_JOURNAL_INCOMPLETE"
        | "SNAPBACK_BRANCH_OPERATION_RESERVATION_MISSING"
        | "SNAPBACK_CHECKPOINT_ERASURE_REGISTRY_CORRUPT"
        | "SNAPBACK_CHECKPOINT_ERASURE_TEST_CRASH_CUT"
        | "SNAPBACK_MIGRATION_EXPECTED_ORACLE_FAILED"
        | "SNAPBACK_OPERATION_COVERAGE_INCOMPLETE"
        | "SNAPBACK_OPERATION_PENDING_NOT_FOUND"
        | "SNAPBACK_OPERATION_PROTECTED_CUSTODY_INVALID"
        | "SNAPBACK_OPERATION_RECEIPT_INVALID"
        | "SNAPBACK_OPERATION_WRITER_EXCLUDED"
        | "SNAPBACK_OPERATION_WRITER_IDENTITY_MISMATCH"
        | "SNAPBACK_OPERATION_WRITE_AUTHORITY_INVALID"
        | "SNAPBACK_PROMOTION_EFFECT_INTENT_MISSING"
        | "SNAPBACK_PROTECTED_ERASURE_REGISTRY_CORRUPT"
        | "SNAPBACK_PROTECTED_ERASURE_TEST_CRASH_CUT"
        | "SNAPBACK_STORAGE_FIELD_CORRUPT"
        | "SNAPBACK_STORAGE_ROW_ID_CORRUPT"
        // @ref LLP 0211#representation-and-write-path — every legitimate
        //   structured writer supplies table/field context; absence is an
        //   internal writer-integration defect, never caller input.
        | "SNAPBACK_STRUCTURED_WRITE_CONTEXT_MISSING"
        | "SNAPBACK_TEST_OPERATION_CRASH_CUT" => StatusCode::INTERNAL_SERVER_ERROR,
        // @ref LLP 0158#implementation-path-local-v1-explored-2026-08-03 —
        // derived-fork request shape, lifecycle, custody, and subprocess
        // outcomes retain distinct caller/state/server HTTP classes.
        // @ref LLP 0163#contract-summary-normative-details-per-llp-0162-0-2 —
        // issuance, range, and coverage diagnostics distinguish malformed or
        // unauthorized identities from durable conflicts and server invariants.
        // @ref LLP 0164#contract-summary-normative-details-per-llp-0162-3-5 —
        // branch/promotion CAS, expiry, contention, and proof failures are
        // deliberately projected rather than left at the fail-safe default.
        // @ref LLP 0165#contract-summary-normative-details-per-llp-0162-4-6 —
        // checkpoint byte/WAL bounds and proof/publication failures follow the
        // same reviewed resource-versus-invariant split.
        "SNAPBACK_BRANCH_CAPTURE_ONLY_MISSING"
        | "SNAPBACK_BRANCH_LIMIT_INVALID"
        | "SNAPBACK_BRANCH_OPERATION_INVALID"
        | "SNAPBACK_BRANCH_SCHEMA_VERSION_UNSUPPORTED"
        | "SNAPBACK_BRANCH_STREAM_MISMATCH"
        | "SNAPBACK_CHECKPOINT_DESTINATION_INVALID"
        | "SNAPBACK_CHECKPOINT_REQUEST_INVALID"
        | "SNAPBACK_FORK_APP_BINDING_REQUIRED"
        | "SNAPBACK_FORK_APP_ID_REQUIRED"
        | "SNAPBACK_FORK_ASSET_CUT_UNSUPPORTED"
        | "SNAPBACK_FORK_APP_ROOT_INVALID"
        | "SNAPBACK_FORK_ID_INVALID"
        | "SNAPBACK_FORK_NET_DIFF_UNAVAILABLE"
        | "SNAPBACK_FORK_PROJECTION_UNAVAILABLE"
        | "SNAPBACK_FORK_REAP_CLOCK_INVALID"
        | "SNAPBACK_FORK_RENEW_EXPIRED"
        | "SNAPBACK_FORK_SOURCE_INVALID"
        | "SNAPBACK_FORK_TTL_INVALID"
        | "SNAPBACK_HISTORY_PAGE_INVALID"
        | "SNAPBACK_HISTORY_POLICY_INVALID"
        | "SNAPBACK_HOST_OPERATION_IDENTITY_INVALID"
        | "SNAPBACK_OPERATION_EXPLANATION_LIMIT_INVALID"
        | "SNAPBACK_OPERATION_EXPLANATION_QUERY_UNBOUNDED"
        | "SNAPBACK_PROMOTION_CONTENTION_POLICY_INVALID"
        | "SNAPBACK_PROMOTION_TICKET_IDENTITY_INVALID"
        | "SNAPBACK_PROMOTION_TICKET_TTL_INSUFFICIENT" => StatusCode::BAD_REQUEST,
        "SNAPBACK_BRANCH_AUTHORITY_DENIED"
        | "SNAPBACK_BRANCH_EGRESS_DENIED"
        | "SNAPBACK_FORK_APP_BINDING_MISMATCH"
        | "SNAPBACK_HISTORY_AUTHORIZATION_DENIED"
        | "SNAPBACK_OPERATION_ISSUANCE_AUTH_INVALID"
        | "SNAPBACK_OPERATION_RANGE_AUTH_INVALID"
        | "SNAPBACK_PROMOTION_APPROVAL_INVALID"
        | "SNAPBACK_PROMOTION_AUTHORITY_DENIED"
        | "SNAPBACK_PROMOTION_REQUEST_SEAL_INVALID"
        | "SNAPBACK_PROMOTION_TICKET_MISMATCH" => StatusCode::FORBIDDEN,
        "SNAPBACK_BRANCH_NOT_FOUND"
        | "SNAPBACK_CHECKPOINT_NOT_FOUND"
        | "SNAPBACK_FORK_NOT_FOUND"
        | "SNAPBACK_HISTORY_TABLE_UNKNOWN" => StatusCode::NOT_FOUND,
        "SNAPBACK_BRANCH_BASE_NOT_CURRENT"
        | "SNAPBACK_BRANCH_NOT_ACTIVE"
        | "SNAPBACK_BRANCH_NOT_PROMOTABLE"
        | "SNAPBACK_BRANCH_NO_COMMON_BASE"
        | "SNAPBACK_CHECKPOINT_DESTINATION_EXISTS"
        | "SNAPBACK_CHECKPOINT_SOURCE_ADVANCED"
        | "SNAPBACK_HISTORY_NOT_ENABLED"
        | "SNAPBACK_HOST_INCARNATION_ROTATION_INVALID"
        | "SNAPBACK_HOST_OPERATION_IDENTITY_REUSED"
        | "SNAPBACK_HOST_OPERATION_LEASE_INVALID"
        | "SNAPBACK_OPERATION_ALREADY_RECORDED"
        | "SNAPBACK_OPERATION_EPOCH_STATE_INVALID"
        | "SNAPBACK_OPERATION_EPOCH_UNAVAILABLE"
        | "SNAPBACK_OPERATION_RANGE_OVERLAP"
        | "SNAPBACK_PROMOTION_APPROVED_FACTS_CONFLICT"
        | "SNAPBACK_PROMOTION_BASE_ADVANCED"
        | "SNAPBACK_PROMOTION_BASE_PRECONDITION_FAILED"
        | "SNAPBACK_PROMOTION_DIFF_FACTS_MISMATCH"
        | "SNAPBACK_PROMOTION_DIFF_STALE"
        | "SNAPBACK_PROMOTION_HEAD_CHANGED"
        | "SNAPBACK_PROMOTION_IDENTITY_REUSED"
        | "SNAPBACK_PROMOTION_NOT_FIFO_HEAD"
        | "SNAPBACK_PROMOTION_REBASE_DIVERGED"
        | "SNAPBACK_PROMOTION_REBASE_LOG_EMPTY"
        | "SNAPBACK_PROMOTION_REPLAY_DIVERGED"
        | "SNAPBACK_PROMOTION_REQUEST_FACTS_DIVERGED"
        | "SNAPBACK_PROMOTION_RESERVATION_NOT_ELIGIBLE"
        | "SNAPBACK_PROMOTION_SCHEMA_DIVERGED"
        | "SNAPBACK_PROMOTION_TICKET_IDENTITY_REUSED"
        | "SNAPBACK_PROMOTION_WRITE_COVERAGE_INCOMPLETE"
        | "SNAPBACK_PROMOTION_WRITE_PATH_UNCOVERED" => StatusCode::CONFLICT,
        "SNAPBACK_BRANCH_EXPIRED"
        | "SNAPBACK_BRANCH_GRANT_STALE"
        | "SNAPBACK_CHECKPOINT_INVALID"
        | "SNAPBACK_FORK_DIFF_RETENTION_GAP"
        | "SNAPBACK_FORK_SERVER_EXPIRED"
        | "SNAPBACK_OPERATION_EPOCH_CLOSED"
        | "SNAPBACK_PROMOTION_TICKET_EXPIRED" => StatusCode::GONE,
        "SNAPBACK_BRANCH_BYTE_LIMIT_EXCEEDED"
        | "SNAPBACK_BRANCH_DIFF_LIMIT_EXCEEDED"
        | "SNAPBACK_CHECKPOINT_COPY_BUDGET_EXCEEDED"
        | "SNAPBACK_CHECKPOINT_DIGEST_BUDGET_EXCEEDED"
        | "SNAPBACK_PROOF_BUDGET_EXCEEDED" => StatusCode::PAYLOAD_TOO_LARGE,
        "SNAPBACK_BRANCH_LIVE_LIMIT_EXCEEDED"
        | "SNAPBACK_BRANCH_OPERATION_LIMIT_EXCEEDED"
        | "SNAPBACK_CHECKPOINT_WAL_BUDGET_EXCEEDED"
        | "SNAPBACK_FORK_RESOURCE_LIMIT_REFUSED"
        | "SNAPBACK_OPERATION_RANGE_EXHAUSTED"
        | "SNAPBACK_PROMOTION_CONTENTION_EXHAUSTED" => StatusCode::TOO_MANY_REQUESTS,
        "SNAPBACK_FORK_ADMISSION_TIMEOUT"
        | "SNAPBACK_FORK_BOOT_TIMEOUT"
        | "SNAPBACK_FORK_STOP_TIMEOUT"
        | "SNAPBACK_PROMOTION_COMMIT_TIMEOUT" => StatusCode::GATEWAY_TIMEOUT,
        "SNAPBACK_CHECKPOINT_SOURCE_UNSUPPORTED"
        | "SNAPBACK_OPERATION_COVERAGE_UNAVAILABLE"
        | "SNAPBACK_OPERATION_STREAM_UNAVAILABLE" => StatusCode::SERVICE_UNAVAILABLE,
        "SNAPBACK_BRANCH_ARTIFACT_INVALID"
        | "SNAPBACK_BRANCH_DIFF_DUPLICATE_ROW"
        | "SNAPBACK_BRANCH_PROFILE_MISSING"
        | "SNAPBACK_BRANCH_STREAM_MISSING"
        | "SNAPBACK_CHECKPOINT_COPY_FAILED"
        | "SNAPBACK_CHECKPOINT_COPY_FIDELITY_FAILED"
        | "SNAPBACK_CHECKPOINT_EVIDENCE_MISMATCH"
        | "SNAPBACK_CHECKPOINT_INCOMPLETE"
        | "SNAPBACK_CHECKPOINT_IO_FAILED"
        | "SNAPBACK_CHECKPOINT_RECEIPT_INVALID"
        | "SNAPBACK_CHECKPOINT_REGISTRY_CORRUPT"
        | "SNAPBACK_CHECKPOINT_SCAN_CORRUPT"
        | "SNAPBACK_CHECKPOINT_SCHEMA_IDENTITY_MISSING"
        | "SNAPBACK_CHECKPOINT_SOURCE_INVALID"
        | "SNAPBACK_CHECKPOINT_STREAM_MISSING"
        | "SNAPBACK_CHECKPOINT_TEST_CRASH_CUT"
        | "SNAPBACK_FORK_BOOT_FAILED"
        | "SNAPBACK_FORK_DIFF_INVALID"
        | "SNAPBACK_FORK_LOAD_FAILED"
        | "SNAPBACK_FORK_READY_INVALID"
        | "SNAPBACK_FORK_REGISTRY_INVALID"
        | "SNAPBACK_FORK_REGISTRY_STALE"
        | "SNAPBACK_FORK_PUBLICATION_PARTIAL"
        | "SNAPBACK_FORK_EXPIRED_REAP_FAILED"
        | "SNAPBACK_FORK_SIDECAR_MALFORMED"
        | "SNAPBACK_FORK_SIDECAR_MISSING"
        | "SNAPBACK_FORK_STOP_FAILED"
        | "SNAPBACK_FORK_STOP_UNVERIFIED"
        | "SNAPBACK_HISTORY_CORRUPT"
        | "SNAPBACK_OPERATION_COVERAGE_MISMATCH"
        | "SNAPBACK_OPERATION_JOURNAL_INCOMPLETE"
        | "SNAPBACK_OPERATION_LEDGER_INVALID"
        | "SNAPBACK_PROMOTION_APPROVED_FACTS_INVALID"
        | "SNAPBACK_PROMOTION_BASE_DUPLICATE_ROW"
        | "SNAPBACK_PROMOTION_BOUNDARY_MISMATCH"
        | "SNAPBACK_PROMOTION_ENVELOPE_INVALID"
        | "SNAPBACK_PROMOTION_SCHEMA_IDENTITY_MISSING"
        | "SNAPBACK_PROMOTION_SEAL_KEY_INVALID"
        | "SNAPBACK_PROMOTION_WRITES_NOT_CANONICAL"
        | "SNAPBACK_PROOF_CANONICAL_VALUE_REFUSED"
        | "SNAPBACK_PROOF_DOMAIN_MISMATCH"
        | "SNAPBACK_PROOF_EXPECTED_DERIVATION_MISSING"
        | "SNAPBACK_PROOF_ROWS_NOT_CANONICAL" => StatusCode::INTERNAL_SERVER_ERROR,
        _ => auth_budget_status(code).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

fn auth_budget_status(code: &str) -> Option<StatusCode> {
    match code {
        "SNAPBACK_AUTH_RATE_BUDGET" | "SNAPBACK_AUTH_QUOTA_BUDGET" => {
            Some(StatusCode::TOO_MANY_REQUESTS)
        }
        "SNAPBACK_AUTH_IDEMPOTENCY_CONFLICT" => Some(StatusCode::CONFLICT),
        "SNAPBACK_AUTH_BUDGET_AUTHORITY_UNAVAILABLE" => Some(StatusCode::SERVICE_UNAVAILABLE),
        "SNAPBACK_AUTH_BUDGET_POLICY_INVALID" => Some(StatusCode::INTERNAL_SERVER_ERROR),
        _ => None,
    }
}

impl ApiError {
    pub(super) fn auth_budget_throttled(
        decision: crate::auth::throttle::AuthenticationThrottleDecision,
    ) -> Self {
        let retry_after_seconds = decision.retry_after_ms.div_ceil(1_000).max(1);
        let refusal = decision.refusal.unwrap_or_else(|| {
            crate::auth::throttle::AuthBudgetRefusal::rate_duration(
                decision.budget_name,
                decision.retry_after_ms,
            )
        });
        Self::api_throttled(
            refusal.legacy_error(
                "SNAPBACK_AUTH_THROTTLED",
                "auth",
                "authentication request rate limit exceeded",
            ),
            retry_after_seconds,
        )
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = status_for_diagnostic_code(self.0.diagnostic.code.as_str());
        let telemetry_code = TelemetryDiagnosticCode(self.0.diagnostic.code.clone());
        let retry_after_seconds = self.2.or_else(|| {
            self.0
                .diagnostic
                .details
                .get("retryAfter")
                .filter(|retry| retry.get("kind").and_then(Value::as_str) == Some("duration"))
                .and_then(|retry| retry.get("milliseconds"))
                .and_then(Value::as_u64)
                .map(|milliseconds| milliseconds.div_ceil(1_000).max(1))
        });
        let mut response = (
            status,
            Json(ErrorResponse {
                format_version: ErrorResponseFormatVersion::V1,
                diagnostic: self.0.diagnostic,
                receipt: self.1,
                attribution: self.3,
                ephemeral_authority_instance: self.4,
                timing: self.5,
            }),
        )
            .into_response();
        if let Some(seconds) = retry_after_seconds
            && let Ok(value) = HeaderValue::from_str(&seconds.to_string())
        {
            response.headers_mut().insert(header::RETRY_AFTER, value);
        }
        response.extensions_mut().insert(telemetry_code);
        response
    }
}
