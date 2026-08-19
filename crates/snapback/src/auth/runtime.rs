//! Serve-time composition for the auth provider.
//!
//! This module deliberately inspects, but never activates, the protected
//! catalog. Item 4 owns staged activation; ordinary startup only assembles one
//! provider, reports its closed readiness fact, and coordinates lifecycle work
//! ahead of the outer app-instance lock.
//!
//! @ref LLP 0057#activation-ordering — ordinary startup never creates a
//! catalog or replaces a missing keyring for an already-marked catalog.
//! @ref LLP 0057#garbage-collection — every recognized catalog runs bounded
//! startup and 30-second maintenance passes; an uninitialized catalog stays dormant.
//! @ref LLP 0057#concurrency-locks-and-linearization — exclusive auth
//! maintenance is acquired before the outer app-instance/database lock.
//! @ref LLP 0057#security-and-redaction — readiness exposes one closed public
//! fact and a redacted diagnostic, never keyring details.

#[cfg(test)]
use crate::remainder_adapter::RemainderLocalSnapbackExt as _;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::sync::oneshot;
use tokio::task::JoinHandle;

use super::coordinator::AuthCoordinator;
use super::keyring::{AuthKeyringStore, KeyringError};
use super::lifecycle::AUTH_GC_INTERVAL;
use super::provider::{
    AuthGcPass, AuthProvider, AuthProviderReadiness, ProviderError, ProviderResult,
};
use super::session_projection::{
    AuthorizationStreamRecord, DueExpiryFinalization, ExpiredSession, ProjectionSource,
    SessionProjection,
};
use crate::contract_types::AuthProviderProfile;
use crate::diagnostic::{Diagnostic, SnapbackError, SnapbackResult};
use crate::local::LocalSnapback;
use crate::server::SharedSnapback;
use crate::storage::auth::AuthCatalogState;

/// Closed, public provider posture. `Dormant` means the catalog is
/// uninitialized; it is not an availability failure and startup must not turn
/// it into one by touching the keyring.
#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AuthProviderHealth {
    #[default]
    Dormant,
    Available,
    Unavailable,
}

/// A linear construction plan for the real process-local expiry authority.
/// Production consumes this same value to spawn the worker whose provider is
/// bound here; it is not a freely minted readiness flag.
pub(crate) struct TwoPhaseRevocationConstructionReceipt {
    provider: Arc<AuthProvider>,
    #[cfg(test)]
    fail_before_ready: bool,
}

/// A construction plan bound to one inspected runtime/provider. Production
/// uses it for the actual durable projection rebuild before listener bind.
pub(crate) struct AuthCoordinatorConstructionReceipt {
    provider: Arc<AuthProvider>,
    _canonical_client_module: &'static [u8],
    #[cfg(test)]
    fail_before_build: bool,
}

pub(crate) struct AuthCoordinatorInstalledReceipt {
    _private: (),
}

impl TwoPhaseRevocationConstructionReceipt {
    pub(crate) async fn spawn(
        self,
        state: SharedSnapback,
        coordinator: Arc<AuthCoordinator>,
        terminal_sink: AuthExpiryTerminalSink,
    ) -> SnapbackResult<AuthExpiryWorker> {
        #[cfg(test)]
        if self.fail_before_ready {
            return spawn_failed_auth_expiry_worker_for_test().await;
        }
        spawn_auth_expiry_worker(state, coordinator, self.provider, terminal_sink).await
    }

    #[cfg(test)]
    pub(crate) fn fail_before_ready_for_test(mut self) -> Self {
        self.fail_before_ready = true;
        self
    }
}

impl AuthCoordinatorConstructionReceipt {
    pub(crate) fn build(
        self,
        runtime: &AuthRuntime,
        snapback: &mut LocalSnapback,
    ) -> SnapbackResult<(Arc<AuthCoordinator>, AuthCoordinatorInstalledReceipt)> {
        #[cfg(test)]
        if self.fail_before_build {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE",
                "auth",
                "injected auth coordinator construction failure",
            ));
        }
        if !Arc::ptr_eq(&self.provider, &runtime.provider) {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE",
                "auth",
                "auth coordinator construction plan does not match the inspected runtime",
            ));
        }
        Ok((
            runtime.build_coordinator(snapback)?,
            AuthCoordinatorInstalledReceipt { _private: () },
        ))
    }

    #[cfg(test)]
    pub(crate) fn fail_before_build_for_test(mut self) -> Self {
        self.fail_before_build = true;
        self
    }
}

/// Infallible, clone-shared bridge from projection expiry to server terminal
/// propagation. Expiry has already become authoritative when this callback
/// runs, so making the callback fallible would create an unretryable state in
/// which the one-shot `ExpiredSession` output was discarded.
#[derive(Clone)]
pub(crate) struct AuthExpiryTerminalSink {
    consume: Arc<dyn Fn(Vec<ExpiredSession>) + Send + Sync>,
}

impl AuthExpiryTerminalSink {
    pub(crate) fn new(consume: impl Fn(Vec<ExpiredSession>) + Send + Sync + 'static) -> Self {
        Self {
            consume: Arc::new(consume),
        }
    }

    fn consume(&self, expired: Vec<ExpiredSession>) {
        (self.consume)(expired);
    }

    #[cfg(test)]
    pub(crate) fn consume_for_test(&self, expired: Vec<ExpiredSession>) {
        self.consume(expired);
    }

    #[cfg(test)]
    fn noop() -> Self {
        Self::new(drop)
    }
}

pub(crate) struct AuthExpiryWorker {
    handle: JoinHandle<SnapbackResult<()>>,
}

impl AuthExpiryWorker {
    /// Resolve only when the process-critical worker stops. Callers race this
    /// against the listener and fail the process closed on either an explicit
    /// projection error or a task panic/cancellation.
    pub(crate) async fn stopped(&mut self) -> SnapbackResult<()> {
        (&mut self.handle).await.map_err(|_| {
            SnapbackError::error(
                "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE",
                "auth",
                "the process-local session expiry worker stopped unexpectedly",
            )
        })?
    }

    pub(crate) fn abort(&self) {
        self.handle.abort();
    }
}

impl Drop for AuthExpiryWorker {
    fn drop(&mut self) {
        self.handle.abort();
    }
}

/// The one provider assembled for a serve process, plus the catalog posture
/// that controls maintenance and public readiness.
#[derive(Clone)]
pub(crate) struct AuthRuntime {
    provider: Arc<AuthProvider>,
    catalog_ready: bool,
    startup_diagnostic: Option<Diagnostic>,
}

impl std::fmt::Debug for AuthRuntime {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("AuthRuntime")
            .field("health", &self.health())
            .field("catalog_ready", &self.catalog_ready)
            .field(
                "startup_diagnostic",
                &self.startup_diagnostic.as_ref().map(|value| &value.code),
            )
            .finish_non_exhaustive()
    }
}

impl AuthRuntime {
    /// Assemble one provider and inspect the catalog without mutating either
    /// catalog or keyring. A marked catalog validates only the existing ring;
    /// an uninitialized catalog does not even perform that read.
    #[allow(dead_code)] // Default-policy convenience retained for focused runtime tests.
    pub(crate) fn inspect(
        snapback: &mut LocalSnapback,
        database_path: Option<&Path>,
        profile: AuthProviderProfile,
    ) -> SnapbackResult<Self> {
        let password_minimum_length = snapback
            .served_schema_manifest()
            .effective_auth_password_minimum_length();
        Self::inspect_with_password_minimum(
            snapback,
            database_path,
            profile,
            password_minimum_length,
        )
    }

