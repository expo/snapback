# LL round 0 — live propagation

Date: 2026-09-29. Branch: `sb4-intent/ll-live-latency`.
Source baseline: `a5e690077a4474eebc0f9dfeb26f7fc1e60d792f`.

Two avoidable costs were measured and removed: evaluating a replica already
known to be behind the notified commit, and rechecking every retained media
home after unrelated writes. No change-feed dependency omission was reproduced.
The new causal tests protect child, parent, joined-profile and authorization
dependencies, including unknown notification footprints.

With the builder's viewed-media configuration, all eight flows' final
commit-to-published-answer p95 values are below 84 ms idle and 119 ms under
contention, on both tested devices. The photo **row** meets the 300 ms target;
its bytes have a separate transfer, retention and decode path. This does not
establish the cause of calibration #26's multi-second UI timings.

## Measurement and provenance

All baseline runs preceded product edits. `tools/measure.mjs` drives two
independent password sessions against one disposable local debug server using
the public SDK. Wasm devices run in separate Chromium contexts. The process
receiver runs the same React tree in Chromium with calls bridged to the public
`processDevice` adapter in Node; the process sender's `createLocalClient` runs
in Node to preserve synchronous journal custody. The bridge adds overhead,
especially for uploading an array of image bytes. It is not an Expo/native
transport benchmark. The harness uses `createLocalClient` directly with React;
the builder's `createApp` facade and screen routing are not reproduced. There
are no app polling loops or forced receiver syncs
after actions, and no retry/best-of-three selection.

The reduced Quarry/React fixture follows the supplied builder's shapes:
20 mounted history rows, separate per-message read-through reactions, receipts,
quoted-message point reads, history pages, ordinary and once photos, a public
feed and profile control. History and receipts exercise server fallback when
local coverage is unavailable. It is not the full Expo tree. Membership rules,
read-through authorization, retention and once consumption remain enabled.
Images are random 256×256 PNGs, about 226 KB; retention is `keep: 'viewed'`,
64 MiB as in the supplied `src/client.ts`. Across 20 repetitions the cache grows
to 40 ordinary assets; once photos are consumed, not retained. The quote's
excerpt is timed separately and its anchor link is clicked and verified.

Host: Linux AMD EPYC 9454, 96 available CPUs; Node 24.13.1, Chromium
151.0.7922.34. Loaded runs inherit `taskset -c 0-3` and three owned busy CPU
workers across server, devices and browser. This is contention, not an M1 Max
model. No lane-LL builds or tests overlapped measurements; this shared host also runs
other lanes, reflected in the recorded load. Affinity-only baseline runs
were faster in some cases, so they are preserved as controls rather than
called a loaded-laptop reproduction. Each raw file records its host load.

Baseline CLI and SDK were built in this branch. Baseline wasm was copied from
the existing sibling `lane-ea` artifact (2,040,531 B raw / 592,979 B gzip),
before product edits; its exact source binding was not independently qualified.
Treat wasm before/after attribution with that limitation. The process baseline
was locally rebuilt, and final wasm was rebuilt from this branch. This is a
development measurement, not an installed-package or publication qualification.

There are 20 trials **per flow per configuration**: ten baseline configurations
(1,600 actions, including no-retention and affinity-only controls) and four final
viewed-media configurations (640 actions). All 2,240 completed without timeout.
Percentiles use nearest rank: p95 is the 19th of 20, with maxima retained in JSON.
Small samples characterize this fixture; they cannot promise a production SLA.

### Timestamp boundaries

`tools/instrument-server.py` adds a temporary stamp immediately after SQLite
mutation `commit()`, before the outcome/HTTP wake is returned. It restores
source and copies a measurement-only CLI; no telemetry hook ships. All stamps
use UNIX milliseconds on one host (`SystemTime` on the server,
`performance.timeOrigin + performance.now()` in JS). Browser clock precision
and probe overhead limit sub-millisecond interpretation.

| Stage | Recorded event |
|---|---|
| Sender call | Start of `perform`, before image construction/upload where applicable; mutation return and `sent` also recorded |
| Server commit | Post-SQLite-commit stamp, keyed by operation and sequence |
| Receiver `/changes` wake | Response body EOF, with sequence and touched tables; request and headers also recorded |
| Sync | Request, headers and response-body EOF for `/sync` |
| Device apply | Public device adapter call start/end, with page watermark and touched tables |
| Evaluation | Relevant device query completion or whole server `/q` response at the commit cut |
| Publication | First matching, non-revalidating public `observe` snapshot |
| React commit | `useLayoutEffect` sees the matching hook answer |
| Media | Upload start/end/byte count; receiving asset request/headers, usable handle, image `onLoad` |
| Quote | Excerpt visible in React; jump target subsequently verified |

