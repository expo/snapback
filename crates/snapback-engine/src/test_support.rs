//! Feature-gated fixtures for tests in higher-ranked workspace crates.
//!
//! Cargo features are caller-controlled, so every helper here must remain safe
//! when a dependent enables `test-support` in a release build. In particular,
//! this module must not combine caller-selected executable code with fabricated
//! authority or expose an authority-bypassing evaluator.

use crate::auth::invocation::PreparedAuthority;
use crate::contract_types::ServerProfile;
use crate::diagnostic::SnapbackResult;
use crate::local::LocalSnapback;
use crate::local::{LiveInvalidationAdmission, LiveSubscribeInput, LiveSubscribeOutput};
use crate::manifest::{
    FunctionManifest, FunctionRuntime, GraphQueryPlanV1, GraphRowKeyV1, HandlerInput, IbexModule,
};

pub fn apply_graph_delta_to_result_for_test(
    plan: &GraphQueryPlanV1,
    previous_result_bytes: &str,
    previous_root_keys: &[GraphRowKeyV1],
    ops: &[crate::live_wire::LiveGraphDeltaWireOpV1],
    ordered_root_keys: &[GraphRowKeyV1],
) -> SnapbackResult<String> {
    crate::graph_evaluator::apply_graph_delta_to_result(
        plan,
        previous_result_bytes,
        previous_root_keys,
        ops,
        ordered_root_keys,
    )
}

/// Finite compatibility surface for higher-ranked auth fixtures.
///
/// This deliberately does not implement `Deref`/`DerefMut`, expose a raw
/// database borrow, or accept caller-provided callbacks. Adding an operation
/// therefore requires an explicit, reviewable forwarding method here instead
/// of silently making every current and future `LocalDatabase` method
/// dependent-reachable.
pub struct AuthFixture<'a> {
    snapback: &'a mut LocalSnapback,
}

