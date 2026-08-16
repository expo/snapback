# Review artifact: LLP 0270 — codex family

Target: `llp/0270-local-first-client-defaults.rfc.md` plus the audit
deliverables it rides with (the "Audit (2026-08-16)" matrix in
`issues/closed/20260815-local-first-defaults-audit.md` and the seven
`issues/20260816-*` gap tickets).

## Round 1 — 2026-08-16

- **Reviewer:** Codex gpt-5.6-sol, model_reasoning_effort=xhigh, read-only
  sandbox, fresh non-interactive session, blind to the other family's review.
- **Revision under review:** the uncommitted authoring-worktree deliverable
  set (RFC v0.1).
- **Verdict:** NOT READY.


1. SEVERITY: MATERIAL — issues/20260815-local-first-defaults-audit.md:160 (wrong headless optimistic API) — The audit cites `client.createOptimisticMutationView(outboxStore, { ... })`, but the public API in `packages/snapback-client/index.mjs:5905` and `index.d.mts:1755` accepts one optional options object and obtains the outbox store internally. The cited two-argument form silently ignores the second argument.

2. SEVERITY: MATERIAL — issues/20260815-local-first-defaults-audit.md:53 (wrong retained-query opt-in signature) — The audit shows `client.registerQuery({ retentionRequest: "durable", ... })`; the same form recurs at line 153 and in `issues/20260816-default-retained-query-facts-js-clients.md:29`. The actual public signature in `packages/snapback-client/index.d.mts:1612` is `registerQuery(ref, options)`, and the implementation requires `options.registrationId`. The documented form is not callable as written.

3. SEVERITY: MATERIAL — issues/20260815-local-first-defaults-audit.md:107 (incorrect Expo auto-queue failure behavior) — The audit says a non-durable carrier raises `SNAPBACK_OFFLINE_QUEUE_DURABILITY_REQUIRED`. In `packages/snapback-client/index.mjs:7310`, `#offlineQueueStore(false)` instead returns `null`; the normal `queue: "auto"` path uses that non-required mode around lines 9609–9620 and preserves the original network failure. The diagnostic is raised only by required/explicit paths.

4. SEVERITY: MATERIAL — llp/0270-local-first-client-defaults.rfc.md:69 (false Swift shipped-surface claim) — The RFC’s current-state table says Swift has a “local/hosted live transport proving surface.” `guide/clients/swift.md:22` explicitly limits the shipped proof to `poll/local` and `live/local` and excludes `live/hosted`; `packages/snapback-swift/Sources/SnapbackClient/SnapbackClient.swift:6` likewise lists hosted live transport as future work.

5. SEVERITY: MINOR — issues/20260815-local-first-defaults-audit.md:65 (incomplete React outbox default condition) — The evidence conditions automatic settlement only on a qualified durable writer store. `packages/snapback-client/index.mjs:9594` also requires the target to advertise `offline_mutation_replay`; without that capability, `queue: "auto"` declines local custody. The follow-up ticket and RFC recognize this target-ledger prerequisite, but the matrix evidence does not.
## Round 2 (delta) — 2026-08-16

- **Reviewer:** fresh Codex gpt-5.6-sol xhigh read-only session; delta review
  of the fix round (RFC v0.2, sha256 `438e3bb30f3f1722eab521da00262f0c6a67ed98f708f01e74b90481a5666809`).
- **Verdict:** READY (all round-1 findings verified fixed; no new defects).
