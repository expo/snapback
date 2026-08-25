use crate::admin::{AppState, ResolvedAdminToken, ServerContext};
use crate::admin_secret_read::{
    SecretReadMintSpec, SecretReadScope, secret_read_root_sibling,
    sign_secret_read_mint_from_owner_only_file,
};
use crate::contract_types::ServerProfile;
use crate::host_ops::{HOST_OPS_RESULT_KIND, HostOpsArtifacts, HostOpsResult, HostReadyDescriptor};
use crate::instance_lock::{DatabaseInstanceLock, StartupTargetReservation};
use crate::local::{DiagnosticBoundary, LocalSnapback};
use crate::manifest::{SNAPBACK_SCHEMA_VERSION, SchemaManifestValidationExt as _};
#[cfg(all(test, not(feature = "cli-owner")))]
use crate::remainder_adapter::RemainderLocalSnapbackExt as _;
use crate::server;
use anyhow::Context;
use clap::{CommandFactory, Parser};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest as _, Sha256};
use std::collections::{BTreeMap, HashMap};
use std::ffi::OsString;
use std::io::{self, ErrorKind, IsTerminal, Read as _};
use std::net::IpAddr;
use std::ops::RangeInclusive;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use uuid::Uuid;

const DEFAULT_PORT_RANGE_START: u16 = 4287;
const DEFAULT_PORT_RANGE_END: u16 = 4387;
const DEV_FRESH_RESET_ARTIFACTS: &str = "this is supported only for the canonical CLI-owned `<project>/.snapback/dev.sqlite3`; after validating ownership and refusing custom, shared, or symlink-ambiguous paths before deletion, it removes the managed whole store, including custody keyrings/configuration and asset blobs: the selected database and its `-wal`, `-shm`, `-journal`, `.auth-keyring.json`, `.config.json`, `.operation-detail-keyring.json`, `.admin-token`, `.console-credentials`, and `.dev-identity` siblings; the store's `completeness-proof-keyring.json`, `resume-keyring.json`, and `assets/blobs`; plus managed ready/application-ready files. Unregistered files in `.snapback` are preserved";

fn shell_single_quote_path(path: &Path) -> String {
    format!("'{}'", path.to_string_lossy().replace('\'', "'\"'\"'"))
}

fn dev_fresh_destructive_repair(database: &Path) -> String {
    format!(
        "For disposable local dev data only, run `snapback reset --dev-fresh --db {}`; {DEV_FRESH_RESET_ARTIFACTS}",
        shell_single_quote_path(database),
    )
}

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

fn resolve_auth_startup_artifacts(
    args: &Args,
    embedded_startup_artifacts: Option<&crate::auth::mode::StartupArtifacts>,
) -> crate::diagnostic::SnapbackResult<Option<crate::auth::mode::StartupArtifacts>> {
    match (
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
    }
}

fn auth_startup_required(message: &'static str) -> crate::diagnostic::SnapbackError {
    crate::diagnostic::SnapbackError::error(
        "SNAPBACK_AUTH_STARTUP_ARTIFACT_REQUIRED",
        "auth-mode",
        message,
    )
}

fn with_expected_deployment(
    error: impl Into<crate::diagnostic::SnapbackError>,
    expected: Option<&crate::auth::mode::DeploymentIdentity>,
    observed: Option<&crate::auth::mode::DeploymentIdentity>,
) -> crate::diagnostic::SnapbackError {
    let mut error = error.into();
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
/// data-discarding, canonical whole-store export-then-reseed procedure with
/// its exact ownership boundary.
// @ref LLP 0058#cold-startup-artifact-carrier — "this is not a wedge": the
// refusal must carry its own repair, not just the expected identity
// (issues/closed/20260805-doc-comment-artifact-mismatch-no-successor-migration.md).
// @ref LLP 0192#d-1-the-durable-state-registry — destructive recovery must
// reset the managed durable-state set; a database-only deletion leaves
// path-bound custody siblings behind.
fn with_settled_pin_repair(
    mut error: crate::diagnostic::SnapbackError,
    database: &Path,
) -> crate::diagnostic::SnapbackError {
    let dev_fresh = dev_fresh_destructive_repair(database);
    let quoted_database = shell_single_quote_path(database);
    if let Value::Object(details) = &mut error.diagnostic.details {
        details.insert(
            "repair".to_owned(),
            json!({
                "keepData": "restart on the startup carrier matching expectedDeployment (regenerate it from the previous sources if needed), then apply the changed sources through the running server's live reload (`snapback dev` watch reload): the running-server provision moves the pinned deployment forward without touching local data",
                "reseedFresh": format!(
                    "to discard the managed whole store and reseed from scratch: first preserve the complete durable-state set if needed with `snapback store export --db {quoted_database} --output <ignored-store-export-dir>`. Then use the supported one-shot path: {dev_fresh}",
                ),
                "safety": "the refusal compares the startup carrier's deployment identity with the active deployment identity stored in the selected database; it is not a keyring, runtime, or codegen mismatch (LLP 0058). The whole-store scope comes from the managed reset and custody contract (LLP 0192), not from keyrings participating in this comparison; do not hand-edit generated artifacts or hashes to match the pin",
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
    snapback.quarantine_auth_mode(&code)
}

fn minted_admin_token_handoff_lines(
    minted: &ResolvedAdminToken,
    stdout_is_terminal: bool,
) -> Vec<String> {
    let mut lines = Vec::new();
    if minted.fresh {
        if stdout_is_terminal {
            lines.push(format!("admin token: {}", minted.token));
        } else if minted.file.is_some() {
            lines.push(
                "admin token: suppressed on non-TTY stdout; read the owner-only token file below"
                    .to_owned(),
            );
        } else {
            lines.push(
                "admin token: suppressed on non-TTY stdout; restart from a TTY or set SNAPBACK_ADMIN_TOKEN"
                    .to_owned(),
            );
        }
    }
    if let Some(file) = &minted.file {
        lines.push(format!("admin token file: {}", file.display()));
    }
    lines
}

fn print_minted_admin_token_handoff(minted: &ResolvedAdminToken) {
    for line in minted_admin_token_handoff_lines(minted, io::stdout().is_terminal()) {
        println!("{line}");
    }
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

fn emit_startup_successor_activation(
    previous: &crate::auth::mode::DeploymentIdentity,
    successor: &crate::auth::mode::DeploymentIdentity,
) {
    if let Ok(line) = serde_json::to_string(&json!({
        "schemaVersion": "snapback.startup-successor-activation.v1",
        "fromDeployment": previous,
        "toDeployment": successor,
    })) {
        eprintln!("{line}");
    }
}

fn startup_successor_refused(
    error: crate::diagnostic::SnapbackError,
    expected: &crate::auth::mode::DeploymentIdentity,
    observed: &crate::auth::mode::DeploymentIdentity,
) -> crate::diagnostic::SnapbackError {
    crate::diagnostic::SnapbackError::error(
        "SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH",
        "auth-mode",
        "the complete sessions successor could not be activated; startup remains refused",
    )
    .with_details(json!({
        "expectedDeployment": expected,
        "observedDeployment": observed,
        "activationFailure": error.diagnostic,
        "safety": "the existing database and durable deployment pin were preserved",
    }))
}

/// Activate one complete sessions successor before listener bind. There are no
/// predecessor process roots or live boundaries in a cold process, but the
/// durable cut still runs under the same transition guard and same-mode
/// storage transaction as network provisioning. Ordinary startup never enters
/// this path without the explicit supervisor-owned opt-in.
// @ref LLP 0058#same-mode-provisioning — a cold successor still preflights the
// complete pair twice and advances schema, deployment identity, authorization
// state, and the prepared function generation as one guarded activation.
fn activate_startup_sessions_successor(
    snapback: &mut LocalSnapback,
    carrier: &crate::auth::mode::StartupArtifacts,
    expected: &crate::auth::mode::DeploymentIdentity,
    observed: &crate::auth::mode::DeploymentIdentity,
) -> crate::diagnostic::SnapbackResult<crate::auth::mode::AuthModeStateRecord> {
    let state = snapback.activate_startup_sessions_successor(carrier, expected, observed)?;
    emit_startup_successor_activation(expected, observed);
    Ok(state)
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
    let carrier = resolve_auth_startup_artifacts(args, None);
    compose_auth_mode_startup_with_embedded(args, carrier, snapback, auth_runtime, readiness).await
}

async fn compose_auth_mode_startup_with_embedded(
    args: &Args,
    carrier_result: crate::diagnostic::SnapbackResult<Option<crate::auth::mode::StartupArtifacts>>,
    snapback: &mut LocalSnapback,
    auth_runtime: &mut crate::auth::runtime::AuthRuntime,
    readiness: &crate::auth::mode::AuthProgramReadiness,
) -> crate::diagnostic::SnapbackResult<crate::auth::mode::AuthModeStateRecord> {
    use crate::auth::mode::AuthModeStatus;
    use crate::manifest::AuthMode;

    let mut snapshot = snapback.auth_mode_snapshot()?;
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
        snapback.unstage_auth_mode()?;
        snapshot = snapback.auth_mode_snapshot()?;
    }

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
                let expected = snapshot.state.active_deployment.clone().ok_or_else(|| {
                    crate::auth::mode::mode_corrupt(
                        "settled sessions mode lacks an active deployment",
                    )
                })?;
                let carrier = carrier.as_ref().ok_or_else(|| {
                    with_expected_deployment(
                        auth_startup_required(
                            "settled sessions mode requires --startup-artifacts on every start",
                        ),
                        Some(&expected),
                        None,
                    )
                })?;
                let observed = startup_blocking(|| {
                    snapback.preflight_auth_artifacts(carrier, AuthMode::Sessions)
                })?;
                if carrier.seed.is_some() {
                    return Err(crate::diagnostic::SnapbackError::error(
                        "SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH",
                        "auth-mode",
                        "a settled sessions restart carrier cannot contain seed data",
                    ));
                }
                if let Err(error) = carrier.require_deployment(&expected) {
                    if !args.activate_startup_successor {
                        return Err(with_settled_pin_repair(
                            with_expected_deployment(error, Some(&expected), Some(&observed)),
                            &args.db,
                        ));
                    }
                    if !readiness.session_activation_ready {
                        return Err(auth_policy_unavailable(
                            "this binary cannot activate a sessions startup successor",
                        ));
                    }
                    return startup_blocking(|| {
                        activate_startup_sessions_successor(snapback, carrier, &expected, &observed)
                    })
                    .map_err(|error| startup_successor_refused(error, &expected, &observed));
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
                        snapback.apply_same_mode_dev_deployment_with_functions(
                            deployment,
                            carrier.schema.clone(),
                            &carrier.functions,
                            carrier.seed.clone(),
                        )?;
                        snapback.auth_mode_snapshot()
                    })?;
                    snapback.publish_preflighted_functions(
                        carrier.functions.clone(),
                        publication_generation,
                        DiagnosticBoundary::Standalone,
                    );
                    return Ok(state.state);
                }
                snapshot = startup_blocking(|| {
                    snapback.stage_auth_mode_with_functions(
                        deployment,
                        carrier.schema.clone(),
                        &carrier.functions,
                        carrier.seed.clone(),
                    )?;
                    snapback.auth_mode_snapshot()
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
                        .consume_sessions_auth_mode_with_functions(readiness, &carrier.functions)
                })
                .expect_err("item readiness must refuse sessions consume");
                snapback.record_startup_diagnostics(std::slice::from_ref(&error.diagnostic));
                return Ok(snapback.auth_mode_snapshot()?.state);
            }
            let publication_generation = snapback.reserve_function_publication_generation()?;
            let provider = auth_runtime.provider();
            let maintenance = provider.exclusive_maintenance().await;
            if let Err(error) = startup_blocking(|| maintenance.prepare_catalog_activation()) {
                drop(maintenance);
                return quarantine_pending_startup(snapback, error);
            }
            let state = match startup_blocking(|| {
                snapback.consume_sessions_auth_mode_with_functions(readiness, &carrier.functions)
            }) {
                Ok(state) => state,
                Err(error) => {
                    drop(maintenance);
                    return quarantine_pending_startup(snapback, error);
                }
            };
            auth_runtime.confirm_catalog_ready_after_mode_activation(snapback)?;
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
                snapback.consume_dev_downgrade_with_functions(
                    args.allow_auth_downgrade,
                    now_ms,
                    &carrier.functions,
                )
            }) {
                Ok(result) => result,
                Err(error) => {
                    snapback.record_startup_diagnostics(std::slice::from_ref(&error.diagnostic));
                    let state = snapback.auth_mode_snapshot()?.state;
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

    /// Scan an inclusive listener range in ascending order.
    #[arg(long, value_parser = parse_port_range, conflicts_with = "port")]
    pub port_range: Option<RangeInclusive<u16>>,

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

    /// Managed-dev-only pre-bind opt-in: activate a complete valid sessions
    /// successor against the existing local store when the ordinary startup
    /// pin proves that its identity differs from the settled deployment.
    #[arg(long, hide = true, requires = "startup_artifacts")]
    pub activate_startup_successor: bool,

    /// Fork-create-only pre-bind cut: after the complete startup pair is
    /// active, arm the derived fork's app-row writer coverage before bind.
    #[arg(long, hide = true, requires = "startup_artifacts")]
    pub derived_fork_arm_writer_coverage: bool,

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
    #[arg(
        long,
        value_parser = crate::auth::deployment::parse_auth_deployment_target,
        default_value = "local"
    )]
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
            port_range: None,
            db: PathBuf::from(".snapback/dev.sqlite3"),
            memory: false,
            ready_file: None,
            restored_from_backup: None,
            hosted_edge: None,
            hosted_admission: None,
            startup_artifacts: None,
            activate_startup_successor: false,
            derived_fork_arm_writer_coverage: false,
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

/// The `snapback` CLI (LLP 0024 first slice, built by LLP 0032 P6). Bare
/// invocation is discovery-safe and prints this root help; `snapback start`
/// explicitly owns foreground serving.
// @ref LLP 0184#4-agent-discovery-and-setup — native help names both MCP
// authority postures and the explicit control registration preview.
#[derive(Debug, Parser)]
#[command(
    name = "snapback",
    about = "Snapback local server, host operations, and embedded Guide",
    version = env!("CARGO_PKG_VERSION"),
    after_help = "Documentation:\n  snapback guide [QUERY]  Browse or search the build-bound Snapback Guide\n  snapback mcp            Serve the same Guide as read-only MCP resources\n\nOperate it:\n  snapback mcp serves read-only Guide resources; snapback mcp-control adds typed control tools with local admin authority.\n  Preview with: snapback agent setup --print <client> --server mcp-control\n\nServer environment:\n  SNAPBACK_NETWORK_PROFILE=<profile>\n  SNAPBACK_CRON_DISABLED=1\n  SNAPBACK_JOBS_DISABLED=1\n  SNAPBACK_ASSET_RUNNER_DISABLED=1\n  SNAPBACK_LIVE_COALESCE_DISABLED=1\n  SNAPBACK_SHUTDOWN_CHECKPOINT_TIMEOUT_MS=<ms>\n\nSelf-hosted replication (off by default):\n  SNAPBACK_REPLICATION_TARGET=file:///path or s3://bucket/prefix\n  SNAPBACK_REPLICATION_KEY_FILE=/owner-only/file-containing-32-raw-bytes\n  Losing that key makes encrypted keyring snapshots unrecoverable. Segment objects use only the reported provider/none posture."
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
    /// host.restart — credential-prove, stop, then spawn the replacement
    /// server named by the same readiness descriptor.
    Restart {
        #[arg(long)]
        ready_file: PathBuf,
        /// Operator reason recorded in the composed receipt.
        #[arg(long, default_value = "cli-restart")]
        reason: String,
    },
    /// host.wait — wait for host or application readiness tied to a live
    /// process identity.
    Wait {
        #[arg(long)]
        ready_file: PathBuf,
        #[arg(long, value_enum)]
        level: WaitLevel,
        #[arg(long)]
        application_ready_file: Option<PathBuf>,
        #[arg(long, default_value_t = 30_000)]
        timeout_ms: u64,
        /// Admin token for application readiness (defaults to
        /// SNAPBACK_ADMIN_TOKEN, then the descriptor's minted token).
        #[arg(long)]
        token: Option<String>,
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
    /// Decode and generation-fence one machine-applicable remediation item.
    Remediation {
        #[command(subcommand)]
        command: RemediationCommand,
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
    /// data.scan — bounded read-only table projection (LLP 0184 P1).
    Data {
        #[command(subcommand)]
        command: DataCommand,
    },
    /// Config planning, secret-safe value writes, verification, and removal.
    Config {
        #[command(subcommand)]
        command: ConfigCommand,
    },
    /// cron.list plus the admin-gated cron dispatch surface.
    Cron {
        #[command(subcommand)]
        command: CronCommand,
    },
    /// Receipt-bearing operator cleanup for expired ephemeral entries.
    Ephemeral {
        #[command(subcommand)]
        command: EphemeralCommand,
    },
    /// jobs.list / jobs.show (LLP 0184 P1 read-only inspection) plus
    /// jobs.drain (LLP 0184 §P2's injected-clock typed projection of the
    /// existing `POST /_snapback/api/jobs/drain` route).
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
    /// debug.live.forceResync — a non-production debug perturbation forcing
    /// one live subscription through the normal resync-required recovery
    /// path (LLP 0184 §B).
    Debug {
        #[command(subcommand)]
        command: DebugCommand,
    },
    /// Mint one short-lived, scoped administrative data-read lease. This is a
    /// ready-file-only operation because the proof root is local operator
    /// authority and can never be discovered from a URL.
    #[command(name = "secret-read-mint")]
    SecretReadMint {
        #[arg(long)]
        ready_file: PathBuf,
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
    /// Self-hosted async replication status, forced checkpoint, and offline
    /// database-plus-keyring restore (LLP 0188 gate G2).
    Replicate {
        #[command(subcommand)]
        command: ReplicateCommand,
    },
    /// Inspect or atomically export the complete file-backed store state.
    Store {
        #[command(subcommand)]
        command: StoreCommand,
    },
    /// Read-only adoption planning for platform-generated authority product
    /// projections over an existing local store.
    Authority {
        #[command(subcommand)]
        command: AuthorityCommand,
    },
    /// Create and operate finite-TTL, non-promotable local derived deployments.
    /// Lifecycle: create -> inspect/list -> diff -> drop/reap/recover.
    Fork {
        #[command(subcommand)]
        command: ForkCommand,
    },
    // @ref LLP 0184#4-agent-discovery-and-setup — catalog discovery works
    // offline from the exact build-bound artifact embedded in this binary.
    /// Search or describe the build's administrative control catalog.
    Controls {
        #[command(subcommand)]
        command: ControlsCommand,
    },
    // @ref LLP 0187#t4--build-the-out-of-repo-funnel-before-it-is-tested-for-real —
    // the packaged native runtime is the checkout-independent guide carrier.
    // @ref LLP 0061#4-distribution-and-discovery — the CLI searches the same
    // build-bound corpus served over HTTP and MCP rather than a second copy.
    /// Show Guide channels, return an exact API symbol, or search Markdown sections.
    Guide {
        /// Exact API symbol/module or words to find together in a Guide section.
        #[arg(value_name = "QUERY")]
        query: Vec<String>,
        /// One-based bounded slice for a large exact symbol or module result.
        #[arg(long, default_value_t = 1, value_parser = parse_guide_slice)]
        slice: usize,
        /// Emit snapback.guide-search.v1 JSON on every result branch.
        #[arg(long)]
        json: bool,
    },
    /// Emit the complete structured native command inventory. Hidden from
    /// human help because the packaged CLI consumes it to compose root JSON.
    #[command(name = "command-inventory", hide = true)]
    CommandInventory,
    /// Serve the build-bound Snapback Guide as read-only MCP resources over
    /// stdio. This is the resource-first Phase 2b slice; it exposes no tools.
    Mcp,
    /// Print this executable's independently stamped build identity. Runtime
    /// diagnostics use this read-only command without binding a server port.
    // @ref LLP 0031#server-binary-identity-on-health — expose the same
    // independently embedded facts without starting a server, so link probes
    // can classify the exact executable they just launched.
    BuildIdentity,
    /// Mint the receipt that binds a qualified staged package closure to this
    /// clean public-package release binary and its embedded store carrier.
    #[command(name = "packaged-store-qualification-receipt")]
    PackagedStoreQualificationReceipt {
        #[arg(long)]
        closure_manifest: PathBuf,
        #[arg(long)]
        suite_result: PathBuf,
        #[arg(long)]
        out: PathBuf,
    },
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

#[derive(Clone, Copy, Debug, Eq, PartialEq, clap::ValueEnum)]
pub enum WaitLevel {
    Host,
    Application,
}

impl WaitLevel {
    fn as_str(self) -> &'static str {
        match self {
            Self::Host => "host",
            Self::Application => "application",
        }
    }
}

#[derive(clap::Args, Debug)]
pub struct AdminArgs {
    /// Print the fragment-bearing console URL instead of opening a browser.
    #[arg(long)]
    no_open: bool,
    /// Emit versioned JSON records. The fragment-bearing URL is retained.
    #[arg(long, global = true)]
    json: bool,
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
        /// Write an owner-only readiness record after the claim URL and any
        /// relay lease are ready for observation.
        #[arg(long, value_name = "PATH")]
        link_ready_file: Option<PathBuf>,
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

/// @ref LLP 0184#p2-controlled-mutations — typed CLI/MCP projections of the
/// existing admin-gated cron dispatch routes, with an injected clock for
/// `tick` so acceptance never depends on wall-clock due-ness.
#[derive(clap::Subcommand)]
pub enum CronCommand {
    /// cron.list — list declared jobs and their current scheduler posture.
    List {
        #[command(flatten)]
        target: TargetArgs,
    },
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

/// @ref LLP 0184#p2-controlled-mutations — the operator cleanup is explicit
/// about cutoff and preview/apply posture, and every apply is bounded.
#[derive(clap::Subcommand)]
pub enum EphemeralCommand {
    #[command(
        group(clap::ArgGroup::new("cutoff").required(true).multiple(false).args(["older_than_ms", "cutoff_timestamp_ms"])),
        group(clap::ArgGroup::new("mode").required(true).multiple(false).args(["dry_run", "apply"]))
    )]
    Cleanup {
        #[command(flatten)]
        target: TargetArgs,
        /// Select entries whose expiry deadline is at least this old.
        #[arg(long)]
        older_than_ms: Option<u64>,
        /// Select entries whose expiry deadline is at or before this timestamp.
        #[arg(long)]
        cutoff_timestamp_ms: Option<u64>,
        /// Preview counts without deleting entries.
        #[arg(long)]
        dry_run: bool,
        /// Apply ordinary expiry removals.
        #[arg(long)]
        apply: bool,
        /// Maximum entries the corresponding apply may delete.
        #[arg(long, default_value_t = 1_000)]
        max_entries: usize,
    },
    /// ephemeral.operatorDelete — administrator bypass delete of one
    /// ephemeral entry, fenced on BOTH the room's scope epoch and the
    /// entry's own generation together (LLP 0184 §C). This is NOT the
    /// same authority as an application deleting its own ephemeral entry;
    /// it never evaluates application authorization.
    OperatorDelete {
        #[command(flatten)]
        target: TargetArgs,
        #[arg(long)]
        collection: String,
        /// Scope as a JSON object, e.g. '{"boardId":"board-1"}'.
        #[arg(long = "scope-json")]
        scope_json: String,
        #[arg(long = "entry-key")]
        entry_key: String,
        #[arg(long = "expected-scope-epoch")]
        expected_scope_epoch: u64,
        #[arg(long = "expected-entry-generation")]
        expected_entry_generation: u64,
        #[arg(long)]
        reason: String,
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

/// @ref LLP 0184#b-forced-live-resync--add-now — v1 targets exactly one
/// subscription, fenced by connection id + subscription id (the same
/// UUIDv7 identity the operator inspect projection already exposes) plus
/// the running server's startup nonce. Connection-wide targeting is
/// explicitly out of v1 scope (OQ4), not silently reachable through this
/// command. Non-production, local-only; refused on a primary
/// hosted/production target or a derived instance until LLP 0158 grants
/// recognition for this purpose.
#[derive(clap::Subcommand)]
pub enum DebugCommand {
    /// debug.live.forceResync — force one live subscription to re-snapshot
    /// through the normal `resync_required` recovery path. Changes no
    /// application data.
    #[command(name = "force-resync")]
    ForceResync {
        #[command(flatten)]
        target: TargetArgs,
        /// The connection id the subscription is open on.
        #[arg(long = "connection-id")]
        connection_id: String,
        /// The live subscription id to force through resync.
        #[arg(long = "subscription-id")]
        subscription_id: String,
        /// Why this debug perturbation is being invoked (a closed
        /// operator/test reason, recorded in the receipt printed on
        /// success).
        #[arg(long)]
        reason: String,
        /// Whether the client must also discard any retained rows for this
        /// subscription rather than keep them until the fresh snapshot
        /// lands.
        #[arg(long = "clear-retained")]
        clear_retained: bool,
        /// The target server's startup nonce. Defaults to the value already
        /// recorded in `--ready-file`'s readiness descriptor; required
        /// explicitly when targeting `--url` directly.
        #[arg(long = "startup-nonce")]
        startup_nonce: Option<String>,
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
    /// Preview or apply one existing-row closed field patch. The complete JSON
    /// input, including an apply token when applying, is read from a file or
    /// stdin and is never accepted as an argv value.
    Patch(DataPatchArgs),
}

#[derive(clap::Subcommand)]
pub enum ControlsCommand {
    /// Search controls by operation id, title, and intent keywords.
    List {
        /// Words that must all occur in the operation id, title, or intents.
        #[arg(long)]
        intent: Option<String>,
        /// Emit the build-catalog JSON shape (with filtered entries when
        /// --intent is present).
        #[arg(long)]
        json: bool,
    },
    /// Show the complete catalog row for one operation.
    Describe {
        operation: String,
        /// Emit a catalog-identity wrapper plus the complete row as JSON.
        #[arg(long)]
        json: bool,
    },
}

#[derive(clap::Subcommand)]
pub enum RemediationCommand {
    /// Consume one exact item copied from diagnostic.details.remediationSet.
    Apply {
        #[command(flatten)]
        target: TargetArgs,
        /// Closed snapback.remediation-apply.v1 JSON file, or '-' for stdin.
        #[arg(long, value_name = "FILE|-")]
        input: PathBuf,
    },
}

/// @ref LLP 0184#p2-controlled-mutations — `config.unset` carries no secret
/// value, so it needs no secret carrier; it is a direct, `AdminWrite`
/// projection of the existing `POST /_snapback/api/config/unset` route.
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
    /// config.set — write one value through stdin or an inherited file
    /// descriptor. The value is never accepted as a command-line argument.
    Set {
        #[command(flatten)]
        target: TargetArgs,
        /// The config entry identifier (e.g. `stripe.secretKey`).
        #[arg(long)]
        entry: String,
        /// Read the exact UTF-8 value bytes from standard input.
        #[arg(
            long,
            required_unless_present = "value_fd",
            conflicts_with = "value_fd"
        )]
        value_stdin: bool,
        /// Read the exact UTF-8 value bytes from inherited descriptor N.
        #[arg(
            long,
            value_name = "N",
            required_unless_present = "value_stdin",
            conflicts_with = "value_stdin"
        )]
        value_fd: Option<u32>,
        /// Add this value to a declared pool instead of replacing the entry.
        #[arg(long)]
        append: bool,
    },
    /// config.verify — run one entry's probe action and report ok/not-ok
    /// plus the probe diagnostic. Never returns the configured value.
    Verify {
        #[command(flatten)]
        target: TargetArgs,
        entry: String,
    },
    /// config.unset — remove a config entry's stored value.
    Unset {
        #[command(flatten)]
        target: TargetArgs,
        /// The config entry identifier (e.g. `stripe.secretKey`).
        #[arg(long)]
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

#[derive(clap::Args)]
#[command(group(
    clap::ArgGroup::new("data_patch_intent")
        .required(true)
        .multiple(false)
        .args(["preview", "apply"])
))]
pub struct DataPatchArgs {
    #[command(flatten)]
    pub target: TargetArgs,
    /// Validate and mint one short-lived apply token.
    #[arg(long)]
    pub preview: bool,
    /// Consume the apply token carried inside the JSON input and commit.
    #[arg(long)]
    pub apply: bool,
    /// Closed JSON input file, or '-' for stdin.
    #[arg(long, value_name = "FILE|-")]
    pub input: PathBuf,
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
    /// Export credential-free users, identities, and agent scope bases.
    Export {
        #[arg(long)]
        db: PathBuf,
        #[arg(long)]
        output: PathBuf,
    },
    /// Import one credential-free logical artifact into an empty v2 catalog.
    Import {
        #[arg(long = "from")]
        from: PathBuf,
        #[arg(long)]
        db: PathBuf,
    },
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
    /// Mint, inspect, or revoke finite auth-rehearsal grants on a live local
    /// sessions target.
    Rehearse {
        #[command(subcommand)]
        command: AuthRehearseCommand,
    },
    /// First-class email/password signup, signin, change, reset, and admin
    /// unlock. Password plaintext is never accepted in argv.
    Password {
        #[command(subcommand)]
        command: AuthPasswordCommand,
    },
    /// Consume or rotate one-time recovery codes on the sessions surface.
    Recovery {
        #[command(subcommand)]
        command: AuthRecoveryCommand,
    },
}

