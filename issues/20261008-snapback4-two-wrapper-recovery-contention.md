# Snapback 4: two-wrapper publication test assumes success during recovery custody

Status: Open
Date: 2026-10-08
Scope: `witness_two_wrappers_killed_after_exchange_leave_only_survivors_verified_export`

FS removed unrelated libtest forks from this scenario, fixing its observed `retention lock busy` symptom. In isolated loaded run `fixed-witness/021.log.gz`, the intentionally concurrent survivor still refused `E_WITNESS_PROCESS: interrupted publication still has wrapper custody; preserved .../runs/1-123/export`, then the parent timed out waiting for `runs/9-123/verified`. The subsequent recovery logs show the old transaction restored and the now-failed survivor recovered. This is a different signature from inherited descriptors held by unrelated tests.

The scenario deliberately races `cleanup_inner(..., Some(old_run))` with the surviving publisher after killing the first publisher. Recovery holds run/export custody; publication's nonblocking old-export acquisition conservatively refuses that custody. Process isolation does not serialize this intentional race. Investigate a deterministic rendezvous and safe publication retry after the competing recovery releases custody, while preserving concurrent recovery and all survivor inventory/old-tree assertions. Do not weaken product custody or merely extend the 15-second file wait.

Evidence: [FS report](../snapback4/reports/20261008-fs-witness-worker-flakes/REPORT.md). No survivor-success claim is made for the failing run. This test/fixture remains present and all its existing assertions are retained.
