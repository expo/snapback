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
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::storage::auth_agent_credentials::ResolvedScopedToken;
use std::cell::RefCell;
use std::collections::{BTreeSet, HashMap};
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant};

const EXTERNAL_EFFECT_INITIATION_WAIT: Duration = Duration::from_secs(1);
const EXTERNAL_EFFECT_INITIATION_POLL: Duration = Duration::from_millis(1);

thread_local! {
    /// Connection acts deliberately keep the publication mutex across their
    /// bounded synchronous app operation. Local validation reached inside
    /// that operation must reuse the already-proven witness instead of trying
    /// to lock the same non-reentrant mutex. The stack is thread-local because
    /// the guarded closure cannot suspend or migrate.
    static ACTIVE_SERVICE_AUTHORITY_ACTS: RefCell<Vec<(usize, ServiceAuthorityWitness)>> =
        const { RefCell::new(Vec::new()) };
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ServiceAuthorityDisposition {
    Carrier,
    DurableDelete,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ServiceAuthorityWitness {
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
    pub(crate) fn from_resolved(token: &ResolvedScopedToken) -> Self {
        Self {
            token_id: token.token_id.clone(),
            grant_id: token.grant_id.clone(),
            actor_user_id: token.actor_user_id.clone(),
            effective_user_id: token.effective_user_id.clone(),
            credential_id: token.credential_id.clone(),
            credential_generation: token.credential_generation,
            expires_at_ms: token.expires_at_ms,
            grant_expires_at_ms: token.grant_expires_at_ms,
        }
    }

    pub(crate) fn token_id(&self) -> &str {
        &self.token_id
    }

    pub(crate) fn expires_at_ms(&self) -> u64 {
        self.expires_at_ms
    }

    pub(crate) fn grant_id(&self) -> &str {
        &self.grant_id
    }

    pub(crate) fn actor_user_id(&self) -> &str {
        &self.actor_user_id
    }

    pub(crate) fn effective_user_id(&self) -> Option<&str> {
        self.effective_user_id.as_deref()
    }

    pub(crate) fn credential_id(&self) -> &str {
        &self.credential_id
    }

    pub(crate) fn credential_generation(&self) -> u64 {
        self.credential_generation
    }
}

#[derive(Debug)]
struct ServiceAuthorityFenceState {
    witness: ServiceAuthorityWitness,
    validated_at_ms: u64,
    monotonic_deadline: Instant,
    grant_monotonic_deadline: Option<Instant>,
    pending_tickets: BTreeSet<u64>,
    terminal: Option<ServiceAuthorityDisposition>,
    next_external_effect: u64,
    active_external_effects: BTreeSet<u64>,
}

#[derive(Clone, Debug)]
pub(crate) struct ServiceAuthorityPublication {
    fence: Arc<Mutex<ServiceAuthorityFenceState>>,
    /// The provider owns the durable-floor-clamped epoch and injected
    /// monotonic clock used at resolution. Carry it with every retained
    /// publication so later server/local cuts cannot accidentally sample a
    /// different clock domain.
    clock: Option<Arc<AuthProvider>>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum ServiceAuthorityActResolution {
    Current(ServiceAuthorityWitness),
    Terminal(ServiceAuthorityDisposition),
    Unavailable,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ServiceAuthorityDeadlineTerminal {
    pub(crate) token_id: String,
    pub(crate) grant_id: String,
    pub(crate) deadline_ms: u64,
    pub(crate) disposition: ServiceAuthorityDisposition,
}

pub(crate) struct ServiceAuthorityExternalEffectPermit {
    effect: u64,
    fence: Arc<Mutex<ServiceAuthorityFenceState>>,
    settled: bool,
}

struct ActiveServiceAuthorityAct {
    key: usize,
}

impl Drop for ActiveServiceAuthorityAct {
    fn drop(&mut self) {
        ACTIVE_SERVICE_AUTHORITY_ACTS.with(|active| {
            let popped = active.borrow_mut().pop();
            debug_assert!(popped.is_some_and(|(key, _)| key == self.key));
        });
    }
}

impl ServiceAuthorityExternalEffectPermit {
    /// Acknowledge that the native effect was synchronously initiated (or
    /// synchronously refused). Terminal premark may commit only after this
    /// exact begin→initiated window closes.
    pub(crate) fn initiated(mut self) {
        self.settle();
    }

    fn settle(&mut self) {
        if self.settled {
            return;
        }
        let mut state = self
            .fence
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.active_external_effects.remove(&self.effect);
        self.settled = true;
    }
}

impl Drop for ServiceAuthorityExternalEffectPermit {
    fn drop(&mut self) {
        self.settle();
    }
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
                .find_map(|(candidate, witness)| (*candidate == key).then(|| witness.clone()))
        })
    }

    fn enter_active_act(&self, witness: ServiceAuthorityWitness) -> ActiveServiceAuthorityAct {
        let key = self.fence_key();
        ACTIVE_SERVICE_AUTHORITY_ACTS.with(|active| active.borrow_mut().push((key, witness)));
        ActiveServiceAuthorityAct { key }
    }

    #[cfg(test)]
    pub(crate) fn synthetic_for_test(token_id: &str) -> Self {
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
                pending_tickets: BTreeSet::new(),
                terminal: None,
                next_external_effect: 0,
                active_external_effects: BTreeSet::new(),
            })),
            clock: None,
        }
    }

    pub(crate) fn with_provider_clock(mut self, clock: Arc<AuthProvider>) -> Self {
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

    pub(crate) fn current_clock_sample(
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

    pub(crate) fn expired_deadline_terminal(
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
        let state = self
            .fence
            .lock()
            .map_err(|_| service_authority_unavailable("a service authority fence is poisoned"))?;
        if state.terminal.is_some() || !Self::deadline_expired_locked(&state, now_ms, monotonic_now)
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
        Ok(Some(ServiceAuthorityDeadlineTerminal {
            token_id: state.witness.token_id.clone(),
            grant_id: state.witness.grant_id.clone(),
            deadline_ms,
            disposition,
        }))
    }

    pub(crate) fn remaining_until_deadline(&self, monotonic_now: Instant) -> Duration {
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

    pub(crate) fn try_publish<T>(
        &self,
        now_ms: u64,
        monotonic_now: Instant,
        publish: impl FnOnce() -> SnapbackResult<T>,
    ) -> SnapbackResult<Option<T>> {
        if self.active_witness().is_some() {
            return publish().map(Some);
        }
        let (now_ms, monotonic_now) = self.sample_clock(now_ms, monotonic_now);
        let state = self
            .fence
            .lock()
            .map_err(|_| service_authority_unavailable("a service authority fence is poisoned"))?;
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
        if !state.pending_tickets.is_empty() {
            return Err(service_authority_unavailable(
                "finite service authority termination is unresolved",
            ));
        }
        let witness = state.witness.clone();
        let _active = self.enter_active_act(witness);
        publish().map(Some)
    }

    pub(crate) fn terminal_disposition(
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
    pub(crate) fn resolve_act(
        &self,
        now_ms: u64,
        monotonic_now: Instant,
    ) -> SnapbackResult<ServiceAuthorityActResolution> {
        if let Some(witness) = self.active_witness() {
            return Ok(ServiceAuthorityActResolution::Current(witness));
        }
        let (now_ms, monotonic_now) = self.sample_clock(now_ms, monotonic_now);
        let state = self
            .fence
            .lock()
            .map_err(|_| service_authority_unavailable("a service authority fence is poisoned"))?;
        if let Some(disposition) = state.terminal {
            return Ok(ServiceAuthorityActResolution::Terminal(disposition));
        }
        if now_ms < state.validated_at_ms {
            return Ok(ServiceAuthorityActResolution::Unavailable);
        }
        if Self::deadline_expired_locked(&state, now_ms, monotonic_now) {
            return Ok(ServiceAuthorityActResolution::Unavailable);
        }
        if !state.pending_tickets.is_empty() {
            return Ok(ServiceAuthorityActResolution::Unavailable);
        }
        Ok(ServiceAuthorityActResolution::Current(
            state.witness.clone(),
        ))
    }

    pub(crate) fn begin_external_effect(
        &self,
        now_ms: u64,
        monotonic_now: Instant,
    ) -> SnapbackResult<ServiceAuthorityExternalEffectPermit> {
        let (now_ms, monotonic_now) = self.sample_clock(now_ms, monotonic_now);
        let mut state = self
            .fence
            .lock()
            .map_err(|_| service_authority_unavailable("a service authority fence is poisoned"))?;
        if let Some(disposition) = state.terminal {
            return Err(service_authority_terminal(disposition));
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
        if !state.pending_tickets.is_empty() {
            return Err(service_authority_unavailable(
                "finite service authority termination is unresolved",
            ));
        }
        state.next_external_effect =
            state.next_external_effect.checked_add(1).ok_or_else(|| {
                service_authority_unavailable("service authority effect tickets are exhausted")
            })?;
        let effect = state.next_external_effect;
        if !state.active_external_effects.insert(effect) {
            return Err(service_authority_unavailable(
                "a service authority effect ticket was reused",
            ));
        }
        drop(state);
        Ok(ServiceAuthorityExternalEffectPermit {
            effect,
            fence: Arc::clone(&self.fence),
            settled: false,
        })
    }
}

pub(crate) trait PreparedServiceAuthorityTerminal: Send {
    fn committed(self: Box<Self>) -> SnapbackResult<()>;
    fn rolled_back(self: Box<Self>);
    fn mark_ambiguous(&mut self);
}

pub(crate) trait ServiceAuthorityCommitInterlock: Send + Sync {
    fn prepare_terminal(
        &self,
        token_ids: &[String],
        disposition: ServiceAuthorityDisposition,
    ) -> SnapbackResult<Box<dyn PreparedServiceAuthorityTerminal>>;
}

#[derive(Default)]
struct ServiceAuthorityFenceRegistryState {
    next_ticket: u64,
    by_token: HashMap<String, Weak<Mutex<ServiceAuthorityFenceState>>>,
}

#[derive(Clone, Default)]
pub(crate) struct ServiceAuthorityFenceRegistry {
    state: Arc<Mutex<ServiceAuthorityFenceRegistryState>>,
}

impl std::fmt::Debug for ServiceAuthorityFenceRegistry {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("ServiceAuthorityFenceRegistry([REDACTED])")
    }
}

impl ServiceAuthorityFenceRegistry {
    #[cfg(test)]
    pub(crate) fn is_same_registry(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.state, &other.state)
    }

    #[cfg(test)]
    pub(crate) fn synthetic_publication_for_test(
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
    pub(crate) fn register(
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
                let token_id = witness.token_id.clone();
                let fence = Arc::new(Mutex::new(ServiceAuthorityFenceState {
                    witness,
                    validated_at_ms,
                    monotonic_deadline,
                    grant_monotonic_deadline,
                    pending_tickets: BTreeSet::new(),
                    terminal: None,
                    next_external_effect: 0,
                    active_external_effects: BTreeSet::new(),
                }));
                registry.by_token.insert(token_id, Arc::downgrade(&fence));
                fence
            }
        };
        Ok(ServiceAuthorityPublication { fence, clock: None })
    }
}

struct PremarkedServiceAuthorityTerminal {
    ticket: u64,
    fences: Vec<Arc<Mutex<ServiceAuthorityFenceState>>>,
    disposition: ServiceAuthorityDisposition,
    settled: bool,
    ambiguous: bool,
}

impl PremarkedServiceAuthorityTerminal {
    fn settle(&mut self, committed: bool) {
        for fence in &self.fences {
            let mut state = fence
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            state.pending_tickets.remove(&self.ticket);
            if committed {
                state.terminal = Some(match (state.terminal, self.disposition) {
                    (Some(ServiceAuthorityDisposition::DurableDelete), _)
                    | (_, ServiceAuthorityDisposition::DurableDelete) => {
                        ServiceAuthorityDisposition::DurableDelete
                    }
                    _ => ServiceAuthorityDisposition::Carrier,
                });
            }
        }
        self.settled = true;
    }
}

impl Drop for PremarkedServiceAuthorityTerminal {
    fn drop(&mut self) {
        if !self.settled && !self.ambiguous {
            self.settle(false);
        }
    }
}

impl PreparedServiceAuthorityTerminal for PremarkedServiceAuthorityTerminal {
    fn committed(mut self: Box<Self>) -> SnapbackResult<()> {
        self.settle(true);
        Ok(())
    }

    fn rolled_back(mut self: Box<Self>) {
        self.settle(false);
    }

    fn mark_ambiguous(&mut self) {
        // An unknown SQLite outcome must never reopen a prepared authority.
        // Keep this exact ticket installed and retain this handle so a later
        // durable predecessor/successor proof can settle only this mutation.
        self.ambiguous = true;
    }
}

impl ServiceAuthorityCommitInterlock for ServiceAuthorityFenceRegistry {
    fn prepare_terminal(
        &self,
        token_ids: &[String],
        disposition: ServiceAuthorityDisposition,
    ) -> SnapbackResult<Box<dyn PreparedServiceAuthorityTerminal>> {
        let token_ids = token_ids.iter().collect::<BTreeSet<_>>();
        let mut registry = self
            .state
            .lock()
            .map_err(|_| service_authority_unavailable("the service fence registry is poisoned"))?;
        registry.next_ticket = registry
            .next_ticket
            .checked_add(1)
            .ok_or_else(|| service_authority_unavailable("service fence tickets are exhausted"))?;
        let ticket = registry.next_ticket;
        let fences = token_ids
            .into_iter()
            .filter_map(|token_id| registry.by_token.get(token_id).and_then(Weak::upgrade))
            .collect::<Vec<_>>();
        let prepared = PremarkedServiceAuthorityTerminal {
            ticket,
            fences,
            disposition,
            settled: false,
            ambiguous: false,
        };
        for fence in &prepared.fences {
            let mut state = fence.lock().map_err(|_| {
                service_authority_unavailable("a service authority fence is poisoned")
            })?;
            if !state.pending_tickets.insert(ticket) {
                return Err(service_authority_unavailable(
                    "a service authority terminal ticket was reused",
                ));
            }
            let wait_deadline = Instant::now()
                .checked_add(EXTERNAL_EFFECT_INITIATION_WAIT)
                .unwrap_or_else(Instant::now);
            while !state.active_external_effects.is_empty() {
                drop(state);
                if Instant::now() >= wait_deadline {
                    return Err(service_authority_unavailable(
                        "an external service-authority effect did not finish initiation",
                    ));
                }
                std::thread::park_timeout(EXTERNAL_EFFECT_INITIATION_POLL);
                state = fence.lock().map_err(|_| {
                    service_authority_unavailable("a service authority fence is poisoned")
                })?;
            }
        }
        // Prevent Drop from observing a partially initialized carrier only
        // after every marker has been installed; on an early error Drop
        // compare-removes whatever prefix was installed.
        let output: Box<dyn PreparedServiceAuthorityTerminal> = Box::new(prepared);
        Ok(output)
    }
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
    use crate::auth::provider::{AuthClock, AuthProviderProfile};
    use std::sync::atomic::{AtomicU64, Ordering};

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
    fn ambiguous_reconciliation_settles_only_its_exact_ticket() {
        let registry = ServiceAuthorityFenceRegistry::default();
        let monotonic = Instant::now();
        let publication = registry
            .register(witness("token-a", 200), 100, monotonic)
            .expect("register witness");
        let mut first = registry
            .prepare_terminal(
                &["token-a".to_owned()],
                ServiceAuthorityDisposition::Carrier,
            )
            .expect("premark first");
        let mut second = registry
            .prepare_terminal(
                &["token-a".to_owned()],
                ServiceAuthorityDisposition::DurableDelete,
            )
            .expect("premark second");
        first.mark_ambiguous();
        second.mark_ambiguous();

        first.rolled_back();
        assert_eq!(
            publication.resolve_act(101, monotonic).unwrap(),
            ServiceAuthorityActResolution::Unavailable,
            "settling one ambiguous transaction must not clear another ticket"
        );
        second.committed().expect("settle exact successor");
        assert_eq!(
            publication.resolve_act(101, monotonic).unwrap(),
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

    #[test]
    fn terminal_commit_waits_for_external_effect_initiation_cut() {
        let registry = ServiceAuthorityFenceRegistry::default();
        let monotonic = Instant::now();
        let publication = registry
            .register(witness("token-a", 1_000), 100, monotonic)
            .expect("register witness");
        let permit = publication
            .begin_external_effect(100, monotonic)
            .expect("begin effect");
        let terminal_registry = registry.clone();
        let (sender, receiver) = std::sync::mpsc::channel();
        let terminal = std::thread::spawn(move || {
            let prepared = terminal_registry
                .prepare_terminal(
                    &["token-a".to_owned()],
                    ServiceAuthorityDisposition::DurableDelete,
                )
                .expect("premark after initiation");
            prepared.committed().expect("commit terminal");
            sender.send(()).expect("report terminal");
        });

        while !matches!(
            publication.resolve_act(101, monotonic).unwrap(),
            ServiceAuthorityActResolution::Unavailable
        ) {
            std::thread::yield_now();
        }
        assert!(receiver.try_recv().is_err());
        permit.initiated();
        receiver
            .recv_timeout(Duration::from_secs(1))
            .expect("terminal completes after initiation");
        terminal.join().expect("terminal thread");
        assert!(publication.begin_external_effect(101, monotonic).is_err());
    }
}
