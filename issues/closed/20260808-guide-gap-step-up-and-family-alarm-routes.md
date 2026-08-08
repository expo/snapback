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

## Resolution

Fixed 2026-08-08 (docs-review execution, 1284ae8a5). The sessions page now
documents both routes' exact status: `/auth/step-up/request` mints a
five-minute operation-bound challenge for authority-creating consent, with
delivery capture-mailbox-only until LLP 0045's mail adapter exists
(refusing `SNAPBACK_AUTH_STEP_UP_DELIVERY_UNAVAILABLE` on non-capture
profiles); `/auth/family-alarm` is the opaque revoke-only alarm with a
delayed uniform empty response. Lane judgment: no capability GAP row —
surface-map already maps both to shipped `auth.sessions`, and the pointer
now resolves to real teaching.
