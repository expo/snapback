// Higher-rank tests retain their narrow adapter vocabulary while the calls
// cross the engine crate's feature-gated test-support boundary.
#[cfg(test)]
pub(crate) trait RemainderLocalSnapbackExt {
    fn remainder_auth_database_mut(&mut self) -> &mut snapback_kernel::storage::LocalDatabase;

    fn remainder_erase_protected_record(
        &mut self,
        request: &snapback_kernel::proof_checkpoint::ProtectedRecordErasureRequestV1,
    ) -> crate::diagnostic::SnapbackResult<
        snapback_kernel::proof_checkpoint::ProtectedRecordErasureReceiptV1,
    >;

    fn remainder_activate_agent_safe_operation_coverage(
        &mut self,
        activated_at_ms: u64,
    ) -> crate::diagnostic::SnapbackResult<crate::commit_envelope::OperationCoverageManifestV1>;

    fn remainder_initialize_commit_capsule_prototype(
        &mut self,
    ) -> crate::diagnostic::SnapbackResult<()>;

    fn remainder_stage_commit_capsule_prototype<'a>(
        &'a mut self,
        intent: &snapback_kernel::storage::commit_capsule_prototype::PrototypeIntent,
        include_consumed_proof: bool,
    ) -> crate::diagnostic::SnapbackResult<
        snapback_kernel::storage::commit_capsule_prototype::PrototypeStage<'a>,
    >;

    fn remainder_reconcile_commit_capsule_prototype(
        &mut self,
        intent: &snapback_kernel::storage::commit_capsule_prototype::PrototypeIntent,
    ) -> crate::diagnostic::SnapbackResult<
        Option<
            snapback_kernel::storage::ExactCommitRows<
                snapback_kernel::storage::commit_capsule_prototype::PrototypeValue,
            >,
        >,
    >;

    fn remainder_commit_capsule_prototype_facts(
        &mut self,
        intent: &snapback_kernel::storage::commit_capsule_prototype::PrototypeIntent,
    ) -> crate::diagnostic::SnapbackResult<
        snapback_kernel::storage::commit_capsule_prototype::PrototypeFacts,
    >;
}

#[cfg(test)]
impl RemainderLocalSnapbackExt for crate::local::LocalSnapback {
    fn remainder_auth_database_mut(&mut self) -> &mut snapback_kernel::storage::LocalDatabase {
        snapback_engine::test_support::auth_database_mut(self)
    }

    fn remainder_erase_protected_record(
        &mut self,
        request: &snapback_kernel::proof_checkpoint::ProtectedRecordErasureRequestV1,
    ) -> crate::diagnostic::SnapbackResult<
        snapback_kernel::proof_checkpoint::ProtectedRecordErasureReceiptV1,
    > {
        snapback_engine::test_support::erase_protected_record(self, request)
    }

    fn remainder_activate_agent_safe_operation_coverage(
        &mut self,
        activated_at_ms: u64,
    ) -> crate::diagnostic::SnapbackResult<crate::commit_envelope::OperationCoverageManifestV1>
    {
        snapback_engine::test_support::activate_agent_safe_operation_coverage(self, activated_at_ms)
    }

    fn remainder_initialize_commit_capsule_prototype(
        &mut self,
    ) -> crate::diagnostic::SnapbackResult<()> {
        snapback_kernel::storage::commit_capsule_prototype::initialize(
            snapback_engine::test_support::auth_database_mut(self),
        )
    }

    fn remainder_stage_commit_capsule_prototype<'a>(
        &'a mut self,
        intent: &snapback_kernel::storage::commit_capsule_prototype::PrototypeIntent,
        include_consumed_proof: bool,
    ) -> crate::diagnostic::SnapbackResult<
        snapback_kernel::storage::commit_capsule_prototype::PrototypeStage<'a>,
    > {
        snapback_kernel::storage::commit_capsule_prototype::stage(
            snapback_engine::test_support::auth_database_mut(self),
            intent,
            include_consumed_proof,
        )
    }

    fn remainder_reconcile_commit_capsule_prototype(
        &mut self,
        intent: &snapback_kernel::storage::commit_capsule_prototype::PrototypeIntent,
    ) -> crate::diagnostic::SnapbackResult<
        Option<
            snapback_kernel::storage::ExactCommitRows<
                snapback_kernel::storage::commit_capsule_prototype::PrototypeValue,
            >,
        >,
    > {
        snapback_kernel::storage::commit_capsule_prototype::exact_reconciliation(
            snapback_engine::test_support::auth_database_mut(self),
            intent,
        )
    }

    fn remainder_commit_capsule_prototype_facts(
        &mut self,
        intent: &snapback_kernel::storage::commit_capsule_prototype::PrototypeIntent,
    ) -> crate::diagnostic::SnapbackResult<
        snapback_kernel::storage::commit_capsule_prototype::PrototypeFacts,
    > {
        snapback_kernel::storage::commit_capsule_prototype::facts(
            snapback_engine::test_support::auth_database_mut(self),
            intent,
        )
    }
}
