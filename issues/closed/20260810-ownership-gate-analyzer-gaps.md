# Ownership gate: analyzer blind to non-`crate::` dependency forms; baseline updates can launder forbidden edges

**Status:** Resolved
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

## Claim

**Claimed 2026-08-10** by the clique-defects ship session (llp-ship run
`owngate-20260810`, branch `llp-ship/owngate-20260810/impl`): implementing
items 1-4 against `scripts/check-module-ownership.mjs` per LLP 0225 §5.

## Resolution

Resolved 2026-08-10 on the claimed implementation branch:

1. The extractor now resolves `crate::`, lexical/file-relative `self::` and
   `super::` roots (including `#[path]` modules), grouped trees, aliases,
   `pub use`, and transitively chained explicit/glob re-exports. The live
   `src/auth/provider.rs → {src/auth/lifecycle.rs, src/auth/mailbox.rs}`
   sideways edges are visible. One adversarial source fixture per supported
   form lives in `tests/fixtures/module-ownership/`, driven by
   `scripts/check-module-ownership.test.mjs`.
2. Baseline schema v2 separates the complete observed graph from the admitted
   frozen-forbidden fingerprint set. Both check and `--update-baseline`
   compare that set to the committed predecessor, admit shrinkage, require
   retained attribution for analyzer re-keys, bind relocation records to the
   exact removed predecessor fingerprint and owner pair, and require an
   explicit time-bounded worklist waiver for genuinely new coupling. Silent
   growth is refused before any baseline write.
3. The gate applies the upgraded analyzer to pushed and merge-base snapshots,
   computes canonical `V(R)` sets, blocks `V(P) − V(B)`, and runs the
   monotonic-baseline check in the same verdict. Inherited reds require an
   open pushed-tree ticket naming every fingerprint and an observation
   revision. The pre-push runner supplies every merge-base and never routes an
   ownership-protocol failure through its Boolean staleness fallback; the hook
   does not create worktree state.
4. The predecessor manifest comparison freezes the four legacy `unassigned`
   entries shrink-only. The two already-landed logical-transfer modules caught
   during re-derivation were assigned to real owners
   (`shared-contract-types-leaf` and `storage-migration-kernel`) rather than
   expanding that bucket.

The v2 baseline was re-derived over 227 modules and 1,648 observed edges. It
contains 400 admitted frozen-forbidden fingerprints and leaves the two
separately ticketed rehearsal reds unadmitted. Exactly **38 newly visible
pre-existing forbidden edges** were frozen with analyzer-upgrade attribution
in `issues/20260809-0199-ownership-ratchet-worklist.md` item 9; that set
includes the provider pair above.
