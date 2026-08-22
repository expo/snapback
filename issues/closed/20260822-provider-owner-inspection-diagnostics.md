# Expose owner-labelled provider connection and subscription inspection

**Status:** Closed — 2026-08-22
**Opened:** 2026-08-22
**Systems:** Headless client, React provider, diagnostics
**Governing:** LLP 0095; LLP 0278 D0.5; LLP 0295 W4/W5
**Related:** `issues/closed/20260821-provider-connection-subscription-budget-decision.md`

## Scope

Make connection-manager ownership and logical subscription ownership visible
without exposing query arguments or authority material.

## Acceptance

Inspection enumerates owner-labelled active connections and subscriptions with
connection state, snapshot version, readiness/auth barrier, and outbox
suspension reason. It includes the canonical app/storage/origin/settled-authority
ownership tuple and grant age without exposing grants. Budget diagnostics
identify the same owner and fire before refusal.

## Resolution

Headless inspection now retains subscription-owner labels, ownership tuple,
grant age, and the real outbox suspension reason; React inspection combines
them with provider ownership and the 16/64 budget. Fixtures prove active,
paused, and post-disposal views.
