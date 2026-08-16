# Review: LLP 0274 — Explicit write-authority postures (round 2)

**Reviewer:** Grok (grok-4.6, reasoning effort xhigh)
**Date:** 2026-08-16
**Document:** `llp/0274-explicit-write-authority-postures.spec.md`
**Round:** 2 — blind re-review of revision r1 (three-posture expansion + 18-MATERIAL fix round)
**Review basis:** independent and mutually blind within the round (neither
family saw the other's review); run read-only against the full checkout,
orchestrated by the sbs-orchestrate dual-family loop.
**Renumber note:** this review was written while the document was numbered LLP 0272; it was renumbered to LLP 0274 at landing after a fleet collision assigned 0272 to a different spec, and all in-body references were renumbered mechanically.
**Verdict:** NOT READY

---

I'll re-attack the revised 0274 spec against the round-1 MATERIAL findings and the new membership-write / lattice / lift / restamp / census / amendment / Team Chat surface. Loading the review skill, the revised spec, and the round-1 artifacts first.Next I’ll pull the revised spec, the round-1 review artifacts, and the Team Chat authorization review so I can reconstruct each prior defeat.I have the round-1 Grok review and the revision notes. Next I’ll read the full revised spec and the other R1 artifacts so I can reconstruct each prior MATERIAL against the new text.The spec is ~1167 lines. I’ll read the rest of it plus both round-1 reviews so I can map every prior MATERIAL onto the revision.The revised spec is in hand. I’ll now verify Team Chat against the live schema and authorization review, then check 0264/0234/0056/0240 so the lattice and amendment claims can be attacked against the actual texts.Team Chat handlers show a leave/accept ordering issue and a single shared role ceiling. I’ll now check 0264/0234/0056, the live write-policy IR, and the authorization-review migration-pending rows.I’ve got a possible D4/D6 contradiction on membership missing-target bytes, plus an auth→membership field-introduction hole. Next I’ll confirm those against 0264/0234/0056 and the shipped empty-patch / OCC / census seams.The revision closes most of the round-1 surface. Four remaining holes still let implementers ship opposite public bytes or treat a real authority widening as ungoverned narrowing.

**VERDICT: NOT READY**

## Round-1 reconstruction

| R1 | Source | Closed? |
| --- | --- | --- |
| Patch steals read authority (`ownerId` / `resourceField` / same-field restamp) | Codex M1 | **Yes.** D1 immutability + attribution-collision refusal. Insert-time planting is a new residual (M2 below). |
| Write>read and open→field-intro classified as narrowing | Grok M1 | **Mostly.** Read-audience cap + field-introduction rule kill the two R1 scenarios. Residual: `authenticated-write` → `membership-write` (M1). |
| 0264 amendment didn’t carve out explicit postures / flip still keyed on read kind | Grok M2 | **Yes**, as written. Dated D2/D10/1b text now keys the flip on installed `MigrationPending` and requires the dispatcher to branch on `writePosture`. |
| 0234 D5 “inventory sync” left `compareWritePostures` unspecified | Grok M3 | **Yes.** Landing amends the write order itself; version-list-only is nonconforming. |
| `write` cannot enter `canonicalPolicyLeaf`; lowerer unspecified | Grok M4 | **Yes.** Strip → unchanged read leaf → `TableWritePostureV2` sibling; three divergence paths refuse. |
| Empty-values skip drops restamp | Grok M5 / Codex M9 | **Yes for attributed postures.** Host entry enters the committed value set before the skip. Residual: unattributed membership empty patch (minor). |
| Anonymous + `AuthUserId` marker emits `SNAPBACK_AUTH_USER_MISSING` | Grok M6 / Codex M2 | **Yes.** Invocation gate vs lower-seam split; principal before value-map; marker-present/absent byte-identical. |
| JS census false-negative `sites: []` | Codex M3 | **Yes.** Unproved alias/helper/computed → opaque; bidirectional census/declaration mismatch refuses. |
| No trusted operation carrier | Codex M4 | **Yes.** Host-owned `WriteExecutionAuthorityV1` on HostPlan and buffered commit. |
| Permission-backing refusal described as already exhaustive | Codex M5 | **Yes.** Rewritten as an implementation requirement + D8 matrix. |
| v2→v3 lift impossible for dead `ownerField` | Codex M6 | **Yes.** Confirmed against Team Chat `roomMembers` (`ownerField: "userId"`, all-refused, class `membership`). Representation-only nulling is consistent. |
| Rehashing approved nodes | Codex M7 | **Yes.** Root-only/never-approved automatic lift; mixed histories get an approved v3 head bridge; old nodes stay byte-identical. |
| `writePolicyChecks` v3 missing `formDisposition` / auth origin / `missing-disclosure` | Codex M8 | **Yes.** |
| Team Chat “no new posture” | Grok M7 / Codex M10 | **Attempted, not closed.** Membership-write is the right posture, and every current `migration-pending` *row* is named — but D9’s linearization story is false against the shipped commit seam (M3). |
| D8 missing 0065/dispatcher negatives | Grok M8 | **Yes.** D8 #14–#18. |

Round-1 minors are absorbed. I did not re-open them.

---

## New-surface attack

### 1. Membership-write

**Identical denial bytes.** The intended rule (missing / no membership / pending / insufficient role → `SNAPBACK_AUTH_PERMISSION_DENIED` `{ kind: "role" }`) is leak-free *if* a missing target never reaches the ordinary missing surface. It is implementable: admission needs the stored `resourceField`, so a missing row can never admit. 0056 already treats timing as best-effort, so a constant-time envelope is not required.

The spec then contradicts itself (M4).

**OCC revocation.** Roster-in-OCC-set + retry-without-partial-effects is specified well enough. A retried write cannot commit under a removed role.

**Insert binding / immutability.** Authored `resourceField` on insert, stored field on patch/delete, both immutable, attribution cannot collide. A Room A member cannot retarget a row to Room B. Cross-room argument/carrier forgery is closed **when write `resourceField` equals the read membership field**.

**Role-set comparator.** Inclusion on the normalized finite active set is a poset. `[owner] ↔ [member]` is neither subset nor superset → incomparable via “unproved changes.” Pending roles cannot be admitted. Sound.

**Specialized roster / 0240.** Authority tables stay ineligible. 0240 generates roster/role ops on the membership table, not generic writes to ordinary targets. No collision.

**Signed-in non-member writing another room.** Closed for the bound field. Open if write and read resource fields differ (M2).

### 2. Three-chain lattice + read-audience cap

The drawn Hasse diagram is **not** the comparison relation. Field introduction, attribution add/remove, and the read cap punch holes in rank-decrease-as-narrowing. What remains is still a partial order *if* those exceptions are applied as a general “new authority member” rule.

It is **not** well-specified enough to keep narrowing sound:

- `authenticated-write` → `membership-write` is a rank decrease. The field-introduction examples are only `open-to-*`. D8 #21 fixtures match the examples, not this edge. Under `public-read` + `authenticated-write`, `roomId` is caller-controlled data. A rank-only comparator classifies the transition as self-proving narrowing and blesses those bytes as the write-authority binding (M1). Same family as Grok R1 M1-B.

- Formwise product, owner ∥ membership-write, role subset/superset, attribution add/remove, owner/attribution rebind, open→field intro, public/open → owner/open, public/auth → restricted/auth: all correctly incomparable or ranked.

- Read-audience cap is well-defined for the 0231 any-of grammar (2–8 owner/membership arms; public-read arms refused). “Contained by one exact arm” means the owner-same-`F` / membership-same-declaration-resource-roles-⊆ tests, not a union across arms. Conservative and sound. Cap fires only when read narrows, which is the right trigger.

### 3. Lift + history bridge

Root-only / G1 / no `approved-transition` matches the shipped v1→v2 lift. Dead-`ownerField` nulling is representation-only: Team Chat `roomMembers` never used that field as generic write authority. A mixed chain cannot hide a semantic change inside the automatic lift. A non-root bridge is incomparable and needs ordinary approval; a successor that is not the exact lift is just a normal governed transition. Closed.

### 4. Restamp-in-committed-values

For attributed insert/patch: host entry is not authored input, so it does not trip `ATTRIBUTION_INPUT_REFUSED`; it is present before the empty skip; version bumps even when bytes already match; `changedFields` and overlay include it; companion effects follow the ordinary contract once. OCC treats it as a real write. Closed for authenticated-write and attributed membership-write.

Unattributed membership patch (Team Chat `roomParticipants`) still hits the shipped `if values.is_empty() { continue; }` *before* any admission read (`storage.rs` 3473–3475 and 4849–4851). That is a skip-the-check path, not a restamp miss. Minor, not fail-open on data.

No remaining attributed path lets a forbidden authored attribution value survive: authored name → `ATTRIBUTION_INPUT_REFUSED`; marker is stripped and independently derived.

### 5. Census + execution carrier

Closes the R1 evasion and operation-identity holes. Unproved paths force opaque; opaque cannot close Phase 1b; A vs B at the unique seam is distinguished by the host carrier, not handler input. Stale/missing/forged/cross-operation refuses uncomposed. Activation cross-check (sites/ceilings/disclosures ↔ manifest posture ↔ body digest ↔ operation registry) is complete enough. Replay of Alice’s carrier on a later Alice invocation of the same operation is permission reuse, not forgery.

Minor: `sites: []` with a nonempty declared write set is phrased globally; HostPlan-only ops (Graffiti `paintCell`) must count plan steps as sites or they false-refuse.

### 6. Amendment texts as written

**0264.** The quoted D2/D10/1b replacements do prevent the Phase-1b flip from refusing an exact installed 0274 posture, *if* lowering actually puts that posture in `writePosture`. They do not strike D2’s next paragraph (“normalized `writePosture` remains `refused` for every current declared non-owner kind”) or D1’s “adds no `writePolicy`.” Those leftovers are implementer-confusion, not a second flip bug. OQ1 correctly requires the amendment to land with the first implementation.

**0234.** “Amends D5’s write order itself” + shared golden vectors + “version-list cross-reference alone is nonconforming” is a real amendment obligation. Residual contradiction with the still-Accepted 0234 text (“product of the read order and LLP 0264’s write order”, old refused-to-owner bullets) is expected until landing.

Shipped `compareWritePostures` (`visibility-governance.mjs:366–401`) still treats any non-`refused` disposition change as incomparable. That is the code the amendment must replace; it is not a spec hole.

### 7. Team Chat vs `authorization-review.json`

Current `writePolicyChecks[]` has **seven** `migration-pending` rows and three already-closed owner-policy delivery rows:

| Operation | Table | Form | D9? |
| --- | --- | --- | --- |
| `sendMessage` | `messages` | insert | membership-write insert + `authorId` stamp |
| `createRoom` | `roomParticipants` | insert | claimed |
| `inviteMember` | `roomParticipants` | insert + patch | claimed |
| `acceptInvite` | `roomParticipants` | patch | claimed |
| `leaveRoom` | `roomParticipants` | patch | claimed (plus handler reorder) |
| `ownerRemoveMember` | `roomParticipants` | patch | claimed |
| `sendMessage` / `leaveRoom` / `markRoomRead` | `deliveries` | insert/delete/patch | already owner-policy; read-marker ruling preserved |

Every pending **row** is named. Role bound `owner \| member` matches `sendMessage`. Cross-room is closed. Invitee `userId` as data is correct.

The mapping still does not close create/accept, because D9 pretends handler order is commit order. It is not (M3).

Table-wide `owner|member` on `roomParticipants` also lets any member HostPlan-insert a display row or patch another user’s `status`/`displayName`. Schema already says this table is not a permission oracle; D9 calls it a ceiling. Overstated “handlers justify the exact role set,” not a Phase-1b miss.

### 8. Newly broken / underspecified

The third posture plus “handler order = admission order” is the new break. Mismatched read/write resource fields are the new pairing hole. Membership missing-target bytes are newly contradictory because D4 and D6 were written for different surfaces and then glued together.

---

## MATERIAL

### 1. `authenticated-write` → `membership-write` can be classified as ungoverned narrowing and bless caller-controlled bytes as the write binding

D5 rank: `membership-write < authenticated-write`, so a rank-only comparator returns narrowing. Field introduction is illustrated only as `open-to-owner`, `open-to-membership`, `open-to-authenticated`. D8 #21 requires those open-to-field fixtures, not this edge.

**Scenario.** Table is G1 `public-read` + `authenticated-write` (attribution `lastEditorId`), `patch` admitted. Attackers insert/patch `roomId` to arbitrary strings — under public-read it is not a read discriminator, so it is mutable. Successor is `membership-read` + `membership-write` on `roomId` with the same forms. Read `public → membership` narrows. Write rank decreases. Successor write is within the membership cap (same declaration, field, roles ⊆). Combined: **narrowing**. No approval.

Stored attacker-chosen `roomId` values are now the transactional write-authority key. Same hole as Grok R1 M1-B, one rank step later.

**Fix.** State the introduction rule as: introducing `ownerField`, `attributionField`, or the `membership` member where the predecessor had none is **incomparable**, including `authenticated-write → membership-write` and `authenticated-write → owner`. Add that vector to D8 #21. Do not use the Hasse diagram as the comparison.

### 2. G1 / approved install of mismatched membership resource fields lets a writer plant rows into a foreign read audience

D1 allows any read kind with any explicit posture. Insert may set every read discriminator. Immutability only stops later patches. The read-audience cap runs only when read *narrows*, and only requires write/read field match on that successor.

**Scenario.** `messages.visibility({ kind: 'membership', declaration: roomMembers, resourceField: 'roomId', roles: ['owner','member'], write: { kind: 'membership-write', membership: { declaration: roomMembers, resourceField: 'conversationId', roles: ['owner','member'] }, forms: { insert: admitted, ... } } })`. Alice is in conversation C, not room R. She inserts `{ conversationId: C, roomId: R, ... }`. Write admission succeeds on C. Room R’s members now read Alice’s row. Alice never passed R’s read or write audience.

D1’s claim that immutability + D5 governance make arbitrary pairing “safe enough” is false for insert. They named physical existence and delete-where cardinality as residuals; they did not name insert-into-foreign-audience.

**Fix.** Generation-refuse `membership-write.resourceField` ≠ read membership/`any-of` membership-arm `resourceField` (and declaration mismatch) unless this is an explicitly named, approved residual with a D8 fixture. Same-field Team Chat remains valid.

### 3. D9 Team Chat closure is false against the shipped membership/generic commit order

Shipped commit builds `carried_writes` as **all generic buffered writes, then sanctioned membership-plan writes** (`storage.rs` 4679–4696). Overlay applies only `self.writes`, not `membership_commands` (`runtime.rs` 5168–5181). Sequential read-your-membership-writes is explicitly unshipped (`runtime.rs` 4068–4077: one membership command per mutation).

D9 asserts handler order is admission order: “Accept may patch after its specialized transition has activated `member`”; create/invite/accept/leave/remove “each generic write occurs while the caller is an active owner/member in the transaction.”

**Scenario A — `acceptInvite`.** Handler: `setSelfRole(..., 'member')` then `ctx.db.patch('roomParticipants', ...)`. Commit: generic patch first, while the caller is still `invited` (pending, not in `owner|member`) → `SNAPBACK_AUTH_PERMISSION_DENIED`. Then `setSelfRole` would have activated `member`. Accept is refused. Today this is a `migration-pending` row (`handlers.mjs:89`).

**Scenario B — `createRoom`.** Handler: `bootstrap(...)` returns a new `roomId`, then `ctx.db.insert('roomParticipants', { roomId, ... })`. Commit: participant insert first. No roster row exists for that id yet → same denial. Bootstrap then creates the room and owner seat. Create is refused (`handlers.mjs:39`).

`inviteMember` and `ownerRemoveMember` survive because the caller’s role does not depend on the buffered membership command. `leaveRoom` survives *without* D9’s reorder, because generics already run first while the caller is still a member. The specified leave reorder is aimed at the wrong linearization.

Phase 1b cannot close Team Chat on the D9 mapping as written. Two implementers will either break create/accept or silently invert the shipped apply order.

**Fix.** Normatively require handler-order (or membership-plan-before-dependent-generic) linearization inside one transaction, plus a read-your-membership-writes overlay so the early JS gate and commit admission see the buffered bootstrap/`setSelfRole` seat. Add createRoom and acceptInvite as D8 fixtures that must pass *with the specialized command in the same mutation*. Until that exists, D9 cannot claim “no roster restructure.”

### 4. Membership point missing-target public bytes are specified three ways

- D4: until admission, missing / non-member / pending / wrong-role are identical `SNAPBACK_AUTH_PERMISSION_DENIED` `{ kind: "role" }`. After admission, ordinary missing applies.
- D6: the early gate uses “the D4 admission rule **and physical-existence outcome**”; an admitted **member** point write “can reveal the physical present-versus-missing bit.”
- D8 #11: missing/non-member/wrong-role bytes do not reveal existence. D8 #23: hidden-present vs missing proves the physical bit.

Admission for patch/delete requires the stored `resourceField`. A missing row can never admit. “After admission, ordinary missing” is therefore either dead or a TOCTOU-only path. D6/D8 #23 tell implementers to surface ordinary missing for members anyway.

**Scenario.** Member of room A patches a nonexistent id.

- Implementer A (D4 + D8 #11): always `PERMISSION_DENIED`. Members cannot distinguish missing from other-room. Leak-free. `#23` fails for membership.
- Implementer B (D6 physical bit): ordinary missing/`false` if the caller has any membership in the declaration, denied otherwise. Leaks “caller is a member of something.”
- Implementer C: ordinary missing for everyone after a form-admitted call. Leaks global existence.

Qualification cannot pass both #11 and #23 for membership. This is not implementable as written.

**Fix.** Pick one. The leak-free choice: missing target is always the role-denial bytes, including for members; project membership point existence as “present in a resource I belong to” (success vs denial), not `physical-present-vs-missing`. Restrict `#23` to open/authenticated. Delete D4’s “after admission, ordinary missing” or confine it to OCC retry after a previously admitted row vanished.

---

## Minors

1. **Unattributed empty membership patch** still hits the shipped empty-values `continue` before the row/roster read. `roomParticipants` has no attribution. Specify: admission still runs, or empty patches are form-admitted no-ops with no existence/role signal.

2. **D9 “handlers justify `owner|member`”** is true of successful paths, not of insert. Any member can HostPlan-insert a `roomParticipants` row or patch another user’s `status`. Documented ceiling; do not call it handler-justified. Per-form roles would be needed to match invite-vs-accept.

3. **0264 amendment leftovers.** Strike D2 “`writePosture` remains refused for every current declared non-owner kind” and D1 “adds no `writePolicy`” in the same landing, or implementers will keep deriving refused from read kind.

4. **`MigrationPending` is a dispatcher state, not a `TableWritePostureV2` kind.** Say that Phase 1a is `authorityKind: refused` + ordinary class + phase flag, or add a sixth kind. Two representations will otherwise diverge.

5. **Census `sites: []` refuse rule** must count HostPlan step sites, or Graffiti `paintCell` false-refuses.

6. **Insert omitted `resourceField`** should name the public code (schema required vs `MEMBERSHIP_BINDING_INVALID`).

7. **v.id / FK vs membership denial.** If a nonexistent `roomId` fails referential integrity with a different code than “not a member of an existing room,” that enumerates rooms. Fold missing-resource into the same denial bytes.

8. **Hasse diagram vs comparison.** Put the exception list in the lattice statement itself so rank is not implementable without it.

---

## What is actually in good shape

The third posture is the right product cut. Closed lowering, restamp-before-skip for attributed patches, auth-precedence split, census soundness, host execution carrier, permission-backing-as-requirement, dead-`ownerField` lift, approved-history bridge, v3 row completeness, and the 0264/0234 amendment *obligations* are real fixes. Cross-room membership-write with a matched `resourceField` is sound. Team Chat’s seven pending review rows are the right set to close. Deliveries/read-marker is correctly left alone.

The revision earned another round. It did not earn READY.

**VERDICT: NOT READY**
