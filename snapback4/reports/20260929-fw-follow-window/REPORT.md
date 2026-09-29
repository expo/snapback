# FW round 0 — the reader’s own Following publication window

Baseline: `6a2eaebf414599670d84d01c9302f5dc051ddb30`, branch `sb4-intent/fw-follow-window`. Measurement date: 2026-09-29 UTC; completion crossed midnight in Europe/Berlin. Nothing is pushed or published.

## Finding and change

**The original device-client answer sequence was misleading.** All 160 baseline transitions (80 follows, 80 unfollows) republished at least one complete, fresh, unmarked answer containing the old feed. There were 313 such publications. A follow could say “No posts” both while queued and after its receipt was saved, before sync published its edge and copies. A flag-aware React screen actually rendered that absence. A separate pending-write panel did not solve the settlement gap: its queue was already empty.

The SDK now qualifies the existing read state with the reader’s own edge intent. At the call it invalidates affected observations and marks the previous answer revalidating (or loading with `keep: false`). At data publication it checks the existing outbox through observation, including sent-but-unobserved writes, and says `complete: false`. An in-memory marker covers pre-admission and the unsettled call; it does not own durable writes. Sync publication wakes reads qualified by that condition even when an idempotent follow has no changed-row footprint. Refusal restores the real current answer. The 160 fixed transitions emitted **zero misleading publications**, with zero timeouts in either arm.

No query/mutation contract or Rust device wire changed. Source horizons, private inbox acquisition, authorization, epoch filtering, server-side immediate 50-event copy and the 1,000-event history window are unchanged. Follow/unfollow still do not predict. Completion of a follow receipt alone does not mean its copied events are visible. A query that references the same edge source conservatively shares the incomplete state even when a branch only reads it; disjoint queries retain completeness.

## What the screen shows

For a successful follow: `No posts` before the call → `Updating…` from the call turn → Alice’s three originals plus her independent repost. During the update, a retained empty answer has `revalidating: true`; re-evaluations may contain the same empty data with `complete: false`. `fresh` can be true or false independently, and later revalidation notifications may repeat. All intermediate answers are honest. For unfollow: Alice’s events → `Updating…` → `No posts` after observing the edge. A refusal can correctly return to the prior complete answer. Larger backfill/cleanup can keep a populated page incomplete.

The harness screen evaluates denial first, then `loading || revalidating || !complete` for “Updating…”, before `data.length === 0` for “No posts”. It renders a list only otherwise. Applications may instead retain rows with an “Updating…” indicator; they must not interpret incomplete emptiness as absence. The guide gives this recipe without growing its **401-line** budget.

A read has no top-level `pending` flag. Every answer’s full row JSON is retained; there are no predicted feed rows in this workload (zero pending rows). The trace separately records every pending-write notification and its asynchronous `pendingWrites()` result: queued/sent intent with an empty predicted footprint, then an empty queue after settlement. Those samples are not atomically bundled with query answers.

Example, wasm idle trial 0 (milliseconds from follow call):

| Arm | SDK publication | Data / flags | Actual React commit | Render |
|---|---:|---|---:|---|
| Baseline | 8.30 | 0 rows; complete, fresh; no revalidation | 8.60 | No posts |
| Baseline | 23.00 | 0 rows; complete, fresh; no revalidation | 23.20 | No posts |
| Baseline | 39.20 | 4 rows; complete, fresh | 39.40 | Alice’s events |
| Fixed | 0.40 | 0 rows; complete, fresh, revalidating | 2.00 | Updating… |
| Fixed | 12.10 | 0 rows; incomplete, fresh | 12.40 | Updating… |
| Fixed | 31.00 | 0 rows; incomplete, stale | 31.10 | Updating… |
| Fixed | 50.30 | 4 rows; complete, fresh | 50.50 | Alice’s events |

These are representative sequences, not selected latency percentiles. Every duplicate publication, every rendered commit and every intermediate flag is in the raw files and `summary.json`. React may coalesce SDK publications; the two sequences are recorded separately.

## Measurement

Uses lane LL’s two-client harness structure, post-transaction server instrumenter, two separate password accounts and Chromium contexts. Alice creates three originals and reposts one before Bob mounts `cards`. Each arm runs 20 follow/unfollow pairs per condition. All times are on the same host, using UNIX milliseconds; the server timestamp is immediately after SQLite commit. Timings include debug-server execution and instrumentation. AMD EPYC 9454 (96 logical CPUs), Chromium 151.0.7922.34, Node 24.13.1, Rust 1.97.0, wasm-bindgen 0.2.127, Binaryen 132.0.0.

