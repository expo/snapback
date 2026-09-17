# Snapback 4: warm blocking suite exceeds the 60-second budget

**Status:** Closed
**Priority:** P0
**Date:** 2026-09-13
**Systems:** `snapback4/scripts/test.sh`, the simulator and development loop
**Author:** Codex / GPT-6 Astra
**Resolution:** Fixed by `a44a8768e`: the complete current suite passes inside the unchanged 60-second budget with every assertion and cancellation guarantee retained.

At `2063884c8fd40c672158d4b4e3187864192db11c`, the full suite completed with
zero failed assertions in 72 seconds twice, including the publication
path's repeat from an already built checkout. The adopted rules budget is
60 seconds. This is a timing failure; correctness and installed-consumer
publication checks passed. The release was published through the existing
publication path, which refuses assertion failures and currently reports
elapsed time without enforcing the time budget.

Reproduce from `snapback4/` with Node 24.18.0 on PATH, Bun 1.3.12, Rust 1.97.0,
CARGO_BUILD_JOBS=4, installed frozen-lockfile dependencies, and
`bash scripts/test.sh`. Both observations were on the shared M5 Max Black
machine. Shared load may contribute; no causal attribution has been proved.

The publication run's 14-test simulator unit group took 28.15 s; fixture
wrapper tests took 5.99 s and client tests 14.52 s. The prior 0.1.14 publication
on this machine took 51 s overall, with the 14-test group 20.65 s. Main's
rusqlite 0.32 → 0.40.2 update is among the inputs that changed. The new HTTP
framing/version unit group took 0.01 s. Stage-level timing and an equivalent
current-main control are needed before blaming a particular change.

Evidence and the exact release pin are in
[the catalog record](../../benchmarks/runs/snapback4-public-catalog-20260913/README.md).
Detailed local logs are retained under
`.llp/ship-runs/sb4-performance-20260913/catalog-{final-suite,publish}.log`.

Follow-up on 2026-09-13: the borrowed-JSON/prepared-statement candidate passed
all assertions in 124 s, then 85 s warm. Stage timing of the warm run placed
26.2 s in Cargo tests and 35.6 s in launching the chat check, whose own compiler
timer reported 4.2 ms. Direct follow-up launches, including after Cargo tests,
took milliseconds and did not reproduce that delay. It remains intermittent
and unattributed; no macOS security settings were changed. Isolated simulator
runs of the SQL-statement substitution alone had variable wall/CPU time, so
that substitution is not claimed to resolve this ticket.

The next candidate shares one freshly parsed diagnostic snapshot across the
four fixed chat checks, preserving their order and watermark history. Ten
before/after fault and day-two scenarios produced identical trace digests,
trace lengths, final host states and reports. Timing and the complete-suite
budget still require qualification before closure. Retained evidence includes
`borrowed-cached-warm-suite-timing.json`, `sim-cache-comparison.json`, and
`chat-trace-{control,shared}.txt` in the same ignored run directory.

During qualification after the 0.1.16 version rebuild, another slow test
launch was sampled for one second. The process was at `_dyld_start + 0` in
all 893 samples, with a 96 KiB footprint and no loaded binary image list;
its application tests had not started. This narrows that observed pause to
process launch, without identifying the underlying macOS cause. The host
was M5 Max Black, macOS 26.6.2 (25G83), with load averages 42.39/31.39/23.10.
The sample is `shared-suite-sample-70679.txt` in the run directory.

That complete run finished with zero failed assertions in 676 s (675.06 s
on the stage timer): Cargo build 7.50 s, Cargo tests 610.11 s, and the chat
compiler launch 33.318 s. The simulator group itself took 8.54 s. This run
predates main's subsequent correctness fixes and the integrated vendor patch;
the sampled pre-main pause does not establish the cause of every delay.

After integrating those changes, Linux qualification on the Office M1 Max's
four-vCPU/12-GiB Colima VM passed all Rust tests and client assertions using
`TMPDIR=/tmp`. Its fifteen-test simulator group took 51.21 s. The script
reported 105 s and one failed stage because the copied source initially
lacked the shared root benchmark fixture pack. With that exact committed
pack copied, all nine fixture tests passed separately in 40.716 s. The React
browser lifetime group was skipped because Chromium is absent in the VM;
the native process-core test passed. These separate runs establish no
complete-suite budget pass.

