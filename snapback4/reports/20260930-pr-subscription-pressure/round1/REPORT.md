# PR round 1 — scope withdrawal under subscription pressure

Branch `sb4-intent/pr-subscription-pressure`. Merged `origin/main`
`f1b1f0077e` into round 0 `ab2da069c5` first, producing `c586a5904f`.
The merge had no conflicts. Regenerated `test/delivery-await-boundary.json`
through `awaitBoundary()`; it was unchanged. Nothing pushed or published.

## Review repairs

1. **Audience groups:** device reads now report private group dependencies from
   storage access, before projection removes audience keys. Row lookups record
   their actual audience; ranges and counts record evaluated, pinned audience
   dimensions. Scope events compare typed group values by position. Empty table
   sets do not match. A room 1 removal leaves room 2 histories, projections and
   counts displayed while all eight work slots are held. Compound-group matching
   distinguishes numeric `7` from text `"7"`.
2. **Staged removal:** every affected raw subscriber and facade follower receives
   withdrawal, even when `touched` is empty. The existing memory ticket/change
   fences retire pre-removal completions. A pending group cut prevents older
   replica or server answers from returning before actual replica publication.
   It also covers new mounts and one-shot queries, survives unmounting, and
   resumes parked watches when publication has an empty footprint. Both offline
   orderings—transport failing before or after the staged callback—deliver a
   transport refusal and recover after publication.
3. **Terminal change-feed refusal:** local wasm and process clients synchronously
   publish the refusal and fence old completions without waiting for capacity.
4. **Online revocation:** online notifications do not identify scope loss.
   Their change-evidence budget starts on receipt and includes queue wait.
   Local capacity queue wait still spends no withdrawal budget; plain
   revalidation remains unbounded. PQ's eight starts/eight active limits remain.
5. **Inspection:** diagnostic timings, history and per-watch callbacks begin only
   at the first `inspect`. A 1,000-observation control observes zero diagnostic
   clock calls/callbacks/answer-history records beforehand. Timing correctness
   still follows queue transitions. Already queued work is sampled from opt-in.
6. **Assertions:** apply plus throw, unavailable and retry exhaustion now await
   the failed attempt's following publication before inspecting its answer.
   Convergence timeouts require an actual in-flight history attempt. Mutation
   controls show the old assertion accepts a deliberately delayed stale reply
   in all four wasm/process cases and the new assertion rejects all four. A
   replay with `inFlight: false` likewise passes the old gap check and fails
   the new one. No stale-answer allowance was added.
7. **Causes/deadlines:** viewer changes record `viewer`; the closed-facade comment
   now states the existing behavior: final-identity deadlines may shorten and
   cannot extend, including subsequent queue pauses.
8. **Contract/docs:** public contract comments, the client guide, README,
   client reference and LLP 3000.023 describe these boundaries together.

A legacy device or a wholly server/composed answer lacks certified device group
provenance. Such answers conservatively retain table dependencies; empty table
sets still never match. This change does not add server dependency disclosures
or a public `Read` field. Certified local queries narrow precisely, including
body-only projections and counts. The staged integration fixture deliberately
returns successful `published: false`/empty-footprint acknowledgments while the
real wasm/process replica still contains the old rows; the continuation later
applies the real page. It controls SDK/device publication ordering, rather than
claiming that this seed naturally triggers the engine's deferred-page path.

## Verification

- Final focused affected run: **80 passed, 0 failed**, plus the additional
  new-mount pending-cut unit: **1 passed, 0 failed**. This includes all strengthened
  withdrawal cases, local/online per-row bounds, inspection, and the 14 initial
  round-1 regressions. The final regression file contains 15 tests.
- Round-0 negative controls: all 14 initial regressions fail on round-0 SDK
  bytes; the separate new-mount test also fails on its behavioral assertion.
  Current real devices are used to isolate the old SDK defect. The first version
  of that extra control used the new callback return directly; its compatibility
  error was corrected to optional delivery before recording the behavioral fail.
- Broader affected run: 876 tests, 874 passes and two old online queue assertions
  failed. Those expectations were corrected for the requested online boundary;
  all 18 per-row-inflight cases then passed, including in the final focused run.
- Rust device tests: **1,391 passed, 0 failed, 5 declared ignored** across 75 test
  summaries, including exhaustive paired worlds. No new ignore was introduced.