    /// Assemble the provider against the declaration selected for this boot.
    /// Startup carrier resolution happens before auth-mode composition, while
    /// its validation/commit still happens at the ordinary pre-bind barrier.
    // @ref LLP 0227#password-policy-declaration — password admission uses the
    // exact startup declaration, including on the first boot of a new app.
    pub(crate) fn inspect_with_password_minimum(
        snapback: &mut LocalSnapback,
        database_path: Option<&Path>,
        profile: AuthProviderProfile,
        password_minimum_length: u16,
    ) -> SnapbackResult<Self> {
        let keyring = Arc::new(match database_path {
            Some(path) => AuthKeyringStore::file_for_database(path),
            None => AuthKeyringStore::in_memory(),
        });
        let provider = Arc::new(
            AuthProvider::new_with_password_minimum(
                profile,
                keyring.clone(),
                password_minimum_length,
            )
            .map_err(ProviderError::into_snapback_error)?,
        );
        let catalog = match snapback.inspect_auth_catalog() {
            Ok(catalog) => catalog,
            // A foreign dormant table is deliberately recoverable through the
            // ordinary dev/test rescue host-op. It is not an auth-owned
            // catalog and must not make otherwise-valid startup fatal.
            Err(error) if error.diagnostic.code == "SNAPBACK_AUTH_TABLE_COLLISION" => {
                AuthCatalogState::Uninitialized
            }
            Err(error) => return Err(error),
        };
        let startup_diagnostic = match catalog {
            AuthCatalogState::Uninitialized => None,
            AuthCatalogState::ReadyV1
            | AuthCatalogState::ReadyV2
            | AuthCatalogState::ReadyV3
            | AuthCatalogState::ReadyV4 => match provider.readiness() {
                AuthProviderReadiness::Available => None,
                AuthProviderReadiness::Unavailable => Some(match database_path {
                    Some(database_path) => {
                        let error = match keyring.load_existing() {
                            Err(error) => error,
                            Ok(_) => KeyringError::Unavailable,
                        };
                        let keyring_path = AuthKeyringStore::keyring_path(database_path);
                        startup_provider_unavailable_diagnostic(&keyring_path, error)
                    }
                    None => provider_unavailable_diagnostic(),
                }),
            },
        };
        Ok(Self {
            provider,
            catalog_ready: catalog.is_ready(),
            startup_diagnostic,
        })
    }

    pub(crate) fn provider(&self) -> Arc<AuthProvider> {
        self.provider.clone()
    }

    pub(crate) fn two_phase_revocation_construction_receipt(
        &self,
    ) -> TwoPhaseRevocationConstructionReceipt {
        TwoPhaseRevocationConstructionReceipt {
            provider: self.provider(),
            #[cfg(test)]
            fail_before_ready: false,
        }
    }

    pub(crate) fn auth_coordinator_construction_receipt(
        &self,
    ) -> AuthCoordinatorConstructionReceipt {
        AuthCoordinatorConstructionReceipt {
            provider: self.provider(),
            // Bundle the canonical custody implementation without treating
            // source spelling as a readiness probe. Client protocol 1 still
            // requires its actual coordinator and mandatory kit participant.
            _canonical_client_module: include_bytes!(
                "../../../../packages/snapback-contract/auth-coordinator.mjs"
            ),
            #[cfg(test)]
            fail_before_build: false,
        }
    }

    /// Reserve and authenticate the process issuer before listener bind. The
    /// SQLite reservation commits first; authentication failure therefore
    /// burns a sequence and prevents serving rather than reusing it.
    #[cfg(test)]
    pub(crate) fn reserve_invalidation_boot_issuer(
        &self,
        snapback: &mut LocalSnapback,
        target_profile_id: &str,
        app_id: &str,
    ) -> ProviderResult<(
        crate::auth::invalidation::LiveInvalidationIssuer,
        crate::storage::AuthorizationVersion,
        String,
    )> {
        if !self.catalog_ready {
            return Err(
                crate::diagnostic::SnapbackError::new(provider_unavailable_diagnostic()).into(),
            );
        }
        let (authorization, version_stream, boot_sequence) = snapback
            .remainder_auth_database_mut()
            .reserve_invalidation_boot_issuer()?;
        let issuer_id = crate::auth::invalidation::IssuerId::fresh(
            authorization.incarnation.clone(),
            boot_sequence,
        )?;
        let issuer = self.provider.authenticate_invalidation_boot_issuer(
            issuer_id,
            target_profile_id,
            app_id,
        )?;
        Ok((issuer, authorization, version_stream))
    }

    pub(crate) fn health(&self) -> AuthProviderHealth {
        if !self.catalog_ready {
            return AuthProviderHealth::Dormant;
        }
        match self.provider.readiness() {
            AuthProviderReadiness::Available => AuthProviderHealth::Available,
            AuthProviderReadiness::Unavailable => AuthProviderHealth::Unavailable,
        }
    }

    pub(crate) fn catalog_ready(&self) -> bool {
        self.catalog_ready
    }

    /// Establish the durable clock floor before any startup operation can use
    /// time to restore, garbage-collect, rotate, or downgrade authority.
    pub(crate) fn seed_durable_clock_floor(
        &self,
        snapback: &mut LocalSnapback,
    ) -> SnapbackResult<()> {
        if self.catalog_ready {
            snapback.seed_auth_session_clock_floor(&self.provider)?;
        }
        Ok(())
    }

    /// Refresh the process fact after the staged-mode consume transaction has
    /// atomically installed the exact catalog and sessions mode. The provider
    /// object is intentionally retained; startup never assembles a second
    /// provider merely to observe its own committed activation.
    pub(crate) fn mark_catalog_ready_after_mode_activation(&mut self) {
        debug_assert_eq!(
            self.provider.readiness(),
            AuthProviderReadiness::Available,
            "catalog activation prepared a usable keyring before commit"
        );
        self.catalog_ready = true;
        self.startup_diagnostic = None;
    }

    #[cfg(test)]
    pub(crate) fn startup_diagnostic(&self) -> Option<&Diagnostic> {
        self.startup_diagnostic.as_ref()
    }

    pub(crate) fn startup_diagnostics(&self) -> Vec<Diagnostic> {
        self.startup_diagnostic.iter().cloned().collect()
    }

    /// Create/preserve the durable stream record and publish one complete
    /// detached projection before any listener binds. Dormant dev databases
    /// have an empty session topology but still participate in reset/restart
    /// incarnation continuity.
    ///
    /// @ref LLP 0059#startup-rebuild-and-deadline-derivation — migration,
    /// snapshot validation, invariant checking, and publication are pre-bind.
    ///
    /// Before deriving any deadline, advance and read the durable auth-clock
    /// floor and seed the provider's process-local floor from it. The
    /// projection is then rebuilt at `max(sample, durable_floor)`, so a
    /// backward wall-clock move across restart can never reclassify a session
    /// the previous process already terminalized as current again.
    ///
    /// @ref LLP 0059#durable-session-clock-floor — restart may under-extend but
    /// may never extend prior authority; the floor makes lifetime decisions
    /// fail closed under a lower epoch sample.
    pub(crate) fn build_coordinator(
        &self,
        snapback: &mut LocalSnapback,
    ) -> SnapbackResult<Arc<AuthCoordinator>> {
        snapback.build_auth_coordinator(&self.provider, self.catalog_ready)
    }

    /// Run the pre-bind pass against the still-locally-owned instance. A
    /// missing/corrupt keyring remains a provider readiness fact while this
    /// returns the committed durable result, including its retry schedule.
    pub(crate) async fn run_startup_gc(
        &self,
        snapback: &mut LocalSnapback,
    ) -> ProviderResult<Option<AuthGcPass>> {
        if !self.catalog_ready {
            return Ok(None);
        }
        let maintenance = self.provider.exclusive_maintenance().await;
        let now_ms = self.provider.now_ms();
        let pass = snapback.execute_auth_gc_plan(maintenance.gc_plan(now_ms), now_ms)?;
        Ok(Some(pass))
    }
}

/// One periodic pass with the protocol lock order made structural: exclusive
/// maintenance is held before `with_snapback` can acquire the outer mutex.
pub(crate) async fn run_periodic_gc_pass(
    state: &SharedSnapback,
    provider: Arc<AuthProvider>,
    coordinator: Arc<AuthCoordinator>,
    terminal_sink: &AuthExpiryTerminalSink,
) -> ProviderResult<AuthGcPass> {
    run_periodic_gc_pass_after_sample(state, provider, coordinator, terminal_sink, || {}).await
}

async fn run_periodic_gc_pass_after_sample<F>(
    state: &SharedSnapback,
    provider: Arc<AuthProvider>,
    coordinator: Arc<AuthCoordinator>,
    terminal_sink: &AuthExpiryTerminalSink,
    after_sample: F,
) -> ProviderResult<AuthGcPass>
where
    F: FnOnce(),
{
    terminalize_due_sessions_after_sample(
        state,
        &provider,
        &coordinator,
        terminal_sink,
        after_sample,
    )
    .await?;
    let maintenance = provider.exclusive_maintenance().await;
    let now_ms = provider.now_ms();
    crate::server::with_snapback(state, move |snapback| {
        snapback.execute_auth_gc_plan(maintenance.gc_plan(now_ms), now_ms)
    })
    .await
}

