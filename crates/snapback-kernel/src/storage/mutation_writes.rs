use super::*;

impl LocalDatabase {
    pub(super) fn execute_mutation(
        &mut self,
        plan: &MutationPlan,
        input: &HandlerInput,
    ) -> SnapbackResult<MutationCommit> {
        Ok(self
            .execute_mutation_plan(plan, input, true, None, None)?
            .commit)
    }

    /// Execute a host plan with lifecycle checks throughout its finite step
    /// loops, then acquire a caller-owned guard only for the final SQLite
    /// commit. Detached actions use this to keep untrusted/data-dependent plan
    /// execution outside their abandonment gate while still linearizing the
    /// durable commit against the public watchdog.
    pub(super) fn execute_mutation_guarded<G, Check, BeforeCommit>(
        &mut self,
        plan: &MutationPlan,
        input: &HandlerInput,
        check_live: Check,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<MutationCommit>
    where
        Check: Fn() -> SnapbackResult<()>,
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
                None,
                &check_live,
                before_commit,
            )?
            .commit)
    }

    pub(super) fn execute_mutation_idempotent(
        &mut self,
        plan: &MutationPlan,
        input: &HandlerInput,
        identity: &ClientMutationIdentity,
    ) -> SnapbackResult<MutationCommit> {
        require_covered_mutation_identity_for_lane(
            &self.conn,
            CoveredMutationLaneV1::Ordinary,
            Some(identity),
        )?;
        if let Some(commit) = self.replayed_mutation_commit(identity)? {
            return Ok(commit);
        }
        let attempted = self.execute_mutation_plan(plan, input, true, Some(identity), None);
        match attempted {
            Ok(execution) => Ok(execution.commit),
            Err(error) => self.replay_after_concurrent_settlement(identity, error),
        }
    }

    pub(super) fn execute_mutation_idempotent_guarded<G, BeforeCommit>(
        &mut self,
        plan: &MutationPlan,
        input: &HandlerInput,
        identity: &ClientMutationIdentity,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<MutationCommit>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        require_covered_mutation_identity_for_lane(
            &self.conn,
            CoveredMutationLaneV1::Ordinary,
            Some(identity),
        )?;
        if let Some(commit) = self.replayed_mutation_commit(identity)? {
            return Ok(commit);
        }
        let attempted = self.execute_mutation_plan_with_lifecycle_and_settlement_time(
            write_authority::LocalWriterLaneV1::OrdinaryHostPlan,
            plan,
            input,
            true,
            Some(identity),
            None,
            None,
            None,
            &|| Ok(()),
            before_commit,
        );
        match attempted {
            Ok(execution) => Ok(execution.commit),
            Err(error) => self.replay_after_concurrent_settlement(identity, error),
        }
    }

    pub(super) fn execute_host_mutation_guarded<G, Check, BeforeCommit>(
        &mut self,
        plan: &MutationPlan,
        input: &HandlerInput,
        identity: Option<&ClientMutationIdentity>,
        check_live: Check,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<MutationCommit>
    where
        Check: Fn() -> SnapbackResult<()>,
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.execute_host_mutation_guarded_with_settlement_time(
            plan,
            input,
            identity,
            None,
            check_live,
            before_commit,
        )
    }

    pub(super) fn execute_host_mutation_guarded_with_settlement_time<G, Check, BeforeCommit>(
        &mut self,
        plan: &MutationPlan,
        input: &HandlerInput,
        identity: Option<&ClientMutationIdentity>,
        policy: Option<&SettlementTimePolicy>,
        check_live: Check,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<MutationCommit>
    where
        Check: Fn() -> SnapbackResult<()>,
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        require_covered_mutation_identity_for_lane(
            &self.conn,
            CoveredMutationLaneV1::HostChild,
            identity,
        )?;
        check_live()?;
        if let Some(identity) = identity
            && let Some(commit) = self.replayed_mutation_commit(identity)?
        {
            return Ok(commit);
        }
        Ok(self
            .execute_mutation_plan_with_lifecycle_and_settlement_time(
                write_authority::LocalWriterLaneV1::HostChildHostPlan,
                plan,
                input,
                true,
                identity,
                None,
                policy,
                None,
                &check_live,
                before_commit,
            )?
            .commit)
    }

    /// Dry-run an IR mutation (LLP 0051 D8): the identical step loop, binding
    /// environment, in-transaction `Get` reads, and read-set validation as
    /// `execute_mutation` — then the transaction is rolled back instead of
    /// committed. Fidelity is by construction: this *is* the commit path with
    /// the final `COMMIT` swapped for `ROLLBACK`, so the answer is evidence,
    /// not a lower-fidelity evaluator (LLP 0024 §Dry-Run rule).
    ///
    /// @ref LLP 0051#d8-the-agent-surface-dry-run-becomes-cheap-and-trustworthy —
    ///   plan evaluation against a snapshot with a recorded ledger;
    ///   execute-and-discard on the buffered substrate.
    pub(super) fn dry_run_mutation(
        &mut self,
        plan: &MutationPlan,
        input: &HandlerInput,
    ) -> SnapbackResult<MutationPlanExecution> {
        self.execute_mutation_plan(plan, input, false, None, None)
    }

    pub(super) fn dry_run_mutation_with_settlement_time(
        &mut self,
        plan: &MutationPlan,
        input: &HandlerInput,
        policy: Option<&SettlementTimePolicy>,
    ) -> SnapbackResult<MutationPlanExecution> {
        self.execute_mutation_plan(plan, input, false, None, policy)
    }

    pub(super) fn execute_mutation_guarded_with_settlement_time<G, Check, BeforeCommit>(
        &mut self,
        plan: &MutationPlan,
        input: &HandlerInput,
        policy: Option<&SettlementTimePolicy>,
        check_live: Check,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<MutationCommit>
    where
        Check: Fn() -> SnapbackResult<()>,
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
                policy,
                None,
                &check_live,
                before_commit,
            )?
            .commit)
    }

    pub(super) fn execute_mutation_idempotent_guarded_with_settlement_time<G, BeforeCommit>(
        &mut self,
        plan: &MutationPlan,
        input: &HandlerInput,
        identity: &ClientMutationIdentity,
        policy: Option<&SettlementTimePolicy>,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<MutationCommit>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        require_covered_mutation_identity_for_lane(
            &self.conn,
            CoveredMutationLaneV1::Ordinary,
            Some(identity),
        )?;
        if let Some(commit) = self.replayed_mutation_commit(identity)? {
            return Ok(commit);
        }
        let attempted = self.execute_mutation_plan_with_lifecycle_and_settlement_time(
            write_authority::LocalWriterLaneV1::OrdinaryHostPlan,
            plan,
            input,
            true,
            Some(identity),
            None,
            policy,
            None,
            &|| Ok(()),
            before_commit,
        );
        match attempted {
            Ok(execution) => Ok(execution.commit),
            Err(error) => self.replay_after_concurrent_settlement(identity, error),
        }
    }

    pub(super) fn execute_media_command_mutation_idempotent_guarded_with_settlement_time<
        G,
        BeforeCommit,
    >(
        &mut self,
        plan: &MutationPlan,
        input: &HandlerInput,
        identity: &ClientMutationIdentity,
        media_command: &crate::manifest::ResolvedMediaCommandV1,
        policy: Option<&SettlementTimePolicy>,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<MutationCommit>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        require_covered_mutation_identity_for_lane(
            &self.conn,
            CoveredMutationLaneV1::Ordinary,
            Some(identity),
        )?;
        if let Some(commit) = self.replayed_mutation_commit(identity)? {
            return Ok(commit);
        }
        let attempted = self.execute_mutation_plan_with_lifecycle_and_settlement_time(
            write_authority::LocalWriterLaneV1::OrdinaryHostPlan,
            plan,
            input,
            true,
            Some(identity),
            Some(media_command),
            policy,
            None,
            &|| Ok(()),
            before_commit,
        );
        match attempted {
            Ok(execution) => Ok(execution.commit),
            Err(error) => self.replay_after_concurrent_settlement(identity, error),
        }
    }

    pub(super) fn dry_run_media_command_mutation_with_settlement_time(
        &mut self,
        plan: &MutationPlan,
        input: &HandlerInput,
        identity: &ClientMutationIdentity,
        media_command: &crate::manifest::ResolvedMediaCommandV1,
        policy: Option<&SettlementTimePolicy>,
    ) -> SnapbackResult<MutationPlanExecution> {
        self.execute_mutation_plan_with_lifecycle_and_settlement_time(
            write_authority::LocalWriterLaneV1::DryRun,
            plan,
            input,
            false,
            Some(identity),
            Some(media_command),
            policy,
            None,
            &|| Ok(()),
            || Ok(()),
        )
    }

    fn execute_mutation_plan(
        &mut self,
        plan: &MutationPlan,
        input: &HandlerInput,
        apply: bool,
        identity: Option<&ClientMutationIdentity>,
        settlement_time: Option<&SettlementTimePolicy>,
    ) -> SnapbackResult<MutationPlanExecution> {
        if apply {
            require_covered_mutation_identity_for_lane(
                &self.conn,
                CoveredMutationLaneV1::Ordinary,
                identity,
            )?;
        }
        self.execute_mutation_plan_with_lifecycle_and_settlement_time(
            if apply {
                write_authority::LocalWriterLaneV1::OrdinaryHostPlan
            } else {
                write_authority::LocalWriterLaneV1::DryRun
            },
            plan,
            input,
            apply,
            identity,
            None,
            settlement_time,
            None,
            &|| Ok(()),
            || Ok(()),
        )
    }

    pub(super) fn commit_buffered_writes(
        &mut self,
        input: &HandlerInput,
        writes: Vec<BufferedWrite>,
        read_dependencies: Vec<CapturedReadDependency>,
        result: Value,
    ) -> SnapbackResult<MutationCommit> {
        self.apply_buffered_writes(
            input,
            writes,
            read_dependencies,
            result,
            BufferedCommitOptions {
                ctx_ledger: None,
                apply: true,
                identity: None,
                media_command: None,
                branch_operation: None,
            },
        )
    }

    /// Detached-action buffered commit with the same lifecycle split as
    /// [`Self::execute_mutation_guarded`]: build and validate the transaction
    /// under caller checks, then hold the caller's guard only across COMMIT.
    pub(super) fn commit_buffered_writes_idempotent_guarded<G, Check, BeforeCommit>(
        &mut self,
        input: &HandlerInput,
        payload: BufferedCommitPayload,
        identity: Option<&ClientMutationIdentity>,
        check_live: Check,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<MutationCommit>
    where
        Check: Fn() -> SnapbackResult<()>,
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.commit_buffered_writes_for_lane(
            input,
            payload,
            identity,
            None,
            CoveredMutationLaneV1::Ordinary,
            None,
            check_live,
            before_commit,
        )
    }

    pub(super) fn commit_media_command_buffered_writes_idempotent_guarded<G, Check, BeforeCommit>(
        &mut self,
        input: &HandlerInput,
        payload: BufferedCommitPayload,
        identity: Option<&ClientMutationIdentity>,
        media_command: &crate::manifest::ResolvedMediaCommandV1,
        check_live: Check,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<MutationCommit>
    where
        Check: Fn() -> SnapbackResult<()>,
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.commit_buffered_writes_for_lane(
            input,
            payload,
            identity,
            Some(media_command),
            CoveredMutationLaneV1::Ordinary,
            None,
            check_live,
            before_commit,
        )
    }

    pub(super) fn dry_run_media_command_buffered_payload(
        &mut self,
        input: &HandlerInput,
        payload: &BufferedCommitPayload,
        identity: &ClientMutationIdentity,
        media_command: &crate::manifest::ResolvedMediaCommandV1,
    ) -> SnapbackResult<MutationCommit> {
        let media_projection = match (
            payload.media_projection_proof.as_ref(),
            payload.expected_media_projection_binding.as_ref(),
        ) {
            (Some(proof), Some(expected)) => {
                Some(MediaProjectionProofAccess::Borrowed { proof, expected })
            }
            (None, None) => None,
            _ => return Err(media_projection_unprovenanced()),
        };
        self.apply_buffered_writes_with_lifecycle_gated(
            write_authority::LocalWriterLaneV1::DryRun,
            input,
            BufferedEffects {
                writes: payload.writes.clone(),
                sequence_allocations: payload.sequence_allocations.clone(),
                membership_plans: payload.membership_plans.clone(),
                read_dependencies: payload.read_dependencies.clone(),
                result: payload.result.clone(),
                job_enqueues: payload.job_enqueues.clone(),
                job_producer: payload.job_producer.clone(),
                asset_admissions: payload.asset_admissions.clone(),
                asset_grant_ops: payload.asset_grant_ops.clone(),
                media_projection,
            },
            BufferedCommitOptions {
                ctx_ledger: Some(payload.ctx_ledger.clone()),
                apply: false,
                identity: Some(identity),
                media_command: Some(media_command),
                branch_operation: None,
            },
            MembershipCommitAuthority::deny(),
            &|| Ok(()),
            || Ok(()),
        )
    }

    pub(super) fn commit_buffered_host_writes_guarded<G, Check, BeforeCommit>(
        &mut self,
        input: &HandlerInput,
        payload: BufferedCommitPayload,
        identity: Option<&ClientMutationIdentity>,
        check_live: Check,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<MutationCommit>
    where
        Check: Fn() -> SnapbackResult<()>,
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.commit_buffered_writes_for_lane(
            input,
            payload,
            identity,
            None,
            CoveredMutationLaneV1::HostChild,
            None,
            check_live,
            before_commit,
        )
    }

    /// Dry-run the buffered-write commit (LLP 0051 D8): identical read-set
    /// validation and write application as `commit_buffered_writes`, rolled
    /// back instead of committed. The JS-tier half of execute-and-discard —
    /// the handler already ran against the buffered ctx; this answers what
    /// its writes would do without keeping them.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn dry_run_buffered_writes(
        &mut self,
        input: &HandlerInput,
        writes: Vec<BufferedWrite>,
        sequence_allocations: Vec<SequenceAllocationFact>,
        membership_plans: Vec<AuthorizedMembershipPlan>,
        read_dependencies: Vec<CapturedReadDependency>,
        result: Value,
        ctx_ledger: CtxAnswerLedger,
        asset_admissions: Vec<crate::assets::AssetAttachmentAdmission>,
    ) -> SnapbackResult<MutationCommit> {
        self.dry_run_buffered_writes_with_jobs(
            input,
            writes,
            sequence_allocations,
            membership_plans,
            read_dependencies,
            result,
            ctx_ledger,
            Vec::new(),
            None,
            asset_admissions,
            Vec::new(),
            None,
            None,
        )
    }

    /// Dry-run variant carrying buffered job enqueues: identical validation
    /// and insertion (LLP 0051 D8 fidelity — the rollback discards the job
    /// rows exactly as it discards app writes).
    #[allow(clippy::too_many_arguments)]
    pub(super) fn dry_run_buffered_writes_with_jobs(
        &mut self,
        input: &HandlerInput,
        writes: Vec<BufferedWrite>,
        sequence_allocations: Vec<SequenceAllocationFact>,
        membership_plans: Vec<AuthorizedMembershipPlan>,
        read_dependencies: Vec<CapturedReadDependency>,
        result: Value,
        ctx_ledger: CtxAnswerLedger,
        job_enqueues: Vec<crate::jobs::BufferedJobEnqueue>,
        job_producer: Option<crate::jobs::JobProducer>,
        // The preview must see the same admissions the commit will: a
        // handler-recorded `ctx.assets.attach` admission that is absent here
        // makes the staged preview refuse `SNAPBACK_ASSET_REF_UNVERIFIED`
        // even though the real commit would admit the write.
        asset_admissions: Vec<crate::assets::AssetAttachmentAdmission>,
        asset_grant_ops: Vec<crate::assets::BufferedAssetGrantOp>,
        media_projection_proof: Option<&crate::runtime::StagedMediaProjectionProofV1>,
        expected_media_projection_binding: Option<&crate::runtime::MediaProjectionProofBindingV1>,
    ) -> SnapbackResult<MutationCommit> {
        let media_projection = match (media_projection_proof, expected_media_projection_binding) {
            (Some(proof), Some(expected)) => {
                Some(MediaProjectionProofAccess::Borrowed { proof, expected })
            }
            (None, None) => None,
            _ => return Err(media_projection_unprovenanced()),
        };
        self.apply_buffered_writes_with_lifecycle_gated(
            write_authority::LocalWriterLaneV1::DryRun,
            input,
            BufferedEffects {
                writes,
                sequence_allocations,
                membership_plans,
                read_dependencies,
                result,
                job_enqueues,
                job_producer,
                asset_admissions,
                asset_grant_ops,
                media_projection,
            },
            BufferedCommitOptions {
                ctx_ledger: Some(ctx_ledger),
                apply: false,
                identity: None,
                media_command: None,
                branch_operation: None,
            },
            MembershipCommitAuthority::deny(),
            &|| Ok(()),
            || Ok(()),
        )
    }

    fn apply_buffered_writes(
        &mut self,
        input: &HandlerInput,
        writes: Vec<BufferedWrite>,
        read_dependencies: Vec<CapturedReadDependency>,
        result: Value,
        options: BufferedCommitOptions<'_>,
    ) -> SnapbackResult<MutationCommit> {
        self.apply_buffered_writes_with_lifecycle_gated(
            write_authority::LocalWriterLaneV1::OrdinaryIbexBuffered,
            input,
            BufferedEffects {
                writes,
                sequence_allocations: Vec::new(),
                membership_plans: Vec::new(),
                read_dependencies,
                result,
                job_enqueues: Vec::new(),
                job_producer: None,
                asset_admissions: Vec::new(),
                asset_grant_ops: Vec::new(),
                media_projection: None,
            },
            options,
            MembershipCommitAuthority::deny(),
            &|| Ok(()),
            || Ok(()),
        )
    }
}

