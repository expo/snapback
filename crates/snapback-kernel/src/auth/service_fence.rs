//! Database-owned process fences for finite service authority.
//!
//! Storage and publication share this concrete registry. There is no callback
//! installer: the transaction that derives the exact token plan also prepares
//! and settles the matching process ticket directly.

use crate::auth::service_authority_contract::ServiceAuthorityDisposition;
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::storage::DatabaseBinding;
use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

const MAX_IN_FLIGHT_SERVICE_AUTHORITY_WORK: usize = 4_096;

/// Exact service-terminal subject produced inside the durable transaction
/// after its read-only affected-token plan. The receipt is non-cloneable and
/// cannot be constructed by a dependent crate. Its only consumer is the
/// concrete registry owned by the same database; there is no arbitrary
/// callback or settlement builder.
///
/// @ref LLP 0303#corollary--the-artifact-must-carry-provenance-not-just-type —
/// the transaction-produced receipt carries database and exact-plan identity.
pub struct ServiceAuthorityTerminalReceipt {
    database_binding: DatabaseBinding,
    token_ids: Vec<String>,
    disposition: ServiceAuthorityDisposition,
}

/// Exact due-expiry fact derived by a registered durable service publication.
/// Fields and construction are private: dependent crates can carry and inspect
/// the fact, but cannot select a token, grant, deadline, disposition, or
/// database for a terminal transaction.
///
/// @ref LLP 0303#the-governing-principle — expiry subjects remain derived
/// from the exact durable-resolution publication for their full lifetime.
#[derive(Debug)]
pub struct ServiceAuthorityDeadlineTerminal {
    database_binding: DatabaseBinding,
    token_id: String,
    grant_id: String,
    deadline_ms: u64,
    disposition: ServiceAuthorityDisposition,
    close_by: Instant,
}

impl ServiceAuthorityDeadlineTerminal {
    pub fn database_binding(&self) -> &DatabaseBinding {
        &self.database_binding
    }

    pub fn token_id(&self) -> &str {
        &self.token_id
    }

    pub fn grant_id(&self) -> &str {
        &self.grant_id
    }

    pub fn deadline_ms(&self) -> u64 {
        self.deadline_ms
    }

    pub fn disposition(&self) -> ServiceAuthorityDisposition {
        self.disposition
    }

    pub fn close_by(&self) -> Instant {
        self.close_by
    }
}

impl ServiceAuthorityTerminalReceipt {
    pub(crate) fn new(
        database_binding: DatabaseBinding,
        token_ids: Vec<String>,
        disposition: ServiceAuthorityDisposition,
    ) -> Self {
        Self {
            database_binding,
            token_ids,
            disposition,
        }
    }

    pub fn token_ids(&self) -> &[String] {
        &self.token_ids
    }

    pub fn disposition(&self) -> ServiceAuthorityDisposition {
        self.disposition
    }
}

/// Exact database-produced subject for one later service-authority terminal
/// transaction. Callers can inspect the affected tokens, but cannot assemble
/// or redirect a plan to another database.
///
/// @ref LLP 0303#the-governing-principle — the terminal subject is derived by
/// the database planner instead of being supplied to the process fence.
#[derive(Debug)]
pub struct DurablyPlannedServiceAuthorityTerminal {
    database_binding: DatabaseBinding,
    token_ids: Vec<String>,
    disposition: ServiceAuthorityDisposition,
}

impl DurablyPlannedServiceAuthorityTerminal {
    pub(crate) fn new(
        database_binding: DatabaseBinding,
        token_ids: Vec<String>,
        disposition: ServiceAuthorityDisposition,
    ) -> Self {
        Self {
            database_binding,
            token_ids,
            disposition,
        }
    }

    pub fn database_binding(&self) -> &DatabaseBinding {
        &self.database_binding
    }

    pub fn token_ids(&self) -> &[String] {
        &self.token_ids
    }

