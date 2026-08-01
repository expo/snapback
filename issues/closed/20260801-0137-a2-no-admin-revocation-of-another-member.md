# 0137 A2: no reachable host/moderator removal of another member (kick/ban) under the v1 private roster

- **Date:** 2026-08-01
- **Source:** LLP 0137 Phase 1, A2 snapback-web arm (external consumer, @expo/snapback-* 0.1.7)
- **Finding:** `demos/improvement-sweep/arms/a2-snapback-web/findings/0137-a2-f4-no-admin-revocation-of-another-member.json`
- **Severity:** capability gap — chat moderation (kick/ban) is table stakes and currently impossible from app code

Id-addressed `ctx.membership.remove` needs a private row id the app can never mint, and other-targeted transitions are unreachable for removal. A2-10 was proven via self-revocation (`removeSelf`): the established protected live handle blanked in ~1.7s, a post-revocation commit was not delivered, fresh reads denied uniformly (`SNAPBACK_AUTH_PERMISSION_DENIED {kind:'role'}`) — the barrier itself is excellent; only the other-initiated entry point is missing. The frozen Convex arm had host-driven revocation directly (memberships as ordinary app data).

Proposed smallest fix: principal-addressed generated membership commands (e.g. `removePrincipal(resource, principal)`) admitted only where the declaration's transition matrix authorizes the caller class, keeping the roster unenumerable and the denial non-disclosing.

Witness: other-initiated A2-10 shape — host removes member; member's established live handle blanks; post-revocation commits not delivered; unauthorized caller gets the uniform role denial.

---

**Triage 2026-08-01 (fix-wave Lane β): NOT an independent fix — routed to
LLP 0100's ratification.** The "proposed smallest fix" in this ticket
(principal-addressed generated membership commands) is already designed, in
more detail and with a stricter contract, by **LLP 0100** (Draft,
"membership-addressed operations and pages"), which the sibling P1
`20260726-team-chat-owner-removal.md` has been waiting on since 2026-07-26.

0100's decided shape differs from the naive implementation in two ways that
matter, both discovered by building it and comparing:

1. **Opt-in declaration.** 0100 requires an explicit
   `principalAddressedWrites: { remove: true }` per membership declaration
   and admits only a total `target: "other"` remove transition. Adding the
   commands implicitly to every declaration silently widens the write
   surface of every existing app.
2. **Present/absent indistinguishability.** 0100 requires the same `null`
   for a present and an absent target. Resolving the target and refusing
   `SNAPBACK_MEMBERSHIP_SELF_NOT_FOUND` when it is missing — the obvious
   implementation — makes the roster enumerable by probing, which is
   exactly the property the private roster exists to protect. Charlie's
   2026-07-30 Major-1 decision on 0100 already settled the related
   disclosure boundary (byte-level result scoped; authorization-version
   observable accepted).

A working implementation of the naive shape (host-side principal
resolution reusing the existing transition-matrix planners, plus
`removePrincipal`/`setPrincipalRole` on `ctx.membership`) was built and
verified against the declared matrix during this triage, then **reverted
unlanded**: shipping it would pre-empt a gated ratification and ship the
weaker disclosure contract. The mechanism is straightforward when 0100
ratifies — the seam is `resolve_self_membership_id`'s sibling in
src/storage.rs, and the planners already enforce authorization unchanged.

Blocked on: LLP 0100 ratification (its own gate), then implementation with
the opt-in declaration and the indistinguishability rule.

---

**Status:** Resolved (2026-08-01, LLP 0100 M1 implementation lane)

**Resolution.** LLP 0100 was Accepted 2026-08-01 (explicit composed-parent
ruling, ballot item 2) and the M1 core-operations lane implements exactly
the decided shape this ticket routed to — with both properties the naive
build-and-revert violated now load-bearing and tested:

1. *Opt-in declaration:* `principalAddressedWrites: { remove: true }`
   (closed; validated at codegen AND schema activation —
   `SNAPBACK_MEMBERSHIP_PRINCIPAL_ADDRESSED_INVALID` family in
   src/storage.rs `validate_membership_declaration`; total-carrier,
   pending-class, and lastHolder-consistency refusals). Without it the
   host refuses `SNAPBACK_MEMBERSHIP_PRINCIPAL_ADDRESSED_UNDECLARED` —
   no implicit widening of any existing app's write surface.
2. *Present/absent indistinguishability:* the planner
   (`plan_membership_remove_principal`, src/storage.rs) returns the
   identical `null` for present and absent targets, captures BOTH
   lookups, refuses unauthorized callers with the invariant
   `SNAPBACK_MEMBERSHIP_TRANSITION_DENIED` before any target lookup
   (byte-identical across target presence — tested), and the absent
   no-op advances no authorization version (the §1-scoped disclosure,
   asserted against the durable global `AuthorizationVersion`).

The ticket's witness shape is delivered: the removed member's
`_snapback.myMemberships` subscription drops the seat at the removal cut
(src/local.rs `remove_principal_drops_the_seat_from_my_memberships_at_the_cut`,
driven end to end through an authored JS mutation and
`ctx.membership.<decl>.removePrincipal`), the unauthorized caller gets
the uniform role denial, and the id-addressed surface stays closed.
Suites: src/storage.rs `remove_principal_*` + activation tests,
tests/membership_principal_addressed_v0.rs (full JS path incl.
branch-insensitive companion writes), rbac-authoring.test.mjs
(generation positives/negatives + typed `removePrincipal` emission).
Guide: guide/auth/scoped-roles.md "Remove another principal" section.
The Team Chat product receipt remains with the sibling ticket's residual
(step-6 adoption).