impl AuthFixture<'_> {
    fn database(&mut self) -> &mut crate::storage::LocalDatabase {
        self.snapback.auth_database_mut()
    }

    pub fn auth_catalog(&mut self) -> crate::storage::AuthCatalogKernel<'_> {
        self.database().auth_catalog()
    }

    pub fn auth_catalog_read(&mut self) -> crate::storage::AuthCatalogKernel<'_> {
        self.database().auth_catalog_read()
    }

    pub fn mutation_writes(&mut self) -> crate::storage::MutationWritesKernel<'_> {
        self.database().mutation_writes()
    }

    pub fn settlement_read(&mut self) -> crate::storage::SettlementReadKernel<'_> {
        self.database().settlement_read()
    }

    pub fn query_reads_read(&mut self) -> crate::storage::QueryReadsReadKernel<'_> {
        self.database().query_reads_read()
    }

    pub fn schema(&mut self) -> &crate::manifest::SchemaManifest {
        self.database().schema()
    }

    pub fn ensure_authorization_stream_incarnation(
        &mut self,
    ) -> SnapbackResult<crate::contract_types::AuthorizationStreamIncarnation> {
        self.database().ensure_authorization_stream_incarnation()
    }

    pub fn authorization_version(
        &mut self,
    ) -> SnapbackResult<crate::storage::AuthorizationVersion> {
        self.database().authorization_version()
    }

    pub fn auth_session_clock_floor(&mut self) -> SnapbackResult<u64> {
        self.database().auth_session_clock_floor()
    }

    pub fn auth_mode_state(&mut self) -> SnapbackResult<crate::auth::mode::AuthModeStateRecord> {
        self.database()
            .auth_mode_snapshot()
            .map(|snapshot| snapshot.state)
    }

    pub fn activate_current_auth_catalog_with_password_identifier_mode(
        &mut self,
        mode: crate::storage::auth::PasswordIdentifierMode,
    ) -> SnapbackResult<()> {
        self.database()
            .activate_current_auth_catalog_with_password_identifier_mode(mode)
    }

    pub fn activate_push_registry_for_test(
        &mut self,
        declaration: crate::push::PushSeamDeclarationV1,
    ) -> SnapbackResult<()> {
        self.database().activate_push_registry_for_test(declaration)
    }

    pub fn push_registry_inspection(
        &mut self,
    ) -> SnapbackResult<crate::push::PushRegistryInspectionV1> {
        self.database().push_registry_inspection()
    }

    pub fn operation_lane_covered(&mut self, lane: &str) -> SnapbackResult<bool> {
        self.database().operation_lane_covered(lane)
    }

    pub fn install_operation_coverage_for_test(
        &mut self,
        lanes: Vec<String>,
        writers: Vec<String>,
    ) -> SnapbackResult<()> {
        self.database()
            .install_operation_coverage_for_test(lanes, writers)
    }

    pub fn reconcile_auth_scope_bases(
        &mut self,
        manifest: &FunctionManifest,
    ) -> SnapbackResult<snapback_kernel::storage::auth_scope_bases::ScopeBasisReconciliation> {
        self.database().reconcile_auth_scope_bases(manifest)
    }

    pub fn current_auth_scope_basis(
        &mut self,
        function_id: &str,
        kind: &crate::manifest::FunctionKind,
        authority_creating: bool,
    ) -> SnapbackResult<Option<u64>> {
        self.database()
            .current_auth_scope_basis(function_id, kind, authority_creating)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn register_agent_principal(
        &mut self,
        invitation: Option<&crate::auth::crypto::CreationInvitation>,
        display_name: Option<String>,
        operator_contact: Option<String>,
        profile: ServerProfile,
        now_ms: u64,
        random: &dyn crate::auth::crypto::RandomSource,
    ) -> SnapbackResult<snapback_kernel::storage::auth_agent_credentials::IssuedAgentCredential>
    {
        self.database().register_agent_principal(
            invitation,
            display_name,
            operator_contact,
            profile,
            now_ms,
            random,
        )
    }

    pub fn agent_owner(&mut self, user_id: &str) -> SnapbackResult<Option<String>> {
        self.database().agent_owner(user_id)
    }

    pub fn deactivate_agent(
        &mut self,
        user_id: &str,
        now_ms: u64,
        manifest: &crate::manifest::SchemaManifest,
    ) -> SnapbackResult<()> {
        self.database().deactivate_agent(user_id, now_ms, manifest)
    }

    pub fn rotate_agent_credential(
        &mut self,
        credential: &crate::auth::crypto::AgentCredential,
        now_ms: u64,
        random: &dyn crate::auth::crypto::RandomSource,
    ) -> SnapbackResult<snapback_kernel::storage::auth_agent_credentials::RotatedAgentCredential>
    {
        self.database()
            .rotate_agent_credential(credential, now_ms, random)
    }

    pub fn revoke_agent_credential_family(
        &mut self,
        credential: &crate::auth::crypto::AgentCredential,
        now_ms: u64,
    ) -> SnapbackResult<snapback_kernel::storage::auth_agent_credentials::AgentFamilyRevocation>
    {
        self.database()
            .revoke_agent_credential_family(credential, now_ms)
    }

    pub fn mint_scoped_token(
        &mut self,
        credential: &crate::auth::crypto::AgentCredential,
        grant_id: &str,
        ttl_ms: Option<u64>,
        now_ms: u64,
        random: &dyn crate::auth::crypto::RandomSource,
    ) -> SnapbackResult<snapback_kernel::storage::auth_agent_credentials::IssuedScopedToken> {
        self.database()
            .mint_scoped_token(credential, grant_id, ttl_ms, now_ms, random)
    }

    pub fn resolve_scoped_token(
        &mut self,
        token: &crate::auth::crypto::ScopedToken,
        now_ms: u64,
    ) -> SnapbackResult<snapback_kernel::storage::auth_agent_credentials::ResolvedScopedToken> {
        self.database().resolve_scoped_token(token, now_ms)
    }

    pub fn terminalize_expired_service_authority(
        &mut self,
        deadline: &crate::auth::service_fence::ServiceAuthorityDeadlineTerminal,
    ) -> SnapbackResult<()> {
        self.database()
            .terminalize_expired_service_authority(deadline)
    }

    pub fn mint_pairing_code(
        &mut self,
        user_id: &str,
        now_ms: u64,
        random: &dyn crate::auth::crypto::RandomSource,
    ) -> SnapbackResult<snapback_kernel::storage::auth_grants::MintedPairingCode> {
        self.database().mint_pairing_code(user_id, now_ms, random)
    }

    pub fn present_pairing_code(
        &mut self,
        credential: &crate::auth::crypto::AgentCredential,
        pairing_request_id: &str,
        pairing_code: &crate::auth::crypto::PairingCode,
        requested_scopes: &[snapback_kernel::storage::auth_grants::GrantScopeRequest],
        now_ms: u64,
    ) -> SnapbackResult<snapback_kernel::storage::auth_grants::PairingPresentation> {
        self.database().present_pairing_code(
            credential,
            pairing_request_id,
            pairing_code,
            requested_scopes,
            now_ms,
        )
    }

    pub fn revoke_grant_for_user(
        &mut self,
        effective_user_id: &str,
        grant_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<snapback_kernel::storage::auth_grants::GrantRevocation> {
        self.database()
            .revoke_grant_for_user(effective_user_id, grant_id, now_ms)
    }

    pub fn stage_auth_mode(
        &mut self,
        requested_deployment: crate::auth::mode::DeploymentIdentity,
        schema_manifest: crate::manifest::SchemaManifest,
        seed: Option<crate::manifest::SeedData>,
    ) -> SnapbackResult<crate::auth::mode::AuthModeStateRecord> {
        self.database()
            .stage_auth_mode(requested_deployment, schema_manifest, seed)
    }

    pub fn consume_sessions_auth_mode(
        &mut self,
        readiness: &crate::auth::mode::AuthProgramReadiness,
    ) -> SnapbackResult<crate::auth::mode::AuthModeStateRecord> {
        self.database().consume_sessions_auth_mode(readiness)
    }

    pub fn declared_client_for_admission(
        &mut self,
        normalized_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<Option<snapback_kernel::storage::declared_clients::DeclaredClientRecord>>
    {
        self.database()
            .declared_client_for_admission(normalized_id, now_ms)
    }

    pub fn set_declared_client_status(
        &mut self,
        normalized_id: &str,
        status: snapback_kernel::storage::declared_clients::DeclaredClientStatus,
    ) -> SnapbackResult<snapback_kernel::storage::declared_clients::DeclaredClientRecord> {
        self.database()
            .set_declared_client_status(normalized_id, status)
    }

    pub fn mint_capability_link(
        &mut self,
        request: snapback_kernel::storage::capability_links::MintCapabilityLink,
    ) -> SnapbackResult<snapback_kernel::storage::capability_links::MintedCapabilityLink> {
        self.database().mint_capability_link(request)
    }

    pub fn pending_effect(
        &mut self,
        id: &str,
        now_ms: u64,
    ) -> SnapbackResult<snapback_kernel::storage::pending_effects::PendingEffectRecord> {
        self.database().pending_effect(id, now_ms)
    }

    pub fn identity_claims(
        &mut self,
        session_id: &str,
        now_ms: u64,
        profile: ServerProfile,
    ) -> SnapbackResult<snapback_types::auth::identity_core::AuthClaimsProjection> {
        self.database().identity_claims(session_id, now_ms, profile)
    }

    pub fn identity_reap_guests_default_tombstone(
        &mut self,
        now_ms: u64,
    ) -> SnapbackResult<snapback_kernel::storage::auth_identity::GuestReapBatch> {
        self.database()
            .identity_reap_guests_default_tombstone(now_ms)
    }

    pub fn authentication_attempt_charge_counts_for_test(
        &mut self,
    ) -> SnapbackResult<Vec<(String, String, i64)>> {
        Ok(self
            .database()
            .authentication_attempt_charge_counts_for_test()?)
    }

    pub fn password_identity_subject_count_for_test(
        &mut self,
        subject: &str,
    ) -> SnapbackResult<i64> {
        Ok(self
            .database()
            .password_identity_subject_count_for_test(subject)?)
    }

    pub fn integration_record_if_present(
        &mut self,
        principal_user_id: &str,
    ) -> SnapbackResult<Option<snapback_kernel::storage::auth_integrations::IntegrationRecord>>
    {
        self.database()
            .integration_record_if_present(principal_user_id)
    }

    pub fn set_integration_suspended(
        &mut self,
        principal_user_id: &str,
        suspended: bool,
        now_ms: u64,
    ) -> SnapbackResult<snapback_kernel::storage::auth_integrations::IntegrationRecord> {
        self.database()
            .set_integration_suspended(principal_user_id, suspended, now_ms)
    }

    pub fn integration_record_for_test(
        &mut self,
        principal_user_id: &str,
    ) -> SnapbackResult<Option<snapback_kernel::storage::auth_integrations::IntegrationRecord>>
    {
        self.database()
            .integration_record_for_test(principal_user_id)
    }

    pub fn integration_grant_revoked_for_test(&mut self, grant_id: &str) -> SnapbackResult<bool> {
        self.database().integration_grant_revoked_for_test(grant_id)
    }

    pub fn oauth_registration_facts_for_test(
        &mut self,
        client_id: &str,
    ) -> SnapbackResult<(String, String, String)> {
        self.database().oauth_registration_facts_for_test(client_id)
    }

    pub fn oauth_proposal_counts_for_test(
        &mut self,
        consenting_user_id: &str,
    ) -> SnapbackResult<(u64, u64)> {
        self.database()
            .oauth_proposal_counts_for_test(consenting_user_id)
    }

    pub fn push_registry(&mut self) -> snapback_kernel::storage::PushRegistryKernel<'_> {
        self.database().push_registry()
    }

    pub fn create_watch(
        &mut self,
        request: snapback_kernel::storage::watches::CreateWatchRecord,
    ) -> SnapbackResult<snapback_kernel::storage::watches::WatchRecord> {
        self.database().create_watch(request)
    }

    pub fn revalidate_watch_principal(
        &mut self,
        watch_id: &str,
    ) -> SnapbackResult<Option<snapback_kernel::storage::watches::RevalidatedWatchPrincipal>> {
        self.database().revalidate_watch_principal(watch_id)
    }

    pub fn transition_watch(
        &mut self,
        id: &str,
        owner: &str,
        target: snapback_types::watches::WatchStatus,
        now_ms: u64,
    ) -> SnapbackResult<snapback_kernel::storage::watches::WatchRecord> {
        self.database().transition_watch(id, owner, target, now_ms)
    }

    pub fn watch_management_facts_for_test(
        &mut self,
        watch_id: &str,
    ) -> SnapbackResult<snapback_kernel::storage::watches::WatchManagementFactsForTest> {
        self.database().watch_management_facts_for_test(watch_id)
    }

    pub fn seed_renewable_watch_for_management_test(
        &mut self,
        watch_id: &str,
        effective_user_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<snapback_kernel::storage::watches::WatchRecord> {
        self.database().seed_renewable_watch_for_management_test(
            watch_id,
            effective_user_id,
            now_ms,
        )
    }

    pub fn activate_catalog(
        &mut self,
        keyring: &snapback_auth::auth::keyring::AuthKeyringStore,
        now_ms: u64,
        random: &dyn crate::auth::crypto::RandomSource,
    ) -> SnapbackResult<snapback_auth::auth::lifecycle::AuthActivation> {
        snapback_auth::auth::lifecycle::activate_catalog(self.database(), keyring, now_ms, random)
    }

    pub fn resolve_session(
        &mut self,
        admission: &snapback_auth::auth::provider::AuthAdmission,
        bearer: &str,
        now_ms: u64,
    ) -> snapback_auth::auth::provider::ProviderResult<crate::contract_types::ResolvedSession> {
        admission.resolve_session(self.database(), bearer, now_ms)
    }

    pub fn request_code(
        &mut self,
        admission: &snapback_auth::auth::provider::AddressAdmission,
        now_ms: u64,
    ) -> snapback_auth::auth::provider::ProviderResult<
        snapback_types::auth::wire::RequestCodeResponse,
    > {
        admission.request_code(self.database(), now_ms)
    }

    pub fn apply_declared_restore(
        &mut self,
        mailbox: &snapback_auth::auth::mailbox::CaptureMailbox,
        declaration_path: &std::path::Path,
        supplied_declaration_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<snapback_auth::auth::lifecycle::DeclaredRestoreOutcome> {
        snapback_auth::auth::lifecycle::apply_declared_restore(
            self.database(),
            mailbox,
            declaration_path,
            supplied_declaration_id,
            now_ms,
        )
    }

    pub fn auth_coordinator(
        &mut self,
        admission: snapback_auth::auth::admission::AdmissionController,
        epoch_now_ms: u64,
        monotonic_now: std::time::Instant,
    ) -> SnapbackResult<snapback_sync::auth::coordinator::AuthCoordinator> {
        snapback_sync::auth::coordinator::AuthCoordinator::from_local_session_database(
            self.database(),
            admission,
            epoch_now_ms,
            monotonic_now,
        )
    }

    pub fn prepare_auth_coordinator(
        &mut self,
        admission: snapback_auth::auth::admission::AdmissionController,
        epoch_now_ms: u64,
        monotonic_now: std::time::Instant,
    ) -> SnapbackResult<snapback_sync::auth::coordinator::PreparedLocalSessionCoordinator> {
        snapback_sync::auth::coordinator::AuthCoordinator::prepare_from_local_session_database(
            self.database(),
            admission,
            epoch_now_ms,
            monotonic_now,
        )
    }

    pub fn create_auth_backup(
        &mut self,
        keyring: &snapback_auth::auth::keyring::AuthKeyringStore,
        output_directory: &std::path::Path,
        created_at_ms: u64,
        random: &dyn crate::auth::crypto::RandomSource,
    ) -> SnapbackResult<snapback_auth::auth::backup::AuthBackupOutcome> {
        snapback_auth::auth::backup::create_backup(
            self.database(),
            keyring,
            output_directory,
            created_at_ms,
            random,
        )
    }
}

/// Borrow the bounded auth-fixture surface without exposing its underlying
/// `LocalDatabase`.
pub fn auth_fixture(snapback: &mut LocalSnapback) -> AuthFixture<'_> {
    AuthFixture { snapback }
}

pub fn initialize_commit_capsule_prototype(snapback: &mut LocalSnapback) -> SnapbackResult<()> {
    snapback_kernel::storage::commit_capsule_prototype::initialize(snapback.auth_database_mut())
}

pub fn stage_commit_capsule_prototype<'a>(
    snapback: &'a mut LocalSnapback,
    intent_producer: snapback_kernel::storage::CommitCapsuleIntentProducer<
        snapback_kernel::storage::commit_capsule_prototype::PrototypeIntent,
    >,
    intent: &snapback_kernel::storage::commit_capsule_prototype::PrototypeIntent,
    include_consumed_proof: bool,
) -> SnapbackResult<snapback_kernel::storage::commit_capsule_prototype::PrototypeStage<'a>> {
    snapback_kernel::storage::commit_capsule_prototype::stage(
        snapback.auth_database_mut(),
        intent_producer,
        intent,
        include_consumed_proof,
    )
}

