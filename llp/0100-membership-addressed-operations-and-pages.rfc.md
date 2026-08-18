# LLP 0100: Membership-addressed operations and pages

**Type:** RFC
**Status:** Accepted
**Systems:** Memberships, Authorization, Query planning, Pagination, Code generation, Live Queries, Diagnostics, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-26
**Revised:** 2026-08-01 (lane M2 implementation: the §4 pages surface and
§5 custody delta are IMPLEMENTED on the local target —
`defineMembershipKeysetPages` in packages/snapback-codegen/
standard-patterns.mjs emitting the callable-only Query pair with the
declaration-bound seat predicate and the §5 generation-time facts on the
standard pattern; the runtime registry admits `membership-keyset-pages.v1`
and the cursor binding digest extends with the five §5 member groups
(normalized argument values incl. the exact resource id, membership
declaration facts, durable global AuthorizationVersion pair, data-version
stream, active artifact identity) while the owned profile's digest stays
byte-identical; §Acceptance's membership-pages rows run in crates/snapback/src/local.rs
including the mandatory cross-resource VALUE negative and the
per-component mutation schedule. Team Chat adoption and its three product
receipts (implementation-order step 6) landed on the local target in
`demos/team-chat`, closing both product-adoption tickets; the broader composed-
family witness remains owned by its other program lanes.)
2026-08-01, later same day (the one §Acceptance row that
spans both surfaces — "the absent-target no-op advances no authorization
version and the present-target removal does … asserted via cursor
validity across each branch" — is now witnessed:
`membership_keyset_cursor_witnesses_the_scoped_removal_disclosure`
in crates/snapback/src/local.rs runs both branches against one instance carrying the §2
opt-in and the §4 pages, using an uninvolved third party's outstanding
continuation as the observable while that holder's own seat survives
both branches, so the difference is attributable only to the epoch.) 2026-08-01 (M1 core operations LANDED: §§1–3 implemented on
the local target — `principalAddressedWrites` activation with the carrier
contract (codegen + `validate_membership_declaration`), the generated
`removePrincipal` command with the §3 refusal ordering, captured
present/absent lookups, the exact no-op commit, typed emission, and the
`myMemberships` seat-drop receipt; acceptance rows witnessed in
crates/snapback/src/storage.rs, crates/snapback/tests/membership_principal_addressed_v0.rs, crates/snapback/src/local.rs,
and rbac-authoring.test.mjs; guide section landed
(guide/auth/scoped-roles.md). Team Chat adoption and the
composed family witness remained open at that checkpoint — Status stays
Accepted.)
2026-08-01 (ACCEPTED by explicit composed-parent ruling: the
author's 2026-08-01 ballot, verbatim item 2, "ruling: accept" — the
explicit maintainer ruling this RFC's own §Status and ratification
boundary names as the alternative to LLP 0056 (still Review) reaching
Accepted first, ratifying the exact composed parent slice and this RFC
together, ahead of LLP 0056. Grounds: the converged dual-family loop —
Fable READY at round 2, Codex READY at round 3, zero unresolved concerns
(reviews/0100-membership-addressed-operations-and-pages.{fable,codex}.md).
If LLP 0056's own loop later diverges from the composed slice ruled on
here, reconciliation lands as dated amendments to this document, never as
silent rewrites.) 2026-08-01 (loop CONVERGED dual-family READY — Fable round 2,
Codex round 3, zero unresolved concerns; review artifacts
reviews/0100-membership-addressed-operations-and-pages.{fable,codex}.md.
Status advances Draft -> Review. Full acceptance honors this RFC's own
ratification boundary: LLP 0056 reaching Accepted, or an explicit
composed-parent ruling by the author — pending that, the converged text
is the stable review baseline.) 2026-08-01 (v0.4, applying the round-2 delta verdicts — Fable
READY, Codex NOT READY on two text-fixable residuals; both round-2
artifacts:
`llp/reviews/0100-membership-addressed-operations-and-pages.fable.md`
(Round 2 section) and
`llp/reviews/0100-membership-addressed-operations-and-pages.codex.md`
(Round 2 section), on target
`5261cce83b62a478f25b076205733fac12bd6971b6fce3c37ec1fbd255520dfd`.
Dispositions, verified against the tree at `6c68fe6c`:
**Codex 2 residual** (§8a resource contract) — pinned: `SearchRequestV1`
carries no resource argument (`{query, limit?, after?}`,
crates/snapback/src/search/types.rs:268–274), so the routed interface requires a
**required, equality-bound resource argument** on the generated
membership-visible search function, one singular
`membership:{declaration, resource-value}` partition per invocation —
canonical multi-seat traversal is explicitly rejected, with the reasons
recorded (§8a). The two post-revocation observables are now
distinguished and pinned: stale continuation → uniform custody refusal;
fresh search → empty result, byte-identical to outsider/nonexistent.
**Codex 3 residual** (§8b event semantics) — corrected: the receipted
reset carries LLP 0056's **event-3/declared-restore** incarnation
semantics (llp/0056 "reset/import carry event-3/declared-restore
incarnation semantics"; ordinary membership writes are event 1); the
"exactly like a kick" clause is withdrawn and no remaining text leans on
event 1 for the reset lane.
**Fable round-2 nits, all applied:** §5 artifact-identity binding stated
as invalidating on any artifact change, meaning-changing or not (the
accepted conservatism OQ3 owns); `validate_function_args` cited at its
home (crates/snapback/src/args_contract.rs, called from crates/snapback/src/local.rs); §8a cites the
asset lane's existing `membership` sharing kind (define.mjs:129) as
in-tree vocabulary precedent. No reviewer point rejected this round.)
2026-08-01 (v0.3, the verify-then-fix pass applying the merged
round-1 findings of the author-directed loop. Both round-1 artifacts:
`llp/reviews/0100-membership-addressed-operations-and-pages.fable.md`
(2026-08-01 section) and
`llp/reviews/0100-membership-addressed-operations-and-pages.codex.md`
(2026-08-01), both NOT READY on target
`4ba87d1dad15c956b0311adec57befe517e83c03c445ba4a458cdda70228b43b`.
Dispositions, each verified against the tree at `444eaeb9`:
**Codex 1 / Fable 3** (self-membership listing) — resolved outside this
RFC by `_snapback.myMemberships` (landed `67da515f`,
crates/snapback/src/local.rs `MY_MEMBERSHIPS_LIVE_FUNCTION`; LLP 0056 dated amendment
2026-08-01, which explicitly leaves this RFC's two surfaces here); §1's
stale baseline refreshed and cross-referenced. Fable 3's suggestion to
cite the projection in the §1 disclosure argument is **not adopted, with
evidence**: the projection returns only the caller's *own* rows (LLP 0056
amendment text), so it implies nothing about a removal target and cannot
strengthen that argument.
**Codex 2 / Fable 1** (membership-visible search) — routed with named
owner and interface, §8a: an LLP 0073 dated amendment adding a third
`SearchVisibilityV1` variant (crates/snapback/src/search/types.rs), obligations pinned.
**Codex 3 / Fable 2** (trusted membership seed/reset) — routed with named
owner and interface, §8b: the LLP 0109 × LLP 0056 lane admitting fixture
seats through the existing `MembershipWriter::Seed` carrier
(crates/snapback/src/storage.rs); §1's trusted-migration/import sentence reconciled with
the fact that the receipted lane refuses memberships today.
**Codex 4 / Fable 4** (cursor custody) — §5 restated as an explicit delta
over the current `standard_pattern_cursor_binding`
(crates/snapback/src/local.rs:21370–21415): inherited members and new members enumerated,
pair identity defined, and the implementation bridge mapping every new
member to its current-tree source added; §Acceptance gains the
per-component binding-mutation schedule including the cross-resource
resource-value negative.
**Codex 5** — callable-only shape decided: the helper emits ordinary
`Query` definitions, a stated delta from the owned helper's
`defineLiveQuery`+`defaultLive:false` emission (§4).
**Codex 6** — the composed membership-family witness added to
§Acceptance. **Fable 5** — §3 companion-write idempotence named a guide
obligation with an acceptance row. **Fable 6** — §4 positioned against
LLP 0110's `bounded_children_v1`; LLP 0110 joins Related. **Fable 7** —
LLP 0131 composition sentence in §7. **Fable 8** — the `lastHolder`
totality proof extended through LLP 0056's expired-but-authorized edge,
with an acceptance schedule. **Fable 9** — the `myMemberships` seat-drop
joins the product receipt. **Fable 10** — OQ1 decided: `removePrincipal`.
No other reviewer point rejected.)
2026-07-30 (v0.2, responding to the first cross-family review
(`llp/reviews/0100-membership-addressed-operations-and-pages.fable.md`):
Major 1 decided by the author — option (a), the non-disclosure claim is
scoped to the byte-level result and the authorization-version observable is
an accepted disclosure to authorized callers (§1/§3, with the no-op
branch's commit semantics now stated); Minor 1 resolved by citation
(LLP 0056 §Agents already classes delegated kicks as `authorityCreating`);
Minor 2 — nonexistent-but-well-formed principals stated explicitly (§3);
Minor 3 — the page-key idiom becomes a guide obligation and compound
boundaries join Open questions (§5); Minor 4 — adapter custody clearing
acknowledged as receipt-enforced convention (§6); plus the review's
composability and probe-negative suggestions (§2, §Acceptance).)
2026-07-26 (initial draft)
**Related:** LLP 0004, LLP 0007, LLP 0008, LLP 0037, LLP 0053, LLP 0055,
LLP 0056, LLP 0063, LLP 0065, LLP 0073, LLP 0109, LLP 0110, LLP 0131

## Summary

This RFC proposes two deliberately narrow extensions needed by the Team Chat
pressure app:

1. a declaration-bound `removePrincipal` membership command that lets an
   authorized resource role remove another principal without exposing the
   private membership row id or turning the command into a membership-existence
   read; and
2. a generated `membership-keyset-pages.v1` profile that pages one
   membership-protected resource through an opaque, authority-bound keyset
   cursor.

Both extensions preserve the existing boundaries rather than bypassing them.
The membership transition matrix remains the sole write authorizer. The
membership predicate remains the executable read authorizer. The cursor grants
no authority and is invalid after the caller's authorization epoch changes.
Membership rows remain unavailable to application reads.

The proposal is a child of LLP 0056 and LLP 0065 rather than an amendment that
silently broadens either parent. LLP 0056 explicitly leaves other-principal
addressing unavailable under the private v1 roster. LLP 0065 explicitly
requires membership-based pagination to receive its own profile and negative
acceptance cases.

Since v0.3 this RFC also records the **membership-composition family
boundary** the LLP 0137 sweep evidence demands: the two sibling
compositions this document does not design — membership-visible search
visibility and the trusted membership seed/reset lane — are routed to
named owners with their interfaces pinned (§8), not left silent. The
third sweep case, self-membership listing, is resolved outside this RFC
by `_snapback.myMemberships` (§1).

## Motivation

The local Team Chat checkpoint already proves atomic room bootstrap,
invitation, self-acceptance, self-leave, protected live history, bounded
recipient fan-out, unread state, and owner-scoped inbox pagination. Two missing
product operations are semantic gaps rather than application glue:

- a room owner cannot remove another member because the private roster exposes
  no membership row id; and
- the owner-only standard-pattern helper cannot page a room whose visibility is
  decided by membership rather than row ownership.

Using the displayable `roomParticipants` table as authority would make
revocation an application convention and violate LLP 0056. Returning private
membership ids would create the existence oracle that LLP 0056 deliberately
closed. Minting an application cursor from `roomId` and `pageKey` would omit the
application, plan, authority, epoch, deployment, and target bindings that make
LLP 0065's continuation safe.

## Governing constraints

This proposal inherits these constraints without weakening them:

- LLP 0053 owns authorization invalidation. Every committed membership write is
  an authorization event, negative live changes are obligation-backed, and a
  stale authorization witness cannot authorize delivery or discharge.
- LLP 0056 owns the closed membership declaration, transition matrix, writer
  carrier, private-roster posture, trusted denial, `lastHolder`, provenance,
  delegated-agent consent, and captured membership dependencies.
- LLP 0065 owns the fact-class boundary, closed standard-pattern declarations,
  deterministic generation, opaque cursor custody, conditional query profile
  admission, and default-deny runtime ceiling.
- LLP 0008 keeps membership-gated live queries on `live_replace`. The generated
  historical-page profile here is callable-only; neither extension admits
  incremental semi-join deltas or retained/offline results.
- LLP 0037 keeps Rust-owned manifests and generated artifacts authoritative.

## Design

### 1. Private-roster posture remains closed

This RFC adds no membership read, list, lookup, row-id, or application-visible
existence result.

`ctx.permissions` remains the only imperative membership check and returns no
membership fact. On the query side the baseline has two surfaces *(refreshed
2026-08-01 — the tree moved under v0.2)*: the declarative `memberOf` /
`hasRole` predicates, and the reserved, declaration-owned self-projection
`_snapback.myMemberships` (landed 2026-08-01, `67da515f`;
`MY_MEMBERSHIPS_LIVE_FUNCTION`, crates/snapback/src/local.rs; recorded by LLP 0056's dated
amendment of the same date). The projection returns only the **caller's
own** seats — `{id, resource, role, sinceMs}` — and discloses nothing about
any other principal, not even existence, so the private-roster posture holds
by construction. It resolves the 0137 A2 "list the caller's resources" case
outside this RFC, and the 0056 amendment explicitly leaves this RFC's two
surfaces to this RFC; this document adds no further read.

The existing id-addressed membership methods remain trusted
migration/import mechanisms, not an ordinary application path. One honest
qualification *(v0.3)*: the receipted trusted-import lane an application
actually has — the LLP 0109 versioned seed — refuses membership rows
outright today (`SNAPBACK_SEED_MEMBERSHIP_BOOTSTRAP_UNSUPPORTED`,
crates/snapback/src/storage.rs `validate_versioned_seed_request`), so "trusted
migration/import" currently names only the unreceipted id-addressed
methods. Closing that gap is the routed seed/reset lane of §8b, owned by
LLP 0109 × LLP 0056, not by this RFC.

The two new surfaces disclose only:

- the caller-known fact that a principal-addressed command targeted the caller
  themself, which is a typed misuse; and
- the ordinary success or authorization refusal of a declared write command.

The successful `removePrincipal` result is always `null`, whether it removed an
existing row or proved the target pair absent. It never returns `removed`,
`missing`, a previous role, a row id, or an affected-row count.

The byte-level public result is the claim, and it is deliberately scoped
*(decided 2026-07-30, resolving the first review's Major 1 as its option
(a))*: a present-target removal is a committed membership write and
therefore advances the authorization version (LLP 0056 event 1), while the
absent-target no-op commits no membership write and advances nothing. An
**authorized** caller can distinguish the two through any
authorization-epoch-bound observable — most directly, whether a previously
minted cursor still verifies. This is an accepted disclosure to callers the
transition matrix already authorizes to remove *every* role: it tells such
a caller nothing their own display roster and removal authority do not
already imply, and it never leaks to unauthorized callers, who are refused
before target lookup. The alternative — advancing the epoch on the no-op
too — was rejected because it turns absent-target probe spam into a global
cursor-invalidation amplifier. As in LLP 0056's private lookup, exact
timing indistinguishability is best-effort rather than guaranteed.
Applications may expose a display roster through ordinary app data and its
own visibility rules; observing that product state does not turn this host
command into a general membership read.

### 2. Opting into principal-addressed removal

A declaration opts in explicitly:

```js
.membership({
  // existing fields...
  principalAddressedWrites: { remove: true },
  transitions: [
    // Omitted `from` means every declared and pending role.
    { op: 'remove', by: ['owner'], target: 'other' },
  ],
})
```

The object is closed. V1 admits only `remove: true`; false, unknown operations,
and unknown fields fail artifact generation. No principal-addressed
`setRole`, `patch`, or read is implied.

Activation admits the option only when at least one transition is a **total
other-principal removal transition**:

- `op` is `remove`;
- `target` is `other`;
- `by` names one or more full, non-pending declaration roles;
- `from` is omitted, so the transition covers every declared and pending target
  role; and
- `to` and `fields` are absent by the existing remove grammar.

This totality is load-bearing. An authorized caller must not learn that a
target occupies one hidden role because removal succeeds for `member` but
refuses for `owner`. Once the caller class is admitted, every existing other
row is removable under the transition matrix and an absent row is an
idempotent success.

The totality requirement constrains only activation: the declaration must
carry **at least one** total other-principal removal transition for the
option to generate. Other remove transitions — partial self-serve removes,
`self` leaves — coexist unchanged; they are simply not principal-addressed
carriers.

If the declaration carries `lastHolder`, every caller role admitted by a
principal-addressed removal transition must be the protected role. Therefore a
caller able to remove another protected holder is itself an eligible protected
holder, and removing the target cannot empty the protected set. The ordinary
commit-stage `lastHolder` check still runs; this restriction prevents its
result from becoming a hidden-role oracle on the new surface.

The proof holds through LLP 0056's expiry edge *(v0.3, recording the
verified argument)*: 0056's expiry sweep skips a protected final holder —
protection wins over expiry, and the row stays live,
**expired-but-authorized**, until the app seats a replacement. An
expired-but-authorized caller therefore still occupies the protected set,
so removing the target still cannot empty it; and a caller whose expired
row was actually swept (a non-final holder) no longer resolves to any
role and is refused at step 3 of §3, before target lookup, like any other
unauthorized caller. §Acceptance schedules this edge explicitly.

Codegen emits:

```ts
// resource-scoped declaration
removePrincipal(resource: Id<'rooms'>, principal: Principal): Promise<null>

// app-scoped declaration
removePrincipal(principal: Principal): Promise<null>
```

only when the option is present and valid.

### 3. Host resolution and linearization

The host receives declaration id, resource (when scoped), and target principal.
Application code supplies no membership id, role, caller class, or writer
authority.

The host performs one snapshot-bound command:

1. validate the nominal resource and principal argument shapes;
2. resolve the effective caller and their role for the exact declaration and
   resource;
3. refuse a caller whose role matches no total other-principal removal
   transition with the existing invariant public role denial;
4. refuse `targetPrincipal == effectivePrincipal` with
   `SNAPBACK_MEMBERSHIP_TARGET_SELF` before target lookup — self-removal remains
   `removeSelf`;
5. resolve the unique `(targetPrincipal, resource)` membership row entirely
   inside the host;
6. if present, feed its id into the unchanged target-row removal planner; if
   absent, plan an idempotent no-op; and
7. commit the removal, authorization-version advance, full-provenance
   transition record, and every companion application write in the mutation
   atomically.

Both present and absent target lookups are captured. A concurrent insert,
remove, or role change invalidates the command's read set before companion
writes can commit against a stale result. The no-op linearizes at its captured
snapshot; an insert that commits later is a later operation, while an insert
that wins first invalidates and retries/refuses the stale mutation.

The no-op branch's commit is exact: it commits the captured absence
dependency and the mutation's companion application writes (the application
cannot observe which branch ran, so companion writes must be written to be
correct in both — the same idempotence the identical `null` result already
demands), performs no membership write, records no transition (the
provenance stream records transitions, and none occurred), and advances no
authorization version — the §1-scoped disclosure. The both-branches
companion-write contract is a real application-correctness trap — a
companion write that decrements a member count or appends a "removed" feed
event on the assumption the target was present corrupts product state on
the absent-target no-op — so it is a **guide obligation** with the same
standing §5 gives the page-key idiom (LLP 0061): the command's guide page
documents the branch-insensitive companion-write pattern the day the
command lands, and §Acceptance carries its row. A **well-formed principal
that names no user at all** takes exactly this branch: argument validation
is shape-only and consults no user table, so the removal surface cannot
become a user-directory existence probe.

