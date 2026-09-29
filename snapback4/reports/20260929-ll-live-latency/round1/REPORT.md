# LL round 1 — preserve fallback and terminal refusals

Date: 2026-09-29. Branch: `sb4-intent/ll-live-latency`.
Round 0: `3c28529bd8`. Merged `origin/main` at
`38abb89b8e0b206644b9e2619c6f2d159a981d23` first, producing `02a6fe70dc`.
Both appended journal histories and both guide instructions were retained.
SR, KR and the publication test changes remain in the merge. The delivery await
boundary had no conflict and `awaitBoundary()` matches its checked-in record.

Both Astra regressions are fixed. Early parking now requires a current `held`
declaration, whose routing contract forbids server fallback on every evaluation.
A previous local answer cannot establish that property. Ordinary queries still
run the local interpreter and the existing fallback procedure, so a time branch
can start reading an online-only profile and obtain a whole-server answer at the
notified cut before sync completes. The pending-cut fence remains afterward;
that answer cannot authorize older replica rows.

Terminal session, change-feed and partition refusals bypass parking and reach
`runLocal`'s existing checkpoints/publication procedure. This also covers a
refusal arriving after a held watch is already parked; no duplicate refusal
publication mechanism was added. Current backend operation facts take precedence
over the query handle's held hint, matching the evaluator.

All acquired watches awaiting a notified cut register for sync publication,
including ordinary queries that continue evaluating. Publication wakes them even
when the eventual apply footprint is disjoint and replaces an obsolete retry
delay through the existing queue. Held watches still release their slot without
retrying. The bounded retention episode, completeness and prediction checks,
server cut, scope, expiry and media authorization fences are preserved.
`local.ts` remains 1,500 lines. LLP 3000.023 §10 records this correction.

## Regressions and controls

The new `live-propagation-fallback.test.mjs` runs three cases on process and wasm:

1. A mounted query first answers from local messages. Its next evaluation crosses
   `now >= cutoff`, reads an online-only profile and returns the remotely edited
   message while `/sync` is held. The server receives the original arguments;
   device time is controlled, and the real server has crossed the same cutoff.
   Initially there are zero server-query requests. The replacement must be a
   whole-server answer and must leave the replica's pending cut intact.
2. A previously local ordinary watch receives the edit notification, followed by
   a nonretryable `E_STORE` from `/sync`. Mounted and direct reads both deny.
3. An explicitly held watch demonstrably parks without an extra device query,
   then receives that refusal. The scheduled replacement must publish the denial
   while the notified cut remains unapplied.

All six fail by assertion against round 0 after the main merge
(`regressions-before.log`, 0/6 passed, zero cancellations). The fixed focused
run passes 32/32. Test cleanup was repaired before that completed baseline run;
[FAILURES.md](./FAILURES.md) records the two preliminary harness failures.
The fixture keeps its future cutoff inside the change-feed silence window;
post-notification assertions pump only zero-delay queue/I/O turns.

