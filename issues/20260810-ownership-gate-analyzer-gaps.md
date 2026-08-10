# Ownership gate: analyzer blind to non-`crate::` dependency forms; baseline updates can launder forbidden edges

**Status:** Open
**Date:** 2026-08-10
**Systems:** Proof/gates, Rust core
**Source:** LLP 0225 super-refine round 1, gpt-5 family review
(`llp/reviews/0225-core-modularization.gpt-5.md`), findings verified against
the live gate.

Two defects in `scripts/check-module-ownership.mjs`, the enforcement arm of
LLP 0199/0225:

1. **Dependency extraction is blind to `super::`- and `self::`-rooted
   references and to transitively chained re-exports.** (Grouped use-trees,
   aliases, and `pub use crate::…` forms ARE parsed — corrected 2026-08-10
   per the round-2/3 reviews.) Live proof: `src/auth/provider.rs` (sync-realtime-engine)
   imports `super::lifecycle` and `super::mailbox` (background-services) —
   forbidden sideways domain-service edges — and the gate passes with
   "0 unresolved references"; the baseline's provider.rs block contains
   neither edge. A new forbidden dependency written in any non-`crate::` form
   passes the "blocking" gate today.
2. **`--update-baseline` overwrites the frozen record with the complete
   current graph** without comparing forbidden-edge exceptions against the
   predecessor baseline, so a landing containing both a new forbidden edge
   and a regenerated baseline passes its own pre-push check (edge laundering).

Fix direction (per the 0225 revision that now requires it): extend extraction
to resolve at least `crate`/`super`/`self`, grouped imports, aliases, and
re-exports relative to each module, with adversarial fixtures per form; make
baseline updates monotonic — they may remove forbidden exceptions or re-key a
proven pre-existing edge during relocation, and may only ADD a forbidden edge
when the landing carries an explicit reviewed frozen-edge record (worklist
entry naming the edge); the gate refuses silent growth. After the extractor
upgrade, re-derive the baseline and worklist from the complete graph — the
newly visible pre-existing edges are frozen with attribution, not treated as
new violations.

3. **Staleness attribution masks new edges after one allowed red** (round-3
   finding). Required (superseding the earlier last-green wording, per LLP
   0225 §5 revisions g-i): set-based attribution — canonical edge
   fingerprints; block V(pushed) − V(merge-base) with §2's
   monotonic-baseline growth check run as the same protocol; inherited
   reds admitted only while the pushed revision contains an open ticket
   naming at least the outstanding fingerprints and observation revision.

4. **The `unassigned` bucket accepts new modules** (round-4 probe: a
   synthetic module added to the bucket validates). Required: freeze the
   legacy unassigned set (four entries) shrink-only via predecessor
   comparison; every new module must take a real owner (LLP 0225 §5,
   revision g).
