# Refresh supervised Expo AppBindings before they expire

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 3
**Confidence:** 5
**Systems:** Expo, CLI, AppBinding, Dev loop, Diagnostics
**Date:** 2026-08-21
**Governing:** LLP 0181 AppBinding v1 and supervised development baseline
**Evidence:** Messtimate published-0.1.24 diary; current
`packages/snapback-cli/expo-dev.mjs`

## Problem

`runExpoDev` mints one supervised binding with a one-hour TTL and the bootstrap
exchange returns that same object until a generated descriptor changes or the
backend is explicitly refreshed. After the TTL, a cold app boot receives the
expired binding and fails with `SNAPBACK_APP_BINDING_EXPIRED`; terminating and
relaunching the app cannot repair it. Only restarting the whole dev loop mints
a fresh binding.

This makes a normal long editing session silently self-expire and presents the
failure as an app boot defect. The expiry refusal also lacks the recovery text
that would identify the supervisor as the stale owner.

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

