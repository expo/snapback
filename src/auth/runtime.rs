//! Serve-time composition for the auth provider.
//!
//! This module deliberately inspects, but never activates, the protected
//! catalog. Item 4 owns staged activation; ordinary startup only assembles one
//! provider, reports its closed readiness fact, and coordinates lifecycle work
//! ahead of the outer app-instance lock.
//!
//! @ref LLP 0057#activation-ordering — ordinary startup never creates a
//! catalog or replaces a missing keyring for an already-marked catalog.
//! @ref LLP 0057#garbage-collection — ReadyV1 runs bounded startup and
//! 30-second maintenance passes; an uninitialized catalog stays dormant.
//! @ref LLP 0057#concurrency-locks-and-linearization — exclusive auth
//! maintenance is acquired before the outer app-instance/database lock.
//! @ref LLP 0057#security-and-redaction — readiness exposes one closed public
//! fact and a redacted diagnostic, never keyring details.

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::sync::oneshot;
use tokio::task::JoinHandle;

use super::coordinator::AuthCoordinator;
use super::keyring::AuthKeyringStore;
use super::lifecycle::AUTH_GC_INTERVAL;
use super::provider::{
    AuthGcPass, AuthProvider, AuthProviderProfile, AuthProviderReadiness, ProviderError,
    ProviderResult,
};
use super::session_projection::{
    AuthorizationStreamRecord, ExpiredSession, ProjectionSource, SessionProjection,
};
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
    pub(crate) fn inspect(
        snapback: &mut LocalSnapback,
        database_path: Option<&Path>,
        profile: AuthProviderProfile,
    ) -> SnapbackResult<Self> {
        let keyring = Arc::new(match database_path {
            Some(path) => AuthKeyringStore::file_for_database(path),
            None => AuthKeyringStore::in_memory(),
        });
        let provider = Arc::new(
            AuthProvider::new(profile, keyring).map_err(ProviderError::into_snapback_error)?,
        );
        let catalog = match snapback.auth_database_mut().inspect_auth_catalog() {
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
            AuthCatalogState::ReadyV1 => match provider.readiness() {
                AuthProviderReadiness::Available => None,
                AuthProviderReadiness::Unavailable => Some(provider_unavailable_diagnostic()),
            },
        };
        Ok(Self {
            provider,
            catalog_ready: catalog == AuthCatalogState::ReadyV1,
            startup_diagnostic,
        })
    }

    pub(crate) fn provider(&self) -> Arc<AuthProvider> {
        self.provider.clone()
    }

    /// Reserve and authenticate the process issuer before listener bind. The
    /// SQLite reservation commits first; authentication failure therefore
    /// burns a sequence and prevents serving rather than reusing it.
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
            .auth_database_mut()
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
    pub(crate) fn build_coordinator(
        &self,
        snapback: &mut LocalSnapback,
    ) -> SnapbackResult<Arc<AuthCoordinator>> {
        let database = snapback.auth_database_mut();
        let incarnation = database.ensure_authorization_stream_incarnation()?;
        let source = if self.catalog_ready {
            database.session_projection_source()?
        } else {
            ProjectionSource {
                authorization_stream_value: AuthorizationStreamRecord::new(incarnation)
                    .encode_bytes()?,
                restore_declaration_id: None,
                users: Vec::new(),
                identities: Vec::new(),
                sessions: Vec::new(),
                superseded_tokens: Vec::new(),
            }
        };
        let projection = SessionProjection::rebuild_with_fresh_startup_id(
            source,
            self.provider.now_ms(),
            self.provider.monotonic_now(),
        )?;
        Ok(Arc::new(AuthCoordinator::new(projection)?))
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
        maintenance
            .run_gc_pass(snapback.auth_database_mut(), now_ms)
            .map(Some)
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
    let maintenance = provider.exclusive_maintenance().await;
    let now_ms = provider.now_ms();
    // Durable deletion follows, and can never race ahead of, process-local
    // terminalization. A projection failure aborts this pass before SQLite.
    // @ref LLP 0059#operation-specific-publication — the projection owns live
    // expiry authority; GC only reclaims rows after that authority is closed.
    let expired = coordinator
        .expire_due(now_ms, provider.monotonic_now())
        .map_err(ProviderError::from)?;
    terminal_sink.consume(expired);
    crate::server::with_snapback(state, move |snapback| {
        maintenance.run_gc_pass(snapback.auth_database_mut(), now_ms)
    })
    .await
}

/// ReadyV1 only: honor the startup pass's next delay, then run forever. A full
/// bounded batch retries immediately. Keyring unavailability is a successful
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
            let expired = coordinator.expire_due(provider.now_ms(), provider.monotonic_now())?;
            terminal_sink.consume(expired);
        }
    });
    running.await.map_err(|_| {
        SnapbackError::error(
            "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE",
            "auth",
            "the process-local session expiry worker failed before becoming ready",
        )
    })?;
    Ok(AuthExpiryWorker { handle })
}

