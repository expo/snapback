# Prove RBAC live invalidation and cross-user isolation

**Status:** Open
**Severity:** P2
**Systems:** RBAC demo, Live queries, Auth invalidation, Acceptance tests
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0053; LLP 0056
**Marker:** rbac, live-query, authorization, acceptance-coverage

The RBAC acceptance keeps Alice and Bob subscriptions alive while Bob joins
and posts, but it only asserts their initial subscribe snapshots. After the
authority change it checks a one-shot query and then unsubscribes. The test can
therefore pass if live authorization invalidation never refreshes Bob, if
Alice never receives later fanout, or if later envelopes cross user scopes.

**Done when:**

- Acceptance observes the live output produced after Bob's membership grant
  and announcement rather than inferring it from a one-shot query.
- Alice and newly authorized Bob each receive the allowed rows under their own
  authorization namespace.
- Eve and Bob-before-membership cannot observe member-only rows, and no
  envelope or retained snapshot crosses client-store/query-instance identity.
- The proof has deterministic bounded waiting and disposes every subscription
  before auth/server teardown.
