# Review: LLP 0274 — Explicit write-authority postures (round 3)

**Reviewer:** Codex (gpt-5.6-sol, reasoning effort xhigh)
**Date:** 2026-08-16
**Document:** `llp/0274-explicit-write-authority-postures.spec.md`
**Round:** 3 — blind re-review of revision r2 (linearization/lattice/pairing/denial/carrier fixes)
**Review basis:** independent and mutually blind within the round (neither
family saw the other's review); run read-only against the full checkout,
orchestrated by the sbs-orchestrate dual-family loop.
**Renumber note:** this review was written while the document was numbered LLP 0272; it was renumbered to LLP 0274 at landing after a fleet collision assigned 0272 to a different spec, and all in-body references were renumbered mechanically.
**Verdict:** NOT READY

---

Overall: the core design is substantially stronger, and Team Chat’s intended linearization is now sound. It is not yet READY because the new migration representation and denial-witness model contain contradictions that would make conforming implementations diverge.

## MATERIAL concerns

1. **The v2→v3 lift destroys Phase-1a `migration-pending` semantics.**

   D5 requires an ordinary non-owner table with `implicit-no-posture` in Phase 1a to normalize canonically as `migration-pending`, and forbids lower seams from reconstructing that state from the read kind ([0274:628](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/llp/0274-explicit-write-authority-postures.spec.md:628)). But the automatic lift maps every exact v2 all-refused posture to canonical `refused` ([0274:856](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/llp/0274-explicit-write-authority-postures.spec.md:856)).

   Concrete case: Campfire `messages` is a current public-read Phase-1a table whose v2 governance body is all-refused ([baseline:4](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/demos/campfire/snapback/generated/table-visibility-policy-baseline.json:4)), while runtime behavior remains the migration pass-through. The specified lift produces `refused`, so an implementation must either:

   - prematurely refuse Campfire writes;
   - secretly reconstruct `MigrationPending` from read policy/origin, which D5 forbids; or
   - treat the change as a governed semantic transition, contradicting the automatic representation-lift claim.

   The lift needs an exact Phase-1a mapping for ordinary declared non-owner/no-posture roots, or v3 activation must be explicitly prohibited until those rows are gone.

2. **`migrationPhase` has no canonical state machine and conflicts with “explicit postures survive the flip.”**

   Every resolved posture carries `phase-1a | phase-1b | post-migration`, and that value enters projection, carrier validation, and row identity ([0274:635](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/llp/0274-explicit-write-authority-postures.spec.md:635), [0274:993](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/llp/0274-explicit-write-authority-postures.spec.md:993)). Nothing defines:

   - the authoritative source of that phase;
   - when `phase-1b` becomes `post-migration`; or
   - which value an explicit or owner-derived posture carries.

   If it is global, the flip changes every explicit posture’s resolved carrier and review-row id, contradicting the claim that the flip affects only `implicit-no-posture` migration rows. If it is posture-local, there is no `not-applicable` representation for explicit/owner postures. Two implementations can therefore emit different exact carriers for the same installed policy.

3. **The uniform denial bytes are closed, but the required LLP 0056 witness is impossible for two mandated cases.**

   A missing membership-write patch/delete target has no stored `resourceField`, so there is no `(principal, resource)` membership lookup whose snapshot dependency can be preserved. Nevertheless, D4 says every terminal role denial preserves “the membership lookup’s” dependency ([0274:530](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/llp/0274-explicit-write-authority-postures.spec.md:530), [0274:556](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/llp/0274-explicit-write-authority-postures.spec.md:556)).

   The `removeSelf`-then-write negative has the inverse problem: the committed snapshot says the caller is a member, while the uncommitted prefix overlay says absent. If denial aborts the mutation, the removal never receives a committed data version. A witness naming only the base version does not witness the denial-causing state.

   Specify distinct hidden witness variants while retaining identical public bytes—for example, target-absence capture, committed roster capture, and base-version-plus-effect-prefix identity. The overlay case must bind at least the invocation, `programOrder`/prefix digest, and base data version.

4. **A partial-form `migration-pending → open-write` transition has two normative comparator answers.**

   The comparison is formwise and mixed growth/narrowing is incomparable ([0274:689](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/llp/0274-explicit-write-authority-postures.spec.md:689)). Yet the next paragraph and the 0234 amendment say `migration-pending → open` is growth ([0274:696](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/llp/0274-explicit-write-authority-postures.spec.md:696)).

   Concrete case: a Phase-1a table has five `migration-pending` dispositions and adopts Campfire-style open-write with only `insert` admitted and four forms refused. The admitted form grows while four forms narrow. One implementer returns growth; another returns incomparable. Both require approval, but the exact comparator classification and golden artifacts differ. Pin whether the kind-level rule overrides formwise composition or whether only all-forms-open is growth.

5. **The LLP 0264 amendment remains incomplete; LLP 0234 is otherwise reconciled.**

   After applying 0274’s quoted 0264 replacements, Accepted 0264 would still say:

   - the normalized `writePosture` is byte/semantically unchanged across Phase 1a→1b ([0264:766](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/llp/0264-table-write-policy.spec.md:766)), directly contradicting the canonical `migration-pending → refused` flip;
   - predecessor compatibility recognizes only v1→v2 ([0264:657](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/llp/0264-table-write-policy.spec.md:657));
   - D9’s Phase-1a migration-row exception is conditioned only on the read kind, without excluding an installed explicit posture ([0264:496](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/llp/0264-table-write-policy.spec.md:496)).

   The first two require explicit replacement; the D9 paragraph must either be replaced or scoped unambiguously to historical v2/no-posture artifacts.

   I found no equivalent remaining contradiction in the proposed 0234 replacements: the canonical inventory, protected-field comparison, old-reader refusal, and mixed-version boundary replace the conflicting D5 language coherently.

## Minors

1. The any-of pairing rule matches only one membership arm. That is implementable and supports Team Chat’s intentional owner-plus-membership audience, but it does not generally prevent planting into an additional unmatched membership/owner arm. Narrow the Summary’s “cannot plant into a foreign audience” claim or explicitly record that additional arms are deliberate publication audiences.

2. LLP 0264 OQ2 should be marked resolved for ordinary target tables while remaining open for roster/authority-table mutation. Leaving it wholly open is stale but not a semantic blocker.

## Round-2 closure ledger

| Round-2 concern | Result |
| --- | --- |
| 1. Same-transaction ordering | Genuinely closed at the effect/commit level. Program order, specialized suborder, OCC retry, rollback, and companion-effect atomicity are coherent. The hidden denial witness remains MATERIAL 3. |
| 2. Protected-field lattice prerequisite | Genuinely closed, including both named attack vectors. |
| 3. Membership/read binding | Closed for the original mismatched-arm attack; see the additional-arm minor. |
| 4. Missing-target public bytes | Genuinely closed. Only open/authenticated expose physical existence. The hidden witness representation remains unresolved. |
| 5. Canonical MigrationPending | Not fully closed: MATERIAL 1, 2, and 4. |
| 6. v3 bridge | Boundary decoding, version-domain hashing, deep equality, segment ordering, downgrade refusal, and immutable G1 receipt are closed. The lifted semantic value is not—MATERIAL 1. |
| 7. Carrier custody/freshness | Genuinely closed. Single construction, host-memory custody, invocation/principal/operation binding, and stale/cross-invocation refusal are sufficient. |
| 8. Auth-origin vocabulary | Genuinely closed and matches the shipped `explicit | derived | legacy-default` schema. |
| 9. Amendment inventories | 0234 is closed; 0264 is not—MATERIAL 5. |

## Team Chat linearization

The claimed closure is correct under the new runtime and required source migration:

- `createRoom`: `bootstrap` precedes the participant insert, so the creator seat is visible.
- `acceptInvite`: `setSelfRole` precedes the participant patch, so the active member seat is visible.
- `inviteMember` and `ownerRemoveMember`: the specialized command changes the target’s seat, not the caller-owner’s seat, so the following participant convergence write remains admitted.
- Current `leaveRoom` calls `removeSelf` before the participant patch ([handlers.mjs:96](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/demos/team-chat/snapback/handlers.mjs:96)). Under strict program order, that patch must deny and the whole mutation—including earlier buffered delivery deletes—must roll back. Moving the participant patch before `removeSelf`, or introducing a separately specified atomic operation, closes it without runtime reordering.

Recommendation: revise and remain Draft. No provenance artifact could be written because this workspace is read-only.

VERDICT: NOT READY