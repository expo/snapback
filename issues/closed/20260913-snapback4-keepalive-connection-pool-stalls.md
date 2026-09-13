# Snapback 4: accepted keep-alive connections can wait seconds for a worker

**Status:** Resolved
**Priority:** P0
**Date:** 2026-09-13
**Systems:** `snapback4`, tiny_http 0.12.0 connection dispatch
**Author:** Codex / GPT-6 Astra

Longer runs of the verified 100,000-product public catalog exposed multi-second
request stalls in both published 0.1.15 and a borrowed-JSON candidate. The
ordinary p50/p95 can conceal these stalls; retain maximum latency and elapsed
throughput when assessing concurrency.

In tiny_http's `src/util/task_pool.rs`, `spawn` queues work whenever the idle
worker count is nonzero. A notified worker remains counted until it reacquires
the queue lock. Several accepts can therefore reserve the same worker. Each
task owns a whole persistent connection; surplus queued connections may wait
until an existing connection closes. The queue length must also reserve the
reported idle capacity: spawn another worker when
`queue.len() >= waiting_tasks.load(Ordering::Acquire)`.

A deterministic regression holds the real dispatch lock across five arrivals
with four idle workers. The old predicate starts four tasks and fails; the
fixed predicate starts five and passes. All ten library unit tests in the
prepared dependency copy passed. In three alternating pairs of 1,000-sample
catalog runs, point reads at concurrency eight had maxima of 4.17–5.27 s in
the control and 16.75–51.16 ms with the one-line dependency fix. Median per-run
throughput was 215.2 versus 1,528.8 requests/s. Every run reverified all 100,000
rows and asserted every timed result. This establishes a stall/throughput
improvement; it is not a uniform p50/p95 or competitor win.

The prepared review used a trimmed tiny_http 0.12.0 library with the queue
fix, a private dispatch helper for its regression, the original README and
both licenses. The tested HTTP experiment changed only the predicate; the
helper/test form was subsequently qualified after integration below. The registry
archive checksum is
`389915df6413a2e74fb181895f933386023c71110878cd0825588928e64cdc82`.

The author explicitly approved the reviewed vendored fix and its one new
Cargo manifest on 2026-09-13, satisfying `rules/RULES.md`. Main independently
landed a tiny_http copy with a bounded unread-body drain while this candidate
was being qualified. Integration puts the reviewed task-pool source in that
existing `snapback4/vendor/tiny_http` copy and preserves the drain fix; no
second dependency copy or new manifest is added. The existing workspace patch
selects it and excludes it from workspace membership. Its library tests are
qualified explicitly. The proposal, initial source
and independent review remain in the ignored run directory
`.llp/ship-runs/sb4-performance-20260913/` (`transport-fix-proposal.md`,
`tiny-http-manifest-changes.patch`, `tiny-http-queue-fixed-review/`,
`transport-stall-review.md`, `queue-results/`). No shared registry cache was
patched. The platform package includes the dependency's MIT notice in its
published files.

Integrated source `43569823cf89d6e685fd4cf2712a2e6b8c4cae92` passed all twelve
combined dependency tests on Linux, three Darwin HTTP/version tests, six
real-HTTP bounds tests, and the Rust workspace and available client tests on
Linux. In fresh production-profile comparisons (trials 12–14), all 24,000
Snapback requests passed their assertions and the maximum latency was
124.371 ms. Each run included connection expansion and full fixture
verification. Both competitor backends were remeasured in the same rotating
batch. The [catalog record](../../benchmarks/runs/snapback4-public-catalog-20260913/README.md)
retains the raw records and remaining competitor gaps.

Resolution: the approved fix landed on main in `4e126d206`, followed by its
production comparison record in `d5215e6d2`. The existing HTTP lifecycle tests
and matched workload qualified the integrated helper/test form without
disabling keep-alive or adding concurrent warmups. The complete Darwin
publication suite then passed every stage in 112 s, including all 94 client
tests with no skips. The separate suite-budget issue remains open; publication
status is recorded in the catalog record.