#[derive(clap::Args)]
pub struct AuthUrlArgs {
    /// Snapback server base URL (for example http://127.0.0.1:4287).
    #[arg(long)]
    pub url: String,
}

#[derive(clap::Args)]
#[group(required = true, multiple = false)]
pub struct AuthPasswordCarrierArgs {
    /// Read password line(s) from standard input. Change reads current then new.
    #[arg(
        long,
        conflicts_with_all = ["password_fd", "password_environment"]
    )]
    pub password_stdin: bool,
    /// Read password line(s) from inherited descriptor N without taking ownership.
    #[arg(
        long,
        value_name = "N",
        conflicts_with_all = ["password_stdin", "password_environment"]
    )]
    pub password_fd: Option<u32>,
    /// Internal marker injected by run_from_env when SNAPBACK_PASSWORD exists.
    /// It is hidden so the public CLI surface remains stdin/fd-only.
    #[arg(
        long = "__snapback-password-environment-carrier",
        hide = true,
        conflicts_with_all = ["password_stdin", "password_fd"]
    )]
    pub password_environment: bool,
}

#[derive(clap::Args)]
pub struct AuthSessionTokenCarrierArgs {
    /// Read the session bearer from standard input. When password input also
    /// uses stdin, this is the first line before the password line(s).
    #[arg(
        long,
        required_unless_present = "session_token_file",
        conflicts_with = "session_token_file"
    )]
    pub session_token_stdin: bool,
    /// Read the session bearer from a file rather than argv.
    #[arg(
        long,
        value_name = "FILE",
        required_unless_present = "session_token_stdin",
        conflicts_with = "session_token_stdin"
    )]
    pub session_token_file: Option<PathBuf>,
}

#[derive(clap::Subcommand)]
pub enum AuthPasswordCommand {
    /// Create a local-password principal and print its one-time recovery codes.
    Signup {
        #[command(flatten)]
        target: AuthUrlArgs,
        #[arg(long)]
        email: String,
        #[command(flatten)]
        password: AuthPasswordCarrierArgs,
    },
    /// Authenticate an existing local-password principal.
    Signin {
        #[command(flatten)]
        target: AuthUrlArgs,
        #[arg(long)]
        email: String,
        #[command(flatten)]
        password: AuthPasswordCarrierArgs,
    },
    /// Rotate the acting session's password and bearer. Password input is two
    /// lines: current password, then new password.
    Change {
        #[command(flatten)]
        target: AuthUrlArgs,
        #[command(flatten)]
        session: AuthSessionTokenCarrierArgs,
        #[command(flatten)]
        password: AuthPasswordCarrierArgs,
    },
    /// Reset a password with a local capture-mailbox challenge.
    Reset {
        #[command(flatten)]
        target: AuthUrlArgs,
        #[arg(long)]
        challenge_id: String,
        #[arg(long)]
        code: String,
        #[command(flatten)]
        password: AuthPasswordCarrierArgs,
    },
    /// Clear one password lockout through the AdminWrite route.
    Unlock {
        #[command(flatten)]
        target: TargetArgs,
        #[arg(long)]
        email: String,
    },
}

#[derive(clap::Subcommand)]
pub enum AuthRecoveryCommand {
    /// Consume one recovery code, mint a session, and print its replacement set.
    Consume {
        #[command(flatten)]
        target: AuthUrlArgs,
        #[arg(long)]
        email: String,
        #[arg(long)]
        code: String,
    },
    /// Replace the current recovery set and rotate the acting session bearer.
    Rotate {
        #[command(flatten)]
        target: AuthUrlArgs,
        #[command(flatten)]
        session: AuthSessionTokenCarrierArgs,
    },
}

#[derive(clap::Subcommand)]
pub enum AuthRehearseCommand {
    /// Mint from one closed JSON request and custody the returned carrier in
    /// the mechanical owner-only `<ready-file>.rehearsal` sibling.
    Mint {
        #[command(flatten)]
        target: TargetArgs,
        #[arg(long)]
        input: PathBuf,
    },
    /// Print the versioned grant id, expiry, terminal state, and remaining
    /// fixed-total budgets as JSON.
    Status {
        #[command(flatten)]
        target: TargetArgs,
        #[arg(long)]
        grant_id: Option<String>,
        #[arg(long)]
        json: bool,
    },
    /// Permanently revoke one grant. Repeating the same revoke is terminal and
    /// cannot renew or replace its carrier.
    Revoke {
        #[command(flatten)]
        target: TargetArgs,
        #[arg(long)]
        grant_id: String,
    },
    /// Exercise one closed effect request. A ready-file target reads only the
    /// mechanical sidecar; URL attachment requires the bounded stdin carrier.
    Exercise {
        #[command(flatten)]
        target: TargetArgs,
        #[arg(long)]
        input: PathBuf,
        #[arg(long, requires = "url", conflicts_with = "ready_file")]
        rehearsal_capability_stdin: bool,
    },
}

#[derive(clap::Subcommand)]
pub enum ReplicateCommand {
    /// Inspect the fixed authoritative head, restorable frontier, lag, and
    /// encryption posture. Disabled configuration is reported as JSON.
    Status {
        #[arg(long, default_value = ".snapback/dev.sqlite3")]
        db: PathBuf,
    },
    /// Force WAL capture, durable keyring coverage, remote verification, and
    /// a final checkpoint. This is a self-hosted G2 proof envelope only;
    /// hosted restore/DR scope is not claimed.
    Checkpoint {
        #[arg(long, default_value = ".snapback/dev.sqlite3")]
        db: PathBuf,
    },
    /// Restore a database and its exact governing auth-keyring snapshot into
    /// a new directory. The output remains non-servable until it completes the
    /// declared auth-restore composition.
    Restore {
        #[arg(long)]
        output: PathBuf,
        /// Optional replicated LTX transaction id, bounded by the advertised
        /// database/keyring restorable frontier.
        #[arg(long)]
        position: Option<u64>,
    },
}

#[derive(clap::Subcommand)]
pub enum StoreCommand {
    /// Describe every database-derived durable-state member without locking it.
    Describe {
        #[arg(long)]
        db: PathBuf,
    },
    /// Publish a WAL-consistent, directly bootable store directory.
    Export {
        #[arg(long)]
        db: PathBuf,
        #[arg(long)]
        output: PathBuf,
    },
}

#[derive(clap::Subcommand)]
pub enum AuthorityCommand {
    /// Compare an app-managed mirror with a candidate generated projection
    /// and report the activation/backfill horizon. Read-only.
    Plan {
        #[arg(long)]
        db: PathBuf,
        #[arg(long)]
        schema: PathBuf,
        #[arg(long)]
        profile: String,
        #[arg(long)]
        mirror_table: String,
        #[arg(long)]
        json: bool,
    },
    /// Apply the plan's reviewed authorization-facts-only ledger step.
    Backfill {
        #[arg(long)]
        db: PathBuf,
        #[arg(long)]
        profile: String,
        #[arg(long)]
        apply: bool,
        #[arg(long)]
        confirm: Option<String>,
    },
}

#[derive(clap::Subcommand)]
#[command(
    after_help = "Lifecycle examples:\n  snapback fork create --from parent.ready.json --ttl 2h --app-root .\n  snapback fork inspect <fork-id> --app-root .\n  snapback fork diff <fork-id> --app-root .\n  snapback fork drop <fork-id> --app-root .\n  snapback fork reap --now-ms <unix-ms> --app-root .\n  snapback fork recover <destination> --app-root ."
)]
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
        /// Refuse a journal or net-diff work span larger than this many rows.
        #[arg(long, default_value_t = crate::instance_fork::FORK_DIFF_MAX_ROWS)]
        max_rows: u64,
        /// Produce the exact net base-to-head receipt (snapback.fork-net-diff.v3)
        /// instead of the journal sequence; requires --retain-base at create.
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

#[path = "cli/guide_command.rs"]
mod guide_command;
#[cfg(test)]
pub(crate) use guide_command::{
    DEFAULT_SERVED_GUIDE_URL, GUIDE_SEARCH_SCHEMA_VERSION, GuideSectionMatch, render_guide_command,
    search_guide_sections_in,
};
pub(crate) use guide_command::{guide_command, parse_guide_slice};

// @ref LLP 0024#dated-amendment-native-machine-mode-2026-08-08 — the packaged
// root help consumes a structured projection of Clap's authoritative tree.
fn native_command_inventory_entry(command: &clap::Command, parent: &[String]) -> Value {
    let mut path = parent.to_vec();
    path.push(command.get_name().to_owned());
    let arguments = command
        .get_arguments()
        .map(|argument| {
            json!({
                "id": argument.get_id().as_str(),
                "long": argument.get_long(),
                "short": argument.get_short().map(|value| value.to_string()),
                "required": argument.is_required_set(),
                "help": argument.get_help().map(ToString::to_string),
            })
        })
        .collect::<Vec<_>>();
    let subcommands = command
        .get_subcommands()
        .filter(|subcommand| subcommand.get_name() != "command-inventory")
        .map(|subcommand| native_command_inventory_entry(subcommand, &path))
        .collect::<Vec<_>>();
    json!({
        "name": command.get_name(),
        "path": path,
        "about": command.get_about().map(ToString::to_string),
        "arguments": arguments,
        "subcommands": subcommands,
    })
}

fn native_command_inventory() -> anyhow::Result<()> {
    let command = Cli::command();
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "schemaVersion": "snapback.native-command-inventory.v1",
            "ok": true,
            "root": native_command_inventory_entry(&command, &[]),
        }))?
    );
    Ok(())
}

// LLP 0024's native projection adopts the already-frozen app-data CLI exit
// taxonomy. Additions may classify new diagnostics, but these numeric
// meanings must never move.
// @ref LLP 0024#dated-amendment-native-machine-mode-2026-08-08 — one exit grammar spans
// native and app-data command projections.
pub const EXIT_OK: i32 = 0;
pub const EXIT_USAGE: i32 = 2;
pub const EXIT_AUTH_REFUSED: i32 = 3;
pub const EXIT_FUNCTION_NOT_FOUND: i32 = 4;
pub const EXIT_FUNCTION_ERROR: i32 = 5;
pub const EXIT_TRANSPORT_FAILED: i32 = 6;
pub const EXIT_ARTIFACT_IDENTITY_MISMATCH: i32 = 7;
pub const EXIT_VERSION_MISMATCH: i32 = 8;
pub const EXIT_TIMEOUT: i32 = 9;
pub const EXIT_SCRIPT_ERROR: i32 = 10;
pub const EXIT_RESOURCE_EXCEEDED: i32 = 11;

#[derive(Debug)]
struct NativeCliFailure {
    diagnostic: crate::diagnostic::Diagnostic,
    exit_code: i32,
}

impl std::fmt::Display for NativeCliFailure {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "{}: {}",
            self.diagnostic.code, self.diagnostic.message
        )
    }
}

impl std::error::Error for NativeCliFailure {}

fn invocation_command() -> String {
    let mut args = std::env::args().skip(1);
    match args.find(|argument| !argument.starts_with('-')) {
        Some(command) => format!("snapback {command}"),
        None => "snapback".to_owned(),
    }
}

fn native_cli_failure(code: &str, message: impl Into<String>, exit_code: i32) -> anyhow::Error {
    let command = invocation_command();
    anyhow::Error::new(NativeCliFailure {
        diagnostic: crate::diagnostic::Diagnostic::error(code, "cli", message)
            .with_details(json!({ "command": command })),
        exit_code,
    })
}

fn diagnostic_code_from_message(message: &str) -> Option<&str> {
    let code = message.split(':').next()?;
    (code.starts_with("SNAPBACK_")
        && code
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_'))
    .then_some(code)
}

fn classify_native_exit(code: &str) -> i32 {
    if code == "SNAPBACK_CLI_ARGUMENT_INVALID" || code.ends_with("_USAGE") {
        EXIT_USAGE
    } else if code.contains("AUTH_REFUSED") || code.starts_with("SNAPBACK_AUTH_") {
        EXIT_AUTH_REFUSED
    } else if code.contains("FUNCTION_NOT_FOUND") || code.contains("FUNCTION_UNKNOWN") {
        EXIT_FUNCTION_NOT_FOUND
    } else if code.contains("TRANSPORT")
        || code.contains("UNREACHABLE")
        || code.contains("HTTP_FAILED")
    {
        EXIT_TRANSPORT_FAILED
    } else if code.contains("ARTIFACT_IDENTITY") || code.contains("IDENTITY_MISMATCH") {
        EXIT_ARTIFACT_IDENTITY_MISMATCH
    } else if code.contains("VERSION_MISMATCH") || code.contains("VERSION_UNSUPPORTED") {
        EXIT_VERSION_MISMATCH
    } else if code.contains("TIMEOUT") {
        EXIT_TIMEOUT
    } else if code.contains("SCRIPT") {
        EXIT_SCRIPT_ERROR
    } else if code.contains("RESOURCE_EXCEEDED") || code.contains("OUTPUT_LIMIT") {
        EXIT_RESOURCE_EXCEEDED
    } else {
        EXIT_FUNCTION_ERROR
    }
}

fn envelope_exit_code(envelope: &Value) -> i32 {
    envelope
        .pointer("/diagnostics/0/code")
        .and_then(Value::as_str)
        .map_or(EXIT_FUNCTION_ERROR, classify_native_exit)
}

pub fn json_mode_requested() -> bool {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    args.iter().enumerate().any(|(index, argument)| {
        argument == "--json"
            || argument == "--format=json"
            || (argument == "--format" && args.get(index + 1).is_some_and(|value| value == "json"))
    })
}

// @ref LLP 0024#dated-amendment-native-machine-mode-2026-08-08 — requested
// machine mode has one failure envelope and the frozen exit projection.
pub fn project_cli_failure(error: &anyhow::Error) -> (i32, Value) {
    let (exit_code, diagnostic) = if let Some(failure) = error.downcast_ref::<NativeCliFailure>() {
        (failure.exit_code, failure.diagnostic.clone())
    } else if let Some(failure) = error.downcast_ref::<crate::diagnostic::SnapbackError>() {
        (
            classify_native_exit(&failure.diagnostic.code),
            failure.diagnostic.clone(),
        )
    } else {
        let message = format!("{error:#}");
        let code = diagnostic_code_from_message(&message)
            .unwrap_or("SNAPBACK_CLI_FAILED")
            .to_owned();
        let command = invocation_command();
        (
            classify_native_exit(&code),
            crate::diagnostic::Diagnostic::error(code, "cli", message)
                .with_details(json!({ "command": command })),
        )
    };
    let operation = invocation_command()
        .trim_start_matches("snapback ")
        .to_owned();
    let envelope = json!({
        "schemaVersion": SNAPBACK_SCHEMA_VERSION,
        "resultKind": HOST_OPS_RESULT_KIND,
        "requestId": crate::ids::mint_time_ordered(crate::ids::Kind::HostOperation),
        "operation": operation,
        "ok": false,
        "target": {
            "appId": "unknown",
            "appRoot": Value::Null,
            "targetProfile": "local-dev-sqlite-ibex",
            "serverUrl": Value::Null,
        },
        "authority": Value::Null,
        "artifacts": HostOpsArtifacts::default(),
        "data": {},
        "diagnostics": [diagnostic],
        "next": [],
    });
    (exit_code, envelope)
}

pub async fn run_from_env() -> anyhow::Result<()> {
    let cli = match Cli::try_parse_from(argv_with_password_environment_carrier()) {
        Ok(cli) => cli,
        Err(error)
            if argv_targets_config_set()
                && !matches!(
                    error.kind(),
                    clap::error::ErrorKind::DisplayHelp | clap::error::ErrorKind::DisplayVersion
                ) =>
        {
            // Config values are deliberately absent from argv, but a caller
            // can still make a spelling mistake that causes clap to quote an
            // unexpected token. Collapse every config-set parse refusal to a
            // stable, value-free diagnostic instead of rendering argv.
            return Err(native_cli_failure(
                "SNAPBACK_CONFIG_SET_USAGE_INVALID",
                "invalid config set arguments; run `snapback config set --help` for the value-free usage",
                EXIT_USAGE,
            ));
        }
        Err(error)
            if matches!(
                error.kind(),
                clap::error::ErrorKind::DisplayHelp | clap::error::ErrorKind::DisplayVersion
            ) =>
        {
            error.print()?;
            return Ok(());
        }
        Err(error) => {
            return Err(native_cli_failure(
                "SNAPBACK_CLI_ARGUMENT_INVALID",
                error.to_string(),
                EXIT_USAGE,
            ));
        }
    };
    reject_misdirected_serve_flags(&cli)?;
    match cli.command {
        None => {
            Cli::command().print_long_help()?;
            println!();
            Ok(())
        }
        Some(HostCommand::Start(args)) => run(args).await,
        Some(HostCommand::Stop { ready_file }) => host_stop(&ready_file),
        Some(HostCommand::Restart { ready_file, reason }) => {
            host_restart(&ready_file, &reason).await
        }
        Some(HostCommand::Wait {
            ready_file,
            level,
            application_ready_file,
            timeout_ms,
            token,
        }) => {
            host_wait(
                &ready_file,
                level,
                application_ready_file.as_deref(),
                timeout_ms,
                token,
            )
            .await
        }
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
                std::process::exit(EXIT_FUNCTION_ERROR);
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
            let anonymous = user.is_none();
            let request = function_run_request(&function, &parsed_args, user.as_deref());
            run_function_via_http(&target, &function, parsed_args, request, anonymous)
        }
        Some(HostCommand::Remediation { command }) => match command {
            RemediationCommand::Apply { target, input } => {
                if input.as_os_str() == "-" && target.impersonation_capability_stdin {
                    anyhow::bail!(
                        "--input - and --impersonation-capability-stdin cannot share stdin"
                    );
                }
                let input = read_data_patch_input(&input)?;
                host_op_via_http(
                    &target,
                    json!({ "operation": "remediation.apply", "input": input }),
                )
            }
        },
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
                None,
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
        Some(HostCommand::Ephemeral { command }) => ephemeral_command(command),
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
        Some(HostCommand::Debug { command }) => match command {
            DebugCommand::ForceResync {
                target,
                connection_id,
                subscription_id,
                reason,
                clear_retained,
                startup_nonce,
            } => {
                let startup_nonce = resolve_startup_nonce(&target, startup_nonce)?;
                host_op_via_http(
                    &target,
                    json!({
                        "operation": "debug.live.forceResync",
                        "input": {
                            "connectionId": connection_id,
                            "subscriptionId": subscription_id,
                            "reason": reason,
                            "clearRetained": clear_retained,
                            "startupNonce": startup_nonce,
                        },
                    }),
                )
            }
        },
        Some(HostCommand::Data { command }) => data_command(command),
        Some(HostCommand::Auth { command }) => match command {
            AuthCommand::Export { db, output } => {
                // @ref LLP 0032#phase-3--lifecycle-and-resource-hardening —
                // logical transfer opens and reads SQLite beneath the async
                // CLI entrypoint, so it uses the sanctioned blocking lane.
                startup_blocking(|| auth_logical_export(&db, &output))
            }
            AuthCommand::Import { from, db } => {
                startup_blocking(|| auth_logical_import(&from, &db))
            }
            AuthCommand::Backup { db, output } => auth_backup(&db, &output).await,
            AuthCommand::Restore { from, db } => startup_blocking(|| auth_restore(&from, &db)),
            AuthCommand::Rehearse { command } => auth_rehearse_command(command),
            AuthCommand::Password { command } => auth_password_command(command),
            AuthCommand::Recovery { command } => auth_recovery_command(command),
        },
        Some(HostCommand::Replicate { command }) => replication_command(command).await,
        Some(HostCommand::Store { command }) => match command {
            StoreCommand::Describe { db } => store_describe(&db),
            StoreCommand::Export { db, output } => store_export(&db, &output).await,
        },
        Some(HostCommand::Authority { command }) => authority_command(command),
        Some(HostCommand::Fork { command }) => fork_command(command).await,
        Some(HostCommand::Controls { command }) => controls_command(command),
        Some(HostCommand::Guide { query, slice, json }) => guide_command(&query, slice, json),
        Some(HostCommand::CommandInventory) => native_command_inventory(),
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
        Some(HostCommand::PackagedStoreQualificationReceipt {
            closure_manifest,
            suite_result,
            out,
        }) => packaged_store_qualification_receipt_command(&closure_manifest, &suite_result, &out),
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
                std::process::exit(EXIT_FUNCTION_ERROR);
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

fn argv_targets_config_set() -> bool {
    let mut args = std::env::args_os().skip(1);
    args.next().is_some_and(|arg| arg == "config") && args.next().is_some_and(|arg| arg == "set")
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

// @ref LLP 0055#catalog-and-lifecycle — this offline command emits only the
// stable identity/recovery facts and scope bases the logical contract includes;
// the closed artifact has no authority-carrier fields.
fn auth_logical_export(database_path: &Path, output_file: &Path) -> anyhow::Result<()> {
    let database_path = resolve_database_path(database_path)?;
    anyhow::ensure!(
        database_path.is_file(),
        "SNAPBACK_AUTH_LOGICAL_EXPORT_INVALID: source database does not exist"
    );
    let _instance_lock = DatabaseInstanceLock::acquire(&database_path)?;
    let database = crate::storage::LocalDatabase::open(&database_path)?;
    let artifact = database.auth_logical_export()?;
    crate::auth::logical_transfer::write_artifact(output_file, &artifact)?;
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "schemaVersion": "snapback.auth-logical-export-result.v1",
            "ok": true,
            "operation": "auth.export",
            "output": output_file,
            "formatVersion": artifact.format_version,
            "authCatalogVersion": artifact.auth_catalog_version,
            "usersExported": artifact.users.len(),
            "identitiesExported": artifact.identities.len(),
            "scopeBasesExported": artifact.scope_bases.len(),
            "carriesSpendableAuthority": false,
        }))?
    );
    Ok(())
}

