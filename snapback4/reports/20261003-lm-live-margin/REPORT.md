# Lane LM — live margin and settlement investigation

2026-10-03, eb1000, branch `sb5/lm-live-margin`, base
`e15de2e49a084f75c0878ca19fdeb15dd4e7a7a3`, Snapback 4 0.4.11.
Local work only; nothing pushed or published.

The empty-list presentation is reproducible, including with RV: a history table
with a `once` column cannot receive RV's preservation certificate. During a slow
settlement replacement, its one-second episode withdraws to `loading`, and the
`usePage` accumulator exposes zero items. Removing the unused nullable `once`
column in the paired control preserves the previous complete history. This is
the documented conservative authorization boundary, not a dropped message or a
ready answer claiming an empty database. Both offline sends subsequently appear
exactly once on both devices. The original calibration frame is consistent with
this mechanism, but cannot be attributed conclusively from the retained bundle.

The ten-second propagation misses were **not reproduced**. This lane does not
claim they are fixed or prove they were entirely host-inherent. The bounded
standalone workload completes under controlled contention; it is smaller than
the frozen application's complete schema, rendered tree and media workload.
No scheduling or retention fix is justified by these observations. The only
runtime-source change is an opt-in qualification timestamp, described below.
The two existing tickets remain open. LLP 3000.023's rule is unchanged.

**Evidence custody and method.** The governing context is LLP 3000 (the SB4
fence and shared-host verification), LLP 3000.019 §3.3/§3.7 (durable receipts,
FIFO sends, independent follow sync and timing), and LLP 3000.023 §10/§12
(pending cuts, capacity fairness, publication fences and possible revocation).
The relevant current authoring form is in `CLIENT-AND-OPERATIONS.md`, the card
and local-evaluator sections. The local `llp-orient` link was broken; the same
read-only skill was loaded from the existing enginefix checkout. No new LLP,
authorization exception, runtime ceiling, delay or timeout is introduced.

Read before edits: both requested open tickets; calibration bundle `essay.md`,
`grading/trace.md`, `grading/grader-report.json`, the reaction measurements and
the relevant schema. The grader's UI-driven removal timings are 1,887/1,831/1,346
ms, but its API-driven removals are 880/899/1,052 ms versus sets at
3,484/1,937/1,335 ms. Removal is not consistently slower across both measurement
shapes. We do not turn the UI/API discrepancy into a backend latency claim.

The permanent package harness is
[`live-margin-browser.test.mjs`](../../packages/snapback4/test/live-margin-browser.test.mjs),
with helpers under the same test directory. It runs actual React `useQuery` and
`usePage`, two independent wasm devices with IndexedDB, real HTTP and real
mutations against `dev`. Each client renders 120 competing reaction observations
plus history and reaction reads (244 distinct source observations in all). The
measured reads are opened last, behind the competing observers in queue order.
The runs contain 264,334 / 263,790 competing component layout commits.
It uses a small members/messages/reactions schema, not the Clique instrument.
Every sample is retained; no best-of selection. The analyzer flags every
UI-call-to-render interval above the grader's unchanged ten-second ceiling. The
measurement test's separate hang guard lets a late sample finish and be recorded;
a test pass alone is not a latency verdict. A receiver is never forced to
sync after a live write. Each cycle sets a reaction, replaces it, clears it,
writes a text tombstone and restores the text. Twenty dual-offline cycles then
send one message from each device and require both messages on both clients.
This does not exercise media-element readiness, Following replay or video decode.
Its tombstone is a text update, not a media-grant revocation.

Both qualified conditions pin the harness, proxy, server and Chromium descendants
to CPUs **80–83**. Loaded adds **16 Python busy loops** in one separately launched
and recorded process group on those same CPUs. The parent records every worker
PID, terminates that group and joins its children. See `rendered-*.host.json`.
Unloaded means no owned busy loops, not an exclusively idle machine. Other lanes
and some affected validation coexisted on this shared host. One-minute load
ranges were **26.42–28.13 unloaded**, **25.27–33.78 loaded**. This host has 96
available CPUs; load average alone does not express contention on four pinned
CPUs. Node is 24.13.1; PATH and `CARGO_TARGET_DIR` use the requested host setup.

