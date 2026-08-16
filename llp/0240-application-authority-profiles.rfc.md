# LLP 0240: Application authority profiles

**Type:** RFC
**Status:** Accepted
**Systems:** Auth, Authorization, Memberships, Schema, Application data API,
Live Queries, Assets, Code generation, Diagnostics, Guide, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-12
**Revised:** 2026-08-15 (D4 cross-references LLP 0231 D7 `ctx.db.elevated` as
the sanctioned handler read path across Class-R visibility, keeping it distinct
from LLP 0234 governed overrides). 2026-08-12 (entered Review for the author-directed single-family
`llp-super-refine` loop: Codex GPT-5.6-sol xhigh only; Claude intentionally
skipped). 2026-08-12 (mechanically renumbered from LLP 0238 to LLP 0240 after
origin assigned LLPs 0234–0235). 2026-08-12 (author-directed acceptance after
Round-3 same-revision Codex GPT-5.6-sol xhigh convergence). 2026-08-12 (round-1 revision: made the profile a strict facade over
LLP 0056/0231, selected app-table ownership, inherited the central writer seam,
and froze owner/last-holder and custom-policy invalidation rules). 2026-08-12
(initial Draft synthesized from LLP 0236 P6, P11, and P12; bounded query shapes
and protected retained views are deliberately split to LLP 0242 and LLP 0243)
**Related:** LLP 0011, LLP 0043, LLP 0053, LLP 0056, LLP 0061, LLP 0080,
LLP 0100, LLP 0120, LLP 0155, LLP 0172, LLP 0208, LLP 0210, LLP 0220,
LLP 0231, LLP 0234, LLP 0235, LLP 0236, LLP 0237, LLP 0238, LLP 0239, LLP 0241,
LLP 0242, LLP 0243,
Diary 0058 (messaging-snapback), Diary 0073, Diary 0074

## Summary

Snapback should let an application declare one bounded authority profile that
connects product-visible participants and roles to Snapback’s closed membership,
visibility, search, asset, and invalidation machinery.

Clique exposed a recurring seam: the app needed a visible roster with custom
roles, while Snapback’s declared membership machine carried the authority used
by search, assets, and bounded operations. Builders maintained two rosters and
synchronized them across mutations. Other apps used function-mediated
authorization safely but could not clear static visibility warnings without
falsely claiming owner- or membership-row enforcement.

This RFC preserves the closed authority machine and adds a paved bridge:

- an app table or generated membership profile is the declared source of
  participant identity and bounded roles;
- codegen compiles the mapping into an authority IR used by reads and writes;
- generated roster and role projections consume that IR;
- custom authorization can declare analyzable policy inputs or explicitly opt
  out of sync/retention instead of living in a warning half-state; and
- membership-visible search and asset policy can consume the same exact profile
  instead of a mirrored roster.

This is not a general entity framework, Zanzibar graph, or arbitrary policy
engine. It is the smallest composition layer for the application shapes the
cross-model research repeatedly produced.

## Motivation

LLP 0236 separates two truths:

1. Snapback’s server-derived authority and explicit visibility evidence are
   unusually reviewable; and
2. app-specific rosters and roles pay a high integration tax around that core.

The dual-roster cost is particularly harmful. It creates two nominal sources of
truth for “who belongs here?”, demands cross-row mutation discipline, and lets
the product UI and Snapback policy disagree. A platform with a closed
membership machine should not require an app to shadow it merely to show
participants and add a role such as `admin`.

LLP 0231 recommends declared table visibility as the policy locus. This RFC is
a compatible specialization: it defines how a common scoped-roster policy is
declared once, compiled, and projected. It does not replace
0231’s broader table-policy decision.

## Constraints

- Caller assertions never become authority. Principal and role facts are
  resolved from server-owned/session-derived identity and committed app/system
  records.
- Negative authorization changes are obligations: live values reauthorize and
  signed media stops refreshing under existing LLP 0053/0210 semantics.
- Policy must be pushdownable/bounded to join sync, search, collection, or
  retention lanes. Opaque runtime policy remains usable only as an online
  function boundary with explicit nonclaims (LLP 0011; LLP 0172).
- No policy declaration may falsely imply a query is safe merely because a
  table contains a principal-shaped field. The compiler checks the exact field,
  index, role vocabulary, lifecycle, and mutation ownership.
- Protected offline retention is not implied by an authority profile. LLP 0243
  owns its separate lease, purge, projection, and real-store proof.

## Decision

### D1. Declare an application authority profile at the scoped relation

Example:

