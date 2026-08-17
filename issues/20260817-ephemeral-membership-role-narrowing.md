# Membership-backed ephemeral rooms need role narrowing

**Opened:** 2026-08-17
**Source:** DESIGN-ephemeral-membership.md §5 slice 4; LLP 0013 dated
amendment “source-authored membership-backed rooms”
**Systems:** Ephemeral realtime, Memberships, Auth invalidation, Codegen,
Storage, Testing

## Gap

`allow.members(declarationId)` now grants a protected ephemeral room from the
existence of the canonical membership row. It correctly scopes current-member
subscribe/publish and invalidates on removal, but it does not inspect the role
column. Codegen therefore refuses both a declaration with `pendingRoles` and
`allow.members(..., { roles })`.

A transition between active roles wakes the authorization barrier, but the
role-blind `EXISTS` query can regrant the same row. Until this ticket lands, a
role downgrade is not the kick described as the target semantics in LLP 0013's
2026-07-16 note.

## Slice 4 scope

- Extend `RoomPermissionProjection` with serde-defaulted optional `roleField`
  and `allowedRoles`, preserving existing artifacts.
- Add the role predicate to the durable grant query: subject + resource row
  existence must also satisfy `role IN allowedRoles` when narrowing is present.
- Make activation validate that the role field exists, is
  authorization-affecting, and that allowed roles belong to the declaration's
  closed role vocabulary.
- Lower `allow.members(..., { roles })`; by default lower the declaration's
  non-pending `roles`. Lift `EPHEMERAL_MEMBERSHIP_PENDING_ROLES` and
  `EPHEMERAL_MEMBERSHIP_ROLES_UNSUPPORTED` only once the runtime projection is
  role-aware.
- Preserve one-validator convergence: codegen-emitted artifacts must activate
  through the same Rust validation path as direct manifests.

## Done when

- invited/pending rows do not grant subscribe or publish;
- explicit role subsets grant only listed active roles;
- an allowed→disallowed downgrade quiesces old-generation sinks, terminates the
  downgraded subscriber, removes their entries for survivors, and denies later
  publication;
- the codegen, artifact-to-runtime, and messaging Sessions batteries cover the
  downgrade kick and role vocabulary refusals; and
- LLP 0013 and the Guide may truthfully remove the role-narrowing nonclaim.

This follow-on implements a provisional, overridable author ruling: role
narrowing was severed from the row-existence capability rather than blocking
its first release.
