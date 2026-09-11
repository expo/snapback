# Pending-ack projection result

**The intended full-copy cost is removed; the 30-second target is still unmet.** The projected source completes the exact 10,008-message durable check in **53.634 s**, versus **66.342 s** for the preceding fixed source and **70.007 s** for old r2. These are individual instrumented runs, not a qualified latency distribution. The observed fixed→projected difference is 12.708 s; it is not an independent causal savings estimate.

| Sampled cost, seconds | Old r2 | Fixed | Projected |
| --- | ---: | ---: | ---: |
| Full/projected acknowledgement read, inclusive | 15.674 | 13.542 | **1.283** |
| Consumer `pendingAcknowledgements`, self | 2.703 | 2.309 | **0.027** |
| All `jsonState`, self | 15.104 | 13.147 | **4.387** |
| Generic detached outbox reads, inclusive | 5.989 | 5.341 | **5.960** |
| Ack cleanup, inclusive | 5.893 | 5.636 | **6.109** |
| Garbage collection, self | 9.556 | 9.600 | **10.449** |

The former acknowledgement→clone→JSON/raw path disappears. The new pending selection still scans the retained dictionary, but returns detached primitive sequences without copying every retained tuple. Inclusive rows overlap their children and must not be summed.

The next dominant **mapped application paths** are ack cleanup under serial commits (**6.109 s inclusive**) and other detached outbox reads (**5.960 s inclusive**). The latter contain **4.089 s JSON self + 1.388 s raw self**; the asynchronous profile does not identify the selecting caller, so a labeled read counter would be the next diagnostic before considering changes. GC is the largest sampled category at **10.449 s**, but this profile cannot attribute it to specific allocations. React root work remains 4.874 s inclusive and coverage application 4.751 s inclusive. No additional optimization is proposed for this run.

Network records show 201 inbox pages, 200 ack mutations and 202 groups queries; the request-to-header union is **10.922 s**. IDB records show 612 readwrite and 6 inbox-read transactions (619 total), with lifetime union **10.548 s**. The small count changes reflect this capture; physical content remains exact. Network and transaction lifetimes overlap CPU and each other, so they cannot be treated as independent elapsed blockers. Renderer ThreadTime is 47.687 s; endpoint heap is 604 MB, not a peak or steady-state measurement.

The source map captures the pending-selection loop inline in `store/range-store.ts:551`. Final source subsequently extracts that same loop into `delivery-acknowledgements.ts` to meet the file-length cap. Read-only comparison verifies the loop matches after substituting the `acks` parameter; existing tail/partition/seal checks remain at the store boundary. **This profile binds the pre-extraction runtime artifact**, while final tests bind the moved source. No claim that the final emitted artifact was reprofiled is made.

Full projected frame/module attribution: `profile-analysis-projected-profile10008.json`. Compact comparison, source/input hashes and relocation check: `profile-projected-comparison.json`. All source variants used the same owner/compiler and Chromium, and matched the same durable message hash. **No 30-second qualification or publication qualification is granted.** No production changes or remote workload were performed by this analysis.
