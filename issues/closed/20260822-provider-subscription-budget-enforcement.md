# Enforce provider subscription budgets without narrowing correctness

**Status:** Closed — 2026-08-22
**Opened:** 2026-08-22
**Systems:** React provider, live subscriptions, diagnostics
**Governing:** LLP 0278 D0.5; LLP 0295 W4 risk 7
**Related:** `issues/closed/20260821-provider-connection-subscription-budget-decision.md`

## Scope

Implement the provisional per-view/provider warning budget and existing hard
connection ceiling while preserving independent subscriptions as a supported
form throughout the admitted envelope.

## Acceptance

- The 17th logical subscription emits an owner-labelled structured warning at
  the 16-per-view budget; the warning names bounded composition alternatives.
- Counts through 64 remain admitted and live-correct; the 65th is refused by
  the existing hard-ceiling class after a diagnostic.
- Equal complete consumer-visible snapshots deduplicate data publications but
  never swallow readiness or connection lifecycle transitions.
- Synchronous subscription mutation during delivery receives a typed
  reentrancy refusal.

## Resolution

The React store enforces and reports the provisional budget, keeps 64
independent subscriptions supported, compares complete visible snapshots, and
guards delivery reentrancy. Package fixtures exercise warning, ceiling,
deduplication, lifecycle, and reentrancy behavior.
