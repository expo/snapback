# Coordinator dispositions of the independent assessment

The continuous assessor's [original report](grader/grading/grader-report.json)
is preserved unchanged: SHA-256
`dac354d1e082650d989f580cd3dc9b09e13ebe8a03616e9225cc2845b23ce5e6`.
These dispositions follow inspection of its actual drivers and evidence. They
were not supplied to either Astra builder. No application or platform repair
was made during the pinned-package experiment.

## Confirmed failures

**D1: previously acquired history becomes inaccessible offline after a later
foreground send.** Two independent repetitions fetched all 10,000 expected
message IDs, but subsequent offline pagination could reach only 200. The send
began after substantial acquisition, while the remaining conversation resources
were still being acquired. The resulting IndexedDB contained 503 normalized
rows, including 402 message IDs and diagnostic additions. A startup-send
control retained the acquired history and passed offline pagination.

The [first delayed-send repetition](grader/grading/evidence/gacq-1789230357769/u0500-1.json)
and [repeat](grader/grading/evidence/gacq-1789230955890/u0500-1.json) establish
9,800 fixture IDs **inaccessible through offline pagination**, not 9,800 rows
proven physically deleted. The acquisition accumulator is not an oracle for
current durable content. Server data remained intact. The first offline page
passed, which would have hidden the failure in a page-one-only check.

Source inspection is consistent with this result. In the pinned source,
[storage](../../../snapback3/packages/snapback3/src/resource/storage.ts)
requires equal sequence numbers to merge frames; admitting a later sequence
clears durable rows and resource evidence before writing the new batch.
[FactPool](../../../snapback3/packages/snapback3/src/resource/facts.ts)
also clears its prior pool when the sequence advances. This identifies a
mechanism to investigate, not a tested repair. Authority, revocation and
completeness fences must survive any retention change.

**D2: the selected 100,000-message account does not complete acquisition.**
The builder's three final attempts and the
[independent repetition](grader/grading/evidence/gacq-1789230699958/u0001-1.json)
all timed out at the 180-second cutoff. The independent attempt had fetched
38,900 expected IDs; it reached 10,000 at 30 seconds and 17,400 at 60 seconds.
The partial results are retained and are not successful acquisition samples.

## Rejected grader finding

**D3 is a test precondition error, not evidence of intermittent navigation
failure.** Lines 15–16 of the
[first probe](grader/grading/independent-probe.mjs) switch eight times with
`i % 2 ? 'g-starter' : 'd-alice-bob'`. The last selection, at `i = 7`, is the
group. The next statement waits for DM-only `message-sm0001` without selecting
the DM. A correctly isolated group view should time out at that assertion.

The [second probe](grader/grading/independent-probe2.mjs), lines 12–17,
explicitly selects the DM after the same switching sequence and passes. Its
account-change isolation check also passes. These are different preconditions,
so the two outcomes do not establish intermittent product behavior. Preserve
the first failed probe and raw D3 description, but exclude D3 from product
defect counts and follow-up tickets.

The two script hashes are respectively
`e687da8fd97858ad7b11d8666aefa89b2c5b378e547c18613dd0f8be37deaea2`
and `79b6a6834940e384d09132844673ad4ce54a51a9bcf64441e9db3e01b8691439`.

## Qualified outcomes and remaining coverage

- **Unread convergence / D4 / m8-a14:** the resource-level check passes.
  Rendered positive-to-zero convergence is unproven. The first independent
  driver accepted zero-to-zero; the strengthened driver required a positive
  initial value and failed that precondition. Opening the conversation issues
  a viewed mutation, and the inbox has no unread badge. Do not promote the
  resource result into a complete UI claim.
- **Delivered versus read / D5:** distinct fetched/viewed fields and public
  mutations were verified. The app advances both when the recipient opens the
  conversation, so a stable delivered-only UI state was not established.
  This is a coverage limitation, not independently isolated faulty receipt
  storage.
- **Whole-request failure / D6:** a failing builder check is retained. The
  independent assessor reran the denied-resource and delayed-read controls,
  but did not reproduce or isolate the whole-HTTP-batch failure. Report its
  provenance as builder-observed and unresolved.
- **Custom API:** an early grader probe incorrectly treated the wire envelope
  as plain rows. Later SDK-based pagination verified exact unique IDs. The
  earlier parser result is not an API data-loss finding.
- **Paging:** the 20-request page-one/page-50 measurement was audited from raw
  request evidence, not independently repeated. The reported p95 ratio is
  0.578 (137.4 ms / 237.8 ms), within the selected 3× criterion.

## Measurement interpretation

The ordinary acquisition sampler spans driver-held result arrays, IndexedDB
`getAll()`/JSON inspection and offline replay. Its last sample is not a
steady-state retained-heap measurement. Logical record JSON bytes, browser
storage estimates, transferred bytes, database pages and WAL bytes describe
different quantities and must stay separate.

Some raw send fields are timestamps on the browser performance clock. Compute
durations from submission, rather than repeating those offsets as latencies.
For example, the first delayed-send control submitted at 20,618 ms and became
durable at 20,749.8 ms: **131.8 ms after submission**. Its settlement took
315 ms. That responsiveness does not excuse the simultaneous offline-history
retention failure.

The continuous assessor omitted the requested CPU profile (G1). Its run ended
after 1,362 seconds under a 90-minute prompt limit; the evidence does not show
budget exhaustion. A separate [instrumented diagnostic](profile/README.md)
closes part of that attribution gap on unchanged source. Its one no-send
acquisition is a different measurement condition and must not be pooled with
the ordinary repetitions. CPU self samples, process CPU time, wall time and
await intervals overlap and are not additive elapsed-time shares. The profile
documents mapping uncertainty and its retained first helper failure.