The command uses the existing closed `MembershipWriter` carrier. It is an
authority-creating membership operation for delegated-agent consent purposes
— not an extension of the parent's taxonomy but a direct application of it:
LLP 0056 §Agents already classes delegated role-management writes, kicks
included, under LLP 0055's `authorityCreating` marker ("every seat,
downgrade, and kick the delegate performs stays attributable"). The
containing function therefore requires `authorityCreating: true`, an
explicit consented grant, and `provenance: "full"`. A delegated request
that lacks that consent fails before the handler or target lookup runs.

### 4. Membership-scoped keyset pages

The generated helper is explicit:

```js
const { firstRoomMessagePage, nextRoomMessagePage } =
  defineMembershipKeysetPages({
    table: schema.tables.messages,
    names: {
      first: 'firstRoomMessagePage',
      next: 'nextRoomMessagePage',
    },
    membership: {
      declaration: roomMembers,
      resourceArg: 'roomId',
      resourceField: 'roomId',
      roles: ['owner', 'member'],
    },
    index: 'by_room_page_key',
    cursorField: 'pageKey',
    limit: 50,
  });
```

Its stable facts are:

- helper: `membership-keyset-pages.v1`;
- profile: `membership.v1`;
- callable: true;
- live: false;
- `live_delta`: false;
- retained/offline: false; and
- authority-independent: false.

