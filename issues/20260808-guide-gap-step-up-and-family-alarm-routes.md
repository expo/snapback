# guide-gap: shipped /auth/step-up/request and /auth/family-alarm routes point at silence

**Opened:** 2026-08-08 · **Severity:** P3 (documentation)

`/auth/step-up/request` and `/auth/family-alarm` are registered routes
(src/server.rs:8198, 8211; handler `auth_step_up_request` at
src/server.rs:12584; provider support src/auth/provider.rs:1390-2339).
guide/surface-map.md:117,129 assigns them to sessions-and-principals.md,
but no auth page mentions them and no capability-index row exists — the
surface-map pointer lands on silence.

If step-up delivery is gated on the missing mail adapter, that boundary is
itself the teachable fact under the page's own readiness rule.

Ask: either a sentence on the sessions page stating their status, or a
capability-index GAP row, so the pointer resolves to something.

Found by the 2026-08-08 comprehensive docs review (auth slice).
