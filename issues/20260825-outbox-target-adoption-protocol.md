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
Its current typed outcome therefore reports a retained pause; it is not an
adoption receipt for a cross-target transition.

Pre-v2 records have a second migration problem: they contain no persisted
enqueue target to compare or rewrite. A client upgraded while offline must not
silently lose or permanently strand that intent merely because the predecessor
could not have written v2 identity. The protocol needs an explicit migration
case with evidence strong enough to bind each legacy record to a target, or a
recovery workflow that preserves the bytes until a user-authorized disposition.

## Needed decision

Specify whether cross-target adoption is supported and, if so, the exact
proof, audit receipt, record rewrite/CAS, crash cuts, string-reference app
identity rule, rollback behavior, and mixed-queue semantics. Until that
protocol is accepted and implemented, adoption replay encountering a target
mismatch must leave the record pending and send zero mutation POSTs.

The authority check is independent of target compatibility. Before any target
rewrite or custody reconciliation, the protocol must prove that the adopting
caller is authorized for the record's captured principal/authority cohort and
for the destination target. A candidate authority must not be able to strand,
privacy-delete, relabel, or acknowledge a foreign-target record as a side
effect of inspecting it. The design must order target eligibility, adoption
authority, record-scoped custody, and the rewrite explicitly across crashes.

## Acceptance

- An accepted LLP names the authority and crash-safe transition for changing a
  persisted enqueue target, or explicitly rejects cross-target adoption.
- The authority proof is checked before any record mutation and cannot be
  inferred from writer custody, a fresh snapshot, artifact equality, or the
  candidate's current session alone.
- Upgrade-while-offline migration covers pre-v2 targetless records without
  dropping intent or leaving it permanently unreachable; crash/relaunch and
  rollback preserve the original bytes until the migration commits.
- `adoptQueuedMutations()` either performs that checked transition or exposes
  a stable refusal that points to the chosen recovery path.
- Conformance covers origin, target-profile, generated-generation, app-id,
  targetless-predecessor, mixed-queue, crash/relaunch, and rollback cases.