`live: false` is an emission decision, not just a capability fact *(decided
v0.3)*: the helper emits ordinary **`Query`** definitions that cannot be
subscribed at all. This is a deliberate delta from the owned helper's
current emission — `defineOwnedKeysetPages` builds its pair through
`defineLiveQuery` with `defaultLive: false`
(packages/snapback-codegen/standard-patterns.mjs), leaving them
subscription-capable — because a subscribable historical page here would be
exactly the per-visited-page authorization-sensitive subscription this
section rules out below. The capability claim is consistent: callable-only,
no `live_replace`, no `live_delta`.

Every option object is closed. The declaration must be resource-scoped. The
resource argument and row field must carry the exact nominal resource type
owned by the membership declaration. `roles` is a non-empty canonical subset
of the declaration's full roles; pending roles are rejected in v1. Omission,
an unresolved declaration, cross-table nominal mismatch, or a membership table
used as the page table fails generation.

The helper emits two authenticated declarative queries. Both execute:

- `resourceField == arg(resourceArg)`; and
- the declaration-bound `hasRole(arg(resourceArg), ...roles)` predicate.

The membership predicate is executable authority, not metadata. Initial
non-members receive an empty first page with no cursor, revealing neither room
nor membership existence. A later grant is observed by a fresh first-page
invocation. The product's separate current-room `live_replace` query owns live
grant/revocation updates; historical pages do not create one authorization-
sensitive subscription per visited page.

