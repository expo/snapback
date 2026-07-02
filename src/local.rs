use crate::cron::{
    CronInspectState, CronRunClaim, CronRunMetadata, CronRunOutcome, CronRunRecord, CronRunTrigger,
    LocalCronRuntime,
};
use crate::diagnostic::{Diagnostic, DiagnosticSeverity, SnapbackError, SnapbackResult};
use crate::ephemeral::{
    CollectionEnsureOutcome, DeleteRequest, EphemeralCollection, EphemeralDiagnostics,
    EphemeralMessage, LocalEphemeralBackend, PublishOutcome, PublishRequest, RealtimeEnvelope,
    SubscribeRequest,
};
use crate::live_matcher::{live_subscription_may_be_affected, query_dependencies_from_plan};
use crate::manifest::{
    ActionPlan, ActionReturnValue, ActionStep, AuthInput, CapabilityManifest, FunctionDefinition,
    FunctionKind, FunctionManifest, FunctionRuntime, HandlerInput, HandlerPlan, MutationOutput,
    MutationStep, PermissionScopeExpr, QueryOutput, SNAPBACK_SCHEMA_VERSION, SchemaManifest,
    SeedData, TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX, ValueExpr,
};
use crate::runtime::{IbexActionHost, RuntimeCapabilities, RuntimeManager};
use crate::storage::{
    CapturedReadDependency, CapturedReadKind, CapturedWriteDependency, ChangedRow, LocalDatabase,
    MutationCommit, StorageInfo, TableScan,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::marker::PhantomData;
use std::path::Path;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use uuid::Uuid;

const MAX_RECENT_DIAGNOSTICS: usize = 100;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct InspectState {
    #[serde(rename = "artifactKind")]
    pub artifact_kind: String,
    #[serde(rename = "schemaVersion")]
    pub schema_version: String,
    #[serde(rename = "targetProfileId")]
    pub target_profile_id: String,
    pub target: String,
    pub storage: StorageInfo,
    pub runtime: RuntimeCapabilities,
    pub schema: SchemaManifest,
    pub functions: FunctionManifest,
    #[serde(rename = "capabilityManifest")]
    pub capability_manifest: CapabilityManifest,
    pub subscriptions: Vec<LiveSubscriptionInfo>,
    #[serde(rename = "liveDelivery")]
    pub live_delivery: LiveDeliveryStats,
    pub ephemeral: EphemeralDiagnostics,
    pub cron: CronInspectState,
    pub recent_diagnostics: Vec<Diagnostic>,
    pub capability_gaps: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct LiveSubscriptionInfo {
    pub id: String,
    pub connection_id: String,
    pub function: String,
}

/// The public projection of [`InspectState`] served at the root `/inspect` and
/// `/`. It is a typed allowlist: the `From<InspectState>` below destructures the
/// full struct, so a newly-added `InspectState` (or `StorageInfo`,
/// `LiveSubscriptionInfo`) field is a compile error here rather than a silent
/// leak. Two facts are deliberately dropped and live only in the gated
/// `/_snapback/api/inspect` twin: `subscriptions[].connection_id` (the
/// enumerate-and-disconnect vector — LLP 0031 D2/D3) and the absolute
/// `storage.sqlite_path` (an environment leak).
///
/// @ref LLP 0031#resolved-decisions — D3: public `/inspect` is trimmed to an identity descriptor; the trim is guarded by a typed projection.
#[derive(Clone, Debug, Serialize)]
pub struct PublicInspect {
    #[serde(rename = "artifactKind")]
    pub artifact_kind: String,
    #[serde(rename = "schemaVersion")]
    pub schema_version: String,
    #[serde(rename = "targetProfileId")]
    pub target_profile_id: String,
    pub target: String,
    pub storage: PublicStorageInfo,
    pub runtime: RuntimeCapabilities,
    pub schema: SchemaManifest,
    pub functions: FunctionManifest,
    #[serde(rename = "capabilityManifest")]
    pub capability_manifest: CapabilityManifest,
    pub subscriptions: Vec<PublicSubscriptionInfo>,
    #[serde(rename = "liveDelivery")]
    pub live_delivery: LiveDeliveryStats,
    pub ephemeral: EphemeralDiagnostics,
    pub cron: CronInspectState,
    pub recent_diagnostics: Vec<Diagnostic>,
    pub capability_gaps: Vec<String>,
}

/// Public storage facts: the change version and table list, never the on-disk path.
#[derive(Clone, Debug, Serialize)]
pub struct PublicStorageInfo {
    pub version: u64,
    pub tables: Vec<String>,
}

/// Public subscription facts: id and function, never the owning connection id.
#[derive(Clone, Debug, Serialize)]
pub struct PublicSubscriptionInfo {
    pub id: String,
    pub function: String,
}

impl From<InspectState> for PublicInspect {
    fn from(inspect: InspectState) -> Self {
        // Exhaustive destructures below are load-bearing: a new field on any of
        // these structs must be classified here, not leak by default.
        let InspectState {
            artifact_kind,
            schema_version,
            target_profile_id,
            target,
            storage,
            runtime,
            schema,
            functions,
            capability_manifest,
            subscriptions,
            live_delivery,
            ephemeral,
            cron,
            recent_diagnostics,
            capability_gaps,
        } = inspect;
        let StorageInfo {
            sqlite_path: _,
            version,
            tables,
        } = storage;
        PublicInspect {
            artifact_kind,
            schema_version,
            target_profile_id,
            target,
            storage: PublicStorageInfo { version, tables },
            runtime,
            schema,
            functions,
            capability_manifest,
            subscriptions: subscriptions
                .into_iter()
                .map(
                    |LiveSubscriptionInfo {
                         id,
                         connection_id: _,
                         function,
                     }| PublicSubscriptionInfo { id, function },
                )
                .collect(),
            live_delivery,
            ephemeral,
            cron,
            recent_diagnostics,
            capability_gaps,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct LiveSubscribeInput {
    pub connection_id: String,
    #[serde(default)]
    pub input: HandlerInput,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct LiveSubscribeOutput {
    pub subscription_id: String,
    pub snapshot: QueryOutput,
    #[serde(default)]
    pub permission_epochs: BTreeMap<String, u64>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
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
    pub recorded_permission_epochs: BTreeMap<String, u64>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct LiveResumeOutput {
    pub subscription_id: String,
    pub mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<QueryOutput>,
    #[serde(default)]
    pub permission_epochs: BTreeMap<String, u64>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct LiveUpdate {
    pub kind: String,
    pub subscription_id: String,
    pub function: String,
    pub version: u64,
    pub rows: Vec<Value>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct LiveResyncRequired {
    pub kind: String,
    pub reason: String,
    pub subscription_id: String,
    pub scope: String,
    pub epoch: u64,
    pub clear_retained: bool,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct LiveDeliveryStats {
    pub total_fanout_attempts: u64,
    pub total_deliveries: u64,
    pub total_skipped: u64,
    // @ref LLP 0032#phase-1--safety-floor-and-confirmed-defects — S5.D4:
    // post-commit fan-out failures are per-subscription diagnostics, counted
    // here, never a failure of the already-committed mutation.
    pub total_failed: u64,
    pub last_fanout_subscriptions: usize,
    pub last_deliveries: usize,
    pub last_skipped: usize,
    pub last_failed: usize,
}

/// The result of running a generated function from the admin function runner.
///
/// Carries the function's declared read-set and write-set beside the outcome so
/// a "declared namespace does not match what the handler touches" mismatch is
/// visible — the Valet "counts stuck at zero" failure class.
///
/// @ref LLP 0017#function-runner-and-code-runner — the first code runner is a
/// generated-function runner that surfaces read/write sets and diagnostics.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct FunctionRunResult {
    pub ok: bool,
    pub function: String,
    pub kind: Option<FunctionKind>,
    pub reads: Vec<String>,
    pub writes: Vec<String>,
    #[serde(default)]
    pub captured_reads: Vec<CapturedReadDependency>,
    #[serde(default)]
    pub captured_writes: Vec<CapturedWriteDependency>,
    pub elapsed_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub changed_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rows: Option<Vec<Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostic: Option<Diagnostic>,
}

pub struct LocalSnapback {
    db: LocalDatabase,
    functions: FunctionManifest,
    runtime: RuntimeManager,
    ephemeral: LocalEphemeralBackend,
    cron: LocalCronRuntime,
    subscriptions: BTreeMap<String, LiveSubscription>,
    permission_epochs: BTreeMap<String, u64>,
    live_delivery: LiveDeliveryStats,
    recent_diagnostics: VecDeque<Diagnostic>,
    cron_tick_errors: u64,
}

#[derive(Clone, Debug)]
struct LiveSubscription {
    id: String,
    connection_id: String,
    function: String,
    input: HandlerInput,
    read_dependencies: Vec<CapturedReadDependency>,
}

struct QueryInvocation {
    output: QueryOutput,
    read_dependencies: Vec<CapturedReadDependency>,
}

struct LocalIbexActionHost<'a> {
    snapback: *mut LocalSnapback,
    _marker: PhantomData<&'a mut LocalSnapback>,
}

impl IbexActionHost for LocalIbexActionHost<'_> {
    fn run_mutation(&mut self, name: &str, input: HandlerInput) -> SnapbackResult<MutationOutput> {
        // @ref LLP 0028#execution-the-action-class — actions commit durable
        // writes by invoking ordinary mutations, preserving the commit/fan-out path.
        // The embedded runtime calls host functions synchronously on the same
        // thread; this pointer is valid only for the duration of one action run.
        unsafe { (&mut *self.snapback).invoke_mutation(name, input) }
    }
}

impl LocalSnapback {
    pub fn memory() -> SnapbackResult<Self> {
        Self::from_database(LocalDatabase::memory()?)
    }

    pub fn open(path: impl AsRef<Path>) -> SnapbackResult<Self> {
        Self::from_database(LocalDatabase::open(path)?)
    }

    pub fn apply_schema(&mut self, manifest: SchemaManifest) -> SnapbackResult<Vec<Diagnostic>> {
        manifest.validate_artifact()?;
        let ephemeral_collections = manifest.ephemeral_collections.clone();
        let diagnostics = self.db.apply_schema(manifest)?;
        self.ephemeral.replace_collections(ephemeral_collections);
        self.record_diagnostics(diagnostics.clone());
        Ok(diagnostics)
    }

    pub fn load_functions(&mut self, manifest: FunctionManifest) -> Vec<Diagnostic> {
        if let Err(error) = manifest.validate_artifact() {
            let diagnostic = error.diagnostic;
            self.record_diagnostics(vec![diagnostic.clone()]);
            return vec![diagnostic];
        }

        self.functions = manifest;
        let mut diagnostics = Vec::new();

        if self
            .functions
            .functions
            .iter()
            .any(|function| matches!(function.runtime, FunctionRuntime::IbexModule(_)))
        {
            diagnostics.push(Diagnostic::info(
                "SNAPBACK_IBEX_FUNCTIONS_LOADED",
                "runtime",
                "Ibex handler modules loaded for embedded ctx.db execution",
            ));
        }

        diagnostics.extend(self.cron.reconcile(&self.functions));
        diagnostics.extend(self.runtime.diagnostics());
        if let Err(error) = self.persist_cron_state() {
            diagnostics.push(error.diagnostic);
        }
        self.record_diagnostics(diagnostics.clone());
        diagnostics
    }

    pub fn reset(&mut self) -> SnapbackResult<()> {
        self.db.reset()?;
        self.subscriptions.clear();
        self.permission_epochs.clear();
        self.ephemeral.reset_runtime_state();
        self.cron.reset_runtime_state(&self.functions);
        self.live_delivery = LiveDeliveryStats::default();
        self.persist_cron_state()?;
        Ok(())
    }

    pub fn seed(&mut self, seed: SeedData) -> SnapbackResult<MutationOutput> {
        let output = self.db.seed(seed)?;
        self.notify_live_subscriptions(&[]);
        Ok(output)
    }

    pub fn inspect(&mut self) -> SnapbackResult<InspectState> {
        // @ref LLP 0010#v0-implementation-charter — missing non-v0 capabilities must be reported explicitly.
        let capability_gaps = self.capability_gaps();
        let capability_manifest = CapabilityManifest::local_v0(capability_gaps.clone());
        let active_live_functions = self.active_live_functions();
        let cron = self
            .cron
            .inspect(&self.functions, &active_live_functions, now_millis());

        Ok(InspectState {
            artifact_kind: "runtimeState".to_owned(),
            schema_version: SNAPBACK_SCHEMA_VERSION.to_owned(),
            target_profile_id: TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned(),
            target: TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned(),
            storage: self.db.info()?,
            runtime: self.runtime.capabilities().clone(),
            schema: self.db.schema().clone(),
            functions: self.functions.clone(),
            capability_manifest,
            subscriptions: self
                .subscriptions
                .values()
                .map(|subscription| LiveSubscriptionInfo {
                    id: subscription.id.clone(),
                    connection_id: subscription.connection_id.clone(),
                    function: subscription.function.clone(),
                })
                .collect(),
            live_delivery: self.live_delivery.clone(),
            ephemeral: self.ephemeral.diagnostics(),
            cron,
            recent_diagnostics: self.recent_diagnostics.iter().cloned().collect(),
            capability_gaps,
        })
    }

    fn capability_gaps(&self) -> Vec<String> {
        let mut capability_gaps = vec![
            "offline_mutation_replay".to_owned(),
            "postgres".to_owned(),
            "cloudflare".to_owned(),
            "hosted_untrusted_code".to_owned(),
            "external_auth".to_owned(),
            "assets".to_owned(),
            "outbound_actions".to_owned(),
            "notifications".to_owned(),
            "ephemeral_hosted_adapter".to_owned(),
            "ephemeral_multi_instance_sticky_routing".to_owned(),
        ];
        if self.runtime.capabilities().ibex_cli.available {
            capability_gaps.retain(|gap| gap != "ibex_cli");
        } else {
            capability_gaps.push("ibex_cli".to_owned());
        }
        capability_gaps
    }

    pub fn invoke_query(&self, name: &str, input: HandlerInput) -> SnapbackResult<QueryOutput> {
        Ok(self.invoke_query_with_dependencies(name, input)?.output)
    }

    fn invoke_query_with_dependencies(
        &self,
        name: &str,
        input: HandlerInput,
    ) -> SnapbackResult<QueryInvocation> {
        let function = self.function(name)?;
        match (&function.kind, &function.runtime) {
            (
                FunctionKind::Query | FunctionKind::LiveQuery,
                FunctionRuntime::HostPlan(HandlerPlan::Query(plan)),
            ) => {
                let output = self.db.query(plan, &input)?;
                let mut read_dependencies =
                    query_dependencies_from_plan(plan, &input, &output, &self.db)?;
                self.add_permission_dependencies(&input, &mut read_dependencies);
                Ok(QueryInvocation {
                    output,
                    read_dependencies,
                })
            }
            (
                FunctionKind::Query | FunctionKind::LiveQuery,
                FunctionRuntime::IbexModule(module),
            ) => {
                let run =
                    self.runtime
                        .invoke_ibex_query_with_reads(module, input.clone(), &self.db)?;
                let mut read_dependencies = run.read_dependencies;
                self.add_permission_dependencies(&input, &mut read_dependencies);
                Ok(QueryInvocation {
                    output: run.output,
                    read_dependencies,
                })
            }
            _ => Err(SnapbackError::error(
                "SNAPBACK_FUNCTION_KIND_MISMATCH",
                "runtime",
                format!("{name} is not a query"),
            )),
        }
    }

    pub fn invoke_mutation(
        &mut self,
        name: &str,
        input: HandlerInput,
    ) -> SnapbackResult<MutationOutput> {
        Ok(self.invoke_mutation_commit(name, input)?.output)
    }

    fn invoke_mutation_commit(
        &mut self,
        name: &str,
        input: HandlerInput,
    ) -> SnapbackResult<MutationCommit> {
        let function = self.function(name)?.clone();
        let commit = match (&function.kind, &function.runtime) {
            (FunctionKind::Mutation, FunctionRuntime::HostPlan(HandlerPlan::Mutation(plan))) => {
                self.db.execute_mutation(plan, &input)?
            }
            (FunctionKind::Mutation, FunctionRuntime::IbexModule(module)) => self
                .runtime
                .invoke_ibex_mutation(module, input.clone(), &mut self.db)?,
            _ => {
                return Err(SnapbackError::error(
                    "SNAPBACK_FUNCTION_KIND_MISMATCH",
                    "runtime",
                    format!("{name} is not a mutation"),
                ));
            }
        };

        let permission_changes = if commit.output.changed_count > 0 {
            self.advance_permission_epochs(&function, &input)?
        } else {
            Vec::new()
        };
        self.notify_permission_resyncs(&permission_changes);
        self.notify_live_subscriptions(&commit.changes);
        Ok(commit)
    }

    pub fn subscribe_live(
        &mut self,
        name: &str,
        input: LiveSubscribeInput,
    ) -> SnapbackResult<LiveSubscribeOutput> {
        let function = self.function(name)?;
        if function.kind != FunctionKind::LiveQuery {
            return Err(SnapbackError::error(
                "SNAPBACK_FUNCTION_NOT_LIVE",
                "runtime",
                format!("{name} is not a live query"),
            ));
        }

        let subscription_input = input.input;
        let query = self.invoke_query_with_dependencies(name, subscription_input.clone())?;
        let permission_epochs = permission_epochs_from_dependencies(&query.read_dependencies);
        // @ref LLP 0032#phase-1--safety-floor-and-confirmed-defects — S2:
        // subscription ids are unguessable bearer capabilities, not enumerable
        // counters; they share the runtime's UUIDv7 id source.
        let subscription_id = format!("sub_{}", Uuid::now_v7().simple());
        self.subscriptions.insert(
            subscription_id.clone(),
            LiveSubscription {
                id: subscription_id.clone(),
                connection_id: input.connection_id,
                function: name.to_owned(),
                input: subscription_input,
                read_dependencies: query.read_dependencies,
            },
        );

        Ok(LiveSubscribeOutput {
            subscription_id,
            snapshot: query.output,
            permission_epochs,
        })
    }

    /// @ref LLP 0020#remaining-phase-4-design-dependency-vocabulary-and-auth-epochs — retained resume compares client-recorded permission epochs before trusting retained rows.
    pub fn resume_live(
        &mut self,
        name: &str,
        input: LiveResumeInput,
    ) -> SnapbackResult<LiveResumeOutput> {
        let subscription = self
            .subscriptions
            .get(&input.subscription_id)
            .cloned()
            .ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_UNKNOWN_SUBSCRIPTION",
                    "realtime",
                    format!("unknown live subscription {}", input.subscription_id),
                )
            })?;
        if subscription.function != name {
            return Err(SnapbackError::error(
                "SNAPBACK_LIVE_RESUME_FUNCTION_MISMATCH",
                "realtime",
                format!(
                    "subscription {} belongs to {}, not {name}",
                    subscription.id, subscription.function
                ),
            ));
        }

        // @ref LLP 0032#phase-1--safety-floor-and-confirmed-defects — S2:
        // resume re-points a subscription's stream, so once a principal owns
        // the subscription the caller must present that principal; the
        // unguessable id alone is not ownership.
        let owner = &subscription.input.auth;
        if (owner.principal.is_some() || owner.user_id.is_some())
            && (owner.principal != input.auth.principal || owner.user_id != input.auth.user_id)
        {
            return Err(SnapbackError::error(
                "SNAPBACK_LIVE_RESUME_OWNERSHIP",
                "realtime",
                format!(
                    "subscription {} is owned by a different principal",
                    subscription.id
                ),
            ));
        }

        if self.resume_requires_resnapshot(&subscription, &input.recorded_permission_epochs) {
            let query = self.invoke_query_with_dependencies(
                &subscription.function,
                subscription.input.clone(),
            )?;
            let permission_epochs = permission_epochs_from_dependencies(&query.read_dependencies);
            if let Some(stored) = self.subscriptions.get_mut(&subscription.id) {
                stored.connection_id = input.connection_id;
                stored.read_dependencies = query.read_dependencies;
            }
            return Ok(LiveResumeOutput {
                subscription_id: subscription.id,
                mode: "resnapshot".to_owned(),
                reason: Some("permission_epoch_changed".to_owned()),
                snapshot: Some(query.output),
                permission_epochs,
            });
        }

        let permission_epochs =
            current_permission_epochs_for_dependencies(&subscription.read_dependencies, |scope| {
                self.permission_epoch(scope)
            });
        if let Some(stored) = self.subscriptions.get_mut(&subscription.id) {
            stored.connection_id = input.connection_id;
        }
        Ok(LiveResumeOutput {
            subscription_id: subscription.id,
            mode: "retained".to_owned(),
            reason: None,
            snapshot: None,
            permission_epochs,
        })
    }

    /// Read a page of a table through the schema-aware storage layer for the
    /// admin data explorer.
    ///
    /// @ref LLP 0017#durable-data-exploration-and-edits — read-only exploration
    /// is the paved path; raw engine access is a separate opt-out.
    pub fn scan_table(
        &self,
        table: &str,
        limit: usize,
        offset: usize,
    ) -> SnapbackResult<TableScan> {
        self.db.scan_table(table, limit, offset)
    }

    /// Run a generated query or mutation through the *same* invocation path as
    /// generated clients, returning a unified envelope with the declared
    /// read/write sets, timing, and any diagnostic instead of an HTTP error — so
    /// the runner can show conflicts and failures inline.
    ///
    /// @ref LLP 0017#function-runner-and-code-runner — generated-function runner
    /// over the normal invocation path; not an arbitrary-JavaScript eval.
    pub fn run_function(&mut self, name: &str, input: HandlerInput) -> FunctionRunResult {
        let started = Instant::now();
        let Some(definition) = self.functions.function(name).cloned() else {
            return FunctionRunResult {
                ok: false,
                function: name.to_owned(),
                kind: None,
                reads: Vec::new(),
                writes: Vec::new(),
                captured_reads: Vec::new(),
                captured_writes: Vec::new(),
                elapsed_ms: elapsed_ms(started),
                version: None,
                changed_count: None,
                rows: None,
                result: None,
                diagnostic: Some(
                    SnapbackError::error(
                        "SNAPBACK_UNKNOWN_FUNCTION",
                        "runtime",
                        format!("unknown function {name}"),
                    )
                    .diagnostic,
                ),
            };
        };

        let (reads, writes) = plan_io(&definition);
        let kind = definition.kind.clone();
        let base = FunctionRunResult {
            ok: true,
            function: name.to_owned(),
            kind: Some(kind.clone()),
            reads,
            writes,
            captured_reads: Vec::new(),
            captured_writes: Vec::new(),
            elapsed_ms: 0,
            version: None,
            changed_count: None,
            rows: None,
            result: None,
            diagnostic: None,
        };

        match kind {
            FunctionKind::Query | FunctionKind::LiveQuery => match self.invoke_query(name, input) {
                Ok(output) => FunctionRunResult {
                    elapsed_ms: elapsed_ms(started),
                    version: Some(output.version),
                    rows: Some(output.rows),
                    ..base
                },
                Err(error) => FunctionRunResult {
                    ok: false,
                    elapsed_ms: elapsed_ms(started),
                    diagnostic: Some(error.diagnostic),
                    ..base
                },
            },
            FunctionKind::Mutation => match self.invoke_mutation_commit(name, input) {
                Ok(commit) => FunctionRunResult {
                    elapsed_ms: elapsed_ms(started),
                    version: Some(commit.output.version),
                    changed_count: Some(commit.output.changed_count),
                    result: Some(commit.output.result),
                    captured_reads: commit.read_dependencies,
                    captured_writes: commit.write_dependencies,
                    ..base
                },
                Err(error) => FunctionRunResult {
                    ok: false,
                    elapsed_ms: elapsed_ms(started),
                    diagnostic: Some(error.diagnostic),
                    ..base
                },
            },
            FunctionKind::Action => {
                let metadata = CronRunMetadata {
                    job_name: format!("admin:{name}"),
                    run_id: format!("admin:{name}:{}", now_millis()),
                    scheduled_at_ms: None,
                    due_at_ms: now_millis(),
                    idempotency_key: format!("admin:{name}:manual"),
                    slot_key: format!("admin:{name}:manual"),
                    attempt: 1,
                    trigger: CronRunTrigger::Manual,
                };
                match self.invoke_action(name, input, metadata) {
                    Ok(result) => FunctionRunResult {
                        elapsed_ms: elapsed_ms(started),
                        result: Some(result),
                        ..base
                    },
                    Err(error) => FunctionRunResult {
                        ok: false,
                        elapsed_ms: elapsed_ms(started),
                        diagnostic: Some(error.diagnostic),
                        ..base
                    },
                }
            }
        }
    }

    /// The kind of a loaded function, if any. Used by the admin function runner
    /// to decide whether a run is a read (query) or a write (mutation).
    pub fn function_kind(&self, name: &str) -> Option<FunctionKind> {
        self.functions
            .function(name)
            .map(|function| function.kind.clone())
    }

    pub fn register_ephemeral_collection(&mut self, collection: EphemeralCollection) {
        self.ephemeral.register_collection(collection);
    }

    pub fn ensure_ephemeral_collections(
        &mut self,
        collections: Vec<EphemeralCollection>,
    ) -> Result<CollectionEnsureOutcome, crate::ephemeral::EphemeralError> {
        self.ephemeral.ensure_collections(collections)
    }

    pub fn publish_ephemeral(
        &mut self,
        request: PublishRequest,
        now_ms: u64,
    ) -> Result<PublishOutcome, crate::ephemeral::EphemeralError> {
        self.ephemeral.publish(request, now_ms)
    }

    pub fn subscribe_ephemeral(
        &mut self,
        request: SubscribeRequest,
        now_ms: u64,
    ) -> Result<EphemeralMessage, crate::ephemeral::EphemeralError> {
        self.ephemeral.subscribe(request, now_ms)
    }

    pub fn delete_ephemeral(
        &mut self,
        request: DeleteRequest,
        now_ms: u64,
    ) -> Result<Option<EphemeralMessage>, crate::ephemeral::EphemeralError> {
        self.ephemeral.delete(request, now_ms)
    }

    pub fn disconnect(&mut self, connection_id: &str, now_ms: u64) {
        self.ephemeral.disconnect(connection_id, now_ms);
        // A connection's durable live subscriptions are dead once the connection
        // goes away — there is no way to deliver further deltas. Dropping them lets
        // a demand-activated cron job deactivate when its last watcher leaves.
        // @ref LLP 0028#activation-policy — whileLive activation must report
        //   inactive:no-demand once no subscription to the named live query remains.
        self.subscriptions
            .retain(|_, subscription| subscription.connection_id != connection_id);
    }

    pub fn cleanup_ephemeral(&mut self, now_ms: u64) {
        self.ephemeral.cleanup_expired(now_ms);
    }

    /// Tick the cron scheduler, routing the tick machinery's *own* errors
    /// (claim/persist failures) into the diagnostics ring with a counter
    /// instead of dropping them. Failed cron *runs* already record diagnostics
    /// inside `execute_cron_claims`; this closes the gap where `tick_cron`'s
    /// Err was silently swallowed by the 1s ticker.
    ///
    /// @ref LLP 0032#phase-1--safety-floor-and-confirmed-defects — S5.D11.
    pub fn tick_cron_recording(&mut self, now_ms: u64) -> Vec<CronRunRecord> {
        match self.tick_cron(now_ms) {
            Ok(records) => records,
            Err(error) => {
                self.cron_tick_errors += 1;
                self.record_diagnostics(vec![error.diagnostic]);
                Vec::new()
            }
        }
    }

    /// Count of swallowed-then-recorded cron tick errors, surfaced for tests
    /// and inspection.
    pub fn cron_tick_errors(&self) -> u64 {
        self.cron_tick_errors
    }

    pub fn tick_cron(&mut self, now_ms: u64) -> SnapbackResult<Vec<CronRunRecord>> {
        let active_live_functions = self.active_live_functions();
        let claims = self
            .cron
            .claim_due_runs(&self.functions, &active_live_functions, now_ms);
        self.persist_cron_state()?;
        self.execute_cron_claims(claims)
    }

    pub fn run_cron_job_now(&mut self, name: &str, now_ms: u64) -> SnapbackResult<CronRunRecord> {
        let claim = self.cron.claim_manual_run(&self.functions, name, now_ms)?;
        self.persist_cron_state()?;
        let mut records = self.execute_cron_claims(vec![claim])?;
        records.pop().ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_CRON_RUN_RECORD_MISSING",
                "cron",
                format!("cron job {name} did not produce a run record"),
            )
        })
    }

    pub fn drain_outbox(&mut self, connection_id: &str) -> Vec<RealtimeEnvelope> {
        self.ephemeral.drain_outbox(connection_id)
    }

    pub fn drain_live_stream(&mut self, connection_id: &str) -> Vec<String> {
        self.drain_outbox(connection_id)
            .into_iter()
            .filter_map(live_stream_text)
            .collect()
    }

    fn from_database(db: LocalDatabase) -> SnapbackResult<Self> {
        let runtime = RuntimeManager::detect();
        let cron = LocalCronRuntime::from_persisted(db.load_cron_state()?);
        let mut recent_diagnostics = VecDeque::new();
        for diagnostic in runtime.diagnostics() {
            recent_diagnostics.push_back(diagnostic);
        }

        Ok(Self {
            db,
            functions: FunctionManifest::default(),
            runtime,
            ephemeral: LocalEphemeralBackend::new(),
            cron,
            subscriptions: BTreeMap::new(),
            permission_epochs: BTreeMap::new(),
            live_delivery: LiveDeliveryStats::default(),
            recent_diagnostics,
            cron_tick_errors: 0,
        })
    }

    fn function(&self, name: &str) -> SnapbackResult<&crate::manifest::FunctionDefinition> {
        self.functions.function(name).ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_UNKNOWN_FUNCTION",
                "runtime",
                format!("unknown function {name}"),
            )
        })
    }

    fn execute_cron_claims(
        &mut self,
        claims: Vec<CronRunClaim>,
    ) -> SnapbackResult<Vec<CronRunRecord>> {
        let mut records = Vec::new();
        for claim in claims {
            let started_wall_ms = now_millis();
            let result = self
                .invoke_action(
                    &claim.job.action,
                    HandlerInput {
                        args: json!({
                            "run": claim.metadata,
                            "job": claim.job.name,
                        }),
                        auth: Default::default(),
                        read_set: Vec::new(),
                    },
                    claim.metadata.clone(),
                )
                .map_err(|error| error.diagnostic);
            // @ref LLP 0032#phase-1--safety-floor-and-confirmed-defects — S5.D8
            // (semantics LLP 0029 G6): measure real wall-clock around the run so
            // durationMs is not always zero. finished_at stays logically
            // consistent with the claim's start (start + elapsed), so a run's
            // duration reflects actual execution time on any clock the caller
            // stamped the claim with.
            let elapsed_ms = now_millis().saturating_sub(started_wall_ms);
            let finished_at_ms = claim.started_at_ms.saturating_add(elapsed_ms);
            let record = self.cron.finish_run(claim, finished_at_ms, result);
            self.persist_cron_state()?;
            if record.outcome == CronRunOutcome::Failed
                && let Some(diagnostic) = &record.diagnostic
            {
                self.record_diagnostics(vec![diagnostic.clone()]);
            }
            records.push(record);
        }
        Ok(records)
    }

    fn invoke_action(
        &mut self,
        name: &str,
        input: HandlerInput,
        metadata: CronRunMetadata,
    ) -> SnapbackResult<Value> {
        let function = self.function(name)?.clone();
        match (&function.kind, &function.runtime) {
            (FunctionKind::Action, FunctionRuntime::HostPlan(HandlerPlan::Action(plan))) => {
                self.invoke_action_plan(plan, input, metadata)
            }
            (FunctionKind::Action, FunctionRuntime::IbexModule(module)) => {
                let runtime = self.runtime.clone();
                let db = &self.db as *const LocalDatabase;
                let mut host = LocalIbexActionHost {
                    snapback: self as *mut LocalSnapback,
                    _marker: PhantomData,
                };
                runtime.invoke_ibex_action(module, input, db, metadata, &mut host)
            }
            _ => Err(SnapbackError::error(
                "SNAPBACK_FUNCTION_KIND_MISMATCH",
                "runtime",
                format!("{name} is not an action"),
            )),
        }
    }

    fn invoke_action_plan(
        &mut self,
        plan: &ActionPlan,
        input: HandlerInput,
        metadata: CronRunMetadata,
    ) -> SnapbackResult<Value> {
        let mut bindings = BTreeMap::new();
        let mut last_result = Value::Null;
        let mut changed_count = 0usize;
        for step in &plan.steps {
            match step {
                ActionStep::RunMutation {
                    name,
                    args,
                    bind_result_as,
                } => {
                    let mutation_args = eval_action_args(args, &input, &bindings, &metadata, self)?;
                    let output = self.invoke_mutation(
                        name,
                        HandlerInput {
                            args: Value::Object(mutation_args),
                            auth: input.auth.clone(),
                            read_set: Vec::new(),
                        },
                    )?;
                    changed_count += output.changed_count;
                    last_result = output.result;
                    if let Some(binding) = bind_result_as {
                        bindings.insert(binding.clone(), last_result.clone());
                    }
                }
            }
        }
        match &plan.return_value {
            Some(ActionReturnValue::Literal(value)) => Ok(value.clone()),
            Some(ActionReturnValue::Binding(name)) => {
                bindings.get(name).cloned().ok_or_else(|| {
                    SnapbackError::error(
                        "SNAPBACK_BINDING_MISSING",
                        "runtime",
                        format!("action binding {name} was not available"),
                    )
                })
            }
            Some(ActionReturnValue::ChangedCount) => Ok(json!(changed_count)),
            Some(ActionReturnValue::LastMutationResult) | None => Ok(last_result),
        }
    }

    fn active_live_functions(&self) -> BTreeSet<String> {
        self.subscriptions
            .values()
            .map(|subscription| subscription.function.clone())
            .collect()
    }

    fn persist_cron_state(&mut self) -> SnapbackResult<()> {
        let value = self.cron.persisted_value()?;
        self.db.save_cron_state(&value)
    }

    /// Fan a committed changeset out to live subscriptions. The mutation has
    /// already committed by the time this runs, so a single subscription's
    /// re-run or serialization failure must never fail the mutation or abort
    /// the loop and starve the remaining subscribers — each failure is a
    /// recorded diagnostic plus a resync signal to that one subscriber.
    ///
    /// @ref LLP 0032#phase-1--safety-floor-and-confirmed-defects — S5.D4.
    /// @ref LLP 0003#realtime-pipeline — post-commit fan-out error contract.
    fn notify_live_subscriptions(&mut self, changes: &[ChangedRow]) {
        if changes.is_empty() && self.subscriptions.is_empty() {
            return;
        }

        let subscriptions = self.subscriptions.values().cloned().collect::<Vec<_>>();
        self.live_delivery.total_fanout_attempts += subscriptions.len() as u64;
        self.live_delivery.last_fanout_subscriptions = subscriptions.len();
        self.live_delivery.last_deliveries = 0;
        self.live_delivery.last_skipped = 0;
        self.live_delivery.last_failed = 0;

        for subscription in subscriptions {
            let Some(function) = self.functions.function(&subscription.function) else {
                self.live_delivery.total_skipped += 1;
                self.live_delivery.last_skipped += 1;
                continue;
            };
            if self.subscription_has_stale_permission(&subscription) {
                self.live_delivery.total_skipped += 1;
                self.live_delivery.last_skipped += 1;
                continue;
            }
            if !live_subscription_may_be_affected(
                function,
                &subscription.input,
                &subscription.read_dependencies,
                changes,
            ) {
                self.live_delivery.total_skipped += 1;
                self.live_delivery.last_skipped += 1;
                continue;
            }
            let query = match self.invoke_query_with_dependencies(
                &subscription.function,
                subscription.input.clone(),
            ) {
                Ok(query) => query,
                Err(error) => {
                    self.fail_subscription_fanout(&subscription, "live_refresh_failed", error);
                    continue;
                }
            };
            let payload = match serde_json::to_vec(&LiveUpdate {
                kind: "live_replace".to_owned(),
                subscription_id: subscription.id.clone(),
                function: subscription.function.clone(),
                version: query.output.version,
                rows: query.output.rows,
            }) {
                Ok(payload) => payload,
                Err(error) => {
                    self.fail_subscription_fanout(
                        &subscription,
                        "live_serialize_failed",
                        SnapbackError::error(
                            "SNAPBACK_LIVE_UPDATE_SERIALIZE_FAILED",
                            "realtime",
                            "live query update could not be serialized",
                        )
                        .with_details(json!({ "error": error.to_string() })),
                    );
                    continue;
                }
            };
            if let Some(stored) = self.subscriptions.get_mut(&subscription.id) {
                stored.read_dependencies = query.read_dependencies;
            }
            self.ephemeral
                .enqueue_durable(subscription.connection_id, payload);
            self.live_delivery.total_deliveries += 1;
            self.live_delivery.last_deliveries += 1;
        }
    }

    /// Record a post-commit fan-out failure for one subscription: a diagnostic
    /// in the ring, a failure counter, and a best-effort `resync_required`
    /// signal so the client re-snapshots instead of silently freezing. Never
    /// propagates — the mutation already committed.
    ///
    /// @ref LLP 0032#phase-1--safety-floor-and-confirmed-defects — S5.D4.
    fn fail_subscription_fanout(
        &mut self,
        subscription: &LiveSubscription,
        reason: &str,
        error: SnapbackError,
    ) {
        self.live_delivery.total_failed += 1;
        self.live_delivery.last_failed += 1;
        let mut diagnostic = error.diagnostic;
        diagnostic.details = json!({
            "subscriptionId": subscription.id,
            "function": subscription.function,
            "reason": reason,
            "error": diagnostic.details,
        });
        self.record_diagnostics(vec![diagnostic]);
        if let Ok(payload) = serde_json::to_vec(&LiveResyncRequired {
            kind: "resync_required".to_owned(),
            reason: reason.to_owned(),
            subscription_id: subscription.id.clone(),
            scope: String::new(),
            epoch: 0,
            clear_retained: true,
        }) {
            self.ephemeral
                .enqueue_durable(subscription.connection_id.clone(), payload);
        }
    }

    fn add_permission_dependencies(
        &self,
        input: &HandlerInput,
        dependencies: &mut Vec<CapturedReadDependency>,
    ) {
        let Some(user_id) = input.auth.user_id.as_deref() else {
            return;
        };
        let scope = user_permission_scope(user_id);
        if dependencies.iter().any(|dependency| {
            dependency.kind == CapturedReadKind::Permission
                && dependency.value.as_ref().and_then(Value::as_str) == Some(scope.as_str())
        }) {
            return;
        }
        dependencies.push(CapturedReadDependency {
            kind: CapturedReadKind::Permission,
            table: None,
            id: None,
            version: Some(self.permission_epoch(&scope)),
            predicate: None,
            rows: Vec::new(),
            field: Some("scope".to_owned()),
            value: Some(Value::String(scope)),
            order: None,
            limit: None,
            result_count: None,
            boundary: None,
        });
    }

    fn permission_epoch(&self, scope: &str) -> u64 {
        self.permission_epochs.get(scope).copied().unwrap_or(0)
    }

    fn advance_permission_epochs(
        &mut self,
        function: &FunctionDefinition,
        input: &HandlerInput,
    ) -> SnapbackResult<Vec<(String, u64)>> {
        let mut scopes = BTreeSet::new();
        for expr in &function.permission_epoch_bumps {
            scopes.insert(evaluate_permission_scope(expr, input)?);
        }

        let mut changes = Vec::new();
        for scope in scopes {
            let epoch = self.permission_epochs.entry(scope.clone()).or_insert(0);
            *epoch += 1;
            changes.push((scope, *epoch));
        }
        Ok(changes)
    }

    /// Post-commit permission-epoch resync fan-out. Like
    /// [`Self::notify_live_subscriptions`], a per-subscription serialization
    /// failure is a recorded diagnostic, never a failure of the committed
    /// mutation.
    ///
    /// @ref LLP 0032#phase-1--safety-floor-and-confirmed-defects — S5.D4.
    fn notify_permission_resyncs(&mut self, changes: &[(String, u64)]) {
        if changes.is_empty() || self.subscriptions.is_empty() {
            return;
        }

        let subscriptions = self.subscriptions.values().cloned().collect::<Vec<_>>();
        self.live_delivery.total_fanout_attempts += subscriptions.len() as u64;
        self.live_delivery.last_fanout_subscriptions = subscriptions.len();
        self.live_delivery.last_deliveries = 0;
        self.live_delivery.last_skipped = 0;
        self.live_delivery.last_failed = 0;

        for subscription in subscriptions {
            let Some((scope, epoch)) = subscription_stale_permission_change(&subscription, changes)
            else {
                self.live_delivery.total_skipped += 1;
                self.live_delivery.last_skipped += 1;
                continue;
            };

            let payload = match serde_json::to_vec(&LiveResyncRequired {
                kind: "resync_required".to_owned(),
                reason: "permission_epoch_changed".to_owned(),
                subscription_id: subscription.id.clone(),
                scope: scope.clone(),
                epoch: *epoch,
                clear_retained: true,
            }) {
                Ok(payload) => payload,
                Err(error) => {
                    self.fail_subscription_fanout(
                        &subscription,
                        "permission_resync_serialize_failed",
                        SnapbackError::error(
                            "SNAPBACK_LIVE_UPDATE_SERIALIZE_FAILED",
                            "realtime",
                            "live resync message could not be serialized",
                        )
                        .with_details(json!({ "error": error.to_string() })),
                    );
                    continue;
                }
            };
            self.ephemeral
                .enqueue_durable(subscription.connection_id, payload);
            self.live_delivery.total_deliveries += 1;
            self.live_delivery.last_deliveries += 1;
        }
    }

    fn subscription_has_stale_permission(&self, subscription: &LiveSubscription) -> bool {
        subscription
            .read_dependencies
            .iter()
            .filter(|dependency| dependency.kind == CapturedReadKind::Permission)
            .any(|dependency| {
                let Some(scope) = dependency.value.as_ref().and_then(Value::as_str) else {
                    return true;
                };
                let Some(captured_epoch) = dependency.version else {
                    return true;
                };
                self.permission_epoch(scope) > captured_epoch
            })
    }

    fn resume_requires_resnapshot(
        &self,
        subscription: &LiveSubscription,
        recorded_permission_epochs: &BTreeMap<String, u64>,
    ) -> bool {
        subscription
            .read_dependencies
            .iter()
            .filter(|dependency| dependency.kind == CapturedReadKind::Permission)
            .any(|dependency| {
                let Some(scope) = dependency.value.as_ref().and_then(Value::as_str) else {
                    return true;
                };
                let Some(captured_epoch) = dependency.version else {
                    return true;
                };
                let current_epoch = self.permission_epoch(scope);
                recorded_permission_epochs.get(scope).copied() != Some(current_epoch)
                    || current_epoch != captured_epoch
            })
    }

    fn record_diagnostics(&mut self, diagnostics: Vec<Diagnostic>) {
        for diagnostic in diagnostics {
            if matches!(
                diagnostic.severity,
                DiagnosticSeverity::Error | DiagnosticSeverity::Fatal
            ) {
                self.recent_diagnostics.push_front(diagnostic);
            } else {
                self.recent_diagnostics.push_back(diagnostic);
            }
            while self.recent_diagnostics.len() > MAX_RECENT_DIAGNOSTICS {
                self.recent_diagnostics.pop_front();
            }
        }
    }
}