The server's existing `SNAPBACK4_READ_TRACE` now includes `mutation_commit` only
for a successful, non-replayed mutation, immediately after `Engine::mutate`
returns and before waking change polls. It is a host observation just after
commit completion, not an internal SQLite commit timestamp. There is no trace
clock read or file I/O when this qualification facility is disabled. The proxy
supplies the existing private trace header; it forwards streaming bytes and
adds a request ID to the response. Instrumentation overhead is included, not
subtracted. The browser records final feed delivery,
device commit callbacks, source notifications and React layout commits.
Streaming heartbeats remain visible to the SDK. No response clone/tee is used.

Browser time is aligned to the server/Node monotonic clock by nine bracketed
round trips, choosing the narrowest bracket. The uncertainty is ±0.215 ms
unloaded and ±0.222 ms loaded. This uncertainty affects server-to-browser
differences; browser-to-browser stage durations share one clock. React figures
are layout commits, not pixel-present or video-decoder readiness. Raw events,
server spans, calibration brackets and all samples are in `rendered-*.json.gz`;
[`live-margin-summary.mjs`](../../packages/snapback4/test/helpers/live-margin-summary.mjs)
recomputes `rendered-*.summary.json` directly from compressed or uncompressed data.
[rendered-trials.csv](./rendered-trials.csv) contains every trial and stage.

Native build output is shared with the other lanes. An exploratory loaded run
lost the new trace field because another lane replaced `target/debug/snapback4`.
That run remains in `before-loaded.*`, with its complete end-to-end timings,
but is excluded from commit-stage attribution. Both qualified runs instead use
the same preserved binary at `~/sb5-lanes/lm-artifacts/snapback4`, SHA-256
`6778ceff75a062827f2415d1b4436356c7abd515a24018669aaead80168087c0`.
Compilation still used the required shared target. The earlier unloaded run
and the initial memory-host probes remain exploratory evidence, not extra
independent samples in the tables below. The earlier pinned pair
(`pinned-*`) used background-only competing observers and opened the measured
reads first. It is retained as a separate control (removal p95 47.07 / 266.50 ms),
not pooled with the stronger rendered/back-of-queue condition below.

**Qualified measurements, N=20 per operation per condition.** All values are
milliseconds. These are the default debug server and development React builds,
with a raw local client (no application facade). Each cell is p50 / p95 / max (nearest-rank percentiles). The total
starts at the UI-side mutation call and includes its settlement wait and the
harness's ten-millisecond observation polling granularity; commit-to-React is
the event-stamped propagation measurement.

| Operation | Total, unloaded | Total, loaded | Commit → React, unloaded | Commit → React, loaded |
|---|---:|---:|---:|---:|
| Set reaction | 103.70 / 151.60 / 170.00 | 455.00 / 586.60 / 766.00 | 58.72 / 79.27 / 88.50 | 279.31 / 402.83 / 454.00 |
| Replace reaction | 106.30 / 142.10 / 160.40 | 489.20 / 678.90 / 935.90 | 60.74 / 88.90 / 99.11 | 273.91 / 463.71 / 570.75 |
| Clear reaction | 92.20 / 128.40 / 151.90 | 406.80 / 536.20 / 544.90 | 51.56 / 81.21 / 95.22 | 249.83 / 323.52 / 326.12 |
| Text tombstone | 74.20 / 115.40 / 121.00 | 369.00 / 477.10 / 488.80 | 51.05 / 76.33 / 82.37 | 252.73 / 304.82 / 330.93 |
| Restore text | 73.60 / 114.70 / 121.50 | 335.20 / 451.70 / 480.90 | 50.29 / 82.94 / 83.24 | 219.93 / 285.96 / 341.23 |
| Dual-offline cycle, including sends | 257.70 / 334.40 / 348.80 | 1236.40 / 1478.20 / 1665.60 | — | — |

There are zero ten-second misses in each condition's 100 live trials and zero
empty, loading or partial history renders during its 20 settlement cycles.
Zero misses in 20 removals is a bounded observation, not proof of a zero failure
rate: the one-sided 95% binomial upper bound is approximately 13.9% under an
i.i.d. assumption, which a shared-host sequence does not itself establish.

**Removal stages.** Invalidation starts on the notification, before device
apply; it is not a subsequent stage that can be added to the other intervals.

