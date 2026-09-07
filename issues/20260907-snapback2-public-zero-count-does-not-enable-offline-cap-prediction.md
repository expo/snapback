# Snapback 2: public zero count does not enable offline cap prediction

**Status:** Open
**Date:** 2026-09-07
**Systems:** maintained count query receipts, offline cap prediction
**Source:** LLP 1018 public-client diagnostic on df959d36a product source

A matching maintained count acquired through an ordinary public query enables
offline allocation against a cap when the count row exists. For a new group,
`return #principalCounts[principal]` returns complete zero with no count row
and no absence/range/verdict in its receipt. The client conservatively queues
the allocation without prediction; reconnect commits it under the owner cap.
This is a missing prediction opportunity, not incorrect zero inference or
lost data. An unheld count must continue to be unknown.

Reproduction is the existing test `public count reads enable multi-principal
offline cap prediction without inventing missing counts` in
`snapback2/packages/snapback2/tests/real-owner.test.ts`. It uses `cap 3 by
principal`, a matching count maintain, normal seed source rows, public guest
authentication, public count queries, and a separate file carrier per case.

[Original failure and final real response](../benchmarks/runs/2026-09-07-snapback2-evolution-diagnostic/README.md#public-count-acquisition-and-offline-prediction)
retain the expectation that zero would predict and the later scoped result.
The observed receipt is entirely empty; the initial speculation about a
wrong-index absence was disproved. The exact producer/consumer repair remains
to be investigated.

Follow up by carrying a justified, policy-scoped absence from the public count
query to the cap predictor. Preserve generation/authority fences, missing
versus zero, denied counts, atomic cap rollback, and source-scan fallback.
Verify actual public acquisition and cold reopen without injected rows or
receipts. Do not infer zero from an empty response or weaken authorization.

## Bounded execution finding — 2026-09-07

The missing receipt has two causes. Native `get_tracked` records the authored
alternate group-index absence, but `offline::project` exports only `byId`
absence facts. The client store likewise rejects alternate-index negative
receipts because its negative-fact path evicts by primary ID.

A separately metered primary-ID probe was tested on candidate `56b0323bd`.
Five targeted native regressions passed, including retained noncanonical rows,
a canonical-looking ID stored under another group, and admission accounting.
The actual public query then delivered the correct primary absence. After cold
reopen, the client still correctly refused prediction: `Runner.applyAggregate`
passes its primary-absence check, but the inserted maintained row's unique
group-index check also requires held group absence or complete group coverage.
The file carrier preserves the receipt; persistence is not the missing link.

The original group read and canonical primary-ID read are **not equivalent**:
LLP 1001 permits ordinary target survivors. A primary miss cannot prove the
unique group unoccupied, and a group miss cannot prove the canonical ID absent.
The initial Astra review's substitution objection is preserved in
[the actual review](../llp/reviews/1018-zero-count-design.astra.md).

The incomplete runtime optimization was removed. The next implementation must
acquire both facts through real reads, carry authorized full-group coverage
through existing range evidence or explicitly revise alternate-absence custody,
and keep hidden-hit/miss indistinguishability, eviction semantics, resource
bounds, authority/generation fences, and native/twin uniqueness aligned.
Do not bypass the target unique check or infer either fact from scalar zero.
The existing public test now also cold-reopens every carrier: held nonzero
counts remain usable, unheld/zero counts remain unpredicted, and reconnect
retains owner commit/atomic-overflow behavior. The ticket remains open.