The integrated Darwin publication suite at landed `d5215e6d2` subsequently
passed every stage in 112 s: all Rust groups, nine fixture tests and all
94 client tests, with no skips. The simulator's fifteen-test group took
10.24 s, fixture tests 6.377 s and client tests 10.559 s. At 55 s after the
first test executable launched, another one-second sample caught it at
`_dyld_start + 0` in all 93 samples, with a 96 KiB footprint and no binary
image list. It later ran successfully. This is further evidence of an
intermittent pre-main pause on this host, not an explanation for every
second of the run or a suite-budget pass. Evidence:
`production-016-publish.log`, `production-publish-processes.jsonl`, and
`production-suite-sample-3189.txt` in the same ignored run directory.

Resolution: restore the existing complete suite to the 60 s budget on an
appropriately idle documented host, without dropping correctness assertions,
raising the budget, or adding a gate. Record before/after step timings and
close this ticket once the warm repeated run fits.


## Resolution — 2026-09-13

The complete warm suite is within budget on an otherwise idle, documented
host, with every baseline assertion retained. The final integrated source is
`50c8edfdc844c0530e4d548bd8e7b7500a26331c`, based on `d5215e6d2` (0.1.16).

Profiling the original fault run put 2,001 of 2,258 samples under invariant
inspection. Concurrent implementation `4e126d206` shares one freshly parsed
snapshot among the four fixed chat checks and prepares repeated SQL statements.
Integration retains that scoped ChatChecks implementation, its comparison
regression, and an additional regression through a scheduled event boundary.
Every invariant, seed, event check and convergence assertion remains. The
simulator group fell from 28.35 s to 10.88/10.87 s on the controlled host.

The existing test script now prints each stage's duration and passes Cargo
`--no-fail-fast`. No new gate or budget is introduced. The native e2e test
also now verifies Bob's committed local replica before closing: an online
query can fall back to the server and is not a persistence barrier. Both waits
share the original 20 s deadline and the original cold/FIFO assertions remain.
Linux Chromium discovery enables the existing React browser assertions.

**Controlled before/after:** expo-build-1000, AMD EPYC 9454, 96 logical CPUs,
251 GiB RAM, Ubuntu Linux; Node 24.13.1, Bun 1.3.12, Rust 1.97.0,
CARGO_BUILD_JOBS=4, frozen dependencies. One suite lane; recorded one-minute load averages
were 0.90–2.73 around the warm comparisons. The control
is `d765f8179` plus only the same Linux browser-discovery adapter used in the
candidate, so the browser assertions run on both sides. These are actual
`bash scripts/test.sh` runs, timed externally with a monotonic clock; fractional
stage and total durations below are seconds.

| Stage | Before | Integrated warm 1 | Integrated warm 2 |
| --- | ---: | ---: | ---: |
| cargo build | 0.044 | 0.043 | 0.044 |
| cargo test | 36.217 | 18.756 | 18.745 |
| package typecheck | 1.013 | 0.994 | 1.008 |
| package build | 1.157 | 1.151 | 1.149 |
| chat app check | 0.007 | 0.008 | 0.008 |
| chat app typecheck | 1.014 | 1.007 | 1.036 |
| expo app typecheck | 0.765 | 0.772 | 0.752 |
| fixture wrapper tests | 10.869 | 10.966 | 10.844 |
| client tests | 10.525 | 10.540 | 10.688 |
| **Total** | **61.621** | **44.248** | **44.283** |

Every integrated run passes 127 Rust tests, 94 client tests and 9 fixture
tests, with zero failures or skipped tests, plus all package/web/Expo checks.
The version-change rebuild run also passed in 59.405 s. The two additional
Rust tests above the pre-integration candidate come from main's borrowed-wire
and shared-observation regressions; no prior tests were removed.

The provisional pre-integration candidate passed complete Mac runs in
39.379/44.583 s and controlled Linux runs in 44.720/44.818 s. Those are retained
as historical measurements, not substituted for the final integrated runs.
The shared Mac's original 88.409 s baseline included two client failures and a
load rise from 18.36 to 58.14; intermittent pre-main macOS launch pauses remain
host observations, not engine-runtime measurements.

Detailed logs, sampled stacks and monotonic stage JSON are retained under
`.llp/ship-runs/sb4-open-tickets-20260913/` (especially
`integrated-linux-*.log` and `integrated-linux-*-timing.json`); the remote
copy is under the same run name on expo-build-1000. Independent read-only
review reported no material findings for the integrated source. Reference
validation passed with 471 LLPs, 8,684 refs, zero errors and zero unchecked.

## Requalification after the 36-ticket repair — 2026-09-13

The enlarged suite again exceeded the budget: the exact `3d2007794` product tree passed all assertions in a controlled warm 64.04 s run. Changing only the existing runner to overlap independent Rust, fixture and client stages after their build prerequisites brought that tree to 34.34 s. Every child is waited, every failed stage is collected, and interrupt/failure statuses survive cleanup, including macOS Bash 3.2's empty-array behavior. No assertion was removed and the budget remains 60 s.