pub fn reconcile_commit_capsule_prototype(
    snapback: &mut LocalSnapback,
    intended: &snapback_kernel::storage::commit_capsule_prototype::PrototypeIntendedRows,
) -> SnapbackResult<
    Option<
        snapback_kernel::storage::ExactCommitRows<
            snapback_kernel::storage::commit_capsule_prototype::PrototypeIntent,
            snapback_kernel::storage::commit_capsule_prototype::PrototypeValue,
        >,
    >,
> {
    snapback_kernel::storage::commit_capsule_prototype::exact_reconciliation(
        snapback.auth_database_mut(),
        intended,
    )
}

pub fn commit_capsule_prototype_facts(
    snapback: &mut LocalSnapback,
    intent: &snapback_kernel::storage::commit_capsule_prototype::PrototypeIntent,
) -> SnapbackResult<snapback_kernel::storage::commit_capsule_prototype::PrototypeFacts> {
    snapback_kernel::storage::commit_capsule_prototype::facts(snapback.auth_database_mut(), intent)
}

/// Construct the compatibility admission used by higher-rank transport tests.
pub fn live_invalidation_admission(
    connection: crate::auth::invalidation::AuthorizationInvalidationConnection,
    session_mode: bool,
) -> LiveInvalidationAdmission {
    LiveInvalidationAdmission::new(connection).with_session_mode(session_mode)
}

