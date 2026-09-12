# Snapback 2 loop measurement exceeds consumer, check, and doctor budgets

**Status:** Open — consumer/check overruns recur; changed-binary first doctor remains unqualified
**Date:** 2026-09-07
**Severity:** P0 (measured budget breach; breaking commit not established)
**Reporter:** Codex root, parallel papercut integration
**Systems:** installed consumer verification, project check, doctor startup

`node snapback2/scripts/measure.mjs --check` at source `d6966fd59` exited 1
after 263.818 seconds. The append-only record in `snapback2/metrics/loop.jsonl`
is timestamped `2026-09-07T07:50:13.551Z`. All functional steps succeeded;
three timing checks failed:

| Step | Observed | Budget |
|---|---:|---:|
| Installed consumer verification | 58.10 s | 30 s |
| Project `check` | 3.001 s | 1 s |
| First `doctor` sample | 0.969 s | 0.5 s |

The second doctor sample passed at 0.109 s. Warm release build passed at
174.43 s / 300 s, incremental build at 7.57 s / 15 s, and init-to-dev at
5.883 s / 10 s. Do not discard the first doctor sample or treat functional
success as a passing measurement.

The named `clique-startup-cleanup` lane used an APFS copy of the existing
target cache, shared dependency links, and its own output directories. The
full test script had finished before this measurement; other sessions were
active on the host. The source changes concern browser export selection,
a test-only cleanup fixture, and guide wording. No paired baseline timing
was run, so this observation does not identify a breaking commit or establish
host contention as the cause.

Follow up on a warm named lane without overlapping package builds, retain
both doctor samples and all failed records, and attribute the overruns before
changing product code or budgets. The existing
[full-suite timing ticket](./closed/20260901-snapback2-scripts-test-sh-flakes-under.md)
tracks test deadlines separately. Raw measurement stdout and the launch
PID/exit/duration receipt remain locally in
`/Users/ccheever/projects/snapback/.llp/ship-runs/20260907-parallel-papercuts/measure.*`.

## Survivor-uniqueness repair measurement — 2026-09-07

The ordinary measurement at `2026-09-07T08:43:14.213Z`, source `07b36aad2`
(core bytes unchanged by its clean rebase and landing as `036fc240c`), again
passed every functional step and failed the same three timing budgets:
installed consumer 58.21 s / 30 s, project check 3.315 s / 1 s, and first
doctor sample 1.135 s / 0.5 s. The second doctor sample passed at 0.116 s.
Warm release build passed at 280.38 s / 300 s, incremental build at
7.41 s / 15 s, and init-to-dev at 5.686 s / 10 s. The complete command took
367.307 s and exited 1; its row is retained in the append-only loop log.

The lane's affected core suite separately passed 420 tests (one pre-existing
skip). No paired baseline measurement establishes the cause of these overruns,
and this observation does not turn the timing check green. Logs and launch
receipt: `.llp/ship-runs/survivor-uniqueness-measure.*` in the main local clone.


## DX candidate follow-up — 2026-09-07

The separate CLI DX candidate `0004ff7f2` on Hetzner450b retained both budget
failures after a completed release prewarm and serial installed-consumer
measurement: consumer verification 32.97 s/30 s, project check 1.260 s/1 s.
All functional steps passed; chat has only the declared effects-disabled block.
Doctor samples were 0.035/0.033 s, incremental rebuild 2.67 s, init-to-dev
2.53 s. No Rust build overlapped the product measurements. This is a different
machine from the first run, not a paired estimate of its contention penalty.
The new explicit journey selector takes 2.337 s median in its separate
three-pair comparison; it does not make full verification or check meet budget.

[Raw measurement](../benchmarks/runs/2026-09-07-snapback2-published-dx/fix-evidence/measure-check.log)
retains the remote snapshot's synthetic Git identity; the
[source comparison](../benchmarks/runs/2026-09-07-snapback2-published-dx/fix-evidence/source-check-final.json)
binds its product files to the reviewed candidate. This is an additional
observation, not a newly identified breaking commit.

## Architecture integration on the reserved Mac — 2026-09-07

The ordinary measurement on `4ef44ab65`, recorded at
`2026-09-07T19:47:18.143Z`, passed all functional steps and retained two
timing failures: installed-consumer verification **30.62 s / 30 s** and
the first doctor sample **0.808 s / 0.5 s**. The second doctor sample
was 0.042 s; the first is not discarded. The same run passed project
check at 0.872 s, incremental rebuild at 2.31 s, warm release build
at 73.26 s and init-to-dev at 1.358 s.

