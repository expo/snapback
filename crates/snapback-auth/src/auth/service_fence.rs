//! Process-local act/publication fences for finite scoped-token authority.
//!
//! Durable token resolution supplies one exact witness. Every terminal auth
//! transaction premarks the matching token fences before SQLite commit, then
//! commits or rolls back that marker after the durable outcome is known. This
//! closes resolve-to-effect, resolve-to-response, and resolve-to-connection
//! missed-wakeup windows without retaining the bearer secret.
//!
//! @ref LLP 0059#finite-service-authority-fence — exact service witnesses,
//! plan-before-write terminal tickets, durable deadline publication, and the
//! external native-effect initiation cut share this one process registry.

use crate::auth::provider::AuthProvider;
use crate::auth::service_authority_contract::ServiceAuthorityDisposition;
use crate::diagnostic::{SnapbackError, SnapbackResult};
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant};

pub use snapback_kernel::auth::service_fence::{
    ServiceAuthorityDeadlineTerminal, ServiceAuthorityTerminalGate,
};
use snapback_kernel::auth::service_fence::{
    ServiceAuthorityPublicationFence, ServiceAuthorityWorkFenceError,
    ServiceAuthorityWorkFencePermit,
};

/// Process-local projection of a kernel-proved durable service authority.
/// Fields are private because registration derives this value from
/// [`snapback_kernel::storage::auth_agent_credentials::DurablyResolvedServiceAuthority`].
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ServiceAuthorityWitness {
    token_id: String,
    grant_id: String,
    actor_user_id: String,
    effective_user_id: Option<String>,
    credential_id: String,
    credential_generation: u64,
    expires_at_ms: u64,
    grant_expires_at_ms: Option<u64>,
}

impl ServiceAuthorityWitness {
    fn from_durable(
        durable: &snapback_kernel::storage::auth_agent_credentials::DurablyResolvedServiceAuthority,
    ) -> Self {
        let resolved = durable.resolved();
        Self {
            token_id: resolved.token_id().to_owned(),
            grant_id: resolved.grant_id().to_owned(),
            actor_user_id: resolved.actor_user_id().to_owned(),
            effective_user_id: resolved.effective_user_id().map(str::to_owned),
            credential_id: resolved.credential_id().to_owned(),
            credential_generation: resolved.credential_generation(),
            expires_at_ms: resolved.expires_at_ms(),
            grant_expires_at_ms: resolved.grant_expires_at_ms(),
        }
    }

    pub fn token_id(&self) -> &str {
        &self.token_id
    }

    pub fn expires_at_ms(&self) -> u64 {
        self.expires_at_ms
    }

    pub fn grant_id(&self) -> &str {
        &self.grant_id
    }

    pub fn actor_user_id(&self) -> &str {
        &self.actor_user_id
    }

    pub fn effective_user_id(&self) -> Option<&str> {
        self.effective_user_id.as_deref()
    }

    pub fn credential_id(&self) -> &str {
        &self.credential_id
    }

