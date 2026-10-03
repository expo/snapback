# Matching live query replies can wait for publication during Following backfill

**Status:** Open
**Date:** 2026-10-03
**Scope:** Snapback 4 web local observations, change evidence and server fallback
**Source:** Lane LU, `reports/20261003-lu-live-update-latency/REPORT.md`

LU fixes the server's oldest-item delivery selection. Its three-browser fixture
still has an idle repost p95 of 929.3 ms, above the requested 500 ms, with 1,000
historical posts and an unfollow/refollow immediately before each measured
write. The fresh delivery is no longer waiting for the backfill to drain.

Candidate idle trial 5 (Bob) commits the fresh delivery at +1.3 ms and decodes a
matching `/q/home` response at +21.3 ms. Observation publication is +992.0 ms;
React renders at +992.6 ms. Over that interval, repeated `/q/home` replies and
backfill/change/sync activity continue. The inspection sample's observation
queue p95 is 0.5 ms and attempt p95 is 16.1 ms. Increasing the eight active
attempts or loosening retry timers does not address this measured shape.

`LocalReads.notified`, `changed` and `applied` advance evidence; the query's
checkpoints and `rerun` reject older authority/change versions. These guards
also fence predictions, revocations, membership loss, store replacement,
unpublished sync cuts and mixed local/server answers. This is a publication
progress problem under repeated evidence, not permission to remove the guards.
Investigate admission/coalescing or a sound cut-aware publication proof, with
the existing cross-tier authority and scope-removal regressions. A fix must
preserve immediate withdrawal and never bless an old local component using a
newer server cut.

The [LU report](../snapback4/reports/20261003-lu-live-update-latency/REPORT.md)
retains before/after summaries, per-update stages and reproduction commands.
No claim is made that this reduced fixture identifies the exact cause of
calibration #30's separate frozen-app attempts. The independent
[replay throughput issue](./20261002-snapback4-following-replay-delivery-backlog.md)
also remains open.