Final integrated checkpoint `669dc0c0188860f60c2a8a34f09882a101a8e4f0` passed two sequential warm runs on expo-build-1000 (AMD EPYC 9454, 96 logical CPUs, 251 GiB RAM): **36.70 s and 36.50 s**. Each passed 189 Rust tests, 9 fixture tests and 77 client tests, plus the package/web/Expo checks. One predeclared 8,192-write native throughput test remains ignored with its existing reason; it is not counted as a pass. Cargo tests took 34 s, fixtures 10 s and client tests 17 s, overlapped. Node 24.13.1, Bun 1.3.14, Rust/Cargo 1.97.0 and wasm-bindgen 0.2.127; tracked files stayed clean.

The local integrated run also passed every assertion in 54 s, including an 11 s wasm rebuild; its post-success cleanup warning led to the Bash correction included in both final Linux runs. Raw receipts live in `.llp/ship-runs/sb4-36-20260913/qualification/` and `/home/ccheever/lanes/sb4-36-20260913-verify-logs/`. Final raw-log SHA-256 values: `25142c96fd5fc2a6584491e2f9f2f552d9185d1ca39b5569db97e9417f882cce` and `dafc0e78456281b401793ef902d074a8b4312f73081c67c42d8ff1ef85ddfabc`.

Final security-integrated follow-up: `d8cdc6c81` passes the complete suite in
34.29 s warm on the same controlled Linux host and 56 s locally. Both runs
report 234 Rust, 9 fixture and 86 client passes, zero failures, and the same
one explicitly ignored debug-host throughput test. The clean Linux raw log
SHA-256 is `e654d70e889ab84ce61872d57f27e91dfbf41873482dee91580989655d84136b`;
the retained qualification receipt is
`linux-final-run-7-d8cdc6c81.receipt.json` under this run's ignored ledger.
This checkpoint also integrates main's independently qualified SQLite plan
reuse; no causal claim assigns the whole final timing change to the runner.

### Published repair qualification

The qualified publisher at landed `342c53d306d7484cd64e820ee27a151e02eb4b0b` reran the entire suite in 30 seconds: 236 Rust, 9 fixture and 89 client passes, zero failures and the same one declared ignored debug throughput test. Raw log SHA-256: `38f71d6c2d0e74f8d134c20e7da2bb88d1a6530f7f55849a048f0c12d68ca94a`. The resulting 0.2.6 package and 0.2.1 Expo artifact are published and registry-verified; no ceiling changed.


## Reopened — 2026-09-14: 0.2.11 warm suite takes 140 seconds

Owner: Codex performance lane (`llp-ship/sb4-performance-20260913/integration`).

