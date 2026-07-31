# JS-arm lease custody and sessions-mode outbox (LLP 0129 Phase 0 remainder)

**Opened:** 2026-07-31
**Systems:** Client integration, Sync, Auth
**Related:** LLP 0129 (Phase 0), LLP 0043 (M1), LLP 0053 (§The lease), LLP 0090

Phase 0 landed default persistence, the durable M2 outbox, client-minted
`clientMutationId` idempotency, and ordered exactly-once replay on the
JS/React arm (`packages/snapback-client`), with the retainability boundary
refused-with-clarity. Two legs deliberately stayed out of the lane and need
owners:

1. **Lease-bounded protected retention (LLP 0043 M1 custody) on the JS arm.**
   Protected/auth-scoped queries currently refuse retention with
   `SNAPBACK_RETENTION_NOT_RETAINABLE` on this arm. Bringing them the
   Contract arm's custody protocol means the format-6 client store
   discipline (query-authorization namespace, composite witness, signed
   `AuthorizedLease` custody, equality-expiry deletion-before-render) —
   either by composing `@snapback/contract`'s `client-store.mjs`/
   `authorized-lease.mjs` modules into `@snapback/client` or by an owned
   design saying why not. Guide GAP row: `sync.offline-js-arm-protected`.

2. **Sessions-custody offline queue.** `#offlineQueueStore()` deliberately
   returns null under browser/agent session custody (`authorityFence`
   present): a sessions-mode mutation carrying `clientMutationId` must
   present a current authority descriptor at settlement, and descriptor
   capture-at-enqueue/strand-on-authority-change is the Contract arm's
   shipped discipline (LLP 0043 §Auth posture). The JS-arm queue today
   covers dev/external-bearer custody only. Either port the descriptor
   custody or record the boundary as permanent with the Contract arm as
   the sessions offline carrier.

3. **Default-store directory hygiene.** The node default store keys blobs
   and lock files by server origin under `~/.snapback/rqs` (or
   `SNAPBACK_CLIENT_RQS_DIR`). Locks held at process exit are unlinked by
   the exit hook, but per-origin blobs from dead origins (ephemeral test
   ports) accumulate; a janitor (age-based blob GC) or per-app scoping
   would keep the directory bounded.

Acceptance for leg 1 should extend
`demos/public-dashboard/tests/acceptance/offline-local-first.mjs` (or a
sessions-mode sibling) with the LLP 0043 cold-process lease rows: lease-valid
retained display, equality expiry, delete-before-render on mismatch.
