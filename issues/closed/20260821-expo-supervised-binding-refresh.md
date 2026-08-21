# Refresh supervised Expo AppBindings before they expire

**Status:** Closed
**Impact:** 5
**Urgency:** 5
**Ease:** 3
**Confidence:** 5
**Systems:** Expo, CLI, AppBinding, Dev loop, Diagnostics
**Date:** 2026-08-21
**Closed:** 2026-08-21
**Landing SHA:** TBD
**Governing:** LLP 0181 AppBinding v1 and supervised development baseline;
LLP 0294 W6.3 and resolved OQ7
**Evidence:** Messtimate published-0.1.24 diary; current
`packages/snapback-cli/expo-dev.mjs`

## Problem

`runExpoDev` minted one supervised binding with a one-hour TTL and the bootstrap
exchange returned that same object until a generated descriptor changed or the
backend was explicitly refreshed. After the TTL, a cold app boot received the
expired binding and failed with `SNAPBACK_APP_BINDING_EXPIRED`; terminating and
relaunching the app could not repair it. Only restarting the whole dev loop
minted a fresh binding.

This made a normal long editing session silently self-expire and presented the
failure as an app boot defect. The expiry refusal also lacked recovery text
that identified the supervisor as the stale owner.

## Required change

- Re-mint the supervised binding on bootstrap exchange when its remaining TTL
  crosses a bounded refresh window, or run one supervisor-owned refresh timer.
- Preserve the exact descriptor identity, target, routing, capabilities, and
  supervisor generation; refresh may change only issuance/expiry facts unless
  another governing event changed.
- Make concurrent exchanges converge on one valid successor and never expose a
  partially rotated binding.
- Add remediation to the expiry refusal for clients attached to an older
  supervisor that cannot refresh.
- Expose refresh/rotation in the structured readiness stream without placing
  bearer material in logs.

## Acceptance

- A supervised loop remains running beyond multiple binding TTLs; cold boots
  before and after each boundary reach application-ready UI without restarting
  the loop.
- Fake-clock tests cover concurrent exchange, descriptor rotation near expiry,
  clock skew, refresh failure, Ctrl-C, and cleanup.
- An expired cached predecessor is rejected after the refreshed exchange is
  available and cannot replace the successor.

## Resolution

Implemented LLP 0294 OQ7's 2026-08-21 orchestrator ruling: lazy per-exchange
refresh with no timer. The ordinary one-hour binding enters a five-minute
refresh window; shorter configured test TTLs default to a one-quarter window.
Concurrent exchanges join one in-flight mint for the current publication
revision. A newer descriptor/backend publication wins over an older refresh,
and only a complete successor can swap into the exchange.

Refresh preserves descriptor identity, target/routing, capabilities,
supervisor generation, and integrity; only `issuedAt` and `expiresAt` change.
Structured success/failure events project only public identity and time facts.
Expired-binding remediation now tells clients attached to an older supervisor
to stop that stale owner and restart `snapback dev --expo`.

Fake-clock coverage exercises the bounded window, concurrent convergence,
one-minute clock skew, descriptor/refresh races, refresh and invariant failure,
expired-predecessor rejection, and cleanup during an in-flight refresh. The
real dev-loop witness crosses three TTLs with cold boots on both sides, while
the packaged CLI path uses `SIGINT` and verifies complete reclamation.