/// Narrow typed access to the complete mutation write pipeline.
///
/// Guarded, idempotent, host-child, branch, settlement-time, buffered, job,
/// membership, asset, and dry-run variants deliberately share the same
/// transaction-owning helpers in the storage hub.
///
/// @ref LLP 0225#1-ownership-map — storage callers enter the kernel
/// through typed operations instead of the wide `LocalDatabase` surface.
pub struct MutationWritesKernel<'a> {
    db: &'a mut LocalDatabase,
}

impl<'a> MutationWritesKernel<'a> {
    pub(super) fn new(db: &'a mut LocalDatabase) -> Self {
        Self { db }
    }

    pub fn execute_mutation(
        &mut self,
        plan: &MutationPlan,
        input: &HandlerInput,
    ) -> SnapbackResult<MutationCommit> {
        self.db.execute_mutation(plan, input)
    }

    pub fn execute_mutation_guarded<G, Check, BeforeCommit>(
        &mut self,
        plan: &MutationPlan,
        input: &HandlerInput,
        check_live: Check,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<MutationCommit>
    where
        Check: Fn() -> SnapbackResult<()>,
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.db
            .execute_mutation_guarded(plan, input, check_live, before_commit)
    }

    pub fn execute_mutation_idempotent(
        &mut self,
        plan: &MutationPlan,
        input: &HandlerInput,
        identity: &ClientMutationIdentity,
    ) -> SnapbackResult<MutationCommit> {
        self.db.execute_mutation_idempotent(plan, input, identity)
    }

