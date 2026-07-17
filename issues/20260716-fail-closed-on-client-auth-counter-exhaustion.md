# Fail closed on client auth counter exhaustion

**Status:** Open
**Severity:** P1
**Systems:** JavaScript client, Browser auth, Agent auth, Live transport
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0059 §Exposure invariant, LLP 0059 §Transition barrier
**Marker:** security, concurrency, fail-closed

Browser/manual terminal handling catches auth-session-cache and transport
generation exhaustion. `clearAuthSession()` currently advances its generation
before clearing the cached projection, so overflow can leave predecessor
private state reachable while the durable coordinator is still current.
Transport overflow can likewise skip controller and stream closure.

**Done when:**

- Cache and transport state are synchronously cleared even when either counter
  cannot advance.
- Exhaustion permanently closes this client instance to later auth-session,
  request, and publication work; no comparison identity is reused.
- A finite caller observes a rejected terminal settlement rather than a false
  success when its local cut exhausts a counter.
- Deterministic lowered-ceiling tests cover both counters and prove cached
  predecessor state, requests, streams, and materializations stay closed.
