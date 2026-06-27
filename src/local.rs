use crate::diagnostic::{Diagnostic, DiagnosticSeverity, SnapbackError, SnapbackResult};
use crate::ephemeral::{
    DeleteRequest, EphemeralCollection, EphemeralDiagnostics, EphemeralMessage,
    LocalEphemeralBackend, PublishOutcome, PublishRequest, RealtimeEnvelope, SubscribeRequest,
};
use crate::manifest::{
    FunctionDefinition, FunctionKind, FunctionManifest, FunctionRuntime, HandlerInput, HandlerPlan,
    MutationOutput, MutationStep, QueryOutput, SchemaManifest, SeedData,
};
use crate::runtime::{RuntimeCapabilities, RuntimeManager};
use crate::storage::{ChangedRow, LocalDatabase, StorageInfo, TableScan};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::path::Path;
use std::time::Instant;

const MAX_RECENT_DIAGNOSTICS: usize = 100;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct InspectState {
    pub target: String,
    pub storage: StorageInfo,
    pub runtime: RuntimeCapabilities,
    pub schema: SchemaManifest,
    pub functions: FunctionManifest,
    pub subscriptions: Vec<LiveSubscriptionInfo>,
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
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct LiveUpdate {
    pub kind: String,
    pub subscription_id: String,
    pub function: String,
    pub version: u64,
    pub rows: Vec<Value>,
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
    recent_diagnostics: VecDeque<Diagnostic>,
    next_subscription_id: u64,
}

#[derive(Clone, Debug)]
struct LiveSubscription {
    id: String,
    connection_id: String,
    function: String,
    input: HandlerInput,
}

impl LocalSnapback {
    pub fn memory() -> SnapbackResult<Self> {
        Self::from_database(LocalDatabase::memory()?)
    }

    pub fn open(path: impl AsRef<Path>) -> SnapbackResult<Self> {
        Self::from_database(LocalDatabase::open(path)?)
    }

    pub fn apply_schema(&mut self, manifest: SchemaManifest) -> SnapbackResult<Vec<Diagnostic>> {
        let diagnostics = self.db.apply_schema(manifest)?;
        self.record_diagnostics(diagnostics.clone());
        Ok(diagnostics)
    }

    pub fn load_functions(&mut self, manifest: FunctionManifest) -> Vec<Diagnostic> {
        self.functions = manifest;
        let mut diagnostics = Vec::new();

        if self
            .functions
            .functions
            .iter()
            .any(|function| matches!(function.runtime, FunctionRuntime::IbexModule(_)))
        {
            diagnostics.push(Diagnostic::warning(
                "SNAPBACK_IBEX_FUNCTIONS_LOAD_DEFERRED",
                "runtime",
                "Ibex function metadata loaded, but ctx.db host-call execution is not wired in this slice",
            ));
        }

        diagnostics.extend(self.runtime.diagnostics());
        self.record_diagnostics(diagnostics.clone());
        diagnostics
    }

    pub fn reset(&mut self) -> SnapbackResult<()> {
        self.db.reset()?;
        self.subscriptions.clear();
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
        let mut capability_gaps = vec![
            "offline_mutation_replay".to_owned(),
            "postgres".to_owned(),
            "cloudflare".to_owned(),
            "hosted_untrusted_code".to_owned(),
            "external_auth".to_owned(),
            "assets".to_owned(),
            "cron".to_owned(),
            "notifications".to_owned(),
            "ibex_ctx_db_host_bridge".to_owned(),
        ];
        if self.runtime.capabilities().ibex_cli.available {
            capability_gaps.retain(|gap| gap != "ibex_cli");
        } else {
            capability_gaps.push("ibex_cli".to_owned());
        }

        Ok(InspectState {
            target: "local-dev-sqlite-ibex".to_owned(),
            storage: self.db.info()?,
            runtime: self.runtime.capabilities().clone(),
            schema: self.db.schema().clone(),
            functions: self.functions.clone(),
            subscriptions: self
                .subscriptions
                .values()
                .map(|subscription| LiveSubscriptionInfo {
                    id: subscription.id.clone(),
                    connection_id: subscription.connection_id.clone(),
                    function: subscription.function.clone(),
                })
                .collect(),
            ephemeral: self.ephemeral.diagnostics(),
            recent_diagnostics: self.recent_diagnostics.iter().cloned().collect(),
            capability_gaps,
        })
    }

    pub fn invoke_query(&self, name: &str, input: HandlerInput) -> SnapbackResult<QueryOutput> {
        let function = self.function(name)?;
        match (&function.kind, &function.runtime) {
            (
                FunctionKind::Query | FunctionKind::LiveQuery,
                FunctionRuntime::HostPlan(HandlerPlan::Query(plan)),
            ) => self.db.query(plan, &input),
            (_, FunctionRuntime::IbexModule(_)) => Err(self.runtime.ibex_not_wired_error()),
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
        let function = self.function(name)?.clone();
        let commit = match (&function.kind, &function.runtime) {
            (FunctionKind::Mutation, FunctionRuntime::HostPlan(HandlerPlan::Mutation(plan))) => {
                self.db.execute_mutation(plan, &input)?
            }
            (_, FunctionRuntime::IbexModule(_)) => return Err(self.runtime.ibex_not_wired_error()),
            _ => {
                return Err(SnapbackError::error(
                    "SNAPBACK_FUNCTION_KIND_MISMATCH",
                    "runtime",
                    format!("{name} is not a mutation"),
                ));
            }
        };

        self.notify_live_subscriptions(&commit.changes)?;
        Ok(commit.output)
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

        let snapshot = self.invoke_query(name, input.input.clone())?;
        self.next_subscription_id += 1;
        let subscription_id = format!("sub_{}", self.next_subscription_id);
        self.subscriptions.insert(
            subscription_id.clone(),
            LiveSubscription {
                id: subscription_id.clone(),
                connection_id: input.connection_id,
                function: name.to_owned(),
                input: input.input,
            },
        );

        Ok(LiveSubscribeOutput {
            subscription_id,
            snapshot,
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
            FunctionKind::Mutation => match self.invoke_mutation(name, input) {
                Ok(output) => FunctionRunResult {
                    elapsed_ms: elapsed_ms(started),
                    version: Some(output.version),
                    changed_count: Some(output.changed_count),
                    result: Some(output.result),
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
        for subscription in subscriptions {
            let output = self.invoke_query(&subscription.function, subscription.input.clone())?;
            let payload = serde_json::to_vec(&LiveUpdate {
                kind: "live_replace".to_owned(),
                subscription_id: subscription.id,
                function: subscription.function,
                version: output.version,
                rows: output.rows,
            })
            .map_err(|error| {
                SnapbackError::error(
                    "SNAPBACK_LIVE_UPDATE_SERIALIZE_FAILED",
                    "realtime",
                    "live query update could not be serialized",
                )
                .with_details(json!({ "error": error.to_string() }))
            })?;
            self.ephemeral
                .enqueue_durable(subscription.connection_id, payload);
        }

        Ok(())
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

/// Derive the tables a function reads and writes from its host plan, so the
/// runner can show them. Insert writes; patch/delete read-then-write; queries
/// read their one table; Ibex modules are opaque until the host bridge lands.
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
        FunctionRuntime::IbexModule(_) => (Vec::new(), Vec::new()),
    }
}

fn elapsed_ms(started: Instant) -> u64 {
    started.elapsed().as_millis() as u64
}

trait DiagnosticExt {
    fn with_details(self, details: Value) -> Self;
}

impl DiagnosticExt for SnapbackError {
    fn with_details(mut self, details: Value) -> Self {
        self.diagnostic.details = details;
        self
    }
}
