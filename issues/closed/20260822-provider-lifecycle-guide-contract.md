# Publish the provider lifecycle and budget contract

**Status:** Closed — 2026-08-22
**Opened:** 2026-08-22
**Systems:** Guide, React provider, headless client, relational composition
**Governing:** LLP 0095; LLP 0278 D0.5; LLP 0295 W4
**Related:** `issues/closed/20260821-provider-connection-subscription-budget-decision.md`

## Scope

Replace provisional provider folklore with the shipped manager-ownership,
subscription-budget, lifecycle, inspection, and composition contract.

## Acceptance

The Guide teaches one manager-owned connection per settled tuple, 16 warning
and 64 hard ceilings, owner-labelled inspection, callback reentrancy,
consumer-visible-snapshot deduplication, teardown-before-successor, and the
risk-7 rule that independent subscriptions remain supported while aggregate
composition is optional unless an atomic cross-set fact is required.

## Resolution

The provider lifecycle recipe, Guide index, and capability registry now teach
the implemented contract and name the generated bounded semi-join and
set-keyed aggregate alternatives.