Wasm executes the local SDK, real wasm interpreter, IndexedDB and React in the browser. Process executes two real Node local clients over SQLite process devices; Bob’s published snapshots cross an ordered Playwright bridge to React. Process render timing includes this bridge, and is not a claim about an Expo/native UI.

The process timings were repeated after the full suite: the first tracer mixed Alice’s device events with Bob’s, making the apply-stage attribution ambiguous. The corrected trace records Bob only. Those earlier raw runs are retained under `superseded-process/` and excluded from every table here. The corrected process baseline uses the SDK extracted and compiled from the starting commit; baseline and fixed arms use the same post-suite process-device binary and instrumented server. The first process runs used the earlier standalone binary build, so no before/repeat speed inference is valid. Wasm traces were already separated by browser context and required no repeat.

Idle means no harness load, with all 96 permitted CPUs. Contention pins the server, browser, clients and three busy-loop workers to CPUs 0–3. No lane compiler/test runs overlap these measurements. The shared host was not globally idle: wasm load-1 was 20.58–21.75 before and 12.55–15.14 after; corrected process runs were 50.36–50.73 before and 50.76–51.10 after. This limits speed comparisons; no latency improvement is claimed. The fix adds outbox checks and publications, and idle time to a complete answer is modestly higher.

Each cell below is **p50 / p95 milliseconds**, nearest-rank, N=20 per operation and condition. No timeouts or missing stage stamps were excluded. “Apply” is the first device apply at or beyond the mutation’s sequence; “changed answer” is the first published answer with the new cardinality; “complete” also requires no revalidation. The four-event fixture fits the immediate copy. Some fixed trials publish the changed rows while still incomplete; the separate changed-to-complete stage captures this interval. This does not measure 1,000-event backfill, cold acquisition, adoption, many follows, packet loss or WAN transport.

| Operation / condition | Baseline complete answer | Fixed complete answer | Baseline misleading publications | Fixed misleading publications |
|---|---:|---:|---:|---:|
| follow / wasm-idle | 39.00 / 42.70 | 43.70 / 46.50 | 38 | 0 |
| follow / process-idle | 21.33 / 24.24 | 23.01 / 24.87 | 40 | 0 |
| follow / wasm-loaded | 43.80 / 55.70 | 44.10 / 52.20 | 37 | 0 |
| follow / process-loaded | 37.25 / 43.71 | 39.12 / 45.04 | 40 | 0 |
| unfollow / wasm-idle | 39.40 / 44.30 | 43.60 / 47.50 | 40 | 0 |
| unfollow / process-idle | 21.16 / 24.06 | 23.14 / 27.88 | 40 | 0 |
| unfollow / wasm-loaded | 42.40 / 49.40 | 41.70 / 49.90 | 38 | 0 |
| unfollow / process-loaded | 38.33 / 48.18 | 40.12 / 54.37 | 40 | 0 |

### Baseline follow: every stage

| Stage | wasm idle | process idle | wasm contention | process contention |
|---|---:|---:|---:|---:|
| Call → first updating mark | 2.60 / 3.00 | 0.82 / 1.13 | 2.00 / 4.10 | 0.91 / 1.64 |
| Call → durable admission | 2.60 / 3.00 | 0.79 / 1.02 | 2.00 / 4.10 | 0.89 / 1.62 |
| Admission → server commit | 8.49 / 11.20 | 6.62 / 7.69 | 7.26 / 12.50 | 7.90 / 13.82 |
| Call → server commit | 11.09 / 13.44 | 7.53 / 8.60 | 9.48 / 14.70 | 9.10 / 14.60 |
| Server commit → device settlement | 6.36 / 7.82 | 1.88 / 3.62 | 7.34 / 16.06 | 4.71 / 8.52 |
| Device settlement → apply | 15.80 / 17.70 | 8.59 / 10.55 | 19.60 / 25.40 | 16.46 / 20.42 |
| Apply → first changed answer | 5.10 / 6.10 | 3.36 / 4.08 | 4.30 / 7.60 | 5.14 / 7.74 |
| Call → first changed answer | 39.00 / 42.70 | 21.33 / 24.24 | 43.80 / 55.70 | 37.25 / 43.71 |
| First changed answer → complete | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 / 0.00 |
| Call → complete answer | 39.00 / 42.70 | 21.33 / 24.24 | 43.80 / 55.70 | 37.25 / 43.71 |
| Complete answer → React commit | 0.20 / 0.30 | 0.82 / 1.03 | 0.20 / 0.50 | 1.31 / 2.16 |
| Call → React commit | 39.30 / 42.90 | 22.23 / 25.27 | 44.50 / 55.70 | 38.30 / 44.88 |
| Call → mutate return | 36.60 / 41.10 | 20.00 / 22.96 | 42.20 / 54.70 | 34.66 / 41.24 |
| Old unmarked answer duration (see note) | 22.30 / 25.00 | 15.07 / 17.51 | 29.40 / 39.20 | 20.80 / 25.90 |