The existing causal test now distinguishes ordinary queries, which must evaluate,
from explicitly held queries, which must park. It checks both held child changes
and held unknown/disjoint resumption, and explicitly checks that a known disjoint
profile write leaves the reaction watch quiet (Grok's low-priority observation).
Parent, child add/replace/remove, joined-profile, authorization, unknown footprint,
keep modes and the one-second retention bound remain covered on both devices.
The earlier retention and 300-history mixed-evidence tests again exercise actual
old-replica reads and thrown read failures. The per-row progress test covers both
ordinary paced retries and held parking, across all three keep modes.
No history count, timeout, safety bound or skip was weakened.

Five built-artifact mutation controls each fail assertions with status 1 and no
termination (`mutations.json`); artifacts are restored in `finally`:

| Deliberate defect | Failed cases |
|---|---:|
| Park based on the previous local route | 2 transition cases |
| Ignore terminal refusal when parking | 2 held refusal cases |
| Omit the child-table dependency | 1 causal child case |
| Lose disjoint publication resumption | 1 held unknown-footprint case |
| Ignore retained media's authorization dependencies | 1 media case |

The exact mutation strings, test names and results are in `mutations.json`, with
individual logs. The product has no mutation or measurement hooks.

## Measured cost

The unchanged round-0 harness ran all eight flows 20 times in each configuration:
**640 actions, zero timeouts**. Same public SDK, two independent sessions,
Chromium wasm and Chromium-to-process adapter, viewed-media retention, fixture,
post-SQLite-commit stamp, React publication and media readiness measurements.
No lane-LL build or test overlapped these runs. The server measurement binary,
ordinary process binary and wasm were freshly rebuilt in this merged checkout.

| Maximum flow p95, commit → SDK publication | Round 0 | Round 1 |
|---|---:|---:|
| Wasm idle | 66.226 ms | 74.913 ms |
| Process idle | 83.178 ms | 127.304 ms |
| Wasm, four CPUs + three busy workers | 65.879 ms | 73.260 ms |
| Process, four CPUs + three busy workers | 118.846 ms | 180.047 ms |

**The full round-0 speedup was not preserved.** [COMPARISON.md](./COMPARISON.md)
reports p50/p95 and the exact measured p95 delta for every flow on both devices
under both loads. [STAGES.md](./STAGES.md) reports all stage distributions and
work counts. Every summary JSON retains n/p50/p95/max, and the four compressed
raw traces retain all timestamps. The fixes restore ordinary evaluation work:
idle reaction-add pre-apply query count is now p50/p95 **20/20 wasm, 24/32
process**, versus round 0's **0/0**. Those are trial-wide counts, not one watch.
Retained-media home reads for this flow remain **0/0** on both devices under
both loads; the selective media change and its authorization checks are intact.

Idle process reaction-add p95 is **44.975 → 80.995 ms (+36.020)**, still below
round 0's original pre-optimization **141.598 ms**. Under contention it is
**47.461 → 115.416 ms (+67.955)**. The largest measured p95 increase is process
reply under contention: **111.215 → 180.047 ms (+68.832)**. Some flows are also
slower than the original pre-optimization baseline (for example idle process
photo **106.9 → 111.262 ms**); no blanket retained-speedup claim is made.
All measured data/photo-row p95 values remain below the requested **300 ms**.

Bytes remain separate. Ordinary photo commit-to-ready p95 is **144.397 ms wasm /
415.789 ms process idle**, and **144.450 / 410.306 ms under contention**. Process
photo bytes still exceed 300 ms; that was also true in round 0. Stage and summary
files include uploads, quotes, once photos, feed images and React commits.
The reads card now reports the round-1 ranges within its existing line budget;
the merged client card remains at 130 lines and reads at 236.

These are repeated measurements, not an isolated causal estimate of each
millisecond. Hardware is the same AMD EPYC 9454 Linux host, Node 24.13.1 and
Chromium 151.0.7922.34. Loaded runs inherit `taskset -c 0-3` with three owned
busy workers. Shared-host load averages are recorded per run. Twenty samples
make p95 the 19th observation, with ordinary run-to-run noise. The original M1
calibration stalls remain unreproduced; this is the reduced direct-local-client
fixture, not Expo, the full builder application, an installed release, or an
M1 simulation. The process browser bridge adds overhead. Round 0's original
baseline-wasm provenance limitation remains relevant when comparing to that
older pre-optimization baseline. Round-1 wasm was built here.

## Reproduction and artifacts

Use the unchanged [round-0 harness instructions](../tools/README.md), setting
`LL_OUT=reports/20260929-ll-live-latency/round1/final-<tier>-viewed[-loaded].json`.
The four configurations are `LL_KEEP=viewed LL_RUNS=20`, tiers `wasm` and
`process`, each once idle and once with `LL_LOAD=3 taskset -c 0-3`.
Run `tools/summarize.mjs` on the four raw `.json` or `.json.gz` traces.
Instrumentation temporarily changes the engine only while building its copied
measurement binary, then restores source; the ordinary CLI was rebuilt next.
Input and trace hashes are retained alongside this report. `evidence-check.log`
recomputes every publication p50/p95 and verifies all four raw trace hashes and
640 actions. Input hashes name the measured artifacts; the suite later rebuilds
the ordinary CLI with the updated guide prose.

## Verification

- Focused regression run: **32 passed, 0 failed** (`regressions-fixed.log`).
- Broader affected run: **715 tests, 707 passed, 8 failed**, no cancellations or
  skips, 402,199.452901 ms (`affected.log.gz`). All eight were ours: two fixture
  waits crossing the silence watchdog and six obsolete zero-work assertions.
  Every failure and repair is listed in [FAILURES.md](./FAILURES.md).
- Final correction run: **24 passed, 0 failed**, no cancellations/skips,
  12,669.752797 ms (`affected-corrections.log`), covering all eight failed cases
  plus six new held variants. The six regression cases also independently
  passed in `regressions-final.log`.
- Both complete **300-history** mixed-evidence schedules passed in the affected
  run: process 234,448.496387 ms, wasm 163,638.36007 ms, `failedSeeds: 0`.
  The full 160-site delivery fault matrix also passed.

The full suite's Rust stage passed **4,323 tests**, zero failures, 33 declared
ignores across 987 executions; workspace doctests passed. Its ordinary client
stage passed **5,245 tests**, zero failures/cancellations, 10 existing skips
(5,255 total), 409,243.915215 ms. Both app typechecks and the nine fixture tests
passed. The final serial client models passed **79/79**, zero failures/cancellations/skips,
300,367.161154 ms, including both 5,000-sequence session models.

Exactly one invocation of
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash scripts/test.sh`
finished with **`== 0 failure(s) in 1290 s`**, exit **0** (`full-suite.log.gz`,
`full-suite.exit`). It used the default 24-client-file pool and full model counts.
There are **no full-suite failures** to classify: ours 0, baseline 0,
environmental 0. The earlier eight affected-test failures were ours and repaired;
the full suite validates the corrected versions. Its 1,290-second runtime still
exceeds the repository's inherited 60-second target; no timeout or count was
changed to reduce it.
Whole guide: **99 passed, 0 failed**, 2.53 s (`guide.log.gz`).
SDK build and typecheck pass. The exact delivery await boundary matches.
Final `ref-check`: 524 LLP docs, 9,937 refs in 29,728 files; zero errors or
unchecked refs (`ref-check-final.log`). `git diff --check` passes.
Wasm: **2,040,727 B raw / 592,959 B gzip**, cap **593,719 B**, **760 B headroom**
(`wasm.log`); unchanged from round 0. No byte budget, contract or public API change.

No push or publication. The final commit carries
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.