| Stage | Unloaded p50 / p95 / max | Loaded p50 / p95 / max |
|---|---:|---:|
| Call → commit observed | 13.19 / 21.18 / 22.91 | 63.69 / 81.37 / 84.20 |
| Commit → final change-feed body | 8.91 / 13.71 / 15.82 | 38.29 / 52.72 / 67.82 |
| Feed → source invalidation notification (overlaps sync) | 3.50 / 8.70 / 9.20 | 14.90 / 34.50 / 44.90 |
| Feed → matching sync body | 15.50 / 26.40 / 26.90 | 74.70 / 109.30 / 140.30 |
| Sync body → device apply commit | 8.80 / 15.60 / 21.20 | 36.20 / 64.80 / 72.50 |
| Device apply → accepted source publication | 16.00 / 26.20 / 34.30 | 79.90 / 132.50 / 149.90 |
| Source publication → React layout commit | 1.20 / 2.70 / 4.00 | 8.80 / 14.80 / 15.80 |

For one complete trace in each condition, take the nearest-rank median removal:
Unloaded trial 17, sequence 19, HTTP request 113. Relative to
commit, feed arrives at 8.463 ms, sync at 25.063, apply at
32.963, publication at 50.663 and React at 51.563. Invalidation
follows feed by 3.900 ms.
Loaded trial 87, sequence 89, HTTP request 533. Relative to
commit, feed arrives at 51.634 ms, sync at 134.934, apply at
174.734, publication at 247.134 and React at 249.834. Invalidation
follows feed by 16.100 ms.
These are whole individual traces; stage percentile columns need not add to a
percentile of the total. `callRenderMs` in the raw summary separately excludes
sender-settlement waits from the UI-call-to-React interval.

**Mechanisms and disposition.** `serve_changes.rs` wakes durable changes with
a condition variable. Its 100 ms pacing applies to ephemeral-only notifications;
the 25-second wait is a maximum long-poll hold, not a durable polling interval.
The two-second heartbeat and four-second silence watchdog concern link health.
The local client's failure/offline retry sleeps one second. None is a special
reaction-removal delay.

`waitForChange` records the pending cut and schedules affected observations,
then `follow` requests sync. The serial network chain preserves dispatch and
receipt custody; queued writes are not gated on intermediate settlement sync
after durable terminal receipts (LLP 3000.019 §3.3). Observation work starts at
most eight attempts per host turn and keeps eight active. Pending local cuts
reject older replica answers; ordinary reads retain their server fallback and
retry with 25 ms exponential backoff up to one second, while held reads park.
`answers.applied` and sync's resumption set wake them at publication, including
disjoint/no-op footprints. The existing frozen-timer tests cover this causal
path. No missed wake or removal waiting behind an expired retry was observed.

An empty local result performs an additional outbox/prediction check in
[`evaluateLocal.publish`](../../packages/snapback4/src/local-query.ts) before it can certify absence. A nonempty result already
proves presence. This is a real asymmetric cost and its asynchronous device call
can queue under load, but removing that check would weaken pending-write
semantics. The samples do not isolate it as the dominant tail: removal's loaded
median is below setting's, and the increase spans feed, sync, apply
and publication. No unsafe cache or omission of that check is introduced.
Local source notifications are synchronous. PRL's DOM 50 ms batching governs
online-client success notifications, not these local clients, and empty
replacements bypass it anyway. The one-second episode bounds how long old data
may remain; it does not schedule the new read at one second.

The controlled CPU condition increases propagation times by roughly four- to fivefold
through several stages. It demonstrates sensitivity to CPU scheduling, including
Snapback work and host delivery. It does not show a ten-second inherent hardware
floor, prove absence of another SDK/server mechanism, or attribute the grader's
four misses solely to CPU load. No product latency fix and no before/after-fix
improvement are claimed. The trace addition only makes the next investigation
measurable. No regression test failing main is presented as a repaired bug.

**Empty settlement transition.** The deterministic
[`live-margin-settlement.test.mjs`](../../packages/snapback4/test/live-margin-settlement.test.mjs)
runs both process and wasm devices, with and without the unused nullable `once`
column. It admits two real offline sends, holds their actual settlement query
replacement, and advances the observation's semantic clock by 1,500 ms. It
does not depend on the host being slow. Certified insertion retains two rows;
unknown `once` evidence produces `{ loading: true }` and `Pages.items === []`.
Release converges to three unique rows: the original plus both offline sends.
The real device/HTTP histories are retained in `settlement-*.json.gz`.

