use super::*;

pub(crate) use snapback_activation::generation_activation::{
    ActivationHost, DiagnosticBoundary, order_field_bounds_from_functions,
};

impl ActivationHost for LocalSnapback {
    fn generation_commit_ops(
        &mut self,
    ) -> crate::storage::generation_commit::GenerationCommitOps<'_> {
        self.db.generation_commit_ops()
    }

    fn publish_generation_ephemeral_collections(&mut self) {
        let ephemeral = self.ephemeral.clone();
        let ephemeral_collections =
            served_ephemeral_collections(&self.db.schema().ephemeral_collections, &self.functions);
        crate::exec_guard::run_or_defer_after_local(move || {
            ephemeral
                .replace_collections(ephemeral_collections)
                .expect("preflighted ephemeral definitions publish infallibly");
        });
    }

    fn compose_function_generation_successor(
        &mut self,
        manifest: FunctionManifest,
        order_field_bounds: BTreeMap<(String, String), u64>,
    ) {
        self.functions = manifest;
        // @ref LLP 0154#d2--the-observation-span-classification-registry-and-phase-1-kinds —
        //   publish exact release identity before the activation marker and
        //   every subsequently admitted operation.
        self.telemetry
            .set_release(self.functions.bundle_hash.as_deref());
        self.functions_loaded = true;
        self.db.set_projections(self.functions.projections.clone());
        self.db.set_order_field_bounds(order_field_bounds);
    }

    fn install_process_generation_marker(&mut self, generation: u64) {
        self.app_generation = generation;
        self.app_generation_fence
            .store(generation, Ordering::SeqCst);
        // Loaded code/schema (or the destructive app-state boundary) changed:
        // recompute the content-derived RQS `generation` lazily. A no-op
        // ensure recomputes the identical digest, so outstanding resume
        // tokens keep verifying (LLP 0091 §0A.6).
        self.rqs_generation = None;
    }

    fn post_install_function_generation(
        &mut self,
        diagnostics: &mut Vec<Diagnostic>,
        validate_routes_after_install: bool,
        inject_publication_warning: bool,
    ) {
        #[cfg(not(test))]
        let _ = inject_publication_warning;
        // New code means new warm-VM setup state; content keying already
        // prevents stale reuse, clearing also frees the old VMs' memory.
        self.warm_vms.clear();
        if validate_routes_after_install
            && let Some(routes) = self.routes.clone()
            && let Err(error) = self.validate_routes_manifest(&routes)
        {
            // A stale served route manifest drops fail-closed after raw-dev
            // function publication (LLP 0092 §0C.1).
            self.routes = None;
            self.routes_manifest_hash = None;
            diagnostics.push(Diagnostic::warning(
                "SNAPBACK_ROUTES_MANIFEST_INVALID",
                "runtime",
                format!(
                    "served route manifest dropped: it no longer validates against the new functions manifest ({})",
                    error.diagnostic.message
                ),
            ));
        }
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
        diagnostics.extend(self.reconcile_config());
        self.refresh_read_manifests();
        self.refresh_cron_active();
        if let Err(error) = self.persist_cron_state() {
            diagnostics.push(error.diagnostic);
        }
        self.telemetry.point_classified(
            crate::telemetry_contract::OperationClassIdV1::LIFECYCLE,
            "release_activation",
            Some(200),
            None,
            None,
            None,
            crate::telemetry::Priority::Reserved,
        );
        #[cfg(test)]
        if inject_publication_warning
            && INJECT_NEXT_PUBLICATION_WARNING.with(|inject| inject.replace(false))
        {
            diagnostics.push(Diagnostic::warning(
                "SNAPBACK_CONFIG_TRANSIT_RULE",
                "config",
                "closed publication boundary fixture",
            ));
        }
    }

    fn record_generation_activation_diagnostics(
        &mut self,
        diagnostics: Vec<Diagnostic>,
        boundary: DiagnosticBoundary,
    ) {
        self.record_diagnostics_at_boundary(diagnostics, boundary);
    }

    fn function_generation_recovery_state(
        &self,
    ) -> &crate::generation_activation::FunctionGenerationRecoveryState {
        &self.function_generation_recovery_state
    }

    fn set_function_generation_recovery_state(
        &mut self,
        state: crate::generation_activation::FunctionGenerationRecoveryState,
    ) {
        self.function_generation_recovery_state = state;
    }
}

impl LocalSnapback {
    /// Reports the reopened generation's observable recovery posture without
    /// making unassigned acceptance callers depend on the coordinator type.
    ///
    /// @ref LLP 0225#2-dependency-direction — unassigned callers assert the
    ///   owner's behavior through `LocalSnapback`'s API.
    pub(crate) fn has_committed_generation_record(&self) -> bool {
        !matches!(
            self.function_generation_recovery_state,
            crate::generation_activation::FunctionGenerationRecoveryState::NoCommittedGeneration
        )
    }

    /// Reports whether a reopened committed generation is still fenced for
    /// reload without exposing the coordinator type to unassigned callers.
    pub(crate) fn awaits_committed_generation_reload(&self) -> bool {
        matches!(
            self.function_generation_recovery_state,
            crate::generation_activation::FunctionGenerationRecoveryState::AwaitingReload(_)
        )
    }

    /// Exposes the awaiting record's high-water as observable recovery
    /// posture without exposing the coordinator type to unassigned callers.
    pub(crate) fn awaiting_generation_high_water(&self) -> Option<u64> {
        match &self.function_generation_recovery_state {
            crate::generation_activation::FunctionGenerationRecoveryState::AwaitingReload(
                record,
            ) => Some(record.generation_high_water),
            crate::generation_activation::FunctionGenerationRecoveryState::NoCommittedGeneration
            | crate::generation_activation::FunctionGenerationRecoveryState::Resolved => None,
        }
    }
}
