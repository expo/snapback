# Refuse handler invocation and warm-pool identity exhaustion

**Status:** Open
**Severity:** P1
**Systems:** Code execution, Warm VM pool, Handler host calls
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0009 §DK-4 as-built — the warm VM pool and its per-invocation reset
**Marker:** overflow, aba, runtime, warm-vm, stale-continuation, authority

Two code-execution identities deliberately use wrapping allocation even though
LLP 0009 relies on them as monotonic security fences:

- `NEXT_INVOCATION_EPOCH.fetch_add(1)` eventually reuses an invocation epoch.
  A module-scope continuation carrying the old value could then pass the
  cross-invocation host-call guard and execute with another invocation's
  authority.
- `WarmVmPool::clear` wraps the pool generation. An in-flight VM stamped with
  the reused generation could check back into a later pool after a reload or
  reset, reintroducing predecessor module state. The LRU tick wraps too, which
  makes eviction order cease to describe recency.

The exhaustion horizon is remote, but wrapping is explicitly contrary to the
identity contract and deterministic tests can reach it.

**Done when:**

- Invocation epochs are allocated without reuse; exhaustion returns a stable
  typed diagnostic before evaluating application code or installing a host
  context.
- A pool-generation exhaustion permanently disables reuse for that pool
  lineage (fresh VMs remain available) and no pre-exhaustion checkout can be
  accepted after the terminal clear.
- LRU overflow cannot make a recently pooled VM look oldest; the bounded pool
  either rebases order safely or uses a non-wrapping allocation.
- Deterministic near-maximum tests prove the final unique identity, the next
  refusal/fresh fallback, and rejection of a stale checked-out VM.
- LLP 0009 and focused runtime/warm-VM tests describe and prove the terminal
  behavior.
