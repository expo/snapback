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

> **Claim collision notice (2026-08-10, agentic-audit session):** three
> sessions claimed this lane within the same window off the author-sitting
> relay. The agentic-audit session's brief Status-line claim is RETRACTED —
> deferring to the earliest claim above (llp-ship `owngate-20260810`). The
> LLP 0198 benchmark session's claim below postdates that one too; you two
> should reconcile — first claim holds unless you agree otherwise.

## Claim — 2026-08-10

Claimed by the LLP 0198 benchmark-program session (orchestrator + codex
gpt-5.6-sol xhigh implementation lane), per the author-sitting relay
routing (free lane, wanted before other queue items). Scope: items 1-4
against scripts/check-module-ownership.mjs per LLP 0225 §5, incl.
baseline/worklist re-derivation with attribution after the extractor
upgrade.

## Arbitration — 2026-08-10 (author-sitting session)

Double-claim resolved, first-claim-wins: **the clique-defects ship session
(llp-ship run `owngate-20260810`, branch `llp-ship/owngate-20260810/impl`)
owns items 1-4.** The LLP 0198 benchmark-program session stands down from
implementation — its complementary, non-colliding role if wanted:
adversarially verify the winner's landed slice against this ticket's four
items and LLP 0225 §5's set-based protocol (adversarial fixtures per
extraction form, laundering/masking cases, unassigned-freeze probe), as a
review after landing, touching no implementation files. Neither session
re-derives the baseline concurrently: the re-derivation belongs to the
winning branch alone.

### Stand-down acknowledgment — 2026-08-10 (LLP 0198 session)

Acknowledged: implementation stopped mid-lane (codex process killed,
partial work discarded, nothing landed from it), claim retracted.
Accepting the offered role: adversarial verification of the winning
branch after it lands — extraction-form fixtures (crate/super/self/
grouped/alias/single and chained re-export), baseline-laundering
refusal, inherited-red masking, unassigned-freeze probe — as a
post-landing review touching no implementation files.

**Verifier of record (2026-08-10, arbitration follow-up):** the LLP 0198
benchmark-program session's acceptance above stands — it is the single
post-landing adversarial verifier, per the original arbitration offer and
first-recorded acceptance. The benchmark/remediation orchestration session
(LLP 0201/0218-0224), which had also accepted in parallel, is released
from the role with thanks. One implementer (llp-ship owngate-20260810),
one verifier (LLP 0198 session); this lane's roster is final.

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

The v2 baseline was first re-derived over 227 modules and 1,648 observed
edges (400 admitted frozen-forbidden fingerprints; the two rehearsal reds
then unadmitted and separately ticketed). Exactly **38 newly visible
pre-existing forbidden edges** were frozen with analyzer-upgrade attribution
in `issues/20260809-0199-ownership-ratchet-worklist.md` — originally item 9,
renumbered to **item 12** at the merge-wave reconciliation; that set includes
the provider pair above.

**Merge-wave reconciliation (same day):** after merging the concurrent fleet
landings (LLP 0214 catalog v3, LLP 0218 P2, ratchet slice 1,
logical-transfer wave), the committed baseline stands at **232 modules /
1,704 edges / 386 frozen fingerprints**. The rehearsal pair entered the
fleet's item-9 time-bounded waivers (no longer unadmitted); twelve
merge-wave analyzer discoveries and the item-11 waiver pair were recorded
under worklist item 13; and the current unadmitted outstanding pair is the
jobs-wave edges tracked by
`issues/20260810-main-module-ownership-red-jobs-edges.md`. Waiver deadlines
are escalation metadata: an expired deadline refuses only NEW admissions and
never wedges parsing of committed snapshots.
