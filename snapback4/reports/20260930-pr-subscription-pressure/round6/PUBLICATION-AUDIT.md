# Publication audit: live-answer replacement coverage

This extends [round 5's complete result and saved-answer audit](../round5/PUBLICATION-AUDIT.md).
Its authority fences remain unchanged. Its live-answer revalidation claim needed
the liveness correction below: withdrawal alone did not guarantee replacement.

**Every owner invalidated by apply must receive replacement work, whatever the
replica footprint, retention setting or change cut.** Scheduling must carry the
owners selected before invalidation; it cannot infer them afterward from data
or deadlines that invalidation may clear.

| Live-answer route | Replacement coverage and remaining fence |
| --- | --- |
| Server answer outside the replica horizon | `invalidateAnswers` returns its affected owners. The committed apply callback adds each to sync's existing `resumed` set. The `finally` block schedules live members of that set even when all footprints are empty and no cut exists. |
| Server/composed answer with disjoint or unknown footprint | The same set carries the actual invalidated owners. Existing table/provenance scheduling remains; neither the footprint nor `keep` can remove an already-selected owner. |
| Recovered remembered answer | Selection happens before `answers.committed` clears deadlines for nonretaining owners, including `localWakeup` provenance. The returned owner references survive that clearing. Memory retirement and publication authority are unchanged. |
| Apply followed by failed post-commit work | The set is populated in the committed callback before media reconciliation, publication-metadata reads or a lost adapter acknowledgment can throw. Sync's existing `finally` path still schedules it. |
| Staged scope cut | Scheduling does not grant publication: `scheduleRead`, `deferUntilSync`, `answers.current` and the final publication predicate still enforce scope/sequence cuts. A parked owner resumes when the actual watermark discharges its cut. |
| Close or detach during sync | The final loop walks the current live map; the saved set cannot reinsert an owner. Detached getters/resubscriptions still check the shared authority revision. |
| Purely local disjoint owner | Not selected by apply invalidation; its existing no-work behavior remains. |

No new owner registry, result cache, timer, watermark or revision is introduced.
The resumption set already existed for owners released by watermark publication;
it now also carries committed invalidations. Cold acquisition still schedules
progressively. The same eight-start/eight-active queue, bounded overtaking,
episode clocks and terminal refusals service the replacements.

`subscription-pressure-noop.test.mjs` exercises real wasm and process devices,
all three `keep` settings, and empty/unknown/unrelated reported footprints. The
real underlying applies have zero events, unchanged watermarks and empty table
footprints; `/changes` remains parked. Each of two no-op syncs must dispatch new
HTTP work, restore the authorized profile beyond the one-second withdrawal
bound, and drain the queue without remounting. The empty-footprint `keep: false`
pair fails round 5; the other sixteen cases preserve working controls. Existing
pressure, lifecycle, retention, memory and delivery suites cover the surrounding
queue and authority routes; their final results are recorded in REPORT.md.
