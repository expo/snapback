// The snapback crate compiles the moved engine source directly only for its
// retained upward-reaching tests. Keep the same private adapter shape for
// that test-only copy without exporting it from the supported façade.
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
    ) -> crate::diagnostic::SnapbackResult<
        crate::commit_envelope::OperationCoverageManifestV1,
    >;
}

#[cfg(test)]
impl RemainderLocalSnapbackExt for crate::local::LocalSnapback {
    fn remainder_auth_database_mut(&mut self) -> &mut snapback_kernel::storage::LocalDatabase {
        self.auth_database_mut()
    }

    fn remainder_erase_protected_record(
        &mut self,
        request: &snapback_kernel::proof_checkpoint::ProtectedRecordErasureRequestV1,
    ) -> crate::diagnostic::SnapbackResult<
        snapback_kernel::proof_checkpoint::ProtectedRecordErasureReceiptV1,
    > {
        self.erase_protected_record(request)
    }

    fn remainder_activate_agent_safe_operation_coverage(
        &mut self,
        activated_at_ms: u64,
    ) -> crate::diagnostic::SnapbackResult<
        crate::commit_envelope::OperationCoverageManifestV1,
    > {
        self.activate_agent_safe_operation_coverage(activated_at_ms)
    }
}
