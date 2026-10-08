**READY WITH CHANGES.** Three diagnostic fixes are required:

- **P2 — Bound capture and retention.** The helper copies matching files in full, with no total byte/file limit or snapshot cleanup policy. A probe copied a 16 MiB log unchanged. Add bounded tails, inventory limits, truncation markers and evidence retention limits.
- **P2 — Exclude unrelated process data.** Recorded PIDs are collected without checking birth identity. A synthetic stale record caused capture of an unrelated process’s full command line—including a synthetic token—and descriptors. Validate identities, restrict captured arguments and use private file permissions.
- **P2 — Prevent tracing from blocking custody.** With tracing enabled, a FIFO at `retention-trace.jsonl` blocked an observer beyond its supplied deadline while holding the queue lease. Reject nonregular sinks and keep diagnostic emission from delaying deadlines or cleanup.

The queue and retention decisions are unchanged. I found no additional ordinary lost-wakeup or unintended lease-survival path. The documented parked/error/peer-loss states still require the next-export backstop. The drain predicate and **90-second guard remain unchanged**.

The snapshots successfully distinguish held custody from a missing observer. Test helpers and reports are excluded from package publication, and release binaries do not write the trace.

Validation on **eb1000 only**:

- Export-background: **58 passed, 36 Darwin skips**, zero failures/cancellations; 315 seconds.
- Controls: **both rejected at the original drain assertion**, then cleaned up.
- Retention tests: **2 passed**; recovery tests: **10 passed**.
- All 14 retained archive hashes matched; independently recounted **389 invocations / 1,574 passes**.

[Full review, source locations and evidence](/home/ccheever/sb4-intent/reviews/em-r1.astra.evidence/review.txt). Historical failures remain unexplained; keep the tickets open. No source changes or pushes. One Cargo target, **811 MiB**.