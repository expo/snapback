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