The `apply` interval is the device call, excluding SDK media reconciliation
afterward. Evaluation intervals are not CPU profiles. A whole server answer
can qualify before apply; stages overlap and signed intervals can be negative.
Do not sum percentiles. The query/asset-work totals cover each recorded trial
through readiness, so they include concurrent watches and follow-up work.

Raw traces are losslessly compressed as `baseline*.json.gz` and
`final*.json.gz`; paired `*-summary.json` files retain every stage's n/p50/p95/max.
[STAGES.md](./STAGES.md) tabulates **all** configurations, stages, media timings
and work counts. [tools/README.md](./tools/README.md) gives exact rerun commands.

## Results

Each cell below is commit-to-published-answer **p50 / p95 ms**. No timeouts
were excluded. The profile is a control, not a promise that every query shape
does equal work. Receipts remain mounted throughout; the requested flow list
does not include a separate receipt mutation measurement.

### Idle

| Flow | Wasm before | Wasm after | Process before | Process after |
|---|---:|---:|---:|---:|
| profile | 22.7 / 31.9 | 21.1 / 25.0 | 65.2 / 109.2 | 36.6 / 45.4 |
| reaction-add | 28.0 / 32.4 | 21.4 / 25.9 | 104.7 / 141.6 | 35.6 / 45.0 |
| reaction-replace | 28.1 / 33.0 | 21.5 / 25.7 | 91.4 / 138.8 | 34.3 / 36.9 |
| reaction-remove | 27.0 / 33.5 | 22.1 / 23.7 | 89.4 / 137.7 | 28.8 / 33.0 |
| reply | 61.4 / 83.8 | 53.3 / 57.3 | 88.0 / 95.5 | 67.6 / 72.8 |
| photo | 62.2 / 66.2 | 54.2 / 66.2 | 95.4 / 106.9 | 67.8 / 77.7 |
| feed-image | 31.4 / 39.7 | 27.3 / 35.5 | 80.7 / 119.5 | 54.7 / 76.0 |
| once-photo | 61.2 / 67.7 | 52.5 / 60.8 | 93.5 / 104.3 | 66.6 / 83.2 |

### Four CPUs + three busy workers

| Flow | Wasm before | Wasm after | Process before | Process after |
|---|---:|---:|---:|---:|
| profile | 27.3 / 35.1 | 22.6 / 33.7 | 66.9 / 87.4 | 41.0 / 60.6 |
| reaction-add | 31.7 / 43.2 | 28.4 / 36.1 | 138.7 / 163.5 | 44.3 / 47.5 |
| reaction-replace | 28.8 / 36.8 | 23.1 / 37.7 | 124.7 / 173.6 | 41.7 / 49.8 |
| reaction-remove | 30.0 / 34.9 | 24.5 / 31.2 | 105.5 / 164.6 | 39.5 / 47.2 |
| reply | 59.5 / 78.1 | 57.5 / 65.7 | 135.7 / 163.0 | 89.4 / 111.2 |
| photo | 64.0 / 77.7 | 58.8 / 64.1 | 136.9 / 171.1 | 88.0 / 111.1 |
| feed-image | 33.4 / 41.1 | 34.2 / 42.9 | 72.5 / 98.9 | 60.6 / 74.9 |
| once-photo | 62.4 / 77.5 | 57.2 / 65.9 | 149.9 / 190.4 | 95.5 / 118.8 |


Final media and quoted-excerpt measurements are below. Upload precedes the
server commit and is separate; the process bridge's image serialization costs
roughly 0.7–0.8 seconds before commit, while wasm uploads take roughly 8–12 ms.
That harness overhead cannot be attributed to receiver propagation.

| Ready event, p50 / p95 ms after commit | Wasm idle | Process idle | Wasm loaded | Process loaded |
|---|---:|---:|---:|---:|
| photo | 126.1 / 147.0 | 315.2 / 421.3 | 129.9 / 155.1 | 283.3 / 362.8 |
| feed-image | 103.2 / 128.0 | 252.2 / 371.5 | 92.4 / 107.1 | 196.2 / 263.0 |
| once-photo | 79.7 / 88.0 | 143.2 / 236.1 | 87.6 / 102.8 | 210.4 / 271.5 |
| reply excerpt | 55.8 / 59.7 | 70.0 / 76.2 | 59.1 / 67.2 | 91.0 / 115.5 |