This used the reserved Apartment Mac lane with Node 24.18.0 and Rust
1.97.0, with package build, native build, platform witnesses and measurement
run sequentially. It is an additional observation, not a paired attribution
of the earlier host's slowdowns. The exact append is preserved in
`metrics/loop.jsonl`; raw measurement and before/after metric files are in
`.llp/ship-runs/20260907-1018-architecture/expo-search-v5-r12-*`
in the coordinating checkout. Both budget failures remain open.

## Indexed architecture candidate — 2026-09-07

The reserved M1 Max lane measured `c156228ef0` at
`2026-09-08T00:59:04.210Z` (local September 7), Node 24.18.0/Rust 1.97.0.
The complete measurement exited 1 after 80.11 seconds, PID 56255. All functional
steps succeeded, with only the first doctor sample over its budget:
**0.609 s / 0.5 s**. The second sample was 0.040 s and does not erase the first.
Installed consumers passed in 23.98 s / 30 s, project check in 0.561 s / 1 s,
incremental build in 2.37 s / 15 s, warm release build in 48.01 s / 300 s, and
init-to-dev in 1.075 s / 10 s. Chat retains only the declared effects-disabled
block; its offline three-member journey passed.

The source includes the direct compiler, stable indexed live subscriptions,
coherent observations and settled fan-out retirement. Package and native builds
completed before measurement; host load was 4.81 on ten cores at launch. There
is no paired baseline proving a breaking commit or a cause for first-exec cost.
The failed sample remains in `snapback2/metrics/loop.jsonl`; its raw log SHA-256
is `83424b97c45a58c13bb3ffbf8c7f8d91bcd1b825322035f5e67309ec5bf7416f`, with source, process and before/after custody in
`.llp/ship-runs/20260907-1018-architecture/expo-search-v5-r17-*`.

## Metadata repair candidate — 2026-09-08

Candidate `170ebacd5411` on the EPYC lane, Node 24.13.1 / Rust 1.97.0,
passed every functional measurement step but exited 1 with installed-consumer
verification **30.52 s / 30 s**. Project check passed at 0.993 s / 1 s; both
doctor samples passed at 0.035 and 0.032 s. Warm release build was 60.81 s,
incremental rebuild 2.73 s, and init-to-dev 1.794 s. No deadline or budget
changed. The full canonical suite separately passed 821 Node tests, 865 native
tests (four existing skips), 225 evaluator cases and two visibility checks,
214 compiler checks, and doctests. Its 118.595 s includes rebuilding the
versioned native artifacts; it is not the prior warm timing measurement.

This is another observation of the existing consumer timing gap, without a
paired baseline attributing a breaking commit. The non-engine measurement
accepts only the documented chat effects block; separate full-engine production
qualification passed both todos and chat receipts. The failed metric is retained
in the append-only loop log and the source-bound
[qualification record](../benchmarks/runs/2026-09-08-release-cold-headroom/release-020-qualification.json).

The revised candidate `a826919984a9` retains two timing reds on the same EPYC
lane: installed consumer **30.40 s / 30 s** and project check
**1.019 s / 1 s**. Both doctor samples pass (0.035 / 0.032 s); incremental
rebuild is 2.73 s, warm release build 0.12 s, and init-to-dev 1.799 s. Every
functional measurement step passes; the command exits 1. Its full canonical
suite separately passes 825 Node tests and the unchanged native/evaluator/
compiler/doctest counts in 90.720 s. These are single-run observations, not a
controlled performance comparison. Failed metrics and source-bound receipts are
retained in the [revised qualification record](../benchmarks/runs/2026-09-08-release-cold-headroom/release-020-r2-qualification.json).


## Assessment-items integration on the local M1 Max — 2026-09-08

The ordinary `measure.mjs --check` run at source `85b1f3080`, timestamped
`2026-09-08T19:31:45.617Z`, exits 1 after **326.050 s**. All functional
steps pass, including installed consumers. The chat receipt retains the
standard effects-disabled block; this is not full-engine qualification.
Three timing checks remain red:

| Step | Observed | Budget |
|---|---:|---:|
| Installed consumer verification | 58.89 s | 30 s |
| Project `check` | 1.980 s | 1 s |
| First `doctor` sample | 1.064 s | 0.5 s |

