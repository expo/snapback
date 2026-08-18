//! Process-local capture delivery for the built-in email-code auth provider.
//!
//! A reservation owns the plaintext before the durable challenge transaction,
//! counts against the fixed capacity, and either becomes visible after commit
//! or erases itself on drop. The provider's address stripe and maintenance gate
//! live above this module; this map never waits for either while locked.
//!
//! @ref LLP 0057#capture-mailbox — capture is bounded, process-local, and
//!   erased on consume, supersede, committed reset, expiry, or process exit.
//! @ref LLP 0057#concurrency-locks-and-linearization — mailbox publication and
//!   erasure occur after the durable transaction while the address stripe is
//!   still held.

use crate::auth::crypto::{CanonicalAddress, ChallengeId, VerificationCode};
use crate::auth::throttle::{AuthBudgetName, AuthBudgetRefusal};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use std::collections::HashMap;
use std::fmt;
use std::sync::{Arc, Mutex};
use std::time::Instant;

/// Published entries plus pre-commit reservations may never exceed this cap.
pub use crate::auth::throttle::AUTH_CAPTURE_MAILBOX_CAPACITY as CAPTURE_MAILBOX_CAPACITY;

/// Complete ephemeral delivery payload. It is deliberately not cloneable or
/// serializable; only `with_published` lends its secret fields to a gated seam.
pub struct CaptureMailboxEntry {
    challenge_id: ChallengeId,
    canonical_address: CanonicalAddress,
    code: VerificationCode,
    expires_at: Instant,
    expires_at_ms: u64,
}

impl CaptureMailboxEntry {
    pub fn new(
        challenge_id: ChallengeId,
        canonical_address: CanonicalAddress,
        code: VerificationCode,
        expires_at: Instant,
        expires_at_ms: u64,
    ) -> SnapbackResult<Self> {
        if expires_at_ms > 9_007_199_254_740_991 {
            return Err(mailbox_unavailable(
                "capture delivery received an out-of-range expiry",
            ));
        }
        Ok(Self {
            challenge_id,
            canonical_address,
            code,
            expires_at,
            expires_at_ms,
        })
    }
}

impl fmt::Debug for CaptureMailboxEntry {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CaptureMailboxEntry")
            .field("challenge_id", &self.challenge_id)
            .field("canonical_address", &"[REDACTED]")
            .field("code", &"[REDACTED]")
            .field("expires_at", &self.expires_at)
            .field("expires_at_ms", &self.expires_at_ms)
            .finish()
    }
}

/// First-phase lookup result. Its address is needed only to choose the provider
/// stripe, so Debug remains redacted and no code is copied.
pub struct CaptureMailboxPeek {
    canonical_address: CanonicalAddress,
}

impl CaptureMailboxPeek {
    pub fn canonical_address(&self) -> &CanonicalAddress {
        &self.canonical_address
    }
}

impl fmt::Debug for CaptureMailboxPeek {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("CaptureMailboxPeek([REDACTED])")
    }
}

/// Borrowed, fully gated response view. Keeping this borrowed avoids creating a
/// second long-lived plaintext code inside the provider core.
pub struct CaptureMailboxView<'a> {
    pub challenge_id: &'a ChallengeId,
    pub canonical_address: &'a CanonicalAddress,
    pub code: &'a str,
    pub expires_at_ms: u64,
}

struct StoredEntry {
    reservation_id: u64,
    published: bool,
    entry: CaptureMailboxEntry,
}

struct MailboxState {
    entries: HashMap<ChallengeId, StoredEntry>,
    next_reservation_id: u64,
}

struct CaptureMailboxInner {
    state: Mutex<MailboxState>,
    clock: Arc<dyn Fn() -> Instant + Send + Sync>,
    capacity: usize,
}

/// Cloneable process-local mailbox handle. Plaintext lives only in the shared
/// map and in the short-lived gated borrow returned by `with_published`.
#[derive(Clone)]
pub struct CaptureMailbox {
    inner: Arc<CaptureMailboxInner>,
}

impl Default for CaptureMailbox {
    fn default() -> Self {
        Self::new()
    }
}

