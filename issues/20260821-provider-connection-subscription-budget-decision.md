# Decide the provider connection and subscription budget contract

**Status:** Open — decision packet; implementation follows the ruling
**Opened:** 2026-08-21
**Systems:** Headless client, Provider adapters, Live queries, Auth lifecycle,
React, Diagnostics, Performance
**Governing:** LLP 0295 D0.5/W4; LLP 0095; LLP 0278; LLP 0280
**Related:** `issues/20260820-guide-gap-provider-connection-lifecycle-budget.md`;
`issues/20260820-familiar-live-subscription-contention.md`

## Problem

The public ceiling on individual subscriptions is not an application
composition contract. Matrix adapters independently opened connections,
nested reads inside update callbacks, rebuilt streams during auth settlement,
and fanned one stream per visible entity. Separately, six ordinary Familiar
React subscriptions showed a probable liveness/consistency problem that
disappeared when consolidated. Without explicit ownership and budgets, neither
authors nor diagnostics can distinguish supported composition, inefficient
composition, and product defect.

## Decision packet

Define and justify:

- connection ownership and reuse per app authority/origin;
- ordinary subscriptions per view/provider and how that budget relates to the
  transport's hard ceiling;
- when independent subscriptions must share a snapshot/version boundary and
  when an aggregate relational query is only an optimization;
- nested query behavior from update callbacks;
- equal-snapshot and transport-only publication deduplication;
- bounded fan-out, teardown, retry, and resubscription after auth transitions;
- inspection fields for active connection/subscription owners; and
- the diagnostic emitted before a supported budget or consistency envelope is
  exceeded.

Use the minimized six-subscription investigation as evidence, but do not set a
product limit from the benchmark workaround unless the reproduction proves the
limit is intentional.

## Exit

The owning LLPs carry an accepted numerical and semantic budget contract,
including independent-versus-aggregate consistency guarantees and auth
lifecycle ownership. Follow-on tickets name the client/runtime enforcement,
inspection/diagnostic surface, provider integration, Guide recipe, and
conformance fixtures. The existing Guide ticket then teaches a product contract
rather than empirical adapter folklore.
