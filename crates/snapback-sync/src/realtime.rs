//! Durable sync and realtime engine state.
//!
//! This module is the first transport-independent owner boundary for durable
//! live delivery. Local execution still drives the fan-out methods while the
//! pending-frame and delivery-observability state live with the realtime
//! engine rather than the local adapter hub.
//!
//! @ref LLP 0225#1-ownership-map — subscriptions, invalidation, and
//! fan-out belong to the durable sync/realtime domain service.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LiveDeliveryStats {
    pub total_fanout_attempts: u64,
    pub total_deliveries: u64,
    pub total_skipped: u64,
    // @ref LLP 0032#phase-1--safety-floor-and-confirmed-defects — S5.D4:
    // post-commit fan-out failures are per-subscription diagnostics, counted
    // here, never a failure of the already-committed mutation.
    pub total_failed: u64,
    pub last_fanout_subscriptions: usize,
    pub last_deliveries: usize,
    pub last_skipped: usize,
    pub last_failed: usize,
    /// The deliberately coarse v1 authorization blast radius, reported both
    /// globally and against each stable membership declaration that caused an
    /// event. These are cumulative runtime-epoch counters; delivery-frame
    /// counters above retain their existing reset semantics.
    ///
    /// @ref LLP 0056#invalidation-the-llp-0053-mapping -- make membership churn's global
    ///   quarantine cost measurable before declaration-scoped narrowing.
    #[serde(default)]
    pub authorization_blast_radius: AuthorizationBlastRadiusStats,
    /// RQS resume/refresh observability (LLP 0090 §Scalability: counters land
    /// with rollout step 1). Cumulative runtime-epoch counters.
    #[serde(default)]
    pub resume: RqsResumeStats,
}

/// Resume attempted/admitted/refused (by per-cause `SNAPBACK_RESUME_*` code),
/// rung taken, journal distance, and token refresh overhead.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RqsResumeStats {
    /// Subscribes that presented `resumeFromToken`.
    pub attempted: u64,
    /// Rung-1 `CurrentAsOf` answers (LLP 0090 D1.3).
    pub current_as_of_answers: u64,
    /// Rung-2 delta-replay answers (LLP 0090 D1.3 / rollout step 6): the
    /// witness verified and a `live_delta` answered the resume.
    #[serde(default)]
    pub delta_replay_answers: u64,
    /// Total `live_delta` ops replayed by rung-2 answers.
    #[serde(default)]
    pub replay_ops: u64,
    /// Estimated bytes avoided by rung-2 answers versus a rung-3
    /// replacement: serialized replacement rows minus the serialized delta
    /// envelope, saturating at zero per answer.
    #[serde(default)]
    pub replay_bytes_avoided: u64,
    /// Token presented, answered with rung 3 (refusal or no available proof).
    pub fresh_replace_answers: u64,
    /// Refusals by `SNAPBACK_RESUME_*` code (LLP 0091 §0B.6).
    pub refused: BTreeMap<String, u64>,
    /// Rung-1 table-set fall-throughs: journal floor held but no certified
    /// dependency-summary artifact exists yet (cluster 0C), so the answer is
    /// rung 3. Not a token refusal — its own telemetry cause.
    pub no_certified_summary: u64,
    /// Tokens minted on the live path (subscribe answers + envelope refresh).
    pub tokens_minted: u64,
    /// Refreshed tokens attached to `live_replace`/`live_delta` envelopes.
    pub tokens_refreshed: u64,
    /// Rows/args the 0A canonicalization refused at mint (`resume` absent).
    pub mint_refusals: u64,
    /// Journal distance (head − token version) of the last presented token.
    pub last_journal_distance: u64,
    /// Maximum observed journal distance.
    pub max_journal_distance: u64,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AuthorizationBlastRadiusStats {
    pub global: AuthorizationBlastRadiusCounters,
    pub membership_declarations: BTreeMap<String, AuthorizationBlastRadiusCounters>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AuthorizationBlastRadiusCounters {
    pub version_advances: u64,
    pub quarantined_subscriptions: u64,
    pub resnapshots: u64,
}

impl AuthorizationBlastRadiusStats {
    pub fn for_event(
        &mut self,
        declarations: &[String],
        update: impl Fn(&mut AuthorizationBlastRadiusCounters),
    ) {
        update(&mut self.global);
        for declaration in declarations {
            update(
                self.membership_declarations
                    .entry(declaration.clone())
                    .or_default(),
            );
        }
    }
}
