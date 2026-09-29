Two blockers and one non-blocking coverage gap.

1. **High — queued local `keep: false` observations retain revoked rows.** [local.ts:984](/home/ccheever/sb4-intent/review-pq-r2-astra/snapback4/packages/snapback4/src/local.ts:984).

   Mount a server-backed row with `keep: false`, fill all eight slots with held reads, then transfer that row to another owner. The relevant `/changes` notification queues its replacement without withdrawing the displayed row. It remains visible until a slot becomes available.

   Reproduced on wasm and process; both cases pass on `ac5c4e21c`. Withdrawing before queueing fixes both.

   **Smallest fix:** call `reload()` and notify every invalidated watch before enqueueing, including `keep: false`. Preserve saved-answer resubscription through a separate acquisition path. **Blocks landing.**

2. **Medium — a deadline floor raised after evaluation is missed at local publication.** [local.ts:1000](/home/ccheever/sb4-intent/review-pq-r2-astra/snapback4/packages/snapback4/src/local.ts:1000).

   `deadlineWithdrawn` is a boolean captured during evaluation. After that check, a held facade answer can expire at D while the raw watch holds a newer answer. The sweep records floor D without resetting that newer raw watch. If the clock rolls back before final publication, the old result carrying D passes the ordinary deadline check and replaces the newer answer.

   A controlled held-expiry/rollback interleaving reproduces publication of the withdrawn body on wasm and process under all three policies. A final floor recheck fixes all six cases.

   **Smallest fix:** check the current matching-observation floor synchronously before local publication, including presence publication; discard rejected results without updating the watch. The round-1 synthetic-loading fix is present, but its test places the interleaving too early to catch this gap. **Blocks landing.**

3. **Low — abort-diagnostic protection lacks a detecting regression test.** [per-row-liveness.test.mjs:54](/home/ccheever/sb4-intent/review-pq-r2-astra/snapback4/packages/snapback4/test/per-row-liveness.test.mjs:54).

   The fixture resolves late bodies and checks publication, but never checks retained transport diagnostics. Removing both `sendPost` catch guards at `client.ts:565` and `local.ts:551` still passes all **97 targeted tests**. An abort overwriting an earlier transport failure therefore goes undetected.

   **Smallest fix:** exercise an adapter that rejects on cancellation and assert that a subsequent diagnostic preserves the earlier transport failure. The production guards are present. **Does not block landing.** This is a surviving mutation.

What is sound:

- No dependency on removed LV code or restoration of its dependency-fence subsystem appeared. Ordinary commits retain answers through the unchanged episode model.
- Queue bounds, FIFO fairness, active cancellation, lifetime release, canonical keys, and due-only sweeps passed targeted checks.
- The unknown-footprint final drain and reset-version fixes have detecting tests: removing them failed both drain cases and all nine reset cases.
- The original floor-rejection counterexample is covered; finding 2 concerns a later publication boundary.

The rebuilt copy passed **97 targeted tests and both React browser tests**, including zero loading renders for 1,000 hooks under the explicitly fixed retention clock. The additional probes exposed the two blockers above. The checkout remains unchanged.

**NOT READY**