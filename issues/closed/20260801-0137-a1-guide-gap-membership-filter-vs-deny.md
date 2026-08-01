# A1 sweep guide-gap: declarative membership predicates filter while requireRole denies — undocumented split

**Opened:** 2026-08-01
**Systems:** Guide, Auth
**Related:** LLP 0137 (A1 arm), LLP 0056, guide/auth/scoped-roles.md, demos/improvement-sweep/arms/a1-snapback-web/findings/0137-a1-f7-membership-filter-vs-deny-split.json

A declarative live query with
`membership: [table.hasRole(membershipResource.arg('workspaceId'), ...)]`
resolves for a non-member with zero rows (filter semantics), while a JS
handler's `ctx.permissions.<m>.requireRole` refuses with the uniform
`SNAPBACK_AUTH_PERMISSION_DENIED`. Neither discloses data, but switching
idioms silently changes the outsider contract (empty result vs denial),
which changes UI behavior and what a probing outsider can confirm.
scoped-roles.md does not state the distinction.
Probe: demos/improvement-sweep/arms/a1-snapback-web/evidence/app/probe-membership.mjs.

Fix shape: document both negative shapes in scoped-roles.md with guidance on
when each is the right product contract.

---

**RESOLVED 2026-08-01 (fix-wave docs sweep).** guide/auth/scoped-roles.md §"Choose between filtering and denying" tables both negative shapes (empty result vs SNAPBACK_AUTH_PERMISSION_DENIED), states what each lets a probing outsider confirm, and gives the per-surface guidance plus the conversion warning.
