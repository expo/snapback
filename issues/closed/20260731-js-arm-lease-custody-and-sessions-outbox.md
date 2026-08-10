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

2. **Sessions-custody offline queue — IMPLEMENTED 2026-08-06.** The JS arm
   now captures the server descriptor, principal scope, and durable fence
   lineage per queued record under browser/agent custody; reconciles the
   ratified strand/delete matrix before successor observation and replay;
   and exposes explicit read/discard/re-record recovery. The acceptance
   witness is
   `demos/card-game/tests/acceptance/offline-sessions-custody.mjs`.

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

## Triage freshness note (2026-08-01 sweep)

Still valid; package names updated: the workspace renamed to
@expo/snapback-* (22ef5079), and @expo/snapback-contract/client-store is
ALREADY imported by the client (index.mjs:16-20, for
createClientMutationId/retainedQueryKey/stableJson) — leg 1 is a
widening of an existing composition seam, not a new dependency. The 0137
gap ledger names this ticket the owner of
0137-a2-f8-retained-protected-history-gap; the retention refusal
(SNAPBACK_RETENTION_NOT_RETAINABLE) still stands in
packages/snapback-client/index.mjs.

## Backlog Lane C progress + honest narrowing (2026-08-01)

**Leg 3 (default-store directory hygiene): RESOLVED.**
`sweepStaleRqsBlobs` landed in `packages/snapback-client/rqs-store-file.mjs`
and is wired fire-and-forget into `resolveDefaultRqsStore`'s node arm
(`SNAPBACK_CLIENT_RQS_GC=off` disables;
`SNAPBACK_CLIENT_RQS_GC_MAX_AGE_MS` overrides the 30-day floor). The sweep
is fail-closed on everything that matters: never the caller's own origin,
never a blob whose lock a live process holds (same DK-9 liveness verdict as
acquireLock), never PENDING queued intent (exactly-once discipline), never
corrupt bytes (the DK-9 evidence posture), and only past the age floor
measured from recorded activity (entry savedAt/resumedAt, outbox
enqueuedAt, binding-receipt savedAt). Unit coverage in
`rqs-store-file.test.mjs` (swept/kept matrix + idempotence).

**Leg 1 interim receipt landed:** the LLP 0129 super-refine's round-1 gap —
`SNAPBACK_RETENTION_NOT_RETAINABLE` produced but asserted by NO test on any
carrier — is closed on the Node carrier: `rqs-resume.test.mjs` now pins an
auth-scoped subscription (full LLP 0053 scope/invalidation shape over a
protocol-enabled client) refusing retention with that exact code, naming
the lease machinery in its reason, and persisting nothing.

**Leg 1 stays open; leg 2's design history and implementation receipt follow.**
Both are LLP 0053/0043-governed custody protocol work, not composition chores:

- Leg 1 (M1 lease custody) means bringing the format-6 client-store
  discipline — query-authorization namespaces, composite witnesses, signed
  `AuthorizedLease` custody, equality-expiry deletion-before-render — into
  `@expo/snapback-client`'s store arms and its subscribe/render path. The
  composition seam is real (the client already imports
  `@expo/snapback-contract/client-store`), but the render-gating and expiry
  semantics need their own design pass + acceptance rows
  (the LLP 0043 cold-process lease legs named above), and the integrated
  authenticated-restart witness
  (issues/20260801-js-arm-integrated-authenticated-restart-witness.md)
  depends on this leg — see the dependency order recorded there.
- Leg 2 (sessions-custody queue) is an explicit LLP 0043 §Auth posture
  decision: capture-at-enqueue authority descriptors + strand-on-change, or
  a recorded permanent boundary with the Contract arm as the sessions
  offline carrier. Either outcome needs the design recorded first; a lane
  implementation without it would guess the custody semantics.
  **2026-08-03 — design pass commissioned** (author decision sitting #2):
  `issues/20260803-0043-sessions-custody-design.md` owns leg 2's design,
  with capture-at-enqueue authority descriptors + strand-on-authority-change
  as the working hypothesis; the author ratifies the recorded design, not
  the hypothesis. Do not implement leg 2 ahead of that ratification.
  **2026-08-03 — design recorded.** LLP 0043 §Auth posture now carries the
  dated subsection "JS-arm sessions-custody queue — Recorded design
  (2026-08-03, commissioned at author sitting #2)": capture-at-enqueue
  descriptor set, six-row stranding matrix, pre-flight replay gate with
  server-authoritative admission, and the leg-1/0090/Contract-arm/0166
  boundaries, with four open points for the author. Still awaiting
  ratification; leg 2 remains unimplementable until then.
  **2026-08-04 — posture RATIFIED** at author decision sitting #3
  (`issues/closed/20260804-author-decision-sitting-3.md`): all four open
  points ruled (server-refusal-only v1; `SNAPBACK_AUTH_STALE_RESULT`
  surfaces as stranded; cross-principal delete-with-diagnostic-count;
  read/discard/re-record-as-new-`clientMutationId`). The design
  commission (`issues/closed/20260803-0043-sessions-custody-design.md`)
  is closed complete. **Leg 2 implementation is now an available lane**
  — implement per the ratified LLP 0043 §Auth posture subsection; at that
  date the `SNAPBACK_OFFLINE_QUEUE_CUSTODY_UNSUPPORTED` fence still stood.
  **2026-08-06 — IMPLEMENTED** (commit 55564b1018eb). The fence is replaced by capture-at-enqueue
  descriptor/principal/fence custody; all RQS store arms carry `stranded`
  plus atomic reconciliation/discard transitions; the client runs the
  strand/delete matrix before successor observation and each drain; explicit
  stranded read/discard/re-record-as-new-id affordances ship; and
  `demos/card-game/tests/acceptance/offline-sessions-custody.mjs` covers cold
  same-authority replay, same-user replacement recovery, and cross-principal
  delete-with-diagnostic-count. The ticket remains open for leg 1 only.

Next owner: leg 1 with its acceptance rows first; it unblocks the
restart-witness conjunction.

## Resolution — 2026-08-10 (leg 1 landed; ticket complete)

Leg 1 (LLP 0043 M1 lease-bounded protected retention on the JS/React arm)
landed: protected-custody metadata slot with atomic persistence and an
additive v3 store migration, exact lease validation with equality expiry,
delete-before-render, and authority-reset clearing; cold-process lease
acceptance rows green (focused custody tests 2/2; full client + React
suites green). Legs 2 and 3 were already done (leg 2 at 55564b1018eb).
LLP 0043 updated; the restart-witness conjunction ticket is now unblocked
and remains the separate open item.