### Baseline unfollow: every stage

| Stage | wasm idle | process idle | wasm contention | process contention |
|---|---:|---:|---:|---:|
| Call → first updating mark | 2.70 / 3.10 | 0.84 / 0.98 | 2.10 / 4.60 | 0.99 / 1.18 |
| Call → durable admission | 2.70 / 3.10 | 0.82 / 0.96 | 2.10 / 4.60 | 0.97 / 1.16 |
| Admission → server commit | 8.77 / 10.15 | 6.51 / 7.87 | 7.91 / 10.91 | 8.65 / 10.24 |
| Call → server commit | 11.45 / 12.84 | 7.28 / 8.72 | 10.04 / 13.73 | 9.55 / 11.00 |
| Server commit → device settlement | 6.43 / 7.46 | 1.80 / 3.37 | 7.39 / 16.66 | 5.14 / 9.63 |
| Device settlement → apply | 16.40 / 20.30 | 9.21 / 10.92 | 20.20 / 27.10 | 17.34 / 27.75 |
| Apply → first changed answer | 3.90 / 4.90 | 3.14 / 4.43 | 3.20 / 6.30 | 4.91 / 6.52 |
| Call → first changed answer | 39.40 / 44.30 | 21.16 / 24.06 | 42.40 / 49.40 | 38.33 / 48.18 |
| First changed answer → complete | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 / 0.00 |
| Call → complete answer | 39.40 / 44.30 | 21.16 / 24.06 | 42.40 / 49.40 | 38.33 / 48.18 |
| Complete answer → React commit | 0.20 / 0.40 | 0.76 / 1.04 | 0.20 / 0.50 | 0.89 / 3.29 |
| Call → React commit | 39.60 / 44.70 | 21.87 / 24.90 | 42.70 / 49.50 | 39.53 / 51.12 |
| Call → mutate return | 38.50 / 43.30 | 20.29 / 23.22 | 41.80 / 48.20 | 36.20 / 46.85 |
| Old unmarked answer duration (see note) | 23.30 / 24.70 | 12.83 / 15.16 | 26.90 / 35.30 | 20.47 / 27.52 |

### Fixed follow: every stage

| Stage | wasm idle | process idle | wasm contention | process contention |
|---|---:|---:|---:|---:|
| Call → first updating mark | 0.10 / 0.20 | 0.08 / 0.10 | 0.00 / 0.20 | 0.07 / 0.10 |
| Call → durable admission | 3.50 / 4.40 | 1.07 / 1.19 | 3.20 / 5.40 | 1.35 / 3.58 |
| Admission → server commit | 9.80 / 10.90 | 6.41 / 7.62 | 8.04 / 11.97 | 9.58 / 14.27 |
| Call → server commit | 13.21 / 14.58 | 7.54 / 8.69 | 11.12 / 14.98 | 11.29 / 15.66 |
| Server commit → device settlement | 6.66 / 7.51 | 1.93 / 2.26 | 7.95 / 14.15 | 3.83 / 6.34 |
| Device settlement → apply | 16.20 / 18.30 | 8.97 / 9.43 | 17.20 / 23.70 | 15.62 / 19.19 |
| Apply → first changed answer | 6.70 / 7.80 | 4.61 / 5.25 | 4.60 / 7.80 | 7.51 / 9.54 |
| Call → first changed answer | 43.70 / 46.50 | 23.01 / 24.87 | 43.90 / 52.20 | 39.12 / 45.04 |
| First changed answer → complete | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 / 0.00 |
| Call → complete answer | 43.70 / 46.50 | 23.01 / 24.87 | 44.10 / 52.20 | 39.12 / 45.04 |
| Complete answer → React commit | 0.30 / 0.30 | 1.06 / 2.03 | 0.20 / 0.90 | 0.96 / 2.04 |
| Call → React commit | 44.00 / 46.80 | 24.00 / 26.08 | 44.20 / 52.50 | 40.94 / 46.34 |
| Call → mutate return | 40.20 / 42.80 | 20.50 / 21.98 | 42.50 / 48.50 | 34.60 / 40.41 |
| Old unmarked answer duration (see note) | 0.10 / 0.20 | 0.08 / 0.10 | 0.00 / 0.20 | 0.07 / 0.10 |

