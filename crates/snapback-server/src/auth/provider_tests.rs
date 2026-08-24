pub use snapback_auth::auth::provider::*;

use crate::auth::crypto::*;
use crate::auth::keyring::{
    AUTH_KEY_ROTATION_AGE_MS, AUTH_RETIRED_KEY_MINIMUM_AGE_MS, AuthKeyringStore,
};
use crate::auth::lease::*;
use crate::auth::lifecycle::KeyringGcResult;
use crate::auth::mailbox::{CaptureMailbox, CaptureMailboxEntry};
use crate::auth::session_projection::ProjectedSessionInsert;
use crate::auth::throttle::*;
use crate::auth::wire::*;
use crate::contract_types::*;
use crate::storage::auth::AuthTransactionAttempt;
use crate::storage::{LocalDatabase, ServingDatabase};
use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher as _};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::admission::AdmissionController;
    use crate::auth::coordinator::{
        AuthCoordinator, CommittedRevocationTarget, IssuanceFinish, PasswordChangeFinish,
        RotationFinish,
    };
    use crate::auth::identity_core::{AssuranceKind, PasswordSecret};
    use crate::auth::mode::AuthModeStateRecord;
    use crate::auth::sender_proof::{SenderIssuanceCommitment, VerifiedSenderIssuance};
    use crate::auth::session_projection::{
        ProjectedTokenResolution, SessionProjection, TerminalAuthorityDisposition,
    };
    use base64::Engine;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use serde_json::Value;
    use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};

    fn coordinator_admission() -> AdmissionController {
        AdmissionController::from_mode_state(&AuthModeStateRecord::initial_dev(None))
            .expect("test coordinator admission")
    }

    struct CountingConstantRandom {
        fills: AtomicUsize,
        byte: u8,
    }

    impl CountingConstantRandom {
        fn new(byte: u8) -> Self {
            Self {
                fills: AtomicUsize::new(0),
                byte,
            }
        }

        fn fills(&self) -> usize {
            self.fills.load(Ordering::SeqCst)
        }
    }

    impl RandomSource for CountingConstantRandom {
        fn fill(&self, destination: &mut [u8]) -> Result<(), super::super::crypto::CryptoError> {
            self.fills.fetch_add(1, Ordering::SeqCst);
            destination.fill(self.byte);
            Ok(())
        }
    }

    struct PartialFailureRandom;

    impl RandomSource for PartialFailureRandom {
        fn fill(&self, destination: &mut [u8]) -> Result<(), super::super::crypto::CryptoError> {
            let partial = destination.len().div_ceil(2);
            destination[..partial].fill(0xa5);
            Err(super::super::crypto::CryptoError::RandomUnavailable)
        }
    }

    struct ToggleFailureRandom {
        unavailable: AtomicBool,
    }

    impl RandomSource for ToggleFailureRandom {
        fn fill(&self, destination: &mut [u8]) -> Result<(), super::super::crypto::CryptoError> {
            if self.unavailable.load(Ordering::SeqCst) {
                return Err(super::super::crypto::CryptoError::RandomUnavailable);
            }
            OsRandom.fill(destination)
        }
    }

    #[test]
    fn guest_creation_refuses_csprng_failure_before_planning_an_effect() {
        let now_ms = 1_700_000_000_000;
        let mut database = LocalDatabase::memory().expect("memory database");
        database
            .activate_current_auth_catalog()
            .expect("auth catalog");
        let keyring = Arc::new(AuthKeyringStore::in_memory());
        keyring
            .load_or_mint_initial(now_ms, &OsRandom)
            .expect("initial keyring");
        let random = Arc::new(ToggleFailureRandom {
            unavailable: AtomicBool::new(false),
        });
        let provider = AuthProvider::new_with_dependencies(
            AuthProviderProfile::Test,
            keyring,
            random.clone(),
            Arc::new(ManualClock::new(now_ms)),
        )
        .expect("provider initializes while randomness is available");
        random.unavailable.store(true, Ordering::SeqCst);
        let error = provider
            .plan_guest_session(
                &mut database,
                now_ms,
                60_000,
                snapback_kernel::auth::throttle::RollingWindowBudgetTerms {
                    limit: 10,
                    window_ms: 1_000,
                },
                "guest-csprng-failure-key",
                "guest-test-app",
                "guest-test-deployment",
                &format!("sha256:{}", "a".repeat(64)),
                PasswordIssuanceCustody::Bearer,
            )
            .expect_err("guest creation must fail closed without CSPRNG");
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_RANDOM_UNAVAILABLE");
    }

    #[test]
    fn guest_creation_charges_both_finite_effect_budgets_at_commit() {
        let now_ms = 1_700_000_000_000;
        let (provider, mut database) =
            provider_database_for_profile(now_ms, AuthProviderProfile::Prod);
        for index in 0..10 {
            let planned = provider
                .plan_guest_session(
                    &mut database,
                    now_ms,
                    60_000,
                    snapback_kernel::auth::throttle::RollingWindowBudgetTerms {
                        limit: 10,
                        window_ms: 1_000,
                    },
                    &format!("guest-budget-admitted-{index:04}"),
                    "guest-test-app",
                    "guest-test-deployment",
                    &format!("sha256:{}", "a".repeat(64)),
                    PasswordIssuanceCustody::Bearer,
                )
                .expect("admitted guest plan");
            let ProviderGuestSessionPlan::Planned(plan) = planned else {
                panic!("fresh guest key must produce a plan");
            };
            assert!(matches!(
                provider.commit_guest_issuance(&mut database, &plan.commit_plan()),
                AuthTransactionAttempt::Committed(PlannedIssuanceCommit::Committed { .. })
            ));
        }
        let denied = provider
            .plan_guest_session(
                &mut database,
                now_ms,
                60_000,
                snapback_kernel::auth::throttle::RollingWindowBudgetTerms {
                    limit: 10,
                    window_ms: 1_000,
                },
                "guest-budget-denied-001",
                "guest-test-app",
                "guest-test-deployment",
                &format!("sha256:{}", "a".repeat(64)),
                PasswordIssuanceCustody::Bearer,
            )
            .expect("budget denial is decided at the atomic commit cut");
        let ProviderGuestSessionPlan::Planned(denied) = denied else {
            panic!("fresh denied guest key must reach the commit cut");
        };
        assert!(matches!(
            provider.commit_guest_issuance(&mut database, &denied.commit_plan()),
            AuthTransactionAttempt::Committed(PlannedIssuanceCommit::GuestBudgetRefused {
                budget_name: "auth.guest.create",
                retry_after_ms: 1_000,
                ..
            })
        ));
    }

    #[test]
    fn guest_creation_committed_replay_is_exact_and_same_key_conflict_refuses() {
        let now_ms = 1_700_000_000_000;
        let (provider, mut database) =
            provider_database_for_profile(now_ms, AuthProviderProfile::Test);
        let policy_a = format!("sha256:{}", "a".repeat(64));
        let policy_b = format!("sha256:{}", "b".repeat(64));
        let key = "guest-entry-provider-replay-0001";
        let planned = provider
            .plan_guest_session(
                &mut database,
                now_ms,
                60_000,
                snapback_kernel::auth::throttle::RollingWindowBudgetTerms {
                    limit: 10,
                    window_ms: 1_000,
                },
                key,
                "guest-test-app",
                "guest-test-deployment",
                &policy_a,
                PasswordIssuanceCustody::Bearer,
            )
            .expect("initial guest plan");
        let ProviderGuestSessionPlan::Planned(plan) = planned else {
            panic!("fresh key must plan");
        };
        let committed = provider.commit_guest_issuance(&mut database, &plan.commit_plan());
        let AuthTransactionAttempt::Committed(PlannedIssuanceCommit::Committed {
            session,
            committed_revocations,
        }) = committed
        else {
            panic!("initial guest must commit");
        };
        let initial = plan.into_issue(session, committed_revocations);
        let replay = provider
            .plan_guest_session(
                &mut database,
                now_ms + 1,
                60_000,
                snapback_kernel::auth::throttle::RollingWindowBudgetTerms {
                    limit: 10,
                    window_ms: 1_000,
                },
                key,
                "guest-test-app",
                "guest-test-deployment",
                &policy_a,
                PasswordIssuanceCustody::Bearer,
            )
            .expect("committed guest replay");
        let ProviderGuestSessionPlan::Replay(replay) = replay else {
            panic!("same request must replay");
        };
        assert_eq!(
            replay.response().token().expose_secret(),
            initial.response().token().expose_secret()
        );
        assert_eq!(replay.response().session, initial.response().session);

        let conflict = provider
            .plan_guest_session(
                &mut database,
                now_ms + 2,
                60_000,
                snapback_kernel::auth::throttle::RollingWindowBudgetTerms {
                    limit: 10,
                    window_ms: 1_000,
                },
                key,
                "guest-test-app",
                "guest-test-deployment",
                &policy_b,
                PasswordIssuanceCustody::Bearer,
            )
            .expect("same-key request conflict");
        assert!(matches!(conflict, ProviderGuestSessionPlan::Conflict));
    }

    #[test]
    fn guest_entry_replay_key_is_retained_then_bounded_gc_reclaims_it() {
        let mut database = LocalDatabase::memory().expect("memory database");
        database
            .activate_current_auth_catalog()
            .expect("auth catalog");
        let keyring = Arc::new(AuthKeyringStore::in_memory());
        keyring
            .load_or_mint_initial(0, &OsRandom)
            .expect("initial keyring");
        let guest_now = AUTH_KEY_ROTATION_AGE_MS - 1;
        let guest_retention_ms = 7 * 24 * 60 * 60 * 1_000;
        let provider = AuthProvider::new_with_dependencies(
            AuthProviderProfile::Test,
            keyring.clone(),
            Arc::new(OsRandom),
            Arc::new(ManualClock::new(guest_now)),
        )
        .expect("provider");
        let retired_key = keyring
            .with_active_key(guest_now, &OsRandom, |key_id, _| key_id.as_str().to_owned())
            .expect("entry derivation key");
        let policy = format!("sha256:{}", "a".repeat(64));
        let planned = provider
            .plan_guest_session(
                &mut database,
                guest_now,
                guest_retention_ms,
                RollingWindowBudgetTerms {
                    limit: 10,
                    window_ms: 1_000,
                },
                "guest-entry-retained-key-0001",
                "guest-test-app",
                "guest-test-deployment",
                &policy,
                PasswordIssuanceCustody::Bearer,
            )
            .expect("guest plan");
        let ProviderGuestSessionPlan::Planned(plan) = planned else {
            panic!("fresh key must plan");
        };
        let AuthTransactionAttempt::Committed(PlannedIssuanceCommit::Committed { .. }) =
            provider.commit_guest_issuance(&mut database, &plan.commit_plan())
        else {
            panic!("guest must commit");
        };

        assert!(
            keyring
                .rotate_if_due(AUTH_KEY_ROTATION_AGE_MS, &OsRandom)
                .expect("rotate entry key")
        );
        let first_prune = AUTH_KEY_ROTATION_AGE_MS + AUTH_RETIRED_KEY_MINIMUM_AGE_MS;
        assert_eq!(
            keyring
                .prune_retired(first_prune, &OsRandom, |key_id| {
                    database
                        .auth_key_is_referenced(key_id.as_str())
                        .map_err(|_| crate::auth::keyring::KeyringError::Unavailable)
                })
                .expect("referenced prune"),
            0
        );
        assert!(
            database
                .auth_retained_key_ids()
                .expect("retained keys")
                .contains(&retired_key)
        );
        assert!(matches!(
            provider
                .plan_guest_session(
                    &mut database,
                    first_prune,
                    guest_retention_ms,
                    RollingWindowBudgetTerms {
                        limit: 10,
                        window_ms: 1_000,
                    },
                    "guest-entry-retained-key-0001",
                    "guest-test-app",
                    "guest-test-deployment",
                    &policy,
                    PasswordIssuanceCustody::Bearer,
                )
                .expect("replay after key rotation"),
            ProviderGuestSessionPlan::Replay(_)
        ));

        let retention_deadline = guest_now + guest_retention_ms;
        database
            .auth_gc(retention_deadline)
            .expect("bounded replay GC");
        assert_eq!(
            keyring
                .prune_retired(retention_deadline, &OsRandom, |key_id| {
                    database
                        .auth_key_is_referenced(key_id.as_str())
                        .map_err(|_| crate::auth::keyring::KeyringError::Unavailable)
                })
                .expect("expired replay key prune"),
            1
        );
        assert!(
            !database
                .auth_retained_key_ids()
                .expect("retained keys after GC")
                .contains(&retired_key)
        );
    }

    #[test]
    fn partial_rng_failure_zeroizes_the_candidate_buffer() {
        let mut candidate = [0x5a; 10];
        let error = fill_random_or_unavailable(&PartialFailureRandom, &mut candidate)
            .expect_err("partial fill must fail closed");
        assert_eq!(
            error.diagnostic().code,
            "SNAPBACK_AUTH_PROVIDER_UNAVAILABLE"
        );
        assert_eq!(candidate, [0_u8; 10]);
    }

    struct ManualClock {
        epoch_ms: AtomicU64,
        monotonic_origin: Instant,
    }

    impl ManualClock {
        fn new(epoch_ms: u64) -> Self {
            Self {
                epoch_ms: AtomicU64::new(epoch_ms),
                monotonic_origin: Instant::now(),
            }
        }

        fn set(&self, epoch_ms: u64) {
            self.epoch_ms.store(epoch_ms, Ordering::SeqCst);
        }
    }

    impl AuthClock for ManualClock {
        fn epoch_ms(&self) -> u64 {
            self.epoch_ms.load(Ordering::SeqCst)
        }

        fn monotonic_now(&self) -> Instant {
            self.monotonic_origin + Duration::from_millis(self.epoch_ms())
        }
    }

    fn provider_database_for_profile(
        now_ms: u64,
        profile: AuthProviderProfile,
    ) -> (Arc<AuthProvider>, LocalDatabase) {
        let mut database = LocalDatabase::memory().expect("memory database");
        let keyring = Arc::new(AuthKeyringStore::in_memory());
        keyring
            .load_or_mint_initial(now_ms, &OsRandom)
            .expect("initial keyring");
        database
            .activate_current_auth_catalog()
            .expect("activate catalog");
        let provider = Arc::new(AuthProvider::new(profile, keyring).expect("auth provider"));
        (provider, database)
    }

    fn provider_database(now_ms: u64) -> (Arc<AuthProvider>, LocalDatabase) {
        provider_database_for_profile(now_ms, AuthProviderProfile::Test)
    }

    fn password_provider_database_coordinator(
        now_ms: u64,
    ) -> (Arc<AuthProvider>, LocalDatabase, Arc<AuthCoordinator>) {
        password_provider_database_coordinator_with_minimum(
            now_ms,
            crate::contract_types::AUTH_PASSWORD_MINIMUM_LENGTH_DEFAULT,
        )
    }

    fn password_provider_database_coordinator_with_minimum(
        now_ms: u64,
        minimum_password_length: u16,
    ) -> (Arc<AuthProvider>, LocalDatabase, Arc<AuthCoordinator>) {
        let mut database = LocalDatabase::memory().expect("memory database");
        database
            .activate_current_auth_catalog_with_password_identifier_mode(
                crate::storage::auth::PasswordIdentifierMode::EmailV1,
            )
            .expect("activate catalog v4");
        database
            .ensure_authorization_stream_incarnation()
            .expect("authorization stream");
        let keyring = Arc::new(AuthKeyringStore::in_memory());
        keyring
            .load_or_mint_initial(now_ms, &OsRandom)
            .expect("initial keyring");
        // Password-set tests mint their email step-up session two milliseconds
        // after the fixture epoch. Keep provider-sampled challenge time in the
        // same deterministic epoch instead of consulting the wall clock.
        let provider = Arc::new(
            AuthProvider::new_with_dependencies_and_password_minimum(
                AuthProviderProfile::Test,
                keyring,
                Arc::new(OsRandom),
                Arc::new(ManualClock::new(now_ms + 2)),
                minimum_password_length,
            )
            .expect("auth provider"),
        );
        let snapshot = database
            .admitted_session_projection_snapshot()
            .expect("admitted projection snapshot");
        let coordinator = Arc::new(
            AuthCoordinator::from_admitted_snapshot(
                snapshot,
                coordinator_admission(),
                now_ms,
                provider.monotonic_now(),
            )
            .expect("coordinator"),
        );
        (provider, database, coordinator)
    }

    async fn commit_password_issuance_for_test(
        provider: &Arc<AuthProvider>,
        database: &mut LocalDatabase,
        coordinator: &Arc<AuthCoordinator>,
        plan: ProviderSessionIssuancePlan,
        now_ms: u64,
    ) -> (
        IssuanceFinish,
        Vec<crate::auth::coordinator::CommittedRevocationTarget>,
    ) {
        let carrier = coordinator
            .premark_issuance(plan)
            .await
            .expect("premark password issuance");
        let commit_plan = carrier.plan().commit_plan();
        let attempt = provider.commit_password_issuance(database, &commit_plan);
        let (outcome, targets) = coordinator
            .finish_issuance(carrier, attempt, now_ms, provider.monotonic_now())
            .into_parts();
        (outcome.expect("finish issuance"), targets)
    }

    async fn register_password_for_test(
        provider: &Arc<AuthProvider>,
        database: &mut LocalDatabase,
        coordinator: &Arc<AuthCoordinator>,
        identifier: &str,
        password: &str,
        now_ms: u64,
    ) -> CredentialIssue {
        let plan = provider
            .plan_password_registration(
                database,
                identifier,
                PasswordSecret::new(password.to_owned()),
                now_ms,
                "recovery-key-1",
                &[7; 32],
                PasswordIssuanceCustody::Bearer,
            )
            .await
            .expect("password registration plan");
        let (finish, targets) =
            commit_password_issuance_for_test(provider, database, coordinator, plan, now_ms).await;
        assert!(targets.is_empty());
        let IssuanceFinish::Committed { issue, .. } = finish else {
            panic!("password registration must commit");
        };
        issue
    }

    async fn password_signin_for_test(
        provider: &Arc<AuthProvider>,
        database: &mut LocalDatabase,
        coordinator: &Arc<AuthCoordinator>,
        identifier: &str,
        password: &str,
        now_ms: u64,
    ) -> (
        IssuanceFinish,
        Vec<crate::auth::coordinator::CommittedRevocationTarget>,
    ) {
        let plan = provider
            .plan_password_authentication(
                database,
                identifier,
                PasswordSecret::new(password.to_owned()),
                now_ms,
                PasswordIssuanceCustody::Bearer,
            )
            .await
            .expect("password signin plan");
        commit_password_issuance_for_test(provider, database, coordinator, plan, now_ms).await
    }

    async fn email_issue_for_test(
        provider: &Arc<AuthProvider>,
        database: &mut LocalDatabase,
        coordinator: &Arc<AuthCoordinator>,
        address: &str,
        now_ms: u64,
    ) -> CredentialIssue {
        let admission = provider
            .admit_email(address)
            .await
            .expect("email issuance admission");
        let plan = admission
            .plan_mint_session(database, now_ms)
            .expect("email issuance plan");
        let commit_plan = plan.commit_plan();
        let carrier = coordinator
            .premark_issuance(plan)
            .await
            .expect("premark email issuance");
        let attempt = admission.commit_planned_issuance(database, &commit_plan);
        let (finish, targets) = coordinator
            .finish_issuance(carrier, attempt, now_ms, provider.monotonic_now())
            .into_parts();
        assert!(targets.is_empty());
        let IssuanceFinish::Committed { issue, .. } = finish.expect("finish email issuance") else {
            panic!("email issuance must commit");
        };
        issue
    }

    async fn password_change_for_test(
        provider: &Arc<AuthProvider>,
        database: &mut LocalDatabase,
        coordinator: &Arc<AuthCoordinator>,
        acting: &SessionBearer,
        current: &str,
        replacement: &str,
        now_ms: u64,
    ) -> (
        PasswordChangeFinish,
        Vec<crate::auth::coordinator::CommittedRevocationTarget>,
    ) {
        let plan = provider
            .plan_password_change(
                database,
                acting,
                PasswordSecret::new(current.to_owned()),
                PasswordSecret::new(replacement.to_owned()),
                now_ms,
                PasswordIssuanceCustody::Bearer,
            )
            .await
            .expect("password change plan");
        let commit_plan = plan.commit_plan();
        let carrier = coordinator
            .premark_password_change(plan)
            .await
            .expect("premark password change");
        let attempt = provider.commit_password_change(database, &commit_plan);
        let (finish, targets) = coordinator
            .finish_password_change(carrier, attempt)
            .into_parts();
        (finish.expect("finish password change"), targets)
    }

    fn projected_terminal_reason_after_restart(
        database: &mut LocalDatabase,
        bearer: &str,
        now_ms: u64,
    ) -> RevocationReason {
        let source = database
            .session_projection_source()
            .expect("restart projection source");
        let monotonic_now = Instant::now();
        let projection =
            SessionProjection::rebuild_with_fresh_startup_id(source, now_ms, monotonic_now)
                .expect("restart projection");
        let digest = TokenDigest::from_token_hash(
            &SessionBearer::parse(bearer)
                .expect("test bearer")
                .token_hash(),
        );
        match projection
            .resolve_token(&digest, now_ms, monotonic_now)
            .expect("restart token resolution")
        {
            ProjectedTokenResolution::Terminal { reason } => reason,
            resolution => panic!("expected terminal restart resolution, got {resolution:?}"),
        }
    }

    fn provider_database_with_random(
        now_ms: u64,
        random: Arc<dyn RandomSource>,
    ) -> (Arc<AuthProvider>, LocalDatabase) {
        let mut database = LocalDatabase::memory().expect("memory database");
        let keyring = Arc::new(AuthKeyringStore::in_memory());
        keyring
            .load_or_mint_initial(now_ms, &OsRandom)
            .expect("initial keyring");
        database
            .activate_current_auth_catalog()
            .expect("activate catalog");
        let provider = Arc::new(
            AuthProvider::new_with_dependencies(
                AuthProviderProfile::Test,
                keyring,
                random,
                Arc::new(SystemAuthClock),
            )
            .expect("auth provider"),
        );
        (provider, database)
    }

    #[tokio::test]
    async fn frozen_v1_catalog_keeps_email_code_and_session_provider_usable() {
        let mut database = LocalDatabase::memory().expect("memory database");
        crate::storage::auth::install_frozen_v1_catalog_fixture(&mut database)
            .expect("install exact frozen v1 fixture");
        assert_eq!(
            database.inspect_auth_catalog().unwrap(),
            crate::storage::auth::AuthCatalogState::ReadyV1
        );

        let keyring = Arc::new(AuthKeyringStore::in_memory());
        keyring
            .load_or_mint_initial(0, &OsRandom)
            .expect("initial keyring");
        let provider =
            Arc::new(AuthProvider::new(AuthProviderProfile::Test, keyring).expect("auth provider"));
        let (challenge, code) =
            request_and_code(&provider, &mut database, "legacy@example.com", 0).await;
        let issued = exchange(&provider, &mut database, &challenge.challenge_id, &code, 1)
            .await
            .expect("frozen v1 exchange");

        assert_eq!(issued.response().session.provider, "email-code");
        assert_eq!(
            database.inspect_auth_catalog().unwrap(),
            crate::storage::auth::AuthCatalogState::ReadyV1
        );
        let session_count: i64 = database
            .auth_catalog_read()
            .session_count_for_test()
            .unwrap();
        assert_eq!(session_count, 1);
    }

    #[test]
    fn file_backed_keyring_reopens_and_verifies_an_independently_bound_authorized_lease() {
        let now_ms = 1_800_000_000_000;
        let directory = tempfile::tempdir().expect("keyring directory");
        let database_path = directory.path().join("provider.sqlite");
        let issuing_keyring = Arc::new(AuthKeyringStore::file_for_database(&database_path));
        issuing_keyring
            .load_or_mint_initial(now_ms, &OsRandom)
            .expect("initial file-backed keyring");
        let issuing_provider = AuthProvider::new(AuthProviderProfile::Test, issuing_keyring)
            .expect("issuing auth provider");
        let incarnation = "01890f3c-9d5b-7000-8000-000000000001".to_owned();
        let lease = issuing_provider
            .issue_authorized_lease_at(
                AuthorizedLeaseIssue {
                    lease_id: "lease_provider_1".to_owned(),
                    lease_request_id: "request_provider_1".to_owned(),
                    issuer_id: crate::auth::invalidation::IssuerId {
                        authorization_incarnation: incarnation.clone(),
                        boot_sequence: 1,
                        boot_nonce: "AQEBAQEBAQEBAQEBAQEBAQ".to_owned(),
                    },
                    client_store_id: "store_provider_1".to_owned(),
                    query_key: "myHand:{game=1}".to_owned(),
                    query_instance_id: 1,
                    principal_id: "user_provider_1".to_owned(),
                    session_id_at_issue: None,
                    provider_key: Some("email-code".to_owned()),
                    authorization: crate::storage::AuthorizationVersion {
                        incarnation,
                        epoch: 1,
                    },
                    data: crate::auth::lease::AuthorizedLeaseData {
                        version_stream: "01890f3c-9d5b-7000-8000-000000000002".to_owned(),
                        snapshot_commit_version: 7,
                    },
                    activation_hash: format!(
                        "snapback.authorized-lease.activation.v1:sha256:{}",
                        "a".repeat(64)
                    ),
                    session_not_after_ms: None,
                    provider_not_after_ms: None,
                    authority_instance_id: None,
                },
                AuthorizedLeaseConfig::default(),
                now_ms,
                "local-dev-sqlite-ibex",
                "provider-test",
            )
            .expect("issue through file-backed keyring");
        drop(issuing_provider);

        let verifying_keyring = Arc::new(AuthKeyringStore::file_for_database(&database_path));
        verifying_keyring
            .load_existing()
            .expect("reopen file-backed keyring");
        let verifying_provider = AuthProvider::new(AuthProviderProfile::Test, verifying_keyring)
            .expect("verifying auth provider");
        let expectation = AuthorizedLeaseExpectation::from(&lease);
        let verified = verifying_provider
            .verify_authorized_lease_at(
                &lease,
                &expectation,
                AuthorizedLeaseConfig::default(),
                now_ms + 1,
                "local-dev-sqlite-ibex",
                "provider-test",
            )
            .expect("verify with independently supplied service binding");
        assert_eq!(verified.lease(), &lease);
        assert_eq!(verified.verified_at_server_ms(), now_ms + 1);

        let mut wrong_binding = expectation;
        wrong_binding.query_key = "myHand:{game=2}".to_owned();
        let error = verifying_provider
            .verify_authorized_lease_at(
                &lease,
                &wrong_binding,
                AuthorizedLeaseConfig::default(),
                now_ms + 1,
                "local-dev-sqlite-ibex",
                "provider-test",
            )
            .expect_err("service binding must not be self-described by the lease");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTHORIZED_LEASE_BOUNDARY_MISMATCH"
        );
    }

    async fn request_and_code(
        provider: &Arc<AuthProvider>,
        database: &mut LocalDatabase,
        email: &str,
        now_ms: u64,
    ) -> (RequestCodeResponse, String) {
        let admission = provider
            .admit_email(email)
            .await
            .expect("address admission");
        let response = admission
            .request_code(database, now_ms)
            .expect("request code");
        drop(admission);
        let mailbox = provider
            .mailbox_entry(&response.challenge_id)
            .await
            .expect("mailbox entry");
        let value = serde_json::to_value(mailbox).expect("serialize mailbox entry");
        let code = value
            .get("code")
            .and_then(Value::as_str)
            .expect("mailbox code")
            .to_owned();
        (response, code)
    }

    async fn exchange(
        provider: &Arc<AuthProvider>,
        database: &mut LocalDatabase,
        challenge_id: &str,
        code: &str,
        now_ms: u64,
    ) -> ProviderResult<CredentialIssue> {
        let admission = provider.admit().await;
        let coordination = admission
            .exchange_coordination(database, challenge_id)?
            .expect("known challenge");
        admission
            .for_exchange(coordination)
            .await?
            .exchange(database, code, now_ms)
    }

    fn different_code(code: &str) -> String {
        let replacement = if code.as_bytes()[0] == b'0' { '1' } else { '0' };
        format!("{replacement}{}", &code[1..])
    }

    fn issue_token(issue: &CredentialIssue) -> String {
        let value = serde_json::to_value(issue.response()).expect("serialize credential");
        value
            .get("token")
            .and_then(Value::as_str)
            .expect("credential token")
            .to_owned()
    }

    async fn mint(
        provider: &Arc<AuthProvider>,
        database: &mut LocalDatabase,
        email: &str,
        now_ms: u64,
    ) -> CredentialIssue {
        provider
            .admit_email(email)
            .await
            .expect("mint admission")
            .mint_session(database, now_ms)
            .expect("mint session")
    }

    fn direct_stream_facts(database: &mut LocalDatabase) -> (u64, i64) {
        let version = database.versions().current_version().expect("app version");
        let changes = database
            .auth_catalog_read()
            .change_journal_count_for_test()
            .expect("journal count");
        (version, changes)
    }

    #[tokio::test]
    async fn request_code_has_exact_window_supersession_and_no_app_stream_effect() {
        let (provider, mut database) = provider_database(0);
        let mut responses = Vec::new();
        for _ in 0..AUTH_ADDRESS_REQUEST_LIMIT {
            let admission = provider
                .admit_email("Person@Example.com")
                .await
                .expect("admission");
            responses.push(
                admission
                    .request_code(&mut database, 0)
                    .expect("request inside limit"),
            );
        }
        let admission = provider
            .admit_email("person@example.com")
            .await
            .expect("admission");
        let error = admission
            .request_code(&mut database, 0)
            .expect_err("sixth rolling-window request must throttle");
        assert_eq!(error.diagnostic().code, "SNAPBACK_AUTH_THROTTLED");
        assert_eq!(error.diagnostic().details["budgetName"], "auth.delivery");
        assert_eq!(error.diagnostic().details["retryAfter"]["kind"], "duration");
        assert_eq!(
            error.diagnostic().details["retryAfter"]["milliseconds"],
            AUTH_ADDRESS_REQUEST_WINDOW_MS
        );
        assert!(
            error.diagnostic().details["correlationId"]
                .as_str()
                .is_some_and(|value| !value.is_empty())
        );
        drop(admission);

        let first = provider
            .mailbox_entry(&responses[0].challenge_id)
            .await
            .expect_err("superseded plaintext must be erased");
        assert_eq!(
            first.diagnostic().code,
            "SNAPBACK_AUTH_MAILBOX_ENTRY_NOT_FOUND"
        );
        provider
            .mailbox_entry(&responses.last().unwrap().challenge_id)
            .await
            .expect("newest entry remains published");

        let admission = provider
            .admit_email("PERSON@example.com")
            .await
            .expect("admission");
        admission
            .request_code(&mut database, AUTH_ADDRESS_REQUEST_WINDOW_MS)
            .expect("lower boundary is excluded");
        assert_eq!(direct_stream_facts(&mut database), (0, 0));
    }

    #[tokio::test]
    async fn capture_only_profiles_keep_global_budget_but_not_address_budget() {
        for profile in [AuthProviderProfile::Dev, AuthProviderProfile::Demo] {
            let (provider, mut database) = provider_database_for_profile(0, profile);
            for request in 0..(AUTH_ADDRESS_REQUEST_LIMIT + 2) {
                provider
                    .admit_email("repeat-demo@example.com")
                    .await
                    .expect("address admission")
                    .request_code(&mut database, 0)
                    .unwrap_or_else(|error| {
                        panic!(
                            "{profile:?} capture ceremony {request} unexpectedly failed: {}",
                            error.diagnostic().code
                        )
                    });
            }
        }

        // Test remains the production-shaped boundary fixture.
        let (provider, mut database) = provider_database_for_profile(0, AuthProviderProfile::Test);
        for _ in 0..AUTH_ADDRESS_REQUEST_LIMIT {
            provider
                .admit_email("bounded-test@example.com")
                .await
                .expect("address admission")
                .request_code(&mut database, 0)
                .expect("request inside test budget");
        }
        let error = provider
            .admit_email("bounded-test@example.com")
            .await
            .expect("address admission")
            .request_code(&mut database, 0)
            .expect_err("test profile must retain the exact address budget");
        assert_eq!(error.diagnostic().code, "SNAPBACK_AUTH_THROTTLED");
    }

    #[tokio::test]
    async fn challenge_exchanges_through_its_retired_key_after_rotation() {
        let (provider, mut database) = provider_database(0);
        let rotation_at = super::super::keyring::AUTH_KEY_ROTATION_AGE_MS;
        let requested_at = rotation_at - 1;
        let (request, code) = request_and_code(
            &provider,
            &mut database,
            "pre-rotation@example.com",
            requested_at,
        )
        .await;

        assert!(
            provider
                .keyring
                .rotate_if_due(rotation_at, provider.random.as_ref())
                .expect("rotate keyring")
        );
        let issue = exchange(
            &provider,
            &mut database,
            &request.challenge_id,
            &code,
            rotation_at + 1,
        )
        .await
        .expect("stored challenge key remains usable after rotation");
        assert_eq!(issue.response().session.provider, "email-code");
    }

    #[tokio::test]
    async fn global_and_capture_budgets_hit_exact_boundaries_without_durable_overrun() {
        let (provider, mut database) = provider_database(0);
        for index in 0..AUTH_GLOBAL_REQUEST_LIMIT {
            provider
                .admit_email(&format!("global-{index}@example.com"))
                .await
                .expect("admission")
                .request_code(&mut database, 0)
                .expect("global request inside limit");
        }
        let global = provider
            .admit_email("global-over@example.com")
            .await
            .expect("admission")
            .request_code(&mut database, 0)
            .expect_err("global overrun throttles");
        assert_eq!(global.diagnostic().code, "SNAPBACK_AUTH_THROTTLED");
        assert_eq!(
            global.diagnostic().details["budgetName"],
            "auth.challenge-allocation"
        );
        assert_eq!(
            global.diagnostic().details["retryAfter"]["milliseconds"],
            AUTH_GLOBAL_REQUEST_WINDOW_MS
        );
        provider
            .admit_email("global-recovered@example.com")
            .await
            .expect("admission")
            .request_code(&mut database, AUTH_GLOBAL_REQUEST_WINDOW_MS)
            .expect("exact lower boundary is excluded");

        let (capacity_provider, mut capacity_database) = provider_database(0);
        for index in 0..super::super::mailbox::CAPTURE_MAILBOX_CAPACITY {
            capacity_provider
                .admit_email(&format!("capacity-{index}@example.com"))
                .await
                .expect("capacity admission")
                .request_code(
                    &mut capacity_database,
                    index as u64 * AUTH_GLOBAL_REQUEST_WINDOW_MS,
                )
                .expect("mailbox request inside capacity");
        }
        let capacity = capacity_provider
            .admit_email("capacity-over@example.com")
            .await
            .expect("capacity admission")
            .request_code(
                &mut capacity_database,
                super::super::mailbox::CAPTURE_MAILBOX_CAPACITY as u64
                    * AUTH_GLOBAL_REQUEST_WINDOW_MS,
            )
            .expect_err("mailbox overrun throttles");
        assert_eq!(capacity.diagnostic().code, "SNAPBACK_AUTH_THROTTLED");
        assert_eq!(
            capacity.diagnostic().details["budgetName"],
            "auth.challenge-allocation"
        );
        assert_eq!(
            capacity.diagnostic().details["retryAfter"]["kind"],
            "resource-release"
        );
        let durable: i64 = capacity_database
            .auth_catalog_read()
            .verification_challenge_count_for_test()
            .expect("durable challenge count");
        assert_eq!(
            durable,
            super::super::mailbox::CAPTURE_MAILBOX_CAPACITY as i64
        );
        assert_eq!(direct_stream_facts(&mut capacity_database), (0, 0));
    }

    #[tokio::test]
    async fn exchange_commits_wrong_attempts_and_allows_correct_fifth_attempt() {
        let now_ms = 1_700_000_000_000;
        let (provider, mut database) = provider_database(now_ms);
        let (request, code) =
            request_and_code(&provider, &mut database, "person@example.com", now_ms).await;
        let wrong = different_code(&code);

        let admission = provider.admit().await;
        let coordination = admission
            .exchange_coordination(&database, &request.challenge_id)
            .expect("coordination")
            .expect("known challenge");
        let exchange = admission
            .for_exchange(coordination)
            .await
            .expect("exchange admission");
        for attempt in 1..AUTH_MAXIMUM_ATTEMPTS {
            let error = exchange
                .exchange(&mut database, &wrong, now_ms + attempt as u64)
                .expect_err("wrong attempt");
            assert_eq!(error.diagnostic().code, "SNAPBACK_AUTH_CODE_INVALID");
        }
        let issue = exchange
            .exchange(&mut database, &code, now_ms + AUTH_MAXIMUM_ATTEMPTS as u64)
            .expect("correct fifth attempt");
        assert!(issue.committed_revocation.is_none());

        let error = exchange
            .exchange(
                &mut database,
                &code,
                now_ms + AUTH_MAXIMUM_ATTEMPTS as u64 + 1,
            )
            .expect_err("consumed challenge is uniformly invalid");
        assert_eq!(error.diagnostic().code, "SNAPBACK_AUTH_CODE_INVALID");
        drop(exchange);
        let mailbox = provider
            .mailbox_entry(&request.challenge_id)
            .await
            .expect_err("consume erases plaintext");
        assert_eq!(
            mailbox.diagnostic().code,
            "SNAPBACK_AUTH_MAILBOX_ENTRY_NOT_FOUND"
        );

        let facts = database
            .auth_catalog_read()
            .challenge_issue_facts_for_test(&request.challenge_id)
            .expect("durable facts");
        assert_eq!(facts, (5, 1, 1, 1));
        assert_eq!(direct_stream_facts(&mut database), (0, 0));
    }

    #[tokio::test]
    async fn incorrect_fifth_attempt_commits_lock_and_later_attempts_do_not_mutate() {
        let now_ms = 1_700_000_000_000;
        let (provider, mut database) = provider_database(now_ms);
        let (request, code) =
            request_and_code(&provider, &mut database, "person@example.com", now_ms).await;
        let wrong = different_code(&code);
        let admission = provider.admit().await;
        let coordination = admission
            .exchange_coordination(&database, &request.challenge_id)
            .expect("coordination")
            .expect("known challenge");
        let exchange = admission
            .for_exchange(coordination)
            .await
            .expect("exchange admission");
        for attempt in 1..AUTH_MAXIMUM_ATTEMPTS {
            let error = exchange
                .exchange(&mut database, &wrong, now_ms + attempt as u64)
                .expect_err("wrong attempt");
            assert_eq!(error.diagnostic().code, "SNAPBACK_AUTH_CODE_INVALID");
        }
        let fifth = exchange
            .exchange(&mut database, &wrong, now_ms + AUTH_MAXIMUM_ATTEMPTS as u64)
            .expect_err("wrong fifth attempt locks");
        assert_eq!(fifth.diagnostic().code, "SNAPBACK_AUTH_CODE_LOCKED");
        assert_eq!(fifth.diagnostic().details["budgetName"], "auth.guessing");
        assert_eq!(
            fifth.diagnostic().details["retryAfter"]["kind"],
            "new-authority-required"
        );
        let later = exchange
            .exchange(
                &mut database,
                &code,
                now_ms + AUTH_MAXIMUM_ATTEMPTS as u64 + 1,
            )
            .expect_err("locked challenge remains locked");
        assert_eq!(later.diagnostic().code, "SNAPBACK_AUTH_CODE_LOCKED");
        let (attempts, sessions): (i64, i64) = database
            .auth_catalog_read()
            .challenge_attempts_and_sessions_for_test(&request.challenge_id)
            .expect("locked facts");
        assert_eq!((attempts, sessions), (5, 0));
    }

    #[tokio::test]
    async fn observable_id_and_session_collisions_exhaust_exactly_three_candidates() {
        let now_ms = 1_700_000_000_000;
        let random = Arc::new(CountingConstantRandom::new(0x42));
        let (provider, mut database) = provider_database_with_random(now_ms, random.clone());
        let first = provider
            .admit_email("person@example.com")
            .await
            .expect("admission")
            .request_code(&mut database, now_ms)
            .expect("first request");
        let fills_before_collision = random.fills();
        let collision = provider
            .admit_email("person@example.com")
            .await
            .expect("admission")
            .request_code(&mut database, now_ms + 1)
            .expect_err("constant challenge id exhausts retries");
        assert_eq!(
            collision.diagnostic().code,
            "SNAPBACK_AUTH_PROVIDER_UNAVAILABLE"
        );
        assert_eq!(random.fills() - fills_before_collision, 6);
        provider
            .mailbox_entry(&first.challenge_id)
            .await
            .expect("colliding request did not supersede first");

        let session_random = Arc::new(CountingConstantRandom::new(0x24));
        let (session_provider, mut session_database) =
            provider_database_with_random(now_ms, session_random.clone());
        mint(
            &session_provider,
            &mut session_database,
            "person@example.com",
            now_ms,
        )
        .await;
        let fills_before_collision = session_random.fills();
        let collision = session_provider
            .admit_email("person@example.com")
            .await
            .expect("mint admission")
            .mint_session(&mut session_database, now_ms + 1)
            .expect_err("constant session ids exhaust retries");
        assert_eq!(
            collision.diagnostic().code,
            "SNAPBACK_AUTH_PROVIDER_UNAVAILABLE"
        );
        assert_eq!(session_random.fills() - fills_before_collision, 15);
        let sessions: i64 = session_database
            .auth_catalog_read()
            .session_count_for_test()
            .expect("session count");
        assert_eq!(sessions, 1);
    }

    #[tokio::test]
    async fn superseded_and_unknown_challenges_share_uniform_invalid_outcome() {
        let now_ms = 1_700_000_000_000;
        let (provider, mut database) = provider_database(now_ms);
        let (older, older_code) =
            request_and_code(&provider, &mut database, "person@example.com", now_ms).await;
        let _ = request_and_code(&provider, &mut database, "PERSON@example.com", now_ms + 1).await;
        let error = exchange(
            &provider,
            &mut database,
            &older.challenge_id,
            &older_code,
            now_ms + 2,
        )
        .await
        .expect_err("superseded challenge");
        assert_eq!(error.diagnostic().code, "SNAPBACK_AUTH_CODE_INVALID");

        let unknown_id = ChallengeId::generate(&OsRandom).expect("unknown challenge id");
        let admission = provider.admit().await;
        assert!(
            admission
                .exchange_coordination(&database, unknown_id.as_str())
                .expect("unknown lookup")
                .is_none()
        );
        let error = admission
            .exchange_unknown(
                &mut database,
                unknown_id.as_str(),
                "123456",
                now_ms + 2,
                None,
            )
            .expect_err("unknown challenge");
        assert_eq!(error.diagnostic().code, "SNAPBACK_AUTH_CODE_INVALID");
        assert_eq!(direct_stream_facts(&mut database), (0, 0));
    }

    #[tokio::test]
    async fn stale_concurrent_exchange_and_refresh_admissions_linearize_once() {
        let start_ms = 1_700_000_000_000;
        let (provider, mut database) = provider_database(start_ms);
        let (request, code) =
            request_and_code(&provider, &mut database, "person@example.com", start_ms).await;

        // Both preliminary reads happen before either exchange owns the
        // address stripe, modeling two outer requests admitted concurrently.
        let first_admission = provider.admit().await;
        let first_coordination = first_admission
            .exchange_coordination(&database, &request.challenge_id)
            .expect("first coordination")
            .expect("known challenge");
        let second_admission = provider.admit().await;
        let second_coordination = second_admission
            .exchange_coordination(&database, &request.challenge_id)
            .expect("second coordination")
            .expect("known challenge");
        let first_exchange = first_admission
            .for_exchange(first_coordination)
            .await
            .expect("first exchange lock");
        let first_issue = first_exchange
            .exchange(&mut database, &code, start_ms + 1)
            .expect("first exchange wins");
        drop(first_exchange);
        let second_exchange = second_admission
            .for_exchange(second_coordination)
            .await
            .expect("second exchange lock");
        let second = second_exchange
            .exchange(&mut database, &code, start_ms + 1)
            .expect_err("stale exchange recheck loses");
        assert_eq!(second.diagnostic().code, "SNAPBACK_AUTH_CODE_INVALID");
        drop(second_exchange);
        let counts: (i64, i64, i64) = database
            .auth_catalog_read()
            .provision_counts_for_test()
            .expect("provision counts");
        assert_eq!(counts, (1, 1, 1));

        let predecessor = issue_token(&first_issue);
        let refresh_admission_a = provider.admit().await;
        let refresh_admission_b = provider.admit().await;
        let winner = refresh_admission_a
            .refresh(&mut database, &predecessor, start_ms + 2)
            .expect("first refresh wins");
        let successor = issue_token(&winner);
        let loser = refresh_admission_b
            .refresh(&mut database, &predecessor, start_ms + 2)
            .expect_err("second refresh observes tombstone");
        assert_eq!(loser.diagnostic().code, "SNAPBACK_AUTH_REFRESH_SUPERSEDED");
        let resolved = refresh_admission_b
            .resolve_session(&database, &successor, start_ms + 2)
            .expect("losing refresh did not revoke");
        assert_eq!(resolved.generation, 1);
        let (current, tombstones): (i64, i64) = database
            .auth_catalog_read()
            .current_and_tombstone_counts_for_test()
            .expect("refresh facts");
        assert_eq!((current, tombstones), (1, 1));
    }

    #[tokio::test]
    async fn twenty_first_live_session_revokes_deterministic_oldest_in_same_commit() {
        let start_ms = 1_700_000_000_000;
        let (provider, mut database) = provider_database(start_ms);
        let mut first_session_id = None;
        let mut first_token = None;
        let mut refreshed_oldest = None;
        let mut final_revocation = None;

        for index in 0..=AUTH_SESSION_LIVE_LIMIT {
            let now_ms = start_ms + index as u64 * AUTH_ADDRESS_REQUEST_WINDOW_MS;
            if index == AUTH_SESSION_LIVE_LIMIT {
                let admission = provider.admit().await;
                let refreshed = admission
                    .refresh(
                        &mut database,
                        first_token.as_deref().expect("first token"),
                        now_ms - 1,
                    )
                    .expect("refresh oldest immediately before cap race");
                refreshed_oldest = Some(issue_token(&refreshed));
            }
            let (request, code) =
                request_and_code(&provider, &mut database, "person@example.com", now_ms).await;
            let issue = exchange(
                &provider,
                &mut database,
                &request.challenge_id,
                &code,
                now_ms + 1,
            )
            .await
            .expect("exchange");
            if first_session_id.is_none() {
                first_session_id = Some(issue.response().session.id.clone());
                first_token = Some(issue_token(&issue));
            }
            final_revocation = issue.committed_revocation.clone();
        }

        let revocation = final_revocation.expect("21st session evicts oldest");
        assert_eq!(revocation.session_id, first_session_id.unwrap());
        assert_eq!(revocation.generation, 2);
        let now_ms = start_ms + AUTH_SESSION_LIVE_LIMIT as u64 * AUTH_ADDRESS_REQUEST_WINDOW_MS + 1;
        let (live, oldest_revoked): (i64, i64) = database
            .auth_catalog_read()
            .session_cap_facts_for_test(now_ms, &revocation.session_id)
            .expect("session cap facts");
        assert_eq!((live, oldest_revoked), (20, 1));
        let admission = provider.admit().await;
        let successor = refreshed_oldest.expect("oldest successor");
        let expired = admission
            .resolve_session(&database, &successor, now_ms)
            .expect_err("cap eviction wins after refresh");
        assert_eq!(expired.diagnostic().code, "SNAPBACK_AUTH_SESSION_EXPIRED");
        let logout = admission
            .logout(&mut database, &successor, now_ms)
            .expect_err("logout loses to cap eviction");
        assert_eq!(logout.diagnostic().code, "SNAPBACK_AUTH_SESSION_EXPIRED");
        let restart_reason =
            projected_terminal_reason_after_restart(&mut database, &successor, now_ms);
        assert_eq!(restart_reason, RevocationReason::CapEviction);
        assert_eq!(
            restart_reason.authority_disposition(),
            TerminalAuthorityDisposition::Carrier,
        );
        assert_eq!(direct_stream_facts(&mut database), (0, 0));
    }

    #[tokio::test]
    async fn refresh_and_ordinary_resolution_pin_the_supersession_matrix() {
        let start_ms = 1_700_000_000_000;
        let (provider, mut database) = provider_database(start_ms);
        let issue = mint(&provider, &mut database, "person@example.com", start_ms).await;
        let predecessor = issue_token(&issue);
        let admission = provider.admit().await;
        let initial = admission
            .resolve_session(&database, &predecessor, start_ms)
            .expect("current resolution");

        let rotated_at = start_ms + 1;
        let refreshed = admission
            .refresh(&mut database, &predecessor, rotated_at)
            .expect("refresh current bearer");
        let successor = issue_token(&refreshed);
        assert_ne!(predecessor, successor);
        let current = admission
            .resolve_session(&database, &successor, rotated_at)
            .expect("successor resolution");
        assert_eq!(current.session_id, initial.session_id);
        assert_eq!(current.user_id, initial.user_id);
        assert_eq!(current.identity_id, initial.identity_id);
        assert_eq!(current.generation, initial.generation);
        assert_eq!(current.authority_instance_id, initial.authority_instance_id);
        assert_eq!(current.expires_at_ms, initial.expires_at_ms);

        admission
            .resolve_session(
                &database,
                &predecessor,
                rotated_at + AUTH_SESSION_SUPERSESSION_GRACE_MS,
            )
            .expect("ordinary use at exact grace is accepted");
        let inside = admission
            .refresh(
                &mut database,
                &predecessor,
                rotated_at + AUTH_SESSION_SUPERSESSION_GRACE_MS,
            )
            .expect_err("refresh at exact grace is superseded without revoke");
        assert_eq!(inside.diagnostic().code, "SNAPBACK_AUTH_REFRESH_SUPERSEDED");
        admission
            .resolve_session(&database, &successor, rotated_at + 10_000)
            .expect("inside-grace refresh did not revoke successor");

        let after_grace = rotated_at + AUTH_SESSION_SUPERSESSION_GRACE_MS + 1;
        let ordinary = admission
            .resolve_session(&database, &predecessor, after_grace)
            .expect_err("old ordinary credential after grace");
        assert_eq!(
            ordinary.diagnostic().code,
            "SNAPBACK_AUTH_CREDENTIAL_SUPERSEDED"
        );
        let reuse = admission
            .refresh(&mut database, &predecessor, after_grace)
            .expect_err("old refresh after grace revokes family");
        assert_eq!(reuse.diagnostic().code, "SNAPBACK_AUTH_SESSION_EXPIRED");
        let (_, committed) = reuse.into_parts();
        let committed = committed.expect("reuse revocation fact");
        assert_eq!(committed.session_id, initial.session_id);
        assert_eq!(committed.generation, 2);
        let expired = admission
            .resolve_session(&database, &successor, after_grace)
            .expect_err("successor family was revoked");
        assert_eq!(expired.diagnostic().code, "SNAPBACK_AUTH_SESSION_EXPIRED");

        let malformed = admission
            .resolve_session(&database, "not-a-bearer", after_grace)
            .expect_err("malformed bearer");
        assert_eq!(malformed.diagnostic().code, "SNAPBACK_AUTH_REQUIRED");
        assert_eq!(direct_stream_facts(&mut database), (0, 0));
    }

    #[tokio::test]
    async fn generated_n_minus_two_and_three_traces_keep_all_predecessors_attributable() {
        let start_ms = 1_700_000_000_000;
        for depth in [2_u64, 3] {
            let (provider, mut database) = provider_database(start_ms);
            let issue = mint(&provider, &mut database, "person@example.com", start_ms).await;
            let oldest = issue_token(&issue);
            let admission = provider.admit().await;
            let initial = admission
                .resolve_session(&database, &oldest, start_ms)
                .expect("initial session");
            let mut current_token = oldest.clone();
            for generation in 1..=depth {
                let refreshed = admission
                    .refresh(&mut database, &current_token, start_ms + generation)
                    .expect("trace refresh");
                assert_eq!(refreshed.response().session.id, initial.session_id);
                assert_eq!(
                    refreshed.response().session.expires_at,
                    initial.expires_at_ms
                );
                current_token = issue_token(&refreshed);
                let current = admission
                    .resolve_session(&database, &current_token, start_ms + generation)
                    .expect("trace successor");
                assert_eq!(current.authority_instance_id, initial.authority_instance_id);
                assert_eq!(current.generation, 1);
            }

            // `oldest` is now N-2 or N-3. Its own tombstone age, not its
            // distance from current, controls the inclusive grace boundary.
            let superseded_at = start_ms + 1;
            let inside = superseded_at + AUTH_SESSION_SUPERSESSION_GRACE_MS;
            admission
                .resolve_session(&database, &oldest, inside)
                .expect("old predecessor ordinary use inside grace");
            let refresh_inside = admission
                .refresh(&mut database, &oldest, inside)
                .expect_err("old predecessor refresh inside grace");
            assert_eq!(
                refresh_inside.diagnostic().code,
                "SNAPBACK_AUTH_REFRESH_SUPERSEDED"
            );
            admission
                .resolve_session(&database, &current_token, inside)
                .expect("inside-grace reuse did not revoke current");

            let outside = inside + 1;
            let ordinary = admission
                .resolve_session(&database, &oldest, outside)
                .expect_err("old predecessor ordinary use outside grace");
            assert_eq!(
                ordinary.diagnostic().code,
                "SNAPBACK_AUTH_CREDENTIAL_SUPERSEDED"
            );
            let refresh_outside = admission
                .refresh(&mut database, &oldest, outside)
                .expect_err("old predecessor refresh outside grace");
            assert_eq!(
                refresh_outside.diagnostic().code,
                "SNAPBACK_AUTH_SESSION_EXPIRED"
            );
            let (_, revocation) = refresh_outside.into_parts();
            assert_eq!(
                revocation.expect("committed reuse revocation").generation,
                2
            );
            let expired = admission
                .resolve_session(&database, &current_token, outside)
                .expect_err("current revoked by attributable predecessor");
            assert_eq!(expired.diagnostic().code, "SNAPBACK_AUTH_SESSION_EXPIRED");
            let tombstones: i64 = database
                .auth_catalog_read()
                .tombstone_count_for_test()
                .expect("tombstone count");
            assert_eq!(tombstones, depth as i64);
        }
    }

    #[tokio::test]
    async fn family_alarm_is_opaque_fixed_delay_and_attributable_only_to_tombstones() {
        let start_ms = 1_700_000_000_000;
        let (provider, mut database) = provider_database(start_ms);
        let issue = mint(&provider, &mut database, "person@example.com", start_ms).await;
        let predecessor = issue_token(&issue);
        let admission = provider.admit().await;
        let refreshed = admission
            .refresh(&mut database, &predecessor, start_ms + 1)
            .expect("refresh");
        let successor = issue_token(&refreshed);

        let before = Instant::now();
        let alarm = admission
            .family_alarm(&mut database, &predecessor, start_ms + 2)
            .expect("family alarm");
        let (response, deadline, committed) = alarm.into_parts();
        assert!(response.accepted);
        assert!(deadline >= before + Duration::from_millis(AUTH_FAMILY_ALARM_MINIMUM_MS));
        assert!(
            deadline
                <= before
                    + Duration::from_millis(
                        AUTH_FAMILY_ALARM_MINIMUM_MS + AUTH_FAMILY_ALARM_JITTER_MAXIMUM_MS + 5,
                    )
        );
        assert_eq!(committed.expect("alarm revocation").generation, 2);
        let expired = admission
            .resolve_session(&database, &successor, start_ms + 2)
            .expect_err("alarm revoked family");
        assert_eq!(expired.diagnostic().code, "SNAPBACK_AUTH_SESSION_EXPIRED");

        for suspect in [&predecessor[..], &successor[..], "malformed"] {
            let repeated = admission
                .family_alarm(&mut database, suspect, start_ms + 3)
                .expect("opaque repeated alarm");
            let (response, _, committed) = repeated.into_parts();
            assert!(response.accepted);
            assert!(committed.is_none());
        }
        let generation: i64 = database
            .auth_catalog_read()
            .sole_session_generation_for_test()
            .expect("alarm generation");
        assert_eq!(generation, 2, "duplicates never increment a revoked family");
        assert_eq!(direct_stream_facts(&mut database), (0, 0));
    }

    #[tokio::test]
    async fn lost_refresh_and_alarm_responses_preserve_attribution_and_idempotence() {
        let start_ms = 1_700_000_000_000;
        let (provider, mut database) = provider_database(start_ms);
        let issue = mint(&provider, &mut database, "person@example.com", start_ms).await;
        let predecessor = issue_token(&issue);
        let admission = provider.admit().await;

        // Commit refresh and deliberately discard the only successor
        // plaintext, modeling a lost successful response.
        drop(
            admission
                .refresh(&mut database, &predecessor, start_ms + 1)
                .expect("lost refresh commit"),
        );
        let delayed_at = start_ms + 1 + AUTH_SESSION_SUPERSESSION_GRACE_MS + 1;
        let ordinary = admission
            .resolve_session(&database, &predecessor, delayed_at)
            .expect_err("lost successor cannot reconcile after grace");
        assert_eq!(
            ordinary.diagnostic().code,
            "SNAPBACK_AUTH_CREDENTIAL_SUPERSEDED"
        );

        // Treat the first opaque alarm response as lost too. Retrying the same
        // attributable predecessor is a no-op, but the first commit survives.
        let first_alarm = admission
            .family_alarm(&mut database, &predecessor, delayed_at)
            .expect("delayed alarm");
        assert_eq!(
            first_alarm
                .into_parts()
                .2
                .expect("delayed alarm revocation")
                .generation,
            2
        );
        let retry = admission
            .family_alarm(&mut database, &predecessor, delayed_at + 1)
            .expect("alarm retry after lost response");
        assert!(retry.into_parts().2.is_none());
        let (generation, revoked): (i64, bool) = database
            .auth_catalog_read()
            .sole_session_generation_revoked_for_test()
            .expect("lost-response facts");
        assert_eq!((generation, revoked), (2, true));
    }

    #[tokio::test]
    async fn logout_and_refresh_races_have_only_serializable_family_outcomes() {
        let start_ms = 1_700_000_000_000;

        let (provider, mut database) = provider_database(start_ms);
        let issue = mint(
            &provider,
            &mut database,
            "logout-first@example.com",
            start_ms,
        )
        .await;
        let token = issue_token(&issue);
        let admission = provider.admit().await;
        assert_eq!(
            admission
                .logout(&mut database, &token, start_ms + 1)
                .expect("logout wins")
                .generation,
            2
        );
        let refresh = admission
            .refresh(&mut database, &token, start_ms + 1)
            .expect_err("refresh loses to logout");
        assert_eq!(refresh.diagnostic().code, "SNAPBACK_AUTH_SESSION_EXPIRED");

        let (provider, mut database) = provider_database(start_ms);
        let issue = mint(
            &provider,
            &mut database,
            "refresh-first@example.com",
            start_ms,
        )
        .await;
        let predecessor = issue_token(&issue);
        let admission = provider.admit().await;
        let refreshed = admission
            .refresh(&mut database, &predecessor, start_ms + 1)
            .expect("refresh wins");
        let successor = issue_token(&refreshed);
        assert_eq!(
            admission
                .logout(&mut database, &predecessor, start_ms + 1)
                .expect("logout resolves in-grace predecessor")
                .generation,
            2
        );
        let expired = admission
            .resolve_session(&database, &successor, start_ms + 1)
            .expect_err("logout revokes refreshed successor");
        assert_eq!(expired.diagnostic().code, "SNAPBACK_AUTH_SESSION_EXPIRED");
        let (generation, tombstones): (i64, i64) = database
            .auth_catalog_read()
            .generation_and_tombstones_for_test()
            .expect("refresh-first facts");
        assert_eq!((generation, tombstones), (2, 1));
    }

    #[tokio::test]
    async fn sliding_use_coalesces_refresh_does_not_extend_and_logout_is_monotone() {
        let start_ms = 1_700_000_000_000;
        let (provider, mut database) = provider_database(start_ms);
        let issue = mint(&provider, &mut database, "person@example.com", start_ms).await;
        let token = issue_token(&issue);
        let admission = provider.admit().await;
        let resolved = admission
            .resolve_session(&database, &token, start_ms)
            .expect("resolve minted session");

        assert_eq!(
            admission
                .record_authenticated_use(
                    &mut database,
                    &resolved.session_id,
                    resolved.generation,
                    start_ms + AUTH_SESSION_USE_COALESCE_MS - 1,
                )
                .expect("coalesced use"),
            AuthenticatedUse::Unchanged {
                expires_at_ms: resolved.expires_at_ms,
            }
        );
        let use_at = start_ms + AUTH_SESSION_USE_COALESCE_MS;
        let extended_expiry = use_at + AUTH_SESSION_SLIDING_WINDOW_MS;
        assert_eq!(
            admission
                .record_authenticated_use(
                    &mut database,
                    &resolved.session_id,
                    resolved.generation,
                    use_at,
                )
                .expect("exact coalescing boundary"),
            AuthenticatedUse::Extended {
                expires_at_ms: extended_expiry,
            }
        );

        let refreshed = admission
            .refresh(&mut database, &token, use_at + 1)
            .expect("refresh after sliding use");
        assert_eq!(refreshed.response().session.expires_at, extended_expiry);
        let successor = issue_token(&refreshed);
        let revocation = admission
            .logout(&mut database, &successor, use_at + 2)
            .expect("logout current");
        assert_eq!(revocation.session_id, resolved.session_id);
        assert_eq!(revocation.generation, 2);
        let repeated = admission
            .logout(&mut database, &successor, use_at + 3)
            .expect_err("repeated logout");
        assert_eq!(repeated.diagnostic().code, "SNAPBACK_AUTH_SESSION_EXPIRED");
        assert_eq!(
            admission
                .record_authenticated_use(
                    &mut database,
                    &resolved.session_id,
                    resolved.generation,
                    use_at + 4,
                )
                .expect("revoked use"),
            AuthenticatedUse::NotLive
        );
        assert_eq!(direct_stream_facts(&mut database), (0, 0));
    }

    #[tokio::test]
    async fn generated_sliding_boundaries_cap_at_absolute_expiry_without_revival() {
        let start_ms = 1_700_000_000_000;
        for (delta, extends) in [
            (AUTH_SESSION_USE_COALESCE_MS - 1, false),
            (AUTH_SESSION_USE_COALESCE_MS, true),
            (AUTH_SESSION_USE_COALESCE_MS + 1, true),
        ] {
            let (provider, mut database) = provider_database(start_ms);
            let issue = mint(&provider, &mut database, "person@example.com", start_ms).await;
            let token = issue_token(&issue);
            let admission = provider.admit().await;
            let resolved = admission
                .resolve_session(&database, &token, start_ms)
                .expect("boundary session");
            let outcome = admission
                .record_authenticated_use(
                    &mut database,
                    &resolved.session_id,
                    resolved.generation,
                    start_ms + delta,
                )
                .expect("boundary use");
            assert_eq!(
                matches!(outcome, AuthenticatedUse::Extended { .. }),
                extends
            );
        }

        let (provider, mut database) = provider_database(start_ms);
        let issue = mint(&provider, &mut database, "absolute@example.com", start_ms).await;
        let token = issue_token(&issue);
        let admission = provider.admit().await;
        let resolved = admission
            .resolve_session(&database, &token, start_ms)
            .expect("absolute session");
        let day = 24 * 60 * 60 * 1_000;
        for day_offset in [29_u64, 58, 87] {
            let outcome = admission
                .record_authenticated_use(
                    &mut database,
                    &resolved.session_id,
                    resolved.generation,
                    start_ms + day_offset * day,
                )
                .expect("periodic sliding use");
            assert!(matches!(outcome, AuthenticatedUse::Extended { .. }));
        }
        let absolute = start_ms + AUTH_SESSION_ABSOLUTE_WINDOW_MS;
        assert_eq!(
            admission
                .record_authenticated_use(
                    &mut database,
                    &resolved.session_id,
                    resolved.generation,
                    absolute,
                )
                .expect("exact absolute use"),
            AuthenticatedUse::NotLive
        );
        assert_eq!(
            admission
                .record_authenticated_use(
                    &mut database,
                    &resolved.session_id,
                    resolved.generation,
                    absolute + 1,
                )
                .expect("post-absolute use"),
            AuthenticatedUse::NotLive
        );
        let refresh = admission
            .refresh(&mut database, &token, absolute)
            .expect_err("refresh cannot revive at absolute expiry");
        assert_eq!(refresh.diagnostic().code, "SNAPBACK_AUTH_SESSION_EXPIRED");
        let logout = admission
            .logout(&mut database, &token, absolute)
            .expect_err("logout sees expired session without mutation");
        assert_eq!(logout.diagnostic().code, "SNAPBACK_AUTH_SESSION_EXPIRED");
        let (last_used, expires, generation, revoked): (i64, i64, i64, bool) = database
            .auth_catalog_read()
            .session_lifetime_facts_for_test(&resolved.session_id)
            .expect("absolute row");
        assert_eq!(last_used, (start_ms + 87 * day) as i64);
        assert_eq!(expires, absolute as i64);
        assert_eq!((generation, revoked), (1, false));
        assert_eq!(direct_stream_facts(&mut database), (0, 0));
    }

    #[tokio::test]
    async fn readiness_is_non_secret_resolution_survives_and_gc_uses_injected_dependencies() {
        let start_ms = 0;
        let mut database = LocalDatabase::memory().expect("memory database");
        database
            .activate_current_auth_catalog()
            .expect("activate catalog");
        let keyring = Arc::new(AuthKeyringStore::in_memory());
        keyring
            .load_or_mint_initial(start_ms, &OsRandom)
            .expect("initial keyring");
        let clock = Arc::new(ManualClock::new(start_ms));
        let provider = Arc::new(
            AuthProvider::new_with_dependencies(
                AuthProviderProfile::Test,
                keyring,
                Arc::new(OsRandom),
                clock.clone(),
            )
            .expect("provider"),
        );
        assert_eq!(provider.readiness(), AuthProviderReadiness::Available);

        let issue = provider
            .admit_email("person@example.com")
            .await
            .expect("mint admission")
            .mint_session(&mut database, start_ms)
            .expect("mint session");
        let token = issue_token(&issue);
        let challenge = provider
            .admit_email("gc@example.com")
            .await
            .expect("request admission")
            .request_code(&mut database, start_ms)
            .expect("request challenge");
        clock.set(AUTH_CHALLENGE_TTL_MS);
        let maintenance = provider.exclusive_maintenance().await;
        let gc = maintenance
            .run_gc_pass(&mut database, clock.epoch_ms())
            .expect("gc pass");
        assert_eq!(gc.challenges_deleted, 1);
        assert_eq!(gc.sessions_deleted, 0);
        assert_eq!(gc.mailbox_entries_pruned, 1);
        assert_eq!(gc.retired_keys_pruned, 0);
        assert!(!gc.immediate_retry);
        drop(maintenance);
        let mailbox = provider
            .mailbox_entry(&challenge.challenge_id)
            .await
            .expect_err("gc pruned capture plaintext");
        assert_eq!(
            mailbox.diagnostic().code,
            "SNAPBACK_AUTH_MAILBOX_ENTRY_NOT_FOUND"
        );

        let unavailable = Arc::new(
            AuthProvider::new(
                AuthProviderProfile::Test,
                Arc::new(AuthKeyringStore::in_memory()),
            )
            .expect("provider can bind for digest-only resolution"),
        );
        assert_eq!(unavailable.readiness(), AuthProviderReadiness::Unavailable);
        unavailable
            .admit()
            .await
            .resolve_session(&database, &token, start_ms)
            .expect("session digest resolution is keyring independent");
        let request = unavailable
            .admit_email("unavailable@example.com")
            .await
            .expect("request admission")
            .request_code(&mut database, start_ms)
            .expect_err("issuance fails closed without keyring");
        assert_eq!(
            request.diagnostic().code,
            "SNAPBACK_AUTH_PROVIDER_UNAVAILABLE"
        );
        assert_eq!(direct_stream_facts(&mut database), (0, 0));
    }

    #[tokio::test]
    async fn planned_logout_uses_exact_generation_and_token_cas() {
        let start_ms = 10_000;
        let (provider, mut database) = provider_database(start_ms);
        let issue = mint(
            &provider,
            &mut database,
            "planned-logout@example.com",
            start_ms,
        )
        .await;
        let bearer = issue_token(&issue);
        let admission = provider.admit().await;
        let PlannedLogout::Revoke(plan) = admission
            .plan_logout(&database, &bearer, start_ms + 1)
            .expect("logout plan")
        else {
            panic!("current bearer must plan a revocation");
        };
        let committed = admission.commit_planned_revocation(&mut database, &plan, start_ms + 1);
        assert!(matches!(
            committed,
            AuthTransactionAttempt::Committed(PlannedRevocationCommit::Committed(
                SessionRevocation { generation: 2, .. }
            ))
        ));
        let restart_reason =
            projected_terminal_reason_after_restart(&mut database, &bearer, start_ms + 1);
        assert_eq!(restart_reason, RevocationReason::Logout);
        assert_eq!(
            restart_reason.authority_disposition(),
            TerminalAuthorityDisposition::DurableDelete,
        );
        let loser = admission.commit_planned_revocation(&mut database, &plan, start_ms + 1);
        assert!(matches!(
            loser,
            AuthTransactionAttempt::Committed(PlannedRevocationCommit::AlreadyTerminal {
                generation: 2,
                reason: Some(RevocationReason::Logout),
            })
        ));
        database
            .auth_catalog()
            .delete_terminal_cause_witness_for_test(plan.session_id())
            .expect("simulate a legacy terminal row without a cause witness");
        assert!(matches!(
            admission.commit_planned_revocation(&mut database, &plan, start_ms + 1),
            AuthTransactionAttempt::Committed(PlannedRevocationCommit::AlreadyTerminal {
                generation: 2,
                reason: None,
            })
        ));
    }

    #[tokio::test]
    async fn planned_refresh_returns_plaintext_only_after_exact_rotation_commit() {
        let start_ms = 20_000;
        let (provider, mut database) = provider_database(start_ms);
        let issue = mint(
            &provider,
            &mut database,
            "planned-refresh@example.com",
            start_ms,
        )
        .await;
        let predecessor = issue_token(&issue);
        let admission = provider.admit().await;
        let PlannedRefresh::Rotate(plan) = admission
            .plan_refresh(&database, &predecessor, start_ms + 1)
            .expect("refresh plan")
        else {
            panic!("current bearer must plan rotation");
        };
        let successor_digest = plan.successor_digest();
        let superseded_at_ms = plan.superseded_at_ms();
        let attempt = admission.commit_planned_rotation(&mut database, &plan.commit_plan());
        let AuthTransactionAttempt::Committed(PlannedRotationCommit::Committed { session }) =
            attempt
        else {
            panic!("exact rotation must commit");
        };
        assert_eq!(superseded_at_ms, start_ms + 1);
        let issue = plan.into_issue(session);
        let successor = issue_token(&issue);
        assert_eq!(
            TokenDigest::from_token_hash(&SessionBearer::parse(&successor).unwrap().token_hash()),
            successor_digest
        );
        admission
            .resolve_session(&database, &successor, start_ms + 2)
            .expect("successor resolves after commit");
        assert!(matches!(
            admission
                .plan_refresh(&database, &predecessor, start_ms + 2)
                .expect("predecessor refresh plan"),
            PlannedRefresh::SupersededInsideGrace
        ));
        let reuse_at = superseded_at_ms + AUTH_SESSION_SUPERSESSION_GRACE_MS + 1;
        let PlannedRefresh::ReuseRevoke(reuse) = admission
            .plan_refresh(&database, &predecessor, reuse_at)
            .expect("reuse revocation plan")
        else {
            panic!("out-of-grace predecessor must revoke its family");
        };
        assert!(matches!(
            admission.commit_planned_revocation(&mut database, &reuse, reuse_at),
            AuthTransactionAttempt::Committed(PlannedRevocationCommit::Committed(
                SessionRevocation { generation: 2, .. }
            ))
        ));
        let restart_reason =
            projected_terminal_reason_after_restart(&mut database, &successor, reuse_at);
        assert_eq!(restart_reason, RevocationReason::RefreshReuse);
        assert_eq!(
            restart_reason.authority_disposition(),
            TerminalAuthorityDisposition::DurableDelete,
        );
    }

    #[tokio::test]
    async fn planned_family_alarm_never_skips_the_dummy_writer_shape() {
        let start_ms = 30_000;
        let (provider, mut database) = provider_database(start_ms);
        let admission = provider.admit().await;
        let dummy = admission
            .plan_family_alarm(&database, "malformed", start_ms)
            .expect("dummy plan");
        assert!(!dummy.actionable);
        assert!(matches!(
            admission.commit_planned_family_alarm(&mut database, &dummy),
            AuthTransactionAttempt::Committed(PlannedFamilyAlarmCommit::Noop)
        ));

        let issue = mint(
            &provider,
            &mut database,
            "planned-alarm@example.com",
            start_ms,
        )
        .await;
        let predecessor = issue_token(&issue);
        let PlannedRefresh::Rotate(rotation) = admission
            .plan_refresh(&database, &predecessor, start_ms + 1)
            .expect("rotation plan")
        else {
            panic!("current bearer must rotate");
        };
        let AuthTransactionAttempt::Committed(PlannedRotationCommit::Committed { session }) =
            admission.commit_planned_rotation(&mut database, &rotation.commit_plan())
        else {
            panic!("rotation commit");
        };
        drop(rotation.into_issue(session));
        let alarm_at = start_ms + 1 + AUTH_SESSION_SUPERSESSION_GRACE_MS + 1;
        let alarm = admission
            .plan_family_alarm(&database, &predecessor, alarm_at)
            .expect("actionable alarm plan");
        assert!(alarm.actionable);
        assert!(matches!(
            admission.commit_planned_family_alarm(&mut database, &alarm),
            AuthTransactionAttempt::Committed(PlannedFamilyAlarmCommit::Revoked(
                SessionRevocation { generation: 2, .. }
            ))
        ));
        let restart_reason =
            projected_terminal_reason_after_restart(&mut database, &predecessor, alarm_at);
        assert_eq!(restart_reason, RevocationReason::FamilyAlarm);
        assert_eq!(
            restart_reason.authority_disposition(),
            TerminalAuthorityDisposition::DurableDelete,
        );
    }

    #[tokio::test]
    async fn malformed_family_alarm_is_non_actionable_even_if_dummy_digest_is_a_tombstone() {
        let start_ms = 35_000;
        let (mut provider, mut database) = provider_database(start_ms);
        let issue = mint(
            &provider,
            &mut database,
            "dummy-collision@example.com",
            start_ms,
        )
        .await;
        let predecessor = issue_token(&issue);
        let admission = provider.admit().await;
        let PlannedRefresh::Rotate(rotation) = admission
            .plan_refresh(&database, &predecessor, start_ms + 1)
            .expect("rotation plan")
        else {
            panic!("current bearer must rotate");
        };
        let AuthTransactionAttempt::Committed(PlannedRotationCommit::Committed { session }) =
            admission.commit_planned_rotation(&mut database, &rotation.commit_plan())
        else {
            panic!("rotation commit");
        };
        drop(rotation.into_issue(session));
        drop(admission);

        let predecessor_hash = SessionBearer::parse(&predecessor).unwrap().token_hash();
        Arc::get_mut(&mut provider)
            .expect("test owns the provider")
            .dummy_token_hash = predecessor_hash;
        let admission = provider.admit().await;
        let alarm_at = start_ms + 1 + AUTH_SESSION_SUPERSESSION_GRACE_MS + 1;
        let alarm = admission
            .plan_family_alarm(&database, "malformed", alarm_at)
            .expect("malformed alarm plan");
        assert!(!alarm.actionable, "parse failure dominates digest lookup");
        assert!(matches!(
            admission.commit_planned_family_alarm(&mut database, &alarm),
            AuthTransactionAttempt::Committed(PlannedFamilyAlarmCommit::Noop)
        ));
        let revoked: i64 = database
            .auth_catalog_read()
            .session_revoked_for_test(&issue.response().session.id)
            .unwrap();
        assert_eq!(revoked, 0, "malformed alarm did not revoke the family");
    }

    #[tokio::test]
    async fn planned_issuance_and_rotation_report_cross_table_candidate_collisions_without_writes()
    {
        let now_ms = 36_000;
        let (provider, mut database) = provider_database(now_ms);
        let first = mint(&provider, &mut database, "first@example.com", now_ms).await;
        let first_id = first.response().session.id.clone();

        let issuance = provider.admit_email("second@example.com").await.unwrap();
        let issuance_plan = issuance.plan_mint_session(&database, now_ms + 1).unwrap();
        let issuance_commit = issuance_plan.commit_plan();
        database
            .auth_catalog()
            .insert_session_tombstone_for_test(
                issuance_commit.projected.token_digest.as_bytes(),
                &first_id,
                now_ms,
            )
            .unwrap();
        assert!(matches!(
            issuance.commit_planned_issuance(&mut database, &issuance_commit),
            AuthTransactionAttempt::Committed(PlannedIssuanceCommit::CandidateCollision)
        ));
        let second_exists: i64 = database
            .auth_catalog_read()
            .identity_subject_count_for_test("second@example.com")
            .unwrap();
        assert_eq!(second_exists, 0, "collision precedes every issuance write");

        let bearer = issue_token(&first);
        let admission = provider.admit().await;
        let PlannedRefresh::Rotate(rotation) = admission
            .plan_refresh(&database, &bearer, now_ms + 2)
            .unwrap()
        else {
            panic!("rotation plan");
        };
        database
            .auth_catalog()
            .insert_session_tombstone_for_test(
                rotation.successor.token_hash.as_bytes(),
                &first.response().session.id,
                now_ms + 1,
            )
            .unwrap();
        assert!(matches!(
            admission.commit_planned_rotation(&mut database, &rotation.commit_plan()),
            AuthTransactionAttempt::Committed(PlannedRotationCommit::CandidateCollision)
        ));
        admission
            .resolve_session(&database, &bearer, now_ms + 3)
            .expect("collision leaves the rotation predecessor current");
    }

    #[tokio::test]
    async fn planned_issuance_reconciles_exact_predecessor_and_successor() {
        let now_ms = 40_000;
        let (provider, mut database) = provider_database(now_ms);
        let admission = provider
            .admit_email("planned-issuance@example.com")
            .await
            .expect("issuance admission");
        let plan = admission
            .plan_mint_session(&database, now_ms)
            .expect("issuance plan");
        let commit_plan = plan.commit_plan();
        assert!(matches!(
            database
                .auth_catalog_read()
                .reconcile_planned_issuance(&commit_plan.catalog_plan())
                .expect("predecessor reconciliation"),
            CatalogIssuanceReconcile::ExactPredecessor
        ));
        assert!(matches!(
            admission.commit_planned_issuance(&mut database, &commit_plan),
            AuthTransactionAttempt::Committed(PlannedIssuanceCommit::Committed {
                committed_revocations,
                ..
            }) if committed_revocations.is_empty()
        ));
        assert!(matches!(
            database
                .auth_catalog_read()
                .reconcile_planned_issuance(&commit_plan.catalog_plan())
                .expect("successor reconciliation"),
            CatalogIssuanceReconcile::ExactSuccessor {
                ref committed_revocations,
                ..
            } if committed_revocations.is_empty()
        ));
    }

    #[tokio::test]
    async fn planned_issuance_atomically_binds_sender_key_proof_and_initial_nonce() {
        let now_ms = 45_000;
        let (provider, database) = provider_database(now_ms);
        let mut database = ServingDatabase::adopt(database).expect("adopt serving database");
        database
            .initialize_sender_proof_after_hosted_preflight()
            .expect("initialize hosted sender authority");
        let admission = provider
            .admit_email("sender-issuance@example.com")
            .await
            .expect("issuance admission");
        let mut plan = admission
            .plan_mint_session(&database, now_ms)
            .expect("issuance plan");
        let commitment = SenderIssuanceCommitment::new(
            VerifiedSenderIssuance {
                proof_id: [3; 16],
                jwk_thumbprint: URL_SAFE_NO_PAD.encode([4_u8; 32]),
                issued_at_seconds: now_ms / 1_000,
            },
            now_ms / 1_000,
            120,
        )
        .expect("sender commitment");
        let expected_nonce = commitment.initial_nonce_for_transport().to_owned();
        plan.bind_sender_issuance(commitment, &OsRandom)
            .expect("bind sender issuance to plan");
        let commit_plan = plan.commit_plan();
        assert!(matches!(
            database
                .auth_catalog_read()
                .reconcile_planned_issuance(&commit_plan.catalog_plan())
                .expect("sender predecessor reconciliation"),
            CatalogIssuanceReconcile::ExactPredecessor
        ));
        assert!(matches!(
            admission.commit_planned_issuance(database.auth_database_mut(), &commit_plan),
            AuthTransactionAttempt::Committed(PlannedIssuanceCommit::Committed { .. })
        ));
        assert!(matches!(
            database
                .auth_catalog_read()
                .reconcile_planned_issuance(&commit_plan.catalog_plan())
                .expect("sender successor reconciliation"),
            CatalogIssuanceReconcile::ExactSuccessor { .. }
        ));
        let facts: (i64, i64, i64, String) = database
            .auth_catalog_read()
            .sender_issuance_facts_for_test()
            .expect("atomic sender issuance facts");
        assert_eq!(facts, (1, 1, 1, expected_nonce));
    }

    // @ref LLP 0077#issuance-refresh-and-recovery — one live family per
    // thumbprint. A second valid issuance over an already-bound key must
    // refuse with a committed SenderKeyBound outcome (not a nonce-table
    // constraint surfaced as INTERNAL_AUTH_STATE), consume only its proof id,
    // and leave the incumbent family untouched; once the incumbent's nonce
    // cell expires the same thumbprint issues again.
    #[tokio::test]
    async fn planned_issuance_refuses_a_second_family_for_a_live_thumbprint() {
        let now_ms = 45_000;
        let (provider, database) = provider_database(now_ms);
        let mut database = ServingDatabase::adopt(database).expect("adopt serving database");
        database
            .initialize_sender_proof_after_hosted_preflight()
            .expect("initialize hosted sender authority");
        let thumbprint = URL_SAFE_NO_PAD.encode([4_u8; 32]);

        let first_admission = provider
            .admit_email("sender-key-bound-first@example.com")
            .await
            .expect("first issuance admission");
        let mut first_plan = first_admission
            .plan_mint_session(&database, now_ms)
            .expect("first issuance plan");
        let first_commitment = SenderIssuanceCommitment::new(
            VerifiedSenderIssuance {
                proof_id: [3; 16],
                jwk_thumbprint: thumbprint.clone(),
                issued_at_seconds: now_ms / 1_000,
            },
            now_ms / 1_000,
            120,
        )
        .expect("first sender commitment");
        let incumbent_nonce = first_commitment.initial_nonce_for_transport().to_owned();
        first_plan
            .bind_sender_issuance(first_commitment, &OsRandom)
            .expect("bind first sender issuance");
        assert!(matches!(
            first_admission
                .commit_planned_issuance(database.auth_database_mut(), &first_plan.commit_plan()),
            AuthTransactionAttempt::Committed(PlannedIssuanceCommit::Committed { .. })
        ));
        // Address admissions retain their stripe guard. Release it before
        // admitting another address: the randomized stripe assignment may
        // legitimately collide, and holding both would deadlock this test.
        drop(first_admission);

        let second_admission = provider
            .admit_email("sender-key-bound-second@example.com")
            .await
            .expect("second issuance admission");
        let mut second_plan = second_admission
            .plan_mint_session(&database, now_ms + 1)
            .expect("second issuance plan");
        let second_commitment = SenderIssuanceCommitment::new(
            VerifiedSenderIssuance {
                proof_id: [5; 16],
                jwk_thumbprint: thumbprint.clone(),
                issued_at_seconds: (now_ms + 1) / 1_000,
            },
            (now_ms + 1) / 1_000,
            120,
        )
        .expect("second sender commitment");
        second_plan
            .bind_sender_issuance(second_commitment, &OsRandom)
            .expect("bind second sender issuance");
        let second_commit_plan = second_plan.commit_plan();
        assert!(matches!(
            second_admission
                .commit_planned_issuance(database.auth_database_mut(), &second_commit_plan),
            AuthTransactionAttempt::Committed(PlannedIssuanceCommit::SenderKeyBound)
        ));
        drop(second_admission);

        let facts: (i64, i64, i64, String, i64) = database
            .auth_catalog_read()
            .sender_refusal_facts_for_test()
            .expect("key-bound refusal facts");
        // One binding and one session (the incumbent's), both proof ids
        // consumed, and the incumbent's generation-one nonce untouched.
        assert_eq!(
            facts,
            (1, 2, 1, incumbent_nonce, 1),
            "a key-bound refusal consumes only its proof id"
        );

        // Past the incumbent nonce's lifetime the cell is expired: the same
        // thumbprint issues a fresh family again (install garbage-collects the
        // expired cell ahead of its insert).
        let later_ms = now_ms + 200_000;
        let third_admission = provider
            .admit_email("sender-key-bound-third@example.com")
            .await
            .expect("third issuance admission");
        let mut third_plan = third_admission
            .plan_mint_session(&database, later_ms)
            .expect("third issuance plan");
        let third_commitment = SenderIssuanceCommitment::new(
            VerifiedSenderIssuance {
                proof_id: [7; 16],
                jwk_thumbprint: thumbprint,
                issued_at_seconds: later_ms / 1_000,
            },
            later_ms / 1_000,
            120,
        )
        .expect("third sender commitment");
        third_plan
            .bind_sender_issuance(third_commitment, &OsRandom)
            .expect("bind third sender issuance");
        assert!(matches!(
            third_admission
                .commit_planned_issuance(database.auth_database_mut(), &third_plan.commit_plan()),
            AuthTransactionAttempt::Committed(PlannedIssuanceCommit::Committed { .. })
        ));
    }

    #[tokio::test]
    async fn planned_exchange_verifies_and_accounts_inside_the_issuance_transaction() {
        let now_ms = 50_000;
        let (provider, mut database) = provider_database(now_ms);
        let (request, code) = request_and_code(
            &provider,
            &mut database,
            "planned-exchange@example.com",
            now_ms,
        )
        .await;
        let wrong = different_code(&code);
        let admission = provider.admit().await;
        let coordination = admission
            .exchange_coordination(&database, &request.challenge_id)
            .expect("coordination")
            .expect("known challenge");
        let exchange = admission
            .for_exchange(coordination)
            .await
            .expect("exchange admission");
        let PlannedExchange::Issue(plan) = exchange
            .plan_exchange(&database, &wrong, now_ms + 1)
            .expect("live challenge plans a coordinated attempt")
        else {
            panic!("a wrong code is not authorized by the read-only planning pass");
        };
        let commit_plan = plan.commit_plan();
        assert!(matches!(
            exchange.commit_planned_issuance(&mut database, &commit_plan, &wrong),
            AuthTransactionAttempt::Committed(PlannedIssuanceCommit::CodeInvalid)
        ));
        assert!(matches!(
            database
                .auth_catalog_read()
                .reconcile_rejected_issuance(&commit_plan.catalog_plan())
                .expect("rejected successor reconciliation"),
            DurableRejectedIssuanceReconcile::ExactSuccessor
        ));
        let facts: (i64, i64) = database
            .auth_catalog_read()
            .challenge_attempts_and_sessions_for_test(&request.challenge_id)
            .expect("rejected exchange facts");
        assert_eq!(facts, (1, 0));

        let PlannedExchange::Issue(retry) = exchange
            .plan_exchange(&database, &code, now_ms + 2)
            .expect("correct retry plan")
        else {
            panic!("live correct retry plans issuance");
        };
        assert!(matches!(
            exchange.commit_planned_issuance(&mut database, &retry.commit_plan(), &code),
            AuthTransactionAttempt::Committed(PlannedIssuanceCommit::Committed { .. })
        ));
    }

    #[tokio::test]
    async fn planned_twenty_first_session_revokes_the_exact_oldest_predecessor() {
        let start_ms = 60_000;
        let (provider, mut database) = provider_database(start_ms);
        let mut oldest_token = None;
        for offset in 0..AUTH_SESSION_LIVE_LIMIT {
            let issue = mint(
                &provider,
                &mut database,
                "planned-cap@example.com",
                start_ms + offset as u64,
            )
            .await;
            if offset == 0 {
                oldest_token = Some(issue_token(&issue));
            }
        }
        let oldest: String = database
            .auth_catalog_read()
            .oldest_live_session_for_test()
            .expect("oldest session");
        let admission = provider
            .admit_email("planned-cap@example.com")
            .await
            .expect("cap admission");
        let plan = admission
            .plan_mint_session(&database, start_ms + AUTH_SESSION_LIVE_LIMIT as u64)
            .expect("cap issuance plan");
        let logout_admission = provider.admit().await;
        let PlannedLogout::Revoke(losing_logout) = logout_admission
            .plan_logout(
                &database,
                oldest_token.as_deref().expect("oldest bearer"),
                start_ms + AUTH_SESSION_LIVE_LIMIT as u64,
            )
            .expect("plan concurrent logout of oldest")
        else {
            panic!("oldest bearer must still be current before cap commit");
        };
        assert_eq!(
            plan.eviction().map(ProviderRevocationPlan::session_id),
            Some(oldest.as_str())
        );
        let commit_plan = plan.commit_plan();
        let AuthTransactionAttempt::Committed(PlannedIssuanceCommit::Committed {
            committed_revocations,
            ..
        }) = admission.commit_planned_issuance(&mut database, &commit_plan)
        else {
            panic!("twenty-first issuance must commit exact cap eviction");
        };
        assert_eq!(committed_revocations.len(), 1);
        assert_eq!(committed_revocations[0].session_id, oldest);
        assert_eq!(committed_revocations[0].generation, 2);
        assert!(matches!(
            logout_admission.commit_planned_revocation(
                &mut database,
                &losing_logout,
                start_ms + AUTH_SESSION_LIVE_LIMIT as u64,
            ),
            AuthTransactionAttempt::Committed(PlannedRevocationCommit::AlreadyTerminal {
                generation: 2,
                reason: Some(RevocationReason::CapEviction),
            })
        ));
        assert!(matches!(
            database
                .auth_catalog_read()
                .reconcile_planned_issuance(&commit_plan.catalog_plan())
                .expect("cap successor reconciliation"),
            CatalogIssuanceReconcile::ExactSuccessor {
                ref committed_revocations,
                ..
            } if committed_revocations.len() == 1 && committed_revocations[0].generation == 2
        ));
        let live: i64 = database
            .auth_catalog_read()
            .live_session_count_for_test()
            .expect("live session count");
        assert_eq!(live, AUTH_SESSION_LIVE_LIMIT as i64);
    }

    #[tokio::test]
    async fn password_issuance_finalizes_projection_and_returns_complete_typed_session() {
        let now_ms = 1_000_000;
        let (provider, mut database, coordinator) = password_provider_database_coordinator(now_ms);
        let plan = provider
            .plan_password_registration(
                &database,
                "Person@Example.com",
                PasswordSecret::new("a-strong-password-123".to_owned()),
                now_ms,
                "recovery-key-1",
                &[7; 32],
                PasswordIssuanceCustody::Bearer,
            )
            .await
            .expect("password registration plan");
        let (finish, terminal_targets) =
            commit_password_issuance_for_test(&provider, &mut database, &coordinator, plan, now_ms)
                .await;
        assert!(terminal_targets.is_empty());
        let IssuanceFinish::Committed { issue, .. } = finish else {
            panic!("password registration must commit");
        };
        let response = issue.response();
        assert_eq!(response.session.provider, "local-password");
        assert!(response.session.authority_instance_id.starts_with("aut_"));
        assert!(response.session.id.starts_with("ses_"));
        assert_eq!(response.session.generation, 1);
        assert_eq!(response.session.created_at, now_ms);
        assert!(response.session.expires_at > now_ms);
        assert!(response.session.absolute_expires_at > response.session.expires_at);
        assert_eq!(
            response.authority_descriptor.authority_instance_id,
            response.session.authority_instance_id
        );
        assert!(issue.recovery_codes().is_some());
        coordinator
            .resolve_required_bearer(
                response.token().expose_secret(),
                now_ms,
                provider.monotonic_now(),
            )
            .expect("password bearer resolves immediately without rebuild");
        let claims = database
            .identity_claims(
                &response.session.id,
                now_ms,
                crate::contract_types::ServerProfile::Test,
            )
            .expect("password claims");
        assert!(
            claims
                .assurances
                .iter()
                .all(|assurance| assurance.kind != AssuranceKind::EmailVerified),
            "password possession never confers email-verified assurance"
        );

        let admission = provider.admit().await;
        let PlannedRefresh::Rotate(rotation) = admission
            .plan_refresh(&database, response.token().expose_secret(), now_ms + 1)
            .expect("plan password-session refresh")
        else {
            panic!("fresh password session must rotate");
        };
        let commit_plan = rotation.commit_plan();
        let carrier = coordinator
            .premark_rotation(rotation)
            .await
            .expect("premark password-session refresh");
        let attempt = admission.commit_planned_rotation(&mut database, &commit_plan);
        let RotationFinish::Committed {
            issue: refreshed, ..
        } = coordinator
            .finish_rotation(carrier, attempt)
            .expect("finalize password-session refresh")
        else {
            panic!("password-session refresh must commit");
        };
        assert_eq!(refreshed.response().session.provider, "local-password");
        assert_eq!(
            refreshed
                .response()
                .authority_descriptor
                .authority_instance_id,
            response.authority_descriptor.authority_instance_id,
            "refresh preserves the password authority descriptor"
        );
    }

    #[tokio::test]
    async fn password_session_cap_evicts_oldest_with_terminal_cause() {
        let start_ms = 2_000_000;
        let (provider, mut database, coordinator) =
            password_provider_database_coordinator(start_ms);
        let first = register_password_for_test(
            &provider,
            &mut database,
            &coordinator,
            "cap@example.com",
            "a-strong-password-123",
            start_ms,
        )
        .await;
        let oldest = first.response().session.id.clone();
        let oldest_bearer = issue_token(&first);
        let mut cap_targets = Vec::new();
        for offset in 1..=AUTH_SESSION_LIVE_LIMIT {
            let (finish, targets) = password_signin_for_test(
                &provider,
                &mut database,
                &coordinator,
                "cap@example.com",
                "a-strong-password-123",
                start_ms + offset as u64,
            )
            .await;
            assert!(matches!(finish, IssuanceFinish::Committed { .. }));
            cap_targets = targets;
        }
        assert_eq!(cap_targets.len(), 1);
        assert_eq!(cap_targets[0].session_id(), oldest);
        assert!(
            coordinator
                .resolve_required_bearer(
                    &oldest_bearer,
                    start_ms + AUTH_SESSION_LIVE_LIMIT as u64,
                    provider.monotonic_now(),
                )
                .is_err()
        );
        assert_eq!(
            projected_terminal_reason_after_restart(
                &mut database,
                &oldest_bearer,
                start_ms + AUTH_SESSION_LIVE_LIMIT as u64,
            ),
            RevocationReason::CapEviction
        );
    }

    #[tokio::test]
    async fn password_change_rotates_same_authority_and_revokes_only_same_user_others() {
        let now_ms = 3_000_000;
        let (provider, mut database, coordinator) = password_provider_database_coordinator(now_ms);
        let acting = register_password_for_test(
            &provider,
            &mut database,
            &coordinator,
            "actor@example.com",
            "a-strong-password-123",
            now_ms,
        )
        .await;
        let acting_session = acting.response().session.id.clone();
        let acting_authority = acting
            .response()
            .authority_descriptor
            .authority_instance_id
            .clone();
        let (other_finish, _) = password_signin_for_test(
            &provider,
            &mut database,
            &coordinator,
            "actor@example.com",
            "a-strong-password-123",
            now_ms + 1,
        )
        .await;
        let IssuanceFinish::Committed { issue: other, .. } = other_finish else {
            panic!("second actor session must issue");
        };
        let other_bearer = issue_token(&other);
        let bystander = register_password_for_test(
            &provider,
            &mut database,
            &coordinator,
            "bystander@example.com",
            "another-strong-password-456",
            now_ms + 2,
        )
        .await;
        let bystander_bearer = issue_token(&bystander);
        let (finish, targets) = password_change_for_test(
            &provider,
            &mut database,
            &coordinator,
            acting.response().token(),
            "a-strong-password-123",
            "replacement-password-456",
            now_ms + 3,
        )
        .await;
        let PasswordChangeFinish::Committed(changed) = finish else {
            panic!("password change must commit");
        };
        assert_eq!(targets.len(), 1);
        assert_eq!(targets[0].session_id(), other.response().session.id);
        assert_eq!(changed.response().session.id, acting_session);
        assert_eq!(
            changed
                .response()
                .authority_descriptor
                .authority_instance_id,
            acting_authority,
            "same-authority credential rotation must preserve authority identity"
        );
        assert_ne!(issue_token(&changed), issue_token(&acting));
        assert_eq!(changed.response().session.provider, "local-password");
        assert!(
            coordinator
                .resolve_required_bearer(
                    changed.response().token().expose_secret(),
                    now_ms + 3,
                    provider.monotonic_now(),
                )
                .is_ok()
        );
        assert!(
            coordinator
                .resolve_required_bearer(&other_bearer, now_ms + 3, provider.monotonic_now(),)
                .is_err()
        );
        assert_eq!(
            projected_terminal_reason_after_restart(&mut database, &other_bearer, now_ms + 3),
            RevocationReason::DurableRevocation,
            "credential change records the durable-delete terminal cause"
        );
        assert!(
            coordinator
                .resolve_required_bearer(&bystander_bearer, now_ms + 3, provider.monotonic_now(),)
                .is_ok(),
            "another principal's session must survive user-scoped revocation"
        );
    }

    #[tokio::test]
    async fn stale_password_proof_is_uniform_invalid_without_failure_accounting() {
        let now_ms = 4_000_000;
        let (provider, mut database, coordinator) = password_provider_database_coordinator(now_ms);
        let acting = register_password_for_test(
            &provider,
            &mut database,
            &coordinator,
            "fence@example.com",
            "a-strong-password-123",
            now_ms,
        )
        .await;
        let stale = provider
            .plan_password_authentication(
                &database,
                "fence@example.com",
                PasswordSecret::new("a-strong-password-123".to_owned()),
                now_ms + 1,
                PasswordIssuanceCustody::Bearer,
            )
            .await
            .expect("stale KDF plan");
        let (changed, _) = password_change_for_test(
            &provider,
            &mut database,
            &coordinator,
            acting.response().token(),
            "a-strong-password-123",
            "replacement-password-456",
            now_ms + 2,
        )
        .await;
        assert!(matches!(changed, PasswordChangeFinish::Committed(_)));
        let (finish, _) = commit_password_issuance_for_test(
            &provider,
            &mut database,
            &coordinator,
            stale,
            now_ms + 1,
        )
        .await;
        assert!(matches!(finish, IssuanceFinish::CredentialInvalid));
        assert!(
            database
                .password_attempt_admin_projection("fence@example.com", now_ms + 2)
                .expect("admin projection")
                .is_none(),
            "stale proof must not penalize the credential ledger"
        );
    }

    #[tokio::test]
    async fn password_change_replans_sessions_after_identifier_admission() {
        let now_ms = 4_500_000;
        let (provider, mut database, coordinator) = password_provider_database_coordinator(now_ms);
        let acting = register_password_for_test(
            &provider,
            &mut database,
            &coordinator,
            "change-race@example.com",
            "a-strong-password-123",
            now_ms,
        )
        .await;

        // Phase 1 is the old broken cut: change discovered the credential and
        // planned the then-current revocation set before a racing sign-in
        // inserted its session.
        let discovery = provider
            .prepare_password_change(
                &database,
                acting.response().token(),
                now_ms + 1,
                PasswordIssuanceCustody::Bearer,
            )
            .expect("password change discovery");
        let identifier = discovery.canonical_identifier().to_owned();
        let (racing_finish, _) = password_signin_for_test(
            &provider,
            &mut database,
            &coordinator,
            &identifier,
            "a-strong-password-123",
            now_ms + 2,
        )
        .await;
        let IssuanceFinish::Committed {
            issue: racing_issue,
            ..
        } = racing_finish
        else {
            panic!("racing predecessor-password sign-in must commit before change");
        };
        let racing_session_id = racing_issue.response().session.id.clone();
        let racing_bearer = issue_token(&racing_issue);
        assert!(
            discovery
                .revocations
                .iter()
                .all(|target| target.session_id() != racing_session_id),
            "the pre-race discovery must reproduce the stale revocation snapshot"
        );

        // Phase 2 is the production repair: acquire the identifier stripe and
        // re-plan while sign-in issuance is excluded. The raced-in session is
        // therefore part of this exact change transaction's revocation set.
        let admission = provider
            .admit_email(&identifier)
            .await
            .expect("password identifier admission");
        let preparation = admission
            .prepare_password_change(
                &database,
                acting.response().token(),
                now_ms + 3,
                PasswordIssuanceCustody::Bearer,
            )
            .expect("password change re-plan");
        let plan = provider
            .finish_password_change(
                preparation,
                PasswordSecret::new("a-strong-password-123".to_owned()),
                PasswordSecret::new("replacement-password-456".to_owned()),
                now_ms + 3,
                PasswordIssuanceCustody::Bearer,
            )
            .await
            .expect("password change plan");
        let commit_plan = plan.commit_plan();
        let carrier = coordinator
            .premark_password_change(plan)
            .await
            .expect("premark password change");
        let attempt = provider.commit_password_change(&mut database, &commit_plan);
        let (finish, targets) = coordinator
            .finish_password_change(carrier, attempt)
            .into_parts();
        drop(admission);

        assert!(matches!(
            finish.expect("finish password change"),
            PasswordChangeFinish::Committed(_)
        ));
        assert!(
            targets
                .iter()
                .any(|target| target.session_id() == racing_session_id),
            "fresh planning under the identifier stripe must include the raced-in session"
        );
        assert!(
            coordinator
                .resolve_required_bearer(&racing_bearer, now_ms + 3, provider.monotonic_now(),)
                .is_err(),
            "the predecessor-password session must be terminal after change"
        );
        assert_eq!(
            projected_terminal_reason_after_restart(&mut database, &racing_bearer, now_ms + 3,),
            RevocationReason::DurableRevocation,
            "the raced-in session must also be durably terminal"
        );
    }

    #[tokio::test]
    async fn password_lockout_is_uniform_resets_decays_and_expires() {
        let now_ms = 5_000_000;
        let (provider, mut database, coordinator) = password_provider_database_coordinator(now_ms);
        register_password_for_test(
            &provider,
            &mut database,
            &coordinator,
            "locked@example.com",
            "a-strong-password-123",
            now_ms,
        )
        .await;
        for offset in 1..=10 {
            let (finish, targets) = password_signin_for_test(
                &provider,
                &mut database,
                &coordinator,
                "locked@example.com",
                "wrong-password-123",
                now_ms + offset,
            )
            .await;
            assert!(matches!(finish, IssuanceFinish::CredentialInvalid));
            assert!(targets.is_empty());
        }
        let locked = database
            .password_attempt_admin_projection("locked@example.com", now_ms + 10)
            .expect("admin lock projection")
            .expect("attempt row");
        assert_eq!(locked.failed_count, 10);
        assert!(locked.locked);
        let locked_until = locked.locked_until_ms.expect("lock deadline");
        let locked_started = Instant::now();
        let (locked_finish, _) = password_signin_for_test(
            &provider,
            &mut database,
            &coordinator,
            "locked@example.com",
            "a-strong-password-123",
            now_ms + 11,
        )
        .await;
        let locked_elapsed = locked_started.elapsed();
        assert!(matches!(locked_finish, IssuanceFinish::CredentialInvalid));

        let missing_started = Instant::now();
        let (missing_finish, _) = password_signin_for_test(
            &provider,
            &mut database,
            &coordinator,
            "missing@example.com",
            "a-strong-password-123",
            now_ms + 11,
        )
        .await;
        let missing_elapsed = missing_started.elapsed();
        assert!(matches!(missing_finish, IssuanceFinish::CredentialInvalid));
        let timing_delta = locked_elapsed.abs_diff(missing_elapsed);
        assert!(
            timing_delta <= Duration::from_millis(250),
            "real locked and nonexistent KDF paths exceeded the declared 250ms test envelope: {locked_elapsed:?} vs {missing_elapsed:?}"
        );
        register_password_for_test(
            &provider,
            &mut database,
            &coordinator,
            "wrong@example.com",
            "another-strong-password-456",
            now_ms + 12,
        )
        .await;
        let wrong_started = Instant::now();
        let (wrong_finish, _) = password_signin_for_test(
            &provider,
            &mut database,
            &coordinator,
            "wrong@example.com",
            "a-strong-password-123",
            now_ms + 13,
        )
        .await;
        let wrong_elapsed = wrong_started.elapsed();
        assert!(matches!(wrong_finish, IssuanceFinish::CredentialInvalid));
        assert_eq!(
            credential_invalid().diagnostic().code,
            "SNAPBACK_AUTH_CREDENTIAL_INVALID",
            "every internal invalid outcome maps to the one public credential code"
        );
        assert!(
            wrong_elapsed.abs_diff(missing_elapsed) <= Duration::from_millis(250),
            "wrong-account and nonexistent KDF paths exceeded the declared 250ms test envelope: {wrong_elapsed:?} vs {missing_elapsed:?}"
        );

        let (reopened, _) = password_signin_for_test(
            &provider,
            &mut database,
            &coordinator,
            "locked@example.com",
            "a-strong-password-123",
            locked_until,
        )
        .await;
        assert!(matches!(reopened, IssuanceFinish::Committed { .. }));
        assert!(
            database
                .password_attempt_admin_projection("locked@example.com", locked_until)
                .expect("success reset")
                .is_none()
        );

        for offset in 0..3 {
            let (finish, _) = password_signin_for_test(
                &provider,
                &mut database,
                &coordinator,
                "locked@example.com",
                "wrong-password-123",
                locked_until + 1 + offset,
            )
            .await;
            assert!(matches!(finish, IssuanceFinish::CredentialInvalid));
        }
        let rolled_at = locked_until + provider.password_security.failure_window_ms + 2;
        let (rolled, _) = password_signin_for_test(
            &provider,
            &mut database,
            &coordinator,
            "locked@example.com",
            "wrong-password-123",
            rolled_at,
        )
        .await;
        assert!(matches!(rolled, IssuanceFinish::CredentialInvalid));
        assert_eq!(
            database
                .password_attempt_admin_projection("locked@example.com", rolled_at)
                .expect("rolled admin state")
                .expect("rolled row")
                .failed_count,
            1
        );

        let (owner_success, _) = password_signin_for_test(
            &provider,
            &mut database,
            &coordinator,
            "locked@example.com",
            "a-strong-password-123",
            rolled_at + 1,
        )
        .await;
        assert!(matches!(owner_success, IssuanceFinish::Committed { .. }));
        assert!(
            database
                .password_attempt_admin_projection("locked@example.com", rolled_at + 1)
                .expect("owner reset")
                .is_none()
        );
    }

    #[tokio::test]
    async fn lock_acquired_while_kdf_is_in_flight_blocks_the_precomputed_success() {
        let now_ms = 5_500_000;
        let (provider, mut database, coordinator) = password_provider_database_coordinator(now_ms);
        register_password_for_test(
            &provider,
            &mut database,
            &coordinator,
            "ledger-fence@example.com",
            "a-strong-password-123",
            now_ms,
        )
        .await;
        for offset in 1..=9 {
            let (finish, _) = password_signin_for_test(
                &provider,
                &mut database,
                &coordinator,
                "ledger-fence@example.com",
                "wrong-password-123",
                now_ms + offset,
            )
            .await;
            assert!(matches!(finish, IssuanceFinish::CredentialInvalid));
        }
        let precomputed_success = provider
            .plan_password_authentication(
                &database,
                "ledger-fence@example.com",
                PasswordSecret::new("a-strong-password-123".to_owned()),
                now_ms + 10,
                PasswordIssuanceCustody::Bearer,
            )
            .await
            .expect("success proof computed outside writer");
        let (tenth, _) = password_signin_for_test(
            &provider,
            &mut database,
            &coordinator,
            "ledger-fence@example.com",
            "wrong-password-123",
            now_ms + 10,
        )
        .await;
        assert!(matches!(tenth, IssuanceFinish::CredentialInvalid));
        let (blocked, _) = commit_password_issuance_for_test(
            &provider,
            &mut database,
            &coordinator,
            precomputed_success,
            now_ms + 10,
        )
        .await;
        assert!(matches!(blocked, IssuanceFinish::CredentialInvalid));
        let locked = database
            .password_attempt_admin_projection("ledger-fence@example.com", now_ms + 10)
            .expect("admin projection")
            .expect("ledger row");
        assert_eq!(locked.failed_count, 10);
        assert!(locked.locked);
    }

    #[tokio::test]
    async fn password_kdf_cap_and_sender_custody_refuse_with_typed_codes() {
        let now_ms = 6_000_000;
        let (provider, database, _) = password_provider_database_coordinator(now_ms);
        let permits = Arc::clone(&provider.password_kdf_permits)
            .try_acquire_many_owned(provider.password_security.kdf_concurrency as u32)
            .expect("hold entire password KDF capacity");
        let throttled = provider
            .hash_password_bounded(PasswordSecret::new("a-strong-password-123".to_owned()))
            .await
            .expect_err("KDF saturation must not queue");
        assert_eq!(throttled.diagnostic.code, "SNAPBACK_AUTH_THROTTLED");
        drop(permits);
        let refused = provider
            .plan_password_registration(
                &database,
                "sender@example.com",
                PasswordSecret::new("a-strong-password-123".to_owned()),
                now_ms,
                "recovery-key-1",
                &[7; 32],
                PasswordIssuanceCustody::SenderConstrained,
            )
            .await
            .expect_err("sender-constrained password issuance is typed-refused");
        assert_eq!(
            refused.diagnostic.code,
            "SNAPBACK_AUTH_PASSWORD_SENDER_CONSTRAINED_UNSUPPORTED"
        );
    }

    #[tokio::test]
    async fn imported_hash_upgrades_by_generation_cas_and_lost_race_does_not_overwrite() {
        let now_ms = 7_000_000;
        let (provider, mut database, coordinator) = password_provider_database_coordinator(now_ms);
        register_password_for_test(
            &provider,
            &mut database,
            &coordinator,
            "upgrade@example.com",
            "a-strong-password-123",
            now_ms,
        )
        .await;
        let imported = bcrypt::hash("a-strong-password-123", 4).expect("bcrypt fixture");
        database
            .install_imported_password_hash_for_test("upgrade@example.com", "bcrypt", &imported)
            .expect("install imported hash");
        let first = provider
            .plan_password_authentication(
                &database,
                "upgrade@example.com",
                PasswordSecret::new("a-strong-password-123".to_owned()),
                now_ms + 1,
                PasswordIssuanceCustody::Bearer,
            )
            .await
            .expect("first upgrade plan");
        let losing = provider
            .plan_password_authentication(
                &database,
                "upgrade@example.com",
                PasswordSecret::new("a-strong-password-123".to_owned()),
                now_ms + 2,
                PasswordIssuanceCustody::Bearer,
            )
            .await
            .expect("racing upgrade plan");
        let (winner, _) = commit_password_issuance_for_test(
            &provider,
            &mut database,
            &coordinator,
            first,
            now_ms + 1,
        )
        .await;
        assert!(matches!(winner, IssuanceFinish::Committed { .. }));
        let (generation, algorithm, phc) = database
            .password_hash_facts_for_test("upgrade@example.com")
            .expect("upgraded hash facts");
        assert_eq!(generation, 2);
        assert_eq!(algorithm, "argon2id");
        assert!(phc.starts_with("$argon2id$"));
        let (loser, _) = commit_password_issuance_for_test(
            &provider,
            &mut database,
            &coordinator,
            losing,
            now_ms + 2,
        )
        .await;
        assert!(matches!(loser, IssuanceFinish::CredentialInvalid));
        assert_eq!(
            database
                .password_hash_facts_for_test("upgrade@example.com")
                .expect("winner remains authoritative")
                .0,
            2
        );
        assert!(
            database
                .password_attempt_admin_projection("upgrade@example.com", now_ms + 2)
                .expect("lost upgrade ledger")
                .is_none()
        );
    }

    #[tokio::test]
    async fn password_upgrade_uses_declared_minimum_profile() {
        let low_now_ms = 7_100_000;
        let (low_provider, mut low_database, low_coordinator) =
            password_provider_database_coordinator_with_minimum(low_now_ms, 8);
        register_password_for_test(
            &low_provider,
            &mut low_database,
            &low_coordinator,
            "minimum-eight@example.com",
            "eight888",
            low_now_ms,
        )
        .await;
        let low_imported = bcrypt::hash("eight888", 4).expect("bcrypt fixture");
        low_database
            .install_imported_password_hash_for_test(
                "minimum-eight@example.com",
                "bcrypt",
                &low_imported,
            )
            .expect("install imported hash");
        let (low_finish, _) = password_signin_for_test(
            &low_provider,
            &mut low_database,
            &low_coordinator,
            "minimum-eight@example.com",
            "eight888",
            low_now_ms + 1,
        )
        .await;
        assert!(matches!(low_finish, IssuanceFinish::Committed { .. }));
        let (low_generation, _, low_phc) = low_database
            .password_hash_facts_for_test("minimum-eight@example.com")
            .expect("upgraded low-minimum hash");
        assert_eq!(low_generation, 2);
        assert!(low_phc.starts_with("$argon2id$"));

        let high_now_ms = 7_200_000;
        let (high_provider, mut high_database, high_coordinator) =
            password_provider_database_coordinator_with_minimum(high_now_ms, 20);
        register_password_for_test(
            &high_provider,
            &mut high_database,
            &high_coordinator,
            "minimum-twenty@example.com",
            "a-strong-password-123",
            high_now_ms,
        )
        .await;
        let high_imported = bcrypt::hash("fifteen-char-pw", 4).expect("bcrypt fixture");
        high_database
            .install_imported_password_hash_for_test(
                "minimum-twenty@example.com",
                "bcrypt",
                &high_imported,
            )
            .expect("install imported hash");
        let (high_finish, _) = password_signin_for_test(
            &high_provider,
            &mut high_database,
            &high_coordinator,
            "minimum-twenty@example.com",
            "fifteen-char-pw",
            high_now_ms + 1,
        )
        .await;
        assert!(matches!(high_finish, IssuanceFinish::Committed { .. }));
        let (high_generation, _, high_phc) = high_database
            .password_hash_facts_for_test("minimum-twenty@example.com")
            .expect("retained high-minimum legacy hash");
        assert_eq!(
            high_generation, 1,
            "a skipped upgrade must not bump generation"
        );
        assert_eq!(high_phc, high_imported);
    }

    #[tokio::test]
    async fn password_set_displaces_only_local_password_identity_sessions() {
        let now_ms = 8_000_000;
        let (provider, mut database, coordinator) = password_provider_database_coordinator(now_ms);
        let squatter = register_password_for_test(
            &provider,
            &mut database,
            &coordinator,
            "claimed@example.com",
            "a-strong-password-123",
            now_ms,
        )
        .await;
        let squatter_password_bearer = issue_token(&squatter);
        let squatter_user = squatter.response().session.user_id.clone();
        let displaced = database
            .password_snapshot("claimed@example.com")
            .expect("password snapshot")
            .expect("displaced credential");
        let (_, _, squatter_other_bearer) = database
            .insert_other_identity_session_for_test(
                &squatter_user,
                "other@example.com",
                now_ms + 1,
                provider.random.as_ref(),
            )
            .expect("other-identity session fixture");
        let actor = email_issue_for_test(
            &provider,
            &mut database,
            &coordinator,
            "claimed@example.com",
            now_ms + 2,
        )
        .await;
        let actor_old_bearer = issue_token(&actor);
        let actor_identity = database
            .identity_id_for_provider_subject_for_test("email-code", "claimed@example.com")
            .expect("actor email identity");
        let actor_session = &actor.response().session;
        let password_set_binding = StepUpBinding::password_set(
            actor_session.user_id.clone(),
            actor_session.id.clone(),
            actor_session.generation,
            actor_session.authority_instance_id.clone(),
            actor_identity.clone(),
        );
        let admission = provider.admit().await;
        let step_up_address = admission
            .step_up_address(&database, &password_set_binding, now_ms + 2)
            .expect("password-set step-up address");
        let step_up_request = admission
            .for_address(step_up_address)
            .await
            .expect("password-set address admission")
            .request_step_up(&mut database, &password_set_binding)
            .expect("password-set step-up challenge");
        let mailbox = serde_json::to_value(
            provider
                .mailbox_entry(&step_up_request.challenge_id)
                .await
                .expect("password-set step-up mailbox"),
        )
        .expect("serialize password-set step-up mailbox");
        let step_up_code = mailbox["code"]
            .as_str()
            .expect("password-set step-up code")
            .to_owned();
        let admission = provider.admit().await;
        let coordination = admission
            .step_up_coordination(&database, &step_up_request.challenge_id)
            .expect("password-set step-up coordination");
        let step_up = admission
            .for_step_up(coordination, password_set_binding, &step_up_code)
            .await
            .expect("password-set proof admission");

        // Pull the test-only fixture session into the same memory-only
        // projection before exercising exact displacement finalization.
        let snapshot = database
            .admitted_session_projection_snapshot()
            .expect("admitted projection snapshot");
        let coordinator = Arc::new(
            AuthCoordinator::from_admitted_snapshot(
                snapshot,
                coordinator_admission(),
                now_ms + 2,
                provider.monotonic_now(),
            )
            .expect("coordinator"),
        );
        let preparation = provider
            .prepare_password_set(
                &database,
                actor.response().token(),
                &actor_identity,
                "claimed@example.com",
                now_ms + 3,
                PasswordIssuanceCustody::Bearer,
            )
            .expect("displacing password-set preparation");
        let plan = provider
            .finish_password_set(
                preparation,
                step_up.proof().clone(),
                PasswordSecret::new("rightful-password-456".to_owned()),
                now_ms + 3,
                "recovery-key-1",
                &[7; 32],
                PasswordIssuanceCustody::Bearer,
            )
            .await
            .expect("displacing password-set plan");
        let (finish, targets) = commit_password_issuance_for_test(
            &provider,
            &mut database,
            &coordinator,
            plan,
            now_ms + 3,
        )
        .await;
        let IssuanceFinish::Committed {
            issue: new_password,
            ..
        } = finish
        else {
            panic!("password set must commit");
        };
        assert_eq!(targets.len(), 2);
        let terminated_session_ids = targets
            .iter()
            .map(CommittedRevocationTarget::session_id)
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(
            terminated_session_ids,
            [
                squatter.response().session.id.as_str(),
                actor.response().session.id.as_str(),
            ]
            .into_iter()
            .collect(),
            "displacement terminates exactly the displaced password session and actor predecessor"
        );
        assert!(
            coordinator
                .resolve_required_bearer(
                    &squatter_password_bearer,
                    now_ms + 3,
                    provider.monotonic_now(),
                )
                .is_err(),
            "session minted through displaced password identity must terminate"
        );
        assert!(
            coordinator
                .resolve_required_bearer(
                    squatter_other_bearer.expose_secret(),
                    now_ms + 3,
                    provider.monotonic_now(),
                )
                .is_ok(),
            "displaced principal's other-identity session must survive"
        );
        assert!(
            coordinator
                .resolve_required_bearer(&actor_old_bearer, now_ms + 3, provider.monotonic_now(),)
                .is_err(),
            "password set rotates the authenticated actor to the new issuance"
        );
        assert_eq!(
            projected_terminal_reason_after_restart(
                &mut database,
                &squatter_password_bearer,
                now_ms + 3,
            ),
            RevocationReason::DurableRevocation,
            "displaced password authority carries durable-delete terminal semantics"
        );
        assert!(
            coordinator
                .resolve_required_bearer(
                    new_password.response().token().expose_secret(),
                    now_ms + 3,
                    provider.monotonic_now(),
                )
                .is_ok()
        );
        assert_eq!(
            database
                .displacement_facts_for_test(
                    &displaced.identity_id,
                    &displaced.credential_id,
                    &squatter_user,
                )
                .expect("displacement facts"),
            (true, true, true),
            "credential and identity retire without deleting the principal"
        );
        let claims = database
            .identity_claims(
                &new_password.response().session.id,
                now_ms + 3,
                crate::contract_types::ServerProfile::Test,
            )
            .expect("new password claims");
        assert!(
            claims
                .assurances
                .iter()
                .all(|assurance| assurance.kind != AssuranceKind::EmailVerified)
        );
    }

    #[tokio::test]
    async fn guest_claim_and_recovery_consume_use_shared_issuance_finalization() {
        let now_ms = 9_000_000;
        let (provider, mut database, _) = password_provider_database_coordinator(now_ms);
        let guest = database
            .insert_typed_guest_session_for_test(now_ms + 60_000, now_ms, provider.random.as_ref())
            .expect("guest fixture");
        let snapshot = database
            .admitted_session_projection_snapshot()
            .expect("admitted guest projection snapshot");
        let coordinator = Arc::new(
            AuthCoordinator::from_admitted_snapshot(
                snapshot,
                coordinator_admission(),
                now_ms,
                provider.monotonic_now(),
            )
            .expect("coordinator"),
        );
        let claim = provider
            .plan_guest_claim_password(
                &database,
                &guest.bearer,
                "guest@example.com",
                PasswordSecret::new("a-strong-password-123".to_owned()),
                now_ms + 1,
                "recovery-key-1",
                &[7; 32],
                snapback_kernel::auth::throttle::RollingWindowBudgetTerms {
                    limit: 10,
                    window_ms: 1_000,
                },
                PasswordIssuanceCustody::Bearer,
            )
            .await
            .expect("guest password claim plan");
        let original_session_id = guest.session_id.clone();
        let original_authority_id = match database
            .auth_catalog_read()
            .lookup_presented_session(&guest.bearer.token_hash())
            .expect("guest session lookup")
        {
            PresentedSessionLookup::Current(session) => session.session.authority_instance_id,
            other => panic!("guest bearer must be current, got {other:?}"),
        };
        let commit_plan = claim.commit_plan();
        let carrier = coordinator
            .premark_password_change(claim)
            .await
            .expect("premark guest claim");
        let attempt = provider.commit_password_change(&mut database, &commit_plan);
        let (claim_finish, claim_targets) = coordinator
            .finish_password_change(carrier, attempt)
            .into_parts();
        let claim_finish = claim_finish.expect("finish guest claim");
        let claimed = match claim_finish {
            PasswordChangeFinish::Committed(claimed) => claimed,
            other => panic!("guest claim must commit, got {other:?}"),
        };
        assert!(claim_targets.is_empty());
        assert_eq!(claimed.response().session.user_id, guest.user_id);
        assert_eq!(claimed.response().session.id, original_session_id);
        assert_eq!(
            claimed.response().session.authority_instance_id,
            original_authority_id
        );
        assert!(
            coordinator
                .resolve_required_bearer(
                    guest.bearer.expose_secret(),
                    now_ms + 1 + AUTH_SESSION_SUPERSESSION_GRACE_MS + 1,
                    provider.monotonic_now(),
                )
                .is_err()
        );
        let recovery_code = claimed
            .recovery_codes()
            .expect("initial recovery codes")
            .expose_once()[0]
            .clone();
        let recovery = provider
            .plan_password_recovery_consume(
                &database,
                "guest@example.com",
                &recovery_code,
                now_ms + 2,
                "recovery-key-1",
                &[7; 32],
                PasswordIssuanceCustody::Bearer,
            )
            .expect("recovery consume plan");
        let claimed_bearer = issue_token(&claimed);
        let (recovery_finish, recovery_targets) = commit_password_issuance_for_test(
            &provider,
            &mut database,
            &coordinator,
            recovery,
            now_ms + 2,
        )
        .await;
        let IssuanceFinish::Committed {
            issue: recovered, ..
        } = recovery_finish
        else {
            panic!("recovery consume must commit");
        };
        assert_eq!(recovery_targets.len(), 1);
        assert!(recovered.recovery_codes().is_some());
        assert!(
            coordinator
                .resolve_required_bearer(&claimed_bearer, now_ms + 2, provider.monotonic_now(),)
                .is_err()
        );
        assert!(
            coordinator
                .resolve_required_bearer(
                    recovered.response().token().expose_secret(),
                    now_ms + 2,
                    provider.monotonic_now(),
                )
                .is_ok()
        );
    }

    #[tokio::test]
    async fn guest_claim_reaped_during_kdf_window_is_predecessor_changed_not_collision() {
        let now_ms = 10_000_000;
        let (provider, mut database, _) = password_provider_database_coordinator(now_ms);
        let guest = database
            .identity_guest_create(now_ms + 60_000, now_ms, provider.random.as_ref())
            .expect("guest race fixture");
        let preparation = provider
            .prepare_guest_claim_password(
                &database,
                &guest.bearer,
                "race-reaped-guest@example.com",
                now_ms + 1,
                PasswordIssuanceCustody::Bearer,
            )
            .expect("claim preparation before KDF");
        let reaped = database
            .identity_reap_guests_default_tombstone(now_ms + 60_000)
            .expect("reap during claim KDF window");
        assert_eq!(reaped.reaped, 1);
        let plan = provider
            .finish_guest_claim_password(
                preparation,
                PasswordSecret::new("race-reaped-password-123!".to_owned()),
                now_ms + 2,
                "recovery-key-1",
                &[7; 32],
                snapback_kernel::auth::throttle::RollingWindowBudgetTerms {
                    limit: 10,
                    window_ms: 1_000,
                },
                PasswordIssuanceCustody::Bearer,
            )
            .await
            .expect("KDF still completes uniformly");
        assert!(matches!(
            provider.commit_password_change(&mut database, &plan.commit_plan()),
            AuthTransactionAttempt::Committed(PlannedPasswordChangeCommit::PredecessorChanged)
        ));
    }
}
