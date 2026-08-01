# A3 sweep: membership tables cannot be seeded or reset, so a fixture reset cannot retire authority

**Opened:** 2026-08-01
**Systems:** Auth, Storage, Versioned seeds
**Related:** LLP 0137 (A3 arm), LLP 0056, LLP 0109, demos/improvement-sweep/arms/a3-snapback-web/findings/0137-a3-f1-membership-not-seedable-cleanup-cannot-retire-authority.json

Naming a membership table in `snapback/seed.json` with an EMPTY row array
refuses at install with `SNAPBACK_SEED_MEMBERSHIP_BOOTSTRAP_UNSUPPORTED`
("sessions-mode versioned seed cannot install membership rows"). Because
unnamed tables are not reset targets, a versioned reset-install restores all
app data to the literal fixture while every membership seat survives — the
receipted reset cannot retire authority, and a fixture cannot establish it.
The scoped-roles design reserves a "trusted migration/import context" that
holds row ids; the versioned seed is exactly such a context but is refused.

The A3 arm worked around it with per-persona `leaveOrg` self-removal before
the reset, and post-reset verification had to re-redeem a restored invite to
earn a seat back (evidence: A3-12 in the arm capsule).

Fix shape: a declaration-checked trusted-import lane — fixture membership
rows admitted only when they satisfy the declared roles, and named membership
tables become reset targets. Witness: seed with fixture seats installs; reset
deletes runtime seats and restores fixture seats; runtime-only principal is
denied after reset.

---

**Status:** Resolved (2026-08-01, LLP 0100 M4 lane)

**Resolution.** The declared membership fixture lane landed, exactly the
ticket's fix shape, with the design routed by LLP 0100 §8b and owned by
the dated LLP 0109 §18 + LLP 0056 amendments (both landed with this
change; a3-f1's cleanup choreography — per-persona `leaveOrg` × 3 before
every receipted reset, invite re-redemption after — is cited there as the
motivating pain).

- The naming refusal (`SNAPBACK_SEED_MEMBERSHIP_BOOTSTRAP_UNSUPPORTED`)
  is retired: `validate_versioned_seed_request` (src/storage.rs) admits
  named membership tables in both modes; unknown tables still refuse.
- Fixture seats install through the existing `MembershipWriter::Seed`
  carrier with per-row `seed` provenance stamped in
  `seed_rows_into_transaction`; host-managed provenance columns cannot
  be spoofed (undeclared-field refusal). The same-transaction
  `validate_membership_activation` scan enforces vocabulary, axes,
  uniqueness, referential integrity, and lastHolder eligibility
  (sessions mode: catalog-precedes-seed per 0109 §8).
- One correction to this ticket's premise, verified in code: membership
  tables were ALREADY inside the versioned reset's deletion set (the
  reset deletes every physical app table); what blocked retirement was
  the up-front naming refusal making any membership-bearing artifact —
  and therefore the whole reset — unusable. With the lane open, the
  §6.3 one-transaction cut delivers the full witness, and its
  authorization consequence is the rotated incarnation at epoch 0 —
  LLP 0056's event-3/declared-restore class, never per-row kicks.

**Witnesses (all green):**
`versioned_seed_membership_fixture_lane_installs_resets_and_retires_runtime_authority`
(install + provenance + seeded-host-exercises-the-matrix + one-cut reset
+ runtime-only principal denied + fixture authority surviving),
`versioned_seed_membership_fixture_lane_fails_closed` (unknown role;
provenance spoof), and
`versioned_seed_conformance_empty_target_and_sessions_membership_lane`
(sessions admission; undeclared-table refusal) — src/storage.rs,
src/seed_identity.rs. Conformance case renamed
`sessions-membership-fixture-lane` (manifest + suite + runner). Guide:
`guide/backend/versioned-seeds.md` documents the lane.
