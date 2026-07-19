# Make membership self-transitions reachable from app handlers

**Status:** Closed
**Severity:** P2
**Systems:** Auth/RBAC, Runtime, Codegen, Storage
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-18
**Related:** LLP 0056 §Writes; guide/auth/scoped-roles.md; demos/shindig (diary 0015); ENG-25263 (guide-gap side)
**Marker:** membership, setRole, memberId, roster-privacy, reachability

`ctx.membership.<decl>.setRole/remove/patch` take a `memberId` — the
membership row's `_id`. v1 membership tables are fully private to app code:
no `ctx.db` reads (`SNAPBACK_MEMBERSHIP_READ_PRIVATE`), no existence oracle,
and `insert()`/`bootstrap()` return null / the resource id, never the member
row id. The result is that **no app handler can ever call setRole, remove,
or patch** — the only reachable transitions from application code are
`insert`. The declared transition grammar happily accepts (and validates
reachability for) `setRole`/`remove`/`patch` transitions that are dead code
in practice, and the LLP 0056 example sequence (`setRole(memberId, 'guest')`
as the accept-invite step) is not spellable.

Shindig worked around it by keeping pending invites in an app-data table and
seating the guest via a `by: ['none']` self-insert at first RSVP. That shape
is fine for RSVP products, but "promote a member", "leave a group", "kick a
guest", and "renew an expiring membership" (`patch` on `expiresAt` — the
exact motivating example in LLP 0056's non-authorization-columns paragraph)
all remain unbuildable.

Candidate affordances (pick per LLP 0056's authority model, not all):

- Self-lookup: `ctx.membership.<decl>.selfMemberId(resource)` (or
  self-variants `setSelfRole(resource, role)` / `removeSelf(resource)` /
  `patchSelf(resource, values)`) — the caller's own row identity is not an
  existence oracle about anyone else.
- Have `insert()` return the created row's `memberId` so an app can persist
  it in its own data if it wants other-targeted transitions.
- A declaration-bound resolver for hosts:
  `ctx.membership.<decl>.memberIdOf(resource, principal)` gated by the same
  transition matrix that would authorize the subsequent write.

**Done when:**

- At least the self-service subset (leave, self role change, self patch) is
  callable from a mutation handler without admin surfaces, with the
  transition matrix still the sole authorizer.
- Codegen flags declared transitions that are unreachable *from app code*
  (not just class-unreachable) until the affordance exists, or the affordance
  makes them reachable.
- guide/auth/scoped-roles.md and the rbac demo exercise the accept/leave
  path end-to-end (the ENG-25263 doc side lands with it).

## Resolution

Closed 2026-07-18. Generated mutation contexts now expose declaration-bound
`setSelfRole`, `removeSelf`, and `patchSelf` methods for app- and
resource-scoped memberships. The host privately resolves the effective
principal's row and sends it through the existing transition planners; it
never returns the row id. Runtime coverage pins self role changes, patches,
and removal, while the RBAC demo exercises invite, accept, and leave. General
other-target roster lookup remains deliberately out of scope.