    pub fn disposition(&self) -> ServiceAuthorityDisposition {
        self.disposition
    }
}

#[derive(Debug)]
struct RegisteredServiceAuthorityState {
    token_id: String,
    grant_id: String,
    expires_at_ms: u64,
    grant_expires_at_ms: Option<u64>,
    validated_at_ms: u64,
    monotonic_deadline: Instant,
    grant_monotonic_deadline: Option<Instant>,
}

#[derive(Debug, Default)]
struct ServiceAuthorityDomainState {
    pending_tickets: BTreeMap<u64, ServiceAuthorityDisposition>,
    active_work: usize,
    terminal: Option<ServiceAuthorityDisposition>,
    authority: Option<RegisteredServiceAuthorityState>,
}

#[derive(Debug, Default)]
struct ServiceAuthorityDomain {
    state: Mutex<ServiceAuthorityDomainState>,
    changed: Condvar,
}

#[derive(Default)]
struct ServiceAuthorityFenceRegistryState {
    next_ticket: u64,
    domains: HashMap<String, Arc<ServiceAuthorityDomain>>,
}

/// The one concrete service-fence registry owned by a database. Every clone
/// points at the same database-origin state; there is no public `Default` or
/// detached installer.
#[derive(Clone)]
pub struct ServiceAuthorityFenceRegistry {
    database_binding: DatabaseBinding,
    state: Arc<Mutex<ServiceAuthorityFenceRegistryState>>,
    changed: Arc<Condvar>,
    #[cfg(any(test, feature = "test-support"))]
    recording: Arc<Mutex<Option<Arc<RecordingState>>>>,
}

impl std::fmt::Debug for ServiceAuthorityFenceRegistry {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("ServiceAuthorityFenceRegistry([DATABASE-OWNED])")
    }
}

impl ServiceAuthorityFenceRegistry {
    pub(crate) fn new(database_binding: DatabaseBinding) -> Self {
        Self {
            database_binding,
            state: Arc::new(Mutex::new(ServiceAuthorityFenceRegistryState::default())),
            changed: Arc::new(Condvar::new()),
            #[cfg(any(test, feature = "test-support"))]
            recording: Arc::new(Mutex::new(None)),
        }
    }

    pub fn database_binding(&self) -> &DatabaseBinding {
        &self.database_binding
    }

