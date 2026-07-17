# Fence default client request starts with durable custody

**Status:** Closed
**Severity:** P1
**Systems:** JavaScript client, Auth custody, Mutations, Actions
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0059 §Cross-context ownership
**Marker:** security, concurrency

The client started network effects inside a final durable comparison only when
the caller supplied `authorityCapture`. Direct public query, mutation, action,
ephemeral, and acknowledgement calls could therefore execute under a stale
predecessor after a missed peer transition, then merely discard the response.

**Done when:**

- Every authority-bearing request starts synchronously inside an exact durable
  comparison using the captured authority, with explicit captures remaining an
  additional intent check.
- A missed-peer-transition test proves a default direct mutation performs zero
  fetches.
- A transition after an already-authorized request start still suppresses the
  complete response publication.

## Resolution

Closed 2026-07-16. Commits `c27cd3a` and `6ae7243` require durable ownership before
default query, mutation, and action starts and serialize terminal settlement with
request start; `demos/_kit/tests/client-errors.mjs` covers zero-fetch and post-start
suppression.
