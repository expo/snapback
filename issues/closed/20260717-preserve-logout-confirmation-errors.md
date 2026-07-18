# Preserve fatal custody diagnostics during logout confirmation

**Status:** Closed
**Severity:** P2
**Systems:** Auth, Client kit, Logout, Diagnostics
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0059; LLP 0060
**Marker:** auth, logout, custody, diagnostics, fail-closed

The self-terminal logout confirmation loop retried clearing/stale races, but it
also converted every other synchronization failure into the generic
`SNAPBACK_CLIENT_AUTHORITY_STALE` result. That erased stable evidence for
custody corruption, counter exhaustion, lock loss, read failure, or participant
failure exactly where callers need the original diagnostic to fail closed and
repair the underlying state.

**Done when:**

- Only `SNAPBACK_CLIENT_AUTHORITY_CLEARING` and
  `SNAPBACK_CLIENT_AUTHORITY_STALE` are retried.
- Every non-transient confirmation failure is rethrown unchanged.
- A deterministic regression proves object identity and diagnostic identity
  survive the logout confirmation path.
- The governing auth contract records the diagnostic rule.

## Resolution

`authLogout` now rethrows every non-clearing/non-stale confirmation error
directly. The client regression completes the captured peer clear, injects a
fatal synchronization diagnostic, and proves that exact error reaches the
caller rather than a reconstructed stale-authority error. LLP 0060 records the
fail-closed preservation requirement.
