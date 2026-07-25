# 0093 P-2 spec defect: fixture `expect.actions` judgment semantics are underspecified

**Opened:** 2026-07-25
**Source:** LLP 0093 D4 clean-room discipline (P-2 Swift conformance
harness over `schemas/live.wire-fixtures.v1.json`).
**Systems:** Wire Protocol, Tests, Native Clients

LLP 0095 §2.1 says a harness "feeds each `frame` to the client in the
`given` state and asserts the `expect` obligations against the §1 model",
but does not pin:

1. **Set vs sequence vs subset.** Are `expect.actions` an exact set, an
   ordered trace, or a minimum obligation the client may exceed? The P-2
   harness judged them as an **exact set**; that is the strictest reading
   that all ten seeded fixtures satisfy, but only after resolving item 2.
2. **Batch subsumption.** In
   `poll.acknowledged_batch.malformed_item_forces_resync`, the expected
   actions are `[deliver_batch_remainder, surface_decode_diagnostic,
   resubscribe_all, clear_retained_overlays]` — the remainder's own
   per-item actions (`unwrap_durable`, and the version-guard outcome for
   its inner envelope) are evidently **subsumed** under
   `deliver_batch_remainder`, while the clean-batch fixture
   (`poll.wrapped_durable.unwrap`) reports per-item actions explicitly.
   That subsumption rule is inferable only from the fixture instances, not
   from the spec.
3. **`given.connection: {state: attached}` population.** Connection-wide
   fixtures leave the subscription population unspecified; the harness had
   to invent one (two live subscriptions) to make `all_subscriptions →
   resync_pending` observable. A pinned minimal population (or explicit
   `given.subscriptions`) would remove the freedom.

**Resolution taken (best effort):** exact-set judgment; remainder actions
subsumed under `deliver_batch_remainder` once a malformed item has been
seen; two-subscription population for attached-connection fixtures. All
10 seeded fixtures pass under these rules
(`clients/swift/SnapbackClient`, `FixtureHarness`).

**Fix wanted:** LLP 0095 §2.1 pins the three rules (or the corpus grows
explicit members for them) so two independent harnesses cannot pass the
same corpus under different judgments.

## Resolution (2026-07-25)

LLP 0095 §2.1 now carries a normative **"Judgment rules"** block pinning
all three, matching the judgments the P-2 Swift harness
(`clients/swift/SnapbackClient`, `FixtureHarness.swift`) implements and
all ten seeded fixtures satisfy:

1. `expect.actions` is judged as an **exact, unordered set** — no
   omissions, no extras, never a trace, never a minimum.
2. **Batch composition and subsumption**: the evaluated drain batch is
   `frame` followed by `batchContext` in order; in a batch containing an
   undecodable item, the remaining items' per-item actions are subsumed
   under `deliver_batch_remainder`, while clean batches report per-item
   actions explicitly.
3. **Attached-connection population**: `given.connection: {"state":
   "attached"}` without explicit subscriptions is evaluated against a
   pinned minimal population of two durable subscriptions in `LIVE`, with
   explicit `given.subscriptions` named as a possible future
   `formatVersion` evolution.

Chosen the spec-pin arm of the ticket's either/or; growing corpus members
(e.g. explicit `given.subscriptions`) remains available as a later
`formatVersion` change and is not required for two harnesses to agree.
