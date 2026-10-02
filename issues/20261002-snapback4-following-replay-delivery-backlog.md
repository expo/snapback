# Following delivery remains thousands of tasks behind a completed replay

**Status:** Open
**Date:** 2026-10-02
**Scope:** Snapback 4 Following background delivery
**Source:** CT rounds 2–3, calibration #28 50%-scale preparation

The Following guide says foreign events normally arrive within a second on an
idle host. Settling 88,143 replay actions through the actual 50% checkpoint leaves
thousands of durable deliveries pending. Round 2's eb1000 preparation left 5,221;
on restart its first empty snapshot was 23.560 seconds later (about 220 tasks/s).
The operator's Mac store still held 15,175 tasks after its debug probe. A feed
answer changed 37 ms after the corresponding delivery commit, although both
answers had `complete: true, fresh: true`. Completeness covers reader backfill
and cleanup, not unfinished new-event delivery.

Tasks drain only while a server runs. Mac history includes long server-off gaps;
the observed 1,087.226-second gap after the final application mutation is not a
continuous-drain measurement. The Mac's full drain time remains unmeasured.

This is a product latency finding, not merely a nondeterministic benchmark.
Calibration checkpoint probes run immediately after replay checkpoints while
this work competes with reads; queue settlement must not be assumed from repeated
equal answers. Investigate delivery service capacity and the guide's normal
latency expectation under large replays, with durable backlog/age measurements.
Do not mask pending new-event delivery by changing ordering or completeness.

Evidence: [round-2 report](../snapback4/reports/20261001-ct-contended-reads/REPORT.md#round-2--queued-exits-faithful-qualification-and-mac-findings-2026-10-02),
including the exact Mac source/delivery commits and Linux restart observations.
CT round 3 adds priority comparisons during real backlog drain to that report.
Delivery throughput improvements are explicitly outside CT's scope.

Round 3 prepared the same 88,143-action, 50%-scale checkpoint anew. The final
preparation observation contained 6,551 pending deliveries; the stopped store
retained 6,507 after another 44 completed during shutdown. Every comparison
restores this identical stopped database **and its committed WAL**, rather than
reusing a store partially drained by the previous design. The retained metadata
binds both files and the initial queue count.

The twelve round-3 trials all drain and agree on the eight settled answers.
With no owned synthetic busy processes, 6,507 tasks take 29.291–37.699 seconds
across the three designs while the builder probes run (roughly 173–222 tasks/s,
including startup and observation). At 96 busy processes, ordinary-all takes
87.176/100.813 seconds, split 124.531/167.005, and demoted-all 260.588/185.044.
This is a shared host, not an exclusive idle-host qualification. The
[per-trial drain record](../snapback4/reports/20261001-ct-contended-reads/round3/DRAIN.md)
retains queue observations, query latency and the same starting-store custody.
Changing priority trades query tails against drain time; it leaves the replay
backlog product finding open.

## Lane FD (2026-10-02, shelved)

Lane FD tried to raise delivery throughput on branch `sb4-intent/fd-following-delivery`; its reports are on that branch under `snapback4/reports/20261002-fd-following-delivery/`.
- **Round 0 (19ed7f0dec)** batched copies, follower pages and index writes, giving 1.26–1.48× the production fixture's copies per second. About 63% of the remaining per-copy cost is the durable FULL commit, because the cooperative slice forces a commit roughly every 24 copies.
- **Round 1 (8f38c7a324)** let a delivery transaction run until other engine work queued. It reached only 1.27× idle and regressed writer p95 to 41 ms idle and 70 ms loaded. It did, however, keep zero pending Following work at every calibration checkpoint, while main and lane CT reproduced the backlog.
- **Shelved:** neither round met the 3× gate. A future design needs delivery that keeps up during a replay without long, writer-blocking transactions, for example group commit with request writes, or delivery off the writer path.

## Lane LM investigation, 2026-10-03

Status remains **Open**. The [LM report](../snapback4/reports/20261003-lm-live-margin/REPORT.md)
separates durable Following task delivery from the local client's `follow()`
change-feed loop. Its two-device reaction/delete harness has no Following
declaration or generated delivery work. It therefore measures direct committed
row propagation without silently waiting for or conflating a Following backlog.
At N=20 per operation and condition, 16 busy loops pinned with the harness to
CPUs 80–83 increased reaction-removal commit-to-React p95 from 81.21 to 323.52 ms;
none crossed ten seconds. These observations neither repair nor remeasure the
6,507-task replay backlog above. The historical drain numbers and the distinction
between `complete/fresh` and pending new-event delivery remain unchanged.

The change-feed trace now stamps committed mutation completion, allowing a
future replay investigation to distinguish delay before a derived delivery
commit from delay carrying that commit to the device and UI. No delivery
throughput, queue priority, transaction size or completeness change lands in LM.