The path is [`revocation::Dependencies::table`](../../crates/snapback4-core/src/revocation.rs) (`once` means unknown) → empty
`preserved` certification for history → `watchCanRevoke` → bounded `reload` →
[`ReadEpisode`](../../packages/snapback4/src/read-episode.ts) withdrawal → first-page loading in [`Pages.getSnapshot`](../../packages/snapback4/src/react-pages.ts) → zero
presentation items. There is no ready empty or partial-empty answer in this
control. `usePage` uses that same accumulator. Real React/IndexedDB observations
are separately exercised by the timing harness. Calibration #29's messages have
`oncePhoto: image ... once ?`, even when a particular message contains only text.
Receipt-watermark changes also touch membership authority inputs, which RV
conservatively treats as whole-table dependencies. These explain why "insert"
does not automatically mean an unbounded RV episode for that application.

Suppressing this withdrawal would change the accepted authorization rule.
Certifying the private once ledger would require new evidence and disclosure
soundness coverage; the current rule explicitly declines that certificate.
There is no reproduced incorrect-empty device publication to repair. The exact
pre-workaround calibration UI transition and its ten-second media/tombstone
cases remain unresolved. The Following ticket describes another queue entirely:
durable generated delivery tasks before their derived commit. This harness has
none and makes no claim about repairing the recorded replay backlog.

**Checks and command record.** All commands below run from `snapback4/` with:

```sh
export PATH=$HOME/.local/bin:$HOME/.cargo/bin:$HOME/.bun/bin:$PATH
export CARGO_TARGET_DIR=$HOME/sb5-lanes/target
```

During the full run, the worktree's ignored `target` link pointed to that directory
because existing scripts also address `target/` directly. This caused the scratch
store failures classified below. After the run it was replaced by a real local
scratch directory with build-subdirectory links; compilation still uses the
shared target. Qualified client measurements use
`SNAPBACK4_BIN=$HOME/sb5-lanes/lm-artifacts/snapback4`.

```sh
cargo build -p snapback4
bash scripts/build-wasm.sh
bun run --cwd packages/snapback4 build
cargo test -p snapback4-lang --test guide
node --test packages/snapback4/test/wasm-budget.test.mjs
node --test --test-concurrency=4 packages/snapback4/test/live-propagation*.test.mjs packages/snapback4/test/answers-stay*.test.mjs packages/snapback4/test/revocation-retention.test.mjs packages/snapback4/test/subscription-pressure*.test.mjs packages/snapback4/test/per-row-progress.test.mjs packages/snapback4/test/pending-writes.test.mjs packages/snapback4/test/live-margin-settlement.test.mjs
LM_SETTLEMENT_OUT=reports/20261003-lm-live-margin/settlement node --test packages/snapback4/test/live-margin-settlement.test.mjs
node packages/snapback4/test/helpers/live-margin-load.mjs reports/20261003-lm-live-margin/rendered-unloaded 0 80-83
node packages/snapback4/test/helpers/live-margin-load.mjs reports/20261003-lm-live-margin/rendered-loaded 16 80-83
node packages/snapback4/test/helpers/live-margin-notification.mjs reports/20261003-lm-live-margin/notification-unloaded 0 80-83
node packages/snapback4/test/helpers/live-margin-notification.mjs reports/20261003-lm-live-margin/notification-loaded 16 80-83
bash scripts/test.sh
```

The load runner defaults to `LM_N=20`; the notification runner defaults to
`LM_REPEAT=20`. Host JSON records the exact child commands, PIDs and exits.
The notification tool injects two monotonic clock reads/one diagnostic into a
temporary sibling of the existing ticket fixture; it preserves every assertion,
clock tick and guard, and records the original source hash. The current wait
helper's work-scaled guard is longer than the historical five-second guard;
actual notification-to-sync durations, not passing status alone, are the evidence.