    pub fn credential_generation(&self) -> u64 {
        self.credential_generation
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ServiceAuthorityActResolution {
    Current(ServiceAuthorityWitness),
    Terminal(ServiceAuthorityDisposition),
    Unavailable,
}

thread_local! {
    /// Connection acts deliberately keep the publication mutex across their
    /// bounded synchronous app operation. Local validation reached inside
    /// that operation must reuse the already-proven witness instead of trying
    /// to lock the same non-reentrant mutex. The stack is thread-local because
    /// the guarded closure cannot suspend or migrate.
    static ACTIVE_SERVICE_AUTHORITY_ACTS: RefCell<Vec<ActiveServiceAuthorityEntry>> =
        const { RefCell::new(Vec::new()) };

}

#[derive(Debug)]
struct ServiceAuthorityFenceState {
    witness: ServiceAuthorityWitness,
    validated_at_ms: u64,
    monotonic_deadline: Instant,
    grant_monotonic_deadline: Option<Instant>,
}

#[derive(Clone, Debug)]
pub struct ServiceAuthorityPublication {
    fence: Arc<Mutex<ServiceAuthorityFenceState>>,
    domain: ServiceAuthorityPublicationFence,
    /// The provider owns the durable-floor-clamped epoch and injected
    /// monotonic clock used at resolution. Carry it with every retained
    /// publication so later server/local cuts cannot accidentally sample a
    /// different clock domain.
    clock: Option<Arc<AuthProvider>>,
}

/// One coherent durable resolution and its exact process publication.
/// Registration consumes the durable carrier so identity and publication
/// cannot be independently substituted before authority preparation.
pub struct RegisteredServiceAuthority {
    durable: snapback_kernel::storage::auth_agent_credentials::DurablyResolvedServiceAuthority,
    publication: ServiceAuthorityPublication,
}

impl RegisteredServiceAuthority {
    pub fn with_provider_clock(mut self, clock: Arc<AuthProvider>) -> Self {
        self.publication = self.publication.with_provider_clock(clock);
        self
    }

    pub fn into_parts(
        self,
    ) -> (
        snapback_kernel::storage::DatabaseBinding,
        snapback_kernel::storage::auth_agent_credentials::ResolvedScopedToken,
        ServiceAuthorityPublication,
    ) {
        let (database_binding, resolved) = self.durable.into_parts();
        (database_binding, resolved, self.publication)
    }
}

/// Typed result of trying to retain one finite-service authority unit. A
/// terminal result is safe to latch for an action; a non-terminal refusal is
/// an operational failure which must not permanently rewrite its cause.
#[derive(Debug)]
pub enum ServiceAuthorityWorkReservationError {
    Terminal {
        disposition: ServiceAuthorityDisposition,
        error: SnapbackError,
    },
    NonTerminal(SnapbackError),
}

impl ServiceAuthorityWorkReservationError {
    pub fn into_error(self) -> SnapbackError {
        match self {
            Self::Terminal { error, .. } | Self::NonTerminal(error) => error,
        }
    }
}

#[derive(Debug)]
pub struct ServiceAuthorityExternalEffectPermit {
    fence: Arc<Mutex<ServiceAuthorityFenceState>>,
    domain_work: Option<ServiceAuthorityWorkFencePermit>,
    witness: ServiceAuthorityWitness,
    settled: bool,
}

/// Thread-bound witness installed by one already-reserved finite-service
/// authority permit. It contains no mutex guard and may therefore be retained
/// beside a later-ranked mode guard through a synchronous SQLite commit.
///
/// The guard must not cross an await: its witness lives in thread-local
/// custody so nested storage validation on the same blocking owner can reuse
/// the exact pre-reserved authority without reacquiring the service fence.
pub struct RetainedServiceAuthorityGuard<'a> {
    _permit: &'a ServiceAuthorityExternalEffectPermit,
    _active: ActiveServiceAuthorityAct,
}

/// The external-effect permit is also the retained finite-authority work
/// permit. Both operations need the same begin-before-terminal interlock.
pub type ServiceAuthorityWorkPermit = ServiceAuthorityExternalEffectPermit;

struct ActiveServiceAuthorityAct {
    identity: Rc<()>,
}

struct ActiveServiceAuthorityEntry {
    identity: Rc<()>,
    key: usize,
    witness: ServiceAuthorityWitness,
}

impl Drop for ActiveServiceAuthorityAct {
    fn drop(&mut self) {
        ACTIVE_SERVICE_AUTHORITY_ACTS.with(|active| {
            let mut active = active.borrow_mut();
            if let Some(position) = active
                .iter()
                .position(|entry| Rc::ptr_eq(&entry.identity, &self.identity))
            {
                active.remove(position);
            }
        });
    }
}

impl ActiveServiceAuthorityAct {
    fn enter(key: usize, witness: ServiceAuthorityWitness) -> Self {
        let identity = Rc::new(());
        ACTIVE_SERVICE_AUTHORITY_ACTS.with(|active| {
            active.borrow_mut().push(ActiveServiceAuthorityEntry {
                identity: Rc::clone(&identity),
                key,
                witness,
            });
        });
        Self { identity }
    }
}

impl ServiceAuthorityExternalEffectPermit {
    /// Acknowledge that the native effect was synchronously initiated (or
    /// synchronously refused). Terminal premark may commit only after this
    /// exact begin→initiated window closes.
    pub fn initiated(mut self) {
        self.settle();
    }

    /// Complete work that already linearized before a terminal marker. The
    /// exact retained permit, rather than ambient token activity, installs the
    /// nested witness, so unrelated/new callers cannot publish through a
    /// pending ending while this predecessor drains.
    pub fn with_retained_authority<T>(&self, operation: impl FnOnce() -> T) -> T {
        let _active = self.retain_authority();
        operation()
    }

