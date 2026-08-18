use super::*;

impl LocalDatabase {
    pub(super) fn derived_fork(&self) -> Option<&crate::instance_fork::DerivedForkRuntime> {
        self.derived_fork.as_ref()
    }

    pub(super) fn in_app_branch(&self) -> Option<&crate::fork_promotion::InAppBranchRuntime> {
        self.in_app_branch.as_ref()
    }

    pub(super) fn create_managed_in_app_branch(
        &mut self,
        request: &crate::fork_promotion::InAppBranchCreateV1,
    ) -> SnapbackResult<crate::fork_promotion::ManagedInAppBranchReceiptV1> {
        let path = self.path.clone().ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_BRANCH_FILE_CUSTODY_REQUIRED",
                "storage",
                "managed in-app branches require a file-backed canonical database",
            )
        })?;
        if self.derived_fork.is_some() || self.in_app_branch.is_some() {
            return Err(SnapbackError::error(
                "SNAPBACK_BRANCH_NESTING_UNSUPPORTED",
                "storage",
                "a fork or branch cannot create another managed in-app branch",
            ));
        }
        crate::fork_promotion::create_managed_in_app_branch(&mut self.conn, &path, request)
    }

    pub(super) fn list_managed_in_app_branches(
        &self,
        now_ms: i64,
    ) -> SnapbackResult<Vec<crate::fork_promotion::ManagedInAppBranchReceiptV1>> {
        let path = self.path.as_deref().ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_BRANCH_FILE_CUSTODY_REQUIRED",
                "storage",
                "managed in-app branches require a file-backed canonical database",
            )
        })?;
        crate::fork_promotion::list_managed_in_app_branches(&self.conn, path, now_ms)
    }

    pub(super) fn inspect_managed_in_app_branch(
        &self,
        branch_id: &crate::branches::BranchId,
        now_ms: i64,
    ) -> SnapbackResult<crate::fork_promotion::ManagedInAppBranchReceiptV1> {
        let path = self.path.as_deref().ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_BRANCH_FILE_CUSTODY_REQUIRED",
                "storage",
                "managed in-app branches require a file-backed canonical database",
            )
        })?;
        crate::fork_promotion::inspect_managed_in_app_branch(&self.conn, path, branch_id, now_ms)
    }

    pub(super) fn managed_in_app_branch_path(
        &self,
        branch_id: &crate::branches::BranchId,
        now_ms: i64,
    ) -> SnapbackResult<PathBuf> {
        let path = self.path.as_deref().ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_BRANCH_FILE_CUSTODY_REQUIRED",
                "storage",
                "managed in-app branches require a file-backed canonical database",
            )
        })?;
        crate::fork_promotion::managed_in_app_branch_path(&self.conn, path, branch_id, now_ms)
    }

    pub(super) fn branch_operation_retry(
        &self,
        branch_id: &crate::branches::BranchId,
        draft: &crate::fork_promotion::BranchOperationDraftV1,
    ) -> SnapbackResult<Option<crate::fork_promotion::BranchOperationV1>> {
        crate::fork_promotion::branch_operation_retry(&self.conn, branch_id, draft)
    }

    pub(super) fn branch_operation_log(
        &self,
        branch_id: &crate::branches::BranchId,
    ) -> SnapbackResult<Vec<crate::fork_promotion::BranchOperationV1>> {
        crate::fork_promotion::branch_operation_log(&self.conn, branch_id)
    }

    #[cfg(any(test, feature = "test-support"))]
    pub(super) fn captured_effect_intents(
        &self,
        branch_id: &crate::branches::BranchId,
    ) -> SnapbackResult<Vec<crate::fork_promotion::CapturedEffectIntentV1>> {
        crate::fork_promotion::captured_effect_intents(&self.conn, branch_id)
    }

    pub(super) fn inspect_local_in_app_branch(
        &self,
        branch_id: &crate::branches::BranchId,
    ) -> SnapbackResult<crate::fork_promotion::InAppBranchReceiptV1> {
        crate::fork_promotion::inspect_in_app_branch(&self.conn, branch_id)
    }

    pub(super) fn execute_branch_operation(
        &mut self,
        branch_id: &crate::branches::BranchId,
        draft: &crate::fork_promotion::BranchOperationDraftV1,
        now_ms: i64,
        result: Value,
    ) -> SnapbackResult<crate::fork_promotion::BranchOperationV1> {
        crate::fork_promotion::execute_receipt_only_branch_operation(
            &mut self.conn,
            branch_id,
            draft,
            result,
            now_ms,
        )
    }

    pub(super) fn finalize_captured_effect_operation(
        &mut self,
        context: &crate::fork_promotion::BranchEffectExecutionContextV1,
        result: Value,
        diagnostic_code: Option<&str>,
    ) -> SnapbackResult<Option<crate::fork_promotion::BranchOperationV1>> {
        crate::fork_promotion::finalize_captured_effect_operation(
            &mut self.conn,
            context,
            result,
            diagnostic_code,
        )
    }

    pub(super) fn reap_expired_managed_in_app_branches(
        &mut self,
        now_ms: i64,
    ) -> SnapbackResult<Vec<crate::fork_promotion::ManagedInAppBranchReceiptV1>> {
        let path = self.path.clone().ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_BRANCH_FILE_CUSTODY_REQUIRED",
                "storage",
                "managed in-app branches require a file-backed canonical database",
            )
        })?;
        crate::fork_promotion::reap_expired_managed_in_app_branches(&mut self.conn, &path, now_ms)
    }

    pub(super) fn drop_managed_in_app_branch(
        &mut self,
        branch_id: &crate::branches::BranchId,
        now_ms: i64,
    ) -> SnapbackResult<crate::fork_promotion::ManagedInAppBranchReceiptV1> {
        let path = self.path.clone().ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_BRANCH_FILE_CUSTODY_REQUIRED",
                "storage",
                "managed in-app branches require a file-backed canonical database",
            )
        })?;
        crate::fork_promotion::drop_managed_in_app_branch(&mut self.conn, &path, branch_id, now_ms)
    }

    /// Managed in-app branch mutation carrier. The branch operation is
    /// derived and inserted inside the same transaction as the app commit.
    pub(super) fn execute_branch_mutation_guarded<G, BeforeCommit>(
        &mut self,
        plan: &MutationPlan,
        input: &HandlerInput,
        branch_operation: &crate::fork_promotion::BranchMutationCommitV1,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<MutationCommit>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        require_covered_mutation_identity_for_lane(
            &self.conn,
            CoveredMutationLaneV1::Ordinary,
            None,
        )?;
        Ok(self
            .execute_mutation_plan_with_lifecycle_and_settlement_time(
                write_authority::LocalWriterLaneV1::OrdinaryHostPlan,
                plan,
                input,
                true,
                None,
                None,
                None,
                Some(branch_operation),
                &|| Ok(()),
                before_commit,
            )?
            .commit)
    }

    pub(super) fn commit_branch_buffered_writes_guarded<G, BeforeCommit>(
        &mut self,
        input: &HandlerInput,
        payload: BufferedCommitPayload,
        branch_operation: &crate::fork_promotion::BranchMutationCommitV1,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<MutationCommit>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.commit_buffered_writes_for_lane(
            input,
            payload,
            None,
            None,
            CoveredMutationLaneV1::Ordinary,
            Some(branch_operation),
            || Ok(()),
            before_commit,
        )
    }
}

