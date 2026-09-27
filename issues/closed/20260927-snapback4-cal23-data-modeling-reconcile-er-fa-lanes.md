# Snapback 4: reconcile the ER/FA research lanes with the landed receipt-gap card and Following preflight

**Opened:** 2026-09-27, the calibration #23 data_modeling lane (this landing)
**Severity:** Low: coordination, no defect
**Area:** `snapback4/crates/snapback4-lang/src/guide/sequences.md`, the `E_STRUCTURAL_FANOUT` rewrite, the `check` Following activation preflight (`E_TIMELINE_ACTIVATE`), the feeds card ordering rule, LLP 3000.015 §2, LLP 3000.016 §2.1a
**Status:** Closed 2026-09-27 — reconciled on both lane branches; supervisor integration pending

Calibration #23 (`snapback4@0.4.4`, `data_modeling` 84) charged two things: a
constrained plan needed bounded ordinal probes instead of an expiring-row scan
(`E_STRUCTURAL_FANOUT` on a mutation page over expiring messages), and
Following adoption had to precede the source events.

Two efforts answered the same charges on the same day, from different ends:

- **This landing** paves what the engine does today. The compiled sequences
  card records both allocators and the bounded probe loop as the receipt-gap
  form; the expiry-scan diagnostic emits a pasteable helper and routes to the
  card; `check` shares the runtime's Following activation preflight and reports
  `E_TIMELINE_ACTIVATE` at the declaration with a rewrite; the feeds card states
  the ordering rule.
- **Lanes ER and FA** (branches `sb4-intent/er-expiring-pages`, LLP 3000.025,
  and `sb4-intent/fa-following-adoption`, LLP 3000.026, opened ~10:09 UTC
  from `f39598de7f`, before this landing) research whether the engine should
  admit a mutation page over an expiring table, and whether a Following can be
  declared over a populated store.

Neither lane's branch point carries this landing. When either lane lands:

1. If ER admits a bounded mutation page over expiring rows, revise the card's
   "paved form" paragraph and the diagnostic's rewrite (the helper may become
   the fallback rather than the answer), and re-run the guide routing tests
   for the receipt-gap aliases.
   **ER resolved, round 4.** The compiled sequences card leads with a never-
   predicting receipt mutation: merge intervals read-only, read the live blocker,
   then delete runs and write. The diagnostic preserves prediction/source-
   boundary repairs before the pasteable probe fallback. Parent-reference
   fixtures compile those repairs; helper authority, coordinate, hidden/absent,
   resumption and routing checks remain. LLP 3000.015 §2 is amended in place.
2. If FA admits Following activation over populated sources, the `check`
   preflight must produce the new runtime verdict (it shares the runtime's
   preflight, so a divergence is a test failure, not a silent drift), and the
   feeds card's ordering rule and LLP 3000.016 §2.1a need the new statement.
   **FA resolved on its branch.** Checked `sb4-intent/fa-following-adoption`
   at `48895b810` (reconciliation `3ae71563f`): CLI and runtime share the
   retirement-aware atomic launch preflight; the feeds card and existing LLP
   3000.016 §2.1a describe populated-source launch. The branch's item-2 record
   names runtime/preview equality, copy-count and database/WAL regressions.
   At round-4 closure, `origin/main` at `8112f4ef6` still had the old activation
   rule; round 5 merges the landed FA work. This record does not claim separate
   ER validation of FA's tests.

   FA round-3 implementation details (now merged from origin/main):
   CLI check and runtime now call the same retirement-aware atomic launch
   preflight. Dev receives a located N_TIMELINE_ADOPT note with the launch
   contract, copies, lock time and deploy's --allow-feed-adoption requirement;
   the ceiling refuses with its estimate. Runtime/preview equality, copy counts
   and database/WAL immutability have regressions. The feeds card replaces the
   ordering rule with launch semantics; the existing LLP 3000.016 §2.1a and
   3000.015 §2 paragraphs are amended. Both journal histories survive the merge.
3. Merge `snapback4/JOURNAL.md` keeping both entries; the LLP 3000.015 §2 and
   3000.016 §2.1a paragraphs added here are the ones to amend, not duplicate.
   **Resolved.** ER merge `f0c5df844` preserves both journal histories; the
   existing paragraph is amended. FA records the same preservation.

Closed under the round-4 instruction to close when both reconciliation items
are done, including checking FA's branch. FA is now on the fetched main; ER still requires the supervisor's integration.
No push or publication by this lane is claimed.