/// Compatibility admission for tests that deliberately exercise a connection
/// without the authorization-invalidation protocol.
pub fn live_unscoped_invalidation_admission(
    effect_fence: crate::ephemeral::ConnectionEffectFence,
    session_mode: bool,
) -> LiveInvalidationAdmission {
    LiveInvalidationAdmission::without_invalidation(effect_fence).with_session_mode(session_mode)
}

pub fn erase_protected_record(
    snapback: &mut LocalSnapback,
    request: &crate::proof_checkpoint::ProtectedRecordErasureRequestV1,
) -> SnapbackResult<crate::proof_checkpoint::ProtectedRecordErasureReceiptV1> {
    snapback.erase_protected_record(request)
}

pub fn activate_agent_safe_operation_coverage(
    snapback: &mut LocalSnapback,
    activated_at_ms: u64,
) -> SnapbackResult<crate::commit_envelope::OperationCoverageManifestV1> {
    snapback.activate_agent_safe_operation_coverage(activated_at_ms)
}

pub fn authorization_commit_preflight_for_seed(
    snapback: &mut LocalSnapback,
    seed: &crate::manifest::SeedData,
) -> SnapbackResult<crate::storage::AuthorizationCommitPreflight> {
    snapback.authorization_commit_preflight_for_seed(seed)
}

