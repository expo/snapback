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
use crate::auth::service_authority_contract::{
    ServiceAuthorityActResolution, ServiceAuthorityDeadlineTerminal, ServiceAuthorityDisposition,
    ServiceAuthorityWitness,
};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::rc::Rc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant};
use tokio::sync::Notify;

use snapback_kernel::auth::service_fence::{
    PreparedServiceAuthorityTerminal, ServiceAuthorityCommitInterlock,
    ServiceAuthorityTerminalFactory,
};

const MAX_IN_FLIGHT_SERVICE_AUTHORITY_WORK: usize = 4_096;

thread_local! {
    /// Connection acts deliberately keep the publication mutex across their
    /// bounded synchronous app operation. Local validation reached inside
    /// that operation must reuse the already-proven witness instead of trying
    /// to lock the same non-reentrant mutex. The stack is thread-local because
    /// the guarded closure cannot suspend or migrate.
    static ACTIVE_SERVICE_AUTHORITY_ACTS: RefCell<Vec<ActiveServiceAuthorityEntry>> =
        const { RefCell::new(Vec::new()) };

    /// One independently drained exact-token reservation may be installed by
    /// the blocking owner before it invokes a synchronous storage operation.
    /// `prepare_terminal` consumes only an exact registry/token/disposition
    /// match, so a nested or unrelated transaction cannot adopt the gate.
    static ACTIVE_SERVICE_TERMINAL_GATE: RefCell<Option<ServiceAuthorityTerminalGate>> =
        const { RefCell::new(None) };
    static SERVICE_TERMINAL_GATE_SCOPE_ACTIVE: Cell<bool> = const { Cell::new(false) };
}

#[derive(Debug)]
struct ServiceAuthorityFenceState {
    witness: ServiceAuthorityWitness,
    validated_at_ms: u64,
    monotonic_deadline: Instant,
    grant_monotonic_deadline: Option<Instant>,
    terminal: Option<ServiceAuthorityDisposition>,
}

#[derive(Debug, Default)]
struct ServiceAuthorityDomainState {
    pending_tickets: BTreeMap<u64, ServiceAuthorityDisposition>,
}

#[derive(Debug, Default)]
struct ServiceAuthorityDomain {
    state: Mutex<ServiceAuthorityDomainState>,
    active_work: AtomicUsize,
    changed: Notify,
}

#[derive(Clone, Debug)]
pub struct ServiceAuthorityPublication {
    fence: Arc<Mutex<ServiceAuthorityFenceState>>,
    domain: Arc<ServiceAuthorityDomain>,
    /// The provider owns the durable-floor-clamped epoch and injected
    /// monotonic clock used at resolution. Carry it with every retained
    /// publication so later server/local cuts cannot accidentally sample a
    /// different clock domain.
    clock: Option<Arc<AuthProvider>>,
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
    domain: Arc<ServiceAuthorityDomain>,
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

/// Owned exact-token terminal intent. Acquisition closes only the planned
/// tokens and asynchronously drains their predecessor work. The blocking
/// owner must install it with [`with_service_authority_terminal_gate`] around
/// the matching synchronous storage operation.
#[derive(Debug)]
pub struct ServiceAuthorityTerminalGate {
    prepared: Option<PremarkedServiceAuthorityTerminal>,
}

struct ActiveServiceAuthorityAct {
    identity: Rc<()>,
}

struct ActiveServiceAuthorityEntry {
    identity: Rc<()>,
    key: usize,
    witness: ServiceAuthorityWitness,
}

struct ServiceDomainPublicationPermit {
    domain: Arc<ServiceAuthorityDomain>,
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

impl Drop for ServiceDomainPublicationPermit {
    fn drop(&mut self) {
        let released =
            self.domain
                .active_work
                .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |current| {
                    current.checked_sub(1)
                });
        debug_assert!(released.is_ok());
        if matches!(released, Ok(1)) {
            self.domain.changed.notify_waiters();
        }
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
        let released =
            self.domain
                .active_work
                .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |current| {
                    current.checked_sub(1)
                });
        debug_assert!(released.is_ok());
        if matches!(released, Ok(1)) {
            self.domain.changed.notify_waiters();
        }
        self.settled = true;
    }
}

impl Drop for ServiceAuthorityExternalEffectPermit {
    fn drop(&mut self) {
        self.settle();
    }
}

fn try_acquire_service_domain_work(domain: &ServiceAuthorityDomain) -> bool {
    domain
        .active_work
        .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |current| {
            (current < MAX_IN_FLIGHT_SERVICE_AUTHORITY_WORK).then_some(current + 1)
        })
        .is_ok()
}

impl ServiceAuthorityPublication {
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

    #[cfg(any(test, feature = "test-support"))]
    pub fn synthetic_for_test(token_id: &str) -> Self {
        let domain = Arc::new(ServiceAuthorityDomain::default());
        Self {
            fence: Arc::new(Mutex::new(ServiceAuthorityFenceState {
                witness: ServiceAuthorityWitness {
                    token_id: token_id.to_owned(),
                    grant_id: "durable-grant-a".to_owned(),
                    actor_user_id: "agent-a".to_owned(),
                    effective_user_id: Some("user-a".to_owned()),
                    credential_id: "credential-a".to_owned(),
                    credential_generation: 1,
                    expires_at_ms: u64::MAX,
                    grant_expires_at_ms: None,
                },
                validated_at_ms: 0,
                monotonic_deadline: Instant::now() + Duration::from_secs(10 * 365 * 24 * 60 * 60),
                grant_monotonic_deadline: None,
                terminal: None,
            })),
            domain,
            clock: None,
        }
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
        let domain_state = self.domain.state.lock().map_err(|_| {
            service_authority_unavailable("the service authority domain gate is poisoned")
        })?;
        let state = self
            .fence
            .lock()
            .map_err(|_| service_authority_unavailable("a service authority fence is poisoned"))?;
        if state.terminal.is_some()
            || !domain_state.pending_tickets.is_empty()
            || !Self::deadline_expired_locked(&state, now_ms, monotonic_now)
        {
            return Ok(None);
        }
        let grant_due = state
            .witness
            .grant_expires_at_ms
            .is_some_and(|grant| now_ms >= grant)
            || state
                .grant_monotonic_deadline
                .is_some_and(|deadline| monotonic_now >= deadline);
        let (deadline_ms, disposition) = if grant_due {
            (
                state
                    .witness
                    .grant_expires_at_ms
                    .unwrap_or(state.witness.expires_at_ms),
                ServiceAuthorityDisposition::DurableDelete,
            )
        } else {
            (
                state.witness.expires_at_ms,
                ServiceAuthorityDisposition::Carrier,
            )
        };
        // A delayed expiry observer must not receive a fresh close grace. When
        // either projected monotonic deadline proves expiry, scheduling,
        // planning, drain, and durable-commit latency all consume the original
        // budget. Only an epoch deadline which moved ahead of every projected
        // monotonic deadline (a forward wall-clock jump) starts grace at the
        // observation cut.
        //
        // @ref LLP 0059#typed-terminal-auth-error — expiry-worker scheduling
        //   latency consumes the one terminal close budget.
        let monotonic_proof_deadline = [
            (monotonic_now >= state.monotonic_deadline).then_some(state.monotonic_deadline),
            state
                .grant_monotonic_deadline
                .filter(|deadline| monotonic_now >= *deadline),
        ]
        .into_iter()
        .flatten()
        .min();
        let close_basis = monotonic_proof_deadline.unwrap_or(monotonic_now);
        let close_by = close_basis
            .checked_add(crate::auth::session_projection::TERMINAL_CLOSE_GRACE)
            .unwrap_or(close_basis);
        Ok(Some(ServiceAuthorityDeadlineTerminal {
            token_id: state.witness.token_id.clone(),
            grant_id: state.witness.grant_id.clone(),
            deadline_ms,
            disposition,
            close_by,
        }))
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
        let domain_state = self.domain.state.lock().map_err(|_| {
            service_authority_unavailable("the service authority domain gate is poisoned")
        })?;
        let terminal_preflight = self
            .fence
            .lock()
            .map_err(|_| service_authority_unavailable("a service authority fence is poisoned"))?;
        if terminal_preflight.terminal.is_some() {
            return Ok(None);
        }
        if !domain_state.pending_tickets.is_empty() {
            return Err(service_authority_unavailable(
                "finite service authority termination is unresolved",
            ));
        }
        drop(terminal_preflight);
        if !try_acquire_service_domain_work(&self.domain) {
            return Err(service_authority_unavailable(
                "the service authority domain has too much in-flight work",
            ));
        }
        // Declare the exact-token permit before the leaf guard. Rust unwinding
        // then releases the leaf before the counter, preserving the drain
        // witness even if the bounded publication panics.
        let _domain_work = ServiceDomainPublicationPermit {
            domain: Arc::clone(&self.domain),
        };
        let state = self
            .fence
            .lock()
            .map_err(|_| service_authority_unavailable("a service authority fence is poisoned"))?;
        // The domain lock excludes terminal ticket installation between the
        // preflight and this retained leaf guard.
        if state.terminal.is_some() {
            return Ok(None);
        }
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
        drop(domain_state);
        let witness = state.witness.clone();
        let _active = self.enter_active_act(witness);
        let result = publish().map(Some);
        // The token counter is the async drain's completion witness. Release
        // the exact fence first so observing zero also proves a
        // terminal transaction will not block on this predecessor mutex.
        drop(_active);
        drop(state);
        drop(_domain_work);
        result
    }

