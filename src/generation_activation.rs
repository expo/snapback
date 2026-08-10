//! Function-generation activation ordering for the local target.
//!
//! This is deliberately a coordinator, not a second storage implementation:
//! SQLite transactions and durable generation records remain storage-kernel
//! responsibilities. The coordinator composes those primitives with the
//! process-local successor publication and its post-install effects.

use crate::auth::admission::ModeCommitFailure;
use crate::auth::mode::DeploymentIdentity;
use crate::diagnostic::Diagnostic;
use crate::local::{DiagnosticBoundary, LocalSnapback};
use crate::manifest::{FunctionManifest, SchemaManifest, SeedData, SequenceDeclaration};
use crate::storage::auth_mode::{DurableModeCommit, NetworkDeploymentCommit};
use crate::storage::{CommitFunctionGeneration, PendingProjectionPublication};
use std::collections::{BTreeMap, BTreeSet};
use std::time::Instant;

/// Inputs already admitted by the caller's artifact/capability preflight.
pub(crate) struct FunctionGenerationActivation {
    pub(crate) manifest: FunctionManifest,
    pub(crate) generation: u64,
    pub(crate) order_field_bounds: BTreeMap<(String, String), u64>,
    pub(crate) sequence_declarations: BTreeMap<String, SequenceDeclaration>,
    pub(crate) trusted_active_generation: bool,
    pub(crate) publish_ephemeral_collections: bool,
    pub(crate) validate_routes_after_install: bool,
    pub(crate) inject_publication_warning: bool,
    pub(crate) diagnostic_boundary: DiagnosticBoundary,
    pub(crate) diagnostics: Vec<Diagnostic>,
}

/// The durable same-mode cut plus the process publication it authorized.
pub(crate) struct SameModeNetworkActivation {
    pub(crate) commit: NetworkDeploymentCommit,
    pub(crate) committed_at: Instant,
    pub(crate) diagnostics: Vec<Diagnostic>,
}

/// Owns compose -> install -> post-install ordering for one app generation.
///
/// @ref LLP 0225#1-ownership-map — owner 1 (generation activation
/// coordinator): one domain owner composes the generation successor
///   and the storage kernel's commit primitives without exposing a new public
///   wire or embedding surface.
pub(crate) struct GenerationActivation<'a> {
    snapback: &'a mut LocalSnapback,
}

impl<'a> GenerationActivation<'a> {
    pub(crate) fn new(snapback: &'a mut LocalSnapback) -> Self {
        Self { snapback }
    }

    /// Compose and publish a function generation with the legacy observable
    /// ordering preserved exactly.
    pub(crate) fn activate_functions(
        self,
        activation: FunctionGenerationActivation,
    ) -> Vec<Diagnostic> {
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
        } = activation;

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

        if let Err(error) = self
            .snapback
            .generation_database_mut()
            .commit_function_generation(CommitFunctionGeneration {
                manifest: manifest.clone(),
                trusted_active_generation,
                projection_publications,
            })
        {
            diagnostics.push(error.diagnostic);
            self.snapback
                .record_generation_activation_diagnostics(diagnostics.clone(), diagnostic_boundary);
            return diagnostics;
        }

        if publish_ephemeral_collections {
            self.snapback.publish_generation_ephemeral_collections();
        }
        self.snapback
            .generation_database_mut()
            .install_committed_sequence_declarations(sequence_declarations);
        // @ref LLP 0204#d91--streaming-conversations — the protected
        // transcript table exists iff this exact generation carries at least
        // one streaming action or the active schema enables D5 ask.
        if let Err(error) = self
            .snapback
            .generation_database_mut()
            .activate_stream_transcript_manifest(&manifest)
        {
            diagnostics.push(error.diagnostic);
            self.snapback
                .record_generation_activation_diagnostics(diagnostics.clone(), diagnostic_boundary);
            return diagnostics;
        }

        self.snapback
            .compose_function_generation_successor(manifest, order_field_bounds);
        self.snapback.publish_generation_ephemeral_collections();
        Self::install_process_generation(self.snapback, generation);
        self.snapback.post_install_function_generation(
            &mut diagnostics,
            validate_routes_after_install,
            inject_publication_warning,
        );
        self.snapback
            .record_generation_activation_diagnostics(diagnostics.clone(), diagnostic_boundary);
        diagnostics
    }

    /// Compose the complete-pair storage cut and process publication under one
    /// activation owner. Storage remains the transaction authority; the
    /// coordinator decides that the process successor may install only from a
    /// classified committed result.
    pub(crate) fn activate_same_mode_network_generation(
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
            seed.is_none() && self.snapback.generation_database_mut().schema() == &schema;
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
        let order_field_bounds =
            crate::local::order_field_bounds_from_functions(&functions, &schema)
                .map_err(ModeCommitFailure::RolledBack)?;
        let committed = self
            .snapback
            .generation_database_mut()
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
            .generation_database_mut()
            .install_committed_sequence_declarations(sequence_declarations);
        self.snapback
            .compose_function_generation_successor(functions, order_field_bounds);
        Self::install_process_generation(self.snapback, publication_generation);
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
    pub(crate) fn install_process_generation(snapback: &mut LocalSnapback, generation: u64) {
        snapback.install_process_generation_marker(generation);
    }

    fn materialize_projection_publications(
        snapback: &mut LocalSnapback,
        manifest: &FunctionManifest,
        diagnostics: &mut Vec<Diagnostic>,
    ) -> Result<Vec<PendingProjectionPublication>, crate::diagnostic::SnapbackError> {
        let mut publications = Vec::new();
        for plan in &manifest.projections {
            if let Some(publication) = snapback
                .generation_database_mut()
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
