# Define and enforce one client authority-transition state matrix

**Status:** Open
**Opened:** 2026-08-21
**Systems:** Client auth coordinator, Live queries, Mutations/outbox, React,
Familiar projections, Headless/provider adapters, Diagnostics
**Governing:** LLP 0295 D0.2/W2; LLP 0059; LLP 0107; LLP 0218
**Related:** `issues/20260820-agent-auth-transition-residuals.md`;
`issues/20260820-optional-user-live-query-auth-transition-stall.md`;
`issues/20260820-authenticated-query-signed-out-settlement.md`;
`issues/20260818-guide-gap-background-writes-during-auth-transitions.md`;
`issues/20260820-familiar-live-subscription-contention.md`

## Problem

One-shot queries, live queries, foreground mutations, outbox work, React
hooks, Familiar projections, and provider adapters currently expose adjacent
but not demonstrably total interpretations of anonymous -> authenticating ->
authenticated -> revoking -> reconnecting transitions. The result is a mix of
silent ready/empty projections, indefinitely unsettled signed-out operations,
foreground work serialized behind housekeeping, and app-authored retry delays.

This is the client/runtime authority lifecycle. It is distinct from LLP 0293's
kernel authority-write chokepoint.

## Required decision

Amend the owning LLPs with one state and settlement matrix that answers:

- which operations are admitted, rejected, queued, blanked, or restarted in
  every principal class and transition state;
- when awaited sign-in/sign-out is settled enough for queries, ephemeral
  state, subscriptions, and outbox work;
- how predecessor frames and queued writes are fenced across A -> anonymous
  and A -> B;
- whether background writes have an admitted housekeeping lane or an explicit
  wait/skip policy, without head-of-line blocking foreground work;
- which state is safe for subscribe-after-settle and reconnect; and
- which public status and diagnostic fields expose queue, authorization,
  execution, commit, and delivery separately.

## Conformance scope

Build one table-driven suite projected through core/headless, React, Familiar,
and provider surfaces. Cover anonymous -> A, A -> anonymous, A -> B, watch
reload, reconnect during transition, unmount/remount, foreground work beside
housekeeping, and late predecessor delivery. Each surface may adapt vocabulary
but may not invent different terminal semantics.

## Exit

The owning LLPs contain one accepted total matrix; the conformance suite proves
every named surface against it; the related defect tickets close on their
specific reproductions; and no transition can remain indefinitely
ready/empty/disconnected, pending without an admitted wait, or silently bound
to the predecessor principal.
