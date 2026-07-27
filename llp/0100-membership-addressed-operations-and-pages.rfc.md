# LLP 0100: Membership-addressed operations and pages

**Type:** RFC
**Status:** Draft
**Systems:** Memberships, Authorization, Query planning, Pagination, Code generation, Live Queries, Diagnostics, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-26
**Revised:** 2026-07-26
**Related:** LLP 0004, LLP 0007, LLP 0008, LLP 0037, LLP 0053, LLP 0055, LLP 0056, LLP 0063, LLP 0065

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
membership fact. Declarative `memberOf` / `hasRole` predicates remain the only
query-side membership surface. The existing id-addressed membership methods
remain trusted migration/import mechanisms, not an ordinary application path.

The two new surfaces disclose only:

- the caller-known fact that a principal-addressed command targeted the caller
  themself, which is a typed misuse; and
- the ordinary success or authorization refusal of a declared write command.

The successful `removePrincipal` result is always `null`, whether it removed an
existing row or proved the target pair absent. It never returns `removed`,
`missing`, a previous role, a row id, or an affected-row count.

The byte-level public result is the claim. As in LLP 0056's private lookup,
exact timing indistinguishability is best-effort rather than guaranteed.
Applications may expose a display roster through ordinary app data and its own
visibility rules; observing that product state does not turn this host command
into a general membership read.

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

If the declaration carries `lastHolder`, every caller role admitted by a
principal-addressed removal transition must be the protected role. Therefore a
caller able to remove another protected holder is itself an eligible protected
holder, and removing the target cannot empty the protected set. The ordinary
commit-stage `lastHolder` check still runs; this restriction prevents its
result from becoming a hidden-role oracle on the new surface.

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

The command uses the existing closed `MembershipWriter` carrier. It is an
authority-creating membership operation for delegated-agent consent purposes:
the containing function requires `authorityCreating: true`, an explicit
consented grant, and `provenance: "full"`. A delegated request that lacks that
consent fails before the handler or target lookup runs.

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

### 5. Index and continuation contract

The page index must be unique with exact fields
`[resourceField, cursorField]`, in that order. The cursor field is required,
non-null, and different from the resource field. Direction is exactly `asc` or
`desc`; limit is a safe integer from 1 through 1,024. The strict next-page
comparison uses the exact unique boundary, so no offset or synthesized
tie-break is hidden.

The helper reuses the existing `sbpc1` MAC envelope and keyring. A new crypto
family is unnecessary because the binding digest already distinguishes helper
and profile. The opaque body carries only app, binding digest, boundary, and
issue time; it does not expose resource, principal, role, or plan arguments.
It inherits the standard cursor's 1,024-byte wire maximum and 30-day maximum
age; current authorization and membership are still checked on every
presentation, so the age is a staleness backstop rather than an authorization
lease.

For this profile the binding digest covers:

- application authority domain;
- the first/next pair identity;
- helper and profile ids;
- table, exact index, order, direction, limit, cursor field, and serialized
  shared plan;
- normalized non-cursor arguments, including the exact resource id;
- membership declaration stable id, resource field/argument, and role set;
- caller authority fingerprint;
- current global authorization pair `{incarnation, epoch}` and data version
  stream, plus every declared scoped permission epoch the plan consumes;
- exact active function/schema artifact identity and target profile; and
- deployment/database generation through the instance MAC keyring, matching the
  existing standard-pattern cursor custody contract.

The first and next definitions differ only by the strict boundary filter, which
is excluded from the shared pair digest. Any other difference changes the
binding.

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
retaining them as an ungoverned cache.

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

The pressure ledger remains red until headless, React, and Contract product
receipts exercise both paths. This RFC does not promote `STEP6.CHAT`, accept
LLPs 0071–0073, or claim hosted completeness.

## Acceptance

### Principal-addressed removal

- Generation refuses omission, unknown option fields, pending/`none` caller
  classes, partial `from` coverage, and a caller class inconsistent with
  `lastHolder`.
- An owner removes an active member without receiving a row id, role,
  existence bit, or count; removing the now-absent pair again returns the exact
  same `null`.
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
  membership existence.
- Malformed, raw-boundary, cross-pair, cross-room, cross-principal, cross-app,
  cross-instance, expired, and post-membership-change cursors return one
  byte-identical invalid-cursor response.
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
4. three-page room-history traversal by a member;
5. cross-user/cross-room/stale cursor refusal; and
6. no regression to invitation, self-accept, self-leave, fan-out, or unread
   state.

The receipt records the Snapback revision, generated artifact hashes, target
profile, exact pressure-profile row, and all refusal codes. It is a local
semantic witness only and cannot by itself promote `STEP6.CHAT`.

## Implementation order

1. Accept this RFC through the LLP 0005 review and maintainer-ratification
   boundary.
2. Add the closed manifest facts and generation negatives.
3. Land `removePrincipal` host command, captures, writer-carrier propagation,
   provenance, invalidation, and adversarial storage/runtime tests.
4. Generalize the existing standard-pattern cursor binding for normalized
   non-cursor arguments and the membership profile; retain the same envelope
   and uniform refusal.
5. Add the generated helper, runtime ceiling, pure/SQLite/cursor/invalidation
   conformance suite, and guide updates.
6. Adopt both surfaces in Team Chat, regenerate artifacts, update its diary and
   pressure ledger, and run headless plus complete React/Contract receipts.
7. Keep the Step 6 claim red until every independent prerequisite named by LLP
   0063 is accepted and every target-specific witness is green.

## Open questions

1. Should the first accepted version call the command `removePrincipal` or
   `removeOther`? This draft uses the former because the argument is the public
   address while `target: "other"` remains a host-derived policy fact.
2. Should a later profile admit principal-addressed role change? It needs a
   non-oracular total transition analogous to this RFC; v1 deliberately does
   not.
3. Is the conservative global authorization-epoch cursor invalidation cost
   acceptable until LLP 0053 declaration/subject narrowing graduates? This
   draft says yes for correctness and instrumentation simplicity.

## Status and ratification boundary

**Draft.** This authoring session is not an independent reviewer. The proposal
authorizes no code, no default, no claim promotion, and no change to the current
Team Chat pressure profile.

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
