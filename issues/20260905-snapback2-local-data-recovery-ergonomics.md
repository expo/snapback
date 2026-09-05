# P2 Snapback 2: make local-data recovery states and diagnostics actionable

**Status:** Open
**Priority:** P2
**Systems:** client outbox API, recovery, diagnostics and pending UI
**Date:** 2026-09-05
**Source:** Codex local-data review; reproduced/inspected at `23e89b4a17fecb713b7ca61681cf6f4f969c8536` (product tree equal to locally tracked origin/main `11e2e60984e756128aa0091b4c6c36ff82094ecb`).
**Related:** LLP 1012 §6–§8 and §15; local-data review 2026-09-05

## Follow-ups from the review

These are ergonomic recommendations. They are distinguished below from the
concrete defects filed separately.

1. **Expose transport stops from replay.** A retryable transport failure
   leaves the intent queued, but public `outbox.drain()` and `settled()`
   only distinguish a fence stop; a transport stop also resolves undefined.
   Return an explicit stop reason and remaining queued count. Consider
   resuming/draining automatically after connectivity recovers: a normal
   subscription reconnect does not itself drain the queue, and the shipped
   witness explicitly retries it. Preserve FIFO, exactly-once replay,
   cancellation, and a user's explicit offline setting.
2. **Preserve actionable diagnostics.**
   `snapback2/packages/snapback2/src/client-offline.ts:54`
   maps many internal errors to `E_OFFLINE_CARRIER`, site
   `RangeStore.open`, with install/configure advice. Distinguish carrier
   unavailability, corrupt persisted state, inconsistent deliveries and
   lifecycle failures; retain the actual operation/site.
3. **Explain pending writes and align admission with readiness.** Surface
   prediction, waiting for connectivity, fence, insufficient IDs and
   refusal as distinct app states with next actions. Check `ready(op)`
   and enqueue behavior around expired grants. Applications should not
   need to interpret grant IDs or slice offsets to render pending UI.
4. **Avoid coupling local reads to a stalled startup request.** Public
   reads and even `offline()` wait on startup; consider exposing unsealed
   retained data while authenticated reconnect proceeds. This is a
   recommendation from code inspection, not a reproduced timing failure.
   Keep sealed data unreadable and prevent cross-principal exposure.

## Acceptance

Add focused behavior coverage for the chosen recovery changes using a
retryable failure, successful recovery, and a stalled startup transport.
Assert explicit public results and preservation of queued work.
Revise existing API/guide documentation with whichever behavior is chosen;
do not claim new automatic recovery until it is implemented.

## Related concrete findings

- [purge-keeps-private-answer-content](./20260905-snapback2-purge-keeps-private-answer-content.md)
- [shrinking-array-evicts-fresh-row](./20260905-snapback2-shrinking-array-evicts-fresh-row.md)
- [reauthentication-keeps-old-epoch](./20260905-snapback2-reauthentication-keeps-old-epoch.md)
- [replay-ledger-after-current-program-validation](./20260905-snapback2-replay-ledger-after-current-program-validation.md)
- [cold-offline-drain-forgets-cursor-name](./20260905-snapback2-cold-offline-drain-forgets-cursor-name.md)
- [range-eviction-unicode-order-mismatch](./20260905-snapback2-range-eviction-unicode-order-mismatch.md)
- [offline-store-full-rewrite-amplification](./20260905-snapback2-offline-store-full-rewrite-amplification.md)
- [held-answer-escaped-object-decoding](./20260905-snapback2-held-answer-escaped-object-decoding.md)

## Review qualification

The package was rebuilt before verification. Existing selected client/carrier
suites passed 251/251 and Rust offline/replay/retention tests passed 37/37.
The new review reproductions expose gaps in that coverage. This ticket is
self-contained; temporary review artifacts are not required to implement it.