The second doctor sample passes at 0.131 s; it does not erase the first.
Warm release build passes at 236.49 s / 300 s, incremental rebuild at
8.54 s / 15 s, and init-to-dev at 3.378 s / 10 s. The measurement uses
Node 24.18.0 and Cargo 1.97.0 on the local M1 Max. The full test script and
three bounded diagnostic tests completed before this run; no other task-owned
build or test overlapped it. No paired baseline establishes a breaking commit
or attributes these overruns to host contention.

The failed append is preserved in `snapback2/metrics/loop.jsonl`. Raw output,
PID 7609 and completion status are retained in the primary checkout's
`.llp/ship-runs/20260908-client-123/` (`snapback2-client-123-measure.log` and
the run ledger). This leaves the timing ticket open and does not qualify the
complete loop or a package publication.

## Triage — 2026-09-11 (UTC)

**Disposition:** Open — intermittent budget overrun; attribution unestablished. **Triage priority:** P0.
**Audit source:** `15c134d056`; Codex, on the author's request to reconcile tickets.
This disposition supersedes stale current-work claims above; historical observations remain unchanged.

Newer records improve materially but do not erase the misses: dfac9e92d1 at 2026-09-10T21:08:50.782Z has consumer 40.24 s and doctor first sample 0.697 s; its next consumer is 31.75 s. Later cc64186513 samples have consumer 13.40/13.06 s, project check 0.450/0.486 s, and both doctor samples below 0.5 s.

Evidence: existing snapback2/metrics/loop.jsonl, not new timings. Preserve all samples, including the earlier npm-cache EPERM infrastructure failure, separately from product latency. Remaining: paired controlled measurements that establish cause and sustained compliance at the original budgets; byte-baseline acceptance and complete-suite timing are separate verdicts.

## Controlled Silver M5 series — 2026-09-11

Three sequential, non-overlapping `measure.mjs --check` executions at product
source `85b8d3821` used the reusable Silver M5 Max lane, 18 logical CPUs,
Rust/Cargo 1.97.0, Node 24.18.0, esbuild 0.25.9, and gzip level 9. Start/end
one-minute load averages were 2.31/3.22, 2.86/2.44, and 1.65/3.78; no other
task-owned build or test overlapped them. Every functional step passed in all
three records, which are appended to `metrics/loop.jsonl`.

The originally named consumer and project-check budgets now pass throughout:
consumer smoke was 21.11, 11.55, and 11.62 seconds; project check was 0.360,
0.362, and 0.352 seconds. The first consumer's 10.158-second tarball install
fell to 0.779/0.797 seconds on the two immediately repeated runs, making cache
state a measured component of this series without claiming it explains the
historical 58-second result.

Doctor still has one honest red. After the first run produced a changed release
binary, its external samples were 0.588/0.030 seconds against the 0.5-second
budget even though the binary's internal report was 55.158 ms. The next two
no-op-build runs retained the executable inode and passed at 0.154/0.027 and
0.153/0.025 seconds (internal 31.976 and 30.885 ms). This localizes the current
miss to changed-binary first execution outside the reported doctor body, but it
does not prove which macOS launch-policy component owns that extra time or make
the first sample pass.

Keep the ticket open, narrowed to that first-execution path and historical
attribution. Closure requires either two controlled changed-binary runs whose
first samples both meet 0.5 seconds, or a source/setup repair with the same
evidence; a prewarm that discards the first observation is not acceptance.

All three commands also rejected the current byte baseline, separately from
loop timing: client/react/expo/runtime measured 140,849/150,585/154,188/86,577
gzip bytes versus accepted 136,547/146,166/149,836/84,580. Their records remain
`byte_baseline_accepted: false`; this ticket neither accepts those bytes nor
attributes them to the live-capacity change.

## Changed-binary qualification on the local M1 Max — 2026-09-11

Two fresh, serial release relinks at source `1b5f14394` used distinct Rust
metadata and produced byte-distinct binaries with new inodes. Neither product
was executed before its retained first `doctor --json` observation. Both first
samples remain red: **0.680638 s** and **0.525602 s** / 0.5 s. The adjacent
second samples passed at 0.048704 s and 0.049517 s. The doctor's internal
reports were only 55.114 ms and 50.571 ms for the red observations.