pub fn asset_host_op(
    snapback: &mut LocalSnapback,
    operation: &str,
    input: Option<&serde_json::Value>,
    user_id: Option<&str>,
    profile: ServerProfile,
) -> SnapbackResult<serde_json::Value> {
    snapback.asset_host_op(operation, input, user_id, profile)
}

/// Return only the non-authoritative backend classification. The store handle
/// is deliberately dropped inside the owner crate.
pub fn asset_store_kind(snapback: &LocalSnapback) -> SnapbackResult<&'static str> {
    snapback.asset_store_obj().map(|store| store.kind())
}

pub fn asset_set_attempt_expiry(
    snapback: &mut LocalSnapback,
    attempt_id: &str,
    expires_at_ms: u64,
) -> SnapbackResult<()> {
    snapback.asset_set_attempt_expiry_for_test(attempt_id, expires_at_ms)
}

pub fn asset_publication_count(snapback: &mut LocalSnapback) -> SnapbackResult<u64> {
    snapback.asset_publication_count_for_test()
}

pub fn asset_attempt_state(
    snapback: &mut LocalSnapback,
    attempt_id: &str,
) -> SnapbackResult<crate::assets::AssetAttemptState> {
    snapback.asset_attempt_state_for_test(attempt_id)
}

/// Move the exact phantom-sensitive admission witness used by the HTTP
/// finalize retry regression. This helper mutates only a fixed test schema and
/// fixed row; it accepts no caller-supplied code or query shape.
pub fn asset_move_finalize_witness(
    snapback: &mut LocalSnapback,
    attempt_id: &str,
) -> SnapbackResult<()> {
    snapback.asset_move_finalize_witness_for_test(attempt_id)
}