## Findings and changes

1. **An obsolete replica was evaluated repeatedly.** `/changes` already marks
   the pending cut, and existing fences correctly reject old results. Before
   the change, an idle wasm reaction-add triggered 20 pre-apply device queries
   and 40 queries total at p50. The process device showed 26 pre-apply and 63
   total; its p95 apply-to-evaluation interval was 102.8 ms. No timer could make
   these old rows qualify. An acquired watch whose last accepted answer was
   local now starts the same retention episode, releases its queue slot and
   waits for sync publication. Applying that cut resumes it even if an unknown
   notification resolves to a disjoint table footprint. Final pre-apply reaction
   queries are zero on both devices; process apply-to-evaluation p95 is 13.9 ms.
   Whole server answers may still run and qualify immediately. No new positive
   delay, poll, read contract or ordering domain was added.

2. **Retained assets amplified unrelated writes.** Before the change, run 19
   rechecked 38 media homes on a profile or reaction write. Those checks cross
   the process bridge serially. The authorized device `asset_home` result now
   includes the interpreter's complete read-table set, including rule tables.
   Known disjoint apply/admit/settle footprints skip only unexpired, confirmed
   homes with valid dependencies. Final unrelated writes perform zero home
   checks. Unknown/legacy/malformed dependencies, expiry, scope changes,
   adoption and reset still perform full checks. The incoming footprint is
   copied before entering the serial cache queue.

3. **No missed child dependency was found in this fixture.** Both server
   footprints and observation dependencies woke correctly for reactions.
   The regression now uses the real post-seed `/changes` footprint and freezes
   elapsed timers. Child add/replace/remove, parent edits, joined profiles and
   membership loss must all re-evaluate after apply. A separate unknown-table
   case ensures a parked disjoint watch resumes. It cannot rely on a sampling
   or retry timer: only zero-delay queue turns and I/O run. Named expiry cases
   alone advance 1,000 ms to prove the retention bound is preserved.

4. **Healthy change delivery did not show a fixed pacing delay.** Idle reaction
   commit-to-`/changes` p95 was about 3–4 ms. `/changes` silence detection
   (4 seconds), transport recovery (1 second), eight-at-a-time queue fairness,
   expiry recovery and overload pacing serve existing failure/capacity
   contracts; none was removed. The ordinary local pending-cut case no longer
   enters futile reads or their exponential retry path. Its continuation is
   causally tied to apply. The sync request still performs identity/state work.

5. **Coverage and media authority still cost work.** History/receipt reads in
   this subject sometimes require whole server answers; retained composition
   may evaluate more than once. Raw traces expose every `/q` round trip. This
   lane does not bypass completeness or convert unknown coverage into a local
   answer. Media-bearing or authorization-table changes still recheck affected
   homes serially. `read()` and newly viewed downloads keep their full cache
   checks, and the byte/manifest writes remain durable. The final late photo
   trial has 97 home reads versus 116 (wasm) / 125 (process) before, rather than
   zero. The process bridge and these checks explain much of its remaining
   asset-ready cost; the data row already meets the target. More selective
   row-level authorization tracking or batched device checks would require
   separate authority/expiry design and evidence, not removal of these checks.

The code changes are in `local.ts`, `local-reads.ts`, `local-assets.ts` and
device `media.rs`. `changes.ts`, the interpreter's dependency calculation,
`read-observation.ts` and `read-work.ts` contracts are preserved. LLP 3000.023
§10 records the scheduling decision; LLP 3000.019 §3.5 records media dependency
invalidation. The `reads` card records measured scope and how to instrument a
builder's app; stale opt-in-only retention prose was reconciled with §10. It is
236 lines (previously 237); the `client` card stays at its 130-line cap. The
existing fact inventory was updated to track that current retention explanation.

## Calibration #26 and limits

The supplied `choreo-live-timings.txt` (preserved as `CALIBRATION-TIMINGS.txt`),
raw choreography records and builder
source were treated as data; `INPUT-SHA256.txt` fingerprints the timing and
source inputs. They do not carry server-commit/apply timestamps.
The profile's 113.8 ms success follows two 10-second visibility failures.
Several feed attempts fail before a backend write (missing fixture paths or
composer attachment state). Quoted-reply `waitMs` also includes UI selection
and jump actions; it is not an isolated commit-to-answer interval. These facts
prevent treating the fastest profile sample as a load-controlled proof of
backend inconsistency or the multi-second waits as a proven polling interval.

