# Ephemeral projections need membership-backed permission lowering

**Opened:** 2026-08-17
**Closed:** 2026-08-17
**Source:** Coterie M3 backend dual review (codex MATERIAL, adjudicated;
LLP 0013 protected-room privacy rule controlling)

## Gap

An app cannot author an ephemeral projection (typing indicators, presence
scoped to a conversation) whose visibility is derived from a MEMBERSHIP
TABLE. Codegen does not lower a membership relation into the protected
ephemeral `permissionBacking` projection required by the sessions
runtime, so the only expressible postures are `allow.all()` (public
within the store) or nothing. For Coterie M3 typing, `allow.all()` means:
any authenticated — or anonymous — client that knows a conversation id
can observe per-member typing activity (profileId/displayName) and
inject spoofed typing entries; former members retain the id forever.
Review ruling: Snapback M3 typing stays UNCLAIMED until this exists;
the memory provider carries typing alone.

## What the capability must provide (from the review's enumeration)

1. Source-authored membership-backed ephemeral projection lowering: the
   schema declares "visible to current members of conversation X" and
   codegen generates the `permissionBacking` projection from the
   membership table.
2. The authority must be CURRENT membership, not historical incarnations
   (removal and rejoin change visibility immediately).
3. Removal/rejoin invalidation: an ephemeral subscription held by a
   removed member terminates or goes silent at removal time.
4. Write scoping: only current members may publish into the projection
   (no spoofed entries).
5. Negative tests as first-class fixtures: anonymous, non-member, and
   former-member observers all receive nothing.
6. An exact guide example (the typing-indicator recipe is the natural
   one).

## Pointer

The parked-implementation record is Diary 0086's M3 sections. The former
pointer to `demos/coterie/snapback/LANE-NOTES-M3.md` was dangling: that file
does not exist on main. Coterie's membership migration and adoption of this
capability remain owned by the Coterie program.

## Resolution

All six capability points are delivered:

1. `allow.members(declarationId)` and deterministic `permissionBacking`
   lowering landed in `c657941a9`; the generated identity rotation landed in
   `c19c3f3a6` (slice 1).
2. The authoring surface admits only canonical `membership()` declarations, so
   row existence means current membership rather than historical incarnation;
   the messaging fixture proves removal and rejoin (`6abf9b589`, slice 3).
3. The codegen-emitted projection exercises the existing removal/rejoin
   invalidation path through the shared runtime validator (`15b5e4525`, slice
   2), and the live Sessions battery proves terminal removal plus fresh rejoin
   (`6abf9b589`).
4. The same current-row grant gates publish, so anonymous, non-member, and
   former-member writes refuse (`6abf9b589`).
5. Anonymous, authenticated non-member, and former-member negatives are
   first-class messaging acceptance fixtures, alongside member visibility and
   rejoin (`6abf9b589`).
6. This docs landing adds the membership-backed authorization walkthrough, the
   typing-indicator recipe, the witnessed capability row, and the LLP 0013/0056
   reconciliation.

Three author rulings remain explicitly provisional and overridable:

- v1 binds only declared canonical `membership()` relations, not arbitrary
  tables or historical incarnation projections;
- declarations with `pendingRoles` fail closed while the grant is role-blind;
  and
- role narrowing is deferred from the row-existence capability.

Two platform tails remain open. Role-aware `roleField`/`allowedRoles`
projection, role predicates, and downgrade-kick semantics are tracked in
`issues/20260817-ephemeral-membership-role-narrowing.md`. Client overlay/hook
terminal status is tracked in
`issues/20260817-ephemeral-overlay-missing-error-arm.md`; the server already
goes wire-silent after the terminal denial, but the overlay does not surface
that terminal frame.

Coterie does not gain typing merely because the platform capability closed.
Its schema still uses incarnation-oriented membership and must migrate to a
canonical declaration in its own program before adopting `allow.members`.
