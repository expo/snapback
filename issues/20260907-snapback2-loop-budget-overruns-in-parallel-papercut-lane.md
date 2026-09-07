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