    /// Install the exact retained witness until the returned synchronous guard
    /// is dropped. This is the split-phase sibling of
    /// [`Self::with_retained_authority`], used when a later guard must be
    /// acquired last and returned to a transaction sink.
    pub fn retain_authority(&self) -> RetainedServiceAuthorityGuard<'_> {
        let key = Arc::as_ptr(&self.fence) as usize;
        RetainedServiceAuthorityGuard {
            _permit: self,
            _active: ActiveServiceAuthorityAct::enter(key, self.witness.clone()),
        }
    }

    fn settle(&mut self) {
        if self.settled {
            return;
        }
        if let Some(domain_work) = self.domain_work.take() {
            domain_work.settle();
        }
        self.settled = true;
    }
}

impl Drop for ServiceAuthorityExternalEffectPermit {
    fn drop(&mut self) {
        self.settle();
    }
}

impl ServiceAuthorityPublication {
    pub fn registered_witness(&self) -> SnapbackResult<ServiceAuthorityWitness> {
        self.fence
            .lock()
            .map(|state| state.witness.clone())
            .map_err(|_| service_authority_unavailable("a service authority fence is poisoned"))
    }

    fn fence_key(&self) -> usize {
        Arc::as_ptr(&self.fence) as usize
    }

    fn active_witness(&self) -> Option<ServiceAuthorityWitness> {
        let key = self.fence_key();
        ACTIVE_SERVICE_AUTHORITY_ACTS.with(|active| {
            active
                .borrow()
                .iter()
                .rev()
                .find_map(|entry| (entry.key == key).then(|| entry.witness.clone()))
        })
    }

    fn enter_active_act(&self, witness: ServiceAuthorityWitness) -> ActiveServiceAuthorityAct {
        ActiveServiceAuthorityAct::enter(self.fence_key(), witness)
    }

    pub fn with_provider_clock(mut self, clock: Arc<AuthProvider>) -> Self {
        self.clock = Some(clock);
        self
    }

    fn sample_clock(&self, epoch_now_ms: u64, monotonic_now: Instant) -> (u64, Instant) {
        self.clock
            .as_ref()
            .map_or((epoch_now_ms, monotonic_now), |clock| {
                (clock.now_ms(), clock.monotonic_now())
            })
    }

    pub fn current_clock_sample(
        &self,
        epoch_now_ms: u64,
        monotonic_now: Instant,
    ) -> (u64, Instant) {
        self.sample_clock(epoch_now_ms, monotonic_now)
    }

    fn deadline_expired_locked(
        state: &ServiceAuthorityFenceState,
        now_ms: u64,
        monotonic_now: Instant,
    ) -> bool {
        now_ms >= state.witness.expires_at_ms
            || monotonic_now >= state.monotonic_deadline
            || state
                .witness
                .grant_expires_at_ms
                .is_some_and(|grant| now_ms >= grant)
            || state
                .grant_monotonic_deadline
                .is_some_and(|deadline| monotonic_now >= deadline)
    }

    pub fn expired_deadline_terminal(
        &self,
        now_ms: u64,
        monotonic_now: Instant,
    ) -> SnapbackResult<Option<ServiceAuthorityDeadlineTerminal>> {
        if self.active_witness().is_some() {
            // The outer act sampled this exact fence current and still owns
            // its mutex. That sample is the operation's linearization point.
            return Ok(None);
        }
        let (now_ms, monotonic_now) = self.sample_clock(now_ms, monotonic_now);
        // The kernel domain is the only producer of the privately represented
        // durable subject. A delayed observer does not receive fresh grace.
        // @ref LLP 0059#typed-terminal-auth-error — expiry-worker scheduling
        //   latency consumes the one terminal close budget.
        self.domain.expired_deadline_terminal(
            now_ms,
            monotonic_now,
            crate::auth::session_projection::TERMINAL_CLOSE_GRACE,
        )
    }

    pub fn remaining_until_deadline(&self, monotonic_now: Instant) -> Duration {
        let monotonic_now = self
            .clock
            .as_ref()
            .map_or(monotonic_now, |clock| clock.monotonic_now());
        self.fence
            .lock()
            .map(|state| {
                state
                    .grant_monotonic_deadline
                    .map_or(state.monotonic_deadline, |grant| {
                        grant.min(state.monotonic_deadline)
                    })
                    .saturating_duration_since(monotonic_now)
            })
            .unwrap_or(Duration::ZERO)
    }

