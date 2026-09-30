**NOT READY.**

**P1 — Held-row upserts predict changes without proving secondary unique-key or cap-group coverage.** Removing the guard in [write_target.rs](/home/ccheever/sb4-intent/review-qx-r0-astra/snapback4/crates/snapback4-core/src/engine/write_target.rs:48) exposes this gap in the update arm.

Concrete reproduction:

- Acquire a reaction with `emoji: 'old'`. Another group, hidden from this viewer, already contains `emoji: 'taken'`.
- Declare either `unique byEmoji: emoji` or `cap 1 by emoji`.
- Upsert the held reaction to `emoji: 'taken'`.

Both **wasm and process devices** show the changed row with `pending: true`. The server refuses it with **E_RULE** for uniqueness or **E_CONSTRAINT** for the cap. No concurrent server change is needed. Settlement correctly restores `'old'`.

The same reproductions fail on memory and SQLite. Restoring the removed guard makes them pass by queueing without prediction. Require coverage for changed constraint populations before predicting the update, or keep those cases queued. [Executable reproduction](/tmp/qx-review-astra/snapback4/packages/snapback4/test/qx-review-constraints.test.mjs:26) · [Results](/tmp/qx-review-astra/constraints-tiers.log)

| Claim | Review result |
|---|---|
| **1. Equivalent sugar** | **Confirmed for semantics.** Passed 24 schema/IR comparisons, eight CLI `check --residency --verbose` comparisons, and 1,024 transitions comparing sync delivery, queries and meters. Additional service-grant, expiry and parent-deletion checks passed. Reverting the parser fix restores `expected "]", got "."`. Diagnostic wording is overstated: mismatched audiences can produce **E_SYNC**, not E_READ_THROUGH. |
| **2. Safe prediction** | **Partially refuted by P1.** Insert controls correctly queue for horizons, missing/provisional/expired parents, mismatched captures, left/rejoining groups, uncovered constraints and expiring caps. Exhausting the device allowance also queues while the server accepts. The six supplied actual-device tests pass. |
| **3. Latency improvement** | **Recorded measurements confirmed.** Independently recomputed insert medians: web **29.65 → 3.60 ms**, process **35.55 → 8.95 ms**. All 80 final insert/update samples rendered pending before mutation return. This verifies the retained samples, not a fresh timing benchmark. |
| **4. Three corrected suite failures** | **Confirmed.** Reversing the census correction and public-rule exemption reproduces the census failure and both inherited-expiry failures. Restored source passes all **81 readauth** and **10 expiry** tests. The historical full-suite run remains red; I did not rerun it. |

The removed runtime guard was device-only. Server constraint, parent-lifetime and authorization refusals remain effective in the reproductions; I found no authority widening.

Repository files remain unchanged. All experimental edits were confined to `/tmp/qx-review-astra`; nothing was pushed.