/// Narrow typed access to branch/fork lifecycle and atomic branch-commit operations.
///
/// @ref LLP 0225#1-ownership-map — branch callers enter the storage
/// kernel through typed operations instead of the wide `LocalDatabase` surface.
pub struct BranchOpsKernel<'a> {
    db: &'a mut LocalDatabase,
}

impl<'a> BranchOpsKernel<'a> {
    pub(super) fn new(db: &'a mut LocalDatabase) -> Self {
        Self { db }
    }

    pub fn derived_fork(&self) -> Option<&crate::instance_fork::DerivedForkRuntime> {
        self.db.derived_fork()
    }

    pub fn create_managed_in_app_branch(
        &mut self,
        request: &crate::fork_promotion::InAppBranchCreateV1,
    ) -> SnapbackResult<crate::fork_promotion::ManagedInAppBranchReceiptV1> {
        self.db.create_managed_in_app_branch(request)
    }

    pub fn list_managed_in_app_branches(
        &self,
        now_ms: i64,
    ) -> SnapbackResult<Vec<crate::fork_promotion::ManagedInAppBranchReceiptV1>> {
        self.db.list_managed_in_app_branches(now_ms)
    }

    pub fn inspect_managed_in_app_branch(
        &self,
        branch_id: &crate::branches::BranchId,
        now_ms: i64,
    ) -> SnapbackResult<crate::fork_promotion::ManagedInAppBranchReceiptV1> {
        self.db.inspect_managed_in_app_branch(branch_id, now_ms)
    }

    pub fn managed_in_app_branch_path(
        &self,
        branch_id: &crate::branches::BranchId,
        now_ms: i64,
    ) -> SnapbackResult<PathBuf> {
        self.db.managed_in_app_branch_path(branch_id, now_ms)
    }

    pub fn branch_operation_retry(
        &self,
        branch_id: &crate::branches::BranchId,
        draft: &crate::fork_promotion::BranchOperationDraftV1,
    ) -> SnapbackResult<Option<crate::fork_promotion::BranchOperationV1>> {
        self.db.branch_operation_retry(branch_id, draft)
    }