macOS unified logs attribute the gap before process entry to a fresh
Gatekeeper path: notarization network work followed by XProtect analysis and
`GK evaluateScanResult`. Two separately linked trivial C executables showed
the same variable host floor at 0.575269 s and 0.245959 s. Ad-hoc signing under
a stable identifier still missed at 0.525092 s. The machine exposes two valid
Apple Development identities, but `codesign` cannot use either
non-interactively (`errSecInternalComponent`); developer mode is disabled.
Silver was not used because it was actively running the Clique benchmark lane.

No product or measurement change is justified by this result. Preserving the
executable inode across byte changes would hide the exact first-execution cost
this acceptance clause requires. Enabling Terminal developer mode, disabling
Gatekeeper, or provisioning/unlocking a signing identity is machine-security
or credential work outside this repository task, so none was performed.

**Disposition remains open.** The literal two-sample closure criterion failed,
and the exact observations are retained in the
[changed-binary qualification](../benchmarks/runs/2026-09-11-snapback2-loop-budget-changed-binary/README.md).
The remaining action is a controlled setup repair that removes the launch
assessment without discarding the changed binary's first observation, followed
by two fresh qualifying samples. Byte-baseline and full-suite verdicts remain
separate.

## Fleet developer-trust recheck — 2026-09-11

The Apartment M5 Air was reachable through Silver with developer mode already
enabled. Its one listed Apple Development identity was not usable
noninteractively (`codesign` returned `errSecInternalComponent`), but two fresh
ad-hoc trivial-executable controls passed first launch at 0.411983 s and
0.373158 s. No security setting was changed.

Silver reported developer mode disabled and zero signing identities. Black
reported developer mode disabled and three valid identities, including a
Developer ID Application identity, but the strongest identity's
noninteractive signing probe also returned `errSecInternalComponent`. Black
was not loaded further while an unrelated Cargo test was active.

Two byte-distinct Snapback 2 release relinks at then-current integration head
`7a709d324` still failed the retained first observation at **0.720010 s** and
**0.556787 s** / 0.5 s. Their adjacent second samples passed at 0.030027 s and
0.031615 s, while the internal doctor reports were 57.232 ms and 59.461 ms.
Unified logging shows that both first launches still performed notarization
network work followed by XProtect/Gatekeeper scanning despite the pre-existing
developer-mode setting.

**Disposition remains open.** The fleet recheck rules out already-enabled
developer mode as a sufficient setup repair, and the only visible signing
identity could not be used without interactive credential state. The exact
[Air qualification record](../benchmarks/runs/2026-09-11-snapback2-loop-budget-changed-binary/air-recheck.json)
retains both failures; neither first sample was discarded.

## Four-plan implementation qualification — 2026-09-11

The integrated candidate's ordinary measurement at 15:38:58.398Z retains another
changed-release first-doctor miss: 0.658 seconds against 0.5, followed by 0.034.
Consumer smoke 13.35 seconds, project check 0.461, incremental rebuild 2.34,
release build 67.96 and init-to-dev 0.791 all meet their existing budgets. No
product workaround or security-setting change was made, and no prewarming
retry replaces this first-execution result. All functional consumer steps
passed; the chat receipt retains the no-effects-engine block. The distinct
[package-growth issue](./20260911-snapback2-package-growth-after-four-plans.md)
records exact pristine/candidate bytes and preserves the rejected baseline.

## Follow-up diagnostics — 2026-09-11

The header is broadened again: current measurements retain consumer and project
check failures as well as the unresolved changed-binary first-launch path. At
`2026-09-11T18:28:43.771Z`, consumer smoke takes **66.62 s** and project check
**1.524 s**. The final source at `2026-09-11T18:42:07.888Z` records **37.60 s**
and **1.163 s**, still above 30/1 seconds. All functional steps pass; chat retains
only the standard no-effects-engine block. The two direct doctor samples pass
in each run (0.267/0.066 and 0.218/0.057 seconds), but unchanged-binary passes
do not qualify the still-failing changed-binary criterion. Both failed metrics
and raw logs are retained; these are not retries accepted as a new baseline.

The slowdown spans npm installation, compiler/check, Vite, tests and incremental
building. Later host observations show pressure, but do not prove the cause of
earlier runs. There is no matched causal attribution or justified timing repair
in this pass. Preserve the original budgets and isolate the existing command
inputs under recorded host/cache state before changing product code.