    pub fn execute_mutation_idempotent_guarded<G, BeforeCommit>(
        &mut self,
        plan: &MutationPlan,
        input: &HandlerInput,
        identity: &ClientMutationIdentity,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<MutationCommit>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.db
            .execute_mutation_idempotent_guarded(plan, input, identity, before_commit)
    }

    pub fn execute_host_mutation_guarded<G, Check, BeforeCommit>(
        &mut self,
        plan: &MutationPlan,
        input: &HandlerInput,
        identity: Option<&ClientMutationIdentity>,
        check_live: Check,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<MutationCommit>
    where
        Check: Fn() -> SnapbackResult<()>,
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.db
            .execute_host_mutation_guarded(plan, input, identity, check_live, before_commit)
    }

    pub fn execute_host_mutation_guarded_with_settlement_time<G, Check, BeforeCommit>(
        &mut self,
        plan: &MutationPlan,
        input: &HandlerInput,
        identity: Option<&ClientMutationIdentity>,
        policy: Option<&SettlementTimePolicy>,
        check_live: Check,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<MutationCommit>
    where
        Check: Fn() -> SnapbackResult<()>,
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.db.execute_host_mutation_guarded_with_settlement_time(
            plan,
            input,
            identity,
            policy,
            check_live,
            before_commit,
        )
    }

