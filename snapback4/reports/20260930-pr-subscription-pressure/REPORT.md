# PR round 0 — subscription pressure

Local branch `sb4-intent/pr-subscription-pressure`, base
`2cb2b5f141befd4c5dfd6afdc6c0725867f3c747`. Nothing pushed or published.

The mounted-history bug is reproduced and fixed on real wasm and process
devices. A second committed edit retires a history evaluation; when its retry
joins the back of the observation queue, the old one-second wall deadline used
to keep running. Main publishes loading at **1,010.807 ms wasm / 1,012.096 ms
process** after the first change while the history is queued, with **73 queued
observations and eight active**. Both fixed histories remain present throughout
the 1.2-second queue hold, then publish the second edit. No additional slots,
priority lane, polling loop or query/result cache was introduced.

## Product behavior

`ReadWork` reports its existing queue transitions. The observation's episode
clock subtracts capacity queue time; it never restores consumed budget. Source,
identity-preserving copies and approved facade answers share that clock. A new
episode starts only at attempt execution. Plain revalidation remains unbounded.
Running evaluations, retry backoff and parking for a missing sync cut still use
the existing one-second change-evidence budget. Failed attempts still withdraw;
a timed-out attempt can still publish its eventual current answer. Timers and
snapshot/peek deadline checks agree, including a suspended timer.

Hard boundaries remain immediate. This exposed an additional pre-existing gap:
main also retained a known removed membership's history behind a held slot.
Successful `apply` scope tombstones now synchronously reset observations with
intersecting table dependencies (unknown dependencies are conservative), inside
the existing notification boundary. Both real-device tests fail on main and
pass here. The interpreter still decides whether a subsequent answer contains
permitted delivered history. Explicit denial, expiry, `keep:false`, key changes,
sign-out, credential/viewer/store/schema reset and program-generation fences
remain. The existing RL membership tests now require this immediate withdrawal;
plain revalidation and ordinary edit/delete tests retain their no-gap assertions.

PQ's eight starts per turn and eight active attempts are unchanged. LL's pending
cut, current-held-only parking, ordinary fallback eligibility, sync resumption,
media dependencies and publication fences are unchanged. No Rust engine,
`contract.ts`, wasm source, device wire, horizon, prediction or outbox policy
changed. `local.ts` is 1,499 lines.

## Developer inspection

```ts
import { inspect } from 'snapback4/inspection';
const pressure = inspect(client);
console.table(pressure.queries);
console.table(pressure.recentWithdrawals);
```

`version:1` supplies source observations grouped by query name; observation and
subscriber totals; queued, in-flight, revalidating, withdrawn and loading counts;
64 recent withdrawals with timestamp, query, cause and optional refusal code;
and nearest-rank queue/attempt p50/p95/max over 256 completed attempts. `null`
means no timing samples. Counts include linger and queued retry delays; attempt
queue timing measures capacity wait, separately from backoff. Direct reads and
background presence refreshes are outside this scheduler. Each returned sample
is detached; no row contents, arguments or credentials are collected.

The auxiliary function follows the existing acquisition/peek pattern, keeping
`Client` unchanged. App facades forward their current raw client; invalidated
facades and unsupported clients return `supported:false`. The opt-in React hook
`useInspection(import.meta.env.DEV)` (Expo: `useInspection(__DEV__)`) supplies
250-ms development-overlay samples. Disabled returns null and installs no timer.
The client card includes the screen-flash recipe at **117 lines / 1,194 words**,
below its existing 130-line/1,200-word limits.

## Reproduction and evidence

Calibration input was read from `~/sb4-intent/cal27-evidence/`: essay, diary,
run log, scorer notes, app/query sources and M8 console records. The r4 log
reports `first=0 second=0` after 9,520.7 ms settlement wait. This investigation
uses its history, per-message reactions/receipts, two feeds, profile and search
shapes; it does not claim to run the original Expo application or reconstruct
that original machine's exact schedule.

The two-device harness mounts **124 observations per device**, seeds 40 history
rows, takes both transports offline, queues one identified message from each,
then reconnects. Each device must render all 42 distinct rows, both offline IDs
exactly once, with no duplicate in any intermediate publication. The wasm case
runs both real IndexedDB-backed devices in separate Chromium contexts. The
process case runs independent process clients/stores and forwards every history
publication in order to separate Chromium React roots. The local server and
interpreter are real in both cases; delays affect only device-call completion.
Histories, every render, 10-ms queue samples and withdrawal causes are retained.

Natural baseline histories converged without a gap; some decoration observations
expired. A deterministic reconnect interleaving then holds each first history
completion, commits a concurrent peer edit, applies it to both devices, and
releases their obsolete histories back into the populated queue. This reproduces
**one empty-history publication on each of both devices on main**, and zero on
either device with the fix. All publications and renders are captured. The final
12-test pressure run passes without skips/cancellations.