impl CaptureMailbox {
    pub fn new() -> Self {
        Self::new_with_clock(Arc::new(Instant::now))
    }

    pub(crate) fn new_with_clock(clock: Arc<dyn Fn() -> Instant + Send + Sync>) -> Self {
        Self::new_with_clock_and_capacity(clock, CAPTURE_MAILBOX_CAPACITY)
    }

    pub(crate) fn new_with_clock_and_capacity(
        clock: Arc<dyn Fn() -> Instant + Send + Sync>,
        capacity: usize,
    ) -> Self {
        assert!(
            capacity > 0,
            "resolved mailbox budget is finite and positive"
        );
        Self {
            inner: Arc::new(CaptureMailboxInner {
                state: Mutex::new(MailboxState {
                    entries: HashMap::new(),
                    next_reservation_id: 1,
                }),
                clock,
                capacity,
            }),
        }
    }

    /// Reserve capacity before the challenge transaction. The entry remains
    /// invisible until `CaptureMailboxReservation::publish` is called after
    /// commit. Dropping the reservation erases its plaintext.
    pub fn reserve(&self, entry: CaptureMailboxEntry) -> SnapbackResult<CaptureMailboxReservation> {
        let now = (self.inner.clock)();
        let mut state = self.lock_state();
        prune_expired(&mut state, now);
        if now >= entry.expires_at {
            return Err(mailbox_unavailable(
                "capture delivery cannot reserve an already-expired challenge",
            ));
        }
        if state.entries.len() >= self.inner.capacity {
            return Err(
                AuthBudgetRefusal::occupancy(AuthBudgetName::ChallengeAllocation).legacy_error(
                    "SNAPBACK_AUTH_THROTTLED",
                    "auth-mailbox",
                    "the capture mailbox is at capacity",
                ),
            );
        }
        if state.entries.contains_key(&entry.challenge_id) {
            return Err(mailbox_unavailable(
                "capture delivery challenge id collided with a live mailbox entry",
            ));
        }
        let reservation_id = state.next_reservation_id;
        state.next_reservation_id = state.next_reservation_id.checked_add(1).ok_or_else(|| {
            mailbox_unavailable("capture mailbox reservation generation exhausted")
        })?;
        let challenge_id = entry.challenge_id.clone();
        state.entries.insert(
            challenge_id.clone(),
            StoredEntry {
                reservation_id,
                published: false,
                entry,
            },
        );
        Ok(CaptureMailboxReservation {
            mailbox: self.clone(),
            challenge_id,
            reservation_id,
            active: true,
        })
    }

    /// First half of the mailbox GET choreography. The caller releases the map
    /// lock before waiting for this address's stripe.
    pub fn peek_address(&self, challenge_id: &ChallengeId) -> Option<CaptureMailboxPeek> {
        let now = (self.inner.clock)();
        let mut state = self.lock_state();
        prune_expired(&mut state, now);
        let stored = state.entries.get(challenge_id)?;
        stored.published.then(|| CaptureMailboxPeek {
            canonical_address: stored.entry.canonical_address.clone(),
        })
    }

