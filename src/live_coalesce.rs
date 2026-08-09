//! Post-commit live fan-out coalescing.
//!
//! When durable commits arrive faster than the live fan-out can re-evaluate
//! the affected subscriptions, running one full fan-out per commit makes every
//! queued mutation pay `evaluation × subscribers × queue-depth` (the zb5-hot
//! ceiling: median ~74 s settle at 5.5M rows with six observers). Coalescing
//! merges the change lists of backlogged commits and re-evaluates each
//! observer once against the latest committed state, which is semantically a
//! single multi-write commit frame: the delta classifier already collapses to
//! the last change per row id, and the replace lane always re-queries current
//! state. Convergence is preserved; only intermediate frames are elided —
//! which LLP 0008's idempotent replace/resnapshot contract explicitly allows.
//!
//! @ref LLP 0008#dated-decision--post-commit-fan-out-coalescing-2026-08-08 —
//! the deferral rule, the flush guarantees, and the starvation bounds.

use crate::storage::AuthorizationVersion;
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU8, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::sync::Notify;

/// Policy knobs for the coalescing decision. Defaults are production policy;
/// tests construct explicit tunables for deterministic scheduling.
#[derive(Clone, Debug)]
pub struct LiveCoalesceTunables {
    /// Retained compatibility knob from the predecessor coalescer. The
    /// evaluation scheduler is unconditionally off-turn and does not consult
    /// its old cost heuristic.
    pub min_eval_cost: Duration,
    /// Retained compatibility knob from the predecessor backlog window. It is
    /// inert once this value installs the evaluation scheduler.
    pub min_window: Duration,
    /// A pending delta absorbing this many commits collapses to one refresh
    /// obligation; it never re-enters a commit turn for inline evaluation.
    pub max_frames: u64,
    /// Memory bound on the merged `ChangedRow` list before refresh collapse.
    pub max_changes: usize,
    /// Absolute age bound before a pending delta collapses to refresh.
    pub max_hold: Duration,
    /// Hard wall-clock bound for one subscription evaluation turn. The
    /// scheduler abandons a timed-out waiter and converts the subscription to
    /// one refresh retry; a second consecutive timeout tears it down.
    pub max_eval_turn: Duration,
}

impl Default for LiveCoalesceTunables {
    fn default() -> Self {
        Self {
            min_eval_cost: Duration::from_millis(25),
            min_window: Duration::ZERO,
            max_frames: 4096,
            max_changes: 25_000,
            max_hold: Duration::from_secs(5),
            max_eval_turn: Duration::from_secs(30),
        }
    }
}

const TURN_RUNNING: u8 = 0;
const TURN_ABANDONED: u8 = 1;
const TURN_PUBLISHING: u8 = 2;

/// Cross-thread handshake between the scheduler waiter and one blocking
/// evaluation turn. A timeout can abandon computation until publication
/// begins; once publication wins the CAS, the scheduler waits for that narrow
/// terminal section instead of reporting a timeout after bytes became visible.
#[derive(Debug, Default)]
pub struct LiveEvaluationControl {
    state: AtomicU8,
}

