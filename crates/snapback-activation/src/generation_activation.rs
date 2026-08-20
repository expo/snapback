//! Function-generation activation ordering for the local target.
//!
//! This is deliberately a coordinator, not a second storage implementation:
//! SQLite transactions and durable generation records remain storage-kernel
//! responsibilities. The coordinator composes those primitives with the
//! process-local successor publication and its post-install effects.

use crate::auth::admission::ModeCommitFailure;
use crate::auth::mode::DeploymentIdentity;
use crate::diagnostic::{Diagnostic, SnapbackError, SnapbackResult};
use crate::manifest::{
    FunctionManifest, FunctionRuntime, HandlerPlan, SchemaManifest, SeedData, SequenceDeclaration,
};
use crate::storage::auth_mode::{DurableModeCommit, NetworkDeploymentCommit};
use crate::storage::generation_commit::GenerationCommitOps;
use crate::storage::{
    CommitFunctionGeneration, FunctionGenerationRecord, PendingProjectionPublication,
};
use std::collections::{BTreeMap, BTreeSet};
use std::time::Instant;

/// Process posture for the durable raw-dev function generation found at open.
/// The durable record remains the sole recovery authority; this state only
/// decides whether this process may serve or must classify its next load.
///
/// @ref LLP 0225#3-transaction-and-commit-boundaries--who-may-commit-what —
///   recovery consumes the kernel's typed persisted record without moving its
///   transaction authority into the coordinator or treating a process fence
///   as durable truth.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum FunctionGenerationRecoveryState {
    NoCommittedGeneration,
    AwaitingReload(FunctionGenerationRecord),
    Resolved,
}

impl FunctionGenerationRecoveryState {
    pub fn from_record(record: Option<FunctionGenerationRecord>) -> Self {
        match record {
            Some(record) => Self::AwaitingReload(record),
            None => Self::NoCommittedGeneration,
        }
    }

    /// Fence invocation before an empty post-reopen manifest can turn a known
    /// committed function name into the ordinary unknown-function refusal.
    ///
    /// @ref LLP 0225#open-questions-for-the-author — OQ-C requires serving to
    ///   remain inert by function name until verified rehydration or a
    ///   committed successor resolves the reopened generation.
    pub fn ensure_invocation_ready(&self, name: &str) -> SnapbackResult<()> {
        let Self::AwaitingReload(record) = self else {
            return Ok(());
        };
        Err(SnapbackError::error(
            "SNAPBACK_FUNCTION_GENERATION_AWAITING_RELOAD",
            "runtime",
            format!(
                "function {name} cannot be invoked until the committed function generation is reloaded"
            ),
        )
        .with_details(serde_json::json!({
            "function": name,
            "generationHighWater": record.generation_high_water,
        })))
    }

