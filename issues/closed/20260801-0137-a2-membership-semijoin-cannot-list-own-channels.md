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

---

**Triage 2026-08-01 (fix-wave Lane β): executable, NOT 0100-gated.** Unlike
its two A2/A3 siblings (principal-addressed removal and resource-partitioned
keyset pages, both governed by LLP 0100 §§3-4 and gated on its ratification),
the self-scoped projection this ticket asks for is *not* in 0100's scope —
0100 mentions semi-joins only to exclude incremental semi-join deltas from
its cursor profile.

The proposal discloses strictly less than any existing surface: only the
caller's own membership rows, resource ids, and roles — nothing about other
principals — so the private-roster posture holds by construction, and
revocation already blanks it through the ordinary membership-predicate
invalidation. It needs a declaration-owned generated projection
(`myMemberships` live query or `membershipResource.self()`), its LLP 0056
amendment, and codegen + manifest plumbing. Ready to pick up.

---

**RESOLVED 2026-08-01 (fix-wave Lane β2).** The declaration-owned
self-projection shipped as the reserved native live query
`_snapback.myMemberships` (`{membership: <declaration id>}` → the
caller's own `{id, resource, role, sinceMs}` rows only), riding the
ordinary live surface — `client.liveQuery('_snapback.myMemberships',
{args:{membership}})` — with pinned empty-range capture (first grant
wakes a blank subscription), witnessed sessions-lane delivery, and
anonymous/unknown-id refusal semantics. LLP 0056 carries the dated
amendment. Evidence:
`local::tests::my_memberships_projection_lists_own_seats_only_and_wakes_on_grant`
(own-seats isolation, outsider-blank, grant-wake, revocation-removal,
anonymous-empty, unknown-refusal). The roster mirror the guide
documented as interim remains valid presentation-data advice; the
authorization-backing mirror is no longer needed.