### Fixed unfollow: every stage

| Stage | wasm idle | process idle | wasm contention | process contention |
|---|---:|---:|---:|---:|
| Call → first updating mark | 0.10 / 0.20 | 0.07 / 0.09 | 0.10 / 0.10 | 0.07 / 0.08 |
| Call → durable admission | 3.50 / 3.90 | 1.02 / 1.23 | 2.90 / 4.70 | 1.71 / 2.22 |
| Admission → server commit | 10.79 / 11.86 | 6.54 / 7.96 | 7.88 / 14.41 | 9.90 / 12.32 |
| Call → server commit | 14.19 / 15.55 | 7.65 / 9.05 | 11.47 / 16.41 | 12.01 / 14.49 |
| Server commit → device settlement | 6.58 / 7.51 | 1.88 / 3.36 | 6.12 / 11.45 | 5.00 / 7.28 |
| Device settlement → apply | 17.20 / 19.20 | 9.32 / 10.87 | 18.60 / 22.10 | 14.87 / 26.19 |
| Apply → first changed answer | 5.10 / 5.70 | 4.25 / 5.68 | 4.30 / 6.90 | 7.99 / 11.39 |
| Call → first changed answer | 43.50 / 47.50 | 23.14 / 27.88 | 41.70 / 49.90 | 39.98 / 51.03 |
| First changed answer → complete | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 / 7.82 |
| Call → complete answer | 43.60 / 47.50 | 23.14 / 27.88 | 41.70 / 49.90 | 40.12 / 54.37 |
| Complete answer → React commit | 0.30 / 0.40 | 2.35 / 3.18 | 0.20 / 1.00 | 0.88 / 1.85 |
| Call → React commit | 43.90 / 47.80 | 25.54 / 29.90 | 42.00 / 50.40 | 41.10 / 54.87 |
| Call → mutate return | 41.90 / 45.80 | 21.39 / 24.63 | 40.90 / 49.00 | 36.15 / 47.06 |
| Old unmarked answer duration (see note) | 0.10 / 0.20 | 0.07 / 0.09 | 0.10 / 0.10 | 0.07 / 0.08 |

“Old unmarked answer duration” integrates the previously published old answer from the harness’s call timestamp to subsequent SDK publications. In the fixed arm it includes the fraction of a millisecond spent entering the synchronous call before its mark; that occurs within one JavaScript turn and is not an emitted misleading answer or a post-call `getSnapshot()` opportunity. The causal regression asserts that the snapshot is already marked when `mutate()` returns its promise.

## Causal regression and design audit

`tools/follow-window.test.mjs` is imported by the normal package test inventory. It runs on real wasm and process devices, with retained and non-retained observations and ordinary/zero-wait mutation calls. Host Date/setTimeout remain frozen; only zero-delay queue turns and actual I/O run. It holds the mutation before server execution, then holds sync before apply. It checks every publication, direct reads, pending writes before/after settlement, an idempotent refollow, self-follow refusal, and a disjoint query. It releases each boundary causally. The timeout is a deadlock guard, not a correctness threshold.

The baseline regression failed all four original real-device cases on the queued complete/fresh answer. A frozen-timer control of the first fix exposed missing no-op retirement wakeup; the final eight cases pass without advancing host time. Existing affected tests cover horizon routing, held/online-only cards, prediction fences, authorization dependencies, unfollow/repost reuse, stream recovery and live propagation.

Orientation followed `llp-orient`. Governing constraints are LLP 3000.016 §2.2 (withholding/fallback), §2.3 (edge nonprediction), §3 (authorization/history), LLP 3000.026 §4 (atomic launch, unchanged here), and LLP 3000.023 §10 (publication revisions, revalidation and change evidence). LLP 3000.016 now records **Own edge publication**. LLP 3000.026’s populated-store launch is not modified. No new LLP, gate, ceiling, queue, backend mutation or prediction mechanism is added.

## Validation and failures

