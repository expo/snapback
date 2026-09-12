# Browser acquisition remains expensive and generic indexes dominate storage

Status: Open
Date: 2026-09-12
Scope: Snapback3 browser acquisition, SDK processing, persistence and server indexes
Related: [LLP 2000](../../llp/2000-snapback3.rfc.md), [focused Clique run](../../benchmarks/runs/2026-09-12-snapback3-clique-focused-astra-medium/README.md), [CPU diagnostic](../../benchmarks/runs/2026-09-12-snapback3-clique-focused-astra-medium/profile/README.md)

The planned acquisition work and under-three-second 10k endpoint are now
specified in [LLP 2000 §16](../../llp/2000-snapback3.rfc.md#16-making-acquisition-fast).
They are implementation targets, not performance achieved by this package.

The fixed experimental package at source
`409954115f151a72dd95e897c5f00f36877f11e0` has now been measured through the
browser SDK, HTTP owner and IndexedDB. The earlier worker-only timing did not
predict the whole acquisition experience.

The builder's final 10,000-message acquisitions took 32.649–33.646 seconds.
An independent startup-send control took 33.797 seconds and passed complete
offline pagination. Delayed-send repetitions fetched the IDs in 34.778 and
35.432 seconds but failed retention, tracked in the
[separate correctness issue](20260912-acquired-history-lost-across-sequence-advance.md).
Those failures cannot count as successful complete durable acquisitions.

All three final builder attempts for the 100,000-message account timed out at
180 seconds with roughly 42,500–42,900 IDs fetched. The independent repetition
also timed out, at 38,900 IDs. Partial results and every earlier attempt are
retained. Neither full acquisition nor the first full offline endpoint is
qualified for that account.

A separate, instrumented no-send diagnostic acquired the exact 10,000 IDs in
23.666 seconds. Its profile interval was 25.101 seconds. CPU self samples
attributed 6.124 seconds to SDK frames, 2.832 seconds to React, 2.692 seconds to
other framework/helpers, and 1.334 seconds to GC. Source mapping limitations
are recorded. Node owner and Rust worker used 1.08 and 3.22 CPU-seconds during
the measured interval. The 8.037 seconds of summed storage-adapter await
intervals include transaction/scheduling/serialization waits and do not isolate
disk cost. These overlapping quantities must not be added into a wall-time
breakdown. One instrumented run does not replace the ordinary repetitions.

The diagnostic stopped its heap sampler before database inspection: sampled
peak 232.9 MiB, end 105.2 MiB, after explicit GC 48.8 MiB. Ordinary benchmark
heap samples also include driver-held acquired arrays, `getAll()`/JSON audits
and offline replay; their last sample is not retained steady-state heap.

Read-only server inspection attributes 55,689,216 of 113,262,592 logical
database bytes (49.17%) to the generic index family. The static seed's touched
inventory accounts for most of the 23,511,040-byte commit table. Before owner
shutdown the builder measured 113,209,344 database bytes plus 112,908,632 WAL
bytes; shutdown/read-only inspection observes a checkpointed file. No vacuum
or compaction was applied. This messaging projection omits full social scale
and per-message public-mutation receipt load, so its total cannot be compared
directly with Snapback2's full 5.2 GB application.

Next work should use the retained profile to remove measured repeated browser
work, inspect acquisition scheduling and resource demand, then qualify a
source-matched cohort with exact content, durable admission, offline reopen,
foreground sends and cleanup. Treat index representation as a measured
follow-up with equivalent lookup/write/deletion/authorization requirements.
Do not trade away the declared dataset, receipts or correctness to improve a
timing. No SDK or storage repair was applied during this benchmark.