/// Subscribe through a prepared authority, restricted to declarative plans.
/// Caller-loaded JavaScript modules are refused before evaluation.
pub fn subscribe_live_prepared_with_invalidation(
    snapback: &mut LocalSnapback,
    name: &str,
    input: LiveSubscribeInput,
    authority: PreparedAuthority,
    invalidation: LiveInvalidationAdmission,
) -> SnapbackResult<LiveSubscribeOutput> {
    snapback.require_host_plan_for_test_support(name)?;
    snapback.subscribe_live_prepared_with_invalidation(name, input, authority, invalidation)
}

/// Build the protocol-test authority and subscribe to a declarative plan.
/// Caller-loaded JavaScript modules are refused before evaluation.
pub fn subscribe_live_host_plan_with_invalidation(
    snapback: &mut LocalSnapback,
    name: &str,
    input: LiveSubscribeInput,
    invalidation: LiveInvalidationAdmission,
) -> SnapbackResult<LiveSubscribeOutput> {
    snapback.require_host_plan_for_test_support(name)?;
    snapback.subscribe_live_with_invalidation(name, input, invalidation)
}

/// Install the deterministic stream identities and real retained-live
/// scheduler used by LLP 0209's frozen cross-crate corpus.
pub fn configure_graph_corpus_scheduler(
    snapback: &mut LocalSnapback,
    authorization: crate::storage::AuthorizationVersion,
    data_version_stream: &str,
) -> SnapbackResult<crate::auth::invalidation::AuthorizationInvalidationConnection> {
    snapback.configure_graph_corpus_scheduler_for_test(authorization, data_version_stream)
}