    pub fn branch_operation_log(
        &self,
        branch_id: &crate::branches::BranchId,
    ) -> SnapbackResult<Vec<crate::fork_promotion::BranchOperationV1>> {
        self.db.branch_operation_log(branch_id)
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn captured_effect_intents(
        &self,
        branch_id: &crate::branches::BranchId,
    ) -> SnapbackResult<Vec<crate::fork_promotion::CapturedEffectIntentV1>> {
        self.db.captured_effect_intents(branch_id)
    }

    pub fn inspect_local_in_app_branch(
        &self,
        branch_id: &crate::branches::BranchId,
    ) -> SnapbackResult<crate::fork_promotion::InAppBranchReceiptV1> {
        self.db.inspect_local_in_app_branch(branch_id)
    }

    pub fn execute_branch_operation(
        &mut self,
        branch_id: &crate::branches::BranchId,
        draft: &crate::fork_promotion::BranchOperationDraftV1,
        now_ms: i64,
        result: Value,
    ) -> SnapbackResult<crate::fork_promotion::BranchOperationV1> {
        self.db
            .execute_branch_operation(branch_id, draft, now_ms, result)
    }

    pub fn finalize_captured_effect_operation(
        &mut self,
        context: &crate::fork_promotion::BranchEffectExecutionContextV1,
        result: Value,
        diagnostic_code: Option<&str>,
    ) -> SnapbackResult<Option<crate::fork_promotion::BranchOperationV1>> {
        self.db
            .finalize_captured_effect_operation(context, result, diagnostic_code)
    }

    pub fn reap_expired_managed_in_app_branches(
        &mut self,
        now_ms: i64,
    ) -> SnapbackResult<Vec<crate::fork_promotion::ManagedInAppBranchReceiptV1>> {
        self.db.reap_expired_managed_in_app_branches(now_ms)
    }

    pub fn drop_managed_in_app_branch(
        &mut self,
        branch_id: &crate::branches::BranchId,
        now_ms: i64,
    ) -> SnapbackResult<crate::fork_promotion::ManagedInAppBranchReceiptV1> {
        self.db.drop_managed_in_app_branch(branch_id, now_ms)
    }

    pub fn execute_branch_mutation_guarded<G, BeforeCommit>(
        &mut self,
        plan: &MutationPlan,
        input: &HandlerInput,
        branch_operation: &crate::fork_promotion::BranchMutationCommitV1,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<MutationCommit>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.db
            .execute_branch_mutation_guarded(plan, input, branch_operation, before_commit)
    }

    pub fn commit_branch_buffered_writes_guarded<G, BeforeCommit>(
        &mut self,
        input: &HandlerInput,
        payload: BufferedCommitPayload,
        branch_operation: &crate::fork_promotion::BranchMutationCommitV1,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<MutationCommit>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.db.commit_branch_buffered_writes_guarded(
            input,
            payload,
            branch_operation,
            before_commit,
        )
    }
}

/// Shared-borrow branch/fork lifecycle operations for callers holding `&LocalDatabase`.
pub struct BranchOpsReadKernel<'a> {
    db: &'a LocalDatabase,
}

impl<'a> BranchOpsReadKernel<'a> {
    pub(super) fn new(db: &'a LocalDatabase) -> Self {
        Self { db }
    }

    pub fn derived_fork(&self) -> Option<&'a crate::instance_fork::DerivedForkRuntime> {
        self.db.derived_fork()
    }

    pub fn in_app_branch(&self) -> Option<&'a crate::fork_promotion::InAppBranchRuntime> {
        self.db.in_app_branch()
    }

    pub fn list_managed_in_app_branches(
        &self,
        now_ms: i64,
    ) -> SnapbackResult<Vec<crate::fork_promotion::ManagedInAppBranchReceiptV1>> {
        self.db.list_managed_in_app_branches(now_ms)
    }

    pub fn inspect_managed_in_app_branch(
        &self,
        branch_id: &crate::branches::BranchId,
        now_ms: i64,
    ) -> SnapbackResult<crate::fork_promotion::ManagedInAppBranchReceiptV1> {
        self.db.inspect_managed_in_app_branch(branch_id, now_ms)
    }

    pub fn managed_in_app_branch_path(
        &self,
        branch_id: &crate::branches::BranchId,
        now_ms: i64,
    ) -> SnapbackResult<PathBuf> {
        self.db.managed_in_app_branch_path(branch_id, now_ms)
    }

    pub fn branch_operation_retry(
        &self,
        branch_id: &crate::branches::BranchId,
        draft: &crate::fork_promotion::BranchOperationDraftV1,
    ) -> SnapbackResult<Option<crate::fork_promotion::BranchOperationV1>> {
        self.db.branch_operation_retry(branch_id, draft)
    }

    pub fn branch_operation_log(
        &self,
        branch_id: &crate::branches::BranchId,
    ) -> SnapbackResult<Vec<crate::fork_promotion::BranchOperationV1>> {
        self.db.branch_operation_log(branch_id)
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn captured_effect_intents(
        &self,
        branch_id: &crate::branches::BranchId,
    ) -> SnapbackResult<Vec<crate::fork_promotion::CapturedEffectIntentV1>> {
        self.db.captured_effect_intents(branch_id)
    }

    pub fn inspect_local_in_app_branch(
        &self,
        branch_id: &crate::branches::BranchId,
    ) -> SnapbackResult<crate::fork_promotion::InAppBranchReceiptV1> {
        self.db.inspect_local_in_app_branch(branch_id)
    }
}