| Main withdrawal (time since that device mounted) | Empty interval | Queued / in flight at withdrawal | Cause |
|---|---:|---:|---|
| Wasm device 1: 2,712.6 ms | 753.3 ms | 55 / 8 | change-timeout |
| Wasm device 2: 1,963.1 ms | 737.1 ms | 55 / 8 | change-timeout |
| Process device 1: 3,263.252 ms | 363.997 ms | 28 / 8 | change-timeout |
| Process device 2: 2,716.130 ms | 358.664 ms | 28 / 8 | change-timeout |

All four fixed histories have **zero withdrawals**, with the same peak of 116
queued / eight active, and all 42 rows at convergence. The timing of each device
has its own mount origin; the table does not imply synchronized wall origins.
[pressure.html](./pressure.html) provides an interactive queue/history timeline;
`convergence-summary.json` and the complete raw traces back every value.

The separate controlled 81-observation history test isolates the queue bug:
two real edits, a held history completion, eight occupied slots and 73 pending
observations. Main fails both histories and both immediate-removal assertions;
fixed passes all four. The separate deterministic test proves that the facade
shares the pause and that 100 ms already consumed plus 900 ms after service still
exhausts the original budget. Inspection counts, percentiles, immutable snapshots,
finite event history and facade invalidation are checked under a frozen schedule.

Reproduce from `snapback4/` after the normal build:

```sh
node --test packages/snapback4/test/subscription-pressure*.test.mjs
node reports/20260930-pr-subscription-pressure/tools/baseline-sdk.mjs
RL_TEST_SDK=target/pr-main/dist PR_EVIDENCE=reports/20260930-pr-subscription-pressure PR_LABEL=main node --test packages/snapback4/test/subscription-pressure-device.test.mjs
PR_EVIDENCE=reports/20260930-pr-subscription-pressure PR_LABEL=main-control node reports/20260930-pr-subscription-pressure/tools/main-pressure.mjs
```

The main control deliberately fails assertions, not imports, timeouts or skips.
The baseline tool transpiles the seven changed modules from the recorded base
with the workspace's TypeScript target; untouched device and SDK dependencies
remain identical. No product instrumentation hook ships.

## LL measurements

The unchanged LL instrumenter/harness ran all eight flows 20 times per cell,
wasm/process × zero/three busy workers. Both before and after runs use CPU
0–3, real Chromium, viewed-media retention and the same post-SQLite-commit
measurement binary. This is **640 actions before and 640 after, zero timeouts**.
Every stage distribution and work count is retained in summary JSON; raw traces
are retained compressed. [LL-COMPARISON.md](./LL-COMPARISON.md) gives every flow's
publication p50/p95 and evaluation/home-read counts.

| Maximum flow p95, commit to SDK publication | Before | After |
|---|---:|---:|
| Wasm, no busy workers | 46.964 ms | 45.042 ms |
| Wasm, three busy workers | 94.598 ms | 100.604 ms |
| Process, no busy workers | 78.520 ms | 95.519 ms |
| Process, three busy workers | 218.916 ms | 358.139 ms |

The last cell is a measured regression, not hidden by the otherwise passing
samples. Shared-host load rose from 55.5 to 132.27 between those runs. The additional
alternating process contention controls measured maximum publication p95 of
**236.000 / 472.833 / 249.785 / 220.074 ms**, main/fixed/main/fixed respectively,
again 160 actions each with zero timeouts. Recorded ending load was
78.15 / 137.13 / 87.03 / 65.95. The final adjacent main/fixed pair is below the
300-ms data target and shows no latency regression; earlier fixed high-load
runs exceeded it. These samples support shared-host contention as an explanation,
not a causal proof about every millisecond or a universal 300-ms claim. All
1,920 measured actions and every earlier result remain in the evidence.
Reaction flows still do **zero retained-media home reads**; the LL dependency
and pending-cut regressions pass. Per-flow query counts remain workload/schedule
dependent and are reported, not asserted to be byte-for-byte counts. No LL
product path was rewritten to improve a benchmark result.

## Verification

Initial affected run: 303 tests, 293 pass / 10 failures (four obsolete membership
render assertions and their parents, plus two obsolete held-removal assertions).
Corrected retention/React/pressure run: **376/376**. Corrected review regression
run: **38/38**. The whole guide passes **105/105**. SDK build/typecheck and delivery
await classification pass. The new synchronous inspection module adds no await;
its zero-await boundary entry is recorded. Ref-check passes with zero errors or
unchecked references. Every setup, expected baseline, and affected-check failure
is classified in [FAILURES.md](./FAILURES.md); none is silently discarded.

The once-run full suite, final wasm measurement, matched LL controls and final
input consistency check are recorded in the completion section below.


## Completion and once-run qualification

Ran exactly once with the package's SQLite policy:

```sh
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash scripts/test.sh
```