/// Bind the corpus scheduler's authorization stream to the canonical second
/// principal's real sessions-mode connection.
pub fn graph_corpus_other_principal_connection(
    snapback: &mut LocalSnapback,
    authorization: crate::storage::AuthorizationVersion,
) -> SnapbackResult<crate::auth::invalidation::AuthorizationInvalidationConnection> {
    snapback.graph_corpus_other_principal_connection_for_test(authorization)
}

/// Return the configured corpus scheduler's authority-fence control so a
/// delivery-time-gate test can overlap a retained evaluation with the exact
/// lock-free marking step used by the production authority transition.
pub fn graph_corpus_scheduler_control(
    snapback: &LocalSnapback,
) -> SnapbackResult<std::sync::Arc<crate::live_coalesce::LiveFanoutCoalescer>> {
    snapback.graph_corpus_scheduler_control_for_test()
}

/// Bind a sessions-mode fixture clone's existing authorization stream for a
/// read-only served-path measurement. No catalog or identity rows are added.
pub fn configure_graph_measurement_scheduler(
    snapback: &mut LocalSnapback,
) -> SnapbackResult<crate::auth::invalidation::AuthorizationInvalidationConnection> {
    snapback.configure_graph_measurement_scheduler_for_test()
}

/// Establish a corpus graph with the real sessions-mode retained authority
/// and invalidation protocol. Caller-loaded JavaScript remains refused.
pub fn subscribe_graph_corpus_case(
    snapback: &mut LocalSnapback,
    name: &str,
    input: LiveSubscribeInput,
    connection: crate::auth::invalidation::AuthorizationInvalidationConnection,
) -> SnapbackResult<LiveSubscribeOutput> {
    snapback.require_host_plan_for_test_support(name)?;
    snapback.subscribe_graph_corpus_case_for_test(name, input, connection)
}

/// Establish the same corpus graph under a second owner-issued authority
/// instance for partition-isolation evidence. Both instances resolve to the
/// fixed corpus principal and session; only the host-owned prepared authority
/// instance rotates, matching the engine's authority-isolation test pattern.
pub fn subscribe_graph_corpus_partition_case(
    snapback: &mut LocalSnapback,
    name: &str,
    input: LiveSubscribeInput,
    connection: crate::auth::invalidation::AuthorizationInvalidationConnection,
) -> SnapbackResult<LiveSubscribeOutput> {
    snapback.require_host_plan_for_test_support(name)?;
    snapback.subscribe_graph_corpus_partition_case_for_test(name, input, connection)
}

/// Establish the corpus graph for the canonical second principal under its
/// first owner-issued authority instance.
pub fn subscribe_graph_corpus_other_principal_case(
    snapback: &mut LocalSnapback,
    name: &str,
    input: LiveSubscribeInput,
    connection: crate::auth::invalidation::AuthorizationInvalidationConnection,
) -> SnapbackResult<LiveSubscribeOutput> {
    snapback.require_host_plan_for_test_support(name)?;
    snapback.subscribe_graph_corpus_other_principal_case_for_test(name, input, connection)
}

/// Resolve the canonical second principal's alternate owner-issued authority
/// instance and drive the affected retained subscription through the shared
/// fail-closed authority-event/fence/restoration lifecycle.
pub fn transition_graph_corpus_other_principal_authority_instance(
    snapback: &mut LocalSnapback,
    subscription_id: &str,
) -> SnapbackResult<()> {
    snapback.transition_graph_corpus_other_principal_authority_instance_for_test(subscription_id)
}