Build and check logs are retained verbatim: [native build](./build.log),
[trace build](./trace-build.log), [pinned build](./pinned-build.log),
[package build](./package-build.log), [wasm build](./wasm-build.log),
[affected clients](./affected.log), [whole guide](./guide.log.gz),
[wasm budget tests](./wasm-budget-test.log), and [settlement](./settlement-final.log).
Each named check exited 0. Exploratory harness failures are classified below.

Affected clients, verbatim:

```text
ℹ tests 449
ℹ suites 0
ℹ pass 449
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 119000.727348
```

Whole guide, verbatim:

```text
test result: ok. 110 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 4.51s
```

Initial locked wasm build, verbatim:

```text
wasm 2030224 B raw, 610085 B gzip (budget 610782: ok)
```

That is 697 bytes below the unchanged gzip ceiling. Wasm budget-helper tests:
`ℹ tests 2`, `ℹ pass 2`, `ℹ fail 0`, `ℹ duration_ms 2649.298341`.
The deterministic settlement check reports four passes, zero failures; both
qualified browser conditions report one test pass containing 120 trials each.

The complete suite ran **once**, exit 1. Its final lines, verbatim:

```text
== 2 failure(s) in 1893 s
   cargo test
   client tests
```

All failures are individually named in [FAILURES.md](./FAILURES.md), with the
original panic/assertion output in [full-suite.log.gz](./full-suite.log.gz). There were
25 Rust failures across four core targets because LM's local `target` symlink
was rejected by the private-store directory guard. The unchanged fixtures
hardcode scratch databases directly under that path. There were 36 client
failures, all in `witness-acquire.test.mjs`, because LM's relocated pinned binary
could not discover its client helper. Both are **LM test-environment setup
failures**, not attributed to unrelated lanes or excused as a clean suite.
No rule, assertion or timeout was relaxed.

The full suite's stage summaries, verbatim (complete individual output is in
the linked log):

```text
== cargo build
-- ok: cargo build (18 s)
== wasm build
wasm 2030224 B raw, 610085 B gzip (budget 610782: ok)
-- ok: wasm build (34 s)
== docs budget
-- ok: docs budget (156 s)
== release guard
-- ok: release guard (4 s)
== package typecheck
-- ok: package typecheck (2 s)
== package build
-- ok: package build (3 s)
== chat app check
-- ok: chat app check (0 s)
== cargo test
-- FAIL: cargo test (677 s)
== chat app typecheck
-- ok: chat app typecheck (1 s)
== expo app typecheck
-- ok: expo app typecheck (1 s)
== fixture wrapper tests
-- ok: fixture wrapper tests (12 s)
== client tests
wasm [
wasm moved survivor hidden=false: payload-bytes=655 identical-worlds=2 completions=1 key-at=100
wasm moved survivor hidden=true: payload-bytes=655 identical-worlds=2 completions=1 key-at=100
wasm unselected control removed=false: completions=1 key-at=1500 page-complete=true
wasm unselected control removed=true: completions=1 key-at=1000 page-complete=true
wasm empty groups: groups=5000 pages=158 max-response-bytes=119331
wasm written unselected round-trip=true: payload-bytes=836 worlds=2 p1-puts=3 completions=1 key-at=1000
wasm written unselected round-trip=false: payload-bytes=746 worlds=1 p1-puts=2 completions=1 key-at=1000
wasm membership collision kind=scope row-event=null: payload-bytes=663 identical-worlds=2 completions=1 key-at=1500
wasm membership collision kind=scope row-event=put: payload-bytes=789 identical-worlds=2 completions=1 key-at=1500
wasm membership collision kind=scope row-event=del: payload-bytes=650 identical-worlds=2 completions=1 key-at=1000
wasm membership collision kind=join row-event=null: payload-bytes=687 identical-worlds=2 completions=1 key-at=1500
wasm membership collision kind=join row-event=put: payload-bytes=813 identical-worlds=2 completions=1 key-at=1500
wasm membership collision kind=join row-event=del: payload-bytes=674 identical-worlds=2 completions=1 key-at=1000
wasm {
-- FAIL: client tests (682 s)
== client models
-- ok: client models (317 s)
== 2 failure(s) in 1893 s
```

The full client summary, verbatim:

```text
ℹ tests 5799
ℹ suites 0
ℹ pass 5753
ℹ fail 36
ℹ cancelled 0
ℹ skipped 10
ℹ todo 0
ℹ duration_ms 681915.034879
```

