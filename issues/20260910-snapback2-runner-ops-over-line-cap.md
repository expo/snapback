# snapback2: `engine/runner_ops.rs` is 1,508 lines, over the 1,500-line cap

**Opened:** 2026-09-10 (lane `cost` fix round r1; both blind reviews flagged it)
**Area:** `snapback2/crates/snapback2-core/src/engine/runner_ops.rs`

`node scripts/caps.mjs` refuses files over 1,500 lines. `runner_ops.rs` is 1,508 lines and is
hidden by the Snapback 1 baseline, so the check does not fire. The lane `cost` landing changed one
line in it (net zero: `reindex_row` → `reindex_replaced_row` on the update path) and did not cause
the overage, but the next engine lane inherits it.

Split on the way in — the row-change tail (`finish_row_change` and the maintained/timer/provenance
helpers after it) is a natural second file — before the next change that grows the file. No
behavior change; the existing engine, search, and owner tests are the proof.
