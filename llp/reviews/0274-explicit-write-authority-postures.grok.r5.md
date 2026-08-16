# Review: LLP 0274 — Explicit write-authority postures (round 5)

**Reviewer:** Grok (grok-4.6, reasoning effort xhigh)
**Date:** 2026-08-16
**Document:** `llp/0274-explicit-write-authority-postures.spec.md`
**Round:** 5 — bounded delta review of revision r4 (registry initialization cut + 0234 new-restricted two-axis rule)
**Review basis:** independent and mutually blind within the round (neither
family saw the other's review); run read-only against the full checkout,
orchestrated by the sbs-orchestrate dual-family loop.
**Renumber note:** this review was written while the document was numbered LLP 0272; it was renumbered to LLP 0274 at landing after a fleet collision assigned 0272 to a different spec, and all in-body references were renumbered mechanically.
**Verdict:** READY

---

I'll review only the two post-round-4 fixes and whether they introduce new defects. First I'll load the review guidance and locate those changed sections in the spec.I'll find the round-4 revision notes and the two fixed sections, then read them against the rest of the spec.The revision history points at three clusters. I'll read those in full and pull the prior-round MATERIAL notes so the delta stays bounded.I'll read the last dual-family reviews and LLP 0234's `new-restricted` / activation rules so the delta can be checked against what was actually fixed.There's only one on-disk 0274 review artifact. I'll recover the two MATERIALs from git history and the rest of the spec.Grok marked revision 3 READY; the other family’s two MATERIALs should be in a sibling review or author notes. I’ll locate those and then check the spec against them.The protected-cut wording may leave new targets unclassified before the flip. I'll check how `target`, activation, and `new-restricted` are defined in 0234/0264 and in the rest of this spec.I need a precise meaning of `target` and how 0234’s Acceptance item 10 currently classifies new-table roots.I have the round-4 delta in context. One more pass on the new-restricted rule against the read-audience cap and the leftover 0234 admission sentences:Bounded delta review of revision round 4 only. The two prior MATERIALs and the named digest-domain minor were checked for soundness, completeness, implementability, and contradiction with the rest of LLP 0274 / the dated 0234 replacement text. Settled machinery (unified log, lattice/precondition, sixth kind, lift arms, kind-level incomparability, carrier custody, witnesses) was not reopened.

## (a) The two fixes

### Protected Phase-1a initialization

The cut is a real close of the mint-a-new-window attack.

- Pre-flip: `phase-1a` only if `targetId` is in the committed exact-set root, or the append-only envelope retains a same-identity `phase-1a` predecessor. Envelope provenance is receipt-bound even though it is not in the canonical record.
- After `F`: new and legitimate rebinds initialize `post-flip` citing exact `R`/`F`. `targetId` is immutable. In-place id change, delete-and-recreate reset, and a fresh `phase-1a` record refuse with `SNAPBACK_TABLE_WRITE_MIGRATION_ACTIVATION_INITIALIZATION_REFUSED`.
- Record shape is unchanged: `phase-1a` still requires both digests null; `post-flip` still requires both equal to the qualified pair. Direct `post-flip` initialization is not a second transition; the only record transition remains `phase-1a -> post-flip`.
- D7 names the code. D8 item 4 has both named negatives and `post-flip`+`R`/`F` positives.

A conforming initializer is a time split on whether `F` exists. Before `F`, join only via root or retained same-id `phase-1a` predecessor. After `F`, never mint `phase-1a`; new/rebind heads must cite `R`/`F`. Rollback/mismatch still refuses. That is implementable as written.

### Complete two-axis `new-restricted`

This closes the restricted-read / broad-write root bypass.

- `new-restricted` now requires a restricted read **and** every admitted write form inside the successor read-audience cap. Owner/owner, contained membership/membership, any-of exact-arm containment, and derived refusal pass. Owner/open and membership/authenticated-or-open fail.
- The fail path is pinned: `admissionKind: approved-transition`, null predecessor body/id/digest, remotely-prior approval + separation receipt. A lying `new-restricted` label is `SNAPBACK_TABLE_VISIBILITY_POLICY_PROVENANCE_INVALID`.
- That node shape already exists in 0234 (new `public-read` roots already used null-predecessor approval). The automatic v2→v3 lift still excludes `approved-transition` nodes, so G1 lifts and these new roots do not collide.
- Unnamed but covered by the same cap: owner/authenticated, owner/membership, membership/owner, membership role-superset, any-of+open. D8 item 21 has the required positives and negatives.

`migration-pending` never satisfies the cap (already in D5). A new implicit-no-posture restricted table is therefore not `new-restricted` and must take the null-predecessor `approved-transition` path. That does not reopen Phase-1a for existing G1/`g1-migration` rows.

## (b) Contradictions with the rest of the spec

No authority contradiction.

- Direct `post-flip` init after `F` is consistent with “the only transition is `phase-1a -> post-flip`” (initialization vs transition) and with D9’s existing-row flip.
- The lift arms still key on the target’s committed phase; a post-flip new target cannot decode all-refused v2 into `migration-pending`.
- Owner-read+open-write remains generatable under D1’s arbitrary pairing; it is now governed at the root the same way D5 already governed it as a transition.
- Digest domains follow the dual-tag pattern already accepted for the v2→v3 bridge.

One leftover 0234 sentence will sit beside the replacement: “A new restricted table is not widening because it exposes no predecessor data.” The replaced admission rule wins. Same residue class as earlier incomplete-inventory minors.

## (c) New MATERIAL from these edits

None that fork installed authority.

Two good-faith implementers following the time-split initialization paragraphs and the cap-cross-referenced `new-restricted` rule install the same postures, refuse the same mint/reset attempts, and send the same broad-write new tables through null-predecessor `approved-transition`.

### Minors (do not block)

1. Scope the predecessor exception with “while `F` does not exist.” After the flip the envelope retains the old `phase-1a` row by design; “fresh” is slightly overloaded. The post-flip paragraph plus rollback/reset refusals already close a good-faith reading. Add an existing-target rollback-to-`phase-1a` D8 negative if you want that sealed in fixtures.
2. In the dated 0234 replacement, mention `migration-pending` next to the cap test so the amendment text is self-contained (0274 D5 already classifies it).
3. Replace the leftover “new restricted table is not widening…” justification when the amendment lands, so it names the write-axis exception.
4. D8 has no pre-flip out-of-root fixture. Conforming behavior is refuse (`INITIALIZATION_REFUSED` / cannot initialize `post-flip` without `F`).
5. The new refusal code is not in the D7 generation/activation precedence list. Both sides still refuse; only the winning code is unpinned if another activation error is also present.

The digest-domain/golden naming for `WriteMigrationActivationV1` and `OverlayPrefix.prefixDigest` is complete and matches the dual-tag interchange pattern.

VERDICT: READY