// @ref LLP 0057#catalog-write-and-lifecycle-rules — import admits only an
// empty current catalog and rotates the durable authorization incarnation in
// the same transaction as the imported identity facts.
fn auth_logical_import(input_file: &Path, database_path: &Path) -> anyhow::Result<()> {
    // Parse and validate before opening the destination, so corrupt or older
    // artifacts cannot cause even additive SQLite-open work.
    let artifact = crate::auth::logical_transfer::read_artifact(input_file)?;
    let database_path = resolve_database_path(database_path)?;
    anyhow::ensure!(
        database_path.is_file(),
        "SNAPBACK_AUTH_LOGICAL_IMPORT_INVALID: destination database does not exist"
    );
    let _instance_lock = DatabaseInstanceLock::acquire(&database_path)?;
    let mut database = crate::storage::LocalDatabase::open(&database_path)?;
    let outcome = database.auth_logical_import(&artifact)?;
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "schemaVersion": outcome.schema_version,
            "ok": true,
            "operation": "auth.import",
            "input": input_file,
            "database": database_path,
            "usersImported": outcome.users_imported,
            "identitiesImported": outcome.identities_imported,
            "scopeBasesImported": outcome.scope_bases_imported,
            "ownedAgents": outcome.owned_agents,
            "unownedAgents": outcome.unowned_agents,
            "deactivatedAgents": outcome.deactivated_agents,
            "authorizationIncarnation": outcome.authorization_incarnation,
            "mintedSessions": 0,
            "mintedCredentials": 0,
            "mintedGrants": 0,
            "unownedAgentProductionPosture": "dormant",
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
                    "schemaVersion": "snapback.auth-backup-result.v1",
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
                    "schemaVersion": "snapback.auth-backup-result.v1",
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
                crate::contract_types::AuthProviderProfile::Test,
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
        snapback
            .execute_auth_plan(crate::auth::backup::create_backup_plan(
                maintenance.keyring(),
                output_directory,
                created_at_ms,
                &crate::auth::crypto::OsRandom,
            ))
            .map_err(anyhow::Error::new)
    })
}

// @ref LLP 0188#7-honesty-and-qualification — the offline CLI reports the two-member
// restore frontier and never presents a celld database image alone as a
// servable Snapback instance.
async fn replication_command(command: ReplicateCommand) -> anyhow::Result<()> {
    let config = crate::replication::ReplicationConfig::from_env()?;
    match command {
        ReplicateCommand::Status { db } => {
            if config.is_none() {
                println!(
                    "{}",
                    serde_json::to_string_pretty(
                        &crate::replication::ReplicationStatus::disabled()
                    )?
                );
                return Ok(());
            }
            let database = resolve_database_path(&db)?;
            let status = crate::replication::inspect_status(&database, config).await?;
            println!("{}", serde_json::to_string_pretty(&status)?);
            Ok(())
        }
        ReplicateCommand::Checkpoint { db } => {
            let config = config.context(
                "SNAPBACK_REPLICATION_DISABLED: checkpoint requires SNAPBACK_REPLICATION_TARGET and SNAPBACK_REPLICATION_KEY_FILE",
            )?;
            let database = resolve_database_path(&db)?;
            anyhow::ensure!(
                database.is_file(),
                "SNAPBACK_REPLICATION_DATABASE_UNAVAILABLE: source database does not exist"
            );
            let _instance_lock = DatabaseInstanceLock::acquire(&database)?;
            let status = crate::replication::checkpoint_once(database, config).await?;
            println!("{}", serde_json::to_string_pretty(&status)?);
            Ok(())
        }
        ReplicateCommand::Restore { output, position } => {
            let config = config.context(
                "SNAPBACK_REPLICATION_DISABLED: restore requires SNAPBACK_REPLICATION_TARGET and SNAPBACK_REPLICATION_KEY_FILE",
            )?;
            let output = if output.is_absolute() {
                output
            } else {
                std::env::current_dir()?.join(output)
            };
            let (restored_position, source_version, restore_declaration_id) =
                crate::replication::restore_to_directory(&output, position, config).await?;
            println!(
                "{}",
                serde_json::to_string_pretty(&json!({
                    "schemaVersion": "snapback.replication-restore-result.v1",
                    "ok": true,
                    "output": output,
                    "database": output.join("database.sqlite3"),
                    "keyring": crate::auth::keyring::AuthKeyringStore::keyring_path(
                        &output.join("database.sqlite3")
                    ),
                    "position": restored_position,
                    "sourceVersion": source_version,
                    "restoreDeclarationId": restore_declaration_id.clone(),
                    "servable": false,
                    "next": format!("Treat this as an offline restore image. To run LLP 0057 bulk revocation before binding, start with --db {} --restored-from-backup {}; replication restore alone never admits serving.", output.join("database.sqlite3").display(), restore_declaration_id),
                }))?
            );
            Ok(())
        }
    }
}

fn store_describe(database_path: &Path) -> anyhow::Result<()> {
    let database_path = resolve_database_path(database_path)?;
    let members = crate::store_state::durable_state_members(&database_path)?;
    let members = members
        .into_iter()
        .map(|member| {
            json!({
                "id": member.id,
                "path": member.path,
                "disposition": member.disposition,
                "kind": member.kind,
                "present": std::fs::symlink_metadata(&member.path).is_ok(),
                "description": member.description,
            })
        })
        .collect::<Vec<_>>();
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "schemaVersion": "snapback.store-describe-result.v1",
            "ok": true,
            "operation": "store.describe",
            "database": database_path,
            "members": members,
        }))?
    );
    Ok(())
}

fn authority_command(command: AuthorityCommand) -> anyhow::Result<()> {
    match command {
        AuthorityCommand::Plan {
            db,
            schema,
            profile,
            mirror_table,
            json,
        } => {
            let database_path = resolve_database_path(&db)?;
            let bytes = std::fs::read(&schema)
                .with_context(|| format!("read candidate schema manifest {}", schema.display()))?;
            let manifest: crate::manifest::SchemaManifest = serde_json::from_slice(&bytes)
                .with_context(|| format!("parse candidate schema manifest {}", schema.display()))?;
            let plan =
                crate::storage::LocalDatabase::authority_projection_migration_plan_read_only(
                    &database_path,
                    &manifest,
                    &profile,
                    &mirror_table,
                )?;
            if json {
                println!("{}", serde_json::to_string_pretty(&plan)?);
            } else {
                println!(
                    "{}: {}",
                    plan.schema_version,
                    if plan.comparison.adoptable {
                        "mirror matches candidate projection"
                    } else {
                        "mirror differs from candidate projection"
                    }
                );
                println!(
                    "Rows: authority={} mirror={} matched={} missing={} extra={} mismatched={}",
                    plan.comparison.authority_rows,
                    plan.comparison.mirror_rows,
                    plan.comparison.matched,
                    plan.comparison.missing_from_mirror,
                    plan.comparison.extra_in_mirror,
                    plan.comparison.value_mismatches,
                );
                println!(
                    "History horizon: commit {} ({}) [{}]",
                    plan.activation_horizon.earliest_covered_commit,
                    plan.activation_horizon.coverage_class,
                    plan.activation_state,
                );
                if plan.ledger_backfill.available {
                    println!(
                        "Optional reviewed ledger backfill: {} transitions from commit {} ({}, display values {})",
                        plan.ledger_backfill.transition_count,
                        plan.ledger_backfill.earliest_covered_commit.unwrap_or(0),
                        plan.ledger_backfill.coverage_class,
                        plan.ledger_backfill.display_values,
                    );
                } else {
                    println!("Optional reviewed ledger backfill: not offered");
                }
            }
            Ok(())
        }
        AuthorityCommand::Backfill {
            db,
            profile,
            apply,
            confirm,
        } => {
            if !apply || confirm.as_deref() != Some("authorization-facts-only") {
                anyhow::bail!(
                    "authority backfill requires --apply --confirm authorization-facts-only"
                );
            }
            let database_path = resolve_database_path(&db)?;
            let mut database = crate::storage::LocalDatabase::open(&database_path)?;
            let receipt = database.backfill_authority_projection_from_ledger(&profile)?;
            println!("{}", serde_json::to_string_pretty(&receipt)?);
            Ok(())
        }
    }
}

// @ref LLP 0192#d-2-the-store-export-verb — store export takes the same
// instance and auth-maintenance exclusion boundary as physical auth backup.
async fn store_export(database_path: &Path, output_directory: &Path) -> anyhow::Result<()> {
    let result = store_export_inner(database_path, output_directory).await;
    match result {
        Ok(outcome) => {
            println!(
                "{}",
                serde_json::to_string_pretty(&json!({
                    "schemaVersion": "snapback.store-export-result.v1",
                    "ok": true,
                    "operation": "store.export",
                    "output": output_directory,
                    "publicationState": outcome.publication_state,
                    "manifest": outcome.manifest,
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
                        "SNAPBACK_STORE_EXPORT_INVALID",
                        "store-export",
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
                    "schemaVersion": "snapback.store-export-result.v1",
                    "ok": false,
                    "operation": "store.export",
                    "output": output_directory,
                    "publicationState": publication_state,
                    "diagnostics": [diagnostic],
                }))?
            );
            Err(error)
        }
    }
}

