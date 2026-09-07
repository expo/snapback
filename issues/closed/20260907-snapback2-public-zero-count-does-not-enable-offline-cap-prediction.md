# Snapback 2: public zero count does not enable offline cap prediction

**Status:** Closed — paired proof repair, 2026-09-07
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

[Original failure and final real response](../../benchmarks/runs/2026-09-07-snapback2-evolution-diagnostic/README.md#public-count-acquisition-and-offline-prediction)
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
[the actual review](../../llp/reviews/1018-zero-count-design.astra.md).

The incomplete runtime optimization was removed. The next implementation must
acquire both facts through real reads, carry authorized full-group coverage
through existing range evidence or explicitly revise alternate-absence custody,
and keep hidden-hit/miss indistinguishability, eviction semantics, resource
bounds, authority/generation fences, and native/twin uniqueness aligned.
Do not bypass the target unique check or infer either fact from scalar zero.
The existing public test now also cold-reopens every carrier: held nonzero
counts remain usable, unheld/zero counts remain unpredicted, and reconnect
retains owner commit/atomic-overflow behavior. An exact cached zero remains a
complete stale answer through `offlineView`; that answer is not new authority
for the target insertion. The ticket remains open.

## Resolution — 2026-09-07 continuation

The owner now preserves the original physical full unique-group point miss and
carries its exact empty extent through an existing exhausted range receipt.
A separate actual canonical `byId` lookup must also miss before either optional
proof is exported. Both facts are required: the range proves group uniqueness,
and the primary absence permits starting the maintained count. Structurally
Public/Allow Count targets only are eligible; receipt-only evaluation cannot
mint these facts. Existing public primary-only absence filtering is unchanged.

The certificate reserves the extra probe, constraint/index dependency and proof
bytes. The serialized pair is checked against that reserve before the extra
read; oversized keys omit both optional proofs without changing the answer.
The original point remains the OCC and live-invalidation dependency. The
implementation and limitations are recorded in LLP 1001 §4 and LLP 1012 §8.

Eleven focused native tests passed: positive proof shape, retained survivors,
cross-group canonical ID collision, read authority, receipt-only custody,
admission costs, oversized keys, every changed range field, OCC and live rerun.
The actual public-owner witness passed in 21.44 seconds including bootstrap
(7.46-second test body): it acquires both proofs without source rows, cold
reopens, predicts from zero, cold reopens again with the prediction, advances
to cap 3, suppresses a fourth prediction, and reconnects to three commits and
one `E_CONSTRAINT` rejection. Held/unheld counts and atomic overflow remain
controls. No injected receipt or TS runtime change is involved. These are scoped
checks, not a complete-suite, architecture-lane or publication qualification.

### Final review and guarded candidate

The independent key-domain review found that a native String/Id mismatch could
turn a real miss into false coverage after wire retagging. The final candidate
`6b8530f6e` admits only validated scalar key domains; JSON/compound groupings
omit the optional pair. Twelve native regressions pass, including that repair.
The fresh [Astra review](../../llp/reviews/1018-zero-count-paired-proof.astra.md)
reports no material findings. The regenerated corpus has 243 cases (25
server-only); all 218 evaluator replays and two visibility checks pass.

Two final-source public attempts stopped before the test body at the existing
10-second owner-readiness deadline (25.57 and 31.53 seconds including bootstrap).
A bounded diagnostic with a temporary 30-second readiness allowance passed in
19.20 seconds, with all behavior assertions passing in 7.06 seconds. The
harness is restored unchanged. That is final functional evidence, not a pass
at the original startup deadline. The existing [timing ticket](../20260901-snapback2-scripts-test-sh-flakes-under.md)
retains both failures. Ref-check and caps pass; no full-suite pass is claimed.
