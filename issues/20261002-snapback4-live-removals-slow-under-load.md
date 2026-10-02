# Snapback 4: cross-client removals miss a 10 s live window under host load; an empty-list transition during settlement

**Opened:** 2026-10-02, from calibration #29 (snapback4 0.4.11), grader defect d-03 (minor) and the builder's essay
**Area:** client live delivery (change feed → device apply → observation → render), LLP 3000.023
**Status:** In progress — sb5 lane LM on eb1000 (`~/sb5-lanes/lane-lm`, branch `sb5/lm-live-margin`)
**Related:** `issues/20260930-snapback4-live-propagation-notification-sync-intermittent.md`, `issues/20261002-snapback4-following-replay-delivery-backlog.md`

## What happened

Across the grader's runs, 4 of about 45 two-client live-update attempts exceeded the frozen harness's 10 s observation ceiling under shared-host load: reaction-chip clearing (all 3 attempts in two isolated-segment runs), a delete-for-everyone tombstone (1), and video readiness (1). In isolation, best-of-3 timings were reaction set 798 ms, replace 797 ms, remove 1,346 ms, and API-driven 1,335–3,484 ms. Removal is consistently the slowest path.

Separately, the builder's essay reports that with two devices' offline sends settling, "a rendered-list assertion could observe an empty transition during settlement". That was on 0.4.11, which already includes lane RV ("answers stay on screen").

## Wanted

The per-stage timing of a removal, unloaded and under controlled contention; the load-sensitive stage, if Snapback owns it; a regression test; and an answer on which path publishes the empty transition.