    pub fn try_publish<T>(
        &self,
        now_ms: u64,
        monotonic_now: Instant,
        publish: impl FnOnce() -> SnapbackResult<T>,
    ) -> SnapbackResult<Option<T>> {
        if self.active_witness().is_some() {
            return publish().map(Some);
        }
        let (now_ms, monotonic_now) = self.sample_clock(now_ms, monotonic_now);
        let domain = self.domain.snapshot()?;
        if domain.terminal().is_some() {
            return Ok(None);
        }
        if domain.pending().is_some() {
            return Err(service_authority_unavailable(
                "finite service authority termination is unresolved",
            ));
        }
        let domain_work = match self.domain.begin_work() {
            Ok(work) => work,
            Err(ServiceAuthorityWorkFenceError::Terminal(_)) => {
                let domain = self.domain.snapshot()?;
                if domain.terminal().is_some() {
                    return Ok(None);
                }
                return Err(service_authority_unavailable(
                    "finite service authority termination is unresolved",
                ));
            }
            Err(ServiceAuthorityWorkFenceError::Unavailable(error)) => return Err(error),
        };
        let state = self
            .fence
            .lock()
            .map_err(|_| service_authority_unavailable("a service authority fence is poisoned"))?;
        if now_ms < state.validated_at_ms {
            return Err(service_authority_unavailable(
                "the service authority clock is behind its validation sample",
            ));
        }
        if Self::deadline_expired_locked(&state, now_ms, monotonic_now) {
            return Err(service_authority_unavailable(
                "finite service authority expiry is not yet durably terminal",
            ));
        }
        let witness = state.witness.clone();
        let _active = self.enter_active_act(witness);
        let result = publish().map(Some);
        // The token counter is the async drain's completion witness. Release
        // the exact fence first so observing zero also proves a
        // terminal transaction will not block on this predecessor mutex.
        drop(_active);
        drop(state);
        drop(domain_work);
        result
    }

    pub fn terminal_disposition(
        &self,
        now_ms: u64,
        monotonic_now: Instant,
    ) -> ServiceAuthorityDisposition {
        let _ = self.sample_clock(now_ms, monotonic_now);
        if let Ok(domain) = self.domain.snapshot()
            && let Some(disposition) = domain.terminal()
        {
            return disposition;
        }
        ServiceAuthorityDisposition::Carrier
    }

    /// Validate the leaf for an app effect and return its immutable witness.
    /// Poison, rollback, a pending/committed terminal mutation, and expiry all
    /// fail closed; callers must not recover a poisoned guard for authority.
    pub fn resolve_act(
        &self,
        now_ms: u64,
        monotonic_now: Instant,
    ) -> SnapbackResult<ServiceAuthorityActResolution> {
        if let Some(witness) = self.active_witness() {
            return Ok(ServiceAuthorityActResolution::Current(witness));
        }
        let (now_ms, monotonic_now) = self.sample_clock(now_ms, monotonic_now);
        let domain = self.domain.snapshot()?;
        if let Some(disposition) = domain.terminal() {
            return Ok(ServiceAuthorityActResolution::Terminal(disposition));
        }
        if domain.pending().is_some() {
            return Ok(ServiceAuthorityActResolution::Unavailable);
        }
        let state = self
            .fence
            .lock()
            .map_err(|_| service_authority_unavailable("a service authority fence is poisoned"))?;
        if now_ms < state.validated_at_ms {
            return Ok(ServiceAuthorityActResolution::Unavailable);
        }
        if Self::deadline_expired_locked(&state, now_ms, monotonic_now) {
            return Ok(ServiceAuthorityActResolution::Unavailable);
        }
        Ok(ServiceAuthorityActResolution::Current(
            state.witness.clone(),
        ))
    }

    pub fn begin_authority_work(
        &self,
        now_ms: u64,
        monotonic_now: Instant,
    ) -> SnapbackResult<ServiceAuthorityWorkPermit> {
        self.begin_authority_work_classified(now_ms, monotonic_now)
            .map_err(ServiceAuthorityWorkReservationError::into_error)
    }

