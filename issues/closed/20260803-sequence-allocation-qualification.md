# Qualify and publish the LLP 0135 sequence-allocation capability

**Status:** Closed
**Systems:** Runtime, Storage, Settlement, Testing, Capability publication
**Related:** LLP 0135 §5.1, LLP 0113, closed umbrella ticket
`issues/closed/20260802-wave1-0135-sequences-snapshot-batch.md`

The handler-tier sequence substrate, generated `AllocateSequence` step,
mutation-atomic lane-Q withholding, and A6 evidence have landed, but
`sequence_allocation_v1` intentionally remains support-false. Complete LLP
0135 §5.1's abort-disclosure, multi-writer performance/commit-order, and
remaining qualification corpus, then use LLP 0113's publication authority
before any target advertises support.

This ticket carries only the sequence publication remainder split from the
closed Wave-1 umbrella. Snapshot-batch v1 is implemented separately and must
not be reopened here.

## Resolution — 2026-08-04

Completed the full LLP 0135 §5.1 qualification corpus for
`local-dev-sqlite-ibex`:

- dense multi-writer allocation and commit-version ordering (24 writers, a
  15-second enforced budget, observed 364 ms elapsed / 359 ms p95), plus the
  stale-first-writer conflict falsifier;
- real-Ibex console and thrown-error abort-disclosure runs, both trace-free on
  durable/application/activity/settlement/result surfaces;
- delete/recreate incarnation restart, physical-orphan isolation,
  incarnation-prefixed uniqueness, and reviewed brownfield backfill;
- byte-exact sequential and concurrent duplicate settlement replay with one
  counter advance; the concurrent proof found and fixed the settlement
  precheck race;
- lane-Q cross-projection mutation-atomic withholding through fresh queue,
  retained reload, and authoritative settlement;
- MAX−1/MAX/repeated post-MAX exhaustion, undeclared and oracle-collapsed
  scope refusals, and the closed no-current-value API;
- Relay `moveCard` generated write-with-activity atomicity and exact
  `{cardId, activityId, sequence}` replay; and
- Campfire `send` through the public-scope handler arm with eight anonymous
  concurrent senders, dense commit ordering, and zero application range reads.

Publication evidence is
`tests/conformance/sequence-allocation-publication-v1.receipt.json`, verified
by `tests/conformance/sequence-allocation-publication-v1.mjs` and bound into
`src/local-sequence-allocation-publication.v1.json`. The manifest advertises
`sequence_allocation_v1` only for contributor-source builds of the exact local
target. Public-package, remote, conformance, and hosted targets retain the
structured GAP. Maturity remains **Experimental**: LLP 0113 authorizes support
publication but cannot mint Stable, which remains subject to LLP 0134. The
guide capability row and generated target manifests record the same boundary.

LLP 0135 carries a dated implementation record for the completed corpus and
publication. Snapshot-batch v1 was not changed or reopened.