The database contains the messaging projection, small social corpus and a
static seed's commit inventory. It omits the complete social workload and
100,000 public message mutations with their operation receipts. Its byte total
does not establish a storage improvement over Snapback2's full application.

## M7 assessment dispositions

The separate [M7 report](m7-grader/grading/grader-report.json) is preserved
unchanged: SHA-256
`7f44cb5d83cee730ad05dde13ba9d7ce84ed2644b362e7be856f15322d5c4066`.
Its D1–D6 labels belong to that phase, not the continuous defects above. It
supports nine selected assertions on the small prepared database and reruns
25 prior passing regression IDs. Earlier unread/delivered-only UI qualifications
still apply. The failed whole-batch check was excluded from those prior passing
IDs; large acquisition was not rerun after M7.

**Snapshot comparison:** the raw
[comparator result](m7-grader/grading/results/snapshot-comparison-independent.json)
has `pass: false`, but its only differences are three pairs of identical
principal objects. The [driver](m7-grader/grading/probes/snapcmp.mjs) uses
JavaScript object identity (`pre.principal !== post.principal`). The report
acknowledges that false positive. A separate read-only
[coordinator comparison](coordinator-evidence/m7-snapshot-audit.json), generated
by this [script](coordinator-evidence/check-m7-snapshots.py), compares principal
content, exact message IDs and required field values without rewriting the
grade. All 42 persona-visible rows match, with zero missing/added IDs or field
differences and nonempty edited, tombstone, reply, reaction, own-reaction,
fetched and viewed controls for each persona. Array values also match in their
retained order. The grade's false boolean is not evidence of migration data loss.

**M7 D1 — migration-driver error:** accepted with corrected description. The
builder's [driver](m7-builder/m7/migrate.mjs) lists `eve` and `heidi` where the
fixture has `erin` and `henry`; its retained result ends with `E_AUTH_INVALID`.
It fails explicitly during the persona census, after committing the two actual
backfills. The report's phrases “after the first two personas” and “silently
missed” are unsupported: two backfill chunks are not two visited personas, and
the driver records an error and sets a nonzero exit code. The correct independent
eight-persona enumeration plus physical census establishes complete coverage
of the two existing conversations here.

**M7 D2 — bounded migration:** accepted as a disclosed source-derived limitation.
The backfill refuses at 201 visible messages; no larger resumable path exists.
The uninitialized-count guard in subsequent writes makes this a meaningful
restriction. Neither builder nor grader executed a 201-message migration,
so it is not an observed large-database migration failure. No reduced-chunk
recovery is claimed.

**M7 D3 — old-client operation:** the original operation and arguments survive,
and no server message appears during the grader's bounded observation. Its
[helper](m7-grader/grading/probes/old-client.mjs) projects nonexistent `o.state`
as null, while the public field is `status`. That evidence alone establishes
an unsettled retained intent, not its exact phase or a “forever” duration.
The [separate coordinator control](m7-coordinator-controls/README.md), on copies
of the grader's frozen closed profile and migrated database, resolves the phase
without replacing or discarding the operation: `parked`, no receipt, error
`S3_OPERATION_CHANGED`, unchanged through 25.036 seconds online. The server
DM remains at six rows and the original message remains absent. The copied
profile is already parked on offline restoration; this diagnostic is a state
confirmation, not a fresh measurement of the initial transition. The package exposes `client.operation(id)` and
operation snapshots for inspection; the broad “no app or SDK affordance”
description must not erase those APIs. Inspectability is distinct from a
completed recovery path: `dismissOperation` refuses entries without a receipt,
despite the guide promising parked dismissal. The
[follow-up issue](../../../snapback3/issues/20260912-guide-gap-parked-operation-recovery.md)
records that mismatch. There is no automatic-compatibility pass.

**M7 D4 — completeness:** retain the actual observation: the separate installed
client returns fresh `messages.latest` data with `complete: false`, and the
builder's acquisition helper has explicit readiness logic. The guide-gap issue
records that burden. The report's claim that every client must independently
verify IDs is not established by these samples.

**M7 D5 — nonmember read:** the grader's
[API helper](m7-grader/grading/probes/api-bounds.mjs) discards `status` and
`error`, returns `ok: true` whenever `refresh()` resolves, and samples once.
Its `{ok:true, complete:false}` cannot establish the absence of an explicit
denial, much less “never completing.” The separate coordinator control retains
the actual public resource status and error: four refreshes are all `denied`,
fresh, `complete: false`, with error `NOT_MEMBER` at sequence 186. Reject the
reported absence of an explicit denial. The original write denial and no-data
result remain valid authorization observations.

**M7 D6 — settings visibility:** exclude from product defect counts. The
[browser probe](m7-grader/grading/probes/poll-browser.mjs) switches from the DM
back to the group, leaves settings closed, then waits for the hidden count.
Calling its existing `settingsCount()` helper opens the panel and obtains the
correct 10; the subsequent count is 11. Persisting the panel's open state across
conversation changes is not a selected requirement. Preserve the timeout as
a driver-precondition failure, alongside its later unrelated fatal use of
`window.clique.state` and the corrected offline-vote probe.

Use launcher timing (1,185 seconds), not the M7 report's self-entered end time,
for assessment duration. Original model output, failed attempts and collected
hashes remain unchanged; coordinator checks are separately labeled evidence.
