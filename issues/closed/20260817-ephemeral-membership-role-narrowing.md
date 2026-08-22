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

## Resolution

Resolved 2026-08-21. `RoomPermissionProjection` now carries optional,
artifact-compatible `roleField`/`allowedRoles`; activation validates the pair
against the membership declaration's authorization-affecting role axis and
active vocabulary; and the pinned durable grant query applies the role subset.
Codegen lowers explicit subsets or defaults to every active, non-pending role,
then routes the emitted artifact through the same Rust validator.

The codegen fixture, Rust artifact activation seam, engine downgrade trace, and
messaging Sessions battery prove pending-role denial, vocabulary refusal,
allowed-role admission, old-generation quiescence at every sink, terminal
downgrade denial, survivor cleanup, later publication denial, durable
membership retention, and restoration after a role upgrade. LLP 0013, its LLP
0056 companion, and the Guide now state the earned role-aware behavior.

Verification:

- `cargo test -p snapback-kernel room_permission_projection -- --nocapture`
- `cargo test -p snapback-sync membership_declaration_is_a_room_permission_backing_table -- --nocapture`
- `cargo test -p snapback-server codegen_emitted_membership_projection_parses_and_activates_in_sessions -- --nocapture`
- `cargo test -p snapback-engine codegen_ -- --nocapture`
- `node packages/snapback-codegen/authoring-validation.test.mjs`
- `node demos/messaging-snapback/tests/acceptance/headless.mjs` — 25/25
- `scripts/bootstrap-ibex-runtime`
- `node scripts/check-guide.mjs` — 22/22
- `./ref-check --verbose`
- `node scripts/check-inventories.mjs`

Landing SHA: d2955a4815ee30fccbf2b06c4b5e64532ecd0f4e