    pub fn is_same_registry(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.state, &other.state)
    }

    pub fn register_resolved(
        &self,
        durable: &crate::storage::auth_agent_credentials::DurablyResolvedServiceAuthority,
        validated_at_ms: u64,
        monotonic_now: Instant,
    ) -> SnapbackResult<ServiceAuthorityPublicationFence> {
        if durable.database_binding() != &self.database_binding {
            return Err(service_authority_unavailable(
                "durable service authority belongs to another database",
            ));
        }
        let resolved = durable.resolved();
        let remaining_ms = resolved
            .expires_at_ms()
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
        let grant_monotonic_deadline = resolved
            .grant_expires_at_ms()
            .filter(|grant_expires_at_ms| *grant_expires_at_ms <= resolved.expires_at_ms())
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
        let domain = registry
            .domains
            .entry(resolved.token_id().to_owned())
            .or_insert_with(|| Arc::new(ServiceAuthorityDomain::default()))
            .clone();
        drop(registry);
        let mut state = domain.state.lock().map_err(|_| {
            service_authority_unavailable("a service authority domain gate is poisoned")
        })?;
        match state.authority.as_mut() {
            Some(authority) => {
                if authority.token_id != resolved.token_id()
                    || authority.grant_id != resolved.grant_id()
                    || authority.expires_at_ms != resolved.expires_at_ms()
                    || authority.grant_expires_at_ms != resolved.grant_expires_at_ms()
                    || validated_at_ms < authority.validated_at_ms
                    || validated_at_ms >= authority.expires_at_ms
                {
                    return Err(service_authority_unavailable(
                        "durable service authority disagrees with its process fence",
                    ));
                }
                authority.validated_at_ms = validated_at_ms;
                authority.monotonic_deadline = authority.monotonic_deadline.min(monotonic_deadline);
                authority.grant_monotonic_deadline =
                    match (authority.grant_monotonic_deadline, grant_monotonic_deadline) {
                        (Some(left), Some(right)) => Some(left.min(right)),
                        (left, right) => left.or(right),
                    };
            }
            None => {
                state.authority = Some(RegisteredServiceAuthorityState {
                    token_id: resolved.token_id().to_owned(),
                    grant_id: resolved.grant_id().to_owned(),
                    expires_at_ms: resolved.expires_at_ms(),
                    grant_expires_at_ms: resolved.grant_expires_at_ms(),
                    validated_at_ms,
                    monotonic_deadline,
                    grant_monotonic_deadline,
                });
            }
        }
        drop(state);
        Ok(ServiceAuthorityPublicationFence {
            database_binding: self.database_binding.clone(),
            domain,
        })
    }

    #[cfg(test)]
    fn register_token_for_test(
        &self,
        database_binding: &DatabaseBinding,
        token_id: &str,
    ) -> SnapbackResult<ServiceAuthorityPublicationFence> {
        if database_binding != &self.database_binding {
            return Err(service_authority_unavailable(
                "test service authority belongs to another database",
            ));
        }
        let mut registry = self
            .state
            .lock()
            .map_err(|_| service_authority_unavailable("the service fence registry is poisoned"))?;
        let domain = registry
            .domains
            .entry(token_id.to_owned())
            .or_insert_with(|| Arc::new(ServiceAuthorityDomain::default()))
            .clone();
        Ok(ServiceAuthorityPublicationFence {
            database_binding: self.database_binding.clone(),
            domain,
        })
    }

    fn install_terminal_intent(
        &self,
        token_ids: &BTreeSet<String>,
        disposition: ServiceAuthorityDisposition,
    ) -> SnapbackResult<Option<PreparedServiceAuthorityTerminal>> {
        let mut registry = self
            .state
            .lock()
            .map_err(|_| service_authority_unavailable("the service fence registry is poisoned"))?;
        let domains = token_ids
            .iter()
            .map(|token_id| {
                (
                    token_id.clone(),
                    registry
                        .domains
                        .entry(token_id.clone())
                        .or_insert_with(|| Arc::new(ServiceAuthorityDomain::default()))
                        .clone(),
                )
            })
            .collect::<Vec<_>>();
        for (_, domain) in &domains {
            let state = domain.state.lock().map_err(|_| {
                service_authority_unavailable("a service authority domain gate is poisoned")
            })?;
            if !state.pending_tickets.is_empty() {
                return Ok(None);
            }
        }
        registry.next_ticket = registry
            .next_ticket
            .checked_add(1)
            .ok_or_else(|| service_authority_unavailable("service fence tickets are exhausted"))?;
        let ticket = registry.next_ticket;
        for (_, domain) in &domains {
            let mut state = domain
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if state.pending_tickets.insert(ticket, disposition).is_some() {
                return Err(service_authority_unavailable(
                    "a service authority terminal ticket was reused",
                ));
            }
        }
        #[cfg(any(test, feature = "test-support"))]
        let recording = self
            .recording
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone();
        #[cfg(any(test, feature = "test-support"))]
        if let Some(recording) = &recording {
            recording
                .plans
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .push((token_ids.iter().cloned().collect(), disposition));
        }
        Ok(Some(PreparedServiceAuthorityTerminal {
            registry: self.clone(),
            ticket,
            domains,
            disposition,
            settled: false,
            ambiguous: false,
            #[cfg(any(test, feature = "test-support"))]
            recording,
        }))
    }

    /// Block outside Local/SQLite until the exact database-produced plan owns
    /// its ticket and every predecessor unit has drained.
    pub fn acquire_planned_terminal_gate(
        &self,
        plan: DurablyPlannedServiceAuthorityTerminal,
    ) -> SnapbackResult<ServiceAuthorityTerminalGate> {
        if plan.database_binding() != &self.database_binding {
            return Err(service_authority_unavailable(
                "the service terminal plan belongs to another database",
            ));
        }
        let token_ids = plan.token_ids().iter().cloned().collect::<BTreeSet<_>>();
        let disposition = plan.disposition();
        loop {
            if let Some(prepared) = self.install_terminal_intent(&token_ids, disposition)? {
                for (_, domain) in &prepared.domains {
                    let mut state = domain.state.lock().map_err(|_| {
                        service_authority_unavailable("a service authority domain gate is poisoned")
                    })?;
                    while state.active_work != 0 {
                        state = domain.changed.wait(state).map_err(|_| {
                            service_authority_unavailable(
                                "a service authority domain gate is poisoned",
                            )
                        })?;
                    }
                }
                return Ok(ServiceAuthorityTerminalGate {
                    prepared: Some(prepared),
                });
            }
            let registry = self.state.lock().map_err(|_| {
                service_authority_unavailable("the service fence registry is poisoned")
            })?;
            // A predecessor can release between the failed install and this
            // lock acquisition. The bounded wait prevents that notification
            // race from stranding a later exact plan indefinitely.
            drop(
                self.changed
                    .wait_timeout(registry, std::time::Duration::from_millis(100))
                    .map_err(|_| {
                        service_authority_unavailable("the service fence registry is poisoned")
                    })?,
            );
        }
    }

    pub(crate) fn prepare_terminal(
        &self,
        receipt: ServiceAuthorityTerminalReceipt,
    ) -> SnapbackResult<PreparedServiceAuthorityTerminal> {
        if receipt.database_binding != self.database_binding {
            return Err(service_authority_unavailable(
                "the service terminal receipt belongs to another database",
            ));
        }
        let token_ids = receipt.token_ids.into_iter().collect::<BTreeSet<_>>();
        let disposition = receipt.disposition;
        if SERVICE_TERMINAL_GATE_SCOPE_ACTIVE.with(Cell::get) {
            return ACTIVE_SERVICE_TERMINAL_GATE.with(|slot| {
                let borrowed = slot.borrow();
                let Some(installed) = borrowed.as_ref() else {
                    return Err(service_authority_unavailable(
                        "the installed service terminal gate was already consumed",
                    ));
                };
                if !installed.matches(self, &token_ids, disposition) {
                    drop(borrowed);
                    let mut gate = slot
                        .borrow_mut()
                        .take()
                        .expect("the mismatched installed terminal gate was still present");
                    gate.roll_back();
                    return Err(service_authority_unavailable(
                        "the installed service terminal gate does not match the durable plan",
                    ));
                }
                drop(borrowed);
                let mut gate = slot
                    .borrow_mut()
                    .take()
                    .expect("the exact installed terminal gate was just matched");
                Ok(gate.take_prepared())
            });
        }

        let Some(prepared) = self.install_terminal_intent(&token_ids, disposition)? else {
            return Err(service_authority_unavailable(
                "another exact service-authority termination is pending",
            ));
        };
        if prepared.domains.iter().any(|(_, domain)| {
            domain
                .state
                .lock()
                .map(|state| state.active_work != 0)
                .unwrap_or(true)
        }) {
            prepared.rolled_back();
            return Err(service_authority_unavailable(
                "retained service-authority work requires an exact-token gate",
            ));
        }
        Ok(prepared)
    }

    #[cfg(any(test, feature = "test-support"))]
    pub(crate) fn install_recording(&self, recording: &RecordingServiceAuthorityCommitInterlock) {
        *self
            .recording
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(recording.state.clone());
    }
}