- Whole guide: **105 passed, 0 failed**. SDK build/typecheck and reference check
  passed (`525 LLP docs, 9979 refs, 0 errors, 0 unchecked`). The guide remains within its 130-line/1,200-word budget.
- Full suite: **passed, exit 0**, invoked **once** with
  `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash scripts/test.sh`.
  Exact summary: **`== 0 failure(s) in 1268 s`**. No failed step or test.
  The client pool passed **5,335 tests**, with **10 existing declared skips**
  ([names and prerequisites](SKIPS.md)); all **79 serial client model tests**
  passed. All **1,644 recorded input hashes** match before and after the suite.
  The 1,268-second elapsed time exceeds the repository's nominal 60-second
  budget; this inherited suite-duration issue was not changed or hidden by
  reducing model counts, adding skips, changing concurrency, or raising timeouts.
  [QUALIFICATION.json](QUALIFICATION.json) records the result.

All development failures and deliberately failing controls are listed by test
name in [FAILURES.md](FAILURES.md), with their retained logs. Introduced build,
fixture and assertion mistakes are classified as ours. The absent `python`
alias was environmental setup and was resolved with `python3`; no test was
skipped for it. The final full-suite outcome is not inferred from targeted runs. Logs and large
raw traces are stored as `.gz`; their uncompressed run names appear in the
failure ledger. `ARTIFACTS.json` records the retained files' hashes and sizes.

## Convergence

The unchanged two-device harness uses 124 observations per device and real wasm
in Chromium or process devices feeding Chromium React roots. Both normal tier
runs converge to **42 unique messages on each of four histories**, with zero
history gaps/withdrawals and peak **116 queued / 8 active**. The forced 1,100 ms
active-attempt runs also converge to 42 unique messages per history, with one
legitimate timeout/gap per history, each `queued: false, inFlight: true`.
All raw publication/render/pressure traces are retained. Inspection's bounded
rings remain 64 withdrawal records and 256 completed timing samples.

## LL measurements

The unchanged LL harness runs 20 repetitions of eight flows per cell, on four
CPU-affinity cores, with `LL_KEEP=viewed` and either zero or three load workers.
Round-0 and round-1 SDK/device artifacts were alternated in the first eight
cells, then restored. After adding the new-mount cut fence, four final cells
measure the final SDK again. The same instrumented LL server binary serves all
cells; the process device and wasm artifact change with the SDK. Input hashes
are in `LL-INPUTS.json` and `LL-FINAL-INPUTS.json`.

Other lanes were running suites on this shared 96-CPU host. Zero load workers
means no harness load workers, not an idle machine. Raw host load averages are
recorded per cell. The final cells are subsequent measurements rather than
adjacent baseline/after pairs; timing differences cannot establish a causal
speedup or regression. No harness delays, deadlines, work limits or flow shapes
were changed. All 1,920 trials across the 12 cells completed without timeout. The maximum
per-flow publication p95 for round 0 → final round 1 was:

| Tier / load workers | Round 0 | Final round 1 |
|---|---:|---:|
| Wasm / 0 | 45.535 ms | 47.257 ms |
| Wasm / 3 | 80.605 ms | 92.070 ms |
| Process / 0 | 79.111 ms | 81.163 ms |
| Process / 3 | 399.202 ms | 195.408 ms |

[LL-TABLES.md](LL-TABLES.md) gives all eight flows, publication and React p95,
server-query and asset-home counts, plus the initial paired matrix. Asset-home
medians are unchanged in every flow/cell. Server-query medians stay at zero for
profile/reactions/feed and five or six for the remaining flows; no new read
loop appears in this harness.

## Wasm ratchet

Round 0: **1,978,828 raw / 593,225 gzip bytes**. Round 1:
**1,983,105 raw / 595,440 gzip bytes**: +4,277 raw / +2,215 gzip.
The existing cap was 593,719 bytes; the new cap is exactly **595,440 bytes**,
a necessary **1,721-byte** ratchet increase with no headroom. The added bytes
carry pre-projection audience dependencies from the real interpreter to the
SDK. Inferring groups from arbitrary arguments or shaped answers would be
incorrect for computed keys, projections and counts. The measured reason is
recorded in `metrics/wasm-budget.json` in this same commit.

`local.ts` remains at the 1,500-line cap. No queue limit, interpreter semantics,
public read vocabulary, prediction, outbox or publication protocol was changed.