    pub fn dry_run_mutation(
        &mut self,
        plan: &MutationPlan,
        input: &HandlerInput,
    ) -> SnapbackResult<MutationPlanExecution> {
        self.db.dry_run_mutation(plan, input)
    }

    pub fn dry_run_mutation_with_settlement_time(
        &mut self,
        plan: &MutationPlan,
        input: &HandlerInput,
        policy: Option<&SettlementTimePolicy>,
    ) -> SnapbackResult<MutationPlanExecution> {
        self.db
            .dry_run_mutation_with_settlement_time(plan, input, policy)
    }

    pub fn execute_mutation_guarded_with_settlement_time<G, Check, BeforeCommit>(
        &mut self,
        plan: &MutationPlan,
        input: &HandlerInput,
        policy: Option<&SettlementTimePolicy>,
        check_live: Check,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<MutationCommit>
    where
        Check: Fn() -> SnapbackResult<()>,
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.db.execute_mutation_guarded_with_settlement_time(
            plan,
            input,
            policy,
            check_live,
            before_commit,
        )
    }

    pub fn execute_mutation_idempotent_guarded_with_settlement_time<G, BeforeCommit>(
        &mut self,
        plan: &MutationPlan,
        input: &HandlerInput,
        identity: &ClientMutationIdentity,
        policy: Option<&SettlementTimePolicy>,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<MutationCommit>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.db
            .execute_mutation_idempotent_guarded_with_settlement_time(
                plan,
                input,
                identity,
                policy,
                before_commit,
            )
    }