#[derive(Clone, Debug)]
pub struct ServiceAuthorityPublicationFence {
    database_binding: DatabaseBinding,
    domain: Arc<ServiceAuthorityDomain>,
}

#[derive(Clone, Copy, Debug)]
pub struct ServiceAuthorityDomainSnapshot {
    terminal: Option<ServiceAuthorityDisposition>,
    pending: Option<ServiceAuthorityDisposition>,
}

impl ServiceAuthorityDomainSnapshot {
    pub fn terminal(&self) -> Option<ServiceAuthorityDisposition> {
        self.terminal
    }

    pub fn pending(&self) -> Option<ServiceAuthorityDisposition> {
        self.pending
    }
}

#[derive(Debug)]
pub enum ServiceAuthorityWorkFenceError {
    Terminal(ServiceAuthorityDisposition),
    Unavailable(SnapbackError),
}

impl ServiceAuthorityPublicationFence {
    pub fn expired_deadline_terminal(
        &self,
        now_ms: u64,
        monotonic_now: Instant,
        close_grace: Duration,
    ) -> SnapbackResult<Option<ServiceAuthorityDeadlineTerminal>> {
        let state = self.domain.state.lock().map_err(|_| {
            service_authority_unavailable("the service authority domain gate is poisoned")
        })?;
        if state.terminal.is_some() || !state.pending_tickets.is_empty() {
            return Ok(None);
        }
        let authority = state.authority.as_ref().ok_or_else(|| {
            service_authority_unavailable(
                "finite service authority has no durable registration subject",
            )
        })?;
        let token_due =
            now_ms >= authority.expires_at_ms || monotonic_now >= authority.monotonic_deadline;
        let grant_due = authority
            .grant_expires_at_ms
            .is_some_and(|deadline| now_ms >= deadline)
            || authority
                .grant_monotonic_deadline
                .is_some_and(|deadline| monotonic_now >= deadline);
        if !token_due && !grant_due {
            return Ok(None);
        }
        let (deadline_ms, disposition) = if grant_due {
            (
                authority
                    .grant_expires_at_ms
                    .unwrap_or(authority.expires_at_ms),
                ServiceAuthorityDisposition::DurableDelete,
            )
        } else {
            (
                authority.expires_at_ms,
                ServiceAuthorityDisposition::Carrier,
            )
        };
        let monotonic_proof_deadline = [
            (monotonic_now >= authority.monotonic_deadline).then_some(authority.monotonic_deadline),
            authority
                .grant_monotonic_deadline
                .filter(|deadline| monotonic_now >= *deadline),
        ]
        .into_iter()
        .flatten()
        .min();
        let close_basis = monotonic_proof_deadline.unwrap_or(monotonic_now);
        let close_by = close_basis.checked_add(close_grace).unwrap_or(close_basis);
        Ok(Some(ServiceAuthorityDeadlineTerminal {
            database_binding: self.database_binding.clone(),
            token_id: authority.token_id.clone(),
            grant_id: authority.grant_id.clone(),
            deadline_ms,
            disposition,
            close_by,
        }))
    }

