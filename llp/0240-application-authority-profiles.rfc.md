# LLP 0240: Application authority profiles

**Type:** RFC
**Status:** Accepted
**Systems:** Auth, Authorization, Memberships, Schema, Application data API,
Live Queries, Assets, Code generation, Diagnostics, Guide, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-12
**Revised:** 2026-08-22 (W4 blocking-review corrections: history authority
axes are roster-visible-only, pending-only invitations and private incarnation
ids are result-omitted, recipient snapshots are exact sending-operation/product-row
sinks with no principal result, fork custody covers projection state, and the
outcome matrix distinguishes absent from hidden targets). 2026-08-22 (LLP 0295 W4 implementation: projection declaration,
writer-seam row-image history/incarnations, D1+horizon reads, transaction-frozen
recipient helper, three-class outcome metadata, read-only adoption plan,
authorization-facts-only backfill, and packed Explicit/Familiar proof). 2026-08-21 (LLP 0295 D0.4 ruling recorded: the product-projection
composition to prototype first is platform-generated projection facts declared
on the authority profile, read through the existing D3 bounded/redacted roster
surface; app-authored synchronized mirrors stay declined as the destination —
see the dated amendment. Same-day review revisions: writer-seam row-image
capture with `provenance: "full"` activation; a preserve-and-extend D3 read
surface with history as new D1-envelope operations carrying an explicit
history-horizon fact and coverage classes; a bounded send helper with typed
refusal; and a closed three-class absent/idempotent outcome matrix). 2026-08-17 (closes the Phase 3 review findings: membership-table
search projection is roster-bounded, named search handlers carry generation
dependence, D6 evaluates the named index's lowered roles, and custom-evaluator
policy reads join the static elevated-access inventory). 2026-08-16 (records the source-current Phase 3 implementation:
membership-visible search lowers directly from `AuthorityProfileV1` into the
existing search visibility plan; custom authorization ships only the visibly
incomplete coarse-global lane and refuses precise sync; authenticated D6
inspection links the runtime answer to the static LLP 0173 artifact). 2026-08-16 (reconciles landing A `824e3ef7f` and reviewed landing
**Revised:** 2026-08-16 (ships the dedicated package-generic React/Expo roster,
role, mutation-receipt, and durable-status lifecycle hooks. Truthful operation
metadata necessarily rotates the profile and generated client generation;
authored inputs, runtime schema hash, and executable identity remain unchanged).
2026-08-16 (reconciles landing A `824e3ef7f` and reviewed landing
B `15c6829c2`: B's generated-operation contract, post-commit receipts, cursor
custody, gating, and non-enumeration are canonical; A's RBAC table-visibility
composition and per-profile operation vocabulary remain additive. Ordinary
client and generic React hooks accept the generated references; search/assets,
hosted profiles, and the external Clique rerun remain open). 2026-08-15 (records the shipped local handler-admission and
bounded `list`/`myRole` slice: Explicit and Familiar handlers declare the
canonical membership predicate, generated reads use a captured non-terminal
evaluation, mutations use its terminal twin, and removal blanks live delivery;
generated transitions, pagination, search/assets, and hosted profiles remain
outside this slice). 2026-08-15 (D4 cross-references LLP 0231 D7 `ctx.db.elevated` as
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
LLP 0242, LLP 0243, LLP 0278, LLP 0295,
Diary 0058 (messaging-snapback), Diary 0073, Diary 0074, Diary 0100,
Diary 0101, Diary 0105,
`issues/closed/20260821-private-authority-product-roster-decision.md`,
`issues/20260820-guide-gap-membership-roster-projection-recipe.md`

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
and atomically demotes the caller to active `admin` when present, otherwise to
the first active non-owner role in declared hierarchy order. Profiles with no
active non-owner role omit and refuse transfer because no valid caller successor
exists; selecting the available successor prevents `lastHolder: owner` from
permanently stranding an owner in a lattice such as `owner` plus `member`. LLP
0056’s final-state and eligibility checks govern every writer and concurrent
transfer, removal, import, and principal change. Resource deletion alone uses
its deletion witness for same-transaction roster teardown; a live scope always
retains an eligible owner.

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

The reviewed generation-consumer file allowlist has an access-lint for direct
field idioms throughout each enumerated Rust file. Residual: new files, helper
indirection, and receiver identifiers outside the scanned root set.

`membership-visible-search.v1` compiles directly from this profile into the
existing `SearchVisibilityV1::Membership` carrier. Codegen closes the search
role set through `roleLattice`, retains the profile `{ id, generation }`
dependence, and lets the existing indexed membership check, cursor binding,
and authorization invalidation enforce the read. It does not emit a second
generated visibility-plan object. That direct choice keeps one runtime search
consumer and avoids a profile-derived policy copy whose shape or generation
could drift from the already-qualified search plan. When the searched table is
the profile's membership table, text, stored, and highlight fields are bounded
to `roster.visibleFields`; explicitly authoring any invisible field refuses
generation. The named index's lowered role predicate remains the row scope.
Asset sharing remains in `notYetQualifiedCompositionClasses` and still refuses
generation.

The first local implementation exposes that identity to named handlers as a
declaration-bound `membership` predicate. Codegen accepts only a direct,
nominally typed resource argument, lowers the requested minimum roles through
the profile lattice, and inserts the membership table into the captured read
set. Queries and live queries evaluate the predicate through a non-terminal
`permissions.allowsRole` host read and return their empty row set before the
opaque handler on denial. Mutations evaluate the same lowered role set through
terminal `permissions.requireRole`. App source therefore carries one policy
declaration rather than repeating role checks; row-derived/multi-hop policy
remains under D4's explicit handler sequence.

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
absent, not runtime no-ops. Codegen stamps each synthesized operation with a
closed manifest identity; receipt publication and host-private principal/id
marshalling require that identity, never a matching function name. Generated
roster projections contain only fields explicitly marked visible, and their
continuations AEAD-encrypt the complete private keyset boundary under the
server's envelope-key custody. Private membership metadata therefore remains
private across the generated facade. This is not a blanket `ctx.db` denial for
an implicitly visible membership table; applications that require such a raw
read boundary must also declare a supported table-visibility policy. Public
participant profiles join through a separately declared bounded relation and
never make the authority row itself public by accident.

Every mutation returns an authority transition receipt with predecessor,
successor, affected subject/scope, invalidation disposition, and stable refusal
codes. Its generated reference uses the ordinary client and generic React/Expo
hooks. The package-generic dedicated hooks project the same LLP 0238 query,
dispatch, and durable-disposition lifecycles without adding an app-specific
codegen surface or another client protocol.

Generated reads and refusals inherit LLP 0056’s non-enumeration contract. An
unauthorized caller cannot distinguish an absent scope/member from one hidden
by roster visibility; detailed existence, role, and transition traces stay on
authenticated developer/admin inspection.

The qualified local server/codegen surface emits live references named
`api.<profile>.list` and `api.<profile>.myRole`, plus exactly the subset of
`invite`, `join`, `leave`, `changeRole`, and `remove` justified by the closed
membership transition matrix. Any profile with `owner` and at least one active
non-owner role admits the dedicated `transferOwner` operation; ordinary
transitions still cannot mutate an owner. An unsupported transition leaves its
operation absent rather than installing a runtime no-op.

`list` accepts `{ scopeId, page?: { after?, limit? } }`, projects only
`roster.visible`, and carries its next boundary through the AEAD-sealed `sbpc2`
cursor envelope. The host-private keyset is bound to application, declaration,
scope, ordering, profile generation, caller authority, and active artifact
identity. Admission precedes cursor parsing, so an outsider cannot distinguish
a malformed cursor or hidden scope from another role denial. `myRole` returns
the server-derived caller's role/status projection. Both reads capture the
membership dependency needed for live reauthorization.

Generated mutations address scopes and principals publicly while private row
resolution stays below the writer seam. Successful committed settlements carry
`authorityTransitions` with predecessor/successor state, subject, scope, and
invalidation disposition. The atomic owner transfer yields two same-commit
receipts. Preview, conflict, denial, and other failed attempts do not fabricate
post-commit receipts. `useSnapbackAuthorityRoster` adds opaque-cursor
load-more/reset custody to the canonical live query; scope, caller, and
generated-reference generation changes discard retained pages.
`useSnapbackAuthorityMyRole` projects the caller's zero-or-one live row, while
`useSnapbackAuthorityMutation` and `useSnapbackAuthorityMutationStatus` retain
post-commit receipts and stable refusal codes through the ordinary dispatch and
durable-disposition vocabulary. Expo re-exports those same hooks.

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
  sync: "coarse-global",
})
```

This clears static “unknown authority” warnings only for the claims the
descriptor proves:

- every direct elevated evaluator read site names one declared backing input,
  and every declared input has such a witnessed site;
- online invocation uses the profile IR's conservative wake-universe
  vocabulary and reauthorizes on every relevant application or authorization
  change; and
- offline, retention, pushdown, protected-local-execution, and precise
  invalidation are all explicitly `none`/false.

Generation emits
`SNAPBACK_CUSTOM_AUTHORIZATION_INPUT_COMPLETENESS_UNPROVEN` for this lane and
projects the complete fact under the operation in
`authorization-review.json`. The warning is intentional: site witnessing is
not a proof that a future runtime read cannot escape an author-declared input.

Precise `sync: "reauthorize-on-change"` is not active today. Generation refuses
it with
`SNAPBACK_CUSTOM_AUTHORIZATION_PRECISE_COMPLETENESS_UNAVAILABLE`, explicitly
naming the missing LLP 0146 enforceable strict-input-completeness
prerequisite. It is never silently downgraded to coarse-global.

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

The source-current local implementation serves this answer at
`POST /_snapback/api/authority/effective` under the registered `AdminWrite`
policy. The request names an exact profile generation, principal, optional
scope, and closed operation/view enum; a membership-visible-search view also
names the exact `{ table, name }` search index whose lowered role branch is
evaluated. The response projects the resolved
role/status, admit/deny branch, membership row ids and creation provenance,
the `_membership_pk` and transition-log index plans, latest matching transition
identity, global authorization invalidation disposition, the LLP 0243 offline
reference, the still-refused asset-sharing consequence, and exact guide/code
sources. It links `snapback.authorization-review.v2` as the static half rather
than copying that operation inventory into runtime state. Authentication runs
before JSON extraction or lookup; public `/inspect` remains unchanged, and
different unauthenticated inspection-shaped probes are byte-identical.

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

1. **Facade lowering (implemented locally).** Project the existing LLP 0056 membership manifest and
   LLP 0231 policy IR into the profile identity; add no second evaluator and no
   offline retention.
2. **Roster and role facade (implemented locally except external rerun).**
   Generate opaque-paged `list`, `myRole`, the transition-derived mutations,
   durable authority receipts, and common named-handler admission in Explicit
   and Familiar. The references ride the ordinary client/generic hook surface;
   package-generic dedicated LLP 0238 React/Expo hooks now cover roster
   pagination, caller role, receipt-bearing dispatch, and durable status. The
   external Clique rerun remains.
3. **Policy composition (table visibility demonstrated locally).** The RBAC
   witness feeds table visibility from the canonical IR and records the governed
   transition ledger. Strict/coarse custom authorization, membership-visible
   search, and asset composition remain refused/unimplemented.
4. **Asset composition.** Enable it only after LLP 0239’s binding capability
   independently qualifies.
5. **Published-package rerun.** Rebuild Clique’s roster,
   membership-visible search, and media sharing without dual state or permanent
   visibility warnings.

Capabilities advertise independently per phase and target. Unsupported arms
refuse at generation rather than silently degrading authority.

### 2026-08-16 rollout record — steps 2 and 3

The local profile manifest now pins every generated operation's kind,
authentication requirement, ordinary-client lifecycle compatibility, and
backing transition vocabulary. The server admits that frozen surface, resolves private subjects
without returning row ids, and hands one command to LLP 0056 inside the
authoritative transaction. Owner creation/removal stays outside ordinary
transitions; transfer promotes the target and demotes the caller atomically,
with last-owner and stale-predecessor checks at commit.

The dedicated client slice adds hook names to that frozen operation metadata.
Because the profile descriptor participates in normalized schema/contract
identity, this honesty change necessarily rotates the authority-profile,
generated client generation, and per-function client-contract
`implementationHash` values. The authored input hash, runtime `schemaHash`,
emitted handler-source digests, and aggregate executable identity do not
change. No authority evaluator, wire operation, generated reference, or
storage rule changed.

The RBAC demo now has one resource-scoped `appMembers` relation as both product
roster and authority. Its `applications` and `announcements` policies consume
that profile's same membership fact, so role writes drive visibility and live
invalidation without a mirrored app-wide roster. This closes rollout step 3's
table-visibility class only. Steps 4–5 remain: asset composition is gated on
LLP 0239's independent qualification, and Clique has not been rebuilt.

The executable evidence anchors are Team Chat's ten-check headless acceptance
at `demos/team-chat/tests/acceptance/headless.mjs` and RBAC's profile/policy
acceptance at `demos/rbac/tests/acceptance/rbac.mjs`.

Team Chat's post-reconciliation physical table is `roomMembersV2`: LLP 0264
landed after B and correctly refuses removing or widening the installed v1
policy closure in the same push. The v1 tables remain inert append-only
governance history, while the restricted v2 root is the one active roster and
authority source. This versioned migration does not reintroduce synchronized
dual state.

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

## Resolved questions

2. **Resolved 2026-08-16 — compile direct.** Membership-visible search compiles
   from the profile IR into the existing `SearchVisibilityV1::Membership`
   carrier; D2 records the identity, invalidation, field-boundary, and
   single-consumer rationale.

## Amendment (2026-08-21 — LLP 0295 D0.4 ruling: product projection composition)

**Adopted per LLP 0295; author may revise.**

The published 0.1.24 matrix and the current-source Clique rerun (LLP 0295;
Diary 0100/0101/0105;
`issues/20260820-guide-gap-membership-roster-projection-recipe.md`) showed that
even with this profile's generated roster surface, chat-shaped products still
hand-maintain a second projection for the facts the current-state relation
cannot answer: display metadata beyond `roster.visible`, join timestamps,
leave/rejoin history, send-time recipient sets, and receipt membership. LLP
0295 D0.4 compared three compositions:

1. **App-authored maintained projection with a generated synchronized command
   facade.** Rejected as the destination. This is the "keep two rosters and
   generate synchronization mutations" alternative this RFC already declined:
   it automates dual sources of truth, makes transition atomicity depend on
   every writer using the facade, and leaves divergence recovery as permanent
   product work. It remains the sanctioned *interim* pattern the open guide
   ticket teaches until the generated design lands, and the guide must not
   present it as final.
2. **Projection facts declared on the authority profile and generated by the
   platform.** **Selected — prototype first.**
3. **Authorized roster query over a bounded redacted projection.** Not a
   competitor: D3's `list`/`myRole` already *is* this surface, and it stays the
   read path for whatever option 2 generates. Alone it is insufficient because
   the backing relation is current-state only — no query over it can answer
   leave/rejoin incarnations or a recipient set as of a past send.

### Why option 2 first

The decisive fact is the writer seam. Every membership transition already
passes through LLP 0056's central writer-class seam, so the platform holds,
inside the authoritative transaction, the complete before/after row images the
product projection must be derived from. A platform-generated projection
maintained **from those in-transaction row images at the writer seam** is
atomic by construction; an app-authored mirror (option 1) can only approximate
that with discipline, and an authorized query (option 3) cannot reach facts
the relation no longer stores. Option 2 is also the smallest authored-surface
delta: the profile already declares `roster.visible`; it grows a declared
product projection rather than a new table protocol.

The transition *ledger* is deliberately not the projection's data source. As
shipped, `record_membership_transition`
(`crates/snapback-kernel/src/storage.rs`) records rows only when the
membership declares `provenance: "full"` — which D1 does not require — skips
updates touching no authorization-affecting field, and stores authority axes
(principal, resource, roles, writer provenance), not display values or join
timestamps. The ledger is corroborating provenance and inspection evidence
(D6); the projection's source of truth is the writer-seam row-image capture.

### Projection activation, source capture, and backfill

- **Activation.** Declaring a `projection` clause requires (and codegen
  enforces) `provenance: "full"` on the same membership declaration, so the
  ledger corroborates every **authorization-relevant** transition from
  activation forward (the recorder deliberately skips updates touching no
  authorization-affecting field; display-only changes are covered by the
  writer-seam row-image capture, not the ledger). A profile without full
  provenance refuses the clause at generation with the missing prerequisite
  named.
- **Source capture.** Projection maintenance runs at the writer seam in the
  same transaction as the transition, reading the transition's before/after
  row images (including non-authorization product fields such as a display
  name). It never re-derives product values from the ledger after the fact.
- **Legacy profiles and backfill.** Activating `projection` on an existing
  profile is an ordinary generation-rotating migration. Generated history
  begins at an explicit **history horizon** — the activation commit — and the
  read surface states the horizon rather than fabricating pre-activation
  history. The horizon has a defined carrier: the new generated history
  operations' result envelope carries an explicit **horizon fact** beside the
  LLP 0278 D1 pagination fields — D1's `boundary` states page exactness and
  is never overloaded to mean historical completeness. The horizon fact
  names the earliest covered commit and its **coverage class**: `full` for
  the span from activation forward. Where a full-provenance ledger predates
  activation, `snapback authority plan` may offer role/status-fact backfill
  from it (never display values the ledger does not hold), reported as a
  distinct reviewed migration step; an applied backfill **moves the horizon
  back** for the span it covers and marks that span with the explicit
  partial coverage class `authorization-facts-only`, so a reader can always
  distinguish complete history, partial backfilled history, and the
  pre-horizon absence of history.

### Authority facts versus product facts

The ruling partitions the roles explicitly rather than letting one
representation silently serve both, and it maps each product fact to exactly
one home:

- **Authority facts** — current `(scope, principal, role, status)`, owner
  invariant, transition preconditions — live only in the profile's backing
  relation and IR. Nothing in this amendment widens who can read them.
- **Current-state display fields** stay where D1/D3 already put them: on the
  authority-backing app table, projected through `roster.visible`. The
  `projection` clause must not duplicate a D3 current-state field; codegen
  refuses the overlap. Only display metadata *beyond* the current row —
  historical values, departed members' names — enters the projection.
- **Historical authority-axis redaction** follows the same declaration as the
  current roster. `principal`, `scope`, and role-derived `role`/`currentRole`/
  `status` appear in history/incarnation results only when the corresponding
  membership principal/resource/role field is named by `roster.visible`.
  `history.visible` cannot opt into those axes, and private membership row or
  incarnation ids never leave the host.
- **Join time and leave/rejoin incarnation history** are same-transaction
  writer-seam projections captured from row images, declared in the
  `projection` clause, durable product rows.
- **Send-time recipient snapshots** are frozen by the generated helper onto
  the sending mutation's own product rows (message/receipt rows) inside the
  sending transaction. They are never ledger-derived and never recomputed at
  read time.
- **Receipt membership aggregates** over bounded entity sets are LLP 0278 D4
  set-keyed aggregate shapes over those product receipt rows, not membership
  projections.

All product facts are readable only through the generated bounded surface,
never a second authority evaluator.

### Invariants the prototype must preserve

- **Private-row non-enumerability.** Projection reads ride D3's admission
  discipline: admission precedes cursor parsing, only declared-visible facts
  project, and an unauthorized caller cannot distinguish absent from hidden.
  History/incarnation reads carry the same non-enumeration contract as `list`.
  A membership incarnation whose latest state is pending/invited is omitted
  from both operations. If it later becomes active or departed, its captured
  history becomes eligible under the ordinary admitted/redacted result shape;
  pending-only invitations are never a history enumeration channel.
- **Transition atomicity.** Projection maintenance occurs in the same LLP 0056
  writer-seam transaction as the transition; there is no asynchronous mirror
  and no observable window where roster and projection disagree.
- **Send-time recipient semantics.** The profile declares one or more exact
  `{ operation, table, scopeField, recipientsField }` sinks. Codegen admits a
  sink only when the named operation is an authored mutation that declares a
  write to the product table, the scope field has the profile's nominal scope
  type, and the recipient field is a bounded principal array covering the
  declared ceiling. A generated recipient-snapshot helper
  resolves the active member set inside the sending mutation's transaction
  through the profile's indexed membership plan and freezes it as product data
  on the named sent row. The helper requires that operation's generation-bound
  private identity, refuses every other mutation, and returns only `null`; the
  handler never observes the principal set. Later join/leave does not rewrite a prior
  send's recipients. The helper is bounded: the profile declares a recipient
  ceiling (provisional upper bound: the relational take ceiling, 1,024, from
  `packages/snapback-contract/limits.mjs`), and a send into a scope whose
  active membership exceeds the declared ceiling **refuses with a typed
  structured refusal** — it never silently truncates the recipient set.
- **Leave/rejoin history.** Leave or removal closes an incarnation record
  rather than erasing it; rejoin opens a new incarnation. An incarnation is a
  continuous membership presence: `changeRole` does **not** close an
  incarnation — role changes record as events within the current incarnation.
  The current-state relation stays clean; history lives in the generated
  projection.
- **Exact acceptance over absent/idempotent branches.** D3's posture is
  unchanged: unsupported transitions leave operations absent, not runtime
  no-ops. The prototype pins each supported operation's absent/idempotent
  branch, at codegen from the transition matrix, to exactly one of three
  closed outcome classes:

  1. **idempotent-success, unchanged** — the caller is
     authorized and the requested end state already holds (e.g. `changeRole`
     to the principal's current role), or `remove` addresses an already-absent
     target. The generated handler result remains `null`; because no write
     occurred, settlement carries no fabricated authority-transition receipt;
  2. **typed application refusal** naming the violated precondition — the
     caller is authorized to observe the fact (e.g. `invite` of an
     already-active member, `transferOwner` to the current owner); or
  3. **non-enumerating denial** — the caller is not authorized to observe
     scope/member existence (e.g. `leave`/`remove` against a scope or
     principal the caller cannot see), indistinguishable from any other
     denial per D3's non-enumeration contract.

  Which class each operation-by-branch cell takes is generated manifest
  metadata, not a runtime improvisation; the vertical fixture asserts one
  cell from each class.

### Read-surface compatibility ruling

The shipped D3 surface is preserved, not versioned or broken:

- `list` and `myRole` keep their exact shipped contracts: `list` takes
  `{ scopeId, page?: { after?, limit? } }` and returns
  `AuthorityRosterPageV1 { rows, cursor }` with the AEAD `sbpc2` cursor,
  projecting only `roster.visible` current-state rows; `myRole` returns the
  caller's `{ role, status }` projection row (it never carried the page
  shape). `list` never starts returning history or incarnation rows.
- History/incarnation reads are **new generated operations** that reuse D3's
  admission-before-cursor discipline and AEAD cursor custody while adopting
  LLP 0278 D1's `{ rows, cursor, boundary }` envelope, extended additively
  with the history-horizon fact defined above. They are new surface, so no
  shipped consumer breaks and no bespoke roster page shape is invented.
- `boundary` may join `AuthorityRosterPageV1` only as an explicitly additive
  optional field through an ordinary generation rotation, never as a
  retroactive required field.

### Offline retention non-implication

Restating this RFC's constraint for the new surface: a `projection` clause
implies **no** protected offline retention. Generated history and recipient
projections are online-read product data; offline eligibility, lease, purge,
and real-store proof remain LLP 0243's separate ownership, and nothing in
projection activation changes a profile's offline posture.

### Ownership and sequencing

This RFC owns the authority side; LLP 0278 owns the read shapes (the paged
history envelope is a D1 consumer, and receipt aggregates over entity sets
are ruled to ship as D4 set-keyed aggregates over the product receipt rows —
until D4 lands, receipts read as bounded per-entity queries within the LLP
0278 subscription budgets). Neither side may weaken the other to simplify
adapters (LLP 0295 W4). Migration for apps that already maintain a
hand-rolled mirror goes through `snapback authority plan`, which learns to
compare an existing projection table against the generated projection before
adoption. Per LLP 0295's vertical paved-path coherence invariant, the
prototype lands with a vertical packed-package contract fixture covering both
authoring profiles. The implementation checklist lives in
`issues/closed/20260821-private-authority-product-roster-decision.md`.

### 2026-08-22 implementation record — LLP 0295 W4

The local target now implements the dated D0.4 ruling:

- `authorityProfile({ projection: { history: { visible }, recipients: {
  ceiling, sinks } } })` lowers in both Explicit and Familiar. Codegen requires
  membership `provenance: "full"`, rejects authority-axis/current-roster
  duplication, and rotates the generation identity.
- The central membership writer captures before/after row images into
  `_snapback_authority_projection_events` in the same transaction for buffered
  insert/update/delete and seed/import/admin paths. Activation snapshots
  existing current rows at a generation-bound horizon. Storage-identical
  updates do not mint history.
- New generated `history`/`incarnations` live operations admit before parsing
  operation identity, page bounds, or a cursor; bind AEAD custody to
  declaration/generation/scope/caller/operation,
  and return `{ rows, cursor, boundary, horizon }`. `list` and `myRole` remain
  unchanged. Authority axes follow `roster.visible`, private incarnation ids
  never return, and pending-only invitations are omitted. Leave closes an
  incarnation; rejoin opens another; role changes are interior events.
- Mutation-only `snapshotRecipients(scopeId, rowId)` is available only to its
  declared sending operation, writes the principal array directly to the
  exact declared product-row sink, returns `null`, uses the same sending transaction, and
  captures its indexed read dependency. Overflow refuses with
  `SNAPBACK_AUTHORITY_RECIPIENT_CEILING_EXCEEDED`; 1,024 is the declaration
  maximum and no path truncates.
- Generated mutation metadata carries the closed outcome matrix. Runtime
  implements storage-identical `changeRole` and absent-target `remove` as
  unchanged success, visible absent `changeRole` and duplicate invite as typed
  preconditions, and hidden targets/scopes as non-enumerating denials.
- `snapback authority plan` performs a read-only mirror comparison with
  counts/digests and reports activation/backfill posture. `snapback authority
  backfill --apply --confirm authorization-facts-only` is idempotent, moves
  the horizon only for available ledger role/status facts, and never fabricates
  display values or timestamps.

The packed proof is
`packages/snapback-codegen/authority-projection-packed.test.mjs`; codegen
matrix coverage is in `rbac-authoring.test.mjs`, storage behavior in
`crates/snapback-kernel/src/storage/tests.rs`, and the public route in
`guide/recipes/membership-roster-projection.md`.

## Status

Accepted. This RFC requests an author decision on the application authority
profile. V1 is an app-table-owned facade over LLP 0056 membership and LLP 0231
policy identity, with a real protected owner role and no co-active authority
machine. It can be reviewed independently of LLP 0242/0243.