This profile is not LLP 0110's `bounded_children_v1`, and the two compose
rather than compete *(v0.3, positioning)*. The bounded-children profile is
a **live-oriented**, parent-visibility-shaped surface: one visible parent
row authorizes a bounded, index-ordered child page whose delivery rides the
live machinery under protected relation incarnations. This helper is a
**callable keyset continuation**: visibility is a membership seat rather
than parent-row visibility, traversal is caller-driven through an opaque
custody-bound cursor rather than a delivered window, and nothing here is
subscribable. A board-shaped product uses both — `bounded_children_v1` (or
the current-room `live_replace` query) for the live window, this helper for
bounded historical traversal — under the same membership declaration.
LLP 0110 joins Related for this boundary.

### 5. Index and continuation contract

The page index must be unique with exact fields
`[resourceField, cursorField]`, in that order. The cursor field is required,
non-null, and different from the resource field. Direction is exactly `asc` or
`desc`; limit is a safe integer from 1 through 1,024. The strict next-page
comparison uses the exact unique boundary, so no offset or synthesized
tie-break is hidden.

The single-column cursor is a real authoring constraint: chat-shaped tables
that would naturally page on `(createdAt, id)` must instead maintain a
per-resource unique page key. That idiom is a **guide obligation** — the
helper's guide page documents the page-key pattern the day the helper lands
(LLP 0061), not as an afterthought; compound boundaries are open question 4.

