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
use std::collections::BTreeMap;
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
/// @ref LLP 0199#target-ownership-map — owner 1 (generation activation
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

        if publish_ephemeral_collections {
            self.snapback.publish_generation_ephemeral_collections();
        }

        // @ref LLP 0080#5-transactionally-maintained-projections — activation
        //   materializes every stale plan under the local barrier before the
        //   function manifest becomes live.
        let mut rebuilt_projection_ids = Vec::new();
        for plan in &manifest.projections {
            match self
                .snapback
                .generation_database_mut()
                .rebuild_projection_if_stale(plan, "activation")
            {
                Ok(Some(receipt)) => {
                    rebuilt_projection_ids.push(plan.id.clone());
                    diagnostics.push(Diagnostic::info(
                        "SNAPBACK_PROJECTION_REBUILT",
                        "storage",
                        format!(
                            "projection {} rebuilt at activation: {} rows, generation {}, {}",
                            plan.id, receipt.row_count, receipt.generation, receipt.content_digest
                        ),
                    ));
                }
                Ok(None) => {}
                Err(error) => {
                    diagnostics.push(error.diagnostic);
                    Self::compensate_uninstalled_projection_digests(
                        self.snapback,
                        &rebuilt_projection_ids,
                        &mut diagnostics,
                    );
                    self.snapback.record_generation_activation_diagnostics(
                        diagnostics.clone(),
                        diagnostic_boundary,
                    );
                    return diagnostics;
                }
            }
        }

        if let Err(error) = self
            .snapback
            .generation_database_mut()
            .install_sequence_declarations(sequence_declarations, trusted_active_generation)
        {
            diagnostics.push(error.diagnostic);
            Self::compensate_uninstalled_projection_digests(
                self.snapback,
                &rebuilt_projection_ids,
                &mut diagnostics,
            );
            self.snapback
                .record_generation_activation_diagnostics(diagnostics.clone(), diagnostic_boundary);
            return diagnostics;
        }

        self.snapback
            .compose_function_generation_successor(manifest, order_field_bounds);
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
        let committed = self
            .snapback
            .generation_database_mut()
            .apply_same_mode_network_deployment_with_functions_classified(
                deployment,
                schema,
                functions.clone(),
                seed,
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
        let diagnostics = self.snapback.publish_preflighted_functions(
            functions,
            publication_generation,
            diagnostic_boundary,
        );
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

    fn compensate_uninstalled_projection_digests(
        snapback: &mut LocalSnapback,
        rebuilt_projection_ids: &[String],
        diagnostics: &mut Vec<Diagnostic>,
    ) {
        // OQ3 follow-up: complete-pair manifest/sequence/auth publication
        // already shares a SQLite storage-kernel transaction, but projection
        // rebuild publication still commits in an earlier transaction and the
        // legacy raw-dev ingress has no complete-pair durable generation
        // record. Until the kernel admits the rebuild into that composite cut,
        // clearing these digest pins is the P1 compensating protocol: retry
        // must rebuild from physical source state instead of trusting a digest
        // whose owning process generation never installed.
        if let Err(cleanup_error) = snapback
            .generation_database_mut()
            .clear_projection_plan_digests(rebuilt_projection_ids)
        {
            diagnostics.push(cleanup_error.diagnostic);
        }
    }
}