    pub fn begin_authority_work_classified(
        &self,
        now_ms: u64,
        monotonic_now: Instant,
    ) -> Result<ServiceAuthorityWorkPermit, ServiceAuthorityWorkReservationError> {
        let domain_work = self.domain.begin_work().map_err(|error| match error {
            ServiceAuthorityWorkFenceError::Terminal(disposition) => {
                ServiceAuthorityWorkReservationError::Terminal {
                    disposition,
                    error: service_authority_terminal(disposition),
                }
            }
            ServiceAuthorityWorkFenceError::Unavailable(error) => {
                ServiceAuthorityWorkReservationError::NonTerminal(error)
            }
        })?;
        if let Some(witness) = self.active_witness() {
            return Ok(ServiceAuthorityExternalEffectPermit {
                fence: Arc::clone(&self.fence),
                domain_work: Some(domain_work),
                witness,
                settled: false,
            });
        }
        let (now_ms, monotonic_now) = self.sample_clock(now_ms, monotonic_now);
        let state = self.fence.lock().map_err(|_| {
            ServiceAuthorityWorkReservationError::NonTerminal(service_authority_unavailable(
                "a service authority fence is poisoned",
            ))
        })?;
        if now_ms < state.validated_at_ms {
            return Err(ServiceAuthorityWorkReservationError::NonTerminal(
                service_authority_unavailable(
                    "the service authority clock is behind its validation sample",
                ),
            ));
        }
        if Self::deadline_expired_locked(&state, now_ms, monotonic_now) {
            return Err(ServiceAuthorityWorkReservationError::NonTerminal(
                service_authority_unavailable(
                    "finite service authority expiry is not yet durably terminal",
                ),
            ));
        }
        let witness = state.witness.clone();
        drop(state);
        Ok(ServiceAuthorityExternalEffectPermit {
            fence: Arc::clone(&self.fence),
            domain_work: Some(domain_work),
            witness,
            settled: false,
        })
    }

    pub fn begin_external_effect(
        &self,
        now_ms: u64,
        monotonic_now: Instant,
    ) -> SnapbackResult<ServiceAuthorityExternalEffectPermit> {
        self.begin_authority_work(now_ms, monotonic_now)
    }
}

#[derive(Default)]
struct ServiceAuthorityFenceRegistryState {
    by_token: HashMap<String, Weak<Mutex<ServiceAuthorityFenceState>>>,
}

#[derive(Clone)]
pub struct ServiceAuthorityFenceRegistry {
    core: snapback_kernel::auth::service_fence::ServiceAuthorityFenceRegistry,
    state: Arc<Mutex<ServiceAuthorityFenceRegistryState>>,
}

impl std::fmt::Debug for ServiceAuthorityFenceRegistry {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("ServiceAuthorityFenceRegistry([REDACTED])")
    }
}