fn user_permission_scope(user_id: &str) -> String {
    format!("user:{user_id}")
}

fn permission_epochs_from_dependencies(
    dependencies: &[CapturedReadDependency],
) -> BTreeMap<String, u64> {
    let mut epochs = BTreeMap::new();
    for dependency in dependencies
        .iter()
        .filter(|dependency| dependency.kind == CapturedReadKind::Permission)
    {
        let Some(scope) = dependency.value.as_ref().and_then(Value::as_str) else {
            continue;
        };
        let Some(epoch) = dependency.version else {
            continue;
        };
        epochs.insert(scope.to_owned(), epoch);
    }
    epochs
}

fn current_permission_epochs_for_dependencies(
    dependencies: &[CapturedReadDependency],
    current_epoch: impl Fn(&str) -> u64,
) -> BTreeMap<String, u64> {
    let mut epochs = BTreeMap::new();
    for dependency in dependencies
        .iter()
        .filter(|dependency| dependency.kind == CapturedReadKind::Permission)
    {
        let Some(scope) = dependency.value.as_ref().and_then(Value::as_str) else {
            continue;
        };
        let epoch = dependency.version.unwrap_or_else(|| current_epoch(scope));
        epochs.insert(scope.to_owned(), epoch);
    }
    epochs
}

