# PR round 3 — conservative detached reuse and bounded overtaking

Merged `origin/main` **42ba3ffb90** first into round 2 **1a602df58d**, producing
**b30a06da77** on `sb4-intent/pr-subscription-pressure`. Kept both journal histories,
both guide contributions, and main's SDK/server changes. Delivery await metadata
merged automatically and was then regenerated through `awaitBoundary()` for the
new read-only watermark await. Nothing pushed or published.

Read rounds 0–2's prompts/reports and Astra's full round-2 NOT READY review.
Astra's inherited `/changes` defect reproduces on the round-2 control both with
and without any continuously mounted owner. The review also established it on
main; this round does not claim a new independent main reproduction.

## Repairs

1. One client evidence epoch advances for local commits, accepted `/changes`,
   sync publication, scope cuts, refusals and resets, including events with no
   live owner. Detach records that epoch. A changed epoch discards the saved
   answer and saved cut/waiting state before exposure or resubscription. The
   getter creates no parked detached state. Removed the answerRevision field,
   its publication bookkeeping and the per-case revision/incarnation/scope
   restoration branches from round 2. Terminal refusals remain immediate.
2. A resumed detached owner inherits the existing notified sequence. Its first resumed
   attempt reads the actual replica watermark, reconciles the cut, and consumes
   the detach marker before evaluation/parking. Mounted observations add no
   metadata read for ordinary changes. This costs a metadata read instead of another mirrored
   publication watermark or historical-evidence registry. An old replica cannot
   recertify a missed notification, and a getter during staging cannot strand
   delivered history after publication. Fresh mounts keep their existing path.
3. Urgent work can overtake ordinary FIFO work at most eight starts in a row.
   One counter survives queue turns; no new queue, age record or timer. With N
   ordinary predecessors, a waiting ordinary read starts within 9 × (N + 1)
   freed starts under continuing urgent arrivals. Five ordinary reads started
   at **1, 10, 19, 28, 37** while all eight hot reads kept receiving evidence.
   Eight starts/turn and eight active attempts remain unchanged.
4. Scope composition uses a null-prototype dictionary and scope lookup requires
   an own key. The same audit repaired mock ephemeral table copies/drafts and
   IndexedDB page-tail dictionaries. Acquisition counters were already null
   dictionaries; inspection/ephemeral/table sets use Map/Set; delivery groups
   use JSON-encoded tuple keys rather than raw table/group names. Server/device
   scope metadata is decoded JSON with own keys, and Rust maps have no prototype.
   Actual retained/server composition accepts **constructor, __proto__, toString
   and hasOwnProperty** on both devices. Missing reserved keys do not match.

No existing assertion, timeout, concurrency limit or skip was weakened.
The earlier audience preservation, closed-facade deadlines, option comments,
terminal refusals, online queue-inclusive revocation budget and opt-in inspection
remain. The conservative cost is that even unrelated evidence invalidates a
saved detached answer. An authorized online sibling can still withdraw if all
slots stay occupied for its entire bound; fairness adds no preemption.

## Verification

- **21/21 core regressions fail on round 2**; all pass fixed, plus four new mock
  name cases (round 2 fails __proto__). The stale-notification test holds sync
  for 1.25 seconds and rejects every stale callback before checking eventual
  authorized publication. Staged cases cover both retention policies.
- Broad affected run: **270 passed**, including pressure, per-row work/liveness,
  deadlines, facade lifecycle and existing mock checks. Subsequent name and
  delivery fault/boundary checks: **337 passed**, including the four new mock
  name cases. The overlap is not counted as independent tests.
- Whole guide: **106 passed**. Client card **114 lines / 1,196 words**, within
  both merged budgets. SDK build/typecheck and ref-check pass: **525 LLP docs,
  10,013 refs, zero errors or unchecked references**.
- **Full suite: exit 0**, invoked once with the package SQLite policy. Exact
  summary: **`== 0 failure(s) in 1261 s`**. Rust **4,368 passed / 33 existing
  ignores**; client pool **5,417 passed / 10 existing skips**; fixture wrappers
  **9 passed**; serial models **79 passed**, at unchanged full counts. Full-run
  failures: **ours 0, baseline 0, environmental 0**. All **1,659 recorded inputs
  remained unchanged** during the run (`FULL-CONSISTENCY.json`). The inherited
  nominal 60-second budget remains exceeded.
- The full run precedes the final detached-only watermark optimization. Only
  `local.ts` changed among those captured inputs afterward; `AFTER-FULL-DELTA.json`
  and `FULL-PRODUCT.patch.gz` preserve the boundary. Final affected checks cover
  that delta: **527 passed**, including RL retention/withdrawal, React, PQ
  liveness, raw/facade lifecycle and all pressure regressions; final delivery
  fault/boundary checks **321 passed**. No second full run is claimed.

All failed development checks and intentional controls are classified in
[FAILURES.md](FAILURES.md). Source inputs are captured in `FULL-INPUTS.json` and
`FINAL-INPUTS.json`; compressed raw logs/traces and `ARTIFACTS.json` are retained.

## Convergence and cost

Unchanged Chromium/real-device harness: two devices, 124 observations each.
Wasm and process normal runs deliver **42 unique messages per history**, zero
history withdrawals/gaps, peak **116 queued / eight active**. Forced 1,100-ms
attempt holds also converge exactly once; all four withdrawals have
`queued: false, inFlight: true`. Every original gap and duplicate assertion
remains. Raw publications, renders and pressure samples are retained.

LL's unchanged viewed-media harness completed **640 actions without timeout**.
Historical round-2 → round-3 maximum per-flow publication p95, milliseconds:
wasm zero/three load workers **49.887/93.894 → 65.596/94.052**;
process **73.857/187.869 → 102.222/324.631**. This is a shared-host, cross-merge
comparison; it does not isolate the SDK's causal cost. The loaded-process
increase is preserved, and an isolated alternating round-2/current SDK comparison measures
**173.673/204.450/193.992/244.176 ms**, with another **640
actions and zero timeouts**. Both current samples were slower, exposing an unnecessary watermark read
on already-mounted observations. The final code restricts it to detached
resumption. Its additional **640 actions have zero timeouts**, at maximum flow
p95 **70.583/93.483 ms wasm** and **127.581/179.059 ms process** for zero/three
workers. A preceding detached-only process/three-worker check adds another
160 successful actions at 188.642 ms. All **2,080 actions** in this round complete
without timeout. Final SDK/device bytes match the isolated measured candidate
(`FINAL-LL-CONSISTENCY.json`). The higher historical sample is not discarded.
[LL-TABLES.md](LL-TABLES.md) reports every flow's latency and query/home counts.

Wasm: **1,983,105 bytes raw / 595,440 gzip**, exactly the unchanged **595,440**
ratchet. No Rust or wasm-source change, no budget increase. `local.ts` remains
at **1,500 lines**. LLP 3000.023 §10 records the evidence-epoch and fairness rules;
the client guide/reference explain the resulting behavior.