impl ServiceAuthorityFenceRegistry {
    pub fn from_database(database: &snapback_kernel::storage::ServingDatabase) -> Self {
        Self {
            core: database.service_authority_fence_registry(),
            state: Arc::new(Mutex::new(ServiceAuthorityFenceRegistryState::default())),
        }
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn is_same_registry(&self, other: &Self) -> bool {
        self.core.is_same_registry(&other.core)
    }

    /// Acquire only from an exact plan produced by this same database. The
    /// caller cannot select token ids or disposition at the fence boundary.
    pub async fn acquire_planned_terminal_gate(
        &self,
        plan: snapback_kernel::auth::service_fence::DurablyPlannedServiceAuthorityTerminal,
    ) -> SnapbackResult<ServiceAuthorityTerminalGate> {
        let core = self.core.clone();
        tokio::task::spawn_blocking(move || core.acquire_planned_terminal_gate(plan))
            .await
            .map_err(|error| {
                service_authority_unavailable(&format!(
                    "service terminal gate worker failed: {error}"
                ))
            })?
    }

    /// Register only from the exact database-bound output of durable
    /// resolution. The caller never supplies the process-fence subject.
    ///
    /// @ref LLP 0303#the-governing-principle — derive the fence witness from
    /// the kernel's durable resolution carrier.
    pub fn register_resolved(
        &self,
        durable: snapback_kernel::storage::auth_agent_credentials::DurablyResolvedServiceAuthority,
        validated_at_ms: u64,
        monotonic_now: Instant,
    ) -> SnapbackResult<RegisteredServiceAuthority> {
        if durable.database_binding() != self.core.database_binding() {
            return Err(service_authority_unavailable(
                "durable service authority belongs to another database",
            ));
        }
        let publication = self.register(
            &durable,
            ServiceAuthorityWitness::from_durable(&durable),
            validated_at_ms,
            monotonic_now,
        )?;
        Ok(RegisteredServiceAuthority {
            durable,
            publication,
        })
    }

    /// Internal primitive retained for focused fence-state tests. Production
    /// callers cannot assemble or submit a witness.
    fn register(
        &self,
        durable: &snapback_kernel::storage::auth_agent_credentials::DurablyResolvedServiceAuthority,
        witness: ServiceAuthorityWitness,
        validated_at_ms: u64,
        monotonic_now: Instant,
    ) -> SnapbackResult<ServiceAuthorityPublication> {
        let remaining_ms = witness
            .expires_at_ms
            .checked_sub(validated_at_ms)
            .filter(|remaining| *remaining > 0)
            .ok_or_else(|| {
                service_authority_unavailable(
                    "durable service authority was resolved at an invalid deadline",
                )
            })?;
        let monotonic_deadline = monotonic_now
            .checked_add(Duration::from_millis(remaining_ms))
            .ok_or_else(|| {
                service_authority_unavailable(
                    "durable service authority deadline is not representable",
                )
            })?;
        let grant_monotonic_deadline = witness
            .grant_expires_at_ms
            .filter(|grant_expires_at_ms| *grant_expires_at_ms <= witness.expires_at_ms)
            .map(|grant_expires_at_ms| {
                let remaining = grant_expires_at_ms
                    .checked_sub(validated_at_ms)
                    .ok_or_else(|| {
                        service_authority_unavailable(
                            "durable grant authority was resolved after its deadline",
                        )
                    })?;
                monotonic_now
                    .checked_add(Duration::from_millis(remaining))
                    .ok_or_else(|| {
                        service_authority_unavailable(
                            "durable grant authority deadline is not representable",
                        )
                    })
            })
            .transpose()?;
        let mut registry = self
            .state
            .lock()
            .map_err(|_| service_authority_unavailable("the service fence registry is poisoned"))?;
        registry
            .by_token
            .retain(|_, candidate| candidate.strong_count() != 0);
        let token_id = witness.token_id.clone();
        let domain = self
            .core
            .register_resolved(durable, validated_at_ms, monotonic_now)?;
        let fence = match registry
            .by_token
            .get(witness.token_id())
            .and_then(Weak::upgrade)
        {
            Some(fence) => {
                let mut state = fence.lock().map_err(|_| {
                    service_authority_unavailable(
                        "a registered service authority fence is poisoned",
                    )
                })?;
                if state.witness != witness {
                    return Err(service_authority_unavailable(
                        "durable service authority disagrees with its process fence",
                    ));
                }
                if validated_at_ms < state.validated_at_ms
                    || validated_at_ms >= state.witness.expires_at_ms
                {
                    return Err(service_authority_unavailable(
                        "durable service authority was resolved at an invalid clock sample",
                    ));
                }
                state.validated_at_ms = validated_at_ms;
                state.monotonic_deadline = state.monotonic_deadline.min(monotonic_deadline);
                state.grant_monotonic_deadline =
                    match (state.grant_monotonic_deadline, grant_monotonic_deadline) {
                        (Some(left), Some(right)) => Some(left.min(right)),
                        (left, right) => left.or(right),
                    };
                drop(state);
                fence
            }
            None => {
                let fence = Arc::new(Mutex::new(ServiceAuthorityFenceState {
                    witness,
                    validated_at_ms,
                    monotonic_deadline,
                    grant_monotonic_deadline,
                }));
                registry.by_token.insert(token_id, Arc::downgrade(&fence));
                fence
            }
        };
        Ok(ServiceAuthorityPublication {
            fence,
            domain,
            clock: None,
        })
    }
}

/// Bind an asynchronously drained exact-token gate to one synchronous storage
/// call. The storage interlock consumes it only after its own transaction plan
/// reproduces the exact token set and disposition.
pub fn with_service_authority_terminal_gate<T>(
    gate: ServiceAuthorityTerminalGate,
    operation: impl FnOnce() -> T,
) -> T {
    snapback_kernel::auth::service_fence::with_service_authority_terminal_gate(gate, operation)
}

fn service_authority_unavailable(message: &str) -> SnapbackError {
    SnapbackError::error("SNAPBACK_AUTH_POLICY_UNAVAILABLE", "auth", message)
}

fn service_authority_terminal(disposition: ServiceAuthorityDisposition) -> SnapbackError {
    let wire = match disposition {
        ServiceAuthorityDisposition::Carrier => "carrier",
        ServiceAuthorityDisposition::DurableDelete => "durableDelete",
    };
    SnapbackError::error(
        "SNAPBACK_AUTH_SCOPED_TOKEN_INVALID",
        "auth",
        "scoped agent token authority is no longer current",
    )
    .with_details(serde_json::json!({ "authorityDisposition": wire }))
}