/// Persist the maximum epoch deadline of every currently due session before
/// process-local terminal publication. Persisting the sampled wall time alone
/// is insufficient when a monotonic deadline fires after the wall clock moved
/// backward.
///
/// @ref LLP 0059#durable-session-clock-floor — a crash after terminal
/// publication must rebuild at or beyond the terminal generation's deadline.
async fn terminalize_due_sessions(
    state: &SharedSnapback,
    provider: &Arc<AuthProvider>,
    coordinator: &Arc<AuthCoordinator>,
    terminal_sink: &AuthExpiryTerminalSink,
) -> ProviderResult<()> {
    terminalize_due_sessions_after_sample(state, provider, coordinator, terminal_sink, || {}).await
}

async fn terminalize_due_sessions_after_sample<F>(
    state: &SharedSnapback,
    provider: &Arc<AuthProvider>,
    coordinator: &Arc<AuthCoordinator>,
    terminal_sink: &AuthExpiryTerminalSink,
    after_sample: F,
) -> ProviderResult<()>
where
    F: FnOnce(),
{
    let sampled_epoch = provider.now_ms();
    let sampled_monotonic = provider.monotonic_now();
    let Some(batch) = coordinator
        .sample_due_expiries(sampled_epoch, sampled_monotonic)
        .map_err(ProviderError::from)?
    else {
        return Ok(());
    };
    after_sample();
    let durable_provider = provider.clone();
    let durable_batch = batch.clone();
    crate::server::with_snapback(state, move |snapback| {
        snapback.advance_auth_session_clock_floor_for_due_batch(&durable_provider, &durable_batch)
    })
    .await
    .map_err(ProviderError::from)?;
    let finalized = coordinator
        .expire_sampled_due(batch)
        .await
        .map_err(ProviderError::from)?;
    consume_due_expiry_finalization(terminal_sink, finalized)
}

/// Deliver every known terminal result before surfacing a contradictory batch
/// entry. The coordinator has already marked the projection globally closed;
/// the sink is infallible, so successful siblings cannot be lost to the error.
///
/// @ref LLP 0059#operation-specific-publication — Propagate precedes a
/// fail-closed batch error for every successfully finalized expiry.
fn consume_due_expiry_finalization(
    terminal_sink: &AuthExpiryTerminalSink,
    finalized: DueExpiryFinalization,
) -> ProviderResult<()> {
    let (expired, failed_closed) = finalized.into_parts();
    terminal_sink.consume(expired);
    if failed_closed {
        Err(ProviderError::from(SnapbackError::error(
            "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE",
            "auth",
            "sampled session expiry finalization failed closed",
        )))
    } else {
        Ok(())
    }
}

/// Recognized catalogs only: honor the startup pass's next delay, then run
/// forever. A full bounded batch retries immediately. Keyring unavailability is a successful
/// pass outcome, so it cannot discard the durable batch's retry signal; only a
/// true maintenance error waits for the next normal interval.
pub(crate) fn spawn_auth_gc_worker(
    state: SharedSnapback,
    runtime: AuthRuntime,
    coordinator: Arc<AuthCoordinator>,
    terminal_sink: AuthExpiryTerminalSink,
    initial_delay: Duration,
) -> Option<JoinHandle<()>> {
    if !runtime.catalog_ready {
        return None;
    }
    Some(tokio::spawn(async move {
        let mut delay = initial_delay;
        loop {
            tokio::time::sleep(delay).await;
            delay = match run_periodic_gc_pass(
                &state,
                runtime.provider(),
                coordinator.clone(),
                &terminal_sink,
            )
            .await
            {
                Ok(pass) => pass.next_delay(),
                Err(_) => AUTH_GC_INTERVAL,
            };
        }
    }))
}

/// Process-local expiry authority. The delay is capped by the projection at
/// one second; each wake samples both clocks and permanently terminalizes due
/// generations before later GC may delete their durable rows.
pub(crate) async fn spawn_auth_expiry_worker(
    state: SharedSnapback,
    coordinator: Arc<AuthCoordinator>,
    provider: Arc<AuthProvider>,
    terminal_sink: AuthExpiryTerminalSink,
) -> SnapbackResult<AuthExpiryWorker> {
    let (ready, running) = oneshot::channel();
    let handle = tokio::spawn(async move {
        let _ = ready.send(());
        loop {
            let monotonic_now = provider.monotonic_now();
            let delay = coordinator.expiry_scan_delay(monotonic_now)?;
            tokio::time::sleep(delay).await;
            terminalize_due_sessions(&state, &provider, &coordinator, &terminal_sink)
                .await
                .map_err(ProviderError::into_snapback_error)?;
        }
    });
    finish_auth_expiry_worker_start(handle, running).await
}

async fn finish_auth_expiry_worker_start(
    handle: JoinHandle<SnapbackResult<()>>,
    running: oneshot::Receiver<()>,
) -> SnapbackResult<AuthExpiryWorker> {
    running.await.map_err(|_| {
        SnapbackError::error(
            "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE",
            "auth",
            "the process-local session expiry worker failed before becoming ready",
        )
    })?;
    Ok(AuthExpiryWorker { handle })
}

#[cfg(test)]
async fn spawn_failed_auth_expiry_worker_for_test() -> SnapbackResult<AuthExpiryWorker> {
    let (ready, running) = oneshot::channel::<()>();
    let handle = tokio::spawn(async move {
        drop(ready);
        Err(SnapbackError::error(
            "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE",
            "auth",
            "injected expiry worker construction failure",
        ))
    });
    finish_auth_expiry_worker_start(handle, running).await
}

fn provider_unavailable_diagnostic() -> Diagnostic {
    Diagnostic::error(
        "SNAPBACK_AUTH_PROVIDER_UNAVAILABLE",
        "auth",
        "email-code auth provider is unavailable",
    )
}

// @ref LLP 0057#diagnostics — the operator-locus startup diagnostic names the missing path-bound sibling; the request-path 503 stays redacted.
fn startup_provider_unavailable_diagnostic(path: &Path, error: KeyringError) -> Diagnostic {
    let (cause, message) = match error {
        KeyringError::Missing => (
            "missing",
            "email-code auth provider is unavailable: the auth keyring sidecar is missing",
        ),
        KeyringError::Corrupt | KeyringError::MissingKey => (
            "corrupt",
            "email-code auth provider is unavailable: the auth keyring sidecar is corrupt",
        ),
        KeyringError::Unavailable => (
            "unavailable",
            "email-code auth provider is unavailable: the auth keyring sidecar could not be read",
        ),
    };
    Diagnostic::error("SNAPBACK_AUTH_PROVIDER_UNAVAILABLE", "auth", message).with_details(
        serde_json::json!({
            "durableStateMember": "authKeyring",
            "path": path.display().to_string(),
            "cause": cause,
            "remedy": "a store copy must carry every path-bound sibling of the database; copy the whole durable-state set with `snapback store export`",
        }),
    )
}

