# Refuse custody helper correlation exhaustion

**Status:** Closed
**Severity:** P1
**Systems:** Agent auth, Filesystem custody, Capability helper
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0055 §Grant-backed live and queued replay
**Marker:** overflow, aba, custody, ipc, correlation

The retained filesystem-capability parent increments JavaScript-number request
and session identifiers with unchecked `+= 1`; its helper does the same for
hook identifiers. At the safe-integer ceiling, a later increment stops changing
the value. Pending-map entries or live helper sessions can then alias, causing
one response, hook, release, or lock owner to be delivered to another custody
operation.

**Done when:**

- Request, session, and hook correlation allocators check the portable
  safe-integer bound before registering any pending state.
- Exhaustion permanently fails that capability/helper lineage closed with a
  stable typed diagnostic; no identifier is reused and no already-pending
  entry is overwritten.
- Deterministic near-maximum tests cover parent requests, parent sessions, and
  helper hooks, including preservation/settlement of the predecessor owner.
- Filesystem custody and contract suites pass.

## Resolution

All three allocators now consume the last safe integer at most once and use a
null terminal sentinel instead of incrementing beyond it. The first later
allocation records a stable
`SNAPBACK_AUTH_CUSTODY_CORRELATION_EXHAUSTED` error, rejects pending work,
closes helper sessions and the retained capability, and refuses every later
attempt with the same diagnostic. Test-only seeds prove request, session, and
hook boundaries without billions of operations.

Verified 2026-07-17 with:

- `node demos/_kit/tests/agent-authority-filesystem.mjs`
- `node packages/snapback-contract/agent-authority-contract.test.mjs`
- `./ref-check --verbose`