The supplied `src/Chats.tsx:311–330` retries a missing jump target every 400 ms,
loading history and receipt pages until a 30-second deadline. That is a concrete
application pacing source, separate from propagation; its contribution to the
recorded delays is unmeasured. At lines 504–515 the builder also mounts per-row
author and point reads and pages reaction lists. This reduced fixture shares
one profile control, mounts quote points only for replies, and measures one
reaction page with `useQuery`. At lines 527–536 the app reads reaction state
before submitting with `waitSeconds: 0`; our reaction flow directly submits the
chosen state and measures the actual server commit. These differences matter
for UI/action timings even though the child dependency and receiving history
paths are exercised.

The realistic query shapes expose avoidable work, but the original M1/0.4.8
application stalls remain **unreproduced**, not proven fixed. This lane did not
run the full builder app, a video transfer, an installed npm release, background
browser throttling, a network-latency matrix or a mobile host. The report tools
are retained so the same stage probes can be applied in those environments.

## Verification

- New regressions: 32/32 passed (`regressions-final.log`), including process and
  wasm causality, unknown cuts, all keep modes, expiry, media dependencies,
  footprint ownership and actual membership-loss URL revocation.
- Strengthened real-feed causal check: 22/22 passed (`causal-final.log`). This
  removes the synthetic footprint from the earlier test setup.
- Affected existing and new tests: **473 passed, 0 failed**, 138,872.181425 ms
  (`affected-final.log`). This run preceded the real-footprint strengthening;
  the 22 affected tests were rerun afterward as above.
- Negative controls: missing child dependency, missing disjoint resumption and
  missing media authorization dependency each fail by assertion, status 1,
  no termination (`negative-controls.json` and individual logs). Mutations were
  applied only to built test artifacts and restored before final measurements.
- Whole guide: **99 passed; 0 failed**, 2.50 s (`guide-final.log.gz`). SDK typecheck
  and builds pass. `ref-check`: **524 LLP docs, 9932 refs in 29675 files,
  0 errors, 0 unchecked** initially; final `ref-check-final.log` covers
  29,689 files with the same zero-error verdict.
- Full suite: **`== 1 failure(s) in 1555 s`**, exit 1, exactly one
  `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash scripts/test.sh`
  invocation (`full-suite.log.gz`, `full-suite.exit`). The failing stage is
  `client tests`: 5,214 passes, 1 failure, 2 timeout cancellations, 10 existing
  skips. All three affected cases are ours and named in the ledger. The serial
  model stage passed all 79 tests, including both 5,000-sequence session
  models. No baseline or environmental test failure was identified.
  Rust: 4,323 passed / 0 failed / 33 declared ignores across 987 execution
  summaries; workspace doctests passed. Both app typechecks and 9 fixture tests
  passed. The script uses its standard 24-client-file pool, without an override.
- Post-suite validation: **797 passed, 0 failed, 0 cancelled, 0 skipped**,
  426,113.587482 ms (`affected-post-suite.log`). Both 300-history schedules
  report `failedSeeds: 0` (process 201,850.585903 ms; wasm 166,426.280892 ms).
  Final SDK typecheck and build also pass.
  This includes the unchanged 300-history count for each mixed-evidence host,
  the entire 160-site delivery fault matrix, and the affected retention, queue,
  read-through and asset tests. The final source-budget extraction moves the
  synchronous pending-cut policy into `LocalReads.deferUntilSync`; `local.ts`
  stays at 1,500 lines. Measurements and the full suite preceded that
  behavior-preserving extraction; the post-suite build and tests cover it.
- Final wasm: **2,040,727 B raw; 592,959 B gzip**, unchanged cap **593,719 B**,
  **760 B headroom** (`wasm.log`; `build-wasm.sh` uses `gzip -9 -c`). No budget
  increase or public `contract.ts` change.

### Failure accounting

The complete [failure ledger](./FAILURES.md) names every full-suite failure
(the delivery await census and both mixed-evidence schedule timeouts), every
initial affected-test failure, and the two initial guide failures. All were **ours**, corrected for
the final targeted runs; the new regression teardown issue was also ours.
Intentional negative-control failures are evidence, not unresolved failures.

The 60-second suite budget is already exceeded by the inherited suite: this
checkout records prior Linux passes at 1,232 and 1,253 seconds in JOURNAL.md.
The exact current duration and any full-suite test failures are recorded above
and in the ledger. No tests or checks were newly skipped to meet that budget.

No push or publication is part of this lane. The commit carries the requested
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>` trailer.
