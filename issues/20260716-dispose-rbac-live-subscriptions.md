# Dispose RBAC live subscriptions before acceptance teardown

**Status:** Open
**Severity:** P1
**Systems:** RBAC demo, Live queries, Auth clients, Acceptance tests, CI
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Reopened:** 2026-07-17
**Related:** LLP 0056; LLP 0053
**Marker:** resource-leak, rbac, build-integrity, regression

The acceptance test records a subscription only after a timeout-raced request
resolves. A request that resolves after the wrapper or outer join deadline can
therefore append after `finally` has already disposed the current list and
closed auth/server resources. `Promise.race` supplies a diagnostic deadline,
but it neither cancels nor joins the losing operation.

The first owned-task repair still has two teardown races. `disposeAll()` leaves
creation open, so a new task can register after settlement and escape the
disposal loop. Concurrent `closeAndDispose()` calls each run their own loop and
can unsubscribe the same live subscription twice. Its outer watchdog only
fire-and-forgets `server.stop()` and suppresses teardown failure, so a failed
stop can still leave the owned task and acceptance process hung indefinitely.

**Done when:**

- Subscription creation has one coherent deadline/cancellation lifecycle.
- Teardown first closes creation, then waits for every started creation to
  settle, and disposes any success that arrives during teardown before auth
  clients or the server close.
- Closing is idempotent and single-flight; concurrent callers observe the same
  completion and each subscription is disposed exactly once.
- No public disposal path can return while creation remains open or while a
  late registered subscription remains owned.
- No nested timeout can outlive an outer timeout and mutate cleanup state.
- The outer deadline owns a real abort/forced-teardown lifecycle and has a
  terminal bound even when graceful server stop fails; it never treats a
  losing `Promise.race` branch as cancellation.
- A deterministic regression forces one short failure and one deferred success
  plus concurrent close and forced-abort races, and proves each successful
  subscription is disposed exactly once before close.
- Repeated RBAC acceptance runs and the canonical proof complete cleanly.
