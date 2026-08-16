# Review: LLP 0274 — Explicit write-authority postures (round 4)

**Reviewer:** Codex (gpt-5.6-sol, reasoning effort xhigh)
**Date:** 2026-08-16
**Document:** `llp/0274-explicit-write-authority-postures.spec.md`
**Round:** 4 — blind re-review of revision r3 (lift/phase/witness/comparator/amendment fixes)
**Review basis:** independent and mutually blind within the round (neither
family saw the other's review); run read-only against the full checkout,
orchestrated by the sbs-orchestrate dual-family loop.
**Renumber note:** this review was written while the document was numbered LLP 0272; it was renumbered to LLP 0274 at landing after a fleet collision assigned 0272 to a different spec, and all in-body references were renumbered mechanically.
**Verdict:** NOT READY

---

NOT READY. The round-3 mechanisms are substantially sound, but two material governance gaps remain.

Review bound to LLP 0274 SHA-256 `fd8939430bb621698aeee3f0fd75d1b005c0bf5fce96736d55a4f085a0fd733a`.

## MATERIAL concerns

1. **A fresh target can re-enter Phase 1a after the global flip.**

   [LLP 0274’s registry](</private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/llp/0274-explicit-write-authority-postures.spec.md:748>) defines the transition and rollback behavior but not initial-record eligibility.

   Scenario: after closure receipt `R` and flip marker `F` exist, a newly registered or replacement target `T2` has no predecessor registry record. It commits:

   ```text
   targetId: T2
   migrationPhase: phase-1a
   closureReceiptDigest: null
   flipMarkerDigest: null
   ```

   That satisfies the specified Phase-1a shape. Because `T2` has no installed `post-flip` predecessor, rollback detection cannot fire. An ordinary non-owner table without an explicit posture then resolves to `migration-pending`, restoring pre-0264 pass-through after closure.

   Implementer A can admit this as a valid initial record; implementer B can infer that Phase 1a is restricted to pre-flip targets. The text and D8 tests do not choose.

   Resolve by pinning a protected initialization cut: Phase-1a records are valid only for exact target IDs in a committed pre-flip migration root or with a retained Phase-1a predecessor. Once the flip marker exists, every new/rebound target must initialize `post-flip` with `R` and `F`; a fresh Phase-1a record or target-id reset refuses. Add fresh-target-after-flip and target-rebind negatives.

2. **LLP 0234’s `new-restricted` root can bypass write-axis governance.**

   The 0274 amendment correctly replaces the transition comparator, but it does not amend LLP 0234’s null-predecessor rule: [a new restricted table is not widening](</private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/llp/0234-visibility-override-governance.rfc.md:946>), and `new-restricted` need only prove a restricted successor.

   Scenario: introduce a new table with `owner { field: "ownerId" }` read policy and admitted `open-write`. Implementer A classifies it as `new-restricted` from the read kind and requires no remotely prior approval. Implementer B applies 0274’s successor read-audience cap to the whole two-axis body and requires approval because open write exceeds owner read. D8 has no null-predecessor vector deciding this.

   This permits broad write authority to enter without the governance 0274 otherwise requires. Amend the `new-restricted` rule and Acceptance 10 so classification uses the complete read/write body. Pin which root admission kind carries a previously approved broad-write new table. Add vectors for owner/open and membership/authenticated or open, plus positive owner/owner and contained membership/membership roots.

## MINOR

1. `WriteMigrationActivationV1.digest` and `OverlayPrefix.prefixDigest` lack named digest domains or canonical-preimage goldens. Exact-record binding keeps the design fail-closed, so this is interoperability drift rather than an authority hole. Pin their domains/bytes or delegate them to named D8 vectors as was done for the dual-tag bridge.

## Round-3 closure accounting

- **v2→v3 lift collapse:** genuinely closed. Exact body, ordinary class, receipt-bound source origin, and committed target phase select one exhaustive arm; Campfire and Team Chat positives plus authority-table controls are sufficient.
- **Migration-phase state and `not-applicable`:** the original defect is closed. Explicit/derived posture bodies and review-row IDs remain stable; execution carriers correctly rotate their separately bound activation digest. The replacement mechanism has the fresh-initialization defect in MATERIAL 1.
- **LLP 0056 denial witnesses:** genuinely closed. `TargetAbsent` avoids an impossible roster lookup, `CommittedRoster` preserves the snapshot-bound range fact, and `OverlayPrefix` binds the uncommitted causal prefix. OCC retry starts admission again and obtains the appropriate fresh witness.
- **Partial-form migration comparison:** genuinely closed. `migration-pending` is kind-level incomparable to all adoptions; only the same-origin, receipt-bound all-five-form flip is narrowing. The 0234 amendment and D8 comparator vectors agree.
- **Residual LLP 0264 clauses:** genuinely closed for the round-3 inventory. D1 identity/comparator, D9 exception and v2 enum ownership, predecessor compatibility, Phase-1b posture-change sentence, receipt criterion, and OQ2 are all covered. The 0234 transition and predecessor amendments are also covered; only its separate new-table-root rule remains materially unamended.
- **Mixed history, dual-tag hashing, and any-of wording:** closed. `v1* → v2* → v3*`, one boundary, named interchange goldens, and the one-arm pairing/additional-audience distinction are internally consistent.

The required LLP review artifact could not be written under the workspace’s read-only permission profile.

VERDICT: NOT READY