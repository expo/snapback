# Prove provider cells share one managed transport

**Status:** Closed — 2026-08-22
**Opened:** 2026-08-22
**Systems:** React provider, headless connection manager, auth lifecycle
**Governing:** LLP 0095; LLP 0114; LLP 0278 D0.5
**Related:** `issues/closed/20260821-provider-connection-subscription-budget-decision.md`

## Scope

Retain a provider integration fixture proving that N logical cells under one
manager and settled authority/origin do not imply N transport connections, and
that an authority successor cannot overlap its predecessor.

## Acceptance

Six cells create six logical subscriptions on one transport; inspection names
their common owner. Disposal tears down the owned resources. Auth replacement
tears down the predecessor before establishing its successor.

## Resolution

The React package fixture exercises the real headless manager with an injected
WebSocket, observes one connection and six subscriptions, and verifies
teardown. Provider publication is held in `refreshing` until the successor
connection is live, enforcing the teardown-before-successor boundary.