The helper reuses the existing `sbpc1` MAC envelope and keyring. A new crypto
family is unnecessary because the binding digest already distinguishes helper
and profile. The opaque body carries only app, binding digest, boundary, and
issue time; it does not expose resource, principal, role, or plan arguments.
It inherits the standard cursor's 1,024-byte wire maximum and 30-day maximum
age; current authorization and membership are still checked on every
presentation, so the age is a staleness backstop rather than an authorization
lease.

The binding digest for this profile **extends** the existing
standard-pattern custody contract; it does not merely match it *(restated
v0.3 — the v0.2 phrasing overstated the current binding)*. What exists
today is `standard_pattern_cursor_binding` (crates/snapback/src/local.rs:21370–21415),
whose digest covers: app id, helper id, profile id, table, exact index,
order, limit, the serialized shared filter **shapes** (with symbolic
`Arg` references, not argument values), the caller authority fingerprint,
and the caller's per-user permission-scope epoch. Deployment/database
generation is bound by **custody**, not digest: the `sbpc1` envelope is
MACed under the instance keyring, so a cursor cannot cross instances. The
runtime's profile registry currently admits only `owned-keyset-pages.v1`
(crates/snapback/src/local.rs:21331).

**Inherited members** (already in the digest or custody today): app
authority domain; helper and profile ids; table, exact index, order,
direction, limit, cursor field, and serialized shared plan shapes; caller
authority fingerprint; consumed per-user permission-scope epochs;
instance keyring custody.

**New members this profile requires.** The first is load-bearing here in a
way it is not for the owner profile — the owner partition rides the auth
fingerprint, while the membership partition rides argument values — and
the rest close staleness classes §5 claims that the current digest does
not deliver:

- **normalized non-cursor argument values, including the exact resource
  id.** Without the concrete resource value in the digest, a cursor minted
  for room A verifies for room B: the shared filter shape
  `resourceField == arg(resourceArg)` is identical for every room. Source:
  the LLP 0131-validated `input.args`, normalized over the declared
  argument order, after ingress validation (`validate_function_args`,
  crates/snapback/src/args_contract.rs, called from crates/snapback/src/local.rs).
- **the membership declaration stable id, resource field/argument, and
  canonical role set** (generation-time facts carried on the standard
  pattern).
- **the current global authorization pair `{incarnation, epoch}`.** The
  per-user permission-scope epochs bound today are explicitly *not* this:
  they are the legacy compatibility resync map, while LLP 0053's durable
  global `AuthorizationVersion` advances in the storage transaction hook
  (crates/snapback/src/local.rs:11035–11038; `AuthorizationVersion`, crates/snapback/src/storage.rs:272,
  read via the auth-stream snapshot readers). Membership writes advance
  the global pair, so stale-membership refusal requires binding it.
- **the data-version stream** (`strict_current_data_version_stream`,
  crates/snapback/src/seed_identity.rs; rotated by reset — crates/snapback/src/storage.rs), so a cursor
  cannot survive a receipted reset-install even if epochs coincide.
