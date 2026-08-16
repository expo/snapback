# Review: LLP 0274 — Explicit write-authority postures (round 2)

**Reviewer:** Codex (gpt-5.6-sol, reasoning effort xhigh)
**Date:** 2026-08-16
**Document:** `llp/0274-explicit-write-authority-postures.spec.md`
**Round:** 2 — blind re-review of revision r1 (three-posture expansion + 18-MATERIAL fix round)
**Review basis:** independent and mutually blind within the round (neither
family saw the other's review); run read-only against the full checkout,
orchestrated by the sbs-orchestrate dual-family loop.
**Renumber note:** this review was written while the document was numbered LLP 0272; it was renumbered to LLP 0274 at landing after a fleet collision assigned 0272 to a different spec, and all in-body references were renumbered mechanically.
**Verdict:** NOT READY

---

The revision is materially stronger and closes most Round‑1 attacks, but it is still not implementation-safe. Eight MATERIAL defects remain.

## MATERIAL concerns

1. **`MigrationPending` has no canonical installed representation.**

   The Phase‑1b amendment says only the installed `MigrationPending` posture flips, and forbids branching on read kind ([D1](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/llp/0274-explicit-write-authority-postures.spec.md:319)). But `TableWritePostureV2.authorityKind` has only `refused`, `owner`, `membership-write`, `authenticated-write`, and `open-write` ([D5](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/llp/0274-explicit-write-authority-postures.spec.md:464)); only the runtime enum contains `MigrationPending` ([D6](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/llp/0274-explicit-write-authority-postures.spec.md:739)).

   Failure scenario: a Phase‑1a no-posture `public-read` table canonically carries `authorityKind: refused` and `formDisposition: refused`. A dispatcher consuming that posture directly must refuse. If it instead permits migration behavior, its execution carrier says “refused” while commit permits the write. If it recovers the distinction from the read kind, it violates the amendment. Phase‑1b also has nothing posture-local to flip.

   Define an exact activation rule producing a separately carried resolved runtime posture—binding posture origin and migration phase—or add a canonical migration value. Projection, carrier, preflight, commit, and the flip must all consume the same resolved fact.

2. **Membership-write does not define ordering against same-transaction specialized roster transitions.**

   External revocation OCC is handled, but intra-invocation ordering is not. D9 assumes `bootstrap → participant insert`, `setSelfRole → participant patch`, and `participant patch → removeSelf` observe program order ([D9](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/llp/0274-explicit-write-authority-postures.spec.md:1061)).

   The shipped commit path keeps ordinary writes and membership plans separately, then appends every specialized membership write after every ordinary write ([storage.rs](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/src/storage.rs:4678)). Consequently:

   - `createRoom`: participant insert runs before bootstrap and sees no active owner.
   - `acceptInvite`: participant patch runs before `setSelfRole` and sees only pending `invited`.
   - `leaveRoom`: a generic patch authored after `removeSelf` can be admitted against the pre-removal roster.

   Merely reordering the calls in `handlers.mjs` does not repair a runtime that discards cross-class order. The spec needs a unified ordered effect log or an exact transaction-local membership overlay, plus positive bootstrap/accept/leave and negative `removeSelf → generic write` fixtures. Otherwise the 0240 specialized writer and membership-write disagree inside one transaction.

3. **The field rules and stated authority lattice do not yet define one partial order.**

   D5 declares `owner < authenticated-write` and `membership-write < authenticated-write`, but separately says authority/attribution-field introduction or rebind is incomparable ([D5](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/llp/0274-explicit-write-authority-postures.spec.md:509)). Precedence between those rules is unstated.

   Failure scenario:

   - Predecessor: `public-read`, authenticated-write attributed through `lastEditorId`; `ownerId` is ordinary caller-controlled data.
   - Successor: `owner { field: ownerId }` plus owner-write on `ownerId`.

   An implementer applying the chain sees authenticated→owner as write narrowing and public→owner as read narrowing, so the transition is self-proving. An implementer applying the field-introduction rule sees caller-chosen `ownerId` becoming authority and correctly returns incomparable.

   Require that rank edges apply only after a protected-field compatibility test. Any successor authority/attribution field not already host-protected under the predecessor must make the transition incomparable. Pin owner↔authenticated, attributed/unattributed membership↔authenticated, role swaps, and differing-field cases explicitly. The role-set subset rule and the read-audience cap themselves are otherwise sound and conservative.

4. **The mixed-version v3 bridge lacks an exact validation and hashing contract.**

   A v3 node must use an exact v3 `TableWritePostureV2` body ([D5](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/llp/0274-explicit-write-authority-postures.spec.md:598)), yet a v3 boundary node must embed or bind an exact v2 predecessor body and digest ([D5](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/llp/0274-explicit-write-authority-postures.spec.md:635)). The text does not specify:

   - whether `predecessorNormalizedPolicyBody` in a v3 node is decoded under v2 or v3;
   - which domain validates `predecessorPolicyDigest`;
   - whether a v3 ledger permits v2 nodes alongside v3 nodes;
   - how the v3 node and approval-scope hash encode both version tags; or
   - the mandatory deep equality between the embedded predecessor body and the referenced v2 head.

   One implementation rejects every bridge; another lifts the predecessor and breaks the exact v2 digest; a permissive one can validate only the head digest without the intended body/version closure. Pin the cross-version node schema and add tampered-body, wrong-domain, skipped-node, and hidden-semantic-change negatives.

   The automatic root-only/never-approved lift and dead-owner normalization are otherwise sound: an all-refused nonordinary `ownerField` has no v2 runtime authority and can be normalized representation-only. The immutable G1 receipt should explicitly remain unchanged, following the existing v1→v2 precedent.

5. **The execution carrier closes operation identity but not forgery or staleness.**

   `WriteExecutionAuthorityV1` binds stable operation identity, auth-requirement value/origin, policy digest, and site facts ([D6](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/llp/0274-explicit-write-authority-postures.spec.md:775)). It does not bind:

   - the actual effective principal/auth fingerprint;
   - an invocation identity or activation instance;
   - an expiry/consumption state; or
   - an unforgeability mechanism such as an opaque process-local capability or authenticated encoding.

   “Host-owned and immutable” is not an executable validation rule once the value enters buffered commit payloads. A carrier from an earlier invocation of the same operation under the same policy digest is indistinguishable from the current carrier. If operation identity is learned only from the carrier—as the spec says—the lower seam also lacks an independent value against which to detect a relabelled payload.

   Define carrier construction, custody, independent comparison inputs, freshness, and take-once/replay behavior. Bind the actual principal or auth fingerprint and an invocation/activation identity.

6. **The new auth-origin vocabulary does not match the installed operation registry.**

   The v3 row and function carrier allow `explicit | standard-pattern | legacy-default` ([D5](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/llp/0274-explicit-write-authority-postures.spec.md:678)). The containing authorization-review v2 schema uses `explicit | derived | legacy-default` ([schema](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/packages/snapback-codegen/authorization-review.schema.json:33)).

   This is live, not hypothetical: generated `defineOwnedCrud` operation `createConversation` has `standardPattern: owned-crud.v1` but `authRequirement.origin: derived` ([artifact](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/demos/competitive-checkpoint/snapback/generated/authorization-review.json:355)).

   Since activation requires an exact carrier↔operation-registry cross-check, it must either reject valid standard-pattern owner operations or silently translate an unspecified value. Retain `derived`, or normatively rotate the containing operation schema and define the digest-bound mapping.

7. **The “complete” LLP 0264 amendment still leaves clauses that prohibit explicit postures.**

   The amendment replaces the D2 rows, D10 meanings, and Phase‑1b paragraph, but leaves these Accepted statements unchanged:

   - every current declared nonowner `writePosture` remains refused ([0264 D2](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/llp/0264-table-write-policy.spec.md:198));
   - all nonowner generic writes unconditionally become migration-pending in Phase‑1a ([0264](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/llp/0264-table-write-policy.spec.md:614)); and
   - the Phase‑1b receipt requires zero public-read, membership, or any-of targets behind generic declarations ([0264](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/llp/0264-table-write-policy.spec.md:733)).

   Team Chat `messages` remains a membership-read target behind a generic insert even after installing membership-write, so the receipt cannot be minted as written. Amend the post-table D2 prose, Phase‑1a bullets, closure criteria, and affected acceptance/status text, not just the three named locations.

8. **The LLP 0234 amendment is normative now, but its scope remains incomplete.**

   Round‑1’s inventory-only defect is fixed: 0274 explicitly says the write comparator itself changes and both implementations share vectors. However, the promised amendment covers write order and old-reader language only ([D5](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/llp/0274-explicit-write-authority-postures.spec.md:561)).

   Accepted LLP 0234 still defines the canonical write posture as semantic version, dispositions, owner field, authority-table class, and disclosures—omitting `authorityKind`, attribution, membership, and discriminator fields ([0234 D5](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/llp/0234-visibility-override-governance.rfc.md:910)). Its predecessor compatibility also names only v1/v2.

   If the landing performs exactly the amendment directed by 0274, 0234’s canonical approval-scope inventory and history language remain stale. Supply complete dated replacement text covering v3 body identity, comparator, mixed-version bridge, and old-reader behavior.

## Minors

1. Membership denial bytes are properly normalized, and a Room A member cannot derive whether an ID is missing or belongs to Room B. Still pin the missing-target lookup’s coherent data witness and obligation-floor behavior; LLP 0056 specifies more than byte equality.

2. State that a lowered `minimumRole` must produce a nonempty effective role set, and explicitly classify equal-size/non-subset role swaps as incomparable.

3. Define insert eligibility when membership `resourceField` is system-generated or non-authorable, especially `_id`. Patch/delete-only use may be valid; admitted insert cannot satisfy the current “authored resource value” rule.

4. Pin precedence among simultaneous attribution, read-discriminator, and membership-resource input violations. D7 currently groups them.

5. The sound census makes escaped `ctx` opaque. Team Chat currently passes `ctx` through `myParticipant` and `myRoomDeliveries`; D9 should name the required helper inlining/interprocedural proof because Phase‑1b forbids opaque modules.

## Team Chat verification

The generated artifact contains exactly seven migration-pending rows:

- `messages`: `sendMessage` insert.
- `roomParticipants`: `createRoom` insert; `inviteMember` insert and patch; `acceptInvite`, `leaveRoom`, and `ownerRemoveMember` patch.

D9’s selected forms cover all seven. The `owner | member` maximum is sound for the intended program-order states, both tables bind `roomId`, messages’ host attribution is appropriate, and `roomParticipants.userId` remains immutable invitee data. Insert into Room B and patch/delete of a stored Room B row both deny a principal who belongs only to Room A. The remaining Team Chat blocker is the same-transaction specialized/generic ordering in MATERIAL 2, not the table/role mapping.

## Round‑1 reconstruction

Codex review:

1. Read-authority takeover by patch/restamp — **closed** by discriminator/resource immutability and attribution collision refusal.
2. Unreachable anonymous auth diagnostic — **closed** by invocation/lower-seam split.
3. Alias/helper/computed census evasion — **closed** at the design level.
4. No operation-bound carrier — **original A/B identity hole closed**; carrier lifecycle remains MATERIAL 5.
5. Permission-backing refusal not exhaustive — **closed as an explicit implementation requirement and negative matrix**.
6. Dead authority-table owner field made lift impossible — **closed representation-only**.
7. Approved history rewritten — **closed for retained approved nodes**; the new boundary format remains MATERIAL 4.
8. v3 could not represent refused form/auth facts — **closed**; auth-origin incompatibility is MATERIAL 6.
9. Empty patch skipped restamp — **closed**, including version, changed fields, overlay, and companions.
10. Team Chat had no write model — **table-policy model closed**; transaction ordering remains MATERIAL 2.

Grok review:

1. Read narrowing plus broader retained write, and open→field introduction, landed as narrowing — **original attacks closed** by the cap/introduction rules; precedence with other lattice edges remains MATERIAL 3.
2. 0264 Phase‑1b flip killed explicit postures — **not fully closed**, MATERIALS 1 and 7.
3. 0234 change was inventory-only — **write-order normativity closed**; amendment scope remains MATERIAL 8.
4. Authoring object could not enter canonicalizer — **closed** by strip-before-read lowering and manifest sibling.
5. Restamp incompatible with empty-value skips — **closed**.
6. sealed `AuthUserId` leaked the wrong anonymous code — **closed** by principal-before-values.
7. Team Chat “no posture” could not close — **model selection closed** via membership-write; ordering remains MATERIAL 2.
8. Missing owner/helper/unique/authority negative coverage — **closed** by the dispatcher and D8 matrix.

The membership admission rule is otherwise implementable and payload-nonenumerating; external revocation OCC, resource binding/immutability, restamp semantics, census conservatism, and permission-backing exhaustiveness are well designed.

I could not save the required `llp/reviews/` artifact because this workspace is mounted read-only; this response is the complete review.

VERDICT: NOT READY