async fn store_export_inner(
    database_path: &Path,
    output_directory: &Path,
) -> anyhow::Result<crate::store_state::StoreExportOutcome> {
    let (database_path, _instance_lock, provider) = startup_blocking(|| {
        let database_path = resolve_database_path(database_path)?;
        anyhow::ensure!(
            database_path.is_file(),
            "SNAPBACK_STORE_EXPORT_INVALID: source database does not exist"
        );
        let instance_lock = DatabaseInstanceLock::acquire(&database_path)?;
        let keyring = Arc::new(crate::auth::keyring::AuthKeyringStore::file_for_database(
            &database_path,
        ));
        let provider = Arc::new(
            crate::auth::provider::AuthProvider::new(
                crate::contract_types::AuthProviderProfile::Test,
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
    // @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — the online
    // image and recursive member copy are blocking pre-bind work beneath the
    // Tokio CLI entrypoint.
    startup_blocking(|| {
        let mut snapback = LocalSnapback::open(&database_path)?;
        crate::store_state::export_store(
            &mut snapback,
            maintenance.keyring(),
            &database_path,
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
            "schemaVersion": "snapback.auth-restore-result.v1",
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

#[path = "cli/fork.rs"]
mod fork;
#[cfg(unix)]
pub(crate) use fork::configure_detached_child;
use fork::now_ms;
#[cfg(test)]
pub(crate) use fork::{
    automatic_reap_before_create, fork_secret_disposition, parse_fork_ttl, quiet_stop_fork,
};
pub(crate) use fork::{fork_command, process_is_proven_gone, wait_for_derived_fork_expiry};

fn reject_misdirected_serve_flags(cli: &Cli) -> anyhow::Result<()> {
    if cli.serve != Args::default() {
        anyhow::bail!(
            "SNAPBACK_CLI_ARGUMENT_INVALID: server flags require the explicit `start` command (for example: `snapback start --memory`)"
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

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct FunctionRunCliRequest<'a> {
    operation: &'static str,
    function: &'a str,
    args: &'a Value,
    // @ref LLP 0058#session-mode-body-closure — absence means anonymous;
    // even an explicit null is forbidden legacy body authority in sessions mode.
    #[serde(skip_serializing_if = "Option::is_none")]
    user_id: Option<&'a str>,
}

fn function_run_request(function: &str, args: &Value, user_id: Option<&str>) -> Value {
    serde_json::to_value(FunctionRunCliRequest {
        operation: "function.run",
        function,
        args,
        user_id,
    })
    .expect("function.run request is JSON-serializable")
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

fn utc_date_from_unix_seconds(seconds: u64) -> String {
    let days = (seconds / 86_400) as i64 + 719_468;
    let era = if days >= 0 { days } else { days - 146_096 } / 146_097;
    let day_of_era = days - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}")
}

fn packaged_store_qualification_receipt_command(
    closure_manifest: &Path,
    suite_result: &Path,
    out: &Path,
) -> anyhow::Result<()> {
    const IDENTITY_CODE: &str = "SNAPBACK_PACKAGED_STORE_QUALIFICATION_IDENTITY_UNQUALIFIED";
    const SUITE_CODE: &str = "SNAPBACK_PACKAGED_STORE_QUALIFICATION_SUITE_UNQUALIFIED";
    const CLOSURE_CODE: &str = "SNAPBACK_PACKAGED_STORE_QUALIFICATION_CLOSURE_INVALID";

    let identity = crate::identity::binary_identity();
    let build_distribution = crate::identity::build_distribution();
    if !crate::manifest::packaged_store_runtime_identity_is_qualified(&identity, build_distribution)
    {
        anyhow::bail!(
            "{IDENTITY_CODE}: receipt minting requires a known clean release public-package identity"
        );
    }

    let suite = serde_json::from_value::<crate::manifest::PackagedStoreQualificationSuiteV1>(
        read_json_file(suite_result).map_err(|error| anyhow::anyhow!("{SUITE_CODE}: {error:#}"))?,
    )
    .map_err(|error| anyhow::anyhow!("{SUITE_CODE}: invalid suite result: {error}"))?;
    if !crate::manifest::packaged_store_qualification_suite_is_qualified(&suite) {
        anyhow::bail!(
            "{SUITE_CODE}: suite must pass at least one check with zero failures and zero skips"
        );
    }
    let package_closure =
        serde_json::from_value::<Vec<crate::manifest::PackagedStoreClosureEntryV1>>(
            read_json_file(closure_manifest)
                .map_err(|error| anyhow::anyhow!("{CLOSURE_CODE}: {error:#}"))?,
        )
        .map_err(|error| anyhow::anyhow!("{CLOSURE_CODE}: invalid closure manifest: {error}"))?;
    if crate::manifest::packaged_store_closure_sha256(&package_closure).is_none() {
        anyhow::bail!(
            "{CLOSURE_CODE}: closure entries must be unique named versions with non-zero sha256 digests"
        );
    }
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .context("system clock precedes the Unix epoch")?
        .as_secs();
    let receipt = crate::manifest::stamp_packaged_store_qualification_receipt(
        &utc_date_from_unix_seconds(seconds),
        &identity,
        build_distribution,
        package_closure,
        suite,
    )
    .ok_or_else(|| anyhow::anyhow!("{CLOSURE_CODE}: receipt inputs failed validation"))?;
    let mut bytes = serde_json::to_vec_pretty(&receipt).context("failed to serialize receipt")?;
    bytes.push(b'\n');
    std::fs::write(out, bytes)
        .with_context(|| format!("failed to write qualification receipt {}", out.display()))?;
    Ok(())
}

fn read_data_patch_input(path: &Path) -> anyhow::Result<Value> {
    use std::io::Read as _;

    const MAX_BYTES: usize = 1024 * 1024;
    let mut bytes = Vec::new();
    if path.as_os_str() == "-" {
        std::io::stdin()
            .take((MAX_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .context("failed to read data patch JSON from stdin")?;
    } else {
        bytes =
            std::fs::read(path).with_context(|| format!("failed to read {}", path.display()))?;
    }
    anyhow::ensure!(
        bytes.len() <= MAX_BYTES,
        "data patch JSON exceeds the 1 MiB input bound"
    );
    let value: Value = serde_json::from_slice(&bytes).with_context(|| {
        if path.as_os_str() == "-" {
            "data patch stdin is not valid JSON".to_owned()
        } else {
            format!("{} is not valid JSON", path.display())
        }
    })?;
    anyhow::ensure!(value.is_object(), "data patch input must be a JSON object");
    Ok(value)
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
    let minted_generation = crate::manifest::ArtifactGeneration {
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
    let authored_source_hash = schema
        .authored_source_hash
        .clone()
        .filter(|value| functions.authored_source_hash.as_ref() == Some(value))
        .context("generated pair has no coherent authoredSourceHash")?;
    let mut database = crate::storage::LocalDatabase::open(database_path)?;
    let database_id = database.data_version_stream()?;
    let keyring = crate::completeness::ProofKeyring::load_or_create(
        database_path.with_file_name(crate::completeness::PROOF_KEYRING_FILE_NAME),
        crate::server::now_millis(),
    )?;
    // @ref LLP 0157#amendment--2026-08-10-toolchain-stable-activation-identity-ruled
    // — every new keyring-backed preparation mints v2; committed v1 sources
    // remain readable until their next ceremony.
    let artifact = crate::completeness::TrustedCompositionActivationV1::prepare_v2(
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
        authored_source_hash,
        minted_generation,
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
    read_trusted_json_file_with_bytes(path).map(|(value, _)| value)
}

fn read_trusted_json_file_with_bytes(path: &Path) -> anyhow::Result<(Value, Vec<u8>)> {
    let raw = crate::secure_file::read_owner_only(path)
        .with_context(|| format!("failed to read trusted local file {}", path.display()))?;
    let value = serde_json::from_slice(&raw)
        .with_context(|| format!("{} is not valid JSON", path.display()))?;
    Ok((value, raw))
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

fn emit_agent_destroy_capability_to_writer(
    operator: crate::admin_agent_destroy::AgentDestroyCapabilityOperator,
    writer: &mut impl std::io::Write,
) -> std::io::Result<()> {
    operator.emit_once_to_terminal(|bearer| {
        writer.write_all(b"agent destroy capability: ")?;
        writer.write_all(bearer.as_bytes())?;
        writer.write_all(b"\n")?;
        writer.flush()
    })
}

fn emit_dev_identity_capability_to_writer(
    operator: crate::dev_identity::DevIdentityOperator,
    writer: &mut impl std::io::Write,
) -> std::io::Result<()> {
    operator.emit_once_to_terminal(|bearer| {
        writer.write_all(b"developer identity capability: ")?;
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

#[cfg(unix)]
fn emit_agent_destroy_capability_to_controlling_terminal(
    operator: crate::admin_agent_destroy::AgentDestroyCapabilityOperator,
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
    emit_agent_destroy_capability_to_writer(operator, &mut terminal)
}

#[cfg(unix)]
fn emit_dev_identity_capability_to_controlling_terminal(
    operator: crate::dev_identity::DevIdentityOperator,
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
    emit_dev_identity_capability_to_writer(operator, &mut terminal)
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

#[cfg(not(unix))]
fn emit_agent_destroy_capability_to_controlling_terminal(
    _operator: crate::admin_agent_destroy::AgentDestroyCapabilityOperator,
) -> std::io::Result<()> {
    Err(std::io::Error::new(
        ErrorKind::Unsupported,
        "direct controlling-terminal capability emission is unavailable on this host",
    ))
}

#[cfg(not(unix))]
fn emit_dev_identity_capability_to_controlling_terminal(
    _operator: crate::dev_identity::DevIdentityOperator,
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
    agent_destroy_capability: Option<crate::auth::crypto::ImpersonationBearer>,
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
            .field(
                "agent_destroy_capability",
                &self.agent_destroy_capability.as_ref().map(|_| "[REDACTED]"),
            )
            .finish()
    }
}

#[cfg(test)]
fn resolve_http_target(target: &TargetArgs) -> anyhow::Result<ResolvedHttpTarget> {
    resolve_http_target_for_operation(target, false, false)
}

fn resolve_http_target_for_operation(
    target: &TargetArgs,
    requires_impersonation: bool,
    requires_agent_destroy: bool,
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
            agent_destroy_capability: None,
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
        let agent_destroy_capability = if requires_agent_destroy {
            let health = fetch_health(&descriptor.server_url);
            verify_live_descriptor_identity(&descriptor, &health, "integration retirement")
                .map_err(|diagnostic| {
                    anyhow::anyhow!("{}: {}", diagnostic.code, diagnostic.message)
                })?;
            let sidecar =
                crate::admin_agent_destroy::agent_destroy_capability_sibling(&canonical_ready)?;
            match ready_target.read_strict_owner_only_sibling(
                &sidecar,
                crate::admin_agent_destroy::MAX_AGENT_DESTROY_CAPABILITY_FILE_BYTES,
            ) {
                Ok(bytes) => Some(
                    crate::admin_agent_destroy::parse_agent_destroy_capability_file(
                        zeroize::Zeroizing::new(bytes),
                    )
                    .map_err(anyhow::Error::new)?,
                ),
                // Non-production servers deliberately do not mint this
                // capability; AdminWrite remains sufficient there. Production
                // publishes the mechanical sidecar and middleware fails closed
                // if it is ever absent.
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
                Err(error) => {
                    return Err(error).with_context(|| {
                        format!(
                            "failed to read owner-only agent destroy capability {}",
                            sidecar.display()
                        )
                    });
                }
            }
        } else {
            None
        };
        // For capability-bearing operations the branch above has verified the
        // live startup nonce before either local sibling is read. Ordinary
        // host operations use the same storage-mode-aware minted-token
        // discovery as the admin console and secret-read mint path.
        let minted_token =
            discover_minted_token_pinned(&ready_target, &canonical_ready, &descriptor);
        return Ok(ResolvedHttpTarget {
            server_url: descriptor.server_url.trim_end_matches('/').to_owned(),
            minted_token,
            impersonation_capability,
            agent_destroy_capability,
        });
    }
    anyhow::bail!("no target: pass --url or --ready-file")
}

struct ResolvedOperatorEphemeralTarget {
    http: ResolvedHttpTarget,
    startup_nonce: String,
}

fn resolve_operator_ephemeral_target(
    target: &TargetArgs,
) -> anyhow::Result<ResolvedOperatorEphemeralTarget> {
    if target.url.is_some() {
        anyhow::bail!(
            "SNAPBACK_EPHEMERAL_OPERATOR_DELETE_READY_FILE_REQUIRED: ephemeral operator-delete requires --ready-file; --url cannot supply the process-bound startup nonce"
        );
    }
    let path = target.ready_file.as_deref().context(
        "SNAPBACK_EPHEMERAL_OPERATOR_DELETE_READY_FILE_REQUIRED: pass --ready-file for ephemeral operator-delete",
    )?;
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
    let health = fetch_health(&descriptor.server_url);
    verify_live_descriptor_identity(&descriptor, &health, "ephemeral.operatorDelete")
        .map_err(|diagnostic| anyhow::anyhow!("{}: {}", diagnostic.code, diagnostic.message))?;
    let startup_nonce = descriptor.startup_nonce.clone().context(
        "SNAPBACK_EPHEMERAL_OPERATOR_DELETE_READY_FILE_REQUIRED: readiness descriptor has no startupNonce",
    )?;
    let minted_token = discover_minted_token_pinned(&ready_target, &canonical_ready, &descriptor);
    Ok(ResolvedOperatorEphemeralTarget {
        http: ResolvedHttpTarget {
            server_url: descriptor.server_url.trim_end_matches('/').to_owned(),
            minted_token,
            impersonation_capability: None,
            agent_destroy_capability: None,
        },
        startup_nonce,
    })
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
        .is_some_and(|user_id| !user_id.is_empty())
        || request
            .get("input")
            .and_then(Value::as_object)
            .and_then(|input| input.get("authority"))
            .and_then(Value::as_object)
            .and_then(|authority| authority.get("mode"))
            .and_then(Value::as_str)
            == Some("devUser");
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

fn request_requires_agent_destroy(request: &Value) -> bool {
    let Some(operation) = request.get("operation").and_then(Value::as_str) else {
        return false;
    };
    crate::server::host_ops_operation_spec(operation, None, false).is_some_and(|spec| {
        [
            crate::server::PolicyAuthMode::Dev,
            crate::server::PolicyAuthMode::Sessions,
        ]
        .into_iter()
        .any(|mode| {
            spec.effective_for(mode).effect_policy
                == crate::server::EffectPolicy::AgentDestroyCapability
        })
    })
}

// @ref LLP 0176#g0--baseline-truth-and-mechanical-repair — this CLI primitive
// is only a closed-argument projection of the existing auth.mintSession host-op.
fn mint_session_request(email: String) -> Value {
    json!({ "operation": "auth.mintSession", "args": { "email": email } })
}

const MAX_AUTH_CLI_SECRET_BYTES: u64 = 8 * 1024;

fn argv_with_password_environment_carrier() -> Vec<OsString> {
    password_environment_carrier_argv(
        std::env::args_os().collect(),
        std::env::var_os("SNAPBACK_PASSWORD").is_some(),
    )
}

fn password_environment_carrier_argv(
    mut arguments: Vec<OsString>,
    password_environment_present: bool,
) -> Vec<OsString> {
    if !password_environment_present
        || arguments.iter().any(|argument| {
            argument.to_str().is_some_and(|argument| {
                matches!(
                    argument,
                    "--password-stdin"
                        | "--password-fd"
                        | "--__snapback-password-environment-carrier"
                ) || argument.starts_with("--password-fd=")
            })
        })
    {
        return arguments;
    }
    let targets_password = arguments.windows(3).any(|window| {
        window[0] == "auth"
            && window[1] == "password"
            && matches!(
                window[2].to_str(),
                Some("signup" | "signin" | "change" | "reset")
            )
    });
    if targets_password {
        // This marker carries no secret. It exists only so clap can retain the
        // config-set required-unless grammar while the separately zeroized
        // dev/test-only environment value remains outside argv.
        arguments.push("--__snapback-password-environment-carrier".into());
    }
    arguments
}

fn read_auth_secret_lines<R: std::io::Read>(
    reader: R,
    expected_lines: usize,
    code: &'static str,
    label: &'static str,
) -> anyhow::Result<Vec<zeroize::Zeroizing<String>>> {
    use zeroize::{Zeroize as _, Zeroizing};

    let mut bytes = Zeroizing::new(Vec::new());
    reader
        .take(MAX_AUTH_CLI_SECRET_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| anyhow::anyhow!("{code}: {label} could not be read"))?;
    if bytes.len() as u64 > MAX_AUTH_CLI_SECRET_BYTES {
        anyhow::bail!("{code}: {label} exceeds the 8192-byte CLI limit");
    }
    let decoded = match String::from_utf8(std::mem::take(&mut *bytes)) {
        Ok(value) => Zeroizing::new(value),
        Err(error) => {
            let mut rejected = error.into_bytes();
            rejected.zeroize();
            anyhow::bail!("{code}: {label} must contain valid UTF-8")
        }
    };
    let without_terminator = decoded
        .strip_suffix("\r\n")
        .or_else(|| decoded.strip_suffix('\n'))
        .unwrap_or(decoded.as_str());
    let raw_lines = without_terminator.split('\n').collect::<Vec<_>>();
    if raw_lines.len() != expected_lines {
        anyhow::bail!("{code}: {label} must contain exactly {expected_lines} line(s)");
    }
    let mut values = Vec::with_capacity(expected_lines);
    for raw in raw_lines {
        let value = raw.strip_suffix('\r').unwrap_or(raw);
        if value.contains('\r') {
            anyhow::bail!("{code}: {label} contains an invalid carriage return");
        }
        values.push(Zeroizing::new(value.to_owned()));
    }
    Ok(values)
}

#[cfg(unix)]
fn read_auth_secret_fd(
    descriptor: u32,
    expected_lines: usize,
    code: &'static str,
    label: &'static str,
) -> anyhow::Result<Vec<zeroize::Zeroizing<String>>> {
    use std::os::fd::FromRawFd as _;

    let descriptor = i32::try_from(descriptor).map_err(|_| {
        anyhow::anyhow!("{code}: {label} descriptor is outside the supported range")
    })?;
    // SAFETY: dup reads the inherited descriptor without taking ownership of
    // it. The returned descriptor is a new owned handle converted exactly
    // once into File below.
    let duplicate = unsafe { libc::dup(descriptor) };
    if duplicate < 0 {
        return Err(anyhow::anyhow!(
            "{code}: {label} descriptor is not readable"
        ));
    }
    // SAFETY: duplicate is the fresh owned descriptor returned by dup.
    let file = unsafe { std::fs::File::from_raw_fd(duplicate) };
    read_auth_secret_lines(file, expected_lines, code, label)
}

#[cfg(not(unix))]
fn read_auth_secret_fd(
    _descriptor: u32,
    _expected_lines: usize,
    code: &'static str,
    label: &'static str,
) -> anyhow::Result<Vec<zeroize::Zeroizing<String>>> {
    anyhow::bail!("{code}: inherited {label} descriptors are unavailable on this host")
}

fn read_password_environment(
    target_url: &str,
    expected_lines: usize,
) -> anyhow::Result<Option<Vec<zeroize::Zeroizing<String>>>> {
    use zeroize::Zeroizing;

    let Some(raw) = std::env::var_os("SNAPBACK_PASSWORD") else {
        return Ok(None);
    };
    password_non_stdin_profile_allowed(
        std::env::var("SNAPBACK_PROFILE").ok().as_deref(),
        target_url,
        "SNAPBACK_PASSWORD",
    )?;
    let bytes = Zeroizing::new(raw.into_encoded_bytes());
    Ok(Some(read_auth_secret_lines(
        bytes.as_slice(),
        expected_lines,
        "SNAPBACK_AUTH_PASSWORD_CARRIER_INVALID",
        "password carrier",
    )?))
}

fn password_non_stdin_profile_allowed(
    raw_profile: Option<&str>,
    target_url: &str,
    carrier: &str,
) -> anyhow::Result<()> {
    let profile = crate::admin::resolve_profile(raw_profile, origin_is_loopback(target_url), false);
    anyhow::ensure!(
        matches!(profile, ServerProfile::Dev | ServerProfile::Test),
        "SNAPBACK_PROFILE_FORBIDS: {carrier} is accepted only under dev or test profiles; stdin is the only password carrier in other profiles"
    );
    Ok(())
}

fn read_auth_passwords(
    target_url: &str,
    carrier: &AuthPasswordCarrierArgs,
    expected_lines: usize,
) -> anyhow::Result<Vec<zeroize::Zeroizing<String>>> {
    if carrier.password_stdin {
        return read_auth_secret_lines(
            std::io::stdin().lock(),
            expected_lines,
            "SNAPBACK_AUTH_PASSWORD_CARRIER_INVALID",
            "password carrier",
        );
    }
    if let Some(descriptor) = carrier.password_fd {
        password_non_stdin_profile_allowed(
            std::env::var("SNAPBACK_PROFILE").ok().as_deref(),
            target_url,
            "--password-fd",
        )?;
        return read_auth_secret_fd(
            descriptor,
            expected_lines,
            "SNAPBACK_AUTH_PASSWORD_CARRIER_INVALID",
            "password carrier",
        );
    }
    if carrier.password_environment {
        return read_password_environment(target_url, expected_lines)?.context(
            "SNAPBACK_AUTH_PASSWORD_CARRIER_INVALID: SNAPBACK_PASSWORD was selected but is unavailable",
        );
    }
    anyhow::bail!(
        "SNAPBACK_AUTH_PASSWORD_CARRIER_INVALID: choose --password-stdin, or --password-fd N / SNAPBACK_PASSWORD under dev/test"
    )
}

fn read_auth_session_token(
    carrier: &AuthSessionTokenCarrierArgs,
) -> anyhow::Result<zeroize::Zeroizing<String>> {
    let mut values = if carrier.session_token_stdin {
        read_auth_secret_lines(
            std::io::stdin().lock(),
            1,
            "SNAPBACK_AUTH_SESSION_TOKEN_CARRIER_INVALID",
            "session-token carrier",
        )?
    } else {
        let path = carrier.session_token_file.as_ref().context(
            "SNAPBACK_AUTH_SESSION_TOKEN_CARRIER_INVALID: choose --session-token-stdin or --session-token-file FILE",
        )?;
        let file = std::fs::File::open(path).map_err(|_| {
            anyhow::anyhow!(
                "SNAPBACK_AUTH_SESSION_TOKEN_CARRIER_INVALID: session-token file could not be opened"
            )
        })?;
        read_auth_secret_lines(
            file,
            1,
            "SNAPBACK_AUTH_SESSION_TOKEN_CARRIER_INVALID",
            "session-token carrier",
        )?
    };
    let token = values.remove(0);
    if token.is_empty() {
        anyhow::bail!(
            "SNAPBACK_AUTH_SESSION_TOKEN_CARRIER_INVALID: session-token carrier is empty"
        );
    }
    Ok(token)
}

fn read_auth_change_secrets(
    target_url: &str,
    session: &AuthSessionTokenCarrierArgs,
    password: &AuthPasswordCarrierArgs,
) -> anyhow::Result<(zeroize::Zeroizing<String>, Vec<zeroize::Zeroizing<String>>)> {
    if session.session_token_stdin && password.password_stdin {
        let mut values = read_auth_secret_lines(
            std::io::stdin().lock(),
            3,
            "SNAPBACK_AUTH_PASSWORD_CARRIER_INVALID",
            "combined session-token/password carrier",
        )?;
        let token = values.remove(0);
        if token.is_empty() {
            anyhow::bail!(
                "SNAPBACK_AUTH_SESSION_TOKEN_CARRIER_INVALID: session-token carrier is empty"
            );
        }
        return Ok((token, values));
    }
    let token = read_auth_session_token(session)?;
    let passwords = read_auth_passwords(target_url, password, 2)?;
    Ok((token, passwords))
}

#[derive(serde::Serialize)]
struct AuthPasswordCredentialCliRequest<'a> {
    email: &'a str,
    password: &'a str,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthPasswordChangeCliRequest<'a> {
    current_password: &'a str,
    new_password: &'a str,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthPasswordResetCliRequest<'a> {
    challenge_id: &'a str,
    code: &'a str,
    new_password: &'a str,
}

#[derive(serde::Serialize)]
struct AuthRecoveryConsumeCliRequest<'a> {
    email: &'a str,
    code: &'a str,
}

#[derive(serde::Serialize)]
struct AuthEmptyCliRequest {}

fn auth_cli_refusal(status: u16, response: ureq::Response) -> anyhow::Error {
    let code = response
        .into_json::<Value>()
        .ok()
        .and_then(|body| {
            body.pointer("/diagnostic/code")
                .or_else(|| body.pointer("/diagnostics/0/code"))
                .and_then(Value::as_str)
                .filter(|code| code.starts_with("SNAPBACK_"))
                .map(ToOwned::to_owned)
        })
        .unwrap_or_else(|| "SNAPBACK_AUTH_CLI_FAILED".to_owned());
    anyhow::anyhow!(
        "{code}: authentication request failed with HTTP {status}; response body omitted to protect submitted secrets"
    )
}

// @ref LLP 0227#surface-routes-cli-verbs-client-methods — these are direct
//   product-front-door calls, with no admin or impersonation authority.
fn auth_cli_post<T: serde::Serialize>(
    target: &AuthUrlArgs,
    path: &str,
    body: &T,
    session_token: Option<&str>,
) -> anyhow::Result<Value> {
    let base_url = target.url.trim_end_matches('/');
    anyhow::ensure!(
        !base_url.is_empty(),
        "SNAPBACK_AUTH_CLI_REQUEST_FAILED: --url must not be empty"
    );
    let agent = ureq::AgentBuilder::new().redirects(0).build();
    // The six public password/recovery verbs are sessions-profile clients even
    // when issuance starts anonymously. Offer the same required protocol as
    // the first-party client arm; AdminWrite unlock uses `admin_json_post` and
    // its independent admin credential contract.
    // @ref LLP 0058#bootstrap-handshake — every online caller repeats the exact
    //   auth-client protocol offer at the request boundary.
    let mut request = agent
        .post(&format!("{base_url}{path}"))
        .set(crate::auth::handshake::AUTH_CLIENT_PROTOCOL_HEADER, "1");
    let mut authorization = None;
    if let Some(token) = session_token {
        authorization = Some(zeroize::Zeroizing::new(format!("Bearer {token}")));
        request = request.set(
            "authorization",
            authorization
                .as_ref()
                .expect("authorization was just set")
                .as_str(),
        );
    }
    let outcome = match request.send_json(body) {
        Ok(response) => response.into_json().map_err(|_| {
            anyhow::anyhow!(
                "SNAPBACK_AUTH_CLI_RESPONSE_INVALID: authentication response was not JSON"
            )
        }),
        Err(ureq::Error::Status(status, response)) => Err(auth_cli_refusal(status, response)),
        Err(_) => Err(anyhow::anyhow!(
            "SNAPBACK_AUTH_CLI_REQUEST_FAILED: authentication request failed before a response was received"
        )),
    };
    drop(authorization);
    outcome
}

fn render_auth_cli_success(response: &Value) -> anyhow::Result<String> {
    let rendered = serde_json::to_string_pretty(response).map_err(|_| {
        anyhow::anyhow!(
            "SNAPBACK_AUTH_CLI_RESPONSE_INVALID: authentication response could not be rendered"
        )
    })?;
    let Some(codes) = response.get("recoveryCodes") else {
        return Ok(format!("{rendered}\n"));
    };
    let codes = codes
        .as_array()
        .filter(|codes| !codes.is_empty())
        .context("SNAPBACK_AUTH_CLI_RESPONSE_INVALID: recoveryCodes was not a nonempty array")?;
    for code in codes {
        let code = code.as_str().context(
            "SNAPBACK_AUTH_CLI_RESPONSE_INVALID: recoveryCodes contained a non-string value",
        )?;
        if rendered.matches(code).count() != 1 {
            anyhow::bail!(
                "SNAPBACK_AUTH_CLI_RESPONSE_INVALID: a recovery code was not present exactly once in the success projection"
            );
        }
    }
    Ok(format!(
        "Store these recovery codes now; they cannot be shown again.\n{rendered}\n"
    ))
}

fn print_auth_cli_success(response: &Value) -> anyhow::Result<()> {
    print!("{}", render_auth_cli_success(response)?);
    Ok(())
}

fn auth_password_command(command: AuthPasswordCommand) -> anyhow::Result<()> {
    match command {
        AuthPasswordCommand::Signup {
            target,
            email,
            password,
        } => {
            let passwords = read_auth_passwords(&target.url, &password, 1)?;
            let request = AuthPasswordCredentialCliRequest {
                email: &email,
                password: passwords[0].as_str(),
            };
            let response = auth_cli_post(&target, "/auth/password/signup", &request, None)?;
            print_auth_cli_success(&response)
        }
        AuthPasswordCommand::Signin {
            target,
            email,
            password,
        } => {
            let passwords = read_auth_passwords(&target.url, &password, 1)?;
            let request = AuthPasswordCredentialCliRequest {
                email: &email,
                password: passwords[0].as_str(),
            };
            let response = auth_cli_post(&target, "/auth/password/signin", &request, None)?;
            print_auth_cli_success(&response)
        }
        AuthPasswordCommand::Change {
            target,
            session,
            password,
        } => {
            let (session_token, passwords) =
                read_auth_change_secrets(&target.url, &session, &password)?;
            let request = AuthPasswordChangeCliRequest {
                current_password: passwords[0].as_str(),
                new_password: passwords[1].as_str(),
            };
            let response = auth_cli_post(
                &target,
                "/auth/password/change",
                &request,
                Some(session_token.as_str()),
            )?;
            print_auth_cli_success(&response)
        }
        AuthPasswordCommand::Reset {
            target,
            challenge_id,
            code,
            password,
        } => {
            let passwords = read_auth_passwords(&target.url, &password, 1)?;
            let request = AuthPasswordResetCliRequest {
                challenge_id: &challenge_id,
                code: &code,
                new_password: passwords[0].as_str(),
            };
            let response = auth_cli_post(&target, "/auth/password/reset", &request, None)?;
            print_auth_cli_success(&response)
        }
        AuthPasswordCommand::Unlock { target, email } => {
            let response = admin_json_post(
                &target,
                "/_snapback/api/auth/password/unlock",
                json!({ "email": email }),
            )?;
            println!("{}", serde_json::to_string_pretty(&response)?);
            Ok(())
        }
    }
}

fn auth_recovery_command(command: AuthRecoveryCommand) -> anyhow::Result<()> {
    match command {
        AuthRecoveryCommand::Consume {
            target,
            email,
            code,
        } => {
            let request = AuthRecoveryConsumeCliRequest {
                email: &email,
                code: &code,
            };
            let response = auth_cli_post(&target, "/auth/recovery/consume", &request, None)?;
            print_auth_cli_success(&response)
        }
        AuthRecoveryCommand::Rotate { target, session } => {
            let session_token = read_auth_session_token(&session)?;
            let response = auth_cli_post(
                &target,
                "/auth/recovery/rotate",
                &AuthEmptyCliRequest {},
                Some(session_token.as_str()),
            )?;
            print_auth_cli_success(&response)
        }
    }
}

fn auth_rehearse_command(command: AuthRehearseCommand) -> anyhow::Result<()> {
    match command {
        AuthRehearseCommand::Status {
            target,
            grant_id,
            json: _json,
        } => host_op_via_http(
            &target,
            json!({
                "operation": "auth.rehearsal.status",
                "args": { "grantId": grant_id },
            }),
        ),
        AuthRehearseCommand::Revoke { target, grant_id } => host_op_via_http(
            &target,
            json!({
                "operation": "auth.rehearsal.revoke",
                "args": { "grantId": grant_id },
            }),
        ),
        AuthRehearseCommand::Mint { target, input } => {
            let ready_file = target.ready_file.as_deref().context(
                "auth rehearsal mint requires --ready-file so the returned carrier can be custodied in its mechanical owner-only sibling",
            )?;
            anyhow::ensure!(
                target.url.is_none(),
                "auth rehearsal mint does not accept --url in the local wave-1 carrier profile"
            );
            let args = read_json_file(&input)?;
            anyhow::ensure!(
                args.is_object(),
                "auth rehearsal mint input must be a JSON object"
            );
            let mut envelope = post_host_op(
                &target,
                json!({ "operation": "auth.rehearsal.mint", "args": args }),
            )?;
            if envelope.get("ok").and_then(Value::as_bool) == Some(true) {
                let carrier_value = envelope
                    .pointer_mut("/data/carrier")
                    .map(Value::take)
                    .context("successful rehearsal mint response carried no carrier")?;
                let carrier = carrier_value
                    .as_str()
                    .map(ToOwned::to_owned)
                    .context("successful rehearsal mint response carried no carrier")?;
                let carrier = zeroize::Zeroizing::new(carrier);
                crate::auth::crypto::RehearsalBearer::parse(&carrier).map_err(|_| {
                    anyhow::anyhow!("successful rehearsal mint returned an invalid carrier")
                })?;
                let sidecar = publish_rehearsal_capability(ready_file, carrier.as_bytes())?;
                let data = envelope
                    .get_mut("data")
                    .and_then(Value::as_object_mut)
                    .context("successful rehearsal mint response data is not an object")?;
                data.insert(
                    "carrierFile".to_owned(),
                    Value::String(sidecar.display().to_string()),
                );
            }
            if !print_envelope(&envelope) {
                std::process::exit(envelope_exit_code(&envelope));
            }
            Ok(())
        }
        AuthRehearseCommand::Exercise {
            target,
            input,
            rehearsal_capability_stdin,
        } => {
            let args = read_json_file(&input)?;
            anyhow::ensure!(
                args.is_object(),
                "auth rehearsal exercise input must be a JSON object"
            );
            let envelope = post_rehearsal_host_op(
                &target,
                json!({ "operation": "auth.rehearsal.exercise", "args": args }),
                rehearsal_capability_stdin,
            )?;
            if !print_envelope(&envelope) {
                std::process::exit(envelope_exit_code(&envelope));
            }
            Ok(())
        }
    }
}

fn publish_rehearsal_capability(ready_file: &Path, carrier: &[u8]) -> anyhow::Result<PathBuf> {
    let value = read_trusted_json_file(ready_file)?;
    let descriptor = HostReadyDescriptor::validate(&value).map_err(|problems| {
        anyhow::anyhow!(
            "{} is not a valid readiness descriptor: {}",
            ready_file.display(),
            problems.join("; ")
        )
    })?;
    let health = fetch_health(&descriptor.server_url);
    verify_live_descriptor_identity(&descriptor, &health, "auth rehearsal mint")
        .map_err(|diagnostic| anyhow::anyhow!("{}: {}", diagnostic.code, diagnostic.message))?;
    let canonical_ready = std::fs::canonicalize(ready_file)
        .with_context(|| format!("failed to resolve ready file {}", ready_file.display()))?;
    let sidecar = crate::auth::rehearsal::rehearsal_capability_sibling(&canonical_ready)?;
    write_rehearsal_capability_sidecar(&sidecar, carrier)?;
    Ok(sidecar)
}

fn write_rehearsal_capability_sidecar(sidecar: &Path, carrier: &[u8]) -> anyhow::Result<()> {
    // A pre-existing inode is never truncated: mint publishes one fresh
    // capability and requires the operator to revoke/remove an older sidecar
    // explicitly. The strict creator validates type, owner, mode, links, and
    // ACLs on the opened descriptor before and after writing secret bytes.
    crate::secure_file::write_new_owner_only(sidecar, carrier).with_context(|| {
        format!(
            "failed to publish owner-only rehearsal capability {}",
            sidecar.display()
        )
    })?;
    let metadata = std::fs::symlink_metadata(sidecar)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt as _, PermissionsExt as _};
        anyhow::ensure!(
            metadata.file_type().is_file()
                && !metadata.file_type().is_symlink()
                && metadata.permissions().mode() & 0o777 == 0o600
                && metadata.uid() == unsafe { libc::geteuid() }
                && metadata.nlink() == 1,
            "published rehearsal capability is not a strict owner-only regular file"
        );
    }
    Ok(())
}

fn post_rehearsal_host_op(
    target: &TargetArgs,
    request: Value,
    rehearsal_capability_stdin: bool,
) -> anyhow::Result<Value> {
    let resolved = resolve_http_target_for_operation(target, false, false)?;
    let capability = if rehearsal_capability_stdin {
        anyhow::ensure!(
            origin_is_loopback(&resolved.server_url),
            "raw auth rehearsal capability stdin is local-only; remote URL targets are not supported"
        );
        let health = fetch_health(&resolved.server_url).map_err(|reason| {
            anyhow::anyhow!("auth rehearsal target could not be verified: {reason}")
        })?;
        anyhow::ensure!(
            matches!(
                health
                    .pointer("/capabilityManifest/runtimeFacts/authRehearsal/status")
                    .and_then(Value::as_str),
                Some("available" | "active")
            ),
            "auth rehearsal target does not advertise a live local rehearsal capability"
        );
        read_rehearsal_capability_from_stdin()?
    } else {
        let ready_file = target.ready_file.as_deref().context(
            "auth rehearsal exercise requires --ready-file or --url with --rehearsal-capability-stdin",
        )?;
        let value = read_trusted_json_file(ready_file)?;
        let descriptor = HostReadyDescriptor::validate(&value).map_err(|problems| {
            anyhow::anyhow!(
                "{} is not a valid readiness descriptor: {}",
                ready_file.display(),
                problems.join("; ")
            )
        })?;
        let health = fetch_health(&descriptor.server_url);
        verify_live_descriptor_identity(&descriptor, &health, "auth rehearsal exercise")
            .map_err(|diagnostic| anyhow::anyhow!("{}: {}", diagnostic.code, diagnostic.message))?;
        let canonical_ready = std::fs::canonicalize(ready_file)
            .with_context(|| format!("failed to resolve ready file {}", ready_file.display()))?;
        let sidecar = crate::auth::rehearsal::rehearsal_capability_sibling(&canonical_ready)?;
        let bytes = crate::secure_file::read_strict_owner_only(
            &sidecar,
            crate::auth::rehearsal::MAX_REHEARSAL_CAPABILITY_FILE_BYTES,
        )?;
        crate::auth::rehearsal::parse_rehearsal_capability_file(zeroize::Zeroizing::new(bytes))
            .map_err(anyhow::Error::new)?
    };
    let http = ureq::post(&format!("{}/_snapback/api/host-ops", resolved.server_url)).set(
        crate::auth::rehearsal::AUTH_REHEARSAL_CAPABILITY_HEADER,
        capability.expose_secret(),
    );
    match http.send_json(request) {
        Ok(response) => response
            .into_json()
            .context("host-ops response was not JSON"),
        Err(ureq::Error::Status(_status, response)) => response
            .into_json()
            .context("host-ops error response was not JSON"),
        Err(error) => Err(error).context("host-ops request failed"),
    }
}

fn read_rehearsal_capability_from_stdin() -> anyhow::Result<crate::auth::crypto::RehearsalBearer> {
    use std::io::Read as _;
    use zeroize::{Zeroize as _, Zeroizing};

    let mut bytes = Vec::new();
    std::io::stdin().take(513).read_to_end(&mut bytes)?;
    if bytes.len() > 512 {
        bytes.zeroize();
        anyhow::bail!("rehearsal capability stdin value is too large");
    }
    while matches!(bytes.last(), Some(b'\n' | b'\r')) {
        bytes.pop();
    }
    let value = Zeroizing::new(
        String::from_utf8(bytes)
            .map_err(|_| anyhow::anyhow!("rehearsal capability stdin value is not UTF-8"))?,
    );
    crate::auth::crypto::RehearsalBearer::parse(&value)
        .map_err(|_| anyhow::anyhow!("rehearsal capability stdin value is invalid"))
}

/// POST one host operation and project the envelope to stdout + exit code
/// (`ok: false` → exit 1) per LLP 0024's transport-projection rule.
fn host_op_via_http(target: &TargetArgs, request: Value) -> anyhow::Result<()> {
    let envelope = post_host_op(target, request)?;
    if !print_envelope(&envelope) {
        std::process::exit(envelope_exit_code(&envelope));
    }
    Ok(())
}

/// Preserve the administrative host-op path for normal runs. A sessions-mode
/// query refuses that path at its scoped secret-read boundary; only then do we
/// retry as the anonymous app caller the absent `--user` requested. The public
/// query route's manifest gate is the authority for whether that retry may run.
// @ref LLP 0058#session-mode-body-closure — sessions app routes derive
// anonymous authority from carrier absence and reject all legacy body auth.
fn run_function_via_http(
    target: &TargetArgs,
    function: &str,
    args: Value,
    request: Value,
    anonymous: bool,
) -> anyhow::Result<()> {
    let (envelope, resolved) = post_host_op_with_target(target, request)?;
    let secret_read_refusal = envelope.pointer("/diagnostic/code").and_then(Value::as_str)
        == Some("SNAPBACK_ADMIN_SECRET_READ_REQUIRED");
    if anonymous && secret_read_refusal {
        let (ok, response) = post_anonymous_query(&resolved.server_url, function, args)?;
        println!("{}", serde_json::to_string_pretty(&response)?);
        if !ok {
            let exit_code = response
                .pointer("/diagnostic/code")
                .and_then(Value::as_str)
                .map_or(EXIT_FUNCTION_ERROR, classify_native_exit);
            std::process::exit(exit_code);
        }
        return Ok(());
    }
    if !print_envelope(&envelope) {
        std::process::exit(envelope_exit_code(&envelope));
    }
    Ok(())
}

fn post_anonymous_query(
    server_url: &str,
    function: &str,
    args: Value,
) -> anyhow::Result<(bool, Value)> {
    let function = percent_encode_path_segment(function);
    let endpoint = format!("{}/query/{function}", server_url.trim_end_matches('/'));
    match ureq::post(&endpoint).send_json(json!({ "args": args })) {
        Ok(response) => Ok((
            true,
            response
                .into_json()
                .context("anonymous query response was not JSON")?,
        )),
        Err(ureq::Error::Status(_status, response)) => Ok((
            false,
            response
                .into_json()
                .context("anonymous query refusal was not JSON")?,
        )),
        Err(error) => Err(error).context("anonymous query request failed"),
    }
}

fn percent_encode_path_segment(value: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            encoded.push(char::from(byte));
        } else {
            encoded.push('%');
            encoded.push(char::from(HEX[usize::from(byte >> 4)]));
            encoded.push(char::from(HEX[usize::from(byte & 0x0f)]));
        }
    }
    encoded
}

/// LLP 0184 §B: `debug.live.forceResync` fences on the target's startup
/// nonce so the request cannot silently land on a different process than
/// the operator inspected. `--ready-file`'s descriptor already carries the
/// nonce the running server minted at boot; `--url`-only targeting has no
/// local descriptor to read it from, so the caller must supply
/// `--startup-nonce` explicitly in that case.
fn resolve_startup_nonce(target: &TargetArgs, explicit: Option<String>) -> anyhow::Result<String> {
    if let Some(nonce) = explicit.filter(|value| !value.is_empty()) {
        return Ok(nonce);
    }
    if let Some(path) = &target.ready_file {
        let value = read_trusted_json_file(path)?;
        let descriptor = HostReadyDescriptor::validate(&value).map_err(|problems| {
            anyhow::anyhow!(
                "{} is not a valid readiness descriptor: {}",
                path.display(),
                problems.join("; ")
            )
        })?;
        return descriptor
            .startup_nonce
            .clone()
            .context("readiness descriptor has no startupNonce");
    }
    anyhow::bail!(
        "debug force-resync requires a startup nonce: pass --ready-file (the nonce is read \
         from its readiness descriptor) or --startup-nonce explicitly when targeting --url"
    )
}

fn post_host_op(target: &TargetArgs, request: Value) -> anyhow::Result<Value> {
    post_host_op_with_target(target, request).map(|(envelope, _resolved)| envelope)
}

fn post_host_op_with_target(
    target: &TargetArgs,
    request: Value,
) -> anyhow::Result<(Value, ResolvedHttpTarget)> {
    // Resolve the URL and optional local capability from one validated
    // descriptor snapshot. Reading the path once for the URL and again for the
    // token would let a rename between reads combine an attacker's URL with a
    // trusted descriptor's token handoff (ENG-24338).
    let requires_impersonation = request_requires_impersonation(&request);
    let requires_agent_destroy = request_requires_agent_destroy(&request);
    let resolved =
        resolve_http_target_for_operation(target, requires_impersonation, requires_agent_destroy)?;
    let token = target
        .token
        .clone()
        .or_else(|| std::env::var("SNAPBACK_ADMIN_TOKEN").ok())
        .filter(|token| !token.is_empty())
        .or_else(|| resolved.minted_token.clone());
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
    if requires_agent_destroy && let Some(capability) = resolved.agent_destroy_capability.as_ref() {
        http = http.set(
            crate::admin_agent_destroy::AGENT_DESTROY_CAPABILITY_HEADER,
            capability.expose_secret(),
        );
    }
    let envelope = match http.send_json(request) {
        Ok(response) => response
            .into_json()
            .context("host-ops response was not JSON")?,
        // A gated/refused call returns the structured ApiError body — surface
        // it verbatim rather than as a transport error.
        Err(ureq::Error::Status(_status, response)) => response
            .into_json()
            .context("host-ops error response was not JSON")?,
        Err(error) => return Err(error).context("host-ops request failed"),
    };
    Ok((envelope, resolved))
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
    let resolved = resolve_http_target_for_operation(target, false, false)?;
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
        DataCommand::Patch(args) => {
            if args.input.as_os_str() == "-" && args.target.impersonation_capability_stdin {
                anyhow::bail!(
                    "--input - and --impersonation-capability-stdin cannot share stdin; use a ready file or a JSON input file"
                );
            }
            let input = read_data_patch_input(&args.input)?;
            let operation = if args.preview {
                crate::data_patch::DATA_PATCH_PREVIEW_OPERATION
            } else {
                crate::data_patch::DATA_PATCH_APPLY_OPERATION
            };
            host_op_via_http(
                &args.target,
                json!({ "operation": operation, "input": input }),
            )
        }
    }
}

fn errors_json_post(target: &TargetArgs, value: Value) -> anyhow::Result<Value> {
    let resolved = resolve_http_target_for_operation(target, false, false)?;
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
    let resolved = resolve_http_target_for_operation(target, false, false)?;
    admin_json_post_resolved(target, resolved, path, value)
}

fn admin_json_post_resolved(
    target: &TargetArgs,
    resolved: ResolvedHttpTarget,
    path: &str,
    value: Value,
) -> anyhow::Result<Value> {
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
    let resolved = resolve_http_target_for_operation(target, false, false)?;
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

fn controls_command(command: ControlsCommand) -> anyhow::Result<()> {
    match command {
        ControlsCommand::List { intent, json } => {
            let catalog = crate::control_catalog::search(intent.as_deref());
            if json {
                println!("{}", serde_json::to_string_pretty(&catalog)?);
                return Ok(());
            }
            let digest = crate::control_catalog::catalog_digest(&catalog).unwrap_or("unknown");
            println!("Build control catalog {digest}");
            print!("{}", controls_list_text(&catalog));
            Ok(())
        }
        ControlsCommand::Describe { operation, json } => {
            let Some(entry) = crate::control_catalog::operation(&operation) else {
                anyhow::bail!(
                    "SNAPBACK_CONTROL_OPERATION_UNKNOWN: control catalog contains no operation {operation:?}; discover candidates with `snapback controls list --intent <words>`"
                );
            };
            let output = serde_json::json!({
                "schemaVersion": crate::control_catalog::CATALOG_SCHEMA_VERSION,
                "catalogDigest": crate::control_catalog::catalog_digest(
                    crate::control_catalog::build_catalog()
                ),
                "entry": entry,
            });
            if !json {
                println!(
                    "Build catalog row (identity {})",
                    crate::control_catalog::catalog_digest(crate::control_catalog::build_catalog())
                        .unwrap_or("unknown")
                );
            }
            println!("{}", serde_json::to_string_pretty(&output)?);
            Ok(())
        }
    }
}

fn controls_list_text(catalog: &Value) -> String {
    let mut output = String::from("OPERATION\tTITLE\tSURFACE\tOPERABILITY\tSTATUS\tCLI\n");
    for entry in catalog["entries"].as_array().into_iter().flatten() {
        output.push_str(&format!(
            "{}\t{}\t{}\t{}\t{}\t{}\n",
            entry["operation"].as_str().unwrap_or(""),
            entry["title"].as_str().unwrap_or(""),
            entry["surfaceAccess"].as_str().unwrap_or(""),
            entry["operability"].as_str().unwrap_or(""),
            entry["status"].as_str().unwrap_or(""),
            entry
                .pointer("/projections/cli")
                .and_then(Value::as_str)
                .unwrap_or("—"),
        ));
    }
    output
}

#[path = "cli/config_command.rs"]
mod config_command;
pub(crate) use config_command::config_command;

/// @ref LLP 0184#p2-controlled-mutations — `cron.tick`/`cron.runOne` direct
/// CLI projections of the existing admin-gated forced-dispatch routes.
fn cron_command(command: CronCommand) -> anyhow::Result<()> {
    match command {
        CronCommand::List { target } => {
            host_op_via_http(&target, json!({ "operation": "cron.list" }))
        }
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

fn ephemeral_command(command: EphemeralCommand) -> anyhow::Result<()> {
    match command {
        EphemeralCommand::Cleanup {
            target,
            older_than_ms,
            cutoff_timestamp_ms,
            dry_run,
            apply: _,
            max_entries,
        } => {
            let instance = admin_json_get(
                &target,
                "/_snapback/api/control-catalog/instance",
                Vec::new(),
            )?;
            let startup_nonce = instance
                .get("startupNonce")
                .and_then(Value::as_str)
                .context("control-catalog instance carried no startupNonce")?;
            let response = admin_json_post(
                &target,
                "/_snapback/api/ephemeral/cleanup",
                json!({
                    "cutoffTimestampMs": cutoff_timestamp_ms,
                    "olderThanMs": older_than_ms,
                    "dryRun": dry_run,
                    "maxEntries": max_entries,
                    "startupNonce": startup_nonce,
                }),
            )?;
            println!("{}", serde_json::to_string_pretty(&response)?);
            Ok(())
        }
        EphemeralCommand::OperatorDelete {
            target,
            collection,
            scope_json,
            entry_key,
            expected_scope_epoch,
            expected_entry_generation,
            reason,
        } => {
            let scope: BTreeMap<String, String> = serde_json::from_str(&scope_json)
                .context("--scope-json must be a JSON object whose values are strings")?;
            let resolved = resolve_operator_ephemeral_target(&target)?;
            let response = admin_json_post_resolved(
                &target,
                resolved.http,
                "/_snapback/api/ephemeral/operator/delete",
                json!({
                    "collection": collection,
                    "scope": scope,
                    "entryKey": entry_key,
                    "expectedScopeEpoch": expected_scope_epoch,
                    "expectedEntryGeneration": expected_entry_generation,
                    "reason": reason,
                    "startupNonce": resolved.startup_nonce,
                }),
            )?;
            println!("{}", serde_json::to_string_pretty(&response)?);
            Ok(())
        }
    }
}

/// jobs.list / jobs.show — read-only one-off job inspection (LLP 0184 P1),
/// plus jobs.drain (LLP 0184 §P2)'s direct CLI projection; the injected
/// `nowMs`/`maxWaves` fields are the same deterministic seam
/// `JobsDrainRequest` already accepts (`src/admin.rs`).
fn jobs_command(command: JobsCommand) -> anyhow::Result<()> {
    match command {
        JobsCommand::List { target } => {
            let response = admin_json_get(&target, "/_snapback/api/jobs", Vec::new())?;
            println!("{}", serde_json::to_string_pretty(&response)?);
            Ok(())
        }
        JobsCommand::Show { target, id } => {
            let response =
                admin_json_get(&target, &format!("/_snapback/api/jobs/{id}"), Vec::new())?;
            println!("{}", serde_json::to_string_pretty(&response)?);
            Ok(())
        }
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

/// The startup nonce is server authority for this operation, not an optional
/// client hint. A URL alone cannot prove which process owns it, so the CLI
/// requires an owner-only ready descriptor, validates it against live health,
/// and posts the nonce from that same pinned descriptor snapshot.
///
/// @ref LLP 0184#c-administrator-ephemeral-entry-delete--add-now — process,
/// epoch, and generation fences on the explicit administrator bypass.
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
        Some(AdminCommand::Approve { code, target }) => {
            approve_console_code(&target, &code, args.json)
        }
        Some(AdminCommand::Link {
            target,
            no_wait,
            url_base,
            qr,
            tailscale,
            lan,
            status,
            revoke,
            link_ready_file,
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
                json: args.json,
                link_ready_file,
            })
            .await
        }
        None => launch_admin_console(
            &args.target,
            args.no_open || !controlling_terminal_available(),
            args.json,
        ),
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
    json: bool,
    link_ready_file: Option<PathBuf>,
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
        json,
        link_ready_file,
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
            && (url_base.is_some()
                || qr
                || tailscale
                || lan.is_some()
                || no_wait
                || link_ready_file.is_some())),
        "SNAPBACK_ADMIN_LINK_CONTROL_CONFLICT: --status/--revoke cannot create or present a new reachability link"
    );
    anyhow::ensure!(
        !(no_wait && link_ready_file.is_some()),
        "SNAPBACK_ADMIN_LINK_READY_FILE_INVALID: --link-ready-file requires the attached observation lifecycle"
    );
    let resolved = resolve_admin_console_target(&target)?;
    if let Some(claim_code) = status {
        let status = console_claim_control_request(
            &resolved,
            "/_snapback/api/console/claim/status",
            &claim_code,
            "claim status",
        )?;
        print_console_claim_status(&status, json);
        return Ok(());
    }
    if let Some(claim_code) = revoke {
        let status = console_claim_control_request(
            &resolved,
            "/_snapback/api/console/claim/revoke",
            &claim_code,
            "claim revocation",
        )?;
        print_console_claim_status(&status, json);
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
    if json {
        println!(
            "{}",
            serde_json::to_string(&json!({
                "schemaVersion": "snapback.admin-link.v1",
                "event": "ready",
                "ok": true,
                "url": link,
                "claimExpiresAtMs": claim.expires_at_ms,
                "observing": !no_wait,
                "readyFile": link_ready_file,
            }))?
        );
    } else {
        println!("{link}");
    }
    if qr {
        if json {
            eprintln!("{}", crate::admin_link::render_terminal_qr(&link)?);
        } else {
            println!("{}", crate::admin_link::render_terminal_qr(&link)?);
        }
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
    let _ready_file = link_ready_file
        .as_deref()
        .map(|path| AdminLinkReadyFile::publish(path, &link, &claim, &printed_origin))
        .transpose()?;
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
                if json {
                    println!("{}", serde_json::to_string(&json!({
                        "schemaVersion": "snapback.admin-link.v1",
                        "event": "relay-observed",
                        "peer": observation.peer,
                    }))?);
                } else {
                    println!("relay-observed peer {}", observation.peer);
                }
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
                            print_console_claim_status(&status, json);
                            redemption_reported = true;
                        }
                    }
                    "redeemed" | "claim_expired" | "credential_expired" | "revoked" => {
                        print_console_claim_status(&status, json);
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

// @ref LLP 0024#dated-amendment-native-machine-mode-2026-08-08 — readiness is
// owned by the attached observer and disappears with that lifecycle.
struct AdminLinkReadyFile {
    path: PathBuf,
}

impl AdminLinkReadyFile {
    fn publish(
        path: &Path,
        link: &str,
        claim: &ConsoleClaimMintCliResponse,
        origin: &str,
    ) -> anyhow::Result<Self> {
        if let Some(parent) = path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
        {
            std::fs::create_dir_all(parent).with_context(|| {
                format!(
                    "failed to create admin-link ready directory {}",
                    parent.display()
                )
            })?;
        }
        let bytes = serde_json::to_vec_pretty(&json!({
            "schemaVersion": "snapback.admin-link-ready.v1",
            "ready": true,
            "pid": std::process::id(),
            "origin": origin,
            "url": link,
            "claimExpiresAtMs": claim.expires_at_ms,
        }))?;
        crate::secure_file::write_owner_only(path, &bytes).with_context(|| {
            format!("failed to publish admin-link ready file {}", path.display())
        })?;
        Ok(Self {
            path: path.to_owned(),
        })
    }
}

impl Drop for AdminLinkReadyFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
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
        .parse::<http::Uri>()
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

fn print_console_claim_status(status: &ConsoleClaimStatusCliResponse, json_output: bool) {
    if json_output {
        println!(
            "{}",
            serde_json::to_string(&json!({
                "schemaVersion": "snapback.admin-link.v1",
                "event": "claim-status",
                "status": status.status,
                "claimExpiresAtMs": status.claim_expires_at_ms,
                "redeemedAtMs": status.redeemed_at_ms,
                "transportPeer": status.transport_peer,
                "transportPeerSource": status.transport_peer_source,
                "credentialDigestSha256": status.credential_digest_sha256,
                "credentialExpiresAtMs": status.credential_expires_at_ms,
                "credentialMaxExpiresAtMs": status.credential_max_expires_at_ms,
                "revokedAtMs": status.revoked_at_ms,
            }))
            .expect("serialize admin claim status")
        );
        return;
    }
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
    let uri = value.parse::<http::Uri>().map_err(|_| {
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

fn mint_console_credential(
    resolved: &ResolvedAdminConsoleTarget,
) -> anyhow::Result<ConsoleCredentialCliResponse> {
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
    Ok(credential)
}

#[derive(Debug, Eq, PartialEq)]
struct ConsoleLaunchHandoff {
    url: String,
    expires_at_ms: u64,
}

fn console_launch_handoff_with(
    server_url: &str,
    no_open: bool,
    mint_credential: impl FnOnce() -> anyhow::Result<ConsoleCredentialCliResponse>,
    mint_claim: impl FnOnce() -> anyhow::Result<ConsoleClaimMintCliResponse>,
) -> anyhow::Result<ConsoleLaunchHandoff> {
    if no_open {
        let credential = mint_credential()?;
        return Ok(ConsoleLaunchHandoff {
            url: console_fragment_url(server_url, &credential.credential, credential.expires_at_ms),
            expires_at_ms: credential.expires_at_ms,
        });
    }
    let claim = mint_claim()?;
    Ok(ConsoleLaunchHandoff {
        url: console_claim_fragment_url(server_url, &claim.claim_code),
        expires_at_ms: claim.expires_at_ms,
    })
}

fn launch_admin_console(
    target: &TargetArgs,
    no_open: bool,
    json_output: bool,
) -> anyhow::Result<()> {
    let resolved = resolve_admin_console_target(target)?;
    // @ref LLP 0017#security-defaults — browser argv receives only a
    // short-lived, process-ephemeral, single-use sbcl_ claim. The page strips
    // its fragment and redeems over loopback for the real sbcc_ credential.
    // `--no-open` retains the explicit stdout-only credential handoff.
    let handoff = console_launch_handoff_with(
        &resolved.server_url,
        no_open,
        || mint_console_credential(&resolved),
        || mint_console_claim(&resolved),
    );
    let handoff = handoff?;
    if json_output {
        println!(
            "{}",
            serde_json::to_string_pretty(&json!({
                "schemaVersion": "snapback.admin-console.v1",
                "ok": true,
                "url": handoff.url,
                "openRequested": !no_open,
                "expiresAtMs": handoff.expires_at_ms,
            }))?
        );
    } else {
        println!("{}", handoff.url);
    }
    if no_open {
        return Ok(());
    }
    open_admin_browser(&handoff.url)?;
    Ok(())
}

fn approve_console_code(target: &TargetArgs, code: &str, json_output: bool) -> anyhow::Result<()> {
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
    if json_output {
        println!(
            "{}",
            serde_json::to_string(&json!({
                "schemaVersion": "snapback.admin-approval.v1",
                "ok": true,
                "approved": true,
            }))?
        );
    } else {
        println!("admin console code approved");
    }
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
    let expected = expected_minted_admin_token_path(ready_file, descriptor)?;
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

fn expected_minted_admin_token_path(
    ready_file: &Path,
    descriptor: &HostReadyDescriptor,
) -> Option<PathBuf> {
    match descriptor.database.mode.as_str() {
        "file" => Some(crate::admin::admin_token_sibling(Path::new(
            descriptor.database.path.as_deref()?,
        ))),
        "memory" => Some(crate::admin::admin_token_sibling(ready_file)),
        _ => None,
    }
}

#[cfg(unix)]
fn minted_admin_token_has_owner_only_mode(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt as _;

    std::fs::symlink_metadata(path)
        .ok()
        .is_some_and(|metadata| {
            metadata.file_type().is_file() && metadata.permissions().mode() & 0o077 == 0
        })
}

#[cfg(not(unix))]
fn minted_admin_token_has_owner_only_mode(_path: &Path) -> bool {
    true
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
/// token, read the auto-minted token file the server points at via the
/// readiness descriptor's `adminTokenFile`. The declared path must be the
/// database sibling for file mode or the trusted ready-file sibling for memory
/// mode; a remote `--url` target can never name a local path for the CLI to
/// read. Being able to read both owner-only files as this user is what makes
/// the CLI local admin (LLP 0036 D3).
/// Discovery failing just means the request goes out tokenless and surfaces
/// the server's structured refusal.
fn discover_minted_token(ready_file: &Path, descriptor: &HostReadyDescriptor) -> Option<String> {
    let declared = PathBuf::from(descriptor.admin_token_file.as_deref()?);
    let expected = expected_minted_admin_token_path(ready_file, descriptor)?;
    if declared != expected {
        return None;
    }
    if !minted_admin_token_has_owner_only_mode(&declared) {
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
    let expected = expected_minted_admin_token_path(ready_file, descriptor)?;
    if declared != expected {
        return None;
    }
    if !minted_admin_token_has_owner_only_mode(&declared) {
        return None;
    }
    let bytes = if declared.parent() == ready_file.parent() {
        target.read_owner_only_sibling(&declared).ok()?
    } else {
        crate::secure_file::read_owner_only(&declared).ok()?
    };
    let token = String::from_utf8(bytes).ok()?;
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
    let startup_nonce = descriptor
        .startup_nonce
        .clone()
        .context("readiness descriptor has no startupNonce")?;
    let issued_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| u64::try_from(duration.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0);
    let proof = sign_secret_read_mint_from_owner_only_file(
        &declared_root,
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

/// Receipt bytes are bounded before deserialization and live-fact evaluation.
const APPLICATION_READY_RECEIPT_MAX_BYTES: usize = 64 * 1024;

#[derive(Clone)]
struct WaitObservation {
    condition: &'static str,
    observation: Value,
}

fn wait_elapsed_ms(started: std::time::Instant) -> u64 {
    u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX)
}

fn wait_unknown_target() -> crate::host_ops::HostOpsTarget {
    crate::host_ops::HostOpsTarget {
        app_id: "unknown".to_owned(),
        app_root: None,
        target_profile: crate::manifest::TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned(),
        server_url: None,
    }
}

fn wait_result(
    request_id: &str,
    target: crate::host_ops::HostOpsTarget,
    ok: bool,
    data: Value,
    diagnostics: Vec<crate::diagnostic::Diagnostic>,
) -> HostOpsResult {
    HostOpsResult {
        schema_version: SNAPBACK_SCHEMA_VERSION.to_owned(),
        result_kind: HOST_OPS_RESULT_KIND.to_owned(),
        request_id: request_id.to_owned(),
        operation: "host.wait".to_owned(),
        ok,
        target,
        authority: None,
        artifacts: HostOpsArtifacts::default(),
        data,
        diagnostics,
        next: crate::control_catalog::result_next(ok, "host.wait"),
        secret_read_tables: Vec::new(),
        secret_read_rows: 0,
        secret_read_query: false,
        secret_read_provenance_complete: true,
    }
}

fn wait_failure_result(
    request_id: &str,
    target: crate::host_ops::HostOpsTarget,
    level: WaitLevel,
    started: std::time::Instant,
    code: &str,
    condition: &'static str,
    observation: Value,
) -> HostOpsResult {
    let waited_ms = wait_elapsed_ms(started);
    let diagnostic = crate::host_ops::host_op_diagnostic(
        code,
        "host.wait",
        &format!(
            "wait did not reach {} readiness: {condition}",
            level.as_str()
        ),
    )
    .with_details(json!({
        "operation": "host.wait",
        "level": level.as_str(),
        "condition": condition,
        "lastObservation": observation,
        "waitedMs": waited_ms,
    }));
    wait_result(
        request_id,
        target,
        false,
        json!({ "level": level.as_str(), "waitedMs": waited_ms }),
        vec![diagnostic],
    )
}

async fn host_wait(
    ready_file: &Path,
    level: WaitLevel,
    application_ready_file: Option<&Path>,
    timeout_ms: u64,
    token: Option<String>,
) -> anyhow::Result<()> {
    let request_id = crate::ids::mint_time_ordered(crate::ids::Kind::HostOperation);
    let envelope = host_wait_result(
        ready_file,
        level,
        application_ready_file,
        timeout_ms,
        token,
        &request_id,
    )
    .await;
    let value = serde_json::to_value(&envelope)?;
    let ok = print_envelope(&value);
    if !ok {
        std::process::exit(envelope_exit_code(&value));
    }
    Ok(())
}

// @ref LLP 0224#layered-readiness-not-one-overloaded-boolean — wait validates the receipt AND requires the live OperationalReadinessV1 to be positive for the receipt's bound target; digest comparison alone detects neither a same-process reload nor a predicate gone false.
async fn host_wait_result(
    ready_file: &Path,
    level: WaitLevel,
    application_ready_file: Option<&Path>,
    timeout_ms: u64,
    token: Option<String>,
    request_id: &str,
) -> HostOpsResult {
    let started = std::time::Instant::now();
    let timeout = std::time::Duration::from_millis(timeout_ms);
    let receipt_path = application_ready_file
        .map(Path::to_path_buf)
        .unwrap_or_else(|| crate::operational_readiness::application_ready_sibling(ready_file));
    let mut target = wait_unknown_target();
    let mut last: WaitObservation;

    if level == WaitLevel::Application
        && std::fs::symlink_metadata(&receipt_path)
            .is_ok_and(|metadata| metadata.file_type().is_dir())
    {
        return wait_failure_result(
            request_id,
            target,
            level,
            started,
            "SNAPBACK_WAIT_RECEIPT_INVALID",
            "application-ready-receipt-is-directory",
            json!({ "applicationReadyFile": receipt_path.display().to_string() }),
        );
    }

    loop {
        let descriptor_read = read_trusted_json_file_with_bytes(ready_file);
        let (descriptor_value, descriptor_bytes) = match descriptor_read {
            Ok(read) => read,
            Err(error) => {
                last = WaitObservation {
                    condition: if ready_file.exists() {
                        "ready-file-invalid"
                    } else {
                        "ready-file-missing"
                    },
                    observation: json!({
                        "readyFile": ready_file.display().to_string(),
                        "error": format!("{error:#}"),
                    }),
                };
                if started.elapsed() >= timeout {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                continue;
            }
        };
        let descriptor = match HostReadyDescriptor::validate(&descriptor_value) {
            Ok(descriptor) => descriptor,
            Err(problems) => {
                last = WaitObservation {
                    condition: "ready-file-invalid",
                    observation: json!({ "problems": problems }),
                };
                if started.elapsed() >= timeout {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                continue;
            }
        };
        target = descriptor.target.clone();
        target.server_url = Some(descriptor.server_url.clone());

        let Some(descriptor_nonce) = descriptor.startup_nonce.as_deref() else {
            return wait_failure_result(
                request_id,
                target,
                level,
                started,
                "SNAPBACK_WAIT_UNVERIFIABLE",
                "descriptor-startup-nonce-missing",
                json!({ "readyFile": ready_file.display().to_string() }),
            );
        };
        let health = fetch_health(&descriptor.server_url);
        if let Ok(payload) = &health
            && payload
                .pointer("/binary/startupNonce")
                .and_then(Value::as_str)
                .is_none()
        {
            return wait_failure_result(
                request_id,
                target,
                level,
                started,
                "SNAPBACK_WAIT_UNVERIFIABLE",
                "health-startup-nonce-missing",
                payload.clone(),
            );
        }
        if let Err(diagnostic) = verify_live_descriptor_identity(&descriptor, &health, "host.wait")
        {
            last = WaitObservation {
                condition: if health.is_err() {
                    "health-unreachable"
                } else {
                    "live-startup-nonce-mismatch"
                },
                observation: json!({
                    "diagnostic": diagnostic,
                    "health": health.as_ref().map_or_else(
                        |reason| json!({ "error": reason }),
                        Value::clone,
                    ),
                }),
            };
            if started.elapsed() >= timeout {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            continue;
        }

        if level == WaitLevel::Host {
            return wait_result(
                request_id,
                target,
                true,
                json!({
                    "level": level.as_str(),
                    "waitedMs": wait_elapsed_ms(started),
                    "serverUrl": descriptor.server_url,
                    "startupNonce": descriptor_nonce,
                }),
                Vec::new(),
            );
        }

        // The live nonce is verified above before the receipt sibling is
        // opened. Pin the ready-file parent and refuse any override outside it.
        let ready_target = match ReadyFileTarget::open_existing(ready_file) {
            Ok(target) => target,
            Err(error) => {
                last = WaitObservation {
                    condition: "application-ready-receipt-unreadable",
                    observation: json!({ "error": format!("{error:#}") }),
                };
                if started.elapsed() >= timeout {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                continue;
            }
        };
        let pinned_receipt = match resolve_candidate_path(&receipt_path) {
            Ok(path) => path,
            Err(error) => {
                last = WaitObservation {
                    condition: "application-ready-receipt-unreadable",
                    observation: json!({ "error": format!("{error:#}") }),
                };
                if started.elapsed() >= timeout {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                continue;
            }
        };
        let receipt_bytes = match ready_target
            .read_strict_owner_only_sibling(&pinned_receipt, APPLICATION_READY_RECEIPT_MAX_BYTES)
        {
            Ok(bytes) => bytes,
            Err(error) => {
                last = WaitObservation {
                    condition: if error.kind() == ErrorKind::NotFound {
                        "application-ready-receipt-missing"
                    } else {
                        "application-ready-receipt-unreadable"
                    },
                    observation: json!({
                        "applicationReadyFile": receipt_path.display().to_string(),
                        "error": error.to_string(),
                    }),
                };
                if started.elapsed() >= timeout {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                continue;
            }
        };
        let receipt = match serde_json::from_slice::<
            crate::operational_readiness::ApplicationReadyReceiptV1,
        >(&receipt_bytes)
        {
            Ok(receipt)
                if receipt.format_version
                    == crate::operational_readiness::APPLICATION_READY_FORMAT_V1 =>
            {
                receipt
            }
            Ok(receipt) => {
                last = WaitObservation {
                    condition: "application-ready-receipt-invalid",
                    observation: json!({ "formatVersion": receipt.format_version }),
                };
                if started.elapsed() >= timeout {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                continue;
            }
            Err(error) => {
                last = WaitObservation {
                    condition: "application-ready-receipt-invalid",
                    observation: json!({ "error": error.to_string() }),
                };
                if started.elapsed() >= timeout {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                continue;
            }
        };
        if receipt.startup_nonce != descriptor_nonce {
            last = WaitObservation {
                condition: "receipt-startup-nonce-mismatch",
                observation: json!({
                    "descriptorStartupNonce": descriptor_nonce,
                    "receiptStartupNonce": receipt.startup_nonce,
                }),
            };
            if started.elapsed() >= timeout {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            continue;
        }
        let descriptor_digest = format!("sha256:{:x}", Sha256::digest(&descriptor_bytes));
        if receipt.host_ready_descriptor_digest != descriptor_digest {
            last = WaitObservation {
                condition: "host-ready-descriptor-digest-mismatch",
                observation: json!({
                    "expected": descriptor_digest,
                    "observed": receipt.host_ready_descriptor_digest,
                }),
            };
            if started.elapsed() >= timeout {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            continue;
        }

        let readiness_target = TargetArgs {
            url: None,
            ready_file: Some(ready_file.to_path_buf()),
            token: token.clone(),
            impersonation_capability_stdin: false,
        };
        let readiness_envelope = match post_host_op(
            &readiness_target,
            json!({ "operation": "app.readiness.v1" }),
        ) {
            Ok(envelope) => envelope,
            Err(error) => {
                last = WaitObservation {
                    condition: "operational-readiness-unavailable",
                    observation: json!({ "error": format!("{error:#}") }),
                };
                if started.elapsed() >= timeout {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                continue;
            }
        };
        let readiness_ok = readiness_envelope.get("ok").and_then(Value::as_bool);
        if readiness_ok.is_none() {
            let diagnostics = diagnostics_from_result(&readiness_envelope).unwrap_or_else(|| {
                vec![crate::host_ops::host_op_diagnostic(
                    "SNAPBACK_WAIT_UNVERIFIABLE",
                    "host.wait",
                    "the authenticated operational-readiness fact returned an unrecognized refusal",
                )
                .with_details(json!({
                    "operation": "host.wait",
                    "level": level.as_str(),
                    "condition": "admin-authority-unavailable",
                    "lastObservation": readiness_envelope,
                }))]
            });
            return wait_result(
                request_id,
                target,
                false,
                json!({
                    "level": level.as_str(),
                    "waitedMs": wait_elapsed_ms(started),
                    "condition": "admin-authority-unavailable",
                }),
                diagnostics,
            );
        }
        if readiness_ok == Some(false) {
            last = WaitObservation {
                condition: "operational-readiness-refused",
                observation: readiness_envelope,
            };
            if started.elapsed() >= timeout {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            continue;
        }
        let readiness = match readiness_envelope
            .pointer("/data/operationalReadiness")
            .cloned()
            .and_then(|value| {
                serde_json::from_value::<crate::operational_readiness::OperationalReadinessV1>(
                    value,
                )
                .ok()
            }) {
            Some(readiness) => readiness,
            None => {
                last = WaitObservation {
                    condition: "operational-readiness-invalid",
                    observation: readiness_envelope,
                };
                if started.elapsed() >= timeout {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                continue;
            }
        };
        if !readiness.ready {
            last = WaitObservation {
                condition: "operational-readiness-not-ready",
                observation: json!({ "operationalReadiness": readiness }),
            };
            if started.elapsed() >= timeout {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            continue;
        }
        let (receipt_deployment, receipt_obligations_digest) = match &receipt.application {
            crate::operational_readiness::ApplicationIdentityV1::DevGenerated {
                deployment,
                obligations_digest,
            } => (deployment, obligations_digest),
        };
        let Some(live_target) = readiness.target.as_ref() else {
            last = WaitObservation {
                condition: "operational-readiness-target-missing",
                observation: json!({ "operationalReadiness": readiness }),
            };
            if started.elapsed() >= timeout {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            continue;
        };
        let mut receipt_mismatch = Vec::new();
        if readiness.startup_nonce != receipt.startup_nonce {
            receipt_mismatch.push("startupNonce");
        }
        if &live_target.deployment != receipt_deployment {
            receipt_mismatch.push("application.deployment");
        }
        if &live_target.obligations_digest != receipt_obligations_digest {
            receipt_mismatch.push("application.obligationsDigest");
        }
        if live_target.target_profile != receipt.target_profile {
            receipt_mismatch.push("targetProfile");
        }
        if readiness.artifacts.schema_hash != receipt.artifacts.schema_hash
            || readiness.artifacts.bundle_hash != receipt.artifacts.bundle_hash
            || readiness.artifacts.database_version != receipt.artifacts.database_version
        {
            receipt_mismatch.push("artifacts");
        }
        if readiness.auth.active != receipt.auth.active_mode {
            receipt_mismatch.push("auth.activeMode");
        }
        if readiness.auth.desired != receipt.auth.desired_mode {
            receipt_mismatch.push("auth.desiredMode");
        }
        if readiness.auth.mode_state != receipt.auth.mode_state {
            receipt_mismatch.push("auth.modeState");
        }
        if readiness.auth.app_data_availability != receipt.auth.app_data_availability {
            receipt_mismatch.push("auth.appDataAvailability");
        }
        if readiness.auth.session_activation_ready != receipt.auth.session_activation_ready {
            receipt_mismatch.push("auth.sessionActivationReady");
        }
        if readiness.capability_manifest_digest != receipt.capability_manifest_digest {
            receipt_mismatch.push("capabilityManifestDigest");
        }
        if readiness.client_origins != receipt.client_origins {
            receipt_mismatch.push("clientOrigins");
        }
        if readiness.network_profile != receipt.network_profile {
            receipt_mismatch.push("networkProfile");
        }
        if !receipt_mismatch.is_empty() {
            last = WaitObservation {
                condition: "operational-readiness-receipt-mismatch",
                observation: json!({
                    "mismatch": receipt_mismatch,
                    "receipt": receipt,
                    "operationalReadiness": readiness,
                }),
            };
            if started.elapsed() >= timeout {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            continue;
        }

        return wait_result(
            request_id,
            target,
            true,
            json!({
                "level": level.as_str(),
                "waitedMs": wait_elapsed_ms(started),
                "serverUrl": descriptor.server_url,
                "startupNonce": descriptor_nonce,
                "applicationReadyFile": receipt_path.display().to_string(),
                "operationalReadiness": readiness,
            }),
            Vec::new(),
        );
    }

    wait_failure_result(
        request_id,
        target,
        level,
        started,
        "SNAPBACK_WAIT_TIMEOUT",
        last.condition,
        last.observation,
    )
}

/// host.stop: validate the readiness descriptor, verify the descriptor still
/// names the live server, signal the process, remove the file, and print a
/// synthesized host.stop envelope (the CLI owns this operation — a server
/// cannot stop itself over its own HTTP surface).
fn host_stop(ready_file: &Path) -> anyhow::Result<()> {
    let request_id = crate::ids::mint_time_ordered(crate::ids::Kind::HostOperation);
    let envelope = host_stop_result(ready_file, &request_id)?;
    let value = serde_json::to_value(&envelope)?;
    let ok = print_envelope(&value);
    if !ok {
        std::process::exit(envelope_exit_code(&value));
    }
    Ok(())
}

fn host_stop_result(ready_file: &Path, request_id: &str) -> anyhow::Result<HostOpsResult> {
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
            request_id: request_id.to_owned(),
            operation: "host.stop".to_owned(),
            ok,
            target: descriptor.target.clone(),
            authority: None,
            artifacts: HostOpsArtifacts::default(),
            data,
            diagnostics,
            next: crate::control_catalog::result_next(ok, "host.stop"),
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
        return Ok(refused);
    }
    let stopped = std::process::Command::new("kill")
        .arg(descriptor.pid.to_string())
        .status()
        .context("failed to signal the server process")?
        .success();
    if stopped {
        let _ = std::fs::remove_file(ready_file);
    }
    Ok(envelope(
        stopped,
        json!({
            "stoppedPid": descriptor.pid,
            "serverUrl": descriptor.server_url,
            "verifiedBy": "startupNonce",
        }),
        Vec::new(),
    ))
}

/// Compose the same concrete-credential probe, nonce-verified stop, and
/// detached replacement start as `snapback_restart` in mcp-control.mjs.
/// Secrets stay in an in-memory header and never enter child argv or receipts.
///
/// @ref LLP 0184#2-derived-ownership-not-a-second-registry — the CLI restart
/// closes the same named lifecycle authority exception as the MCP projection.
async fn host_restart(ready_file: &Path, reason: &str) -> anyhow::Result<()> {
    let request_id = crate::ids::mint_time_ordered(crate::ids::Kind::HostOperation);
    let envelope = host_restart_result(ready_file, reason, &request_id).await?;
    let value = serde_json::to_value(&envelope)?;
    let ok = print_envelope(&value);
    if !ok {
        std::process::exit(envelope_exit_code(&value));
    }
    Ok(())
}

async fn host_restart_result(
    ready_file: &Path,
    reason: &str,
    request_id: &str,
) -> anyhow::Result<HostOpsResult> {
    let value = read_trusted_json_file(ready_file)?;
    let previous_descriptor = HostReadyDescriptor::validate(&value).map_err(|problems| {
        anyhow::anyhow!(
            "{} is not a valid readiness descriptor: {}",
            ready_file.display(),
            problems.join("; ")
        )
    })?;

    let probe = restart_admin_credential_probe(ready_file);
    let probe = match probe {
        Ok(probe) if probe.get("ok").and_then(Value::as_bool) == Some(true) => probe,
        Ok(probe) => {
            let diagnostics = diagnostics_from_result(&probe).unwrap_or_else(|| {
                vec![crate::diagnostic::Diagnostic::error(
                    "SNAPBACK_HOST_RESTART_ADMIN_CREDENTIAL_REQUIRED",
                    "host-ops",
                    "host.restart requires an administrator credential accepted by the live host-ops route",
                )]
            });
            let previous = lifecycle_result(
                request_id,
                "host.stop",
                previous_descriptor.target.clone(),
                false,
                json!({}),
                diagnostics,
            );
            let current = lifecycle_result(
                request_id,
                "host.start",
                previous_descriptor.target.clone(),
                false,
                json!({}),
                Vec::new(),
            );
            return Ok(compose_restart_result(
                request_id, reason, &previous, &current,
            ));
        }
        Err(_) => {
            let previous = lifecycle_result(
                request_id,
                "host.stop",
                previous_descriptor.target.clone(),
                false,
                json!({}),
                vec![crate::diagnostic::Diagnostic::error(
                    "SNAPBACK_HOST_RESTART_ADMIN_CREDENTIAL_REQUIRED",
                    "host-ops",
                    "host.restart could not prove an administrator credential against the live host-ops route",
                )],
            );
            let current = lifecycle_result(
                request_id,
                "host.start",
                previous_descriptor.target.clone(),
                false,
                json!({}),
                Vec::new(),
            );
            return Ok(compose_restart_result(
                request_id, reason, &previous, &current,
            ));
        }
    };
    drop(probe);

    let mut previous = host_stop_result(ready_file, request_id)?;
    if !previous.ok {
        let current = lifecycle_result(
            request_id,
            "host.start",
            previous_descriptor.target.clone(),
            false,
            json!({}),
            Vec::new(),
        );
        return Ok(compose_restart_result(
            request_id, reason, &previous, &current,
        ));
    }

    let exited = wait_for_server_exit(&previous_descriptor).await;
    previous.data["exited"] = json!(exited);
    if !exited {
        previous.ok = false;
        previous
            .diagnostics
            .push(crate::diagnostic::Diagnostic::error(
                "SNAPBACK_HOST_RESTART_STOP_TIMEOUT",
                "host-ops",
                "the verified server did not stop before the restart deadline",
            ));
        let current = lifecycle_result(
            request_id,
            "host.start",
            previous_descriptor.target.clone(),
            false,
            json!({}),
            Vec::new(),
        );
        return Ok(compose_restart_result(
            request_id, reason, &previous, &current,
        ));
    }

    let current = restart_start_result(ready_file, &previous_descriptor, request_id).await;
    Ok(compose_restart_result(
        request_id, reason, &previous, &current,
    ))
}

fn restart_admin_credential_probe(ready_file: &Path) -> anyhow::Result<Value> {
    let local_target = TargetArgs {
        url: None,
        ready_file: Some(ready_file.to_path_buf()),
        token: None,
        impersonation_capability_stdin: false,
    };
    // Unlike an ordinary loopback AdminRead, lifecycle proof requires a
    // concrete credential carrier. Reuse the strict resolver that fails when
    // the declared owner-only token is missing instead of falling through to
    // the loopback read convenience.
    let resolved = resolve_admin_console_target(&local_target)?;
    let proof_target = TargetArgs {
        url: Some(resolved.server_url),
        ready_file: None,
        token: Some(resolved.token),
        impersonation_capability_stdin: false,
    };
    post_host_op(&proof_target, json!({ "operation": "app.inspect" }))
}

fn diagnostics_from_result(value: &Value) -> Option<Vec<crate::diagnostic::Diagnostic>> {
    if let Some(diagnostics) = value.get("diagnostics") {
        let diagnostics = serde_json::from_value(diagnostics.clone()).ok()?;
        return Some(diagnostics);
    }
    value
        .get("diagnostic")
        .cloned()
        .and_then(|diagnostic| serde_json::from_value(diagnostic).ok())
        .map(|diagnostic| vec![diagnostic])
}

fn lifecycle_result(
    request_id: &str,
    operation: &str,
    target: crate::host_ops::HostOpsTarget,
    ok: bool,
    data: Value,
    diagnostics: Vec<crate::diagnostic::Diagnostic>,
) -> HostOpsResult {
    HostOpsResult {
        schema_version: SNAPBACK_SCHEMA_VERSION.to_owned(),
        result_kind: HOST_OPS_RESULT_KIND.to_owned(),
        request_id: request_id.to_owned(),
        operation: operation.to_owned(),
        ok,
        target,
        authority: None,
        artifacts: HostOpsArtifacts::default(),
        data,
        diagnostics,
        next: crate::control_catalog::result_next(ok, operation),
        secret_read_tables: Vec::new(),
        secret_read_rows: 0,
        secret_read_query: false,
        secret_read_provenance_complete: true,
    }
}

fn compose_restart_result(
    request_id: &str,
    reason: &str,
    previous: &HostOpsResult,
    current: &HostOpsResult,
) -> HostOpsResult {
    let mut diagnostics = previous.diagnostics.clone();
    diagnostics.extend(current.diagnostics.clone());
    let ok = previous.ok && current.ok;
    HostOpsResult {
        schema_version: SNAPBACK_SCHEMA_VERSION.to_owned(),
        result_kind: HOST_OPS_RESULT_KIND.to_owned(),
        request_id: request_id.to_owned(),
        operation: "host.restart".to_owned(),
        ok,
        target: current.target.clone(),
        authority: None,
        artifacts: current.artifacts.clone(),
        data: json!({
            "restartReason": reason,
            "previous": previous.data,
            "current": current.data,
        }),
        diagnostics,
        next: crate::control_catalog::result_next(ok, "host.restart"),
        secret_read_tables: Vec::new(),
        secret_read_rows: 0,
        secret_read_query: false,
        secret_read_provenance_complete: true,
    }
}

async fn wait_for_server_exit(descriptor: &HostReadyDescriptor) -> bool {
    for _ in 0..200 {
        let endpoint_gone = fetch_health(&descriptor.server_url).is_err();
        #[cfg(unix)]
        let process_gone = process_is_proven_gone(descriptor.pid).unwrap_or(false);
        #[cfg(not(unix))]
        let process_gone = endpoint_gone;
        if endpoint_gone && process_gone {
            return true;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    false
}

async fn restart_start_result(
    ready_file: &Path,
    previous: &HostReadyDescriptor,
    request_id: &str,
) -> HostOpsResult {
    let failure = |code: &'static str, message: String| {
        lifecycle_result(
            request_id,
            "host.start",
            previous.target.clone(),
            false,
            json!({}),
            vec![crate::diagnostic::Diagnostic::error(
                code, "host-ops", message,
            )],
        )
    };
    let argv = match restart_start_argv(ready_file, previous) {
        Ok(argv) => argv,
        Err(message) => return failure("SNAPBACK_HOST_RESTART_READY_INVALID", message),
    };
    let executable = match std::env::current_exe() {
        Ok(executable) => executable,
        Err(error) => {
            return failure(
                "SNAPBACK_HOST_RESTART_START_FAILED",
                format!("could not resolve the current snapback executable: {error}"),
            );
        }
    };
    let mut command = std::process::Command::new(executable);
    command
        .args(&argv)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    for (key, _) in std::env::vars_os() {
        if key.to_string_lossy().starts_with("DYLD_") {
            command.env_remove(key);
        }
    }
    #[cfg(unix)]
    {
        // The replacement outlives this one-shot CLI process. MCP keeps its
        // child owner alive; the CLI uses a new session for equivalent custody.
        configure_detached_child(&mut command);
    }
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            return failure(
                "SNAPBACK_HOST_RESTART_START_FAILED",
                format!("could not spawn the replacement server: {error}"),
            );
        }
    };
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
    let descriptor = loop {
        if ready_file.exists() {
            let value = match read_trusted_json_file(ready_file) {
                Ok(value) => value,
                Err(error) => {
                    let _ = child.kill();
                    return failure(
                        "SNAPBACK_HOST_RESTART_READY_INVALID",
                        format!("replacement readiness could not be read: {error}"),
                    );
                }
            };
            match HostReadyDescriptor::validate(&value) {
                Ok(descriptor) => break descriptor,
                Err(problems) => {
                    let _ = child.kill();
                    return failure(
                        "SNAPBACK_HOST_RESTART_READY_INVALID",
                        format!("replacement readiness was invalid: {}", problems.join("; ")),
                    );
                }
            }
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                return failure(
                    "SNAPBACK_HOST_RESTART_START_FAILED",
                    format!("replacement server exited before readiness with {status}"),
                );
            }
            Err(error) => {
                return failure(
                    "SNAPBACK_HOST_RESTART_START_FAILED",
                    format!("replacement process status could not be read: {error}"),
                );
            }
            Ok(None) => {}
        }
        if std::time::Instant::now() >= deadline {
            let _ = child.kill();
            return failure(
                "SNAPBACK_HOST_RESTART_START_TIMEOUT",
                "replacement server did not publish readiness within 15 seconds".to_owned(),
            );
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    };

    if descriptor.pid != child.id()
        || descriptor.database.mode != previous.database.mode
        || descriptor.database.path != previous.database.path
        || descriptor.startup_nonce == previous.startup_nonce
    {
        let _ = child.kill();
        return failure(
            "SNAPBACK_HOST_RESTART_READY_INVALID",
            "replacement readiness did not identify the spawned successor over the same database"
                .to_owned(),
        );
    }

    let inspect = match restart_admin_credential_probe(ready_file) {
        Ok(inspect) => inspect,
        Err(_) => {
            return failure(
                "SNAPBACK_HOST_RESTART_START_FAILED",
                "replacement server was ready but failed the administrator-credential inspect probe"
                    .to_owned(),
            );
        }
    };
    let ok = inspect.get("ok").and_then(Value::as_bool) == Some(true);
    let diagnostics = diagnostics_from_result(&inspect).unwrap_or_default();
    let artifacts = inspect
        .get("artifacts")
        .cloned()
        .and_then(|artifacts| serde_json::from_value(artifacts).ok())
        .unwrap_or_default();
    HostOpsResult {
        schema_version: SNAPBACK_SCHEMA_VERSION.to_owned(),
        result_kind: HOST_OPS_RESULT_KIND.to_owned(),
        request_id: request_id.to_owned(),
        operation: "host.start".to_owned(),
        ok,
        target: descriptor.target.clone(),
        authority: None,
        artifacts,
        data: json!({
            "attached": false,
            "managed": true,
            "pid": descriptor.pid,
            "serverUrl": descriptor.server_url,
            "readyFile": ready_file.display().to_string(),
            "database": descriptor.database.path.as_deref().unwrap_or("memory"),
            "runtimeState": inspect.pointer("/data/runtimeState").cloned().unwrap_or(Value::Null),
        }),
        diagnostics,
        next: crate::control_catalog::result_next(ok, "host.start"),
        secret_read_tables: Vec::new(),
        secret_read_rows: 0,
        secret_read_query: false,
        secret_read_provenance_complete: true,
    }
}

fn restart_start_argv(
    ready_file: &Path,
    descriptor: &HostReadyDescriptor,
) -> Result<Vec<std::ffi::OsString>, String> {
    let mut argv = vec![
        std::ffi::OsString::from("start"),
        std::ffi::OsString::from("--ready-file"),
        ready_file.as_os_str().to_owned(),
    ];
    match descriptor.database.mode.as_str() {
        "file" => {
            let path = descriptor
                .database
                .path
                .as_deref()
                .ok_or_else(|| "file-backed readiness has no database path".to_owned())?;
            argv.push(std::ffi::OsString::from("--db"));
            argv.push(std::ffi::OsString::from(path));
        }
        "memory" => argv.push(std::ffi::OsString::from("--memory")),
        mode => return Err(format!("unsupported readiness database mode {mode:?}")),
    }
    Ok(argv)
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
    let replication_config = crate::replication::ReplicationConfig::from_env()?;
    anyhow::ensure!(
        !(args.memory && replication_config.is_some()),
        "SNAPBACK_REPLICATION_CONFIG_INVALID: replication requires a file-backed database"
    );
    // Resolve once, before auth composition, and bind the exact same address.
    // This keeps profile/capture posture identical for numeric hosts and DNS
    // aliases without opening a listener early.
    let bind_ip = resolve_bind_ip(&args.host).await?;
    let startup_resolution = crate::admin::resolve_server_startup(bind_ip.is_loopback())?;
    let startup_profile = startup_resolution.profile();
    // @ref LLP 0262#d4-declared-exposure — a fronted unset profile resolves
    // to full Prod semantics; explicit non-production remains explicit and
    // visible, while every unrecognized nonempty value fails fronted.
    if let Some(warning) = startup_resolution.startup_warning() {
        eprintln!("{warning}");
    }
    // @ref LLP 0060#d5-hosted-readiness-is-conjunctive — reject an explicit
    // hosted request before opening target state; operator config is a request,
    // never authority for target-owned TLS/proxy/throttle/invalidation facts.
    //
    // @ref LLP 0098#4-the-admission-seam — the one place hosted serving can be
    // admitted. Every clause not needing durable state runs here, before the
    // database path is created, so an unsupported hosted request still leaves
    // the target byte-for-byte unchanged.
    let verified_hosted_admission = crate::admin::compose_hosted_edge_admission(
        args.auth_deployment,
        args.hosted_edge.as_deref(),
        args.hosted_admission.as_deref(),
        bind_ip,
    )?;
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
    let provisional_agent_destroy_temp = args
        .ready_file
        .as_deref()
        .map(crate::admin_agent_destroy::agent_destroy_capability_sibling)
        .transpose()?
        .as_deref()
        .map(ready_file_temp_path)
        .transpose()?;
    let provisional_dev_identity_temp = if prepared_database_path.is_none() {
        args.ready_file
            .as_deref()
            .map(crate::dev_identity::dev_identity_capability_sibling)
            .transpose()?
            .as_deref()
            .map(ready_file_temp_path)
            .transpose()?
    } else {
        None
    };
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
    if let Some(path) = provisional_agent_destroy_temp {
        provisional_paths.push(ManagedPath {
            label: "agent destroy capability temporary artifact",
            path,
        });
    }
    if let Some(path) = provisional_dev_identity_temp {
        provisional_paths.push(ManagedPath {
            label: "developer identity capability temporary artifact",
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
    let agent_destroy_capability_file = ready_path
        .as_deref()
        .map(crate::admin_agent_destroy::agent_destroy_capability_sibling)
        .transpose()?;
    let agent_destroy_temp_path = agent_destroy_capability_file
        .as_deref()
        .map(ready_file_temp_path)
        .transpose()?;
    let dev_identity_capability_file = prepared_database_path
        .as_deref()
        .or(ready_path.as_deref())
        .map(crate::dev_identity::dev_identity_capability_sibling)
        .transpose()?;
    let dev_identity_temp_path = if prepared_database_path.is_none() {
        dev_identity_capability_file
            .as_deref()
            .map(ready_file_temp_path)
            .transpose()?
    } else {
        None
    };
    let rehearsal_capability_file = ready_path
        .as_deref()
        .map(crate::auth::rehearsal::rehearsal_capability_sibling)
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
    if let Some(path) = &agent_destroy_temp_path {
        managed_paths.push(ManagedPath {
            label: "agent destroy capability temporary artifact",
            path: path.clone(),
        });
    }
    if let Some(path) = &dev_identity_temp_path {
        managed_paths.push(ManagedPath {
            label: "developer identity capability temporary artifact",
            path: path.clone(),
        });
    }
    if let Some(path) = &rehearsal_capability_file {
        managed_paths.push(ManagedPath {
            label: "auth rehearsal capability",
            path: path.clone(),
        });
    }
    validate_path_disjointness(&managed_paths)?;

    // @ref LLP 0262#d1-the-dev-identity-capability —
    // production never mints or consumes the developer-identity capability;
    // even a stale anchor is an operator-visible startup refusal.
    if startup_profile == ServerProfile::Prod {
        if let Some(sidecar) = dev_identity_capability_file.as_deref() {
            crate::dev_identity::ensure_production_sidecar_absent(sidecar)?;
        }
    }

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
                        startup_resolution,
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
    // The visibility-governance reader consumes the same closed profile fact
    // the transport adapter resolved from bind + declared exposure. Neither a
    // generated carrier nor its target config can self-declare this posture.
    // @ref LLP 0234#d4--production-authority-expires-fixtures-cannot-become-production
    let engine_app_state_bindings =
        snapback.claim_app_state_graph(startup_profile, args.auth_deployment)?;
    let derived_fork_boot = snapback.is_derived_fork();
    let derived_fork_lineage = snapback.derived_fork_identity().cloned();
    debug_assert_eq!(derived_fork_boot, derived_fork_lineage.is_some());

    // Assemble exactly one provider before listener bind. This is inspection,
    // not activation: an uninitialized catalog remains dormant and no keyring
    // is minted; a marked catalog validates only its existing sibling.
    // @ref LLP 0057#activation-ordering — startup never activates the auth catalog or replaces a lost ReadyV1 keyring.
    if startup_profile == ServerProfile::Prod {
        if snapback.auth_rehearsal_state_present_at_open()? {
            return Err(anyhow::Error::new(crate::auth::rehearsal::state_present()));
        }
        if let Some(rehearsal_sidecar) = rehearsal_capability_file.as_deref() {
            match std::fs::symlink_metadata(rehearsal_sidecar) {
                Ok(_) => {
                    return Err(anyhow::Error::new(
                        crate::auth::rehearsal::config_forbidden(),
                    ));
                }
                Err(error) if error.kind() == ErrorKind::NotFound => {}
                Err(error) => return Err(error.into()),
            }
        }
    }
    // Resolve the one carrier once. Its ordinary auth-mode barrier below still
    // owns validation and commit, while provider construction must already use
    // the policy selected for this first boot rather than the dormant schema.
    let auth_startup_artifacts =
        resolve_auth_startup_artifacts(&args, embedded_startup_artifacts.as_ref());
    let startup_password_minimum_length = auth_startup_artifacts
        .as_ref()
        .ok()
        .and_then(|carrier| carrier.as_ref())
        .map(|carrier| carrier.schema.effective_auth_password_minimum_length())
        .unwrap_or_else(|| {
            snapback
                .served_schema_manifest()
                .effective_auth_password_minimum_length()
        });
    let mut auth_runtime = crate::auth::runtime::AuthRuntime::inspect_with_password_minimum(
        &mut snapback,
        database_path.as_deref(),
        crate::auth::runtime::provider_profile(startup_profile),
        startup_password_minimum_length,
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
                    snapback.execute_auth_plan(crate::auth::lifecycle::apply_declared_restore_plan(
                        maintenance.mailbox(),
                        &declaration_path,
                        declaration_id,
                        provider.now_ms(),
                    ))
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
    let mut server_context =
        ServerContext::new_with_startup_resolution(bind_ip.to_string(), 0, startup_resolution)
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
    let (agent_destroy_capabilities, agent_destroy_operator) =
        if server_context.profile == crate::contract_types::ServerProfile::Prod {
            let (registry, operator) =
                crate::admin_agent_destroy::AgentDestroyCapabilityRegistry::generate(
                    startup_nonce.clone(),
                    &crate::auth::crypto::OsRandom,
                )
                .context("failed to generate the process-bound agent destroy capability")?;
            (Some(registry), Some(operator))
        } else {
            (None, None)
        };
    // @ref LLP 0262#d1-the-dev-identity-capability —
    // one startup-nonce-bound capability is minted for every non-production
    // serve boot and handed off on the same anchor ladder as the admin token.
    let (dev_identity_capabilities, dev_identity_operator) = if server_context.profile
        != crate::contract_types::ServerProfile::Prod
    {
        let (registry, operator) = crate::dev_identity::DevIdentityCapabilityRegistry::generate(
            startup_nonce.clone(),
            dev_identity_capability_file.clone(),
            &crate::auth::crypto::OsRandom,
        )
        .context("failed to generate the process-bound developer identity capability")?;
        (Some(registry), Some(operator))
    } else {
        (None, None)
    };
    let secret_read_root_file = ready_path.as_deref().map(secret_read_root_sibling);
    let secret_read_proof_root = match (ready_target.as_ref(), secret_read_root_file.as_ref()) {
        (Some(target), Some(path)) => Some(target.resolve_secret_read_proof_root(path)?),
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
    #[cfg(all(test, not(feature = "cli-owner")))]
    let auth_coordinator_receipt = match args.auth_construction_failure {
        Some(AuthConstructionFailure::Coordinator) => {
            auth_coordinator_receipt.fail_before_build_for_test()
        }
        _ => auth_coordinator_receipt,
    };
    #[cfg(all(test, not(feature = "cli-owner")))]
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
        auth_startup_artifacts,
        &mut snapback,
        &mut auth_runtime,
        &auth_program_readiness,
    )
    .await
    {
        Ok(state) => state,
        Err(error) => {
            emit_startup_artifact_refusal(&error);
            if args.derived_fork_arm_writer_coverage {
                return Err(anyhow::anyhow!("SNAPBACK_FORK_LOAD_FAILED: {error}"));
            }
            return Err(error.into());
        }
    };
    let password_provider_readiness = snapback
        .auth_password_provider_readiness()
        .map_err(anyhow::Error::new)?;
    if args.derived_fork_arm_writer_coverage {
        // @ref LLP 0058#cold-startup-artifact-carrier — the complete pair is
        // active before the fork-specific coverage cut.
        // @ref LLP 0165#derived-fork-authorizer-backed-net-diff--2026-08-06 —
        // arm the process-owned connection at the fork point before bind.
        startup_blocking(|| snapback.arm_open_derived_fork_app_row_coverage(now_ms()))
            .map_err(anyhow::Error::new)?;
    }
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
        let issuer = snapback
            .install_authenticated_auth_invalidation(&auth_runtime.provider(), None)
            .map_err(anyhow::Error::new)?;
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
    let app_state = AppState::try_new_for_server_startup(
        state.clone(),
        read_lane,
        ephemeral.clone(),
        server_context,
        engine_app_state_bindings,
        secret_read_proof_root,
        startup_nonce.clone(),
    )
    .map_err(anyhow::Error::new)?;
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
    let (app_state, hosted_admission_renewal) = match verified_hosted_admission {
        Some(admission) => {
            let (state, renewal) = app_state
                .with_hosted_edge_admission(admission)
                .await
                .map_err(anyhow::Error::new)?;
            (state, Some(renewal))
        }
        None => (app_state, None),
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
    let startup_network_profile = {
        let profile = startup_network_profile_env.as_deref().map_or_else(
            || Ok(crate::network_profile::NetworkConditionProfile::normal()),
            crate::network_profile::NetworkConditionProfile::parse_env,
        )?;
        let mut snapback = state.lock().await;
        snapback
            .activate_startup_network_profile(profile)
            .map_err(anyhow::Error::new)?
    };
    // @ref LLP 0098#24-renewal-and-the-honest-cost-of-pre-signing — an admission
    // lives at most five minutes, so a deployment that serves longer needs its
    // authority replaced in place. The loop only ever installs another
    // independently verified snapshot; when the document stops covering the
    // clock it installs nothing and the incumbent expires, so withdrawal is
    // composed with rather than suppressed.
    if let Some(renewal) = hosted_admission_renewal {
        app_state.spawn_hosted_edge_admission_renewal(renewal);
    }
    let app_state = app_state
        .with_auth_runtime(&auth_runtime, auth_coordinator.clone())
        .map_err(anyhow::Error::new)?;
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
    )
    .with_password_provider(password_provider_readiness);
    let app_state = app_state
        .with_auth_runtime_facts(auth_mode_state.clone(), auth_program_readiness.clone())
        .map_err(anyhow::Error::new)?;
    let app_state = match impersonation_capabilities {
        Some(registry) => app_state.with_impersonation_capabilities(registry),
        None => app_state,
    };
    let app_state = match dev_identity_capabilities {
        Some(registry) => app_state.with_dev_identity_capabilities(registry),
        None => app_state,
    };
    let mut app_state = match agent_destroy_capabilities {
        Some(registry) => app_state.with_agent_destroy_capabilities(registry),
        None => app_state,
    };
    // The serving AppState and evaluation task share this exact coalescer. A
    // kill-switched server, detached router, or embedder carries no writer gate
    // and preserves the legacy mutex behavior.
    let live_scheduler_enabled = (auth_mode_state.app_data_availability
        == crate::auth::mode::AppDataAvailability::Available)
        && !server::live_coalesce_disabled(
            std::env::var("SNAPBACK_LIVE_COALESCE_DISABLED")
                .ok()
                .as_deref(),
        )
        && !server::live_scheduler_disabled(
            std::env::var("SNAPBACK_LIVE_SCHEDULER_DISABLED")
                .ok()
                .as_deref(),
        );
    let live_fanout_coalescer = live_scheduler_enabled.then(|| {
        let tunables = crate::live_coalesce::LiveCoalesceTunables {
            max_eval_turn: server::live_max_eval_turn(
                std::env::var("SNAPBACK_LIVE_MAX_EVAL_TURN_MS")
                    .ok()
                    .as_deref(),
            ),
            ..crate::live_coalesce::LiveCoalesceTunables::default()
        };
        std::sync::Arc::new(crate::live_coalesce::LiveFanoutCoalescer::with_tunables(
            tunables,
        ))
    });
    if let Some(coalescer) = &live_fanout_coalescer {
        app_state = app_state.with_live_fanout_coalescer(coalescer.clone());
    }
    // Consume the connection-binding construction receipt before acquiring a
    // socket. `SnapbackApp::bind` later installs listener-owned transport
    // posture into this already-complete application.
    // @ref LLP 0059#handshake-and-activation — construction failure precedes socket acquisition.
    let app = connection_binding_receipt.build(app_state.clone());
    // The expiry authority is process-critical in sessions mode. Construct it,
    // wait for its running handshake, and only then bind any listener.
    // @ref LLP 0059#startup-rebuild-and-deadline-derivation — a sessions
    //   listener cannot exist without a supervised terminal worker.
    let mut auth_expiry_worker = app_state
        .spawn_auth_expiry_worker(
            two_phase_revocation_receipt,
            state.clone(),
            auth_coordinator.clone(),
        )
        .await
        .map_err(anyhow::Error::new)?;
    let listener =
        match bind_listener(&bind_ip.to_string(), args.port, args.port_range.clone()).await {
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
    // @ref LLP 0188#2-integration-point-the-whole-instance-database — attach and validate the local
    // sidecar, fixed head, and remote LTX prefix before the listener can be
    // published or serve. The dedicated runtime owns every later checkpoint.
    let mut replication_runtime = match (database_path.clone(), replication_config) {
        (Some(database), Some(config)) => {
            match crate::replication::ReplicationRuntime::start(database, config).await {
                Ok(runtime) => Some(runtime),
                Err(error) => {
                    auth_expiry_worker.abort();
                    return Err(anyhow::Error::new(error));
                }
            }
        }
        _ => None,
    };

    // @ref LLP 0017#serving-model — capture the bound address so the admin API
    // reports host/port/uptime and gates by loopback vs non-loopback.
    debug_assert_eq!(loopback, local_addr.ip().is_loopback());
    let published_server_context = Arc::make_mut(&mut app_state.server);
    published_server_context.record_bound_tokio_listener(&listener)?;
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
    if let Some(operator) = agent_destroy_operator {
        if let Some(target) = ready_target.as_mut() {
            let ready_file = target.pinned_path().to_path_buf();
            let temporary = agent_destroy_temp_path
                .as_deref()
                .context("agent destroy sidecar temporary path was not allocated")?;
            let path = operator
                .publish_with(&ready_file, |path, bytes| {
                    target.publish_owner_only_sibling_atomic(path, temporary, bytes)
                })
                .with_context(|| {
                    format!(
                        "failed to publish owner-only agent destroy capability for {}",
                        ready_file.display()
                    )
                })?;
            anyhow::ensure!(
                agent_destroy_capability_file.as_deref() == Some(path.as_path()),
                "agent destroy publisher returned a non-mechanical sidecar path"
            );
        } else {
            emit_agent_destroy_capability_to_controlling_terminal(operator)
                .map_err(|_| anyhow::Error::new(ready_descriptor_required_error()))?;
        }
    }
    let mut database_dev_identity_sidecar = None;
    let mut dev_identity_capability_file_display = None;
    if let Some(operator) = dev_identity_operator {
        if let Some(database) = database_path.as_deref() {
            let sidecar = operator
                .publish_database_sidecar(database)
                .with_context(|| {
                    format!(
                        "failed to publish owner-only developer identity capability for {}",
                        database.display()
                    )
                })?;
            anyhow::ensure!(
                dev_identity_capability_file.as_deref() == Some(sidecar.path()),
                "developer identity publisher returned a non-mechanical database sidecar path"
            );
            dev_identity_capability_file_display = Some(sidecar.path().display().to_string());
            database_dev_identity_sidecar = Some(sidecar);
        } else if let Some(target) = ready_target.as_mut() {
            let ready_file = target.pinned_path().to_path_buf();
            let temporary = dev_identity_temp_path
                .as_deref()
                .context("developer identity sidecar temporary path was not allocated")?;
            let path = operator
                .publish_with(&ready_file, |path, bytes| {
                    target.publish_owner_only_sibling_atomic(path, temporary, bytes)
                })
                .with_context(|| {
                    format!(
                        "failed to publish owner-only developer identity capability for {}",
                        ready_file.display()
                    )
                })?;
            anyhow::ensure!(
                dev_identity_capability_file.as_deref() == Some(path.as_path()),
                "developer identity publisher returned a non-mechanical ready-file sidecar path"
            );
            dev_identity_capability_file_display = Some(path.display().to_string());
        } else {
            emit_dev_identity_capability_to_controlling_terminal(operator)
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
            dev_identity_capability_file: dev_identity_capability_file_display.clone(),
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
        // @ref LLP 0017#security-defaults — the freshly minted credential is
        // visible only on an interactive terminal; captured stdout gets the
        // owner-only file hand-off instead.
        println!("admin: writes require the minted local admin token (SNAPBACK_ADMIN_TOKEN unset)");
        print_minted_admin_token_handoff(minted);
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
    // The evaluation scheduler subsumes the old coalescing backstop. Either
    // compatibility switch leaves the scheduler absent, which is the exact
    // legacy-inline boundary used by direct callers and A/B runs.
    let live_fanout_backstop = if let Some(coalescer) = live_fanout_coalescer {
        let installed = coalescer.clone();
        server::with_snapback(&state, move |snapback| {
            snapback.install_live_fanout_coalescer(installed);
        })
        .await;
        Some(server::spawn_live_fanout_backstop(state.clone(), coalescer))
    } else {
        None
    };
    let maintenance_worker = server::spawn_maintenance_worker(app_state.clone());
    let auth_maintenance_worker = app_state.spawn_auth_gc_worker(
        state.clone(),
        auth_runtime.clone(),
        auth_coordinator.clone(),
        auth_gc_initial_delay,
    );
    let server = app
        .bind(listener)?
        .serve_with_graceful_shutdown(shutdown_signal());
    tokio::pin!(server);
    let fork_expiry = wait_for_derived_fork_expiry(database_path.clone(), derived_fork_lineage);
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
    if let Some(backstop) = live_fanout_backstop {
        backstop.abort();
    }
    maintenance_worker.abort();
    if let Some(worker) = auth_maintenance_worker {
        worker.abort();
    }
    auth_expiry_worker.abort();

    // @ref LLP 0003#server-responsibilities — graceful shutdown drains WAL
    // readers and checkpoints the file-backed store before releasing its
    // process lock. SNAPBACK_SHUTDOWN_CHECKPOINT_TIMEOUT_MS overrides the
    // 30-second default; zero and unparseable values retain the default.
    let checkpoint_bound = std::env::var("SNAPBACK_SHUTDOWN_CHECKPOINT_TIMEOUT_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .map_or_else(|| Duration::from_millis(30_000), Duration::from_millis);
    if let Some(runtime) = replication_runtime.take() {
        // @ref LLP 0188#2-integration-point-the-whole-instance-database —
        // reader-pool drain precedes the replication owner's final ship and
        // checkpoint; the ordinary storage checkpoint is forbidden here.
        match tokio::time::timeout(checkpoint_bound, state.lock()).await {
            Ok(snapback) => {
                for problem in snapback.prepare_replication_shutdown() {
                    eprintln!("SNAPBACK_SHUTDOWN_WAL_CHECKPOINT_INCOMPLETE: {problem}");
                }
            }
            Err(_) => eprintln!(
                "SNAPBACK_SHUTDOWN_WAL_CHECKPOINT_INCOMPLETE: the writer connection stayed locked for {}ms before replication shutdown",
                checkpoint_bound.as_millis()
            ),
        }
        match tokio::time::timeout(checkpoint_bound, runtime.shutdown()).await {
            Ok(Ok(_)) => {}
            Ok(Err(error)) => eprintln!(
                "SNAPBACK_REPLICATION_SHUTDOWN_FAILED: {}: {}",
                error.diagnostic.code, error.diagnostic.message
            ),
            Err(_) => eprintln!(
                "SNAPBACK_REPLICATION_SHUTDOWN_FAILED: final ship/checkpoint exceeded {}ms",
                checkpoint_bound.as_millis()
            ),
        }
    } else {
        // A task aborted a moment ago can still hold the writer mutex until its
        // future is dropped, so bound the acquisition too: a shutdown that cannot
        // reach the connection must say so, never hang holding SIGTERM open.
        match tokio::time::timeout(checkpoint_bound, state.lock()).await {
            Ok(snapback) => {
                let report = startup_blocking(|| snapback.shutdown_checkpoint(checkpoint_bound));
                if report.applicable && !report.complete {
                    eprintln!(
                        "SNAPBACK_SHUTDOWN_WAL_CHECKPOINT_INCOMPLETE: {}",
                        report.summary()
                    );
                }
            }
            Err(_) => eprintln!(
                "SNAPBACK_SHUTDOWN_WAL_CHECKPOINT_INCOMPLETE: the writer connection stayed locked for \
                 {}ms; the store keeps its WAL sidecar",
                checkpoint_bound.as_millis()
            ),
        }
    }
    drop(database_lock);
    if let Some(sidecar) = database_dev_identity_sidecar.as_mut() {
        let _ = sidecar.remove_if_current();
    }
    if let Some(target) = ready_target.as_ref() {
        let _ = target.remove_impersonation_capability();
        let _ = target.remove_agent_destroy_capability();
        let _ = target.remove_dev_identity_capability();
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
    startup_resolution: crate::admin::ServerStartupResolution,
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
        ServerContext::new_with_startup_resolution(bind_ip.to_string(), 0, startup_resolution)
            .with_auth_deployment(args.auth_deployment);

    // Profiles that can never expose recovery fail before token minting or any
    // other startup publication.
    if matches!(
        server_context.profile,
        crate::contract_types::ServerProfile::Demo | crate::contract_types::ServerProfile::Prod
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
    let listener = bind_listener(&bind_ip.to_string(), args.port, args.port_range.clone()).await?;
    let local_addr = listener.local_addr()?;
    anyhow::ensure!(
        local_addr.ip().is_loopback(),
        "SNAPBACK_AUTH_TABLE_COLLISION: auth collision recovery refused a non-loopback listener"
    );
    server_context.record_bound_tokio_listener(&listener)?;
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
                    crate::contract_types::ServerProfile::Dev => {
                        crate::manifest::TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned()
                    }
                    crate::contract_types::ServerProfile::Test => {
                        "local-test-sqlite-ibex".to_owned()
                    }
                    crate::contract_types::ServerProfile::Demo
                    | crate::contract_types::ServerProfile::Prod => {
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
            dev_identity_capability_file: None,
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
        print_minted_admin_token_handoff(minted);
    } else {
        println!("admin: auth recovery requires SNAPBACK_ADMIN_TOKEN");
    }

    let server_result = crate::auth::recovery::serve(runtime, listener, shutdown_signal()).await;
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
pub(crate) struct ManagedPath {
    pub(crate) label: &'static str,
    pub(crate) path: PathBuf,
}

pub(crate) fn managed_startup_paths(
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
                path: crate::store_state::path_with_filename_suffix(&telemetry, suffix)?,
            });
        }
        paths.push(ManagedPath {
            label: "admin token",
            path: crate::admin::admin_token_sibling(database),
        });
        paths.push(ManagedPath {
            label: "developer identity capability",
            path: crate::dev_identity::dev_identity_capability_sibling(database)?,
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
                path: crate::store_state::path_with_filename_suffix(database, suffix)?,
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
        paths.push(ManagedPath {
            label: "agent destroy capability",
            path: crate::admin_agent_destroy::agent_destroy_capability_sibling(ready_file)?,
        });
        if database.is_none() {
            paths.push(ManagedPath {
                label: "developer identity capability",
                path: crate::dev_identity::dev_identity_capability_sibling(ready_file)?,
            });
        }
    }
    Ok(paths)
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

#[derive(Clone, Copy)]
enum ManagedProcessCapabilityKind {
    Impersonation,
    AgentDestroy,
    DevIdentity,
}

impl ManagedProcessCapabilityKind {
    fn for_ready_sibling(ready_file: &Path, path: &Path) -> std::io::Result<Self> {
        if crate::admin_impersonation::impersonation_capability_sibling(ready_file)? == path {
            return Ok(Self::Impersonation);
        }
        if crate::admin_agent_destroy::agent_destroy_capability_sibling(ready_file)? == path {
            return Ok(Self::AgentDestroy);
        }
        if crate::dev_identity::dev_identity_capability_sibling(ready_file)? == path {
            return Ok(Self::DevIdentity);
        }
        Err(std::io::Error::new(
            ErrorKind::InvalidInput,
            "path is not a registered process capability sibling",
        ))
    }

    fn maximum_file_bytes(self) -> usize {
        match self {
            Self::Impersonation => {
                crate::admin_impersonation::MAX_IMPERSONATION_CAPABILITY_FILE_BYTES
            }
            Self::AgentDestroy => {
                crate::admin_agent_destroy::MAX_AGENT_DESTROY_CAPABILITY_FILE_BYTES
            }
            Self::DevIdentity => crate::dev_identity::MAX_DEV_IDENTITY_CAPABILITY_FILE_BYTES,
        }
    }

    fn validate_existing(self, bytes: zeroize::Zeroizing<Vec<u8>>) -> std::io::Result<()> {
        let valid = match self {
            Self::Impersonation => {
                crate::admin_impersonation::parse_impersonation_capability_file(bytes).map(|_| ())
            }
            Self::AgentDestroy => {
                crate::admin_agent_destroy::parse_agent_destroy_capability_file(bytes).map(|_| ())
            }
            Self::DevIdentity => {
                crate::dev_identity::parse_dev_identity_capability_file(bytes).map(|_| ())
            }
        };
        valid.map_err(|_| {
            std::io::Error::new(
                ErrorKind::InvalidData,
                "existing process capability sidecar is not a canonical process bearer",
            )
        })
    }
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
    agent_destroy_identity: Option<(PathBuf, (u64, u64))>,
    dev_identity_identity: Option<(PathBuf, (u64, u64))>,
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
            agent_destroy_identity: None,
            dev_identity_identity: None,
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

    fn resolve_secret_read_proof_root(
        &self,
        path: &Path,
    ) -> anyhow::Result<crate::admin_secret_read::SecretReadProofRoot> {
        self.ensure_parent_path_identity()?;
        self.sibling_name(path)?;
        #[cfg(unix)]
        let pinned_parent = Some(&self.parent);
        #[cfg(not(unix))]
        let pinned_parent = None;
        crate::admin_secret_read::resolve_secret_read_proof_root_for_pinned_sibling(
            pinned_parent,
            path,
        )
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
        let capability_kind =
            ManagedProcessCapabilityKind::for_ready_sibling(&self.pinned_path, path)?;
        let prior_identity =
            self.validated_process_capability_destination(path, capability_kind)?;
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
                    "process capability sidecar temporary inode changed during publication",
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
                        "process capability sidecar destination changed during atomic replacement",
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
                        "displaced process capability sidecar could not be removed safely",
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
        match capability_kind {
            ManagedProcessCapabilityKind::Impersonation => {
                self.impersonation_identity = Some((path.to_path_buf(), identity));
            }
            ManagedProcessCapabilityKind::AgentDestroy => {
                self.agent_destroy_identity = Some((path.to_path_buf(), identity));
            }
            ManagedProcessCapabilityKind::DevIdentity => {
                self.dev_identity_identity = Some((path.to_path_buf(), identity));
            }
        }
        Ok(())
    }

    #[cfg(unix)]
    fn validated_process_capability_destination(
        &self,
        path: &Path,
        capability_kind: ManagedProcessCapabilityKind,
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
            || metadata.len() > capability_kind.maximum_file_bytes() as u64
        {
            return Err(std::io::Error::new(
                ErrorKind::PermissionDenied,
                "existing process capability sidecar is not a strict owner-only regular file",
            ));
        }
        let mut bytes = zeroize::Zeroizing::new(Vec::new());
        file.by_ref()
            .take(capability_kind.maximum_file_bytes() as u64 + 1)
            .read_to_end(&mut bytes)?;
        capability_kind.validate_existing(bytes)?;
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

    fn remove_agent_destroy_capability(&self) -> std::io::Result<()> {
        let Some((path, identity)) = self.agent_destroy_identity.as_ref() else {
            return Ok(());
        };
        self.remove_sibling_if_identity(path, *identity)
    }

    fn remove_dev_identity_capability(&self) -> std::io::Result<()> {
        let Some((path, identity)) = self.dev_identity_identity.as_ref() else {
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
        let _ = self.remove_agent_destroy_capability();
        let _ = self.remove_dev_identity_capability();
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

fn parse_port_range(value: &str) -> Result<RangeInclusive<u16>, String> {
    let (lo, hi) = value
        .split_once('-')
        .ok_or_else(|| "port range must have the form <lo>-<hi>".to_owned())?;
    if lo.is_empty() || hi.is_empty() || hi.contains('-') {
        return Err("port range must have the form <lo>-<hi>".to_owned());
    }
    let lo = lo
        .parse::<u16>()
        .map_err(|_| "port range lower bound must be from 1 through 65535".to_owned())?;
    let hi = hi
        .parse::<u16>()
        .map_err(|_| "port range upper bound must be from 1 through 65535".to_owned())?;
    if lo == 0 || hi == 0 {
        return Err("port range bounds must be from 1 through 65535".to_owned());
    }
    if lo > hi {
        return Err("port range lower bound must not exceed its upper bound".to_owned());
    }
    Ok(lo..=hi)
}

async fn bind_listener(
    host: &str,
    port: Option<u16>,
    port_range: Option<RangeInclusive<u16>>,
) -> anyhow::Result<TcpListener> {
    if let Some(port) = port {
        return TcpListener::bind((host, port))
            .await
            .with_context(|| format!("failed to bind Snapback server to {host}:{port}"));
    }

    // @ref LLP 0010#required-tool-surfaces — normal local startup should tolerate
    // multiple Snapback instances by scanning the default dev range; explicit
    // `--port` remains a pinned automation contract.
    bind_first_available(
        host,
        port_range.unwrap_or(DEFAULT_PORT_RANGE_START..=DEFAULT_PORT_RANGE_END),
    )
    .await
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
#[path = "cli/tests.rs"]
mod tests;

#[path = "cli/migration.rs"]
mod migration;
pub(crate) use migration::migrate_command;
#[cfg(test)]
pub(crate) use migration::{validate_approval_authorization, wall_clock_now_ms};
