The round-0 findings are addressed as design requirements. In-place initialization is a reasonable simplification, and I found no new disclosure path or lost-write counterexample when the stated fences hold. One liveness gap remains: the required per-reader roster merge has no specified way to progress when its heads exceed a chunk’s meter.

| Round-0 finding | Round-1 disposition |
|---|---|
| Durable reservation; execute at most once | Resolved in §4.1: durable identity binding, duplicate joining, authority recheck, and atomic execution/outcome settlement. |
| Fence epochs; publication high-water | Resolved in §4.1–4.2, including indirect writes and non-HTTP writers. |
| Publication recount; pending reads everywhere | Resolved normatively in §4.2: exact task coverage, proved zero obligations, all read forms, private synced pending metadata. |
| Round-robin scheduling | Declaration starvation is resolved in §4.1. The new merge requirement introduces a separate progress problem below. |
| Admission isolation | Resolved in §4.1: separate bounded waiters, retained executable capacity, and nonblocking maintenance deferral. |
| Newest-first roster; no refill | Resolved in §3, including merging across a reader’s actors and own events. |
| Unlogged staging; preserve other slots | Resolved as a requirement in §4.2. Existing projection helpers do not yet supply the required isolation. |
| `backfill` with roster ID | Resolved in §3.6 without expanding the shared Work enum. |

The newly included older-history example is also correctly documented.

1. **High — Finite rosters do not establish progress for the reader-wide merge.**  
   **Location:** RFC §3.7, lines 164–167; §4.1, lines 220–226.

   The scheduler guarantees turns, but the merge may park before consuming a roster member. Nothing specifies persistent progress while discovering or comparing heads.

   **Counterexample:** a reader follows 16,385 actors, each with one retained event. An implementation that rebuilds the head merge on every invocation needs at least 16,385 head examinations before safely selecting the newest event. The existing job ceiling is 16,384 examinations ([meter.rs](/home/ccheever/sb4-intent/review-fa-r1-astra/snapback4/crates/snapback4-core/src/meter.rs:30)). It parks despite every row fitting individually and the launch being finite. Round-robin selection cannot finish that reader. The proposed 5,000-follow fixture does not establish behavior beyond this boundary.

   **Smallest fix:** specify resumable head discovery and selection. For example, build a persisted, ordered per-reader head index in metered checkpoints; copying advances only the selected roster and updates its head atomically. Permit chunks to make durable frontier-construction progress before copying. Aggregate follow count must not force permanent parking merely because all heads cannot fit in one chunk.

2. **Medium — Predecessor-column isolation requires an explicit implementation change.**  
   **Location:** RFC §4.2, lines 237–242; [disclosed.rs:152](/home/ccheever/sb4-intent/review-fa-r1-astra/snapback4/crates/snapback4-core/src/value/disclosed.rs:152); [partition.rs:995](/home/ccheever/sb4-intent/review-fa-r1-astra/snapback4/crates/snapback4-core/src/partition.rs:995).

   The RFC correctly requires the predecessor to expose only its columns. Today, `project_fields` filters field authority and supplies defaults; it does **not** discard fields absent from the supplied schema.

   **Counterexample:** initialization commits a new slot on one source row. A predecessor `/sync` snapshot reads that physical row and projects it with the old table definition. The undeclared slot survives. An earlier ordinary log put can also expose it because delivery normalizes puts from current stored images. Making initialization unlogged does not prevent either path.

   **Smallest fix:** explicitly require generation-aware removal of candidate fields before predecessor query pricing/results and snapshot/log delivery. Test both snapshot reads and normalization of a pre-initialization log entry between chunks, including cancellation. The RFC’s fallback to replacement images remains appropriate if this cannot be established.

3. **Medium — The pause plan needs a complete publication cost and a numeric decision rule.**  
   **Location:** RFC §4.2, lines 244–258; §5, lines 369–403.

   Task creation is O(F + U), but the publication paragraph also requires verification of every event’s slot/birth, required rosters, indexes and dependent aggregates. That complete verification is not generally O(F + U).

   **Counterexample:** hold follows and readers fixed while increasing one actor from 1,000 to one million retained events. The stated task term barely changes; the required event verification grows substantially inside the publication transaction. Page-level meter resets in the activation walker do not release that transaction or its writer lock.

   **Smallest fix:** distinguish task construction from the entire publication verification pass, name every population it traverses, and measure the whole transaction. If some checks move to durable preparation, specify the evidence publication validates; an initialization cursor alone remains insufficient.

The simpler alternative’s analysis is otherwise right. Ordinary backfill divides responsibility using admission tokens, rechecks the edge, and commits copies with its cursor. Concurrent writes do not require holding the application fence throughout copying. But later-born, backdated events can continually appear below the descending cursor: they consume examinations without consuming `remaining`. Unmodified backfill therefore supplies neither the frozen no-refill contract nor its bounded-progress argument.

Finite rosters are justified. Deferring retained own copies is also acceptable for “start this feed now,” provided the reader remains pending and new own posts retain their immediate copies. Measure time to the first useful page and to completion for the hot actor’s own feed; its retained own roster is uncapped.

The measurement plan covers the right dimensions: realistic skew, fixed-principal growth, authenticated traffic, saturated admission, delivery delay, disk/WAL retention, process death and halfway device acquisition. Its qualifications on the old measurements are now correct: those samples establish no bound on the new initialization pause.

My recommended shipping gate is **a maximum normal-operation fence of five seconds in every measured supported fixture and load case**, including publication—not an average or a percentile inferred from three adoption runs. Fix hardware, offered load and the supported scale envelope before measurement. Count admission refusals and timed-out clients, and require the accepted queue to drain under a load that the no-adoption control sustains. Lost writes, duplicate effects, false completeness and stale above-floor device images have a zero-tolerance gate. If five seconds fails, revisit online preparation with a short drain/publication fence; do not relax the threshold after seeing the result. This is a proposed acceptance bar, not existing qualification.

I would take implementation evidence in this order:

1. Prove predecessor projection and cancellation with an old query/sync reader attached; demonstrate resumable merging beyond one chunk’s head capacity.
2. Exercise the durable fence/reservation state machine through retries, revocation, slipped writers and process death. Include saturated admission and blocked maintenance.
3. Prove publication coverage and device completeness together: zero-task readers, every Feed read form, dependent folds, halfway acquisition, removal/refollow, and old-device rejection. Ensure application pending checks do not prevent the engine’s own copy/idempotence machinery from progressing.
4. Run the integrated measurements against the predeclared gate.

The existing card fix can stand. The next work should be focused proof implementation after specifying merge progress; the text is not yet sufficient to implement and enable the publisher confidently.

Review remained read-only. No files were changed.

**Verdict: NOT READY.**