- **exact active function/schema artifact identity and target profile**
  (the instance's loaded schema hash and function publication generation),
  so a cursor cannot survive **any** artifact change — meaning-changing
  or not; a meaning-preserving regeneration also invalidates, an accepted
  conservatism under the same posture OQ3 owns.

**Pair identity is the digest, not the names**: the generated first/next
functions share one binding because the strict boundary filter — cursor
field, `Gt`/`Lt`, `Arg` value — is excluded from the shared-plan member
(exactly the exclusion the current binding already implements), and every
other member above is identical for the pair. Any other difference between
first and next changes the binding; first/next interchangeability is
precisely this exclusion and nothing more.

**Implementation bridge** *(v0.3, closing the gap between §5's guarantees
and implementation-order step 4)* — following the old step 4 literally
would not have established the stale-membership or artifact-identity
guarantees. The generalization must:

1. admit `membership-keyset-pages.v1` in the profile registry
   (crates/snapback/src/local.rs:21331 today refuses everything but the owned helper);
2. extend the binding-digest builder with the five new-member groups above,
   each read from the seams named there (validated args; standard-pattern
   membership facts; the durable `AuthorizationVersion` snapshot — not the
   permission-epoch map; the current data-version stream; the active
   artifact identity); and
3. keep the envelope, keyring custody, and the uniform
   `SNAPBACK_STANDARD_PATTERN_CURSOR_INVALID` refusal byte-identical.

§Acceptance mutates each binding component independently and requires the
uniform refusal before candidate-row evaluation.

The server verifies size, shape, key id, MAC, age, app, binding, boundary type,
current authority, global authorization pair, and every consumed scoped
permission epoch **before candidate-row evaluation**. Every malformed,
raw-boundary, cross-pair, cross-resource, cross-principal, cross-app,
cross-instance, expired, or stale-authorization presentation returns the
byte-identical existing
`SNAPBACK_STANDARD_PATTERN_CURSOR_INVALID`. It never repositions.

Every committed membership write is LLP 0056 event 1, so it advances the
authorization version consumed by the cursor binding. V1 deliberately accepts
the conservative cost: any such change may invalidate more cursors than
strictly necessary. In particular, a member removed after page one cannot use
the old continuation, and rejoining does not revive it.

As with `owned-keyset-pages.v1`, a full page must carry a continuation. Cursor
mint failure fails the page with
`SNAPBACK_STANDARD_PATTERN_CURSOR_MINT_UNAVAILABLE`; it cannot silently report
a full page as terminal.

The consistency claim is unchanged from LLP 0065: rows untouched by concurrent
mutations are neither duplicated nor skipped. A row whose cursor field changes
concurrently may move relative to the boundary. This profile makes no stable
historical-snapshot claim across requests.

### 6. Invalidation and custody

Each page invocation evaluates the membership witness and data rows in one
pinned snapshot. Its read summary contains the page table, exact index range,
membership declaration, membership point/range dependency (including
absence), and authorization dependence.

Historical pages are callable-only and therefore create no live delivery
state. Removal advances the authorization version and invalidates a historical
continuation before any next-page candidate is read. The separate protected
current-room query stays on conservative, obligation-backed `live_replace`;
it quarantines/blanks the room boundary on removal. Product adapters must clear
caller-owned accumulated page rows at that same authorization cut rather than
retaining them as an ungoverned cache — a convention on application custody
the host cannot enforce, stated with the same honesty §1 applies to timing:
the product receipt is its only witness.

Neither principal-addressed removal nor membership pages admit offline
retention. A later retained profile requires the LLP 0053 lease, exact
membership resource dependency, expiry floor, and its own convergence
acceptance; this RFC does not pre-authorize it.

### 7. Artifact and capability changes

The Rust-owned manifest gains:

- the closed `principalAddressedWrites` membership declaration;
- the generated membership method fact;
- `membership-keyset-pages.v1` / `membership.v1`;
- exact first/next argument and result schemas; and
- a conservative `EffectCeilingV1` that includes membership lookup,
  authorization dependence, indexed page read, and cursor verification/mint.

Unknown helper/profile ids, missing ceiling members, unsupported targets, and
future plan nodes fail generation or admission. The local target is the only
positive v1 adapter. Hosted, Cloudflare, retained, and incremental capability
facts remain explicit gaps.

The "exact first/next argument and result schemas" line now comes largely
for free *(v0.3)*: LLP 0131 (Accepted) makes every v2-generated function
carry a `FunctionArgsContractV1` descriptor under the app-wide
`args_contract_v1` requirement, and `resourceArg` (an id) plus the
optional cursor argument are directly expressible in that descriptor
vocabulary. The generated pair and any function containing
`removePrincipal` ride that lane; this RFC adds no bespoke argument-schema
machinery, and §5's normalized-argument binding member reads the same
validated ingress.

### 8. The membership-composition family: routed sibling surfaces

The LLP 0137 sweep made the membership-composition *family* the unit of
evidence. Two ticketed cases sit in this family but are deliberately not
designed here; per this loop's bar each is **routed with a named owner and
a named interface**, so narrowness is a decision rather than an accident
of drafting date. In both cases the fail-closed status quo is verified:
nothing partial can ship while the owner works.

**8a. Membership-visible search visibility — owner: LLP 0073 (dated
amendment).** Today's search visibility union is closed to exactly
`public-read` and `owner` (`SearchVisibilityV1`, crates/snapback/src/search/types.rs;
enforced again at authoring time in
packages/snapback-codegen/define.mjs), so the ticketed org-wide
member-visible search
(`issues/20260801-0137-a3-search-visibility-cannot-express-membership.md`)
is inexpressible and fails generation — fail-closed, never approximated.
The owning change is a third pushdown-compilable visibility variant in
LLP 0073's own contract, which already carries the visibility-partition
shape in its identity: `{ kind: 'membership', declaration, resourceField,
roles }`, partitioned by the caller's seat rather than `owner:{subject}`.
The variant name has in-tree family precedent: the asset lane's sharing
vocabulary already carries a `membership` kind (`ASSET_SHARING_KINDS`,
packages/snapback-codegen/define.mjs:129).

**How the resource is supplied is pinned, not left to the owner**
*(v0.4, closing the round-2 residual)*. The wire request shape carries no
resource today — `SearchRequestV1` is exactly `{query, limit?, after?}`
(crates/snapback/src/search/types.rs:268–274) — while the variant names only a
`resourceField` on indexed rows. The routed interface therefore requires
a **required, equality-bound resource argument on the generated
membership-visible search function**, exactly §4's `resourceArg` shape:
every invocation addresses one singular
`membership:{declaration, resource-value}` partition, and the argument
value joins the search continuation's identity the same way §5 binds the
page cursor's resource value. Whether LLP 0073 carries the value as a new
generated-function argument beside `SearchRequestV1` or extends the
request shape is the owner's wire decision; the singular-partition
contract is not. **Canonical multi-seat partition traversal is explicitly
rejected** for this variant, for the RFC's own reasons: §4/§5's partition
model is one resource value per invocation (the cursor binds the concrete
value; the outsider/nonexistent negative is defined per resource); a
seat-union search would reintroduce resource enumeration through a side
door (listing the caller's resources is `_snapback.myMemberships`' job,
§1); and cross-resource ranking would force one score ordering across
partitions LLP 0073 deliberately keeps independent. A caller searching
several rooms iterates its own seats and issues per-resource searches.

**Two post-revocation observables, both pinned** *(v0.4)*: presenting a
**stale continuation** minted before the revocation fails the custody
binding — the uniform invalid-continuation refusal, byte-identical across
causes, refused before candidate evaluation (the §5 contract carried into
0073's continuation); a **fresh search** after revocation is *not* a
refusal — it succeeds with the empty result, byte-identical to the
outsider and nonexistent-resource results. These are different
observables with different meanings: the first is the epoch-bound
observable §1 already scopes as an accepted disclosure, the second is the
non-disclosing steady state.

The remaining interface obligations this RFC pins for that amendment, in
its own vocabulary: the declaration-bound seat resolution and the
posting/source-row recheck execute in one snapshot; an outsider's result
is empty and byte-identical to the nonexistent-resource result;
revocation zeroes the next search; and member/outsider/revoked acceptance
cases are mandatory — including one row per observable above. What this
RFC contributes is the semantic vocabulary — the membership predicate as
executable visibility authority — and the custody delta of §5; the
search-side carrier, posting pipeline, and scoring surface belong to
LLP 0073. Deferral is safe because the union is closed: no membership
search behavior can exist until the amendment lands whole.

**8b. Trusted membership seed/reset — owner: LLP 0109 (dated amendment),
composed with LLP 0056.** Today the sessions-mode versioned seed refuses
any artifact that names a membership table
(`SNAPBACK_SEED_MEMBERSHIP_BOOTSTRAP_UNSUPPORTED`,
`validate_versioned_seed_request`, crates/snapback/src/storage.rs), so a receipted reset
restores app data while every runtime seat survives — reset cannot retire
authority
(`issues/20260801-0137-a3-membership-not-seedable-cleanup-cannot-retire-authority.md`).
The carrier already exists: LLP 0056's
closed writer enumeration includes `MembershipWriter::Seed` and
`MembershipWriter::Import` (crates/snapback/src/storage.rs), currently unreachable from
the receipted lane. The interface obligations this RFC pins for the 0109
amendment: fixture seats are admitted only through `MembershipWriter::Seed`
under full declaration validation (principal identity shape, declared role
vocabulary, nominal resource type, `lastHolder` and final-state validation
in the declaration's own order); named membership tables become legal
reset targets; reset deletes runtime seats and restores fixture seats
atomically in one receipted operation carrying LLP 0056's
**event-3/declared-restore** incarnation semantics *(corrected v0.4 —
0056's taxonomy is explicit: "reset/import carry event-3/declared-restore
incarnation semantics"; event 1 is the ordinary per-write membership
path, and a bulk restore is deliberately not a stream of kicks)*;
replay/idempotence follows LLP 0109's existing receipt discipline; and
the mandatory witness is the ticket's own: a runtime-only principal
provably loses authority after reset while fixture seats survive — the
authority cut delivered by the declared-restore incarnation advance, and
every §5-bound cursor and stale witness refused across it. §1's
trusted-migration/import sentence is reconciled above: the receipted
trusted lane refusing memberships is a named gap with this named owner,
not an implied capability.

Neither routing is a scope change to this RFC's two designed surfaces;
both compose with them through the same declaration, and the composed
family witness in §Acceptance names the join points.

## Team Chat adoption

After semantic acceptance and implementation conformance:

- `roomMembers` opts into `principalAddressedWrites.remove`;
- its owner transition becomes total for other principals:
  `{ op: 'remove', by: ['owner'], target: 'other' }`;
- an `ownerRemoveMember` mutation calls
  `ctx.membership.roomMembers.removePrincipal(roomId, targetPrincipal)` and
  updates only display/delivery app data in the same mutation;
- `roomMessages` remains the live current-room view; and
- `firstRoomMessagePage` / `nextRoomMessagePage` provide bounded historical
  callable traversal over `by_room_page_key`.

The headless, React, and Contract product receipts now exercise both paths on
`local-dev-sqlite-ibex`, and the two pressure rows are `implemented-local`.
The overall ledger remains red: this RFC does not promote `STEP6.CHAT`, accept
LLPs 0071–0073, or claim hosted completeness.

## Acceptance

### Principal-addressed removal

- Generation refuses omission, unknown option fields, pending/`none` caller
  classes, partial `from` coverage, and a caller class inconsistent with
  `lastHolder`.
- An owner removes an active member without receiving a row id, role,
  existence bit, or count; removing the now-absent pair again returns the exact
  same `null`.
- The absent-target no-op advances no authorization version and the
  present-target removal does — the §1 scoped disclosure is exactly this
  observable and nothing else (asserted via cursor validity across each
  branch).
- A non-owner and cross-resource owner receive the invariant role denial before
  target lookup.
- A self target receives `SNAPBACK_MEMBERSHIP_TARGET_SELF` and must use
  `removeSelf`.
- A malformed principal fails argument validation without a membership probe.
- A delegated agent without explicit authority-creating consent fails before
  handler execution; an explicitly consented delegate records actor,
  effective principal, grant, and operation in full provenance.
- Removal, provenance, authorization-version advance, display-state change,
  and delivery purge commit atomically.
- Present-row, absent-row, concurrent insert, concurrent role change,
  concurrent self-leave, and replay schedules prove the captured point/range
  dependency and writer carrier.
- The expired-but-authorized edge (LLP 0056's sweep-skipped protected final
  holder) is scheduled explicitly: such a caller invokes `removePrincipal`
  against a present member and an absent pair; both admit under the
  caller's still-live role with uniform results, the protected set never
  empties, and a caller whose expired non-final row was actually swept
  receives the invariant role denial before target lookup.
- Companion application writes are branch-insensitive (the §3 guide
  obligation): the same mutation run against a present target and an
  absent target leaves companion product state consistent — no member
  count, feed event, or display row diverges by branch beyond what the
  membership write itself changes.
- Protected live queries and rooms blank/quarantine before forbidden delivery;
  stale callbacks, queued writes, retained rows, and old cursors cannot cross
  the authority generation.

### Membership-scoped pages

- Generation refuses missing visibility, pending roles, mismatched nominal
  resource types, non-unique or non-exact indexes, optional cursors,
  unbounded/invalid limits, unknown options, and authority-bearing page tables.
- A member traverses at least three pages without overlap; the pure evaluator
  and SQLite return byte-identical order for a duplicate-natural-sort fixture
  using unique generated page keys.
- A non-member's first page is empty with no cursor and reveals no resource or
  membership existence; the probe-shaped negative is explicit — a first page
  for a **nonexistent** resource id and for an **existing room the caller has
  not joined** are byte-identical.
- Malformed, raw-boundary, cross-pair, cross-room, cross-principal, cross-app,
  cross-instance, expired, and post-membership-change cursors return one
  byte-identical invalid-cursor response.
- The §5 binding is proven component-wise: a schedule mutates each binding
  member independently — resource-id argument value, another non-cursor
  argument value, declaration stable id, role set, authority fingerprint,
  global authorization pair, data-version stream (via reset), artifact
  identity (via regenerate-and-swap), helper/profile id — and every
  mutation yields the uniform refusal **before candidate-row evaluation**.
  The cross-resource case is explicit: because the shared filter shape is
  identical for every resource, only the bound resource **value** refuses
  a room-A cursor presented for room B; an implementation that omits the
  value from the digest fails this row.
- Removal between page one and page two invalidates the cursor before
  candidate-row evaluation; rejoin does not revive it.
- A first page before membership is empty; a fresh first page after grant
  returns authorized history. The separate current-room query proves
  hidden-to-visible and visible-to-hidden obligation-backed `live_replace`,
  never `live_delta` or swallowed `NoChange`.
- A full page always carries a continuation or fails minting; a short page has
  none.
- The capability artifact reports local callable-only pages, with hosted,
  live-page, retained, and incremental gaps.

### Product receipt

The Team Chat headless, React, and Contract suites must each prove:

1. owner removal from product UI;
2. immediate loss of protected room/history/send authority;
3. no delivery after the removal boundary and no accumulated historical page
   rows surviving in product custody;
4. the removed member's `_snapback.myMemberships` subscription drops the
   seat at the same authorization cut that blanks the room — the third
   witness beside room-blank and cursor-refusal (LLP 0056's machinery;
   asserted here as product-visible coherence of one cut);
5. three-page room-history traversal by a member;
6. cross-user/cross-room/stale cursor refusal; and
7. no regression to invitation, self-accept, self-leave, fan-out, or unread
   state.

The receipt records the Snapback revision, generated artifact hashes, target
profile, exact pressure-profile row, and all refusal codes. It is a local
semantic witness only and cannot by itself promote `STEP6.CHAT`.

### Composed family witness

Beyond the per-surface suites, one **composed acceptance witness** (the
LLP 0137 §P1 shape) proves that a single membership declaration — one
`roomMembers`-class declaration, no authorization mirrors anywhere —
drives, in one scenario run:

1. self-listing through `_snapback.myMemberships` (seat appears on grant,
   drops at the removal cut);
2. the protected live room (`live_replace` blank/quarantine at the cut);
3. membership keyset pages (traversal while seated; uniform cursor refusal
   after the cut; rejoin does not revive);
4. principal-addressed removal (the cut's cause, with provenance and the
   §1-scoped disclosure asserted); and
5. the two routed surfaces at their join points **once their owners land**:
   membership-visible search returns results while seated and zero after
   the cut (LLP 0073 amendment), and a receipted reset retires the
   runtime seat while fixture seats survive (LLP 0109 amendment). Until
   those land, the witness records the fail-closed refusals
   (generation-time visibility refusal; seed-lane refusal) as the honest
   placeholder rows rather than skipping silently.

The witness is one scenario, not five isolated suites: the same
declaration, the same principals, one authorization timeline.

## Implementation order

1. Accept this RFC through the LLP 0005 review and maintainer-ratification
   boundary.
2. Add the closed manifest facts and generation negatives.
3. Land `removePrincipal` host command, captures, writer-carrier propagation,
   provenance, invalidation, and adversarial storage/runtime tests.
4. Generalize the existing standard-pattern cursor binding per §5's
   implementation bridge: admit the new profile in the registry, add the
   five new binding-member groups from their named seams (validated
   argument values, declaration facts, durable global
   `AuthorizationVersion`, data-version stream, artifact identity), and
   retain the same envelope and byte-identical uniform refusal.
5. Add the generated helper, runtime ceiling, pure/SQLite/cursor/invalidation
   conformance suite, and guide updates.
6. Adopt both surfaces in Team Chat, regenerate artifacts, update its diary and
   pressure ledger, and run headless plus complete React/Contract receipts.
7. Keep the Step 6 claim red until every independent prerequisite named by LLP
   0063 is accepted and every target-specific witness is green.

## Open questions

1. *Decided (2026-08-01, v0.3, per both round-1 reviews endorsing the
   draft's own rationale):* the command is `removePrincipal`. The argument
   is the public address, while `target: "other"` remains a host-derived
   policy fact; `removeOther` would name the policy, not the argument.
2. Should a later profile admit principal-addressed role change? It needs a
   non-oracular total transition analogous to this RFC; v1 deliberately does
   not.
3. Is the conservative global authorization-epoch cursor invalidation cost
   acceptable until LLP 0053 declaration/subject narrowing graduates? This
   draft says yes for correctness and instrumentation simplicity. *(The same
   conservatism is what makes the §1 scoped disclosure legible; the two were
   decided together on 2026-07-30.)*
4. Should a later version admit a compound cursor boundary
   (e.g. `[resourceField, sortField, tieBreakField]`) so chat-shaped tables
   can page on `(createdAt, id)` without a synthesized page key? V1
   deliberately inherits the single-column contract from
   `owned-keyset-pages.v1`; the guide owns the page-key idiom until this is
   decided.

## Status and ratification boundary

**Accepted (2026-08-01), by the explicit composed-parent ruling this
section defines below** — the author's ballot, verbatim: "ruling: accept",
ratifying the composed LLP 0056 parent slice and this RFC together ahead
of LLP 0056's own acceptance. The paragraphs below are retained as the
boundary that ruling satisfied. (Original at authoring time: Draft; the
converged review loop advanced it to Review on 2026-08-01, same day.)

LLP 0056 itself remains in `Review`. Accepting this child cannot silently
accept or amend its parent. Implementation requires LLP 0056 to be accepted, or
an explicit maintainer ruling that ratifies the exact composed parent slice and
this RFC together.

Assuming LLP 0056 has first reached `Accepted`, the suggested maintainer
statement after independent review and reconciliation is:

> I ratify Snapback LLP 0100, Membership-addressed operations and pages,
> dated 2026-07-26, and authorize its local-target implementation with every
> LLP 0063 Step 6 claim preserved red until its independent prerequisites and
> executable product receipts are green.
