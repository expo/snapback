use super::core::*;
use snapback_types::runtime::*;
use crate::auth::admission::{AdmissionLease, CancellationRegistration};
#[cfg(test)]
use crate::auth::invocation::ResolvedAppAuthority;
use crate::auth::invocation::{HandlerAuthProjection, PreparedInvocation};
use crate::config::SecretRedactor;
use crate::cron::CronRunMetadata;
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::error_tracking::{
    AppRefusalTrackingV1, FailureCarrierV1, PrivateFailureContextV1, UNCLASSIFIED_ERROR_CLASS,
    extract_failure_carrier, validated_error_class,
};
use crate::live_matcher::{
    compare_sort_keys, query_dependencies_from_plan, row_matches_query_filters, sort_key,
};
use crate::manifest::{
    BATCH_READ_MAX_INPUT_BYTES, BATCH_READ_MAX_ITEMS, BATCH_READ_MAX_POLICY_PROBES_PER_ITEM,
    BATCH_READ_MAX_RESPONSE_BYTES, CtxAnswerLedger, FilterExpr, FilterOp, FunctionKind,
    FunctionResultContract, HandlerInput, IbexModule, MutationOutput, QUERY_INTERNAL_OVERFETCH_MAX,
    QUERY_MAX_BUFFERED_WRITES, QueryOutput, QueryPlan, ResultValueContract, SequenceDeclaration,
    SequenceScopeAccess, TableVisibilityArmV1, TableVisibilityV1, ValueExpr, effective_query_limit,
};
use crate::storage::{
    BufferedMembershipCommand, BufferedWrite, CapturedReadDependency, CapturedReadKind, DbRead,
    GenericTableWriteFormV1, LocalDatabase, MembershipWriter, MutationCommit,
    SEQUENCE_MAX_SAFE_INTEGER, SequenceAllocationFact, generic_owner_write_field,
    validate_sequence_allocation_fact,
};
use crate::warm_vm::WarmVmPool;
use libc::{c_char, c_void};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use sha2::{Digest as _, Sha256};
use std::cell::{Cell, RefCell};
use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::env;
use std::ffi::CStr;
use std::ptr;
#[cfg(debug_assertions)]
use std::sync::mpsc;
use std::sync::{Mutex as StdMutex, OnceLock};
use std::time::Instant;

#[derive(Clone)]
struct RuntimeLogSink {
    telemetry: crate::telemetry::Telemetry,
    correlation: Option<String>,
    redactor: SecretRedactor,
}

thread_local! {
    static RUNTIME_LOG_SINKS: RefCell<Vec<RuntimeLogSink>> = const { RefCell::new(Vec::new()) };
    #[cfg(test)]
    static TEST_HANDLER_CONSOLE_STDERR: RefCell<Vec<Vec<String>>> = const { RefCell::new(Vec::new()) };
}

struct RuntimeLogSinkGuard;

impl Drop for RuntimeLogSinkGuard {
    fn drop(&mut self) {
        RUNTIME_LOG_SINKS.with(|sinks| {
            sinks.borrow_mut().pop();
        });
    }
}

/// Install the observation sink for one synchronous handler dispatch. A stack
/// preserves the outer action context while nested runtime calls execute.
pub(crate) fn with_runtime_log_telemetry<T>(
    telemetry: crate::telemetry::Telemetry,
    correlation: Option<String>,
    run: impl FnOnce() -> T,
) -> T {
    let redactor = RUNTIME_LOG_SINKS.with(|sinks| {
        sinks
            .borrow()
            .last()
            .map(|sink| sink.redactor.clone())
            .unwrap_or_default()
    });
    with_runtime_log_telemetry_redactor(telemetry, correlation, redactor, run)
}

/// Install the action's staging-time redactor alongside its observation sink.
/// The same immutable snapshot therefore scrubs errors, authored logs, and
/// trace arguments even if configuration rotates while a detached action runs.
///
/// @ref LLP 0036#runtime-exposure-d5-d8 — invocation-lifetime secret
/// redaction applies before diagnostic data reaches any retention or echo sink.
pub(crate) fn with_runtime_log_telemetry_redactor<T>(
    telemetry: crate::telemetry::Telemetry,
    correlation: Option<String>,
    redactor: SecretRedactor,
    run: impl FnOnce() -> T,
) -> T {
    RUNTIME_LOG_SINKS.with(|sinks| {
        sinks.borrow_mut().push(RuntimeLogSink {
            telemetry,
            correlation,
            redactor,
        });
    });
    let _guard = RuntimeLogSinkGuard;
    run()
}

fn redact_runtime_observation(value: Value) -> Value {
    RUNTIME_LOG_SINKS.with(|sinks| {
        let sinks = sinks.borrow();
        match sinks.last() {
            Some(sink) => sink.redactor.redact_value(value),
            None => value,
        }
    })
}

fn capture_runtime_log(level: &str, message: Value) -> Value {
    let message = redact_runtime_observation(message);
    // @ref LLP 0154#d2--the-observation-span-classification-registry-and-phase-1-kinds —
    // capture the existing trusted runtime.log host boundary; authored
    // messages pass through Telemetry's strict details allowlist and caps.
    RUNTIME_LOG_SINKS.with(|sinks| {
        if let Some(sink) = sinks.borrow().last() {
            sink.telemetry
                .runtime_log(level, &message, sink.correlation.as_deref());
        }
    });
    message
}

fn runtime_log_stderr_line(level: &str, message: &Value) -> String {
    format!("[snapback handler console.{level}] {message}")
}

fn handler_console_stderr_enabled() -> bool {
    #[cfg(test)]
    if TEST_HANDLER_CONSOLE_STDERR.with(|captures| !captures.borrow().is_empty()) {
        return true;
    }
    matches!(
        env::var("SNAPBACK_HANDLER_CONSOLE").ok().as_deref(),
        Some("stderr")
    )
}

fn emit_handler_console_stderr(line: String) {
    #[cfg(test)]
    if TEST_HANDLER_CONSOLE_STDERR.with(|captures| {
        let mut captures = captures.borrow_mut();
        captures.last_mut().is_some_and(|lines| {
            lines.push(line.clone());
            true
        })
    }) {
        return;
    }
    eprintln!("{line}");
}

#[cfg(test)]
fn with_captured_handler_console_stderr<T>(run: impl FnOnce() -> T) -> (T, Vec<String>) {
    TEST_HANDLER_CONSOLE_STDERR.with(|captures| captures.borrow_mut().push(Vec::new()));
    let result = run();
    let lines = TEST_HANDLER_CONSOLE_STDERR.with(|captures| {
        captures
            .borrow_mut()
            .pop()
            .expect("handler-console stderr capture stack")
    });
    (result, lines)
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct IbexQueryRun {
    pub output: QueryOutput,
    pub read_dependencies: Vec<CapturedReadDependency>,
}

/// One bounded response-stream request crossing the action-only host seam.
/// Header/body values are application data and must never be copied into
/// diagnostics; implementations report only shape and limit facts.
// @ref LLP 0076#surface — the shared harness exposes one pull-driven reader
// over these target-neutral open/read/cancel host operations.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionStreamRequest {
    pub url: String,
    #[serde(default = "default_stream_method")]
    pub method: String,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub idempotency_key: Option<String>,
    /// Optional host-issued `StreamAttemptV1` token binding this upstream
    /// request as a child cursor of the named attempt (LLP 0076 decision 3).
    #[serde(default)]
    pub attempt_token: Option<String>,
    /// LLP 0036 opaque placement slots, same shape as ordinary host-mediated
    /// fetch: each slot names a placement (`header`/`query-param`), a target
    /// name, and the opaque secret descriptor the HOST resolves at its own
    /// boundary. Descriptor resolution is a hosted-profile capability; the
    /// local value-mode profile refuses descriptor slots with a typed
    /// diagnostic rather than silently dropping them.
    #[serde(default)]
    pub secret_slots: Vec<StreamSecretSlot>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamSecretSlot {
    #[serde(default)]
    pub placement: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub secret: Option<Value>,
}

fn default_stream_method() -> String {
    "GET".to_owned()
}

/// One buffered host-mediated fetch request crossing the action-only host
/// seam (`ctx.fetch` → `host.fetch`, LLP 0049 §Action Egress). Same envelope
/// as the streamed sibling minus the cursor machinery; the hosted profile
/// resolves descriptor placement slots at its own boundary, the local
/// value-mode profile refuses them (0137 a4-f1 / a5-f1: plain `ctx.fetch`
/// must work wherever `ctx.fetchStream` does).
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostFetchRequest {
    pub url: String,
    #[serde(default = "default_stream_method")]
    pub method: String,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub secret_slots: Vec<StreamSecretSlot>,
}

/// The buffered response value — field-compatible with the workerd
/// coordinator's `hostActionFetch`, so `ctx.fetch` reads identically on both
/// targets: `{status, ok, url, bodyText}` with the AUTHORED url echoed
/// (never a host-substituted, potentially secret-bearing representation).
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostFetchResponse {
    pub status: u16,
    pub ok: bool,
    pub url: String,
    pub body_text: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionStreamOpened {
    pub stream_id: String,
    pub status: u16,
    pub status_text: String,
    pub url: String,
    pub headers: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionStreamChunk {
    pub done: bool,
    pub bytes: Vec<u8>,
    pub total_bytes: u64,
    /// Host-owned monotonic milliseconds since the stream opened (LLP 0076
    /// author decision 6): the supported progress clock that lets an action
    /// obey the 100 ms commit spacing without an ambient wall clock.
    #[serde(default)]
    pub elapsed_ms: u64,
    /// Milliseconds since the previous delivered byte on this cursor.
    #[serde(default)]
    pub delta_ms: u64,
}

/// The seam through which an action reaches instance state. Actions can
/// mutate only through an explicitly named mutation; direct reads are not a
/// capability of this host at all. The Rust host-call dispatcher separately
/// rejects action-mode `db.query`/`db.get`, so the JS context shim is defense
/// in depth rather than the capability boundary.
pub trait IbexActionHost {
    /// Validate that this action invocation still has host-call authority.
    /// Detached hosts use this on every operation to bind the whole action,
    /// not only a nested mutation commit, to its staging app generation.
    fn validate_host_call(&mut self, op: &str) -> SnapbackResult<()>;
    fn run_mutation(&mut self, name: &str, input: HandlerInput) -> SnapbackResult<MutationOutput>;
    /// Advisory transport witness for one opaque session principal. Targets
    /// without a truthful authority must refuse, never answer false.
    fn has_fresh_client(&mut self, _principal_id: &str) -> SnapbackResult<bool> {
        Err(SnapbackError::error(
            "SNAPBACK_CONNECTED_CLIENT_PREDICATE_UNAVAILABLE",
            "realtime",
            "this invocation target does not provide an authoritative connected-client witness index",
        ))
    }
    // @ref LLP 0076#target-contract — a target that does not implement the
    // bounded response-stream profile must refuse with the stable
    // `_UNSUPPORTED` code rather than buffering or silently degrading.
    fn open_response_stream(
        &mut self,
        _request: ActionStreamRequest,
    ) -> SnapbackResult<ActionStreamOpened> {
        Err(SnapbackError::error(
            "SNAPBACK_ACTION_STREAM_UNSUPPORTED",
            "runtime",
            "this invocation target does not implement bounded response streaming",
        ))
    }
    fn read_response_stream(&mut self, _stream_id: &str) -> SnapbackResult<ActionStreamChunk> {
        Err(SnapbackError::error(
            "SNAPBACK_ACTION_STREAM_UNSUPPORTED",
            "runtime",
            "this invocation target does not implement bounded response streaming",
        ))
    }
    fn cancel_response_stream(&mut self, _stream_id: &str) -> SnapbackResult<()> {
        Err(SnapbackError::error(
            "SNAPBACK_ACTION_STREAM_UNSUPPORTED",
            "runtime",
            "this invocation target does not implement bounded response streaming",
        ))
    }
    // @ref LLP 0076#settlement-and-retry — the host-owned StreamAttemptV1
    // control plane: opaque attempt tokens, the single-runner lease, and
    // compare-and-set terminal settlement returned verbatim.
    fn start_stream_attempt(
        &mut self,
        _client_key: &str,
    ) -> SnapbackResult<crate::stream_attempt::StreamAttemptStart> {
        Err(SnapbackError::error(
            "SNAPBACK_ACTION_STREAM_UNSUPPORTED",
            "runtime",
            "this invocation target does not implement stream attempt settlement",
        ))
    }
    fn settle_stream_attempt(
        &mut self,
        _attempt_token: &str,
        _cause: crate::stream_attempt::StreamAttemptCause,
    ) -> SnapbackResult<crate::stream_attempt::StreamAttemptTerminal> {
        Err(SnapbackError::error(
            "SNAPBACK_ACTION_STREAM_UNSUPPORTED",
            "runtime",
            "this invocation target does not implement stream attempt settlement",
        ))
    }
    /// Emit one bounded server-output chunk for a `stream: true` action.
    /// @ref LLP 0204#d91--streaming-conversations — the action
    /// host publishes through the existing ephemeral room machinery.
    fn emit_stream_chunk(
        &mut self,
        _chunk: Value,
    ) -> SnapbackResult<crate::stream_attempt::StreamChunkEmission> {
        Err(SnapbackError::error(
            "SNAPBACK_STREAM_NOT_DECLARED",
            "runtime",
            "this invocation is not a declared streaming action",
        ))
    }
    /// Buffered host-mediated fetch (`ctx.fetch`), the streamed profile's
    /// plain sibling (0137 a4-f1 / a5-f1). A target that does not implement
    /// it refuses with the stable code, exactly like the streamed default —
    /// never by falling back to ambient fetch.
    fn host_fetch(&mut self, _request: HostFetchRequest) -> SnapbackResult<HostFetchResponse> {
        Err(SnapbackError::error(
            "SNAPBACK_HOST_FETCH_UNSUPPORTED",
            "runtime",
            "this invocation target does not implement host-mediated fetch; on the local \
             target ctx.fetch is served by the detached action host (the same execution \
             lane as ctx.fetchStream)",
        ))
    }
    fn push_send(
        &mut self,
        _request: crate::push::PushSendRequestV1,
    ) -> SnapbackResult<crate::push::PushSendReservationResponseV1> {
        Err(SnapbackError::error(
            "SNAPBACK_PUSH_SEND_UNSUPPORTED",
            "runtime",
            "this invocation target does not implement the Expo push send seam",
        ))
    }
}

/// A mutation handler's completed, still-uncommitted effect buffer. Detached
/// action-hosted mutations execute into this owned value outside the global
/// instance mutex; only the bounded validation/SQLite commit re-enters it.
pub(crate) struct ExecutedIbexMutation {
    pub writes: Vec<BufferedWrite>,
    pub sequence_allocations: Vec<SequenceAllocationFact>,
    pub job_enqueues: Vec<crate::jobs::BufferedJobEnqueue>,
    pub membership_commands: Vec<BufferedMembershipCommand>,
    pub reads: Vec<CapturedReadDependency>,
    pub asset_admissions: Vec<crate::assets::AssetAttachmentAdmission>,
    pub asset_grant_ops: Vec<crate::assets::BufferedAssetGrantOp>,
    pub result: Value,
    pub ctx_ledger: CtxAnswerLedger,
    pub media_projection_proof: Option<StagedMediaProjectionProofV1>,
    pub media_projection_scope: Option<MediaProjectionInvocationScopeV1>,
}

impl ExecutedIbexMutation {
    /// Cross the one planner-refusal boundary without exposing its dependency
    /// bookkeeping to staging, preview, or commit callers.
    pub(crate) fn authorize_membership_commands(
        &mut self,
        db: &mut LocalDatabase,
    ) -> SnapbackResult<Vec<crate::storage::AuthorizedMembershipPlan>> {
        authorize_invocation_membership_commands(
            db,
            std::mem::take(&mut self.membership_commands),
            &mut self.reads,
        )
    }

    /// Preview keeps the buffered commands for the later guarded commit while
    /// crossing the same refusal boundary as the consuming path.
    pub(crate) fn preview_membership_commands(
        &mut self,
        db: &mut LocalDatabase,
    ) -> SnapbackResult<Vec<crate::storage::AuthorizedMembershipPlan>> {
        authorize_invocation_membership_commands(
            db,
            self.membership_commands.clone(),
            &mut self.reads,
        )
    }
}

/// Turn planner output into this invocation's final membership-plan result.
/// Storage only attaches denial dependencies to `SnapbackError`; this is the
/// single consumer that may merge them into the live invocation read set.
/// Every staging/preview/commit caller otherwise uses ordinary `?`
/// propagation, so an intermediate return can never strand the witness in a
/// soon-to-be-dropped local vector.
///
/// @ref LLP 0056#invalidation-the-llp-0053-mapping — denied membership reads
///   remain matcher-visible dependencies, including empty-result probes.
pub(crate) fn authorize_invocation_membership_commands(
    db: &mut LocalDatabase,
    commands: Vec<BufferedMembershipCommand>,
    invocation_reads: &mut Vec<CapturedReadDependency>,
) -> SnapbackResult<Vec<crate::storage::AuthorizedMembershipPlan>> {
    db.membership_plans()
        .authorize_membership_commands(commands)
        .map_err(|error| error.finalize_invocation_refusal(invocation_reads))
}

#[derive(Debug)]
struct MediaProjectionStagingV1 {
    proof: StagedMediaProjectionProofV1,
    scope: MediaProjectionInvocationScopeV1,
}

#[derive(Clone, Debug)]
struct MediaProvenanceEntryV1 {
    source_table: String,
    source_field: String,
    source_field_generation: String,
    source_row_id: String,
    asset_id: String,
    kind: crate::contract_types::MediaKindV1,
    snapshot_version: u64,
    related_fact_digest: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MediaHandoffV1 {
    occurrences: Vec<MediaHandoffOccurrenceV1>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MediaHandoffOccurrenceV1 {
    path: Vec<String>,
    token: String,
}

fn media_unprovenanced() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_MEDIA_PROJECTION_UNPROVENANCED",
        "assets",
        "media result did not preserve exact host provenance",
    )
}

fn media_projection_proof_binding(
    prepared: &PreparedInvocation,
    input: &HandlerInput,
    scope: &MediaProjectionInvocationScopeV1,
) -> SnapbackResult<MediaProjectionProofBindingV1> {
    let result_contract_hash = prepared
        .result_contract_hash()
        .ok_or_else(media_unprovenanced)?
        .to_owned();
    let principal_value =
        serde_json::to_value(prepared.projection()).map_err(|_| media_unprovenanced())?;
    let principal_binding = crate::operation_ledger::digest_fact_set(
        b"snapback:media-proof-principal:v1\n",
        &principal_value,
    );
    let function_artifact_generation = prepared
        .artifact_generation()
        .filter(|generation| is_concrete_function_artifact_generation(generation))
        .ok_or_else(media_unprovenanced)?
        .to_owned();
    Ok(MediaProjectionProofBindingV1 {
        process_epoch: scope.process_epoch.clone(),
        invocation_nonce: scope.invocation_nonce,
        principal_binding,
        authority_instance_binding: prepared.authority().resolved().invalidation_subject(),
        function_id: prepared.function_id().to_owned(),
        function_artifact_generation,
        result_contract_hash,
        pinned_snapshot: scope.pinned_snapshot,
        request_identity: prepared.invocation_id().to_owned(),
        client_mutation_identity: MediaProjectionClientMutationIdentityV1::from_digest(
            input.auth.client_mutation_digest.as_deref(),
        ),
    })
}

/// Reconstruct the expected proof binding from the still-trusted prepared
/// invocation and request carrier. Storage receives this separately from the
/// staged proof and compares the closed records before OCC admission.
pub(crate) fn expected_media_projection_proof_binding(
    prepared: &PreparedInvocation,
    input: &HandlerInput,
    scope: &MediaProjectionInvocationScopeV1,
) -> SnapbackResult<MediaProjectionProofBindingV1> {
    media_projection_proof_binding(prepared, input, scope)
}

fn normalize_media_contract_value(
    contract: &FunctionResultContract,
    value: &mut Value,
    path: &mut Vec<String>,
    handoff: &BTreeMap<Vec<String>, String>,
    entries: &BTreeMap<String, MediaProvenanceEntryV1>,
    proof: &mut Vec<MediaProjectionProofOccurrenceV1>,
) -> SnapbackResult<()> {
    match contract {
        FunctionResultContract::Documents { document, .. }
        | FunctionResultContract::Records {
            record: document, ..
        }
        | FunctionResultContract::LegacyQueryRowsV0 { row: document } => {
            let rows = value.as_array_mut().ok_or_else(media_unprovenanced)?;
            for (index, row) in rows.iter_mut().enumerate() {
                path.push(index.to_string());
                normalize_media_value(document, row, path, handoff, entries, proof)?;
                path.pop();
            }
        }
        FunctionResultContract::Document { document, .. }
        | FunctionResultContract::Value { value: document } => {
            normalize_media_value(document, value, path, handoff, entries, proof)?;
        }
        FunctionResultContract::Unknown => {}
    }
    Ok(())
}

fn normalize_media_value(
    contract: &ResultValueContract,
    value: &mut Value,
    path: &mut Vec<String>,
    handoff: &BTreeMap<Vec<String>, String>,
    entries: &BTreeMap<String, MediaProvenanceEntryV1>,
    proof: &mut Vec<MediaProjectionProofOccurrenceV1>,
) -> SnapbackResult<()> {
    match contract {
        ResultValueContract::MediaRefV1 {
            source_table,
            source_field,
            source_field_generation,
            ..
        } => {
            let token = handoff.get(path).ok_or_else(media_unprovenanced)?;
            let entry = entries.get(token).ok_or_else(media_unprovenanced)?;
            if &entry.source_table != source_table
                || &entry.source_field != source_field
                || &entry.source_field_generation != source_field_generation
            {
                return Err(media_unprovenanced());
            }
            let object = value.as_object_mut().ok_or_else(media_unprovenanced)?;
            if object.get("assetId").and_then(Value::as_str) != Some(entry.asset_id.as_str()) {
                return Err(media_unprovenanced());
            }
            object.insert(
                "kind".to_owned(),
                serde_json::to_value(entry.kind).map_err(|_| media_unprovenanced())?,
            );
            proof.push(MediaProjectionProofOccurrenceV1 {
                path: path.clone(),
                source_table: entry.source_table.clone(),
                source_field: entry.source_field.clone(),
                source_field_generation: entry.source_field_generation.clone(),
                source_row_id: entry.source_row_id.clone(),
                asset_id: entry.asset_id.clone(),
                kind: entry.kind,
                snapshot_version: entry.snapshot_version,
                related_fact_digest: entry.related_fact_digest.clone(),
            });
        }
        ResultValueContract::Array { element, .. } => {
            let values = value.as_array_mut().ok_or_else(media_unprovenanced)?;
            for (index, value) in values.iter_mut().enumerate() {
                path.push(index.to_string());
                normalize_media_value(element, value, path, handoff, entries, proof)?;
                path.pop();
            }
        }
        ResultValueContract::Tuple { elements } => {
            let values = value.as_array_mut().ok_or_else(media_unprovenanced)?;
            for (index, (contract, value)) in elements.iter().zip(values.iter_mut()).enumerate() {
                path.push(index.to_string());
                normalize_media_value(contract, value, path, handoff, entries, proof)?;
                path.pop();
            }
        }
        ResultValueContract::Union { variants } => {
            if value.is_null() {
                return Ok(());
            }
            if let Some(variant) = variants
                .iter()
                .find(|variant| crate::manifest::value_contract_contains_media(variant))
            {
                normalize_media_value(variant, value, path, handoff, entries, proof)?;
            }
        }
        ResultValueContract::Object { fields, .. } => {
            let object = value.as_object_mut().ok_or_else(media_unprovenanced)?;
            for field in fields {
                if !crate::manifest::value_contract_contains_media(&field.value) {
                    continue;
                }
                let child = object
                    .get_mut(&field.name)
                    .ok_or_else(media_unprovenanced)?;
                path.push(field.name.clone());
                normalize_media_value(&field.value, child, path, handoff, entries, proof)?;
                path.pop();
            }
        }
        _ => {}
    }
    Ok(())
}

// Interior-split residue: the prepared mutation/query/action/asset entry points
// stay with host glue because their existing signatures and bodies directly
// carry PreparedInvocation, DbRead/LocalDatabase, admission, conformance,
// jobs, assets, and membership policy. Moving them into the runtime core would
// require a second semantic port inversion; this in-place split deliberately
// preserves those bodies and leaves that inversion to the later engine/runtime
// crate seam.
impl RuntimeManager {
    /// Dry-run an Ibex-module mutation (LLP 0051 D8): the handler runs for
    /// real against the buffered ctx — recording its ctx-answer ledger —
    /// and the buffered writes are validated and applied through the same
    /// path as a commit, then rolled back. Same fidelity, no durable effect.
    pub(crate) fn dry_run_ibex_mutation_prepared(
        &self,
        module: &IbexModule,
        input: HandlerInput,
        prepared: &PreparedInvocation,
        db: &mut LocalDatabase,
        pool: Option<&WarmVmPool>,
    ) -> SnapbackResult<MutationCommit> {
        let mut invocation = IbexHostContext::new_with_projection(
            DbRead::Live(db),
            input.clone(),
            prepared.projection().clone(),
            prepared.admission_lease().clone(),
            MembershipWriter::from_resolved_with_authority_creating(
                prepared.authority().resolved(),
                prepared.authority_creating_consent(),
            ),
            true,
            prepared.authority().elevated_database_allowed(),
        )?;
        invocation.rehearsal_provenance = prepared.authority().rehearsal_provenance().cloned();
        invocation.declared_refusals = prepared.declared_refusals().to_vec();
        invocation.tracked_refusals = prepared.tracked_refusals().to_vec();
        invocation.declared_sequences = prepared.sequences().to_vec();
        invocation.generated_authority_operation =
            prepared.generated_authority_operation().cloned();
        let result = run_ibex_handler_with_context(module, &mut invocation, pool);
        // A terminal role denial fails the (dry-run) mutation and never commits,
        // preserving the trusted brand regardless of a handler catch.
        if let Some(denial) = invocation.take_terminal_denial() {
            return Err(denial);
        }
        let mut result = result?;
        let media_projection = invocation.normalize_media_result(&mut result, prepared)?;
        let expected_media_projection_binding = media_projection
            .as_ref()
            .map(|staging| {
                expected_media_projection_proof_binding(prepared, &input, &staging.scope)
            })
            .transpose()?;
        let ctx_ledger = invocation.take_ctx_ledger()?;
        let IbexHostContext {
            writes,
            sequence_allocations,
            job_enqueues,
            membership_commands,
            mut reads,
            asset_admissions,
            asset_grant_ops,
            ..
        } = invocation;
        let membership_plans =
            authorize_invocation_membership_commands(db, membership_commands, &mut reads)?;
        db.mutation_writes().dry_run_buffered_writes_with_jobs(
            &input,
            writes,
            sequence_allocations,
            membership_plans,
            reads,
            result,
            ctx_ledger,
            job_enqueues,
            Some(crate::jobs::JobProducer {
                mutation_id: crate::ids::mint_time_ordered(crate::ids::Kind::DryRun),
                function: "mutationDryRun".to_owned(),
                principal: input.auth.user_id.clone(),
            }),
            asset_admissions,
            asset_grant_ops,
            media_projection.as_ref().map(|staging| &staging.proof),
            expected_media_projection_binding.as_ref(),
        )
    }

    // This is the explicit runtime boundary: keeping the independently named
    // authority, cron, host, grant, and deadline inputs avoids hiding a
    // capability in a catch-all carrier merely to meet Clippy's default of 7.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn invoke_ibex_action_prepared(
        &self,
        module: &IbexModule,
        input: HandlerInput,
        prepared: &PreparedInvocation,
        run: CronRunMetadata,
        host: &mut dyn IbexActionHost,
        grants: Value,
        deadline: Option<Instant>,
    ) -> SnapbackResult<Value> {
        let mut invocation = IbexHostContext::new_action_with_projection(
            input,
            prepared.projection().clone(),
            prepared.admission_lease().clone(),
            run,
            host,
            grants,
        )?;
        invocation.rehearsal_provenance = prepared.authority().rehearsal_provenance().cloned();
        invocation.declared_refusals = prepared.declared_refusals().to_vec();
        invocation.tracked_refusals = prepared.tracked_refusals().to_vec();
        // Actions always run fresh by the DK-4 scope fence. Per-invocation
        // config grants therefore cannot leak through a pooled VM.
        run_ibex_handler_with_context_until(module, &mut invocation, None, deadline)
    }
}

impl RuntimeGuard {
    pub(crate) fn interrupt_on(&self, admission: &AdmissionLease) -> CancellationRegistration {
        let interrupt = self.interrupt.clone();
        admission.register_cancellation_hook(move || interrupt.signal())
    }
}

pub(crate) fn execute_ibex_mutation_prepared(
    module: &IbexModule,
    input: HandlerInput,
    prepared: &PreparedInvocation,
    db: DbRead<'_>,
    pool: Option<&WarmVmPool>,
    deadline: Option<Instant>,
) -> SnapbackResult<ExecutedIbexMutation> {
    prepared.validate_admission("ibex mutation execution")?;
    let mut invocation = IbexHostContext::new_with_projection(
        db,
        input,
        prepared.projection().clone(),
        prepared.admission_lease().clone(),
        MembershipWriter::from_resolved_with_authority_creating(
            prepared.authority().resolved(),
            prepared.authority_creating_consent(),
        ),
        true,
        prepared.authority().elevated_database_allowed(),
    )?;
    invocation.rehearsal_provenance = prepared.authority().rehearsal_provenance().cloned();
    invocation.declared_refusals = prepared.declared_refusals().to_vec();
    invocation.tracked_refusals = prepared.tracked_refusals().to_vec();
    invocation.declared_sequences = prepared.sequences().to_vec();
    invocation.generated_authority_operation = prepared.generated_authority_operation().cloned();
    let result = run_ibex_handler_with_context_until(module, &mut invocation, pool, deadline);
    // A terminal role denial fails the mutation before commit and preserves the
    // trusted brand regardless of a handler catch (LLP 0056 M3).
    if let Some(denial) = invocation.take_terminal_denial() {
        return Err(denial);
    }
    let mut result = result?;
    let media_projection = invocation.normalize_media_result(&mut result, prepared)?;
    // The recorded (or replayed) ctx-answer ledger rides the output (LLP 0051
    // D1) so the later commit is semantically identical to the in-lock path.
    let ctx_ledger = invocation.take_ctx_ledger()?;
    // Strict declaration conformance (LLP 0146 D1, per-app opt-in): this seam
    // refuses before any caller can commit, so an undeclared write never
    // becomes a durable effect and an undeclared read never hands off a
    // result. HostPlan mutations never reach this path and cannot drift.
    {
        let schema = invocation.db().schema();
        crate::conformance::enforce_strict_reads(
            schema,
            prepared.function_id(),
            prepared.strict_declaration_facts(),
            &invocation.reads,
        )?;
        crate::conformance::enforce_strict_writes(
            schema,
            prepared.function_id(),
            prepared.strict_declaration_facts(),
            &invocation.writes,
        )?;
    }
    let IbexHostContext {
        writes,
        sequence_allocations,
        job_enqueues,
        membership_commands,
        reads,
        asset_admissions,
        asset_grant_ops,
        ..
    } = invocation;
    prepared.validate_admission("ibex mutation completion")?;
    let (media_projection_proof, media_projection_scope) = media_projection
        .map(|staging| (Some(staging.proof), Some(staging.scope)))
        .unwrap_or((None, None));
    Ok(ExecutedIbexMutation {
        writes,
        sequence_allocations,
        job_enqueues,
        membership_commands,
        reads,
        asset_admissions,
        asset_grant_ops,
        result,
        ctx_ledger,
        media_projection_proof,
        media_projection_scope,
    })
}

/// Run a prepared query against one pinned read view, so all `ctx.db` calls
/// and the reported version observe the same WAL snapshot.
///
/// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L6.
pub(crate) fn run_ibex_query_with_reads_prepared(
    module: &IbexModule,
    input: HandlerInput,
    prepared: &PreparedInvocation,
    db: DbRead<'_>,
    pool: Option<&WarmVmPool>,
    protected_query_profile: bool,
    authority_cursor: Option<crate::local::RelationalCursorAuthority<'_>>,
) -> SnapbackResult<IbexQueryRun> {
    prepared.validate_admission("ibex query execution")?;
    let mut invocation = IbexHostContext::new_with_projection(
        db,
        input,
        prepared.projection().clone(),
        prepared.admission_lease().clone(),
        MembershipWriter::from_resolved_with_authority_creating(
            prepared.authority().resolved(),
            prepared.authority_creating_consent(),
        ),
        false,
        prepared.authority().elevated_database_allowed(),
    )?;
    invocation.rehearsal_provenance = prepared.authority().rehearsal_provenance().cloned();
    invocation.protected_query_profile = protected_query_profile;
    invocation.authority_cursor = authority_cursor;
    invocation.declared_refusals = prepared.declared_refusals().to_vec();
    invocation.tracked_refusals = prepared.tracked_refusals().to_vec();
    invocation.generated_authority_operation = prepared.generated_authority_operation().cloned();
    // The shipped DK-4 reset does not restore module lexical/imported state.
    // Protected queries therefore take a fresh realm even if a caller
    // accidentally supplies the warm pool.
    //
    // @ref LLP 0053#the-authorization-event-universe-closed — protected
    //   module state must be fresh or reset-equivalent.
    let pool = if protected_query_profile { None } else { pool };
    let value = run_ibex_handler_with_context(module, &mut invocation, pool);
    // A terminal role denial terminates the query subscription (LLP 0056 M3:
    // denied-at-subscribe is terminated, not parked), with the trusted brand
    // preserved regardless of a handler catch.
    if let Some(denial) = invocation.take_terminal_denial() {
        return Err(denial);
    }
    let mut value = value?;
    invocation.normalize_media_result(&mut value, prepared)?;
    // @ref LLP 0108#query-single-value-egress--2026-08-15 — scalar query
    // declarations use one internal row so the existing query/live transport
    // remains the sole owner; every row-shaped or unknown query retains the
    // LLP 0032 S5.D9 array-only safety floor.
    let rows = if matches!(
        prepared.result_contract(),
        FunctionResultContract::Document { .. } | FunctionResultContract::Value { .. }
    ) {
        vec![value]
    } else {
        value.as_array().cloned().ok_or_else(|| {
            let function_kind = match prepared.function_kind() {
                FunctionKind::Query => "query",
                FunctionKind::LiveQuery => "live query",
                _ => "query-shaped",
            };
            SnapbackError::error(
                "SNAPBACK_HANDLER_RESULT_INVALID",
                "runtime",
                format!(
                    "{function_kind} handler {:?} must return an array of rows",
                    prepared.function_id()
                ),
            )
        })?
    };
    // Strict declaration conformance (LLP 0146 D1, per-app opt-in): refuse an
    // undeclared application-table read before the result handoff.
    crate::conformance::enforce_strict_reads(
        invocation.db().schema(),
        prepared.function_id(),
        prepared.strict_declaration_facts(),
        &invocation.reads,
    )?;
    prepared.validate_admission("ibex query completion")?;
    Ok(IbexQueryRun {
        output: QueryOutput {
            rows,
            version: invocation.db().current_version()?,
            cursor: invocation.query_cursor,
        },
        read_dependencies: invocation.reads,
    })
}

pub(crate) struct AssetAuthorizerRun {
    pub owner: String,
    pub read_dependencies: Vec<crate::storage::CapturedReadDependency>,
}

/// Run an asset upload-intent authorizer (LLP 0044 §Generated upload
/// intents) under the protected profile with a fresh realm, capturing the
/// complete LLP 0007 read-set as the admission witness. The authorizer's
/// output contract is closed: exactly `{ owner: <non-empty principal> }` —
/// it is not a query, so the array rule does not apply, and any other shape
/// refuses.
pub(crate) fn run_ibex_asset_authorizer_prepared(
    module: &IbexModule,
    input: HandlerInput,
    prepared: &PreparedInvocation,
    db: DbRead<'_>,
) -> SnapbackResult<AssetAuthorizerRun> {
    prepared.validate_admission("asset authorizer execution")?;
    let mut invocation = IbexHostContext::new_with_projection(
        db,
        input,
        prepared.projection().clone(),
        prepared.admission_lease().clone(),
        MembershipWriter::from_resolved_with_authority_creating(
            prepared.authority().resolved(),
            prepared.authority_creating_consent(),
        ),
        false,
        prepared.authority().elevated_database_allowed(),
    )?;
    invocation.rehearsal_provenance = prepared.authority().rehearsal_provenance().cloned();
    invocation.protected_query_profile = true;
    invocation.declared_refusals = prepared.declared_refusals().to_vec();
    invocation.tracked_refusals = prepared.tracked_refusals().to_vec();
    let value = run_ibex_handler_with_context(module, &mut invocation, None);
    if let Some(denial) = invocation.take_terminal_denial() {
        return Err(denial);
    }
    let value = value?;
    let invalid = || {
        SnapbackError::error(
            "SNAPBACK_ASSET_AUTHORIZER_RESULT_INVALID",
            "assets",
            "an upload-intent authorizer must return exactly { owner: <non-empty principal> }",
        )
    };
    let object = value.as_object().ok_or_else(invalid)?;
    if object.len() != 1 {
        return Err(invalid());
    }
    let owner = object
        .get("owner")
        .and_then(serde_json::Value::as_str)
        .filter(|owner| !owner.is_empty())
        .ok_or_else(invalid)?;
    prepared.validate_admission("asset authorizer completion")?;
    Ok(AssetAuthorizerRun {
        owner: owner.to_owned(),
        read_dependencies: invocation.reads,
    })
}

#[cfg(test)]
mod media_provenance_tests {
    use super::*;

    fn node(source_table: &str) -> ResultValueContract {
        ResultValueContract::MediaRefV1 {
            source_table: source_table.to_owned(),
            source_field: "image".to_owned(),
            source_field_generation: "sha256:field-generation".to_owned(),
            optional: false,
            class_m_treatment: "class-m.none.v1".to_owned(),
            upload_intent: "profileImageUpload".to_owned(),
            policy_generation: "profile-image.v1".to_owned(),
            kinds: vec![crate::contract_types::MediaKindV1::Image],
            delivery: Some("primary".to_owned()),
            variants: vec!["primary".to_owned()],
            classification_profile: "detected-content-type.v1".to_owned(),
            retention_class: "media-reference.v1".to_owned(),
        }
    }

    fn entry(source_table: &str) -> MediaProvenanceEntryV1 {
        MediaProvenanceEntryV1 {
            source_table: source_table.to_owned(),
            source_field: "image".to_owned(),
            source_field_generation: "sha256:field-generation".to_owned(),
            source_row_id: "profile-1".to_owned(),
            asset_id: "asset-1".to_owned(),
            kind: crate::contract_types::MediaKindV1::Image,
            snapshot_version: 7,
            related_fact_digest: "sha256:related-facts".to_owned(),
        }
    }

    /// @ref LLP 0244#d1-one-authoritative-media-result-materialization-cut
    #[test]
    fn exact_token_overwrites_handler_kind_while_copy_and_cross_source_refuse() {
        let contract = FunctionResultContract::Value {
            value: node("profiles"),
        };
        let token = "smp1.token".to_owned();
        let handoff = BTreeMap::from([(Vec::<String>::new(), token.clone())]);
        let entries = BTreeMap::from([(token, entry("profiles"))]);
        let mut value = json!({ "assetId": "asset-1", "kind": "video" });
        let mut proof = Vec::new();
        normalize_media_contract_value(
            &contract,
            &mut value,
            &mut Vec::new(),
            &handoff,
            &entries,
            &mut proof,
        )
        .expect("exact host identity is admitted");
        assert_eq!(value["kind"], "image", "handler kind is never authority");
        assert_eq!(proof.len(), 1);
        assert_eq!(proof[0].source_row_id, "profile-1");
        assert_eq!(proof[0].snapshot_version, 7);
        assert_eq!(proof[0].related_fact_digest, "sha256:related-facts");

        let mut copied = json!({ "assetId": "asset-1", "kind": "image" });
        let error = normalize_media_contract_value(
            &contract,
            &mut copied,
            &mut Vec::new(),
            &BTreeMap::new(),
            &entries,
            &mut Vec::new(),
        )
        .expect_err("a structural copy has no WeakMap custody");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MEDIA_PROJECTION_UNPROVENANCED"
        );

        let cross_source_entries =
            BTreeMap::from([("smp1.cross-source".to_owned(), entry("accountSettings"))]);
        let cross_source_handoff =
            BTreeMap::from([(Vec::<String>::new(), "smp1.cross-source".to_owned())]);
        let error = normalize_media_contract_value(
            &contract,
            &mut json!({ "assetId": "asset-1", "kind": "image" }),
            &mut Vec::new(),
            &cross_source_handoff,
            &cross_source_entries,
            &mut Vec::new(),
        )
        .expect_err("a token from another semantic source is not interchangeable");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MEDIA_PROJECTION_UNPROVENANCED"
        );
    }

    /// @ref LLP 0244#d1-one-authoritative-media-result-materialization-cut
    #[test]
    fn preview_borrows_and_commit_takes_the_only_proof_owner() {
        let occurrence = MediaProjectionProofOccurrenceV1 {
            path: vec!["image".to_owned()],
            source_table: "profiles".to_owned(),
            source_field: "image".to_owned(),
            source_field_generation: "sha256:field-generation".to_owned(),
            source_row_id: "profile-1".to_owned(),
            asset_id: "asset-1".to_owned(),
            kind: crate::contract_types::MediaKindV1::Image,
            snapshot_version: 7,
            related_fact_digest: "sha256:related-facts".to_owned(),
        };
        let binding = MediaProjectionProofBindingV1 {
            process_epoch: "process-a".to_owned(),
            invocation_nonce: 7,
            principal_binding: "sha256:principal".to_owned(),
            authority_instance_binding: "authority-a".to_owned(),
            function_id: "profiles:setImage".to_owned(),
            function_artifact_generation:
                "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_owned(),
            result_contract_hash: "sha256:result-contract".to_owned(),
            pinned_snapshot: 7,
            request_identity: "request-a".to_owned(),
            client_mutation_identity: MediaProjectionClientMutationIdentityV1::ClientMutation(
                "sha256:mutation-a".to_owned(),
            ),
        };
        let proof = StagedMediaProjectionProofV1::new(
            MediaProjectionPlanV1 {
                occurrences: vec![MediaProjectionSemanticOccurrenceV1 {
                    path: vec!["image".to_owned()],
                    node: node("profiles"),
                }],
            },
            "sha256:result-contract".to_owned(),
            binding,
            vec![occurrence],
        );
        assert_eq!(proof.borrow_occurrences().len(), 1);
        assert_eq!(proof.borrow_occurrences().len(), 1);
        assert_eq!(
            proof.consume_occurrences().expect("one commit take").len(),
            1
        );
    }
}

fn action_host_missing() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_ACTION_HOST_MISSING",
        "runtime",
        "action host call ran without an action host",
    )
}

fn action_db_denied(op: &str) -> SnapbackError {
    // @ref LLP 0009#harness-control-plane-boundary — action DB denial is
    // enforced on the shared host dispatcher, below the mutable JS surface.
    // Preserve the public ctx shim's existing stable code. The important
    // boundary is that even a raw host call carrying a valid invocation epoch
    // cannot turn an action into a reader.
    SnapbackError::error(
        "SNAPBACK_HANDLER_WRITE_IN_QUERY",
        "runtime",
        format!("ctx.db.{op} is unavailable to action-rooted or no-principal invocations"),
    )
}

fn authority_cursor_invalid() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_STANDARD_PATTERN_CURSOR_INVALID",
        "query",
        "authority roster cursor is not valid for this declaration, scope, ordering, generation, and caller; request the first page without a cursor",
    )
}

fn authority_cursor_mint_unavailable() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_STANDARD_PATTERN_CURSOR_MINT_UNAVAILABLE",
        "query",
        "authority roster continuation could not be sealed",
    )
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AuthorityRosterHostPageV1 {
    #[serde(default)]
    after: Option<String>,
    #[serde(default = "authority_roster_default_limit")]
    limit: usize,
}

const fn authority_roster_default_limit() -> usize {
    100
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AuthorityRosterHostRequestV1 {
    declaration: String,
    scope_id: String,
    #[serde(default)]
    page: Option<AuthorityRosterHostPageV1>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AuthorityMyRoleHostRequestV1 {
    declaration: String,
    scope_id: String,
}

fn sequence_parent_unavailable() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_RELATION_PARENT_UNAVAILABLE",
        "storage",
        "relation parent is missing or inactive",
    )
}

fn protected_host_input_error(code: &str, input_kind: &str, op: &str) -> SnapbackError {
    SnapbackError::error(
        code,
        "auth",
        format!("protected query attempted denied mutable input {input_kind}"),
    )
    .with_details(json!({
        "inputKind": input_kind,
        "hostOp": op,
    }))
}

/// Validate a supplied replay ledger before the invocation runs (LLP 0051
/// D1): the format version must be known, and when the ledger carries an auth
/// fingerprint it must match the invocation's resolved auth context — a
/// mismatch surfaces `SNAPBACK_AUTH_STALE_RESULT` (LLP 0043 §Auth posture)
/// rather than replaying under new authority.
fn validate_replay_ledger(input: &HandlerInput) -> SnapbackResult<Option<ReplayLedger>> {
    let Some(ledger) = crate::manifest::validate_ctx_answer_ledger(input)? else {
        return Ok(None);
    };
    Ok(Some(ReplayLedger {
        ids: ledger.ids.clone(),
        cursor: 0,
    }))
}

pub(crate) struct IbexHostContext<'a> {
    /// The storage view for query/mutation invocations. Actions carry `None`:
    /// their `ctx.db` reads route through the action host, whose
    /// implementation chooses the locking policy (ENG-23324).
    db: Option<DbRead<'a>>,
    input: HandlerInput,
    handler_auth: HandlerAuthProjection,
    rehearsal_provenance: Option<crate::auth::rehearsal::AuthRehearsalProvenanceV1>,
    admission: AdmissionLease,
    mode: IbexInvocationMode,
    /// Exact module export currently executing in this host context. The
    /// runner binds it before either executor can dispatch a host call.
    function_name: String,
    /// Root-provenance fence for explicit Class-R elevation. Function kind may
    /// change across a nested mutation, but this host-owned fact may not.
    elevated_database_allowed: bool,
    /// Default-deny input registry for auth-scoped live and retained queries.
    /// This bit is host-owned and cannot be changed by handler code.
    protected_query_profile: bool,
    /// Host-private custody needed only when an authority roster page mints
    /// or verifies an opaque continuation. Application JavaScript never sees
    /// the keyset boundary or any generation-binding inputs.
    authority_cursor: Option<crate::local::RelationalCursorAuthority<'a>>,
    /// A generated roster handler still returns the ordinary row array. Its
    /// host call stages the public opaque continuation here for QueryOutput.
    query_cursor: Option<String>,
    /// Definitive manifest identity for a codegen-synthesized authority
    /// operation. Names alone never enable the private marshalling seams.
    generated_authority_operation: Option<crate::manifest::GeneratedAuthorityOperationV1>,
    /// Declared application refusal codes for the invoked function. Host-owned
    /// and empty by default, so any path that does not deliberately carry the
    /// declaration folds every claimed `appCode` (LLP 0108).
    declared_refusals: Vec<String>,
    /// The immutable subset whose admitted application refusals are eligible
    /// for error tracking. Empty by default and never consulted for admission.
    ///
    /// @ref LLP 0108#tracked-refusal-opt-in
    tracked_refusals: Vec<String>,
    /// Host-owned counter reach declarations for this exact function.
    declared_sequences: Vec<SequenceDeclaration>,
    writes: Vec<BufferedWrite>,
    sequence_allocations: Vec<SequenceAllocationFact>,
    /// Buffered `ctx.jobs.enqueue` intents (LLP 0070's first slice). Like
    /// `writes`, these are effects of the mutation transaction: they commit
    /// or roll back with it, never independently.
    job_enqueues: Vec<crate::jobs::BufferedJobEnqueue>,
    /// Transaction-scoped `ctx.assets.attach` admissions (LLP 0044 §Typed
    /// references): recorded during handler execution, consumed by the
    /// commit hook, never serialized or persisted.
    asset_admissions: Vec<crate::assets::AssetAttachmentAdmission>,
    /// First-class recipient authority staged until the same final write lock
    /// as app writes and typed-reference maintenance.
    asset_grant_ops: Vec<crate::assets::BufferedAssetGrantOp>,
    /// One provenance id shared by all grant mints in this mutation.
    asset_mutation_id: Option<String>,
    /// Declaration-bound membership operations carry their host-derived writer
    /// separately from raw `ctx.db` writes all the way to the central commit seam.
    membership_commands: Vec<BufferedMembershipCommand>,
    membership_writer: MembershipWriter,
    reads: Vec<CapturedReadDependency>,
    read_keys: HashSet<String>,
    media_entries: BTreeMap<String, MediaProvenanceEntryV1>,
    media_handoff: Option<Vec<MediaHandoffOccurrenceV1>>,
    next_media_entry: u64,
    now_ms: u64,
    action_run: Option<CronRunMetadata>,
    action_host: Option<&'a mut dyn IbexActionHost>,
    /// This invocation's identity. A host call whose carried epoch does not
    /// equal this is a stale continuation and is rejected.
    epoch: u64,
    /// Storage snapshot named when this invocation was prepared. Media proof
    /// binding carries this independently of per-occurrence dependencies.
    pinned_snapshot: u64,
    /// The granted-config payload for this invocation (actions only) — the
    /// host-computed `uses` grant, never a process-wide blob.
    ///
    /// @ref LLP 0036#runtime-exposure-d5-d8 — per-invocation grants replace
    /// the deprecated `SNAPBACK_ACTION_SECRETS` env seam (LLP 0029 G4).
    grants: Value,
    /// Record-mode ctx-answer ledger (LLP 0051 D1): every host-generated id
    /// this invocation answered, in order. Queries/mutations only; actions
    /// never record — they are outside the deterministic tier.
    recorded_ids: Vec<String>,
    /// Replay-mode state; `Some` iff the input carried a `ctx_ledger`.
    replay: Option<ReplayLedger>,
    /// An out-of-band **trusted** authority refusal produced by a host-owned
    /// permission or asset-grant operation. The trusted brand on a
    /// `SnapbackError` cannot survive the JS error round-trip, so the real
    /// terminal refusal is recorded here and the outer result-assembly returns it
    /// **regardless of what the handler did with the thrown error** — a handler
    /// that catches it cannot un-deny (terminalization), and a handler that
    /// *forges* `SNAPBACK_AUTH_PERMISSION_DENIED` never sets this, so a forged
    /// throw stays untrusted.
    ///
    /// @ref LLP 0056#rule-helpers — the imperative twin's trusted, terminal
    ///   denial; @ref LLP 0053#agent-auth-protected-query-inputs-amended-2026-07-14-eng-24906 — delivered
    ///   by the existing TerminalAuthorization deny, no new trusted code.
    terminal_denial: Option<SnapbackError>,
    /// The last host-built stream refusal (LLP 0076 §Diagnostics), recorded
    /// out-of-band because the structured, value-free details cannot survive
    /// the JS error round-trip. When the handler surfaces the SAME code, the
    /// outer result-assembly restores this trusted representation; a handler
    /// that forges a stream code without a recorded refusal gets no details.
    stream_refusal: Option<SnapbackError>,
    /// The last trusted diagnostic returned by the shared host-call table.
    /// Handler-envelope codes remain claims, but when the final claim matches
    /// this witness the exact host-built diagnostic can survive the JS round
    /// trip without admitting a handler-forged platform code.
    ///
    /// @ref LLP 0144#invariants-for-any-extension — platform claims require
    /// corroboration; the witness is recorded in the LLP 0048 shared dispatch
    /// seam so Ibex and workerd use the same admission rule.
    host_failure_witness: Option<SnapbackError>,
    /// A **trusted** `SNAPBACK_AUTH_PERMISSION_DENIED` produced by a host
    /// call inside an ACTION (a nested mutation's requireRole/RLS denial
    /// crossing `action.runMutation`), recorded out-of-band (0137 a4-f5 /
    /// a3-f3 family). LLP 0053 pins that a forged `{code: ...}` from handler
    /// JS must stay untyped, so the envelope decoder folds the claimed code
    /// to `SNAPBACK_HANDLER_FAILED`; when the handler's failure CLAIMS this
    /// code AND this witness exists, the outer result-assembly surfaces the
    /// recorded trusted denial with its uniform bytes instead. A claim with
    /// no witness stays folded (forgery); a witness with a different final
    /// failure is not restored (the handler caught the denial and failed
    /// for its own reason); a handler that catches and succeeds succeeds —
    /// unlike `terminal_denial`, this is not terminalizing, because the
    /// denied nested mutation already committed nothing and an action may
    /// legitimately take an alternative path.
    denial_witness: Option<SnapbackError>,
}

/// Replay-mode cursor over a supplied ctx-answer ledger (LLP 0051 D1).
struct ReplayLedger {
    ids: Vec<String>,
    cursor: usize,
}

impl<'a> IbexHostContext<'a> {
    pub(crate) fn new_with_projection(
        db: DbRead<'a>,
        input: HandlerInput,
        handler_auth: HandlerAuthProjection,
        admission: AdmissionLease,
        membership_writer: MembershipWriter,
        writable: bool,
        elevated_database_allowed: bool,
    ) -> SnapbackResult<Self> {
        let replay = validate_replay_ledger(&input)?;
        let now_ms = input
            .ctx_ledger
            .as_ref()
            .map(|ledger| ledger.now)
            .unwrap_or_else(now_millis);
        crate::manifest::validate_portable_timestamp_millis(now_ms)?;
        crate::membership_rules::validate_impersonated_global_roles(
            db.schema(),
            handler_auth.roles(),
        )?;
        let pinned_snapshot = db.current_version()?;
        let reads = auth_dependencies(&input);
        let read_keys = read_dependency_keys(&reads);
        Ok(Self {
            db: Some(db),
            input,
            handler_auth,
            rehearsal_provenance: None,
            admission,
            mode: if writable {
                IbexInvocationMode::Mutation
            } else {
                IbexInvocationMode::Query
            },
            function_name: String::new(),
            elevated_database_allowed,
            protected_query_profile: false,
            authority_cursor: None,
            query_cursor: None,
            generated_authority_operation: None,
            declared_refusals: Vec::new(),
            tracked_refusals: Vec::new(),
            declared_sequences: Vec::new(),
            writes: Vec::new(),
            sequence_allocations: Vec::new(),
            job_enqueues: Vec::new(),
            asset_admissions: Vec::new(),
            asset_grant_ops: Vec::new(),
            asset_mutation_id: None,
            membership_commands: Vec::new(),
            membership_writer,
            reads,
            read_keys,
            media_entries: BTreeMap::new(),
            media_handoff: None,
            next_media_entry: 1,
            now_ms,
            action_run: None,
            action_host: None,
            epoch: next_invocation_epoch()?,
            pinned_snapshot,
            grants: Value::Null,
            recorded_ids: Vec::new(),
            replay,
            terminal_denial: None,
            stream_refusal: None,
            host_failure_witness: None,
            denial_witness: None,
        })
    }

    #[cfg(test)]
    fn new_action(
        input: HandlerInput,
        run: CronRunMetadata,
        host: &'a mut dyn IbexActionHost,
        grants: Value,
    ) -> SnapbackResult<Self> {
        let projection = HandlerAuthProjection::from_authority(
            &ResolvedAppAuthority::dev_from_auth(&input.auth),
            None,
        )?;
        Self::new_action_with_projection(
            input,
            projection,
            AdmissionLease::unmanaged(0, 0),
            run,
            host,
            grants,
        )
    }

    fn new_action_with_projection(
        input: HandlerInput,
        handler_auth: HandlerAuthProjection,
        admission: AdmissionLease,
        run: CronRunMetadata,
        host: &'a mut dyn IbexActionHost,
        grants: Value,
    ) -> SnapbackResult<Self> {
        let reads = auth_dependencies(&input);
        let read_keys = read_dependency_keys(&reads);
        Ok(Self {
            db: None,
            input,
            handler_auth,
            rehearsal_provenance: None,
            admission,
            mode: IbexInvocationMode::Action,
            function_name: String::new(),
            elevated_database_allowed: false,
            protected_query_profile: false,
            authority_cursor: None,
            query_cursor: None,
            generated_authority_operation: None,
            declared_refusals: Vec::new(),
            tracked_refusals: Vec::new(),
            declared_sequences: Vec::new(),
            writes: Vec::new(),
            sequence_allocations: Vec::new(),
            job_enqueues: Vec::new(),
            asset_admissions: Vec::new(),
            asset_grant_ops: Vec::new(),
            asset_mutation_id: None,
            membership_commands: Vec::new(),
            membership_writer: MembershipWriter::System,
            reads,
            read_keys,
            media_entries: BTreeMap::new(),
            media_handoff: None,
            next_media_entry: 1,
            now_ms: run.due_at_ms,
            action_run: Some(run),
            action_host: Some(host),
            epoch: next_invocation_epoch()?,
            pinned_snapshot: 0,
            grants,
            recorded_ids: Vec::new(),
            replay: None,
            terminal_denial: None,
            stream_refusal: None,
            host_failure_witness: None,
            denial_witness: None,
        })
    }

    /// Take the recorded ctx-answer ledger (LLP 0051 D1) after the handler
    /// settles. Replay mode echoes the consumed ledger (minus the
    /// server-retained fingerprint); record mode packages what was answered.
    /// The `auth_fingerprint` is deliberately left unset — that channel is
    /// server-retained per the D1 wire split; producers that retain it attach
    /// it themselves.
    pub(crate) fn take_ctx_ledger(&mut self) -> SnapbackResult<crate::manifest::CtxAnswerLedger> {
        if let Some(replay) = self.replay.as_ref()
            && replay.cursor != replay.ids.len()
        {
            return Err(SnapbackError::error(
                "SNAPBACK_CTX_LEDGER_UNUSED_IDS",
                "runtime",
                format!(
                    "replay consumed {} of {} ledgered ids; the handler diverged from its recording",
                    replay.cursor,
                    replay.ids.len()
                ),
            ));
        }
        Ok(crate::manifest::CtxAnswerLedger {
            version: crate::manifest::CTX_ANSWER_LEDGER_VERSION,
            ids: match &self.replay {
                Some(replay) => replay.ids.clone(),
                None => std::mem::take(&mut self.recorded_ids),
            },
            now: self.now_ms,
            auth_fingerprint: None,
        })
    }

    fn deproject_media_document(&self, table: &str, document: &mut Value) -> SnapbackResult<()> {
        let Some(table) = self.db().schema().table(table) else {
            return Ok(());
        };
        let Some(object) = document.as_object_mut() else {
            return Ok(());
        };
        for field in &table.fields {
            if !matches!(
                field.field_type,
                crate::manifest::FieldType::AssetRef { media: Some(_), .. }
            ) {
                continue;
            }
            let Some(value) = object.get_mut(&field.name) else {
                continue;
            };
            if let Some(asset_id) = value.get("assetId").and_then(Value::as_str) {
                *value = Value::String(asset_id.to_owned());
            }
        }
        Ok(())
    }

    fn tag_media_document(&mut self, table_name: &str, document: &mut Value) -> SnapbackResult<()> {
        self.db().project_media_document(table_name, document)?;
        let snapshot_version = self.db().current_version()?;
        let table = self
            .db()
            .schema()
            .table(table_name)
            .cloned()
            .ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_MEDIA_PROJECTION_INTEGRITY",
                    "assets",
                    "media projection source table is unavailable",
                )
            })?;
        let object = document
            .as_object_mut()
            .ok_or_else(crate::assets::media_projection_integrity)?;
        let source_row_id = object
            .get("_id")
            .and_then(Value::as_str)
            .ok_or_else(crate::assets::media_projection_integrity)?
            .to_owned();
        let mut captured = Vec::new();
        for field in &table.fields {
            let crate::manifest::FieldType::AssetRef {
                media: Some(media), ..
            } = &field.field_type
            else {
                continue;
            };
            let Some(value) = object.get_mut(&field.name) else {
                return Err(crate::assets::media_projection_integrity());
            };
            if value.is_null() {
                continue;
            }
            let media_ref = value
                .as_object_mut()
                .ok_or_else(crate::assets::media_projection_integrity)?;
            let asset_id = media_ref
                .get("assetId")
                .and_then(Value::as_str)
                .ok_or_else(crate::assets::media_projection_integrity)?
                .to_owned();
            let kind: crate::contract_types::MediaKindV1 = media_ref
                .get("kind")
                .cloned()
                .map(serde_json::from_value)
                .transpose()
                .map_err(|_| crate::assets::media_projection_integrity())?
                .ok_or_else(crate::assets::media_projection_integrity)?;
            let related_fact_digest =
                crate::storage::media_projection_fact_digest_on(self.db().conn(), &asset_id)?;
            let entry = self.next_media_entry;
            self.next_media_entry = entry.checked_add(1).ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_MEDIA_PROJECTION_TOKEN_EXHAUSTED",
                    "assets",
                    "media projection token space is exhausted",
                )
            })?;
            let mut digest = Sha256::new();
            digest.update(b"snapback:media-provenance-token:v1\n");
            digest.update(media_process_epoch().as_bytes());
            digest.update(self.epoch.to_be_bytes());
            digest.update(entry.to_be_bytes());
            let token = format!("smp1.{:x}", digest.finalize());
            media_ref.insert(
                "__snapbackMediaProvenanceV1".to_owned(),
                Value::String(token.clone()),
            );
            let provenance = (
                token,
                MediaProvenanceEntryV1 {
                    source_table: table.name.clone(),
                    source_field: field.name.clone(),
                    source_field_generation: crate::manifest::media_source_field_generation(
                        &table.name,
                        field,
                        media,
                    ),
                    source_row_id: source_row_id.clone(),
                    asset_id: asset_id.clone(),
                    kind,
                    snapshot_version,
                    related_fact_digest: related_fact_digest.clone(),
                },
            );
            let dependency = CapturedReadDependency {
                kind: CapturedReadKind::Permission,
                table: Some(crate::assets::ASSET_RECORDS_TABLE.to_owned()),
                id: Some(asset_id),
                version: Some(snapshot_version),
                predicate: None,
                rows: Vec::new(),
                field: Some(crate::storage::MEDIA_PROJECTION_DEPENDENCY_FIELD_V1.to_owned()),
                value: Some(Value::String(related_fact_digest)),
                order: None,
                limit: None,
                result_count: None,
                boundary: None,
            };
            captured.push((provenance, dependency));
        }
        for ((token, provenance), dependency) in captured {
            self.media_entries.insert(token, provenance);
            self.push_read_dependency(dependency);
        }
        Ok(())
    }

    fn normalize_media_result(
        &mut self,
        value: &mut Value,
        prepared: &PreparedInvocation,
    ) -> SnapbackResult<Option<MediaProjectionStagingV1>> {
        let contract = prepared.result_contract();
        let plan = media_projection_plan(contract);
        if plan.occurrences.is_empty() {
            return Ok(None);
        }
        let handoff = self.media_handoff.take().ok_or_else(media_unprovenanced)?;
        let handoff = handoff
            .into_iter()
            .map(|occurrence| (occurrence.path, occurrence.token))
            .collect::<BTreeMap<_, _>>();
        let mut proof = Vec::new();
        normalize_media_contract_value(
            contract,
            value,
            &mut Vec::new(),
            &handoff,
            &self.media_entries,
            &mut proof,
        )?;
        let scope = MediaProjectionInvocationScopeV1 {
            process_epoch: media_process_epoch().to_owned(),
            invocation_nonce: self.epoch,
            pinned_snapshot: self.pinned_snapshot,
        };
        let binding = media_projection_proof_binding(prepared, &self.input, &scope)?;
        Ok(Some(MediaProjectionStagingV1 {
            proof: StagedMediaProjectionProofV1::new(
                plan,
                binding.result_contract_hash.clone(),
                binding,
                proof,
            ),
            scope,
        }))
    }

    /// The single host id source for the deterministic tier (LLP 0051 D1):
    /// `ctx.runtime.id()` and `ctx.db.insert` row-id generation both answer
    /// through here, so record and replay cover every host-generated id in
    /// one ordered `generatedIds` sequence (LLP 0008's wire pin). Actions
    /// bypass the ledger — they are outside the deterministic tier.
    fn next_host_id(&mut self) -> SnapbackResult<String> {
        self.next_host_id_for(crate::ids::Kind::Opaque)
    }

    fn next_host_id_for(&mut self, kind: crate::ids::Kind) -> SnapbackResult<String> {
        if self.mode == IbexInvocationMode::Action {
            return Ok(crate::ids::mint_time_ordered(kind));
        }
        if let Some(replay) = self.replay.as_mut() {
            let id = replay.ids.get(replay.cursor).cloned().ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_CTX_LEDGER_EXHAUSTED",
                    "runtime",
                    format!(
                        "replay consumed all {} ledgered ids and the handler asked for another — \
                         the handler diverged from its recording (LLP 0051 D1; dropped and marked \
                         failed, mirroring LLP 0043)",
                        replay.ids.len()
                    ),
                )
            })?;
            replay.cursor += 1;
            if !crate::ids::looks_like(kind, &id) {
                return Err(SnapbackError::error(
                    "SNAPBACK_CTX_LEDGER_ID_KIND_MISMATCH",
                    "runtime",
                    "replayed host id has the wrong registered kind for this call",
                ));
            }
            return Ok(id);
        }
        if self.recorded_ids.len() >= crate::manifest::CTX_ANSWER_LEDGER_MAX_IDS {
            // Declared LLP 0047-style limit row: the cap turns an
            // id-generation loop into a typed error, not an unbounded artifact.
            return Err(SnapbackError::error(
                "SNAPBACK_CTX_LEDGER_LIMIT_EXCEEDED",
                "runtime",
                format!(
                    "invocation generated more than {} host ids (LLP 0051 D1 ledger cap)",
                    crate::manifest::CTX_ANSWER_LEDGER_MAX_IDS
                ),
            ));
        }
        let id = crate::ids::mint_time_ordered(kind);
        self.recorded_ids.push(id.clone());
        Ok(id)
    }

    fn grant_mutation_id(&mut self) -> SnapbackResult<String> {
        if let Some(id) = &self.asset_mutation_id {
            return Ok(id.clone());
        }
        let id = self.next_host_id_for(crate::ids::Kind::Mutation)?;
        self.asset_mutation_id = Some(id.clone());
        Ok(id)
    }

    fn db(&self) -> &DbRead<'a> {
        self.db
            .as_ref()
            .expect("query/mutation invocation carries a db view")
    }

    fn restricted_table_visibility(&self, table: &str) -> Option<TableVisibilityV1> {
        self.db()
            .schema()
            .table(table)
            .and_then(|table| table.visibility.as_ref())
            .filter(|visibility| visibility.is_restricted())
            .cloned()
    }

    /// Replace any handler-authored visibility data with the installed
    /// schema policy. An exact duplicate is tolerated for wire compatibility,
    /// but a conflicting value is a typed trust-boundary refusal.
    fn compose_declared_table_visibility(&self, plan: &mut QueryPlan) -> SnapbackResult<()> {
        let declared = self
            .db()
            .schema()
            .table(&plan.table)
            .and_then(|table| table.visibility.as_ref())
            .cloned();
        let expected = declared
            .as_ref()
            .filter(|visibility| visibility.is_restricted())
            .cloned();
        if plan.table_visibility.is_some() && plan.table_visibility.as_ref() != declared.as_ref() {
            return Err(SnapbackError::error(
                "SNAPBACK_TABLE_VISIBILITY_PLAN_MISMATCH",
                "auth",
                format!(
                    "ordinary ctx.db.query over {} is caller-scoped and cannot replace the installed table policy; trusted named handlers use ctx.db.elevated.query for an explicit policy bypass",
                    plan.table
                ),
            )
            .with_details(json!({
                "table": plan.table,
                "expected": expected,
                "actual": plan.table_visibility,
            })));
        }
        plan.table_visibility = expected;
        Ok(())
    }

    fn visibility_string_field<'row>(row: &'row Value, field: &str) -> Option<&'row str> {
        match row.get(field) {
            Some(Value::String(value)) => Some(value),
            // Match the SQL lowering: absent, NULL, and non-text values do not
            // satisfy a string/principal comparison. They are never a
            // handler-visible evaluation error (and therefore never an
            // existence oracle for a stored row).
            None | Some(_) => None,
        }
    }

    fn membership_visibility_matches_on(
        db: &DbRead<'_>,
        _input: &HandlerInput,
        principal: &str,
        declaration: &str,
        resource_field: &str,
        roles: &Option<Vec<String>>,
        row: &Value,
    ) -> SnapbackResult<bool> {
        let Some(resource) = Self::visibility_string_field(row, resource_field) else {
            // SQL equality against an absent/NULL outer resource does not
            // satisfy the correlated EXISTS predicate. SQLite also treats a
            // non-text value as non-matching rather than as an error.
            return Ok(false);
        };
        let Some((membership_table, membership)) =
            crate::membership_rules::find_declaration(db.schema(), declaration)
        else {
            return Err(SnapbackError::error(
                "SNAPBACK_MEMBERSHIP_UNKNOWN_DECLARATION",
                "auth",
                format!(
                    "table visibility names declaration {declaration:?}, which is not installed"
                ),
            ));
        };
        let effective_roles =
            crate::membership_rules::effective_roles(membership, roles.as_deref());
        if effective_roles.is_empty() {
            return Ok(false);
        }
        let outcome = crate::membership_rules::membership_read(
            db,
            membership,
            &membership_table.name,
            principal,
            crate::membership_rules::ResourceBinding::Fixed(Value::String(resource.to_owned())),
            &effective_roles,
        )?;
        // Deliberately discard this probe's dependency here. Every caller
        // captures the policy-bearing point/query plan separately, and
        // `query_dependencies_from_plan` emits the conservative
        // principal-scoped membership dependency from that plan on both
        // outcomes. Keeping both would duplicate the same OCC witness; if the
        // binding ever narrows, this assumption and the capture must change
        // together.
        Ok(outcome.present)
    }

    /// Exact point/overlay evaluation of the schema policy. Membership arms
    /// use the same declaration-bound private storage probe as the correlated
    /// EXISTS lowering; they are never approximated by the live matcher's
    /// row-local `unknown` result. Non-text policy values match the SQL
    /// lowering by evaluating false rather than becoming a visible error.
    fn row_matches_declared_table_visibility_on(
        db: &DbRead<'_>,
        input: &HandlerInput,
        visibility: &TableVisibilityV1,
        row: &Value,
    ) -> SnapbackResult<bool> {
        let Some(principal) = input.auth.user_id.as_deref() else {
            return Ok(false);
        };
        let owner_matches = |field: &str| -> SnapbackResult<bool> {
            Ok(Self::visibility_string_field(row, field) == Some(principal))
        };
        let membership_matches = |declaration: &str,
                                  resource_field: &str,
                                  roles: &Option<Vec<String>>|
         -> SnapbackResult<bool> {
            Self::membership_visibility_matches_on(
                db,
                input,
                principal,
                declaration,
                resource_field,
                roles,
                row,
            )
        };

        match visibility {
            // All callers source policies through `restricted_table_visibility`
            // or a plan whose public policy was normalized away. Fail closed
            // if a future caller violates that invariant.
            TableVisibilityV1::PublicRead => Ok(false),
            TableVisibilityV1::Owner { field } => owner_matches(field),
            TableVisibilityV1::Membership {
                declaration,
                resource_field,
                roles,
            } => membership_matches(declaration, resource_field, roles),
            TableVisibilityV1::AnyOf { arms } => {
                for arm in arms {
                    let matches = match arm {
                        TableVisibilityArmV1::Owner { field } => owner_matches(field)?,
                        TableVisibilityArmV1::Membership {
                            declaration,
                            resource_field,
                            roles,
                        } => membership_matches(declaration, resource_field, roles)?,
                    };
                    if matches {
                        return Ok(true);
                    }
                }
                Ok(false)
            }
        }
    }

    fn row_matches_declared_table_visibility(
        &self,
        visibility: &TableVisibilityV1,
        row: &Value,
    ) -> SnapbackResult<bool> {
        Self::row_matches_declared_table_visibility_on(self.db(), &self.input, visibility, row)
    }

    fn capture_visibility_point_read(
        &mut self,
        table: &str,
        id: &str,
        visibility: &TableVisibilityV1,
        stored: Option<&Value>,
        storage_visible: bool,
    ) -> SnapbackResult<()> {
        let plan = QueryPlan {
            table: table.to_owned(),
            table_visibility: Some(visibility.clone()),
            filters: vec![FilterExpr {
                field: "_id".to_owned(),
                op: FilterOp::Eq,
                value: ValueExpr::Literal(Value::String(id.to_owned())),
            }],
            membership_filters: Vec::new(),
            order: Vec::new(),
            limit: Some(1),
            indexed_by: None,
        };
        let output = QueryOutput {
            version: self.db().current_version()?,
            rows: if storage_visible {
                stored.cloned().into_iter().collect()
            } else {
                Vec::new()
            },
            cursor: None,
        };
        self.capture_query_read(&plan, &output)
    }

    fn read_table_visibility_point(
        &mut self,
        table: &str,
        id: &str,
    ) -> SnapbackResult<(Option<Value>, Option<TableVisibilityV1>, bool)> {
        let mut stored = self.db().get(table, id)?;
        let visibility = self.restricted_table_visibility(table);
        let storage_visible = match (&visibility, stored.as_ref()) {
            (Some(visibility), Some(row)) => {
                self.row_matches_declared_table_visibility(visibility, row)?
            }
            (Some(_), None) => false,
            (None, _) => true,
        };
        if let Some(visibility) = &visibility {
            self.capture_visibility_point_read(
                table,
                id,
                visibility,
                stored.as_ref(),
                storage_visible,
            )?;
        } else {
            self.capture_point_read(table, id, stored.as_ref())?;
        }
        if let Some(document) = stored.as_mut() {
            self.deproject_media_document(table, document)?;
        }
        Ok((stored, visibility, storage_visible))
    }

    /// Read a point under explicit trusted-handler authority. This bypasses
    /// only the table's row-visibility policy; the row still enters the same
    /// captured-read/OCC and media-projection paths as an ordinary ctx.db read.
    ///
    /// @ref LLP 0231#d7--handler-reads-are-scoped-unless-the-call-site-is-explicitly-elevated
    fn read_elevated_point(
        &mut self,
        table: &str,
        id: &str,
    ) -> SnapbackResult<(Option<Value>, Option<TableVisibilityV1>, bool)> {
        let mut stored = self.db().get(table, id)?;
        self.capture_point_read(table, id, stored.as_ref())?;
        if let Some(document) = stored.as_mut() {
            self.deproject_media_document(table, document)?;
        }
        Ok((stored, None, true))
    }

    fn read_point_with_authority(
        &mut self,
        table: &str,
        id: &str,
        elevated: bool,
    ) -> SnapbackResult<(Option<Value>, Option<TableVisibilityV1>, bool)> {
        if elevated {
            self.read_elevated_point(table, id)
        } else {
            self.read_table_visibility_point(table, id)
        }
    }

    fn effective_point_is_visible_on(
        db: &DbRead<'_>,
        input: &HandlerInput,
        visibility: Option<&TableVisibilityV1>,
        existed_in_storage: bool,
        storage_visible: bool,
        effective: Option<&Value>,
    ) -> SnapbackResult<bool> {
        // Short-circuit before policy evaluation. A hidden stored row and a
        // missing row must be indistinguishable even when buffered state would
        // make policy evaluation fail for the hidden row.
        if !(effective.is_some() && (!existed_in_storage || storage_visible)) {
            return Ok(false);
        }
        match (visibility, effective) {
            (Some(visibility), Some(row)) => {
                Self::row_matches_declared_table_visibility_on(db, input, visibility, row)
            }
            (None, Some(_)) => Ok(true),
            (_, None) => Ok(false),
        }
    }

    fn effective_point_is_visible(
        &self,
        visibility: Option<&TableVisibilityV1>,
        existed_in_storage: bool,
        storage_visible: bool,
        effective: Option<&Value>,
    ) -> SnapbackResult<bool> {
        Self::effective_point_is_visible_on(
            self.db(),
            &self.input,
            visibility,
            existed_in_storage,
            storage_visible,
            effective,
        )
    }

    fn point_read_dependency_on(
        db: &DbRead<'_>,
        table: &str,
        id: &str,
        row: Option<&Value>,
    ) -> SnapbackResult<CapturedReadDependency> {
        if let Some(row) = row {
            Ok(CapturedReadDependency {
                kind: CapturedReadKind::Row,
                table: Some(table.to_owned()),
                id: Some(id.to_owned()),
                version: Some(row_version(row)?),
                predicate: None,
                rows: Vec::new(),
                field: None,
                value: None,
                order: None,
                limit: None,
                result_count: None,
                boundary: None,
            })
        } else {
            Ok(CapturedReadDependency {
                kind: CapturedReadKind::MissingRow,
                table: Some(table.to_owned()),
                id: Some(id.to_owned()),
                version: Some(db.table_change_version(table)?),
                predicate: None,
                rows: Vec::new(),
                field: None,
                value: None,
                order: None,
                limit: None,
                result_count: None,
                boundary: None,
            })
        }
    }

    fn visibility_point_dependencies_on(
        db: &DbRead<'_>,
        input: &HandlerInput,
        table: &str,
        id: &str,
        visibility: &TableVisibilityV1,
        stored: Option<&Value>,
        storage_visible: bool,
    ) -> SnapbackResult<Vec<CapturedReadDependency>> {
        let plan = QueryPlan {
            table: table.to_owned(),
            table_visibility: Some(visibility.clone()),
            filters: vec![FilterExpr {
                field: "_id".to_owned(),
                op: FilterOp::Eq,
                value: ValueExpr::Literal(Value::String(id.to_owned())),
            }],
            membership_filters: Vec::new(),
            order: Vec::new(),
            limit: Some(1),
            indexed_by: None,
        };
        let output = QueryOutput {
            version: db.current_version()?,
            rows: if storage_visible {
                stored.cloned().into_iter().collect()
            } else {
                Vec::new()
            },
            cursor: None,
        };
        query_dependencies_from_plan(&plan, input, &output, db)
    }

    fn unique_key_dependencies_on(
        db: &DbRead<'_>,
        input: &HandlerInput,
        table: &str,
        index: &str,
        fields: &[String],
        key: &Map<String, Value>,
        visibility: Option<&TableVisibilityV1>,
        stored: Option<&Value>,
        storage_visible: bool,
    ) -> SnapbackResult<Vec<CapturedReadDependency>> {
        let plan = QueryPlan {
            table: table.to_owned(),
            table_visibility: visibility.cloned(),
            filters: fields
                .iter()
                .map(|field| FilterExpr {
                    field: field.clone(),
                    op: FilterOp::Eq,
                    value: ValueExpr::Literal(
                        key.get(field)
                            .expect("storage validation proved the complete unique key")
                            .clone(),
                    ),
                })
                .collect(),
            membership_filters: Vec::new(),
            order: Vec::new(),
            limit: Some(1),
            indexed_by: Some(index.to_owned()),
        };
        let output = QueryOutput {
            version: db.current_version()?,
            rows: if storage_visible {
                stored.cloned().into_iter().collect()
            } else {
                Vec::new()
            },
            cursor: None,
        };
        query_dependencies_from_plan(&plan, input, &output, db)
    }

    fn finish_batch_read_response(values: Vec<Option<Value>>) -> SnapbackResult<Value> {
        let output = Value::Array(
            values
                .into_iter()
                .map(|value| value.unwrap_or(Value::Null))
                .collect(),
        );
        let canonical = crate::rqs_contract::jcs(&output).map_err(|_| {
            SnapbackError::error(
                "SNAPBACK_HANDLER_HOST_CALL_SERIALIZE_FAILED",
                "runtime",
                "ctx.db batch-read output could not be canonically serialized",
            )
        })?;
        if canonical.len() > BATCH_READ_MAX_RESPONSE_BYTES {
            return Err(SnapbackError::error(
                "SNAPBACK_BATCH_READ_RESPONSE_BYTES_EXCEEDED",
                "runtime",
                format!(
                    "ctx.db batch-read response exceeds the {BATCH_READ_MAX_RESPONSE_BYTES}-byte canonical response ceiling"
                ),
            )
            .with_details(json!({
                "maxResponseBytes": BATCH_READ_MAX_RESPONSE_BYTES,
                "responseBytes": canonical.len(),
            })));
        }
        Ok(output)
    }

    fn get_many_batch(
        &mut self,
        table: &str,
        ids: &[String],
        elevated: bool,
    ) -> SnapbackResult<Value> {
        let distinct = ids.iter().cloned().collect::<BTreeSet<_>>();
        let distinct_ids = distinct.iter().cloned().collect::<Vec<_>>();
        let visibility = (!elevated)
            .then(|| self.restricted_table_visibility(table))
            .flatten();
        let (resolved, captures) = self.db().with_pinned_read_view(|db| {
            let stored_rows = db.get_many(table, &distinct_ids)?;
            let mut resolved = BTreeMap::new();
            let mut captures = Vec::with_capacity(distinct_ids.len());
            for (id, stored) in distinct_ids.iter().zip(stored_rows.into_iter()) {
                let storage_visible = match (&visibility, stored.as_ref()) {
                    (Some(visibility), Some(row)) => {
                        Self::row_matches_declared_table_visibility_on(
                            &db,
                            &self.input,
                            visibility,
                            row,
                        )?
                    }
                    (Some(_), None) => false,
                    (None, _) => true,
                };
                let dependencies = if let Some(visibility) = &visibility {
                    Self::visibility_point_dependencies_on(
                        &db,
                        &self.input,
                        table,
                        id,
                        visibility,
                        stored.as_ref(),
                        storage_visible,
                    )?
                } else {
                    vec![Self::point_read_dependency_on(
                        &db,
                        table,
                        id,
                        stored.as_ref(),
                    )?]
                };
                let existed_in_storage = stored.is_some();
                let effective = self.apply_buffered_to_point(table, id, stored);
                let visible = Self::effective_point_is_visible_on(
                    &db,
                    &self.input,
                    visibility.as_ref(),
                    existed_in_storage,
                    storage_visible,
                    effective.as_ref(),
                )?;
                resolved.insert(id.clone(), visible.then_some(effective).flatten());
                captures.push((id.clone(), dependencies));
            }
            Ok((resolved, captures))
        })?;
        for (id, dependencies) in captures {
            for dependency in dependencies {
                self.push_read_dependency(dependency);
            }
            notify_captured_point_read(table, &id);
        }
        Self::finish_batch_read_response(
            ids.iter()
                .map(|id| resolved.get(id).cloned().flatten())
                .collect(),
        )
    }

    fn unique_many_batch(
        &mut self,
        table: &str,
        index: &str,
        keys: &[Map<String, Value>],
        elevated: bool,
    ) -> SnapbackResult<Value> {
        let visibility = (!elevated)
            .then(|| self.restricted_table_visibility(table))
            .flatten();
        // @ref LLP 0003#execution-and-write-semantics — a batch lookup in a
        // mutation observes the same buffered-write overlay as one query.
        // @ref LLP 0248#d4-dependency-and-cost-evidence-remain-conservative —
        // capture every touched point in addition to each unique-key range.
        let touched_ids = self.buffered_touched_ids_for(table);
        let (resolved, captures, notify_points) = self.db().with_pinned_read_view(|db| {
            let stored_rows = db.unique_many(table, index, keys)?;
            let table_manifest = db.schema().table(table).expect("storage validated table");
            let index_manifest = table_manifest
                .indexes
                .iter()
                .find(|candidate| candidate.name == index)
                .expect("storage validated index");
            let mut resolved = BTreeMap::new();
            let mut captures = Vec::new();
            let mut notify_points = Vec::new();
            let mut touched_storage = BTreeMap::new();
            for id in &touched_ids {
                let stored = db.get(table, id)?;
                let storage_visible = match (&visibility, stored.as_ref()) {
                    (Some(visibility), Some(row)) => {
                        Self::row_matches_declared_table_visibility_on(
                            &db,
                            &self.input,
                            visibility,
                            row,
                        )?
                    }
                    (Some(_), None) => false,
                    (None, _) => true,
                };
                if let Some(visibility) = &visibility {
                    captures.extend(Self::visibility_point_dependencies_on(
                        &db,
                        &self.input,
                        table,
                        id,
                        visibility,
                        stored.as_ref(),
                        storage_visible,
                    )?);
                } else {
                    captures.push(Self::point_read_dependency_on(
                        &db,
                        table,
                        id,
                        stored.as_ref(),
                    )?);
                    notify_points.push(id.clone());
                }
                touched_storage.insert(id.clone(), (stored, storage_visible));
            }
            for (key, stored) in keys.iter().zip(stored_rows.into_iter()) {
                let identity =
                    crate::rqs_contract::jcs(&Value::Object(key.clone())).map_err(|_| {
                        SnapbackError::error(
                            "SNAPBACK_BATCH_READ_KEY_INVALID",
                            "runtime",
                            "ctx.db.uniqueMany key could not be canonically encoded",
                        )
                    })?;
                if resolved.contains_key(&identity) {
                    continue;
                }
                let storage_visible = match (&visibility, stored.as_ref()) {
                    (Some(visibility), Some(row)) => {
                        Self::row_matches_declared_table_visibility_on(
                            &db,
                            &self.input,
                            visibility,
                            row,
                        )?
                    }
                    (Some(_), None) => false,
                    (None, _) => true,
                };
                let dependencies = Self::unique_key_dependencies_on(
                    &db,
                    &self.input,
                    table,
                    index,
                    &index_manifest.fields,
                    key,
                    visibility.as_ref(),
                    stored.as_ref(),
                    storage_visible,
                )?;
                let key_plan = QueryPlan {
                    table: table.to_owned(),
                    table_visibility: None,
                    filters: index_manifest
                        .fields
                        .iter()
                        .map(|field| FilterExpr {
                            field: field.clone(),
                            op: FilterOp::Eq,
                            value: ValueExpr::Literal(
                                key.get(field)
                                    .expect("storage validation proved the complete unique key")
                                    .clone(),
                            ),
                        })
                        .collect(),
                    membership_filters: Vec::new(),
                    order: Vec::new(),
                    limit: Some(1),
                    indexed_by: Some(index.to_owned()),
                };
                let mut effective_match = None;
                let mut consider = |id: &str,
                                    candidate: Option<Value>,
                                    candidate_storage_visible: bool|
                 -> SnapbackResult<()> {
                    let existed_in_storage = candidate.is_some();
                    let effective = self.apply_buffered_to_point(table, id, candidate);
                    let visible = Self::effective_point_is_visible_on(
                        &db,
                        &self.input,
                        visibility.as_ref(),
                        existed_in_storage,
                        candidate_storage_visible,
                        effective.as_ref(),
                    )?;
                    if visible
                        && effective.as_ref().is_some_and(|row| {
                            row_matches_query_filters(&key_plan, &self.input, row) == Some(true)
                        })
                    {
                        if effective_match.is_some() {
                            return Err(SnapbackError::error(
                                "SNAPBACK_BATCH_READ_UNIQUE_INVARIANT_CORRUPT",
                                "runtime",
                                "ctx.db.uniqueMany overlay produced more than one row for a declared unique key",
                            )
                            .with_details(json!({ "table": table, "index": index })));
                        }
                        effective_match = effective;
                    }
                    Ok(())
                };
                if let Some(stored) = stored.as_ref() {
                    let id = stored
                        .get("_id")
                        .and_then(Value::as_str)
                        .expect("storage point identity is validated");
                    if !touched_storage.contains_key(id) {
                        consider(id, Some(stored.clone()), storage_visible)?;
                    }
                }
                for (id, (candidate, candidate_storage_visible)) in &touched_storage {
                    consider(id, candidate.clone(), *candidate_storage_visible)?;
                }
                resolved.insert(identity, effective_match);
                captures.extend(dependencies);
            }
            Ok((resolved, captures, notify_points))
        })?;
        for dependency in captures {
            self.push_read_dependency(dependency);
        }
        for id in notify_points {
            notify_captured_point_read(table, &id);
        }
        let values = keys
            .iter()
            .map(|key| {
                crate::rqs_contract::jcs(&Value::Object(key.clone()))
                    .ok()
                    .and_then(|identity| resolved.get(&identity).cloned().flatten())
            })
            .collect();
        Self::finish_batch_read_response(values)
    }

    pub(crate) fn epoch(&self) -> u64 {
        self.epoch
    }

    pub(crate) fn input(&self) -> &HandlerInput {
        &self.input
    }

    pub(crate) fn mode_str(&self) -> &'static str {
        match self.mode {
            IbexInvocationMode::Query => "query",
            IbexInvocationMode::Mutation => "mutation",
            IbexInvocationMode::Action => "action",
        }
    }

    /// Count and optionally trace an elevated read only after the host seam
    /// has validated its descriptor and reached a real storage read.
    ///
    /// @ref LLP 0231#d7--handler-reads-are-scoped-unless-the-call-site-is-explicitly-elevated — this observes use of
    ///   the explicit read-policy bypass without assigning a policy verdict.
    fn observe_elevated_read(&self, member: &str, table: &str) {
        let function = if self.function_name.is_empty() {
            "<unbound>"
        } else {
            &self.function_name
        };
        let correlation = RUNTIME_LOG_SINKS.with(|sinks| {
            let sinks = sinks.borrow();
            let Some(sink) = sinks.last() else {
                return None;
            };
            sink.telemetry
                .elevated_read(function, member, sink.correlation.as_deref());
            sink.correlation.clone()
        });
        crate::elevated_read_trace::emit(
            function,
            member,
            table,
            self.mode_str(),
            correlation.as_deref(),
        );
    }

    fn ensure_db_read_available(&self, elevated: bool, op: &str) -> SnapbackResult<()> {
        if self.mode == IbexInvocationMode::Action || (elevated && !self.elevated_database_allowed)
        {
            return Err(action_db_denied(op));
        }
        Ok(())
    }

    fn authority_profile_read_facts(
        &self,
        declaration: &str,
    ) -> SnapbackResult<(
        String,
        crate::manifest::MembershipManifest,
        crate::manifest::AuthorityProfileV1,
    )> {
        let Some((table, membership)) =
            crate::membership_rules::find_declaration(self.db().schema(), declaration)
        else {
            return Err(SnapbackError::error(
                "SNAPBACK_MEMBERSHIP_UNKNOWN_DECLARATION",
                "auth",
                "authority operation names an unknown membership declaration",
            ));
        };
        let Some(profile) = table.authority_profile.as_ref() else {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTHORITY_PROFILE_REQUIRED",
                "auth",
                "authority operation requires an authorityProfile declaration",
            ));
        };
        if profile.id != declaration || profile.membership.declaration != declaration {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTHORITY_PROFILE_INVALID",
                "auth",
                "authority profile identity does not match its membership declaration",
            ));
        }
        Ok((table.name.clone(), membership.clone(), profile.clone()))
    }

    fn admit_authority_roster_caller(
        &mut self,
        scope_id: &str,
        table: &str,
        membership: &crate::manifest::MembershipManifest,
    ) -> SnapbackResult<()> {
        let Some(principal) = self.input.auth.user_id.as_deref().map(str::to_owned) else {
            let denial = crate::membership_rules::role_denial();
            self.terminal_denial = Some(denial.clone());
            return Err(denial);
        };
        let outcome = crate::membership_rules::require_role(
            self.db(),
            membership,
            table,
            &principal,
            crate::membership_rules::ResourceBinding::Fixed(Value::String(scope_id.to_owned())),
            &membership.roles,
        )?;
        let mut dependencies = Vec::new();
        match outcome.finish(|dependency| dependencies.push(dependency)) {
            Ok(()) => {
                for dependency in dependencies {
                    self.push_read_dependency(dependency);
                }
                Ok(())
            }
            Err(error) => {
                for dependency in dependencies {
                    self.push_read_dependency(dependency);
                }
                if error.is_trusted_permission_denial() {
                    self.terminal_denial = Some(error.clone());
                }
                Err(error)
            }
        }
    }

    fn require_generated_authority_operation(
        &self,
        declaration: &str,
        generation: &str,
        expected: crate::manifest::GeneratedAuthorityOperationKindV1,
    ) -> SnapbackResult<()> {
        let valid = self
            .generated_authority_operation
            .as_ref()
            .is_some_and(|identity| {
                identity.id == declaration
                    && identity.generation == generation
                    && identity.operation == expected
            });
        if valid {
            Ok(())
        } else {
            Err(SnapbackError::error(
                "SNAPBACK_MEMBERSHIP_OPERATION_INVALID",
                "runtime",
                "authority marshalling is available only to its codegen-synthesized profile operation",
            ))
        }
    }

    fn authority_cursor_binding(
        &self,
        declaration: &str,
        scope_id: &str,
        membership: &crate::manifest::MembershipManifest,
        profile: &crate::manifest::AuthorityProfileV1,
    ) -> SnapbackResult<String> {
        let authority = self
            .authority_cursor
            .ok_or_else(authority_cursor_mint_unavailable)?;
        let (authorization, data_version_stream) =
            self.db()
                .membership_cursor_custody_snapshot()
                .map_err(|_| authority_cursor_mint_unavailable())?;
        let role_visible = profile
            .roster
            .visible_fields
            .iter()
            .any(|field| field == &membership.role);
        let mut ordering = Vec::new();
        if role_visible {
            ordering.push(membership.role.clone());
        }
        ordering.push(membership.principal.clone());
        ordering.push("_id".to_owned());
        let binding = json!({
            "app": authority.app_id,
            "declaration": declaration,
            "scope": scope_id,
            "ordering": ordering,
            "profileGeneration": profile.generation,
            "authority": {
                "fingerprint": crate::manifest::auth_fingerprint(&self.input.auth),
                "globalAuthorization": authorization,
                "dataVersionStream": data_version_stream,
            },
            "artifact": {
                "schemaHash": authority.schema_hash,
                "functionBundleHash": authority.function_bundle_hash,
                "functionPublicationGeneration": authority.function_publication_generation,
                "targetProfile": authority.target_profile,
            },
        });
        crate::rqs_contract::sha256_identity(&binding)
            .map_err(|_| authority_cursor_mint_unavailable())
    }

    fn authority_list(&mut self, args: Value) -> SnapbackResult<Value> {
        self.ensure_db_read_available(false, "authority.list")?;
        let request: AuthorityRosterHostRequestV1 = serde_json::from_value(args).map_err(|_| {
            SnapbackError::error(
                "SNAPBACK_AUTHORITY_ROSTER_PAGE_INVALID",
                "auth",
                "authority list requires { declaration, scopeId, page? }",
            )
        })?;
        let page = request.page.unwrap_or(AuthorityRosterHostPageV1 {
            after: None,
            limit: authority_roster_default_limit(),
        });
        let (table, membership, profile) =
            self.authority_profile_read_facts(&request.declaration)?;
        // Admission precedes cursor parsing. An outsider therefore receives
        // the same role denial for malformed, stale, missing-scope, and valid
        // cursors and cannot use the continuation parser as an existence
        // oracle.
        self.admit_authority_roster_caller(&request.scope_id, &table, &membership)?;

        let after =
            match page.after {
                None => None,
                Some(token) => {
                    let authority = self.authority_cursor.ok_or_else(authority_cursor_invalid)?;
                    let body = crate::rqs::decode_and_verify_sealed_standard_pattern_cursor(
                        &token,
                        &authority
                            .keyring
                            .read()
                            .unwrap_or_else(|poisoned| poisoned.into_inner()),
                        now_millis(),
                        crate::rqs::RELATIONAL_CURSOR_MAX_AGE_MS,
                    )
                    .map_err(|_| authority_cursor_invalid())?;
                    let binding = self
                        .authority_cursor_binding(
                            &request.declaration,
                            &request.scope_id,
                            &membership,
                            &profile,
                        )
                        .map_err(|_| authority_cursor_invalid())?;
                    if body.app != authority.app_id || body.binding != binding {
                        return Err(authority_cursor_invalid());
                    }
                    let boundary: crate::storage::KeysetAfter =
                        serde_json::from_value(body.boundary)
                            .map_err(|_| authority_cursor_invalid())?;
                    let role_visible = profile
                        .roster
                        .visible_fields
                        .iter()
                        .any(|field| field == &membership.role);
                    let mut expected = Vec::new();
                    if role_visible {
                        expected.push(membership.role.as_str());
                    }
                    expected.push(membership.principal.as_str());
                    if boundary.id.is_empty()
                        || boundary.entries.len() != expected.len()
                        || boundary.entries.iter().zip(expected).any(
                            |((field, value), expected)| {
                                field != expected || value.as_str().is_none()
                            },
                        )
                    {
                        return Err(authority_cursor_invalid());
                    }
                    Some(boundary)
                }
            };
        let outcome = crate::membership_rules::authority_roster_list(
            self.db(),
            &request.declaration,
            self.input.auth.user_id.as_deref(),
            Some(&request.scope_id),
            crate::membership_rules::AuthorityRosterPageRequestV1 {
                limit: page.limit,
                after,
            },
        )?;
        let mut dependencies = Vec::new();
        let roster = outcome.finish(|dependency| dependencies.push(dependency))?;
        for dependency in dependencies {
            self.push_read_dependency(dependency);
        }
        let cursor = match roster.next {
            None => None,
            Some(boundary) => {
                let authority = self
                    .authority_cursor
                    .ok_or_else(authority_cursor_mint_unavailable)?;
                let binding = self.authority_cursor_binding(
                    &request.declaration,
                    &request.scope_id,
                    &membership,
                    &profile,
                )?;
                let (key_id, key) = authority
                    .keyring
                    .read()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .active_current()
                    .ok_or_else(authority_cursor_mint_unavailable)?;
                let body = crate::rqs::StandardPatternCursorBody {
                    app: authority.app_id.to_owned(),
                    binding,
                    boundary: serde_json::to_value(boundary)
                        .map_err(|_| authority_cursor_mint_unavailable())?,
                    issued_at: now_millis(),
                };
                Some(
                    crate::rqs::mint_sealed_standard_pattern_cursor(key.as_ref(), &key_id, &body)
                        .ok_or_else(authority_cursor_mint_unavailable)?,
                )
            }
        };
        self.query_cursor = cursor.clone();
        Ok(json!({ "rows": roster.rows, "cursor": cursor }))
    }

    fn authority_my_role(&mut self, args: Value) -> SnapbackResult<Value> {
        self.ensure_db_read_available(false, "authority.myRole")?;
        let request: AuthorityMyRoleHostRequestV1 = serde_json::from_value(args).map_err(|_| {
            SnapbackError::error(
                "SNAPBACK_HANDLER_HOST_CALL_INVALID",
                "runtime",
                "authority myRole requires { declaration, scopeId }",
            )
        })?;
        self.authority_profile_read_facts(&request.declaration)?;
        let outcome = crate::membership_rules::authority_my_role(
            self.db(),
            &request.declaration,
            self.input.auth.user_id.as_deref(),
            Some(&request.scope_id),
        )?;
        let mut dependencies = Vec::new();
        match outcome.finish(|dependency| dependencies.push(dependency)) {
            Ok(role) => {
                for dependency in dependencies {
                    self.push_read_dependency(dependency);
                }
                serde_json::to_value(role).map_err(|_| {
                    SnapbackError::error(
                        "SNAPBACK_HANDLER_HOST_CALL_SERIALIZE_FAILED",
                        "runtime",
                        "authority myRole response could not be serialized",
                    )
                })
            }
            Err(error) => {
                for dependency in dependencies {
                    self.push_read_dependency(dependency);
                }
                if error.is_trusted_permission_denial() {
                    self.terminal_denial = Some(error.clone());
                }
                Err(error)
            }
        }
    }

    fn handle_host_call(&mut self, op: &str, args: Value) -> SnapbackResult<Value> {
        self.admission.validate("runtime host call")?;
        if self.protected_query_profile {
            match op {
                // Closed v1 allowlist: database reads carry captured witnesses;
                // log has a specified constant null result and cannot affect
                // visibility through mutable output. The membership read backing
                // role evaluation is `DatabaseCaptured` on both outcomes (its
                // snapshot-bound dependency joins the read summary), so it is
                // admitted for protected queries exactly like `db.query`.
                // @ref LLP 0053#agent-auth-protected-query-inputs-amended-2026-07-14-eng-24906
                "db.query"
                | "db.get"
                | "db.getMany"
                | "db.uniqueMany"
                | "db.elevated.query"
                | "db.elevated.get"
                | "db.elevated.getMany"
                | "db.elevated.uniqueMany"
                | "media.handoff"
                | "runtime.log"
                | "authority.list"
                | "authority.myRole"
                | "permissions.allowsRole"
                | "permissions.requireRole"
                | "permissions.deny" => {}
                "runtime.now" => {
                    return Err(protected_host_input_error(
                        "SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY",
                        "RuntimeNow",
                        op,
                    ));
                }
                "runtime.id" => {
                    return Err(protected_host_input_error(
                        "SNAPBACK_AUTH_MUTABLE_INPUT_DENIED",
                        "RuntimeId",
                        op,
                    ));
                }
                // Keep the established query-write diagnostic for the three
                // known database mutation calls. Every other current/future
                // host operation is a denied mutable non-database input until
                // the registry explicitly classifies it.
                "db.insert" | "db.patch" | "db.delete" => {}
                _ => {
                    return Err(protected_host_input_error(
                        "SNAPBACK_AUTH_MUTABLE_INPUT_DENIED",
                        &format!("HostOp:{op}"),
                        op,
                    ));
                }
            }
        }
        if self.mode == IbexInvocationMode::Action {
            self.action_host
                .as_deref_mut()
                .ok_or_else(action_host_missing)?
                .validate_host_call(op)?;
        }
        match op {
            "authority.list" => self.authority_list(args),
            "authority.myRole" => self.authority_my_role(args),
            "media.handoff" => {
                if self.mode == IbexInvocationMode::Action || self.media_handoff.is_some() {
                    return Err(media_unprovenanced());
                }
                let handoff: MediaHandoffV1 =
                    serde_json::from_value(args).map_err(|_| media_unprovenanced())?;
                let mut paths = BTreeSet::new();
                if handoff.occurrences.iter().any(|occurrence| {
                    occurrence.token.is_empty() || !paths.insert(occurrence.path.clone())
                }) {
                    return Err(media_unprovenanced());
                }
                self.media_handoff = Some(handoff.occurrences);
                Ok(Value::Null)
            }
            "db.query" | "db.elevated.query" => {
                let elevated = op == "db.elevated.query";
                self.ensure_db_read_available(
                    elevated,
                    if elevated { "elevated.query" } else { "query" },
                )?;
                let mut plan = serde_json::from_value::<QueryPlan>(
                    args.get("plan").cloned().unwrap_or(Value::Null),
                )
                .map_err(|error| {
                    SnapbackError::error(
                        "SNAPBACK_HANDLER_HOST_CALL_INVALID",
                        "runtime",
                        "ctx.db.query received an invalid query plan",
                    )
                    .with_details(json!({ "error": error.to_string() }))
                })?;
                // The handler plan is untrusted input. Resolve the policy from
                // the installed schema and compose it before *either* execution
                // or capture: an unpolicied captured predicate would claim
                // dependence on rows the caller was never entitled to see.
                //
                // @ref LLP 0231#d1--the-table-is-the-policy-locus-queries-refine
                if elevated {
                    if plan.table_visibility.is_some() {
                        return Err(SnapbackError::error(
                            "SNAPBACK_TABLE_VISIBILITY_PLAN_MISMATCH",
                            "auth",
                            "ctx.db.elevated.query does not accept caller-authored table visibility",
                        )
                        .with_details(json!({ "table": plan.table })));
                    }
                } else {
                    self.compose_declared_table_visibility(&mut plan)?;
                }
                // @ref LLP 0032#phase-2--execution-semantics-honesty — E2: layer
                // this invocation's buffered writes over the storage result so
                // the handler reads its own writes (read-your-writes).
                let mut output = if self.has_buffered_writes_for(&plan.table) {
                    // Overfetch only enough stored candidates to replace every
                    // row this bounded invocation could delete or reorder.
                    // The write ceiling makes this exact top-N merge bounded.
                    let buffered = self
                        .writes
                        .iter()
                        .filter(|write| write.table() == plan.table)
                        .count();
                    let storage_limit = effective_query_limit(&plan)
                        .saturating_add(buffered)
                        .min(QUERY_INTERNAL_OVERFETCH_MAX);
                    let mut storage_output =
                        self.db()
                            .query_with_storage_limit(&plan, &self.input, storage_limit)?;
                    for row in &mut storage_output.rows {
                        self.deproject_media_document(&plan.table, row)?;
                    }
                    // Capture the exact storage range the merge consumes. A
                    // separate declared-limit query (or a later overfetch) can
                    // observe another snapshot and leave the returned rows
                    // without a matching OCC dependency.
                    let mut dependency_plan = plan.clone();
                    dependency_plan.limit = Some(storage_limit);
                    self.capture_query_read(&dependency_plan, &storage_output)?;

                    // Touched ids may sit outside the selected range but still
                    // enter the effective view after buffered patches/inserts.
                    // Read and capture each one before the pure overlay merge.
                    let touched = self
                        .writes
                        .iter()
                        .filter(|write| write.table() == plan.table)
                        .map(|write| write.id().to_owned())
                        .collect::<BTreeSet<_>>();
                    let mut touched_storage = BTreeMap::new();
                    for id in touched {
                        let (stored, _, storage_visible) =
                            self.read_point_with_authority(&plan.table, &id, elevated)?;
                        touched_storage.insert(id, (stored, storage_visible));
                    }
                    QueryOutput {
                        version: storage_output.version,
                        cursor: None,
                        rows: self.merge_buffered_into_query(
                            &plan,
                            storage_output.rows,
                            &touched_storage,
                        )?,
                    }
                } else {
                    let mut output = self.db().query(&plan, &self.input)?;
                    // Storage returns the public same-snapshot projection, but
                    // the handler boundary below must tag that value with
                    // invocation-local provenance. Restore the physical cell
                    // first so `tag_media_document` performs exactly one
                    // projection, matching the buffered-overlay branch.
                    // @ref LLP 0244#d1-one-authoritative-media-result-materialization-cut
                    for row in &mut output.rows {
                        self.deproject_media_document(&plan.table, row)?;
                    }
                    self.capture_query_read(&plan, &output)?;
                    output
                };
                for row in &mut output.rows {
                    self.tag_media_document(&plan.table, row)?;
                }
                if elevated {
                    self.observe_elevated_read("query", &plan.table);
                }
                serde_json::to_value(output).map_err(|error| {
                    SnapbackError::error(
                        "SNAPBACK_HANDLER_HOST_CALL_SERIALIZE_FAILED",
                        "runtime",
                        "ctx.db.query output could not be serialized",
                    )
                    .with_details(json!({ "error": error.to_string() }))
                })
            }
            "db.get" | "db.elevated.get" => {
                let elevated = op == "db.elevated.get";
                self.ensure_db_read_available(
                    elevated,
                    if elevated { "elevated.get" } else { "get" },
                )?;
                let table = required_string(&args, "table")?;
                let id = required_string(&args, "id")?;
                let (stored, visibility, storage_visible) =
                    self.read_point_with_authority(&table, &id, elevated)?;
                if elevated {
                    self.observe_elevated_read("get", &table);
                }
                let existed_in_storage = stored.is_some();
                // E2: read-your-writes — fold buffered writes over the stored
                // row, then re-check the effective row. A previously hidden
                // stored row may not become readable merely because this
                // invocation buffered a patch that changes its policy fields.
                let effective = self.apply_buffered_to_point(&table, &id, stored);
                let visible = self.effective_point_is_visible(
                    visibility.as_ref(),
                    existed_in_storage,
                    storage_visible,
                    effective.as_ref(),
                )?;
                // Invisible and absent are deliberately indistinguishable at
                // the handler boundary; inability to evaluate a malformed
                // policy value remains a typed SNAPBACK_* refusal above.
                //
                // @ref LLP 0231#d3--composed-into-the-plan-sized-by-a-plan-class-model
                if visible {
                    let mut effective = effective.unwrap_or(Value::Null);
                    self.tag_media_document(&table, &mut effective)?;
                    Ok(effective)
                } else {
                    Ok(Value::Null)
                }
            }
            // @ref LLP 0248#d3-one-host-operation-one-authoritative-snapshot
            // — validate the complete descriptor and both request ceilings
            // before the single snapshot-bound storage transition; serialize
            // and enforce the response ceiling before returning any array.
            "db.getMany" | "db.elevated.getMany" => {
                let elevated = op == "db.elevated.getMany";
                self.ensure_db_read_available(
                    elevated,
                    if elevated {
                        "elevated.getMany"
                    } else {
                        "getMany"
                    },
                )?;
                reject_batch_descriptor_extras(&args, &["table", "ids"])?;
                let table = required_batch_string(&args, "table")?;
                let ids = required_batch_ids(&args, "ids")?;
                enforce_batch_read_request_bounds(&args, ids.len())?;
                if ids.is_empty() {
                    return Ok(Value::Array(Vec::new()));
                }
                let output = self.get_many_batch(&table, &ids, elevated)?;
                if elevated {
                    self.observe_elevated_read("getMany", &table);
                }
                Ok(output)
            }
            // @ref LLP 0248#d3-one-host-operation-one-authoritative-snapshot
            "db.uniqueMany" | "db.elevated.uniqueMany" => {
                let elevated = op == "db.elevated.uniqueMany";
                self.ensure_db_read_available(
                    elevated,
                    if elevated {
                        "elevated.uniqueMany"
                    } else {
                        "uniqueMany"
                    },
                )?;
                reject_batch_descriptor_extras(&args, &["table", "index", "keys"])?;
                let table = required_batch_string(&args, "table")?;
                let index = required_batch_string(&args, "index")?;
                let keys = required_batch_keys(&args, "keys")?;
                enforce_batch_read_request_bounds(&args, keys.len())?;
                if keys.is_empty() {
                    return Ok(Value::Array(Vec::new()));
                }
                let output = self.unique_many_batch(&table, &index, &keys, elevated)?;
                if elevated {
                    self.observe_elevated_read("uniqueMany", &table);
                }
                Ok(output)
            }
            "db.insert" => {
                self.ensure_writable("insert")?;
                self.ensure_buffered_write_capacity()?;
                let table = required_string(&args, "table")?;
                self.ensure_permission_backing_write(&table)?;
                let owner_field =
                    self.installed_owner_write_field(&table, GenericTableWriteFormV1::Insert)?;
                let values = required_object(&args, "values")?;
                // @ref LLP 0264#d3-owner-inserts-are-host-stamped — owner
                // provenance is host-only: even a caller value equal to the
                // principal is refused before a write is buffered.
                if let Some(owner_field) = owner_field {
                    if values.contains_key(&owner_field) {
                        return Err(SnapbackError::error(
                            "SNAPBACK_TABLE_WRITE_OWNER_INPUT_REFUSED",
                            "auth",
                            "ctx.db.insert values cannot contain the installed owner field",
                        )
                        .with_details(json!({
                            "table": table,
                            "writeForm": "insert",
                            "ownerField": owner_field,
                        })));
                    }
                    if self.input.auth.user_id.is_none() {
                        return Err(SnapbackError::error(
                            "SNAPBACK_AUTH_USER_MISSING",
                            "auth",
                            "an owner-policy insert requires an effective principal",
                        )
                        .with_details(json!({
                            "table": table,
                            "writeForm": "insert",
                        })));
                    }
                }
                // Row ids are host-generated entropy: they answer through the
                // ctx-answer ledger like `runtime.id` (LLP 0051 D1).
                let id = self.next_host_id()?;
                self.writes.push(BufferedWrite::Insert {
                    table,
                    id: id.clone(),
                    values,
                });
                Ok(Value::String(id))
            }
            "db.patch" => {
                self.ensure_writable("patch")?;
                self.ensure_buffered_write_capacity()?;
                let table = required_string(&args, "table")?;
                self.ensure_permission_backing_write(&table)?;
                let owner_field =
                    self.installed_owner_write_field(&table, GenericTableWriteFormV1::Patch)?;
                let id = required_string(&args, "id")?;
                let values = required_object(&args, "values")?;
                if let Some(owner_field) = owner_field
                    && values.contains_key(&owner_field)
                {
                    return Err(SnapbackError::error(
                        "SNAPBACK_TABLE_WRITE_OWNER_IMMUTABLE",
                        "auth",
                        "generic patches cannot change owner identity",
                    )
                    .with_details(json!({
                        "table": table,
                        "writeForm": "patch",
                        "ownerField": owner_field,
                    })));
                }
                let (stored, visibility, storage_visible) =
                    self.read_table_visibility_point(&table, &id)?;
                let existed_in_storage = stored.is_some();
                // E2: `existed` reflects the effective view — a row buffered-inserted
                // earlier in this handler exists even though it is not yet
                // committed. The app-visible existence bit is a read result,
                // so it follows the same invisible-equals-absent rule.
                let effective = self.apply_buffered_to_point(&table, &id, stored);
                let existed = self.effective_point_is_visible(
                    visibility.as_ref(),
                    existed_in_storage,
                    storage_visible,
                    effective.as_ref(),
                )?;
                // The handler's early result is the same absent/no-effect
                // contract the authoritative transaction rechecks against the
                // old row. It is an optimization and public-result seam, not
                // the authority locus.
                //
                // @ref LLP 0264#d4-update-and-delete-check-the-old-row-transactionally
                if existed {
                    self.writes.push(BufferedWrite::Patch { table, id, values });
                }
                Ok(Value::Bool(existed))
            }
            "db.delete" => {
                self.ensure_writable("delete")?;
                self.ensure_buffered_write_capacity()?;
                let table = required_string(&args, "table")?;
                self.ensure_permission_backing_write(&table)?;
                self.installed_owner_write_field(&table, GenericTableWriteFormV1::Delete)?;
                let id = required_string(&args, "id")?;
                let (stored, visibility, storage_visible) =
                    self.read_table_visibility_point(&table, &id)?;
                let existed_in_storage = stored.is_some();
                let effective = self.apply_buffered_to_point(&table, &id, stored);
                let existed = self.effective_point_is_visible(
                    visibility.as_ref(),
                    existed_in_storage,
                    storage_visible,
                    effective.as_ref(),
                )?;
                // Like patch, this is the early read gate: invisible means
                // absent, so delete is a no-op at the handler boundary. The
                // authoritative commit transaction independently rechecks the
                // old owner before applying the buffered delete.
                if existed {
                    self.writes.push(BufferedWrite::Delete { table, id });
                }
                Ok(Value::Bool(existed))
            }
            // A sequence is a scoped, buffered read-modify-write — never a
            // standalone service call. The scope id is an explicit argument
            // and the scope table/access proof come from the immutable
            // function declaration carried through admission.
            //
            // @ref LLP 0135#12-allocation-surfaces — declared handler surface
            //   with runtime undeclared refusal and same-transaction advance.
            // @ref LLP 0135#17-allocation-authority-and-information-flow —
            //   membership no-reach and missing/inactive scope collapse to one
            //   byte-identical parent-unavailable result.
            // @ref LLP 0128#contract-guardrails-before-choosing-a-substrate
            "sequence.allocate" => {
                self.ensure_writable("sequence.allocate")?;
                if !self.sequence_allocations.is_empty() {
                    return Err(SnapbackError::error(
                        "SNAPBACK_SEQUENCE_DECLARATION_INVALID",
                        "runtime",
                        "sequence_allocation_v1 permits one allocation per invocation",
                    ));
                }
                let counter = required_string(&args, "counter")?;
                let scope_row_id = required_string(&args, "scopeId")?;
                let declaration = self
                    .declared_sequences
                    .iter()
                    .find(|declaration| declaration.name == counter)
                    .cloned()
                    .ok_or_else(|| {
                        SnapbackError::error(
                            "SNAPBACK_SEQUENCE_UNDECLARED",
                            "runtime",
                            "ctx.sequence.allocate names a counter not declared by this function",
                        )
                    })?;

                match &declaration.scope_access {
                    SequenceScopeAccess::Membership {
                        declaration: membership_id,
                        roles,
                    } => {
                        let Some(principal) = self.input.auth.user_id.clone() else {
                            return Err(sequence_parent_unavailable());
                        };
                        let (membership_table, membership) =
                            crate::membership_rules::find_declaration(
                                self.db().schema(),
                                membership_id,
                            )
                            .map(|(table, membership)| (table.name.clone(), membership.clone()))
                            .ok_or_else(sequence_parent_unavailable)?;
                        let outcome = crate::membership_rules::membership_read(
                            self.db(),
                            &membership,
                            &membership_table,
                            &principal,
                            crate::membership_rules::ResourceBinding::Fixed(Value::String(
                                scope_row_id.clone(),
                            )),
                            roles,
                        )?;
                        self.push_read_dependency(outcome.dependency);
                        if !outcome.present {
                            return Err(sequence_parent_unavailable());
                        }
                    }
                    SequenceScopeAccess::Public(profile) if profile == "public.v1" => {}
                    SequenceScopeAccess::ExistingOwner(_) | SequenceScopeAccess::Public(_) => {
                        return Err(SnapbackError::error(
                            "SNAPBACK_SEQUENCE_DECLARATION_INVALID",
                            "runtime",
                            "ctx.sequence.allocate received a non-handler sequence access profile",
                        ));
                    }
                }

                let (stored, _, storage_visible) =
                    self.read_table_visibility_point(&declaration.scope_table, &scope_row_id)?;
                let incarnation = self
                    .db()
                    .active_relation_incarnation(&declaration.scope_table, &scope_row_id)?;
                if !storage_visible || stored.is_none() || incarnation.is_none() {
                    return Err(sequence_parent_unavailable());
                }
                let incarnation = incarnation.expect("checked above");
                let value = self.db().sequence_next_value(
                    &counter,
                    &declaration.scope_table,
                    &scope_row_id,
                    &incarnation,
                )?;
                if value > SEQUENCE_MAX_SAFE_INTEGER {
                    return Err(SnapbackError::error(
                        "SNAPBACK_SEQUENCE_EXHAUSTED",
                        "runtime",
                        "sequence counter has exhausted the JavaScript-safe integer domain",
                    ));
                }
                let allocation = SequenceAllocationFact {
                    counter,
                    scope_table: declaration.scope_table,
                    scope_row_id,
                    scope_incarnation: incarnation,
                    value,
                };
                validate_sequence_allocation_fact(&allocation)?;
                self.sequence_allocations.push(allocation);
                Ok(Value::Number(value.into()))
            }
            // Transactional one-off enqueue (LLP 0070 first slice). Mutations
            // only: queries cannot enqueue, and actions enqueue only through
            // an explicit mutation (LLP 0004's rule that actions and database
            // commits are not one transaction). The enqueue is buffered like
            // a write and inserted inside the mutation's commit transaction,
            // so a rollback leaves no job.
            // @ref LLP 0070#job-identity-and-enqueue — validation here plus
            //   callee admission at staging plus insertion in the commit
            //   transaction; the job id answers through the ctx-answer
            //   ledger so job identity is replay-stable (LLP 0051 D1).
            "jobs.enqueue" => {
                match self.mode {
                    IbexInvocationMode::Mutation => {}
                    IbexInvocationMode::Query => {
                        return Err(SnapbackError::error(
                            "SNAPBACK_JOB_ENQUEUE_UNAVAILABLE",
                            "jobs",
                            "queries cannot enqueue durable work",
                        ));
                    }
                    IbexInvocationMode::Action => {
                        return Err(SnapbackError::error(
                            "SNAPBACK_JOB_ENQUEUE_UNAVAILABLE",
                            "jobs",
                            "actions enqueue follow-up work only through an explicit mutation",
                        ));
                    }
                }
                if self.job_enqueues.len() >= crate::jobs::JOBS_MAX_ENQUEUES_PER_MUTATION {
                    return Err(SnapbackError::error(
                        "SNAPBACK_JOB_ENQUEUE_LIMIT_EXCEEDED",
                        "jobs",
                        format!(
                            "one mutation may enqueue at most {} jobs in the paved v1 profile",
                            crate::jobs::JOBS_MAX_ENQUEUES_PER_MUTATION
                        ),
                    ));
                }
                let action = required_string(&args, "action")?;
                let job_args = args
                    .get("args")
                    .cloned()
                    .unwrap_or(Value::Object(Map::new()));
                if !job_args.is_object() {
                    return Err(SnapbackError::error(
                        "SNAPBACK_JOB_ARGS_INVALID",
                        "jobs",
                        "ctx.jobs.enqueue args must be an object",
                    ));
                }
                let options = args.get("options").cloned().unwrap_or(Value::Null);
                let delay_ms = match options.get("delayMs") {
                    None | Some(Value::Null) => 0,
                    Some(value) => value.as_u64().ok_or_else(|| {
                        SnapbackError::error(
                            "SNAPBACK_JOB_DELAY_INVALID",
                            "jobs",
                            "delayMs must be a non-negative integer of milliseconds",
                        )
                    })?,
                };
                if delay_ms > crate::jobs::JOBS_MAX_DELAY_MS {
                    return Err(SnapbackError::error(
                        "SNAPBACK_JOB_DELAY_INVALID",
                        "jobs",
                        format!(
                            "delayMs exceeds the paved v1 horizon of {} ms",
                            crate::jobs::JOBS_MAX_DELAY_MS
                        ),
                    ));
                }
                // availableAt = now + delay on the frozen invocation clock:
                // the runAfter-equivalent, deterministic under replay because
                // `now_ms` rides the ctx-answer ledger.
                let available_at_ms = self.now_ms.saturating_add(delay_ms);
                crate::manifest::validate_portable_timestamp_millis(available_at_ms)?;
                let max_attempts = match options.get("maxAttempts") {
                    None | Some(Value::Null) => crate::jobs::JOBS_DEFAULT_MAX_ATTEMPTS,
                    Some(value) => {
                        let requested = value.as_u64().unwrap_or(0);
                        if requested < 1
                            || requested > crate::jobs::JOBS_MAX_ATTEMPTS_CEILING as u64
                        {
                            return Err(SnapbackError::error(
                                "SNAPBACK_JOB_ATTEMPT_POLICY_INVALID",
                                "jobs",
                                format!(
                                    "maxAttempts must be an integer between 1 and {} (unlimited retry is invalid)",
                                    crate::jobs::JOBS_MAX_ATTEMPTS_CEILING
                                ),
                            ));
                        }
                        requested as u32
                    }
                };
                let idempotency_key = match options.get("idempotencyKey") {
                    None | Some(Value::Null) => None,
                    Some(Value::String(key)) => {
                        if key.is_empty() || key.len() > crate::jobs::JOBS_MAX_IDEMPOTENCY_KEY_BYTES
                        {
                            return Err(SnapbackError::error(
                                "SNAPBACK_JOB_IDEMPOTENCY_KEY_INVALID",
                                "jobs",
                                format!(
                                    "idempotencyKey must be 1..={} bytes",
                                    crate::jobs::JOBS_MAX_IDEMPOTENCY_KEY_BYTES
                                ),
                            ));
                        }
                        Some(key.clone())
                    }
                    Some(_) => {
                        return Err(SnapbackError::error(
                            "SNAPBACK_JOB_IDEMPOTENCY_KEY_INVALID",
                            "jobs",
                            "idempotencyKey must be a string",
                        ));
                    }
                };
                // @ref LLP 0143#d2-the-send-lane — capture a narrow
                //   producer-principal grant in the mutation, bind it to one
                //   audience reference + dedupe key, and keep it out of job
                //   arguments/application metadata.
                let push_grant = match options.get("pushGrant") {
                    None | Some(Value::Null) => None,
                    Some(value) => {
                        let requested = serde_json::from_value::<
                            crate::push::PushDeferredGrantRequestV1,
                        >(value.clone())
                        .map_err(|_| {
                            SnapbackError::error(
                                "SNAPBACK_JOB_PUSH_GRANT_INVALID",
                                "jobs",
                                "pushGrant must be exactly { to, dedupeKey }",
                            )
                        })?;
                        let principal = self.handler_auth.user_id().ok_or_else(|| {
                            SnapbackError::error(
                                "SNAPBACK_AUTH_PERMISSION_DENIED",
                                "auth",
                                "only an authenticated user mutation can capture a deferred push grant",
                            )
                        })?;
                        let (grant, dependency) = crate::push::capture_deferred_grant(
                            self.db(),
                            principal,
                            &requested.to,
                            &requested.dedupe_key,
                        )?;
                        self.push_read_dependency(dependency);
                        Some(grant)
                    }
                };
                // Canonicalize (and size-check) once here so the digest the
                // reuse paths compare equals what commit will store.
                let (_canonical, digest) = crate::jobs::canonical_args(&job_args)?;
                let (_, push_grant_digest) =
                    crate::jobs::canonical_push_grant(push_grant.as_ref())?;
                let rehearsal_provenance = self.rehearsal_provenance.clone();
                let (_, rehearsal_provenance_digest) =
                    crate::jobs::canonical_rehearsal_provenance(rehearsal_provenance.as_ref())?;
                let queue = crate::jobs::JOBS_DEFAULT_QUEUE.to_owned();
                if let Some(key) = idempotency_key.as_deref() {
                    // Read-your-enqueues: an identical buffered intent under
                    // the same scoped key returns the buffered job.
                    if let Some(buffered) = self.job_enqueues.iter().find(|enqueue| {
                        enqueue.queue == queue
                            && enqueue.action == action
                            && enqueue.idempotency_key.as_deref() == Some(key)
                    }) {
                        let (_, buffered_digest) = crate::jobs::canonical_args(&buffered.args)?;
                        let (_, buffered_grant_digest) =
                            crate::jobs::canonical_push_grant(buffered.push_grant.as_ref())?;
                        let (_, buffered_rehearsal_digest) =
                            crate::jobs::canonical_rehearsal_provenance(
                                buffered.rehearsal_provenance.as_ref(),
                            )?;
                        if buffered_digest == digest
                            && buffered.max_attempts == max_attempts
                            && buffered_grant_digest == push_grant_digest
                            && buffered_rehearsal_digest == rehearsal_provenance_digest
                        {
                            return Ok(json!({
                                "jobId": buffered.job_id,
                                "availableAtMs": buffered.available_at_ms,
                                "deduplicated": true,
                            }));
                        }
                        return Err(crate::jobs::idempotency_key_reused(&queue, &action, key));
                    }
                    // Snapshot lookup: identical existing job → return it.
                    if let Some(existing) = self
                        .db()
                        .find_job_by_scoped_idempotency(&queue, &action, key)?
                    {
                        if existing.args_digest == digest
                            && existing.max_attempts == max_attempts
                            && existing.push_grant_digest == push_grant_digest
                            && existing.rehearsal_provenance_digest == rehearsal_provenance_digest
                        {
                            return Ok(json!({
                                "jobId": existing.job_id,
                                "availableAtMs": existing.available_at_ms,
                                "deduplicated": true,
                            }));
                        }
                        return Err(crate::jobs::idempotency_key_reused(&queue, &action, key));
                    }
                }
                let job_id = self.next_host_id()?;
                self.job_enqueues.push(crate::jobs::BufferedJobEnqueue {
                    job_id: job_id.clone(),
                    queue,
                    action,
                    args: job_args,
                    idempotency_key,
                    max_attempts,
                    available_at_ms,
                    push_grant,
                    rehearsal_provenance,
                });
                Ok(json!({
                    "jobId": job_id,
                    "availableAtMs": available_at_ms,
                    "deduplicated": false,
                }))
            }
            "assets.attach" => {
                self.ensure_writable("attach")?;
                let asset_id = required_string(&args, "assetId")?;
                if asset_id.is_empty() {
                    return Err(SnapbackError::error(
                        "SNAPBACK_HANDLER_HOST_CALL_INVALID",
                        "runtime",
                        "ctx.assets.attach requires a non-empty asset id",
                    ));
                }
                let upload = args
                    .get("upload")
                    .and_then(Value::as_str)
                    .filter(|upload| !upload.is_empty())
                    .map(str::to_owned);
                // Record-only: the commit boundary is the authority (LLP 0044
                // v6.1) — it re-verifies owner, intent, availability, and
                // generation inside the final write lock, so a delete racing
                // this admission refuses at commit rather than here.
                self.asset_admissions
                    .push(crate::assets::AssetAttachmentAdmission {
                        asset_id: asset_id.clone(),
                        upload,
                    });
                Ok(Value::String(asset_id))
            }
            "assets.grant" => {
                // @ref LLP 0210#d5--recipient-scoped-authority-recipe-now-grant-ops-as-the-paved-spelling —
                // handler calls stage deterministic grant identities; storage
                // owns authority and revalidates at the final write lock.
                self.ensure_writable("grant")?;
                let asset_id = required_string(&args, "assetId")?;
                let principal = required_string(&args, "principal")?;
                let state = match required_string(&args, "state")?.as_str() {
                    "pending" => crate::assets::AssetGrantState::Pending,
                    "active" => crate::assets::AssetGrantState::Active,
                    _ => {
                        let error = SnapbackError::error(
                            "SNAPBACK_ASSET_GRANT_INPUT_INVALID",
                            "assets",
                            "ctx.assets.grant state must be pending or active",
                        );
                        self.terminal_denial = Some(error.clone());
                        return Err(error);
                    }
                };
                let grant_id = self.next_host_id_for(crate::ids::Kind::AssetGrant)?;
                let mutation = self.grant_mutation_id()?;
                let proposed = crate::assets::BufferedAssetGrantOp::Grant {
                    grant_id: grant_id.clone(),
                    asset_id,
                    principal,
                    state,
                    mutation,
                    at_ms: self.now_ms,
                };
                let caller = match self.input.auth.user_id.clone() {
                    Some(caller) => caller,
                    None => {
                        let error = SnapbackError::error(
                            "SNAPBACK_ASSET_GRANT_FORBIDDEN",
                            "assets",
                            "asset grant operations require an authenticated principal",
                        );
                        self.terminal_denial = Some(error.clone());
                        return Err(error);
                    }
                };
                if let Err(error) = crate::storage::asset_grants::preview(
                    self.db().conn(),
                    &caller,
                    &self.asset_grant_ops,
                    &proposed,
                ) {
                    self.terminal_denial = Some(error.clone());
                    return Err(error);
                }
                self.asset_grant_ops.push(proposed);
                Ok(json!({ "grantId": grant_id }))
            }
            "assets.activate" | "assets.revoke" => {
                let operation = if op == "assets.activate" {
                    "activate"
                } else {
                    "revoke"
                };
                self.ensure_writable(operation)?;
                let grant_id = required_string(&args, "grantId")?;
                let proposed = if op == "assets.activate" {
                    crate::assets::BufferedAssetGrantOp::Activate {
                        grant_id,
                        at_ms: self.now_ms,
                    }
                } else {
                    crate::assets::BufferedAssetGrantOp::Revoke {
                        grant_id,
                        at_ms: self.now_ms,
                    }
                };
                let caller = match self.input.auth.user_id.clone() {
                    Some(caller) => caller,
                    None => {
                        let error = SnapbackError::error(
                            "SNAPBACK_ASSET_GRANT_FORBIDDEN",
                            "assets",
                            "asset grant operations require an authenticated principal",
                        );
                        self.terminal_denial = Some(error.clone());
                        return Err(error);
                    }
                };
                if let Err(error) = crate::storage::asset_grants::preview(
                    self.db().conn(),
                    &caller,
                    &self.asset_grant_ops,
                    &proposed,
                ) {
                    self.terminal_denial = Some(error.clone());
                    return Err(error);
                }
                self.asset_grant_ops.push(proposed);
                Ok(Value::Null)
            }
            // Declaration-bound membership authoring. The JS helper supplies a
            // stable declaration id and operation arguments; the host resolves
            // the table and attaches the immutable writer derived from the
            // prepared invocation. Raw `ctx.db` writes never enter this lane.
            // @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default
            "membership.write" => {
                self.ensure_writable("membership")?;
                self.ensure_buffered_write_capacity()?;
                // Each planner authorizes against one immutable snapshot. Until
                // sequential read-your-membership-writes planning lands, refuse
                // a second command instead of letting two individually valid
                // transitions compose into an undeclared authority escalation.
                if !self.membership_commands.is_empty() {
                    return Err(SnapbackError::error(
                        "SNAPBACK_MEMBERSHIP_BATCH_UNSUPPORTED",
                        "runtime",
                        "v1 permits one generated membership command per mutation; use bootstrap(resourceValues, initialMembers) for an atomic initial roster",
                    ));
                }
                let declaration = required_string(&args, "declaration")?;
                let operation = required_string(&args, "operation")?;
                let initial_members = if operation == "bootstrap" {
                    match args.get("initialMembers") {
                        None => Vec::new(),
                        Some(Value::Array(values))
                            if values.len()
                                <= crate::storage::MEMBERSHIP_BOOTSTRAP_MAX_INITIAL_MEMBERS =>
                        {
                            values
                                .iter()
                                .map(|value| {
                                    value.as_object().cloned().ok_or_else(|| {
                                        SnapbackError::error(
                                            "SNAPBACK_MEMBERSHIP_BOOTSTRAP_INITIAL_MEMBERS_INVALID",
                                            "runtime",
                                            "bootstrap initialMembers must contain only objects",
                                        )
                                    })
                                })
                                .collect::<SnapbackResult<Vec<_>>>()?
                        }
                        Some(Value::Array(_)) => {
                            return Err(SnapbackError::error(
                                "SNAPBACK_MEMBERSHIP_BOOTSTRAP_INITIAL_MEMBERS_INVALID",
                                "runtime",
                                format!(
                                    "bootstrap accepts at most {} initial members",
                                    crate::storage::MEMBERSHIP_BOOTSTRAP_MAX_INITIAL_MEMBERS
                                ),
                            ));
                        }
                        Some(_) => {
                            return Err(SnapbackError::error(
                                "SNAPBACK_MEMBERSHIP_BOOTSTRAP_INITIAL_MEMBERS_INVALID",
                                "runtime",
                                "bootstrap initialMembers must be an array",
                            ));
                        }
                    }
                } else {
                    Vec::new()
                };
                let table_manifest = crate::membership_rules::find_declaration(
                    self.db().schema(),
                    &declaration,
                )
                .map(|(table, _)| table)
                .ok_or_else(|| {
                    SnapbackError::error(
                        "SNAPBACK_MEMBERSHIP_UNKNOWN_DECLARATION",
                        "runtime",
                        format!(
                            "ctx.membership names declaration {declaration:?}, which is not declared"
                        ),
                    )
                })?;
                // Creator-only bootstrap is structurally non-authority-
                // creating: it seats only the host-derived effective principal
                // in the declared bootstrap role. An initial roster names other
                // principals and therefore requires the same exact delegated-
                // agent consent gate as every ordinary membership operation.
                // @ref LLP 0056#agents
                if operation != "bootstrap" || !initial_members.is_empty() {
                    self.ensure_membership_authority_creating(table_manifest)?;
                }
                let table = table_manifest.name.clone();
                let writer = self.membership_writer.clone();
                let (command, result) = match operation.as_str() {
                    "bootstrap" => {
                        let resource_id = self.next_host_id()?;
                        (
                            BufferedMembershipCommand::bootstrap(
                                writer,
                                table,
                                resource_id.clone(),
                                required_object(&args, "values")?,
                                initial_members,
                            ),
                            Value::String(resource_id),
                        )
                    }
                    "insert" => (
                        BufferedMembershipCommand::insert(
                            writer,
                            table,
                            required_object(&args, "values")?,
                        ),
                        Value::Null,
                    ),
                    "setRole" => {
                        if let Some(profile) = table_manifest.authority_profile.as_ref() {
                            self.require_generated_authority_operation(
                                &declaration,
                                &profile.generation,
                                crate::manifest::GeneratedAuthorityOperationKindV1::ChangeRole,
                            )?;
                        }
                        (
                            BufferedMembershipCommand::set_role(
                                writer,
                                table,
                                required_string(&args, "memberId")?,
                                required_string(&args, "role")?,
                            ),
                            Value::Null,
                        )
                    }
                    "remove" => {
                        if let Some(profile) = table_manifest.authority_profile.as_ref() {
                            self.require_generated_authority_operation(
                                &declaration,
                                &profile.generation,
                                crate::manifest::GeneratedAuthorityOperationKindV1::Remove,
                            )?;
                        }
                        (
                            BufferedMembershipCommand::remove(
                                writer,
                                table,
                                required_string(&args, "memberId")?,
                            ),
                            Value::Null,
                        )
                    }
                    "patch" => (
                        BufferedMembershipCommand::patch(
                            writer,
                            table,
                            required_string(&args, "memberId")?,
                            required_object(&args, "values")?,
                        ),
                        Value::Null,
                    ),
                    "setSelfRole" => (
                        BufferedMembershipCommand::set_self_role(
                            writer,
                            table,
                            optional_nullable_string(&args, "resource")?,
                            required_string(&args, "role")?,
                        ),
                        Value::Null,
                    ),
                    "removeSelf" => (
                        BufferedMembershipCommand::remove_self(
                            writer,
                            table,
                            optional_nullable_string(&args, "resource")?,
                        ),
                        Value::Null,
                    ),
                    "patchSelf" => (
                        BufferedMembershipCommand::patch_self(
                            writer,
                            table,
                            optional_nullable_string(&args, "resource")?,
                            required_object(&args, "values")?,
                        ),
                        Value::Null,
                    ),
                    // @ref LLP 0100#3-host-resolution-and-linearization — the
                    // app supplies only (resource, principal); everything else
                    // is host-derived, and the declaration opt-in plus the
                    // full refusal ordering live in the storage planner.
                    "removePrincipal" => (
                        BufferedMembershipCommand::remove_principal(
                            writer,
                            table,
                            optional_nullable_string(&args, "resource")?,
                            required_string(&args, "principal")?,
                        ),
                        Value::Null,
                    ),
                    // @ref LLP 0240#d3-generate-the-ordinary-roster-and-role-surface
                    // — these two spellings marshal public principals to
                    // host-private membership ids. The storage planners own
                    // caller-first admission, target resolution, and the
                    // unchanged transition/owner invariants.
                    "changeRolePrincipal" => {
                        let profile =
                            table_manifest.authority_profile.as_ref().ok_or_else(|| {
                                SnapbackError::error(
                                    "SNAPBACK_AUTHORITY_PROFILE_REQUIRED",
                                    "auth",
                                    "authority changeRole requires an authorityProfile declaration",
                                )
                            })?;
                        self.require_generated_authority_operation(
                            &declaration,
                            &profile.generation,
                            crate::manifest::GeneratedAuthorityOperationKindV1::ChangeRole,
                        )?;
                        (
                            BufferedMembershipCommand::change_role_principal(
                                writer,
                                table,
                                optional_nullable_string(&args, "resource")?,
                                required_string(&args, "principal")?,
                                required_string(&args, "role")?,
                            ),
                            Value::Null,
                        )
                    }
                    "removeAuthorityPrincipal" => {
                        let profile =
                            table_manifest.authority_profile.as_ref().ok_or_else(|| {
                                SnapbackError::error(
                                    "SNAPBACK_AUTHORITY_PROFILE_REQUIRED",
                                    "auth",
                                    "authority remove requires an authorityProfile declaration",
                                )
                            })?;
                        self.require_generated_authority_operation(
                            &declaration,
                            &profile.generation,
                            crate::manifest::GeneratedAuthorityOperationKindV1::Remove,
                        )?;
                        (
                            BufferedMembershipCommand::remove_authority_principal(
                                writer,
                                table,
                                optional_nullable_string(&args, "resource")?,
                                required_string(&args, "principal")?,
                            ),
                            Value::Null,
                        )
                    }
                    // @ref LLP 0240#d1-declare-an-application-authority-profile-at-the-scoped-relation
                    // — owner transfer is one dedicated two-row plan; the
                    // storage planner derives caller/target roles and keeps
                    // ordinary role/remove operations out of the owner state.
                    "transferOwner" => {
                        let profile =
                            table_manifest.authority_profile.as_ref().ok_or_else(|| {
                                SnapbackError::error(
                                    "SNAPBACK_AUTHORITY_PROFILE_REQUIRED",
                                    "auth",
                                    "owner transfer requires an authorityProfile declaration",
                                )
                            })?;
                        self.require_generated_authority_operation(
                            &declaration,
                            &profile.generation,
                            crate::manifest::GeneratedAuthorityOperationKindV1::TransferOwner,
                        )?;
                        (
                            BufferedMembershipCommand::transfer_owner(
                                writer,
                                table,
                                optional_nullable_string(&args, "resource")?,
                                required_string(&args, "principal")?,
                            ),
                            Value::Null,
                        )
                    }
                    _ => {
                        return Err(SnapbackError::error(
                            "SNAPBACK_MEMBERSHIP_OPERATION_INVALID",
                            "runtime",
                            format!("unknown membership helper operation {operation:?}"),
                        ));
                    }
                };
                self.membership_commands.push(command);
                Ok(result)
            }
            "runtime.now" => Ok(json!(self.now_ms)),
            // @ref LLP 0043#handler-visible-settlement-identity-2026-08-08 — the handler
            // observes the exact durable settlement identity that makes a
            // client mutation replay without re-entering application code.
            // This answer is request-derived, not host-generated, so it does
            // not consume or extend LLP 0051 D1's ctx-answer ledger.
            "mutation.settlement" => {
                match self.mode {
                    IbexInvocationMode::Mutation => {}
                    IbexInvocationMode::Query => {
                        return Err(SnapbackError::error(
                            "SNAPBACK_MUTATION_SETTLEMENT_UNAVAILABLE",
                            "runtime",
                            "queries are never queued or settled; only mutations carry a settlement identity",
                        ));
                    }
                    IbexInvocationMode::Action => {
                        return Err(SnapbackError::error(
                            "SNAPBACK_MUTATION_SETTLEMENT_UNAVAILABLE",
                            "runtime",
                            "actions carry no settlement identity; call ctx.runMutation and read ctx.mutation.settlement() inside that mutation",
                        ));
                    }
                }
                Ok(json!({
                    "clientMutationId": self.input.auth.client_mutation_id.as_deref(),
                    "settlementId": self.input.auth.client_mutation_digest.as_deref(),
                }))
            }
            // Diagnostics-routed console (LLP 0048 allowlist slice 1): the
            // routed console shim forwards handler console output here. It is
            // diagnostics, never data — recorded on the host-call trace (both
            // engines route through dispatch_host_call) and optionally echoed
            // to stderr, but the handler-visible result is always null.
            "runtime.log" => {
                let level = args.get("level").and_then(Value::as_str).unwrap_or("log");
                let message = args.get("message").cloned().unwrap_or(Value::Null);
                let message = capture_runtime_log(level, message);
                if handler_console_stderr_enabled() {
                    emit_handler_console_stderr(runtime_log_stderr_line(level, &message));
                }
                Ok(Value::Null)
            }
            // Id generation is storage-independent, so it stays available to
            // actions, whose context carries no db view (ENG-23324). For
            // queries/mutations the answer routes through the ctx-answer
            // ledger (LLP 0051 D1): recorded in record mode, consumed in
            // order in replay mode.
            "runtime.id" => Ok(Value::String(self.next_host_id()?)),
            "action.metadata" => serde_json::to_value(self.action_run.as_ref()).map_err(|error| {
                SnapbackError::error(
                    "SNAPBACK_ACTION_METADATA_SERIALIZE_FAILED",
                    "runtime",
                    "action run metadata could not be serialized",
                )
                .with_details(json!({ "error": error.to_string() }))
            }),
            // Internal two-call handshake around the synchronous native-fetch
            // enqueue. The action host reserves/releases the exact scoped
            // authority permit in `validate_host_call`; these branches expose
            // no application data and exist only so the trusted harness can
            // close begin→initiated without an unknown-op refusal.
            "action.externalEffectBegin" | "action.externalEffectInitiated" => {
                self.ensure_action("externalEffect")?;
                Ok(Value::Null)
            }
            "action.runMutation" => {
                self.ensure_action("runMutation")?;
                let name = required_string(&args, "name")?;
                let mutation_args = args
                    .get("args")
                    .cloned()
                    .unwrap_or(Value::Object(Map::new()));
                let input = HandlerInput {
                    args: mutation_args,
                    auth: self.input.auth.clone(),
                    read_set: Vec::new(),
                    correlation: None,
                    ctx_ledger: None,
                };
                let host = self
                    .action_host
                    .as_deref_mut()
                    .ok_or_else(action_host_missing)?;
                let output = host.run_mutation(&name, input)?;
                Ok(output.result)
            }
            "action.streamOpen" => {
                self.ensure_action("fetchStream")?;
                if !outbound_actions_enabled() {
                    return Err(SnapbackError::error(
                        "SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED",
                        "runtime",
                        "ctx.fetchStream requires the deployment's outbound-actions capability",
                    )
                    .with_details(json!({
                        "operation": "open",
                        "expected": "SNAPBACK_OUTBOUND_ACTIONS=1",
                        "received": "outbound actions disabled",
                        "repair": "guide/backend/actions-and-fetch#stream-a-response",
                    })));
                }
                let request =
                    serde_json::from_value::<ActionStreamRequest>(args).map_err(|_error| {
                        SnapbackError::error(
                            "SNAPBACK_ACTION_STREAM_INVALID",
                            "runtime",
                            "ctx.fetchStream received an invalid request shape",
                        )
                        .with_details(json!({
                            "operation": "open",
                            "expected": "{url, method?, headers?, body?, idempotencyKey?}",
                            "received": "nonconforming request object",
                            "repair": "guide/backend/actions-and-fetch#stream-a-response",
                        }))
                    })?;
                let host = self
                    .action_host
                    .as_deref_mut()
                    .ok_or_else(action_host_missing)?;
                serde_json::to_value(host.open_response_stream(request)?).map_err(|_error| {
                    SnapbackError::error(
                        "SNAPBACK_ACTION_STREAM_INVALID",
                        "runtime",
                        "the bounded response stream metadata could not be serialized",
                    )
                    .with_details(json!({ "operation": "open" }))
                })
            }
            "action.streamRead" => {
                self.ensure_action("fetchStream.read")?;
                let stream_id = required_string(&args, "streamId")?;
                let host = self
                    .action_host
                    .as_deref_mut()
                    .ok_or_else(action_host_missing)?;
                serde_json::to_value(host.read_response_stream(&stream_id)?).map_err(|_error| {
                    SnapbackError::error(
                        "SNAPBACK_ACTION_STREAM_INVALID",
                        "runtime",
                        "the bounded response stream chunk could not be serialized",
                    )
                    .with_details(json!({ "operation": "read" }))
                })
            }
            "action.streamCancel" => {
                self.ensure_action("fetchStream.cancel")?;
                let stream_id = required_string(&args, "streamId")?;
                let host = self
                    .action_host
                    .as_deref_mut()
                    .ok_or_else(action_host_missing)?;
                host.cancel_response_stream(&stream_id)?;
                Ok(Value::Null)
            }
            "action.streamAttemptStart" => {
                self.ensure_action("streamAttempt.start")?;
                let client_key = required_string(&args, "clientKey")?;
                let host = self
                    .action_host
                    .as_deref_mut()
                    .ok_or_else(action_host_missing)?;
                serde_json::to_value(host.start_stream_attempt(&client_key)?).map_err(|_error| {
                    SnapbackError::error(
                        "SNAPBACK_ACTION_STREAM_INVALID",
                        "runtime",
                        "the stream attempt record could not be serialized",
                    )
                    .with_details(json!({ "operation": "attemptStart" }))
                })
            }
            "action.streamAttemptSettle" => {
                self.ensure_action("streamAttempt.settle")?;
                let attempt_token = required_string(&args, "attemptToken")?;
                let cause = required_string(&args, "cause")?;
                let Some(cause) = crate::stream_attempt::StreamAttemptCause::parse(&cause) else {
                    return Err(SnapbackError::error(
                        "SNAPBACK_ACTION_STREAM_INVALID",
                        "runtime",
                        "stream attempt settlement requires one of the five terminal causes",
                    )
                    .with_details(json!({
                        "operation": "settle",
                        "expected": "complete|failed|cancelled|timed_out|ambiguous",
                        "received": "unknown cause",
                        "repair": "guide/backend/actions-and-fetch#stream-a-response",
                    })));
                };
                let host = self
                    .action_host
                    .as_deref_mut()
                    .ok_or_else(action_host_missing)?;
                serde_json::to_value(host.settle_stream_attempt(&attempt_token, cause)?).map_err(
                    |_error| {
                        SnapbackError::error(
                            "SNAPBACK_ACTION_STREAM_INVALID",
                            "runtime",
                            "the stream attempt terminal record could not be serialized",
                        )
                        .with_details(json!({ "operation": "settle" }))
                    },
                )
            }
            "action.streamEmit" => {
                self.ensure_action("stream.emit")?;
                let chunk = args.get("chunk").cloned().ok_or_else(|| {
                    SnapbackError::error(
                        "SNAPBACK_STREAM_CHUNK_INVALID",
                        "runtime",
                        "ctx.stream.emit requires a string or JSON chunk",
                    )
                })?;
                if !(chunk.is_string()
                    || chunk.is_object()
                    || chunk.is_array()
                    || chunk.is_number()
                    || chunk.is_boolean()
                    || chunk.is_null())
                {
                    return Err(SnapbackError::error(
                        "SNAPBACK_STREAM_CHUNK_INVALID",
                        "runtime",
                        "ctx.stream.emit requires a string or JSON chunk",
                    ));
                }
                let host = self
                    .action_host
                    .as_deref_mut()
                    .ok_or_else(action_host_missing)?;
                serde_json::to_value(host.emit_stream_chunk(chunk)?).map_err(|error| {
                    SnapbackError::error(
                        "SNAPBACK_STREAM_CHUNK_INVALID",
                        "runtime",
                        "the stream emission receipt could not be serialized",
                    )
                    .with_details(json!({ "error": error.to_string() }))
                })
            }
            // @ref LLP 0240#d4-custom-function-mediated-authority-has-an-honest-declaration
            // — a false generated custom evaluator reaches the same branded
            // terminal denial as the role gate; the handler cannot catch it
            // and proceed because terminal state is retained out of band.
            "permissions.deny" => {
                if self.mode == IbexInvocationMode::Action {
                    return Err(SnapbackError::error(
                        "SNAPBACK_PERMISSIONS_UNAVAILABLE_IN_ACTION",
                        "runtime",
                        "ctx.permissions does not exist in actions",
                    ));
                }
                let denial = crate::membership_rules::role_denial();
                self.terminal_denial = Some(denial.clone());
                Err(denial)
            }
            // @ref LLP 0240#d2-compile-one-authority-ir-for-read-and-write-decisions
            // — declaration-bound role evaluation uses the shared authority IR.
            // The imperative twins are decomposed so LLP 0053's one-class-per-op
            // rule holds exactly: the membership read (DatabaseCaptured, both
            // outcomes) captured into the read set, then — on a failed check —
            // the existing TerminalAuthorization deny (`role_denial`).
            "permissions.allowsRole" | "permissions.requireRole" => {
                let terminal = op == "permissions.requireRole";
                // `ctx.permissions` does not exist in actions — no transactional
                // read set, so no capture. Typed refusal.
                // @ref LLP 0056#non-goals — `ctx.permissions` in actions refused.
                if self.mode == IbexInvocationMode::Action {
                    return Err(SnapbackError::error(
                        "SNAPBACK_PERMISSIONS_UNAVAILABLE_IN_ACTION",
                        "runtime",
                        "ctx.permissions does not exist in actions (no transactional read set to capture into)",
                    ));
                }
                let declaration = required_string(&args, "declaration")?;
                let resource_arg = args.get("resource").cloned().unwrap_or(Value::Null);
                // This is an authorization boundary, so malformed role values
                // may never be silently discarded. In particular `[undefined]`
                // crosses the JS/JSON bridge as `[null]`; treating that as an
                // empty `memberOf` check broadens `requireRole` fail-open.
                let requested_roles = required_nonempty_string_array(&args, "roles")?;
                // Resolve the declaration to owned data so no borrow of `self`
                // (via the schema) is held across the mutable capture below.
                let (table_name, membership) = {
                    let schema = self.db().schema();
                    match crate::membership_rules::find_declaration(schema, &declaration) {
                        Some((table, membership)) => (table.name.clone(), membership.clone()),
                        None => {
                            return Err(SnapbackError::error(
                                "SNAPBACK_MEMBERSHIP_UNKNOWN_DECLARATION",
                                "runtime",
                                format!(
                                    "ctx.permissions names declaration {declaration:?}, which is not declared"
                                ),
                            ));
                        }
                    }
                };
                if let Some(role) = requested_roles.iter().find(|role| {
                    !membership
                        .vocabulary()
                        .any(|declared| declared == role.as_str())
                }) {
                    return Err(SnapbackError::error(
                        "SNAPBACK_MEMBERSHIP_UNKNOWN_ROLE",
                        "auth",
                        "ctx.permissions role evaluation names a role outside the declaration vocabulary",
                    )
                    .with_details(json!({ "role": role })));
                }
                // Unauthenticated / null effective principal: deny with the same
                // invariant payload (the `optional-user` split; `authenticated`
                // functions fail AUTH_REQUIRED before the handler runs).
                let Some(principal) = self.input.auth.user_id.clone() else {
                    if !terminal {
                        return Ok(Value::Bool(false));
                    }
                    let denial = crate::membership_rules::role_denial();
                    self.terminal_denial = Some(denial.clone());
                    return Err(denial);
                };
                let roles = crate::membership_rules::effective_roles(
                    &membership,
                    Some(requested_roles.as_slice()),
                );
                if membership.scope == crate::manifest::MembershipScope::App
                    && crate::membership_rules::impersonated_global_role_satisfies(
                        &membership,
                        &declaration,
                        &roles,
                        self.handler_auth.roles(),
                    )
                {
                    // Dev-only fidelity seam: this succeeds from frozen
                    // session-role input, not from a membership row. Real
                    // sessions always project roles: [].
                    return Ok(Value::Bool(true));
                }
                let binding = if membership.resource.is_none() {
                    // scope:"app" — the singleton system-constant resource.
                    crate::membership_rules::ResourceBinding::AppSingleton
                } else {
                    crate::membership_rules::ResourceBinding::Fixed(resource_arg)
                };
                let outcome = crate::membership_rules::require_role(
                    self.db(),
                    &membership,
                    &table_name,
                    &principal,
                    binding,
                    &roles,
                )?;
                // The membership read is captured on BOTH outcomes (present or
                // absent) as an ORDINARY snapshot-bound dependency — never the
                // dead `Permission` kind — so a role revoked between check and
                // commit fails commit-time read-set validation, and
                // terminalization preserves the denial witness.
                match outcome.finish(|dependency| self.push_read_dependency(dependency)) {
                    Ok(()) => Ok(Value::Bool(true)),
                    Err(_denial) if !terminal => Ok(Value::Bool(false)),
                    Err(denial) => {
                        // Record the trusted brand out-of-band; the outer
                        // result-assembly returns it regardless of handler catch.
                        self.terminal_denial = Some(denial.clone());
                        Err(denial)
                    }
                }
            }
            // `ctx.fetch` — buffered host-mediated fetch (LLP 0049 §Action
            // Egress), the plain sibling of `action.streamOpen`. 0137
            // a4-f1/a5-f1: the streamed lane worked on the local target while
            // plain ctx.fetch dead-ended as an anonymous unknown op; both now
            // ride the same action-host seam under the same egress gate, and
            // a host without an implementation refuses typed — never by
            // falling back to ambient fetch.
            "host.fetch" => {
                self.ensure_action("fetch")?;
                if !outbound_actions_enabled() {
                    return Err(SnapbackError::error(
                        "SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED",
                        "runtime",
                        "ctx.fetch requires the deployment's outbound-actions capability",
                    )
                    .with_details(json!({
                        "operation": "fetch",
                        "expected": "SNAPBACK_OUTBOUND_ACTIONS=1",
                        "received": "outbound actions disabled",
                        "repair": "guide/backend/actions-and-fetch#enable-egress-deliberately",
                    })));
                }
                let request =
                    serde_json::from_value::<HostFetchRequest>(args).map_err(|_error| {
                        SnapbackError::error(
                            "SNAPBACK_HOST_FETCH_INVALID",
                            "runtime",
                            "ctx.fetch received an invalid request shape",
                        )
                        .with_details(json!({
                            "operation": "fetch",
                            "expected": "{url, method?, headers?, body?, timeoutMs?}",
                            "received": "nonconforming request object",
                            "repair": "guide/backend/actions-and-fetch#the-inline-form",
                        }))
                    })?;
                let host = self
                    .action_host
                    .as_deref_mut()
                    .ok_or_else(action_host_missing)?;
                serde_json::to_value(host.host_fetch(request)?).map_err(|_error| {
                    SnapbackError::error(
                        "SNAPBACK_HOST_FETCH_FAILED",
                        "runtime",
                        "the host fetch response could not be serialized",
                    )
                })
            }
            "push.send" => {
                self.ensure_action("push.send")?;
                if !outbound_actions_enabled() {
                    return Err(SnapbackError::error(
                        "SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED",
                        "runtime",
                        "ctx.push.send requires the deployment's outbound-actions capability",
                    ));
                }
                let request = serde_json::from_value::<crate::push::PushSendRequestV1>(args)
                    .map_err(|_error| {
                        SnapbackError::error(
                            "SNAPBACK_PUSH_SEND_INVALID",
                            "push",
                            "ctx.push.send received an invalid request shape",
                        )
                    })?;
                let host = self
                    .action_host
                    .as_deref_mut()
                    .ok_or_else(action_host_missing)?;
                serde_json::to_value(host.push_send(request)?).map_err(|_error| {
                    SnapbackError::error(
                        "SNAPBACK_PUSH_SEND_FAILED",
                        "push",
                        "the push send response could not be serialized",
                    )
                })
            }
            // @ref LLP 0222#design-detail — the predicate is an
            // action-only host read. Query/mutation contexts receive no
            // surface, and the dispatcher independently enforces the cut.
            "realtime.hasFreshClient" => {
                self.ensure_action("realtime.hasFreshClient")?;
                let principal_id = required_string(&args, "principalId")?;
                let host = self
                    .action_host
                    .as_deref_mut()
                    .ok_or_else(action_host_missing)?;
                Ok(Value::Bool(host.has_fresh_client(&principal_id)?))
            }
            _ => Err(SnapbackError::error(
                "SNAPBACK_HANDLER_HOST_CALL_UNKNOWN",
                "runtime",
                format!("unknown handler host call {op}"),
            )),
        }
    }

    /// Take any out-of-band trusted role denial recorded by
    /// `permissions.requireRole`. The outer result-assembly calls this after the
    /// handler returns and, if it is `Some`, fails the invocation with the
    /// trusted denial — overriding a handler that caught the thrown error
    /// (terminalization) and preserving the trusted brand a forged throw lacks.
    fn take_terminal_denial(&mut self) -> Option<SnapbackError> {
        self.terminal_denial.take()
    }

    fn ensure_writable(&self, op: &str) -> SnapbackResult<()> {
        if self.mode == IbexInvocationMode::Mutation {
            return Ok(());
        }
        Err(SnapbackError::error(
            "SNAPBACK_HANDLER_WRITE_IN_QUERY",
            "runtime",
            format!("query handler attempted ctx.db.{op}"),
        ))
    }

    /// The dynamic half of LLP 0055's two-gate authority-creating system.
    /// Static marking improves consent UX, but every declaration-bound
    /// membership effect rechecks the exact invoked scope here so aliases,
    /// computed access, and unmarked wrappers cannot launder durable authority.
    fn ensure_membership_authority_creating(
        &self,
        table: &crate::manifest::TableManifest,
    ) -> SnapbackResult<()> {
        if !self.membership_writer.is_service_principal() {
            return Ok(());
        }
        if !self.membership_writer.has_authority_creating_consent() {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_AUTHORITY_CREATING_UNCONSENTED",
                "auth",
                "a service principal reached a membership write without explicit authority-creating consent",
            )
            .with_details(json!({ "reason": "effect_site_unconsented" })));
        }
        if table
            .membership
            .as_ref()
            .and_then(|membership| membership.provenance)
            == Some(crate::manifest::MembershipProvenance::Full)
        {
            return Ok(());
        }
        Err(SnapbackError::error(
            "SNAPBACK_AUTH_AUTHORITY_CREATING_UNCONSENTED",
            "auth",
            "service-principal membership writes require full host-filled provenance",
        )
        .with_details(json!({
            "reason": "permission_backing_provenance_unavailable",
            "table": table.name,
        })))
    }

    /// Resolve the installed policy before every JavaScript generic write.
    /// The storage transaction repeats this check, so this is an early
    /// diagnostic/side-effect fence rather than trusted authority.
    ///
    /// @ref LLP 0264#d5-the-policy-check-is-central-and-exhaustive
    fn installed_owner_write_field(
        &self,
        table_name: &str,
        form: GenericTableWriteFormV1,
    ) -> SnapbackResult<Option<String>> {
        let table = self.db().schema().table(table_name).ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_UNKNOWN_TABLE",
                "schema",
                format!("unknown table {table_name}"),
            )
        })?;
        generic_owner_write_field(table, form).map(|field| field.map(str::to_owned))
    }

    /// v1 has full host-filled provenance only for LLP 0056 membership tables.
    /// A service principal may therefore never write a different
    /// `permissionBacking` table, even when its entry-point scope was marked.
    fn ensure_permission_backing_write(&self, table: &str) -> SnapbackResult<()> {
        let Some(table) = self.db().schema().table(table) else {
            return Ok(());
        };
        if !self.membership_writer.is_service_principal()
            || !table.permission_backing
            || table.membership.is_some()
        {
            return Ok(());
        }
        Err(SnapbackError::error(
            "SNAPBACK_AUTH_AUTHORITY_CREATING_UNCONSENTED",
            "auth",
            "service-principal writes to non-membership permission-backing tables are unavailable without full provenance",
        )
        .with_details(json!({
            "reason": "permission_backing_provenance_unavailable",
            "table": table.name.clone(),
        })))
    }

    /// Whether this invocation has buffered any write targeting `table`.
    ///
    /// @ref LLP 0032#phase-2--execution-semantics-honesty — E2.
    fn has_buffered_writes_for(&self, table: &str) -> bool {
        self.writes.iter().any(|write| write.table() == table)
    }

    fn buffered_touched_ids_for(&self, table: &str) -> BTreeSet<String> {
        self.writes
            .iter()
            .filter(|write| write.table() == table)
            .map(|write| write.id().to_owned())
            .collect()
    }

    /// Fold this invocation's buffered writes for `(table, id)` over a stored
    /// row, producing the row the handler should observe. A buffered insert's
    /// system fields mirror `insert_document`'s shape with a provisional
    /// `_createdAt`/`_updatedAt` (the frozen handler clock); the authoritative
    /// version and timestamps are assigned at commit.
    ///
    /// @ref LLP 0032#phase-2--execution-semantics-honesty — E2 read-your-writes overlay.
    fn apply_buffered_to_point(
        &self,
        table: &str,
        id: &str,
        stored: Option<Value>,
    ) -> Option<Value> {
        let mut current = stored;
        for write in &self.writes {
            if write.table() != table || write.id() != id {
                continue;
            }
            match write {
                BufferedWrite::Insert { values, .. } => {
                    let mut values = values.clone();
                    if let Some(table) = self.db().schema().table(table)
                        && let Some(TableVisibilityV1::Owner { field }) = &table.visibility
                        && let Some(principal) = self.input.auth.user_id.as_deref()
                    {
                        values.insert(field.clone(), Value::String(principal.to_owned()));
                    }
                    current = Some(self.materialize_insert(id, &values));
                }
                BufferedWrite::Patch { values, .. } => {
                    // A patch against a row that does not exist yet is a no-op at
                    // commit; the effective view stays a miss.
                    if let Some(Value::Object(mut row)) = current.take() {
                        for (key, value) in values {
                            row.insert(key.clone(), value.clone());
                        }
                        row.insert("_updatedAt".to_owned(), json!(self.now_ms));
                        current = Some(Value::Object(row));
                    }
                }
                BufferedWrite::Delete { .. } => {
                    current = None;
                }
            }
        }
        current
    }

    fn materialize_insert(&self, id: &str, values: &Map<String, Value>) -> Value {
        let mut document = Map::new();
        document.insert("_id".to_owned(), Value::String(id.to_owned()));
        document.insert("_createdAt".to_owned(), json!(self.now_ms));
        document.insert("_updatedAt".to_owned(), json!(self.now_ms));
        for (key, value) in values {
            document.insert(key.clone(), value.clone());
        }
        Value::Object(document)
    }

    /// Layer buffered writes over a storage query result: drop rows this
    /// invocation has since deleted, recompute patched/inserted rows from their
    /// effective view, keep only those still matching the plan's filters, then
    /// re-sort and re-apply the limit with the same primitives the live matcher
    /// uses. When the plan carries a limit, `base_rows` must include the
    /// bounded replacement-candidate overfetch for every buffered row that
    /// could displace a persisted result.
    ///
    /// @ref LLP 0032#phase-2--execution-semantics-honesty — E2.
    fn merge_buffered_into_query(
        &self,
        plan: &QueryPlan,
        base_rows: Vec<Value>,
        touched_storage: &BTreeMap<String, (Option<Value>, bool)>,
    ) -> SnapbackResult<Vec<Value>> {
        let touched = touched_storage
            .keys()
            .map(String::as_str)
            .collect::<BTreeSet<_>>();

        let mut merged: Vec<Value> = base_rows
            .into_iter()
            .filter(|row| {
                row.get("_id")
                    .and_then(Value::as_str)
                    .map(|id| !touched.contains(id))
                    .unwrap_or(true)
            })
            .collect();

        let mut authored_plan = plan.clone();
        authored_plan.table_visibility = None;
        for (id, (stored, storage_visible)) in touched_storage {
            // An existing row must have been visible before the overlay and
            // remain visible after it. Inserts have no pre-overlay row and are
            // admitted solely by their effective policy fields.
            if stored.is_some() && !storage_visible {
                continue;
            }
            let Some(row) = self.apply_buffered_to_point(&plan.table, id, stored.clone()) else {
                continue;
            };
            let effective_visible = match &plan.table_visibility {
                Some(visibility) => self.row_matches_declared_table_visibility(visibility, &row)?,
                None => true,
            };
            if effective_visible
                && row_matches_query_filters(&authored_plan, &self.input, &row) == Some(true)
            {
                merged.push(row);
            }
        }

        if !plan.order.is_empty() {
            merged.sort_by(|left, right| {
                let ordering = match (sort_key(plan, left), sort_key(plan, right)) {
                    (Some(left_key), Some(right_key)) => {
                        compare_sort_keys(plan, &left_key, &right_key).unwrap_or(Ordering::Equal)
                    }
                    _ => Ordering::Equal,
                };
                if ordering == Ordering::Equal {
                    row_id_for_sort(left).cmp(row_id_for_sort(right))
                } else {
                    ordering
                }
            });
        }
        merged.truncate(effective_query_limit(plan));
        Ok(merged)
    }

    fn ensure_buffered_write_capacity(&self) -> SnapbackResult<()> {
        if self.writes.len() + self.membership_commands.len() >= QUERY_MAX_BUFFERED_WRITES {
            return Err(SnapbackError::error(
                "SNAPBACK_BUFFERED_WRITE_LIMIT_EXCEEDED",
                "runtime",
                format!("one mutation may buffer at most {QUERY_MAX_BUFFERED_WRITES} writes"),
            ));
        }
        Ok(())
    }

    fn ensure_action(&self, op: &str) -> SnapbackResult<()> {
        if self.mode == IbexInvocationMode::Action {
            return Ok(());
        }
        Err(SnapbackError::error(
            "SNAPBACK_ACTION_CONTEXT_UNAVAILABLE",
            "runtime",
            format!("ctx.{op} is only available to action handlers"),
        ))
    }

    fn capture_point_read(
        &mut self,
        table: &str,
        id: &str,
        row: Option<&Value>,
    ) -> SnapbackResult<()> {
        let dependency = if let Some(row) = row {
            CapturedReadDependency {
                kind: CapturedReadKind::Row,
                table: Some(table.to_owned()),
                id: Some(id.to_owned()),
                version: Some(row_version(row)?),
                predicate: None,
                rows: Vec::new(),
                field: None,
                value: None,
                order: None,
                limit: None,
                result_count: None,
                boundary: None,
            }
        } else {
            CapturedReadDependency {
                kind: CapturedReadKind::MissingRow,
                table: Some(table.to_owned()),
                id: Some(id.to_owned()),
                version: Some(self.db().table_change_version(table)?),
                predicate: None,
                rows: Vec::new(),
                field: None,
                value: None,
                order: None,
                limit: None,
                result_count: None,
                boundary: None,
            }
        };
        self.push_read_dependency(dependency);
        notify_captured_point_read(table, id);
        Ok(())
    }

    fn capture_query_read(&mut self, plan: &QueryPlan, output: &QueryOutput) -> SnapbackResult<()> {
        let dependencies = query_dependencies_from_plan(plan, &self.input, output, self.db())?;
        for dependency in dependencies {
            self.push_read_dependency(dependency);
        }
        Ok(())
    }

    fn push_read_dependency(&mut self, dependency: CapturedReadDependency) {
        let key = read_dependency_key(&dependency);
        if self.read_keys.insert(key) {
            self.reads.push(dependency);
        }
    }
}

const HANDLER_ERROR_EXPOSURE_ENV: &str = "SNAPBACK_HANDLER_ERROR_EXPOSURE";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum HandlerErrorExposure {
    Redacted,
    Development,
}

thread_local! {
    static HANDLER_ERROR_EXPOSURE_OVERRIDE: Cell<Option<HandlerErrorExposure>> = const { Cell::new(None) };
}

struct HandlerErrorExposureOverrideGuard(Option<HandlerErrorExposure>);

impl Drop for HandlerErrorExposureOverrideGuard {
    fn drop(&mut self) {
        HANDLER_ERROR_EXPOSURE_OVERRIDE.with(|slot| slot.set(self.0));
    }
}

impl HandlerErrorExposure {
    fn from_process_environment() -> Self {
        if let Some(exposure) = HANDLER_ERROR_EXPOSURE_OVERRIDE.with(Cell::get) {
            return exposure;
        }
        match env::var(HANDLER_ERROR_EXPOSURE_ENV).ok().as_deref() {
            Some("development") => Self::Development,
            _ => Self::Redacted,
        }
    }
}

/// Run one synchronous invocation with development handler-error projection.
/// This test/conformance seam is thread-local so parallel cases never mutate
/// the process-wide deployment environment.
#[doc(hidden)]
pub fn with_development_handler_error_exposure<T>(run: impl FnOnce() -> T) -> T {
    let previous = HANDLER_ERROR_EXPOSURE_OVERRIDE
        .with(|slot| slot.replace(Some(HandlerErrorExposure::Development)));
    let _guard = HandlerErrorExposureOverrideGuard(previous);
    run()
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct HandlerSourcePosition {
    line: usize,
    column: usize,
}

/// One recorded handler host call. The trace is the LLP 0048 equivalence
/// artifact: the V8 and Ibex legs must produce equivalent traces before their
/// user-visible outputs are compared, so both engines' host calls route
/// through [`dispatch_host_call`], which records identically for either leg.
#[derive(Clone, Debug, Serialize)]
pub struct HostCallTraceEntry {
    pub seq: usize,
    pub op: String,
    pub args: Value,
    pub ok: bool,
    /// The successful result value, or the stable diagnostic code on failure.
    pub outcome: Value,
    /// Public request/profile/buffered-touch-derived cost facts for one
    /// logical batch. Match count and authorization outcomes are intentionally
    /// absent.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost: Option<BatchReadCostFactsV1>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchReadCostFactsV1 {
    pub logical_batch_count: usize,
    pub item_count: usize,
    pub distinct_item_count: usize,
    pub canonical_input_bytes: usize,
    pub physical_statement_count: usize,
    pub physical_chunk_count: usize,
    pub max_policy_probe_count: usize,
}

fn batch_read_cost_facts(
    op: &str,
    args: &Value,
    buffered_touch_count: usize,
) -> Option<BatchReadCostFactsV1> {
    let items = match op {
        "db.getMany" | "db.elevated.getMany" => args.get("ids")?.as_array()?,
        "db.uniqueMany" | "db.elevated.uniqueMany" => args.get("keys")?.as_array()?,
        _ => return None,
    };
    let canonical_input_bytes = crate::rqs_contract::jcs(args).ok()?.len();
    let distinct_item_count = items
        .iter()
        .filter_map(|item| crate::rqs_contract::jcs(item).ok())
        .collect::<BTreeSet<_>>()
        .len();
    let index_components = if op.ends_with(".uniqueMany") {
        items
            .iter()
            .find_map(Value::as_object)
            .map_or(1, Map::len)
            .max(1)
    } else {
        1
    };
    let chunk_capacity = (999 / index_components).max(1);
    let request_chunk_count = distinct_item_count.div_ceil(chunk_capacity);
    // @ref LLP 0248#d4-dependency-and-cost-evidence-remain-conservative —
    // uniqueMany resolves every distinct buffered-touched id with a point
    // statement, then may recheck each touched candidate against each
    // distinct key. Charge the full profile-bound policy maximum without
    // consulting whether any stored candidate exists or is visible.
    let overlay_point_read_count = if op.ends_with(".uniqueMany") {
        buffered_touch_count
    } else {
        0
    };
    let physical_statement_count = request_chunk_count.saturating_add(overlay_point_read_count);
    let max_policy_evaluation_count = distinct_item_count
        .saturating_add(overlay_point_read_count)
        .saturating_add(distinct_item_count.saturating_mul(overlay_point_read_count));
    Some(BatchReadCostFactsV1 {
        logical_batch_count: 1,
        item_count: items.len(),
        distinct_item_count,
        canonical_input_bytes,
        physical_statement_count,
        physical_chunk_count: physical_statement_count,
        max_policy_probe_count: max_policy_evaluation_count
            .saturating_mul(BATCH_READ_MAX_POLICY_PROBES_PER_ITEM),
    })
}

thread_local! {
    static HOST_CALL_TRACE: RefCell<Option<Vec<HostCallTraceEntry>>> = const { RefCell::new(None) };
}

/// Run `f` while recording every handler host call on this thread, returning
/// the result alongside the machine-readable trace (LLP 0048 §Architecture:
/// the logical protocol is the invariant; the trace is its evidence).
pub fn with_host_call_trace<T>(f: impl FnOnce() -> T) -> (T, Vec<HostCallTraceEntry>) {
    let previous = HOST_CALL_TRACE.with(|slot| slot.borrow_mut().replace(Vec::new()));
    let result = f();
    let trace = HOST_CALL_TRACE.with(|slot| {
        let mut borrowed = slot.borrow_mut();
        let trace = borrowed.take().unwrap_or_default();
        *borrowed = previous;
        trace
    });
    (result, trace)
}

/// The single host-call dispatch seam shared by both engines: the Ibex FFI
/// trampoline and the workerd HTTP host server both land here, so the op
/// table, its diagnostics, and the recorded trace cannot differ per engine.
pub(crate) fn dispatch_host_call(
    ctx: &mut IbexHostContext<'_>,
    op: &str,
    args: Value,
) -> SnapbackResult<Value> {
    let tracing = HOST_CALL_TRACE.with(|slot| slot.borrow().is_some());
    // @ref LLP 0036#runtime-exposure-d5-d8 — traces are retained diagnostics,
    // so action secrets (including fetch header values) are scrubbed with the
    // same staging-time snapshot as the eventual error envelope.
    let traced_args = if tracing {
        Some(redact_runtime_observation(args.clone()))
    } else {
        None
    };
    let buffered_touch_count = if tracing && op.ends_with(".uniqueMany") {
        args.get("table")
            .and_then(Value::as_str)
            .map_or(0, |table| ctx.buffered_touched_ids_for(table).len())
    } else {
        0
    };
    let result = ctx.handle_host_call(op, args);
    if let Err(error) = &result {
        ctx.host_failure_witness = Some(error.clone());
    }
    // @ref LLP 0076#diagnostics — record the structured stream refusal
    // out-of-band so it can be restored past the JS error round-trip.
    if let Err(error) = &result
        && (error.diagnostic.code.starts_with("SNAPBACK_ACTION_STREAM_")
            || error.diagnostic.code == "SNAPBACK_ACTION_PROGRESS_RATE_EXCEEDED")
    {
        ctx.stream_refusal = Some(error.clone());
    }
    // 0137 a4-f5: a trusted platform denial produced inside an action (a
    // nested mutation refusing across `action.runMutation`) is recorded so
    // the typed code can survive the action boundary without letting a
    // handler-forged `{code: ...}` become typed (LLP 0053's rule).
    if let Err(error) = &result
        && ctx.mode == IbexInvocationMode::Action
        && error.diagnostic.code == "SNAPBACK_AUTH_PERMISSION_DENIED"
    {
        ctx.denial_witness = Some(error.clone());
    }
    if let Some(args) = traced_args {
        HOST_CALL_TRACE.with(|slot| {
            if let Some(trace) = slot.borrow_mut().as_mut() {
                let (ok, outcome) = match &result {
                    Ok(value) => (true, value.clone()),
                    Err(error) => (false, Value::String(error.diagnostic.code.clone())),
                };
                trace.push(HostCallTraceEntry {
                    seq: trace.len(),
                    op: op.to_owned(),
                    cost: batch_read_cost_facts(op, &args, buffered_touch_count),
                    args,
                    ok,
                    outcome,
                });
            }
        });
    }
    result
}

thread_local! {
    static CURRENT_IBEX_HOST_CONTEXT: RefCell<*mut c_void> = const { RefCell::new(ptr::null_mut()) };
}

fn run_ibex_handler_with_context(
    module: &IbexModule,
    invocation: &mut IbexHostContext<'_>,
    pool: Option<&WarmVmPool>,
) -> SnapbackResult<Value> {
    run_ibex_handler_with_context_until(module, invocation, pool, None)
}

fn run_ibex_handler_with_context_until(
    module: &IbexModule,
    invocation: &mut IbexHostContext<'_>,
    pool: Option<&WarmVmPool>,
    deadline: Option<Instant>,
) -> SnapbackResult<Value> {
    run_ibex_handler_with_context_until_with_exposure(
        module,
        invocation,
        pool,
        deadline,
        HandlerErrorExposure::from_process_environment(),
    )
}

fn run_ibex_handler_with_context_until_with_exposure(
    module: &IbexModule,
    invocation: &mut IbexHostContext<'_>,
    pool: Option<&WarmVmPool>,
    deadline: Option<Instant>,
    exposure: HandlerErrorExposure,
) -> SnapbackResult<Value> {
    invocation.function_name.clone_from(&module.export);
    // @ref LLP 0048#architecture — the twin swaps only the handler executor:
    // storage, host-op implementation, and the logical host-call protocol are
    // this same context either way. Actions stay on Ibex (egress and secrets
    // powers are not in the twin's scope; the capability manifest says so).
    let workerd_v8 = matches!(
        crate::workerd_exec::selected_backend(),
        crate::workerd_exec::HandlerBackend::WorkerdV8
    ) && !matches!(invocation.mode, IbexInvocationMode::Action);
    let (result, claimed_code) = if workerd_v8 {
        let output = match deadline {
            Some(deadline) => {
                let timeout_ms = u64::from(remaining_deadline_ms(deadline)?);
                crate::workerd_exec::with_wall_clock_timeout_ms(timeout_ms, || {
                    crate::workerd_exec::run_handler_workerd(module, invocation)
                })
            }
            None => crate::workerd_exec::run_handler_workerd(module, invocation),
        };
        invocation
            .admission
            .validate("workerd runtime completion")?;
        match output {
            Ok(output) => output,
            Err(error) => (Err(error), None),
        }
    } else {
        run_handler_ibex_engine_until(module, invocation, pool, deadline)?
    };

    // @ref LLP 0144#invariants-for-any-extension — engine output is still a
    // handler claim. Adjudicate the declared set only after the executor join
    // so the Ibex and workerd-v8 legs cannot drift on admission again.
    let result = admit_declared_refusal(
        &invocation.declared_refusals,
        &invocation.tracked_refusals,
        result,
    );
    let result = restore_host_failure_witness(invocation, claimed_code.as_deref(), result);
    // @ref LLP 0193#program — an agent-triggerable generic failure names the
    // condition under the managed development supervisor, while the process
    // default keeps handler-authored message/stack data private. Project only
    // after claim admission and trusted-host restoration so enrichment cannot
    // erase an adjudicated platform diagnostic or bypass refusal folding.
    let result = project_handler_failure(result, module, invocation.mode, exposure);
    // Witness restoration remains action-scoped; actions stay on Ibex, while
    // applying these empty-witness seams after the join is harmless for V8.
    let result = restore_denial_witness(invocation, claimed_code.as_deref(), result);
    restore_stream_refusal(invocation, result)
}

/// Restore a host-produced diagnostic only when the handler's final envelope
/// claims the same code. The claim alone remains untrusted and folded to
/// `SNAPBACK_HANDLER_FAILED`; the out-of-band witness supplies the authority
/// and the value-safe structured details.
fn restore_host_failure_witness(
    invocation: &mut IbexHostContext<'_>,
    claimed_code: Option<&str>,
    result: SnapbackResult<Value>,
) -> SnapbackResult<Value> {
    match result {
        Err(mut error) if error.diagnostic.code == "SNAPBACK_HANDLER_FAILED" => {
            match invocation
                .host_failure_witness
                .take()
                .filter(|recorded| Some(recorded.diagnostic.code.as_str()) == claimed_code)
            {
                Some(recorded) => {
                    let context = error.take_private_failure_context();
                    Err(match context {
                        Some(context) => recorded.with_private_failure_context(context),
                        None => recorded,
                    })
                }
                None => Err(error),
            }
        }
        other => other,
    }
}

fn project_handler_failure(
    result: SnapbackResult<Value>,
    module: &IbexModule,
    mode: IbexInvocationMode,
    exposure: HandlerErrorExposure,
) -> SnapbackResult<Value> {
    let Err(mut error) = result else {
        return result;
    };
    if error.diagnostic.code != "SNAPBACK_HANDLER_FAILED" {
        return Err(error);
    }

    let carrier = error
        .private_failure_context_mut()
        .and_then(|context| context.carriers.first())
        .cloned();
    let function = module.export.clone();
    if exposure == HandlerErrorExposure::Redacted {
        error.diagnostic.message = "JavaScript handler failed".to_owned();
        error.diagnostic.details = json!({ "function": function });
        return Err(error);
    }

    let raw_message = carrier
        .as_ref()
        .and_then(|carrier| carrier.message.as_deref())
        .filter(|message| !message.is_empty())
        .unwrap_or("handler failure could not be safely inspected");
    let error_class = carrier
        .as_ref()
        .map(|carrier| carrier.error_class.as_str())
        .filter(|class| *class != UNCLASSIFIED_ERROR_CLASS);
    let position = carrier
        .as_ref()
        .and_then(|carrier| carrier.stack.as_deref())
        .and_then(|stack| handler_source_position(stack, module, mode));
    let callee = callee_from_error_message(raw_message)
        .or_else(|| position.and_then(|position| callee_from_source(module, position)));
    let property = callee
        .as_deref()
        .and_then(|callee| callee.rsplit_once('.').map(|(_, property)| property))
        .map(str::to_owned);

    let mut summary = format!("JavaScript handler '{function}' failed");
    if let Some(position) = position {
        summary.push_str(&format!(
            " at handler source {}:{}",
            position.line, position.column
        ));
    }
    summary.push_str(": ");
    if let Some(error_class) = error_class {
        summary.push_str(error_class);
        summary.push_str(": ");
    }
    summary.push_str(raw_message);
    if let Some(callee) = callee.as_deref()
        && !raw_message.contains(callee)
    {
        summary.push_str(&format!(" (callee {callee})"));
    }

    let mut details = Map::from_iter([
        ("function".to_owned(), Value::String(function)),
        ("message".to_owned(), Value::String(raw_message.to_owned())),
    ]);
    if let Some(error_class) = error_class {
        details.insert(
            "errorClass".to_owned(),
            Value::String(error_class.to_owned()),
        );
    }
    if let Some(callee) = callee {
        details.insert("callee".to_owned(), Value::String(callee));
    }
    if let Some(property) = property {
        details.insert("property".to_owned(), Value::String(property));
    }
    if let Some(position) = position {
        details.insert(
            "sourcePosition".to_owned(),
            json!({
                "handler": module.export,
                "line": position.line,
                "column": position.column,
            }),
        );
    }
    error.diagnostic.message = summary;
    error.diagnostic.details = Value::Object(details);
    Err(error)
}

fn handler_source_position(
    stack: &str,
    module: &IbexModule,
    mode: IbexInvocationMode,
) -> Option<HandlerSourcePosition> {
    let source_start_line = handler_source_start_line(mode);
    let source_line_count = module.source.lines().count().max(1);
    stack.lines().find_map(|frame| {
        let frame = frame.trim().trim_end_matches(')');
        let (before_column, column) = frame.rsplit_once(':')?;
        let (before_line, engine_line) = before_column.rsplit_once(':')?;
        let column = column.parse::<usize>().ok()?;
        let engine_line = engine_line.parse::<usize>().ok()?;
        let source_name = before_line
            .rsplit_once('(')
            .map(|(_, name)| name)
            .unwrap_or_else(|| {
                before_line
                    .split_whitespace()
                    .next_back()
                    .unwrap_or(before_line)
            });
        if source_name != module.export
            || engine_line < source_start_line
            || engine_line >= source_start_line.saturating_add(source_line_count)
        {
            return None;
        }
        Some(HandlerSourcePosition {
            line: engine_line - source_start_line + 1,
            column,
        })
    })
}

fn handler_source_start_line(mode: IbexInvocationMode) -> usize {
    let prefix = format!(
        "{}\n{}\n{}\n",
        ambient_restriction_source(mode, outbound_actions_enabled()),
        allowlist_install_source(),
        ctx_bootstrap_source(),
    );
    prefix.bytes().filter(|byte| *byte == b'\n').count() + 1
}

fn callee_from_error_message(message: &str) -> Option<String> {
    [" is not a function", " is not callable", " is undefined"]
        .into_iter()
        .find_map(|suffix| {
            let before = message.split_once(suffix)?.0;
            let candidate =
                before
                    .split_whitespace()
                    .next_back()?
                    .trim_matches(|character: char| {
                        matches!(character, '`' | '\'' | '"' | '(' | ')' | '[' | ']')
                    });
            normalized_callee(candidate)
        })
}

fn callee_from_source(module: &IbexModule, position: HandlerSourcePosition) -> Option<String> {
    let line = module.source.lines().nth(position.line.checked_sub(1)?)?;
    let mut candidates = line
        .match_indices('(')
        .filter_map(|(open, _)| {
            let before = &line[..open];
            let start = before
                .char_indices()
                .rev()
                .find(|(_, character)| {
                    !(character.is_ascii_alphanumeric()
                        || matches!(character, '_' | '$' | '.' | '?'))
                })
                .map(|(index, character)| index + character.len_utf8())
                .unwrap_or(0);
            let callee = normalized_callee(before[start..].trim())?;
            let distance = open.abs_diff(position.column.saturating_sub(1));
            Some((distance, callee))
        })
        .collect::<Vec<_>>();
    candidates.sort_by_key(|(distance, _)| *distance);
    candidates.into_iter().map(|(_, callee)| callee).next()
}

fn normalized_callee(candidate: &str) -> Option<String> {
    if candidate.is_empty() || candidate.len() > 256 {
        return None;
    }
    let normalized = candidate.replace("?.", ".");
    let mut segments = normalized.split('.');
    let valid_identifier = |segment: &str| {
        let mut characters = segment.chars();
        characters.next().is_some_and(|character| {
            character.is_ascii_alphabetic() || matches!(character, '_' | '$')
        }) && characters
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '$'))
    };
    if !segments.all(valid_identifier) || !normalized.contains('.') {
        return None;
    }
    Some(normalized)
}

/// Execute only the Ibex/Hermes engine leg and return its unadmitted handler
/// result plus the raw claimed platform code used by action witness restore.
/// Application-refusal admission deliberately lives in the caller's shared
/// completion seam, not in an engine implementation.
fn run_handler_ibex_engine_until(
    module: &IbexModule,
    invocation: &mut IbexHostContext<'_>,
    pool: Option<&WarmVmPool>,
    deadline: Option<Instant>,
) -> SnapbackResult<(SnapbackResult<Value>, Option<String>)> {
    // @ref LLP 0009#dk-4-retired--upstream-ibex-owner-thread-contract-2026-07-27 —
    // Snapback workers may change OS threads between invocations, while an
    // upstream Ibex runtime must be evaluated and destroyed on its creating
    // thread. The lifecycle policy therefore keeps `enabled()` false and this
    // target always takes the fresh path.
    let _ = pool;

    let runtime = RuntimeGuard::create()?;
    let cancellation = runtime.interrupt_on(&invocation.admission);
    let time_limit = deadline
        .map(|deadline| runtime.watch_until(deadline))
        .transpose()?;
    let source = invocation_source(module, invocation)?;

    // @ref LLP 0032#phase-1--safety-floor-and-confirmed-defects — S5.D1: the
    // context pointer is saved and restored (a stack, via recursion), not
    // unconditionally nulled. An Ibex action whose `ctx.runMutation` targets
    // an Ibex mutation re-enters this function synchronously on the same
    // thread; nulling on the inner exit would strand the outer invocation so
    // its next host call fails with SNAPBACK_HANDLER_HOST_CALL_WITHOUT_CONTEXT.
    let previous_context = CURRENT_IBEX_HOST_CONTEXT.with(|slot| {
        let previous = *slot.borrow();
        *slot.borrow_mut() = invocation as *mut IbexHostContext<'_> as *mut c_void;
        previous
    });
    let eval_result = eval(runtime.ptr(), &module.export, &source);
    CURRENT_IBEX_HOST_CONTEXT.with(|slot| {
        *slot.borrow_mut() = previous_context;
    });
    // The untrusted eval has returned (success or error); stop the monitor
    // before inspecting fixed runtime bookkeeping or destroying the VM.
    drop(time_limit);
    drop(cancellation);

    invocation.admission.validate("runtime completion")?;

    let output = eval_result?;
    let rejections = inspect_unhandled_rejections(runtime.ptr())?;
    if !rejections.is_empty() {
        return Err(unhandled_rejection_error(module, rejections));
    }
    Ok(parse_handler_output_with_claim(module, output))
}

/// Surface the host-recorded trusted `SNAPBACK_AUTH_PERMISSION_DENIED`
/// through the action boundary (0137 a4-f5). The uniform-denial rules
/// (LLP 0053) require a handler-forged `{code: ...}` to stay untyped, so the
/// envelope decoder folds the claimed code to `SNAPBACK_HANDLER_FAILED`;
/// only when the failing handler's claim matches a denial the host itself
/// produced during this invocation is the recorded trusted error — with its
/// uniform, non-disclosing bytes — restored. A witness whose invocation
/// fails with a DIFFERENT claim is not restored (the handler caught the
/// denial and failed on its own terms), and a caught denial followed by
/// success stays success: the denied nested mutation committed nothing, and
/// unlike `terminal_denial` this seam is deliberately non-terminalizing.
fn restore_denial_witness(
    invocation: &mut IbexHostContext<'_>,
    claimed_code: Option<&str>,
    result: SnapbackResult<Value>,
) -> SnapbackResult<Value> {
    match result {
        Err(mut error) if claimed_code == Some("SNAPBACK_AUTH_PERMISSION_DENIED") => {
            match invocation.denial_witness.take() {
                Some(witness) => {
                    let context = error.take_private_failure_context();
                    Err(match context {
                        Some(context) => witness.with_private_failure_context(context),
                        None => witness,
                    })
                }
                None => Err(error),
            }
        }
        other => other,
    }
}

/// Restore the host-built structured stream refusal when the handler's final
/// error carries the same code (LLP 0076 §Diagnostics): the trusted
/// representation — operation, limit, value-free received summary, repair
/// anchor — survives the FFI/envelope round-trip, while a handler-forged
/// stream code with no recorded host refusal gets nothing attached.
fn restore_stream_refusal(
    invocation: &mut IbexHostContext<'_>,
    result: SnapbackResult<Value>,
) -> SnapbackResult<Value> {
    match result {
        Err(mut error) => {
            match invocation
                .stream_refusal
                .take()
                .filter(|recorded| recorded.diagnostic.code == error.diagnostic.code)
            {
                Some(recorded) => {
                    let context = error.take_private_failure_context();
                    Err(match context {
                        Some(context) => recorded.with_private_failure_context(context),
                        None => recorded,
                    })
                }
                None => Err(error),
            }
        }
        ok => ok,
    }
}

/// Evaluate one module in a fresh, non-callable VM and prove that its named
/// export exists before a deployment can cross its durable activation cut.
/// No app database context is installed, so setup code cannot perform a host
/// effect; syntax errors, top-level setup failures, and missing exports all
/// fail preflight.
///
/// @ref LLP 0058#consume-ordering-dev-to-sessions — every fallible executable
/// preparation step precedes the durable consume transaction.
pub(crate) fn prepare_ibex_module(
    module: &IbexModule,
    kind: &crate::manifest::FunctionKind,
) -> SnapbackResult<()> {
    let mode = match kind {
        crate::manifest::FunctionKind::Query | crate::manifest::FunctionKind::LiveQuery => {
            IbexInvocationMode::Query
        }
        crate::manifest::FunctionKind::Mutation => IbexInvocationMode::Mutation,
        crate::manifest::FunctionKind::Action => IbexInvocationMode::Action,
    };
    let export = serde_json::to_string(&module.export).map_err(handler_serialize_error)?;
    let probe = format!(
        r#"(() => {{
          const handlers = globalThis.__snapbackHandlers;
          if (handlers === null || typeof handlers !== 'object'
              || typeof handlers[{export}] !== 'function') {{
            throw new Error('SNAPBACK_HANDLER_EXPORT_MISSING: ' + {export}
              + ' is not registered; the handler source file must assign'
              + ' globalThis.__snapbackHandlers = {{ ' + {export}
              + ': async (ctx, args) => {{ ... }} }}'
              + ' (ES exports are refused at generation)');
          }}
          return true;
        }})()"#,
    );
    let source = format!(
        "{}\n{}\n{}\n{}\n{}",
        ambient_restriction_source(mode, outbound_actions_enabled()),
        allowlist_install_source(),
        ctx_bootstrap_source(),
        module.source,
        probe,
    );
    let runtime = RuntimeGuard::create()?;
    let output = eval(runtime.ptr(), &module.export, &source)?;
    let rejections = inspect_unhandled_rejections(runtime.ptr())?;
    if !rejections.is_empty() {
        return Err(unhandled_rejection_error(module, rejections));
    }
    if output != "true" {
        return Err(SnapbackError::error(
            "SNAPBACK_HANDLER_EXPORT_MISSING",
            "runtime",
            "prepared handler export did not resolve to a callable function; the handler \
             source file must assign it on globalThis.__snapbackHandlers = { <exportName>: \
             async (ctx, args) => { ... } } (ES exports are refused at generation)",
        ));
    }
    Ok(())
}

/// Post-eval drain of Ibex's native asynchronous-failure queue (ENG-23361).
/// `ex_hermes_eval` reaches a full microtask checkpoint before returning, so
/// this also observes detached chains that reject after the invocation promise
/// settles. Values remain rooted and are rendered through trap-free native
/// inspection; handler code cannot inspect, forge, or drain this queue.
/// @ref LLP 0009#harness-control-plane-boundary
fn inspect_unhandled_rejections(
    runtime: *mut HermesRuntimeOpaque,
) -> SnapbackResult<Vec<FailureCarrierV1>> {
    const EMPTY: u32 = 0;
    const AVAILABLE: u32 = 1;
    const DROPPED: u32 = 2;
    let mut rejections = Vec::new();
    loop {
        let mut event = HermesAsyncFailureEvent::current();
        match unsafe { ex_hermes_take_async_failure_event(runtime, &mut event) } {
            EMPTY => return Ok(rejections),
            AVAILABLE => {
                if event.abi_version != 1
                    || event.struct_size != std::mem::size_of::<HermesAsyncFailureEvent>() as u32
                    || event.value.runtime_nonce == 0
                    || event.value.handle_id == 0
                {
                    if event.value.runtime_nonce != 0 && event.value.handle_id != 0 {
                        unsafe {
                            ex_hermes_value_release(runtime, event.value);
                        }
                    }
                    return Err(rejection_inspection_invalid(
                        "Ibex returned a malformed asynchronous-failure event",
                    ));
                }
                rejections.push(render_and_release_async_failure(runtime, event.value)?);
            }
            DROPPED => {
                return Err(SnapbackError::error(
                    "SNAPBACK_HANDLER_REJECTION_DETECTION_UNAVAILABLE",
                    "runtime",
                    "Ibex's asynchronous-failure queue overflowed; the invocation failed closed",
                )
                .with_details(json!({ "droppedCount": event.dropped_count })));
            }
            status => {
                return Err(rejection_inspection_invalid(
                    "Ibex asynchronous-failure publication failed",
                )
                .with_details(json!({ "status": status })));
            }
        }
    }
}

fn rejection_inspection_invalid(message: &str) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_HANDLER_REJECTION_INSPECTION_INVALID",
        "runtime",
        format!("{message}; the invocation failed closed"),
    )
}

fn render_and_release_async_failure(
    runtime: *mut HermesRuntimeOpaque,
    handle: HermesValueHandle,
) -> SnapbackResult<FailureCarrierV1> {
    let rendered = render_async_failure(runtime, handle);
    let released = unsafe { ex_hermes_value_release(runtime, handle) };
    match (rendered, released) {
        (Ok(reason), 0) => Ok(reason),
        (Err(message), _) => Err(rejection_inspection_invalid(&message)),
        (Ok(_), fault) => Err(rejection_inspection_invalid(
            "Ibex could not release an asynchronous-failure value",
        )
        .with_details(json!({ "fault": fault }))),
    }
}

fn render_async_failure(
    runtime: *mut HermesRuntimeOpaque,
    handle: HermesValueHandle,
) -> Result<FailureCarrierV1, String> {
    const THROW_FIELD_MESSAGE: u32 = 1 << 0;
    const THROW_FIELD_STACK: u32 = 1 << 1;
    const THROW_FIELD_POSITIONS: u32 = 1 << 2;
    const THROW_FIELD_MESSAGE_TRUNCATED: u32 = 1 << 3;
    const THROW_FIELD_STACK_TRUNCATED: u32 = 1 << 4;
    const THROW_FIELDS_KNOWN: u32 = THROW_FIELD_MESSAGE
        | THROW_FIELD_STACK
        | THROW_FIELD_POSITIONS
        | THROW_FIELD_MESSAGE_TRUNCATED
        | THROW_FIELD_STACK_TRUNCATED;
    const VALUE_INVALID: u32 = 0;
    const VALUE_FUNCTION: u32 = 8;
    const VALUE_OBJECT: u32 = 9;
    const VALUE_ARRAY: u32 = 10;
    const SAFE_TEXT_MAX_BYTES: usize = 16_384;

    let mut metadata_fields = 0;
    let mut error_class = 0;
    let mut message = HermesOwnedBytes {
        data: ptr::null_mut(),
        length: 0,
    };
    let mut stack = HermesOwnedBytes {
        data: ptr::null_mut(),
        length: 0,
    };
    let metadata_fault = unsafe {
        ex_hermes_value_safe_throw_metadata(
            runtime,
            handle,
            &mut metadata_fields,
            &mut error_class,
            &mut message,
            &mut stack,
        )
    };
    let decoded = if metadata_fault != 0 {
        Err(format!(
            "Ibex safe throw inspection failed with fault {metadata_fault}"
        ))
    } else if metadata_fields & !THROW_FIELDS_KNOWN != 0 {
        Err("Ibex safe throw inspection returned unknown metadata flags".to_owned())
    } else if metadata_fields & THROW_FIELD_MESSAGE_TRUNCATED != 0
        && metadata_fields & THROW_FIELD_MESSAGE == 0
    {
        Err("Ibex safe throw inspection truncated an absent message".to_owned())
    } else if metadata_fields & THROW_FIELD_STACK_TRUNCATED != 0
        && metadata_fields & THROW_FIELD_STACK == 0
    {
        Err("Ibex safe throw inspection truncated an absent stack".to_owned())
    } else {
        let decoded_message = if metadata_fields & THROW_FIELD_MESSAGE != 0 {
            copy_native_utf8(
                message.data,
                message.length,
                SAFE_TEXT_MAX_BYTES,
                "error message",
            )
        } else {
            Ok(None)
        };
        let decoded_stack = if metadata_fields & THROW_FIELD_STACK != 0 {
            copy_native_utf8(stack.data, stack.length, SAFE_TEXT_MAX_BYTES, "error stack")
        } else {
            Ok(None)
        };
        decoded_message.and_then(|message| decoded_stack.map(|stack| (message, stack)))
    };
    unsafe {
        ex_hermes_free_string(message.data.cast());
        ex_hermes_free_string(stack.data.cast());
    }
    let (decoded_message, decoded_stack) = decoded?;
    let raw_error_class = error_class_name(error_class)?;
    if decoded_message
        .as_deref()
        .is_some_and(|message| !message.is_empty())
        || decoded_stack.is_some()
        || error_class != 0
    {
        return Ok(FailureCarrierV1 {
            error_class: validated_error_class(raw_error_class),
            message: decoded_message,
            stack: decoded_stack,
            message_extraction_truncated: metadata_fields & THROW_FIELD_MESSAGE_TRUNCATED != 0,
            stack_extraction_truncated: metadata_fields & THROW_FIELD_STACK_TRUNCATED != 0,
        });
    }

    let kind = unsafe { ex_hermes_value_kind(runtime, handle) };
    if kind == VALUE_INVALID {
        return Err("Ibex returned a stale asynchronous-failure value".to_owned());
    }
    if matches!(kind, VALUE_FUNCTION | VALUE_OBJECT | VALUE_ARRAY) {
        return Ok(extract_failure_carrier(
            None,
            Some("unserializable rejection reason"),
            None,
        ));
    }

    let mut data = ptr::null_mut();
    let mut length = 0;
    let mut truncated = 0;
    let fault = unsafe {
        ex_hermes_value_stage1_text(runtime, handle, &mut data, &mut length, &mut truncated)
    };
    let text = if fault != 0 {
        Err(format!(
            "Ibex primitive rejection inspection failed with fault {fault}"
        ))
    } else if truncated > 1 {
        Err("Ibex primitive rejection inspection returned an invalid truncation flag".to_owned())
    } else {
        copy_native_utf8(
            data,
            length,
            SAFE_TEXT_MAX_BYTES,
            "primitive rejection reason",
        )
        .and_then(|value| {
            value
                .ok_or_else(|| "Ibex primitive rejection inspection omitted its payload".to_owned())
        })
    };
    unsafe {
        ex_hermes_free_string(data.cast());
    }
    text.map(|message| FailureCarrierV1 {
        error_class: UNCLASSIFIED_ERROR_CLASS.to_owned(),
        message: Some(message),
        stack: None,
        message_extraction_truncated: truncated == 1,
        stack_extraction_truncated: false,
    })
}

fn copy_native_utf8(
    data: *mut u8,
    length: usize,
    maximum: usize,
    label: &str,
) -> Result<Option<String>, String> {
    if data.is_null() {
        return if length == 0 {
            Ok(None)
        } else {
            Err(format!("Ibex {label} returned a null non-empty payload"))
        };
    }
    if length > maximum {
        return Err(format!("Ibex {label} exceeded the {maximum}-byte bound"));
    }
    let bytes = unsafe { std::slice::from_raw_parts(data, length) };
    std::str::from_utf8(bytes)
        .map(|text| Some(text.to_owned()))
        .map_err(|_| format!("Ibex {label} was not valid UTF-8"))
}

fn error_class_name(error_class: u32) -> Result<Option<&'static str>, String> {
    match error_class {
        0 => Ok(None),
        1 => Ok(Some("Error")),
        2 => Ok(Some("AggregateError")),
        3 => Ok(Some("EvalError")),
        4 => Ok(Some("RangeError")),
        5 => Ok(Some("ReferenceError")),
        6 => Ok(Some("SyntaxError")),
        7 => Ok(Some("TypeError")),
        8 => Ok(Some("URIError")),
        9 => Ok(Some("TimeoutError")),
        10 => Ok(Some("QuitError")),
        _ => Err("Ibex safe throw inspection returned an unknown error class".to_owned()),
    }
}

/// A handler that completes while a detached promise chain it spawned
/// rejected unobserved did *partial* work: the chain's earlier host calls
/// are buffered, its later ones silently skipped. Reporting success would
/// commit that partial work (ENG-23361), so the invocation fails closed and
/// the buffer is discarded — Node crashes on unhandled rejections and Convex
/// fails the mutation; silently swallowing them is the one wrong option.
pub(crate) fn unhandled_rejection_error(
    module: &IbexModule,
    rejections: Vec<FailureCarrierV1>,
) -> SnapbackError {
    let public_rejections = rejections
        .iter()
        .map(|carrier| {
            carrier
                .message
                .clone()
                .filter(|message| !message.is_empty())
                .unwrap_or_else(|| carrier.error_class.clone())
        })
        .collect::<Vec<_>>();
    SnapbackError::error(
        "SNAPBACK_HANDLER_UNHANDLED_REJECTION",
        "runtime",
        "handler completed with unhandled promise rejection(s) — the invocation failed and committed no writes",
    )
    .with_details(json!({
        "function": module.export,
        "rejections": public_rejections,
    }))
    .with_private_failure_context(PrivateFailureContextV1 {
        carriers: rejections,
        app_refusal_tracking: None,
    })
}

/// Unwrap the invoke IIFE's tagged completion envelope. The tag is
/// load-bearing: a status-0 eval does NOT prove the handler ran to
/// completion, because the eval loop's no-progress fallback returns the
/// still-pending invocation promise (stringified to "{}"). Only the IIFE
/// constructs the {"r": ...} envelope, and only after the awaited handler
/// value exists — so anything untagged on this channel means the handler
/// never settled and must fail closed with nothing committed (ENG-23430).
/// That includes a `{"r": ...}` whose `r` carries no boolean `__snapbackOk`:
/// the settle wrapper always tags, so an untagged `r` proves nothing about
/// settlement and fails closed too, matching the JS decoder in
/// `packages/snapback-harness/envelope.mjs` (ENG-23603).
/// Admit a claimed application refusal only when the invoked function declared
/// its code (LLP 0108 §Declared application refusals). The claim arrives inside
/// the handler envelope, so it is untrusted exactly like any other handler
/// output: the *declaration* is what types it. An undeclared or forged code —
/// including one that mimics a platform diagnostic — folds to the generic
/// handler failure, and the app payload is dropped with it.
fn admit_declared_refusal(
    declared: &[String],
    tracked: &[String],
    result: SnapbackResult<Value>,
) -> SnapbackResult<Value> {
    let Err(mut error) = result else {
        return result;
    };
    if error.diagnostic.code != "SNAPBACK_APP_REFUSAL" {
        return Err(error);
    }
    let claimed = error
        .diagnostic
        .details
        .get("appCode")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    if claimed.is_empty() || !declared.iter().any(|code| code == &claimed) {
        let context = error.take_private_failure_context();
        let folded = SnapbackError::error(
            "SNAPBACK_HANDLER_FAILED",
            "runtime",
            "JavaScript handler failed",
        )
        .with_details(json!({
            "function": error.diagnostic.details.get("function").cloned().unwrap_or(Value::Null),
            "message": "handler raised an undeclared application refusal",
        }));
        return Err(match context {
            Some(context) => folded.with_private_failure_context(context),
            None => folded,
        });
    }
    let mut context = error.take_private_failure_context().unwrap_or_default();
    context.app_refusal_tracking = Some(if tracked.iter().any(|code| code == &claimed) {
        AppRefusalTrackingV1::Tracked
    } else {
        AppRefusalTrackingV1::AdmittedUntracked
    });
    Err(error.with_private_failure_context(context))
}

/// Fold-only projection of [`parse_handler_output_with_claim`]; production
/// callers consume the claim, so only the projection tests use this shape.
#[cfg(test)]
pub(crate) fn parse_handler_output(module: &IbexModule, output: String) -> SnapbackResult<Value> {
    parse_handler_output_with_claim(module, output).0
}

fn handler_failure_carrier(object: &Map<String, Value>) -> FailureCarrierV1 {
    let mut carrier = extract_failure_carrier(
        object.get("errorClass").and_then(Value::as_str),
        object.get("message").and_then(Value::as_str),
        object.get("stack").and_then(Value::as_str),
    );
    // The harness already bounds and flags extraction. Re-apply the Rust
    // validator/bound defensively because the envelope is still handler-side
    // bytes, and preserve either side's truncation witness.
    carrier.error_class = validated_error_class(Some(&carrier.error_class));
    carrier.message_extraction_truncated |= object
        .get("messageExtractionTruncated")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    carrier.stack_extraction_truncated |= object
        .get("stackExtractionTruncated")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    carrier
}

fn with_handler_failure_carrier(error: SnapbackError, carrier: FailureCarrierV1) -> SnapbackError {
    error.with_private_failure_context(PrivateFailureContextV1 {
        carriers: vec![carrier],
        app_refusal_tracking: None,
    })
}

/// [`parse_handler_output`] plus the RAW (pre-fold) claimed code from a
/// not-ok envelope. The claim is handler-controlled bytes — it is only
/// meaningful when corroborated by a host-recorded witness (0137 a4-f5,
/// `restore_host_failure_witness` / `restore_denial_witness`); the returned
/// error itself always carries the folded public code.
pub(crate) fn parse_handler_output_with_claim(
    module: &IbexModule,
    output: String,
) -> (SnapbackResult<Value>, Option<String>) {
    if let Ok(Value::Object(mut envelope)) = serde_json::from_str(&output)
        && envelope.len() == 1
        && let Some(result) = envelope.remove("r")
        && let Some(object) = result.as_object()
        && let Some(ok) = object.get("__snapbackOk").and_then(Value::as_bool)
    {
        if ok {
            return (
                Ok(object.get("value").cloned().unwrap_or(Value::Null)),
                None,
            );
        }
        let claimed = object
            .get("code")
            .and_then(Value::as_str)
            .map(str::to_owned);
        let code = claimed
            .as_deref()
            .map(handler_envelope_code)
            .unwrap_or("SNAPBACK_HANDLER_FAILED");
        let message = object
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("JavaScript handler failed");
        let carrier = handler_failure_carrier(object);
        // A claimed application refusal carries its app code and JSON details
        // through to `admit_declared_refusal`, which drops both unless the
        // function declared the code (LLP 0108).
        if code == "SNAPBACK_APP_REFUSAL" {
            let app_code = object.get("appCode").and_then(Value::as_str);
            if let Some(app_code) = app_code {
                return (
                    Err(with_handler_failure_carrier(
                        SnapbackError::error(code, "runtime", "application refusal").with_details(
                            json!({
                                "function": module.export,
                                "message": message,
                                "appCode": app_code,
                                "appDetails": object.get("appDetails").cloned().unwrap_or(Value::Null),
                            }),
                        ),
                        carrier,
                    )),
                    claimed,
                );
            }
        }
        return (
            Err(with_handler_failure_carrier(
                SnapbackError::error(code, "runtime", "JavaScript handler failed").with_details(
                    json!({
                        "function": module.export,
                        "message": message,
                    }),
                ),
                carrier,
            )),
            claimed,
        );
    }
    (
        Err(SnapbackError::error(
            "SNAPBACK_HANDLER_DID_NOT_SETTLE",
            "runtime",
            "handler promise never settled — the invocation produced no result and committed no writes",
        )
        .with_details(json!({
            "function": module.export,
            "outputLengthBytes": output.len(),
            "outputSha256": format!("sha256:{:x}", Sha256::digest(output.as_bytes())),
        }))),
        None,
    )
}

// The 4 MiB `result_contract` remains the application-result limit. The
// carrier has modest tagged-envelope overhead, so match workerd's 8 MiB
// pre-parse refusal and bound the native scan before allocating a Rust String.
//
// @ref LLP 0009#bounded-ibex-evaluation-carrier-and-single-payload-invocation-2026-08-12 —
// untrusted eval output is bounded before the native-to-Rust copy.
pub(super) extern "C" fn snapback_host_call(
    op: *const c_char,
    args_json: *const c_char,
) -> *mut c_char {
    let result = std::panic::catch_unwind(|| {
        let raw_op = c_string_to_string(op)?;
        // Every legitimate host call is emitted by the per-invocation `host()`
        // closure as "<epoch>|<op>" — the epoch is baked into that closure at
        // invocation time, so a stale continuation carries the *prior*
        // invocation's epoch. A bare op (no separator) can only come from code
        // calling `__hostCall` directly, bypassing `ctx`; that is unsupported
        // and fails closed.
        let (epoch_str, op) = raw_op.split_once('|').ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_HANDLER_HOST_CALL_MALFORMED",
                "runtime",
                "handler host call was not issued through ctx",
            )
        })?;
        let call_epoch = epoch_str.parse::<u64>().map_err(|_| {
            SnapbackError::error(
                "SNAPBACK_HANDLER_HOST_CALL_MALFORMED",
                "runtime",
                "handler host call carried an unparseable invocation epoch",
            )
        })?;
        let args_json = c_string_to_string(args_json)?;
        let args = serde_json::from_str::<Value>(&args_json).map_err(|error| {
            SnapbackError::error(
                "SNAPBACK_HANDLER_HOST_CALL_INVALID_JSON",
                "runtime",
                "handler host call arguments were not valid JSON",
            )
            .with_details(json!({ "error": error.to_string() }))
        })?;

        CURRENT_IBEX_HOST_CONTEXT.with(|slot| {
            let ptr = *slot.borrow();
            if ptr.is_null() {
                return Err(SnapbackError::error(
                    "SNAPBACK_HANDLER_HOST_CALL_WITHOUT_CONTEXT",
                    "runtime",
                    "handler host call ran without an invocation context",
                ));
            }
            let ctx = unsafe { &mut *(ptr as *mut IbexHostContext<'_>) };
            // @ref LLP 0009#dk-4-as-built--the-warm-vm-pool-and-its-per-invocation-reset-2026-07-02 —
            // the stale-continuation guard: a continuation captured in module
            // scope by invocation A, fired during invocation B's microtask
            // pump on the same warm VM, would otherwise route A's `ctx.db.*`
            // through B's live context (B's auth, B's commit buffer). Reject
            // the mismatch fail-closed rather than execute A against B.
            if ctx.epoch() != call_epoch {
                return Err(SnapbackError::error(
                    "SNAPBACK_HANDLER_STALE_CONTINUATION",
                    "runtime",
                    "a handler continuation from a prior invocation attempted a \
                     host call against the current invocation; rejected",
                ));
            }
            dispatch_host_call(ctx, op, args)
        })
    });

    match result {
        Ok(Ok(value)) => c_host_response('+', value.to_string()),
        Ok(Err(error)) => c_host_response('-', error.to_string()),
        Err(_) => c_host_response('-', "SNAPBACK_HANDLER_HOST_CALL_PANIC".to_owned()),
    }
}

fn invocation_source(
    module: &IbexModule,
    invocation: &IbexHostContext<'_>,
) -> SnapbackResult<String> {
    // @ref LLP 0009#harness-control-plane-boundary — trusted helpers install
    // and seal their globals before untrusted module source evaluates.
    Ok(format!(
        "{}\n{}\n{}\n{}\n{}",
        ambient_restriction_source(invocation.mode, outbound_actions_enabled()),
        allowlist_install_source(),
        ctx_bootstrap_source(),
        module.source,
        invocation_iife_source(module, invocation)?,
    ))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct IbexInvocationPayload<'a> {
    export: &'a str,
    args_json: String,
    auth_json: String,
    mode: &'static str,
    run_json: String,
    secrets_json: String,
    epoch: String,
}

fn invocation_iife_source(
    module: &IbexModule,
    invocation: &IbexHostContext<'_>,
) -> SnapbackResult<String> {
    let input = &invocation.input;
    let args_json = serde_json::to_string(&input.args).map_err(handler_serialize_error)?;
    let auth_json =
        serde_json::to_string(&invocation.handler_auth).map_err(handler_serialize_error)?;
    let mode = match invocation.mode {
        IbexInvocationMode::Query => "query",
        IbexInvocationMode::Mutation => "mutation",
        IbexInvocationMode::Action => "action",
    };
    let run_json =
        serde_json::to_string(&invocation.action_run).map_err(handler_serialize_error)?;

    // The granted-config payload is exposed only to actions (and is never
    // client-visible): the host-computed per-invocation `uses` grant.
    //
    // @ref LLP 0036#runtime-exposure-d5-d8 — handles, actions only.
    let secrets_json = if matches!(invocation.mode, IbexInvocationMode::Action) {
        invocation.grants.to_string()
    } else {
        "null".to_string()
    };
    // The epoch travels as a decimal *string* literal so it is exact past the
    // f64 safe-integer range; JS concatenates it onto every host op. Baking it
    // into this per-invocation IIFE (and thus into the `ctx` closures the
    // bootstrap builds) is what lets the host reject a stale continuation.
    let payload_json = serde_json::to_string(&IbexInvocationPayload {
        export: &module.export,
        args_json,
        auth_json,
        mode,
        run_json,
        secrets_json,
        epoch: invocation.epoch().to_string(),
    })
    .map_err(handler_serialize_error)?;
    let payload_literal = serde_json::to_string(&payload_json).map_err(handler_serialize_error)?;

    // The IIFE resolves to a tagged envelope ({"r": ...}), never a bare
    // value. The vendored eval loop cannot always drive the promise to
    // settlement: with no timers and no pending host work it falls back to
    // returning the still-pending Promise with SUCCESS status, which
    // JSON-stringifies to "{}" — indistinguishable from a handler that
    // legitimately returned {} if the channel is untagged. The envelope is
    // only ever constructed after the awaited handler value exists, so an
    // untagged output proves the handler never settled (ENG-23430).
    // Non-JSON-serializable returns (function/symbol) are rejected here in
    // JS, the only place they are still distinguishable — JSON.stringify
    // yields undefined for them, which an untagged channel silently turned
    // into a null result.
    //
    // @ref LLP 0009#bounded-ibex-evaluation-carrier-and-single-payload-invocation-2026-08-12 —
    // one serialized payload crosses the trusted-template boundary. The slot
    // includes raw newlines, which cannot occur in a serde_json string literal,
    // and is split exactly once rather than globally replacing user-adjacent
    // tokens. The tagged settlement contract above is otherwise unchanged.
    let template = include_str!("../../../../packages/snapback-harness/invocation-iife.js");
    let (prefix, suffix) = template
        .split_once(INVOCATION_IIFE_PAYLOAD_SLOT)
        .expect("invocation IIFE must contain its single payload slot");
    assert!(
        !suffix.contains(INVOCATION_IIFE_PAYLOAD_SLOT),
        "invocation IIFE payload slot must be unique"
    );
    Ok(format!("{prefix}{payload_literal}{suffix}"))
}

fn required_string(args: &Value, key: &str) -> SnapbackResult<String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_HANDLER_HOST_CALL_INVALID",
                "runtime",
                format!("handler host call missing string field {key}"),
            )
        })
}

fn optional_nullable_string(args: &Value, key: &str) -> SnapbackResult<Option<String>> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.clone())),
        Some(_) => Err(SnapbackError::error(
            "SNAPBACK_HANDLER_HOST_CALL_INVALID",
            "runtime",
            format!("handler host call field {key} must be a string or null"),
        )),
    }
}

fn required_object(args: &Value, key: &str) -> SnapbackResult<Map<String, Value>> {
    args.get(key)
        .and_then(Value::as_object)
        .cloned()
        .ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_HANDLER_HOST_CALL_INVALID",
                "runtime",
                format!("handler host call missing object field {key}"),
            )
        })
}

fn reject_batch_descriptor_extras(args: &Value, allowed: &[&str]) -> SnapbackResult<()> {
    let Some(object) = args.as_object() else {
        return Err(SnapbackError::error(
            "SNAPBACK_BATCH_READ_INPUT_INVALID",
            "runtime",
            "ctx.db batch-read descriptor must be an object",
        ));
    };
    if let Some(unexpected) = object.keys().find(|key| !allowed.contains(&key.as_str())) {
        return Err(SnapbackError::error(
            "SNAPBACK_BATCH_READ_INPUT_INVALID",
            "runtime",
            "ctx.db batch-read descriptor contains an unknown member",
        )
        .with_details(json!({ "member": unexpected })));
    }
    Ok(())
}

fn required_batch_string(args: &Value, key: &str) -> SnapbackResult<String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_BATCH_READ_INPUT_INVALID",
                "runtime",
                format!("ctx.db batch-read field {key} must be a string"),
            )
        })
}

fn required_batch_ids(args: &Value, key: &str) -> SnapbackResult<Vec<String>> {
    let values = args.get(key).and_then(Value::as_array).ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_BATCH_READ_INPUT_INVALID",
            "runtime",
            format!("ctx.db.getMany field {key} must be an array"),
        )
    })?;
    values
        .iter()
        .enumerate()
        .map(|(position, value)| {
            value.as_str().map(str::to_owned).ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_BATCH_READ_INPUT_INVALID",
                    "runtime",
                    "ctx.db.getMany ids must be strings",
                )
                .with_details(json!({ "position": position }))
            })
        })
        .collect()
}

fn required_batch_keys(args: &Value, key: &str) -> SnapbackResult<Vec<Map<String, Value>>> {
    let values = args.get(key).and_then(Value::as_array).ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_BATCH_READ_INPUT_INVALID",
            "runtime",
            format!("ctx.db.uniqueMany field {key} must be an array"),
        )
    })?;
    values
        .iter()
        .enumerate()
        .map(|(position, value)| {
            value.as_object().cloned().ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_BATCH_READ_INPUT_INVALID",
                    "runtime",
                    "ctx.db.uniqueMany keys must be objects",
                )
                .with_details(json!({ "position": position }))
            })
        })
        .collect()
}

fn enforce_batch_read_request_bounds(args: &Value, item_count: usize) -> SnapbackResult<()> {
    if item_count > BATCH_READ_MAX_ITEMS {
        return Err(SnapbackError::error(
            "SNAPBACK_BATCH_READ_ITEMS_EXCEEDED",
            "runtime",
            format!(
                "ctx.db batch-read request contains {item_count} items; maximum is {BATCH_READ_MAX_ITEMS}"
            ),
        )
        .with_details(json!({
            "itemCount": item_count,
            "maxItems": BATCH_READ_MAX_ITEMS,
        })));
    }
    let canonical = crate::rqs_contract::jcs(args).map_err(|_| {
        SnapbackError::error(
            "SNAPBACK_BATCH_READ_INPUT_INVALID",
            "runtime",
            "ctx.db batch-read descriptor could not be canonically encoded",
        )
    })?;
    if canonical.len() > BATCH_READ_MAX_INPUT_BYTES {
        return Err(SnapbackError::error(
            "SNAPBACK_BATCH_READ_INPUT_BYTES_EXCEEDED",
            "runtime",
            format!(
                "ctx.db batch-read request exceeds the {BATCH_READ_MAX_INPUT_BYTES}-byte canonical input ceiling"
            ),
        )
        .with_details(json!({
            "inputBytes": canonical.len(),
            "maxInputBytes": BATCH_READ_MAX_INPUT_BYTES,
        })));
    }
    Ok(())
}

fn required_nonempty_string_array(args: &Value, key: &str) -> SnapbackResult<Vec<String>> {
    let values = args
        .get(key)
        .and_then(Value::as_array)
        .filter(|values| !values.is_empty())
        .ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_HANDLER_HOST_CALL_INVALID",
                "runtime",
                format!("handler host call requires a nonempty string array field {key}"),
            )
        })?;
    values
        .iter()
        .map(|value| {
            value
                .as_str()
                .filter(|value| !value.is_empty())
                .map(str::to_owned)
                .ok_or_else(|| {
                    SnapbackError::error(
                        "SNAPBACK_HANDLER_HOST_CALL_INVALID",
                        "runtime",
                        format!("handler host call field {key} must contain only nonempty strings"),
                    )
                })
        })
        .collect()
}

fn row_version(row: &Value) -> SnapbackResult<u64> {
    row.get("_version").and_then(Value::as_u64).ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_CAPTURED_READ_INVALID",
            "runtime",
            "read row was missing a numeric _version",
        )
    })
}

fn auth_dependencies(input: &HandlerInput) -> Vec<CapturedReadDependency> {
    let mut reads = Vec::new();
    if let Some(user_id) = &input.auth.user_id {
        reads.push(CapturedReadDependency {
            kind: CapturedReadKind::Auth,
            table: None,
            id: None,
            version: None,
            predicate: None,
            rows: Vec::new(),
            field: Some("userId".to_owned()),
            value: Some(Value::String(user_id.clone())),
            order: None,
            limit: None,
            result_count: None,
            boundary: None,
        });
    }
    reads
}

fn read_dependency_keys(reads: &[CapturedReadDependency]) -> HashSet<String> {
    reads.iter().map(read_dependency_key).collect()
}

fn read_dependency_key(dependency: &CapturedReadDependency) -> String {
    serde_json::to_string(dependency).unwrap_or_else(|_| format!("{dependency:?}"))
}

fn row_id_for_sort(row: &Value) -> &str {
    row.get("_id").and_then(Value::as_str).unwrap_or("")
}

fn handler_envelope_code(code: &str) -> &str {
    match code {
        "SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED" => "SNAPBACK_HANDLER_CAPABILITY_DENIED",
        "SNAPBACK_HANDLER_WRITE_IN_QUERY"
        | "SNAPBACK_HANDLER_EXPORT_MISSING"
        | "SNAPBACK_HANDLER_RESULT_INVALID"
        | "SNAPBACK_HANDLER_STALE_CONTINUATION"
        | "SNAPBACK_CONFIG_UNDECLARED"
        | "SNAPBACK_CONFIG_MISSING"
        // @ref LLP 0058#complete-gate-coverage — an action's nested
        // runMutation requirement failure keeps its typed auth code inside
        // the ordinary FunctionRunResult envelope.
        | "SNAPBACK_AUTH_REQUIRED"
        | "SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY"
        | "SNAPBACK_AUTH_MUTABLE_INPUT_DENIED"
        | "SNAPBACK_AUTH_AUTHORITY_CREATING_UNCONSENTED"
        | "SNAPBACK_ACTION_CONTEXT_UNAVAILABLE"
        | "SNAPBACK_ACTION_GENERATION_CONFLICT"
        | "SNAPBACK_ACTION_TIMEOUT"
        // @ref LLP 0076#diagnostics — every promised stream refusal family
        // must survive the handler envelope with its exact code.
        | "SNAPBACK_ACTION_STREAM_CANCELLED"
        | "SNAPBACK_ACTION_STREAM_IDLE_TIMEOUT"
        | "SNAPBACK_ACTION_STREAM_INVALID"
        | "SNAPBACK_ACTION_STREAM_SSRF_REFUSED"
        | "SNAPBACK_ACTION_STREAM_LIMIT_EXCEEDED"
        | "SNAPBACK_ACTION_STREAM_TIMEOUT"
        | "SNAPBACK_ACTION_STREAM_UNSUPPORTED"
        | "SNAPBACK_ACTION_STREAM_UPSTREAM_AMBIGUOUS"
        | "SNAPBACK_ACTION_STREAM_UPSTREAM_FAILED"
        | "SNAPBACK_ACTION_PROGRESS_RATE_EXCEEDED"
        // @ref LLP 0204#d91--streaming-conversations — output
        // stream host refusals are platform-authored and remain observable by
        // the running action, including cancellation on its next emit.
        | "SNAPBACK_STREAM_ATTEMPT_LIMIT_EXCEEDED"
        | "SNAPBACK_STREAM_ATTEMPT_NOT_FOUND"
        | "SNAPBACK_STREAM_CANCELLED"
        | "SNAPBACK_STREAM_CHUNK_INVALID"
        | "SNAPBACK_STREAM_CHUNK_TOO_LARGE"
        | "SNAPBACK_STREAM_FORBIDDEN"
        | "SNAPBACK_STREAM_INITIATOR_REQUIRED"
        | "SNAPBACK_STREAM_NOT_DECLARED"
        | "SNAPBACK_STREAM_RATE_LIMITED"
        | "SNAPBACK_STREAM_RUNNER_FENCED"
        | "SNAPBACK_STREAM_TERMINAL"
        // Parity with envelope.mjs's PASSTHROUGH_CODES: the bounded host
        // fetch response refusals survive with their exact code on both
        // decoders (0137 a4-f1/a5-f1 — ctx.fetch is now target-portable).
        // @ref LLP 0251#consumerprofile-contract — the shared destination floor's refusal
        // is host-authored and must remain typed across the Rust envelope.
        | "SNAPBACK_HOST_FETCH_SSRF_REFUSED"
        | "SNAPBACK_HOST_FETCH_RESPONSE_TOO_LARGE"
        | "SNAPBACK_HOST_FETCH_RESPONSE_INVALID_UTF8"
        // @ref LLP 0158#the-runtime-plane--where-the-real-design-is — the
        // derived-deployment quarantine is a host-owned typed refusal, not an
        // application-claimable diagnostic.
        | "SNAPBACK_FORK_EGRESS_DENIED"
        | "SNAPBACK_BUFFERED_WRITE_LIMIT_EXCEEDED"
        | "SNAPBACK_OVERLOADED"
        | "SNAPBACK_VALUE_TOO_LARGE"
        // @ref LLP 0135#3-capability-ids-and-diagnostics — sequence runtime
        // outcomes remain typed across both handler-envelope decoders.
        | "SNAPBACK_SEQUENCE_EXHAUSTED"
        | "SNAPBACK_SEQUENCE_UNDECLARED"
        | "SNAPBACK_MUTATION_SETTLEMENT_UNAVAILABLE"
        | "SNAPBACK_RELATION_PARENT_UNAVAILABLE"
        // LLP 0051 D1: ledger divergence and the ledger-length limit are
        // typed results, not generic handler failures.
        | "SNAPBACK_CTX_LEDGER_EXHAUSTED"
        | "SNAPBACK_CTX_LEDGER_LIMIT_EXCEEDED"
        | "SNAPBACK_QUERY_FILTER_BINDINGS_EXCEEDED"
        | "SNAPBACK_QUERY_FILTER_VALUE_INVALID"
        | "SNAPBACK_QUERY_IN_ITEMS_EXCEEDED"
        | "SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED"
        | "SNAPBACK_QUERY_LIMIT_INVALID"
        | "SNAPBACK_BATCH_READ_INPUT_INVALID"
        | "SNAPBACK_BATCH_READ_ITEMS_EXCEEDED"
        | "SNAPBACK_BATCH_READ_INPUT_BYTES_EXCEEDED"
        | "SNAPBACK_BATCH_READ_RESPONSE_BYTES_EXCEEDED"
        | "SNAPBACK_BATCH_READ_INDEX_INVALID"
        | "SNAPBACK_BATCH_READ_KEY_INVALID"
        | "SNAPBACK_BATCH_READ_UNIQUE_INVARIANT_CORRUPT"
        | "SNAPBACK_TABLE_VISIBILITY_PLAN_MISMATCH"
        // @ref LLP 0264#d10-diagnostics-and-refusal-vocabulary — host-owned
        // ordinary-write refusals survive the handler envelope unchanged.
        | "SNAPBACK_TABLE_WRITE_UNDECLARED_REFUSED"
        | "SNAPBACK_TABLE_WRITE_UNCOMPOSED_SURFACE"
        | "SNAPBACK_TABLE_WRITE_POLICY_INELIGIBLE"
        | "SNAPBACK_TABLE_WRITE_OWNER_INPUT_REFUSED"
        | "SNAPBACK_TABLE_WRITE_OWNER_IMMUTABLE"
        | "SNAPBACK_MEMBERSHIP_UNKNOWN_DECLARATION"
        // A claimed application refusal survives the fold only far enough to
        // reach `admit_declared_refusal`, which drops it unless the function
        // declared the carried app code (LLP 0108).
        | "SNAPBACK_APP_REFUSAL" => code,
        code if code.starts_with("SNAPBACK_HANDLER_HOST_CALL_") => code,
        _ => "SNAPBACK_HANDLER_FAILED",
    }
}

#[cfg(debug_assertions)]
struct CapturedPointReadDebugHook {
    table: String,
    id: String,
    sender: mpsc::Sender<()>,
    release: mpsc::Receiver<()>,
}

#[cfg(debug_assertions)]
static CAPTURED_POINT_READ_DEBUG_HOOK: OnceLock<StdMutex<Option<CapturedPointReadDebugHook>>> =
    OnceLock::new();

#[cfg(debug_assertions)]
#[doc(hidden)]
pub struct CapturedPointReadDebugHookGuard;

#[cfg(debug_assertions)]
impl Drop for CapturedPointReadDebugHookGuard {
    fn drop(&mut self) {
        *captured_point_read_debug_hook()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
    }
}

#[cfg(debug_assertions)]
#[doc(hidden)]
pub fn set_captured_point_read_debug_hook(
    table: &str,
    id: &str,
    sender: mpsc::Sender<()>,
    release: mpsc::Receiver<()>,
) -> CapturedPointReadDebugHookGuard {
    *captured_point_read_debug_hook()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(CapturedPointReadDebugHook {
        table: table.to_owned(),
        id: id.to_owned(),
        sender,
        release,
    });
    CapturedPointReadDebugHookGuard
}

#[cfg(debug_assertions)]
fn captured_point_read_debug_hook() -> &'static StdMutex<Option<CapturedPointReadDebugHook>> {
    CAPTURED_POINT_READ_DEBUG_HOOK.get_or_init(|| StdMutex::new(None))
}

#[cfg(debug_assertions)]
fn notify_captured_point_read(table: &str, id: &str) {
    // @ref LLP 0003#execution-and-write-semantics — The conflict proof needs
    // the handler's captured read to precede the competing commit. Consume the
    // matching debug hook once, then wait without holding the global hook lock.
    let hook = {
        let mut hook = captured_point_read_debug_hook()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if hook
            .as_ref()
            .is_some_and(|hook| hook.table == table && hook.id == id)
        {
            hook.take()
        } else {
            None
        }
    };
    if let Some(hook) = hook
        && hook.sender.send(()).is_ok()
    {
        let _ = hook
            .release
            .recv_timeout(std::time::Duration::from_secs(10));
    }
}

#[cfg(not(debug_assertions))]
fn notify_captured_point_read(_table: &str, _id: &str) {}

fn c_string_to_string(ptr: *const c_char) -> SnapbackResult<String> {
    if ptr.is_null() {
        return Ok(String::new());
    }
    Ok(unsafe { CStr::from_ptr(ptr) }
        .to_string_lossy()
        .into_owned())
}

fn c_host_response(prefix: char, text: String) -> *mut c_char {
    let sanitized = text.replace('\0', "\\0");
    let value = format!("{prefix}{sanitized}");
    let bytes = value.as_bytes();
    unsafe {
        let ptr = libc::malloc(bytes.len() + 1) as *mut u8;
        if ptr.is_null() {
            return ptr::null_mut();
        }
        ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, bytes.len());
        *ptr.add(bytes.len()) = 0;
        ptr as *mut c_char
    }
}

fn handler_serialize_error(error: serde_json::Error) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_HANDLER_INPUT_SERIALIZE_FAILED",
        "runtime",
        "handler invocation input could not be serialized",
    )
    .with_details(json!({ "error": error.to_string() }))
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod runtime_boundary_hardening_tests {
    use super::{
        IBEX_EVAL_OUTPUT_MAX_BYTES, IbexHostContext, dispatch_host_call, parse_handler_output,
        run_ibex_handler_with_context, with_captured_handler_console_stderr, with_host_call_trace,
        with_runtime_log_telemetry_redactor,
    };
    use crate::auth::admission::AdmissionLease;
    use crate::auth::invocation::{HandlerAuthProjection, ResolvedAppAuthority};
    use crate::config::SecretRedactor;
    use crate::manifest::{HandlerInput, IbexModule};
    use crate::storage::{DbRead, LocalDatabase, MembershipWriter};
    use serde_json::json;
    use sha2::{Digest as _, Sha256};

    fn query_context<'a>(db: &'a LocalDatabase, input: HandlerInput) -> IbexHostContext<'a> {
        let authority = ResolvedAppAuthority::Anonymous;
        IbexHostContext::new_with_projection(
            DbRead::Live(db),
            input,
            HandlerAuthProjection::from_authority(&authority, None).unwrap(),
            AdmissionLease::unmanaged(0, 0),
            MembershipWriter::from_resolved(&authority),
            false,
            true,
        )
        .unwrap()
    }

    #[test]
    fn runtime_log_and_host_fetch_trace_use_the_staged_secret_redactor() {
        let secret = "runtime-log-secret-0250";
        let telemetry = crate::telemetry::Telemetry::in_memory(
            "01900000-0000-7000-8000-000000000250",
            crate::telemetry::TelemetryConfig::default(),
        )
        .unwrap();
        let db = LocalDatabase::memory().unwrap();
        let mut invocation = query_context(
            &db,
            HandlerInput {
                args: json!({"injectedSecret": secret}),
                ..HandlerInput::default()
            },
        );
        let module = IbexModule {
            source: r#"
                globalThis.__snapbackHandlers = {
                  async logInjected(_ctx, args) {
                    console.error(args.injectedSecret);
                    return null;
                  }
                };
            "#
            .to_owned(),
            export: "logInjected".to_owned(),
        };

        let ((_, trace), stderr_lines) = with_captured_handler_console_stderr(|| {
            with_runtime_log_telemetry_redactor(
                telemetry.clone(),
                None,
                SecretRedactor::request_scoped(secret.to_owned()),
                || {
                    with_host_call_trace(|| {
                        run_ibex_handler_with_context(&module, &mut invocation, None).unwrap();
                        let refusal = dispatch_host_call(
                            &mut invocation,
                            "host.fetch",
                            json!({
                                "url": "https://example.invalid/",
                                "headers": {"authorization": format!("Bearer {secret}")},
                            }),
                        )
                        .unwrap_err();
                        assert_eq!(
                            refusal.diagnostic.code,
                            "SNAPBACK_ACTION_CONTEXT_UNAVAILABLE"
                        );
                    })
                },
            )
        });

        let trace_json = serde_json::to_string(&trace).unwrap();
        assert!(trace_json.contains("[REDACTED]"), "{trace_json}");
        assert!(!trace_json.contains(secret), "{trace_json}");
        let stderr = stderr_lines.join("\n");
        assert!(stderr.contains("[REDACTED]"), "{stderr}");
        assert!(!stderr.contains(secret), "{stderr}");

        let events = telemetry
            .query_events(&crate::telemetry_query::TelemetryEventsRequestV1::default())
            .unwrap();
        let telemetry_json = serde_json::to_string(&events).unwrap();
        assert!(telemetry_json.contains("[REDACTED]"), "{telemetry_json}");
        assert!(!telemetry_json.contains(secret), "{telemetry_json}");
    }

    #[test]
    fn invocation_payload_round_trips_every_former_placeholder_token() {
        let tokens = json!([
            "__SNAPBACK_EXPORT__",
            "__SNAPBACK_ARGS__",
            "__SNAPBACK_AUTH__",
            "__SNAPBACK_MODE__",
            "__SNAPBACK_RUN__",
            "__SNAPBACK_SECRETS__",
            "__SNAPBACK_EPOCH__",
        ]);
        let db = LocalDatabase::memory().unwrap();
        let mut invocation = query_context(
            &db,
            HandlerInput {
                args: tokens.clone(),
                ..HandlerInput::default()
            },
        );
        let module = IbexModule {
            source: r#"
                globalThis.__snapbackHandlers = {
                  async echo(_ctx, args) { return args; }
                };
            "#
            .to_owned(),
            export: "echo".to_owned(),
        };
        let output = run_ibex_handler_with_context(&module, &mut invocation, None).unwrap();
        assert_eq!(output, tokens);
    }

    #[test]
    fn oversized_settled_eval_output_is_refused_before_the_rust_copy() {
        let db = LocalDatabase::memory().unwrap();
        let mut invocation = query_context(&db, HandlerInput::default());
        let module = IbexModule {
            source: format!(
                r#"
                  globalThis.__snapbackHandlers = {{
                    async oversized() {{ return "x".repeat({}); }}
                  }};
                "#,
                IBEX_EVAL_OUTPUT_MAX_BYTES + 4_096
            ),
            export: "oversized".to_owned(),
        };
        let error = run_ibex_handler_with_context(&module, &mut invocation, None).unwrap_err();
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_HANDLER_EVAL_OUTPUT_TOO_LARGE"
        );
        assert_eq!(
            error.diagnostic.details["maximumBytes"],
            IBEX_EVAL_OUTPUT_MAX_BYTES
        );
        assert_eq!(
            error.diagnostic.details["observedAtLeastBytes"],
            IBEX_EVAL_OUTPUT_MAX_BYTES + 1
        );
    }

    #[test]
    fn unsettled_output_diagnostic_keeps_only_length_and_hash() {
        let output = "unsettled-sensitive-blob-".repeat(100_000);
        let module = IbexModule {
            source: String::new(),
            export: "pending".to_owned(),
        };
        let error = parse_handler_output(&module, output.clone()).unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_HANDLER_DID_NOT_SETTLE");
        assert!(error.diagnostic.details.get("output").is_none());
        assert_eq!(error.diagnostic.details["outputLengthBytes"], output.len());
        assert_eq!(
            error.diagnostic.details["outputSha256"],
            format!("sha256:{:x}", Sha256::digest(output.as_bytes()))
        );
        let diagnostic = serde_json::to_string(&error.diagnostic).unwrap();
        assert!(!diagnostic.contains("unsettled-sensitive-blob"));
    }
}

#[cfg(test)]
mod action_db_boundary_tests {
    use super::{IbexActionHost, IbexHostContext, run_ibex_handler_with_context};
    use crate::connected_clients::ConnectedClientRegistry;
    use crate::cron::{CronRunMetadata, CronRunTrigger};
    use crate::diagnostic::{SnapbackError, SnapbackResult};
    use crate::manifest::{HandlerInput, IbexModule, MutationOutput};
    use serde_json::json;
    use std::time::Instant;

    struct MutationOnlyHost;
    struct StaleGenerationHost;
    struct ConnectedPredicateHost {
        registry: ConnectedClientRegistry,
        now: Instant,
    }

    impl IbexActionHost for MutationOnlyHost {
        fn validate_host_call(&mut self, _op: &str) -> SnapbackResult<()> {
            Ok(())
        }

        fn run_mutation(
            &mut self,
            _name: &str,
            _input: HandlerInput,
        ) -> SnapbackResult<MutationOutput> {
            panic!("an action db-read denial must not reach its mutation-only host")
        }
    }

    impl IbexActionHost for StaleGenerationHost {
        fn validate_host_call(&mut self, _op: &str) -> SnapbackResult<()> {
            Err(SnapbackError::error(
                "SNAPBACK_ACTION_GENERATION_CONFLICT",
                "runtime",
                "test generation drift",
            ))
        }

        fn run_mutation(
            &mut self,
            _name: &str,
            _input: HandlerInput,
        ) -> SnapbackResult<MutationOutput> {
            panic!("generation denial must precede action host dispatch")
        }
    }

    impl IbexActionHost for ConnectedPredicateHost {
        fn validate_host_call(&mut self, _op: &str) -> SnapbackResult<()> {
            Ok(())
        }

        fn run_mutation(
            &mut self,
            _name: &str,
            _input: HandlerInput,
        ) -> SnapbackResult<MutationOutput> {
            panic!("the connected-client push branch performs no mutation")
        }

        fn has_fresh_client(&mut self, principal_id: &str) -> SnapbackResult<bool> {
            assert_eq!(principal_id, "principal-1");
            Ok(self.registry.has_fresh_client(principal_id, self.now))
        }

        fn push_send(
            &mut self,
            _request: crate::push::PushSendRequestV1,
        ) -> SnapbackResult<crate::push::PushSendReservationResponseV1> {
            panic!("a connected principal must skip push.send")
        }
    }

    fn metadata() -> CronRunMetadata {
        CronRunMetadata {
            job_name: "security-test".to_owned(),
            run_id: "security-test:1".to_owned(),
            scheduled_at_ms: None,
            due_at_ms: 1,
            idempotency_key: "security-test".to_owned(),
            slot_key: "security-test".to_owned(),
            attempt: 1,
            trigger: CronRunTrigger::Manual,
        }
    }

    #[test]
    fn action_db_reads_are_rejected_by_the_host_dispatcher() {
        let mut host = MutationOnlyHost;
        let mut context = IbexHostContext::new_action(
            HandlerInput::default(),
            metadata(),
            &mut host,
            json!(null),
        )
        .expect("action context");

        for (op, args) in [
            ("db.get", json!({ "table": "items", "id": "secret" })),
            // Deliberately malformed: capability denial precedes plan parsing,
            // so an action cannot use the read operation as a parser oracle.
            ("db.query", json!({})),
            (
                "db.elevated.get",
                json!({ "table": "items", "id": "secret" }),
            ),
            ("db.elevated.query", json!({})),
            ("db.elevated.getMany", json!({})),
            ("db.elevated.uniqueMany", json!({})),
        ] {
            let error = context
                .handle_host_call(op, args)
                .expect_err("action db reads must fail at the host boundary");
            assert_eq!(error.diagnostic.code, "SNAPBACK_HANDLER_WRITE_IN_QUERY");
        }
    }

    #[test]
    fn action_generation_guard_precedes_every_host_operation() {
        let mut host = StaleGenerationHost;
        let mut context = IbexHostContext::new_action(
            HandlerInput::default(),
            metadata(),
            &mut host,
            json!(null),
        )
        .expect("action context");

        for op in ["runtime.now", "runtime.id", "action.metadata"] {
            let error = context
                .handle_host_call(op, json!({}))
                .expect_err("stale outer action cannot retain non-mutation host power");
            assert_eq!(error.diagnostic.code, "SNAPBACK_ACTION_GENERATION_CONFLICT");
        }
    }

    #[test]
    fn action_handler_skips_push_for_a_connected_principal() {
        let registry = ConnectedClientRegistry::default();
        let now = Instant::now();
        registry
            .register_managed_websocket("principal-1", "connection-1", "grant-1", 1, now)
            .expect("install the server-side connected-client witness");
        let mut host = ConnectedPredicateHost { registry, now };
        let mut context = IbexHostContext::new_action(
            HandlerInput::default(),
            metadata(),
            &mut host,
            json!(null),
        )
        .expect("action context");
        let module = IbexModule {
            source: r#"
                globalThis.__snapbackHandlers = {
                  async notify(ctx) {
                    const connected = await ctx.realtime.hasFreshClient({ principalId: 'principal-1' });
                    if (connected) return { skipped: true, reason: 'connected' };
                    await ctx.push.send({ audience: { audience: 'all', args: {} }, notification: { title: 'hello' } });
                    return { skipped: false };
                  }
                };
            "#
            .to_owned(),
            export: "notify".to_owned(),
        };

        let output = run_ibex_handler_with_context(&module, &mut context, None)
            .expect("connected branch completes without entering push.send");
        assert_eq!(output, json!({ "skipped": true, "reason": "connected" }));
    }
}

#[cfg(test)]
mod parse_handler_output_tests {
    use super::parse_handler_output;
    use crate::error_tracking::{AppRefusalTrackingV1, UNCLASSIFIED_ERROR_CLASS};
    use crate::manifest::IbexModule;
    use serde_json::{Value, json};

    fn module() -> IbexModule {
        IbexModule {
            source: String::new(),
            export: "handler".to_owned(),
        }
    }

    fn parse(output: &str) -> Result<Value, String> {
        parse_handler_output(&module(), output.to_owned())
            .map_err(|error| error.diagnostic.code.clone())
    }

    /// @ref LLP 0108#declared-application-refusals — the declaration types the
    /// claim. An app code the function declared survives with its payload; an
    /// undeclared or forged one folds to the generic failure and its payload
    /// is dropped, so a handler can never mint semantics it did not declare.
    #[test]
    fn application_refusal_is_admitted_only_when_declared() {
        let envelope = r#"{"r":{"__snapbackOk":false,"code":"SNAPBACK_APP_REFUSAL","message":"STALE_MOVE","errorClass":"RefusalError","stack":"at refuse (handler.js:1:1)","messageExtractionTruncated":false,"stackExtractionTruncated":false,"appCode":"STALE_MOVE","appDetails":{"expected":1,"actual":2}}}"#;
        let declared = vec!["STALE_MOVE".to_owned(), "INVITE_CONSUMED".to_owned()];

        let admitted = super::admit_declared_refusal(
            &declared,
            &["STALE_MOVE".to_owned()],
            parse_handler_output(&module(), envelope.to_owned()),
        )
        .expect_err("refusal is an error");
        assert_eq!(admitted.diagnostic.code, "SNAPBACK_APP_REFUSAL");
        assert_eq!(admitted.diagnostic.details["appCode"], "STALE_MOVE");
        assert_eq!(admitted.diagnostic.details["appDetails"]["expected"], 1);
        let context = admitted
            .private_failure_context()
            .expect("admitted refusal retains private carrier");
        assert_eq!(
            context.app_refusal_tracking,
            Some(AppRefusalTrackingV1::Tracked)
        );
        assert_eq!(context.carriers[0].error_class, "RefusalError");
        assert_eq!(
            context.carriers[0].stack.as_deref(),
            Some("at refuse (handler.js:1:1)")
        );

        let admitted_untracked = super::admit_declared_refusal(
            &declared,
            &[],
            parse_handler_output(&module(), envelope.to_owned()),
        )
        .expect_err("untracked refusal is still admitted");
        assert_eq!(admitted_untracked.diagnostic.code, "SNAPBACK_APP_REFUSAL");
        assert_eq!(
            admitted_untracked
                .private_failure_context()
                .and_then(|context| context.app_refusal_tracking),
            Some(AppRefusalTrackingV1::AdmittedUntracked)
        );

        // Undeclared on this function: folds, payload dropped.
        let folded = super::admit_declared_refusal(
            &["INVITE_CONSUMED".to_owned()],
            &[],
            parse_handler_output(&module(), envelope.to_owned()),
        )
        .expect_err("undeclared refusal is an error");
        assert_eq!(folded.diagnostic.code, "SNAPBACK_HANDLER_FAILED");
        assert!(folded.diagnostic.details.get("appCode").is_none());
        assert!(folded.diagnostic.details.get("appDetails").is_none());
        assert_eq!(
            folded
                .private_failure_context()
                .expect("fold preserves private exception carrier")
                .carriers[0]
                .error_class,
            "RefusalError"
        );

        // No declaration at all — the default for every path that does not
        // deliberately carry the manifest's set.
        let undeclared = super::admit_declared_refusal(
            &[],
            &[],
            parse_handler_output(&module(), envelope.to_owned()),
        )
        .expect_err("undeclared refusal is an error");
        assert_eq!(undeclared.diagnostic.code, "SNAPBACK_HANDLER_FAILED");

        // A handler that claims the platform envelope code without an app code
        // gets the ordinary generic failure, never a typed refusal.
        let forged = super::admit_declared_refusal(
            &declared,
            &[],
            parse_handler_output(
                &module(),
                r#"{"r":{"__snapbackOk":false,"code":"SNAPBACK_APP_REFUSAL","message":"nope"}}"#
                    .to_owned(),
            ),
        )
        .expect_err("forged refusal is an error");
        assert_eq!(forged.diagnostic.code, "SNAPBACK_HANDLER_FAILED");
    }

    #[test]
    fn failure_envelope_preserves_validated_private_carrier_without_public_widening() {
        let error = parse_handler_output(
            &module(),
            r#"{"r":{"__snapbackOk":false,"code":null,"message":"bounded failure","errorClass":"bad-class","stack":"at handler (app.js:2:3)","messageExtractionTruncated":true,"stackExtractionTruncated":false}}"#.to_owned(),
        )
        .expect_err("failure envelope returns an error");

        assert_eq!(error.diagnostic.code, "SNAPBACK_HANDLER_FAILED");
        assert_eq!(error.diagnostic.details["message"], "bounded failure");
        assert!(error.diagnostic.details.get("errorClass").is_none());
        assert!(error.diagnostic.details.get("stack").is_none());
        let context = error
            .private_failure_context()
            .expect("private carrier is retained");
        assert_eq!(context.carriers.len(), 1);
        let carrier = &context.carriers[0];
        assert_eq!(carrier.error_class, UNCLASSIFIED_ERROR_CLASS);
        assert_eq!(carrier.message.as_deref(), Some("bounded failure"));
        assert_eq!(carrier.stack.as_deref(), Some("at handler (app.js:2:3)"));
        assert!(carrier.message_extraction_truncated);
        assert!(!carrier.stack_extraction_truncated);
    }

    #[test]
    fn tagged_success_unwraps_value() {
        assert_eq!(
            parse(r#"{"r":{"__snapbackOk":true,"value":{"a":1}}}"#),
            Ok(json!({"a": 1}))
        );
        assert_eq!(parse(r#"{"r":{"__snapbackOk":true}}"#), Ok(Value::Null));
    }

    #[test]
    fn tagged_failure_maps_code() {
        assert_eq!(
            parse(r#"{"r":{"__snapbackOk":false,"code":"SNAPBACK_HANDLER_RESULT_INVALID"}}"#),
            Err("SNAPBACK_HANDLER_RESULT_INVALID".to_owned())
        );
        assert_eq!(
            parse(r#"{"r":{"__snapbackOk":false,"code":"SNAPBACK_OVERLOADED"}}"#),
            Err("SNAPBACK_OVERLOADED".to_owned())
        );
        assert_eq!(
            parse(r#"{"r":{"__snapbackOk":false,"code":"SNAPBACK_VALUE_TOO_LARGE"}}"#),
            Err("SNAPBACK_VALUE_TOO_LARGE".to_owned())
        );
        for code in [
            "SNAPBACK_SEQUENCE_EXHAUSTED",
            "SNAPBACK_SEQUENCE_UNDECLARED",
            "SNAPBACK_MUTATION_SETTLEMENT_UNAVAILABLE",
            "SNAPBACK_RELATION_PARENT_UNAVAILABLE",
        ] {
            assert_eq!(
                parse(&format!(
                    r#"{{"r":{{"__snapbackOk":false,"code":"{code}"}}}}"#
                )),
                Err(code.to_owned()),
            );
        }
        assert_eq!(
            parse(r#"{"r":{"__snapbackOk":false,"code":"SNAPBACK_ACTION_TIMEOUT"}}"#),
            Err("SNAPBACK_ACTION_TIMEOUT".to_owned())
        );
        assert_eq!(
            parse(r#"{"r":{"__snapbackOk":false,"code":"SNAPBACK_ACTION_GENERATION_CONFLICT"}}"#),
            Err("SNAPBACK_ACTION_GENERATION_CONFLICT".to_owned())
        );
        assert_eq!(
            parse(
                r#"{"r":{"__snapbackOk":false,"code":"SNAPBACK_QUERY_FILTER_BINDINGS_EXCEEDED"}}"#
            ),
            Err("SNAPBACK_QUERY_FILTER_BINDINGS_EXCEEDED".to_owned())
        );
        assert_eq!(
            parse(r#"{"r":{"__snapbackOk":false,"code":"SNAPBACK_QUERY_FILTER_VALUE_INVALID"}}"#),
            Err("SNAPBACK_QUERY_FILTER_VALUE_INVALID".to_owned())
        );
        assert_eq!(
            parse(r#"{"r":{"__snapbackOk":false,"code":"MADE_UP_BY_HANDLER"}}"#),
            Err("SNAPBACK_HANDLER_FAILED".to_owned())
        );
    }

    // ENG-23603: an untagged `r` proves nothing about settlement and must
    // fail closed, exactly like the JS decoder in
    // packages/snapback-harness/envelope.mjs.
    #[test]
    fn untagged_r_object_fails_closed() {
        assert_eq!(
            parse(r#"{"r":{"looksLike":"a result"}}"#),
            Err("SNAPBACK_HANDLER_DID_NOT_SETTLE".to_owned())
        );
    }

    #[test]
    fn non_boolean_snapback_ok_fails_closed() {
        assert_eq!(
            parse(r#"{"r":{"__snapbackOk":"true","value":1}}"#),
            Err("SNAPBACK_HANDLER_DID_NOT_SETTLE".to_owned())
        );
    }

    #[test]
    fn non_object_r_fails_closed() {
        for output in [
            r#"{"r":42}"#,
            r#"{"r":"done"}"#,
            r#"{"r":[1,2]}"#,
            r#"{"r":null}"#,
        ] {
            assert_eq!(
                parse(output),
                Err("SNAPBACK_HANDLER_DID_NOT_SETTLE".to_owned()),
                "output: {output}"
            );
        }
    }

    #[test]
    fn non_envelope_shapes_fail_closed() {
        for output in [
            "{}",
            "not json",
            r#"{"r":{"__snapbackOk":true},"extra":1}"#,
            "[]",
        ] {
            assert_eq!(
                parse(output),
                Err("SNAPBACK_HANDLER_DID_NOT_SETTLE".to_owned()),
                "output: {output}"
            );
        }
    }
}

#[cfg(test)]
mod private_failure_carrier_tests {
    use super::{
        HandlerErrorExposure, IbexHostContext, run_ibex_handler_with_context_until_with_exposure,
    };
    use crate::auth::admission::AdmissionLease;
    use crate::auth::invocation::{HandlerAuthProjection, ResolvedAppAuthority};
    use crate::manifest::{HandlerInput, IbexModule};
    use crate::storage::{DbRead, LocalDatabase, MembershipWriter};
    use serde_json::json;

    fn run_with_exposure(
        source: &str,
        exposure: HandlerErrorExposure,
    ) -> crate::diagnostic::SnapbackError {
        let db = LocalDatabase::memory().expect("memory database");
        let authority = ResolvedAppAuthority::Anonymous;
        let mut invocation = IbexHostContext::new_with_projection(
            DbRead::Live(&db),
            HandlerInput::default(),
            HandlerAuthProjection::from_authority(&authority, None).unwrap(),
            AdmissionLease::unmanaged(0, 0),
            MembershipWriter::from_resolved(&authority),
            true,
            true,
        )
        .expect("runtime context");
        let module = IbexModule {
            source: source.to_owned(),
            export: "probe".to_owned(),
        };
        run_ibex_handler_with_context_until_with_exposure(
            &module,
            &mut invocation,
            None,
            None,
            exposure,
        )
        .expect_err("probe must fail")
    }

    fn run(source: &str) -> crate::diagnostic::SnapbackError {
        run_with_exposure(source, HandlerErrorExposure::Redacted)
    }

    #[test]
    fn ordinary_throw_preserves_private_settle_carrier() {
        let error = run(r#"
            globalThis.__snapbackHandlers = {
              async probe() { throw new TypeError('settle carrier'); }
            };
            "#);
        assert_eq!(error.diagnostic.code, "SNAPBACK_HANDLER_FAILED");
        assert!(error.diagnostic.details.get("errorClass").is_none());
        assert!(error.diagnostic.details.get("stack").is_none());
        let carriers = &error
            .private_failure_context()
            .expect("private settle carrier")
            .carriers;
        assert_eq!(carriers.len(), 1);
        assert_eq!(carriers[0].error_class, "TypeError");
        assert_eq!(carriers[0].message.as_deref(), Some("settle carrier"));
        assert!(
            carriers[0]
                .stack
                .as_deref()
                .is_some_and(|stack| !stack.is_empty())
        );
    }

    #[test]
    fn missing_ctx_member_call_is_enriched_only_for_development() {
        let source = r#"globalThis.__snapbackHandlers = {
  async probe(ctx) {
    return ctx.runtime.newId();
  }
};"#;
        let development = run_with_exposure(source, HandlerErrorExposure::Development);
        assert_eq!(development.diagnostic.code, "SNAPBACK_HANDLER_FAILED");
        assert!(
            development.diagnostic.message.contains("newId"),
            "developer message must name the missing member: {}",
            development.diagnostic.message,
        );
        assert_eq!(development.diagnostic.details["errorClass"], "TypeError");
        assert_eq!(
            development.diagnostic.details["callee"],
            "ctx.runtime.newId"
        );
        assert_eq!(development.diagnostic.details["property"], "newId");
        assert_eq!(
            development.diagnostic.details["sourcePosition"]["handler"],
            "probe"
        );
        assert_eq!(development.diagnostic.details["sourcePosition"]["line"], 3);
        assert!(
            development.diagnostic.details["sourcePosition"]["column"]
                .as_u64()
                .is_some_and(|column| column > 0)
        );

        let production = run_with_exposure(source, HandlerErrorExposure::Redacted);
        assert_eq!(production.diagnostic.message, "JavaScript handler failed");
        assert_eq!(
            production.diagnostic.details,
            json!({ "function": "probe" })
        );
        assert!(
            !serde_json::to_string(&production.diagnostic)
                .unwrap()
                .contains("newId")
        );
        assert_eq!(
            production
                .private_failure_context()
                .and_then(|context| context.carriers.first())
                .map(|carrier| carrier.error_class.as_str()),
            Some("TypeError"),
            "production redaction must not discard the private error-tracking carrier",
        );
    }

    #[test]
    fn one_unhandled_rejection_decodes_ibex_structured_metadata_before_release() {
        let error = run(r#"
            globalThis.__snapbackHandlers = {
              async probe() {
                Promise.reject(new TypeError('detached carrier'));
                return null;
              }
            };
            "#);
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_HANDLER_UNHANDLED_REJECTION"
        );
        assert_eq!(
            error.diagnostic.details["rejections"],
            json!(["detached carrier"])
        );
        let carriers = &error
            .private_failure_context()
            .expect("private async carrier")
            .carriers;
        assert_eq!(carriers.len(), 1);
        assert_eq!(carriers[0].error_class, "TypeError");
        assert_eq!(carriers[0].message.as_deref(), Some("detached carrier"));
        assert!(
            carriers[0]
                .stack
                .as_deref()
                .is_some_and(|stack| !stack.is_empty())
        );
    }

    #[test]
    fn multiple_unhandled_rejections_preserve_first_authority_queue_order() {
        let error = run(r#"
            globalThis.__snapbackHandlers = {
              async probe() {
                Promise.reject(new Error('first carrier'));
                Promise.reject(new TypeError('second carrier'));
                return null;
              }
            };
            "#);
        assert_eq!(
            error.diagnostic.details["rejections"],
            json!(["first carrier", "second carrier"])
        );
        let carriers = &error
            .private_failure_context()
            .expect("ordered async carriers")
            .carriers;
        assert_eq!(carriers.len(), 2);
        assert_eq!(carriers[0].message.as_deref(), Some("first carrier"));
        assert_eq!(carriers[0].error_class, "Error");
        assert_eq!(carriers[1].message.as_deref(), Some("second carrier"));
        assert_eq!(carriers[1].error_class, "TypeError");
    }
}

#[cfg(test)]
mod handler_result_bridge_tests {
    use super::{IbexHostContext, run_ibex_handler_with_context};
    use crate::auth::admission::AdmissionLease;
    use crate::auth::invocation::{HandlerAuthProjection, ResolvedAppAuthority};
    use crate::manifest::{HandlerInput, IbexModule};
    use crate::storage::{DbRead, LocalDatabase, MembershipWriter};

    /// @ref LLP 0108#result-contract-vocabulary — the handler bridge preserves
    /// the complete post-JSON image; declared per-string/result ceilings are
    /// enforced after this transfer, never implemented as silent clipping.
    #[test]
    fn successful_string_result_larger_than_failure_metadata_bound_roundtrips_exactly() {
        let db = LocalDatabase::memory().expect("memory database");
        let authority = ResolvedAppAuthority::Anonymous;
        let mut invocation = IbexHostContext::new_with_projection(
            DbRead::Live(&db),
            HandlerInput::default(),
            HandlerAuthProjection::from_authority(&authority, None).unwrap(),
            AdmissionLease::unmanaged(0, 0),
            MembershipWriter::from_resolved(&authority),
            false,
            true,
        )
        .expect("runtime context");
        let module = IbexModule {
            source: r#"
              globalThis.__snapbackHandlers = {
                async probe() { return { body: 'x'.repeat(44084) + '\uD800' }; }
              };
            "#
            .to_owned(),
            export: "probe".to_owned(),
        };

        let result = run_ibex_handler_with_context(&module, &mut invocation, None)
            .expect("large handler result crosses the VM bridge");
        let body = result["body"].as_str().expect("body string");
        assert_eq!(body.len(), 44_087);
        assert_eq!(body, format!("{}\u{FFFD}", "x".repeat(44_084)));
    }
}

#[cfg(test)]
mod table_visibility_runtime_tests {
    use super::{
        IbexHostContext, execute_ibex_mutation_prepared, read_dependency_key,
        run_ibex_handler_with_context, run_ibex_query_with_reads_prepared, with_host_call_trace,
        with_runtime_log_telemetry,
    };
    use crate::auth::admission::AdmissionLease;
    use crate::auth::invocation::{
        HandlerAuthProjection, InvocationGate, InvocationSource, PreparedInvocation,
        ResolvedAppAuthority, WireAuthorityFields,
    };
    use crate::contract_types::{AuthMode, IndexManifest, ServerProfile};
    use crate::manifest::{
        ActionPlan, AuthInput, BATCH_READ_MAX_POLICY_PROBES_PER_ITEM, FieldManifest, FieldType,
        FunctionDefinition, FunctionKind, FunctionRuntime, HandlerInput, HandlerPlan, IbexModule,
        MembershipManifest, MembershipScope, SchemaManifest, SeedData, SequenceDeclaration,
        SequenceScopeAccess, TableManifest, TableVisibilityArmV1, TableVisibilityV1,
    };
    use crate::storage::{
        BufferedWrite, CapturedReadKind, DbRead, LocalDatabase, MembershipWriter,
    };
    use crate::telemetry::{Telemetry, TelemetryConfig};
    use serde_json::{Map, Value, json};
    use std::collections::{BTreeMap, BTreeSet};

    fn table(
        name: &str,
        fields: Vec<FieldManifest>,
        visibility: Option<TableVisibilityV1>,
    ) -> TableManifest {
        TableManifest {
            name: name.to_owned(),
            fields,
            indexes: Vec::new(),
            syncable: true,
            permission_backing: false,
            permission_fields: None,
            search_indexes: Vec::new(),
            vector_indexes: Vec::new(),
            search_live_limits: None,
            membership: None,
            authority_profile: None,
            asset_sharing: None,
            visibility,
            history: None,
        }
    }

    fn field(name: &str, field_type: FieldType) -> FieldManifest {
        FieldManifest {
            name: name.to_owned(),
            field_type,
            optional: false,
        }
    }

    fn optional_field(name: &str, field_type: FieldType) -> FieldManifest {
        FieldManifest {
            name: name.to_owned(),
            field_type,
            optional: true,
        }
    }

    fn unique_ready_db() -> LocalDatabase {
        let mut db = LocalDatabase::memory().expect("unique batch memory database");
        let mut unique_docs = table(
            "unique_docs",
            vec![
                field("slug", FieldType::String),
                optional_field("scope", FieldType::String),
                optional_field("alias", FieldType::String),
            ],
            Some(TableVisibilityV1::PublicRead),
        );
        unique_docs.indexes = vec![
            IndexManifest {
                name: "bySlug".to_owned(),
                fields: vec!["slug".to_owned()],
                unique: true,
                where_applicable: false,
            },
            IndexManifest {
                name: "byAlias".to_owned(),
                fields: vec!["alias".to_owned()],
                unique: true,
                where_applicable: true,
            },
            IndexManifest {
                name: "byScopeAlias".to_owned(),
                fields: vec!["scope".to_owned(), "alias".to_owned()],
                unique: true,
                where_applicable: true,
            },
            IndexManifest {
                name: "byScope".to_owned(),
                fields: vec!["scope".to_owned()],
                unique: false,
                where_applicable: false,
            },
        ];
        db.schema_seed()
            .apply_schema(SchemaManifest {
                tables: vec![unique_docs],
                ..SchemaManifest::default()
            })
            .expect("unique batch schema");
        db.schema_seed()
            .seed(SeedData {
                tables: BTreeMap::from([(
                    "unique_docs".to_owned(),
                    vec![
                        Map::from_iter([
                            ("_id".to_owned(), json!("unique-one")),
                            ("slug".to_owned(), json!("one")),
                            ("scope".to_owned(), json!("global")),
                            ("alias".to_owned(), json!("first")),
                        ]),
                        Map::from_iter([
                            ("_id".to_owned(), json!("unique-two")),
                            ("slug".to_owned(), json!("two")),
                            ("scope".to_owned(), json!("global")),
                            ("alias".to_owned(), json!("second")),
                        ]),
                    ],
                )]),
            })
            .expect("unique batch seed");
        db
    }

    fn restricted_unique_overlay_db(include_hidden_touched_rows: bool) -> LocalDatabase {
        let mut db = LocalDatabase::memory().expect("restricted unique batch memory database");
        let mut unique_docs = table(
            "unique_docs",
            vec![
                field("slug", FieldType::String),
                field("ownerId", FieldType::Principal),
            ],
            Some(TableVisibilityV1::Owner {
                field: "ownerId".to_owned(),
            }),
        );
        unique_docs.indexes = vec![IndexManifest {
            name: "bySlug".to_owned(),
            fields: vec!["slug".to_owned()],
            unique: true,
            where_applicable: false,
        }];
        db.schema_seed()
            .apply_schema(SchemaManifest {
                tables: vec![unique_docs],
                ..SchemaManifest::default()
            })
            .expect("restricted unique batch schema");
        if include_hidden_touched_rows {
            db.schema_seed()
                .seed(SeedData {
                    tables: BTreeMap::from([(
                        "unique_docs".to_owned(),
                        vec![
                            Map::from_iter([
                                ("_id".to_owned(), json!("touched-one")),
                                ("slug".to_owned(), json!("before-one")),
                                ("ownerId".to_owned(), json!("bob")),
                            ]),
                            Map::from_iter([
                                ("_id".to_owned(), json!("touched-two")),
                                ("slug".to_owned(), json!("before-two")),
                                ("ownerId".to_owned(), json!("bob")),
                            ]),
                        ],
                    )]),
                })
                .expect("restricted unique batch seed");
        }
        db
    }

    fn schema() -> SchemaManifest {
        let owner = TableVisibilityV1::Owner {
            field: "ownerId".to_owned(),
        };
        let membership = TableVisibilityV1::Membership {
            declaration: "resourceMembers".to_owned(),
            resource_field: "resourceId".to_owned(),
            roles: Some(vec!["reader".to_owned()]),
        };
        let mut resource_members = table(
            "resource_members",
            vec![
                field(
                    "resourceId",
                    FieldType::Id {
                        table: "resources".to_owned(),
                    },
                ),
                field("userId", FieldType::Principal),
                field("role", FieldType::String),
            ],
            Some(TableVisibilityV1::PublicRead),
        );
        resource_members.membership = Some(MembershipManifest {
            id: Some("resourceMembers".to_owned()),
            principal: "userId".to_owned(),
            resource: Some("resourceId".to_owned()),
            role: "role".to_owned(),
            roles: vec!["reader".to_owned()],
            pending_roles: None,
            bootstrap_role: None,
            last_holder: None,
            expiry: None,
            incidental: None,
            provenance: None,
            transitions: Vec::new(),
            scope: MembershipScope::Resource,
            resource_table: Some("resources".to_owned()),
            principal_addressed_writes: None,
        });
        let mut owner_docs = table(
            "owner_docs",
            vec![
                field("ownerId", FieldType::Principal),
                field("body", FieldType::String),
            ],
            Some(owner.clone()),
        );
        owner_docs.indexes = vec![IndexManifest {
            name: "byBody".to_owned(),
            fields: vec!["body".to_owned()],
            unique: true,
            where_applicable: false,
        }];
        SchemaManifest {
            tables: vec![
                table(
                    "resources",
                    vec![field("title", FieldType::String)],
                    Some(TableVisibilityV1::Membership {
                        declaration: "resourceMembers".to_owned(),
                        resource_field: "_id".to_owned(),
                        roles: Some(vec!["reader".to_owned()]),
                    }),
                ),
                resource_members,
                owner_docs,
                table(
                    "membership_docs",
                    vec![
                        field(
                            "resourceId",
                            FieldType::Id {
                                table: "resources".to_owned(),
                            },
                        ),
                        field("body", FieldType::String),
                    ],
                    Some(membership.clone()),
                ),
                table(
                    "any_docs",
                    vec![
                        field("ownerId", FieldType::Principal),
                        field(
                            "resourceId",
                            FieldType::Id {
                                table: "resources".to_owned(),
                            },
                        ),
                        field("body", FieldType::String),
                    ],
                    Some(TableVisibilityV1::AnyOf {
                        arms: vec![
                            TableVisibilityArmV1::Owner {
                                field: "ownerId".to_owned(),
                            },
                            TableVisibilityArmV1::Membership {
                                declaration: "resourceMembers".to_owned(),
                                resource_field: "resourceId".to_owned(),
                                roles: Some(vec!["reader".to_owned()]),
                            },
                        ],
                    }),
                ),
                // Activation currently accepts owner policies over any
                // existing field type. Runtime evaluation must therefore
                // match SQL and treat this integer owner field as non-matching
                // rather than turning row existence into an error oracle.
                table(
                    "integer_owner_docs",
                    vec![
                        field("seatNumber", FieldType::Integer),
                        field("body", FieldType::String),
                    ],
                    Some(TableVisibilityV1::Owner {
                        field: "seatNumber".to_owned(),
                    }),
                ),
            ],
            ..SchemaManifest::default()
        }
    }

    fn ready_db() -> LocalDatabase {
        let mut db = LocalDatabase::memory().expect("table-visibility memory database");
        db.activate_current_auth_catalog().expect("auth catalog");
        db.schema_seed()
            .apply_schema(schema())
            .expect("table-visibility schema");
        db.schema_seed()
            .seed(SeedData {
                tables: BTreeMap::from([
                    (
                        "resources".to_owned(),
                        vec![
                            Map::from_iter([
                                ("_id".to_owned(), json!("resource-visible")),
                                ("title".to_owned(), json!("Visible")),
                            ]),
                            Map::from_iter([
                                ("_id".to_owned(), json!("resource-hidden")),
                                ("title".to_owned(), json!("Hidden")),
                            ]),
                        ],
                    ),
                    (
                        "resource_members".to_owned(),
                        vec![Map::from_iter([
                            ("_id".to_owned(), json!("membership-alice-visible")),
                            ("resourceId".to_owned(), json!("resource-visible")),
                            ("userId".to_owned(), json!("alice")),
                            ("role".to_owned(), json!("reader")),
                        ])],
                    ),
                    (
                        "owner_docs".to_owned(),
                        vec![
                            Map::from_iter([
                                ("_id".to_owned(), json!("owner-alice")),
                                ("ownerId".to_owned(), json!("alice")),
                                ("body".to_owned(), json!("alice-only")),
                            ]),
                            Map::from_iter([
                                ("_id".to_owned(), json!("owner-bob")),
                                ("ownerId".to_owned(), json!("bob")),
                                ("body".to_owned(), json!("bob-only")),
                            ]),
                        ],
                    ),
                    (
                        "membership_docs".to_owned(),
                        vec![
                            Map::from_iter([
                                ("_id".to_owned(), json!("membership-visible")),
                                ("resourceId".to_owned(), json!("resource-visible")),
                                ("body".to_owned(), json!("member-only")),
                            ]),
                            Map::from_iter([
                                ("_id".to_owned(), json!("membership-hidden")),
                                ("resourceId".to_owned(), json!("resource-hidden")),
                                ("body".to_owned(), json!("not-a-member")),
                            ]),
                        ],
                    ),
                    (
                        "any_docs".to_owned(),
                        vec![
                            Map::from_iter([
                                ("_id".to_owned(), json!("any-membership-only")),
                                ("ownerId".to_owned(), json!("bob")),
                                ("resourceId".to_owned(), json!("resource-visible")),
                                ("body".to_owned(), json!("membership-arm")),
                            ]),
                            Map::from_iter([
                                ("_id".to_owned(), json!("any-hidden")),
                                ("ownerId".to_owned(), json!("bob")),
                                ("resourceId".to_owned(), json!("resource-hidden")),
                                ("body".to_owned(), json!("neither-arm")),
                            ]),
                        ],
                    ),
                    (
                        "integer_owner_docs".to_owned(),
                        vec![Map::from_iter([
                            ("_id".to_owned(), json!("integer-owner")),
                            ("seatNumber".to_owned(), json!(42)),
                            ("body".to_owned(), json!("must-not-error")),
                        ])],
                    ),
                ]),
            })
            .expect("seed table-visibility rows");
        db
    }

    fn input(user_id: Option<&str>) -> HandlerInput {
        HandlerInput {
            auth: AuthInput {
                principal: user_id.map(str::to_owned),
                user_id: user_id.map(str::to_owned),
                ..AuthInput::default()
            },
            ..HandlerInput::default()
        }
    }

    fn context<'a>(
        db: &'a LocalDatabase,
        user_id: Option<&str>,
        writable: bool,
    ) -> IbexHostContext<'a> {
        let input = input(user_id);
        let authority = ResolvedAppAuthority::dev_from_auth(&input.auth);
        IbexHostContext::new_with_projection(
            DbRead::Live(db),
            input,
            HandlerAuthProjection::from_authority(&authority, None).unwrap(),
            AdmissionLease::unmanaged(0, 0),
            MembershipWriter::from_resolved(&authority),
            writable,
            true,
        )
        .expect("table-visibility handler context")
    }

    fn module(source: &str, export: &str) -> IbexModule {
        IbexModule {
            source: source.to_owned(),
            export: export.to_owned(),
        }
    }

    fn ibex_function(name: &str, kind: FunctionKind, source: &str) -> FunctionDefinition {
        FunctionDefinition::new(
            name,
            kind,
            FunctionRuntime::IbexModule(module(source, name)),
        )
    }

    fn action_root(authority: crate::auth::invocation::PreparedAuthority) -> PreparedInvocation {
        let action = FunctionDefinition::new(
            "elevationRoot",
            FunctionKind::Action,
            FunctionRuntime::HostPlan(HandlerPlan::Action(ActionPlan {
                steps: Vec::new(),
                return_value: None,
            })),
        );
        InvocationGate::prepare_function(authority, &action).expect("prepare action root")
    }

    fn elevated_operation_source(op: &str) -> &'static str {
        match op {
            "get" => {
                "globalThis.__snapbackHandlers = { async probe(ctx) { return await ctx.db.elevated.get('__must_not_reach_storage', 'secret'); } };"
            }
            "getMany" => {
                "globalThis.__snapbackHandlers = { async probe(ctx) { return await ctx.db.elevated.getMany('__must_not_reach_storage', ['secret']); } };"
            }
            "uniqueMany" => {
                "globalThis.__snapbackHandlers = { async probe(ctx) { return await ctx.db.elevated.uniqueMany('__must_not_reach_storage', 'bySecret', [{ secret: 'value' }]); } };"
            }
            "query" => {
                "globalThis.__snapbackHandlers = { async probe(ctx) { return await ctx.db.elevated.query('__must_not_reach_storage').collect(); } };"
            }
            _ => unreachable!("closed elevated operation fixture"),
        }
    }

    fn nested_mutation_from(
        root: &PreparedInvocation,
        source: &str,
    ) -> (FunctionDefinition, PreparedInvocation) {
        let mutation = ibex_function("probe", FunctionKind::Mutation, source);
        let authority = root
            .inherit_authority_for(InvocationSource::NestedMutation)
            .expect("inherit root provenance into nested mutation");
        let prepared = InvocationGate::prepare_function(authority, &mutation)
            .expect("prepare named nested mutation");
        (mutation, prepared)
    }

    #[test]
    fn elevated_reads_increment_function_and_member_counts_and_emit_fact_trace() {
        const SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async inspect(ctx) {
    await ctx.db.query('unique_docs').take(1).collect();
    await ctx.db.elevated.query('unique_docs').take(1).collect();
    await ctx.db.elevated.get('unique_docs', 'unique-one');
    await ctx.db.elevated.getMany('unique_docs', ['unique-one']);
    await ctx.db.elevated.uniqueMany('unique_docs', 'bySlug', [{ slug: 'one' }]);
    await ctx.db.elevated.getMany('unique_docs', []);
    return null;
  }
};
"#;
        let db = unique_ready_db();
        let mut invocation = context(&db, None, false);
        let telemetry = Telemetry::in_memory(
            "01900000-0000-7000-8000-000000000001",
            TelemetryConfig::default(),
        )
        .expect("elevated-read telemetry");
        let (result, trace) = crate::elevated_read_trace::with_captured(|| {
            with_runtime_log_telemetry(
                telemetry.clone(),
                Some("corr-elevated-read".to_owned()),
                || run_ibex_handler_with_context(&module(SOURCE, "inspect"), &mut invocation, None),
            )
        });
        assert_eq!(result.expect("elevated reads execute"), Value::Null);
        telemetry
            .force_flush()
            .expect("flush elevated-read counters");

        assert_eq!(
            telemetry.event_count_for_test("elevated_read", "function:inspect", "point"),
            4,
            "one ordinary query and one empty elevated batch must not increment the counter"
        );
        for member in ["query", "get", "getMany", "uniqueMany"] {
            assert_eq!(
                telemetry.event_count_for_test(
                    "elevated_read",
                    &format!("member:{member}"),
                    "point"
                ),
                1,
                "member counter for {member}"
            );
        }
        assert_eq!(trace.len(), 4);
        assert_eq!(
            trace
                .iter()
                .map(|event| (
                    event.function.as_str(),
                    event.member.as_str(),
                    event.table.as_str(),
                    event.mode,
                    event.correlation.as_deref(),
                ))
                .collect::<Vec<_>>(),
            vec![
                (
                    "inspect",
                    "query",
                    "unique_docs",
                    "query",
                    Some("corr-elevated-read")
                ),
                (
                    "inspect",
                    "get",
                    "unique_docs",
                    "query",
                    Some("corr-elevated-read")
                ),
                (
                    "inspect",
                    "getMany",
                    "unique_docs",
                    "query",
                    Some("corr-elevated-read")
                ),
                (
                    "inspect",
                    "uniqueMany",
                    "unique_docs",
                    "query",
                    Some("corr-elevated-read")
                ),
            ]
        );
    }

    #[test]
    fn table_visibility_ctx_db_query_filters_rows_and_captures_the_composed_plan() {
        const SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async list(ctx) {
    return await ctx.db.query('owner_docs').collect();
  }
};
"#;
        let db = ready_db();
        let mut alice = context(&db, Some("alice"), false);
        let rows = run_ibex_handler_with_context(&module(SOURCE, "list"), &mut alice, None)
            .expect("owner query runs")
            .as_array()
            .expect("query returns rows")
            .clone();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["_id"], "owner-alice");

        let query = alice
            .reads
            .iter()
            .find(|dependency| {
                dependency.kind == CapturedReadKind::Query
                    && dependency.table.as_deref() == Some("owner_docs")
            })
            .expect("ctx.db query capture");
        assert_eq!(
            query.predicate.as_ref().unwrap()["tableVisibility"],
            json!({ "kind": "owner", "field": "ownerId" }),
            "capture must serialize the schema policy before OCC records the read",
        );
        assert!(alice.reads.iter().all(|dependency| {
            !(dependency.kind == CapturedReadKind::Row
                && dependency.id.as_deref() == Some("owner-bob"))
        }));

        let mut anonymous = context(&db, None, false);
        let anonymous_rows =
            run_ibex_handler_with_context(&module(SOURCE, "list"), &mut anonymous, None)
                .expect("anonymous query fails closed");
        assert_eq!(anonymous_rows, json!([]));

        const ELEVATED_SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async list(ctx) {
    return await ctx.db.elevated.query('owner_docs').collect();
  }
};
"#;
        let mut elevated = context(&db, Some("alice"), false);
        let elevated_rows =
            run_ibex_handler_with_context(&module(ELEVATED_SOURCE, "list"), &mut elevated, None)
                .expect("explicit elevated query runs")
                .as_array()
                .expect("elevated query returns rows")
                .clone();
        assert_eq!(elevated_rows.len(), 2);
        let elevated_capture = elevated
            .reads
            .iter()
            .find(|dependency| {
                dependency.kind == CapturedReadKind::Query
                    && dependency.table.as_deref() == Some("owner_docs")
            })
            .expect("elevated ctx.db query capture");
        assert_eq!(
            elevated_capture.predicate.as_ref().unwrap()["tableVisibility"],
            Value::Null,
            "elevated reads bypass row policy but retain captured-read/OCC evidence",
        );
    }

    /// @ref LLP 0231#d7--handler-reads-are-scoped-unless-the-call-site-is-explicitly-elevated
    #[test]
    fn table_visibility_cron_action_root_refuses_all_nested_elevated_read_forms() {
        let authority = InvocationGate::prepare_authority(
            InvocationSource::Cron,
            AuthMode::Dev,
            ServerProfile::Test,
            0,
            0,
            &WireAuthorityFields::default(),
            ResolvedAppAuthority::System,
        )
        .expect("prepare scheduled system authority");
        let root = action_root(authority);
        assert!(!root.authority().elevated_database_allowed());
        let db = ready_db();

        for op in ["get", "getMany", "uniqueMany", "query"] {
            let (mutation, prepared) = nested_mutation_from(&root, elevated_operation_source(op));
            let FunctionRuntime::IbexModule(module) = &mutation.runtime else {
                unreachable!("nested fixture is an Ibex mutation");
            };
            let error = match execute_ibex_mutation_prepared(
                module,
                input(None),
                &prepared,
                DbRead::Live(&db),
                None,
                None,
            ) {
                Err(error) => error,
                Ok(_) => panic!("scheduled action ancestry must fence nested elevation"),
            };
            assert_eq!(
                error.diagnostic.code, "SNAPBACK_HANDLER_WRITE_IN_QUERY",
                "operation {op} must refuse before resolving the deliberately missing table",
            );
        }
    }

    /// @ref LLP 0231#d7--handler-reads-are-scoped-unless-the-call-site-is-explicitly-elevated
    #[test]
    fn table_visibility_caller_backed_action_root_refuses_nested_elevation() {
        let caller = input(Some("alice"));
        let authority = InvocationGate::prepare_dev_input(
            InvocationSource::LocalAction,
            ServerProfile::Test,
            &caller,
        )
        .expect("prepare caller-backed action authority");
        let root = action_root(authority);
        let (mutation, prepared) = nested_mutation_from(&root, elevated_operation_source("get"));
        let FunctionRuntime::IbexModule(module) = &mutation.runtime else {
            unreachable!("nested fixture is an Ibex mutation");
        };
        let db = ready_db();
        let error = match execute_ibex_mutation_prepared(
            module,
            caller,
            &prepared,
            DbRead::Live(&db),
            None,
            None,
        ) {
            Err(error) => error,
            Ok(_) => panic!("caller identity cannot turn an action into an elevation root"),
        };
        assert_eq!(error.diagnostic.code, "SNAPBACK_HANDLER_WRITE_IN_QUERY");
    }

    /// @ref LLP 0231#d7--handler-reads-are-scoped-unless-the-call-site-is-explicitly-elevated
    #[test]
    fn table_visibility_direct_caller_query_and_mutation_keep_elevated_reads() {
        const SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async probe(ctx) {
    await ctx.db.elevated.get('owner_docs', 'owner-bob');
    await ctx.db.elevated.getMany('owner_docs', ['owner-bob', 'owner-alice']);
    await ctx.db.elevated.uniqueMany('owner_docs', 'byBody', [{ body: 'bob-only' }]);
    return await ctx.db.elevated.query('owner_docs').collect();
  }
};
"#;
        let db = ready_db();
        let caller = input(Some("alice"));

        let query = ibex_function("probe", FunctionKind::Query, SOURCE);
        let query_authority = InvocationGate::prepare_dev_input(
            InvocationSource::LocalQuery,
            ServerProfile::Test,
            &caller,
        )
        .expect("prepare direct query authority");
        let prepared_query = InvocationGate::prepare_function(query_authority, &query)
            .expect("prepare direct named query");
        assert!(prepared_query.authority().elevated_database_allowed());
        let FunctionRuntime::IbexModule(query_module) = &query.runtime else {
            unreachable!("direct query fixture is Ibex");
        };
        let query_output = run_ibex_query_with_reads_prepared(
            query_module,
            caller.clone(),
            &prepared_query,
            DbRead::Live(&db),
            None,
            false,
            None,
        )
        .expect("direct caller-backed query keeps D7 elevation");
        assert_eq!(query_output.output.rows.len(), 2);

        let mutation = ibex_function("probe", FunctionKind::Mutation, SOURCE);
        let mutation_authority = InvocationGate::prepare_dev_input(
            InvocationSource::LocalMutation,
            ServerProfile::Test,
            &caller,
        )
        .expect("prepare direct mutation authority");
        let prepared_mutation = InvocationGate::prepare_function(mutation_authority, &mutation)
            .expect("prepare direct named mutation");
        assert!(prepared_mutation.authority().elevated_database_allowed());
        let FunctionRuntime::IbexModule(mutation_module) = &mutation.runtime else {
            unreachable!("direct mutation fixture is Ibex");
        };
        let mutation_output = execute_ibex_mutation_prepared(
            mutation_module,
            caller,
            &prepared_mutation,
            DbRead::Live(&db),
            None,
            None,
        )
        .expect("direct caller-backed mutation keeps D7 elevation");
        assert_eq!(mutation_output.result.as_array().unwrap().len(), 2);
    }

    #[test]
    fn table_visibility_ctx_db_get_is_exact_for_owner_membership_and_any_of() {
        const SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async inspect(ctx) {
    return {
      ownerAllowed: await ctx.db.get('owner_docs', 'owner-alice'),
      ownerHidden: await ctx.db.get('owner_docs', 'owner-bob'),
      ownerElevated: await ctx.db.elevated.get('owner_docs', 'owner-bob'),
      memberAllowed: await ctx.db.get('membership_docs', 'membership-visible'),
      memberHidden: await ctx.db.get('membership_docs', 'membership-hidden'),
      selfResourceAllowed: await ctx.db.get('resources', 'resource-visible'),
      selfResourceHidden: await ctx.db.get('resources', 'resource-hidden'),
      anyMembershipOnly: await ctx.db.get('any_docs', 'any-membership-only'),
      anyHidden: await ctx.db.get('any_docs', 'any-hidden'),
      integerOwner: await ctx.db.get('integer_owner_docs', 'integer-owner'),
      integerOwnerMiss: await ctx.db.get('integer_owner_docs', 'missing'),
    };
  }
};
"#;
        let db = ready_db();
        let mut alice = context(&db, Some("alice"), false);
        let result = run_ibex_handler_with_context(&module(SOURCE, "inspect"), &mut alice, None)
            .expect("point visibility handler runs");
        assert_eq!(result["ownerAllowed"]["_id"], "owner-alice");
        assert_eq!(result["ownerHidden"], Value::Null);
        assert_eq!(result["ownerElevated"]["_id"], "owner-bob");
        assert_eq!(result["memberAllowed"]["_id"], "membership-visible");
        assert_eq!(result["memberHidden"], Value::Null);
        assert_eq!(result["selfResourceAllowed"]["_id"], "resource-visible");
        assert_eq!(result["selfResourceHidden"], Value::Null);
        assert_eq!(result["anyMembershipOnly"]["_id"], "any-membership-only");
        assert_eq!(result["anyHidden"], Value::Null);
        assert_eq!(result["integerOwner"], Value::Null);
        assert_eq!(result["integerOwnerMiss"], Value::Null);
        assert!(alice.reads.iter().any(|dependency| {
            dependency.kind == CapturedReadKind::Query
                && dependency.table.as_deref() == Some("resource_members")
        }));
    }

    #[test]
    fn batch_get_many_preserves_order_duplicates_length_and_visibility_nulls() {
        const SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async inspect(ctx) {
    return {
      owners: await ctx.db.getMany('owner_docs', ['owner-bob', 'owner-alice', 'missing', 'owner-alice']),
      memberships: await ctx.db.getMany('membership_docs', ['membership-hidden', 'membership-visible']),
      anyOf: await ctx.db.getMany('any_docs', ['any-hidden', 'any-membership-only']),
      nonText: await ctx.db.getMany('integer_owner_docs', ['integer-owner', 'missing']),
    };
  }
};
"#;
        let db = ready_db();
        let mut alice = context(&db, Some("alice"), false);
        let result = run_ibex_handler_with_context(&module(SOURCE, "inspect"), &mut alice, None)
            .expect("batch point visibility handler runs");

        assert_eq!(result["owners"].as_array().unwrap().len(), 4);
        assert_eq!(result["owners"][0], Value::Null);
        assert_eq!(result["owners"][1]["_id"], "owner-alice");
        assert_eq!(result["owners"][2], Value::Null);
        assert_eq!(result["owners"][3], result["owners"][1]);
        assert_eq!(result["memberships"][0], Value::Null);
        assert_eq!(result["memberships"][1]["_id"], "membership-visible");
        assert_eq!(result["anyOf"][0], Value::Null);
        assert_eq!(result["anyOf"][1]["_id"], "any-membership-only");
        assert_eq!(result["nonText"], json!([null, null]));

        const ELEVATED_SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async inspect(ctx) {
    return await ctx.db.elevated.getMany(
      'owner_docs',
      ['owner-bob', 'owner-alice', 'missing'],
    );
  }
};
"#;
        let mut elevated_alice = context(&db, Some("alice"), false);
        let elevated = run_ibex_handler_with_context(
            &module(ELEVATED_SOURCE, "inspect"),
            &mut elevated_alice,
            None,
        )
        .expect("explicit elevated batch read runs");
        assert_eq!(elevated[0]["_id"], "owner-bob");
        assert_eq!(elevated[1]["_id"], "owner-alice");
        assert_eq!(elevated[2], Value::Null);
        assert!(elevated_alice.reads.iter().any(|dependency| {
            dependency.table.as_deref() == Some("owner_docs")
                && dependency.id.as_deref() == Some("owner-bob")
                && dependency.kind == CapturedReadKind::Row
        }));
        assert!(
            elevated_alice.reads.iter().all(|dependency| {
                dependency.table.as_deref() != Some("owner_docs")
                    || dependency.kind != CapturedReadKind::Query
            }),
            "elevated batch points capture exact rows without a visibility predicate"
        );

        let owner_captures = alice
            .reads
            .iter()
            .filter(|dependency| dependency.table.as_deref() == Some("owner_docs"))
            .map(read_dependency_key)
            .collect::<BTreeSet<_>>();
        const DISTINCT_SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async inspect(ctx) {
    return await ctx.db.getMany('owner_docs', ['owner-bob', 'owner-alice', 'missing']);
  }
};
"#;
        let mut distinct_alice = context(&db, Some("alice"), false);
        run_ibex_handler_with_context(
            &module(DISTINCT_SOURCE, "inspect"),
            &mut distinct_alice,
            None,
        )
        .expect("distinct-only batch point visibility handler runs");
        let distinct_owner_captures = distinct_alice
            .reads
            .iter()
            .filter(|dependency| dependency.table.as_deref() == Some("owner_docs"))
            .map(read_dependency_key)
            .collect::<BTreeSet<_>>();
        assert_eq!(
            owner_captures, distinct_owner_captures,
            "duplicate ids add no dependency beyond the distinct input identities"
        );

        let (trace_result, trace) = with_host_call_trace(|| {
            let mut traced = context(&db, Some("alice"), false);
            run_ibex_handler_with_context(&module(SOURCE, "inspect"), &mut traced, None)
        });
        trace_result.expect("traced batch handler runs");
        let cost = trace
            .iter()
            .find(|entry| entry.op == "db.getMany")
            .and_then(|entry| entry.cost.as_ref())
            .expect("batch host call publishes bounded cost facts")
            .clone();
        assert_eq!(cost.logical_batch_count, 1);
        assert_eq!(cost.item_count, 4);
        assert_eq!(cost.distinct_item_count, 3);
        assert_eq!(cost.physical_statement_count, 1);
        assert_eq!(cost.physical_chunk_count, 1);
        assert_eq!(
            cost.max_policy_probe_count,
            3 * BATCH_READ_MAX_POLICY_PROBES_PER_ITEM,
        );
        let (anonymous_result, anonymous_trace) = with_host_call_trace(|| {
            let mut anonymous = context(&db, None, false);
            run_ibex_handler_with_context(&module(SOURCE, "inspect"), &mut anonymous, None)
        });
        anonymous_result.expect("same batch runs with different visibility outcomes");
        let anonymous_cost = anonymous_trace
            .iter()
            .find(|entry| entry.op == "db.getMany")
            .and_then(|entry| entry.cost.as_ref())
            .expect("anonymous batch publishes cost facts");
        assert_eq!(
            anonymous_cost, &cost,
            "public batch cost facts cannot vary with hidden-row matches",
        );
    }

    #[test]
    fn batch_unique_many_preserves_order_duplicates_and_manifest_key_order() {
        const SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async inspect(ctx) {
    return {
      slugs: await ctx.db.uniqueMany('unique_docs', 'bySlug', [
        { slug: 'two' }, { slug: 'one' }, { slug: 'two' }, { slug: 'missing' }
      ]),
      compound: await ctx.db.uniqueMany('unique_docs', 'byScopeAlias', [
        { alias: 'second', scope: 'global' }
      ]),
    };
  }
};
"#;
        let db = unique_ready_db();
        let mut ctx = context(&db, None, false);
        let result = run_ibex_handler_with_context(&module(SOURCE, "inspect"), &mut ctx, None)
            .expect("unique batch handler runs");
        assert_eq!(result["slugs"].as_array().unwrap().len(), 4);
        assert_eq!(result["slugs"][0]["_id"], "unique-two");
        assert_eq!(result["slugs"][1]["_id"], "unique-one");
        assert_eq!(result["slugs"][2], result["slugs"][0]);
        assert_eq!(result["slugs"][3], Value::Null);
        assert_eq!(result["compound"][0]["_id"], "unique-two");
        const DISTINCT_SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async inspect(ctx) {
    return {
      slugs: await ctx.db.uniqueMany('unique_docs', 'bySlug', [
        { slug: 'two' }, { slug: 'one' }, { slug: 'missing' }
      ]),
      compound: await ctx.db.uniqueMany('unique_docs', 'byScopeAlias', [
        { alias: 'second', scope: 'global' }
      ]),
    };
  }
};
"#;
        let mut distinct_ctx = context(&db, None, false);
        run_ibex_handler_with_context(&module(DISTINCT_SOURCE, "inspect"), &mut distinct_ctx, None)
            .expect("distinct-only unique batch handler runs");
        assert_eq!(
            ctx.reads
                .iter()
                .map(read_dependency_key)
                .collect::<BTreeSet<_>>(),
            distinct_ctx
                .reads
                .iter()
                .map(read_dependency_key)
                .collect::<BTreeSet<_>>(),
            "duplicate unique keys add no dependency beyond the distinct input identities",
        );
    }

    #[test]
    fn batch_unique_many_overlays_buffered_insert_and_duplicate_keys() {
        const SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async inspect(ctx) {
    const id = await ctx.db.insert('unique_docs', {
      slug: 'buffered', scope: 'local', alias: 'inserted'
    });
    return {
      id,
      rows: await ctx.db.uniqueMany('unique_docs', 'bySlug', [
        { slug: 'buffered' }, { slug: 'buffered' }
      ]),
    };
  }
};
"#;
        let db = unique_ready_db();
        let mut ctx = context(&db, None, true);
        let result = run_ibex_handler_with_context(&module(SOURCE, "inspect"), &mut ctx, None)
            .expect("unique batch sees a buffered insert");
        assert_eq!(result["rows"].as_array().unwrap().len(), 2);
        assert_eq!(result["rows"][0]["_id"], result["id"]);
        assert_eq!(result["rows"][0]["slug"], "buffered");
        assert_eq!(result["rows"][1], result["rows"][0]);
        assert!(ctx.reads.iter().any(|dependency| {
            dependency.kind == CapturedReadKind::MissingRow
                && dependency.id.as_deref() == result["id"].as_str()
        }));
    }

    #[test]
    fn batch_unique_many_overlays_buffered_unique_key_move_for_old_and_new_keys() {
        const SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async inspect(ctx) {
    await ctx.db.patch('unique_docs', 'unique-one', { slug: 'moved' });
    return await ctx.db.uniqueMany('unique_docs', 'bySlug', [
      { slug: 'one' }, { slug: 'moved' }
    ]);
  }
};
"#;
        let db = unique_ready_db();
        let mut ctx = context(&db, None, true);
        let result = run_ibex_handler_with_context(&module(SOURCE, "inspect"), &mut ctx, None)
            .expect("unique batch sees both sides of a buffered key move");
        assert_eq!(result[0], Value::Null);
        assert_eq!(result[1]["_id"], "unique-one");
        assert_eq!(result[1]["slug"], "moved");
        assert!(ctx.reads.iter().any(|dependency| {
            dependency.kind == CapturedReadKind::Row
                && dependency.id.as_deref() == Some("unique-one")
        }));
    }

    #[test]
    fn batch_unique_many_overlays_buffered_delete() {
        const SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async inspect(ctx) {
    await ctx.db.delete('unique_docs', 'unique-two');
    return await ctx.db.uniqueMany('unique_docs', 'bySlug', [{ slug: 'two' }]);
  }
};
"#;
        let db = unique_ready_db();
        let mut ctx = context(&db, None, true);
        let result = run_ibex_handler_with_context(&module(SOURCE, "inspect"), &mut ctx, None)
            .expect("unique batch hides a buffered delete");
        assert_eq!(result, json!([null]));
        assert!(ctx.reads.iter().any(|dependency| {
            dependency.kind == CapturedReadKind::Row
                && dependency.id.as_deref() == Some("unique-two")
        }));
    }

    #[test]
    fn batch_unique_many_cost_accounts_for_overlay_and_hides_presence_outcomes() {
        const SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async inspect(ctx) {
    return await ctx.db.uniqueMany('unique_docs', 'bySlug', [
      { slug: 'requested-one' }, { slug: 'requested-two' }
    ]);
  }
};
"#;
        let trace_overlay = |db: &LocalDatabase| {
            let mut ctx = context(db, Some("alice"), true);
            for (id, slug) in [
                ("touched-one", "requested-one"),
                ("touched-two", "requested-two"),
            ] {
                ctx.writes.push(BufferedWrite::Patch {
                    table: "unique_docs".to_owned(),
                    id: id.to_owned(),
                    values: Map::from_iter([("slug".to_owned(), json!(slug))]),
                });
            }
            let (result, trace) = with_host_call_trace(|| {
                run_ibex_handler_with_context(&module(SOURCE, "inspect"), &mut ctx, None)
            });
            let result = result.expect("traced unique overlay batch runs");
            let cost = trace
                .iter()
                .find(|entry| entry.op == "db.uniqueMany")
                .and_then(|entry| entry.cost.as_ref())
                .expect("unique overlay batch publishes bounded cost facts")
                .clone();
            (result, cost)
        };

        let hidden_db = restricted_unique_overlay_db(true);
        let absent_db = restricted_unique_overlay_db(false);
        let (hidden_result, hidden_cost) = trace_overlay(&hidden_db);
        let (absent_result, absent_cost) = trace_overlay(&absent_db);

        assert_eq!(hidden_result, json!([null, null]));
        assert_eq!(absent_result, hidden_result);
        assert_eq!(hidden_cost.item_count, 2);
        assert_eq!(hidden_cost.distinct_item_count, 2);
        assert_eq!(hidden_cost.physical_statement_count, 3);
        assert_eq!(hidden_cost.physical_chunk_count, 3);
        assert_eq!(
            hidden_cost.max_policy_probe_count,
            // Two request-key evaluations, two touched-row storage checks,
            // and two keys x two touched-candidate effective rechecks.
            (2 + 2 + 2 * 2) * BATCH_READ_MAX_POLICY_PROBES_PER_ITEM,
        );
        assert_eq!(
            absent_cost, hidden_cost,
            "public overlay cost facts cannot distinguish hidden touched rows from absent ones",
        );
    }

    #[test]
    fn batch_unique_many_refuses_index_and_where_applicable_errors_before_reads() {
        let db = unique_ready_db();
        for (index, keys, expected_code) in [
            (
                "missing",
                json!([{ "slug": "one" }]),
                "SNAPBACK_BATCH_READ_INDEX_INVALID",
            ),
            (
                "byScope",
                json!([{ "scope": "global" }]),
                "SNAPBACK_BATCH_READ_INDEX_INVALID",
            ),
            (
                "bySlug",
                json!([{ "wrong": "one" }]),
                "SNAPBACK_BATCH_READ_KEY_INVALID",
            ),
            ("byAlias", json!([{}]), "SNAPBACK_BATCH_READ_KEY_INVALID"),
            (
                "byAlias",
                json!([{ "alias": null }]),
                "SNAPBACK_BATCH_READ_KEY_INVALID",
            ),
            (
                "byScopeAlias",
                json!([{ "scope": "global" }]),
                "SNAPBACK_BATCH_READ_KEY_INVALID",
            ),
            (
                "byScopeAlias",
                json!([{ "scope": "global", "alias": null }]),
                "SNAPBACK_BATCH_READ_KEY_INVALID",
            ),
        ] {
            let mut ctx = context(&db, None, false);
            let error = ctx
                .handle_host_call(
                    "db.uniqueMany",
                    json!({ "table": "unique_docs", "index": index, "keys": keys }),
                )
                .expect_err("invalid unique batch must refuse");
            assert_eq!(error.diagnostic.code, expected_code, "index={index}");
            assert!(
                ctx.reads.is_empty(),
                "refusal must precede dependency/storage evidence"
            );
        }
    }

    #[test]
    fn batch_read_request_and_response_bounds_are_exact_and_ordered() {
        use crate::manifest::{
            BATCH_READ_MAX_INPUT_BYTES, BATCH_READ_MAX_ITEMS, BATCH_READ_MAX_RESPONSE_BYTES,
        };

        let exact_items = json!({
            "table": "unique_docs",
            "ids": (0..BATCH_READ_MAX_ITEMS).map(|index| format!("id-{index}")).collect::<Vec<_>>(),
        });
        super::enforce_batch_read_request_bounds(&exact_items, BATCH_READ_MAX_ITEMS)
            .expect("the exact item ceiling admits");
        let item_over = super::enforce_batch_read_request_bounds(
            &json!({ "table": "unique_docs", "ids": [] }),
            BATCH_READ_MAX_ITEMS + 1,
        )
        .expect_err("one item over refuses");
        assert_eq!(
            item_over.diagnostic.code,
            "SNAPBACK_BATCH_READ_ITEMS_EXCEEDED"
        );

        let empty = json!({ "table": "unique_docs", "ids": [""] });
        let overhead = crate::rqs_contract::jcs(&empty).unwrap().len();
        let exact_input = json!({
            "table": "unique_docs",
            "ids": ["x".repeat(BATCH_READ_MAX_INPUT_BYTES - overhead)],
        });
        assert_eq!(
            crate::rqs_contract::jcs(&exact_input).unwrap().len(),
            BATCH_READ_MAX_INPUT_BYTES
        );
        super::enforce_batch_read_request_bounds(&exact_input, 1)
            .expect("the exact canonical input-byte ceiling admits");
        let input_over = json!({
            "table": "unique_docs",
            "ids": ["x".repeat(BATCH_READ_MAX_INPUT_BYTES - overhead + 1)],
        });
        let error = super::enforce_batch_read_request_bounds(&input_over, 1)
            .expect_err("one canonical input byte over refuses");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_BATCH_READ_INPUT_BYTES_EXCEEDED"
        );

        IbexHostContext::finish_batch_read_response(vec![Some(Value::String(
            "x".repeat(BATCH_READ_MAX_RESPONSE_BYTES - 4),
        ))])
        .expect("the exact canonical response-byte ceiling admits");
        let error = IbexHostContext::finish_batch_read_response(vec![Some(Value::String(
            "x".repeat(BATCH_READ_MAX_RESPONSE_BYTES - 3),
        ))])
        .expect_err("one canonical response byte over refuses");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_BATCH_READ_RESPONSE_BYTES_EXCEEDED"
        );

        let db = unique_ready_db();
        const EMPTY_SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async inspect(ctx) {
    return [await ctx.db.getMany('unique_docs', []), await ctx.db.uniqueMany('unique_docs', 'bySlug', [])];
  }
};
"#;
        let (empty_result, empty_trace) = with_host_call_trace(|| {
            let mut empty_ctx = context(&db, None, false);
            run_ibex_handler_with_context(&module(EMPTY_SOURCE, "inspect"), &mut empty_ctx, None)
        });
        assert_eq!(empty_result.unwrap(), json!([[], []]));
        assert!(
            empty_trace
                .iter()
                .all(|entry| entry.op != "db.getMany" && entry.op != "db.uniqueMany"),
            "empty JS batches must not cross the host trace boundary",
        );

        let mut ctx = context(&db, None, false);
        let error = ctx
            .handle_host_call("db.getMany", json!({ "ids": [] }))
            .expect_err("missing table is malformed before the empty fast path");
        assert_eq!(error.diagnostic.code, "SNAPBACK_BATCH_READ_INPUT_INVALID");
        let mut malformed = (0..BATCH_READ_MAX_ITEMS)
            .map(|index| json!(format!("id-{index}")))
            .collect::<Vec<_>>();
        malformed.push(json!(42));
        let error = ctx
            .handle_host_call(
                "db.getMany",
                json!({ "table": "unique_docs", "ids": malformed }),
            )
            .expect_err("malformed input wins before item overflow");
        assert_eq!(error.diagnostic.code, "SNAPBACK_BATCH_READ_INPUT_INVALID");
    }

    #[test]
    fn batch_reads_keep_membership_tables_private() {
        let db = ready_db();
        let mut ctx = context(&db, Some("alice"), false);
        for (op, args) in [
            (
                "db.getMany",
                json!({ "table": "resource_members", "ids": ["membership-alice-visible"] }),
            ),
            (
                "db.uniqueMany",
                json!({ "table": "resource_members", "index": "anything", "keys": [{}] }),
            ),
        ] {
            let error = ctx
                .handle_host_call(op, args)
                .expect_err("membership batch reads remain private");
            assert_eq!(error.diagnostic.code, "SNAPBACK_MEMBERSHIP_READ_PRIVATE");
        }
    }

    #[test]
    fn table_visibility_effective_point_short_circuits_hidden_storage_policy_errors() {
        let db = ready_db();
        let ctx = context(&db, Some("alice"), false);
        let unresolved_membership = TableVisibilityV1::Membership {
            declaration: "not-installed".to_owned(),
            resource_field: "resourceId".to_owned(),
            roles: Some(vec!["reader".to_owned()]),
        };
        let effective = json!({ "resourceId": "resource-visible" });

        assert!(
            !ctx.effective_point_is_visible(
                Some(&unresolved_membership),
                true,
                false,
                Some(&effective),
            )
            .expect("the hidden-row gate runs before the fallible policy probe")
        );
    }

    #[test]
    fn table_visibility_ctx_db_buffered_overlay_cannot_bypass_policy() {
        let mut db = ready_db();
        let mut ctx = context(&db, Some("alice"), true);
        assert_eq!(
            ctx.handle_host_call(
                "db.patch",
                json!({
                    "table": "owner_docs",
                    "id": "owner-bob",
                    "values": { "body": "must-not-change" },
                }),
            )
            .expect("read-gate hidden ownership patch"),
            Value::Bool(false),
            "patch existence also collapses an excluded row to not-found",
        );
        assert_eq!(
            ctx.handle_host_call(
                "db.get",
                json!({ "table": "owner_docs", "id": "owner-bob" }),
            )
            .expect("hidden point read after no-op patch"),
            Value::Null,
            "patching a hidden row's policy field cannot reveal its stored fields",
        );
        assert_eq!(
            ctx.handle_host_call(
                "db.getMany",
                json!({ "table": "owner_docs", "ids": ["owner-bob", "missing"] }),
            )
            .expect("hidden batch point read after no-op patch"),
            json!([null, null]),
        );

        let visible_insert = ctx
            .handle_host_call(
                "db.insert",
                json!({
                    "table": "owner_docs",
                    "values": { "body": "buffered-visible" },
                }),
            )
            .expect("buffer visible owner insert")
            .as_str()
            .unwrap()
            .to_owned();
        for supplied_owner in ["alice", "bob"] {
            let error = ctx
                .handle_host_call(
                    "db.insert",
                    json!({
                        "table": "owner_docs",
                        "values": { "ownerId": supplied_owner, "body": "forged" },
                    }),
                )
                .expect_err("caller-provided owner is refused even when equal");
            assert_eq!(
                error.diagnostic.code,
                "SNAPBACK_TABLE_WRITE_OWNER_INPUT_REFUSED"
            );
        }
        assert_eq!(
            ctx.handle_host_call(
                "db.get",
                json!({ "table": "owner_docs", "id": visible_insert }),
            )
            .unwrap()["body"],
            "buffered-visible",
        );
        let batch = ctx
            .handle_host_call(
                "db.getMany",
                json!({ "table": "owner_docs", "ids": ["owner-bob", visible_insert.clone(), visible_insert.clone()] }),
            )
            .expect("batch overlays buffered inserts");
        assert_eq!(batch[0], Value::Null);
        assert_eq!(batch[1]["body"], "buffered-visible");
        assert_eq!(batch[2], batch[1]);

        let member_insert = ctx
            .handle_host_call(
                "db.insert",
                json!({
                    "table": "membership_docs",
                    "values": { "resourceId": "resource-visible", "body": "buffered-member" },
                }),
            )
            .expect("buffer membership-visible insert")
            .as_str()
            .unwrap()
            .to_owned();
        assert_eq!(
            ctx.handle_host_call(
                "db.get",
                json!({ "table": "membership_docs", "id": member_insert }),
            )
            .unwrap()["body"],
            "buffered-member",
            "Phase 1a does not add generic write enforcement to membership-visible ordinary tables",
        );

        let output = ctx
            .handle_host_call(
                "db.query",
                json!({
                    "plan": {
                        "table": "owner_docs",
                        "filters": [],
                        "order": [],
                        "limit": 1024,
                        "indexed_by": null,
                    },
                }),
            )
            .expect("buffered owner query");
        let ids = output["rows"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| row["_id"].as_str().unwrap())
            .collect::<Vec<_>>();
        assert!(ids.contains(&"owner-alice"));
        assert!(ids.contains(&visible_insert.as_str()));
        assert!(!ids.contains(&"owner-bob"));
        let writes = std::mem::take(&mut ctx.writes);
        let reads = std::mem::take(&mut ctx.reads);
        drop(ctx);
        db.mutation_writes()
            .commit_buffered_writes(&input(Some("alice")), writes, reads, Value::Null)
            .expect("commit centrally stamps the installed owner field");
        let stamped = DbRead::Live(&db)
            .get("owner_docs", &visible_insert)
            .expect("read stamped insert")
            .expect("stamped insert exists");
        assert_eq!(stamped["ownerId"], "alice");

        let mut delete_ctx = context(&db, Some("alice"), true);
        assert_eq!(
            delete_ctx
                .handle_host_call(
                    "db.delete",
                    json!({ "table": "owner_docs", "id": "owner-bob" }),
                )
                .expect("read-gate hidden delete"),
            Value::Bool(false),
            "delete existence also collapses an excluded row to not-found",
        );
    }

    #[test]
    fn table_visibility_hidden_patch_and_delete_are_no_ops_at_commit() {
        let mut db = ready_db();
        let mut ctx = context(&db, Some("alice"), true);

        let hidden_patch = ctx
            .handle_host_call(
                "db.patch",
                json!({
                    "table": "owner_docs",
                    "id": "owner-bob",
                    "values": { "body": "must-not-change" },
                }),
            )
            .expect("hidden malformed patch is indistinguishable from a miss");
        let missing_patch = ctx
            .handle_host_call(
                "db.patch",
                json!({
                    "table": "owner_docs",
                    "id": "missing",
                    "values": { "body": "must-not-change" },
                }),
            )
            .expect("missing malformed patch remains a miss");
        let hidden_read = ctx
            .handle_host_call(
                "db.get",
                json!({ "table": "owner_docs", "id": "owner-bob" }),
            )
            .expect("hidden row remains null after the malformed no-op patch");
        let missing_read = ctx
            .handle_host_call("db.get", json!({ "table": "owner_docs", "id": "missing" }))
            .expect("missing row remains null after the malformed no-op patch");
        let hidden_delete = ctx
            .handle_host_call(
                "db.delete",
                json!({ "table": "owner_docs", "id": "owner-bob" }),
            )
            .expect("hidden delete is read-gated");

        assert_eq!(hidden_patch, Value::Bool(false));
        assert_eq!(missing_patch, Value::Bool(false));
        assert_eq!(hidden_read, Value::Null);
        assert_eq!(missing_read, Value::Null);
        assert_eq!(hidden_delete, Value::Bool(false));
        assert!(
            ctx.writes.is_empty(),
            "invisible and absent targets must not enqueue a write"
        );

        let hidden_immutable = ctx
            .handle_host_call(
                "db.patch",
                json!({
                    "table": "owner_docs",
                    "id": "owner-bob",
                    "values": { "ownerId": "alice" },
                }),
            )
            .expect_err("owner identity is immutable before old-row access");
        let missing_immutable = ctx
            .handle_host_call(
                "db.patch",
                json!({
                    "table": "owner_docs",
                    "id": "missing",
                    "values": { "ownerId": "alice" },
                }),
            )
            .expect_err("owner immutability does not disclose row existence");
        assert_eq!(hidden_immutable.diagnostic, missing_immutable.diagnostic);
        assert_eq!(
            hidden_immutable.diagnostic.code,
            "SNAPBACK_TABLE_WRITE_OWNER_IMMUTABLE"
        );

        let writes = std::mem::take(&mut ctx.writes);
        let reads = std::mem::take(&mut ctx.reads);
        drop(ctx);
        db.mutation_writes()
            .commit_buffered_writes(&input(Some("alice")), writes, reads, Value::Null)
            .expect("read-gated no-op commits cleanly");

        let stored = DbRead::Live(&db)
            .get("owner_docs", "owner-bob")
            .expect("read hidden row after commit")
            .expect("hidden row still exists");
        assert_eq!(stored["ownerId"], "bob");
        assert_eq!(stored["body"], "bob-only");
    }

    #[test]
    fn table_visibility_ctx_db_query_refuses_conflicting_handler_policy() {
        let db = ready_db();
        let mut ctx = context(&db, Some("alice"), false);
        let error = ctx
            .handle_host_call(
                "db.query",
                json!({
                    "plan": {
                        "table": "owner_docs",
                        "tableVisibility": { "kind": "public-read" },
                        "filters": [],
                        "order": [],
                        "limit": 10,
                        "indexed_by": null,
                    },
                }),
            )
            .expect_err("handler policy cannot override the schema");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_TABLE_VISIBILITY_PLAN_MISMATCH"
        );

        let exact_membership = ctx
            .handle_host_call(
                "db.query",
                json!({
                    "plan": {
                        "table": "resources",
                        "tableVisibility": {
                            "kind": "membership",
                            "declaration": "resourceMembers",
                            "resourceField": "_id",
                            "roles": ["reader"],
                        },
                        "filters": [],
                        "order": [],
                        "limit": 10,
                        "indexed_by": null,
                    },
                }),
            )
            .expect("an exact membership duplicate agrees with the schema");
        assert_eq!(exact_membership["rows"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn table_visibility_sequence_scope_read_is_composed_with_declared_access() {
        let db = ready_db();
        let declaration = SequenceDeclaration {
            name: "ownerSequence".to_owned(),
            scope_table: "owner_docs".to_owned(),
            scope_access: SequenceScopeAccess::Public("public.v1".to_owned()),
        };
        let mut alice = context(&db, Some("alice"), true);
        alice.declared_sequences = vec![declaration.clone()];
        assert_eq!(
            alice
                .handle_host_call(
                    "sequence.allocate",
                    json!({ "counter": "ownerSequence", "scopeId": "owner-alice" }),
                )
                .expect("table policy and public sequence access both allow owner"),
            json!(1),
        );

        let mut hidden = context(&db, Some("alice"), true);
        hidden.declared_sequences = vec![declaration];
        let error = hidden
            .handle_host_call(
                "sequence.allocate",
                json!({ "counter": "ownerSequence", "scopeId": "owner-bob" }),
            )
            .expect_err("public sequence access cannot bypass the table policy");
        assert_eq!(
            error.diagnostic,
            super::sequence_parent_unavailable().diagnostic
        );
    }
}

#[cfg(test)]
mod membership_bridge_tests {
    use super::{
        HandlerErrorExposure, IbexHostContext, run_ibex_handler_with_context,
        run_ibex_handler_with_context_until_with_exposure, with_host_call_trace,
    };
    use crate::auth::admission::AdmissionLease;
    use crate::auth::invocation::{HandlerAuthProjection, ResolvedAppAuthority};
    use crate::manifest::{
        AuthInput, FieldManifest, FieldType, HandlerInput, IbexModule, MembershipLastHolder,
        MembershipManifest, MembershipOp, MembershipProvenance, MembershipScope, MembershipTarget,
        MembershipTransition, SchemaManifest, SeedData, SequenceDeclaration,
        SequenceExistingOwnerAccess, SequenceScopeAccess, TableManifest,
    };
    use crate::storage::{
        BufferedCommitPayload, ClientMutationIdentity, DbRead, LocalDatabase, MembershipWriter,
    };
    use serde_json::{Map, Value, json};
    use std::collections::BTreeMap;
    use std::path::Path;
    use std::sync::{Arc, Barrier};

    fn schema() -> SchemaManifest {
        SchemaManifest {
            tables: vec![
                TableManifest {
                    name: "app_members".to_owned(),
                    fields: vec![
                        FieldManifest {
                            name: "userId".to_owned(),
                            field_type: FieldType::Principal,
                            optional: false,
                        },
                        FieldManifest {
                            name: "role".to_owned(),
                            field_type: FieldType::String,
                            optional: false,
                        },
                    ],
                    indexes: Vec::new(),
                    syncable: true,
                    permission_backing: false,
                    permission_fields: None,
                    search_indexes: Vec::new(),
                    vector_indexes: Vec::new(),
                    search_live_limits: None,
                    membership: Some(MembershipManifest {
                        id: None,
                        principal: "userId".to_owned(),
                        resource: None,
                        role: "role".to_owned(),
                        roles: vec!["member".to_owned()],
                        pending_roles: None,
                        bootstrap_role: None,
                        last_holder: None,
                        expiry: None,
                        incidental: None,
                        provenance: Some(MembershipProvenance::Full),
                        transitions: vec![
                            MembershipTransition {
                                op: MembershipOp::Insert,
                                by: vec!["none".to_owned()],
                                target: MembershipTarget::Own,
                                from: None,
                                to: Some(vec!["member".to_owned()]),
                                fields: None,
                            },
                            MembershipTransition {
                                op: MembershipOp::Remove,
                                by: vec!["self".to_owned()],
                                target: MembershipTarget::Own,
                                from: Some(vec!["member".to_owned()]),
                                to: None,
                                fields: None,
                            },
                        ],
                        scope: MembershipScope::App,
                        resource_table: None,
                        principal_addressed_writes: None,
                    }),
                    authority_profile: None,
                    asset_sharing: None,
                    visibility: None,
                    history: None,
                },
                TableManifest {
                    name: "custom_acl".to_owned(),
                    fields: vec![FieldManifest {
                        name: "ownerId".to_owned(),
                        field_type: FieldType::Principal,
                        optional: false,
                    }],
                    indexes: Vec::new(),
                    syncable: true,
                    permission_backing: true,
                    permission_fields: Some(vec!["ownerId".to_owned()]),
                    search_indexes: Vec::new(),
                    vector_indexes: Vec::new(),
                    search_live_limits: None,
                    membership: None,
                    authority_profile: None,
                    asset_sharing: None,
                    visibility: None,
                    history: None,
                },
                TableManifest {
                    name: "scopes".to_owned(),
                    fields: vec![
                        FieldManifest {
                            name: "title".to_owned(),
                            field_type: FieldType::String,
                            optional: false,
                        },
                        FieldManifest {
                            name: "owner".to_owned(),
                            field_type: FieldType::Principal,
                            optional: true,
                        },
                    ],
                    indexes: Vec::new(),
                    syncable: true,
                    permission_backing: false,
                    permission_fields: None,
                    search_indexes: Vec::new(),
                    vector_indexes: Vec::new(),
                    search_live_limits: None,
                    membership: None,
                    authority_profile: None,
                    asset_sharing: None,
                    visibility: None,
                    history: None,
                },
                TableManifest {
                    name: "events".to_owned(),
                    fields: vec![FieldManifest {
                        name: "title".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    }],
                    indexes: Vec::new(),
                    syncable: true,
                    permission_backing: false,
                    permission_fields: None,
                    search_indexes: Vec::new(),
                    vector_indexes: Vec::new(),
                    search_live_limits: None,
                    membership: None,
                    authority_profile: None,
                    asset_sharing: None,
                    visibility: None,
                    history: None,
                },
                TableManifest {
                    name: "sequence_activity".to_owned(),
                    fields: vec![FieldManifest {
                        name: "title".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    }],
                    indexes: Vec::new(),
                    syncable: true,
                    permission_backing: false,
                    permission_fields: None,
                    search_indexes: Vec::new(),
                    vector_indexes: Vec::new(),
                    search_live_limits: None,
                    membership: None,
                    authority_profile: None,
                    asset_sharing: None,
                    visibility: Some(crate::manifest::TableVisibilityV1::PublicRead),
                    history: None,
                },
                TableManifest {
                    name: "event_members".to_owned(),
                    fields: vec![
                        FieldManifest {
                            name: "eventId".to_owned(),
                            field_type: FieldType::Id {
                                table: "events".to_owned(),
                            },
                            optional: false,
                        },
                        FieldManifest {
                            name: "userId".to_owned(),
                            field_type: FieldType::Principal,
                            optional: false,
                        },
                        FieldManifest {
                            name: "role".to_owned(),
                            field_type: FieldType::String,
                            optional: false,
                        },
                    ],
                    indexes: Vec::new(),
                    syncable: true,
                    permission_backing: false,
                    permission_fields: None,
                    search_indexes: Vec::new(),
                    vector_indexes: Vec::new(),
                    search_live_limits: None,
                    membership: Some(MembershipManifest {
                        id: None,
                        principal: "userId".to_owned(),
                        resource: Some("eventId".to_owned()),
                        role: "role".to_owned(),
                        roles: vec!["host".to_owned(), "guest".to_owned()],
                        pending_roles: None,
                        bootstrap_role: Some("host".to_owned()),
                        last_holder: Some(MembershipLastHolder {
                            protect: "host".to_owned(),
                        }),
                        expiry: None,
                        incidental: None,
                        provenance: Some(MembershipProvenance::Full),
                        transitions: vec![MembershipTransition {
                            op: MembershipOp::Insert,
                            by: vec!["host".to_owned()],
                            target: MembershipTarget::Other,
                            from: None,
                            to: Some(vec!["guest".to_owned()]),
                            fields: None,
                        }],
                        scope: MembershipScope::Resource,
                        resource_table: Some("events".to_owned()),
                        principal_addressed_writes: None,
                    }),
                    authority_profile: None,
                    asset_sharing: None,
                    visibility: None,
                    history: None,
                },
            ],
            ..SchemaManifest::default()
        }
    }

    fn input() -> HandlerInput {
        HandlerInput {
            auth: AuthInput {
                principal: Some("alice".to_owned()),
                user_id: Some("alice".to_owned()),
                session_id: None,
                ..AuthInput::default()
            },
            ..HandlerInput::default()
        }
    }

    fn context<'a>(db: &'a LocalDatabase) -> IbexHostContext<'a> {
        let input = input();
        let authority = ResolvedAppAuthority::dev_from_auth(&input.auth);
        IbexHostContext::new_with_projection(
            DbRead::Live(db),
            input,
            HandlerAuthProjection::from_authority(&authority, None).unwrap(),
            AdmissionLease::unmanaged(0, 0),
            MembershipWriter::from_resolved(&authority),
            true,
            true,
        )
        .expect("membership bridge context")
    }

    fn service_context<'a>(
        db: &'a LocalDatabase,
        authority_creating_consent: bool,
    ) -> IbexHostContext<'a> {
        let input = input();
        let authority = ResolvedAppAuthority::ServicePrincipal {
            actor_user_id: "agent-a".to_owned(),
            credential_id: "credential-a".to_owned(),
            credential_generation: 1,
            grant_id: "grant-a".to_owned(),
            token_id: "token-a".to_owned(),
            effective_user_id: Some("alice".to_owned()),
            scopes: Vec::new(),
            token_expires_at_ms: 10_000,
            integration_status: None,
        };
        IbexHostContext::new_with_projection(
            DbRead::Live(db),
            input,
            HandlerAuthProjection::from_authority(&authority, None).unwrap(),
            AdmissionLease::unmanaged(0, 0),
            MembershipWriter::from_resolved_with_authority_creating(
                &authority,
                authority_creating_consent,
            ),
            true,
            true,
        )
        .expect("service-principal membership context")
    }

    fn ready_db() -> LocalDatabase {
        let mut db = LocalDatabase::memory().expect("memory database");
        db.activate_current_auth_catalog().expect("auth catalog");
        db.schema_seed()
            .apply_schema(schema())
            .expect("membership schema");
        db
    }

    fn authority_profile_ready_db() -> LocalDatabase {
        let mut manifest = schema();
        let table = manifest
            .tables
            .iter_mut()
            .find(|table| table.name == "event_members")
            .expect("event-members table");
        let membership = table.membership.as_mut().expect("membership declaration");
        membership.id = Some("event_members".to_owned());
        membership.roles = vec!["owner".to_owned(), "admin".to_owned(), "member".to_owned()];
        membership.pending_roles = Some(vec!["invited".to_owned()]);
        membership.bootstrap_role = Some("owner".to_owned());
        membership.last_holder = Some(MembershipLastHolder {
            protect: "owner".to_owned(),
        });
        membership.transitions = vec![
            MembershipTransition {
                op: MembershipOp::Insert,
                by: vec!["owner".to_owned()],
                target: MembershipTarget::Other,
                from: None,
                to: Some(vec!["invited".to_owned()]),
                fields: None,
            },
            MembershipTransition {
                op: MembershipOp::SetRole,
                by: vec!["self".to_owned()],
                target: MembershipTarget::Own,
                from: Some(vec!["invited".to_owned()]),
                to: Some(vec!["member".to_owned()]),
                fields: None,
            },
            MembershipTransition {
                op: MembershipOp::SetRole,
                by: vec!["owner".to_owned()],
                target: MembershipTarget::Other,
                from: Some(vec!["member".to_owned()]),
                to: Some(vec!["admin".to_owned()]),
                fields: None,
            },
            MembershipTransition {
                op: MembershipOp::Remove,
                by: vec!["owner".to_owned()],
                target: MembershipTarget::Other,
                from: Some(vec![
                    "admin".to_owned(),
                    "member".to_owned(),
                    "invited".to_owned(),
                ]),
                to: None,
                fields: None,
            },
        ];
        table.search_indexes.push(
            serde_json::from_value(json!({
                "formatVersion": 1,
                "name": "search_admin_members",
                "semanticVersion": "authority-inspection-admin-members.v1",
                "analyzer": "snapback-category-unicode17-v1",
                "analyzerTablesDigest": "sha256:67feb427579c6f3f9d601d93251c19cb18b15ab13cf46e7f33d285c3ff10181d",
                "textFields": {
                    "role": { "weight": 1, "classification": "private" }
                },
                "fieldClassifications": { "eventId": "private" },
                "equalityFilters": [],
                "storedFields": ["role"],
                "highlightFields": ["role"],
                "visibility": {
                    "kind": "membership",
                    "declaration": "event_members",
                    "resourceField": "eventId",
                    "roles": ["admin", "owner"]
                },
                "tieBreak": "score-desc-row-id-asc.v1",
                "sourceLimits": {
                    "maxIndexedBytes": 32768,
                    "maxTokens": 2048,
                    "maxPostingOperations": 4096
                },
                "queryLimits": {
                    "maxCandidateWork": 10000,
                    "maxPrefixTerms": 256,
                    "minPrefixScalars": 2
                },
                "cursorLimits": { "ttlMs": 120000, "maxBytes": 2048 },
                "maintenanceLimits": {
                    "searchMaintenanceEffects": 1024,
                    "searchPostingOps": 4096,
                    "searchPositions": 8192,
                    "searchBytes": 262144
                }
            }))
            .expect("admin-only profile search index"),
        );
        let transition_matrix =
            crate::manifest::canonical_membership_transition_matrix(&membership.transitions);
        table.authority_profile = Some(
            serde_json::from_value(json!({
                "version": 1,
                "id": "event_members",
                "generation": "sha256:authority-profile-runtime-gate",
                "membership": {
                    "declaration": "event_members",
                    "manifestPath": "tables.event_members.membership",
                    "predicateIdentity": "snapback.membership-predicate.v1"
                },
                "tablePolicy": {
                    "identity": "snapback.table-visibility.v1",
                    "membershipDeclaration": "event_members"
                },
                "scopeRelation": {
                    "table": "event_members",
                    "resourceField": "eventId",
                    "resourceTable": "events",
                    "principalKey": "userId"
                },
                "statusPredicates": {
                    "active": "membership.roles",
                    "invited": "membership.pendingRoles"
                },
                "roleLattice": [
                    { "role": "owner", "implies": ["owner", "admin", "member"] },
                    { "role": "admin", "implies": ["admin", "member"] },
                    { "role": "member", "implies": ["member"] }
                ],
                "ownerBootstrapInvariant": {
                    "role": "owner",
                    "bootstrapRole": "owner",
                    "protectedLastHolderRole": "owner"
                },
                "transitionPreconditions": {
                    "source": "membership.transitions",
                    "membershipDeclarationId": "event_members",
                    "matrix": transition_matrix,
                    "provenance": "full",
                    "expiryPresent": false,
                    "principalAddressedWritesRemove": null,
                    "ownerMutation": "transfer-owner-only"
                },
                "authorizationEventFields": [
                    "eventId",
                    "userId",
                    "role",
                    "grantedByActor",
                    "grantedByEffective",
                    "grantedByGrant"
                ],
                "subjectDerivation": {
                    "strategy": "membership-principal-resource-v1",
                    "principalField": "userId",
                    "scopeField": "eventId",
                    "coarseGlobalWakeUniverse": ["membership-relation-insert-update-delete"]
                },
                "requiredIndexes": [
                    {
                        "name": "_membership_pk",
                        "fields": ["userId", "eventId"],
                        "unique": true,
                        "lookup": "principal-in-scope-point"
                    },
                    {
                        "name": "_membership_reverse",
                        "fields": ["eventId", "role", "userId"],
                        "unique": false,
                        "lookup": "protected-holders-and-scope-invalidation-range"
                    }
                ],
                "permittedCompositionClasses": [
                    "table-visibility.membership.v1",
                    "membership-visible-search.v1"
                ],
                "notYetQualifiedCompositionClasses": [],
                "roster": { "visibleFields": ["userId", "role"] },
                "operations": [
                    {
                        "name": "list",
                        "kind": "LiveQuery",
                        "authRequirement": "authenticated",
                        "hooks": ["useSnapbackQuery", "useSnapbackAuthorityRoster"],
                        "transitionOps": []
                    },
                    {
                        "name": "myRole",
                        "kind": "LiveQuery",
                        "authRequirement": "authenticated",
                        "hooks": ["useSnapbackQuery", "useSnapbackAuthorityMyRole"],
                        "transitionOps": []
                    },
                    {
                        "name": "invite",
                        "kind": "Mutation",
                        "authRequirement": "authenticated",
                        "hooks": ["useSnapbackMutation", "useSnapbackAuthorityMutation", "useSnapbackOutbox.mutationStatus", "useSnapbackAuthorityMutationStatus"],
                        "transitionOps": ["insert"]
                    },
                    {
                        "name": "join",
                        "kind": "Mutation",
                        "authRequirement": "authenticated",
                        "hooks": ["useSnapbackMutation", "useSnapbackAuthorityMutation", "useSnapbackOutbox.mutationStatus", "useSnapbackAuthorityMutationStatus"],
                        "transitionOps": ["setRole"]
                    },
                    {
                        "name": "changeRole",
                        "kind": "Mutation",
                        "authRequirement": "authenticated",
                        "hooks": ["useSnapbackMutation", "useSnapbackAuthorityMutation", "useSnapbackOutbox.mutationStatus", "useSnapbackAuthorityMutationStatus"],
                        "transitionOps": ["setRole"]
                    },
                    {
                        "name": "transferOwner",
                        "kind": "Mutation",
                        "authRequirement": "authenticated",
                        "hooks": ["useSnapbackMutation", "useSnapbackAuthorityMutation", "useSnapbackOutbox.mutationStatus", "useSnapbackAuthorityMutationStatus"],
                        "transitionOps": ["transferOwner"]
                    },
                    {
                        "name": "remove",
                        "kind": "Mutation",
                        "authRequirement": "authenticated",
                        "hooks": ["useSnapbackMutation", "useSnapbackAuthorityMutation", "useSnapbackOutbox.mutationStatus", "useSnapbackAuthorityMutationStatus"],
                        "transitionOps": ["remove"]
                    }
                ]
            }))
            .expect("authority profile"),
        );
        let mut db = LocalDatabase::memory().expect("authority profile runtime database");
        db.activate_current_auth_catalog().expect("auth catalog");
        db.schema_seed()
            .apply_schema(manifest)
            .expect("authority profile schema");
        db
    }

    fn commit_app_membership_command(db: &mut LocalDatabase, operation: serde_json::Value) {
        let mut ctx = context(db);
        ctx.handle_host_call("membership.write", operation)
            .expect("generated app-membership command");
        let commands = std::mem::take(&mut ctx.membership_commands);
        drop(ctx);
        let plans = db
            .membership_plans()
            .authorize_membership_commands(commands)
            .expect("authorized app-membership plans");
        db.mutation_writes()
            .commit_buffered_writes_idempotent_guarded(
                &input(),
                BufferedCommitPayload {
                    job_enqueues: Vec::new(),
                    job_producer: None,
                    writes: Vec::new(),
                    sequence_allocations: Vec::new(),
                    asset_admissions: Vec::new(),
                    asset_grant_ops: Vec::new(),
                    media_projection_proof: None,
                    expected_media_projection_binding: None,
                    membership_plans: plans,
                    read_dependencies: Vec::new(),
                    result: json!(null),
                    ctx_ledger: crate::manifest::CtxAnswerLedger {
                        version: crate::manifest::CTX_ANSWER_LEDGER_VERSION,
                        ids: Vec::new(),
                        now: 1,
                        auth_fingerprint: None,
                    },
                },
                None,
                || Ok(()),
                || Ok(()),
            )
            .expect("app-membership command commits");
    }

    fn ready_file_db(path: &Path) -> LocalDatabase {
        let mut db = LocalDatabase::open(path).expect("open shared handler sequence database");
        db.activate_current_auth_catalog().expect("auth catalog");
        db.schema_seed()
            .apply_schema(schema())
            .expect("shared handler schema");
        db
    }

    fn public_sequence_declaration() -> SequenceDeclaration {
        SequenceDeclaration {
            name: "eventNumber".to_owned(),
            scope_table: "scopes".to_owned(),
            scope_access: SequenceScopeAccess::Public("public.v1".to_owned()),
        }
    }

    fn sequence_input(title: &str) -> HandlerInput {
        HandlerInput {
            args: json!({ "scopeId": "event-a", "title": title }),
            ..HandlerInput::default()
        }
    }

    fn anonymous_sequence_context<'a>(
        db: &'a LocalDatabase,
        input: HandlerInput,
    ) -> IbexHostContext<'a> {
        let authority = ResolvedAppAuthority::Anonymous;
        let mut ctx = IbexHostContext::new_with_projection(
            DbRead::Live(db),
            input,
            HandlerAuthProjection::from_authority(&authority, None).unwrap(),
            AdmissionLease::unmanaged(0, 0),
            MembershipWriter::from_resolved(&authority),
            true,
            true,
        )
        .expect("anonymous sequence context");
        ctx.declared_sequences = vec![public_sequence_declaration()];
        ctx
    }

    fn take_sequence_payload(
        mut ctx: IbexHostContext<'_>,
        result: serde_json::Value,
    ) -> BufferedCommitPayload {
        let ctx_ledger = ctx.take_ctx_ledger().expect("sequence ctx ledger");
        let IbexHostContext {
            writes,
            sequence_allocations,
            job_enqueues,
            membership_commands,
            reads,
            asset_admissions,
            asset_grant_ops,
            ..
        } = ctx;
        assert!(membership_commands.is_empty());
        BufferedCommitPayload {
            writes,
            sequence_allocations,
            membership_plans: Vec::new(),
            read_dependencies: reads,
            result,
            ctx_ledger,
            job_enqueues,
            job_producer: None,
            asset_admissions,
            asset_grant_ops,
            media_projection_proof: None,
            expected_media_projection_binding: None,
        }
    }

    #[test]
    fn sequence_host_bridge_is_declared_scoped_and_commits_with_the_mutation() {
        let mut db = ready_db();
        db.schema_seed()
            .seed(SeedData {
                tables: BTreeMap::from([(
                    "scopes".to_owned(),
                    vec![Map::from_iter([
                        ("_id".to_owned(), json!("event-a")),
                        ("title".to_owned(), json!("A")),
                    ])],
                )]),
            })
            .expect("seed scope");

        let mut undeclared = context(&db);
        let error = undeclared
            .handle_host_call(
                "sequence.allocate",
                json!({ "counter": "eventNumber", "scopeId": "event-a" }),
            )
            .expect_err("undeclared counter must refuse at ctx boundary");
        assert_eq!(error.diagnostic.code, "SNAPBACK_SEQUENCE_UNDECLARED");
        drop(undeclared);

        let declaration = SequenceDeclaration {
            name: "eventNumber".to_owned(),
            scope_table: "scopes".to_owned(),
            scope_access: SequenceScopeAccess::Public("public.v1".to_owned()),
        };
        let mut ctx = context(&db);
        ctx.declared_sequences = vec![declaration.clone()];
        let allocated = ctx
            .handle_host_call(
                "sequence.allocate",
                json!({ "counter": "eventNumber", "scopeId": "event-a" }),
            )
            .expect("declared public allocation");
        assert_eq!(allocated, json!(1));
        let allocations = std::mem::take(&mut ctx.sequence_allocations);
        drop(ctx);
        let committed = db
            .mutation_writes()
            .commit_buffered_writes_idempotent_guarded(
                &input(),
                BufferedCommitPayload {
                    writes: Vec::new(),
                    sequence_allocations: allocations,
                    membership_plans: Vec::new(),
                    read_dependencies: Vec::new(),
                    result: json!({ "sequence": 1 }),
                    ctx_ledger: crate::manifest::CtxAnswerLedger::default(),
                    job_enqueues: Vec::new(),
                    job_producer: None,
                    asset_admissions: Vec::new(),
                    asset_grant_ops: Vec::new(),
                    media_projection_proof: None,
                    expected_media_projection_binding: None,
                },
                None,
                || Ok(()),
                || Ok(()),
            )
            .expect("allocation commit");
        assert_eq!(committed.sequence_allocations[0].value, 1);

        let mut next = context(&db);
        next.declared_sequences = vec![declaration];
        assert_eq!(
            next.handle_host_call(
                "sequence.allocate",
                json!({ "counter": "eventNumber", "scopeId": "event-a" }),
            )
            .expect("next allocation"),
            json!(2)
        );
        let missing = {
            let mut missing = context(&db);
            missing.declared_sequences = next.declared_sequences.clone();
            missing
                .handle_host_call(
                    "sequence.allocate",
                    json!({ "counter": "eventNumber", "scopeId": "absent" }),
                )
                .expect_err("missing scope")
        };
        assert_eq!(
            missing.diagnostic,
            super::sequence_parent_unavailable().diagnostic,
            "missing scope uses the invariant non-oracle refusal"
        );

        let private = SequenceDeclaration {
            name: "eventNumber".to_owned(),
            scope_table: "scopes".to_owned(),
            scope_access: SequenceScopeAccess::ExistingOwner(SequenceExistingOwnerAccess {
                kind: "existing-owner.v1".to_owned(),
                owner_field: "owner".to_owned(),
            }),
        };
        let mut hidden = anonymous_sequence_context(&db, HandlerInput::default());
        hidden.declared_sequences = vec![private.clone()];
        let hidden_error = hidden
            .handle_host_call(
                "sequence.allocate",
                json!({ "counter": "eventNumber", "scopeId": "event-a" }),
            )
            .expect_err("anonymous caller cannot reach an owner-only scope");
        let mut absent = anonymous_sequence_context(&db, HandlerInput::default());
        absent.declared_sequences = vec![private];
        let absent_error = absent
            .handle_host_call(
                "sequence.allocate",
                json!({ "counter": "eventNumber", "scopeId": "absent" }),
            )
            .expect_err("absent owner-only scope refuses");
        assert_eq!(
            serde_json::to_vec(&hidden_error.diagnostic).unwrap(),
            serde_json::to_vec(&absent_error.diagnostic).unwrap(),
            "hidden and absent handler scopes are byte-identical",
        );

        let mut closed_api = anonymous_sequence_context(&db, HandlerInput::default());
        let result = run_ibex_handler_with_context(
            &IbexModule {
                source: r#"
globalThis.__snapbackHandlers = {
  async inspect(ctx) {
    return {
      allocate: typeof ctx.sequence.allocate,
      current: typeof ctx.sequence.current,
      next: typeof ctx.sequence.next,
    };
  }
};
"#
                .to_owned(),
                export: "inspect".to_owned(),
            },
            &mut closed_api,
            None,
        )
        .expect("inspect closed sequence surface");
        assert_eq!(
            result,
            json!({ "allocate": "function", "current": "undefined", "next": "undefined" }),
            "the handler surface exposes allocation but no current/next-value API",
        );
    }

    // @ref LLP 0135#51-sequence-allocation — the two named app-authored
    // disclosure channels may reveal a tentative value, but neither an
    // invalidated commit nor a handler throw may retain any durable/result
    // trace of that attempt.
    #[test]
    fn sequence_abort_disclosure_channels_leave_no_durable_or_result_trace() {
        const COMPLETE_SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async disclose(ctx, args) {
    const sequence = await ctx.sequence.allocate('eventNumber', args.scopeId);
    await ctx.db.insert('sequence_activity', { title: args.title });
    console.log('tentative:' + sequence);
    return { sequence };
  }
};
"#;
        const THROW_SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async disclose(ctx, args) {
    const sequence = await ctx.sequence.allocate('eventNumber', args.scopeId);
    await ctx.db.insert('sequence_activity', { title: args.title });
    throw new Error('tentative:' + sequence);
  }
};
"#;
        let module = |source: &str| IbexModule {
            source: source.to_owned(),
            export: "disclose".to_owned(),
        };
        let seed_scope = |db: &mut LocalDatabase| {
            db.schema_seed()
                .seed(SeedData {
                    tables: BTreeMap::from([(
                        "scopes".to_owned(),
                        vec![Map::from_iter([
                            ("_id".to_owned(), json!("event-a")),
                            ("title".to_owned(), json!("A")),
                        ])],
                    )]),
                })
                .expect("seed sequence scope");
        };

        // Run A: T1 discloses value 1 and pauses. T2 commits that same
        // tentative value first, so T1's captured counter read is stale.
        let mut db = ready_db();
        seed_scope(&mut db);
        let t1_input = sequence_input("t1-aborted-activity");
        let mut t1_ctx = anonymous_sequence_context(&db, t1_input.clone());
        let (t1_result, t1_trace) = with_host_call_trace(|| {
            run_ibex_handler_with_context(&module(COMPLETE_SOURCE), &mut t1_ctx, None)
        });
        let t1_result = t1_result.expect("T1 handler completes before commit invalidation");
        assert_eq!(t1_result, json!({ "sequence": 1 }));
        let disclosed = t1_trace
            .iter()
            .find(|entry| entry.op == "runtime.log")
            .expect("console disclosure trace");
        assert!(
            disclosed.args["message"]
                .to_string()
                .contains("tentative:1"),
            "console trace carries the tentative value"
        );
        let t1_payload = take_sequence_payload(t1_ctx, t1_result);

        let t2_input = sequence_input("t2-committed-activity");
        let mut t2_ctx = anonymous_sequence_context(&db, t2_input.clone());
        let t2_result = run_ibex_handler_with_context(&module(COMPLETE_SOURCE), &mut t2_ctx, None)
            .expect("T2 handler");
        assert_eq!(t2_result, json!({ "sequence": 1 }));
        let t2_identity = ClientMutationIdentity::new("cm-sequence-t2", "send", &t2_input);
        let t2_payload = take_sequence_payload(t2_ctx, t2_result.clone());
        let t2_commit = db
            .mutation_writes()
            .commit_buffered_writes_idempotent_guarded(
                &t2_input,
                t2_payload,
                Some(&t2_identity),
                || Ok(()),
                || Ok(()),
            )
            .expect("T2 commits first");
        assert_eq!(t2_commit.output.result, t2_result);
        let committed_version = t2_commit.output.version;

        let t1_identity = ClientMutationIdentity::new("cm-sequence-t1", "send", &t1_input);
        let t1_error = db
            .mutation_writes()
            .commit_buffered_writes_idempotent_guarded(
                &t1_input,
                t1_payload,
                Some(&t1_identity),
                || Ok(()),
                || Ok(()),
            )
            .expect_err("T1's stale counter read aborts the whole attempt");
        assert_eq!(t1_error.diagnostic.code, "SNAPBACK_MUTATION_CONFLICT");
        assert_eq!(
            db.versions_read().current_version().unwrap(),
            committed_version
        );
        assert!(
            db.settlement_read()
                .client_mutation_result(&t1_identity)
                .unwrap()
                .is_none()
        );
        let activities = db
            .query_reads_read()
            .scan_table("sequence_activity", 10, 0)
            .expect("activity rows");
        assert_eq!(activities.total, 1);
        assert_eq!(activities.rows[0]["title"], "t2-committed-activity");
        let incarnation = DbRead::Live(&db)
            .active_relation_incarnation("scopes", "event-a")
            .unwrap()
            .expect("active scope incarnation");
        assert_eq!(
            DbRead::Live(&db)
                .sequence_next_value("eventNumber", "scopes", "event-a", &incarnation)
                .unwrap(),
            2,
            "the aborted attempt did not burn a second value"
        );

        // Run B: the handler's own throw is the abort cause. Its typed error
        // details carry the authored message, but no buffered effect is handed
        // to the durable commit seam.
        let mut throw_db = ready_db();
        seed_scope(&mut throw_db);
        let throw_input = sequence_input("throw-aborted-activity");
        let throw_identity = ClientMutationIdentity::new("cm-sequence-throw", "send", &throw_input);
        let mut throw_ctx = anonymous_sequence_context(&throw_db, throw_input);
        // The disclosure-channel assertions below inspect the thrown message,
        // which only development-exposure rendering carries; pin it so the
        // test does not depend on the ambient SNAPBACK_HANDLER_ERROR_EXPOSURE.
        let throw_error = run_ibex_handler_with_context_until_with_exposure(
            &module(THROW_SOURCE),
            &mut throw_ctx,
            None,
            None,
            HandlerErrorExposure::Development,
        )
        .expect_err("the handler throw rejects before commit");
        assert_eq!(throw_error.diagnostic.code, "SNAPBACK_HANDLER_FAILED");
        assert_eq!(throw_error.diagnostic.details["message"], "tentative:1");
        assert_eq!(
            throw_db
                .query_reads_read()
                .scan_table("sequence_activity", 10, 0)
                .unwrap()
                .total,
            0
        );
        assert!(
            throw_db
                .settlement_read()
                .client_mutation_result(&throw_identity)
                .unwrap()
                .is_none(),
            "a throwing handler retains no settlement result bytes"
        );
        let throw_incarnation = DbRead::Live(&throw_db)
            .active_relation_incarnation("scopes", "event-a")
            .unwrap()
            .expect("throw scope incarnation");
        assert_eq!(
            DbRead::Live(&throw_db)
                .sequence_next_value("eventNumber", "scopes", "event-a", &throw_incarnation,)
                .unwrap(),
            1,
            "throwing before commit leaves the counter uncreated"
        );
    }

    // @ref LLP 0135#51-sequence-allocation — Campfire's public-scope handler
    // arm must remain anonymous-callable, range-read-free, dense under
    // concurrent senders, and atomic with the inserted message.
    #[test]
    fn public_handler_sequence_is_dense_atomic_and_range_free_under_concurrent_senders() {
        const SENDERS: usize = 8;
        const SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async send(ctx, args) {
    const sequence = await ctx.sequence.allocate('eventNumber', args.scopeId);
    const activityId = await ctx.db.insert('sequence_activity', { title: args.title });
    return { activityId, sequence };
  }
};
"#;
        let dir = tempfile::tempdir().expect("handler sequence tempdir");
        let path = dir.path().join("handler-sequence.sqlite3");
        {
            let mut setup = ready_file_db(&path);
            setup
                .install_sequence_declarations(
                    BTreeMap::from([("eventNumber".to_owned(), public_sequence_declaration())]),
                    false,
                )
                .expect("enroll public sequence scope");
            setup
                .schema_seed()
                .seed(SeedData {
                    tables: BTreeMap::from([(
                        "scopes".to_owned(),
                        vec![Map::from_iter([
                            ("_id".to_owned(), json!("event-a")),
                            ("title".to_owned(), json!("A")),
                        ])],
                    )]),
                })
                .expect("seed public scope");
        }
        let writers = (0..SENDERS)
            .map(|_| ready_file_db(&path))
            .collect::<Vec<_>>();
        let barrier = Arc::new(Barrier::new(SENDERS + 1));
        let handles = writers
            .into_iter()
            .enumerate()
            .map(|(index, mut db)| {
                let barrier = Arc::clone(&barrier);
                std::thread::spawn(move || {
                    let input = sequence_input(&format!("anonymous-message-{index}"));
                    let identity = ClientMutationIdentity::new(
                        format!("cm-anonymous-send-{index}"),
                        "send",
                        &input,
                    );
                    let module = IbexModule {
                        source: SOURCE.to_owned(),
                        export: "send".to_owned(),
                    };
                    barrier.wait();
                    for attempt in 1..=32 {
                        let mut ctx = anonymous_sequence_context(&db, input.clone());
                        let (result, trace) = with_host_call_trace(|| {
                            run_ibex_handler_with_context(&module, &mut ctx, None)
                        });
                        let result = result.expect("anonymous public-scope handler runs");
                        assert!(
                            trace.iter().all(|entry| entry.op != "db.query"),
                            "sequence derivation performs no application range read"
                        );
                        let payload = take_sequence_payload(ctx, result.clone());
                        match db.mutation_writes().commit_buffered_writes_idempotent_guarded(
                            &input,
                            payload,
                            Some(&identity),
                            || Ok(()),
                            || Ok(()),
                        ) {
                            Ok(commit) => {
                                let value = commit.sequence_allocations[0].value;
                                assert_eq!(commit.output.result["sequence"], value);
                                assert_eq!(commit.changes.len(), 1);
                                assert_eq!(commit.changes[0].table, "sequence_activity");
                                assert_eq!(
                                    commit.changes[0].row.as_ref().unwrap()["_version"],
                                    commit.output.version,
                                    "message and counter receipt share the commit version"
                                );
                                return (commit.output.version, value, attempt);
                            }
                            Err(error) if error.diagnostic.code == "SNAPBACK_MUTATION_CONFLICT" => {
                                continue;
                            }
                            Err(error) => panic!(
                                "anonymous sender failed outside the admitted retry shape: {error:?}"
                            ),
                        }
                    }
                    panic!("anonymous sender exceeded the contention retry budget")
                })
            })
            .collect::<Vec<_>>();
        barrier.wait();
        let mut committed = handles
            .into_iter()
            .map(|handle| handle.join().expect("anonymous sender joins"))
            .collect::<Vec<_>>();
        committed.sort_by_key(|(version, _, _)| *version);
        assert_eq!(
            committed
                .iter()
                .map(|(_, value, _)| *value)
                .collect::<Vec<_>>(),
            (1..=SENDERS as u64).collect::<Vec<_>>()
        );
        let verify = ready_file_db(&path);
        assert_eq!(
            verify
                .query_reads_read()
                .scan_table("sequence_activity", SENDERS, 0)
                .unwrap()
                .total,
            SENDERS
        );
        println!(
            "{}",
            json!({
                "schemaVersion": "snapback.sequence-allocation-public-handler-observation.v1",
                "targetProfileId": "local-dev-sqlite-ibex",
                "anonymousSenders": SENDERS,
                "commitOrderValues": committed.iter().map(|(_, value, _)| *value).collect::<Vec<_>>(),
                "attempts": committed.iter().map(|(_, _, attempts)| *attempts).collect::<Vec<_>>(),
                "rangeReads": 0,
            })
        );
    }

    #[test]
    fn generated_membership_command_commits_with_provenance_and_raw_writes_stay_denied() {
        let mut db = ready_db();
        let mut ctx = context(&db);
        ctx.handle_host_call(
            "membership.write",
            json!({
                "declaration": "app_members",
                "operation": "insert",
                "values": { "userId": "alice", "role": "member" }
            }),
        )
        .expect("generated helper command");
        let commands = std::mem::take(&mut ctx.membership_commands);
        drop(ctx);
        let plans = db
            .membership_plans()
            .authorize_membership_commands(commands)
            .expect("authorized plans");
        db.mutation_writes()
            .commit_buffered_writes_idempotent_guarded(
                &input(),
                BufferedCommitPayload {
                    job_enqueues: Vec::new(),
                    job_producer: None,
                    writes: Vec::new(),
                    sequence_allocations: Vec::new(),
                    asset_admissions: Vec::new(),
                    asset_grant_ops: Vec::new(),
                    media_projection_proof: None,
                    expected_media_projection_binding: None,
                    membership_plans: plans,
                    read_dependencies: Vec::new(),
                    result: json!(null),
                    ctx_ledger: crate::manifest::CtxAnswerLedger {
                        version: crate::manifest::CTX_ANSWER_LEDGER_VERSION,
                        ids: Vec::new(),
                        now: 1,
                        auth_fingerprint: None,
                    },
                },
                None,
                || Ok(()),
                || Ok(()),
            )
            .expect("sanctioned bridge commit");
        let rows = db
            .query_reads_read()
            .scan_table("app_members", 10, 0)
            .expect("membership rows");
        assert_eq!(rows.total, 1);
        let id = rows.rows[0]["_id"].as_str().expect("member id");
        let provenance = db
            .membership_creation_provenance("app_members", id)
            .expect("provenance")
            .expect("full provenance");
        assert_eq!(provenance.actor, "alice");
        assert_eq!(provenance.effective, "alice");

        let mut raw_db = ready_db();
        let error = raw_db
            .mutation_writes()
            .commit_buffered_writes(
                &input(),
                vec![crate::storage::BufferedWrite::Insert {
                    table: "app_members".to_owned(),
                    id: "forged".to_owned(),
                    values: serde_json::from_value(json!({
                        "userId": "alice",
                        "role": "member"
                    }))
                    .expect("raw values"),
                }],
                Vec::new(),
                json!(null),
            )
            .expect_err("raw membership write remains refused");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_RAW_WRITE_DENIED"
        );
    }

    #[test]
    fn authored_context_cannot_reach_generated_authority_marshalling_by_name() {
        let db = authority_profile_ready_db();
        let mut ctx = context(&db);
        ctx.function_name = "event_members.transferOwner".to_owned();
        for (operation, fields) in [
            (
                "setRole",
                json!({ "memberId": "private-row", "role": "admin" }),
            ),
            ("remove", json!({ "memberId": "private-row" })),
            (
                "changeRolePrincipal",
                json!({ "resource": "event-a", "principal": "bob", "role": "admin" }),
            ),
            (
                "removeAuthorityPrincipal",
                json!({ "resource": "event-a", "principal": "bob" }),
            ),
            (
                "transferOwner",
                json!({ "resource": "event-a", "principal": "bob" }),
            ),
        ] {
            let mut args = fields.as_object().expect("operation args").clone();
            args.insert("declaration".to_owned(), json!("event_members"));
            args.insert("operation".to_owned(), json!(operation));
            let error = ctx
                .handle_host_call("membership.write", Value::Object(args))
                .expect_err("authored context cannot reach generated marshalling");
            assert_eq!(
                error.diagnostic.code, "SNAPBACK_MEMBERSHIP_OPERATION_INVALID",
                "{operation}",
            );
        }
        assert!(ctx.membership_commands.is_empty());
    }

    #[test]
    fn transfer_owner_host_vocabulary_requires_generated_profile_identity() {
        let db = ready_db();
        let mut ctx = context(&db);
        let error = ctx
            .handle_host_call(
                "membership.write",
                json!({
                    "declaration": "event_members",
                    "operation": "transferOwner",
                    "resource": "event-a",
                    "principal": "bob"
                }),
            )
            .expect_err("plain authored context has no generated profile identity");
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTHORITY_PROFILE_REQUIRED");
        assert!(ctx.membership_commands.is_empty());
    }

    #[test]
    fn membership_bridge_dry_run_rolls_back_and_refuses_snapshot_composition() {
        let mut db = ready_db();
        let mut ctx = context(&db);
        let args = json!({
            "declaration": "app_members",
            "operation": "insert",
            "values": { "userId": "alice", "role": "member" }
        });
        ctx.handle_host_call("membership.write", args.clone())
            .expect("first command");
        let error = ctx
            .handle_host_call("membership.write", args)
            .expect_err("two snapshot-authorized commands must not compose");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_BATCH_UNSUPPORTED"
        );
        let commands = std::mem::take(&mut ctx.membership_commands);
        drop(ctx);
        let plans = db
            .membership_plans()
            .authorize_membership_commands(commands)
            .expect("authorized plans");
        db.mutation_writes()
            .dry_run_buffered_writes(
                &input(),
                Vec::new(),
                Vec::new(),
                plans,
                Vec::new(),
                json!(null),
                crate::manifest::CtxAnswerLedger {
                    version: crate::manifest::CTX_ANSWER_LEDGER_VERSION,
                    ids: Vec::new(),
                    now: 1,
                    auth_fingerprint: None,
                },
                Vec::new(),
            )
            .expect("membership dry run");
        assert_eq!(
            db.query_reads_read()
                .scan_table("app_members", 10, 0)
                .expect("post-dry-run scan")
                .total,
            0
        );
    }

    #[test]
    fn service_principal_permission_effects_require_exact_consent_and_full_provenance() {
        let db = ready_db();
        let membership = json!({
            "declaration": "app_members",
            "operation": "insert",
            "values": { "userId": "alice", "role": "member" }
        });

        let mut unmarked_wrapper = service_context(&db, false);
        let error = unmarked_wrapper
            .handle_host_call("membership.write", membership.clone())
            .expect_err("an unmarked wrapper cannot reach a membership effect");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_AUTHORITY_CREATING_UNCONSENTED"
        );
        assert_eq!(
            error.diagnostic.details["reason"],
            "effect_site_unconsented"
        );

        let mut explicitly_consented = service_context(&db, true);
        explicitly_consented
            .handle_host_call("membership.write", membership)
            .expect("an exact authority-creating scope reaches the full-provenance lane");
        assert_eq!(explicitly_consented.membership_commands.len(), 1);

        for (operation, args) in [
            (
                "db.insert",
                json!({ "table": "custom_acl", "values": { "ownerId": "alice" } }),
            ),
            (
                "db.patch",
                json!({ "table": "custom_acl", "id": "acl-a", "values": { "ownerId": "alice" } }),
            ),
            ("db.delete", json!({ "table": "custom_acl", "id": "acl-a" })),
        ] {
            let mut unsupported_permission_backing = service_context(&db, true);
            let error = unsupported_permission_backing
                .handle_host_call(operation, args)
                .expect_err("non-membership permission backing has no v1 provenance lane");
            assert_eq!(
                error.diagnostic.code,
                "SNAPBACK_AUTH_AUTHORITY_CREATING_UNCONSENTED"
            );
            assert_eq!(
                error.diagnostic.details["reason"],
                "permission_backing_provenance_unavailable"
            );
        }

        let mut creation_only_schema = schema();
        creation_only_schema.tables[0]
            .membership
            .as_mut()
            .expect("membership declaration")
            .provenance = Some(MembershipProvenance::Creation);
        let mut creation_only_db = LocalDatabase::memory().expect("memory database");
        creation_only_db
            .activate_current_auth_catalog()
            .expect("auth catalog");
        creation_only_db
            .schema_seed()
            .apply_schema(creation_only_schema)
            .expect("creation-only membership schema");
        let mut creation_only = service_context(&creation_only_db, true);
        let error = creation_only
            .handle_host_call(
                "membership.write",
                json!({
                    "declaration": "app_members",
                    "operation": "insert",
                    "values": { "userId": "alice", "role": "member" }
                }),
            )
            .expect_err("authority creation requires full provenance");
        assert_eq!(
            error.diagnostic.details["reason"],
            "permission_backing_provenance_unavailable"
        );
    }

    #[test]
    fn allows_role_is_captured_non_terminal_and_observes_removal() {
        let mut db = ready_db();
        let args = json!({
            "declaration": "app_members",
            "resource": null,
            "roles": ["member"],
        });

        let mut absent = context(&db);
        let absent_baseline_reads = absent.reads.len();
        assert_eq!(
            absent
                .handle_host_call("permissions.allowsRole", args.clone())
                .expect("an absent role is an ordinary negative read"),
            Value::Bool(false),
        );
        assert_eq!(
            absent.reads.len(),
            absent_baseline_reads + 1,
            "the negative lookup is captured"
        );
        assert!(absent.take_terminal_denial().is_none());
        drop(absent);

        commit_app_membership_command(
            &mut db,
            json!({
                "declaration": "app_members",
                "operation": "insert",
                "values": { "userId": "alice", "role": "member" }
            }),
        );
        let mut present = context(&db);
        let present_baseline_reads = present.reads.len();
        assert_eq!(
            present
                .handle_host_call("permissions.allowsRole", args.clone())
                .expect("the active seat satisfies the generated read admission"),
            Value::Bool(true),
        );
        assert_eq!(present.reads.len(), present_baseline_reads + 1);
        assert!(present.take_terminal_denial().is_none());
        drop(present);

        commit_app_membership_command(
            &mut db,
            json!({
                "declaration": "app_members",
                "operation": "removeSelf",
                "resource": null,
            }),
        );
        let mut removed = context(&db);
        let removed_baseline_reads = removed.reads.len();
        assert_eq!(
            removed
                .handle_host_call("permissions.allowsRole", args.clone())
                .expect("removal blanks the generated read admission"),
            Value::Bool(false),
        );
        assert_eq!(
            removed.reads.len(),
            removed_baseline_reads + 1,
            "post-removal absence stays captured"
        );
        assert!(removed.take_terminal_denial().is_none());

        let mut terminal = context(&db);
        let denial = terminal
            .handle_host_call("permissions.requireRole", args)
            .expect_err("the write twin remains terminal after removal");
        assert_eq!(denial.diagnostic.code, "SNAPBACK_AUTH_PERMISSION_DENIED");
        assert!(terminal.take_terminal_denial().is_some());
    }

    #[test]
    fn custom_authorization_deny_reuses_the_terminal_permission_refusal() {
        let db = ready_db();
        let mut ctx = context(&db);
        let error = ctx
            .handle_host_call("permissions.deny", json!({}))
            .expect_err("a false custom evaluator must stop before its handler");
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_PERMISSION_DENIED");
        assert_eq!(
            ctx.take_terminal_denial()
                .expect("terminal refusal remains branded")
                .diagnostic
                .code,
            "SNAPBACK_AUTH_PERMISSION_DENIED"
        );
    }

    #[test]
    fn effective_authority_inspection_projects_only_gated_profile_facts() {
        use crate::membership_rules::{
            AuthorityEffectiveInspectionRequestV1, AuthorityInspectionDecisionV1,
            AuthorityInspectionSearchIndexV1, AuthorityInspectionTargetV1,
            AuthorityInspectionViewV1,
        };

        let mut db = authority_profile_ready_db();
        db.schema_seed()
            .seed(SeedData {
                tables: BTreeMap::from([
                    (
                        "events".to_owned(),
                        vec![Map::from_iter([
                            ("_id".to_owned(), json!("event-a")),
                            ("title".to_owned(), json!("A")),
                        ])],
                    ),
                    (
                        "event_members".to_owned(),
                        vec![
                            Map::from_iter([
                                ("_id".to_owned(), json!("member-alice")),
                                ("eventId".to_owned(), json!("event-a")),
                                ("userId".to_owned(), json!("alice")),
                                ("role".to_owned(), json!("owner")),
                            ]),
                            Map::from_iter([
                                ("_id".to_owned(), json!("member-bob")),
                                ("eventId".to_owned(), json!("event-a")),
                                ("userId".to_owned(), json!("bob")),
                                ("role".to_owned(), json!("member")),
                            ]),
                        ],
                    ),
                ]),
            })
            .expect("seed one resource with its bootstrap owner");

        let admitted = crate::membership_rules::authority_effective_inspection(
            &db,
            AuthorityEffectiveInspectionRequestV1 {
                profile_id: "event_members".to_owned(),
                profile_generation: "sha256:authority-profile-runtime-gate".to_owned(),
                principal_id: "alice".to_owned(),
                scope_id: Some("event-a".to_owned()),
                target: AuthorityInspectionTargetV1::View {
                    name: AuthorityInspectionViewV1::MembershipVisibleSearch,
                    index: Some(AuthorityInspectionSearchIndexV1 {
                        table: "event_members".to_owned(),
                        name: "search_admin_members".to_owned(),
                    }),
                },
            },
        )
        .expect("authenticated inspector resolves the active member");
        assert_eq!(
            admitted.policy_branch.decision,
            AuthorityInspectionDecisionV1::Admit
        );
        assert_eq!(admitted.subject.role.as_deref(), Some("owner"));
        assert_eq!(admitted.backing.membership_rows.len(), 1);
        assert_eq!(
            admitted.backing.membership_index_plan.name,
            "_membership_pk"
        );
        assert_eq!(
            admitted.backing.transition_index_plan.name,
            "_snapback_membership_transitions_by_declaration"
        );
        assert_eq!(
            admitted.static_authorization_review.policy_identity,
            "snapback.authorization-review.v2"
        );
        assert_eq!(
            admitted.sources.code,
            "src/membership_rules.rs#authority_effective_inspection"
        );

        let member_denied = crate::membership_rules::authority_effective_inspection(
            &db,
            AuthorityEffectiveInspectionRequestV1 {
                profile_id: "event_members".to_owned(),
                profile_generation: "sha256:authority-profile-runtime-gate".to_owned(),
                principal_id: "bob".to_owned(),
                scope_id: Some("event-a".to_owned()),
                target: AuthorityInspectionTargetV1::View {
                    name: AuthorityInspectionViewV1::MembershipVisibleSearch,
                    index: Some(AuthorityInspectionSearchIndexV1 {
                        table: "event_members".to_owned(),
                        name: "search_admin_members".to_owned(),
                    }),
                },
            },
        )
        .expect("the inspector answers against the named admin-only index");
        assert_eq!(
            member_denied.policy_branch.decision,
            AuthorityInspectionDecisionV1::Deny
        );
        assert_eq!(member_denied.subject.role.as_deref(), Some("member"));
        assert_eq!(
            member_denied.policy_branch.identity,
            "event_members.view.membership-visible-search.event_members.search_admin_members.v1"
        );

        let denied = crate::membership_rules::authority_effective_inspection(
            &db,
            AuthorityEffectiveInspectionRequestV1 {
                profile_id: "event_members".to_owned(),
                profile_generation: "sha256:authority-profile-runtime-gate".to_owned(),
                principal_id: "outsider".to_owned(),
                scope_id: Some("event-a".to_owned()),
                target: AuthorityInspectionTargetV1::View {
                    name: AuthorityInspectionViewV1::Roster,
                    index: None,
                },
            },
        )
        .expect("authenticated inspection represents a closed-default denial");
        assert_eq!(
            denied.policy_branch.decision,
            AuthorityInspectionDecisionV1::Deny
        );
        assert_eq!(
            denied.policy_branch.refusal_code.as_deref(),
            Some("SNAPBACK_AUTH_PERMISSION_DENIED")
        );
        assert!(denied.backing.membership_rows.is_empty());
    }

    #[test]
    fn require_role_rejects_empty_malformed_and_unknown_role_arguments() {
        let db = ready_db();
        for (roles, expected) in [
            (json!([]), "SNAPBACK_HANDLER_HOST_CALL_INVALID"),
            (json!([null]), "SNAPBACK_HANDLER_HOST_CALL_INVALID"),
            (json!([""]), "SNAPBACK_HANDLER_HOST_CALL_INVALID"),
            (json!(["admin"]), "SNAPBACK_MEMBERSHIP_UNKNOWN_ROLE"),
        ] {
            let mut ctx = context(&db);
            let error = ctx
                .handle_host_call(
                    "permissions.requireRole",
                    json!({
                        "declaration": "app_members",
                        "resource": null,
                        "roles": roles,
                    }),
                )
                .expect_err("malformed or unknown role arguments must fail closed");
            assert_eq!(error.diagnostic.code, expected);
        }

        const SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async malformed(ctx) {
    return await ctx.permissions.app_members.requireRole(null, undefined);
  }
};
"#;
        let mut ctx = context(&db);
        let error = run_ibex_handler_with_context(
            &IbexModule {
                source: SOURCE.to_owned(),
                export: "malformed".to_owned(),
            },
            &mut ctx,
            None,
        )
        .expect_err("undefined must not degrade requireRole into memberOf");
        assert_eq!(error.diagnostic.code, "SNAPBACK_HANDLER_HOST_CALL_INVALID");
    }

    #[test]
    fn generated_bootstrap_atomically_creates_resource_and_protected_holder() {
        const SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async bootstrap(ctx) {
    return await ctx.membership.event_members.bootstrap(
      { title: 'Launch' },
      [
        { userId: 'bob', role: 'guest' },
        { userId: 'carol', role: 'guest' },
      ],
    );
  }
};
"#;
        let malformed_db = ready_db();
        let mut malformed = context(&malformed_db);
        let malformed_error = malformed
            .handle_host_call(
                "membership.write",
                json!({
                    "declaration": "event_members",
                    "operation": "bootstrap",
                    "values": { "title": "Malformed launch" },
                    "initialMembers": null
                }),
            )
            .expect_err("an explicit null initial roster is not optional-list omission");
        assert_eq!(
            malformed_error.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_BOOTSTRAP_INITIAL_MEMBERS_INVALID"
        );
        assert!(malformed.membership_commands.is_empty());

        let mut db = ready_db();
        let mut ctx = context(&db);
        let result = run_ibex_handler_with_context(
            &IbexModule {
                source: SOURCE.to_owned(),
                export: "bootstrap".to_owned(),
            },
            &mut ctx,
            None,
        )
        .expect("generated bootstrap helper");
        let event_id = result
            .as_str()
            .expect("bootstrap returns the fresh resource id")
            .to_owned();
        let ctx_ledger = ctx.take_ctx_ledger().expect("bootstrap id ledger");
        assert_eq!(ctx_ledger.ids, vec![event_id.clone()]);
        let commands = std::mem::take(&mut ctx.membership_commands);
        drop(ctx);
        let plans = db
            .membership_plans()
            .authorize_membership_commands(commands)
            .expect("bootstrap authorization");
        db.mutation_writes()
            .commit_buffered_writes_idempotent_guarded(
                &input(),
                BufferedCommitPayload {
                    job_enqueues: Vec::new(),
                    job_producer: None,
                    writes: Vec::new(),
                    sequence_allocations: Vec::new(),
                    asset_admissions: Vec::new(),
                    asset_grant_ops: Vec::new(),
                    media_projection_proof: None,
                    expected_media_projection_binding: None,
                    membership_plans: plans,
                    read_dependencies: Vec::new(),
                    result: result.clone(),
                    ctx_ledger,
                },
                None,
                || Ok(()),
                || Ok(()),
            )
            .expect("atomic resource and bootstrap-holder commit");

        let event = db
            .query_reads_read()
            .get("events", &event_id)
            .expect("event read")
            .expect("created event");
        assert_eq!(event["title"], "Launch");
        let members = db
            .query_reads_read()
            .scan_table("event_members", 10, 0)
            .expect("membership scan");
        assert_eq!(members.total, 3);
        assert!(members.rows.iter().all(|row| row["eventId"] == event_id));
        assert_eq!(
            members
                .rows
                .iter()
                .map(|row| (
                    row["userId"].as_str().unwrap(),
                    row["role"].as_str().unwrap()
                ))
                .collect::<BTreeMap<_, _>>(),
            BTreeMap::from([("alice", "host"), ("bob", "guest"), ("carol", "guest")]),
        );

        let mut denied_db = ready_db();
        let mut denied = context(&denied_db);
        denied
            .handle_host_call(
                "membership.write",
                json!({
                    "declaration": "event_members",
                    "operation": "bootstrap",
                    "values": { "title": "Unsafe launch" },
                    "initialMembers": [{ "userId": "bob", "role": "host" }]
                }),
            )
            .expect("bootstrap command buffers before planner authorization");
        let commands = std::mem::take(&mut denied.membership_commands);
        drop(denied);
        let error = denied_db
            .membership_plans()
            .authorize_membership_commands(commands)
            .expect_err("bootstrap cannot grant a role the transition matrix does not admit");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_TRANSITION_DENIED"
        );
        assert_eq!(
            denied_db
                .query_reads_read()
                .scan_table("events", 10, 0)
                .expect("denied bootstrap resource scan")
                .total,
            0,
            "a denied initial roster leaves no resource or membership rows",
        );

        let service_db = ready_db();
        let mut service = service_context(&service_db, false);
        let result = service
            .handle_host_call(
                "membership.write",
                json!({
                    "declaration": "event_members",
                    "operation": "bootstrap",
                    "values": { "title": "Agent launch" }
                }),
            )
            .expect("bootstrap does not require authority-creating consent");
        assert!(result.is_string());
        assert_eq!(service.membership_commands.len(), 1);
    }

    #[test]
    fn aliased_and_computed_membership_calls_fail_at_the_dynamic_gate() {
        const SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async aliased(ctx) {
    const membership = ctx.membership.app_members;
    return await membership.insert({ userId: 'agent-a', role: 'member' });
  },
  async computed(ctx) {
    const declaration = ctx.membership['app_members'];
    const operation = 'insert';
    return await declaration[operation]({ userId: 'agent-a', role: 'member' });
  }
};
"#;
        let db = ready_db();
        for export in ["aliased", "computed"] {
            let mut ctx = service_context(&db, false);
            let error = run_ibex_handler_with_context(
                &IbexModule {
                    source: SOURCE.to_owned(),
                    export: export.to_owned(),
                },
                &mut ctx,
                None,
            )
            .expect_err("dynamic membership access must reach the host effect gate");
            assert_eq!(
                error.diagnostic.code, "SNAPBACK_AUTH_AUTHORITY_CREATING_UNCONSENTED",
                "{export} must fail with the host-owned effect diagnostic"
            );
            assert!(
                ctx.membership_commands.is_empty(),
                "{export} must not buffer a membership command"
            );
        }
    }
}

#[cfg(test)]
mod direct_human_projection_tests {
    use super::{IbexHostContext, run_ibex_handler_with_context};
    use crate::auth::admission::AdmissionLease;
    use crate::auth::identity_core::AuthClaimsProjection;
    use crate::auth::invocation::{HandlerAuthProjection, ResolvedAppAuthority};
    use crate::manifest::{HandlerInput, IbexModule};
    use crate::storage::{DbRead, LocalDatabase, MembershipWriter};
    use serde_json::{Value, json};

    fn run(authority: ResolvedAppAuthority) -> Value {
        let db = LocalDatabase::memory().unwrap();
        let claims = matches!(authority, ResolvedAppAuthority::Session { .. })
            .then(|| AuthClaimsProjection::server_derived(Vec::new(), Vec::new()));
        let projection = HandlerAuthProjection::from_authority(&authority, claims).unwrap();
        let mut invocation = IbexHostContext::new_with_projection(
            DbRead::Live(&db),
            HandlerInput::default(),
            projection,
            AdmissionLease::unmanaged(0, 0),
            MembershipWriter::from_resolved(&authority),
            false,
            true,
        )
        .unwrap();
        let module = IbexModule {
            source: r#"
              globalThis.__snapbackHandlers = {
                probe(ctx) {
                  return [{
                    direct: ctx.isDirectHuman(),
                    auth: ctx.auth,
                    authPrototypeIsNull: Object.getPrototypeOf(ctx.auth) === null,
                    actorPrototypeIsNull: ctx.auth.actor == null
                      ? null
                      : Object.getPrototypeOf(ctx.auth.actor) === null,
                    authFrozen: Object.isFrozen(ctx.auth),
                    actorFrozen: ctx.auth.actor == null
                      ? null
                      : Object.isFrozen(ctx.auth.actor)
                  }];
                }
              };
            "#
            .to_owned(),
            export: "probe".to_owned(),
        };
        run_ibex_handler_with_context(&module, &mut invocation, None).unwrap()
    }

    fn service(effective_user_id: Option<&str>) -> ResolvedAppAuthority {
        ResolvedAppAuthority::ServicePrincipal {
            actor_user_id: "agent-1".to_owned(),
            credential_id: "credential-1".to_owned(),
            credential_generation: 2,
            grant_id: "grant-1".to_owned(),
            token_id: "token-1".to_owned(),
            effective_user_id: effective_user_id.map(str::to_owned),
            scopes: Vec::new(),
            token_expires_at_ms: 20_000,
            integration_status: None,
        }
    }

    #[test]
    fn handler_projection_preserves_sealed_kind_actor_and_direct_human_helper() {
        let session = run(ResolvedAppAuthority::Session {
            user_id: "user-1".to_owned(),
            session_id: "session-1".to_owned(),
            provider: "email-code".to_owned(),
            generation: 1,
            authority_instance_id: "authority-1".to_owned(),
            session_not_after_ms: 10_000,
            provider_not_after_ms: None,
            rehearsal_provenance: None,
        });
        assert_eq!(session[0]["direct"], true);
        assert_eq!(session[0]["auth"]["kind"], "human");
        assert!(session[0]["auth"].get("actor").is_none());

        let delegated = run(service(Some("user-1")));
        assert_eq!(delegated[0]["direct"], false);
        assert_eq!(delegated[0]["auth"]["kind"], "human");
        assert_eq!(
            delegated[0]["auth"]["actor"],
            json!({"userId": "agent-1", "kind": "agent", "grantId": "grant-1"})
        );
        assert_eq!(delegated[0]["actorPrototypeIsNull"], true);
        assert_eq!(delegated[0]["actorFrozen"], true);

        let autonomous = run(service(None));
        assert_eq!(autonomous[0]["direct"], false);
        assert_eq!(autonomous[0]["auth"]["kind"], "agent");
        assert!(autonomous[0]["auth"].get("actor").is_none());

        let anonymous = run(ResolvedAppAuthority::Anonymous);
        assert_eq!(anonymous[0]["direct"], false);
        assert!(anonymous[0]["auth"].get("kind").is_none());
        assert_eq!(anonymous[0]["authPrototypeIsNull"], true);
        assert_eq!(anonymous[0]["authFrozen"], true);
    }
}