- Affected SDK/device integration: **156/156 pass**, no skips (`logs/affected.log`), covering the original change before the additional no-op wakeup; the full suite below covers the final source.
- Dedicated causal regression: **8/8 pass**, host timers frozen (`logs/frozen-regression-final.log`); the full suite also runs the final disjoint-read assertion.
- Whole guide: **99/99 pass**, no ignores (`logs/guide.log.gz`).
- SDK typecheck/build, docs budget and release guard pass.
- `ref-check --verbose`: **524 LLP docs, 9,955 refs, 0 errors, 0 unchecked**.
- Wasm: **1,978,828 B raw / 593,295 B gzip**, unchanged measured size, **424 B below** the unchanged 593,719 B ratchet. No budget increase. `qualification.json` records source/artifact hashes.

Ran `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash scripts/test.sh` **exactly once**, exit 1. Exact summary:

```text
== 1 failure(s) in 1394 s
   client tests
```

Every full-suite failure: **ours — `every delivery await is explicitly classified`** in `delivery-fault-matrix.test.mjs`. The existing boundary record lacked the new read-only outbox check and its publication await. Classified those as query-publication reads, regenerated the record with `awaitBoundary()`, and reran that exact assertion: **1/1 pass** (`logs/await-classification.log`). No product source changed after the full run began. The full run remains red in the record; it was not rerun. Baseline full-suite failures: **0**. Environmental full-suite failures: **0**.

Full-run totals: Rust **4,354 pass / 33 declared ignores**; clients **5,257 pass / 1 failed / 10 existing skips**, including all eight new frozen-clock cases; fixture wrappers **9/9**; serial client models **79/79**, preserving both 5,000-sequence session walks and the existing model counts. No cancellations. The suite’s nominal 60-second process bar remains exceeded; no count, timeout or assertion was relaxed.

Earlier failures and corrections (retained, not erased by later passes):

| Command/log | Attribution | Failure and disposition |
|---|---|---|
| `baseline-regression.log` | Baseline product, fixed here | All four original wasm/process × retention cases detect the queued complete/fresh old feed. |
| `typecheck.log` | Ours | Two initial TypeScript errors: nullable backend getter and untyped callback parameter. Corrected; `typecheck-fixed.log` passes. |
| `expanded-regression.log.gz` | Ours, harness | Four ordinary-wait timeouts expected sync after a second unfollow, which correctly refuses because the edge is absent. Removed that incorrect success expectation; idempotent follow and explicit self-follow refusal remain. Four zero-wait cases checked `fresh` on the first complete answer while sync freshness was still settling; the final predicate explicitly waits for a fresh answer. |
| `regression-diagnostic.log` | Ours, harness | One repeat of the invalid second-unfollow expectation timed out. |
| `regression-zero-wait.log.gz` | Ours, harness | One repeat of the premature freshness assertion failed. |
| Corrected process trace | Ours, metrology | The original process log mixed sender and receiver apply events. Separated traces and repeated all four process cells after the suite. Superseded raw evidence is retained and excluded from current percentiles. |
| Baseline SDK preparation | Ours, setup | One command used the wrong working directory before the compiler ran. The extracted SDK then had three TS2307 errors because ignored wasm bindings were absent (`baseline-sdk-isolated.log`). Copied the unchanged generated bindings and rebuilt successfully (`baseline-sdk-isolated-fixed.log`); this SDK is used only for the process comparison. |
| `frozen-causal.log` | Ours, first implementation | Freezing host timers exposed the incomplete answer stranded after idempotent follow retired without row changes. The probe ended cancelled with “Promise resolution is still pending but the event loop has already resolved”. Added sync-publication wakeup and moved timer restoration ahead of teardown. All eight frozen cases then pass. |

No measurement attempt timed out; all trials, including the superseded process traces, are retained. Setup: the documented fleet inventory is absent at `~/Dropbox/APIKeys/MACHINE_FLEET.md` on this Linux host, so work used the current 96-CPU machine. The repository’s LLP skill submodule was initially uninitialized and was initialized before orientation. Those are environmental setup observations, not waived product tests.

## Artifacts

- `tools/README.md`: setup, provenance and rerun commands; `tools/` contains the fixture, measurement, UI, trace, summarizer and causal regression.
- `baseline-{wasm,process}-{idle,loaded}.json.gz` and `fixed-{wasm,process}-{idle,loaded}.json.gz`: every sample and event; smoke samples are retained separately.
- `summary.json`: all percentile sample counts, per-trial answer flags, rendered sequences and misleading-answer counts.
- `logs/`: unedited command/test/build output, including detecting failures and corrected setup mistakes. Four logs are gzip-compressed to preserve the raw whitespace that the initial staged `git diff --check` flagged; decompression reproduces their original bytes. The final whitespace check passes.
