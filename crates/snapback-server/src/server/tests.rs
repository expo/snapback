use super::{
    ACTION_WATCHDOG_DEFAULT_MS, ACTION_WATCHDOG_MAX_MS, ACTION_WORKER_LIMIT_DEFAULT,
    ACTION_WORKER_LIMIT_MAX, ADMITTED_BODY_INGEST_DEADLINE_MS, ActionTerminalLatch, AdmissionLease,
    CRON_DISPATCH_CONCURRENCY_DEFAULT, CRON_DISPATCH_CONCURRENCY_MAX, ConnectionGrant,
    ConnectionOpenAttempt, DetachedActionHost, DetachedActionWorkerCounters, HostOperationParentV1,
    ManagedWriterCancellation, NestedActionEffect, OpenConnectionRequest, PolicyAuthMode,
    PreparedAuthority, RealtimeEnvelope, SharedSnapback, SnapbackApp,
    TEST_ASSET_RETRY_GUARD_HEADER, TEST_FINITE_AUTHORITY_PAUSE_HEADER,
    TEST_PAIRING_COMMIT_GUARD_RETIRE_HEADER, TEST_PAIRING_WRITER_BUDGET_HEADER,
    TestAssetRetryGuardAction, TestFiniteAuthorityPausePoint, already_terminal_session_error, app,
    configured_action_worker_limit, configured_cron_dispatch_concurrency, coordinated_app_reset,
    dispatch_cron_tick_background, finish_registered_response,
    install_committed_reset_handoff_test_hook, install_detached_nested_mutation_test_pause,
    install_test_asset_retry_guard, install_test_finite_authority_pause,
    linearize_detached_action_abandonment, parse_action_watchdog_timeout, parse_optional_json,
    reserve_detached_action_worker, reserve_detached_action_worker_with_counters,
    retain_realtime_authority_in, run_detached_ibex_action_with_admission_and_counters,
    spawn_detached_action_worker, status_for_diagnostic_code, with_snapback,
    with_snapback_staged_authorization_write,
};
use crate::manifest::SchemaManifestValidationExt as _;
use crate::remainder_adapter::RemainderLocalSnapbackExt as _;
use crate::storage::auth_rescue::{
    AuthCollisionFixtureIndexForTest, AuthCollisionFixtureRowForTest,
    AuthCollisionFixtureTableForTest, install_auth_collision_fixtures_for_test,
};

// @ref LLP 0316#phase-2--test-currency — generated, gitignored demo fixtures
// stay runtime preconditions of the tests that consume them, not crate inputs.
fn read_generated_demo_fixture(relative_path: &str, demo_name: &str) -> String {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("src/server")
        .join(relative_path);
    std::fs::read_to_string(&path).unwrap_or_else(|error| {
        panic!(
            "failed to read generated demo fixture at {}: {error}\n\
             run from the repository root: node packages/snapback-codegen/index.mjs demos/{demo_name}/snapback\n\
             generated demo outputs are gitignored; this test reads them at run time so a missing fixture fails only this test instead of breaking the crate's compilation (LLP 0316 Phase 2)",
            path.display()
        )
    })
}

fn filter_telemetry_events_for_test(
    rows: Vec<crate::telemetry_query::TelemetryEventV1>,
    kind: Option<&str>,
    name: Option<&str>,
) -> Vec<crate::telemetry_query::TelemetryEventV1> {
    rows.into_iter()
        .filter(|event| kind.is_none_or(|kind| event.kind == kind))
        .filter(|event| name.is_none_or(|name| event.name == name))
        .collect()
}

fn physical_telemetry_events_for_test(
    telemetry: &crate::telemetry::Telemetry,
    kind: Option<&str>,
    name: Option<&str>,
) -> Vec<crate::telemetry_query::TelemetryEventV1> {
    filter_telemetry_events_for_test(
        telemetry
            .physical_event_rows_for_test()
            .expect("physical telemetry test query"),
        kind,
        name,
    )
}

fn test_session_claims_for(
    authority: &ResolvedAppAuthority,
) -> Option<crate::auth::identity_core::AuthClaimsProjection> {
    matches!(authority, ResolvedAppAuthority::Session(_)).then(|| {
        crate::auth::identity_core::AuthClaimsProjection::server_derived(Vec::new(), Vec::new())
    })
}

use crate::admin::{AppState, ServerContext};
use crate::admin_impersonation::{
    IMPERSONATION_CAPABILITY_HEADER, ImpersonationCapabilityRegistry,
};
use crate::auth::crypto::{
    AgentCredential, CryptoError, OsRandom, RandomSource, ScopedToken, SessionBearer,
};
use crate::auth::deployment::{
    AuthenticationBucketPolicy, AuthenticationThrottle, BrowserCredentialPosture,
    BrowserDirectBearerSeam, EffectiveSource, ExternalTls, HostedAdmission, HostedAuthCapabilities,
    HostedOperatorSurface, HostedServingAuthority, SessionInvalidation,
    SharedAuthenticationThrottleConfig,
};
use crate::auth::invalidation::{AuthorizationInvalidationConnection, IssuerId, QueryNamespace};
use crate::auth::invocation::{
    InvocationGate, InvocationSource, ResolvedAppAuthority, WireAuthorityFields,
};
use crate::auth::keyring::AuthKeyringStore;
use crate::auth::lifecycle::activate_catalog;
use crate::auth::mode::{
    AppDataAvailability, AuthModeQuarantine, AuthModeStateRecord, AuthModeStatus,
    AuthProgramReadiness, DeploymentIdentity, FUNCTION_V1_PREFIX, INPUTS_V1_PREFIX,
    SCHEMA_V1_PREFIX,
};
use crate::auth::provider::{
    AUTH_SESSION_SLIDING_WINDOW_MS, AUTH_SESSION_SUPERSESSION_GRACE_MS,
    AUTH_SESSION_USE_COALESCE_MS, AuthClock, AuthProvider,
};
use crate::auth::service_authority_contract::ServiceAuthorityDisposition;
use crate::auth::service_fence::{
    ServiceAuthorityActResolution, with_service_authority_terminal_gate,
};
use crate::contract_types::{
    AuthAbuseBudgetPolicyManifestV1, AuthBudgetProfilesManifestV1, AuthBudgetTermsManifestV1,
    AuthMechanismManifestV1, AuthProgramManifestV1, AuthProviderProfile, GuestCleanupActionV1,
    GuestCleanupContractV1, GuestPolicyManifestV1, GuestReapingPolicyV1, RevocationReason,
    ServerProfile,
};
use crate::cron::CronRunOutcome;
use crate::diagnostic::SnapbackError;
use crate::local::{EnsureAppMode, LiveSubscribeInput, LocalSnapback, StagedAction};
use crate::manifest::{
    ActionPlan, ActionReturnValue, ActionStep, AgentsManifest, AgentsMode, ApiAskBilling,
    ApiAskBudgets, ApiAskManifest, ApiAskModelManifest, ApiAskPerPrincipalDayBudget,
    ApiAskPerRequestBudget, ApiAskResultVolumeBudget, ApiAskTokenBudget, ApiBudgetsManifest,
    ApiDisclosure, ApiFunctionApproval, ApiFunctionExposure, ApiManifest, ApiOAuthBundle,
    ApiOAuthManifest, AuthInput, AuthManifest, AuthMode, AuthRequirement, CronActivationPolicy,
    CronJitterPolicy, CronJobDefinition, CronOverlapPolicy, CronRetryMode, CronRetryPolicy,
    CronSchedule, FieldManifest, FieldType, FilterExpr, FilterOp, FunctionDefinition, FunctionKind,
    FunctionManifest, FunctionRuntime, HandlerInput, HandlerPlan, IbexModule, InvitedBy,
    MutationAcknowledgementRequest, MutationPlan, MutationStep, QueryPlan, ReturnValue,
    SNAPBACK_SESSIONS_SCHEMA_VERSION, SchemaManifest, SeedData, TableManifest, TargetCapabilityId,
    ValueExpr,
};
use crate::runtime::{ActionStreamRequest, HostFetchRequest, IbexActionHost};
use crate::storage::ClientMutationIdentity;
use crate::storage::auth::AuthTransactionAttempt;
use crate::storage::auth::PasswordIdentifierMode;
use axum::Json;
use axum::body::{Body, Bytes, to_bytes};
use axum::extract::{ConnectInfo, Extension, Path as AxumPath, State};
use axum::http::{HeaderMap, HeaderName, HeaderValue, Request, StatusCode, header};
use axum::response::IntoResponse as _;
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use futures_util::{SinkExt as _, StreamExt as _};
use ring::rand::SystemRandom;
use ring::signature::{ECDSA_P256_SHA256_FIXED_SIGNING, EcdsaKeyPair, Ed25519KeyPair, KeyPair};
use serde_json::{Map, Value, json};
use sha2::{Digest as _, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::{Read as _, Seek as _, SeekFrom, Write as _};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex as StdMutex, OnceLock};
use std::time::{Duration, Instant};
use syn::visit::Visit;
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
use tokio::net::TcpListener;
use tokio::sync::{Mutex, Semaphore};
use tower::ServiceExt as _;
use uuid::Uuid;

fn test_app_state_from_snapback(snapback: LocalSnapback, context: ServerContext) -> AppState {
    AppState::try_from_snapback(snapback, context).expect("test app state")
}

fn test_detached_app_state(snapback: LocalSnapback) -> AppState {
    AppState::try_detached(snapback).expect("detached test app state")
}

fn operator_delete_server_fixture(profile: ServerProfile, derived: bool) -> AppState {
    let mut context = ServerContext::detached();
    context.profile = profile;
    context.admin_token = Some("operator-delete-admin".to_owned());
    let mut snapback = LocalSnapback::memory().expect("operator delete server fixture");
    snapback
        .register_ephemeral_collection(EphemeralCollection::local_cursor("boardCursors", "boardId"))
        .expect("register operator delete fixture collection");
    let mut state = test_app_state_from_snapback(snapback, context)
        .with_server_startup_nonce("operator-delete-startup")
        .expect("install deterministic startup nonce");
    if derived {
        state.derived_instance_identity = Some(crate::instance_fork::DerivedForkLineageV1 {
            format_version: 1,
            fork_id: "fork_operator_delete_test".to_owned(),
            parent_instance_id: "parent-test".to_owned(),
            app_id: "operator-delete-test".to_owned(),
            created_at_ms: 1,
            fork_point_version: 1,
            expires_at_ms: Some(u64::MAX),
            promotable: false,
        });
    }
    state
}

fn operator_delete_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    headers.insert(
        "x-snapback-admin-token",
        HeaderValue::from_static("operator-delete-admin"),
    );
    headers
}

struct ManualServerAuthClock {
    base_epoch_ms: u64,
    epoch_ms: AtomicU64,
    monotonic_origin: Instant,
}

struct ToggleServerRandom {
    unavailable: AtomicBool,
}

impl RandomSource for ToggleServerRandom {
    fn fill(&self, destination: &mut [u8]) -> Result<(), CryptoError> {
        if self.unavailable.load(Ordering::SeqCst) {
            Err(CryptoError::RandomUnavailable)
        } else {
            OsRandom.fill(destination)
        }
    }
}

impl ManualServerAuthClock {
    fn new(epoch_ms: u64) -> Self {
        Self {
            base_epoch_ms: epoch_ms,
            epoch_ms: AtomicU64::new(epoch_ms),
            monotonic_origin: Instant::now(),
        }
    }

    fn set(&self, epoch_ms: u64) {
        self.epoch_ms.store(epoch_ms, Ordering::SeqCst);
    }

    fn monotonic_at(&self, epoch_ms: u64) -> Instant {
        self.monotonic_origin + Duration::from_millis(epoch_ms.saturating_sub(self.base_epoch_ms))
    }
}

impl AuthClock for ManualServerAuthClock {
    fn epoch_ms(&self) -> u64 {
        self.epoch_ms.load(Ordering::SeqCst)
    }

    fn monotonic_now(&self) -> Instant {
        self.monotonic_at(self.epoch_ms())
    }
}

fn bound_loopback_context() -> ServerContext {
    let listener =
        std::net::TcpListener::bind("127.0.0.1:0").expect("bind loopback context fixture");
    ServerContext::from_bound_listener(&listener).expect("read loopback fixture address")
}

async fn projected_rehearsal_status(state: &AppState) -> String {
    let mut inspect = super::inspect_snapback(&state.snapback)
        .await
        .expect("inspect rehearsal capability facts");
    super::project_auth_runtime_facts(&mut inspect, state);
    inspect
        .capability_manifest
        .runtime_facts
        .expect("runtime facts")["authRehearsal"]["status"]
        .as_str()
        .expect("rehearsal status")
        .to_owned()
}

fn auth_runtime_fixture(mode: PolicyAuthMode) -> (AppState, String) {
    auth_runtime_fixture_with(mode, |_| {})
}

fn dev_identity_capability_fixture() -> (crate::dev_identity::DevIdentityCapabilityRegistry, String)
{
    let (registry, operator) = crate::dev_identity::DevIdentityCapabilityRegistry::generate(
        "dev-identity-http-fixture".to_owned(),
        Some(PathBuf::from("/operator/app.sqlite3.dev-identity")),
        &OsRandom,
    )
    .expect("generate developer identity capability");
    let mut capability = None;
    operator
        .emit_once_to_terminal(|value| {
            capability = Some(value.to_owned());
            Ok(())
        })
        .expect("capture developer identity capability");
    (
        registry,
        capability.expect("captured developer identity capability"),
    )
}

fn auth_runtime_fixture_with(
    mode: PolicyAuthMode,
    prepare: impl FnOnce(&mut LocalSnapback),
) -> (AppState, String) {
    auth_runtime_fixture_with_context(mode, bound_loopback_context(), prepare)
}

fn auth_runtime_fixture_with_context(
    mode: PolicyAuthMode,
    mut context: ServerContext,
    prepare: impl FnOnce(&mut LocalSnapback),
) -> (AppState, String) {
    let mut snapback = LocalSnapback::memory().expect("memory auth HTTP fixture");
    prepare(&mut snapback);
    let keyring = Arc::new(AuthKeyringStore::in_memory());
    snapback
        .remainder_auth_fixture()
        .activate_catalog(keyring.as_ref(), super::now_millis(), &OsRandom)
        .expect("activate auth catalog");
    let provider = Arc::new(
        AuthProvider::new(AuthProviderProfile::Test, keyring).expect("construct auth provider"),
    );
    let (registry, operator) =
        ImpersonationCapabilityRegistry::generate("auth-http-fixture".to_owned(), &OsRandom)
            .expect("generate impersonation capability");
    let mut capability = None;
    operator
        .emit_once_to_terminal(|value| {
            capability = Some(value.to_owned());
            Ok(())
        })
        .expect("capture test impersonation capability");
    context.profile = ServerProfile::Test;
    context.admin_token = Some("auth-http-admin".to_owned());
    let state = test_app_state_from_snapback(snapback, context)
        .with_policy_auth_mode(mode)
        .with_impersonation_capabilities(registry)
        .try_with_auth_provider(provider)
        .expect("auth provider app state");
    (state, capability.expect("captured capability"))
}

fn hosted_serving_authority(now_ms: u64) -> HostedServingAuthority {
    let policy = AuthenticationBucketPolicy {
        interval_ms: 1,
        burst: 10_000,
        maximum_denial_debt_attempts: 100,
    };
    hosted_serving_authority_with_throttle(
        now_ms,
        SharedAuthenticationThrottleConfig {
            retention_ms: 900_000,
            maximum_key_count: 100_000,
            global: policy,
            source: policy,
            subject: policy,
            source_subject: policy,
            family: policy,
        },
    )
}

fn hosted_edge_admission_fixture() -> (tempfile::TempDir, crate::admin::HostedEdgeAdmission) {
    use crate::auth::hosted_edge::{
        AdmissionRenewal, FirstContactTransport, HOSTED_EDGE_PROFILE, HostedAdmissionEnvelope,
        HostedEdgeConfig,
    };

    let key = Ed25519KeyPair::from_seed_unchecked(&[23_u8; 32])
        .expect("construct hosted-edge test signing key");
    let public_key = key.public_key().as_ref();
    let public_origin = "https://app.example.test";
    let first_contact_transport = FirstContactTransport::HstsPreloadedSuffix;
    let support_sha256 = "b".repeat(64);
    let deployment_id = "deployment-hosted-adapter-composition";
    let now_ms = super::now_millis();
    let policy = AuthenticationBucketPolicy {
        interval_ms: 1,
        burst: 10_000,
        maximum_denial_debt_attempts: 100,
    };
    let admission = HostedAdmission {
        version: 1,
        deployment_id: deployment_id.to_owned(),
        configuration_sha256: crate::auth::hosted_edge::configuration_digest(
            HOSTED_EDGE_PROFILE,
            public_origin,
            first_contact_transport,
            true,
            true,
            public_key,
        ),
        support_sha256: support_sha256.clone(),
        admission_epoch: 7,
        issued_at_ms: now_ms.saturating_sub(1_000),
        expires_at_ms: now_ms + 60_000,
        limiter_epoch: 11,
        authentication_throttle_config: SharedAuthenticationThrottleConfig {
            retention_ms: 900_000,
            maximum_key_count: 100_000,
            global: policy,
            source: policy,
            subject: policy,
            source_subject: policy,
            family: policy,
        },
        invalidation_epoch: 13,
        sender_replay_epoch_floor: 0,
        handler_protocol_version: 1,
        handler_incarnation: "handler-hosted-adapter-composition".to_owned(),
        operator_surface: HostedOperatorSurface::Disabled,
        browser_direct_bearer_seam: BrowserDirectBearerSeam::Excluded,
        hosted_auth: HostedAuthCapabilities {
            external_tls: ExternalTls::Enforced,
            effective_source: EffectiveSource::Trusted,
            authentication_throttle: AuthenticationThrottle::SharedEnforced,
            session_invalidation: SessionInvalidation::GloballyFenced,
            client_credential_posture: BrowserCredentialPosture::SenderConstrainedV2,
        },
    };
    let mut envelope = HostedAdmissionEnvelope {
        profile: HOSTED_EDGE_PROFILE.to_owned(),
        public_origin: public_origin.to_owned(),
        first_contact_transport,
        renewal: AdmissionRenewal::PresignedWindow,
        admission,
        hosted_target_admission: None,
        signature: String::new(),
    };
    let signing_input = crate::auth::hosted_edge::admission_signing_input(
        &envelope.profile,
        &envelope.public_origin,
        envelope.first_contact_transport,
        envelope.renewal,
        &envelope.admission,
    )
    .expect("canonicalize hosted-edge admission fixture");
    envelope.signature = URL_SAFE_NO_PAD.encode(key.sign(&signing_input).as_ref());

    let config = HostedEdgeConfig {
        format_version: 1,
        deployment_id: deployment_id.to_owned(),
        public_origin: public_origin.to_owned(),
        first_contact_transport,
        admission_public_key: URL_SAFE_NO_PAD.encode(public_key),
        support_sha256,
    };
    let fixture = tempfile::tempdir().expect("hosted-edge adapter fixture directory");
    let config_path = fixture.path().join("hosted-edge.json");
    let admission_path = fixture.path().join("hosted-admission.json");
    fs::write(
        &config_path,
        serde_json::to_vec(&config).expect("serialize hosted-edge config fixture"),
    )
    .expect("write hosted-edge config fixture");
    fs::write(
        &admission_path,
        serde_json::to_vec(&envelope).expect("serialize hosted admission fixture"),
    )
    .expect("write hosted admission fixture");
    let composed = crate::admin::compose_hosted_edge_admission(
        crate::auth::deployment::AuthDeploymentTarget::Hosted,
        Some(&config_path),
        Some(&admission_path),
        std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
    )
    .expect("compose production hosted-edge admission")
    .expect("hosted target produces an admission");
    (fixture, composed)
}

fn hosted_serving_authority_with_throttle(
    now_ms: u64,
    authentication_throttle_config: SharedAuthenticationThrottleConfig,
) -> HostedServingAuthority {
    HostedServingAuthority::from_authenticated_target(
        "https://app.example.test",
        HostedAdmission {
            version: 1,
            deployment_id: "deployment-hosted-test".to_owned(),
            configuration_sha256: "a".repeat(64),
            support_sha256: "b".repeat(64),
            admission_epoch: 7,
            issued_at_ms: now_ms.saturating_sub(1_000),
            expires_at_ms: now_ms + 60_000,
            limiter_epoch: 11,
            authentication_throttle_config,
            invalidation_epoch: 13,
            sender_replay_epoch_floor: 0,
            handler_protocol_version: 1,
            handler_incarnation: "handler-hosted-test".to_owned(),
            operator_surface: HostedOperatorSurface::Disabled,
            browser_direct_bearer_seam: BrowserDirectBearerSeam::Excluded,
            hosted_auth: HostedAuthCapabilities {
                external_tls: ExternalTls::Enforced,
                effective_source: EffectiveSource::Trusted,
                authentication_throttle: AuthenticationThrottle::SharedEnforced,
                session_invalidation: SessionInvalidation::GloballyFenced,
                client_credential_posture: BrowserCredentialPosture::SenderConstrainedV2,
            },
        },
        now_ms,
        [17; 32],
    )
    .expect("construct authenticated hosted serving authority")
}

struct HostedSenderProofKey {
    key: EcdsaKeyPair,
    x: String,
    y: String,
}

impl HostedSenderProofKey {
    fn generate() -> Self {
        let random = SystemRandom::new();
        let pkcs8 = EcdsaKeyPair::generate_pkcs8(&ECDSA_P256_SHA256_FIXED_SIGNING, &random)
            .expect("generate hosted sender test key");
        let key =
            EcdsaKeyPair::from_pkcs8(&ECDSA_P256_SHA256_FIXED_SIGNING, pkcs8.as_ref(), &random)
                .expect("parse hosted sender test key");
        let public = key.public_key().as_ref();
        let x = URL_SAFE_NO_PAD.encode(&public[1..33]);
        let y = URL_SAFE_NO_PAD.encode(&public[33..65]);
        Self { key, x, y }
    }

    fn public_jwk(&self) -> Value {
        json!({
            "crv": "P-256",
            "kty": "EC",
            "x": self.x,
            "y": self.y,
        })
    }

    fn protected_header(&self) -> String {
        URL_SAFE_NO_PAD.encode(
            serde_json::to_vec(&json!({
                "alg": "ES256",
                "jwk": self.public_jwk(),
                "typ": "dpop+jwt",
            }))
            .expect("encode hosted sender header"),
        )
    }

    fn sign_payload(&self, payload: Value) -> String {
        let header = self.protected_header();
        let payload = URL_SAFE_NO_PAD
            .encode(serde_json::to_vec(&payload).expect("encode hosted sender payload"));
        let signing_input = format!("{header}.{payload}");
        let signature = self
            .key
            .sign(&SystemRandom::new(), signing_input.as_bytes())
            .expect("sign hosted sender proof");
        format!(
            "{signing_input}.{}",
            URL_SAFE_NO_PAD.encode(signature.as_ref())
        )
    }

    fn issuance_proof(
        &self,
        challenge_id: &str,
        issued_at_seconds: u64,
        proof_id: [u8; 16],
    ) -> String {
        self.sign_payload(json!({
            "challengeId": challenge_id,
            "htm": "POST",
            "htu": "https://app.example.test/auth/exchange",
            "iat": issued_at_seconds,
            "jti": URL_SAFE_NO_PAD.encode(proof_id),
            "protocol": "snapback.sender-issuance.v2",
            "version": 2,
        }))
    }

    fn resource_proof(
        &self,
        method: &str,
        uri: &str,
        bearer: &str,
        nonce: &str,
        issued_at_seconds: u64,
        proof_id: [u8; 16],
    ) -> String {
        self.sign_payload(json!({
            "ath": URL_SAFE_NO_PAD.encode(Sha256::digest(bearer.as_bytes())),
            "htm": method,
            "htu": uri,
            "iat": issued_at_seconds,
            "jti": URL_SAFE_NO_PAD.encode(proof_id),
            "nonce": nonce,
            "version": 2,
        }))
    }
}

struct PanicOnPollBody;

impl http_body::Body for PanicOnPollBody {
    type Data = Bytes;
    type Error = std::convert::Infallible;

    fn poll_frame(
        self: std::pin::Pin<&mut Self>,
        _context: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Result<http_body::Frame<Self::Data>, Self::Error>>> {
        panic!("sender admission polled the request body")
    }

    fn is_end_stream(&self) -> bool {
        false
    }
}

fn manual_clock_sessions_fixture(start_ms: u64) -> (AppState, Arc<ManualServerAuthClock>) {
    let clock = Arc::new(ManualServerAuthClock::new(start_ms));
    let mut snapback = LocalSnapback::memory().expect("manual-clock HTTP fixture");
    let keyring = Arc::new(AuthKeyringStore::in_memory());
    snapback
        .remainder_auth_fixture()
        .activate_catalog(keyring.as_ref(), start_ms, &OsRandom)
        .expect("activate manual-clock auth catalog");
    let provider = Arc::new(
        AuthProvider::new_with_dependencies(
            AuthProviderProfile::Test,
            keyring,
            Arc::new(OsRandom),
            clock.clone(),
        )
        .expect("construct manual-clock auth provider"),
    );
    let mut context = bound_loopback_context();
    context.profile = ServerProfile::Test;
    let state = activate_test_sessions(
        test_app_state_from_snapback(snapback, context)
            .with_policy_auth_mode(PolicyAuthMode::Sessions)
            .try_with_auth_provider(provider)
            .expect("auth provider app state"),
    );
    (state, clock)
}

fn auth_invalidation_reset_fixture() -> AppState {
    auth_invalidation_reset_fixture_with_context(bound_loopback_context())
}

fn auth_invalidation_reset_fixture_with_context(context: ServerContext) -> AppState {
    let mut snapback = LocalSnapback::memory().expect("memory reset fixture");
    snapback
        .apply_schema(SchemaManifest {
            tables: vec![TableManifest {
                name: "resetPermissions".to_owned(),
                fields: vec![FieldManifest {
                    name: "subject".to_owned(),
                    field_type: FieldType::String,
                    optional: false,
                }],
                indexes: Vec::new(),
                syncable: true,
                permission_backing: true,
                permission_fields: Some(vec!["subject".to_owned()]),
                search_indexes: Vec::new(),
                vector_indexes: Vec::new(),
                search_live_limits: None,
                membership: None,
                authority_profile: None,
                asset_sharing: None,
                visibility: None,
                history: None,
            }],
            ..SchemaManifest::default()
        })
        .expect("apply reset authorization fixture schema");
    let keyring = Arc::new(AuthKeyringStore::in_memory());
    snapback
        .remainder_auth_fixture()
        .activate_catalog(keyring.as_ref(), super::now_millis(), &OsRandom)
        .expect("activate reset auth catalog");
    let provider = Arc::new(
        AuthProvider::new(AuthProviderProfile::Test, keyring)
            .expect("construct reset auth provider"),
    );
    let invalidation = snapback
        .install_authenticated_auth_invalidation(&provider, None)
        .expect("install predecessor invalidation projections");

    test_app_state_from_snapback(snapback, context)
        .try_with_auth_provider(provider)
        .expect("auth provider app state")
        .with_auth_invalidation(invalidation)
        .with_auth_runtime_facts(
            settled_sessions_state(),
            AuthProgramReadiness::new(true, true, true, true, true, true, true),
        )
        .expect("install reset sessions posture")
}

fn dormant_dev_reset_fixture_with_context(mut context: ServerContext) -> AppState {
    let mut snapback = LocalSnapback::memory().expect("memory dormant reset fixture");
    let runtime =
        crate::auth::runtime::AuthRuntime::inspect(&mut snapback, None, AuthProviderProfile::Dev)
            .expect("inspect dormant auth runtime");
    assert!(!runtime.catalog_ready(), "fixture must remain dormant");
    let coordinator = runtime
        .build_coordinator(&mut snapback)
        .expect("build dormant stream coordinator");
    context.profile = ServerProfile::Dev;
    test_app_state_from_snapback(snapback, context)
        .with_auth_runtime(&runtime, coordinator)
        .expect("install dormant auth runtime")
}

fn auth_projection_http_fixture(
    connection_id: &str,
    subscription_count: u64,
    retained_row_bytes: usize,
) -> AppState {
    let mut snapback = LocalSnapback::memory().expect("memory projection HTTP fixture");
    snapback
        .apply_schema(SchemaManifest {
            schema_hash: Some("projection-http-schema".to_owned()),
            tables: vec![crate::manifest::TableManifest {
                name: "items".to_owned(),
                fields: vec![FieldManifest {
                    name: "value".to_owned(),
                    field_type: FieldType::String,
                    optional: false,
                }],
                indexes: Vec::new(),
                syncable: true,
                permission_backing: false,
                permission_fields: None,
                search_indexes: Vec::new(),
                vector_indexes: Vec::new(),
                search_live_limits: None,
                membership: None,
                authority_profile: None,
                asset_sharing: None,
                visibility: Some(crate::manifest::TableVisibilityV1::PublicRead),
                history: None,
            }],
            ..SchemaManifest::default()
        })
        .expect("apply projection HTTP schema");
    let list = FunctionDefinition::new(
        "listItems",
        FunctionKind::LiveQuery,
        FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
            table_visibility: None,
            table: "items".to_owned(),
            filters: Vec::new(),
            order: Vec::new(),
            limit: None,
            membership_filters: Vec::new(),
            indexed_by: None,
        })),
    );
    let mut insert_values = BTreeMap::new();
    insert_values.insert("value".to_owned(), ValueExpr::Arg("value".to_owned()));
    let insert = FunctionDefinition::new(
        "insertItem",
        FunctionKind::Mutation,
        FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
            owner_write_checks: Vec::new(),
            steps: vec![MutationStep::Insert {
                table: "items".to_owned(),
                values: insert_values,
                bind_id_as: None,
            }],
            return_value: Some(ReturnValue::ChangedCount),
        })),
    );
    let delete = FunctionDefinition::new(
        "deleteItem",
        FunctionKind::Mutation,
        FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
            owner_write_checks: Vec::new(),
            steps: vec![MutationStep::Delete {
                table: "items".to_owned(),
                id: ValueExpr::Arg("id".to_owned()),
            }],
            return_value: Some(ReturnValue::ChangedCount),
        })),
    );
    snapback.load_functions(FunctionManifest {
        bundle_hash: Some("projection-http-functions".to_owned()),
        functions: vec![list, insert, delete],
        ..FunctionManifest::default()
    });
    if retained_row_bytes > 0 {
        snapback
            .invoke_mutation(
                "insertItem",
                HandlerInput {
                    args: json!({ "value": "x".repeat(retained_row_bytes) }),
                    ..HandlerInput::default()
                },
            )
            .expect("insert retained projection row");
    }
    snapback
        .invoke_mutation(
            "insertItem",
            HandlerInput {
                args: json!({ "value": "remove-me" }),
                ..HandlerInput::default()
            },
        )
        .expect("insert removable projection row");
    let removable_id = snapback
        .invoke_query("listItems", HandlerInput::default())
        .expect("query removable projection row")
        .rows
        .into_iter()
        .find(|row| row["value"] == "remove-me")
        .and_then(|row| row["_id"].as_str().map(str::to_owned))
        .expect("removable row id");

    let keyring = Arc::new(AuthKeyringStore::in_memory());
    snapback
        .remainder_auth_fixture()
        .activate_catalog(keyring.as_ref(), super::now_millis(), &OsRandom)
        .expect("activate projection HTTP auth catalog");
    let provider = Arc::new(
        AuthProvider::new(AuthProviderProfile::Test, keyring)
            .expect("construct projection HTTP provider"),
    );
    let invalidation = snapback
        .install_authenticated_auth_invalidation(&provider, None)
        .expect("install projection HTTP invalidation");
    let projection_connection = invalidation
        .prepare_connection(crate::ephemeral::ConnectionEffectFence::anonymous(
            "projection-http-incarnation",
            "projection-http-grant",
        ))
        .expect("prepare projection connection");
    for query_instance_id in 0..subscription_count {
        snapback_engine::test_support::subscribe_live_host_plan_with_invalidation(
            &mut snapback,
            "listItems",
            LiveSubscribeInput {
                connection_id: connection_id.to_owned(),
                input: HandlerInput::default(),
                authorization_namespace: Some(QueryNamespace {
                    client_store_id: "projection_http_store".to_owned(),
                    query_key: "listItems:{}".to_owned(),
                    query_instance_id: 500 + query_instance_id,
                }),
                supersedes: None,
                resume_from_token: None,
            },
            snapback_engine::test_support::live_invalidation_admission(
                projection_connection.clone(),
                true,
            ),
        )
        .expect("install projection HTTP subscription");
    }
    loop {
        let initial = snapback.drain_outbox_for_send(connection_id);
        if initial.is_empty() {
            break;
        }
        for admitted in initial {
            assert!(admitted.commit_handoff());
        }
    }
    snapback
        .invoke_mutation(
            "deleteItem",
            HandlerInput {
                args: json!({ "id": removable_id }),
                ..HandlerInput::default()
            },
        )
        .expect("raise projection HTTP obligations");

    test_app_state_from_snapback(snapback, bound_loopback_context())
        .with_policy_auth_mode(PolicyAuthMode::Sessions)
        .try_with_auth_provider(provider)
        .expect("auth provider app state")
        .with_auth_invalidation(invalidation)
        .with_auth_runtime_facts(
            settled_sessions_state(),
            AuthProgramReadiness::new(true, true, true, true, true, true, true),
        )
        .expect("install projection HTTP sessions posture")
}

fn protected_room_server_fixture() -> (AppState, tempfile::TempDir) {
    let directory = tempfile::tempdir().expect("protected-room fixture directory");
    let database_path = directory.path().join("protected-room.sqlite3");
    let mut snapback = LocalSnapback::open(&database_path).expect("file-backed snapback");
    let projection = RoomPermissionProjection {
        table: "roomMembers".to_owned(),
        subject_field: "userId".to_owned(),
        scope_fields: BTreeMap::from([("roomId".to_owned(), "roomId".to_owned())]),
        role_field: None,
        allowed_roles: None,
    };
    let collection = EphemeralCollection::local_cursor("protectedPresence", "roomId")
        .require_room_permission("room")
        .permission_backed_by(projection);
    let schema = SchemaManifest {
        schema_version: SNAPBACK_SESSIONS_SCHEMA_VERSION.to_owned(),
        app_id: "auth-http-fixture".to_owned(),
        auth: Some(AuthManifest {
            mode: AuthMode::Sessions,
            agents: None,
            password_identifier_mode: None,
            password_minimum_length: None,
        }),
        required_capabilities: vec![TargetCapabilityId::AuthSessionsV1.to_string()],
        schema_hash: Some(format!("{SCHEMA_V1_PREFIX}{}", "1".repeat(64))),
        inputs_hash: Some(format!("{INPUTS_V1_PREFIX}{}", "3".repeat(64))),
        tables: vec![TableManifest {
            name: "roomMembers".to_owned(),
            fields: vec![
                FieldManifest {
                    name: "roomId".to_owned(),
                    field_type: FieldType::String,
                    optional: false,
                },
                FieldManifest {
                    name: "userId".to_owned(),
                    field_type: FieldType::String,
                    optional: false,
                },
            ],
            indexes: Vec::new(),
            syncable: true,
            permission_backing: true,
            permission_fields: Some(vec!["roomId".to_owned(), "userId".to_owned()]),
            search_indexes: Vec::new(),
            vector_indexes: Vec::new(),
            search_live_limits: None,
            membership: None,
            authority_profile: None,
            asset_sharing: None,
            visibility: None,
            history: None,
        }],
        ephemeral_collections: vec![collection],
        ..SchemaManifest::default()
    };
    let readiness = AuthProgramReadiness::new(true, true, true, true, true, true, true);
    let keyring = Arc::new(AuthKeyringStore::in_memory());
    keyring
        .load_or_mint_initial(super::now_millis(), &OsRandom)
        .expect("provision protected-room keyring before sessions consume");
    let settled = snapback
        .remainder_auth_fixture()
        .stage_auth_mode(sessions_deployment(), schema.clone(), None)
        .expect("stage protected-room sessions schema");
    assert_eq!(settled.mode_state, AuthModeStatus::PendingRestart);
    let settled = snapback
        .remainder_auth_fixture()
        .consume_sessions_auth_mode(&readiness)
        .expect("consume protected-room sessions schema");
    snapback
        .synchronize_auth_mode_admission(&settled)
        .expect("synchronize protected-room admission");
    let mut kick = FunctionDefinition::new(
        "kickRoomMember",
        FunctionKind::Mutation,
        FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
            owner_write_checks: Vec::new(),
            steps: vec![MutationStep::Delete {
                table: "roomMembers".to_owned(),
                id: ValueExpr::Arg("id".to_owned()),
            }],
            return_value: Some(ReturnValue::ChangedCount),
        })),
    );
    kick.write_set_summary.primary_table = Some("roomMembers".to_owned());
    kick.write_set_summary.tables = vec!["roomMembers".to_owned()];
    let mut kick_two = FunctionDefinition::new(
        "kickTwoRoomMembers",
        FunctionKind::Action,
        FunctionRuntime::HostPlan(HandlerPlan::Action(ActionPlan {
            steps: vec![
                ActionStep::RunMutation {
                    name: "kickRoomMember".to_owned(),
                    args: BTreeMap::from([("id".to_owned(), ValueExpr::Arg("firstId".to_owned()))]),
                    bind_result_as: Some("firstKick".to_owned()),
                },
                ActionStep::RunMutation {
                    name: "kickRoomMember".to_owned(),
                    args: BTreeMap::from([(
                        "id".to_owned(),
                        ValueExpr::Arg("secondId".to_owned()),
                    )]),
                    bind_result_as: None,
                },
            ],
            return_value: Some(ActionReturnValue::Binding("firstKick".to_owned())),
        })),
    );
    kick_two.auth_requirement = Some(AuthRequirement::Authenticated);
    kick_two.write_set_summary.primary_table = Some("roomMembers".to_owned());
    kick_two.write_set_summary.tables = vec!["roomMembers".to_owned()];
    const DETACHED_SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async heldRoomAction(ctx, args) {
    return await ctx.runMutation(args.target, { id: args.id });
  },
  async ibexKickRoomMember(ctx, args) {
    await ctx.db.delete('roomMembers', args.id);
    return 1;
  }
};
"#;
    let mut held_action = FunctionDefinition::new(
        "heldRoomAction",
        FunctionKind::Action,
        FunctionRuntime::IbexModule(crate::manifest::IbexModule {
            source: DETACHED_SOURCE.to_owned(),
            export: "heldRoomAction".to_owned(),
        }),
    );
    held_action.required_capabilities =
        vec!["cron".to_owned(), "cron_action_run_mutation".to_owned()];
    let mut ibex_kick = FunctionDefinition::new(
        "ibexKickRoomMember",
        FunctionKind::Mutation,
        FunctionRuntime::IbexModule(crate::manifest::IbexModule {
            source: DETACHED_SOURCE.to_owned(),
            export: "ibexKickRoomMember".to_owned(),
        }),
    );
    ibex_kick.required_capabilities = vec![
        "ibex_ctx_db_host_bridge".to_owned(),
        "mutation_read_set_validation".to_owned(),
    ];
    ibex_kick.write_set_summary.primary_table = Some("roomMembers".to_owned());
    ibex_kick.write_set_summary.tables = vec!["roomMembers".to_owned()];
    ibex_kick.write_set_summary.mode = Some("handlerDeclared".to_owned());
    let diagnostics = snapback.publish_preflighted_functions(
        FunctionManifest {
            schema_version: SNAPBACK_SESSIONS_SCHEMA_VERSION.to_owned(),
            app_id: "auth-http-fixture".to_owned(),
            bundle_hash: Some(format!("{FUNCTION_V1_PREFIX}{}", "2".repeat(64))),
            inputs_hash: Some(format!("{INPUTS_V1_PREFIX}{}", "3".repeat(64))),
            functions: vec![kick, kick_two, held_action, ibex_kick],
            ..FunctionManifest::default()
        },
        42,
        crate::local::DiagnosticBoundary::Attached,
    );
    assert!(
        diagnostics.iter().all(|diagnostic| !matches!(
            diagnostic.severity,
            crate::diagnostic::DiagnosticSeverity::Error
                | crate::diagnostic::DiagnosticSeverity::Fatal
        )),
        "protected-room function manifest loads: {diagnostics:?}"
    );

    snapback
        .remainder_auth_fixture()
        .activate_catalog(keyring.as_ref(), super::now_millis(), &OsRandom)
        .expect("activate protected-room auth catalog");
    let provider = Arc::new(
        AuthProvider::new(AuthProviderProfile::Test, keyring)
            .expect("construct protected-room auth provider"),
    );
    let invalidation = snapback
        .install_authenticated_auth_invalidation(&provider, None)
        .expect("install protected-room invalidation");

    let mut context = bound_loopback_context();
    context.profile = ServerProfile::Test;
    let state = test_app_state_from_snapback(snapback, context)
        .try_with_auth_provider(provider)
        .expect("auth provider app state")
        .with_auth_invalidation(invalidation)
        .with_auth_runtime_facts(settled, readiness)
        .expect("install protected-room sessions posture");
    assert!(
        state.read.available(),
        "fixture must exercise the WAL reader lane"
    );
    (state, directory)
}

fn auth_http_fixture_with_provider(
    mode: PolicyAuthMode,
) -> (SnapbackApp, String, Arc<AuthProvider>) {
    let (state, capability) = auth_runtime_fixture(mode);
    let provider = state
        .auth_provider
        .clone()
        .expect("installed auth provider");
    (app(state), capability, provider)
}

fn auth_http_fixture(mode: PolicyAuthMode) -> (SnapbackApp, String) {
    let (state, capability) = auth_runtime_fixture(mode);
    (app(state), capability)
}

fn sessions_deployment() -> DeploymentIdentity {
    DeploymentIdentity {
        schema_version: "snapback.v1".to_owned(),
        auth_mode: AuthMode::Sessions,
        app_id: "auth-http-fixture".to_owned(),
        schema_hash: format!("{SCHEMA_V1_PREFIX}{}", "1".repeat(64)),
        bundle_hash: format!("{FUNCTION_V1_PREFIX}{}", "2".repeat(64)),
        inputs_hash: format!("{INPUTS_V1_PREFIX}{}", "3".repeat(64)),
    }
}

fn activation_functions(bundle_marker: char, hide_rows: bool) -> FunctionManifest {
    let query = |name, kind| {
        FunctionDefinition::new(
            name,
            kind,
            FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
                table_visibility: None,
                table: "items".to_owned(),
                filters: hide_rows
                    .then(|| FilterExpr {
                        field: "value".to_owned(),
                        op: FilterOp::Eq,
                        value: ValueExpr::Literal(json!("never-visible")),
                    })
                    .into_iter()
                    .collect(),
                order: Vec::new(),
                limit: None,
                membership_filters: Vec::new(),
                indexed_by: None,
            })),
        )
    };
    let mut insert_values = BTreeMap::new();
    insert_values.insert("value".to_owned(), ValueExpr::Arg("value".to_owned()));
    let mut queued_write = FunctionDefinition::new(
        "queuedWrite",
        FunctionKind::Mutation,
        FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
            owner_write_checks: Vec::new(),
            steps: vec![MutationStep::Insert {
                table: "items".to_owned(),
                values: insert_values,
                bind_id_as: None,
            }],
            return_value: Some(ReturnValue::ChangedCount),
        })),
    );
    queued_write.write_set_summary.tables = vec!["items".to_owned()];
    FunctionManifest {
        schema_version: SNAPBACK_SESSIONS_SCHEMA_VERSION.to_owned(),
        app_id: "auth-activation-fixture".to_owned(),
        bundle_hash: Some(format!(
            "{FUNCTION_V1_PREFIX}{}",
            bundle_marker.to_string().repeat(64)
        )),
        inputs_hash: Some(format!("{INPUTS_V1_PREFIX}{}", "3".repeat(64))),
        functions: vec![
            query("listItems", FunctionKind::Query),
            query("liveItems", FunctionKind::LiveQuery),
            queued_write,
        ],
        ..FunctionManifest::default()
    }
}

fn sessions_activation_server_fixture_with(
    predecessor_functions: FunctionManifest,
    clock: Option<Arc<ManualServerAuthClock>>,
) -> AppState {
    sessions_activation_server_fixture_with_agents(predecessor_functions, clock, None)
}

fn sessions_activation_server_fixture_with_agents(
    predecessor_functions: FunctionManifest,
    clock: Option<Arc<ManualServerAuthClock>>,
    agents: Option<AgentsManifest>,
) -> AppState {
    sessions_activation_server_fixture_with_api(predecessor_functions, clock, agents, None)
}

fn sessions_activation_server_fixture_with_api(
    predecessor_functions: FunctionManifest,
    clock: Option<Arc<ManualServerAuthClock>>,
    agents: Option<AgentsManifest>,
    api: Option<ApiManifest>,
) -> AppState {
    sessions_activation_server_fixture_with_api_and_password_mode(
        predecessor_functions,
        clock,
        agents,
        api,
        PasswordIdentifierMode::UsernameV1,
        None,
    )
}

fn sessions_activation_server_fixture_with_api_and_password_mode(
    predecessor_functions: FunctionManifest,
    clock: Option<Arc<ManualServerAuthClock>>,
    agents: Option<AgentsManifest>,
    api: Option<ApiManifest>,
    password_identifier_mode: PasswordIdentifierMode,
    auth_program: Option<AuthProgramManifestV1>,
) -> AppState {
    let snapback = LocalSnapback::memory().expect("memory activation server fixture");
    sessions_activation_server_fixture_with_api_and_password_mode_on_snapback(
        snapback,
        predecessor_functions,
        clock,
        agents,
        api,
        password_identifier_mode,
        auth_program,
    )
}

fn sessions_activation_server_fixture_with_api_and_password_mode_on_snapback(
    mut snapback: LocalSnapback,
    predecessor_functions: FunctionManifest,
    clock: Option<Arc<ManualServerAuthClock>>,
    agents: Option<AgentsManifest>,
    api: Option<ApiManifest>,
    password_identifier_mode: PasswordIdentifierMode,
    auth_program: Option<AuthProgramManifestV1>,
) -> AppState {
    let activation_now_ms = clock
        .as_ref()
        .map_or_else(super::now_millis, |clock| clock.epoch_ms());
    let envelope_functions = predecessor_functions
        .functions
        .iter()
        .filter(|function| {
            api.as_ref().is_some_and(|api| {
                api.enabled
                    && (api.disclosure != ApiDisclosure::ExposedOnly
                        || function
                            .api_exposure
                            .as_ref()
                            .is_some_and(|exposure| exposure.expose))
            })
        })
        .collect::<Vec<_>>();
    let api_envelope = api.as_ref().filter(|api| api.enabled).map(|_| {
        let args_schema = json!({ "type": "object", "additionalProperties": true });
        let operations = envelope_functions
            .iter()
            .map(|function| {
                (
                    function.id.clone(),
                    crate::api_envelope::ApiEnvelopeOperationV1 {
                        name: function.name.clone(),
                        args_schema: args_schema.clone(),
                    },
                )
            })
            .collect::<BTreeMap<_, _>>();
        let app_bindings = "export {};".to_owned();
        let mut member_digests = operations
            .iter()
            .map(|(id, operation)| {
                (
                    crate::api_envelope::operation_member_key(id),
                    crate::api_envelope::member_digest(
                        &crate::api_envelope::canonicalize(&operation.args_schema)
                            .expect("fixture args schema canonicalizes"),
                    ),
                )
            })
            .collect::<BTreeMap<_, _>>();
        member_digests.insert(
            crate::api_envelope::DECLARATION_MEMBER_KEY.to_owned(),
            crate::api_envelope::member_digest(&app_bindings),
        );
        crate::api_envelope::ApiEnvelopeMembersV1 {
            operations,
            declarations: crate::api_envelope::ApiEnvelopeDeclarationsV1 { app_bindings },
            member_digests,
        }
    });
    let schema = SchemaManifest {
        schema_version: SNAPBACK_SESSIONS_SCHEMA_VERSION.to_owned(),
        app_id: "auth-activation-fixture".to_owned(),
        auth: Some(AuthManifest {
            mode: AuthMode::Sessions,
            agents,
            password_identifier_mode: None,
            password_minimum_length: None,
        }),
        auth_program,
        api,
        required_capabilities: vec![TargetCapabilityId::AuthSessionsV1.to_string()],
        schema_hash: Some(format!("{SCHEMA_V1_PREFIX}{}", "1".repeat(64))),
        inputs_hash: Some(format!("{INPUTS_V1_PREFIX}{}", "3".repeat(64))),
        tables: vec![TableManifest {
            name: "items".to_owned(),
            fields: vec![FieldManifest {
                name: "value".to_owned(),
                field_type: FieldType::String,
                optional: false,
            }],
            indexes: Vec::new(),
            syncable: true,
            permission_backing: false,
            permission_fields: None,
            search_indexes: Vec::new(),
            vector_indexes: Vec::new(),
            search_live_limits: None,
            membership: None,
            authority_profile: None,
            asset_sharing: None,
            visibility: Some(crate::manifest::TableVisibilityV1::PublicRead),
            history: None,
        }],
        ..SchemaManifest::default()
    };
    let prepared = snapback
        .prepare_auth_provision_with_routes(
            EnsureAppMode::Sessions,
            Some(schema),
            Some(predecessor_functions.clone()),
            Some(SeedData {
                tables: BTreeMap::from([(
                    "items".to_owned(),
                    vec![Map::from_iter([(
                        "value".to_owned(),
                        json!("predecessor-visible"),
                    )])],
                )]),
            }),
            None,
            api_envelope,
        )
        .expect("preflight complete initial sessions pair");
    let (_, pending) = snapback
        .commit_auth_provision(prepared, "test")
        .expect("stage initial sessions pair");
    assert_eq!(pending.mode_state, AuthModeStatus::PendingRestart);

    let readiness = AuthProgramReadiness::new(true, true, true, true, true, true, true);
    let keyring = Arc::new(AuthKeyringStore::in_memory());
    keyring
        .load_or_mint_initial(activation_now_ms, &OsRandom)
        .expect("provision activation keyring before sessions consume");
    if password_identifier_mode == PasswordIdentifierMode::EmailV1 {
        snapback
            .remainder_auth_fixture()
            .activate_current_auth_catalog_with_password_identifier_mode(password_identifier_mode)
            .expect("activate declared password identifier mode");
    }
    let settled = snapback
        .remainder_auth_fixture()
        .consume_sessions_auth_mode(&readiness)
        .expect("consume initial sessions pair");
    snapback
        .synchronize_auth_mode_admission(&settled)
        .expect("synchronize settled sessions admission");
    let diagnostics = snapback.publish_preflighted_functions(
        predecessor_functions,
        43,
        crate::local::DiagnosticBoundary::Attached,
    );
    assert!(
        diagnostics.iter().all(|diagnostic| !matches!(
            diagnostic.severity,
            crate::diagnostic::DiagnosticSeverity::Error
                | crate::diagnostic::DiagnosticSeverity::Fatal
        )),
        "activation functions must publish: {diagnostics:?}"
    );
    // Scope bases are left to the caller to reconcile (matching
    // finite_authority_matrix_fixture): tests that seed `_auth_scope_bases`
    // directly must start from an empty table.
    snapback
        .remainder_auth_fixture()
        .activate_catalog(keyring.as_ref(), activation_now_ms, &OsRandom)
        .expect("activate auth catalog");
    let provider = Arc::new(
        match clock {
            Some(clock) => AuthProvider::new_with_dependencies(
                AuthProviderProfile::Test,
                keyring,
                Arc::new(OsRandom),
                clock,
            ),
            None => AuthProvider::new(AuthProviderProfile::Test, keyring),
        }
        .expect("construct activation auth provider"),
    );
    let invalidation = snapback
        .install_authenticated_auth_invalidation(&provider, None)
        .expect("install activation invalidation state");

    // This fixture exercises the in-process Router and never opens a socket.
    // Record the listener-owned posture directly so it remains runnable in
    // hermetic test sandboxes that deny bind(2).
    let mut context = ServerContext::new("127.0.0.1", 43_621, true);
    context.record_bound_address("127.0.0.1:43621".parse().unwrap());
    context.profile = ServerProfile::Test;
    context.admin_token = Some("auth-http-admin".to_owned());
    test_app_state_from_snapback(snapback, context)
        .try_with_auth_provider(provider)
        .expect("auth provider app state")
        .with_auth_invalidation(invalidation)
        .with_auth_runtime_facts(settled, readiness)
        .expect("install activation sessions posture")
}

fn sessions_activation_server_fixture() -> AppState {
    sessions_activation_server_fixture_with(activation_functions('2', false), None)
}

async fn sessions_activation_server_fixture_async() -> AppState {
    tokio::task::spawn_blocking(|| {
        let _sanction = crate::exec_guard::BlockingSanction::acquire();
        sessions_activation_server_fixture()
    })
    .await
    .expect("construct activation fixture off the async workers")
}

async fn password_sessions_activation_server_fixture_async() -> AppState {
    tokio::task::spawn_blocking(|| {
        let _sanction = crate::exec_guard::BlockingSanction::acquire();
        sessions_activation_server_fixture_with_api_and_password_mode(
            activation_functions('2', false),
            None,
            None,
            None,
            PasswordIdentifierMode::EmailV1,
            None,
        )
    })
    .await
    .expect("construct email-password activation fixture off the async workers")
}

fn guest_auth_program(enabled: bool, cleanup: GuestCleanupContractV1) -> AuthProgramManifestV1 {
    guest_auth_program_with_claiming(enabled, cleanup, vec!["password".to_owned()], true)
}

fn guest_auth_program_with_claiming(
    enabled: bool,
    cleanup: GuestCleanupContractV1,
    claiming: Vec<String>,
    include_budgets: bool,
) -> AuthProgramManifestV1 {
    let profiles = || AuthBudgetProfilesManifestV1 {
        profiles: BTreeMap::from([
            (
                "dev".to_owned(),
                AuthBudgetTermsManifestV1 {
                    limit: 100_000,
                    window_ms: 1_000,
                },
            ),
            (
                "test".to_owned(),
                AuthBudgetTermsManifestV1 {
                    limit: 100_000,
                    window_ms: 1_000,
                },
            ),
            (
                "demo".to_owned(),
                AuthBudgetTermsManifestV1 {
                    limit: 10_000,
                    window_ms: 10_000,
                },
            ),
            (
                "prod".to_owned(),
                AuthBudgetTermsManifestV1 {
                    limit: 10,
                    window_ms: 1_000,
                },
            ),
        ]),
    };
    let mut program = AuthProgramManifestV1 {
        version: 1,
        mechanisms: BTreeMap::from([
            (
                "guest".to_owned(),
                AuthMechanismManifestV1 {
                    kind: "guest".to_owned(),
                },
            ),
            (
                "password".to_owned(),
                AuthMechanismManifestV1 {
                    kind: "password".to_owned(),
                },
            ),
        ]),
        guest_policy: GuestPolicyManifestV1 {
            enabled,
            claiming,
            reaping: Some(GuestReapingPolicyV1 {
                after_ms: 60_000,
                cleanup,
            }),
        },
        abuse_budgets: (enabled && include_budgets).then(|| AuthAbuseBudgetPolicyManifestV1 {
            version: 1,
            preset: "guest-entry-v1".to_owned(),
            budgets: [
                "auth.account.create",
                "auth.enumeration",
                "auth.guest.create",
                "auth.hash-cpu",
                "auth.session-mint",
            ]
            .into_iter()
            .map(|name| (name.to_owned(), profiles()))
            .collect(),
            effect_bindings: BTreeMap::from([
                (
                    "auth.guest.create".to_owned(),
                    vec![
                        "auth.guest.create".to_owned(),
                        "auth.session-mint".to_owned(),
                    ],
                ),
                (
                    "auth.guest.claim.password".to_owned(),
                    vec![
                        "auth.enumeration".to_owned(),
                        "auth.hash-cpu".to_owned(),
                        "auth.account.create".to_owned(),
                        "auth.session-mint".to_owned(),
                    ],
                ),
            ]),
            policy_digest: String::new(),
        }),
    };
    resign_guest_auth_budget_policy(&mut program);
    program
}

fn resign_guest_auth_budget_policy(program: &mut AuthProgramManifestV1) {
    let Some(policy) = program.abuse_budgets.as_mut() else {
        return;
    };
    let preimage = json!({
        "version": policy.version,
        "preset": policy.preset,
        "budgets": policy.budgets,
        "effectBindings": policy.effect_bindings,
    });
    let canonical = crate::rqs_contract::jcs(&preimage).expect("guest budget policy JCS");
    let mut hasher = Sha256::new();
    hasher.update(b"snapback.auth-abuse-budget-policy.v1");
    hasher.update(canonical.as_bytes());
    policy.policy_digest = format!("sha256:{:x}", hasher.finalize());
}

async fn guest_sessions_activation_server_fixture_async(
    enabled: bool,
    cleanup: GuestCleanupContractV1,
) -> AppState {
    tokio::task::spawn_blocking(move || {
        let _sanction = crate::exec_guard::BlockingSanction::acquire();
        sessions_activation_server_fixture_with_api_and_password_mode(
            activation_functions('2', false),
            None,
            None,
            None,
            PasswordIdentifierMode::EmailV1,
            Some(guest_auth_program(enabled, cleanup)),
        )
    })
    .await
    .expect("construct guest activation fixture off the async workers")
}

async fn guest_sessions_custom_activation_server_fixture_async(
    program: AuthProgramManifestV1,
) -> AppState {
    tokio::task::spawn_blocking(move || {
        let _sanction = crate::exec_guard::BlockingSanction::acquire();
        sessions_activation_server_fixture_with_api_and_password_mode(
            activation_functions('2', false),
            None,
            None,
            None,
            PasswordIdentifierMode::EmailV1,
            Some(program),
        )
    })
    .await
    .expect("construct custom guest activation fixture off the async workers")
}

async fn sessions_activation_server_fixture_with_agents_async(agents: AgentsManifest) -> AppState {
    tokio::task::spawn_blocking(move || {
        let _sanction = crate::exec_guard::BlockingSanction::acquire();
        sessions_activation_server_fixture_with_agents(
            activation_functions('2', false),
            None,
            Some(agents),
        )
    })
    .await
    .expect("construct agent-registration fixture off the async workers")
}

async fn sessions_activation_server_fixture_with_integrations_async() -> AppState {
    tokio::task::spawn_blocking(|| {
        let _sanction = crate::exec_guard::BlockingSanction::acquire();
        let mut functions = activation_functions('2', false);
        for function in &mut functions.functions {
            function.api_exposure = Some(ApiFunctionExposure::default());
        }
        for function in functions
            .functions
            .iter_mut()
            .filter(|function| matches!(function.name.as_str(), "listItems" | "liveItems"))
        {
            function.api_exposure = Some(ApiFunctionExposure {
                expose: true,
                since: None,
                approval: None,
            });
        }
        sessions_activation_server_fixture_with_api(
            functions,
            None,
            Some(agent_policy(AgentsMode::Open, InvitedBy::Operators)),
            Some(ApiManifest {
                enabled: true,
                functions: BTreeMap::from([
                    (
                        "listItems".to_owned(),
                        ApiFunctionExposure {
                            expose: true,
                            since: None,
                            approval: None,
                        },
                    ),
                    (
                        "liveItems".to_owned(),
                        ApiFunctionExposure {
                            expose: true,
                            since: None,
                            approval: None,
                        },
                    ),
                ]),
                ..ApiManifest::default()
            }),
        )
    })
    .await
    .expect("construct integration lifecycle fixture off the async workers")
}

async fn approval_effect_server_fixture_with_authority_creation(
    approval: ApiFunctionApproval,
    authority_creating: bool,
) -> AppState {
    tokio::task::spawn_blocking(move || {
        let _sanction = crate::exec_guard::BlockingSanction::acquire();
        let mut functions = activation_functions('2', false);
        for function in &mut functions.functions {
            function.api_exposure = Some(ApiFunctionExposure::default());
        }
        let queued_write = functions
            .functions
            .iter_mut()
            .find(|function| function.name == "queuedWrite")
            .unwrap();
        queued_write.api_exposure = Some(ApiFunctionExposure {
            expose: true,
            since: None,
            approval: Some(approval),
        });
        queued_write.authority_creating = authority_creating;
        sessions_activation_server_fixture_with_api(
            functions,
            None,
            Some(agent_policy(AgentsMode::Disabled, InvitedBy::Operators)),
            Some(ApiManifest {
                enabled: true,
                functions: BTreeMap::from([(
                    "queuedWrite".to_owned(),
                    ApiFunctionExposure {
                        expose: true,
                        since: None,
                        approval: Some(approval),
                    },
                )]),
                ..ApiManifest::default()
            }),
        )
    })
    .await
    .expect("construct approval-effect fixture off async workers")
}

async fn approval_effect_server_fixture(approval: ApiFunctionApproval) -> AppState {
    approval_effect_server_fixture_with_authority_creation(approval, false).await
}

async fn capability_link_server_fixture() -> AppState {
    tokio::task::spawn_blocking(|| {
        let _sanction = crate::exec_guard::BlockingSanction::acquire();
        let mut functions = activation_functions('2', false);
        for function in &mut functions.functions {
            function.api_exposure = Some(ApiFunctionExposure::default());
        }
        functions
            .functions
            .iter_mut()
            .find(|function| function.name == "queuedWrite")
            .expect("capability-link fixture mutation")
            .api_exposure = Some(ApiFunctionExposure {
            expose: true,
            since: None,
            approval: None,
        });
        sessions_activation_server_fixture_with_api(
            functions,
            None,
            Some(agent_policy(AgentsMode::Disabled, InvitedBy::Operators)),
            Some(ApiManifest {
                enabled: true,
                functions: BTreeMap::from([(
                    "queuedWrite".to_owned(),
                    ApiFunctionExposure {
                        expose: true,
                        since: None,
                        approval: None,
                    },
                )]),
                ..ApiManifest::default()
            }),
        )
    })
    .await
    .expect("construct capability-link fixture off async workers")
}

async fn sessions_activation_server_fixture_with_ask_async(
    provider_base_url: String,
    result_max_bytes: u64,
) -> AppState {
    tokio::task::spawn_blocking(move || {
        let _sanction = crate::exec_guard::BlockingSanction::acquire();
        let mut functions = activation_functions('2', false);
        for function in &mut functions.functions {
            function.api_exposure = Some(ApiFunctionExposure::default());
        }
        for name in ["listItems", "queuedWrite"] {
            functions
                .functions
                .iter_mut()
                .find(|function| function.name == name)
                .expect("ask fixture function")
                .api_exposure = Some(ApiFunctionExposure {
                expose: true,
                since: None,
                approval: None,
            });
        }
        let provider = format!("openai-compatible:{provider_base_url}");
        crate::ask::admit_loopback_provider_for_test(&provider);
        crate::ask::with_loopback_provider_for_test(|| {
            sessions_activation_server_fixture_with_api(
                functions,
                None,
                Some(AgentsManifest::explicit(
                    AgentsMode::Disabled,
                    InvitedBy::Operators,
                )),
                Some(ApiManifest {
                    enabled: true,
                    functions: BTreeMap::from([
                        (
                            "listItems".to_owned(),
                            ApiFunctionExposure {
                                expose: true,
                                since: None,
                                approval: None,
                            },
                        ),
                        (
                            "queuedWrite".to_owned(),
                            ApiFunctionExposure {
                                expose: true,
                                since: None,
                                approval: None,
                            },
                        ),
                    ]),
                    ask: Some(ApiAskManifest {
                        enabled: true,
                        billing: ApiAskBilling::CallerKey,
                        model: Some(ApiAskModelManifest {
                            provider,
                            model: "stub-model".to_owned(),
                            secret: None,
                        }),
                    }),
                    budgets: Some(ApiBudgetsManifest {
                        ask: Some(ApiAskBudgets {
                            per_request: ApiAskPerRequestBudget {
                                max_tokens: 100,
                                max_steps: 6,
                                max_wall_ms: 5_000,
                            },
                            per_principal_day: ApiAskPerPrincipalDayBudget { max_tokens: 1_000 },
                            per_integration_day: Some(ApiAskTokenBudget { max_tokens: 500 }),
                            app_monthly: ApiAskTokenBudget { max_tokens: 10_000 },
                            result_volume: ApiAskResultVolumeBudget {
                                max_bytes: result_max_bytes,
                                max_rows: 100,
                                per_principal_day_bytes: result_max_bytes.saturating_mul(10),
                            },
                        }),
                    }),
                    ..ApiManifest::default()
                }),
            )
        })
    })
    .await
    .expect("construct ask activation fixture")
}

async fn ask_provider_stub(
    responses: Vec<Value>,
) -> (
    String,
    Arc<StdMutex<Vec<Value>>>,
    tokio::task::JoinHandle<()>,
) {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind ask provider stub");
    let address = listener.local_addr().expect("ask provider stub address");
    let captured = Arc::new(StdMutex::new(Vec::new()));
    let captured_task = captured.clone();
    let task = tokio::spawn(async move {
        for response in responses {
            let (mut socket, _) = listener.accept().await.expect("accept ask provider call");
            let mut request = Vec::new();
            let mut buffer = [0_u8; 4096];
            let body_start = loop {
                let read = socket
                    .read(&mut buffer)
                    .await
                    .expect("read ask provider call");
                assert!(read > 0, "provider request closed before headers");
                request.extend_from_slice(&buffer[..read]);
                if let Some(offset) = request.windows(4).position(|window| window == b"\r\n\r\n") {
                    break offset + 4;
                }
            };
            let headers = String::from_utf8_lossy(&request[..body_start]);
            let content_length = headers
                .lines()
                .find_map(|line| {
                    line.split_once(':').and_then(|(name, value)| {
                        name.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().ok())
                            .flatten()
                    })
                })
                .expect("provider request content length");
            while request.len() - body_start < content_length {
                let read = socket.read(&mut buffer).await.expect("read provider body");
                assert!(read > 0, "provider request closed before body");
                request.extend_from_slice(&buffer[..read]);
            }
            let body: Value =
                serde_json::from_slice(&request[body_start..body_start + content_length])
                    .expect("provider request JSON");
            captured_task.lock().unwrap().push(body);
            let body = serde_json::to_vec(&response).expect("provider response JSON");
            let head = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
                body.len()
            );
            socket
                .write_all(head.as_bytes())
                .await
                .expect("write provider head");
            socket.write_all(&body).await.expect("write provider body");
        }
    });
    (format!("http://{address}/v1"), captured, task)
}

static ASK_EGRESS_ENV_TEST_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();

struct AskEgressEnvRestore(Option<std::ffi::OsString>);

impl Drop for AskEgressEnvRestore {
    fn drop(&mut self) {
        match self.0.take() {
            Some(value) => unsafe { std::env::set_var("SNAPBACK_OUTBOUND_ACTIONS", value) },
            None => unsafe { std::env::remove_var("SNAPBACK_OUTBOUND_ACTIONS") },
        }
    }
}

async fn sessions_activation_server_fixture_with_oauth_async() -> AppState {
    sessions_activation_server_fixture_with_oauth_policy_async(agent_policy(
        AgentsMode::Open,
        InvitedBy::Operators,
    ))
    .await
}

async fn sessions_activation_server_fixture_with_oauth_policy_async(
    agents: AgentsManifest,
) -> AppState {
    let state = tokio::task::spawn_blocking(move || {
        let _sanction = crate::exec_guard::BlockingSanction::acquire();
        let mut functions = activation_functions('2', false);
        for function in &mut functions.functions {
            function.api_exposure = Some(ApiFunctionExposure::default());
        }
        functions
            .functions
            .iter_mut()
            .find(|function| function.name == "listItems")
            .unwrap()
            .api_exposure = Some(ApiFunctionExposure {
            expose: true,
            since: None,
            approval: None,
        });
        let mut authenticated_items = functions
            .functions
            .iter()
            .find(|function| function.name == "listItems")
            .unwrap()
            .clone();
        authenticated_items.id = "fn:authenticatedItems".to_owned();
        authenticated_items.name = "authenticatedItems".to_owned();
        authenticated_items.exported_name = Some("authenticatedItems".to_owned());
        authenticated_items.auth_requirement = Some(AuthRequirement::Authenticated);
        functions.functions.push(authenticated_items);
        let queued_write = functions
            .functions
            .iter_mut()
            .find(|function| function.name == "queuedWrite")
            .unwrap();
        queued_write.api_exposure = Some(ApiFunctionExposure {
            expose: true,
            since: None,
            approval: None,
        });
        queued_write.authority_creating = true;
        sessions_activation_server_fixture_with_api(
            functions,
            None,
            Some(agents),
            Some(ApiManifest {
                enabled: true,
                functions: BTreeMap::from([
                    (
                        "listItems".to_owned(),
                        ApiFunctionExposure {
                            expose: true,
                            since: None,
                            approval: None,
                        },
                    ),
                    (
                        "queuedWrite".to_owned(),
                        ApiFunctionExposure {
                            expose: true,
                            since: None,
                            approval: None,
                        },
                    ),
                    (
                        "authenticatedItems".to_owned(),
                        ApiFunctionExposure {
                            expose: true,
                            since: None,
                            approval: None,
                        },
                    ),
                ]),
                oauth: Some(ApiOAuthManifest {
                    enabled: true,
                    bearer: true,
                    bundles: BTreeMap::from([
                        (
                            "items.read".to_owned(),
                            ApiOAuthBundle {
                                functions: vec![
                                    "listItems".to_owned(),
                                    "authenticatedItems".to_owned(),
                                ],
                            },
                        ),
                        (
                            "items.write".to_owned(),
                            ApiOAuthBundle {
                                functions: vec!["queuedWrite".to_owned()],
                            },
                        ),
                    ]),
                }),
                ..ApiManifest::default()
            }),
        )
    })
    .await
    .expect("construct OAuth facade fixture off the async workers");
    with_snapback(&state.snapback, |snapback| {
        let scope_functions = snapback.served_function_manifest().clone();
        let mut database = snapback.remainder_auth_fixture();
        database.reconcile_auth_scope_bases(&scope_functions)?;
        assert_eq!(
            database.current_auth_scope_basis("fn:listItems", &FunctionKind::Query, false)?,
            Some(0),
        );
        assert_eq!(
            database.current_auth_scope_basis("fn:queuedWrite", &FunctionKind::Mutation, true)?,
            Some(0),
        );
        assert_eq!(
            database.current_auth_scope_basis(
                "fn:authenticatedItems",
                &FunctionKind::Query,
                false,
            )?,
            Some(0),
        );
        Ok::<_, SnapbackError>(())
    })
    .await
    .expect("compile bundle function names to current scope bases");
    state
}

fn oauth_protocol_request(
    method: &str,
    uri: &str,
    content_type: Option<&str>,
    body: impl Into<Body>,
    bearer: Option<&str>,
) -> Request<Body> {
    let mut builder = Request::builder()
        .method(method)
        .uri(uri)
        .header("x-snapback-auth-client-protocol", "1");
    if let Some(content_type) = content_type {
        builder = builder.header(header::CONTENT_TYPE, content_type);
    }
    if let Some(bearer) = bearer {
        builder = builder.header(header::AUTHORIZATION, format!("Bearer {bearer}"));
    }
    builder.body(body.into()).unwrap()
}

fn mcp_protocol_request(
    method: &str,
    body: Value,
    bearer: Option<&str>,
    declared_client_id: Option<&str>,
    accept: Option<&str>,
) -> Request<Body> {
    let mut builder = Request::builder()
        .method(method)
        .uri("/mcp")
        .header(header::CONTENT_TYPE, "application/json");
    if let Some(bearer) = bearer {
        builder = builder.header(header::AUTHORIZATION, format!("Bearer {bearer}"));
    }
    if let Some(declared_client_id) = declared_client_id {
        builder = builder.header(super::SNAPBACK_CLIENT_ID_HEADER, declared_client_id);
    }
    if let Some(accept) = accept {
        builder = builder.header(header::ACCEPT, accept);
    }
    builder
        .body(Body::from(serde_json::to_vec(&body).unwrap()))
        .unwrap()
}

// @ref LLP 0214#62-projection-rules — approval re-prepares the frozen
// original session as EffectExecution authority, so it must cross the same
// catalog-claims chokepoint as ordinary HTTP and live sources.

fn finite_authority_matrix_functions() -> FunctionManifest {
    let mut functions = activation_functions('9', false);
    let mut action_args = BTreeMap::new();
    action_args.insert(
        "value".to_owned(),
        ValueExpr::Literal(json!("forbidden-action-effect")),
    );
    let mut write_action = FunctionDefinition::new(
        "writeAction",
        FunctionKind::Action,
        FunctionRuntime::HostPlan(HandlerPlan::Action(ActionPlan {
            steps: vec![ActionStep::RunMutation {
                name: "queuedWrite".to_owned(),
                args: action_args,
                bind_result_as: None,
            }],
            return_value: Some(ActionReturnValue::ChangedCount),
        })),
    );
    write_action.write_set_summary.tables = vec!["items".to_owned()];
    functions.functions.push(write_action);
    functions
}

#[derive(Clone, Copy, Debug)]
enum DetachedNestedMutationRuntime {
    HostPlan,
    Ibex,
}

impl DetachedNestedMutationRuntime {
    fn label(self) -> &'static str {
        match self {
            Self::HostPlan => "hostPlan",
            Self::Ibex => "ibex",
        }
    }
}

fn detached_nested_mutation_fence_functions(
    child_runtime: DetachedNestedMutationRuntime,
) -> FunctionManifest {
    const SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async writeAction(ctx) {
    return await ctx.runMutation('queuedWrite', { value: 'caller-terminal-child-effect' });
  },
  async queuedWrite(ctx, args) {
    await ctx.db.insert('items', { value: args.value });
    return 1;
  }
};
"#;
    let mut functions = activation_functions('9', false);
    if matches!(child_runtime, DetachedNestedMutationRuntime::Ibex) {
        let child = functions
            .functions
            .iter_mut()
            .find(|function| function.name == "queuedWrite")
            .expect("detached nested-mutation child");
        child.runtime = FunctionRuntime::IbexModule(IbexModule {
            source: SOURCE.to_owned(),
            export: "queuedWrite".to_owned(),
        });
        child.required_capabilities = vec![
            "ibex_ctx_db_host_bridge".to_owned(),
            "mutation_read_set_validation".to_owned(),
        ];
        child.write_set_summary.mode = Some("handlerDeclared".to_owned());
    }
    let mut action = FunctionDefinition::new(
        "writeAction",
        FunctionKind::Action,
        FunctionRuntime::IbexModule(IbexModule {
            source: SOURCE.to_owned(),
            export: "writeAction".to_owned(),
        }),
    );
    action.required_capabilities = vec!["cron_action_run_mutation".to_owned()];
    action.write_set_summary.tables = vec!["items".to_owned()];
    functions.functions.push(action);
    functions
}

fn caught_nested_refusal_functions(busy_loop_after_refusal: bool) -> FunctionManifest {
    let mut functions = activation_functions('9', false);
    let template = functions
        .functions
        .iter()
        .find(|function| function.name == "queuedWrite")
        .expect("caught-refusal mutation template")
        .clone();
    for name in ["firstWrite", "secondWrite"] {
        let mut child = template.clone();
        child.name = name.to_owned();
        child.id = format!("fn:{name}");
        functions.functions.push(child);
    }
    let tail = if busy_loop_after_refusal {
        "for (;;) { Math.imul(17, 19); }"
    } else {
        r#"
  let pure = [1, 2, 3].map((value) => value * 2).join(',');
  try { await ctx.runMutation('secondWrite', { value: 'second-caught-sentinel' }); }
  catch (error) { second = String(error?.code ?? error?.message ?? error); }
  return pure.length > 0 ? 'success' : first + second;
"#
    };
    let source = format!(
        r#"
globalThis.__snapbackHandlers = {{
  async caughtRefusalAction(ctx) {{
    let first = '';
    let second = '';
    try {{ await ctx.runMutation('firstWrite', {{ value: 'first-caught-sentinel' }}); }}
    catch (error) {{ first = String(error?.code ?? error?.message ?? error); }}
    {tail}
  }}
}};
"#
    );
    let mut action = FunctionDefinition::new(
        "caughtRefusalAction",
        FunctionKind::Action,
        FunctionRuntime::IbexModule(IbexModule {
            source,
            export: "caughtRefusalAction".to_owned(),
        }),
    );
    action.required_capabilities = vec!["cron_action_run_mutation".to_owned()];
    action.write_set_summary.tables = vec!["items".to_owned()];
    functions.functions.push(action);
    functions
}

struct FiniteAuthorityMatrixFixture {
    state: AppState,
    router: SnapbackApp,
    clock: Arc<ManualServerAuthClock>,
    start_ms: u64,
    effective_user_id: String,
    agent_user_id: String,
    grant_id: String,
    credential: String,
    token: String,
    token_id: String,
    token_expires_at_ms: u64,
}

async fn finite_authority_matrix_fixture() -> FiniteAuthorityMatrixFixture {
    finite_authority_matrix_fixture_with_functions(finite_authority_matrix_functions()).await
}

async fn finite_authority_matrix_fixture_with_functions(
    functions: FunctionManifest,
) -> FiniteAuthorityMatrixFixture {
    // Retained live reruns deliberately consult the host wall clock rather
    // than the injected provider clock. Keep the deterministic provider a
    // minute behind that wall clock: far enough to avoid millisecond
    // sampling skew, but well inside the token's 24-hour lifetime.
    let start_ms = super::now_millis().saturating_sub(60_000);
    let clock = Arc::new(ManualServerAuthClock::new(start_ms));
    let fixture_clock = clock.clone();
    let fixture_functions = functions.clone();
    let state = tokio::task::spawn_blocking(move || {
        let _sanction = crate::exec_guard::BlockingSanction::acquire();
        sessions_activation_server_fixture_with_agents(
            fixture_functions,
            Some(fixture_clock),
            Some(agent_policy(AgentsMode::Open, InvitedBy::Operators)),
        )
    })
    .await
    .expect("construct finite-authority matrix fixture off async workers");
    let effective_user_id = "018f0d90-7b30-7a22-8c33-445566778899".to_owned();
    let grant_id = "018f0d90-7b32-7a22-8c33-445566778899".to_owned();
    let setup_effective_user_id = effective_user_id.clone();
    let setup_grant_id = grant_id.clone();
    let (agent_user_id, credential, token, token_id, token_expires_at_ms) =
        with_snapback(&state.snapback, move |snapback| {
            let mut db = snapback.remainder_auth_fixture();
            db.reconcile_auth_scope_bases(&functions)?;
            db.auth_catalog()
                .insert_human_user_for_test(&setup_effective_user_id, start_ms)?;
            let credential = db.register_agent_principal(
                None,
                Some("Finite Authority Agent".to_owned()),
                None,
                ServerProfile::Test,
                start_ms,
                &OsRandom,
            )?;
            db.auth_catalog().insert_finite_authority_grant_for_test(
                &setup_grant_id,
                &credential.user_id,
                &setup_effective_user_id,
                start_ms,
            )?;
            let issued = db.mint_scoped_token(
                &credential.secret,
                &setup_grant_id,
                Some(24 * 60 * 60 * 1_000),
                start_ms,
                &OsRandom,
            )?;
            Ok::<_, SnapbackError>((
                credential.user_id,
                credential.secret.expose_secret().to_owned(),
                issued.secret.expose_secret().to_owned(),
                issued.token_id,
                issued.expires_at_ms,
            ))
        })
        .await
        .expect("seed real finite service authority");
    let router = app(state.clone());
    FiniteAuthorityMatrixFixture {
        state,
        router,
        clock,
        start_ms,
        effective_user_id,
        agent_user_id,
        grant_id,
        credential,
        token,
        token_id,
        token_expires_at_ms,
    }
}

async fn mint_same_grant_sibling_and_set_deadline(
    fixture: &FiniteAuthorityMatrixFixture,
    grant_deadline_ms: u64,
) -> (String, String) {
    let start_ms = fixture.start_ms;
    let credential = fixture.credential.clone();
    let grant_id = fixture.grant_id.clone();
    with_snapback(&fixture.state.snapback, move |snapback| {
        let credential =
            AgentCredential::parse(&credential).expect("parse grant-expiry credential");
        let issued = snapback.remainder_auth_fixture().mint_scoped_token(
            &credential,
            &grant_id,
            Some(24 * 60 * 60 * 1_000),
            start_ms,
            &OsRandom,
        )?;
        snapback
            .remainder_auth_fixture()
            .auth_catalog()
            .set_grant_expiry_for_test(&grant_id, grant_deadline_ms)?;
        Ok::<_, SnapbackError>((issued.secret.expose_secret().to_owned(), issued.token_id))
    })
    .await
    .expect("mint sibling token and shorten the shared grant")
}

#[derive(Clone, Copy, Debug)]
enum FiniteAuthorityMatrixRoute {
    Query,
    Mutation,
    Action,
    AuthSession,
    ConnectionInsert,
    ConnectionAct,
}

impl FiniteAuthorityMatrixRoute {
    fn pause_point(self) -> TestFiniteAuthorityPausePoint {
        match self {
            Self::Query | Self::AuthSession => {
                TestFiniteAuthorityPausePoint::BeforeResponsePublication
            }
            Self::Mutation | Self::Action | Self::ConnectionInsert | Self::ConnectionAct => {
                TestFiniteAuthorityPausePoint::BeforeHandler
            }
        }
    }
}

#[derive(Clone, Copy, Debug)]
enum FiniteAuthorityMatrixEnding {
    GrantRevoke,
    CredentialRotate,
    CredentialRevoke,
    PrincipalDeactivate,
    TokenExpiry,
    TokenCapEviction,
}

impl FiniteAuthorityMatrixEnding {
    fn expected_disposition(self) -> &'static str {
        match self {
            Self::TokenExpiry | Self::TokenCapEviction => "carrier",
            Self::GrantRevoke
            | Self::CredentialRotate
            | Self::CredentialRevoke
            | Self::PrincipalDeactivate => "durableDelete",
        }
    }
}

async fn finite_authority_matrix_item_count(state: &AppState) -> usize {
    with_snapback(&state.snapback, |snapback| {
        snapback.scan_table("items", 100, 0).map(|scan| scan.total)
    })
    .await
    .expect("scan matrix item effects")
}

async fn finite_authority_matrix_pending_durable(state: &AppState) -> usize {
    super::inspect_snapback(&state.snapback)
        .await
        .expect("inspect matrix outbox effects")
        .ephemeral
        .pending_durable_messages
}

async fn commit_finite_authority_matrix_ending(
    fixture: &FiniteAuthorityMatrixFixture,
    ending: FiniteAuthorityMatrixEnding,
) {
    match ending {
        FiniteAuthorityMatrixEnding::GrantRevoke => {
            let effective_user_id = fixture.effective_user_id.clone();
            let grant_id = fixture.grant_id.clone();
            let token_id = fixture.token_id.clone();
            let now_ms = fixture.start_ms + 1;
            fixture.clock.set(now_ms);
            let revoked = with_snapback(&fixture.state.snapback, move |snapback| {
                snapback.remainder_auth_fixture().revoke_grant_for_user(
                    &effective_user_id,
                    &grant_id,
                    now_ms,
                )
            })
            .await
            .expect("commit real grant revocation");
            assert_eq!(revoked.token_ids, vec![token_id]);
        }
        FiniteAuthorityMatrixEnding::CredentialRotate => {
            let credential = fixture.credential.clone();
            let token_id = fixture.token_id.clone();
            let now_ms = fixture.start_ms
                + crate::storage::auth_agent_credentials::AGENT_CREDENTIAL_ROTATION_MIN_INTERVAL_MS;
            fixture.clock.set(now_ms);
            let rotated = with_snapback(&fixture.state.snapback, move |snapback| {
                let credential =
                    AgentCredential::parse(&credential).expect("parse matrix agent credential");
                snapback.remainder_auth_fixture().rotate_agent_credential(
                    &credential,
                    now_ms,
                    &OsRandom,
                )
            })
            .await
            .expect("commit real credential rotation");
            assert_eq!(rotated.invalidated_token_ids, vec![token_id]);
        }
        FiniteAuthorityMatrixEnding::CredentialRevoke => {
            let credential = fixture.credential.clone();
            let token_id = fixture.token_id.clone();
            let now_ms = fixture.start_ms + 1;
            fixture.clock.set(now_ms);
            let revoked = with_snapback(&fixture.state.snapback, move |snapback| {
                let credential =
                    AgentCredential::parse(&credential).expect("parse matrix agent credential");
                snapback
                    .remainder_auth_fixture()
                    .revoke_agent_credential_family(&credential, now_ms)
            })
            .await
            .expect("commit real credential-family revocation");
            assert_eq!(revoked.token_ids, vec![token_id]);
        }
        FiniteAuthorityMatrixEnding::PrincipalDeactivate => {
            let agent_user_id = fixture.agent_user_id.clone();
            let now_ms = fixture.start_ms + 1;
            fixture.clock.set(now_ms);
            with_snapback(&fixture.state.snapback, move |snapback| {
                let manifest = snapback.remainder_auth_fixture().schema().clone();
                snapback.remainder_auth_fixture().deactivate_agent(
                    &agent_user_id,
                    now_ms,
                    &manifest,
                )
            })
            .await
            .expect("commit real principal deactivation");
        }
        FiniteAuthorityMatrixEnding::TokenExpiry => {
            let opened = fixture
                .router
                .clone()
                .oneshot(connection_open_request(
                    Some(&fixture.token),
                    json!({
                        "connectionId": "matrix-expiry-terminal-plan",
                        "authInvalidationProtocol": 1,
                    }),
                ))
                .await
                .expect("open exact publication for token-expiry terminal");
            assert_eq!(opened.status(), StatusCode::OK);
            let opened = response_json(opened).await;
            let connection_id = opened["connectionId"]
                .as_str()
                .expect("expiry-plan connection id");
            let publication = {
                let registry = fixture.state.connections.lock();
                let record = registry
                    .grants
                    .get(connection_id)
                    .expect("expiry-plan connection grant");
                let BoundGrantAuthority::ServicePrincipal {
                    service_publication,
                    ..
                } = &record.authority
                else {
                    panic!("scoped token must retain a service publication")
                };
                service_publication.clone()
            };
            fixture.clock.set(fixture.token_expires_at_ms);
            let (epoch_now_ms, monotonic_now) = super::auth_runtime_now(&fixture.state);
            let plan = with_snapback(&fixture.state.snapback, move |snapback| {
                snapback.plan_expired_service_publication(&publication, epoch_now_ms, monotonic_now)
            })
            .await
            .expect("plan exact token-expiry terminal")
            .expect("token deadline is due");
            let commit = plan
                .acquire_gate()
                .await
                .expect("acquire exact token-expiry gate");
            with_snapback(&fixture.state.snapback, move |snapback| {
                snapback.commit_expired_service_authority(commit)
            })
            .await
            .expect("commit real token-expiry terminal transaction");
        }
        FiniteAuthorityMatrixEnding::TokenCapEviction => {
            let credential = fixture.credential.clone();
            let grant_id = fixture.grant_id.clone();
            let token_id = fixture.token_id.clone();
            let start_ms = fixture.start_ms;
            fixture
                .clock
                .set(start_ms + crate::storage::auth_agent_credentials::SCOPED_TOKEN_LIVE_CAP);
            let evicted = with_snapback(&fixture.state.snapback, move |snapback| {
                let credential =
                    AgentCredential::parse(&credential).expect("parse matrix agent credential");
                let mut evicted = Vec::new();
                for offset in 1..=crate::storage::auth_agent_credentials::SCOPED_TOKEN_LIVE_CAP {
                    let issued = snapback.remainder_auth_fixture().mint_scoped_token(
                        &credential,
                        &grant_id,
                        Some(24 * 60 * 60 * 1_000),
                        start_ms + offset,
                        &OsRandom,
                    )?;
                    evicted.extend(issued.evicted_token_ids);
                }
                Ok::<_, SnapbackError>(evicted)
            })
            .await
            .expect("commit real token-cap eviction transaction");
            assert_eq!(evicted, vec![token_id]);
        }
    }
}

struct FiniteAuthorityMatrixRequest {
    request: Request<Body>,
    pending_connection_id: Option<String>,
    queued_connection_id: Option<String>,
}

async fn finite_authority_matrix_request(
    fixture: &FiniteAuthorityMatrixFixture,
    route: FiniteAuthorityMatrixRoute,
) -> FiniteAuthorityMatrixRequest {
    let bearer_request = |method: &str, uri: &str, body: Body| {
        Request::builder()
            .method(method)
            .uri(uri)
            .header(header::CONTENT_TYPE, "application/json")
            .header(header::AUTHORIZATION, format!("Bearer {}", fixture.token))
            .header("x-snapback-auth-client-protocol", "1")
            .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE)
            .body(body)
            .expect("matrix finite bearer request")
    };
    let (request, pending_connection_id, queued_connection_id) = match route {
        FiniteAuthorityMatrixRoute::Query => (
            bearer_request("POST", "/query/listItems", Body::from(r#"{"args":{}}"#)),
            None,
            None,
        ),
        FiniteAuthorityMatrixRoute::Mutation => (
            bearer_request(
                "POST",
                "/mutation/queuedWrite",
                Body::from(r#"{"args":{"value":"forbidden-mutation-effect"}}"#),
            ),
            None,
            None,
        ),
        FiniteAuthorityMatrixRoute::Action => (
            bearer_request("POST", "/action/writeAction", Body::from(r#"{"args":{}}"#)),
            None,
            None,
        ),
        FiniteAuthorityMatrixRoute::AuthSession => (
            Request::builder()
                .method("GET")
                .uri("/auth/session")
                .header(header::AUTHORIZATION, format!("Bearer {}", fixture.token))
                .header("x-snapback-auth-client-protocol", "1")
                .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE)
                .header("x-snapback-authority-descriptor-protocol", "1")
                .body(Body::empty())
                .expect("matrix auth/session request"),
            None,
            None,
        ),
        FiniteAuthorityMatrixRoute::ConnectionInsert => {
            let connection_id = "matrix-pending-open".to_owned();
            (
                connection_open_request(
                    Some(&fixture.token),
                    json!({
                        "connectionId": connection_id,
                        "authInvalidationProtocol": 1,
                    }),
                ),
                Some(connection_id),
                None,
            )
        }
        FiniteAuthorityMatrixRoute::ConnectionAct => {
            let opened = fixture
                .router
                .clone()
                .oneshot(connection_open_request(
                    Some(&fixture.token),
                    json!({
                        "connectionId": "matrix-open-for-act",
                        "authInvalidationProtocol": 1,
                    }),
                ))
                .await
                .expect("open real matrix service connection");
            assert_eq!(opened.status(), StatusCode::OK);
            let opened = response_json(opened).await;
            let connection_id = opened["connectionId"]
                .as_str()
                .expect("matrix connection id")
                .to_owned();
            let connection_token = opened["connectionToken"]
                .as_str()
                .expect("matrix connection token")
                .to_owned();
            let (epoch_now_ms, monotonic_now) = super::auth_runtime_now(&fixture.state);
            let prepared = fixture
                .state
                .connections
                .prepare_act(
                    &connection_id,
                    Some(&connection_token),
                    fixture.state.auth_coordinator.as_deref(),
                    false,
                    epoch_now_ms,
                    monotonic_now,
                )
                .expect("prepare matrix connection outbox effect");
            fixture.state.ephemeral.enqueue_durable_bound_for_test(
                &connection_id,
                b"must-remain-queued".to_vec(),
                prepared.effect_fence(),
            );
            assert_eq!(
                finite_authority_matrix_pending_durable(&fixture.state).await,
                1,
                "matrix connection act begins with one queued frame"
            );
            (
                Request::builder()
                    .method("GET")
                    .uri(format!("/outbox/{connection_id}"))
                    .header(super::CONNECTION_TOKEN_HEADER, connection_token)
                    .header("x-snapback-auth-client-protocol", "1")
                    .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE)
                    .body(Body::empty())
                    .expect("matrix connection act request"),
                None,
                Some(connection_id),
            )
        }
    };
    FiniteAuthorityMatrixRequest {
        request,
        pending_connection_id,
        queued_connection_id,
    }
}

#[derive(Debug, PartialEq)]
struct DetachedNestedMutationDurableEvidence {
    database_image: Vec<u8>,
    rows: Vec<Value>,
    durable_version: u64,
    change_journal_len: u64,
    jobs: Value,
}

async fn detached_nested_mutation_durable_evidence(
    state: &AppState,
) -> DetachedNestedMutationDurableEvidence {
    with_snapback(&state.snapback, |snapback| {
        let mut image = tempfile::NamedTempFile::new().expect("detached fence database image");
        snapback
            .backup_database_image_into(image.as_file())
            .expect("capture detached fence database image");
        image
            .as_file_mut()
            .seek(SeekFrom::Start(0))
            .expect("rewind detached fence database image");
        let mut database_image = Vec::new();
        image
            .as_file_mut()
            .read_to_end(&mut database_image)
            .expect("read detached fence database image");
        Ok::<_, SnapbackError>(DetachedNestedMutationDurableEvidence {
            database_image,
            rows: snapback.scan_table("items", 100, 0)?.rows,
            durable_version: snapback.durable_version()?,
            change_journal_len: snapback.change_journal_len()?,
            jobs: snapback.jobs_inspect(100)?,
        })
    })
    .await
    .expect("capture detached nested-mutation durable evidence")
}

#[derive(Clone, Copy, Debug)]
enum DetachedNestedMutationCaller {
    Session,
    ScopedService,
}

#[derive(Clone, Copy, Debug)]
enum NestedAfterLocalRuntime {
    ManagedHostPlan,
    DetachedHostPlan,
    DetachedIbex,
}

async fn install_after_local_production_subscription(
    state: &AppState,
    bearer: &str,
    connection_id: &str,
    query_instance_id: u64,
) -> Arc<tokio::sync::Notify> {
    let (_opened, connection_act) =
        prepare_invalidation_session_connection_act(state, bearer, connection_id);
    state.ephemeral.touch_connection(connection_id);
    let admission = test_route_admission(state).0;
    let subscribe_authority = InvocationGate::prepare_admitted_subjectless_authority(
        InvocationSource::LiveInitialQuery,
        AuthMode::Sessions,
        state.server.profile,
        admission,
        &WireAuthorityFields::default(),
        connection_act.resolved.clone(),
        test_session_claims_for(&connection_act.resolved),
    )
    .expect("prepare after-Local live authority")
    .with_fenced_publication(connection_act.bound.publication().clone());
    let effect_fence = connection_act.effect_fence();
    let invalidation = connection_act.authorization_invalidation.clone();
    let connection = connection_id.to_owned();
    with_snapback(&state.snapback, move |snapback| {
        snapback_engine::test_support::subscribe_live_prepared_with_invalidation(
            snapback,
            "liveItems",
            LiveSubscribeInput {
                connection_id: connection,
                input: HandlerInput::default(),
                authorization_namespace: Some(QueryNamespace {
                    client_store_id: "after_local_production_store".to_owned(),
                    query_key: "liveItems:{}".to_owned(),
                    query_instance_id,
                }),
                supersedes: None,
                resume_from_token: None,
            },
            subscribe_authority,
            snapback_engine::test_support::live_invalidation_admission(
                invalidation.expect("negotiated invalidation descriptor"),
                true,
            ),
        )
    })
    .await
    .expect("install after-Local production subscription");

    let notifier = state.ephemeral.delivery_notifier();
    let (_generation, waker) = notifier
        .register_bound(connection_id, connection_act.grant_id.clone())
        .expect("register after-Local production delivery owner");
    waker
}

fn settled_sessions_state() -> AuthModeStateRecord {
    AuthModeStateRecord {
        format_version: crate::auth::mode::AUTH_MODE_FORMAT_VERSION,
        transition_generation: 7,
        active: AuthMode::Sessions,
        desired: AuthMode::Sessions,
        mode_state: AuthModeStatus::Settled,
        app_data_availability: AppDataAvailability::Available,
        sessions_ever_activated: true,
        active_deployment: Some(sessions_deployment()),
        requested_deployment: None,
        quarantine: None,
    }
}

fn activate_test_sessions(state: AppState) -> AppState {
    state
        .with_auth_runtime_facts(
            settled_sessions_state(),
            AuthProgramReadiness::new(true, true, true, true, true, true, true),
        )
        .expect("activate composed sessions runtime")
}

fn pending_sessions_state(quarantined: bool) -> AuthModeStateRecord {
    let generation = 8;
    AuthModeStateRecord {
        format_version: crate::auth::mode::AUTH_MODE_FORMAT_VERSION,
        transition_generation: generation,
        active: AuthMode::Dev,
        desired: AuthMode::Sessions,
        mode_state: if quarantined {
            AuthModeStatus::Quarantined
        } else {
            AuthModeStatus::PendingRestart
        },
        app_data_availability: AppDataAvailability::RefusedPending,
        sessions_ever_activated: false,
        active_deployment: None,
        requested_deployment: Some(sessions_deployment()),
        quarantine: quarantined.then(|| AuthModeQuarantine {
            transition_generation: generation,
            code: "SNAPBACK_AUTH_POLICY_UNAVAILABLE".to_owned(),
        }),
    }
}

async fn mint_test_credential(state: &AppState, email: &str) -> serde_json::Value {
    let provider = state
        .auth_provider
        .clone()
        .expect("installed auth provider");
    let admission = provider.admit_email(email).await.expect("admit test email");
    let route_admission = test_route_admission(state).0;
    let issue =
        super::coordinated_mint_session(state, &provider, admission, &route_admission, None)
            .await
            .expect("mint test session");
    let (credential, _committed_revocation) = issue.into_parts();
    serde_json::to_value(credential).expect("serialize test credential")
}

fn auth_provider_headers(bearer: Option<&str>) -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    if let Some(bearer) = bearer {
        headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {bearer}")).expect("bearer header"),
        );
    }
    headers
}

fn test_route_admission(state: &AppState) -> Extension<AdmissionLease> {
    Extension(
        state
            .auth_admission_controller()
            .admit_for_mode(state.auth_mode_state().active)
            .expect("admit direct handler test route"),
    )
}

fn leased_outbox_http_response(
    state: &AppState,
    connection_act: super::PreparedConnectionAct,
    payload: &[u8],
) -> axum::response::Response {
    state
        .ephemeral
        .enqueue_durable_for_test(&connection_act.connection_id, payload.to_vec());
    leased_queued_outbox_http_response(state, connection_act)
}

fn leased_bound_outbox_http_response(
    state: &AppState,
    connection_act: super::PreparedConnectionAct,
    payload: &[u8],
) -> axum::response::Response {
    state.ephemeral.enqueue_durable_bound_for_test(
        &connection_act.connection_id,
        payload.to_vec(),
        connection_act.effect_fence(),
    );
    leased_queued_outbox_http_response(state, connection_act)
}

fn leased_queued_outbox_http_response(
    state: &AppState,
    connection_act: super::PreparedConnectionAct,
) -> axum::response::Response {
    state
        .ephemeral
        .touch_connection(&connection_act.connection_id);
    let (epoch_now_ms, monotonic_now) = super::auth_runtime_now(state);
    let admitted = connection_act
        .try_act(&state.connections, epoch_now_ms, monotonic_now, || {
            Ok(state
                .ephemeral
                .drain_outbox_for_send_bound_if_active(
                    &connection_act.connection_id,
                    &connection_act.effect_fence(),
                )
                .expect("fixture connection remains active"))
        })
        .expect("select an exact leased HTTP batch");
    assert_eq!(admitted.len(), 1, "fixture selects one durable frame");
    let mut permits = Vec::new();
    let mut leases = Vec::new();
    let envelopes = admitted
        .into_iter()
        .map(|admitted| {
            let (envelope, permit, lease) = admitted.into_leased_parts();
            permits.extend(permit);
            leases.push(lease);
            envelope.into_poll_lane_frame()
        })
        .collect::<Vec<_>>();
    let mut response = Json(envelopes).into_response();
    super::retain_realtime_handoff_in(
        &mut response,
        permits,
        leases,
        Some(super::RetainedConnectionHandoff {
            connections: state.connections.clone(),
            ephemeral: state.ephemeral.clone(),
            connection_act,
            auth_provider: state.auth_provider.clone(),
        }),
    );
    let admission = test_route_admission(state).0;
    let policy = super::route_registry()
        .into_iter()
        .find(|spec| spec.path == "/outbox/{connection_id}")
        .expect("registered outbox route")
        .effective_for(state.active_policy_auth_mode());
    finish_registered_response(policy, response, Some(&admission), None)
}

fn prepare_session_connection_act(
    state: &AppState,
    bearer: &str,
    connection_id: &str,
) -> (super::OpenedConnectionGrant, super::PreparedConnectionAct) {
    let provider = state.auth_provider.as_ref().expect("provider");
    let coordinator = state.auth_coordinator.as_ref().expect("coordinator");
    let epoch_now_ms = provider.now_ms();
    let monotonic_now = provider.monotonic_now();
    let prepared = super::prepare_connection_open_authority(
        state,
        super::PresentedSessionBearer::Candidate(bearer),
        epoch_now_ms,
        monotonic_now,
    )
    .expect("prepare session connection authority");
    let opened = state
        .connections
        .open_prepared(super::ConnectionOpenAttempt::new(
            Some(connection_id.to_owned()),
            None,
            true,
            prepared,
            epoch_now_ms,
            monotonic_now,
            None,
        ))
        .expect("open session connection");
    let connection_act = state
        .connections
        .prepare_act(
            &opened.grant.connection_id,
            Some(&opened.grant.connection_token),
            Some(coordinator.as_ref()),
            false,
            epoch_now_ms,
            monotonic_now,
        )
        .expect("prepare exact session connection act");
    (opened, connection_act)
}

fn prepare_invalidation_session_connection_act(
    state: &AppState,
    bearer: &str,
    connection_id: &str,
) -> (super::OpenedConnectionGrant, super::PreparedConnectionAct) {
    let provider = state.auth_provider.as_ref().expect("provider");
    let coordinator = state.auth_coordinator.as_ref().expect("coordinator");
    let epoch_now_ms = provider.now_ms();
    let monotonic_now = provider.monotonic_now();
    let prepared = super::prepare_connection_open_authority(
        state,
        super::PresentedSessionBearer::Candidate(bearer),
        epoch_now_ms,
        monotonic_now,
    )
    .expect("prepare invalidation session authority");
    let opened = state
        .connections
        .open_prepared(super::ConnectionOpenAttempt::new(
            Some(connection_id.to_owned()),
            None,
            true,
            prepared,
            epoch_now_ms,
            monotonic_now,
            Some(crate::auth::invalidation::AUTH_INVALIDATION_PROTOCOL_VERSION),
        ))
        .expect("open invalidation session connection");
    let connection_act = state
        .connections
        .prepare_act(
            &opened.grant.connection_id,
            Some(&opened.grant.connection_token),
            Some(coordinator.as_ref()),
            false,
            epoch_now_ms,
            monotonic_now,
        )
        .expect("prepare exact invalidation session act");
    assert!(connection_act.authorization_invalidation.is_some());
    (opened, connection_act)
}

async fn direct_outbox_http_response(
    state: &AppState,
    connection_act: &super::PreparedConnectionAct,
) -> Result<axum::response::Response, super::ApiError> {
    let admission = test_route_admission(state).0;
    let authority = InvocationGate::prepare_admitted_subjectless_authority(
        InvocationSource::OutboxDrain,
        AuthMode::Sessions,
        state.server.profile,
        admission.clone(),
        &WireAuthorityFields::default(),
        connection_act.resolved.clone(),
        test_session_claims_for(&connection_act.resolved),
    )
    .expect("prepare direct outbox authority")
    .with_fenced_publication(connection_act.bound.publication().clone());
    let response = super::drain_outbox(
        State(state.clone()),
        Extension(authority.clone()),
        Extension(connection_act.clone()),
        Extension(admission.clone()),
        axum::extract::Path(connection_act.connection_id.clone()),
    )
    .await?;
    let policy = super::route_registry()
        .into_iter()
        .find(|spec| spec.path == "/outbox/{connection_id}")
        .expect("registered outbox route")
        .effective_for(PolicyAuthMode::Sessions);
    Ok(finish_registered_response(
        policy,
        response,
        Some(&admission),
        Some(&authority),
    ))
}

fn open_registered_session_connection(
    state: &AppState,
    bearer: &str,
    connection_id: &str,
) -> (String, u64, Arc<tokio::sync::Notify>) {
    let provider = state.auth_provider.as_ref().expect("provider");
    let epoch_now_ms = provider.now_ms();
    let monotonic_now = provider.monotonic_now();
    let prepared = super::prepare_connection_open_authority(
        state,
        super::PresentedSessionBearer::Candidate(bearer),
        epoch_now_ms,
        monotonic_now,
    )
    .expect("prepare session-bound connection authority");
    let opened = state
        .connections
        .open_prepared(super::ConnectionOpenAttempt::new(
            Some(connection_id.to_owned()),
            None,
            true,
            prepared,
            epoch_now_ms,
            monotonic_now,
            None,
        ))
        .expect("open session-bound connection grant");
    let (registration_generation, waker) = state
        .ephemeral
        .delivery_notifier()
        .register_bound(&opened.grant.connection_id, opened.grant_id)
        .expect("register exact session-bound socket");
    (opened.grant.connection_id, registration_generation, waker)
}

async fn assert_revocation_terminalized(
    state: &AppState,
    connection_id: &str,
    registration_generation: u64,
    waker: &tokio::sync::Notify,
    expected_disposition: crate::live_wire::LiveAuthorityDisposition,
) {
    tokio::time::timeout(Duration::from_secs(1), waker.notified())
        .await
        .expect("known-committed revocation wakes the exact socket");
    let notifier = state.ephemeral.delivery_notifier();
    let event = notifier
        .terminal_if_current(connection_id, registration_generation)
        .expect("known-committed revocation installs a terminal event");
    assert_eq!(
        event.code,
        crate::live_wire::LiveAuthErrorCode::SessionExpired
    );
    assert_eq!(event.reason, crate::live_wire::LiveAuthErrorReason::Revoked);
    assert_eq!(event.authority_disposition, expected_disposition);
    assert!(
        event.close_by <= Instant::now() + crate::auth::session_projection::TERMINAL_CLOSE_GRACE,
        "terminal close remains inside the five-second protocol bound"
    );
    assert!(!notifier.is_deliverable(connection_id, registration_generation));
    let registry = state.connections.lock();
    assert!(!registry.grants.contains_key(connection_id));
    registry.assert_grant_indexes_consistent();
}

fn prepared_provider_route_authority(
    state: &AppState,
    source: InvocationSource,
    bearer: &str,
) -> Extension<PreparedAuthority> {
    assert!(matches!(
        source,
        InvocationSource::AuthRefresh | InvocationSource::AuthLogout
    ));
    let provider = state.auth_provider.as_ref().expect("provider");
    let coordinator = state.auth_coordinator.as_ref().expect("coordinator");
    let prepared = coordinator
        .resolve_family_bearer(bearer, provider.now_ms(), provider.monotonic_now())
        .expect("resolve provider-route bearer through projection");
    let (resolved, publication) = prepared.into_parts();
    let session_claims = test_session_claims_for(&resolved);
    Extension(
        InvocationGate::prepare_admitted_subjectless_authority(
            source,
            AuthMode::Sessions,
            state.server.profile,
            test_route_admission(state).0,
            &WireAuthorityFields::default(),
            resolved,
            session_claims,
        )
        .expect("prepare provider-route authority")
        .with_fenced_publication(publication),
    )
}

fn auth_http_request(
    method: &str,
    uri: &str,
    body: Vec<u8>,
    content_type: bool,
    admin: Option<&str>,
    impersonation: Option<&str>,
) -> Request<Body> {
    let mut builder = Request::builder().method(method).uri(uri);
    if content_type {
        builder = builder.header(header::CONTENT_TYPE, "application/json");
    }
    if let Some(admin) = admin {
        builder = builder.header("x-snapback-admin-token", admin);
    }
    if let Some(impersonation) = impersonation {
        builder = builder.header(IMPERSONATION_CAPABILITY_HEADER, impersonation);
    }
    // Every auth-surface test request is stamped with the terminator
    // facts. A hosted target requires them (see `via_hosted_terminator`);
    // a local target derives its source from the peer and ignores the
    // forwarded header, so for local tests this doubles as proof that a
    // client-spoofed header carries no authority.
    via_hosted_terminator(
        builder.body(Body::from(body)).expect("auth HTTP request"),
        TEST_HOSTED_CLIENT_SOURCE,
    )
}

fn offer_auth_client_protocol(request: &mut Request<Body>) {
    request.headers_mut().insert(
        HeaderName::from_static("x-snapback-auth-client-protocol"),
        HeaderValue::from_static("1"),
    );
}

/// The one simulated end-client address for hosted tests whose intent is
/// a single source. Tests about per-source bucket identity pass their own
/// distinct-or-shared addresses instead.
const TEST_HOSTED_CLIENT_SOURCE: &str = "198.51.100.7";

/// Stamp onto a request the two facts the in-namespace TLS terminator
/// supplies on every real hosted request: a loopback immediate peer and
/// exactly one `x-forwarded-for` naming the end client.
///
/// @ref LLP 0098#6-effective-source-under-this-topology — under loopback
/// termination the immediate peer is ALWAYS the terminator, so a hosted
/// request without the terminator-supplied header fails closed
/// (SNAPBACK_AUTH_SOURCE_UNTRUSTED); falling back to the peer instead
/// would collapse LLP 0060 D3's five throttle buckets onto one source.
/// Tests must therefore supply what the terminator supplies, choosing one
/// source per simulated client.
fn via_hosted_terminator(mut request: Request<Body>, client_source: &str) -> Request<Body> {
    request.headers_mut().insert(
        HeaderName::from_static(crate::auth::effective_source::FORWARDED_HEADER),
        HeaderValue::from_str(client_source).expect("hosted client source header"),
    );
    request.extensions_mut().insert(ConnectInfo(
        "127.0.0.1:443"
            .parse::<std::net::SocketAddr>()
            .expect("loopback terminator peer"),
    ));
    request
}

/// Builder-chain form of [`via_hosted_terminator`]. Unlike the request
/// form (whose `insert` replaces), the builder form *appends* the header,
/// so apply it exactly once per chain — a duplicated header is a conflict
/// and fails closed by design.
trait ViaHostedTerminator {
    fn via_hosted_terminator(self, client_source: &str) -> Self;
}

impl ViaHostedTerminator for axum::http::request::Builder {
    fn via_hosted_terminator(self, client_source: &str) -> Self {
        self.header(
            crate::auth::effective_source::FORWARDED_HEADER,
            client_source,
        )
        .extension(ConnectInfo(
            "127.0.0.1:443"
                .parse::<std::net::SocketAddr>()
                .expect("loopback terminator peer"),
        ))
    }
}

fn session_auth_http_request(uri: &str, body: Vec<u8>, bearer: &str) -> Request<Body> {
    let mut request = auth_http_request("POST", uri, body, true, None, None);
    offer_auth_client_protocol(&mut request);
    request.headers_mut().insert(
        header::AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {bearer}")).expect("bearer header"),
    );
    request
}

async fn bounded_oneshot_for_deadlock_regression(
    router: SnapbackApp,
    request: Request<Body>,
    deadlock_message: &'static str,
) -> axum::response::Response {
    // A timeout around `Router::oneshot` itself cannot preempt a synchronous
    // mutex block inside the future's poll. Isolate the request on a plain
    // thread and bound only the result channel so re-entry fails cleanly.
    let (result_tx, result_rx) = tokio::sync::oneshot::channel();
    let worker = std::thread::spawn(move || {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("deadlock regression request runtime");
        let _ = result_tx.send(runtime.block_on(router.oneshot(request)));
    });
    let response = tokio::time::timeout(Duration::from_secs(2), result_rx)
        .await
        .expect(deadlock_message)
        .expect("deadlock regression request worker must report its result")
        .expect("deadlock regression router response");
    worker
        .join()
        .expect("deadlock regression request worker exits");
    response
}

fn password_auth_http_request(uri: &str, body: Value) -> Request<Body> {
    let key = (uri == "/auth/guest").then(|| format!("guest-test-{}", uuid::Uuid::now_v7()));
    password_auth_http_request_with_idempotency(uri, body, key.as_deref())
}

fn password_auth_http_request_with_idempotency(
    uri: &str,
    body: Value,
    idempotency_key: Option<&str>,
) -> Request<Body> {
    let mut request = auth_http_request(
        "POST",
        uri,
        serde_json::to_vec(&body).expect("password auth request body"),
        true,
        None,
        None,
    );
    if let Some(idempotency_key) = idempotency_key {
        request.headers_mut().insert(
            "idempotency-key",
            idempotency_key.parse().expect("guest idempotency header"),
        );
    }
    offer_auth_client_protocol(&mut request);
    request
}

fn assert_credential_shape(credential: &Value, recovery_codes: bool, provider: &str) {
    let mut expected = BTreeSet::from([
        "authorityDescriptor".to_owned(),
        "refreshAfter".to_owned(),
        "session".to_owned(),
        "token".to_owned(),
        "tokenType".to_owned(),
    ]);
    if recovery_codes {
        expected.insert("recoveryCodes".to_owned());
    }
    assert_eq!(
        credential
            .as_object()
            .expect("credential response object")
            .keys()
            .cloned()
            .collect::<BTreeSet<_>>(),
        expected,
        "credential response shape: {credential}"
    );
    assert_eq!(credential["tokenType"], "Bearer");
    assert_eq!(credential["session"]["provider"], provider);
    assert_eq!(credential["authorityDescriptor"]["descriptorVersion"], 1);
    assert!(
        credential["authorityDescriptor"]["authorityInstanceId"]
            .as_str()
            .is_some_and(|value| value.starts_with("aut_"))
    );
    if recovery_codes {
        assert!(
            credential["recoveryCodes"]
                .as_array()
                .is_some_and(|codes| !codes.is_empty())
        );
    }
}

fn assert_password_credential_shape(credential: &Value, recovery_codes: bool) {
    assert_credential_shape(credential, recovery_codes, "local-password");
}

fn agent_registration_http_request(body: Value) -> Request<Body> {
    let mut request = auth_http_request(
        "POST",
        "/auth/agents/register",
        serde_json::to_vec(&body).expect("agent registration body"),
        true,
        None,
        None,
    );
    offer_auth_client_protocol(&mut request);
    request
}

fn agent_policy(mode: AgentsMode, invited_by: InvitedBy) -> AgentsManifest {
    AgentsManifest::explicit(mode, invited_by)
}

async fn request_user_agent_invitation(
    state: &AppState,
    router: &SnapbackApp,
    bearer: &str,
) -> axum::response::Response {
    let request = prepared_user_agent_invitation_request(state, router, bearer).await;
    router
        .clone()
        .oneshot(request)
        .await
        .expect("mint user agent invitation")
}

async fn prepared_user_agent_invitation_request(
    state: &AppState,
    router: &SnapbackApp,
    bearer: &str,
) -> Request<Body> {
    let challenge = router
        .clone()
        .oneshot(session_auth_http_request(
            "/auth/step-up/request",
            serde_json::to_vec(&json!({ "operation": "agentInvitation" })).unwrap(),
            bearer,
        ))
        .await
        .expect("request agent-invitation step-up");
    assert_eq!(challenge.status(), StatusCode::OK);
    let challenge = response_json(challenge).await;
    let challenge_id = challenge["challengeId"]
        .as_str()
        .expect("agent-invitation challenge id")
        .to_owned();
    let provider = state.auth_provider.as_ref().expect("test auth provider");
    let mailbox = serde_json::to_value(
        provider
            .mailbox_entry(&challenge_id)
            .await
            .expect("agent-invitation mailbox entry"),
    )
    .unwrap();
    let code = mailbox["code"]
        .as_str()
        .expect("agent-invitation step-up code");
    session_auth_http_request(
        "/auth/agent-invitations",
        serde_json::to_vec(&json!({
            "stepUp": { "challengeId": challenge_id, "code": code }
        }))
        .unwrap(),
        bearer,
    )
}

async fn mint_user_agent_invitation(state: &AppState, router: &SnapbackApp, bearer: &str) -> Value {
    let minted = request_user_agent_invitation(state, router, bearer).await;
    let status = minted.status();
    let minted = response_json(minted).await;
    assert_eq!(status, StatusCode::OK, "{minted}");
    minted
}

fn session_auth_get_request(uri: &str, bearer: &str) -> Request<Body> {
    let mut request = auth_http_request("GET", uri, Vec::new(), false, None, None);
    offer_auth_client_protocol(&mut request);
    request.headers_mut().insert(
        header::AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {bearer}")).expect("bearer header"),
    );
    request
}

async fn response_json(response: axum::response::Response) -> serde_json::Value {
    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read auth HTTP response");
    serde_json::from_slice(&bytes).expect("auth HTTP JSON response")
}

async fn password_test_email_challenge(
    router: &SnapbackApp,
    provider: &Arc<AuthProvider>,
    email: &str,
) -> (String, String) {
    let requested = router
        .clone()
        .oneshot(password_auth_http_request(
            "/auth/request-code",
            json!({ "email": email }),
        ))
        .await
        .expect("request password-test email challenge");
    assert_eq!(requested.status(), StatusCode::OK);
    let challenge_id = response_json(requested).await["challengeId"]
        .as_str()
        .expect("password-test challenge id")
        .to_owned();
    let mailbox = serde_json::to_value(
        provider
            .mailbox_entry(&challenge_id)
            .await
            .expect("password-test capture mailbox"),
    )
    .expect("serialize password-test mailbox");
    let code = mailbox["code"]
        .as_str()
        .expect("password-test email code")
        .to_owned();
    (challenge_id, code)
}

async fn password_test_email_exchange(
    router: &SnapbackApp,
    provider: &Arc<AuthProvider>,
    email: &str,
) -> Value {
    let (challenge_id, code) = password_test_email_challenge(router, provider, email).await;
    let exchanged = router
        .clone()
        .oneshot(password_auth_http_request(
            "/auth/exchange",
            json!({ "challengeId": challenge_id, "code": code }),
        ))
        .await
        .expect("exchange password-test email challenge");
    let status = exchanged.status();
    let body = response_json(exchanged).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body
}

async fn request_hosted_sender_challenge(
    router: &SnapbackApp,
    provider: &Arc<AuthProvider>,
    email: &str,
) -> (String, String) {
    let mut request = auth_http_request(
        "POST",
        "/auth/request-code",
        serde_json::to_vec(&json!({ "email": email })).unwrap(),
        true,
        None,
        None,
    );
    offer_auth_client_protocol(&mut request);
    let response = router
        .clone()
        .oneshot(request)
        .await
        .expect("request hosted sender challenge");
    assert_eq!(response.status(), StatusCode::OK);
    let challenge_id = response_json(response).await["challengeId"]
        .as_str()
        .expect("hosted sender challenge id")
        .to_owned();
    let mailbox =
        serde_json::to_value(provider.mailbox_entry(&challenge_id).await.unwrap()).unwrap();
    let code = mailbox["code"]
        .as_str()
        .expect("hosted sender mailbox code")
        .to_owned();
    (challenge_id, code)
}

async fn hosted_sender_exchange_response(
    router: &SnapbackApp,
    challenge_id: &str,
    code: &str,
    public_jwk: Value,
    proof: &str,
) -> axum::response::Response {
    let mut request = auth_http_request(
        "POST",
        "/auth/exchange",
        serde_json::to_vec(&json!({
            "challengeId": challenge_id,
            "code": code,
            "senderConstraint": {
                "protocol": "snapback.sender-issuance.v2",
                "publicJwk": public_jwk,
                "proof": proof,
            },
        }))
        .unwrap(),
        true,
        None,
        None,
    );
    offer_auth_client_protocol(&mut request);
    router
        .clone()
        .oneshot(request)
        .await
        .expect("exchange hosted sender challenge")
}

fn sender_issuance_durable_counts(
    state: &AppState,
    challenge_id: &str,
) -> (i64, i64, i64, i64, i64) {
    let mut snapback = state
        .snapback
        .try_lock()
        .expect("borrow sender issuance durable facts");
    snapback
        .remainder_auth_fixture()
        .auth_catalog()
        .sender_issuance_durable_counts_for_test(challenge_id)
        .expect("read sender issuance durable facts")
}

fn dev_downgrade_pair() -> (SchemaManifest, FunctionManifest) {
    let inputs_hash = format!("sha256:{}", "c".repeat(64));
    let schema = SchemaManifest {
        schema_version: "snapback.v0".to_owned(),
        app_id: "auth-activation-fixture".to_owned(),
        schema_hash: Some(format!("sha256:{}", "a".repeat(64))),
        inputs_hash: Some(inputs_hash.clone()),
        tables: vec![TableManifest {
            name: "items".to_owned(),
            fields: vec![FieldManifest {
                name: "value".to_owned(),
                field_type: FieldType::String,
                optional: false,
            }],
            indexes: Vec::new(),
            syncable: true,
            permission_backing: false,
            permission_fields: None,
            search_indexes: Vec::new(),
            vector_indexes: Vec::new(),
            search_live_limits: None,
            membership: None,
            authority_profile: None,
            asset_sharing: None,
            visibility: None,
            history: None,
        }],
        ..SchemaManifest::default()
    };
    let mut functions = activation_functions('a', false);
    functions.schema_version = "snapback.v0".to_owned();
    functions.bundle_hash = Some(format!("sha256:{}", "b".repeat(64)));
    functions.inputs_hash = Some(inputs_hash);
    (schema, functions)
}

fn legacy_v0_activation_bypass_manifest() -> FunctionManifest {
    FunctionManifest {
        schema_version: "snapback.v0".to_owned(),
        app_id: "auth-activation-fixture".to_owned(),
        bundle_hash: Some("sha256:legacy-raw-load-would-accept".to_owned()),
        inputs_hash: Some("sha256:legacy-raw-inputs".to_owned()),
        functions: vec![FunctionDefinition::new(
            "listItems",
            FunctionKind::Query,
            FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
                table_visibility: None,
                table: "items".to_owned(),
                filters: Vec::new(),
                order: Vec::new(),
                limit: None,
                membership_filters: Vec::new(),
                indexed_by: None,
            })),
        )],
        ..FunctionManifest::default()
    }
}

/// A request body that never finishes arriving (ENG-24988). The trickled
/// upload owns a managed admission root, so without a monotonic ingest
/// deadline it would retain that root indefinitely and force every
/// auth-mode activation into `SNAPBACK_AUTH_MODE_QUIESCENCE_TIMEOUT`.
fn stalled_admitted_request(uri: &str) -> Request<Body> {
    let stalled =
        futures_util::stream::iter([Ok::<_, std::io::Error>(Bytes::from_static(br#"{"args":"#))])
            .chain(futures_util::stream::pending());
    let mut request = Request::builder()
        .method("POST")
        .uri(uri)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from_stream(stalled))
        .expect("stalled admitted request");
    offer_auth_client_protocol(&mut request);
    request
}

// @ref LLP 0058#admitted-body-ingestion — the ingest deadline is exact,
// monotonic, and strictly below the 30000 ms quiescence deadline.

// @ref LLP 0058#admitted-body-ingestion — closing the admitted epoch
// cancels in-flight body buffering and releases the root without waiting
// for the client to disconnect, so staging's drain cannot be starved.

/// Hosted sessions fixture with published functions across the closed
/// `authRequirement` range: `listNotes`/`appendNote` are `authenticated`
/// (the LLP 0077 D-1 probe shape), `listOptionalNotes` keeps the
/// `optional-user` default, and `listPublicNotes` is declared `public`.
fn hosted_function_route_state() -> AppState {
    let (mut state, _) = auth_runtime_fixture_with(PolicyAuthMode::Sessions, |snapback| {
        snapback
            .apply_schema(SchemaManifest {
                tables: vec![TableManifest {
                    name: "notes".to_owned(),
                    fields: vec![FieldManifest {
                        name: "text".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    }],
                    indexes: Vec::new(),
                    syncable: true,
                    permission_backing: false,
                    permission_fields: None,
                    search_indexes: Vec::new(),
                    vector_indexes: Vec::new(),
                    search_live_limits: None,
                    membership: None,
                    authority_profile: None,
                    asset_sharing: None,
                    visibility: None,
                    history: None,
                }],
                ..SchemaManifest::default()
            })
            .expect("apply hosted function fixture schema");
        let notes_query = || {
            FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
                table_visibility: None,
                table: "notes".to_owned(),
                filters: Vec::new(),
                order: Vec::new(),
                limit: None,
                membership_filters: Vec::new(),
                indexed_by: None,
            }))
        };
        let mut authenticated =
            FunctionDefinition::new("listNotes", FunctionKind::Query, notes_query());
        authenticated.auth_requirement = Some(crate::manifest::AuthRequirement::Authenticated);
        let mut append_values = BTreeMap::new();
        append_values.insert("text".to_owned(), ValueExpr::Arg("text".to_owned()));
        let mut authenticated_mutation = FunctionDefinition::new(
            "appendNote",
            FunctionKind::Mutation,
            FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
                owner_write_checks: Vec::new(),
                steps: vec![MutationStep::Insert {
                    table: "notes".to_owned(),
                    values: append_values,
                    bind_id_as: None,
                }],
                return_value: Some(ReturnValue::ChangedCount),
            })),
        );
        authenticated_mutation.auth_requirement =
            Some(crate::manifest::AuthRequirement::Authenticated);
        let optional =
            FunctionDefinition::new("listOptionalNotes", FunctionKind::Query, notes_query());
        let mut public_query =
            FunctionDefinition::new("listPublicNotes", FunctionKind::Query, notes_query());
        public_query.auth_requirement = Some(crate::manifest::AuthRequirement::Public);
        let diagnostics = snapback.load_functions(FunctionManifest {
            bundle_hash: Some("hosted-function-route-fixture".to_owned()),
            functions: vec![
                authenticated,
                authenticated_mutation,
                optional,
                public_query,
            ],
            ..FunctionManifest::default()
        });
        assert!(
            !diagnostics.iter().any(|diagnostic| matches!(
                diagnostic.severity,
                crate::diagnostic::DiagnosticSeverity::Error
                    | crate::diagnostic::DiagnosticSeverity::Fatal
            )),
            "hosted function fixture must load cleanly: {diagnostics:?}",
        );
    });
    Arc::make_mut(&mut state.server).auth_deployment =
        crate::auth::deployment::AuthDeploymentTarget::Hosted;
    let now_ms = state
        .auth_provider
        .as_ref()
        .expect("hosted fixture provider")
        .now_ms();
    state
        .with_hosted_serving_authority(hosted_serving_authority(now_ms))
        .expect("install hosted sender authority")
}

static DEV_ADMISSION_ENV_TEST_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();

struct DevAdmissionEnvironmentRestore {
    posture: Option<std::ffi::OsString>,
    origins: Option<std::ffi::OsString>,
    profile: Option<std::ffi::OsString>,
}

impl DevAdmissionEnvironmentRestore {
    fn capture() -> Self {
        Self {
            posture: std::env::var_os("SNAPBACK_DEV_ADMISSION_POSTURE"),
            origins: std::env::var_os("SNAPBACK_DEV_AUTH_ORIGINS"),
            profile: std::env::var_os("SNAPBACK_PROFILE"),
        }
    }
}

impl Drop for DevAdmissionEnvironmentRestore {
    fn drop(&mut self) {
        for (name, value) in [
            ("SNAPBACK_DEV_ADMISSION_POSTURE", self.posture.take()),
            ("SNAPBACK_DEV_AUTH_ORIGINS", self.origins.take()),
            ("SNAPBACK_PROFILE", self.profile.take()),
        ] {
            match value {
                Some(value) => unsafe { std::env::set_var(name, value) },
                None => unsafe { std::env::remove_var(name) },
            }
        }
    }
}

async fn request_captured_challenge(router: &SnapbackApp, email: &str) -> String {
    let response = router
        .clone()
        .oneshot(auth_http_request(
            "POST",
            "/auth/request-code",
            serde_json::to_vec(&serde_json::json!({"email": email})).unwrap(),
            true,
            None,
            None,
        ))
        .await
        .expect("request capture challenge");
    assert_eq!(response.status(), StatusCode::OK);
    response_json(response).await["challengeId"]
        .as_str()
        .unwrap()
        .to_owned()
}

fn has_test_only_cfg(attributes: &[syn::Attribute]) -> bool {
    attributes.iter().any(|attribute| {
        if !attribute.path().is_ident("cfg") {
            return false;
        }
        let syn::Meta::List(arguments) = &attribute.meta else {
            return false;
        };
        // Skip exact test-only and repository test-support seams. A future
        // `cfg(not(test))` or mixed production feature predicate remains in
        // the conservative inventory merely because it mentions `test`.
        let predicate = arguments.tokens.to_string();
        predicate == "test"
            || predicate == "feature = \"test-support\""
            || predicate == "feature = \"remainder-tests\""
            || predicate == "any (test , feature = \"test-support\")"
            || predicate == "any (test , feature = \"remainder-tests\")"
    })
}

fn item_attributes(item: &syn::Item) -> &[syn::Attribute] {
    match item {
        syn::Item::Const(item) => &item.attrs,
        syn::Item::Enum(item) => &item.attrs,
        syn::Item::ExternCrate(item) => &item.attrs,
        syn::Item::Fn(item) => &item.attrs,
        syn::Item::ForeignMod(item) => &item.attrs,
        syn::Item::Impl(item) => &item.attrs,
        syn::Item::Macro(item) => &item.attrs,
        syn::Item::Mod(item) => &item.attrs,
        syn::Item::Static(item) => &item.attrs,
        syn::Item::Struct(item) => &item.attrs,
        syn::Item::Trait(item) => &item.attrs,
        syn::Item::TraitAlias(item) => &item.attrs,
        syn::Item::Type(item) => &item.attrs,
        syn::Item::Union(item) => &item.attrs,
        syn::Item::Use(item) => &item.attrs,
        _ => &[],
    }
}

#[derive(Default)]
struct SnapbackLiteralVisitor {
    literals: BTreeSet<String>,
}

impl SnapbackLiteralVisitor {
    fn record_literal(&mut self, literal: &str) {
        let bytes = literal.as_bytes();
        let mut cursor = 0;
        while let Some(relative_start) = literal[cursor..].find("SNAPBACK_") {
            let start = cursor + relative_start;
            let mut end = start + "SNAPBACK_".len();
            while end < bytes.len()
                && (bytes[end].is_ascii_uppercase()
                    || bytes[end].is_ascii_digit()
                    || bytes[end] == b'_')
            {
                end += 1;
            }
            self.literals.insert(literal[start..end].to_owned());
            cursor = end;
        }
    }
}

impl<'ast> Visit<'ast> for SnapbackLiteralVisitor {
    fn visit_item(&mut self, item: &'ast syn::Item) {
        if !has_test_only_cfg(item_attributes(item)) {
            syn::visit::visit_item(self, item);
        }
    }

    fn visit_impl_item_fn(&mut self, function: &'ast syn::ImplItemFn) {
        if !has_test_only_cfg(&function.attrs) {
            syn::visit::visit_impl_item_fn(self, function);
        }
    }

    fn visit_stmt_macro(&mut self, invocation: &'ast syn::StmtMacro) {
        if !has_test_only_cfg(&invocation.attrs) {
            syn::visit::visit_stmt_macro(self, invocation);
        }
    }

    fn visit_lit_str(&mut self, literal: &'ast syn::LitStr) {
        self.record_literal(&literal.value());
    }

    fn visit_macro(&mut self, invocation: &'ast syn::Macro) {
        // `syn` deliberately leaves a macro's arguments as tokens. Scan
        // those tokens too so `format!`, `json!`, and helper macros cannot
        // hide a newly emitted diagnostic from the inventory gate.
        self.record_literal(&invocation.tokens.to_string());
        syn::visit::visit_macro(self, invocation);
    }
}

fn rust_sources_below(path: &Path, sources: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(path).expect("read Rust source directory") {
        let path = entry.expect("read Rust source entry").path();
        if path.is_dir() {
            rust_sources_below(&path, sources);
        } else if path.extension().is_some_and(|extension| extension == "rs") {
            // @ref LLP 0225#4-migration-sequence — the
            // cosmetic hub splits preserve `#[cfg(test)]` on each parent
            // module, but a standalone AST parse cannot see that parent
            // cfg and must exclude the four extracted test bodies.
            if path.file_name().is_some_and(|name| {
                name == "tests.rs" || name.to_string_lossy().ends_with("_tests.rs")
            }) || path
                .components()
                .any(|component| component.as_os_str() == "tests")
            {
                continue;
            }
            sources.push(path);
        }
    }
}

fn production_snapback_literals() -> BTreeSet<String> {
    let mut sources = Vec::new();
    let remainder = Path::new(env!("CARGO_MANIFEST_DIR"));
    // Follow the server crate's production path dependencies rather than only
    // its local source tree. Kernel/auth failures can cross the HTTP boundary
    // through `?` without repeating their diagnostic literals in this crate.
    // @ref LLP 0032#phase-1--safety-floor-and-confirmed-defects — the status
    // completeness gate must cover the actual HTTP emission graph.
    for crate_name in [
        "snapback-activation",
        "snapback-auth",
        "snapback-engine",
        "snapback-kernel",
        "snapback-runtime",
        "snapback-server",
        "snapback-services",
        "snapback-sync",
        "snapback-types",
    ] {
        rust_sources_below(
            &remainder.join("../").join(crate_name).join("src"),
            &mut sources,
        );
    }
    // The graph refusal ids are Rust-owned wire vocabulary in snapback-types,
    // while their HTTP projection is owned here. Include that exact registry
    // source so every new graph/query-cost id is forced into one reviewed HTTP
    // family or this file's non-diagnostic exclusions.
    sources.push(remainder.join("../snapback-types/src/manifest/graph.rs"));
    sources.sort();

    let mut visitor = SnapbackLiteralVisitor::default();
    for source in sources {
        let contents = fs::read_to_string(&source).expect("read Rust source");
        let syntax = syn::parse_file(&contents)
            .unwrap_or_else(|error| panic!("parse {}: {error}", source.display()));
        visitor.visit_file(&syntax);
    }
    visitor.literals
}

fn workspace_production_snapback_literals() -> BTreeSet<String> {
    let crates_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let mut sources = Vec::new();
    for entry in fs::read_dir(&crates_dir).expect("read workspace crates directory") {
        let src = entry
            .expect("read workspace crate entry")
            .path()
            .join("src");
        if src.is_dir() {
            rust_sources_below(&src, &mut sources);
        }
    }
    sources.sort();

    let mut visitor = SnapbackLiteralVisitor::default();
    for source in sources {
        let contents = fs::read_to_string(&source).expect("read workspace Rust source");
        let syntax = syn::parse_file(&contents)
            .unwrap_or_else(|error| panic!("parse {}: {error}", source.display()));
        visitor.visit_file(&syntax);
    }
    visitor.literals
}

// These are the only production `SNAPBACK_*` literals that are not
// diagnostic codes. Keep the reason beside each exclusion: the source
// inventory is intentionally broad enough to catch literals passed through
// helper constructors, embedded runtime source, and macros.
const NON_DIAGNOSTIC_SNAPBACK_LITERALS: &[(&str, &str)] = &[
    (
        "SNAPBACK_RUNTIME_COST_RECORDER",
        "LLP 0267 §7.1 dev-on posture environment flag supplied by managed snapback dev; it is not an HTTP diagnostic",
    ),
    (
        "SNAPBACK_GRAPH_QUALIFICATION_DERIVATION_MISSING",
        "LLP 0209 qualification-runner failure vocabulary; it is not an HTTP diagnostic",
    ),
    (
        "SNAPBACK_GRAPH_QUALIFICATION_CORPUS_MISMATCH",
        "LLP 0209 qualification-runner failure vocabulary; it is not an HTTP diagnostic",
    ),
    (
        "SNAPBACK_QUERY_COST_INDEX_REQUIRED",
        "LLP 0209 evaluation-time materialized-result vocabulary; Stage B has no graph executor or HTTP producer",
    ),
    (
        "SNAPBACK_QUERY_COST_PAGINATION_REQUIRED",
        "LLP 0209 evaluation-time materialized-result vocabulary; Stage B has no graph executor or HTTP producer",
    ),
    (
        "SNAPBACK_QUERY_COST_BOUND_EXCEEDED",
        "LLP 0209 evaluation-time materialized-result vocabulary; Stage B has no graph executor or HTTP producer",
    ),
    (
        "SNAPBACK_QUERY_COST_LIVE_TURN_REFUSED",
        "LLP 0209 evaluation-time materialized-result vocabulary; Stage B has no graph executor or HTTP producer",
    ),
    (
        "SNAPBACK_QUERY_COST_EVIDENCE_REQUIRED",
        "LLP 0209 evaluation-time materialized-result vocabulary; Stage B has no graph executor or HTTP producer",
    ),
    (
        "SNAPBACK_DEV_IDENTITY_CAPABILITY_MISSING",
        "operator-stderr migration warning for an unwitnessed legacy developer assertion; never an HTTP diagnostic",
    ),
    (
        "SNAPBACK_ELEVATED_READ_TRACE",
        "environment variable enabling elevated-read trace capture; never an HTTP diagnostic",
    ),
    (
        "SNAPBACK_VISIBILITY_GOVERNANCE_TARGET_CONFIG",
        "environment variable locating visibility-governance target configuration; never an HTTP diagnostic",
    ),
    (
        "SNAPBACK_DEV_AUTH_ORIGINS",
        "comma-separated exact loopback-origin configuration for Dev browser body authority; never an HTTP diagnostic",
    ),
    (
        "SNAPBACK_DEV_ADMISSION_POSTURE",
        "spawn-owned environment variable selecting the LLP 0301 development origin posture; never an HTTP diagnostic",
    ),
    (
        "SNAPBACK_HANDLER_ERROR_EXPOSURE",
        "environment variable selecting redacted versus development handler-error rendering; never an HTTP diagnostic",
    ),
    (
        "SNAPBACK_LIVE_EVALUATION_TASK_FAILED",
        "scheduler-health structured-log code; it is never emitted in an HTTP response",
    ),
    (
        "SNAPBACK_LIVE_EVALUATION_TIMEOUT",
        "scheduler-health structured-log and live resync reason; it is never emitted as an HTTP diagnostic",
    ),
    (
        "SNAPBACK_LIVE_MAX_EVAL_TURN_MS",
        "positive millisecond bound for one scheduled live subscription evaluation turn (default 30000; LLP 0200 Phase 1)",
    ),
    (
        "SNAPBACK_LIVE_OVERLOAD_DEGRADE",
        "scheduler-health attached diagnostic and spike-trace code; it is never emitted in an HTTP response",
    ),
    (
        "SNAPBACK_LIVE_SCHEDULER_DISABLED",
        "environment variable restoring legacy inline live fan-out for settlement-isolation A/B measurement (LLP 0200 Phase 1)",
    ),
    (
        "SNAPBACK_LIVE_EVAL_MEMO_DISABLED",
        "environment variable disabling same-principal live-evaluation memoization as the D2-H1 control arm (LLP 0209 G1)",
    ),
    (
        "SNAPBACK_GRAPH_DELTA_DISABLED",
        "environment variable disabling the LLP 0209 G3 graph-delta delivery lane for its replace-lane control arm; never an HTTP diagnostic",
    ),
    (
        "SNAPBACK_GRAPH_DELTA_CONVERGENCE",
        "environment variable controlling the LLP 0209 G3 served-path shadow convergence policy: 0 opts out, 1 checks every delivery, and the unset default checks all debug deliveries plus a deterministic release sample; never an HTTP diagnostic",
    ),
    (
        "SNAPBACK_SPIKE_TRACE",
        "environment variable enabling the measurement-only A/B trace (LLP 0200 §3); never an HTTP diagnostic",
    ),
    (
        "SNAPBACK_SPIKE_TRACE_OPEN_FAILED",
        "stderr-only startup warning when the measurement trace path cannot be appended; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_",
        "diagnostic-code prefix validated by the durable auth-mode parser",
    ),
    (
        "SNAPBACK_AUTH_",
        "CLI machine-mode classifier prefix, not a concrete diagnostic code",
    ),
    (
        "SNAPBACK_ASSET_",
        "diagnostic-code family prefix appearing in detail-shape doc text (LLP 0044); concrete codes are classified individually",
    ),
    (
        "SNAPBACK_NETWORK_PROFILE",
        "environment variable selecting the startup network condition profile (LLP 0167)",
    ),
    (
        "SNAPBACK_AGENT_SAFE_IMPLEMENTATION_SHA256",
        "environment variable binding an agent-safe performance worker to the qualified implementation digest (LLP 0162)",
    ),
    (
        "SNAPBACK_READY_DESCRIPTOR_REQUIRED",
        "CLI-local detached-start lifecycle diagnostic; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_ADMIN_LINK_READY_FILE_INVALID",
        "CLI-local admin-link observation diagnostic; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_CLI_FAILED",
        "native CLI machine-envelope fallback; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_CONTROL_OPERATION_UNKNOWN",
        "CLI-local control-catalog lookup diagnostic; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_WAIT_RECEIPT_INVALID",
        "CLI-local host.wait receipt validation diagnostic; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_WAIT_TIMEOUT",
        "CLI-local host.wait timeout diagnostic; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_WAIT_UNVERIFIABLE",
        "CLI-local host.wait observation diagnostic; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_HOST_RESTART_ADMIN_CREDENTIAL_REQUIRED",
        "CLI-local composed-restart authority diagnostic; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_HOST_RESTART_READY_INVALID",
        "CLI-local replacement-readiness diagnostic; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_HOST_RESTART_START_FAILED",
        "CLI-local replacement-spawn diagnostic; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_HOST_RESTART_START_TIMEOUT",
        "CLI-local replacement-readiness timeout diagnostic; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_HOST_RESTART_STOP_TIMEOUT",
        "CLI-local verified-stop timeout diagnostic; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_FORK_SERVER_RENEWAL_OBSERVED",
        "stderr-only fork-watchdog observation marker; never emitted as an HTTP diagnostic",
    ),
    // @ref LLP 0184#product-contract-what-agent-accessible-means — the
    // config.set value carrier and its transport remain CLI-only in v1.
    (
        "SNAPBACK_CONFIG_SET_FAILED",
        "CLI-local config.set HTTP-refusal fallback; the server's actual diagnostic, when present, is classified separately",
    ),
    (
        "SNAPBACK_CONFIG_SET_REQUEST_FAILED",
        "CLI-local config.set transport diagnostic; no HTTP response was received",
    ),
    (
        "SNAPBACK_CONFIG_SET_RESPONSE_INVALID",
        "CLI-local config.set response-envelope validation diagnostic; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_CONFIG_SET_USAGE_INVALID",
        "CLI-local config.set argument/value-carrier diagnostic; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_CONFIG_VALUE_FD_INVALID",
        "CLI-local config.set inherited-descriptor diagnostic; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_CONFIG_VALUE_FD_UNSUPPORTED",
        "CLI-local config.set host-capability diagnostic; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_CONFIG_VALUE_READ_FAILED",
        "CLI-local config.set value-carrier read diagnostic; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_CONFIG_VALUE_TOO_LARGE",
        "CLI-local config.set value-carrier bound diagnostic; never emitted by the Snapback HTTP server",
    ),
    // @ref LLP 0227#surface-routes-cli-verbs-client-methods — password and
    // session-token carriers are CLI-local; route failures retain the real
    // server diagnostic when one exists.
    (
        "SNAPBACK_AUTH_PASSWORD_CARRIER_INVALID",
        "CLI-local password secret-carrier diagnostic; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_AUTH_SESSION_TOKEN_CARRIER_INVALID",
        "CLI-local session-token secret-carrier diagnostic; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_PASSWORD",
        "dev/test-only environment variable carrying password input for the native CLI; never emitted as an HTTP diagnostic",
    ),
    (
        "SNAPBACK_AUTH_CLI_FAILED",
        "CLI-local password/recovery HTTP-refusal fallback; the server's actual diagnostic, when present, is classified separately",
    ),
    (
        "SNAPBACK_AUTH_CLI_REQUEST_FAILED",
        "CLI-local password/recovery transport diagnostic; no HTTP response was received",
    ),
    (
        "SNAPBACK_AUTH_CLI_RESPONSE_INVALID",
        "CLI-local password/recovery success-envelope diagnostic; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_EPHEMERAL_OPERATOR_DELETE_READY_FILE_REQUIRED",
        "CLI-local operator-delete process-binding diagnostic; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_ACTION_MAX_CONCURRENCY",
        "environment variable configuring detached action worker admission",
    ),
    (
        "SNAPBACK_ACTION_STREAM_",
        "diagnostic-code family prefix matched by the out-of-band stream-refusal recorder (LLP 0076)",
    ),
    (
        "SNAPBACK_ACTION_SECRETS",
        "legacy environment variable containing action secrets",
    ),
    (
        "SNAPBACK_ACTION_TIMEOUT_MS",
        "environment variable configuring the action watchdog",
    ),
    (
        "SNAPBACK_ADMIN_DIST",
        "environment variable naming the built admin snapshot",
    ),
    (
        "SNAPBACK_ADMIN_LAN_BIND_FAILED",
        "CLI-local managed-LAN lifecycle diagnostic; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_ADMIN_LAN_CLEARTEXT",
        "CLI-local ruled-cleartext warning marker; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_ADMIN_LAN_HOST_UNSUPPORTED",
        "CLI-local managed-LAN capability diagnostic; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_ADMIN_LAN_INTERFACE_AMBIGUOUS",
        "CLI-local managed-LAN selection diagnostic; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_ADMIN_LAN_INTERFACE_ENUMERATION_FAILED",
        "CLI-local managed-LAN selection diagnostic; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_ADMIN_LAN_INTERFACE_NOT_FOUND",
        "CLI-local managed-LAN selection diagnostic; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_ADMIN_LAN_RELAY_FAILED",
        "CLI-local managed-LAN lifecycle diagnostic; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_ADMIN_LAN_TARGET_INVALID",
        "CLI-local managed-LAN target diagnostic; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_ADMIN_LAN_WILDCARD_REFUSED",
        "CLI-local managed-LAN bind diagnostic; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_ADMIN_LINK_ATTACHED_REQUIRED",
        "CLI-local claim-link usage diagnostic; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_ADMIN_LINK_CONTROL_CONFLICT",
        "CLI-local claim-link usage diagnostic; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_ADMIN_LINK_ORIGIN_CONFLICT",
        "CLI-local claim-link usage diagnostic; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_ADMIN_QR_ENCODING_FAILED",
        "CLI-local terminal presentation diagnostic; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_ADMIN_QR_LOOPBACK_ONLY",
        "CLI-local terminal reachability hint marker; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_ADMIN_RELAY_LEASE_RESPONSE_INVALID",
        "CLI-local lease-client response validation diagnostic; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_ADMIN_TAILSCALE_CLEANUP_FAILED",
        "CLI-local tailscaled lifecycle diagnostic; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_ADMIN_TAILSCALE_HOST_UNSUPPORTED",
        "CLI-local tailscaled capability diagnostic; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_ADMIN_TAILSCALE_MAPPING_CONFLICT",
        "CLI-local tailscaled ownership diagnostic; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_ADMIN_TAILSCALE_MAPPING_INVALID",
        "CLI-local tailscaled ownership diagnostic; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_ADMIN_TAILSCALE_MAPPING_MUTATED",
        "CLI-local tailscaled compare-and-delete diagnostic; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_ADMIN_TAILSCALE_RECEIPT_DIR",
        "environment variable overriding the owner-only tailscaled receipt directory",
    ),
    (
        "SNAPBACK_ADMIN_TAILSCALE_RECEIPT_INVALID",
        "CLI-local tailscaled receipt diagnostic; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_ADMIN_TAILSCALE_RECEIPT_UNAVAILABLE",
        "CLI-local tailscaled receipt diagnostic; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_ADMIN_TAILSCALE_STATUS_INVALID",
        "CLI-local tailscaled status diagnostic; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_ADMIN_TAILSCALE_TARGET_UNSUPPORTED",
        "CLI-local tailscaled target diagnostic; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_ADMIN_TAILSCALE_UNAVAILABLE",
        "CLI-local tailscaled availability diagnostic; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_ADMIN_SECRET_READ_ROOT_PATH_INVALID",
        "CLI-local readiness path validation code; never emitted as an HTTP diagnostic",
    ),
    (
        "SNAPBACK_ADMIN_TOKEN",
        "environment variable carrying the admin bearer token",
    ),
    (
        "SNAPBACK_AUTH_ACCEPTANCE_PROPERTY_RECEIPT",
        "machine-readable property-oracle marker emitted only by the LLP 0053 server acceptance test",
    ),
    (
        "SNAPBACK_AUTH_ACCEPTANCE_ROOM_RECEIPT",
        "machine-readable marker emitted only by the LLP 0053 room acceptance test",
    ),
    (
        "SNAPBACK_AUTH_ACCEPTANCE_ROOM_DRAIN_SEND_RECEIPT",
        "machine-readable drain/send schedule marker emitted only by the LLP 0053 room acceptance test",
    ),
    (
        "SNAPBACK_AUTH_ACCEPTANCE_ROOM_ENQUEUE_DRAIN_RECEIPT",
        "machine-readable enqueue/drain schedule marker emitted only by the LLP 0053 room acceptance test",
    ),
    (
        "SNAPBACK_AUTH_ACCEPTANCE_ROOM_FRAME_ENQUEUE_RECEIPT",
        "machine-readable frame/enqueue schedule marker emitted only by the LLP 0053 room acceptance test",
    ),
    (
        "SNAPBACK_AUTH_ACCEPTANCE_SERVER_RECEIPT",
        "machine-readable marker emitted only by the LLP 0053 server acceptance test",
    ),
    (
        "SNAPBACK_AUTH_ACCEPTANCE_SERVER_REPLAY",
        "machine-readable replay-oracle marker emitted only by the LLP 0053 server acceptance test",
    ),
    (
        "SNAPBACK_AUTH_HANDLER_V1",
        "LLP 0060 D6 private marker echoed on the handler wire envelope (schema authority in src/handler_wire.rs), never an HTTP diagnostic",
    ),
    (
        "SNAPBACK_BUILD_DISTRIBUTION",
        "compile-time environment variable classifying contributor-source versus public-package builds",
    ),
    (
        "SNAPBACK_BUILD_GIT_COMMIT",
        "compile-time environment variable carrying build provenance",
    ),
    (
        "SNAPBACK_BUILD_GIT_DIRTY",
        "compile-time environment variable carrying build provenance",
    ),
    (
        "SNAPBACK_CONNECTION_SOCKET_REQUIRED",
        "hosted-arm wire-fixture refusal code (LLP 0095 T-SUB live/hosted); emitted by the hosted socket arm, never by this Rust server",
    ),
    (
        "SNAPBACK_CRON_DISABLED",
        "environment variable disabling autonomous cron claiming; manual admin ticks still run",
    ),
    (
        "SNAPBACK_JOBS_DISABLED",
        "environment variable disabling the autonomous one-off jobs worker; the admin forced drain still claims due jobs (LLP 0070 first slice)",
    ),
    (
        "SNAPBACK_LIVE_COALESCE_DISABLED",
        "environment variable restoring strict per-commit live fan-out (no coalescing) for A/B measurement (LLP 0008 fan-out coalescing)",
    ),
    (
        "SNAPBACK_JOB_ATTEMPTS_EXHAUSTED",
        "terminal disposition code recorded on dead-lettered job rows when an expired final attempt is swept; a job/attempt-ledger fact, never an HTTP diagnostic",
    ),
    (
        "SNAPBACK_JOB_LEASE_EXPIRED",
        "attempt-ledger outcome code recorded when a successor claim supersedes an expired lease; a receipt fact, never an HTTP diagnostic",
    ),
    (
        "SNAPBACK_CRON_DISPATCH_CONCURRENCY",
        "environment variable configuring bounded cron dispatch",
    ),
    (
        "SNAPBACK_HANDLER_BACKEND",
        "environment variable selecting the handler backend",
    ),
    (
        "SNAPBACK_HANDLER_CONSOLE",
        "environment variable selecting handler-console forwarding",
    ),
    (
        "SNAPBACK_HANDLER_HOST_CALL_",
        "diagnostic-code prefix used to recognize host-call failures",
    ),
    (
        "SNAPBACK_INVOKE_TOKEN",
        "private workerd text binding carrying the local invocation capability",
    ),
    (
        "SNAPBACK_LIVE_SUPERSESSION_TARGET_UNKNOWN",
        "successful subscribe-output supersessionRefusal witness, never an HTTP diagnostic",
    ),
    (
        "SNAPBACK_HOST_TOKEN",
        "private workerd text binding carrying the independent host-call capability",
    ),
    (
        "SNAPBACK_HOSTED_JOURNEY_INVALID",
        "CLI-local hosted-journey receipt validation code; never emitted as an HTTP diagnostic",
    ),
    (
        "SNAPBACK_RESPONSE_TOKEN",
        "private workerd text binding authenticating readiness and invoke responses",
    ),
    (
        "SNAPBACK_IBEX",
        "environment variable overriding the Ibex executable",
    ),
    (
        "SNAPBACK_BUNDLE_",
        "diagnostic-code family prefix appearing in bundle refusal-registry docs (LLP 0092 §0D.2)",
    ),
    (
        "SNAPBACK_BUNDLE_ATTACH_GRACE_MS",
        "environment variable overriding the bundle attach-grace window (LLP 0092 §0D.4 policy knob)",
    ),
    (
        "SNAPBACK_MARK__",
        "suffix of the __SNAPBACK_MARK__ HTML template placeholder",
    ),
    (
        "SNAPBACK_INVOCATION_JSON__",
        "suffix of the unique __SNAPBACK_INVOCATION_JSON__ embedded-runtime payload slot",
    ),
    (
        "SNAPBACK_OUTBOUND_ACTIONS",
        "environment variable enabling outbound action capabilities",
    ),
    (
        "SNAPBACK_OUTBOUND_LOOPBACK",
        "explicit local-development override admitting all-loopback HTTP action egress; never an HTTP diagnostic",
    ),
    (
        "SNAPBACK_EXPO_PUSH_BASE_URL",
        "local/test-only environment variable overriding the Expo provider origin (LLP 0143 D2d)",
    ),
    (
        "SNAPBACK_PROFILE",
        "environment variable selecting the server profile",
    ),
    (
        "SNAPBACK_EXPOSURE",
        "closed environment declaration selecting fronted versus direct startup semantics; never an HTTP diagnostic",
    ),
    (
        "SNAPBACK_PACKAGED_STORE_QUALIFICATION_RECEIPT",
        "environment variable selecting the public-package store qualification receipt",
    ),
    (
        "SNAPBACK_PACKAGED_STORE_QUALIFICATION_MODE",
        "environment variable enabling receipt-backed public-package store qualification",
    ),
    (
        "SNAPBACK_PACKAGED_STORE_QUALIFICATION_IDENTITY_UNQUALIFIED",
        "CLI-local receipt-minting identity diagnostic; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_PACKAGED_STORE_QUALIFICATION_SUITE_UNQUALIFIED",
        "CLI-local receipt-minting suite diagnostic; never emitted by the Snapback HTTP server",
    ),
    (
        "SNAPBACK_PACKAGED_STORE_QUALIFICATION_CLOSURE_INVALID",
        "CLI-local receipt-minting package-closure diagnostic; never emitted by the Snapback HTTP server",
    ),
    // @ref LLP 0132#acceptance — these test-only harness inputs bind the
    // retained scale receipt; they are not runtime/API refusal codes.
    (
        "SNAPBACK_VECTOR_QUALIFICATION_MACHINE",
        "test-only environment variable binding the LLP 0132 scale receipt to its machine identity",
    ),
    (
        "SNAPBACK_VECTOR_QUALIFICATION_RECEIPT_OUT",
        "test-only environment variable selecting the LLP 0132 scale receipt output path",
    ),
    (
        "SNAPBACK_VECTOR_QUALIFICATION_REVISION",
        "test-only environment variable binding the LLP 0132 scale receipt to its product revision",
    ),
    (
        "SNAPBACK_RESUME_",
        "diagnostic-code family prefix appearing in RQS refusal-registry docs (LLP 0091 §0B.6)",
    ),
    (
        "SNAPBACK_RESUME_GENERATION_UNAVAILABLE",
        "internal RQS generation-mint impediment; swallowed into a token-mint absence or a wire refusal code, never an HTTP diagnostic",
    ),
    // The SNAPBACK_RESUME_* registry (LLP 0091 §0B.6): wire refusal
    // codes carried inside a SUCCESSFUL subscribe answer (`resumeRefusal`
    // + observability counters). Every refusal answers with rung 3 —
    // a coded refusal is an observability fact, never an HTTP error.
    (
        "SNAPBACK_RESUME_TOKEN_MALFORMED",
        "RQS wire refusal code (LLP 0091 §0B.6), never an HTTP diagnostic",
    ),
    (
        "SNAPBACK_RESUME_TOKEN_OVERSIZE",
        "RQS wire refusal code (LLP 0091 §0B.6), never an HTTP diagnostic",
    ),
    (
        "SNAPBACK_RESUME_MAC_INVALID",
        "RQS wire refusal code (LLP 0091 §0B.6), never an HTTP diagnostic",
    ),
    (
        "SNAPBACK_RESUME_KEY_UNKNOWN",
        "RQS wire refusal code (LLP 0091 §0B.6), never an HTTP diagnostic",
    ),
    (
        "SNAPBACK_RESUME_KEY_RETIRED",
        "RQS wire refusal code (LLP 0091 §0B.6), never an HTTP diagnostic",
    ),
    (
        "SNAPBACK_RESUME_TOKEN_EXPIRED",
        "RQS wire refusal code (LLP 0091 §0B.6), never an HTTP diagnostic",
    ),
    (
        "SNAPBACK_RESUME_APP_MISMATCH",
        "RQS wire refusal code (LLP 0091 §0B.6), never an HTTP diagnostic",
    ),
    (
        "SNAPBACK_RESUME_GENERATION_STALE",
        "RQS wire refusal code (LLP 0091 §0B.6), never an HTTP diagnostic",
    ),
    (
        "SNAPBACK_RESUME_STREAM_MISMATCH",
        "RQS wire refusal code (LLP 0091 §0B.6), never an HTTP diagnostic",
    ),
    (
        "SNAPBACK_RESUME_QUERY_MISMATCH",
        "RQS wire refusal code (LLP 0091 §0B.6), never an HTTP diagnostic",
    ),
    (
        "SNAPBACK_RESUME_NOT_ELIGIBLE",
        "RQS wire refusal code (LLP 0091 §0B.6), never an HTTP diagnostic",
    ),
    (
        "SNAPBACK_RESUME_DIGEST_KIND_MISMATCH",
        "RQS wire refusal code (LLP 0091 §0B.6), never an HTTP diagnostic",
    ),
    (
        "SNAPBACK_RESUME_VERSION_IMPLAUSIBLE",
        "RQS wire refusal code (LLP 0091 §0B.6), never an HTTP diagnostic",
    ),
    (
        "SNAPBACK_RESUME_JOURNAL_FLOOR",
        "RQS wire refusal code (LLP 0091 §0B.6), never an HTTP diagnostic",
    ),
    (
        "SNAPBACK_RESUME_WITNESS_INVALID",
        "RQS wire refusal code (LLP 0091 §0B.6, live since the rung-2 amendment), never an HTTP diagnostic",
    ),
    (
        "SNAPBACK_RESUME_WITNESS_OVERSIZE",
        "RQS wire refusal code (LLP 0091 §0B.6, live since the rung-2 amendment), never an HTTP diagnostic",
    ),
    (
        "SNAPBACK_RESUME_WITNESS_ROOT_MISMATCH",
        "RQS wire refusal code (LLP 0091 rung-2 amendment), never an HTTP diagnostic",
    ),
    (
        "SNAPBACK_RESUME_WITNESS_REPLAY_DIVERGED",
        "RQS wire refusal code (LLP 0091 rung-2 amendment), never an HTTP diagnostic",
    ),
    (
        "SNAPBACK_RESUME_BUDGET_EXCEEDED",
        "RQS wire refusal code (LLP 0091 §0B.6), never an HTTP diagnostic",
    ),
    (
        "SNAPBACK_RESUME_RATE_LIMITED",
        "RQS wire refusal code (LLP 0091 §0B.6), never an HTTP diagnostic",
    ),
    (
        "SNAPBACK_RESUME_POLICY_REPLACED",
        "RQS wire refusal code (LLP 0091 §0B.6), never an HTTP diagnostic",
    ),
    (
        "SNAPBACK_SCHEMA_VERSION",
        "Rust constant name interpolated into schema-export text",
    ),
    (
        "SNAPBACK_SESSIONS_MANIFEST_RELOCATED",
        "embedded relocation poison marker, not an emitted diagnostic code",
    ),
    (
        "SNAPBACK_SESSIONS_SCHEMA_VERSION",
        "Rust constant name interpolated into schema-export text",
    ),
    (
        "SNAPBACK_V8_WALL_CLOCK_TIMEOUT_MS",
        "environment variable configuring the V8 watchdog",
    ),
    (
        "SNAPBACK_WORKERD_BIN",
        "environment variable overriding the workerd executable",
    ),
];

const BAD_REQUEST_DIAGNOSTICS: &[&str] = &[
    // @ref LLP 0209#23-closure-admission-demand-time-evaluation-time-and-qualification-registers
    // The Stage-B graph carrier's admission register is manifest/schema/policy
    // author input and therefore uses the reviewed 400 family.
    "SNAPBACK_GRAPH_CLIENT_AST_FORBIDDEN",
    "SNAPBACK_GRAPH_CODE_FORBIDDEN",
    "SNAPBACK_GRAPH_RECURSION_FORBIDDEN",
    "SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION",
    "SNAPBACK_GRAPH_ROOT_COUNT_INVALID",
    "SNAPBACK_GRAPH_PROJECTION_COUNT_INVALID",
    "SNAPBACK_GRAPH_NODE_KIND_UNSUPPORTED",
    "SNAPBACK_GRAPH_UNKNOWN_FIELD",
    "SNAPBACK_GRAPH_PARENT_INVALID",
    "SNAPBACK_GRAPH_NODE_INERT",
    "SNAPBACK_GRAPH_CYCLE",
    "SNAPBACK_GRAPH_UNBOUNDED_EXPANSION",
    "SNAPBACK_GRAPH_THROUGH_TABLE_UNDECLARED",
    "SNAPBACK_GRAPH_SCHEMA_REFERENCE_INVALID",
    "SNAPBACK_GRAPH_INDEX_UNPROVABLE",
    "SNAPBACK_GRAPH_INDEX_PREFIX_UNSUPPORTED",
    "SNAPBACK_GRAPH_ORDER_NOT_TOTAL",
    "SNAPBACK_GRAPH_PROJECTION_SCOPE_INVALID",
    "SNAPBACK_GRAPH_PROJECTION_OPEN",
    "SNAPBACK_GRAPH_PRINCIPAL_BINDING_UNPROVABLE",
    "SNAPBACK_GRAPH_SEARCH_UNADMITTED",
    "SNAPBACK_GRAPH_AUTHORITY_UNPROVABLE",
    "SNAPBACK_GRAPH_BROADCAST_BASE_CLASS_INVALID",
    "SNAPBACK_GRAPH_BROADCAST_SEPARATION_UNPROVABLE",
    "SNAPBACK_GRAPH_BROADCAST_SCOPE_UNBOUND",
    "SNAPBACK_GRAPH_BROADCAST_AUDIENCE_UNPROVABLE",
    "SNAPBACK_GRAPH_BROADCAST_INVALIDATION_INCOMPLETE",
    "SNAPBACK_GRAPH_BOUND_INVALID",
    "SNAPBACK_GRAPH_RESULT_CONTRACT_MISMATCH",
    "SNAPBACK_GRAPH_PLAN_IDENTITY_MISMATCH",
    "SNAPBACK_GRAPH_ARGUMENT_UNBOUND",
    // Demand-time graph refusals are likewise client demand faults. Keeping
    // them in the reviewed 400 family now prevents a later executor from
    // accidentally inheriting the fail-safe 500 default.
    "SNAPBACK_GRAPH_ARGUMENT_INVALID",
    "SNAPBACK_GRAPH_WINDOW_VECTOR_INVALID",
    "SNAPBACK_GRAPH_CURSOR_UNBOUND",
    "SNAPBACK_GRAPH_DEMAND_IDENTITY_MISMATCH",
    "SNAPBACK_GRAPH_DEMAND_INVALID",
    "SNAPBACK_GRAPH_DEMAND_REQUIRED",
    "SNAPBACK_GRAPH_AUTHORITY_CONTEXT_UNAVAILABLE",
    "SNAPBACK_GRAPH_EXEC_DISABLED",
    "SNAPBACK_GRAPH_MATERIALIZATION_INVALID",
    "SNAPBACK_GRAPH_QUALIFICATION_CORPUS_MISMATCH",
    "SNAPBACK_GRAPH_QUALIFICATION_DERIVATION_MISSING",
    // G2-A's required-edge miss is an evaluation-time materialized refusal,
    // but it still reports a caller-visible graph shape/data mismatch in the
    // reviewed 4xx family rather than inheriting the fail-safe 500 default.
    "SNAPBACK_GRAPH_REQUIRED_EDGE_MISSING",
    "SNAPBACK_GRAPH_RESULT_INVALID",
    "SNAPBACK_QUERY_COST_CLIENT_UNSUPPORTED",
    // These closed terminal-protocol ids are produced by the mapper's
    // dedicated registry rather than a match arm, but retain the same reviewed
    // malformed/unsupported-client 400 posture.
    "SNAPBACK_AUTHORIZED_LEASE_CLIENT_UNSUPPORTED",
    "SNAPBACK_CLIENT_SEED_PROTOCOL_UNSUPPORTED",
    // Validated from the caller-supplied app.readiness.v1 request body
    // (src/operational_readiness.rs validate_expected_activation_target,
    // reached via EnsureAppInput::validate_artifacts). Carried in the
    // HTTP-200 host-operation envelope today; 400 if one reaches ApiError.
    "SNAPBACK_APP_READINESS_DECLARATION_INVALID",
    "SNAPBACK_APP_READINESS_MIGRATION_UNRESOLVED",
    "SNAPBACK_APP_READINESS_OBLIGATIONS_DIGEST_MISMATCH",
    "SNAPBACK_APP_READINESS_SEED_NOT_IDEMPOTENT",
    "SNAPBACK_EFFECT_INPUT_INVALID",
    "SNAPBACK_REMEDIATION_INPUT_INVALID",
    "SNAPBACK_API_APPROVAL_QUERY_INVALID",
    "SNAPBACK_API_APPROVAL_REQUIRES_EXPOSURE",
    "SNAPBACK_WATCH_INPUT_INVALID",
    "SNAPBACK_WATCH_RENEWAL_INVALID",
    "SNAPBACK_WEBHOOK_TARGET_INVALID",
    "SNAPBACK_WEBHOOK_SSRF_REFUSED",
    "SNAPBACK_ASSET_GRANT_INPUT_INVALID",
    "SNAPBACK_CAPABILITY_LINK_ARGS_CONTRACT_REQUIRED",
    "SNAPBACK_CAPABILITY_LINK_EXPIRY_INVALID",
    "SNAPBACK_CAPABILITY_LINK_INPUT_INVALID",
    "SNAPBACK_AUTH_REHEARSAL_REQUEST_INVALID",
    "SNAPBACK_AUTH_LOGICAL_IMPORT_FORMAT_UNSUPPORTED",
    "SNAPBACK_AUTH_LOGICAL_IMPORT_INVALID",
    "SNAPBACK_AUTH_IDENTITY_INVALID",
    // LLP 0214 §20.3: an identifier that does not satisfy the app's immutable
    // username-v1/email-v1 declaration is malformed caller input.
    "SNAPBACK_AUTH_PASSWORD_IDENTIFIER_INVALID",
    "SNAPBACK_AUTH_PASSWORD_POLICY",
    "SNAPBACK_AUTH_PROVISIONING_INVALID",
    "SNAPBACK_AUTH_USERNAME_INVALID",
    "SNAPBACK_FIELD_BOUNDARY_CONDITION_INVALID",
    "SNAPBACK_FIELD_BOUNDARY_FIELDS_INVALID",
    "SNAPBACK_FIELD_BOUNDARY_FIELD_UNKNOWN",
    "SNAPBACK_FIELD_BOUNDARY_SPEC_INVALID",
    "SNAPBACK_API_BUDGETS_INVALID",
    "SNAPBACK_API_ASK_BUDGETS_INVALID",
    "SNAPBACK_API_ASK_BUDGETS_REQUIRED",
    "SNAPBACK_API_ASK_CALLER_KEY_INVALID",
    "SNAPBACK_API_ASK_CALLER_KEY_REQUIRED",
    "SNAPBACK_API_ASK_CALLER_KEY_UNEXPECTED",
    "SNAPBACK_API_ASK_MODEL_INVALID",
    "SNAPBACK_API_ASK_MANIFEST_INVALID",
    "SNAPBACK_API_ASK_PROVIDER_INVALID",
    "SNAPBACK_API_ASK_PROVIDER_UNSUPPORTED",
    "SNAPBACK_API_ASK_REQUIRES_API",
    "SNAPBACK_API_ASK_RESULT_SCHEMA_INVALID",
    "SNAPBACK_API_ASK_SECRET_INVALID",
    "SNAPBACK_API_ASK_TASK_INVALID",
    "SNAPBACK_STREAM_CHUNK_INVALID",
    "SNAPBACK_STREAM_NOT_DECLARED",
    "SNAPBACK_FUNCTION_STREAM_KIND_INVALID",
    // LLP 0204 S0 agent registration/invitation — malformed or ill-formed
    // request inputs (bad/expired invitation, wrong mode, invalid manifest).
    "SNAPBACK_AUTH_AGENT_INVITATION_INVALID",
    "SNAPBACK_AUTH_AGENT_INVITATION_REQUIRED",
    "SNAPBACK_AUTH_AGENT_INVITATION_UNEXPECTED",
    "SNAPBACK_AUTH_AGENT_POLICY_MODE_INVALID",
    "SNAPBACK_AUTH_INTEGRATION_REQUEST_INVALID",
    "SNAPBACK_AUTH_OAUTH_GRANT_INVALID",
    "SNAPBACK_AUTH_OAUTH_REDIRECT_URI_INVALID",
    "SNAPBACK_AUTH_OAUTH_REQUEST_INVALID",
    "SNAPBACK_AUTH_OAUTH_SCOPE_INVALID",
    // LLP 0204 S1 external-surface declarations and unpinned carrier.
    "SNAPBACK_API_AUTH_MODE_INVALID",
    "SNAPBACK_API_BUDGETS_UNAVAILABLE",
    "SNAPBACK_API_DECLARED_CLIENT_INVALID",
    "SNAPBACK_API_EXPOSURE_COMPILATION_INVALID",
    "SNAPBACK_API_FUNCTION_EXPOSURE_INVALID",
    "SNAPBACK_API_FUNCTION_UNKNOWN",
    "SNAPBACK_API_GENERATION_PIN_UNSUPPORTED",
    "SNAPBACK_API_MANIFEST_INVALID",
    "SNAPBACK_API_ORIGIN_INVALID",
    "SNAPBACK_API_OAUTH_BEARER_OPT_IN_REQUIRED",
    "SNAPBACK_API_OAUTH_BUNDLES_INVALID",
    "SNAPBACK_API_OAUTH_FUNCTION_NOT_EXPOSED",
    "SNAPBACK_API_OAUTH_FUNCTION_UNKNOWN",
    "SNAPBACK_API_OAUTH_REQUIRES_API",
    "SNAPBACK_API_PAGINATION_RECOMMENDED",
    "SNAPBACK_API_REGISTRATION_POSTURE_REQUIRED",
    // LLP 0204 #4 compatibility classifier: manifest/activation validation
    // (breaking exposed-contract change) + its two advisory diagnostics.
    "SNAPBACK_API_AUTH_REQUIREMENT_LOOSENED",
    "SNAPBACK_API_COMPATIBILITY_BASELINE_UNAVAILABLE",
    "SNAPBACK_API_INCOMPATIBLE_CHANGE",
    // LLP 0158/0163/0164/0165 experimental control-plane request shapes.
    "SNAPBACK_BRANCH_NESTING_UNSUPPORTED",
    "SNAPBACK_BRANCH_OPERATION_KIND_UNSUPPORTED",
    "SNAPBACK_BRANCH_REQUEST_ID_REQUIRED",
    "SNAPBACK_BRANCH_REQUEST_INVALID",
    "SNAPBACK_BRANCH_CAPTURE_ONLY_MISSING",
    "SNAPBACK_BRANCH_LIMIT_INVALID",
    "SNAPBACK_BRANCH_OPERATION_INVALID",
    "SNAPBACK_BRANCH_SCHEMA_VERSION_UNSUPPORTED",
    "SNAPBACK_BRANCH_STREAM_MISMATCH",
    "SNAPBACK_AUTH_IMPERSONATION_FILE_INVALID",
    "SNAPBACK_CHECKPOINT_DESTINATION_INVALID",
    "SNAPBACK_CHECKPOINT_ERASURE_REQUEST_INVALID",
    "SNAPBACK_CHECKPOINT_REQUEST_INVALID",
    "SNAPBACK_FORK_APP_BINDING_REQUIRED",
    "SNAPBACK_FORK_APP_ID_REQUIRED",
    "SNAPBACK_FORK_ASSET_CUT_UNSUPPORTED",
    "SNAPBACK_FORK_APP_ROOT_INVALID",
    "SNAPBACK_FORK_ID_INVALID",
    "SNAPBACK_FORK_NET_DIFF_UNAVAILABLE",
    "SNAPBACK_FORK_PROJECTION_UNAVAILABLE",
    "SNAPBACK_FORK_REAP_CLOCK_INVALID",
    "SNAPBACK_FORK_RENEW_EXPIRED",
    "SNAPBACK_FORK_SOURCE_INVALID",
    "SNAPBACK_FORK_TTL_INVALID",
    "SNAPBACK_HISTORY_PAGE_INVALID",
    "SNAPBACK_HISTORY_POLICY_INVALID",
    "SNAPBACK_HOST_OPERATION_IDENTITY_INVALID",
    "SNAPBACK_OPERATION_COVERAGE_ACTIVATION_VERSION_UNSUPPORTED",
    "SNAPBACK_OPERATION_EXPLANATION_AUDIENCE_REQUIRED",
    "SNAPBACK_OPERATION_EXPLANATION_LIMIT_INVALID",
    "SNAPBACK_OPERATION_EXPLANATION_QUERY_UNBOUNDED",
    "SNAPBACK_OPERATION_EXPLANATION_VERSION_UNSUPPORTED",
    "SNAPBACK_OPERATION_HOST_IDENTITY_FORBIDDEN",
    "SNAPBACK_OPERATION_IDENTITY_RANGE_VERSION_UNSUPPORTED",
    "SNAPBACK_OPERATION_IDENTITY_REQUIRED",
    "SNAPBACK_OPERATION_IDENTITY_REQUIRES_CLIENT_MUTATION_ID",
    "SNAPBACK_OPERATION_RANGE_AUDIENCE_INVALID",
    "SNAPBACK_PROMOTION_CONTENTION_POLICY_INVALID",
    "SNAPBACK_PROMOTION_PROVISIONAL_REPRESENTATION_REQUIRED",
    "SNAPBACK_PROMOTION_TICKET_IDENTITY_INVALID",
    "SNAPBACK_PROMOTION_TICKET_TTL_INSUFFICIENT",
    "SNAPBACK_PROTECTED_ERASURE_REQUEST_INVALID",
    "SNAPBACK_NETWORK_PROFILE_DELAY_CEILING",
    "SNAPBACK_NETWORK_PROFILE_INVALID",
    "SNAPBACK_RESULT_TRANSFORM_BASE_INVALID",
    "SNAPBACK_RESULT_TRANSFORM_COMPARATOR_UNKNOWN",
    "SNAPBACK_RESULT_TRANSFORM_CROSS_ADDRESS",
    "SNAPBACK_RESULT_TRANSFORM_FIELD_UNPROJECTED",
    "SNAPBACK_RESULT_TRANSFORM_LIMIT_INVALID",
    "SNAPBACK_RESULT_TRANSFORM_MIXED_VERSION",
    "SNAPBACK_RESULT_TRANSFORM_NON_SCALAR",
    "SNAPBACK_RESULT_TRANSFORM_NORMALIZATION_UNADMITTED",
    "SNAPBACK_RESULT_TRANSFORM_ORDER_FIELD_DUPLICATE",
    "SNAPBACK_RESULT_TRANSFORM_OVERLAY_INPUT_REQUIRED",
    "SNAPBACK_RESULT_TRANSFORM_PLAN_INVALID",
    "SNAPBACK_RESULT_TRANSFORM_STAGE_UNKNOWN",
    "SNAPBACK_ACTION_MUTATION_REFERENCE_INVALID",
    "SNAPBACK_ACTION_STREAM_INVALID",
    "SNAPBACK_ACTION_STREAM_SSRF_REFUSED",
    "SNAPBACK_VECTOR_INDEX_INVALID",
    "SNAPBACK_VECTOR_QUERY_INVALID",
    "SNAPBACK_VECTOR_QUERY_PLAN_INVALID",
    "SNAPBACK_VECTOR_VALUE_INVALID",
    "SNAPBACK_VECTOR_MAINTENANCE_LIMIT",
    "SNAPBACK_HOST_FETCH_INVALID",
    "SNAPBACK_HOST_FETCH_SSRF_REFUSED",
    "SNAPBACK_HOST_FETCH_SLOT_INVALID",
    "SNAPBACK_BUNDLE_ENTRY_INVALID",
    "SNAPBACK_BUNDLE_MODE_INVALID",
    "SNAPBACK_BUNDLE_PARAMS_INVALID",
    "SNAPBACK_ADMIN_SECRET_READ_LEASE_INVALID",
    "SNAPBACK_ADMIN_REACHABILITY_ORIGIN_INVALID",
    "SNAPBACK_ADMIN_RELAY_BODY_REFUSED",
    "SNAPBACK_ADMIN_RELAY_CONNECT_REFUSED",
    "SNAPBACK_ADMIN_RELAY_FORWARDING_HEADER_REFUSED",
    "SNAPBACK_ADMIN_RELAY_FRAMING_REFUSED",
    "SNAPBACK_ADMIN_RELAY_PATH_REFUSED",
    "SNAPBACK_ADMIN_RELAY_TARGET_FORM_REFUSED",
    "SNAPBACK_TELEMETRY_EXPORT_CONTINUATION_INVALID",
    "SNAPBACK_TELEMETRY_EXPORT_PAGE_TOO_SMALL",
    "SNAPBACK_TELEMETRY_QUERY_INVALID",
    "SNAPBACK_TELEMETRY_SQL_DENIED",
    "SNAPBACK_TELEMETRY_SQL_FAILED",
    "SNAPBACK_ERRORS_QUERY_INVALID",
    "SNAPBACK_ERROR_ISSUE_ID_INVALID",
    "SNAPBACK_ERROR_RELEASE_UNKNOWN_OR_PRUNED",
    "SNAPBACK_ERROR_TRANSITION_INVALID",
    "SNAPBACK_ARG_MISSING",
    "SNAPBACK_AUTHORITY_INDEPENDENT_INVALID",
    "SNAPBACK_PUBLIC_INLINE_INVALID",
    "SNAPBACK_ROUTES_MANIFEST_INVALID",
    "SNAPBACK_FUNCTION_PLAN_REFUSAL_UNDECLARED",
    "SNAPBACK_AUTHORIZED_LEASE_CONFIG_INVALID",
    "SNAPBACK_AUTHORIZED_LEASE_INVALID",
    "SNAPBACK_AUTHORIZED_LEASE_QUERY_NOT_RETAINABLE",
    "SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED",
    "SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY",
    "SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED",
    "SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED",
    "SNAPBACK_AUTH_MUTABLE_INPUT_DENIED",
    "SNAPBACK_AUTH_INVALIDATION_ACK_BEFORE_COMMIT",
    "SNAPBACK_AUTH_INVALIDATION_NAMESPACE_REQUIRED",
    "SNAPBACK_WIRE_VERSION_UNSUPPORTED",
    "SNAPBACK_WIRE_VERSION_MISMATCH",
    "SNAPBACK_WIRE_VERSION_REQUIRED",
    "SNAPBACK_EPHEMERAL_CLEANUP_BOUND_INVALID",
    "SNAPBACK_EPHEMERAL_CLEANUP_CUTOFF_INVALID",
    "SNAPBACK_EPHEMERAL_CLEANUP_REQUEST_INVALID",
    // @ref LLP 0184#c-administrator-ephemeral-entry-delete--add-now — a
    // blank reason is malformed input on the raw admin route.
    "SNAPBACK_EPHEMERAL_OPERATOR_DELETE_REASON_REQUIRED",
    "SNAPBACK_EPHEMERAL_AUTHORITY_PROTOCOL_MISMATCH",
    "SNAPBACK_EPHEMERAL_AUTHORITY_UNSUPPORTED",
    "SNAPBACK_EPHEMERAL_AUTHORITY_INSTANCE_REQUIRED",
    "SNAPBACK_EPHEMERAL_EXPIRY_PROTOCOL_MISMATCH",
    "SNAPBACK_EPHEMERAL_EXPIRY_UNSUPPORTED",
    "SNAPBACK_AUTH_INVALIDATION_PROTOCOL_UNSUPPORTED",
    "SNAPBACK_AUTH_REQUEST_INVALID",
    "SNAPBACK_AUTH_GRANT_EXPIRY_INVALID",
    "SNAPBACK_AUTH_GRANT_SCOPE_INVALID",
    "SNAPBACK_AUTH_RESCUE_INVALID",
    "SNAPBACK_AUTH_RESCUE_MANAGED_STATE_UNSUPPORTED",
    "SNAPBACK_AUTH_RESCUE_SCHEMA_UNSUPPORTED",
    "SNAPBACK_AUTH_STALE_RESULT",
    "SNAPBACK_AUTH_UNDECLARABLE_RETENTION",
    "SNAPBACK_AUTH_USER_MISSING",
    "SNAPBACK_TABLE_WRITE_UNDECLARED_REFUSED",
    "SNAPBACK_TABLE_WRITE_UNCOMPOSED_SURFACE",
    "SNAPBACK_TABLE_WRITE_UNIQUE_DISCLOSURE_REQUIRED",
    "SNAPBACK_TABLE_WRITE_OWNER_INPUT_REFUSED",
    "SNAPBACK_TABLE_WRITE_OWNER_IMMUTABLE",
    "SNAPBACK_AUTH_SCOPED_TOKEN_TTL_INVALID",
    "SNAPBACK_BINDING_MISSING",
    "SNAPBACK_BUFFERED_WRITE_LIMIT_EXCEEDED",
    "SNAPBACK_CAPTURED_READ_INVALID",
    "SNAPBACK_CLIENT_MUTATION_ACK_LIMIT_EXCEEDED",
    "SNAPBACK_CLIENT_MUTATION_ACK_OVERLAP",
    "SNAPBACK_CLIENT_MUTATION_ID_INVALID",
    "SNAPBACK_CLIENT_MUTATION_PURGE_SELECTOR_INVALID",
    "SNAPBACK_CONFIG_DEFAULT_UNIMPLEMENTED",
    "SNAPBACK_CONFIG_ENTRY_INVALID",
    "SNAPBACK_CONFIG_MISSING",
    "SNAPBACK_CONFIG_NON_SECRET_UNIMPLEMENTED",
    "SNAPBACK_CONFIG_PROBE_INVALID",
    "SNAPBACK_CONFIG_PROBE_MISSING",
    "SNAPBACK_CONFIG_REQUIRED_MISSING",
    "SNAPBACK_CONFIG_TRANSIT_RULE",
    "SNAPBACK_CONFIG_UNDECLARED",
    "SNAPBACK_CONFIG_USES_UNKNOWN",
    "SNAPBACK_CONFIG_VALUE_INVALID",
    "SNAPBACK_CONFIG_VERIFY_COOLDOWN",
    "SNAPBACK_CRON_ACTION_KIND_MISMATCH",
    "SNAPBACK_CRON_ACTION_MISSING",
    "SNAPBACK_CRON_AUTH_REQUIREMENT_INVALID",
    "SNAPBACK_CRON_DUPLICATE_JOB",
    "SNAPBACK_CRON_INVALID_EXPRESSION",
    "SNAPBACK_CRON_INVALID_INTERVAL",
    "SNAPBACK_CRON_INVALID_SCHEDULE",
    "SNAPBACK_CRON_JITTER_INVALID",
    "SNAPBACK_CRON_JOB_DISABLED",
    "SNAPBACK_CRON_JOB_IN_FLIGHT",
    "SNAPBACK_CRON_JOB_INVALID",
    "SNAPBACK_CRON_RETRY_MODE_UNIMPLEMENTED",
    "SNAPBACK_CRON_TARGET_CADENCE_UNSUPPORTED",
    "SNAPBACK_CRON_UNSATISFIABLE_EXPRESSION",
    "SNAPBACK_CRON_WHILE_LIVE_EMPTY",
    "SNAPBACK_CRON_WHILE_LIVE_KIND_MISMATCH",
    "SNAPBACK_CRON_WHILE_LIVE_MISSING",
    "SNAPBACK_CTX_LEDGER_EXHAUSTED",
    "SNAPBACK_CTX_LEDGER_ID_INVALID",
    "SNAPBACK_CTX_LEDGER_LIMIT_EXCEEDED",
    "SNAPBACK_CTX_LEDGER_UNUSED_IDS",
    "SNAPBACK_CTX_LEDGER_VERSION_UNSUPPORTED",
    "SNAPBACK_DATA_TIER_VERSION_REQUIRED",
    "SNAPBACK_DATA_TIER_VERSION_UNSUPPORTED",
    "SNAPBACK_EPHEMERAL_INVALID_SCOPE",
    "SNAPBACK_EPHEMERAL_INVALID_TTL",
    "SNAPBACK_EPHEMERAL_MISSING_KEY",
    "SNAPBACK_EPHEMERAL_MISSING_OWNER",
    "SNAPBACK_EPHEMERAL_ROOM_LIMIT_EXCEEDED",
    "SNAPBACK_EPHEMERAL_UNAUTHORIZED",
    "SNAPBACK_EPHEMERAL_UNKNOWN_COLLECTION",
    "SNAPBACK_EXPECTED_STRING",
    "SNAPBACK_EXPLAIN_KIND_UNIMPLEMENTED",
    "SNAPBACK_EXPLAIN_KIND_UNKNOWN",
    "SNAPBACK_EXPR_TYPE",
    "SNAPBACK_EXPR_UNANALYZABLE",
    "SNAPBACK_EXPR_UNSUPPORTED_FUNCTION",
    "SNAPBACK_FIELD_ENUM_VALUE_INVALID",
    "SNAPBACK_FIELD_MISSING",
    "SNAPBACK_FIELD_TYPE_MISMATCH",
    "SNAPBACK_FUNCTION_CONTRACT_HASH_INVALID",
    "SNAPBACK_FUNCTION_HANDLER_FORM_INVALID",
    "SNAPBACK_FUNCTION_IDENTITY_COLLISION",
    "SNAPBACK_FUNCTION_IDENTITY_INVALID",
    "SNAPBACK_FUNCTION_KIND_MISMATCH",
    "SNAPBACK_FUNCTION_KIND_RUNTIME_MISMATCH",
    "SNAPBACK_FUNCTION_NOT_LIVE",
    "SNAPBACK_FUNCTION_SCHEMA_REFERENCE_INVALID",
    "SNAPBACK_TABLE_VISIBILITY_ANY_OF_ARMS_INVALID",
    "SNAPBACK_TABLE_VISIBILITY_ANY_OF_ARM_INVALID",
    "SNAPBACK_TABLE_VISIBILITY_ANY_OF_DUPLICATE_ARM",
    "SNAPBACK_TABLE_VISIBILITY_AUTHORIZATION_DEPENDENCE_MISMATCH",
    "SNAPBACK_TABLE_VISIBILITY_MEMBERSHIP_DECLARATION_UNKNOWN",
    "SNAPBACK_TABLE_VISIBILITY_MEMBERSHIP_ROLES_INVALID",
    "SNAPBACK_TABLE_VISIBILITY_MEMBERSHIP_ROLE_UNKNOWN",
    "SNAPBACK_TABLE_VISIBILITY_OWNER_FIELD_UNKNOWN",
    "SNAPBACK_TABLE_VISIBILITY_PLAN_MISMATCH",
    "SNAPBACK_TABLE_VISIBILITY_RESOURCE_FIELD_UNKNOWN",
    "SNAPBACK_TABLE_VISIBILITY_RESOURCE_FIELD_TYPE_MISMATCH",
    "SNAPBACK_ORDER_FIELD_MAX_ENCODED_BYTES_EXCEEDED",
    "SNAPBACK_RESULT_CONTRACT_KIND_MISMATCH",
    "SNAPBACK_APP_REFUSAL",
    "SNAPBACK_FUNCTION_REFUSAL_DECLARATION_INVALID",
    "SNAPBACK_FUNCTION_TRACKED_REFUSAL_INVALID",
    "SNAPBACK_BOUNDED_SKEW_DECLARATION_INVALID",
    "SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED",
    "SNAPBACK_HANDLER_CAPABILITY_DENIED",
    "SNAPBACK_HANDLER_DID_NOT_SETTLE",
    "SNAPBACK_HANDLER_EXPORT_MISSING",
    "SNAPBACK_HANDLER_FAILED",
    "SNAPBACK_HANDLER_HOST_CALL_INVALID",
    "SNAPBACK_HANDLER_HOST_CALL_INVALID_JSON",
    "SNAPBACK_HANDLER_HOST_CALL_MALFORMED",
    "SNAPBACK_HANDLER_HOST_CALL_UNKNOWN",
    "SNAPBACK_FUNCTION_ARGS_CONTRACT_INVALID",
    "SNAPBACK_FUNCTION_ARGS_CONTRACT_VIOLATION",
    "SNAPBACK_HANDLER_RESULT_CONTRACT_INVALID",
    "SNAPBACK_HANDLER_RESULT_CONTRACT_VIOLATION",
    // LLP 0211 structured declarations/carriers are authored schema, and a
    // value-shape refusal is caller input outside that authored contract.
    "SNAPBACK_SCHEMA_STRUCTURED_INDEX_UNSUPPORTED",
    "SNAPBACK_STRUCTURED_CONTRACT_HASH_INVALID",
    "SNAPBACK_STRUCTURED_CONTRACT_INVALID",
    "SNAPBACK_STRUCTURED_VALUE_INVALID",
    "SNAPBACK_HANDLER_RESULT_INVALID",
    "SNAPBACK_HANDLER_STALE_CONTINUATION",
    "SNAPBACK_HANDLER_UNHANDLED_REJECTION",
    "SNAPBACK_UNHANDLED_REJECTION",
    "SNAPBACK_HANDLER_UNDECLARED_READ",
    "SNAPBACK_HANDLER_UNDECLARED_WRITE",
    "SNAPBACK_HANDLER_WRITE_IN_QUERY",
    "SNAPBACK_MUTATION_SETTLEMENT_UNAVAILABLE",
    "SNAPBACK_SEQUENCE_DECLARATION_INVALID",
    "SNAPBACK_SEQUENCE_UNDECLARED",
    "SNAPBACK_SNAPSHOT_BATCH_PLAN_INVALID",
    "SNAPBACK_SNAPSHOT_BATCH_NODE_INELIGIBLE",
    "SNAPBACK_SNAPSHOT_BATCH_CEILING_EXCEEDED",
    "SNAPBACK_SNAPSHOT_BATCH_RESULT_CONTRACT_INVALID",
    "SNAPBACK_SNAPSHOT_BATCH_CURSOR_BUDGET_EXCEEDED",
    "SNAPBACK_SNAPSHOT_BATCH_CURSOR_INVALID",
    "SNAPBACK_SNAPSHOT_BATCH_LIVE_CURSOR_UNSUPPORTED",
    "SNAPBACK_SEARCH_CURSOR_RESTART",
    "SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID",
    "SNAPBACK_SEARCH_MAINTENANCE_LIMIT",
    "SNAPBACK_SEARCH_QUERY_INVALID",
    "SNAPBACK_SEARCH_QUERY_PLAN_INVALID",
    "SNAPBACK_SEARCH_SOURCE_LIMIT",
    "SNAPBACK_SEARCH_WORK_LIMIT",
    "SNAPBACK_WRITE_WITH_ACTIVITY_PLAN_INVALID",
    "SNAPBACK_HOST_OP_CLI_ONLY",
    "SNAPBACK_HOST_OP_FUNCTION_KIND_UNSUPPORTED",
    "SNAPBACK_HOST_OP_FUNCTION_UNKNOWN",
    "SNAPBACK_HOST_OP_INPUT_MISSING",
    "SNAPBACK_HOST_OP_UNIMPLEMENTED",
    "SNAPBACK_HOST_OP_UNKNOWN",
    "SNAPBACK_INVALID_FLOAT",
    "SNAPBACK_JOB_ACTION_UNKNOWN",
    "SNAPBACK_JOB_ARGS_INVALID",
    "SNAPBACK_JOB_ATTEMPT_POLICY_INVALID",
    "SNAPBACK_JOB_CALLEE_NOT_ADMITTED",
    "SNAPBACK_JOB_DELAY_INVALID",
    "SNAPBACK_JOB_ENQUEUE_LIMIT_EXCEEDED",
    "SNAPBACK_JOB_ENQUEUE_UNAVAILABLE",
    "SNAPBACK_JOB_IDEMPOTENCY_KEY_INVALID",
    "SNAPBACK_JOB_STATUS_ARGS_INVALID",
    "SNAPBACK_INVALID_IDENTIFIER",
    "SNAPBACK_LIVE_RESUME_FUNCTION_MISMATCH",
    "SNAPBACK_MEMBERSHIP_ACTIVATION_DANGLING_RESOURCE",
    "SNAPBACK_MEMBERSHIP_ACTIVATION_DUPLICATE",
    "SNAPBACK_MEMBERSHIP_ACTIVATION_AXIS_MISSING",
    "SNAPBACK_MEMBERSHIP_ACTIVATION_NULL_AXIS",
    "SNAPBACK_MEMBERSHIP_ACTIVATION_TABLE_MISSING",
    "SNAPBACK_MEMBERSHIP_ACTIVATION_UNKNOWN_ROLE",
    "SNAPBACK_MEMBERSHIP_ACTIVATION_UNPROTECTED_RESOURCE",
    "SNAPBACK_MEMBERSHIP_APP_SCOPE_RESOURCE",
    "SNAPBACK_MEMBERSHIP_APP_SCOPE_RESOURCE_TABLE",
    "SNAPBACK_MEMBERSHIP_AXIS_COLLISION",
    "SNAPBACK_MEMBERSHIP_AXIS_FIELD_UNKNOWN",
    "SNAPBACK_MEMBERSHIP_OPERATION_INVALID",
    // @ref LLP 0240#d3-generate-the-ordinary-roster-and-role-surface — a
    // forged or mismatched generated-operation identity is malformed input.
    "SNAPBACK_GENERATED_AUTHORITY_OPERATION_INVALID",
    "SNAPBACK_MEMBERSHIP_BOOTSTRAP_ROLE_UNKNOWN",
    "SNAPBACK_MEMBERSHIP_CONFUSABLE_ROLES",
    "SNAPBACK_MEMBERSHIP_DUPLICATE_ROLE",
    "SNAPBACK_MEMBERSHIP_EMPTY_ROLE_LIST",
    "SNAPBACK_MEMBERSHIP_EMPTY_VOCABULARY",
    "SNAPBACK_MEMBERSHIP_EXPIRY_EFFECT_UNSUPPORTED",
    "SNAPBACK_MEMBERSHIP_EXPIRY_FIELD_AXIS",
    "SNAPBACK_MEMBERSHIP_EXPIRY_FIELD_TYPE",
    "SNAPBACK_MEMBERSHIP_EXPIRY_FIELD_UNKNOWN",
    "SNAPBACK_MEMBERSHIP_ID_COLLISION",
    "SNAPBACK_MEMBERSHIP_ID_INVALID",
    "SNAPBACK_IMPERSONATED_GLOBAL_ROLE_AMBIGUOUS",
    "SNAPBACK_IMPERSONATED_GLOBAL_ROLE_INVALID",
    "SNAPBACK_MEMBERSHIP_INCIDENTAL_FLOOR",
    "SNAPBACK_MEMBERSHIP_INCIDENTAL_UNKNOWN",
    "SNAPBACK_MEMBERSHIP_INDEX_NAME_COLLISION",
    "SNAPBACK_MEMBERSHIP_LAST_HOLDER_APP_SCOPE",
    "SNAPBACK_MEMBERSHIP_LAST_HOLDER_BOOTSTRAP_MISMATCH",
    "SNAPBACK_MEMBERSHIP_LAST_HOLDER_ROLE_UNKNOWN",
    "SNAPBACK_MEMBERSHIP_OPTIONAL_KEY_AXIS",
    "SNAPBACK_MEMBERSHIP_PERMISSION_BACKING_CONFLICT",
    "SNAPBACK_MEMBERSHIP_PRINCIPAL_TYPE",
    "SNAPBACK_MEMBERSHIP_PROVENANCE_FIELD_RESERVED",
    "SNAPBACK_MEMBERSHIP_RESERVED_ROLE",
    "SNAPBACK_MEMBERSHIP_RESOURCE_AXIS_REQUIRED",
    "SNAPBACK_MEMBERSHIP_RESOURCE_REF_INVALID",
    "SNAPBACK_MEMBERSHIP_RESOURCE_TABLE_MISMATCH",
    "SNAPBACK_MEMBERSHIP_RESOURCE_TABLE_REQUIRED",
    "SNAPBACK_MEMBERSHIP_RESOURCE_TABLE_UNKNOWN",
    "SNAPBACK_MEMBERSHIP_RESOURCE_TYPE",
    "SNAPBACK_MEMBERSHIP_ROLE_CONTROL_CHARACTER",
    "SNAPBACK_MEMBERSHIP_ROLE_EMPTY",
    "SNAPBACK_MEMBERSHIP_ROLE_PENDING_OVERLAP",
    "SNAPBACK_MEMBERSHIP_ROLE_RESERVED_SEPARATOR",
    "SNAPBACK_MEMBERSHIP_ROLE_TYPE",
    "SNAPBACK_MEMBERSHIP_TRANSITION_AXIS_FIELD",
    "SNAPBACK_MEMBERSHIP_TRANSITION_EMPTY_SET",
    "SNAPBACK_MEMBERSHIP_TRANSITION_GRAMMAR",
    "SNAPBACK_MEMBERSHIP_TRANSITION_SELF_ON_OTHER",
    "SNAPBACK_MEMBERSHIP_TRANSITION_UNKNOWN_CALLER",
    "SNAPBACK_MEMBERSHIP_TRANSITION_UNKNOWN_FIELD",
    "SNAPBACK_MEMBERSHIP_TRANSITION_UNKNOWN_ROLE",
    "SNAPBACK_MEMBERSHIP_UNKNOWN_DECLARATION",
    "SNAPBACK_MEMBERSHIP_UNKNOWN_ROLE",
    "SNAPBACK_PERMISSIONS_UNAVAILABLE_IN_ACTION",
    "SNAPBACK_MEMBERSHIP_NULL_AXIS",
    "SNAPBACK_MEMBERSHIP_BOOTSTRAP_INITIAL_MEMBERS_INVALID",
    "SNAPBACK_MEMBERSHIP_BOOTSTRAP_DUPLICATE_PRINCIPAL",
    "SNAPBACK_MEMBERSHIP_BOOTSTRAP_RESOURCE_UNEXPECTED",
    "SNAPBACK_MEMBERSHIP_RESOURCE_MISSING",
    "SNAPBACK_MEMBERSHIP_RESOURCE_UNEXPECTED",
    "SNAPBACK_MEMBERSHIP_TARGET_MISSING",
    "SNAPBACK_MEMBERSHIP_PATCH_AXIS",
    "SNAPBACK_MEMBERSHIP_NOT_DECLARED",
    "SNAPBACK_MEMBERSHIP_PRINCIPAL_ADDRESSED_UNDECLARED",
    "SNAPBACK_MEMBERSHIP_PRINCIPAL_ADDRESSED_INVALID",
    "SNAPBACK_MEMBERSHIP_PRINCIPAL_INVALID",
    "SNAPBACK_MEMBERSHIP_TARGET_SELF",
    // LLP 0240 D3 authority-profile author-input refusals.
    "SNAPBACK_AUTHORITY_PROFILE_INVALID",
    "SNAPBACK_AUTHORITY_PROFILE_REQUIRED",
    "SNAPBACK_AUTHORITY_PROFILE_ROSTER_INVALID",
    "SNAPBACK_CUSTOM_AUTHORIZATION_MANIFEST_INVALID",
    "SNAPBACK_AUTHORITY_ROSTER_CURSOR_INVALID",
    "SNAPBACK_AUTHORITY_ROSTER_PAGE_INVALID",
    "SNAPBACK_AUTHORITY_TRANSFER_OWNER_TARGET_INACTIVE",
    "SNAPBACK_AUTHORITY_TRANSFER_OWNER_TARGET_INVALID",
    "SNAPBACK_AUTHORITY_TRANSFER_OWNER_TARGET_SELF",
    "SNAPBACK_AUTHORITY_TRANSFER_OWNER_UNSUPPORTED",
    "SNAPBACK_MEMBERSHIP_NO_BOOTSTRAP_ROLE",
    "SNAPBACK_MEMBERSHIP_BOOTSTRAP_RESOURCE_MISMATCH",
    "SNAPBACK_MEMBERSHIP_BOOTSTRAP_APP_SCOPE",
    "SNAPBACK_MEMBERSHIP_TEARDOWN_RESOURCE_MISSING",
    "SNAPBACK_MEMBERSHIP_NO_EXPIRY",
    "SNAPBACK_MEMBERSHIP_PRIVILEGED_WRITER_MATRIX",
    "SNAPBACK_MEMBERSHIP_PRIVILEGED_WRITER_REQUIRED",
    "SNAPBACK_PERMISSION_SCOPE_MISSING",
    "SNAPBACK_PLAN_BOUNDS",
    "SNAPBACK_PLAN_INVALID",
    "SNAPBACK_RELATIONAL_PLAN_INVALID",
    "SNAPBACK_BOUNDED_CHILDREN_PLAN_INVALID",
    "SNAPBACK_BOUNDED_CHILDREN_INDEX_INVALID",
    "SNAPBACK_BOUNDED_CHILDREN_PROJECTION_INVALID",
    "SNAPBACK_BOUNDED_CHILDREN_RESULT_CONTRACT_INVALID",
    "SNAPBACK_BOUNDED_CHILDREN_CURSOR_INVALID",
    "SNAPBACK_BOUNDED_CHILDREN_LIVE_CURSOR_UNSUPPORTED",
    "SNAPBACK_ACTIVITY_CLIENT_MUTATION_REQUIRED",
    "SNAPBACK_RELATION_SCHEMA_INVALID",
    "SNAPBACK_RELATION_FOREIGN_KEY_INVALID",
    "SNAPBACK_RELATION_INCARNATION_WRITE_PROTECTED",
    "SNAPBACK_FUNCTION_EFFECT_CEILING_EXCEEDED",
    "SNAPBACK_MIGRATION_PLAN_INVALID",
    "SNAPBACK_MIGRATION_PROFILE_UNSUPPORTED",
    "SNAPBACK_MIGRATION_TARGET_MISMATCH",
    "SNAPBACK_MIGRATION_REHEARSAL_INVALID",
    "SNAPBACK_PROJECTION_PLAN_INVALID",
    "SNAPBACK_RELATIONAL_DISCLOSURE_REQUIRED",
    "SNAPBACK_PROJECTION_WRITE_BUDGET_EXCEEDED",
    "SNAPBACK_PROJECTION_OUTPUT_WRITE_DENIED",
    "SNAPBACK_PROJECTION_OUTPUT_READ_UNENFORCED",
    "SNAPBACK_PROJECTION_MAINTENANCE_INVALID",
    "SNAPBACK_PLAN_SOURCE_INVALID",
    "SNAPBACK_BATCH_READ_INPUT_INVALID",
    "SNAPBACK_BATCH_READ_INDEX_INVALID",
    "SNAPBACK_BATCH_READ_KEY_INVALID",
    "SNAPBACK_QUERY_FILTER_UNSUPPORTED_FIELD_TYPE",
    "SNAPBACK_QUERY_FILTER_BINDINGS_EXCEEDED",
    "SNAPBACK_QUERY_FILTER_VALUE_INVALID",
    "SNAPBACK_QUERY_IN_ITEMS_EXCEEDED",
    "SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED",
    "SNAPBACK_QUERY_LIMIT_INVALID",
    "SNAPBACK_QUERY_ORDER_UNSUPPORTED_FIELD_TYPE",
    "SNAPBACK_QUERY_UNKNOWN_INDEX",
    "SNAPBACK_SINGLE_TABLE_PLAN_INVALID",
    "SNAPBACK_SINGLE_TABLE_EXAMINED_ENTRY_CEILING_EXCEEDED",
    "SNAPBACK_RELATIONAL_CARDINALITY_UNPROVEN",
    "SNAPBACK_RELATIONAL_CURSOR_INVALID",
    "SNAPBACK_STANDARD_PATTERN_CURSOR_INVALID",
    "SNAPBACK_STANDARD_PATTERN_MEMBERSHIP_INVALID",
    "SNAPBACK_REQUEST_JSON_INVALID",
    "SNAPBACK_SEED_DECLARATION_INVALID",
    "SNAPBACK_SEED_INVALID",
    "SNAPBACK_SEED_ASSET_FIXTURE_PLACEMENT_INVALID",
    "SNAPBACK_SEED_ASSET_FIXTURE_UNKNOWN",
    "SNAPBACK_SEED_ASSET_FIXTURE_UNRESOLVED",
    "SNAPBACK_ASSET_SEED_FIXTURE_DIGEST_MISMATCH",
    "SNAPBACK_SCHEMA_DUPLICATE_FIELD",
    "SNAPBACK_SCHEMA_DUPLICATE_INDEX",
    "SNAPBACK_SCHEMA_DUPLICATE_TABLE",
    "SNAPBACK_SCHEMA_EMPTY_INDEX",
    "SNAPBACK_SCHEMA_ENUM_DOMAIN_BACKFILL_REQUIRED",
    "SNAPBACK_SCHEMA_ENUM_DOMAIN_INVALID",
    "SNAPBACK_SCHEMA_FIELD_RETYPED",
    "SNAPBACK_SCHEMA_INDEX_NAME_COLLISION",
    "SNAPBACK_SCHEMA_INDEX_WHERE_APPLICABLE_MISMATCH",
    "SNAPBACK_SCHEMA_PERMISSION_FIELDS_WITHOUT_BACKING",
    "SNAPBACK_SCHEMA_PERMISSION_FIELD_DUPLICATE",
    "SNAPBACK_SCHEMA_PERMISSION_FIELD_UNKNOWN",
    "SNAPBACK_SCHEMA_PARSE_FAILED",
    "SNAPBACK_SCHEMA_SYSTEM_FIELD",
    "SNAPBACK_SCHEMA_UNIQUE_INDEX_OPTIONAL_FIELD",
    "SNAPBACK_STALE_FUNCTION_ARTIFACT_KIND",
    "SNAPBACK_STALE_FUNCTION_ARTIFACT_VERSION",
    "SNAPBACK_STALE_SCHEMA_ARTIFACT_KIND",
    "SNAPBACK_STALE_SCHEMA_ARTIFACT_VERSION",
    "SNAPBACK_SYSTEM_FIELD_WRITE",
    "SNAPBACK_TIMESTAMP_OUT_OF_RANGE",
    "SNAPBACK_UNSUPPORTED_BLOB",
    "SNAPBACK_VALUE_EXPR_AUTHORITATIVE_ONLY",
    "SNAPBACK_V8_COMPAT_CONFIG_INVALID",
    "SNAPBACK_V8_COMPAT_FLAG_REFUSED",
    "SNAPBACK_WEBSOCKET_MESSAGE_INVALID",
    "SNAPBACK_WEBSOCKET_SENDER_MISMATCH",
    "SNAPBACK_ASSET_MEDIA_TYPE_UNSUPPORTED",
    "SNAPBACK_ASSET_DEFERRED_LENGTH_UNSUPPORTED",
    "SNAPBACK_ASSET_LENGTH_MISMATCH",
    "SNAPBACK_ASSET_DIGEST_MISMATCH",
    "SNAPBACK_ASSET_REF_UNVERIFIED",
    "SNAPBACK_ASSET_ATTACH_INTENT_MISMATCH",
    "SNAPBACK_ASSET_ATTACH_UNAVAILABLE",
    "SNAPBACK_ASSET_ATTACH_DENIED",
    // LLP 0239 D2/D4 generated media-collection operations: client
    // contract faults (argument shape, missing attempt identity, count
    // bound, ordering, sharing selection/ceiling/derivation, raw-write
    // and command-only refusals) reviewed as 400 beside the attach family.
    "SNAPBACK_MEDIA_COLLECTION_ARGUMENT_INVALID",
    "SNAPBACK_MEDIA_COLLECTION_MUTATION_ATTEMPT_REQUIRED",
    "SNAPBACK_MEDIA_COLLECTION_LIMIT_EXCEEDED",
    "SNAPBACK_MEDIA_COLLECTION_REORDER_INVALID",
    "SNAPBACK_MEDIA_COLLECTION_CREATED_ORDER_REORDER_REFUSED",
    "SNAPBACK_MEDIA_COLLECTION_SHARING_SELECTION_INVALID",
    "SNAPBACK_MEDIA_COLLECTION_SHARING_OUTSIDE_CEILING",
    "SNAPBACK_MEDIA_COLLECTION_SHARING_DERIVATION_INVALID",
    "SNAPBACK_MEDIA_COLLECTION_RAW_WRITE_REFUSED",
    "SNAPBACK_MEDIA_COLLECTION_COMMAND_BINDING_REQUIRED",
    "SNAPBACK_MEDIA_COMMAND_BINDING_REQUIRED",
    "SNAPBACK_MEDIA_COMMAND_BINDING_INVALID",
    "SNAPBACK_MEDIA_COMMAND_MUTATION_ATTEMPT_REQUIRED",
    "SNAPBACK_MEDIA_COMMAND_ARGUMENT_INVALID",
    "SNAPBACK_ASSET_REQUEST_INVALID",
    "SNAPBACK_ASSET_TTL_INVALID",
    "SNAPBACK_PUSH_SEAM_AUTH_REQUIRED",
    "SNAPBACK_PUSH_SEAM_NOT_DECLARED",
    "SNAPBACK_JOB_PUSH_GRANT_INVALID",
    "SNAPBACK_PUSH_CONFIG_GRANT_MISSING",
    "SNAPBACK_PUSH_SEND_INVALID",
    "SNAPBACK_PUSH_TOKEN_INVALID",
    "SNAPBACK_PUSH_FIXTURE_CLOCK_REFUSED",
    "SNAPBACK_PUSH_LEDGER_ARGS_INVALID",
    "SNAPBACK_PUSH_LEDGER_NOT_DECLARED",
    "SNAPBACK_PUSH_REDRIVE_REFUSED",
];

const APP_API_BAD_REQUEST_DIAGNOSTICS: &[&str] = &["SNAPBACK_APP_API_ENVELOPE_HASH_INVALID"];

const UNAUTHORIZED_DIAGNOSTICS: &[&str] = &[
    "SNAPBACK_AUTH_OAUTH_INVALID_CLIENT",
    "SNAPBACK_ASSET_SIGNATURE_EXPIRED",
    "SNAPBACK_ADMIN_APPROVAL_INVALID",
    "SNAPBACK_ADMIN_CLAIM_INVALID",
    "SNAPBACK_ADMIN_SECRET_READ_REQUIRED",
    "SNAPBACK_ADMIN_TOKEN_REQUIRED",
    "SNAPBACK_AUTH_CODE_INVALID",
    "SNAPBACK_AUTH_CREDENTIAL_INVALID",
    "SNAPBACK_AUTH_AGENT_CREDENTIAL_INVALID",
    "SNAPBACK_AUTH_CREDENTIAL_CLASS_MISMATCH",
    "SNAPBACK_AUTH_CREDENTIAL_SUPERSEDED",
    "SNAPBACK_AUTH_GRANT_INVALID",
    "SNAPBACK_AUTH_SENDER_PROOF_INVALID",
    "SNAPBACK_AUTH_SENDER_PROOF_REPLAYED",
    "SNAPBACK_AUTH_SENDER_PROOF_REQUIRED",
    "SNAPBACK_AUTH_REQUIRED",
    "SNAPBACK_AUTH_STEP_UP_REQUIRED",
    "SNAPBACK_AUTH_SESSION_EXPIRED",
    "SNAPBACK_AUTH_STREAM_RESET",
    "SNAPBACK_AUTH_SCOPED_TOKEN_INVALID",
    "SNAPBACK_AUTH_GUEST_SESSION_INVALID",
    "SNAPBACK_AUTH_RECOVERY_CODE_INVALID",
    "SNAPBACK_AUTH_SESSION_INVALID",
    "SNAPBACK_AUTH_VERIFIED_PROOF_INVALID",
    "SNAPBACK_CONNECTION_AUTHORITY_MISMATCH",
    "SNAPBACK_CONNECTION_TOKEN_REQUIRED",
    "SNAPBACK_PUSH_SESSION_STALE",
    "SNAPBACK_PUSH_SESSION_REQUIRED",
];

const FORBIDDEN_DIAGNOSTICS: &[&str] = &[
    // LLP 0239 D2: collection parent authority denial.
    "SNAPBACK_MEDIA_COLLECTION_PARENT_FORBIDDEN",
    "SNAPBACK_EFFECT_APPROVAL_DENIED",
    "SNAPBACK_AUTH_ASSURANCE_INADMISSIBLE",
    "SNAPBACK_AUTH_BINDING_WRITE_FORBIDDEN",
    "SNAPBACK_AUTH_DEV_ORIGIN_REFUSED",
    "SNAPBACK_AUTH_PASSWORD_SET_AUTHORITY_INVALID",
    "SNAPBACK_AUTH_PROVISIONING_WRITE_FORBIDDEN",
    "SNAPBACK_AUTH_GUEST_CLAIM_UNAVAILABLE",
    "SNAPBACK_REMEDIATION_APPROVAL_REQUIRED",
    "SNAPBACK_WATCH_AUTHORITY_DEAD",
    "SNAPBACK_WATCH_ANCHOR_SCOPE_MISMATCH",
    "SNAPBACK_WATCH_OWNER_DENIED",
    "SNAPBACK_WATCH_RENEWAL_DENIED",
    "SNAPBACK_ASSET_GRANT_FORBIDDEN",
    "SNAPBACK_CAPABILITY_LINK_CALLER_ARG_DENIED",
    "SNAPBACK_CAPABILITY_LINK_FUNCTION_NOT_ANONYMOUS",
    "SNAPBACK_CAPABILITY_LINK_MINTER_INVALID",
    "SNAPBACK_CAPABILITY_LINK_MUTATION_APPROVAL_REQUIRED",
    "SNAPBACK_CAPABILITY_LINK_REVOKE_DENIED",
    "SNAPBACK_AUTH_REHEARSAL_CARRIER_REQUIRED",
    "SNAPBACK_AUTH_REHEARSAL_PROFILE_FORBIDDEN",
    "SNAPBACK_AUTH_REHEARSAL_CONFIG_FORBIDDEN",
    "SNAPBACK_AUTH_REHEARSAL_SCOPE_DENIED",
    "SNAPBACK_AUTH_REHEARSAL_SELECTOR_DENIED",
    "SNAPBACK_AUTH_REHEARSAL_BINDING_MISMATCH",
    "SNAPBACK_AUTH_REHEARSAL_EXPIRED",
    "SNAPBACK_AUTH_REHEARSAL_AUTHORITY_ENDED",
    "SNAPBACK_AUTH_REHEARSAL_REACHABILITY_PUBLIC",
    "SNAPBACK_AUTH_REHEARSAL_EGRESS_REFUSED",
    "SNAPBACK_API_ASK_AUTHORITY_REQUIRED",
    "SNAPBACK_API_ASK_DISABLED",
    "SNAPBACK_API_ASK_TOOL_DENIED",
    "SNAPBACK_STREAM_FORBIDDEN",
    "SNAPBACK_STREAM_INITIATOR_REQUIRED",
    "SNAPBACK_STREAM_TRANSCRIPT_FORBIDDEN",
    "SNAPBACK_AUTH_OAUTH_ACCESS_DENIED",
    // LLP 0204 S0 agent registration/invitation — policy refusals: the
    // surface is off, the caller may not mint, or the invitation is fenced.
    "SNAPBACK_AUTH_AGENT_INVITATIONS_DISABLED",
    "SNAPBACK_AUTH_AGENT_INVITATION_PROFILE_MISMATCH",
    "SNAPBACK_AUTH_AGENT_INVITATION_USER_INVALID",
    "SNAPBACK_AUTH_AGENT_REGISTRATION_DISABLED",
    "SNAPBACK_AUTH_AGENT_DESTROY_CAPABILITY_REQUIRED",
    "SNAPBACK_AUTH_INTEGRATION_INSTALLATION_REQUIRED",
    "SNAPBACK_AUTH_INTEGRATION_REVOKED",
    "SNAPBACK_AUTH_INTEGRATION_SUSPENDED",
    "SNAPBACK_AUTH_INTEGRATION_TEMPLATE_FORBIDDEN",
    "SNAPBACK_AUTH_INTEGRATION_UNAVAILABLE",
    "SNAPBACK_API_EXPOSURE_DENIED",
    "SNAPBACK_API_NOT_ENABLED",
    "SNAPBACK_API_DECLARED_CLIENTS_UNAVAILABLE",
    // LLP 0158/0163/0164 authorization and sealed-authority refusals.
    "SNAPBACK_BRANCH_AUTHORITY_DENIED",
    "SNAPBACK_BRANCH_EGRESS_DENIED",
    "SNAPBACK_FORK_APP_BINDING_MISMATCH",
    "SNAPBACK_HISTORY_AUTHORIZATION_DENIED",
    "SNAPBACK_OPERATION_ISSUANCE_AUTH_INVALID",
    "SNAPBACK_OPERATION_COVERAGE_ACTIVATION_AUTHORITY_INVALID",
    "SNAPBACK_OPERATION_RANGE_AUTH_INVALID",
    "SNAPBACK_PROMOTION_APPROVAL_INVALID",
    "SNAPBACK_PROMOTION_AUTHORITY_DENIED",
    "SNAPBACK_PROMOTION_REQUEST_SEAL_INVALID",
    "SNAPBACK_PROMOTION_TICKET_MISMATCH",
    "SNAPBACK_PROTECTED_ERASURE_AUTHORITY_INVALID",
    "SNAPBACK_NETWORK_PROFILE_FORBIDDEN",
    "SNAPBACK_ADMIN_DISABLED",
    // @ref LLP 0184#b-forced-live-resync--add-now
    "SNAPBACK_DEBUG_PERTURBATION_TARGET_REFUSED",
    "SNAPBACK_LIVE_FORCE_RESYNC_STARTUP_NONCE_MISMATCH",
    "SNAPBACK_ADMIN_APPROVAL_UNAVAILABLE",
    "SNAPBACK_ADMIN_CLAIM_UNAVAILABLE",
    "SNAPBACK_ADMIN_CONSOLE_MINT_UNAVAILABLE",
    "SNAPBACK_ADMIN_CONSOLE_RENEWAL_UNAVAILABLE",
    "SNAPBACK_ADMIN_RELAY_MASTER_CREDENTIAL_REFUSED",
    "SNAPBACK_ADMIN_RELAY_MASTER_ROUTE_REFUSED",
    "SNAPBACK_ADMIN_RELAY_ORIGIN_REFUSED",
    "SNAPBACK_ADMIN_RELAY_ROUTE_REFUSED",
    "SNAPBACK_FORK_EGRESS_DENIED",
    "SNAPBACK_STANDARD_PATTERN_PRINCIPAL_UNSUPPORTED",
    "SNAPBACK_MIGRATION_APPROVAL_REQUIRED",
    // LLP 0092 §0D.1 bundle authorization/sender refusals.
    "SNAPBACK_BUNDLE_IDEMPOTENCY_SENDER_MISMATCH",
    "SNAPBACK_BUNDLE_NOT_PUBLIC",
    "SNAPBACK_BUNDLE_REGISTER_REQUIRES_CREDENTIAL",
    "SNAPBACK_AUTH_AGENT_DEACTIVATED",
    "SNAPBACK_ADMIN_SECRET_READ_MINT_DENIED",
    "SNAPBACK_ADMIN_SECRET_READ_PROOF_INVALID",
    "SNAPBACK_ADMIN_SECRET_READ_PROOF_REQUIRED",
    "SNAPBACK_ADMIN_SECRET_READ_PROOF_REPLAYED",
    "SNAPBACK_ADMIN_SECRET_READ_PROOF_STALE",
    "SNAPBACK_ADMIN_SECRET_READ_PROOF_STARTUP_MISMATCH",
    "SNAPBACK_ADMIN_SECRET_READ_SCOPE_DENIED",
    // @ref LLP 0184#c-administrator-ephemeral-entry-delete--add-now —
    // these are target-policy refusals from the raw admin route.
    "SNAPBACK_EPHEMERAL_OPERATOR_DELETE_TARGET_REFUSED_DERIVED",
    "SNAPBACK_EPHEMERAL_OPERATOR_DELETE_TARGET_REFUSED_HOSTED",
    "SNAPBACK_AUTH_CODE_LOCKED",
    "SNAPBACK_AUTHORIZED_LEASE_AUTHORITY_INVALID",
    "SNAPBACK_AUTH_IMPERSONATION_REQUIRED",
    "SNAPBACK_DEV_IDENTITY_REFUSED",
    "SNAPBACK_AUTH_AUTHORITY_CREATING_UNCONSENTED",
    "SNAPBACK_AUTH_GRANT_SCOPE_DENIED",
    "SNAPBACK_AUTH_PERMISSION_DENIED",
    "SNAPBACK_TABLE_WRITE_POLICY_INELIGIBLE",
    "SNAPBACK_TABLE_WRITE_AUTHORITY_TABLE_INELIGIBLE",
    "SNAPBACK_CONNECTION_TOKEN_INVALID",
    "SNAPBACK_LIVE_RESUME_OWNERSHIP",
    // LLP 0056 M2 writer-class seam + transition-matrix authorization refusals.
    "SNAPBACK_MEMBERSHIP_RAW_WRITE_DENIED",
    "SNAPBACK_MEMBERSHIP_HOSTPLAN_WRITE_DENIED",
    "SNAPBACK_MEMBERSHIP_TRANSITION_DENIED",
    "SNAPBACK_MEMBERSHIP_NO_EFFECTIVE_PRINCIPAL",
    "SNAPBACK_MEMBERSHIP_INELIGIBLE_HOLDER",
    "SNAPBACK_MEMBERSHIP_INSERT_FIELD_DENIED",
    "SNAPBACK_MEMBERSHIP_READ_PRIVATE",
    "SNAPBACK_MEMBERSHIP_SWEEP_AUTHORITY",
    // LLP 0240 D1 owner-state authorization refusals.
    "SNAPBACK_AUTHORITY_OWNER_MUTATION_REQUIRES_TRANSFER",
    "SNAPBACK_AUTHORITY_TRANSFER_OWNER_DENIED",
    "SNAPBACK_PROFILE_FORBIDS",
    "SNAPBACK_ACTIVITY_AUTHORITY_UNPROVENANCED",
    "SNAPBACK_ASSET_FORBIDDEN",
    "SNAPBACK_ASSET_OWNER_CUSTODY_UNSATISFIABLE",
    "SNAPBACK_ASSET_ADMISSION_REVOKED",
    "SNAPBACK_ASSET_SIGNATURE_INVALID",
];

const NOT_FOUND_DIAGNOSTICS: &[&str] = &[
    // @ref LLP 0301#7a-diagnostic-code-matrix-pinned-before-the-freeze — the
    // identity fact is deliberately absent on the production profile.
    "SNAPBACK_APP_IDENTITY_UNAVAILABLE",
    "SNAPBACK_AUTH_GUEST_DISABLED",
    "SNAPBACK_EFFECT_NOT_FOUND",
    "SNAPBACK_WATCH_NOT_FOUND",
    "SNAPBACK_ASSET_GRANT_UNKNOWN",
    "SNAPBACK_CAPABILITY_LINK_FUNCTION_INVALID",
    "SNAPBACK_CAPABILITY_LINK_UNAVAILABLE",
    "SNAPBACK_STREAM_ATTEMPT_NOT_FOUND",
    "SNAPBACK_STREAM_TRANSCRIPT_NOT_FOUND",
    "SNAPBACK_BRANCH_NOT_FOUND",
    "SNAPBACK_CHECKPOINT_NOT_FOUND",
    "SNAPBACK_FORK_NOT_FOUND",
    "SNAPBACK_HISTORY_TABLE_UNKNOWN",
    "SNAPBACK_PROTECTED_ERASURE_TARGET_NOT_FOUND",
    "SNAPBACK_ADMIN_CLAIM_STATUS_INVALID",
    "SNAPBACK_ADMIN_RELAY_LEASE_INVALID",
    "SNAPBACK_ADMIN_REACHABILITY_SESSION_INVALID",
    "SNAPBACK_AUTH_AGENT_UNKNOWN",
    "SNAPBACK_AUTH_INTEGRATION_UNKNOWN",
    "SNAPBACK_API_DECLARED_CLIENT_UNKNOWN",
    // LLP 0239 D2: unknown collection parent/item share the asset-unknown
    // 404 class so probes learn nothing about hidden rows.
    "SNAPBACK_MEDIA_COLLECTION_PARENT_UNAVAILABLE",
    "SNAPBACK_MEDIA_COLLECTION_ITEM_UNKNOWN",
    "SNAPBACK_JOB_UNKNOWN",
    "SNAPBACK_BUNDLE_ROUTE_UNKNOWN",
    "SNAPBACK_ROUTE_UNKNOWN",
    "SNAPBACK_AUTH_MAILBOX_ENTRY_NOT_FOUND",
    "SNAPBACK_AUTH_MODE_DEV",
    // @ref LLP 0184#c-administrator-ephemeral-entry-delete--add-now — the
    // exactly inspected operator-delete target is absent.
    "SNAPBACK_EPHEMERAL_ENTRY_NOT_FOUND",
    "SNAPBACK_EPHEMERAL_ROOM_NOT_FOUND",
    "SNAPBACK_MEMBERSHIP_SELF_NOT_FOUND",
    "SNAPBACK_ROW_NOT_FOUND",
    "SNAPBACK_UNKNOWN_CRON_JOB",
    "SNAPBACK_UNKNOWN_FIELD",
    "SNAPBACK_UNKNOWN_FUNCTION",
    "SNAPBACK_UNKNOWN_SUBSCRIPTION",
    // @ref LLP 0184#b-forced-live-resync--add-now
    "SNAPBACK_LIVE_FORCE_RESYNC_SUBSCRIPTION_NOT_FOUND",
    "SNAPBACK_UNKNOWN_TABLE",
    "SNAPBACK_ERROR_ISSUE_NOT_FOUND",
    "SNAPBACK_ASSET_INTENT_UNKNOWN",
    "SNAPBACK_ASSET_ATTEMPT_UNKNOWN",
    "SNAPBACK_ASSET_UNKNOWN",
    "SNAPBACK_ASSET_VARIANT_UNKNOWN",
    "SNAPBACK_APP_API_ENVELOPE_UNKNOWN",
    "SNAPBACK_APP_API_UNAVAILABLE",
];

const CONFLICT_DIAGNOSTICS: &[&str] = &[
    "SNAPBACK_AUTH_GUEST_ALREADY_CLAIMED",
    "SNAPBACK_FUNCTION_GENERATION_REHYDRATION_MISMATCH",
    "SNAPBACK_EFFECT_BINDING_STALE",
    "SNAPBACK_AUTH_GUEST_CLAIM_COLLISION",
    "SNAPBACK_AUTH_IDENTITY_COLLISION",
    "SNAPBACK_AUTH_IDEMPOTENCY_CONFLICT",
    "SNAPBACK_AUTH_LAST_AUTHENTICATOR",
    "SNAPBACK_AUTH_LOGICAL_IMPORT_IDENTITY_COLLISION",
    "SNAPBACK_AUTH_LOGICAL_IMPORT_TARGET_NOT_EMPTY",
    "SNAPBACK_AUTH_MODE_CHANGED",
    "SNAPBACK_AUTH_PASSWORD_ALREADY_SET",
    "SNAPBACK_AUTH_PASSWORD_EXISTS",
    "SNAPBACK_AUTH_PROVISIONING_REPLAY_MISMATCH",
    // Catalog-v4 activation is one-way: redeclaring a different identifier
    // mode conflicts with the durable app identity contract.
    "SNAPBACK_AUTH_PASSWORD_IDENTIFIER_MODE_IMMUTABLE",
    // The successor pair is durable, but the startup-bound provider cannot
    // claim its new password minimum until the backend restarts.
    "SNAPBACK_AUTH_PASSWORD_POLICY_RESTART_REQUIRED",
    // @ref LLP 0146#oq6-author-ruling--2026-08-10 — stale remediation
    // bindings are conflicts, independent of the refusal that carried them.
    "SNAPBACK_REMEDIATION_ARTIFACT_STALE",
    // LLP 0239 D2: duplicate collection membership is an admission
    // conflict, not a malformed request.
    "SNAPBACK_MEDIA_COLLECTION_DUPLICATE_ASSET",
    "SNAPBACK_MEDIA_COLLECTION_DUPLICATE_ITEM",
    "SNAPBACK_EFFECT_STATE_INVALID",
    "SNAPBACK_WATCH_STATUS_INVALID",
    "SNAPBACK_ASSET_GRANTS_UNDECLARED",
    "SNAPBACK_ASSET_GRANT_CONFLICT",
    "SNAPBACK_ASSET_GRANT_STATE_INVALID",
    "SNAPBACK_AUTH_REHEARSAL_IDEMPOTENCY_CONFLICT",
    "SNAPBACK_AUTH_REHEARSAL_NAMESPACE_CONSUMED",
    "SNAPBACK_AUTH_REHEARSAL_DISPOSABLE_REQUIRED",
    "SNAPBACK_AUTH_REHEARSAL_STATE_PRESENT",
    "SNAPBACK_AUTH_REHEARSAL_ENVELOPE_INVALID",
    "SNAPBACK_STREAM_CANCELLED",
    "SNAPBACK_STREAM_RUNNER_FENCED",
    "SNAPBACK_STREAM_TERMINAL",
    "SNAPBACK_API_RUN_ENVELOPE_STALE",
    "SNAPBACK_AUTH_INTEGRATION_CATALOG_CORRUPT",
    "SNAPBACK_AUTH_INTEGRATION_CLASS_INVALID",
    "SNAPBACK_API_DECLARED_CLIENT_CATALOG_CORRUPT",
    // LLP 0158/0163/0164 current-state, CAS, and reseal conflicts.
    "SNAPBACK_BRANCH_ARTIFACT_DRIFT",
    "SNAPBACK_BRANCH_BASE_NOT_CURRENT",
    "SNAPBACK_BRANCH_CUSTODY_COLLISION",
    "SNAPBACK_BRANCH_FORECLOSED",
    "SNAPBACK_BRANCH_NOT_ACTIVE",
    "SNAPBACK_BRANCH_NOT_PROMOTABLE",
    "SNAPBACK_BRANCH_NO_COMMON_BASE",
    "SNAPBACK_BRANCH_OPERATION_ID_REUSED",
    "SNAPBACK_BRANCH_OPERATION_OUTCOME_UNKNOWN",
    "SNAPBACK_CHECKPOINT_DESTINATION_EXISTS",
    "SNAPBACK_CHECKPOINT_ERASURE_IDENTITY_REUSED",
    "SNAPBACK_CHECKPOINT_PROTECTED_ERASURE_FENCED",
    "SNAPBACK_CHECKPOINT_SOURCE_ADVANCED",
    "SNAPBACK_HISTORY_NOT_ENABLED",
    "SNAPBACK_HISTORY_POLICY_VERSION_CONFLICT",
    "SNAPBACK_HOST_INCARNATION_ROTATION_INVALID",
    "SNAPBACK_HOST_OPERATION_IDENTITY_REUSED",
    "SNAPBACK_HOST_OPERATION_LEASE_INVALID",
    "SNAPBACK_EPHEMERAL_CLEANUP_STARTUP_MISMATCH",
    "SNAPBACK_OPERATION_ALREADY_RECORDED",
    "SNAPBACK_OPERATION_EPOCH_STATE_INVALID",
    "SNAPBACK_OPERATION_EPOCH_UNAVAILABLE",
    "SNAPBACK_OPERATION_RANGE_OVERLAP",
    "SNAPBACK_OPERATION_RANGE_CONTINUITY_INVALID",
    "SNAPBACK_OPERATION_RANGE_COUNTER_REUSED",
    "SNAPBACK_OPERATION_TERMINAL_DIVERGED",
    "SNAPBACK_PROMOTION_CAPTURE_ONLY_UNSUPPORTED",
    "SNAPBACK_PROMOTION_APPROVED_FACTS_CONFLICT",
    "SNAPBACK_PROMOTION_BASE_ADVANCED",
    "SNAPBACK_PROMOTION_BASE_PRECONDITION_FAILED",
    "SNAPBACK_PROMOTION_DIFF_FACTS_MISMATCH",
    "SNAPBACK_PROMOTION_DIFF_STALE",
    "SNAPBACK_PROMOTION_HEAD_CHANGED",
    "SNAPBACK_PROMOTION_IDENTITY_REUSED",
    "SNAPBACK_PROMOTION_NOT_FIFO_HEAD",
    "SNAPBACK_PROMOTION_REBASE_DIVERGED",
    "SNAPBACK_PROMOTION_REBASE_LOG_EMPTY",
    "SNAPBACK_PROMOTION_REPLAY_DIVERGED",
    "SNAPBACK_PROMOTION_REQUEST_FACTS_DIVERGED",
    "SNAPBACK_PROMOTION_RESERVATION_EXPIRED",
    "SNAPBACK_PROMOTION_RESERVATION_NOT_ELIGIBLE",
    "SNAPBACK_PROMOTION_SCHEMA_DIVERGED",
    "SNAPBACK_PROMOTION_TICKET_IDENTITY_REUSED",
    "SNAPBACK_PROMOTION_WRITE_COVERAGE_INCOMPLETE",
    "SNAPBACK_PROMOTION_WRITE_PATH_UNCOVERED",
    "SNAPBACK_PROTECTED_ERASURE_BUSY",
    "SNAPBACK_PROTECTED_ERASURE_IDENTITY_REUSED",
    "SNAPBACK_ADMIN_RELAY_LEASE_CLAIM_MISMATCH",
    "SNAPBACK_ADMIN_RELAY_LEASE_CREDENTIAL_MISMATCH",
    "SNAPBACK_VECTOR_CORPUS_BOUND",
    "SNAPBACK_TELEMETRY_EXPORT_CONTINUATION_STALE",
    "SNAPBACK_TELEMETRY_EXPORT_SNAPSHOT_STALE",
    "SNAPBACK_JOB_IDEMPOTENCY_KEY_RACED",
    "SNAPBACK_JOB_IDEMPOTENCY_KEY_REUSED",
    "SNAPBACK_PROJECTION_FANOUT_EXCEEDED",
    "SNAPBACK_MIGRATION_RETAINED_WORK_INCOMPATIBLE",
    "SNAPBACK_MIGRATION_RESYNC_REQUIRED",
    "SNAPBACK_MIGRATION_UPGRADE_REQUIRED",
    "SNAPBACK_MIGRATION_PLAN_STALE",
    "SNAPBACK_MIGRATION_EXECUTOR_UNAVAILABLE",
    "SNAPBACK_MIGRATION_EXECUTOR_STALE",
    "SNAPBACK_MIGRATION_CANCELLED",
    "SNAPBACK_MIGRATION_STEP_FAILED",
    "SNAPBACK_MIGRATION_VERIFICATION_FAILED",
    "SNAPBACK_MIGRATION_ROLLBACK_UNAVAILABLE",
    "SNAPBACK_MIGRATION_PRECONDITION_FAILED",
    "SNAPBACK_MIGRATION_REHEARSAL_REQUIRED",
    "SNAPBACK_ACTION_GENERATION_CONFLICT",
    "SNAPBACK_BUNDLE_IDEMPOTENCY_EXPIRED",
    "SNAPBACK_BUNDLE_IDEMPOTENCY_SCOPE_MISMATCH",
    "SNAPBACK_ACTION_STREAM_CANCELLED",
    "SNAPBACK_OPERATION_CANCELLED",
    "SNAPBACK_OPERATION_IDENTITY_HORIZON_PASSED",
    "SNAPBACK_OPERATION_STORED_REFUSAL",
    "SNAPBACK_AUTH_AGENT_DEACTIVATION_WOULD_STRAND",
    "SNAPBACK_AUTH_AGENT_CREDENTIAL_EXISTS",
    "SNAPBACK_MEMBERSHIP_LAST_HOLDER_STRAND",
    "SNAPBACK_AUTHORITY_OWNER_COUNT_INVALID",
    "SNAPBACK_MEMBERSHIP_RESOURCE_DELETE_BLOCKED",
    "SNAPBACK_MEMBERSHIP_BOOTSTRAP_REQUIRED",
    "SNAPBACK_MEMBERSHIP_BATCH_UNSUPPORTED",
    "SNAPBACK_AUTH_CATALOG_OBJECT_COLLISION",
    "SNAPBACK_AUTH_INVALIDATION_EXPECTATION_STALE",
    "SNAPBACK_AUTH_INVALIDATION_PENDING",
    "SNAPBACK_AUTH_INVALIDATION_RESOLUTION_STALE",
    "SNAPBACK_AUTH_GRANT_PENDING",
    "SNAPBACK_AUTH_GRANT_SCOPE_STALE",
    "SNAPBACK_AUTH_RESNAPSHOT_REQUIRED",
    "SNAPBACK_AUTH_RETRY_NOT_EXHAUSTED",
    "SNAPBACK_AUTH_RETRY_NOT_PENDING",
    "SNAPBACK_AUTH_RESERVATION_STALE",
    "SNAPBACK_AUTHORIZED_LEASE_BOUNDARY_MISMATCH",
    "SNAPBACK_AUTHORIZED_LEASE_EXPIRED",
    "SNAPBACK_AUTHORIZED_LEASE_REQUEST_REUSED",
    "SNAPBACK_AUTHORIZED_LEASE_STALE",
    "SNAPBACK_AUTH_MODE_DOWNGRADE",
    "SNAPBACK_AUTH_REFRESH_SUPERSEDED",
    "SNAPBACK_AUTH_TABLE_COLLISION",
    "SNAPBACK_ARTIFACT_IDENTITY_MISMATCH",
    // @ref LLP 0184#b-forced-live-resync--add-now
    "SNAPBACK_LIVE_FORCE_RESYNC_CONNECTION_MISMATCH",
    "SNAPBACK_CLIENT_MUTATION_ID_REUSED",
    "SNAPBACK_CLIENT_MUTATION_LEGACY_AUTH_QUARANTINED",
    "SNAPBACK_CONFIG_VERIFY_STALE",
    "SNAPBACK_CONNECTION_TEARDOWN_PENDING",
    "SNAPBACK_EPHEMERAL_AUTHORITY_INSTANCE_CHANGED",
    "SNAPBACK_EPHEMERAL_INCOMPATIBLE_COLLECTION_DEFINITION",
    // @ref LLP 0184#c-administrator-ephemeral-entry-delete--add-now —
    // process, room-incarnation, and entry-generation fences conflict
    // with the caller's earlier observation.
    "SNAPBACK_EPHEMERAL_OPERATOR_DELETE_STALE_STARTUP_NONCE",
    "SNAPBACK_EPHEMERAL_STALE_ENTRY_GENERATION",
    "SNAPBACK_EPHEMERAL_STALE_SCOPE_EPOCH",
    "SNAPBACK_LIVE_STAGE_CONFLICT",
    "SNAPBACK_MUTATION_CONFLICT",
    "SNAPBACK_SCHEMA_REQUIRED_FIELD_BACKFILL_REQUIRED",
    "SNAPBACK_RELATIONAL_DUPLICATE_UNIQUE_KEY",
    "SNAPBACK_BOUNDED_CHILDREN_PARENT_RESTART_REQUIRED",
    "SNAPBACK_SNAPSHOT_BATCH_RESTART_REQUIRED",
    "SNAPBACK_RELATION_PARENT_UNAVAILABLE",
    "SNAPBACK_RELATION_ACTIVATION_BACKFILL_REQUIRED",
    "SNAPBACK_SEQUENCE_ACTIVATION_STATE_INVALID",
    "SNAPBACK_ACTIVITY_SOURCE_EFFECT_REQUIRED",
    "SNAPBACK_SEED_CROSS_MODE_UNSUPPORTED",
    "SNAPBACK_SEED_EFFECT_LIMIT_EXCEEDED",
    "SNAPBACK_SEED_IDENTITY_CORRUPT",
    "SNAPBACK_SEED_IDENTITY_CONFLICT",
    "SNAPBACK_SEED_MEMBERSHIP_BOOTSTRAP_UNSUPPORTED",
    "SNAPBACK_SEED_MIGRATION_REQUIRED",
    "SNAPBACK_SEED_NONEMPTY_UNTRACKED",
    "SNAPBACK_SEED_REPLAY_REQUIRES_PREFLIGHT",
    "SNAPBACK_SEED_OPERATION_HISTORICAL",
    "SNAPBACK_SEED_OPERATION_ID_REUSED",
    "SNAPBACK_SEED_PARTIAL_UNTRACKED",
    "SNAPBACK_SEED_VERSION_REUSED",
    "SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION",
    "SNAPBACK_ASSET_INTENT_STALE",
    "SNAPBACK_ASSET_INTENT_REVOKED",
    "SNAPBACK_ASSET_OFFSET_CONFLICT",
    "SNAPBACK_ASSET_ATTEMPT_TERMINAL",
    "SNAPBACK_ASSET_TRANSFER_INCOMPLETE",
    "SNAPBACK_ASSET_ADMISSION_STALE",
    "SNAPBACK_ASSET_ADMISSION_CONFLICT",
    "SNAPBACK_ASSET_GENERATION_STALE",
    "SNAPBACK_ASSET_NOT_READY",
    "SNAPBACK_ASSET_REFERENCED",
    "SNAPBACK_SEED_ASSET_FIXTURE_NOT_INGESTED",
    "SNAPBACK_PUSH_TOKEN_SCOPE_COLLISION",
    "SNAPBACK_PUSH_APP_SCOPE_CHANGE_BLOCKED",
    "SNAPBACK_PUSH_DEDUPE_CONFLICT",
    "SNAPBACK_PUSH_REDRIVE_NOT_AMBIGUOUS",
    "SNAPBACK_PUSH_REDRIVE_RACED",
];

const PAYLOAD_TOO_LARGE_DIAGNOSTICS: &[&str] = &[
    "SNAPBACK_BATCH_READ_ITEMS_EXCEEDED",
    "SNAPBACK_BATCH_READ_INPUT_BYTES_EXCEEDED",
    "SNAPBACK_BATCH_READ_RESPONSE_BYTES_EXCEEDED",
    "SNAPBACK_STREAM_CHUNK_TOO_LARGE",
    "SNAPBACK_STREAM_ATTEMPT_LIMIT_EXCEEDED",
    "SNAPBACK_STREAM_FINAL_TOO_LARGE",
    "SNAPBACK_API_RUN_PROGRAM_TOO_LARGE",
    // Bounded branch/checkpoint/proof byte work is request-size-shaped.
    "SNAPBACK_BRANCH_BYTE_LIMIT_EXCEEDED",
    "SNAPBACK_BRANCH_DIGEST_WORK_LIMIT_EXCEEDED",
    "SNAPBACK_BRANCH_DIFF_LIMIT_EXCEEDED",
    "SNAPBACK_CHECKPOINT_COPY_BUDGET_EXCEEDED",
    "SNAPBACK_CHECKPOINT_DIGEST_BUDGET_EXCEEDED",
    "SNAPBACK_PROOF_BUDGET_EXCEEDED",
    "SNAPBACK_ACTION_STREAM_LIMIT_EXCEEDED",
    "SNAPBACK_HOST_FETCH_RESPONSE_TOO_LARGE",
    "SNAPBACK_HANDLER_EVAL_OUTPUT_TOO_LARGE",
    // LLP 0092 §0D.2 bundle hard limits.
    "SNAPBACK_BUNDLE_LIMIT_BYTES",
    "SNAPBACK_BUNDLE_LIMIT_QUERIES",
    "SNAPBACK_BUNDLE_LIMIT_ROWS",
    "SNAPBACK_BUNDLE_LIMIT_TIME",
    "SNAPBACK_CLIENT_MUTATION_RESULT_TOO_LARGE",
    "SNAPBACK_EPHEMERAL_METADATA_TOO_LARGE",
    "SNAPBACK_JOB_ARGS_TOO_LARGE",
    "SNAPBACK_EPHEMERAL_VALUE_TOO_LARGE",
    "SNAPBACK_HANDLER_HOST_CALL_BODY_TOO_LARGE",
    // LLP 0211 canonical-byte ceilings are request-payload bounds.
    "SNAPBACK_STRUCTURED_ROW_BYTES_EXCEEDED",
    "SNAPBACK_STRUCTURED_VALUE_BYTES_EXCEEDED",
    "SNAPBACK_VALUE_TOO_LARGE",
    "SNAPBACK_WEBSOCKET_MESSAGE_TOO_LARGE",
    "SNAPBACK_ASSET_MEDIA_BOUNDS_EXCEEDED",
];

const TOO_MANY_REQUESTS_DIAGNOSTICS: &[&str] = &[
    "SNAPBACK_WATCH_BUDGET_EXHAUSTED",
    "SNAPBACK_AUTH_RATE_BUDGET",
    "SNAPBACK_AUTH_QUOTA_BUDGET",
    "SNAPBACK_WATCH_OWNER_EVALUATION_LIMIT",
    "SNAPBACK_ASSET_GRANT_QUOTA_EXCEEDED",
    "SNAPBACK_CAPABILITY_LINK_LIMIT_EXCEEDED",
    "SNAPBACK_AUTH_REHEARSAL_BUDGET_EXHAUSTED",
    "SNAPBACK_API_ASK_BUDGET_EXHAUSTED",
    "SNAPBACK_API_ASK_REQUEST_BUDGET_EXHAUSTED",
    "SNAPBACK_API_ASK_RESULT_VOLUME_EXHAUSTED",
    "SNAPBACK_API_ASK_STEP_LIMIT_EXHAUSTED",
    "SNAPBACK_STREAM_RATE_LIMITED",
    // LLP 0204 S0 — per-user live-invitation cap (a quota, not a fault).
    "SNAPBACK_AUTH_AGENT_INVITATION_CAP",
    // LLP 0204 S2-B — the composed external anonymous/declared/integration
    // admission ladder and reversible suspension refusals.
    "SNAPBACK_API_NETWORK_FLOOR_EXCEEDED",
    "SNAPBACK_API_DECLARED_LIMIT_EXCEEDED",
    "SNAPBACK_API_INTEGRATION_LIMIT_EXCEEDED",
    "SNAPBACK_API_DECLARED_CLIENT_SUSPENDED",
    "SNAPBACK_API_INTEGRATION_SUSPENDED",
    // Live-object, concurrent-WAL, finite-range, and contention capacity.
    "SNAPBACK_BRANCH_LIVE_LIMIT_EXCEEDED",
    "SNAPBACK_BRANCH_OPERATION_LIMIT_EXCEEDED",
    "SNAPBACK_CHECKPOINT_WAL_BUDGET_EXCEEDED",
    "SNAPBACK_FORK_RESOURCE_LIMIT_REFUSED",
    "SNAPBACK_OPERATION_RANGE_EXHAUSTED",
    "SNAPBACK_OPERATION_PENDING_CAPACITY_FULL",
    "SNAPBACK_PROMOTION_HEAD_RESERVED",
    "SNAPBACK_PROMOTION_CONTENTION_EXHAUSTED",
    "SNAPBACK_ACTION_PROGRESS_RATE_EXCEEDED",
    "SNAPBACK_ADMIN_APPROVAL_RATE_LIMITED",
    "SNAPBACK_ADMIN_CLAIM_RATE_LIMITED",
    "SNAPBACK_ADMIN_CONSOLE_CREDENTIAL_RATE_LIMITED",
    "SNAPBACK_ADMIN_REACHABILITY_CAPACITY",
    // LLP 0092 §0D.2/§0D.4 bundle rate and pending-owner capacity.
    "SNAPBACK_BUNDLE_PENDING_CAPACITY",
    "SNAPBACK_BUNDLE_RATE_LIMITED",
    "SNAPBACK_ADMIN_SECRET_READ_BUDGET_EXHAUSTED",
    "SNAPBACK_TELEMETRY_STATS_WORK_LIMIT_EXCEEDED",
    "SNAPBACK_TELEMETRY_QUERY_WORK_LIMIT_EXCEEDED",
    "SNAPBACK_TELEMETRY_SQL_BUDGET_EXCEEDED",
    "SNAPBACK_ADMIN_SECRET_READ_LEASE_CAPACITY_EXCEEDED",
    "SNAPBACK_ADMIN_SECRET_READ_PROOF_CAPACITY_EXCEEDED",
    "SNAPBACK_AUTH_THROTTLED",
    "SNAPBACK_AUTH_AGENT_CREDENTIAL_ROTATION_THROTTLED",
    "SNAPBACK_AUTH_GRANT_CAP",
    "SNAPBACK_AUTH_PAIRING_CODE_CAP",
    "SNAPBACK_AUTH_PAIRING_REQUEST_CAP",
    "SNAPBACK_AUTH_RETRY_EPISODE_CAPACITY",
    "SNAPBACK_CONNECTION_GRANT_LIMIT_EXCEEDED",
    "SNAPBACK_EPHEMERAL_RATE_LIMITED",
    "SNAPBACK_SUBSCRIPTION_CONNECTION_LIMIT",
    "SNAPBACK_SUBSCRIPTION_GLOBAL_LIMIT",
    "SNAPBACK_ASSET_QUOTA_EXCEEDED",
    "SNAPBACK_ASSET_CEILING_EXCEEDED",
];

const REQUEST_TIMEOUT_DIAGNOSTICS: &[&str] = &["SNAPBACK_REQUEST_BODY_TIMEOUT"];

const GATEWAY_TIMEOUT_DIAGNOSTICS: &[&str] = &[
    "SNAPBACK_API_ASK_WALL_TIME_EXHAUSTED",
    "SNAPBACK_FORK_ADMISSION_TIMEOUT",
    "SNAPBACK_FORK_BOOT_TIMEOUT",
    "SNAPBACK_FORK_STOP_TIMEOUT",
    "SNAPBACK_PROMOTION_COMMIT_TIMEOUT",
    "SNAPBACK_ACTION_STREAM_IDLE_TIMEOUT",
    "SNAPBACK_ACTION_STREAM_TIMEOUT",
    "SNAPBACK_ACTION_TIMEOUT",
    "SNAPBACK_HANDLER_WALL_CLOCK_EXCEEDED",
];

// @ref LLP 0076#settlement-and-retry — upstream transport outcomes are a
// distinct reviewed family: the upstream failed or is ambiguous, which is
// neither author fault nor Snapback's own internal failure.
const BAD_GATEWAY_DIAGNOSTICS: &[&str] = &[
    "SNAPBACK_WEBHOOK_DELIVERY_REJECTED",
    "SNAPBACK_WEBHOOK_DEAD_LETTERED",
    "SNAPBACK_API_ASK_UPSTREAM_FAILED",
    "SNAPBACK_API_ASK_UPSTREAM_INVALID",
    "SNAPBACK_ADMIN_RELAY_UPSTREAM_FAILED",
    "SNAPBACK_ADMIN_RELAY_UPSTREAM_INVALID",
    "SNAPBACK_ACTION_STREAM_UPSTREAM_AMBIGUOUS",
    "SNAPBACK_ACTION_STREAM_UPSTREAM_FAILED",
    // Buffered ctx.fetch upstream outcomes (0137 a4-f1/a5-f1).
    "SNAPBACK_HOST_FETCH_FAILED",
    "SNAPBACK_HOST_FETCH_RESPONSE_INVALID_UTF8",
    // LLP 0143 D3e: a successful provider response outside the closed
    // ticket/receipt vocabulary is an upstream protocol failure.
    "SNAPBACK_PUSH_PROVIDER_SHAPE_INVALID",
];

const MISDIRECTED_REQUEST_DIAGNOSTICS: &[&str] = &["SNAPBACK_ADMIN_RELAY_HOST_REFUSED"];
const NOT_IMPLEMENTED_DIAGNOSTICS: &[&str] = &[
    // Capability absence, not transient load: realtime.hasFreshClient
    // requires a session-auth application and never succeeds on retry for
    // one that is not. Matches ADMIN_RELAY_WEBSOCKET_UNAVAILABLE below.
    "SNAPBACK_CONNECTED_CLIENT_PREDICATE_UNAVAILABLE",
    "SNAPBACK_ADMIN_RELAY_WEBSOCKET_UNAVAILABLE",
    "SNAPBACK_API_RUN_UNTRUSTED_CODE_UNSUPPORTED",
    "SNAPBACK_AUTH_GUEST_CUSTODY_UNSUPPORTED",
    "SNAPBACK_AUTH_PASSWORD_SENDER_CONSTRAINED_UNSUPPORTED",
];

const OAUTH_503_DIAGNOSTICS: &[&str] = &["SNAPBACK_AUTH_OAUTH_UNAVAILABLE"];

const SERVICE_UNAVAILABLE_DIAGNOSTICS: &[&str] = &[
    "SNAPBACK_FUNCTION_GENERATION_AWAITING_RELOAD",
    "SNAPBACK_AUTH_PAIRING_COMMIT_TIMEOUT",
    "SNAPBACK_WRITER_ACQUIRE_TIMEOUT",
    "SNAPBACK_COMMIT_DEADLINE_EXCEEDED",
    "SNAPBACK_COMMIT_OUTCOME_UNCERTAIN",
    "SNAPBACK_COMMIT_UNCERTAIN_RETENTION_EXHAUSTED",
    "SNAPBACK_CONNECTED_CLIENT_CAPACITY",
    "SNAPBACK_WEBHOOK_TARGET_UNAVAILABLE",
    "SNAPBACK_AUTH_BUDGET_AUTHORITY_UNAVAILABLE",
    "SNAPBACK_WEBHOOK_DELIVERY_RETRYABLE",
    "SNAPBACK_AUTH_REHEARSAL_NAMESPACE_UNAVAILABLE",
    "SNAPBACK_AUTH_REHEARSAL_REACHABILITY_INVALID",
    "SNAPBACK_AUTH_REHEARSAL_PRODUCER_PARITY",
    "SNAPBACK_AUTH_REHEARSAL_EXPORT_KEY_UNAVAILABLE",
    "SNAPBACK_AUTH_REHEARSAL_PROVENANCE_INVALID",
    "SNAPBACK_API_ASK_EGRESS_DISABLED",
    "SNAPBACK_API_ASK_MODEL_NOT_CONFIGURED",
    "SNAPBACK_BRANCH_CUSTODY_RECOVERY_REQUIRED",
    "SNAPBACK_BRANCH_EXPIRY_REAP_REQUIRED",
    "SNAPBACK_CHECKPOINT_SOURCE_UNSUPPORTED",
    "SNAPBACK_HOST_OPERATION_ORDINAL_EXHAUSTED",
    "SNAPBACK_OPERATION_COVERAGE_UNAVAILABLE",
    "SNAPBACK_OPERATION_STREAM_UNAVAILABLE",
    "SNAPBACK_OPERATION_PROTECTED_CUSTODY_UNAVAILABLE",
    // LLP 0132: index readiness is transient, but retry waits for the
    // target's readiness state to change.
    "SNAPBACK_VECTOR_INDEX_UNAVAILABLE",
    "SNAPBACK_ACTION_CAPACITY_EXCEEDED",
    "SNAPBACK_HOST_FETCH_UNSUPPORTED",
    "SNAPBACK_RELATIONAL_CURSOR_MINT_UNAVAILABLE",
    "SNAPBACK_BOUNDED_CHILDREN_CURSOR_MINT_UNAVAILABLE",
    "SNAPBACK_SNAPSHOT_BATCH_CURSOR_MINT_UNAVAILABLE",
    "SNAPBACK_STANDARD_PATTERN_CURSOR_MINT_UNAVAILABLE",
    "SNAPBACK_MIGRATION_FENCE_CLOSED",
    "SNAPBACK_MIGRATION_BARRIER_FAILED",
    "SNAPBACK_ACTION_STREAM_UNSUPPORTED",
    "SNAPBACK_ADMIN_SECRET_READ_GENERATION_EXHAUSTED",
    "SNAPBACK_APP_GENERATION_EXHAUSTED",
    "SNAPBACK_AUTH_CATALOG_CORRUPT",
    "SNAPBACK_AUTH_CATALOG_VERSION_UNSUPPORTED",
    "SNAPBACK_AUTH_CLOCK_ROLLBACK",
    "SNAPBACK_AUTHORIZED_LEASE_KEY_UNAVAILABLE",
    "SNAPBACK_AUTHORIZED_LEASE_STATE_CORRUPT",
    "SNAPBACK_AUTHORIZED_LEASE_UNAVAILABLE",
    "SNAPBACK_AUTH_INVALIDATION_CAUSE_EXHAUSTED",
    "SNAPBACK_AUTH_INVALIDATION_CONNECTION_GENERATION_EXHAUSTED",
    "SNAPBACK_AUTH_INVALIDATION_ISSUER_EXHAUSTED",
    "SNAPBACK_AUTH_INVALIDATION_ISSUER_UNAVAILABLE",
    "SNAPBACK_AUTH_INVALIDATION_REVISION_EXHAUSTED",
    "SNAPBACK_AUTH_INVALIDATION_SCOPE_SEQUENCE_EXHAUSTED",
    "SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE",
    "SNAPBACK_AUTH_DEPLOYMENT_UNSUPPORTED",
    "SNAPBACK_AUTH_MODE_QUIESCENCE_TIMEOUT",
    "SNAPBACK_AUTH_MODE_DOWNGRADE_COMMITTED",
    "SNAPBACK_AUTH_MODE_STATE_CORRUPT",
    "SNAPBACK_AUTH_MODE_PENDING",
    "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
    "SNAPBACK_AUTH_PROJECTION_CORRUPT",
    "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE",
    "SNAPBACK_AUTH_RESERVATION_CANCELLED",
    "SNAPBACK_AUTH_PROVIDER_UNAVAILABLE",
    "SNAPBACK_AUTH_IDENTITY_CORE_REQUIRES_V3",
    "SNAPBACK_AUTH_GUEST_CATALOG_UNAVAILABLE",
    "SNAPBACK_AUTH_GUEST_CLEANUP_UNSUPPORTED",
    "SNAPBACK_AUTH_GUEST_POLICY_INVALID",
    "SNAPBACK_AUTH_PASSWORD_HASH_UNAVAILABLE",
    "SNAPBACK_AUTH_PASSWORD_RESET_UNAVAILABLE",
    "SNAPBACK_AUTH_PASSWORD_SIGNUP_UNAVAILABLE",
    "SNAPBACK_AUTH_RANDOM_UNAVAILABLE",
    // Exact predecessor catalogs remain operational, but the first-class
    // password provider is unavailable until an explicitly activated v4.
    "SNAPBACK_AUTH_PASSWORD_REQUIRES_V4",
    "SNAPBACK_RANDOM_UNAVAILABLE",
    "SNAPBACK_AUTH_EFFECTIVE_SOURCE_UNAVAILABLE",
    // LLP 0098 §6: forwarding metadata that is absent, malformed,
    // over-long, or presented by an untrusted peer leaves the origin with
    // no trustworthy source to throttle on, so the request fails closed
    // rather than being answered under a collapsed bucket.
    "SNAPBACK_AUTH_SOURCE_UNTRUSTED",
    "SNAPBACK_AUTH_THROTTLE_UNAVAILABLE",
    "SNAPBACK_AUTH_STEP_UP_DELIVERY_UNAVAILABLE",
    "SNAPBACK_AUTH_AGENT_COMMIT_UNCERTAIN",
    "SNAPBACK_AUTH_GRANT_COMMIT_UNCERTAIN",
    "SNAPBACK_AUTH_GRANT_STATE_CORRUPT",
    "SNAPBACK_AUTH_SCOPE_BASIS_CORRUPT",
    "SNAPBACK_AUTH_REVOCATION_UNCERTAIN",
    "SNAPBACK_AUTH_RETRY_EXHAUSTED",
    "SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH",
    "SNAPBACK_AUTH_STARTUP_ARTIFACT_REQUIRED",
    "SNAPBACK_AUTH_STREAM_INCARNATION_CORRUPT",
    "SNAPBACK_AUTHORIZATION_EPOCH_EXHAUSTED",
    "SNAPBACK_AUTHORIZATION_VERSION_CORRUPT",
    "SNAPBACK_STORAGE_VERSION_CORRUPT",
    "SNAPBACK_STORAGE_VERSION_EXHAUSTED",
    "SNAPBACK_SEQUENCE_EXHAUSTED",
    "SNAPBACK_PERMISSION_EPOCH_EXHAUSTED",
    "SNAPBACK_CAPABILITY_UNSUPPORTED",
    "SNAPBACK_CAPABILITY_EXACT_ADMIN_DIST_MISSING",
    "SNAPBACK_CAPABILITY_EXACT_NATIVE_ARTIFACTS_UNAVAILABLE",
    "SNAPBACK_CAPABILITY_EXACT_NATIVE_ARTIFACT_MISSING",
    "SNAPBACK_CAPABILITY_MINIFLARE_MISSING",
    "SNAPBACK_CAPABILITY_WORKERD_MISSING",
    "SNAPBACK_CRON_DISPATCH_CAPACITY_EXCEEDED",
    "SNAPBACK_CRON_DEFINITION_GENERATION_EXHAUSTED",
    "SNAPBACK_CRON_RUN_CAPACITY_EXCEEDED",
    "SNAPBACK_CRON_RUN_SEQUENCE_EXHAUSTED",
    "SNAPBACK_HANDLER_INVOCATION_EPOCH_EXHAUSTED",
    "SNAPBACK_CLIENT_MUTATION_RETENTION_FULL",
    "SNAPBACK_EPHEMERAL_AUTHORITY_PENDING",
    "SNAPBACK_EPHEMERAL_GENERATION_EXHAUSTED",
    "SNAPBACK_LIVE_STAGE_CAPACITY",
    "SNAPBACK_LIVE_STAGE_UNAVAILABLE",
    "SNAPBACK_OVERLOADED",
    "SNAPBACK_PUSH_ATTEMPT_EXHAUSTED",
    "SNAPBACK_PUSH_SEND_UNAVAILABLE",
    "SNAPBACK_PUSH_SEND_UNSUPPORTED",
    "SNAPBACK_READ_LANE_UNAVAILABLE",
    "SNAPBACK_SEARCH_INDEX_UNAVAILABLE",
    "SNAPBACK_V8_RUNNER_HOST_UNSUPPORTED",
];

// These literals include internal errors plus informational/warning
// diagnostics that never normally become an `ApiError`. If one does reach
// that boundary, the fail-safe class is still 500 rather than a false 4xx.
const INTERNAL_SERVER_ERROR_DIAGNOSTICS: &[&str] = &[
    // Internal stream-attempt persistence authority creation/verification
    // failures are server invariants, not caller authentication refusals.
    "SNAPBACK_ACTION_STREAM_PERSISTENCE_AUTHORITY_UNAVAILABLE",
    "SNAPBACK_ACTION_STREAM_PERSISTENCE_UNAUTHORIZED",
    // Engine-side commit/invocation invariants that can cross ApiError only as
    // server faults; they are not caller-authored graph admission failures.
    "SNAPBACK_COMMIT_CAPSULE_DESTINATION_MISMATCH",
    "SNAPBACK_COMMIT_INTENDED_ROWS_ABSENT",
    "SNAPBACK_COMMIT_RECONCILIATION_WITNESS_MISMATCH",
    "SNAPBACK_COMMIT_UNCERTAIN_RETENTION_ACTIVE",
    "SNAPBACK_COMMIT_UNCERTAIN_RETENTION_IDENTITY_MISMATCH",
    "SNAPBACK_COMMIT_UNCERTAIN_RETENTION_NOT_FOUND",
    "SNAPBACK_COMMIT_UNCERTAIN_RETENTION_TYPE_MISMATCH",
    "SNAPBACK_INVOCATION_AUTHORITY_INVALID",
    "SNAPBACK_BATCH_READ_UNIQUE_INVARIANT_CORRUPT",
    "SNAPBACK_AUTH_IDEMPOTENCY_INVALID",
    // LLP 0224 host-operation refusals travel inside the HTTP-200 operation
    // envelope, so this row is a fail-safe rather than a live status. Only
    // FACTS_UNAVAILABLE is a server-owned fact: it is a serialization or
    // canonical-hash failure over state the server holds. The other four
    // app-readiness refusals validate the caller's own app.readiness.v1 body
    // and are classified 400 below.
    "SNAPBACK_APP_READINESS_FACTS_UNAVAILABLE",
    "SNAPBACK_AUTH_BUDGET_POLICY_INVALID",
    "SNAPBACK_AUTH_BUDGET_STATE_INVALID",
    "SNAPBACK_AUTH_LOGICAL_EXPORT_INVALID",
    "SNAPBACK_EFFECT_CATALOG_CORRUPT",
    "SNAPBACK_WATCH_CATALOG_CORRUPT",
    "SNAPBACK_WATCH_JOB_INVALID",
    "SNAPBACK_WEBHOOK_CATALOG_CORRUPT",
    "SNAPBACK_WEBHOOK_DELIVERY_INVALID",
    "SNAPBACK_WEBHOOK_SECRET_UNAVAILABLE",
    "SNAPBACK_CAPABILITY_LINK_CATALOG_CORRUPT",
    "SNAPBACK_CTX_LEDGER_ID_KIND_MISMATCH",
    // LLP 0239 D2: a replayed collection item id diverging from its
    // mutation-attempt derivation is a determinism-integrity breach, like
    // the id-kind mismatch above; descriptor/storage integrity defects in
    // the generated collection stay truthful 500s.
    "SNAPBACK_CTX_LEDGER_DIVERGED",
    "SNAPBACK_MEDIA_COLLECTION_MANIFEST_INVALID",
    "SNAPBACK_MEDIA_COLLECTION_STORAGE_INVALID",
    "SNAPBACK_MEDIA_COMMAND_MANIFEST_INVALID",
    "SNAPBACK_MEDIA_COMMAND_PARENT_RESULT_INVALID",
    "SNAPBACK_REPLICATION_ACCESS_KEY_ID",
    "SNAPBACK_REPLICATION_ATTACH_REFUSED",
    "SNAPBACK_REPLICATION_CAPTURE_FAILED",
    "SNAPBACK_REPLICATION_CHECKPOINT_FAILED",
    "SNAPBACK_REPLICATION_CONFIG_INVALID",
    "SNAPBACK_REPLICATION_DATABASE_UNAVAILABLE",
    "SNAPBACK_REPLICATION_DISABLED",
    "SNAPBACK_REPLICATION_ENCRYPTION_FAILED",
    "SNAPBACK_REPLICATION_ENDPOINT",
    "SNAPBACK_REPLICATION_HEAD_CONFLICT",
    "SNAPBACK_REPLICATION_HEAD_MISSING",
    "SNAPBACK_REPLICATION_INTERVAL_MS",
    "SNAPBACK_REPLICATION_KEYRING_COVERAGE_INVALID",
    "SNAPBACK_REPLICATION_KEYRING_MISSING",
    "SNAPBACK_REPLICATION_KEY_FILE",
    "SNAPBACK_REPLICATION_KEY_INVALID",
    "SNAPBACK_REPLICATION_KEY_REQUIRED",
    "SNAPBACK_REPLICATION_LINEAGE_DIVERGED",
    "SNAPBACK_REPLICATION_METADATA_INVALID",
    "SNAPBACK_REPLICATION_OBJECT_EXISTS",
    "SNAPBACK_REPLICATION_PREFIX",
    "SNAPBACK_REPLICATION_REGION",
    "SNAPBACK_REPLICATION_RESTORE_INVALID",
    "SNAPBACK_REPLICATION_RESTORE_KEYRING_INVALID",
    "SNAPBACK_REPLICATION_RESTORE_KEYRING_MISSING",
    "SNAPBACK_REPLICATION_RESTORE_OUTSIDE_FRONTIER",
    "SNAPBACK_REPLICATION_RUNTIME_FAILED",
    "SNAPBACK_REPLICATION_SECRET_ACCESS_KEY",
    "SNAPBACK_REPLICATION_SESSION_TOKEN",
    "SNAPBACK_REPLICATION_SHUTDOWN_FAILED",
    "SNAPBACK_REPLICATION_STATE_UNAVAILABLE",
    "SNAPBACK_REPLICATION_STORE_UNAVAILABLE",
    "SNAPBACK_REPLICATION_TARGET",
    "SNAPBACK_REPLICATION_UPLOAD_FAILED",
    "SNAPBACK_REPLICATION_VERIFY_FAILED",
    "SNAPBACK_API_ASK_RECEIPT_INVALID",
    "SNAPBACK_API_ASK_RECEIPT_KEY_UNAVAILABLE",
    "SNAPBACK_API_ASK_SPEND_CATALOG_CORRUPT",
    "SNAPBACK_FUNCTION_GENERATION_EXHAUSTED",
    "SNAPBACK_FUNCTION_GENERATION_INVALID",
    "SNAPBACK_FUNCTION_GENERATION_STATE_CORRUPT",
    "SNAPBACK_STREAM_TRANSCRIPTS_UNAVAILABLE",
    "SNAPBACK_STREAM_TRANSCRIPT_CATALOG_CORRUPT",
    "SNAPBACK_STREAM_TRANSCRIPT_SETTLE_TIMEOUT",
    "SNAPBACK_AUTH_OAUTH_SERVER_ERROR",
    "SNAPBACK_AUTH_OAUTH_STATE_CORRUPT",
    // Local CLI, embedded-runtime, Guide-integrity, and migration-recovery
    // diagnostics already use the mapper's fail-safe 500 projection. Keep
    // them explicit so the production inventory remains exhaustive.
    "SNAPBACK_CLI_ARGUMENT_INVALID",
    "SNAPBACK_EMBED_APP_STATE_ALREADY_OWNED",
    "SNAPBACK_EMBED_APP_STATE_BUSY",
    "SNAPBACK_EMBED_ENTROPY_UNAVAILABLE",
    "SNAPBACK_GUIDE_LOOKUP_BUDGET_EXCEEDED",
    "SNAPBACK_GUIDE_REGISTRY_IDENTITY_MISMATCH",
    "SNAPBACK_MIGRATION_PREDECESSOR_SCHEMA_UNAVAILABLE",
    // Shutdown configuration and checkpoint failures are CLI/operator
    // diagnostics. They do not have a served request path, but retain an
    // explicit fail-safe projection in the exhaustive HTTP inventory.
    "SNAPBACK_SHUTDOWN_CHECKPOINT_TIMEOUT_MS",
    "SNAPBACK_SHUTDOWN_WAL_CHECKPOINT_INCOMPLETE",
    // @ref LLP 0184#b-forced-live-resync--add-now
    "SNAPBACK_LIVE_FORCE_RESYNC_ENCODE_FAILED",
    // @ref LLP 0184#a-bounded-direct-row-patch--add-now — these surface
    // only inside the host-ops `ok: false` envelope (HTTP 200), so retain
    // the reviewed fail-safe 500 projection if one ever crosses ApiError.
    "SNAPBACK_DATA_PATCH_APPLY_TOKEN_CONSUMED",
    "SNAPBACK_DATA_PATCH_APPLY_TOKEN_EXPIRED",
    "SNAPBACK_DATA_PATCH_APPLY_TOKEN_MISMATCH",
    "SNAPBACK_DATA_PATCH_APPLY_TOKEN_MISSING",
    "SNAPBACK_DATA_PATCH_AUTHORITY_INVALID",
    "SNAPBACK_DATA_PATCH_RESERVED_FIELD",
    "SNAPBACK_DATA_PATCH_STALE_VERSION",
    "SNAPBACK_DATA_PATCH_TARGET_REFUSED",
    "SNAPBACK_DATA_PATCH_UNKNOWN_FIELD",
    "SNAPBACK_DATA_PATCH_VALIDATION_FAILED",
    // @ref LLP 0184#c-administrator-ephemeral-entry-delete--add-now — an
    // impossible removal-message shape is a server invariant on the raw
    // admin route, not caller input.
    "SNAPBACK_EPHEMERAL_OPERATOR_DELETE_RECEIPT_INVALID",
    // Reviewed LLP 0158/0163/0164/0165 server-authored state, proof,
    // journal, custody, I/O, and test-crash invariants.
    "SNAPBACK_BENCH_RANGE_EXHAUSTED",
    "SNAPBACK_BENCH_STREAM_DIVERGED",
    "SNAPBACK_BRANCH_ACTION_SETTLEMENT_MISSING",
    "SNAPBACK_BRANCH_ARTIFACT_IDENTITY_MISSING",
    "SNAPBACK_BRANCH_ARTIFACT_INVALID",
    "SNAPBACK_BRANCH_CAUSAL_ORDER_INVALID",
    "SNAPBACK_BRANCH_CUSTODY_FAILED",
    "SNAPBACK_BRANCH_CUSTODY_INVALID",
    "SNAPBACK_BRANCH_CUSTODY_PATH_MISMATCH",
    "SNAPBACK_BRANCH_DIFF_JOURNAL_INCOMPLETE",
    "SNAPBACK_BRANCH_DIFF_DUPLICATE_ROW",
    "SNAPBACK_BRANCH_DIGEST_WORK_UNACCOUNTED",
    "SNAPBACK_BRANCH_EFFECT_CAPTURED",
    "SNAPBACK_BRANCH_EFFECT_CAPTURE_FAILED",
    "SNAPBACK_BRANCH_EFFECT_CONTEXT_MISSING",
    "SNAPBACK_BRANCH_EFFECT_LEDGER_INVALID",
    "SNAPBACK_BRANCH_EFFECT_ORDINAL_REUSED",
    "SNAPBACK_BRANCH_EFFECT_POLICY_INVALID",
    "SNAPBACK_BRANCH_EGRESS_MARKER_FAILED",
    "SNAPBACK_BRANCH_FILE_CUSTODY_REQUIRED",
    "SNAPBACK_BRANCH_HANDLER_FAILED",
    "SNAPBACK_BRANCH_OPERATION_JOURNAL_INCOMPLETE",
    "SNAPBACK_BRANCH_OPERATION_RESERVATION_MISSING",
    "SNAPBACK_BRANCH_PROFILE_MISSING",
    "SNAPBACK_BRANCH_STREAM_MISSING",
    "SNAPBACK_CHECKPOINT_COPY_FAILED",
    "SNAPBACK_CHECKPOINT_COPY_FIDELITY_FAILED",
    "SNAPBACK_CHECKPOINT_ERASURE_REGISTRY_CORRUPT",
    "SNAPBACK_CHECKPOINT_ERASURE_TEST_CRASH_CUT",
    "SNAPBACK_CHECKPOINT_EVIDENCE_MISMATCH",
    "SNAPBACK_CHECKPOINT_INCOMPLETE",
    "SNAPBACK_CHECKPOINT_IO_FAILED",
    "SNAPBACK_CHECKPOINT_RECEIPT_INVALID",
    "SNAPBACK_CHECKPOINT_REGISTRY_CORRUPT",
    "SNAPBACK_CHECKPOINT_SCAN_CORRUPT",
    "SNAPBACK_CHECKPOINT_SCHEMA_IDENTITY_MISSING",
    "SNAPBACK_CHECKPOINT_SOURCE_INVALID",
    "SNAPBACK_CHECKPOINT_STREAM_MISSING",
    "SNAPBACK_CHECKPOINT_TEST_CRASH_CUT",
    "SNAPBACK_FORK_BOOT_FAILED",
    "SNAPBACK_FORK_DIFF_INVALID",
    "SNAPBACK_FORK_LOAD_FAILED",
    "SNAPBACK_FORK_READY_INVALID",
    "SNAPBACK_FORK_REGISTRY_INVALID",
    "SNAPBACK_FORK_REGISTRY_STALE",
    "SNAPBACK_FORK_EXPIRED_REAP_FAILED",
    "SNAPBACK_FORK_STOP_FAILED",
    "SNAPBACK_FORK_STOP_UNVERIFIED",
    "SNAPBACK_HISTORY_CORRUPT",
    "SNAPBACK_MIGRATION_EXPECTED_ORACLE_FAILED",
    "SNAPBACK_OPERATION_COVERAGE_INCOMPLETE",
    "SNAPBACK_OPERATION_COVERAGE_MISMATCH",
    "SNAPBACK_OPERATION_JOURNAL_INCOMPLETE",
    "SNAPBACK_OPERATION_LEDGER_INVALID",
    "SNAPBACK_OPERATION_PENDING_NOT_FOUND",
    "SNAPBACK_OPERATION_PROTECTED_CUSTODY_INVALID",
    "SNAPBACK_OPERATION_RECEIPT_INVALID",
    "SNAPBACK_OPERATION_WRITER_EXCLUDED",
    "SNAPBACK_OPERATION_WRITER_IDENTITY_MISMATCH",
    "SNAPBACK_OPERATION_WRITE_AUTHORITY_INVALID",
    "SNAPBACK_PROMOTION_APPROVED_FACTS_INVALID",
    "SNAPBACK_PROMOTION_BASE_DUPLICATE_ROW",
    "SNAPBACK_PROMOTION_BOUNDARY_MISMATCH",
    "SNAPBACK_PROMOTION_ENVELOPE_INVALID",
    "SNAPBACK_PROMOTION_EFFECT_INTENT_MISSING",
    "SNAPBACK_PROMOTION_SCHEMA_IDENTITY_MISSING",
    "SNAPBACK_PROMOTION_SEAL_KEY_INVALID",
    "SNAPBACK_PROMOTION_WRITES_NOT_CANONICAL",
    "SNAPBACK_PROOF_CANONICAL_VALUE_REFUSED",
    "SNAPBACK_PROOF_DOMAIN_MISMATCH",
    "SNAPBACK_PROOF_EXPECTED_DERIVATION_MISSING",
    "SNAPBACK_PROOF_ROWS_NOT_CANONICAL",
    "SNAPBACK_PROTECTED_ERASURE_REGISTRY_CORRUPT",
    "SNAPBACK_PROTECTED_ERASURE_TEST_CRASH_CUT",
    "SNAPBACK_STORAGE_FIELD_CORRUPT",
    "SNAPBACK_STORAGE_ROW_ID_CORRUPT",
    // LLP 0211 requires context on every structured writer; missing context
    // is a server integration invariant, not client-fixable input.
    "SNAPBACK_STRUCTURED_WRITE_CONTEXT_MISSING",
    "SNAPBACK_TEST_OPERATION_CRASH_CUT",
    // LLP 0132: these are derived-state/server invariants, including the
    // query-time work limit that the declaration-time corpus proof should
    // make unreachable; none is a blind-client-retry class.
    "SNAPBACK_VECTOR_INDEX_CORRUPT",
    "SNAPBACK_VECTOR_MAINTENANCE_FAILED",
    "SNAPBACK_VECTOR_WORK_LIMIT",
    "SNAPBACK_BENCH_HELPER_SPLICE_MISMATCH",
    "SNAPBACK_ACTION_CONTEXT_UNAVAILABLE",
    "SNAPBACK_ADMIN_RELAY_LEASE_STATUS_INVALID",
    "SNAPBACK_ADMIN_RELAY_LEASE_TERMINAL",
    // LLP 0062 §5 API-envelope admission refusals. These are admission-time
    // invariants on a provisioner-supplied artifact, not request classes:
    // no HTTP path produces them yet (serving and ingestion are ticket
    // 0062-02), so the truthful projection is the fail-safe 500 until that
    // producer deliberately chooses request classes for each cause.
    "SNAPBACK_API_ENVELOPE_CORRESPONDENCE_FAILED",
    "SNAPBACK_API_ENVELOPE_GRAMMAR_INVALID",
    "SNAPBACK_API_ENVELOPE_MEMBER_DIGEST_MISMATCH",
    "SNAPBACK_API_ENVELOPE_NONCANONICAL",
    "SNAPBACK_API_ENVELOPE_TOO_LARGE",
    "SNAPBACK_API_ENVELOPE_VERSION_UNSUPPORTED",
    // Composition and state serialization are server-side invariants:
    // a failing composition means the server could not author its own
    // envelope, which is a Snapback fault, never a caller's.
    "SNAPBACK_APP_API_COMPOSITION_FAILED",
    "SNAPBACK_APP_API_STATE_PARSE_FAILED",
    // @ref LLP 0157#d3--the-completeness-witness —
    // proof custody, trusted activation, admitted-plan reconstruction, and
    // signing are server-authored establishment invariants. A failure in
    // any of them is never attributable to the live-subscribe caller.
    "SNAPBACK_COMPLETENESS_PROOF_ISSUANCE_FAILED",
    "SNAPBACK_COMPLETENESS_PROOF_KEYRING_INVALID",
    "SNAPBACK_COMPOSITION_ACTIVATION_INVALID",
    "SNAPBACK_COMPOSITION_PLAN_INVALID",
    // LLP 0070 first slice: internal job-ledger invariants — a corrupt
    // stored state, an exhausted per-job fence, or enqueues reaching
    // commit without producer provenance are Snapback faults, never 4xx.
    "SNAPBACK_JOB_FENCE_EXHAUSTED",
    "SNAPBACK_JOB_PRODUCER_MISSING",
    "SNAPBACK_JOB_STATE_INVALID",
    // LLP 0097 ephemeral-branch invariant code (branches.rs). Not yet wired
    // into any request path; it is an internal branch/promotion invariant
    // umbrella, so its truthful HTTP projection is the fail-safe 500 until a
    // producer deliberately splits it into request-classed codes.
    "SNAPBACK_BRANCH_INVALID",
    // @ref LLP 0158#design-sketch — F0a is a local
    // operator workflow. Custody, mint, publication, recovery, and marker
    // failures are durable/control-plane invariants, never caller 4xxs.
    "SNAPBACK_FORK_CUSTODY_REFUSED",
    "SNAPBACK_FORK_CUSTODY_UNCLASSIFIED",
    "SNAPBACK_FORK_DESTINATION_EXISTS",
    "SNAPBACK_FORK_EGRESS_MARKER_FAILED",
    "SNAPBACK_FORK_EVIDENCE_INCOMPLETE",
    "SNAPBACK_FORK_ASSET_CUT_INCOMPLETE",
    "SNAPBACK_FORK_DIFF_ORACLE_MISMATCH",
    "SNAPBACK_FORK_EVIDENCE_MISMATCH",
    "SNAPBACK_FORK_WRITER_COVERAGE_INVALID",
    "SNAPBACK_FORK_WRITER_COVERAGE_GAP",
    "SNAPBACK_FORK_IO_FAILED",
    "SNAPBACK_FORK_KEYRING_MINT_FAILED",
    "SNAPBACK_FORK_LINEAGE_INVALID",
    "SNAPBACK_FORK_NESTED_REFUSED",
    "SNAPBACK_FORK_PATH_INVALID",
    "SNAPBACK_FORK_PUBLICATION_PARTIAL",
    "SNAPBACK_FORK_QUARANTINED",
    "SNAPBACK_FORK_RECEIPT_INVALID",
    "SNAPBACK_FORK_SIDECAR_MALFORMED",
    "SNAPBACK_FORK_SIDECAR_MISSING",
    "SNAPBACK_FORK_SIDECAR_COLLISION",
    "SNAPBACK_FORK_TEST_CRASH_CUT",
    // LLP 0080 §2 keyset invariant: the dispatch layer builds boundaries
    // from validated cursors, so a field/order mismatch reaching storage
    // is a server bug, never a client class.
    "SNAPBACK_QUERY_KEYSET_INVALID",
    "SNAPBACK_MIGRATION_JOURNAL_CORRUPT",
    "SNAPBACK_MIGRATION_PUBLICATION_AMBIGUOUS",
    // LLP 0080 §5: informational activation-rebuild diagnostic; never an
    // ApiError.
    "SNAPBACK_PROJECTION_REBUILT",
    // LLP 0092 §0D.2 atomic entry-evaluation failure.
    "SNAPBACK_BUNDLE_QUERY_FAILED",
    "SNAPBACK_ACTION_HOST_MISSING",
    "SNAPBACK_ACTION_METADATA_SERIALIZE_FAILED",
    "SNAPBACK_ACTION_SECRETS_DEPRECATED",
    "SNAPBACK_ACTION_SECRETS_INVALID",
    "SNAPBACK_ACTION_THREAD_FAILED",
    "SNAPBACK_ACTION_THREAD_SPAWN_FAILED",
    "SNAPBACK_ACTION_TIMEOUT_INVALID",
    "SNAPBACK_ACTION_TIMEOUT_SETUP_FAILED",
    // LLP 0017 local console discovery, browser handoff, and digest-store
    // failures are CLI/control-plane diagnostics. They never classify an
    // HTTP caller fault; preserve the fail-safe 500 projection if one
    // crosses the ApiError boundary.
    "SNAPBACK_ADMIN_APPROVAL_RESPONSE_INVALID",
    "SNAPBACK_ADMIN_BROWSER_OPEN_FAILED",
    "SNAPBACK_ADMIN_BROWSER_OPEN_UNSUPPORTED",
    "SNAPBACK_ADMIN_CLAIM_CODE_INVALID",
    "SNAPBACK_ADMIN_CLAIM_RESPONSE_INVALID",
    "SNAPBACK_ADMIN_CLAIM_STATUS_RESPONSE_INVALID",
    "SNAPBACK_ADMIN_CLAIM_URL_BASE_INVALID",
    "SNAPBACK_ADMIN_CONSOLE_CREDENTIAL_STORE_FAILED",
    "SNAPBACK_ADMIN_CONSOLE_CREDENTIAL_STORE_INVALID",
    "SNAPBACK_ADMIN_CONSOLE_UNREACHABLE",
    "SNAPBACK_ADMIN_CREDENTIAL_RESPONSE_INVALID",
    "SNAPBACK_ADMIN_HTTP_ERROR",
    "SNAPBACK_ADMIN_READY_FILE_INVALID",
    "SNAPBACK_ADMIN_READY_FILE_REQUIRED",
    "SNAPBACK_ADMIN_READY_FILE_UNAVAILABLE",
    "SNAPBACK_ADMIN_TOKEN_UNAVAILABLE",
    "SNAPBACK_ADMIN_SECRET_READ_SERIALIZATION_FAILED",
    "SNAPBACK_ADMIN_SECRET_READ_PROVENANCE_UNAVAILABLE",
    // Local backup/restore validation is a CLI/operator diagnostic. It is
    // deliberately not a request-path 4xx; if it ever crosses ApiError,
    // the fail-safe HTTP projection remains 500.
    "SNAPBACK_AUTH_BACKUP_INVALID",
    // @ref LLP 0192#d-2-the-store-export-verb — whole-store export refuses
    // offline under the instance lock, in the same operator plane as auth
    // backup. No HTTP producer exists; the fail-safe projection stays 500.
    "SNAPBACK_STORE_EXPORT_INVALID",
    "SNAPBACK_STORE_EXPORT_REFUSED",
    "SNAPBACK_AUTH_HOSTED_ADMISSION_EXPIRED",
    "SNAPBACK_AUTH_HOSTED_ADMISSION_INVALID",
    // LLP 0098 §3.1 hosted-edge adapter refusals. Like the backup/restore
    // codes above these are control-plane/operator diagnostics raised
    // before a listener serves, never request-path 4xx; the fail-safe HTTP
    // projection remains 500 if one ever crosses ApiError.
    "SNAPBACK_AUTH_HOSTED_ADMISSION_FOREIGN",
    "SNAPBACK_AUTH_HOSTED_ADMISSION_ROLLED_BACK",
    "SNAPBACK_AUTH_HOSTED_ADMISSION_STALE_CONFIGURATION",
    "SNAPBACK_AUTH_HOSTED_ADMISSION_STALE_SUPPORT",
    "SNAPBACK_AUTH_HOSTED_ADMISSION_UNAUTHENTICATED",
    "SNAPBACK_HOSTED_ADMISSION_V2_INVALID",
    "SNAPBACK_HOSTED_ADMISSION_V2_MISSING",
    "SNAPBACK_HOSTED_ADMISSION_V2_STALE",
    "SNAPBACK_HOSTED_ADMISSION_V2_UNAUTHENTICATED",
    "SNAPBACK_AUTH_HOSTED_TOPOLOGY_INVALID",
    "SNAPBACK_AUTH_SENDER_PROOF_AUTHORITY_UNAVAILABLE",
    "SNAPBACK_AUTH_TRANSPORT_INSECURE",
    "SNAPBACK_AUTH_INVALIDATION_CORRUPT",
    "SNAPBACK_AUTH_INVALIDATION_ISSUER_INVALID",
    "SNAPBACK_AUTH_INVALIDATION_RETIREMENT_INVALID",
    "SNAPBACK_AUTH_INVALIDATION_SERIALIZE_FAILED",
    // @ref LLP 0162#measurement-gate — step-0 benchmark host-I/O and
    // process-counter failures are proof-environment faults, never caller
    // request classes; preserve the fail-safe 500 projection.
    "SNAPBACK_BENCH_IO_FAILED",
    "SNAPBACK_BENCH_PROCESS_USAGE_UNAVAILABLE",
    "SNAPBACK_BENCH_EPHEMERAL",
    "SNAPBACK_BENCH_READ_LANE_STALLED",
    "SNAPBACK_BENCH_TEMPDIR",
    "SNAPBACK_CAPTURED_READ_SERIALIZE_FAILED",
    "SNAPBACK_CLIENT_MUTATION_RETENTION_STATE_INVALID",
    "SNAPBACK_CLIENT_MUTATION_RESULT_INVALID",
    "SNAPBACK_CONFIG_ENV_IMPORTED",
    "SNAPBACK_CONFIG_GENERATION_EXHAUSTED",
    "SNAPBACK_CONFIG_STORE_INVALID",
    "SNAPBACK_CONFIG_STORE_IO",
    "SNAPBACK_CONFIG_STORE_VERSION_UNSUPPORTED",
    "SNAPBACK_CONFIG_VERIFY",
    "SNAPBACK_CONFIG_WRITE",
    // LLP 0154 Phase 1 telemetry policy/store diagnostics are operator
    // and internal sibling-state failures, not request-shape classes.
    // They therefore retain the fail-safe 500 projection if one ever
    // crosses ApiError; the config host operation itself uses its normal
    // HTTP-200 result envelope.
    "SNAPBACK_TELEMETRY_CONFIG_INVALID",
    "SNAPBACK_TELEMETRY_CONFIG_TRANSITION_FAILED",
    // @ref LLP 0156#e13--the-issue-state-machine — durable issue-state,
    // rollout-window, and enqueue-sequence failures are telemetry-store
    // invariants. Authored conflicts/invalid transitions are typed result
    // rows instead, so none of these codes is a caller-input 4xx.
    "SNAPBACK_ERROR_GROUP_STATE_INVALID",
    "SNAPBACK_ERROR_RESOLVE_BARRIER_MISSING",
    "SNAPBACK_ERROR_ROLLOUT_INVALID",
    "SNAPBACK_ERROR_STATE_SEQUENCE_EXHAUSTED",
    "SNAPBACK_ERROR_STATE_SEQUENCE_INVALID",
    "SNAPBACK_ERROR_TRANSITION_SERIALIZATION_FAILED",
    "SNAPBACK_ERRORS_QUERY_SERIALIZATION_FAILED",
    "SNAPBACK_TELEMETRY_SEQUENCE_EXHAUSTED",
    "SNAPBACK_TELEMETRY_SEQUENCE_INVALID",
    // @ref LLP 0154#d7--aggregates-a-watermarked-state-machine-mergeable-by-construction — these are
    // internal D7 evidence failures, never request-shape classifications.
    "SNAPBACK_TELEMETRY_BENCH_AMPLIFICATION_FAILED",
    "SNAPBACK_TELEMETRY_BENCH_APP_ACCOUNTING_FAILED",
    "SNAPBACK_TELEMETRY_BENCH_APP_WORKER_BYPASSED",
    "SNAPBACK_TELEMETRY_BENCH_BASELINE_INVALID",
    "SNAPBACK_TELEMETRY_BENCH_BUILD_IDENTITY_INVALID",
    "SNAPBACK_TELEMETRY_BENCH_BUILD_PROFILE_INVALID",
    "SNAPBACK_TELEMETRY_BENCH_CONFIG_INVALID",
    "SNAPBACK_TELEMETRY_BENCH_EVENT_WORKER_FAILED",
    "SNAPBACK_TELEMETRY_BENCH_FILE_CAP_FAILED",
    "SNAPBACK_TELEMETRY_BENCH_HTTP_FAILED",
    "SNAPBACK_TELEMETRY_BENCH_LATENCY_CEILING_FAILED",
    "SNAPBACK_TELEMETRY_BENCH_QUERY_CARDINALITY_FAILED",
    "SNAPBACK_TELEMETRY_BENCH_RUNTIME_FAILED",
    "SNAPBACK_TELEMETRY_BENCH_SHED_FAILED",
    "SNAPBACK_TELEMETRY_BENCH_SWEEP_FAILED",
    "SNAPBACK_TELEMETRY_BENCH_TEMPDIR_FAILED",
    "SNAPBACK_TELEMETRY_BENCH_WORKER_TIMEOUT",
    "SNAPBACK_TELEMETRY_EXPORT_ENVELOPE_BOUND_EXCEEDED",
    "SNAPBACK_TELEMETRY_EXPORT_RESPONSE_FAILED",
    "SNAPBACK_TELEMETRY_EXPORT_SERIALIZATION_FAILED",
    "SNAPBACK_TELEMETRY_FILE_CAP_UNSATISFIABLE",
    "SNAPBACK_TELEMETRY_FLUSH_FAILED",
    "SNAPBACK_TELEMETRY_IDENTITY_INVALID",
    "SNAPBACK_TELEMETRY_IDENTITY_UNBOUND",
    "SNAPBACK_TELEMETRY_QUERY_SERIALIZATION_FAILED",
    "SNAPBACK_TELEMETRY_SQL_OPEN_FAILED",
    "SNAPBACK_TELEMETRY_STORE_IO",
    "SNAPBACK_TELEMETRY_TEST_CONFIG_FAILED",
    "SNAPBACK_TELEMETRY_TEST_FLUSH_FAILED",
    "SNAPBACK_TELEMETRY_TEST_REBIND_FAILED",
    // @ref LLP 0154#open-questions — OQ1 projection/registry validation
    // failures are internal contract and fixture failures. They do not
    // classify application request input and retain the fail-safe 500
    // projection if they ever cross an HTTP boundary.
    "SNAPBACK_OBSERVATION_STAGE_DUPLICATE",
    "SNAPBACK_OBSERVATION_STAGE_MISSING",
    "SNAPBACK_OPERATION_CLASS_DERIVED_METER_SUPPLIED",
    "SNAPBACK_OPERATION_CLASS_FIXTURE_DUPLICATE",
    "SNAPBACK_OPERATION_CLASS_FIXTURE_MISMATCH",
    "SNAPBACK_OPERATION_CLASS_METER_DUPLICATE",
    "SNAPBACK_OPERATION_CLASS_METER_NOT_ALLOWED",
    "SNAPBACK_OPERATION_CLASS_METER_QUANTITY_INVALID",
    "SNAPBACK_OPERATION_CLASS_METER_UNIT_INVALID",
    "SNAPBACK_OPERATION_CLASS_REGISTRY_UNSUPPORTED",
    "SNAPBACK_OPERATION_CLASS_UNKNOWN",
    "SNAPBACK_CONNECTION_CLEANUP_FAILED",
    "SNAPBACK_CRON_RUN_RECORD_MISSING",
    "SNAPBACK_CRON_RUN_SKIPPED_OVERLAP",
    "SNAPBACK_CRON_STALE_IN_FLIGHT_CLEARED",
    "SNAPBACK_CRON_STATE_INVALID",
    "SNAPBACK_CRON_STATE_PARSE_FAILED",
    "SNAPBACK_CRON_STATE_SERIALIZE_FAILED",
    "SNAPBACK_DRY_RUN_LEDGER_ELIDED",
    "SNAPBACK_HANDLER_HOST_CALL_HEADERS_TOO_LARGE",
    "SNAPBACK_HANDLER_HOST_CALL_PANIC",
    "SNAPBACK_HANDLER_HOST_CALL_SERIALIZE_FAILED",
    "SNAPBACK_HANDLER_HOST_CALL_UNAUTHORIZED",
    "SNAPBACK_HANDLER_HOST_CALL_WITHOUT_CONTEXT",
    "SNAPBACK_HANDLER_INPUT_SERIALIZE_FAILED",
    "SNAPBACK_HANDLER_REJECTION_DETECTION_UNAVAILABLE",
    "SNAPBACK_HANDLER_REJECTION_INSPECTION_INVALID",
    "SNAPBACK_HOST_STOP_STALE_DESCRIPTOR",
    "SNAPBACK_HOST_STOP_UNVERIFIABLE",
    "SNAPBACK_IBEX_FUNCTIONS_LOADED",
    "SNAPBACK_IBEX_GLOBAL_DENY_INCOMPLETE",
    "SNAPBACK_INVOCATION_FUNCTION_MISMATCH",
    "SNAPBACK_INVOCATION_SOURCE_INVALID",
    "SNAPBACK_JSON_SERIALIZE_FAILED",
    "SNAPBACK_LIVE_FINALIZE_FAILED",
    "SNAPBACK_LIVE_SERVICE_TERMINAL_OBSERVATION_FAILED",
    "SNAPBACK_LIVE_STAGE_BINDING_MISMATCH",
    "SNAPBACK_LIVE_STAGE_CORRUPT",
    "SNAPBACK_LIVE_STAGE_FENCE_REQUIRED",
    "SNAPBACK_LIVE_DELTA_SERIALIZE_FAILED",
    "SNAPBACK_LIVE_UPDATE_SERIALIZE_FAILED",
    "SNAPBACK_MAINTENANCE_JOURNAL_PRUNE_FAILED",
    "SNAPBACK_MAINTENANCE_PERMISSION_RESOLUTION_FAILED",
    // Genuine server-side faults / non-served advisories keep the fail-safe
    // 500 (LLP 0032 S5.D10). Client-fault registration/invitation codes are
    // allow-listed to 4xx below in their own families.
    "SNAPBACK_AUTH_AGENT_INVITATION_COMMIT_UNCERTAIN",
    "SNAPBACK_AUTH_AGENT_INVITATION_SECRET_UNAVAILABLE",
    "SNAPBACK_AUTH_AGENT_ONBOARDING_PROD_UNAVAILABLE",
    "SNAPBACK_AUTH_AGENT_REGISTRATION_COMMIT_UNCERTAIN",
    "SNAPBACK_AUTH_AGENT_CREDENTIAL_STATE_CORRUPT",
    "SNAPBACK_MEMBERSHIP_FINAL_STATE_SCHEMA_INVALID",
    "SNAPBACK_MEMBERSHIP_PROVENANCE_ROW_INVALID",
    "SNAPBACK_MEMBERSHIP_PROVENANCE_UNAVAILABLE",
    "SNAPBACK_READY_FILE_PATH_COLLISION",
    "SNAPBACK_RUNTIME_CREATE_FAILED",
    "SNAPBACK_SCHEMA_PHYSICAL_COLUMN_INVALID",
    "SNAPBACK_SEARCH_INDEX_CORRUPT",
    "SNAPBACK_SEARCH_MAINTENANCE_FAILED",
    "SNAPBACK_SQLITE_ERROR",
    "SNAPBACK_TEST_LIVE_SCOPE_REGISTRATION_FAILED",
    "SNAPBACK_TEST_SCOPE_RETIREMENT_AUTH_FAILED",
    "SNAPBACK_V8_REJECTION_DETECTION_UNAVAILABLE",
    "SNAPBACK_V8_RUNNER_INVOKE_FAILED",
    "SNAPBACK_V8_RUNNER_START_FAILED",
    "SNAPBACK_VERSION_OUT_OF_RANGE",
    // LLP 0143 D2/D3: these are internal handoff-ledger, staged-config,
    // worker, operator-config, and response-serialization invariants. If
    // any crosses ApiError, keep the fail-safe 500 projection rather than
    // misclassifying it as caller input.
    "SNAPBACK_PUSH_BATCH_CLAIM_RACED",
    "SNAPBACK_PUSH_BATCH_CLAIM_STALE",
    "SNAPBACK_PUSH_BATCH_NOT_CLAIMABLE",
    "SNAPBACK_PUSH_CONFIG_GRANT_INVALID",
    "SNAPBACK_PUSH_LEDGER_CORRUPT",
    "SNAPBACK_PUSH_MAINTENANCE_WORKER_FAILED",
    "SNAPBACK_PUSH_PROVIDER_OVERRIDE_REFUSED",
    "SNAPBACK_PUSH_RECEIPT_CLAIM_STALE",
    "SNAPBACK_PUSH_SEND_FAILED",
    "SNAPBACK_PUSH_REGISTRY_CORRUPT",
    "SNAPBACK_ASSET_AUTHORIZER_RESULT_INVALID",
    "SNAPBACK_ASSET_BLOB_CONDEMNED_RACE",
    "SNAPBACK_ASSET_HOST_OP_INPUT_INVALID",
    "SNAPBACK_ASSET_HOST_OP_UNKNOWN",
    "SNAPBACK_ASSET_CALLBACK_INVALID",
    "SNAPBACK_ASSET_INTENT_ACCEPT_INVALID",
    "SNAPBACK_ASSET_INTENT_IDENTITY_COLLISION",
    "SNAPBACK_ASSET_INTENT_IDENTITY_INVALID",
    "SNAPBACK_ASSET_IMAGE_TIME_BUDGET_EXCEEDED",
    "SNAPBACK_ASSET_INTENT_RUNTIME_INVALID",
    "SNAPBACK_ASSET_INTENT_RUNTIME_UNSUPPORTED",
    "SNAPBACK_ASSET_LIVE_INPUT_INVALID",
    "SNAPBACK_ASSET_RECORD_INVALID",
    // The my-memberships reserved projection (LLP 0056 self-projection
    // amendment): like the asset record projection's codes above, both
    // stay deliberate default-500s — the reserved lane is driven by
    // generated clients that never send malformed input, and no HTTP
    // route surfaces them as a top-level error today.
    "SNAPBACK_MEMBERSHIP_LIVE_INPUT_INVALID",
    "SNAPBACK_MEMBERSHIP_LIVE_INVALID",
    "SNAPBACK_ASSET_REFCOUNT_INVALID",
    "SNAPBACK_ASSET_RETRY_INELIGIBLE",
    "SNAPBACK_ASSET_RUNNER_DISABLED",
    // W2g store-selection configuration names and store diagnostics:
    // the env vars ride the same reviewed inventory as
    // SNAPBACK_ASSET_RUNNER_DISABLED; the three store codes are
    // deliberate default-500s until a producer picks a client class.
    "SNAPBACK_ASSET_S3_",
    "SNAPBACK_ASSET_S3_ACCESS_KEY_ID",
    "SNAPBACK_ASSET_S3_BUCKET",
    "SNAPBACK_ASSET_S3_ENDPOINT",
    "SNAPBACK_ASSET_S3_EXPERIMENTAL",
    "SNAPBACK_ASSET_S3_PREFIX",
    "SNAPBACK_ASSET_S3_REGION",
    "SNAPBACK_ASSET_S3_SECRET_ACCESS_KEY",
    "SNAPBACK_ASSET_STORE",
    "SNAPBACK_ASSET_STORE_CONFIG_INVALID",
    "SNAPBACK_ASSET_STORE_OP_UNSUPPORTED",
    "SNAPBACK_ASSET_STORE_UNQUALIFIED",
    "SNAPBACK_ASSET_STORE_KEY_INVALID",
    "SNAPBACK_ASSET_STORE_UNAVAILABLE",
    // W2h consistent-cut export/import: these surface only through the
    // admin host-ops envelope (ok:false, HTTP 200), so they ride the
    // reviewed default-500 inventory like the other asset host-op
    // codes; SNAPBACK_ASSET_IMPORT_EXPERIMENTAL is the env-var literal
    // in the SNAPBACK_ASSET_RUNNER_DISABLED idiom.
    "SNAPBACK_ASSET_EXPORT_BLOB_MISSING",
    "SNAPBACK_ASSET_EXPORT_TARGET_INVALID",
    "SNAPBACK_ASSET_IMPORT_DIGEST_MISMATCH",
    "SNAPBACK_ASSET_IMPORT_EXPERIMENTAL",
    "SNAPBACK_ASSET_IMPORT_EXPERIMENTAL_REQUIRED",
    "SNAPBACK_ASSET_IMPORT_INCOMPLETE",
    "SNAPBACK_ASSET_IMPORT_MANIFEST_INVALID",
    "SNAPBACK_ASSET_IMPORT_TARGET_NOT_EMPTY",
    // LLP 0239 D2 collection rows in the consistent cut ride the same
    // admin host-ops envelope as the W2h export/import codes above.
    "SNAPBACK_ASSET_EXPORT_COLLECTION_INVALID",
    "SNAPBACK_ASSET_IMPORT_COLLECTION_SCHEMA_MISMATCH",
    "SNAPBACK_ASSET_IMPORT_COLLECTION_PARENT_MISSING",
    "SNAPBACK_ASSET_TEST_CRASH",
    "SNAPBACK_ASSET_TEST_TRANSIENT",
    "SNAPBACK_ASSET_TRANSITION_INVALID",
    "SNAPBACK_ASSET_WORK_KIND_UNKNOWN",
    "SNAPBACK_ASSET_WORK_PARAMS_INVALID",
    "SNAPBACK_ASSET_WORK_TRANSITION_INVALID",
    "SNAPBACK_ASSET_WORK_UNKNOWN",
];

// The server's path dependencies can propagate `SnapbackError` through `?`
// without restating a code in the HTTP crate. These production-graph codes
// retain the mapper's fail-safe 500 posture explicitly until an endpoint owns
// and reviews a more specific recovery contract; making that default explicit
// prevents them from remaining registry-null or escaping future completeness
// checks merely because their emitting source lives across a crate boundary.
const CROSS_CRATE_FAIL_SAFE_DIAGNOSTICS: &[&str] = &[
    "SNAPBACK_AUTHORITY_BACKFILL_LEDGER_INVALID",
    "SNAPBACK_AUTHORITY_BACKFILL_PROFILE_INVALID",
    "SNAPBACK_AUTHORITY_BACKFILL_PROFILE_MISSING",
    "SNAPBACK_AUTHORITY_BACKFILL_PROJECTION_REQUIRED",
    "SNAPBACK_AUTHORITY_HISTORY_PAGE_INVALID",
    "SNAPBACK_AUTHORITY_INVITE_ALREADY_ACTIVE",
    "SNAPBACK_AUTHORITY_INVITE_ALREADY_PRESENT",
    "SNAPBACK_AUTHORITY_PLAN_MIRROR_DUPLICATE",
    "SNAPBACK_AUTHORITY_PLAN_MIRROR_MISSING",
    "SNAPBACK_AUTHORITY_PLAN_MIRROR_SHAPE_MISMATCH",
    "SNAPBACK_AUTHORITY_PLAN_PROFILE_INVALID",
    "SNAPBACK_AUTHORITY_PLAN_PROFILE_MISSING",
    "SNAPBACK_AUTHORITY_PLAN_PROJECTION_REQUIRED",
    "SNAPBACK_AUTHORITY_PLAN_SERIALIZATION_FAILED",
    "SNAPBACK_AUTHORITY_PROFILE_INDEX_REQUIRED",
    "SNAPBACK_AUTHORITY_PROFILE_ROLE_LATTICE_INVALID",
    "SNAPBACK_AUTHORITY_PROFILE_UNSUPPORTED_COMPOSITION_CLASS",
    "SNAPBACK_AUTHORITY_PROJECTION_CORRUPT",
    "SNAPBACK_AUTHORITY_PROJECTION_FULL_PROVENANCE_REQUIRED",
    "SNAPBACK_AUTHORITY_PROJECTION_REQUIRED",
    "SNAPBACK_AUTHORITY_PROJECTION_ROW_INVALID",
    "SNAPBACK_AUTHORITY_PROJECTION_SERIALIZATION_FAILED",
    "SNAPBACK_AUTHORITY_RECIPIENT_CEILING_EXCEEDED",
    "SNAPBACK_AUTHORITY_RECIPIENT_SINK_FROZEN",
    "SNAPBACK_AUTHORITY_RECIPIENT_SINK_INVALID",
    "SNAPBACK_AUTHORITY_RECIPIENT_SNAPSHOT_INVALID",
    "SNAPBACK_AUTHORITY_RECIPIENT_SNAPSHOT_MUTATION_REQUIRED",
    "SNAPBACK_AUTH_CLAIMS_AUTHORITY_INVALID",
    "SNAPBACK_AUTH_CLAIMS_CORRUPT",
    "SNAPBACK_AUTH_INTERLOCK_RETIRED",
    "SNAPBACK_AUTH_PARTICIPANT_ALREADY_TAKEN",
    "SNAPBACK_AUTH_PARTICIPANT_DATABASE_MISMATCH",
    "SNAPBACK_AUTH_PARTICIPANT_DEPENDENCY_PENDING",
    "SNAPBACK_AUTH_PARTICIPANT_DROPPED",
    "SNAPBACK_AUTH_PARTICIPANT_GENERATION_MISMATCH",
    "SNAPBACK_AUTH_PARTICIPANT_NOT_PENDING",
    "SNAPBACK_AUTH_PARTICIPANT_REGISTRY_MISMATCH",
    "SNAPBACK_AUTH_PASSWORD_MINIMUM_LENGTH_INVALID",
    "SNAPBACK_BENCH_READ_FAILED",
    "SNAPBACK_BENCH_SETUP_FAILED",
    "SNAPBACK_BENCH_WRITER_POISONED",
    "SNAPBACK_CLIENT_MUTATION_RESULT_INTEGRITY",
    "SNAPBACK_DEV_ADMISSION_POSTURE_INVALID",
    "SNAPBACK_DEV_IDENTITY_CONFIG_FORBIDDEN",
    "SNAPBACK_DEV_IDENTITY_FILE_INVALID",
    "SNAPBACK_EFFECT_AUTHORITY_INVALID",
    "SNAPBACK_ELEVATED_READ_CAPABILITY_UNDECLARED",
    "SNAPBACK_FAMILIAR_RUNMUTATION_REF_REQUIRED",
    "SNAPBACK_FORK_READ_HANDLE_REQUIRED",
    "SNAPBACK_FORK_STAGING_INVALID",
    "SNAPBACK_KERNEL_COMMIT_AUTHORITY_ALREADY_CLAIMED",
    "SNAPBACK_KERNEL_COMMIT_AUTHORITY_INVALID",
    "SNAPBACK_MEDIA_ASSET_NOT_FINALIZED",
    "SNAPBACK_MEDIA_KIND_NOT_ADMITTED",
    "SNAPBACK_MEDIA_PROJECTION_INTEGRITY",
    "SNAPBACK_MEDIA_PROJECTION_SNAPSHOT_UNAVAILABLE",
    "SNAPBACK_MEDIA_PROJECTION_TOKEN_EXHAUSTED",
    "SNAPBACK_MEDIA_PROJECTION_UNPROVENANCED",
    "SNAPBACK_MEDIA_WRITE_FORGED_KIND",
    "SNAPBACK_PUSH_AUTHORITY_INVALID",
    "SNAPBACK_SEMIJOIN_ACTOR_CEILING_EXCEEDED",
    "SNAPBACK_SERVICE_AUTHORITY_UNAVAILABLE",
    "SNAPBACK_SET_AGGREGATE_ROW_CEILING_EXCEEDED",
    "SNAPBACK_STANDARD_PATTERN_COMPOSITION_INVALID",
    "SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_DEPLOYMENT_IDENTITY_MISMATCH",
    "SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_PUSH_VIOLATION",
    "SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_REMOTE_CUSTODY_UNAVAILABLE",
    "SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_TIME_INVALID",
    "SNAPBACK_TABLE_VISIBILITY_OVERRIDE_EXPIRED",
    "SNAPBACK_TABLE_VISIBILITY_OVERRIDE_EXPIRING",
    "SNAPBACK_TABLE_VISIBILITY_OVERRIDE_FIXTURE_ONLY",
    "SNAPBACK_TABLE_VISIBILITY_OVERRIDE_NOT_YET_VALID",
];

const HTTP_STATUS_FAMILIES: &[(StatusCode, &[&str])] = &[
    (StatusCode::ACCEPTED, &["SNAPBACK_EFFECT_APPROVAL_PENDING"]),
    (StatusCode::BAD_REQUEST, BAD_REQUEST_DIAGNOSTICS),
    (StatusCode::BAD_REQUEST, APP_API_BAD_REQUEST_DIAGNOSTICS),
    (StatusCode::UNAUTHORIZED, UNAUTHORIZED_DIAGNOSTICS),
    (StatusCode::FORBIDDEN, FORBIDDEN_DIAGNOSTICS),
    (StatusCode::NOT_FOUND, NOT_FOUND_DIAGNOSTICS),
    (StatusCode::CONFLICT, CONFLICT_DIAGNOSTICS),
    (StatusCode::PAYLOAD_TOO_LARGE, PAYLOAD_TOO_LARGE_DIAGNOSTICS),
    (StatusCode::TOO_MANY_REQUESTS, TOO_MANY_REQUESTS_DIAGNOSTICS),
    (StatusCode::REQUEST_TIMEOUT, REQUEST_TIMEOUT_DIAGNOSTICS),
    (StatusCode::GATEWAY_TIMEOUT, GATEWAY_TIMEOUT_DIAGNOSTICS),
    (StatusCode::BAD_GATEWAY, BAD_GATEWAY_DIAGNOSTICS),
    (
        StatusCode::MISDIRECTED_REQUEST,
        MISDIRECTED_REQUEST_DIAGNOSTICS,
    ),
    (StatusCode::NOT_IMPLEMENTED, NOT_IMPLEMENTED_DIAGNOSTICS),
    (StatusCode::SERVICE_UNAVAILABLE, OAUTH_503_DIAGNOSTICS),
    (
        StatusCode::SERVICE_UNAVAILABLE,
        SERVICE_UNAVAILABLE_DIAGNOSTICS,
    ),
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        INTERNAL_SERVER_ERROR_DIAGNOSTICS,
    ),
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        CROSS_CRATE_FAIL_SAFE_DIAGNOSTICS,
    ),
    (StatusCode::GONE, GONE_DIAGNOSTICS),
    (StatusCode::GONE, ASSET_GONE_DIAGNOSTICS),
    (
        StatusCode::UNPROCESSABLE_ENTITY,
        ASSET_UNPROCESSABLE_DIAGNOSTICS,
    ),
    (
        StatusCode::UNPROCESSABLE_ENTITY,
        &["SNAPBACK_API_ASK_RESULT_SCHEMA_MISMATCH"],
    ),
    (
        StatusCode::PRECONDITION_FAILED,
        ASSET_PRECONDITION_DIAGNOSTICS,
    ),
    (
        StatusCode::UNSUPPORTED_MEDIA_TYPE,
        ASSET_UNSUPPORTED_MEDIA_DIAGNOSTICS,
    ),
];

const GONE_DIAGNOSTICS: &[&str] = &[
    "SNAPBACK_EFFECT_EXPIRED",
    "SNAPBACK_BRANCH_EXPIRED",
    "SNAPBACK_BRANCH_GRANT_STALE",
    "SNAPBACK_CHECKPOINT_INVALID",
    "SNAPBACK_FORK_DIFF_RETENTION_GAP",
    "SNAPBACK_FORK_SERVER_EXPIRED",
    "SNAPBACK_OPERATION_EPOCH_CLOSED",
    "SNAPBACK_OPERATION_RESULT_EXPIRED",
    "SNAPBACK_PROMOTION_TICKET_EXPIRED",
];
const ASSET_GONE_DIAGNOSTICS: &[&str] = &["SNAPBACK_ASSET_ATTEMPT_EXPIRED"];
const ASSET_UNPROCESSABLE_DIAGNOSTICS: &[&str] = &[
    "SNAPBACK_ASSET_IMAGE_BOUNDS_EXCEEDED",
    "SNAPBACK_ASSET_IMAGE_DECODE_FAILED",
    "SNAPBACK_ASSET_VIDEO_BOUNDS_EXCEEDED",
    "SNAPBACK_ASSET_VIDEO_PARSE_FAILED",
    "SNAPBACK_ASSET_VIDEO_STRIP_UNSUPPORTED",
    "SNAPBACK_ASSET_WIDTH_ABOVE_CEILING",
    "SNAPBACK_ASSET_WIDTH_UNSUPPORTED",
    "SNAPBACK_ASSET_LOCATION_POLICY_UNSUPPORTED",
    "SNAPBACK_ASSET_DELIVERY_PROFILE_UNSUPPORTED",
    "SNAPBACK_ASSET_SEED_FIXTURE_REJECTED",
];
const ASSET_PRECONDITION_DIAGNOSTICS: &[&str] = &["SNAPBACK_ASSET_TUS_VERSION_UNSUPPORTED"];
const ASSET_UNSUPPORTED_MEDIA_DIAGNOSTICS: &[&str] =
    &["SNAPBACK_ASSET_TUS_CONTENT_TYPE_UNSUPPORTED"];

// TUS 1.0.0's checksum-mismatch class has no `StatusCode` const; the
// reviewed table carries it by numeric status so the inventory stays
// exhaustive without loosening the fail-safe default.
const NONSTANDARD_STATUS_DIAGNOSTICS: &[(u16, &[&str])] =
    &[(460, &["SNAPBACK_ASSET_CHUNK_CHECKSUM_INVALID"])];

const STALE_ARTIFACT_DIAGNOSTICS: &[&str] = &[
    "SNAPBACK_STALE_FUNCTION_ARTIFACT_KIND",
    "SNAPBACK_STALE_FUNCTION_ARTIFACT_VERSION",
    "SNAPBACK_STALE_SCHEMA_ARTIFACT_KIND",
    "SNAPBACK_STALE_SCHEMA_ARTIFACT_VERSION",
];

// `validate_artifact_header` assembles these four codes from a format
// template. Name the exact expansion so the source inventory cannot treat
// the template prefix as a concrete diagnostic or silently miss a family.
const DYNAMIC_DIAGNOSTIC_TEMPLATES: &[(&str, &[&str])] =
    &[("SNAPBACK_STALE_", STALE_ARTIFACT_DIAGNOSTICS)];

fn expected_http_diagnostic_codes() -> BTreeSet<String> {
    let mut expected = BTreeSet::new();
    for (_, codes) in HTTP_STATUS_FAMILIES {
        for code in *codes {
            assert!(
                expected.insert((*code).to_owned()),
                "duplicate diagnostic status classification: {code}"
            );
        }
    }
    for (_, codes) in NONSTANDARD_STATUS_DIAGNOSTICS {
        for code in *codes {
            assert!(
                expected.insert((*code).to_owned()),
                "duplicate diagnostic status classification: {code}"
            );
        }
    }
    expected
}

fn isolated_worker_counters() -> DetachedActionWorkerCounters {
    // Native worker closures require 'static counters. Leaking these two
    // tiny atomics keeps each parallel test isolated from process-global
    // admin metrics without introducing test-only synchronization into
    // production paths.
    DetachedActionWorkerCounters {
        active: Box::leak(Box::new(AtomicUsize::new(0))),
        rejections: Box::leak(Box::new(AtomicU64::new(0))),
    }
}

fn slow_cron_state(overlap_policy: CronOverlapPolicy) -> SharedSnapback {
    let source = r#"
globalThis.__snapbackHandlers = {
  async slowCron() {
    const started = Date.now();
    while (Date.now() - started < 500) {}
    return { ok: true };
  }
};
"#;
    let manifest = FunctionManifest {
        functions: vec![FunctionDefinition::new(
            "slowCron",
            FunctionKind::Action,
            FunctionRuntime::IbexModule(IbexModule {
                source: source.to_owned(),
                export: "slowCron".to_owned(),
            }),
        )],
        cron_jobs: vec![CronJobDefinition {
            name: "slow".to_owned(),
            schedule: CronSchedule {
                every_ms: Some(60_000),
                cron: None,
            },
            action: "slowCron".to_owned(),
            enabled: true,
            activation: CronActivationPolicy::default(),
            jitter_policy: CronJitterPolicy {
                enabled: false,
                max_offset_ms: 0,
            },
            overlap_policy,
            retry_policy: CronRetryPolicy {
                mode: CronRetryMode::NextTick,
            },
            required_capabilities: Vec::new(),
            target_wakeup: None,
            source_span: None,
        }],
        ..FunctionManifest::default()
    };
    let mut snapback = LocalSnapback::memory().expect("cron test state");
    let diagnostics = snapback.load_functions(manifest);
    assert!(
        diagnostics
            .iter()
            .all(|diagnostic| diagnostic.severity != crate::diagnostic::DiagnosticSeverity::Error),
        "slow cron manifest must install: {diagnostics:?}"
    );
    Arc::new(Mutex::new(snapback))
}

async fn wait_for_dispatcher_permits(dispatcher: &Semaphore, expected: usize) {
    tokio::time::timeout(Duration::from_secs(3), async {
        while dispatcher.available_permits() != expected {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("detached cron action did not reach the expected dispatcher state");
}

/// An always-armed `everyMs` job whose seeded most-recent-slot nominal
/// (epoch-anchored grid, 0137 a4-f4) makes it past-due the moment it
/// loads, backed by a host-plan action so the run executes without an
/// Ibex VM.
fn armed_due_cron_state() -> SharedSnapback {
    let manifest = FunctionManifest {
        functions: vec![FunctionDefinition::new(
            "inertAction",
            FunctionKind::Action,
            FunctionRuntime::HostPlan(HandlerPlan::Action(ActionPlan {
                steps: Vec::new(),
                return_value: None,
            })),
        )],
        cron_jobs: vec![CronJobDefinition {
            name: "inert".to_owned(),
            schedule: CronSchedule {
                every_ms: Some(60_000),
                cron: None,
            },
            action: "inertAction".to_owned(),
            enabled: true,
            activation: CronActivationPolicy::default(),
            jitter_policy: CronJitterPolicy {
                enabled: false,
                max_offset_ms: 0,
            },
            overlap_policy: CronOverlapPolicy::NoOverlap,
            retry_policy: CronRetryPolicy {
                mode: CronRetryMode::NextTick,
            },
            required_capabilities: Vec::new(),
            target_wakeup: None,
            source_span: None,
        }],
        ..FunctionManifest::default()
    };
    let mut snapback = LocalSnapback::memory().expect("cron disable test state");
    let diagnostics = snapback.load_functions(manifest);
    assert!(
        diagnostics
            .iter()
            .all(|diagnostic| diagnostic.severity != crate::diagnostic::DiagnosticSeverity::Error),
        "armed due cron manifest must install: {diagnostics:?}"
    );
    Arc::new(Mutex::new(snapback))
}

/// How long the disabled scheduler is observed for. The control test below
/// proves an enabled scheduler commits the armed due run well inside the
/// same window, so an empty ledger here is meaningful evidence.
const CRON_DISABLE_OBSERVATION_MS: u64 = 2_500;

// @ref LLP 0028#scheduler-state-and-run-ledger — the disable switch keeps
// definitions loaded/armed/inspectable and manual ticks working while the
// autonomous scheduler never claims.

/// Fixture for the LLP 0070 first-slice acceptance (LLP 0115 CV-9): an
/// Ibex mutation that enqueues a one-off job targeting a declared Ibex
/// action which applies its durable effect through a nested mutation —
/// the Dispatch action→mutation shape the callee-class decision admits.
fn jobs_test_state() -> SharedSnapback {
    use crate::manifest::{FieldManifest, FieldType, SchemaManifest, TableManifest};
    let mut snapback = LocalSnapback::memory().expect("jobs test state");
    snapback
        .apply_schema(SchemaManifest {
            tables: vec![TableManifest {
                name: "events".to_owned(),
                fields: vec![FieldManifest {
                    name: "name".to_owned(),
                    field_type: FieldType::String,
                    optional: false,
                }],
                indexes: Vec::new(),
                syncable: true,
                permission_backing: false,
                permission_fields: None,
                search_indexes: Vec::new(),
                vector_indexes: Vec::new(),
                search_live_limits: None,
                membership: None,
                authority_profile: None,
                asset_sharing: None,
                visibility: Some(crate::manifest::TableVisibilityV1::PublicRead),
                history: None,
            }],
            ..SchemaManifest::default()
        })
        .expect("apply jobs schema");
    let manifest = FunctionManifest {
        functions: vec![
            FunctionDefinition::new(
                "scheduleEvent",
                FunctionKind::Mutation,
                FunctionRuntime::IbexModule(IbexModule {
                    source: "globalThis.__snapbackHandlers = {\
                             async scheduleEvent(ctx, args) {\
                               const enqueue = await ctx.jobs.enqueue(\
                                 'notify', { name: args.name }, { delayMs: args.delayMs || 0 });\
                               if (args.fail) throw new Error('rollback requested');\
                               return enqueue;\
                             } };"
                        .to_owned(),
                    export: "scheduleEvent".to_owned(),
                }),
            ),
            FunctionDefinition::new(
                "applyEvent",
                FunctionKind::Mutation,
                FunctionRuntime::IbexModule(IbexModule {
                    source: "globalThis.__snapbackHandlers = {\
                             async applyEvent(ctx, args) {\
                               const id = await ctx.db.insert('events', { name: args.name });\
                               return { id };\
                             } };"
                        .to_owned(),
                    export: "applyEvent".to_owned(),
                }),
            ),
            FunctionDefinition::new(
                "notify",
                FunctionKind::Action,
                FunctionRuntime::IbexModule(IbexModule {
                    source: "globalThis.__snapbackHandlers = {\
                             async notify(ctx, args) {\
                               return await ctx.runMutation('applyEvent', { name: args.name });\
                             } };"
                        .to_owned(),
                    export: "notify".to_owned(),
                }),
            ),
        ],
        ..FunctionManifest::default()
    };
    let diagnostics = snapback.load_functions(manifest);
    assert!(
        diagnostics
            .iter()
            .all(|diagnostic| diagnostic.severity != crate::diagnostic::DiagnosticSeverity::Error),
        "jobs fixture must install: {diagnostics:?}"
    );
    Arc::new(Mutex::new(snapback))
}

fn generation_test_manifest() -> FunctionManifest {
    FunctionManifest {
            functions: vec![
                FunctionDefinition::new(
                    "heldAction",
                    FunctionKind::Action,
                    FunctionRuntime::IbexModule(IbexModule {
                        source: "globalThis.__snapbackHandlers = { async heldAction() { return null; } };"
                            .to_owned(),
                        export: "heldAction".to_owned(),
                    }),
                ),
                FunctionDefinition::new(
                    "hostPlanWrite",
                    FunctionKind::Mutation,
                    FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
            owner_write_checks: Vec::new(),
                        steps: Vec::new(),
                        return_value: None,
                    })),
                ),
                FunctionDefinition::new(
                    "snapshotNestedSuccess",
                    FunctionKind::Mutation,
                    FunctionRuntime::IbexModule(IbexModule {
                        source: "globalThis.__snapbackHandlers = { async snapshotNestedSuccess() { console.log('snapshot-success'); return null; } };"
                            .to_owned(),
                        export: "snapshotNestedSuccess".to_owned(),
                    }),
                ),
                FunctionDefinition::new(
                    "snapshotNestedCommitFailure",
                    FunctionKind::Mutation,
                    FunctionRuntime::IbexModule(IbexModule {
                        source: "globalThis.__snapbackHandlers = { async snapshotNestedCommitFailure(ctx) { console.log('snapshot-failure'); await ctx.db.insert('missing_snapshot_table', {}); return null; } };"
                            .to_owned(),
                        export: "snapshotNestedCommitFailure".to_owned(),
                    }),
                ),
                FunctionDefinition::new(
                    "snapshotNestedHandlerFailure",
                    FunctionKind::Mutation,
                    FunctionRuntime::IbexModule(IbexModule {
                        source: "globalThis.__snapbackHandlers = { async snapshotNestedHandlerFailure() { throw new TypeError('nested value 42 failed'); } };"
                            .to_owned(),
                        export: "snapshotNestedHandlerFailure".to_owned(),
                    }),
                ),
            ],
            ..FunctionManifest::default()
        }
}

fn finite_authority_held_action_functions() -> FunctionManifest {
    let mut functions = finite_authority_matrix_functions();
    functions.functions.extend(
        generation_test_manifest()
            .functions
            .into_iter()
            .filter(|function| function.name == "heldAction"),
    );
    functions
}

fn stage_held_action(state: &SharedSnapback) -> Box<crate::local::DetachedIbexAction> {
    let mut snapback = state.try_lock().expect("test owns instance lock");
    match snapback
        .stage_cron_action_invocation("heldAction")
        .expect("stage detached action")
    {
        StagedAction::Detached(action) => action,
        StagedAction::HostPlan(_) => panic!("Ibex action must detach"),
    }
}

fn held_action_host(
    state: SharedSnapback,
    action: &crate::local::DetachedIbexAction,
) -> DetachedActionHost {
    fn writer_runtime() -> tokio::runtime::Handle {
        static RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
        tokio::runtime::Handle::try_current().unwrap_or_else(|_| {
            RUNTIME
                .get_or_init(|| {
                    tokio::runtime::Builder::new_multi_thread()
                        .worker_threads(1)
                        .enable_time()
                        .build()
                        .expect("construct held-action writer runtime")
                })
                .handle()
                .clone()
        })
    }

    let abandoned = Arc::new(AtomicBool::new(false));
    let stream_runner_host = action
        .invocation
        .authority()
        .stream_runner_host(abandoned.clone());
    let stream_runner = stream_runner_host.runner().clone();
    let commit_gate = stream_runner.commit_gate();
    let authority = action.invocation.authority().clone();
    DetachedActionHost {
        state,
        connected_clients: action.connected_clients.clone(),
        connected_client_predicate_available: action.connected_client_predicate_available,
        abandoned,
        commit_gate,
        active_reservation: Arc::new(StdMutex::new(None)),
        writer_cancellation: Arc::new(ManagedWriterCancellation::default()),
        writer_runtime: writer_runtime(),
        nested_writer_timed_out: AtomicBool::new(false),
        terminal_latch: ActionTerminalLatch::default(),
        deadline: Instant::now() + Duration::from_secs(5),
        app_generation: action.app_generation,
        app_generation_fence: action.app_generation_fence.clone(),
        nested_effect: NestedActionEffect::classify(authority.clone()),
        authority,
        push_grants: action.grants.clone(),
        deferred_push_grant: action.deferred_push_grant.clone(),
        external_effect_open: false,
        external_effect_permit: None,
        http_target_policy: crate::outbound_policy::HttpTargetPolicy::LocalDevLoopbackHttp,
        response_streams: BTreeMap::new(),
        closed_response_streams: BTreeSet::new(),
        last_stream_progress_commit: None,
        stream_runner,
        stream_runner_host,
        output_stream_attempt: None,
        output_stream_function_id: None,
        output_stream_initiator: None,
        ephemeral: action.ephemeral.clone(),
        stream_buffered_bytes: Arc::new(AtomicU64::new(0)),
        stream_buffered_peak: Arc::new(AtomicU64::new(0)),
        automatic_retry_invocation: false,
        host_operation: HostOperationParentV1::from_action_run(
            &crate::local::manual_action_metadata("test", "heldAction"),
        ),
    }
}

async fn provider_settlement_abandonment_case(authority_latch_first: bool) {
    let mut function = FunctionDefinition::new(
        "watchdogProviderRace",
        FunctionKind::Action,
        FunctionRuntime::IbexModule(IbexModule {
            source: r#"globalThis.__snapbackHandlers = {
  watchdogProviderRace() { return "provider result"; }
};"#
            .to_owned(),
            export: "watchdogProviderRace".to_owned(),
        }),
    );
    function.stream = true;
    let mut snapback = LocalSnapback::memory().expect("provider race host state");
    snapback.load_functions(FunctionManifest {
        functions: vec![function],
        ..FunctionManifest::default()
    });
    let state = Arc::new(Mutex::new(snapback));
    let counters = super::install_provider_settle_abandonment_test_hook_with_cause(
        &state,
        authority_latch_first,
    );
    let staged = state
        .try_lock()
        .expect("stage provider race action")
        .stage_cron_action_invocation("watchdogProviderRace")
        .expect("provider race action");
    let StagedAction::Detached(mut action) = staged else {
        panic!("Ibex streaming action must detach")
    };
    action.stream_initiator = Some(crate::stream_attempt::StreamInitiator::SessionUser(
        "watchdog-user".to_owned(),
    ));
    let (started, attempt_token) = tokio::sync::oneshot::channel();
    action.stream_started = Some(started);

    let refused = super::run_detached_ibex_action(
        &state,
        action,
        HandlerInput::default(),
        crate::local::manual_action_metadata("test", "watchdogProviderRace"),
    )
    .await
    .expect_err("the test hook abandons the worker before provider settlement");
    assert_eq!(
        refused.diagnostic.code,
        if authority_latch_first {
            "SNAPBACK_AUTH_SESSION_EXPIRED"
        } else {
            "SNAPBACK_ACTION_TIMEOUT"
        }
    );
    let attempt_token = attempt_token
        .await
        .expect("output attempt starts before provider settlement");
    let terminal = crate::stream_attempt::global_stream_attempt_registry()
        .terminal(&attempt_token)
        .expect("the production worker backstop installs a durable winner");
    assert_eq!(
        terminal.cause,
        if authority_latch_first {
            crate::stream_attempt::StreamAttemptCause::Cancelled
        } else {
            crate::stream_attempt::StreamAttemptCause::TimedOut
        }
    );
    assert_eq!(
        terminal.settled_by,
        crate::stream_attempt::StreamAttemptSettledBy::Terminalizer
    );
    let (provider_invoked, provider_refused, fallback_invoked, cas_won, flush_completed) =
        counters.counts();
    assert_eq!(provider_invoked, 1, "provider settlement closure must run");
    assert_eq!(
        provider_refused, 1,
        "provider settlement must refuse after abandonment"
    );
    assert_eq!(
        fallback_invoked, 1,
        "trusted fallback must run unconditionally"
    );
    assert_eq!(cas_won, 1, "the trusted terminal CAS wins exactly once");
    assert_eq!(
        flush_completed, 1,
        "the trusted terminal is durably flushed once"
    );
}

use super::{
    BoundGrantAuthority, BoundSessionKey, ConnectionRegistry, ConnectionRegistryState,
    FencedPublication, LiveSocketClientMessage, MAX_CONNECTION_GRANTS,
    PreparedConnectionOpenAuthority, RouteClass, RoutePolicy, live_socket_operation_name,
    live_socket_operations, route_registry,
};
use crate::ephemeral::{
    DeleteRequest, EphemeralCollection, EphemeralErrorCode, EphemeralMessage, PublishRequest,
    RoomPermissionProjection, Scope, SubscribeRequest,
};

fn synthetic_connection_authority(bound: BoundGrantAuthority) -> PreparedConnectionOpenAuthority {
    let resolved = match &bound {
        BoundGrantAuthority::Anonymous { .. } => ResolvedAppAuthority::Anonymous,
        BoundGrantAuthority::ServicePrincipal { authority, .. } => authority.clone(),
        // `open_prepared` deliberately discards this field and tests below
        // exercise only the synthetic `BoundGrantAuthority` comparison. Do
        // not mint a session subject merely to populate an inert fixture.
        BoundGrantAuthority::Session { .. } => ResolvedAppAuthority::Anonymous,
    };
    PreparedConnectionOpenAuthority {
        resolved,
        session_route_authority: None,
        service_route_authority: match &bound {
            BoundGrantAuthority::ServicePrincipal {
                route_authority, ..
            } => Some(route_authority.clone()),
            _ => None,
        },
        bound,
        managed_authority: true,
        hosted_sender: None,
    }
}

fn synthetic_session_bound(
    incarnation: &str,
    session_id: &str,
    user_id: &str,
    provider: &str,
    generation: u64,
    deadline_ms: u64,
    publication: crate::auth::session_projection::FencedPublication,
) -> BoundGrantAuthority {
    BoundGrantAuthority::Session {
        authorization_stream_incarnation: incarnation.to_owned(),
        session_id: session_id.to_owned(),
        user_id: user_id.to_owned(),
        provider: provider.to_owned(),
        generation,
        deadline_ms,
        publication,
    }
}

fn connection_open_request(bearer: Option<&str>, body: Value) -> Request<Body> {
    let mut builder = Request::builder()
        .method("POST")
        .uri("/connection/open")
        .header(header::CONTENT_TYPE, "application/json")
        .header("x-snapback-auth-client-protocol", "1")
        .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE);
    if let Some(bearer) = bearer {
        builder = builder.header(header::AUTHORIZATION, format!("Bearer {bearer}"));
    }
    builder
        .body(Body::from(
            serde_json::to_vec(&body).expect("serialize open body"),
        ))
        .expect("connection-open request")
}

fn projected_connection_deadline(state: &AppState, bearer: &str) -> (ResolvedAppAuthority, u64) {
    let provider = state.auth_provider.as_ref().expect("provider");
    let coordinator = state.auth_coordinator.as_ref().expect("coordinator");
    let bearer = SessionBearer::parse(bearer).expect("canonical bearer");
    let super::ConnectionBearerResolution::Current(prepared) = coordinator
        .classify_connection_bearer(&bearer, provider.now_ms(), provider.monotonic_now())
        .expect("classify projected bearer")
    else {
        panic!("bearer must be current")
    };
    let (authority, _incarnation, deadline_ms, _publication) = prepared.into_parts();
    (authority, deadline_ms)
}

#[derive(Clone, Copy, Debug)]
enum ModeOnlyMigrationAuthorizedEffectSite {
    CapabilityLinkMint,
    CapabilityLinkRevoke,
    ClientMutationAcknowledgement,
    AgentInvitationMint,
    PairingCodeMint,
    AskSpendReservation,
}

impl ModeOnlyMigrationAuthorizedEffectSite {
    fn label(self) -> &'static str {
        match self {
            Self::CapabilityLinkMint => "capability-link-mint",
            Self::CapabilityLinkRevoke => "capability-link-revoke",
            Self::ClientMutationAcknowledgement => "client-mutation-acknowledgement",
            Self::AgentInvitationMint => "agent-invitation-mint",
            Self::PairingCodeMint => "pairing-code-mint",
            Self::AskSpendReservation => "ask-spend-reservation",
        }
    }
}

struct ModeOnlyMigrationAuthorizedEffectFixture {
    state: AppState,
    router: SnapbackApp,
    bearer: String,
    session_id: String,
    principal_id: String,
    request: Request<Body>,
    acknowledgement: Option<(PreparedAuthority, MutationAcknowledgementRequest)>,
}

#[derive(Debug, Eq, PartialEq)]
enum ModeOnlyMigrationDurableMarker {
    DatabaseImage(Vec<u8>),
}

async fn mode_only_migration_durable_marker(
    state: &AppState,
    site: ModeOnlyMigrationAuthorizedEffectSite,
    principal_id: &str,
) -> ModeOnlyMigrationDurableMarker {
    let _ = (site, principal_id);
    ModeOnlyMigrationDurableMarker::DatabaseImage(
        with_snapback(&state.snapback, |snapback| {
            let mut image =
                tempfile::NamedTempFile::new().expect("temporary authorized-effect database image");
            snapback
                .backup_database_image_into(image.as_file())
                .expect("capture authorized-effect database image");
            image
                .as_file_mut()
                .seek(SeekFrom::Start(0))
                .expect("rewind database image");
            let mut bytes = Vec::new();
            image
                .as_file_mut()
                .read_to_end(&mut bytes)
                .expect("read authorized-effect database image");
            bytes
        })
        .await,
    )
}

fn prepared_test_session_route_authority(
    state: &AppState,
    source: InvocationSource,
    bearer: &str,
) -> PreparedAuthority {
    let provider = state.auth_provider.as_ref().expect("auth provider");
    let coordinator = state.auth_coordinator.as_ref().expect("auth coordinator");
    let prepared = coordinator
        .resolve_required_bearer(bearer, provider.now_ms(), provider.monotonic_now())
        .expect("resolve authorized-effect session bearer");
    let (resolved, publication) = prepared.into_parts();
    let session_claims = test_session_claims_for(&resolved);
    InvocationGate::prepare_admitted_subjectless_authority(
        source,
        AuthMode::Sessions,
        state.server.profile,
        test_route_admission(state).0,
        &WireAuthorityFields::default(),
        resolved,
        session_claims,
    )
    .expect("prepare authorized-effect session authority")
    .with_fenced_publication(publication)
}

async fn prepared_test_service_route_authority(
    state: &AppState,
    source: InvocationSource,
    bearer: &str,
) -> PreparedAuthority {
    let provider = state.auth_provider.clone().expect("auth provider");
    let coordinator = state.auth_coordinator.as_ref().expect("auth coordinator");
    let token = crate::auth::crypto::ScopedToken::parse(bearer)
        .expect("parse authorized-effect scoped token");
    let now_ms = provider.now_ms();
    let monotonic_now = provider.monotonic_now();
    let stream_publication = coordinator
        .prepare_anonymous_publication()
        .expect("prepare authorized-effect service stream publication");
    let resolution = with_snapback(&state.snapback, {
        let provider = provider.clone();
        move |snapback| {
            snapback.resolve_scoped_token_route_authority(&token, now_ms, monotonic_now, provider)
        }
    })
    .await
    .expect("resolve authorized-effect service authority");
    let profile = state.server.profile;
    let admission = test_route_admission(state).0;
    with_snapback(&state.snapback, move |snapback| {
        snapback.prepare_service_authority(
            resolution,
            source,
            AuthMode::Sessions,
            profile,
            admission,
            &WireAuthorityFields::default(),
            now_ms,
            stream_publication,
        )
    })
    .await
    .expect("prepare authorized-effect service authority")
}

async fn mode_only_migration_target_response(
    state: SharedSnapback,
    router: SnapbackApp,
    request: Request<Body>,
    acknowledgement: Option<(PreparedAuthority, MutationAcknowledgementRequest)>,
) -> axum::response::Response {
    let headers = request.headers().clone();
    if let Some((authority, request)) = acknowledgement {
        return match super::acknowledge_mutations(
            State(state),
            Extension(authority),
            headers,
            Ok(Json(request)),
        )
        .await
        {
            Ok(response) => response.into_response(),
            Err(error) => error.into_response(),
        };
    }
    router
        .oneshot(request)
        .await
        .expect("authorized-effect route response")
}

async fn mode_only_migration_authorized_effect_fixture(
    site: ModeOnlyMigrationAuthorizedEffectSite,
) -> ModeOnlyMigrationAuthorizedEffectFixture {
    let state = match site {
        ModeOnlyMigrationAuthorizedEffectSite::CapabilityLinkMint
        | ModeOnlyMigrationAuthorizedEffectSite::CapabilityLinkRevoke => {
            capability_link_server_fixture().await
        }
        ModeOnlyMigrationAuthorizedEffectSite::ClientMutationAcknowledgement => {
            sessions_activation_server_fixture_async().await
        }
        ModeOnlyMigrationAuthorizedEffectSite::AgentInvitationMint => {
            sessions_activation_server_fixture_with_agents_async(agent_policy(
                AgentsMode::Invited,
                InvitedBy::Users,
            ))
            .await
        }
        ModeOnlyMigrationAuthorizedEffectSite::PairingCodeMint => {
            sessions_activation_server_fixture_async().await
        }
        ModeOnlyMigrationAuthorizedEffectSite::AskSpendReservation => {
            sessions_activation_server_fixture_with_ask_async(
                "http://127.0.0.1:9".to_owned(),
                64 * 1024,
            )
            .await
        }
    };
    let credential = mint_test_credential(
        &state,
        &format!("{}@authorized-effect.example.test", site.label()),
    )
    .await;
    let bearer = credential["token"]
        .as_str()
        .expect("authorized-effect session bearer")
        .to_owned();
    let session_id = credential["session"]["id"]
        .as_str()
        .expect("authorized-effect session id")
        .to_owned();
    let principal_id = credential["session"]["userId"]
        .as_str()
        .expect("authorized-effect session principal id")
        .to_owned();
    let router = app(state.clone());
    let mut acknowledgement = None;
    let request = match site {
        ModeOnlyMigrationAuthorizedEffectSite::CapabilityLinkMint => session_auth_http_request(
            "/capability-links",
            serde_json::to_vec(&json!({
                "function": "queuedWrite",
                "pinnedArgs": { "value": "authorized-effect-mint" },
                "uses": 1,
            }))
            .expect("serialize capability-link mint race request"),
            &bearer,
        ),
        ModeOnlyMigrationAuthorizedEffectSite::CapabilityLinkRevoke => {
            let minted = router
                .clone()
                .oneshot(session_auth_http_request(
                    "/capability-links",
                    serde_json::to_vec(&json!({
                        "function": "queuedWrite",
                        "pinnedArgs": { "value": "authorized-effect-revoke" },
                        "uses": 1,
                    }))
                    .expect("serialize capability-link revoke fixture mint"),
                    &bearer,
                ))
                .await
                .expect("capability-link revoke fixture mint response");
            let status = minted.status();
            let minted = response_json(minted).await;
            assert_eq!(status, StatusCode::OK, "revoke fixture mint: {minted}");
            let id = minted["id"]
                .as_str()
                .expect("revoke fixture capability-link id");
            let mut request =
                session_auth_http_request(&format!("/capability-links/{id}"), Vec::new(), &bearer);
            *request.method_mut() = axum::http::Method::DELETE;
            request
        }
        ModeOnlyMigrationAuthorizedEffectSite::ClientMutationAcknowledgement => {
            let handshake = router
                .clone()
                .oneshot(
                    Request::builder()
                        .uri("/auth/session")
                        .header(header::AUTHORIZATION, format!("Bearer {bearer}"))
                        .header("x-snapback-auth-client-protocol", "1")
                        .via_hosted_terminator(TEST_HOSTED_CLIENT_SOURCE)
                        .header("x-snapback-authority-descriptor-protocol", "1")
                        .body(Body::empty())
                        .expect("authorized-effect ACK handshake request"),
                )
                .await
                .expect("authorized-effect ACK handshake response");
            assert_eq!(handshake.status(), StatusCode::OK);
            let authority_descriptor =
                response_json(handshake).await["authorityDescriptor"].clone();
            let mutation_id = format!("cm_authorized_effect_{}", Uuid::new_v4().simple());
            let mut seed = session_auth_http_request(
                "/mutation/queuedWrite",
                serde_json::to_vec(&json!({
                    "args": { "value": "authorized-effect-ack" },
                    "clientMutationId": mutation_id,
                    "authorityDescriptor": authority_descriptor,
                }))
                .expect("serialize authorized-effect ACK fixture mutation"),
                &bearer,
            );
            seed.headers_mut().insert(
                HeaderName::from_static("x-snapback-authority-descriptor-protocol"),
                HeaderValue::from_static("1"),
            );
            let seeded = router
                .clone()
                .oneshot(seed)
                .await
                .expect("authorized-effect ACK fixture mutation response");
            let status = seeded.status();
            let seeded = response_json(seeded).await;
            assert_eq!(status, StatusCode::OK, "ACK fixture mutation: {seeded}");
            acknowledgement = Some((
                prepared_test_session_route_authority(
                    &state,
                    InvocationSource::MutationSettlementAcknowledgement,
                    &bearer,
                ),
                MutationAcknowledgementRequest {
                    auth: AuthInput::default(),
                    authority_descriptor: serde_json::from_value(authority_descriptor)
                        .expect("decode ACK authority descriptor"),
                    client_mutation_ids: vec![mutation_id],
                },
            ));
            let mut request = Request::builder()
                .method("POST")
                .uri("/client-mutations/acknowledge")
                .body(Body::empty())
                .expect("build direct authorized-effect ACK request");
            request.headers_mut().insert(
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/json"),
            );
            request.headers_mut().insert(
                HeaderName::from_static("x-snapback-authority-descriptor-protocol"),
                HeaderValue::from_static("1"),
            );
            request
        }
        ModeOnlyMigrationAuthorizedEffectSite::AgentInvitationMint => {
            prepared_user_agent_invitation_request(&state, &router, &bearer).await
        }
        ModeOnlyMigrationAuthorizedEffectSite::PairingCodeMint => {
            session_auth_http_request("/auth/pairing-codes", br#"{}"#.to_vec(), &bearer)
        }
        ModeOnlyMigrationAuthorizedEffectSite::AskSpendReservation => {
            let mut request = session_auth_http_request(
                "/api/v1/ask",
                serde_json::to_vec(&json!({
                    "task": "authorized-effect reservation race",
                    "stream": false,
                }))
                .expect("serialize Ask reservation race request"),
                &bearer,
            );
            request.headers_mut().insert(
                HeaderName::from_static(crate::ask::PROVIDER_KEY_HEADER),
                HeaderValue::from_static("authorized-effect-provider-key"),
            );
            request
        }
    };
    ModeOnlyMigrationAuthorizedEffectFixture {
        state,
        router,
        bearer,
        session_id,
        principal_id,
        request,
        acknowledgement,
    }
}

async fn mode_only_migration_logout_wins(site: ModeOnlyMigrationAuthorizedEffectSite) {
    let ModeOnlyMigrationAuthorizedEffectFixture {
        state,
        router,
        bearer,
        session_id: _,
        principal_id,
        mut request,
        acknowledgement,
    } = mode_only_migration_authorized_effect_fixture(site).await;
    let pause = install_test_finite_authority_pause(
        TestFiniteAuthorityPausePoint::BeforeAuthorizedEffectReservation,
    );
    request.headers_mut().insert(
        HeaderName::from_static(TEST_FINITE_AUTHORITY_PAUSE_HEADER),
        HeaderValue::from_str(pause.id()).expect("pre-reservation pause header"),
    );
    let target_router = router.clone();
    let target_state = state.snapback.clone();
    let mut target = tokio::spawn(async move {
        mode_only_migration_target_response(target_state, target_router, request, acknowledgement)
            .await
    });
    tokio::select! {
        reached = tokio::time::timeout(Duration::from_secs(5), pause.wait_until_reached()) => {
            reached.unwrap_or_else(|_| panic!("{site:?} reaches its pre-reservation pause"));
        }
        joined = &mut target => {
            let response = joined.expect("early authorized-effect target task");
            let status = response.status();
            let body = response_json(response).await;
            panic!("{site:?} returned before its pre-reservation pause: {status} {body}");
        }
    }

    let logout = tokio::time::timeout(
        Duration::from_secs(5),
        router.clone().oneshot(session_auth_http_request(
            "/auth/logout",
            br#"{}"#.to_vec(),
            &bearer,
        )),
    )
    .await
    .unwrap_or_else(|_| panic!("{site:?} racing logout does not hang"))
    .expect("logout response");
    assert_eq!(logout.status(), StatusCode::NO_CONTENT);
    let marker_after_logout = mode_only_migration_durable_marker(&state, site, &principal_id).await;

    pause.release().await;
    let response = tokio::time::timeout(Duration::from_secs(5), target)
        .await
        .unwrap_or_else(|_| panic!("logged-out {site:?} request does not hang"))
        .expect("logout-winning target task");
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let response = response_json(response).await;
    assert_eq!(
        response["diagnostic"]["code"],
        "SNAPBACK_AUTH_SESSION_EXPIRED"
    );
    assert_eq!(
        response["diagnostic"]["details"]["authorityDisposition"],
        "durableDelete"
    );
    assert!(
        mode_only_migration_durable_marker(&state, site, &principal_id).await
            == marker_after_logout,
        "retired caller committed target data for {site:?}"
    );
}

async fn mode_only_migration_reservation_wins(site: ModeOnlyMigrationAuthorizedEffectSite) {
    let ModeOnlyMigrationAuthorizedEffectFixture {
        state,
        router,
        bearer,
        session_id,
        principal_id,
        mut request,
        acknowledgement,
    } = mode_only_migration_authorized_effect_fixture(site).await;
    let marker_before = mode_only_migration_durable_marker(&state, site, &principal_id).await;
    let logout_premark_probe =
        prepared_provider_route_authority(&state, InvocationSource::AuthLogout, &bearer).0;
    let effect_pause = install_test_finite_authority_pause(
        TestFiniteAuthorityPausePoint::AfterAuthorizedEffectReservation,
    );
    request.headers_mut().insert(
        HeaderName::from_static(TEST_FINITE_AUTHORITY_PAUSE_HEADER),
        HeaderValue::from_str(effect_pause.id()).expect("post-reservation pause header"),
    );
    let target_router = router.clone();
    let target_state = state.snapback.clone();
    let mut target = tokio::spawn(async move {
        mode_only_migration_target_response(target_state, target_router, request, acknowledgement)
            .await
    });
    tokio::select! {
        reached = tokio::time::timeout(Duration::from_secs(5), effect_pause.wait_until_reached()) => {
            reached.unwrap_or_else(|_| panic!("{site:?} reserves authority before Local"));
        }
        joined = &mut target => {
            let response = joined.expect("early authorized-effect target task");
            let status = response.status();
            let body = response_json(response).await;
            panic!("{site:?} returned before its authorized-effect reservation: {status} {body}");
        }
    }

    let logout_pause = install_test_finite_authority_pause(
        TestFiniteAuthorityPausePoint::AfterSessionTerminalPremark,
    );
    let mut logout_request = session_auth_http_request("/auth/logout", br#"{}"#.to_vec(), &bearer);
    logout_request.headers_mut().insert(
        HeaderName::from_static(TEST_FINITE_AUTHORITY_PAUSE_HEADER),
        HeaderValue::from_str(logout_pause.id()).expect("logout premark pause header"),
    );
    let logout_router = router.clone();
    let logout = tokio::spawn(async move {
        logout_router
            .oneshot(logout_request)
            .await
            .expect("permit-draining logout response")
    });
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            match logout_premark_probe
                .reserve_authorized_effect("mode-only migration logout premark probe")
            {
                Ok(probe) => {
                    drop(probe);
                    tokio::task::yield_now().await;
                }
                Err(error) if error.diagnostic.code == "SNAPBACK_AUTH_SESSION_EXPIRED" => break,
                Err(error) => panic!(
                    "logout premark probe returned {} for {site:?}",
                    error.diagnostic.code
                ),
            }
        }
    })
    .await
    .unwrap_or_else(|_| panic!("logout closes later {site:?} reservations"));
    assert!(
        !logout_pause.has_reached(),
        "logout crossed the {site:?} permit"
    );
    assert!(
        !logout.is_finished(),
        "logout finished while {site:?} was reserved"
    );

    effect_pause.release().await;
    let response = tokio::time::timeout(Duration::from_secs(5), target)
        .await
        .unwrap_or_else(|_| panic!("reservation-winning {site:?} request does not hang"))
        .expect("reservation-winning target task");
    if matches!(
        site,
        ModeOnlyMigrationAuthorizedEffectSite::ClientMutationAcknowledgement
    ) {
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response_json(response).await["acknowledged"], 1);
    } else {
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        let response = response_json(response).await;
        assert_eq!(
            response["diagnostic"]["code"],
            "SNAPBACK_AUTH_SESSION_EXPIRED"
        );
        assert_eq!(
            response["diagnostic"]["details"]["authorityDisposition"],
            "carrier"
        );
    }

    tokio::time::timeout(Duration::from_secs(5), logout_pause.wait_until_reached())
        .await
        .unwrap_or_else(|_| panic!("logout drains after {site:?} commits"));
    assert!(
        mode_only_migration_durable_marker(&state, site, &principal_id).await != marker_before,
        "reserved {site:?} did not commit before logout"
    );
    let precommit_session_facts = with_snapback(&state.snapback, {
        let session_id = session_id.clone();
        move |snapback| {
            snapback
                .remainder_auth_fixture()
                .auth_catalog()
                .session_lifetime_facts_for_test(&session_id)
        }
    })
    .await
    .expect("read pre-logout-commit session facts");
    assert_eq!(precommit_session_facts.2, 1);
    assert!(!precommit_session_facts.3);

    logout_pause.release().await;
    let logout = tokio::time::timeout(Duration::from_secs(5), logout)
        .await
        .expect("drained logout does not hang")
        .expect("drained logout task");
    assert_eq!(logout.status(), StatusCode::NO_CONTENT);
    let terminal_session_facts = with_snapback(&state.snapback, move |snapback| {
        snapback
            .remainder_auth_fixture()
            .auth_catalog()
            .session_lifetime_facts_for_test(&session_id)
    })
    .await
    .expect("read terminal session facts");
    assert_eq!(terminal_session_facts.2, 2);
    assert!(terminal_session_facts.3);
}

#[derive(Clone, Copy, Debug)]
enum ImmediatePushAuthorizedEffectSite {
    Reservation,
    BatchClaim,
    TransmittingMarker,
}

struct ImmediatePushAuthorizedEffectFixture {
    state: AppState,
    router: SnapbackApp,
    bearer: String,
    session_id: String,
    authority: PreparedAuthority,
    request: crate::push::PushSendRequestV1,
    batch_id: Option<String>,
    claim: Option<crate::push::PushBatchClaimV1>,
}

fn immediate_push_declaration() -> crate::push::PushSeamDeclarationV1 {
    crate::push::PushSeamDeclarationV1 {
        app_scope: crate::push::PushAppScopeV1 {
            eas_project_id: "authorized-effect-race".to_owned(),
            application_id: "com.example.authorized-effect-race".to_owned(),
            environment: "test".to_owned(),
        },
        registry: crate::push::PushRegistryDeclarationV1 {
            idle_retention_ms: 86_400_000,
        },
        audiences: BTreeMap::from([(
            "selectedMembers".to_owned(),
            crate::push::PushAudienceDeclarationV1 {
                resolve: crate::push::PushAudienceResolverV1::ExplicitPrincipals {
                    principals_arg: "principalIds".to_owned(),
                    max_items: 1,
                },
                authorize: crate::push::PushAudienceAuthorizeV1::Membership {
                    declaration: "app_members".to_owned(),
                    resource_arg: None,
                    roles: vec!["sender".to_owned()],
                },
            },
        )]),
        uses: Vec::new(),
        ledger: Some(crate::push::PushLedgerDeclarationV1 {
            retention_ms: 86_400_000,
        }),
    }
}

async fn immediate_push_authorized_effect_fixture(
    site: ImmediatePushAuthorizedEffectSite,
) -> ImmediatePushAuthorizedEffectFixture {
    let state = sessions_activation_server_fixture_async().await;
    let credential = mint_test_credential(&state, "immediate-push-fence@example.test").await;
    let bearer = credential["token"].as_str().unwrap().to_owned();
    let session_id = credential["session"]["id"].as_str().unwrap().to_owned();
    let principal_id = credential["session"]["userId"].as_str().unwrap().to_owned();
    let installation_id = crate::ids::mint(crate::ids::Kind::Installation)
        .expect("immediate push fixture installation id");
    let declaration = immediate_push_declaration();
    with_snapback(&state.snapback, {
        let declaration = declaration.clone();
        let principal_id = principal_id.clone();
        let session_id = session_id.clone();
        let installation_id = installation_id.clone();
        move |snapback| {
            let mut database = snapback.remainder_auth_fixture();
            database.activate_push_registry_for_test(declaration.clone())?;
            let mut schema = database.schema().clone();
            schema.push_seam = Some(declaration.clone());
            schema.tables.push(TableManifest {
                name: "app_members".to_owned(),
                fields: vec![
                    FieldManifest {
                        name: "principal".to_owned(),
                        field_type: FieldType::Principal,
                        optional: false,
                    },
                    FieldManifest {
                        name: "role".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    },
                ],
                indexes: Vec::new(),
                syncable: true,
                permission_backing: false,
                permission_fields: None,
                search_indexes: Vec::new(),
                vector_indexes: Vec::new(),
                search_live_limits: None,
                membership: Some(crate::manifest::MembershipManifest {
                    id: Some("app_members".to_owned()),
                    principal: "principal".to_owned(),
                    resource: None,
                    role: "role".to_owned(),
                    roles: vec!["sender".to_owned()],
                    pending_roles: None,
                    bootstrap_role: None,
                    last_holder: None,
                    expiry: None,
                    incidental: None,
                    provenance: None,
                    transitions: Vec::new(),
                    principal_addressed_writes: None,
                    scope: crate::manifest::MembershipScope::App,
                    resource_table: None,
                }),
                authority_profile: None,
                asset_sharing: None,
                visibility: None,
                history: None,
            });
            let mut registry = database.push_registry();
            registry.install_immediate_sender_for_test(schema, &principal_id)?;
            registry.register(
                &declaration,
                &principal_id,
                &session_id,
                1,
                &installation_id,
                "ExponentPushToken[authorized-effect-race]",
                super::now_millis(),
            )?;
            Ok::<_, SnapbackError>(())
        }
    })
    .await
    .expect("install immediate push authorized-effect fixture");
    let authority =
        prepared_test_session_route_authority(&state, InvocationSource::HttpAction, &bearer);
    let request = crate::push::PushSendRequestV1 {
        to: crate::push::PushAudienceReferenceV1 {
            audience: "selectedMembers".to_owned(),
            args: Map::from_iter([("principalIds".to_owned(), json!([principal_id]))]),
        },
        title: "authorized effect race".to_owned(),
        body: "the caller-backed cut is fenced".to_owned(),
        data: None,
        dedupe_key: format!("push-race-{}", Uuid::new_v4().simple()),
        redrive_ambiguous: false,
    };
    let mut batch_id = None;
    let mut claim = None;
    if matches!(
        site,
        ImmediatePushAuthorizedEffectSite::BatchClaim
            | ImmediatePushAuthorizedEffectSite::TransmittingMarker
    ) {
        let reservation = authority
            .reserve_authorized_effect("seed immediate push reservation")
            .expect("reserve seed immediate push authority");
        let (attempt, _) = with_snapback(&state.snapback, {
            let authority = authority.clone();
            let request = request.clone();
            move |snapback| {
                snapback.reserve_push_send_with_authorized_effect(
                    &authority,
                    crate::push::PushTriggerModeV1::Immediate,
                    None,
                    &request,
                    super::now_millis(),
                    reservation,
                )
            }
        })
        .await
        .expect("seed immediate push attempt");
        batch_id = Some(attempt.batches[0].batch_id.clone());
    }
    if matches!(site, ImmediatePushAuthorizedEffectSite::TransmittingMarker) {
        let reservation = authority
            .reserve_authorized_effect("seed immediate push batch claim")
            .expect("reserve seed immediate claim authority");
        let seeded = with_snapback(&state.snapback, {
            let authority = authority.clone();
            let batch_id = batch_id.clone().unwrap();
            move |snapback| {
                snapback.claim_push_batch_with_authorized_effect(
                    &authority,
                    &batch_id,
                    super::now_millis(),
                    reservation,
                )
            }
        })
        .await
        .expect("seed immediate push batch claim")
        .expect("seed push batch exists");
        claim = Some(seeded);
    }
    ImmediatePushAuthorizedEffectFixture {
        router: app(state.clone()),
        state,
        bearer,
        session_id,
        authority,
        request,
        batch_id,
        claim,
    }
}

async fn commit_immediate_push_authorized_effect(
    fixture: &ImmediatePushAuthorizedEffectFixture,
    site: ImmediatePushAuthorizedEffectSite,
    reservation: crate::auth::invocation::AuthorizedEffectReservation,
) -> crate::diagnostic::SnapbackResult<()> {
    with_snapback(&fixture.state.snapback, {
        let authority = fixture.authority.clone();
        let request = fixture.request.clone();
        let batch_id = fixture.batch_id.clone();
        let claim = fixture
            .claim
            .as_ref()
            .map(|claim| crate::push::PushBatchClaimV1 {
                batch_id: claim.batch_id.clone(),
                claim_id: claim.claim_id.clone(),
                fence: claim.fence,
                messages: claim
                    .messages
                    .iter()
                    .map(|message| snapback_kernel::push::ReservedPushMessageV1 {
                        message_id: message.message_id.clone(),
                        token_id: message.token_id.clone(),
                        token: message.token.clone(),
                    })
                    .collect(),
            });
        move |snapback| match site {
            ImmediatePushAuthorizedEffectSite::Reservation => snapback
                .reserve_push_send_with_authorized_effect(
                    &authority,
                    crate::push::PushTriggerModeV1::Immediate,
                    None,
                    &request,
                    super::now_millis(),
                    reservation,
                )
                .map(|_| ()),
            ImmediatePushAuthorizedEffectSite::BatchClaim => snapback
                .claim_push_batch_with_authorized_effect(
                    &authority,
                    batch_id.as_deref().expect("claim fixture batch id"),
                    super::now_millis(),
                    reservation,
                )
                .and_then(|claim| {
                    claim.map(|_| ()).ok_or_else(|| {
                        SnapbackError::error(
                            "TEST_PUSH_BATCH_MISSING",
                            "push",
                            "authorized-effect claim fixture batch is missing",
                        )
                    })
                }),
            ImmediatePushAuthorizedEffectSite::TransmittingMarker => snapback
                .mark_push_batch_transmitting_with_authorized_effect(
                    &authority,
                    claim.as_ref().expect("transmitting fixture claim"),
                    super::now_millis(),
                    reservation,
                ),
        }
    })
    .await
}

async fn run_immediate_push_authorized_effect(
    fixture: &ImmediatePushAuthorizedEffectFixture,
    site: ImmediatePushAuthorizedEffectSite,
) -> crate::diagnostic::SnapbackResult<()> {
    let reservation = fixture.authority.reserve_authorized_effect(match site {
        ImmediatePushAuthorizedEffectSite::Reservation => "push durable reservation",
        ImmediatePushAuthorizedEffectSite::BatchClaim => "push batch claim",
        ImmediatePushAuthorizedEffectSite::TransmittingMarker => "push batch transmitting marker",
    })?;
    commit_immediate_push_authorized_effect(fixture, site, reservation).await
}

async fn immediate_push_logout_wins(site: ImmediatePushAuthorizedEffectSite) {
    let fixture = immediate_push_authorized_effect_fixture(site).await;
    let logout = fixture
        .router
        .clone()
        .oneshot(session_auth_http_request(
            "/auth/logout",
            br#"{}"#.to_vec(),
            &fixture.bearer,
        ))
        .await
        .expect("immediate push racing logout response");
    assert_eq!(logout.status(), StatusCode::NO_CONTENT);
    let after_logout = mode_only_migration_durable_marker(
        &fixture.state,
        ModeOnlyMigrationAuthorizedEffectSite::CapabilityLinkMint,
        "",
    )
    .await;
    let error = run_immediate_push_authorized_effect(&fixture, site)
        .await
        .expect_err("logout must close a later immediate push durable cut");
    assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_SESSION_EXPIRED");
    assert_eq!(
        error.diagnostic.details["authorityDisposition"],
        "durableDelete"
    );
    assert!(
        mode_only_migration_durable_marker(
            &fixture.state,
            ModeOnlyMigrationAuthorizedEffectSite::CapabilityLinkMint,
            "",
        )
        .await
            == after_logout,
        "retired immediate push caller changed durable site state for {site:?}"
    );
}

async fn immediate_push_reservation_wins(site: ImmediatePushAuthorizedEffectSite) {
    let fixture = immediate_push_authorized_effect_fixture(site).await;
    let before = mode_only_migration_durable_marker(
        &fixture.state,
        ModeOnlyMigrationAuthorizedEffectSite::CapabilityLinkMint,
        "",
    )
    .await;
    let reservation = fixture
        .authority
        .reserve_authorized_effect("immediate push race")
        .expect("reserve immediate push caller authority");
    let logout_premark_probe = prepared_provider_route_authority(
        &fixture.state,
        InvocationSource::AuthLogout,
        &fixture.bearer,
    )
    .0;
    let logout_pause = install_test_finite_authority_pause(
        TestFiniteAuthorityPausePoint::AfterSessionTerminalPremark,
    );
    let mut logout_request =
        session_auth_http_request("/auth/logout", br#"{}"#.to_vec(), &fixture.bearer);
    logout_request.headers_mut().insert(
        HeaderName::from_static(TEST_FINITE_AUTHORITY_PAUSE_HEADER),
        HeaderValue::from_str(logout_pause.id()).expect("push logout premark pause header"),
    );
    let logout_router = fixture.router.clone();
    let logout = tokio::spawn(async move {
        logout_router
            .oneshot(logout_request)
            .await
            .expect("immediate push permit-draining logout response")
    });
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            match logout_premark_probe.reserve_authorized_effect("immediate push logout probe") {
                Ok(probe) => {
                    drop(probe);
                    tokio::task::yield_now().await;
                }
                Err(error) if error.diagnostic.code == "SNAPBACK_AUTH_SESSION_EXPIRED" => break,
                Err(error) => panic!("unexpected push logout probe: {}", error.diagnostic.code),
            }
        }
    })
    .await
    .expect("logout closes later immediate push reservations");
    assert!(!logout_pause.has_reached());
    assert!(!logout.is_finished());

    commit_immediate_push_authorized_effect(&fixture, site, reservation)
        .await
        .expect("reserved immediate push durable cut commits");
    tokio::time::timeout(Duration::from_secs(5), logout_pause.wait_until_reached())
        .await
        .expect("logout drains after immediate push commit");
    assert!(
        mode_only_migration_durable_marker(
            &fixture.state,
            ModeOnlyMigrationAuthorizedEffectSite::CapabilityLinkMint,
            "",
        )
        .await
            != before,
        "reserved immediate push site did not commit for {site:?}"
    );
    let preterminal = with_snapback(&fixture.state.snapback, {
        let session_id = fixture.session_id.clone();
        move |snapback| {
            snapback
                .remainder_auth_fixture()
                .auth_catalog()
                .session_lifetime_facts_for_test(&session_id)
        }
    })
    .await
    .expect("read immediate push preterminal session");
    assert_eq!(preterminal.2, 1);
    assert!(!preterminal.3);

    logout_pause.release().await;
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(5), logout)
            .await
            .expect("immediate push logout completes")
            .expect("immediate push logout task")
            .status(),
        StatusCode::NO_CONTENT
    );
    let terminal = with_snapback(&fixture.state.snapback, {
        let session_id = fixture.session_id.clone();
        move |snapback| {
            snapback
                .remainder_auth_fixture()
                .auth_catalog()
                .session_lifetime_facts_for_test(&session_id)
        }
    })
    .await
    .expect("read immediate push terminal session");
    assert_eq!(terminal.2, 2);
    assert!(terminal.3);
}

const ASSET_AUTHORIZED_EFFECT_TEST_SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async strictUpload(ctx) {
    return { owner: ctx.auth.userId };
  },
  async signedUpload(ctx) {
    return { owner: ctx.auth.userId };
  },
  async strictImageUpload(ctx) {
    return { owner: ctx.auth.userId };
  },
  async signedImageUpload(ctx) {
    return { owner: ctx.auth.userId };
  },
  async requiredImageUpload(ctx) {
    return { owner: ctx.auth.userId };
  }
};
"#;

fn asset_authorized_effect_test_intent(
    name: &str,
    delivery: crate::assets::AssetDeliveryProfile,
) -> crate::manifest::AssetUploadIntentDefinition {
    let image = name.contains("Image");
    let variants = if name == "requiredImageUpload" {
        vec![crate::manifest::AssetImageVariant {
            key: "required-thumb".to_owned(),
            width: 8,
            required: true,
        }]
    } else {
        Vec::new()
    };
    crate::manifest::AssetUploadIntentDefinition {
        id: format!("app:{name}"),
        name: name.to_owned(),
        exported_name: Some(name.to_owned()),
        implementation_hash: Some("sha256:asset-authorized-effect-test-impl".to_owned()),
        args_contract_hash: Some("sha256:asset-authorized-effect-test-args".to_owned()),
        intent_policy_hash: format!("sha256:asset-authorized-effect-test-policy-{name}"),
        auth_requirement: None,
        accept: crate::manifest::AssetAcceptPolicy {
            media_types: vec![if image {
                "image/png".to_owned()
            } else {
                "application/octet-stream".to_owned()
            }],
            max_bytes: 64 * 1024,
        },
        delivery: crate::manifest::AssetDeliveryPolicy { kind: delivery },
        access: crate::manifest::AssetAccessPolicy {
            read: crate::assets::AssetReadAccessPolicy::OwnerOnly,
        },
        grants: false,
        image: image.then_some(crate::manifest::AssetImagePolicy {
            location: crate::manifest::AssetLocationPolicy::Retain,
            variants,
        }),
        video: None,
        on: None,
        declared_reads: Vec::new(),
        runtime: FunctionRuntime::IbexModule(IbexModule {
            source: ASSET_AUTHORIZED_EFFECT_TEST_SOURCE.to_owned(),
            export: name.to_owned(),
        }),
        handler_form: Some("inline".to_owned()),
        source_span: None,
    }
}

async fn asset_authorized_effect_server_fixture_async() -> AppState {
    tokio::task::spawn_blocking(|| {
        let _sanction = crate::exec_guard::BlockingSanction::acquire();
        let mut functions = activation_functions('2', false);
        functions.asset_upload_intents = vec![
            asset_authorized_effect_test_intent(
                "strictUpload",
                crate::assets::AssetDeliveryProfile::PrivateStrict,
            ),
            asset_authorized_effect_test_intent(
                "signedUpload",
                crate::assets::AssetDeliveryProfile::PrivateSigned,
            ),
            asset_authorized_effect_test_intent(
                "strictImageUpload",
                crate::assets::AssetDeliveryProfile::PrivateStrict,
            ),
            asset_authorized_effect_test_intent(
                "signedImageUpload",
                crate::assets::AssetDeliveryProfile::PrivateSigned,
            ),
            asset_authorized_effect_test_intent(
                "requiredImageUpload",
                crate::assets::AssetDeliveryProfile::PrivateStrict,
            ),
        ];
        sessions_activation_server_fixture_with(functions, None)
    })
    .await
    .expect("construct asset-authority fixture off the async workers")
}

#[derive(Clone, Copy, Debug)]
enum AssetAuthorizedEffectSite {
    AttemptCreation,
    AttemptCancellation,
    AttemptInspectLazyExpiry,
    TusHeadLazyExpiry,
    TusPatchAcknowledgement,
    Finalize,
    ExplicitDelete,
    SignedUrlReceipt,
    StrictDeliveryReceipt,
    SignedUrlWidthMaterialization,
    StrictDeliveryWidthMaterialization,
}

impl AssetAuthorizedEffectSite {
    fn label(self) -> &'static str {
        match self {
            Self::AttemptCreation => "attempt-creation",
            Self::AttemptCancellation => "attempt-cancellation",
            Self::AttemptInspectLazyExpiry => "attempt-inspect-lazy-expiry",
            Self::TusHeadLazyExpiry => "tus-head-lazy-expiry",
            Self::TusPatchAcknowledgement => "tus-patch-acknowledgement",
            Self::Finalize => "finalize",
            Self::ExplicitDelete => "explicit-delete",
            Self::SignedUrlReceipt => "signed-url-receipt",
            Self::StrictDeliveryReceipt => "strict-delivery-receipt",
            Self::SignedUrlWidthMaterialization => "signed-url-width-materialization",
            Self::StrictDeliveryWidthMaterialization => "strict-delivery-width-materialization",
        }
    }

    fn needs_ready_asset(self) -> bool {
        matches!(
            self,
            Self::SignedUrlReceipt
                | Self::StrictDeliveryReceipt
                | Self::SignedUrlWidthMaterialization
                | Self::StrictDeliveryWidthMaterialization
        )
    }

    fn needs_complete_transfer(self) -> bool {
        matches!(self, Self::Finalize)
    }

    fn needs_expired_attempt(self) -> bool {
        matches!(
            self,
            Self::AttemptInspectLazyExpiry | Self::TusHeadLazyExpiry
        )
    }

    fn intent_name(self) -> &'static str {
        match self {
            Self::SignedUrlReceipt => "signedUpload",
            Self::SignedUrlWidthMaterialization => "signedImageUpload",
            Self::StrictDeliveryWidthMaterialization => "strictImageUpload",
            _ => "strictUpload",
        }
    }

    fn upload_bytes(self) -> &'static [u8] {
        if matches!(
            self,
            Self::SignedUrlWidthMaterialization | Self::StrictDeliveryWidthMaterialization
        ) {
            include_bytes!("../../../../brand/favicon-16.png")
        } else {
            b"x"
        }
    }

    fn upload_content_type(self) -> &'static str {
        if matches!(
            self,
            Self::SignedUrlWidthMaterialization | Self::StrictDeliveryWidthMaterialization
        ) {
            "image/png"
        } else {
            "application/octet-stream"
        }
    }
}

#[derive(Clone, Debug)]
struct AssetAuthorizedEffectTarget {
    asset_id: Option<String>,
    attempt_id: Option<String>,
    lifecycle_generation: Option<u64>,
}

struct AssetAuthorizedEffectFixture {
    state: AppState,
    router: SnapbackApp,
    bearer: String,
    session_id: String,
    user_id: String,
    target: AssetAuthorizedEffectTarget,
}

fn asset_session_request(
    method: &str,
    uri: &str,
    body: Vec<u8>,
    content_type: Option<&'static str>,
    bearer: &str,
) -> Request<Body> {
    let mut request = auth_http_request(method, uri, body, false, None, None);
    offer_auth_client_protocol(&mut request);
    request.headers_mut().insert(
        header::AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {bearer}")).expect("asset bearer header"),
    );
    if let Some(content_type) = content_type {
        request
            .headers_mut()
            .insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
    }
    request
}

async fn asset_test_create(
    router: &SnapbackApp,
    bearer: &str,
    intent_name: &str,
    declared_length: usize,
    declared_content_type: &str,
) -> AssetAuthorizedEffectTarget {
    let response = router
        .clone()
        .oneshot(asset_session_request(
            "POST",
            "/assets/attempts",
            serde_json::to_vec(&json!({
                "intentId": format!("app:{intent_name}"),
                "intentPolicyHash": format!(
                    "sha256:asset-authorized-effect-test-policy-{intent_name}"
                ),
                "implementationHash": "sha256:asset-authorized-effect-test-impl",
                "args": {},
                "declaredFilename": "asset-authority-race.bin",
                "declaredLength": declared_length,
                "declaredContentType": declared_content_type,
            }))
            .expect("serialize asset create request"),
            Some("application/json"),
            bearer,
        ))
        .await
        .expect("asset create response");
    let status = response.status();
    let response = response_json(response).await;
    assert_eq!(status, StatusCode::OK, "asset setup create: {response}");
    AssetAuthorizedEffectTarget {
        asset_id: Some(
            response["task"]["assetId"]
                .as_str()
                .expect("created asset id")
                .to_owned(),
        ),
        attempt_id: Some(
            response["task"]["attemptId"]
                .as_str()
                .expect("created attempt id")
                .to_owned(),
        ),
        lifecycle_generation: Some(1),
    }
}

async fn asset_test_patch(router: &SnapbackApp, bearer: &str, attempt_id: &str, bytes: &[u8]) {
    let mut request = asset_session_request(
        "PATCH",
        &format!("/assets/tus/{attempt_id}"),
        bytes.to_vec(),
        Some("application/offset+octet-stream"),
        bearer,
    );
    request.headers_mut().insert(
        HeaderName::from_static("tus-resumable"),
        HeaderValue::from_static("1.0.0"),
    );
    request.headers_mut().insert(
        HeaderName::from_static("upload-offset"),
        HeaderValue::from_static("0"),
    );
    let response = router
        .clone()
        .oneshot(request)
        .await
        .expect("asset setup patch response");
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
}

async fn asset_test_finalize(
    router: &SnapbackApp,
    bearer: &str,
    target: &AssetAuthorizedEffectTarget,
) {
    let attempt_id = target.attempt_id.as_deref().expect("finalized attempt id");
    let response = router
        .clone()
        .oneshot(asset_session_request(
            "POST",
            &format!("/assets/attempts/{attempt_id}/finalize"),
            serde_json::to_vec(&json!({
                "attemptId": attempt_id,
                "lifecycleGeneration": target.lifecycle_generation,
            }))
            .expect("serialize finalize request"),
            Some("application/json"),
            bearer,
        ))
        .await
        .expect("asset setup finalize response");
    let status = response.status();
    let response = response_json(response).await;
    assert_eq!(status, StatusCode::OK, "asset setup finalize: {response}");
    assert_eq!(response["task"]["availability"], "ready", "{response}");
}

async fn asset_authorized_effect_fixture(
    site: AssetAuthorizedEffectSite,
) -> AssetAuthorizedEffectFixture {
    asset_authorized_effect_fixture_with_upload(
        site,
        site.intent_name(),
        site.upload_bytes(),
        site.upload_content_type(),
    )
    .await
}

async fn asset_authorized_effect_fixture_with_upload(
    site: AssetAuthorizedEffectSite,
    intent_name: &str,
    upload_bytes: &[u8],
    upload_content_type: &str,
) -> AssetAuthorizedEffectFixture {
    let state = asset_authorized_effect_server_fixture_async().await;
    let credential =
        mint_test_credential(&state, &format!("asset-{}@example.test", site.label())).await;
    let bearer = credential["token"]
        .as_str()
        .expect("ordinary asset session bearer")
        .to_owned();
    let session_id = credential["session"]["id"]
        .as_str()
        .expect("ordinary asset session id")
        .to_owned();
    let user_id = credential["session"]["userId"]
        .as_str()
        .expect("ordinary asset session user id")
        .to_owned();
    let router = app(state.clone());
    let target = if matches!(site, AssetAuthorizedEffectSite::AttemptCreation) {
        AssetAuthorizedEffectTarget {
            asset_id: None,
            attempt_id: None,
            lifecycle_generation: None,
        }
    } else {
        let target = asset_test_create(
            &router,
            &bearer,
            intent_name,
            upload_bytes.len(),
            upload_content_type,
        )
        .await;
        if site.needs_ready_asset() || site.needs_complete_transfer() {
            asset_test_patch(
                &router,
                &bearer,
                target.attempt_id.as_deref().expect("ready attempt id"),
                upload_bytes,
            )
            .await;
        }
        if site.needs_ready_asset() {
            asset_test_finalize(&router, &bearer, &target).await;
        }
        if site.needs_expired_attempt() {
            let attempt_id = target
                .attempt_id
                .as_deref()
                .expect("lazy-expiry attempt id")
                .to_owned();
            with_snapback(&state.snapback, move |snapback| {
                snapback_engine::test_support::asset_set_attempt_expiry(snapback, &attempt_id, 1)
            })
            .await
            .expect("rewind asset attempt expiry");
        }
        target
    };
    AssetAuthorizedEffectFixture {
        state,
        router,
        bearer,
        session_id,
        user_id,
        target,
    }
}

#[derive(Debug, Eq, PartialEq)]
enum AssetDurableWitness {
    AssetCount(usize),
    Attempt {
        state: String,
        offset: u64,
    },
    AttemptLifecycle {
        state: String,
        receipt_count: usize,
    },
    Availability(String),
    ReceiptCount(usize),
    Width {
        publication_count: u64,
        rendition_count: usize,
        settled_bytes: u64,
    },
    Finalize {
        publication_count: u64,
        attempt_state: String,
        availability: String,
        rendition_count: usize,
        settled_bytes: u64,
        receipt_count: usize,
    },
}

async fn asset_durable_witness(
    fixture: &AssetAuthorizedEffectFixture,
    site: AssetAuthorizedEffectSite,
) -> AssetDurableWitness {
    if matches!(site, AssetAuthorizedEffectSite::AttemptCreation) {
        let listing = with_snapback(&fixture.state.snapback, |snapback| {
            snapback_engine::test_support::asset_host_op(
                snapback,
                "asset.list",
                None,
                None,
                ServerProfile::Test,
            )
        })
        .await
        .expect("list asset rows for race witness");
        return AssetDurableWitness::AssetCount(
            listing["assets"]
                .as_array()
                .expect("asset listing array")
                .len(),
        );
    }

    let asset_id = fixture
        .target
        .asset_id
        .as_deref()
        .expect("race target asset id")
        .to_owned();
    let user_id = fixture.user_id.clone();
    let inspected = with_snapback(&fixture.state.snapback, move |snapback| {
        let input = json!({ "assetId": asset_id });
        snapback_engine::test_support::asset_host_op(
            snapback,
            "asset.inspect",
            Some(&input),
            Some(&user_id),
            ServerProfile::Test,
        )
    })
    .await
    .expect("inspect asset race witness");
    let publication_count = with_snapback(&fixture.state.snapback, |snapback| {
        snapback_engine::test_support::asset_publication_count(snapback)
    })
    .await
    .expect("count asset publication rows for race witness");
    match site {
        AssetAuthorizedEffectSite::AttemptInspectLazyExpiry
        | AssetAuthorizedEffectSite::TusHeadLazyExpiry => {
            let attempt_id = fixture
                .target
                .attempt_id
                .as_deref()
                .expect("lazy-expiry target attempt id")
                .to_owned();
            let durable_attempt_state = with_snapback(&fixture.state.snapback, move |snapback| {
                snapback_engine::test_support::asset_attempt_state(snapback, &attempt_id)
            })
            .await
            .expect("load durable lazy-expiry attempt state");
            AssetDurableWitness::AttemptLifecycle {
                state: serde_json::to_value(durable_attempt_state)
                    .expect("serialize lazy-expiry attempt state")
                    .as_str()
                    .expect("lazy-expiry attempt state string")
                    .to_owned(),
                receipt_count: inspected["receipts"]
                    .as_array()
                    .expect("asset receipts")
                    .len(),
            }
        }
        AssetAuthorizedEffectSite::TusPatchAcknowledgement => AssetDurableWitness::Attempt {
            state: inspected["currentAttempt"]["state"]
                .as_str()
                .expect("current attempt state")
                .to_owned(),
            offset: inspected["currentAttempt"]["acknowledgedOffset"]
                .as_u64()
                .expect("current attempt offset"),
        },
        AssetAuthorizedEffectSite::Finalize => {
            let attempt_id = fixture
                .target
                .attempt_id
                .as_deref()
                .expect("finalize target attempt id")
                .to_owned();
            let durable_attempt_state = with_snapback(&fixture.state.snapback, move |snapback| {
                snapback_engine::test_support::asset_attempt_state(snapback, &attempt_id)
            })
            .await
            .expect("load durable finalize attempt state");
            AssetDurableWitness::Finalize {
                publication_count,
                attempt_state: serde_json::to_value(durable_attempt_state)
                    .expect("serialize finalize attempt state")
                    .as_str()
                    .expect("finalize attempt state string")
                    .to_owned(),
                availability: inspected["asset"]["availability"]
                    .as_str()
                    .expect("finalize asset availability")
                    .to_owned(),
                rendition_count: inspected["renditions"]
                    .as_array()
                    .expect("finalize renditions")
                    .len(),
                settled_bytes: inspected["accounting"]["settledBytes"]
                    .as_u64()
                    .expect("finalize settled-byte accounting"),
                receipt_count: inspected["receipts"]
                    .as_array()
                    .expect("finalize receipts")
                    .len(),
            }
        }
        AssetAuthorizedEffectSite::ExplicitDelete => AssetDurableWitness::Availability(
            inspected["asset"]["availability"]
                .as_str()
                .expect("asset availability")
                .to_owned(),
        ),
        AssetAuthorizedEffectSite::AttemptCancellation
        | AssetAuthorizedEffectSite::SignedUrlReceipt
        | AssetAuthorizedEffectSite::StrictDeliveryReceipt => AssetDurableWitness::ReceiptCount(
            inspected["receipts"]
                .as_array()
                .expect("asset receipts")
                .len(),
        ),
        AssetAuthorizedEffectSite::SignedUrlWidthMaterialization
        | AssetAuthorizedEffectSite::StrictDeliveryWidthMaterialization => {
            AssetDurableWitness::Width {
                publication_count,
                rendition_count: inspected["renditions"]
                    .as_array()
                    .expect("asset renditions")
                    .len(),
                settled_bytes: inspected["accounting"]["settledBytes"]
                    .as_u64()
                    .expect("asset settled-byte accounting"),
            }
        }
        AssetAuthorizedEffectSite::AttemptCreation => unreachable!(),
    }
}

fn asset_target_request(
    fixture: &AssetAuthorizedEffectFixture,
    site: AssetAuthorizedEffectSite,
) -> Request<Body> {
    let asset_id = fixture.target.asset_id.as_deref();
    let attempt_id = fixture.target.attempt_id.as_deref();
    let mut request = match site {
        AssetAuthorizedEffectSite::AttemptCreation => asset_session_request(
            "POST",
            "/assets/attempts",
            serde_json::to_vec(&json!({
                "intentId": "app:strictUpload",
                "intentPolicyHash": "sha256:asset-authorized-effect-test-policy-strictUpload",
                "implementationHash": "sha256:asset-authorized-effect-test-impl",
                "args": {},
                "declaredFilename": "asset-authority-race.bin",
                "declaredLength": 1,
                "declaredContentType": "application/octet-stream",
            }))
            .expect("serialize racing create request"),
            Some("application/json"),
            &fixture.bearer,
        ),
        AssetAuthorizedEffectSite::AttemptCancellation => asset_session_request(
            "POST",
            &format!(
                "/assets/attempts/{}/cancel",
                attempt_id.expect("cancel attempt id")
            ),
            serde_json::to_vec(&json!({
                "attemptId": attempt_id,
                "lifecycleGeneration": fixture.target.lifecycle_generation,
                "discardAsset": false,
            }))
            .expect("serialize racing cancellation request"),
            Some("application/json"),
            &fixture.bearer,
        ),
        AssetAuthorizedEffectSite::AttemptInspectLazyExpiry => asset_session_request(
            "GET",
            &format!(
                "/assets/attempts/{}",
                attempt_id.expect("attempt-inspect attempt id")
            ),
            Vec::new(),
            None,
            &fixture.bearer,
        ),
        AssetAuthorizedEffectSite::TusHeadLazyExpiry => {
            let mut request = asset_session_request(
                "HEAD",
                &format!("/assets/tus/{}", attempt_id.expect("TUS HEAD attempt id")),
                Vec::new(),
                None,
                &fixture.bearer,
            );
            request.headers_mut().insert(
                HeaderName::from_static("tus-resumable"),
                HeaderValue::from_static("1.0.0"),
            );
            request
        }
        AssetAuthorizedEffectSite::TusPatchAcknowledgement => {
            let mut request = asset_session_request(
                "PATCH",
                &format!("/assets/tus/{}", attempt_id.expect("TUS attempt id")),
                vec![b'z'],
                Some("application/offset+octet-stream"),
                &fixture.bearer,
            );
            request.headers_mut().insert(
                HeaderName::from_static("tus-resumable"),
                HeaderValue::from_static("1.0.0"),
            );
            request.headers_mut().insert(
                HeaderName::from_static("upload-offset"),
                HeaderValue::from_static("0"),
            );
            request
        }
        AssetAuthorizedEffectSite::Finalize => asset_session_request(
            "POST",
            &format!(
                "/assets/attempts/{}/finalize",
                attempt_id.expect("finalize attempt id")
            ),
            serde_json::to_vec(&json!({
                "attemptId": attempt_id,
                "lifecycleGeneration": fixture.target.lifecycle_generation,
            }))
            .expect("serialize racing finalize request"),
            Some("application/json"),
            &fixture.bearer,
        ),
        AssetAuthorizedEffectSite::ExplicitDelete => asset_session_request(
            "DELETE",
            &format!(
                "/assets/records/{}",
                asset_id.expect("explicit-delete asset id")
            ),
            Vec::new(),
            None,
            &fixture.bearer,
        ),
        AssetAuthorizedEffectSite::SignedUrlReceipt => asset_session_request(
            "POST",
            &format!(
                "/assets/records/{}/signed-url",
                asset_id.expect("signed-url asset id")
            ),
            br#"{}"#.to_vec(),
            Some("application/json"),
            &fixture.bearer,
        ),
        AssetAuthorizedEffectSite::StrictDeliveryReceipt => asset_session_request(
            "GET",
            &format!(
                "/assets/records/{}/bytes/primary",
                asset_id.expect("strict-delivery asset id")
            ),
            Vec::new(),
            None,
            &fixture.bearer,
        ),
        AssetAuthorizedEffectSite::SignedUrlWidthMaterialization => asset_session_request(
            "POST",
            &format!(
                "/assets/records/{}/signed-url",
                asset_id.expect("signed width asset id")
            ),
            br#"{"widthPx":8}"#.to_vec(),
            Some("application/json"),
            &fixture.bearer,
        ),
        AssetAuthorizedEffectSite::StrictDeliveryWidthMaterialization => asset_session_request(
            "GET",
            &format!(
                "/assets/records/{}/bytes/primary?width=8",
                asset_id.expect("strict width asset id")
            ),
            Vec::new(),
            None,
            &fixture.bearer,
        ),
    };
    request.headers_mut().insert(
        HeaderName::from_static(TEST_FINITE_AUTHORITY_PAUSE_HEADER),
        HeaderValue::from_static("set-by-race-runner"),
    );
    request
}

fn assert_asset_effect_committed(
    site: AssetAuthorizedEffectSite,
    before: &AssetDurableWitness,
    after: &AssetDurableWitness,
) {
    match (site, before, after) {
        (
            AssetAuthorizedEffectSite::AttemptCreation,
            AssetDurableWitness::AssetCount(before),
            AssetDurableWitness::AssetCount(after),
        ) => assert_eq!(*after, before + 1),
        (
            AssetAuthorizedEffectSite::TusPatchAcknowledgement,
            AssetDurableWitness::Attempt {
                state: before_state,
                offset: before_offset,
            },
            AssetDurableWitness::Attempt {
                state: after_state,
                offset: after_offset,
            },
        ) => {
            assert_eq!(before_state, "open");
            assert_eq!(after_state, "transferring");
            assert_eq!(*after_offset, before_offset + 1);
        }
        (
            AssetAuthorizedEffectSite::Finalize,
            AssetDurableWitness::Finalize {
                publication_count: before_publications,
                attempt_state: before_state,
                availability: before_availability,
                rendition_count: before_renditions,
                settled_bytes: before_settled,
                receipt_count: before_receipts,
            },
            AssetDurableWitness::Finalize {
                publication_count: after_publications,
                attempt_state: after_state,
                availability: after_availability,
                rendition_count: after_renditions,
                settled_bytes: after_settled,
                receipt_count: after_receipts,
            },
        ) => {
            assert_eq!(before_state, "transferring");
            assert_eq!(before_availability, "pending");
            assert_eq!(after_state, "complete");
            assert_eq!(after_availability, "ready");
            assert_eq!(*after_publications, before_publications + 1);
            assert_eq!(*after_renditions, before_renditions + 1);
            assert!(
                after_settled > before_settled,
                "finalize must settle canonical quota"
            );
            assert!(
                after_receipts > before_receipts,
                "finalize must emit Phase-D receipts"
            );
        }
        (
            AssetAuthorizedEffectSite::AttemptInspectLazyExpiry
            | AssetAuthorizedEffectSite::TusHeadLazyExpiry,
            AssetDurableWitness::AttemptLifecycle {
                state: before_state,
                receipt_count: before_receipts,
            },
            AssetDurableWitness::AttemptLifecycle {
                state: after_state,
                receipt_count: after_receipts,
            },
        ) => {
            assert_eq!(before_state, "open");
            assert_eq!(after_state, "expired");
            assert_eq!(*after_receipts, before_receipts + 1);
        }
        (
            AssetAuthorizedEffectSite::ExplicitDelete,
            AssetDurableWitness::Availability(before),
            AssetDurableWitness::Availability(after),
        ) => {
            assert_eq!(before, "pending");
            assert_eq!(after, "deleted");
        }
        (
            AssetAuthorizedEffectSite::AttemptCancellation
            | AssetAuthorizedEffectSite::SignedUrlReceipt
            | AssetAuthorizedEffectSite::StrictDeliveryReceipt,
            AssetDurableWitness::ReceiptCount(before),
            AssetDurableWitness::ReceiptCount(after),
        ) => assert_eq!(*after, before + 1),
        (
            AssetAuthorizedEffectSite::SignedUrlWidthMaterialization
            | AssetAuthorizedEffectSite::StrictDeliveryWidthMaterialization,
            AssetDurableWitness::Width {
                publication_count: before_publications,
                rendition_count: before_renditions,
                settled_bytes: before_settled,
            },
            AssetDurableWitness::Width {
                publication_count: after_publications,
                rendition_count: after_renditions,
                settled_bytes: after_settled,
            },
        ) => {
            assert_eq!(*after_publications, before_publications + 1);
            assert_eq!(*after_renditions, before_renditions + 1);
            assert!(
                after_settled > before_settled,
                "width materialization must settle rendition quota"
            );
        }
        _ => panic!("mismatched asset durable witnesses: {site:?}, {before:?}, {after:?}"),
    }
}

async fn assert_asset_session_expired_response(
    response: axum::response::Response,
    site: AssetAuthorizedEffectSite,
    authority_disposition: &str,
) {
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read asset race response");
    if matches!(site, AssetAuthorizedEffectSite::TusHeadLazyExpiry) {
        // HTTP HEAD suppresses the JSON diagnostic body. The unauthorized
        // status is the on-wire projection of the same typed session-expired
        // error asserted with its full carrier below on every body-bearing
        // member of this shared race mechanism.
        assert!(bytes.is_empty(), "TUS HEAD must not emit a response body");
        return;
    }
    let response: Value = serde_json::from_slice(&bytes).expect("asset race diagnostic JSON");
    assert_eq!(
        response["diagnostic"]["code"],
        "SNAPBACK_AUTH_SESSION_EXPIRED"
    );
    assert_eq!(
        response["diagnostic"]["details"]["authorityDisposition"],
        authority_disposition
    );
}

async fn asset_logout_wins_before_reservation(site: AssetAuthorizedEffectSite) {
    let fixture = asset_authorized_effect_fixture(site).await;
    let before = asset_durable_witness(&fixture, site).await;
    let pause = install_test_finite_authority_pause(
        TestFiniteAuthorityPausePoint::BeforeAuthorizedEffectReservation,
    );
    let mut request = asset_target_request(&fixture, site);
    request.headers_mut().insert(
        HeaderName::from_static(TEST_FINITE_AUTHORITY_PAUSE_HEADER),
        HeaderValue::from_str(pause.id()).expect("asset pre-reservation pause header"),
    );
    let target_router = fixture.router.clone();
    let target = tokio::spawn(async move {
        target_router
            .oneshot(request)
            .await
            .expect("logout-racing asset response")
    });
    tokio::time::timeout(Duration::from_secs(5), pause.wait_until_reached())
        .await
        .expect("asset request reaches the pre-reservation pause");

    let logout = tokio::time::timeout(
        Duration::from_secs(5),
        fixture.router.clone().oneshot(session_auth_http_request(
            "/auth/logout",
            br#"{}"#.to_vec(),
            &fixture.bearer,
        )),
    )
    .await
    .expect("asset-racing logout does not hang")
    .expect("asset-racing logout response");
    assert_eq!(logout.status(), StatusCode::NO_CONTENT);

    pause.release().await;
    let response = tokio::time::timeout(Duration::from_secs(5), target)
        .await
        .expect("logged-out asset request does not hang")
        .expect("logged-out asset request task");
    assert_asset_session_expired_response(response, site, "durableDelete").await;
    let after = asset_durable_witness(&fixture, site).await;
    assert_eq!(after, before, "retired caller committed {site:?}");
}

async fn asset_reservation_wins_before_logout(site: AssetAuthorizedEffectSite) {
    let fixture = asset_authorized_effect_fixture(site).await;
    let before = asset_durable_witness(&fixture, site).await;
    let logout_premark_probe = prepared_provider_route_authority(
        &fixture.state,
        InvocationSource::AuthLogout,
        &fixture.bearer,
    )
    .0;
    let effect_pause = install_test_finite_authority_pause(
        TestFiniteAuthorityPausePoint::AfterAuthorizedEffectReservation,
    );
    let mut request = asset_target_request(&fixture, site);
    request.headers_mut().insert(
        HeaderName::from_static(TEST_FINITE_AUTHORITY_PAUSE_HEADER),
        HeaderValue::from_str(effect_pause.id()).expect("asset reservation pause header"),
    );
    let target_router = fixture.router.clone();
    let target = tokio::spawn(async move {
        target_router
            .oneshot(request)
            .await
            .expect("reservation-winning asset response")
    });
    tokio::time::timeout(Duration::from_secs(5), effect_pause.wait_until_reached())
        .await
        .expect("asset request reserves authority before Local");

    let logout_pause = install_test_finite_authority_pause(
        TestFiniteAuthorityPausePoint::AfterSessionTerminalPremark,
    );
    let mut logout_request =
        session_auth_http_request("/auth/logout", br#"{}"#.to_vec(), &fixture.bearer);
    logout_request.headers_mut().insert(
        HeaderName::from_static(TEST_FINITE_AUTHORITY_PAUSE_HEADER),
        HeaderValue::from_str(logout_pause.id()).expect("asset logout premark pause header"),
    );
    let logout_router = fixture.router.clone();
    let logout = tokio::spawn(async move {
        logout_router
            .oneshot(logout_request)
            .await
            .expect("asset permit-draining logout response")
    });
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            match logout_premark_probe.reserve_authorized_effect("asset logout premark test probe")
            {
                Ok(probe) => {
                    drop(probe);
                    tokio::task::yield_now().await;
                }
                Err(error) if error.diagnostic.code == "SNAPBACK_AUTH_SESSION_EXPIRED" => break,
                Err(error) => panic!(
                    "asset logout premark probe returned {} for {site:?}",
                    error.diagnostic.code
                ),
            }
        }
    })
    .await
    .expect("logout closes new asset reservations before the predecessor drains");
    assert!(
        !logout_pause.has_reached(),
        "logout terminal premark crossed the outstanding {site:?} permit"
    );
    assert!(
        !logout.is_finished(),
        "logout cannot finish while {site:?} is reserved"
    );

    effect_pause.release().await;
    let response = tokio::time::timeout(Duration::from_secs(5), target)
        .await
        .expect("reservation-winning asset request does not hang")
        .expect("reservation-winning asset request task");
    assert_asset_session_expired_response(response, site, "carrier").await;

    tokio::time::timeout(Duration::from_secs(5), logout_pause.wait_until_reached())
        .await
        .expect("asset logout drains after the reserved effect commits");
    let after = asset_durable_witness(&fixture, site).await;
    assert_asset_effect_committed(site, &before, &after);
    let precommit_session_facts = with_snapback(&fixture.state.snapback, {
        let session_id = fixture.session_id.clone();
        move |snapback| {
            snapback
                .remainder_auth_fixture()
                .auth_catalog()
                .session_lifetime_facts_for_test(&session_id)
        }
    })
    .await
    .expect("read pre-logout-commit asset session facts");
    assert_eq!(precommit_session_facts.2, 1);
    assert!(!precommit_session_facts.3);

    logout_pause.release().await;
    let logout_response = tokio::time::timeout(Duration::from_secs(5), logout)
        .await
        .expect("drained asset logout does not hang")
        .expect("drained asset logout task");
    assert_eq!(logout_response.status(), StatusCode::NO_CONTENT);
    let terminal_session_facts = with_snapback(&fixture.state.snapback, {
        let session_id = fixture.session_id.clone();
        move |snapback| {
            snapback
                .remainder_auth_fixture()
                .auth_catalog()
                .session_lifetime_facts_for_test(&session_id)
        }
    })
    .await
    .expect("read terminal asset session facts");
    assert_eq!(terminal_session_facts.2, 2);
    assert!(terminal_session_facts.3);
}

const RESERVED_PREFIX: &str = "/_snapback/";

// Watch management bounded-capsule adoption ----------------------------------------------

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum WatchManagementRaceSite {
    Delete,
    Suspend,
    Resume,
    Renew,
}

struct WatchManagementRaceFixture {
    state: AppState,
    router: SnapbackApp,
    bearer: String,
    session_id: String,
    watch_id: String,
    request: Option<Request<Body>>,
}

async fn watch_management_race_fixture(
    site: WatchManagementRaceSite,
) -> WatchManagementRaceFixture {
    let state = sessions_activation_server_fixture_with_integrations_async().await;
    let credential =
        mint_test_credential(&state, &format!("watch-management-{site:?}@example.test")).await;
    let bearer = credential["token"]
        .as_str()
        .expect("watch management session bearer")
        .to_owned();
    let session_id = credential["session"]["id"]
        .as_str()
        .expect("watch management session id")
        .to_owned();
    let principal_id = credential["session"]["userId"]
        .as_str()
        .expect("watch management principal id")
        .to_owned();
    let watch_id = crate::ids::mint_time_ordered(crate::ids::Kind::Watch);
    let seed_watch_id = watch_id.clone();
    let seed_principal_id = principal_id.clone();
    let seed_session_id = session_id.clone();
    with_snapback(&state.snapback, move |snapback| {
        let mut db = snapback.remainder_auth_fixture();
        if site == WatchManagementRaceSite::Renew {
            db.seed_renewable_watch_for_management_test(
                &seed_watch_id,
                &seed_principal_id,
                super::now_millis(),
            )?;
        } else {
            let now_ms = super::now_millis();
            db.create_watch(crate::storage::watches::CreateWatchRecord {
                id: seed_watch_id.clone(),
                owner_kind: crate::watches::WatchOwnerKind::User,
                owner_principal_id: seed_principal_id.clone(),
                owner_authority_instance_id: seed_session_id,
                authority_mode: crate::watches::WatchAuthorityMode::RevalidatePrincipal,
                anchor_grant_id: None,
                installation_grant_id: None,
                anchor_effective_user_id: None,
                anchor_scopes: Vec::new(),
                anchor_expires_at_ms: 0,
                query_function_id: "watch-management-race-query".to_owned(),
                query_function_name: "liveItems".to_owned(),
                query_basis: 1,
                query_args_json: "{}".to_owned(),
                query_args_digest: "watch-management-race-query-args".to_owned(),
                read_dependencies: Vec::new(),
                predicate_json: "{\"path\":\"/rows\",\"op\":\"exists\"}".to_owned(),
                reaction_kind: crate::watches::WatchReactionKind::Function,
                reaction_function_id: "watch-management-race-reaction".to_owned(),
                reaction_function_name: "listItems".to_owned(),
                reaction_function_kind: crate::watches::WatchFunctionKind::Action,
                reaction_basis: 1,
                reaction_args_json: "{}".to_owned(),
                reaction_args_digest: "watch-management-race-reaction-args".to_owned(),
                webhook_url: None,
                webhook_secret_ref: None,
                daily_firing_budget: crate::watches::DEFAULT_DAILY_FIRING_BUDGET,
                debounce_ms: crate::watches::DEFAULT_DEBOUNCE_MS,
                initial_predicate_state: false,
                now_ms,
            })?;
            if site == WatchManagementRaceSite::Resume {
                db.transition_watch(
                    &seed_watch_id,
                    &seed_principal_id,
                    crate::watches::WatchStatus::Suspended,
                    now_ms + 1,
                )?;
            }
        }
        Ok::<_, SnapbackError>(())
    })
    .await
    .expect("seed watch management race fixture");

    let uri = match site {
        WatchManagementRaceSite::Delete => format!("/watches/{watch_id}"),
        WatchManagementRaceSite::Suspend => format!("/watches/{watch_id}/suspend"),
        WatchManagementRaceSite::Resume => format!("/watches/{watch_id}/resume"),
        WatchManagementRaceSite::Renew => format!("/watches/{watch_id}/renew"),
    };
    let body = if site == WatchManagementRaceSite::Renew {
        serde_json::to_vec(&json!({ "ttlMs": crate::watches::RENEWAL_CEILING_MS }))
            .expect("serialize watch renewal race request")
    } else {
        Vec::new()
    };
    let mut request = session_auth_http_request(&uri, body, &bearer);
    if site == WatchManagementRaceSite::Delete {
        *request.method_mut() = axum::http::Method::DELETE;
    }
    let router = app(state.clone());
    WatchManagementRaceFixture {
        state,
        router,
        bearer,
        session_id,
        watch_id,
        request: Some(request),
    }
}

async fn watch_management_facts(
    fixture: &WatchManagementRaceFixture,
) -> crate::storage::watches::WatchManagementFactsForTest {
    let watch_id = fixture.watch_id.clone();
    with_snapback(&fixture.state.snapback, move |snapback| {
        snapback
            .remainder_auth_fixture()
            .watch_management_facts_for_test(&watch_id)
    })
    .await
    .expect("read watch management race facts")
}

async fn assert_watch_management_session_expired(
    response: axum::response::Response,
    authority_disposition: &str,
) {
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let response = response_json(response).await;
    assert_eq!(
        response["diagnostic"]["code"],
        "SNAPBACK_AUTH_SESSION_EXPIRED"
    );
    assert_eq!(
        response["diagnostic"]["details"]["authorityDisposition"],
        authority_disposition
    );
}

fn assert_watch_management_effect(
    site: WatchManagementRaceSite,
    before: &crate::storage::watches::WatchManagementFactsForTest,
    after: &crate::storage::watches::WatchManagementFactsForTest,
) {
    assert_ne!(after, before, "reserved {site:?} did not commit");
    match site {
        WatchManagementRaceSite::Delete => {
            assert_eq!(before.watch.status, crate::watches::WatchStatus::Active);
            assert_eq!(after.watch.status, crate::watches::WatchStatus::Dead);
            assert!(!after.watch.pending);
            assert_eq!(after.evaluation_job_count, before.evaluation_job_count);
        }
        WatchManagementRaceSite::Suspend => {
            assert_eq!(before.watch.status, crate::watches::WatchStatus::Active);
            assert_eq!(after.watch.status, crate::watches::WatchStatus::Suspended);
            assert!(!after.watch.pending);
            assert_eq!(after.evaluation_job_count, before.evaluation_job_count);
        }
        WatchManagementRaceSite::Resume => {
            assert_eq!(before.watch.status, crate::watches::WatchStatus::Suspended);
            assert_eq!(after.watch.status, crate::watches::WatchStatus::Active);
            assert!(after.watch.pending);
            assert_eq!(after.evaluation_job_count, before.evaluation_job_count + 1);
            assert_eq!(after.linked_pending_job_count, 1);
            assert!(!after.dirty_while_pending);
        }
        WatchManagementRaceSite::Renew => {
            assert_ne!(after.watch.anchor_grant_id, before.watch.anchor_grant_id);
            assert_eq!(
                after.watch.anchor_expires_at_ms,
                after.watch.updated_at_ms + crate::watches::RENEWAL_CEILING_MS,
                "renewal installs the requested full-ceiling successor anchor"
            );
            assert_eq!(after.anchor_grant_count, before.anchor_grant_count + 1);
            assert_eq!(after.live_anchor_grant_count, 1);
            assert_eq!(after.revoked_anchor_grant_count, 1);
        }
    }
}

/// @ref LLP 0058#split-phase-authorized-effect-fence — logout closes the
/// publication before the watch route can reserve it, so no watch/grant/job
/// successor may persist.
async fn watch_management_logout_wins(site: WatchManagementRaceSite) {
    let mut fixture = watch_management_race_fixture(site).await;
    let before = watch_management_facts(&fixture).await;
    let pause = install_test_finite_authority_pause(
        TestFiniteAuthorityPausePoint::BeforeAuthorizedEffectReservation,
    );
    fixture
        .request
        .as_mut()
        .expect("watch race target request")
        .headers_mut()
        .insert(
            HeaderName::from_static(TEST_FINITE_AUTHORITY_PAUSE_HEADER),
            HeaderValue::from_str(pause.id()).expect("watch pre-reservation pause header"),
        );
    let target_request = fixture.request.take().expect("watch race target request");
    let target_router = fixture.router.clone();
    let target = tokio::spawn(async move {
        target_router
            .oneshot(target_request)
            .await
            .expect("logout-racing watch management response")
    });
    tokio::time::timeout(Duration::from_secs(5), pause.wait_until_reached())
        .await
        .unwrap_or_else(|_| panic!("{site:?} reaches its pre-reservation pause"));

    let logout = tokio::time::timeout(
        Duration::from_secs(5),
        fixture.router.clone().oneshot(session_auth_http_request(
            "/auth/logout",
            br#"{}"#.to_vec(),
            &fixture.bearer,
        )),
    )
    .await
    .unwrap_or_else(|_| panic!("{site:?} racing logout does not hang"))
    .expect("watch-racing logout response");
    assert_eq!(logout.status(), StatusCode::NO_CONTENT);

    pause.release().await;
    let response = tokio::time::timeout(Duration::from_secs(5), target)
        .await
        .unwrap_or_else(|_| panic!("logged-out {site:?} request does not hang"))
        .expect("logout-winning watch management task");
    assert_watch_management_session_expired(response, "durableDelete").await;
    let after = watch_management_facts(&fixture).await;
    assert_eq!(after, before, "retired caller committed {site:?} rows");
}

/// @ref LLP 0058#split-phase-authorized-effect-fence — a reserved caller
/// permit holds logout's durable terminal cut until the exact watch effect
/// commits, including resume's sibling job and renewal's grant tuple.
async fn watch_management_reservation_wins(site: WatchManagementRaceSite) {
    let mut fixture = watch_management_race_fixture(site).await;
    let before = watch_management_facts(&fixture).await;
    let logout_premark_probe = prepared_provider_route_authority(
        &fixture.state,
        InvocationSource::AuthLogout,
        &fixture.bearer,
    )
    .0;
    let effect_pause = install_test_finite_authority_pause(
        TestFiniteAuthorityPausePoint::AfterAuthorizedEffectReservation,
    );
    fixture
        .request
        .as_mut()
        .expect("watch race target request")
        .headers_mut()
        .insert(
            HeaderName::from_static(TEST_FINITE_AUTHORITY_PAUSE_HEADER),
            HeaderValue::from_str(effect_pause.id()).expect("watch reservation pause header"),
        );
    let target_request = fixture.request.take().expect("watch race target request");
    let target_router = fixture.router.clone();
    let target = tokio::spawn(async move {
        target_router
            .oneshot(target_request)
            .await
            .expect("reservation-winning watch management response")
    });
    tokio::time::timeout(Duration::from_secs(5), effect_pause.wait_until_reached())
        .await
        .unwrap_or_else(|_| panic!("{site:?} reserves authority before Local"));

    let logout_pause = install_test_finite_authority_pause(
        TestFiniteAuthorityPausePoint::AfterSessionTerminalPremark,
    );
    let mut logout_request =
        session_auth_http_request("/auth/logout", br#"{}"#.to_vec(), &fixture.bearer);
    logout_request.headers_mut().insert(
        HeaderName::from_static(TEST_FINITE_AUTHORITY_PAUSE_HEADER),
        HeaderValue::from_str(logout_pause.id()).expect("watch logout premark pause header"),
    );
    let logout_router = fixture.router.clone();
    let logout = tokio::spawn(async move {
        logout_router
            .oneshot(logout_request)
            .await
            .expect("watch permit-draining logout response")
    });
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            match logout_premark_probe
                .reserve_authorized_effect("watch management logout premark probe")
            {
                Ok(probe) => {
                    drop(probe);
                    tokio::task::yield_now().await;
                }
                Err(error) if error.diagnostic.code == "SNAPBACK_AUTH_SESSION_EXPIRED" => break,
                Err(error) => panic!(
                    "watch logout premark probe returned {} for {site:?}",
                    error.diagnostic.code
                ),
            }
        }
    })
    .await
    .unwrap_or_else(|_| panic!("logout closes later {site:?} reservations"));
    assert!(
        !logout_pause.has_reached(),
        "logout crossed the outstanding {site:?} permit"
    );
    assert!(
        !logout.is_finished(),
        "logout finished while {site:?} was reserved"
    );

    effect_pause.release().await;
    let response = tokio::time::timeout(Duration::from_secs(5), target)
        .await
        .unwrap_or_else(|_| panic!("reservation-winning {site:?} request does not hang"))
        .expect("reservation-winning watch management task");
    assert_watch_management_session_expired(response, "carrier").await;
    tokio::time::timeout(Duration::from_secs(5), logout_pause.wait_until_reached())
        .await
        .unwrap_or_else(|_| panic!("logout drains after {site:?} commits"));
    let committed = watch_management_facts(&fixture).await;
    assert_watch_management_effect(site, &before, &committed);
    let precommit_session_facts = with_snapback(&fixture.state.snapback, {
        let session_id = fixture.session_id.clone();
        move |snapback| {
            snapback
                .remainder_auth_fixture()
                .auth_catalog()
                .session_lifetime_facts_for_test(&session_id)
        }
    })
    .await
    .expect("read pre-terminal watch management session facts");
    assert_eq!(precommit_session_facts.2, 1);
    assert!(!precommit_session_facts.3);

    logout_pause.release().await;
    let logout = tokio::time::timeout(Duration::from_secs(5), logout)
        .await
        .expect("drained watch logout does not hang")
        .expect("drained watch logout task");
    assert_eq!(logout.status(), StatusCode::NO_CONTENT);
    let terminal_session_facts = with_snapback(&fixture.state.snapback, {
        let session_id = fixture.session_id.clone();
        move |snapback| {
            snapback
                .remainder_auth_fixture()
                .auth_catalog()
                .session_lifetime_facts_for_test(&session_id)
        }
    })
    .await
    .expect("read terminal watch management session facts");
    assert_eq!(terminal_session_facts.2, 2);
    assert!(terminal_session_facts.3);
    assert_eq!(watch_management_facts(&fixture).await, committed);
}

// Relocated from src/remediation.rs so the contract leaf carries no textual
// dependency on the runtime god-files; these exercise remediation.apply
// through real served surfaces.

fn remediation_served_surfaces(
    snapback: &crate::local::LocalSnapback,
) -> crate::remediation::ServedSurfacesV1<'_> {
    crate::remediation::ServedSurfacesV1 {
        functions: snapback.served_function_manifest(),
        schema: snapback.served_schema_manifest(),
        catalog_digest: crate::control_catalog::catalog_digest(
            crate::control_catalog::build_catalog(),
        )
        .map(str::to_owned),
        served_host_ops: &crate::host_ops::SERVED_HOST_OPS,
        served_routes: crate::server::route_registry()
            .iter()
            .map(|route| route.path)
            .collect(),
    }
}

// Bounded commit capsule prototype -----------------------------------------------------------

static COMMIT_CAPSULE_REGISTRY_TEST_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

async fn lock_commit_capsule_registry_tests() -> tokio::sync::MutexGuard<'static, ()> {
    COMMIT_CAPSULE_REGISTRY_TEST_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .await
}

#[derive(Default)]
struct CommitCapsuleBarrier {
    reached: AtomicBool,
    released: StdMutex<bool>,
    changed: Condvar,
    reached_notify: tokio::sync::Notify,
}

impl CommitCapsuleBarrier {
    fn block(&self) {
        self.reached.store(true, Ordering::SeqCst);
        self.reached_notify.notify_waiters();
        let mut released = self
            .released
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        while !*released {
            released = self
                .changed
                .wait(released)
                .unwrap_or_else(std::sync::PoisonError::into_inner);
        }
    }

    async fn wait_until_reached(&self) {
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let changed = self.reached_notify.notified();
                tokio::pin!(changed);
                changed.as_mut().enable();
                if self.reached.load(Ordering::SeqCst) {
                    return;
                }
                changed.await;
            }
        })
        .await
        .expect("commit capsule barrier was not reached");
    }

    fn release(&self) {
        *self
            .released
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = true;
        self.changed.notify_all();
    }
}

struct CommitCapsulePrototypeDatabase {
    _directory: tempfile::TempDir,
    path: PathBuf,
    state: SharedSnapback,
    app_state: AppState,
}

impl CommitCapsulePrototypeDatabase {
    async fn new() -> Self {
        let directory = tempfile::tempdir().expect("commit capsule temporary directory");
        let path = directory.path().join("bounded-commit-capsule.sqlite3");
        let open_path = path.clone();
        let app_state = tokio::task::spawn_blocking(move || {
            let _sanction = crate::exec_guard::BlockingSanction::acquire();
            let local =
                LocalSnapback::open(open_path).expect("open file-backed commit capsule prototype");
            sessions_activation_server_fixture_with_api_and_password_mode_on_snapback(
                local,
                activation_functions('2', false),
                None,
                None,
                None,
                PasswordIdentifierMode::UsernameV1,
                None,
            )
        })
        .await
        .expect("join commit capsule database construction");
        let state = app_state.snapback.clone();
        with_snapback(&state, |local| {
            local
                .remainder_initialize_commit_capsule_prototype()
                .expect("initialize commit capsule operation ledger");
        })
        .await;
        Self {
            _directory: directory,
            path,
            state,
            app_state,
        }
    }

    async fn facts(
        &self,
        intent: &crate::storage::commit_capsule_prototype::PrototypeIntent,
    ) -> crate::storage::commit_capsule_prototype::PrototypeFacts {
        let intent = intent.clone();
        with_snapback(&self.state, move |local| {
            local
                .remainder_commit_capsule_prototype_facts(&intent)
                .expect("read commit capsule prototype facts")
        })
        .await
    }
}

struct CommitCapsuleCallerFixture {
    state: AppState,
    bearer: String,
}

impl CommitCapsuleCallerFixture {
    async fn new(state: &AppState, label: &str) -> Self {
        let state = state.clone();
        let credential =
            mint_test_credential(&state, &format!("bounded-commit-{label}@example.test")).await;
        let bearer = credential["token"]
            .as_str()
            .expect("commit capsule session bearer")
            .to_owned();
        Self { state, bearer }
    }

    fn authority(&self) -> PreparedAuthority {
        prepared_test_session_route_authority(
            &self.state,
            InvocationSource::HttpMutation,
            &self.bearer,
        )
    }

    fn destination(&self) -> super::CommitCapsuleDestination {
        super::CommitCapsuleDestination::bind(&self.state, self.authority())
            .expect("commit capsule fixture binds authority to its durable destination")
    }

    fn expected_guard(&self) -> crate::storage::AdmissionEffectGuardIdentityForTest {
        let controller = self.state.auth_admission_controller();
        controller.effect_guard_identity_for_test(controller.snapshot().admission_epoch)
    }

    fn spawn_logout_drain(&self) -> tokio::task::JoinHandle<axum::response::Response> {
        let router = app(self.state.clone());
        let request = session_auth_http_request("/auth/logout", br#"{}"#.to_vec(), &self.bearer);
        tokio::spawn(async move {
            router
                .oneshot(request)
                .await
                .expect("commit capsule permit-draining logout response")
        })
    }

    async fn start_logout_drain(&self) -> tokio::task::JoinHandle<axum::response::Response> {
        let probe = prepared_provider_route_authority(
            &self.state,
            InvocationSource::AuthLogout,
            &self.bearer,
        )
        .0;
        let logout = self.spawn_logout_drain();
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                match probe.reserve_authorized_effect("commit capsule logout premark probe") {
                    Ok(probe) => {
                        drop(probe);
                        tokio::task::yield_now().await;
                    }
                    Err(error) if error.diagnostic.code == "SNAPBACK_AUTH_SESSION_EXPIRED" => {
                        break;
                    }
                    Err(error) => panic!(
                        "commit capsule logout premark probe returned {}",
                        error.diagnostic.code
                    ),
                }
            }
        })
        .await
        .expect("logout closes later commit capsule reservations");
        assert!(
            !logout.is_finished(),
            "logout must drain the live commit capsule reservation"
        );
        logout
    }
}

async fn assert_commit_capsule_logout_completes(
    logout: tokio::task::JoinHandle<axum::response::Response>,
) {
    let response = tokio::time::timeout(Duration::from_secs(5), logout)
        .await
        .expect("commit capsule logout drain is bounded")
        .expect("commit capsule logout task joins");
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
}

struct CommitCapsuleTerminalFixture {
    retained: Arc<AtomicBool>,
}

#[derive(Debug)]
struct CommitCapsuleCustodyGate {
    retained: Arc<AtomicBool>,
}

impl Drop for CommitCapsuleCustodyGate {
    fn drop(&mut self) {
        self.retained.store(false, Ordering::SeqCst);
    }
}

impl CommitCapsuleTerminalFixture {
    async fn new() -> (Self, CommitCapsuleCustodyGate) {
        let retained = Arc::new(AtomicBool::new(true));
        let gate = CommitCapsuleCustodyGate {
            retained: retained.clone(),
        };
        let fixture = Self { retained };
        assert!(fixture.is_fail_closed());
        (fixture, gate)
    }

    fn is_fail_closed(&self) -> bool {
        self.retained.load(Ordering::SeqCst)
    }

    fn assert_reopened(&self) {
        assert!(!self.retained.load(Ordering::SeqCst));
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum CommitCapsuleInjection {
    Success,
    RollbackBeforeCommit,
    SuccessWithLostAcknowledgement,
    CommitErrorRowsPresent,
    CommitErrorRowsAbsent,
    CommitErrorRowsPartial,
    PanicDuringCommitBeforeStorage,
    PanicAfterCommit,
}

#[derive(Debug)]
struct CommitCapsuleUncertain<Gate> {
    _gate: Arc<StdMutex<Option<Gate>>>,
    intended: Option<crate::storage::commit_capsule_prototype::PrototypeIntendedRows>,
}

type CommitCapsuleTerminalUncertain = CommitCapsuleUncertain<CommitCapsuleCustodyGate>;

struct CommitCapsulePending<'connection, Gate> {
    pending: Option<crate::storage::commit_capsule_prototype::PrototypePending<'connection>>,
    gate: Arc<StdMutex<Option<Gate>>>,
    injection: CommitCapsuleInjection,
    during_commit: Option<Arc<CommitCapsuleBarrier>>,
}

struct FinalCutReuseProbe<Gate> {
    value: crate::storage::commit_capsule_prototype::PrototypeValue,
    gate: Arc<StdMutex<Option<Gate>>>,
}

impl<Gate: Send + 'static> super::PendingCommit for FinalCutReuseProbe<Gate> {
    type Output = crate::storage::commit_capsule_prototype::PrototypeValue;
    type Uncertain = CommitCapsuleUncertain<Gate>;

    fn rollback(self) -> crate::diagnostic::SnapbackResult<()> {
        Ok(())
    }

    fn prepare_commit(&mut self) -> Self::Uncertain {
        CommitCapsuleUncertain {
            _gate: self.gate.clone(),
            intended: None,
        }
    }

    fn commit(
        self,
        _authority: &crate::storage::CommitCapsuleAuthority,
    ) -> crate::diagnostic::SnapbackResult<Self::Output> {
        Ok(self.value)
    }
}

fn commit_capsule_injected_storage_error() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_SQLITE_ERROR",
        "storage",
        "injected bounded commit capsule COMMIT outcome",
    )
}

impl<Gate: Send + 'static> super::PendingCommit for CommitCapsulePending<'_, Gate> {
    type Output = crate::storage::commit_capsule_prototype::PrototypeValue;
    type Uncertain = CommitCapsuleUncertain<Gate>;

    fn rollback(mut self) -> crate::diagnostic::SnapbackResult<()> {
        self.pending
            .take()
            .expect("commit capsule pending transaction")
            .rollback()
    }

    fn prepare_commit(&mut self) -> Self::Uncertain {
        let intended = self
            .pending
            .as_ref()
            .expect("commit capsule pending transaction")
            .intended_rows()
            .clone();
        CommitCapsuleUncertain {
            _gate: self.gate.clone(),
            intended: Some(intended),
        }
    }

    fn commit(
        mut self,
        authority: &crate::storage::CommitCapsuleAuthority,
    ) -> crate::diagnostic::SnapbackResult<Self::Output> {
        if let Some(barrier) = &self.during_commit {
            barrier.block();
        }
        let pending = self
            .pending
            .take()
            .expect("commit capsule pending transaction");
        match self.injection {
            CommitCapsuleInjection::Success => {
                let value = pending.commit(authority)?;
                self.gate
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .take();
                Ok(value)
            }
            CommitCapsuleInjection::SuccessWithLostAcknowledgement
            | CommitCapsuleInjection::CommitErrorRowsPresent
            | CommitCapsuleInjection::CommitErrorRowsPartial => {
                let _committed = pending.commit(authority)?;
                Err(commit_capsule_injected_storage_error())
            }
            CommitCapsuleInjection::CommitErrorRowsAbsent => pending
                .commit_error_without_rows(authority, commit_capsule_injected_storage_error()),
            CommitCapsuleInjection::PanicDuringCommitBeforeStorage => {
                pending.observe_commit_attempt_before_panic();
                panic!("injected bounded commit capsule panic during COMMIT")
            }
            CommitCapsuleInjection::PanicAfterCommit => {
                let _committed = pending.commit(authority)?;
                panic!("injected bounded commit capsule panic after SQLite COMMIT")
            }
            CommitCapsuleInjection::RollbackBeforeCommit => {
                unreachable!("rollback-before-COMMIT is handled before FinalCommitCut")
            }
        }
    }
}

#[derive(Default)]
struct CommitCapsuleHooks {
    reservation_pause_id: Option<String>,
    post_staging: Option<Arc<CommitCapsuleBarrier>>,
    pre_guard: Option<Arc<CommitCapsuleBarrier>>,
    during_commit: Option<Arc<CommitCapsuleBarrier>>,
    reconcile: Option<Arc<CommitCapsuleBarrier>>,
    retain: Option<Arc<CommitCapsuleBarrier>>,
    panic_post_staging: bool,
    panic_pre_guard: bool,
    panic_reconcile: bool,
    panic_retain: bool,
    commit_guard_failure: Option<SnapbackError>,
    reuse_final_cut: bool,
}

async fn run_commit_capsule_prototype<Gate: Send + 'static>(
    destination: super::CommitCapsuleDestination,
    deadline: tokio::time::Instant,
    terminal_gate: Gate,
    intent: crate::storage::commit_capsule_prototype::PrototypeIntent,
    injection: CommitCapsuleInjection,
    hooks: CommitCapsuleHooks,
    expected_guard: crate::storage::AdmissionEffectGuardIdentityForTest,
    commit_receipt: Arc<StdMutex<Option<crate::storage::DurableCommitObservationReceiptForTest>>>,
    mut uncertain_retention: super::CommitUncertainRetention<CommitCapsuleUncertain<Gate>>,
) -> super::CommitCapsuleOutcome<crate::storage::commit_capsule_prototype::PrototypeValue> {
    let transact_receipt = commit_receipt.clone();
    let reconcile_barrier = hooks.reconcile.clone();
    let panic_reconcile = hooks.panic_reconcile;
    let retain_barrier = hooks.retain.clone();
    let panic_retain = hooks.panic_retain;
    let reservation_pause_id = hooks.reservation_pause_id.clone();
    if retain_barrier.is_some() || panic_retain {
        uncertain_retention.set_after_store_for_test(move || {
            if let Some(barrier) = retain_barrier {
                barrier.block();
            }
            if panic_retain {
                panic!("injected bounded commit capsule panic during retain")
            }
        });
    }
    super::with_bounded_commit_capsule(
        destination,
        super::CommitCapsuleSpec {
            operation: "bounded commit capsule prototype",
            deadline,
            uncertain_diagnostic: super::commit_capsule::COMMIT_OUTCOME_UNCERTAIN_CODE,
            test_pause_id: reservation_pause_id,
        },
        terminal_gate,
        intent,
        move |local, intent, terminal_gate, reservation, final_cut| {
            if let Some(error) = hooks.commit_guard_failure {
                reservation.set_commit_guard_failure_for_test(error);
            }
            let include_consumed_proof =
                injection != CommitCapsuleInjection::CommitErrorRowsPartial;
            let intent_producer = final_cut.take_intent_producer();
            let staged =
                match local.stage_prototype(intent_producer, intent, include_consumed_proof) {
                    Ok(staged) => staged,
                    Err(error) => return super::CommitAttempt::rolled_back(error),
                };
            let pending = match staged {
                crate::storage::commit_capsule_prototype::PrototypeStage::Existing(witness) => {
                    drop(terminal_gate);
                    let exact = final_cut.exact_existing(reservation, witness);
                    if hooks.reuse_final_cut {
                        return final_cut.commit(
                            reservation,
                            FinalCutReuseProbe {
                                value: crate::storage::commit_capsule_prototype::PrototypeValue {
                                    operation_id: "second-operation-after-exact-existing"
                                        .to_owned(),
                                    response: "must-not-commit".to_owned(),
                                },
                                gate: Arc::new(StdMutex::new(None)),
                            },
                        );
                    }
                    return exact;
                }
                crate::storage::commit_capsule_prototype::PrototypeStage::Pending(pending) => {
                    pending
                }
            };
            if let Some(barrier) = &hooks.post_staging {
                barrier.block();
            }
            if hooks.panic_post_staging {
                panic!("injected bounded commit capsule panic after staging")
            }
            if injection == CommitCapsuleInjection::RollbackBeforeCommit {
                pending
                    .rollback()
                    .expect("rollback injected pre-COMMIT transaction");
                drop(terminal_gate);
                return super::CommitAttempt::rolled_back(SnapbackError::error(
                    "SNAPBACK_MUTATION_CONFLICT",
                    "storage",
                    "injected bounded commit capsule rollback before COMMIT",
                ));
            }
            if let Some(barrier) = hooks.pre_guard {
                let panic_pre_guard = hooks.panic_pre_guard;
                final_cut.set_before_guard_for_test(move || {
                    barrier.block();
                    if panic_pre_guard {
                        panic!("injected bounded commit capsule panic before commit_guard")
                    }
                });
            } else if hooks.panic_pre_guard {
                final_cut.set_before_guard_for_test(|| {
                    panic!("injected bounded commit capsule panic before commit_guard")
                });
            }
            let gate = Arc::new(StdMutex::new(Some(terminal_gate)));
            let observation =
                crate::storage::observe_next_durable_commits_for_test(1, expected_guard);
            let receipt = observation.receipt();
            *transact_receipt
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(receipt);
            let attempt = final_cut.commit(
                reservation,
                CommitCapsulePending {
                    pending: Some(pending),
                    gate,
                    injection,
                    during_commit: hooks.during_commit,
                },
            );
            drop(observation);
            attempt
        },
        move |local, _intent, carrier| {
            if let Some(barrier) = reconcile_barrier {
                barrier.block();
            }
            if panic_reconcile {
                panic!("injected bounded commit capsule panic during reconciliation")
            }
            local.reconcile_prototype(
                carrier
                    .intended
                    .as_ref()
                    .expect("pending prototype commit carries its authority-derived intent"),
            )
        },
        |_local, value| Ok(value),
        uncertain_retention,
    )
    .await
}

fn commit_capsule_retention<Gate: Send + 'static>(
    intent: &crate::storage::commit_capsule_prototype::PrototypeIntent,
) -> crate::diagnostic::SnapbackResult<(
    super::CommitUncertainRetention<CommitCapsuleUncertain<Gate>>,
    super::CommitUncertainRetentionHandle<CommitCapsuleUncertain<Gate>>,
)> {
    super::CommitUncertainRetention::new(intent.operation_id.as_ref())
}

fn commit_capsule_intent(
    operation_id: &str,
) -> crate::storage::commit_capsule_prototype::PrototypeIntent {
    crate::storage::commit_capsule_prototype::PrototypeIntent {
        operation_id: crate::storage::commit_capsule_prototype::PrototypeOperationIdentity::new(
            operation_id,
        ),
        payload: "exact-payload-v1".to_owned(),
        proof_id: format!("proof-{operation_id}"),
        response: "exact-response-v1".to_owned(),
    }
}

async fn assert_preclaimed_app_state_splice_refused(
    authority_bindings: crate::local::EngineAppStateBindings,
    durable_graph: LocalSnapback,
    fixture: &'static str,
) {
    let read = durable_graph.read_lane();
    let ephemeral = durable_graph.ephemeral_api();
    let durable_state = Arc::new(Mutex::new(durable_graph));

    // This is the actual historical splice: database/Local B is paired with
    // preclaimed admission and commit authority A. Before the graph-identity
    // seal, this constructor returned an AppState containing {B, A, A}.
    let error = match AppState::try_new_for_server_startup(
        durable_state.clone(),
        read,
        ephemeral,
        ServerContext::detached(),
        authority_bindings,
        None,
        format!("commit-capsule-splice-{fixture}"),
    ) {
        Ok(_) => panic!("AppState construction must refuse the {{B, A, A}} graph splice"),
        Err(error) => error,
    };
    assert_eq!(
        error.diagnostic.code, "SNAPBACK_COMMIT_CAPSULE_DESTINATION_MISMATCH",
        "{fixture}"
    );
    tokio::task::spawn_blocking(move || {
        let _sanction = crate::exec_guard::BlockingSanction::acquire();
        durable_state
            .blocking_lock()
            .claim_app_state_graph(
                ServerProfile::Test,
                crate::auth::deployment::AuthDeploymentTarget::Local,
            )
            .map(|_| ())
    })
    .await
    .expect("join graph B claim after splice refusal")
    .expect("splice refusal must leave graph B unclaimed");
}

// Same-scope assembly preserves every `server::tests::<name>` harness path.
include!("tests/core_routing_health.rs");
include!("tests/connection_live_delivery.rs");
include!("tests/auth_provider_routes.rs");
include!("tests/effects_action_streams.rs");
include!("tests/oauth_remote_mcp.rs");
include!("tests/assets_media.rs");
include!("tests/operator_admin.rs");