    /// Re-read after the caller acquired the address stripe, then lend the
    /// plaintext to the gated projection without consuming it. The projection
    /// runs while the mailbox map is locked, so it must remain short and must
    /// not acquire the maintenance gate or an address stripe.
    pub fn with_published<T>(
        &self,
        challenge_id: &ChallengeId,
        expected_canonical_address: &CanonicalAddress,
        project: impl FnOnce(CaptureMailboxView<'_>) -> T,
    ) -> Option<T> {
        let now = (self.inner.clock)();
        let mut state = self.lock_state();
        prune_expired(&mut state, now);
        let stored = state.entries.get(challenge_id)?;
        if !stored.published || &stored.entry.canonical_address != expected_canonical_address {
            return None;
        }
        Some(project(CaptureMailboxView {
            challenge_id: &stored.entry.challenge_id,
            canonical_address: &stored.entry.canonical_address,
            code: stored.entry.code.expose_secret(),
            expires_at_ms: stored.entry.expires_at_ms,
        }))
    }

    /// Erase after durable consume while the address stripe is still held.
    pub fn erase(&self, challenge_id: &ChallengeId) -> bool {
        let now = (self.inner.clock)();
        let mut state = self.lock_state();
        prune_expired(&mut state, now);
        state.entries.remove(challenge_id).is_some()
    }

    /// Erase every older entry for an address after durable supersession. The
    /// newly committed reservation remains present but invisible until publish.
    pub fn erase_address_except(
        &self,
        canonical_address: &CanonicalAddress,
        keep_challenge_id: &ChallengeId,
    ) {
        let now = (self.inner.clock)();
        let mut state = self.lock_state();
        prune_expired(&mut state, now);
        state.entries.retain(|challenge_id, stored| {
            challenge_id == keep_challenge_id
                || &stored.entry.canonical_address != canonical_address
        });
    }

    /// Call only after the app+auth reset transaction commits under the
    /// exclusive maintenance gate.
    pub fn clear_after_committed_reset(&self) {
        self.clear();
    }

    /// Declared restore purges challenges transactionally, then clears capture
    /// plaintext under the same exclusive maintenance boundary.
    pub fn clear_after_declared_restore(&self) {
        self.clear();
    }

    /// Maintenance GC hook; every ordinary operation already prunes first.
    pub fn prune_expired(&self) -> usize {
        let now = (self.inner.clock)();
        let mut state = self.lock_state();
        let before = state.entries.len();
        prune_expired(&mut state, now);
        before - state.entries.len()
    }

    fn clear(&self) {
        let mut state = self.lock_state();
        state.entries.clear();
    }

    fn lock_state(&self) -> std::sync::MutexGuard<'_, MailboxState> {
        self.inner
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    #[cfg(test)]
    fn occupancy(&self) -> usize {
        self.lock_state().entries.len()
    }
}

/// RAII reservation. It is intentionally non-cloneable so precisely one
/// post-commit path can publish or release it.
pub struct CaptureMailboxReservation {
    mailbox: CaptureMailbox,
    challenge_id: ChallengeId,
    reservation_id: u64,
    active: bool,
}

impl CaptureMailboxReservation {
    pub fn challenge_id(&self) -> &ChallengeId {
        &self.challenge_id
    }

    /// Mark the already-reserved entry visible after durable commit. Missing or
    /// replaced state means a violated maintenance/address-lock invariant and
    /// fails closed rather than recreating plaintext after a reset/erase.
    pub fn publish(mut self) -> SnapbackResult<()> {
        let now = (self.mailbox.inner.clock)();
        let mut state = self.mailbox.lock_state();
        prune_expired(&mut state, now);
        let Some(stored) = state.entries.get_mut(&self.challenge_id) else {
            self.active = false;
            return Err(mailbox_unavailable(
                "capture mailbox reservation vanished before publication",
            ));
        };
        if stored.reservation_id != self.reservation_id || stored.published {
            self.active = false;
            return Err(mailbox_unavailable(
                "capture mailbox reservation was not uniquely publishable",
            ));
        }
        stored.published = true;
        self.active = false;
        Ok(())
    }
}

impl fmt::Debug for CaptureMailboxReservation {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CaptureMailboxReservation")
            .field("challenge_id", &self.challenge_id)
            .field("payload", &"[REDACTED]")
            .finish()
    }
}

impl Drop for CaptureMailboxReservation {
    fn drop(&mut self) {
        if !self.active {
            return;
        }
        let mut state = self.mailbox.lock_state();
        let matches = state.entries.get(&self.challenge_id).is_some_and(|stored| {
            stored.reservation_id == self.reservation_id && !stored.published
        });
        if matches {
            state.entries.remove(&self.challenge_id);
        }
    }
}

fn prune_expired(state: &mut MailboxState, now: Instant) {
    state
        .entries
        .retain(|_, stored| now < stored.entry.expires_at);
}

