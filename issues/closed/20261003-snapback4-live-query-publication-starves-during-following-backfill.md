# Matching live query replies can wait for publication during Following backfill

**Status:** Resolved (2026-10-05)
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

The [LU report](../../snapback4/reports/20261003-lu-live-update-latency/REPORT.md)
retains before/after summaries, per-update stages and reproduction commands.
No claim is made that this reduced fixture identifies the exact cause of
calibration #30's separate frozen-app attempts. The independent
[replay throughput issue](../20261002-snapback4-following-replay-delivery-backlog.md)
also remains open.

**2026-10-04 — LU round 1:** the corrected scheduler guarantees a slice within
P declaration visits despite new arrivals. A fresh 30-trial no-burner run, with
all experiment threads confined by taskset plus the inherited affinity guard,
still measures repost p95 757.7 ms and maximum 780.0 ms. (Round 0's taskset-only
browser confinement was incomplete; see the report's correction.) In round-1
trial 23, Carol's fresh delivery commits at +39.4 ms, publication at +39.5 ms,
receipt at +42.7 ms, and matching evaluation at +43.0 ms. Observation publication
is +779.4 ms and render +780.0 ms: 736.4 ms after matching evaluation. Inspection
queue p95 is 0.1 ms and attempt p95 15.7 ms. This independently preserves the
follow-up's scope; no concurrency, authority or retention bound was relaxed.

**2026-10-05 — OP resolution:** fixed the client publication-progress path.
Current-main tracing reproduced a matching reply at +16.9 ms rejected by
repeated authority/change evidence until publication at +799.6 ms; a later
baseline repeated the shape at +41.6 → +1,123.7 ms. A whole-server reply can
now cover sequenced evidence at or below its cut, while compositions separately
prove unchanged local inputs and a covering external cut. Hard boundaries,
immediate scope withdrawal, predictions, store replacement, unpublished cuts,
retained routing and unaccounted watch-version advances remain fenced.

Two final 30-trial idle repost runs measure p95 **105.5 ms** and **81.0 ms**,
below 500 ms. The adjacent baseline is 709.4 ms. Repost and message tails
improve; reaction/browser tails vary, and the report retains those limits
rather than claiming zero regression in every statistic. Paired ordinary-live
controls show p95 increases below 1 ms, with server-only queries faster.
Thirty confined hog repetitions pass (16,950 cases), followed by the complete
Snapback 4 suite. Wasm stays 639,810 B gzip, preserving the 130 B macOS
allowance under the unchanged cap. This resolves the repeated-evidence
publication problem, not the independent replay-throughput ticket or a frozen
calibration result. See the [OP report](../../snapback4/reports/20261004-op-observation-publication/REPORT.md)
for all stage stamps, negative controls, full qualification and limitations.