The [release inspection](../benchmarks/runs/2026-09-11-snapback2-followup-diagnostics/doctor/report.md)
verified public 0.0.22 and 0.0.23 tarball integrity. Both CLI and media binaries
are ad-hoc linker-signed, without Team ID or hardened runtime; all four fail
Apple's explicit notarized-signature requirement. The publisher has no
Developer ID signing/notarization step. No product was launched or fresh-launch
claim made during this static assessment.

Next setup work needs a headless-usable Developer ID Application key and named
notary credential profile, then signing/notarization of the exact staged release
artifacts before ordinary first-launch controls. Existing private-key probes
failed noninteractively; no key was unlocked or machine security setting changed.
A published-release pipeline alone does not repair `measure.mjs`'s locally built
`target/release` binary, and notarization's timing benefit remains unmeasured.

A bounded identical-compiler A/B/B/A project-check control also retains four
misses: 1.560 / 2.574 / 2.088 / 1.260 seconds. The two middle candidate-path
observations are slower; that difference remains unexplained. Compiler leaves
and the already-launched native executable/inode were unchanged. Recorded host
load was 16.16–20.71 on ten CPUs, including this run's read-only Snapback1
inventory scan; this is not idle-host qualification or proof of a host cause.
All four command outputs/statuses and inputs are preserved in the follow-up
[control record](../benchmarks/runs/2026-09-11-snapback2-followup-diagnostics/project-check-control.json).
No further retry or budget change follows from this inconclusive control.

The final complete Snapback2 test script passes all product checks but takes
73 seconds on EPYC (18:50:18–18:51:31 UTC), above the separate 60-second suite
budget. This was also above budget in the preceding four-plan run (~68 seconds);
no matched timing experiment attributes the difference. The full passing log
and its first failed expectation-update run are retained in the follow-up.

## Incremental acquisition verification — 2026-09-11

The integrated `b5c73f084` source passes the complete test script on EPYC in
**68 seconds**, still above the 60-second suite budget: 1,368 package tests,
1,127 native tests, compiler/evaluator phases and doctests pass. Initial setup
failures in the ignored qualification copy were missing TypeScript dependency
links and the LLP 1003 fixture; those were repaired without product edits.

Pinned Node 24.18.0 measurement at `2026-09-11T20:31:56.073Z` retains another
project-check miss: **1.012 seconds** against 1 second. Consumer verification
23.4 seconds, warm build 0.12, incremental rebuild 3.09, and direct doctor
0.037/0.038 all pass their budgets. These doctor passes are Linux measurements;
they do not qualify the macOS changed-binary condition above. No retry replaces
the project-check miss, and no causal attribution to the acquisition delta is
claimed. The compiler/owner acquisition comparison is a separate frozen cohort.

The canonical raw record carries the private qualification copy's inherited
Git SHA `dd629ae33`; its source manifest and context explicitly bind `b5c73f084`.
The [acquisition record](../snapback2/metrics/acquisition-20260911.json) retains
the binding, byte-growth red, passing functional phases, and failing budgets.

## Bounded bulk acquisition verification — 2026-09-11

The final bounded-batch implementation and cancellation repair pass the complete
Snapback2 test script on EPYC in **54.79 seconds**: 1,138 native tests, 1,423
package tests, compiler/evaluator phases and doctests pass. This is one passing
script duration, not qualification of the complete five-check budget. Earlier
failed runs, their setup omissions, real regressions and subsequent repairs are
retained with the final source preflight in the acquisition evidence.

The canonical loop separately passes consumer verification (13.320 seconds),
project check (0.433), both doctor samples (0.433/0.028), incremental rebuild
(2.490), warm build (37.51) and init-to-dev (0.829). It still exits nonzero for
the existing package-growth guards. Its source precedes the final
cancellation-only guard; final package bytes were measured separately using
the canonical closure function. No sample or byte baseline was replaced.
These observations do not establish the cause of prior timing failures or
close the changed-binary macOS qualification described above.

The final V6 foreground repair passes a fresh complete-script run in
**105.234 seconds**, so the duration is again above the 60-second budget.
All **1,431 package tests and 1,138 native tests** pass, as do compiler,
evaluator and doctests. The final source manifest was checked at all 1,144
entries before execution. The qualification copy rebuilds native artifacts
(20.55 seconds before parallel phases); native phase duration is 81 seconds,
package 48, compiler 40, evaluator 6 and doctests 14. Phases overlap and must
not be summed. This is not a matched experiment attributing timing growth to
the small client recovery repair. Both actual runs remain in the record; no
rerun replaces the 105.234-second budget failure or raises the limit.
