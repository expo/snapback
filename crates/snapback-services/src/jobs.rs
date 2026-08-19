//! Durable one-off background work — the first implementation slice of
//! LLP 0070's `durable-work-single-process-sqlite-v1` profile (the `runAfter`
//! case): transactional `ctx.jobs.enqueue` from mutations, a paved default
//! queue, `availableAt = now + delay`, fenced claims with append-only attempt
//! receipts, and a set-based injected-clock drain as the deterministic test
//! seam.
//!
//! Claim boundary (LLP 0070 §Non-goals): while LLP 0070 is Draft, nothing in
//! this module claims the `durable-work-single-process-sqlite-v1` tuple or any
//! durable-background-work capability class. The code exists to carry the
//! executable evidence the Draft needs; capability facts emitted anywhere must
//! say `experimental` and name the boundary.
//!
//! @ref LLP 0070#semantics — job identity/enqueue, state machine, claims and
//! fencing, and the jitter profile implemented here follow the RFC's §Semantics;
//! deliberate v1 narrowings are the RFC body's "First slice as shipped"
//! section (the 2026-07-31 amendment note, absorbed 2026-08-01).

pub(crate) use crate::storage::jobs::*;
