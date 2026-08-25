use super::*;

/// Code-owned implementation facts not representable by existing capability
/// manifest fields. Constructors are internal so candidate artifacts cannot
/// turn assertions into target authority.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct TargetCapabilityFacts {
    pub auth_guest_sessions_registered: bool,
    pub auth_passwords_registered: bool,
    pub bounded_children_v1_registered: bool,
    pub bounded_batch_reads_v1_registered: bool,
    pub snapshot_batch_v1_registered: bool,
    pub snapshot_batch_v2_registered: bool,
    /// Process-live registration for the kill-switched graph executor. The
    /// committed local target keeps this false; a serving owner has to opt in
    /// before `graph_query_v1` can become an admitted instance capability.
    pub graph_query_v1_registered: bool,
    pub single_table_v1_registered: bool,
    pub bounded_response_stream_v1_registered: bool,
    pub relational_query_v1_registered: bool,
    pub sequence_allocation_v1_registered: bool,
    pub migration_keyset_scan_v1_registered: bool,
    pub full_text_search_v1_registered: bool,
    pub live_full_text_search_v1_registered: bool,
    pub vector_search_v1_registered: bool,
    pub inline_handler_v1_registered: bool,
    pub jobs_one_off_v1_registered: bool,
    pub expo_push_seam_v1_registered: bool,
    pub connected_client_predicate_registered: bool,
    pub client_mutation_settlement_ledger_registered: bool,
    pub result_contract_v1_registered: bool,
    pub structured_stored_value_v1_registered: bool,
    pub settlement_bounded_skew_registered: bool,
    pub args_contract_v1_registered: bool,
    pub versioned_seed_install_v1_registered: bool,
    pub versioned_seed_reset_v1_registered: bool,
    pub paired_v1_parser_registered: bool,
    pub shared_invocation_gate_registered: bool,
    pub staged_mode_registered: bool,
    pub host_plan_runtime: bool,
    pub ibex_ctx_db_host_bridge_available: bool,
    pub mutation_read_set_validator_registered: bool,
    pub permission_epoch_resync_registered: bool,
    pub registered_bundle_boot_v1_registered: bool,
    pub mixed_bundle_boot_v2_registered: bool,
    pub write_activity_v1_registered: bool,
    pub local_relation_activity_publication_v1_verified: bool,
    pub local_sequence_allocation_publication_v1_verified: bool,
    pub local_agent_safe_storage_publication_v1_verified: bool,
    pub local_agent_safe_derived_fork_publication_v1_verified: bool,
    pub local_persistent_store_publication_v1_verified: bool,
    pub packaged_store_qualification_mode: bool,
    pub asset_lifecycle_local_fs_registered: bool,
    pub media_ref_projection_v1_registered: bool,
    pub media_collection_v1_registered: bool,
    pub media_command_v1_registered: bool,
    pub asset_image_finalization_registered: bool,
    pub asset_reference_gc_registered: bool,
    pub asset_video_finalization_registered: bool,
}

impl AuthProtocols {
    pub const V1: Self = Self {
        provider: 1,
        invocation: 1,
        staged_mode: 1,
        bootstrap: 1,
    };
}

