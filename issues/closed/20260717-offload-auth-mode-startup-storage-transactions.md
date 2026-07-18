# Offload auth-mode startup storage transactions from async workers

**Status:** Closed
**Severity:** P1
**Systems:** CLI startup, Auth mode, Storage, Tokio
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0032 L7; `src/cli.rs`; `src/storage/auth_mode.rs`
**Marker:** startup, async-worker, SQLite, auth-mode, blocking

The CLI's auth-mode startup path put artifact and Hermes preparation behind
`startup_blocking`, and later put pending-mode consumption behind the same
boundary, but it executed the initial auth-mode staging transaction directly
inside `compose_auth_mode_startup` on a Tokio worker. The same-mode dev
deployment transaction used the direct path too. Both operations perform
SQLite schema, seed, membership, mode-record, and commit work; under load they
could occupy an async worker even though LLP 0032 L7 requires SQLite and Hermes
work to run behind the blocking boundary.

The gap remained latent while the auth-mode helpers' individual SQLite calls
did not all carry execution assertions. The storage-ordering review added an
explicit global-version read to the transaction-final membership preflight,
and the existing multi-thread startup regression then failed at that read with
the L7 async-worker assertion. Removing the assertion would hide the actual
boundary violation rather than fix it.

**Done when:**

- Initial dev-to-sessions staging runs inside `startup_blocking`.
- Same-mode dev schema/seed deployment runs inside `startup_blocking`.
- The authoritative auth-mode snapshot following either transaction is read
  inside the same bounded startup handoff.
- Function publication remains after the durable transaction succeeds.
- The multi-thread startup regression proves SQLite and Ibex preparation do
  not execute on an unsanctioned Tokio worker.

## Resolution

`compose_auth_mode_startup` now wraps each previously direct storage
transaction and its successor snapshot read in `startup_blocking`. This uses
Tokio's pre-bind `block_in_place` handoff on a multi-thread runtime (and the
existing bounded blocking sanction on runtimes where a handoff is unavailable),
while preserving the ordering in which a durable deployment succeeds before
its preflighted functions publish.

Focused proof on 2026-07-17:

- `cargo test --lib sessions_startup_offloads_sqlite_and_ibex_from_async_workers -- --nocapture` — passed.
- `cargo test --lib` — 1,098 passed, 0 failed.
- `cargo check --lib` — passed.