fn evaluate_permission_scope(
    expr: &PermissionScopeExpr,
    input: &HandlerInput,
) -> SnapbackResult<String> {
    let scope = match expr {
        PermissionScopeExpr::AuthUser => {
            let Some(user_id) = input.auth.user_id.as_deref() else {
                return Err(SnapbackError::error(
                    "SNAPBACK_AUTH_USER_MISSING",
                    "runtime",
                    "permission scope requires an authenticated user",
                ));
            };
            user_permission_scope(user_id)
        }
        PermissionScopeExpr::Arg(path) => {
            lookup_arg_string(&input.args, path).ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_PERMISSION_SCOPE_MISSING",
                    "runtime",
                    "permission scope argument is missing or is not a string",
                )
                .with_details(json!({ "path": path }))
            })?
        }
        PermissionScopeExpr::Literal(scope) => scope.clone(),
    };

    if scope.is_empty() {
        return Err(SnapbackError::error(
            "SNAPBACK_PERMISSION_SCOPE_MISSING",
            "runtime",
            "permission scope is empty",
        ));
    }

    Ok(scope)
}

fn lookup_arg_string(args: &Value, path: &str) -> Option<String> {
    if path.is_empty() {
        return None;
    }

    let mut current = args;
    for segment in path.split('.') {
        current = current.get(segment)?;
    }
    current.as_str().map(ToOwned::to_owned)
}

