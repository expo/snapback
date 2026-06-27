use crate::diagnostic::{Diagnostic, DiagnosticSeverity, SnapbackError, SnapbackResult};
use crate::ephemeral::{
    DeleteRequest, EphemeralCollection, EphemeralDiagnostics, EphemeralMessage,
    LocalEphemeralBackend, PublishOutcome, PublishRequest, RealtimeEnvelope, SubscribeRequest,
};
use crate::live_matcher::{live_subscription_may_be_affected, query_dependencies_from_plan};
use crate::manifest::{
    CapabilityManifest, FunctionDefinition, FunctionKind, FunctionManifest, FunctionRuntime,
    HandlerInput, HandlerPlan, MutationOutput, MutationStep, PermissionScopeExpr, QueryOutput,
    SNAPBACK_SCHEMA_VERSION, SchemaManifest, SeedData, TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX,
};
use crate::runtime::{RuntimeCapabilities, RuntimeManager};
use crate::storage::{
    CapturedReadDependency, CapturedReadKind, CapturedWriteDependency, ChangedRow, LocalDatabase,
    MutationCommit, StorageInfo, TableScan,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::path::Path;
use std::time::Instant;

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
    pub recent_diagnostics: Vec<Diagnostic>,
    pub capability_gaps: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct LiveSubscriptionInfo {
    pub id: String,
    pub connection_id: String,
    pub function: String,
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
    pub last_fanout_subscriptions: usize,
    pub last_deliveries: usize,
    pub last_skipped: usize,
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
    subscriptions: BTreeMap<String, LiveSubscription>,
    permission_epochs: BTreeMap<String, u64>,
    live_delivery: LiveDeliveryStats,
    recent_diagnostics: VecDeque<Diagnostic>,
    next_subscription_id: u64,
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

impl LocalSnapback {
    pub fn memory() -> SnapbackResult<Self> {
        Self::from_database(LocalDatabase::memory()?)
    }

    pub fn open(path: impl AsRef<Path>) -> SnapbackResult<Self> {
        Self::from_database(LocalDatabase::open(path)?)
    }

    pub fn apply_schema(&mut self, manifest: SchemaManifest) -> SnapbackResult<Vec<Diagnostic>> {
        manifest.validate_artifact()?;
        let diagnostics = self.db.apply_schema(manifest)?;
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

        diagnostics.extend(self.runtime.diagnostics());
        self.record_diagnostics(diagnostics.clone());
        diagnostics
    }

    pub fn reset(&mut self) -> SnapbackResult<()> {
        self.db.reset()?;
        self.subscriptions.clear();
        self.permission_epochs.clear();
        self.live_delivery = LiveDeliveryStats::default();
        self.next_subscription_id = 0;
        Ok(())
    }

    pub fn seed(&mut self, seed: SeedData) -> SnapbackResult<MutationOutput> {
        let output = self.db.seed(seed)?;
        self.notify_live_subscriptions(&[])?;
        Ok(output)
    }

    pub fn inspect(&mut self) -> SnapbackResult<InspectState> {
        // @ref LLP 0010#v0-implementation-charter — missing non-v0 capabilities must be reported explicitly.
        let capability_gaps = self.capability_gaps();
        let capability_manifest = CapabilityManifest::local_v0(capability_gaps.clone());

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
            "cron".to_owned(),
            "notifications".to_owned(),
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
        self.notify_permission_resyncs(&permission_changes)?;
        self.notify_live_subscriptions(&commit.changes)?;
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
        self.next_subscription_id += 1;
        let subscription_id = format!("sub_{}", self.next_subscription_id);
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
    }

    pub fn cleanup_ephemeral(&mut self, now_ms: u64) {
        self.ephemeral.cleanup_expired(now_ms);
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
        let mut recent_diagnostics = VecDeque::new();
        for diagnostic in runtime.diagnostics() {
            recent_diagnostics.push_back(diagnostic);
        }

        Ok(Self {
            db,
            functions: FunctionManifest::default(),
            runtime,
            ephemeral: LocalEphemeralBackend::new(),
            subscriptions: BTreeMap::new(),
            permission_epochs: BTreeMap::new(),
            live_delivery: LiveDeliveryStats::default(),
            recent_diagnostics,
            next_subscription_id: 0,
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

    fn notify_live_subscriptions(&mut self, changes: &[ChangedRow]) -> SnapbackResult<()> {
        if changes.is_empty() && self.subscriptions.is_empty() {
            return Ok(());
        }

        let subscriptions = self.subscriptions.values().cloned().collect::<Vec<_>>();
        self.live_delivery.total_fanout_attempts += subscriptions.len() as u64;
        self.live_delivery.last_fanout_subscriptions = subscriptions.len();
        self.live_delivery.last_deliveries = 0;
        self.live_delivery.last_skipped = 0;

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
            let query = self.invoke_query_with_dependencies(
                &subscription.function,
                subscription.input.clone(),
            )?;
            let payload = serde_json::to_vec(&LiveUpdate {
                kind: "live_replace".to_owned(),
                subscription_id: subscription.id.clone(),
                function: subscription.function.clone(),
                version: query.output.version,
                rows: query.output.rows,
            })
            .map_err(|error| {
                SnapbackError::error(
                    "SNAPBACK_LIVE_UPDATE_SERIALIZE_FAILED",
                    "realtime",
                    "live query update could not be serialized",
                )
                .with_details(json!({ "error": error.to_string() }))
            })?;
            if let Some(stored) = self.subscriptions.get_mut(&subscription.id) {
                stored.read_dependencies = query.read_dependencies;
            }
            self.ephemeral
                .enqueue_durable(subscription.connection_id, payload);
            self.live_delivery.total_deliveries += 1;
            self.live_delivery.last_deliveries += 1;
        }

        Ok(())
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

    fn notify_permission_resyncs(&mut self, changes: &[(String, u64)]) -> SnapbackResult<()> {
        if changes.is_empty() || self.subscriptions.is_empty() {
            return Ok(());
        }

        let subscriptions = self.subscriptions.values().cloned().collect::<Vec<_>>();
        self.live_delivery.total_fanout_attempts += subscriptions.len() as u64;
        self.live_delivery.last_fanout_subscriptions = subscriptions.len();
        self.live_delivery.last_deliveries = 0;
        self.live_delivery.last_skipped = 0;

        for subscription in subscriptions {
            let Some((scope, epoch)) = subscription_stale_permission_change(&subscription, changes)
            else {
                self.live_delivery.total_skipped += 1;
                self.live_delivery.last_skipped += 1;
                continue;
            };

            let payload = serde_json::to_vec(&LiveResyncRequired {
                kind: "resync_required".to_owned(),
                reason: "permission_epoch_changed".to_owned(),
                subscription_id: subscription.id,
                scope: scope.clone(),
                epoch: *epoch,
                clear_retained: true,
            })
            .map_err(|error| {
                SnapbackError::error(
                    "SNAPBACK_LIVE_UPDATE_SERIALIZE_FAILED",
                    "realtime",
                    "live resync message could not be serialized",
                )
                .with_details(json!({ "error": error.to_string() }))
            })?;
            self.ephemeral
                .enqueue_durable(subscription.connection_id, payload);
            self.live_delivery.total_deliveries += 1;
            self.live_delivery.last_deliveries += 1;
        }

        Ok(())
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