    pub fn terminal_disposition(
        &self,
        now_ms: u64,
        monotonic_now: Instant,
    ) -> ServiceAuthorityDisposition {
        let (now_ms, monotonic_now) = self.sample_clock(now_ms, monotonic_now);
        let Ok(state) = self.fence.lock() else {
            return ServiceAuthorityDisposition::Carrier;
        };
        if let Some(disposition) = state.terminal {
            return disposition;
        }
        let _ = (now_ms, monotonic_now);
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
        let domain_state = self.domain.state.lock().map_err(|_| {
            service_authority_unavailable("the service authority domain gate is poisoned")
        })?;
        let state = self
            .fence
            .lock()
            .map_err(|_| service_authority_unavailable("a service authority fence is poisoned"))?;
        if let Some(disposition) = state.terminal {
            return Ok(ServiceAuthorityActResolution::Terminal(disposition));
        }
        if !domain_state.pending_tickets.is_empty() {
            return Ok(ServiceAuthorityActResolution::Unavailable);
        }
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
        let domain_state = self.domain.state.lock().map_err(|_| {
            ServiceAuthorityWorkReservationError::NonTerminal(service_authority_unavailable(
                "the service authority domain gate is poisoned",
            ))
        })?;
        if let Some(disposition) = domain_state.pending_tickets.values().copied().next() {
            return Err(ServiceAuthorityWorkReservationError::Terminal {
                disposition,
                error: service_authority_terminal(disposition),
            });
        }
        if let Some(witness) = self.active_witness() {
            if !try_acquire_service_domain_work(&self.domain) {
                return Err(ServiceAuthorityWorkReservationError::NonTerminal(
                    service_authority_unavailable(
                        "finite service authority has too much in-flight work",
                    ),
                ));
            }
            drop(domain_state);
            return Ok(ServiceAuthorityExternalEffectPermit {
                fence: Arc::clone(&self.fence),
                domain: Arc::clone(&self.domain),
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
        if let Some(disposition) = state.terminal {
            return Err(ServiceAuthorityWorkReservationError::Terminal {
                disposition,
                error: service_authority_terminal(disposition),
            });
        }
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
        if !try_acquire_service_domain_work(&self.domain) {
            return Err(ServiceAuthorityWorkReservationError::NonTerminal(
                service_authority_unavailable(
                    "finite service authority has too much in-flight work",
                ),
            ));
        }
        let witness = state.witness.clone();
        drop(domain_state);
        drop(state);
        Ok(ServiceAuthorityExternalEffectPermit {
            fence: Arc::clone(&self.fence),
            domain: Arc::clone(&self.domain),
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
    next_ticket: u64,
    by_token: HashMap<String, Weak<Mutex<ServiceAuthorityFenceState>>>,
    domains_by_token: HashMap<String, Weak<ServiceAuthorityDomain>>,
    /// Pending/ambiguous intents retain their exact domain even when no
    /// publication exists, so a later registration cannot bypass the ticket.
    pending_domains: HashMap<String, Arc<ServiceAuthorityDomain>>,
}

#[derive(Clone)]
pub struct ServiceAuthorityFenceRegistry {
    state: Arc<Mutex<ServiceAuthorityFenceRegistryState>>,
    changed: Arc<Notify>,
}

impl Default for ServiceAuthorityFenceRegistry {
    fn default() -> Self {
        Self {
            state: Arc::new(Mutex::new(ServiceAuthorityFenceRegistryState::default())),
            changed: Arc::new(Notify::new()),
        }
    }
}

impl std::fmt::Debug for ServiceAuthorityFenceRegistry {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("ServiceAuthorityFenceRegistry([REDACTED])")
    }
}

impl ServiceAuthorityFenceRegistry {
    #[cfg(any(test, feature = "test-support"))]
    pub fn is_same_registry(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.state, &other.state)
    }

    fn install_terminal_intent(
        &self,
        token_ids: &BTreeSet<String>,
        disposition: ServiceAuthorityDisposition,
    ) -> SnapbackResult<Option<PremarkedServiceAuthorityTerminal>> {
        let mut registry = self
            .state
            .lock()
            .map_err(|_| service_authority_unavailable("the service fence registry is poisoned"))?;
        if token_ids
            .iter()
            .any(|token_id| registry.pending_domains.contains_key(token_id))
        {
            return Ok(None);
        }
        registry.next_ticket = registry
            .next_ticket
            .checked_add(1)
            .ok_or_else(|| service_authority_unavailable("service fence tickets are exhausted"))?;
        let ticket = registry.next_ticket;
        let domains = token_ids
            .iter()
            .map(|token_id| {
                let domain = registry
                    .pending_domains
                    .get(token_id)
                    .cloned()
                    .or_else(|| {
                        registry
                            .domains_by_token
                            .get(token_id)
                            .and_then(Weak::upgrade)
                    })
                    .unwrap_or_else(|| Arc::new(ServiceAuthorityDomain::default()));
                registry
                    .domains_by_token
                    .insert(token_id.clone(), Arc::downgrade(&domain));
                registry
                    .pending_domains
                    .insert(token_id.clone(), Arc::clone(&domain));
                (token_id.clone(), domain)
            })
            .collect::<Vec<_>>();
        drop(registry);

        let prepared = PremarkedServiceAuthorityTerminal {
            registry: self.clone(),
            ticket,
            domains,
            disposition,
            settled: false,
            ambiguous: false,
        };
        for (_, domain) in &prepared.domains {
            let mut state = domain.state.lock().map_err(|_| {
                service_authority_unavailable("a service authority domain gate is poisoned")
            })?;
            if state.pending_tickets.insert(ticket, disposition).is_some() {
                return Err(service_authority_unavailable(
                    "a service authority terminal ticket was reused",
                ));
            }
        }
        Ok(Some(prepared))
    }

    /// Close only the exact planned tokens to new finite-service work, then
    /// asynchronously drain their predecessor operations. Overlapping gates
    /// serialize; disjoint tokens remain live and drain independently.
    pub async fn acquire_terminal_gate(
        &self,
        token_ids: &[String],
        disposition: ServiceAuthorityDisposition,
    ) -> SnapbackResult<ServiceAuthorityTerminalGate> {
        let token_ids = token_ids.iter().cloned().collect::<BTreeSet<_>>();
        loop {
            let notified = self.changed.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if let Some(prepared) = self.install_terminal_intent(&token_ids, disposition)? {
                let gate = ServiceAuthorityTerminalGate {
                    prepared: Some(prepared),
                };
                for (_, domain) in &gate
                    .prepared
                    .as_ref()
                    .expect("terminal gate retains its reservation")
                    .domains
                {
                    loop {
                        let drained = domain.active_work.load(Ordering::SeqCst) == 0;
                        if drained {
                            break;
                        }
                        let changed = domain.changed.notified();
                        tokio::pin!(changed);
                        changed.as_mut().enable();
                        if domain.active_work.load(Ordering::SeqCst) == 0 {
                            break;
                        }
                        changed.await;
                    }
                }
                return Ok(gate);
            }
            notified.await;
        }
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn synthetic_publication_for_test(
        &self,
        token_id: &str,
        validated_at_ms: u64,
        expires_at_ms: u64,
        monotonic_now: Instant,
    ) -> SnapbackResult<ServiceAuthorityPublication> {
        self.register(
            ServiceAuthorityWitness {
                token_id: token_id.to_owned(),
                grant_id: "durable-grant-a".to_owned(),
                actor_user_id: "agent-a".to_owned(),
                effective_user_id: Some("user-a".to_owned()),
                credential_id: "credential-a".to_owned(),
                credential_generation: 1,
                expires_at_ms,
                grant_expires_at_ms: None,
            },
            validated_at_ms,
            monotonic_now,
        )
    }

    /// Register while the caller still owns the app/database lock used for
    /// durable resolution. A terminal transaction therefore either premarks
    /// this exact fence later or committed before resolution and makes the
    /// durable lookup fail; it cannot pass unseen between lookup and install.
    pub fn register(
        &self,
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
        registry
            .domains_by_token
            .retain(|_, candidate| candidate.strong_count() != 0);
        let token_id = witness.token_id.clone();
        let domain = registry
            .pending_domains
            .get(&token_id)
            .cloned()
            .or_else(|| {
                registry
                    .domains_by_token
                    .get(&token_id)
                    .and_then(Weak::upgrade)
            })
            .unwrap_or_else(|| Arc::new(ServiceAuthorityDomain::default()));
        registry
            .domains_by_token
            .insert(token_id.clone(), Arc::downgrade(&domain));
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
                if state.witness != witness || state.terminal.is_some() {
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
                    terminal: None,
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

#[derive(Debug)]
struct PremarkedServiceAuthorityTerminal {
    registry: ServiceAuthorityFenceRegistry,
    ticket: u64,
    domains: Vec<(String, Arc<ServiceAuthorityDomain>)>,
    disposition: ServiceAuthorityDisposition,
    settled: bool,
    ambiguous: bool,
}

impl PremarkedServiceAuthorityTerminal {
    /// Publish the committed terminal disposition without reopening the exact
    /// token domain. The ticket is released only by the after-Local finalizer,
    /// after every lifecycle/notifier effect queued by the transaction.
    fn publish_terminal(&mut self) {
        let registry = self
            .registry
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        for (token_id, _) in &self.domains {
            if let Some(fence) = registry.by_token.get(token_id).and_then(Weak::upgrade) {
                let mut state = fence
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                state.terminal = Some(match (state.terminal, self.disposition) {
                    (Some(ServiceAuthorityDisposition::DurableDelete), _)
                    | (_, ServiceAuthorityDisposition::DurableDelete) => {
                        ServiceAuthorityDisposition::DurableDelete
                    }
                    _ => ServiceAuthorityDisposition::Carrier,
                });
            }
        }
    }

    fn release_ticket(&mut self) {
        let mut registry = self
            .registry
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        for (token_id, domain) in &self.domains {
            let mut domain_state = domain
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            domain_state.pending_tickets.remove(&self.ticket);
            if domain_state.pending_tickets.is_empty()
                && registry
                    .pending_domains
                    .get(token_id)
                    .is_some_and(|pending| Arc::ptr_eq(pending, domain))
            {
                registry.pending_domains.remove(token_id);
            }
            drop(domain_state);
            domain.changed.notify_waiters();
        }
        self.settled = true;
        drop(registry);
        self.registry.changed.notify_waiters();
    }

    fn settle(&mut self, committed: bool) {
        if committed {
            self.publish_terminal();
        }
        self.release_ticket();
    }
}

impl ServiceAuthorityTerminalGate {
    fn matches(
        &self,
        registry: &ServiceAuthorityFenceRegistry,
        token_ids: &BTreeSet<String>,
        disposition: ServiceAuthorityDisposition,
    ) -> bool {
        self.prepared.as_ref().is_some_and(|prepared| {
            Arc::ptr_eq(&prepared.registry.state, &registry.state)
                && prepared.disposition == disposition
                && prepared
                    .domains
                    .iter()
                    .map(|(token_id, _)| token_id)
                    .eq(token_ids.iter())
        })
    }

    fn take_prepared(&mut self) -> PremarkedServiceAuthorityTerminal {
        self.prepared
            .take()
            .expect("an exact terminal gate is consumed only once")
    }
}

impl Drop for ServiceAuthorityTerminalGate {
    fn drop(&mut self) {
        drop(self.prepared.take());
    }
}

struct ActiveServiceTerminalGateScope;

impl Drop for ActiveServiceTerminalGateScope {
    fn drop(&mut self) {
        ACTIVE_SERVICE_TERMINAL_GATE.with(|slot| {
            drop(slot.borrow_mut().take());
        });
        SERVICE_TERMINAL_GATE_SCOPE_ACTIVE.with(|active| active.set(false));
    }
}

/// Bind an asynchronously drained exact-token gate to one synchronous storage
/// call. The storage interlock consumes it only after its own transaction plan
/// reproduces the exact token set and disposition.
pub fn with_service_authority_terminal_gate<T>(
    gate: ServiceAuthorityTerminalGate,
    operation: impl FnOnce() -> T,
) -> T {
    SERVICE_TERMINAL_GATE_SCOPE_ACTIVE.with(|active| {
        assert!(
            !active.replace(true),
            "an exact service terminal gate scope is already active"
        );
    });
    let _scope = ActiveServiceTerminalGateScope;
    ACTIVE_SERVICE_TERMINAL_GATE.with(|slot| {
        let previous = slot.borrow_mut().replace(gate);
        assert!(
            previous.is_none(),
            "an exact service terminal gate is already installed"
        );
    });
    operation()
}

impl Drop for PremarkedServiceAuthorityTerminal {
    fn drop(&mut self) {
        if !self.settled && !self.ambiguous {
            self.settle(false);
        }
    }
}

impl PremarkedServiceAuthorityTerminal {
    fn committed(self) -> SnapbackResult<()> {
        // Commit hooks run while managed callers still own Local/SQLite. Move
        // both service-fence publication and exact-ticket settlement across
        // that boundary. The publication is an ordinary effect, so the
        // handler can queue lifecycle fanout behind it; settlement is a
        // finalizer, so no overlapping service ending can pass until that
        // fanout has completed.
        let mut prepared = self;
        prepared.ambiguous = true;
        let prepared = Arc::new(Mutex::new(Some(prepared)));
        let publication = Arc::clone(&prepared);
        crate::exec_guard::run_or_defer_after_local(move || {
            if let Some(prepared) = publication
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .as_mut()
            {
                prepared.publish_terminal();
            }
        });
        crate::exec_guard::run_or_defer_after_local_finalizer(move || {
            if let Some(mut prepared) = prepared
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .take()
            {
                prepared.release_ticket();
            }
        });
        Ok(())
    }

    fn rolled_back(self) {
        let mut prepared = self;
        prepared.ambiguous = true;
        crate::exec_guard::run_or_defer_after_local_finalizer(move || {
            prepared.release_ticket();
        });
    }

    fn mark_ambiguous(&mut self) {
        // An unknown SQLite outcome must never reopen a prepared authority.
        // Keep this exact ticket installed and retain this handle so a later
        // durable predecessor/successor proof can settle only this mutation.
        self.ambiguous = true;
    }
}

impl ServiceAuthorityFenceRegistry {
    /// Test-only operation that settles the exact terminal previously admitted
    /// by the real fence gate. Tests can exercise timing without receiving the
    /// opaque prepared terminal or implementing settlement semantics.
    #[cfg(any(test, feature = "test-support"))]
    pub fn commit_terminal_for_test(
        &self,
        token_ids: &[String],
        disposition: ServiceAuthorityDisposition,
    ) -> SnapbackResult<()> {
        self.prepare_terminal(token_ids, disposition)?.committed()
    }

    fn prepare_terminal(
        &self,
        token_ids: &[String],
        disposition: ServiceAuthorityDisposition,
    ) -> SnapbackResult<PremarkedServiceAuthorityTerminal> {
        let token_ids = token_ids.iter().cloned().collect::<BTreeSet<_>>();
        let gate_scope_active = SERVICE_TERMINAL_GATE_SCOPE_ACTIVE.with(Cell::get);
        if gate_scope_active {
            return ACTIVE_SERVICE_TERMINAL_GATE.with(|slot| {
                let borrowed = slot.borrow();
                let Some(installed) = borrowed.as_ref() else {
                    return Err(service_authority_unavailable(
                        "the installed service terminal gate was already consumed",
                    ));
                };
                let matches = installed.matches(self, &token_ids, disposition);
                drop(borrowed);
                if !matches {
                    return Err(service_authority_unavailable(
                        "the installed service terminal gate does not match the durable plan",
                    ));
                }
                let mut gate = slot
                    .borrow_mut()
                    .take()
                    .expect("the exact installed terminal gate was just matched");
                Ok(gate.take_prepared())
            });
        }

        // Direct-library callers have no async owner. Install the same exact
        // intent, but never wait while Local/SQLite may be held: retained work
        // is a fail-closed refusal and Drop exact-unmarks the unused ticket.
        let Some(prepared) = self.install_terminal_intent(&token_ids, disposition)? else {
            return Err(service_authority_unavailable(
                "another exact service-authority termination is pending",
            ));
        };
        if prepared
            .domains
            .iter()
            .any(|(_, domain)| domain.active_work.load(Ordering::SeqCst) != 0)
        {
            return Err(service_authority_unavailable(
                "retained service-authority work requires an async exact-token gate",
            ));
        }
        Ok(prepared)
    }

    pub fn kernel_commit_interlock(
        &self,
        database: &snapback_kernel::storage::ServingDatabase,
    ) -> ServiceAuthorityCommitInterlock {
        let registry = self.clone();
        let factory = database.service_authority_terminal_factory();
        database.service_authority_commit_interlock(move |token_ids, disposition| {
            let prepared = registry.prepare_terminal(token_ids, disposition)?;
            Ok(opaque_service_terminal(&factory, prepared))
        })
    }
}

fn opaque_service_terminal(
    factory: &ServiceAuthorityTerminalFactory,
    prepared: PremarkedServiceAuthorityTerminal,
) -> PreparedServiceAuthorityTerminal {
    let state = Arc::new(Mutex::new(Some(prepared)));
    let committed = state.clone();
    let rolled_back = state.clone();
    let ambiguous = state;
    factory.prepared(
        move || {
            committed
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .take()
                .expect("service terminal settles once")
                .committed()
        },
        move || {
            if let Some(prepared) = rolled_back
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .take()
            {
                prepared.rolled_back();
            }
        },
        move || {
            if let Some(prepared) = ambiguous
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .as_mut()
            {
                prepared.mark_ambiguous();
            }
        },
    )
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::crypto::OsRandom;
    use crate::auth::keyring::AuthKeyringStore;
    use crate::auth::provider::AuthClock;
    use crate::contract_types::AuthProviderProfile;
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

    struct ManualClock {
        epoch_ms: AtomicU64,
        monotonic_origin: Instant,
        monotonic_ms: AtomicU64,
    }

    impl ManualClock {
        fn new(epoch_ms: u64) -> Self {
            Self {
                epoch_ms: AtomicU64::new(epoch_ms),
                monotonic_origin: Instant::now(),
                monotonic_ms: AtomicU64::new(0),
            }
        }

        fn set(&self, epoch_ms: u64, monotonic_ms: u64) {
            self.epoch_ms.store(epoch_ms, Ordering::SeqCst);
            self.monotonic_ms.store(monotonic_ms, Ordering::SeqCst);
        }
    }

    impl AuthClock for ManualClock {
        fn epoch_ms(&self) -> u64 {
            self.epoch_ms.load(Ordering::SeqCst)
        }

        fn monotonic_now(&self) -> Instant {
            self.monotonic_origin + Duration::from_millis(self.monotonic_ms.load(Ordering::SeqCst))
        }
    }

    fn witness(token_id: &str, expires_at_ms: u64) -> ServiceAuthorityWitness {
        ServiceAuthorityWitness {
            token_id: token_id.to_owned(),
            grant_id: "grant-a".to_owned(),
            actor_user_id: "agent-a".to_owned(),
            effective_user_id: Some("user-a".to_owned()),
            credential_id: "credential-a".to_owned(),
            credential_generation: 3,
            expires_at_ms,
            grant_expires_at_ms: None,
        }
    }

    #[test]
    fn rollback_reopens_but_commit_and_ambiguity_never_do() {
        let registry = ServiceAuthorityFenceRegistry::default();
        let monotonic = Instant::now();
        let publication = registry
            .register(witness("token-a", 200), 100, monotonic)
            .expect("register exact witness");
        assert_eq!(
            publication.try_publish(100, monotonic, || Ok(7)).unwrap(),
            Some(7)
        );

        let rollback = registry
            .prepare_terminal(
                &["token-a".to_owned()],
                ServiceAuthorityDisposition::Carrier,
            )
            .expect("premark rollback");
        assert_eq!(
            publication
                .try_publish(101, monotonic, || Ok(()))
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_POLICY_UNAVAILABLE"
        );
        drop(rollback);
        assert!(
            publication
                .try_publish(101, monotonic, || Ok(()))
                .unwrap()
                .is_some()
        );

        let committed = registry
            .prepare_terminal(
                &["token-a".to_owned()],
                ServiceAuthorityDisposition::DurableDelete,
            )
            .expect("premark commit");
        committed.committed().expect("settle commit");
        assert!(
            publication
                .try_publish(102, monotonic, || Ok(()))
                .unwrap()
                .is_none()
        );
        assert_eq!(
            publication.terminal_disposition(102, monotonic),
            ServiceAuthorityDisposition::DurableDelete
        );

        let ambiguous_publication = registry
            .register(witness("token-b", 200), 100, monotonic)
            .expect("register second witness");
        let mut ambiguous = registry
            .prepare_terminal(
                &["token-b".to_owned()],
                ServiceAuthorityDisposition::Carrier,
            )
            .expect("premark ambiguity");
        ambiguous.mark_ambiguous();
        assert_eq!(
            ambiguous_publication
                .try_publish(102, monotonic, || Ok(()))
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_POLICY_UNAVAILABLE"
        );
        assert_eq!(
            ambiguous_publication.resolve_act(102, monotonic).unwrap(),
            ServiceAuthorityActResolution::Unavailable
        );
        ambiguous.rolled_back();
        assert!(matches!(
            ambiguous_publication.resolve_act(102, monotonic).unwrap(),
            ServiceAuthorityActResolution::Current(_)
        ));
    }

    #[test]
    fn ambiguous_reconciliation_settles_only_its_exact_token_domain() {
        let registry = ServiceAuthorityFenceRegistry::default();
        let monotonic = Instant::now();
        let first_publication = registry
            .register(witness("token-a", 200), 100, monotonic)
            .expect("register first witness");
        let second_publication = registry
            .register(witness("token-b", 200), 100, monotonic)
            .expect("register second witness");
        let mut first = registry
            .prepare_terminal(
                &["token-a".to_owned()],
                ServiceAuthorityDisposition::Carrier,
            )
            .expect("premark first");
        let mut second = registry
            .prepare_terminal(
                &["token-b".to_owned()],
                ServiceAuthorityDisposition::DurableDelete,
            )
            .expect("premark second");
        first.mark_ambiguous();
        second.mark_ambiguous();

        first.rolled_back();
        assert!(matches!(
            first_publication.resolve_act(101, monotonic).unwrap(),
            ServiceAuthorityActResolution::Current(_)
        ));
        assert_eq!(
            second_publication.resolve_act(101, monotonic).unwrap(),
            ServiceAuthorityActResolution::Unavailable,
            "settling one ambiguous token must not clear another token's ticket"
        );
        second.committed().expect("settle exact successor");
        assert_eq!(
            second_publication.resolve_act(101, monotonic).unwrap(),
            ServiceAuthorityActResolution::Terminal(ServiceAuthorityDisposition::DurableDelete)
        );
    }

    #[test]
    fn committed_terminal_precedes_a_later_pending_ticket() {
        let registry = ServiceAuthorityFenceRegistry::default();
        let monotonic = Instant::now();
        let publication = registry
            .register(witness("token-a", 200), 100, monotonic)
            .expect("register witness");
        registry
            .prepare_terminal(
                &["token-a".to_owned()],
                ServiceAuthorityDisposition::DurableDelete,
            )
            .expect("prepare committed terminal")
            .committed()
            .expect("commit terminal");
        let pending = registry
            .prepare_terminal(
                &["token-a".to_owned()],
                ServiceAuthorityDisposition::Carrier,
            )
            .expect("prepare idempotent sibling");
        assert!(
            publication
                .try_publish(101, monotonic, || Ok(()))
                .expect("committed terminal is classified, not unavailable")
                .is_none()
        );
        assert_eq!(
            publication.resolve_act(101, monotonic).unwrap(),
            ServiceAuthorityActResolution::Terminal(ServiceAuthorityDisposition::DurableDelete)
        );
        drop(pending);
    }

    #[test]
    fn nested_local_validation_reuses_the_outer_connection_act_witness() {
        let registry = ServiceAuthorityFenceRegistry::default();
        let monotonic = Instant::now();
        let publication = registry
            .register(witness("token-a", 200), 100, monotonic)
            .expect("register witness");
        let nested = publication
            .try_publish(101, monotonic, || {
                assert_eq!(publication.expired_deadline_terminal(101, monotonic)?, None);
                assert!(matches!(
                    publication.resolve_act(101, monotonic)?,
                    ServiceAuthorityActResolution::Current(ServiceAuthorityWitness {
                        ref token_id,
                        ..
                    }) if token_id == "token-a"
                ));
                Ok(7)
            })
            .expect("nested validation under outer act");
        assert_eq!(nested, Some(7));
    }

    #[test]
    fn out_of_order_retained_guard_drop_does_not_bypass_terminal_authority() {
        let registry = ServiceAuthorityFenceRegistry::default();
        let monotonic = Instant::now();
        let publication_a = registry
            .register(witness("token-a", 200), 100, monotonic)
            .expect("register token A witness");
        let publication_b = registry
            .register(witness("token-b", 200), 100, monotonic)
            .expect("register token B witness");
        let permit_a = publication_a
            .begin_authority_work(101, monotonic)
            .expect("retain token A authority work");
        let permit_b = publication_b
            .begin_authority_work(101, monotonic)
            .expect("retain token B authority work");
        let guard_a = permit_a.retain_authority();
        let guard_b = permit_b.retain_authority();

        drop(guard_a);
        drop(permit_a);
        registry
            .prepare_terminal(
                &["token-a".to_owned()],
                ServiceAuthorityDisposition::DurableDelete,
            )
            .expect("token A terminal gate drains after its permit drops")
            .committed()
            .expect("commit token A terminal authority");

        assert!(matches!(
            publication_b.resolve_act(101, monotonic).unwrap(),
            ServiceAuthorityActResolution::Current(ServiceAuthorityWitness {
                ref token_id,
                ..
            }) if token_id == "token-b"
        ));
        assert_eq!(
            publication_a.resolve_act(101, monotonic).unwrap(),
            ServiceAuthorityActResolution::Terminal(ServiceAuthorityDisposition::DurableDelete),
            "dropping token A's guard out of order must not leave its witness active"
        );

        drop(guard_b);
        drop(permit_b);
    }

    #[test]
    fn clock_rollback_and_expiry_fail_closed() {
        let registry = ServiceAuthorityFenceRegistry::default();
        let monotonic = Instant::now();
        let publication = registry
            .register(witness("token-a", 110), 100, monotonic)
            .expect("register exact witness");
        assert_eq!(
            publication.resolve_act(99, monotonic).unwrap(),
            ServiceAuthorityActResolution::Unavailable
        );
        assert_eq!(
            publication
                .try_publish(99, monotonic, || Ok(()))
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_POLICY_UNAVAILABLE"
        );
        assert!(matches!(
            publication.resolve_act(100, monotonic).unwrap(),
            ServiceAuthorityActResolution::Current(_)
        ));
        assert!(matches!(
            publication.resolve_act(110, monotonic).unwrap(),
            ServiceAuthorityActResolution::Unavailable
        ));
        assert_eq!(
            publication
                .try_publish(110, monotonic, || Ok(()))
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_POLICY_UNAVAILABLE"
        );
        assert_eq!(
            publication.terminal_disposition(110, monotonic),
            ServiceAuthorityDisposition::Carrier
        );
    }

    #[test]
    fn retained_publication_always_samples_its_provider_clock_domain() {
        let clock = Arc::new(ManualClock::new(100));
        let provider = Arc::new(
            AuthProvider::new_with_dependencies(
                AuthProviderProfile::Test,
                Arc::new(AuthKeyringStore::in_memory()),
                Arc::new(OsRandom),
                clock.clone(),
            )
            .expect("provider clock fixture"),
        );
        let registry = ServiceAuthorityFenceRegistry::default();
        let publication = registry
            .register(witness("token-clock", 110), 100, clock.monotonic_now())
            .expect("register provider-clock witness")
            .with_provider_clock(provider.clone());

        provider.seed_session_clock_floor(105);
        clock.set(99, 0);
        assert!(matches!(
            publication.resolve_act(0, Instant::now()).unwrap(),
            ServiceAuthorityActResolution::Current(_)
        ));
        clock.set(110, 10);
        assert_eq!(
            publication.resolve_act(0, Instant::now()).unwrap(),
            ServiceAuthorityActResolution::Unavailable
        );
    }

    #[test]
    fn grant_deadline_is_durable_while_token_deadline_is_carrier() {
        let registry = ServiceAuthorityFenceRegistry::default();
        let monotonic = Instant::now();
        let mut grant_limited = witness("token-grant", 110);
        grant_limited.grant_expires_at_ms = Some(105);
        let publication = registry
            .register(grant_limited, 100, monotonic)
            .expect("register grant-limited witness");
        assert_eq!(
            publication
                .expired_deadline_terminal(105, monotonic + Duration::from_millis(5))
                .expect("classify grant deadline")
                .expect("grant deadline is due")
                .disposition,
            ServiceAuthorityDisposition::DurableDelete
        );

        let token_limited = registry
            .register(witness("token-only", 105), 100, monotonic)
            .expect("register token-limited witness");
        assert_eq!(
            token_limited
                .expired_deadline_terminal(105, monotonic + Duration::from_millis(5))
                .expect("classify token deadline")
                .expect("token deadline is due")
                .disposition,
            ServiceAuthorityDisposition::Carrier
        );

        let mut far_later_grant = witness("token-short", 105);
        far_later_grant.grant_expires_at_ms = Some(u64::MAX);
        let far_later = registry
            .register(far_later_grant, 100, monotonic)
            .expect("a later grant deadline cannot make a short token unrepresentable");
        assert_eq!(
            far_later
                .expired_deadline_terminal(105, monotonic + Duration::from_millis(5))
                .expect("classify shorter token deadline")
                .expect("token deadline is due")
                .disposition,
            ServiceAuthorityDisposition::Carrier
        );
    }

    #[test]
    fn delayed_monotonic_observer_spends_the_original_terminal_close_budget() {
        let registry = ServiceAuthorityFenceRegistry::default();
        let monotonic = Instant::now();
        let grace = crate::auth::session_projection::TERMINAL_CLOSE_GRACE;
        let projected_deadline = monotonic + Duration::from_millis(10);
        let delayed_observation = projected_deadline + grace + Duration::from_millis(25);
        let publication = registry
            .register(witness("token-delayed", 110), 100, monotonic)
            .expect("register delayed-observer witness");

        let terminal = publication
            .expired_deadline_terminal(100, delayed_observation)
            .expect("classify delayed monotonic expiry")
            .expect("projected monotonic deadline is due");
        assert_eq!(terminal.close_by, projected_deadline + grace);
        assert!(
            terminal.close_by < delayed_observation,
            "observer latency must consume, not restart, terminal close grace"
        );

        let wall_observation = monotonic + Duration::from_millis(1);
        let wall_jump = registry
            .register(witness("token-wall-jump", 110), 100, monotonic)
            .expect("register wall-jump witness")
            .expired_deadline_terminal(110, wall_observation)
            .expect("classify forward wall jump")
            .expect("epoch deadline is due before its monotonic projection");
        assert_eq!(
            wall_jump.close_by,
            wall_observation + grace,
            "a forward wall-clock proof starts grace at its observation cut"
        );
    }

    #[test]
    fn canonical_route_by_terminal_ending_pause_matrix_fails_closed() {
        #[derive(Clone, Copy, Debug)]
        enum Route {
            Query,
            Mutation,
            Action,
            AuthSession,
            ConnectionInsert,
            ConnectionAct,
        }
        #[derive(Clone, Copy, Debug)]
        enum Ending {
            GrantRevoke,
            CredentialRotate,
            CredentialRevoke,
            PrincipalDeactivate,
            TokenExpiry,
            TokenCapEvict,
        }
        const ROUTES: [Route; 6] = [
            Route::Query,
            Route::Mutation,
            Route::Action,
            Route::AuthSession,
            Route::ConnectionInsert,
            Route::ConnectionAct,
        ];
        const ENDINGS: [Ending; 6] = [
            Ending::GrantRevoke,
            Ending::CredentialRotate,
            Ending::CredentialRevoke,
            Ending::PrincipalDeactivate,
            Ending::TokenExpiry,
            Ending::TokenCapEvict,
        ];

        for route in ROUTES {
            for ending in ENDINGS {
                let registry = ServiceAuthorityFenceRegistry::default();
                let monotonic = Instant::now();
                let token_id = format!("token-{route:?}-{ending:?}");
                let expiry = matches!(ending, Ending::TokenExpiry);
                let publication = registry
                    .register(
                        witness(&token_id, if expiry { 101 } else { 1_000 }),
                        100,
                        monotonic,
                    )
                    .expect("resolve and register exact finite witness");

                if !expiry {
                    let disposition = if matches!(ending, Ending::TokenCapEvict) {
                        ServiceAuthorityDisposition::Carrier
                    } else {
                        ServiceAuthorityDisposition::DurableDelete
                    };
                    registry
                        .prepare_terminal(std::slice::from_ref(&token_id), disposition)
                        .expect("pause-after-resolution terminal premark")
                        .committed()
                        .expect("commit exact terminal ending");
                }

                let mut effect_ran = false;
                match route {
                    Route::ConnectionAct => {
                        assert!(
                            !matches!(
                                publication.resolve_act(101, monotonic),
                                Ok(ServiceAuthorityActResolution::Current(_))
                            ),
                            "{route:?} published after {ending:?}"
                        );
                    }
                    Route::Action => {
                        assert!(
                            publication.begin_external_effect(101, monotonic).is_err(),
                            "{route:?} began a native effect after {ending:?}"
                        );
                        let result = publication.try_publish(101, monotonic, || {
                            effect_ran = true;
                            Ok(())
                        });
                        assert!(
                            matches!(result, Ok(None) | Err(_)),
                            "{route:?} published after {ending:?}"
                        );
                    }
                    Route::Query
                    | Route::Mutation
                    | Route::AuthSession
                    | Route::ConnectionInsert => {
                        let result = publication.try_publish(101, monotonic, || {
                            effect_ran = true;
                            Ok(())
                        });
                        assert!(
                            matches!(result, Ok(None) | Err(_)),
                            "{route:?} published after {ending:?}"
                        );
                    }
                }
                assert!(!effect_ran, "{route:?} effect ran after {ending:?}");
                assert_eq!(
                    publication.terminal_disposition(101, monotonic),
                    if matches!(ending, Ending::TokenExpiry | Ending::TokenCapEvict) {
                        ServiceAuthorityDisposition::Carrier
                    } else {
                        ServiceAuthorityDisposition::DurableDelete
                    },
                    "{route:?} classified {ending:?} incorrectly"
                );
            }
        }
    }

    #[tokio::test]
    async fn terminal_gate_closes_new_effects_then_drains_predecessor_initiation() {
        let registry = ServiceAuthorityFenceRegistry::default();
        let monotonic = Instant::now();
        let publication = registry
            .register(witness("token-a", 1_000), 100, monotonic)
            .expect("register witness");
        let permit = publication
            .begin_external_effect(100, monotonic)
            .expect("begin effect");
        let terminal_registry = registry.clone();
        let terminal = tokio::spawn(async move {
            let gate = terminal_registry
                .acquire_terminal_gate(
                    &["token-a".to_owned()],
                    ServiceAuthorityDisposition::DurableDelete,
                )
                .await
                .expect("close and drain service domain");
            let prepared = with_service_authority_terminal_gate(gate, || {
                terminal_registry.prepare_terminal(
                    &["token-a".to_owned()],
                    ServiceAuthorityDisposition::DurableDelete,
                )
            })
            .expect("adopt exact drained premark after initiation");
            prepared.committed().expect("commit terminal");
        });

        tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                match publication.begin_external_effect(101, monotonic) {
                    Ok(extra) => extra.initiated(),
                    Err(_) => break,
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("terminal intent closes later effect initiation");
        assert!(
            !terminal.is_finished(),
            "terminal cannot pass an already-initiated native effect"
        );
        permit.initiated();
        tokio::time::timeout(Duration::from_secs(1), terminal)
            .await
            .expect("terminal completes after initiation")
            .expect("terminal task");
        assert!(publication.begin_external_effect(101, monotonic).is_err());
    }

    #[tokio::test]
    async fn retained_authority_work_and_terminal_gate_are_mutually_exclusive() {
        let registry = ServiceAuthorityFenceRegistry::default();
        let monotonic = Instant::now();
        let publication = registry
            .register(witness("token-retained", 1_000), 100, monotonic)
            .expect("register witness");

        let terminal = registry
            .prepare_terminal(
                &["token-retained".to_owned()],
                ServiceAuthorityDisposition::DurableDelete,
            )
            .expect("terminal premark wins");
        assert!(
            publication.begin_authority_work(101, monotonic).is_err(),
            "a retained permit cannot start after terminal premark"
        );
        drop(terminal);

        let permit = publication
            .begin_authority_work(101, monotonic)
            .expect("rolled-back terminal premark reopens authority work");
        let terminal_registry = registry.clone();
        let terminal = tokio::spawn(async move {
            terminal_registry
                .acquire_terminal_gate(
                    &["token-retained".to_owned()],
                    ServiceAuthorityDisposition::DurableDelete,
                )
                .await
                .expect("terminal waits behind retained work")
        });

        tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                match publication.begin_authority_work(101, monotonic) {
                    Ok(extra) => drop(extra),
                    Err(_) => break,
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("terminal intent closes later retained work");
        assert!(!terminal.is_finished());
        drop(permit);
        let gate = tokio::time::timeout(Duration::from_secs(1), terminal)
            .await
            .expect("terminal gate completes after retained work drops")
            .expect("terminal task");
        let prepared = with_service_authority_terminal_gate(gate, || {
            registry.prepare_terminal(
                &["token-retained".to_owned()],
                ServiceAuthorityDisposition::DurableDelete,
            )
        })
        .expect("exact premark adopts the asynchronously drained domain");
        drop(prepared);
        assert!(publication.begin_authority_work(101, monotonic).is_ok());
    }

    #[test]
    fn direct_terminal_prepare_refuses_an_active_publication_without_waiting_on_its_fence() {
        let registry = ServiceAuthorityFenceRegistry::default();
        let monotonic = Instant::now();
        let publication = registry
            .register(witness("token-direct", 1_000), 100, monotonic)
            .expect("register witness");
        let (entered_tx, entered_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let publisher = std::thread::spawn(move || {
            publication
                .try_publish(101, monotonic, || {
                    entered_tx.send(()).expect("report held publication");
                    release_rx.recv().expect("release held publication");
                    Ok(())
                })
                .expect("held publication remains valid")
        });
        entered_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("publication holds its exact fence");

        let terminal_registry = registry.clone();
        let (terminal_tx, terminal_rx) = std::sync::mpsc::channel();
        let terminal = std::thread::spawn(move || {
            let result = terminal_registry.prepare_terminal(
                &["token-direct".to_owned()],
                ServiceAuthorityDisposition::DurableDelete,
            );
            terminal_tx.send(result).expect("report direct prepare");
        });
        let result = terminal_rx.recv_timeout(Duration::from_millis(250));
        release_tx.send(()).expect("release held publication");
        assert_eq!(publisher.join().expect("publisher joins"), Some(()));
        terminal.join().expect("terminal thread joins");
        let error =
            match result.expect("direct prepare must refuse without waiting on the exact fence") {
                Ok(_) => panic!("an active publication requires the async domain drain"),
                Err(error) => error,
            };
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_POLICY_UNAVAILABLE");
    }

    #[tokio::test]
    async fn exact_token_gate_drains_only_its_token_and_leaves_unrelated_work_live() {
        let registry = ServiceAuthorityFenceRegistry::default();
        let monotonic = Instant::now();
        let token_a = registry
            .register(witness("token-a", 1_000), 100, monotonic)
            .expect("register token A");
        let token_b = registry
            .register(witness("token-b", 1_000), 100, monotonic)
            .expect("register token B");
        let predecessor = token_a
            .begin_authority_work(101, monotonic)
            .expect("retain token A predecessor");

        let terminal_registry = registry.clone();
        let terminal = tokio::spawn(async move {
            terminal_registry
                .acquire_terminal_gate(
                    &["token-a".to_owned()],
                    ServiceAuthorityDisposition::DurableDelete,
                )
                .await
                .expect("drain token A only")
        });
        tokio::time::timeout(Duration::from_secs(1), async {
            while token_a.begin_authority_work(101, monotonic).is_ok() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("token A intent becomes visible");
        assert!(!terminal.is_finished());

        let unrelated = token_b
            .begin_authority_work(101, monotonic)
            .expect("token B work remains available");
        assert_eq!(
            token_b
                .try_publish(101, monotonic, || Ok("token-b-live"))
                .expect("token B publication remains available"),
            Some("token-b-live")
        );
        drop(unrelated);

        drop(predecessor);
        let gate = tokio::time::timeout(Duration::from_secs(1), terminal)
            .await
            .expect("token A drain completes")
            .expect("token A terminal task");
        let prepared = with_service_authority_terminal_gate(gate, || {
            registry.prepare_terminal(
                &["token-a".to_owned()],
                ServiceAuthorityDisposition::DurableDelete,
            )
        })
        .expect("transaction adopts token A gate");
        prepared.committed().expect("commit token A ending");
        assert_eq!(
            token_a.resolve_act(101, monotonic).unwrap(),
            ServiceAuthorityActResolution::Terminal(ServiceAuthorityDisposition::DurableDelete)
        );
        assert!(matches!(
            token_b.resolve_act(101, monotonic).unwrap(),
            ServiceAuthorityActResolution::Current(_)
        ));
    }

    #[tokio::test]
    async fn absent_token_registration_joins_the_pending_exact_domain() {
        let registry = ServiceAuthorityFenceRegistry::default();
        let monotonic = Instant::now();
        let gate = registry
            .acquire_terminal_gate(
                &["token-late".to_owned()],
                ServiceAuthorityDisposition::DurableDelete,
            )
            .await
            .expect("reserve an absent token");
        let publication = registry
            .register(witness("token-late", 1_000), 100, monotonic)
            .expect("late registration attaches to pending domain");
        assert_eq!(
            publication.resolve_act(101, monotonic).unwrap(),
            ServiceAuthorityActResolution::Unavailable
        );

        let prepared = with_service_authority_terminal_gate(gate, || {
            registry.prepare_terminal(
                &["token-late".to_owned()],
                ServiceAuthorityDisposition::DurableDelete,
            )
        })
        .expect("late token transaction adopts its exact gate");
        prepared.committed().expect("commit late token ending");
        assert_eq!(
            publication.resolve_act(101, monotonic).unwrap(),
            ServiceAuthorityActResolution::Terminal(ServiceAuthorityDisposition::DurableDelete)
        );
    }

    #[tokio::test]
    async fn overlapping_gates_serialize_while_disjoint_gates_proceed() {
        let registry = ServiceAuthorityFenceRegistry::default();
        let first = registry
            .acquire_terminal_gate(
                &["token-a".to_owned()],
                ServiceAuthorityDisposition::Carrier,
            )
            .await
            .expect("acquire first token A gate");
        let overlapping_registry = registry.clone();
        let overlapping = tokio::spawn(async move {
            overlapping_registry
                .acquire_terminal_gate(
                    &["token-a".to_owned()],
                    ServiceAuthorityDisposition::DurableDelete,
                )
                .await
                .expect("acquire successor token A gate")
        });
        tokio::task::yield_now().await;
        assert!(!overlapping.is_finished());

        let disjoint = tokio::time::timeout(
            Duration::from_secs(1),
            registry.acquire_terminal_gate(
                &["token-b".to_owned()],
                ServiceAuthorityDisposition::DurableDelete,
            ),
        )
        .await
        .expect("disjoint token B gate is not serialized")
        .expect("acquire token B gate");
        drop(disjoint);

        drop(first);
        let successor = tokio::time::timeout(Duration::from_secs(1), overlapping)
            .await
            .expect("overlapping gate proceeds after predecessor settles")
            .expect("overlapping task");
        drop(successor);
    }

    #[test]
    fn committed_gate_stays_exactly_pending_through_after_local_lifecycle() {
        let registry = ServiceAuthorityFenceRegistry::default();
        let monotonic = Instant::now();
        let publication = registry
            .register(witness("token-lifecycle", 1_000), 100, monotonic)
            .expect("register lifecycle witness");
        let prepared = registry
            .prepare_terminal(
                &["token-lifecycle".to_owned()],
                ServiceAuthorityDisposition::Carrier,
            )
            .expect("prepare predecessor terminal");

        let mut local_scope = crate::exec_guard::LocalSnapbackWriteScope::enter();
        prepared
            .committed()
            .expect("queue committed service publication");
        let lifecycle_ran = Arc::new(AtomicBool::new(false));
        let lifecycle_flag = Arc::clone(&lifecycle_ran);
        let lifecycle_registry = registry.clone();
        let lifecycle_publication = publication.clone();
        crate::exec_guard::run_or_defer_after_local(move || {
            assert_eq!(
                lifecycle_publication
                    .resolve_act(101, monotonic)
                    .expect("resolve published predecessor terminal"),
                ServiceAuthorityActResolution::Terminal(ServiceAuthorityDisposition::Carrier),
                "terminal publication must precede lifecycle fanout"
            );
            assert!(
                lifecycle_registry
                    .prepare_terminal(
                        &["token-lifecycle".to_owned()],
                        ServiceAuthorityDisposition::DurableDelete,
                    )
                    .is_err(),
                "an overlapping stronger ending must remain serialized during lifecycle fanout"
            );
            lifecycle_flag.store(true, Ordering::SeqCst);
        });
        let batch = local_scope.take_after_local_batch();
        drop(local_scope);
        assert!(
            !lifecycle_ran.load(Ordering::SeqCst),
            "lifecycle fanout must not run while Local is held"
        );

        crate::exec_guard::run_after_local_batch(batch).unwrap();
        assert!(lifecycle_ran.load(Ordering::SeqCst));

        registry
            .prepare_terminal(
                &["token-lifecycle".to_owned()],
                ServiceAuthorityDisposition::DurableDelete,
            )
            .expect("successor proceeds only after predecessor lifecycle settlement")
            .committed()
            .expect("commit stronger successor");
        assert_eq!(
            publication.resolve_act(101, monotonic).unwrap(),
            ServiceAuthorityActResolution::Terminal(ServiceAuthorityDisposition::DurableDelete)
        );
    }

    #[tokio::test]
    async fn transaction_must_reproduce_the_gate_exact_token_set() {
        let registry = ServiceAuthorityFenceRegistry::default();
        let monotonic = Instant::now();
        let publication = registry
            .register(witness("token-a", 1_000), 100, monotonic)
            .expect("register token A");
        let gate = registry
            .acquire_terminal_gate(
                &["token-a".to_owned()],
                ServiceAuthorityDisposition::DurableDelete,
            )
            .await
            .expect("acquire token A gate");
        let mismatch = with_service_authority_terminal_gate(gate, || {
            registry.prepare_terminal(
                &["token-b".to_owned()],
                ServiceAuthorityDisposition::DurableDelete,
            )
        });
        let error = match mismatch {
            Ok(_) => panic!("a different durable token plan cannot adopt the gate"),
            Err(error) => error,
        };
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_POLICY_UNAVAILABLE");
        assert!(matches!(
            publication.resolve_act(101, monotonic).unwrap(),
            ServiceAuthorityActResolution::Current(_)
        ));
    }

    #[tokio::test]
    async fn cancelling_terminal_gate_drain_reopens_the_service_domain() {
        let registry = ServiceAuthorityFenceRegistry::default();
        let monotonic = Instant::now();
        let publication = registry
            .register(witness("token-cancel", 1_000), 100, monotonic)
            .expect("register witness");
        let predecessor = publication
            .begin_authority_work(101, monotonic)
            .expect("retain predecessor work");
        let terminal_registry = registry.clone();
        let terminal = tokio::spawn(async move {
            terminal_registry
                .acquire_terminal_gate(
                    &["token-cancel".to_owned()],
                    ServiceAuthorityDisposition::DurableDelete,
                )
                .await
        });

        tokio::time::timeout(Duration::from_secs(1), async {
            while publication.begin_authority_work(101, monotonic).is_ok() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("terminal intent becomes visible");
        assert!(!terminal.is_finished());
        terminal.abort();
        assert!(
            terminal
                .await
                .expect_err("terminal task is cancelled")
                .is_cancelled()
        );

        let reopened = publication
            .begin_authority_work(101, monotonic)
            .expect("cancellation drops the exact coarse marker");
        drop(reopened);
        drop(predecessor);
    }

    #[test]
    fn retained_service_work_counter_is_bounded_and_releases_on_error_unwind() {
        let registry = ServiceAuthorityFenceRegistry::default();
        let monotonic = Instant::now();
        let publication = registry
            .register(witness("token-capacity", 1_000), 100, monotonic)
            .expect("register witness");
        let mut permits = Vec::with_capacity(MAX_IN_FLIGHT_SERVICE_AUTHORITY_WORK);
        for _ in 0..MAX_IN_FLIGHT_SERVICE_AUTHORITY_WORK {
            permits.push(
                publication
                    .begin_authority_work(101, monotonic)
                    .expect("capacity slot"),
            );
        }
        assert_eq!(
            publication
                .begin_authority_work(101, monotonic)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
        );
        assert_eq!(
            publication.domain.active_work.load(Ordering::SeqCst),
            MAX_IN_FLIGHT_SERVICE_AUTHORITY_WORK
        );
        drop(permits);

        let failed = (|| -> SnapbackResult<()> {
            let _permit = publication.begin_authority_work(101, monotonic)?;
            Err(service_authority_unavailable(
                "synthetic staged closure failure",
            ))
        })();
        assert_eq!(
            failed.expect_err("synthetic closure fails").diagnostic.code,
            "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
        );
        assert_eq!(publication.domain.active_work.load(Ordering::SeqCst), 0);
    }
}
