# Snapback2 acquisition remains above 30 seconds; foreground admission repaired

Status: Open
Date: 2026-09-11
Scope: Snapback2 browser IndexedDB acquisition and online mutation during acquisition
Related: [implementation plan](../llp/1018.008.007.000-incremental-acquisition-performance.plan.md), [research](../llp/1018.008.007-affordable-offline-acquisition.research.md), [retained measurements](../snapback2/metrics/acquisition-20260911.json)

The bounded collector/success-compaction improvement does not close the full
acquisition performance goal. Ten current candidate Chromium runs acquired
10,008 distinct messages across a 100-conversation fixture in 66.970–69.953
seconds, median 67.414 seconds. All ten matching baseline runs remained
incomplete at the 120-second measurement cutoff. The original clean baseline
30-second timeout is retained; neither variant qualifies the 30-second target.

A separate foreground diagnostic opened the busy conversation after about
1.5 seconds, with 301 messages physically durable. Input fill completed in
47.7 ms baseline / 85.7 ms candidate. Both then awaited the public online
`client.mutation(api.messages.send, ...)` until the external 90-second harness
timeout closed Chromium. No admission, commit, receiving-query or sender-view
latency was obtained. This is an unresolved qualification result in both
versions, not an attributed regression or proof of the underlying cause.

Reproduction is retained on EPYC at
`~/lanes/clique-20260909-initial/runs/four-plans-acquisition-20260911/`:

- `PRIMARY.md`, `paired-browser.mjs`, `baseline-dist/`, `candidate-dist/`,
  `baseline-owner`, `matched-owner.sqlite`, and `matched-owner.json` pin inputs.
- `evidence/quiet-{01..10}-{baseline,candidate}.json` records all final pairs.
- `foreground-browser.mjs` and `evidence/foreground-{baseline,candidate}.json`
  preserve the two failed foreground attempts.
- Each harness run needs a fresh `ACQUISITION_EXPERIMENT`,
  `ACQUISITION_VARIANT=baseline|candidate`, `ACQUISITION_DIST` pointing to that
  pinned variant, and `SNAPBACK2_WITNESS_BROWSER` pointing to installed Chromium.
  Use Node 24.18.0. The fixture owner is the pinned `baseline-owner`; the harness
  copies the fixed owner snapshot and creates a fresh browser profile itself.
  Preserve existing experiment directories. The paired harness has a 120-second
  measurement cutoff; the foreground harness was run with `timeout 90s`.

The owner has no effects engine, the busy group contains Alice only, and there
are no assets. The snapshot has 4,450 acknowledged / 5,558 unacknowledged
receipts. Both variants use the same current chat template, owner, compiler,
snapshot and persona. The performance comparison isolates two acquisition
source changes; it does not include the simultaneous page/recovery changes.

Next work should first instrument the waiting online mutation's stages and
separate durable admission, FIFO acknowledgement draining, owner settlement and
UI observation. Treat FIFO draining as a hypothesis, not a diagnosed cause.
Preserve ordering, authority and byte custody; do not relax bounds or add a
scheduler/retention redesign as an incidental repair. Retain a current matched
comparison and physical checkpoint controls when a bounded remedy is proposed.
Bearer-authenticated browser UI reopen, native timing, full-size retained heap
and foreground responsiveness remain unqualified by this run. Successful
public held queries after physical reopen do not close those gaps.

## Follow-up diagnosis and repair — 2026-09-11

The [follow-up record](../benchmarks/runs/2026-09-11-snapback2-followup-diagnostics/README.md)
supersedes the unresolved-cause assessment above. Stage traces establish two
waits before a send acquires custody: repeated same-scope activation prolongs
inbox admission, then a whole-outbox drain keeps newly arriving background
acknowledgements ahead of the unadmitted send. Both are repaired; callers also
return their own durable terminal while newer replay continues. Three alternating
instrumented controls had no old-source admission within 15 seconds, while the
repaired source admitted in 148–398 ms and returned committed in 560–1,689 ms.
Owner observation used a separate same-account query at 250 ms polling; the
first sender rendering was a queued preview. Neither is recipient-auth or
population-p95 qualification.

The next profile attributes 13.54 seconds to acknowledgement copying. Admission
now reads detached pending keys/sequences, retaining bound/retry history. Full
10,008-message instrumented acquisition completed in 53.634 seconds, compared
with 66.342 before the projection and 70.007 before the send fixes. Physical
content hashes pass, but single instrumented profiles do not replace the earlier
clean cohort or establish the 30-second target. Source/tests, exact sample hashes
and diagnostic limits are retained in the linked record.

**Remaining:** remove the next attributed accumulated-state work; obtain a clean
full-size timing cohort and broader foreground/reopen/heap/native qualification.
Keep the 30-second criterion unchanged. The concrete pre-admission stall is fixed;
this ticket stays open for acquisition and the remaining measurement scope.


## Incremental work result — 2026-09-11

[LLP 1018.008.007.001](../llp/1018.008.007.001-acquisition-with-incremental-work.plan.md)
is implemented after the Grok/Muse/Astra/Gemini panel and fresh code reviews.
The new clean ten-pair comparison lowers the full durable-content **and all
acknowledgements settled** median from **56.458 to 32.554 seconds (42.34%)**.
All 20 samples preserve the exact 10,008-message full-row hash, settle every
earned acknowledgement, pass the post-stop owner receipt oracle, and survive
physical browser reopen. None fail or hit the 180-second cutoff. This comparison
starts from the already-repaired foreground/pending-projection source and does
not count the earlier changes again. Inputs remain fixed throughout the run.

The separate final control retains about 173 MB after GC versus 209 MB baseline.
Foreground admission during/after acquisition is 10.3/24.7 ms and public mutation
return is 1.213/0.661 seconds; these remain individual controls. The fixture has
4,450 already-received and 5,558 unreceived receipts. Native, bearer UI, general
foreground responsiveness and tail-latency qualification are still outside this
scoped Chromium/IndexedDB/dev-persona comparison.

**Still open:** the unchanged 30-second goal. Candidate range is 32.087–33.126
seconds. Remaining measured costs include canonical image/JSON preparation,
posting-tree work, 201 inbox requests and 613 IndexedDB writes. Request and
transaction intervals overlap CPU; do not treat them as additive lower bounds.
Further preparation reduction and an explicitly designed treatment of per-page
overhead are the next investigations. The [research](../llp/1018.008.007-affordable-offline-acquisition.research.md)
and `incrementalWork20260911` field of the [retained evidence](../snapback2/metrics/acquisition-20260911.json)
record exact samples, source scope, all setup attempts and review dispositions.
