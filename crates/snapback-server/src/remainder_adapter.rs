// Higher-rank tests retain their narrow adapter vocabulary while the calls
// cross the engine crate's feature-gated test-support boundary.
#[cfg(test)]
pub(crate) trait RemainderLocalSnapbackExt {
    fn remainder_auth_fixture(&mut self) -> snapback_engine::test_support::AuthFixture<'_>;

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
        intent_producer: snapback_kernel::storage::CommitCapsuleIntentProducer<
            snapback_kernel::storage::commit_capsule_prototype::PrototypeIntent,
        >,
        intent: &snapback_kernel::storage::commit_capsule_prototype::PrototypeIntent,
        include_consumed_proof: bool,
    ) -> crate::diagnostic::SnapbackResult<
        snapback_kernel::storage::commit_capsule_prototype::PrototypeStage<'a>,
    >;

    fn remainder_reconcile_commit_capsule_prototype(
        &mut self,
        intended: &snapback_kernel::storage::commit_capsule_prototype::PrototypeIntendedRows,
    ) -> crate::diagnostic::SnapbackResult<
        Option<
            snapback_kernel::storage::ExactCommitRows<
                snapback_kernel::storage::commit_capsule_prototype::PrototypeIntent,
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
    fn remainder_auth_fixture(&mut self) -> snapback_engine::test_support::AuthFixture<'_> {
        snapback_engine::test_support::auth_fixture(self)
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
        snapback_engine::test_support::initialize_commit_capsule_prototype(self)
    }

    fn remainder_stage_commit_capsule_prototype<'a>(
        &'a mut self,
        intent_producer: snapback_kernel::storage::CommitCapsuleIntentProducer<
            snapback_kernel::storage::commit_capsule_prototype::PrototypeIntent,
        >,
        intent: &snapback_kernel::storage::commit_capsule_prototype::PrototypeIntent,
        include_consumed_proof: bool,
    ) -> crate::diagnostic::SnapbackResult<
        snapback_kernel::storage::commit_capsule_prototype::PrototypeStage<'a>,
    > {
        snapback_engine::test_support::stage_commit_capsule_prototype(
            self,
            intent_producer,
            intent,
            include_consumed_proof,
        )
    }

    fn remainder_reconcile_commit_capsule_prototype(
        &mut self,
        intended: &snapback_kernel::storage::commit_capsule_prototype::PrototypeIntendedRows,
    ) -> crate::diagnostic::SnapbackResult<
        Option<
            snapback_kernel::storage::ExactCommitRows<
                snapback_kernel::storage::commit_capsule_prototype::PrototypeIntent,
                snapback_kernel::storage::commit_capsule_prototype::PrototypeValue,
            >,
        >,
    > {
        snapback_engine::test_support::reconcile_commit_capsule_prototype(self, intended)
    }

    fn remainder_commit_capsule_prototype_facts(
        &mut self,
        intent: &snapback_kernel::storage::commit_capsule_prototype::PrototypeIntent,
    ) -> crate::diagnostic::SnapbackResult<
        snapback_kernel::storage::commit_capsule_prototype::PrototypeFacts,
    > {
        snapback_engine::test_support::commit_capsule_prototype_facts(self, intent)
    }
}
