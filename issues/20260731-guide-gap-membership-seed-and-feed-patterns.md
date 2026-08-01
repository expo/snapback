# guide-gap: membership patterns demos keep rediscovering

**Status:** OPEN — from demos/party-wall (diary 0041 findings 2, 6)

Two patterns every membership-shaped demo has now hit without guide
coverage: (1) "my resources" — a membership-gated live query over the
resource table itself is inexpressible (`membershipResource.rowField`
cannot address `_id`); the house answer is a denormalized per-user feed
table (shindig's invites, party-wall dropped the query). (2) Seeding a
resource under a `lastHolder`-protected membership requires seeding the
holder's roster row too (`SNAPBACK_MEMBERSHIP_ACTIVATION_UNPROTECTED_
RESOURCE` otherwise) — and roster rows ARE seedable, which surprises
after the handler-lane raw-write refusal. One guide subsection covering
both would have saved two demos' round trips.