```js
export const roomMembers = defineTable({
  fields: {
    roomId: v.id("rooms"),
    userId: v.principal(),
    role: v.literal("owner", "admin", "member", "invited"),
    displayName: v.string(),
  },
})
  .membership({
    id: "roomAccess",
    resource: "roomId",
    resourceTable: "rooms",
    principal: "userId",
    role: "role",
    roles: ["owner", "admin", "member"],
    pendingRoles: ["invited"],
    bootstrapRole: "owner",
    lastHolder: { protect: "owner" },
    transitions: [/* closed LLP 0056 transition rows */],
  })
  .authorityProfile({
    name: "roomAccess",
    hierarchy: { owner: ["admin", "member"], admin: ["member"] },
    roster: { visible: ["displayName", "role"] },
  });
```

`authorityProfile` is an authoring facade over that exact LLP 0056 membership
declaration and LLP 0231 table-policy IR. It is not a second transition machine,
role store, writer, or predicate evaluator. The facade lowers its hierarchy to
closed literal role sets in the existing membership predicate IR; it cannot
change the stored role vocabulary or bypass the membership transition matrix.
V1 ships only this app-table-owned mode.

Codegen refuses unless:

- scope and principal fields have exact nominal types;
- the underlying LLP 0056 declaration owns the true `(scope, principal)`
  uniqueness index, stable declaration id, reverse holder index, and resource
  binding;
- roles/statuses are closed literal vocabularies;
- pending status lowers to `pendingRoles` rather than a parallel status
  evaluator;
- `owner` is a real protected membership role, not a parent-table field or
  synthetic claim;
- the profile and membership stable ids are identical and no other active
  profile or legacy authority declaration governs the same relation; and
- every referenced target supports the required authority IR.

The app table is the product roster and the authority backing relation. There
is no second per-app seat ledger for the same profile. Snapback may maintain
system indexes and authorization receipts, but those are derived machinery,
not another editable roster. Existing LLP 0056 declarations remain valid
without this facade. Adoption decorates that same declaration or migrates to a
new stable id after preview; activation forbids co-active authorities for one
stable profile id or scoped relation. A system-machine projection is deferred
compatibility/migration work, not a second v1 source-of-truth mode.

The inherited owner state machine is closed: the creation witness seats the
effective principal as `owner`; for reads, owner implies admin/member and admin
implies member. Ordinary role/leave/remove operations cannot change owners.
Only a current owner may call `transferOwner`, which promotes an active target
and demotes the caller to admin atomically. LLP 0056’s `lastHolder: owner`
final-state and eligibility checks govern every writer and concurrent transfer,
removal, import, and principal change. Resource deletion alone uses its deletion
witness for same-transaction roster teardown; a live scope always retains an
eligible owner.

### D2. Compile one authority IR for read and write decisions

The facade emits `AuthorityProfileV1`, a versioned projection that references
the canonical LLP 0056 membership manifest/predicate identity and LLP 0231
table-policy identity rather than duplicating them:

- scope relation and principal key;
- active/invited status predicates;
- finite role lattice;
- owner/bootstrap invariant;
- transition preconditions;
- authorization-event fields;
- subject derivation for invalidation;
- required indexes and bounded lookup plans;
- permitted visibility/search/asset composition classes; and
- profile/generation identity.

All writes pass through LLP 0056’s central membership writer-class seam below
Ibex buffered writes and HostPlan. Raw handler/HostPlan writes refuse; generated
transition methods are host-evaluated in the transaction; seed/import/admin
lanes retain their tagged privileged rules and all final-state invariants.
Codegen and LLP 0146 conformance explain reachable writers, but they are
evidence—not the security boundary and never a proof that an unenumerated
writer cannot mutate authority.

The same IR feeds:

- table visibility policies under LLP 0231;
- function authorization and plan admission;
- generated membership/role mutations;
- live-query invalidation and authorization dependencies;
- membership-visible search;
- asset grant/parent-sharing plans;
- generated app and admin inspection.

Reads and writes cannot use separate hand-transcribed role logic. A role field
or transition edit rotates the authority-profile generation, appears in
semantic artifact diff, and invalidates/requalifies every dependent generated
surface.

A profile or role-lattice edit that broadens ordinary visibility, or is
incomparable with its predecessor, remains subject to LLP 0234's remotely-prior
content-bound approval and exact-set ratchet. D2 generation rotation records
and invalidates the change; it does not replace that prerequisite.

### D3. Generate the ordinary roster and role surface

Every profile generates exact operations and clients:

