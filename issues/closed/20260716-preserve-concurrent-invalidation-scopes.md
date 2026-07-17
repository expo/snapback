# Preserve concurrent authorization invalidation scopes

**Status:** Closed
**Severity:** P1
**Systems:** Auth invalidation, Live queries, Durable mutation queue
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0053 §Client fences
**Marker:** security, concurrency

The live client advances one global authorization-task generation for every
incoming obligation. A second, independent scope can therefore stale the first
scope's serialized durable queue suspension before it runs. Until level-
triggered refire, queued work may remain insufficiently quarantined.

**Done when:**

- Task generation advances only for query expectation/lifecycle replacement;
  per-scope fences arbitrate independent obligations.
- Distinct scope roots coexist through queue apply, resolution, and ACK.
- A regression delays scope A's delete queue write, delivers scope B's retain
  resolution, and proves both roots retain their required effects.

## Resolution

Closed 2026-07-16. Commit `c27cd3a` replaced cross-scope task invalidation with
per-scope fences in `demos/_kit/client.mjs`; `auth-invalidation-client.mjs` delays
scope A while resolving scope B and proves both roots retain their effects.
