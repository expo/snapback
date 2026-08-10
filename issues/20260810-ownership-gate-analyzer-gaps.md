# Ownership gate: analyzer blind to non-`crate::` dependency forms; baseline updates can launder forbidden edges

**Status:** Open
**Date:** 2026-08-10
**Systems:** Proof/gates, Rust core
**Source:** LLP 0225 super-refine round 1, gpt-5 family review
(`llp/reviews/0225-core-modularization.gpt-5.md`), findings verified against
the live gate.

Two defects in `scripts/check-module-ownership.mjs`, the enforcement arm of
LLP 0199/0225:

1. **Dependency extraction sees only `crate::`-prefixed textual references.**
   `use super::…`, `use self::…`, grouped imports, aliases, and re-exports are
   invisible. Live proof: `src/auth/provider.rs` (sync-realtime-engine)
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