Exit **1**, exact summary and failed step:

```text
== 1 failure(s) in 1376 s
   client tests
```

Rust: **4,362 pass, zero failures, 33 declared ignores**. Client pool: **5,330
tests, 5,298 pass, 22 fail, ten existing skips, zero cancellations**, 252 files
at the normal 24-file concurrency. Fixture wrappers: **9/9**. Serial models:
**79/79**, including both full 5,000-sequence walks. Cargo tests took 611 seconds,
client tests 411 and serial models 304. The inherited nominal 60-second suite
budget remains exceeded. `FULL-SUITE-RESULT.json` records every failed name;
`full-suite.log.gz` retains the full output. All **468** frozen source/test/guide
inputs matched after the run (`FULL-SUITE-CONSISTENCY.json`).

All **22 failures are ours**; baseline failures **zero**, environmental failures
**zero**. Twenty assertions required keeping removed membership answers: eight
`answer-withdrawal` apply modes and twelve `keep-device` revoke/leave/refusal
combinations. They now require immediate applied-scope withdrawal while ordinary
edit/admission/settlement retention assertions remain. One README coverage test
required calls to the new API and exposed an internal export: a small public
`inspection.ts` entry now exports only `inspect` and its types; unchanged internal
code lives in `observation-work.ts`. A compiled TSX example covers `inspect` and
`useInspection`. The affected correction run passes **87/87**; the complete guide
passes **105/105**, at 117 lines / 1,194 words for the client card. Typecheck/build
and the regenerated synchronous-module await classification pass.

The remaining failure was the new wasm convergence test's unconditional no-gap
assertion. Under full-suite load it recorded four empty publications after one
history `change-timeout`; its original trace did not record that watch's work
state. A controlled repeat pinned to four CPUs with three busy workers reproduced
exactly that **four/zero** pattern and measured the timeout **1,004.6 ms into the
held active attempt, queued=false/inFlight=true**. A separate intentional 1.1-s
active hold reproduced legitimate expiry on both devices and hosts. This is the
RL bound the task requires preserving, not time spent waiting for capacity.

The real-time convergence assertion now rejects every queue-caused timeout and
requires a recorded legitimate timeout for every empty publication. An already
exhausted budget checked on queue entry is distinguished from waiting there.
Every intermediate rendered history has unique IDs, and the final DOM must match
all 42 converged rows. The deterministic frozen-schedule and real-device held-slot
regressions still assert **zero withdrawals and zero empty answers** during queue
wait. No timeout, trial count or work bound increased. The final normal convergence
record has zero gaps on all four histories; the explicit active-timeout variant
passes **2/2** while preserving its four legitimate withdrawals. The final main control
fails on both hosts with queued=true/inFlight=false (`main-recheck.log.gz`), verifying
that the revised assertion still detects the actual defect.

After the full suite, only the public/private module separation, compiled example,
obsolete test expectations, harness cause attribution and one guide punctuation
fix changed. The episode, scheduler, local membership handling and wire behavior
did not change. The full suite remains recorded red; it was not rerun or relabelled.
See `FAILURES.md` for every failed experiment, including harness corrections.

The full suite rebuilt wasm at **1,978,828 B raw / 593,225 B gzip**, byte-identical
to the baseline measurement. The unchanged ratchet is **593,719 B**, leaving
**494 B**. `WASM.json` carries the digest and measurement; no budget increase or
Rust change was needed. LL measurements above remain applicable: the only later
SDK change separates a public export from the same synchronous implementation.

Raw traces are gzip-compressed without dropping events. `TRACE-SHA256.json`
records their compressed and original hashes; the HTML timeline uses the original
qualified main/fixed pair. Additional loaded and active-timeout traces are retained
alongside that pair. The report does not claim no possible active-budget withdrawal
or an exact replay of calibration #27's original browser schedule.

Final post-correction pressure qualification is **12/12** in
`pressure-completed.log.gz`; its `convergence-completed-*.json.gz` records zero gaps,
116 queued/eight active at peak, and 42 final rendered rows on all devices.
`active-final.log.gz` passes both intentionally slow-attempt cases; `main-recheck.log.gz`
fails both main controls for the intended queue-cause assertion.

Final affected-scope reference audit: `ref-check: ok — 525 LLP docs, 9977 refs
in 30103 files, 0 errors, 0 unchecked`. The final workspace build and diff whitespace
check pass. `FINAL-INPUTS.json` records final inputs/artifacts and identifies the
post-suite changes without overwriting the frozen full-run record. No source
file exceeds 1,500 lines; local.ts remains 1,499. One journal entry was appended.
Nothing is pushed or published.

Test/build logs are also stored as `.log.gz`, byte-for-byte including diagnostic
whitespace (`LOG-SHA256.json`). Read with `gzip -dc FILE.log.gz`. This preserves
the original tool output while keeping whitespace checks applicable to authored
source and prose.
