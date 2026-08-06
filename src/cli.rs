use crate::admin::{AppState, ServerContext, ServerProfile};
use crate::admin_secret_read::{
    SecretReadMintBridge, SecretReadMintSpec, SecretReadScope, secret_read_root_sibling,
    sign_secret_read_mint,
};
use crate::host_ops::{HOST_OPS_RESULT_KIND, HostOpsArtifacts, HostOpsResult, HostReadyDescriptor};
use crate::instance_lock::{DatabaseInstanceLock, StartupTargetReservation};
use crate::local::{DiagnosticBoundary, LocalSnapback};
use crate::manifest::SNAPBACK_SCHEMA_VERSION;
use crate::server;
use anyhow::Context;
use clap::Parser;
use rusqlite::OptionalExtension as _;
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::ffi::OsString;
use std::io::{self, ErrorKind, IsTerminal, Read as _};
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use uuid::Uuid;

const DEFAULT_PORT_RANGE_START: u16 = 4287;
const DEFAULT_PORT_RANGE_END: u16 = 4387;
/// The one-file cold-start carrier for a complete deployment pair. Keeping
/// the outer DTO closed prevents a second, unvalidated authority channel from
/// being smuggled beside the exact schema/functions/seed tuple.
// @ref LLP 0058#cold-startup-artifact-carrier — one trusted file carries the complete deployment generation.
pub(crate) fn read_auth_startup_artifacts(
    path: &Path,
) -> crate::diagnostic::SnapbackResult<crate::auth::mode::StartupArtifacts> {
    let bytes = crate::secure_file::read_trusted_executable_artifact(
        path,
        crate::auth::mode::STARTUP_ARTIFACT_MAX_BYTES,
    )
    .map_err(|_| {
        crate::diagnostic::SnapbackError::error(
            "SNAPBACK_AUTH_STARTUP_ARTIFACT_REQUIRED",
            "auth-mode",
            "the startup artifact carrier could not be read safely",
        )
    })?;
    crate::auth::mode::StartupArtifacts::parse(&bytes).map_err(|_| {
        crate::diagnostic::SnapbackError::error(
            "SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH",
            "auth-mode",
            "the startup artifact carrier is not the closed version-1 shape",
        )
    })
}

fn auth_startup_required(message: &'static str) -> crate::diagnostic::SnapbackError {
    crate::diagnostic::SnapbackError::error(
        "SNAPBACK_AUTH_STARTUP_ARTIFACT_REQUIRED",
        "auth-mode",
        message,
    )
}

fn with_expected_deployment(
    mut error: crate::diagnostic::SnapbackError,
    expected: Option<&crate::auth::mode::DeploymentIdentity>,
    observed: Option<&crate::auth::mode::DeploymentIdentity>,
) -> crate::diagnostic::SnapbackError {
    error.diagnostic.details = json!({
        "expectedDeployment": expected,
        "observedDeployment": observed,
    });
    error
}

fn auth_policy_unavailable(message: &'static str) -> crate::diagnostic::SnapbackError {
    crate::diagnostic::SnapbackError::error(
        "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
        "auth-mode",
        message,
    )
}

/// The settled-sessions startup pin refusing a regenerated artifact pair is
/// correct, but it must not dead-end: even a comment-only source edit rotates
/// the complete deployment identity (the source-byte identity contract), and
/// without named repair paths authors reverse-engineer an ad-hoc local-store
/// rollover. Name both supported ways forward on the refusal itself: the
/// data-preserving live evolution through the running server, and the
/// data-discarding backup-then-reseed procedure with the real backup command.
// @ref LLP 0058#cold-startup-artifact-carrier — "this is not a wedge": the
// refusal must carry its own repair, not just the expected identity
// (issues/20260805-doc-comment-artifact-mismatch-no-successor-migration.md).
fn with_settled_pin_repair(
    mut error: crate::diagnostic::SnapbackError,
    database: &Path,
) -> crate::diagnostic::SnapbackError {
    if let Value::Object(details) = &mut error.diagnostic.details {
        details.insert(
            "repair".to_owned(),
            json!({
                "keepData": "restart on the startup carrier matching expectedDeployment (regenerate it from the previous sources if needed), then apply the changed sources through the running server's live reload (`snapback dev` watch reload): the running-server provision moves the pinned deployment forward without touching local data",
                "reseedFresh": format!(
                    "to discard local data instead: back up the store with `snapback auth backup --db {} --output <ignored-backup-dir>`, move or delete the database file, then restart on the new carrier to reseed from scratch",
                    database.display()
                ),
                "safety": "the refusal is auth-mode deployment state (LLP 0058), not a runtime or codegen defect; do not hand-edit generated artifacts or hashes to match the pin",
            }),
        );
    }
    error
}

/// Run a bounded synchronous startup transaction without occupying a Tokio
/// worker. CLI composition owns `LocalSnapback` directly until listener bind,
/// so the request-path `spawn_blocking` helpers cannot move a `'static` mutex
/// guard here; `block_in_place` is the corresponding pre-bind handoff.
fn startup_blocking<T>(work: impl FnOnce() -> T) -> T {
    let run = || {
        let _sanction = crate::exec_guard::BlockingSanction::acquire();
        work()
    };
    match tokio::runtime::Handle::try_current().map(|handle| handle.runtime_flavor()) {
        Ok(tokio::runtime::RuntimeFlavor::MultiThread) => tokio::task::block_in_place(run),
        _ => run(),
    }
}

fn quarantine_pending_startup(
    snapback: &mut LocalSnapback,
    error: crate::diagnostic::SnapbackError,
) -> crate::diagnostic::SnapbackResult<crate::auth::mode::AuthModeStateRecord> {
    let code = error.diagnostic.code.clone();
    snapback.record_startup_diagnostics(std::slice::from_ref(&error.diagnostic));
    snapback.auth_database_mut().quarantine_auth_mode(&code)
}

/// Emit the complete structured startup-artifact refusal on stderr before the
/// process exits with the terse `code: message` line. The details carry the
/// exact expected (and, for a pin refusal, observed) deployment identity —
/// hashes only, no secret material — so managed tooling can attribute the
/// refusal to the auth-mode startup pin instead of misclassifying it as a
/// runtime/codegen artifact mismatch.
// @ref LLP 0058#cold-startup-artifact-carrier — "the CLI emits the exact
// expected deployment identity without secret material"; the startup pin is
// not a wedge, and its refusal must name itself.
fn emit_startup_artifact_refusal(error: &crate::diagnostic::SnapbackError) {
    if !matches!(
        error.diagnostic.code.as_str(),
        "SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH" | "SNAPBACK_AUTH_STARTUP_ARTIFACT_REQUIRED"
    ) {
        return;
    }
    if let Ok(line) = serde_json::to_string(&json!({
        "schemaVersion": "snapback.startup-diagnostic.v1",
        "diagnostic": error.diagnostic,
    })) {
        eprintln!("{line}");
    }
}

/// Resolve the four durable auth-mode keys and the one cold artifact carrier
/// before listener bind. Valid pending failures become a durable diagnostic
/// posture; settled-state failures remain nonmutating startup refusals.
// @ref LLP 0058#consume-ordering-dev-to-sessions — every fallible pair/provider/readiness operation precedes consume and listener bind.
#[cfg(test)]
async fn compose_auth_mode_startup(
    args: &Args,
    snapback: &mut LocalSnapback,
    auth_runtime: &mut crate::auth::runtime::AuthRuntime,
    readiness: &crate::auth::mode::AuthProgramReadiness,
) -> crate::diagnostic::SnapbackResult<crate::auth::mode::AuthModeStateRecord> {
    compose_auth_mode_startup_with_embedded(args, None, snapback, auth_runtime, readiness).await
}

async fn compose_auth_mode_startup_with_embedded(
    args: &Args,
    embedded_startup_artifacts: Option<&crate::auth::mode::StartupArtifacts>,
    snapback: &mut LocalSnapback,
    auth_runtime: &mut crate::auth::runtime::AuthRuntime,
    readiness: &crate::auth::mode::AuthProgramReadiness,
) -> crate::diagnostic::SnapbackResult<crate::auth::mode::AuthModeStateRecord> {
    use crate::auth::mode::AuthModeStatus;
    use crate::manifest::AuthMode;

    let mut snapshot = snapback.auth_database_mut().auth_mode_snapshot()?;
    if args.clear_desired_auth_mode {
        if !matches!(
            snapshot.state.mode_state,
            AuthModeStatus::PendingRestart | AuthModeStatus::Quarantined
        ) {
            return Err(crate::diagnostic::SnapbackError::error(
                "SNAPBACK_AUTH_MODE_STATE_CORRUPT",
                "auth-mode",
                "--clear-desired-auth-mode requires a valid pending transition",
            ));
        }
        snapback.auth_database_mut().unstage_auth_mode()?;
        snapshot = snapback.auth_database_mut().auth_mode_snapshot()?;
    }

    let carrier_result = match (
        args.startup_artifacts.as_deref(),
        embedded_startup_artifacts,
    ) {
        (Some(_), Some(_)) => Err(crate::diagnostic::SnapbackError::error(
            "SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH",
            "auth-mode",
            "startup cannot combine path-backed and embedded artifact carriers",
        )),
        (Some(path), None) => read_auth_startup_artifacts(path).map(Some),
        (None, Some(carrier)) => Ok(Some(carrier.clone())),
        (None, None) => Ok(None),
    };
    let carrier = match carrier_result {
        Ok(carrier) => carrier,
        Err(error)
            if matches!(
                snapshot.state.mode_state,
                AuthModeStatus::PendingRestart | AuthModeStatus::Quarantined
            ) =>
        {
            return quarantine_pending_startup(
                snapback,
                with_expected_deployment(error, snapshot.state.requested_deployment.as_ref(), None),
            );
        }
        Err(error) => {
            return Err(with_expected_deployment(
                error,
                snapshot
                    .state
                    .requested_deployment
                    .as_ref()
                    .or(snapshot.state.active_deployment.as_ref()),
                None,
            ));
        }
    };

    if snapshot.state.mode_state == AuthModeStatus::Settled {
        match snapshot.state.active {
            AuthMode::Sessions => {
                let expected = snapshot.state.active_deployment.as_ref().ok_or_else(|| {
                    crate::auth::mode::mode_corrupt(
                        "settled sessions mode lacks an active deployment",
                    )
                })?;
                let carrier = carrier.as_ref().ok_or_else(|| {
                    with_expected_deployment(
                        auth_startup_required(
                            "settled sessions mode requires --startup-artifacts on every start",
                        ),
                        Some(expected),
                        None,
                    )
                })?;
                let observed = startup_blocking(|| {
                    snapback.preflight_auth_artifacts(carrier, AuthMode::Sessions)
                })?;
                carrier.require_deployment(expected).map_err(|error| {
                    with_settled_pin_repair(
                        with_expected_deployment(error, Some(expected), Some(&observed)),
                        &args.db,
                    )
                })?;
                if carrier.seed.is_some() {
                    return Err(crate::diagnostic::SnapbackError::error(
                        "SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH",
                        "auth-mode",
                        "a settled sessions restart carrier cannot contain seed data",
                    ));
                }
                if !readiness.session_activation_ready {
                    return Err(auth_policy_unavailable(
                        "this binary cannot admit an already-settled sessions deployment",
                    ));
                }
                let publication_generation = snapback.reserve_function_publication_generation()?;
                snapback.publish_preflighted_functions(
                    carrier.functions.clone(),
                    publication_generation,
                    DiagnosticBoundary::Standalone,
                );
                return Ok(snapshot.state);
            }
            AuthMode::Dev => {
                let Some(carrier) = carrier.as_ref() else {
                    return Ok(snapshot.state);
                };
                let requested_mode = carrier.schema.effective_auth_mode();
                let deployment = startup_blocking(|| {
                    snapback.preflight_auth_artifacts(carrier, requested_mode)
                })?;
                if requested_mode == AuthMode::Dev {
                    let publication_generation =
                        snapback.reserve_function_publication_generation()?;
                    let state = startup_blocking(|| {
                        snapback
                            .auth_database_mut()
                            .apply_same_mode_dev_deployment_with_functions(
                                deployment,
                                carrier.schema.clone(),
                                &carrier.functions,
                                carrier.seed.clone(),
                            )?;
                        snapback.auth_database_mut().auth_mode_snapshot()
                    })?;
                    snapback.publish_preflighted_functions(
                        carrier.functions.clone(),
                        publication_generation,
                        DiagnosticBoundary::Standalone,
                    );
                    return Ok(state.state);
                }
                snapshot = startup_blocking(|| {
                    snapback
                        .auth_database_mut()
                        .stage_auth_mode_with_functions(
                            deployment,
                            carrier.schema.clone(),
                            &carrier.functions,
                            carrier.seed.clone(),
                        )?;
                    snapback.auth_database_mut().auth_mode_snapshot()
                })?;
            }
        }
    }

    debug_assert!(matches!(
        snapshot.state.mode_state,
        AuthModeStatus::PendingRestart | AuthModeStatus::Quarantined
    ));
    let Some(carrier) = carrier.as_ref() else {
        let expected = snapshot.state.requested_deployment.as_ref();
        return quarantine_pending_startup(
            snapback,
            with_expected_deployment(
                auth_startup_required(
                    "a pending auth-mode transition requires --startup-artifacts",
                ),
                expected,
                None,
            ),
        );
    };
    let requested_mode = carrier.schema.effective_auth_mode();
    let deployment =
        match startup_blocking(|| snapback.preflight_auth_artifacts(carrier, requested_mode)) {
            Ok(deployment) => deployment,
            Err(error) => return quarantine_pending_startup(snapback, error),
        };
    let expected = snapshot
        .state
        .requested_deployment
        .as_ref()
        .expect("a validated pending snapshot has a requested deployment");
    if let Err(error) = carrier.require_deployment(expected) {
        return quarantine_pending_startup(
            snapback,
            with_expected_deployment(error, Some(expected), Some(&deployment)),
        );
    }
    if deployment != *expected {
        return quarantine_pending_startup(
            snapback,
            with_expected_deployment(
                crate::diagnostic::SnapbackError::error(
                    "SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH",
                    "auth-mode",
                    "startup artifact identity differs from the pending deployment",
                ),
                Some(expected),
                Some(&deployment),
            ),
        );
    }

    match (snapshot.state.active, snapshot.state.desired) {
        (AuthMode::Dev, AuthMode::Sessions) => {
            if !readiness.session_activation_ready {
                let error = startup_blocking(|| {
                    snapback
                        .auth_database_mut()
                        .consume_sessions_auth_mode_with_functions(readiness, &carrier.functions)
                })
                .expect_err("item readiness must refuse sessions consume");
                snapback.record_startup_diagnostics(std::slice::from_ref(&error.diagnostic));
                return Ok(snapback.auth_database_mut().auth_mode_snapshot()?.state);
            }
            let publication_generation = snapback.reserve_function_publication_generation()?;
            let provider = auth_runtime.provider();
            let maintenance = provider.exclusive_maintenance().await;
            if let Err(error) = startup_blocking(|| maintenance.prepare_catalog_activation()) {
                drop(maintenance);
                return quarantine_pending_startup(snapback, error);
            }
            let state = match startup_blocking(|| {
                snapback
                    .auth_database_mut()
                    .consume_sessions_auth_mode_with_functions(readiness, &carrier.functions)
            }) {
                Ok(state) => state,
                Err(error) => {
                    drop(maintenance);
                    return quarantine_pending_startup(snapback, error);
                }
            };
            auth_runtime.mark_catalog_ready_after_mode_activation();
            drop(maintenance);
            snapback.publish_preflighted_functions(
                carrier.functions.clone(),
                publication_generation,
                DiagnosticBoundary::Standalone,
            );
            Ok(state)
        }
        (AuthMode::Sessions, AuthMode::Dev) => {
            let publication_generation = snapback.reserve_function_publication_generation()?;
            let now_ms = auth_runtime.provider().now_ms();
            let result = match startup_blocking(|| {
                snapback
                    .auth_database_mut()
                    .consume_dev_downgrade_with_functions(
                        args.allow_auth_downgrade,
                        now_ms,
                        &carrier.functions,
                    )
            }) {
                Ok(result) => result,
                Err(error) => {
                    snapback.record_startup_diagnostics(std::slice::from_ref(&error.diagnostic));
                    let state = snapback.auth_database_mut().auth_mode_snapshot()?.state;
                    if state.mode_state == AuthModeStatus::Quarantined {
                        return Ok(state);
                    }
                    return Err(error);
                }
            };
            snapback.record_startup_diagnostics(&[crate::diagnostic::Diagnostic::info(
                "SNAPBACK_AUTH_MODE_DOWNGRADE_COMMITTED",
                "auth-mode",
                "sessions-to-dev downgrade committed before listener bind",
            )
            .with_details(json!({
                "sessionsRevoked": result.sessions_revoked,
                "transitionGeneration": result.state.transition_generation,
            }))]);
            auth_runtime
                .provider()
                .exclusive_maintenance()
                .await
                .clear_mailbox_after_committed_reset();
            snapback.publish_preflighted_functions(
                carrier.functions.clone(),
                publication_generation,
                DiagnosticBoundary::Standalone,
            );
            Ok(result.state)
        }
        _ => Err(crate::auth::mode::mode_corrupt(
            "pending auth-mode transition has no supported direction",
        )),
    }
}

/// Compose the hosted-edge adapter attestation, or refuse the hosted request.
///
/// Returns `None` for an ordinary local deployment. For a hosted request this
/// runs the LLP 0098 §3.1 pre-bind conjunction and returns the verified
/// admission; any failure is the coded refusal, and a hosted request with no
/// adapter at all keeps the shipped `SNAPBACK_AUTH_DEPLOYMENT_UNSUPPORTED`
/// refusal with its exact closed blocker list.
///
/// @ref LLP 0098#41-composition — the capability tuple a hosted deployment
/// publishes comes from the verified admission, never from a build constant, so
/// an ordinary local server can never advertise `externalTls: enforced`.
fn hosted_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

type ComposedHostedEdge = Option<(
    crate::auth::hosted_edge::VerifiedHostedAdmission,
    crate::auth::hosted_edge::AdmissionRenewalInputs,
)>;

fn compose_hosted_edge_admission(
    args: &Args,
    bind_ip: IpAddr,
) -> crate::diagnostic::SnapbackResult<ComposedHostedEdge> {
    use crate::auth::deployment::AuthDeploymentTarget;

    if args.auth_deployment != AuthDeploymentTarget::Hosted {
        return Ok(None);
    }
    let (Some(config_path), Some(envelope_path)) =
        (args.hosted_edge.as_ref(), args.hosted_admission.as_ref())
    else {
        // No adapter supplied: the shipped refusal, unchanged.
        return crate::auth::deployment::validate_auth_deployment(
            args.auth_deployment,
            crate::auth::deployment::HostedAuthCapabilities::local_target(),
        )
        .map(|()| None);
    };

    let read = |path: &std::path::Path| -> crate::diagnostic::SnapbackResult<Vec<u8>> {
        std::fs::read(path).map_err(|_| {
            crate::diagnostic::SnapbackError::error(
                "SNAPBACK_AUTH_HOSTED_ADMISSION_INVALID",
                "auth-deployment",
                "hosted-edge adapter input could not be read",
            )
        })
    };

    let config = crate::auth::hosted_edge::HostedEdgeConfig::parse(&read(config_path)?)?;
    let now_ms = hosted_now_ms();
    let envelope =
        crate::auth::hosted_edge::select_admission_for_now(&read(envelope_path)?, now_ms)?;

    // The origin's own half of the conjunction: it decides for itself whether
    // the address it is about to bind is loopback (LLP 0098 H1). A caller
    // cannot assert this any more than it can assert sessions transport.
    let facts = config.self_facts(bind_ip.is_loopback())?;
    let admission_public_key = config.admission_public_key_bytes()?;
    let verified = crate::auth::hosted_edge::verify_admission_envelope_prebind(
        &envelope,
        &admission_public_key,
        &facts,
        now_ms,
    )?;
    // The renewal loop re-runs this exact conjunction against successors, so it
    // carries the same inputs rather than a cached decision.
    let renewal = crate::auth::hosted_edge::AdmissionRenewalInputs {
        document_path: envelope_path.clone(),
        admission_public_key,
        facts,
    };
    Ok(Some((verified, renewal)))
}

// @ref LLP 0060#d1-plaintext-listener-fence — sessions have no plaintext
// non-loopback override; desired sessions are fenced before listener bind too.
fn validate_auth_transport(
    bind_ip: IpAddr,
    profile: ServerProfile,
    state: &crate::auth::mode::AuthModeStateRecord,
    allow_insecure_dev_auth: bool,
) -> crate::diagnostic::SnapbackResult<()> {
    crate::admin::validate_plaintext_auth_transport(
        bind_ip.is_loopback(),
        profile,
        state.active,
        state.desired,
        allow_insecure_dev_auth,
    )
}

/// Compose the build facts installed by the production serve path. The
/// authority-descriptor implementation is present independently of the
/// invalidation and authorized-retention layers, so queued replay must not be
/// left test-only while either later layer is unavailable.
// @ref LLP 0051#d1-the-ctx-answer-ledger-recordable-replayable-deterministic-ops — queued replay carries a dedicated server-issued authority descriptor before item 8 restores retained reads.
enum AuthCoordinatorReadinessReceipt<'a> {
    Construction(&'a crate::auth::runtime::AuthCoordinatorConstructionReceipt),
    Installed(&'a crate::auth::runtime::AuthCoordinatorInstalledReceipt),
}

struct AuthProgramConstructionReceipts<'a> {
    connection_binding: Option<&'a server::ConnectionBindingConstructionReceipt>,
    two_phase_revocation: Option<&'a crate::auth::runtime::TwoPhaseRevocationConstructionReceipt>,
    auth_coordinator: Option<AuthCoordinatorReadinessReceipt<'a>>,
}

fn runtime_auth_program_readiness(
    secret_read_process_prerequisites: bool,
    receipts: &AuthProgramConstructionReceipts<'_>,
    authorization_invalidation: bool,
    authorized_lease: bool,
) -> crate::auth::mode::AuthProgramReadiness {
    let auth_coordinator = receipts
        .auth_coordinator
        .as_ref()
        .map(|receipt| match receipt {
            AuthCoordinatorReadinessReceipt::Construction(_receipt) => true,
            AuthCoordinatorReadinessReceipt::Installed(_receipt) => true,
        })
        .unwrap_or(false);
    crate::auth::mode::AuthProgramReadiness::new(
        secret_read_process_prerequisites,
        receipts.connection_binding.is_some(),
        receipts.two_phase_revocation.is_some(),
        auth_coordinator,
        authorization_invalidation,
        true,
        authorized_lease,
    )
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum AuthConstructionFailure {
    Coordinator,
    ExpiryWorker,
}

#[derive(Clone, Debug, Eq, Parser, PartialEq)]
#[command(about = "Run the Snapback local development server")]
pub struct Args {
    #[arg(long, default_value = "127.0.0.1")]
    pub host: String,

    /// Pin the listener to an exact port. Without this, Snapback scans 4287-4387.
    #[arg(long)]
    pub port: Option<u16>,

    #[arg(long, default_value = ".snapback/dev.sqlite3")]
    pub db: PathBuf,

    #[arg(long)]
    pub memory: bool,

    /// Write an LLP 0030 readiness descriptor (JSON) once the listener is
    /// bound — the out-of-band handshake managed/attach launchers read.
    #[arg(long)]
    pub ready_file: Option<PathBuf>,

    /// Consume the exact declaration emitted by `snapback auth restore`.
    /// Restore effects run before the listener binds and are idempotent for
    /// one declaration id.
    #[arg(long, conflicts_with = "memory")]
    pub restored_from_backup: Option<String>,

    /// Exact schema/functions/optional-seed carrier used to stage or consume
    /// an auth-mode deployment before any listener binds.
    #[arg(long)]
    pub startup_artifacts: Option<PathBuf>,

    /// Read-only LLP 0157 trust root emitted beside the generated manifests.
    /// The server re-derives every activation binding and exact-compares the
    /// public key manifest to its database-side signing custody before bind.
    #[arg(long)]
    pub trusted_composition_activation: Option<PathBuf>,

    /// Abandon a valid pending auth-mode transition before listener bind.
    #[arg(long, conflicts_with = "allow_auth_downgrade")]
    pub clear_desired_auth_mode: bool,

    /// Explicitly authorize consuming a staged sessions-to-dev downgrade.
    #[arg(long, conflicts_with = "clear_desired_auth_mode")]
    pub allow_auth_downgrade: bool,

    /// Permit client-asserted dev auth on a plaintext non-loopback bind.
    /// This is never accepted by the production profile.
    #[arg(long)]
    pub allow_insecure_dev_auth: bool,

    /// Run with the cron scheduler inert: definitions still load, validate,
    /// and inspect, but no run is ever claimed autonomously. The admin manual
    /// tick (`POST …/cron/tick`) keeps working, so suites drive ticks
    /// deterministically. `SNAPBACK_CRON_DISABLED=1` (or `true`) is the
    /// environment form of the same switch.
    #[arg(long)]
    pub cron_disabled: bool,

    /// Require the serving target to enforce the complete hosted-auth edge and
    /// browser contract. Without a verified hosted-edge adapter attestation the
    /// target refuses this must-understand request; loopback plus a reverse
    /// proxy is not an attestation.
    #[arg(long, value_enum, default_value = "local")]
    pub auth_deployment: crate::auth::deployment::AuthDeploymentTarget,

    /// Hosted-edge adapter configuration (LLP 0098). Carries no authority: it
    /// tells the origin which deployment identity, origin, first-contact
    /// mechanism, verification key, and support digest to *check* against the
    /// signed admission envelope.
    #[arg(long, requires = "hosted_admission")]
    pub hosted_edge: Option<PathBuf>,

    /// The signed hosted admission envelope produced by the control plane. Its
    /// authority is its Ed25519 signature against the release-bound key, never
    /// its presence on disk.
    #[arg(long, requires = "hosted_edge")]
    pub hosted_admission: Option<PathBuf>,

    /// Unit-test-only injection at the two fallible construction receipts.
    #[cfg(test)]
    #[arg(skip)]
    auth_construction_failure: Option<AuthConstructionFailure>,
}

impl Default for Args {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_owned(),
            port: None,
            db: PathBuf::from(".snapback/dev.sqlite3"),
            memory: false,
            ready_file: None,
            restored_from_backup: None,
            hosted_edge: None,
            hosted_admission: None,
            startup_artifacts: None,
            trusted_composition_activation: None,
            clear_desired_auth_mode: false,
            allow_auth_downgrade: false,
            allow_insecure_dev_auth: false,
            cron_disabled: false,
            auth_deployment: crate::auth::deployment::AuthDeploymentTarget::Local,
            #[cfg(test)]
            auth_construction_failure: None,
        }
    }
}

/// The `snapback` CLI (LLP 0024 first slice, built by LLP 0032 P6): with no
/// subcommand it starts the local dev server (compatibility with the original
/// single-purpose binary); the subcommands project the host operations.
#[derive(Debug, Parser)]
#[command(
    name = "snapback",
    about = "Snapback local server, host operations, and embedded Guide",
    after_help = "Documentation:\n  snapback guide [QUERY]  Browse or search the build-bound Snapback Guide\n  snapback mcp            Serve the same Guide as read-only MCP resources"
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Option<HostCommand>,
    #[command(flatten)]
    pub serve: Args,
}

#[derive(clap::Subcommand)]
pub enum HostCommand {
    /// host.start — run the local server in the foreground. Structured
    /// readiness is the --ready-file descriptor, not stdout.
    Start(Args),
    /// host.stop — stop the server named by a readiness descriptor.
    Stop {
        #[arg(long)]
        ready_file: PathBuf,
    },
    /// Open the local admin console with a derived browser credential, or
    /// approve a browser-displayed device code from a token-holding terminal.
    Admin(AdminArgs),
    /// app.inspect — one hostOpsResult envelope with the runtime state.
    Inspect(TargetArgs),
    /// app.reset — deterministic reset, optionally applying a seed file.
    Reset {
        #[command(flatten)]
        target: TargetArgs,
        #[arg(long)]
        seed: Option<PathBuf>,
    },
    /// schema.load / functions.load from generated manifest files.
    Load {
        #[command(flatten)]
        target: TargetArgs,
        #[arg(long)]
        schema: Option<PathBuf>,
        #[arg(long)]
        functions: Option<PathBuf>,
    },
    /// function.run — run one generated query or mutation by name/id.
    Run {
        #[command(flatten)]
        target: TargetArgs,
        function: String,
        /// JSON object of function args.
        #[arg(long)]
        args: Option<String>,
        /// Run as this app user (devUser authority).
        #[arg(long)]
        user: Option<String>,
    },
    /// asset.* — the LLP 0044 asset operator surface: upload through a
    /// generated intent, inspect a complete lifecycle, list, re-drive
    /// generation-fenced work, delete.
    Assets {
        #[command(subcommand)]
        command: AssetsCommand,
    },
    /// Session operations backed by the existing auth host-op surface.
    Session {
        #[command(subcommand)]
        command: SessionCommand,
    },
    /// Typed local observability reads and the local-only SQL hatch.
    Telemetry {
        #[command(subcommand)]
        command: TelemetryCommand,
    },
    /// Typed error-triage reads and authored issue transitions.
    Errors {
        #[command(subcommand)]
        command: ErrorsCommand,
    },
    /// config.unset — remove an entry's stored value. Carries only an entry
    /// identifier (LLP 0184 §P2/§P3: no secret value crosses the wire, so no
    /// secret carrier is needed, unlike `config.set`).
    Config {
        #[command(subcommand)]
        command: ConfigCommand,
    },
    /// cron.tick / cron.runOne — the admin-gated forced dispatch surface
    /// (LLP 0184 §P2: typed CLI/MCP projection of the existing
    /// admin-write route; bounded work, ordinary receipts).
    Cron {
        #[command(subcommand)]
        command: CronCommand,
    },
    /// jobs.drain — the injected-clock one-off jobs drain (LLP 0184 §P2's
    /// typed projection of the existing `POST /_snapback/api/jobs/drain`
    /// route; `jobs list`/`jobs show` are a separate, P1 read-only
    /// projection of `GET /_snapback/api/jobs[/{id}]`).
    Jobs {
        #[command(subcommand)]
        command: JobsCommand,
    },
    /// connection.disconnect — an explicit debug perturbation of one live
    /// connection, never presented as application disconnect authority
    /// (LLP 0184 §P2).
    Connections {
        #[command(subcommand)]
        command: ConnectionsCommand,
    },
    /// debug.networkProfile* — inspect or change the process-local network
    /// condition profile through the shared host-ops envelope.
    #[command(name = "network-profile")]
    NetworkProfile {
        #[command(subcommand)]
        command: NetworkProfileCommand,
    },
    /// data.scan — bounded read-only table projection (LLP 0184 P1).
    Data {
        #[command(subcommand)]
        command: DataCommand,
    },
    /// config.status / config.plan / config.verify — non-secret config
    /// planning and verification (LLP 0036; LLP 0184 P1 backfill). `config
    /// set`/`config unset` are not projected here yet (LLP 0184 §P3).
    Config {
        #[command(subcommand)]
        command: ConfigCommand,
    },
    /// jobs.list / jobs.show — read-only one-off job inspection (LLP 0184
    /// P1). Draining/mutating jobs is out of this slice's scope.
    Jobs {
        #[command(subcommand)]
        command: JobsCommand,
    },
    /// Mint one short-lived, scoped administrative data-read lease. This is a
    /// ready-file-only operation because the proof root is local operator
    /// authority and can never be discovered from a URL.
    #[command(name = "secret-read-mint")]
    SecretReadMint {
        #[arg(long)]
        ready_file: PathBuf,
        #[arg(long)]
        token: Option<String>,
        #[arg(long)]
        admin_inspect: bool,
        #[arg(long)]
        receipts: bool,
        #[arg(long)]
        table: Vec<String>,
        #[arg(long)]
        function: Vec<String>,
        #[arg(long)]
        explain_function: Vec<String>,
        #[arg(long)]
        telemetry_events: bool,
        #[arg(long)]
        telemetry_export: bool,
        #[arg(long)]
        errors_issue: bool,
        #[arg(long, default_value_t = 60)]
        ttl_seconds: u64,
        #[arg(long, default_value_t = 500)]
        row_budget: u64,
        #[arg(long, default_value_t = 1_048_576)]
        byte_budget: u64,
    },
    /// Offline physical auth backup and declared restore operations.
    Auth {
        #[command(subcommand)]
        command: AuthCommand,
    },
    /// Create and operate finite-TTL, non-promotable local derived deployments.
    /// Lifecycle: create -> inspect/list -> diff -> drop/reap/recover.
    Fork {
        #[command(subcommand)]
        command: ForkCommand,
    },
    // @ref LLP 0187#t4--build-the-out-of-repo-funnel-before-it-is-tested-for-real —
    // the packaged native runtime is the checkout-independent guide carrier.
    // @ref LLP 0061#4-distribution-and-discovery — the CLI searches the same
    // build-bound corpus served over HTTP and MCP rather than a second copy.
    /// Show the build-bound Guide channels or search matching Markdown sections.
    Guide {
        /// Words to find together in a Guide section. Omit to show all channels.
        #[arg(value_name = "QUERY")]
        query: Vec<String>,
    },
    /// Serve the build-bound Snapback Guide as read-only MCP resources over
    /// stdio. This is the resource-first Phase 2b slice; it exposes no tools.
    Mcp,
    /// Print this executable's independently stamped build identity. Runtime
    /// diagnostics use this read-only command without binding a server port.
    // @ref LLP 0031#server-binary-identity-on-health — expose the same
    // independently embedded facts without starting a server, so link probes
    // can classify the exact executable they just launched.
    BuildIdentity,
    /// Prepare the public LLP 0157 activation source from the server-owned
    /// proof keyring and one already-generated manifest pair. Re-run ordinary
    /// codegen afterward; it validates and publishes this source inside the
    /// transactional generated artifact graph.
    #[command(name = "composition-activation-prepare")]
    CompositionActivationPrepare {
        #[arg(long)]
        db: PathBuf,
        #[arg(long)]
        generated: PathBuf,
        #[arg(long)]
        deployment_id: String,
    },
    /// Create and destroy the same restricted no-eval handler VM that
    /// `RuntimeGuard::create` uses per invocation, then print a JSON verdict.
    /// The bootstrap smoke runs this against the final linked binary so its
    /// OK verdict proves armed handler-VM readiness, not just dynamic
    /// loading and process launch.
    #[command(name = "runtime-qualify")]
    RuntimeQualify,
    /// Reopen and verify one closed hosted-product-journey receipt plus its
    /// opaque retained evidence map. A success-shaped JSON document is never
    /// capability evidence until this command returns `verified`.
    #[command(name = "hosted-journey-verify")]
    HostedJourneyVerify {
        receipt: PathBuf,
        #[arg(long)]
        artifacts: Option<PathBuf>,
    },
    /// migrate.* — LLP 0081 reviewed storage evolution (local profile).
    Migrate {
        /// Emit only the structured envelope on stdout. Human presentation is
        /// default-on to stderr; this flag silences it for machine consumers.
        #[arg(long, global = true)]
        json: bool,
        #[command(subcommand)]
        command: MigrateCommand,
    },
}

#[derive(clap::Args, Debug)]
pub struct AdminArgs {
    /// Print the fragment-bearing console URL instead of opening a browser.
    #[arg(long)]
    no_open: bool,
    #[command(flatten)]
    target: TargetArgs,
    #[command(subcommand)]
    command: Option<AdminCommand>,
}

#[derive(clap::Subcommand, Debug)]
pub enum AdminCommand {
    /// Approve one short-lived code displayed by the admin console.
    Approve {
        code: String,
        #[command(flatten)]
        target: TargetArgs,
    },
    /// Mint, observe, reattach to, or revoke a one-time operator claim link.
    Link {
        #[command(flatten)]
        target: TargetArgs,
        /// Print the link and return instead of observing redemption/expiry.
        #[arg(long)]
        no_wait: bool,
        /// Substitute this HTTP(S) origin in the printed browser link.
        #[arg(long)]
        url_base: Option<String>,
        /// Render the selected claim URL as a Unicode half-block terminal QR.
        #[arg(long)]
        qr: bool,
        /// Publish /_snapback through a receipt-owned tailscaled Serve mapping.
        #[arg(long)]
        tailscale: bool,
        /// Bind an ephemeral cleartext relay to one LAN address or interface.
        #[arg(
            long,
            value_name = "ADDR|INTERFACE",
            num_args = 0..=1,
            default_missing_value = "",
            require_equals = true
        )]
        lan: Option<String>,
        /// Query a previously minted claim by its raw claim code.
        #[arg(long, value_name = "CLAIM", conflicts_with = "revoke")]
        status: Option<String>,
        /// Revoke the credential bound to a redeemed claim.
        #[arg(long, value_name = "CLAIM", conflicts_with = "status")]
        revoke: Option<String>,
    },
}

#[derive(clap::Args, Clone, Default)]
pub struct TelemetryFilterArgs {
    #[arg(long)]
    kind: Option<String>,
    #[arg(long)]
    name: Option<String>,
    #[arg(long)]
    status: Option<i64>,
    #[arg(long)]
    code: Option<String>,
    #[arg(long)]
    correlation: Option<String>,
    #[arg(long, visible_alias = "since")]
    from_ms: Option<i64>,
    #[arg(long, visible_alias = "until")]
    to_ms: Option<i64>,
    #[arg(long)]
    text: Option<String>,
}

impl TelemetryFilterArgs {
    fn query_pairs(&self, stats: bool) -> Vec<(&'static str, String)> {
        let mut pairs = Vec::new();
        for (key, value) in [("kind", self.kind.as_ref()), ("name", self.name.as_ref())] {
            if let Some(value) = value {
                pairs.push((key, value.clone()));
            }
        }
        if !stats {
            if let Some(value) = self.status {
                pairs.push(("status", value.to_string()));
            }
            for (key, value) in [
                ("code", self.code.as_ref()),
                ("correlation", self.correlation.as_ref()),
                ("text", self.text.as_ref()),
            ] {
                if let Some(value) = value {
                    pairs.push((key, value.clone()));
                }
            }
        }
        if let Some(value) = self.from_ms {
            pairs.push(("fromMs", value.to_string()));
        }
        if let Some(value) = self.to_ms {
            pairs.push(("toMs", value.to_string()));
        }
        pairs
    }
}

#[derive(clap::Subcommand)]
pub enum TelemetryCommand {
    /// Closed aggregate projection under ordinary admin authority.
    Stats {
        #[command(flatten)]
        target: TargetArgs,
        #[command(flatten)]
        filter: TelemetryFilterArgs,
    },
    /// One bounded raw-event page under a scoped secret-read lease.
    Events {
        #[command(flatten)]
        target: TargetArgs,
        #[command(flatten)]
        filter: TelemetryFilterArgs,
        #[arg(long)]
        cursor_recorded_ts_ms: Option<i64>,
        #[arg(long)]
        cursor_id: Option<i64>,
        #[arg(long, value_parser = ["asc", "desc"], default_value = "asc")]
        order: String,
        #[arg(long, default_value_t = crate::telemetry_query::DEFAULT_EVENT_LIMIT)]
        limit: usize,
        #[arg(long)]
        secret_read_lease: Option<String>,
    },
    /// Snapshot-bounded NDJSON stream under a scoped secret-read lease.
    Export {
        #[command(flatten)]
        target: TargetArgs,
        #[command(flatten)]
        filter: TelemetryFilterArgs,
        #[arg(long)]
        secret_read_lease: Option<String>,
    },
    /// Local-only read-only SQL over the visibility views; never networked.
    Query {
        sql: String,
        #[arg(long, default_value = ".snapback/dev.sqlite3")]
        db: PathBuf,
        #[arg(long, default_value_t = crate::telemetry_query::DEFAULT_SQL_ROW_BUDGET)]
        max_rows: usize,
        #[arg(long, default_value_t = crate::telemetry_query::DEFAULT_SQL_STEP_BUDGET)]
        max_steps: u64,
        #[arg(long, default_value_t = crate::telemetry_query::DEFAULT_SQL_TIME_BUDGET_MS)]
        max_time_ms: u64,
        #[arg(long, default_value_t = crate::telemetry_query::DEFAULT_SQL_BYTE_BUDGET)]
        max_bytes: usize,
    },
}

#[derive(clap::Subcommand)]
pub enum ErrorsCommand {
    /// List structural issue metadata; defaults to the newest retained release.
    Issues {
        #[command(flatten)]
        target: TargetArgs,
        #[arg(long)]
        state: Option<String>,
        #[arg(long)]
        kind: Option<String>,
        #[arg(long)]
        name: Option<String>,
        #[arg(long)]
        subsystem: Option<String>,
        #[arg(long)]
        failure_disposition: Option<String>,
        #[arg(long)]
        release: Option<String>,
        #[arg(long)]
        since: Option<String>,
        #[arg(long)]
        from_ms: Option<i64>,
        #[arg(long)]
        to_ms: Option<i64>,
        #[arg(long, value_parser = ["last-seen", "count"], default_value = "last-seen")]
        order: String,
        #[arg(long)]
        cursor: Option<String>,
        #[arg(long, default_value_t = crate::errors_query::DEFAULT_ISSUE_LIMIT)]
        limit: usize,
    },
    /// Read raw exemplars for one issue under a scoped secret-read lease.
    Issue {
        #[command(flatten)]
        target: TargetArgs,
        issue: String,
        #[arg(long)]
        secret_read_lease: Option<String>,
    },
    /// Apply one state-sequence CAS transition.
    Transition {
        #[command(flatten)]
        target: TargetArgs,
        issue: String,
        #[arg(long, value_parser = ["open", "resolved", "ignored"])]
        to: String,
        #[arg(long)]
        expect_seq: i64,
    },
    /// Deploy-hook form: atomically resolve open/regressed issues older than a release.
    Resolve {
        #[command(flatten)]
        target: TargetArgs,
        #[arg(long)]
        open_before: String,
    },
}

/// @ref LLP 0184#p2-controlled-mutations — `config.unset` carries no secret
/// value, so it needs no secret carrier; it is a direct, `AdminWrite`
/// projection of the existing `POST /_snapback/api/config/unset` route.
#[derive(clap::Subcommand)]
pub enum ConfigCommand {
    /// config.unset — remove a config entry's stored value.
    Unset {
        #[command(flatten)]
        target: TargetArgs,
        /// The config entry identifier (e.g. `stripe.secretKey`).
        #[arg(long)]
        entry: String,
    },
}

/// @ref LLP 0184#p2-controlled-mutations — typed CLI/MCP projections of the
/// existing admin-gated cron dispatch routes, with an injected clock for
/// `tick` so acceptance never depends on wall-clock due-ness.
#[derive(clap::Subcommand)]
pub enum CronCommand {
    /// cron.tick — force-claim and run every currently-due cron job.
    Tick {
        #[command(flatten)]
        target: TargetArgs,
    },
    /// cron.runOne — force-claim and run one named cron job regardless of
    /// its schedule.
    Run {
        #[command(flatten)]
        target: TargetArgs,
        /// The cron job's declared name.
        name: String,
    },
}

/// @ref LLP 0184#p2-controlled-mutations — the mutating jobs.drain
/// projection; `jobs list`/`jobs show` are the separate P1 read-only
/// projection of `GET /_snapback/api/jobs[/{id}]` (owned by a parallel
/// workstream).
#[derive(clap::Subcommand)]
pub enum JobsCommand {
    /// jobs.drain — claim and run due one-off jobs under an injected clock.
    Drain {
        #[command(flatten)]
        target: TargetArgs,
        /// The injected drain clock in epoch milliseconds. Absent means wall
        /// clock.
        #[arg(long)]
        now_ms: Option<u64>,
        /// Bounded cascade waves (server default 1 when absent).
        #[arg(long)]
        max_waves: Option<usize>,
    },
}

/// @ref LLP 0184#p2-controlled-mutations — `connection.disconnect` is an
/// explicit debug perturbation of the existing admin-gated route
/// (`POST /_snapback/api/connections/{id}/disconnect`), never application
/// disconnect authority. `reason` is recorded in this command's own receipt
/// (the route itself carries no request body today); the readiness
/// descriptor's startup nonce is verified by the ordinary target-resolution
/// path before the request is sent, so a stale/reused server can never be
/// the disconnect target.
#[derive(clap::Subcommand)]
pub enum ConnectionsCommand {
    /// connection.disconnect — force-close one live connection by id.
    Disconnect {
        #[command(flatten)]
        target: TargetArgs,
        /// The connection id to disconnect.
        connection_id: String,
        /// Why this debug perturbation is being invoked (recorded in the
        /// receipt printed on success).
        #[arg(long)]
        reason: String,
    },
}

#[derive(clap::Subcommand)]
pub enum DataCommand {
    /// data.scan — bounded read-only projection over `DataQuery`'s shipped
    /// fields: table, limit, offset. Not a cursor: the route has none, and
    /// offset paging is not stable under concurrent writes — a row can shift
    /// pages between two calls. Prefer a narrow `--limit` and re-scan rather
    /// than relying on offset continuity across a long-lived operator
    /// session.
    ///
    /// @ref LLP 0184#p1-read-and-diagnose — matches `DataQuery` as shipped;
    ///   a stable/snapshot-bound cursor is a storage-owner amendment, out of
    ///   this pure-projection scope.
    Scan {
        #[command(flatten)]
        target: TargetArgs,
        /// The table to scan.
        table: String,
        #[arg(long, default_value_t = 50)]
        limit: usize,
        #[arg(long, default_value_t = 0)]
        offset: usize,
        /// A previously minted scoped secret-read lease. Omit to mint one
        /// automatically from the ready file (requires --ready-file).
        #[arg(long)]
        secret_read_lease: Option<String>,
    },
}

#[derive(clap::Subcommand)]
pub enum ConfigCommand {
    /// config.status — the full per-entry state machine: names, states,
    /// generations, diagnostics. Never values.
    Status {
        #[command(flatten)]
        target: TargetArgs,
    },
    /// config.plan — dry-run facts for setting an entry: write locus,
    /// required credentials, the apply boundary, and whether this transport
    /// would accept a value write. No write occurs.
    Plan {
        #[command(flatten)]
        target: TargetArgs,
        /// Narrow the plan to one declared entry; omitted plans every entry.
        #[arg(long)]
        entry: Option<String>,
    },
    /// config.verify — run one entry's probe action and report ok/not-ok
    /// plus the probe diagnostic. Never returns the configured value.
    Verify {
        #[command(flatten)]
        target: TargetArgs,
        entry: String,
    },
}

#[derive(clap::Subcommand)]
pub enum JobsCommand {
    /// jobs.list — the bounded one-off job inspection page (read-only).
    List {
        #[command(flatten)]
        target: TargetArgs,
    },
    /// jobs.show — one job's full recorded state by id (read-only).
    Show {
        #[command(flatten)]
        target: TargetArgs,
        id: String,
    },
}

#[derive(clap::Subcommand)]
pub enum NetworkProfileCommand {
    /// debug.networkProfileGet — return the active profile and provenance.
    Get {
        #[command(flatten)]
        target: TargetArgs,
    },
    /// debug.networkProfileSet — activate a built-in name or inline JSON
    /// profile through the server's one activation gate.
    Set {
        #[command(flatten)]
        target: TargetArgs,
        /// Built-in name (normal, optimistic, demo-slow) or an inline JSON object.
        profile: String,
    },
}

#[derive(clap::Subcommand)]
pub enum MigrateCommand {
    /// migrate.preview — deterministic plan + separately digested
    /// observation from explicit intents. Read-only against app state.
    Preview {
        #[arg(long)]
        db: PathBuf,
        /// JSON file: an array of MigrationIntent values. Explicit intents
        /// take precedence; when omitted, preview derives the intent set
        /// from the schema diff (unambiguous, semantics-free changes only —
        /// renames, conversions, and required-field backfills must be
        /// declared explicitly and refuse derivation).
        #[arg(long)]
        intents: Option<PathBuf>,
        /// The staged successor schema manifest (JSON).
        #[arg(long)]
        schema: PathBuf,
        /// The approved publication timestamp constant (ms). Migration
        /// constants are explicit inputs; preview creates none.
        #[arg(long)]
        publication_timestamp_ms: u64,
        /// The explicit rollback timestamp constant (ms) — required later
        /// to execute the LLP 0081 §6 fast rollback; must be >= the
        /// publication timestamp.
        #[arg(long)]
        rollback_timestamp_ms: Option<u64>,
        /// Optional JSON object of named literal constants.
        #[arg(long)]
        constants: Option<PathBuf>,
        #[arg(long, default_value_t = 1_000_000)]
        max_affected_rows: u64,
        #[arg(long, default_value_t = 60_000)]
        max_barrier_downtime_ms: u64,
        #[arg(long)]
        out: PathBuf,
    },
    /// migrate.approve — a local authenticated operator record: authority
    /// is filesystem custody of the database plus the recorded local
    /// operator principal ($USER unless --approver). Hosted approval is an
    /// LLP 0072 control-plane operation, not this command.
    Approve {
        /// The preview output (plan + observation).
        plan: PathBuf,
        #[arg(long)]
        approver: Option<String>,
        /// Approval validity window in milliseconds.
        #[arg(long, default_value_t = 24 * 60 * 60 * 1_000)]
        expires_in_ms: u64,
        #[arg(long)]
        db: PathBuf,
        #[arg(long)]
        out: PathBuf,
        /// Non-interactive render-first authorization. Exact value:
        /// `<planDigest>:<observationDigest>` as printed by the review block.
        #[arg(long)]
        acknowledge_digests: Option<String>,
    },
    /// migrate.apply — execute the approved file by path; never
    /// regenerates a plan. --dry-run validates admission without writing.
    Apply {
        /// The approved file from `migrate approve`.
        approved: PathBuf,
        /// The staged successor schema manifest (JSON).
        #[arg(long)]
        schema: PathBuf,
        #[arg(long)]
        db: PathBuf,
        #[arg(long)]
        dry_run: bool,
        /// §7: the consumed rehearsal receipt when the plan requires one.
        #[arg(long)]
        rehearsal_receipt: Option<PathBuf>,
    },
    /// migrate.rehearse — execute the approved production plan AS a §7
    /// rehearsal against its restore-derived instance. The sealed rehearsal
    /// plan's binding — never the production audience — names the one
    /// database this may run on; targeting anything else (production
    /// included) refuses with SNAPBACK_MIGRATION_REHEARSAL_INVALID. The
    /// receipt comes back marked rehearsal and is consumed later by
    /// `migrate apply --rehearsal-receipt`; it never substitutes for the
    /// production apply receipt.
    Rehearse {
        /// The approved file from `migrate approve` (plan + approval).
        approved: PathBuf,
        /// The staged successor schema manifest (JSON).
        #[arg(long)]
        schema: PathBuf,
        /// The sealed MigrationRehearsalPlanV1 (restore-derived binding).
        #[arg(long)]
        rehearsal_plan: PathBuf,
        /// The restore-derived isolated instance the binding names.
        #[arg(long)]
        db: PathBuf,
        /// Where to write the rehearsal-marked receipt.
        #[arg(long)]
        out: PathBuf,
    },
    /// migrate.cancel — request cancellation at the next admitted
    /// pre-publication boundary.
    Cancel {
        approved: PathBuf,
        #[arg(long)]
        db: PathBuf,
    },
    /// migrate.verify — the receipt-vs-journal projection check. The §5
    /// data proof (expected values, content digests) lands with the
    /// verification wave and refuses honestly until then.
    Verify {
        #[arg(long)]
        operation_id: String,
        #[arg(long)]
        db: PathBuf,
    },
    /// migrate.rollback — not yet available on this profile; refuses with
    /// SNAPBACK_MIGRATION_ROLLBACK_UNAVAILABLE rather than guessing.
    Rollback {
        receipt: PathBuf,
        #[arg(long)]
        db: PathBuf,
    },
}

#[derive(clap::Subcommand)]
pub enum AuthCommand {
    /// Create one quiesced SQLite + exact-keyring backup directory.
    Backup {
        #[arg(long)]
        db: PathBuf,
        #[arg(long)]
        output: PathBuf,
    },
    /// Restore a backup into a new instance directory and emit its declaration.
    Restore {
        #[arg(long = "from")]
        from: PathBuf,
        #[arg(long)]
        db: PathBuf,
    },
}

#[derive(clap::Subcommand)]
#[command(after_help = "Lifecycle examples:\n  snapback fork create --from parent.ready.json --ttl 2h --app-root .\n  snapback fork inspect <fork-id> --app-root .\n  snapback fork diff <fork-id> --app-root .\n  snapback fork drop <fork-id> --app-root .\n  snapback fork reap --now-ms <unix-ms> --app-root .\n  snapback fork recover <destination> --app-root .")]
pub enum ForkCommand {
    /// Sweep expired managed forks first, then materialize, scrub/mint, boot,
    /// and return a finite-lived ready derived deployment.
    Create {
        /// Parent SQLite database or a live server readiness descriptor.
        #[arg(long = "from")]
        from: Option<PathBuf>,
        /// Finite duration such as 30m, 2h, or 1d.
        #[arg(long, default_value = "2h")]
        ttl: String,
        /// Explicitly copy the parent's config-secret sibling into the fork.
        #[arg(long)]
        with_secrets: bool,
        /// App source root whose generated schema/functions are loaded after boot.
        #[arg(long, default_value = ".")]
        app_root: PathBuf,
        /// Lifecycle registry and fork-directory root.
        #[arg(long)]
        fork_root: Option<PathBuf>,
        /// Exact destination directory; must be a direct child of --fork-root.
        #[arg(long)]
        destination: Option<PathBuf>,
        /// Runtime readiness descriptor. Defaults inside the fork directory.
        #[arg(long)]
        ready_file: Option<PathBuf>,
        /// Retain a digest-bound post-mint base snapshot inside the fork,
        /// enabling the exact net diff (doubles the fork's byte footprint).
        #[arg(long)]
        retain_base: bool,
        /// Refuse creation once this many managed forks exist.
        #[arg(long, default_value_t = crate::instance_fork::MANAGED_FORK_MAX_COUNT)]
        max_forks: usize,
        /// Refuse a source database set larger than this many bytes.
        #[arg(long, default_value_t = crate::instance_fork::MANAGED_FORK_MAX_FORK_BYTES)]
        max_fork_bytes: u64,
        /// Refuse when existing forks plus this copy would exceed this budget.
        #[arg(long, default_value_t = crate::instance_fork::MANAGED_FORK_MAX_TOTAL_BYTES)]
        max_total_bytes: u64,
        /// Output JSON (default) or one shell-friendly scalar path/identity.
        #[arg(long, value_enum, default_value = "json")]
        format: ForkOutputFormat,
    },
    /// List advisory lifecycle records without changing them.
    List {
        #[arg(long, default_value = ".")]
        app_root: PathBuf,
        #[arg(long)]
        fork_root: Option<PathBuf>,
    },
    /// Inspect identity, expiry, process health, paths, isolation posture, and
    /// a bounded app-row diff summary for one registry-bound fork.
    Inspect {
        fork_id: String,
        #[arg(long, default_value = ".")]
        app_root: PathBuf,
        #[arg(long)]
        fork_root: Option<PathBuf>,
        /// Output JSON (default) or one shell-friendly scalar path/identity.
        #[arg(long, value_enum, default_value = "json")]
        format: ForkOutputFormat,
    },
    /// Render the app-row-only post-fork journal receipt.
    Diff {
        fork_id: String,
        #[arg(long, default_value = ".")]
        app_root: PathBuf,
        #[arg(long)]
        fork_root: Option<PathBuf>,
        #[arg(long)]
        out: Option<PathBuf>,
        /// Refuse an attributed journal span larger than this many rows.
        #[arg(long, default_value_t = crate::instance_fork::FORK_DIFF_MAX_ROWS)]
        max_rows: u64,
        /// Produce the exact net base-to-head receipt (snapback.fork-net-diff.v1)
        /// instead of the attributed sequence; requires --retain-base at create.
        #[arg(long)]
        net: bool,
    },
    /// Stop and delete exactly one registry-bound fork.
    Drop {
        fork_id: String,
        #[arg(long, default_value = ".")]
        app_root: PathBuf,
        #[arg(long)]
        fork_root: Option<PathBuf>,
    },
    /// Extend one fork's finite expiry within the configured maximum total
    /// lifetime. Renewal never shortens or clears the expiry and never
    /// resurrects an already-expired fork.
    Renew {
        fork_id: String,
        /// Finite duration from now, such as 30m or 2h.
        #[arg(long)]
        ttl: String,
        #[arg(long, default_value = ".")]
        app_root: PathBuf,
        #[arg(long)]
        fork_root: Option<PathBuf>,
    },
    /// Deterministically stop and delete forks expired at the supplied clock.
    Reap {
        #[arg(long)]
        now_ms: u64,
        #[arg(long, default_value = ".")]
        app_root: PathBuf,
        #[arg(long)]
        fork_root: Option<PathBuf>,
    },
    /// Repair a crash-interrupted publication from its authoritative local
    /// evidence, or reap matching unpublished staging state.
    Recover {
        /// Exact destination path or direct-child name under --fork-root.
        destination: PathBuf,
        #[arg(long, default_value = ".")]
        app_root: PathBuf,
        #[arg(long)]
        fork_root: Option<PathBuf>,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, clap::ValueEnum)]
pub enum ForkOutputFormat {
    Json,
    Url,
    ForkId,
    DatabasePath,
    ReadyPath,
    AdminTokenPath,
}

impl std::fmt::Debug for HostCommand {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // @ref LLP 0039#diagnostics-and-route-registry — capabilities never
        // enter logs or diagnostic/debug projections.
        // Command payloads can include administrator capabilities today and
        // provider/keyring capabilities in later auth slices. Keep this
        // implementation variant-agnostic so newly added commands cannot
        // accidentally regain derived Debug's recursive secret exposure.
        formatter.write_str("HostCommand([REDACTED])")
    }
}

#[derive(clap::Subcommand)]
pub enum AssetsCommand {
    /// asset.put — upload one file through a generated upload intent and
    /// finalize it (end-to-end verified: every chunk checksummed plus the
    /// whole-upload digest).
    Put {
        #[command(flatten)]
        target: TargetArgs,
        /// Path of the file to upload.
        file: PathBuf,
        /// The upload intent's exported name (or stable id).
        #[arg(long)]
        upload: String,
        /// JSON object of intent args.
        #[arg(long)]
        args: Option<String>,
        /// Upload as this app user (devUser authority).
        #[arg(long)]
        user: Option<String>,
        /// Declared content type (trusted detection still decides).
        #[arg(long)]
        content_type: Option<String>,
    },
    /// asset.inspect — one asset's lifecycle, receipts, quota, reference
    /// edges, and ledger claims. Never byte samples, staging keys, or
    /// bearer URLs.
    Inspect {
        #[command(flatten)]
        target: TargetArgs,
        asset_id: String,
        /// Read as this app user (owner/via-references authorization);
        /// omitted reads as the operator.
        #[arg(long)]
        user: Option<String>,
    },
    /// asset.list — assets by availability state.
    List {
        #[command(flatten)]
        target: TargetArgs,
        /// pending | ready | rejected | deleted (omitted lists all).
        #[arg(long)]
        state: Option<String>,
    },
    /// asset.retry — generation-fenced re-drive of pending publication and
    /// ledger work; never reopens a terminal attempt.
    Retry {
        #[command(flatten)]
        target: TargetArgs,
        asset_id: String,
    },
    /// asset.gcSweep — run all asset reclamation and publication-maintenance
    /// classes at an explicit portable millisecond timestamp.
    GcSweep {
        #[command(flatten)]
        target: TargetArgs,
        /// Injected Unix time in milliseconds; required so operator and
        /// acceptance runs are deterministic.
        #[arg(long)]
        now_ms: u64,
    },
    /// asset.rotateSigningKey — retire every signing key and mint a fresh
    /// one; every outstanding signed URL stops validating.
    RotateSigningKey {
        #[command(flatten)]
        target: TargetArgs,
    },
    /// asset.exportCut — write the consistent-cut manifest and every
    /// referenced blob object, digest-verified, into an empty directory.
    ExportCut {
        #[command(flatten)]
        target: TargetArgs,
        /// Absolute path of an empty (or absent) export directory.
        #[arg(long)]
        dir: String,
    },
    /// asset.importCut — validate an export directory (refuse-partial);
    /// with --apply, restore it onto an empty asset state (requires
    /// SNAPBACK_ASSET_IMPORT_EXPERIMENTAL=1 server-side).
    ImportCut {
        #[command(flatten)]
        target: TargetArgs,
        /// Absolute path of the export directory to validate or apply.
        #[arg(long)]
        dir: String,
        /// Apply the validated cut (empty-target restore).
        #[arg(long)]
        apply: bool,
    },
    /// asset.ensureSeedFixture — idempotent LLP 0109 SS17 fixture ingestion
    /// through the ordinary trusted upload path; a matching mapping is
    /// reused, changed bytes ingest a new asset and repoint the mapping.
    EnsureSeedFixture {
        #[command(flatten)]
        target: TargetArgs,
        /// Path of the committed fixture source file.
        file: PathBuf,
        /// The upload intent's exported name.
        #[arg(long)]
        upload: String,
        /// The stable logical fixture id from the fixtures artifact.
        #[arg(long)]
        fixture_id: String,
        /// Declared media type.
        #[arg(long)]
        media_type: String,
        /// Ingest as this app user (devUser authority).
        #[arg(long)]
        user: Option<String>,
    },
    /// asset.delete — explicit authorized delete (refuses while typed
    /// references remain).
    Delete {
        #[command(flatten)]
        target: TargetArgs,
        asset_id: String,
        /// Delete as this app user (owner authority).
        #[arg(long)]
        user: Option<String>,
    },
}

#[derive(clap::Subcommand)]
pub enum SessionCommand {
    /// Mint an ordinary session for an admitted email address. Requires the
    /// existing operator credential and process-bound impersonation capability.
    Mint {
        #[command(flatten)]
        target: TargetArgs,
        #[arg(long)]
        email: String,
    },
}

#[derive(clap::Args)]
pub struct TargetArgs {
    /// Server base URL (e.g. http://127.0.0.1:4287).
    #[arg(long, conflicts_with = "ready_file")]
    pub url: Option<String>,
    /// Readiness descriptor to resolve the server from (see `start --ready-file`).
    #[arg(long)]
    pub ready_file: Option<PathBuf>,
    /// Admin token for gated writes (defaults to SNAPBACK_ADMIN_TOKEN).
    #[arg(long)]
    pub token: Option<String>,
    /// Read one process-bound impersonation capability from stdin. Required
    /// for impersonating operations addressed by --url without a ready file.
    #[arg(long, requires = "url", conflicts_with = "ready_file")]
    pub impersonation_capability_stdin: bool,
}

impl std::fmt::Debug for TargetArgs {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("TargetArgs")
            .field("url", &self.url)
            .field("ready_file", &self.ready_file)
            .field("token", &self.token.as_ref().map(|_| "[REDACTED]"))
            .field(
                "impersonation_capability_stdin",
                &self.impersonation_capability_stdin,
            )
            .finish()
    }
}

const DEFAULT_SERVED_GUIDE_URL: &str = "http://127.0.0.1:4287/_snapback/guide";

#[derive(Clone, Debug, Eq, PartialEq)]
struct GuideSectionMatch {
    path: String,
    heading: String,
    anchor: String,
}

fn markdown_heading(line: &str) -> Option<&str> {
    let trimmed = line.trim_start();
    let level = trimmed.bytes().take_while(|byte| *byte == b'#').count();
    if !(1..=6).contains(&level) || trimmed.as_bytes().get(level) != Some(&b' ') {
        return None;
    }
    let heading = trimmed[level + 1..].trim();
    (!heading.is_empty()).then_some(heading)
}

fn markdown_anchor(heading: &str) -> String {
    let mut anchor = String::new();
    for character in heading.chars().flat_map(char::to_lowercase) {
        if character.is_alphanumeric() || character == '_' || character == '-' {
            anchor.push(character);
        } else if character.is_whitespace() {
            anchor.push('-');
        }
    }
    if anchor.is_empty() {
        "section".to_owned()
    } else {
        anchor
    }
}

fn search_guide_sections_in(
    files: &[crate::guide::EmbeddedGuideFile],
    query: &str,
) -> Vec<GuideSectionMatch> {
    let query = query.to_lowercase();
    let mut matches = Vec::new();

    for file in files {
        if !file.path.ends_with(".md") || file.path == crate::guide::FLAT_PATH {
            continue;
        }
        let Ok(markdown) = std::str::from_utf8(file.bytes) else {
            continue;
        };
        let mut anchor_counts = HashMap::<String, usize>::new();
        let mut current: Option<(String, String, String)> = None;
        let mut active_fence = None;

        let finish_section = |current: Option<(String, String, String)>,
                              matches: &mut Vec<GuideSectionMatch>| {
            if let Some((heading, anchor, text)) = current
                && text.to_lowercase().contains(&query)
            {
                matches.push(GuideSectionMatch {
                    path: file.path.to_owned(),
                    heading,
                    anchor,
                });
            }
        };

        for line in markdown.lines() {
            let trimmed = line.trim_start();
            let fence = if trimmed.starts_with("```") {
                Some('`')
            } else if trimmed.starts_with("~~~") {
                Some('~')
            } else {
                None
            };
            if let Some(fence) = fence {
                match active_fence {
                    Some(active) if active == fence => active_fence = None,
                    None => active_fence = Some(fence),
                    _ => {}
                }
            }

            if active_fence.is_none()
                && let Some(heading) = markdown_heading(line)
            {
                finish_section(current.take(), &mut matches);
                let base_anchor = markdown_anchor(heading);
                let count = anchor_counts.entry(base_anchor.clone()).or_default();
                let anchor = if *count == 0 {
                    base_anchor
                } else {
                    format!("{base_anchor}-{count}")
                };
                *count += 1;
                current = Some((heading.to_owned(), anchor, format!("{heading}\n")));
            } else if let Some((_, _, text)) = &mut current {
                text.push_str(line);
                text.push('\n');
            }
        }
        finish_section(current, &mut matches);
    }

    matches
}

fn search_guide_sections(query: &str) -> Vec<GuideSectionMatch> {
    search_guide_sections_in(crate::guide::EMBEDDED_GUIDE_FILES, query)
}

fn render_guide_command(query_words: &[String]) -> String {
    let query = query_words.join(" ");
    let query = query.trim();
    if query.is_empty() {
        return format!(
            "Snapback Guide documentation channels\n\
             \n\
             The URLs below use the first default dev port. If Snapback selected another port, replace the origin with the one printed by snapback dev or snapback start.\n\
             \n\
             Start with the capability index: {DEFAULT_SERVED_GUIDE_URL}/capabilities.md\n\
             Browse the Guide:             {DEFAULT_SERVED_GUIDE_URL}\n\
             Flat agent projection:         {DEFAULT_SERVED_GUIDE_URL}/flat.md\n\
             Search this embedded build:    snapback guide <query>\n\
             Read through MCP:              snapback mcp\n\
             MCP entry resource:            snapback-guide://manifest\n"
        );
    }

    let matches = search_guide_sections(query);
    if matches.is_empty() {
        return format!(
            "No embedded Guide sections matched {query:?}.\nStart with the capability index: {DEFAULT_SERVED_GUIDE_URL}/capabilities.md\n"
        );
    }

    let mut output = format!("Embedded Guide sections matching {query:?}:\n");
    for matched in &matches {
        output.push_str(&format!(
            "- {}#{} — {}\n  {DEFAULT_SERVED_GUIDE_URL}/{}#{}\n",
            matched.path, matched.anchor, matched.heading, matched.path, matched.anchor
        ));
    }
    output.push_str(&format!("{} section(s) matched.\n", matches.len()));
    output
}

fn guide_command(query: &[String]) -> anyhow::Result<()> {
    use std::io::Write as _;

    std::io::stdout()
        .write_all(render_guide_command(query).as_bytes())
        .context("failed to write Guide output")
}

pub async fn run_from_env() -> anyhow::Result<()> {
    let cli = Cli::parse();
    reject_misdirected_serve_flags(&cli)?;
    match cli.command {
        None => run(cli.serve).await,
        Some(HostCommand::Start(args)) => run(args).await,
        Some(HostCommand::Stop { ready_file }) => host_stop(&ready_file),
        Some(HostCommand::Admin(args)) => admin_command(args).await,
        Some(HostCommand::Inspect(target)) => {
            host_op_via_http(&target, json!({ "operation": "app.inspect" }))
        }
        Some(HostCommand::Reset { target, seed }) => {
            let mut request = json!({ "operation": "app.reset" });
            if let Some(seed) = seed {
                request["seed"] = read_json_file(&seed)?;
            }
            host_op_via_http(&target, request)
        }
        Some(HostCommand::Load {
            target,
            schema,
            functions,
        }) => {
            if schema.is_none() && functions.is_none() {
                anyhow::bail!("load requires --schema and/or --functions manifest files");
            }
            let mut failed = false;
            if let Some(schema) = schema {
                let manifest = read_json_file(&schema)?;
                failed |= !print_envelope(&post_host_op(
                    &target,
                    json!({ "operation": "schema.load", "schema": manifest }),
                )?);
            }
            if let Some(functions) = functions {
                let manifest = read_json_file(&functions)?;
                failed |= !print_envelope(&post_host_op(
                    &target,
                    json!({ "operation": "functions.load", "functions": manifest }),
                )?);
            }
            if failed {
                std::process::exit(1);
            }
            Ok(())
        }
        Some(HostCommand::Run {
            target,
            function,
            args,
            user,
        }) => {
            let parsed_args = parse_run_args(args)?;
            host_op_via_http(
                &target,
                json!({
                    "operation": "function.run",
                    "function": function,
                    "args": parsed_args,
                    "userId": user,
                }),
            )
        }
        Some(HostCommand::Assets { command }) => match command {
            AssetsCommand::Put {
                target,
                file,
                upload,
                args,
                user,
                content_type,
            } => {
                let bytes = std::fs::read(&file)
                    .map_err(|error| anyhow::anyhow!("cannot read {}: {error}", file.display()))?;
                let parsed_args = parse_run_args(args)?;
                let file_name = file
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned());
                let mut input = json!({
                    "upload": upload,
                    "bytesBase64": base64::Engine::encode(
                        &base64::engine::general_purpose::STANDARD,
                        bytes,
                    ),
                });
                if let Some(name) = file_name {
                    input["fileName"] = json!(name);
                }
                if parsed_args != Value::Null {
                    input["args"] = parsed_args;
                }
                if let Some(content_type) = content_type {
                    input["contentType"] = json!(content_type);
                }
                host_op_via_http(
                    &target,
                    json!({ "operation": "asset.put", "input": input, "userId": user }),
                )
            }
            AssetsCommand::Inspect {
                target,
                asset_id,
                user,
            } => host_op_via_http(
                &target,
                json!({
                    "operation": "asset.inspect",
                    "input": { "assetId": asset_id },
                    "userId": user,
                }),
            ),
            AssetsCommand::List { target, state } => {
                let mut input = json!({});
                if let Some(state) = state {
                    input["state"] = json!(state);
                }
                host_op_via_http(
                    &target,
                    json!({ "operation": "asset.list", "input": input }),
                )
            }
            AssetsCommand::Retry { target, asset_id } => host_op_via_http(
                &target,
                json!({ "operation": "asset.retry", "input": { "assetId": asset_id } }),
            ),
            AssetsCommand::GcSweep { target, now_ms } => host_op_via_http(
                &target,
                json!({ "operation": "asset.gcSweep", "input": { "nowMs": now_ms } }),
            ),
            AssetsCommand::RotateSigningKey { target } => {
                host_op_via_http(&target, json!({ "operation": "asset.rotateSigningKey" }))
            }
            AssetsCommand::ExportCut { target, dir } => host_op_via_http(
                &target,
                json!({ "operation": "asset.exportCut", "input": { "dir": dir } }),
            ),
            AssetsCommand::ImportCut { target, dir, apply } => host_op_via_http(
                &target,
                json!({ "operation": "asset.importCut", "input": { "dir": dir, "apply": apply } }),
            ),
            AssetsCommand::EnsureSeedFixture {
                target,
                file,
                upload,
                fixture_id,
                media_type,
                user,
            } => {
                use sha2::Digest as _;
                let bytes = std::fs::read(&file)
                    .map_err(|error| anyhow::anyhow!("cannot read {}: {error}", file.display()))?;
                let source_digest = format!(
                    "sha256:{}",
                    sha2::Sha256::digest(&bytes)
                        .iter()
                        .map(|byte| format!("{byte:02x}"))
                        .collect::<String>()
                );
                let file_name = file
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned());
                let mut input = json!({
                    "fixtureId": fixture_id,
                    "upload": upload,
                    "sourceDigest": source_digest,
                    "mediaType": media_type,
                    "bytesBase64": base64::Engine::encode(
                        &base64::engine::general_purpose::STANDARD,
                        bytes,
                    ),
                });
                if let Some(name) = file_name {
                    input["fileName"] = json!(name);
                }
                host_op_via_http(
                    &target,
                    json!({
                        "operation": "asset.ensureSeedFixture",
                        "input": input,
                        "userId": user,
                    }),
                )
            }
            AssetsCommand::Delete {
                target,
                asset_id,
                user,
            } => host_op_via_http(
                &target,
                json!({
                    "operation": "asset.delete",
                    "input": { "assetId": asset_id },
                    "userId": user,
                }),
            ),
        },
        Some(HostCommand::Session { command }) => match command {
            SessionCommand::Mint { target, email } => {
                host_op_via_http(&target, mint_session_request(email))
            }
        },
        Some(HostCommand::SecretReadMint {
            ready_file,
            token,
            admin_inspect,
            receipts,
            table,
            function,
            explain_function,
            telemetry_events,
            telemetry_export,
            errors_issue,
            ttl_seconds,
            row_budget,
            byte_budget,
        }) => {
            let mut scopes = std::collections::BTreeSet::new();
            if admin_inspect {
                scopes.insert(SecretReadScope::AdminInspect);
            }
            if receipts {
                scopes.insert(SecretReadScope::Receipts);
            }
            if telemetry_events {
                scopes.insert(SecretReadScope::TelemetryEvents);
            }
            if telemetry_export {
                scopes.insert(SecretReadScope::TelemetryExport);
            }
            if errors_issue {
                scopes.insert(SecretReadScope::ErrorsIssue);
            }
            scopes.extend(table.into_iter().map(SecretReadScope::Table));
            scopes.extend(function.into_iter().map(SecretReadScope::FunctionRun));
            scopes.extend(
                explain_function
                    .into_iter()
                    .map(SecretReadScope::FunctionExplain),
            );
            let ttl_ms = ttl_seconds
                .checked_mul(1_000)
                .context("--ttl-seconds is too large")?;
            let response = mint_secret_read_via_http(
                &ready_file,
                token,
                SecretReadMintSpec {
                    scopes,
                    ttl_ms,
                    row_budget,
                    byte_budget,
                },
            )?;
            println!("{}", serde_json::to_string_pretty(&response)?);
            Ok(())
        }
        Some(HostCommand::Telemetry { command }) => telemetry_command(command),
        Some(HostCommand::Errors { command }) => errors_command(command),
        Some(HostCommand::Config { command }) => config_command(command),
        Some(HostCommand::Cron { command }) => cron_command(command),
        Some(HostCommand::Jobs { command }) => jobs_command(command),
        Some(HostCommand::Connections { command }) => connections_command(command),
        Some(HostCommand::NetworkProfile { command }) => match command {
            NetworkProfileCommand::Get { target } => {
                host_op_via_http(&target, json!({ "operation": "debug.networkProfileGet" }))
            }
            NetworkProfileCommand::Set { target, profile } => host_op_via_http(
                &target,
                json!({
                    "operation": "debug.networkProfileSet",
                    "input": parse_network_profile_selection(&profile)?,
                }),
            ),
        },
        Some(HostCommand::Data { command }) => data_command(command),
        Some(HostCommand::Config { command }) => config_command(command),
        Some(HostCommand::Jobs { command }) => jobs_command(command),
        Some(HostCommand::Auth { command }) => match command {
            AuthCommand::Backup { db, output } => auth_backup(&db, &output).await,
            AuthCommand::Restore { from, db } => auth_restore(&from, &db),
        },
        Some(HostCommand::Fork { command }) => fork_command(command).await,
        Some(HostCommand::Guide { query }) => guide_command(&query),
        Some(HostCommand::Mcp) => crate::guide_mcp::run_stdio(),
        Some(HostCommand::BuildIdentity) => {
            println!(
                "{}",
                serde_json::to_string(&json!({
                    "schemaVersion": "snapback.binary-identity.v1",
                    "binary": crate::identity::binary_identity(),
                    "buildDistribution": crate::identity::build_distribution(),
                }))?
            );
            Ok(())
        }
        Some(HostCommand::CompositionActivationPrepare {
            db,
            generated,
            deployment_id,
        }) => startup_blocking(|| {
            prepare_composition_activation_source(&db, &generated, &deployment_id)
        }),
        Some(HostCommand::RuntimeQualify) => {
            let result = startup_blocking(crate::runtime::qualify_handler_vm);
            let report = match &result {
                Ok(()) => json!({
                    "schemaVersion": "snapback.runtime-qualify.v1",
                    "probe": "restricted-no-eval-handler-vm",
                    "ok": true,
                    "binary": crate::identity::binary_identity(),
                }),
                Err(error) => json!({
                    "schemaVersion": "snapback.runtime-qualify.v1",
                    "probe": "restricted-no-eval-handler-vm",
                    "ok": false,
                    "binary": crate::identity::binary_identity(),
                    "diagnostic": error.diagnostic,
                }),
            };
            println!("{}", serde_json::to_string(&report)?);
            if result.is_err() {
                std::process::exit(1);
            }
            Ok(())
        }
        Some(HostCommand::HostedJourneyVerify { receipt, artifacts }) => {
            verify_hosted_product_journey(&receipt, artifacts.as_deref())
        }
        // migrate.* owns `LocalSnapback` directly with no listener ever
        // bound, so the whole subcommand is one pre-bind blocking section —
        // without the handoff the first SQLite read panics the async-worker
        // guard (found by the Step 5 schema-evolution witness).
        Some(HostCommand::Migrate { json, command }) => {
            startup_blocking(|| migrate_command(command, json))
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HostedJourneyArtifactMapV1 {
    schema_version: String,
    artifacts: Vec<HostedJourneyArtifactMapEntryV1>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HostedJourneyArtifactMapEntryV1 {
    artifact_id: String,
    path: PathBuf,
}

/// Product verifier for the Rust-owned LLP 0111 receipt. Receipt artifact ids
/// are opaque; filesystem paths live only in this operator-supplied local map
/// and cannot enter the retained receipt or its digest.
// @ref LLP 0111#4-public-cli-product-journey — public journey evidence is
// independently reopened before the hosted capability boundary can pass.
fn verify_hosted_product_journey(
    receipt_path: &Path,
    artifact_map_path: Option<&Path>,
) -> anyhow::Result<()> {
    const RECEIPT_MAX_BYTES: u64 = 1_048_576;
    const ARTIFACT_MAP_MAX_BYTES: u64 = 1_048_576;
    const EVIDENCE_MAX_BYTES: u64 = 64 * 1_048_576;

    let read_regular = |path: &Path, limit: u64, label: &str| -> anyhow::Result<Vec<u8>> {
        let metadata =
            std::fs::symlink_metadata(path).with_context(|| format!("read {label} metadata"))?;
        if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
            anyhow::bail!("{label} must be a regular non-symlink file");
        }
        if metadata.len() > limit {
            anyhow::bail!("{label} exceeds its bounded size");
        }
        std::fs::read(path).with_context(|| format!("read {label}"))
    };

    let receipt_bytes = read_regular(receipt_path, RECEIPT_MAX_BYTES, "hosted journey receipt")?;
    let receipt: crate::deploy::HostedProductJourneyV1 =
        serde_json::from_slice(&receipt_bytes).context("parse hosted journey receipt")?;
    let mut artifacts = std::collections::BTreeMap::new();
    if let Some(map_path) = artifact_map_path {
        let map_bytes = read_regular(
            map_path,
            ARTIFACT_MAP_MAX_BYTES,
            "hosted journey artifact map",
        )?;
        let map: HostedJourneyArtifactMapV1 =
            serde_json::from_slice(&map_bytes).context("parse hosted journey artifact map")?;
        if map.schema_version != "snapback.hosted-journey-artifact-map.v1" {
            anyhow::bail!("unsupported hosted journey artifact map");
        }
        let root = map_path.parent().unwrap_or_else(|| Path::new("."));
        for entry in map.artifacts {
            if entry.path.is_absolute()
                || entry
                    .path
                    .components()
                    .any(|component| component == std::path::Component::ParentDir)
            {
                anyhow::bail!("hosted journey artifact paths must remain under the map directory");
            }
            let bytes = read_regular(
                &root.join(&entry.path),
                EVIDENCE_MAX_BYTES,
                "hosted journey evidence",
            )?;
            if artifacts.insert(entry.artifact_id, bytes).is_some() {
                anyhow::bail!("duplicate hosted journey artifact id");
            }
        }
    }
    if let Err(errors) = receipt.validate_claim_boundary_with_artifacts(&artifacts) {
        anyhow::bail!("SNAPBACK_HOSTED_JOURNEY_INVALID: {}", errors.join(", "));
    }
    println!(
        "{}",
        serde_json::to_string(&json!({
            "schemaVersion": "snapback.hosted-journey-verification.v1",
            "status": "verified",
            "receiptSha256": receipt.receipt_sha256,
            "evidenceArtifacts": artifacts.len(),
        }))?
    );
    Ok(())
}

/// Run physical backup only after acquiring the same instance lock a server
/// owns. The process-local maintenance gate is acquired before opening the
/// database, so keyring validation and SQLite backup share one quiesced unit.
// @ref LLP 0057#consistent-backup — the CLI refuses live ownership and publishes SQLite plus exact keyring bytes atomically.
async fn auth_backup(database_path: &Path, output_directory: &Path) -> anyhow::Result<()> {
    let result = auth_backup_inner(database_path, output_directory).await;
    match result {
        Ok(outcome) => {
            println!(
                "{}",
                serde_json::to_string_pretty(&json!({
                    "ok": true,
                    "operation": "auth.backup",
                    "output": output_directory,
                    "publicationState": outcome.publication_state,
                }))?
            );
            Ok(())
        }
        Err(error) => {
            let diagnostic = error
                .downcast_ref::<crate::diagnostic::SnapbackError>()
                .map(|error| error.diagnostic.clone())
                .unwrap_or_else(|| {
                    crate::diagnostic::Diagnostic::error(
                        "SNAPBACK_AUTH_BACKUP_INVALID",
                        "auth-backup",
                        error.to_string(),
                    )
                    .with_details(json!({ "publicationState": "Unpublished" }))
                });
            let publication_state = diagnostic
                .details
                .get("publicationState")
                .cloned()
                .unwrap_or_else(|| json!("Unpublished"));
            println!(
                "{}",
                serde_json::to_string_pretty(&json!({
                    "ok": false,
                    "operation": "auth.backup",
                    "output": output_directory,
                    "publicationState": publication_state,
                    "diagnostics": [diagnostic],
                }))?
            );
            Err(error)
        }
    }
}

async fn auth_backup_inner(
    database_path: &Path,
    output_directory: &Path,
) -> anyhow::Result<crate::auth::backup::AuthBackupOutcome> {
    let (database_path, _instance_lock, provider) = startup_blocking(|| {
        let database_path = resolve_database_path(database_path)?;
        anyhow::ensure!(
            database_path.is_file(),
            "SNAPBACK_AUTH_BACKUP_INVALID: source database does not exist"
        );
        let instance_lock = DatabaseInstanceLock::acquire(&database_path)?;
        let keyring = Arc::new(crate::auth::keyring::AuthKeyringStore::file_for_database(
            &database_path,
        ));
        let provider = Arc::new(
            crate::auth::provider::AuthProvider::new(
                crate::auth::provider::AuthProviderProfile::Test,
                keyring,
            )
            .map_err(crate::auth::provider::ProviderError::into_snapback_error)?,
        );
        Ok::<_, anyhow::Error>((database_path, instance_lock, provider))
    })?;
    let maintenance = provider.exclusive_maintenance().await;
    let created_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis().min(9_007_199_254_740_991) as u64)
        .unwrap_or(0);
    // @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — offline
    // backup still runs beneath Tokio's CLI entrypoint, so every SQLite page
    // read and copy crosses the sanctioned pre-bind blocking boundary.
    startup_blocking(|| {
        let mut snapback = LocalSnapback::open(&database_path)?;
        crate::auth::backup::create_backup(
            snapback.auth_database_mut(),
            maintenance.keyring(),
            output_directory,
            created_at_ms,
            &crate::auth::crypto::OsRandom,
        )
        .map_err(anyhow::Error::new)
    })
}

/// Restore always targets a database inside a wholly absent instance
/// directory. The returned UUIDv7 is deliberately non-secret and is the only
/// value the next startup may consume as destructive restore authority.
// @ref LLP 0057#restore — restore publishes one new directory and requires a matching pre-bind startup declaration.
fn auth_restore(backup_directory: &Path, target_database: &Path) -> anyhow::Result<()> {
    let backup_directory = std::fs::canonicalize(backup_directory).with_context(|| {
        format!(
            "SNAPBACK_AUTH_BACKUP_INVALID: failed to resolve backup directory {}",
            backup_directory.display()
        )
    })?;
    let target_database = resolve_restore_database_path(target_database)?;
    let declaration = crate::auth::backup::restore_backup(
        &backup_directory,
        &target_database,
        &crate::auth::crypto::OsRandom,
    )?;
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "ok": true,
            "operation": "auth.restore",
            "database": target_database,
            "declarationId": declaration.declaration_id(),
            "next": {
                "command": "snapback start",
                "restoredFromBackup": declaration.declaration_id(),
            },
        }))?
    );
    Ok(())
}

fn fork_root(app_root: &Path, requested: Option<PathBuf>) -> anyhow::Result<PathBuf> {
    let requested = requested.unwrap_or_else(|| app_root.join(".snapback/forks"));
    std::fs::create_dir_all(&requested)
        .with_context(|| format!("failed to create fork root {}", requested.display()))?;
    std::fs::canonicalize(&requested)
        .with_context(|| format!("failed to resolve fork root {}", requested.display()))
}

fn parse_fork_ttl(raw: &str) -> anyhow::Result<u64> {
    let (number, multiplier) = if let Some(value) = raw.strip_suffix("ms") {
        (value, 1_u64)
    } else if let Some(value) = raw.strip_suffix('s') {
        (value, 1_000)
    } else if let Some(value) = raw.strip_suffix('m') {
        (value, 60_000)
    } else if let Some(value) = raw.strip_suffix('h') {
        (value, 3_600_000)
    } else if let Some(value) = raw.strip_suffix('d') {
        (value, 86_400_000)
    } else {
        anyhow::bail!("SNAPBACK_FORK_TTL_INVALID: use a finite duration such as 30m or 2h");
    };
    let amount = number
        .parse::<u64>()
        .context("SNAPBACK_FORK_TTL_INVALID: duration amount is not an integer")?;
    let ttl = amount
        .checked_mul(multiplier)
        .context("SNAPBACK_FORK_TTL_INVALID: duration is too large")?;
    anyhow::ensure!(
        ttl > 0,
        "SNAPBACK_FORK_TTL_INVALID: duration must be positive"
    );
    Ok(ttl)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| {
            elapsed
                .as_millis()
                .min(crate::manifest::PORTABLE_TIMESTAMP_MAX_MS.into()) as u64
        })
        .unwrap_or(0)
}

async fn wait_for_derived_fork_expiry(
    database: Option<PathBuf>,
    lineage: Option<crate::instance_fork::DerivedForkLineageV1>,
) -> (crate::instance_fork::DerivedForkLineageV1, u64) {
    let Some(lineage) = lineage else {
        return std::future::pending().await;
    };
    let Some(mut expires_at_ms) = lineage.expires_at_ms else {
        return std::future::pending().await;
    };
    loop {
        let observed_at_ms = now_ms();
        if observed_at_ms >= expires_at_ms {
            // A completed `fork renew` moves the database lineage, which is
            // the expiry authority — the boot-time copy is only a schedule.
            // Mid-renewal reads (sentinel window, carrier rewrite) fail
            // transiently, so retry briefly before accepting expiry.
            let mut renewed_to = None;
            if let Some(database) = database.as_deref() {
                for _ in 0..40 {
                    match crate::instance_fork::refreshed_lineage(database) {
                        Ok(Some(current))
                            if current
                                .expires_at_ms
                                .is_some_and(|expiry| expiry > observed_at_ms) =>
                        {
                            renewed_to = current.expires_at_ms;
                            break;
                        }
                        Ok(_) => break,
                        Err(_) => {
                            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                        }
                    }
                }
            }
            match renewed_to {
                Some(new_expiry) => {
                    expires_at_ms = new_expiry;
                    continue;
                }
                None => return (lineage, observed_at_ms),
            }
        }
        let delay_ms = expires_at_ms.saturating_sub(observed_at_ms).clamp(1, 1_000);
        tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
    }
}

fn stored_app_id(database: &Path) -> anyhow::Result<String> {
    let conn = rusqlite::Connection::open(database)?;
    let stored: Option<String> = conn
        .query_row(
            "SELECT value FROM _snapback_meta WHERE key='schema_manifest'",
            [],
            |row| row.get(0),
        )
        .optional()?;
    let stored = stored.context("SNAPBACK_FORK_APP_ID_REQUIRED: source has no stored schema")?;
    let schema: crate::manifest::SchemaManifest =
        serde_json::from_str(&stored).context("source stored schema is malformed")?;
    Ok(schema.app_id)
}

fn source_from_path(path: &Path) -> anyhow::Result<(PathBuf, String, String)> {
    let mut prefix = [0_u8; 16];
    let looks_sqlite = std::fs::File::open(path)
        .and_then(|mut file| file.read_exact(&mut prefix))
        .is_ok()
        && &prefix == b"SQLite format 3\0";
    if !looks_sqlite
        && let Ok(value) = read_trusted_json_file(path)
        && let Ok(descriptor) = HostReadyDescriptor::validate(&value)
    {
        verify_stop_target(&descriptor, &fetch_health(&descriptor.server_url))
            .map_err(|diagnostic| anyhow::anyhow!("{}: {}", diagnostic.code, diagnostic.message))?;
        let database = descriptor
            .database
            .path
            .as_deref()
            .map(PathBuf::from)
            .context("SNAPBACK_FORK_SOURCE_INVALID: in-memory servers cannot be forked")?;
        let database = std::fs::canonicalize(&database).with_context(|| {
            format!(
                "SNAPBACK_FORK_SOURCE_INVALID: cannot resolve {}",
                database.display()
            )
        })?;
        // The ready descriptor records bind-time identity and may predate a
        // later manifest load. The snapshot's persisted schema is the fork's
        // actual logical-app identity.
        let app_id = stored_app_id(&database)?;
        return Ok((database, app_id, descriptor.startup_id));
    }
    let database = std::fs::canonicalize(path).with_context(|| {
        format!(
            "SNAPBACK_FORK_SOURCE_INVALID: cannot resolve {}",
            path.display()
        )
    })?;
    anyhow::ensure!(
        database.is_file(),
        "SNAPBACK_FORK_SOURCE_INVALID: source is not a file"
    );
    let app_id = stored_app_id(&database)?;
    let parent_instance_id = {
        let conn = rusqlite::Connection::open(&database)?;
        conn.query_row(
            "SELECT value FROM _snapback_meta WHERE key='auth_invalidation_data_version_stream_v1'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .unwrap_or_else(|| format!("sqlite:{}", database.display()))
    };
    Ok((database, app_id, parent_instance_id))
}

fn fork_envelope(
    operation: &str,
    app_id: String,
    app_root: Option<&Path>,
    server_url: Option<String>,
    data: Value,
) -> HostOpsResult {
    fork_envelope_with_diagnostics(
        operation,
        app_id,
        app_root,
        server_url,
        data,
        Vec::new(),
    )
}

fn fork_envelope_with_diagnostics(
    operation: &str,
    app_id: String,
    app_root: Option<&Path>,
    server_url: Option<String>,
    data: Value,
    diagnostics: Vec<crate::diagnostic::Diagnostic>,
) -> HostOpsResult {
    HostOpsResult {
        schema_version: SNAPBACK_SCHEMA_VERSION.to_owned(),
        result_kind: HOST_OPS_RESULT_KIND.to_owned(),
        request_id: crate::ids::mint_time_ordered(crate::ids::Kind::HostOperation),
        operation: operation.to_owned(),
        ok: true,
        target: crate::host_ops::HostOpsTarget {
            app_id,
            app_root: app_root.map(|path| path.display().to_string()),
            target_profile: "local-dev-sqlite-ibex".to_owned(),
            server_url,
        },
        authority: None,
        artifacts: HostOpsArtifacts::default(),
        data,
        diagnostics,
        next: Vec::new(),
        secret_read_tables: Vec::new(),
        secret_read_rows: 0,
        secret_read_query: false,
        secret_read_provenance_complete: true,
    }
}

/// The honest asset-custody fact for one fork directory: a fork of an
/// asset-bearing parent carries a digest-verified private blob tree from the
/// same cut; a fork of an asset-free parent simply has none.
fn fork_asset_custody(destination: &Path) -> &'static str {
    let blobs = destination.join("assets").join("blobs");
    match std::fs::read_dir(&blobs) {
        Ok(mut entries) => {
            if entries.next().is_some() {
                "fork-private-same-cut"
            } else {
                "no-assets"
            }
        }
        Err(_) => "no-assets",
    }
}

fn fork_secret_disposition(with_secrets: bool, database: &Path) -> &'static str {
    if crate::config::ConfigStore::path_for_database(database).is_file() {
        "copied-explicitly"
    } else if with_secrets {
        "copy-requested-source-absent"
    } else {
        "scrubbed"
    }
}

fn managed_fork_secret_disposition(
    target: &crate::instance_fork::ManagedForkTargetV1,
) -> &'static str {
    match target
        .receipt
        .custody
        .get("sidecar:*.config.json")
        .copied()
    {
        Some(crate::instance_fork::CustodyDisposition::Copy)
            if crate::config::ConfigStore::path_for_database(&target.database).is_file() =>
        {
            "copied-explicitly"
        }
        Some(crate::instance_fork::CustodyDisposition::Copy) => "copy-requested-source-absent",
        _ => "scrubbed",
    }
}

#[derive(Default)]
struct ForkProjectionScalars {
    url: Option<String>,
    fork_id: Option<String>,
    database_path: Option<String>,
    ready_path: Option<String>,
    admin_token_path: Option<String>,
}

fn print_fork_projection(
    format: ForkOutputFormat,
    envelope: &HostOpsResult,
    scalars: &ForkProjectionScalars,
) -> anyhow::Result<()> {
    if format == ForkOutputFormat::Json {
        print_envelope(&serde_json::to_value(envelope)?);
        return Ok(());
    }
    let value = match format {
        ForkOutputFormat::Json => unreachable!(),
        ForkOutputFormat::Url => scalars.url.as_deref(),
        ForkOutputFormat::ForkId => scalars.fork_id.as_deref(),
        ForkOutputFormat::DatabasePath => scalars.database_path.as_deref(),
        ForkOutputFormat::ReadyPath => scalars.ready_path.as_deref(),
        ForkOutputFormat::AdminTokenPath => scalars.admin_token_path.as_deref(),
    };
    let value = value.context(
        "SNAPBACK_FORK_PROJECTION_UNAVAILABLE: requested scalar is not available for this fork",
    )?;
    println!("{value}");
    Ok(())
}

fn resolve_fork_destination(root: &Path, requested: PathBuf) -> anyhow::Result<PathBuf> {
    let destination = if requested.is_absolute() {
        requested
    } else {
        root.join(requested)
    };
    let parent = destination
        .parent()
        .context("SNAPBACK_FORK_PATH_INVALID: fork destination has no parent")?;
    anyhow::ensure!(
        std::fs::canonicalize(parent)? == root,
        "SNAPBACK_FORK_PATH_INVALID: destination must be a direct child of the fork root"
    );
    anyhow::ensure!(
        destination.file_name().is_some(),
        "SNAPBACK_FORK_PATH_INVALID: destination must have a direct-child name"
    );
    Ok(destination)
}

#[derive(Debug, Default)]
struct ForkReapOutcome {
    reaped: Vec<String>,
    cleared_stale_registry: Vec<String>,
}

/// Reap every expired fork and complete any partial cleanup, tolerating
/// concurrent lifecycle actors: an entry that disappears mid-sweep was
/// cleaned up by its other owner, and a registry entry whose directory is
/// already gone is stale bookkeeping to clear, never a reason to wedge the
/// remaining forks' cleanup (LLP 0185 Phase 3 item 5).
fn reap_managed_forks(root: &Path, now_ms: u64) -> anyhow::Result<ForkReapOutcome> {
    let mut outcome = ForkReapOutcome::default();
    for fork_id in crate::instance_fork::managed_registry_ids(root)? {
        // Holding the cleanup lock across bind → stop → drop means a
        // concurrent drop/reap either finished before we bound (observed as
        // NOT_FOUND) or waits until we finish — never a torn mid-teardown.
        let lock = crate::instance_fork::lock_cleanup(root, &fork_id)?;
        match crate::instance_fork::managed_target(root, &fork_id) {
            Ok(target) => {
                let expired = target
                    .entry
                    .lineage
                    .expires_at_ms
                    .is_some_and(|expires| expires <= now_ms);
                if !expired {
                    continue;
                }
                if let Some(ready) = target.ready_file.as_deref() {
                    let _ = quiet_stop_fork(ready, &target.database)?;
                }
                crate::instance_fork::drop_managed_locked(root, &fork_id)?;
                outcome.reaped.push(fork_id);
                lock.dispose();
            }
            Err(error) if error.diagnostic.code == "SNAPBACK_FORK_NOT_FOUND" => {
                lock.dispose();
            }
            Err(error) if error.diagnostic.code == "SNAPBACK_FORK_REGISTRY_STALE" => {
                crate::instance_fork::clear_stale_registry_entry_locked(root, &fork_id)?;
                outcome.cleared_stale_registry.push(fork_id);
                lock.dispose();
            }
            Err(error) => return Err(error.into()),
        }
    }
    outcome.reaped.sort();
    outcome.cleared_stale_registry.sort();
    Ok(outcome)
}

fn automatic_reap_before_create(
    root: &Path,
    observed_at_ms: u64,
) -> anyhow::Result<ForkReapOutcome> {
    reap_managed_forks(root, observed_at_ms).map_err(|error| {
        anyhow::Error::new(
            crate::diagnostic::SnapbackError::error(
                "SNAPBACK_FORK_EXPIRED_REAP_FAILED",
                "instanceFork",
                "create refused: expired managed fork(s) were present and could not all be swept",
            )
            .with_details(json!({
                "observedAtMs": observed_at_ms,
                "cause": error.to_string(),
            })),
        )
    })
}

fn fork_process_health(
    target: &crate::instance_fork::ManagedForkTargetV1,
) -> (Value, Vec<crate::diagnostic::Diagnostic>, Option<String>) {
    let Some(ready_file) = target.ready_file.as_deref() else {
        return (
            json!({
                "status": "not-recorded",
                "responding": false,
                "pid": null,
                "checkedAtMs": now_ms(),
            }),
            Vec::new(),
            None,
        );
    };
    if !ready_file.is_file() {
        return (
            json!({
                "status": "stale-ready-file",
                "responding": false,
                "pid": null,
                "checkedAtMs": now_ms(),
            }),
            vec![crate::diagnostic::Diagnostic::warning(
                "SNAPBACK_FORK_REGISTRY_STALE",
                "instanceFork",
                "registry records a ready file that no longer exists",
            )
            .with_details(json!({ "readyFile": ready_file }))],
            None,
        );
    }
    let descriptor = match read_trusted_json_file(ready_file)
        .ok()
        .and_then(|value| HostReadyDescriptor::validate(&value).ok())
    {
        Some(descriptor) => descriptor,
        None => {
            return (
                json!({
                    "status": "unverifiable",
                    "responding": false,
                    "pid": null,
                    "checkedAtMs": now_ms(),
                }),
                vec![crate::diagnostic::Diagnostic::warning(
                    "SNAPBACK_FORK_READY_INVALID",
                    "instanceFork",
                    "recorded fork readiness descriptor is missing or malformed",
                )
                .with_details(json!({ "readyFile": ready_file }))],
                None,
            );
        }
    };
    if let Err(error) = verify_fork_ready_database(&descriptor, &target.database) {
        return (
            json!({
                "status": "unverifiable",
                "responding": false,
                "pid": descriptor.pid,
                "checkedAtMs": now_ms(),
            }),
            vec![crate::diagnostic::Diagnostic::warning(
                "SNAPBACK_FORK_READY_INVALID",
                "instanceFork",
                "recorded readiness descriptor is not bound to the fork database",
            )
            .with_details(json!({ "reason": error.to_string() }))],
            None,
        );
    }
    let health = fetch_health(&descriptor.server_url);
    if verify_live_descriptor_identity(&descriptor, &health, "fork.inspect").is_ok() {
        return (
            json!({
                "status": "responding",
                "responding": true,
                "pid": descriptor.pid,
                "checkedAtMs": now_ms(),
                "serverUrl": descriptor.server_url,
            }),
            Vec::new(),
            Some(descriptor.server_url),
        );
    }
    match process_is_proven_gone(descriptor.pid) {
        Ok(true) => (
            json!({
                "status": "stopped",
                "responding": false,
                "pid": descriptor.pid,
                "checkedAtMs": now_ms(),
                "serverUrl": descriptor.server_url,
            }),
            vec![crate::diagnostic::Diagnostic::warning(
                "SNAPBACK_FORK_REGISTRY_STALE",
                "instanceFork",
                "fork process is gone but its recorded ready descriptor remains",
            )
            .with_details(json!({ "pid": descriptor.pid }))],
            Some(descriptor.server_url),
        ),
        Ok(false) | Err(_) => (
            json!({
                "status": "unverifiable",
                "responding": false,
                "pid": descriptor.pid,
                "checkedAtMs": now_ms(),
                "serverUrl": descriptor.server_url,
            }),
            vec![crate::diagnostic::Diagnostic::warning(
                "SNAPBACK_FORK_STOP_UNVERIFIED",
                "instanceFork",
                "fork PID may still be live, but its process identity cannot be verified",
            )
            .with_details(json!({ "pid": descriptor.pid }))],
            Some(descriptor.server_url),
        ),
    }
}

#[cfg(unix)]
fn process_is_proven_gone(pid: u32) -> anyhow::Result<bool> {
    if unsafe { libc::kill(pid as i32, 0) } == 0 {
        return Ok(false);
    }
    match std::io::Error::last_os_error().raw_os_error() {
        Some(libc::ESRCH) => Ok(true),
        Some(libc::EPERM) => Ok(false),
        other => anyhow::bail!(
            "SNAPBACK_FORK_STOP_UNVERIFIED: cannot determine whether pid {pid} exists (errno {other:?})"
        ),
    }
}

#[cfg(not(unix))]
fn process_is_proven_gone(_pid: u32) -> anyhow::Result<bool> {
    Ok(false)
}

fn verify_fork_ready_database(
    descriptor: &HostReadyDescriptor,
    expected_database: &Path,
) -> anyhow::Result<()> {
    let declared = descriptor
        .database
        .path
        .as_deref()
        .map(Path::new)
        .context("SNAPBACK_FORK_READY_INVALID: fork descriptor has no database path")?;
    let declared = std::fs::canonicalize(declared)
        .context("SNAPBACK_FORK_READY_INVALID: fork descriptor database path cannot be resolved")?;
    anyhow::ensure!(
        declared == expected_database,
        "SNAPBACK_FORK_READY_INVALID: fork descriptor names a different database"
    );
    Ok(())
}

fn remove_ready_after_process_gone(ready_file: &Path) -> anyhow::Result<()> {
    match std::fs::remove_file(ready_file) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error)
            .context("SNAPBACK_FORK_READY_INVALID: failed to remove proven-stale ready file"),
    }
}

fn quiet_stop_fork(ready_file: &Path, expected_database: &Path) -> anyhow::Result<Option<u32>> {
    if !ready_file.exists() {
        anyhow::bail!(
            "SNAPBACK_FORK_STOP_UNVERIFIED: readiness descriptor is missing, so process absence cannot be proved"
        );
    }
    let value = read_trusted_json_file(ready_file)?;
    let descriptor = HostReadyDescriptor::validate(&value).map_err(|problems| {
        anyhow::anyhow!("SNAPBACK_FORK_READY_INVALID: {}", problems.join("; "))
    })?;
    verify_fork_ready_database(&descriptor, expected_database)?;
    if let Err(diagnostic) = verify_stop_target(&descriptor, &fetch_health(&descriptor.server_url))
    {
        if process_is_proven_gone(descriptor.pid)? {
            remove_ready_after_process_gone(ready_file)?;
            return Ok(None);
        }
        anyhow::bail!(
            "SNAPBACK_FORK_STOP_UNVERIFIED: pid {} may still exist; {}: {}",
            descriptor.pid,
            diagnostic.code,
            diagnostic.message
        );
    }
    let signalled = std::process::Command::new("kill")
        .arg(descriptor.pid.to_string())
        .status()
        .context("failed to signal fork server")?
        .success();
    if !signalled {
        // The server can exit between identity verification and the signal
        // (self-shutdown at expiry, or a concurrent stop). Losing that race
        // is a completed stop, not a failure.
        if process_is_proven_gone(descriptor.pid)? {
            remove_ready_after_process_gone(ready_file)?;
            return Ok(None);
        }
        anyhow::bail!("SNAPBACK_FORK_STOP_FAILED: fork server did not accept SIGTERM");
    }
    for _ in 0..40 {
        if fetch_health(&descriptor.server_url).is_err() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    for _ in 0..200 {
        if process_is_proven_gone(descriptor.pid)? {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
    }
    anyhow::ensure!(
        process_is_proven_gone(descriptor.pid)?,
        "SNAPBACK_FORK_STOP_TIMEOUT: fork server process did not exit"
    );
    remove_ready_after_process_gone(ready_file)?;
    Ok(Some(descriptor.pid))
}

async fn fork_command(command: ForkCommand) -> anyhow::Result<()> {
    fork_command_with_clock(command, now_ms).await
}

async fn fork_command_with_clock<F>(command: ForkCommand, clock: F) -> anyhow::Result<()>
where
    F: Fn() -> u64,
{
    // @ref LLP 0158#implementation-path-local-v1-explored-2026-08-03 —
    // F0b is a finite-TTL, non-promotable derived deployment with an
    // explicit secret opt-in, inert workers, and fail-closed egress.
    match command {
        ForkCommand::Create {
            from,
            ttl,
            with_secrets,
            app_root,
            fork_root: requested_root,
            destination,
            ready_file,
            retain_base,
            max_forks,
            max_fork_bytes,
            max_total_bytes,
            format,
        } => {
            let app_root = std::fs::canonicalize(&app_root).with_context(|| {
                format!("SNAPBACK_FORK_APP_ROOT_INVALID: {}", app_root.display())
            })?;
            let root = fork_root(&app_root, requested_root)?;
            let created_at_ms = clock();
            let automatically_reaped = automatic_reap_before_create(&root, created_at_ms)?;
            let source = from.unwrap_or_else(|| app_root.join(".snapback/dev.sqlite3"));
            let (source_database, app_id, parent_instance_id) = source_from_path(&source)?;
            let limits = crate::instance_fork::ForkResourceLimits {
                max_forks,
                max_fork_bytes,
                max_total_bytes,
            };
            let resource_usage = crate::instance_fork::enforce_creation_limits(
                &root,
                &source_database,
                &limits,
                retain_base,
            )?;
            let ttl_ms = parse_fork_ttl(&ttl)?;
            let expires_at_ms = created_at_ms
                .checked_add(ttl_ms)
                .context("SNAPBACK_FORK_TTL_INVALID: expiry exceeds the portable clock")?;
            anyhow::ensure!(
                expires_at_ms <= crate::manifest::PORTABLE_TIMESTAMP_MAX_MS,
                "SNAPBACK_FORK_TTL_INVALID: expiry exceeds the portable clock"
            );
            let destination = resolve_fork_destination(
                &root,
                destination.unwrap_or_else(|| PathBuf::from(format!("fork-{}", Uuid::now_v7()))),
            )?;
            let receipt = startup_blocking(|| {
                crate::instance_fork::publish_managed_with_base(
                    &source_database,
                    &destination,
                    &app_id,
                    &parent_instance_id,
                    created_at_ms,
                    expires_at_ms,
                    with_secrets,
                    retain_base,
                )
            })?;
            let destination = std::fs::canonicalize(&destination).context(
                "SNAPBACK_FORK_PATH_INVALID: published destination could not be resolved",
            )?;
            let database = destination.join(&receipt.database_file);
            let ready_file = match ready_file {
                Some(path) if path.is_absolute() => path,
                Some(path) => destination.join(path),
                None => destination.join("fork.ready.json"),
            };
            let ready_parent = ready_file
                .parent()
                .context("SNAPBACK_FORK_READY_INVALID: ready file has no parent")?;
            anyhow::ensure!(
                std::fs::canonicalize(ready_parent)? == destination,
                "SNAPBACK_FORK_READY_INVALID: ready file must be a direct child of the fork directory"
            );
            let log_path = destination.join("fork-runtime.log");
            let log = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&log_path)?;
            let error_log = log.try_clone()?;
            let mut launch = std::process::Command::new(std::env::current_exe()?);
            launch
                .arg("start")
                .arg("--db")
                .arg(&database)
                .arg("--port")
                .arg("0")
                .arg("--ready-file")
                .arg(&ready_file)
                .arg("--cron-disabled")
                .current_dir(&app_root)
                .env("SNAPBACK_JOBS_DISABLED", "1")
                .env("SNAPBACK_ASSET_RUNNER_DISABLED", "1")
                .env_remove("SNAPBACK_ADMIN_TOKEN")
                .stdout(std::process::Stdio::from(log))
                .stderr(std::process::Stdio::from(error_log));
            #[cfg(unix)]
            {
                use std::os::unix::process::CommandExt as _;
                // The fork server outlives this short CLI projection. A new
                // session prevents terminal/launcher teardown from killing
                // the derived deployment immediately after readiness.
                unsafe {
                    launch.pre_exec(|| {
                        if libc::setsid() == -1 {
                            return Err(std::io::Error::last_os_error());
                        }
                        Ok(())
                    });
                }
            }
            let mut child = launch
                .spawn()
                .context("SNAPBACK_FORK_BOOT_FAILED: could not spawn fork server")?;
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
            while !ready_file.exists() {
                if let Some(status) = child.try_wait()? {
                    anyhow::bail!(
                        "SNAPBACK_FORK_BOOT_FAILED: server exited with {status}; see {}",
                        log_path.display()
                    );
                }
                if std::time::Instant::now() >= deadline {
                    let _ = child.kill();
                    anyhow::bail!(
                        "SNAPBACK_FORK_BOOT_TIMEOUT: no ready descriptor; see {}",
                        log_path.display()
                    );
                }
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
            let ready_value = read_trusted_json_file(&ready_file)?;
            let descriptor = HostReadyDescriptor::validate(&ready_value).map_err(|problems| {
                anyhow::anyhow!("SNAPBACK_FORK_READY_INVALID: {}", problems.join("; "))
            })?;
            anyhow::ensure!(
                descriptor.pid == child.id(),
                "SNAPBACK_FORK_READY_INVALID: ready descriptor was not written by the spawned fork process"
            );
            verify_fork_ready_database(&descriptor, &database)?;
            verify_live_descriptor_identity(
                &descriptor,
                &fetch_health(&descriptor.server_url),
                "fork.create",
            )
            .map_err(|diagnostic| anyhow::anyhow!("{}: {}", diagnostic.code, diagnostic.message))?;
            let declared_admin = descriptor
                .admin_token_file
                .as_deref()
                .map(PathBuf::from)
                .context("SNAPBACK_FORK_READY_INVALID: fork has no minted admin-token path")?;
            anyhow::ensure!(
                declared_admin == crate::admin::admin_token_sibling(&database),
                "SNAPBACK_FORK_READY_INVALID: admin-token path is not the fork database sibling"
            );
            let minted_admin =
                String::from_utf8(crate::secure_file::read_owner_only(&declared_admin)?)?
                    .trim()
                    .to_owned();
            let target = TargetArgs {
                url: None,
                ready_file: Some(ready_file.clone()),
                token: Some(minted_admin),
                impersonation_capability_stdin: false,
            };
            let generated = app_root.join("snapback/generated");
            for (operation, key, path) in [
                (
                    "schema.load",
                    "schema",
                    generated.join("schema.manifest.json"),
                ),
                (
                    "functions.load",
                    "functions",
                    generated.join("functions.manifest.json"),
                ),
            ] {
                if path.is_file() {
                    let mut request = json!({ "operation": operation });
                    request[key] = read_json_file(&path)?;
                    let response = post_host_op(&target, request)?;
                    if !response.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                        let _ = quiet_stop_fork(&ready_file, &database);
                        anyhow::bail!("SNAPBACK_FORK_LOAD_FAILED: {response}");
                    }
                }
            }
            let entry = crate::instance_fork::record_managed_runtime(
                &root,
                &receipt.lineage.fork_id,
                &ready_file,
                Some(&app_root),
            )?;
            let envelope = fork_envelope(
                "fork.create",
                app_id,
                Some(&app_root),
                Some(descriptor.server_url.clone()),
                json!({
                    "receipt": receipt,
                    "registry": entry,
                    "database": database,
                    "readyFile": ready_file,
                    "runtimeLog": log_path,
                    "workerPolicy": {
                        "cron": "disabled",
                        "jobs": "disabled",
                        "assets": "disabled"
                    },
                    "egressPolicy": "deny-all-v1",
                    "assetCustody": fork_asset_custody(&destination),
                    "secrets": fork_secret_disposition(with_secrets, &database),
                    "automaticReap": {
                        "observedAtMs": created_at_ms,
                        "reapedForkIds": automatically_reaped.reaped,
                        "clearedStaleRegistryIds": automatically_reaped.cleared_stale_registry,
                    },
                    "resourceAdmission": {
                        "usage": resource_usage,
                        "limits": {
                            "maxForks": limits.max_forks,
                            "maxForkBytes": limits.max_fork_bytes,
                            "maxTotalBytes": limits.max_total_bytes,
                        },
                    },
                }),
            );
            let scalars = ForkProjectionScalars {
                url: Some(descriptor.server_url),
                fork_id: Some(receipt.lineage.fork_id.clone()),
                database_path: Some(database.display().to_string()),
                ready_path: Some(ready_file.display().to_string()),
                admin_token_path: Some(declared_admin.display().to_string()),
            };
            print_fork_projection(format, &envelope, &scalars)
        }
        ForkCommand::List {
            app_root,
            fork_root: requested_root,
        } => {
            let app_root = std::fs::canonicalize(app_root)?;
            let root = fork_root(&app_root, requested_root)?;
            // One stale or corrupt registry entry must not hide every other
            // fork from the operator; bind what proves out and surface the
            // rest as diagnostics (LLP 0185 Phase 3 item 5).
            let mut entries = Vec::new();
            let mut unbound = Vec::new();
            let mut diagnostics = Vec::new();
            for fork_id in crate::instance_fork::managed_registry_ids(&root)? {
                match crate::instance_fork::managed_target(&root, &fork_id) {
                    Ok(target) => entries.push(target.entry),
                    Err(error) if error.diagnostic.code == "SNAPBACK_FORK_NOT_FOUND" => {}
                    Err(error) => {
                        let code = error.diagnostic.code.clone();
                        unbound.push(json!({ "forkId": fork_id, "code": code }));
                        diagnostics.push(
                            crate::diagnostic::Diagnostic::warning(
                                error.diagnostic.code,
                                "instanceFork",
                                "registry entry could not be bound to local fork evidence",
                            )
                            .with_details(json!({ "forkId": fork_id })),
                        );
                    }
                }
            }
            entries.sort_by(|left, right| left.lineage.fork_id.cmp(&right.lineage.fork_id));
            let app_id = entries
                .first()
                .map(|entry| entry.lineage.app_id.clone())
                .unwrap_or_else(|| "unknown".to_owned());
            let resource_usage = json!({
                "forkCount": entries.len() + unbound.len(),
                "totalBytes": crate::instance_fork::directory_tree_bytes(&root)?,
                "defaultLimits": {
                    "maxForks": crate::instance_fork::MANAGED_FORK_MAX_COUNT,
                    "maxForkBytes": crate::instance_fork::MANAGED_FORK_MAX_FORK_BYTES,
                    "maxTotalBytes": crate::instance_fork::MANAGED_FORK_MAX_TOTAL_BYTES,
                    "maxLifetimeMs": crate::instance_fork::MANAGED_FORK_MAX_LIFETIME_MS,
                    "maxDiffRows": crate::instance_fork::FORK_DIFF_MAX_ROWS,
                },
            });
            let envelope = fork_envelope_with_diagnostics(
                "fork.list",
                app_id,
                Some(&app_root),
                None,
                json!({
                    "forkRoot": root,
                    "forks": entries,
                    "unboundRegistry": unbound,
                    "resourceUsage": resource_usage,
                }),
                diagnostics,
            );
            print_envelope(&serde_json::to_value(envelope)?);
            Ok(())
        }
        ForkCommand::Inspect {
            fork_id,
            app_root,
            fork_root: requested_root,
            format,
        } => {
            let app_root = std::fs::canonicalize(app_root)?;
            let root = fork_root(&app_root, requested_root)?;
            let target = crate::instance_fork::managed_target(&root, &fork_id)?;
            let (process_health, mut diagnostics, server_url) = fork_process_health(&target);
            let diff_database = target.database.clone();
            let diff_summary = match startup_blocking(|| {
                crate::instance_fork::diff_receipt(&diff_database)
            }) {
                Ok(receipt) => json!({
                    "schemaVersion": "snapback.fork-diff-summary.v1",
                    "available": true,
                    "attributedRowCount": receipt.rows.len(),
                    "tableCounts": receipt.table_counts,
                    "observedHeadVersion": receipt.observed_head_version,
                    "coverage": receipt.coverage,
                    "omissions": receipt.omissions,
                }),
                Err(error) => {
                    diagnostics.push(error.diagnostic);
                    json!({
                        "schemaVersion": "snapback.fork-diff-summary.v1",
                        "available": false,
                    })
                }
            };
            let ready_path = target
                .ready_file
                .as_deref()
                .map(|path| path.display().to_string());
            let admin_token_path = crate::admin::admin_token_sibling(&target.database);
            let status = json!({
                "schemaVersion": "snapback.fork-status.v1",
                "forkId": target.entry.lineage.fork_id,
                "parentInstanceId": target.entry.lineage.parent_instance_id,
                "parentIdentityKind": "recorded-source-provenance",
                "appId": target.entry.lineage.app_id,
                "forkPointVersion": target.entry.lineage.fork_point_version,
                "createdAtMs": target.entry.lineage.created_at_ms,
                "expiresAtMs": target.entry.lineage.expires_at_ms,
                "processHealth": process_health,
                "databasePath": target.database,
                "readyPath": target.ready_file,
                "adminTokenPath": admin_token_path,
                "secretDisposition": managed_fork_secret_disposition(&target),
                "workerPosture": {
                    "cron": "inert",
                    "jobs": "inert",
                    "assets": "inert",
                },
                "egressPosture": "deny-all-v1",
                "assetCustody": fork_asset_custody(&target.destination),
                "diffSummary": diff_summary,
            });
            let envelope = fork_envelope_with_diagnostics(
                "fork.inspect",
                target.entry.lineage.app_id.clone(),
                Some(&app_root),
                server_url.clone(),
                json!({ "status": status }),
                diagnostics,
            );
            let scalars = ForkProjectionScalars {
                url: server_url,
                fork_id: Some(fork_id),
                database_path: Some(target.database.display().to_string()),
                ready_path,
                admin_token_path: Some(admin_token_path.display().to_string()),
            };
            print_fork_projection(format, &envelope, &scalars)
        }
        ForkCommand::Diff {
            fork_id,
            app_root,
            fork_root: requested_root,
            out,
            max_rows,
            net,
        } => {
            let app_root = std::fs::canonicalize(app_root)?;
            let root = fork_root(&app_root, requested_root)?;
            let target = crate::instance_fork::managed_target(&root, &fork_id)?;
            let receipt = if net {
                let receipt = startup_blocking(|| {
                    crate::instance_fork::net_diff_receipt(&target.database, max_rows)
                })?;
                serde_json::to_value(receipt)?
            } else {
                let receipt = startup_blocking(|| {
                    crate::instance_fork::diff_receipt_bounded(&target.database, max_rows)
                })?;
                serde_json::to_value(receipt)?
            };
            if let Some(path) = out.as_ref() {
                std::fs::write(path, serde_json::to_vec_pretty(&receipt)?)?;
            }
            let envelope = fork_envelope(
                "fork.diff",
                target.entry.lineage.app_id,
                Some(&app_root),
                None,
                json!({ "receipt": receipt, "writtenTo": out }),
            );
            print_envelope(&serde_json::to_value(envelope)?);
            Ok(())
        }
        ForkCommand::Drop {
            fork_id,
            app_root,
            fork_root: requested_root,
        } => {
            let app_root = std::fs::canonicalize(app_root)?;
            let root = fork_root(&app_root, requested_root)?;
            let lock = crate::instance_fork::lock_cleanup(&root, &fork_id)?;
            let target = crate::instance_fork::managed_target(&root, &fork_id)?;
            let stopped_pid = target
                .ready_file
                .as_deref()
                .map(|ready| quiet_stop_fork(ready, &target.database))
                .transpose()?
                .flatten();
            crate::instance_fork::drop_managed_locked(&root, &fork_id)?;
            lock.dispose();
            let envelope = fork_envelope(
                "fork.drop",
                target.entry.lineage.app_id,
                Some(&app_root),
                None,
                json!({ "forkId": fork_id, "stoppedPid": stopped_pid, "dropped": true }),
            );
            print_envelope(&serde_json::to_value(envelope)?);
            Ok(())
        }
        ForkCommand::Renew {
            fork_id,
            ttl,
            app_root,
            fork_root: requested_root,
        } => {
            let app_root = std::fs::canonicalize(app_root)?;
            let root = fork_root(&app_root, requested_root)?;
            let ttl_ms = parse_fork_ttl(&ttl)?;
            let renewed_at_ms = clock();
            let receipt = startup_blocking(|| {
                crate::instance_fork::renew_managed(&root, &fork_id, renewed_at_ms, ttl_ms)
            })?;
            let entry = crate::instance_fork::managed_entry(&root, &fork_id)?;
            let envelope = fork_envelope(
                "fork.renew",
                entry.lineage.app_id.clone(),
                Some(&app_root),
                None,
                json!({ "receipt": receipt, "registry": entry }),
            );
            print_envelope(&serde_json::to_value(envelope)?);
            Ok(())
        }
        ForkCommand::Reap {
            now_ms,
            app_root,
            fork_root: requested_root,
        } => {
            let app_root = std::fs::canonicalize(app_root)?;
            let root = fork_root(&app_root, requested_root)?;
            anyhow::ensure!(
                now_ms <= crate::manifest::PORTABLE_TIMESTAMP_MAX_MS,
                "SNAPBACK_FORK_REAP_CLOCK_INVALID: reap clock exceeds the portable timestamp range"
            );
            let outcome = reap_managed_forks(&root, now_ms)?;
            let receipt = crate::instance_fork::ForkReapReceiptV1 {
                schema_version: "snapback.fork-reap.v1".to_owned(),
                now_ms,
                reaped_fork_ids: outcome.reaped,
            };
            let envelope = fork_envelope(
                "fork.reap",
                "unknown".to_owned(),
                Some(&app_root),
                None,
                json!({
                    "receipt": receipt,
                    "clearedStaleRegistryIds": outcome.cleared_stale_registry,
                }),
            );
            print_envelope(&serde_json::to_value(envelope)?);
            Ok(())
        }
        ForkCommand::Recover {
            destination,
            app_root,
            fork_root: requested_root,
        } => {
            let app_root = std::fs::canonicalize(app_root)?;
            let root = fork_root(&app_root, requested_root)?;
            let destination = resolve_fork_destination(&root, destination)?;
            let was_partial = destination.join(crate::instance_fork::STAGING_SENTINEL).is_file();
            // A published directory, partial or complete, must carry a finite
            // product lineage. Pre-publication staging is safe to reap without
            // granting it serving authority.
            if destination.is_dir() {
                let receipt: crate::instance_fork::ForkMintReceiptV1 = serde_json::from_slice(
                    &std::fs::read(destination.join(crate::instance_fork::MINT_RECEIPT_FILE))
                        .context(
                            "SNAPBACK_FORK_EVIDENCE_INCOMPLETE: partial publication has no mint receipt",
                        )?,
                )
                .context("SNAPBACK_FORK_RECEIPT_INVALID: recovery receipt is malformed")?;
                anyhow::ensure!(
                    receipt.lineage.expires_at_ms.is_some(),
                    "SNAPBACK_FORK_TTL_INVALID: product recovery refuses an unbounded derived fork"
                );
            }
            let recover_root = root.clone();
            let recover_destination = destination.clone();
            startup_blocking(|| {
                crate::instance_fork::recover(&recover_root, &recover_destination)
            })?;

            let receipt = if destination.is_dir() {
                serde_json::from_slice::<crate::instance_fork::ForkMintReceiptV1>(
                    &std::fs::read(destination.join(crate::instance_fork::MINT_RECEIPT_FILE))
                        .context(
                            "SNAPBACK_FORK_EVIDENCE_INCOMPLETE: recovered destination has no mint receipt",
                        )?,
                )
                .context("SNAPBACK_FORK_RECEIPT_INVALID: recovered mint receipt is malformed")?
                .into()
            } else {
                None
            };
            let registry = receipt.as_ref().and_then(|receipt| {
                crate::instance_fork::managed_entry(&root, &receipt.lineage.fork_id).ok()
            });
            let disposition = match (was_partial, destination.exists()) {
                (true, true) => "published-recovered",
                (false, true) => "already-published",
                (_, false) => "unpublished-staging-reaped-or-absent",
            };
            let app_id = receipt
                .as_ref()
                .map(|receipt| receipt.lineage.app_id.clone())
                .unwrap_or_else(|| "unknown".to_owned());
            let fork_id = receipt
                .as_ref()
                .map(|receipt| receipt.lineage.fork_id.clone());
            let envelope = fork_envelope(
                "fork.recover",
                app_id,
                Some(&app_root),
                None,
                json!({
                    "forkRoot": root,
                    "destination": destination,
                    "disposition": disposition,
                    "forkId": fork_id,
                    "registry": registry,
                }),
            );
            print_envelope(&serde_json::to_value(envelope)?);
            Ok(())
        }
    }
}

fn reject_misdirected_serve_flags(cli: &Cli) -> anyhow::Result<()> {
    if cli.command.is_some() && cli.serve != Args::default() {
        anyhow::bail!(
            "serve flags before a subcommand are ignored; pass them after `start` (for example: `snapback start --memory`)"
        );
    }
    Ok(())
}

fn parse_run_args(args: Option<String>) -> anyhow::Result<Value> {
    let parsed = match args {
        Some(raw) => serde_json::from_str(&raw).context("--args must be a JSON object")?,
        None => Value::Object(Default::default()),
    };
    if !parsed.is_object() {
        anyhow::bail!("--args must be a JSON object");
    }
    Ok(parsed)
}

fn parse_network_profile_selection(raw: &str) -> anyhow::Result<Value> {
    let trimmed = raw.trim();
    anyhow::ensure!(
        !trimmed.is_empty(),
        "network profile selection must not be empty"
    );
    if trimmed.starts_with('{') || trimmed.starts_with('"') {
        serde_json::from_str(trimmed).context("network profile selection is not valid JSON")
    } else {
        Ok(Value::String(trimmed.to_owned()))
    }
}

fn read_json_file(path: &Path) -> anyhow::Result<Value> {
    let raw = std::fs::read_to_string(path)
        .with_context(|| format!("failed to read {}", path.display()))?;
    serde_json::from_str(&raw).with_context(|| format!("{} is not valid JSON", path.display()))
}

fn prepare_composition_activation_source(
    database_path: &Path,
    generated_dir: &Path,
    deployment_id: &str,
) -> anyhow::Result<()> {
    anyhow::ensure!(
        !deployment_id.is_empty(),
        "--deployment-id must be nonempty"
    );
    let schema: crate::manifest::SchemaManifest =
        serde_json::from_slice(&std::fs::read(generated_dir.join("schema.manifest.json"))?)?;
    let functions: crate::manifest::FunctionManifest = serde_json::from_slice(&std::fs::read(
        generated_dir.join("functions.manifest.json"),
    )?)?;
    schema.validate_artifact()?;
    functions.validate_artifact()?;
    anyhow::ensure!(
        schema.app_id == functions.app_id && schema.inputs_hash == functions.inputs_hash,
        "generated schema/functions are not one coherent artifact pair"
    );
    let expected_generation = crate::manifest::ArtifactGeneration {
        schema_version: schema.schema_version.clone(),
        app_id: schema.app_id.clone(),
        schema_hash: schema
            .schema_hash
            .clone()
            .context("generated schema has no schemaHash")?,
        bundle_hash: functions
            .bundle_hash
            .clone()
            .context("generated functions have no bundleHash")?,
        inputs_hash: schema
            .inputs_hash
            .clone()
            .context("generated pair has no inputsHash")?,
    };
    let mut database = crate::storage::LocalDatabase::open(database_path)?;
    let database_id = database.data_version_stream()?;
    let keyring = crate::completeness::ProofKeyring::load_or_create(
        database_path.with_file_name(crate::completeness::PROOF_KEYRING_FILE_NAME),
        crate::server::now_millis(),
    )?;
    let artifact = crate::completeness::TrustedCompositionActivationV1::prepare(
        database_id,
        deployment_id,
        schema
            .target_profile
            .clone()
            .unwrap_or_else(|| crate::manifest::TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned()),
        match schema.effective_auth_mode() {
            crate::manifest::AuthMode::Dev => "dev",
            crate::manifest::AuthMode::Sessions => "sessions",
        },
        expected_generation,
        keyring.manifest(),
    )?;
    let backend_dir = generated_dir.parent().context(
        "--generated must name the generated output directory beneath a backend directory",
    )?;
    let source_path =
        backend_dir.join(crate::completeness::TRUSTED_COMPOSITION_ACTIVATION_FILE_NAME);
    std::fs::write(
        &source_path,
        format!("{}\n", serde_json::to_string_pretty(&artifact)?),
    )?;
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "format": "snapback.composition-activation-preparation.v1",
            "source": source_path,
            "activationHash": artifact.activation_hash,
            "next": "rerun Snapback codegen for this backend",
        }))?
    );
    Ok(())
}

fn read_trusted_json_file(path: &Path) -> anyhow::Result<Value> {
    let raw = crate::secure_file::read_owner_only(path)
        .with_context(|| format!("failed to read trusted local file {}", path.display()))?;
    let raw =
        String::from_utf8(raw).with_context(|| format!("{} is not valid UTF-8", path.display()))?;
    serde_json::from_str(&raw).with_context(|| format!("{} is not valid JSON", path.display()))
}

fn emit_impersonation_capability_to_writer(
    operator: crate::admin_impersonation::ImpersonationOperator,
    writer: &mut impl std::io::Write,
) -> std::io::Result<()> {
    operator.emit_once_to_terminal(|bearer| {
        writer.write_all(b"impersonation capability: ")?;
        writer.write_all(bearer.as_bytes())?;
        writer.write_all(b"\n")?;
        writer.flush()
    })
}

/// No-ready-file fallback. Write the process bearer directly to the
/// controlling terminal: never stdout/stderr, tracing, or a generic inherited
/// file descriptor that a launcher may capture into logs.
#[cfg(unix)]
fn emit_impersonation_capability_to_controlling_terminal(
    operator: crate::admin_impersonation::ImpersonationOperator,
) -> std::io::Result<()> {
    use std::os::unix::fs::{FileTypeExt as _, OpenOptionsExt as _};

    let mut terminal = std::fs::OpenOptions::new()
        .write(true)
        .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW)
        .open("/dev/tty")?;
    if !terminal.metadata()?.file_type().is_char_device() {
        return Err(std::io::Error::new(
            ErrorKind::PermissionDenied,
            "controlling-terminal capability is not a character device",
        ));
    }
    emit_impersonation_capability_to_writer(operator, &mut terminal)
}

#[cfg(not(unix))]
fn emit_impersonation_capability_to_controlling_terminal(
    _operator: crate::admin_impersonation::ImpersonationOperator,
) -> std::io::Result<()> {
    Err(std::io::Error::new(
        ErrorKind::Unsupported,
        "direct controlling-terminal capability emission is unavailable on this host",
    ))
}

#[cfg(unix)]
fn controlling_terminal_available() -> bool {
    use std::os::unix::fs::{FileTypeExt as _, OpenOptionsExt as _};

    std::fs::OpenOptions::new()
        .write(true)
        .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW)
        .open("/dev/tty")
        .and_then(|terminal| terminal.metadata())
        .is_ok_and(|metadata| metadata.file_type().is_char_device())
}

#[cfg(not(unix))]
fn controlling_terminal_available() -> bool {
    false
}

fn ready_descriptor_required_error() -> crate::diagnostic::SnapbackError {
    crate::diagnostic::SnapbackError::error(
        "SNAPBACK_READY_DESCRIPTOR_REQUIRED",
        "server-lifecycle",
        "a detached server start requires --ready-file so process-bound capabilities have an owner-only handoff",
    )
    .with_details(json!({
        "next": [{
            "command": "snapback start --ready-file <owner-only-path> ..."
        }]
    }))
}

struct ResolvedHttpTarget {
    server_url: String,
    minted_token: Option<String>,
    impersonation_capability: Option<crate::auth::crypto::ImpersonationBearer>,
}

impl std::fmt::Debug for ResolvedHttpTarget {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ResolvedHttpTarget")
            .field("server_url", &self.server_url)
            .field(
                "minted_token",
                &self.minted_token.as_ref().map(|_| "[REDACTED]"),
            )
            .field(
                "impersonation_capability",
                &self.impersonation_capability.as_ref().map(|_| "[REDACTED]"),
            )
            .finish()
    }
}

#[cfg(test)]
fn resolve_http_target(target: &TargetArgs) -> anyhow::Result<ResolvedHttpTarget> {
    resolve_http_target_for_operation(target, false)
}

fn resolve_http_target_for_operation(
    target: &TargetArgs,
    requires_impersonation: bool,
) -> anyhow::Result<ResolvedHttpTarget> {
    if let Some(url) = &target.url {
        let impersonation_capability =
            if requires_impersonation && target.impersonation_capability_stdin {
                Some(read_impersonation_capability_from_stdin()?)
            } else {
                None
            };
        return Ok(ResolvedHttpTarget {
            server_url: url.trim_end_matches('/').to_owned(),
            minted_token: None,
            // A URL never selects a local capability file. The only explicit
            // no-ready-file carrier is the bounded stdin channel above.
            impersonation_capability,
        });
    }
    if let Some(path) = &target.ready_file {
        // Pin the existing parent before reading any bytes. The descriptor,
        // token, and impersonation sibling below are all opened relative to
        // this one directory capability, so swapping a symlinked parent after
        // the health check cannot splice a different local secret into the
        // already-validated descriptor snapshot.
        let ready_target = ReadyFileTarget::open_existing(path)?;
        let canonical_ready = ready_target.pinned_path().to_path_buf();
        let descriptor_bytes = ready_target
            .read_owner_only_sibling(&canonical_ready)
            .with_context(|| format!("failed to read trusted ready file {}", path.display()))?;
        let value: Value = serde_json::from_slice(&descriptor_bytes)
            .with_context(|| format!("{} is not valid JSON", path.display()))?;
        let descriptor = HostReadyDescriptor::validate(&value).map_err(|problems| {
            anyhow::anyhow!(
                "{} is not a valid readiness descriptor: {}",
                path.display(),
                problems.join("; ")
            )
        })?;
        let impersonation_capability = if requires_impersonation {
            let health = fetch_health(&descriptor.server_url);
            verify_live_descriptor_identity(&descriptor, &health, "auth impersonation").map_err(
                |diagnostic| anyhow::anyhow!("{}: {}", diagnostic.code, diagnostic.message),
            )?;
            let advertised = descriptor
                .impersonation_capability_file
                .as_deref()
                .map(Path::new)
                .context("readiness descriptor has no impersonationCapabilityFile")?;
            let sidecar = crate::admin_impersonation::validate_impersonation_capability_path(
                &canonical_ready,
                advertised,
            )?;
            let bytes = ready_target
                .read_strict_owner_only_sibling(
                    &sidecar,
                    crate::admin_impersonation::MAX_IMPERSONATION_CAPABILITY_FILE_BYTES,
                )
                .with_context(|| {
                    format!(
                        "failed to read owner-only impersonation capability {}",
                        sidecar.display()
                    )
                })?;
            Some(
                crate::admin_impersonation::parse_impersonation_capability_file(
                    zeroize::Zeroizing::new(bytes),
                )
                .map_err(anyhow::Error::new)?,
            )
        } else {
            None
        };
        // For capability-bearing operations the branch above has verified the
        // live startup nonce before either local sibling is read. Ordinary
        // host operations retain the established ready-file admin-token flow.
        let minted_token =
            discover_minted_token_pinned(&ready_target, &canonical_ready, &descriptor);
        return Ok(ResolvedHttpTarget {
            server_url: descriptor.server_url.trim_end_matches('/').to_owned(),
            minted_token,
            impersonation_capability,
        });
    }
    anyhow::bail!("no target: pass --url or --ready-file")
}

fn read_impersonation_capability_from_stdin()
-> anyhow::Result<crate::auth::crypto::ImpersonationBearer> {
    use std::io::Read as _;
    use zeroize::{Zeroize as _, Zeroizing};

    let mut bytes = Vec::new();
    std::io::stdin().take(513).read_to_end(&mut bytes)?;
    if bytes.len() > 512 {
        bytes.zeroize();
        anyhow::bail!("impersonation capability stdin value is too large");
    }
    while matches!(bytes.last(), Some(b'\n' | b'\r')) {
        bytes.pop();
    }
    let value = Zeroizing::new(
        String::from_utf8(bytes)
            .map_err(|_| anyhow::anyhow!("impersonation capability stdin value is not UTF-8"))?,
    );
    crate::auth::crypto::ImpersonationBearer::parse(&value)
        .map_err(|_| anyhow::anyhow!("impersonation capability stdin value is invalid"))
}

/// Derive capability attachment from the same registered operation metadata
/// the server gate consumes. Merely possessing or advertising the sidecar can
/// never add the header to an ordinary/browser-compatible request.
fn request_requires_impersonation(request: &Value) -> bool {
    let Some(operation) = request.get("operation").and_then(Value::as_str) else {
        return false;
    };
    let impersonated = request
        .get("userId")
        .and_then(Value::as_str)
        .is_some_and(|user_id| !user_id.is_empty());
    crate::server::host_ops_operation_spec(operation, None, impersonated).is_some_and(|spec| {
        [
            crate::server::PolicyAuthMode::Dev,
            crate::server::PolicyAuthMode::Sessions,
        ]
        .into_iter()
        .any(|mode| {
            spec.effective_for(mode).effect_policy
                == crate::server::EffectPolicy::ImpersonationCapability
        })
    })
}

// @ref LLP 0176#g0--baseline-truth-and-mechanical-repair — this CLI primitive
// is only a closed-argument projection of the existing auth.mintSession host-op.
fn mint_session_request(email: String) -> Value {
    json!({ "operation": "auth.mintSession", "args": { "email": email } })
}

/// POST one host operation and project the envelope to stdout + exit code
/// (`ok: false` → exit 1) per LLP 0024's transport-projection rule.
fn host_op_via_http(target: &TargetArgs, request: Value) -> anyhow::Result<()> {
    let envelope = post_host_op(target, request)?;
    if !print_envelope(&envelope) {
        std::process::exit(1);
    }
    Ok(())
}

fn post_host_op(target: &TargetArgs, request: Value) -> anyhow::Result<Value> {
    // Resolve the URL and optional local capability from one validated
    // descriptor snapshot. Reading the path once for the URL and again for the
    // token would let a rename between reads combine an attacker's URL with a
    // trusted descriptor's token handoff (ENG-24338).
    let requires_impersonation = request_requires_impersonation(&request);
    let resolved = resolve_http_target_for_operation(target, requires_impersonation)?;
    let token = target
        .token
        .clone()
        .or_else(|| std::env::var("SNAPBACK_ADMIN_TOKEN").ok())
        .filter(|token| !token.is_empty())
        .or(resolved.minted_token);
    let mut http = ureq::post(&format!("{}/_snapback/api/host-ops", resolved.server_url));
    if let Some(token) = token.filter(|token| !token.is_empty()) {
        http = http.set("x-snapback-admin-token", &token);
    }
    if requires_impersonation && let Some(capability) = resolved.impersonation_capability.as_ref() {
        http = http.set(
            crate::admin_impersonation::IMPERSONATION_CAPABILITY_HEADER,
            capability.expose_secret(),
        );
    }
    match http.send_json(request) {
        Ok(response) => Ok(response
            .into_json()
            .context("host-ops response was not JSON")?),
        // A gated/refused call returns the structured ApiError body — surface
        // it verbatim rather than as a transport error.
        Err(ureq::Error::Status(_status, response)) => Ok(response
            .into_json()
            .context("host-ops error response was not JSON")?),
        Err(error) => Err(error).context("host-ops request failed"),
    }
}

fn telemetry_secret_read_lease(
    target: &TargetArgs,
    explicit: Option<String>,
    scope: SecretReadScope,
    row_budget: u64,
    byte_budget: u64,
) -> anyhow::Result<String> {
    if let Some(lease) = explicit.filter(|lease| !lease.trim().is_empty()) {
        return Ok(lease);
    }
    let ready_file = target.ready_file.as_deref().context(
        "raw telemetry reads require --ready-file for automatic scoped lease minting or --secret-read-lease",
    )?;
    let response = mint_secret_read_via_http(
        ready_file,
        target.token.clone(),
        SecretReadMintSpec {
            scopes: std::collections::BTreeSet::from([scope]),
            ttl_ms: 60_000,
            row_budget,
            byte_budget,
        },
    )?;
    response
        .get("lease")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .context("secret-read mint response carried no lease")
}

fn telemetry_get(
    target: &TargetArgs,
    path: &str,
    query: Vec<(&'static str, String)>,
    secret_read_lease: Option<&str>,
) -> anyhow::Result<ureq::Response> {
    let resolved = resolve_http_target_for_operation(target, false)?;
    let token = target
        .token
        .clone()
        .or_else(|| std::env::var("SNAPBACK_ADMIN_TOKEN").ok())
        .filter(|token| !token.is_empty())
        .or(resolved.minted_token);
    let mut request = ureq::get(&format!("{}{path}", resolved.server_url));
    for (key, value) in &query {
        request = request.query(key, value);
    }
    if let Some(token) = token {
        request = request.set("x-snapback-admin-token", &token);
    }
    if let Some(lease) = secret_read_lease {
        request = request.set(crate::admin_secret_read::SECRET_READ_LEASE_HEADER, lease);
    }
    match request.call() {
        Ok(response) => Ok(response),
        Err(ureq::Error::Status(status, response)) => {
            let body = response
                .into_string()
                .unwrap_or_else(|_| "<unreadable response>".to_owned());
            anyhow::bail!("telemetry request failed with HTTP {status}: {body}")
        }
        Err(error) => Err(error).context("telemetry request failed"),
    }
}

fn telemetry_json_get(
    target: &TargetArgs,
    path: &str,
    query: Vec<(&'static str, String)>,
    secret_read_lease: Option<&str>,
) -> anyhow::Result<Value> {
    telemetry_get(target, path, query, secret_read_lease)?
        .into_json()
        .context("telemetry response was not JSON")
}

fn telemetry_command(command: TelemetryCommand) -> anyhow::Result<()> {
    match command {
        TelemetryCommand::Stats { target, filter } => {
            anyhow::ensure!(
                filter.status.is_none()
                    && filter.code.is_none()
                    && filter.correlation.is_none()
                    && filter.text.is_none(),
                "telemetry stats supports only --kind, --name, --from-ms, and --to-ms"
            );
            let response = telemetry_json_get(
                &target,
                "/_snapback/api/telemetry/stats",
                filter.query_pairs(true),
                None,
            )?;
            println!("{}", serde_json::to_string_pretty(&response)?);
            Ok(())
        }
        TelemetryCommand::Events {
            target,
            filter,
            cursor_recorded_ts_ms,
            cursor_id,
            order,
            limit,
            secret_read_lease,
        } => {
            let lease = telemetry_secret_read_lease(
                &target,
                secret_read_lease,
                SecretReadScope::TelemetryEvents,
                u64::try_from(limit).unwrap_or(u64::MAX),
                4 * 1024 * 1024,
            )?;
            let mut query = filter.query_pairs(false);
            if let Some(value) = cursor_recorded_ts_ms {
                query.push(("cursorRecordedTsMs", value.to_string()));
            }
            if let Some(value) = cursor_id {
                query.push(("cursorId", value.to_string()));
            }
            query.push(("order", order));
            query.push(("limit", limit.to_string()));
            let response = telemetry_json_get(
                &target,
                "/_snapback/api/telemetry/events",
                query,
                Some(&lease),
            )?;
            println!("{}", serde_json::to_string_pretty(&response)?);
            Ok(())
        }
        TelemetryCommand::Export {
            target,
            filter,
            secret_read_lease,
        } => {
            let lease = telemetry_secret_read_lease(
                &target,
                secret_read_lease,
                SecretReadScope::TelemetryExport,
                100_000,
                64 * 1024 * 1024,
            )?;
            let response = telemetry_get(
                &target,
                "/_snapback/api/telemetry/export",
                filter.query_pairs(false),
                Some(&lease),
            )?;
            anyhow::ensure!(
                response
                    .header("content-type")
                    .is_some_and(|value| value.starts_with("application/x-ndjson")),
                "telemetry export response was not NDJSON"
            );
            let mut reader = response.into_reader();
            let mut stdout = std::io::stdout().lock();
            std::io::copy(&mut reader, &mut stdout)?;
            Ok(())
        }
        TelemetryCommand::Query {
            sql,
            db,
            max_rows,
            max_steps,
            max_time_ms,
            max_bytes,
        } => {
            let response = crate::telemetry_query::query_local_sql(
                &crate::telemetry::Telemetry::path_for_database(&db),
                &sql,
                crate::telemetry_query::TelemetrySqlBudgetV1 {
                    max_rows,
                    max_steps,
                    max_time_ms,
                    max_bytes,
                },
            )?;
            println!("{}", serde_json::to_string_pretty(&response)?);
            Ok(())
        }
    }
}

/// Generic admin GET, reusing the telemetry transport helper (it is not
/// telemetry-specific: any admin-authenticated JSON GET fits it).
fn admin_json_get(
    target: &TargetArgs,
    path: &str,
    query: Vec<(&'static str, String)>,
) -> anyhow::Result<Value> {
    telemetry_json_get(target, path, query, None)
}

/// Generic admin POST for the non-secret-carrying config/jobs family below.
/// `config.set` is intentionally not routed through this helper — it needs
/// the stdin/fd secret carrier LLP 0036 owns, not this JSON-body shape.
fn admin_json_post(target: &TargetArgs, path: &str, value: Value) -> anyhow::Result<Value> {
    let resolved = resolve_http_target_for_operation(target, false)?;
    let token = target
        .token
        .clone()
        .or_else(|| std::env::var("SNAPBACK_ADMIN_TOKEN").ok())
        .filter(|token| !token.is_empty())
        .or(resolved.minted_token);
    let mut request = ureq::post(&format!("{}{path}", resolved.server_url));
    if let Some(token) = token {
        request = request.set("x-snapback-admin-token", &token);
    }
    match request.send_json(value) {
        Ok(response) => response.into_json().context("response was not JSON"),
        Err(ureq::Error::Status(status, response)) => {
            let body = response
                .into_string()
                .unwrap_or_else(|_| "<unreadable response>".to_owned());
            anyhow::bail!("request to {path} failed with HTTP {status}: {body}")
        }
        Err(error) => Err(error).context(format!("request to {path} failed")),
    }
}

/// data.scan — LLP 0184 P1: a bounded, as-shipped projection of `DataQuery`
/// (table/limit/offset, no cursor). Mirrors telemetry's automatic scoped
/// secret-read lease minting; a Dev-policy server does not require the lease
/// today (only Sessions-policy does), but minting it unconditionally keeps
/// one code path correct under both policies rather than special-casing.
fn data_command(command: DataCommand) -> anyhow::Result<()> {
    match command {
        DataCommand::Scan {
            target,
            table,
            limit,
            offset,
            secret_read_lease,
        } => {
            let lease = telemetry_secret_read_lease(
                &target,
                secret_read_lease,
                SecretReadScope::Table(table.clone()),
                u64::try_from(limit).unwrap_or(u64::MAX),
                4 * 1024 * 1024,
            )?;
            let response = telemetry_json_get(
                &target,
                &format!("/_snapback/api/data/{table}"),
                vec![("limit", limit.to_string()), ("offset", offset.to_string())],
                Some(&lease),
            )?;
            println!("{}", serde_json::to_string_pretty(&response)?);
            Ok(())
        }
    }
}

/// config.status / config.plan / config.verify — LLP 0036-owned operations,
/// non-secret projections only (LLP 0184 §P3: `config.set`/`config.unset`
/// are a separate, not-yet-landed slice).
fn config_command(command: ConfigCommand) -> anyhow::Result<()> {
    match command {
        ConfigCommand::Status { target } => {
            let response = admin_json_get(&target, "/_snapback/api/config/status", Vec::new())?;
            println!("{}", serde_json::to_string_pretty(&response)?);
            Ok(())
        }
        ConfigCommand::Plan { target, entry } => {
            let mut query = Vec::new();
            if let Some(entry) = entry {
                query.push(("entry", entry));
            }
            let response = admin_json_get(&target, "/_snapback/api/config/plan", query)?;
            println!("{}", serde_json::to_string_pretty(&response)?);
            Ok(())
        }
        ConfigCommand::Verify { target, entry } => {
            let response = admin_json_post(
                &target,
                "/_snapback/api/config/verify",
                json!({ "entry": entry }),
            )?;
            println!("{}", serde_json::to_string_pretty(&response)?);
            Ok(())
        }
    }
}

/// jobs.list / jobs.show — read-only one-off job inspection (LLP 0184 P1).
/// Draining is a separate, mutating operation out of this slice's scope.
fn jobs_command(command: JobsCommand) -> anyhow::Result<()> {
    match command {
        JobsCommand::List { target } => {
            let response = admin_json_get(&target, "/_snapback/api/jobs", Vec::new())?;
            println!("{}", serde_json::to_string_pretty(&response)?);
            Ok(())
        }
        JobsCommand::Show { target, id } => {
            let response = admin_json_get(&target, &format!("/_snapback/api/jobs/{id}"), Vec::new())?;
            println!("{}", serde_json::to_string_pretty(&response)?);
            Ok(())
        }
    }
}

fn errors_json_post(target: &TargetArgs, value: Value) -> anyhow::Result<Value> {
    let resolved = resolve_http_target_for_operation(target, false)?;
    let token = target
        .token
        .clone()
        .or_else(|| std::env::var("SNAPBACK_ADMIN_TOKEN").ok())
        .filter(|token| !token.is_empty())
        .or(resolved.minted_token);
    let mut request = ureq::post(&format!(
        "{}/_snapback/api/errors/transition",
        resolved.server_url
    ));
    if let Some(token) = token {
        request = request.set("x-snapback-admin-token", &token);
    }
    match request.send_json(value) {
        Ok(response) => response
            .into_json()
            .context("errors transition response was not JSON"),
        Err(ureq::Error::Status(status, response)) => {
            let body = response
                .into_string()
                .unwrap_or_else(|_| "<unreadable response>".to_owned());
            anyhow::bail!("errors transition failed with HTTP {status}: {body}")
        }
        Err(error) => Err(error).context("errors transition request failed"),
    }
}

fn errors_command(command: ErrorsCommand) -> anyhow::Result<()> {
    match command {
        ErrorsCommand::Issues {
            target,
            state,
            kind,
            name,
            subsystem,
            failure_disposition,
            release,
            mut since,
            from_ms,
            to_ms,
            order,
            cursor,
            limit,
        } => {
            let mut query = Vec::new();
            for (key, value) in [
                ("state", state),
                ("kind", kind),
                ("name", name),
                ("subsystem", subsystem),
                ("failureDisposition", failure_disposition),
                ("release", release),
            ] {
                if let Some(value) = value {
                    query.push((key, value));
                }
            }
            if let Some(value) = from_ms {
                query.push(("fromMs", value.to_string()));
            }
            if let Some(value) = to_ms {
                query.push(("toMs", value.to_string()));
            }
            if let Some(value) = cursor {
                query.push(("cursor", value));
            }
            query.push((
                "order",
                if order == "last-seen" {
                    "lastSeen"
                } else {
                    "count"
                }
                .to_owned(),
            ));
            query.push(("limit", limit.to_string()));

            // The CLI's default view is the newest retained release. Resolve
            // that name from the typed response rather than an ambient deploy
            // variable so activation pruning still fails honestly.
            if since.is_none() {
                let releases = telemetry_json_get(
                    &target,
                    "/_snapback/api/errors/issues",
                    vec![("limit", "1".to_owned())],
                    None,
                )?;
                since = releases
                    .get("knownReleases")
                    .and_then(Value::as_array)
                    .and_then(|releases| releases.last())
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned);
            }
            if let Some(since) = since {
                query.push(("since", since));
            }
            let response =
                telemetry_json_get(&target, "/_snapback/api/errors/issues", query, None)?;
            println!("{}", serde_json::to_string_pretty(&response)?);
            Ok(())
        }
        ErrorsCommand::Issue {
            target,
            issue,
            secret_read_lease,
        } => {
            let lease = telemetry_secret_read_lease(
                &target,
                secret_read_lease,
                SecretReadScope::ErrorsIssue,
                1_000,
                4 * 1024 * 1024,
            )?;
            let response = telemetry_json_get(
                &target,
                "/_snapback/api/errors/issue",
                vec![("issue", issue)],
                Some(&lease),
            )?;
            println!("{}", serde_json::to_string_pretty(&response)?);
            Ok(())
        }
        ErrorsCommand::Transition {
            target,
            issue,
            to,
            expect_seq,
        } => {
            let response = errors_json_post(
                &target,
                json!({ "issue": issue, "to": to, "expectSeq": expect_seq }),
            )?;
            println!("{}", serde_json::to_string_pretty(&response)?);
            Ok(())
        }
        ErrorsCommand::Resolve {
            target,
            open_before,
        } => {
            let response = errors_json_post(
                &target,
                json!({
                    "selector": { "openBefore": open_before },
                    "to": "resolved",
                }),
            )?;
            println!("{}", serde_json::to_string_pretty(&response)?);
            Ok(())
        }
    }
}

/// Minimal percent-encoding for one dynamic path segment (cron job names,
/// connection ids). No existing CLI helper in this module needed one before
/// these commands; this avoids pulling in a new dependency for two call
/// sites while still refusing to build an unescaped URL from caller input.
fn path_segment_escape(raw: &str) -> String {
    let mut escaped = String::with_capacity(raw.len());
    for byte in raw.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                escaped.push(byte as char);
            }
            _ => escaped.push_str(&format!("%{byte:02X}")),
        }
    }
    escaped
}

/// A generic admin-gated JSON POST, shared by the LLP 0184 §P2 typed
/// projections below (`config.unset`, `cron.tick`/`cron.runOne`,
/// `jobs.drain`). Mirrors `errors_json_post`'s token resolution exactly, one
/// level more generic (an arbitrary path instead of one hardcoded route).
fn admin_json_post(target: &TargetArgs, path: &str, value: Value) -> anyhow::Result<Value> {
    let resolved = resolve_http_target_for_operation(target, false)?;
    let token = target
        .token
        .clone()
        .or_else(|| std::env::var("SNAPBACK_ADMIN_TOKEN").ok())
        .filter(|token| !token.is_empty())
        .or(resolved.minted_token);
    let mut request = ureq::post(&format!("{}{path}", resolved.server_url));
    if let Some(token) = token {
        request = request.set("x-snapback-admin-token", &token);
    }
    match request.send_json(value) {
        Ok(response) => response
            .into_json()
            .with_context(|| format!("{path} response was not JSON")),
        Err(ureq::Error::Status(status, response)) => {
            let body = response
                .into_string()
                .unwrap_or_else(|_| "<unreadable response>".to_owned());
            anyhow::bail!("{path} failed with HTTP {status}: {body}")
        }
        Err(error) => Err(error).context(format!("{path} request failed")),
    }
}

/// The `connection.disconnect` sibling of `admin_json_post`: the route
/// returns `204 No Content` on success (no envelope to print), so this
/// reports only failure. LLP 0184 §P2: the route carries no request body
/// today, so `reason` is a client-recorded receipt field, not a
/// server-acknowledged one — the printed receipt says so.
fn admin_json_post_no_content(target: &TargetArgs, path: &str, value: Value) -> anyhow::Result<()> {
    let resolved = resolve_http_target_for_operation(target, false)?;
    let token = target
        .token
        .clone()
        .or_else(|| std::env::var("SNAPBACK_ADMIN_TOKEN").ok())
        .filter(|token| !token.is_empty())
        .or(resolved.minted_token);
    let mut request = ureq::post(&format!("{}{path}", resolved.server_url));
    if let Some(token) = token {
        request = request.set("x-snapback-admin-token", &token);
    }
    match request.send_json(value) {
        Ok(_response) => Ok(()),
        Err(ureq::Error::Status(status, response)) => {
            let body = response
                .into_string()
                .unwrap_or_else(|_| "<unreadable response>".to_owned());
            anyhow::bail!("{path} failed with HTTP {status}: {body}")
        }
        Err(error) => Err(error).context(format!("{path} request failed")),
    }
}

/// @ref LLP 0184#p2-controlled-mutations — `config.unset` direct CLI
/// projection; LLP 0036 pairs it with a 1:1 `snapback_config_unset` MCP tool
/// landed alongside (`packages/snapback-cli/mcp-control.mjs`).
fn config_command(command: ConfigCommand) -> anyhow::Result<()> {
    match command {
        ConfigCommand::Unset { target, entry } => {
            let response = admin_json_post(
                &target,
                "/_snapback/api/config/unset",
                json!({ "entry": entry, "source": "cli" }),
            )?;
            println!("{}", serde_json::to_string_pretty(&response)?);
            Ok(())
        }
    }
}

/// @ref LLP 0184#p2-controlled-mutations — `cron.tick`/`cron.runOne` direct
/// CLI projections of the existing admin-gated forced-dispatch routes.
fn cron_command(command: CronCommand) -> anyhow::Result<()> {
    match command {
        CronCommand::Tick { target } => {
            let response = admin_json_post(&target, "/_snapback/api/cron/tick", json!({}))?;
            println!("{}", serde_json::to_string_pretty(&response)?);
            Ok(())
        }
        CronCommand::Run { target, name } => {
            let path = format!("/_snapback/api/cron/{}/run", path_segment_escape(&name));
            let response = admin_json_post(&target, &path, json!({}))?;
            println!("{}", serde_json::to_string_pretty(&response)?);
            Ok(())
        }
    }
}

/// @ref LLP 0184#p2-controlled-mutations — `jobs.drain`'s direct CLI
/// projection; the injected `nowMs`/`maxWaves` fields are the same
/// deterministic seam `JobsDrainRequest` already accepts (`src/admin.rs`).
fn jobs_command(command: JobsCommand) -> anyhow::Result<()> {
    match command {
        JobsCommand::Drain {
            target,
            now_ms,
            max_waves,
        } => {
            let mut body = serde_json::Map::new();
            if let Some(now_ms) = now_ms {
                body.insert("nowMs".to_owned(), json!(now_ms));
            }
            if let Some(max_waves) = max_waves {
                body.insert("maxWaves".to_owned(), json!(max_waves));
            }
            let response =
                admin_json_post(&target, "/_snapback/api/jobs/drain", Value::Object(body))?;
            println!("{}", serde_json::to_string_pretty(&response)?);
            Ok(())
        }
    }
}

/// @ref LLP 0184#p2-controlled-mutations — `connection.disconnect` as an
/// explicit debug perturbation: the receipt this command prints is a client
/// record of `reason` and target, not a server-returned envelope, because
/// the underlying route (`src/admin.rs`'s `disconnect`) returns no body.
fn connections_command(command: ConnectionsCommand) -> anyhow::Result<()> {
    match command {
        ConnectionsCommand::Disconnect {
            target,
            connection_id,
            reason,
        } => {
            let path = format!(
                "/_snapback/api/connections/{}/disconnect",
                path_segment_escape(&connection_id)
            );
            admin_json_post_no_content(&target, &path, json!({ "reason": reason }))?;
            println!(
                "{}",
                serde_json::to_string_pretty(&json!({
                    "operation": "connection.disconnect",
                    "connectionId": connection_id,
                    "reason": reason,
                    "ok": true,
                }))?
            );
            Ok(())
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ConsoleCredentialCliResponse {
    credential: String,
    expires_at_ms: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ConsoleApprovalCliResponse {
    approved: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ConsoleClaimMintCliResponse {
    claim_code: String,
    expires_at_ms: u64,
    expires_in: u64,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ConsoleClaimStatusCliResponse {
    status: String,
    claim_expires_at_ms: Option<u64>,
    redeemed_at_ms: Option<u64>,
    transport_peer: Option<String>,
    transport_peer_source: Option<String>,
    credential_digest_sha256: Option<String>,
    credential_expires_at_ms: Option<u64>,
    credential_max_expires_at_ms: Option<u64>,
    revoked_at_ms: Option<u64>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ConsoleReachabilityLeaseCliResponse {
    session_id: String,
    instance_id: String,
    lease_expires_at_ms: u64,
    lease_interval_ms: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ConsoleReachabilityObservationCliResponse {
    claim: ConsoleClaimStatusCliResponse,
    lease: Option<ConsoleReachabilityLeaseCliResponse>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ConsoleReachabilityDropCliResponse {
    dropped: bool,
}

async fn admin_command(args: AdminArgs) -> anyhow::Result<()> {
    match args.command {
        Some(AdminCommand::Approve { code, target }) => approve_console_code(&target, &code),
        Some(AdminCommand::Link {
            target,
            no_wait,
            url_base,
            qr,
            tailscale,
            lan,
            status,
            revoke,
        }) => {
            admin_claim_link(AdminClaimLinkRequest {
                target,
                no_wait,
                url_base,
                qr,
                tailscale,
                lan,
                status,
                revoke,
            })
            .await
        }
        None => launch_admin_console(&args.target, args.no_open),
    }
}

struct AdminClaimLinkRequest {
    target: TargetArgs,
    no_wait: bool,
    url_base: Option<String>,
    qr: bool,
    tailscale: bool,
    lan: Option<String>,
    status: Option<String>,
    revoke: Option<String>,
}

async fn admin_claim_link(request: AdminClaimLinkRequest) -> anyhow::Result<()> {
    let AdminClaimLinkRequest {
        target,
        no_wait,
        url_base,
        qr,
        tailscale,
        lan,
        status,
        revoke,
    } = request;
    let url_base = url_base.as_deref();
    let lan = lan.as_deref();
    let selector_count =
        usize::from(url_base.is_some()) + usize::from(tailscale) + usize::from(lan.is_some());
    anyhow::ensure!(
        selector_count <= 1,
        "SNAPBACK_ADMIN_LINK_ORIGIN_CONFLICT: --url-base, --tailscale, and --lan are mutually exclusive"
    );
    anyhow::ensure!(
        !(no_wait && (tailscale || lan.is_some())),
        "SNAPBACK_ADMIN_LINK_ATTACHED_REQUIRED: --tailscale and --lan conflict with --no-wait"
    );
    anyhow::ensure!(
        !((status.is_some() || revoke.is_some())
            && (url_base.is_some() || qr || tailscale || lan.is_some() || no_wait)),
        "SNAPBACK_ADMIN_LINK_CONTROL_CONFLICT: --status/--revoke cannot create or present a new reachability link"
    );
    let resolved = resolve_admin_console_target(&target)?;
    if let Some(claim_code) = status {
        let status = console_claim_control_request(
            &resolved,
            "/_snapback/api/console/claim/status",
            &claim_code,
            "claim status",
        )?;
        print_console_claim_status(&status);
        return Ok(());
    }
    if let Some(claim_code) = revoke {
        let status = console_claim_control_request(
            &resolved,
            "/_snapback/api/console/claim/revoke",
            &claim_code,
            "claim revocation",
        )?;
        print_console_claim_status(&status);
        return Ok(());
    }

    let mut relay_observations = None;
    let (printed_origin, front) = if let Some(selector) = lan {
        let candidates = crate::admin_link::lan_candidates()?;
        let selected = crate::admin_link::select_lan_address(Some(selector), &candidates)?;
        let (relay, observations) =
            crate::admin_link::start_lan_relay(selected.address, &resolved.server_url).await?;
        // @ref LLP 0017#security-defaults — cleartext LAN ingress is the
        // explicit ruled posture. Name the exposure and every compensating
        // bound at mint time; hostile networks should use the HTTPS tailnet.
        eprintln!(
            "WARNING SNAPBACK_ADMIN_LAN_CLEARTEXT: {} is plain HTTP on {} ({}). On-link attackers can observe or hijack this session. Bounds: single-use claim exchange, ten-minute idle expiry, ninety-minute absolute cap, redemption record, and master revocation. Use --tailscale on networks you do not trust.",
            relay.origin, selected.interface, selected.address
        );
        relay_observations = Some(observations);
        (relay.origin.clone(), Some(AdminLinkFront::Lan(relay)))
    } else if tailscale {
        let upstream = resolved.server_url.clone();
        let guard = tokio::task::spawn_blocking(move || {
            crate::admin_link::acquire_tailscale(&upstream, None)
        })
        .await
        .map_err(|error| {
            anyhow::anyhow!("SNAPBACK_ADMIN_TAILSCALE_UNAVAILABLE: lifecycle task failed: {error}")
        })??;
        (
            guard.origin().to_owned(),
            Some(AdminLinkFront::Tailscale(guard)),
        )
    } else {
        (
            match url_base {
                Some(origin) => validated_console_origin(origin)?,
                None => validated_console_origin(&resolved.server_url)?,
            },
            None,
        )
    };
    let mut managed = if let Some(front) = front {
        let lease: ConsoleReachabilityLeaseCliResponse = console_reachability_request(
            &resolved,
            "/_snapback/api/console/reachability/register",
            serde_json::json!({ "origin": printed_origin }),
            "reachability registration",
        )?;
        validate_reachability_lease(&lease, None, None)?;
        Some(ManagedAdminLink::new(resolved.clone(), lease, front))
    } else {
        None
    };
    let claim = mint_console_claim(&resolved)?;
    if let Some(managed) = managed.as_mut() {
        managed.claim_code = Some(claim.claim_code.clone());
        let lease: ConsoleReachabilityLeaseCliResponse = console_reachability_request(
            &resolved,
            "/_snapback/api/console/reachability/bind",
            serde_json::json!({
                "sessionId": managed.lease.session_id,
                "claimCode": claim.claim_code,
            }),
            "relay lease binding",
        )?;
        validate_reachability_lease(
            &lease,
            Some(&managed.lease.session_id),
            Some(&managed.lease.instance_id),
        )?;
        managed.lease = lease;
    }
    // @ref LLP 0017#security-defaults — this is intentionally the only human
    // carrier: a process-ephemeral single-use code in a fragment. The request
    // URL and server logs never receive it, and the link is inert after the
    // attached observer reports redemption or expiry.
    let link = console_claim_fragment_url(&printed_origin, &claim.claim_code);
    println!("{link}");
    if qr {
        println!("{}", crate::admin_link::render_terminal_qr(&link)?);
        if origin_is_loopback(&printed_origin) {
            eprintln!(
                "SNAPBACK_ADMIN_QR_LOOPBACK_ONLY: this QR is reachable only from the Snapback server machine; use --lan or --tailscale for another device"
            );
        }
    }
    use std::io::Write as _;
    std::io::stdout().flush()?;
    if no_wait {
        return Ok(());
    }
    let shutdown = admin_link_termination_signal();
    tokio::pin!(shutdown);
    let mut redemption_reported = false;
    loop {
        tokio::select! {
            _ = &mut shutdown => {
                if let Some(managed) = managed.take() {
                    managed.finish(true).await?;
                }
                return Ok(());
            }
            observation = next_relay_observation(&mut relay_observations), if managed.is_some() => {
                let Some(observation) = observation else {
                    let cleanup = managed.take().expect("managed relay exists").finish(true).await;
                    cleanup?;
                    anyhow::bail!("SNAPBACK_ADMIN_LAN_RELAY_FAILED: the relay listener stopped before its lease ended");
                };
                println!("relay-observed peer {}", observation.peer);
            }
            _ = tokio::time::sleep(std::time::Duration::from_millis(500)) => {
                let status = if let Some(managed) = managed.as_ref() {
                    let observed: ConsoleReachabilityObservationCliResponse =
                        console_reachability_request(
                            &resolved,
                            "/_snapback/api/console/reachability/renew",
                            serde_json::json!({
                                "sessionId": managed.lease.session_id,
                                "claimCode": claim.claim_code,
                            }),
                            "relay lease renewal",
                        )?;
                    if let Some(lease) = observed.lease.as_ref() {
                        validate_reachability_lease(
                            lease,
                            Some(&managed.lease.session_id),
                            Some(&managed.lease.instance_id),
                        )?;
                    }
                    observed.claim
                } else {
                    console_claim_control_request(
                        &resolved,
                        "/_snapback/api/console/claim/status",
                        &claim.claim_code,
                        "claim status",
                    )?
                };
                match status.status.as_str() {
                    "pending" => continue,
                    "redeemed" if managed.is_some() => {
                        if !redemption_reported {
                            print_console_claim_status(&status);
                            redemption_reported = true;
                        }
                    }
                    "redeemed" | "claim_expired" | "credential_expired" | "revoked" => {
                        print_console_claim_status(&status);
                        if let Some(managed) = managed.take() {
                            managed.finish(false).await?;
                        }
                        return Ok(());
                    }
                    _ => {
                        if let Some(managed) = managed.take() {
                            managed.finish(true).await?;
                        }
                        return Err(anyhow::anyhow!(
                            "SNAPBACK_ADMIN_CLAIM_STATUS_RESPONSE_INVALID: claim status response carried an unknown state"
                        ));
                    }
                }
            }
        }
    }
}

fn mint_console_claim(
    resolved: &ResolvedAdminConsoleTarget,
) -> anyhow::Result<ConsoleClaimMintCliResponse> {
    let mut request = ureq::post(&format!(
        "{}/_snapback/api/console/claim",
        resolved.server_url
    ));
    request = request.set("x-snapback-admin-token", &resolved.token);
    let response = match request.call() {
        Ok(response) => response,
        Err(ureq::Error::Status(status, response)) => {
            return Err(admin_http_error(status, response, "claim mint"));
        }
        Err(error) => {
            return Err(anyhow::anyhow!(
                "SNAPBACK_ADMIN_CONSOLE_UNREACHABLE: console claim mint request failed: {error}"
            ));
        }
    };
    let claim: ConsoleClaimMintCliResponse = response.into_json().map_err(|_| {
        anyhow::anyhow!(
            "SNAPBACK_ADMIN_CLAIM_RESPONSE_INVALID: console claim response was not the expected JSON shape"
        )
    })?;
    anyhow::ensure!(
        valid_console_claim(&claim.claim_code)
            && claim.expires_at_ms > crate::server::now_millis()
            && claim.expires_in > 0,
        "SNAPBACK_ADMIN_CLAIM_RESPONSE_INVALID: console claim response was invalid"
    );
    Ok(claim)
}

fn console_reachability_request<T: serde::de::DeserializeOwned>(
    resolved: &ResolvedAdminConsoleTarget,
    path: &str,
    body: Value,
    operation: &str,
) -> anyhow::Result<T> {
    let timeout = crate::admin::CONSOLE_RELAY_LEASE_INTERVAL / 3;
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(timeout)
        .timeout_read(timeout)
        .timeout_write(timeout)
        .build();
    let response = agent
        .post(&format!("{}{path}", resolved.server_url))
        .set("x-snapback-admin-token", &resolved.token)
        .send_json(body);
    let response = match response {
        Ok(response) => response,
        Err(ureq::Error::Status(status, response)) => {
            return Err(admin_http_error(status, response, operation));
        }
        Err(error) => {
            return Err(anyhow::anyhow!(
                "SNAPBACK_ADMIN_CONSOLE_UNREACHABLE: {operation} request failed: {error}"
            ));
        }
    };
    response.into_json().map_err(|_| {
        anyhow::anyhow!(
            "SNAPBACK_ADMIN_RELAY_LEASE_RESPONSE_INVALID: {operation} response was not the expected JSON shape"
        )
    })
}

fn validate_reachability_lease(
    lease: &ConsoleReachabilityLeaseCliResponse,
    expected_session: Option<&str>,
    expected_instance: Option<&str>,
) -> anyhow::Result<()> {
    anyhow::ensure!(
        lease.session_id.starts_with("sbrs_")
            && lease.session_id.len() == 37
            && !lease.instance_id.is_empty()
            && lease.lease_interval_ms
                == crate::admin::CONSOLE_RELAY_LEASE_INTERVAL.as_millis() as u64
            && lease.lease_expires_at_ms > crate::server::now_millis()
            && expected_session.is_none_or(|expected| expected == lease.session_id)
            && expected_instance.is_none_or(|expected| expected == lease.instance_id),
        "SNAPBACK_ADMIN_RELAY_LEASE_RESPONSE_INVALID: relay lease identity or lifetime was invalid"
    );
    Ok(())
}

enum AdminLinkFront {
    Lan(crate::admin_link::LanRelay),
    Tailscale(crate::admin_link::TailscaleGuard),
}

struct ManagedAdminLink {
    resolved: ResolvedAdminConsoleTarget,
    lease: ConsoleReachabilityLeaseCliResponse,
    claim_code: Option<String>,
    front: Option<AdminLinkFront>,
    closed: bool,
}

impl ManagedAdminLink {
    fn new(
        resolved: ResolvedAdminConsoleTarget,
        lease: ConsoleReachabilityLeaseCliResponse,
        front: AdminLinkFront,
    ) -> Self {
        Self {
            resolved,
            lease,
            claim_code: None,
            front: Some(front),
            closed: false,
        }
    }

    async fn finish(mut self, revoke_early: bool) -> anyhow::Result<()> {
        self.closed = true;
        let mut first_error = None;
        // Close ingress before any best-effort network teardown. A dead or
        // wedged observation server must never keep the listener or mapping
        // alive while revocation/drop waits for an answer.
        if let Some(front) = self.front.take() {
            let result = match front {
                AdminLinkFront::Lan(relay) => relay.close().await,
                AdminLinkFront::Tailscale(guard) => tokio::task::spawn_blocking(move || {
                    guard.close()
                })
                .await
                .map_err(|error| {
                    anyhow::anyhow!(
                        "SNAPBACK_ADMIN_TAILSCALE_CLEANUP_FAILED: lifecycle task failed: {error}"
                    )
                })?,
            };
            if let Err(error) = result {
                first_error = Some(error);
            }
        }
        if revoke_early
            && let Some(claim_code) = self.claim_code.as_deref()
            && let Err(error) = console_claim_control_request(
                &self.resolved,
                "/_snapback/api/console/claim/revoke",
                claim_code,
                "early front credential revocation",
            )
        {
            first_error = Some(error);
        }
        if let Err(error) = drop_console_reachability(&self.resolved, &self.lease.session_id)
            && first_error.is_none()
        {
            first_error = Some(error);
        }
        if let Some(error) = first_error {
            return Err(error);
        }
        Ok(())
    }
}

impl Drop for ManagedAdminLink {
    fn drop(&mut self) {
        if self.closed {
            return;
        }
        // Drop owns the fail-closed fallback for every `?` in the observation
        // loop. Ingress dies before synchronous revocation is attempted.
        self.front.take();
        if let Some(claim_code) = self.claim_code.as_deref() {
            let _ = console_claim_control_request(
                &self.resolved,
                "/_snapback/api/console/claim/revoke",
                claim_code,
                "early front credential revocation",
            );
        }
        let _ = drop_console_reachability(&self.resolved, &self.lease.session_id);
        self.closed = true;
    }
}

fn drop_console_reachability(
    resolved: &ResolvedAdminConsoleTarget,
    session_id: &str,
) -> anyhow::Result<()> {
    let response: ConsoleReachabilityDropCliResponse = console_reachability_request(
        resolved,
        "/_snapback/api/console/reachability/drop",
        serde_json::json!({ "sessionId": session_id }),
        "reachability teardown",
    )?;
    let _ = response.dropped;
    Ok(())
}

async fn next_relay_observation(
    receiver: &mut Option<
        tokio::sync::mpsc::UnboundedReceiver<crate::admin_link::RelayObservation>,
    >,
) -> Option<crate::admin_link::RelayObservation> {
    match receiver {
        Some(receiver) => receiver.recv().await,
        None => std::future::pending().await,
    }
}

#[cfg(unix)]
async fn admin_link_termination_signal() {
    let mut terminate = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        .expect("install SIGTERM handler");
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {}
        _ = terminate.recv() => {}
    }
}

#[cfg(not(unix))]
async fn admin_link_termination_signal() {
    let _ = tokio::signal::ctrl_c().await;
}

fn origin_is_loopback(origin: &str) -> bool {
    origin
        .parse::<axum::http::Uri>()
        .ok()
        .and_then(|uri| uri.authority().map(|authority| authority.host().to_owned()))
        .is_some_and(|host| {
            host.eq_ignore_ascii_case("localhost")
                || host
                    .parse::<std::net::IpAddr>()
                    .ok()
                    .is_some_and(|address| address.is_loopback())
        })
}

fn console_claim_control_request(
    resolved: &ResolvedAdminConsoleTarget,
    path: &str,
    claim_code: &str,
    operation: &str,
) -> anyhow::Result<ConsoleClaimStatusCliResponse> {
    anyhow::ensure!(
        valid_console_claim(claim_code),
        "SNAPBACK_ADMIN_CLAIM_CODE_INVALID: claim code must use the sbcl_ format"
    );
    let mut request = ureq::post(&format!("{}{path}", resolved.server_url));
    request = request.set("x-snapback-admin-token", &resolved.token);
    let response = match request.send_json(serde_json::json!({ "claimCode": claim_code })) {
        Ok(response) => response,
        Err(ureq::Error::Status(status, response)) => {
            return Err(admin_http_error(status, response, operation));
        }
        Err(error) => {
            return Err(anyhow::anyhow!(
                "SNAPBACK_ADMIN_CONSOLE_UNREACHABLE: {operation} request failed: {error}"
            ));
        }
    };
    response.into_json().map_err(|_| {
        anyhow::anyhow!(
            "SNAPBACK_ADMIN_CLAIM_STATUS_RESPONSE_INVALID: claim status response was not the expected JSON shape"
        )
    })
}

fn print_console_claim_status(status: &ConsoleClaimStatusCliResponse) {
    match status.status.as_str() {
        "pending" => println!(
            "claim pending until {}",
            status.claim_expires_at_ms.unwrap_or_default()
        ),
        "claim_expired" => println!("claim expired without redemption"),
        "redeemed" => print_console_claim_redemption(status),
        "credential_expired" => {
            print_console_claim_redemption(status);
            println!("claim-derived credential expired");
        }
        "revoked" => {
            print_console_claim_redemption(status);
            println!(
                "claim-derived credential revoked at {}",
                status.revoked_at_ms.unwrap_or_default()
            );
        }
        _ => println!("claim status unavailable"),
    }
}

fn print_console_claim_redemption(status: &ConsoleClaimStatusCliResponse) {
    println!(
        "claim redeemed at {} by {} peer {}; credential digest {}; expires at {} (absolute cap {})",
        status.redeemed_at_ms.unwrap_or_default(),
        status.transport_peer_source.as_deref().unwrap_or("unknown"),
        status.transport_peer.as_deref().unwrap_or("unavailable"),
        status
            .credential_digest_sha256
            .as_deref()
            .unwrap_or("unavailable"),
        status.credential_expires_at_ms.unwrap_or_default(),
        status.credential_max_expires_at_ms.unwrap_or_default()
    );
}

fn validated_console_origin(value: &str) -> anyhow::Result<String> {
    anyhow::ensure!(
        !value.contains('#') && value.trim() == value,
        "SNAPBACK_ADMIN_CLAIM_URL_BASE_INVALID: --url-base must not contain whitespace or a fragment"
    );
    let uri = value.parse::<axum::http::Uri>().map_err(|_| {
        anyhow::anyhow!(
            "SNAPBACK_ADMIN_CLAIM_URL_BASE_INVALID: --url-base must be an absolute HTTP(S) origin"
        )
    })?;
    let scheme = uri.scheme_str().unwrap_or_default();
    let authority = uri.authority().ok_or_else(|| {
        anyhow::anyhow!(
            "SNAPBACK_ADMIN_CLAIM_URL_BASE_INVALID: --url-base must include an origin host"
        )
    })?;
    anyhow::ensure!(
        matches!(scheme, "http" | "https")
            && !authority.as_str().contains('@')
            && !authority.host().is_empty()
            && matches!(uri.path(), "" | "/")
            && uri.query().is_none(),
        "SNAPBACK_ADMIN_CLAIM_URL_BASE_INVALID: --url-base must be an HTTP(S) origin without credentials, path, query, or fragment"
    );
    Ok(format!("{scheme}://{authority}"))
}

fn valid_console_claim(value: &str) -> bool {
    value.strip_prefix("sbcl_").is_some_and(|suffix| {
        suffix.len() == 32 && suffix.bytes().all(|byte| byte.is_ascii_hexdigit())
    })
}

fn console_claim_fragment_url(origin: &str, claim_code: &str) -> String {
    format!(
        "{}/_snapback/admin/#claim={claim_code}",
        origin.trim_end_matches('/')
    )
}

fn launch_admin_console(target: &TargetArgs, no_open: bool) -> anyhow::Result<()> {
    let resolved = resolve_admin_console_target(target)?;
    let mut request = ureq::post(&format!(
        "{}/_snapback/api/console/credential",
        resolved.server_url
    ));
    request = request.set("x-snapback-admin-token", &resolved.token);
    let response = match request.call() {
        Ok(response) => response,
        Err(ureq::Error::Status(status, response)) => {
            return Err(admin_http_error(status, response, "credential mint"));
        }
        Err(error) => {
            return Err(anyhow::anyhow!(
                "SNAPBACK_ADMIN_CONSOLE_UNREACHABLE: console credential mint request failed: {error}"
            ));
        }
    };
    let credential: ConsoleCredentialCliResponse = response.into_json().map_err(|_| {
        anyhow::anyhow!(
            "SNAPBACK_ADMIN_CREDENTIAL_RESPONSE_INVALID: console credential response was not the expected JSON shape"
        )
    })?;
    anyhow::ensure!(
        valid_console_credential(&credential.credential)
            && credential.expires_at_ms > crate::server::now_millis(),
        "SNAPBACK_ADMIN_CREDENTIAL_RESPONSE_INVALID: console credential response was invalid"
    );
    // @ref LLP 0017#security-defaults — only the derived sbcc_ capability is
    // placed in a fragment. The master token never enters a URL, and the
    // fragment is absent from HTTP requests, server logs, and Referer.
    let url = console_fragment_url(
        &resolved.server_url,
        &credential.credential,
        credential.expires_at_ms,
    );
    if no_open {
        println!("{url}");
        return Ok(());
    }
    open_admin_browser(&url)?;
    println!("admin console opened");
    Ok(())
}

fn approve_console_code(target: &TargetArgs, code: &str) -> anyhow::Result<()> {
    let resolved = resolve_admin_console_target(target)?;
    let mut request = ureq::post(&format!(
        "{}/_snapback/api/console/approval/approve",
        resolved.server_url
    ));
    request = request.set("x-snapback-admin-token", &resolved.token);
    let response = match request.send_json(serde_json::json!({ "userCode": code })) {
        Ok(response) => response,
        Err(ureq::Error::Status(status, response)) => {
            return Err(admin_http_error(status, response, "console approval"));
        }
        Err(error) => {
            return Err(anyhow::anyhow!(
                "SNAPBACK_ADMIN_CONSOLE_UNREACHABLE: console approval request failed: {error}"
            ));
        }
    };
    let approved: ConsoleApprovalCliResponse = response.into_json().map_err(|_| {
        anyhow::anyhow!(
            "SNAPBACK_ADMIN_APPROVAL_RESPONSE_INVALID: console approval response was not the expected JSON shape"
        )
    })?;
    anyhow::ensure!(
        approved.approved,
        "SNAPBACK_ADMIN_APPROVAL_RESPONSE_INVALID: console approval was not confirmed"
    );
    println!("admin console code approved");
    Ok(())
}

#[derive(Clone)]
struct ResolvedAdminConsoleTarget {
    server_url: String,
    token: String,
}

impl std::fmt::Debug for ResolvedAdminConsoleTarget {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ResolvedAdminConsoleTarget")
            .field("server_url", &self.server_url)
            .field("token", &"[REDACTED]")
            .finish()
    }
}

fn resolve_admin_console_target(target: &TargetArgs) -> anyhow::Result<ResolvedAdminConsoleTarget> {
    let explicit_token = target
        .token
        .clone()
        .or_else(|| std::env::var("SNAPBACK_ADMIN_TOKEN").ok())
        .filter(|token| !token.is_empty());
    if let Some(url) = target.url.as_deref() {
        let token = explicit_token.ok_or_else(|| anyhow::anyhow!(
            "SNAPBACK_ADMIN_TOKEN_UNAVAILABLE: --url requires --token or SNAPBACK_ADMIN_TOKEN; a network peer cannot select a local token file"
        ))?;
        return Ok(ResolvedAdminConsoleTarget {
            server_url: url.trim_end_matches('/').to_owned(),
            token,
        });
    }
    let path = target.ready_file.as_deref().ok_or_else(|| anyhow::anyhow!(
        "SNAPBACK_ADMIN_READY_FILE_REQUIRED: pass --ready-file, or pass --url with an explicit token"
    ))?;
    let ready_target = ReadyFileTarget::open_existing(path).map_err(|error| {
        anyhow::anyhow!(
            "SNAPBACK_ADMIN_READY_FILE_UNAVAILABLE: cannot open trusted ready file {}: {error}",
            path.display()
        )
    })?;
    let canonical_ready = ready_target.pinned_path().to_path_buf();
    let descriptor_bytes = ready_target
        .read_owner_only_sibling(&canonical_ready)
        .map_err(|error| {
            anyhow::anyhow!(
                "SNAPBACK_ADMIN_READY_FILE_UNAVAILABLE: cannot read trusted ready file {}: {error}",
                path.display()
            )
        })?;
    let value: Value = serde_json::from_slice(&descriptor_bytes).map_err(|_| {
        anyhow::anyhow!(
            "SNAPBACK_ADMIN_READY_FILE_INVALID: {} is not valid JSON",
            path.display()
        )
    })?;
    let descriptor = HostReadyDescriptor::validate(&value).map_err(|problems| {
        anyhow::anyhow!(
            "SNAPBACK_ADMIN_READY_FILE_INVALID: {} is not a valid readiness descriptor: {}",
            path.display(),
            problems.join("; ")
        )
    })?;
    let health = fetch_health(&descriptor.server_url);
    verify_live_descriptor_identity(&descriptor, &health, "admin console")
        .map_err(|diagnostic| anyhow::anyhow!("{}: {}", diagnostic.code, diagnostic.message))?;
    let token = explicit_token
        .or_else(|| discover_admin_console_token(&ready_target, &canonical_ready, &descriptor))
        .ok_or_else(|| anyhow::anyhow!(
            "SNAPBACK_ADMIN_TOKEN_UNAVAILABLE: the trusted ready descriptor has no readable owner-only admin token"
        ))?;
    Ok(ResolvedAdminConsoleTarget {
        server_url: descriptor.server_url.trim_end_matches('/').to_owned(),
        token,
    })
}

fn discover_admin_console_token(
    ready_target: &ReadyFileTarget,
    ready_file: &Path,
    descriptor: &HostReadyDescriptor,
) -> Option<String> {
    let declared = PathBuf::from(descriptor.admin_token_file.as_deref()?);
    let expected = match descriptor.database.mode.as_str() {
        "file" => {
            crate::admin::admin_token_sibling(Path::new(descriptor.database.path.as_deref()?))
        }
        "memory" => crate::admin::admin_token_sibling(ready_file),
        _ => return None,
    };
    if declared != expected {
        return None;
    }
    let bytes = if declared.parent() == ready_file.parent() {
        ready_target.read_owner_only_sibling(&declared).ok()?
    } else {
        crate::secure_file::read_owner_only(&declared).ok()?
    };
    let token = String::from_utf8(bytes).ok()?;
    let token = token.trim();
    (!token.is_empty()).then(|| token.to_owned())
}

fn valid_console_credential(value: &str) -> bool {
    value.strip_prefix("sbcc_").is_some_and(|suffix| {
        !suffix.is_empty() && suffix.bytes().all(|byte| byte.is_ascii_alphanumeric())
    })
}

fn console_fragment_url(server_url: &str, credential: &str, expires_at_ms: u64) -> String {
    format!(
        "{}/_snapback/admin/#credential={credential}&expiresAtMs={expires_at_ms}",
        server_url.trim_end_matches('/')
    )
}

fn admin_http_error(status: u16, response: ureq::Response, operation: &str) -> anyhow::Error {
    let body: Value = response.into_json().unwrap_or(Value::Null);
    let code = body
        .pointer("/diagnostic/code")
        .and_then(Value::as_str)
        .unwrap_or("SNAPBACK_ADMIN_HTTP_ERROR");
    let message = body
        .pointer("/diagnostic/message")
        .and_then(Value::as_str)
        .unwrap_or("admin request was refused");
    anyhow::anyhow!("{code}: {operation} failed with HTTP {status}: {message}")
}

fn open_admin_browser(url: &str) -> anyhow::Result<()> {
    #[cfg(target_vendor = "apple")]
    let mut command = std::process::Command::new("open");
    #[cfg(target_os = "linux")]
    let mut command = std::process::Command::new("xdg-open");
    #[cfg(windows)]
    let mut command = {
        let mut command = std::process::Command::new("cmd");
        command.args(["/C", "start", ""]);
        command
    };
    #[cfg(not(any(target_vendor = "apple", target_os = "linux", windows)))]
    return Err(anyhow::anyhow!(
        "SNAPBACK_ADMIN_BROWSER_OPEN_UNSUPPORTED: use --no-open on this host"
    ));

    #[cfg(any(target_vendor = "apple", target_os = "linux", windows))]
    {
        command
            .arg(url)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|error| anyhow::anyhow!(
                "SNAPBACK_ADMIN_BROWSER_OPEN_FAILED: could not launch the system browser; retry with --no-open: {error}"
            ))?;
        Ok(())
    }
}

/// Minted-token discovery (ENG-23443): when the caller passed no explicit
/// token, read the auto-minted token file the server points at — via the
/// readiness descriptor's `adminTokenFile`. The path must be the mechanical
/// sibling of the trusted descriptor itself; a remote `--url` target can never
/// name a local path for the CLI to read. Being able to read both owner-only
/// files as this user is what makes the CLI local admin (LLP 0036 D3).
/// Discovery failing just means the request goes out tokenless and surfaces
/// the server's structured refusal.
fn discover_minted_token(ready_file: &Path, descriptor: &HostReadyDescriptor) -> Option<String> {
    let declared = PathBuf::from(descriptor.admin_token_file.as_deref()?);
    let expected = crate::admin::admin_token_sibling(ready_file);
    if declared != expected {
        return None;
    }
    let token = String::from_utf8(crate::secure_file::read_owner_only(&declared).ok()?).ok()?;
    let token = token.trim();
    (!token.is_empty()).then(|| token.to_owned())
}

fn discover_minted_token_pinned(
    target: &ReadyFileTarget,
    ready_file: &Path,
    descriptor: &HostReadyDescriptor,
) -> Option<String> {
    let declared = PathBuf::from(descriptor.admin_token_file.as_deref()?);
    let expected = crate::admin::admin_token_sibling(ready_file);
    if declared != expected {
        return None;
    }
    let token = String::from_utf8(target.read_owner_only_sibling(&declared).ok()?).ok()?;
    let token = token.trim();
    (!token.is_empty()).then(|| token.to_owned())
}

fn mint_secret_read_via_http(
    ready_file: &Path,
    explicit_token: Option<String>,
    lease: SecretReadMintSpec,
) -> anyhow::Result<Value> {
    // Resolve and validate one owner-only descriptor snapshot before reading
    // either sibling capability. URL-only targeting has no code path here.
    let value = read_trusted_json_file(ready_file)?;
    let descriptor = HostReadyDescriptor::validate(&value).map_err(|problems| {
        anyhow::anyhow!(
            "{} is not a valid readiness descriptor: {}",
            ready_file.display(),
            problems.join("; ")
        )
    })?;
    let health = fetch_health(&descriptor.server_url);
    verify_live_descriptor_identity(&descriptor, &health, "admin-secret-read.mint")
        .map_err(|diagnostic| anyhow::anyhow!("{}: {}", diagnostic.code, diagnostic.message))?;
    let canonical_ready = std::fs::canonicalize(ready_file)
        .with_context(|| format!("failed to resolve ready file {}", ready_file.display()))?;
    let declared_root = validated_secret_read_root_path(&canonical_ready, &descriptor)?;
    let root = crate::admin_secret_read::read_secret_read_proof_root(&declared_root)?;

    let startup_nonce = descriptor
        .startup_nonce
        .clone()
        .context("readiness descriptor has no startupNonce")?;
    let issued_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| u64::try_from(duration.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0);
    let proof = sign_secret_read_mint(
        &root,
        lease,
        startup_nonce,
        issued_at_ms,
        format!("sbrp_{}", Uuid::new_v4().simple()),
    )?;
    let token = explicit_token
        .or_else(|| std::env::var("SNAPBACK_ADMIN_TOKEN").ok())
        .filter(|token| !token.is_empty())
        .or_else(|| discover_minted_token(&canonical_ready, &descriptor));
    let mut request = ureq::post(&format!(
        "{}/_snapback/api/admin-secret-read/mint",
        descriptor.server_url.trim_end_matches('/')
    ));
    if let Some(token) = token {
        request = request.set("x-snapback-admin-token", &token);
    }
    match request.send_json(serde_json::to_value(proof)?) {
        Ok(response) => response
            .into_json()
            .context("secret-read mint response was not JSON"),
        Err(ureq::Error::Status(status, response)) => {
            let body: Value = response
                .into_json()
                .context("secret-read mint error response was not JSON")?;
            anyhow::bail!("secret-read mint failed with HTTP {status}: {body}")
        }
        Err(error) => Err(error).context("secret-read mint request failed"),
    }
}

fn validated_secret_read_root_path(
    canonical_ready: &Path,
    descriptor: &HostReadyDescriptor,
) -> anyhow::Result<PathBuf> {
    let expected_root = secret_read_root_sibling(canonical_ready);
    let declared_root = descriptor
        .secret_read_root_file
        .as_deref()
        .map(PathBuf::from)
        .context("readiness descriptor has no secretReadRootFile")?;
    anyhow::ensure!(
        declared_root == expected_root,
        "SNAPBACK_ADMIN_SECRET_READ_ROOT_PATH_INVALID: secretReadRootFile is not the mechanical ready-file sibling"
    );
    Ok(declared_root)
}

/// Write only the JSON envelope; returns envelope `ok` (missing/false → false).
fn write_envelope_to(envelope: &Value, output: &mut dyn std::io::Write) -> std::io::Result<bool> {
    writeln!(
        output,
        "{}",
        serde_json::to_string_pretty(envelope).unwrap_or_else(|_| envelope.to_string())
    )?;
    Ok(envelope.get("ok").and_then(Value::as_bool).unwrap_or(false))
}

/// Print the envelope; returns envelope `ok` (missing/false → false).
fn print_envelope(envelope: &Value) -> bool {
    write_envelope_to(envelope, &mut std::io::stdout().lock())
        .expect("write host-operation envelope to stdout")
}

/// host.stop: validate the readiness descriptor, verify the descriptor still
/// names the live server, signal the process, remove the file, and print a
/// synthesized host.stop envelope (the CLI owns this operation — a server
/// cannot stop itself over its own HTTP surface).
fn host_stop(ready_file: &Path) -> anyhow::Result<()> {
    let value = read_trusted_json_file(ready_file)?;
    let descriptor = HostReadyDescriptor::validate(&value).map_err(|problems| {
        anyhow::anyhow!(
            "{} is not a valid readiness descriptor: {}",
            ready_file.display(),
            problems.join("; ")
        )
    })?;
    // @ref LLP 0030#readiness-and-port-discovery — "a stale ready file must
    // never be accepted as current readiness": confirm the descriptor's server
    // still answers /health as the same process (startupNonce match) before
    // signaling, so a reused PID never receives the signal (ENG-23366).
    let health = fetch_health(&descriptor.server_url);
    let envelope =
        |ok: bool, data: Value, diagnostics: Vec<crate::diagnostic::Diagnostic>| HostOpsResult {
            schema_version: SNAPBACK_SCHEMA_VERSION.to_owned(),
            result_kind: HOST_OPS_RESULT_KIND.to_owned(),
            request_id: crate::ids::mint_time_ordered(crate::ids::Kind::HostOperation),
            operation: "host.stop".to_owned(),
            ok,
            target: descriptor.target.clone(),
            authority: None,
            artifacts: HostOpsArtifacts::default(),
            data,
            diagnostics,
            next: Vec::new(),
            secret_read_tables: Vec::new(),
            secret_read_rows: 0,
            secret_read_query: false,
            secret_read_provenance_complete: true,
        };
    if let Err(diagnostic) = verify_stop_target(&descriptor, &health) {
        let refused = envelope(
            false,
            json!({
                "pid": descriptor.pid,
                "serverUrl": descriptor.server_url,
                "readyFile": ready_file.display().to_string(),
            }),
            vec![diagnostic],
        );
        print_envelope(&serde_json::to_value(&refused)?);
        std::process::exit(1);
    }
    let stopped = std::process::Command::new("kill")
        .arg(descriptor.pid.to_string())
        .status()
        .context("failed to signal the server process")?
        .success();
    if stopped {
        let _ = std::fs::remove_file(ready_file);
    }
    let envelope = envelope(
        stopped,
        json!({
            "stoppedPid": descriptor.pid,
            "serverUrl": descriptor.server_url,
            "verifiedBy": "startupNonce",
        }),
        Vec::new(),
    );
    let ok = print_envelope(&serde_json::to_value(&envelope)?);
    if !ok {
        std::process::exit(1);
    }
    Ok(())
}

/// GET the descriptor's `/health` and return its JSON payload, or a
/// human-readable reason it could not be fetched.
fn fetch_health(server_url: &str) -> Result<Value, String> {
    let url = format!("{}/health", server_url.trim_end_matches('/'));
    let agent = ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_secs(2))
        .build();
    match agent.get(&url).call() {
        Ok(response) => response
            .into_json()
            .map_err(|error| format!("{url} did not return JSON: {error}")),
        Err(ureq::Error::Status(status, _)) => Err(format!("{url} answered HTTP {status}")),
        Err(error) => Err(format!("{url} is unreachable: {error}")),
    }
}

/// Decide whether the descriptor's pid may be signaled: only when the live
/// server at `serverUrl` reports the same per-process `startupNonce` the
/// descriptor was written with. Anything else — dead server, different
/// process on the port, a descriptor without a nonce — refuses with a
/// structured diagnostic instead of signaling a possibly reused PID.
fn verify_stop_target(
    descriptor: &HostReadyDescriptor,
    health: &Result<Value, String>,
) -> Result<(), crate::diagnostic::Diagnostic> {
    verify_live_descriptor_identity(descriptor, health, "host.stop")
}

/// Verify that a trusted descriptor still names the process answering its
/// URL. Capability-bearing ready-file operations call this before reading any
/// sibling secret or attaching any administrator credential to a request.
fn verify_live_descriptor_identity(
    descriptor: &HostReadyDescriptor,
    health: &Result<Value, String>,
    operation: &str,
) -> Result<(), crate::diagnostic::Diagnostic> {
    let details = |reason: &str| {
        json!({
            "operation": operation,
            "pid": descriptor.pid,
            "serverUrl": descriptor.server_url,
            "reason": reason,
        })
    };
    let Some(expected_nonce) = descriptor.startup_nonce.as_deref() else {
        return Err(crate::diagnostic::Diagnostic::error(
            "SNAPBACK_HOST_STOP_UNVERIFIABLE",
            "host-ops",
            "the readiness descriptor has no startupNonce, so the target process cannot be verified; the capability-bearing operation was refused",
        )
        .with_details(details("descriptor predates startupNonce identity")));
    };
    let payload = match health {
        Ok(payload) => payload,
        Err(reason) => {
            return Err(crate::diagnostic::Diagnostic::error(
                "SNAPBACK_HOST_STOP_STALE_DESCRIPTOR",
                "host-ops",
                format!(
                    "the descriptor's server no longer answers ({reason}); the ready file is \
                     stale and pid {} may belong to an unrelated process — the operation was refused",
                    descriptor.pid
                ),
            )
            .with_details(details(reason)));
        }
    };
    let live_nonce = payload
        .get("binary")
        .and_then(|binary| binary.get("startupNonce"))
        .and_then(Value::as_str);
    match live_nonce {
        Some(live) if live == expected_nonce => Ok(()),
        Some(_) => Err(crate::diagnostic::Diagnostic::error(
            "SNAPBACK_HOST_STOP_STALE_DESCRIPTOR",
            "host-ops",
            "the server answering the descriptor's URL is a different process than the one that \
             wrote the descriptor (startupNonce mismatch); the operation was refused — remove \
             the stale ready file and target the live server's own ready file",
        )
        .with_details(details("startupNonce mismatch"))),
        None => Err(crate::diagnostic::Diagnostic::error(
            "SNAPBACK_HOST_STOP_UNVERIFIABLE",
            "host-ops",
            "the process answering the descriptor's URL does not report a Snapback identity \
             (/health has no binary.startupNonce); the operation was refused",
        )
        .with_details(details("no binary.startupNonce on /health"))),
    }
}

pub async fn run(args: Args) -> anyhow::Result<()> {
    run_composed(args, None, None).await
}

/// Typed production entry for a target adapter that already holds the trusted
/// descriptor. Ordinary CLI startup remains an explicitly unbound compatibility
/// path; adapters must use this seam to make telemetry exports self-describing.
// @ref LLP 0154#d1--telemetry-store-a-sibling-sqlite-database-generation-bound —
//   the descriptor, not argv/environment/path inference, owns environment id.
pub async fn run_for_target(
    args: Args,
    target: crate::deploy::TargetDescriptor,
) -> anyhow::Result<()> {
    run_composed(args, None, Some(&target)).await
}

/// Composed startup for the supported embedding façade. Keeping the embedded
/// carrier out of [`Args`] preserves the CLI DTO while still feeding the exact
/// same lifecycle as a path-backed startup artifact.
///
/// @ref LLP 0141#d4-production-posture-construction — baked artifacts join the
///   complete CLI-owned provider, worker, readiness, and bind sequence.
pub(crate) async fn run_embedded(
    args: Args,
    embedded_startup_artifacts: crate::auth::mode::StartupArtifacts,
) -> anyhow::Result<()> {
    run_composed(args, Some(embedded_startup_artifacts), None).await
}

/// Apply the telemetry side of the already-durable declared-restore outcome.
/// An idempotent replay is an ordinary boot: beginning a generation fence for
/// it would discard this boot's process evidence even though no authority
/// incarnation changed.
// @ref LLP 0057#restore — only the non-idempotent restore branch rotates the
//   authorization-stream incarnation; replay preserves authority created later.
// @ref LLP 0154#d1--telemetry-store-a-sibling-sqlite-database-generation-bound —
//   telemetry rotates exactly when the committed app incarnation rotates.
fn apply_declared_restore_telemetry_outcome(
    snapback: &mut LocalSnapback,
    outcome: crate::auth::lifecycle::DeclaredRestoreOutcome,
) -> crate::diagnostic::SnapbackResult<()> {
    match outcome {
        crate::auth::lifecycle::DeclaredRestoreOutcome::Applied { .. } => {
            snapback.begin_telemetry_generation_transition();
            snapback.rebind_telemetry_to_current_incarnation("restore_generation_rotation")
        }
        crate::auth::lifecycle::DeclaredRestoreOutcome::AlreadyApplied => Ok(()),
    }
}

async fn run_composed(
    args: Args,
    embedded_startup_artifacts: Option<crate::auth::mode::StartupArtifacts>,
    target: Option<&crate::deploy::TargetDescriptor>,
) -> anyhow::Result<()> {
    // @ref LLP 0030#readiness-and-port-discovery — detached launchers need the
    // owner-only readiness descriptor; stdout/stderr and inherited stdin are
    // not capability handoff channels. Refuse before resolving/creating the
    // database so a missing descriptor cannot leave startup side effects.
    if args.ready_file.is_none() && !controlling_terminal_available() {
        return Err(anyhow::Error::new(ready_descriptor_required_error()));
    }
    anyhow::ensure!(
        !(args.memory && args.restored_from_backup.is_some()),
        "SNAPBACK_AUTH_BACKUP_INVALID: in-memory startup cannot consume a restore declaration"
    );
    // Resolve once, before auth composition, and bind the exact same address.
    // This keeps profile/capture posture identical for numeric hosts and DNS
    // aliases without opening a listener early.
    let bind_ip = resolve_bind_ip(&args.host).await?;
    // @ref LLP 0060#d5-hosted-readiness-is-conjunctive — reject an explicit
    // hosted request before opening target state; operator config is a request,
    // never authority for target-owned TLS/proxy/throttle/invalidation facts.
    //
    // @ref LLP 0098#4-the-admission-seam — the one place hosted serving can be
    // admitted. Every clause not needing durable state runs here, before the
    // database path is created, so an unsupported hosted request still leaves
    // the target byte-for-byte unchanged.
    let verified_hosted_admission = compose_hosted_edge_admission(&args, bind_ip)?;
    let (prepared_database_path, mut startup_target_reservation) = if args.memory {
        (None, None)
    } else {
        let (path, reservation) = prepare_database_path_for_startup(&args.db)?;
        (Some(path), reservation)
    };
    // Reject lexical/canonical nesting before ReadyFileTarget creates a
    // missing parent. Otherwise a ready path beneath `app.sqlite3-wal/` (or a
    // lock/config/token sibling) could first occupy a managed file path with a
    // directory and fail later with an unrelated SQLite/lock error.
    let provisional_ready_temp = args
        .ready_file
        .as_deref()
        .map(ready_file_temp_path)
        .transpose()?;
    let provisional_impersonation_temp = args
        .ready_file
        .as_deref()
        .map(crate::admin_impersonation::impersonation_capability_sibling)
        .transpose()?
        .as_deref()
        .map(ready_file_temp_path)
        .transpose()?;
    let mut provisional_paths = managed_startup_paths(
        prepared_database_path.as_deref(),
        args.ready_file.as_deref(),
    )?;
    if let Some(path) = provisional_ready_temp {
        provisional_paths.push(ManagedPath {
            label: "ready-file temporary artifact",
            path,
        });
    }
    if let Some(path) = provisional_impersonation_temp {
        provisional_paths.push(ManagedPath {
            label: "impersonation capability temporary artifact",
            path,
        });
    }
    validate_path_disjointness(&provisional_paths)?;
    // Pin the resolved ready-file parent before validating it against any
    // managed database artifact. Publication and cleanup remain relative to
    // this directory capability even if a symlink in the caller's pathname is
    // swapped while the server is running.
    let mut ready_target = args
        .ready_file
        .as_deref()
        .map(ReadyFileTarget::open)
        .transpose()?;
    let ready_path = ready_target
        .as_ref()
        .map(ReadyFileTarget::pinned_path)
        .map(Path::to_path_buf);
    let ready_temp_path = ready_path
        .as_deref()
        .map(ready_file_temp_path)
        .transpose()?;
    let impersonation_capability_file = ready_path
        .as_deref()
        .map(crate::admin_impersonation::impersonation_capability_sibling)
        .transpose()?;
    let impersonation_temp_path = impersonation_capability_file
        .as_deref()
        .map(ready_file_temp_path)
        .transpose()?;
    let mut managed_paths =
        managed_startup_paths(prepared_database_path.as_deref(), ready_path.as_deref())?;
    if let Some(path) = &ready_temp_path {
        managed_paths.push(ManagedPath {
            label: "ready-file temporary artifact",
            path: path.clone(),
        });
    }
    if let Some(path) = &impersonation_temp_path {
        managed_paths.push(ManagedPath {
            label: "impersonation capability temporary artifact",
            path: path.clone(),
        });
    }
    validate_path_disjointness(&managed_paths)?;

    let mut database_lock = None;
    let database_path = prepared_database_path;
    let mut snapback = match database_path.as_ref() {
        None => match target {
            Some(target) => startup_blocking(|| LocalSnapback::memory_for_target(target))?,
            None => startup_blocking(LocalSnapback::memory)?,
        },
        Some(db_path) => {
            // @ref LLP 0003#decision — one local server process owns the SQLite
            // database and process-local runtime state for this app instance.
            if let Some(reservation) = &startup_target_reservation {
                reservation
                    .ensure_valid()
                    .context("database target changed after startup path validation")?;
            }
            let lock = DatabaseInstanceLock::acquire(db_path)?;
            if let Some(reservation) = &startup_target_reservation {
                reservation
                    .ensure_valid()
                    .context("database target changed while acquiring its inner lock")?;
            }
            let opened = startup_blocking(|| match target {
                Some(target) => LocalSnapback::open_for_target(db_path, target),
                None => LocalSnapback::open(db_path),
            });
            if let Some(reservation) = &startup_target_reservation {
                reservation
                    .ensure_valid()
                    .context("database target changed while opening the database")?;
            }
            match opened {
                Ok(snapback) => {
                    // The ordinary inside-instance lock is now authoritative;
                    // releasing the outer reservation cannot let restore win,
                    // because the complete instance directory exists.
                    drop(startup_target_reservation.take());
                    database_lock = Some(lock);
                    snapback
                }
                Err(open_error) => {
                    drop(startup_target_reservation.take());
                    if !crate::auth::recovery::eligible(db_path, &open_error)? {
                        return Err(anyhow::Error::new(open_error));
                    }
                    return run_auth_collision_recovery(
                        &args,
                        bind_ip,
                        db_path.clone(),
                        lock,
                        ready_target,
                        managed_paths,
                        ready_temp_path,
                        impersonation_capability_file,
                        impersonation_temp_path,
                    )
                    .await;
                }
            }
        }
    };
    let derived_fork_boot = snapback.is_derived_fork();
    let derived_fork_lineage = snapback.derived_fork_identity().cloned();
    debug_assert_eq!(derived_fork_boot, derived_fork_lineage.is_some());

    // Assemble exactly one provider before listener bind. This is inspection,
    // not activation: an uninitialized catalog remains dormant and no keyring
    // is minted; a marked catalog validates only its existing sibling.
    // @ref LLP 0057#activation-ordering — startup never activates the auth catalog or replaces a lost ReadyV1 keyring.
    let startup_profile = ServerProfile::for_bind_ip(bind_ip);
    let mut auth_runtime = crate::auth::runtime::AuthRuntime::inspect(
        &mut snapback,
        database_path.as_deref(),
        crate::auth::runtime::provider_profile(startup_profile),
    )?;
    let auth_startup_diagnostics = auth_runtime.startup_diagnostics();
    snapback.record_startup_diagnostics(&auth_startup_diagnostics);
    // Seed before declared restore or mode composition can make any
    // wall-clock-based authority decision. A second seed after composition
    // covers a catalog activated during this startup.
    auth_runtime.seed_durable_clock_floor(&mut snapback)?;

    // A restored directory is quarantined until the exact declaration emitted
    // by `auth restore` is consumed. This runs under the instance lock and
    // before listener bind, so no request can observe backed-up sessions.
    // @ref LLP 0057#restore — declared restore is an idempotent pre-bind revocation/purge transaction; omission never silently serves the backup.
    if let Some(db_path) = database_path.as_deref() {
        let declaration_path = crate::auth::lifecycle::restore_declaration_path(db_path)?;
        let declaration_present = match std::fs::symlink_metadata(&declaration_path) {
            Ok(_) => true,
            Err(error) if error.kind() == ErrorKind::NotFound => false,
            Err(_) => {
                return Err(anyhow::Error::new(crate::diagnostic::SnapbackError::error(
                    "SNAPBACK_AUTH_BACKUP_INVALID",
                    "auth-restore",
                    "restore declaration could not be inspected",
                )));
            }
        };
        match args.restored_from_backup.as_deref() {
            Some(declaration_id) => {
                let provider = auth_runtime.provider();
                let maintenance = provider.exclusive_maintenance().await;
                // @ref LLP 0032#phase-3--lifecycle-and-resource-hardening —
                // declared restore is a pre-bind SQLite transaction even
                // though its maintenance authority is acquired
                // asynchronously; execute the transaction in the sanctioned
                // startup blocking section.
                let restore = startup_blocking(|| {
                    crate::auth::lifecycle::apply_declared_restore(
                        snapback.auth_database_mut(),
                        maintenance.mailbox(),
                        &declaration_path,
                        declaration_id,
                        provider.now_ms(),
                    )
                });
                match restore {
                    Ok(outcome) => {
                        apply_declared_restore_telemetry_outcome(&mut snapback, outcome)?
                    }
                    Err(error) => return Err(error.into()),
                }
            }
            None if declaration_present => {
                return Err(anyhow::Error::new(crate::diagnostic::SnapbackError::error(
                    "SNAPBACK_AUTH_BACKUP_INVALID",
                    "auth-restore",
                    "a restored instance requires --restored-from-backup before it can bind",
                )));
            }
            None => {}
        }
    }

    // Prepare every process-local authority prerequisite before a mode consume
    // can make sessions active. The listener is still absent; later
    // ready-descriptor publication remains the final admission cut.
    let loopback = bind_ip.is_loopback();
    let mut server_context = ServerContext::new(bind_ip.to_string(), 0, loopback)
        .with_auth_deployment(args.auth_deployment);
    if derived_fork_boot {
        // @ref LLP 0158#design-sketch — an inherited process environment is
        // not credential authority for the new instance; load the freshly
        // minted fork-local admin sidecar below.
        server_context.admin_token = None;
    }
    debug_assert_eq!(server_context.profile, startup_profile);
    let mut minted_token = None;
    if loopback && server_context.admin_token.is_none() {
        let token_file = database_path
            .as_deref()
            .or(ready_path.as_deref())
            .map(crate::admin::admin_token_sibling);
        let resolved = if database_path.is_none() {
            if let (Some(target), Some(token_file)) = (ready_target.as_ref(), token_file.as_ref()) {
                crate::admin::resolve_serve_admin_token_with_io(
                    None,
                    Some(token_file.clone()),
                    |path| target.read_owner_only_sibling(path),
                    |path, bytes| target.write_owner_only_sibling(path, bytes),
                )?
            } else {
                crate::admin::resolve_serve_admin_token(None, token_file)?
            }
        } else {
            crate::admin::resolve_serve_admin_token(None, token_file)?
        };
        server_context.install_minted_token(&resolved);
        minted_token = Some(resolved);
    }
    if let Some(database_path) = database_path.as_deref() {
        server_context.install_console_credential_store(database_path)?;
    }
    let token_configured = server_context.admin_token.is_some();
    let ready_sibling_token_file = if database_path.is_none() {
        server_context.admin_token_file.clone()
    } else {
        None
    };
    let ready_sibling_token_identity = ready_sibling_token_file
        .as_deref()
        .and_then(existing_file_identity);
    let admin_token_file_display = server_context
        .admin_token_file
        .as_ref()
        .map(|path| path.display().to_string());
    let startup_nonce = crate::identity::binary_identity().startup_nonce;
    let needs_impersonation_registry = server_context.profile.allows_provisioning()
        && (server::impersonation_registry_enabled(crate::server::PolicyAuthMode::Dev)
            || server::impersonation_registry_enabled(crate::server::PolicyAuthMode::Sessions));
    let (impersonation_capabilities, impersonation_operator) = if needs_impersonation_registry {
        let (registry, operator) =
            crate::admin_impersonation::ImpersonationCapabilityRegistry::generate(
                startup_nonce.clone(),
                &crate::auth::crypto::OsRandom,
            )
            .context("failed to generate the process-bound impersonation capability")?;
        (Some(registry), Some(operator))
    } else {
        (None, None)
    };
    let secret_read_root_file = ready_path.as_deref().map(secret_read_root_sibling);
    let secret_read_proof_root = match (ready_target.as_ref(), secret_read_root_file.as_ref()) {
        (Some(target), Some(path)) => Some(
            crate::admin_secret_read::resolve_secret_read_proof_root_with_io(
                path,
                |path| target.read_owner_only_sibling(path),
                |path, bytes| target.write_owner_only_sibling(path, bytes),
            )?,
        ),
        _ => None,
    };
    if let (true, Some(target), Some(path)) = (
        secret_read_proof_root.is_some(),
        ready_target.as_mut(),
        secret_read_root_file.as_deref(),
    ) {
        // Descriptor-scoped custody: the proof root is removed with the
        // descriptor and the impersonation sidecar at shutdown (0137 G1).
        target.adopt_secret_read_root_sibling(path)?;
    }
    let secret_read_process_prerequisites =
        ready_target.is_some() && token_configured && secret_read_proof_root.is_some();

    // Item 5 makes sessions activatable after the three projection/custody
    // mechanisms. Item 7's descriptor is an independent build fact; item 6's
    // boot-local invalidation issuer and item 8's lease service are installed
    // later in this startup sequence.
    let connection_binding_receipt = server::connection_binding_construction_receipt();
    let two_phase_revocation_receipt = auth_runtime.two_phase_revocation_construction_receipt();
    let auth_coordinator_receipt = auth_runtime.auth_coordinator_construction_receipt();
    #[cfg(test)]
    let auth_coordinator_receipt = match args.auth_construction_failure {
        Some(AuthConstructionFailure::Coordinator) => {
            auth_coordinator_receipt.fail_before_build_for_test()
        }
        _ => auth_coordinator_receipt,
    };
    #[cfg(test)]
    let two_phase_revocation_receipt = match args.auth_construction_failure {
        Some(AuthConstructionFailure::ExpiryWorker) => {
            two_phase_revocation_receipt.fail_before_ready_for_test()
        }
        _ => two_phase_revocation_receipt,
    };
    let auth_construction_receipts = AuthProgramConstructionReceipts {
        connection_binding: Some(&connection_binding_receipt),
        two_phase_revocation: Some(&two_phase_revocation_receipt),
        auth_coordinator: Some(AuthCoordinatorReadinessReceipt::Construction(
            &auth_coordinator_receipt,
        )),
    };
    let mut auth_program_readiness = runtime_auth_program_readiness(
        secret_read_process_prerequisites,
        &auth_construction_receipts,
        false,
        false,
    );
    let auth_mode_state = match compose_auth_mode_startup_with_embedded(
        &args,
        embedded_startup_artifacts.as_ref(),
        &mut snapback,
        &mut auth_runtime,
        &auth_program_readiness,
    )
    .await
    {
        Ok(state) => state,
        Err(error) => {
            emit_startup_artifact_refusal(&error);
            return Err(error.into());
        }
    };
    auth_runtime.seed_durable_clock_floor(&mut snapback)?;
    validate_auth_transport(
        bind_ip,
        startup_profile,
        &auth_mode_state,
        args.allow_insecure_dev_auth,
    )?;
    if let Some(path) = args.trusted_composition_activation.as_deref() {
        let artifact = crate::completeness::read_trusted_activation(path)?;
        snapback.install_trusted_composition_activation(artifact)?;
    }

    // ReadyV1 runs one bounded pass before bind. Missing/corrupt keyrings stay
    // in the provider health fact while the committed durable outcome carries
    // its immediate-retry schedule into the worker.
    let auth_gc_initial_delay = auth_runtime
        .run_startup_gc(&mut snapback)
        .await
        .map_err(|error| anyhow::Error::new(error.into_snapback_error()))?
        .map(|pass| pass.next_delay())
        .unwrap_or(crate::auth::lifecycle::AUTH_GC_INTERVAL);

    // Rebuild from the exact post-compose, post-restore, post-GC durable state
    // before ownership moves into SharedSnapback or a listener can serve.
    // @ref LLP 0059#startup-rebuild-and-deadline-derivation — pre-bind publication is all-or-nothing.
    let (auth_coordinator, auth_coordinator_installed) =
        auth_coordinator_receipt.build(&auth_runtime, &mut snapback)?;

    // A sessions deployment cannot publish an app-data listener until its
    // boot-local invalidation namespace has both a committed durable sequence
    // and an authenticated descriptor. A failed MAC/keyring lookup burns the
    // reserved sequence and aborts startup.
    // @ref LLP 0053#invalidation-is-an-obligation-not-a-message — reserve and authenticate the never-reused boot issuer before app-data bind.
    let auth_invalidation = if auth_mode_state.active == crate::manifest::AuthMode::Sessions {
        let (app_id, target_profile_id) = {
            let schema = snapback.auth_database_mut().schema();
            (
                schema.app_id.clone(),
                schema.target_profile.clone().unwrap_or_else(|| {
                    crate::manifest::TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned()
                }),
            )
        };
        let (issuer, authorization, version_stream) = auth_runtime
            .reserve_invalidation_boot_issuer(&mut snapback, &target_profile_id, &app_id)
            .map_err(|error| anyhow::Error::new(error.into_snapback_error()))?;
        snapback.install_auth_invalidation(issuer.clone(), authorization, version_stream)?;
        Some(issuer)
    } else {
        None
    };

    let read_lane = snapback.read_lane();
    let ephemeral = snapback.ephemeral_api();
    let missing_config = snapback.required_missing_config();
    let loaded_app_id = snapback.loaded_app_id();
    let state = Arc::new(Mutex::new(snapback));
    debug_assert_eq!(server_context.profile, startup_profile);
    let (app_state, secret_read_operator) = AppState::new_with_secret_read_operator(
        state.clone(),
        read_lane,
        ephemeral.clone(),
        server_context,
    );
    // @ref LLP 0060#d1-plaintext-listener-fence — the request-path fence
    // consumes this bit per request; the production profile never honors it.
    // Install the CLI override into the runtime middleware consults per
    // request. Pre-bind validation alone is not enough: without this the
    // request-path fence (`auth_app_data_refusal`) sees the default `false`
    // and refuses every app-data route on a non-loopback bind even though the
    // operator passed the flag — found by the first remote drill target, where
    // the bind is 0.0.0.0 behind the platform TLS edge. Middleware still
    // ignores the bit under the production profile.
    let app_state = app_state.with_insecure_dev_auth_override(args.allow_insecure_dev_auth);
    // @ref LLP 0098#43-ordering — install the verified attestation before any
    // listener binds. Installation performs the durable monotonicity check that
    // the pre-bind phase could not, then creates the replay/nonce and throttle
    // tables and applies the LLP 0077 decision-1 sender-replay epoch floor.
    let app_state = match verified_hosted_admission.as_ref() {
        Some((verified, _)) => {
            let authority = {
                let mut snapback = state.lock().await;
                snapback
                    .auth_database_mut()
                    .install_hosted_admission(verified, hosted_now_ms())
                    .map_err(anyhow::Error::new)?
            };
            app_state
                .with_hosted_serving_authority(authority)
                .map_err(anyhow::Error::new)?
        }
        None => app_state,
    };
    // Startup selection uses the same gate as runtime PUT, after hosted
    // authority has reached its final pre-bind classification.
    //
    // @ref LLP 0167#authority-one-activation-chokepoint — env activation is
    //   a startup failure on ceiling or environment refusal, never a clamp.
    let startup_network_profile_env = match std::env::var("SNAPBACK_NETWORK_PROFILE") {
        Ok(value) => Some(value),
        Err(std::env::VarError::NotPresent) => None,
        Err(std::env::VarError::NotUnicode(_)) => {
            return Err(anyhow::Error::new(crate::diagnostic::SnapbackError::error(
                crate::network_profile::NETWORK_PROFILE_INVALID_CODE,
                "network-profile",
                "SNAPBACK_NETWORK_PROFILE must be valid Unicode",
            )));
        }
    };
    let startup_network_profile = app_state
        .activate_network_profile_env(startup_network_profile_env.as_deref())
        .map_err(anyhow::Error::new)?;
    // @ref LLP 0098#24-renewal-and-the-honest-cost-of-pre-signing — an admission
    // lives at most five minutes, so a deployment that serves longer needs its
    // authority replaced in place. The loop only ever installs another
    // independently verified snapshot; when the document stops covering the
    // clock it installs nothing and the incumbent expires, so withdrawal is
    // composed with rather than suppressed.
    if let Some((verified, renewal)) = verified_hosted_admission {
        let handle = app_state.hosted_serving_handle();
        let renewal_state = state.clone();
        let mut installed_issued_at_ms = verified.issued_at_ms();
        if let Some(handle) = handle {
            tokio::spawn(async move {
                let interval = std::time::Duration::from_millis(
                    crate::auth::hosted_edge::ADMISSION_RENEWAL_INTERVAL_MS,
                );
                loop {
                    tokio::time::sleep(interval).await;
                    let now_ms = hosted_now_ms();
                    let renewed = {
                        let mut snapback = renewal_state.lock().await;
                        snapback.auth_database_mut().renew_hosted_admission(
                            &renewal,
                            installed_issued_at_ms,
                            now_ms,
                        )
                    };
                    match renewed {
                        Ok(Some((authority, issued_at_ms))) => {
                            if handle.install(authority) {
                                installed_issued_at_ms = issued_at_ms;
                            }
                        }
                        // Incumbent still current: nothing to do.
                        Ok(None) => {}
                        // A document that no longer covers the clock, or a
                        // successor that fails any clause, leaves the incumbent
                        // to expire on its own terms. Withdrawal is the
                        // designed outcome, not an error to route around.
                        Err(_) => {}
                    }
                }
            });
        }
    }
    let app_state = app_state.with_auth_runtime(&auth_runtime, auth_coordinator.clone());
    let app_state = match auth_invalidation {
        Some(issuer) => app_state.with_auth_invalidation(issuer),
        None => app_state,
    };
    // The lease route shares the installed provider/keyring service and the
    // boot-local invalidation issuer. Publish item 8's readiness fact only
    // after both request-side services inhabit the clone-shared AppState; no
    // handshake can advertise a lease path that startup has not installed.
    let authorized_lease_ready = auth_mode_state.active == crate::manifest::AuthMode::Sessions;
    let installed_auth_receipts = AuthProgramConstructionReceipts {
        connection_binding: Some(&connection_binding_receipt),
        two_phase_revocation: Some(&two_phase_revocation_receipt),
        auth_coordinator: Some(AuthCoordinatorReadinessReceipt::Installed(
            &auth_coordinator_installed,
        )),
    };
    auth_program_readiness = runtime_auth_program_readiness(
        secret_read_process_prerequisites,
        &installed_auth_receipts,
        authorized_lease_ready,
        authorized_lease_ready,
    );
    let app_state = app_state
        .with_auth_runtime_facts(auth_mode_state.clone(), auth_program_readiness.clone())
        .map_err(anyhow::Error::new)?;
    let app_state = match secret_read_proof_root {
        Some(root) => app_state.with_secret_read_mint_bridge(SecretReadMintBridge::new(
            secret_read_operator,
            root,
            startup_nonce.clone(),
        )),
        None => app_state,
    };
    let mut app_state = match impersonation_capabilities {
        Some(registry) => app_state.with_impersonation_capabilities(registry),
        None => app_state,
    };
    // Consume the connection-binding construction receipt before acquiring a
    // socket. `SnapbackApp::bind` later installs listener-owned transport
    // posture into this already-complete application.
    // @ref LLP 0059#handshake-and-activation — construction failure precedes socket acquisition.
    let app = connection_binding_receipt.build(app_state.clone());
    let auth_terminal_sink = app_state.auth_terminal_lifecycle.expiry_sink();
    // The expiry authority is process-critical in sessions mode. Construct it,
    // wait for its running handshake, and only then bind any listener.
    // @ref LLP 0059#startup-rebuild-and-deadline-derivation — a sessions
    //   listener cannot exist without a supervised terminal worker.
    let mut auth_expiry_worker = two_phase_revocation_receipt
        .spawn(
            state.clone(),
            auth_coordinator.clone(),
            auth_terminal_sink.clone(),
        )
        .await
        .map_err(anyhow::Error::new)?;
    let listener = match bind_listener(&bind_ip.to_string(), args.port).await {
        Ok(listener) => listener,
        Err(error) => {
            auth_expiry_worker.abort();
            return Err(error);
        }
    };
    let local_addr = match listener.local_addr() {
        Ok(address) => address,
        Err(error) => {
            auth_expiry_worker.abort();
            return Err(error.into());
        }
    };

    // @ref LLP 0017#serving-model — capture the bound address so the admin API
    // reports host/port/uptime and gates by loopback vs non-loopback.
    debug_assert_eq!(loopback, local_addr.ip().is_loopback());
    let published_server_context = Arc::make_mut(&mut app_state.server);
    published_server_context.record_bound_address(local_addr);
    if let Some(lock) = database_lock.as_mut() {
        lock.record_server(&local_addr.ip().to_string(), local_addr.port())?;
    }

    let mut impersonation_capability_file_display = None;
    if let Some(operator) = impersonation_operator {
        if let Some(target) = ready_target.as_mut() {
            let ready_file = target.pinned_path().to_path_buf();
            let temporary = impersonation_temp_path
                .as_deref()
                .context("impersonation sidecar temporary path was not allocated")?;
            let path = operator
                .publish_with(&ready_file, |path, bytes| {
                    target.publish_owner_only_sibling_atomic(path, temporary, bytes)
                })
                .with_context(|| {
                    format!(
                        "failed to publish owner-only impersonation capability for {}",
                        ready_file.display()
                    )
                })?;
            anyhow::ensure!(
                impersonation_capability_file.as_deref() == Some(path.as_path()),
                "impersonation publisher returned a non-mechanical sidecar path"
            );
            impersonation_capability_file_display = Some(path.display().to_string());
        } else {
            emit_impersonation_capability_to_controlling_terminal(operator)
                .map_err(|_| anyhow::Error::new(ready_descriptor_required_error()))?;
        }
    }

    // @ref LLP 0030#readiness-and-port-discovery — the readiness file is
    // the structured handshake: out-of-band so launcher stdout (cargo build
    // noise) cannot corrupt it; aligned with the LLP 0024 target shape.
    if let Some(target) = ready_target.as_mut() {
        let path = target.pinned_path().to_path_buf();
        let descriptor = crate::host_ops::HostReadyDescriptor {
            schema_version: SNAPBACK_SCHEMA_VERSION.to_owned(),
            descriptor_kind: crate::host_ops::HOST_READY_DESCRIPTOR_KIND.to_owned(),
            startup_id: crate::ids::mint_time_ordered(crate::ids::Kind::Startup),
            ready: true,
            server_url: format!("http://{local_addr}"),
            host: local_addr.ip().to_string(),
            port: local_addr.port(),
            pid: std::process::id(),
            // The identity handshake `snapback stop` verifies before it
            // signals this pid: the same per-process nonce /health reports.
            startup_nonce: Some(startup_nonce.clone()),
            target: crate::host_ops::HostOpsTarget {
                app_id: loaded_app_id.clone(),
                app_root: None,
                target_profile: crate::manifest::TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned(),
                server_url: Some(format!("http://{local_addr}")),
            },
            database: crate::host_ops::HostReadyDatabase {
                mode: if args.memory { "memory" } else { "file" }.to_owned(),
                path: database_path
                    .as_ref()
                    .map(|path| path.display().to_string()),
            },
            started_at_ms: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|elapsed| elapsed.as_millis() as u64)
                .unwrap_or(0),
            admin_gated: token_configured || !loopback,
            admin_token_file: admin_token_file_display.clone(),
            secret_read_root_file: secret_read_root_file
                .as_ref()
                .map(|path| path.display().to_string()),
            impersonation_capability_file: impersonation_capability_file_display.clone(),
            diagnostics: auth_startup_diagnostics.clone(),
        };
        target
            .write_atomic_protected(
                &format!("{}\n", serde_json::to_string_pretty(&descriptor)?),
                &managed_paths,
                ready_temp_path
                    .as_deref()
                    .context("ready-file temporary path was not allocated")?,
            )
            .with_context(|| format!("failed to write ready file {}", path.display()))?;
        println!(
            "ready file: {}",
            args.ready_file.as_deref().unwrap_or(&path).display()
        );
    }

    println!("snapback listening on http://{local_addr}");
    if !startup_network_profile.profile.is_normal() {
        // @ref LLP 0167#honesty-requirements — a non-normal boot profile is
        //   visible in startup/readiness output rather than silently active.
        println!(
            "network profile: {} (startup env)",
            startup_network_profile.profile.name
        );
    }
    println!("admin console: http://{local_addr}/_snapback/admin");
    if let Some(db_path) = &database_path {
        println!("sqlite database: {}", db_path.display());
    }
    // @ref LLP 0017#security-defaults — be explicit about how admin is gated.
    if !loopback && !token_configured {
        println!(
            "admin: DISABLED on this non-loopback bind — set SNAPBACK_ADMIN_TOKEN to enable it"
        );
    } else if let Some(minted) = &minted_token {
        // The minted-token surfacing (ENG-23443): the value is printed on the
        // start that minted it; afterwards the 0600 file is the capability
        // hand-off — reading it as this user is what local admin means.
        println!("admin: writes require the minted local admin token (SNAPBACK_ADMIN_TOKEN unset)");
        if minted.fresh {
            println!("admin token: {}", minted.token);
        }
        if let Some(file) = &minted.file {
            println!("admin token file: {}", file.display());
        }
    } else {
        println!("admin: writes require SNAPBACK_ADMIN_TOKEN");
    }
    // @ref LLP 0036#the-setup-wizard-d3 — the printed setup line is the
    // install instruction. Artifacts usually load after boot (the same line
    // then prints from the functions/load handler); this covers a boot that
    // already has declarations in hand.
    if !missing_config.is_empty() {
        println!(
            "config: {} required entr{} missing ({}) → http://{local_addr}/_snapback/admin/setup",
            missing_config.len(),
            if missing_config.len() == 1 {
                "y"
            } else {
                "ies"
            },
            missing_config.join(", "),
        );
    }

    // No background source may mint an invocation root until every fallible
    // startup publication (operator sidecars, ready descriptor, and console
    // handoff) has succeeded. From this point the only ordinary exit is server
    // shutdown, where all three handles are aborted below.
    let cron_autonomy_disabled = derived_fork_boot
        || args.cron_disabled
        || server::cron_autonomy_disabled(std::env::var("SNAPBACK_CRON_DISABLED").ok().as_deref());
    if cron_autonomy_disabled {
        // The switch is meant for suites/dev loops; say so at boot rather
        // than letting an inert scheduler present as a mystery.
        println!(
            "cron: autonomous scheduling disabled (SNAPBACK_CRON_DISABLED / --cron-disabled); \
             definitions still load and POST /_snapback/api/cron/tick runs due jobs"
        );
    }
    let cron_scheduler = (auth_mode_state.app_data_availability
        == crate::auth::mode::AppDataAvailability::Available)
        .then(|| server::spawn_cron_scheduler(state.clone(), cron_autonomy_disabled));
    // The jobs worker is the one-off-work sibling: its own disable switch
    // (SNAPBACK_JOBS_DISABLED) idles autonomy while the admin forced drain
    // (POST /_snapback/api/jobs/drain) keeps claiming due jobs — the
    // deterministic seam LLP 0115 CV-9 requires (LLP 0070 first slice).
    let jobs_autonomy_disabled = derived_fork_boot
        || server::jobs_autonomy_disabled(std::env::var("SNAPBACK_JOBS_DISABLED").ok().as_deref());
    let jobs_worker = (auth_mode_state.app_data_availability
        == crate::auth::mode::AppDataAvailability::Available)
        .then(|| server::spawn_jobs_worker(state.clone(), jobs_autonomy_disabled));
    let asset_runner = (auth_mode_state.app_data_availability
        == crate::auth::mode::AppDataAvailability::Available)
        .then(|| {
            server::spawn_asset_maintenance_loop(
                state.clone(),
                derived_fork_boot
                    || server::asset_runner_disabled(
                        std::env::var("SNAPBACK_ASSET_RUNNER_DISABLED")
                            .ok()
                            .as_deref(),
                    ),
            )
        });
    let maintenance_worker = server::spawn_maintenance_worker(app_state);
    let auth_maintenance_worker = crate::auth::runtime::spawn_auth_gc_worker(
        state,
        auth_runtime.clone(),
        auth_coordinator.clone(),
        auth_terminal_sink,
        auth_gc_initial_delay,
    );
    let server = app
        .bind(listener)?
        .serve_with_graceful_shutdown(shutdown_signal());
    tokio::pin!(server);
    let fork_expiry =
        wait_for_derived_fork_expiry(database_path.clone(), derived_fork_lineage);
    tokio::pin!(fork_expiry);
    let (server_result, expired_fork_shutdown): (anyhow::Result<()>, bool) = tokio::select! {
        result = &mut server => (result.map_err(anyhow::Error::new), false),
        stopped = auth_expiry_worker.stopped() => {
            let _ = auth_coordinator.fail_global_closed();
            let error = stopped.err().unwrap_or_else(|| {
                crate::diagnostic::SnapbackError::error(
                    "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE",
                    "auth",
                    "the process-local session expiry worker stopped unexpectedly",
                )
            });
            (Err(anyhow::Error::new(error)), false)
        }
        (lineage, observed_at_ms) = &mut fork_expiry => {
            let error = crate::instance_fork::server_expired_error(&lineage, observed_at_ms);
            eprintln!("{}: {}", error.diagnostic.code, error.diagnostic.message);
            (Err(anyhow::Error::new(error)), true)
        }
    };
    if let Some(scheduler) = cron_scheduler {
        scheduler.abort();
    }
    if let Some(worker) = jobs_worker {
        worker.abort();
    }
    if let Some(runner) = asset_runner {
        runner.abort();
    }
    maintenance_worker.abort();
    if let Some(worker) = auth_maintenance_worker {
        worker.abort();
    }
    auth_expiry_worker.abort();
    drop(database_lock);
    if let Some(target) = ready_target.as_ref() {
        let _ = target.remove_impersonation_capability();
        let _ = target.remove_secret_read_root();
        // Keep the non-secret descriptor after an expiry-driven shutdown.
        // The next registry-bound reap can then verify the recorded PID is
        // gone before removing the directory; deleting it here would discard
        // the only safe process-identity proof available to the reaper.
        if !expired_fork_shutdown {
            let _ = target.remove_published();
        }
    }
    // An in-memory instance's minted token dies with the process; remove the
    // ready-file-sibling token file it was handed off through (ENG-23443).
    // File-backed instances keep their token file across restarts.
    if let (Some(target), Some(path), Some(identity)) = (
        ready_target.as_ref(),
        ready_sibling_token_file.as_deref(),
        ready_sibling_token_identity,
    ) {
        let _ = target.remove_sibling_if_identity(path, identity);
    }
    server_result?;
    Ok(())
}

/// Serve the closed collision-recovery posture after ordinary manifest
/// admission has failed and the read-only catalog probe classified that exact
/// failure. Every eligibility/authority input is settled before listener bind;
/// this function never constructs `LocalSnapback` or the ordinary app router.
// @ref LLP 0057#reachability — recovery startup exposes only health and the selected, AdminWrite+sbic-gated rescue carrier, and remains restart-required after success.
#[allow(clippy::too_many_arguments)]
async fn run_auth_collision_recovery(
    args: &Args,
    bind_ip: IpAddr,
    database_path: PathBuf,
    mut database_lock: DatabaseInstanceLock,
    mut ready_target: Option<ReadyFileTarget>,
    managed_paths: Vec<ManagedPath>,
    ready_temp_path: Option<PathBuf>,
    impersonation_capability_file: Option<PathBuf>,
    impersonation_temp_path: Option<PathBuf>,
) -> anyhow::Result<()> {
    crate::auth::recovery::validate_loopback_bind_ip(bind_ip)?;
    let mut server_context =
        ServerContext::new(bind_ip.to_string(), 0, true).with_auth_deployment(args.auth_deployment);

    // Profiles that can never expose recovery fail before token minting or any
    // other startup publication.
    if matches!(
        server_context.profile,
        crate::admin::ServerProfile::Demo | crate::admin::ServerProfile::Prod
    ) {
        crate::auth::recovery::validate_startup_context(&server_context)?;
    }

    // Tokenless loopback is explicitly not authority in recovery posture.
    // Resolve or mint the same owner-only database sibling before binding.
    let mut minted_token = None;
    if server_context.admin_token.is_none() {
        let resolved = crate::admin::resolve_serve_admin_token(
            None,
            Some(crate::admin::admin_token_sibling(&database_path)),
        )?;
        server_context.install_minted_token(&resolved);
        minted_token = Some(resolved);
    }
    server_context.install_console_credential_store(&database_path)?;
    crate::auth::recovery::validate_startup_context(&server_context)?;

    let startup_nonce = crate::identity::binary_identity().startup_nonce;
    let (impersonation_registry, impersonation_operator) =
        crate::admin_impersonation::ImpersonationCapabilityRegistry::generate(
            startup_nonce.clone(),
            &crate::auth::crypto::OsRandom,
        )
        .context("failed to generate the auth-recovery impersonation capability")?;
    crate::auth::recovery::validate_impersonation_registry(&impersonation_registry)?;

    // Bind the concrete address returned by the pre-bind loopback resolver;
    // never re-resolve the caller's hostname after validating it.
    let listener = bind_listener(&bind_ip.to_string(), args.port).await?;
    let local_addr = listener.local_addr()?;
    anyhow::ensure!(
        local_addr.ip().is_loopback(),
        "SNAPBACK_AUTH_TABLE_COLLISION: auth collision recovery refused a non-loopback listener"
    );
    server_context.record_bound_address(local_addr);
    let profile = server_context.profile;
    let admin_token_file_display = server_context
        .admin_token_file
        .as_ref()
        .map(|path| path.display().to_string());
    let runtime = crate::auth::recovery::CollisionRecoveryRuntime::new(
        database_path.clone(),
        server_context,
        impersonation_registry,
    )?;
    let app = crate::auth::recovery::router(runtime);
    database_lock.record_server(&local_addr.ip().to_string(), local_addr.port())?;

    // Publish the validated process capability only after bind and runtime
    // construction succeed. ReadyFileTarget's drop guard removes a sidecar if
    // the later ready-descriptor publication fails.
    let mut impersonation_capability_file_display = None;
    if let Some(target) = ready_target.as_mut() {
        let ready_file = target.pinned_path().to_path_buf();
        let temporary = impersonation_temp_path
            .as_deref()
            .context("auth-recovery impersonation sidecar temporary path was not allocated")?;
        let path = impersonation_operator
            .publish_with(&ready_file, |path, bytes| {
                target.publish_owner_only_sibling_atomic(path, temporary, bytes)
            })
            .with_context(|| {
                format!(
                    "failed to publish owner-only auth-recovery impersonation capability for {}",
                    ready_file.display()
                )
            })?;
        anyhow::ensure!(
            impersonation_capability_file.as_deref() == Some(path.as_path()),
            "auth-recovery impersonation publisher returned a non-mechanical sidecar path"
        );
        impersonation_capability_file_display = Some(path.display().to_string());
    } else {
        emit_impersonation_capability_to_controlling_terminal(impersonation_operator)
            .context("failed to emit the auth-recovery capability to the controlling terminal")?;
    }

    if let Some(target) = ready_target.as_mut() {
        let path = target.pinned_path().to_path_buf();
        let descriptor = HostReadyDescriptor {
            schema_version: SNAPBACK_SCHEMA_VERSION.to_owned(),
            descriptor_kind: crate::host_ops::HOST_READY_DESCRIPTOR_KIND.to_owned(),
            startup_id: crate::ids::mint_time_ordered(crate::ids::Kind::Startup),
            ready: true,
            server_url: format!("http://{local_addr}"),
            host: local_addr.ip().to_string(),
            port: local_addr.port(),
            pid: std::process::id(),
            startup_nonce: Some(startup_nonce),
            target: crate::host_ops::HostOpsTarget {
                // The recovery process never accepts the stored manifest just
                // to populate descriptor identity.
                app_id: String::new(),
                app_root: None,
                target_profile: match profile {
                    crate::admin::ServerProfile::Dev => {
                        crate::manifest::TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned()
                    }
                    crate::admin::ServerProfile::Test => "local-test-sqlite-ibex".to_owned(),
                    crate::admin::ServerProfile::Demo | crate::admin::ServerProfile::Prod => {
                        unreachable!("recovery context rejected this profile before bind")
                    }
                },
                server_url: Some(format!("http://{local_addr}")),
            },
            database: crate::host_ops::HostReadyDatabase {
                mode: "file".to_owned(),
                path: Some(database_path.display().to_string()),
            },
            started_at_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|elapsed| elapsed.as_millis() as u64)
                .unwrap_or(0),
            admin_gated: true,
            admin_token_file: admin_token_file_display,
            secret_read_root_file: None,
            impersonation_capability_file: impersonation_capability_file_display,
            diagnostics: Vec::new(),
        };
        target
            .write_atomic_protected(
                &format!("{}\n", serde_json::to_string_pretty(&descriptor)?),
                &managed_paths,
                ready_temp_path
                    .as_deref()
                    .context("auth-recovery ready-file temporary path was not allocated")?,
            )
            .with_context(|| {
                format!(
                    "failed to write auth-recovery ready file {}",
                    path.display()
                )
            })?;
        println!(
            "ready file: {}",
            args.ready_file.as_deref().unwrap_or(&path).display()
        );
    }

    println!("snapback auth recovery listening on http://{local_addr}");
    println!(
        "auth recovery: table collision; application service is unavailable and restart is required after rescue"
    );
    println!("sqlite database: {}", database_path.display());
    if let Some(minted) = &minted_token {
        println!("admin: auth recovery requires the minted local admin token");
        if minted.fresh {
            println!("admin token: {}", minted.token);
        }
        if let Some(file) = &minted.file {
            println!("admin token file: {}", file.display());
        }
    } else {
        println!("admin: auth recovery requires SNAPBACK_ADMIN_TOKEN");
    }

    let server_result = axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await;
    drop(database_lock);
    if let Some(target) = ready_target.as_ref() {
        let _ = target.remove_impersonation_capability();
        let _ = target.remove_secret_read_root();
        let _ = target.remove_published();
    }
    server_result?;
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };

    #[cfg(unix)]
    {
        let terminate = async {
            if let Ok(mut signal) =
                tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            {
                signal.recv().await;
            } else {
                std::future::pending::<()>().await;
            }
        };
        tokio::select! {
            _ = ctrl_c => {}
            _ = terminate => {}
        }
    }

    #[cfg(not(unix))]
    ctrl_c.await;
}

#[derive(Clone, Debug)]
struct ManagedPath {
    label: &'static str,
    path: PathBuf,
}

fn managed_startup_paths(
    database: Option<&Path>,
    ready_file: Option<&Path>,
) -> anyhow::Result<Vec<ManagedPath>> {
    let mut paths = Vec::new();
    if let Some(database) = database {
        paths.push(ManagedPath {
            label: "database",
            path: database.to_path_buf(),
        });
        paths.push(ManagedPath {
            label: "database lock",
            path: crate::instance_lock::lock_path_for_database(database)?,
        });
        #[cfg(any(target_vendor = "apple", target_os = "linux"))]
        paths.push(ManagedPath {
            label: "target-instance reservation",
            path: crate::instance_lock::target_reservation_path_for_database(database)?,
        });
        paths.push(ManagedPath {
            label: "config store",
            path: crate::config::ConfigStore::path_for_database(database),
        });
        let telemetry = crate::telemetry::Telemetry::path_for_database(database);
        paths.push(ManagedPath {
            label: "telemetry store",
            path: telemetry.clone(),
        });
        for (label, suffix) in [
            ("telemetry SQLite WAL", "-wal"),
            ("telemetry SQLite shared memory", "-shm"),
            ("telemetry SQLite journal", "-journal"),
        ] {
            paths.push(ManagedPath {
                label,
                path: path_with_filename_suffix(&telemetry, suffix)?,
            });
        }
        paths.push(ManagedPath {
            label: "admin token",
            path: crate::admin::admin_token_sibling(database),
        });
        paths.push(ManagedPath {
            label: "auth keyring",
            path: crate::auth::keyring::AuthKeyringStore::keyring_path(database),
        });
        for (label, suffix) in [
            ("SQLite WAL", "-wal"),
            ("SQLite shared memory", "-shm"),
            ("SQLite journal", "-journal"),
        ] {
            paths.push(ManagedPath {
                label,
                path: path_with_filename_suffix(database, suffix)?,
            });
        }
    }
    if let Some(ready_file) = ready_file {
        paths.push(ManagedPath {
            label: "ready file",
            path: ready_file.to_path_buf(),
        });
        if database.is_none() {
            paths.push(ManagedPath {
                label: "admin token",
                path: crate::admin::admin_token_sibling(ready_file),
            });
        }
        paths.push(ManagedPath {
            label: "secret-read root",
            path: secret_read_root_sibling(ready_file),
        });
        paths.push(ManagedPath {
            label: "impersonation capability",
            path: crate::admin_impersonation::impersonation_capability_sibling(ready_file)?,
        });
    }
    Ok(paths)
}

fn path_with_filename_suffix(path: &Path, suffix: &str) -> anyhow::Result<PathBuf> {
    let mut name = path
        .file_name()
        .context("managed path must include a file name")?
        .to_os_string();
    name.push(suffix);
    Ok(path.with_file_name(name))
}

fn resolve_candidate_path(path: &Path) -> anyhow::Result<PathBuf> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()?.join(path)
    };
    if let Ok(canonical) = std::fs::canonicalize(&absolute) {
        return Ok(canonical);
    }

    // Resolve the deepest existing ancestor, then append the missing suffix.
    // This normalizes `..` and catches a symlinked parent even before the final
    // artifact exists.
    let mut ancestor = absolute.as_path();
    let mut suffix: Vec<OsString> = Vec::new();
    loop {
        if let Ok(canonical) = std::fs::canonicalize(ancestor) {
            let mut resolved = canonical;
            for component in suffix.iter().rev() {
                resolved.push(component);
            }
            return Ok(normalize_lexically(&resolved));
        }
        let Some(name) = ancestor.file_name() else {
            // `Path::file_name` is intentionally empty for a trailing `..`.
            // Normalize that lexical spelling and restart the existing-prefix
            // walk; a root path itself would already have canonicalized.
            let normalized = normalize_lexically(&absolute);
            if normalized != absolute {
                return resolve_candidate_path(&normalized);
            }
            anyhow::bail!(
                "managed path has no resolvable ancestor: {}",
                path.display()
            );
        };
        suffix.push(name.to_os_string());
        ancestor = ancestor.parent().with_context(|| {
            format!("managed path has no resolvable parent: {}", path.display())
        })?;
    }
}

fn normalize_lexically(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                normalized.pop();
            }
            component => normalized.push(component.as_os_str()),
        }
    }
    normalized
}

#[cfg(unix)]
fn existing_file_identity(path: &Path) -> Option<(u64, u64)> {
    use std::os::unix::fs::MetadataExt as _;
    std::fs::metadata(path)
        .ok()
        .map(|metadata| (metadata.dev(), metadata.ino()))
}

#[cfg(not(unix))]
fn existing_file_identity(_path: &Path) -> Option<(u64, u64)> {
    None
}

fn validate_path_disjointness(paths: &[ManagedPath]) -> anyhow::Result<()> {
    // @ref LLP 0030#readiness-and-port-discovery — readiness publication is
    // atomic and must not alias another managed startup capability/artifact.
    let resolved = paths
        .iter()
        .map(|path| {
            Ok((
                path,
                resolve_candidate_path(&path.path)?,
                existing_file_identity(&path.path),
            ))
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    for left in 0..resolved.len() {
        for right in (left + 1)..resolved.len() {
            let (left_path, left_resolved, left_id) = &resolved[left];
            let (right_path, right_resolved, right_id) = &resolved[right];
            let same_inode = left_id.is_some() && left_id == right_id;
            let nested = left_resolved.starts_with(right_resolved)
                || right_resolved.starts_with(left_resolved);
            if nested || same_inode {
                anyhow::bail!(
                    "SNAPBACK_READY_FILE_PATH_COLLISION: {} ({}) aliases or nests beneath {} ({}); every managed startup artifact must have a distinct, non-nested path and file identity",
                    left_path.label,
                    left_path.path.display(),
                    right_path.label,
                    right_path.path.display(),
                );
            }
        }
    }
    Ok(())
}

/// A ready-file pathname resolved once into a stable parent-directory
/// capability. The original pathname is deliberately not reused for writes or
/// removal: an attacker (or launcher cleanup) may replace one of its symlinked
/// parents after startup validation.
struct ReadyFileTarget {
    pinned_path: PathBuf,
    file_name: OsString,
    published_identity: Option<(u64, u64)>,
    parent_identity: Option<(u64, u64)>,
    impersonation_identity: Option<(PathBuf, (u64, u64))>,
    secret_read_root_identity: Option<(PathBuf, (u64, u64))>,
    #[cfg(unix)]
    _secret_read_root_handle: Option<std::fs::File>,
    #[cfg(unix)]
    parent: std::fs::File,
}

impl ReadyFileTarget {
    fn open(path: &Path) -> anyhow::Result<Self> {
        Self::open_with_parent_policy(path, true)
    }

    /// Attach-side variant: resolving an existing trusted descriptor must
    /// never create a caller-controlled parent as a side effect.
    fn open_existing(path: &Path) -> anyhow::Result<Self> {
        Self::open_with_parent_policy(path, false)
    }

    fn open_with_parent_policy(path: &Path, create_parent: bool) -> anyhow::Result<Self> {
        let file_name = path
            .file_name()
            .context("ready file path must include a file name")?
            .to_os_string();
        let parent = path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty());
        let parent = match parent {
            Some(parent) if parent.is_absolute() => parent.to_path_buf(),
            Some(parent) => std::env::current_dir()?.join(parent),
            None => std::env::current_dir()?,
        };
        if create_parent {
            std::fs::create_dir_all(&parent).with_context(|| {
                format!("failed to create ready-file directory {}", parent.display())
            })?;
        }
        let canonical_parent = std::fs::canonicalize(&parent).with_context(|| {
            format!(
                "failed to resolve ready-file directory {}",
                parent.display()
            )
        })?;

        #[cfg(unix)]
        let (parent, parent_identity) = {
            use std::os::unix::fs::{MetadataExt as _, OpenOptionsExt as _};
            let parent = std::fs::OpenOptions::new()
                .read(true)
                .custom_flags(libc::O_DIRECTORY | libc::O_CLOEXEC | libc::O_NOFOLLOW)
                .open(&canonical_parent)
                .with_context(|| {
                    format!(
                        "failed to pin ready-file directory {}",
                        canonical_parent.display()
                    )
                })?;
            let metadata = parent.metadata()?;
            let identity = (metadata.dev(), metadata.ino());
            (parent, Some(identity))
        };
        #[cfg(not(unix))]
        let parent_identity = existing_file_identity(&canonical_parent);

        Ok(Self {
            pinned_path: canonical_parent.join(&file_name),
            file_name,
            published_identity: None,
            parent_identity,
            impersonation_identity: None,
            secret_read_root_identity: None,
            #[cfg(unix)]
            _secret_read_root_handle: None,
            #[cfg(unix)]
            parent,
        })
    }

    fn pinned_path(&self) -> &Path {
        &self.pinned_path
    }

    fn ensure_parent_path_identity(&self) -> std::io::Result<()> {
        let parent = self.pinned_path.parent().ok_or_else(|| {
            std::io::Error::new(ErrorKind::InvalidInput, "ready file has no parent")
        })?;
        if self.parent_identity.is_some() && existing_file_identity(parent) != self.parent_identity
        {
            return Err(std::io::Error::new(
                ErrorKind::PermissionDenied,
                "ready-file parent identity changed after startup validation",
            ));
        }
        Ok(())
    }

    fn sibling_name<'a>(&self, path: &'a Path) -> std::io::Result<&'a std::ffi::OsStr> {
        if path.parent() != self.pinned_path.parent() {
            return Err(std::io::Error::new(
                ErrorKind::InvalidInput,
                "managed ready-file sibling is outside the pinned parent",
            ));
        }
        path.file_name().ok_or_else(|| {
            std::io::Error::new(ErrorKind::InvalidInput, "managed sibling has no file name")
        })
    }

    #[cfg(unix)]
    fn read_owner_only_sibling(&self, path: &Path) -> std::io::Result<Vec<u8>> {
        use std::ffi::CString;
        use std::io::Read as _;
        use std::os::fd::{AsRawFd as _, FromRawFd as _};
        use std::os::unix::ffi::OsStrExt as _;

        const MAX_TOKEN_FILE_BYTES: u64 = 4 * 1024;
        self.ensure_parent_path_identity()?;
        let name = CString::new(self.sibling_name(path)?.as_bytes())
            .map_err(|_| std::io::Error::new(ErrorKind::InvalidInput, "sibling contains NUL"))?;
        // SAFETY: name is one NUL-terminated component and parent is the live
        // directory capability pinned at startup.
        let fd = unsafe {
            libc::openat(
                self.parent.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            return Err(std::io::Error::last_os_error());
        }
        // SAFETY: openat returned this owned descriptor exactly once.
        let file = unsafe { std::fs::File::from_raw_fd(fd) };
        crate::secure_file::validate_and_repair_owner_only(&file)?;
        let mut bytes = Vec::new();
        (&file)
            .take(MAX_TOKEN_FILE_BYTES + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() as u64 > MAX_TOKEN_FILE_BYTES {
            return Err(std::io::Error::new(
                ErrorKind::InvalidData,
                "admin token file exceeds the bounded capability-file limit",
            ));
        }
        Ok(bytes)
    }

    #[cfg(unix)]
    fn write_owner_only_sibling(&self, path: &Path, bytes: &[u8]) -> std::io::Result<()> {
        use std::ffi::CString;
        use std::io::{Seek as _, Write as _};
        use std::os::fd::{AsRawFd as _, FromRawFd as _};
        use std::os::unix::ffi::OsStrExt as _;

        self.ensure_parent_path_identity()?;
        let name = CString::new(self.sibling_name(path)?.as_bytes())
            .map_err(|_| std::io::Error::new(ErrorKind::InvalidInput, "sibling contains NUL"))?;
        let parent_fd = self.parent.as_raw_fd();
        let open_existing = || {
            // SAFETY: name is one component relative to the pinned parent.
            unsafe {
                libc::openat(
                    parent_fd,
                    name.as_ptr(),
                    libc::O_RDWR | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                )
            }
        };
        let mut fd = open_existing();
        if fd < 0 && std::io::Error::last_os_error().kind() == ErrorKind::NotFound {
            // SAFETY: as above; O_EXCL refuses a racing/pre-created inode.
            fd = unsafe {
                libc::openat(
                    parent_fd,
                    name.as_ptr(),
                    libc::O_RDWR
                        | libc::O_CREAT
                        | libc::O_EXCL
                        | libc::O_NOFOLLOW
                        | libc::O_CLOEXEC,
                    0o600,
                )
            };
            if fd < 0 && std::io::Error::last_os_error().kind() == ErrorKind::AlreadyExists {
                fd = open_existing();
            }
        }
        if fd < 0 {
            return Err(std::io::Error::last_os_error());
        }
        // SAFETY: openat returned this owned descriptor exactly once.
        let mut file = unsafe { std::fs::File::from_raw_fd(fd) };
        crate::secure_file::validate_and_repair_owner_only(&file)?;
        file.set_len(0)?;
        file.seek(std::io::SeekFrom::Start(0))?;
        file.write_all(bytes)?;
        file.sync_all()
    }

    /// Strict attach-side read through the already-pinned ready-file parent.
    /// Unlike the legacy admin-token helper this never repairs permissions and
    /// refuses hard links, replacement during the read, and oversized data.
    #[cfg(unix)]
    fn read_strict_owner_only_sibling(
        &self,
        path: &Path,
        maximum_bytes: usize,
    ) -> std::io::Result<Vec<u8>> {
        use std::ffi::CString;
        use std::io::Read as _;
        use std::os::fd::{AsRawFd as _, FromRawFd as _};
        use std::os::unix::ffi::OsStrExt as _;
        use std::os::unix::fs::{MetadataExt as _, PermissionsExt as _};
        use zeroize::{Zeroize as _, Zeroizing};

        self.ensure_parent_path_identity()?;
        let sibling = self.sibling_name(path)?;
        let name = CString::new(sibling.as_bytes())
            .map_err(|_| std::io::Error::new(ErrorKind::InvalidInput, "sibling contains NUL"))?;
        // SAFETY: the single-component name is resolved beneath the live
        // directory capability and O_NOFOLLOW refuses a symlink entry.
        let fd = unsafe {
            libc::openat(
                self.parent.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            return Err(std::io::Error::last_os_error());
        }
        // SAFETY: openat returned this owned descriptor exactly once.
        let file = unsafe { std::fs::File::from_raw_fd(fd) };
        let before = file.metadata()?;
        // SAFETY: geteuid has no preconditions and reads process identity.
        let effective_uid = unsafe { libc::geteuid() };
        if !before.file_type().is_file()
            || before.uid() != effective_uid
            || before.permissions().mode() & 0o777 != 0o600
            || before.nlink() != 1
            || before.len() > maximum_bytes as u64
        {
            return Err(std::io::Error::new(
                ErrorKind::PermissionDenied,
                "strict ready-file sibling invariants are not satisfied",
            ));
        }
        let identity = (before.dev(), before.ino());
        let mut bytes = Zeroizing::new(Vec::with_capacity(before.len() as usize));
        if let Err(error) = (&file)
            .take(maximum_bytes as u64 + 1)
            .read_to_end(&mut bytes)
        {
            bytes.zeroize();
            return Err(error);
        }
        let after = file.metadata()?;
        if bytes.len() > maximum_bytes
            || after.len() != bytes.len() as u64
            || after.uid() != effective_uid
            || after.permissions().mode() & 0o777 != 0o600
            || after.nlink() != 1
            || (after.dev(), after.ino()) != identity
            || self.identity_at(sibling)? != Some(identity)
        {
            bytes.zeroize();
            return Err(std::io::Error::new(
                ErrorKind::PermissionDenied,
                "strict ready-file sibling changed while it was read",
            ));
        }
        Ok(std::mem::take(&mut *bytes))
    }

    #[cfg(not(unix))]
    fn read_owner_only_sibling(&self, path: &Path) -> std::io::Result<Vec<u8>> {
        self.ensure_parent_path_identity()?;
        crate::secure_file::read_owner_only(path)
    }

    #[cfg(not(unix))]
    fn write_owner_only_sibling(&self, path: &Path, bytes: &[u8]) -> std::io::Result<()> {
        self.ensure_parent_path_identity()?;
        crate::secure_file::write_owner_only(path, bytes)
    }

    #[cfg(not(unix))]
    fn read_strict_owner_only_sibling(
        &self,
        _path: &Path,
        _maximum_bytes: usize,
    ) -> std::io::Result<Vec<u8>> {
        Err(std::io::Error::new(
            ErrorKind::Unsupported,
            "strict descriptor-relative capability reads are unavailable on this host",
        ))
    }

    #[cfg(unix)]
    fn publish_owner_only_sibling_atomic(
        &mut self,
        path: &Path,
        temporary_path: &Path,
        bytes: &[u8],
    ) -> std::io::Result<()> {
        use std::ffi::CString;
        use std::io::Write as _;
        use std::os::fd::{AsRawFd as _, FromRawFd as _};
        use std::os::unix::ffi::OsStrExt as _;
        use std::os::unix::fs::{MetadataExt as _, PermissionsExt as _};

        self.ensure_parent_path_identity()?;
        let final_name = CString::new(self.sibling_name(path)?.as_bytes()).map_err(|_| {
            std::io::Error::new(ErrorKind::InvalidInput, "managed sibling contains NUL")
        })?;
        let temporary_name =
            CString::new(self.sibling_name(temporary_path)?.as_bytes()).map_err(|_| {
                std::io::Error::new(ErrorKind::InvalidInput, "temporary sibling contains NUL")
            })?;
        let parent_fd = self.parent.as_raw_fd();
        let prior_identity = self.validated_impersonation_destination(path)?;
        // SAFETY: the temporary name is one component relative to the pinned
        // directory. O_EXCL and O_NOFOLLOW refuse every pre-created/racing
        // inode instead of truncating it.
        let fd = unsafe {
            libc::openat(
                parent_fd,
                temporary_name.as_ptr(),
                libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                0o600,
            )
        };
        if fd < 0 {
            return Err(std::io::Error::last_os_error());
        }
        // SAFETY: openat returned this owned descriptor exactly once.
        let mut temporary = unsafe { std::fs::File::from_raw_fd(fd) };
        let created_metadata = temporary.metadata()?;
        let created_identity = (created_metadata.dev(), created_metadata.ino());
        let mut published_identity = None;
        let result = (|| -> std::io::Result<(u64, u64)> {
            temporary.set_permissions(std::fs::Permissions::from_mode(0o600))?;
            temporary.write_all(bytes)?;
            temporary.sync_all()?;
            let metadata = temporary.metadata()?;
            let identity = (metadata.dev(), metadata.ino());
            if identity != created_identity {
                return Err(std::io::Error::new(
                    ErrorKind::PermissionDenied,
                    "impersonation sidecar temporary inode changed during publication",
                ));
            }
            if let Some(prior_identity) = prior_identity {
                // Exchange is one atomic directory operation: if the final
                // entry changed after validation, the displaced entry's inode
                // exposes that race and we swap back instead of accepting it.
                renameat_exchange(parent_fd, &temporary_name, &final_name)?;
                // From this point the canonical path may contain the new
                // process bearer. Track it before every fallible verification
                // or rollback step so outer failure cleanup can remove it by
                // inode even if an attempted exchange-back also fails.
                published_identity = Some(identity);
                let final_after = self.identity_at(self.sibling_name(path)?)?;
                let displaced = self.identity_at(self.sibling_name(temporary_path)?)?;
                if final_after != Some(identity) || displaced != Some(prior_identity) {
                    let _ = renameat_exchange(parent_fd, &temporary_name, &final_name);
                    return Err(std::io::Error::new(
                        ErrorKind::PermissionDenied,
                        "impersonation sidecar destination changed during atomic replacement",
                    ));
                }
                if let Err(error) = self.remove_sibling_if_identity(temporary_path, prior_identity)
                {
                    let _ = renameat_exchange(parent_fd, &temporary_name, &final_name);
                    return Err(error);
                }
                if self
                    .identity_at(self.sibling_name(temporary_path)?)?
                    .is_some()
                {
                    return Err(std::io::Error::new(
                        ErrorKind::PermissionDenied,
                        "displaced impersonation sidecar could not be removed safely",
                    ));
                }
            } else {
                renameat_no_replace(parent_fd, &temporary_name, &final_name)?;
                published_identity = Some(identity);
            }
            if self.identity_at(self.sibling_name(path)?)? != Some(identity) {
                return Err(std::io::Error::new(
                    ErrorKind::PermissionDenied,
                    "published owner-only sibling identity changed during publication",
                ));
            }
            self.parent.sync_all()?;
            Ok(identity)
        })();
        if result.is_err() {
            let _ = self.remove_sibling_if_identity(temporary_path, created_identity);
            if let Some(identity) = published_identity {
                let _ = self.remove_sibling_if_identity(path, identity);
            }
            let _ = self.parent.sync_all();
        }
        let identity = result?;
        self.impersonation_identity = Some((path.to_path_buf(), identity));
        Ok(())
    }

    #[cfg(unix)]
    fn validated_impersonation_destination(
        &self,
        path: &Path,
    ) -> std::io::Result<Option<(u64, u64)>> {
        use std::ffi::CString;
        use std::io::Read as _;
        use std::os::fd::{AsRawFd as _, FromRawFd as _};
        use std::os::unix::ffi::OsStrExt as _;
        use std::os::unix::fs::{MetadataExt as _, PermissionsExt as _};

        let name = CString::new(self.sibling_name(path)?.as_bytes()).map_err(|_| {
            std::io::Error::new(ErrorKind::InvalidInput, "managed sibling contains NUL")
        })?;
        // SAFETY: one component relative to the pinned directory; O_NOFOLLOW
        // refuses a stale or attacker-installed symlink.
        let fd = unsafe {
            libc::openat(
                self.parent.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            let error = std::io::Error::last_os_error();
            return if error.kind() == ErrorKind::NotFound {
                Ok(None)
            } else {
                Err(error)
            };
        }
        // SAFETY: openat returned this owned descriptor exactly once.
        let mut file = unsafe { std::fs::File::from_raw_fd(fd) };
        let metadata = file.metadata()?;
        if !metadata.file_type().is_file()
            || metadata.file_type().is_symlink()
            || metadata.permissions().mode() & 0o777 != 0o600
            || metadata.uid() != unsafe { libc::geteuid() }
            || metadata.nlink() != 1
            || metadata.len()
                > crate::admin_impersonation::MAX_IMPERSONATION_CAPABILITY_FILE_BYTES as u64
        {
            return Err(std::io::Error::new(
                ErrorKind::PermissionDenied,
                "existing impersonation sidecar is not a strict owner-only regular file",
            ));
        }
        let mut bytes = zeroize::Zeroizing::new(Vec::new());
        file.by_ref()
            .take(crate::admin_impersonation::MAX_IMPERSONATION_CAPABILITY_FILE_BYTES as u64 + 1)
            .read_to_end(&mut bytes)?;
        crate::admin_impersonation::parse_impersonation_capability_file(bytes).map_err(|_| {
            std::io::Error::new(
                ErrorKind::InvalidData,
                "existing impersonation sidecar is not a canonical process bearer",
            )
        })?;
        Ok(Some((metadata.dev(), metadata.ino())))
    }

    #[cfg(not(unix))]
    fn publish_owner_only_sibling_atomic(
        &mut self,
        _path: &Path,
        _temporary_path: &Path,
        _bytes: &[u8],
    ) -> std::io::Result<()> {
        Err(std::io::Error::new(
            ErrorKind::Unsupported,
            "atomic owner-only sibling publication is unavailable on this host",
        ))
    }

    fn remove_impersonation_capability(&self) -> std::io::Result<()> {
        let Some((path, identity)) = self.impersonation_identity.as_ref() else {
            return Ok(());
        };
        self.remove_sibling_if_identity(path, *identity)
    }

    /// Bind the secret-read proof-root sidecar this serve resolved (read or
    /// created) to the target's cleanup custody. The sidecar is named after
    /// and scoped to the ready descriptor, so it must not survive the
    /// descriptor on shutdown (0137 G1) — unlike the database-scoped reattach
    /// family (`<db>.admin-token`), which persists by design.
    fn adopt_secret_read_root_sibling(&mut self, path: &Path) -> std::io::Result<()> {
        #[cfg(unix)]
        let identity = {
            use std::ffi::CString;
            use std::os::fd::{AsRawFd as _, FromRawFd as _};
            use std::os::unix::ffi::OsStrExt as _;
            use std::os::unix::fs::{MetadataExt as _, PermissionsExt as _};

            self.ensure_parent_path_identity()?;
            let sibling = self.sibling_name(path)?;
            let name = CString::new(sibling.as_bytes()).map_err(|_| {
                std::io::Error::new(ErrorKind::InvalidInput, "managed sibling contains NUL")
            })?;
            // SAFETY: name is one component beneath the pinned parent;
            // O_NOFOLLOW refuses a replacement symlink.
            let fd = unsafe {
                libc::openat(
                    self.parent.as_raw_fd(),
                    name.as_ptr(),
                    libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                )
            };
            if fd < 0 {
                return Err(std::io::Error::last_os_error());
            }
            // SAFETY: openat returned this owned descriptor exactly once.
            let file = unsafe { std::fs::File::from_raw_fd(fd) };
            let metadata = file.metadata()?;
            // SAFETY: geteuid has no preconditions and reads process identity.
            let effective_uid = unsafe { libc::geteuid() };
            if !metadata.file_type().is_file()
                || metadata.uid() != effective_uid
                || metadata.permissions().mode() & 0o777 != 0o600
                || metadata.nlink() != 1
            {
                return Err(std::io::Error::new(
                    ErrorKind::PermissionDenied,
                    "secret-read root sidecar is not a strict owner-only regular file",
                ));
            }
            let identity = (metadata.dev(), metadata.ino());
            if self.identity_at(sibling)? != Some(identity) {
                return Err(std::io::Error::new(
                    ErrorKind::PermissionDenied,
                    "secret-read root sidecar changed while it was adopted",
                ));
            }
            // Keeping the adopted inode open prevents a remove-and-recreate
            // race from reusing its number before identity-guarded cleanup.
            self._secret_read_root_handle = Some(file);
            Some(identity)
        };
        #[cfg(not(unix))]
        let identity = existing_file_identity(path);
        let identity = identity.ok_or_else(|| {
            std::io::Error::new(
                ErrorKind::NotFound,
                "resolved secret-read root sidecar is missing",
            )
        })?;
        self.secret_read_root_identity = Some((path.to_path_buf(), identity));
        Ok(())
    }

    fn remove_secret_read_root(&self) -> std::io::Result<()> {
        let Some((path, identity)) = self.secret_read_root_identity.as_ref() else {
            return Ok(());
        };
        self.remove_sibling_if_identity(path, *identity)
    }

    fn write_atomic_protected(
        &mut self,
        content: &str,
        protected_paths: &[ManagedPath],
        tmp_path: &Path,
    ) -> anyhow::Result<()> {
        // Re-check after the parent capability is pinned. This is the path
        // identity that publication will actually use, not a mutable symlink
        // spelling supplied by the caller.
        self.ensure_parent_path_identity()?;
        validate_path_disjointness(protected_paths)?;

        #[cfg(unix)]
        {
            self.write_atomic_unix(content, tmp_path)
        }
        #[cfg(not(unix))]
        {
            let write_result = (|| -> anyhow::Result<()> {
                crate::secure_file::write_new_owner_only(tmp_path, content.as_bytes())?;
                std::fs::rename(tmp_path, &self.pinned_path)?;
                self.published_identity = existing_file_identity(&self.pinned_path);
                Ok(())
            })();
            if write_result.is_err() {
                let _ = std::fs::remove_file(tmp_path);
            }
            write_result
        }
    }

    #[cfg(unix)]
    fn write_atomic_unix(&mut self, content: &str, tmp_path: &Path) -> anyhow::Result<()> {
        use std::ffi::CString;
        use std::io::Write as _;
        use std::os::fd::{AsRawFd as _, FromRawFd as _};
        use std::os::unix::ffi::OsStrExt as _;
        use std::os::unix::fs::{MetadataExt as _, PermissionsExt as _};

        let tmp_name = tmp_path
            .file_name()
            .context("ready-file temporary path must include a file name")?;
        let tmp_name = CString::new(tmp_name.as_bytes())
            .context("ready-file temporary name contains a NUL byte")?;
        let final_name = CString::new(self.file_name.as_bytes())
            .context("ready-file name contains a NUL byte")?;
        let parent_fd = self.parent.as_raw_fd();
        // SAFETY: both names are single NUL-terminated path components and
        // parent_fd is a live O_DIRECTORY capability owned by this target.
        let fd = unsafe {
            libc::openat(
                parent_fd,
                tmp_name.as_ptr(),
                libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                0o600,
            )
        };
        if fd < 0 {
            return Err(std::io::Error::last_os_error()).with_context(|| {
                format!(
                    "failed to create owner-only temporary ready file {}",
                    tmp_path.display()
                )
            });
        }
        // SAFETY: openat returned this owned descriptor and it is transferred
        // exactly once into File.
        let mut temporary = unsafe { std::fs::File::from_raw_fd(fd) };
        // `openat`'s mode is filtered by the process umask. Repair the opened
        // inode through its descriptor so both permissive and restrictive
        // ambient masks result in the documented exact 0600 handoff.
        temporary.set_permissions(std::fs::Permissions::from_mode(0o600))?;
        let write_result = (|| -> anyhow::Result<(u64, u64)> {
            temporary.write_all(content.as_bytes())?;
            temporary.sync_all()?;
            let metadata = temporary.metadata()?;
            let identity = (metadata.dev(), metadata.ino());
            // SAFETY: source and destination are components relative to the
            // same still-live directory descriptor.
            let renamed = unsafe {
                libc::renameat(parent_fd, tmp_name.as_ptr(), parent_fd, final_name.as_ptr())
            };
            if renamed != 0 {
                return Err(std::io::Error::last_os_error()).with_context(|| {
                    format!(
                        "failed to atomically publish ready file {}",
                        self.pinned_path.display()
                    )
                });
            }
            let published = self.identity_at(&self.file_name)?.with_context(|| {
                format!(
                    "published ready file disappeared from {}",
                    self.pinned_path.display()
                )
            })?;
            anyhow::ensure!(
                published == identity,
                "published ready file identity changed during descriptor-relative publication"
            );
            Ok(identity)
        })();
        if write_result.is_err() {
            // SAFETY: the name remains relative to the pinned parent. ENOENT
            // is expected after a successful rename followed by a later check.
            unsafe {
                libc::unlinkat(parent_fd, tmp_name.as_ptr(), 0);
            }
        }
        self.published_identity = Some(write_result?);
        Ok(())
    }

    #[cfg(unix)]
    fn identity_at(&self, name: &std::ffi::OsStr) -> std::io::Result<Option<(u64, u64)>> {
        use std::ffi::CString;
        use std::mem::MaybeUninit;
        use std::os::fd::AsRawFd as _;
        use std::os::unix::ffi::OsStrExt as _;

        let name = CString::new(name.as_bytes())
            .map_err(|_| std::io::Error::new(ErrorKind::InvalidInput, "name contains NUL"))?;
        let mut stat = MaybeUninit::<libc::stat>::uninit();
        // SAFETY: stat points to writable storage, name is NUL-terminated, and
        // the parent descriptor remains live for this target's lifetime.
        let result = unsafe {
            libc::fstatat(
                self.parent.as_raw_fd(),
                name.as_ptr(),
                stat.as_mut_ptr(),
                libc::AT_SYMLINK_NOFOLLOW,
            )
        };
        if result == 0 {
            // SAFETY: fstatat initialized stat on success.
            let stat = unsafe { stat.assume_init() };
            return Ok(Some((
                crate::instance_lock::stat_device_id(&stat),
                stat.st_ino,
            )));
        }
        let error = std::io::Error::last_os_error();
        if error.kind() == ErrorKind::NotFound {
            Ok(None)
        } else {
            Err(error)
        }
    }

    fn remove_published(&self) -> std::io::Result<()> {
        let Some(identity) = self.published_identity else {
            return Ok(());
        };
        self.remove_sibling_if_identity(&self.pinned_path, identity)
    }

    fn remove_sibling_if_identity(&self, path: &Path, identity: (u64, u64)) -> std::io::Result<()> {
        let name = path.file_name().ok_or_else(|| {
            std::io::Error::new(ErrorKind::InvalidInput, "managed sibling has no file name")
        })?;

        #[cfg(unix)]
        {
            use std::ffi::CString;
            use std::os::fd::AsRawFd as _;
            use std::os::unix::ffi::OsStrExt as _;
            if self.identity_at(name)? != Some(identity) {
                return Ok(());
            }
            let name = CString::new(name.as_bytes()).map_err(|_| {
                std::io::Error::new(ErrorKind::InvalidInput, "managed sibling contains NUL")
            })?;
            // SAFETY: name is a single path component relative to the pinned
            // parent capability. Identity was verified immediately above.
            if unsafe { libc::unlinkat(self.parent.as_raw_fd(), name.as_ptr(), 0) } != 0 {
                let error = std::io::Error::last_os_error();
                if error.kind() != ErrorKind::NotFound {
                    return Err(error);
                }
            }
            Ok(())
        }
        #[cfg(not(unix))]
        {
            if existing_file_identity(path) == Some(identity) {
                std::fs::remove_file(path)
            } else {
                Ok(())
            }
        }
    }
}

impl Drop for ReadyFileTarget {
    fn drop(&mut self) {
        let _ = self.remove_impersonation_capability();
        // The secret-read proof root shares the descriptor's identity; a
        // target that dies without reaching the explicit shutdown removal
        // (startup failure, task abort) must not orphan it (0137 G1).
        let _ = self.remove_secret_read_root();
    }
}

#[cfg(target_vendor = "apple")]
fn renameat_no_replace(
    parent_fd: std::os::fd::RawFd,
    source: &std::ffi::CStr,
    destination: &std::ffi::CStr,
) -> std::io::Result<()> {
    // SAFETY: both names are NUL-terminated components relative to the live
    // pinned directory descriptor, and the OS retains neither pointer.
    let result = unsafe {
        libc::renameatx_np(
            parent_fd,
            source.as_ptr(),
            parent_fd,
            destination.as_ptr(),
            libc::RENAME_EXCL,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(target_os = "linux")]
fn renameat_no_replace(
    parent_fd: std::os::fd::RawFd,
    source: &std::ffi::CStr,
    destination: &std::ffi::CStr,
) -> std::io::Result<()> {
    // SAFETY: as above; RENAME_NOREPLACE makes a racing destination fail.
    let result = unsafe {
        libc::renameat2(
            parent_fd,
            source.as_ptr(),
            parent_fd,
            destination.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(target_vendor = "apple")]
fn renameat_exchange(
    parent_fd: std::os::fd::RawFd,
    source: &std::ffi::CStr,
    destination: &std::ffi::CStr,
) -> std::io::Result<()> {
    // SAFETY: both names are NUL-terminated components relative to the live
    // pinned directory; RENAME_SWAP replaces neither inode non-atomically.
    let result = unsafe {
        libc::renameatx_np(
            parent_fd,
            source.as_ptr(),
            parent_fd,
            destination.as_ptr(),
            libc::RENAME_SWAP,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(target_os = "linux")]
fn renameat_exchange(
    parent_fd: std::os::fd::RawFd,
    source: &std::ffi::CStr,
    destination: &std::ffi::CStr,
) -> std::io::Result<()> {
    // SAFETY: as above; RENAME_EXCHANGE is the Linux atomic swap primitive.
    let result = unsafe {
        libc::renameat2(
            parent_fd,
            source.as_ptr(),
            parent_fd,
            destination.as_ptr(),
            libc::RENAME_EXCHANGE,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(all(unix, not(any(target_vendor = "apple", target_os = "linux"))))]
fn renameat_no_replace(
    _parent_fd: std::os::fd::RawFd,
    _source: &std::ffi::CStr,
    _destination: &std::ffi::CStr,
) -> std::io::Result<()> {
    Err(std::io::Error::new(
        ErrorKind::Unsupported,
        "descriptor-relative no-replace rename is unavailable on this host",
    ))
}

#[cfg(all(unix, not(any(target_vendor = "apple", target_os = "linux"))))]
fn renameat_exchange(
    _parent_fd: std::os::fd::RawFd,
    _source: &std::ffi::CStr,
    _destination: &std::ffi::CStr,
) -> std::io::Result<()> {
    Err(std::io::Error::new(
        ErrorKind::Unsupported,
        "descriptor-relative atomic exchange is unavailable on this host",
    ))
}

#[cfg(test)]
fn write_ready_file_atomic(path: &Path, content: &str) -> anyhow::Result<()> {
    let tmp_path = ready_file_temp_path(path)?;
    write_ready_file_atomic_protected(
        path,
        content,
        &[
            ManagedPath {
                label: "ready file",
                path: path.to_path_buf(),
            },
            ManagedPath {
                label: "ready-file temporary artifact",
                path: tmp_path.clone(),
            },
        ],
        &tmp_path,
    )
}

fn ready_file_temp_path(path: &Path) -> anyhow::Result<PathBuf> {
    let file_name = path
        .file_name()
        .context("ready file path must include a file name")?
        .to_string_lossy();
    let tmp_name = format!(".{file_name}.tmp-{}", Uuid::now_v7().simple());
    Ok(path.with_file_name(tmp_name))
}

#[cfg(test)]
fn write_ready_file_atomic_protected(
    path: &Path,
    content: &str,
    protected_paths: &[ManagedPath],
    tmp_path: &Path,
) -> anyhow::Result<()> {
    let mut target = ReadyFileTarget::open(path)?;
    target.write_atomic_protected(content, protected_paths, tmp_path)
}

#[cfg(any(test, not(any(target_vendor = "apple", target_os = "linux"))))]
fn prepare_database_path(path: &Path) -> anyhow::Result<PathBuf> {
    if let Some(parent) = path.parent()
        && !parent.as_os_str().is_empty()
    {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed to create database directory {}", parent.display()))?;
    }
    resolve_database_path(path)
}

#[cfg(test)]
type StartupTargetReservationHook = Box<dyn FnOnce(&Path)>;

#[cfg(test)]
thread_local! {
    static BEFORE_STARTUP_TARGET_RESERVATION: std::cell::RefCell<Option<StartupTargetReservationHook>> = const { std::cell::RefCell::new(None) };
}

fn before_startup_target_reservation(database: &Path) {
    #[cfg(test)]
    BEFORE_STARTUP_TARGET_RESERVATION.with(|slot| {
        if let Some(operation) = slot.borrow_mut().take() {
            operation(database);
        }
    });
    #[cfg(not(test))]
    let _ = database;
}

/// Every supported file-backed startup takes the same outer instance-name
/// reservation as restore. Only the outer parent is created before acquisition;
/// the target instance is opened or created descriptor-relatively and remains
/// pinned until the inside-instance lock and database have been opened. Hosts
/// without descriptor-relative restore publication retain legacy startup.
#[allow(clippy::needless_return)] // Each cfg branch is a complete platform implementation.
fn prepare_database_path_for_startup(
    path: &Path,
) -> anyhow::Result<(PathBuf, Option<StartupTargetReservation>)> {
    #[cfg(any(target_vendor = "apple", target_os = "linux"))]
    {
        let absolute = if path.is_absolute() {
            path.to_path_buf()
        } else {
            std::env::current_dir()?.join(path)
        };
        let database_name = absolute
            .file_name()
            .filter(|name| *name != "." && *name != "..")
            .context("database path must include a file name")?
            .to_os_string();
        let instance = absolute
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .context("database path must include an instance directory")?;
        let instance_name = instance
            .file_name()
            .filter(|name| *name != "." && *name != "..")
            .context("database instance path must have a name")?;
        let outer_parent = instance
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));
        std::fs::create_dir_all(outer_parent).with_context(|| {
            format!(
                "failed to create database outer directory {}",
                outer_parent.display()
            )
        })?;
        let canonical_parent = std::fs::canonicalize(outer_parent).with_context(|| {
            format!(
                "failed to resolve database outer directory {}",
                outer_parent.display()
            )
        })?;
        // Preserve canonical alias behavior for existing database and instance
        // symlinks. A genuinely absent instance instead stays expressed as one
        // child of the canonical outer parent so only the reservation may
        // create it.
        let database = match std::fs::canonicalize(&absolute) {
            Ok(database) => database,
            Err(error) if error.kind() == ErrorKind::NotFound => {
                match std::fs::canonicalize(instance) {
                    Ok(instance) => instance.join(&database_name),
                    Err(error) if error.kind() == ErrorKind::NotFound => {
                        canonical_parent.join(instance_name).join(&database_name)
                    }
                    Err(error) => {
                        return Err(error).with_context(|| {
                            format!(
                                "failed to resolve database instance directory {}",
                                instance.display()
                            )
                        });
                    }
                }
            }
            Err(error) => {
                return Err(error).with_context(|| {
                    format!("failed to resolve database path {}", absolute.display())
                });
            }
        };
        before_startup_target_reservation(&database);
        let reservation = StartupTargetReservation::acquire(&database)
            .context("database target could not be reserved and pinned before startup")?;
        return Ok((database, Some(reservation)));
    }
    #[cfg(not(any(target_vendor = "apple", target_os = "linux")))]
    Ok((prepare_database_path(path)?, None))
}

fn resolve_database_path(path: &Path) -> anyhow::Result<PathBuf> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()?.join(path)
    };
    match std::fs::canonicalize(&absolute) {
        Ok(resolved) => return Ok(resolved),
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(error) => {
            return Err(error).with_context(|| {
                format!("failed to resolve database path {}", absolute.display())
            });
        }
    }
    let file_name = absolute
        .file_name()
        .context("database path must include a file name")?
        .to_os_string();
    let parent = absolute
        .parent()
        .context("database path must include a parent directory")?;
    let parent = std::fs::canonicalize(parent)
        .with_context(|| format!("failed to resolve database directory {}", parent.display()))?;
    Ok(parent.join(file_name))
}

/// Resolve a restore target without creating or canonicalizing the required-
/// absent instance directory. Only its existing parent becomes authority for
/// the later descriptor-relative no-replace publication.
fn resolve_restore_database_path(path: &Path) -> anyhow::Result<PathBuf> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()?.join(path)
    };
    let database_name = absolute
        .file_name()
        .filter(|name| *name != "." && *name != "..")
        .context("restore database path must include a file name")?
        .to_os_string();
    let instance = absolute
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .context("restore database must be inside a new instance directory")?;
    let instance_name = instance
        .file_name()
        .filter(|name| *name != "." && *name != "..")
        .context("restore target instance directory must have a name")?
        .to_os_string();
    let existing_parent = instance
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let existing_parent = std::fs::canonicalize(existing_parent).with_context(|| {
        format!(
            "SNAPBACK_AUTH_BACKUP_INVALID: failed to resolve restore parent {}",
            existing_parent.display()
        )
    })?;
    Ok(existing_parent.join(instance_name).join(database_name))
}

async fn bind_listener(host: &str, port: Option<u16>) -> anyhow::Result<TcpListener> {
    if let Some(port) = port {
        return TcpListener::bind((host, port))
            .await
            .with_context(|| format!("failed to bind Snapback server to {host}:{port}"));
    }

    // @ref LLP 0010#required-tool-surfaces — normal local startup should tolerate
    // multiple Snapback instances by scanning the default dev range; explicit
    // `--port` remains a pinned automation contract.
    bind_first_available(host, DEFAULT_PORT_RANGE_START..=DEFAULT_PORT_RANGE_END).await
}

async fn resolve_bind_ip(host: &str) -> anyhow::Result<IpAddr> {
    if let Ok(address) = host.parse::<IpAddr>() {
        return Ok(address);
    }
    tokio::net::lookup_host((host, 0))
        .await
        .with_context(|| format!("failed to resolve bind host {host}"))?
        .next()
        .map(|address| address.ip())
        .with_context(|| format!("bind host {host} resolved to no addresses"))
}

async fn bind_first_available<I>(host: &str, ports: I) -> anyhow::Result<TcpListener>
where
    I: IntoIterator<Item = u16>,
{
    let mut tried = Vec::new();
    for port in ports {
        tried.push(port);
        match TcpListener::bind((host, port)).await {
            Ok(listener) => return Ok(listener),
            Err(err) if err.kind() == ErrorKind::AddrInUse => {}
            Err(err) => {
                return Err(err)
                    .with_context(|| format!("failed to bind Snapback server to {host}:{port}"));
            }
        }
    }

    anyhow::bail!(
        "no available Snapback port on {host}; tried {}",
        describe_ports(&tried)
    );
}

fn describe_ports(ports: &[u16]) -> String {
    match ports {
        [] => "no ports".to_owned(),
        [port] => port.to_string(),
        _ if ports
            .windows(2)
            .all(|pair| pair[0].checked_add(1) == Some(pair[1])) =>
        {
            format!("{}-{}", ports[0], ports[ports.len() - 1])
        }
        _ => ports
            .iter()
            .map(u16::to_string)
            .collect::<Vec<_>>()
            .join(", "),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        AdminArgs, AdminCommand, Args, AssetsCommand, AuthCommand, AuthConstructionFailure,
        AuthCoordinatorReadinessReceipt, AuthProgramConstructionReceipts,
        BEFORE_STARTUP_TARGET_RESERVATION, Cli, ConfigCommand, ConnectionsCommand, CronCommand,
        ErrorsCommand, ForkCommand, HostCommand, JobsCommand,
        ManagedPath, NetworkProfileCommand, ReadyFileTarget, ResolvedHttpTarget, SessionCommand,
        TargetArgs, TelemetryCommand, automatic_reap_before_create, bind_first_available,
        bind_listener, console_claim_fragment_url, console_fragment_url, fork_secret_disposition,
        managed_startup_paths, mint_secret_read_via_http, parse_fork_ttl,
        parse_network_profile_selection, parse_run_args, path_segment_escape,
        path_with_filename_suffix,
        prepare_database_path, prepare_database_path_for_startup, quiet_stop_fork,
        reject_misdirected_serve_flags, render_guide_command, resolve_http_target,
        runtime_auth_program_readiness, search_guide_sections_in, validate_path_disjointness,
        validated_console_origin, validated_secret_read_root_path, write_ready_file_atomic,
        write_ready_file_atomic_protected,
    };
    use crate::guide::EmbeddedGuideFile;
    use crate::instance_lock::TargetInstanceReservation;
    use clap::{CommandFactory, Parser};
    use serde_json::json;
    use std::io::{Read as _, Write as _};
    use std::path::{Path, PathBuf};
    use std::time::Duration;
    use tokio::net::TcpListener;

    #[test]
    fn guide_cli_parses_multiword_queries_and_root_help_names_both_channels() {
        let cli = Cli::parse_from(["snapback", "guide", "live", "query"]);
        match cli.command {
            Some(HostCommand::Guide { query }) => {
                assert_eq!(query, ["live", "query"]);
            }
            _ => panic!("expected guide command"),
        }

        let help = Cli::command().render_long_help().to_string();
        assert!(help.contains("snapback guide [QUERY]"), "{help}");
        assert!(help.contains("snapback mcp"), "{help}");
    }

    #[test]
    fn guide_search_returns_matching_sections_with_stable_markdown_anchors() {
        let files = [
            EmbeddedGuideFile {
                path: "backend/example.md",
                bytes: b"---\ntitle: Example\n---\n# Example page\nIntro.\n## Live queries\nUse the live query handle.\n## Live queries\nSecond live query spelling.\n",
                content_type: "text/markdown; charset=utf-8",
            },
            EmbeddedGuideFile {
                path: crate::guide::FLAT_PATH,
                bytes: b"# Duplicate projection\nlive query handle\n",
                content_type: "text/markdown; charset=utf-8",
            },
        ];

        let matches = search_guide_sections_in(&files, "live query");
        assert_eq!(
            matches,
            [
                super::GuideSectionMatch {
                    path: "backend/example.md".to_owned(),
                    heading: "Live queries".to_owned(),
                    anchor: "live-queries".to_owned(),
                },
                super::GuideSectionMatch {
                    path: "backend/example.md".to_owned(),
                    heading: "Live queries".to_owned(),
                    anchor: "live-queries-1".to_owned(),
                },
            ]
        );
    }

    #[test]
    fn guide_channel_output_starts_with_capabilities_and_names_flat_and_mcp() {
        let output = render_guide_command(&[]);
        let capability = output.find("/capabilities.md").unwrap();
        let browse = output.find("Browse the Guide").unwrap();
        assert!(capability < browse, "{output}");
        assert!(output.contains("/_snapback/guide/flat.md"), "{output}");
        assert!(output.contains("snapback mcp"), "{output}");
    }

    #[test]
    fn fork_cli_pins_finite_ttl_and_explicit_secret_opt_in() {
        assert_eq!(parse_fork_ttl("2h").unwrap(), 7_200_000);
        assert!(parse_fork_ttl("0m").is_err());
        assert!(parse_fork_ttl("forever").is_err());
        let cli = Cli::parse_from([
            "snapback",
            "fork",
            "create",
            "--from",
            "parent.ready.json",
            "--ttl",
            "45m",
            "--with-secrets",
            "--app-root",
            "demo",
        ]);
        match cli.command {
            Some(HostCommand::Fork {
                command:
                    ForkCommand::Create {
                        from,
                        ttl,
                        with_secrets,
                        app_root,
                        ..
                    },
            }) => {
                assert_eq!(from, Some(PathBuf::from("parent.ready.json")));
                assert_eq!(ttl, "45m");
                assert!(with_secrets);
                assert_eq!(app_root, PathBuf::from("demo"));
            }
            _ => panic!("expected fork create"),
        }
    }

    #[test]
    fn fork_help_exposes_one_coherent_lifecycle_and_scalar_formats() {
        let fork_help = Cli::command()
            .find_subcommand_mut("fork")
            .expect("fork command")
            .render_long_help()
            .to_string();
        for lifecycle_word in [
            "create", "inspect", "list", "diff", "renew", "drop", "reap", "recover",
        ] {
            assert!(fork_help.contains(lifecycle_word), "{lifecycle_word}: {fork_help}");
        }

        let cli = Cli::parse_from([
            "snapback",
            "fork",
            "inspect",
            "019fd4b0-f093-7a30-835e-0c4e9ae7c7a1",
            "--format",
            "admin-token-path",
        ]);
        assert!(matches!(
            cli.command,
            Some(HostCommand::Fork {
                command: ForkCommand::Inspect {
                    format: super::ForkOutputFormat::AdminTokenPath,
                    ..
                }
            })
        ));
    }

    #[test]
    fn fork_create_refuses_when_automatic_sweep_cannot_prove_stop() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("parent.sqlite3");
        let database = crate::storage::LocalDatabase::open(&source).unwrap();
        drop(database);
        let root = directory.path().join("forks");
        std::fs::create_dir(&root).unwrap();
        let destination = root.join("fork-a");
        let receipt = crate::instance_fork::publish_managed(
            &source,
            &destination,
            "app-a",
            "parent-a",
            100,
            200,
            false,
        )
        .unwrap();
        let ready = destination.join("fork.ready.json");
        std::fs::write(&ready, b"{}").unwrap();
        crate::instance_fork::record_managed_runtime(
            &root,
            &receipt.lineage.fork_id,
            &ready,
            None,
        )
        .unwrap();

        let error = automatic_reap_before_create(&root, 200).unwrap_err();
        assert!(
            error
                .to_string()
                .contains("SNAPBACK_FORK_EXPIRED_REAP_FAILED"),
            "{error}"
        );
        let snapback_error = error
            .downcast_ref::<crate::diagnostic::SnapbackError>()
            .expect("typed refusal");
        assert!(
            snapback_error.diagnostic.details["cause"]
                .as_str()
                .is_some_and(|cause| cause.contains("SNAPBACK_FORK_READY_INVALID")),
            "the refusal carries the exact per-fork cause, got {:?}",
            snapback_error.diagnostic.details
        );
        assert!(destination.is_dir(), "failed sweep must fail closed");
    }

    #[test]
    fn fork_secret_disposition_reports_an_absent_opted_in_source_honestly() {
        let directory = tempfile::tempdir().unwrap();
        let database = directory.path().join("fork.sqlite3");
        std::fs::write(&database, []).unwrap();
        assert_eq!(
            fork_secret_disposition(true, &database),
            "copy-requested-source-absent"
        );
        assert_eq!(fork_secret_disposition(false, &database), "scrubbed");
        crate::secure_file::write_owner_only(
            &crate::config::ConfigStore::path_for_database(&database),
            br#"{"formatVersion":1,"entries":{}}"#,
        )
        .unwrap();
        assert_eq!(
            fork_secret_disposition(true, &database),
            "copied-explicitly"
        );
    }

    #[test]
    fn fork_stop_keeps_unverifiable_ready_file_while_pid_may_exist() {
        let directory = tempfile::tempdir().unwrap();
        let database = directory.path().join("fork.sqlite3");
        std::fs::write(&database, []).unwrap();
        let database = std::fs::canonicalize(database).unwrap();
        let ready = directory.path().join("fork.ready.json");
        let mut descriptor = stop_descriptor(Some("nonce-a"));
        descriptor.pid = std::process::id();
        descriptor.server_url = "http://127.0.0.1:1".to_owned();
        descriptor.database = crate::host_ops::HostReadyDatabase {
            mode: "file".to_owned(),
            path: Some(database.display().to_string()),
        };
        crate::secure_file::write_owner_only(&ready, &serde_json::to_vec(&descriptor).unwrap())
            .unwrap();
        let error = quiet_stop_fork(&ready, &database).unwrap_err();
        assert!(error.to_string().contains("SNAPBACK_FORK_STOP_UNVERIFIED"));
        assert!(ready.is_file());
    }

    fn telemetry_target_descriptor(environment_id: &str) -> crate::deploy::TargetDescriptor {
        crate::deploy::TargetDescriptor {
            schema_version: crate::deploy::TargetDescriptorVersion::V1,
            target_id: "target-cli-telemetry".to_owned(),
            project_id: "project-cli-telemetry".to_owned(),
            environment_id: environment_id.to_owned(),
            deployment_id: "deployment-cli-telemetry".to_owned(),
            database_id: "database-cli-telemetry".to_owned(),
            stream_incarnation: "stream-cli-telemetry".to_owned(),
            target_profile_id: "profile-cli-telemetry".to_owned(),
            production_class: crate::deploy::TargetProductionClass::Preview,
            adapter: crate::deploy::VmAdapterDescriptor {
                kind: crate::deploy::VmAdapterKind::SingleInstanceContainerVm,
                version: "1.0.0".to_owned(),
                driver_path: "/trusted/adapter".to_owned(),
                driver_sha256: "00".repeat(32),
                provider: "provider-cli-telemetry".to_owned(),
                account_fingerprint: "account-cli-telemetry".to_owned(),
                region: "region-cli-telemetry".to_owned(),
                public_origin: "https://cli-telemetry.example".to_owned(),
                credential_ref: "credential-cli-telemetry".to_owned(),
                state_store_ref: "state-cli-telemetry".to_owned(),
            },
            created_at_ms: 1,
        }
    }

    #[test]
    fn production_readiness_exposes_item7_before_item8() {
        let mut snapback = crate::local::LocalSnapback::memory().unwrap();
        let runtime = crate::auth::runtime::AuthRuntime::inspect(
            &mut snapback,
            None,
            crate::auth::provider::AuthProviderProfile::Test,
        )
        .unwrap();
        let connection = crate::server::connection_binding_construction_receipt();
        let revocation = runtime.two_phase_revocation_construction_receipt();
        let coordinator = runtime.auth_coordinator_construction_receipt();
        let receipts = AuthProgramConstructionReceipts {
            connection_binding: Some(&connection),
            two_phase_revocation: Some(&revocation),
            auth_coordinator: Some(AuthCoordinatorReadinessReceipt::Construction(&coordinator)),
        };
        let before_invalidation = runtime_auth_program_readiness(true, &receipts, false, false);
        assert!(before_invalidation.session_activation_ready);
        assert!(before_invalidation.authority_descriptor);
        assert!(!before_invalidation.authorization_invalidation);
        assert!(!before_invalidation.authorized_lease);

        let after_invalidation = runtime_auth_program_readiness(true, &receipts, true, false);
        assert!(after_invalidation.authority_descriptor);
        assert!(after_invalidation.authorization_invalidation);
        assert!(!after_invalidation.authorized_lease);

        let after_lease_install = runtime_auth_program_readiness(true, &receipts, true, true);
        assert!(after_lease_install.authority_descriptor);
        assert!(after_lease_install.authorization_invalidation);
        assert!(after_lease_install.authorized_lease);
    }

    #[test]
    fn admin_cli_pins_launch_and_terminal_approval_shapes() {
        let launch = Cli::parse_from([
            "snapback",
            "admin",
            "--no-open",
            "--ready-file",
            "ready.json",
        ]);
        match launch.command {
            Some(HostCommand::Admin(AdminArgs {
                no_open,
                target,
                command: None,
            })) => {
                assert!(no_open);
                assert_eq!(target.ready_file, Some(PathBuf::from("ready.json")));
            }
            other => panic!("expected admin launch command, got {other:?}"),
        }

        let approval = Cli::parse_from([
            "snapback",
            "admin",
            "approve",
            "ABCD-1234",
            "--ready-file",
            "ready.json",
        ]);
        match approval.command {
            Some(HostCommand::Admin(AdminArgs {
                command: Some(AdminCommand::Approve { code, target }),
                ..
            })) => {
                assert_eq!(code, "ABCD-1234");
                assert_eq!(target.ready_file, Some(PathBuf::from("ready.json")));
            }
            other => panic!("expected admin approval command, got {other:?}"),
        }

        let link = Cli::parse_from([
            "snapback",
            "admin",
            "link",
            "--ready-file",
            "ready.json",
            "--url-base",
            "https://console.example",
            "--no-wait",
        ]);
        match link.command {
            Some(HostCommand::Admin(AdminArgs {
                command:
                    Some(AdminCommand::Link {
                        target,
                        no_wait,
                        url_base,
                        status: None,
                        revoke: None,
                        qr: false,
                        tailscale: false,
                        lan: None,
                    }),
                ..
            })) => {
                assert!(no_wait);
                assert_eq!(target.ready_file, Some(PathBuf::from("ready.json")));
                assert_eq!(url_base.as_deref(), Some("https://console.example"));
            }
            other => panic!("expected admin claim-link command, got {other:?}"),
        }

        let lan_link = Cli::parse_from([
            "snapback",
            "admin",
            "link",
            "--lan",
            "--qr",
            "--ready-file",
            "ready.json",
        ]);
        assert!(matches!(
            lan_link.command,
            Some(HostCommand::Admin(AdminArgs {
                command: Some(AdminCommand::Link {
                    lan: Some(selector),
                    qr: true,
                    tailscale: false,
                    ..
                }),
                ..
            })) if selector.is_empty()
        ));

        let status = Cli::parse_from([
            "snapback",
            "admin",
            "link",
            "--status",
            "sbcl_0123456789abcdef0123456789abcdef",
            "--ready-file",
            "ready.json",
        ]);
        assert!(matches!(
            status.command,
            Some(HostCommand::Admin(AdminArgs {
                command: Some(AdminCommand::Link {
                    status: Some(_),
                    ..
                }),
                ..
            }))
        ));

        let url = console_fragment_url("http://127.0.0.1:4287", "sbcc_abc123", 42);
        assert_eq!(
            url,
            "http://127.0.0.1:4287/_snapback/admin/#credential=sbcc_abc123&expiresAtMs=42"
        );
        assert!(!url.contains('?'));

        assert_eq!(
            validated_console_origin("https://console.example/").unwrap(),
            "https://console.example"
        );
        for invalid in [
            "console.example",
            "ftp://console.example",
            "https://user@console.example",
            "https://console.example/path",
            "https://console.example?claim=secret",
            "https://console.example/#fragment",
        ] {
            assert!(validated_console_origin(invalid).is_err(), "{invalid}");
        }
        let claim_url = console_claim_fragment_url(
            "https://console.example",
            "sbcl_0123456789abcdef0123456789abcdef",
        );
        assert_eq!(
            claim_url,
            "https://console.example/_snapback/admin/#claim=sbcl_0123456789abcdef0123456789abcdef"
        );
        assert!(!claim_url.contains('?'));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn typed_target_runner_threads_descriptor_environment_into_store_meta() {
        let directory = tempfile::tempdir().expect("typed target runner fixture");
        let database = directory.path().join("app.sqlite3");
        let ready = directory.path().join("ready.json");
        let environment_id = "environment-from-target-descriptor";
        let target = telemetry_target_descriptor(environment_id);
        let server = tokio::spawn(super::run_for_target(
            Args {
                host: "127.0.0.1".to_owned(),
                port: Some(0),
                db: database.clone(),
                ready_file: Some(ready.clone()),
                ..Args::default()
            },
            target,
        ));
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        while !ready.exists() {
            if server.is_finished() {
                let outcome = server.await;
                panic!("typed target startup exited before readiness: {outcome:?}");
            }
            assert!(
                std::time::Instant::now() < deadline,
                "typed target startup never reached readiness"
            );
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        let telemetry = crate::telemetry::Telemetry::path_for_database(&database);
        while !telemetry.exists() {
            assert!(
                std::time::Instant::now() < deadline,
                "typed target telemetry store was never materialized"
            );
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        // @ref LLP 0154#d1--telemetry-store-a-sibling-sqlite-database-generation-bound —
        //   the sibling inode can precede the transaction that commits its
        //   authoritative telemetry_meta identity, so observe the row rather
        //   than treating file existence as store readiness.
        let (app_id, environment): (String, String) = loop {
            let connection = rusqlite::Connection::open(&telemetry)
                .expect("typed target telemetry store should open");
            let telemetry_meta_exists: bool = connection
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='telemetry_meta')",
                    [],
                    |row| row.get(0),
                )
                .unwrap_or_else(|error| {
                    panic!("typed target telemetry schema query failed: {error}")
                });
            if telemetry_meta_exists {
                let identity = connection.query_row(
                    "SELECT app_id,environment FROM telemetry_meta WHERE singleton=1",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                );
                match identity {
                    Ok(identity) => break identity,
                    Err(rusqlite::Error::QueryReturnedNoRows) => {}
                    Err(error) => panic!("typed target telemetry identity query failed: {error}"),
                }
            }
            if server.is_finished() {
                let outcome = server.await;
                panic!("typed target startup exited before telemetry identity: {outcome:?}");
            }
            assert!(
                std::time::Instant::now() < deadline,
                "typed target telemetry identity was never committed"
            );
            tokio::time::sleep(Duration::from_millis(25)).await;
        };
        assert_eq!(app_id, crate::manifest::SchemaManifest::default().app_id);
        assert_eq!(environment, environment_id);
        server.abort();
        let _ = server.await;
    }

    fn stop_descriptor(startup_nonce: Option<&str>) -> crate::host_ops::HostReadyDescriptor {
        crate::host_ops::HostReadyDescriptor {
            schema_version: crate::manifest::SNAPBACK_SCHEMA_VERSION.to_owned(),
            descriptor_kind: crate::host_ops::HOST_READY_DESCRIPTOR_KIND.to_owned(),
            startup_id: "srt_test".to_owned(),
            ready: true,
            server_url: "http://127.0.0.1:4287".to_owned(),
            host: "127.0.0.1".to_owned(),
            port: 4287,
            pid: 4242,
            startup_nonce: startup_nonce.map(str::to_owned),
            target: crate::host_ops::HostOpsTarget {
                app_id: "app_test".to_owned(),
                app_root: None,
                target_profile: crate::manifest::TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned(),
                server_url: Some("http://127.0.0.1:4287".to_owned()),
            },
            database: crate::host_ops::HostReadyDatabase {
                mode: "memory".to_owned(),
                path: None,
            },
            started_at_ms: 0,
            admin_gated: false,
            admin_token_file: None,
            secret_read_root_file: None,
            impersonation_capability_file: None,
            diagnostics: Vec::new(),
        }
    }

    fn health_with_nonce(nonce: &str) -> serde_json::Value {
        json!({ "ok": true, "binary": { "startupNonce": nonce } })
    }

    fn read_http_request(stream: &mut std::net::TcpStream) -> String {
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let mut bytes = Vec::new();
        let mut chunk = [0_u8; 4096];
        loop {
            let count = stream.read(&mut chunk).expect("read HTTP request");
            if count == 0 {
                break;
            }
            bytes.extend_from_slice(&chunk[..count]);
            let Some(header_end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") else {
                assert!(bytes.len() < 64 * 1024);
                continue;
            };
            let header_len = header_end + 4;
            let headers = String::from_utf8_lossy(&bytes[..header_len]);
            let content_len = headers
                .lines()
                .find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    name.eq_ignore_ascii_case("content-length")
                        .then(|| value.trim().parse::<usize>().ok())
                        .flatten()
                })
                .unwrap_or(0);
            if bytes.len() >= header_len + content_len {
                break;
            }
        }
        String::from_utf8(bytes).expect("HTTP request is UTF-8")
    }

    fn write_http_json(stream: &mut std::net::TcpStream, body: &serde_json::Value) {
        let body = body.to_string();
        write!(
            stream,
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .unwrap();
    }

    #[test]
    fn stop_signals_only_a_nonce_verified_server() {
        let descriptor = stop_descriptor(Some("nonce-a"));
        let verdict = super::verify_stop_target(&descriptor, &Ok(health_with_nonce("nonce-a")));
        assert!(verdict.is_ok());
    }

    #[test]
    fn stop_refuses_when_the_server_is_a_different_process() {
        let descriptor = stop_descriptor(Some("nonce-a"));
        let diagnostic = super::verify_stop_target(&descriptor, &Ok(health_with_nonce("nonce-b")))
            .expect_err("a restarted server must not be signaled via the old descriptor");
        assert_eq!(diagnostic.code, "SNAPBACK_HOST_STOP_STALE_DESCRIPTOR");
    }

    #[test]
    fn stop_refuses_when_the_server_no_longer_answers() {
        let descriptor = stop_descriptor(Some("nonce-a"));
        let diagnostic =
            super::verify_stop_target(&descriptor, &Err("connection refused".to_owned()))
                .expect_err("a dead server means the pid may be reused; never signal it");
        assert_eq!(diagnostic.code, "SNAPBACK_HOST_STOP_STALE_DESCRIPTOR");
        assert_eq!(diagnostic.details["reason"], json!("connection refused"));
    }

    #[test]
    fn stop_refuses_a_descriptor_without_a_nonce() {
        let descriptor = stop_descriptor(None);
        let diagnostic = super::verify_stop_target(&descriptor, &Ok(health_with_nonce("nonce-a")))
            .expect_err("an unverifiable descriptor must be refused");
        assert_eq!(diagnostic.code, "SNAPBACK_HOST_STOP_UNVERIFIABLE");
    }

    #[test]
    fn stop_refuses_when_the_responder_reports_no_snapback_identity() {
        let descriptor = stop_descriptor(Some("nonce-a"));
        let diagnostic = super::verify_stop_target(&descriptor, &Ok(json!({ "hello": "world" })))
            .expect_err("a non-Snapback responder must not vouch for the pid");
        assert_eq!(diagnostic.code, "SNAPBACK_HOST_STOP_UNVERIFIABLE");
    }

    #[test]
    fn no_argument_defaults_start_local_dev_server() {
        let args = Args::parse_from(["snapback"]);
        assert_eq!(args.host, "127.0.0.1");
        assert_eq!(args.port, None);
        assert_eq!(args.db, PathBuf::from(".snapback/dev.sqlite3"));
        assert!(!args.memory);
        assert!(!args.cron_disabled);
    }

    #[test]
    fn cron_disabled_flag_parses() {
        assert!(Args::parse_from(["snapback", "--cron-disabled"]).cron_disabled);
    }

    #[test]
    fn hosted_journey_verifier_requires_explicit_receipt_and_artifact_map() {
        let cli = Cli::parse_from([
            "snapback",
            "hosted-journey-verify",
            "journey.json",
            "--artifacts",
            "artifacts.json",
        ]);
        assert!(matches!(
            cli.command,
            Some(HostCommand::HostedJourneyVerify {
                receipt,
                artifacts: Some(artifacts),
            }) if receipt == Path::new("journey.json")
                && artifacts == Path::new("artifacts.json")
        ));
    }

    #[test]
    fn background_roots_start_only_after_all_fallible_publications() {
        let source = include_str!("cli.rs");
        let sidecar = source
            .find("operator\n                .publish_with")
            .expect("impersonation sidecar publication remains explicit");
        let ready = source
            .find("target\n            .write_atomic_protected")
            .expect("ready descriptor publication remains explicit");
        let cron = source
            .find("server::spawn_cron_scheduler(state.clone(), cron_autonomy_disabled)")
            .expect("cron scheduler spawn remains explicit");
        let maintenance = source
            .find("server::spawn_maintenance_worker(app_state)")
            .expect("maintenance spawn remains explicit");
        let auth_gc = source
            .find("crate::auth::runtime::spawn_auth_gc_worker")
            .expect("auth GC spawn remains explicit");
        assert!(sidecar < cron && ready < cron);
        assert!(sidecar < maintenance && ready < maintenance);
        assert!(sidecar < auth_gc && ready < auth_gc);
    }

    #[test]
    fn serve_path_installs_insecure_dev_auth_override_into_app_state() {
        // The request-path transport fence reads
        // `AppState.allow_insecure_dev_auth`, not the CLI args, so the serve
        // path must install the flag between AppState construction and app
        // build. Without this the flag validates pre-bind and is then
        // silently dropped: every app-data route on a non-loopback bind
        // refuses with SNAPBACK_AUTH_TRANSPORT_INSECURE (found by the first
        // remote drill target).
        let source = include_str!("cli.rs");
        let constructed = source
            .find("AppState::new_with_secret_read_operator(\n        state.clone(),")
            .expect("serve-path AppState construction remains explicit");
        let installed = source
            .find(".with_insecure_dev_auth_override(args.allow_insecure_dev_auth)")
            .expect("serve path installs the CLI override into request-path state");
        let built = source
            .find("connection_binding_receipt.build(app_state.clone())")
            .expect("app build from AppState remains explicit");
        assert!(constructed < installed && installed < built);
    }

    #[test]
    fn port_and_storage_can_be_overridden() {
        let args = Args::parse_from([
            "snapback",
            "--host",
            "0.0.0.0",
            "--port",
            "9000",
            "--db",
            "tmp/dev.sqlite3",
            "--memory",
        ]);
        assert_eq!(args.host, "0.0.0.0");
        assert_eq!(args.port, Some(9000));
        assert_eq!(args.db, PathBuf::from("tmp/dev.sqlite3"));
        assert!(args.memory);
    }

    #[test]
    fn detached_start_refusal_has_stable_code_and_repair() {
        let error = super::ready_descriptor_required_error();
        assert_eq!(error.diagnostic.code, "SNAPBACK_READY_DESCRIPTOR_REQUIRED");
        assert_eq!(
            error.diagnostic.details["next"][0]["command"],
            "snapback start --ready-file <owner-only-path> ..."
        );
    }

    #[test]
    fn parent_serve_flags_with_subcommands_are_rejected() {
        let cli = Cli::parse_from(["snapback", "--memory", "start"]);

        let error = reject_misdirected_serve_flags(&cli).unwrap_err();
        assert!(
            error.to_string().contains("pass them after `start`"),
            "{error}"
        );
    }

    #[test]
    fn start_subcommand_accepts_serve_flags_after_subcommand() {
        let cli = Cli::parse_from(["snapback", "start", "--memory", "--port", "9000"]);

        reject_misdirected_serve_flags(&cli).unwrap();
        match cli.command {
            Some(HostCommand::Start(args)) => {
                assert!(args.memory);
                assert_eq!(args.port, Some(9000));
            }
            other => panic!("expected start command, got {other:?}"),
        }
    }

    #[test]
    fn staged_auth_mode_startup_flags_have_closed_spellings() {
        let cli = Cli::parse_from([
            "snapback",
            "start",
            "--startup-artifacts",
            "deployment.auth.json",
            "--allow-auth-downgrade",
            "--allow-insecure-dev-auth",
            "--auth-deployment",
            "hosted",
        ]);
        match cli.command {
            Some(HostCommand::Start(args)) => {
                assert_eq!(
                    args.startup_artifacts,
                    Some(PathBuf::from("deployment.auth.json"))
                );
                assert!(args.allow_auth_downgrade);
                assert!(!args.clear_desired_auth_mode);
                assert!(args.allow_insecure_dev_auth);
                assert_eq!(
                    args.auth_deployment,
                    crate::auth::deployment::AuthDeploymentTarget::Hosted
                );
            }
            other => panic!("expected start command, got {other:?}"),
        }

        assert!(
            Cli::try_parse_from([
                "snapback",
                "start",
                "--clear-desired-auth-mode",
                "--allow-auth-downgrade",
            ])
            .is_err(),
            "unstage and downgrade-consume authority are mutually exclusive"
        );
    }

    #[tokio::test]
    async fn hosted_auth_request_refuses_before_database_creation() {
        let directory = tempfile::tempdir().unwrap();
        let database = directory.path().join("must-not-exist.sqlite3");
        let error = super::run(Args {
            db: database.clone(),
            ready_file: Some(directory.path().join("server.ready.json")),
            auth_deployment: crate::auth::deployment::AuthDeploymentTarget::Hosted,
            ..Args::default()
        })
        .await
        .unwrap_err();
        assert!(
            error
                .to_string()
                .contains("SNAPBACK_AUTH_DEPLOYMENT_UNSUPPORTED"),
            "{error:#}"
        );
        assert!(
            !database.exists(),
            "hosted refusal must precede target creation or mutation"
        );
    }

    #[cfg(unix)]
    #[test]
    fn startup_artifact_carrier_is_bounded_closed_and_versioned() {
        use std::os::unix::fs::PermissionsExt as _;

        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("deployment.auth.json");
        let valid = json!({
            "formatVersion": 1,
            "schema": crate::manifest::SchemaManifest::default(),
            "functions": crate::manifest::FunctionManifest::default(),
            "seed": null,
        });
        std::fs::write(&path, serde_json::to_vec(&valid).unwrap()).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        let parsed = super::read_auth_startup_artifacts(&path).unwrap();
        assert_eq!(parsed.format_version, 1);
        assert!(parsed.seed.is_none());

        let mut unknown = valid.clone();
        unknown["secondCarrier"] = json!(true);
        std::fs::write(&path, serde_json::to_vec(&unknown).unwrap()).unwrap();
        let error = super::read_auth_startup_artifacts(&path).unwrap_err();
        assert!(
            error
                .to_string()
                .contains("SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH")
        );

        let mut unsupported = valid;
        unsupported["formatVersion"] = json!(2);
        std::fs::write(&path, serde_json::to_vec(&unsupported).unwrap()).unwrap();
        let error = super::read_auth_startup_artifacts(&path).unwrap_err();
        assert!(
            error
                .to_string()
                .contains("SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH")
        );
    }

    #[cfg(unix)]
    fn sessions_startup_carrier(path: &Path) {
        sessions_startup_carrier_with_functions(path, Vec::new());
    }

    #[cfg(unix)]
    fn sessions_startup_carrier_with_functions(
        path: &Path,
        declared_functions: Vec<crate::manifest::FunctionDefinition>,
    ) {
        use crate::auth::mode::{FUNCTION_V1_PREFIX, INPUTS_V1_PREFIX, SCHEMA_V1_PREFIX};
        use crate::manifest::{
            AuthManifest, AuthMode, FunctionManifest, SNAPBACK_SESSIONS_SCHEMA_VERSION,
            SchemaManifest, TargetCapabilityId,
        };
        use std::os::unix::fs::PermissionsExt as _;

        let digest =
            |prefix: &str, nibble: char| format!("{prefix}{}", nibble.to_string().repeat(64));
        let inputs = digest(INPUTS_V1_PREFIX, 'c');
        let schema = SchemaManifest {
            schema_version: SNAPBACK_SESSIONS_SCHEMA_VERSION.to_owned(),
            app_id: "startup-auth-test".to_owned(),
            auth: Some(AuthManifest {
                mode: AuthMode::Sessions,
            }),
            required_capabilities: vec![TargetCapabilityId::AuthSessionsV1.to_string()],
            schema_hash: Some(digest(SCHEMA_V1_PREFIX, 'a')),
            inputs_hash: Some(inputs.clone()),
            ..SchemaManifest::default()
        };
        let functions = FunctionManifest {
            schema_version: SNAPBACK_SESSIONS_SCHEMA_VERSION.to_owned(),
            app_id: "startup-auth-test".to_owned(),
            bundle_hash: Some(digest(FUNCTION_V1_PREFIX, 'b')),
            inputs_hash: Some(inputs),
            functions: declared_functions,
            ..FunctionManifest::default()
        };
        std::fs::write(
            path,
            serde_json::to_vec(&json!({
                "formatVersion": 1,
                "schema": schema,
                "functions": functions,
                "seed": null,
            }))
            .unwrap(),
        )
        .unwrap();
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn fresh_sessions_startup_stages_then_quarantines_before_item_five() {
        use crate::admin::ServerProfile;
        use crate::auth::mode::{AppDataAvailability, AuthModeStatus, AuthProgramReadiness};
        use crate::auth::provider::AuthProviderProfile;
        use crate::local::LocalSnapback;
        use crate::manifest::AuthMode;

        let directory = tempfile::tempdir().unwrap();
        let database = directory.path().join("app.sqlite3");
        let carrier = directory.path().join("startup.json");
        sessions_startup_carrier(&carrier);
        let args = Args {
            db: database.clone(),
            startup_artifacts: Some(carrier),
            ..Args::default()
        };
        let mut snapback = LocalSnapback::open(&database).unwrap();
        let mut runtime = crate::auth::runtime::AuthRuntime::inspect(
            &mut snapback,
            Some(&database),
            AuthProviderProfile::Test,
        )
        .unwrap();
        let readiness = AuthProgramReadiness::item4(true);

        let state =
            super::compose_auth_mode_startup(&args, &mut snapback, &mut runtime, &readiness)
                .await
                .unwrap();
        assert_eq!(state.active, AuthMode::Dev);
        assert_eq!(state.desired, AuthMode::Sessions);
        assert_eq!(state.mode_state, AuthModeStatus::Quarantined);
        assert_eq!(
            state.app_data_availability,
            AppDataAvailability::RefusedPending
        );
        assert_eq!(
            state.quarantine.as_ref().map(|value| value.code.as_str()),
            Some("SNAPBACK_AUTH_POLICY_UNAVAILABLE")
        );
        assert!(!runtime.catalog_ready());
        assert!(
            !crate::auth::keyring::AuthKeyringStore::keyring_path(&database).exists(),
            "the item-5 readiness fence must run before keyring/catalog effects"
        );
        super::validate_auth_transport(
            "127.0.0.1".parse().unwrap(),
            ServerProfile::Test,
            &state,
            false,
        )
        .unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn omitted_construction_receipts_prevent_sessions_from_binding() {
        use crate::auth::mode::{AppDataAvailability, AuthModeStatus};
        use crate::auth::provider::AuthProviderProfile;
        use crate::local::LocalSnapback;
        use crate::manifest::AuthMode;

        for missing in [
            "connection-binding",
            "two-phase-revocation",
            "auth-coordinator",
        ] {
            let directory = tempfile::tempdir().unwrap();
            let database = directory.path().join("app.sqlite3");
            let carrier = directory.path().join("startup.json");
            sessions_startup_carrier(&carrier);
            let args = Args {
                db: database.clone(),
                startup_artifacts: Some(carrier),
                ..Args::default()
            };
            let mut snapback = LocalSnapback::open(&database).unwrap();
            let mut runtime = crate::auth::runtime::AuthRuntime::inspect(
                &mut snapback,
                Some(&database),
                AuthProviderProfile::Test,
            )
            .unwrap();
            let connection = crate::server::connection_binding_construction_receipt();
            let revocation = runtime.two_phase_revocation_construction_receipt();
            let coordinator = runtime.auth_coordinator_construction_receipt();
            let receipts = AuthProgramConstructionReceipts {
                connection_binding: (missing != "connection-binding").then_some(&connection),
                two_phase_revocation: (missing != "two-phase-revocation").then_some(&revocation),
                auth_coordinator: (missing != "auth-coordinator")
                    .then_some(AuthCoordinatorReadinessReceipt::Construction(&coordinator)),
            };
            let readiness = runtime_auth_program_readiness(true, &receipts, false, false);

            let state =
                super::compose_auth_mode_startup(&args, &mut snapback, &mut runtime, &readiness)
                    .await
                    .unwrap();
            assert_eq!(state.active, AuthMode::Dev, "missing {missing}");
            assert_eq!(state.desired, AuthMode::Sessions, "missing {missing}");
            assert_eq!(
                state.mode_state,
                AuthModeStatus::Quarantined,
                "missing {missing}"
            );
            assert_eq!(
                state.app_data_availability,
                AppDataAvailability::RefusedPending,
                "missing {missing}"
            );
            assert_eq!(
                state.quarantine.as_ref().map(|value| value.code.as_str()),
                Some("SNAPBACK_AUTH_POLICY_UNAVAILABLE"),
                "missing {missing}"
            );
            assert!(!runtime.catalog_ready(), "missing {missing}");
        }
    }

    #[tokio::test]
    async fn coordinator_and_worker_construction_fail_before_socket_bind() {
        let directory = tempfile::tempdir().unwrap();
        for failure in [
            AuthConstructionFailure::Coordinator,
            AuthConstructionFailure::ExpiryWorker,
        ] {
            let reservation = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
            let port = reservation.local_addr().unwrap().port();

            let error = super::run(Args {
                port: Some(port),
                memory: true,
                ready_file: Some(directory.path().join(format!("{failure:?}.ready.json"))),
                auth_construction_failure: Some(failure),
                ..Args::default()
            })
            .await
            .expect_err("the injected construction edge must abort startup");
            assert!(
                format!("{error:#}").contains("SNAPBACK_AUTH_PROJECTION_UNAVAILABLE"),
                "unexpected {failure:?} failure: {error:#}",
            );
            // Keeping this sentinel listener alive makes an accidental bind
            // attempt fail with EADDRINUSE instead of the construction code.
            drop(reservation);
        }
    }

    #[cfg(unix)]
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn sessions_startup_offloads_sqlite_and_ibex_from_async_workers() {
        use crate::auth::mode::AuthProgramReadiness;
        use crate::auth::provider::AuthProviderProfile;
        use crate::local::LocalSnapback;
        use crate::manifest::{
            AuthMode, FunctionDefinition, FunctionKind, FunctionRuntime, IbexModule,
        };

        let directory = tempfile::tempdir().unwrap();
        let database = directory.path().join("app.sqlite3");
        let carrier = directory.path().join("startup.json");
        sessions_startup_carrier_with_functions(
            &carrier,
            vec![FunctionDefinition::new(
                "startupProbe",
                FunctionKind::Query,
                FunctionRuntime::IbexModule(IbexModule {
                    source: "globalThis.__snapbackHandlers = { startupProbe() { return null; } };"
                        .to_owned(),
                    export: "startupProbe".to_owned(),
                }),
            )],
        );
        let args = Args {
            db: database.clone(),
            startup_artifacts: Some(carrier),
            ..Args::default()
        };
        let mut snapback = super::startup_blocking(|| LocalSnapback::open(&database)).unwrap();
        let mut runtime = crate::auth::runtime::AuthRuntime::inspect(
            &mut snapback,
            Some(&database),
            AuthProviderProfile::Test,
        )
        .unwrap();
        let readiness = AuthProgramReadiness::new(true, true, true, true, false, false, false);

        let state =
            super::compose_auth_mode_startup(&args, &mut snapback, &mut runtime, &readiness)
                .await
                .unwrap();
        assert_eq!(state.active, AuthMode::Sessions);
        assert!(runtime.catalog_ready());

        // A settled sessions restart takes a separate preflight branch. It
        // must keep Hermes module preparation behind the same blocking
        // boundary as the initial stage/consume path.
        let restarted =
            super::compose_auth_mode_startup(&args, &mut snapback, &mut runtime, &readiness)
                .await
                .unwrap();
        assert_eq!(restarted.active, AuthMode::Sessions);
    }

    /// issues/20260805-doc-comment-artifact-mismatch-no-successor-migration.md:
    /// a comment-only source edit rotates the functions bundle identity, and
    /// the settled restart correctly refuses — but the refusal must name the
    /// supported repair paths (live evolution through the running server, or
    /// the `snapback auth backup` backup-then-reseed procedure) instead of
    /// dead-ending on the identities alone.
    #[cfg(unix)]
    #[tokio::test]
    async fn settled_sessions_pin_refusal_names_supported_repair_paths() {
        use crate::auth::mode::{AuthProgramReadiness, FUNCTION_V1_PREFIX};
        use crate::auth::provider::AuthProviderProfile;
        use crate::local::LocalSnapback;
        use crate::manifest::AuthMode;

        let directory = tempfile::tempdir().unwrap();
        let database = directory.path().join("app.sqlite3");
        let carrier = directory.path().join("startup.json");
        sessions_startup_carrier(&carrier);
        let args = Args {
            db: database.clone(),
            startup_artifacts: Some(carrier.clone()),
            ..Args::default()
        };
        let mut snapback = LocalSnapback::open(&database).unwrap();
        let mut runtime = crate::auth::runtime::AuthRuntime::inspect(
            &mut snapback,
            Some(&database),
            AuthProviderProfile::Test,
        )
        .unwrap();
        let readiness = AuthProgramReadiness::new(true, true, true, true, false, false, false);
        let settled =
            super::compose_auth_mode_startup(&args, &mut snapback, &mut runtime, &readiness)
                .await
                .unwrap();
        assert_eq!(settled.active, AuthMode::Sessions);

        // The doc-comment edit case: only the functions bundle identity moved.
        let mut regenerated: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&carrier).unwrap()).unwrap();
        regenerated["functions"]["bundleHash"] =
            json!(format!("{FUNCTION_V1_PREFIX}{}", "d".repeat(64)));
        std::fs::write(&carrier, serde_json::to_vec(&regenerated).unwrap()).unwrap();

        let error =
            super::compose_auth_mode_startup(&args, &mut snapback, &mut runtime, &readiness)
                .await
                .unwrap_err();
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH"
        );
        let details = &error.diagnostic.details;
        assert_ne!(
            details["expectedDeployment"]["bundleHash"],
            details["observedDeployment"]["bundleHash"],
            "the refusal still carries both exact deployment identities"
        );
        let repair = &details["repair"];
        let keep_data = repair["keepData"].as_str().unwrap();
        assert!(
            keep_data.contains("running server") && keep_data.contains("watch reload"),
            "keepData names the live-evolution migration path: {keep_data}"
        );
        let reseed = repair["reseedFresh"].as_str().unwrap();
        assert!(
            reseed.contains("snapback auth backup --db")
                && reseed.contains(&database.display().to_string()),
            "reseedFresh names the exact backup command for this store: {reseed}"
        );
        assert!(
            repair["safety"].as_str().unwrap().contains("LLP 0058"),
            "safety attributes the pin to auth-mode state"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn pending_missing_carrier_quarantines_and_explicit_clear_restores_dev() {
        use crate::auth::mode::{AuthModeStatus, AuthProgramReadiness};
        use crate::auth::provider::AuthProviderProfile;
        use crate::local::LocalSnapback;
        use crate::manifest::AuthMode;

        let directory = tempfile::tempdir().unwrap();
        let database = directory.path().join("app.sqlite3");
        let carrier = directory.path().join("startup.json");
        sessions_startup_carrier(&carrier);
        let mut snapback = LocalSnapback::open(&database).unwrap();
        let mut runtime = crate::auth::runtime::AuthRuntime::inspect(
            &mut snapback,
            Some(&database),
            AuthProviderProfile::Test,
        )
        .unwrap();
        let readiness = AuthProgramReadiness::item4(true);
        let stage = Args {
            db: database.clone(),
            startup_artifacts: Some(carrier),
            ..Args::default()
        };
        super::compose_auth_mode_startup(&stage, &mut snapback, &mut runtime, &readiness)
            .await
            .unwrap();

        let missing = Args {
            db: database.clone(),
            ..Args::default()
        };
        let missing_state =
            super::compose_auth_mode_startup(&missing, &mut snapback, &mut runtime, &readiness)
                .await
                .unwrap();
        assert_eq!(missing_state.mode_state, AuthModeStatus::Quarantined);
        assert_eq!(
            missing_state
                .quarantine
                .as_ref()
                .map(|value| value.code.as_str()),
            Some("SNAPBACK_AUTH_STARTUP_ARTIFACT_REQUIRED")
        );

        let clear = Args {
            db: database,
            clear_desired_auth_mode: true,
            ..Args::default()
        };
        let settled =
            super::compose_auth_mode_startup(&clear, &mut snapback, &mut runtime, &readiness)
                .await
                .unwrap();
        assert_eq!(settled.active, AuthMode::Dev);
        assert_eq!(settled.desired, AuthMode::Dev);
        assert_eq!(settled.mode_state, AuthModeStatus::Settled);
        assert!(settled.requested_deployment.is_none());
        assert!(settled.quarantine.is_none());
    }

    #[test]
    fn auth_transport_matrix_has_no_sessions_plaintext_override() {
        use crate::admin::ServerProfile;
        use crate::auth::mode::AuthModeStateRecord;
        use crate::manifest::AuthMode;

        let dev = AuthModeStateRecord::initial_dev(None);
        let remote = "192.0.2.10".parse().unwrap();
        let refused =
            super::validate_auth_transport(remote, ServerProfile::Dev, &dev, false).unwrap_err();
        assert_eq!(refused.diagnostic.code, "SNAPBACK_AUTH_TRANSPORT_INSECURE");
        super::validate_auth_transport(remote, ServerProfile::Dev, &dev, true).unwrap();
        assert!(super::validate_auth_transport(remote, ServerProfile::Prod, &dev, true).is_err());
        super::validate_auth_transport(
            "127.0.0.1".parse().unwrap(),
            ServerProfile::Prod,
            &dev,
            false,
        )
        .unwrap();

        let mut active_sessions = dev.clone();
        active_sessions.active = AuthMode::Sessions;
        active_sessions.desired = AuthMode::Sessions;
        let refused =
            super::validate_auth_transport(remote, ServerProfile::Test, &active_sessions, true)
                .unwrap_err();
        assert_eq!(refused.diagnostic.code, "SNAPBACK_AUTH_TRANSPORT_INSECURE");

        let mut desired_sessions = dev;
        desired_sessions.desired = AuthMode::Sessions;
        let refused =
            super::validate_auth_transport(remote, ServerProfile::Demo, &desired_sessions, true)
                .unwrap_err();
        assert_eq!(refused.diagnostic.code, "SNAPBACK_AUTH_TRANSPORT_INSECURE");

        // This proves only the local listener rule. LLP 0060 deliberately does
        // not infer anything about a reverse proxy from a loopback address.
        super::validate_auth_transport(
            "::1".parse().unwrap(),
            ServerProfile::Prod,
            &active_sessions,
            false,
        )
        .unwrap();
    }

    #[test]
    fn auth_backup_restore_and_declared_startup_have_closed_cli_spellings() {
        let backup = Cli::parse_from([
            "snapback",
            "auth",
            "backup",
            "--db",
            "app.sqlite3",
            "--output",
            "backup",
        ]);
        assert!(matches!(
            backup.command,
            Some(HostCommand::Auth {
                command: AuthCommand::Backup { .. }
            })
        ));

        let restore = Cli::parse_from([
            "snapback",
            "auth",
            "restore",
            "--from",
            "backup",
            "--db",
            "restored/app.sqlite3",
        ]);
        assert!(matches!(
            restore.command,
            Some(HostCommand::Auth {
                command: AuthCommand::Restore { .. }
            })
        ));

        let start = Cli::parse_from([
            "snapback",
            "start",
            "--db",
            "restored/app.sqlite3",
            "--restored-from-backup",
            "019b0000-0000-7000-8000-000000000000",
        ]);
        assert!(matches!(
            start.command,
            Some(HostCommand::Start(Args {
                restored_from_backup: Some(_),
                ..
            }))
        ));
        assert!(
            Cli::try_parse_from([
                "snapback",
                "start",
                "--memory",
                "--restored-from-backup",
                "019b0000-0000-7000-8000-000000000000",
            ])
            .is_err()
        );
    }

    #[test]
    fn declared_restore_telemetry_rotates_only_for_applied_and_preserves_replay_boot_evidence() {
        let directory = tempfile::tempdir().unwrap();
        let database_path = directory.path().join("app.sqlite3");
        let mut snapback = crate::local::LocalSnapback::open(&database_path).unwrap();
        let telemetry = snapback.telemetry();
        let telemetry_path = crate::telemetry::Telemetry::path_for_database(&database_path);
        telemetry.force_flush().unwrap();
        let generation_before: String = rusqlite::Connection::open(&telemetry_path)
            .unwrap()
            .query_row(
                "SELECT generation FROM telemetry_meta WHERE singleton=1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        telemetry.point(
            "lifecycle",
            "current_boot_replay_witness",
            Some(200),
            None,
            None,
            None,
            crate::telemetry::Priority::Reserved,
        );
        let boot_depth = telemetry.diagnostics().depth;

        super::apply_declared_restore_telemetry_outcome(
            &mut snapback,
            crate::auth::lifecycle::DeclaredRestoreOutcome::AlreadyApplied,
        )
        .unwrap();
        assert_eq!(
            telemetry.diagnostics().depth,
            boot_depth,
            "idempotent replay must not clear this boot's process evidence"
        );
        telemetry.force_flush().unwrap();
        let generation_after_replay: String = rusqlite::Connection::open(&telemetry_path)
            .unwrap()
            .query_row(
                "SELECT generation FROM telemetry_meta WHERE singleton=1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(generation_after_replay, generation_before);
        assert_eq!(
            telemetry.event_count_for_test("lifecycle", "process_start", "point"),
            1,
            "the replayed start keeps the current boot marker visible"
        );
        assert_eq!(
            telemetry.event_count_for_test("lifecycle", "current_boot_replay_witness", "point",),
            1,
            "the replay leaves already-admitted current-boot evidence buffered"
        );
        assert_eq!(
            telemetry.event_count_for_test("lifecycle", "restore_generation_rotation", "point",),
            0,
            "AlreadyApplied emits no restore rotation marker"
        );

        super::apply_declared_restore_telemetry_outcome(
            &mut snapback,
            crate::auth::lifecycle::DeclaredRestoreOutcome::Applied {
                sessions_revoked: 0,
                challenges_deleted: 0,
            },
        )
        .unwrap();
        telemetry.force_flush().unwrap();
        let generation_after_apply: String = rusqlite::Connection::open(&telemetry_path)
            .unwrap()
            .query_row(
                "SELECT generation FROM telemetry_meta WHERE singleton=1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_ne!(generation_after_apply, generation_before);
        assert_eq!(
            telemetry.event_count_for_test("lifecycle", "restore_generation_rotation", "point",),
            1,
            "only Applied rotates and emits the restore marker"
        );
    }

    #[tokio::test]
    async fn physical_restore_is_quarantined_until_exact_prebind_declaration() {
        use rusqlite::params;

        let directory = tempfile::tempdir().unwrap();
        let source_database = directory.path().join("source.sqlite3");
        let mut database = crate::storage::LocalDatabase::open(&source_database).unwrap();
        let keyring = crate::auth::keyring::AuthKeyringStore::file_for_database(&source_database);
        crate::auth::lifecycle::activate_catalog(
            &mut database,
            &keyring,
            1_700_000_000_000,
            &crate::auth::crypto::OsRandom,
        )
        .unwrap();
        let key_id = keyring
            .with_active_key(
                1_700_000_000_000,
                &crate::auth::crypto::OsRandom,
                |id, _| id.as_str().to_owned(),
            )
            .unwrap();
        let user_id = uuid::Uuid::now_v7().to_string();
        let identity_id = uuid::Uuid::now_v7().to_string();
        let session_id = uuid::Uuid::now_v7().to_string();
        let authority_instance_id = uuid::Uuid::now_v7().to_string();
        database
            .with_auth_transaction(|transaction| {
                transaction.execute(
                    "INSERT INTO _auth_users(id, created_at_ms) VALUES(?1, 0)",
                    params![user_id],
                )?;
                transaction.execute(
                    "INSERT INTO _auth_identities(
                       id, user_id, provider, subject, verified_at_ms
                     ) VALUES(?1, ?2, 'email-code', 'person@example.com', 0)",
                    params![identity_id, user_id],
                )?;
                transaction.execute(
                    "INSERT INTO _auth_sessions(
                       id, user_id, identity_id, authority_instance_id, token_hash,
                       generation, created_at_ms, last_used_at_ms, expires_at_ms,
                       absolute_expires_at_ms, revoked_at_ms
                     ) VALUES(?1, ?2, ?3, ?4, ?5,
                              1, 0, 0, 2000000000000, 2000000000000, NULL)",
                    params![
                        session_id,
                        user_id,
                        identity_id,
                        authority_instance_id,
                        vec![1_u8; 32],
                    ],
                )?;
                transaction.execute(
                    "INSERT INTO _auth_verification_codes(
                       challenge_id, canonical_address, code_digest, key_id,
                       attempts, max_attempts, requested_at_ms, expires_at_ms,
                       consumed_at_ms, superseded_by
                     ) VALUES('sbc_AAAAAAAAAAAAAAAAAAAAAA', 'person@example.com', ?1, ?2,
                              0, 5, 0, 2000000000000, NULL, NULL)",
                    params![vec![2_u8; 32], key_id],
                )?;
                Ok(())
            })
            .unwrap();
        drop(database);

        let backup = directory.path().join("backup");
        super::auth_backup(&source_database, &backup).await.unwrap();
        let restored_database = directory.path().join("restored").join("app.sqlite3");
        let competing_restore =
            TargetInstanceReservation::acquire(&restored_database).expect("reserve restore target");
        let reserved = super::auth_restore(&backup, &restored_database)
            .expect_err("concurrent restore reservation must fail before publication");
        assert!(
            reserved
                .to_string()
                .contains("target instance is already reserved")
        );
        assert!(!restored_database.parent().unwrap().exists());
        drop(competing_restore);
        super::auth_restore(&backup, &restored_database).unwrap();
        let declaration_path = restored_database
            .parent()
            .unwrap()
            .join(crate::auth::lifecycle::RESTORE_DECLARATION_FILE);
        let declaration = crate::auth::lifecycle::RestoreDeclaration::parse(
            &crate::secure_file::read_owner_only(&declaration_path).unwrap(),
        )
        .unwrap();

        let ready = directory.path().join("restored.ready.json");
        let missing = super::run(Args {
            host: "127.0.0.1".to_owned(),
            port: Some(0),
            db: restored_database.clone(),
            memory: false,
            hosted_edge: None,
            hosted_admission: None,
            ready_file: Some(ready.clone()),
            restored_from_backup: None,
            startup_artifacts: None,
            trusted_composition_activation: None,
            clear_desired_auth_mode: false,
            allow_auth_downgrade: false,
            allow_insecure_dev_auth: false,
            cron_disabled: false,
            auth_deployment: crate::auth::deployment::AuthDeploymentTarget::Local,
            auth_construction_failure: None,
        })
        .await
        .expect_err("restored rows must not reach a listener without declaration authority");
        assert!(missing.to_string().contains("--restored-from-backup"));
        assert!(!ready.exists());

        let declaration_id = declaration.declaration_id().to_owned();
        let server = tokio::spawn(super::run(Args {
            host: "127.0.0.1".to_owned(),
            port: Some(0),
            db: restored_database.clone(),
            memory: false,
            ready_file: Some(ready.clone()),
            restored_from_backup: Some(declaration_id),
            hosted_edge: None,
            hosted_admission: None,
            startup_artifacts: None,
            trusted_composition_activation: None,
            clear_desired_auth_mode: false,
            allow_auth_downgrade: false,
            allow_insecure_dev_auth: false,
            cron_disabled: false,
            auth_deployment: crate::auth::deployment::AuthDeploymentTarget::Local,
            auth_construction_failure: None,
        }));
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        while !ready.exists() {
            if server.is_finished() {
                let outcome = server.await;
                panic!("declared restore startup exited before readiness: {outcome:?}");
            }
            assert!(
                std::time::Instant::now() < deadline,
                "declared restore never reached readiness"
            );
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        server.abort();
        let _ = server.await;
        assert!(!declaration_path.exists());

        let restored = crate::storage::LocalDatabase::open(&restored_database).unwrap();
        let facts = restored
            .with_auth_read(|connection| {
                Ok((
                    connection.query_row(
                        "SELECT COUNT(*) FROM _auth_sessions WHERE id = ?1",
                        params![session_id],
                        |row| row.get::<_, i64>(0),
                    )?,
                    connection.query_row(
                        "SELECT COUNT(*) FROM _auth_verification_codes",
                        [],
                        |row| row.get::<_, i64>(0),
                    )?,
                ))
            })
            .unwrap();
        assert_eq!(facts, (0, 0));
    }

    #[test]
    fn secret_read_mint_is_structurally_ready_file_only() {
        assert!(
            Cli::try_parse_from([
                "snapback",
                "secret-read-mint",
                "--url",
                "http://127.0.0.1:4287",
                "--admin-inspect",
            ])
            .is_err()
        );
        assert!(
            Cli::try_parse_from([
                "snapback",
                "secret-read-mint",
                "--ready-file",
                "ready.json",
                "--admin-inspect",
            ])
            .is_ok()
        );
    }

    #[test]
    fn asset_gc_sweep_cli_requires_and_preserves_the_injected_clock() {
        let parsed = Cli::parse_from([
            "snapback",
            "assets",
            "gc-sweep",
            "--now-ms",
            "1785484800000",
            "--url",
            "http://127.0.0.1:4287",
        ]);
        match parsed.command {
            Some(HostCommand::Assets {
                command: AssetsCommand::GcSweep { target, now_ms },
            }) => {
                assert_eq!(now_ms, 1_785_484_800_000);
                assert_eq!(target.url.as_deref(), Some("http://127.0.0.1:4287"));
            }
            other => panic!("expected asset gc-sweep command, got {other:?}"),
        }
        assert!(
            Cli::try_parse_from([
                "snapback",
                "assets",
                "gc-sweep",
                "--url",
                "http://127.0.0.1:4287",
            ])
            .is_err(),
            "gc-sweep must never fall back to the ambient wall clock"
        );
    }

    #[test]
    fn session_mint_cli_calls_host_op_with_closed_email_args_and_capability() {
        let dir = tempfile::tempdir().unwrap();
        let ready = dir.path().join("ready.json");
        let canonical_ready = std::fs::canonicalize(dir.path())
            .unwrap()
            .join("ready.json");
        let sidecar =
            crate::admin_impersonation::impersonation_capability_sibling(&canonical_ready).unwrap();
        let (_registry, operator) =
            crate::admin_impersonation::ImpersonationCapabilityRegistry::generate(
                "nonce-session-mint".to_owned(),
                &crate::auth::crypto::OsRandom,
            )
            .unwrap();
        operator
            .publish_with(&canonical_ready, |path, bytes| {
                crate::secure_file::write_owner_only(path, bytes)
            })
            .unwrap();
        let expected_capability = std::fs::read_to_string(&sidecar).unwrap();

        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let mut requests = Vec::new();
            for index in 0..2 {
                let (mut stream, _) = listener.accept().unwrap();
                let request = read_http_request(&mut stream);
                let body = if index == 0 {
                    health_with_nonce("nonce-session-mint")
                } else {
                    json!({
                        "ok": true,
                        "operation": "auth.mintSession",
                        "data": { "tokenType": "Bearer", "token": "sbss_ordinary" },
                    })
                };
                write_http_json(&mut stream, &body);
                requests.push(request);
            }
            requests
        });

        let mut descriptor = stop_descriptor(Some("nonce-session-mint"));
        descriptor.server_url = format!("http://{address}");
        descriptor.target.server_url = Some(descriptor.server_url.clone());
        descriptor.impersonation_capability_file = Some(sidecar.display().to_string());
        crate::secure_file::write_owner_only(&ready, &serde_json::to_vec(&descriptor).unwrap())
            .unwrap();

        let parsed = Cli::parse_from([
            "snapback",
            "session",
            "mint",
            "--email",
            "x@example.com",
            "--ready-file",
            ready.to_str().unwrap(),
        ]);
        let (target, email) = match parsed.command {
            Some(HostCommand::Session {
                command: SessionCommand::Mint { target, email },
            }) => (target, email),
            other => panic!("expected session mint command, got {other:?}"),
        };
        super::post_host_op(&target, super::mint_session_request(email)).unwrap();

        let requests = server.join().unwrap();
        assert!(requests[0].starts_with("GET /health "));
        assert!(requests[1].starts_with("POST /_snapback/api/host-ops "));
        assert!(requests[1].lines().any(|line| {
            let Some((name, value)) = line.split_once(':') else {
                return false;
            };
            name.eq_ignore_ascii_case(crate::admin_impersonation::IMPERSONATION_CAPABILITY_HEADER)
                && value.trim() == expected_capability
        }));
        let (_, body) = requests[1].split_once("\r\n\r\n").unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(body).unwrap(),
            json!({
                "operation": "auth.mintSession",
                "args": { "email": "x@example.com" },
            })
        );
    }

    #[test]
    fn session_mint_cli_output_is_only_the_host_op_session_json() {
        let impersonation_capability = "sbic_operator_capability_must_not_be_printed";
        let session_result = json!({
            "schemaVersion": "snapback.v0",
            "resultKind": "hostOpsResult",
            "operation": "auth.mintSession",
            "ok": true,
            "data": {
                "tokenType": "Bearer",
                "token": "sbss_ordinary_session",
                "session": { "userId": "user_x" },
            },
            "diagnostics": [],
        });
        let mut output = Vec::new();

        assert!(super::write_envelope_to(&session_result, &mut output).unwrap());

        let output = String::from_utf8(output).unwrap();
        assert_eq!(
            output,
            format!(
                "{}\n",
                serde_json::to_string_pretty(&session_result).unwrap()
            )
        );
        assert!(!output.contains(impersonation_capability));
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&output).unwrap(),
            session_result
        );
    }

    #[test]
    fn session_mint_cli_requires_email() {
        let error = Cli::try_parse_from([
            "snapback",
            "session",
            "mint",
            "--url",
            "http://127.0.0.1:4287",
        ])
        .expect_err("session mint without --email must be refused");

        assert_eq!(
            error.kind(),
            clap::error::ErrorKind::MissingRequiredArgument
        );
        assert!(error.to_string().contains("--email"));
    }

    #[test]
    fn run_args_must_be_json_object() {
        assert!(parse_run_args(Some(r#"{"title":"hello"}"#.to_owned())).is_ok());

        let error = parse_run_args(Some(r#"["hello"]"#.to_owned())).unwrap_err();
        assert!(error.to_string().contains("--args must be a JSON object"));
    }

    #[test]
    fn network_profile_cli_maps_get_and_set_without_reinterpreting_profiles() {
        let get = Cli::parse_from([
            "snapback",
            "network-profile",
            "get",
            "--url",
            "http://127.0.0.1:4287",
        ]);
        assert!(matches!(
            get.command,
            Some(HostCommand::NetworkProfile {
                command: NetworkProfileCommand::Get { .. }
            })
        ));

        let set = Cli::parse_from([
            "snapback",
            "network-profile",
            "set",
            "optimistic",
            "--url",
            "http://127.0.0.1:4287",
        ]);
        assert!(matches!(
            set.command,
            Some(HostCommand::NetworkProfile {
                command: NetworkProfileCommand::Set { profile, .. }
            }) if profile == "optimistic"
        ));
        assert_eq!(
            parse_network_profile_selection("optimistic").unwrap(),
            json!("optimistic")
        );
        assert_eq!(
            parse_network_profile_selection(
                r#"{"name":"tiny","mutationAckDelayMs":1,"liveDeltaDelayMs":2,"queryResponseDelayMs":3}"#
            )
            .unwrap()["name"],
            "tiny"
        );
    }

    // @ref LLP 0184#p2-controlled-mutations — parse coverage for the LLP
    // 0184 §P2 typed CLI verbs (config.unset, cron.tick/runOne, jobs.drain,
    // connection.disconnect). These only assert clap wiring; the HTTP-level
    // behavior is covered by mcp-control.test.mjs's real-server acceptance
    // (the equivalent MCP tools share the same served routes).
    #[test]
    fn config_unset_cli_parses_entry_and_target() {
        let parsed = Cli::parse_from([
            "snapback",
            "config",
            "unset",
            "--entry",
            "stripe.secretKey",
            "--url",
            "http://127.0.0.1:4287",
        ]);
        assert!(matches!(
            parsed.command,
            Some(HostCommand::Config {
                command: ConfigCommand::Unset { entry, .. }
            }) if entry == "stripe.secretKey"
        ));
    }

    #[test]
    fn cron_cli_parses_tick_and_run() {
        let tick = Cli::parse_from(["snapback", "cron", "tick", "--url", "http://127.0.0.1:4287"]);
        assert!(matches!(
            tick.command,
            Some(HostCommand::Cron {
                command: CronCommand::Tick { .. }
            })
        ));

        let run = Cli::parse_from([
            "snapback",
            "cron",
            "run",
            "nightly-digest",
            "--url",
            "http://127.0.0.1:4287",
        ]);
        assert!(matches!(
            run.command,
            Some(HostCommand::Cron {
                command: CronCommand::Run { name, .. }
            }) if name == "nightly-digest"
        ));
    }

    #[test]
    fn jobs_drain_cli_parses_injected_clock_and_waves() {
        let parsed = Cli::parse_from([
            "snapback",
            "jobs",
            "drain",
            "--url",
            "http://127.0.0.1:4287",
            "--now-ms",
            "1700000000000",
            "--max-waves",
            "3",
        ]);
        assert!(matches!(
            parsed.command,
            Some(HostCommand::Jobs {
                command: JobsCommand::Drain {
                    now_ms: Some(1_700_000_000_000),
                    max_waves: Some(3),
                    ..
                }
            })
        ));
    }

    #[test]
    fn connections_disconnect_cli_requires_a_reason() {
        let parsed = Cli::parse_from([
            "snapback",
            "connections",
            "disconnect",
            "conn_abc123",
            "--reason",
            "stuck presence repair",
            "--url",
            "http://127.0.0.1:4287",
        ]);
        assert!(matches!(
            parsed.command,
            Some(HostCommand::Connections {
                command: ConnectionsCommand::Disconnect { connection_id, reason, .. }
            }) if connection_id == "conn_abc123" && reason == "stuck presence repair"
        ));

        let missing_reason = Cli::try_parse_from([
            "snapback",
            "connections",
            "disconnect",
            "conn_abc123",
            "--url",
            "http://127.0.0.1:4287",
        ]);
        assert!(missing_reason.is_err());
    }

    #[test]
    fn path_segment_escape_encodes_reserved_bytes() {
        assert_eq!(path_segment_escape("nightly-digest"), "nightly-digest");
        assert_eq!(path_segment_escape("a/b c"), "a%2Fb%20c");
    }

    #[test]
    fn secret_read_root_path_substitution_is_refused_before_file_or_network_access() {
        let dir = tempfile::tempdir().unwrap();
        let ready = std::fs::canonicalize(dir.path())
            .unwrap()
            .join("server.json");
        let attacker_root = dir.path().join("attacker-root");
        crate::secure_file::write_owner_only(&attacker_root, b"sbrk_deadbeef\n").unwrap();
        let mut descriptor = stop_descriptor(Some("startup-a"));
        descriptor.secret_read_root_file = Some(attacker_root.display().to_string());
        let error = validated_secret_read_root_path(&ready, &descriptor).unwrap_err();
        assert!(
            error
                .to_string()
                .contains("SNAPBACK_ADMIN_SECRET_READ_ROOT_PATH_INVALID")
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn ready_file_cli_mints_a_derived_lease_without_exposing_the_root() {
        let dir = tempfile::tempdir().unwrap();
        let ready = std::fs::canonicalize(dir.path())
            .unwrap()
            .join("server.json");
        let root_path = crate::admin_secret_read::secret_read_root_sibling(&ready);
        let server_root = crate::admin_secret_read::resolve_secret_read_proof_root_with_io(
            &root_path,
            crate::secure_file::read_owner_only,
            crate::secure_file::write_owner_only,
        )
        .unwrap();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let mut context =
            crate::admin::ServerContext::new(address.ip().to_string(), address.port(), true);
        context.admin_token = Some("ordinary-admin".to_owned());
        let (state, operator) = crate::admin::AppState::from_snapback_with_secret_read_operator(
            crate::local::LocalSnapback::memory().unwrap(),
            context,
        );
        let startup_nonce = crate::identity::binary_identity().startup_nonce;
        let app = crate::server::app(state.with_secret_read_mint_bridge(
            crate::admin_secret_read::SecretReadMintBridge::new(
                operator,
                server_root,
                startup_nonce.clone(),
            ),
        ));
        let server = tokio::spawn(async move {
            app.bind(listener).unwrap().serve().await.unwrap();
        });

        let mut descriptor = stop_descriptor(Some(&startup_nonce));
        descriptor.server_url = format!("http://{address}");
        descriptor.host = address.ip().to_string();
        descriptor.port = address.port();
        descriptor.secret_read_root_file = Some(root_path.display().to_string());
        crate::secure_file::write_owner_only(
            &ready,
            serde_json::to_string(&descriptor).unwrap().as_bytes(),
        )
        .unwrap();
        let response = tokio::task::spawn_blocking(move || {
            mint_secret_read_via_http(
                &ready,
                Some("ordinary-admin".to_owned()),
                crate::admin_secret_read::SecretReadMintSpec {
                    scopes: std::collections::BTreeSet::from([
                        crate::admin_secret_read::SecretReadScope::AdminInspect,
                    ]),
                    ttl_ms: 60_000,
                    row_budget: 10,
                    byte_budget: 1_000,
                },
            )
        })
        .await
        .unwrap()
        .unwrap();
        assert_eq!(response.as_object().unwrap().len(), 1);
        assert!(response["lease"].as_str().unwrap().starts_with("sbrl_"));
        assert!(!serde_json::to_string(&response).unwrap().contains("sbrk_"));
        server.abort();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn stale_ready_descriptor_sends_adversarial_server_no_admin_or_proof_material() {
        use axum::body::Bytes;
        use axum::http::HeaderMap;
        use axum::routing::{get, post};
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::{Arc, Mutex as StdMutex};

        let observed = Arc::new(StdMutex::new(Vec::<u8>::new()));
        let mint_calls = Arc::new(AtomicUsize::new(0));
        let health_observed = observed.clone();
        let mint_observed = observed.clone();
        let mint_calls_handler = mint_calls.clone();
        let attacker = axum::Router::new()
            .route(
                "/health",
                get(move |headers: HeaderMap| {
                    let observed = health_observed.clone();
                    async move {
                        let mut observed = observed.lock().unwrap();
                        for (name, value) in &headers {
                            observed.extend_from_slice(name.as_str().as_bytes());
                            observed.extend_from_slice(value.as_bytes());
                        }
                        axum::Json(json!({
                            "ok": true,
                            "binary": { "startupNonce": "attacker-startup" }
                        }))
                    }
                }),
            )
            .route(
                "/_snapback/api/admin-secret-read/mint",
                post(move |headers: HeaderMap, body: Bytes| {
                    let observed = mint_observed.clone();
                    let mint_calls = mint_calls_handler.clone();
                    async move {
                        mint_calls.fetch_add(1, Ordering::SeqCst);
                        let mut observed = observed.lock().unwrap();
                        for (name, value) in &headers {
                            observed.extend_from_slice(name.as_str().as_bytes());
                            observed.extend_from_slice(value.as_bytes());
                        }
                        observed.extend_from_slice(&body);
                        axum::Json(json!({ "lease": "attacker" }))
                    }
                }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, attacker).await.unwrap();
        });

        let dir = tempfile::tempdir().unwrap();
        let ready = std::fs::canonicalize(dir.path())
            .unwrap()
            .join("server.json");
        let root_path = crate::admin_secret_read::secret_read_root_sibling(&ready);
        // If the CLI tries to read the root before checking /health this
        // non-regular path fails with a different error, making ordering part
        // of the acceptance rather than an unobservable implementation detail.
        std::fs::create_dir(&root_path).unwrap();
        let mut descriptor = stop_descriptor(Some("trusted-startup"));
        descriptor.server_url = format!("http://{address}");
        descriptor.host = address.ip().to_string();
        descriptor.port = address.port();
        descriptor.secret_read_root_file = Some(root_path.display().to_string());
        crate::secure_file::write_owner_only(
            &ready,
            serde_json::to_string(&descriptor).unwrap().as_bytes(),
        )
        .unwrap();
        let error = tokio::task::spawn_blocking(move || {
            mint_secret_read_via_http(
                &ready,
                Some("DURABLE_ADMIN_SENTINEL".to_owned()),
                crate::admin_secret_read::SecretReadMintSpec {
                    scopes: std::collections::BTreeSet::from([
                        crate::admin_secret_read::SecretReadScope::AdminInspect,
                    ]),
                    ttl_ms: 60_000,
                    row_budget: 10,
                    byte_budget: 1_000,
                },
            )
        })
        .await
        .unwrap()
        .unwrap_err();
        assert!(
            error
                .to_string()
                .contains("SNAPBACK_HOST_STOP_STALE_DESCRIPTOR"),
            "{error:#}"
        );
        assert_eq!(mint_calls.load(Ordering::SeqCst), 0);
        let observed = String::from_utf8_lossy(&observed.lock().unwrap()).into_owned();
        assert!(!observed.contains("DURABLE_ADMIN_SENTINEL"));
        assert!(!observed.contains("sbrk_"));
        assert!(!observed.contains("\"proof\""));
        server.abort();
    }

    #[test]
    fn credential_bearing_cli_debug_never_exposes_token_material() {
        const SENTINEL: &str = "CLI_CREDENTIAL_SENTINEL_MUST_NOT_ESCAPE";
        let target = TargetArgs {
            url: Some("http://127.0.0.1:4287".to_owned()),
            ready_file: None,
            token: Some(SENTINEL.to_owned()),
            impersonation_capability_stdin: false,
        };
        let target_debug = format!("{target:?}");
        assert!(!target_debug.contains(SENTINEL), "{target_debug}");
        assert!(target_debug.contains("[REDACTED]"), "{target_debug}");

        let command = HostCommand::Inspect(target);
        let command_debug = format!("{command:?}");
        assert!(!command_debug.contains(SENTINEL), "{command_debug}");
        assert!(command_debug.contains("[REDACTED]"), "{command_debug}");

        let mint_command = HostCommand::SecretReadMint {
            ready_file: PathBuf::from("ready.json"),
            token: Some(SENTINEL.to_owned()),
            admin_inspect: true,
            receipts: false,
            table: Vec::new(),
            function: Vec::new(),
            explain_function: Vec::new(),
            telemetry_events: false,
            telemetry_export: false,
            errors_issue: false,
            ttl_seconds: 60,
            row_budget: 10,
            byte_budget: 1_000,
        };
        let mint_debug = format!("{mint_command:?}");
        assert!(!mint_debug.contains(SENTINEL), "{mint_debug}");
        assert!(mint_debug.contains("[REDACTED]"), "{mint_debug}");

        let cli = Cli::parse_from([
            "snapback",
            "inspect",
            "--url",
            "http://127.0.0.1:4287",
            "--token",
            SENTINEL,
        ]);
        let cli_debug = format!("{cli:?}");
        assert!(!cli_debug.contains(SENTINEL), "{cli_debug}");

        let resolved = ResolvedHttpTarget {
            server_url: "http://127.0.0.1:4287".to_owned(),
            minted_token: Some(SENTINEL.to_owned()),
            impersonation_capability: None,
        };
        let resolved_debug = format!("{resolved:?}");
        assert!(!resolved_debug.contains(SENTINEL), "{resolved_debug}");
        assert!(resolved_debug.contains("[REDACTED]"), "{resolved_debug}");
    }

    #[test]
    fn telemetry_cli_pins_all_verbs_and_since_until_export_spelling() {
        let stats = Cli::parse_from([
            "snapback",
            "telemetry",
            "stats",
            "--url",
            "http://127.0.0.1:4287",
            "--kind",
            "http_request",
        ]);
        assert!(matches!(
            stats.command,
            Some(HostCommand::Telemetry {
                command: TelemetryCommand::Stats { .. }
            })
        ));

        let events = Cli::parse_from([
            "snapback",
            "telemetry",
            "events",
            "--url",
            "http://127.0.0.1:4287",
            "--secret-read-lease",
            "sbrl_test",
            "--limit",
            "7",
        ]);
        assert!(matches!(
            events.command,
            Some(HostCommand::Telemetry {
                command: TelemetryCommand::Events { limit: 7, .. }
            })
        ));

        let export = Cli::parse_from([
            "snapback",
            "telemetry",
            "export",
            "--url",
            "http://127.0.0.1:4287",
            "--secret-read-lease",
            "sbrl_test",
            "--since",
            "100",
            "--until",
            "200",
        ]);
        match export.command {
            Some(HostCommand::Telemetry {
                command: TelemetryCommand::Export { filter, .. },
            }) => {
                assert_eq!(filter.from_ms, Some(100));
                assert_eq!(filter.to_ms, Some(200));
                assert_eq!(
                    filter.query_pairs(false),
                    vec![("fromMs", "100".to_owned()), ("toMs", "200".to_owned())]
                );
            }
            _ => panic!("telemetry export command did not parse"),
        }

        let query = Cli::parse_from([
            "snapback",
            "telemetry",
            "query",
            "SELECT count(*) FROM telemetry_events_visible",
            "--db",
            "state.sqlite3",
        ]);
        assert!(matches!(
            query.command,
            Some(HostCommand::Telemetry {
                command: TelemetryCommand::Query { .. }
            })
        ));
    }

    #[test]
    fn errors_cli_pins_agent_views_raw_detail_cas_and_deploy_resolve() {
        let issues = Cli::parse_from([
            "snapback",
            "errors",
            "issues",
            "--url",
            "http://127.0.0.1:4287",
            "--since",
            "release-a",
            "--order",
            "count",
            "--limit",
            "7",
        ]);
        assert!(matches!(
            issues.command,
            Some(HostCommand::Errors {
                command: ErrorsCommand::Issues {
                    since: Some(ref release),
                    limit: 7,
                    ..
                }
            }) if release == "release-a"
        ));

        let issue = Cli::parse_from([
            "snapback",
            "errors",
            "issue",
            "iss_00000000000000000000000000",
            "--url",
            "http://127.0.0.1:4287",
            "--secret-read-lease",
            "sbrl_test",
        ]);
        assert!(matches!(
            issue.command,
            Some(HostCommand::Errors {
                command: ErrorsCommand::Issue { .. }
            })
        ));

        let transition = Cli::parse_from([
            "snapback",
            "errors",
            "transition",
            "iss_00000000000000000000000000",
            "--to",
            "ignored",
            "--expect-seq",
            "3",
            "--url",
            "http://127.0.0.1:4287",
        ]);
        assert!(matches!(
            transition.command,
            Some(HostCommand::Errors {
                command: ErrorsCommand::Transition { expect_seq: 3, .. }
            })
        ));

        let resolve = Cli::parse_from([
            "snapback",
            "errors",
            "resolve",
            "--open-before",
            "release-a",
            "--url",
            "http://127.0.0.1:4287",
        ]);
        assert!(matches!(
            resolve.command,
            Some(HostCommand::Errors {
                command: ErrorsCommand::Resolve { ref open_before, .. }
            }) if open_before == "release-a"
        ));
    }

    #[test]
    fn ready_file_write_publishes_final_content() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("ready.json");

        write_ready_file_atomic(&path, "{\"ready\":true}\n").unwrap();

        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "{\"ready\":true}\n"
        );
        let leftovers = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().contains(".tmp-"))
            .count();
        assert_eq!(leftovers, 0, "temporary ready files should be cleaned up");
    }

    #[test]
    fn ready_file_must_be_identity_disjoint_from_every_managed_artifact() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("app.sqlite3");
        std::fs::write(&db, b"database").unwrap();

        for ready in [
            db.clone(),
            crate::instance_lock::lock_path_for_database(&db).unwrap(),
            crate::config::ConfigStore::path_for_database(&db),
            crate::admin::admin_token_sibling(&db),
            path_with_filename_suffix(&db, "-wal").unwrap(),
            dir.path()
                .join("missing-parent")
                .join("..")
                .join("app.sqlite3-wal"),
        ] {
            let error = validate_path_disjointness(
                &managed_startup_paths(Some(&db), Some(&ready)).unwrap(),
            )
            .unwrap_err();
            assert!(
                error
                    .to_string()
                    .contains("SNAPBACK_READY_FILE_PATH_COLLISION"),
                "{error:#}"
            );
        }

        let distinct = dir.path().join("server.ready.json");
        validate_path_disjointness(&managed_startup_paths(Some(&db), Some(&distinct)).unwrap())
            .unwrap();

        for colliding_db in [
            dir.path().join("operator.ready.secret-read-root"),
            dir.path().join("operator.ready.impersonation"),
        ] {
            let colliding_ready = dir.path().join("operator.ready");
            let error = validate_path_disjointness(
                &managed_startup_paths(Some(&colliding_db), Some(&colliding_ready)).unwrap(),
            )
            .unwrap_err();
            assert!(
                error
                    .to_string()
                    .contains("SNAPBACK_READY_FILE_PATH_COLLISION")
            );
        }
    }

    #[test]
    fn ready_file_cannot_create_a_parent_at_a_managed_sidecar_path() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("app.sqlite3");
        let lock = crate::instance_lock::lock_path_for_database(&db).unwrap();
        let nested_ready = lock.join("ready.json");
        let error = validate_path_disjointness(
            &managed_startup_paths(Some(&db), Some(&nested_ready)).unwrap(),
        )
        .expect_err("a ready parent cannot occupy the database lock path");
        assert!(
            error
                .to_string()
                .contains("SNAPBACK_READY_FILE_PATH_COLLISION"),
            "{error:#}"
        );
        assert!(
            !lock.exists(),
            "preflight must reject before creating the colliding parent"
        );

        let wal = super::path_with_filename_suffix(&db, "-wal").unwrap();
        let dotdot_ready = wal.join("transient").join("..").join("ready.json");
        assert!(
            validate_path_disjointness(
                &managed_startup_paths(Some(&db), Some(&dotdot_ready)).unwrap()
            )
            .is_err(),
            "normalized .. spelling must not bypass the ancestor collision"
        );
        assert!(!wal.exists());
    }

    #[cfg(unix)]
    #[test]
    fn ready_file_rejects_symlink_and_hardlink_aliases() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("app.sqlite3");
        std::fs::write(&db, b"database").unwrap();

        let symlink = dir.path().join("symlink.ready");
        std::os::unix::fs::symlink(&db, &symlink).unwrap();
        let error =
            validate_path_disjointness(&managed_startup_paths(Some(&db), Some(&symlink)).unwrap())
                .unwrap_err();
        assert!(
            error
                .to_string()
                .contains("SNAPBACK_READY_FILE_PATH_COLLISION")
        );

        let hardlink = dir.path().join("hardlink.ready");
        std::fs::hard_link(&db, &hardlink).unwrap();
        let error =
            validate_path_disjointness(&managed_startup_paths(Some(&db), Some(&hardlink)).unwrap())
                .unwrap_err();
        assert!(
            error
                .to_string()
                .contains("SNAPBACK_READY_FILE_PATH_COLLISION")
        );
    }

    #[cfg(unix)]
    #[test]
    fn ready_file_parent_swap_cannot_redirect_publish_or_cleanup() {
        let dir = tempfile::tempdir().unwrap();
        let database_parent = dir.path().join("database");
        let ready_parent = dir.path().join("ready");
        std::fs::create_dir_all(&database_parent).unwrap();
        std::fs::create_dir_all(&ready_parent).unwrap();
        let database = database_parent.join("app.sqlite3");
        std::fs::write(&database, b"live database").unwrap();

        let mutable_parent = dir.path().join("mutable-parent");
        std::os::unix::fs::symlink(&ready_parent, &mutable_parent).unwrap();
        let requested = mutable_parent.join("app.sqlite3");
        let mut target = ReadyFileTarget::open(&requested).unwrap();
        let temporary = super::ready_file_temp_path(target.pinned_path()).unwrap();
        let protected = managed_startup_paths(Some(&database), Some(target.pinned_path())).unwrap();
        let pinned_token = ready_parent.join("app.sqlite3.admin-token");
        let database_token = database_parent.join("app.sqlite3.admin-token");
        std::fs::write(&pinned_token, b"ephemeral token").unwrap();
        std::fs::write(&database_token, b"database-side sentinel").unwrap();
        let token_identity = super::existing_file_identity(&pinned_token).unwrap();

        std::fs::remove_file(&mutable_parent).unwrap();
        std::os::unix::fs::symlink(&database_parent, &mutable_parent).unwrap();
        target
            .write_atomic_protected("ready", &protected, &temporary)
            .unwrap();

        assert_eq!(std::fs::read(&database).unwrap(), b"live database");
        assert_eq!(
            std::fs::read(ready_parent.join("app.sqlite3")).unwrap(),
            b"ready"
        );
        target.remove_published().unwrap();
        target
            .remove_sibling_if_identity(&pinned_token, token_identity)
            .unwrap();
        assert_eq!(std::fs::read(&database).unwrap(), b"live database");
        assert_eq!(
            std::fs::read(&database_token).unwrap(),
            b"database-side sentinel"
        );
        assert!(!ready_parent.join("app.sqlite3").exists());
        assert!(!pinned_token.exists());
    }

    // 0137 G1: the secret-read proof root is descriptor-scoped custody. It is
    // removed with the descriptor — but only the adopted inode, never a
    // foreign replacement at the same path.
    #[cfg(unix)]
    #[test]
    fn secret_read_root_cleanup_removes_only_the_adopted_identity() {
        let dir = tempfile::tempdir().unwrap();
        let mut target = ReadyFileTarget::open(&dir.path().join("dev.ready.json")).unwrap();
        let root = crate::admin_secret_read::secret_read_root_sibling(target.pinned_path());
        let resolve = |target: &ReadyFileTarget| {
            crate::admin_secret_read::resolve_secret_read_proof_root_with_io(
                &root,
                |path| target.read_owner_only_sibling(path),
                |path, bytes| target.write_owner_only_sibling(path, bytes),
            )
            .unwrap()
        };
        resolve(&target);
        target.adopt_secret_read_root_sibling(&root).unwrap();

        // A replaced inode is not this serve's sidecar: identity-guarded
        // removal must leave it alone.
        std::fs::remove_file(&root).unwrap();
        std::fs::write(&root, b"unrelated replacement").unwrap();
        target.remove_secret_read_root().unwrap();
        assert!(
            root.exists(),
            "a foreign inode at the sidecar path must survive"
        );

        std::fs::remove_file(&root).unwrap();
        resolve(&target);
        target.adopt_secret_read_root_sibling(&root).unwrap();
        target.remove_secret_read_root().unwrap();
        assert!(
            !root.exists(),
            "the adopted sidecar is removed with descriptor custody"
        );
    }

    #[cfg(unix)]
    #[test]
    fn attach_parent_swap_cannot_splice_a_different_impersonation_sidecar() {
        let dir = tempfile::tempdir().unwrap();
        let trusted_parent = dir.path().join("trusted");
        let attacker_parent = dir.path().join("attacker");
        std::fs::create_dir(&trusted_parent).unwrap();
        std::fs::create_dir(&attacker_parent).unwrap();
        let trusted_ready = std::fs::canonicalize(&trusted_parent)
            .unwrap()
            .join("server.ready.json");
        let attacker_ready = std::fs::canonicalize(&attacker_parent)
            .unwrap()
            .join("server.ready.json");
        crate::secure_file::write_owner_only(&trusted_ready, b"trusted-descriptor").unwrap();
        crate::secure_file::write_owner_only(&attacker_ready, b"attacker-descriptor").unwrap();

        let publish = |ready: &Path, nonce: &str| {
            let (_registry, operator) =
                crate::admin_impersonation::ImpersonationCapabilityRegistry::generate(
                    nonce.to_owned(),
                    &crate::auth::crypto::OsRandom,
                )
                .unwrap();
            let path = operator
                .publish_with(ready, |path, bytes| {
                    crate::secure_file::write_owner_only(path, bytes)
                })
                .unwrap();
            (path.clone(), std::fs::read(path).unwrap())
        };
        let (trusted_sidecar, trusted_bytes) = publish(&trusted_ready, "trusted");
        let (_attacker_sidecar, attacker_bytes) = publish(&attacker_ready, "attacker");
        assert_ne!(trusted_bytes, attacker_bytes);

        let mutable_parent = dir.path().join("mutable");
        std::os::unix::fs::symlink(&trusted_parent, &mutable_parent).unwrap();
        let target = ReadyFileTarget::open_existing(&mutable_parent.join("server.ready.json"))
            .expect("pin trusted attach parent");
        assert_eq!(
            target
                .read_owner_only_sibling(target.pinned_path())
                .unwrap(),
            b"trusted-descriptor"
        );

        std::fs::remove_file(&mutable_parent).unwrap();
        std::os::unix::fs::symlink(&attacker_parent, &mutable_parent).unwrap();
        assert_eq!(target.pinned_path(), trusted_ready);
        assert_eq!(
            target
                .read_strict_owner_only_sibling(
                    &trusted_sidecar,
                    crate::admin_impersonation::MAX_IMPERSONATION_CAPABILITY_FILE_BYTES,
                )
                .unwrap(),
            trusted_bytes,
            "the attach must keep reading beneath the parent pinned before descriptor validation"
        );
    }

    #[cfg(unix)]
    #[test]
    fn replaced_canonical_ready_parent_cannot_split_the_token_handoff() {
        use std::os::unix::fs::PermissionsExt as _;

        let dir = tempfile::tempdir().unwrap();
        let ready_parent = dir.path().join("ready");
        let moved_parent = dir.path().join("ready-moved");
        std::fs::create_dir(&ready_parent).unwrap();
        let target = ReadyFileTarget::open(&ready_parent.join("server.json")).unwrap();
        let token_path = crate::admin::admin_token_sibling(target.pinned_path());

        std::fs::rename(&ready_parent, &moved_parent).unwrap();
        std::fs::create_dir(&ready_parent).unwrap();
        let replacement_token = ready_parent.join("server.json.admin-token");
        std::fs::write(&replacement_token, b"another-instance-token\n").unwrap();
        std::fs::set_permissions(&replacement_token, std::fs::Permissions::from_mode(0o600))
            .unwrap();

        let error = crate::admin::resolve_serve_admin_token_with_io(
            None,
            Some(token_path),
            |path| target.read_owner_only_sibling(path),
            |path, bytes| target.write_owner_only_sibling(path, bytes),
        )
        .expect_err("a renamed/replaced advertised parent must fail closed");
        assert!(
            format!("{error:#}").contains("parent identity changed"),
            "{error:#}"
        );
        assert_eq!(
            std::fs::read(&replacement_token).unwrap(),
            b"another-instance-token\n",
            "the replacement directory's capability must never be adopted or rewritten"
        );
        assert!(!moved_parent.join("server.json.admin-token").exists());
    }

    #[cfg(unix)]
    #[test]
    fn ready_publication_refuses_a_precreated_temp_hardlink_without_truncation() {
        let dir = tempfile::tempdir().unwrap();
        let ready = dir.path().join("server.ready.json");
        let tmp = dir.path().join(".server.ready.json.injected-temp");
        let managed = dir.path().join("managed-artifact");
        std::fs::write(&managed, b"do-not-touch").unwrap();
        std::fs::hard_link(&managed, &tmp).unwrap();
        let protected = [
            ManagedPath {
                label: "ready file",
                path: ready.clone(),
            },
            ManagedPath {
                label: "ready-file temporary artifact",
                path: tmp.clone(),
            },
        ];

        write_ready_file_atomic_protected(&ready, "replacement", &protected, &tmp)
            .expect_err("an existing temp inode must never be opened or truncated");
        assert_eq!(std::fs::read(managed).unwrap(), b"do-not-touch");
        assert!(!ready.exists());
    }

    #[test]
    fn terminal_emission_seam_consumes_one_operator_and_frames_one_line() {
        let (_registry, operator) =
            crate::admin_impersonation::ImpersonationCapabilityRegistry::generate(
                "nonce-terminal".to_owned(),
                &crate::auth::crypto::OsRandom,
            )
            .unwrap();
        let mut output = Vec::new();
        super::emit_impersonation_capability_to_writer(operator, &mut output).unwrap();
        let output = String::from_utf8(output).unwrap();
        assert!(output.starts_with("impersonation capability: sbic_"));
        assert_eq!(output.lines().count(), 1);
        assert!(output.ends_with('\n'));
    }

    #[cfg(unix)]
    #[test]
    fn impersonation_sidecar_is_exact_owner_only_and_replaces_a_valid_crash_remnant() {
        use std::os::unix::fs::PermissionsExt as _;

        let dir = tempfile::tempdir().unwrap();
        let ready = dir.path().join("server.ready.json");
        let mut target = ReadyFileTarget::open(&ready).unwrap();
        let pinned_ready = target.pinned_path().to_path_buf();
        let sidecar =
            crate::admin_impersonation::impersonation_capability_sibling(&pinned_ready).unwrap();
        let temporary = super::ready_file_temp_path(&sidecar).unwrap();

        let (_old_registry, old_operator) =
            crate::admin_impersonation::ImpersonationCapabilityRegistry::generate(
                "nonce-old".to_owned(),
                &crate::auth::crypto::OsRandom,
            )
            .unwrap();
        old_operator
            .publish_with(&pinned_ready, |path, bytes| {
                crate::secure_file::write_owner_only(path, bytes)
            })
            .unwrap();
        let old_bytes = std::fs::read(&sidecar).unwrap();

        let (_new_registry, new_operator) =
            crate::admin_impersonation::ImpersonationCapabilityRegistry::generate(
                "nonce-new".to_owned(),
                &crate::auth::crypto::OsRandom,
            )
            .unwrap();
        let published = new_operator
            .publish_with(&pinned_ready, |path, bytes| {
                target.publish_owner_only_sibling_atomic(path, &temporary, bytes)
            })
            .unwrap();
        let new_bytes = std::fs::read(&published).unwrap();

        assert_ne!(
            new_bytes, old_bytes,
            "restart must replace the stale bearer"
        );
        assert!(!new_bytes.contains(&b'\n'));
        assert_eq!(
            std::fs::metadata(&published).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert!(!temporary.exists());
        drop(target);
        assert!(!sidecar.exists(), "the process-owned sidecar is cleaned up");
    }

    #[cfg(unix)]
    #[test]
    fn impersonation_sidecar_refuses_symlink_and_hardlink_destinations() {
        use std::os::unix::fs::PermissionsExt as _;

        for hard_link in [false, true] {
            let dir = tempfile::tempdir().unwrap();
            let ready = dir.path().join("server.ready.json");
            let mut target = ReadyFileTarget::open(&ready).unwrap();
            let pinned_ready = target.pinned_path().to_path_buf();
            let sidecar =
                crate::admin_impersonation::impersonation_capability_sibling(&pinned_ready)
                    .unwrap();
            let temporary = super::ready_file_temp_path(&sidecar).unwrap();
            let sentinel = dir.path().join("attacker-owned");
            std::fs::write(&sentinel, b"do-not-touch").unwrap();
            std::fs::set_permissions(&sentinel, std::fs::Permissions::from_mode(0o600)).unwrap();
            if hard_link {
                std::fs::hard_link(&sentinel, &sidecar).unwrap();
            } else {
                std::os::unix::fs::symlink(&sentinel, &sidecar).unwrap();
            }
            let (_registry, operator) =
                crate::admin_impersonation::ImpersonationCapabilityRegistry::generate(
                    "nonce".to_owned(),
                    &crate::auth::crypto::OsRandom,
                )
                .unwrap();
            operator
                .publish_with(&pinned_ready, |path, bytes| {
                    target.publish_owner_only_sibling_atomic(path, &temporary, bytes)
                })
                .expect_err("an aliasing destination must be refused");
            assert_eq!(std::fs::read(&sentinel).unwrap(), b"do-not-touch");
            assert!(!temporary.exists());
        }
    }

    #[cfg(unix)]
    #[test]
    fn descriptor_publication_failure_rolls_back_the_published_sidecar() {
        let dir = tempfile::tempdir().unwrap();
        let ready = dir.path().join("server.ready.json");
        let mut target = ReadyFileTarget::open(&ready).unwrap();
        let pinned_ready = target.pinned_path().to_path_buf();
        let descriptor_temp = super::ready_file_temp_path(&pinned_ready).unwrap();
        let sidecar =
            crate::admin_impersonation::impersonation_capability_sibling(&pinned_ready).unwrap();
        let sidecar_temp = super::ready_file_temp_path(&sidecar).unwrap();
        let (_registry, operator) =
            crate::admin_impersonation::ImpersonationCapabilityRegistry::generate(
                "nonce".to_owned(),
                &crate::auth::crypto::OsRandom,
            )
            .unwrap();
        operator
            .publish_with(&pinned_ready, |path, bytes| {
                target.publish_owner_only_sibling_atomic(path, &sidecar_temp, bytes)
            })
            .unwrap();
        assert!(sidecar.exists());

        std::fs::write(&descriptor_temp, b"attacker-temp").unwrap();
        let protected = managed_startup_paths(None, Some(&pinned_ready)).unwrap();
        target
            .write_atomic_protected("descriptor", &protected, &descriptor_temp)
            .expect_err("pre-created descriptor temporary must fail publication");
        drop(target);

        assert!(
            !sidecar.exists(),
            "sidecar must not outlive failed readiness"
        );
        assert_eq!(std::fs::read(&descriptor_temp).unwrap(), b"attacker-temp");
    }

    #[cfg(unix)]
    #[test]
    fn ready_file_is_owner_only_even_under_zero_umask() {
        use std::os::unix::fs::PermissionsExt as _;

        const CHILD_ENV: &str = "SNAPBACK_TEST_READY_FILE_ZERO_UMASK_CHILD";
        if std::env::var_os(CHILD_ENV).is_none() {
            // umask is process-global. Re-run only this test in a subprocess so
            // the adversarial setting cannot weaken files created by parallel
            // tests in this binary.
            let output = std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "cli::tests::ready_file_is_owner_only_even_under_zero_umask",
                    "--nocapture",
                ])
                .env(CHILD_ENV, "1")
                .output()
                .expect("run isolated zero-umask readiness test");
            assert!(
                output.status.success(),
                "zero-umask readiness child failed\nstdout:\n{}\nstderr:\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            return;
        }

        // SAFETY: this is the isolated child process described above.
        let previous = unsafe { libc::umask(0) };
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("ready.json");
        let result = write_ready_file_atomic(&path, "{\"ready\":true}\n");
        let mode = result
            .as_ref()
            .ok()
            .and_then(|()| std::fs::metadata(&path).ok())
            .map(|metadata| metadata.permissions().mode() & 0o777);
        // SAFETY: restore the child's process-global mask before asserting.
        unsafe { libc::umask(previous) };

        result.expect("publish readiness descriptor under zero umask");
        assert_eq!(mode, Some(0o600));
    }

    #[cfg(unix)]
    #[test]
    fn ready_file_is_readable_owner_only_under_restrictive_umask() {
        use std::os::unix::fs::PermissionsExt as _;

        const CHILD_ENV: &str = "SNAPBACK_TEST_READY_FILE_RESTRICTIVE_UMASK_CHILD";
        if std::env::var_os(CHILD_ENV).is_none() {
            let output = std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "cli::tests::ready_file_is_readable_owner_only_under_restrictive_umask",
                    "--nocapture",
                ])
                .env(CHILD_ENV, "1")
                .output()
                .expect("run isolated restrictive-umask readiness test");
            assert!(
                output.status.success(),
                "restrictive-umask readiness child failed\nstdout:\n{}\nstderr:\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            return;
        }

        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("ready.json");
        // SAFETY: this is the isolated child process described above. Create
        // the parent first so the test isolates the ready file's exact mode,
        // not tempfile's own directory creation policy.
        let previous = unsafe { libc::umask(0o777) };
        let result = write_ready_file_atomic(&path, "{\"ready\":true}\n");
        let mode = result
            .as_ref()
            .ok()
            .and_then(|()| std::fs::metadata(&path).ok())
            .map(|metadata| metadata.permissions().mode() & 0o777);
        let contents = std::fs::read_to_string(&path);
        // SAFETY: restore the child's process-global mask before asserting.
        unsafe { libc::umask(previous) };

        result.expect("publish readiness under restrictive umask");
        assert_eq!(mode, Some(0o600));
        assert_eq!(contents.unwrap(), "{\"ready\":true}\n");
    }

    #[cfg(unix)]
    #[test]
    fn ordinary_manifest_reads_do_not_change_shared_source_permissions() {
        use std::os::unix::fs::PermissionsExt as _;

        let dir = tempfile::tempdir().unwrap();
        let manifest = dir.path().join("schema.manifest.json");
        std::fs::write(&manifest, b"{\"schemaVersion\":\"snapback.dev/v1\"}").unwrap();
        std::fs::set_permissions(&manifest, std::fs::Permissions::from_mode(0o644)).unwrap();

        assert!(super::read_json_file(&manifest).is_ok());
        assert_eq!(
            std::fs::metadata(manifest).unwrap().permissions().mode() & 0o777,
            0o644,
            "ordinary CLI inputs are data, not local capability files"
        );
    }

    #[test]
    fn remote_url_never_selects_a_local_token_file() {
        let dir = tempfile::tempdir().unwrap();
        let chosen_by_attacker = dir.path().join("local-secret");
        std::fs::write(&chosen_by_attacker, b"must-not-leave-host").unwrap();
        let target = TargetArgs {
            url: Some("http://127.0.0.1:4400".to_owned()),
            ready_file: None,
            token: None,
            impersonation_capability_stdin: false,
        };

        let resolved = resolve_http_target(&target).expect("resolve remote target");
        assert_eq!(resolved.minted_token, None);
        assert_eq!(resolved.server_url, "http://127.0.0.1:4400");
    }

    #[test]
    fn ordinary_ready_file_host_op_never_reads_or_attaches_impersonation_sidecar() {
        let dir = tempfile::tempdir().unwrap();
        let ready = dir.path().join("ready.json");
        let canonical_ready = std::fs::canonicalize(dir.path())
            .unwrap()
            .join("ready.json");
        let sidecar =
            crate::admin_impersonation::impersonation_capability_sibling(&canonical_ready).unwrap();
        // If the ordinary path accidentally tries discovery this deliberately
        // invalid content will fail before the request reaches the server.
        std::fs::write(&sidecar, b"attacker-chosen-not-a-capability").unwrap();

        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let request = read_http_request(&mut stream);
            write_http_json(&mut stream, &json!({"ok": true}));
            request
        });

        let mut descriptor = stop_descriptor(Some("nonce-unused"));
        descriptor.server_url = format!("http://{address}");
        descriptor.target.server_url = Some(descriptor.server_url.clone());
        descriptor.impersonation_capability_file = Some(sidecar.display().to_string());
        crate::secure_file::write_owner_only(&ready, &serde_json::to_vec(&descriptor).unwrap())
            .unwrap();
        let target = TargetArgs {
            url: None,
            ready_file: Some(ready),
            token: None,
            impersonation_capability_stdin: false,
        };
        let response = super::post_host_op(&target, json!({"operation": "app.inspect"})).unwrap();
        assert_eq!(response["ok"], json!(true));
        let request = server.join().unwrap();
        assert!(request.starts_with("POST /_snapback/api/host-ops "));
        assert!(
            !request
                .to_ascii_lowercase()
                .contains(crate::admin_impersonation::IMPERSONATION_CAPABILITY_HEADER),
            "ordinary operations must not attach the independent effect capability"
        );
    }

    #[test]
    fn registered_impersonation_host_op_live_checks_then_attaches_exact_sidecar() {
        let dir = tempfile::tempdir().unwrap();
        let ready = dir.path().join("ready.json");
        let canonical_ready = std::fs::canonicalize(dir.path())
            .unwrap()
            .join("ready.json");
        let sidecar =
            crate::admin_impersonation::impersonation_capability_sibling(&canonical_ready).unwrap();
        let (_registry, operator) =
            crate::admin_impersonation::ImpersonationCapabilityRegistry::generate(
                "nonce-live".to_owned(),
                &crate::auth::crypto::OsRandom,
            )
            .unwrap();
        operator
            .publish_with(&canonical_ready, |path, bytes| {
                crate::secure_file::write_owner_only(path, bytes)
            })
            .unwrap();
        let expected = std::fs::read_to_string(&sidecar).unwrap();

        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let mut requests = Vec::new();
            for index in 0..2 {
                let (mut stream, _) = listener.accept().unwrap();
                let request = read_http_request(&mut stream);
                let body = if index == 0 {
                    health_with_nonce("nonce-live")
                } else {
                    json!({"ok": true})
                };
                write_http_json(&mut stream, &body);
                requests.push(request);
            }
            requests
        });

        let mut descriptor = stop_descriptor(Some("nonce-live"));
        descriptor.server_url = format!("http://{address}");
        descriptor.target.server_url = Some(descriptor.server_url.clone());
        descriptor.impersonation_capability_file = Some(sidecar.display().to_string());
        crate::secure_file::write_owner_only(&ready, &serde_json::to_vec(&descriptor).unwrap())
            .unwrap();
        let target = TargetArgs {
            url: None,
            ready_file: Some(ready),
            token: None,
            impersonation_capability_stdin: false,
        };
        super::post_host_op(
            &target,
            json!({"operation": "auth.mintSession", "args": {}}),
        )
        .unwrap();
        let requests = server.join().unwrap();
        assert!(requests[0].starts_with("GET /health "));
        assert!(requests[1].starts_with("POST /_snapback/api/host-ops "));
        assert!(requests[1].lines().any(|line| {
            let Some((name, value)) = line.split_once(':') else {
                return false;
            };
            name.eq_ignore_ascii_case(crate::admin_impersonation::IMPERSONATION_CAPABILITY_HEADER)
                && value.trim() == expected
        }));
    }

    #[test]
    fn remote_url_impersonation_request_never_selects_a_local_sidecar() {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let request = read_http_request(&mut stream);
            write_http_json(&mut stream, &json!({"ok": false}));
            request
        });
        let target = TargetArgs {
            url: Some(format!("http://{address}")),
            ready_file: None,
            token: None,
            impersonation_capability_stdin: false,
        };
        super::post_host_op(
            &target,
            json!({"operation": "auth.mintSession", "args": {}}),
        )
        .unwrap();
        let request = server.join().unwrap();
        assert!(request.starts_with("POST /_snapback/api/host-ops "));
        assert!(
            !request
                .to_ascii_lowercase()
                .contains(crate::admin_impersonation::IMPERSONATION_CAPABILITY_HEADER)
        );
    }

    #[test]
    fn adversarial_remote_server_cannot_make_cli_transmit_a_local_file() {
        const CHILD_ENV: &str = "SNAPBACK_TEST_REMOTE_TOKEN_EXFIL_CHILD";
        if std::env::var_os(CHILD_ENV).is_none() {
            // The ambient token is process-global. Isolate this network-boundary
            // regression so it proves the no-explicit-token path even when a
            // developer running the suite has SNAPBACK_ADMIN_TOKEN configured.
            let output = std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "cli::tests::adversarial_remote_server_cannot_make_cli_transmit_a_local_file",
                    "--nocapture",
                ])
                .env(CHILD_ENV, "1")
                .env_remove("SNAPBACK_ADMIN_TOKEN")
                .output()
                .expect("run isolated remote-token exfiltration test");
            assert!(
                output.status.success(),
                "remote-token exfiltration child failed\nstdout:\n{}\nstderr:\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            return;
        }

        use std::io::{Read as _, Write as _};
        use std::net::TcpListener as StdTcpListener;
        use std::time::Duration;

        fn read_request(stream: &mut std::net::TcpStream) -> String {
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut bytes = Vec::new();
            let mut chunk = [0_u8; 4096];
            loop {
                let count = stream.read(&mut chunk).expect("read attacker request");
                if count == 0 {
                    break;
                }
                bytes.extend_from_slice(&chunk[..count]);
                let Some(header_end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") else {
                    assert!(
                        bytes.len() < 64 * 1024,
                        "request headers are unexpectedly large"
                    );
                    continue;
                };
                let header_len = header_end + 4;
                let headers = String::from_utf8_lossy(&bytes[..header_len]);
                let content_len = headers
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        name.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().ok())
                            .flatten()
                    })
                    .unwrap_or(0);
                if bytes.len() >= header_len + content_len {
                    break;
                }
            }
            String::from_utf8_lossy(&bytes).into_owned()
        }

        let dir = tempfile::tempdir().unwrap();
        let chosen_path = dir.path().join("chosen-local-file");
        let chosen_contents = "chosen-local-file-contents-must-not-cross-network";
        std::fs::write(&chosen_path, chosen_contents).unwrap();

        let listener = StdTcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let malicious_path = chosen_path.display().to_string();
        let attacker = std::thread::spawn(move || {
            let mut requests = Vec::new();
            for _ in 0..2 {
                let (mut stream, _) = listener.accept().expect("accept CLI request");
                let request = read_request(&mut stream);
                let offered_path = request.starts_with("GET /_snapback/api/inspect ");
                let body = if offered_path {
                    serde_json::json!({"admin": {"tokenFile": malicious_path}}).to_string()
                } else {
                    serde_json::json!({"ok": true}).to_string()
                };
                write!(
                    stream,
                    "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                    body.len(),
                    body
                )
                .expect("answer CLI request");
                requests.push(request);
                if !offered_path {
                    break;
                }
            }
            requests
        });

        let target = TargetArgs {
            url: Some(format!("http://{address}")),
            ready_file: None,
            token: None,
            impersonation_capability_stdin: false,
        };
        let envelope = super::post_host_op(&target, json!({"operation": "app.inspect"}))
            .expect("host operation reaches adversarial server");
        assert_eq!(envelope["ok"], json!(true));

        let requests = attacker.join().expect("attacker server joins");
        assert_eq!(
            requests.len(),
            1,
            "a remote URL must be contacted only for the requested host operation"
        );
        assert!(requests[0].starts_with("POST /_snapback/api/host-ops "));
        assert!(
            !requests
                .iter()
                .any(|request| request.contains(chosen_contents)),
            "the attacker-chosen local file contents crossed the network"
        );
    }

    #[test]
    fn mixed_url_and_ready_file_never_sends_the_local_ready_token() {
        let dir = tempfile::tempdir().unwrap();
        let ready = dir.path().join("ready.json");
        let sibling = crate::admin::admin_token_sibling(&ready);
        std::fs::write(&sibling, b"sbat_local_only\n").unwrap();
        let mut descriptor = stop_descriptor(Some("nonce"));
        descriptor.admin_token_file = Some(sibling.display().to_string());
        std::fs::write(&ready, serde_json::to_vec(&descriptor).unwrap()).unwrap();

        let mixed = TargetArgs {
            url: Some("http://attacker.invalid".to_owned()),
            ready_file: Some(ready),
            token: None,
            impersonation_capability_stdin: false,
        };
        assert_eq!(
            resolve_http_target(&mixed)
                .expect("explicit URL wins in directly-constructed args")
                .minted_token,
            None
        );

        let parse = Cli::try_parse_from([
            "snapback",
            "inspect",
            "--url",
            "http://attacker.invalid",
            "--ready-file",
            "ready.json",
        ]);
        assert!(
            parse.is_err(),
            "the CLI must reject ambiguous mixed targets"
        );
    }

    #[test]
    fn ready_file_token_discovery_accepts_only_its_owner_only_sibling() {
        let dir = tempfile::tempdir().unwrap();
        let ready = dir.path().join("ready.json");
        let canonical_ready = std::fs::canonicalize(dir.path())
            .unwrap()
            .join("ready.json");
        let sibling = crate::admin::admin_token_sibling(&canonical_ready);
        let arbitrary = dir.path().join("arbitrary-secret");
        std::fs::write(&sibling, b"sbat_expected\n").unwrap();
        std::fs::write(&arbitrary, b"sbat_attacker_chosen\n").unwrap();

        let target = TargetArgs {
            url: None,
            ready_file: Some(ready.clone()),
            token: None,
            impersonation_capability_stdin: false,
        };
        let mut descriptor = stop_descriptor(Some("nonce"));
        descriptor.admin_token_file = Some(arbitrary.display().to_string());
        std::fs::write(&ready, serde_json::to_vec(&descriptor).unwrap()).unwrap();
        assert_eq!(resolve_http_target(&target).unwrap().minted_token, None);

        descriptor.admin_token_file = Some(sibling.display().to_string());
        std::fs::write(&ready, serde_json::to_vec(&descriptor).unwrap()).unwrap();
        assert_eq!(
            resolve_http_target(&target)
                .unwrap()
                .minted_token
                .as_deref(),
            Some("sbat_expected")
        );
    }

    #[test]
    fn ready_descriptor_swap_cannot_mix_an_attacker_url_with_a_trusted_token() {
        let dir = tempfile::tempdir().unwrap();
        let ready = dir.path().join("ready.json");
        let sibling = crate::admin::admin_token_sibling(&ready);
        std::fs::write(&sibling, b"sbat_must_not_be_exfiltrated\n").unwrap();

        let target = TargetArgs {
            url: None,
            ready_file: Some(ready.clone()),
            token: None,
            impersonation_capability_stdin: false,
        };
        let mut attacker = stop_descriptor(Some("attacker"));
        attacker.server_url = "http://attacker.invalid".to_owned();
        attacker.target.server_url = Some(attacker.server_url.clone());
        attacker.admin_token_file = None;
        std::fs::write(&ready, serde_json::to_vec(&attacker).unwrap()).unwrap();

        // Resolve the complete request authority from the attacker snapshot.
        // Swapping in a trusted descriptor afterwards must not trigger a
        // second descriptor read that adds its local capability to that URL.
        let resolved = resolve_http_target(&target).unwrap();
        let mut trusted = stop_descriptor(Some("trusted"));
        trusted.admin_token_file = Some(sibling.display().to_string());
        std::fs::write(&ready, serde_json::to_vec(&trusted).unwrap()).unwrap();

        assert_eq!(resolved.server_url, "http://attacker.invalid");
        assert_eq!(
            resolved.minted_token, None,
            "a later trusted descriptor must not donate its token to the already-resolved attacker URL"
        );
    }

    #[tokio::test]
    async fn automatic_port_selection_skips_busy_candidates() {
        let busy = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let busy_port = busy.local_addr().unwrap().port();

        let listener = bind_first_available("127.0.0.1", [busy_port, 0])
            .await
            .unwrap();

        assert_ne!(listener.local_addr().unwrap().port(), busy_port);
    }

    #[tokio::test]
    async fn explicit_port_zero_uses_os_assigned_port() {
        let listener = bind_listener("127.0.0.1", Some(0)).await.unwrap();

        assert_ne!(listener.local_addr().unwrap().port(), 0);
    }

    #[test]
    fn database_path_is_absolute_after_parent_creation() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db_path = dir.path().join("nested").join("snapback.db");

        let resolved = prepare_database_path(&db_path).unwrap();

        assert!(resolved.is_absolute());
        assert_eq!(resolved.file_name().unwrap(), "snapback.db");
        assert!(db_path.parent().unwrap().exists());
    }

    #[cfg(any(target_vendor = "apple", target_os = "linux"))]
    #[test]
    fn startup_creation_participates_in_the_restore_target_reservation() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("new-instance").join("snapback.db");
        let restore = TargetInstanceReservation::acquire(&db_path).unwrap();

        let error = prepare_database_path_for_startup(&db_path)
            .expect_err("startup must not create through a restore reservation");
        assert!(format!("{error:#}").contains("already reserved"));
        assert!(!db_path.parent().unwrap().exists());
        drop(restore);

        let (resolved, startup) = prepare_database_path_for_startup(&db_path).unwrap();
        let startup = startup.expect("absent instance creation holds the outer reservation");
        assert!(resolved.parent().unwrap().is_dir());
        let _inner = crate::instance_lock::DatabaseInstanceLock::acquire(&resolved).unwrap();
        drop(startup);

        let restore_after_start = TargetInstanceReservation::acquire(&resolved).unwrap();
        assert!(restore_after_start.ensure_target_absent().is_err());
    }

    #[cfg(any(target_vendor = "apple", target_os = "linux"))]
    #[test]
    fn startup_with_missing_outer_parents_creates_only_then_reserves_the_outer_parent() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir
            .path()
            .join("missing")
            .join("outer")
            .join("instance")
            .join("snapback.db");

        let (resolved, reservation) = prepare_database_path_for_startup(&db_path).unwrap();
        let reservation = reservation.expect("supported startup always holds a reservation");
        reservation.ensure_valid().unwrap();
        let expected = std::fs::canonicalize(db_path.parent().unwrap().parent().unwrap())
            .unwrap()
            .join("instance/snapback.db");
        assert_eq!(resolved, expected);
        assert!(db_path.parent().unwrap().is_dir());
        assert!(
            crate::instance_lock::target_reservation_path_for_database(&resolved)
                .unwrap()
                .is_file()
        );
    }

    #[cfg(any(target_vendor = "apple", target_os = "linux"))]
    #[test]
    fn existing_instance_restart_is_reserved_and_protects_the_persistent_sidecar() {
        let dir = tempfile::tempdir().unwrap();
        let instance = dir.path().join("existing-instance");
        std::fs::create_dir(&instance).unwrap();
        let db_path = instance.join("snapback.db");
        std::fs::write(&db_path, b"").unwrap();

        let (resolved, reservation) = prepare_database_path_for_startup(&db_path).unwrap();
        let reservation = reservation.expect("existing instances also retain the reservation");
        reservation.ensure_valid().unwrap();
        let lock_path =
            crate::instance_lock::target_reservation_path_for_database(&resolved).unwrap();
        assert!(lock_path.is_file());
        let error = validate_path_disjointness(
            &managed_startup_paths(Some(&resolved), Some(&lock_path)).unwrap(),
        )
        .expect_err("a ready file may not overwrite the persistent reservation record");
        assert!(
            error
                .to_string()
                .contains("SNAPBACK_READY_FILE_PATH_COLLISION")
        );
    }

    #[cfg(any(target_vendor = "apple", target_os = "linux"))]
    #[test]
    fn startup_target_replacement_invalidates_the_inner_lock_handoff() {
        let dir = tempfile::tempdir().unwrap();
        let instance = dir.path().join("replaceable-instance");
        std::fs::create_dir(&instance).unwrap();
        let db_path = instance.join("snapback.db");
        let (_resolved, reservation) = prepare_database_path_for_startup(&db_path).unwrap();
        let reservation = reservation.unwrap();
        let moved = dir.path().join("prepared-instance-moved");

        std::fs::rename(&instance, &moved).unwrap();
        std::fs::create_dir(&instance).unwrap();
        std::fs::write(instance.join("foreign-sentinel"), b"survive").unwrap();

        let error = reservation
            .ensure_valid()
            .expect_err("the pathname must still name the pinned target inode");
        assert!(error.to_string().contains("identity changed"));
        drop(reservation);
        assert_eq!(
            std::fs::read(instance.join("foreign-sentinel")).unwrap(),
            b"survive"
        );
    }

    #[cfg(any(target_vendor = "apple", target_os = "linux"))]
    #[test]
    fn startup_probe_remove_race_still_contends_on_the_restore_reservation() {
        use std::cell::RefCell;
        use std::rc::Rc;

        let dir = tempfile::tempdir().unwrap();
        let instance = dir.path().join("initially-existing");
        std::fs::create_dir(&instance).unwrap();
        let db_path = instance.join("snapback.db");
        let competing = Rc::new(RefCell::new(None));
        let competing_for_hook = Rc::clone(&competing);
        let instance_for_hook = instance.clone();
        BEFORE_STARTUP_TARGET_RESERVATION.with(|slot| {
            *slot.borrow_mut() = Some(Box::new(move |resolved| {
                std::fs::remove_dir(&instance_for_hook).unwrap();
                *competing_for_hook.borrow_mut() =
                    Some(TargetInstanceReservation::acquire(resolved).unwrap());
            }));
        });

        let error = prepare_database_path_for_startup(&db_path)
            .expect_err("startup may not fall back to unreserved create_dir_all");
        assert!(error.to_string().contains("could not be reserved"));
        assert!(!instance.exists());
        assert!(competing.borrow().is_some());
    }

    #[cfg(unix)]
    #[test]
    fn existing_database_symlink_resolves_to_target() {
        let dir = tempfile::tempdir().expect("tempdir");
        let real_db = dir.path().join("real.sqlite3");
        let link_db = dir.path().join("link.sqlite3");
        std::fs::write(&real_db, b"").expect("write db placeholder");
        std::os::unix::fs::symlink(&real_db, &link_db).expect("symlink db");

        let resolved = super::resolve_database_path(&link_db).unwrap();

        assert_eq!(resolved, std::fs::canonicalize(&real_db).unwrap());
    }

    #[cfg(all(unix, any(target_vendor = "apple", target_os = "linux")))]
    #[test]
    fn startup_reservation_follows_existing_instance_and_database_symlinks() {
        let dir = tempfile::tempdir().unwrap();
        let real_instance = dir.path().join("real-instance");
        let instance_alias = dir.path().join("instance-alias");
        std::fs::create_dir(&real_instance).unwrap();
        std::os::unix::fs::symlink(&real_instance, &instance_alias).unwrap();
        let real_db = real_instance.join("real.sqlite3");
        let database_alias = real_instance.join("alias.sqlite3");
        std::fs::write(&real_db, b"").unwrap();
        std::os::unix::fs::symlink(&real_db, &database_alias).unwrap();

        let requested = instance_alias.join("alias.sqlite3");
        let (resolved, reservation) = prepare_database_path_for_startup(&requested).unwrap();
        let reservation = reservation.expect("canonical instance remains reserved");

        assert_eq!(resolved, std::fs::canonicalize(&real_db).unwrap());
        reservation.ensure_valid().unwrap();
        assert!(
            crate::instance_lock::target_reservation_path_for_database(&resolved)
                .unwrap()
                .is_file()
        );
    }

    #[test]
    fn migrate_json_and_digest_acknowledgement_parse_as_one_surface() {
        let parsed = Cli::try_parse_from([
            "snapback",
            "migrate",
            "--json",
            "approve",
            "preview.json",
            "--db",
            "app.sqlite",
            "--out",
            "approved.json",
            "--acknowledge-digests",
            "plan:observation",
        ])
        .expect("migrate machine mode parses");
        let Some(HostCommand::Migrate { json, command }) = parsed.command else {
            panic!("expected migrate command");
        };
        assert!(json);
        let super::MigrateCommand::Approve {
            acknowledge_digests,
            ..
        } = command
        else {
            panic!("expected approve command");
        };
        assert_eq!(acknowledge_digests.as_deref(), Some("plan:observation"));
    }

    #[test]
    fn migrate_approval_authorization_is_exact_and_fail_closed() {
        let expected = "plan-digest:observation-digest";
        assert!(super::validate_approval_authorization(expected, Some(expected), None).is_ok());
        assert!(super::validate_approval_authorization(expected, None, Some("approve\n")).is_ok());
        for refused in [
            super::validate_approval_authorization(expected, Some("plan-digest"), None),
            super::validate_approval_authorization(expected, None, Some("yes")),
            super::validate_approval_authorization(expected, None, None),
        ] {
            let error = refused.expect_err("anything but exact authorization refuses");
            assert_eq!(
                error.diagnostic.code,
                "SNAPBACK_MIGRATION_APPROVAL_REQUIRED"
            );
        }
    }

    // The `migrate rehearse` verb is a thin file-IO wrapper over
    // `migrate_rehearse_artifact` — this witnesses verb parity: the same
    // binding refusal and the same marked, released receipt the library
    // path produces (`restore_derived_rehearsal_gates_production_apply` in
    // src/local.rs owns the semantic matrix).
    #[test]
    fn migrate_rehearse_verb_matches_the_library_path() {
        use super::{MigrateCommand, migrate_command};
        use crate::manifest::SchemaManifest;
        use crate::migration::{
            CompatibilityPosture, MIGRATION_APPROVAL_SCHEMA_VERSION, MIGRATION_PLAN_SCHEMA_VERSION,
            MigrationApprovalV1, MigrationAudienceV1, MigrationBackupRequirement,
            MigrationCeilings, MigrationConstants, MigrationExecutionStrategy,
            MigrationExpectedOutput, MigrationPlanArtifactV1, MigrationPlanBody, MigrationProof,
            MigrationProofMethod, MigrationRehearsalBindingV1, MigrationRehearsalPlanV1,
            RetainedWorkPosture, derive_intents, derive_plan_steps, new_operation_id,
        };

        let field = |name: &str, optional: bool| crate::manifest::FieldManifest {
            name: name.to_owned(),
            field_type: crate::manifest::FieldType::String,
            optional,
        };
        let schema_of = |fields: Vec<crate::manifest::FieldManifest>| SchemaManifest {
            tables: vec![crate::manifest::TableManifest {
                name: "notes".to_owned(),
                fields,
                indexes: Vec::new(),
                syncable: true,
                permission_backing: false,
                permission_fields: None,
                search_indexes: Vec::new(),
                vector_indexes: Vec::new(),
                search_live_limits: None,
                membership: None,
                asset_sharing: None,
                history: None,
            }],
            ..SchemaManifest::default()
        };
        let predecessor = schema_of(vec![field("body", false), field("extra", true)]);
        let successor = schema_of(vec![field("body", false)]);
        let identity = |schema: &SchemaManifest| {
            crate::storage::migration_executor::schema_identity(schema).expect("identity")
        };

        fn approve_for(
            snapback: &mut crate::local::LocalSnapback,
            artifact: &MigrationPlanArtifactV1,
        ) -> MigrationApprovalV1 {
            let resolved = snapback.migrate_resolved_audience().expect("audience");
            MigrationApprovalV1 {
                schema_version: MIGRATION_APPROVAL_SCHEMA_VERSION.to_owned(),
                plan_digest: artifact.plan_digest.clone(),
                observation_digest: "0".repeat(64),
                policy_digest: "local-operator-policy-v1".to_owned(),
                audience: MigrationAudienceV1 {
                    project_id: None,
                    target_id: None,
                    environment_id: None,
                    deployment_id: None,
                    release_id: None,
                    database_id: resolved.database_id,
                    stream_incarnation: resolved.stream_incarnation,
                    activation_generation: resolved.activation_generation,
                    target_profile_id: resolved.target_profile_id,
                },
                approver: "cli-witness-operator".to_owned(),
                generator_is_approver: true,
                issued_at_ms: super::wall_clock_now_ms(),
                expires_at_ms: super::wall_clock_now_ms() + 86_400_000,
                operation_id: new_operation_id(),
            }
        }

        let directory = tempfile::tempdir().unwrap();
        let db = directory.path().join("isolated.sqlite");
        let (artifact, approval, rehearsal) = {
            let mut isolated = crate::local::LocalSnapback::open(&db).expect("open isolated");
            isolated
                .apply_schema(predecessor.clone())
                .expect("apply schema");
            let intents = derive_intents(&predecessor, &successor).expect("derive intents");
            let steps = derive_plan_steps(&successor, &intents).expect("derive steps");
            let artifact = MigrationPlanArtifactV1::seal(MigrationPlanBody {
                schema_version: MIGRATION_PLAN_SCHEMA_VERSION.to_owned(),
                app: isolated.migrate_app_id(),
                instance: "cli-rehearse-witness".to_owned(),
                target_profile_id: crate::manifest::TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned(),
                predecessor_schema_hash: identity(&predecessor),
                successor_schema_hash: identity(&successor),
                predecessor_generation: 1,
                steps,
                execution_strategy: MigrationExecutionStrategy::SingleTransaction,
                proof: MigrationProof {
                    method: MigrationProofMethod::Full,
                    bound: None,
                },
                ceilings: MigrationCeilings {
                    max_affected_rows: 100,
                    max_bytes: 1024 * 1024,
                    max_writes: 100,
                    max_barrier_downtime_ms: 60_000,
                },
                compatibility_posture: CompatibilityPosture::SuccessorOnly,
                retained_work_posture: RetainedWorkPosture::Empty,
                backup: MigrationBackupRequirement {
                    required: false,
                    checkpoint_label: None,
                    rehearsal_required: true,
                },
                expected_output: MigrationExpectedOutput {
                    schema_hash: identity(&successor),
                    projection_generations: std::collections::BTreeMap::new(),
                },
                constants: MigrationConstants {
                    publication_timestamp_ms: 2_000_000_000_000,
                    rollback_timestamp_ms: None,
                    values: std::collections::BTreeMap::new(),
                },
                boundaries: Default::default(),
            })
            .expect("seal plan");
            let approval = approve_for(&mut isolated, &artifact);
            let rehearsal = MigrationRehearsalPlanV1::seal(
                artifact.plan_digest.clone(),
                MigrationRehearsalBindingV1 {
                    source_backup_identity: "backup-cli-witness-1".to_owned(),
                    isolated_database_id: approval.audience.database_id.clone(),
                    restore_epoch_ms: 1_000,
                    target_profile_id: approval.audience.target_profile_id.clone(),
                },
            )
            .expect("seal rehearsal");
            (artifact, approval, rehearsal)
        };

        let write = |name: &str, value: serde_json::Value| {
            let path = directory.path().join(name);
            std::fs::write(&path, serde_json::to_string_pretty(&value).unwrap()).unwrap();
            path
        };
        let observation = crate::migration::MigrationPreviewObservationV1 {
            schema_version: "migration-observation-v1".to_owned(),
            plan_digest: artifact.plan_digest.clone(),
            target_head_version: 1,
            observed_at_ms: super::wall_clock_now_ms(),
            precondition_rows: std::collections::BTreeMap::new(),
            capability_health: std::collections::BTreeMap::new(),
        };
        let approved_path = write(
            "approved.json",
            json!({ "artifact": artifact, "observation": observation, "approval": approval }),
        );
        let schema_path = write("successor.json", serde_json::to_value(&successor).unwrap());
        let rehearsal_path = write("rehearsal.json", serde_json::to_value(&rehearsal).unwrap());

        // (a) Binding refusal parity: the verb delegates to
        // `migrate_rehearse_artifact` before any receipt write, and a
        // refused invocation exits the process with the diagnostic envelope
        // (`migrate_emit`'s CLI contract), so the refusal semantics are
        // asserted at the exact boundary the verb wraps — a database that
        // is not the bound restore-derived target refuses and nothing is
        // written.
        let other_db = directory.path().join("other.sqlite");
        {
            let mut other = crate::local::LocalSnapback::open(&other_db).expect("open other");
            other
                .apply_schema(predecessor.clone())
                .expect("apply schema");
            let other_approval = approve_for(&mut other, &artifact);
            let error = other
                .migrate_rehearse_artifact(&artifact, &other_approval, &successor, &rehearsal)
                .expect_err("a rehearsal must not execute off its bound target");
            assert_eq!(
                error.diagnostic.code,
                "SNAPBACK_MIGRATION_REHEARSAL_INVALID"
            );
        }

        // (b) Against the bound isolated target the verb writes the same
        // marked, released receipt the library path produces.
        let out = directory.path().join("rehearsal-receipt.json");
        migrate_command(
            MigrateCommand::Rehearse {
                approved: approved_path,
                schema: schema_path,
                rehearsal_plan: rehearsal_path,
                db: db.clone(),
                out: out.clone(),
            },
            true,
        )
        .expect("rehearse verb runs");
        let receipt: crate::storage::migration_executor::MigrationReceiptV1 =
            serde_json::from_str(&std::fs::read_to_string(&out).unwrap()).unwrap();
        assert!(receipt.rehearsal, "the receipt is marked rehearsal");
        assert_eq!(receipt.state.kind(), "released");
        assert_eq!(receipt.plan_digest, artifact.plan_digest);
    }
}

// ---------------------------------------------------------------------------
// migrate.* — LLP 0081 host operations (local profile)
// ---------------------------------------------------------------------------

fn migrate_envelope(
    operation: &str,
    ok: bool,
    data: Value,
    diagnostics: Vec<crate::diagnostic::Diagnostic>,
) -> HostOpsResult {
    HostOpsResult {
        schema_version: SNAPBACK_SCHEMA_VERSION.to_owned(),
        result_kind: HOST_OPS_RESULT_KIND.to_owned(),
        request_id: crate::ids::mint_time_ordered(crate::ids::Kind::HostOperation),
        operation: operation.to_owned(),
        ok,
        target: crate::host_ops::HostOpsTarget {
            app_id: "local".to_owned(),
            app_root: None,
            target_profile: crate::manifest::TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned(),
            server_url: None,
        },
        authority: None,
        artifacts: HostOpsArtifacts::default(),
        data,
        diagnostics,
        next: Vec::new(),
        secret_read_tables: Vec::new(),
        secret_read_rows: 0,
        secret_read_query: false,
        secret_read_provenance_complete: true,
    }
}

struct MigrateOutput {
    data: Value,
    human: String,
}

impl MigrateOutput {
    fn new(data: Value, human: String) -> Self {
        Self { data, human }
    }
}

fn migrate_emit(
    operation: &str,
    json_only: bool,
    outcome: anyhow::Result<MigrateOutput>,
) -> anyhow::Result<()> {
    let envelope = match outcome {
        Ok(output) => {
            if !json_only && !output.human.is_empty() {
                eprint!("{}", output.human);
                if !output.human.ends_with('\n') {
                    eprintln!();
                }
            }
            migrate_envelope(operation, true, output.data, Vec::new())
        }
        Err(error) => {
            let diagnostic = match error.downcast::<crate::diagnostic::SnapbackError>() {
                Ok(snapback) => snapback.diagnostic,
                Err(other) => {
                    crate::diagnostic::SnapbackError::error(
                        "SNAPBACK_MIGRATION_PLAN_INVALID",
                        "storage",
                        other.to_string(),
                    )
                    .diagnostic
                }
            };
            if !json_only {
                eprintln!(
                    "Migration command failed\n  {}: {}",
                    diagnostic.code, diagnostic.message
                );
            }
            migrate_envelope(operation, false, Value::Null, vec![diagnostic])
        }
    };
    println!("{}", serde_json::to_string_pretty(&envelope)?);
    if envelope.ok {
        Ok(())
    } else {
        std::process::exit(1);
    }
}

fn migrate_read_json<T: serde::de::DeserializeOwned>(
    path: &PathBuf,
    what: &str,
) -> anyhow::Result<T> {
    let raw = std::fs::read_to_string(path)
        .map_err(|error| anyhow::anyhow!("read {what} {}: {error}", path.display()))?;
    serde_json::from_str(&raw).map_err(|error| anyhow::anyhow!("parse {what}: {error}"))
}

/// The preview/approve interchange file: the sealed plan artifact plus its
/// separately digested observation. Only the plan bytes are required to be
/// byte-identical across repeated previews.
#[derive(serde::Deserialize, serde::Serialize)]
struct MigratePreviewFile {
    artifact: crate::migration::MigrationPlanArtifactV1,
    observation: crate::migration::MigrationPreviewObservationV1,
    #[serde(rename = "generatedBy")]
    generated_by: String,
}

#[derive(serde::Deserialize, serde::Serialize)]
struct MigrateApprovedFile {
    artifact: crate::migration::MigrationPlanArtifactV1,
    observation: crate::migration::MigrationPreviewObservationV1,
    approval: crate::migration::MigrationApprovalV1,
}

fn wall_clock_now_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

fn local_operator() -> String {
    std::env::var("USER").unwrap_or_else(|_| "local-operator".to_owned())
}

fn migrate_presentation_width() -> usize {
    crate::migration_presentation::presentation_width_from_columns(
        std::env::var("COLUMNS").ok().as_deref(),
    )
}

fn migrate_review_options(
    json_only: bool,
) -> crate::migration_presentation::MigrationPresentationOptions {
    let width = migrate_presentation_width();
    if !json_only && io::stderr().is_terminal() {
        crate::migration_presentation::MigrationPresentationOptions::review(width)
    } else {
        crate::migration_presentation::MigrationPresentationOptions::narration(width)
    }
}

fn approval_authorization_error(message: impl Into<String>) -> crate::diagnostic::SnapbackError {
    crate::diagnostic::SnapbackError::error(
        "SNAPBACK_MIGRATION_APPROVAL_REQUIRED",
        "migration",
        message.into(),
    )
}

fn validate_approval_authorization(
    expected: &str,
    acknowledgement: Option<&str>,
    interactive_response: Option<&str>,
) -> crate::diagnostic::SnapbackResult<()> {
    if let Some(acknowledgement) = acknowledgement {
        return if acknowledgement == expected {
            Ok(())
        } else {
            Err(approval_authorization_error(
                "--acknowledge-digests did not exactly match the displayed plan and observation digests",
            ))
        };
    }
    match interactive_response.map(str::trim) {
        Some("approve") => Ok(()),
        Some(_) => Err(approval_authorization_error(
            "approval was not confirmed; the approval artifact was not written",
        )),
        None => Err(approval_authorization_error(format!(
            "non-interactive approval requires --acknowledge-digests {expected}"
        ))),
    }
}

pub(crate) fn migrate_command(command: MigrateCommand, json_only: bool) -> anyhow::Result<()> {
    match command {
        MigrateCommand::Preview {
            db,
            intents,
            schema,
            publication_timestamp_ms,
            rollback_timestamp_ms,
            constants,
            max_affected_rows,
            max_barrier_downtime_ms,
            out,
        } => migrate_emit(
            "migrate.preview",
            json_only,
            (|| {
                let successor: crate::manifest::SchemaManifest =
                    migrate_read_json(&schema, "successor schema")?;
                let constant_values: std::collections::BTreeMap<String, Value> = match &constants {
                    Some(path) => migrate_read_json(path, "constants")?,
                    None => Default::default(),
                };
                let snapback = crate::local::LocalSnapback::open(&db)?;
                let predecessor = snapback.migrate_predecessor_schema();
                // Explicit intents win; a schema-diff derivation covers exactly
                // the unambiguous changes (LLP 0081 §2 — the derivation refuses
                // anything needing a declared backfill/rename/conversion).
                let intents: Vec<crate::migration::MigrationIntent> = match &intents {
                    Some(path) => migrate_read_json(path, "intents")?,
                    None => crate::migration::derive_intents(&predecessor, &successor)?,
                };
                let steps = crate::migration::derive_plan_steps(&successor, &intents)?;
                // @ref LLP 0160#2-the-ideal-experience-moment-by-moment —
                // Moment 3's estimate line is sourced only from the separately
                // digested, snapshot-pinned observation; it adds no plan
                // authority and is omitted when no step declares a read table.
                let (head, precondition_rows) =
                    snapback.migrate_preview_observation_facts(&steps, max_affected_rows)?;
                let body = crate::migration::MigrationPlanBody {
                    schema_version: crate::migration::MIGRATION_PLAN_SCHEMA_VERSION.to_owned(),
                    app: snapback.migrate_app_id(),
                    instance: db.display().to_string(),
                    target_profile_id: crate::manifest::TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX
                        .to_owned(),
                    predecessor_schema_hash: crate::storage::migration_executor::schema_identity(
                        &predecessor,
                    )?,
                    successor_schema_hash: crate::storage::migration_executor::schema_identity(
                        &successor,
                    )?,
                    predecessor_generation: head,
                    steps,
                    execution_strategy:
                        crate::migration::MigrationExecutionStrategy::SingleTransaction,
                    proof: crate::migration::MigrationProof {
                        method: crate::migration::MigrationProofMethod::Full,
                        bound: None,
                    },
                    ceilings: crate::migration::MigrationCeilings {
                        max_affected_rows,
                        max_bytes: 64 * 1024 * 1024,
                        max_writes: max_affected_rows,
                        max_barrier_downtime_ms,
                    },
                    compatibility_posture: crate::migration::CompatibilityPosture::SuccessorOnly,
                    retained_work_posture: crate::migration::RetainedWorkPosture::Empty,
                    backup: crate::migration::MigrationBackupRequirement {
                        required: false,
                        checkpoint_label: None,
                        rehearsal_required: false,
                    },
                    expected_output: crate::migration::MigrationExpectedOutput {
                        schema_hash: crate::storage::migration_executor::schema_identity(
                            &successor,
                        )?,
                        projection_generations: Default::default(),
                    },
                    constants: crate::migration::MigrationConstants {
                        publication_timestamp_ms,
                        rollback_timestamp_ms,
                        values: constant_values,
                    },
                    boundaries: Default::default(),
                };
                let artifact = crate::migration::MigrationPlanArtifactV1::seal(body)?;
                crate::migration::validate_plan_artifact(&artifact, &predecessor, &successor)?;
                let observation = crate::migration::MigrationPreviewObservationV1 {
                    schema_version: crate::migration::MIGRATION_OBSERVATION_SCHEMA_VERSION
                        .to_owned(),
                    plan_digest: artifact.plan_digest.clone(),
                    target_head_version: head,
                    observed_at_ms: wall_clock_now_ms(),
                    precondition_rows,
                    capability_health: Default::default(),
                };
                let file = MigratePreviewFile {
                    artifact,
                    observation,
                    generated_by: local_operator(),
                };
                std::fs::write(&out, serde_json::to_string_pretty(&file)?)?;
                let human = crate::migration_presentation::render_plan(
                    &file.artifact,
                    &file.observation,
                    migrate_review_options(json_only),
                );
                Ok(MigrateOutput::new(
                    json!({
                        "planId": file.artifact.plan_id,
                        "planDigest": file.artifact.plan_digest,
                        "steps": file.artifact.body.steps.len(),
                        "out": out.display().to_string(),
                    }),
                    human,
                ))
            })(),
        ),
        MigrateCommand::Approve {
            plan,
            approver,
            expires_in_ms,
            db,
            out,
            acknowledge_digests,
        } => migrate_emit(
            "migrate.approve",
            json_only,
            (|| {
                let preview: MigratePreviewFile = migrate_read_json(&plan, "preview file")?;
                let mut snapback = crate::local::LocalSnapback::open(&db)?;
                let audience = snapback.migrate_resolved_audience()?;
                let approver = approver.unwrap_or_else(local_operator);
                let now = wall_clock_now_ms();
                let approval = crate::migration::MigrationApprovalV1 {
                    schema_version: crate::migration::MIGRATION_APPROVAL_SCHEMA_VERSION.to_owned(),
                    plan_digest: preview.artifact.plan_digest.clone(),
                    observation_digest: crate::migration::observation_digest(&preview.observation)?,
                    policy_digest: "local-operator-policy-v1".to_owned(),
                    audience: crate::migration::MigrationAudienceV1 {
                        project_id: None,
                        target_id: None,
                        environment_id: None,
                        deployment_id: None,
                        release_id: None,
                        database_id: audience.database_id,
                        stream_incarnation: audience.stream_incarnation,
                        activation_generation: audience.activation_generation,
                        target_profile_id: audience.target_profile_id,
                    },
                    approver: approver.clone(),
                    generator_is_approver: approver == preview.generated_by,
                    issued_at_ms: now,
                    expires_at_ms: now + expires_in_ms,
                    operation_id: crate::migration::new_operation_id(),
                };
                crate::migration::validate_approval_shape(&approval)?;
                let rendered = crate::migration_presentation::render_approval(
                    &preview.artifact,
                    &preview.observation,
                    &approval,
                    migrate_review_options(json_only),
                );
                // Render before the authorization gate and before the output
                // path is touched. A CI/piped face is redacted and therefore
                // requires the exact two-digest acknowledgement.
                // @ref LLP 0160#2-the-ideal-experience-moment-by-moment —
                // Moment 4's render-before-mint/write ordering.
                if !json_only {
                    eprint!("{rendered}");
                    if !rendered.ends_with('\n') {
                        eprintln!();
                    }
                }
                let expected = crate::migration_presentation::approval_acknowledgement_token(
                    &preview.artifact,
                    &preview.observation,
                );
                if acknowledge_digests.is_some() {
                    validate_approval_authorization(
                        &expected,
                        acknowledge_digests.as_deref(),
                        None,
                    )?;
                } else if !json_only && io::stdin().is_terminal() && io::stderr().is_terminal() {
                    eprint!("Type `approve` to authorize these exact digests: ");
                    std::io::Write::flush(&mut io::stderr())?;
                    let mut response = String::new();
                    io::stdin().read_line(&mut response)?;
                    validate_approval_authorization(&expected, None, Some(&response))?;
                } else {
                    validate_approval_authorization(&expected, None, None)?;
                }
                let approved = MigrateApprovedFile {
                    artifact: preview.artifact,
                    observation: preview.observation,
                    approval,
                };
                std::fs::write(&out, serde_json::to_string_pretty(&approved)?)?;
                Ok(MigrateOutput::new(
                    json!({
                        "operationId": approved.approval.operation_id,
                        "planId": approved.artifact.plan_id,
                        "generatorIsApprover": approved.approval.generator_is_approver,
                        "out": out.display().to_string(),
                    }),
                    String::new(),
                ))
            })(),
        ),
        MigrateCommand::Apply {
            approved,
            schema,
            db,
            dry_run,
            rehearsal_receipt,
        } => migrate_emit(
            "migrate.apply",
            json_only,
            (|| {
                let approved: MigrateApprovedFile = migrate_read_json(&approved, "approved file")?;
                let successor: crate::manifest::SchemaManifest =
                    migrate_read_json(&schema, "successor schema")?;
                let mut snapback = crate::local::LocalSnapback::open(&db)?;
                if dry_run {
                    let predecessor = snapback.migrate_predecessor_schema();
                    crate::migration::validate_plan_artifact(
                        &approved.artifact,
                        &predecessor,
                        &successor,
                    )?;
                    crate::migration::validate_approval_shape(&approved.approval)?;
                    let mut human = crate::migration_presentation::render_plan(
                        &approved.artifact,
                        &approved.observation,
                        crate::migration_presentation::MigrationPresentationOptions::narration(
                            migrate_presentation_width(),
                        ),
                    );
                    human.push_str("\nDry run\n  Non-authoritative pre-admission estimate; real admission re-proves under the closed fence.\n");
                    return Ok(MigrateOutput::new(
                        json!({
                            "dryRun": true,
                            "operationId": approved.approval.operation_id,
                            "planId": approved.artifact.plan_id,
                            "wouldApply": true,
                        }),
                        human,
                    ));
                }
                let rehearsal: Option<crate::storage::migration_executor::MigrationReceiptV1> =
                    match &rehearsal_receipt {
                        Some(path) => Some(migrate_read_json(path, "rehearsal receipt")?),
                        None => None,
                    };
                let receipt = snapback.migrate_apply_artifact_with_rehearsal_receipt(
                    &approved.artifact,
                    &approved.approval,
                    &successor,
                    rehearsal.as_ref(),
                )?;
                let human = crate::migration_presentation::render_receipt(
                    &receipt,
                    migrate_presentation_width(),
                );
                Ok(MigrateOutput::new(serde_json::to_value(&receipt)?, human))
            })(),
        ),
        MigrateCommand::Rehearse {
            approved,
            schema,
            rehearsal_plan,
            db,
            out,
        } => migrate_emit(
            "migrate.rehearse",
            json_only,
            (|| {
                let approved: MigrateApprovedFile = migrate_read_json(&approved, "approved file")?;
                let successor: crate::manifest::SchemaManifest =
                    migrate_read_json(&schema, "successor schema")?;
                let rehearsal: crate::migration::MigrationRehearsalPlanV1 =
                    migrate_read_json(&rehearsal_plan, "rehearsal plan")?;
                let mut snapback = crate::local::LocalSnapback::open(&db)?;
                // Thin wrapper: identical semantics to the library path — the
                // binding check, marking, and freshness anchor all live in the
                // executor, not here.
                let receipt = snapback.migrate_rehearse_artifact(
                    &approved.artifact,
                    &approved.approval,
                    &successor,
                    &rehearsal,
                )?;
                std::fs::write(&out, serde_json::to_string_pretty(&receipt)?)?;
                let human = crate::migration_presentation::render_receipt(
                    &receipt,
                    migrate_presentation_width(),
                );
                Ok(MigrateOutput::new(
                    json!({
                        "operationId": approved.approval.operation_id,
                        "planId": approved.artifact.plan_id,
                        "rehearsal": true,
                        "state": receipt.state.kind(),
                        "out": out.display().to_string(),
                    }),
                    human,
                ))
            })(),
        ),
        MigrateCommand::Cancel { approved, db } => migrate_emit(
            "migrate.cancel",
            json_only,
            (|| {
                let approved: MigrateApprovedFile = migrate_read_json(&approved, "approved file")?;
                let mut snapback = crate::local::LocalSnapback::open(&db)?;
                snapback.migrate_request_cancel(&approved.approval.operation_id)?;
                let mut human = crate::migration_presentation::render_plan(
                    &approved.artifact,
                    &approved.observation,
                    crate::migration_presentation::MigrationPresentationOptions::narration(
                        migrate_presentation_width(),
                    ),
                );
                human.push('\n');
                human.push_str(&crate::migration_presentation::render_action(
                    "cancellation",
                    &approved.approval.operation_id,
                    "cancel_requested",
                    migrate_presentation_width(),
                ));
                Ok(MigrateOutput::new(
                    json!({
                        "operationId": approved.approval.operation_id,
                        "cancelRequested": true,
                    }),
                    human,
                ))
            })(),
        ),
        MigrateCommand::Verify { operation_id, db } => migrate_emit(
            "migrate.verify",
            json_only,
            (|| {
                let snapback = crate::local::LocalSnapback::open(&db)?;
                let verification = snapback.migrate_verify_receipt(&operation_id)?;
                let human = crate::migration_presentation::render_verification(
                    &verification,
                    migrate_presentation_width(),
                );
                Ok(MigrateOutput::new(verification, human))
            })(),
        ),
        MigrateCommand::Rollback { receipt, db } => migrate_emit(
            "migrate.rollback",
            json_only,
            (|| {
                // The fast rollback runs under the original operation's
                // approval, which acknowledged the rollback boundary by
                // declaring the explicit rollback timestamp — so the input is
                // the approved migration file (the same authority `apply`
                // consumed), not a regenerated plan.
                let approved: MigrateApprovedFile = migrate_read_json(&receipt, "approved file")?;
                let mut snapback = crate::local::LocalSnapback::open(&db)?;
                let rollback =
                    snapback.migrate_rollback_artifact(&approved.artifact, &approved.approval)?;
                let human = crate::migration_presentation::render_rollback_receipt(
                    &rollback,
                    migrate_presentation_width(),
                );
                Ok(MigrateOutput::new(serde_json::to_value(&rollback)?, human))
            })(),
        ),
    }
}