    pub fn snapshot(&self) -> SnapbackResult<ServiceAuthorityDomainSnapshot> {
        let state = self.domain.state.lock().map_err(|_| {
            service_authority_unavailable("the service authority domain gate is poisoned")
        })?;
        Ok(ServiceAuthorityDomainSnapshot {
            terminal: state.terminal,
            pending: state.pending_tickets.values().copied().next(),
        })
    }

    pub fn begin_work(
        &self,
    ) -> Result<ServiceAuthorityWorkFencePermit, ServiceAuthorityWorkFenceError> {
        let mut state = self.domain.state.lock().map_err(|_| {
            ServiceAuthorityWorkFenceError::Unavailable(service_authority_unavailable(
                "the service authority domain gate is poisoned",
            ))
        })?;
        if let Some(disposition) = state.pending_tickets.values().copied().next() {
            return Err(ServiceAuthorityWorkFenceError::Terminal(disposition));
        }
        if let Some(disposition) = state.terminal {
            return Err(ServiceAuthorityWorkFenceError::Terminal(disposition));
        }
        if state.active_work >= MAX_IN_FLIGHT_SERVICE_AUTHORITY_WORK {
            return Err(ServiceAuthorityWorkFenceError::Unavailable(
                service_authority_unavailable(
                    "finite service authority has too much in-flight work",
                ),
            ));
        }
        state.active_work += 1;
        Ok(ServiceAuthorityWorkFencePermit {
            domain: self.domain.clone(),
            settled: false,
        })
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn active_work_for_test(&self) -> usize {
        self.domain
            .state
            .lock()
            .map(|state| state.active_work)
            .unwrap_or(usize::MAX)
    }
}

#[derive(Debug)]
pub struct ServiceAuthorityWorkFencePermit {
    domain: Arc<ServiceAuthorityDomain>,
    settled: bool,
}

impl ServiceAuthorityWorkFencePermit {
    pub fn settle(mut self) {
        self.release();
    }

