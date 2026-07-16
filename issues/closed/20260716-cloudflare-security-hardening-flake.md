# Eliminate intermittent Miniflare worker disconnect in the security gate

**Status:** Closed
**Severity:** P2
**Systems:** Cloudflare target, Miniflare, Acceptance tests, Worker lifecycle
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0040 §Acceptance, LLP 0040 §Proof runtime preflight
**Marker:** test-reliability

On supported Node `v24.14.0`,
`cloudflare/test/acceptance.security-hardening.mjs` failed twice with the local
Miniflare HTTP worker closing its socket. One run failed on the first
`refreshFeed` action; another failed later on `__test/connection-state`. The
same suite then passed alone, and the complete canonical Cloudflare inventory
subsequently passed 20/20.

The varying failure location and later success indicate an intermittent worker
or listener lifecycle race. The current error records the request URL but does
not preserve enough Worker/Miniflare termination evidence to identify why the
other side closed.

**Done when:**

- The failure can be deterministically reproduced or stress-tested over enough
  repetitions to establish a useful baseline.
- The harness captures Worker exit, unhandled rejection, and Miniflare runtime
  diagnostics when a loopback connection closes unexpectedly.
- The underlying lifecycle race is fixed; do not make the security proof green
  by blindly retrying assertions or whole suites.
- Repeated standalone and full-inventory runs are stable on every supported
  proof-runtime Node major.

## Resolution

The churn-heavy real-loopback proof now explicitly closes each Undici HTTP
connection, preventing a pooled socket from surviving disposal of its
Miniflare listener without retrying any assertion or suite. The harness retains
a bounded, binding-redacted ring of Miniflare/workerd warnings and Node
uncaught-exception evidence and emits it on transport failure. Ten consecutive
standalone runs and the full 20/20 inventory pass on supported Node v24.14.0.