fn provider_unavailable_diagnostic() -> Diagnostic {
    Diagnostic::error(
        "SNAPBACK_AUTH_PROVIDER_UNAVAILABLE",
        "auth",
        "email-code auth provider is unavailable",
    )
}

/// Profile conversion stays explicit so production capture cannot be enabled
/// by a lossy boolean or a default branch.
pub(crate) fn provider_profile(profile: crate::admin::ServerProfile) -> AuthProviderProfile {
    match profile {
        crate::admin::ServerProfile::Dev => AuthProviderProfile::Dev,
        crate::admin::ServerProfile::Test => AuthProviderProfile::Test,
        crate::admin::ServerProfile::Demo => AuthProviderProfile::Demo,
        crate::admin::ServerProfile::Prod => AuthProviderProfile::Prod,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::backup::create_backup;
    use crate::auth::crypto::{OsRandom, SessionBearer};
    use crate::auth::keyring::AUTH_KEY_ROTATION_AGE_MS;
    use crate::auth::lifecycle::{
        RestoreDeclaration, activate_catalog, apply_declared_restore, restore_declaration_path,
    };
    use crate::auth::provider::AuthClock;
    use crate::local::LocalSnapback;
    use crate::storage::auth::AUTH_GC_BATCH;
    use rusqlite::params;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{Arc, Mutex as StdMutex};
    use std::time::Instant;
    use tokio::sync::Mutex;

    fn activate_file_catalog(
        database_path: &Path,
        now_ms: u64,
    ) -> (LocalSnapback, Arc<AuthKeyringStore>) {
        let mut snapback = LocalSnapback::open(database_path).expect("open auth fixture");
        let keyring = Arc::new(AuthKeyringStore::file_for_database(database_path));
        activate_catalog(
            snapback.auth_database_mut(),
            keyring.as_ref(),
            now_ms,
            &OsRandom,
        )
        .expect("activate auth fixture");
        (snapback, keyring)
    }

    fn insert_expired_challenges(snapback: &mut LocalSnapback, count: usize) {
        snapback
            .auth_database_mut()
            .with_auth_transaction(|transaction| {
                let mut insert = transaction.prepare(
                    "INSERT INTO _auth_verification_codes(
                       challenge_id, canonical_address, code_digest, key_id,
                       attempts, max_attempts, requested_at_ms, expires_at_ms,
                       consumed_at_ms, superseded_by
                     ) VALUES(?1, ?2, ?3, 'missing-key', 0, 5, 0, 1, NULL, NULL)",
                )?;
                let digest = [0_u8; 32];
                for index in 0..count {
                    insert.execute(params![
                        format!("expired-challenge-{index}"),
                        format!("expired-{index}@example.com"),
                        digest.as_slice(),
                    ])?;
                }
                Ok(())
            })
            .expect("insert expired auth challenges");
    }

    fn challenge_count(snapback: &mut LocalSnapback) -> usize {
        snapback
            .auth_database_mut()
            .with_auth_read(|connection| {
                connection
                    .query_row("SELECT COUNT(*) FROM _auth_verification_codes", [], |row| {
                        row.get::<_, i64>(0)
                    })
                    .map(|count| count as usize)
                    .map_err(crate::diagnostic::SnapbackError::from)
            })
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
    async fn marked_catalog_with_missing_keyring_is_redacted_and_keeps_session_resolution() {
        let directory = tempfile::tempdir().unwrap();
        let database_path = directory.path().join("app.sqlite3");
        let (mut snapback, _) = activate_file_catalog(&database_path, 1_000);
        let bearer = SessionBearer::generate(&OsRandom).unwrap();
        let bearer_text = bearer.expose_secret().to_owned();
        let token_hash = bearer.token_hash();
        snapback
            .auth_database_mut()
            .with_auth_transaction(|transaction| {
                transaction.execute(
                    "INSERT INTO _auth_users(id, created_at_ms) VALUES('user-1', 1000)",
                    [],
                )?;
                transaction.execute(
                    "INSERT INTO _auth_identities(
                       id, user_id, provider, subject, verified_at_ms
                     ) VALUES('identity-1', 'user-1', 'email-code', 'user@example.com', 1000)",
                    [],
                )?;
                transaction.execute(
                    "INSERT INTO _auth_sessions(
                       id, user_id, identity_id, authority_instance_id, token_hash,
                       generation, created_at_ms, last_used_at_ms, expires_at_ms,
                       absolute_expires_at_ms, revoked_at_ms
                     ) VALUES(
                       'session-1', 'user-1', 'identity-1', 'authority-1', ?1,
                       1, 1000, 1000, 9000000000000000, 9000000000000000, NULL
                     )",
                    params![token_hash.as_bytes().as_slice()],
                )?;
                Ok(())
            })
            .unwrap();
        let keyring_path = AuthKeyringStore::keyring_path(&database_path);
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
        let serialized = serde_json::to_string(diagnostic).unwrap();
        assert!(!serialized.contains("keyring"));
        assert!(!serialized.contains(database_path.to_string_lossy().as_ref()));
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
            "startup retains exactly one redacted unavailable diagnostic"
        );
        assert!(
            !keyring_path.exists(),
            "startup must not remint the lost ring"
        );

        let admission = runtime.provider().admit().await;
        let resolved = admission
            .resolve_session(snapback.auth_database_mut(), &bearer_text, 2_000)
            .expect("session digest resolution is keyring-independent");
        assert_eq!(resolved.session_id, "session-1");
        assert!(!keyring_path.exists());
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
            .request_code(snapback.auth_database_mut(), provider.now_ms())
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
            snapback.auth_database_mut(),
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
            snapback.auth_database_mut(),
            keyring.as_ref(),
            1_000,
            &OsRandom,
        )
        .unwrap();
        let provider = Arc::new(AuthProvider::new(AuthProviderProfile::Test, keyring).unwrap());
        snapback
            .auth_database_mut()
            .ensure_authorization_stream_incarnation()
            .unwrap();
        let projection = SessionProjection::rebuild_with_fresh_startup_id(
            snapback
                .auth_database_mut()
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
            "GC must hold exclusive maintenance while it waits for the outer lock"
        );
        drop(outer);
        gc.await.unwrap().unwrap();
        tokio::time::timeout(Duration::from_secs(1), provider.admit())
            .await
            .expect("shared admission resumes after GC");
    }

    #[tokio::test]
    async fn periodic_gc_terminalizes_projection_before_deleting_durable_session() {
        let mut snapback = LocalSnapback::memory().unwrap();
        let keyring = Arc::new(AuthKeyringStore::in_memory());
        activate_catalog(
            snapback.auth_database_mut(),
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
            .auth_database_mut()
            .with_auth_transaction(|transaction| {
                transaction.execute(
                    "INSERT INTO _auth_users(id, created_at_ms) VALUES(?1, 900)",
                    params![user_id],
                )?;
                transaction.execute(
                    "INSERT INTO _auth_identities(id, user_id, provider, subject, verified_at_ms)
                     VALUES(?1, ?2, 'email-code', 'gc@example.com', 900)",
                    params![identity_id, user_id],
                )?;
                transaction.execute(
                    "INSERT INTO _auth_sessions(
                       id, user_id, identity_id, authority_instance_id, token_hash,
                       generation, created_at_ms, last_used_at_ms, expires_at_ms,
                       absolute_expires_at_ms, revoked_at_ms
                     ) VALUES(?1, ?2, ?3, ?4, ?5, 1, 900, 900, 1100, 1100, NULL)",
                    params![
                        session_id,
                        user_id,
                        identity_id,
                        authority_instance_id,
                        token_hash.as_bytes().as_slice(),
                    ],
                )?;
                Ok(())
            })
            .unwrap();
        snapback
            .auth_database_mut()
            .ensure_authorization_stream_incarnation()
            .unwrap();
        let projection = SessionProjection::rebuild_with_fresh_startup_id(
            snapback
                .auth_database_mut()
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
    async fn expiry_worker_reports_ready_then_stops_fail_closed() {
        let mut snapback = LocalSnapback::memory().unwrap();
        let keyring = Arc::new(AuthKeyringStore::in_memory());
        activate_catalog(
            snapback.auth_database_mut(),
            keyring.as_ref(),
            1_000,
            &OsRandom,
        )
        .unwrap();
        let provider = Arc::new(AuthProvider::new(AuthProviderProfile::Test, keyring).unwrap());
        snapback
            .auth_database_mut()
            .ensure_authorization_stream_incarnation()
            .unwrap();
        let projection = SessionProjection::rebuild_with_fresh_startup_id(
            snapback
                .auth_database_mut()
                .session_projection_source()
                .unwrap(),
            provider.now_ms(),
            provider.monotonic_now(),
        )
        .unwrap();
        let coordinator = Arc::new(AuthCoordinator::new(projection).unwrap());
        let mut worker =
            spawn_auth_expiry_worker(coordinator, provider, AuthExpiryTerminalSink::noop())
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
                admission.request_code(snapback.auth_database_mut(), now_ms)
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
                snapback.auth_database_mut(),
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
}