    fn release(&mut self) {
        if self.settled {
            return;
        }
        let mut state = self
            .domain
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.active_work = state
            .active_work
            .checked_sub(1)
            .expect("service authority work settles once");
        self.settled = true;
        drop(state);
        self.domain.changed.notify_all();
    }
}

impl Drop for ServiceAuthorityWorkFencePermit {
    fn drop(&mut self) {
        self.release();
    }
}

/// Exact asynchronously drained pre-transaction terminal intent. Until the
/// durable transaction consumes it, cancellation proves that no terminal
/// write ran and therefore rolls its pending ticket back exactly. Commit
/// uncertainty begins only after `prepare_terminal` transfers the prepared
/// terminal into the transaction path.
///
/// @ref LLP 0059#rollback-and-ambiguous-commit — proven pre-write cancellation
/// exact-unmarks; only an indeterminate durable commit remains fail-closed.
#[derive(Debug)]
pub struct ServiceAuthorityTerminalGate {
    prepared: Option<PreparedServiceAuthorityTerminal>,
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

    fn take_prepared(&mut self) -> PreparedServiceAuthorityTerminal {
        self.prepared
            .take()
            .expect("an exact terminal gate is consumed only once")
    }

    fn roll_back(&mut self) {
        if let Some(prepared) = self.prepared.take() {
            prepared.rolled_back();
        }
    }
}

impl Drop for ServiceAuthorityTerminalGate {
    fn drop(&mut self) {
        self.roll_back();
    }
}

thread_local! {
    static ACTIVE_SERVICE_TERMINAL_GATE: RefCell<Option<ServiceAuthorityTerminalGate>> =
        const { RefCell::new(None) };
    static SERVICE_TERMINAL_GATE_SCOPE_ACTIVE: Cell<bool> = const { Cell::new(false) };
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

#[derive(Debug)]
pub struct PreparedServiceAuthorityTerminal {
    registry: ServiceAuthorityFenceRegistry,
    ticket: u64,
    domains: Vec<(String, Arc<ServiceAuthorityDomain>)>,
    disposition: ServiceAuthorityDisposition,
    settled: bool,
    ambiguous: bool,
    #[cfg(any(test, feature = "test-support"))]
    recording: Option<Arc<RecordingState>>,
}

impl PreparedServiceAuthorityTerminal {
    fn publish_terminal(&mut self) {
        for (_, domain) in &self.domains {
            let mut state = domain
                .state
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

    fn release_ticket(&mut self) {
        for (_, domain) in &self.domains {
            let mut state = domain
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            state.pending_tickets.remove(&self.ticket);
            drop(state);
            domain.changed.notify_all();
        }
        self.settled = true;
        self.registry.changed.notify_all();
    }

    pub(crate) fn committed(mut self) -> SnapbackResult<()> {
        self.ambiguous = true;
        let prepared = Arc::new(Mutex::new(Some(self)));
        let publication = prepared.clone();
        snapback_types::exec_guard::run_or_defer_after_local(move || {
            if let Some(prepared) = publication
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .as_mut()
            {
                prepared.publish_terminal();
                #[cfg(any(test, feature = "test-support"))]
                if let Some(recording) = &prepared.recording {
                    recording
                        .committed
                        .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                }
            }
        });
        snapback_types::exec_guard::run_or_defer_after_local_finalizer(move || {
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

    pub(crate) fn rolled_back(mut self) {
        self.ambiguous = true;
        #[cfg(any(test, feature = "test-support"))]
        if let Some(recording) = &self.recording {
            recording
                .rolled_back
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        }
        snapback_types::exec_guard::run_or_defer_after_local_finalizer(move || {
            self.release_ticket();
        });
    }

    pub(crate) fn mark_ambiguous(&mut self) {
        if self.ambiguous {
            return;
        }
        self.ambiguous = true;
        #[cfg(any(test, feature = "test-support"))]
        if let Some(recording) = &self.recording {
            recording
                .ambiguous
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        }
    }
}

impl Drop for PreparedServiceAuthorityTerminal {
    fn drop(&mut self) {
        if !self.settled && !self.ambiguous {
            self.mark_ambiguous();
        }
    }
}

#[cfg(any(test, feature = "test-support"))]
#[derive(Clone, Default)]
pub struct RecordingServiceAuthorityCommitInterlock {
    state: Arc<RecordingState>,
}

#[cfg(any(test, feature = "test-support"))]
#[derive(Default, Debug)]
struct RecordingState {
    plans: Mutex<Vec<(Vec<String>, ServiceAuthorityDisposition)>>,
    committed: std::sync::atomic::AtomicUsize,
    rolled_back: std::sync::atomic::AtomicUsize,
    ambiguous: std::sync::atomic::AtomicUsize,
}

#[cfg(any(test, feature = "test-support"))]
impl RecordingServiceAuthorityCommitInterlock {
    pub fn plans(&self) -> Vec<(Vec<String>, ServiceAuthorityDisposition)> {
        self.state
            .plans
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    pub fn committed(&self) -> usize {
        self.state
            .committed
            .load(std::sync::atomic::Ordering::SeqCst)
    }

    pub fn rolled_back(&self) -> usize {
        self.state
            .rolled_back
            .load(std::sync::atomic::Ordering::SeqCst)
    }

    pub fn ambiguous(&self) -> usize {
        self.state
            .ambiguous
            .load(std::sync::atomic::Ordering::SeqCst)
    }
}

fn service_authority_unavailable(message: &str) -> SnapbackError {
    SnapbackError::error("SNAPBACK_AUTH_POLICY_UNAVAILABLE", "auth", message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::LocalDatabase;

    fn registry() -> (DatabaseBinding, ServiceAuthorityFenceRegistry) {
        let database = LocalDatabase::memory().expect("memory database");
        let binding = database.binding();
        let registry = ServiceAuthorityFenceRegistry::new(binding.clone());
        (binding, registry)
    }

    #[test]
    fn dropped_pretransaction_gate_exactly_rolls_back_and_allows_retry() {
        let (binding, registry) = registry();
        let publication = registry
            .register_token_for_test(&binding, "token-a")
            .expect("register token");
        let gate = registry
            .acquire_planned_terminal_gate(DurablyPlannedServiceAuthorityTerminal::new(
                binding,
                vec!["token-a".to_owned()],
                ServiceAuthorityDisposition::Carrier,
            ))
            .expect("acquire exact gate");

        drop(gate);

        let snapshot = publication.snapshot().expect("domain snapshot");
        assert_eq!(snapshot.pending(), None);
        assert_eq!(snapshot.terminal(), None);
        drop(
            publication
                .begin_work()
                .expect("pre-transaction cancellation must unstick predecessor work"),
        );

        let retry = registry
            .acquire_planned_terminal_gate(DurablyPlannedServiceAuthorityTerminal::new(
                registry.database_binding().clone(),
                vec!["token-a".to_owned()],
                ServiceAuthorityDisposition::Carrier,
            ))
            .expect("pre-transaction cancellation must permit an exact retry");
        drop(retry);
        assert_eq!(publication.snapshot().unwrap().pending(), None);
    }

    #[test]
    fn exact_gate_is_consumed_by_the_matching_durable_terminal() {
        let (binding, registry) = registry();
        let publication = registry
            .register_token_for_test(&binding, "token-a")
            .expect("register token");
        let gate = registry
            .acquire_planned_terminal_gate(DurablyPlannedServiceAuthorityTerminal::new(
                binding.clone(),
                vec!["token-a".to_owned()],
                ServiceAuthorityDisposition::DurableDelete,
            ))
            .expect("acquire exact gate");

        with_service_authority_terminal_gate(gate, || {
            registry
                .prepare_terminal(ServiceAuthorityTerminalReceipt::new(
                    binding,
                    vec!["token-a".to_owned()],
                    ServiceAuthorityDisposition::DurableDelete,
                ))
                .expect("consume matching gate")
                .committed()
                .expect("publish committed terminal");
        });

        let snapshot = publication.snapshot().expect("domain snapshot");
        assert_eq!(snapshot.pending(), None);
        assert_eq!(
            snapshot.terminal(),
            Some(ServiceAuthorityDisposition::DurableDelete)
        );
    }

    #[test]
    fn precommit_gate_mismatch_exactly_rolls_back_the_installed_ticket() {
        let (binding, registry) = registry();
        let publication_a = registry
            .register_token_for_test(&binding, "token-a")
            .expect("register predecessor token A");
        let publication_b = registry
            .register_token_for_test(&binding, "token-b")
            .expect("register concurrently minted token B");
        let gate = registry
            .acquire_planned_terminal_gate(DurablyPlannedServiceAuthorityTerminal::new(
                binding.clone(),
                vec!["token-a".to_owned()],
                ServiceAuthorityDisposition::DurableDelete,
            ))
            .expect("acquire stale predecessor gate");

        with_service_authority_terminal_gate(gate, || {
            let error = registry
                .prepare_terminal(ServiceAuthorityTerminalReceipt::new(
                    binding,
                    vec!["token-a".to_owned(), "token-b".to_owned()],
                    ServiceAuthorityDisposition::DurableDelete,
                ))
                .expect_err("the transaction-derived A+B plan must refuse stale gate A");
            assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_POLICY_UNAVAILABLE");
        });

        for publication in [&publication_a, &publication_b] {
            let snapshot = publication.snapshot().expect("recovered domain snapshot");
            assert_eq!(snapshot.pending(), None);
            assert_eq!(snapshot.terminal(), None);
            drop(
                publication
                    .begin_work()
                    .expect("recovered authority accepts work"),
            );
        }

        let retry = registry
            .acquire_planned_terminal_gate(DurablyPlannedServiceAuthorityTerminal::new(
                registry.database_binding().clone(),
                vec!["token-a".to_owned(), "token-b".to_owned()],
                ServiceAuthorityDisposition::DurableDelete,
            ))
            .expect("a recovered mismatch permits the exact retry");
        drop(retry);
        assert_eq!(publication_a.snapshot().unwrap().pending(), None);
        assert_eq!(publication_b.snapshot().unwrap().pending(), None);
    }

    #[test]
    fn database_binding_rejects_a_foreign_terminal_plan() {
        let (binding, registry) = registry();
        let foreign = LocalDatabase::memory()
            .expect("foreign memory database")
            .binding();
        let error = registry
            .acquire_planned_terminal_gate(DurablyPlannedServiceAuthorityTerminal::new(
                foreign,
                vec!["token-a".to_owned()],
                ServiceAuthorityDisposition::Carrier,
            ))
            .expect_err("foreign plan must refuse");
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_POLICY_UNAVAILABLE");
        assert!(
            registry
                .register_token_for_test(&binding, "token-a")
                .is_ok()
        );
    }
}
