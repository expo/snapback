# 0137 A2: "channels I belong to" is inexpressible against a resource-scoped membership declaration

- **Date:** 2026-08-01
- **Source:** LLP 0137 Phase 1, A2 snapback-web arm (external consumer, @expo/snapback-* 0.1.7)
- **Finding:** `demos/improvement-sweep/arms/a2-snapback-web/findings/0137-a2-f3-membership-semijoin-cannot-list-own-channels.json`
- **Severity:** capability gap — the core chat sidebar query forces a parallel app-data roster mirror

`membershipResource.rowField('_id')` is refused (`QUERY_MEMBERSHIP_RESOURCE_REF_INVALID: membership row field _id does not exist on channels`), the `arg()` form gates one known resource rather than listing, and JS handlers have no non-throwing role test (`requireRole` denial is terminal). So a live query over the resource table cannot semi-join "rows where the caller holds a seat", and the arm maintained a `channelSeats` app-data mirror in every membership mutation purely for listing — adjacent to the mirror the scoped-roles guide warns against.

Proposed smallest fix: a declaration-owned self-scoped projection (generated `myMemberships` live query or `membershipResource.self()`), returning only the caller's own seats + resource ids + roles, revocation-active. This discloses nothing beyond the caller's own rows, so the private-roster posture holds.

Witness: external app renders "my channels" from one generated query with no mirror table; cross-principal isolation and self-removal live-update asserted.

Documentation status (2026-08-01): `guide/auth/scoped-roles.md` now teaches the
ordinary per-user app-data feed as the supported interim pattern and makes
clear that it is presentation data, never authorization backing. This issue
remains open for the declaration-owned projection that would remove the
mirror.
