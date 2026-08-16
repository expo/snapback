# Review: LLP 0274 — Explicit write-authority postures (round 3)

**Reviewer:** Grok (grok-4.6, reasoning effort xhigh)
**Date:** 2026-08-16
**Document:** `llp/0274-explicit-write-authority-postures.spec.md`
**Round:** 3 — blind re-review of revision r2 (linearization/lattice/pairing/denial/carrier fixes)
**Review basis:** independent and mutually blind within the round (neither
family saw the other's review); run read-only against the full checkout,
orchestrated by the sbs-orchestrate dual-family loop.
**Renumber note:** this review was written while the document was numbered LLP 0272; it was renumbered to LLP 0274 at landing after a fleet collision assigned 0272 to a different spec, and all in-body references were renumbered mechanically.
**Verdict:** NOT READY

---

I'll start by loading the review skill and the revised spec, then re-attack each round-2 defeat against the current text and the Accepted 0264/0234 documents.The spec is long; I’ll finish reading it and pull the Accepted 0264/0234 texts plus prior review artifacts so the amendments can be checked against the live documents.Next I’ll read the prior 0274 reviews and the Accepted 0264/0234 clauses the amendment claims to replace, plus the 0056 witness/non-enumeration rules.I’ll pull 0234 D5, the 0056 witness/non-enumeration rules, Team Chat `leaveRoom` source, and any existing 0274 review artifacts.I’ll verify Team Chat `leaveRoom` order, the leftover 0264/0234 clauses, 0056 witness rules, and the shipped auth-origin vocabulary against the new mechanisms.The v2→v3 lift may collapse Phase-1a pass-through into canonical `refused`. I’ll check live write-posture bytes and the remaining 0264/0234 clauses.The sixth-kind lift is the one place two implementers can still fork: I’ll record the review artifact, then give the standalone verdict.Round-2’s nine defeats are closed. The new linearization, pairing, denial, carrier, bridge, and amendment blocks are implementable on the paths they name. Team Chat closure holds under the specified order, including the recorded `leaveRoom` consequence.

One new interaction is not: the sixth canonical kind and the automatic v2→v3 lift describe two different Phase-1a bodies for the same ordinary no-posture tables.

## Round-2 closure

| # | Round-2 concern | Status |
| --- | --- | --- |
| 1 | Same-transaction membership/generic order vs the shipped class-concat seam | **Closed.** `UnifiedWriteEffectV1` is required new runtime work. Both the early gate and commit see only specialized membership effects with ordinal `< N`. D9 no longer pretends the shipped seam already does this. |
| 2 | Lattice edges blessing caller bytes (`authenticated` → membership/owner) | **Closed.** Protected-field compatibility runs before any rank edge. The `roomId` and `lastEditorId`/`ownerId` vectors are named in D5 and required in D8. |
| 3 | Mismatched membership `resourceField` planting a foreign read audience | **Closed.** Generation refuses `SNAPBACK_TABLE_WRITE_MEMBERSHIP_READ_BINDING_MISMATCH` unless the write binding equals a read membership arm’s declaration **and** `resourceField`. |
| 4 | Missing-target denial specified three ways | **Closed.** One terminal `SNAPBACK_AUTH_PERMISSION_DENIED` / `{ kind: "role" }` for missing, nonexistent resource, other-resource member, pending, and wrong role. Physical existence is open/authenticated only. OCC-vanish is only for a previously admitted row; retry re-admits. |
| 5 | `MigrationPending` with no canonical representation | **Closed as a pick** (sixth kind + `ResolvedInstalledWritePostureV2`). The pick is what opens MATERIAL 1. |
| 6 | v3-over-v2 bridge without a validation/hashing contract | **Closed.** Predecessor is decoded and digested in the v2 domain, deep-equals the exact v2 head, old nodes are one contiguous pre-boundary segment, hashes bind both version tags, G1 receipt is untouched. |
| 7 | Execution-carrier custody/freshness | **Closed.** Single `prepare_write_execution_authority` point, in-memory only, invocation + principal bound, no freshness exception. |
| 8 | Auth-origin vocabulary vs the shipped schema | **Closed.** `explicit \| derived \| legacy-default` matches `authorization-review.schema.json`. |
| 9 | Incomplete 0264/0234 amendment inventories | **Closed for the charter’s replacement set.** Leftover residue is minor (below). |

## New-mechanism probes

**UnifiedWriteEffectV1, OCC, companions.** Call-acceptance order is the linearization; specialized expansion stays on its ordinal plus a private suborder; commit is strict `(programOrder, suborder)`. OCC after admission is not an existence oracle: the caller was already role-admitted. Companions follow the ordinary committed-patch contract once and roll back with the transaction. The `removeSelf`-then-write negative commits no partial effect. Two implementers do not get a second order.

**Overlay vs non-enumeration vs LLP 0056.** The overlay is a host-owned prefix run of the same planner storage uses. It produces the caller’s active-role fact, not a handler-visible roster. Public denial stays `{ kind: "role" }` and must carry 0056’s snapshot-bound dependency, causing data version, and obligation-floor rule. That is not a new oracle. `requireRole` remains 0056’s lookup; the Team Chat handlers that matter do not need it to see a not-yet-committed seat.

**Sixth-kind flip.** The flip itself is tight: only `implicit-no-posture` + `phase-1a` + `migration-pending` becomes `refused`; source syntax cannot name the sixth kind; no seam rediscovers it from the read kind. The hole is how existing v2 all-refused ordinary bodies *enter* that kind.

**Bridge segment rule and carrier binding.** Specified tightly enough to implement. Dual-tag hash field order is a minor.

**Team Chat under this linearization.** Current `demos/team-chat/snapback/handlers.mjs`:

- `createRoom`: `bootstrap` then participant insert → overlay admits.
- `acceptInvite`: `setSelfRole` then participant patch → overlay admits.
- `inviteMember` / `ownerRemoveMember`: the caller remains owner → admitted.
- `leaveRoom`: `removeSelf` then participant patch (lines 109–110) → **denies**. Today’s class-concat seam accidentally runs the generic patch first; that is not a contract. D9 requires every membership-dependent write to precede `removeSelf`, or a separately specified atomic specialized operation.

With that source change, and with `myParticipant` / `myRoomDeliveries` inlined or interprocedurally proven, closure holds. The documented `owner | member` table-wide ceiling on `roomParticipants` is honest.

**any-of / owner-read pairing.** “Match at least one membership arm,” plus membership-write over owner-read fan-out, is the same broad-pairing rule: a foreign audience is a write axis that matches **no** read arm, not “an audience the writer is not in.” Not a remaining hole.

**0264/0234 after the dated amendments.** The charter replacements (0264 D1 locus, D2 table and post-table prose, D10, Phase-1a bullets, receipt criterion, Phase-1b flip; 0234 inventory, full comparison, growth inventory, old readers, bridge) do what they claim. They do not leave a self-proving narrowing path that 0274 forbids.

## MATERIAL concerns

1. **v2 all-refused ordinary bodies cannot enter the sixth kind without a specified lift or transition.**

   **Scenario.** Team Chat `messages` — and every other Phase-1a ordinary no-posture table — currently stores `writePosture.dispositions.* = refused` under `snapback.owner-write.v1` with no `authorityKind` (`table-visibility-policy-baseline.json`). That is the Accepted 0264 encoding: the body stays `refused`, and `migration-pending` is projection-only.

   0274 D5 now says a Phase-1a ordinary declared non-owner table with no explicit posture **normalizes to canonical `authorityKind: migration-pending`**, and every runtime seam consumes that kind rather than recovering pass-through from the read kind or from `refused` plus a flag.

   The automatic v2→v3 lift says an exact all-refused matrix **lifts to `refused`**, preserves those dispositions, and sends any other successor through ordinary transition governance.

   **Fork.**
   - Implementer A follows the lift: after v3 activation the installed kind is `refused`; the dispatcher refuses generic writes; Phase-1a pre-0264 pass-through dies.
   - Implementer B re-normalizes from source to `migration-pending`. The lifted head is `refused`, so activation’s byte-identical body/digest binding fails, or they append a `refused → migration-pending` node whose comparison class is unspecified (not the named Phase-1b narrowing, not growth to `open-write`, and not the “explicit → migration-pending is malformed” rule).
   - Implementer C treats origin+phase as a pass-through flag on canonical `refused` — the representation D5 rejected when it chose a sixth kind.

   This is not a process footnote. 0274 is specified to land in the Phase-1a window. D8 requires no-posture fixtures that carry canonical `migration-pending` in Phase 1a. Any existing v2 app that activates v3 before every generic-write target has an explicit posture hits this table. The flip cannot repair it: it only changes installed `migration-pending` with origin `implicit-no-posture`.

   **Resolution.** Pin one mechanical rule, for example: ordinary-class all-refused v2 + source origin `implicit-no-posture` + `phase-1a` lifts to canonical `migration-pending` (all five form dispositions `migration-pending`); authority-table all-refused and Phase-1b/post-migration implicit-no-posture stay `refused`. Or forbid v3 activation while any generic-write target remains no-posture, and drop the Phase-1a migration-pending fixtures. Do not leave both sentences in force.

## Minors

1. **0264 amendment residue.** The dated block does not replace D1’s later inventory (still version/dispositions/owner/class/disclosures only) or “Refused-to-owner … broaden.” After landing, 0274/0234 say refused→owner is incomparable and `TableWritePostureV2` carries `authorityKind`, attribution, membership, and discriminators. Both leftover verdicts still require 0234 approval, so this is not a narrowing hole. Same class: 0264 D9’s `genericWriteDisposition` enum and 0264 OQ2 stay unamended even though 0274 owns the v3 section and claims to resolve OQ2 for ordinary targets.

2. **v1 nodes under a v3-over-v2 ledger.** The contiguous-segment rule names retained **v2** nodes. The v3 reader also validates retained v1 artifacts. A v1+v2+v3 chain is not classified.

3. **Dual-tag hash preimage.** Node and approval-scope hashes “encode both version tags.” Exact domain strings / field order are left to the named v3 domains. Security holds either way; golden interchange can drift until D8 pins the bytes.

Artifact: `llp/reviews/0274-explicit-write-authority-postures.grok.md`.

VERDICT: NOT READY
