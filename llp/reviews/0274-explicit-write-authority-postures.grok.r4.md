# Review: LLP 0274 — Explicit write-authority postures (round 4)

**Reviewer:** Grok (grok-4.6, reasoning effort xhigh)
**Date:** 2026-08-16
**Document:** `llp/0274-explicit-write-authority-postures.spec.md`
**Round:** 4 — blind re-review of revision r3 (lift/phase/witness/comparator/amendment fixes)
**Review basis:** independent and mutually blind within the round (neither
family saw the other's review); run read-only against the full checkout,
orchestrated by the sbs-orchestrate dual-family loop.
**Renumber note:** this review was written while the document was numbered LLP 0272; it was renumbered to LLP 0274 at landing after a fleet collision assigned 0272 to a different spec, and all in-body references were renumbered mechanically.
**Verdict:** READY

---

I'll start by loading the review skill and the revised spec, then re-attack each round-3 concern against the current text and the related Accepted LLPs.I'll load the spec, prior review artifacts, and the Accepted texts this revision claims to amend.The spec is long; I'll finish it and pull the round-3 reviews plus the Accepted 0264/0234 clauses this revision claims to close.I have the full spec. Next I’ll re-read the round-3 artifacts and the Accepted 0264/0234/0056 clauses the revision claims to close.I'll verify the amendment targets in the Accepted 0264/0234 texts and the 0056 denial-witness contract next.The five round-3 defeats are closed. I’ll record the round-4 artifact, then give the standalone verdict.The five round-3 defeats are closed. The new lift, registry, witness, and comparator machinery is deterministic enough that two implementers install the same postures. This revision is sound, complete, and implementable.

## Round-3 closures

| # | Round-3 concern | Verdict |
| --- | --- | --- |
| 1 | v2→v3 lift collapses Phase-1a pass-through bodies to `refused` | **CLOSED** |
| 2 | `migrationPhase` has no state machine or `not-applicable` | **CLOSED** |
| 3 | 0056 denial witnesses impossible for missing-target and overlay-prefix | **CLOSED** |
| 4 | Partial-form `migration-pending → open-write` comparator ambiguity | **CLOSED** |
| 5 | Residual unamended 0264 clauses | **CLOSED** |

### 1. Lift arm

Live v2 baselines still match the historical encoding the arm decodes. Campfire `messages` and Team Chat `messages` are ordinary, all-five-`refused`, `snapback.owner-write.v1`, no `authorityKind`. Team Chat `roomMembers` is `authorityTableClass: membership` with a dead `ownerField: userId`.

The four key inputs are closed and deterministic:

- **ordinary class** and **exact all-refused v2 matrix** come from the validated v2 body
- **`implicit-no-posture`** is the triple (no `write` member, non-owner read, ordinary class) lowered from the activation-bound source
- **phase** comes from the committed `WriteMigrationActivationV1` record, not from the read kind

Those conjuncts lift Campfire/Team Chat `messages` to canonical all-form `migration-pending`. Authority-table all-refused bodies, including the dead `ownerField`, lift to `refused`. The same ordinary v2 bytes under committed `post-flip` lift to `refused`. Explicit syntax or source/body disagreement is not liftable.

That is decoding of v2’s all-refused-bytes-plus-projection-fact encoding, not a grant. Projection and runtime still may not reconstruct origin from `policy.kind`. D8 names both positive fixtures and the refused controls.

### 2. `WriteMigrationActivationV1`

The target record is `phase-1a | post-flip`. The only transition is `phase-1a → post-flip`, and only from the qualified corpus-closure receipt plus a marker naming that receipt landing with the flip implementation. `phase-1a` requires both digests null. Missing, dangling, mismatched, or rollback refuses activation. Ambient config cannot select a phase. `phase-1b` and `post-migration` are not schema-valid.

Resolved postures use a different vocabulary: `phase-1a` only for `implicit-no-posture` resolved to canonical `migration-pending`; every explicit, owner-derived, authority-table, omission, and post-flip implicit refusal is `not-applicable`. The flip therefore cannot rotate an explicit carrier, shared body digest, or review-row id. The one real migration row becomes all-form `refused` with `not-applicable`.

The registry digest is bound into the activation receipt and the per-invocation execution carrier. That digest is allowed to change for the whole target on flip; stale pre-flip carriers fail the activation-identity check. Review-row id binds posture-local phase, not the target record, so explicit rows stay byte-identical.

### 3. Hidden witnesses

The three variants sit behind identical public `{ kind: "role" }` bytes:

- **`TargetAbsent`** binds target-key empty-result, declaration, and snapshot. It must not invent a `(principal, resource)` roster lookup.
- **`CommittedRoster`** keeps the 0056 snapshot-bound present/empty roster fact, including nonexistent-resource insert.
- **`OverlayPrefix`** binds invocation identity, `programOrder`, prefix digest, and committed base version, because the causing uncommitted prefix has no committed version of its own.

OCC is not an existence oracle. Only a previously role-admitted row that vanishes takes the ordinary retry path. The retry re-runs admission; if the row is now missing, the terminal bytes are the same role denial with `TargetAbsent`. Each variant names a committed base/snapshot version and cannot discharge a newer obligation floor. Byte equality alone still does not satisfy 0056.

### 4. Kind-level incomparability

`migration-pending` is outside the formwise lattice. Every adoption — owner, membership, authenticated, open, any partial-form shape — is kind-level incomparable and takes ordinary 0234 approved governance. The sole narrowing is the receipt-bound, same-origin, all-five-form flip to `refused`. Any other path into or out of the kind is malformed before comparison. The 0234 replacement text and the named D8 kind-level vectors state the same rule. Dual-tag goldens are interchange bytes for the v2–v3 boundary, not a second comparator.

### 5. 0264 / 0234 inventories

Every cited 0264 replacement target exists at the claimed sentence: D1 locus (`:145`), D1 identity inventory (`:160`), D1 refused-to-owner (`:172`), D2’s three non-owner rows (`:192`), D2 post-table paragraph (`:198`), D9’s read-kind exception (`:496`), D9 `genericWriteDisposition` ownership (`:522`), D10 codes (`:559`), Phase-1a bullets (`:614`), predecessor compatibility (`:657`), receipt criterion (`:738`), Phase-1b flip (`:755`), unchanged-posture sentence (`:766`), and OQ2 (`:816`).

Every cited 0234 replacement target exists: writePosture inventory (`:913`), structural product / write-order / refused-to-owner (`:928`), predecessor compatibility (`:995`).

After those replacements, leftover sentences are historical status, still-true governance remarks (`public-read → owner` remains governed), or v2-domain text that 0274 now owns only on the v3 side. OQ2 is correctly resolved for ordinary targets and left open for roster/authority-table mutation.

## New-mechanism probes

**Lift determinism.** Four conjuncts, all closed. The catch-all “origin independently resolves refusal” is redundant with the named authority-table and post-flip arms plus the explicit-syntax / disagreement refusal. It does not open a second meaning for the Campfire/Team Chat fixtures.

**Registry × activation × flip × review rows.** One record per target; lift, resolved-carrier construction, and the execution carrier all consume that same digest-bound fact. Flip changes only implicit-no-posture migration bodies and the target record. Explicit review-row ids do not bind the registry digest, so they do not rotate.

**Witnesses × OCC.** The causing-state rule picks the variant. An unrelated overlay prefix plus a committed denial is `CommittedRoster`, not `OverlayPrefix`. Public bytes do not fork.

**Kind-level × 0234 × D8.** Special-case narrowing guard before the formwise lattice. Mixed history is exactly `v1* → v2* → v3*` with one v2→v3 boundary. Dual-tag conformance is equality with the named goldens. No interaction hole.

Nothing newly broken showed up. Prior-round closures (unified effect log, protected-field precondition, one-arm pairing, carrier custody, `derived` origin, Team Chat linearization including `leaveRoom`) still hold.

## MATERIAL concerns

None.

## Minors

1. Registry genesis is implied (the only valid pre-flip record is `phase-1a` with both digests null) rather than named as created with the mechanism.
2. Flip ledger topology — append a self-proving v3 narrowing node versus re-run the G1-root lift under `post-flip` — is unpinned. Both install the same refused body.
3. Membership-write could say it mints the existing 0053 `TerminalAuthorization` / `ctx.permissions.deny()` producer with the new witness variants, so the closed producer list stays untouched.
4. `OverlayPrefix.prefixDigest` canonicalization is host-only and not golden-pinned.
5. One lift sentence says the lifted body is byte-identical with the resolved carrier; the later binding sentence correctly limits byte-identity to canonical content.

These do not fork authority. They are not grounds to withhold READY.

Round-4 review appended to `llp/reviews/0274-explicit-write-authority-postures.grok.md`. Proposed next step: the author may accept. This review does not change status.

VERDICT: READY