```ts
api.roomAccess.list(scopeId, page)
api.roomAccess.myRole(scopeId)
api.roomAccess.invite(scopeId, principal, role)
api.roomAccess.join(scopeId, invitation)
api.roomAccess.leave(scopeId)
api.roomAccess.changeRole(scopeId, principal, role)
api.roomAccess.transferOwner(scopeId, principal)
api.roomAccess.remove(scopeId, principal)
```

The descriptor chooses which operations exist. Unsupported transitions are
absent, not runtime no-ops. Generated roster projections contain only fields
explicitly marked visible; private membership metadata remains private. Public
participant profiles join through a separately declared bounded relation and
never make the authority row itself public by accident.

Every mutation returns an authority transition receipt with predecessor,
successor, affected subject/scope, invalidation disposition, and stable refusal
codes. React/Expo get hooks generated under LLP 0238’s reference/lifecycle
vocabulary.

Generated reads and refusals inherit LLP 0056’s non-enumeration contract. An
unauthorized caller cannot distinguish an absent scope/member from one hidden
by roster visibility; detailed existence, role, and transition traces stay on
authenticated developer/admin inspection.

### D4. Custom function-mediated authority has an honest declaration

When finite scoped roles do not fit, an operation can declare:

```js
authorization: authorization.custom({
  inputs: [
    policyInput.table("documentShares", {
      subject: "ctx.auth.userId",
      key: ["documentId", "userId"],
    }),
  ],
  evaluate: canReadDocument,
  offline: "none",
  sync: "reauthorize-on-change",
})
```

This clears static “unknown authority” warnings only for the claims the
descriptor proves:

- declared backing inputs are complete for invalidation;
- online invocation reauthorizes on their change; and
- no offline/retention or pushdown claim is made unless the evaluator compiles
  to an admitted IR.

Precise `sync: "reauthorize-on-change"` activates only when LLP 0146 strict
input completeness is enabled and enforceable on the target. An observed or
attempted undeclared authority read refuses before value release and cannot be
downgraded to a warning while the precise claim remains active. Strictness may
strengthen refusal; it may never preserve a static completeness claim after
contradictory observation.

Without enforced completeness, an opaque evaluator may still be a valid
online-only policy, but it compiles as `sync: "coarse-global"`: every relevant
application/authorization change reauthorizes, the completeness warning stays
visible, and no pushdown, retention, protected local execution, or precise
invalidation claim is emitted. A target unable to provide even that
conservative wake refuses the policy. An author cannot silence either lane with
a free-form string.

When a custom evaluator or an ordinary named handler must inspect rows that
Class-R table visibility hides from the caller in order to make its
authorization decision, the sanctioned read path is LLP 0231 D7's call-local
`ctx.db.elevated` after a `ctx.permissions` check — not widening the backing
table's declared visibility. The profile adds no second elevation mechanism:
D7 governs trusted handler reads, and invocation-wide or no-principal
authority remains LLP 0234's governed-override problem.

### D5. Asset sharing composes through the authority profile

LLP 0239 media commands and LLP 0210/0220 grants can select:

```js
sharing: assetSharing.authorityProfile("roomAccess", {
  minimumRole: "member",
  scopeArg: "roomId",
})
```

This does not mint one durable grant per current member by default. The asset
read policy records the authority-profile scope/generation and resolves access
through the compiled indexed membership check; authorization changes trigger
LLP 0053 invalidation and stop new signed issuance. Per-recipient pending/active
grants remain the correct profile for view-once or explicitly individual
authority.

The choice is declared per intent/command. The platform never infers
parent-row readers or all roster members from app naming.

This composition is not required to activate the profile itself. V1 lands the
membership/policy profile first with asset composition negative; only after
LLP 0239’s media binding and this profile independently qualify does codegen
admit the cross-reference. A missing half refuses generation and cannot create
a profile↔media activation cycle.

### D6. Inspection and diagnostics explain effective authority

Authenticated developer inspection can answer, for a named principal and
operation/view:

- which profile/generation applied;
- scope and resolved role/status;
- which policy branch admitted or denied;
- backing rows/index plans read;
- invalidation and offline-eligibility disposition (the latter as a reference
  to LLP 0243, never inferred here);
- asset-sharing consequences; and
- the exact guide/code source link.

Payloads contain ids, enum facts, and policy identities only under the
authenticated/admin tier; public surfaces receive no roster or policy oracle.
Generate-time errors distinguish missing index, ambiguous owner, ungoverned
write path, unsupported target, and an unsupported composition class.
Runtime denials reuse declared application refusal-code machinery rather than
generic `SNAPBACK_HANDLER_FAILED`.

## Compatibility and migration

Three existing states remain valid:

