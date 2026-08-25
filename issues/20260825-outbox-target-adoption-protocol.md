# Define explicit adoption for target-bound outbox records

**Status:** Open
**Opened:** 2026-08-25
**Systems:** Client integration, Offline/outbox, Sidecar adoption, Testing
**Related:** LLP 0043, LLP 0058,
`issues/closed/20260816-public-dashboard-offline-acceptance-outbox-red.md`

## Problem

Additive outbox record schema v2 binds every new durable mutation to its
enqueue target: canonical origin, target profile, and generated artifact
generation or string-reference application identity. Ordinary replay now
fails closed when that persisted identity differs from the fresh pinned replay
target. Pre-v2 records without target identity fail closed separately.

The existing `adoptQueuedMutations()` checks store identity, a fresh snapshot,
writer custody, and generated artifact compatibility, but it does not define
authority to replace or waive the new persisted target binding. Treating those
checks as implicit target adoption would make the safety decision accidental.

## Needed decision

Specify whether cross-target adoption is supported and, if so, the exact
proof, audit receipt, record rewrite/CAS, crash cuts, string-reference app
identity rule, rollback behavior, and mixed-queue semantics. Until that
protocol is accepted and implemented, adoption replay encountering a target
mismatch must leave the record pending and send zero mutation POSTs.

## Acceptance

- An accepted LLP names the authority and crash-safe transition for changing a
  persisted enqueue target, or explicitly rejects cross-target adoption.
- `adoptQueuedMutations()` either performs that checked transition or exposes
  a stable refusal that points to the chosen recovery path.
- Conformance covers origin, target-profile, generated-generation, app-id,
  targetless-predecessor, mixed-queue, crash/relaunch, and rollback cases.
