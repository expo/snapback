# 0137 A2: no reachable host/moderator removal of another member (kick/ban) under the v1 private roster

- **Date:** 2026-08-01
- **Source:** LLP 0137 Phase 1, A2 snapback-web arm (external consumer, @expo/snapback-* 0.1.7)
- **Finding:** `demos/improvement-sweep/arms/a2-snapback-web/findings/0137-a2-f4-no-admin-revocation-of-another-member.json`
- **Severity:** capability gap — chat moderation (kick/ban) is table stakes and currently impossible from app code

Id-addressed `ctx.membership.remove` needs a private row id the app can never mint, and other-targeted transitions are unreachable for removal. A2-10 was proven via self-revocation (`removeSelf`): the established protected live handle blanked in ~1.7s, a post-revocation commit was not delivered, fresh reads denied uniformly (`SNAPBACK_AUTH_PERMISSION_DENIED {kind:'role'}`) — the barrier itself is excellent; only the other-initiated entry point is missing. The frozen Convex arm had host-driven revocation directly (memberships as ordinary app data).

Proposed smallest fix: principal-addressed generated membership commands (e.g. `removePrincipal(resource, principal)`) admitted only where the declaration's transition matrix authorizes the caller class, keeping the roster unenumerable and the denial non-disclosing.

Witness: other-initiated A2-10 shape — host removes member; member's established live handle blanks; post-revocation commits not delivered; unauthorized caller gets the uniform role denial.
