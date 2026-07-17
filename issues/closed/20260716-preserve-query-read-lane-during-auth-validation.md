# Preserve the query read lane during auth validation

**Status:** Closed
**Severity:** P1
**Systems:** HTTP invocation gate, Agent auth, Query read lane, Concurrency
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0032 §Phase 3 — lifecycle and resource hardening; LLP 0059 §Finite service-authority fence
**Marker:** performance, concurrency, authorization, regression

Finite scoped-token hardening made `/query/{name}` acquire the global app write
lane before every query, even when the prepared authority was anonymous or a
human session. The validation call is a no-op for those authority classes, but
waiting for the write lane defeats the WAL reader pool and can stall ordinary
queries behind a long mutation.

**Done when:**

- Only service-principal queries enter the SQLite-owned finite-authority
  validation cut.
- Anonymous and session queries retain their process publication fences without
  acquiring the app write lane before the read-lane query.
- The busy-mutation concurrency suite proves health and ordinary queries finish
  before the writer, while the real scoped-token route matrix remains green.

## Resolution

Closed 2026-07-16. Commit `de78f0d` scopes
`persist_and_validate_prepared_service_authority` to service-principal queries.
The complete `concurrency_v0` suite and the real finite-authority route matrix
pass together, preserving both WAL concurrency and the terminal authority cut.
