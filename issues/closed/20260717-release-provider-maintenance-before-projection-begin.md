# Release provider maintenance before projection Begin

**Status:** Closed
**Severity:** P1
**Systems:** Session auth, Auth provider, Session projection, Reset, Runtime GC
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0057 §Concurrency, locks, and linearization; LLP 0059 §Locking and linearization
**Marker:** auth, lock-order, deadlock, projection, release-blocker

Session mutation routes retain an `AuthAdmission` (and, for mint/exchange, an
address-stripe guard) from the read-only planning pass across coordinator
`premark_*`. Periodic GC likewise retains exclusive provider maintenance while
sampling/finalizing projected expiry, and coordinated reset retains it across
stream premark, connection terminalization, and stream finalization. These are
direct violations of LLP 0057/0059's composed lock graph: every provider,
address, catalog, and database guard must be released before projection Begin,
and no such guard may overlap a projection, connection-registry, or terminal
lifecycle lock.

The current route ownership fix makes the post-premark SQLite work
independently owned, but it does not cure this earlier overlap. It can also
deadlock exclusive maintenance against a projection drain whose predecessor
needs provider or Local progress.

**Done when:**

- Mint, exchange, refresh rotation/reuse, logout, and actionable family alarm
  release their planning admission/address guard before `premark_*`.
- Post-premark owned work reacquires only the provider coordination it needs,
  consumes and drops it around the Local/SQLite transaction, and calls
  coordinator finish plus terminal propagation after that guard is gone.
- Exact durable CAS/reconciliation handles any predecessor change while the
  provider/address guard is released; plaintext candidates remain owned by the
  projection carrier and are never published early.
- Periodic GC terminalizes sampled session expiry before acquiring exclusive
  maintenance for the ordinary GC transaction.
- Coordinated reset premarks the stream before acquiring exclusive maintenance
  and releases maintenance after the durable reset/mailbox cut, before
  connection lifecycle propagation, issuer publication, or coordinator
  finalization.
- Deterministic lock-order tests exercise provider maintenance contention at
  each handoff and prove no provider/address guard overlaps projection Begin or
  terminal lifecycle work.
- Focused provider/coordinator/runtime/server tests and the canonical proof
  pass.

## Resolution

Session routes now drop planning admission/address guards before projection
Begin, then independently own any exact provider transaction and drop provider
coordination before projection finish or terminal fanout. GC premarks projected
expiry before ordinary maintenance, and reset releases exclusive maintenance
after the durable cut but before lifecycle and coordinator completion.

Deterministic proof includes
`periodic_gc_releases_projection_begin_before_acquiring_maintenance`,
`periodic_gc_terminalizes_projection_before_deleting_durable_session`,
`logout_begin_releases_provider_and_cancelled_waiter_cannot_cancel_finish`,
and the committed-reset projection tests. Provider/coordinator/server coverage
passed within the 1,102-test Rust library suite.