impl TargetCapabilityId {
    pub const ALL: [Self; 47] = [
        Self::AuthGuestSessions,
        Self::AuthPasswords,
        Self::AuthSessionsV1,
        Self::BoundedResponseStreamV1,
        Self::BoundedChildrenV1,
        Self::BoundedBatchReadsV1,
        Self::Cron,
        Self::CronActionRunMutation,
        Self::HostPlanRuntime,
        Self::IbexCtxDbHostBridge,
        Self::InlineHandlerV1,
        Self::JobsOneOffV1,
        Self::ExpoPushSeamV1,
        Self::ConnectedClientPredicate,
        Self::LiveSubscriptions,
        Self::OfflineMutationReplay,
        Self::MutationReadSetValidation,
        Self::MixedBundleBootV2,
        Self::PermissionEpochResync,
        Self::RegisteredBundleBootV1,
        Self::RelationalQueryV1,
        Self::SequenceAllocationV1,
        Self::SnapshotBatchV1,
        Self::SnapshotBatchV2,
        Self::GraphQueryV1,
        Self::SingleTableV1,
        Self::MigrationKeysetScanV1,
        Self::FullTextSearchV1,
        Self::LiveFullTextSearchV1,
        Self::VectorSearchV1,
        Self::ResultContractV1,
        Self::StructuredStoredValueV1,
        Self::SettlementBoundedSkew,
        Self::ArgsContractV1,
        Self::VersionedSeedInstallV1,
        Self::VersionedSeedResetV1,
        Self::WriteActivityV1,
        Self::AssetLifecycleV1,
        Self::MediaRefProjectionV1,
        Self::MediaCollectionV1,
        Self::MediaCommandV1,
        Self::AssetImageFinalizationV1,
        Self::AssetImagePipelineV1,
        Self::AssetReferenceGcV1,
        Self::AssetVideoFinalizationV1,
        Self::AgentSafeStorageV1,
        Self::AgentSafeDerivedDeploymentForkV1,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::AuthGuestSessions => "auth.guest-sessions",
            Self::AuthPasswords => "auth.passwords",
            Self::AuthSessionsV1 => "auth.sessions.v1",
            Self::BoundedResponseStreamV1 => "bounded_response_stream_v1",
            Self::BoundedChildrenV1 => "bounded_children_v1",
            Self::BoundedBatchReadsV1 => "bounded_batch_reads_v1",
            Self::Cron => "cron",
            Self::CronActionRunMutation => "cron_action_run_mutation",
            Self::HostPlanRuntime => "host_plan_runtime",
            Self::IbexCtxDbHostBridge => "ibex_ctx_db_host_bridge",
            Self::InlineHandlerV1 => "inline_handler_v1",
            Self::JobsOneOffV1 => "jobs_one_off_v1",
            Self::ExpoPushSeamV1 => "notifications.expoPushSeam",
            Self::ConnectedClientPredicate => "realtime.connected-client-predicate",
            Self::LiveSubscriptions => "live_subscriptions",
            Self::OfflineMutationReplay => "offline_mutation_replay",
            Self::MutationReadSetValidation => "mutation_read_set_validation",
            Self::MixedBundleBootV2 => "mixed_bundle_boot_v2",
            Self::PermissionEpochResync => "permission_epoch_resync",
            Self::RegisteredBundleBootV1 => "registered_bundle_boot_v1",
            Self::RelationalQueryV1 => "relational_query_v1",
            Self::SequenceAllocationV1 => "sequence_allocation_v1",
            Self::SnapshotBatchV1 => "snapshot_batch_v1",
            Self::SnapshotBatchV2 => "snapshot_batch_v2",
            Self::GraphQueryV1 => "graph_query_v1",
            Self::SingleTableV1 => "single_table_v1",
            Self::MigrationKeysetScanV1 => "migration_keyset_scan_v1",
            Self::FullTextSearchV1 => "full_text_search_v1",
            Self::LiveFullTextSearchV1 => "live_full_text_search_v1",
            Self::VectorSearchV1 => "vector_search_v1",
            Self::ResultContractV1 => "result_contract_v1",
            Self::StructuredStoredValueV1 => "structured_stored_value_v1",
            Self::SettlementBoundedSkew => "settlement.bounded_skew",
            Self::ArgsContractV1 => "args_contract_v1",
            Self::VersionedSeedInstallV1 => "versioned_seed_install_v1",
            Self::VersionedSeedResetV1 => "versioned_seed_reset_v1",
            Self::WriteActivityV1 => "write_activity_v1",
            Self::AssetLifecycleV1 => "asset_lifecycle_v1",
            Self::MediaRefProjectionV1 => "assets.media-ref-projection.v1",
            Self::MediaCollectionV1 => "assets.media-collection.v1",
            Self::MediaCommandV1 => "assets.media-command.v1",
            Self::AssetImageFinalizationV1 => "asset_image_finalization_v1",
            Self::AssetVideoFinalizationV1 => "asset_video_finalization_v1",
            Self::AssetImagePipelineV1 => "asset_image_pipeline_v1",
            Self::AssetReferenceGcV1 => "asset_reference_gc_v1",
            Self::AgentSafeStorageV1 => "agent_safe_storage_v1",
            Self::AgentSafeDerivedDeploymentForkV1 => "agent_safe_derived_deployment_fork_v1",
        }
    }

    /// The registry-owned maturity of this capability id (LLP 0058
    /// §Capability maturity, amendment 2026-07-24). Maturity is a fact about
    /// the id's governing contract, not about any one runtime instance, so it
    /// lives on the closed registry next to the id itself: candidate
    /// artifacts can neither assert nor upgrade it. The match is deliberately
    /// exhaustive: a newly minted id cannot inherit `stable` merely because a
    /// maintainer forgot to assign it.
    ///
    /// @ref LLP 0058#capability-maturity — an `experimental` entry in
    /// `supportedCapabilities` is not the plain 0058 compatibility assertion;
    /// admission refuses it unless the requiring artifact acknowledges the
    /// experimental contract.
    /// @ref LLP 0134#4-the-promotion-act — stable assignment is changed only
    /// by a digest-bound, history-pinned promotion act; there is no stable
    /// wildcard for unreviewed ids.
    pub const fn maturity(self) -> CapabilityMaturity {
        // LLP 0076 was Accepted 2026-07-25 and LLP 0080/0081 flipped to
        // Implemented 2026-07-26 (coupled suite green, admitted Step 5
        // fixture witnesses complete): `bounded_response_stream_v1`, then
        // `relational_query_v1` and `migration_keyset_scan_v1`, fell out of
        // the non-stable table as those acceptance/Implemented acts —
        // positive presence is now the plain 0058 compatibility assertion
        // for every registered id. Artifacts that still acknowledge a
        // promoted id are unaffected (stable acknowledgment is a no-op).
        match self {
            Self::AuthGuestSessions
            | Self::AuthPasswords
            | Self::BoundedChildrenV1
            | Self::BoundedBatchReadsV1
            | Self::InlineHandlerV1
            // LLP 0070 is Draft: `jobs_one_off_v1` stays experimental until
            // the RFC is accepted, and its presence never claims a
            // durable-work capability class or target tuple (claim boundary).
            | Self::JobsOneOffV1
            | Self::MixedBundleBootV2
            | Self::OfflineMutationReplay
            | Self::RegisteredBundleBootV1
            | Self::SequenceAllocationV1
            | Self::SnapshotBatchV1
            | Self::SnapshotBatchV2
            | Self::GraphQueryV1
            | Self::SingleTableV1
            | Self::LiveFullTextSearchV1
            | Self::VectorSearchV1
            | Self::ResultContractV1
            | Self::StructuredStoredValueV1
            | Self::ArgsContractV1
            | Self::VersionedSeedInstallV1
            | Self::VersionedSeedResetV1
            | Self::WriteActivityV1
            | Self::AssetLifecycleV1
            | Self::MediaRefProjectionV1
            | Self::MediaCollectionV1
            | Self::MediaCommandV1
            | Self::AssetImageFinalizationV1
            | Self::AssetVideoFinalizationV1
            | Self::AssetImagePipelineV1
            | Self::AssetReferenceGcV1
            | Self::AgentSafeStorageV1
            | Self::AgentSafeDerivedDeploymentForkV1 => CapabilityMaturity::Experimental,
            // @ref LLP 0134#1-maturity-semantics-and-the-two-routes — LLP
            //   0222 is Implemented, but no evidence-bound stable-promotion
            //   act has landed for this capability.
            Self::ConnectedClientPredicate => CapabilityMaturity::Experimental,
            Self::AuthSessionsV1
            | Self::BoundedResponseStreamV1
            | Self::Cron
            | Self::CronActionRunMutation
            | Self::HostPlanRuntime
            | Self::IbexCtxDbHostBridge
            | Self::LiveSubscriptions
            | Self::MutationReadSetValidation
            | Self::PermissionEpochResync
            | Self::RelationalQueryV1
            | Self::MigrationKeysetScanV1
            | Self::FullTextSearchV1
            // LLP 0143 is Accepted. Its deterministic local support proof
            // backs this compatibility fact; the separate real-device Exit
            // witness cannot weaken or upgrade manifest facts.
            | Self::ExpoPushSeamV1
            | Self::SettlementBoundedSkew => CapabilityMaturity::Stable,
        }
    }

    /// The closed LLP 0134 §7 reservation for the pre-rule shipped surfaces
    /// that may use the grandfathered-direct promotion route. Membership is
    /// eligibility only; it neither changes maturity nor waives the receipt.
    ///
    /// @ref LLP 0134#7-the-grandfather-set — only these five ids may exercise
    /// `grandfathered-direct.v1`; all later ids take the default evidence route.
    pub const GRANDFATHERED_DIRECT_PROMOTION_IDS: [Self; 5] = [
        Self::InlineHandlerV1,
        Self::ResultContractV1,
        Self::RegisteredBundleBootV1,
        Self::VersionedSeedInstallV1,
        Self::VersionedSeedResetV1,
    ];

    pub const fn is_grandfathered_direct_promotion_eligible(self) -> bool {
        matches!(
            self,
            Self::InlineHandlerV1
                | Self::ResultContractV1
                | Self::RegisteredBundleBootV1
                | Self::VersionedSeedInstallV1
                | Self::VersionedSeedResetV1
        )
    }

    /// Evaluate the id's named positive predicate for one exact target/runtime
    /// instance. Missing facts are false; capability gaps are never consulted.
    pub fn is_supported_by(
        self,
        manifest: &CapabilityManifest,
        facts: TargetCapabilityFacts,
    ) -> bool {
        match self {
            // @ref LLP 0258#d1-generate-one-non-secret-bootstrap-policy —
            // application entryMechanisms are only an allowlist. Positive
            // support for the corresponding entry surface comes from the
            // exact local target's registered handler plus the admitted
            // Sessions tuple, and every other target remains support-false.
            Self::AuthGuestSessions | Self::AuthPasswords => {
                manifest.target_profile_id == TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX
                    && match self {
                        Self::AuthGuestSessions => facts.auth_guest_sessions_registered,
                        Self::AuthPasswords => facts.auth_passwords_registered,
                        _ => unreachable!(),
                    }
                    && facts.paired_v1_parser_registered
                    && facts.shared_invocation_gate_registered
                    && facts.staged_mode_registered
            }
            Self::AuthSessionsV1 => {
                facts.paired_v1_parser_registered
                    && facts.shared_invocation_gate_registered
                    && facts.staged_mode_registered
            }
            // @ref LLP 0076#target-contract — the stream capability is an
            // instance-live predicate: the implementation must be registered
            // AND this exact process must have outbound egress enabled.
            Self::BoundedResponseStreamV1 => {
                manifest.outbound_actions && facts.bounded_response_stream_v1_registered
            }
            // @ref LLP 0110#local-and-packaged-publication-authority — the
            // relation/activity pair is one source-owned local publication:
            // both private registrations and the compiled carrier must hold
            // on the exact auth-aware local profile. A generated artifact,
            // derived service profile, or hosted target cannot set the facts.
            // @ref LLP 0113#1-closed-capability-registry-assignment — static
            // experimental maturity is independent of this runtime predicate
            // and still requires an artifact acknowledgment at admission.
            Self::BoundedChildrenV1 | Self::WriteActivityV1 => {
                facts.bounded_children_v1_registered
                    && facts.write_activity_v1_registered
                    && facts.local_relation_activity_publication_v1_verified
                    && manifest.target_profile_id == TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX
                    && manifest
                        .supported_artifact_auth_pairs
                        .contains(&SupportedArtifactAuthPair {
                            schema_version: ArtifactVersion::V1,
                            auth_mode: AuthMode::Sessions,
                        })
                    && manifest.auth_protocols == Some(AuthProtocols::V1)
                    && match self {
                        Self::BoundedChildrenV1 => {
                            manifest.live_subscriptions && manifest.relational_queries.is_some()
                        }
                        Self::WriteActivityV1 => {
                            facts.result_contract_v1_registered
                                && facts.mutation_read_set_validator_registered
                                && manifest.mutation_isolation_mode
                                    == "handler-captured-read-set-validation"
                        }
                        _ => unreachable!(),
                    }
            }
            Self::BoundedBatchReadsV1 => {
                facts.bounded_batch_reads_v1_registered
                    && manifest.target_profile_id == TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX
            }
            Self::HostPlanRuntime => facts.host_plan_runtime,
            Self::IbexCtxDbHostBridge => facts.ibex_ctx_db_host_bridge_available,
            Self::InlineHandlerV1 => facts.inline_handler_v1_registered,
            // Fail-closed dedicated fact: only the local single-process
            // SQLite target registers the jobs enqueue/drain implementation.
            // Hosted targets stay false — LLP 0070's hosted candidate is
            // blocked-on and out of this slice (nonclaim).
            Self::JobsOneOffV1 => facts.jobs_one_off_v1_registered,
            // LLP 0143's accepted seam is local-target support, distinct from
            // the still-false first-class `notifications` boolean. The
            // structured descriptor is part of the positive predicate so a
            // bare registry-string edit cannot manufacture support.
            Self::ExpoPushSeamV1 => {
                facts.expo_push_seam_v1_registered
                    && manifest.target_profile_id == TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX
                    && manifest.expo_push_seam.as_ref().is_some_and(|descriptor| {
                        descriptor.capability_id == "notifications.expoPushSeam"
                            && descriptor.max_concurrent_send_attempts == 1
                            && descriptor.surfaces
                                == [
                                    "push-token-registry",
                                    "ctx.push.send",
                                    "handoff-ledger",
                                    "receipt-maintenance",
                                ]
                    })
            }
            Self::ConnectedClientPredicate => {
                facts.connected_client_predicate_registered
                    && manifest.live_subscriptions
                    && manifest
                        .connected_client_predicate
                        .as_ref()
                        .is_some_and(|descriptor| {
                            descriptor.capability_id == "realtime.connected-client-predicate"
                                && descriptor.semantics_version == 2
                                && descriptor.freshness_budget_ms == 15_000
                                && descriptor.transport
                                    == ["managed-websocket", "authenticated-poll"]
                                && descriptor.authority_scope == "app-instance-process"
                                && descriptor.aggregation_mode == "single-authority-routing"
                        })
                    && manifest
                        .supported_artifact_auth_pairs
                        .contains(&SupportedArtifactAuthPair {
                            schema_version: ArtifactVersion::V1,
                            auth_mode: AuthMode::Sessions,
                        })
            }
            Self::LiveSubscriptions => manifest.live_subscriptions,
            // @ref LLP 0058#target-capability-registry-amendment--offline-mutation-replay-2026-08-12 —
            // only targets registering the atomic settlement ledger may
            // advertise the outbox replay prerequisite. Cloudflare/default
            // facts remain false even though that target accepts mutations.
            Self::OfflineMutationReplay => facts.client_mutation_settlement_ledger_registered,
            Self::MutationReadSetValidation => {
                manifest.mutation_isolation_mode == "handler-captured-read-set-validation"
                    && facts.mutation_read_set_validator_registered
            }
            Self::MixedBundleBootV2 => {
                facts.mixed_bundle_boot_v2_registered
                    && facts.registered_bundle_boot_v1_registered
                    && Self::LiveSubscriptions.is_supported_by(manifest, facts)
                    && manifest.target_profile_id == TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX
            }
            Self::Cron => manifest.cron,
            Self::CronActionRunMutation => {
                manifest.cron
                    && manifest
                        .supported_query_forms
                        .iter()
                        .any(|form| form == "cron-action-run-mutation")
            }
            Self::PermissionEpochResync => facts.permission_epoch_resync_registered,
            // @ref LLP 0112#fallback-and-capability-honesty — positive
            // presence means this exact target instance implements the
            // route/register endpoint, pending-owner/grant custody, and the
            // generated client's registered-adoption cleanup contract.
            Self::RegisteredBundleBootV1 => facts.registered_bundle_boot_v1_registered,
            // Fail-closed dedicated fact: a target implementing host plans
            // (e.g. the Cloudflare host-ops path) does not thereby implement
            // the relational executor (LLP 0080 §2's capability-gap rule).
            Self::RelationalQueryV1 => facts.relational_query_v1_registered,
            // @ref LLP 0135#18-ceilings-receipts-and-capability — publication
            // is an exact local-source conjunction over both allocation
            // surfaces, settlement/read-set dependencies, and the compiled
            // qualification carrier. Maturity remains experimental until a
            // separate LLP 0134 promotion act.
            // @ref LLP 0113#1-closed-capability-registry-assignment — neither
            // app artifacts nor an unqualified target may mint support.
            Self::SequenceAllocationV1 => {
                facts.sequence_allocation_v1_registered
                    && facts.local_sequence_allocation_publication_v1_verified
                    && facts.host_plan_runtime
                    && facts.ibex_ctx_db_host_bridge_available
                    && facts.result_contract_v1_registered
                    && facts.mutation_read_set_validator_registered
                    && Self::WriteActivityV1.is_supported_by(manifest, facts)
                    && manifest.target_profile_id == TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX
                    && manifest.mutation_isolation_mode == "handler-captured-read-set-validation"
            }
            Self::SnapshotBatchV1 => {
                facts.snapshot_batch_v1_registered
                    && Self::BoundedChildrenV1.is_supported_by(manifest, facts)
                    && Self::LiveSubscriptions.is_supported_by(manifest, facts)
                    && manifest.target_profile_id == TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX
            }
            // @ref LLP 0157#d1--the-node-algebra — v2 support is a distinct,
            // experimental local executor fact conjoined with the stable
            // relational and live dependencies. Bounded-child tuples carry
            // their own additional required capability at artifact admission.
            Self::SnapshotBatchV2 => {
                facts.snapshot_batch_v2_registered
                    && Self::RelationalQueryV1.is_supported_by(manifest, facts)
                    && Self::LiveSubscriptions.is_supported_by(manifest, facts)
                    && manifest.target_profile_id == TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX
            }
            // @ref LLP 0209#9-sequencing-and-measurement-what-lands-first-and-how-it-is-measured — G2-C installs an
            // instance-live executor fact without changing the conservative
            // committed target declaration or the publication gate.
            Self::GraphQueryV1 => {
                facts.graph_query_v1_registered
                    && facts.host_plan_runtime
                    && Self::LiveSubscriptions.is_supported_by(manifest, facts)
                    && manifest.target_profile_id == TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX
            }
            // @ref LLP 0110#local-persistent-store-publication-authority-amendment--2026-08-04
            // — the host-derived class is supportable only on the exact
            // contributor-source target whose embedded carrier binds the
            // proof/wire/store receipts and sources. Registration and static
            // experimental maturity alone never manufacture support.
            // @ref LLP 0157#d1--the-node-algebra — class membership is
            // host-derived, single-node-only, and not author-assertable.
            Self::SingleTableV1 => {
                facts.single_table_v1_registered
                    && facts.local_persistent_store_publication_v1_verified
                    && facts.host_plan_runtime
                    && Self::LiveSubscriptions.is_supported_by(manifest, facts)
                    && manifest.target_profile_id == TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX
            }
            // Fail-closed dedicated fact (LLP 0081 §3): the privileged
            // migration scan is a target capability; a target without it
            // cannot claim migration proofs.
            Self::MigrationKeysetScanV1 => facts.migration_keyset_scan_v1_registered,
            Self::FullTextSearchV1 => {
                facts.full_text_search_v1_registered
                    && manifest.full_text_search.as_ref().is_some_and(|facts| {
                        facts.capability_id == "full_text_search_v1"
                            && facts.maturity == "stable"
                            && facts.storage_engines == ["sqlite"]
                    })
            }
            // @ref LLP 0136#capability-id-and-claim-discipline-llp-0119-oq2-proposal
            // — parent capabilities never imply the sibling claim. This exact
            // target must also hold the dedicated implementation registration
            // and closed live-search fact block; all constructors currently
            // keep the registration false and publish the structured GAP.
            Self::LiveFullTextSearchV1 => {
                facts.live_full_text_search_v1_registered
                    && Self::FullTextSearchV1.is_supported_by(manifest, facts)
                    && Self::LiveSubscriptions.is_supported_by(manifest, facts)
                    && manifest
                        .live_full_text_search
                        .as_ref()
                        .is_some_and(|facts| {
                            facts.capability_id == "live_full_text_search_v1"
                                && facts.liveness_scope == "first-page-only"
                                && facts.wake_granularity == "table-granular"
                                && facts.delivery_lane == "replace-only"
                                && !facts.retention
                                && !facts.resume
                                && !facts.auth_scoped
                                && facts.max_live_subscriptions > 0
                                && facts.max_live_subscriptions_per_connection > 0
                                && facts.max_live_subscriptions_per_table > 0
                        })
            }
            // @ref LLP 0132#capabilities-targets-and-staging — this is an
            // exact conjunction, not an inference from vector-shaped schema
            // carriers or generic HostPlan/SQLite support. Only the qualified
            // local profile registers the executor, and its closed fact block
            // must match every normative profile field byte-for-byte.
            Self::VectorSearchV1 => {
                facts.vector_search_v1_registered
                    && facts.host_plan_runtime
                    && facts.mutation_read_set_validator_registered
                    && manifest.target_profile_id == TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX
                    && manifest.storage_engine == "sqlite"
                    && manifest.vector_search.as_ref() == Some(&VectorSearchFactsV1::local_v1())
            }
            Self::ResultContractV1 => facts.result_contract_v1_registered,
            // @ref LLP 0211#capability-and-maturity-the-llp-0134-publication-contract
            // — a plain local registration fact is the only support route;
            // Phase A deliberately leaves it false pending the reviewed flip.
            Self::StructuredStoredValueV1 => facts.structured_stored_value_v1_registered,
            // @ref LLP 0133#the-bounded-skew-opt-in — this fact names only
            //   the lane-L declaration/admission/check/receipt policy. Lane Q
            //   remains the replay-accept pin and gains no data-bound claim.
            Self::SettlementBoundedSkew => facts.settlement_bounded_skew_registered,
            // @ref LLP 0131#runtime-ingress-validation — positive presence
            // means this exact target instance runs `validate_function_args`
            // on every fresh invocation admission lane, scalars included.
            Self::ArgsContractV1 => facts.args_contract_v1_registered,
            // @ref LLP 0109#166-the-manifest-is-an-executable-advertisement-gate
            // — the local fact is enabled only by the complete mandatory
            // conformance receipt; hosted/default target facts remain false.
            Self::VersionedSeedInstallV1 => facts.versioned_seed_install_v1_registered,
            Self::VersionedSeedResetV1 => facts.versioned_seed_reset_v1_registered,
            // @ref LLP 0044#capability-facts-and-implementation-slices — the
            // lifecycle composite is store-parameterized: the claim requires
            // the registered local-fs implementation AND declared asset
            // facts naming at least one qualified store and the required
            // private-strict profile. A target without strict delivery does
            // not claim the composite.
            Self::AssetLifecycleV1 => {
                facts.asset_lifecycle_local_fs_registered
                    && manifest.assets.as_ref().is_some_and(|assets| {
                        assets.capability_id == "asset_lifecycle_v1"
                            && !assets.lifecycle_stores.is_empty()
                            && assets
                                .delivery_profiles
                                .iter()
                                .any(|profile| profile == "private-strict")
                    })
            }
            // @ref LLP 0244#d6-projection-is-a-capability-gated-storage-feature
            // — positive presence is the qualified local conjunction, never
            //   inference from a media-shaped schema field alone.
            Self::MediaRefProjectionV1 => {
                facts.media_ref_projection_v1_registered
                    && facts.result_contract_v1_registered
                    && facts.mutation_read_set_validator_registered
                    && manifest.target_profile_id == TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX
                    && manifest.storage_engine == "sqlite"
                    && Self::AssetLifecycleV1.is_supported_by(manifest, facts)
            }
            // @ref LLP 0239#d2-assetcollection-is-the-zero-to-many-application-relation
            // — registration names the manifest/storage/mutation/read
            // implementation as one local experimental capability.
            Self::MediaCollectionV1 => {
                facts.media_collection_v1_registered
                    && facts.host_plan_runtime
                    && facts.mutation_read_set_validator_registered
                    && Self::MediaRefProjectionV1.is_supported_by(manifest, facts)
                    && Self::BoundedChildrenV1.is_supported_by(manifest, facts)
                    && manifest.target_profile_id == TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX
                    && manifest.storage_engine == "sqlite"
            }
            // @ref LLP 0239#d3-one-mediacommand-owns-multi-upload-plus-atomic-commit
            Self::MediaCommandV1 => {
                facts.media_command_v1_registered
                    && facts.client_mutation_settlement_ledger_registered
                    && Self::MediaCollectionV1.is_supported_by(manifest, facts)
                    && manifest.target_profile_id == TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX
                    && manifest.storage_engine == "sqlite"
            }
            // @ref LLP 0044#capability-facts-and-implementation-slices — the
            // image facts block IS the `asset-image-finalization` fact: the
            // registered implementation plus the declared Enforced ceilings.
            Self::AssetImageFinalizationV1 => {
                facts.asset_image_finalization_registered
                    && manifest
                        .assets
                        .as_ref()
                        .is_some_and(|assets| assets.image.is_some())
            }
            // @ref LLP 0044#generated-upload-intents — the video facts
            // block IS the `asset-video-finalization` fact: the registered
            // in-place blanking implementation plus the declared Enforced
            // container ceilings.
            Self::AssetVideoFinalizationV1 => {
                facts.asset_video_finalization_registered
                    && manifest
                        .assets
                        .as_ref()
                        .is_some_and(|assets| assets.video.is_some())
            }
            // The pipeline composite carries the finalization fact and sits
            // on the lifecycle composite; it never holds without both.
            Self::AssetImagePipelineV1 => {
                Self::AssetLifecycleV1.is_supported_by(manifest, facts)
                    && Self::AssetImageFinalizationV1.is_supported_by(manifest, facts)
            }
            // @ref LLP 0044#deletion-retention-and-garbage-collection —
            // target support for the opt-in reference-tracked sweep: the
            // registered implementation plus the declared grace-bound facts,
            // on top of the lifecycle composite (typed reverse-reference
            // evidence). The app's schema-level declaration separately
            // enables it per deployment.
            Self::AssetReferenceGcV1 => {
                facts.asset_reference_gc_registered
                    && Self::AssetLifecycleV1.is_supported_by(manifest, facts)
                    && manifest
                        .assets
                        .as_ref()
                        .is_some_and(|assets| assets.reference_gc.is_some())
            }
            // @ref LLP 0162#8-capability-honesty — these two component facts
            // have independent source-owned carriers. Neither implies the
            // other or any aggregate, and only the exact local profile may
            // consume them.
            Self::AgentSafeStorageV1 => {
                facts.local_agent_safe_storage_publication_v1_verified
                    && manifest.target_profile_id == TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX
            }
            Self::AgentSafeDerivedDeploymentForkV1 => {
                facts.local_agent_safe_derived_fork_publication_v1_verified
                    && manifest.target_profile_id == TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX
            }
        }
    }
}

impl fmt::Display for TargetCapabilityId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl FromStr for TargetCapabilityId {
    type Err = ();

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::ALL
            .into_iter()
            .find(|capability| capability.as_str() == value)
            .ok_or(())
    }
}
impl CapabilityMaturity {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Proposed => "proposed",
            Self::Experimental => "experimental",
            Self::Stable => "stable",
        }
    }
}

impl CapabilityManifest {
    /// Parse an artifact's acknowledgment list into registry ids. Unknown
    /// strings are ignored — an acknowledgment can only ever narrow a refusal
    /// for a known id, never mint authority, so lenient parsing is
    /// fail-closed (a typo simply leaves the experimental refusal in place).
    pub fn parse_acknowledged_capabilities<'a>(
        acknowledged: impl IntoIterator<Item = &'a str>,
    ) -> BTreeSet<TargetCapabilityId> {
        acknowledged
            .into_iter()
            .filter_map(|capability| capability.parse::<TargetCapabilityId>().ok())
            .collect()
    }
}