    pub fn execute_media_command_mutation_idempotent_guarded_with_settlement_time<
        G,
        BeforeCommit,
    >(
        &mut self,
        plan: &MutationPlan,
        input: &HandlerInput,
        identity: &ClientMutationIdentity,
        media_command: &crate::manifest::ResolvedMediaCommandV1,
        policy: Option<&SettlementTimePolicy>,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<MutationCommit>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.db
            .execute_media_command_mutation_idempotent_guarded_with_settlement_time(
                plan,
                input,
                identity,
                media_command,
                policy,
                before_commit,
            )
    }

    pub fn dry_run_media_command_mutation_with_settlement_time(
        &mut self,
        plan: &MutationPlan,
        input: &HandlerInput,
        identity: &ClientMutationIdentity,
        media_command: &crate::manifest::ResolvedMediaCommandV1,
        policy: Option<&SettlementTimePolicy>,
    ) -> SnapbackResult<MutationPlanExecution> {
        self.db.dry_run_media_command_mutation_with_settlement_time(
            plan,
            input,
            identity,
            media_command,
            policy,
        )
    }

    pub fn commit_buffered_writes(
        &mut self,
        input: &HandlerInput,
        writes: Vec<BufferedWrite>,
        read_dependencies: Vec<CapturedReadDependency>,
        result: Value,
    ) -> SnapbackResult<MutationCommit> {
        self.db
            .commit_buffered_writes(input, writes, read_dependencies, result)
    }

