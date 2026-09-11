# snapback2: `engine/runner_ops.rs` is 1,508 lines, over the 1,500-line cap

**Status:** Closed

**Opened:** 2026-09-10 (lane `cost` fix round r1; both blind reviews flagged it)
**Area:** `snapback2/crates/snapback2-core/src/engine/runner_ops.rs`

`node scripts/caps.mjs` refuses files over 1,500 lines. `runner_ops.rs` is 1,508 lines and is
hidden by the Snapback 1 baseline, so the check does not fire. The lane `cost` landing changed one
line in it (net zero: `reindex_row` → `reindex_replaced_row` on the update path) and did not cause
the overage, but the next engine lane inherits it.

Split on the way in — the row-change tail (`finish_row_change` and the maintained/timer/provenance
helpers after it) is a natural second file — before the next change that grows the file. No
behavior change; the existing engine, search, and owner tests are the proof.

## Triage — 2026-09-11 (UTC)

**Disposition:** Closed — source already split. **Triage priority:** P3.
**Audit source:** `15c134d056`; Codex, on the author's request to reconcile tickets.
This disposition supersedes stale current-work claims above; historical observations remain unchanged.

The current runner_ops.rs contains 1,236 newline-terminated lines, 1,237 by caps' split-newline convention, below 1,500. The derived-custody work moved row-change responsibilities into engine/custody.rs; the ticket's 1,508-line source is obsolete.

Checked directly at source 15c134d056; git history includes LLP 1019 custody-b landing 295af5511 and subsequent custody changes. Closure is the exact named file's size, not a claim that the repository-wide cap check or every other source file passes.
