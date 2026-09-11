# Fixed-source acquisition comparison

**The acknowledgement projection remains the strongest narrow next experiment.** Fixed source completes the exact 10,008-message durable check in **66.342 s**, versus r2 **70.007 s**. Both use the same owner, compiler and Chromium; the runtime/app hashes differ and are retained in JSON. This is one instrumented run per source, so the 3.666 s difference is descriptive, not a qualified speedup.

| Sampled cost, seconds | Old r2 | Fixed |
| --- | ---: | ---: |
| `deliveryAcks` inclusive | 15.674 | **13.542** |
| JSON copy self under `deliveryAcks` | 10.824 | **9.352** |
| `raw` self under `deliveryAcks` | 4.508 | **3.870** |
| `pendingAcknowledgements` enumeration self | 2.703 | **2.309** |
| Generic detached outbox reads inclusive | 5.989 | 5.341 |
| Acknowledgement cleanup inclusive | 5.893 | 5.636 |
| Entire swap-journal module self | 11.640 | 10.646 |
| Garbage collection self | 9.556 | 9.600 |
| React root work inclusive | 5.229 | 5.223 |

Inclusive rows and their child self times overlap. Async waits are not included in sampled caller totals. The generic detached-read selector is still absent across the async boundary.

The activation fix removed repeated inbox reads: **421 → 8**, while readwrite transaction count stays **613**. Inbox-read summed lifetimes fall **19.629 → 0.912 s**; total IDB interval union falls **24.675 → 10.743 s**. API counts remain **201 inbox pages, 201 ack mutations, 203 groups queries**; network request-to-header union is **10.998 → 10.755 s**. These I/O intervals overlap CPU and cannot be added to, or independently subtracted from, wall time.

A `pendingDeliveryAcks(): Record<string, number>` projection selecting records whose intent is falsy matches today's `pendingAcknowledgements` selection. Build the detached primitive result after the same store-tail and partition/seal checks. Preserve the entire persisted acknowledgement dictionary, tuple retry marks, event keys and sequence numbers; bound retry records remain excluded until the existing accepted-redelivery transition changes them. This can eliminate full retained-tuple traversal/copying inside `clone` and duplicate consumer enumeration. **Selecting from the full dictionary still scans all acknowledgements**, so the experiment does not establish bounded asymptotic read cost and needs a fresh profile. No retained-state deletion, new index or receipt transition is needed for this scope.

The 13.542 s sampled read path is an opportunity, not a predicted wall-time saving. GC is unchanged and cannot be assigned to acknowledgement allocations from CPU samples alone. Fixed heap at capture is 854 MB used, compared with 455 MB previously; these endpoints occur at different GC phases and do not establish a memory regression.

Full fixed-source attribution: `profile-analysis-fixed-profile10008.json`; compact paired fields and input hashes: `profile-fixed-comparison.json`. The helper now recognizes saved `navigationStartedAt` and browser time origin in the fixed record. No production files or remote work were changed.