    fn awaiting_record(&self) -> Option<&FunctionGenerationRecord> {
        match self {
            Self::AwaitingReload(record) => Some(record),
            Self::NoCommittedGeneration | Self::Resolved => None,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FunctionGenerationActivationIntent {
    Automatic,
    RehydrateCommittedGeneration,
}

struct CandidateGenerationDigests {
    function_manifest: String,
    sequence_declarations: String,
}

/// Inputs already admitted by the caller's artifact/capability preflight.
pub struct FunctionGenerationActivation {
    pub manifest: FunctionManifest,
    pub generation: u64,
    pub order_field_bounds: BTreeMap<(String, String), u64>,
    pub sequence_declarations: BTreeMap<String, SequenceDeclaration>,
    pub trusted_active_generation: bool,
    pub publish_ephemeral_collections: bool,
    pub validate_routes_after_install: bool,
    pub inject_publication_warning: bool,
    pub diagnostic_boundary: DiagnosticBoundary,
    pub diagnostics: Vec<Diagnostic>,
    pub intent: FunctionGenerationActivationIntent,
}

/// The durable same-mode cut plus the process publication it authorized.
pub struct SameModeNetworkActivation {
    pub commit: NetworkDeploymentCommit,
    pub committed_at: Instant,
    pub diagnostics: Vec<Diagnostic>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DiagnosticBoundary {
    Attached,
    Standalone,
}

/// Engine-owned effects required by the generation activation coordinator.
///
/// @ref LLP 0276#phases — the lower activation owner declares this port and
///   the higher engine remainder implements it, so activation never depends
///   upward on `LocalSnapback`.
pub trait ActivationHost {
    fn generation_commit_ops(&mut self) -> GenerationCommitOps<'_>;

    fn publish_generation_ephemeral_collections(&mut self);

    fn post_install_function_generation(
        &mut self,
        diagnostics: &mut Vec<Diagnostic>,
        validate_routes_after_install: bool,
        inject_publication_warning: bool,
    );

    fn install_process_generation_marker(&mut self, generation: u64);

    fn record_generation_activation_diagnostics(
        &mut self,
        diagnostics: Vec<Diagnostic>,
        boundary: DiagnosticBoundary,
    );

    fn function_generation_recovery_state(&self) -> &FunctionGenerationRecoveryState;

    fn compose_function_generation_successor(
        &mut self,
        manifest: FunctionManifest,
        order_field_bounds: BTreeMap<(String, String), u64>,
    );

    fn install_loaded_function_policies(
        &mut self,
        manifest: &FunctionManifest,
    ) -> SnapbackResult<()>;

    fn set_function_generation_recovery_state(&mut self, state: FunctionGenerationRecoveryState);
}

/// Owns compose -> install -> post-install ordering for one app generation.
///
/// @ref LLP 0225#1-ownership-map — owner 1 (generation activation
/// coordinator): one domain owner composes the generation successor
///   and the storage kernel's commit primitives without exposing a new public
///   wire or embedding surface.
pub struct GenerationActivation<'a, H: ActivationHost + ?Sized> {
    snapback: &'a mut H,
}

impl<'a, H: ActivationHost + ?Sized> GenerationActivation<'a, H> {
    pub fn new(snapback: &'a mut H) -> Self {
        Self { snapback }
    }

    /// Compose and publish a function generation with the legacy observable
    /// ordering preserved exactly.
    pub fn activate_functions(self, activation: FunctionGenerationActivation) -> Vec<Diagnostic> {
        let FunctionGenerationActivation {
            manifest,
            generation,
            order_field_bounds,
            sequence_declarations,
            trusted_active_generation,
            publish_ephemeral_collections,
            validate_routes_after_install,
            inject_publication_warning,
            diagnostic_boundary,
            mut diagnostics,
            intent,
        } = activation;

        // @ref LLP 0225#open-questions-for-the-author — OQ-C classifies the
        //   first post-reopen artifact as recovery only by exact equality with
        //   both durable digests; every automatic non-match is a successor.
        let candidate_digests = (self
            .snapback
            .function_generation_recovery_state()
            .awaiting_record()
            .is_some()
            || intent == FunctionGenerationActivationIntent::RehydrateCommittedGeneration)
            .then(|| Self::candidate_generation_digests(&manifest));
        let digests_match = self
            .snapback
            .function_generation_recovery_state()
            .awaiting_record()
            .zip(candidate_digests.as_ref())
            .is_some_and(|(record, candidate)| {
                record.function_manifest_digest == candidate.function_manifest
                    && record.sequence_declarations_digest == candidate.sequence_declarations
            });

        if intent == FunctionGenerationActivationIntent::RehydrateCommittedGeneration
            && !digests_match
        {
            diagnostics.push(Self::rehydration_mismatch_diagnostic(
                self.snapback
                    .function_generation_recovery_state()
                    .awaiting_record(),
                candidate_digests.as_ref(),
                &[],
                false,
            ));
            self.snapback
                .record_generation_activation_diagnostics(diagnostics.clone(), diagnostic_boundary);
            return diagnostics;
        }

        // @ref LLP 0080#5-transactionally-maintained-projections — activation
        //   materializes every stale plan under the local barrier, then its
        //   pins join the generation record in the composite kernel commit.
        let projection_publications = match Self::materialize_projection_publications(
            self.snapback,
            &manifest,
            &mut diagnostics,
        ) {
            Ok(publications) => publications,
            Err(error) => {
                diagnostics.push(error.diagnostic);
                self.snapback.record_generation_activation_diagnostics(
                    diagnostics.clone(),
                    diagnostic_boundary,
                );
                return diagnostics;
            }
        };

        let transcript_catalog_matches = if digests_match {
            match self
                .snapback
                .generation_commit_ops()
                .stream_transcript_manifest_matches(&manifest)
            {
                Ok(matches) => matches,
                Err(error) => {
                    diagnostics.push(error.diagnostic);
                    self.snapback.record_generation_activation_diagnostics(
                        diagnostics.clone(),
                        diagnostic_boundary,
                    );
                    return diagnostics;
                }
            }
        } else {
            true
        };
        let rehydrating =
            digests_match && projection_publications.is_empty() && transcript_catalog_matches;
        if intent == FunctionGenerationActivationIntent::RehydrateCommittedGeneration
            && !rehydrating
        {
            diagnostics.push(Self::rehydration_mismatch_diagnostic(
                self.snapback
                    .function_generation_recovery_state()
                    .awaiting_record(),
                candidate_digests.as_ref(),
                &projection_publications,
                !transcript_catalog_matches,
            ));
            self.snapback
                .record_generation_activation_diagnostics(diagnostics.clone(), diagnostic_boundary);
            return diagnostics;
        }

        if !rehydrating {
            match self
                .snapback
                .generation_commit_ops()
                .commit_function_generation(CommitFunctionGeneration {
                    manifest: manifest.clone(),
                    trusted_active_generation,
                    projection_publications,
                }) {
                Ok(_) => {}
                Err(error) => {
                    // Transcript activation now fails before COMMIT. Do not
                    // synthesize the former post-commit AwaitingReload fence:
                    // an existing fence still names its durable predecessor,
                    // while a fresh failed activation made no generation fact
                    // durable at all.
                    diagnostics.push(error.diagnostic);
                    self.snapback.record_generation_activation_diagnostics(
                        diagnostics.clone(),
                        diagnostic_boundary,
                    );
                    return diagnostics;
                }
            }
        }

        if publish_ephemeral_collections {
            self.snapback.publish_generation_ephemeral_collections();
        }
        self.snapback
            .generation_commit_ops()
            .install_committed_sequence_declarations(sequence_declarations);
        if let Err(error) = self.snapback.install_loaded_function_policies(&manifest) {
            diagnostics.push(error.diagnostic);
            self.snapback
                .record_generation_activation_diagnostics(diagnostics.clone(), diagnostic_boundary);
            return diagnostics;
        }
        self.snapback
            .compose_function_generation_successor(manifest, order_field_bounds);
        self.snapback.publish_generation_ephemeral_collections();
        Self::install_process_generation(self.snapback, generation);
        self.snapback
            .set_function_generation_recovery_state(FunctionGenerationRecoveryState::Resolved);
        self.snapback.post_install_function_generation(
            &mut diagnostics,
            validate_routes_after_install,
            inject_publication_warning,
        );
        self.snapback
            .record_generation_activation_diagnostics(diagnostics.clone(), diagnostic_boundary);
        diagnostics
    }

    fn candidate_generation_digests(manifest: &FunctionManifest) -> CandidateGenerationDigests {
        let sequence_declarations =
            crate::storage::sequence_declarations_from_function_manifest(manifest);
        CandidateGenerationDigests {
            function_manifest: crate::manifest::canonical_content_identity(manifest)
                .expect("validated function manifests are canonically digestible"),
            sequence_declarations: crate::manifest::canonical_content_identity(
                &sequence_declarations,
            )
            .expect("validated sequence declarations are canonically digestible"),
        }
    }

    fn rehydration_mismatch_diagnostic(
        persisted: Option<&FunctionGenerationRecord>,
        candidate: Option<&CandidateGenerationDigests>,
        pending_publications: &[PendingProjectionPublication],
        transcript_catalog_mismatch: bool,
    ) -> Diagnostic {
        let persisted_function = persisted.map(|record| record.function_manifest_digest.as_str());
        let persisted_sequences =
            persisted.map(|record| record.sequence_declarations_digest.as_str());
        let candidate_function = candidate.map(|candidate| candidate.function_manifest.as_str());
        let candidate_sequences =
            candidate.map(|candidate| candidate.sequence_declarations.as_str());
        let mut diverged_digests = Vec::new();
        if persisted_function != candidate_function {
            diverged_digests.push("functionManifestDigest");
        }
        if persisted_sequences != candidate_sequences {
            diverged_digests.push("sequenceDeclarationsDigest");
        }
        Diagnostic::error(
            "SNAPBACK_FUNCTION_GENERATION_REHYDRATION_MISMATCH",
            "runtime",
            "the supplied artifacts cannot rehydrate the committed function generation",
        )
        .with_details(serde_json::json!({
            "mismatchedDigests": diverged_digests,
            "functionManifestDigest": {
                "persisted": persisted_function,
                "candidate": candidate_function,
            },
            "sequenceDeclarationsDigest": {
                "persisted": persisted_sequences,
                "candidate": candidate_sequences,
            },
            "pendingProjectionPlanIds": pending_publications
                .iter()
                .map(|publication| publication.plan_id.as_str())
                .collect::<Vec<_>>(),
            "streamTranscriptCatalogMismatch": transcript_catalog_mismatch,
        }))
    }

    /// Compose the complete-pair storage cut and process publication under one
    /// activation owner. Storage remains the transaction authority; the
    /// coordinator decides that the process successor may install only from a
    /// classified committed result.
    pub fn activate_same_mode_network_generation(
        self,
        deployment: DeploymentIdentity,
        schema: SchemaManifest,
        functions: FunctionManifest,
        seed: Option<SeedData>,
        publication_generation: u64,
        diagnostic_boundary: DiagnosticBoundary,
    ) -> Result<SameModeNetworkActivation, ModeCommitFailure> {
        let mut diagnostics = Vec::new();
        // An initial complete pair can create and seed a projection's source
        // tables inside the mode transaction. Materialize early only when the
        // current physical schema/data is already the successor input; the
        // storage kernel materializes the remaining plans after DDL/seed in
        // that same composite transaction.
        let can_materialize_before_commit =
            seed.is_none() && self.snapback.generation_commit_ops().schema() == &schema;
        let projection_publications = if can_materialize_before_commit {
            Self::materialize_projection_publications(self.snapback, &functions, &mut diagnostics)
                .map_err(ModeCommitFailure::RolledBack)?
        } else {
            Vec::new()
        };
        let materialized_before_commit = projection_publications
            .iter()
            .map(|publication| publication.plan_id.clone())
            .collect::<BTreeSet<_>>();
        let sequence_declarations =
            crate::storage::sequence_declarations_from_function_manifest(&functions);
        let order_field_bounds = order_field_bounds_from_functions(&functions, &schema)
            .map_err(ModeCommitFailure::RolledBack)?;
        let committed = self
            .snapback
            .generation_commit_ops()
            .apply_same_mode_network_deployment_with_functions_classified(
                deployment,
                schema,
                functions.clone(),
                seed,
                projection_publications,
            );
        let commit = match committed {
            DurableModeCommit::Committed(committed) => committed,
            DurableModeCommit::RolledBack(error) => {
                return Err(ModeCommitFailure::RolledBack(error));
            }
            DurableModeCommit::Uncertain(error) => {
                return Err(ModeCommitFailure::Uncertain(error));
            }
        };
        let committed_at = Instant::now();
        for publication in &commit.projection_publications {
            if !materialized_before_commit.contains(&publication.plan_id) {
                diagnostics.push(Self::projection_rebuilt_diagnostic(publication));
            }
        }
        self.snapback.publish_generation_ephemeral_collections();
        self.snapback
            .generation_commit_ops()
            .install_committed_sequence_declarations(sequence_declarations);
        self.snapback
            .compose_function_generation_successor(functions, order_field_bounds);
        Self::install_process_generation(self.snapback, publication_generation);
        self.snapback
            .set_function_generation_recovery_state(FunctionGenerationRecoveryState::Resolved);
        self.snapback
            .post_install_function_generation(&mut diagnostics, false, true);
        self.snapback
            .record_generation_activation_diagnostics(diagnostics.clone(), diagnostic_boundary);
        Ok(SameModeNetworkActivation {
            commit,
            committed_at,
            diagnostics,
        })
    }

    /// Install the process-local fence only after the owning durable operation
    /// has committed. The fence is never a crash-recovery authority: complete
    /// pair recovery reads storage's persisted generation record.
    pub fn install_process_generation(snapback: &mut H, generation: u64) {
        snapback.install_process_generation_marker(generation);
    }

    fn materialize_projection_publications(
        snapback: &mut H,
        manifest: &FunctionManifest,
        diagnostics: &mut Vec<Diagnostic>,
    ) -> Result<Vec<PendingProjectionPublication>, crate::diagnostic::SnapbackError> {
        let mut publications = Vec::new();
        for plan in &manifest.projections {
            if let Some(publication) = snapback
                .generation_commit_ops()
                .rebuild_projection_if_stale(plan, "activation")?
            {
                diagnostics.push(Self::projection_rebuilt_diagnostic(&publication));
                publications.push(publication);
            }
        }
        // The former `compensate_uninstalled_projection_digests` protocol has
        // no activation callers after OQ3: raw-dev and complete-pair paths both
        // pin only in their owning composite commit. `clear_projection_plan_digests`
        // remains the recorded-per-slice escape hatch for a future path that
        // proves it cannot share that transaction domain; none does today.
        Ok(publications)
    }

    fn projection_rebuilt_diagnostic(publication: &PendingProjectionPublication) -> Diagnostic {
        Diagnostic::info(
            "SNAPBACK_PROJECTION_REBUILT",
            "storage",
            format!(
                "projection {} rebuilt at activation: {} rows, generation {}, {}",
                publication.plan_id,
                publication.receipt.row_count,
                publication.receipt.generation,
                publication.receipt.content_digest
            ),
        )
    }
}

/// Reconcile authored order uses into the one schema-level UTF-8 ceiling for
/// each `(table, field)`. The authoring member lives on `OrderExpr` because a
/// cursor profile is what needs the bound, but storage must never receive two
/// competing answers for the same string-encoded column.
///
/// @ref LLP 0157#d8--coordinated-cursor-family-grammar-and-the-llp-0135-seam —
///   snapshot-batch string and application-id order values share one positive,
///   write-enforced, single-valued bound per table/field.
pub fn order_field_bounds_from_functions(
    manifest: &FunctionManifest,
    schema: &SchemaManifest,
) -> SnapbackResult<BTreeMap<(String, String), u64>> {
    let mut bounds = BTreeMap::new();
    let mut register = |table_name: &str,
                        order: &[crate::manifest::OrderExpr]|
     -> SnapbackResult<()> {
        let table = schema.table(table_name).ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_FUNCTION_SCHEMA_REFERENCE_INVALID",
                "runtime",
                format!("order-field bound references unknown table {table_name}"),
            )
        })?;
        for declaration in order {
            let Some(max_encoded_bytes) = declaration.max_encoded_bytes else {
                continue;
            };
            let field = table.field(&declaration.field).ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_FUNCTION_SCHEMA_REFERENCE_INVALID",
                    "runtime",
                    format!(
                        "order-field bound references unknown field {table_name}.{}",
                        declaration.field
                    ),
                )
            })?;
            if max_encoded_bytes == 0
                || max_encoded_bytes > 9_007_199_254_740_991
                || !matches!(
                    &field.field_type,
                    crate::manifest::FieldType::String
                        | crate::manifest::FieldType::Enum { .. }
                        | crate::manifest::FieldType::Id { .. }
                )
            {
                return Err(SnapbackError::error(
                    "SNAPBACK_FUNCTION_SCHEMA_REFERENCE_INVALID",
                    "runtime",
                    format!(
                        "order-field maxEncodedBytes requires a positive bound on string or id field {table_name}.{}",
                        declaration.field
                    ),
                ));
            }
            let key = (table_name.to_owned(), declaration.field.clone());
            if let Some(previous) = bounds.insert(key.clone(), max_encoded_bytes)
                && previous != max_encoded_bytes
            {
                return Err(SnapbackError::error(
                    "SNAPBACK_FUNCTION_SCHEMA_REFERENCE_INVALID",
                    "runtime",
                    format!(
                        "order-field bound for {}.{} conflicts: {previous} versus {max_encoded_bytes}",
                        key.0, key.1
                    ),
                ));
            }
        }
        Ok(())
    };

    for function in &manifest.functions {
        match &function.runtime {
            FunctionRuntime::HostPlan(HandlerPlan::Query(plan)) => {
                register(&plan.table, &plan.order)?;
            }
            FunctionRuntime::HostPlan(HandlerPlan::RelationalQuery(plan)) => {
                register(&plan.root, &plan.order)?;
            }
            FunctionRuntime::HostPlan(HandlerPlan::BoundedChildrenQuery(plan)) => {
                register(&plan.child_table, &plan.order)?;
            }
            FunctionRuntime::HostPlan(HandlerPlan::SnapshotBatch(plan)) => {
                for node in &plan.nodes {
                    register(&node.child_table, &node.order)?;
                }
            }
            FunctionRuntime::HostPlan(HandlerPlan::SnapshotBatchV2(plan)) => {
                for node in &plan.nodes {
                    match node {
                        crate::manifest::SnapshotBatchNodeV2::BoundedChildren(node) => {
                            register(&node.child_table, &node.order)?;
                        }
                        crate::manifest::SnapshotBatchNodeV2::RelationalQuery(node) => {
                            register(&node.root, &node.order)?;
                        }
                    }
                }
            }
            _ => {}
        }
    }
    Ok(bounds)
}