fn mailbox_unavailable(message: &'static str) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_PROVIDER_UNAVAILABLE",
        "auth-mailbox",
        message,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::crypto::{CryptoError, RandomSource};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::Duration;

    struct SeedRandom(u64);

    impl RandomSource for SeedRandom {
        fn fill(&self, destination: &mut [u8]) -> Result<(), CryptoError> {
            for (index, byte) in destination.iter_mut().enumerate() {
                let lane = (index % 8) * 8;
                *byte = (self.0.rotate_left(lane as u32) >> 56) as u8;
            }
            Ok(())
        }
    }

    fn mailbox() -> (CaptureMailbox, Arc<AtomicU64>, Instant) {
        let base = Instant::now();
        let offset = Arc::new(AtomicU64::new(0));
        let clock_offset = offset.clone();
        (
            CaptureMailbox::new_with_clock(Arc::new(move || {
                base + Duration::from_millis(clock_offset.load(Ordering::Acquire))
            })),
            offset,
            base,
        )
    }

    fn challenge(seed: u64) -> ChallengeId {
        ChallengeId::generate(&SeedRandom(seed)).unwrap()
    }

    fn address(value: &str) -> CanonicalAddress {
        CanonicalAddress::parse(value).unwrap()
    }

    fn entry(seed: u64, address_value: &str, base: Instant) -> CaptureMailboxEntry {
        CaptureMailboxEntry::new(
            challenge(seed),
            address(address_value),
            VerificationCode::parse("012345").unwrap(),
            base + Duration::from_secs(600),
            600_000,
        )
        .unwrap()
    }

    #[test]
    fn reservation_is_invisible_and_drop_erases_plaintext() {
        let (mailbox, _offset, base) = mailbox();
        let challenge = challenge(1);
        let reservation = mailbox
            .reserve(entry(1, "person@example.com", base))
            .unwrap();
        assert!(mailbox.peek_address(&challenge).is_none());
        assert_eq!(mailbox.occupancy(), 1);
        let debug = format!("{reservation:?}");
        assert!(debug.contains("[REDACTED]"));
        assert!(!debug.contains("012345"));
        drop(reservation);
        assert_eq!(mailbox.occupancy(), 0);
    }

    #[test]
    fn publish_peek_and_reread_require_the_same_address() {
        let (mailbox, _offset, base) = mailbox();
        let live_challenge = challenge(2);
        mailbox
            .reserve(entry(2, "person@example.com", base))
            .unwrap()
            .publish()
            .unwrap();
        let peek = mailbox.peek_address(&live_challenge).unwrap();
        assert_eq!(peek.canonical_address().as_str(), "person@example.com");
        assert_eq!(format!("{peek:?}"), "CaptureMailboxPeek([REDACTED])");
        let attacker = address("attacker@example.com");
        assert!(
            mailbox
                .with_published(&live_challenge, &attacker, |_| ())
                .is_none()
        );
        let projected = mailbox
            .with_published(&live_challenge, peek.canonical_address(), |view| {
                (
                    view.challenge_id.as_str().to_owned(),
                    view.canonical_address.as_str().to_owned(),
                    view.code.to_owned(),
                    view.expires_at_ms,
                )
            })
            .unwrap();
        assert_eq!(
            projected,
            (
                live_challenge.as_str().to_owned(),
                "person@example.com".to_owned(),
                "012345".to_owned(),
                600_000
            )
        );
        assert!(mailbox.peek_address(&challenge(999)).is_none());
    }

    #[test]
    fn supersede_consume_reset_and_restore_erase_entries() {
        let (mailbox, _offset, base) = mailbox();
        for seed in [10, 11] {
            mailbox
                .reserve(entry(seed, "person@example.com", base))
                .unwrap()
                .publish()
                .unwrap();
        }
        let old = challenge(10);
        let other = challenge(11);
        let new = challenge(12);
        let canonical_address = address("person@example.com");
        let newest = mailbox
            .reserve(entry(12, "person@example.com", base))
            .unwrap();
        mailbox.erase_address_except(&canonical_address, &new);
        assert!(mailbox.peek_address(&old).is_none());
        assert!(mailbox.peek_address(&other).is_none());
        newest.publish().unwrap();
        assert!(mailbox.erase(&new));
        assert!(!mailbox.erase(&new));

        mailbox
            .reserve(entry(13, "person@example.com", base))
            .unwrap()
            .publish()
            .unwrap();
        mailbox.clear_after_committed_reset();
        assert_eq!(mailbox.occupancy(), 0);
        mailbox
            .reserve(entry(14, "person@example.com", base))
            .unwrap()
            .publish()
            .unwrap();
        mailbox.clear_after_declared_restore();
        assert_eq!(mailbox.occupancy(), 0);
    }

    #[test]
    fn reset_invalidates_an_old_reservation_without_erasing_a_new_aba_entry() {
        let (mailbox, _offset, base) = mailbox();
        let challenge = challenge(15);
        let old = mailbox
            .reserve(entry(15, "person@example.com", base))
            .unwrap();
        mailbox.clear_after_committed_reset();
        assert_eq!(
            old.publish().unwrap_err().diagnostic.code,
            "SNAPBACK_AUTH_PROVIDER_UNAVAILABLE"
        );

        let stale = mailbox
            .reserve(entry(15, "person@example.com", base))
            .unwrap();
        mailbox.clear_after_committed_reset();
        let current = mailbox
            .reserve(entry(15, "person@example.com", base))
            .unwrap();
        drop(stale);
        current.publish().unwrap();
        assert!(mailbox.peek_address(&challenge).is_some());
    }

    #[test]
    fn second_read_refuses_an_entry_erased_after_the_initial_peek() {
        let (mailbox, _offset, base) = mailbox();
        let challenge = challenge(16);
        mailbox
            .reserve(entry(16, "person@example.com", base))
            .unwrap()
            .publish()
            .unwrap();
        let peek = mailbox.peek_address(&challenge).unwrap();
        assert!(mailbox.erase(&challenge));
        assert!(
            mailbox
                .with_published(&challenge, peek.canonical_address(), |_| ())
                .is_none()
        );
    }

    #[test]
    fn expiry_is_pruned_on_every_operation_and_maintenance() {
        let (mailbox, offset, base) = mailbox();
        let expiring = challenge(20);
        mailbox
            .reserve(entry(20, "person@example.com", base))
            .unwrap()
            .publish()
            .unwrap();
        offset.store(600_000, Ordering::Release);
        assert!(mailbox.peek_address(&expiring).is_none());
        assert_eq!(mailbox.occupancy(), 0);

        let fresh = CaptureMailboxEntry::new(
            challenge(21),
            address("person@example.com"),
            VerificationCode::parse("123456").unwrap(),
            base + Duration::from_millis(600_001),
            600_001,
        )
        .unwrap();
        mailbox.reserve(fresh).unwrap().publish().unwrap();
        offset.store(600_001, Ordering::Release);
        assert_eq!(mailbox.prune_expired(), 1);
    }

    #[test]
    fn reservations_and_publications_share_the_exact_capacity() {
        let (mailbox, _offset, base) = mailbox();
        let mut reservations = Vec::with_capacity(CAPTURE_MAILBOX_CAPACITY);
        for index in 0..CAPTURE_MAILBOX_CAPACITY {
            reservations.push(
                mailbox
                    .reserve(entry(index as u64 + 1_000, "person@example.com", base))
                    .unwrap(),
            );
        }
        let error = mailbox
            .reserve(entry(10_000, "person@example.com", base))
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_THROTTLED");
        assert_eq!(
            error.diagnostic.details["budgetName"],
            "auth.challenge-allocation"
        );
        assert_eq!(
            error.diagnostic.details["retryAfter"]["kind"],
            "resource-release"
        );
        reservations.pop();
        mailbox
            .reserve(entry(10_001, "person@example.com", base))
            .unwrap();
    }

    #[test]
    fn code_and_entry_debug_are_redacted_and_code_shape_is_closed() {
        assert!(VerificationCode::parse("12345").is_err());
        assert!(VerificationCode::parse("12345x").is_err());
        let code = VerificationCode::parse("654321").unwrap();
        assert_eq!(format!("{code:?}"), "VerificationCode([REDACTED])");
        let entry = CaptureMailboxEntry::new(
            challenge(30),
            address("secret-address@example.com"),
            code,
            Instant::now() + Duration::from_secs(1),
            1,
        )
        .unwrap();
        let debug = format!("{entry:?}");
        assert!(!debug.contains("654321"));
        assert!(!debug.contains("secret-address"));
    }
}
