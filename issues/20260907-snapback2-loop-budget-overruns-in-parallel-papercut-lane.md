# Snapback 2 loop measurement exceeds consumer, check, and doctor budgets

**Status:** Open
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
[full-suite timing ticket](20260901-snapback2-scripts-test-sh-flakes-under.md)
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
