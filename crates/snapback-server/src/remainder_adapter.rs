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
}
