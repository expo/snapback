use super::{LocalDatabase, SnapbackError, SnapbackResult};
use std::path::Path;

impl LocalDatabase {
    /// Create a receipt-only or materialized named checkpoint. Materialized
    /// creation is admitted only for file-backed databases and always uses a
    /// finite copy/WAL/lease request.
    pub(super) fn create_named_checkpoint(
        &mut self,
        destination: Option<&Path>,
        request: &crate::proof_checkpoint::NamedCheckpointRequestV1,
    ) -> SnapbackResult<crate::proof_checkpoint::NamedCheckpointReceiptV1> {
        self.create_named_checkpoint_with_cut(destination, request, None)
    }

    fn create_named_checkpoint_with_cut(
        &mut self,
        destination: Option<&Path>,
        request: &crate::proof_checkpoint::NamedCheckpointRequestV1,
        cut_at: Option<crate::proof_checkpoint::CheckpointPublicationCut>,
    ) -> SnapbackResult<crate::proof_checkpoint::NamedCheckpointReceiptV1> {
        let source = self.path.clone().ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_CHECKPOINT_SOURCE_UNSUPPORTED",
                "proofCheckpoint",
                "named checkpoints require a file-backed database",
            )
        })?;
        crate::proof_checkpoint::validate_checkpoint_request(request)?;
        // Initialize the stream before pinning. It is part of the compared
        // checkpoint header and cannot be minted after the source scan.
        let _ = self.data_version_stream()?;
        self.ensure_checkpoint_erasure_infra()?;
        crate::proof_checkpoint::create_named_checkpoint(
            &self.conn,
            &source,
            &self.schema,
            destination,
            request,
            cut_at,
        )
    }

    #[cfg(test)]
    pub(super) fn create_named_checkpoint_at_cut_for_test(
        &mut self,
        destination: Option<&Path>,
        request: &crate::proof_checkpoint::NamedCheckpointRequestV1,
        cut_at: crate::proof_checkpoint::CheckpointPublicationCut,
    ) -> SnapbackResult<crate::proof_checkpoint::NamedCheckpointReceiptV1> {
        self.create_named_checkpoint_with_cut(destination, request, Some(cut_at))
    }

    pub(super) fn inspect_named_checkpoint(
        &self,
        checkpoint_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<crate::proof_checkpoint::NamedCheckpointReceiptV1> {
        crate::proof_checkpoint::inspect_checkpoint(&self.conn, checkpoint_id, now_ms)
    }

    pub(super) fn erase_named_checkpoint(
        &self,
        checkpoint_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<crate::proof_checkpoint::CheckpointRegistryRecordV1> {
        crate::proof_checkpoint::erase_checkpoint(&self.conn, checkpoint_id, now_ms)
    }

    /// Deliberate authenticated protected-record erasure command. This is not
    /// an alias for `BufferedWrite::Delete`: the unforgeable authority carrier
    /// and retry-bound operation identity let the proof/checkpoint subsystem
    /// atomically own canonical deletion, retained-detail erasure, registry
    /// invalidation, and resumable physical-copy obligations.
    ///
    /// @ref LLP 0165#protected-deletion-authority-audit--2026-08-04 — one
    /// product command owns the complete protected-erasure boundary.
    pub(super) fn erase_protected_record(
        &self,
        request: &crate::proof_checkpoint::ProtectedRecordErasureRequestV1,
    ) -> SnapbackResult<crate::proof_checkpoint::ProtectedRecordErasureReceiptV1> {
        crate::proof_checkpoint::validate_protected_record_erasure_request(&self.schema, request)?;
        self.ensure_checkpoint_erasure_infra()?;
        crate::proof_checkpoint::erase_protected_record(&self.conn, &self.schema, request)
    }

    /// Invalidate and destroy every registered materialized checkpoint copy
    /// that could retain a protected record. Retrying `operation_id` resumes
    /// explicit unreachable/crash obligations instead of re-enumerating a
    /// weaker inventory.
    pub(super) fn erase_protected_record_checkpoint_copies(
        &self,
        qualified_table: &str,
        row_id: &str,
        operation_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<crate::proof_checkpoint::ProtectedRecordCheckpointErasureReceiptV1> {
        crate::proof_checkpoint::validate_checkpoint_copy_erasure_request(
            qualified_table,
            row_id,
            operation_id,
            now_ms,
        )?;
        self.ensure_checkpoint_erasure_infra()?;
        crate::proof_checkpoint::erase_protected_record_checkpoint_copies(
            &self.conn,
            qualified_table,
            row_id,
            operation_id,
            now_ms,
        )
    }

    pub(super) fn recover_named_checkpoint(
        &self,
        checkpoint_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<crate::proof_checkpoint::CheckpointRegistryRecordV1> {
        crate::proof_checkpoint::recover_checkpoint(&self.conn, checkpoint_id, now_ms)
    }

    fn ensure_checkpoint_erasure_infra(&self) -> SnapbackResult<()> {
        let _schema_maintenance = self.writer_authority.enter_internal_schema_maintenance()?;
        crate::proof_checkpoint::ensure_checkpoint_erasure_infra(&self.conn)
    }
}

/// Narrow typed access to named-checkpoint and protected-record operations.
///
/// @ref LLP 0225#1-ownership-map — storage callers enter the kernel
/// through typed operations instead of the wide `LocalDatabase` surface.
pub struct CheckpointsKernel<'a> {
    db: &'a mut LocalDatabase,
}

impl<'a> CheckpointsKernel<'a> {
    pub(super) fn new(db: &'a mut LocalDatabase) -> Self {
        Self { db }
    }

    pub fn create_named_checkpoint(
        &mut self,
        destination: Option<&Path>,
        request: &crate::proof_checkpoint::NamedCheckpointRequestV1,
    ) -> SnapbackResult<crate::proof_checkpoint::NamedCheckpointReceiptV1> {
        self.db.create_named_checkpoint(destination, request)
    }

    #[cfg(test)]
    pub fn create_named_checkpoint_at_cut_for_test(
        &mut self,
        destination: Option<&Path>,
        request: &crate::proof_checkpoint::NamedCheckpointRequestV1,
        cut_at: crate::proof_checkpoint::CheckpointPublicationCut,
    ) -> SnapbackResult<crate::proof_checkpoint::NamedCheckpointReceiptV1> {
        self.db
            .create_named_checkpoint_at_cut_for_test(destination, request, cut_at)
    }

    pub fn inspect_named_checkpoint(
        &self,
        checkpoint_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<crate::proof_checkpoint::NamedCheckpointReceiptV1> {
        self.db.inspect_named_checkpoint(checkpoint_id, now_ms)
    }

    pub fn erase_named_checkpoint(
        &self,
        checkpoint_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<crate::proof_checkpoint::CheckpointRegistryRecordV1> {
        self.db.erase_named_checkpoint(checkpoint_id, now_ms)
    }

    pub fn erase_protected_record(
        &self,
        request: &crate::proof_checkpoint::ProtectedRecordErasureRequestV1,
    ) -> SnapbackResult<crate::proof_checkpoint::ProtectedRecordErasureReceiptV1> {
        self.db.erase_protected_record(request)
    }

    pub fn erase_protected_record_checkpoint_copies(
        &self,
        qualified_table: &str,
        row_id: &str,
        operation_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<crate::proof_checkpoint::ProtectedRecordCheckpointErasureReceiptV1> {
        self.db.erase_protected_record_checkpoint_copies(
            qualified_table,
            row_id,
            operation_id,
            now_ms,
        )
    }

    pub fn recover_named_checkpoint(
        &self,
        checkpoint_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<crate::proof_checkpoint::CheckpointRegistryRecordV1> {
        self.db.recover_named_checkpoint(checkpoint_id, now_ms)
    }
}

/// Shared-borrow checkpoint operations for callers holding `&LocalDatabase`.
pub struct CheckpointsReadKernel<'a> {
    db: &'a LocalDatabase,
}

impl<'a> CheckpointsReadKernel<'a> {
    pub(super) fn new(db: &'a LocalDatabase) -> Self {
        Self { db }
    }

    pub fn inspect_named_checkpoint(
        &self,
        checkpoint_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<crate::proof_checkpoint::NamedCheckpointReceiptV1> {
        self.db.inspect_named_checkpoint(checkpoint_id, now_ms)
    }

    pub fn erase_named_checkpoint(
        &self,
        checkpoint_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<crate::proof_checkpoint::CheckpointRegistryRecordV1> {
        self.db.erase_named_checkpoint(checkpoint_id, now_ms)
    }

    pub fn erase_protected_record(
        &self,
        request: &crate::proof_checkpoint::ProtectedRecordErasureRequestV1,
    ) -> SnapbackResult<crate::proof_checkpoint::ProtectedRecordErasureReceiptV1> {
        self.db.erase_protected_record(request)
    }

    pub fn erase_protected_record_checkpoint_copies(
        &self,
        qualified_table: &str,
        row_id: &str,
        operation_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<crate::proof_checkpoint::ProtectedRecordCheckpointErasureReceiptV1> {
        self.db.erase_protected_record_checkpoint_copies(
            qualified_table,
            row_id,
            operation_id,
            now_ms,
        )
    }

    pub fn recover_named_checkpoint(
        &self,
        checkpoint_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<crate::proof_checkpoint::CheckpointRegistryRecordV1> {
        self.db.recover_named_checkpoint(checkpoint_id, now_ms)
    }
}
