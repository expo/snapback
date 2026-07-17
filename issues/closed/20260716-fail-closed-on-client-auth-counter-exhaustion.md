# Fail closed on client auth counter exhaustion

**Status:** Closed
**Severity:** P1
**Systems:** JavaScript client, AuthCoordinator, Browser auth, Agent auth, Live transport
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0059 §Exposure invariant, LLP 0059 §Transition barrier
**Marker:** security, concurrency, fail-closed

Browser/manual terminal handling catches auth-session-cache and transport
generation exhaustion. `clearAuthSession()` currently advances its generation
before clearing the cached projection, so overflow can leave predecessor
private state reachable while the durable coordinator is still current.
Transport overflow can likewise skip controller and stream closure.

AuthCoordinator's durable authority epoch and custody revision are also finite.
An exhausted context must not retain a usable predecessor capture, and peers
must have a durable, secret-free terminal state they can encounter under
ownership instead of wrapping or reusing a comparison identity.

**Done when:**

- Cache and transport state are synchronously cleared even when either counter
  cannot advance.
- Exhaustion permanently closes this client instance to later auth-session,
  request, and publication work; no comparison identity is reused.
- AuthCoordinator reserves the final custody revision for a durable terminal
  marker, strips authority and bearer state from that marker, and permanently
  wedges every local or peer context that observes it.
- A legacy or injected non-terminal record at the maximum revision is treated
  as durable poison: ownership blanks the local context and no predecessor
  publication callback can run, even though no further CAS is possible.
- A finite caller observes a rejected terminal settlement rather than a false
  success when its local cut exhausts a counter.
- Deterministic lowered-ceiling tests cover both counters and prove cached
  predecessor state, requests, streams, and materializations stay closed.
- Deterministic AuthCoordinator peer tests cover epoch exhaustion during a
  terminal clear, revision exhaustion during bearer rotation, and an injected
  maximum-revision record; they prove peers blank and never resume or publish
  the predecessor.

## Resolution

Closed 2026-07-16. Commits `cc71df8`, `2096598`, and `deab141` terminalize exhausted
coordinator, client, and broadcast counters in the kit and Contract adapters;
lowered-ceiling peer and publication tests cover the closed behavior.
