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
