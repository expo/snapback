# Bind native fetch authority before async body preparation

**Status:** In Progress
**Severity:** P0
**Systems:** Runtime, Security, Actions, Upstream Ibex, Fetch
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-18
**Related:** LLP 0009 §Capability Model; Ibex LLP 0013 §Phase 5; `tests/action_watchdog_v0.rs`
**Marker:** fetch, promise, principal, egress, capability-attribution

An action can call public `fetch()` from a real granted frame, then cross
Promise turns while its request body is normalized before the native bridge is
invoked. Re-deriving authority at `__nativeFetch` time observes runtime-internal
or body-preparation causality rather than the caller and can either false-deny a
legitimate action or tempt a fail-open fallback.

Bind the complete principal stack synchronously in public `fetch()`, before the
first async body-preparation step, and carry only an opaque same-runtime token to
the native bridge. The token authenticates identity, not a frozen grant: the
native boundary must recheck current policy for the initial URL and every
redirect. Alternate socket/streaming transports that do not receive the token
must retain their live ambient checks. No mutable `NativeFetchModule` method may
observe or replay a stronger caller's token.

**Done when:**

- the token can be minted only from a genuine live user frame;
- plain objects, Proxies, cross-runtime tokens, and repeated use through hostile
  constructors cannot forge native authority;
- bodyful native fetch preserves the caller across body preparation;
- every redirect host is rechecked against the captured stack and current
  policy;
- revocation after mint denies before a request starts;
- `fetch_endpoint_capabilities_are_host_scoped`, the focused engine tests, the
  action watchdog, and the full local proof pass;
- the implementation is pushed and CI is green before this issue moves to
  `issues/closed/`.

## Implemented; remote verification pending

Ibex now snapshots the native callable and token factory before application
code, mints a same-runtime HostObject while the public `fetch()` caller is still
live, keeps it in a lexical closure rather than the mutable module abstraction,
and rechecks the current endpoint grant at the C++ boundary for every native
hop. Focused forgery, redirect, body, and post-mint revocation coverage is in the
release worktree; rebuild, local proof, push, and CI verification remain.