The unchanged 0.2.11 source `13fdce76f7d6e881e070f0ad247b95f39fb0c0de`
passed the publisher's full suite in 161 s, then an unchanged repeat using
that completed build cache in **140 s**. Both passed 379 Rust, 132 client
and 9 fixture tests, with zero failures and one existing ignored Rust test.
The M4 Pro host has 12 CPUs and 24 GB RAM; the repeat's load averages were
2.71/2.47/2.44 before and 2.29/2.43/2.43 after. It used Node 24.21.0,
Rust 1.97.0, `CARGO_BUILD_JOBS=4`, `RUST_TEST_THREADS=1` and the packaged
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT` input. No limit or
assertion was changed. This is a reproduced current budget failure, not
an isolated attribution to a particular intervening commit.

The repeat reported Cargo tests 137 s, client tests 38 s and fixture tests
5 s; these branches overlap. Its thirteen-test group took 69.11 s. A
point observation of the recorded process group showed `page_admission`
using 100% CPU after 66 seconds. Source inspection then found a quadratic
deleted-row search in the shared `tests/common/write_observation.rs`
helper: every before-row scans the after-rows, including 10,000-row
privacy fixtures. Indexing typed row identities is a candidate repair;
its complete-suite qualification had not run at this observation.
The complete paired observations and original populations must remain.

Evidence under `.llp/ship-runs/sb4-performance-20260913/`: the repeat's
`warm-suite-reader-reuse-0211-v1-public/complete.json` SHA-256 is
`d01f08c42907f42cb1a77d106c0f3797f4aed5a3da2fea76bd10f7f56d9a6b62`,
and `warm-suite.log` is
`f93afe8004638d658ff293bd18c1d15512be29b93e9dc42e293db4d0a874155c`.
All 669 archived source files were checked before and after; the sole
expected archive difference is the already recorded publisher ledger row.
The owned group exited 0 and was observed absent; no scoped process or
cleanup failure remained. No new publication occurred. The mid-run process
snapshot and the original 161-second publisher log are retained separately.

## Partial repair — 2026-09-14: 140 to 96 seconds; budget remains open

The shared observation helper now indexes the after-image's typed row
identities once per table instead of rescanning every row for each deletion
check. Nominal IDs remain distinct from strings. The full before/after
states, first/retry bodies, receipt, all seven meter fields, changes,
effects, stream, snapshot and both device-store observations remain intact.
The 10,000-row privacy worlds and 8,192-probe boundary exercises are unchanged.
A focused assertion covers field changes, inserts, deletions, table isolation
and nominal-ID equality; it runs in four existing integration targets.

The isolated source passed the unchanged full suite twice on the same M4
Pro: **140 s first, 96 s warm**. Each run passed **383 Rust, 132 client and
9 fixture tests**, with zero failures and the same one ignored Rust test.
The first run includes rebuilding from a separate source directory; its
140-second result is not a warm comparison. Against the earlier unchanged
140-second warm baseline, the second run is **44 s / 31.4% shorter**.
These are consecutive observations sharing the target cache, not randomized
repeated trials or attribution of every saved second to this source change.

Warm Cargo time fell from 137 to 93 s; client time remained 38 s. The
page-admission group fell from 69.11 to 33.61 s, and the 34/35-test group
from 18.21 to 9.72 s. The unchanged 17-test group took 18.12 s. These
remaining slow groups need targeted profiling; **the P0 remains open**.
No ceiling, test population, blocking command or product runtime changed.

The seven verified public receipts/logs are retained under this run's
`write-observation-delta-0211-v2-public/`. Complete receipt SHA-256:
`5c6599162685ec508fce261be698b3660927472aa9c33d9db87a8bf80b3a7afe`;
warm log: `23a815b862f29eb604eb828dd178087927d8a782ee1dfe521c75a1cfbd9f47e4`.
All 669 archived source files matched before/after except the one exact
reviewed helper override; all owned groups exited zero and were observed
absent, with no cleanup failure. The unexecuted V1 helper's local archive
preflight refusal remains separate from these successful V2 test runs.


## Remaining setup cost — 2026-09-14: aggregate-presence scan

The performance lane ran all fourteen `page_admission` tests individually
on the same prepared M4 Pro and pinned 0.2.11 source plus the landed
observation-helper change. All fourteen passed. Their separate harness
durations total 32.83 s; the dominant case is
`w4_live_maintain_existence_walk_has_one_probe_with_zero_or_nine_thousand_expired_sources`
at **20.44 s**. The target-only Cargo build reported `fresh=false` and
produced a different debug artifact from the full workspace run. These
separate-process observations are not a new full-suite measurement.

A five-second stack sample, starting about 34 ms after that test's launch,
places all 3,667 worker observations inside `Engine::seed`. Of those,
3,393 (92.53%) are under `aggregate_source_present`; 2,317 are decoding
rows within its scan. These categories overlap and must not be summed.
The main thread's 3,667 waits are separate. The exact sampled test passed
in 20.24 s, and both the target and sampler exited zero with absent owned
process groups. That observer-affected time is not a speedup comparison;
the early sample establishes neither whole-test CPU shares nor product
request latency.

The source requests and eagerly decodes up to 256 rows to establish that
an expiring zero-sum group still has a physical source, then returns on
the first matching row. The core-owner follow-up is an exact-prefix or
first-witness lookup that avoids unnecessary materialization. Preserve
expired physical sources, typed keys, fallback indexes, last-source
deletion, post-upsert visibility, errors, meters and the complete paired
observations. Current main `206650f29` additionally applies
`schema::row_image` before comparing maintained keys; literal defaults
must remain effective. That current-source inspection does not relabel
the sampled 0.2.11 executable or prove a safe implementation. This
periphery lane has not changed the engine or reduced either privacy world.
The P0 stays open until the complete warm suite is qualified within budget.

Evidence in `.llp/ship-runs/sb4-performance-20260913/`:
`write-observation-slow-tests-profile-v1-public/` retains 33 files and the
fourteen exact passes; independent audit SHA-256
`801984a85d375a1118b27d2dd39956f6a7c4f1cc4cb77c7b23402e9304894e2f`.
`write-observation-maintain-sample-v2-public/` retains six files, including
sample SHA-256
`42371fd68600d2b2b9dbe989489462bf87f020878521a5112b11a7ffa35a3628`.
Its independent tree-accounting audit is
`0fc10522216e2722d4ce585ffaafe128a55990ccd102469be4b39444b1c080f0`.
All 669 source files were producer-checked before and after each diagnostic.
The review preserves an initial local calculator failure on zero-weight
wrapper frames and its accounting-only correction; no workload was rerun
for that correction. Root rehashed all fifteen sample-audit bindings.

## Final requalification after current-main reconciliation — 2026-09-17

Current main had already superseded the original quadratic deleted-row helper:
`fc76b6391` moved maintain observation to `maintains.rs` and indexes row
contributions before testing deletions. The stale candidate implementation was
therefore not replayed. The remaining failure was the enlarged current suite's
execution shape, not that old product helper.

Qualified code checkpoint `c4eb1047f9ac8ba3603fcb8bef76f6e71b010dd5`
keeps Cargo's complete, dynamically discovered test-artifact inventory while
building it once and running independent binaries through a bounded 24-process
pool. Four scale-heavy artifacts are further expanded from their own `--list`
inventory into exact-filter processes; newly added tests cannot fall outside a
hand-maintained target list. The lowering census is eight deterministic
ordinary tests whose union is the former ordered input map. Every golden
digest, enabled/disabled compiler comparison, admission record, execution
observation, R1p presence check, scale population and device-store assertion
remains. Doctests still run explicitly. The client runner similarly shards its
two dominant files by deterministic case index while direct invocation still
runs each complete file.

Two consecutive exact `bash scripts/test.sh` runs after rebasing onto
`45d315494` on expose-builder-pixel
(AMD EPYC 9454, 96 logical CPUs, 251 GiB RAM, Ubuntu kernel 6.8;
Node 24.13.1, Bun 1.3.14, Rust/Cargo 1.93.1) passed in **52 s and 50 s**.
They passed 1,293 Rust tests, all 9 fixture tests and all 554 client tests
(552 pass, 2 declared skips), plus the build, wasm, package, chat and Expo
checks. Four declared Rust measurements/throughput cases remained ignored and
were not counted as passes. Both runs reported zero failures; the Cargo,
fixture and client branches took 45/14/44 s and 43/12/42 s respectively and
overlapped inside the unchanged 60-second ceiling.

Raw log SHA-256 values are
`d5ca86f73bd0d06a9586f20ed26188270277361673a72f87ecc2b3206a282d86`
and `2d51f47502ced0c146e61c435ff357ada45d2af503a1cb0d9810f9e52447918a`
for `/tmp/sb4-delivery-20260917-rebased-{b,c}.log` on that host. No
assertion, population, blocking command or budget was removed or raised.

## Post-review correction and exact qualification — 2026-09-17

Cross-family review found that the first sharded form made the global R1p
presence check tautological and that its signal handler forwarded a signal but
could continue scheduling tests. Checkpoint
`a58c4c3af14f13d23f7c3fbc408c9de9d6bd3a11` restores a cheap unsharded
catalog test: every golden program must belong to a current source bundle and
every independently pinned R1p identity must exist in both the golden and the
source census. The eight expensive execution shards remain unchanged.

The Rust runner now tracks asynchronous `--list` children, records a list
failure without suppressing the remaining inventory or doctests, stops
scheduling after `SIGINT`/`SIGTERM`, and preserves exit 130/143. The shell
wrapper forwards cancellation through each logged worker and through all
client shards before waiting. A direct scoped runner probe exited 143 in one
second after `SIGTERM`, with no test child left in this worktree.

Two consecutive exact warm `bash scripts/test.sh` runs on the same controlled
Linux host passed in **50 s and 50 s**. Each run dynamically discovered 67 Rust
test binaries and ran 371 bounded executions: **1,294 passed, zero failed,
four declared ignored**. All 9 fixture tests and all 554 client tests also ran
(552 passed, two declared skips), with zero stage failures. Cargo, fixture and
client branches took 44/13/42 s in the second run and overlapped inside the
unchanged ceiling. Raw log SHA-256 values:
`ebfbe74b4b73d29981f6d15729205399bd00329d7e9a575b22735aa61bb9e09e`
and `2778bd2d2a75ce682d898be7f2971f83600cc0ae4a73f56b1a57e8ece970a6a2`.

The final delivery rebase onto `e2467031d` maps that semantic checkpoint to
`a44a8768e`. The intervening main commit adds benchmark probes, LLP text and
`snapback4/JOURNAL.md`; the qualified Cargo, crate, package and script inputs
are byte-identical to executed checkpoint `a58c4c3af`. No rerun is substituted
for the two exact 50-second observations above.
