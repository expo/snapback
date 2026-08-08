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

use std::time::Duration;

use tokio::sync::Notify;

/// Policy knobs for the coalescing decision. Defaults are production policy;
/// tests construct explicit tunables for deterministic scheduling.
#[derive(Clone, Debug)]
pub struct LiveCoalesceTunables {
    /// Frames cheaper than this never defer: per-commit delivery is preserved
    /// for every workload where re-evaluation is not the bottleneck (all
    /// small stores, and the delta fast path).
    pub min_eval_cost: Duration,
    /// Floor on the backlog window (the window is otherwise the measured cost
    /// of the previous fan-out frame). Zero in production — a nonzero floor
    /// makes deferral deterministic for tests.
    pub min_window: Duration,
    /// Starvation bound: a pending frame that has absorbed this many commit
    /// frames is flushed inline by the next commit instead of deferring again.
    pub max_frames: u64,
    /// Starvation/memory bound on the merged `ChangedRow` list.
    pub max_changes: usize,
    /// Absolute age bound on a pending frame. The backstop task normally
    /// flushes far sooner; this keeps liveness even if it cannot run.
    pub max_hold: Duration,
}

impl Default for LiveCoalesceTunables {
    fn default() -> Self {
        Self {
            min_eval_cost: Duration::from_millis(25),
            min_window: Duration::ZERO,
            max_frames: 4096,
            max_changes: 25_000,
            max_hold: Duration::from_secs(5),
        }
    }
}

/// Installed by the serving process (which also owns the backstop flusher
/// task) into `LocalSnapback`. When absent — unit tests, CLI one-shots,
/// embedders that opt out — every commit fans out inline exactly as before.
///
/// Correctness never depends on the deferral heuristics: any deferral
/// requests a backstop flush, and the flush requests are sticky (a permit is
/// stored when no flusher is waiting), so a deferred frame is always
/// delivered even when no further commit arrives.
#[derive(Debug, Default)]
pub struct LiveFanoutCoalescer {
    tunables: LiveCoalesceTunables,
    flush_requested: Notify,
}

impl LiveFanoutCoalescer {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_tunables(tunables: LiveCoalesceTunables) -> Self {
        Self {
            tunables,
            flush_requested: Notify::new(),
        }
    }

    pub fn tunables(&self) -> &LiveCoalesceTunables {
        &self.tunables
    }

    /// Record that a commit frame was deferred and the backstop flusher (if
    /// one is waiting or will wait) must flush. `notify_one` stores a permit,
    /// so a request made while the flusher is mid-flush is never lost.
    pub fn request_flush(&self) {
        self.flush_requested.notify_one();
    }

    /// Await the next flush request (backstop task's wait point).
    pub async fn flush_requested(&self) {
        self.flush_requested.notified().await;
    }
}

/// Cumulative coalescing counters, reported beside `LiveDeliveryStats` (kept
/// out of the serialized inspect surface for now — exposing them there means
/// regenerating the drift-gated inspect schemas, a deliberate follow-up).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct LiveCoalesceStats {
    /// Commit frames whose data fan-out was deferred into the pending frame.
    pub deferred_commits: u64,
    /// Flushes that delivered a pending (coalesced) frame, by any path.
    pub coalesced_flushes: u64,
    /// Coalesced flushes performed by the backstop task specifically.
    pub backstop_flushes: u64,
    /// Number of deferred commit frames merged into the most recent
    /// coalesced flush (including the flushing commit's own frame when the
    /// flush rode a commit).
    pub last_flush_merged_frames: u64,
}
