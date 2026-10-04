# Lane NZ — publish first, prove native execution in the background

Round 4 closes the publication/retention review races on **e7e325b7d1**. See
[Round 4](#round-4--publication-and-retention-races). NZ remains targeted at
0.4.14. The full Mac suite passed: **0 failures in 2,679 s**. Nothing pushed or published.

Round 3 addresses the two blocking review findings and records the accepted
60-minute activity bound. The final full Mac suite passed with **0 failures in 2,834 s**. See [Round 3](#round-3--review-corrections). NZ is intended
for 0.4.14; 0.4.13 excludes this lane. Nothing pushed or published.

Round 2 merges main **abafa9af9c**, preserving WD cleanup and NZ background
preparation. Warm plain/social exports returned in **3.75 / 4.91 s**, and their
background proofs passed at **120.82 / 143.81 s** from command start. The final
complete Mac suite passed with **0 failures in 2,706 s**. Native qualification
uses the audited NX 0.4.11 dependency fixtures with the merged native engine;
the separate published-0.4.12 audit-pin issue remains open. Nothing pushed.
See [Round 2 — integration](#round-2--integration) for all attempts and fixes.

Round 1 completed the requested as-is measurements: all 16 export samples,
24 client-pool runs and 25 native proofs passed. Five cold social background
preparations finished beyond the former 900-second limit. Background exports
returned in 3.07–4.64 seconds in the plain/social cold/warm cohort. Interference
was measurable: median 4.47% with cached proof and 0.53% during cold compilation.
The final full-suite rerun passed: **0 failures in 2,502 seconds**. Base WD commit `38d9bfe0de`,
branch `sb4-intent/nz-native-proof-zero-cost`. Nothing pushed.

The sections below through “Custody controls and evidence scope” are the retained
**round-0 record**. Their blocked/unqualified statements describe that round;
the [Round 1 section](#round-1--background-progress-budget-and-measurements-on-this-host)
records the subsequent deadline decision and measurements on October 3–4.

## Implemented behavior

`export:ios` atomically publishes the verified Hermes tree to `dist/`, transfers
its export lease to a detached background guardian, and returns. Native proof
uses an independent exact-export copy. A project lease serializes smokes through
cleanup; a newer publication supersedes old running/queued requests. The next
export, `doctor`, and `witness status [--wait] [--json]` expose the latest state.
A failed native proof never changes successful export status.

The guardian/driver retain shared kernel custody and monitor each other's death.
Darwin continuous-minus-awake time detects sleep and cancels proof on wake.
Background runs create and delete only their own recorded, leased simulator.
The existing NX/WD process identity, group watchdog and publication rules remain;
no simulator-name-only ownership inference is introduced. This retains §15's
Darwin PID/birth race and simultaneous-watchdog-loss residuals.

Darwin `taskpolicy -b -c background` wraps the detached process tree; its guardian
and driver verify their own background policy. Each app launched via CoreSimulator receives the same
background process policy, recording the setter’s success. Shared CoreSimulator services are outside
that inherited process tree. QoS is not an affinity or zero-interference guarantee.

## Host and timing admission

Only this Apartment mini is used. Its hardware reports **Apple M5 Pro, Mac17,16,
18 CPUs**, with 12 `M` cores (CPU IDs 0–11) and 6 `P` cores (12–17) in IORegistry;
`sysctl` names the levels Performance and Super, with no Efficiency level.
See [host.json](host.json). No other fleet host or X27R worktree is used.

Quiet samples require three checks, ten seconds apart: load1 <6, host idle ≥90%,
no unrelated cargo/rustc/xcodebuild, and no process above 30% CPU. A separate pause
file prevents timing during our own builds/tests. No timing sample has qualified:
an unrelated `PerfPowerServices` process has persistently consumed about 1–2 cores.
It has not been signalled. No qualified sample ran. After all our builds and smokes stopped, a final
five-minute admission window still failed. The watcher is now stopped; no
background measurement is left running. The user’s quiet-only rule and prohibition
on signalling unrelated processes prevent completing these measurements here.
[quiet-summary.json](quiet-summary.json) summarizes the retained admission history.

The [comparison builds](comparison-builds.json) bind both production binaries to the
same SQLite build flag and the baseline wrapper to WD’s exact commit.
The [measurement harness](measure.py) records command-return time, background
completion, publication/loaded hashes, all lifecycle outcomes, cache decisions,
before/after host state and process samples throughout each run. Cold means no
native snapshot, Pods or DerivedData; dependencies, CocoaPods download cache and
checksum-verified RN/Hermes downloads remain. Warm runs make distinct JS-only edits. The baseline may reuse its recorded
simulator across warm samples; background runs create and delete a private device
for each proof. Neither cohort resets the host’s system caches. Baseline and candidate
use the same restored NX 0.4.11 audited dependency fixtures. Current 0.4.12 audit
pin drift is separately recorded in the WD issue; no audit is bypassed.

[Apple's scheduling guidance](https://developer.apple.com/documentation/apple-silicon/tuning-your-code-s-performance-for-apple-silicon/)
says background QoS makes lower-performance placement more likely. It does not
promise exclusive placement. The optional [CPU probe](cpu-probe.c) samples its
own threads under the same taskpolicy; it is a host-specific policy control,
not a trace of every simulator-service thread.

## Verification

- Witness unit tests: 51 passed.
- Affected JavaScript tests: 66 passed, including 13 detached-custody controls.
- Full canonical Mac suite: first run ended `1 failure(s) in 2634 s`: two stale documentation
  assertions in its Rust stage. Its 6,052 client tests and 79 model tests passed,
  with five existing client skips. The final frozen-source rerun passed:
  `== 0 failure(s) in 2540 s`, all Rust targets, 6,053 client tests (five existing
  skips), nine fixture wrappers and 79 model tests. Invocation:
  `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash snapback4/scripts/test.sh`
  with the physical Node 24.18.0 directory first on PATH.
- Real native proof: plain starter passed all three segments with exact published/loaded
  hash agreement; its private device is absent. See [functional-proof.json](functional-proof.json).
  This pass preceded the final driver-policy self-readback and post-result retention
  warning change; those final changes passed the full suite and detached controls.
  A final-binary plain repeat correctly missed cache on the changed CLI toolchain,
  so it was explicitly cancelled through its birth-verified own guardian to clear
  the host for timing admission, rather than counted as a warm run.
  [functional-cancellation.json](functional-cancellation.json) records that intervention.
  It returned a failed/interrupted result and deleted its device. All eight
  functional-run devices are absent; see
  [functional-device-cleanup.json](functional-device-cleanup.json).
  Social starter’s first attempt hit the 900-second preparation deadline after 275 seconds
  of CocoaPods setup; its export succeeded and its private device was deleted. A
  prepared-dependency retry also reached the limit under load; its first cleanup
  command timed out, then the independent guardian recovered and deleted its device.
  A third retry after the full suite also hit 900 seconds while the unrelated
  host load persisted; its device is absent. All three attempts are in
  [functional-social-attempts.json](functional-social-attempts.json). Cold social
  completion under background QoS remains unqualified. No deadline was raised. Supersession cancelled the first plain build and
  deleted its device. The next cold setup attempt spent 630 seconds in CocoaPods,
  then hit the existing 900-second preparation limit. It reported failure without
  failing the export, and deleted its device. Neither attempt is a timing sample.
- Wasm: 2,047,735 bytes raw / 617,233 bytes gzip, below the unchanged 618,040 cap.

## Remaining qualification

No before/after cold or warm distributions, background completion-time cohort,
foreground interference result or CPU-placement distribution is claimed.
The requested measurement step is unfinished. [The round-0 follow-up](../../../issues/closed/20261003-snapback4-nz-quiet-native-proof-qualification.md)
records the exact remaining work; a quiet host is required. Once available, run
`measure.py before`, then `measure.py after`, then `interference.py` from this
report directory using Python 3, and update this report with every outcome.
The harness sets the `sb4-nz-` prefix, checks host load/compiler activity, retains
failed samples, and deletes only devices in its private ownership store.
If cold social proof still exceeds 900 seconds when quiet, investigate the
background preparation budget/scheduling before claiming it qualified.

## Development attempts retained

Initial background tests found an incorrect taskpolicy path (`/usr/bin` instead
of `/usr/sbin`); corrected. The simulator crash fixture did not model a created
device's inventory name and deletion; corrected without weakening ownership checks.
An error after guardian death now writes the terminal result directly instead of
leaving only the intermediate driver outcome.

The first functional run resolved Node 26 through Volta after native preparation
changed HOME, and download seeds were copied under the wrong isolated HOME.
The next run pins the physical Node 24.18.0 directory and places the same verified
archives under the actual isolated HOME. These are setup attempts, not timings.
A copied candidate executable was overwritten in place while running, causing a
subsequent launch to be killed by Darwin's code cache. Candidate replacement now
uses a fresh inode plus rename. The failed launch stays recorded; the next export
superseded the older proof through normal custody. No processes or devices from
other sessions were touched.

The first full-suite Rust pass found two documentation assertions still requiring
the synchronous wording. Starter and guide assertions now cover background proof
and status; isolated follow-ups pass (starter 1/1, complete guide 112/112). The
original full-suite failures remain recorded. No product assertion was weakened.

The first completed native build reached a real acquired app, then exposed a
false policy-readback failure. `setpriority` had succeeded; Darwin's
[`get_background_proc`](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_resource.c)
reads `current_task()` even when passed another PID, selecting the caller's
external flag rather than the target's. The app receipt now records the successful
setter; guardian self-readback remains valid. An owned external-child regression
covers this case. No app readback or affinity claim is made from that setter.

## Custody controls and evidence scope

The 13 new integration controls run the actual wrapper, CLI shim, detached guardian
and driver against owned fake host tools. They cover return while a tool is blocked;
next-export/doctor/status visibility; serialized supersession; driver SIGKILL;
guardian SIGKILL, SIGTERM and SIGHUP; observer interruption; native failure after
successful publication; retention failure after a terminal outcome; driver death
before create returns; driver and guardian death during boot; and opt-out cancellation.
Recorded fake-device mutations must target the exact created UUID. Existing NX
publication rollback and WD process-drain controls remain in the affected suite.

The sleep-clock unit test distinguishes suspended-time advancement from ordinary
clock progress. This lane did not deliberately sleep the shared Mac. A real host
sleep therefore remains unexercised here; cleanup on wake is covered by the clock
logic and the independently tested cancellation/custody paths. This is not a new
claim beyond the documented simultaneous-watchdog-loss and Darwin identity residuals.

Large receipts, exported bundles, logs and videos live outside git in
`~/sb4-np/evidence-archive/20261003-nz-native-proof-zero-cost/blobs/<sha256>`.
[evidence-index.json](evidence-index.json) binds paths, sizes and hashes;
[source-manifest.json](source-manifest.json) binds changed source bytes.
The report directory contains no files over 256 KiB, gzip archives or videos.
The full raw log includes expected refusal messages from negative tests; the
canonical suite footer and test summaries determine its verdict.


## Round 1 — background progress budget and measurements on this host

The user replaced round 0's quiet-only timing admission with interleaved ABBA
measurements on this mini as it is. `PerfPowerServices` and other unrelated
processes remain untouched. Round 0's attempts and limitations above are retained
as history; this section records the follow-up qualification.

Automatic background preparation now has a **900-second no-progress budget and
3,600-second hard cap**. Direct tool-log growth and actual phase transitions renew
the idle budget. Polling, mtime changes, unchanged/truncated logs, and guardian
output cannot renew it; an expired budget cannot be revived. CocoaPods and Xcode
stream their raw output while running. The Node helper independently enforces
the 60-minute hard cap, and guardian/driver overall custody allows 75 minutes.
Foreground `native:smoke` and explicit `witness ios --build` still use exactly
900 seconds. Stalls retain `E_WITNESS_BUILD` and the same leased process-group
cleanup. No supersession, status, doctor, publication, simulator ownership or
sleep rule is relaxed.

The [export harness](round1.py) predeclares ABBA for each plain/social × cold/warm
cell. A is WD's synchronous foreground wrapper/binary; B is the detached NZ
candidate. Each arm has its own project/native cache, with identical restored
NX 0.4.11 dependencies and pinned physical Node 24.18.0. Cold clears native
snapshot, Pods and DerivedData while preserving dependency/download caches;
warm makes a distinct JS-only edit after that arm's cold priming. Host and Metro
caches are not flushed. Each sample starts without a live simulator in this
harness's private ownership store; baseline's retained devices are deleted after
each sample, and background proofs delete their own. Thus warm means native-cache
reuse, not a prebooted simulator. Every attempt is retained, including failures.

The [interference harness](round1-interference.py) predeclares three ABBA blocks
of the same six-file client test pool at concurrency six: A without proof, B
with a newly exported social background proof. It records actual overlap and
waits for each proof's cleanup before proceeding. The analysis reports both
block B-mean/A-mean ratios and each B relative to linearly time-interpolated
bracketing A controls. Interleaving reduces drift; it does not remove arbitrary
ambient changes or establish zero contention. The additional
[cold-build interference harness](round1-cold-interference.py) uses three more
ABBA blocks. Each block has two consecutive B workload windows during one cold
social proof, beginning at actual Xcode compilation; its six B observations are
clustered in three independent native builds. Cold and cached-proof distributions
are reported separately. Host load, idle observations,
and top processes are recorded for every sample, with full PID/parent/CPU/command
name snapshots every two seconds archived by digest.

Round 1 source and production binary bindings are in
[the source manifest](round1/source-manifest.json) and [experiment plan](round1/plan.json).
The [analysis script](round1-summary.py) includes every retained sample. Large
artifacts continue to use the round-0 content-addressed archive outside git.

All **16 export samples passed** with published/loaded Hermes hash agreement.
Every cold sample missed native cache and every warm sample hit it. Each cell has
two samples per arm, in ABBA order; these are observed ranges, not population bounds.
Times include `npm run export:ios` startup and verified publication.

| Starter / cache | Foreground return, s | Background return, s | Background result available, s |
|---|---:|---:|---:|
| Plain cold | 154.52–167.63 | 3.07–3.90 | 485.70–595.07 |
| Plain warm | 42.02–44.39 | 3.10–3.66 | 102.05–108.12 |
| Social cold | 219.25–219.59 | 3.61–4.64 | 1,135.57–1,177.32 |
| Social warm | 51.93–53.95 | 3.89–4.36 | 125.60–128.24 |

Both cold social background runs completed preparation beyond the former limit:
**1,094.782 s** and **1,051.017 s**, with 120 and 121 recorded progress observations.
Xcode took 775.1 s and 766.5 s. Both passed prime/offline/restart and deleted their
owned simulator. The complete individual records are
[first cold social B](round1/r1-export-social-cold-1-B.json) and
[second cold social B](round1/r1-export-social-cold-2-B.json).

The three additional cold social proofs also passed all three segments, each
with a native-cache miss. Their preparation durations were **1,096.604 s,
1,438.464 s and 1,485.351 s**, with 118, 122 and 133 progress observations.
Exports returned in 3.59–3.83 s; proof plus cleanup/retention completed in
1,185.22–1,574.84 s. These runs included the foreground interference workload,
so they supplement rather than replace the export-only cohort above. Records:
[cold block 3](round1/r1-cold-proof-3.json),
[cold block 4](round1/r1-cold-proof-4.json),
[cold block 5](round1/r1-cold-proof-5.json).

All **24 client-pool runs passed 176/176 tests**. Each condition has three ABBA
blocks and six B workload observations. All nine concurrent native proofs passed;
the six cached proofs hit cache and the three cold builds missed. Every B workload
was covered by the background proof for essentially its whole duration (minimum
recorded overlap 99.9978%; wall-clock and monotonic timestamps differ slightly).
Each slowdown compares B with linearly time-interpolated bracketing A controls:

| Concurrent background work | Min | p10 | Median | Mean | p90 | Max |
|---|---:|---:|---:|---:|---:|---:|
| Cached social proof | +3.60% | +3.73% | **+4.47%** | +4.66% | +5.78% | +6.74% |
| Cold social compilation | −0.33% | −0.31% | **+0.53%** | +0.28% | +0.61% | +0.63% |

The alternative per-block B-mean/A-mean slowdowns are 4.34%, 4.08%, 5.50%
(cached) and 0.74%, −0.11%, −0.14% (cold). Six cold observations share three
builds and are not six independent native-build repetitions. Small negative
values reflect observed host/workload variation; they do not establish a speedup.
ABBA reduces drift, but the limited sample count and changing ambient load do not
establish a general zero-contention guarantee. The fixed pool includes server
and I/O work as well as CPU work; this is elapsed-time interference, not a pure
CPU-throughput microbenchmark. The [complete analysis](round1/summary.json)
retains all values, per-block results and per-sample ambient summaries.

Across export and workload sampling windows, load1 ranged 4.88–206.80; per-sample
median load1 ranged 5.00–94.65. `PerfPowerServices` CPU samples ranged 0–231.6%,
with per-sample medians 19.05–197.60%. Chrome, indexing and media analysis were
also present. No `cargo` or `rustc` process appeared in these timing windows.
Top processes and before/after idle observations are in each sample JSON; full
process lists every two seconds are retained by digest outside git. No sample
was rejected for load, and no unrelated process was signalled.

The first round-1 full suite found two guide-validation failures: the early
mention of the build diagnostic displaced its defining paragraph, and the new
generated deadline receipt was absent from the exact application-output list.
The correction preserves the defining paragraph and registers the real generated
filename; all 112 guide tests pass. The first run finished `== 1 failure(s) in 2501 s`: its sole failed stage
was these two guide assertions; 6,053 client tests passed with five existing
skips, nine fixture wrappers passed, and all 79 models passed. That run is
retained. The final complete rerun passed **`== 0 failure(s) in 2502 s`**: all
Rust targets, 76 witness integration tests, 112 guide tests, nine fixture wrappers,
6,053 client tests with five existing skips, and all 79 models. The invocation was
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash snapback4/scripts/test.sh`,
with physical Node 24.18.0 first on PATH. The [final suite record](round1/suite-followup.json)
binds its command, duration and exit status. The [post-measurement documentation amendment](round1/post-measurement-doc-fix.json)
binds both changed files. All measured runtime implementation bytes and the
production candidate remain unchanged; this amendment changes guide prose and
its publication-reference test only. Completed affected checks passed
**55 witness unit tests and 41 JavaScript tests**, including the detached custody
controls. The new controls check the exact foreground boundary, background
renewal and hard cap, stale/truncated output, live output past a scaled budget,
and stalled-child process-group cleanup. Helper fixtures check streamed CocoaPods/
Xcode logs and distinct foreground/background helper limits. Reference validation
passed: 527 LLP documents, 10,288 references, zero errors or unchecked references.

Before the measurement freeze, an initial Cargo invocation from the repository
root failed its unrelated Ibex precondition; the correct Snapback 4 workspace
invocation passed. A helper-fixture assertion initially included internal probes
without timeouts; it was corrected to check commands with finite timeout values.
Those setup logs are retained. No timing attempt was silently retried or discarded.

Real `witness status --wait` and `doctor` both exited 0 and printed the same latest
passing export `2996d982e58b4dbdb6701bffc5c95349d804750972ec05d1d0e5cde98a2190f3`
at `2026-10-04T07:05:50Z`, with prime/offline/restart and its receipt path.
[Command records](round1/status-doctor.json) and the final verification evidence
index retain those outputs. Subsequent-export summaries are also present in the
measured export logs, and the affected tests recheck supersession/status/failure
behavior from round 0.

The host-specific CPU probe observed 100% of background work samples on CPU IDs
0–11 (this mini's Performance tier), versus 5.66% under foreground policy; the
other foreground samples were on its Super tier, IDs 12–17. This host reports
no Efficiency tier. The probe follows the current
[XNU arm64 CPU-number layout](https://github.com/apple-oss-distributions/xnu/blob/main/libsyscall/os/tsd.h),
which is a private implementation detail. These are sampled probe-thread
placements, not residency-time measurements or a trace of every compiler/app/
simulator-service thread. The measured client-pool slowdown remains real despite
that placement. [Inputs](round1/placement-plan.json) and
[raw placement samples](round1/placement.json) bind the observation.


Round 1 cleanup is complete: all **25 recorded, tool-created simulators are
absent**, all **225 recorded process groups are empty**, and no candidate witness
job remains. These are read-only audits of recorded IDs; no other session's
simulator or process was mutated. See [device verification](round1/device-verification.json),
[group verification](round1/group-verification.json), and
[process verification](round1/process-verification.json). No office host, other
fleet machine or X27R worktree was used. The host was not deliberately slept;
round 0's tested sleep-clock/custody coverage and documented residuals remain.

[Verification evidence](round1/verification-evidence.json) binds the complete
failed and passing suite logs, affected tests, source/build attempts, doctor/status
outputs and binaries to the external archive. [Workload verification](round1/workload-verification.json)
checks each retained client-pool log's 176/176 result. All new evidence files stay
below 256 KB; raw logs, binaries, gzip files and videos remain outside git.
The round-0 qualification ticket is closed by these as-is results and the dated
background deadline decision. The separate 0.4.12 native-cache audit-pin issue
remains open; this report qualifies the declared audited NX 0.4.11 dependency
fixtures and does not bypass that audit. Nothing pushed or published.

## Round 2 — integration

Fetched origin and merged **`abafa9af9cd58e30a3b0dc6461cd4ab339c3cb83`** into
NZ's `1c589336fa6563a8c2efd578013fc735cd851133`, preserving both histories with
a merge commit. Main includes WD round 1 `fc4e323031` and QF, LU, QE2, RP, QF2
and NL. The only textual conflicts were the LLP 3000.030 revision header and
JOURNAL append tails. Both histories are retained; neither parent's JOURNAL
loses a line. The witness implementation, starters and guide merged without
textual conflicts. [Integration record](round2/integration.json).

WD's `cleanup.rs` and `process_group.rs` remain byte-identical to merged main.
Linux `/proc` inspection still parses bytes, excludes outside-group rows before
member validation, and fails closed for indeterminate membership. Cleanup still
uses five seconds without shrinking the group and a sixty-second cap, with
separate idle/hard-cap diagnostics. NZ's preparation clock remains independent:
automatic background preparation gets 900 seconds without observable output
progress and a 3,600-second cap; explicit foreground preparation stays at 900
seconds. Supersession, kernel custody, lease release after cleanup, status/doctor
lines and the background-first starter/guide instructions remain intact. These
Mac checks exercise the shared and Darwin code, not Linux-specific runtime paths.

The first two complete witness unit runs each passed 54 tests and failed the
same readiness assertion. The fixture printed “ready” before its first delayed
heartbeat, allowing prompt group cleanup to remove the child before the test
observed a write; its isolated rerun passed. A test-only readiness/release
handshake makes the child write first and holds its parent until the test checks
the held lease. The handshake has its own ten-second escape. It changes no
runtime cleanup or deadline. Both failed logs are retained. The final requested
build passed, followed by **55/55 witness tests** and **41/41 focused JavaScript
tests**, including detached publication, supersession, status, owner death,
failed-proof reporting and background preparation limits. They were repeated
successfully after the native audit update below.

The first integrated plain priming attempt returned export success in **4.42 s**,
then reported **`E_WITNESS_TIMEOUT`** after **640.13 s** because the app never
reached prime. Its screenshot shows account restoration; its simulator and
process groups were cleaned. A small reproduction identified the dependency
mismatch: the archived NX engine rejects main's new
`source-write-reservations-v1` schema capability with `E_SCHEMA_CAPABILITY`.
The same JavaScript client signs in with the merged process-device engine.
This failure is retained as [the initial sample](round2/r2-plain-prime.json),
not silently discarded or counted as a pass.

Rebuilt both iOS engine slices from the merged source using
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash scripts/build-xcframework.sh`.
At framework build time, core, device and the build script matched merged main.
The native fixtures remain
the declared NX 0.4.11 dependency trees with Expo 57.0.22, with only their engine
framework replaced. A complete inventory comparison for **each** fixture first
requires the original audited dependency/plugin hashes, then proves exactly
three changed files: the two static libraries and the framework plist. All
other dependency bytes and modes, including plugin and JavaScript code, are
unchanged. Added only those exact plugin-tree and dependency-snapshot pins;
no audit predicate was relaxed. [Audit and complete-inventory digests](round2/framework-audit.json),
[reproducible audit script](round2-native-audit.mjs), and
[framework evidence](round2/framework-evidence.json) bind this qualification.
The distinct published-0.4.12 audit-pin issue remains open.

Both starters were primed with the rebuilt engine before their JavaScript-only
warm sample. Measurements use the requested **dev/unoptimized CLI build**,
copied to a stable fresh inode, physical Node 24.18.0, a private ownership store,
and the `sb4-nz-` device prefix. They are integrated functional timings, not a
repeat of Round 1's production-binary ABBA experiment. No native build cache or
host cache was flushed. Every sample creates and deletes its own simulator.

| Starter / run | Export returns (s) | Background result, from command start (s) | Native cache hit | Result |
| --- | ---: | ---: | --- | --- |
| Plain / merged-engine prime | 4.25 | 551.38 | no | prime/offline/restart passed |
| Plain / warm | **3.75** | **120.82** | **yes** | prime/offline/restart passed |
| Social / merged-engine prime | 4.79 | 891.42 | no | prime/offline/restart passed |
| Social / warm | **4.91** | **143.81** | **yes** | prime/offline/restart passed |

The warm results arrived **117.07 s** and **138.90 s** after command return.
Both exported Hermes hashes exactly equal the loaded hashes. Plain preparation
was 473.646 s for priming and 37.214 s warm; social was 802.230 s and 44.501 s.
Each deadline receipt records the 900 s idle / 3,600 s hard limits without expiry.
Post-result guardian maintenance drained before the next sample and before the
full suite. [Plan](round2/measurement-plan.json), [harness](round2.py),
[all five attempts and ambient summaries](round2/summary.json).

Host observations cover every attempt: before/after load, idle percentage and
top processes, plus full process/load samples every two seconds. Warm plain
load1 ranged **13.31–79.34**, median **59.05**; warm social **13.82–120.77**,
median **66.06**. Their median `PerfPowerServices` use was **63.6%** and
**119.3%** CPU. Unrelated cargo/rustc processes also appeared during both warm
windows; no lane build or test was running then. These as-is samples were not
rejected or repeated for load, and unrelated processes were not signalled.
The new main inputs, dev profile and ambient load prevent treating this pair as
a controlled performance comparison with Round 1. Round 1's interference and
CPU-placement findings remain unchanged; no zero-contention claim is added.

Real `witness status --wait` and `doctor` exited zero for both starters and
reported their latest passing export, time, prime/offline/restart and receipt.
[Command outputs](round2/status-doctor.json) preserve the one-line evidence.
The next exports also printed the prior result, including the initial failure.

The first full-suite attempt exposed four additional integration/fixture issues:

- A short `deploy` could exit before the asynchronous diagnostic writer emitted
  its adoption estimate. `deploy` and `rollback` now use the existing bounded
  three-second drain **after** their operation and engine/deployment custody
  finish, on success or failure. A delayed-writer subprocess regression passes
  for both outcomes; all 15 timeline-adoption tests pass. Request/engine logging
  stays nonblocking. No drain was added to export or witness.
- The real-device `sb4-nz-` environment leaked into the fake simulator fixture,
  whose ownership records use `snapback4-smoke-`. The fixture now pins its mock
  prefix internally; explicit per-case overrides still work. The second full
  run exposed a separate build-command constructor with the same leak; both
  constructors now pin it. All five affected build cases and the late-scene
  receipt case pass under the real-device environment. The first run's
  blocked mock test was stopped by its exact owned PID and remains a failure,
  with [intervention](round2/interrupted-fixture.json) and
  [mock-directory cleanup](round2/stopped-fixture-cleanup.json) recorded.
- Four macOS published-0.2.33 capability controls expected pre-RP compiler
  output. Exact capability expectations now include source-reservation v1/v2;
  adoption baselines are built with the actual published old compiler. The
  historical capability-free fixture stays unchanged and is exercised by old
  native/WASM and current WASM devices. Current priced output must be rejected
  by old devices/engines. All **6/6** tests pass, with no skipped published
  witness, runtime change or weakened capability fence.
- A retained-history after-hook deleted its project before closing its watched
  server. The watcher recreated a file, producing `ENOTEMPTY`; the failed hook
  left the server/client alive after all 68 results. Cleanup now closes the
  client, stops/awaits the server, then removes its directory, preserving that
  order even on close errors. All **68/68** cases pass and the file exits.
  Only the identified leftover server and completed failed file process were
  stopped in the first attempt; the pool keeper retained group custody and
  the failed result is preserved. [Intervention](round2/retained-fixture-intervention.json).

The retained first full run finished in **2,940 s** with two failed stages
(Cargo tests and client tests), **6,200 client passes / 5 failures / 6 skips**, and
**79/79 models**. Its recorded interventions mean it is not a qualification pass.
The [first result](round2/full-suite.json) and separate
[second result](round2/full-suite-final.json) preserve their status and times.

The second full run found a separate local-network fixture dependency: its
wildcard-listener test selected an interface by connecting UDP to `192.0.2.1`,
which this Mac refused with `NetworkUnreachable`. The shared test
helper now enumerates up, non-loopback local IPv4 interfaces, preferring LAN
over point-to-point interfaces. Actual HTTP loopback/non-loopback refusal and
header assertions remain; no test is skipped, no outbound packet is needed,
and no network configuration or runtime code changed. The unit case and all
**19 latency / 20 token-live** integration cases pass with that helper.
[Source binding](round2/post-measurement-interface-fix.json).

The second attempt finished in **2,706 s**, with one failed stage (Cargo):
286 CLI-unit passes / one route-dependent failure / four ignores, and
71 witness-integration passes / five build-prefix failures. Its client pool
passed **6,205 tests with six existing skips**, and models passed **79/79**.
No process intervention was made in that attempt. All six failing cases passed
with the corresponding test-only corrections before the next complete run.

The final complete invocation of
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash snapback4/scripts/test.sh`
passed: **0 failures in 2,706 s**, with **287 CLI units / four existing
ignores**, **76/76 witness integration cases**, all other Rust targets and
workspace doctests, **9/9 fixture wrappers**, **6,205 client passes / six existing
skips**, and **79/79 models**. Builds, wasm/docs budgets, release guard and
package/app typechecks passed. This run used physical Node 24.18.0 and the same
SQLite flag and real-device prefix, with no process interventions or reduced
counts. [Final result](round2/full-suite-verified.json),
[parsed verification summary and skip reasons](round2/verification-summary.json).
The standalone requested witness and focused JavaScript checks also passed
55/55 and 41/41 respectively. Reference validation and diff-whitespace checks
passed.

All **five recorded Round 2 simulators are absent**, all **43 recorded process
groups are empty**, and no candidate witness worker remains. These audits use
only recorded ownership identities; no other session's simulator, process or
X27R worktree was changed. No other fleet machine was used. See
[device audit](round2/device-verification.json),
[group audit](round2/group-verification.json), and
[process audit](round2/process-verification.json).

The [final source manifest](round2/source-manifest-final.json) binds the tested
integrated witness implementation, guide, starters and LLP section; earlier
manifests preserve the fixture-handshake and framework-audit amendments.
Post-measurement bindings separately record the [release diagnostic fix](round2/post-measurement-release-fix.json),
[mock-prefix fix](round2/post-measurement-fixture-fix.json),
[capability-test reconciliation](round2/post-measurement-capability-fix.json),
[retained-history cleanup](round2/post-measurement-retained-cleanup-fix.json), and
[local-interface fixture](round2/post-measurement-interface-fix.json).
The measured stable binary predates these amendments. Only release-command
completion changed at runtime; witness/export and native engine semantics did
not change. The complete final suite qualifies the amended tree; no claim is
made that its whole CLI binary is byte-identical to the measured executable.
[Verification evidence](round2/verification-evidence.json) binds the logs and
binaries to the same external content-addressed archive as prior rounds. New NZ
report artifacts stay below 256 KB; raw logs, libraries, videos and inventories
remain outside git. Existing upstream artifacts imported by the merge are
preserved. Nothing pushed or published.


## Round 3 — review corrections

Date: 2026-10-04. Base is the completed Round 2 merge **a6af2febbb**, including
main **abafa9af9c** and WD round 1. Read the commissioned
[Astra review](round3/review-astra.md) and [Grok review](round3/review-grok.md)
from eb1000 with read-only SSH. No work ran there: implementation and tests
stay on this Apartment mini. The existing simulator/process restrictions stand.

**P1 retention: corrected.** Both guardian cleanup calls now run the entire
retention worker under the existing native supervisor and unreaped group anchor.
The worker and its compressor share that owned group. Kernel owner-death custody
therefore exists before the proof driver starts and after it exits; guardian
SIGKILL cannot strand the compressor. A nonblocking retention lock defers a
contender immediately. A 30-second total work budget, SIGTERM, supersession or
sleep detection requests cleanup, followed by WD's unchanged 5-second idle /
60-second hard group-drain budget. Retention cannot wait indefinitely while
holding the background lease. Already completed proof results remain unchanged
on maintenance failure. A killed owner can leave a small `.retention-*` custody
journal for inspection; it cannot leave a live compressor under the tested
single-death case. Existing simultaneous-watchdog-loss and kernel inspection
failure residuals still apply.

The regressions create six completed fixture runs, block the first compressor
and its TERM-resistant descendant, and exercise SIGTERM, SIGKILL and a newer
publication both before and after the proof driver. Every case checks that the
compressor, descendant, native keeper and background guardian exit, then that a
new proof obtains the lease. A second cleanup invocation checks nonblocking lock
deferral. A separate case exercises the real, unshortened 30-second deadline.
Final focused cancellation observations were **282/301/632 ms** before the driver
(SIGTERM/SIGKILL/supersession) and **290/297/471 ms** after it. The deadline case
drained at **29,501 ms after observing the compressor**, reflecting that its
30-second budget starts before compressor launch. These are fixture observations,
not new native-performance measurements. All seven final custody cases passed.

**P1 current publication: corrected.** Each background export carries a fresh
UUID generation and Hermes hash in `.snapback4-publication.json`, inside the
verified atomic publication inventory. Request and result records carry that
generation. `status` and `doctor` compare it with the current `dist/` publication
and actual bundle hash, re-reading the marker after the hash observation. An
older pass cannot establish the current export's result, even for identical
Hermes bytes. Missing/stale handoff reports **no proof for the current export**,
and `status --wait` returns nonzero. The opt-out/non-macOS path invalidates the old
marker before Expo mutates `dist/`, then marks a skipped generation independently
of `export-skipped`. If either handoff fails, the prior pass cannot reappear.
Successful exports continue to return zero; proof/status failures remain loud.

Failure injections preserve the old `latest.json` while making its atomic
replacement fail, for both changed and identical Hermes bytes. Both return a
successful export and unverified status/doctor output. Separate tests fail
`export-skipped` for opt-out and simulated non-macOS, again using identical bytes;
status is skipped/unverified, never passed. Removing the publication marker also
fails closed. The non-macOS case injects Node's platform inside a local fixture;
it is not Linux-host qualification. Existing supersession, observer interruption,
crash cleanup and recorded fake-simulator ownership controls still run.

**P2 activity versus progress: explicit accepted bound.** Chose the review's
permitted documentation alternative, retaining output activity as the signal.
CocoaPods/Xcode do not provide a stable semantic advancement protocol here;
distinct-line filtering still accepts changing timestamps/retry counters and
can reject legitimate quiet compilation. Repeated or heartbeat output may hold
the proof slot and private simulator until the 60-minute hard cap. The 900-second
idle budget detects silent stalls, not all semantic stalls. LLP 3000.030 §15
and `guide witness` now say this explicitly. Foreground preparation remains
exactly 900 seconds; its code and the deadline implementation are unchanged.

The guide also corrects the two review documentation nits: superseded results
are historical run records while status follows the current publication, and
native doctor output is informational (`status --wait` supplies the exit code).
LLP §15 now labels the old foreground-cost/opt-out advice as superseded history.
WD's `cleanup.rs` and `process_group.rs` remain byte-for-byte unchanged.

**Verification and attempts.** Build passed; final serial witness units passed
**55/55**. Other focused JavaScript tests passed **28/28**, and the four new
stale-status injections plus existing thirteen background controls passed.
All seven final retention controls passed. After expanding the scope to every
export test plus preparation controls, **58/58 tests passed together** in 177.2 s.
The final complete Mac suite passed with **0 failures in 2,834 s**
(2,834.2 s measured wall time). All Rust targets and doctests
passed, including 287 CLI units (four existing ignores) and 76 witness integration
cases. Fixture wrappers passed 9/9; all 312 client files passed, with **6,216 tests
passed and six existing skips**; the two full-count model files passed **79/79**.
Builds, budgets, release guard and typechecks passed. There were no interventions,
cancellations or reduced counts. The final source hashes still match the
pre-run manifest in `round3/full-suite-final-inputs.json`. Reference and whitespace
checks passed. `round3/verification-evidence.json` binds the retained logs and
`round3/custody-verification.json` records the final read-only custody inspection.

The first witness run had 53 passes and two fixture failures: publication pause
hooks are test-executable-only and were hidden by moving retention into a real
CLI subprocess. Those publication tests now invoke the retention worker body,
retaining their original swap/reconciliation assertions; integration tests cover
the real supervised entry. The first pruning test expected four blocking callers
to succeed; it now requires successful maintenance plus explicit busy-lock
deferral, preserving all 5-full/20-compressed assertions. Initial new retention
fixtures incorrectly waited for JSON that successful retention had compressed,
and read the deadline result before the guardian had written it. Teardown now
accepts the retention receipt, and deadline assertions wait for custody exit.
No product assertion was removed; no timeout was shortened for the deadline
regression. The first full suite then exposed an older publication-failure fixture
whose fake Expo output lacked metadata. It now supplies export metadata, then
blocks the latest-pointer handoff deliberately so successful publication still
exercises downstream scheduling failure without launching native tools. Its two
installed-shim/interruption/rollback cases passed separately and in the broader
58-test run. The first full attempt finished with one failed stage in **3,065.6 s**: all Rust
targets/doctests, fixtures and all 79 model cases passed; clients had 6,215 passes,
six existing skips and the one old-fixture failure. There were no interventions.
The original scoped input hashes matched, and the additional test-only amendment
is separately bound in `round3/publication-fixture-fix.json`. The first full
attempt and fresh complete rerun are both retained. Failed development logs remain in the evidence archive.

Round 3 does not repeat the Round 1 ABBA measurements or Round 2 real-native
qualification. Its simulator mutation controls use recorded fake devices; no real
simulator is created. Real host sleep remains unexercised; the existing arithmetic
and owner-death controls are retained. The published-0.4.12 dependency audit issue
remains outside this correction. No version bump or publication is made here;
the author's release target is 0.4.14. Large logs stay outside git, referenced by
hash in the Round 3 verification artifacts. Nothing pushed.


## Round 4 — publication and retention races

Date: 2026-10-04. Base **e7e325b7d1** already includes the Round 2 merge of
main abafa9af9c and WD round 1. This round implements every finding in the
operator's Astra/Grok review excerpts. All work and tests remain on this
Apartment mini. FX's `/private/tmp/sb4-fx-test-races.*` jobs and other sessions'
worktrees, processes and simulators are untouched. No real simulator is created.

**Astra P1; Grok 4 — atomic skipped publication.** Removed the direct-to-dist
skip path. Opt-out and non-macOS exports now use the same private export,
generation marker, cloned publication tree, leases, atomic exchange and complete
inventory verification as background exports. A marker-write failure returns
nonzero before touching the visible export. A successful skipped publication
always writes its skipped request/result under the publication lock, including
the first opt-out. Handoff failure remains downstream of commit: export returns
zero, while status and doctor refuse the previous generation's pass.

The deterministic regression starts a skipped export and pauses its private
preparation at the former invalidation boundary, publishes a concurrent
generation through the real wrapper/publisher, seeds its passing receipt, then
resumes the skipped export with equal Hermes bytes and changed assets. With an
injected skipped marker-write failure the skipped export fails and the concurrent
publication remains intact; no changed assets enter dist. With an injected
latest-handoff failure the skipped export succeeds, the changed assets and fresh
generation are visible, the old pointer remains, and both status and doctor
report no proof. This distinguishes publication failure from proof-reporting
failure. These seeded passes test reporting, not native runtime qualification.
The earlier changed/equal-byte handoff failures and simulated non-macOS case
remain. A first opt-out now reports an ordinary skip with no stale-handoff suffix.

**Astra P2 — no retention deletion under the publication lock.** Orphan
reconciliation validates intents and inode ownership, then renames the orphan
to `publication-orphan` inside its own run. It releases the destination lock
before recursively removing that tree. Original inode plus run/export leases
make interrupted deletion retryable. The regression pauses deletion, completes
a newer atomic publication while the deleter stays paused, kills only the owned
fixture deleter, and verifies that a later cleanup finishes its private tree.
Existing repeated-SIGKILL reconciliation controls still pass.

**Astra P3 — preparation bounds in every README.** Client package, Expo package,
plain generated starter and social generated starter READMEs now say 900 seconds
without output activity, at most 60 minutes total, and that activity alone does
not establish build progress. The accepted repeated-output bound is unchanged;
no repeated-line filtering was added. Guide witness and LLP 3000.030 §15 also
record the changed publication, observation and retention behavior.

**Grok 1–2 and retention test gaps.** The public `witness export-retain` now
uses the supervised, cancellable 30-second wrapper. The internal worker rejects
ordinary invocation unless it is the recorded native anchor's direct child in
its group with the recorded birth identity. Tests cover direct public-entry
cancellation and inner-entry refusal. Existing compressor tests now explicitly
assert that compressor and descendant PGIDs equal the recorded anchor.

Pre-driver and post-driver maintenance failures log deferral instead of failing
or rewriting native proof. Interrupt/supersession checks remain before driver
start. The exact SIGKILL-overlap test exposed a second maintenance call in driver
startup; background drivers now rely on their guardian's maintenance attempt,
while explicit foreground startup retains its existing cleanup path. The test
holds the old retention lock after guardian death, sees the new proof defer
maintenance and reach its tool, then releases the old keeper and verifies that
all old compressor/keeper processes exit. A separate real supervised compression
failure preserves a seeded **passed** terminal result, complementing the existing
skipped-result case.

The overlap barrier is test-only: a C interposer pauses one recorded native
watcher poll for at most 30 seconds. It is loaded into a private cloned CLI with
an added Mach-O load command and ad-hoc signature, because taskpolicy strips
DYLD environment injection. The test asserts existing header padding before
patching. No product binary, system tool or production hook is changed. Initial
SIGSTOP barriers were invalid on Darwin: orphan-group handling resumes stopped
keepers, so they did not preserve the intended overlap. A NOTE_EXIT-only barrier
also raced the control-pipe EOF; the final barrier pauses the live watcher before
owner death. Those failed fixture attempts are retained. This is a custody race
control, not timing or performance evidence.

**Grok 3 and 5 — consistent observation and commit time.** Status/doctor try a
shared publication lock; an in-progress exclusive publication reports pending.
A waiter therefore spans exchange, verification and handoff instead of reading
an older pass or returning 2 for a half-swap. Marker, actual hash, latest request
and result are checked together; both marker and latest pointer are re-read
before returning a terminal result. Changed observations retry for at most five
seconds; stable missing handoffs remain nonzero. Request `publishedAt` comes
from the verified commit, and the lock hides the latest-to-launch gap.

Deterministic tests hold publication before exchange and between exchange and
verify: an already polling `--wait` stays alive, doctor reports pending, and the
waiter eventually reports the new skipped generation rather than the old pass.
Another test changes latest.json after the hash observation and verifies rejection
and retry. An artificially old private marker proves the request uses the current
verified commit timestamp. The reporting snapshot is linearized under the shared
lock; it does not promise that no later export can supersede it.

The first full run finished in 2,705.4 s with all tests passing, but exited 1
because the client README was 301 physical lines against its 300-line budget.
Joining two adjacent prose lines preserved every word of the disclosure and
restored the budget; the docs gate passed. That failed full run and the
one-newline amendment are retained separately. The complete suite was rerun.

The second full run exposed an existing race in
`check_adoption::w8c_adoption_lock_failure_repeats_on_sweep_and_retries_without_another_save`.
The new generation query and doctor check both succeeded, but the immediate
assertion of the adoption log line failed. `diagnostic!` queues output to an
asynchronous writer; those successes do not flush its queue. The test now uses
its existing 35-second bounded `wait_adoption` helper before the unchanged log
assertion. No product behavior, assertion or deadline was weakened. The first
full run had passed this target 84/84. The second attempt finished with this
one failure in 3,140 s (3,139.7 s measured wall time); all 312 client files
(6,222 passed / six existing skips) and all 79 model cases passed. It retains its failure;
the test-only amendment occurred after that target finished. A supplemental
input audit records this newly changed file, which was not in the runner's
initial set of modified inputs. Affected replay and another complete
run qualify the final source.

The third full attempt passed all Rust targets, including the corrected check
suite (84/84), but its client pool exposed an unrelated expiry acceptance miss:
`ephemeral-e2e.test.mjs` trial 5 disappeared after **5,979.005 ms** against its
**4,500 ms** bound. Appearance was 3.024 ms and it sent two requests. The same
unchanged test passed all five trials in both earlier attempts. No timing bound
or assertion was changed. The cause is unestablished; the
[separate issue](../../../issues/20261004-snapback4-ephemeral-expiry-bound-intermittent.md)
retains the failure for investigation. An unchanged standalone replay after
the complete attempt passed all five trials in 62.1 s: expiry was
3,932.912–3,962.861 ms, first sight 3.897–39.473 ms, and every trial sent two
requests. The issue remains open; a later pass does not explain the failed
sample. Another complete run uses the same source and acceptance bounds.

The same third attempt also failed `release-activation.test.mjs` subtest 12:
the job was already **done** when the listener-message SIGSTOP attempted to
establish a **queued** crash cut. The other 17 cases passed. This unchanged
fixture passed in both earlier full runs; no release-serving code is changed
by NZ. A [separate crash-cut issue](../../../issues/20261004-snapback4-release-activation-crash-cut-race.md)
records the need for a controlled pre-first-chunk barrier. No assertion was
weakened to accept an already completed job. This complete attempt finished
with one failed stage in **2,855 s** (2,854.9 s measured): 310 client files
passed and two failed, with 6,220 passing tests / two failures / six existing
skips / no cancellations. All Rust targets and all 79 model cases passed.
Its recorded code/package inputs stayed unchanged.

**Verification.** Build passed. Final serial witness units passed **60/60** in
41.75 s. All export/preparation tests passed **64/64**, with no skips, in
189.3 s; starter tests passed **17/17**. The full Mac suite passed with
**0 failures in 2,679 s** (2,678.9 s measured wall time):
all Rust targets and doctests, including 292 CLI units (four existing ignores)
and 76 witness integration cases; fixture wrappers 9/9; all 312 client files,
with **6,222 passed / six existing skips / zero failed or cancelled**; both
full-count model files **79/79**. Builds, budgets, release guard and typechecks
passed. There were no interventions or reduced counts. Exact source hashes
match the pre-run manifest. Reference and whitespace checks passed. Final
read-only custody verification found no worktree CLI jobs or previously recorded
NZ devices. The tests created no real simulators.
Initial test edits had two Rust fixture call-arity errors and one JavaScript
parenthesis error; they were corrected before the final runs. The legacy opt-out
fixture assumed no CLI or artifact directory was needed. It now uses the real
CLI and valid private export metadata, verifies skipped atomic publication, and
checks that an Expo failure preserves the previous generation. No product
assertion was removed or test count reduced. The full suite runs on physical
Node 24.18.0 with the required SQLite flag and `sb4-nz-` prefix. Failed attempts,
passing logs, exact source hashes and final custody checks remain in `round4/`
and the content-addressed external evidence archive.

WD's group drain, scoped enumeration and both preparation deadline policies are
unchanged. No ABBA timing or real-native qualification is repeated here; previous
rounds retain those scopes and limitations. Real host sleep remains unexercised.
No release/version change or push is made; NZ is for 0.4.14, not 0.4.13.
