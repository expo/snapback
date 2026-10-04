# Lane NZ — publish first, prove native execution in the background

Implementation and automated verification complete; requested quiet-host performance
qualification remains **blocked**, and cold social proof is **unqualified**. Base WD commit
`38d9bfe0de`, branch `sb4-intent/nz-native-proof-zero-cost`. Nothing pushed.

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
The requested measurement step is unfinished. [The open follow-up](../../../issues/20261003-snapback4-nz-quiet-native-proof-qualification.md)
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