fn subscription_stale_permission_change<'a>(
    subscription: &LiveSubscription,
    changes: &'a [(String, u64)],
) -> Option<(&'a String, &'a u64)> {
    for dependency in subscription
        .read_dependencies
        .iter()
        .filter(|dependency| dependency.kind == CapturedReadKind::Permission)
    {
        let Some(scope) = dependency.value.as_ref().and_then(Value::as_str) else {
            continue;
        };
        let captured_epoch = dependency.version.unwrap_or_default();
        for (changed_scope, epoch) in changes {
            if changed_scope == scope && *epoch > captured_epoch {
                return Some((changed_scope, epoch));
            }
        }
    }
    None
}

fn eval_action_args(
    args: &BTreeMap<String, ValueExpr>,
    input: &HandlerInput,
    bindings: &BTreeMap<String, Value>,
    metadata: &CronRunMetadata,
    snapback: &LocalSnapback,
) -> SnapbackResult<Map<String, Value>> {
    let mut output = Map::new();
    for (name, expr) in args {
        output.insert(
            name.clone(),
            eval_action_expr(expr, input, bindings, metadata, snapback)?,
        );
    }
    Ok(output)
}

fn eval_action_expr(
    expr: &ValueExpr,
    input: &HandlerInput,
    bindings: &BTreeMap<String, Value>,
    metadata: &CronRunMetadata,
    snapback: &LocalSnapback,
) -> SnapbackResult<Value> {
    match expr {
        ValueExpr::Arg(path) => lookup_path(&input.args, path).cloned().ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_ARG_MISSING",
                "runtime",
                format!("handler arg {path} was not provided"),
            )
        }),
        ValueExpr::AuthUserId => input
            .auth
            .user_id
            .clone()
            .map(Value::String)
            .ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_AUTH_USER_MISSING",
                    "runtime",
                    "handler requested auth.user_id but no user was supplied",
                )
            }),
        ValueExpr::Binding(name) => bindings.get(name).cloned().ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_BINDING_MISSING",
                "runtime",
                format!("action binding {name} was not available"),
            )
        }),
        ValueExpr::Literal(value) => Ok(value.clone()),
        ValueExpr::RuntimeId => Ok(Value::String(snapback.db.generate_id())),
        ValueExpr::RuntimeNow => Ok(json!(metadata.due_at_ms)),
    }
}