The final model summary, verbatim:

```text
ℹ tests 79
ℹ suites 0
ℹ pass 79
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 316362.044819
```

Focused setup corrections preserve the original full-suite result:

```sh
# Replace only this worktree's ignored target symlink with a real scratch
# directory; link build subdirectories to the same shared Cargo target.
cargo test -p snapback4-core --lib --test row_view_accounting --test row_view_disclosure --test row_view_witness -- --test-threads=4
SNAPBACK4_ACQUIRE_HELPER=$PWD/packages/snapback4/bin/witness-acquire.js node --test packages/snapback4/test/witness-acquire.test.mjs
```

The witness check uses the identical pinned binary, exits 0, and reports:

```text
ℹ tests 43
ℹ suites 0
ℹ pass 43
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 90673.311188
```

The four Rust targets exit 0 after the scratch-directory correction: 234
passed, 0 failed, 1 ignored (plus the library's nested one-test allocation probe).
No source or assertion change accompanies this rerun. Exact result lines from
[rust-corrected-setup.log.gz](./rust-corrected-setup.log.gz):

```text
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 204 filtered out; finished in 0.17s
test result: ok. 204 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 124.56s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 8.19s
test result: ok. 18 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 184.15s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 8.09s
```



**Frozen-clock notification repetitions.** Every condition contains 20 runs of
each of the five existing scenarios on each host: 200 cases per condition,
400 passes total. These are observations of the existing fixture, not a fixed
regression. Notification delivery → the unchanged sync-start barrier, in ms:

| Host / scenario | Unloaded p50 / p95 / max | Loaded p50 / p95 / max |
|---|---:|---:|
| Process, all 100 | 6.35 / 33.91 / 160.80 | 33.96 / 98.14 / 1707.19 |
| Process, present transition 20 | 6.61 / 29.30 / 32.85 | 46.81 / 109.72 / 129.15 |
| Wasm, all 100 | 2.27 / 7.60 / 9.45 | 2.30 / 12.87 / 46.32 |
| Wasm, present transition 20 | 2.57 / 9.44 / 9.45 | 2.41 / 14.59 / 24.77 |

Even the largest observed barrier was below the historical five-second ceiling.
The original intermittent failure remains open. Exact repetitions, source hashes,
commands, owned process groups and exits are in `notification-*`; every loaded
group was reaped. The complete suite and other host activity overlapped these
runs; this is a controlled added-load comparison on a shared host.


Reference validation, exit 0, verbatim:

```text
ref-check: ok — 525 LLP docs, 10107 refs in 32478 files, 0 errors, 0 unchecked
```

The final staged diff whitespace check passes (exit 0; no output). Its initial
formatting findings were CSV CRLF and trailing blank lines in verbatim logs.
The CSV uses LF; those logs are compressed losslessly to preserve their bytes.

**Failure ledger.** The initial browser smoke harness created new query operation
objects during each React render, causing "Maximum update depth exceeded".
This was a harness defect, fixed by stable operation descriptors; the failed log
is retained as `browser-smoke.log`, and `browser-smoke-fixed.log` passes. An
early Node-only exploration buffered long-poll bodies before the SDK, preventing
heartbeat delivery and causing artificial watchdog retries; it also held an
already-retired query until the 30-second attempt watchdog. Those controls were
corrected to forward chunks and hold the bounded replacement attempt. Their
initial `settlement.log` is retained and is not timing evidence. The corrected
four-case controls pass; no product timeout was changed.

The first loaded summary refused a missing commit trace, correctly detecting
the shared-binary replacement described above. That environmental custody
failure triggered the paired pinned reruns, not a fabricated commit timestamp.
Exploratory path lookups and one failed patch-context match changed no files and
are not product-check failures. Compiler dead-code warnings are retained in the
logs; they are not failed checks. Full-suite failure classification and the focused setup corrections follow its
verbatim final summary above. No failed check is excused by a passing rerun.

Unresolved: BN's original intermittent notification failure, the precise
calibration #29 missed UI/media observations, the original pre-workaround empty
frame, and the separate Following replay backlog. The new reproducible cases
and timing artifacts narrow the mechanism without declaring those tickets fixed.