- closed Snapback membership machine;
- product roster plus explicitly app-managed policy; and
- owner/public or other table visibility under existing declarations.

Adoption is explicit. `snapback authority plan` produces a read-only migration
report comparing a selected roster to a profile:

- duplicate/missing principals;
- role/status values outside the closed vocabulary;
- scopes with no owner/admin;
- migration-only legacy seat/product-row divergence (never a steady-state
  health signal or second ledger);
- ungoverned write operations;
- missing indexes;
- dependent search/assets/queries; and
- profile generations whose dependents require invalidation.

Apply occurs through ordinary migration/operator workflows after review. There
is no automatic choice of which roster wins a conflict.

Existing custom-policy warnings become one of three states: proven by profile,
honestly declared online-only custom authority, or unresolved warning/refusal.
They are never suppressed by migration alone.

## Alternatives considered

### Weaken the closed membership machine to accept arbitrary app rows

Declined. The machine’s bootstrap, transition, invalidation, and boundedness
properties are the reason it is useful. The profile compiler admits only app
rows that satisfy an equivalent closed contract.

### Keep two rosters and generate synchronization mutations

Declined as the destination. It automates a dual-source-of-truth architecture
and leaves divergence recovery as permanent product work.

### Adopt a general relationship-tuple/Zanzibar engine

Declined for v1. It adds a new storage/query/consistency model far beyond the
observed scoped-role demand and complicates scale-to-zero. The finite IR should
leave a future adapter seam, not prepay it.

### Bundle protected retention and query-shape expansion into this decision

Declined. Both consume authority facts, but their safety and rollout proofs are
independent. LLP 0242 owns bounded query shapes; LLP 0243 owns policy-aware
protected retention. Accepting this RFC neither accepts nor blocks either one.

## Rollout

1. **Facade lowering.** Project the existing LLP 0056 membership manifest and
   LLP 0231 policy IR into the profile identity; add no second evaluator and no
   offline retention.
2. **Roster and role facade.** Generate common operations/hooks and migrate one
   dual-roster demo, including owner transfer and concurrent last-owner cases.
3. **Policy composition.** Feed table visibility, strict/coarse custom
   authorization, and search from the canonical IR; prove invalidation and
   no-warning behavior.
4. **Asset composition.** Enable it only after LLP 0239’s binding capability
   independently qualifies.
5. **Published-package rerun.** Rebuild Clique’s roster,
   membership-visible search, and media sharing without dual state or permanent
   visibility warnings.

Capabilities advertise independently per phase and target. Unsupported arms
refuse at generation rather than silently degrading authority.

## Acceptance

- One committed roster is both product-visible and the authority source; no
  mirrored seats/rows or synchronization mutation exists.
- Concurrent join/promote/remove/last-owner cases preserve uniqueness and
  bootstrap invariants transactionally.
- Bootstrap seats a real owner row; transfer promotes the target and demotes
  the caller atomically; leave/remove/demotion/import/deactivation cannot leave
  a live scope without an eligible owner.
- Raw Ibex, HostPlan, seed/import/admin, and future writer classes all meet the
  inherited central writer seam; codegen reachability is never the enforcement
  boundary.
- The same profile identity and role answer appear in write admission, live
  query invalidation, search, asset access, and inspection.
- A strict custom evaluator refuses any undeclared authority input before value
  release; a non-strict evaluator stays visibly coarse-global and cannot enable
  retained reads.
- Revoking membership stops new signed media issuance and blanks first-party
  projections under the existing authority rules.
- A fresh agent implements the Clique roster/search/media-policy slice without
  a dual roster or permanent visibility warning.

## Risks

- The profile can grow into a policy language. V1 is a closed finite role
  relation with a small set of composition classes; additions require explicit
  IR/version review.
- App-owned rows are easier to corrupt through ungoverned writes. Codegen must
  enumerate them for diagnostics, while LLP 0056’s central writer seam remains
  the unbypassable transition/final-state boundary.
- Subject-targeted invalidation can miss a revocation. V1 may conservatively
  invalidate a whole profile/scope until completeness is proved; optimization
  never precedes safety.

## Open questions

1. Can profile-backed asset reads avoid per-recipient grant rows on every target
   without adding an unacceptable lookup to signed issuance?
2. Should membership-visible search compile directly from the profile IR or
   consume a separately generated visibility plan so search stays decoupled?

## Status

Accepted. This RFC requests an author decision on the application authority
profile. V1 is an app-table-owned facade over LLP 0056 membership and LLP 0231
policy identity, with a real protected owner role and no co-active authority
machine. It can be reviewed independently of LLP 0242/0243.