/// Profile conversion stays explicit so production capture cannot be enabled
/// by a lossy boolean or a default branch.
pub(crate) fn provider_profile(
    profile: crate::contract_types::ServerProfile,
) -> AuthProviderProfile {
    match profile {
        crate::contract_types::ServerProfile::Dev => AuthProviderProfile::Dev,
        crate::contract_types::ServerProfile::Test => AuthProviderProfile::Test,
        crate::contract_types::ServerProfile::Demo => AuthProviderProfile::Demo,
        crate::contract_types::ServerProfile::Prod => AuthProviderProfile::Prod,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::backup::create_backup;
    use crate::auth::crypto::{OsRandom, SessionBearer};
    use crate::auth::invocation::ResolvedAppAuthority;
    use crate::auth::keyring::AUTH_KEY_ROTATION_AGE_MS;
    use crate::auth::lifecycle::{
        RestoreDeclaration, activate_catalog, apply_declared_restore, restore_declaration_path,
    };
    use crate::auth::provider::AuthClock;
    use crate::local::LocalSnapback;
    use crate::storage::auth::AUTH_GC_BATCH;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{Arc, Mutex as StdMutex};
    use std::time::Instant;
    use tokio::sync::Mutex;

    #[test]
    fn failed_expiry_batch_delivers_successful_siblings_before_error() {
        let expired = ExpiredSession {
            authorization_stream_incarnation: "test-incarnation".to_owned(),
            session_id: "terminalized-sibling".to_owned(),
            generation: 1,
            close_by: Instant::now() + Duration::from_secs(5),
        };
        let observed = Arc::new(StdMutex::new(Vec::new()));
        let observed_for_sink = Arc::clone(&observed);
        let error = consume_due_expiry_finalization(
            &AuthExpiryTerminalSink::new(move |expired| {
                observed_for_sink.lock().unwrap().extend(expired);
            }),
            DueExpiryFinalization::failed_for_test(vec![expired.clone()]),
        )
        .expect_err("the contradictory batch remains fail closed");
        assert_eq!(
            error.diagnostic().code,
            "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE",
        );
        assert_eq!(
            observed.lock().unwrap().as_slice(),
            &[expired],
            "known terminal siblings reach the sink before the batch error",
        );
    }

    fn activate_file_catalog(
        database_path: &Path,
        now_ms: u64,
    ) -> (LocalSnapback, Arc<AuthKeyringStore>) {
        let mut snapback = LocalSnapback::open(database_path).expect("open auth fixture");
        let keyring = Arc::new(AuthKeyringStore::file_for_database(database_path));
        activate_catalog(
            snapback.remainder_auth_database_mut(),
            keyring.as_ref(),
            now_ms,
            &OsRandom,
        )
        .expect("activate auth fixture");
        (snapback, keyring)
    }

    fn insert_expired_challenges(snapback: &mut LocalSnapback, count: usize) {
        snapback
            .remainder_auth_database_mut()
            .auth_catalog()
            .insert_expired_challenges_for_test(count)
            .expect("insert expired auth challenges");
    }

    fn challenge_count(snapback: &mut LocalSnapback) -> usize {
        snapback
            .remainder_auth_database_mut()
            .auth_catalog_read()
            .verification_challenge_count_for_test()
            .map(|count| count as usize)
            .expect("count retained auth challenges")
    }

    struct RuntimeManualClock {
        epoch_ms: AtomicU64,
        base_epoch_ms: u64,
        base_monotonic: Instant,
    }

    impl RuntimeManualClock {
        fn new(epoch_ms: u64) -> Self {
            Self {
                epoch_ms: AtomicU64::new(epoch_ms),
                base_epoch_ms: epoch_ms,
                base_monotonic: Instant::now(),
            }
        }

        fn set(&self, epoch_ms: u64) {
            self.epoch_ms.store(epoch_ms, Ordering::Release);
        }
    }

    impl AuthClock for RuntimeManualClock {
        fn epoch_ms(&self) -> u64 {
            self.epoch_ms.load(Ordering::Acquire)
        }

        fn monotonic_now(&self) -> Instant {
            self.base_monotonic
                + Duration::from_millis(self.epoch_ms().saturating_sub(self.base_epoch_ms))
        }
    }

    struct RuntimeDualClock {
        epoch_ms: AtomicU64,
        monotonic_ms: AtomicU64,
        base_monotonic: Instant,
    }

    impl RuntimeDualClock {
        fn new(epoch_ms: u64) -> Self {
            Self {
                epoch_ms: AtomicU64::new(epoch_ms),
                monotonic_ms: AtomicU64::new(0),
                base_monotonic: Instant::now(),
            }
        }

        fn set(&self, epoch_ms: u64, monotonic_ms: u64) {
            self.epoch_ms.store(epoch_ms, Ordering::Release);
            self.monotonic_ms.store(monotonic_ms, Ordering::Release);
        }
    }

    impl AuthClock for RuntimeDualClock {
        fn epoch_ms(&self) -> u64 {
            self.epoch_ms.load(Ordering::Acquire)
        }

        fn monotonic_now(&self) -> Instant {
            self.base_monotonic + Duration::from_millis(self.monotonic_ms.load(Ordering::Acquire))
        }
    }

    #[tokio::test]
    async fn uninitialized_catalog_stays_dormant_without_minting_a_keyring_or_gc() {
        let directory = tempfile::tempdir().unwrap();
        let database_path = directory.path().join("app.sqlite3");
        let mut snapback = LocalSnapback::open(&database_path).unwrap();
        let keyring_path = AuthKeyringStore::keyring_path(&database_path);

        let runtime = AuthRuntime::inspect(
            &mut snapback,
            Some(&database_path),
            AuthProviderProfile::Test,
        )
        .unwrap();

        assert_eq!(runtime.health(), AuthProviderHealth::Dormant);
        assert!(!runtime.catalog_ready());
        assert!(runtime.startup_diagnostic().is_none());
        assert!(!keyring_path.exists());
        assert_eq!(runtime.run_startup_gc(&mut snapback).await.unwrap(), None);
        assert!(!keyring_path.exists());
    }

    #[test]
    fn first_boot_provider_uses_the_selected_startup_password_minimum() {
        let mut snapback = LocalSnapback::memory().unwrap();
        let runtime = AuthRuntime::inspect_with_password_minimum(
            &mut snapback,
            None,
            AuthProviderProfile::Test,
            8,
        )
        .unwrap();

        assert_eq!(
            runtime
                .provider()
                .password_security_profile()
                .minimum_password_length,
            8,
        );
    }

    #[tokio::test]
    async fn dormant_foreign_auth_table_remains_servable_for_rescue() {
        let directory = tempfile::tempdir().unwrap();
        let database_path = directory.path().join("app.sqlite3");
        let connection = rusqlite::Connection::open(&database_path).unwrap();
        connection
            .execute_batch("CREATE TABLE _auth_foreign_row(id TEXT PRIMARY KEY)")
            .unwrap();
        drop(connection);
        let mut snapback = LocalSnapback::open(&database_path).unwrap();

        let runtime = AuthRuntime::inspect(
            &mut snapback,
            Some(&database_path),
            AuthProviderProfile::Test,
        )
        .expect("a dormant table collision must leave the rescue route reachable");

        assert_eq!(runtime.health(), AuthProviderHealth::Dormant);
        assert!(!runtime.catalog_ready());
        assert!(!AuthKeyringStore::keyring_path(&database_path).exists());
    }

    #[tokio::test]
    async fn ready_health_revalidates_keyring_deletion_and_repair() {
        let directory = tempfile::tempdir().unwrap();
        let database_path = directory.path().join("app.sqlite3");
        let (mut snapback, _) = activate_file_catalog(&database_path, 1_000);
        let keyring_path = AuthKeyringStore::keyring_path(&database_path);
        let retained_bytes = std::fs::read(&keyring_path).unwrap();
        let runtime = AuthRuntime::inspect(
            &mut snapback,
            Some(&database_path),
            AuthProviderProfile::Test,
        )
        .unwrap();
        assert_eq!(runtime.health(), AuthProviderHealth::Available);

        std::fs::remove_file(&keyring_path).unwrap();
        assert_eq!(runtime.health(), AuthProviderHealth::Unavailable);
        crate::secure_file::write_new_owner_only(&keyring_path, &retained_bytes).unwrap();
        assert_eq!(runtime.health(), AuthProviderHealth::Available);
        assert!(
            runtime.startup_diagnostic().is_none(),
            "the boot diagnostic is emitted once from boot readiness, not synthesized dynamically"
        );
    }

    #[tokio::test]
    async fn marked_catalog_with_missing_keyring_names_sidecar_and_keeps_session_resolution() {
        let directory = tempfile::tempdir().unwrap();
        let database_path = directory.path().join("app.sqlite3");
        let (mut snapback, _) = activate_file_catalog(&database_path, 1_000);
        let bearer = SessionBearer::generate(&OsRandom).unwrap();
        let bearer_text = bearer.expose_secret().to_owned();
        let token_hash = bearer.token_hash();
        snapback
            .remainder_auth_database_mut()
            .auth_catalog()
            .insert_email_session_for_test(
                "user-1",
                "identity-1",
                "session-1",
                "authority-1",
                "user@example.com",
                token_hash.as_bytes(),
                1000,
                1000,
                9_000_000_000_000_000,
                9_000_000_000_000_000,
            )
            .unwrap();
        let keyring_path = AuthKeyringStore::keyring_path(&database_path);
        let keyring_json: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&keyring_path).unwrap()).unwrap();
        let active_key_id = keyring_json["active_key_id"].as_str().unwrap().to_owned();
        let active_key_material = keyring_json["keys"]
            .as_array()
            .unwrap()
            .iter()
            .find(|entry| entry["id"].as_str() == Some(active_key_id.as_str()))
            .and_then(|entry| entry["material"].as_str())
            .unwrap()
            .to_owned();
        std::fs::remove_file(&keyring_path).unwrap();

        let runtime = AuthRuntime::inspect(
            &mut snapback,
            Some(&database_path),
            AuthProviderProfile::Test,
        )
        .unwrap();
        assert_eq!(runtime.health(), AuthProviderHealth::Unavailable);
        assert!(runtime.catalog_ready());
        let diagnostic = runtime.startup_diagnostic().unwrap();
        assert_eq!(diagnostic.code, "SNAPBACK_AUTH_PROVIDER_UNAVAILABLE");
        assert_eq!(
            diagnostic.details["path"],
            serde_json::json!(keyring_path.display().to_string())
        );
        assert_eq!(diagnostic.details["cause"], serde_json::json!("missing"));
        assert_eq!(
            diagnostic.details["durableStateMember"],
            serde_json::json!("authKeyring")
        );
        let serialized = serde_json::to_string(diagnostic).unwrap();
        assert!(!serialized.contains(&active_key_id));
        assert!(!serialized.contains(&active_key_material));

        let request_diagnostic = provider_unavailable_diagnostic();
        assert_eq!(request_diagnostic.details, serde_json::json!({}));
        let request_serialized = serde_json::to_string(&request_diagnostic).unwrap();
        assert!(!request_serialized.contains(database_path.to_string_lossy().as_ref()));
        assert!(!request_serialized.contains("keyring"));
        assert_eq!(
            serde_json::to_value(runtime.health()).unwrap(),
            serde_json::json!("unavailable")
        );
        snapback.record_startup_diagnostics(&runtime.startup_diagnostics());
        let retained = snapback.inspect().unwrap().recent_diagnostics;
        assert_eq!(
            retained
                .iter()
                .filter(|entry| entry.code == "SNAPBACK_AUTH_PROVIDER_UNAVAILABLE")
                .count(),
            1,
            "startup retains exactly one unavailable diagnostic"
        );
        assert!(
            !keyring_path.exists(),
            "startup must not remint the lost ring"
        );

        let admission = runtime.provider().admit().await;
        let resolved = admission
            .resolve_session(snapback.remainder_auth_database_mut(), &bearer_text, 2_000)
            .expect("session digest resolution is keyring-independent");
        assert_eq!(resolved.session_id, "session-1");
        assert!(!keyring_path.exists());
    }

    #[test]
    fn marked_catalog_with_corrupt_keyring_reports_corrupt_sidecar() {
        let directory = tempfile::tempdir().unwrap();
        let database_path = directory.path().join("app.sqlite3");
        let (mut snapback, _) = activate_file_catalog(&database_path, 1_000);
        let keyring_path = AuthKeyringStore::keyring_path(&database_path);
        std::fs::write(&keyring_path, b"{not-json").unwrap();

        let runtime = AuthRuntime::inspect(
            &mut snapback,
            Some(&database_path),
            AuthProviderProfile::Test,
        )
        .unwrap();
        let diagnostic = runtime.startup_diagnostic().unwrap();

        assert_eq!(diagnostic.details["cause"], serde_json::json!("corrupt"));
        assert_eq!(
            diagnostic.details["path"],
            serde_json::json!(keyring_path.display().to_string())
        );
        assert_eq!(
            diagnostic.details["durableStateMember"],
            serde_json::json!("authKeyring")
        );
    }

    #[tokio::test]
    async fn startup_gc_waits_for_exclusive_maintenance_before_touching_storage() {
        let directory = tempfile::tempdir().unwrap();
        let database_path = directory.path().join("app.sqlite3");
        let (mut snapback, _) = activate_file_catalog(&database_path, 1_000);
        let runtime = AuthRuntime::inspect(
            &mut snapback,
            Some(&database_path),
            AuthProviderProfile::Test,
        )
        .unwrap();
        let provider = runtime.provider();
        let admission = provider.admit().await;
        let mut startup_gc = Box::pin(runtime.run_startup_gc(&mut snapback));
        assert!(
            tokio::time::timeout(Duration::from_millis(50), &mut startup_gc)
                .await
                .is_err(),
            "startup GC must wait for exclusive maintenance"
        );
        drop(admission);
        startup_gc.await.unwrap().unwrap();
    }

    #[tokio::test]
    async fn missing_keyring_preserves_startup_and_periodic_immediate_retry_scheduling() {
        let directory = tempfile::tempdir().unwrap();
        let database_path = directory.path().join("app.sqlite3");
        let (mut snapback, _) = activate_file_catalog(&database_path, 1_000);
        let expired_count = AUTH_GC_BATCH * 2 + 1;
        insert_expired_challenges(&mut snapback, expired_count);

        let keyring_path = AuthKeyringStore::keyring_path(&database_path);
        std::fs::remove_file(&keyring_path).unwrap();
        let runtime = AuthRuntime::inspect(
            &mut snapback,
            Some(&database_path),
            AuthProviderProfile::Test,
        )
        .unwrap();
        assert_eq!(runtime.health(), AuthProviderHealth::Unavailable);

        let startup_pass = runtime
            .run_startup_gc(&mut snapback)
            .await
            .expect("missing keyring does not mask committed durable GC")
            .expect("ready catalog runs startup GC");
        assert_eq!(startup_pass.challenges_deleted, AUTH_GC_BATCH);
        assert!(startup_pass.immediate_retry);
        assert_eq!(startup_pass.next_delay(), Duration::ZERO);
        assert_eq!(challenge_count(&mut snapback), AUTH_GC_BATCH + 1);
        assert_eq!(runtime.health(), AuthProviderHealth::Unavailable);
        assert!(!keyring_path.exists());
        let coordinator = runtime.build_coordinator(&mut snapback).unwrap();

        // The startup result seeds an immediate worker pass. That pass also
        // hits the 512-row bound, so the last row disappears only if periodic
        // scheduling preserves a second immediate retry while the ring remains
        // unavailable.
        let state = Arc::new(Mutex::new(snapback));
        let worker = spawn_auth_gc_worker(
            state.clone(),
            runtime.clone(),
            coordinator,
            AuthExpiryTerminalSink::noop(),
            startup_pass.next_delay(),
        )
        .expect("ready catalog starts auth GC worker");
        let drained = tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                let remaining = crate::server::with_snapback(&state, challenge_count).await;
                if remaining == 0 {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(1)).await;
            }
        })
        .await;
        worker.abort();
        let _ = worker.await;
        let remaining = crate::server::with_snapback(&state, challenge_count).await;
        assert!(
            drained.is_ok(),
            "startup plus periodic immediate retries left {remaining} expired rows"
        );
        assert_eq!(remaining, 0);
        assert_eq!(runtime.health(), AuthProviderHealth::Unavailable);
        assert!(!keyring_path.exists());
    }

    #[tokio::test]
    async fn declared_restore_clears_the_composed_provider_mailbox_under_maintenance() {
        let directory = tempfile::tempdir().unwrap();
        let database_path = directory.path().join("app.sqlite3");
        let (mut snapback, _) = activate_file_catalog(&database_path, 1_000);
        let runtime = AuthRuntime::inspect(
            &mut snapback,
            Some(&database_path),
            AuthProviderProfile::Test,
        )
        .unwrap();
        let provider = runtime.provider();
        let admission = provider
            .admit_email("restore-mailbox@example.com")
            .await
            .unwrap();
        let challenge = admission
            .request_code(snapback.remainder_auth_database_mut(), provider.now_ms())
            .unwrap()
            .challenge_id;
        drop(admission);

        let declaration = RestoreDeclaration::fresh();
        let declaration_path = restore_declaration_path(&database_path).unwrap();
        crate::secure_file::write_new_owner_only(
            &declaration_path,
            &declaration.to_bytes().unwrap(),
        )
        .unwrap();
        let maintenance = provider.exclusive_maintenance().await;
        apply_declared_restore(
            snapback.remainder_auth_database_mut(),
            maintenance.mailbox(),
            &declaration_path,
            declaration.declaration_id(),
            provider.now_ms(),
        )
        .unwrap();
        drop(maintenance);

        assert_eq!(
            provider
                .mailbox_entry(&challenge)
                .await
                .unwrap_err()
                .diagnostic()
                .code,
            "SNAPBACK_AUTH_MAILBOX_ENTRY_NOT_FOUND"
        );
    }

    #[tokio::test]
    async fn periodic_gc_takes_maintenance_before_waiting_for_the_outer_mutex() {
        let mut snapback = LocalSnapback::memory().unwrap();
        let keyring = Arc::new(AuthKeyringStore::in_memory());
        activate_catalog(
            snapback.remainder_auth_database_mut(),
            keyring.as_ref(),
            1_000,
            &OsRandom,
        )
        .unwrap();
        let provider = Arc::new(AuthProvider::new(AuthProviderProfile::Test, keyring).unwrap());
        snapback
            .remainder_auth_database_mut()
            .ensure_authorization_stream_incarnation()
            .unwrap();
        let projection = SessionProjection::rebuild_with_fresh_startup_id(
            snapback
                .remainder_auth_database_mut()
                .session_projection_source()
                .unwrap(),
            provider.now_ms(),
            provider.monotonic_now(),
        )
        .unwrap();
        let coordinator = Arc::new(AuthCoordinator::new(projection).unwrap());
        let state = Arc::new(Mutex::new(snapback));
        let outer = state.clone().lock_owned().await;

        let gc_state = state.clone();
        let gc_provider = provider.clone();
        let gc = tokio::spawn(async move {
            run_periodic_gc_pass(
                &gc_state,
                gc_provider,
                coordinator,
                &AuthExpiryTerminalSink::noop(),
            )
            .await
        });
        tokio::task::yield_now().await;

        let admission = tokio::time::timeout(Duration::from_millis(50), provider.admit()).await;
        assert!(
            admission.is_err(),
            "ordinary GC must hold exclusive maintenance while it waits for the outer lock"
        );
        drop(outer);
        gc.await.unwrap().unwrap();
        tokio::time::timeout(Duration::from_secs(1), provider.admit())
            .await
            .expect("shared admission resumes after GC");
    }

    #[tokio::test]
    async fn periodic_gc_releases_projection_begin_before_acquiring_maintenance() {
        let mut snapback = activated_memory_snapback();
        let _bearer = insert_lifetime_session(&mut snapback, 200, 300);
        let clock = Arc::new(RuntimeDualClock::new(100));
        let (runtime, provider) = ready_runtime_with_clock(clock.clone());
        let coordinator = runtime.build_coordinator(&mut snapback).unwrap();
        let state = Arc::new(Mutex::new(snapback));
        clock.set(201, 101);

        let outer = state.clone().lock_owned().await;
        let (sampled_tx, sampled_rx) = oneshot::channel();
        let gc_state = Arc::clone(&state);
        let gc_provider = Arc::clone(&provider);
        let gc = tokio::spawn(async move {
            run_periodic_gc_pass_after_sample(
                &gc_state,
                gc_provider,
                coordinator,
                &AuthExpiryTerminalSink::noop(),
                move || sampled_tx.send(()).expect("signal sampled expiry begin"),
            )
            .await
        });
        sampled_rx
            .await
            .expect("periodic GC samples projection before the durable frontier wait");

        let admission = tokio::time::timeout(Duration::from_millis(50), provider.admit())
            .await
            .expect("projection expiry reaches its Local wait without provider maintenance");
        drop(admission);
        drop(outer);
        gc.await.unwrap().unwrap();
    }

    #[tokio::test]
    async fn periodic_gc_terminalizes_projection_before_deleting_durable_session() {
        let mut snapback = LocalSnapback::memory().unwrap();
        let keyring = Arc::new(AuthKeyringStore::in_memory());
        activate_catalog(
            snapback.remainder_auth_database_mut(),
            keyring.as_ref(),
            1_000,
            &OsRandom,
        )
        .unwrap();
        let clock = Arc::new(RuntimeManualClock::new(1_000));
        let provider = Arc::new(
            AuthProvider::new_with_dependencies(
                AuthProviderProfile::Test,
                keyring,
                Arc::new(OsRandom),
                clock.clone(),
            )
            .unwrap(),
        );
        let bearer = SessionBearer::generate(&OsRandom).unwrap();
        let bearer_text = bearer.expose_secret().to_owned();
        let token_hash = bearer.token_hash();
        let user_id = uuid::Uuid::now_v7().to_string();
        let identity_id = uuid::Uuid::now_v7().to_string();
        let session_id = uuid::Uuid::now_v7().to_string();
        let authority_instance_id = uuid::Uuid::now_v7().to_string();
        snapback
            .remainder_auth_database_mut()
            .auth_catalog()
            .insert_email_session_for_test(
                &user_id,
                &identity_id,
                &session_id,
                &authority_instance_id,
                "gc@example.com",
                token_hash.as_bytes(),
                900,
                900,
                1100,
                1100,
            )
            .unwrap();
        snapback
            .remainder_auth_database_mut()
            .ensure_authorization_stream_incarnation()
            .unwrap();
        let projection = SessionProjection::rebuild_with_fresh_startup_id(
            snapback
                .remainder_auth_database_mut()
                .session_projection_source()
                .unwrap(),
            provider.now_ms(),
            provider.monotonic_now(),
        )
        .unwrap();
        let coordinator = Arc::new(AuthCoordinator::new(projection).unwrap());
        coordinator
            .resolve_required_bearer(&bearer_text, provider.now_ms(), provider.monotonic_now())
            .expect("predecessor session begins live");

        let state = Arc::new(Mutex::new(snapback));
        clock.set(1_101);
        let terminalized = Arc::new(StdMutex::new(Vec::new()));
        let terminalized_for_sink = Arc::clone(&terminalized);
        let sink = AuthExpiryTerminalSink::new(move |expired| {
            terminalized_for_sink.lock().unwrap().extend(expired);
        });
        let pass = run_periodic_gc_pass(&state, provider.clone(), coordinator.clone(), &sink)
            .await
            .unwrap();
        assert_eq!(pass.sessions_deleted, 1);
        assert_eq!(
            state
                .lock()
                .await
                .remainder_auth_database_mut()
                .auth_session_clock_floor()
                .unwrap(),
            1_101,
            "forward wall-clock expiry persists its terminal frontier before deletion",
        );
        let terminalized = terminalized.lock().unwrap();
        assert_eq!(terminalized.len(), 1);
        assert_eq!(terminalized[0].session_id, session_id);
        assert_eq!(terminalized[0].generation, 1);
        drop(terminalized);
        assert_eq!(
            coordinator
                .resolve_required_bearer(&bearer_text, provider.now_ms(), provider.monotonic_now(),)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_SESSION_EXPIRED"
        );
    }

    #[tokio::test]
    async fn periodic_auth_maintenance_runs_declared_push_idle_retention() {
        let retention_ms = 86_400_000;
        let mut snapback = LocalSnapback::memory().unwrap();
        let keyring = Arc::new(AuthKeyringStore::in_memory());
        activate_catalog(snapback.remainder_auth_database_mut(), keyring.as_ref(), 1, &OsRandom).unwrap();
        snapback
            .remainder_auth_database_mut()
            .activate_push_registry_for_test(crate::push::PushSeamDeclarationV1 {
                app_scope: crate::push::PushAppScopeV1 {
                    eas_project_id: "eas-maintenance".into(),
                    application_id: "com.example.maintenance".into(),
                    environment: "test".into(),
                },
                registry: crate::push::PushRegistryDeclarationV1 {
                    idle_retention_ms: retention_ms,
                },
                audiences: std::collections::BTreeMap::new(),
                uses: Vec::new(),
                ledger: None,
            })
            .unwrap();
        let user_id = crate::ids::mint(crate::ids::Kind::User).unwrap();
        let identity_id = crate::ids::mint(crate::ids::Kind::Identity).unwrap();
        let session_id = crate::ids::mint(crate::ids::Kind::Session).unwrap();
        let authority_id = crate::ids::mint(crate::ids::Kind::AuthorityInstance).unwrap();
        snapback
            .remainder_auth_database_mut()
            .auth_catalog()
            .insert_email_session_and_push_token_for_test(
                &user_id,
                &identity_id,
                &session_id,
                &authority_id,
                retention_ms * 2,
            )
            .unwrap();
        snapback
            .remainder_auth_database_mut()
            .ensure_authorization_stream_incarnation()
            .unwrap();
        let clock = Arc::new(RuntimeManualClock::new(1));
        let provider = Arc::new(
            AuthProvider::new_with_dependencies(
                AuthProviderProfile::Test,
                keyring,
                Arc::new(OsRandom),
                clock.clone(),
            )
            .unwrap(),
        );
        let projection = SessionProjection::rebuild_with_fresh_startup_id(
            snapback
                .remainder_auth_database_mut()
                .session_projection_source()
                .unwrap(),
            provider.now_ms(),
            provider.monotonic_now(),
        )
        .unwrap();
        let coordinator = Arc::new(AuthCoordinator::new(projection).unwrap());
        let state = Arc::new(Mutex::new(snapback));
        clock.set(retention_ms + 1);
        run_periodic_gc_pass(
            &state,
            provider,
            coordinator,
            &AuthExpiryTerminalSink::new(|_| {}),
        )
        .await
        .unwrap();
        let inspection = state
            .lock()
            .await
            .remainder_auth_database_mut()
            .push_registry_inspection()
            .unwrap();
        assert_eq!(inspection.live_tokens, 0);
        assert_eq!(inspection.retirement_reasons["idle-retention"], 1);
    }

    #[tokio::test]
    async fn expiry_worker_reports_ready_then_stops_fail_closed() {
        let mut snapback = LocalSnapback::memory().unwrap();
        let keyring = Arc::new(AuthKeyringStore::in_memory());
        activate_catalog(
            snapback.remainder_auth_database_mut(),
            keyring.as_ref(),
            1_000,
            &OsRandom,
        )
        .unwrap();
        let provider = Arc::new(AuthProvider::new(AuthProviderProfile::Test, keyring).unwrap());
        snapback
            .remainder_auth_database_mut()
            .ensure_authorization_stream_incarnation()
            .unwrap();
        let projection = SessionProjection::rebuild_with_fresh_startup_id(
            snapback
                .remainder_auth_database_mut()
                .session_projection_source()
                .unwrap(),
            provider.now_ms(),
            provider.monotonic_now(),
        )
        .unwrap();
        let coordinator = Arc::new(AuthCoordinator::new(projection).unwrap());
        let state = Arc::new(Mutex::new(snapback));
        let mut worker =
            spawn_auth_expiry_worker(state, coordinator, provider, AuthExpiryTerminalSink::noop())
                .await
                .expect("worker running handshake");

        worker.abort();
        assert_eq!(
            worker.stopped().await.unwrap_err().diagnostic.code,
            "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE"
        );
    }

    #[tokio::test]
    async fn backup_quiescence_blocks_provider_write_and_key_rotation() {
        let directory = tempfile::tempdir().unwrap();
        let database_path = directory.path().join("app.sqlite3");
        let (snapback, keyring) = activate_file_catalog(&database_path, 0);
        let provider =
            Arc::new(AuthProvider::new(AuthProviderProfile::Test, keyring.clone()).unwrap());
        let state = Arc::new(Mutex::new(snapback));
        let maintenance = provider.exclusive_maintenance().await;

        let writer_state = state.clone();
        let writer_provider = provider.clone();
        let mut writer = tokio::spawn(async move {
            let admission = writer_provider
                .admit_email("backup-race@example.com")
                .await
                .unwrap();
            let now_ms = AUTH_KEY_ROTATION_AGE_MS + 1;
            crate::server::with_snapback(&writer_state, move |snapback| {
                snapback.execute_auth_plan(admission.request_code_plan(now_ms))
            })
            .await
        });
        tokio::task::yield_now().await;
        assert!(
            tokio::time::timeout(Duration::from_millis(50), &mut writer)
                .await
                .is_err(),
            "provider write must not cross exclusive backup maintenance"
        );

        let output = directory.path().join("auth-backup");
        let (maintenance, backup) = crate::server::with_snapback(&state, move |snapback| {
            let result = create_backup(
                snapback.remainder_auth_database_mut(),
                maintenance.keyring(),
                &output,
                2_000,
                &OsRandom,
            );
            (maintenance, result)
        })
        .await;
        backup.unwrap();
        assert!(
            tokio::time::timeout(Duration::from_millis(50), &mut writer)
                .await
                .is_err(),
            "backup keeps the quiescence gate through publication"
        );
        assert_eq!(keyring.load_existing().unwrap().key_count, 1);

        drop(maintenance);
        writer.await.unwrap().unwrap();
        assert_eq!(
            keyring.load_existing().unwrap().key_count,
            2,
            "the due key rotation occurs only after backup releases maintenance"
        );
    }

    fn ready_runtime_with_clock<C: AuthClock + 'static>(
        clock: Arc<C>,
    ) -> (AuthRuntime, Arc<AuthProvider>) {
        let provider = Arc::new(
            AuthProvider::new_with_dependencies(
                AuthProviderProfile::Test,
                Arc::new(AuthKeyringStore::in_memory()),
                Arc::new(OsRandom),
                clock,
            )
            .unwrap(),
        );
        let runtime = AuthRuntime {
            provider: provider.clone(),
            catalog_ready: true,
            startup_diagnostic: None,
        };
        (runtime, provider)
    }

    fn insert_lifetime_session(
        snapback: &mut LocalSnapback,
        expires_at_ms: u64,
        absolute_expires_at_ms: u64,
    ) -> String {
        let bearer = SessionBearer::generate(&OsRandom).unwrap();
        let bearer_text = bearer.expose_secret().to_owned();
        let token_hash = bearer.token_hash();
        let user_id = uuid::Uuid::now_v7().to_string();
        let identity_id = uuid::Uuid::now_v7().to_string();
        let session_id = uuid::Uuid::now_v7().to_string();
        let authority_instance_id = uuid::Uuid::now_v7().to_string();
        snapback
            .remainder_auth_database_mut()
            .auth_catalog()
            .insert_email_session_for_test(
                &user_id,
                &identity_id,
                &session_id,
                &authority_instance_id,
                &format!("{identity_id}@example.com"),
                token_hash.as_bytes(),
                100,
                100,
                expires_at_ms,
                absolute_expires_at_ms,
            )
            .unwrap();
        bearer_text
    }

    fn activated_memory_snapback() -> LocalSnapback {
        let mut snapback = LocalSnapback::memory().unwrap();
        activate_catalog(
            snapback.remainder_auth_database_mut(),
            &AuthKeyringStore::in_memory(),
            50,
            &OsRandom,
        )
        .unwrap();
        snapback
    }

    /// A backward wall-clock move across restart must not revive a session the
    /// prior process already slid past. ENG-24982.
    #[tokio::test]
    async fn restart_backward_wall_move_cannot_revive_a_slid_session() {
        let mut snapback = activated_memory_snapback();
        // Sliding expiry 200, absolute expiry 300; the exact repro shape.
        let bearer = insert_lifetime_session(&mut snapback, 200, 300);

        // Process 1 reaches epoch 250, where the sliding deadline is terminal.
        // Building the coordinator advances and persists the durable floor.
        let (runtime1, provider1) =
            ready_runtime_with_clock(Arc::new(RuntimeManualClock::new(250)));
        let coordinator1 = runtime1.build_coordinator(&mut snapback).unwrap();
        assert_eq!(
            coordinator1
                .resolve_required_bearer(&bearer, provider1.now_ms(), provider1.monotonic_now())
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_SESSION_EXPIRED",
            "the running process already treats the session as terminal at epoch 250"
        );
        assert_eq!(
            snapback
                .remainder_auth_database_mut()
                .auth_session_clock_floor()
                .unwrap(),
            250,
            "the running process persisted its advancing clock floor"
        );

        // Process 2 restarts after the wall clock moved back to 150. Startup GC
        // retains the row (300 > 150) but the rebuild must still fail closed.
        assert!(
            runtime1
                .run_startup_gc(&mut snapback)
                .await
                .unwrap()
                .unwrap()
                .sessions_deleted
                == 0
        );
        let (runtime2, provider2) =
            ready_runtime_with_clock(Arc::new(RuntimeManualClock::new(150)));
        let coordinator2 = runtime2.build_coordinator(&mut snapback).unwrap();
        assert_eq!(
            provider2.now_ms(),
            250,
            "the process clock floor is seeded from the durable floor, not the lower sample"
        );
        assert_eq!(
            coordinator2
                .resolve_required_bearer(&bearer, provider2.now_ms(), provider2.monotonic_now())
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_SESSION_EXPIRED",
            "a rolled-back restart must not rebuild the slid session as current"
        );
    }

    /// A monotonic deadline can become authoritative while the host wall clock
    /// is behind it. The expiry cut must persist the deadline epoch before the
    /// terminal callback, so a crash at that callback cannot revive the row.
    #[tokio::test]
    async fn monotonic_expiry_commits_terminal_frontier_before_publication() {
        let mut snapback = activated_memory_snapback();
        let bearer = insert_lifetime_session(&mut snapback, 200, 300);
        let clock = Arc::new(RuntimeDualClock::new(100));
        let (runtime, provider) = ready_runtime_with_clock(clock.clone());
        let coordinator = runtime.build_coordinator(&mut snapback).unwrap();
        let state = Arc::new(Mutex::new(snapback));
        clock.set(50, 101);

        let terminalized = Arc::new(StdMutex::new(Vec::new()));
        let observed = Arc::clone(&terminalized);
        terminalize_due_sessions(
            &state,
            &provider,
            &coordinator,
            &AuthExpiryTerminalSink::new(move |expired| {
                observed.lock().unwrap().extend(expired);
            }),
        )
        .await
        .unwrap();
        assert_eq!(terminalized.lock().unwrap().len(), 1);
        let mut snapback = Arc::try_unwrap(state)
            .ok()
            .expect("the test retains a single state owner")
            .into_inner();
        assert_eq!(
            snapback
                .remainder_auth_database_mut()
                .auth_session_clock_floor()
                .unwrap(),
            200,
            "the durable frontier advances to the monotonic deadline, not the lower wall sample"
        );

        let (restart, restart_provider) =
            ready_runtime_with_clock(Arc::new(RuntimeManualClock::new(50)));
        let rebuilt = restart.build_coordinator(&mut snapback).unwrap();
        assert_eq!(
            rebuilt
                .resolve_required_bearer(
                    &bearer,
                    restart_provider.now_ms(),
                    restart_provider.monotonic_now(),
                )
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_SESSION_EXPIRED"
        );
    }

    /// A second session may become due while the sampled batch waits for the
    /// storage mutex. Only the first sampled deadline is covered by the
    /// committed frontier, so the later session must remain outside this
    /// terminal publication and survive a rolled-back restart.
    #[tokio::test]
    async fn expiry_terminalizes_only_the_sampled_set_before_storage_await() {
        let mut snapback = activated_memory_snapback();
        let first = insert_lifetime_session(&mut snapback, 200, 300);
        let second = insert_lifetime_session(&mut snapback, 400, 500);
        let clock = Arc::new(RuntimeDualClock::new(100));
        let (runtime, provider) = ready_runtime_with_clock(clock.clone());
        let coordinator = runtime.build_coordinator(&mut snapback).unwrap();
        let state = Arc::new(Mutex::new(snapback));
        clock.set(201, 101);

        let storage_guard = state.clone().lock_owned().await;
        let (sampled_tx, sampled_rx) = oneshot::channel();
        let terminalized = Arc::new(StdMutex::new(Vec::new()));
        let observed = Arc::clone(&terminalized);
        let task_state = Arc::clone(&state);
        let task_provider = Arc::clone(&provider);
        let task_coordinator = Arc::clone(&coordinator);
        let task = tokio::spawn(async move {
            terminalize_due_sessions_after_sample(
                &task_state,
                &task_provider,
                &task_coordinator,
                &AuthExpiryTerminalSink::new(move |expired| {
                    observed.lock().unwrap().extend(expired);
                }),
                move || sampled_tx.send(()).expect("signal exact sampled cut"),
            )
            .await
        });
        sampled_rx
            .await
            .expect("expiry pass sampled before storage await");
        clock.set(401, 301);
        drop(storage_guard);
        task.await.unwrap().unwrap();
        assert_eq!(
            terminalized.lock().unwrap().len(),
            1,
            "time advanced during storage await cannot enlarge the sampled due set",
        );

        let mut snapback = Arc::try_unwrap(state)
            .ok()
            .expect("the test retains a single state owner")
            .into_inner();
        assert_eq!(
            snapback
                .remainder_auth_database_mut()
                .auth_session_clock_floor()
                .unwrap(),
            201,
            "only the sampled first-session frontier was persisted",
        );
        let (restart, restart_provider) =
            ready_runtime_with_clock(Arc::new(RuntimeManualClock::new(201)));
        let rebuilt = restart.build_coordinator(&mut snapback).unwrap();
        assert_eq!(
            rebuilt
                .resolve_required_bearer(
                    &first,
                    restart_provider.now_ms(),
                    restart_provider.monotonic_now(),
                )
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_SESSION_EXPIRED",
        );
        rebuilt
            .resolve_required_bearer(
                &second,
                restart_provider.now_ms(),
                restart_provider.monotonic_now(),
            )
            .expect("unsampled second session remains live after rollback restart");
    }

    /// Ordinary forward time across restart still expires a slid session and
    /// keeps a still-live one. ENG-24982.
    #[tokio::test]
    async fn restart_forward_time_expires_slid_and_keeps_live_sessions() {
        let mut snapback = activated_memory_snapback();
        let slid = insert_lifetime_session(&mut snapback, 200, 300);
        let live = insert_lifetime_session(&mut snapback, 4_000, 5_000);

        let (runtime1, _) = ready_runtime_with_clock(Arc::new(RuntimeManualClock::new(250)));
        runtime1.build_coordinator(&mut snapback).unwrap();

        // Restart with the wall clock genuinely advanced to 260.
        let (runtime2, provider2) =
            ready_runtime_with_clock(Arc::new(RuntimeManualClock::new(260)));
        let coordinator2 = runtime2.build_coordinator(&mut snapback).unwrap();
        assert_eq!(
            provider2.now_ms(),
            260,
            "forward time is honored past the floor"
        );
        assert_eq!(
            coordinator2
                .resolve_required_bearer(&slid, provider2.now_ms(), provider2.monotonic_now())
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_SESSION_EXPIRED"
        );
        assert!(
            matches!(
                coordinator2
                    .resolve_required_bearer(&live, provider2.now_ms(), provider2.monotonic_now())
                    .unwrap()
                    .authority(),
                ResolvedAppAuthority::Session { generation: 1, .. }
            ),
            "a session whose deadlines are still ahead of the floor stays current"
        );
    }

    /// The floor must not over-expire a session whose deadlines are still in
    /// the future after a backward wall move. ENG-24982.
    #[tokio::test]
    async fn restart_backward_move_keeps_a_still_future_session_live() {
        let mut snapback = activated_memory_snapback();
        // Sliding 400, absolute 500: still ahead of the process-1 epoch 250.
        let live = insert_lifetime_session(&mut snapback, 400, 500);

        let (runtime1, _) = ready_runtime_with_clock(Arc::new(RuntimeManualClock::new(250)));
        runtime1.build_coordinator(&mut snapback).unwrap();

        let (runtime2, provider2) =
            ready_runtime_with_clock(Arc::new(RuntimeManualClock::new(150)));
        let coordinator2 = runtime2.build_coordinator(&mut snapback).unwrap();
        assert_eq!(
            provider2.now_ms(),
            250,
            "effective epoch is the durable floor"
        );
        assert!(
            matches!(
                coordinator2
                    .resolve_required_bearer(&live, provider2.now_ms(), provider2.monotonic_now())
                    .unwrap()
                    .authority(),
                ResolvedAppAuthority::Session { generation: 1, .. }
            ),
            "the floor fails closed only for deadlines it has passed, not future ones"
        );
    }
}
