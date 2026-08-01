# guide-gap: membership patterns demos keep rediscovering

**Status:** CLOSED — 2026-07-31

Two patterns every membership-shaped demo had hit without guide coverage:
(1) “my resources” — a membership-gated live query over the resource table
itself cannot use `_id` as a `membershipResource.rowField`; and (2) seeding a
resource under a `lastHolder`-protected membership requires the holder roster
row in the same seed.

## Resolution

`guide/auth/scoped-roles.md` now teaches the ordinary per-user app-data feed
pattern, using Shindig's denormalized `invites` live query as the executable
example and keeping membership rows exclusively as private authority backing.
`guide/backend/versioned-seeds.md` now distinguishes the dev/import membership
writer from the shipped sessions-mode versioned-seed lane. The latter refuses
membership-protected targets with
`SNAPBACK_SEED_MEMBERSHIP_BOOTSTRAP_UNSUPPORTED`, so sessions apps create the
resource and first holder through generated `bootstrap()`; the dev/import lane
must still establish every protected resource together with an eligible
holder.

Evidence: `node scripts/check-guide.mjs` and `./ref-check --verbose`.