    pub fn commit_buffered_writes_idempotent_guarded<G, Check, BeforeCommit>(
        &mut self,
        input: &HandlerInput,
        payload: BufferedCommitPayload,
        identity: Option<&ClientMutationIdentity>,
        check_live: Check,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<MutationCommit>
    where
        Check: Fn() -> SnapbackResult<()>,
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.db.commit_buffered_writes_idempotent_guarded(
            input,
            payload,
            identity,
            check_live,
            before_commit,
        )
    }

    pub fn commit_media_command_buffered_writes_idempotent_guarded<G, Check, BeforeCommit>(
        &mut self,
        input: &HandlerInput,
        payload: BufferedCommitPayload,
        identity: Option<&ClientMutationIdentity>,
        media_command: &crate::manifest::ResolvedMediaCommandV1,
        check_live: Check,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<MutationCommit>
    where
        Check: Fn() -> SnapbackResult<()>,
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.db
            .commit_media_command_buffered_writes_idempotent_guarded(
                input,
                payload,
                identity,
                media_command,
                check_live,
                before_commit,
            )
    }

    pub fn dry_run_media_command_buffered_payload(
        &mut self,
        input: &HandlerInput,
        payload: &BufferedCommitPayload,
        identity: &ClientMutationIdentity,
        media_command: &crate::manifest::ResolvedMediaCommandV1,
    ) -> SnapbackResult<MutationCommit> {
        self.db
            .dry_run_media_command_buffered_payload(input, payload, identity, media_command)
    }

