# Lane NZ — publish first, prove native execution in the background

Round 1 completes the requested as-is measurements: all 16 export samples,
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