fn lookup_path<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    let mut current = value;
    for segment in path.split('.') {
        current = current.as_object()?.get(segment)?;
    }
    Some(current)
}

fn plan_io(definition: &FunctionDefinition) -> (Vec<String>, Vec<String>) {
    match &definition.runtime {
        FunctionRuntime::HostPlan(HandlerPlan::Query(plan)) => {
            (vec![plan.table.clone()], Vec::new())
        }
        FunctionRuntime::HostPlan(HandlerPlan::Mutation(plan)) => {
            let mut reads = BTreeSet::new();
            let mut writes = BTreeSet::new();
            for step in &plan.steps {
                match step {
                    MutationStep::Insert { table, .. } => {
                        writes.insert(table.clone());
                    }
                    MutationStep::Patch { table, .. } | MutationStep::Delete { table, .. } => {
                        reads.insert(table.clone());
                        writes.insert(table.clone());
                    }
                }
            }
            (reads.into_iter().collect(), writes.into_iter().collect())
        }
        FunctionRuntime::HostPlan(HandlerPlan::Action(plan)) => {
            let writes = plan
                .steps
                .iter()
                .map(|step| match step {
                    ActionStep::RunMutation { name, .. } => name.clone(),
                })
                .collect();
            (Vec::new(), writes)
        }
        FunctionRuntime::IbexModule(_) => (
            definition.read_set_summary.tables.clone(),
            definition.write_set_summary.tables.clone(),
        ),
    }
}

fn live_stream_text(envelope: RealtimeEnvelope) -> Option<String> {
    match envelope {
        RealtimeEnvelope::Durable(message) => String::from_utf8(message.payload)
            .or_else(|error| {
                serde_json::to_string(&json!({
                    "kind": "durable_bytes",
                    "payload": error.into_bytes(),
                }))
            })
            .ok(),
        RealtimeEnvelope::Ephemeral(message) => serde_json::to_string(&json!({
            "kind": "ephemeral",
            "message": message,
        }))
        .ok(),
    }
}

fn elapsed_ms(started: Instant) -> u64 {
    started.elapsed().as_millis() as u64
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
