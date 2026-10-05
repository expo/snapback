# Lane NZ — publish first, prove native execution in the background

Round 8 establishes bounded live-owner waits and ownerless repair on
**aa75cab431**. See [Round 8](#round-8--bounded-live-owner-waits-and-ownerless-repair).
The full Mac suite passed: **0 failures in 2,640 s**. NZ targets 0.4.14.
Nothing pushed.

Round 7 preserves deferred maintenance and backs off passively on **d488a5f7db**.
See [Round 7](#round-7--durable-deferral-and-passive-lock-backoff). The full Mac
suite passed: **0 failures in 2,617 s**. NZ remains for 0.4.14. Nothing pushed.

Round 6 pins publication evidence and coalesces retention on **f118e78bf2**.
See [Round 6](#round-6--publication-pins-and-coalesced-retention). The full Mac
suite passed: **0 failures in 2,614 s**. NZ remains for 0.4.14. Nothing pushed.

Round 5 fixes skipped-export retention on **7f0ef58712**. See
[Round 5](#round-5--bounded-retention-for-skipped-exports). NZ remains targeted
at 0.4.14. The full Mac suite passed: **0 failures in 2,706 s**. Nothing pushed or published.

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


## Round 5 — bounded retention for skipped exports

Date: 2026-10-04. Base **7f0ef58712**. This round addresses the operator's
Astra P2 and both Grok lows. All work and tests stay on this Apartment mini;
no other worktree, process or simulator is touched. No real simulator is created.
The operator supplied the review findings; no new independent review is claimed.

**Skipped-export maintenance.** After a skipped private-tree publication and
handoff, the atomic publisher releases its destination lock, then launches a
detached maintenance custodian at background QoS on macOS. The export does not
wait for retention work or its lock. Scheduling also occurs if the post-commit
skipped handoff failed; scheduling/maintenance failures cannot change a committed
export or its native outcome. Logs stay in the run's `background.log`.

The custodian inherits export custody, waits for the originating wrapper to exit,
and releases that lease before scanning. This ensures that a late old custodian
can prune its own run if it has moved outside the five full slots. Its worker
uses the existing native supervisor, retained anchor, kernel owner-death watcher
and WD group drain. The 30-second budget includes wrapper exit, retention-lock
wait and all maintenance work; SIGTERM and detected host sleep cancel it.
A busy skipped-export custodian waits inside that supervised group instead of
losing the last cleanup request. Every contender scans after acquiring the lock.
The existing proof-bound and explicit cleanup paths still defer immediately on
a busy lock. WD drain, scoped enumeration, simulator ownership, background proof
serialization and preparation deadlines are unchanged.

**Documentation and timestamps.** LLP 3000.030 §15's stale description of
invalidating and mutating `dist/` is replaced with private-tree atomic publication
followed by the skipped handoff. The dated Round 5 revision and guide witness
record skipped retention and its bounded lock wait. Both request modes now copy
`publication.json.verifiedAt` exactly into `publishedAt`.

**Regressions.** Each mode runs 28 actual wrapper/publisher transactions using a
fake Expo exporter: explicit opt-out and the simulated non-macOS wrapper branch.
Both finish with exactly **five full snapshots and twenty compressed runs**,
retaining the latest skipped result and compressed older receipts. Every export
has a recorded maintenance launch and exact verifiedAt timestamp. No simulator
tool runs. The first focused repetition took 7.41 s for opt-out and 6.30 s for
the non-macOS branch. These fake-export durations are regression diagnostics,
not replacements for the earlier real-native/ABBA measurements or Linux
qualification.

Three additional controls block a compressor with a TERM-ignoring descendant,
then require a newer export to return while that compressor remains blocked.
The export remains visible and skipped. Each compressor and descendant must
share the recorded anchor PGID. SIGTERM, guardian SIGKILL and the real 30-second
deadline all drain the owned group; the later custodian completes without an
extra export. Fixture teardown waits for recorded maintenance custodians before
removing their project. The five new tests passed without skips in 51.50 s.

**Verification.** Build passed; serial witness tests passed **60/60** in
41.85 s; complete export/preparation tests passed **69/69**, with no skips or
cancellations, in 223.88 s. The full Mac suite passed with **0 failures in
2,706 s** (2,706.01 s measured wall time). All Rust targets and
doctests passed, including 292 CLI units (four existing ignores) and 76 witness
integration cases. Fixture wrappers passed 9/9; all 312 client files passed,
with **6,227 tests passed / six existing skips / zero failures or cancellations**;
both full-count model files passed **79/79**. Builds, budgets, release guard and
typechecks passed. There were no interventions or reduced counts. All seven
recorded code/package hashes are unchanged. Reference and whitespace checks
passed. Final read-only custody checks found no remaining lane CLI jobs or
previously recorded NZ devices. Exact inputs, outcomes and host snapshots are
retained under `round5/`; large logs and binary evidence stay in the external
content-addressed archive. No gzip/video or new files over 256 KB are committed. No native timings
or real host-sleep exercise are added. Earlier rounds' qualification scopes and
open intermittent-test issues remain intact. Nothing pushed or published.


## Round 6 — publication pins and coalesced retention

Date: 2026-10-04. Base **f118e78bf2**. The operator supplied Astra's two P2s
and Grok's test gap; no new independent review is claimed. All implementation
and verification stays on this mini. No real simulator is created or other
worktree/device/process modified. NZ remains targeted at **0.4.14**.

**Current and pending evidence.** Retention prioritizes the current publication's
generation/hash within the full-evidence slots, plus either side of an unresolved
publication swap. It observes those identities under the nonblocking shared
publication lock, releases that lock before work, and rechecks while holding the
candidate's export lease before compressing or deleting. A busy publication lock
or candidate lease defers pruning and requests another scan. The start timestamp
still orders unpinned history; it cannot evict the current generation. Active
exports retain their leases. The five-full/twenty-compressed bound is the
quiescent bound; outstanding leases and unresolved publication custody can
require additional evidence until they finish.

**Coalesced maintenance.** A committed skipped export sets one durable dirty bit
outside the publication lock and returns. All later requests coalesce into that
slot; the eventual sweep sees the current project state. Separate leases permit
one active maintenance custodian and one pending observer. A busy request records
pending and exits without launching another custodian. The single observer has
no native child while waiting; it probes the leases nonblockingly at background
QoS, then claims the request and starts the existing supervised 30-second worker.
This replaces round 5's per-export custodian and blocking lock wait. The pending
slot needs no work budget: it is one passive observer, not an accumulating queue
of native groups. The actual worker retains the unchanged owner-death watcher,
anchor, cancellation and WD drain. If its lock probe races another worker, it
requeues. A later request's observer survives an active custodian's death and
can restore the bound after that worker releases custody. Signals/sleep stop a
pending observer; its unclaimed request remains durable for the next schedule
attempt. Root queue records and `maintenance.log` survive historical-run pruning.
Proof-bound scans also arrange an observer for deferred pruning. No retention
wait is added to publication or status, and maintenance never rewrites a proof.

**Deterministic controls.** Three new wrapper/publisher tests pause the first
export in its private tree, publish eight newer-started exports, then let the
first export publish last. Opt-out, simulated non-macOS, and background modes
all retain that generation's uncompressed request/result and report its actual
skip through status and doctor. The background case additionally sweeps while
proof is pending. A Rust control pins both current and rollback-side generations,
then shows the old generation becoming eligible once superseded.

Two new tests hold the retention lock across 28 real wrapper transactions, one
per skip mode. Every export returns while the lock remains held. Each sample
requires exactly one pending maintenance process, the same observer PID, and no
native retention group. Releasing the lock, without another export, must restore
exactly five full and twenty compressed runs and retain the latest evidence.
The SIGTERM, SIGKILL and 30-second-deadline tests now start with 28 full fixture
export trees, explicitly exceed the bound while gzip is blocked, and require the
later custodian to restore exactly 5/20 with compressed result receipts. Both
compressor and TERM-ignoring child must belong to the recorded anchor PGID.
Teardown drains root queue owners as well as individual proof custodians.
These are Mac integration tests with fake exporters/host tools, including a
simulated non-macOS wrapper branch; they do not add Linux or real-native timing
qualification. The earlier ABBA measurements and native evidence retain their
original scopes. Real host sleep remains unexercised.

**Verification.** Build passed. Serial witness tests passed **61/61** in
38.20 s; complete export/preparation tests passed **74/74** in 268.30 s, with
no failures, skips or cancellations. The deadline assertion was refined to time
the blocked group's drain separately from the later custodian's restoration;
its final form passed a separate 33.74 s run. The full suite then exercised the
final input hashes, including every new regression, and passed with **0 failures
in 2,614 s** (2,613.18 s measured wall time).

All Rust targets and doctests passed, including **293 CLI units** (four existing
ignores) and **76 witness integrations**. Nine fixture wrappers passed. All
**312 client files** passed: **6,232 passed / six existing skips / zero failures
or cancellations**. Both full-count model files passed **79/79**. Builds, budgets,
release guard and typechecks passed. No intervention or reduced counts occurred.
All four recorded code/guide input hashes remained unchanged. Reference and
whitespace checks passed. Final read-only custody verification found no lane CLI
jobs or interposed fixture CLIs; previously recorded NZ devices remain absent.
No real devices were created. Exact outcomes, source hashes, process-count samples
and custody checks are in `round6/`; large logs and the binary are retained in the
external content-addressed archive. No gzip/video or new files over 256 KB are
committed. Earlier qualification scopes and open intermittent-test issues remain
intact. Nothing pushed or published.


## Round 7 — durable deferral and passive lock backoff

Date: 2026-10-04. Base **d488a5f7db**. This addresses the operator's Astra P2
and Grok Low. The supplied findings are the review input; no new independent
review is claimed. All work stays on this mini. No real simulators are created.

**Deferred discovery.** Every skipped discovery now sets the durable pending
request, including unfinished leased exports, still-live owners, busy leases
and unresolved publication reconciliation. The explicit completed-run recovery
path does so too. A worker that claims a request and then encounters a deferred
run cannot finish with that work silently absent from the backlog. Errors retain
a durable request; a persistent maintenance failure parks for a later request,
while an already queued observer can cover a newer publication after custody
is released. Proof results and already committed exports are unchanged.

**Passive readiness.** Before claiming work, the one pending observer probes the
publication lock, per-run/export leases and recorded live owners at the existing
100 ms interval. Each probe is released immediately. Busy publication or export
custody causes a passive wait with no native worker launch. A lease acquired after
the probes is handled by the worker's deferred-work request. Unknown unfinished
legacy custody stays pending for repair. Maintenance can wait until active
exports finish; the 5/20 bound remains quiescent. This replaces round 6's repeated
worker launches against a held publication lock. Maintenance attempt numbers in
the active record make worker-start counts inspectable.

Every committed automatic publication requests coalesced maintenance after the
publication lock is released, including background-mode failed handoffs. This
covers the case where no native guardian starts to perform its normal cleanup.
The native supervisor, retained anchor, owner-death watcher, 30-second worker
budget, WD drain, publication pins and preparation deadlines remain unchanged.
LLP 3000.030 §15 and the witness guide have corresponding revisions.

**Deterministic controls.** For each of opt-out, simulated non-macOS and background
mode, five exports establish history, then ten more verified publications fail
the latest-status handoff. A fixture preloader pauses each real wrapper immediately
before closing its actual export lease. Discovery is also forced through the
supervised cleanup command while those leases remain held, covering the race
between readiness probing and discovery. All fifteen full trees stay pending;
the same observer waits without new worker attempts. After releasing the wrappers,
without another export, retention restores exactly five full plus ten compressed
runs. The current generation remains full, and status/doctor still report no
proof for the failed current handoff. A Rust unit control proves discovery
reasserts the request, then clears it only after the lease is released and the
previously unfinished history is processed.

The publication-lock control queues fifteen skipped exports under a held
retention lock, then holds publication and releases retention. Over 2.2 seconds
it observes the same pending observer, zero worker attempts and no native
retention group. Releasing publication triggers exactly one scan and restores
5/10. The four new integration controls passed in 27.07 s. The earlier reversed-
publication test now expects pending maintenance while its early export remains
leased; it still checks final pruning and current-proof preservation. Fixture
teardown permits a parked pending request only after all recorded custodians
have exited; ordinary retention assertions still require the queue to drain.
These are fake-export/host-tool controls on macOS, not Linux or real-native
qualification. Earlier timing, native and host-sleep limitations remain intact.

A fifth control verifies persistent compressor failure leaves a pending request
without repeated work attempts; after repair, a later export resumes maintenance
and restores the bound. It passed in 4.44 s. The initial combined export run
exposed one fixture teardown race (ENOTEMPTY): successful background publication
now starts maintenance after a failed handoff, while export-failure.test.mjs
removed its project immediately. The fixture now waits for its recorded queue
owners before every reset and final deletion. Both cases in that file passed in
7.02 s; no publication assertion was relaxed. The original failure log is retained.

**Verification.** Build and serial witness tests passed **62/62** in 38.47 s.
The combined export/preparation run passed 77 of 78 cases before the fixture
teardown repair described above; its two repaired cases and the fifth new control
passed separately. The full suite then exercised all **79 final affected cases**
and passed with **0 failures in 2,617 s** (2,616.94 s measured wall time).

All Rust targets and doctests passed, including **294 CLI units** (four existing
ignores) and **76 witness integrations**. Nine fixture wrappers passed. All
**312 client files** passed: **6,237 passed / six existing skips / zero failures
or cancellations**. Both full-count model files passed **79/79**. Builds, budgets,
release guard and typechecks passed. No intervention or reduced counts occurred.
All six recorded code/guide input hashes remained unchanged. Reference and
whitespace checks passed. Final read-only custody verification found no lane CLI
jobs or interposed fixture CLIs; previously recorded NZ devices remain absent.
No real devices were created, and no other worktree, process or simulator was
modified. Outcomes, source hashes, samples and custody checks are in `round7/`;
large logs (including the initial fixture failure) and the binary stay in the
external content-addressed archive. No gzip/video or new files over 256 KB are
committed. Earlier qualification scopes and intermittent-test issues remain
intact. NZ remains for 0.4.14. Nothing pushed or published.


## Round 8 — bounded live-owner waits and ownerless repair

Date: 2026-10-04. Base **aa75cab431**. This addresses the operator's Astra P2
and Grok Medium under one invariant: **every retention wait is on a live owner
and is bounded; every ownerless state is repaired; retention never spins and
never waits forever.** The operator's supplied review findings are the input;
no new independent review is claimed. Work and verification stay on this mini.
NZ remains for 0.4.14. No real simulators are needed.

**State classification.** A held kernel lease or a birth-matched live journal
owner can cause passive waiting. An unfinished directory or transaction marker
cannot. The single observer keeps the request pending while probing live custody
at 100 ms. Its launch gate, passive waits and follow-up observer chain share one
60-minute expiry; successors inherit that expiry. Each observer also checks its
monotonic elapsed time and host sleep. Expiry exits loudly with a durable pending
request for a later export. Native work still has its separate 30-second deadline
and unchanged WD group drain. Unrecoverable inode conflicts or I/O failures park
with diagnostics instead of repeated work; repair never guesses ownership.

**Transaction recovery.** Retention holds the candidate run/export leases and
tries the publication lease nonblockingly. Matching destination/run intents now
invoke the existing namespace recovery: an unverified exchange rolls back and a
verified commit stays committed. A committed displaced tree is renamed into
private custody; all recursive deletion occurs after releasing publication.
The run marker survives until deletion completes, so interrupted cleanup can be
repeated. A later publisher uses the same namespace repair and leaves private
deletion to retention. No later publication is needed to resolve abandoned
transactions when maintenance is already pending.

**Ownerless runs and initialization.** Failed lease acquisition is inside the
wrapper's try/finally and removes only a directory created by that invocation.
A short initialization lease protects directory creation through export-lease
acquisition and journalling. A stuck initializer is refused after five seconds.
Retention probes that lease passively; for a bare run it claims both per-run
leases and rereads the journal before releasing initialization custody. Recovery
and deletion run after that release. This closes the mkdir-to-lease race without
holding initialization over recursive maintenance. Ownerless current evidence
stays full with a recovered completion marker. Other empty/partial shells are
removed and excluded from keep slots. A busy publication lease is distinct from
a pinned generation: it defers classification without making an empty shell a
completed run. No process or simulator ownership is inferred from the numeric
name. Legacy compressed receipts count as completed; a terminal marker is persisted before compressing their original terminal receipt.

**Deterministic controls.** Before- and after-exchange barriers hold a real
publisher with 28 actual exports queued. While the publisher lives, retention
starts no worker. Killing only that fixture publisher and allowing its wrapper
to exit triggers exactly one repair/prune worker, with no later export, and
restores five full plus twenty compressed runs. A Rust control kills a verified
publisher and then its private-tree deleter; another sweep preserves the committed
export and completes deletion, both with and without a previous destination.

For opt-out, simulated non-macOS and background modes, a failing binary and a
selectively failing export-lease helper leave no shell. Ten seeded bare/partial
legacy directories are then repaired in one scan. Removing the current run's
journal and local handoff metadata additionally checks generation pinning through
its immutable export marker: that evidence remains full. Every mode returns to
5/20. Passive-owner and withheld-launch-gate controls exercise an earlier internal
expiry without an environment override that could enlarge production bounds.
A Rust control also holds initialization and publication leases over an ownerless
shell, checks that it stays unfinished/pending, then requires removal after release.
A real stuck-initializer control exercises the five-second refusal; another
pauses a wrapper after mkdir, before lease acquisition, while pending maintenance
must remain passive, then permits successful publication and 5/20 restoration.

**Corrections during qualification.** The first combined run found the startup
race fixed by the initialization lease, a legacy compressed-receipt classification
gap, and an ambiguous post-driver retention fixture. The fixture had allowed the
automatic observer to race the post-driver custodian, then selected the first
native journal. It now holds the automatic maintenance lease until the intended
proof guardian's compressor and group drain finish; all PGID and cancellation
assertions remain. The legacy active-run fixture now holds a real export lease,
then checks ownerless repair after release. Initial logs are retained, not counted
as final qualification. The earlier rounds' native/ABBA, Linux and host-sleep
qualification limits remain unchanged; these new controls use fake exporters and
host tools on macOS.

A final discovery-race control covers a failed initializer removing its directory
after enumeration. A vanished entry is treated as already covered, not an I/O
failure that parks unrelated maintenance. The first full-suite attempt was
cancelled through its own shell's cleanup at 420.15 s to include this correction;
its record and log remain separate. Only the final successful complete run qualifies.

The next full run finished in 2,637.43 s with one browser-fixture failure in
`per-row-react`: its terminal-refusal case lost the execution context during navigation. That fixture
was unchanged from the base. Twenty isolated diagnostic runs did not reproduce
the spontaneous navigation. Sending a real Vite full-reload message at the same
held-notification boundary did reproduce the exact error; disabling HMR passed
that control. This establishes the reload vulnerability, not the uninstrumented
original event's precise cause. The immutable fixture now disables HMR and file
watching, as neighboring browser fixtures already do. All seven original cases
and all their assertions remain, and pass in 13.56 s. The failed suite and both
sides of the reload control are retained. `round8-react-reload.py` records the
reproduction. A fresh complete suite qualifies the final fixture and native code.

**Verification.** Build passed. The complete export/preparation rerun passed
**88/88** in 381.50 s, with no failures, skips or cancellations. The final liveness
classification was covered by **65/65 serial witness tests** in 41.43 s and the
three ownerless-mode controls in 25.00 s. The full suite then exercised all final
inputs, including every earlier regression and the nine new JavaScript controls,
and passed with **0 failures in 2,640 s** (2,639.90 s measured wall time).
The qualifying [run record](./round8/full-suite-final.json) and
[ten-input manifest](./round8/full-suite-final-inputs.json) are separate from the
two earlier attempts.

All Rust targets and doctests passed, including **297 CLI units** (four existing
ignores) and **76 witness integrations**. Nine fixture wrappers passed. All
**312 client files** passed: **6,246 passed / six existing skips / zero failures
or cancellations**. Both full-count model files passed **79/79**. Builds, budgets,
release guard and typechecks passed. No intervention or reduced counts occurred.
All ten recorded code/guide input hashes remained unchanged. Reference and
whitespace checks passed. Final read-only custody checks found no lane CLI or
interposed fixture jobs and confirmed the previously recorded NZ devices absent.
No real devices were created; other worktrees, processes and simulators were
untouched. Outcomes, hashes, samples and custody records are in `round8/`.
Large logs, including the initial failures, and the tested binary stay in the
external content-addressed archive. No gzip/video or new files over 256 KB are
committed. Earlier qualification limits and intermittent-test issues remain.
NZ targets 0.4.14. Nothing pushed or published.


## Round 9 — crash-safe claims and retention state audit

2026-10-04, based on `7e03a5cea9`. This round implements the operator's supplied
Astra/Grok findings. No additional independent review, new native timing, Linux
qualification or physical host-sleep experiment is claimed. NZ targets 0.4.14.

A request is claimed by atomic rename, not deletion. The claim survives until a
successful scan acknowledges it. A separate pending observer survives a killed
scan custodian; the existing native watchdog drains the compressor and the
observer resumes after custody releases. If the observer dies during a scan, the
custodian detects its recorded identity's death, drains and resumes observation.
The scan claims only after both peers exist. Success removes only the claim;
newer requests and deferred discoveries remain separate. Interrupted attempts
have a durable three-attempt cap, while known work failures park without a loop.
All successor observers inherit the original 60-minute observation expiry.

Failed Expo wrappers remove their private attempt under their own export lease.
Discovery repairs old journal-only attempts using actual process birth/liveness,
owned-child recovery, both run/export leases and publication pins. It excludes
shells even when previous recovery wrote a completion marker. Completed failure
receipts, published history and partially compressed receipts remain evidence.
Readiness now probes the exclusive publication lease needed by reconciliation.
The audit also separated actual lock contention from I/O failures, protected the
partially written dirty-bit/claim race, and replaced the custodian's potentially
blocking process wait with bounded polling.

### State and transition audit

The invariant is: **every wait is on live custody and bounded; every recoverable
ownerless state is repaired; nothing spins; no claimed request is lost.** A loud
parked error is a durable refusal, not successful maintenance or an indefinite
wait. The audit covered scheduling, both peers, native custody, discovery,
namespace repair and retention—not only the three reported interleavings.

| State / transition | Ownership, bound and outcome |
| --- | --- |
| No work → pending | Publication requests maintenance only after releasing its lock. `create_new` coalesces all producers into one dirty bit. No scan or compression enters export's wait. |
| Pending → observer launch | `maintenance-next.lock` admits one observer. The fork-inherited descriptor closes the parent/child lease gap. The stdin gate and passive observations share the absolute 60-minute expiry, monotonic check and sleep guard. Spawn/gate failure leaves durable work and a diagnostic. |
| Dirty bit visible before its JSON write | Atomic rename authorizes a fresh claim by its name. A producer's old descriptor cannot overwrite the atomically replaced claim; the claim test exercises this boundary. |
| Pending → passive wait | Probe initialization, maintenance, retention, **exclusive** publication and run/export leases; inspect birth-matched owner/wrapper identities. Only an actual live holder/identity delays a scan. Poll at 100 ms; never create native groups while held; expire within the original observation budget. |
| Directory disappears after enumeration | Treat absence as already repaired, without recreating it. A malformed lock in a surviving directory fails explicitly. |
| Ready → scan launch | Observer retains its pending lease and passes the active lease to a separate direct child. The child validates root and inherited inode before claiming. A death before claim leaves pending work and the other live peer. |
| Scan launch → claimed | Rename pending to claimed under the active lease. Resume a surviving claim if no newer request exists. Claim is never deleted before native work. Three interrupted attempts are persisted; repeated failed starts are also capped. |
| Claimed → native work | Existing native supervisor, unreaped group anchor and kernel owner-death watcher own the worker and gzip descendants. Work deadline is 30 s, with cancellation/sleep checks; unchanged WD drain is 5 s idle / 60 s hard. |
| Observer waits for scan | Poll only its unreaped direct child. Signal cancellation to that child, not discovered PIDs. At 100 s force its exit; after another 5 s fail explicitly with claim preserved. No blocking `wait()` remains in this path. |
| Live lock acquired after readiness | Worker records deferred work; a raced retention lock refusal requeues. Observer sleeps/probes before another scan. Actual WouldBlock is separated from I/O errors. A durably handled busy outcome returns a healthy internal-custodian exit; it must not consume the failed-start budget. Four forced raced refusals preserve observation and restore 5/20 after release. Shared-holder and exclusive-holder tests show zero native starts while held. |
| Ownerless publication transaction | Existing matching inode/intents recovery rolls back an unverified exchange or preserves a verified commit. Reconcile under exclusive destination and run/export custody. Detach old tree under the lock, delete privately after release. Conflicting identities park; no ownerless marker causes a respawn chain. |
| Unfinished run with live owner | Birth identity or kernel lease causes deferred pending work. The observer waits passively within the same expiry. Journal presence alone never establishes liveness. |
| Ownerless unfinished or journal-only shell | Drain only recorded owned children/simulators using existing recovery, acquire per-run custody, recheck liveness and publication pins, then remove/exclude empty or partial failed attempts. Current/pending publication evidence stays full. No directory-name PID authorizes signalling. |
| Failed Expo command | Wrapper's finally removes its own uncommitted attempt before closing its export lease. Failed lease initialization also removes the attempt. Legacy dead journals are repaired by the scan. |
| Dead-custodian native journal | Kernel custody drains the owned group; the surviving peer resumes the durable claim. A small `.retention-*` diagnostic journal may remain after SIGKILL. It is not a work request, a live owner, or one of the retained proof slots; its presence never delays observation. |
| Completed / partially compressed history | Completed native result or preparation diagnostic, publication receipt, compressed receipt and retention marker are history. Pin current/pending generations before start ordering; recheck pins while holding export custody before compression/deletion. Empty completion markers without evidence do not occupy keep slots. |
| Work succeeds → acknowledgement | Remove only `maintenance-claimed.json`, after native drain. Separate requests raised by concurrent publications or deferred discoveries survive. No request means no deferred discovery from that scan. |
| Custodian SIGKILL → resume | Native custody drains the owned group; the surviving observer preserves the claim, waits for actual leases and retries. Sole-maintainer test permits no later export and requires exact 5/20 restoration. |
| Observer SIGKILL during claim → resume | Custodian detects the recorded observer's death, cancels/drains native work, preserves the claim and launches one successor with the original expiry. The reciprocal death test also requires exact 5/20 restoration without another export. |
| Known work error → parked | Move claim to `maintenance-parked.json`; leave any genuinely newer request intact. Log the diagnostic. No automatic retry of the same compressor/I/O/identity failure. New publication may supersede parked work. |
| Repeated interruption / startup failure → parked | At most three attempts for the same interrupted claim; repeated failed starts stop after three. Persist unresolved work and diagnose; no endless crash/restart chain. |
| Idle cancellation, sleep or observation expiry | Exit with durable unresolved work and diagnostic; a later schedule may resume it. No process remains indefinitely waiting. Expiry is inherited, never silently refreshed by a successor. |
| Queue empty → exit | Drop pending lease, then recheck/kick. A concurrent scheduler either sees this observer or acquires the released lease. Request/claim/park records live outside retained run trees. |
| Peer pair or host lost together | Durable state survives for a later scheduler; automatic resumption assumes one peer survives an active scan. No new host daemon or stronger power-loss guarantee is claimed. This is the existing simultaneous-custody-loss limit. |

The normal idle/contended case still has exactly one pending process. Active
maintenance adds one scan custodian and its existing bounded native group; exports
do not accumulate custodians. The 5-full / 20-compressed bound applies after
leases quiesce and successful maintenance. A pinned generation or loud parked
failure cannot be discarded merely to satisfy that bound.

### Verification

The first six new JavaScript controls passed. Initial broad qualification found
five Rust fixtures which relied on empty completion markers/live fake wrappers,
and two JavaScript failures (92/94). Retention/history fixtures now provide actual
terminal receipts; their custody, namespace and compression assertions remain.
The JavaScript run also caught a real classification gap: a smoke manifest without
an end timestamp was being treated as completed. Discovery now requires terminal
result state or a terminated smoke receipt; incomplete ownerless attempts are
removed. The 14 receipt/publication controls passed after that correction. Earlier
logs remain archived and are not represented as final qualification.

A subsequent final affected run passed 66 witness units, 76 integrations and
93/94 export tests; the remaining older pruning fixture needed terminal timestamps
on its seeded completed receipts. Its entire three-test file then passed. The
first full-suite attempt was stopped through its directly owned shell's canonical
cleanup at 953.93 s for a further audit correction: handled busy-lock deferrals
were counted as failed custodian starts and could exhaust that budget. A real
supervised-worker control reproduced exit 1 for a handled busy outcome. The
internal custodian now exits 0 after durably recording/logging a handled outcome;
startup/unhandled errors still fail. The new four-refusal control requires a live
observer and exact 5/20 restoration on release. The incomplete suite, reproduction
and earlier failed runs remain separate evidence; only the final complete suite
will qualify.

The final affected run passed: build; **66/66 serial witness units** (59.41 s
including Cargo work); and **95/95 export/preparation tests** (467.48 s), with no
skips or cancellations. All nine recorded inputs stayed unchanged. The
[final affected record](./round9/focused-final.json) is separate from the earlier
failed and corrected-fixture records. The [complete final Mac suite](./round9/full-suite-final.json) passed with **zero
failures in 2,658 s** (2,657.996 s measured wall time), exercising all final inputs.
All Rust targets and doctests passed, including **298 CLI units** (four existing
ignores) and **76 witness integrations**. Nine fixture wrappers passed. All
**312 client files** passed: **6,253 passed / six existing skips / zero failures
or cancellations**. Both full-count model files passed **79/79**. Builds, wasm,
documentation budget, release guard and typechecks passed. No intervention or
reduced counts occurred in this qualifying run. Its
[nine-input manifest](./round9/full-suite-final-inputs.json) remained unchanged.

Final custody verification found no lane CLI or interposed fixture jobs, and
confirmed the previously recorded NZ devices absent. No real devices were created
this round; all new fault controls used owned fixtures on this mini. Other
worktrees, processes and simulators were untouched. WD cleanup, group custody and
preparation-deadline sources remain byte-identical to the base. Reference and
whitespace checks passed. The result records, cancellation record, hashes and
custody checks are in `round9/`; large logs (including earlier failures and the
incomplete attempt) and the tested binary remain in the external content-addressed
archive. No gzip/video or new files over 256 KB are committed. Earlier native,
Linux and physical-sleep qualification limits remain. NZ targets 0.4.14.
Nothing was pushed or published.


## Round 10 — atomic retention transitions (2026-10-04)

Base: `7a1899daa8`, on the Apartment mini only. The operator supplied Astra's two
crash-window findings and Grok's READY verdict; this section does not claim an
independent review or access to the eb1000 evidence files. NZ remains for 0.4.14.
No real simulator was created and no new native timing is claimed.

### Changes and protocol audit

The final handoff now keeps a live backup. After its native group drains, the
custodian atomically records `handoff` **before** dropping the active lease. Its
observer recognizes that record and can launch a successor without waiting for
the finishing custodian to exit. While work remains, the finishing custodian
polls every 100 ms until the queue is covered or a birth-matched live successor
has recorded its claimed scan. Seeing a busy observer lease does not let it exit.
If that observer dies in the gap, the custodian starts another observer itself.
Both handoff sides share the original observation expiry. There remains one
observer and one active scan; a finishing backup can overlap a successor briefly,
without a native group or held scan/publication lease. Three interrupted/startup
attempts and the 60-minute observation cap bound unsuccessful restart chains.

A pending request is fully written and synced at a unique temporary pathname,
then atomically renamed into its slot. Claiming renames the complete request;
claim metadata updates also use complete-record renames. The claim pathname is
authority, so an older empty or partially written claim can be upgraded by any
live custodian. Completion renames only that claim to the done slot. A separate
new pending request cannot be erased by acknowledgement. Deferral publishes
pending before acknowledging, and parking renames claim to parked. A crash at
any of these boundaries leaves either an intact record or an idempotently
redoable operation; no later write requires its original writer to survive.

Every wrapper first checks for stranded pending/claimed/parked or prepared
request state and re-arms it, without waiting for a maintenance lease or scan.
It performs this before Expo: even a failed next export repairs earlier work.
The ordinary post-publication schedule remains outside the publication lock.
A repaired prepared request is made durable before an old, birth-recorded dead
producer's temporary file is removed. A crash before JSON exists is recognized
by the exact private temporary filename and absence of a live writer PID. That
permits unlinking the temporary file only; it never authorizes a signal or any
process/simulator operation. A live writer is left alone. Unknown foreign names
remain diagnostics and are not proof slots. Host-wide daemon/power-loss recovery is not
claimed. Persistent filesystem, compressor or recorded-ownership errors still
need their underlying condition resolved and remain loud.

The matrix additionally exposed a history-ranking bug under publication
contention: unknown pins could be treated as high-priority rows, placing
compressed history ahead of full history, then compressing too many full rows
after the lock cleared. The entire ranking pass now defers on any unknown pin.
A focused mixed-observation regression refuses a partial ranking. Current/pending
pins and per-candidate export leases and rechecks are unchanged.

| State / transition | Atomicity, owner and bounded recovery |
| --- | --- |
| Export backstop | Before Expo, complete-record request publication re-arms stranded/parked/prepared work; queue acquisition is nonblocking. Maintenance never becomes a foreground wait. |
| Request preparation → pending | Unique temporary file, complete JSON and sync, atomic rename. Death before rename leaves an older request or prepared record for the next export; after rename any party may arm observation. |
| Pending → observer launch/gate | Queue lease prevents duplicate observers; launch record is complete before opening the gate. A lone launcher/observer crash before a peer exists leaves durable work for the next export. Gate and observation share the 60-minute expiry. |
| Passive readiness | Initialization, active, retention, exclusive publication and per-run leases plus birth-matched owners are probed every 100 ms. Shared publication holders are busy too. No native worker respawns while waiting. |
| Vanished / ownerless run | Vanished discoveries are already covered. Dead-journal shells and unresolved ownerless publication transactions use existing scoped recovery; empty shells do not consume slots. Conflicting identities park loudly. |
| Observer → custodian | Observer retains the queue lease and passes the active lease to its direct child. Claim happens only after both exist. Launch failure retains pending state and is attempt-bounded. |
| Request → claim | Atomic rename; metadata upgrade is repeatable for complete, partial and legacy empty records. The three-attempt count is persisted; fresh work may supersede an old claim. |
| Claimed → scan/native custody | Claim remains durable. Existing supervisor/anchor/kernel watcher own all native work, gzip and descendants. Thirty seconds of work plus unchanged WD drain; cancellation and sleep checks remain. |
| Observer waits for native work | Poll unreaped direct child; cancellation signals only that child. Existing 100-second force / 105-second failure bound applies until the custodian records completed handoff. |
| Discovery deferred / raced lock | Publish a separate pending request, then acknowledge only the old claim. Passive readiness precedes another scan; handled deferrals do not spend failed-start attempts. |
| History ranking | Only known pins enter the ordering. Any unknown pin defers the whole pass; no partial ranking can displace full history. |
| Compression → receipt commit | Compression stays inside native custody. Receipt writes a temporary file then renames; source removal follows. Interrupted stages are repeatable and compressed receipts remain evidence. Worker failure parks for next-export repair. |
| History deletion | Under candidate custody after pin check; recursive work is outside the publication lock. Interrupted deletion is repeatable; worker failure parks rather than spinning. |
| Scan → done | Only after native completion/drain, rename claim to done. A concurrent pending request survives. Death before ack retries the claim; death after ack has no unfinished work from that scan. |
| Known error → parked | Atomic claim-to-parked rename, diagnostic, no automatic retry of the same error. The next wrapper publishes fresh pending work before Expo. |
| Custodian → handoff | Complete atomic handoff record while active lease is held, then release lease. Observer may advance; custodian remains backup while runnable work exists. A busy observer lease is never acknowledgement. |
| Handoff → live successor | Retire only for no runnable work or a birth-matched successor's claimed-scan record. If the observer dies after a busy probe, the backup re-arms it; if the backup dies, the observer retains responsibility. |
| Sole custodian death during scan | Kernel custody drains native descendants; observer retries the durable claim. No later export is needed. |
| Observer death during scan | Custodian cancels/drains and preserves claim, then backs up its replacement observer until a successor claims. No later export is needed. |
| Queue covered → exit | Release queue lease then recheck. Concurrent new requests retain their own record. Requester/last-peer crashes outside a paired scan use the next-export backstop. |
| Retry cap / sleep / expiry / both peers lost | Preserve unresolved record and diagnose. All live waits remain bounded; next export re-arms durable work. No unbounded restart chain or new host daemon. |

### Crash-point matrix

The debug build has one-shot, per-fixture transition barriers that expire after
20 seconds if the harness dies. Release execution contains no barrier behavior.
Tests signal only the recorded process identities they started. All history
fixtures contain full export trees and actual terminal receipts; every row
requires exactly **five full plus twenty compressed** runs after recovery and
preserves the current publication. No helper/manual cleanup supplies recovery.

| Injection | Recovery required and asserted |
| --- | --- |
| Temporary request created before JSON, and complete request prepared before rename | Next export. Remove the older dirty bit too; the next Expo command deliberately fails, proving recovery came from the first maintenance step and the surviving prepared record. |
| Pending rename committed, before observer launch | Next real export re-arms the stranded request. |
| Claim renamed, before metadata upgrade | Surviving observer, no later export; repeated with an **empty legacy request**, reproducing Astra's partial-claim window. |
| Claim metadata committed | Surviving observer, no later export. |
| Before scan start | Surviving observer, no later export. |
| Before gzip / after compressed receipt rename | Worker death is a known failed scan; next real export re-arms parked maintenance. |
| Before / after history deletion | Worker death parks; next real export restores the bound. |
| Scan complete, before acknowledgement | Surviving observer repeats the durable claim. |
| Immediately before claim-to-done rename | Surviving observer repeats the durable claim. |
| Immediately after claim-to-done rename | Work is already complete; no later export. |
| Before final re-arm and after busy queue probe, kill observer | Finishing custodian survives, re-arms and waits for a successor; no later export. The busy-probe case reproduces Astra's final handoff window. |
| Same two handoff points, kill custodian | Observer survives and completes pending work; no later export. |
| Parked work, next export fails, each of opt-out / non-macOS / background | The wrapper's first maintenance step restores the bound before any new successful publication. No native tool launches. |

The earlier sole-custodian and sole-observer SIGKILL tests still verify native
compression-group custody and automatic recovery without another export. The
four forced raced-lock refusals now wait for the durable handoff record rather
than assuming the finishing custodian must exit before its successor can start.

### Verification and evidence

Exploratory crash subsets recorded 15/17, then 22/23, then 23/23 passes. The
first run exposed an ordering change introduced by the initial backstop: it
started brand-new maintenance before publication. The backstop now repairs only
existing unresolved/prepared work; ordinary new work is still scheduled after
publication. The second run exposed the mixed-history ranking failure described
above. Earlier failed probes remain archived and are not final qualification.

The first broad affected run passed 67 witness units, 76 serial witness
integrations and 115 export/preparation tests. During that run, the audit added
the empty pre-write temporary-record repair and its 21st new crash/backstop case,
and corrected the new non-macOS failure fixture to clear its inherited opt-out.
The harness therefore marked that run's inputs changed and did **not** start the
full suite. A separate qualification-waiter startup raced creation of the new
record file; the report helper now waits for a readable completed record. Neither
helper refusal ran a partial full suite.

The **final affected run passed**: build; **67/67 serial witness unit tests**
(59.895 s including Cargo); and **116/116 export/preparation tests** (566.034 s),
with no skipped or cancelled cases and all **six inputs unchanged**. See
[the final affected record](./round10/focused-final.json) and
[the 21 new crash/backstop checks](./round10/crash-matrix.json). The final matrix
includes both requested reproducers, both peer deaths at each handoff barrier,
and recovery before a deliberately failing Expo command in all three modes.
The pre-write and pre-rename crash cases restored 5/20 in 1.610 s and 1.617 s
respectively through that next-export backstop. These are fixture recovery times,
not new native export metrology.

The [complete final Mac suite](./round10/full-suite.json) passed with **zero
failures in 2,800 s** (2,800.394 s measured wall time). All Rust targets and
doctests passed, including **299 CLI tests** (four existing ignores) and **76
witness integrations**. All nine fixture-wrapper tests passed. All **312 client
files** passed: **6,274 passed / six existing skips / zero failures or
cancellations**. Both full-count model files passed **79/79**. The Rust stage
was 1,202 s, the client pool 1,357 s and the full-count models 198 s. Builds,
wasm, documentation budget, release guard and typechecks passed. There were no
interventions or reduced counts in this qualifying run. All
[six input hashes](./round10/full-suite-inputs.json) remained unchanged.

Final custody verification found no remaining lane CLI or interposed fixture
jobs. No real devices were created this round; the previously recorded NZ
devices are absent. No other session's worktree, process or simulator was
changed or signalled. WD cleanup, group custody and preparation-deadline sources
remain byte-identical to the base. Reference and whitespace checks passed.
[Custody verification](./round10/custody-verification.json) and
[artifact hashes](./round10/verification-evidence.json) accompany the result
records. Large logs, including exploratory failures, and the tested binary are
retained in the existing external content-addressed archive; no new file over
256 KB and no gzip/video is added to git. This adds no real-native timing,
physical-sleep or Linux qualification claim. Nothing was pushed or published.


## Round 11 — inventory backstop before the first request (2026-10-05)

Base: `e98cf0f089`. The operator supplied Astra's pre-request death finding;
no remote host was accessed. The repair is one inventory predicate in recovery
and its call from the existing pre-Expo backstop. It inspects actual full and
compressed evidence, current/pending publication identities and live owners.
Excess 5/20 history or ownerless unfinished work schedules the existing atomic,
coalesced maintenance even when there is no request record. It performs no
compression, deletion or blocking lease wait. Queue/custody/pruning behavior
and all native preparation/WD deadlines remain unchanged. LLP 3000.030 §15 and
the witness guide now state this inventory-based backstop. NZ targets 0.4.14.

The crash matrix now starts at the first verified publication receipt, before
namespace cleanup, handoff or maintenance creation (`publication-committed`).
It also covers the post-cleanup/pre-handoff boundary (`publication-handoff`),
where no transaction marker survives. Each boundary is crossed in opt-out,
simulated non-macOS and background mode, followed by either a successful or
failed Expo export: **12 controls**. Each begins with 5 full + 20 compressed,
clears historical maintenance records only after their owners exit, kills its
recorded publisher with 6 full + 20 compressed, and asserts no queue/claim or
maintainer can rescue it. The next real wrapper must restore exactly 5/20;
a failed Expo step cannot publish new evidence to hide a missed backstop. The
committed generation survives. No surviving maintenance peer exists at these
boundaries, so recovery is explicitly **by the next export**, not autonomous.
Earlier pre-commit crashes leave unfinished/transaction state for the same
inventory discovery and existing orphan recovery; every later queue boundary
remains covered by the prior crash matrix.

The inventory unit control checks an already-covered 5/20 tree, a live empty
shell, protected current full evidence, 21 compressed runs, a dead-owner shell,
and an ownerless transaction with no request file. Three older custody fixture
groups now explicitly hold maintenance until publication so that their intended proof
or sole-claim death remains isolated from the newly effective inventory backstop.
The initial six pre-cleanup probes passed before adding the six post-cleanup
controls.

Affected checks passed: build, **68/68 serial witness units**, **76/76 serial
witness integrations**, and **128/128 export/preparation tests**, with no skips
or cancellations. The twelve new controls restored the bound in 1.004–4.269 s
(fixture recovery, not native metrology); all earlier crash controls also passed.
See [crash controls](./round11/crash-matrix.json) and
[affected qualification](./round11/affected-qualified.json). One additional
legacy guardian fixture was adjusted during the Rust integration run, before
Node export tests started. Rust/guide inputs stayed unchanged; the final JS hash
was recorded before the export log's creation time and stayed unchanged through
its passing run. The original whole-run record conservatively reports the
changed JS input and remains alongside the scoped qualification; its automatic
suite waiter refused without running a suite. The final full-suite runner uses
the qualified inputs and records them separately.


The [full Mac suite](./round11/full-suite.json) passed with **zero failures in
2,812 s** (2,812.336 s measured). All Rust targets/doctests passed, including
300 CLI tests (four existing ignores) and 76 witness integrations; all nine
fixture tests passed. The client pool passed **312/312 files**, **6,286 tests**,
with six existing skips and no failures/cancellations. Both full-count model
files passed **79/79**. Rust took 1,197 s, clients 1,380 s, models 192 s; builds,
wasm/docs budgets, release guard and typechecks passed. No intervention or
reduced work count was used. All [five input hashes](./round11/full-suite-inputs.json)
remained unchanged throughout the full run.

[Custody verification](./round11/custody-verification.json) found no remaining
lane CLI or interposed fixture jobs. No real simulator was created; previous
recorded NZ devices remain absent. No other session's worktree, process or
simulator was changed or signalled. WD cleanup, process-group and preparation-
deadline sources remain byte-identical to the base. Reference/whitespace checks
passed. [Evidence hashes](./round11/verification-evidence.json) bind the logs and
tested binary in the existing external archive. No new file over 256 KB, gzip
or video is committed. These are local Mac fixture/suite results, not additional
native timing, physical-sleep or Linux qualification. Nothing was pushed.


## Round 12 — integration (2026-10-05)

Merged fetched main **8bd933cd2dfbf7cb8acfd43f209f7015ed58a633** into reviewed NZ
**67a29a10b05bad86620e64bad8f4aab15a764180**, from their last common main
**abafa9af9c**. This is a two-parent merge, not a rebase. No version or publication
staging was changed; NZ remains intended for 0.4.14, separate from the 0.4.13 cut.
All work stayed on the Apartment mini. The main-only comparison below used an
NZ-owned source snapshot on this mini, never another session's worktree.

Five conflicts were resolved. Both JOURNAL histories are retained in order:
comparison with each parent reports only insertions. The root LLP keeps both
revision entries. The adoption test keeps main's complete-log-line barrier.
Retained-history teardown keeps main's held-apply release and complete stdout
capture, together with NZ's stop-watcher-before-delete ordering and `finally`
cleanup. The published-engine fence required the semantic reconciliation below.
The [integration audit](./round12/integration-audit.json) records the twelve
paths changed on both branches and their resolutions.

Main's client implementation, FX/FY cleanup helper, DG worker/starter guidance,
RH/OP behavior, SQL catalog documentation and `CLIENT-AND-OPERATIONS.md` are
preserved. Its witness peak parser and atomic stalled-checker PID publication
are retained. NZ's export wrapper, retention protocol, preparation deadline,
WD cleanup and direct process-group code are byte-identical to reviewed Round 11.
The existing bounded release diagnostic drain remains alongside main's adoption
log changes. The LLP 3000.030 §15 protocol and its accepted bounds did not change.

### Failure classification and reconciliation

The initial wasm check reported **640,054 B gzip**, 113 B over the main cap.
The independently built main snapshot passed at **639,941 B**. Rebuilding only
NZ's two workspace wasm crates retained the discrepancy in dependency artifacts.
Cleaning this lane's wasm profile and rebuilding all wasm dependencies produced
**the identical main artifact**: 2,117,610 B raw, 639,941 B gzip, SHA-256
`e08359fecc0129ad21f85da97c068b12b1b28132563b9dc312624da131d52eb9`.
No wasm source or cap changed. NZ adds **0 B**; the cap remains the main Linux
measurement **639,811 B + 130 B** macOS allowance. The client was rebuilt from
the qualified wasm before its tests. The initial failure is retained in
[the comparison](./round12/wasm-initial-comparison.json); [clean qualification](./round12/wasm-qualified.json)
binds all three build logs and final bytes. This is a stale local build-output
finding, not an NZ byte increase or an inherited main failure.

The initially combined Darwin fence failed four assertions: NZ's Round 2 test
workaround unconditionally added reservation capability names (duplicating
main's two nonzero fixture sets) and expected ordinary zero-cost schemas to be
fenced. RPF's landed fix omits all-zero reservation maps and restores canonical
current capability-free bytes. Unmodified main passed **7/7** on this host.
Restoring main's fence assertions therefore supersedes that old workaround:
exact capability sets, current canonical byte/store compatibility, native/WASM
refusals, migration and mixed-version store preservation all remain tested.
Main's explicit `watermark` assertion stays outside neutral metadata cleanup.
The corrected merged fence passed **7/7**, zero skips. [Before/after hashes and
comparison logs](./round12/fence-reconciliation.json) retain the initial failure
and main control; no runtime behavior was changed to satisfy an assertion.

### Qualification and resolved tickets

[Affected qualification](./round12/affected-qualified.json) passes on the merged
tree: CLI build, **68/68** serial witness units, **77/77** serial witness
integrations, **179/179** export/witness/preparation tests across eight files,
**7/7** Darwin published-engine fence tests, and **120/120** retained-history,
periphery, release-activation and cleanup controls. These test runs have no skips
or cancellations. All prior retention/crash controls remain included. No real
simulator was created.

The original aggregate run conservatively retains its nonzero status for the
first cached wasm build and the fence test's changed input hash. The scoped
qualification records both: a clean wasm rebuild matched main, and the sole
changed test file was reconciled **before** its passing scheduled execution.
Every other recorded source input stayed unchanged. The separate full suite
records the final merged source hashes before starting.

Closed [NZ's release-activation crash-cut ticket](../../../issues/closed/20261004-snapback4-release-activation-crash-cut-race.md):
main FY supplies a witnessed stop after real schedule admission and before any
maintenance chunk, retaining queued/chunk/write, restart, exactly-once and outbox
assertions. Its affected test passed in 1.397 s. The separate NZ ephemeral-expiry
intermittency ticket remains open: main has no established root-cause repair,
and a later passing sample alone cannot close it.

The [full Mac suite](./round12/full-suite.json) passed with **zero failures in
2,869 s** (2,869.461 s measured). All Rust targets passed: **5,090 tests**, zero
failures and 33 existing ignores across 1,012 executions / 299 binaries, plus
passing workspace doctests. This includes 315 CLI tests (four existing ignores)
and 77 witness integrations. All nine fixture tests, builds, typechecks, budgets
and release guard passed. The client pool passed **321/321 files**, **6,469 tests**,
with six existing skips and no failures/cancellations. Both full-count model
files passed **79/79**. Rust took 1,218 s, clients 1,399 s and models 194 s.
All [209 source input hashes](./round12/full-suite-inputs.json) remained unchanged
throughout the full run; no work count, timeout, assertion or performance bound
was reduced. No inherited-main test failure remained to classify.

[Custody verification](./round12/custody-verification.json) found no remaining
lane CLI or interposed fixture processes. No real simulator was created, and
all five previously recorded NZ devices remain absent. No other session's
worktree, process or simulator was changed or signalled. The isolated main
comparison snapshot is removed after its logs, binary and wasm bytes are retained.
[Evidence hashes](./round12/verification-evidence.json) bind logs, runner sources
and both CLI binaries in the existing external archive. New NZ evidence stays
under 256 KB per git file, without `.gz` or `.mp4`; main's existing tracked
history is preserved. Reference validation and NZ-delta whitespace checks passed. The broad first-parent
whitespace check reports 95 findings in main's existing benchmark reports and RH
raw logs; the main-only diff reproduces the identical list. Those historical bytes
are preserved ([classification](./round12/whitespace-classification.json)). Nothing
pushed or published; the separate 0.4.13 publication was not touched.
