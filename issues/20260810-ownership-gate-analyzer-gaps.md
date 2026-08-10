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