impl LiveEvaluationControl {
    pub fn abandon(&self) -> bool {
        self.state
            .compare_exchange(
                TURN_RUNNING,
                TURN_ABANDONED,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_ok()
    }

    pub fn begin_publication(&self) -> bool {
        self.state
            .compare_exchange(
                TURN_RUNNING,
                TURN_PUBLISHING,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_ok()
            || self.state.load(Ordering::Acquire) == TURN_PUBLISHING
    }

    pub fn is_abandoned(&self) -> bool {
        self.state.load(Ordering::Acquire) == TURN_ABANDONED
    }
}

#[derive(Clone, Debug)]
struct AuthorityFence {
    version: AuthorizationVersion,
    stale: bool,
}

/// Installed by the serving process (which also owns the backstop flusher
/// task) into `LocalSnapback`. When absent — unit tests, CLI one-shots,
/// embedders that opt out — every commit fans out inline exactly as before.
///
/// Every enqueue requests the scheduler, and requests are sticky (a permit is
/// stored when no scheduler is waiting), so pending work is observed even
/// when no further commit arrives.
#[derive(Debug, Default)]
pub struct LiveFanoutCoalescer {
    tunables: LiveCoalesceTunables,
    flush_requested: Notify,
    writers_waiting: AtomicUsize,
    writers_drained: Notify,
    authority_fences: Mutex<BTreeMap<String, AuthorityFence>>,
}

/// RAII visibility for a mutation waiting for, or executing, its commit turn.
/// Cloned scheduler state owns the counter; dropping on every exit (including
/// unwind) makes writer priority fail open only when no writer remains.
///
/// @ref LLP 0200#25-cancellation-fairness-and-bounded-staleness — queued
/// evaluations yield at turn boundaries while a commit writer is pending.
#[derive(Debug)]
pub struct WriterTurnGuard {
    coalescer: Arc<LiveFanoutCoalescer>,
}

impl Drop for WriterTurnGuard {
    fn drop(&mut self) {
        let previous = self
            .coalescer
            .writers_waiting
            .fetch_sub(1, Ordering::AcqRel);
        debug_assert!(previous > 0, "writer-turn guard count underflow");
        self.coalescer.writers_drained.notify_waiters();
    }
}

impl LiveFanoutCoalescer {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_tunables(tunables: LiveCoalesceTunables) -> Self {
        Self {
            tunables,
            flush_requested: Notify::new(),
            writers_waiting: AtomicUsize::new(0),
            writers_drained: Notify::new(),
            authority_fences: Mutex::new(BTreeMap::new()),
        }
    }

    pub fn tunables(&self) -> &LiveCoalesceTunables {
        &self.tunables
    }

    /// Wake the scheduler. `notify_one` stores a permit, so a request made
    /// while it is evaluating a subscription is never lost.
    pub fn request_flush(&self) {
        self.flush_requested.notify_one();
    }

    /// Await the next scheduler request.
    pub async fn flush_requested(&self) {
        self.flush_requested.notified().await;
    }

    pub fn writer_turn_guard(self: &Arc<Self>) -> WriterTurnGuard {
        self.writers_waiting
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |current| {
                current.checked_add(1)
            })
            .expect("writer-turn guard count overflow");
        WriterTurnGuard {
            coalescer: self.clone(),
        }
    }

    pub fn writers_waiting(&self) -> usize {
        self.writers_waiting.load(Ordering::Acquire)
    }

    /// Wait until every writer visible at the current turn boundary drains.
    /// Registering before the count check closes the final-drop notification
    /// race without polling.
    pub async fn writers_drained(&self) {
        loop {
            let notified = self.writers_drained.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if self.writers_waiting() == 0 {
                return;
            }
            notified.await;
        }
    }

    /// Apply the server-side fail-closed fence without entering evaluation or
    /// VM work. Commit order is already serialized; the same-incarnation epoch
    /// guard makes repeated/late markings idempotent and monotone.
    ///
    /// @ref LLP 0200#24-the-authorization-lane-splits-in-two--by-declared-classification —
    /// authority transitions fence registry state before restoration runs.
    pub fn fence_authority(&self, subscription_id: &str, version: AuthorizationVersion) {
        let mut fences = self
            .authority_fences
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        match fences.get_mut(subscription_id) {
            Some(current)
                if current.version.incarnation == version.incarnation
                    && current.version.epoch > version.epoch => {}
            Some(current) => {
                current.version = version;
                current.stale = true;
            }
            None => {
                fences.insert(
                    subscription_id.to_owned(),
                    AuthorityFence {
                        version,
                        stale: true,
                    },
                );
            }
        }
    }

    /// Delivery-time authority gate. Exact equality is intentional: a frame
    /// resolved under either a predecessor epoch or predecessor incarnation is
    /// stale. A current proof simultaneously restores the server-side fence.
    ///
    /// @ref LLP 0200#24-the-authorization-lane-splits-in-two--by-declared-classification —
    /// an in-flight pre-transition frame is discarded after a newer fence.
    pub fn authorize_delivery(
        &self,
        subscription_id: &str,
        resolved: &AuthorizationVersion,
    ) -> bool {
        let mut fences = self
            .authority_fences
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(fence) = fences.get_mut(subscription_id) else {
            return true;
        };
        if &fence.version != resolved {
            return false;
        }
        fence.stale = false;
        true
    }

    pub fn retire_subscription(&self, subscription_id: &str) {
        self.authority_fences
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(subscription_id);
    }

    #[doc(hidden)]
    pub fn authority_is_stale(&self, subscription_id: &str) -> bool {
        self.authority_fences
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(subscription_id)
            .is_some_and(|fence| fence.stale)
    }
}

/// Cumulative coalescing counters reported on the serialized inspect surface.
#[derive(
    Clone, Debug, Default, serde::Deserialize, PartialEq, serde::Serialize, schemars::JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub struct LiveCoalesceStats {
    /// Commit frames whose data fan-out was deferred into the pending frame.
    pub deferred_commits: u64,
    /// Scheduler turns that delivered pending data merged from more than one
    /// commit, by either the serving task or the synchronous embedder drain.
    pub coalesced_flushes: u64,
    /// Pending subscription turns performed by the serving backstop task.
    /// Single-commit turns count here but not as coalesced flushes.
    pub backstop_flushes: u64,
    /// Number of accepted pending commit frames represented by the most
    /// recent scheduler turn. A bound-triggered refresh collapse is one unit.
    pub last_flush_merged_frames: u64,
}