/// Exact per-subscription activity counters for authority-isolation evidence.
pub fn graph_corpus_subscription_activity(
    snapback: &LocalSnapback,
    subscription_id: &str,
) -> Option<serde_json::Value> {
    snapback.graph_corpus_subscription_activity_for_test(subscription_id)
}

/// Commit one declarative corpus mutation through the ordinary mutation and
/// post-commit fan-out path. Caller-loaded JavaScript remains refused.
pub fn invoke_graph_corpus_mutation(
    snapback: &mut LocalSnapback,
    name: &str,
    input: HandlerInput,
) -> SnapbackResult<crate::manifest::MutationOutput> {
    snapback.require_host_plan_for_test_support(name)?;
    snapback.invoke_graph_corpus_mutation_for_test(name, input)
}

pub fn graph_corpus_authorization_frames(
    snapback: &mut LocalSnapback,
    connection_id: &str,
) -> SnapbackResult<Vec<String>> {
    snapback.graph_corpus_authorization_frames_for_test(connection_id)
}

/// Drain the corpus connection through its retained sessions-mode effect
/// fence, matching the guarded transport path used by production serving.
pub fn drain_graph_corpus_stream(snapback: &LocalSnapback, connection_id: &str) -> Vec<String> {
    snapback.drain_graph_corpus_stream_for_test(connection_id)
}

/// Refresh every served graph through the production memo/group path and
/// return measurements read from the retained memo entries themselves.
pub fn measure_graph_serving_groups(
    snapback: &mut LocalSnapback,
) -> SnapbackResult<serde_json::Value> {
    snapback.measure_graph_serving_groups_for_test()
}

/// Drive either every retained graph or one named subscription through the
/// production refresh scheduler. The targeted arm exists for tuple-isolation
/// cases where predecessor memo holders must remain installed.
pub fn refresh_graph_corpus_scheduler(
    snapback: &mut LocalSnapback,
    only_subscription: Option<&str>,
) -> SnapbackResult<bool> {
    snapback.refresh_graph_corpus_scheduler_for_test(only_subscription)
}

pub fn set_graph_corpus_memo_limits(
    snapback: &mut LocalSnapback,
    max_entries: usize,
    max_bytes: usize,
) {
    snapback.set_graph_corpus_memo_limits_for_test(max_entries, max_bytes);
}

pub fn graph_corpus_memo_entries(snapback: &LocalSnapback) -> serde_json::Value {
    snapback.graph_corpus_memo_entries_for_test()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_live_helper_refuses_caller_loaded_javascript() {
        let mut snapback = LocalSnapback::memory().expect("memory test-support audit fixture");
        let diagnostics = snapback.load_functions(FunctionManifest {
            functions: vec![crate::manifest::FunctionDefinition::new(
                "callerJavascript",
                crate::manifest::FunctionKind::LiveQuery,
                FunctionRuntime::IbexModule(IbexModule {
                    source: r#"
globalThis.__snapbackHandlers = {
  async callerJavascript(ctx) {
    return await ctx.db.elevated.query("secrets").collect();
  }
};
"#
                    .to_owned(),
                    export: "callerJavascript".to_owned(),
                }),
            )],
            ..FunctionManifest::default()
        });
        assert!(
            !diagnostics.iter().any(|diagnostic| matches!(
                diagnostic.severity,
                crate::diagnostic::DiagnosticSeverity::Error
                    | crate::diagnostic::DiagnosticSeverity::Fatal
            )),
            "caller module must load so the guard, not fixture validation, is tested: {diagnostics:?}",
        );

        let error = subscribe_live_host_plan_with_invalidation(
            &mut snapback,
            "callerJavascript",
            LiveSubscribeInput {
                connection_id: "test-support-audit".to_owned(),
                input: HandlerInput::default(),
                authorization_namespace: None,
                supersedes: None,
                resume_from_token: None,
            },
            LiveInvalidationAdmission::default(),
        )
        .expect_err("public test-support helper must refuse caller-loaded JavaScript");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_TEST_SUPPORT_RUNTIME_FORBIDDEN"
        );
    }
}