    pub fn commit_buffered_host_writes_guarded<G, Check, BeforeCommit>(
        &mut self,
        input: &HandlerInput,
        payload: BufferedCommitPayload,
        identity: Option<&ClientMutationIdentity>,
        check_live: Check,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<MutationCommit>
    where
        Check: Fn() -> SnapbackResult<()>,
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.db.commit_buffered_host_writes_guarded(
            input,
            payload,
            identity,
            check_live,
            before_commit,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn dry_run_buffered_writes(
        &mut self,
        input: &HandlerInput,
        writes: Vec<BufferedWrite>,
        sequence_allocations: Vec<SequenceAllocationFact>,
        membership_plans: Vec<AuthorizedMembershipPlan>,
        read_dependencies: Vec<CapturedReadDependency>,
        result: Value,
        ctx_ledger: CtxAnswerLedger,
        asset_admissions: Vec<crate::assets::AssetAttachmentAdmission>,
    ) -> SnapbackResult<MutationCommit> {
        self.db.dry_run_buffered_writes(
            input,
            writes,
            sequence_allocations,
            membership_plans,
            read_dependencies,
            result,
            ctx_ledger,
            asset_admissions,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn dry_run_buffered_writes_with_jobs(
        &mut self,
        input: &HandlerInput,
        writes: Vec<BufferedWrite>,
        sequence_allocations: Vec<SequenceAllocationFact>,
        membership_plans: Vec<AuthorizedMembershipPlan>,
        read_dependencies: Vec<CapturedReadDependency>,
        result: Value,
        ctx_ledger: CtxAnswerLedger,
        job_enqueues: Vec<crate::jobs::BufferedJobEnqueue>,
        job_producer: Option<crate::jobs::JobProducer>,
        asset_admissions: Vec<crate::assets::AssetAttachmentAdmission>,
        asset_grant_ops: Vec<crate::assets::BufferedAssetGrantOp>,
        media_projection_proof: Option<&crate::runtime::StagedMediaProjectionProofV1>,
        expected_media_projection_binding: Option<&crate::runtime::MediaProjectionProofBindingV1>,
    ) -> SnapbackResult<MutationCommit> {
        self.db.dry_run_buffered_writes_with_jobs(
            input,
            writes,
            sequence_allocations,
            membership_plans,
            read_dependencies,
            result,
            ctx_ledger,
            job_enqueues,
            job_producer,
            asset_admissions,
            asset_grant_ops,
            media_projection_proof,
            expected_media_projection_binding,
        )
    }
}
