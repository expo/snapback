# Decide the provider connection and subscription budget contract

**Status:** Open — ruling recorded 2026-08-21 (adopted per LLP 0295; author
may revise); remaining work is the follow-on checklist below
**Opened:** 2026-08-21
**Systems:** Headless client, Provider adapters, Live queries, Auth lifecycle,
React, Diagnostics, Performance
**Governing:** LLP 0295 D0.5/W4; LLP 0095; LLP 0278; LLP 0280
**Related:** `issues/20260820-guide-gap-provider-connection-lifecycle-budget.md`;
`issues/20260820-familiar-live-subscription-contention.md`

## Problem

The public ceiling on individual subscriptions is not an application
composition contract. Matrix adapters independently opened connections,
nested reads inside update callbacks, rebuilt streams during auth settlement,
and fanned one stream per visible entity. Separately, six ordinary Familiar
React subscriptions showed a probable liveness/consistency problem that
disappeared when consolidated. Without explicit ownership and budgets, neither
authors nor diagnostics can distinguish supported composition, inefficient
composition, and product defect.

## Decision packet

Define and justify:

- connection ownership and reuse per app authority/origin;
- ordinary subscriptions per view/provider and how that budget relates to the
  transport's hard ceiling;
- when independent subscriptions must share a snapshot/version boundary and
  when an aggregate relational query is only an optimization;
- nested query behavior from update callbacks;
- equal-snapshot and transport-only publication deduplication;
- bounded fan-out, teardown, retry, and resubscription after auth transitions;
- inspection fields for active connection/subscription owners; and
- the diagnostic emitted before a supported budget or consistency envelope is
  exceeded.

Use the minimized six-subscription investigation as evidence, but do not set a
product limit from the benchmark workaround unless the reproduction proves the
limit is intentional.

## Ruling (2026-08-21 — adopted per LLP 0295; author may revise)

Landed as the LLP 0095 dated amendment (connection ownership, auth-transition
teardown/retry, owner inspection), the LLP 0278 2026-08-21 amendment
(subscription budgets, independent-versus-aggregate consistency,
equal-snapshot dedup, fan-out, callback reentrancy), and an LLP 0280 note
(provider rebuild consumes the persona-replacement seam). All numeric bounds
are **explicit provisional bounds** that the parallel six-subscription
investigation (`issues/20260820-familiar-live-subscription-contention.md`,
LLP 0295 1D) may tighten or confirm; they are not conformance-frozen yet.
Summary against the seven D0.5 bullets:

1. **Connections:** one managed connection per (canonical app id, storage
   partition, origin, settled authority) tuple per execution context —
   composing with LLP 0059's per-(app id, storage partition) coordinator and
   LLP 0114's provider manager identity, so distinct custody partitions are
   never coalesced; two connections only transiently during authority
   replacement, and then as two distinct tuples (predecessor and successor),
   never two for one tuple; N provider cells never imply N connections.
2. **Subscriptions:** hard ceilings stay 64/connection and 2,048/app
   (`crates/snapback-engine/src/local/engine.rs`). Correctness envelope = the
   full hard ceiling (any admitted count must be live-correct; six independent
   subscriptions are ordinary). Ordinary per-view/provider budget: 16
   (provisional), diagnostic-flagged past it.
3. **Nested queries from update callbacks:** synchronous
   subscribe/unsubscribe/dispatch from a delivery callback is unsupported —
   defer to a scheduler boundary; structured diagnostic on attempt; one-shot
   reads admitted but sampling delivered rows preferred.
4. **Equal-snapshot dedup:** value-equal snapshots must not notify consumers
   whether or not the version advances (reconnect routinely delivers equal
   rows at an advanced version); version/resume-token bookkeeping still
   advances internally; providers/hooks own the value-equality dedup atop the
   LLP 0095 version guard.
5. **Fan-out:** per-entity streams supported to the per-view budget; past it
   the paved path is LLP 0278 D4 set-keyed aggregates, named by the budget
   diagnostic.
6. **Teardown/retry after auth transitions:** subscribe-after-settle on
   coordinator state; predecessor teardown before successor establishment
   (sessions: fresh connection); existing T-LOSS/T-RECONNECT/T-GRANT-LOSS
   machinery only, no parallel provider retry loops.
7. **Inspection:** owner-labeled enumeration of active connections and
   subscriptions with state, snapshot version, auth-barrier/readiness, and
   outbox suspension reason; diagnostics fire before a budget/ceiling refuses.

Per LLP 0295 risk 7, the relational-singleton consolidation is **not**
standardized as the only correct path: independent and aggregate forms both
carry explicit supported bounds, and the aggregate form is required only when
the UI needs one atomic cross-set fact (the consistency criterion) — otherwise
it is an optimization. Exact's provider runtime consumes these facts through
LLP 0295 W7 step 3 (provider lifecycle integration), delivered Exact-side per
LLP 0279's graduation posture rather than inventing parallel policy.

## Follow-on checklist

1. Client/runtime enforcement and the named diagnostic codes (final spellings
   owned by the implementation change; the LLPs name only the classes).
2. Inspection surface implementation aligned with LLP 0295 W5's redaction and
   posture rules.
3. Provider integration: connection-manager reuse fixture proving N cells do
   not imply N connections
   (`issues/20260820-guide-gap-provider-connection-lifecycle-budget.md`).
4. Guide recipe update teaching the contract, replacing adapter folklore.
5. Conformance fixtures freezing the bounds once the 1D investigation
   classifies the six-subscription observation (product defect versus
   documented bound versus benchmark-app defect).

## Exit

The owning LLPs carry an accepted numerical and semantic budget contract,
including independent-versus-aggregate consistency guarantees and auth
lifecycle ownership. Follow-on tickets name the client/runtime enforcement,
inspection/diagnostic surface, provider integration, Guide recipe, and
conformance fixtures. The existing Guide ticket then teaches a product contract
rather than empirical adapter folklore.

**Exit progress (2026-08-21):** the budget contract has landed in the owning
LLPs; the follow-on enforcement/inspection/provider/guide/conformance tickets
have **not** yet been filed (the checklist above is their source), so this
ticket deliberately stays open until they exist.
