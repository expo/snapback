The round-1 findings are fixed, with effective regressions. **The broader “never stale” guarantee still fails on three requested paths. These Mediums block landing.**

I reproduced the 8,193-grant query exhaustion over HTTP: the newest record identifies the query’s read rule. Read-through capture exhaustion now identifies `read through`, not the unevaluated insert rule. Both query branches, fallback recording, phase mapping, dropped counts, residual equalities, wording, temporary-file recovery and watermark checking have tests that fail when their repairs are removed.

1. **Medium — asset authorization refusals leave stale evidence.** [dev_refusal_response.rs:60](/home/ccheever/sb4-intent/review-mp-r2-astra/snapback4/crates/snapback4/src/dev_refusal_response.rs:60). **Blocks landing.**

   Reproduced: upload an image, place it on a row with `read <- .owner = viewer`, establish an unrelated mutation refusal, then fetch the image as another viewer. The download returns HTTP 404 with `E_ASSET_UNKNOWN`; `why recent` succeeds with the unchanged earlier mutation cause. The owner’s download succeeds.

   The response hook explicitly discards codes other than `E_RULE` and `NOT_FOUND`, including this rule-denied asset response.

   **Smallest fix:** record fallback evidence for every actual refusal envelope, including asset refusals, using `cause not instrumented` when necessary. Add the real asset authorization regression.

2. **Medium — filtered sync responses bypass the fallback.** [dev_refusal_response.rs:61](/home/ccheever/sb4-intent/review-mp-r2-astra/snapback4/crates/snapback4/src/dev_refusal_response.rs:61). **Blocks landing.**

   Reproduced with an existing Alice-owned row declaring `read <- .owner = viewer` and `sync to .owner`. After an unrelated refusal, Bob’s `/sync` returns `events: []` and `held: {}`. `why recent` again succeeds with exactly the previous evidence.

   Empty-result handling requires a `/q/` request and a `data` field. Sync has neither, so its filtered result never advances the watermark.

   **Smallest fix:** include sync completion in developer evidence. Record filtered results, with an explicitly unknown fallback for uninstrumented empty snapshots, without changing the wire response or reevaluating authorization.

3. **Medium — parked job refusals never enter the stream.** [serve_maintenance.rs:65](/home/ccheever/sb4-intent/review-mp-r2-astra/snapback4/crates/snapback4/src/serve_maintenance.rs:65). **Blocks the requested cross-path guarantee.**

   Reproduced with a scheduled job whose chunk executes `require false else NOT_FOUND`. After establishing an earlier mutation refusal, advancing the development clock returns `work.parked: 1`; stderr identifies the job’s `NOT_FOUND`. `why recent` still returns the earlier mutation cause.

   The response-only mechanism cannot observe a refusal retained inside a parked job.

   **Smallest fix:** submit a dev-only terminal job record through the same sequence/watermark mechanism, carrying job identity, operation, code and fallback cause.

4. **Low — composed-empty fallback lacks a detecting regression.** [dev_refusal_response.rs:92](/home/ccheever/sb4-intent/review-mp-r2-astra/snapback4/crates/snapback4/src/dev_refusal_response.rs:92). **Does not independently block landing.**

   Confirmed surviving mutation: replace the object arm of `empty()` with `Value::Object(_) => false`. All **195 runnable host tests and eight process tests pass**.

   Under that mutation, a query returning `{outer: {row: rows['absent']}}` leaves the previous cause current. Restoring the code produces the correct `EMPTY_READ` fallback.

   **Smallest fix:** add that composed missing-row process case after a known refusal, asserting the new operation, request identity and fallback cause.

What is sound: the tested refusals remain byte-identical with every logical meter unchanged. I found no new caller-visible evidence channel; production `serve` starts no collector or private stream. The watermark handles writer lag and dropped records correctly **for responses that reach its classification**. Reader-generation source ownership, aggregate point/nested disclosure checks, instance isolation and temporary-save recovery pass.

I ran **136 baseline tests successfully** and nine detecting removal probes. Initial copy-only build failures were missing fixtures and were resolved before those passes. The merge resolution only combines the LLP revision histories; no product conflict was manually resolved. The review worktree remains unchanged; tests and mutations ran only on copies.

**Verdict: NOT READY.**